"""Read-only commitment summaries from the published PRD and immutable submission."""
from .db import Prd, Submission


def source_fields(control):
    source = control.get('metadata', {}).get('source', {})
    return source.get('languages', {}).get('zh', {}).get('fields') or source.get('fields', {})


def source_risk(control):
    # Match the canonical Chinese source used by the existing High-risk gate.
    source = control.get('metadata', {}).get('source', {})
    fields = (source.get('languages', {}).get('zh', {}).get('fields', {})
              if source.get('schema') == 'CONTROL-SIX/1' else source_fields(control))
    risk = str(fields.get('risk_level', '')).strip().casefold()
    return risk if risk in ('high', 'medium', 'low') else 'unknown'


def summary(db, round_, report=None):
    if not round_ or not round_.submitted_id:
        return None
    submission = db.get(Submission, round_.submitted_id)
    prd = db.get(Prd, round_.prd_id)
    if not submission or submission.round_id != round_.id or not prd:
        return None
    controls = {c['id']: c for c in round_.snapshot.get('controls', [])}
    items = []
    rank = {'high': 0, 'medium': 1, 'unknown': 2, 'low': 3}
    from .negotiation import accepted, scope
    for requirement in prd.data['requirements']:
        if requirement['id'] not in scope(round_, prd):
            continue
        originals, domains, risks = [], [], []
        for cid in dict.fromkeys(requirement['source_control_ids']):
            control = controls.get(cid)
            if not control:
                risks.append('unknown')
                continue
            fields = source_fields(control)
            translations = control.get('translations', {})
            authored = translations.get(prd.language) or next(iter(translations.values()), {})
            risk = source_risk(control)
            risks.append(risk)
            domain = fields.get('security_domain') or control.get('domain', '')
            if domain and domain not in domains:
                domains.append(domain)
            originals.append({'id': cid, 'source': fields.get('source', ''),
                              'identifier': fields.get('control_identifier') or control.get('metadata', {}).get('source_ref') or control.get('code', ''),
                              'text': fields.get('control_requirement') or authored.get('description', ''),
                              'risk': risk})
        answer = submission.data.get(requirement['id'], {})
        findings = ([f for f in report.data['findings'] if f['requirement_id'] == requirement['id']]
                    if report and report.submission_id == submission.id else [])
        owner_accepted = bool(report and report.reviewed and findings and all(
            report.decisions.get(f['id'], {}).get('decision') == 'accept' for f in findings))
        residual = 'medium' if owner_accepted and any(
            report.decisions[f['id']].get('residual_severity') == 'medium' for f in findings) else None
        items.append({'requirement_id': requirement['id'], 'title': requirement['title'],
                      'description': requirement['description'], 'origin': requirement['origin'],
                      'domains': domains, 'source_risk': min(risks, key=rank.get) if risks else 'unknown',
                      'status': answer.get('implementation_status', 'unanswered'),
                      'answer': answer, 'controls': originals,
                      'owner_accepted': owner_accepted, 'residual_risk': residual})
    counts = {status: sum(i['status'] == status for i in items)
              for status in ('yes', 'partial', 'no', 'needs_clarification', 'unanswered')}
    counts.update(total=len(items), attention=sum(i['status'] != 'yes' and not i['owner_accepted'] for i in items),
                  owner_accepted=sum(i['owner_accepted'] for i in items), accepted_previous=len(accepted(round_)))
    for risk in ('high', 'medium'):
        counts[f'{risk}_unconfirmed'] = sum(i['source_risk'] == risk and i['status'] != 'yes' and not i['owner_accepted'] for i in items)
    return {'round_id': round_.id, 'submission_id': submission.id, 'submitted_at': submission.created_at,
            'counts': counts, 'items': items}
