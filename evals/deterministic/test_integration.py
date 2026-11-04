"""Regression coverage for integration boundaries, role scope and CSV round trips."""

import base64
import csv
import io
import time
from fastapi.testclient import TestClient
from sqlalchemy import select
from app.db import AccountPolicy, CsvBatch, User
from app.intake.assessment import evaluate
from app.intake.questionnaire import schema
from app.intake.service import facts
from conftest import register
from test_workflow import command, current, invite_supplier, prepare


def unknown_answers():
    return {
        q["id"]: {"value": ["unknown"] if q["kind"] == "multi" else "unknown"} for q in schema()["questions"]
    }


def test_manual_classification_can_skip_draft_questionnaire(owner):
    _, client = owner
    sid = client.post("/api/v1/systems", json={"name": "Manual intake"}).json()["system"]["id"]
    assert save_questionnaire(client, sid, unknown_answers()).status_code == 200
    response = command(
        client,
        sid,
        "classification-confirmations",
        {"mode": "manual", "level": "L2", "reason": "Documented provisional decision", "answers": {}},
    )
    assert response.json()["system"]["classification"]["effective_level"] == "L2"
    assert response.json()["system"]["status"] == "CONTEXT_REVIEW"


def test_questionnaire_schema_has_bilingual_labels():
    questions = schema()["questions"]
    assert len(questions) == 19
    for question in questions:
        assert question["title"] and question["title_en"]
        for option in question["options"]:
            assert option["label"] and option["label_en"]
        for field in question["fields"]:
            assert field["label"] and field["label_en"]


def test_legacy_import_is_repeatable_and_preserves_existing_systems(owner, tmp_path):
    import sqlite3
    from app.import_legacy import import_database
    from app.db import ImportedRecord

    app, client = owner
    sid = client.post("/api/v1/systems", json={"name": "Existing system"}).json()["system"]["id"]
    before = current(client, sid)["system"]
    source = tmp_path / "legacy.db"
    with sqlite3.connect(source) as db:
        db.executescript("""
            CREATE TABLE users (id TEXT, username TEXT, display_name TEXT, password_hash TEXT, active INT, must_change_password INT);
            CREATE TABLE assessments (id TEXT);
            CREATE TABLE projects (id TEXT);
            CREATE TABLE project_memberships (project_id TEXT);
            CREATE TABLE audit_events (id TEXT, action TEXT);
            CREATE TABLE user_global_roles (user_id TEXT);
            INSERT INTO users VALUES ('old-user', 'legacy-user', 'Legacy user', 'preserved-hash', 1, 1);
            INSERT INTO user_global_roles VALUES ('old-user');
            INSERT INTO audit_events VALUES ('event', 'account.created');
        """)
    assert import_database(source, app.state.sessions)["users"] == 1
    assert import_database(source, app.state.sessions) == {"already_imported": True}
    assert current(client, sid)["system"] == before
    with app.state.sessions() as db:
        policy = db.scalar(select(AccountPolicy).where(AccountPolicy.username == "legacy-user"))
        assert policy.admin and policy.must_change_password and policy.active
        assert db.get(User, policy.user_id).password_hash == "preserved-hash"
        archives = list(db.scalars(select(ImportedRecord)))
        assert all("password_hash" not in item.data for item in archives)


def save_questionnaire(client, sid, answers, action="draft"):
    data = client.get(f"/api/v1/systems/{sid}/questionnaire").json()
    return client.put(
        f"/api/v1/systems/{sid}/questionnaire",
        json={
            "version": current(client, sid)["system"]["version"],
            "questionnaire_revision": data["version"],
            "questionnaire_version": schema()["questionnaire_version"],
            "mapping_version": schema()["mapping_version"],
            "answers": answers,
            "action": action,
        },
    )


