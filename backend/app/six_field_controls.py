"""Six-field source storage. No guessed grading or fabricated assessment procedures."""
import csv
import hashlib
import io
import re
from pathlib import Path

from fastapi import Depends, Form, UploadFile
from sqlalchemy import select

from . import access
from .control_rules import default_config
from .control_workbooks import MAX_BYTES, safe_book
from .db import LibraryWorkspace, SixFieldControl, SixFieldLibrary, SixFieldUpload, SixFieldLevelMapping
from .domain import DomainError, digest

FIELDS = ('source', 'control_identifier', 'security_domain', 'security_control_point', 'control_requirement', 'risk_level')


def parse(filename, raw):
    if not raw or len(raw) > MAX_BYTES:
        raise DomainError('FILE_TOO_LARGE')
    suffix = Path(filename).suffix.lower()
    tables = []
    if suffix == '.csv':
        try:
            tables = [('CSV', list(csv.reader(io.StringIO(raw.decode('utf-8-sig')))))]
        except (UnicodeError, csv.Error) as exc:
            raise DomainError('INVALID_FIELDS', 422, {'reason': 'Expected UTF-8 CSV'}) from exc
    elif suffix == '.xlsx':
        book = safe_book(raw)
        try:
            tables = [(sheet.title, [[str(cell.value) if cell.value is not None else '' for cell in row]
                                     for row in sheet]) for sheet in book]
        finally:
            book.close()
    else:
        raise DomainError('INVALID_FIELDS', 422, {'reason': 'Expected .xlsx or .csv'})
    result, identities = [], set()
    for sheet, rows in tables:
        if not any(any(str(v).strip() for v in row) for row in rows):
            continue
        header = [str(v).strip().lower() for v in rows[0]]
        if len(header) != len(FIELDS) or set(header) != set(FIELDS):
            raise DomainError('INVALID_FIELDS', 422, {'sheet': sheet, 'row': 1, 'expected': FIELDS})
        for number, values in enumerate(rows[1:], 2):
            if not any(v.strip() for v in values):
                continue
            if len(result) >= 10000 or len(values) != 6:
                raise DomainError('INVALID_FIELDS', 422, {'sheet': sheet, 'row': number})
            item = dict(zip(header, values))
            if any(not v.strip() or len(v) > (200 if k in ('source', 'control_identifier', 'risk_level') else 32000)
                   for k, v in item.items()):
                raise DomainError('INVALID_FIELDS', 422, {'sheet': sheet, 'row': number, 'reason': 'Six non-empty bounded fields required'})
            identity = (item['source'].strip(), item['control_identifier'].strip())
            if identity in identities:
                raise DomainError('RECORD_CONFLICT', 409, {'sheet': sheet, 'row': number, 'source': identity[0], 'control_identifier': identity[1]})
            identities.add(identity)
            result.append({**item, 'sheet': sheet, 'row_number': number})
    if not result:
        raise DomainError('INVALID_FIELDS', 422, {'reason': 'No control rows'})
    return result


def reset(db, user):
    """Explicit organization-only reset; history and foreign-key targets remain intact."""
    access.require_admin(db, user)
    if db.get(SixFieldLibrary, user.org_id):
        return
    workspace = db.get(LibraryWorkspace, user.org_id)
    db.add(SixFieldLibrary(org_id=user.org_id, archived_catalog_id=workspace.published_id if workspace else None))
    if workspace:
        access.audit(db, user, 'controls.legacy_archived', {'published_id': workspace.published_id, 'workspace': workspace.data})
        workspace.data = {'config': default_config(), 'controls': []}
        workspace.published_id = None
    else:
        db.add(LibraryWorkspace(org_id=user.org_id, data={'config': default_config(), 'controls': []}, published_id=None))
    access.audit(db, user, 'controls.six_field_initialized', {'fields': FIELDS})
    db.flush()


def view(db, user):
    rows = list(db.scalars(select(SixFieldControl).where(SixFieldControl.org_id == user.org_id).order_by(
        SixFieldControl.source, SixFieldControl.control_identifier)))
    mappings = {m.upload_id: m.level for m in db.scalars(select(SixFieldLevelMapping).join(SixFieldUpload).where(SixFieldUpload.org_id == user.org_id))}
    workspace = db.get(LibraryWorkspace, user.org_id)
    return {'active': db.get(SixFieldLibrary, user.org_id) is not None, 'schema': 'CONTROL-SIX/1', 'fields': FIELDS, 'can_upload': access.is_admin(db, user),
            'matching_ready': bool(workspace and workspace.published_id), 'controls': [{**{k: getattr(row, k) for k in (*FIELDS, 'id', 'upload_id', 'sheet', 'row_number')}, 'mlps_level': mappings.get(row.upload_id)} for row in rows]}


