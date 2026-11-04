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