def new_member(app, admin, name):
    created = admin.post("/api/v1/admin/users", json={"username": name, "name": name})
    assert created.status_code == 200, created.text
    uid = created.json()["id"]
    client = TestClient(app, client=(name + '-test-client', 50000))
    signed = client.post(
        "/api/v1/auth/login", json={"email": name, "password": created.json()["temporary_password"]}
    )
    assert signed.status_code == 200
    client.headers["X-CSRF-Token"] = signed.json()["csrf"]
    assert client.get("/api/v1/systems").status_code == 403
    assert (
        client.post(
            "/api/v1/auth/password",
            json={
                "current_password": created.json()["temporary_password"],
                "password": "New-Test-Passphrase",
            },
        ).status_code
        == 200
    )
    return uid, client


def login(client, username):
    response = client.post("/api/v1/auth/login", json={"email": username, "password": "New-Test-Passphrase"})
    assert response.status_code == 200, response.text
    client.headers["X-CSRF-Token"] = response.json()["csrf"]


def project_setup(owner):
    app, admin = owner
    users = {}
    for role in ['manager', 'operator', 'reviewer', 'viewer']:
        uid, client = new_member(app, admin, role)
        assert admin.put(f'/api/v1/people/{uid}/role', json={'role': role}).status_code == 200
        login(client, role)
        users[role] = (uid, client)
    manager = users['manager'][1]
    result = manager.post('/api/v1/systems', json={'name': 'Direct assessment'})
    assert result.status_code == 200, result.text
    sid = result.json()['system']['id']
    for role in ['operator', 'reviewer', 'viewer']:
        uid, client = users[role]
        version = current(admin, sid)['system']['version']
        assert admin.put(f'/api/v1/systems/{sid}/members/{uid}', json={'role': role, 'version': version}).status_code == 200
        login(client, role)
    return app, admin, None, users, sid


def test_project_roles_are_scoped_and_admin_has_business_access(owner):
    app, admin, pid, users, sid = project_setup(owner)
    assert admin.get(f"/api/v1/systems/{sid}").status_code == 200
    operator, reviewer, viewer = (users[r][1] for r in ["operator", "reviewer", "viewer"])
    assert len(viewer.get("/api/v1/systems").json()) == 1
    assert save_questionnaire(operator, sid, unknown_answers(), "submit").status_code == 200
    assert save_questionnaire(viewer, sid, {}).status_code in (403, 404)
    assert command(operator, sid, "prd-approval", expected=403).status_code == 403
    assert (
        command(
            reviewer, sid, "context-draft", {"blocks": {"goal": "unauthorized"}}, method="put", expected=403
        ).status_code
        == 403
    )
    outsider = TestClient(app)
    register(outsider, "other@example.test")
    assert outsider.get(f"/api/v1/systems/{sid}").status_code == 404
    assert (
        outsider.put(
            f"/api/v1/people/{users['operator'][0]}/role", json={"role": "manager"}
        ).status_code
        == 404
    )
    assert operator.get("/api/v1/admin/audits").status_code == 403


def test_role_revocation_invalidates_existing_session(owner):
    _, admin, pid, users, sid = project_setup(owner)
    uid, viewer = users["viewer"]
    assert viewer.get(f"/api/v1/systems/{sid}").status_code == 200
    assert admin.put(f"/api/v1/systems/{sid}/members/{uid}", json={"role": '', 'version': current(admin, sid)['system']['version']}).status_code == 200
    assert viewer.get("/api/v1/auth/session").status_code == 401
    login(viewer, "viewer")
    assert viewer.get(f"/api/v1/systems/{sid}").status_code == 404


def test_last_admin_cannot_be_disabled(owner):
    _, client = owner
    uid = client.get("/api/v1/auth/session").json()["user"]["id"]
    assert client.put(f"/api/v1/admin/users/{uid}", json={"active": False}).status_code == 409
    assert client.get("/api/v1/auth/session").status_code == 200


def test_questionnaire_preserves_original_notes_and_invalidates_obsolete_scope(owner):
    _, client, sid = prepare(owner)
    old = current(client, sid)
    response = save_questionnaire(client, sid, unknown_answers(), "submit")
    assert response.status_code == 200, response.text
    after = current(client, sid)
    assert after["system"]["draft"]["blocks"] == old["system"]["draft"]["blocks"]
    assert after["system"]["status"] == "CLASSIFYING"
    assert not after["system"]["context_revision_id"]
    assert save_questionnaire(client, sid, {}).status_code == 409
    command(client, sid, "questionnaire/return", {"reason": "Clarify deployment"})
    assert save_questionnaire(client, sid, unknown_answers()).status_code == 200


