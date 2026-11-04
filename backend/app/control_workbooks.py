"""Bounded XLSX import/export for the application (no formula execution)."""
import copy
import hashlib
import io
import json
import re
import zipfile
from xml.etree.ElementTree import ParseError

from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.utils.exceptions import InvalidFileException
from defusedxml.common import DefusedXmlException

from .control_library import apply_operations
from .control_rules import DOMAIN_LABELS, invalid
from .domain import DomainError

MAX_BYTES = 10 * 1024 * 1024
COLUMNS = ['operation', 'control_code', 'control_id', 'expected_revision', 'title_zh', 'description_zh',
           'verification_zh', 'title_en', 'description_en', 'verification_en', 'assessment_object', 'domain_code',
           'assessment_profiles', 'required', 'topic_tags', 'applicability_mode', 'responsibility_rule',
           'source_framework', 'source_version', 'source_ref', 'source_level', 'control_family_id',
           'change_reason', 'clear_fields', 'review_status']
CONDITIONS = ['control_code', 'group_id', 'tag_code', 'operator', 'expected_value']
CLEARABLE = {'topic_tags', 'source_version', 'source_ref', 'source_level', 'control_family_id', 'translations.zh', 'translations.en'}


def safe_book(raw):
    if len(raw) > MAX_BYTES:
        raise DomainError('FILE_TOO_LARGE')
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            files = archive.infolist()
            if len(files) > 2000 or sum(f.file_size for f in files) > 80 * 1024 * 1024:
                raise DomainError('FILE_TOO_LARGE')
            if any('vbaProject' in f.filename or 'externalLinks/' in f.filename for f in files):
                invalid('workbook', 'Macros and external links are not supported')
        book = load_workbook(io.BytesIO(raw), read_only=False, data_only=False, keep_links=False)
        for sheet in book:
            if sheet.max_row > 10001 or sheet.max_column > 100:
                invalid(sheet.title, 'Worksheet exceeds supported dimensions')
            for row in sheet:
                for cell in row:
                    if cell.data_type == 'f':
                        invalid(f'{sheet.title}!{cell.coordinate}', 'Formula inputs are not supported')
        return book
    except (zipfile.BadZipFile, KeyError, ValueError, OSError, ParseError, InvalidFileException, DefusedXmlException) as exc:
        raise DomainError('INVALID_WORKBOOK') from exc


def value(cell):
    v = cell.value
    return '' if v is None else str(v).strip()


def read_table(sheet, columns):
    headers = [value(c) for c in sheet[1]]
    if len(set(headers)) != len(headers) or set(columns) != set(headers):
        invalid(f'{sheet.title}!1', 'Invalid or duplicate template columns')
    rows = []
    for number, cells in enumerate(sheet.iter_rows(min_row=2), 2):
        authored = {'title_zh', 'title_en', 'description_zh', 'description_en', 'verification_zh', 'verification_en', 'assessment_object', 'source_ref', 'change_reason', 'zh', 'en'}
        data = {headers[i]: str(c.value) if headers[i] in authored and c.value is not None else value(c) for i, c in enumerate(cells)}
        if any(data.values()):
            rows.append((number, data))
    return rows


def style(book):
    for sheet in book:
        sheet.freeze_panes = 'A2'
        sheet.auto_filter.ref = sheet.dimensions
        for cell in sheet[1]:
            cell.font = Font(color='FFFFFF', bold=True)
            cell.fill = PatternFill('solid', fgColor='215C50')
        for column in sheet.columns:
            sheet.column_dimensions[column[0].column_letter].width = 28
        for row in sheet:
            for cell in row:
                cell.alignment = Alignment(vertical='top', wrap_text=True)
                if isinstance(cell.value, str):
                    cell.data_type = 's'  # Literal strings, including formula-like authored text.


