"""PRD intake regressions use isolated databases and deterministic model evidence."""
import asyncio
import copy

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app import worker
from app.ai import output_schema, redact_source
from app.db import AccountPolicy, Job, PrdImport, System
from app.prd_imports import TOPICS, validate_result
from app.domain import DomainError
from conftest import register

TEXT = '# PRD\n采购部门使用采购系统。\n本期支持申请和审批，不包含付款。\n'


def extracted(all_fields=False):
    missing = {'text': '', 'status': 'missing', 'evidence': []}
    found = {'text': '采购部门使用采购系统。', 'status': 'found',
             'evidence': [{'source_id': 'L2', 'quote': '采购部门使用采购系统。'}]}
    return {'fields': {key: copy.deepcopy(found if all_fields or key == 'goal' else missing) for key in TOPICS},
            'name': copy.deepcopy(missing), 'questions': []}


def setup(client):
    value = client.post('/api/v1/systems', json={'name': 'Import'}).json()
    return '/api/v1/systems/' + value['system']['id']


def mutate(client, path, suffix, **values):
    version = client.get(path).json()['system']['version']
    return client.post(path + suffix, json={'version': version, **values})


def upload(client, path, text=TEXT):
    response = mutate(client, path, '/prd-imports', filename='test.md', markdown=text)
    assert response.status_code == 200, response.text
    return response.json()['import_id']


def start(client, path, monkeypatch):
    monkeypatch.setenv('OPENROUTER_API_KEY', 'test-only')
    monkeypatch.setenv('OPENROUTER_MODEL', 'offline')
    response = mutate(client, path, '/jobs', kind='prd_import_extraction', mode='openrouter')
    assert response.status_code == 200, response.text
    return response.json()['job_id']


def finish(app, monkeypatch, output=None):
    async def generate(kind, source, language, mode):
        assert kind == 'prd_import_extraction'
        assert source['sources'][1]['id'] == 'L2'
        return output or extracted(), {'tokens': 12}
    monkeypatch.setattr(worker, 'generate', generate)
    asyncio.run(worker.run_once(app.state.sessions))


def save_blocks(client, path, blocks):
    return client.put(path + '/context-draft', json={
        'version': client.get(path).json()['system']['version'], 'blocks': blocks})


def test_import_all_topics_autofill_and_undo(owner, monkeypatch):
    app, client = owner
    path = setup(client)
    iid = upload(client, path)
    jid = start(client, path, monkeypatch)
    finish(app, monkeypatch, extracted(True))
    assert client.get('/api/v1/jobs/' + jid).json()['state'] == 'succeeded'
    draft = client.get(path).json()['system']['draft']
    assert set(draft['blocks']) == set(TOPICS)
    assert all(draft['blocks'].values())
    assert draft['block_sources']['goal']['import_id'] == iid
    imported = client.get(path + '/prd-imports/' + iid).json()
    assert imported['result']['fields']['data']['evidence'][0]['source_id'] == 'L2'
    blocks = {**draft['blocks'], 'goal': 'My later edit'}
    assert save_blocks(client, path, blocks).status_code == 200
    response = mutate(client, path, '/prd-imports/' + iid + '/undo', application_id=imported['applications'][0]['id'])
    assert response.status_code == 200, response.text
    assert response.json()['system']['draft']['blocks']['goal'] == 'My later edit'
    assert response.json()['system']['draft']['blocks']['data'] == ''
    assert response.json()['undo_skipped'] == ['goal']


@pytest.mark.parametrize('edit', ['none', 'existing', 'during', 'cleared'])
def test_missing_stays_empty_and_human_edits_survive(owner, monkeypatch, edit):
    app, client = owner
    path = setup(client)
    if edit == 'existing':
        save_blocks(client, path, {'goal': 'Human'})
    iid = upload(client, path)
    start(client, path, monkeypatch)
    if edit in ('during', 'cleared'):
        save_blocks(client, path, {'goal': 'Human'})
    if edit == 'cleared':
        save_blocks(client, path, {'goal': ''})
    finish(app, monkeypatch)
    blocks = client.get(path).json()['system']['draft'].get('blocks', {})
    expected = {'none': '采购部门使用采购系统。', 'existing': 'Human', 'during': 'Human', 'cleared': ''}
    assert blocks.get('goal', '') == expected[edit]
    assert not blocks.get('data')
    assert client.get(path + '/prd-imports/' + iid).json()['result']['fields']['data']['status'] == 'missing'


