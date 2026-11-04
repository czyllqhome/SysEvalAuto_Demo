"""Current-state workflow; shared identity, classification, controls and PRD services."""
import copy
import time
from datetime import date, datetime, timezone
from types import SimpleNamespace

from sqlalchemy import select

from . import access, service
from .assessment_creation import create_assessment, required_text
from .assessment_rules import (ControlVerification, EvidenceReference, RemediationPlan, RetestResult,
                               RiskAcceptance, remediation_after_retest, validate_evidence_scope,
                               validate_report_coverage, verification_summary)
from .baseline_rules import validate_confirmations, validate_current_baseline
from .db import (AssessmentEvidence, AssessmentProfile, ContextRevision, CurrentAssessment, ManagedSupplier,
                 Selection, System, User, uid)
from .domain import DomainError, digest


def today():
    return datetime.now(timezone.utc).date()


def profile_for(db, system):
    profile = db.get(AssessmentProfile, system.id)
    if not profile or profile.kind != 'existing':
        raise DomainError('STATE_CONFLICT', 409)
    return profile


def source_snapshot(db, system):
    return {'revision': system.revision, 'context_revision_id': system.context_revision_id,
            'draft_hash': digest(system.draft.get('blocks', {})),
            'classification': system.classification, 'scope': profile_for(db, system).data,
            'controls': [service.selection_view(c) for c in service.selections(db, system)]}


def current_run(db, system):
    row = db.get(CurrentAssessment, (system.id, system.revision))
    if not row or row.data['source_hash'] != digest(source_snapshot(db, system)):
        raise DomainError('ASSESSMENT_STALE', 409)
    return row


def begin(db, system):
    service.require_state(system, 'CONTROL_REVIEW')
    profile_for(db, system)
    controls = service.selections(db, system)
    if system.draft.get('proposal_stale'):
        raise DomainError('CONTEXT_STALE', 409)
    if not system.context_revision_id or not any(c.included for c in controls):
        raise DomainError('CONTEXT_OR_CONTROLS_REQUIRED', 409)
    if any(not c.included and not c.reason.strip() for c in controls):
        raise DomainError('APPLICABILITY_REVIEW_REQUIRED', 409)
    if db.get(CurrentAssessment, (system.id, system.revision)):
        raise DomainError('STATE_CONFLICT', 409)
    source = source_snapshot(db, system)
    db.add(CurrentAssessment(system_id=system.id, revision=system.revision, data={
        'source': source, 'source_hash': digest(source), 'verifications': {}, 'reports': [],
        'gaps': {}, 'plans': {}, 'history': [], 'report_current': False,
    }))
    system.status = 'VERIFYING'


def save_data(row, data, user, action, detail):
    data['history'].append({'at': time.time(), 'actor_id': user.id, 'action': action, 'detail': copy.deepcopy(detail)})
    row.data = data


def evidence_refs(db, system, ids):
    if not isinstance(ids, list) or len(ids) > 100 or any(not isinstance(i, str) for i in ids) or len(ids) != len(set(ids)):
        raise DomainError('INVALID_FIELDS')
    refs = []
    for evidence_id in ids:
        item = db.get(AssessmentEvidence, evidence_id)
        if not item or item.system_id != system.id or item.revision != system.revision:
            raise DomainError('NOT_FOUND', 404)
        refs.append(EvidenceReference(source_id=item.id, source_revision=item.content_hash, **item.data))
    return refs


def add_evidence(db, system, user, body):
    current_run(db, system)
    data = {key: required_text(body, key, 8000 if key == 'description' else 200)
            for key in ('environment', 'system_version', 'collected_on', 'description')}
    parsed = EvidenceReference(source_id='pending', source_revision='pending', **data)
    if parsed.collected_on > today():
        raise DomainError('INVALID_FIELDS')
    row = AssessmentEvidence(system_id=system.id, revision=system.revision, actor_id=user.id,
                             data=data, content_hash=digest(data))
    db.add(row)
    db.flush()
    return {'evidence_id': row.id}


