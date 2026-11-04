"""Seven-column source adapter. Labels classify controls; they do not infer scope."""
import copy
import hashlib
import re

from .control_rules import invalid, validate_config
from .domain import DomainError

HEADERS = ('source', 'control_identifier', 'security_domain', 'security_control_point',
           'control_requirement', 'assessment_procedure', 'label')
DOMAINS = {
    'GOVERNANCE': ('安全治理与制度', 'Security governance and policy'),
    'RISK_COMPLIANCE': ('风险评估与合规审查', 'Risk assessment and compliance'),
    'PERSONNEL': ('人员安全与培训', 'Personnel security and training'),
    'ASSET': ('资产与软件清单', 'Asset and software inventory'),
    'PHYSICAL': ('物理与环境安全', 'Physical and environmental security'),
    'NETWORK': ('网络通信与边界安全', 'Network and boundary security'),
    'IAM': ('身份认证与访问管理', 'Identity and access management'),
    'DATA': ('数据安全与生命周期', 'Data security and lifecycle'),
    'PRIVACY': ('个人信息与隐私保护', 'Personal information and privacy'),
    'CROSS_BORDER': ('数据本地化与跨境处理', 'Data localization and cross-border processing'),
    'CRYPTO': ('密码技术与密钥管理', 'Cryptography and key management'),
    'LOGGING': ('日志记录与审计', 'Logging and audit'),
    'MONITORING': ('安全监测与威胁防护', 'Security monitoring and threat protection'),
    'VULNERABILITY': ('漏洞与补丁管理', 'Vulnerability and patch management'),
    'PLATFORM': ('系统平台与运行完整性', 'Platform security and runtime integrity'),
    'DEVELOPMENT': ('安全设计开发与验收', 'Secure design, development and acceptance'),
    'CHANGE': ('配置变更与发布管理', 'Configuration, change and release management'),
    'SUPPLIER': ('供应商与供应链安全', 'Supplier and supply chain security'),
    'OPERATIONS': ('运维与作业管理', 'Maintenance and operations'),
    'MEDIA': ('介质保护与处置', 'Media protection and disposal'),
    'CONTINUITY': ('业务连续性与备份恢复', 'Business continuity, backup and recovery'),
    'INCIDENT': ('安全事件响应', 'Security incident response'),
}


def header(value):
    return re.sub(r'[\s_]+', '_', str(value or '').strip().lstrip('\ufeff')).lower()


def recognizes(book):
    return any('control_identifier' in [header(c.value) for c in sheet[1]] for sheet in book)


