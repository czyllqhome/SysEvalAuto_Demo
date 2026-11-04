"""Identity-bound CSV previews shared by questionnaires and supplier PRD answers."""
import base64
import binascii
import csv
import io
import time
from sqlalchemy import select
from .. import access
from ..db import Audit, CsvBatch, Prd, Questionnaire, SupplierForm, SupplierRound
from ..domain import DomainError, SupplierAnswer, digest
from . import service
from .csv_rows import cell_value, escaped, reconstruct, row_definitions, unescaped
from .questionnaire import schema

HEADERS = ['template_version', 'form_id', 'supplier_id', 'record_id', 'question', 'field', 'instructions', 'value']
VERSION = 'supplier-csv-1'
MAX_BYTES = 5 * 1024 * 1024
ANSWER_FIELDS = ['implementation_status', 'duration_workdays', 'owner_name', 'implementation_plan', 'limitations', 'alternative', 'estimated_start_date', 'estimated_finish_date']


def state(db, user, system, kind, write=False):
    if kind == 'questionnaire':
        if not schema()['questions']:
            raise DomainError('METHODOLOGY_NOT_CONFIGURED', 409)
        entry = db.get(Questionnaire, system.id)
        if write and ('edit' not in access.capabilities(db, user, system) or entry and entry.workflow_status not in {'draft', 'returned'}):
            raise DomainError('QUESTIONNAIRE_LOCKED', 403)
        return (entry.snapshot.get('answers', {}) if entry else {}), entry.version if entry else 0
    if kind != 'prd':
        raise DomainError('INVALID_FIELDS')
    round_ = db.get(SupplierRound, system.round_id) if system.round_id else None
    if not round_ or round_.status != 'open' or system.status != 'VENDOR_FILLING':
        raise DomainError('ROUND_CLOSED', 409)
    if user.role == 'vendor':
        if round_.supplier_org_id != user.org_id:
            raise DomainError('FORBIDDEN', 403)
    elif write or 'manage' not in access.capabilities(db, user, system):
        raise DomainError('FORBIDDEN', 403)
    return round_.draft, round_.version


def issue(db, user, system, kind, body):
    answers, _ = state(db, user, system, kind)
    if kind == 'questionnaire':
        if 'manage' not in access.capabilities(db, user, system):
            raise DomainError('FORBIDDEN', 403)
        supplier = body.get('supplier_id', '')
        slots = body.get('slots', 5)
        if not isinstance(supplier, str) or not supplier.strip() or len(supplier) > 200 or type(slots) is not int or not 1 <= slots <= 100:
            raise DomainError('INVALID_FIELDS')
        if len(answers.get('INT-02', {}).get('details', [])) > slots:
            raise DomainError('CSV_CAPACITY')
        definition = schema()
        rows = row_definitions(definition, slots)
        definition = {**definition, 'slots': slots}
    else:
        round_ = db.get(SupplierRound, system.round_id)
        supplier = round_.supplier_org_id
        rows = []
        for requirement in db.get(Prd, round_.prd_id).data['requirements']:
            for field in ANSWER_FIELDS:
                rows.append({'id': requirement['id'] + '.' + field, 'question_id': requirement['id'], 'path': [field],
                             'question': requirement['title'], 'field': field,
                             'instructions': 'yes;partial;no;needs_clarification' if field == 'implementation_status' else 'Fill the supplier response / 填写供应商答复',
                             'allowed': ['yes', 'partial', 'no', 'needs_clarification'] if field == 'implementation_status' else None, 'multi': False})
        definition = {}
    existing = db.scalar(select(SupplierForm).where(SupplierForm.system_id == system.id, SupplierForm.kind == kind,
                                                    SupplierForm.revision == system.revision,
                                                    SupplierForm.round_id == (system.round_id if kind == 'prd' else None)).order_by(SupplierForm.created_at.desc()))
    if existing:
        if existing.supplier_id != supplier.strip() or kind == 'questionnaire' and existing.definition['slots'] != slots:
            raise DomainError('CSV_FORM_EXISTS', 409)
        return existing
    form = SupplierForm(system_id=system.id, kind=kind, supplier_id=supplier.strip(), revision=system.revision,
                        round_id=system.round_id if kind == 'prd' else None, definition={**definition, 'rows': rows})
    db.add(form)
    db.flush()
    db.add(Audit(system_id=system.id, actor_id=user.id, action='csv.issued', detail={'form_id': form.id, 'kind': kind}))
    return form


def get_form(db, user, system, form_id, write=False):
    form = db.get(SupplierForm, form_id)
    if not form or form.system_id != system.id:
        raise DomainError('NOT_FOUND', 404)
    if form.revision != system.revision or form.kind == 'prd' and form.round_id != system.round_id:
        raise DomainError('CSV_STALE', 409)
    state(db, user, system, form.kind, write)
    return form


def cells(form, row, value):
    return [VERSION, form.id, form.supplier_id, row['id'], row['question'], row['field'], row['instructions'], value]


def export(db, user, system, form):
    answers, _ = state(db, user, system, form.kind)
    if form.kind == 'questionnaire' and len(answers.get('INT-02', {}).get('details', [])) > form.definition['slots']:
        raise DomainError('CSV_CAPACITY')
    stream = io.StringIO(newline='')
    writer = csv.writer(stream)
    writer.writerow(HEADERS)
    for row in form.definition['rows']:
        value = cell_value(answers, row)
        if value == 'None':
            value = ''
        writer.writerow([escaped(v) for v in cells(form, row, value)])
    return '\ufeff' + stream.getvalue()