def test_questionnaire_normalizes_inactive_fields_and_duration_boundaries():
    answers = unknown_answers()
    answers["DATA-01"] = {"value": "no"}
    answers["DATA-04"] = {"value": ["health"]}
    answers["BIZ-02"] = {"value": "duration", "details": {"amount": "4", "unit": "hours"}}
    cleaned = evaluate(answers, True)
    assert "DATA-04" not in cleaned["answers"]
    assert not any(t["code"] == "data.sensitive.health" for t in cleaned["tags"])
    assert facts(cleaned["answers"])["Q2"] == "L2"
    answers["BIZ-02"]["details"]["amount"] = "24"
    assert facts(evaluate(answers, True)["answers"])["Q2"] == "L1"


def csv_text(rows):
    output = io.StringIO(newline="")
    csv.writer(output).writerows(rows)
    return base64.b64encode(output.getvalue().encode("utf-8-sig")).decode()


def test_questionnaire_csv_preview_is_atomic_and_rejects_wrong_identity_and_stale_answers(owner):
    _, client = owner
    sid = client.post("/api/v1/systems", json={"name": "CSV intake"}).json()["system"]["id"]
    assert save_questionnaire(client, sid, unknown_answers()).status_code == 200
    prefix = f"/api/v1/systems/{sid}/csv-forms"
    issued = client.post(
        prefix,
        json={
            "version": current(client, sid)["system"]["version"],
            "kind": "questionnaire",
            "supplier_id": "supplier-A",
            "slots": 3,
        },
    )
    assert issued.status_code == 200, issued.text
    form = issued.json()["id"]
    route = f"{prefix}/{form}"
    rows = list(csv.reader(io.StringIO(client.get(route + "/template").text.lstrip("\ufeff"))))
    rows[1][-1] = "yes"
    preview = client.post(route + "/preview", json={"content_base64": csv_text(rows)})
    assert preview.status_code == 200, preview.text
    assert preview.json()["can_confirm"], preview.text
    assert (
        client.get(f"/api/v1/systems/{sid}/questionnaire").json()["snapshot"]["answers"]["NET-01"]["value"]
        == "unknown"
    )
    rows[1][2] = "wrong-supplier"
    invalid = client.post(route + "/preview", json={"content_base64": csv_text(rows)}).json()
    assert not invalid["can_confirm"]
    assert (
        client.post(
            route + "/confirm",
            json={"version": current(client, sid)["system"]["version"], "batch_id": invalid["batch_id"]},
        ).status_code
        == 422
    )
    assert save_questionnaire(client, sid, unknown_answers()).status_code == 200
    assert (
        client.post(
            route + "/confirm",
            json={
                "version": current(client, sid)["system"]["version"],
                "batch_id": preview.json()["batch_id"],
            },
        ).status_code
        == 409
    )


def test_supplier_prd_csv_import_feeds_existing_submission_flow(owner):
    _, customer, vendor, sid = invite_supplier(owner)
    prefix = f"/api/v1/systems/{sid}/csv-forms"
    form = vendor.post(
        prefix, json={"version": current(vendor, sid)["system"]["version"], "kind": "prd"}
    ).json()["id"]
    route = f"{prefix}/{form}"
    rows = list(csv.reader(io.StringIO(vendor.get(route + "/template").text.lstrip("\ufeff"))))
    values = {
        "implementation_status": "yes",
        "duration_workdays": "5",
        "owner_name": "Supplier owner",
        "implementation_plan": "Implement and test",
    }
    for row in rows[1:]:
        row[-1] = values.get(row[5], "")
    preview = vendor.post(route + "/preview", json={"content_base64": csv_text(rows)}).json()
    assert preview["can_confirm"], preview
    assert customer.post(route + "/confirm", json={"batch_id": preview["batch_id"]}).status_code == 403
    response = vendor.post(
        route + "/confirm",
        json={"batch_id": preview["batch_id"], "version": current(vendor, sid)["system"]["version"]},
    )
    assert response.status_code == 200, response.text
    saved = response.json()
    assert saved["system"]["status"] == "VENDOR_FILLING"
    assert len(saved["round"]["draft"]) == len(saved["prd"]["data"]["requirements"])
    result = command(
        vendor,
        sid,
        "supplier-submit",
        {
            "round_version": saved["round"]["version"],
            "answers": saved["round"]["draft"],
            "mode": "local",
            "language": "en",
        },
    ).json()
    assert result["system"]["status"] == "ANALYZING"


