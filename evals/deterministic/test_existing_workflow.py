"""API-level offline journeys against isolated databases, including shared PRD work."""
import asyncio
from datetime import timedelta

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.db import AssessmentProfile, CurrentAssessment, System
from app.existing_service import today
from app.worker import run_once
from conftest import register
from test_workflow import BRIEF, command, current


def prepare_existing(owner):
    app, client = owner
    project = None  # Historical helper return shape; direct assessments have no project.
    response = client.post('/api/v1/systems', json={'name': 'Running portal', 'assessment_type': 'existing',
        'scope': 'Production portal', 'environment': 'production',
        'system_version': 'v1', 'as_of': today().isoformat(), 'trigger': 'initial'})
    assert response.status_code == 200, response.text
    sid = response.json()['system']['id']
    command(client, sid, 'context-draft', {'blocks': {'goal': 'Improve service', 'functions': 'Create tickets'}}, method='put')
    command(client, sid, 'classification-confirmations', {'mode': 'questionnaire', 'answers': {
        'Q1': 'L2', 'Q2': 'L2', 'Q3': 'L2', 'Q4': 'L1', 'Q5': 'L2'}})
    command(client, sid, 'context-confirmations', {'context': BRIEF})
    command(client, sid, 'existing/begin')
    return app, client, sid, project


def evidence(client, sid, **values):
    return command(client, sid, 'existing/evidence', {'description': 'Verified test record',
        'environment': 'production', 'system_version': 'v1', 'collected_on': today().isoformat(), **values}).json()['evidence_id']


def publish(client, sid, conclusion='partial'):
    eid = evidence(client, sid)
    controls = [c for c in current(client, sid)['controls'] if c['included']]
    gap = controls[0]['id']
    for c in controls:
        command(client, sid, 'existing/verify', {'control_id': c['id'], 'conclusion': conclusion if c['id'] == gap else 'satisfied',
            'reason': 'Observed behavior', 'method': 'Inspected and tested', 'evidence_ids': [eid]})
    result = command(client, sid, 'existing/publish', {'summary': 'Reviewed findings',
        'limitations': {gap: 'System owner to obtain logs'}, 'risk_reviews': {gap: {'impact': 'high', 'likelihood': 'medium', 'reason': 'Service exposure'}}, 'exceptions': {'classification': 'Reviewed'}}).json()
    return gap, eid, result


def make_plan(app, client, sid, gap, **extra):
    with app.state.sessions() as db:
        owner_id = db.get(System, sid).owner_id
    body = {'gap_ids': [gap], 'owner_id': owner_id, 'due_on': (today() + timedelta(days=10)).isoformat(),
            'kind': 'configuration', 'scope': 'Enable audit logging', 'acceptance_criteria': ['Denied requests appear in audit log']}
    body.update(extra.pop('plan', {}))
    result = command(client, sid, 'existing/plan', {'plan': body, **extra}).json()['existing']['run']
    return next(iter(result['plans'].values()))