def preview(db, user, system, form, body):
    old, version = state(db, user, system, form.kind, True)
    encoded = body.get('content_base64')
    if not isinstance(encoded, str) or len(encoded) > ((MAX_BYTES + 2) // 3) * 4:
        raise DomainError('CSV_INVALID')
    try:
        content = base64.b64decode(encoded, validate=True)
        if not content or len(content) > MAX_BYTES:
            raise ValueError
        source = content.decode('utf-8-sig')
    except (ValueError, UnicodeError, binascii.Error):
        raise DomainError('CSV_INVALID') from None
    rows = form.definition['rows']
    expected = {r['id']: r for r in rows}
    values, errors, changes = {}, [], []
    try:
        reader = csv.reader(io.StringIO(source, newline=''), strict=True)
        header = next(reader, [])
        if len(header) != len(HEADERS) or set(header) != set(HEADERS):
            raise DomainError('CSV_INVALID')
        for number, row_cells in enumerate(reader, 2):
            if number > 10001:
                raise DomainError('CSV_INVALID')
            if not any(v.strip() for v in row_cells):
                continue
            if len(row_cells) != len(HEADERS):
                errors.append({'row': number, 'code': 'columns'})
                continue
            item = dict(zip(header, map(unescaped, row_cells)))
            row = expected.get(item['record_id'])
            if not row or row['id'] in values:
                errors.append({'row': number, 'code': 'record_id'})
                continue
            if any(item[key] != value for key, value in zip(HEADERS[:-1], cells(form, row, '')[:-1])):
                errors.append({'row': number, 'code': 'snapshot_mismatch'})
            value = item['value']
            values[row['id']] = value
            if len(value) > 2000 or '\x00' in value:
                errors.append({'row': number, 'code': 'value_size'})
            if row['allowed'] and value:
                chosen = value.split(';') if row['multi'] else [value]
                if any(v not in row['allowed'] for v in chosen) or len(set(chosen)) != len(chosen):
                    errors.append({'row': number, 'code': 'option'})
        for missing in expected.keys() - values.keys():
            errors.append({'field': missing, 'code': 'missing'})
    except (csv.Error, UnicodeError):
        raise DomainError('CSV_INVALID') from None
    clean = None
    if not errors:
        try:
            if form.kind == 'questionnaire':
                if values.get('INT-01.value') == 'yes' and values.get('INT-02.value') == 'provided':
                    gap = False
                    for i in range(form.definition['slots']):
                        used = any(v for k, v in values.items() if k.startswith(f'INT-02.details.{i}.'))
                        if used and gap:
                            raise DomainError('CSV_RECORD_GAP')
                        gap = gap or not used
                raw = reconstruct(rows, values, form.definition, form.definition['slots'])
                clean = service.result(raw)['answers']
                if clean != old:
                    clean = service.result(raw, True)['answers']
            else:
                raw = {}
                for row in rows:
                    field, value = row['field'], values[row['id']]
                    if field == 'duration_workdays':
                        value = int(value) if value else None
                    if field.startswith('estimated_') and not value:
                        value = None
                    raw.setdefault(row['question_id'], {})[field] = value
                clean = {key: SupplierAnswer.model_validate(value).model_dump(mode='json') for key, value in raw.items()}
            for row in rows:
                before, after = cell_value(old, row), cell_value(clean, row)
                if before != after:
                    changes.append({'field': row['id'], 'before': before, 'after': after})
        except (DomainError, ValueError, TypeError) as exc:
            errors.append({'code': getattr(exc, 'code', 'answer_invalid'), 'detail': getattr(exc, 'detail', None)})
            clean = None
    batch = CsvBatch(form_id=form.id, actor_id=user.id, version=version, answers=clean,
                     preview={}, expires_at=time.time() + 1800)
    db.add(batch)
    db.flush()
    batch.preview = {'batch_id': batch.id, 'can_confirm': not errors, 'errors': errors, 'changes': changes,
                     'expires_at': batch.expires_at, 'file_hash': digest(source)}
    db.add(Audit(system_id=system.id, actor_id=user.id, action='csv.previewed', detail={'batch_id': batch.id, 'errors': len(errors)}))
    return batch.preview


def confirm(db, user, system, form, body):
    _, version = state(db, user, system, form.kind, True)
    batch = db.scalar(select(CsvBatch).where(CsvBatch.id == body.get('batch_id')).with_for_update())
    if not batch or batch.form_id != form.id or batch.actor_id != user.id:
        raise DomainError('NOT_FOUND', 404)
    if batch.confirmed:
        return
    if batch.expires_at <= time.time() or batch.version != version or body.get('version') != system.version:
        raise DomainError('CSV_STALE', 409)
    if batch.answers is None:
        raise DomainError('CSV_INVALID')
    if form.kind == 'questionnaire':
        service.save(db, user, system, {'version': system.version, 'questionnaire_revision': version,
                                      'questionnaire_version': form.definition['questionnaire_version'],
                                      'mapping_version': form.definition['mapping_version'], 'answers': batch.answers, 'action': 'draft'})
    else:
        round_ = db.get(SupplierRound, system.round_id)
        round_.draft = batch.answers
        round_.version += 1
        system.version += 1
    batch.confirmed = True
    db.add(Audit(system_id=system.id, actor_id=user.id, action='csv.imported', detail={'batch_id': batch.id, 'kind': form.kind}))