def test_csv_expiry_is_enforced(owner):
    app, _, vendor, sid = invite_supplier(owner)
    prefix = f"/api/v1/systems/{sid}/csv-forms"
    fid = vendor.post(
        prefix, json={"kind": "prd", "version": current(vendor, sid)["system"]["version"]}
    ).json()["id"]
    route = f"{prefix}/{fid}"
    rows = list(csv.reader(io.StringIO(vendor.get(route + "/template").text.lstrip("\ufeff"))))
    for row in rows[1:]:
        row[-1] = {"implementation_status": "no", "limitations": "Cannot deliver"}.get(row[5], "")
    batch = vendor.post(route + "/preview", json={"content_base64": csv_text(rows)}).json()
    with app.state.sessions() as db:
        db.get(CsvBatch, batch["batch_id"]).expires_at = time.time() - 1
        db.commit()
    assert (
        vendor.post(
            route + "/confirm",
            json={"batch_id": batch["batch_id"], "version": current(vendor, sid)["system"]["version"]},
        ).status_code
        == 409
    )


def test_imported_password_hash_and_disabled_account(owner):
    import hashlib
    import json

    app, client = owner
    password = "Imported-passphrase"
    salt = b"1234567890123456"
    encoded = json.dumps(
        {
            "algorithm": "scrypt",
            "n": 16384,
            "r": 8,
            "p": 1,
            "salt": salt.hex(),
            "digest": hashlib.scrypt(password.encode(), salt=salt, n=16384, r=8, p=1).hex(),
        }
    )
    with app.state.sessions() as db:
        user = db.scalar(select(User).where(User.email == "owner@example.test"))
        user.password_hash = encoded
        db.add(AccountPolicy(user_id=user.id, username="imported", active=True, admin=True))
        db.commit()
    second = TestClient(app)
    assert (
        second.post("/api/v1/auth/login", json={"email": "imported", "password": password}).status_code == 200
    )
    with app.state.sessions() as db:
        p = db.scalar(select(AccountPolicy).where(AccountPolicy.username == "imported"))
        p.active = False
        db.commit()
    assert second.get("/api/v1/auth/session").status_code == 401


def test_manager_control_edits_remain_scoped_and_record_contribution(owner):
    from app import access
    from app.db import Assignment, System
    from app.domain import DomainError
    import pytest

    app, admin, pid, users, sid = project_setup(owner)
    with app.state.sessions() as db:
        system = db.get(System, sid)
        manager = db.get(User, users['manager'][0])
        for action in ('control.custom_added', 'control.selection_changed'):
            access.require_action(db, manager, system, action)
        assert db.get(Assignment, sid) is None
        assert access.capabilities(db, manager, system) == {'read', 'edit', 'review', 'manage'}
        for action in ('context.draft_saved', 'prd.approved', 'baseline.finalized'):
            access.require_action(db, manager, system, action)
        for role in ('viewer', 'reviewer'):
            with pytest.raises(DomainError):
                access.require_action(db, db.get(User, users[role][0]), system, 'control.custom_added')
        with pytest.raises(DomainError):
            access.require_admin(db, manager)
        system.org_id = 'other-organization'
        with pytest.raises(DomainError):
            access.require_action(db, manager, system, 'control.custom_added')