def export_book(current, include_controls=False):
    book = Workbook()
    ins = book.active
    ins.title = 'Instructions'
    for row in [
        ['key', 'value'], ['template_version', 'control-import-v1'], ['base_version', current['version']],
        ['help_zh', '仅编辑 Controls 和 Conditions。先上传预览，再合并草稿，审核后发布。空白可选值保持原值；清除用 clear_fields。'],
        ['help_en', 'Edit Controls and Conditions. Preview, apply to draft, review, then publish. Blank optional values preserve existing values; use clear_fields to clear.'],
        ['conditions', 'Rows in the same group use AND; groups use OR. expected_value is JSON: "yes", ["cloud"], or 240.'],
        ['update', 'Export supplies IDs and revisions. Updates require change_reason. Missing controls are not deleted.'],
    ]:
        ins.append(row)
    controls, conditions, dictionary = (book.create_sheet(n) for n in ('Controls', 'Conditions', 'Dictionary'))
    controls.append(COLUMNS)
    conditions.append(CONDITIONS)
    dictionary.append(['kind', 'code', 'zh', 'en', 'values'])
    ranges = {}
    for kind in ('domains', 'profiles', 'topics', 'questions'):
        start = dictionary.max_row + 1
        for d in current['config'][kind]:
            dictionary.append([kind, d['code'], d['zh'], d['en'], '|'.join(d.get('values', []))])
        ranges[kind] = (start, dictionary.max_row)
    if include_controls:
        for c in current['controls']:
            row = {**c, 'operation': 'retire' if c['retired'] else 'update', 'expected_revision': c['revision'],
                   'required': str(c['required']).lower()}
            for lang, fields in c['translations'].items():
                row.update({f'{k}_{lang}': v for k, v in fields.items()})
            for key in ('assessment_profiles', 'topic_tags'):
                row[key] = '|'.join(c[key])
            row['change_reason'] = 'Excel review / Excel 审核'
            controls.append([row.get(k, '') for k in COLUMNS])
            if c['rule'] is not True:
                for i, group in enumerate(c['rule']['any'], 1):
                    for atom in group['all']:
                        conditions.append([c['control_code'], str(i), atom['tag'], atom['op'], json.dumps(atom['value'], ensure_ascii=False)])
    for field, options in [('operation', 'create,update,retire'), ('required', 'true,false'),
                           ('applicability_mode', 'always,conditional'), ('review_status', 'draft,reviewed'),
                           ('responsibility_rule', 'customer,supplier,shared,by_component')]:
        validation = DataValidation(type='list', formula1=f'"{options}"', allow_blank=False)
        validation.errorTitle, validation.error, validation.showErrorMessage = 'Invalid value', 'Choose a listed value.', True
        controls.add_data_validation(validation)
        from openpyxl.utils import get_column_letter
        col = get_column_letter(COLUMNS.index(field) + 1)
        validation.add(f'{col}2:{col}10001')
    for sheet, col, kind in ((controls, 'L', 'domains'), (conditions, 'C', 'questions')):
        start, end = ranges[kind]
        validation = DataValidation(type='list', formula1=f"'Dictionary'!$B${start}:$B${end}", allow_blank=False)
        validation.showErrorMessage = True
        sheet.add_data_validation(validation)
        validation.add(f'{col}2:{col}10001')
    style(book)
    output = io.BytesIO()
    book.save(output)
    return output.getvalue()


