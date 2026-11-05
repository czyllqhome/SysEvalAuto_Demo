import asyncio
import copy
import time

from app.db import Confirmation, Control, Job, Prd, Submission
from app.worker import run_once
from conftest import register
from fastapi.testclient import TestClient
from sqlalchemy import func, select

BRIEF = {"summary": "Improve customer service", "functions": [
    {"id": "F-1", "title": "Create tickets", "description": "Create a service ticket", "source_blocks": ["functions"]}],
    "departments": ["Customer service"], "roles": ["Service agent", "Department approver"],
    "owner_role": "Service lead", "scope": "Ticket lifecycle; billing excluded", "workflow": "Create, assign, approve",
    "data_notes": "Ordinary customer records", "integrations": "Customer directory", "constraints": "8-hour interruption tolerance",
    "questions": [], "grading_facts": {}}


def current(client, system_id):
    response = client.get(f"/api/v1/systems/{system_id}")
    assert response.status_code == 200, response.text
    return response.json()


def command(client, system_id, suffix, body=None, expected=200, method="post", key=None):
    data = current(client, system_id)
    response = getattr(client, method)(f"/api/v1/systems/{system_id}/{suffix}",
                                      json={"version": data["system"]["version"], **(body or {})},
                                      headers={"Idempotency-Key": key} if key else {})
    assert response.status_code == expected, response.text
    return response


def prepare(owner):
    app, client = owner
    response = client.post("/api/v1/systems", json={"name": "Service portal"})
    assert response.status_code == 200, response.text
    sid = response.json()["system"]["id"]
    command(client, sid, "context-draft", {"blocks": {"goal": "Improve service", "functions": "Create tickets"}}, method="put")
    command(client, sid, "classification-confirmations", {"mode": "questionnaire", "answers": {
        "Q1": "L2", "Q2": "L2", "Q3": "L2", "Q4": "L1", "Q5": "L2"}})
    result = command(client, sid, "context-confirmations", {"context": BRIEF}).json()
    assert result["system"]["status"] == "CONTROL_REVIEW"
    assert len([c for c in result["controls"] if c["included"]]) == 10
    return app, client, sid


def generate_prd(owner):
    app, client, sid = prepare(owner)
    command(client, sid, "jobs", {"kind": "prd_generation", "mode": "local", "language": "en"})
    assert asyncio.run(run_once(app.state.sessions))
    result = current(client, sid)
    assert result["system"]["status"] == "PRD_REVIEW", result
    assert len(result["prd"]["data"]["requirements"]) == 11
    command(client, sid, "prd-approval")
    return app, client, sid


def invite_supplier(owner):
    app, client, sid = generate_prd(owner)
    response = command(client, sid, "supplier-rounds", {"supplier_name": "Test supplier", "email": "supplier@example.test"}).json()
    vendor = TestClient(app)
    register(vendor, "supplier@example.test", invite_token=response["invite_token"], name="Supplier approver")
    return app, client, vendor, sid


def submit_supplier(owner):
    app, client, vendor, sid = invite_supplier(owner)
    result = current(vendor, sid)
    answers = {req["id"]: {"implementation_status": "yes", "duration_workdays": 5,
                            "owner_name": "Delivery owner", "implementation_plan": "Implement and verify both permitted and denied paths"}
               for req in result["prd"]["data"]["requirements"]}
    response = command(vendor, sid, "supplier-submit", {"round_version": result["round"]["version"],
                       "answers": answers, "mode": "local", "language": "en"}, key="submit-once")
    assert response.json()["system"]["status"] == "RESULT_REVIEW"
    assert response.json()["report"]['mode'] == 'local'
    assert not response.json()["report"]['reviewed']
    return app, client, vendor, sid


