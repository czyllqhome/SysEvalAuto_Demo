"""Versioned configuration and deterministic three-valued control rules."""
import copy
import math
import re

from .domain import DomainError, digest

PROFILES = {'INTERNAL_BASIC': 'L1', 'MLPS2_REFERENCE': 'L2', 'MLPS3_REFERENCE': 'L3'}
DOMAIN_LABELS = [
    ('PHYSICAL', '安全物理环境', 'Physical environment'),
    ('NETWORK', '安全通信网络', 'Communication networks'),
    ('BOUNDARY', '安全区域边界', 'Network boundaries'),
    ('COMPUTING', '安全计算环境', 'Computing environment'),
    ('CENTER', '安全管理中心', 'Security management center'),
    ('POLICY', '安全管理制度', 'Security policies'),
    ('ORGANIZATION', '安全管理机构', 'Security organization'),
    ('PERSONNEL', '安全管理人员', 'Personnel security'),
    ('CONSTRUCTION', '安全建设管理', 'Secure development'),
    ('OPERATIONS', '安全运维管理', 'Secure operations'),
]


def default_config():
    questions = []

    def add(code, group, zh, en, values=None, kind='enum', risk=False):
        questions.append({'code': code, 'group': group, 'zh': zh, 'en': en, 'kind': kind,
                          'values': values or ['yes', 'no', 'unknown'], 'risk': risk, 'when': True})

    for code, zh, en in [
        ('net.public_ingress', '是否有公网可达入口（包括认证或白名单入口）？', 'Is any entry point reachable over the public internet, including authenticated or allowlisted access?'),
        ('net.public_business', '是否提供公网业务或 API 访问？公开静态资料除外。', 'Are business functions or APIs internet-accessible, beyond public static information?'),
        ('net.public_admin', '是否有公网管理入口？', 'Is an administration entry point internet-accessible?'),
        ('net.internet_egress', '系统或使用终端是否主动访问互联网？', 'Does the system or its terminals access the internet?'),
        ('net.partner_link', '是否与合作方或其他外部网络互联？', 'Is there connectivity to partner or other external networks?'),
        ('net.cross_zone', '是否跨内部网络区域通信？', 'Does traffic cross internal network zones?'),
        ('net.wireless', '是否使用或管理无线接入？', 'Is wireless access used or managed?'),
        ('ops.remote_admin', '是否通过网络远程管理（含内网、VPN）？', 'Is remote administration used, including internal networks and VPNs?'),
        ('net.remote_users', '是否存在远程业务用户访问？', 'Do remote users access business functions?'),
    ]:
        add(code, 'network', zh, en, risk=code in {'net.public_business', 'net.partner_link'})
    for code, zh, en in [
        ('data.personal', '是否处理个人信息（含用户账号和联系人）？', 'Is personal information processed, including accounts and contacts?'),
        ('data.sensitive', '是否处理敏感数据？', 'Is sensitive data processed?'),
        ('data.important', '是否涉及重要业务、鉴别、审计或配置数据？', 'Are important business, authentication, audit or configuration data involved?'),
        ('data.important_stored', '是否存储重要数据？', 'Is important data stored?'),
        ('data.important_transmitted', '是否传输重要数据？', 'Is important data transmitted?'),
        ('identity.user_accounts', '是否有用户或管理员账号？', 'Are there user or administrator accounts?'),
        ('identity.service_accounts', '系统是否使用供程序或系统调用的专用身份或访问凭据？', 'Does the system use dedicated identities or access credentials for applications or system-to-system calls?'),
        ('party.external_users', '是否有外部人员访问？', 'Do external personnel have access?'),
        ('ops.production_admin', '是否能够执行生产管理操作？', 'Can the system perform production administration?'),
    ]:
        add(code, 'data', zh, en, risk=code == 'data.personal')
    add('risk.data_impact', 'data', '数据泄露或篡改的影响？', 'Impact of data disclosure or tampering?', ['low', 'business', 'severe', 'unknown'], risk=True)
    add('risk.privilege_impact', 'data', '账号或程序权限被误用时，可能影响哪些数据或业务？', 'What data or business operations could be affected if account or application permissions were misused?', ['bounded', 'business', 'severe', 'unknown'], risk=True)
    add('risk.business_impact', 'business', '业务中断的影响？', 'Impact of an outage?', ['limited', 'business', 'severe', 'unknown'], risk=True)
    add('risk.outage_minutes', 'business', '最长可接受中断时间（分钟，0 表示不能中断）', 'Maximum tolerable outage in minutes (0 means no interruption)', kind='number', risk=True)
    add('biz.manual_fallback', 'business', '是否有可行的人工替代流程？', 'Is a workable manual fallback available?', risk=True)
    add('risk.dependency_scope', 'business', '业务依赖范围？', 'Operational dependency scope?', ['team', 'multiple', 'customers', 'unknown'], risk=True)
    add('hosting.models', 'network', '部署方式（可多选）', 'Hosting models (select all)', ['own_dc', 'vendor_dc', 'cloud', 'saas', 'unknown'], 'multi')
    add('responsibility.layers', 'network', '各层责任（可多选）', 'Responsibility by layer (select all)', ['customer_facility', 'supplier_facility', 'customer_network', 'supplier_network', 'customer_host', 'supplier_host', 'customer_app', 'supplier_app', 'unknown'], 'multi')
    add('delivery.models', 'operations', '软件交付方式（可多选）', 'Delivery models (select all)', ['in_house', 'outsourced', 'purchased', 'unknown'], 'multi')
    for code, zh, en in [
        ('ops.outsourced', '是否外包运维？', 'Are operations outsourced?'),
        ('party.vendor_access', '供应商是否访问系统？', 'Do suppliers access the system?'),
        ('app.mail_processing', '是否处理或转发邮件？', 'Does the system process or relay email?'),
        ('asset.media_lifecycle', '是否涉及存储介质或设备转移、复用、报废？', 'Are storage media or devices transferred, reused or retired?'),
    ]:
        add(code, 'operations', zh, en)
    return {'schema_version': 'mlps-tags-1', 'questions': questions,
            'domains': [{'code': c, 'zh': z, 'en': e} for c, z, e in DOMAIN_LABELS],
            'profiles': [{'code': c, 'level': v, 'zh': z, 'en': e} for (c, v), (z, e) in zip(PROFILES.items(), [
                ('内部基础控制集', 'Internal basic controls'), ('MLPS 二级参考', 'MLPS level 2 reference'),
                ('MLPS 三级参考', 'MLPS level 3 reference')])],
            'topics': [{'code': c.lower(), 'zh': z, 'en': e} for c, z, e in DOMAIN_LABELS],
            'thresholds': {'critical_minutes': 240, 'important_minutes': 1440}}