def parse_standard(book, current):
    if set(book.sheetnames) != {'Instructions', 'Controls', 'Conditions', 'Dictionary'}:
        invalid('workbook', 'Expected the four standard template worksheets')
    info = {value(r[0]): value(r[1]) for r in book['Instructions'].iter_rows(min_row=2) if len(r) >= 2}
    if info.get('template_version') != 'control-import-v1':
        invalid('Instructions', 'Unsupported template version')
    if info.get('base_version') != str(current['version']):
        raise DomainError('VERSION_CONFLICT', 409)
    supplied_dictionary = [r for _, r in read_table(book['Dictionary'], ['kind', 'code', 'zh', 'en', 'values'])]
    expected_dictionary = [{'kind': kind, 'code': d['code'], 'zh': d['zh'], 'en': d['en'], 'values': '|'.join(d.get('values', []))}
                           for kind in ('domains', 'profiles', 'topics', 'questions') for d in current['config'][kind]]
    if supplied_dictionary != expected_dictionary:
        invalid('Dictionary', 'Dictionary changed or is stale; download a current template')
    condition_rows = read_table(book['Conditions'], CONDITIONS)
    groups = {}
    for n, r in condition_rows:
        try:
            val = json.loads(r['expected_value'])
        except ValueError:
            invalid(f'Conditions!E{n}', 'Use a JSON value such as "yes" or ["cloud"]')
        if not r['group_id']:
            invalid(f'Conditions!B{n}', 'Group ID is required')
        groups.setdefault(r['control_code'], {}).setdefault(r['group_id'], []).append({'tag': r['tag_code'], 'op': r['operator'], 'value': val})
    old_by_code = {c['control_code']: c for c in current['controls']}
    operations, errors, seen = [], [], set()
    for n, r in read_table(book['Controls'], COLUMNS):
        try:
            if r['control_code'] in seen:
                invalid('control_code', 'Duplicate control operation')
            seen.add(r['control_code'])
            old = old_by_code.get(r['control_code'])
            item = copy.deepcopy(old) if r['operation'] in ('update', 'retire') and old else {}
            item.update({'control_code': r['control_code'], 'control_id': r['control_id'], 'change_reason': r['change_reason']})
            if r['expected_revision']:
                try:
                    item['revision'] = int(r['expected_revision'])
                except ValueError:
                    invalid('expected_revision', 'Expected an integer revision')
            elif r['operation'] != 'create':
                invalid('expected_revision', 'Revision required for updates')
            if r['operation'] != 'retire':
                for field in ('assessment_object', 'domain_code', 'assessment_profiles', 'required', 'applicability_mode', 'responsibility_rule', 'review_status'):
                    if not r[field]:
                        invalid(field, 'Required field is empty')
                for field in ('assessment_object', 'domain_code', 'applicability_mode', 'responsibility_rule', 'source_framework', 'source_version', 'source_ref', 'control_family_id', 'review_status'):
                    if r[field] or not old:
                        item[field] = r[field]
                for field in ('assessment_profiles', 'topic_tags'):
                    if r[field] or not old:
                        item[field] = list(filter(None, r[field].split('|')))
                if r['required'] not in ('true', 'false'):
                    invalid('required', 'Expected true or false')
                item['required'] = r['required'] == 'true'
                if r['source_level']:
                    if r['source_level'] not in ('2', '3'):
                        invalid('source_level', 'Expected 2 or 3')
                    item['source_level'] = int(r['source_level'])
                translations = item.setdefault('translations', {})
                if not any(all(r[f'{k}_{lang}'] for k in ('title', 'description', 'verification')) for lang in ('zh', 'en')):
                    invalid('translations', 'Supply one complete language')
                for lang in ('zh', 'en'):
                    fields = {k: r[f'{k}_{lang}'] for k in ('title', 'description', 'verification')}
                    if any(fields.values()):
                        translations[lang] = {**translations.get(lang, {}), **{k: v for k, v in fields.items() if v}}
                for field in filter(None, r['clear_fields'].split('|')):
                    if field not in CLEARABLE:
                        invalid('clear_fields', 'Field cannot be cleared')
                    if field.startswith('translations.'):
                        lang = field.split('.')[1]
                        if any(r[f'{k}_{lang}'] for k in ('title', 'description', 'verification')):
                            invalid('clear_fields', 'Cannot clear a supplied translation')
                        translations.pop(lang, None)
                    else:
                        if r[field]:
                            invalid('clear_fields', 'Cannot clear a supplied field')
                        item[field] = [] if field == 'topic_tags' else None if field == 'source_level' else ''
                if r['applicability_mode'] == 'always':
                    if r['control_code'] in groups:
                        invalid('applicability_mode', 'Always must have no condition rows')
                    item['rule'] = True
                else:
                    item['rule'] = {'any': [{'all': atoms} for atoms in groups.get(r['control_code'], {}).values()]}
            operation = {'operation': r['operation'], 'control': item}
            apply_operations(current, [operation])
            operations.append(operation)
        except DomainError as exc:
            errors.append({'sheet': 'Controls', 'row': n, 'column': (exc.detail or [{}])[0].get('field', '*') if isinstance(exc.detail, list) else '*', 'code': exc.code, 'detail': exc.detail})
    if set(groups) - {o['control']['control_code'] for o in operations}:
        errors.append({'sheet': 'Conditions', 'row': 1, 'column': 'control_code', 'code': 'ORPHAN_CONDITIONS'})
    return operations, errors