def test_internal_remediation_full_journey(owner):
    app, client, sid, _ = prepare_existing(owner)
    command(client, sid, 'jobs', {'kind': 'prd_generation', 'mode': 'local', 'language': 'en'}, expected=409)
    gap, eid, report = publish(client, sid)
    assert report['system']['status'] == 'REMEDIATING'
    report_id = report['existing']['run']['reports'][0]['id']
    original = client.get(f'/api/v1/systems/{sid}/existing/reports/{report_id}').text
    plan = make_plan(app, client, sid, gap)
    command(client, sid, 'existing/approve', {'plan_id': plan['id'], 'content_hash': 'stale'}, expected=409)
    command(client, sid, 'existing/approve', {'plan_id': plan['id'], 'content_hash': plan['content_hash']})
    command(client, sid, 'existing/finalize', {'next_review_on': (today() + timedelta(days=30)).isoformat()}, expected=409)
    command(client, sid, 'existing/complete-task', {'plan_id': plan['id'], 'description': 'Old evidence', 'evidence_ids': [eid]}, expected=422)
    eid = evidence(client, sid, description='New delivery evidence after remediation approval')
    command(client, sid, 'existing/complete-task', {'plan_id': plan['id'], 'description': 'Configuration deployed', 'evidence_ids': [eid]})
    for passed in (False, True):
        result = command(client, sid, 'existing/retest', {'plan_id': plan['id'], 'content_hash': plan['content_hash'],
            'passed': passed, 'reason': 'Test result', 'system_version': 'v1', 'evidence_ids': [eid]}).json()
        assert result['existing']['run']['plans'][plan['id']]['status'] == ('closed' if passed else 'in_progress')
        if not passed:
            command(client, sid, 'existing/complete-task', {'plan_id': plan['id'], 'description': 'Fixed failure', 'evidence_ids': [eid]})
    final = command(client, sid, 'existing/finalize', {'next_review_on': (today() + timedelta(days=30)).isoformat()}).json()
    assert final['system']['status'] == 'ASSESSMENT_COMPLETE'
    assert client.get(f'/api/v1/systems/{sid}/existing/reports/{report_id}').text == original


def test_evidence_report_scope_and_history(owner):
    app, client, sid, _ = prepare_existing(owner)
    control = next(c for c in current(client, sid)['controls'] if c['included'])
    wrong = evidence(client, sid, environment='test')
    command(client, sid, 'existing/verify', {'control_id': control['id'], 'conclusion': 'satisfied',
        'reason': 'Claim', 'method': 'Check', 'evidence_ids': [wrong]}, expected=422)
    command(client, sid, 'existing/verify', {'control_id': control['id'], 'conclusion': 'satisfied',
        'reason': 'Claim', 'method': 'Check', 'evidence_ids': []}, expected=422)
    command(client, sid, 'existing/publish', {'summary': 'Incomplete'}, expected=422)
    gap, _, _ = publish(client, sid, 'insufficient_evidence')
    with app.state.sessions() as db:
        profile = db.get(AssessmentProfile, sid)
        asset = profile.asset_id
        owner_id = db.get(System, sid).owner_id
    expiry = (today() + timedelta(days=2)).isoformat()
    command(client, sid, 'existing/accept-risk', {'gap_id': gap, 'acceptance': {'owner_id': owner_id,
        'reason': 'Await archived logs', 'compensating_measures': 'Manual review', 'review_on': expiry}})
    result = command(client, sid, 'existing/finalize', {'next_review_on': expiry}).json()
    assert result['system']['status'] == 'ACCEPTED_RISKS'
    assert result['system']['asset_id'] == asset
    command(client, sid, 'existing/reopen')
    assert client.get(f'/api/v1/systems/{sid}/existing').json()['run']['gaps'][gap]['status'] == 'open'
    command(client, sid, 'assessment-type', {'assessment_type': 'new'}, expected=409)
    before = current(client, sid)['system']['revision']
    command(client, sid, 'context-confirmations', {'context': {**BRIEF, 'summary': 'Changed operating boundary'}})
    assert client.get(f'/api/v1/systems/{sid}/existing/history/{before}').status_code == 200
    command(client, sid, 'existing/begin')
    assert client.get(f'/api/v1/systems/{sid}/existing').json()['run']['reports'] == []


def test_creation_reuse_idempotency_and_isolation(owner):
    app, client = owner
    body = {'name': 'Initial'}
    a = client.post('/api/v1/systems', json=body, headers={'Idempotency-Key': 'once'})
    b = client.post('/api/v1/systems', json=body, headers={'Idempotency-Key': 'once'})
    assert a.json() == b.json()
    assert a.json()['system']['assessment_type'] == 'new'
    asset = a.json()['system']['asset_id']
    followup = {**body, 'name': 'Review', 'assessment_type': 'existing', 'asset_id': asset,
        'predecessor_id': a.json()['system']['id'], 'scope': 'Live service', 'environment': 'production',
        'system_version': 'v2', 'as_of': today().isoformat(), 'trigger': 'periodic', 'type_reason': 'Now in operation'}
    result = client.post('/api/v1/systems', json={k: v for k, v in followup.items() if k != 'predecessor_id'})
    assert result.status_code == 200, result.text
    assert result.json()['system']['asset_id'] == asset
    outsider = TestClient(app)
    register(outsider, 'outside@example.test')
    assert outsider.get(f"/api/v1/systems/{result.json()['system']['id']}/existing").status_code == 404