def parse(book, raw, current):
    from .control_library import validate_control
    from .control_workbooks import mlps_rule

    current = copy.deepcopy(current)
    cfg = current['config']
    known = {d['code'] for d in cfg['domains']}
    operations, errors, warnings, seen = [], [], [], set()
    original_codes = {c['control_code'] for c in current['controls']}
    file_hash = hashlib.sha256(raw).hexdigest()
    warnings.append({'zh': '规则导入草案：label 仅用于分类。非 MLPS 条目默认进入当前所有等级方案，未推断排除条件；请在发布前审查等级、对象和适用条件。',
                     'en': 'Rule-based import draft: labels classify controls only. Non-MLPS items default to all current level profiles without inferred exclusions. Review profiles, objects and conditions before publishing.'})
    for sheet in book:
        if not any(c.value is not None for row in sheet for c in row):
            continue
        headers = [header(c.value) for c in sheet[1]]
        if len(headers) != len(HEADERS) or set(headers) != set(HEADERS):
            errors.append({'sheet': sheet.title, 'row': 1, 'column': '*', 'code': 'LIBRARY_INVALID',
                           'detail': '需要七个不重复表头 / Expected exactly: ' + ', '.join(HEADERS)})
            continue
        columns = {name: i + 1 for i, name in enumerate(headers)}
        normalized_sources = 0
        for number in range(2, sheet.max_row + 1):
            fields = {name: '' if sheet.cell(number, col).value is None else str(sheet.cell(number, col).value)
                      for name, col in columns.items()}
            if not any(v.strip() for v in fields.values()):
                continue
            try:
                for name in ('source', 'control_identifier', 'security_domain', 'control_requirement', 'label'):
                    if not fields[name].strip():
                        invalid(name, '必填字段为空 / Required field is empty')
                source = fields['source'].strip()
                identifier = fields['control_identifier'].strip()
                label = fields['label'].strip()
                if label not in known:
                    if label not in DOMAINS:
                        invalid('label', '未知分类，请先配置双语控制域 / Unknown label; configure a bilingual domain first')
                    zh, en = DOMAINS[label]
                    cfg['domains'].append({'code': label, 'zh': zh, 'en': en})
                    known.add(label)
                # This workbook's agreed NIST source correction is bounded to its named sheet.
                if sheet.title.strip().casefold() == 'nist-sp800-53r5' and re.fullmatch(r'NIST-SP800-53r\d+', source, re.I):
                    normalized_sources += source != 'NIST-SP800-53r5'
                    source = 'NIST-SP800-53r5'
                mlps = re.fullmatch(r'MLPS[\s_-]*Level[\s_-]*([23])', source, re.I)
                level = int(mlps[1]) if mlps else None
                framework = 'MLPS' if mlps else source
                groups, basis = [], '规则导入草案：未推断排除条件 / Rule-based import draft: no exclusions inferred'
                if level:
                    clause = re.fullmatch(r'([78]\.1\.\d+\.\d+)\s*-\s*([a-zA-Z])\s*[)）]', identifier)
                    if not clause or not clause[1].startswith('7.' if level == 2 else '8.'):
                        invalid('control_identifier', 'MLPS 条款与来源等级不一致 / Invalid clause for source level')
                    groups, basis = mlps_rule(level, clause[1], clause[2].lower())
                    code = f'MLPS{level}-{clause[1]}-{clause[2].lower()}'
                    profiles = [p['code'] for p in cfg['profiles'] if p['level'] == f'L{level}']
                else:
                    stable = hashlib.sha256((framework.casefold() + '\0' + identifier).encode()).hexdigest()[:24]
                    prefix = re.sub(r'[^A-Za-z0-9_.-]', '-', framework).strip('-')[:30] or 'SOURCE'
                    code = f'{prefix}-{stable}'
                    profiles = [p['code'] for p in cfg['profiles']]
                if code in seen or code in original_codes:
                    invalid('control_identifier', '来源编号重复；修改请使用标准导出模板 / Duplicate source ID; use standard export for updates')
                seen.add(code)
                title = fields['security_control_point']
                if not title.strip() or title.strip().casefold() == 'n/a':
                    title = fields['security_domain']
                title = f'{title} — {identifier}'
                description = fields['control_requirement']
                lang = 'zh' if re.search(r'[\u4e00-\u9fff]', description + title) else 'en'
                verification = fields['assessment_procedure']
                if not verification.strip():
                    verification = '来源未提供评估方法，待补充。' if lang == 'zh' else 'Assessment procedure not supplied; review required.'
                item = {
                    'control_code': code, 'translations': {lang: {'title': title, 'description': description, 'verification': verification}},
                    'assessment_object': '待确认 / To be confirmed', 'domain_code': label,
                    'assessment_profiles': profiles, 'required': True, 'topic_tags': [],
                    'applicability_mode': 'conditional' if groups else 'always',
                    'rule': {'any': [{'all': g} for g in groups]} if groups else True,
                    'responsibility_rule': 'by_component', 'source_framework': framework,
                    'source_version': 'r5' if framework == 'NIST-SP800-53r5' else 'uploaded',
                    'source_ref': f'{sheet.title}!{sheet.cell(number, columns["control_requirement"]).coordinate}; {identifier}',
                    'source_level': level, 'review_status': 'draft', 'tagging_basis': basis,
                    'source': {'file_hash': file_hash, 'sheet': sheet.title, 'row': number,
                               'headers': {c.coordinate: c.value for c in sheet[1]}, 'fields': fields,
                               'cells': {c.coordinate: c.value for c in sheet[number] if c.value is not None}},
                }
                validate_control(item, cfg)
                operations.append({'operation': 'create', 'control': item})
            except DomainError as exc:
                errors.append({'sheet': sheet.title, 'row': number,
                               'column': exc.detail[0]['field'] if isinstance(exc.detail, list) else '*',
                               'code': exc.code, 'detail': exc.detail})
        if normalized_sources:
            warnings.append({'zh': f'{sheet.title}：{normalized_sources} 行 source 已按工作表统一为 NIST-SP800-53r5，原值保留在来源记录。',
                             'en': f'{sheet.title}: normalized {normalized_sources} source values to NIST-SP800-53r5; originals retained in provenance.'})
    validate_config(cfg)
    return current, operations, errors, warnings
