"""Organization roles and direct assessment membership, without project creation."""
from fastapi import Depends
from sqlalchemy import select
from . import access, service
from .db import AssessmentMember, ManagedSupplier, OrganizationRole, System, User
from .domain import DomainError


def migrate_roles(db):
    """Copy legacy effective access once per account without rewriting its history."""
    from .db import Assignment
    for user in db.scalars(select(User)):
        if db.get(OrganizationRole, user.id):
            continue
        role = access.organization_role(db, user)
        for system in db.scalars(select(System).where(System.org_id == user.org_id)):
            assignment = db.get(Assignment, system.id)
            if not assignment or user.role == 'vendor' or access.is_admin(db, user):
                continue
            roles = access.project_roles(db, user, assignment.project_id)
            granted = ('manager' if 'manager' in roles else
                       'operator' if 'operator' in roles and assignment.operator_id == user.id else
                       'reviewer' if 'reviewer' in roles and user.id in assignment.reviewer_ids else
                       'viewer' if 'viewer' in roles else None)
            if granted and not db.get(AssessmentMember, (system.id, user.id)):
                db.add(AssessmentMember(system_id=system.id, user_id=user.id, role=granted))
        db.add(OrganizationRole(user_id=user.id, role=role))
    db.flush()


def register_routes(app, current, get_db):
    @app.get('/api/v1/people')
    def people(user=Depends(current), db=Depends(get_db)):
        if not access.can_create(db, user):
            raise DomainError('FORBIDDEN', 403)
        managed = select(ManagedSupplier.user_id).where(ManagedSupplier.customer_org_id == user.org_id)
        users = db.scalars(select(User).where((User.org_id == user.org_id) | User.id.in_(managed)))
        return {'users': [{**access.identity(db, u), 'active': access.active(db, u)} for u in users],
                'assessments': [{'id': s.id, 'name': s.name, 'version': s.version, 'owner_id': s.owner_id,
                    'members': [{'user_id': m.user_id, 'role': m.role} for m in db.scalars(select(AssessmentMember).where(AssessmentMember.system_id == s.id))]}
                    for s in db.scalars(select(System).where(System.org_id == user.org_id))
                    if 'manage' in access.capabilities(db, user, s)]}

    @app.put('/api/v1/people/{user_id}/role')
    def role(user_id: str, body: dict, user=Depends(current), db=Depends(get_db)):
        access.require_admin(db, user)
        target = db.get(User, user_id)
        if not target or target.org_id != user.org_id or target.role == 'vendor':
            raise DomainError('NOT_FOUND', 404)
        if set(body) != {'role'} or body['role'] not in ('manager', 'operator', 'reviewer', 'viewer'):
            raise DomainError('INVALID_FIELDS')
        row = db.get(OrganizationRole, user_id)
        if row:
            row.role = body['role']
        else:
            db.add(OrganizationRole(user_id=user_id, role=body['role']))
        if body['role'] != 'manager':
            for grant in db.scalars(select(AssessmentMember).where(AssessmentMember.user_id == user_id, AssessmentMember.role == 'manager')):
                db.delete(grant)
        access.audit(db, user, 'organization.role_changed', {'user_id': user_id, **body})
        access.revoke(db, user_id)
        db.commit()
        return {'ok': True}

    @app.put('/api/v1/systems/{system_id}/members/{user_id}')
    def member(system_id: str, user_id: str, body: dict, user=Depends(current), db=Depends(get_db)):
        system = service.system_for(db, user, system_id, write=True)
        if 'manage' not in access.capabilities(db, user, system):
            raise DomainError('FORBIDDEN', 403)
        if body.get('version') != system.version:
            raise DomainError('VERSION_CONFLICT', 409)
        target = db.get(User, user_id)
        if not target or target.org_id != user.org_id or target.role == 'vendor' or not access.active(db, target):
            raise DomainError('NOT_FOUND', 404)
        if set(body) != {'version', 'role'} or body['role'] not in ('operator', 'reviewer', 'viewer', ''):
            raise DomainError('INVALID_FIELDS')
        if target.id == system.owner_id or access.is_admin(db, target) or access.organization_role(db, target) == 'manager':
            raise DomainError('FORBIDDEN', 403)
        row = db.get(AssessmentMember, (system_id, user_id))
        if row:
            if body['role']:
                row.role = body['role']
            else:
                db.delete(row)
        elif body['role']:
            db.add(AssessmentMember(system_id=system_id, user_id=user_id, role=body['role']))
        system.version += 1
        access.revoke(db, user_id)
        access.audit(db, user, 'assessment.member_changed', {'system_id': system_id, 'user_id': user_id, **body})
        db.commit()
        return {'ok': True}
