"""Real HTTP delivery journeys with isolated databases and synthetic attachments."""
import base64
import io
import json
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import select

from app.db import Baseline, System
from app.delivery_models import DeliveryBatch, EvidenceAttachment
from app.domain import DomainError
from app.evidence_service import validate_file
from conftest import register
from test_workflow import command, current, submit_supplier


def finalized(owner):
    app, client, vendor, sid = submit_supplier(owner)
    state = current(client, sid)
    command(client, sid, 'review-decisions', {'decisions': {f['id']: {'decision': 'accept', 'reason': 'Verify delivery'} for f in state['report']['data']['findings']}, 'exception_reason': 'Reviewed'})
    baseline = command(client, sid, 'baselines').json()['baseline']
    for person in (client, vendor):
        r = person.post(f"/api/v1/baselines/{baseline['id']}/confirmations", json={'version': current(person, sid)['system']['version'], 'content_hash': baseline['content_hash']})
        assert r.status_code == 200, r.text
    r = client.post(f"/api/v1/baselines/{baseline['id']}/finalize", json={'version': current(client, sid)['system']['version']})
    assert r.status_code == 200, r.text
    r = client.post(f'/api/v1/systems/{sid}/delivery-batches', json={'version': current(client, sid)['system']['version']}, headers={'Idempotency-Key': 'initialize'})
    assert r.status_code == 200, r.text
    return app, client, vendor, sid, baseline, r.json()


def upload(vendor, item, filename='proof.txt', content=b'Permission denied: expected result'):
    meta = {'version': item['version'], 'filename': filename, 'description': 'Denied path verified',
            'environment': 'production', 'system_version': 'v2', 'collected_on': datetime.now(timezone.utc).date().isoformat()}
    r = vendor.post(f"/api/v1/delivery-items/{item['id']}/attachments", content=content,
                    headers={'X-Evidence-Metadata': base64.b64encode(json.dumps(meta).encode()).decode(),
                             'Content-Type': 'application/octet-stream', 'Idempotency-Key': 'upload-' + item['id']})
    assert r.status_code == 200, r.text
    return r.json()


def submit(vendor, batch, item):
    result = upload(vendor, item)
    attachment = result['attachment']
    item = next(i for i in result['items'] if i['id'] == item['id'])
    draft = {**attachment['meta'], 'attachment_ids': [attachment['id']],
             'criteria_evidence_map': {c['id']: [attachment['id']] for c in item['criteria']}}
    r = vendor.put(f"/api/v1/delivery-items/{item['id']}/draft", json={'version': item['version'], 'draft': draft})
    assert r.status_code == 200, r.text
    item = next(i for i in r.json()['items'] if i['id'] == item['id'])
    r = vendor.post(f"/api/v1/delivery-items/{item['id']}/submissions", json={'version': item['version'], 'expected_source_hash': batch['source_hash']})
    assert r.status_code == 200, r.text
    return next(i for i in r.json()['items'] if i['id'] == item['id'])


def review(client, batch, item, decision='PASS', key=None):
    sub = item['submissions'][-1]
    body = {'version': item['version'], 'source_hash': batch['source_hash'], 'submission_hash': sub['manifest_hash'],
            'decision': decision, 'reason': 'Inspected actual target version and evidence',
            'criteria_results': [{'criterion_id': c['id'], 'result': 'PASS', 'attachment_ids': sub['payload']['draft']['attachment_ids']} for c in item['criteria']]}
    return client.post(f"/api/v1/delivery-submissions/{sub['id']}/reviews", json=body,
                       headers={'Idempotency-Key': key} if key else {})


def test_delivery_rounds_permissions_and_preserved_baseline(owner):
    app, client, vendor, sid, baseline, batch = finalized(owner)
    assert len(batch['items']) == 11
    item = submit(vendor, batch, batch['items'][0])
    assert review(vendor, batch, item).status_code == 403
    outsider = TestClient(app)
    register(outsider, 'other-delivery@example.test')
    file_id = item['submissions'][0]['payload']['attachments'][0]['id']
    assert outsider.get(f'/api/v1/evidence-attachments/{file_id}/content').status_code == 404
    assert client.get(f'/api/v1/evidence-attachments/{file_id}/content').content == b'Permission denied: expected result'
    r = review(client, batch, item, 'NEEDS_MORE_EVIDENCE', 'review-once')
    assert r.status_code == 200, r.text
    assert review(client, batch, item, 'NEEDS_MORE_EVIDENCE', 'review-once').json() == r.json()
    assert review(client, batch, item, 'PASS', 'review-once').status_code == 409
    revised = next(i for i in r.json()['items'] if i['id'] == item['id'])
    r = vendor.post(f"/api/v1/delivery-items/{item['id']}/submissions", json={'version': revised['version'], 'expected_source_hash': batch['source_hash']})
    assert r.status_code == 200, r.text
    revised = next(i for i in r.json()['items'] if i['id'] == item['id'])
    assert len(revised['submissions']) == 2
    r = review(client, batch, revised)
    assert r.status_code == 200, r.text
    assert client.post(f"/api/v1/delivery-batches/{batch['id']}/complete", json={'version': r.json()['version']}).status_code == 409
    with app.state.sessions() as db:
        original = db.get(Baseline, baseline['id'])
        assert original.content_hash == baseline['content_hash']
        assert db.get(System, sid).status == 'PENDING_DEVELOPMENT'
        assert db.scalar(select(EvidenceAttachment)).content.startswith(b'Permission denied')


