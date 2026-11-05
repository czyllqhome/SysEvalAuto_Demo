"""Restoring a manual exclusion keeps pinned sources, audit and command boundaries."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.db import AccountPolicy, AssessmentMember, Audit, Control, OrganizationRole, Selection
from conftest import register
from test_workflow import command, current, generate_prd, prepare


@pytest.mark.parametrize("bulk", [False, True])
def test_restore_manual_exclusion_preserves_other_decisions_sources_and_reason_history(owner, bulk):
    app, client, sid = prepare(owner)
    initial = current(client, sid)
    target = next(c for c in initial["controls"] if c["included"])
    if bulk:
        command(client, sid, "controls/exclude-domains", {"domains": [target["domain"]], "reason": "原人工排除理由"})
    else:
        command(client, sid, "controls", {"control_id": target["id"], "included": False, "reason": "原人工排除理由"})
    before = current(client, sid)
    with app.state.sessions() as db:
        row = db.scalar(select(Selection).where(Selection.system_id == sid, Selection.control_id == target["id"]))
        selection_id, snapshot = row.id, row.snapshot
        catalog_text = db.get(Control, target["id"]).translations
    body = {"version": before["system"]["version"], "control_id": target["id"], "included": True, "reason": ""}
    response = client.post(f"/api/v1/systems/{sid}/controls", json=body, headers={"Idempotency-Key": "restore"})
    assert response.status_code == 200, response.text
    after = response.json()
    assert after["system"]["version"] == before["system"]["version"] + 1
    for key in ("revision", "classification", "context_revision_id", "status"):
        assert after["system"][key] == before["system"][key]
    for control in after["controls"]:
        previous = next(c for c in before["controls"] if c["id"] == control["id"])
        assert control == ({**previous, "included": True, "reason": "", "origin": "manual"}
                           if control["id"] == target["id"] else previous)
    assert client.post(f"/api/v1/systems/{sid}/controls", json=body,
                       headers={"Idempotency-Key": "restore"}).json() == after
    with app.state.sessions() as db:
        assert db.get(Selection, selection_id).snapshot == snapshot
        assert db.get(Control, target["id"]).translations == catalog_text
        events = list(db.scalars(select(Audit).where(Audit.system_id == sid,
                                                   Audit.action == "control.exclusion_withdrawn")))
        assert len(events) == 1
        assert events[0].detail == {"revision": before["system"]["revision"], "control_id": target["id"],
                                    "previous_reason": "原人工排除理由"}


def test_restore_rejects_stale_versions_other_organizations_and_read_only_access(owner):
    app, client, sid = prepare(owner)
    target = next(c for c in current(client, sid)["controls"] if c["included"])
    command(client, sid, "controls", {"control_id": target["id"], "included": False, "reason": "Keep this reason"})
    before = current(client, sid)
    body = {"version": before["system"]["version"], "control_id": target["id"], "included": True, "reason": ""}
    path = f"/api/v1/systems/{sid}/controls"
    assert client.post(path, json={**body, "version": body["version"] - 1}).status_code == 409
    with TestClient(app) as outsider:
        register(outsider, "outside@example.test")
        assert outsider.post(path, json=body).status_code == 404
    uid = client.get("/api/v1/auth/session").json()["user"]["id"]
    with app.state.sessions.begin() as db:
        db.merge(AccountPolicy(user_id=uid, admin=False))
        db.merge(OrganizationRole(user_id=uid, role="viewer"))
        db.add(AssessmentMember(system_id=sid, user_id=uid, role="viewer"))
    assert client.post(path, json=body).status_code == 404
    assert current(client, sid)["controls"] == before["controls"]
    with app.state.sessions() as db:
        assert db.scalar(select(Audit).where(Audit.system_id == sid,
                                             Audit.action == "control.exclusion_withdrawn")) is None


def test_restore_cannot_change_a_scope_after_prd_generation(owner):
    app, client, sid = generate_prd(owner)
    before = current(client, sid)
    target = before["controls"][0]
    command(client, sid, "controls", {"control_id": target["id"], "included": True, "reason": ""}, expected=409)
    assert current(client, sid) == before
    with app.state.sessions() as db:
        assert db.scalar(select(Audit).where(Audit.system_id == sid,
                                             Audit.action == "control.exclusion_withdrawn")) is None
