"""Versioning, XLSX round trips and tag matching use isolated offline fixtures."""
import copy
import io
from pathlib import Path

import pytest
from openpyxl import Workbook, load_workbook

from app.control_library import apply_operations, match
from app.control_rules import classify_profile, default_config, evaluate_rule, normalize_facts, validate_config, validate_rule
from app.control_workbooks import annotated_mlps, export_book, preview
from app.domain import DomainError


def control(code='TEST-1', rule=True):
    return {'control_code': code, 'translations': {'zh': {'title': '控制', 'description': '控制原文', 'verification': '提供证据'}},
            'assessment_object': '业务系统', 'domain_code': 'BOUNDARY', 'assessment_profiles': ['MLPS2_REFERENCE'],
            'required': True, 'topic_tags': ['boundary'], 'applicability_mode': 'always' if rule is True else 'conditional',
            'rule': rule, 'responsibility_rule': 'shared', 'source_framework': 'CUSTOM', 'source_ref': 'Policy 1',
            'review_status': 'reviewed'}


def eq(tag, value='yes'):
    return {'tag': tag, 'op': 'eq', 'value': value}


def rule(*tags):
    return {'any': [{'all': [eq(tag)]} for tag in tags]}


def empty():
    return {'version': 0, 'config': default_config(), 'controls': []}






def low_facts():
    return {'risk.data_impact': 'low', 'risk.privilege_impact': 'bounded', 'risk.business_impact': 'limited',
            'risk.outage_minutes': 1440, 'biz.manual_fallback': 'yes', 'risk.dependency_scope': 'team',
            'net.public_business': 'no', 'net.partner_link': 'no', 'data.personal': 'no'}


def add(client, item):
    from app import control_library as library
    from app.db import User
    uid = client.get('/api/v1/auth/session').json()['user']['id']
    with client.app.state.sessions.begin() as db:
        user = db.get(User, uid)
        state = library.state(db, user.org_id)
        library.save_operations(db, user, state['version'], [{'operation': 'create', 'control': item}])
        return library.state(db, user.org_id)


def publish(client):
    from app import control_library as library
    from app.db import User
    uid = client.get('/api/v1/auth/session').json()['user']['id']
    with client.app.state.sessions.begin() as db:
        user = db.get(User, uid)
        state = library.state(db, user.org_id)
        catalog = library.publish(db, user, state['version'])
        return {'catalog_id': catalog.id, 'state': library.state(db, user.org_id)}


@pytest.mark.parametrize('values,expected_all,expected_any', [
    (['yes', 'unknown'], None, True), (['no', 'unknown'], False, None),
    (['yes', 'no'], False, True), (['yes', 'yes'], True, True), (['no', 'no'], False, False),
])
def test_three_valued_rules(values, expected_all, expected_any):
    atoms = [eq('net.public_ingress'), eq('net.cross_zone')]
    facts = dict(zip(['net.public_ingress', 'net.cross_zone'], values))
    assert evaluate_rule({'all': atoms}, facts) is expected_all
    assert evaluate_rule({'any': atoms}, facts) is expected_any


def test_internal_boundary_remote_and_unknown_are_not_silently_dropped():
    boundary = control(rule=rule('net.public_ingress', 'net.cross_zone'))
    assert match(boundary, {'net.public_ingress': 'no', 'net.cross_zone': 'yes'}, 'MLPS2_REFERENCE')['status'] == 'applicable'
    remote = control(rule=rule('ops.remote_admin'))
    assert match(remote, {'net.public_ingress': 'no', 'ops.remote_admin': 'yes'}, 'MLPS2_REFERENCE')['status'] == 'applicable'
    assert match(remote, {}, 'MLPS2_REFERENCE')['status'] == 'unknown'


@pytest.mark.parametrize('minutes,level', [(0, 'L3'), (239, 'L3'), (240, 'L2'), (1439, 'L2'), (1440, 'L1')])
def test_classification_boundaries(minutes, level):
    config = default_config()
    facts = normalize_facts({**low_facts(), 'risk.outage_minutes': minutes}, config)
    assert classify_profile(facts, config)['effective_level'] == level
    # Unrelated applicability unknowns do not force a higher grade.
    assert facts['app.mail_processing'] == 'unknown'


