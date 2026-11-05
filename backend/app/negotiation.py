"""Requirement-scoped remediation rounds with immutable accepted commitments."""
import copy

from sqlalchemy import func, select

from .db import Audit, Prd, Report, Submission, SupplierRound
from .domain import DomainError, SupplierAnswer


def scope(round_, prd):
    return set(round_.snapshot.get('review_scope', [r['id'] for r in prd.data['requirements']]))


def accepted(round_):
    return round_.snapshot.get('accepted_requirements', {})


def round_number(db, round_):
    if 'round_number' in round_.snapshot:
        return round_.snapshot['round_number']
    # Older rounds have no ordinal. Their immutable submission times supply it.
    submitted = db.get(Submission, round_.submitted_id) if round_.submitted_id else None
    query = select(func.count()).select_from(Submission).join(SupplierRound, SupplierRound.id == Submission.round_id).where(
        SupplierRound.system_id == round_.system_id, SupplierRound.prd_id == round_.prd_id,
        SupplierRound.supplier_org_id == round_.supplier_org_id)
    if submitted:
        query = query.where(Submission.created_at <= submitted.created_at)
    return (db.scalar(query) or 0) + (0 if submitted else 1)


def merge_answers(round_, prd, answers, *, complete=False):
    """Allow changes only to returned requirements, including through legacy clients/CSV."""
    allowed = scope(round_, prd)
    carried = accepted(round_)
    if not isinstance(answers, dict) or not set(answers) <= allowed | set(carried):
        raise DomainError('INVALID_FIELDS')
    for rid in set(answers) - allowed:
        value = SupplierAnswer.model_validate(answers[rid]).model_dump(mode='json')
        if value != carried[rid]['answer']:
            raise DomainError('ACCEPTED_REQUIREMENT_LOCKED', 409)
    if complete and not allowed <= set(answers):
        raise DomainError('FORM_INCOMPLETE')
    current = {rid: value for rid, value in answers.items() if rid in allowed}
    if complete:
        current = {rid: SupplierAnswer.model_validate(value).model_dump(mode='json') for rid, value in current.items()}
    return {**{rid: copy.deepcopy(item['answer']) for rid, item in carried.items()}, **current}


def carried_findings(round_):
    findings, decisions = [], {}
    for item in accepted(round_).values():
        findings.extend(copy.deepcopy(item['findings']))
        decisions.update(copy.deepcopy(item['decisions']))
    return findings, decisions


def open_round(db, system, reason='', actor_id=None, *, record_audit=True):
    from .service import require_state
    require_state(system, 'RESULT_REVIEW', 'NEGOTIATING', 'FINAL_CONFIRMATION')
    if not isinstance(reason, str):
        raise DomainError('INVALID_FIELDS')
    old = db.get(SupplierRound, system.round_id)
    report = db.get(Report, system.report_id) if system.report_id else None
    if not old or not old.submitted_id:
        raise DomainError('ROUND_CLOSED', 409)
    submission = db.get(Submission, old.submitted_id)
    prd = db.get(Prd, old.prd_id)
    snapshot = copy.deepcopy(old.snapshot)
    if report and report.reviewed and report.submission_id == submission.id:
        grouped = {r['id']: [] for r in prd.data['requirements']}
        for finding in report.data['findings']:
            grouped[finding['requirement_id']].append(finding)
        if any(not fs or any(not report.decisions.get(f['id'], {}).get('reason', '').strip()
                            or report.decisions[f['id']].get('decision') not in ('accept', 'changes')
                            for f in fs) for fs in grouped.values()):
            raise DomainError('REVIEW_INCOMPLETE')
        returned = [rid for rid, fs in grouped.items()
                    if any(report.decisions[f['id']]['decision'] == 'changes' for f in fs)]
        if not returned:
            raise DomainError('NO_CHANGES_REQUESTED', 409)
        carried = copy.deepcopy(accepted(old))
        feedback = {}
        for rid, fs in grouped.items():
            if rid in returned:
                feedback[rid] = [{'finding_id': f['id'], 'reason': report.decisions[f['id']]['reason']}
                                 for f in fs if report.decisions[f['id']]['decision'] == 'changes']
            elif rid not in carried:
                # Namespaces prevent collisions with newly generated finding IDs.
                mapped = [{**copy.deepcopy(f), 'id': f"accepted:{report.id}:{f['id']}"} for f in fs]
                carried[rid] = {'round_id': old.id, 'submission_id': submission.id, 'report_id': report.id,
                                'mode': report.mode, 'answer': copy.deepcopy(submission.data[rid]),
                                'findings': mapped,
                                'decisions': {new['id']: copy.deepcopy(report.decisions[original['id']])
                                              for original, new in zip(fs, mapped, strict=True)}}
        snapshot.update(review_scope=returned, accepted_requirements=carried, owner_feedback=feedback,
                        previous_round_id=old.id, previous_report_id=report.id,
                        round_number=round_number(db, old) + 1)
    elif not reason.strip():
        raise DomainError('REVIEW_INCOMPLETE')
    else:
        # Explicit legacy negotiation without item decisions requires full revalidation.
        for key in ('review_scope', 'accepted_requirements', 'owner_feedback'):
            snapshot.pop(key, None)
        snapshot.update(previous_round_id=old.id, round_number=round_number(db, old) + 1)
    snapshot['instructions'] = reason
    if report and report.decisions.get('_exceptions'):
        snapshot['legacy_exceptions'] = copy.deepcopy(report.decisions['_exceptions'])
    new = SupplierRound(system_id=system.id, supplier_org_id=old.supplier_org_id, prd_id=old.prd_id,
                        snapshot=snapshot, draft=copy.deepcopy(submission.data))
    db.add(new)
    db.flush()
    old.status = 'closed'
    system.round_id, system.report_id, system.baseline_id = new.id, None, None
    system.status = 'VENDOR_FILLING'
    if record_audit:
        db.add(Audit(system_id=system.id, actor_id=actor_id, action='negotiation.opened', detail={
            'previous_round_id': old.id, 'round_id': new.id, 'review_scope': sorted(scope(new, prd)),
            'accepted_requirements': sorted(accepted(new))}))
    return {'round_id': new.id}