def test_full_separate_identity_workflow_and_same_hash_agreement(owner):
    app, client, vendor, sid = submit_supplier(owner)
    result = current(client, sid)
    assert result["system"]["status"] == "RESULT_REVIEW"
    findings = result["report"]["data"]["findings"]
    assert all(f["severity"] == "unknown" for f in findings), "A supplier yes is not proof"
    decisions = {f["id"]: {"decision": "accept", "reason": "Customer owner schedules acceptance verification"} for f in findings}
    command(client, sid, "review-decisions", {"decisions": decisions, "exception_reason": "No exclusions; owner confirms current classification"})
    result = command(client, sid, "baselines").json()
    baseline = result["baseline"]
    response = client.post(f"/api/v1/baselines/{baseline['id']}/finalize", json={"version": result["system"]["version"]})
    assert response.status_code == 409
    for party in (client, vendor):
        state = current(party, sid)
        response = party.post(f"/api/v1/baselines/{baseline['id']}/confirmations", json={
            "version": state["system"]["version"], "content_hash": baseline["content_hash"]})
        assert response.status_code == 200, response.text
    state = current(client, sid)
    response = client.post(f"/api/v1/baselines/{baseline['id']}/finalize", json={"version": state["system"]["version"]})
    assert response.status_code == 200, response.text
    assert response.json()["system"]["status"] == "PENDING_DEVELOPMENT"
    with app.state.sessions() as db:
        assert db.scalar(select(func.count()).select_from(Confirmation)) == 2
        assert db.scalar(select(func.count()).select_from(Submission)) == 1


def test_cross_organization_and_supplier_scope_are_enforced(owner):
    app, _client, vendor, sid = invite_supplier(owner)
    outsider = TestClient(app)
    register(outsider, "outsider@example.test")
    assert outsider.get(f"/api/v1/systems/{sid}").status_code == 404
    assert outsider.get(f"/api/v1/systems/{sid}/history").status_code == 404
    assert vendor.get("/api/v1/controls").status_code == 403
    assert vendor.post(f"/api/v1/systems/{sid}/classification-confirmations", json={}).status_code == 404
    assert vendor.get(f"/api/v1/systems/{sid}/history").status_code == 404
    view = current(vendor, sid)
    assert view["system"]["draft"] == {}
    assert view["controls"] == []


def test_optimistic_concurrency_and_csrf_protect_drafts(owner):
    _, client, sid = prepare(owner)
    version = current(client, sid)["system"]["version"]
    command(client, sid, "context-draft", {"blocks": {"goal": "New text"}}, method="put")
    response = client.put(f"/api/v1/systems/{sid}/context-draft", json={"version": version, "blocks": {}})
    assert response.status_code == 409
    assert current(client, sid)["system"]["draft"]["blocks"]["goal"] == "New text"
    csrf = client.headers.pop("X-CSRF-Token")
    assert client.post("/api/v1/systems", json={"name": "Unauthorized mutation"}).status_code == 403
    client.headers["X-CSRF-Token"] = csrf


def test_confirmation_rejects_unaccepted_grade_changes(owner):
    _, client, sid = prepare(owner)
    updated = copy.deepcopy(BRIEF)
    updated["grading_facts"] = {"Q3": "L3"}
    response = command(client, sid, "context-confirmations", {"context": updated}, expected=409)
    assert response.json()["code"] == "CLASSIFICATION_CHANGED"


def test_late_context_job_does_not_overwrite_new_input(owner):
    app, client, sid = prepare(owner)
    command(client, sid, "classification-confirmations", {"mode": "manual", "level": "L2", "reason": "Owner choice"})
    queued = command(client, sid, "jobs", {"kind": "context_organization", "mode": "local", "language": "en"}).json()
    command(client, sid, "context-draft", {"blocks": {"goal": "Changed while the task was queued"}}, method="put")
    assert asyncio.run(run_once(app.state.sessions))
    response = client.get(f"/api/v1/jobs/{queued['job_id']}")
    assert response.json()["state"] == "stale"
    assert current(client, sid)["system"]["draft"]["blocks"]["goal"] == "Changed while the task was queued"


