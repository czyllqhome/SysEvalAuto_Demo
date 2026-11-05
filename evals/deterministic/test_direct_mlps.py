"""Current source-managed Demo contract; no network or runtime database access."""
import asyncio
import copy
import pytest
from sqlalchemy import select, func
from app import methodology, screening
from app.db import Assignment, Catalog, OrganizationRole, Prd, User
from app.mlps_source import dataset, ensure_catalog
from app.worker import run_once
from conftest import register
from test_workflow import BRIEF, command, current
from test_screening import low


@pytest.fixture
def source_owner(application, monkeypatch):
    monkeypatch.setattr(methodology, 'LEGACY_FIXTURES_ENABLED', False)
    app, client = application
    register(client)
    return app, client


def test_sources_are_chinese_only():
    controls = dataset()['controls']
    assert len(controls) == 346
    assert len([c for c in controls if c['source_level'] == 2]) == 135
    assert all(set(c['translations']) == {'zh'} for c in controls)
    assert all(set(c['source']['languages']) == {'zh'} for c in controls)
    for c in controls:
        for lang, source in c['source']['languages'].items():
            assert c['translations'][lang]['description'] == source['fields']['control_requirement']
            assert c['translations'][lang]['verification'] == source['fields']['assessment_procedure']
            assert source['row'] >= 2 and len(source['sha256']) == 64


def test_catalog_is_immutable_idempotent_and_scoped(source_owner):
    app, client = source_owner
    state = client.get('/api/v1/library').json()
    assert state['can_edit'] is False and len(state['controls']) == 346
    for path in ('/library/controls', '/library/publish', '/catalog-imports', '/admin/projects'):
        assert client.post('/api/v1' + path, json={}).status_code == 410
    with app.state.sessions.begin() as db:
        user = db.scalar(select(User))
        ensure_catalog(db, user.org_id)
        assert db.scalar(select(func.count()).select_from(Catalog)) == 1


def test_control_list_accepts_chinese_only_domain_labels(source_owner):
    _, client = source_owner
    sid = client.post('/api/v1/systems', json={'name': 'Chinese source domains'}).json()['system']['id']
    command(client, sid, 'classification-confirmations', {'scheme': screening.SCHEME, 'facts': low(), 'frameworks': ['MLPS_LEVEL_2']})
    command(client, sid, 'context-confirmations', {'context': copy.deepcopy(BRIEF)})
    response = client.get('/api/v1/controls', params={'system_id': sid})
    assert response.status_code == 200, response.text
    data = response.json()
    assert data['total'] == 346
    assert len(data['items']) == 100
    assert data['domain_labels']
    assert all(zh and en == zh for zh, en in data['domain_labels'].values())
    selected = [c for c in current(client, sid)['controls'] if c['included']]
    assert len(selected) == 135
    pages = data['items'] + client.get('/api/v1/controls', params={'system_id': sid, 'page': 2}).json()['items']
    pages += client.get('/api/v1/controls', params={'system_id': sid, 'page': 3}).json()['items']
    pages += client.get('/api/v1/controls', params={'system_id': sid, 'page': 4}).json()['items']
    assert {c['id'] for c in selected} <= {c['id'] for c in pages}
    domain = data['items'][0]['domain']
    filtered = client.get('/api/v1/controls', params={'system_id': sid, 'domain': domain}).json()
    assert filtered['items'] and all(c['domain'] == domain for c in filtered['items'])


def test_archive_never_becomes_the_active_catalog(source_owner):
    from app.db import LibraryWorkspace, LibraryRelease
    from app.service import current_catalog
    app, client = source_owner
    uid = client.get('/api/v1/auth/session').json()['user']['id']
    with app.state.sessions.begin() as db:
        user = db.get(User, uid)
        original = current_catalog(db, user.org_id)
        workspace = db.get(LibraryWorkspace, user.org_id)
        workspace.data = {'config': {}, 'controls': [], 'authored_note': 'Retain this draft'}
        workspace.published_id = None
        ensure_catalog(db, user.org_id)
        assert current_catalog(db, user.org_id).id == original.id
        archive = db.scalar(select(Catalog).where(Catalog.code == 'ARCHIVED-DRAFT'))
        assert db.get(LibraryRelease, archive.id).data['authored_note'] == 'Retain this draft'


