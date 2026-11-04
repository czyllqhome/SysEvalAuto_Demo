"""Deterministic High-source-risk gate using immutable supplier submissions."""
from .db import Prd, Submission, SupplierRound
from .domain import DomainError


def assessment(db, system):
    round_ = db.get(SupplierRound, system.round_id) if system.round_id else None
    if not round_ or not round_.submitted_id:
        return {'status': 'awaiting_submission', 'blocking_requirements': [], 'failed_requirements': []}
    prd = db.get(Prd, round_.prd_id)
    submission = db.get(Submission, round_.submitted_id)
    # New rounds pin source risk with the PRD. Never consult mutable current library rows.
    controls = round_.snapshot.get('controls', [])
    high = set()
    scoped = False
    for control in controls:
        metadata = control.get('metadata', {})
        source = metadata.get('source', {})
        if source.get('schema') != 'CONTROL-SIX/1':
            continue
        scoped = True
        fields = source.get('languages', {}).get('zh', {}).get('fields', {})
        if str(fields.get('risk_level', '')).strip().casefold() == 'high':
            high.add(control['id'])
    blocking, failed = [], []
    for requirement in prd.data['requirements'] if prd else []:
        if not high.intersection(requirement['source_control_ids']):
            continue
        status = submission.data.get(requirement['id'], {}).get('implementation_status') if submission else None
        if status != 'yes':
            blocking.append(requirement['id'])
        if status == 'no':
            failed.append(requirement['id'])
    return {'status': 'failed' if failed else 'pending' if blocking else 'ready_for_review' if scoped else 'legacy',
            'blocking_requirements': blocking, 'failed_requirements': failed}


def require_passable(db, system):
    result = assessment(db, system)
    if result['blocking_requirements']:
        raise DomainError('HIGH_RISK_CONTROL_UNRESOLVED', 409, result)
