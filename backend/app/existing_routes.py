"""Thin HTTP adapters; mutations reuse the existing versioned command boundary."""
import copy
import time

from fastapi import Depends, Request
from fastapi.responses import PlainTextResponse
from sqlalchemy import select

from . import access, existing_service as workflow, service
from .assessment_creation import assessment_kind, required_text
from .db import AssessmentProfile, Audit, CurrentAssessment, Receipt, System, User
from .domain import DomainError, digest


def register_routes(app, current, get_db, command):
    @app.get('/api/v1/systems/{system_id}/existing')
    def read(system_id: str, user=Depends(current), db=Depends(get_db)):
        return workflow.view(db, service.system_for(db, user, system_id))

    @app.get('/api/v1/systems/{system_id}/existing/history/{revision}')
    def history(system_id: str, revision: int, user=Depends(current), db=Depends(get_db)):
        service.system_for(db, user, system_id)
        row = db.get(CurrentAssessment, (system_id, revision))
        if not row:
            raise DomainError('NOT_FOUND', 404)
        return row.data

    @app.get('/api/v1/systems/{system_id}/existing-assignees')
    def assignees(system_id: str, user=Depends(current), db=Depends(get_db)):
        system = service.system_for(db, user, system_id)
        if user.role == 'vendor':
            raise DomainError('NOT_FOUND', 404)
        users = []
        for person in db.scalars(select(User)):
            if not access.active(db, person):
                continue
            if 'read' in access.capabilities(db, person, system):
                users.append({'id': person.id, 'name': person.name, 'role': person.role})
            elif person.role == 'vendor':
                try:
                    workflow.assigned_supplier(db, system, person.id)
                    users.append({'id': person.id, 'name': person.name, 'role': person.role})
                except DomainError:
                    pass
        return {'users': users}

    @app.get('/api/v1/systems/{system_id}/existing/reports/{report_id}')
    def report(system_id: str, report_id: str, language: str = 'zh', user=Depends(current), db=Depends(get_db)):
        service.system_for(db, user, system_id)
        if language not in ('zh', 'en'):
            raise DomainError('INVALID_FIELDS')
        reports = [report for row in db.scalars(select(CurrentAssessment).where(CurrentAssessment.system_id == system_id))
                   for report in row.data['reports'] if report['id'] == report_id]
        if not reports:
            raise DomainError('NOT_FOUND', 404)
        item = reports[0]
        return PlainTextResponse(workflow.render_report(item, language), media_type='text/markdown',
                                 headers={'Content-Disposition': f'attachment; filename="assessment-{report_id}.md"'})

    @app.post('/api/v1/systems/{system_id}/assessment-type')
    def change_type(system_id: str, body: dict, request: Request, user=Depends(current), db=Depends(get_db)):
        system = service.system_for(db, user, system_id, write=True)
        def operation():
            service.require_state(system, 'DRAFT', 'CLASSIFYING')
            profile = db.get(AssessmentProfile, system.id)
            target = assessment_kind(body.get('assessment_type'))
            if not profile or profile.kind == target:
                return
            if profile.data or system.context_revision_id or system.classification:
                raise DomainError('TYPE_CHANGE_REQUIRES_NEW_ASSESSMENT', 409)
            if target == 'existing':
                if not profile.asset_id:
                    raise DomainError('PROJECT_REQUIRED')
                from datetime import date
                profile.data = {k: required_text(body, k, 8000) for k in ('scope', 'environment', 'system_version', 'as_of', 'trigger')}
                try:
                    date.fromisoformat(profile.data['as_of'])
                except ValueError as exc:
                    raise DomainError('INVALID_FIELDS') from exc
            profile.kind = target
        return command(request, db, user, system, body, 'context.draft_saved', operation)

    actions = {
        'begin': ('existing.started', lambda db, s, u, b: workflow.begin(db, s)),
        'evidence': ('existing.evidence_saved', workflow.add_evidence),
        'verify': ('existing.verification_saved', workflow.verify),
        'publish': ('existing.report_reviewed', workflow.publish_report),
        'plan': ('existing.plan_saved', workflow.plan),
        'approve': ('existing.plan_approved', workflow.approve_plan),
        'accept-risk': ('existing.risk_accepted', workflow.accept_risk),
        'development': ('existing.development_created', workflow.create_development),
        'complete-task': ('existing.completion_saved', workflow.submit_completion),
        'retest': ('existing.retest_reviewed', workflow.retest),
        'finalize': ('existing.finalized', workflow.finalize),
        'reopen': ('existing.reopened', lambda db, s, u, b: workflow.reopen(db, s, u)),
    }

    @app.post('/api/v1/systems/{system_id}/existing/{action}')
    def mutate(system_id: str, action: str, body: dict, request: Request, user=Depends(current), db=Depends(get_db)):
        system = service.system_for(db, user, system_id, write=True)
        if action not in actions:
            raise DomainError('NOT_FOUND', 404)
        name, handler = actions[action]
        def operation():
            workflow.profile_for(db, system)
            workflow.refresh_expired(db, system, user)
            result = handler(db, system, user, body) or {}
            db.flush()
            return {**result, 'existing': workflow.view(db, system)}
        return command(request, db, user, system, body, name, operation)

    def supplier_items(db, user):
        if user.role != 'vendor':
            return []
        result = []
        for row in db.scalars(select(CurrentAssessment)):
            system = db.get(System, row.system_id)
            if row.revision != system.revision or not access.supplier_project_access(db, user, system):
                continue
            for plan in row.data['plans'].values():
                if plan['supplier_id'] == user.id:
                    try:
                        workflow.assigned_supplier(db, system, user.id)
                        workflow.current_run(db, system)
                    except DomainError:
                        continue
                    item = {k: copy.deepcopy(plan[k]) for k in ('id', 'payload', 'revision', 'status', 'content_hash', 'confirmations')}
                    item['delivery_policy_version'] = plan.get('delivery_policy_version')
                    item['delivery_batch_id'] = plan.get('delivery_batch_id')
                    result.append({'system_id': system.id, 'name': system.name, 'version': system.version, 'plan': item})
        return result

    @app.get('/api/v1/supplier-remediations')
    def supplier_list(user=Depends(current), db=Depends(get_db)):
        return supplier_items(db, user)

    @app.post('/api/v1/supplier-remediations/{system_id}/{action}')
    def supplier_confirm(system_id: str, action: str, body: dict, request: Request, user=Depends(current), db=Depends(get_db)):
        if action not in ('confirm', 'submit'):
            raise DomainError('NOT_FOUND', 404)
        if not any(i['system_id'] == system_id and i['plan']['id'] == body.get('plan_id') for i in supplier_items(db, user)):
            raise DomainError('NOT_FOUND', 404)
        system = db.scalar(select(System).where(System.id == system_id).with_for_update())
        key = request.headers.get('Idempotency-Key')
        receipt_id = digest([user.id, system.id, 'remediation.' + action, key]) if key else None
        if receipt_id:
            receipt = db.get(Receipt, receipt_id)
            if receipt:
                if receipt.request_hash != digest(body):
                    raise DomainError('IDEMPOTENCY_CONFLICT', 409)
                return receipt.response
        if body.get('version') != system.version:
            raise DomainError('VERSION_CONFLICT', 409)
        if action == 'confirm':
            workflow.approve_plan(db, system, user, body, supplier=True)
        else:
            plan = workflow.plan_for(workflow.current_run(db, system).data, body.get('plan_id'))
            if plan['status'] != 'in_progress' or body.get('content_hash') != plan['content_hash']:
                raise DomainError('BASELINE_CHANGED', 409)
            evidence = workflow.add_evidence(db, system, user, {**body, 'description': required_text(body, 'evidence_description', 8000)})
            workflow.submit_completion(db, system, user, {**body, 'evidence_ids': [evidence['evidence_id']]})
        system.version += 1
        system.updated_at = time.time()
        db.add(Audit(system_id=system.id, actor_id=user.id, action='existing.supplier_' + action, detail={'plan_id': body['plan_id']}))
        result = {'ok': True}
        if receipt_id:
            db.add(Receipt(id=receipt_id, request_hash=digest(body), response=result))
        db.commit()
        return result