def test_unchanged_source_uses_stored_release_without_parsing(owner, monkeypatch):
    import hashlib
    from app import mlps_source
    from app.db import LibraryRelease, LibraryWorkspace
    app, client = owner
    uid = client.get('/api/v1/auth/session').json()['user']['id']
    sources = {p.name: {'filename': p.name, 'sha256': hashlib.sha256(p.read_bytes()).hexdigest()}
               for p in mlps_source.ROOT.glob('MLPS_level_*_CN.xlsx')}
    with app.state.sessions.begin() as db:
        user = db.get(User, uid)
        catalog = Catalog(org_id=user.org_id, code='MLPS-CN', version='cache-test', content_hash='test')
        db.add(catalog)
        db.flush()
        db.add(LibraryRelease(catalog_id=catalog.id, data={'controls': [{'source': {'languages': sources}}]}))
        db.add(LibraryWorkspace(org_id=user.org_id, published_id=catalog.id, data={}))
        db.flush()
        def forbidden_parse():
            raise AssertionError('Unchanged files must not be reparsed on restart')
        monkeypatch.setattr(mlps_source, 'dataset', forbidden_parse)
        assert ensure_catalog(db, user.org_id).id == catalog.id


def test_manager_creates_both_types_without_project_and_viewer_cannot(source_owner):
    app, client = source_owner
    uid = client.get('/api/v1/auth/session').json()['user']['id']
    with app.state.sessions.begin() as db:
        from app.db import AccountPolicy
        db.add(AccountPolicy(user_id=uid, admin=False))
        db.add(OrganizationRole(user_id=uid, role='manager'))
    for kind in ('new', 'existing'):
        body = {'name': kind, 'assessment_type': kind}
        if kind == 'existing':
            body.update(scope='Production', environment='production', system_version='v1', as_of='2026-11-03', trigger='initial')
        response = client.post('/api/v1/systems', json=body)
        assert response.status_code == 200, response.text
        assert 'manage' in response.json()['permissions']
    with app.state.sessions.begin() as db:
        assert db.scalar(select(func.count()).select_from(Assignment)) == 0
        db.get(OrganizationRole, uid).role = 'viewer'
    assert client.post('/api/v1/systems', json={'name': 'Forbidden'}).status_code == 403


@pytest.mark.parametrize('level,count', [(2, 135), (3, 211)])
def test_explicit_framework_ignores_internal_level(source_owner, level, count):
    _, client = source_owner
    sid = client.post('/api/v1/systems', json={'name': 'Independent'}).json()['system']['id']
    body = {'scheme': screening.SCHEME, 'facts': low(), 'frameworks': [f'MLPS_LEVEL_{level}']}
    result = client.post(f'/api/v1/systems/{sid}/screening/preview', json=body)
    assert result.status_code == 200, result.text
    assert result.json()['controls_ready']
    assert len([m for m in result.json()['matches'] if m['status'] == 'applicable']) == count
    body['frameworks'] = ['NIST']
    assert client.post(f'/api/v1/systems/{sid}/screening/preview', json=body).status_code == 422


def test_new_prd_template_preserves_source_coverage_and_snapshot(source_owner):
    app, client = source_owner
    sid = client.post('/api/v1/systems', json={'name': 'Direct MLPS'}).json()['system']['id']
    command(client, sid, 'classification-confirmations', {'scheme': screening.SCHEME, 'facts': low(), 'frameworks': ['MLPS_LEVEL_2']})
    brief = copy.deepcopy(BRIEF)
    command(client, sid, 'context-confirmations', {'context': brief})
    assert len([c for c in current(client, sid)['controls'] if c['included']]) == 135
    command(client, sid, 'jobs', {'kind': 'prd_generation', 'mode': 'local', 'language': 'en'})
    assert asyncio.run(run_once(app.state.sessions))
    detail = current(client, sid)
    assert detail['system']['status'] == 'PRD_REVIEW', detail.get('jobs')
    with app.state.sessions() as db:
        prd = db.get(Prd, detail['prd']['id'])
        assert '<!-- syseval:prd-layout-v4 -->' in prd.markdown
        assert len(prd.data['requirements']) == 136
        assert 'Local rule-based draft' in prd.markdown
        assert any('MLPS_level_2_CN.xlsx' in str(c.get('metadata', {})) for c in detail['controls'] if c['included'])
        assert 'syseval:prd-appendix' not in prd.markdown
        assert 'Control source missing in this language' not in prd.markdown


def test_linked_followup_creation_is_retired(source_owner):
    _, client = source_owner
    body = {'name': 'Existing', 'assessment_type': 'existing', 'scope': 'prod', 'environment': 'prod',
            'system_version': '1', 'as_of': '2026-11-03', 'trigger': 'initial'}
    first = client.post('/api/v1/systems', json=body).json()['system']['id']
    result = client.post('/api/v1/systems', json={**body, 'predecessor_id': first})
    assert result.status_code == 422, result.text
    assert client.get(f'/api/v1/systems/{first}').json()['system']['predecessor_id'] is None

