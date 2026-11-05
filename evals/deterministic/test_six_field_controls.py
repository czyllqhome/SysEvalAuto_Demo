"""Offline six-field import and historical isolation regression."""
import csv
import io
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from app.db import AccountPolicy, LibraryWorkspace, SixFieldControl, SixFieldLibrary, SixFieldUpload, User
from app.domain import DomainError
from app.mlps_source import ensure_catalog
from app.six_field_controls import FIELDS, parse, reset
from conftest import register


def file_bytes(rows=None, fields=FIELDS):
    stream = io.StringIO()
    writer = csv.writer(stream)
    writer.writerow(fields)
    writer.writerows(rows or [['MLPS sample', '001', '域', '控制点', ' 原始要求\n第二行 ', 'high']])
    return stream.getvalue().encode('utf-8-sig')


def test_six_columns_are_named_and_authored_text_is_preserved():
    raw = file_bytes([['high', ' Source ', '001', '域', '点', ' 原文\n第二行 ']],
                     ('risk_level', 'source', 'control_identifier', 'security_domain', 'security_control_point', 'control_requirement'))
    row = parse('source.csv', raw)[0]
    assert row['control_requirement'] == ' 原文\n第二行 '
    assert row['risk_level'] == 'high' and row['row_number'] == 2
    with pytest.raises(DomainError):
        parse('old.csv', file_bytes(fields=(*FIELDS, 'assessment_procedure')))
    with pytest.raises(DomainError):
        parse('duplicate.csv', file_bytes([['A', '1', '域', '点', '原文', 'low']] * 2))


def test_upload_atomic_idempotent_scoped_and_reset_stays_empty(owner):
    app, client = owner
    user_id = client.get('/api/v1/auth/session').json()['user']['id']
    with app.state.sessions.begin() as db:
        user = db.get(User, user_id)
        reset(db, user)
        assert ensure_catalog(db, user.org_id) is None
        assert db.get(LibraryWorkspace, user.org_id).published_id is None
    assert client.get('/api/v1/source-controls').json()['controls'] == []
    raw = file_bytes()
    result = client.post('/api/v1/source-controls/uploads', files={'file': ('first.csv', raw, 'text/csv')})
    assert result.status_code == 200, result.text
    row = result.json()['controls'][0]
    assert set(FIELDS) <= set(row) and row['control_requirement'] == ' 原始要求\n第二行 '
    assert result.json()['matching_ready'] is False
    repeat = client.post('/api/v1/source-controls/uploads', files={'file': ('again.csv', raw, 'text/csv')})
    assert repeat.json()['already_imported'] is True and len(repeat.json()['controls']) == 1
    collision = client.post('/api/v1/source-controls/uploads', files={'file': ('collision.csv', file_bytes([['MLPS sample', '001', '域', '点', 'Different text', 'low']]), 'text/csv')})
    assert collision.status_code == 409
    bad = client.post('/api/v1/source-controls/uploads', files={'file': ('bad.csv', file_bytes([['A', '2', '域', '点', '有效', 'low'], ['A', '3', '域', '点', '', 'low']]), 'text/csv')})
    assert bad.status_code == 422
    assert len(client.get('/api/v1/source-controls').json()['controls']) == 1
    with TestClient(app) as other:
        register(other, 'six-other@example.test')
        assert other.get('/api/v1/source-controls').json()['controls'] == []
    with app.state.sessions.begin() as db:
        policy = db.get(AccountPolicy, user_id)
        if policy:
            policy.admin = False
        else:
            db.add(AccountPolicy(user_id=user_id, admin=False))
    assert client.post('/api/v1/source-controls/uploads', files={'file': ('denied.csv', raw, 'text/csv')}).status_code == 403
    with app.state.sessions() as db:
        assert len(list(db.scalars(select(SixFieldControl)))) == 1
        assert len(list(db.scalars(select(SixFieldUpload)))) == 1
        assert db.get(SixFieldLibrary, user.org_id)


