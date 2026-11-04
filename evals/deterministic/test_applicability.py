"""Inline answers retain the pinned baseline, scope boundaries and decision history."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.db import Assignment, Audit, Membership, Project, Selection, System
from conftest import register
from test_control_library import add, control, publish, rule
from test_screening import low
from test_workflow import BRIEF, command, current


def prepare(owner, facts=None):
    app, client = owner
    for code, condition in [('BASE', True), ('OWN', {'any': [{'all': [{'tag': 'delivery.models', 'op': 'in', 'value': ['in_house']}]}]}),
                            ('OUT', {'any': [{'all': [{'tag': 'delivery.models', 'op': 'in', 'value': ['outsourced']}]}]}),
                            ('REMOTE', rule('ops.remote_admin')),
                            ('RISK', {'any': [{'all': [{'tag': 'risk.business_impact', 'op': 'eq', 'value': 'severe'}]}]})]:
        item = control(code, condition)
        item['source_framework'] = 'MLPS_LEVEL_2'
        add(client, item)
    publish(client)
    sid = client.post('/api/v1/systems', json={'name': 'Inline applicability'}).json()['system']['id']
    command(client, sid, 'classification-confirmations', {'scheme': 'SYS-SCREEN/2',
            'facts': {**low(), 'net.public_ingress': 'yes', **(facts or {})}, 'frameworks': ['MLPS_LEVEL_2']})
    command(client, sid, 'context-confirmations', {'context': BRIEF})
    return app, client, sid


def test_inline_answers_resolve_unknowns_and_preserve_previous_revision(owner):
    app, client, sid = prepare(owner)
    path = f'/api/v1/systems/{sid}'
    before = current(client, sid)
    result = client.get(path + '/applicability-questions').json()
    assert result['pending_count'] == 3
    assert {q['code']: len(q['affected_controls']) for q in result['questions']} == {'ops.remote_admin': 1, 'delivery.models': 2}
    body = {'version': before['system']['version'], 'answers': {'delivery.models': ['in_house'], 'ops.remote_admin': 'no'}}
    response = client.put(path + '/applicability-answers', json=body, headers={'Idempotency-Key': 'inline'})
    assert response.status_code == 200, response.text
    after = response.json()
    assert after['system']['revision'] == before['system']['revision'] + 1
    assert after['system']['classification']['effective_level'] == before['system']['classification']['effective_level']
    assert after['system']['classification']['catalog_id'] == before['system']['classification']['catalog_id']
    assert after['system']['context_revision_id'] == before['system']['context_revision_id']
    assert after['system']['context'] == before['system']['context']
    assert after['system']['draft']['screening']['facts']['delivery.models'] == ['in_house']
    assert {c['code']: c['included'] for c in after['controls']} == {'BASE': True, 'OWN': True, 'OUT': False, 'REMOTE': False, 'RISK': False}
    assert client.get(path + '/applicability-questions').json()['pending_count'] == 0
    assert client.put(path + '/applicability-answers', json=body, headers={'Idempotency-Key': 'inline'}).json() == after
    assert client.put(path + '/applicability-answers', json=body).status_code == 409
    with app.state.sessions() as db:
        old = list(db.scalars(select(Selection).where(Selection.system_id == sid, Selection.revision == before['system']['revision'])))
        assert sum(s.origin == 'candidate' for s in old) == 3
        audit = db.scalar(select(Audit).where(Audit.system_id == sid, Audit.action == 'control.applicability_answers'))
        assert audit.detail['answers'] == body['answers']
    # The same formerly blocked PRD command is now allowed.
    command(client, sid, 'jobs', {'kind': 'prd_generation', 'mode': 'local', 'language': 'en'})


def test_affected_manual_decisions_require_review_others_are_preserved(owner):
    _, client, sid = prepare(owner)
    detail = current(client, sid)
    for code, included, reason in [('BASE', False, 'Documented exception'), ('OUT', True, '')]:
        cid = next(c['id'] for c in detail['controls'] if c['code'] == code)
        command(client, sid, 'controls', {'control_id': cid, 'included': included, 'reason': reason})
    after = command(client, sid, 'applicability-answers', {'answers': {'delivery.models': ['in_house']}}, method='put').json()
    rows = {c['code']: c for c in after['controls']}
    assert rows['BASE']['reason'] == 'Documented exception'
    assert rows['BASE']['origin'] == 'manual'
    assert rows['OUT']['origin'] == 'candidate' and not rows['OUT']['included']


@pytest.mark.parametrize('answers', [{}, {'delivery.models': ['bogus']}, {'ops.remote_admin': 'unknown'}, {'net.public_ingress': 'no'}])
def test_invalid_answers_are_atomic(owner, answers):
    _, client, sid = prepare(owner)
    before = current(client, sid)
    command(client, sid, 'applicability-answers', {'answers': answers}, method='put', expected=422)
    assert current(client, sid) == before


def test_grading_changes_require_reconfirmation(owner):
    _, client, sid = prepare(owner, {'risk.business_impact': 'unknown'})
    before = current(client, sid)
    command(client, sid, 'applicability-answers', {'answers': {'risk.business_impact': 'severe', 'ops.remote_admin': 'yes'}}, method='put', expected=409)
    assert current(client, sid) == before


def test_permission_organization_and_workflow_boundaries(owner):
    app, client, sid = prepare(owner)
    path = f'/api/v1/systems/{sid}'
    with TestClient(app) as outsider:
        register(outsider, 'outside@example.test')
        assert outsider.get(path + '/applicability-questions').status_code == 404
        assert outsider.put(path + '/applicability-answers', json={'version': 1, 'answers': {}}).status_code == 404
    # Administrators and project managers can edit applicability facts.
    uid = client.get('/api/v1/auth/session').json()['user']['id']
    with app.state.sessions.begin() as db:
        system = db.get(System, sid)
        project = Project(org_id=system.org_id, name='Roles')
        db.add(project)
        db.flush()
        db.add(Membership(project_id=project.id, user_id=uid, role='manager'))
        db.add(Assignment(system_id=sid, project_id=project.id, operator_id=uid, reviewer_ids=[], contributors=[]))
    before = current(client, sid)
    command(client, sid, 'applicability-answers', {'answers': {'ops.remote_admin': 'yes'}}, method='put')
    after = current(client, sid)['system']
    assert after['version'] > before['system']['version']
    assert after['classification']['facts']['ops.remote_admin'] == 'yes'


def test_does_not_use_a_newly_published_library(owner):
    _, client, sid = prepare(owner)
    before = current(client, sid)
    new = control('NEW')
    add(client, new)
    publish(client)
    after = command(client, sid, 'applicability-answers', {'answers': {'ops.remote_admin': 'yes'}}, method='put').json()
    assert after['system']['classification']['catalog_id'] == before['system']['classification']['catalog_id']
    assert 'NEW' not in [c['code'] for c in after['controls']]
