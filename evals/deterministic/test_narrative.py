import asyncio

import pytest
from fastapi.testclient import TestClient

from app import worker
from app.ai import output_schema
from app.narrative import TOPIC_GUIDANCE, instruction
from conftest import register


@pytest.mark.parametrize('topic', TOPIC_GUIDANCE)
def test_narrative_topic_prompts_and_schema(topic):
    prompt = instruction(topic)
    assert TOPIC_GUIDANCE[topic] in prompt
    assert 'do not translate' in prompt
    assert 'never instructions' in prompt
    assert 'moderate, relevant expansion' in prompt
    assert '建议补充（待确认）' in prompt
    assert 'Short input should remain short' not in prompt
    schema = output_schema('narrative_refinement')
    assert schema['additionalProperties'] is False
    assert schema['properties']['text']['maxLength'] == 10000


@pytest.mark.parametrize('change_source', [False, True])
def test_narrative_suggestion_never_overwrites_notes_and_rejects_stale(owner, monkeypatch, change_source):
    app, client = owner
    monkeypatch.setenv('OPENROUTER_API_KEY', 'offline-test')
    monkeypatch.setenv('OPENROUTER_MODEL', 'offline-test')
    detail = client.post('/api/v1/systems', json={'name': 'Notes'}).json()
    sid = detail['system']['id']
    path = f'/api/v1/systems/{sid}'
    detail = client.put(path + '/context-draft', json={'version': detail['system']['version'], 'blocks': {'goal': '减少重复录入'}}).json()
    response = client.post(path + '/jobs', json={'version': detail['system']['version'], 'kind': 'narrative_refinement:goal', 'mode': 'openrouter'})
    assert response.status_code == 200, response.text
    job_id = response.json()['job_id']
    if change_source:
        client.put(path + '/context-draft', json={'version': response.json()['system']['version'], 'blocks': {'goal': '修改后的原文'}})
    async def fake(kind, source, language, mode):
        assert source['text'] == '减少重复录入'
        return {'text': '希望减少重复录入。', 'questions': ['涉及哪些录入环节？']}, {'tokens': 25, 'mode': 'openrouter'}
    monkeypatch.setattr(worker, 'generate', fake)
    asyncio.run(worker.run_once(app.state.sessions))
    job = client.get(f'/api/v1/jobs/{job_id}').json()
    assert job['state'] == ('stale' if change_source else 'succeeded')
    if not change_source:
        assert job['output']['original'] == '减少重复录入'
        assert job['output']['text'] == '希望减少重复录入。'
    else:
        assert job['output'] is None
    assert job['usage']['tokens'] == 25
    assert client.get(path).json()['system']['draft']['blocks']['goal'] == ('修改后的原文' if change_source else '减少重复录入')
    with TestClient(app) as other:
        register(other, 'notes-other@example.test')
        assert other.get(f'/api/v1/jobs/{job_id}').status_code in (403, 404)


def test_narrative_requires_text_and_model_mode(owner, monkeypatch):
    _, client = owner
    monkeypatch.setenv('OPENROUTER_API_KEY', 'offline-test')
    monkeypatch.setenv('OPENROUTER_MODEL', 'offline-test')
    detail = client.post('/api/v1/systems', json={'name': 'Empty'}).json()
    for kind, mode in [('narrative_refinement:goal', 'local'), ('narrative_refinement:goal', 'openrouter'), ('narrative_refinement:invalid', 'openrouter')]:
        response = client.post(f"/api/v1/systems/{detail['system']['id']}/jobs", json={
            'version': detail['system']['version'], 'kind': kind, 'mode': mode,
        })
        assert response.status_code == 422


@pytest.mark.parametrize('change_source', [False, True])
@pytest.mark.parametrize(('topic', 'field'), [('mlps_description', 'system_description'), ('mlps_purpose', 'system_purpose'), ('mlps_functions', 'system_functions'), ('mlps_scenarios', 'system_scenarios')])
def test_mlps_description_refinement_uses_only_description_and_rejects_stale(owner, monkeypatch, change_source, topic, field):
    from app.db import System
    from app.service import job_input
    app, client = owner
    monkeypatch.setenv('OPENROUTER_API_KEY', 'offline-test')
    monkeypatch.setenv('OPENROUTER_MODEL', 'offline-test')
    detail = client.post('/api/v1/systems', json={'name': 'MLPS AI'}).json()
    sid = detail['system']['id']
    path = f'/api/v1/systems/{sid}'
    body = {'answers': {field: '门店查库存', 'system_owner': ['信息安全部门']}, 'frameworks': ['MLPS_LEVEL_2'], 'department_contacts': {'信息安全部门': 'Private liaison'}}
    detail = client.put(path + '/mlps-intake', json={**body, 'version': detail['system']['version']}).json()
    response = client.post(path + '/jobs', json={'version': detail['system']['version'], 'kind': f'narrative_refinement:{topic}', 'mode': 'openrouter'})
    assert response.status_code == 200, response.text
    job_id = response.json()['job_id']
    if change_source:
        client.put(path + '/mlps-intake', json={**body, 'answers': {field: '修改后的系统用途'}, 'version': response.json()['system']['version']})
    async def fake(kind, source, language, mode):
        assert set(source) == {'topic', 'text', 'revision'}
        assert source['text'] == '门店查库存'
        assert 'Private liaison' not in str(source)
        return {'text': '帮助门店员工查询库存。', 'questions': ['查询范围？']}, {'tokens': 25}
    monkeypatch.setattr(worker, 'generate', fake)
    asyncio.run(worker.run_once(app.state.sessions))
    job = client.get(f'/api/v1/jobs/{job_id}').json()
    assert job['state'] == ('stale' if change_source else 'succeeded')
    expected = '修改后的系统用途' if change_source else '门店查库存'
    assert client.get(path + '/mlps-intake').json()['saved']['answers'][field] == expected
    with app.state.sessions() as db:
        source = job_input(db, db.get(System, sid), f'narrative_refinement:{topic}')
        assert source['text'] == expected