def test_level_one_mapping_publication_and_idempotency(owner):
    from app.six_field_controls import import_file
    from app.db import Catalog, LibraryRelease
    from app.service import current_catalog
    app, client = owner
    user_id = client.get('/api/v1/auth/session').json()['user']['id']
    raw = file_bytes()
    with app.state.sessions.begin() as db:
        user = db.get(User, user_id)
        upload, repeated = import_file(db, user, 'MLPS_level_1_CN.csv', raw)
        assert not repeated
        catalog = current_catalog(db, user.org_id)
        release = db.get(LibraryRelease, catalog.id)
        control = release.data['controls'][0]
        assert control['source_level'] == 1 and control['assessment_profiles'] == ['MLPS1_REFERENCE']
        assert control['source']['languages']['zh']['fields']['risk_level'] == 'high'
        assert 'assessment_procedure' not in control['source']['languages']['zh']['fields']
        same, repeated = import_file(db, user, 'MLPS_level_1_CN.csv', raw)
        assert repeated and same.id == upload.id
        assert len(list(db.scalars(select(Catalog).where(Catalog.code == 'MLPS-SIX')))) == 1
        with pytest.raises(DomainError):
            import_file(db, user, 'MLPS_level_1_CN.csv', raw, level=3)


@pytest.mark.parametrize('level', [1, 2, 3])
@pytest.mark.parametrize(('deployment', 'expected'), [
    (['专有云'], 'cloud'), (['公有云'], 'cloud'), (['混合云'], 'cloud'), (['SaaS'], 'cloud'),
    (['本地数据中心', '公有云'], 'cloud'), (['本地数据中心'], 'physical'),
    (['托管机房'], 'physical'), (['门店或仓库本地部署'], 'physical'),
    ([], None), (['不确定'], None), (['其他'], None),
])
def test_deployment_selects_exclusive_domains(owner, level, deployment, expected):
    from app.six_field_controls import import_file
    from app.mlps_intake import preview
    app, client = owner
    uid = client.get('/api/v1/auth/session').json()['user']['id']
    with app.state.sessions.begin() as db:
        user = db.get(User, uid)
        raw = file_bytes([['S', '1', '安全物理环境', '物理', '要求', 'Low'],
                          ['S', '2', '云计算安全扩展要求', '云', '要求', 'High'],
                          ['S', '3', '安全计算环境', '通用', '要求', 'Low']])
        import_file(db, user, f'MLPS_level_{level}_CN.csv', raw)
        result = preview(db, user.org_id, {'answers': {'deployment_model': deployment}, 'frameworks': [f'MLPS_LEVEL_{level}']})
        decisions = {r['source_ref']: r for r in result['matches']}
        assert decisions['3']['status'] == 'applicable'
        for code, kind in [('1', 'physical'), ('2', 'cloud')]:
            assert decisions[code]['status'] == ('unknown' if expected is None else 'applicable' if kind == expected else 'inapplicable')
            assert decisions[code]['answer_refs'] == ['hosting.models']


def test_named_source_update_preserves_upload_and_release(owner):
    from app.six_field_controls import import_file
    from app.db import LibraryRelease
    app, client = owner
    uid = client.get('/api/v1/auth/session').json()['user']['id']
    with app.state.sessions.begin() as db:
        user = db.get(User, uid)
        old, _ = import_file(db, user, 'MLPS_level_1_CN.csv', file_bytes())
        catalog_id = db.get(LibraryWorkspace, user.org_id).published_id
        snapshot = db.get(LibraryRelease, catalog_id).data
        updated = file_bytes([['MLPS sample', '001', '域', '控制点', 'Updated', 'high'], ['MLPS sample', '002', '云计算安全扩展要求', '云', 'Cloud', 'low']])
        new, _ = import_file(db, user, 'MLPS_level_1_CN.csv', updated, replace=True)
        assert new.id != old.id and db.get(SixFieldUpload, old.id).content == file_bytes()
        assert db.get(LibraryRelease, catalog_id).data == snapshot
        assert len(list(db.scalars(select(SixFieldControl)))) == 2
        same, repeated = import_file(db, user, 'MLPS_level_1_CN.csv', updated, replace=True)
        assert repeated and same.id == new.id


