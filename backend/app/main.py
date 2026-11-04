"""HTTP application: authenticated commands delegate to explicit domain services."""

from __future__ import annotations

from .ai_settings import configured as ai_configured
from .assessment_creation import profile_view

import asyncio
import base64
import hashlib
import hmac
import os
import secrets
import time
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import Depends, FastAPI, Request, Response, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse
from pydantic import ValidationError
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm.exc import StaleDataError

from . import access, service
from .ai import render_prd
from .catalog import control_snapshot, parse_import, publish_import, seed_catalog
from .db import (
    AccountPolicy, Audit, Base, Baseline, CatalogImport, Control, Invitation, Job, LoginSession,
    ManagedSupplier, Organization, Prd, Receipt, Selection, SupplierRound, System, User,
    database_url, make_engine, make_sessions,
)
from .domain import DOMAINS, TOPICS, DomainError, digest, validate_prd
from .worker import loop


def password_hash(password: str) -> str:
    if not 10 <= len(password) <= 256:
        raise DomainError("PASSWORD_LENGTH")
    salt = secrets.token_bytes(16)
    value = hashlib.scrypt(password.encode(), salt=salt, n=16384, r=8, p=1)
    return base64.b64encode(salt + value).decode()


def password_matches(password: str, stored: str) -> bool:
    try:
        if stored.startswith('{'):
            import json
            legacy = json.loads(stored)
            if legacy.get('algorithm') != 'scrypt' or (legacy.get('n'), legacy.get('r'), legacy.get('p')) != (16384, 8, 1):
                return False
            calculated = hashlib.scrypt(password.encode(), salt=bytes.fromhex(legacy['salt']), n=16384, r=8, p=1).hex()
            return hmac.compare_digest(calculated, legacy['digest'])
        value = base64.b64decode(stored)
        calculated = hashlib.scrypt(password.encode(), salt=value[:16], n=16384, r=8, p=1)
        return hmac.compare_digest(calculated, value[16:])
    except (ValueError, TypeError, KeyError):
        return False


def token_hash(token: str):
    return hashlib.sha256(token.encode()).hexdigest()