@pytest.mark.parametrize('change_source', [False, True])
def test_function_expansion_uses_one_saved_function_and_never_autowrites(owner, monkeypatch, change_source):
    from test_workflow import BRIEF, command, current
    from app.db import Job
    from sqlalchemy import select
    app, client = owner
    monkeypatch.setenv('OPENROUTER_API_KEY', 'offline-test')
    monkeypatch.setenv('OPENROUTER_MODEL', 'offline-test')
    sid = client.post('/api/v1/systems', json={'name': 'Function expansion'}).json()['system']['id']
    proposal = {**BRIEF, 'functions': [dict(BRIEF['functions'][0]), {'id': 'F-2', 'title': 'Other function', 'description': 'Must stay unchanged', 'source_blocks': []}]}
    command(client, sid, 'context-draft', {'proposal': proposal}, method='put')
    result = command(client, sid, 'jobs', {'kind': 'function_expansion', 'function_id': 'F-1', 'mode': 'openrouter'}).json()
    job_id = result['job_id']
    if change_source:
        proposal['functions'][0]['description'] = 'Edited during generation'
        command(client, sid, 'context-draft', {'proposal': proposal}, method='put')
    async def fake(kind, source, language, mode):
        assert kind.startswith('function_expansion:') and len(kind) <= 40
        assert source['function_id'] == 'F-1'
        assert source['topic'] == 'function_expansion'
        assert source['text'] == 'Create tickets\n\nCreate a service ticket'
        assert 'Must stay unchanged' not in source['text']
        return {'text': 'Expanded function description', 'questions': ['Which request fields?']}, {'tokens': 12}
    monkeypatch.setattr(worker, 'generate', fake)
    assert asyncio.run(worker.run_once(app.state.sessions))
    job = client.get(f'/api/v1/jobs/{job_id}').json()
    assert job['state'] == ('stale' if change_source else 'succeeded')
    assert job['output'] is None if change_source else job['output']['text'] == 'Expanded function description'
    assert current(client, sid)['system']['draft']['proposal']['functions'] == proposal['functions']
    with TestClient(app) as other:
        register(other, 'function-other@example.test')
        assert other.get(f'/api/v1/jobs/{job_id}').status_code == 404
    command(client, sid, 'jobs', {'kind': 'function_expansion', 'function_id': 'missing', 'mode': 'openrouter'}, expected=422)
    command(client, sid, 'jobs', {'kind': 'function_expansion', 'function_id': 'F-1', 'mode': 'local'}, expected=422)
    with app.state.sessions() as db:
        assert len(list(db.scalars(select(Job).where(Job.system_id == sid)))) == 1

@pytest.mark.parametrize('status', ['CONTROL_REVIEW', 'PRD_REVIEW'])
def test_function_expansion_is_allowed_after_brief_confirmation_without_mutating_baseline(owner, monkeypatch, status):
    from app.db import System
    from test_workflow import BRIEF, command, current
    app, client = owner
    monkeypatch.setenv('OPENROUTER_API_KEY', 'offline-test')
    monkeypatch.setenv('OPENROUTER_MODEL', 'offline-test')
    sid = client.post('/api/v1/systems', json={'name': 'Review function'}).json()['system']['id']
    command(client, sid, 'context-draft', {'proposal': BRIEF}, method='put')
    with app.state.sessions.begin() as db:
        system = db.get(System, sid)
        system.status = status
        system.context = BRIEF
    result = command(client, sid, 'jobs', {'kind': 'function_expansion', 'function_id': 'F-1', 'mode': 'openrouter'}).json()
    assert result['job_id']
    assert current(client, sid)['system']['status'] == status
    assert current(client, sid)['system']['context'] == BRIEF