def invalid(field, message):
    raise DomainError('LIBRARY_INVALID', detail=[{'field': field, 'message': message}])


def dictionary(config):
    return {q['code']: q for q in config['questions']}


def refs(rule):
    if rule is True:
        return set()
    if 'tag' in rule:
        return {rule['tag']}
    return set().union(*(refs(r) for r in rule.get('all', rule.get('any', []))))


def validate_rule(rule, config, depth=0, count=None):
    count = [0] if count is None else count
    count[0] += 1
    if depth > 4 or count[0] > 100:
        invalid('rule', 'Rule exceeds complexity limit')
    if rule is True:
        return
    if not isinstance(rule, dict):
        invalid('rule', 'Expected true or a condition')
    for op in ('all', 'any'):
        if op in rule:
            if set(rule) != {op} or not isinstance(rule[op], list) or not rule[op]:
                invalid('rule', 'Condition groups must not be empty')
            for child in rule[op]:
                validate_rule(child, config, depth + 1, count)
            return
    if set(rule) != {'tag', 'op', 'value'} or not isinstance(rule.get('tag'), str) or rule['tag'] not in dictionary(config):
        invalid('rule', 'Unknown tag or invalid condition fields')
    q = dictionary(config)[rule['tag']]
    value, op = rule['value'], rule['op']
    if q['kind'] == 'number':
        if op != 'eq' or type(value) not in (int, float) or not math.isfinite(value) or value < 0:
            invalid('rule', 'Numeric facts require a nonnegative numeric equality value')
    elif op == 'eq' and q['kind'] != 'multi':
        if not isinstance(value, str) or value not in q['values'] or value == 'unknown':
            invalid('rule', 'Invalid enum value')
    elif op == 'in':
        if not isinstance(value, list) or not value or any(not isinstance(v, str) or v not in q['values'] or v == 'unknown' for v in value):
            invalid('rule', 'Expected a nonempty list of known values')
    else:
        invalid('rule', 'Unsupported operator for this tag type')