def test_risk_unknown_manual_downgrade_and_invalid_inputs():
    config = default_config()
    assert classify_profile(normalize_facts({}, config), config)['effective_level'] == 'L2'
    facts = normalize_facts({**low_facts(), 'risk.privilege_impact': 'severe'}, config)
    result = classify_profile(facts, config, 'manual', 'L1', 'Owner exception')
    assert result['recommended_level'] == 'L3'
    assert any(e['code'] == 'MANUAL_DOWNGRADE' for e in result['exceptions'])
    for raw in ({'risk.outage_minutes': True}, {'net.public_ingress': 'no', 'net.public_admin': 'yes'}, {'unknown.tag': 'yes'}):
        with pytest.raises(DomainError):
            normalize_facts(raw, config)
    with pytest.raises(DomainError):
        validate_rule(eq('ops.remote_admin', 'unknown'), config)


def test_dictionary_extensions_visibility_and_cycles():
    config = default_config()
    extra = {'code': 'app.custom', 'zh': '扩展问题', 'en': 'Extra question', 'kind': 'enum', 'group': 'operations',
             'values': ['yes', 'no', 'unknown'], 'risk': False, 'when': rule('data.personal')}
    config['questions'].append(extra)
    assert validate_config(config)
    facts = normalize_facts({'data.personal': 'no', 'app.custom': 'yes'}, config)
    assert facts['app.custom'] == 'unknown'
    extra['when'] = rule('app.custom')
    with pytest.raises(DomainError):
        validate_config(config)


def test_standard_workbook_roundtrip_preserves_languages_source_and_conditions():
    item = control(rule=rule('ops.remote_admin', 'net.cross_zone'))
    item['translations']['en'] = {'title': 'Control', 'description': 'Original English', 'verification': 'Evidence'}
    state, _ = apply_operations(empty(), [{'operation': 'create', 'control': item}])
    state['version'] = 3
    exported = export_book(state, True)
    result = preview(exported, state)
    assert not result['errors']
    assert result['changes'][0]['operation'] == 'unchanged'
    assert result['data']['controls'] == state['controls']
    book = load_workbook(io.BytesIO(exported))
    sheet = book['Controls']
    headers = {c.value: c.column for c in sheet[1]}
    sheet.cell(2, headers['source_ref'], '')
    sheet.cell(2, headers['description_zh'], 'Changed Chinese only')
    output = io.BytesIO()
    book.save(output)
    result = preview(output.getvalue(), state)
    changed = result['data']['controls'][0]
    assert changed['source_ref'] == 'Policy 1'
    assert changed['translations']['en'] == item['translations']['en']
    sheet.cell(2, headers['clear_fields'], 'source_ref')
    output = io.BytesIO()
    book.save(output)
    assert preview(output.getvalue(), state)['data']['controls'][0]['source_ref'] == ''


def test_workbook_rejects_formula_invalid_row_and_revision():
    state, _ = apply_operations(empty(), [{'operation': 'create', 'control': control()}])
    state['version'] = 1
    book = load_workbook(io.BytesIO(export_book(state, True)))
    book['Controls']['E2'] = '=1+1'
    output = io.BytesIO()
    book.save(output)
    with pytest.raises(DomainError):
        preview(output.getvalue(), state)
    book['Controls']['E2'] = 'Control'
    book['Controls']['D2'] = 999
    output = io.BytesIO()
    book.save(output)
    result = preview(output.getvalue(), state)
    assert result['data'] is None and result['errors'][0]['row'] == 2