def verify(db, system, user, body):
    service.require_state(system, 'VERIFYING', 'GAP_REVIEW')
    row = current_run(db, system)
    data = copy.deepcopy(row.data)
    control = next((c for c in data['source']['controls'] if c['id'] == body.get('control_id') and c['included']), None)
    if not control:
        raise DomainError('NOT_FOUND', 404)
    result = ControlVerification(control_id=control['id'], control_revision=digest(control),
                                 scope_revision=data['source_hash'], conclusion=body.get('conclusion'),
                                 reason=required_text(body, 'reason', 8000), method=body.get('method', ''),
                                 evidence=evidence_refs(db, system, body.get('evidence_ids', [])))
    scope = profile_for(db, system).data
    validate_evidence_scope(result, scope['environment'], scope['system_version'], date.fromisoformat(scope['as_of']))
    data['verifications'][control['id']] = result.model_dump(mode='json')
    data['report_current'] = False
    save_data(row, data, user, 'verification.saved', result.model_dump(mode='json'))
    system.status = 'GAP_REVIEW'


def publish_report(db, system, user, body):
    service.require_state(system, 'VERIFYING', 'GAP_REVIEW')
    row = current_run(db, system)
    data = copy.deepcopy(row.data)
    values = [ControlVerification.model_validate(v) for v in data['verifications'].values()]
    controls = data['source']['controls']
    limitations = body.get('limitations', {})
    if not isinstance(limitations, dict):
        raise DomainError('INVALID_FIELDS')
    validate_report_coverage([c['id'] for c in controls if c['included']], values, limitations)
    excluded = [c for c in controls if not c['included'] and c['required']]
    exceptions = body.get('exceptions', {})
    if not isinstance(exceptions, dict):
        raise DomainError('INVALID_FIELDS')
    required_exceptions = [c['id'] for c in excluded]
    required_exceptions += ['classification'] if system.classification.get('exceptions') else []
    for key in required_exceptions:
        required_text(exceptions, key, 8000)
    for value in values:
        if value.conclusion == 'insufficient_evidence':
            required_text(limitations, value.control_id, 8000)
        if value.conclusion in ('partial', 'unsatisfied', 'insufficient_evidence'):
            reviews = body.get('risk_reviews', {})
            risk = reviews.get(value.control_id, {}) if isinstance(reviews, dict) else {}
            if not isinstance(risk, dict) or risk.get('impact') not in ('low', 'medium', 'high') or risk.get('likelihood') not in ('low', 'medium', 'high'):
                raise DomainError('RISK_REVIEW_REQUIRED')
            required_text(risk, 'reason', 8000)
            score = {'low': 1, 'medium': 2, 'high': 3}[risk['impact']] * {'low': 1, 'medium': 2, 'high': 3}[risk['likelihood']]
            gap = data['gaps'].get(value.control_id, {'id': value.control_id, 'status': 'open'})
            gap.update({'reason': value.reason, 'conclusion': value.conclusion,
                        'risk': {**risk, 'priority': 'high' if score >= 6 else 'medium' if score >= 3 else 'low'},
                        'source_hash': digest(value.model_dump(mode='json'))})
            data['gaps'][value.control_id] = gap
    report = {'id': uid(), 'source': data['source'], 'verifications': data['verifications'],
              'limitations': limitations, 'exceptions': exceptions, 'gaps': copy.deepcopy(data['gaps']),
              'summary': required_text(body, 'summary', 8000), 'reviewer_id': user.id,
              'created_at': time.time(), 'mode': 'manual', 'statistics': verification_summary(values)}
    report['content_hash'] = digest(report)
    data['reports'].append(copy.deepcopy(report))
    data['report_current'] = True
    save_data(row, data, user, 'report.published', {'report_id': report['id']})
    system.status = 'REMEDIATING' if data['gaps'] else 'ASSESSMENT_COMPLETE'


