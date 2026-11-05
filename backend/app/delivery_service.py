"""Delivery commands own one transaction together with their HTTP receipt and audit."""
import copy
import hashlib
import time
from datetime import datetime, timezone

from sqlalchemy import func, select

from . import access, existing_service
from .baseline_rules import validate_confirmations
from .db import AssessmentProfile, Assignment, Audit, Baseline, Confirmation, System
from .delivery_models import DeliveryBatch, DeliveryItem, DeliveryReview, DeliverySubmission, EvidenceAttachment
from .delivery_rules import metadata, text, validate_review
from .domain import DomainError, digest
from .evidence_service import MAX_ASSESSMENT, MAX_TOTAL, validate_file


def authorize(db, user, batch, action='read'):
    system = db.get(System, batch.system_id)
    if not access.active(db, user):
        raise DomainError('NOT_FOUND', 404)
    if user.role == 'vendor':
        if (user.org_id != batch.supplier_org_id or batch.supplier_user_id and user.id != batch.supplier_user_id
                or not access.supplier_project_access(db, user, system)):
            raise DomainError('NOT_FOUND', 404)
        if action not in ('read', 'upload', 'draft', 'submit', 'analyze'):
            raise DomainError('FORBIDDEN', 403)
    else:
        caps = access.capabilities(db, user, system)
        if 'read' not in caps:
            raise DomainError('NOT_FOUND', 404)
        assignment = db.get(Assignment, system.id)
        operator = assignment and assignment.operator_id == user.id and 'edit' in caps
        if action in ('upload', 'draft', 'submit') or (action != 'read' and not (caps & {'manage', 'review'} or operator)):
            raise DomainError('FORBIDDEN', 403)
    return system


def source(db, batch, development=False):
    system = db.get(System, batch.system_id)
    if system.revision != batch.revision or batch.status == 'SUPERSEDED':
        raise DomainError('SOURCE_SUPERSEDED', 409)
    if batch.kind == 'baseline':
        baseline = db.get(Baseline, batch.source_id)
        if not baseline or not baseline.finalized or baseline.id != system.baseline_id or baseline.content_hash != batch.source_hash:
            raise DomainError('SOURCE_SUPERSEDED', 409)
        return baseline
    run = existing_service.current_run(db, system)
    plan = existing_service.plan_for(run.data, batch.source_id)
    if plan['content_hash'] != batch.source_hash:
        raise DomainError('SOURCE_SUPERSEDED', 409)
    if development and plan['payload']['kind'] == 'development':
        child = db.get(System, plan.get('development_id')) if plan.get('development_id') else None
        baseline = db.get(Baseline, child.baseline_id) if child and child.baseline_id else None
        if not baseline or not baseline.finalized or child.status != 'PENDING_DEVELOPMENT':
            raise DomainError('DEVELOPMENT_BASELINE_REQUIRED', 409)
        if baseline.payload['supplier_org_id'] != batch.supplier_org_id:
            raise DomainError('BASELINE_CHANGED', 409)
        return baseline
    return plan


def fresh(db, batch):
    try:
        source(db, batch)
        return True
    except DomainError:
        return False


def items(db, batch):
    return list(db.scalars(select(DeliveryItem).where(DeliveryItem.batch_id == batch.id).order_by(DeliveryItem.id)))