def test_prd_context_change_keeps_history_but_invalidates_current_artifacts(owner):
    app, client, sid = generate_prd(owner)
    original = current(client, sid)
    revised = copy.deepcopy(BRIEF)
    revised["summary"] = "A new business objective"
    response = command(client, sid, "context-confirmations", {"context": revised}).json()
    assert response["prd"] is None
    assert response["system"]["revision"] == original["system"]["revision"] + 1
    assert len(response["controls"]) == 10
    with app.state.sessions() as db:
        assert db.get(Prd, original["prd"]["id"]) is not None


def test_required_control_exclusion_changes_only_this_selection(owner):
    app, client, sid = prepare(owner)
    control = current(client, sid)["controls"][0]
    response = command(client, sid, "controls", {"control_id": control["id"], "included": False}, expected=422)
    assert response.json()["code"] == "EXCLUSION_REASON_REQUIRED"
    command(client, sid, "controls", {"control_id": control["id"], "included": False, "reason": "Excluded with accountable review"})
    with app.state.sessions() as db:
        assert db.get(Control, control["id"]) is not None
        assert db.scalar(select(func.count()).select_from(Control)) == 15




def test_model_not_configured_does_not_fall_back_silently(owner, monkeypatch):
    _, client, sid = prepare(owner)
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    response = command(client, sid, "jobs", {"kind": "prd_generation", "mode": "openrouter", "language": "en"}, expected=503)
    assert response.json()["code"] == "MODEL_NOT_CONFIGURED"
    assert current(client, sid)["system"]["status"] == "CONTROL_REVIEW"


def test_submission_retry_reuses_immutable_publication(owner):
    app, _client, vendor, sid = invite_supplier(owner)
    detail = current(vendor, sid)
    body = {"version": detail["system"]["version"], "round_version": detail["round"]["version"],
            "answers": {r["id"]: {"implementation_status": "no", "limitations": "Not supported by the proposed platform"} for r in detail["prd"]["data"]["requirements"]},
            "mode": "local", "language": "en"}
    first = vendor.post(f"/api/v1/systems/{sid}/supplier-submit", json=body, headers={"Idempotency-Key": "stable-submission"})
    repeated = vendor.post(f"/api/v1/systems/{sid}/supplier-submit", json=body, headers={"Idempotency-Key": "stable-submission"})
    assert first.status_code == repeated.status_code == 200
    assert first.json()["submission_id"] == repeated.json()["submission_id"]
    with app.state.sessions() as db:
        assert db.scalar(select(func.count()).select_from(Submission)) == 1
        assert db.scalar(select(func.count()).select_from(Job).where(Job.kind == "impact_analysis")) == 0






def test_negotiation_instructions_reach_the_new_supplier_round(owner):
    _, client, vendor, sid = submit_supplier(owner)
    before = current(client, sid)
    result = command(client, sid, "negotiation-rounds", {"reason": "Clarify export permissions and who approves them"}).json()
    assert result["round"]["id"] != before["round"]["id"]
    assert current(vendor, sid)["round"]["instructions"] == "Clarify export permissions and who approves them"
    assert result["baseline"] is None and result["report"] is None


def test_invalid_model_output_cannot_publish_and_repairs_are_bounded(owner, monkeypatch):
    from app import worker
    from app.ai import local_prd

    app, client, sid = prepare(owner)
    queued = command(client, sid, "jobs", {"kind": "prd_generation", "mode": "local", "language": "en"}).json()
    async def incomplete(kind, source, language, mode):
        output = local_prd({**source, "controls": []}, language)
        return output, {"tokens": 42}
    monkeypatch.setattr(worker, "generate", incomplete)
    assert asyncio.run(run_once(app.state.sessions))
    with app.state.sessions.begin() as db:
        job = db.get(Job, queued["job_id"])
        assert job.state == "queued"
        job.next_run = 0
    assert asyncio.run(run_once(app.state.sessions))
    with app.state.sessions() as db:
        job = db.get(Job, queued["job_id"])
        assert job.state == "failed" and job.attempts == 2
        assert job.usage["tokens"] == 84
    assert current(client, sid)["prd"] is None
    assert current(client, sid)["system"]["status"] == "PRD_GENERATING"


