"""Organization-scoped editable catalog drafts and immutable releases."""
import copy
import re


from . import access
from .control_rules import PROFILES, default_config, evaluate_rule, invalid, refs, validate_config, validate_rule
from .db import Catalog, Control, ControlMetadata, LibraryRelease, LibraryWorkspace, uid
from .domain import DomainError, digest

RESPONSIBILITIES = ('customer', 'supplier', 'shared', 'by_component')


def workspace(db, org_id):
    row = db.get(LibraryWorkspace, org_id)
    return row


def state(db, org_id):
    row = workspace(db, org_id)
    return {'version': row.version if row else 0, 'published_id': row.published_id if row else None,
            **copy.deepcopy(row.data if row else {'config': default_config(), 'controls': []})}


def mutate(db, user, version, data, action):
    access.require_admin(db, user)
    row = workspace(db, user.org_id)
    if version != (row.version if row else 0):
        raise DomainError('VERSION_CONFLICT', 409)
    if row:
        row.data = copy.deepcopy(data)
        row.version += 1
    else:
        row = LibraryWorkspace(org_id=user.org_id, data=copy.deepcopy(data))
        db.add(row)
    access.audit(db, user, action, {'before_version': version, 'data_hash': digest(data)})
    db.flush()
    return row


def validate_control(raw, config):
    item = copy.deepcopy(raw)
    allowed = {'control_id', 'revision', 'control_code', 'translations', 'assessment_object', 'domain_code',
               'assessment_profiles', 'required', 'topic_tags', 'applicability_mode', 'rule', 'responsibility_rule',
               'source_framework', 'source_version', 'source_ref', 'source_level', 'control_family_id',
               'change_reason', 'review_status', 'retired', 'source', 'tagging_basis', 'public_access_relevance'}
    if not isinstance(item, dict) or set(item) - allowed:
        invalid('control', 'Unknown control fields')
    code = item.get('control_code')
    if not isinstance(code, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,79}', code):
        invalid('control_code', 'Use a stable code up to 80 characters')
    for field in ('assessment_object', 'source_framework', 'source_version', 'source_ref', 'control_family_id', 'change_reason', 'tagging_basis'):
        value = item.setdefault(field, '')
        if not isinstance(value, str) or len(value) > 32000:
            invalid(field, 'Expected bounded text')
    if not item['assessment_object'].strip():
        invalid('assessment_object', 'Assessment object is required')
    translations = item.get('translations')
    if not isinstance(translations, dict) or not translations or set(translations) - {'zh', 'en'}:
        invalid('translations', 'At least one complete language is required')
    for lang, fields in translations.items():
        if not isinstance(fields, dict) or set(fields) != {'title', 'description', 'verification'} or any(not isinstance(v, str) or not v.strip() or len(v) > 32000 for v in fields.values()):
            invalid(f'translations.{lang}', 'Complete title, requirement and verification text are required')
    if item.get('domain_code') not in {d['code'] for d in config['domains']}:
        invalid('domain_code', 'Unknown domain')
    for field, collection in (('assessment_profiles', 'profiles'), ('topic_tags', 'topics')):
        values = item.setdefault(field, [])
        if not isinstance(values, list) or any(not isinstance(v, str) or v not in {d['code'] for d in config[collection]} for v in values) or len(set(values)) != len(values):
            invalid(field, 'Unknown or duplicate code')
    if not item['assessment_profiles']:
        invalid('assessment_profiles', 'Choose at least one profile')
    if type(item.get('required')) is not bool or type(item.get('retired', False)) is not bool:
        invalid('required', 'Expected boolean')
    item.setdefault('retired', False)
    if item.get('review_status') not in ('draft', 'reviewed') or item.get('responsibility_rule') not in RESPONSIBILITIES:
        invalid('review_status', 'Select review status and responsibility')
    if item.get('source_level') not in (None, '', 1, 2, 3):
        invalid('source_level', 'Source level must be empty, 1, 2 or 3')
    rule = item.get('rule')
    if item.get('applicability_mode') == 'always':
        if rule is not True:
            invalid('rule', 'Always requires literal true')
    elif item.get('applicability_mode') == 'conditional':
        if not isinstance(rule, dict) or set(rule) != {'any'} or not isinstance(rule['any'], list):
            invalid('rule', 'Use OR groups of AND conditions')
        for group in rule['any']:
            if not isinstance(group, dict) or set(group) != {'all'} or not isinstance(group['all'], list) or any(not isinstance(r, dict) or 'tag' not in r for r in group['all']):
                invalid('rule', 'Use OR groups of AND conditions')
    else:
        invalid('applicability_mode', 'Choose always or conditional')
    validate_rule(rule, config)
    return item


def apply_operations(current, operations):
    controls = {c['control_code']: copy.deepcopy(c) for c in current['controls']}
    changes, seen = [], set()
    for operation in operations:
        if not isinstance(operation, dict) or not isinstance(operation.get('control'), dict):
            invalid('control', 'Expected a control object')
        item = copy.deepcopy(operation['control'])
        code = item.get('control_code')
        if not isinstance(code, str) or code in seen:
            invalid('control_code', 'Duplicate operation')
        seen.add(code)
        old = controls.get(code)
        op = operation.get('operation')
        if op == 'create':
            if old:
                invalid('control_code', 'Code already exists; use update')
            if item.get('control_id') or item.get('revision'):
                invalid('control_id', 'Server assigns identity for new controls')
            item['control_id'], item['revision'] = uid(), 1
        elif op in ('update', 'retire'):
            if not old or item.get('control_id') != old['control_id'] or item.get('revision') != old['revision']:
                raise DomainError('VERSION_CONFLICT', 409, {'control_code': code})
            if not str(item.get('change_reason', '')).strip():
                invalid('change_reason', 'Explain the modification')
            if op == 'update' and item.get('source') != old.get('source'):
                invalid('source', 'Original workbook provenance is immutable; edit source_ref for a new citation')
            if op == 'retire':
                item = {**old, 'retired': True, 'change_reason': item['change_reason']}
            item['revision'] = old['revision'] + 1
        else:
            invalid('operation', 'Expected create, update or retire')
        item = validate_control(item, current['config'])
        if old:
            comparable = {k: v for k, v in item.items() if k not in ('revision', 'change_reason')}
            if comparable == {k: v for k, v in old.items() if k not in ('revision', 'change_reason')}:
                item = old
                op = 'unchanged'
        controls[code] = item
        changes.append({'code': code, 'operation': op, 'before': old, 'after': item})
    return {'config': current['config'], 'controls': list(controls.values())}, changes


