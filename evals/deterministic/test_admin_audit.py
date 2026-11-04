"""Audit filtering, lazy detail and assessment discovery remain organization scoped."""
from fastapi.testclient import TestClient

from app.db import AdminAudit
from conftest import register


def test_audit_filters_pagination_and_lazy_details(owner):
    app, client = owner
    user = client.get('/api/v1/auth/session').json()['user']
    with app.state.sessions() as db:
        for index in range(4):
            db.add(AdminAudit(id=f'event-{index}', org_id=user['org_id'], actor_id=user['id'],
                              action='project.created' if index < 3 else 'user.updated',
                              created_at=100 + index, detail={'large': 'detail only on demand'}))
        db.commit()
    base = '/api/v1/admin/audits'
    result = client.get(base, params={'q': 'project.', 'actor_id': user['id'], 'start': 101,
                                      'end': 103, 'summary': True, 'limit': 1}).json()
    assert [r['id'] for r in result] == ['event-2']
    assert 'detail' not in result[0]
    assert client.get(base, params={'q': 'project.', 'start': 101, 'end': 103,
                                    'offset': 1, 'limit': 1}).json()[0]['id'] == 'event-1'
    assert client.get(base, params={'actor_id': 'unknown'}).json() == []
    assert client.get(base, params={'q': '%'}).json() == []
    assert client.get(base, params={'start': 200, 'end': 100}).status_code == 422
    assert client.get(base, params={'offset': -1}).status_code == 422
    assert client.get(base, params={'limit': 301}).status_code == 422
    assert client.get(base + '/event-2').json()['detail'] == {'large': 'detail only on demand'}
    with TestClient(app) as outsider:
        register(outsider, 'separate@example.test')
        assert outsider.get(base + '/event-2').status_code == 404
        assert not any(item['id'].startswith('event-') for item in outsider.get(base).json())


def test_people_discovers_direct_assessments_without_creating_projects(owner):
    app, client = owner
    sid = client.post('/api/v1/systems', json={'name': 'Authored name'}).json()['system']['id']
    before = client.get('/api/v1/people').json()
    assert before['assessments'][0]['id'] == sid
    assert before['assessments'][0]['members'] == []
    assert client.post('/api/v1/admin/projects', json={'name': 'retired'}).status_code == 410