def initialize(db, user, system, body):
    if 'manage' not in access.capabilities(db, user, system):
        raise DomainError('FORBIDDEN', 403)
    profile = db.get(AssessmentProfile, system.id)
    if profile and profile.data.get('remediation_source'):
        raise DomainError('DELIVERY_PARENT_REQUIRED', 409, profile.data['remediation_source'])
    kind = body.get('source_kind', 'baseline')
    if kind == 'baseline':
        baseline = db.get(Baseline, system.baseline_id) if system.baseline_id else None
        if not baseline or not baseline.finalized:
            raise DomainError('DEVELOPMENT_BASELINE_REQUIRED', 409)
        confirmations = list(db.scalars(select(Confirmation).where(Confirmation.baseline_id == baseline.id)))
        validate_confirmations(confirmations, baseline.content_hash, ('customer', 'supplier'))
        payload = baseline.payload
        requirements = {r['id']: r for r in payload['prd']['requirements']}
        definitions = [(r['id'], {'finding': {'title': r['title']}, 'requirement': r,
                                  'commitment': payload['answers'][r['id']], 'report_id': payload['report_id']},
                        r['acceptance_criteria']) for r in requirements.values()
                       if payload['answers'][r['id']]['implementation_status'] in ('yes', 'partial')]
        source_id, source_hash, supplier_org, supplier_user = baseline.id, baseline.content_hash, payload['supplier_org_id'], None
        snapshot = {'baseline_id': baseline.id, 'source_hash': source_hash}
    elif kind == 'plan':
        run = existing_service.current_run(db, system)
        plan = existing_service.plan_for(run.data, body.get('source_id'))
        if plan['status'] != 'in_progress' or not plan.get('supplier_id'):
            raise DomainError('STATE_CONFLICT', 409)
        supplier = existing_service.assigned_supplier(db, system, plan['supplier_id'])
        source_id, source_hash, supplier_org, supplier_user = plan['id'], plan['content_hash'], supplier.org_id, supplier.id
        snapshot = copy.deepcopy(plan)
        snapshot['environment'] = profile.data['environment']
        definitions = [(g, {'finding': run.data['gaps'][g], 'report_id': run.data['reports'][-1]['id']}, plan['payload']['acceptance_criteria']) for g in plan['payload']['gap_ids']]
    else:
        raise DomainError('INVALID_FIELDS')
    if body.get('source_hash', source_hash) != source_hash:
        raise DomainError('BASELINE_CHANGED', 409)
    old = db.scalar(select(DeliveryBatch).where(DeliveryBatch.system_id == system.id, DeliveryBatch.source_id == source_id, DeliveryBatch.source_hash == source_hash))
    if old:
        return old
    for previous in db.scalars(select(DeliveryBatch).where(DeliveryBatch.system_id == system.id)):
        if not fresh(db, previous):
            previous.status = 'SUPERSEDED'
    batch = DeliveryBatch(system_id=system.id, org_id=system.org_id, revision=system.revision, kind=kind,
                          source_id=source_id, source_hash=source_hash, supplier_org_id=supplier_org,
                          supplier_user_id=supplier_user, snapshot=snapshot)
    db.add(batch)
    db.flush()
    for identity, snap, criteria in definitions:
        db.add(DeliveryItem(batch_id=batch.id, source_id=identity, snapshot=snap,
                            criteria=[{'id': f'AC-{n+1}', 'text': c} for n, c in enumerate(criteria)]))
    if kind == 'plan':
        data = copy.deepcopy(run.data)
        data['plans'][source_id]['delivery_batch_id'] = batch.id
        data['plans'][source_id]['delivery_policy_version'] = 1
        existing_service.save_data(run, data, user, 'delivery.initialized', {'batch_id': batch.id})
    db.flush()
    return batch


def attachment_view(row):
    return {'id': row.id, 'filename': row.filename, 'mime': row.mime, 'sha256': row.sha256,
            'size': row.size, 'meta': row.meta, 'created_at': row.created_at, 'scan_status': 'NOT_CONFIGURED'}


def item_view(db, item):
    submissions = []
    for sub in db.scalars(select(DeliverySubmission).where(DeliverySubmission.item_id == item.id).order_by(DeliverySubmission.round_no)):
        review = db.scalar(select(DeliveryReview).where(DeliveryReview.submission_id == sub.id))
        from .db import Job
        job = db.scalar(select(Job).where(Job.kind == 'delivery_evidence:' + sub.id).order_by(Job.created_at.desc()))
        submissions.append({'id': sub.id, 'round_no': sub.round_no, 'payload': sub.payload, 'manifest_hash': sub.manifest_hash,
                            'ai': {'id': job.id, 'state': job.state, 'error': job.error, 'output': job.output if job.state == 'succeeded' else None} if job else None,
                            'created_at': sub.created_at, 'review': {**review.data, 'actor_id': review.actor_id, 'created_at': review.created_at} if review else None})
    reopen_feedback = None
    if item.status == 'CHANGES_REQUESTED':
        batch = db.get(DeliveryBatch, item.batch_id)
        event = db.scalar(select(Audit).where(
            Audit.system_id == batch.system_id, Audit.action == 'delivery.reopen',
            Audit.detail['item_id'].as_string() == item.id,
        ).order_by(Audit.created_at.desc()).limit(1))
        if event and (not submissions or event.created_at >= submissions[-1]['created_at']):
            reopen_feedback = {'reason': event.detail['reason'], 'created_at': event.created_at}
    return {'id': item.id, 'batch_id': item.batch_id, 'source_id': item.source_id, 'snapshot': item.snapshot,
            'criteria': item.criteria, 'draft': item.draft, 'version': item.version, 'status': item.status,
            'reopen_feedback': reopen_feedback,
            'attachments': [attachment_view(a) for a in db.scalars(select(EvidenceAttachment).where(EvidenceAttachment.item_id == item.id))],
            'submissions': submissions}