def assigned_supplier(db, system, supplier_id):
    supplier = db.get(User, supplier_id)
    if not supplier or not access.active(db, supplier) or supplier.role != 'vendor' or supplier.org_id == system.org_id:
        raise DomainError('NOT_FOUND', 404)
    managed = db.get(ManagedSupplier, supplier.id)
    if not managed or managed.customer_org_id != system.org_id:
        raise DomainError('FORBIDDEN', 403)
    return supplier


def owner_for(db, system, owner_id):
    owner = db.get(User, owner_id)
    if not owner or not access.active(db, owner) or 'read' not in access.capabilities(db, owner, system):
        raise DomainError('NOT_FOUND', 404)


def plan(db, system, user, body):
    service.require_state(system, 'REMEDIATING')
    row = current_run(db, system)
    data = copy.deepcopy(row.data)
    payload = RemediationPlan.model_validate(body.get('plan'))
    owner_for(db, system, payload.owner_id)
    if any(g not in data['gaps'] or data['gaps'][g]['status'] == 'closed' for g in payload.gap_ids):
        raise DomainError('INVALID_FIELDS')
    plan_id = body.get('plan_id') or uid()
    old = data['plans'].get(plan_id)
    if body.get('plan_id') and not old:
        raise DomainError('NOT_FOUND', 404)
    if old and old['status'] == 'closed':
        raise DomainError('STATE_CONFLICT', 409)
    if any(p['id'] != plan_id and set(p['payload']['gap_ids']) & set(payload.gap_ids)
           for p in data['plans'].values()):
        raise DomainError('GAP_ALREADY_ASSIGNED', 409)
    supplier_id = body.get('supplier_id') or None
    if supplier_id:
        assigned_supplier(db, system, supplier_id)
    if old and old.get('supplier_id') != supplier_id:
        raise DomainError('SUPPLIER_CHANGE_REQUIRES_REVIEW', 409)
    if old and old['payload']['gap_ids'] != payload.gap_ids:
        raise DomainError('STATE_CONFLICT', 409)
    if old and old.get('development_id') and payload.kind != 'development':
        raise DomainError('STATE_CONFLICT', 409)
    item = {'id': plan_id, 'payload': payload.model_dump(mode='json'), 'supplier_id': supplier_id,
            'revision': old['revision'] + 1 if old else 1, 'status': 'pending_approval',
            'source_hash': row.data['source_hash'], 'confirmations': [], 'retests': [],
            'previous': copy.deepcopy(old) if old else None}
    item['content_hash'] = digest({k: v for k, v in item.items() if k not in ('previous', 'confirmations', 'retests', 'status')})
    if supplier_id and (not old or old.get('delivery_policy_version')):
        item['delivery_policy_version'] = 1
    data['plans'][plan_id] = item
    for gap_id in payload.gap_ids:
        data['gaps'][gap_id]['status'] = 'planned'
        data['gaps'][gap_id].pop('acceptance', None)
    save_data(row, data, user, 'plan.saved', item)


def plan_for(data, plan_id):
    item = data['plans'].get(plan_id)
    if not item:
        raise DomainError('NOT_FOUND', 404)
    return item


def approve_plan(db, system, user, body, supplier=False):
    row = current_run(db, system)
    data = copy.deepcopy(row.data)
    item = plan_for(data, body.get('plan_id'))
    if item['status'] != 'pending_approval':
        raise DomainError('STATE_CONFLICT', 409)
    validate_current_baseline(item['id'], body.get('plan_id'), item['content_hash'], body.get('content_hash'))
    if supplier:
        if item['supplier_id'] != user.id:
            raise DomainError('NOT_FOUND', 404)
        assigned_supplier(db, system, user.id)
    party = 'supplier' if supplier else 'customer'
    if any(c['actor_id'] == user.id and c['party'] != party for c in item['confirmations']):
        raise DomainError('DISTINCT_APPROVERS_REQUIRED', 409)
    if not any(c['party'] == party for c in item['confirmations']):
        item['confirmations'].append({'party': party, 'actor_id': user.id, 'content_hash': item['content_hash']})
    required = ('customer', 'supplier') if item['supplier_id'] else ('customer',)
    if {c['party'] for c in item['confirmations']} == set(required):
        validate_confirmations([SimpleNamespace(**c) for c in item['confirmations']], item['content_hash'], required)
        item['status'] = 'in_progress'
        item['approved_at'] = time.time()
    save_data(row, data, user, 'plan.confirmed', {'plan_id': item['id'], 'party': party})


