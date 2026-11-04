"""Project roles, account policy and action-level authorization."""
import time
from sqlalchemy import delete, select
from .db import AccountPolicy, AdminAudit, AssessmentMember, Assignment, LoginSession, ManagedSupplier, Membership, OrganizationRole, Project, User
from .domain import DomainError

ROLES = {'manager', 'operator', 'reviewer', 'viewer', 'supplier'}
EDIT_ACTIONS = {'prd.withdrawn', 'control.applicability_completed', 'context.draft_saved', 'classification.confirmed', 'context.confirmed',
                'control.selection_changed', 'control.custom_added', 'prd.revised', 'job.queued'}
REVIEW_ACTIONS = {'prd.approved', 'report.reviewed'}
EDIT_ACTIONS.update({'existing.started', 'existing.evidence_saved', 'existing.verification_saved',
                     'existing.plan_saved', 'existing.completion_saved'})
REVIEW_ACTIONS.update({'existing.report_reviewed', 'existing.retest_reviewed'})
MANAGE_ACTIONS = {'supplier.round_published', 'supplier.invitation_reissued', 'negotiation.opened',
                 'baseline.frozen', 'baseline.confirmed', 'baseline.finalized'}


def validate_roles(supplied):
    if (not isinstance(supplied, list)
            or any(not isinstance(role, str) or role not in ROLES for role in supplied)
            or len(set(supplied)) != len(supplied)):
        raise DomainError('INVALID_FIELDS', 422, {'field': 'roles'})
    if 'supplier' in supplied and len(supplied) != 1:
        raise DomainError('DUTIES_CONFLICT', 403)
    return sorted(supplied)


def policy(db, user):
    return db.get(AccountPolicy, user.id)


def is_admin(db, user):
    item = policy(db, user)
    return item.admin if item else user.role == 'owner'


def require_admin(db, user):
    if not is_admin(db, user):
        raise DomainError('FORBIDDEN', 403)


def active(db, user):
    item = policy(db, user)
    return user is not None and (item is None or item.active)


def organization_role(db, user):
    row = db.get(OrganizationRole, user.id)
    if row:
        return row.role
    if user.role == 'vendor':
        return 'supplier'
    if user.role == 'owner':
        return 'manager'
    roles = set(db.scalars(select(Membership.role).join(Project).where(
        Membership.user_id == user.id, Project.org_id == user.org_id, Project.active.is_(True))))
    return next((r for r in ('manager', 'operator', 'reviewer', 'viewer') if r in roles), 'viewer')


def can_create(db, user):
    return active(db, user) and user.role != 'vendor' and (is_admin(db, user) or organization_role(db, user) == 'manager')


def project_roles(db, user, project_id):
    project = db.get(Project, project_id)
    managed = db.get(ManagedSupplier, user.id) if user.role == 'vendor' else None
    organization = managed.customer_org_id if managed else user.org_id
    if not project or not project.active or project.org_id != organization:
        return set()
    return set(db.scalars(select(Membership.role).where(Membership.project_id == project_id, Membership.user_id == user.id)))


def supplier_project_access(db, user, system):
    managed = db.get(ManagedSupplier, user.id)
    if not managed:
        return True  # Existing invitation-based supplier organizations retain their contract.
    return managed.customer_org_id == system.org_id and active(db, user)


def capabilities(db, user, system):
    if system.draft.get('deleted_at') or user.role == 'vendor' or system.org_id != user.org_id:
        return set()
    if is_admin(db, user):
        return {'read', 'edit', 'review', 'manage'}
    if system.owner_id == user.id and can_create(db, user):
        return {'read', 'edit', 'review', 'manage'}
    member = db.get(AssessmentMember, (system.id, user.id))
    if member:
        if member.role == 'reviewer':
            from .db import Audit
            if db.scalar(select(Audit.id).where(Audit.system_id == system.id, Audit.actor_id == user.id,
                                                Audit.action.in_(EDIT_ACTIONS | {'questionnaire.saved', 'questionnaire.submitted'})).limit(1)):
                return {'read'}
        return {'manager': {'read', 'edit', 'review', 'manage'}, 'operator': {'read', 'edit'},
                'reviewer': {'read', 'review'}, 'viewer': {'read'}}.get(member.role, set())
    if db.get(OrganizationRole, user.id):
        return set()
    assignment = db.get(Assignment, system.id)
    if not assignment:
        return set()
    roles = project_roles(db, user, assignment.project_id)
    result = set()
    if roles & {'manager', 'viewer'} or ('operator' in roles and assignment.operator_id == user.id) or ('reviewer' in roles and user.id in assignment.reviewer_ids):
        result.add('read')
    if 'operator' in roles and assignment.operator_id == user.id:
        result.add('edit')
    if 'reviewer' in roles and user.id in assignment.reviewer_ids and user.id not in assignment.contributors:
        result.add('review')
    if 'manager' in roles:
        result.update({'read', 'edit', 'review', 'manage'})
    return result


