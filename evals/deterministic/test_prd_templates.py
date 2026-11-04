import asyncio

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app import worker
from app.db import AccountPolicy, Job, Prd, User
from app.prd_templates import recorded
from conftest import register
from test_applicability import prepare
from test_workflow import command, current

PATH = '/api/v1/admin/prd-template'


def save(client, template):
    return client.put(PATH, json={'version': client.get(PATH).json()['version'], 'template': template})


@pytest.mark.parametrize('template', [
    {'filename': 'x.docx', 'content': '# title'}, {'filename': '../x.md', 'content': '# title'},
    {'filename': 'x.md', 'content': ''}, {'filename': 'x.md', 'content': '\x00binary'},
    {'filename': 'x.md', 'content': 'x' * 100001}, {'filename': 'x.md', 'content': 12},
])
def test_rejects_invalid_templates(owner, template):
    _, client = owner
    before = client.get(PATH).json()
    assert save(client, template).status_code == 422
    assert client.get(PATH).json() == before


def test_template_admin_scope_conflicts_and_delete(owner):
    app, client = owner
    before = client.get(PATH).json()
    assert save(client, {'filename': 'custom.md', 'content': '# Customized'}).status_code == 200
    assert client.put(PATH, json={'version': before['version'], 'template': None}).status_code == 409
    with TestClient(app) as other:
        register(other, 'template-other@example.test')
        assert other.get(PATH).json()['template'] == before['template']
    assert save(client, None).json()['template'] is None
    with app.state.sessions.begin() as db:
        user = db.scalar(select(User).where(User.email == 'owner@example.test'))
        policy = db.get(AccountPolicy, user.id)
        if policy:
            policy.admin = False
        else:
            db.add(AccountPolicy(user_id=user.id, admin=False))
    assert client.get(PATH).status_code == 403
    assert client.put(PATH, json={'version': 2, 'template': None}).status_code == 403


def test_queued_template_is_pinned_and_all_controls_rendered(owner):
    app, client, sid = prepare(owner)
    command(client, sid, 'applicability-answers', {'answers': {'delivery.models': ['in_house'], 'ops.remote_admin': 'no'}}, method='put')
    save(client, {'filename': 'chosen.md', 'content': '# Chosen {{name}}\n{{unknown metric}}\n{{questions}}'})
    command(client, sid, 'jobs', {'kind': 'prd_generation', 'mode': 'local', 'language': 'zh'})
    save(client, None)
    asyncio.run(worker.run_once(app.state.sessions))
    with app.state.sessions() as db:
        job = db.scalar(select(Job).where(Job.system_id == sid, Job.kind == 'prd_generation'))
        assert job.state == 'succeeded', job.error
        prd = db.get(Prd, job.output['prd_id'])
        assert prd.markdown.startswith('# Chosen')
        assert '{{' not in prd.markdown
        assert 'unknown metric' in prd.markdown and 'Q-' in prd.markdown
        assert 'BASE' in prd.markdown and 'OWN' in prd.markdown
        assert '\n### ' in prd.markdown
        assert '\n#### ' in prd.markdown
        assert 'questionnaire_facts' in prd.markdown
        assert 'OUT [' not in prd.markdown
        assert recorded(db, prd)['template']['filename'] == 'chosen.md'
        original_data, original_markdown = prd.data, prd.markdown
    command(client, sid, 'prd-versions', {'data': original_data})
    with app.state.sessions() as db:
        rows = list(db.scalars(select(Prd).where(Prd.system_id == sid)))
        assert len(rows) == 2
        assert all(p.markdown.startswith('# Chosen') for p in rows)
        assert rows[0].markdown == original_markdown
    assert current(client, sid)['system']['status'] == 'PRD_REVIEW'

