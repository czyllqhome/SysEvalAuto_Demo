import asyncio

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.db import AccountPolicy, ManagedSupplier, User
from app.worker import run_once
from conftest import register
from test_workflow import command, current, generate_prd


def login(client, username, password):
    response = client.post('/api/v1/auth/login', json={'email': username, 'password': password})
    assert response.status_code == 200, response.text
    client.headers['X-CSRF-Token'] = response.json()['csrf']
    return response.json()


def create_account(client, project, username, role):
    response = client.post('/api/v1/admin/users', json={'username': username, 'name': username,
                           'role': role})
    assert response.status_code == 200, response.text
    return response.json()


def setup(owner):
    app, client, sid = generate_prd(owner)
    project = None
    supplier = create_account(client, project, 'supplier_one', 'supplier')
    reviewer = create_account(client, project, 'reviewer_one', 'reviewer')
    with app.state.sessions() as db:
        from app.db import AssessmentMember
        db.add(AssessmentMember(system_id=sid, user_id=reviewer['id'], role='reviewer'))
        for account in (supplier, reviewer):
            db.get(AccountPolicy, account['id']).must_change_password = False
        db.commit()
    vendor = TestClient(app)
    login(vendor, 'supplier_one', supplier['temporary_password'])
    review_client = TestClient(app)
    login(review_client, 'reviewer_one', reviewer['temporary_password'])
    return app, client, sid, project, supplier, vendor, review_client


def test_project_supplier_full_response_and_independent_baseline(owner):
    app, client, sid, project, supplier, vendor, reviewer = setup(owner)
    assert vendor.get('/api/v1/systems').json() == []
    assert vendor.get(f'/api/v1/systems/{sid}').status_code == 404
    assert client.get(f'/api/v1/systems/{sid}/supplier-candidates').json() == [
        {'id': supplier['id'], 'name': 'supplier_one'}]
    result = command(client, sid, 'supplier-rounds', {'supplier_user_id': supplier['id']}).json()
    assert result['existing_supplier'] and not result['invite_token']
    detail = current(vendor, sid)
    assert detail['system']['draft'] == {} and detail['controls'] == []
    answers = {req['id']: {'implementation_status': 'yes', 'duration_workdays': 5,
               'owner_name': 'Supplier', 'implementation_plan': 'Implement and verify the acceptance criteria'}
               for req in detail['prd']['data']['requirements']}
    command(vendor, sid, 'supplier-draft', {'round_version': detail['round']['version'], 'answers': answers}, method='put')
    detail = current(vendor, sid)
    command(vendor, sid, 'supplier-submit', {'round_version': detail['round']['version'],
            'answers': answers, 'mode': 'local', 'language': 'en'})
    command(reviewer, sid, 'jobs', {'kind': 'impact_analysis', 'mode': 'local', 'language': 'en'})
    assert 'review' in current(reviewer, sid)['permissions']
    assert asyncio.run(run_once(app.state.sessions))
    detail = current(reviewer, sid)
    decisions = {finding['id']: {'decision': 'accept', 'reason': 'Customer reviewer schedules verification'}
                 for finding in detail['report']['data']['findings']}
    command(reviewer, sid, 'review-decisions', {'decisions': decisions, 'exception_reason': 'No exclusions'})
    baseline = command(client, sid, 'baselines').json()['baseline']
    for party in (client, vendor):
        response = party.post(f"/api/v1/baselines/{baseline['id']}/confirmations", json={
            'version': current(party, sid)['system']['version'], 'content_hash': baseline['content_hash']})
        assert response.status_code == 200, response.text
    response = client.post(f"/api/v1/baselines/{baseline['id']}/finalize", json={
        'version': current(client, sid)['system']['version']})
    assert response.status_code == 200, response.text
    assert response.json()['system']['status'] == 'PENDING_DEVELOPMENT'
    with app.state.sessions() as db:
        assert db.get(User, supplier['id']).org_id != db.get(ManagedSupplier, supplier['id']).customer_org_id


def test_supplier_revocation_and_account_isolation(owner):
    app, client, sid, project, supplier, vendor, _ = setup(owner)
    command(client, sid, 'supplier-rounds', {'supplier_user_id': supplier['id']})
    other = create_account(client, project, 'supplier_two', 'supplier')
    with app.state.sessions.begin() as db:
        db.get(AccountPolicy, other['id']).must_change_password = False
    other_client = TestClient(app)
    login(other_client, 'supplier_two', other['temporary_password'])
    assert other_client.get(f'/api/v1/systems/{sid}').status_code == 404
    assert other_client.get('/api/v1/systems').json() == []
    assert client.put(f"/api/v1/admin/users/{supplier['id']}", json={'is_admin': True}).status_code == 403
    assert client.put(f"/api/v1/admin/users/{supplier['id']}", json={'active': False}).status_code == 200
    assert vendor.get('/api/v1/auth/session').status_code == 401
    foreign = TestClient(app)
    register(foreign, 'foreign@example.test')
    assert foreign.put(f"/api/v1/admin/users/{supplier['id']}", json={'active': True}).status_code == 404


def test_customer_and_supplier_identities_cannot_be_combined(owner):
    app, client = owner
    staff = create_account(client, None, 'staff_user', 'operator')
    assert client.put(f"/api/v1/people/{staff['id']}/role", json={'role': 'supplier'}).status_code == 422
    response = client.post('/api/v1/admin/users', json={'username': 'invalid_mix', 'name': 'Mix', 'role': ['supplier', 'manager']})
    assert response.status_code == 422
    with app.state.sessions() as db:
        assert not db.scalar(select(AccountPolicy).where(AccountPolicy.username == 'invalid_mix'))
