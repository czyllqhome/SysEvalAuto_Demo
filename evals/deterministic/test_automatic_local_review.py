"""Local owner review is immediately available without paid-model or approval work."""

from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app import ai, service
from app.db import AccountPolicy, AssessmentMember, Audit, Job, OrganizationRole, Report, Submission, User
from app.domain import DomainError
from conftest import register
from test_workflow import command, current, invite_supplier


def legacy_submission(owner, monkeypatch):
    app, customer, supplier, sid = invite_supplier(owner)
    detail = current(supplier, sid)
    answers = {r['id']: {'implementation_status': 'yes'} for r in detail['prd']['data']['requirements']}
    target = next(r for r in detail['prd']['data']['requirements'] if r['source_control_ids'])
    answers[target['id']] = {'implementation_status': 'no', 'limitations': 'Keep the submitted explanation'}
    with monkeypatch.context() as legacy:
        legacy.setattr(service, 'prepare_local_review', lambda *args, **kwargs: None)
        submitted = command(supplier, sid, 'supplier-submit', {
            'round_version': detail['round']['version'], 'answers': answers}).json()
    assert submitted['report'] is None
    return app, customer, supplier, sid, submitted


def test_legacy_local_review_is_versioned_idempotent_and_does_not_change_evidence(owner, monkeypatch):
    app, customer, supplier, sid, before = legacy_submission(owner, monkeypatch)
    path = f'/api/v1/systems/{sid}/local-review'
    body = {'version': before['system']['version'], 'round_id': before['round']['id'],
            'submission_id': before['round']['submitted_id'], 'language': 'en'}
    for invalid in [{'version': -1}, {'round_id': 'stale'}, {'submission_id': 'stale'}]:
        response = customer.post(path, json={**body, **invalid})
        assert response.status_code == 409
        assert current(customer, sid)['report'] is None
    response = customer.post(path, json=body, headers={'Idempotency-Key': 'prepare-review'})
    assert response.status_code == 200, response.text
    after = response.json()
    assert after['report']['mode'] == 'local'
    assert after['report']['decisions'] == {} and not after['report']['reviewed']
    assert after['system']['status'] == 'RESULT_REVIEW' and after['baseline'] is None
    assert after['supplier_review'] == before['supplier_review']
    assert customer.post(path, json=body, headers={'Idempotency-Key': 'prepare-review'}).json() == after
    repeated = command(customer, sid, 'local-review', {
        'round_id': body['round_id'], 'submission_id': body['submission_id']}).json()
    assert repeated['report']['id'] == after['report']['id']
    assert supplier.post(path, json={**body, 'version': repeated['system']['version']}).status_code == 404
    with TestClient(app) as outsider:
        register(outsider, 'outside-local-review@example.test')
        assert outsider.post(path, json=body).status_code == 404
    with app.state.sessions() as db:
        assert db.scalar(select(func.count()).select_from(Report).where(Report.system_id == sid)) == 1
        assert not list(db.scalars(select(Job).where(Job.system_id == sid, Job.kind == 'impact_analysis')))
        assert db.get(Submission, body['submission_id']).data == before['round']['draft']
        event = db.scalar(select(Audit).where(Audit.system_id == sid, Audit.action == 'impact_analysis.completed'))
        assert event.detail['automatic'] and event.detail['mode'] == 'local' and event.detail['source_hash']


def test_local_preparation_retains_reviewer_permissions_and_blocks_viewers(owner, monkeypatch):
    app, customer, _, sid, before = legacy_submission(owner, monkeypatch)
    customer_org = customer.get('/api/v1/auth/session').json()['user']['org_id']
    with TestClient(app) as reviewer:
        identity = register(reviewer, 'local-reviewer@example.test')['user']
        with app.state.sessions.begin() as db:
            user = db.get(User, identity['id'])
            user.org_id, user.role = customer_org, 'member'
            db.merge(AccountPolicy(user_id=user.id, admin=False))
            db.merge(OrganizationRole(user_id=user.id, role='reviewer'))
            db.add(AssessmentMember(system_id=sid, user_id=user.id, role='viewer'))
        body = {'round_id': before['round']['id'], 'submission_id': before['round']['submitted_id']}
        assert reviewer.post(f'/api/v1/systems/{sid}/local-review', json={
            **body, 'version': before['system']['version']}).status_code == 404
        with app.state.sessions.begin() as db:
            db.get(AssessmentMember, (sid, identity['id'])).role = 'reviewer'
        result = command(reviewer, sid, 'local-review', body).json()
        assert 'review' in result['permissions'] and 'edit' not in result['permissions']
        assert result['report']['mode'] == 'local'


def test_failed_local_preparation_rolls_back_submission_atomically(owner, monkeypatch):
    app, _, supplier, sid = invite_supplier(owner)
    before = current(supplier, sid)

    def fail(*args):
        raise DomainError('INVALID_MODEL_OUTPUT')

    monkeypatch.setattr(ai, 'local_impact', fail)
    command(supplier, sid, 'supplier-submit', {'round_version': before['round']['version'],
        'answers': {r['id']: {'implementation_status': 'yes'} for r in before['prd']['data']['requirements']}}, expected=422)
    assert current(supplier, sid) == before
    with app.state.sessions() as db:
        assert db.scalar(select(func.count()).select_from(Submission)) == 0
        assert db.scalar(select(func.count()).select_from(Report)) == 0