def atom(tag, val='yes', op='eq'):
    return {'tag': tag, 'op': op, 'value': val}


def mlps_rule(level, clause, sub):
    prefix = '7' if level == 2 else '8'
    suffix = clause.removeprefix(prefix + '.1.')
    if (suffix, sub) in {('4.1', 'c'), ('10.6', 'i')}:
        return [[atom('ops.remote_admin')]], 'remote management / 远程管理'
    if suffix == ('4.10' if level == 2 else '4.11'):
        return [[atom('data.personal')]], 'personal information / 个人信息'
    if suffix == '9.4':
        return [[atom('delivery.models', ['in_house'], 'in')]], 'in-house development / 自行开发'
    if suffix == '9.5':
        return [[atom('delivery.models', ['outsourced'], 'in')]], 'outsourced development / 外包开发'
    if suffix == '10.14':
        return [[atom('ops.outsourced')]], 'outsourced operations / 外包运维'
    if level == 3 and (suffix, sub) == ('3.4', 'b'):
        return [[atom('app.mail_processing')]], 'mail processing / 邮件处理'
    if level == 3 and (suffix, sub) == ('3.5', 'd'):
        return [[atom(t)] for t in ('net.remote_users', 'ops.remote_admin', 'net.internet_egress')], 'remote users or outbound internet / 远程用户或互联网访问'
    if (suffix, sub) == ('3.1', 'a') or suffix == '3.2':
        return [[atom(t)] for t in ('net.public_ingress', 'net.internet_egress', 'net.partner_link', 'net.cross_zone')], 'network boundaries / 网络边界'
    return [], 'Retained for review; no narrowing inferred / 保留评估，未推断排除条件'


def mlps_sheets(book):
    sheets = []
    for name in book.sheetnames:
        match = re.fullmatch(r'mlps[\s_-]*level[\s_-]*([23])', name.strip(), re.IGNORECASE)
        if match:
            sheets.append((name, int(match[1])))
    if not sheets:
        invalid('workbook', '未找到 MLPS 工作表。请将工作表命名为 MLPS Level 2 或 MLPS Level 3；可单独上传。 / Name a worksheet MLPS Level 2 or MLPS Level 3; either may be uploaded alone.')
    if len({level for _, level in sheets}) != len(sheets):
        invalid('workbook', '同一来源等级存在重复工作表 / Duplicate MLPS source level worksheets')
    return sheets