def publish_mapped(db, user):
    """Build immutable compatibility snapshots from the authoritative six columns."""
    from .db import Catalog, Control, ControlMetadata, LibraryRelease
    rows = list(db.execute(select(SixFieldControl, SixFieldUpload, SixFieldLevelMapping).join(
        SixFieldUpload, SixFieldUpload.id == SixFieldControl.upload_id).join(
        SixFieldLevelMapping, SixFieldLevelMapping.upload_id == SixFieldUpload.id).where(
        SixFieldControl.org_id == user.org_id).order_by(SixFieldLevelMapping.level, SixFieldControl.id)))
    if not rows:
        return None
    config, controls = default_config(), []
    config['domains'] = []
    if not any(p['code'] == 'MLPS1_REFERENCE' for p in config['profiles']):
        config['profiles'].append({'code': 'MLPS1_REFERENCE', 'level': 'L1', 'zh': 'MLPS 一级参考', 'en': 'MLPS level 1 reference'})
    for row, upload, mapping in rows:
        fields = {k: getattr(row, k) for k in FIELDS}
        domain = 'SIX-' + digest(row.security_domain)[:20]
        if not any(d['code'] == domain for d in config['domains']):
            config['domains'].append({'code': domain, 'zh': row.security_domain, 'en': row.security_domain})
        identity = digest([row.source.strip(), row.control_identifier.strip()])
        code = f'MLPS{mapping.level}-' + identity[:24]
        original = {'filename': upload.filename, 'sha256': upload.sha256, 'sheet': row.sheet,
                    'row': row.row_number, 'fields': fields}
        controls.append({'control_id': identity[:36], 'revision': 1, 'control_code': code,
            'translations': {'zh': {'title': row.security_control_point, 'description': row.control_requirement,
                'verification': '按控制要求逐项验证并记录结果及证据；具体验收方法待双方细化。'}},
            'assessment_object': row.security_domain, 'domain_code': domain,
            'assessment_profiles': [f'MLPS{mapping.level}_REFERENCE'], 'required': True, 'topic_tags': [],
            'applicability_mode': 'always', 'rule': True, 'responsibility_rule': 'shared',
            'source_framework': f'MLPS_LEVEL_{mapping.level}', 'source_version': upload.sha256,
            'source_ref': row.control_identifier, 'source_level': mapping.level, 'control_family_id': code,
            'change_reason': 'Explicit six-field source upload', 'review_status': 'reviewed', 'retired': False,
            'source': {'schema': 'CONTROL-SIX/1', 'languages': {'zh': original}}, 'tagging_basis': ''})
    data = {'config': config, 'controls': controls}
    content_hash = digest(data)
    catalog = db.scalar(select(Catalog).where(Catalog.org_id == user.org_id, Catalog.code == 'MLPS-SIX', Catalog.content_hash == content_hash))
    if catalog is None:
        catalog = Catalog(org_id=user.org_id, code='MLPS-SIX', version=content_hash[:20], content_hash=content_hash)
        db.add(catalog)
        db.flush()
        db.add(LibraryRelease(catalog_id=catalog.id, data={**data, 'publication_mode': 'six_field_source'}))
        for item in controls:
            control = Control(org_id=user.org_id, catalog_id=catalog.id, code=item['control_code'], domain=item['domain_code'],
                              levels=[f"L{item['source_level']}"], required=True, translations=item['translations'], tags=[])
            db.add(control)
            db.flush()
            db.add(ControlMetadata(control_id=control.id, data=item))
    workspace = db.get(LibraryWorkspace, user.org_id)
    workspace.data, workspace.published_id = data, catalog.id
    db.flush()
    access.audit(db, user, 'controls.six_field_published', {'catalog_id': catalog.id, 'count': len(controls), 'hash': content_hash})
    return catalog


def import_file(db, user, filename, raw, level=None):
    access.require_admin(db, user)
    if len(filename) > 200 or '/' in filename or chr(92) in filename:
        raise DomainError('INVALID_FIELDS')
    match = re.fullmatch(r'MLPS_level_([123])_CN\.(?:xlsx|csv)', filename, re.IGNORECASE)
    if level is None and match:
        level = int(match[1])
    if level not in (None, 1, 2, 3) or match and level != int(match[1]):
        raise DomainError('INVALID_FIELDS', 422, {'reason': 'MLPS file level must be 1, 2 or 3 and match the filename'})
    rows = parse(filename, raw)
    checksum = hashlib.sha256(raw).hexdigest()
    previous = db.scalar(select(SixFieldUpload).where(SixFieldUpload.org_id == user.org_id, SixFieldUpload.sha256 == checksum))
    if previous:
        mapping = db.get(SixFieldLevelMapping, previous.id)
        if mapping and level is not None and mapping.level != level:
            raise DomainError('RECORD_CONFLICT', 409)
        if level is not None and not mapping:
            db.add(SixFieldLevelMapping(upload_id=previous.id, level=level))
            db.flush()
            publish_mapped(db, user)
        return previous, True
    existing = {(row.source.strip(), row.control_identifier.strip()) for row in db.scalars(select(SixFieldControl).where(SixFieldControl.org_id == user.org_id))}
    for item in rows:
        if (item['source'].strip(), item['control_identifier'].strip()) in existing:
            raise DomainError('RECORD_CONFLICT', 409, {'sheet': item['sheet'], 'row': item['row_number']})
    reset(db, user)
    upload = SixFieldUpload(org_id=user.org_id, actor_id=user.id, filename=filename, sha256=checksum, content=raw)
    db.add(upload)
    db.flush()
    for item in rows:
        db.add(SixFieldControl(org_id=user.org_id, upload_id=upload.id, **item))
    if level is not None:
        db.add(SixFieldLevelMapping(upload_id=upload.id, level=level))
    db.flush()
    access.audit(db, user, 'controls.six_field_uploaded', {'upload_id': upload.id, 'sha256': checksum, 'count': len(rows), 'mlps_level': level})
    publish_mapped(db, user)
    return upload, False


def register_routes(app, current, get_db):
    @app.get('/api/v1/source-controls')
    def read(user=Depends(current), db=Depends(get_db)):
        if user.role == 'vendor':
            raise DomainError('FORBIDDEN', 403)
        return view(db, user)

    @app.post('/api/v1/source-controls/uploads')
    async def upload(file: UploadFile, level: int | None = Form(default=None), user=Depends(current), db=Depends(get_db)):
        access.require_admin(db, user)
        raw = await file.read(MAX_BYTES + 1)
        saved, repeated = import_file(db, user, file.filename or '', raw, level)
        db.commit()
        return {**view(db, user), 'upload_id': saved.id, 'already_imported': repeated}