def require_action(db, user, system, action, body=None):
    if user.role == 'vendor':
        if action not in {'supplier.draft_saved', 'supplier.submitted', 'baseline.confirmed'}:
            raise DomainError('FORBIDDEN', 403)
        return  # Supplier services additionally check round/organization and the baseline hash.
    need = 'edit' if action in EDIT_ACTIONS else 'review' if action in REVIEW_ACTIONS else 'manage'
    if action == 'job.queued' and (body or {}).get('kind') == 'impact_analysis':
        need = 'review'
    caps = capabilities(db, user, system)
    manager_control_edit = action in {'control.selection_changed', 'control.custom_added', 'prd.withdrawn'} and 'manage' in caps
    if need not in caps and not manager_control_edit:
        raise DomainError('FORBIDDEN', 403)
    assignment = db.get(Assignment, system.id)
    if assignment and 'manage' not in caps and action.startswith('baseline.') and (user.id in assignment.contributors or user.id in assignment.reviewer_ids):
        raise DomainError('DUTIES_CONFLICT', 403)
    if assignment and need == 'edit':
        assignment.contributors = sorted(set(assignment.contributors) | {user.id})


def revoke(db, user_id):
    db.execute(delete(LoginSession).where(LoginSession.user_id == user_id))


def audit(db, user, action, detail):
    db.add(AdminAudit(org_id=user.org_id, actor_id=user.id, action=action, detail=detail))


def identity(db, user):
    item = policy(db, user)
    projects = []
    for project in db.scalars(select(Project).where(Project.org_id == user.org_id, Project.active.is_(True))):
        roles = sorted(project_roles(db, user, project.id))
        if roles:
            projects.append({'id': project.id, 'name': project.name, 'roles': roles})
    return {'id': user.id, 'name': user.name, 'email': user.email, 'role': user.role, 'org_id': user.org_id,
            'is_admin': is_admin(db, user), 'must_change_password': bool(item and item.must_change_password),
            'username': item.username if item else None, 'projects': projects,
            'organization_role': organization_role(db, user), 'can_create': can_create(db, user)}


def set_assignments(db, user, system, project_id, operator_id, reviewer_ids):
    from .db import AssessmentProfile, SystemAsset
    profile = db.get(AssessmentProfile, system.id)
    if profile and profile.asset_id and db.get(SystemAsset, profile.asset_id).project_id != project_id:
        raise DomainError('ASSET_PROJECT_CONFLICT', 409)
    project = db.get(Project, project_id)
    if not project or not project.active or project.org_id != user.org_id:
        raise DomainError('NOT_FOUND', 404)
    if not is_admin(db, user) and 'manager' not in project_roles(db, user, project_id):
        raise DomainError('FORBIDDEN', 403)
    if not isinstance(reviewer_ids, list) or len(reviewer_ids) > 50 or any(not isinstance(x, str) for x in reviewer_ids):
        raise DomainError('INVALID_FIELDS')
    if len(set(reviewer_ids)) != len(reviewer_ids) or operator_id in reviewer_ids:
        raise DomainError('DUTIES_CONFLICT', 403)
    if system.org_id != user.org_id or not isinstance(operator_id, str):
        raise DomainError('FORBIDDEN', 403)
    old = db.get(Assignment, system.id)
    contributors = old.contributors if old else []
    if set(reviewer_ids) & set(contributors):
        raise DomainError('DUTIES_CONFLICT', 403)
    for uid, role in [(operator_id, 'operator'), *((v, 'reviewer') for v in reviewer_ids)]:
        member = db.get(User, uid)
        if not member or not active(db, member) or role not in project_roles(db, member, project_id):
            raise DomainError('INVALID_ASSIGNEE')
    if old:
        old.project_id, old.operator_id, old.reviewer_ids = project_id, operator_id, reviewer_ids
    else:
        db.add(Assignment(system_id=system.id, project_id=project_id, operator_id=operator_id,
                          reviewer_ids=reviewer_ids, contributors=[]))
    system.owner_id = user.id
    system.updated_at = time.time()
