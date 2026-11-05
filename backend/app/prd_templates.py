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
         'questions', 'review', 'ai_scope', 'questionnaire_facts', 'acceptance_criteria', 'network_topology']
GROUP_SLOTS = [f'{key}_questions' for key in ('scope', 'roles', 'workflow', 'functions', 'data', 'security', 'acceptance', 'release')]
LAYOUT_V3 = '<!-- syseval:prd-layout-v3 -->'


def snapshot(db, org_id):
    row = db.get(AISettings, org_id)
    template = (row.data.get('prd_template') if row and row.data.get('prd_template_generation') == 2 else
                {'filename': 'System_Assessment_PRD_v3.md', 'content': DEFAULT.read_text(encoding='utf-8')})
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
        return {**snapshot(db, user.org_id), 'slots': SLOTS + GROUP_SLOTS + ['document_title', 'document_status', 'security_details']}

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
    compact = LAYOUT_V3 in pinned['template']['content']
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
        return ctx.get(key) or ''
    from .mlps_intake import QUESTIONS, visible
    import json
    headings = json.loads((DEFAULT.parent.parent / 'data/prd_fact_headings.json').read_text(encoding='utf-8'))
    answers = source.get('classification', {}).get('answers', {})
    groups = {key: [] for key in ('scope', 'roles', 'workflow', 'functions', 'data', 'security', 'acceptance', 'release')}
    def category(key):
        if key in ('system_owner', 'org_name', 'security_responsible_entity', 'user_types'):
            return 'roles'
        if key in ('system_scenarios', 'involves_transactions', 'available_workaround'):
            return 'workflow'
        if key == 'system_functions':
            return 'functions'
        if key == 'deployment_model':
            return 'security'
        if key in ('recovery_objectives_h', 'impact_after_4h', 'impact_after_24h', 'impact_after_72h'):
            return 'acceptance'
        if key in ('system_name', 'system_purpose', 'system_business_type', 'target_type',
                   'independent_business', 'service_geography', 'public_service_nature', 'critical_business'):
            return 'scope'
        if key in ('system_interaction', 'system_interfaces_description', 'external_connections_description',
                   'system_dependencies') or key.startswith(('data_', 'personal_', 'sensitive_', 'important_', 'core_', 'pi_', 'cross_border', 'registered_')):
            return 'data'
        return 'security'
    def answer_text(answer, question):
        if answer is None:
            return ''
        if isinstance(answer, list):
            return ' / '.join(answer_text(item, question) for item in answer)
        if isinstance(answer, dict):
            if compact and question['kind'] == 'volume_ranges':
                values = []
                for key, group in question.get('range_groups', {}).items():
                    raw = answer.get(key)
                    if raw is not None:
                        label = group['zh' if zh else 'en'][group['values'].index(raw)] if raw in group['values'] else str(raw)
                        values.append(f"{t('业务记录数量', 'Business records') if key == 'records' else t('数据容量', 'Storage')}: {label}")
                return '\n\n'.join(values)
            if compact and question['kind'] == 'recovery_targets':
                return '\n\n'.join(f"{key.upper()}: {answer[key]} {t('小时', 'hours')}" for key in ('rto', 'rpo') if answer.get(key) is not None)
            return json.dumps(answer, ensure_ascii=False)
        if answer in question.get('options', []):
            return question.get('options_zh' if zh else 'options_en', question['options'])[question['options'].index(answer)]
        return str(answer)
    for question in QUESTIONS:
        key = question['key']
        if key in ('system_interaction', 'independent_business', 'public_service_nature', 'system_functions', 'interconnected_system_level', 'external_dependency_impact', 'safety_impact') or question['kind'] == 'severity' or not visible(question, answers):
            continue
        if question['kind'] == 'severity' and answers.get(key) == 0:
            continue
        rendered = answer_text(answers.get(key), question)
        note = source.get('classification', {}).get('notes', {}).get(key, '')
        if note:
            rendered += (' / ' if rendered else '') + str(note)
        if key == 'security_responsible_entity':
            rendered = str(note) if answers.get(key) == '是' else ''
        if key == 'system_owner':
            contacts = source.get('classification', {}).get('department_contacts', {})
            selected = answers.get(key, [])
            contact_labels = [('name', '人员姓名', 'Person name'), ('organization', '所属部门/公司（外包）', 'Department / company (outsourced)'),
                              ('title', '职务/职称', 'Position / title'), ('scope', '负责范围', 'Responsibilities'), ('contact_method', '联系方法', 'Contact method')]
            for department, contact in contacts.items():
                if department not in selected or not contact:
                    continue
                text = contact if isinstance(contact, str) else ' / '.join(
                    f'{cn if zh else en}: {contact[key]}' for key, cn, en in contact_labels if contact.get(key))
                rendered += f'\n\n- **{department}**：{text}' if compact else f' / {department}: {text}'
        title = headings.get(key, ['', ''])[0 if zh else 1]
        groups[category(key)].append(f"<!-- questionnaire:{question['id']} classification.answers.{key} -->\n" +
                                     f"{'###' if compact else '####'} {title}\n\n{rendered or (t('待补充', 'To complete') if compact else '')}")
    def table(rows):
        return '\n\n'.join(rows)
    questionnaire_facts = '\n\n'.join(table(rows) for rows in groups.values() if rows)
    controls = {c['id']: c for c in source['controls']}
    def control_fields(control):
        original = control.get('metadata', {}).get('source', {})
        languages = original.get('languages', {})
        return (languages.get(language) or languages.get('zh') or languages.get('en') or {}).get('fields', {}) or original.get('fields', {})

    def security_content():
        # Group each source control independently, including multi-domain requirements.
        grouped = {}
        included = {cid for r in data['requirements'] for cid in r['source_control_ids']}
        for cid, control in controls.items():
            if cid not in included:
                continue
            fields = control_fields(control)
            domain = fields.get('security_domain') or control.get('domain') or t('其他', 'Other')
            translations = control.get('translations', {})
            translation = translations.get(language) or next(iter(translations.values()), {})
            content = fields.get('control_requirement') or translation.get('description') or next(
                r['description'] for r in data['requirements'] if cid in r['source_control_ids'])
            grouped.setdefault(domain, []).append('- ' + content.replace('\n', '\n  '))
        return '\n\n'.join('### ' + domain + '\n\n' + '\n\n'.join(rows) for domain, rows in grouped.items()) or t('无已纳入的安全控制。', 'No included security controls.')

    def requirements(security):
        if compact and security:
            return security_content()
        lines = []
        rows = data['requirements']
        def domains(requirement):
            return ' / '.join(sorted({str(controls[c].get('metadata', {}).get('source', {}).get('languages', {}).get('zh', {}).get('fields', {}).get('security_domain') or controls[c].get('domain') or t('其他', 'Other')) for c in requirement['source_control_ids']}))
        if security:
            rows = sorted(rows, key=domains)
        previous_domain = None
        for r in rows:
            if bool(r['source_control_ids']) != security:
                continue
            if security and domains(r) != previous_domain:
                previous_domain = domains(r)
                lines += ['### ' + previous_domain, '']
            refs = [controls[c]['code'] + ' [' + c + ']' for c in r['source_control_ids']]
            if compact:
                lines += [f"### {r['id']} · {r['title']}", '']
                if r['description'].strip() != r['title'].strip():
                    lines += [r['description'], '']
                lines += [t('优先级', 'Priority') + ': ' + {'must': t('必须', 'Must'), 'should': t('应当', 'Should'), 'could': t('可选', 'Could')}.get(r['priority'], r['priority']), '']
                if r['dependencies']:
                    lines += [t('依赖', 'Dependencies') + ': ' + ', '.join(r['dependencies']), '']
                continue
            lines += [f"{'####' if security else '###'} {r['id']} · {r['title']}", '', r['description'], '',
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
                              *( [t('测评步骤', 'Assessment procedure') + ': ' + original['fields']['assessment_procedure']] if original['fields'].get('assessment_procedure') else []),
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
    slots = {'questionnaire_facts': questionnaire_facts, 'name': source['name'], 'document_info': '\n\n'.join([
        t('状态：待评审；不代表已批准或已验收。', 'Status: awaiting review; not approved or accepted.'),
        t('生成方式：', 'Generation mode: ') + {'local': t('本地规则草稿，需人工细化', 'Local rule-based draft; needs refinement'),
            'openrouter': t('模型生成草稿，需人工评审', 'Model-generated draft; needs review')}.get(source.get('generation_mode'), t('人工修订', 'Manual revision')),
        f"Revision: {source['revision']} · Context: {source['context_revision_id']}",
        f"Level: {source['classification']['effective_level']} · Catalog: {source['classification'].get('catalog_id', '')}",
        f"Template: {pinned['version']} · SHA-256: {pinned['hash']}"]),
        'summary': data['summary'], 'roles': '',
        'scope': value('scope', 'Scope'), 'workflow': value('workflow', 'Workflow and business object states'),
        'business_requirements': requirements(False), 'security_requirements': requirements(True),
        'interaction': '',
        'data_and_integrations': value('data_notes', 'Data requirements') + '\n\n' + value('integrations', 'Integration contracts'),
        'traceability': '\n'.join(trace), 'constraints': value('constraints', 'Delivery and release constraints'),
        'ai_scope': '',
        'review': t('业务功能和已纳入控制覆盖校验已通过。可测性、权限异常、上线条件及待确认项仍需人工评审。',
                    'Business function and included-control coverage validated. Measurability, permission failures, release conditions and open questions need human review.')}
    from .topology import markdown as topology_markdown
    slots['network_topology'] = topology_markdown(source.get('network_topology', []), language)
    slots['acceptance_criteria'] = '\n'.join(
        f"- AC-{r['id']}-{i + 1}: {criterion}"
        for r in data['requirements'] for i, criterion in enumerate(r['acceptance_criteria']))
    slots.update({f'{key}_questions': table(rows) for key, rows in groups.items()})
    if compact:
        slots['document_title'] = data.get('title') or source['name']
        slots['document_status'] = '\n\n'.join(slots['document_info'].split('\n\n')[:2]) + '\n\n' + t('评估等级：', 'Assessment level: ') + str(source['classification']['effective_level'])
        # Keep project-specific prose and stable mappings outside the control-only chapter.
        details = []
        for r in data['requirements']:
            if not r['source_control_ids']:
                continue
            details += [f"### {r['id']} · {r['title']}", '', r['description'], '',
                        t('优先级', 'Priority') + ': ' + r['priority'], '']
            if r['dependencies']:
                details += [t('依赖', 'Dependencies') + ': ' + ', '.join(r['dependencies']), '']
        slots['security_details'] = '\n'.join(details)
        slots['acceptance_criteria'] = '\n\n'.join(
            f"### {r['id']} · {r['title']}\n\n" + '\n'.join(
                f"- AC-{r['id']}-{i + 1}: {criterion}" for i, criterion in enumerate(r['acceptance_criteria']))
            for r in data['requirements'])
        headers = [t('需求', 'Requirement'), t('业务来源', 'Business source'), t('控制来源', 'Control source'), t('验收编号', 'Acceptance')]
        trace[0] = '| ' + ' | '.join(headers) + ' |'
        slots['traceability'] = '\n'.join(trace)
        provenance = [t('### 控制来源记录', '### Control source records'), '',
                      '| ' + ' | '.join([t('控制', 'Control'), t('来源 ID', 'Source ID'), t('来源文件 / 行 / 条款', 'File / row / clause')]) + ' |', '|---|---|---|']
        for control in controls.values():
            metadata = control.get('metadata', {})
            original = metadata.get('source', {})
            languages = original.get('languages', {})
            original = languages.get(language) or languages.get('zh') or languages.get('en') or original
            location = ' · '.join(str(item) for item in [original.get('filename'), original.get('row'), metadata.get('source_ref')] if item is not None)
            provenance.append('| ' + ' | '.join(map(cell, [control['code'], control['id'], location])) + ' |')
        slots['traceability'] += '\n\n' + '\n'.join(provenance)
        if not slots['constraints']:
            slots['constraints'] = t('待补充：交付物、负责人、计划时间、上线条件及回退安排。', 'To complete: deliverables, owners, dates, release criteria and rollback arrangements.')
        if not slots['acceptance_questions']:
            slots['acceptance_questions'] = t('待补充：服务时段、可用性目标、故障响应时间、RTO 与 RPO。', 'To complete: service hours, availability targets, incident response time, RTO and RPO.')
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
        if compact and not slots.get(key):
            continue
        if key not in used and key not in ('name', 'questions', 'summary', 'scope', 'workflow', 'data_and_integrations', 'network_topology') and not (
                key == 'questionnaire_facts' and all(f'{group}_questions' in used for group in groups)):
            text += f'\n\n## {key}\n\n{slots[key]}'
    if compact and 'security_details' not in used and slots['security_details']:
        text += '\n\n## ' + t('安全需求实施说明', 'Security implementation requirements') + '\n\n' + slots['security_details']
    if 'network_topology' not in used and slots['network_topology']:
        architecture = re.search(r'^## [^\n]*(?:系统开发架构|System development architecture)[^\n]*\n', text, re.MULTILINE | re.IGNORECASE)
        if architecture:
            following = re.search(r'^## ', text[architecture.end():], re.MULTILINE)
            index = architecture.end() + following.start() if following else len(text)
            text = text[:index] + '\n' + slots['network_topology'] + '\n\n' + text[index:]
        else:
            text += '\n\n## ' + t('系统开发架构', 'System development architecture') + '\n\n' + slots['network_topology']
    register = '\n'.join([f'- ASM-{i + 1:03}: {s}' for i, s in enumerate(data['assumptions'])] +
                         [f'- Q-{i + 1:03}: {s}' for i, s in enumerate(questions + data['open_questions'])])
    if compact and not register:
        register = t('暂无已登记事项。', 'No items recorded.')
    if '%%QUESTION_REGISTER%%' in text:
        text = text.replace('%%QUESTION_REGISTER%%', register)
    else:
        text += '\n\n## ' + t('假设与待确认项', 'Assumptions and questions') + '\n\n' + register
    return text + '\n'
