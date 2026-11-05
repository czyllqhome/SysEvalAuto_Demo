"""Dashboard reads never mutate workflow, cross organizations or reuse stale sources."""
import copy
from datetime import timedelta

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.db import AccountPolicy, Confirmation, CurrentAssessment, System
from app.existing_service import today
from conftest import register
from test_delivery_workflow import finalized, submit
from test_existing_workflow import make_plan, prepare_existing, publish


PATH = '/api/v1/admin/dashboard'


def test_dashboard_requires_authenticated_admin_and_keeps_organization_scope(owner):
    app, client = owner
    assert TestClient(app).get(PATH).status_code == 401
    client.post('/api/v1/systems', json={'name': 'Private original 原文'})
    user = client.get('/api/v1/auth/session').json()['user']
    with TestClient(app) as outsider:
        register(outsider, 'other-dashboard@example.test')
        data = outsider.get(PATH).json()
        assert data['summary']['total'] == 0
        assert 'Private original' not in str(data)
    with app.state.sessions() as db:
        policy = db.get(AccountPolicy, user['id'])
        if policy:
            policy.admin = False
        else:
            db.add(AccountPolicy(user_id=user['id'], admin=False))
        db.commit()
    assert client.get(PATH).status_code == 403


def test_dashboard_filters_and_deleted_assessments(owner):
    app, client = owner
    ids = [client.post('/api/v1/systems', json={'name': name}).json()['system']['id']
           for name in ['服务平台 Original', 'Other system', 'Hidden system']]
    with app.state.sessions() as db:
        record = db.get(System, ids[0])
        record.context = {'departments': ['IT/数字化', 'IT/数字化', '财务']}
        record.classification = {'effective_level': 'L2'}
        record.status = 'PRD_REVIEW'
        db.get(System, ids[2]).draft = {'deleted_at': 10}
        db.commit()
    data = client.get(PATH).json()
    assert data['summary']['total'] == 2
    assert sum(item['count'] for item in data['stages']) == 2
    assert sum(item['count'] for item in data['levels']) == 2
    assert next(item['count'] for item in data['departments'] if item['name'] == 'IT/数字化') == 1
    assert data['summary']['todos'] == 2
    assert client.get(PATH, params={'q': 'original'}).json()['summary']['total'] == 1
    assert client.get(PATH, params={'q': '财务'}).json()['summary']['total'] == 1
    assert client.get(PATH, params={'q': '%'}).json()['summary']['total'] == 0
    assert client.get(PATH, params={'kind': 'existing'}).json()['summary']['total'] == 0
    assert client.get(PATH, params={'kind': 'invalid'}).status_code == 422
    assert client.get(PATH, params={'q': 'a' * 201}).status_code == 422


def test_current_supplier_baseline_and_delivery_summary(owner):
    app, client, vendor, sid, baseline, batch = finalized(owner)
    submit(vendor, batch, batch['items'][0])
    data = client.get(PATH).json()
    assert data['summary']['agreed'] == 1
    assert data['summary']['delivery_review'] == 1
    assert data['summary']['suppliers'] == 1
    assert data['suppliers'][0]['agreed'] == 1
    assert data['suppliers'][0]['systems'] == [{'id': sid, 'name': data['todos'][0]['name'], 'status': 'PENDING_DEVELOPMENT'}]
    assert data['todos'][0]['href'] == '/delivery/' + batch['id']
    assert vendor.get(PATH).status_code == 403
    with app.state.sessions() as db:
        confirmation = db.scalar(select(Confirmation).where(Confirmation.baseline_id == baseline['id']))
        confirmation.content_hash = 'outdated'
        db.commit()
    assert client.get(PATH).json()['summary']['agreed'] == 0
    with app.state.sessions() as db:
        db.get(System, sid).revision += 1
        db.commit()
    assert client.get(PATH).json()['summary']['delivery_review'] == 0


def test_remediation_separates_closure_acceptance_expiry_and_overdue_without_writes(owner):
    app, client, sid, _ = prepare_existing(owner)
    gap, _, _ = publish(client, sid)
    plan = make_plan(app, client, sid, gap, plan={'due_on': (today() - timedelta(days=1)).isoformat()})
    with app.state.sessions() as db:
        system = db.get(System, sid)
        run = db.get(CurrentAssessment, (sid, system.revision))
        data = copy.deepcopy(run.data)
        data['plans'][plan['id']]['status'] = 'awaiting_retest'
        for key, status, review_on in [('closed', 'closed', None), ('accepted', 'accepted_risk', today() + timedelta(days=1)),
                                       ('expired', 'accepted_risk', today())]:
            data['gaps'][key] = {'id': key, 'status': status, 'risk': {'priority': 'high'}}
            if review_on:
                data['gaps'][key]['acceptance'] = {'review_on': review_on.isoformat()}
        run.data = data
        db.commit()
        original_data, original_version = copy.deepcopy(run.data), system.version
    result = client.get(PATH).json()
    assert result['remediation']['total'] == 4
    assert result['remediation']['overdue'] == 1
    assert result['remediation']['states'] == {'closed': 1, 'accepted_risk': 1, 'awaiting_retest': 1,
                                            'in_progress': 0, 'pending_approval': 0, 'unplanned': 1}
    assert result['remediation']['risks']['high'] == 2
    assert result['todos'][0]['kind'] == 'risk_expired'
    with app.state.sessions() as db:
        system = db.get(System, sid)
        assert system.version == original_version
        assert db.get(CurrentAssessment, (sid, system.revision)).data == original_data
        # The same revision with changed source facts must also be excluded.
        system.context_revision_id = 'changed-source'
        db.commit()
    result = client.get(PATH).json()
    assert result['remediation']['total'] == 0
    assert result['remediation']['stale_assessments'] == 1


def test_historical_supplier_round_does_not_remain_in_current_totals(owner):
    app, client, _, sid, _, _ = finalized(owner)
    with app.state.sessions() as db:
        system = db.get(System, sid)
        system.round_id = None
        system.baseline_id = None
        system.status = 'CONTROL_REVIEW'
        system.revision += 1
        db.commit()
    data = client.get(PATH).json()
    assert data['summary']['suppliers'] == 0
    assert data['summary']['agreed'] == 0
    assert data['summary']['delivery_review'] == 0