def test_supplier_confirmation_revision_and_development_reuse(owner):
    app, client, sid, project = prepare_existing(owner)
    gap, _, _ = publish(client, sid)
    # Use existing managed-account API and roles; no second supplier identity implementation.
    response = client.post('/api/v1/admin/users', json={'name': 'Delivery supplier', 'username': 'delivery',
        'role': 'supplier'})
    assert response.status_code == 200, response.text
    supplier_id = response.json()['id']
    vendor = TestClient(app)
    login = vendor.post('/api/v1/auth/login', json={'email': 'delivery', 'password': response.json()['temporary_password']})
    assert login.status_code == 200, login.text
    vendor.headers['X-CSRF-Token'] = login.json()['csrf']
    # Clear forced password-change through the supported path, then log in again.
    password = 'New-Delivery-Password-123'
    changed = vendor.post('/api/v1/auth/password', json={'current_password': response.json()['temporary_password'], 'password': password})
    assert changed.status_code == 200, changed.text
    login = vendor.post('/api/v1/auth/login', json={'email': 'delivery', 'password': password})
    vendor.headers['X-CSRF-Token'] = login.json()['csrf']
    plan = make_plan(app, client, sid, gap, supplier_id=supplier_id, plan={'kind': 'development'})
    command(client, sid, 'existing/approve', {'plan_id': plan['id'], 'content_hash': plan['content_hash']})
    command(client, sid, 'existing/development', {'plan_id': plan['id']}, expected=409)
    tasks = vendor.get('/api/v1/supplier-remediations').json()
    assert len(tasks) == 1
    assert 'verifications' not in tasks[0]
    confirmation = {'version': tasks[0]['version'], 'plan_id': plan['id'], 'content_hash': plan['content_hash']}
    response = vendor.post(f'/api/v1/supplier-remediations/{sid}/confirm', json=confirmation)
    assert response.status_code == 200, response.text
    child = command(client, sid, 'existing/development', {'plan_id': plan['id']}).json()['development_id']
    child_view = current(client, child)
    assert len(child_view['controls']) == 1
    assert child_view['system']['assessment_type'] == 'new'
    command(client, child, 'jobs', {'kind': 'prd_generation', 'mode': 'local', 'language': 'en'})
    assert asyncio.run(run_once(app.state.sessions))
    assert current(client, child)['system']['status'] == 'PRD_REVIEW'
    command(client, child, 'prd-approval')
    command(client, child, 'supplier-rounds', {'supplier_user_id': supplier_id})
    vendor_state = current(vendor, child)
    answers = {r['id']: {'implementation_status': 'yes', 'duration_workdays': 1, 'owner_name': 'Supplier',
                        'implementation_plan': 'Implement and verify'} for r in vendor_state['prd']['data']['requirements']}
    command(vendor, child, 'supplier-submit', {'round_version': vendor_state['round']['version'],
        'answers': answers, 'mode': 'local', 'language': 'en'})
    assert asyncio.run(run_once(app.state.sessions))
    state = current(client, child)
    command(client, child, 'review-decisions', {'decisions': {f['id']: {'decision': 'accept', 'reason': 'Retest required'}
            for f in state['report']['data']['findings']}, 'exception_reason': 'Reviewed incremental scope'})
    baseline = command(client, child, 'baselines').json()['baseline']
    for party in (client, vendor):
        response = party.post(f"/api/v1/baselines/{baseline['id']}/confirmations", json={
            'version': current(party, child)['system']['version'], 'content_hash': baseline['content_hash']})
        assert response.status_code == 200, response.text
    response = client.post(f"/api/v1/baselines/{baseline['id']}/finalize", json={'version': current(client, child)['system']['version']})
    assert response.status_code == 200, response.text
    # Agreed development scope is not completed remediation.
    assert client.get(f'/api/v1/systems/{sid}/existing').json()['run']['gaps'][gap]['status'] == 'planned'
    tasks = vendor.get('/api/v1/supplier-remediations').json()
    response = vendor.post(f'/api/v1/supplier-remediations/{sid}/submit', json={
        'version': tasks[0]['version'], 'plan_id': plan['id'], 'content_hash': plan['content_hash'],
        'description': 'Implemented and delivered', 'evidence_description': 'Delivery test log',
        'environment': 'production', 'system_version': 'v2', 'collected_on': today().isoformat()})
    assert response.status_code == 409, response.text
    from test_delivery_workflow import submit, review
    response = client.post(f'/api/v1/systems/{sid}/delivery-batches', json={
        'version': current(client, sid)['system']['version'], 'source_kind': 'plan', 'source_id': plan['id']})
    assert response.status_code == 200, response.text
    batch = response.json()
    response = review(client, batch, submit(vendor, batch, batch['items'][0]))
    assert response.status_code == 200, response.text
    response = client.post(f"/api/v1/delivery-batches/{batch['id']}/complete", json={'version': response.json()['version']})
    assert response.status_code == 200, response.text
    state = client.get(f'/api/v1/systems/{sid}/existing').json()
    assert state['run']['plans'][plan['id']]['status'] == 'awaiting_retest'
    eid = state['run']['plans'][plan['id']]['completion']['evidence'][0]['source_id']
    command(client, sid, 'existing/retest', {'plan_id': plan['id'], 'content_hash': plan['content_hash'],
        'passed': True, 'reason': 'Acceptance verified', 'system_version': 'v2', 'evidence_ids': [eid]})
    assert client.get(f'/api/v1/systems/{sid}/existing').json()['run']['gaps'][gap]['status'] == 'closed'
    with app.state.sessions() as db:
        from app.db import AccountPolicy
        db.get(AccountPolicy, supplier_id).active = False
        db.commit()
    assert vendor.get('/api/v1/supplier-remediations').status_code == 401
    assert vendor.post(f'/api/v1/supplier-remediations/{sid}/confirm', json=confirmation).status_code == 401


