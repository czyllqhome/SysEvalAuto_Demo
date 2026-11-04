"""Organization-owned Markdown layouts; rendering never executes template code."""
import re
from pathlib import Path

from fastapi import Depends
from sqlalchemy import select

from . import access
from .db import AISettings, Audit
from .domain import DomainError, digest

DEFAULT = Path(__file__).with_name('templates') / 'prd.md'
SLOTS = ['name', 'document_info', 'summary', 'roles', 'scope', 'workflow', 'business_requirements',
         'interaction', 'data_and_integrations', 'security_requirements', 'traceability', 'constraints',
         'questions', 'review', 'ai_scope']


def snapshot(db, org_id):
    row = db.get(AISettings, org_id)
    template = (row.data.get('prd_template') if row and row.data.get('prd_template_generation') == 2 else
                {'filename': 'System_Assessment_PRD_v2.md', 'content': DEFAULT.read_text(encoding='utf-8')})
    return {'version': row.data.get('prd_template_version', 0) if row else 0, 'template': template, 'hash': digest(template)}


def validate(template):
    if template is None:
        return
    if not isinstance(template, dict) or set(template) != {'filename', 'content'}:
        raise DomainError('INVALID_FIELDS')
    name, content = template['filename'], template['content']
    if (not isinstance(name, str) or not name.lower().endswith('.md') or len(name) > 200
            or any(c in name for c in '/\\\x00') or not isinstance(content, str)
            or not content.strip() or len(content.encode('utf-8')) > 100_000
            or any(ord(c) < 32 and c not in '\n\r\t' for c in content)):
        raise DomainError('INVALID_FIELDS')


def register_routes(app, current, get_db):
    @app.get('/api/v1/admin/prd-template')
    def read(user=Depends(current), db=Depends(get_db)):
        access.require_admin(db, user)
        return {**snapshot(db, user.org_id), 'slots': SLOTS}

    @app.put('/api/v1/admin/prd-template')
    def save(body: dict, user=Depends(current), db=Depends(get_db)):
        access.require_admin(db, user)
        if set(body) != {'version', 'template'}:
            raise DomainError('INVALID_FIELDS')
        validate(body['template'])
        row = db.get(AISettings, user.org_id)
        version = row.data.get('prd_template_version', 0) if row else 0
        if type(body['version']) is not int or body['version'] != version:
            raise DomainError('VERSION_CONFLICT', 409)
        if row is None:
            row = AISettings(org_id=user.org_id, data={})
            db.add(row)
        row.data = {**row.data, 'prd_template': body['template'], 'prd_template_version': version + 1,
                    'prd_template_generation': 2}
        db.flush()
        access.audit(db, user, 'prd.template.deleted' if body['template'] is None else 'prd.template.updated',
                     {'version': row.version, 'hash': digest(body['template'])})
        db.commit()
        return read(user, db)


def record(db, prd, template):
    db.add(Audit(system_id=prd.system_id, action='prd.template.snapshot',
                 detail={'prd_id': prd.id, 'template': template}))


def recorded(db, prd):
    for audit in db.scalars(select(Audit).where(Audit.system_id == prd.system_id, Audit.action == 'prd.template.snapshot')):
        if audit.detail.get('prd_id') == prd.id:
            return audit.detail['template']
    return None


