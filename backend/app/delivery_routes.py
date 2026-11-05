"""Authenticated delivery routes; bounded raw upload avoids disk-spooled multipart."""
import base64
import json
import asyncio
import time
from collections import defaultdict, deque
from urllib.parse import quote

from fastapi import Depends, Request, Response
from sqlalchemy import select

from . import delivery_service as workflow, service
from .db import Receipt
from .delivery_models import DeliveryBatch, DeliveryItem, DeliverySubmission, EvidenceAttachment
from .domain import DomainError, digest
from .evidence_service import MAX_FILE, preview


def register_routes(app, current, get_db):
    upload_slots = asyncio.Semaphore(4)
    upload_attempts = defaultdict(deque)
    def batch_for(db, user, identity, action='read'):
        batch = db.get(DeliveryBatch, identity)
        if not batch:
            raise DomainError('NOT_FOUND', 404)
        workflow.authorize(db, user, batch, action)
        return batch

    def item_for(db, user, identity, action='read'):
        item = db.get(DeliveryItem, identity)
        if not item:
            raise DomainError('NOT_FOUND', 404)
        return batch_for(db, user, item.batch_id, action), item

    def mutate(request, db, user, batch, aggregate, body, action, operation):
        key = request.headers.get('Idempotency-Key')
        receipt_id = digest([user.id, aggregate.id, action, key]) if key else None
        request_hash = digest(body)
        if receipt_id:
            receipt = db.get(Receipt, receipt_id)
            if receipt:
                if receipt.request_hash != request_hash:
                    raise DomainError('IDEMPOTENCY_CONFLICT', 409)
                return receipt.response
        if body.get('version') != aggregate.version:
            raise DomainError('VERSION_CONFLICT', 409)
        system = workflow.authorize(db, user, batch)
        # CAS protects source checks against concurrent assessment/plan revisions too.
        system.version += 1
        extra = operation() or {}
        audit_body = {**body, 'item_id': aggregate.id} if isinstance(aggregate, DeliveryItem) else body
        workflow.audit(db, user, batch, action, audit_body)
        db.flush()
        result = {**workflow.batch_view(db, user, batch), **extra}
        if receipt_id:
            db.add(Receipt(id=receipt_id, request_hash=request_hash, response=result))
        db.commit()
        return result

    @app.get('/api/v1/delivery-batches')
    def inbox(user=Depends(current), db=Depends(get_db)):
        result = []
        for batch in db.scalars(select(DeliveryBatch).order_by(DeliveryBatch.created_at.desc())):
            try:
                result.append(workflow.batch_view(db, user, batch, False))
            except DomainError:
                continue
        return result

    @app.get('/api/v1/systems/{system_id}/delivery-batches')
    def batches(system_id: str, user=Depends(current), db=Depends(get_db)):
        service.system_for(db, user, system_id)
        return [workflow.batch_view(db, user, b, False) for b in db.scalars(select(DeliveryBatch).where(DeliveryBatch.system_id == system_id))]

    @app.post('/api/v1/systems/{system_id}/delivery-batches')
    def initialize(system_id: str, body: dict, request: Request, user=Depends(current), db=Depends(get_db)):
        system = service.system_for(db, user, system_id, write=True)
        from . import access
        if 'manage' not in access.capabilities(db, user, system):
            raise DomainError('FORBIDDEN', 403)
        key = request.headers.get('Idempotency-Key')
        receipt_id = digest([user.id, system.id, 'delivery.initialize', key]) if key else None
        receipt = db.get(Receipt, receipt_id) if receipt_id else None
        if receipt:
            if receipt.request_hash != digest(body):
                raise DomainError('IDEMPOTENCY_CONFLICT', 409)
            return receipt.response
        if body.get('version') != system.version:
            raise DomainError('VERSION_CONFLICT', 409)
        batch = workflow.initialize(db, user, system, body)
        system.version += 1
        workflow.audit(db, user, batch, 'initialized', body)
        db.flush()
        result = workflow.batch_view(db, user, batch)
        if receipt_id:
            db.add(Receipt(id=receipt_id, request_hash=digest(body), response=result))
        db.commit()
        return result

    @app.get('/api/v1/delivery-batches/{batch_id}')
    def batch_detail(batch_id: str, user=Depends(current), db=Depends(get_db)):
        return workflow.batch_view(db, user, batch_for(db, user, batch_id))

    @app.get('/api/v1/delivery-batches/{batch_id}/items')
    def list_items(batch_id: str, status: str = '', query: str = '', cursor: int = 0, limit: int = 30, user=Depends(current), db=Depends(get_db)):
        batch = batch_for(db, user, batch_id)
        if cursor < 0 or not 1 <= limit <= 100:
            raise DomainError('INVALID_FIELDS')
        rows = [i for i in workflow.items(db, batch) if (not status or i.status == status) and (not query or query.casefold() in str(i.snapshot).casefold())]
        return {'items': [workflow.item_view(db, i) for i in rows[cursor:cursor+limit]], 'total': len(rows),
                'next_cursor': cursor + limit if cursor + limit < len(rows) else None}

    @app.get('/api/v1/delivery-items/{item_id}')
    def detail(item_id: str, user=Depends(current), db=Depends(get_db)):
        _, item = item_for(db, user, item_id)
        return workflow.item_view(db, item)

    @app.put('/api/v1/delivery-items/{item_id}/draft')
    def draft(item_id: str, body: dict, request: Request, user=Depends(current), db=Depends(get_db)):
        batch, item = item_for(db, user, item_id, 'draft')
        return mutate(request, db, user, batch, item, body, 'draft', lambda: workflow.save_draft(db, batch, item, body))

    @app.post('/api/v1/delivery-items/{item_id}/attachments')
    async def upload(item_id: str, request: Request, user=Depends(current), db=Depends(get_db)):
        batch, item = item_for(db, user, item_id, 'upload')
        workflow.editable(db, batch, item)
        try:
            raw = request.headers.get('X-Evidence-Metadata', '')
            if len(raw) > 16000:
                raise ValueError()
            body = json.loads(base64.b64decode(raw, validate=True))
            if not isinstance(body, dict):
                raise ValueError()
        except (ValueError, UnicodeDecodeError) as exc:
            raise DomainError('INVALID_FIELDS') from exc
        attempts = upload_attempts[user.id]
        while attempts and attempts[0] < time.monotonic() - 60:
            attempts.popleft()
        if len(attempts) >= 30 or upload_slots.locked():
            raise DomainError('RATE_LIMITED', 429)
        attempts.append(time.monotonic())
        content = bytearray()
        async with upload_slots:
            try:
                async with asyncio.timeout(120):
                    async for chunk in request.stream():
                        if len(content) + len(chunk) > MAX_FILE:
                            raise DomainError('UPLOAD_LIMIT_EXCEEDED', 413)
                        content.extend(chunk)
            except TimeoutError as exc:
                raise DomainError('UPLOAD_TIMEOUT', 408) from exc
        import hashlib
        body['content_hash'] = hashlib.sha256(content).hexdigest()
        def operation():
            row = workflow.upload(db, user, batch, item, body, bytes(content))
            return {'attachment': workflow.attachment_view(row)}
        return mutate(request, db, user, batch, item, body, 'upload', operation)

    @app.get('/api/v1/evidence-attachments/{attachment_id}')
    def attachment_metadata(attachment_id: str, user=Depends(current), db=Depends(get_db)):
        row = db.get(EvidenceAttachment, attachment_id)
        if not row:
            raise DomainError('NOT_FOUND', 404)
        item_for(db, user, row.item_id)
        return workflow.attachment_view(row)

    @app.get('/api/v1/evidence-attachments/{attachment_id}/{operation}')
    def download(attachment_id: str, operation: str, user=Depends(current), db=Depends(get_db)):
        row = db.get(EvidenceAttachment, attachment_id)
        if not row or operation not in ('content', 'preview'):
            raise DomainError('NOT_FOUND', 404)
        batch, _ = item_for(db, user, row.item_id)
        workflow.audit(db, user, batch, 'downloaded', {})
        if operation == 'preview':
            if not row.mime.startswith('image/'):
                raise DomainError('UNSUPPORTED_EVIDENCE_TYPE', 415)
            data, mime, disposition = preview(row.content), 'image/png', 'inline'
        else:
            data, mime, disposition = row.content, row.mime, "attachment; filename*=UTF-8''" + quote(row.filename, safe='')
        db.commit()
        return Response(data, media_type=mime, headers={'Content-Disposition': disposition, 'Cache-Control': 'no-store',
                         'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox"})

    @app.post('/api/v1/delivery-items/{item_id}/submissions')
    def submit(item_id: str, body: dict, request: Request, user=Depends(current), db=Depends(get_db)):
        batch, item = item_for(db, user, item_id, 'submit')
        return mutate(request, db, user, batch, item, body, 'submit', lambda: workflow.submit(db, user, batch, item, body))

    @app.post('/api/v1/delivery-submissions/{submission_id}/reviews')
    def review(submission_id: str, body: dict, request: Request, user=Depends(current), db=Depends(get_db)):
        submission = db.get(DeliverySubmission, submission_id)
        if not submission:
            raise DomainError('NOT_FOUND', 404)
        batch, item = item_for(db, user, submission.item_id, 'review')
        return mutate(request, db, user, batch, item, body, 'review', lambda: workflow.review(db, user, batch, item, submission, body))

    @app.post('/api/v1/delivery-submissions/{submission_id}/ai-assessments')
    def analyze(submission_id: str, body: dict, request: Request, user=Depends(current), db=Depends(get_db)):
        submission = db.get(DeliverySubmission, submission_id)
        if not submission:
            raise DomainError('NOT_FOUND', 404)
        batch, item = item_for(db, user, submission.item_id, 'analyze')
        return mutate(request, db, user, batch, item, body, 'ai_requested',
                      lambda: workflow.analyze(db, batch, item, submission, body))

    @app.post('/api/v1/delivery-items/{item_id}/reopen')
    def reopen(item_id: str, body: dict, request: Request, user=Depends(current), db=Depends(get_db)):
        batch, item = item_for(db, user, item_id, 'review')
        return mutate(request, db, user, batch, item, body, 'reopen', lambda: workflow.reopen(db, batch, item, body))

    @app.post('/api/v1/delivery-batches/{batch_id}/complete')
    def complete(batch_id: str, body: dict, request: Request, user=Depends(current), db=Depends(get_db)):
        batch = batch_for(db, user, batch_id, 'complete')
        return mutate(request, db, user, batch, batch, body, 'complete', lambda: workflow.complete(db, user, batch))

    @app.get('/api/v1/delivery-batches/{batch_id}/history')
    def history(batch_id: str, user=Depends(current), db=Depends(get_db)):
        from .db import Audit
        batch = batch_for(db, user, batch_id)
        return [{'action': a.action, 'detail': a.detail, 'created_at': a.created_at} for a in db.scalars(
            select(Audit).where(Audit.system_id == batch.system_id).order_by(Audit.created_at.desc())) if a.detail.get('batch_id') == batch.id]