def accept_risk(db, system, user, body):
    service.require_state(system, 'REMEDIATING')
    row = current_run(db, system)
    data = copy.deepcopy(row.data)
    gap = data['gaps'].get(body.get('gap_id'))
    if not gap or gap['status'] == 'closed':
        raise DomainError('NOT_FOUND', 404)
    if any(gap['id'] in p['payload']['gap_ids'] for p in data['plans'].values()):
        raise DomainError('GAP_ALREADY_ASSIGNED', 409)
    acceptance = RiskAcceptance.model_validate(body.get('acceptance'))
    owner_for(db, system, acceptance.owner_id)
    if acceptance.review_on <= today():
        raise DomainError('INVALID_FIELDS')
    gap['acceptance'] = {**acceptance.model_dump(mode='json'), 'approved_by': user.id, 'approved_at': time.time()}
    gap['status'] = 'accepted_risk'
    save_data(row, data, user, 'risk.accepted', gap)


def create_development(db, system, user, body):
    row = current_run(db, system)
    data = copy.deepcopy(row.data)
    item = plan_for(data, body.get('plan_id'))
    if item['payload']['kind'] != 'development' or item['status'] != 'in_progress' or item.get('development_id'):
        raise DomainError('STATE_CONFLICT', 409)
    child = create_assessment(db, user, {'name': system.name + ' / ' + item['id'][:8],
        'assessment_type': 'new',
        'type_reason': 'Incremental development for reviewed remediation gaps'})
    child_profile = db.get(AssessmentProfile, child.id)
    child_profile.data = {'remediation_source': {'system_id': system.id, 'revision': system.revision,
        'plan_id': item['id'], 'plan_hash': item['content_hash'], 'gap_ids': item['payload']['gap_ids']}}
    child.context = copy.deepcopy(system.context)
    child.context['summary'] = item['payload']['scope']
    child.context['functions'] = [{'id': 'remediation', 'title': item['payload']['scope'],
        'description': '\n'.join(item['payload']['acceptance_criteria']), 'source_blocks': ['goal']}]
    child.draft = {'blocks': {'goal': item['payload']['scope']}}
    child.classification = copy.deepcopy(system.classification)
    revision = ContextRevision(system_id=child.id, source={'remediation': child_profile.data}, data=child.context)
    db.add(revision)
    db.flush()
    child.context_revision_id = revision.id
    child.status = 'CONTROL_REVIEW'
    for control in service.selections(db, system, included_only=True):
        if control.control_id in item['payload']['gap_ids']:
            db.add(Selection(system_id=child.id, revision=child.revision, control_id=control.control_id,
                             included=True, reason='', origin='remediation', snapshot=copy.deepcopy(control.snapshot)))
    item['development_id'] = child.id
    save_data(row, data, user, 'development.linked', {'plan_id': item['id'], 'system_id': child.id})
    return {'development_id': child.id}


def submit_completion(db, system, user, body, delivery_bridge=False):
    row = current_run(db, system)
    data = copy.deepcopy(row.data)
    item = plan_for(data, body.get('plan_id'))
    if item.get('delivery_policy_version') and not delivery_bridge:
        raise DomainError('DELIVERY_WORKFLOW_REQUIRED', 409)
    if item['status'] != 'in_progress':
        raise DomainError('STATE_CONFLICT', 409)
    if item['payload']['kind'] == 'development':
        child = db.get(System, item.get('development_id')) if item.get('development_id') else None
        if not child or child.status != 'PENDING_DEVELOPMENT':
            raise DomainError('DEVELOPMENT_BASELINE_REQUIRED', 409)
        from .db import Baseline
        baseline = db.get(Baseline, child.baseline_id)
        if item['supplier_id'] and baseline.payload['supplier_org_id'] != db.get(User, item['supplier_id']).org_id:
            raise DomainError('BASELINE_CHANGED', 409)
    refs = evidence_refs(db, system, body.get('evidence_ids', []))
    if not refs:
        raise DomainError('EVIDENCE_REQUIRED')
    validate_delivery_evidence(db, item, refs)
    item['completion'] = {'description': required_text(body, 'description', 8000),
                          'evidence': [r.model_dump(mode='json') for r in refs], 'actor_id': user.id}
    item['status'] = 'awaiting_retest'
    save_data(row, data, user, 'completion.submitted', {'plan_id': item['id'], **item['completion']})