def test_superseded_worker_fence_cannot_publish(owner, monkeypatch):
    from app import worker
    from app.ai import local_prd

    app, client, sid = prepare(owner)
    queued = command(client, sid, "jobs", {"kind": "prd_generation", "mode": "local", "language": "en"}).json()
    async def old_worker(kind, source, language, mode):
        with app.state.sessions.begin() as db:
            db.get(Job, queued["job_id"]).fence = "a-newer-worker-now-owns-the-lease"
        return local_prd(source, language), {"tokens": 0}
    monkeypatch.setattr(worker, "generate", old_worker)
    assert asyncio.run(run_once(app.state.sessions))
    assert current(client, sid)["prd"] is None


def test_truncated_model_usage_is_recorded_without_repeating_the_same_request(owner, monkeypatch):
    from app import worker
    from app.ai import ModelResponseError

    app, client, sid = prepare(owner)
    queued = command(client, sid, "jobs", {"kind": "prd_generation", "mode": "local", "language": "en"}).json()
    async def truncated(*args):
        raise ModelResponseError("MODEL_OUTPUT_TRUNCATED", {
            "tokens": 12000, "reasoning_tokens": 11000, "finish_reason": "length"})
    monkeypatch.setattr(worker, "generate", truncated)
    assert asyncio.run(run_once(app.state.sessions))
    with app.state.sessions() as db:
        job = db.get(Job, queued["job_id"])
        assert job.state == "failed" and job.attempts == 1
        assert job.error == "MODEL_OUTPUT_TRUNCATED"
        assert job.usage["tokens"] == 12000
    assert not asyncio.run(run_once(app.state.sessions))
    assert current(client, sid)["prd"] is None


def test_recovered_json_failure_keeps_total_usage_and_clears_old_error(owner, monkeypatch):
    from app import worker
    from app.ai import ModelResponseError, local_prd

    app, client, sid = prepare(owner)
    queued = command(client, sid, "jobs", {"kind": "prd_generation", "mode": "local", "language": "en"}).json()
    calls = []
    async def recover(kind, source, language, mode):
        calls.append(kind)
        if len(calls) == 1:
            raise ModelResponseError("MODEL_JSON_INVALID", {"tokens": 42})
        return local_prd(source, language), {"tokens": 42}
    monkeypatch.setattr(worker, "generate", recover)
    assert asyncio.run(run_once(app.state.sessions))
    with app.state.sessions.begin() as db:
        job = db.get(Job, queued["job_id"])
        assert job.state == "queued" and job.error == "MODEL_JSON_INVALID"
        job.next_run = 0
    assert asyncio.run(run_once(app.state.sessions))
    with app.state.sessions() as db:
        job = db.get(Job, queued["job_id"])
        assert job.state == "succeeded" and job.error == ""
        assert job.usage["tokens"] == 84
    assert current(client, sid)["prd"] is not None


def test_worker_lease_outlasts_the_total_provider_deadline(owner):
    from app.ai import MODEL_RESPONSE_TIMEOUT
    from app.worker import claim_job

    app, client, sid = prepare(owner)
    queued = command(client, sid, "jobs", {"kind": "prd_generation", "mode": "local", "language": "en"}).json()
    before = time.time()
    assert claim_job(app.state.sessions)[0] == queued["job_id"]
    with app.state.sessions() as db:
        job = db.get(Job, queued["job_id"])
        assert job.lease_until >= before + MODEL_RESPONSE_TIMEOUT + 60