def batch_view(db, user, batch, include_items=True):
    system = authorize(db, user, batch)
    rows = items(db, batch)
    actions = ['read']
    for action in ('review', 'upload', 'complete', 'analyze'):
        try:
            authorize(db, user, batch, action)
            actions.append(action)
        except DomainError:
            pass
    valid = fresh(db, batch)
    return {'id': batch.id, 'system_id': system.id, 'name': system.name, 'kind': batch.kind, 'source_id': batch.source_id,
            'source_hash': batch.source_hash, 'status': batch.status if valid else 'SUPERSEDED', 'version': batch.version,
            'allowed_actions': actions if valid else ['read'], 'total': len(rows), 'approved': sum(i.status == 'APPROVED' for i in rows),
            'items': [item_view(db, i) for i in rows] if include_items else []}


def touch(batch, item=None):
    batch.version += 1
    if item:
        item.version += 1


def editable(db, batch, item):
    source(db, batch)
    if batch.status != 'ACTIVE' or item.status not in ('OPEN', 'CHANGES_REQUESTED'):
        raise DomainError('STATE_CONFLICT', 409)


def save_draft(db, batch, item, body):
    editable(db, batch, item)
    draft = body.get('draft')
    if not isinstance(draft, dict) or len(str(draft)) > 15000:
        raise DomainError('INVALID_FIELDS')
    allowed = {'description', 'environment', 'system_version', 'collected_on', 'attachment_ids', 'criteria_evidence_map'}
    if set(draft) - allowed:
        raise DomainError('INVALID_FIELDS')
    for key in ('description', 'environment', 'system_version', 'collected_on'):
        if key in draft and (not isinstance(draft[key], str) or len(draft[key]) > (8000 if key == 'description' else 200)):
            raise DomainError('INVALID_FIELDS')
    ids = draft.get('attachment_ids', [])
    if not isinstance(ids, list) or len(ids) > 10 or any(not isinstance(identity, str) for identity in ids):
        raise DomainError('INVALID_FIELDS')
    for identity in ids:
        attachment = db.get(EvidenceAttachment, identity)
        if not attachment or attachment.item_id != item.id:
            raise DomainError('NOT_FOUND', 404)
    mapping = draft.get('criteria_evidence_map', {})
    if not isinstance(mapping, dict) or any(not isinstance(values, list) or any(identity not in ids for identity in values) for values in mapping.values()):
        raise DomainError('INVALID_FIELDS')
    item.draft = copy.deepcopy(draft)
    touch(batch, item)


def upload(db, user, batch, item, body, content):
    editable(db, batch, item)
    meta = metadata(body)
    filename, mime = validate_file(body.get('filename'), content)
    total = db.scalar(select(func.coalesce(func.sum(EvidenceAttachment.size), 0)).join(DeliveryItem).join(DeliveryBatch).where(DeliveryBatch.system_id == batch.system_id))
    if total + len(content) > MAX_ASSESSMENT:
        raise DomainError('UPLOAD_LIMIT_EXCEEDED', 413)
    # Updating System serializes quota reservations across batches on SQLite and PostgreSQL.
    system = db.get(System, batch.system_id)
    system.version += 1
    row = EvidenceAttachment(item_id=item.id, actor_id=user.id, filename=filename, mime=mime,
                             content=content, sha256=hashlib.sha256(content).hexdigest(), size=len(content), meta=meta)
    db.add(row)
    touch(batch, item)
    db.flush()
    return row