def test_complete_reopen_and_source_invalidation(owner):
    app, client, vendor, sid, _, batch = finalized(owner)
    for item in batch['items']:
        result = review(client, batch, submit(vendor, batch, item))
        assert result.status_code == 200, result.text
    state = result.json()
    r = client.post(f"/api/v1/delivery-batches/{batch['id']}/complete", json={'version': state['version']})
    assert r.status_code == 200, r.text
    assert r.json()['status'] == 'REVIEW_COMPLETE'
    item = r.json()['items'][0]
    r = client.post(f"/api/v1/delivery-items/{item['id']}/reopen", json={'version': item['version'], 'reason': 'New failure observed'})
    assert r.status_code == 200
    assert r.json()['status'] == 'ACTIVE'
    with app.state.sessions() as db:
        db.get(System, sid).revision += 1
        db.commit()
    assert client.get(f"/api/v1/delivery-batches/{batch['id']}").json()['status'] == 'SUPERSEDED'
    assert vendor.post(f"/api/v1/delivery-items/{item['id']}/submissions", json={'version': item['version'] + 1, 'expected_source_hash': batch['source_hash']}).status_code == 409


@pytest.mark.parametrize('name,data', [('proof.exe', b'MZ'), ('proof.png', b'not png'), ('proof.pdf', b'%PDF-fake'), ('proof.txt', b'\x00binary'), ('empty.txt', b'')])
def test_reject_invalid_evidence(name, data):
    with pytest.raises(DomainError):
        validate_file(name, data)


def test_image_validation_and_safe_preview():
    from app.evidence_service import preview
    output = io.BytesIO()
    Image.new('RGB', (10, 10), 'blue').save(output, format='PNG')
    assert validate_file('proof.png', output.getvalue())[1] == 'image/png'
    assert preview(output.getvalue()).startswith(b'\x89PNG')


def test_existing_supplier_evidence_review_retest_and_legacy_gate(owner):
    from test_existing_workflow import prepare_existing, publish, make_plan, evidence
    app, client, sid, project = prepare_existing(owner)
    gap, _, _ = publish(client, sid)
    account = client.post('/api/v1/admin/users', json={'name': 'Delivery vendor', 'username': 'delivery-proof', 'role': 'supplier'}).json()
    vendor = TestClient(app)
    login = vendor.post('/api/v1/auth/login', json={'email': 'delivery-proof', 'password': account['temporary_password']}).json()
    vendor.headers['X-CSRF-Token'] = login['csrf']
    password = 'Delivery-Proof-Password-123'
    assert vendor.post('/api/v1/auth/password', json={'current_password': account['temporary_password'], 'password': password}).status_code == 200
    login = vendor.post('/api/v1/auth/login', json={'email': 'delivery-proof', 'password': password}).json()
    vendor.headers['X-CSRF-Token'] = login['csrf']
    plan = make_plan(app, client, sid, gap, supplier_id=account['id'])
    command(client, sid, 'existing/approve', {'plan_id': plan['id'], 'content_hash': plan['content_hash']})
    r = vendor.post(f'/api/v1/supplier-remediations/{sid}/confirm', json={'version': current(client, sid)['system']['version'], 'plan_id': plan['id'], 'content_hash': plan['content_hash']})
    assert r.status_code == 200, r.text
    r = client.post(f'/api/v1/systems/{sid}/delivery-batches', json={'version': current(client, sid)['system']['version'], 'source_kind': 'plan', 'source_id': plan['id']})
    assert r.status_code == 200, r.text
    batch = r.json()
    command(client, sid, 'existing/complete-task', {'plan_id': plan['id']}, expected=409)
    assert vendor.get('/api/v1/delivery-batches').json()[0]['id'] == batch['id']
    item = submit(vendor, batch, batch['items'][0])
    r = review(client, batch, item)
    assert r.status_code == 200, r.text
    r = client.post(f"/api/v1/delivery-batches/{batch['id']}/complete", json={'version': r.json()['version']})
    assert r.status_code == 200, r.text
    state = client.get(f'/api/v1/systems/{sid}/existing').json()
    assert state['run']['gaps'][gap]['status'] == 'planned'
    assert state['run']['plans'][plan['id']]['status'] == 'awaiting_retest'
    eid = evidence(client, sid, system_version='v2')
    command(client, sid, 'existing/retest', {'plan_id': plan['id'], 'content_hash': plan['content_hash'], 'passed': False, 'reason': 'Denied path still fails', 'system_version': 'v2', 'evidence_ids': [eid]})
    state = client.get(f"/api/v1/delivery-batches/{batch['id']}").json()
    assert state['items'][0]['status'] == 'CHANGES_REQUESTED'
    assert state['status'] == 'ACTIVE'
    item = state['items'][0]
    r = vendor.post(f"/api/v1/delivery-items/{item['id']}/submissions", json={'version': item['version'], 'expected_source_hash': batch['source_hash']})
    assert r.status_code == 200, r.text
    r = review(client, batch, r.json()['items'][0])
    assert r.status_code == 200, r.text
    r = client.post(f"/api/v1/delivery-batches/{batch['id']}/complete", json={'version': r.json()['version']})
    assert r.status_code == 200, r.text
    command(client, sid, 'existing/retest', {'plan_id': plan['id'], 'content_hash': plan['content_hash'], 'passed': True, 'reason': 'Retested actual behavior', 'system_version': 'v2', 'evidence_ids': [eid]})
    assert client.get(f'/api/v1/systems/{sid}/existing').json()['run']['gaps'][gap]['status'] == 'closed'