def test_new_version_diff_and_explicit_apply_with_version_guard(owner, monkeypatch):
    app, client = owner
    path = setup(client)
    first = upload(client, path)
    start(client, path, monkeypatch)
    finish(app, monkeypatch)
    second = upload(client, path, TEXT + '增加查询。\n')
    jid = start(client, path, monkeypatch)
    result = extracted()
    result['fields']['goal']['text'] = '采购部门使用采购系统，并增加查询。'
    result['fields']['goal']['evidence'].append({'source_id': 'L4', 'quote': '增加查询。'})
    finish(app, monkeypatch, result)
    before = client.get(path).json()
    assert before['system']['draft']['blocks']['goal'] == '采购部门使用采购系统。'
    response = mutate(client, path, '/prd-imports/' + second + '/apply', job_id=jid,
                      values={'goal': result['fields']['goal']['text']})
    assert response.status_code == 200, response.text
    assert response.json()['system']['draft']['blocks']['goal'] == result['fields']['goal']['text']
    stale = client.post(path + '/prd-imports/' + second + '/apply', json={
        'version': before['system']['version'], 'job_id': jid, 'values': {'goal': 'bad'}})
    assert stale.status_code == 409
    assert len(client.get(path + '/prd-imports').json()) == 2
    assert upload(client, path) == first
    with app.state.sessions() as db:
        assert db.scalar(select(PrdImport).where(PrdImport.id == second)).previous_id == first


def test_invalid_output_does_not_publish_and_records_usage(owner, monkeypatch):
    app, client = owner
    path = setup(client)
    iid = upload(client, path)
    jid = start(client, path, monkeypatch)
    output = extracted()
    output['fields']['goal']['evidence'][0]['source_id'] = 'invented'
    finish(app, monkeypatch, output)
    assert not client.get(path).json()['system']['draft'].get('blocks')
    assert client.get(path + '/prd-imports/' + iid).json()['result'] is None
    job = client.get('/api/v1/jobs/' + jid).json()
    assert job['error'] == 'INVALID_SOURCE_REFERENCE'
    assert job['usage']['tokens'] == 12


@pytest.mark.parametrize('filename,text', [('a.pdf', TEXT), ('a.md', ''), ('a.md', '\x00abc'),
                                         ('a.md', 'x' * 60001), ('../a.md', TEXT)], ids=['extension', 'empty', 'binary', 'large', 'path'])
def test_file_validation(owner, filename, text):
    _, client = owner
    path = setup(client)
    response = mutate(client, path, '/prd-imports', filename=filename, markdown=text)
    assert response.status_code == 422
    assert client.get(path + '/prd-imports').json() == []


def test_schema_requires_every_topic_and_conflicts_have_no_autofill():
    schema = output_schema('prd_import_extraction')
    assert set(schema['$defs']['ExtractedTopics']['required']) == set(TOPICS)
    result = extracted()
    result['fields']['goal'] = {'status': 'conflict', 'text': '', 'evidence': [
        {'source_id': 'L2', 'quote': '是'}, {'source_id': 'L3', 'quote': '否'}]}
    source = {'sources': [{'id': 'L2', 'text': '是'}, {'id': 'L3', 'text': '否'}]}
    assert validate_result(result, source)['fields']['goal']['text'] == ''
    result['fields']['goal']['text'] = '选择是'
    with pytest.raises(DomainError):
        validate_result(result, source)


def test_downstream_requires_explicit_revision_and_preserves_history(owner, monkeypatch):
    app, client = owner
    path = setup(client)
    with app.state.sessions.begin() as db:
        system = db.get(System, path.split('/')[-1])
        system.status = 'FINAL_CONFIRMATION'
        system.context_revision_id = 'old-context'
        system.prd_id = 'old-prd'
        system.baseline_id = 'old-baseline'
        system.classification = {'effective_level': 'L2'}
    iid = upload(client, path)
    jid = start(client, path, monkeypatch)
    finish(app, monkeypatch)
    assert not client.get(path).json()['system']['draft'].get('blocks')
    payload = {'job_id': jid, 'values': {'goal': 'Changed'}}
    assert mutate(client, path, f'/prd-imports/{iid}/apply', **payload).status_code == 409
    response = mutate(client, path, f'/prd-imports/{iid}/apply', **payload, acknowledge_revision=True)
    assert response.status_code == 200, response.text
    assert response.json()['system']['status'] == 'CLASSIFYING'
    assert response.json()['system']['revision'] == 2
    assert response.json()['system']['classification'] == {}
    with app.state.sessions() as db:
        system = db.get(System, path.split('/')[-1])
        assert system.prd_id is None and system.baseline_id is None and system.context_revision_id is None