def submit(db, user, batch, item, body):
    editable(db, batch, item)
    development = source(db, batch, development=True)
    if body.get('expected_source_hash') != batch.source_hash:
        raise DomainError('SOURCE_SUPERSEDED', 409)
    draft = copy.deepcopy(item.draft)
    meta = metadata(draft)
    ids = draft.get('attachment_ids')
    if not isinstance(ids, list) or not 1 <= len(ids) <= 10 or any(not isinstance(i, str) for i in ids) or len(ids) != len(set(ids)):
        raise DomainError('EVIDENCE_REQUIRED')
    files = [db.get(EvidenceAttachment, identity) for identity in ids]
    if any(f is None or f.item_id != item.id for f in files):
        raise DomainError('NOT_FOUND', 404)
    if sum(f.size for f in files) > MAX_TOTAL:
        raise DomainError('UPLOAD_LIMIT_EXCEEDED', 413)
    mapping = draft.get('criteria_evidence_map', {})
    if not item.criteria or not isinstance(mapping, dict) or set(mapping) != {c['id'] for c in item.criteria}:
        raise DomainError('DELIVERY_CRITERIA_REQUIRED')
    if any(not isinstance(v, list) or not v or any(x not in ids for x in v) for v in mapping.values()):
        raise DomainError('DELIVERY_CRITERIA_REQUIRED')
    for f in files:
        if any(f.meta[k] != meta[k] for k in ('environment', 'system_version')):
            raise DomainError('EVIDENCE_SCOPE_MISMATCH')
        if batch.kind == 'plan':
            approved = batch.snapshot['approved_at']
            if meta['environment'] != batch.snapshot['environment']:
                raise DomainError('EVIDENCE_SCOPE_MISMATCH')
            if f.created_at < approved or f.meta['collected_on'] < datetime.fromtimestamp(approved, timezone.utc).date().isoformat():
                raise DomainError('NEW_DELIVERY_EVIDENCE_REQUIRED')
    payload = {'schema_version': 'delivery/1', 'source_hash': batch.source_hash, 'acceptance_hash': digest(item.criteria),
               'draft': draft, 'attachments': [attachment_view(f) for f in files]}
    if isinstance(development, Baseline) and batch.kind == 'plan':
        payload['development_baseline_id'] = development.id
        payload['development_baseline_hash'] = development.content_hash
    count = db.scalar(select(func.count()).select_from(DeliverySubmission).where(DeliverySubmission.item_id == item.id))
    submission = DeliverySubmission(item_id=item.id, round_no=count + 1, actor_id=user.id, payload=payload, manifest_hash=digest(payload))
    db.add(submission)
    item.status = 'IN_REVIEW'
    touch(batch, item)
    db.flush()
    from .ai_settings import configured
    if configured(db, batch.org_id):
        try:
            analyze(db, batch, item, submission, body)
        except DomainError as exc:
            # Evidence submission remains durable even when AI is unavailable/budget-limited.
            audit(db, user, batch, 'ai_not_queued', {'code': exc.code, 'submission_id': submission.id})


def analyze(db, batch, item, submission, body):
    from . import service
    from .db import Job
    source(db, batch)
    if item.id != submission.item_id:
        raise DomainError('NOT_FOUND', 404)
    kind = 'delivery_evidence:' + submission.id
    system = db.get(System, batch.system_id)
    current = service.job_input(db, system, kind)
    prior = db.scalar(select(Job).where(Job.kind == kind, Job.source_hash == digest(current), Job.state == 'succeeded'))
    if prior:
        return
    service.schedule(db, system, kind, 'openrouter', body.get('language', 'zh'))