def test_migration_adds_tables_without_rewriting_baselines(owner):
    import importlib.util
    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    from pathlib import Path
    app, _, _, _, baseline, _ = finalized(owner)
    path = Path(__file__).resolve().parents[2] / 'backend/migrations/versions/delivery_evidence.py'
    spec = importlib.util.spec_from_file_location('delivery_migration', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    with app.state.engine.begin() as connection:
        with Operations.context(MigrationContext.configure(connection)):
            module.upgrade()
            module.upgrade()
    with app.state.sessions() as db:
        assert db.get(Baseline, baseline['id']).content_hash == baseline['content_hash']
        assert db.scalar(select(DeliveryBatch)) is not None


def test_concurrent_reviews_publish_one_decision(owner):
    from concurrent.futures import ThreadPoolExecutor
    app, client, vendor, _, _, batch = finalized(owner)
    item = submit(vendor, batch, batch['items'][0])
    def attempt():
        separate = TestClient(app)
        separate.cookies.update(client.cookies)
        separate.headers['X-CSRF-Token'] = client.headers['X-CSRF-Token']
        return review(separate, batch, item).status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        statuses = list(pool.map(lambda _: attempt(), range(2)))
    assert sorted(statuses) == [200, 409]


def test_current_operator_can_review_without_gaining_original_review_rights(owner):
    from app.db import Assignment, Membership, Project, User
    from app import access
    from app.delivery_service import authorize
    app, client, vendor, sid, _, batch = finalized(owner)
    with app.state.sessions() as db:
        system = db.get(System, sid)
        project = Project(name='Delivery permissions', org_id=system.org_id)
        db.add(project)
        db.flush()
        operator = User(org_id=system.org_id, email='operator-delivery@test', name='Operator', role='member', password_hash='unused')
        db.add(operator)
        db.flush()
        db.add(Membership(project_id=project.id, user_id=operator.id, role='operator'))
        db.add(Assignment(system_id=sid, project_id=project.id, operator_id=operator.id, reviewer_ids=[], contributors=[operator.id]))
        db.flush()
        assert 'review' not in access.capabilities(db, operator, system)
        authorize(db, operator, db.get(DeliveryBatch, batch['id']), 'review')
        with pytest.raises(DomainError):
            access.require_action(db, operator, system, 'prd.approved')


def test_malformed_draft_and_missing_criterion_cannot_pass(owner):
    _, client, vendor, _, _, batch = finalized(owner)
    item = batch['items'][0]
    r = vendor.put(f"/api/v1/delivery-items/{item['id']}/draft", json={'version': item['version'], 'draft': {'description': {'bad': 'type'}}})
    assert r.status_code == 422
    item = submit(vendor, batch, item)
    sub = item['submissions'][-1]
    r = client.post(f"/api/v1/delivery-submissions/{sub['id']}/reviews", json={'version': item['version'], 'source_hash': batch['source_hash'], 'submission_hash': sub['manifest_hash'], 'decision': 'PASS', 'reason': 'Unsupported', 'criteria_results': []})
    assert r.status_code == 422
    assert client.get(f"/api/v1/delivery-items/{item['id']}").json()['status'] == 'IN_REVIEW'
