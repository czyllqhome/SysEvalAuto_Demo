"""Shared creation commands for both assessment entry points. Caller owns commit."""
from datetime import date

from sqlalchemy import select

from . import access
from .db import AssessmentProfile, Audit, Project, ProjectPurpose, System, SystemAsset
from .domain import DomainError


def assessment_kind(value):
    if value not in ('new', 'existing'):
        raise DomainError('INVALID_FIELDS')
    return value


def required_text(body, key, maximum=200):
    value = body.get(key)
    if not isinstance(value, str) or not value.strip() or len(value) > maximum:
        raise DomainError('INVALID_FIELDS', 422, {'field': key})
    return value.strip()


def create_project(db, user, body):
    access.require_admin(db, user)
    project = Project(org_id=user.org_id, name=required_text(body, 'name'))
    db.add(project)
    db.flush()
    db.add(ProjectPurpose(project_id=project.id, purpose=assessment_kind(body.get('purpose', 'new'))))
    access.audit(db, user, 'project.created', {'project_id': project.id})
    return project


def create_assessment(db, user, body):
    kind = assessment_kind(body.get('assessment_type', 'new'))
    if not access.can_create(db, user):
        raise DomainError('FORBIDDEN', 403)
    if body.get('project_id'):
        raise DomainError('PROJECTS_RETIRED', 422)
    data = {}
    if kind == 'existing':
        data = {key: required_text(body, key, 8000 if key == 'scope' else 200)
                for key in ('scope', 'environment', 'system_version', 'as_of', 'trigger')}
        try:
            date.fromisoformat(data['as_of'])
        except ValueError as exc:
            raise DomainError('INVALID_FIELDS') from exc
    if body.get('predecessor_id') or body.get('asset_id'):
        raise DomainError('INVALID_FIELDS', 422)
    system = System(org_id=user.org_id, owner_id=user.id, name=required_text(body, 'name'), draft={'blocks': {}})
    db.add(system)
    db.flush()
    db.add(AssessmentProfile(system_id=system.id, kind=kind, data=data))
    db.add(Audit(system_id=system.id, actor_id=user.id, action='system.created'))
    return system


def profile_view(db, system):
    profile = db.get(AssessmentProfile, system.id)
    if not profile:
        return {'assessment_type': 'new', 'asset_id': None, 'predecessor_id': None, 'assessment_scope': {}}
    result = {'assessment_type': profile.kind, 'asset_id': profile.asset_id,
              'predecessor_id': profile.predecessor_id, 'assessment_scope': profile.data}
    if profile.asset_id:
        asset = db.get(SystemAsset, profile.asset_id)
        rounds = list(db.scalars(select(System.id).join(AssessmentProfile, AssessmentProfile.system_id == System.id)
                                 .where(AssessmentProfile.asset_id == profile.asset_id).order_by(System.created_at, System.id)))
        result.update({'asset_name': asset.name, 'project_id': asset.project_id,
                       'assessment_round': rounds.index(system.id) + 1 if system.id in rounds else 1})
    if profile.kind == 'existing':
        from .db import CurrentAssessment
        from .existing_service import expired_gaps
        row = db.get(CurrentAssessment, (system.id, system.revision))
        if row and expired_gaps(row.data):
            result['status'] = 'REMEDIATING'
    return result


def creation_options(db, user):
    return {'projects': [], 'assets': [], 'can_create': access.can_create(db, user)}