def review(db, user, batch, item, submission, body):
    source(db, batch, development=True)
    latest = db.scalar(select(DeliverySubmission).where(DeliverySubmission.item_id == item.id).order_by(DeliverySubmission.round_no.desc()))
    if item.status != 'IN_REVIEW' or latest.id != submission.id or submission.actor_id == user.id:
        raise DomainError('STATE_CONFLICT', 409)
    if body.get('submission_hash') != submission.manifest_hash or body.get('source_hash') != batch.source_hash:
        raise DomainError('SOURCE_SUPERSEDED', 409)
    if 'development_baseline_hash' in submission.payload:
        baseline = source(db, batch, development=True)
        if not isinstance(baseline, Baseline) or baseline.content_hash != submission.payload['development_baseline_hash']:
            raise DomainError('SOURCE_SUPERSEDED', 409)
    result = validate_review(body, item.criteria, [a['id'] for a in submission.payload['attachments']])
    db.add(DeliveryReview(submission_id=submission.id, actor_id=user.id,
                          data={**result, 'submission_hash': submission.manifest_hash, 'source_hash': batch.source_hash}))
    item.status = 'APPROVED' if result['decision'] == 'PASS' else 'CHANGES_REQUESTED'
    touch(batch, item)


def reopen(db, batch, item, body):
    source(db, batch)
    text(body, 'reason')
    if item.status != 'APPROVED':
        raise DomainError('STATE_CONFLICT', 409)
    if batch.kind == 'plan':
        system = db.get(System, batch.system_id)
        run = existing_service.current_run(db, system)
        data = copy.deepcopy(run.data)
        plan = data['plans'][batch.source_id]
        if plan['status'] == 'closed':
            raise DomainError('STATE_CONFLICT', 409)
        plan['status'] = 'in_progress'
        run.data = data
        system.version += 1
    item.status, batch.status = 'CHANGES_REQUESTED', 'ACTIVE'
    touch(batch, item)


def complete(db, user, batch):
    source(db, batch, development=True)
    rows = items(db, batch)
    if batch.status != 'ACTIVE' or not rows or any(i.status != 'APPROVED' for i in rows):
        raise DomainError('DELIVERY_ITEMS_PENDING', 409)
    if batch.kind == 'plan':
        system = db.get(System, batch.system_id)
        evidence_ids = []
        targets = {(i.draft.get('environment'), i.draft.get('system_version')) for i in rows}
        if len(targets) != 1:
            raise DomainError('EVIDENCE_SCOPE_MISMATCH')
        for item in rows:
            sub = db.scalar(select(DeliverySubmission).where(DeliverySubmission.item_id == item.id).order_by(DeliverySubmission.round_no.desc()))
            if 'development_baseline_hash' in sub.payload and source(db, batch, development=True).content_hash != sub.payload['development_baseline_hash']:
                raise DomainError('SOURCE_SUPERSEDED', 409)
            meta = sub.payload['draft']
            ref = existing_service.add_evidence(db, system, user, {**meta, 'description': f"Delivery submission {sub.id} SHA256 {sub.manifest_hash}\n{meta['description']}"[:8000]})
            evidence_ids.append(ref['evidence_id'])
        existing_service.submit_completion(db, system, user, {'plan_id': batch.source_id,
            'description': 'Delivery evidence reviewed: ' + batch.id, 'evidence_ids': evidence_ids}, delivery_bridge=True)
        system.version += 1
    batch.status = 'REVIEW_COMPLETE'
    touch(batch)


def retest_guard(db, plan):
    if plan.get('delivery_policy_version'):
        batch = db.get(DeliveryBatch, plan.get('delivery_batch_id')) if plan.get('delivery_batch_id') else None
        if not batch or batch.status != 'REVIEW_COMPLETE' or not fresh(db, batch) or any(i.status != 'APPROVED' for i in items(db, batch)):
            raise DomainError('DELIVERY_ITEMS_PENDING', 409)
        source(db, batch, development=True)


def retest_failed(db, plan):
    if plan.get('delivery_batch_id'):
        batch = db.get(DeliveryBatch, plan['delivery_batch_id'])
        batch.status = 'ACTIVE'
        for item in items(db, batch):
            item.status = 'CHANGES_REQUESTED'
            item.version += 1
        touch(batch)


def audit(db, user, batch, action, body):
    db.add(Audit(system_id=batch.system_id, actor_id=user.id, action='delivery.' + action,
                 detail={'batch_id': batch.id, 'source_hash': batch.source_hash, 'reason': body.get('reason'),
                         **({'item_id': body['item_id']} if body.get('item_id') else {}), 'at': time.time()}))