def render(data, source, language, pinned):
    zh = language == 'zh'
    def t(a, b):
        return a if zh else b
    def cell(value):
        return str(value).replace('|', '\\|').replace('\n', '<br>')
    ctx = source['context']
    questions = []
    def missing(label):
        questions.append(label)
        return t('待确认', 'To confirm') + f' (Q-{len(questions):03})'
    def value(key, label):
        return ctx.get(key) or missing(label)
    controls = {c['id']: c for c in source['controls']}
    def requirements(security):
        lines = []
        for r in data['requirements']:
            if bool(r['source_control_ids']) != security:
                continue
            refs = [controls[c]['code'] + ' [' + c + ']' for c in r['source_control_ids']]
            lines += [f"### {r['id']} · {r['title']}", '', r['description'], '',
                      t('优先级', 'Priority') + ': ' + r['priority'],
                      t('来源', 'Sources') + ': ' + ', '.join(r['source_context_item_ids'] + refs),
                      t('依赖', 'Dependencies') + ': ' + ', '.join(r['dependencies']), '']
            lines += [f"- AC-{r['id']}-{i + 1}: {a}" for i, a in enumerate(r['acceptance_criteria'])]
            for cid in r['source_control_ids']:
                control = controls[cid]
                meta = control.get('metadata', {})
                sources = meta.get('source', {}).get('languages', {})
                original = sources.get(language) or sources.get('zh')
                if original:
                    lines += ['', t('原始控制要求', 'Original control requirement') + ': ' + original['fields']['control_requirement'],
                              t('测评步骤', 'Assessment procedure') + ': ' + original['fields']['assessment_procedure'],
                              f"{original['filename']} · row {original['row']} · {meta.get('source_ref', '')}"]
                elif sources:
                    lines += ['', missing(t('该语言控制原文缺失：', 'Control source missing in this language: ') + control['code'])]
            lines += ['']
        return '\n'.join(lines) or t('无此类已纳入需求。', 'No included requirements of this type.')
    trace = ['| Requirement | Business source | Control source | Acceptance |', '|---|---|---|---|']
    for r in data['requirements']:
        trace.append('| ' + ' | '.join(map(cell, [r['id'], ', '.join(r['source_context_item_ids']),
                     ', '.join(controls[c]['code'] for c in r['source_control_ids']),
                     ', '.join(f"AC-{r['id']}-{i + 1}" for i in range(len(r['acceptance_criteria'])))])) + ' |')
    slots = {'name': source['name'], 'document_info': '\n\n'.join([
        t('状态：待评审；不代表已批准或已验收。', 'Status: awaiting review; not approved or accepted.'),
        t('生成方式：', 'Generation mode: ') + {'local': t('本地规则草稿，需人工细化', 'Local rule-based draft; needs refinement'),
            'openrouter': t('模型生成草稿，需人工评审', 'Model-generated draft; needs review')}.get(source.get('generation_mode'), t('人工修订', 'Manual revision')),
        f"Revision: {source['revision']} · Context: {source['context_revision_id']}",
        f"Level: {source['classification']['effective_level']} · Catalog: {source['classification'].get('catalog_id', '')}",
        f"Template: {pinned['version']} · SHA-256: {pinned['hash']}"]),
        'summary': data['summary'], 'roles': '\n\n'.join([', '.join(ctx['departments']), ', '.join(ctx['roles']), ctx['owner_role']]),
        'scope': value('scope', 'Scope'), 'workflow': value('workflow', 'Workflow and business object states'),
        'business_requirements': requirements(False), 'security_requirements': requirements(True),
        'interaction': missing(t('页面、交互状态与原型需人工细化', 'Pages, interaction states and prototypes need review')),
        'data_and_integrations': value('data_notes', 'Data requirements') + '\n\n' + value('integrations', 'Integration contracts'),
        'traceability': '\n'.join(trace), 'constraints': value('constraints', 'Delivery and release constraints'),
        'ai_scope': missing(t('AI 能力、知识、工具与评测边界；不适用时请说明理由', 'AI, knowledge, tool and evaluation scope; explain if not applicable')),
        'review': t('业务功能和已纳入控制覆盖校验已通过。可测性、权限异常、上线条件及待确认项仍需人工评审。',
                    'Business function and included-control coverage validated. Measurability, permission failures, release conditions and open questions need human review.')}
    text = pinned['template']['content']
    # A/B are reference instructions, not document content, in the supplied reference format.
    if '\n## 0 ' in text and '\n## A ' in text:
        text = '# {{name}}\n\n' + text[text.index('## 0 '):]
        text = text.split('\n## B ')[0]
    used = set()
    def replace(match):
        key = match.group(1).strip()
        used.add(key)
        if key == 'questions':
            return '%%QUESTION_REGISTER%%'
        return slots.get(key) if key in slots else missing(key)
    text = re.sub(r'\{\{([^{}]+)\}\}', replace, text)
    # Coverage cannot be removed by deleting layout slots.
    for key in SLOTS:
        if key not in used and key not in ('name', 'questions'):
            text += f'\n\n## {key}\n\n{slots[key]}'
    register = '\n'.join([f'- ASM-{i + 1:03}: {s}' for i, s in enumerate(data['assumptions'])] +
                         [f'- Q-{i + 1:03}: {s}' for i, s in enumerate(questions + data['open_questions'])])
    if '%%QUESTION_REGISTER%%' in text:
        text = text.replace('%%QUESTION_REGISTER%%', register)
    else:
        text += '\n\n## ' + t('假设与待确认项', 'Assumptions and questions') + '\n\n' + register
    return text + '\n'