def save_operations(db, user, version, operations):
    current = state(db, user.org_id)
    if version != current['version']:
        raise DomainError('VERSION_CONFLICT', 409)
    data, changes = apply_operations(current, operations)
    mutate(db, user, version, data, 'control_library.edited')
    access.audit(db, user, 'control_library.changes', {'changes': changes})
    return changes


def publish(db, user, version, publication_mode="reviewed"):
    if publication_mode not in ("reviewed", "direct"):
        invalid("publication_mode", "Unknown publication mode")
    access.require_admin(db, user)
    current = state(db, user.org_id)
    if current['version'] != version:
        raise DomainError('VERSION_CONFLICT', 409)
    config = validate_config(current['config'])
    controls = [validate_control(c, config) for c in current['controls']]
    if not any(not c['retired'] for c in controls):
        invalid('controls', 'At least one active control is required')
    unreviewed = [c['control_id'] for c in controls if not c['retired'] and c['review_status'] != 'reviewed']
    if publication_mode == 'reviewed' and unreviewed:
        invalid('review_status', 'Review all active control mappings before publication')
    data = {'config': config, 'controls': controls}
    content_hash = digest(data)
    row = workspace(db, user.org_id)
    if row.published_id:
        previous = db.get(Catalog, row.published_id)
        if previous.content_hash == content_hash:
            return previous
    catalog = Catalog(org_id=user.org_id, code='CONTROL-LIBRARY', version=f'R{version}', content_hash=content_hash)
    db.add(catalog)
    db.flush()
    db.add(LibraryRelease(catalog_id=catalog.id, data={**data, 'publication_mode': publication_mode}))
    levels = {p['code']: p['level'] for p in config['profiles']}
    for item in controls:
        if item['retired']:
            continue
        # Fallback language is a view; authored translations remain unchanged in metadata.
        translations = copy.deepcopy(item['translations'])
        for lang in ('zh', 'en'):
            translations.setdefault(lang, copy.deepcopy(next(iter(translations.values()))))
        control = Control(org_id=user.org_id, catalog_id=catalog.id, code=item['control_code'],
                          domain=item['domain_code'], levels=sorted({levels[p] for p in item['assessment_profiles']}),
                          required=item['required'], translations=translations, tags=item['topic_tags'])
        db.add(control)
        db.flush()
        db.add(ControlMetadata(control_id=control.id, data=item))
    row.published_id = catalog.id
    row.version += 1
    access.audit(db, user, 'control_library.published', {'catalog_id': catalog.id, 'hash': content_hash,
                 'publication_mode': publication_mode, 'unreviewed_control_ids': unreviewed})
    db.flush()
    return catalog


def published(db, org_id, catalog_id=None):
    row = workspace(db, org_id)
    catalog_id = catalog_id or (row.published_id if row else None)
    catalog = db.get(Catalog, catalog_id) if catalog_id else None
    if not catalog or catalog.org_id != org_id:
        raise DomainError('CATALOG_NOT_AVAILABLE', 409)
    release = db.get(LibraryRelease, catalog_id)
    if not release:
        raise DomainError('METHODOLOGY_NOT_CONFIGURED', 409)
    return catalog, release


def match(item, facts, profile):
    if profile not in item['assessment_profiles']:
        result = False
        reason = 'profile_not_selected'
    else:
        result = evaluate_rule(item['rule'], facts)
        reason = 'rule_matched' if result is True else 'rule_not_matched' if result is False else 'facts_unknown'
    return {'status': 'applicable' if result is True else 'inapplicable' if result is False else 'unknown',
            'reason': reason, 'rule': item['rule'], 'answer_refs': sorted(refs(item['rule'])),
            'fact_values': {k: facts.get(k, 'unknown') for k in refs(item['rule'])},
            'source_ref': item.get('source_ref', ''), 'responsibility': item['responsibility_rule']}


def profile_choice(config, classification, selected=None, target=None):
    profiles = {p['code']: p for p in config['profiles']}
    selected = selected or next((c for c, level in PROFILES.items() if level == classification['effective_level']), None)
    if selected not in profiles or target not in (None, '', '2', '3'):
        invalid('assessment_profile', 'Unknown profile or source target')
    if target and selected != f'MLPS{target}_REFERENCE':
        invalid('assessment_profile', 'Use the explicitly selected MLPS target profile')
    if profiles[selected]['level'] < classification['effective_level']:
        classification['exceptions'].append({'code': 'CONTROL_PROFILE_DOWNGRADE', 'profile': selected,
                                             'effective_level': classification['effective_level']})
    return selected


def validate_references(data):
    config = validate_config(data['config'])
    for control in data['controls']:
        validate_control(control, config)
    return {'config': config, 'controls': data['controls']}
