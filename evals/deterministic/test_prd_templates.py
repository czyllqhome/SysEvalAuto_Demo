import asyncio
from copy import deepcopy
from io import BytesIO
from pathlib import Path

import pytest
from docx import Document
from fastapi.testclient import TestClient
from sqlalchemy import select

from app import worker
from app.db import AccountPolicy, Job, Prd, User
from app.prd_templates import recorded
from conftest import register
from test_applicability import prepare
from test_workflow import command, current

PATH = '/api/v1/admin/prd-template'
LEGACY_TEMPLATE = Path(__file__).parents[1] / 'fixtures/prd-layout-v3.md'


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
    assert len(sections) == 8
    assert 'A01' in sections[0] and 'A03' in sections[1]
    assert 'Approval flow' in sections[2]
    assert 'questionnaire:A05 ' not in result
    assert 'B10' in sections[4] and 'B06' in sections[5]
    assert 'RTO: 0' in sections[7] and 'B05' in sections[5]
    assert 'HIDDEN ANSWER' not in result and 'RETIRED ANSWER' not in result
    assert 'Q-001' not in result and '{{' not in result
    assert all(removed not in result for removed in ['## 9 ', 'syseval:prd-appendix', 'Appendix', 'ASM-', '## traceability'])
    assert ('### 系统正式名称及简称\n\n待补充' if language == 'zh' else '### System name and abbreviation\n\nTo complete') in result



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


@pytest.mark.parametrize('language', ['zh', 'en'])
@pytest.mark.parametrize('layout', [3, 4])
def test_compact_security_groups_controls_once_and_preserves_supporting_records(language, layout):
    from app.domain import digest
    from app.prd_templates import DEFAULT, render
    from test_workflow import BRIEF
    controls = [
        {'id': 'c1', 'code': 'CONTROL-ONE', 'domain': 'fallback', 'metadata': {'source': {'languages': {
            'zh': {'filename': 'source.xlsx', 'row': 4, 'fields': {'security_domain': '网络安全', 'control_requirement': '控制原文一', 'assessment_procedure': 'SECRET PROCEDURE'}},
            'en': {'filename': 'source.xlsx', 'row': 4, 'fields': {'security_domain': 'Network security', 'control_requirement': 'Original control one'}}}}}},
        {'id': 'c2', 'code': 'CONTROL-TWO', 'domain': 'Data security', 'translations': {'zh': {'description': '人工控制二'}, 'en': {'description': 'Custom control two'}}},
    ]
    requirement = {'id': 'REQ-001', 'title': 'Authored title', 'description': 'Authored project detail',
                   'priority': 'must', 'source_control_ids': ['c1', 'c2'], 'source_context_item_ids': ['F1'],
                   'dependencies': [], 'acceptance_criteria': ['Verify authorized access']}
    data = {'summary': '', 'requirements': [requirement, {**requirement, 'id': 'REQ-002', 'source_control_ids': ['c1']}], 'assumptions': [], 'open_questions': []}
    source = {'name': 'Example', 'revision': 1, 'context_revision_id': 'ctx', 'generation_mode': 'local',
              'context': BRIEF, 'controls': controls, 'classification': {'effective_level': 2, 'answers': {
                  'data_volume_ranges': {'records': 'under_100k', 'storage': '1_10tb'}}}}
    original_records = deepcopy((data, source))
    template = {'filename': f'v{layout}.md', 'content': (LEGACY_TEMPLATE if layout == 3 else DEFAULT).read_text(encoding='utf-8')}
    result = render(data, source, language, {'version': 0, 'hash': digest(template), 'template': template})
    chapter = result.split('## 7 ')[1].split('## 8 ')[0]
    original = '控制原文一' if language == 'zh' else 'Original control one'
    assert chapter.count(original) == 1
    assert ('人工控制二' if language == 'zh' else 'Custom control two') in chapter
    assert ('### 网络安全' if language == 'zh' else '### Network security') in chapter
    assert '### Data security' in chapter
    assert all(noise not in chapter for noise in ['REQ-', 'CONTROL-', 'source.xlsx', 'SECRET PROCEDURE', 'must', 'Authored project detail', 'Verify authorized access'])
    if layout == 3:
        appendix = result.split('<!-- syseval:prd-appendix -->')[1]
        assert all(text in appendix for text in ['REQ-001', 'REQ-002', 'CONTROL-ONE', 'CONTROL-TWO', 'Authored project detail', 'Verify authorized access', 'F1'])
    else:
        assert all(text not in result for text in ['## 9 ', 'syseval:prd-appendix', 'Authored project detail', 'Verify authorized access', '## security_details', '## traceability', '## constraints', '## document_info', '## review'])
    assert (data, source) == original_records
    assert 'under_100k' not in result and '1_10tb' not in result
    assert '本地规则草稿' in result if language == 'zh' else 'Local rule-based draft' in result