def evaluate_rule(rule, facts):
    if rule is True:
        return True
    for op in ('all', 'any'):
        if op in rule:
            values = [evaluate_rule(r, facts) for r in rule[op]]
            if op == 'all':
                return False if False in values else None if None in values else True
            return True if True in values else None if None in values else False
    value = facts.get(rule['tag'], 'unknown')
    if value is None or value == 'unknown' or isinstance(value, list) and 'unknown' in value:
        return None
    if rule['op'] == 'eq':
        return value == rule['value']
    return any(v in rule['value'] for v in value) if isinstance(value, list) else value in rule['value']


def validate_config(raw):
    config = copy.deepcopy(raw)
    if not isinstance(config, dict) or set(config) != {'schema_version', 'questions', 'domains', 'profiles', 'topics', 'thresholds'}:
        invalid('config', 'Invalid configuration fields')
    if config['schema_version'] != 'mlps-tags-1':
        invalid('schema_version', 'Unsupported schema')
    for collection in ('questions', 'domains', 'profiles', 'topics'):
        rows = config[collection]
        if not isinstance(rows, list) or len(rows) > 200 or (not rows and collection != 'topics'):
            invalid(collection, 'Expected up to 200 definitions')
        codes = set()
        for item in rows:
            if not isinstance(item, dict) or not isinstance(item.get('code'), str) or not re.fullmatch(r'[A-Za-z][A-Za-z0-9_.-]{0,79}', item['code']) or item['code'] in codes:
                invalid(collection, 'Invalid or duplicate code')
            codes.add(item['code'])
            if collection == 'domains' and len(item['code']) > 40:
                invalid(collection, 'Domain codes are limited to 40 characters')
            if any(not isinstance(item.get(k), str) or not item[k].strip() or len(item[k]) > 2000 for k in ('zh', 'en')):
                invalid(collection, 'Bilingual labels are required')
    for p in config['profiles']:
        if p.get('level') not in ('L1', 'L2', 'L3'):
            invalid('profiles', 'Invalid internal level')
    for q in config['questions']:
        if q.get('kind') not in ('enum', 'multi', 'number') or q.get('group') not in ('network', 'data', 'business', 'operations') or type(q.get('risk')) is not bool:
            invalid('questions', 'Invalid question type or group')
        if not isinstance(q.get('values'), list) or 'unknown' not in q['values'] or any(not isinstance(v, str) or not v.strip() or len(v) > 80 or '|' in v for v in q['values']) or len(set(q['values'])) != len(q['values']):
            invalid('questions', 'Invalid option values')
        validate_rule(q.get('when'), config)
    # Built-in grading inputs have stable meanings; additions do not silently alter grading.
    initial = dictionary(default_config())
    current = dictionary(config)
    for code, q in initial.items():
        if code not in current or any(current[code][k] != q[k] for k in ('kind', 'values', 'risk', 'when')):
            invalid('questions', f'Preserve built-in fact semantics: {code}')
    graph = {q['code']: refs(q['when']) for q in config['questions']}
    visited = set()
    def visit(code, stack):
        if code in stack:
            invalid('questions', 'Cyclic visibility condition')
        if code in visited:
            return
        for dependency in graph[code]:
            visit(dependency, stack | {code})
        visited.add(code)
    for code in graph:
        visit(code, set())
    thresholds = config['thresholds']
    if not isinstance(thresholds, dict) or set(thresholds) != {'critical_minutes', 'important_minutes'} or any(type(v) not in (int, float) or not math.isfinite(v) for v in thresholds.values()) or not 0 < thresholds['critical_minutes'] < thresholds['important_minutes']:
        invalid('thresholds', 'Expected positive increasing outage thresholds')
    return config