def test_confirmed_profile_matches_and_revisions_require_new_review(owner, monkeypatch):
    from app import methodology
    monkeypatch.setattr(methodology, 'LEGACY_FIXTURES_ENABLED', False)
    _, client = owner
    add(client, control('BOUNDARY-1', rule('net.public_ingress', 'net.cross_zone')))
    add(client, control('REMOTE-1', rule('ops.remote_admin')))
    add(client, control('PERSONAL-1', rule('data.personal')))
    release = publish(client)
    detail = client.post('/api/v1/systems', json={'name': 'Tag integration'}).json()
    sid = detail['system']['id']
    base = f'/api/v1/systems/{sid}'
    facts = {**low_facts(), 'risk.outage_minutes': 500, 'net.public_ingress': 'no', 'net.cross_zone': 'yes', 'ops.remote_admin': 'yes'}
    body = {'scheme': 'MLPS-TAGS/1', 'mode': 'questionnaire', 'catalog_id': release['catalog_id'], 'facts': facts}
    result = client.post(base + '/classification-confirmations', json={**body, 'version': detail['system']['version']})
    assert result.status_code == 200, result.text
    detail = result.json()
    context = {'summary': 'Scope', 'functions': [{'id': 'F1', 'title': 'Function', 'source_blocks': []}],
               'departments': ['Business'], 'roles': ['Owner'], 'owner_role': 'Owner', 'scope': 'Internal service'}
    result = client.post(base + '/context-confirmations', json={'version': detail['system']['version'], 'context': context})
    assert result.status_code == 200, result.text
    detail = result.json()
    controls = {c['code']: c for c in detail['controls']}
    assert controls['BOUNDARY-1']['included'] and controls['REMOTE-1']['included']
    assert not controls['PERSONAL-1']['included']
    result = client.post(base + '/controls', json={'version': detail['system']['version'], 'control_id': controls['BOUNDARY-1']['id'], 'included': False, 'reason': 'Manual exception'})
    assert result.status_code == 200, result.text
    detail = result.json()
    body['facts']['ops.remote_admin'] = 'unknown'
    result = client.post(base + '/classification-confirmations', json={**body, 'version': detail['system']['version']})
    assert result.status_code == 200, result.text
    detail = result.json()
    result = client.post(base + '/context-confirmations', json={'version': detail['system']['version'], 'context': context})
    assert result.status_code == 200, result.text
    detail = result.json()
    controls = {c['code']: c for c in detail['controls']}
    assert controls['BOUNDARY-1']['origin'] == 'candidate'
    assert controls['BOUNDARY-1']['previous_decision']['reason'] == 'Manual exception'
    assert controls['REMOTE-1']['origin'] == 'candidate'
    result = client.post(base + '/jobs', json={'version': detail['system']['version'], 'kind': 'prd_generation', 'mode': 'local', 'language': 'zh'})
    assert result.status_code == 409


def test_missing_basic_profile_blocks_empty_l1_assessment(owner):
    _, client = owner
    add(client, control())
    release = publish(client)
    detail = client.post('/api/v1/systems', json={'name': 'Basic profile'}).json()
    result = client.post(f"/api/v1/systems/{detail['system']['id']}/classification-confirmations", json={
        'version': detail['system']['version'], 'scheme': 'MLPS-TAGS/1', 'facts': low_facts(), 'catalog_id': release['catalog_id']})
    assert result.status_code == 409 and result.json()['code'] == 'PROFILE_NOT_CONFIGURED'


def test_rule_references_prevent_removing_used_custom_dictionary_entries():
    config = default_config()
    config['topics'].append({'code': 'custom', 'zh': '自定义', 'en': 'Custom'})
    state = {'config': config, 'controls': []}
    item = control()
    item['topic_tags'] = ['custom']
    state, _ = apply_operations(state, [{'operation': 'create', 'control': item}])
    changed = copy.deepcopy(state)
    changed['config']['topics'] = [d for d in config['topics'] if d['code'] != 'custom']
    from app.control_library import validate_references
    with pytest.raises(DomainError):
        validate_references(changed)


def mlps_fixture():
    book = Workbook()
    book.remove(book.active)
    for name, level, prefix in [('MLPS Level 2', 2, '7'), ('MLPS Level 3', 3, '8')]:
        sheet = book.create_sheet(name)
        sheet.append(['Security Domain', 'Security Control Point', 'Number', 'Serial Number', 'Evaluation Item',
                      'Assessment Object', 'Assessment Implementation', 'Risk Level', 'Note',
                      'System Level' if level == 2 else 'High Risk?'])
        sheet.append(['安全计算环境', '身份鉴别', f'{prefix}.1.4.1', 'c)', '远程管理保护 / Remote protection',
                      'System', 'Inspect configuration', '', '', 2 if level == 2 else 0])
        sheet.append(['安全管理制度', '安全策略', f'{prefix}.1.6.1', 'a)', 'Policy', 'Organization', 'Inspect policy', '', '', None if level == 2 else 1])
    output = io.BytesIO()
    book.save(output)
    return output.getvalue()


