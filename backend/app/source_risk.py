"""Pinned source risk, contextual evidence and explicit customer review gates."""
from .db import Prd, Report, Submission, SupplierRound
from .domain import DomainError


def high_source_controls(controls):
    """Read authored source risk from pinned controls, without inferring missing risk."""
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
    return high, scoped


def high_source_requirements(prd_data, controls):
    high, _ = high_source_controls(controls)
    return [r['id'] for r in prd_data['requirements'] if high.intersection(r['source_control_ids'])]


def assessment(db, system):
    round_ = db.get(SupplierRound, system.round_id) if system.round_id else None
    if not round_ or not round_.submitted_id:
        return {'status': 'awaiting_submission', 'blocking_requirements': [], 'failed_requirements': []}
    prd = db.get(Prd, round_.prd_id)
    submission = db.get(Submission, round_.submitted_id)
    # New rounds pin source risk with the PRD. Never consult mutable current library rows.
    high, scoped = high_source_controls(round_.snapshot.get('controls', []))
    blocking, failed, contextual, high_requirements = [], [], [], []
    clarification, owner_accepted = [], []
    report = db.get(Report, system.report_id) if system.report_id else None
    for requirement in prd.data['requirements'] if prd else []:
        if not high.intersection(requirement['source_control_ids']):
            continue
        high_requirements.append(requirement['id'])
        status = submission.data.get(requirement['id'], {}).get('implementation_status') if submission else None
        findings = [f for f in report.data['findings'] if f['requirement_id'] == requirement['id']] if report else []
        if status == 'needs_clarification':
            clarification.append(requirement['id'])
            # An owner may explicitly accept unresolved clarification with a
            # rationale. Never infer this from an old/bulk decision or AI severity.
            if (report and report.reviewed and report.submission_id == round_.submitted_id and findings
                    and all(report.decisions.get(f['id'], {}).get('decision') == 'accept'
                            and report.decisions[f['id']].get('owner_reviewed') is True
                            and str(report.decisions[f['id']].get('reason', '')).strip() for f in findings)):
                owner_accepted.append(requirement['id'])
                continue
        resolved = (status in ('no', 'partial') and report and report.mode == 'openrouter'
                    and report.submission_id == round_.submitted_id and findings
                    and all(f['severity'] in ('low', 'medium') and f.get('contextual_assessment')
                            and f['contextual_assessment'].get('facts')
                            and not f['contextual_assessment']['uncertainties'] for f in findings))
        if resolved:
            contextual.append(requirement['id'])
            continue
        if status != 'yes':
            blocking.append(requirement['id'])
        if status == 'no' and report and report.mode == 'openrouter' and report.submission_id == round_.submitted_id and any(
            f['severity'] in ('high', 'critical') and f.get('contextual_assessment') for f in findings
        ):
            failed.append(requirement['id'])
    return {'status': 'failed' if failed else 'pending' if blocking else 'ready_for_review' if scoped else 'legacy',
            'blocking_requirements': blocking, 'failed_requirements': failed,
            'contextual_requirements': contextual, 'high_requirements': high_requirements,
            'clarification_requirements': clarification, 'owner_accepted_requirements': owner_accepted}


def require_passable(db, system):
    result = assessment(db, system)
    if result['blocking_requirements']:
        raise DomainError('HIGH_RISK_CONTROL_UNRESOLVED', 409, result)
