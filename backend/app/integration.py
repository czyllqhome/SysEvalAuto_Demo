"""Unified routes for project administration, questionnaires and supplier CSV exchange."""
import re
import secrets
from fastapi import Depends, Query, Request
from fastapi.responses import PlainTextResponse
from sqlalchemy import delete, select
from . import access, service
from .db import (AccountPolicy, AdminAudit, Assignment, Audit, ImportedRecord, ManagedSupplier, Membership,
                 Organization, Project, Questionnaire, SupplierForm, System, User)
from .domain import DomainError, digest
from .intake import csv_service, service as intake


def text(body, key, maximum=200):
    value = body.get(key)
    if not isinstance(value, str) or not value.strip() or len(value) > maximum:
        raise DomainError('INVALID_FIELDS', 422, {'field': key})
    return value.strip()


def register_routes(app, current, get_db, hash_password, verify_password):
    def member(db, user, user_id):
        result = db.get(User, user_id)
        managed = db.get(ManagedSupplier, user_id)
        if not result or not (result.org_id == user.org_id and result.role != 'vendor'
                              or managed and managed.customer_org_id == user.org_id):
            raise DomainError('NOT_FOUND', 404)
        return result

    def user_view(db, user):
        profile = db.get(AccountPolicy, user.id)
        return {'id': user.id, 'name': user.name, 'email': user.email, 'role': user.role,
                'username': profile.username if profile else None,
                'active': access.active(db, user), 'is_admin': access.is_admin(db, user),
                'must_change_password': bool(profile and profile.must_change_password),
                'memberships': [{'project_id': m.project_id, 'role': m.role} for m in db.scalars(select(Membership).where(Membership.user_id == user.id))]}

    @app.post('/api/v1/auth/password')
    def password(body: dict, user=Depends(current), db=Depends(get_db)):
        if not verify_password(str(body.get('current_password', '')), user.password_hash):
            raise DomainError('LOGIN_FAILED', 403)
        user.password_hash = hash_password(text(body, 'password', 256))
        profile = db.get(AccountPolicy, user.id)
        if profile:
            profile.must_change_password = False
        access.revoke(db, user.id)
        access.audit(db, user, 'password.changed', {})
        db.commit()
        return {'ok': True}

    @app.get('/api/v1/team')
    def team(user=Depends(current), db=Depends(get_db)):
        projects = []
        for p in db.scalars(select(Project).where(Project.org_id == user.org_id)):
            roles = access.project_roles(db, user, p.id)
            if access.is_admin(db, user) or 'manager' in roles:
                projects.append({'id': p.id, 'name': p.name, 'active': p.active, 'roles': sorted(roles)})
        managed_ids = select(ManagedSupplier.user_id).where(ManagedSupplier.customer_org_id == user.org_id)
        users = list(db.scalars(select(User).where((User.org_id == user.org_id) | User.id.in_(managed_ids))))
        if not access.is_admin(db, user):
            if not projects:
                return {'projects': [], 'users': [], 'assessments': []}
            users = [u for u in users if not access.is_admin(db, u)
                     and not db.scalar(select(Membership.user_id).where(
                         Membership.user_id == u.id, Membership.role == 'manager'))]
        assessments = []
        for system in db.scalars(select(System).where(System.org_id == user.org_id)):
            if 'read' in access.capabilities(db, user, system):
                assignment = db.get(Assignment, system.id)
                assessments.append({'id': system.id, 'name': system.name,
                                    'project_id': assignment.project_id if assignment else None})
        return {'projects': projects, 'users': [{**user_view(db, u), 'memberships': [m for m in user_view(db, u)['memberships']
                          if m['project_id'] in {p['id'] for p in projects}]} for u in users], 'assessments': assessments}

    @app.post('/api/v1/admin/users')
    def create_user(body: dict, user=Depends(current), db=Depends(get_db)):
        access.require_admin(db, user)
        if set(body) - {'username', 'name', 'role'}:
            raise DomainError('INVALID_FIELDS')
        username = text(body, 'username', 64).lower()
        if not re.fullmatch(r'[a-z0-9_.-]{3,64}', username):
            raise DomainError('INVALID_FIELDS')
        if db.scalar(select(AccountPolicy).where(AccountPolicy.username == username)):
            raise DomainError('ACCOUNT_EXISTS', 409)
        # Optional initial project roles commit with the account and audit events.
        role = body.get('role', 'viewer')
        if role not in ('manager', 'operator', 'reviewer', 'viewer', 'supplier'):
            raise DomainError('INVALID_FIELDS')
        temporary = secrets.token_urlsafe(18)
        supplier = role == 'supplier'
        org_id = user.org_id
        if supplier:
            org = Organization(name=text(body, 'name', 120), kind='supplier')
            db.add(org)
            db.flush()
            org_id = org.id
        created = User(org_id=org_id, email=username + '@accounts.local', name=text(body, 'name', 120),
                       password_hash=hash_password(temporary), role='vendor' if supplier else 'member')
        db.add(created)
        db.flush()
        if supplier:
            db.add(ManagedSupplier(user_id=created.id, customer_org_id=user.org_id))
        db.add(AccountPolicy(user_id=created.id, username=username, must_change_password=True))
        access.audit(db, user, 'user.created', {'user_id': created.id})
        from .db import OrganizationRole
        db.add(OrganizationRole(user_id=created.id, role=role))
        access.audit(db, user, 'organization.role_changed', {'user_id': created.id, 'role': role})
        db.commit()
        return {'id': created.id, 'temporary_password': temporary}

    @app.put('/api/v1/admin/users/{user_id}')
    def update_user(user_id: str, body: dict, user=Depends(current), db=Depends(get_db)):
        access.require_admin(db, user)
        # Serialize last-administrator checks inside the organization.
        db.scalar(select(Organization).where(Organization.id == user.org_id).with_for_update())
        target = member(db, user, user_id)
        if not body or set(body) - {'active', 'is_admin'} or any(type(v) is not bool for v in body.values()):
            raise DomainError('INVALID_FIELDS')
        profile = db.get(AccountPolicy, target.id)
        if not profile:
            profile = AccountPolicy(user_id=target.id, active=True, admin=target.role == 'owner')
            db.add(profile)
        if 'active' in body:
            profile.active = body['active']
        if body.get('is_admin') and target.role == 'vendor':
            raise DomainError('DUTIES_CONFLICT', 403)
        if 'is_admin' in body:
            profile.admin = body['is_admin']
        db.flush()
        if not any(access.active(db, u) and access.is_admin(db, u) for u in db.scalars(select(User).where(User.org_id == user.org_id))):
            raise DomainError('LAST_ADMIN', 409)
        access.revoke(db, target.id)
        access.audit(db, user, 'user.updated', {'user_id': target.id, **body})
        db.commit()
        return {'ok': True}

    @app.post('/api/v1/admin/users/{user_id}/reset-password')
    def reset(user_id: str, user=Depends(current), db=Depends(get_db)):
        access.require_admin(db, user)
        target = member(db, user, user_id)
        temporary = secrets.token_urlsafe(18)
        target.password_hash = hash_password(temporary)
        profile = db.get(AccountPolicy, target.id)
        if not profile:
            profile = AccountPolicy(user_id=target.id, admin=target.role == 'owner')
            db.add(profile)
        profile.must_change_password = True
        access.revoke(db, target.id)
        access.audit(db, user, 'user.password_reset', {'user_id': target.id})
        db.commit()
        return {'temporary_password': temporary}

    @app.post('/api/v1/admin/projects')
    def create_project(body: dict, request: Request, user=Depends(current), db=Depends(get_db)):
        access.require_admin(db, user)
        from .assessment_creation import create_project
        from .db import Receipt
        key = request.headers.get('Idempotency-Key')
        receipt_id = digest([user.id, 'project.create', key]) if key else None
        if receipt_id:
            receipt = db.get(Receipt, receipt_id)
            if receipt:
                if receipt.request_hash != digest(body):
                    raise DomainError('IDEMPOTENCY_CONFLICT', 409)
                return receipt.response
        p = create_project(db, user, body)
        if receipt_id:
            db.add(Receipt(id=receipt_id, request_hash=digest(body), response={'id': p.id}))
        db.commit()
        return {'id': p.id}

    @app.put('/api/v1/admin/projects/{project_id}/members/{user_id}')
    def roles(project_id: str, user_id: str, body: dict, user=Depends(current), db=Depends(get_db)):
        if not access.is_admin(db, user) and 'manager' not in access.project_roles(db, user, project_id):
            raise DomainError('FORBIDDEN', 403)
        target = member(db, user, user_id)
        project = db.get(Project, project_id)
        if set(body) != {'roles'}:
            raise DomainError('INVALID_FIELDS')
        supplied = access.validate_roles(body.get('roles'))
        if not project or project.org_id != user.org_id or not project.active or not access.active(db, target):
            raise DomainError('NOT_FOUND', 404)
        if not access.is_admin(db, user) and (
                'manager' in supplied or access.is_admin(db, target)
                or db.scalar(select(Membership.user_id).where(
                    Membership.user_id == target.id, Membership.role == 'manager'))):
            raise DomainError('FORBIDDEN', 403)
        if target.role == 'vendor' and supplied not in ([], ['supplier']):
            raise DomainError('DUTIES_CONFLICT', 403)
        if supplied == ['supplier'] and target.role != 'vendor':
            # Never convert a customer contributor or an already-authorized account.
            if (access.is_admin(db, target)
                    or db.scalar(select(Membership.user_id).where(Membership.user_id == target.id))
                    or db.scalar(select(Audit.id).where(Audit.actor_id == target.id))
                    or db.scalar(select(System.id).where(System.owner_id == target.id))):
                raise DomainError('DUTIES_CONFLICT', 403)
            org = Organization(name=target.name, kind='supplier')
            db.add(org)
            db.flush()
            target.org_id, target.role = org.id, 'vendor'
            db.add(ManagedSupplier(user_id=target.id, customer_org_id=user.org_id))
        db.execute(delete(Membership).where(Membership.project_id == project_id, Membership.user_id == user_id))
        for role in supplied:
            db.add(Membership(project_id=project_id, user_id=user_id, role=role))
        access.revoke(db, target.id)
        access.audit(db, user, 'roles.assigned', {'project_id': project_id, 'user_id': user_id, 'roles': supplied})
        db.commit()
        return {'ok': True}

    @app.get('/api/v1/admin/audits')
    def audits(q: str = '', actor_id: str = '', start: float | None = None, end: float | None = None,
               offset: int = Query(0, ge=0), limit: int = Query(300, ge=1, le=300), summary: bool = False,
               user=Depends(current), db=Depends(get_db)):
        access.require_admin(db, user)
        if start is not None and end is not None and start > end:
            raise DomainError('INVALID_FIELDS')
        statement = select(AdminAudit).where(AdminAudit.org_id == user.org_id)
        if q:
            statement = statement.where(AdminAudit.action.contains(q, autoescape=True))
        if actor_id:
            statement = statement.where(AdminAudit.actor_id == actor_id)
        if start is not None:
            statement = statement.where(AdminAudit.created_at >= start)
        if end is not None:
            statement = statement.where(AdminAudit.created_at < end)
        return [{'id': a.id, 'action': a.action, 'actor_id': a.actor_id, 'created_at': a.created_at,
                 **({} if summary else {'detail': a.detail})}
                for a in db.scalars(statement.order_by(AdminAudit.created_at.desc(), AdminAudit.id.desc()).offset(offset).limit(limit))]

    @app.get('/api/v1/admin/audits/{audit_id}')
    def audit_detail(audit_id: str, user=Depends(current), db=Depends(get_db)):
        access.require_admin(db, user)
        item = db.get(AdminAudit, audit_id)
        if not item or item.org_id != user.org_id:
            raise DomainError('NOT_FOUND', 404)
        return {'id': item.id, 'action': item.action, 'actor_id': item.actor_id,
                'created_at': item.created_at, 'detail': item.detail}

    @app.get('/api/v1/admin/import-history')
    def import_history(user=Depends(current), db=Depends(get_db)):
        access.require_admin(db, user)
        return [{'id': r.id, 'source_table': r.source_table, 'data': r.data} for r in db.scalars(
            select(ImportedRecord).where(ImportedRecord.org_id == user.org_id, ImportedRecord.source_table == 'audit_events').limit(1000))]

    @app.put('/api/v1/systems/{system_id}/assignments')
    def assign(system_id: str, body: dict, user=Depends(current), db=Depends(get_db)):
        system = service.system_for(db, user, system_id, write=True)
        if 'manage' not in access.capabilities(db, user, system):
            raise DomainError('FORBIDDEN', 403)
        if body.get('version') != system.version:
            raise DomainError('VERSION_CONFLICT', 409)
        entry = db.get(Questionnaire, system.id)
        if entry and entry.workflow_status not in {'draft', 'returned'}:
            raise DomainError('QUESTIONNAIRE_LOCKED', 409)
        access.set_assignments(db, user, system, body.get('project_id'), body.get('operator_id'), body.get('reviewer_ids', []))
        system.version += 1
        db.add(Audit(system_id=system.id, actor_id=user.id, action='task.assigned', detail={'project_id': body.get('project_id')}))
        db.commit()
        return service.system_view(db, system, user)

    @app.get('/api/v1/systems/{system_id}/questionnaire')
    def get_questionnaire(system_id: str, user=Depends(current), db=Depends(get_db)):
        system = service.system_for(db, user, system_id)
        if user.role == 'vendor':
            raise DomainError('FORBIDDEN', 403)
        return intake.view(db, user, system)

    @app.put('/api/v1/systems/{system_id}/questionnaire')
    def save_questionnaire(system_id: str, body: dict, user=Depends(current), db=Depends(get_db)):
        system = service.system_for(db, user, system_id, write=True)
        intake.save(db, user, system, body)
        db.commit()
        return intake.view(db, user, system)

    @app.post('/api/v1/systems/{system_id}/questionnaire/return')
    def return_questionnaire(system_id: str, body: dict, user=Depends(current), db=Depends(get_db)):
        system = service.system_for(db, user, system_id, write=True)
        if 'manage' not in access.capabilities(db, user, system):
            raise DomainError('FORBIDDEN', 403)
        reason = text(body, 'reason', 500)
        entry = db.get(Questionnaire, system.id)
        if not entry or entry.workflow_status != 'submitted' or body.get('version') != system.version:
            raise DomainError('VERSION_CONFLICT', 409)
        entry.workflow_status = 'returned'
        system.version += 1
        db.add(Audit(system_id=system.id, actor_id=user.id, action='questionnaire.returned', detail={'reason': reason}))
        db.commit()
        return intake.view(db, user, system)

    @app.get('/api/v1/systems/{system_id}/csv-forms')
    def forms(system_id: str, user=Depends(current), db=Depends(get_db)):
        system = service.system_for(db, user, system_id)
        return [{'id': f.id, 'kind': f.kind, 'supplier_id': f.supplier_id} for f in db.scalars(select(SupplierForm).where(
            SupplierForm.system_id == system.id, SupplierForm.revision == system.revision).order_by(SupplierForm.created_at.desc()))
            if (f.kind != 'prd' or f.round_id == system.round_id) and (user.role != 'vendor' or f.kind == 'prd')]

    @app.post('/api/v1/systems/{system_id}/csv-forms')
    def issue_form(system_id: str, body: dict, user=Depends(current), db=Depends(get_db)):
        system = service.system_for(db, user, system_id)
        if body.get('version') != system.version:
            raise DomainError('VERSION_CONFLICT', 409)
        form = csv_service.issue(db, user, system, body.get('kind'), body)
        db.commit()
        return {'id': form.id}

    @app.get('/api/v1/systems/{system_id}/csv-forms/{form_id}/template')
    def template(system_id: str, form_id: str, user=Depends(current), db=Depends(get_db)):
        system = service.system_for(db, user, system_id)
        form = csv_service.get_form(db, user, system, form_id)
        content = csv_service.export(db, user, system, form)
        db.add(Audit(system_id=system.id, actor_id=user.id, action='csv.downloaded', detail={'form_id': form.id}))
        db.commit()
        return PlainTextResponse(content, media_type='text/csv', headers={'Content-Disposition': 'attachment; filename="supplier-response.csv"'})

    @app.post('/api/v1/systems/{system_id}/csv-forms/{form_id}/preview')
    def preview(system_id: str, form_id: str, body: dict, user=Depends(current), db=Depends(get_db)):
        system = service.system_for(db, user, system_id, write=True) if user.role != 'vendor' else service.system_for(db, user, system_id)
        form = csv_service.get_form(db, user, system, form_id, True)
        result = csv_service.preview(db, user, system, form, body)
        db.commit()
        return result

    @app.post('/api/v1/systems/{system_id}/csv-forms/{form_id}/confirm')
    def confirm(system_id: str, form_id: str, body: dict, user=Depends(current), db=Depends(get_db)):
        system = service.system_for(db, user, system_id, write=True) if user.role != 'vendor' else service.system_for(db, user, system_id)
        form = csv_service.get_form(db, user, system, form_id, True)
        csv_service.confirm(db, user, system, form, body)
        db.commit()
        return service.system_view(db, system, user)
