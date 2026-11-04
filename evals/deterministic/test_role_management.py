"""Account creation with initial project roles stays scoped and atomic."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event, func, select

from app.db import AccountPolicy, AdminAudit, OrganizationRole, User
from app.domain import DomainError
from conftest import register


@pytest.mark.parametrize('roles', [
    ['manager'], ['operator'], ['reviewer'], ['viewer'],
])
def test_create_account_with_initial_project_roles(owner, roles):
    app, admin = owner
    response = admin.post('/api/v1/admin/users', json={
        'username': 'project-user', 'name': '项目成员 Authored name', 'role': roles[0],
    })
    assert response.status_code == 200, response.text
    created = response.json()
    row = next(item for item in admin.get('/api/v1/team').json()['users'] if item['id'] == created['id'])
    assert row['name'] == '项目成员 Authored name'
    assert not row['is_admin']
    assert row['must_change_password']
    assert row['memberships'] == []
    with app.state.sessions() as db:
        assert db.get(AccountPolicy, created['id']).must_change_password
        audits = list(db.scalars(select(AdminAudit).where(AdminAudit.action == 'organization.role_changed')))
        assert any(item.detail == {'user_id': created['id'], 'role': roles[0]} for item in audits)
    with TestClient(app) as member:
        signed = member.post('/api/v1/auth/login', json={'email': 'project-user', 'password': created['temporary_password']})
        assert signed.status_code == 200
        member.headers['X-CSRF-Token'] = signed.json()['csrf']
        assert member.get('/api/v1/systems').status_code == 403
        assert member.post('/api/v1/auth/password', json={
            'current_password': created['temporary_password'], 'password': 'New-Test-Passphrase',
        }).status_code == 200
        signed = member.post('/api/v1/auth/login', json={'email': 'project-user', 'password': 'New-Test-Passphrase'})
        member.headers['X-CSRF-Token'] = signed.json()['csrf']
        assert signed.json()['user']['organization_role'] == roles[0]
        assert member.get('/api/v1/admin/audits').status_code == 403
        assert member.post('/api/v1/admin/users', json={'username': 'forbidden', 'name': 'No'}).status_code == 403


@pytest.mark.parametrize('extra', [
    {'roles': ['manager']}, {'project_id': 'missing'},
    {'project_id': 'missing', 'roles': ['viewer']},
    {'project_id': 'project', 'roles': []}, {'project_id': 'project', 'roles': ['admin']},
    {'project_id': 'project', 'roles': ['supplier']}, {'project_id': 'project', 'roles': ['viewer', 'viewer']},
    {'project_id': 'project', 'roles': [{'role': 'viewer'}]},
    {'project_id': 'project', 'roles': 'operator'}, {'is_admin': True},
])
def test_invalid_initial_roles_do_not_create_account_or_audit(owner, extra):
    app, admin = owner
    before = len(admin.get('/api/v1/team').json()['users'])
    with app.state.sessions() as db:
        audit_count = db.scalar(select(func.count()).select_from(AdminAudit))
    result = admin.post('/api/v1/admin/users', json={'username': 'invalid-user', 'name': 'Rejected', **extra})
    assert result.status_code in (404, 422), result.text
    assert len(admin.get('/api/v1/team').json()['users']) == before
    with app.state.sessions() as db:
        assert db.scalar(select(AccountPolicy).where(AccountPolicy.username == 'invalid-user')) is None
        assert db.scalar(select(func.count()).select_from(AdminAudit)) == audit_count


def test_roles_cannot_change_another_organization(owner):
    app, first = owner
    uid = first.get('/api/v1/auth/session').json()['user']['id']
    with TestClient(app) as outsider:
        register(outsider, 'outsider@example.test')
        assert outsider.put(f'/api/v1/people/{uid}/role', json={'role': 'manager'}).status_code == 404


def test_membership_failure_rolls_back_new_account_and_audit(owner):
    app, admin = owner
    with app.state.sessions() as db:
        before = db.scalar(select(func.count()).select_from(AdminAudit))

    def fail_membership(_mapper, _connection, _target):
        raise DomainError('INJECTED_FAILURE', 503)

    event.listen(OrganizationRole, 'before_insert', fail_membership)
    try:
        response = admin.post('/api/v1/admin/users', json={
            'username': 'rollback-user', 'name': 'Rejected', 'role': 'operator',
        })
        assert response.status_code == 503
    finally:
        event.remove(OrganizationRole, 'before_insert', fail_membership)
    with app.state.sessions() as db:
        assert db.scalar(select(User).where(User.email == 'rollback-user@accounts.local')) is None
        assert db.scalar(select(AccountPolicy).where(AccountPolicy.username == 'rollback-user')) is None
        assert db.scalar(select(func.count()).select_from(AdminAudit)) == before


def test_last_admin_cannot_be_demoted_to_obtain_a_project_role(owner):
    _, admin = owner
    uid = admin.get('/api/v1/auth/session').json()['user']['id']
    assert admin.put(f'/api/v1/admin/users/{uid}', json={'is_admin': False}).status_code == 409
    assert admin.get('/api/v1/auth/session').json()['user']['is_admin']
