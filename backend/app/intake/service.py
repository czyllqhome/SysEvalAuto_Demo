"""Questionnaire persistence and explicit transition into the existing risk workflow."""
import copy
from decimal import Decimal
from sqlalchemy import select
from .. import access, service
from ..db import Assignment, Audit, Questionnaire
from ..domain import DomainError
from .assessment import ValidationError, evaluate, value_of
from .questionnaire import MAPPING_VERSION, QUESTIONNAIRE_VERSION, schema


def result(raw, submit=False):
    try:
        return evaluate(raw, submit)
    except ValidationError as exc:
        raise DomainError('QUESTIONNAIRE_INVALID', 422, exc.errors) from None


def facts(answers):
    """Only derive facts supported by the questionnaire; privileges still need Q3."""
    output = {}
    personal, sensitive = value_of(answers, 'DATA-01'), value_of(answers, 'DATA-03')
    if sensitive == 'yes':
        output['Q1'] = 'L3'
    elif personal == 'yes':
        output['Q1'] = 'L2'
    interruption = value_of(answers, 'BIZ-02')
    if interruption == 'none':
        output['Q2'] = 'L3'
    elif interruption == 'duration' and answers['BIZ-02'].get('details', {}).get('amount'):
        minutes = Decimal(str(answers['BIZ-02']['details']['amount']))
        output['Q2'] = 'L3' if minutes < 240 else 'L2' if minutes < 1440 else 'L1'
    if value_of(answers, 'NET-01') == 'yes':
        output['Q4'] = 'L2'
    if value_of(answers, 'BIZ-03') in {'none', 'partial'}:
        output['Q5'] = 'L2'
    return output


def view(db, user, system):
    entry = db.get(Questionnaire, system.id)
    assignment = db.get(Assignment, system.id)
    return {'definition': schema(), 'snapshot': entry.snapshot if entry else {'answers': {}, 'tags': [], 'status': 'draft'},
            'version': entry.version if entry else 0, 'workflow_status': entry.workflow_status if entry else 'draft',
            'suggested_facts': facts(entry.snapshot.get('answers', {})) if entry else {},
            'assignment': {'project_id': assignment.project_id, 'operator_id': assignment.operator_id,
                           'reviewer_ids': assignment.reviewer_ids} if assignment else None,
            'permissions': sorted(access.capabilities(db, user, system))}


def save(db, user, system, body):
    if not schema()['questions']:
        raise DomainError('METHODOLOGY_NOT_CONFIGURED', 409)
    if 'edit' not in access.capabilities(db, user, system):
        raise DomainError('FORBIDDEN', 403)
    if body.get('questionnaire_version') != QUESTIONNAIRE_VERSION or body.get('mapping_version') != MAPPING_VERSION:
        raise DomainError('QUESTIONNAIRE_VERSION', 409)
    entry = db.scalar(select(Questionnaire).where(Questionnaire.system_id == system.id).with_for_update())
    if body.get('version') != system.version or body.get('questionnaire_revision') != (entry.version if entry else 0):
        raise DomainError('VERSION_CONFLICT', 409)
    if entry and entry.workflow_status not in {'draft', 'returned'}:
        raise DomainError('QUESTIONNAIRE_LOCKED', 409)
    action = body.get('action', 'draft')
    if action not in {'draft', 'submit'}:
        raise DomainError('INVALID_FIELDS')
    cleaned = result(body.get('answers'), action == 'submit')
    previous = copy.deepcopy(entry.snapshot) if entry else None
    changed = cleaned['answers'] != (previous or {}).get('answers', {})
    if not entry:
        entry = Questionnaire(system_id=system.id)
        db.add(entry)
    else:
        entry.version += 1
    entry.snapshot = {**cleaned, 'questionnaire_version': QUESTIONNAIRE_VERSION, 'mapping_version': MAPPING_VERSION}
    entry.workflow_status = 'submitted' if action == 'submit' else entry.workflow_status or 'draft'
    if changed and (system.classification or system.context_revision_id):
        service.invalidate(db, system, 'CLASSIFYING')
        system.classification = {}
        system.context_revision_id = None
        system.draft = {**system.draft, 'proposal_stale': True}
    assignment = db.get(Assignment, system.id)
    if assignment:
        assignment.contributors = sorted(set(assignment.contributors) | {user.id})
    system.version += 1
    db.add(Audit(system_id=system.id, actor_id=user.id, action='questionnaire.' + ('submitted' if action == 'submit' else 'saved'),
                 detail={'previous': previous, 'snapshot': entry.snapshot}))
    db.flush()
    return entry
