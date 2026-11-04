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