def test_explicit_risk_correction_retains_original_source(owner):
    from app.six_field_controls import import_file
    from app.db import LibraryRelease
    app, client = owner
    uid = client.get('/api/v1/auth/session').json()['user']['id']
    raw = file_bytes([['MLPS', '6.2.5.2', '云计算安全扩展要求', '供应链管理', '要求', '']])
    with pytest.raises(DomainError):
        parse('MLPS_level_1_CN.csv', raw)
    with app.state.sessions.begin() as db:
        user = db.get(User, uid)
        upload, _ = import_file(db, user, 'MLPS_level_1_CN.csv', raw, risk_overrides={'6.2.5.2': 'Medium'})
        release = db.get(LibraryRelease, db.get(LibraryWorkspace, user.org_id).published_id)
        source = release.data['controls'][0]['source']['languages']['zh']
        assert upload.content == raw
        assert source['fields']['risk_level'] == 'Medium'
        assert source['original_fields']['risk_level'] == ''
        assert source['corrections']['risk_level'] == {'original': '', 'confirmed': 'Medium'}


@pytest.mark.parametrize('level', [1, 2, 3])
@pytest.mark.parametrize(('answer', 'status'), [('是', 'applicable'), ('否', 'inapplicable'), ('不确定', 'unknown')])
def test_supplemental_scope_answers_match_published_controls(owner, level, answer, status):
    from app.six_field_controls import import_file
    from app.mlps_intake import preview
    app, client = owner
    uid = client.get('/api/v1/auth/session').json()['user']['id']
    prefix = str(level + 5)
    refs = ['6.1.9.1-a)', '6.1.9.1-b)', '6.1.9.2'] if level == 1 else [f'{prefix}.1.10.1-a)', f'{prefix}.1.10.1-b)', f'{prefix}.1.10.3-a)', f'{prefix}.1.10.3-b)', f'{prefix}.1.8.4-a)', f'{prefix}.1.10.14-a)']
    with app.state.sessions.begin() as db:
        user = db.get(User, uid)
        import_file(db, user, f'MLPS_level_{level}_CN.csv', file_bytes([['S', ref, '管理', '控制', '要求', 'Low'] for ref in refs] + [['S', 'unrelated', '管理', '备份', '保留备份', 'Low']]))
        answers = {key: answer for key in ['outsourced_operations', 'physical_media', 'physical_media_transport', 'facility_management', 'physical_visitors']}
        result = preview(db, user.org_id, {'answers': answers, 'frameworks': [f'MLPS_LEVEL_{level}']})
        for decision in result['matches']:
            assert decision['status'] == ('applicable' if decision['source_ref'] == 'unrelated' else status)
            if decision['source_ref'] != 'unrelated':
                assert decision['answer_refs'] and decision['fact_values']


@pytest.mark.parametrize(('models', 'in_house', 'outsourced'), [
    (['自行开发'], True, False), (['外包开发'], False, True),
    (['自行开发', '外包开发'], True, True), (['采购成品或SaaS'], False, False),
    ([], None, None), (['不确定'], None, None),
])
def test_development_scope_supports_mixed_delivery_and_unknown(models, in_house, outsourced):
    from app.mlps_applicability import facts, rule
    from app.control_rules import evaluate_rule
    for level in (2, 3):
        assert evaluate_rule(rule(f'{level + 5}.1.9.4 -a) ', level), facts({'development_models': models})) is in_house
        assert evaluate_rule(rule(f'{level + 5}.1.9.5-b)', level), facts({'development_models': models})) is outsourced
    assert rule('7.1.10.11-b)', 2) is True  # Backup media requirements are not exempted.
    assert rule('7.2.5.1-a)', 2) is True  # Cloud supplier assurance remains applicable.