def create_app(url: str | None = None, embedded_worker: bool | None = None):
    engine = make_engine(url or database_url())
    sessions = make_sessions(engine)
    enabled = embedded_worker if embedded_worker is not None else os.getenv("SYSEVAL_EMBEDDED_WORKER", "true") == "true"

    @asynccontextmanager
    async def lifespan(_app):
        if os.getenv("SYSEVAL_AUTO_CREATE", "true") == "true":
            Base.metadata.create_all(engine)
        from .mlps_source import ensure_catalog
        from . import methodology
        with sessions() as db:
            if not methodology.LEGACY_FIXTURES_ENABLED:
                from .people import migrate_roles
                migrate_roles(db)
                for organization in db.scalars(select(Organization).where(Organization.kind == 'customer')):
                    ensure_catalog(db, organization.id)
            db.commit()
        stop = asyncio.Event()
        task = asyncio.create_task(loop(sessions, stop)) if enabled else None
        yield
        stop.set()
        if task:
            await task
        engine.dispose()

    app = FastAPI(title="Scope Assessment API", lifespan=lifespan)
    app.state.sessions, app.state.engine = sessions, engine
    attempts = defaultdict(deque)

    def get_db():
        with sessions() as db:
            yield db

    @app.exception_handler(DomainError)
    async def domain_error(_request, exc):
        return JSONResponse(status_code=exc.status, content={"code": exc.code, "detail": exc.detail})

    @app.exception_handler(ValidationError)
    async def validation_error(_request, exc):
        fields = [{"field": ".".join(str(part) for part in e["loc"]), "type": e["type"]}
                  for e in exc.errors()]
        return JSONResponse(status_code=422, content={"code": "INVALID_FIELDS", "fields": fields})

    @app.exception_handler(RequestValidationError)
    async def request_validation_error(_request, _exc):
        return JSONResponse(status_code=422, content={"code": "INVALID_FIELDS"})

    @app.exception_handler(StaleDataError)
    async def stale_error(_request, _exc):
        return JSONResponse(status_code=409, content={"code": "VERSION_CONFLICT"})

    @app.exception_handler(IntegrityError)
    async def constraint_error(_request, _exc):
        return JSONResponse(status_code=409, content={"code": "RECORD_CONFLICT"})

    @app.middleware("http")
    async def protect(request, call_next):
        path = request.url.path
        if request.method not in {'GET', 'HEAD', 'OPTIONS'} and (
            path.startswith('/api/v1/admin/projects') or path.endswith('/assignments')
            or path.startswith('/api/v1/library/') or path.startswith('/api/v1/catalog-imports')
            or path.endswith('/custom-controls')
        ):
            return JSONResponse(status_code=410, content={'code': 'SOURCE_MANAGED_CONFIGURATION'})
        origin = request.headers.get("origin")
        if request.method not in {"GET", "HEAD", "OPTIONS"} and origin:
            allowed = {f"http://{host}:{port}" for host in ("localhost", "127.0.0.1") for port in (5173, 8000)}
            public_origin = os.getenv("SYSEVAL_PUBLIC_ORIGIN")
            if public_origin:
                allowed = {public_origin.rstrip("/")}
            elif urlsplit(origin).netloc == request.headers.get("host"):
                allowed.add(origin)
            if origin not in allowed:
                return JSONResponse(status_code=403, content={"code": "ORIGIN_REJECTED"})
        result = await call_next(request)
        result.headers["X-Content-Type-Options"] = "nosniff"
        result.headers["Referrer-Policy"] = "same-origin"
        result.headers["X-Frame-Options"] = "DENY"
        if request.url.path.startswith("/api/"):
            result.headers["Cache-Control"] = "no-store"
        return result

    def current(request: Request, db=Depends(get_db)):
        token = request.cookies.get("scope_session", "")
        session = db.get(LoginSession, token_hash(token)) if token else None
        if not session or session.expires_at <= time.time():
            raise DomainError("AUTH_REQUIRED", 401)
        if request.method not in {"GET", "HEAD", "OPTIONS"}:
            if not hmac.compare_digest(request.headers.get("X-CSRF-Token", ""), session.csrf):
                raise DomainError("CSRF_REJECTED", 403)
        user = db.get(User, session.user_id)
        if not user or not access.active(db, user):
            raise DomainError('AUTH_REQUIRED', 401)
        policy = access.policy(db, user)
        if policy and policy.must_change_password and request.url.path not in {'/api/v1/auth/session', '/api/v1/auth/password', '/api/v1/auth/logout'}:
            raise DomainError('PASSWORD_CHANGE_REQUIRED', 403)
        return user

    def identity(db, user):
        return access.identity(db, user)

    def sign_in(db, user, response):
        token, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
        db.add(LoginSession(id=token_hash(token), user_id=user.id, csrf=csrf, expires_at=time.time() + 43200))
        db.commit()
        response.set_cookie("scope_session", token, httponly=True, samesite="strict", max_age=43200,
                            secure=os.getenv("SYSEVAL_COOKIE_SECURE", "false") == "true")
        return {"user": identity(db, user), "csrf": csrf, "model_configured": ai_configured(db, user.org_id)}

    def throttle(request):
        key = request.client.host if request.client else "unknown"
        entries = attempts[key]
        cutoff = time.time() - 60
        while entries and entries[0] < cutoff:
            entries.popleft()
        if len(entries) >= 12:
            raise DomainError("RATE_LIMITED", 429)
        entries.append(time.time())

    def command(request, db, user, system, body, action, operation):
        access.require_action(db, user, system, action, body)
        key = request.headers.get("Idempotency-Key")
        receipt_id = digest([user.id, system.id, action, key]) if key else None
        request_hash = digest(body)
        if receipt_id:
            receipt = db.get(Receipt, receipt_id)
            if receipt:
                if receipt.request_hash != request_hash:
                    raise DomainError("IDEMPOTENCY_CONFLICT", 409)
                return receipt.response
        if body.get("version") != system.version:
            raise DomainError("VERSION_CONFLICT", 409)
        extra = operation() or {}
        system.updated_at = time.time()
        system.version += 1
        audit_detail = {"revision": system.revision}
        if action == 'classification.confirmed' and system.classification.get('scheme') == 'MLPS-INTAKE/1':
            audit_detail['classification_snapshot'] = system.classification
        if action == 'context.draft_saved' and body.get('scheme') == 'MLPS-INTAKE/1':
            audit_detail['mlps_intake_snapshot'] = system.draft.get('mlps_intake', {})
        db.add(Audit(system_id=system.id, actor_id=user.id, action=action, detail=audit_detail))
        db.flush()
        result = {**service.system_view(db, system, user), **extra}
        if receipt_id:
            db.add(Receipt(id=receipt_id, request_hash=request_hash, response=result))
        db.commit()
        return result

    @app.get("/api/v1/health")
    def health(db=Depends(get_db)):
        db.execute(select(1))
        return {"status": "ok"}

    @app.post("/api/v1/auth/register")
    def register(body: dict, request: Request, response: Response, db=Depends(get_db)):
        throttle(request)
        email = str(body.get("email", "")).strip().lower()
        name = str(body.get("name", "")).strip()
        if "@" not in email or len(email) > 254 or not name or len(name) > 120:
            raise DomainError("INVALID_FIELDS")
        if db.scalar(select(User).where(User.email == email)):
            raise DomainError("ACCOUNT_EXISTS", 409)
        invite = None
        if body.get("invite_token"):
            invite = db.scalar(select(Invitation).where(Invitation.token_hash == token_hash(body["invite_token"])).with_for_update())
            if not invite or invite.used or invite.expires_at < time.time() or invite.email != email:
                raise DomainError("INVITATION_INVALID")
            org_id, role = invite.supplier_org_id, "vendor"
            invite.used = True
        else:
            organization = str(body.get("organization", "")).strip()
            if not organization or len(organization) > 200:
                raise DomainError("INVALID_FIELDS")
            org = Organization(name=organization, kind="customer")
            db.add(org)
            db.flush()
            org_id, role = org.id, "owner"
        user = User(org_id=org_id, email=email, name=name, role=role, password_hash=password_hash(str(body.get("password", ""))))
        db.add(user)
        db.flush()
        if role == "owner":
            seed_catalog(db, org_id)
            from . import methodology
            if not methodology.LEGACY_FIXTURES_ENABLED:
                from .mlps_source import ensure_catalog
                ensure_catalog(db, org_id)
        return sign_in(db, user, response)

    @app.post("/api/v1/auth/login")
    def login(body: dict, request: Request, response: Response, db=Depends(get_db)):
        throttle(request)
        user = db.scalar(select(User).where(User.email == str(body.get("email", "")).strip().lower()))
        if not user:
            policy = db.scalar(select(AccountPolicy).where(AccountPolicy.username == str(body.get('email', '')).strip().lower()))
            user = db.get(User, policy.user_id) if policy else None
        if not user or not access.active(db, user) or not password_matches(str(body.get("password", ""))[:256], user.password_hash):
            raise DomainError("LOGIN_FAILED", 401)
        return sign_in(db, user, response)

    @app.get("/api/v1/auth/session")
    def session(request: Request, user=Depends(current), db=Depends(get_db)):
        record = db.get(LoginSession, token_hash(request.cookies["scope_session"]))
        return {"user": identity(db, user), "csrf": record.csrf,
                "model_configured": ai_configured(db, user.org_id)}

    @app.post("/api/v1/auth/logout")
    def logout(request: Request, response: Response, user=Depends(current), db=Depends(get_db)):
        record = db.get(LoginSession, token_hash(request.cookies["scope_session"]))
        db.delete(record)
        db.commit()
        response.delete_cookie("scope_session")
        return {"ok": True}

    @app.get("/api/v1/invitations/{token}")
    def invitation(token: str, db=Depends(get_db)):
        invite = db.scalar(select(Invitation).where(Invitation.token_hash == token_hash(token)))
        if not invite or invite.used or invite.expires_at < time.time():
            raise DomainError("INVITATION_INVALID", 404)
        # The opaque capability is required before exposing its recipient address.
        return {"email": invite.email, "system_name": db.get(System, invite.system_id).name,
                "organization": db.get(Organization, invite.supplier_org_id).name}

    @app.get("/api/v1/systems")
    def list_systems(user=Depends(current), db=Depends(get_db)):
        statement = select(System)
        if user.role != "vendor":
            statement = statement.where(System.org_id == user.org_id)
        else:
            statement = statement.where(System.id.in_(select(SupplierRound.system_id).where(SupplierRound.supplier_org_id == user.org_id)))
        result = []
        for system in db.scalars(statement.order_by(System.updated_at.desc())):
            if system.draft.get('deleted_at'):
                continue
            if user.role == "vendor" and not access.supplier_project_access(db, user, system):
                continue
            if user.role != 'vendor' and 'read' not in access.capabilities(db, user, system):
                continue
            context, classification, status = system.context, system.classification, system.status
            if user.role == "vendor":
                assigned = list(db.scalars(select(SupplierRound).where(SupplierRound.system_id == system.id,
                                                                      SupplierRound.supplier_org_id == user.org_id)))
                round_ = next((item for item in assigned if item.id == system.round_id), assigned[-1])
                context, classification = round_.snapshot["context"], round_.snapshot["classification"]
                if round_.id != system.round_id:
                    status = "ROUND_CLOSED"
            result.append({"id": system.id, "name": system.name, "status": status, "revision": system.revision,
                           "level": classification.get("effective_level"), "updated_at": system.updated_at, "version": system.version,
                           "department": ", ".join(context.get("departments", [])),
                           **profile_view(db, system)})
        return result

    @app.get('/api/v1/assessment-options')
    def assessment_options(user=Depends(current), db=Depends(get_db)):
        from .assessment_creation import creation_options
        return creation_options(db, user)

    @app.post("/api/v1/systems")
    def create_system(body: dict, request: Request, user=Depends(current), db=Depends(get_db)):
        from .assessment_creation import create_assessment
        key = request.headers.get('Idempotency-Key')
        receipt_id = digest([user.id, 'assessment.create', key]) if key else None
        if receipt_id:
            receipt = db.get(Receipt, receipt_id)
            if receipt:
                if receipt.request_hash != digest(body):
                    raise DomainError('IDEMPOTENCY_CONFLICT', 409)
                service.system_for(db, user, receipt.response['system']['id'])
                return receipt.response
        system = create_assessment(db, user, body)
        db.flush()
        result = service.system_view(db, system, user)
        if receipt_id:
            db.add(Receipt(id=receipt_id, request_hash=digest(body), response=result))
        db.commit()
        return result

    @app.get("/api/v1/systems/{system_id}")
    def get_system(system_id: str, user=Depends(current), db=Depends(get_db)):
        return service.system_view(db, service.system_for(db, user, system_id), user)

    @app.delete('/api/v1/systems/{system_id}')
    def delete_assessment(system_id: str, body: dict, user=Depends(current), db=Depends(get_db)):
        access.require_admin(db, user)
        system = service.system_for(db, user, system_id, write=True)
        if system.org_id != user.org_id:
            raise DomainError('NOT_FOUND', 404)
        if body.get('version') != system.version:
            raise DomainError('VERSION_CONFLICT', 409)
        system.draft = {**system.draft, 'deleted_at': time.time(), 'deleted_by': user.id}
        system.version += 1
        system.revision += 1
        system.updated_at = time.time()
        db.add(Audit(system_id=system.id, actor_id=user.id, action='assessment.deleted'))
        access.audit(db, user, 'assessment.deleted', {'system_id': system.id, 'name': system.name})
        db.commit()
        return {'deleted': True, 'id': system.id}

    @app.put('/api/v1/systems/{system_id}/name')
    def rename_system(system_id: str, body: dict, request: Request, user=Depends(current), db=Depends(get_db)):
        system = service.system_for(db, user, system_id, write=True)
        def operation():
            service.require_state(system, 'DRAFT', 'CLASSIFYING', 'CONTEXT_REVIEW')
            name = body.get('name')
            if not isinstance(name, str) or not name.strip() or len(name.strip()) > 200:
                raise DomainError('INVALID_FIELDS')
            previous = system.name
            system.name = name.strip()
            db.add(Audit(system_id=system.id, actor_id=user.id, action='system.renamed', detail={'before': previous, 'after': system.name}))
            if system.draft.get('proposal'):
                system.draft = {**system.draft, 'proposal_stale': True}
        return command(request, db, user, system, body, 'context.draft_saved', operation)

    @app.put("/api/v1/systems/{system_id}/context-draft")
    def draft(system_id: str, body: dict, request: Request, user=Depends(current), db=Depends(get_db)):
        system = service.system_for(db, user, system_id, write=True)
        def operation():
            blocks = body.get("blocks", system.draft.get("blocks", {}))
            if not isinstance(blocks, dict) or not set(blocks) <= set(TOPICS):
                raise DomainError("INVALID_FIELDS")
            if any(not isinstance(text, str) or len(text) > 10000 for text in blocks.values()) or sum(map(len, blocks.values())) > 50000:
                raise DomainError("INPUT_TOO_LARGE")
            if body.get("proposal") is not None and not isinstance(body["proposal"], dict):
                raise DomainError("INVALID_FIELDS")
            if len(str(body.get("proposal", ""))) > 1_000_000:
                raise DomainError("INPUT_TOO_LARGE")
            edits = dict(system.draft.get('block_edits', {}))
            for key in set(blocks) | set(system.draft.get('blocks', {})):
                if blocks.get(key, '') != system.draft.get('blocks', {}).get(key, ''):
                    edits[key] = edits.get(key, 0) + 1
            system.draft = {**system.draft, 'block_edits': edits}
            changed_source = blocks != system.draft.get("blocks", {})
            stale = system.draft.get("proposal_stale", False)
            if changed_source and (system.draft.get("proposal") or system.context_revision_id):
                stale = True
            if isinstance(body.get("proposal"), dict) and body.get("acknowledge_source_change") is True:
                stale = False
            system.draft = {**system.draft, "blocks": blocks,
                            "proposal": body.get("proposal", system.draft.get("proposal")), "proposal_stale": stale}
        return command(request, db, user, system, body, "context.draft_saved", operation)

    @app.post("/api/v1/systems/{system_id}/classification-confirmations")
    def classification(system_id: str, body: dict, request: Request, user=Depends(current), db=Depends(get_db)):
        system = service.system_for(db, user, system_id, write=True)
        return command(request, db, user, system, body, "classification.confirmed",
                       lambda: service.confirm_classification(db, system, body))

    @app.post("/api/v1/systems/{system_id}/context-confirmations")
    def context_confirmation(system_id: str, body: dict, request: Request, user=Depends(current), db=Depends(get_db)):
        system = service.system_for(db, user, system_id, write=True)
        return command(request, db, user, system, body, "context.confirmed",
                       lambda: service.confirm_context(db, system, body))

    @app.get("/api/v1/controls")
    def controls(system_id: str | None = None, domain: str = "", q: str = "", page: int = 1,
                 user=Depends(current), db=Depends(get_db)):
        if user.role == "vendor":
            raise DomainError("FORBIDDEN", 403)
        system = service.system_for(db, user, system_id) if system_id else None
        catalog_id = system.classification.get("catalog_id") if system else None
        catalog_id = catalog_id or service.current_catalog(db, user.org_id).id
        recorded = [s.control_id for s in service.selections(db, system)] if system else []
        rows = list(db.scalars(select(Control).where(Control.org_id == user.org_id,
                                                    or_(Control.catalog_id == catalog_id, Control.id.in_(recorded)),
                                                    or_(Control.project_id.is_(None), Control.project_id == system.id) if system else Control.project_id.is_(None)
                                                    ).order_by(Control.code)))
        if domain:
            rows = [row for row in rows if row.domain == domain]
        if q:
            query = q.casefold()
            rows = [row for row in rows if query in (row.code + str(row.translations)).casefold()]
        page = max(1, page)
        from .db import LibraryRelease
        release = db.get(LibraryRelease, catalog_id)
        labels = {d['code']: [d['zh'], d['en']] for d in release.data['config']['domains']} if release else {}
        return {"items": [control_snapshot(row) for row in rows[(page - 1) * 100:page * 100]],
                "total": len(rows), "page": page, "domains": list(labels) or DOMAINS, "domain_labels": labels}

    @app.post("/api/v1/systems/{system_id}/controls")
    def select_control(system_id: str, body: dict, request: Request, user=Depends(current), db=Depends(get_db)):
        system = service.system_for(db, user, system_id, write=True)
        def operation():
            service.require_state(system, "CONTROL_REVIEW")
            control = db.get(Control, body.get("control_id", ""))
            if not control or control.org_id != user.org_id or (control.project_id and control.project_id != system.id):
                raise DomainError("NOT_FOUND", 404)
            existing = next((s for s in service.selections(db, system) if s.control_id == control.id), None)
            if not existing and control.catalog_id != system.classification.get('catalog_id'):
                raise DomainError('CATALOG_VERSION_CONFLICT', 409)
            included = body.get("included", True)
            if not isinstance(included, bool):
                raise DomainError("INVALID_FIELDS")
            reason = str(body.get("reason", "")).strip()
            if not included and not reason:
                raise DomainError("EXCLUSION_REASON_REQUIRED")
            if existing:
                existing.included, existing.reason = included, reason
                existing.origin = 'manual'
            else:
                db.add(Selection(system_id=system.id, revision=system.revision, control_id=control.id,
                                 included=included, reason=reason, origin="manual", snapshot=control_snapshot(control)))
        return command(request, db, user, system, body, "control.selection_changed", operation)

    @app.post("/api/v1/systems/{system_id}/controls/exclude-domains")
    def exclude_control_domains(system_id: str, body: dict, request: Request,
                                user=Depends(current), db=Depends(get_db)):
        system = service.system_for(db, user, system_id, write=True)

        def operation():
            service.require_state(system, "CONTROL_REVIEW")
            domains = body.get("domains")
            reason = body.get("reason")
            if not isinstance(domains, list) or not domains or any(
                not isinstance(domain, str) or not domain.strip() for domain in domains
            ):
                raise DomainError("INVALID_FIELDS")
            if not isinstance(reason, str) or not reason.strip():
                raise DomainError("EXCLUSION_REASON_REQUIRED")
            rows = [row for row in service.selections(db, system)
                    if row.included and row.snapshot.get("domain") in domains]
            if set(domains) != {row.snapshot.get("domain") for row in rows}:
                raise DomainError("VERSION_CONFLICT", 409)
            for row in rows:
                row.included, row.reason, row.origin = False, reason.strip(), "manual"
            db.add(Audit(system_id=system.id, actor_id=user.id, action="control.domains_excluded",
                         detail={"revision": system.revision, "domains": sorted(set(domains)),
                                 "control_ids": [row.control_id for row in rows], "reason": reason.strip()}))

        return command(request, db, user, system, body, "control.selection_changed", operation)

    @app.post("/api/v1/systems/{system_id}/custom-controls")
    def custom_control(system_id: str, body: dict, request: Request, user=Depends(current), db=Depends(get_db)):
        system = service.system_for(db, user, system_id, write=True)
        def operation():
            service.require_state(system, "CONTROL_REVIEW")
            title, description, verification = (str(body.get(key, "")).strip() for key in ("title", "description", "verification"))
            from .db import LibraryRelease
            release = db.get(LibraryRelease, system.classification.get('catalog_id', ''))
            domains = {d['code'] for d in release.data['config']['domains']} if release else DOMAINS
            if not title or not description or not verification or body.get("domain") not in domains:
                raise DomainError("INVALID_FIELDS")
            if len(title) > 500 or max(len(description), len(verification)) > 8000:
                raise DomainError("INPUT_TOO_LARGE")
            translation = {"title": title, "description": description, "verification": verification}
            control = Control(org_id=user.org_id, project_id=system.id,
                              catalog_id=system.classification["catalog_id"], code=f"CUSTOM-{secrets.token_hex(4).upper()}",
                              domain=body["domain"], levels=[system.classification["effective_level"]],
                              required=False, translations={"en": translation, "zh": translation}, tags=[])
            db.add(control)
            db.flush()
            db.add(Selection(system_id=system.id, revision=system.revision, control_id=control.id, included=True,
                             origin="custom", reason="", snapshot=control_snapshot(control)))
        return command(request, db, user, system, body, "control.custom_added", operation)

    @app.post("/api/v1/catalog-imports")
    async def import_csv(file: UploadFile, user=Depends(current), db=Depends(get_db)):
        if user.role != "owner":
            raise DomainError("FORBIDDEN", 403)
        rows, errors, content_hash = parse_import(await file.read(10 * 1024 * 1024 + 1))
        imported = CatalogImport(org_id=user.org_id, rows=rows, errors=errors, content_hash=content_hash)
        db.add(imported)
        db.commit()
        return {"id": imported.id, "count": len(rows), "errors": errors,
                "domains": {domain: sum(r["domain_code"] == domain for r in rows) for domain in DOMAINS}}

    @app.post("/api/v1/catalog-imports/{import_id}/publish")
    def publish_csv(import_id: str, user=Depends(current), db=Depends(get_db)):
        imported = db.get(CatalogImport, import_id)
        if not imported or imported.org_id != user.org_id or user.role != "owner":
            raise DomainError("NOT_FOUND", 404)
        catalog = publish_import(db, imported)
        db.commit()
        return {"id": catalog.id, "code": catalog.code, "version": catalog.version}

    @app.get("/api/v1/catalog-template")
    def csv_template(user=Depends(current)):
        return FileResponse(Path(__file__).resolve().parents[2] / "control-import.example.csv",
                            media_type="text/csv", filename="control-import.example.csv")

    @app.post("/api/v1/systems/{system_id}/jobs")
    def start_job(system_id: str, body: dict, request: Request, user=Depends(current), db=Depends(get_db)):
        system = service.system_for(db, user, system_id, write=True)
        def operation():
            kind = body.get('kind')
            if kind == 'function_expansion':
                function_id = body.get('function_id')
                if not isinstance(function_id, str) or not function_id:
                    raise DomainError('INVALID_FIELDS')
                kind = 'function_expansion:' + digest(function_id)[:16]
            job = service.schedule(db, system, kind, body.get("mode", "local"), body.get("language", "zh"),
                                   reparse=body.get('reparse') is True)
            if job.kind == 'prd_import_extraction' and 'import_actor' not in job.usage:
                job.usage = {**job.usage, 'import_actor': user.id,
                             'import_blocks': dict(system.draft.get('blocks', {})),
                             'import_edits': dict(system.draft.get('block_edits', {}))}
            return {"job_id": job.id}
        return command(request, db, user, system, body, "job.queued", operation)

    @app.get("/api/v1/jobs/{job_id}")
    def get_job(job_id: str, user=Depends(current), db=Depends(get_db)):
        job = db.get(Job, job_id)
        if not job:
            raise DomainError("NOT_FOUND", 404)
        service.system_for(db, user, job.system_id, write=user.role == "owner")
        if user.role == "vendor":
            round_ = db.get(SupplierRound, job.input.get("round_id")) if job.kind == "impact_analysis" else None
            if not round_ or round_.supplier_org_id != user.org_id:
                raise DomainError("NOT_FOUND", 404)
        return {"id": job.id, "state": job.state, "kind": job.kind, "mode": job.mode,
                "error": job.error, "attempts": job.attempts, "usage": {k: v for k, v in job.usage.items() if k != "ai_config"},
                "output": job.output if job.kind.startswith(('narrative_refinement:', 'function_expansion:')) and job.state == 'succeeded' else None}

    @app.post("/api/v1/systems/{system_id}/prd-withdrawal")
    def withdraw_prd(system_id: str, body: dict, request: Request, user=Depends(current), db=Depends(get_db)):
        system = service.system_for(db, user, system_id, write=True)

        def operation():
            service.require_state(system, "PRD_REVIEW")
            if not system.prd_id or body.get("prd_id") != system.prd_id:
                raise DomainError("VERSION_CONFLICT", 409)
            # Preserve the immutable PRD and selections on their previous revision.
            service.invalidate(db, system, "CONTROL_REVIEW")

        return command(request, db, user, system, body, "prd.withdrawn", operation)

    @app.post("/api/v1/systems/{system_id}/prd-approval")
    def approve_prd(system_id: str, body: dict, request: Request, user=Depends(current), db=Depends(get_db)):
        system = service.system_for(db, user, system_id, write=True)
        def operation():
            service.require_state(system, "PRD_REVIEW")
            db.get(Prd, system.prd_id).approved = True
        return command(request, db, user, system, body, "prd.approved", operation)

    @app.post("/api/v1/systems/{system_id}/prd-versions")
    def edit_prd(system_id: str, body: dict, request: Request, user=Depends(current), db=Depends(get_db)):
        system = service.system_for(db, user, system_id, write=True)
        def operation():
            service.require_state(system, "PRD_REVIEW")
            original = db.get(Prd, system.prd_id)
            source = service.job_input(db, system, "prd_generation")
            data = validate_prd(body.get("data", {}), system.context, source["controls"])
            from . import prd_templates
            pinned = prd_templates.recorded(db, original)
            from .topology import embed
            source = {**source, 'network_topology': embed(db, system.id, source.get('network_topology', []))}
            markdown = render_prd(data, source, original.language, pinned)
            edited = Prd(system_id=system.id, revision=system.revision, language=original.language,
                         mode="manual", data=data, markdown=markdown,
                         content_hash=digest({"data": data, "markdown": markdown, "renderer": "R1"}))
            db.add(edited)
            db.flush()
            system.prd_id = edited.id
            prd_templates.record(db, edited, pinned)
        return command(request, db, user, system, body, "prd.revised", operation)

    @app.get("/api/v1/systems/{system_id}/prd-versions/{prd_id}/document")
    def download_prd(system_id: str, prd_id: str, user=Depends(current), db=Depends(get_db)):
        system = service.system_for(db, user, system_id)
        prd = db.get(Prd, prd_id)
        if not prd or prd.system_id != system.id:
            raise DomainError("NOT_FOUND", 404)
        if user.role == "vendor" and not db.scalar(select(SupplierRound.id).where(
            SupplierRound.prd_id == prd.id, SupplierRound.supplier_org_id == user.org_id
        )):
            raise DomainError("NOT_FOUND", 404)
        return PlainTextResponse(prd.markdown, headers={"Content-Disposition": f'attachment; filename="PRD-{prd.id[:8]}-{prd.language}.md"'})

    @app.get("/api/v1/systems/{system_id}/supplier-candidates")
    def supplier_candidates(system_id: str, user=Depends(current), db=Depends(get_db)):
        system = service.system_for(db, user, system_id, write=True)
        candidates = db.scalars(select(User).join(ManagedSupplier, ManagedSupplier.user_id == User.id)
                               .where(ManagedSupplier.customer_org_id == user.org_id, User.role == 'vendor'))
        return [{"id": item.id, "name": item.name} for item in candidates
                if access.active(db, item) and access.supplier_project_access(db, item, system)]

    @app.post("/api/v1/systems/{system_id}/supplier-rounds")
    def publish_round(system_id: str, body: dict, request: Request, user=Depends(current), db=Depends(get_db)):
        system = service.system_for(db, user, system_id, write=True)
        def operation():
            service.require_state(system, "PRD_REVIEW")
            prd = db.get(Prd, system.prd_id)
            if not prd or not prd.approved:
                raise DomainError("PRD_APPROVAL_REQUIRED", 409)
            supplier_id = body.get("supplier_user_id")
            assigned_vendor = db.get(User, supplier_id) if isinstance(supplier_id, str) else None
            if supplier_id:
                managed = db.get(ManagedSupplier, supplier_id) if assigned_vendor else None
                if (not managed or managed.customer_org_id != user.org_id
                        or assigned_vendor.role != 'vendor' or not access.active(db, assigned_vendor)
                        or not access.supplier_project_access(db, assigned_vendor, system)):
                    raise DomainError("INVALID_ASSIGNEE")
            email, name = ((assigned_vendor.email, assigned_vendor.name) if assigned_vendor else
                           (str(body.get("email", "")).strip().lower(), str(body.get("supplier_name", "")).strip()))
            if "@" not in email or not name or len(email) > 254 or len(name) > 200:
                raise DomainError("INVALID_FIELDS")
            vendor = db.scalar(select(User).where(User.email == email))
            if vendor and vendor.role != "vendor":
                raise DomainError("DISTINCT_APPROVERS_REQUIRED")
            if vendor:
                if not access.active(db, vendor) or not access.supplier_project_access(db, vendor, system):
                    raise DomainError("INVALID_ASSIGNEE")
                org_id = vendor.org_id
            else:
                org = Organization(name=name, kind="supplier")
                db.add(org)
                db.flush()
                org_id = org.id
            token = secrets.token_urlsafe(32)
            invitation = Invitation(token_hash=token_hash(token), system_id=system.id,
                                    supplier_org_id=org_id, email=email, expires_at=time.time() + 7 * 86400)
            db.add(invitation)
            round_ = SupplierRound(system_id=system.id, supplier_org_id=org_id, prd_id=prd.id,
                                   snapshot={"controls": [s.snapshot for s in service.selections(db, system, included_only=True)],
                                             "context": system.context, "classification": system.classification,
                                             "context_revision_id": system.context_revision_id})
            db.add(round_)
            db.flush()
            system.round_id, system.status = round_.id, "VENDOR_FILLING"
            return {"invite_token": token if not vendor else None, "existing_supplier": bool(vendor)}
        return command(request, db, user, system, body, "supplier.round_published", operation)

    @app.post("/api/v1/systems/{system_id}/supplier-invitations")
    def reissue_invitation(system_id: str, body: dict, request: Request, user=Depends(current), db=Depends(get_db)):
        system = service.system_for(db, user, system_id, write=True)
        def operation():
            service.require_state(system, "VENDOR_FILLING")
            round_ = db.get(SupplierRound, system.round_id)
            previous = list(db.scalars(select(Invitation).where(Invitation.system_id == system.id,
                                                               Invitation.supplier_org_id == round_.supplier_org_id)))
            if not previous:
                raise DomainError("INVITATION_INVALID")
            old = previous[-1]
            if db.scalar(select(User).where(User.org_id == round_.supplier_org_id, User.role == "vendor")):
                return {"existing_supplier": True}
            for invitation in previous:
                invitation.used = True
            token = secrets.token_urlsafe(32)
            db.add(Invitation(token_hash=token_hash(token), system_id=system.id,
                              supplier_org_id=round_.supplier_org_id, email=old.email,
                              expires_at=time.time() + 7 * 86400))
            return {"invite_token": token}
        return command(request, db, user, system, body, "supplier.invitation_reissued", operation)

    @app.put("/api/v1/systems/{system_id}/supplier-draft")
    def supplier_draft(system_id: str, body: dict, request: Request, user=Depends(current), db=Depends(get_db)):
        system = service.system_for(db, user, system_id)
        round_ = db.get(SupplierRound, system.round_id) if system.round_id else None
        if not round_ or user.role != "vendor" or round_.supplier_org_id != user.org_id:
            raise DomainError("FORBIDDEN", 403)
        def operation():
            if round_.status != "open" or body.get("round_version") != round_.version:
                raise DomainError("ROUND_CLOSED", 409)
            answers = body.get("answers", {})
            ids = {r["id"] for r in db.get(Prd, round_.prd_id).data["requirements"]}
            if not isinstance(answers, dict) or not set(answers) <= ids or len(str(answers)) > 2_000_000:
                raise DomainError("INVALID_FIELDS")
            round_.draft = answers
            round_.version += 1
        return command(request, db, user, system, body, "supplier.draft_saved", operation)

    @app.post("/api/v1/systems/{system_id}/supplier-submit")
    def submit_supplier(system_id: str, body: dict, request: Request, user=Depends(current), db=Depends(get_db)):
        system = service.system_for(db, user, system_id)
        round_ = db.get(SupplierRound, system.round_id) if system.round_id else None
        if not round_:
            raise DomainError("ROUND_CLOSED", 409)
        def operation():
            job = service.save_submission(db, system, round_, user, body)
            return {"job_id": job.id}
        return command(request, db, user, system, body, "supplier.submitted", operation)

    @app.post("/api/v1/systems/{system_id}/requirement-risk")
    async def requirement_risk(system_id: str, body: dict, user=Depends(current), db=Depends(get_db)):
        from . import ai, ai_settings
        from .domain import validate_report
        system = service.system_for(db, user, system_id, write=user.role != 'vendor')
        if body.get('version') != system.version or body.get('report_id') != system.report_id:
            raise DomainError('VERSION_CONFLICT', 409)
        source = service.job_input(db, system, 'impact_analysis')
        rid = body.get('requirement_id')
        requirements = [r for r in source['prd']['requirements'] if r['id'] == rid]
        from .db import Report
        current_report = db.get(Report, system.report_id)
        has_risk = current_report and any(f['requirement_id'] == rid and f['severity'] in ('low', 'medium', 'high', 'critical') for f in current_report.data['findings'])
        if not requirements or not (has_risk or source['answers'].get(rid, {}).get('implementation_status') in ('no', 'partial')):
            raise DomainError('INVALID_SOURCE_REFERENCE')
        version, report_id = system.version, system.report_id
        from .db import Prd
        originals = service.impact_control_originals(db, system, db.get(Prd, system.prd_id)).get(rid, [])
        source = ai.redact_source({'prd': {'requirements': requirements}, 'answers': {rid: source['answers'][rid]}})
        source['control_originals'] = originals
        config = ai_settings.snapshot(db, system.org_id)
        config['prompts']['impact_analysis'] += (' For this single requirement, describe potential security risks, '
            'missing safeguards and possible consequences in impact using at most three short sentences. '
            'Do not claim an actual vulnerability or incident is confirmed. Keep recommendation to one short sentence.')
        token = ai_settings.active_config.set(config)
        db.rollback()
        try:
            output, usage = await ai.generate('impact_analysis', source, body.get('language', 'zh'), 'openrouter')
        finally:
            ai_settings.active_config.reset(token)
        system = service.system_for(db, user, system_id, write=user.role != 'vendor')
        if system.version != version or system.report_id != report_id:
            raise DomainError('VERSION_CONFLICT', 409)
        output = validate_report(output, requirements, source['answers'])
        access.audit(db, user, 'impact.single_requirement_analyzed',
                     {'system_id': system_id, 'report_id': report_id, 'requirement_id': rid, 'usage': usage})
        db.commit()
        return {'report_id': report_id, 'requirement_id': rid, 'findings': output['findings']}

    @app.post("/api/v1/systems/{system_id}/review-decisions")
    def review(system_id: str, body: dict, request: Request, user=Depends(current), db=Depends(get_db)):
        system = service.system_for(db, user, system_id, write=True)
        return command(request, db, user, system, body, "report.reviewed",
                       lambda: service.review_report(db, system, body))

    @app.post("/api/v1/systems/{system_id}/negotiation-rounds")
    def negotiate(system_id: str, body: dict, request: Request, user=Depends(current), db=Depends(get_db)):
        system = service.system_for(db, user, system_id, write=True)
        def operation():
            service.require_state(system, "RESULT_REVIEW", "NEGOTIATING", "FINAL_CONFIRMATION")
            old = db.get(SupplierRound, system.round_id)
            if not str(body.get("reason", "")).strip():
                raise DomainError("REASON_REQUIRED")
            old.status = "closed"
            new = SupplierRound(system_id=system.id, supplier_org_id=old.supplier_org_id,
                                prd_id=old.prd_id, snapshot={**old.snapshot, "instructions": body["reason"]}, draft=old.draft)
            db.add(new)
            db.flush()
            system.round_id, system.report_id, system.baseline_id = new.id, None, None
            system.status = "VENDOR_FILLING"
            return {"round_id": new.id}
        return command(request, db, user, system, body, "negotiation.opened", operation)

    @app.post("/api/v1/systems/{system_id}/baselines")
    def freeze(system_id: str, body: dict, request: Request, user=Depends(current), db=Depends(get_db)):
        system = service.system_for(db, user, system_id, write=True)
        return command(request, db, user, system, body, "baseline.frozen", lambda: service.freeze_baseline(db, system))

    @app.post("/api/v1/baselines/{baseline_id}/confirmations")
    def approve_baseline(baseline_id: str, body: dict, request: Request, user=Depends(current), db=Depends(get_db)):
        baseline = db.get(Baseline, baseline_id)
        if not baseline:
            raise DomainError("NOT_FOUND", 404)
        system = service.system_for(db, user, baseline.system_id, write=user.role == "owner")
        return command(request, db, user, system, body, "baseline.confirmed",
                       lambda: service.confirm_baseline(db, system, baseline, user, body.get("content_hash")))

    @app.post("/api/v1/baselines/{baseline_id}/finalize")
    def finalize_baseline(baseline_id: str, body: dict, request: Request, user=Depends(current), db=Depends(get_db)):
        baseline = db.get(Baseline, baseline_id)
        if not baseline:
            raise DomainError("NOT_FOUND", 404)
        system = service.system_for(db, user, baseline.system_id, write=True)
        return command(request, db, user, system, body, "baseline.finalized",
                       lambda: service.finalize(db, system, baseline, user))

    @app.get("/api/v1/systems/{system_id}/history")
    def history(system_id: str, user=Depends(current), db=Depends(get_db)):
        if user.role == "vendor":
            raise DomainError("NOT_FOUND", 404)
        service.system_for(db, user, system_id)
        return [{"id": e.id, "action": e.action, "detail": e.detail, "created_at": e.created_at}
                for e in db.scalars(select(Audit).where(Audit.system_id == system_id).order_by(Audit.created_at.desc()).limit(200))]

    from .delivery_routes import register_routes as register_delivery_routes
    from .people import register_routes as register_people_routes
    register_people_routes(app, current, get_db)
    register_delivery_routes(app, current, get_db)
    from .existing_routes import register_routes as register_existing_routes
    register_existing_routes(app, current, get_db, command)
    from .prd_imports import register_routes as register_import_routes
    register_import_routes(app, current, get_db, command)
    from .ai_settings import register_routes as register_ai_routes
    register_ai_routes(app, current, get_db)
    from .integration import register_routes
    register_routes(app, current, get_db, password_hash, password_matches)
    from .library_routes import register_routes as register_library_routes
    register_library_routes(app, current, get_db, command)

    from .six_field_controls import register_routes as register_source_routes
    register_source_routes(app, current, get_db)

    from .topology import register_routes as register_topology_routes
    register_topology_routes(app, current, get_db)

    dist = Path(__file__).resolve().parents[2] / "frontend" / "dist"

    @app.get("/{path:path}", include_in_schema=False)
    def frontend(path: str):
        if path.startswith("api/"):
            raise DomainError("NOT_FOUND", 404)
        target = (dist / path).resolve()
        if target.is_relative_to(dist.resolve()) and target.is_file():
            return FileResponse(target)
        if (dist / "index.html").exists():
            return FileResponse(dist / "index.html")
        return JSONResponse({"code": "FRONTEND_NOT_BUILT", "dev_url": "http://127.0.0.1:5173"}, status_code=404)

    return app


app = create_app()