def test_mlps_different_headers_and_annotated_roundtrip_preserve_source():
    raw = mlps_fixture()
    result = preview(raw, empty())
    assert len(result['changes']) == 4
    items = result['data']['controls']
    assert [c['source_level'] for c in items] == [2, 2, 3, 3]
    assert all(c['review_status'] == 'draft' for c in items)
    assert items[2]['source']['cells']['J2'] == 0
    annotated = annotated_mlps(raw, result['changes'], empty()['config'])
    before, after = load_workbook(io.BytesIO(raw)), load_workbook(io.BytesIO(annotated))
    for sheet in before:
        for row in sheet:
            for cell in row:
                assert after[sheet.title][cell.coordinate].value == cell.value
    assert after['MLPS Level 2']['K1'].value == 'control_id'
    assert after['MLPS Level 3']['X2'].value == 'draft'
    again = preview(annotated, empty())
    assert again['data']['controls'][0]['rule'] == items[0]['rule']




def test_unified_mlps_headers_reordered_and_duplicate_alias_rejected():
    book = Workbook()
    sheet = book.active
    sheet.title = 'MLPS Level 3'
    sheet.append(['source_level', 'is_high_risk', 'risk_level', 'assessment_method', 'assessment_procedure',
                  'assessment_object', 'control_requirement', 'subitem_number', 'clause_number',
                  'security_control_point', 'security_domain'])
    sheet.append([3, 'yes', 'high', '访谈', '检查配置', '系统', '远程管理保护', 'c)', '8.1.4.1', '身份鉴别', '安全计算环境'])
    def serialize():
        output = io.BytesIO()
        book.save(output)
        return output.getvalue()
    raw = serialize()
    result = preview(raw, empty())
    item = result['data']['controls'][0]
    assert item['translations']['zh']['description'] == '远程管理保护'
    assert item['translations']['zh']['verification'] == '检查配置'
    assert item['source']['fields']['测评方法'] == '访谈'
    assert item['source']['fields']['High Risk?'] == 'yes'
    assert item['source_ref'].startswith('MLPS Level 3!G2,F2,E2;')
    tagged = annotated_mlps(raw, result['changes'], empty()['config'])
    after = load_workbook(io.BytesIO(tagged)).active
    assert [c.value for c in after[2][:11]] == [c.value for c in sheet[2]]
    assert len(preview(tagged, empty())['changes']) == 1
    sheet['A2'] = 2
    with pytest.raises(DomainError):
        preview(serialize(), empty())
    sheet['A2'] = 3
    sheet['L1'] = 'Security Domain'
    with pytest.raises(DomainError):
        preview(serialize(), empty())


def test_mlps_rejects_unknown_sheet_and_mismatched_level():
    book = load_workbook(io.BytesIO(mlps_fixture()))
    del book['MLPS Level 2']
    book.active.title = 'Sheet1'
    raw = io.BytesIO()
    book.save(raw)
    with pytest.raises(DomainError):
        preview(raw.getvalue(), empty())
    book.active.title = 'MLPS Level 2'
    raw = io.BytesIO()
    book.save(raw)
    with pytest.raises(DomainError):
        preview(raw.getvalue(), empty())






def test_additive_migration_preserves_existing_records(tmp_path, monkeypatch):
    from alembic import command
    from alembic.config import Config
    from sqlalchemy import inspect
    from app.db import Base, Organization, make_engine, make_sessions
    url = f"sqlite:///{tmp_path / 'migration.db'}"
    engine = make_engine(url)
    additions = {'control_library_workspaces', 'control_library_releases', 'control_metadata', 'control_library_batches'}
    Base.metadata.create_all(engine, tables=[t for t in Base.metadata.sorted_tables if t.name not in additions])
    sessions = make_sessions(engine)
    with sessions() as db:
        db.add(Organization(id='preserved-org', name='Preserve this organization'))
        db.commit()
    monkeypatch.setenv('SYSEVAL_DATABASE_URL', url)
    config = Config(str(Path(__file__).resolve().parents[2] / 'backend' / 'alembic.ini'))
    command.stamp(config, 'integrated_intake')
    command.upgrade(config, 'head')
    assert additions <= set(inspect(engine).get_table_names())
    with sessions() as db:
        assert db.get(Organization, 'preserved-org').name == 'Preserve this organization'
    engine.dispose()