def parse_mlps(book, raw):
    operations = []
    aliases = {
        'security_domain': 'Security Domain', 'security_control_point': 'Security Control Point',
        'clause_number': 'Number', 'subitem_number': 'Serial Number',
        'control_requirement': 'Evaluation Item', 'assessment_object': 'Assessment Object',
        'assessment_procedure': 'Assessment Implementation', 'assessment_method': '测评方法',
        'risk_level': 'Risk Level', 'is_high_risk': 'High Risk?',
    }
    def normalize(text):
        return re.sub(r'[\s_]+', ' ', text.strip().lstrip('\ufeff')).casefold()
    names = {normalize(k): v for k, v in aliases.items()}
    names.update({normalize(v): v for v in aliases.values()})
    for sheet_name, level in mlps_sheets(book):
        sheet = book[sheet_name]
        headers = {}
        for cell in sheet[1]:
            raw_header = value(cell)
            if not raw_header:
                continue
            key = names.get(normalize(raw_header), raw_header)
            if key in headers:
                invalid(sheet_name, '重复或含义重复的表头 / Duplicate header: ' + key)
            headers[key] = cell.column
        required = ['Security Domain', 'Security Control Point', 'Number', 'Serial Number', 'Evaluation Item', 'Assessment Object', 'Assessment Implementation']
        missing = [k for k in required if k not in headers]
        if missing:
            invalid(sheet_name, '请将表头放在第一行；支持原始和统一命名。缺少字段 / Put headers in row 1; missing fields: ' + ', '.join(missing))
        for n in range(2, sheet.max_row + 1):
            def read(key):
                return value(sheet.cell(n, headers[key]))
            if not read('Evaluation Item'):
                continue
            if 'source_level' in headers and read('source_level') not in ('', str(level)):
                invalid(f'{sheet_name}!{sheet.cell(n, headers["source_level"]).coordinate}', 'source_level 与工作表等级不一致 / Source level conflicts with worksheet')
            clause, sub = read('Number').strip(), re.sub(r'[^a-zA-Z0-9]', '', read('Serial Number')).lower()
            domain = next((code for code, zh, _ in DOMAIN_LABELS if zh in read('Security Domain')), None)
            if domain is None or not re.fullmatch(r'[78]\.1\.\d+\.\d+', clause) or not sub:
                invalid(f'{sheet_name}!C{n}', 'Unrecognized clause or domain')
            if not clause.startswith('7.' if level == 2 else '8.'):
                invalid(f'{sheet_name}!C{n}', '条款编号与工作表等级不一致 / Clause does not match worksheet source level')
            groups, basis = mlps_rule(level, clause, sub)
            locations = ','.join(sheet.cell(n, headers[k]).coordinate for k in ('Evaluation Item', 'Assessment Object', 'Assessment Implementation'))
            source_ref = f'{sheet_name}!{locations}; {clause}({sub})'
            item = {
                'control_code': f'MLPS{level}-{clause}-{sub}', 'translations': {'zh': {
                    'title': read('Security Control Point') + f' {clause}({sub})',
                    'description': read('Evaluation Item'), 'verification': read('Assessment Implementation')}},
                'assessment_object': read('Assessment Object'), 'domain_code': domain,
                'assessment_profiles': [f'MLPS{level}_REFERENCE'], 'required': True, 'topic_tags': [domain.lower()],
                'applicability_mode': 'conditional' if groups else 'always',
                'rule': {'any': [{'all': g} for g in groups]} if groups else True,
                'responsibility_rule': 'by_component', 'source_framework': 'MLPS', 'source_version': 'uploaded',
                'source_ref': source_ref, 'source_level': level, 'review_status': 'draft',
                'tagging_basis': basis, 'source': {'file_hash': hashlib.sha256(raw).hexdigest(), 'sheet': sheet_name,
                    'row': n, 'clause': clause, 'subitem': sub,
                    'headers': {c.coordinate: c.value for c in sheet[1] if c.value is not None},
                    'fields': {key: read(key) for key in headers},
                    'cells': {c.coordinate: c.value for c in sheet[n] if c.value is not None}},
            }
            if 'applicability_rule' in headers:
                try:
                    item['rule'] = json.loads(read('applicability_rule'))
                except ValueError:
                    invalid(f'{sheet_name}!S{n}', 'Invalid applicability rule JSON')
                for field in ('applicability_mode', 'review_status', 'rule_version', 'tagging_basis', 'control_family_id'):
                    if field in headers and field != 'rule_version':
                        item[field] = read(field)
                for field in ('assessment_profiles', 'topic_tags'):
                    if field in headers:
                        item[field] = list(filter(None, read(field).split('|')))
                if 'responsibility_rule' in headers:
                    item['responsibility_rule'] = read('responsibility_rule')
            operations.append({'operation': 'create', 'control': item})
    return operations, []