def test_apply_template_creates_unapproved_revision_without_rewriting_requirements(owner):
    from test_workflow import generate_prd
    app, client, sid = generate_prd(owner)
    before = current(client, sid)['prd']
    path = f"/api/v1/systems/{sid}/prd-versions/{before['id']}/document"
    original_markdown = client.get(path).text
    save(client, {'filename': 'next.md', 'content': '# NEXT {{name}}\n{{security_requirements}}'})
    command(client, sid, 'prd-versions', {'refresh_template': True, 'prd_id': 'stale'}, expected=409)
    command(client, sid, 'prd-versions', {'refresh_template': 'yes', 'prd_id': before['id']}, expected=422)
    after = command(client, sid, 'prd-versions', {'refresh_template': True, 'prd_id': before['id']}).json()['prd']
    assert after['id'] != before['id'] and not after['approved']
    assert after['data'] == before['data'] and after['mode'] == before['mode']
    assert client.get(path).text == original_markdown
    with app.state.sessions() as db:
        assert db.get(Prd, before['id']).approved
        assert db.get(Prd, after['id']).markdown.startswith('# NEXT')
        assert recorded(db, db.get(Prd, after['id']))['template']['filename'] == 'next.md'


def test_apply_template_forbidden_after_supplier_dispatch(owner):
    from test_workflow import invite_supplier
    _, client, vendor, sid = invite_supplier(owner)
    prd_id = current(client, sid)['prd']['id']
    command(client, sid, 'prd-versions', {'refresh_template': True, 'prd_id': prd_id}, expected=409)
    command(vendor, sid, 'prd-versions', {'refresh_template': True, 'prd_id': prd_id}, expected=404)


@pytest.mark.parametrize('language', ['zh', 'en'])
def test_refresh_to_eight_chapters_updates_downloads_and_retains_legacy_prd_and_requirement_records(owner, language):
    from app.domain import digest
    from app.prd_templates import DEFAULT
    from test_workflow import prepare as prepare_workflow

    app, client, sid = prepare_workflow(owner)
    save(client, {'filename': 'previous-v3.md', 'content': LEGACY_TEMPLATE.read_text(encoding='utf-8')})
    command(client, sid, 'jobs', {'kind': 'prd_generation', 'mode': 'local', 'language': language})
    assert asyncio.run(worker.run_once(app.state.sessions))
    command(client, sid, 'prd-approval')
    before = current(client, sid)
    original = before['prd']
    old_path = f"/api/v1/systems/{sid}/prd-versions/{original['id']}/document"
    old_markdown = client.get(old_path).text
    assert '## 9 ' in old_markdown and 'syseval:prd-appendix' in old_markdown
    save(client, {'filename': 'current-v4.md', 'content': DEFAULT.read_text(encoding='utf-8')})
    after = command(client, sid, 'prd-versions', {'refresh_template': True, 'prd_id': original['id']}).json()
    prd = after['prd']
    assert prd['id'] != original['id'] and not prd['approved']
    assert prd['data'] == original['data'] and prd['mode'] == original['mode'] and prd['language'] == language
    assert after['system']['revision'] == before['system']['revision']
    assert after['controls'] == before['controls']
    assert all(r['acceptance_criteria'] for r in prd['data']['requirements'])
    new_path = f"/api/v1/systems/{sid}/prd-versions/{prd['id']}/document"
    markdown = client.get(new_path).text
    assert markdown.count('\n## ') == 8 and 'syseval:prd-layout-v4' in markdown
    for removed in ['## 9 ', 'syseval:prd-appendix', 'Appendix', 'ASM-', '假设与待确认', 'Assumptions and questions', '## traceability', '## constraints', '## review']:
        assert removed not in markdown
    response = client.get(new_path, params={'format': 'docx'})
    assert response.status_code == 200
    document = Document(BytesIO(response.content))
    assert [p.text for p in document.paragraphs if p.style.name == 'Heading 1'] == [
        line[3:] for line in markdown.splitlines() if line.startswith('## ')]
    word_text = '\n'.join(p.text for p in document.paragraphs)
    assert 'Service levels' in word_text and 'Delivery and open questions' not in word_text
    assert 'Appendix' not in word_text
    assert client.get(old_path).text == old_markdown
    with app.state.sessions() as db:
        saved = db.get(Prd, prd['id'])
        assert saved.content_hash == digest({'data': saved.data, 'markdown': markdown, 'renderer': 'R1'})
        assert db.get(Prd, original['id']).content_hash == original['content_hash']
        assert db.get(Prd, original['id']).approved
        assert recorded(db, saved)['template']['filename'] == 'current-v4.md'
