"""Administrator and manager authority without crossing organization boundaries."""
from test_integration import login, new_member, project_setup


def test_admin_direct_assignment_and_progress(owner):
    _, admin, _, users, sid = project_setup(owner)
    detail = admin.get(f'/api/v1/systems/{sid}').json()
    assert set(detail['permissions']) == {'read', 'edit', 'review', 'manage'}
    path = f"/api/v1/systems/{sid}/members/{users['operator'][0]}"
    body = {'role': 'operator', 'version': detail['system']['version']}
    assert admin.put(path, json=body).status_code == 200
    assert admin.put(path, json=body).status_code == 409


def test_manager_grants_ordinary_roles_but_cannot_escalate(owner):
    app, admin, _, users, sid = project_setup(owner)
    manager = users['manager'][1]
    uid, account = new_member(app, admin, 'unassigned')
    path = f'/api/v1/systems/{sid}/members/{uid}'
    version = manager.get(f'/api/v1/systems/{sid}').json()['system']['version']
    assert manager.put(path, json={'role': 'operator', 'version': version}).status_code == 200
    login(account, 'unassigned')
    assert account.get(f'/api/v1/systems/{sid}').status_code == 200
    assert manager.put(f'/api/v1/people/{uid}/role', json={'role': 'manager'}).status_code == 403
    assert manager.put(f'/api/v1/admin/users/{uid}', json={'is_admin': True}).status_code == 403
    other = admin.post('/api/v1/systems', json={'name': 'Other owner'}).json()['system']
    assert manager.put(f"/api/v1/systems/{other['id']}/members/{uid}", json={'role': 'viewer', 'version': other['version']}).status_code == 404
    version = manager.get(f'/api/v1/systems/{sid}').json()['system']['version']
    assert manager.put(path, json={'role': '', 'version': version}).status_code == 200
    assert account.get('/api/v1/auth/session').status_code == 401


def test_manager_creates_assessment_in_assigned_project_without_operator(owner):
    _, admin, pid, users, _ = project_setup(owner)
    manager = users['manager'][1]
    response = manager.post('/api/v1/systems', json={'name': 'Manager-created assessment'})
    assert response.status_code == 200, response.text
    detail = response.json()
    assert {'read', 'edit', 'review', 'manage'} <= set(detail['permissions'])
    sid = detail['system']['id']
    assert sid in {s['id'] for s in manager.get('/api/v1/systems').json()}
    assert manager.put(f'/api/v1/systems/{sid}/context-draft', json={'version': detail['system']['version'], 'blocks': {'goal': 'New project system'}}).status_code == 200
    assert manager.post('/api/v1/systems', json={'name': 'Denied', 'project_id': 'retired'}).status_code == 422
    assert users['operator'][1].post('/api/v1/systems', json={'name': 'Denied'}).status_code == 403
    assert manager.post('/api/v1/admin/projects', json={'name': 'Denied'}).status_code == 410