def test_plan_revision_invalidates_confirmations_and_preserves_history(owner):
    app, client, sid, _ = prepare_existing(owner)
    gap, eid, _ = publish(client, sid)
    plan = make_plan(app, client, sid, gap)
    command(client, sid, 'existing/approve', {'plan_id': plan['id'], 'content_hash': plan['content_hash']})
    replacement = command(client, sid, 'existing/plan', {'plan_id': plan['id'], 'plan': {**plan['payload'], 'scope': 'Revised delivery'}}).json()['existing']['run']['plans'][plan['id']]
    assert replacement['confirmations'] == []
    assert replacement['content_hash'] != plan['content_hash']
    assert replacement['previous']['confirmations']
    command(client, sid, 'existing/approve', {'plan_id': plan['id'], 'content_hash': plan['content_hash']}, expected=409)
    command(client, sid, 'existing/complete-task', {'plan_id': plan['id'], 'description': 'Claimed completion', 'evidence_ids': [eid]}, expected=409)


def test_mutations_are_versioned_and_evidence_is_assessment_scoped(owner):
    app, client, sid, _ = prepare_existing(owner)
    version = current(client, sid)['system']['version']
    eid = evidence(client, sid)
    response = client.post(f'/api/v1/systems/{sid}/existing/evidence', json={'version': version})
    assert response.status_code == 409
    _, _, other, _ = prepare_existing(owner)
    control = next(c for c in current(client, other)['controls'] if c['included'])
    command(client, other, 'existing/verify', {'control_id': control['id'], 'conclusion': 'satisfied',
        'reason': 'Not my evidence', 'method': 'Check', 'evidence_ids': [eid]}, expected=404)


