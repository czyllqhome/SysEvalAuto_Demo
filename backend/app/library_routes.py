"""Control maintenance and system profile HTTP boundaries."""
import copy
import base64

from fastapi import Depends, Request, Response, UploadFile
from fastapi.responses import JSONResponse
from sqlalchemy import select

from . import access, control_library as library, service
from .control_rules import classify_profile, default_config, normalize_facts
from .control_workbooks import MAX_BYTES, annotated_mlps, export_book, preview
from .db import Catalog, LibraryBatch, LibraryRelease, Receipt
from .domain import DomainError, digest


def register_routes(app, current, get_db, command):
    from . import screening
    from . import mlps_intake

    @app.post('/api/v1/systems/{system_id}/mlps-intake/evidence')
    def mlps_upload(system_id: str, body: dict, request: Request, user=Depends(current), db=Depends(get_db)):
        import hashlib
        from .db import MlpsEvidence
        from .evidence_service import validate_file
        non_vendor(user)
        system = service.system_for(db, user, system_id, write=True)
        def operation():
            if body.get('question') not in {'network_zones_description'}:
                raise DomainError('INVALID_FIELDS')
            encoded = body.get('content')
            if not isinstance(encoded, str) or len(encoded) > 2800000:
                raise DomainError('UPLOAD_LIMIT_EXCEEDED', 413)
            try:
                content = base64.b64decode(encoded, validate=True)
            except ValueError as exc:
                raise DomainError('INVALID_FIELDS') from exc
            filename, mime = validate_file(body.get('filename'), content)
            row = MlpsEvidence(system_id=system.id, actor_id=user.id, question=body['question'],
                               filename=filename, mime=mime, content=content, sha256=hashlib.sha256(content).hexdigest())
            db.add(row)
            db.flush()
            return {'mlps_evidence': {'id': row.id, 'filename': row.filename, 'sha256': row.sha256}}
        return command(request, db, user, system, body, 'mlps.evidence_uploaded', operation)

    @app.post('/api/v1/systems/{system_id}/mlps-intake/evidence-removals')
    def mlps_remove_evidence(system_id: str, body: dict, request: Request, user=Depends(current), db=Depends(get_db)):
        from .db import MlpsEvidence
        from .intake_evidence import without_reference
        non_vendor(user)
        system = service.system_for(db, user, system_id, write=True)
        def operation():
            service.require_state(system, 'DRAFT', 'CLASSIFYING', 'CONTEXT_REVIEW', 'CONTROL_REVIEW', 'PRD_REVIEW',
                                  'RESULT_REVIEW', 'NEGOTIATING', 'FINAL_CONFIRMATION', 'PENDING_DEVELOPMENT', *service.revision_states(db, system))
            if set(body) != {'version', 'evidence_id'} or not isinstance(body['evidence_id'], str):
                raise DomainError('INVALID_FIELDS')
            row = db.get(MlpsEvidence, body['evidence_id'])
            if not row or row.system_id != system.id:
                raise DomainError('NOT_FOUND', 404)
            removed = system.draft.get('removed_mlps_evidence', [])
            if row.id not in removed:
                if system.classification or system.context_revision_id:
                    service.invalidate(db, system, 'CLASSIFYING')
                    system.classification = {}
                    system.context_revision_id = None
                saved = without_reference(system.draft.get('mlps_intake', {}), row)
                system.draft = {**system.draft, 'mlps_intake': saved,
                                'removed_mlps_evidence': [*removed, row.id],
                                'proposal_stale': bool(system.draft.get('proposal'))}
            return {'mlps_evidence_removed': {'id': row.id, 'filename': row.filename, 'sha256': row.sha256}}
        return command(request, db, user, system, body, 'mlps.evidence_removed', operation)

    @app.get('/api/v1/systems/{system_id}/mlps-intake/evidence/{evidence_id}')
    def mlps_download(system_id: str, evidence_id: str, user=Depends(current), db=Depends(get_db)):
        from urllib.parse import quote
        from .db import MlpsEvidence
        non_vendor(user)
        service.system_for(db, user, system_id)
        row = db.get(MlpsEvidence, evidence_id)
        if not row or row.system_id != system_id:
            raise DomainError('NOT_FOUND', 404)
        return Response(row.content, media_type='application/octet-stream',
                        headers={'Content-Disposition': "attachment; filename*=UTF-8''" + quote(row.filename),
                                 'X-Content-SHA256': row.sha256})

    @app.get('/api/v1/systems/{system_id}/mlps-intake')
    def mlps_read(system_id: str, latest: bool = False, user=Depends(current), db=Depends(get_db)):
        non_vendor(user)
        system = service.system_for(db, user, system_id)
        saved = system.draft.get('mlps_intake', {})
        catalog, _, _ = screening.resolve(db, user.org_id, None if latest else saved.get('catalog_id'))
        return {'questions': mlps_intake.QUESTIONS, 'saved': saved,
                'demo_template': mlps_intake.demo_template_for_org(user.org_id),
                'catalog_id': catalog.id if catalog else None,
                'legacy': bool(system.draft.get('screening') or system.draft.get('tag_profile')),
                'permissions': sorted(access.capabilities(db, user, system))}

    @app.post('/api/v1/systems/{system_id}/mlps-intake/preview')
    def mlps_preview(system_id: str, body: dict, user=Depends(current), db=Depends(get_db)):
        non_vendor(user)
        service.system_for(db, user, system_id)
        return mlps_intake.preview(db, user.org_id, {**body, '_system_id': system_id})

    @app.put('/api/v1/systems/{system_id}/mlps-intake')
    def mlps_save(system_id: str, body: dict, request: Request, user=Depends(current), db=Depends(get_db)):
        non_vendor(user)
        system = service.system_for(db, user, system_id, write=True)
        def operation():
            service.require_state(system, 'DRAFT', 'CLASSIFYING', 'CONTEXT_REVIEW', 'CONTROL_REVIEW', 'PRD_REVIEW',
                                  'RESULT_REVIEW', 'NEGOTIATING', 'FINAL_CONFIRMATION', 'PENDING_DEVELOPMENT', *service.revision_states(db, system))
            result = mlps_intake.preview(db, user.org_id, {**body, '_system_id': system_id})
            saved = {k: result[k] for k in ('answers', 'notes', 'department_contacts', 'frameworks', 'catalog_id')}
            if saved != system.draft.get('mlps_intake') and (system.classification or system.context_revision_id):
                service.invalidate(db, system, 'CLASSIFYING')
                system.classification = {}
                system.context_revision_id = None
            system.draft = {**system.draft, 'mlps_intake': saved, 'proposal_stale': bool(system.draft.get('proposal'))}
        return command(request, db, user, system, body, 'context.draft_saved', operation)

    @app.get('/api/v1/systems/{system_id}/applicability-questions')
    def applicability_questions(system_id: str, user=Depends(current), db=Depends(get_db)):
        from . import applicability
        non_vendor(user)
        system = service.system_for(db, user, system_id)
        return applicability.view(db, system)

    @app.put('/api/v1/systems/{system_id}/applicability-answers')
    def applicability_answers(system_id: str, body: dict, request: Request, user=Depends(current), db=Depends(get_db)):
        from . import applicability
        non_vendor(user)
        system = service.system_for(db, user, system_id, write=True)
        def operation():
            if set(body) != {'version', 'answers'}:
                raise DomainError('INVALID_FIELDS')
            return applicability.complete(db, user, system, body['answers'])
        return command(request, db, user, system, body, 'control.applicability_completed', operation)

    @app.get('/api/v1/systems/{system_id}/screening')
    def screening_read(system_id: str, latest: bool = False, user=Depends(current), db=Depends(get_db)):
        non_vendor(user)
        system = service.system_for(db, user, system_id)
        saved = system.draft.get('screening', {})
        catalog, release, cfg = screening.resolve(db, user.org_id, None if latest else saved.get('catalog_id'))
        from .mlps_source import FRAMEWORKS
        frameworks = FRAMEWORKS
        return {'config': cfg, 'catalog_id': catalog.id if catalog else None, 'framework_options': frameworks,
                'saved': saved, 'permissions': sorted(access.capabilities(db, user, system))}

    @app.post('/api/v1/systems/{system_id}/screening/preview')
    def screening_preview(system_id: str, body: dict, user=Depends(current), db=Depends(get_db)):
        non_vendor(user)
        service.system_for(db, user, system_id)
        return screening.preview(db, user.org_id, body)

    @app.put('/api/v1/systems/{system_id}/screening')
    def screening_save(system_id: str, body: dict, request: Request, user=Depends(current), db=Depends(get_db)):
        system = service.system_for(db, user, system_id, write=True)
        def operation():
            service.require_state(system, 'DRAFT', 'CLASSIFYING', 'CONTEXT_REVIEW', 'CONTROL_REVIEW', 'PRD_REVIEW', 'RESULT_REVIEW', 'NEGOTIATING', 'FINAL_CONFIRMATION', 'PENDING_DEVELOPMENT', *service.revision_states(db, system))
            result = screening.preview(db, user.org_id, body)
            saved = {k: result[k] for k in ('catalog_id', 'facts', 'frameworks', 'mlps_target', 'mode', 'reason')}
            saved['level'] = result['effective_level']
            if system.classification and saved != system.draft.get('screening'):
                service.invalidate(db, system, 'CLASSIFYING')
                system.classification = {}
                system.context_revision_id = None
            system.draft = {**system.draft, 'screening': saved}
        return command(request, db, user, system, body, 'context.draft_saved', operation)

    def non_vendor(user):
        if user.role == 'vendor':
            raise DomainError('FORBIDDEN', 403)

    def edit_command(request, db, user, body, action, operation):
        access.require_admin(db, user)
        key = request.headers.get('Idempotency-Key')
        receipt_id = digest([user.org_id, user.id, action, key]) if key else None
        request_hash = digest(body)
        if receipt_id:
            receipt = db.get(Receipt, receipt_id)
            if receipt:
                if receipt.request_hash != request_hash:
                    raise DomainError('IDEMPOTENCY_CONFLICT', 409)
                return receipt.response
        result = operation()
        if receipt_id:
            db.add(Receipt(id=receipt_id, request_hash=request_hash, response=result))
        db.commit()
        return result

    @app.get('/api/v1/library')
    def read_library(user=Depends(current), db=Depends(get_db)):
        non_vendor(user)
        return {**library.state(db, user.org_id), 'can_edit': False}

    @app.put('/api/v1/library/config')
    def config(body: dict, request: Request, user=Depends(current), db=Depends(get_db)):
        def operation():
            state = library.state(db, user.org_id)
            data = library.validate_references({'config': body.get('config'), 'controls': state['controls']})
            library.mutate(db, user, body.get('version'), data, 'control_library.configuration_changed')
            return read_library(user, db)
        return edit_command(request, db, user, body, 'library.config', operation)

    @app.post('/api/v1/library/controls')
    def save_control(body: dict, request: Request, user=Depends(current), db=Depends(get_db)):
        def operation():
            library.save_operations(db, user, body.get('version'), [{'operation': body.get('operation'), 'control': body.get('control')}])
            return read_library(user, db)
        return edit_command(request, db, user, body, 'library.control', operation)

    @app.post('/api/v1/library/controls/bulk-delete')
    def delete_controls(body: dict, request: Request, user=Depends(current), db=Depends(get_db)):
        def operation():
            state = library.state(db, user.org_id)
            ids = body.get('control_ids')
            reason = body.get('reason')
            if (not isinstance(ids, list) or not ids or len(ids) > 20000
                    or any(not isinstance(i, str) for i in ids) or len(set(ids)) != len(ids)
                    or not isinstance(reason, str) or not reason.strip() or len(reason) > 32000):
                raise DomainError('LIBRARY_INVALID')
            selected = set(ids)
            removed = [c for c in state['controls'] if c['control_id'] in selected]
            if len(removed) != len(selected):
                raise DomainError('NOT_FOUND', 404)
            data = {'config': state['config'], 'controls': [c for c in state['controls'] if c['control_id'] not in selected]}
            library.mutate(db, user, body.get('version'), data, 'control_library.bulk_deleted')
            access.audit(db, user, 'control_library.deleted_controls', {'reason': reason.strip(), 'controls': removed})
            return read_library(user, db)
        return edit_command(request, db, user, body, 'library.bulk_delete', operation)

    @app.post('/api/v1/library/rule-preview')
    def rule_preview(body: dict, user=Depends(current), db=Depends(get_db)):
        non_vendor(user)
        state = library.state(db, user.org_id)
        item = library.validate_control(body.get('control'), state['config'])
        facts = normalize_facts(body.get('facts', {}), state['config'])
        return library.match(item, facts, body.get('profile'))

    @app.get('/api/v1/control-template')
    def template(user=Depends(current), db=Depends(get_db)):
        access.require_admin(db, user)
        return Response(export_book(library.state(db, user.org_id)), media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                        headers={'Content-Disposition': 'attachment; filename="control-import-v1.xlsx"'})

    @app.get('/api/v1/library/export')
    def export(user=Depends(current), db=Depends(get_db)):
        non_vendor(user)
        return Response(export_book(library.state(db, user.org_id), True), media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                        headers={'Content-Disposition': 'attachment; filename="control-library.xlsx"'})

    @app.post('/api/v1/library/imports')
    async def upload(file: UploadFile, user=Depends(current), db=Depends(get_db)):
        access.require_admin(db, user)
        if not (file.filename or '').lower().endswith('.xlsx'):
            raise DomainError('INVALID_WORKBOOK')
        state = library.state(db, user.org_id)
        raw = await file.read(MAX_BYTES + 1)
        result = preview(raw, state)
        if result.get('source_format') == 'mlps' and not result['errors']:
            result['annotated'] = base64.b64encode(annotated_mlps(raw, result['changes'], state['config'])).decode()
        batch = LibraryBatch(org_id=user.org_id, version=state['version'], data=result)
        db.add(batch)
        db.commit()
        return {'id': batch.id, 'version': batch.version, 'errors': result['errors'], 'changes': result['changes'],
                'warnings': result.get('warnings', []), 'annotated': 'annotated' in result}

    @app.get('/api/v1/library/imports/{batch_id}/annotated')
    def download_annotated(batch_id: str, user=Depends(current), db=Depends(get_db)):
        access.require_admin(db, user)
        batch = db.get(LibraryBatch, batch_id)
        if not batch or batch.org_id != user.org_id or not batch.data.get('annotated'):
            raise DomainError('NOT_FOUND', 404)
        return Response(base64.b64decode(batch.data['annotated']), media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                        headers={'Content-Disposition': 'attachment; filename="MLPS-tagged-draft.xlsx"'})

    @app.post('/api/v1/library/imports/{batch_id}/apply')
    def apply(batch_id: str, user=Depends(current), db=Depends(get_db)):
        access.require_admin(db, user)
        batch = db.get(LibraryBatch, batch_id)
        if not batch or batch.org_id != user.org_id:
            raise DomainError('NOT_FOUND', 404)
        if not batch.applied:
            if batch.data['errors'] or batch.data['data'] is None:
                raise DomainError('CSV_HAS_ERRORS')
            library.mutate(db, user, batch.version, batch.data['data'], 'control_library.import_applied')
            access.audit(db, user, 'control_library.import_changes', {'batch_id': batch.id, 'changes': batch.data['changes']})
            batch.applied = True
            db.commit()
        return read_library(user, db)

    @app.get('/api/v1/library/imports/{batch_id}/errors')
    def import_errors(batch_id: str, user=Depends(current), db=Depends(get_db)):
        access.require_admin(db, user)
        batch = db.get(LibraryBatch, batch_id)
        if not batch or batch.org_id != user.org_id:
            raise DomainError('NOT_FOUND', 404)
        return JSONResponse(batch.data['errors'], headers={'Content-Disposition': 'attachment; filename="control-import-errors.json"'})

    @app.post('/api/v1/library/publish')
    def publish(body: dict, request: Request, user=Depends(current), db=Depends(get_db)):
        def operation():
            if set(body) - {'version', 'publication_mode'}:
                raise DomainError('INVALID_FIELDS')
            catalog = library.publish(db, user, body.get('version'), body.get('publication_mode', 'reviewed'))
            return {'catalog_id': catalog.id, 'state': read_library(user, db)}
        return edit_command(request, db, user, body, 'library.publish', operation)

    @app.get('/api/v1/library/history')
    def history(user=Depends(current), db=Depends(get_db)):
        non_vendor(user)
        rows = db.execute(select(Catalog, LibraryRelease).join(LibraryRelease).where(Catalog.org_id == user.org_id).order_by(Catalog.created_at.desc())).all()
        return [{'catalog_id': c.id, 'version': c.version, 'hash': c.content_hash, 'created_at': c.created_at,
                 'controls': r.data['controls'], 'config': r.data['config'],
                 'publication_mode': r.data.get('publication_mode', 'reviewed')} for c, r in rows]

    @app.get('/api/v1/systems/{system_id}/tag-profile')
    def profile(system_id: str, user=Depends(current), db=Depends(get_db)):
        non_vendor(user)
        system = service.system_for(db, user, system_id)
        saved = system.draft.get('tag_profile', {})
        catalog_id = saved.get('catalog_id') or system.classification.get('catalog_id')
        try:
            catalog, release = library.published(db, user.org_id, catalog_id)
            config, available = release.data['config'], True
        except DomainError:
            config, available, catalog = default_config(), False, None
        return {'config': config, 'available': available, 'catalog_id': catalog.id if catalog else None,
                'facts': saved.get('facts', system.classification.get('facts', {})),
                'assessment_profile': saved.get('assessment_profile', system.classification.get('assessment_profile')),
                'permissions': sorted(access.capabilities(db, user, system))}

    @app.post('/api/v1/systems/{system_id}/tag-profile/preview')
    def profile_preview(system_id: str, body: dict, user=Depends(current), db=Depends(get_db)):
        non_vendor(user)
        service.system_for(db, user, system_id)
        catalog, release = library.published(db, user.org_id, body.get('catalog_id'))
        facts = normalize_facts(body.get('facts', {}), release.data['config'])
        result = classify_profile(facts, release.data['config'], body.get('mode', 'questionnaire'), body.get('level'), body.get('reason', ''))
        selected = library.profile_choice(release.data['config'], result, body.get('assessment_profile'), body.get('mlps_target'))
        matches = [{'code': c['control_code'], **library.match(c, facts, selected)} for c in release.data['controls'] if not c['retired']]
        return {**result, 'catalog_id': catalog.id, 'assessment_profile': selected, 'matches': matches}

    @app.put('/api/v1/systems/{system_id}/tag-profile')
    def save_profile(system_id: str, body: dict, request: Request, user=Depends(current), db=Depends(get_db)):
        system = service.system_for(db, user, system_id, write=True)
        def operation():
            service.require_state(system, 'DRAFT', 'CLASSIFYING', 'CONTEXT_REVIEW', 'CONTROL_REVIEW', 'PRD_REVIEW',
                                  'RESULT_REVIEW', 'NEGOTIATING', 'FINAL_CONFIRMATION', 'PENDING_DEVELOPMENT')
            catalog, release = library.published(db, user.org_id, body.get('catalog_id'))
            facts = normalize_facts(body.get('facts', {}), release.data['config'])
            saved = {'catalog_id': catalog.id, 'facts': facts, 'assessment_profile': body.get('assessment_profile'), 'config_hash': digest(release.data['config'])}
            if system.classification and saved != system.draft.get('tag_profile'):
                service.invalidate(db, system, 'CLASSIFYING')
                system.classification = {}
                system.context_revision_id = None
            changed = saved != system.draft.get('tag_profile')
            system.draft = {**system.draft, 'tag_profile': saved,
                            'proposal_stale': system.draft.get('proposal_stale', False) or changed and bool(system.draft.get('proposal'))}
        return command(request, db, user, system, body, 'context.draft_saved', operation)

    @app.post('/api/v1/systems/{system_id}/catalog-upgrade-preview')
    def upgrade_preview(system_id: str, user=Depends(current), db=Depends(get_db)):
        system = service.system_for(db, user, system_id)
        catalog, release = library.published(db, user.org_id)
        facts = normalize_facts({k: v for k, v in system.classification.get('facts', {}).items() if k in {q['code'] for q in release.data['config']['questions']}}, release.data['config'])
        selected = system.classification.get('assessment_profile', 'MLPS2_REFERENCE')
        previous = {s.snapshot.get('metadata', {}).get('control_id'): s for s in service.selections(db, system)}
        changes = []
        for c in release.data['controls']:
            old = previous.pop(c['control_id'], None)
            after = 'retired' if c['retired'] else library.match(c, facts, selected)['status']
            changes.append({'code': c['control_code'], 'before': old.snapshot.get('match') if old else None, 'after': after,
                            'changed_revision': old is not None and old.snapshot.get('metadata', {}).get('revision') != c['revision']})
        changes.extend({'code': s.snapshot['code'], 'before': s.snapshot.get('match'), 'after': 'removed'} for s in previous.values())
        return {'catalog_id': catalog.id, 'config': copy.deepcopy(release.data['config']), 'facts': facts, 'changes': changes,
                'requires_reconfirmation': catalog.id != system.classification.get('catalog_id')}
