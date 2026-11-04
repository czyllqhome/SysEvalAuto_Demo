from fastapi.testclient import TestClient
from app.db import AccountPolicy, Audit, System, User
from sqlalchemy import select
from conftest import register


def test_admin_delete_preserves_records_and_hides_access(owner):
    app, client = owner
    created = client.post('/api/v1/systems', json={'name': 'Disposable assessment'}).json()['system']
    sid = created['id']
    path = f'/api/v1/systems/{sid}'
    assert client.request('DELETE', path, json={'version': -1}).status_code == 409
    with TestClient(app) as other:
        register(other, 'outside-delete@example.test')
        assert other.request('DELETE', path, json={'version': created['version']}).status_code == 404
    assert client.request('DELETE', path, json={'version': created['version']}).status_code == 200
    assert sid not in [row['id'] for row in client.get('/api/v1/systems').json()]
    assert client.get(path).status_code == 404
    assert client.put(path + '/context-draft', json={}).status_code == 404
    with app.state.sessions() as db:
        row = db.get(System, sid)
        assert row.draft['deleted_at'] and row.name == 'Disposable assessment'
        assert db.scalar(select(Audit).where(Audit.system_id == sid, Audit.action == 'assessment.deleted'))


def test_non_admin_cannot_delete_own_assessment(owner):
    app, client = owner
    created = client.post('/api/v1/systems', json={'name': 'Keep assessment'}).json()['system']
    with app.state.sessions.begin() as db:
        user = db.scalar(select(User).where(User.email == 'owner@example.test'))
        policy = db.get(AccountPolicy, user.id)
        if policy:
            policy.admin = False
        else:
            db.add(AccountPolicy(user_id=user.id, admin=False))
    assert client.request('DELETE', f"/api/v1/systems/{created['id']}", json={'version': created['version']}).status_code == 403
    with app.state.sessions() as db:
        assert not db.get(System, created['id']).draft.get('deleted_at')