def retest(db, system, user, body):
    row = current_run(db, system)
    data = copy.deepcopy(row.data)
    item = plan_for(data, body.get('plan_id'))
    from .delivery_service import retest_guard, retest_failed
    retest_guard(db, item)
    refs = evidence_refs(db, system, body.get('evidence_ids', []))
    result = RetestResult(plan_hash=body.get('content_hash'), passed=body.get('passed'),
                          reason=required_text(body, 'reason', 8000), evidence=refs)
    validate_delivery_evidence(db, item, refs)
    target_version = required_text(body, 'system_version')
    scope = profile_for(db, system).data
    for ref in refs:
        if ref.environment != scope['environment'] or ref.system_version != target_version or ref.collected_on > today():
            raise DomainError('EVIDENCE_SCOPE_MISMATCH')
    item['status'] = remediation_after_retest(item['status'], item['content_hash'], result)
    if not result.passed:
        retest_failed(db, item)
    item['retests'].append({**result.model_dump(mode='json'), 'reviewer_id': user.id, 'at': time.time()})
    if item['status'] == 'verified':
        item['status'] = 'closed'
        for gap_id in item['payload']['gap_ids']:
            data['gaps'][gap_id]['status'] = 'closed'
    save_data(row, data, user, 'retest.reviewed', {'plan_id': item['id'], 'passed': result.passed})


def validate_delivery_evidence(db, plan, refs):
    approved_at = plan.get('approved_at')
    if not approved_at:
        raise DomainError('STATE_CONFLICT', 409)
    for ref in refs:
        record = db.get(AssessmentEvidence, ref.source_id)
        if record.created_at < approved_at or ref.collected_on < datetime.fromtimestamp(approved_at, timezone.utc).date():
            raise DomainError('NEW_DELIVERY_EVIDENCE_REQUIRED')


def expired_gaps(data):
    return [g['id'] for g in data['gaps'].values() if g['status'] == 'accepted_risk'
            and date.fromisoformat(g['acceptance']['review_on']) <= today()]


def refresh_expired(db, system, user):
    row = db.get(CurrentAssessment, (system.id, system.revision))
    if row and expired_gaps(row.data):
        data = copy.deepcopy(row.data)
        expired = expired_gaps(data)
        for key in expired:
            data['gaps'][key]['status'] = 'open'
        system.status = 'REMEDIATING'
        save_data(row, data, user, 'risk.expired', {'gap_ids': expired})


def finalize(db, system, user, body):
    row = current_run(db, system)
    data = copy.deepcopy(row.data)
    if not data['report_current'] or expired_gaps(data) or any(g['status'] not in ('closed', 'accepted_risk') for g in data['gaps'].values()):
        raise DomainError('REMEDIATION_INCOMPLETE', 409)
    next_review = required_text(body, 'next_review_on')
    try:
        if date.fromisoformat(next_review) <= today():
            raise ValueError()
    except ValueError as exc:
        raise DomainError('INVALID_FIELDS') from exc
    data['next_review_on'] = next_review
    system.status = 'ACCEPTED_RISKS' if any(g['status'] == 'accepted_risk' for g in data['gaps'].values()) else 'ASSESSMENT_COMPLETE'
    save_data(row, data, user, 'assessment.completed', {'next_review_on': next_review})