def normalize_facts(raw, config):
    if not isinstance(raw, dict) or set(raw) - set(dictionary(config)):
        invalid('facts', 'Unknown fact code')
    facts = {}
    for q in config['questions']:
        value = raw.get(q['code'], 'unknown')
        if value is None or value == '' or value == 'unknown':
            facts[q['code']] = 'unknown'
            continue
        if q['kind'] == 'number':
            if type(value) not in (int, float) or not math.isfinite(value) or not 0 <= value <= 52560000:
                invalid(q['code'], 'Expected finite nonnegative minutes')
        elif q['kind'] == 'multi':
            if not isinstance(value, list) or not value or any(not isinstance(v, str) or v not in q['values'] for v in value) or len(set(value)) != len(value) or ('unknown' in value and len(value) > 1):
                invalid(q['code'], 'Invalid multiselect')
        elif not isinstance(value, str) or value not in q['values']:
            invalid(q['code'], 'Invalid option')
        facts[q['code']] = value
    # Repeatedly clear hidden answers so stale values cannot leak through dependencies.
    for _ in config['questions']:
        changed = False
        for q in config['questions']:
            if evaluate_rule(q['when'], facts) is not True and facts[q['code']] != 'unknown':
                facts[q['code']] = 'unknown'
                changed = True
        if not changed:
            break
    if facts.get('net.public_ingress') == 'no' and any(facts.get(c) == 'yes' for c in ('net.public_business', 'net.public_admin')):
        invalid('net.public_ingress', 'Public business/admin access contradicts no public entry')
    return facts


def classify_profile(facts, config, mode='questionnaire', chosen=None, reason=''):
    if mode not in ('questionnaire', 'manual'):
        invalid('mode', 'Invalid classification mode')
    high, medium = [], []
    for code in ('risk.data_impact', 'risk.privilege_impact', 'risk.business_impact'):
        if facts.get(code) == 'severe':
            high.append(code)
        elif facts.get(code) == 'business':
            medium.append(code)
    for code in ('net.public_business', 'net.partner_link', 'data.personal'):
        if facts.get(code) == 'yes':
            medium.append(code)
    if facts.get('biz.manual_fallback') == 'no':
        medium.append('biz.manual_fallback')
    if facts.get('risk.dependency_scope') in ('multiple', 'customers'):
        medium.append('risk.dependency_scope')
    minutes = facts.get('risk.outage_minutes')
    if type(minutes) in (int, float):
        if minutes < config['thresholds']['critical_minutes']:
            high.append('risk.outage_minutes')
        elif minutes < config['thresholds']['important_minutes']:
            medium.append('risk.outage_minutes')
    unknown = [q['code'] for q in config['questions'] if q['risk'] and evaluate_rule(q['when'], facts) is True and facts.get(q['code'], 'unknown') == 'unknown']
    recommended = 'L3' if high else 'L2' if medium or unknown else 'L1'
    if mode == 'manual' and (chosen not in ('L1', 'L2', 'L3') or not isinstance(reason, str) or not reason.strip() or len(reason) > 8000):
        raise DomainError('MANUAL_REASON_REQUIRED')
    effective = chosen if mode == 'manual' else recommended
    exceptions = []
    if unknown:
        exceptions.append({'code': 'UNRESOLVED_CLASSIFICATION', 'questions': unknown})
    if effective < recommended:
        exceptions.append({'code': 'MANUAL_DOWNGRADE', 'recommended': recommended, 'chosen': effective})
    return {'scheme': 'MLPS-TAGS/1', 'mode': mode, 'recommended_level': recommended,
            'effective_level': effective, 'reason': reason, 'exceptions': exceptions,
            'matched_rules': high or medium, 'unknown': unknown, 'facts': facts,
            'answers': {}, 'input_hash': digest(facts)}