@pytest.mark.parametrize('language', ['zh', 'en'])
def test_default_prd_groups_visible_questions_and_preserves_blanks(language):
    from app.domain import digest
    from app.prd_templates import DEFAULT, render
    source = {'name': 'Example', 'revision': 1, 'context_revision_id': 'ctx', 'generation_mode': 'local',
              'context': {'departments': [], 'roles': [], 'owner_role': ''}, 'controls': [],
              'classification': {'effective_level': 2, 'answers': {
                  'system_functions': 'Authored function | original', 'system_scenarios': 'Approval flow',
                  'system_interaction': '否', 'interconnected_system_level': 'HIDDEN ANSWER',
                  'system_description': 'RETIRED ANSWER', 'deployment_model': ['私有云'],
                  'recovery_objectives_h': {'rto': 0, 'rpo': 2}}}}
    template = {'filename': 'default.md', 'content': DEFAULT.read_text(encoding='utf-8')}
    result = render({'summary': '', 'requirements': [], 'assumptions': [], 'open_questions': []},
                    source, language, {'version': 0, 'hash': digest(template), 'template': template})
    sections = result.split('\n## ')[1:]
    assert len(sections) == 9
    assert 'A01' in sections[0] and 'A03' in sections[1]
    assert 'Approval flow' in sections[2]
    assert 'questionnaire:A05 ' not in result
    assert 'B10' in sections[4] and 'B06' in sections[5]
    assert '"rto": 0' in sections[7] and 'B05' in sections[5]
    assert 'HIDDEN ANSWER' not in result and 'RETIRED ANSWER' not in result
    assert 'Q-001' not in result and '{{' not in result
    assert '#### 系统正式名称及简称\n\n\n' in result if language == 'zh' else '#### System name and abbreviation\n\n\n' in result



def test_context_removed_role_fields_are_optional():
    from app.domain import validate_context
    from test_workflow import BRIEF
    value = {**BRIEF, 'roles': [], 'owner_role': ''}
    assert validate_context(value)['owner_role'] == ''


def test_prd_uses_named_entity_contacts_and_omits_screening_only_questions():
    from app.domain import digest
    from app.prd_templates import DEFAULT, render
    from test_workflow import BRIEF
    source = {'name': 'Example', 'revision': 1, 'context_revision_id': 'ctx', 'generation_mode': 'local',
              'context': {**BRIEF, 'roles': ['Hidden operating role'], 'owner_role': 'Hidden owner'}, 'controls': [],
              'classification': {'effective_level': 2, 'answers': {'system_owner': ['零售运营'],
                  'security_responsible_entity': '是', 'independent_business': '是', 'public_service_nature': '否',
                  'system_functions': 'Duplicate function'}, 'notes': {'security_responsible_entity': 'Recorded entity'},
                  'department_contacts': {'零售运营': 'Recorded contact'}}}
    template = {'filename': 'default.md', 'content': DEFAULT.read_text(encoding='utf-8')}
    result = render({'summary': '', 'requirements': [], 'assumptions': [], 'open_questions': []}, source, 'zh',
                    {'version': 0, 'hash': digest(template), 'template': template})
    assert 'Recorded entity' in result and 'Recorded contact' in result
    assert '| B03 |' not in result and '| C04 |' not in result and '| A05 |' not in result
    assert 'Hidden operating role' not in result and 'Hidden owner' not in result


def test_default_template_omits_duplicate_context_fields_and_allows_missing_summary():
    from app.ai import local_prd
    from app.domain import digest, validate_context, validate_prd
    from app.prd_templates import DEFAULT, render
    from test_workflow import BRIEF
    context = validate_context({**BRIEF, 'summary': '', 'scope': 'DUPLICATE SCOPE',
                                'workflow': 'DUPLICATE WORKFLOW', 'data_notes': 'DUPLICATE DATA',
                                'integrations': 'DUPLICATE INTEGRATIONS'})
    source = {'name': 'Example', 'revision': 1, 'context_revision_id': 'ctx', 'generation_mode': 'local',
              'context': context, 'controls': [], 'classification': {'effective_level': 2, 'answers': {
                  'system_purpose': 'Questionnaire purpose', 'system_scenarios': 'Questionnaire scenario',
                  'system_interfaces_description': 'Questionnaire interfaces'}}}
    data = validate_prd(local_prd(source, 'zh'), context, [])
    template = {'filename': 'default.md', 'content': DEFAULT.read_text(encoding='utf-8')}
    result = render(data, source, 'zh', {'version': 0, 'hash': digest(template), 'template': template})
    assert all(value not in result for value in ['DUPLICATE SCOPE', 'DUPLICATE WORKFLOW', 'DUPLICATE DATA', 'DUPLICATE INTEGRATIONS'])
    assert all(value in result for value in ['Questionnaire purpose', 'Questionnaire scenario', 'Questionnaire interfaces'])