def annotated_mlps(raw, changes, config):
    """Preserve source worksheets and append reviewable mapping columns."""
    book = safe_book(raw)
    columns = ['control_id', 'source_level', 'control_family_id', 'assessment_profiles', 'topic_tags',
               'public_access_relevance', 'question_ids', 'applicability_mode', 'applicability_rule',
               'rule_description_zh', 'rule_description_en', 'responsibility_rule', 'tagging_basis',
               'review_status', 'rule_version']
    from .control_rules import refs
    positions = {}
    for name, _ in mlps_sheets(book):
        sheet = book[name]
        existing = {value(c): c.column for c in sheet[1] if value(c)}
        positions[name] = {}
        for header in columns:
            col = existing.get(header) or sheet.max_column + 1
            positions[name][header] = col
            cell = sheet.cell(1, col, header)
            cell.font = Font(color='FFFFFF', bold=True)
            cell.fill = PatternFill('solid', fgColor='215C50')
            sheet.column_dimensions[cell.column_letter].width = 28
    for change in changes:
        c = change['after']
        source = c.get('source', {})
        if source.get('sheet') not in positions:
            continue
        sheet, n = book[source['sheet']], source['row']
        values = [c['control_code'], c['source_level'], c.get('control_family_id', ''), '|'.join(c['assessment_profiles']),
                  '|'.join(c['topic_tags']), '待审核 / Review required', '|'.join(sorted(refs(c['rule']))),
                  c['applicability_mode'], json.dumps(c['rule'], ensure_ascii=False), c['tagging_basis'], c['tagging_basis'],
                  c['responsibility_rule'], c['tagging_basis'], c['review_status'], config['schema_version']]
        for header, v in zip(columns, values):
            col = positions[source['sheet']][header]
            cell = sheet.cell(n, col, v)
            cell.alignment = Alignment(wrap_text=True, vertical='top')
            if isinstance(v, str):
                cell.data_type = 's'
    name = '标签字典与说明'
    if name in book:
        del book[name]
    sheet = book.create_sheet(name)
    sheet.append(['代码 / Code', '中文', 'English', '值域 / Values'])
    for q in config['questions']:
        sheet.append([q['code'], q['zh'], q['en'], '|'.join(q['values'])])
    sheet.append(['review', '规则为草案；审核后方可发布。无公网不代表无内部边界控制。', 'Rules are drafts. Review before publishing. Internal boundaries may still apply without public access.', ''])
    for col in ('A', 'B', 'C', 'D'):
        sheet.column_dimensions[col].width = 40
    sheet.freeze_panes = 'A2'
    output = io.BytesIO()
    book.save(output)
    book.close()
    return output.getvalue()


def preview(raw, current):
    book = safe_book(raw)
    try:
        from . import labeled_controls
        warnings = []
        if labeled_controls.recognizes(book):
            current, operations, errors, warnings = labeled_controls.parse(book, raw, current)
            source_format = 'labeled'
        elif 'Controls' in book:
            operations, errors = parse_standard(book, current)
            source_format = 'standard'
        else:
            operations, errors = parse_mlps(book, raw)
            source_format = 'mlps'
        if not operations and not errors:
            invalid('workbook', 'No control operations')
        if errors:
            return {'errors': errors, 'changes': [], 'data': None, 'warnings': warnings}
        data, changes = apply_operations(current, operations)
        return {'errors': [], 'changes': changes, 'data': data, 'source_format': source_format, 'warnings': warnings}
    finally:
        book.close()