def test_describe_once_classify_organize_review_then_match_controls(owner):
    app, client = owner
    sid = client.post("/api/v1/systems", json={"name": "Single-entry workflow"}).json()["system"]["id"]
    blocks = {"goal": "Improve service", "functions": "Create tickets", "people": "Service department",
              "responsibility": "Service owner", "acceptance": "Ticket lifecycle only"}
    command(client, sid, "context-draft", {"blocks": blocks}, method="put")
    assert current(client, sid)["controls"] == []
    command(client, sid, "classification-confirmations", {"mode": "questionnaire", "answers": {
        "Q1": "L2", "Q2": "L2", "Q3": "L2", "Q4": "L1", "Q5": "L2"}})
    assert current(client, sid)["controls"] == []
    command(client, sid, "jobs", {"kind": "context_organization", "mode": "local", "language": "en"})
    assert asyncio.run(run_once(app.state.sessions))
    organized = current(client, sid)
    assert organized["controls"] == []
    assert organized["system"]["draft"]["blocks"] == blocks
    proposal = organized["system"]["draft"]["proposal"]
    proposal["summary"] = "Reviewed service goal"
    edited = command(client, sid, "context-draft", {"proposal": proposal}, method="put").json()
    assert edited["system"]["draft"]["blocks"] == blocks
    assert edited["controls"] == []
    confirmed = command(client, sid, "context-confirmations", {"context": proposal}).json()
    assert confirmed["system"]["status"] == "CONTROL_REVIEW"
    assert len([item for item in confirmed["controls"] if item["included"]]) == 10


def test_raw_edits_require_explicit_review_without_erasing_the_proposal(owner):
    _, client, sid = prepare(owner)
    command(client, sid, "context-draft", {"proposal": BRIEF}, method="put")
    blocks = {"goal": "Updated source goal", "functions": "Create tickets"}
    changed = command(client, sid, "context-draft", {"blocks": blocks}, method="put").json()
    assert changed["system"]["draft"]["proposal"] == BRIEF
    assert changed["system"]["draft"]["proposal_stale"] is True
    failure = command(client, sid, "context-confirmations", {"context": BRIEF}, expected=409)
    assert failure.json()["code"] == "CONTEXT_STALE"
    assert command(client, sid, "jobs", {"kind": "prd_generation", "mode": "local", "language": "en"}, expected=409).json()["code"] == "CONTEXT_STALE"
    corrected = {**BRIEF, "summary": "Updated source goal"}
    saved = command(client, sid, "context-draft", {
        "proposal": corrected, "acknowledge_source_change": True}, method="put").json()
    assert saved["system"]["draft"]["blocks"] == blocks
    assert saved["system"]["draft"]["proposal_stale"] is False
    assert command(client, sid, "context-confirmations", {"context": corrected}).json()["system"]["status"] == "CONTROL_REVIEW"


def test_raw_only_acknowledgment_cannot_bypass_stale_review(owner):
    _, client, sid = prepare(owner)
    changed = command(client, sid, "context-draft", {
        "blocks": {"goal": "Changed source"}, "acknowledge_source_change": True}, method="put").json()
    assert changed["system"]["draft"]["proposal_stale"] is True
    assert command(client, sid, "context-confirmations", {"context": BRIEF}, expected=409).json()["code"] == "CONTEXT_STALE"


def test_wrong_baseline_hash_is_not_an_approval(owner):
    _, client, _vendor, sid = submit_supplier(owner)
    state = current(client, sid)
    decisions = {f["id"]: {"decision": "accept", "reason": "Owner will verify evidence"} for f in state["report"]["data"]["findings"]}
    command(client, sid, "review-decisions", {"decisions": decisions, "exception_reason": "No unresolved classification exceptions"})
    state = command(client, sid, "baselines").json()
    response = client.post(f"/api/v1/baselines/{state['baseline']['id']}/confirmations", json={
        "version": state["system"]["version"], "content_hash": "not-the-current-content"})
    assert response.status_code == 409
    assert not current(client, sid)["baseline"]["confirmations"]