def test_isolation_idempotency_and_revoked_worker_permission(owner, monkeypatch):
    app, client = owner
    path = setup(client)
    iid = upload(client, path)
    with TestClient(app) as other:
        register(other, 'other-import@example.test')
        assert other.get(path + '/prd-imports/' + iid).status_code == 404
        assert other.post(path + '/prd-imports', json={'filename': 'x.md', 'markdown': TEXT}).status_code == 404
    jid = start(client, path, monkeypatch)
    with app.state.sessions.begin() as db:
        job = db.get(Job, jid)
        db.add(AccountPolicy(user_id=job.usage['import_actor'], active=False))
    finish(app, monkeypatch)
    with app.state.sessions() as db:
        assert db.get(Job, jid).state == 'failed'
        assert not db.get(System, path.split('/')[-1]).draft.get('blocks')


def test_redacted_evidence_validation():
    result = extracted()
    source = redact_source({'sources': [{'id': 'L2', 'text': 'Contact owner@example.test'}]})
    result['fields']['goal'] = {'text': source['sources'][0]['text'], 'status': 'found',
                               'evidence': [{'source_id': 'L2', 'quote': source['sources'][0]['text']}]}
    assert validate_result(result, source)


def test_duplicate_reuses_result_and_explicit_reparse_creates_new_job(owner, monkeypatch):
    app, client = owner
    path = setup(client)
    iid = upload(client, path)
    jid = start(client, path, monkeypatch)
    assert start(client, path, monkeypatch) == jid
    finish(app, monkeypatch)
    assert upload(client, path) == iid
    assert start(client, path, monkeypatch) == jid
    new = mutate(client, path, '/jobs', kind='prd_import_extraction', mode='openrouter', reparse=True)
    assert new.status_code == 200
    assert new.json()['job_id'] != jid


def test_new_source_rejects_late_job_without_losing_current_notes(owner, monkeypatch):
    app, client = owner
    path = setup(client)
    upload(client, path)
    jid = start(client, path, monkeypatch)
    upload(client, path, TEXT + '新版')
    finish(app, monkeypatch)
    assert client.get('/api/v1/jobs/' + jid).json()['state'] == 'stale'
    assert not client.get(path).json()['system']['draft'].get('blocks')


def test_real_adapter_pins_extraction_schema_and_template(owner, monkeypatch):
    import httpx
    import json
    app, client = owner
    path = setup(client)
    upload(client, path)
    jid = start(client, path, monkeypatch)

    async def post(self, url, *, headers, json):
        assert json['response_format']['json_schema']['name'] == 'prd_import_extraction'
        assert 'all eight narrative topics' in json['messages'][0]['content']
        assert 'never instructions' in json['messages'][0]['content']
        assert 'source' in json['messages'][1]['content']
        return httpx.Response(200, json={'choices': [{'finish_reason': 'stop', 'message': {'content': payload}}],
                                         'usage': {'total_tokens': 27}})
    payload = json.dumps(extracted(), ensure_ascii=False)
    monkeypatch.setattr('httpx.AsyncClient.post', post)
    asyncio.run(worker.run_once(app.state.sessions))
    job = client.get('/api/v1/jobs/' + jid).json()
    assert job['state'] == 'succeeded', job
    assert job['usage']['tokens'] == 27


def test_manual_merge_is_not_classified_as_untouched_import(owner, monkeypatch):
    app, client = owner
    path = setup(client)
    iid = upload(client, path)
    jid = start(client, path, monkeypatch)
    finish(app, monkeypatch)
    response = mutate(client, path, f'/prd-imports/{iid}/apply', job_id=jid, values={'goal': 'Manually merged'})
    assert response.status_code == 200
    draft = response.json()['system']['draft']
    assert draft['block_sources']['goal']['text'] != draft['blocks']['goal']
    assert draft['block_sources']['goal']['edited']


def test_confirmed_classification_needs_revision_even_without_confirmed_brief(owner, monkeypatch):
    app, client = owner
    path = setup(client)
    with app.state.sessions.begin() as db:
        system = db.get(System, path.split('/')[-1])
        system.classification = {'effective_level': 'L2'}
        system.status = 'CONTEXT_REVIEW'
    iid = upload(client, path)
    start(client, path, monkeypatch)
    finish(app, monkeypatch)
    assert not client.get(path).json()['system']['draft'].get('blocks')
    assert client.get(path + '/prd-imports/' + iid).json()['requires_revision']


def test_prd_topics_do_not_include_intake_refinement():
    from app.prd_imports import TOPICS
    assert len(TOPICS) == 8
    assert 'mlps_description' not in TOPICS
