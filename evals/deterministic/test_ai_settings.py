import asyncio

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app import worker
from app.ai_settings import active_config
from app.db import AccountPolicy, AdminAudit, User
from conftest import register

PATH = '/api/v1/admin/ai-settings'


def body(client):
    data = client.get(PATH).json()
    return {k: v for k, v in data.items() if k not in ('defaults', 'key_configured')}


def test_settings_isolation_revision_and_secret_boundary(owner, monkeypatch):
    app, client = owner
    monkeypatch.setenv('OPENROUTER_API_KEY', 'secret-never-returned')
    data = body(client)
    assert len(data['prompts']) == 17
    assert 'prd_import_extraction' in data['prompts']
    data['model'] = 'test/configured-model'
    saved = client.put(PATH, json=data)
    assert saved.status_code == 200
    assert saved.json()['version'] == 1
    assert 'secret-never-returned' not in saved.text
    assert client.put(PATH, json=data).status_code == 409
    assert client.get('/api/v1/auth/session').json()['model_configured']
    with TestClient(app) as other:
        register(other, 'other-settings@example.test')
        assert other.get(PATH).json()['version'] == 0
    with app.state.sessions() as db:
        audit = db.scalar(select(AdminAudit).where(AdminAudit.action == 'ai.settings.updated'))
        assert audit is not None
    with app.state.sessions.begin() as db:
        user = db.scalar(select(User).where(User.email == 'owner@example.test'))
        policy = db.get(AccountPolicy, user.id)
        if policy:
            policy.admin = False
        else:
            db.add(AccountPolicy(user_id=user.id, admin=False))
    assert client.get(PATH).status_code == 403
    assert client.put(PATH, json=data).status_code == 403
    assert client.get('/api/v1/admin/ai-prompts').status_code == 403


@pytest.mark.parametrize('change', [
    {'max_tokens': -1}, {'max_tokens': True}, {'reasoning_tokens': '12000'},
    {'reasoning_tokens': []}, {'zdr': 'false'}, {'prompts': {}}, {'api_key': 'not-allowed'},
])
def test_invalid_settings_never_saved(owner, change):
    _, client = owner
    data = body(client)
    assert client.put(PATH, json={**data, **change}).status_code == 422
    assert client.get(PATH).json()['version'] == 0


def test_queued_job_uses_pinned_configuration_and_real_transport(owner, monkeypatch):
    app, client = owner
    monkeypatch.setenv('OPENROUTER_API_KEY', 'offline-key')
    monkeypatch.delenv('OPENROUTER_MODEL', raising=False)
    data = body(client)
    data['model'] = 'offline/model-one'
    data['prompts']['narrative_refinement:goal'] = 'Custom prompt in {language}; retain evidence.'
    assert client.put(PATH, json=data).status_code == 200
    detail = client.post('/api/v1/systems', json={'name': 'Demo'}).json()
    path = '/api/v1/systems/' + detail['system']['id']
    detail = client.put(path + '/context-draft', json={'version': detail['system']['version'], 'blocks': {'goal': 'Service portal'}}).json()
    response = client.post(path + '/jobs', json={'version': detail['system']['version'], 'kind': 'narrative_refinement:goal', 'mode': 'openrouter', 'language': 'en'})
    assert response.status_code == 200, response.text
    job_id = response.json()['job_id']
    data = body(client)
    data['model'] = 'offline/model-two'
    data['prompts']['narrative_refinement:goal'] = 'New template'
    assert client.put(PATH, json=data).status_code == 200
    async def post(self, url, *, headers, json):
        import httpx
        assert json['model'] == 'offline/model-one'
        assert json['messages'][0]['content'] == 'Custom prompt in English; retain evidence.'
        assert 'prompts' not in json['messages'][1]['content']
        return httpx.Response(200, json={'choices': [{'finish_reason': 'stop', 'message': {'content': '{"text":"Service portal draft", "questions":[]}'}}], 'usage': {'total_tokens': 12}})
    monkeypatch.setattr('httpx.AsyncClient.post', post)
    asyncio.run(worker.run_once(app.state.sessions))
    job = client.get('/api/v1/jobs/' + job_id).json()
    assert job['state'] == 'succeeded', job
    assert job['usage']['ai_config_version'] == 1
    assert 'ai_config' not in job['usage']
    assert len(job['usage']['ai_config_hash']) == 64
    assert job['usage']['tokens'] == 12
    assert active_config.get() is None


def test_prompt_catalog_matches_current_intake_and_preserves_legacy_settings(owner):
    from app.ai_settings import defaults
    from app.mlps_intake import QUESTIONS
    _, client = owner
    before = body(client)
    response = client.get('/api/v1/admin/ai-prompts')
    assert response.status_code == 200
    items = response.json()['items']
    current = {item['key'] for item in items if item['status'] == 'active'}
    system = {item['key']: item for item in items if item['status'] == 'system'}
    legacy = {item['key'] for item in items if item['status'] == 'legacy'}
    topics = {f"narrative_refinement:{q['ai_topic']}" for q in QUESTIONS if q.get('ai_topic')}
    assert current == {'prd_generation', 'impact_analysis'} | topics
    assert len(current) == 5 and len(legacy) == 12
    assert current | legacy == set(defaults()['prompts'])
    assert set(system) == {'requirement_risk', 'delivery_evidence'}
    assert len({item['key'] for item in items}) == len(items)
    assert 'control_items and supplier_response' in system['requirement_risk']['instruction']
    assert 'EVERY acceptance criterion' in system['delivery_evidence']['instruction']
    assert all(item['title']['zh'] and item['title']['en'] and item['usage']['zh'] and item['usage']['en'] for item in items)
    assert body(client) == before  # Reading applicability must not write runtime settings.
    before['prompts']['context_organization'] = '历史自定义模板，保持原文'
    assert client.put(PATH, json=before).status_code == 200
    saved = body(client)
    saved['prompts']['prd_generation'] = 'Current PRD instruction {language}'
    assert client.put(PATH, json=saved).status_code == 200
    assert body(client)['prompts']['context_organization'] == '历史自定义模板，保持原文'


@pytest.mark.parametrize('kind', ['prd_generation', 'impact_analysis', 'delivery_evidence'])
def test_current_default_prompts_do_not_mix_unrelated_task_contracts(kind):
    from app.ai import default_instruction
    instruction = default_instruction(kind, 'en')
    assert 'untrusted business evidence' in instruction
    assert 'grading_facts' not in instruction and 'source_blocks' not in instruction
    if kind == 'prd_generation':
        assert 'EVERY assigned REQ key' in instruction
        assert 'finding for EVERY requirement' not in instruction
    elif kind == 'impact_analysis':
        assert 'finding for EVERY requirement' in instruction
        assert 'requirement_slots' not in instruction
    else:
        assert 'requirement_slots' not in instruction
        assert 'finding for EVERY requirement' not in instruction