def reopen(db, system, user):
    row = current_run(db, system)
    data = copy.deepcopy(row.data)
    if system.status not in ('ACCEPTED_RISKS', 'ASSESSMENT_COMPLETE', 'REMEDIATING'):
        raise DomainError('STATE_CONFLICT', 409)
    for gap in data['gaps'].values():
        if gap['status'] == 'accepted_risk':
            gap['status'] = 'open'
    system.status = 'REMEDIATING'
    save_data(row, data, user, 'assessment.reopened', {})


def view(db, system):
    row = db.get(CurrentAssessment, (system.id, system.revision))
    profile = profile_for(db, system)
    records = list(db.scalars(select(AssessmentEvidence).where(AssessmentEvidence.system_id == system.id,
                                                              AssessmentEvidence.revision == system.revision)))
    return {'scope': profile.data, 'run': row.data if row else None,
            'stale': bool(row and row.data['source_hash'] != digest(source_snapshot(db, system))),
            'expired_gaps': expired_gaps(row.data) if row else [],
            'evidence': [{'id': e.id, 'content_hash': e.content_hash, **e.data} for e in records],
            'history_revisions': list(db.scalars(select(CurrentAssessment.revision).where(CurrentAssessment.system_id == system.id)))}


def render_report(report, language):
    """Render the immutable reviewed snapshot, never live mutable assessment data."""
    def text(zh, en):
        return zh if language == 'zh' else en
    def cell(value):
        return str(value).replace('|', '\\|').replace('\n', '<br>')
    scope = report['source']['scope']
    lines = ['# ' + text('现状评估报告（人工审核）', 'Current-state assessment (human reviewed)'),
             '', report['summary'], '', '## ' + text('评估范围', 'Assessment scope'), '',
             f"{scope['scope']}\n\n{scope['environment']} / {scope['system_version']} / {scope['as_of']}", '',
             text('系统等级与控制达标程度独立，本报告不是外部认证结论。',
                  'System classification and control effectiveness are separate. This report is not an external certification.'),
             '', '## ' + text('控制核验', 'Control verification'), '',
             '| ' + text('控制 | 结论 | 理由 | 方法', 'Control | Conclusion | Rationale | Method') + ' |',
             '|---|---|---|---|']
    statuses = {'satisfied': text('满足', 'Satisfied'), 'partial': text('部分满足', 'Partially satisfied'),
                'unsatisfied': text('不满足', 'Unsatisfied'), 'insufficient_evidence': text('证据不足', 'Insufficient evidence')}
    controls = {c['id']: c for c in report['source']['controls']}
    for value in report['verifications'].values():
        control = controls[value['control_id']]
        lines.append('| ' + ' | '.join(cell(v) for v in (control['code'], statuses[value['conclusion']], value['reason'], value['method'])) + ' |')
    lines += ['', '## ' + text('差距及风险', 'Gaps and risks'), '']
    for gap in report['gaps'].values():
        risk = gap['risk']
        levels = {'high': text('高', 'High'), 'medium': text('中', 'Medium'), 'low': text('低', 'Low')}
        lines += [f"### {controls[gap['id']]['code']}", '', gap['reason'], '',
                  f"{text('优先级', 'Priority')}: {levels[risk['priority']]} · {risk['reason']}", '']
    lines += ['## ' + text('评估限制与例外', 'Limitations and exceptions'), '']
    for key, value in {**report['limitations'], **report['exceptions']}.items():
        lines += [f"- {controls[key]['code'] if key in controls else key}: {value}"]
    lines += ['', '## ' + text('证据索引', 'Evidence index'), '']
    refs = {e['source_id']: e for v in report['verifications'].values() for e in v['evidence']}
    for reference in refs.values():
        lines += [f"### {reference['source_id']}", '', reference['description'], '',
                  f"{reference['environment']} / {reference['system_version']} / {reference['collected_on']}",
                  f"SHA-256: {reference['source_revision']}", '']
    lines += ['## ' + text('版本与审核', 'Version and review'), '',
              f"{text('审核人', 'Reviewer')}: {report['reviewer_id']}",
              f"{text('报告标识', 'Report ID')}: {report['id']}", f"SHA-256: {report['content_hash']}"]
    return '\n'.join(lines) + '\n'