def test_additive_migration_keeps_existing_baseline_hash(tmp_path, monkeypatch):
    from pathlib import Path
    from alembic import command as migration
    from alembic.config import Config
    from sqlalchemy import inspect
    from app.db import Base, Baseline, Confirmation, Organization, User, make_engine, make_sessions
    from app.domain import digest
    url = f"sqlite:///{tmp_path / 'upgrade.db'}"
    monkeypatch.setenv('SYSEVAL_DATABASE_URL', url)
    config = Config(str(Path(__file__).resolve().parents[2] / 'backend' / 'alembic.ini'))
    engine = make_engine(url)
    additions = {'assessment_profiles', 'current_assessments', 'assessment_evidence', 'system_assets', 'project_purposes'}
    Base.metadata.create_all(engine, tables=[t for t in Base.metadata.sorted_tables if t.name not in additions])
    sessions = make_sessions(engine)
    payload = {'name': 'Historical baseline', 'authored_text': '保留原文'}
    content_hash = digest(payload)
    with sessions() as db:
        db.add_all([Organization(id='customer-org', name='Customer'), Organization(id='supplier-org', name='Supplier', kind='supplier')])
        db.flush()
        db.add_all([User(id='customer', org_id='customer-org', email='c@example.test', name='C', password_hash='test-only', role='owner'),
                    User(id='supplier', org_id='supplier-org', email='s@example.test', name='S', password_hash='test-only', role='vendor')])
        db.flush()
        db.add(System(id='old-system', org_id='customer-org', owner_id='customer', name='Old', status='PENDING_DEVELOPMENT', baseline_id='old-baseline'))
        db.flush()
        db.add(Baseline(id='old-baseline', system_id='old-system', payload=payload, content_hash=content_hash, finalized=True))
        db.flush()
        db.add_all([Confirmation(baseline_id='old-baseline', actor_id=party, party=party, content_hash=content_hash)
                    for party in ('customer', 'supplier')])
        db.commit()
    migration.stamp(config, 'managed_suppliers')
    migration.upgrade(config, 'head')
    migration.upgrade(config, 'head')
    assert additions <= set(inspect(engine).get_table_names())
    with sessions() as db:
        assert db.get(Baseline, 'old-baseline').payload == payload
        assert db.get(Baseline, 'old-baseline').content_hash == content_hash
        assert db.get(System, 'old-system').status == 'PENDING_DEVELOPMENT'
        assert {c.actor_id for c in db.scalars(select(Confirmation))} == {'customer', 'supplier'}
        assert all(c.content_hash == content_hash for c in db.scalars(select(Confirmation)))
    engine.dispose()


def test_risk_expiry_is_visible_and_blocks_finalization(owner, monkeypatch):
    app, client, sid, _ = prepare_existing(owner)
    gap, _, _ = publish(client, sid)
    with app.state.sessions() as db:
        owner_id = db.get(System, sid).owner_id
    day = today() + timedelta(days=1)
    command(client, sid, 'existing/accept-risk', {'gap_id': gap, 'acceptance': {'owner_id': owner_id,
        'reason': 'Temporary', 'compensating_measures': 'Manual review', 'review_on': day.isoformat()}})
    monkeypatch.setattr('app.existing_service.today', lambda: day)
    assert client.get(f'/api/v1/systems/{sid}/existing').json()['expired_gaps'] == [gap]
    command(client, sid, 'existing/finalize', {'next_review_on': (day + timedelta(days=1)).isoformat()}, expected=409)
    with app.state.sessions() as db:
        assert db.get(CurrentAssessment, (sid, current(client, sid)['system']['revision'])) is not None
