"""MLPS intake v1: source-preserving questionnaire and deterministic impact matrix."""
import json
import copy
import math
from pathlib import Path

from .control_rules import invalid, normalize_facts
from .domain import DomainError, digest

SCHEME = 'MLPS-INTAKE/1'
QUESTIONS = json.loads((Path(__file__).parent / 'data/mlps_questionnaire.json').read_text(encoding='utf-8'))
DEMO_TEMPLATE = json.loads((Path(__file__).parent / 'data/mlps_demo_template.json').read_text(encoding='utf-8'))


def demo_template_for_org(org_id):
    return copy.deepcopy(DEMO_TEMPLATE['template']) if org_id == DEMO_TEMPLATE['source_org_id'] else None


GRADING_FIELDS = frozenset(json.loads((Path(__file__).parent / 'data/mlps_grading_fields.json').read_text(encoding='utf-8')))


MATRIX = {'rights': {1: 1, 2: 2, 3: 2}, 'public': {1: 2, 2: 3, 3: 4}, 'national': {1: 3, 2: 4, 3: 5}}
CORE = [f'{dimension}_{obj}_severity' for dimension in ('info', 'service') for obj in MATRIX]
SUPPORT = ('云计算平台/系统', '通信网络设施')
PERSON_RANGES = next(q for q in QUESTIONS if q['key'] == 'personal_info_count_system')['count_ranges']


def person_bounds(value):
    if type(value) in (int, float):
        return value, value
    return PERSON_RANGES.get(value) if isinstance(value, str) else None


def personal_info_status(answers):
    categories = answers.get('data_categories')
    if isinstance(categories, list) and categories:
        if any(value in categories for value in ('个人信息', '敏感个人信息')):
            return '是'
        return '不确定' if '不确定' in categories else '否'
    return '不确定'


def population_floor(number):
    return 1 if number <= 10000 else 2 if number <= 50000 else 3


def visible(q, answers):
    if q.get('retired'):
        return False
    key, target = q['key'], answers.get('target_type')
    if key in ('hosted_target_levels', 'platform_grade_evidence'):
        return target in SUPPORT
    if key in ('large_pi_public_bigdata', 'bigdata_public_service_confirmed'):
        return target == '大数据平台/系统'
    if key == 'special_target_boundary':
        return target not in (None, '', '独立业务信息系统', '人工智能应用', '其他', '不确定')
    if key == 'interconnected_system_level':
        return answers.get('system_interaction') == '是'
    if key == 'personal_info_count_system':
        return personal_info_status(answers) == '是'
    if key in ('personal_info_count_operator', 'pi_subject_scope'):
        return personal_info_status(answers) != '否'
    if key in ('sensitive_pi_types', 'sensitive_pi_count'):
        return '敏感个人信息' in answers.get('data_categories', [])
    if key == 'important_data_basis':
        return '重要数据' in answers.get('data_categories', [])
    if key == 'core_data_details':
        return '核心数据' in answers.get('data_categories', [])
    return True


def validate(raw, notes):
    keys = {q['key'] for q in QUESTIONS}
    if not isinstance(raw, dict) or set(raw) - keys or not isinstance(notes, dict) or set(notes) - keys:
        invalid('answers', 'Unknown question')
    for key, value in notes.items():
        if not isinstance(value, str) or len(value) > 8000:
            invalid(key, 'Invalid supporting explanation')
    for q in QUESTIONS:
        v = raw.get(q['key'])
        if v is None or v == '' or v == '不确定':
            continue
        kind = q['kind']
        if kind == 'severity':
            ok = type(v) is int and v in (0, 1, 2, 3, 9)
        elif kind in ('integer', 'number'):
            ok = type(v) in (int, float) and math.isfinite(v) and 0 <= v <= 10**15 and (kind != 'integer' or int(v) == v)
        elif q['key'] in ('registered_users', 'personal_info_count_system') and type(v) in (int, float):
            ok = math.isfinite(v) and 0 <= v <= 10**15 and int(v) == v
        elif kind == 'recovery_targets':
            ok = isinstance(v, dict) and not set(v) - {'rto', 'rpo'} and all(
                x in ('', '不确定') if isinstance(x, str) else type(x) in (int, float) and math.isfinite(x) and 0 <= x <= 10**15
                for x in v.values())
        elif kind == 'volume_ranges':
            ok = isinstance(v, dict) and not set(v) - set(q['range_groups']) and all(isinstance(x, str) and (x == '' or x in q['range_groups'][k]['values']) for k, x in v.items())
        elif kind == 'enum':
            ok = isinstance(v, str) and v in q['options'] + q.get('legacy_options', [])
        elif kind == 'multi' and q['key'] == 'system_owner' and isinstance(v, str):
            ok = len(v) <= 12000  # Retain legacy authored responsibility text.
        elif kind == 'multi':
            ok = isinstance(v, list) and len(v) <= len(set(q['options'] + q.get('legacy_options', []))) and all(isinstance(x, str) and x in q['options'] + q.get('legacy_options', []) for x in v) and len(set(v)) == len(v) and not ('不确定' in v and len(v) > 1)
        elif kind in ('hosted', 'loss', 'workload', 'volume'):
            columns = {'hosted': ('hosted_system_name', 'confirmed_level', 'evidence'), 'loss': ('scenario', 'amount_rmb', 'basis'), 'workload': ('average', 'peak', 'unit'), 'volume': ('amount', 'unit')}[kind]
            ok = isinstance(v, list) and len(v) <= 100
            if ok:
                for row in v:
                    if not isinstance(row, dict) or set(row) - set(columns) or any(not isinstance(x, str) or len(x) > 2000 for x in row.values()):
                        ok = False
                        break
                    for col in ('confirmed_level', 'amount_rmb', 'average', 'peak', 'amount'):
                        if row.get(col):
                            try:
                                n = float(row[col])
                                if not math.isfinite(n) or not 0 <= n <= 10**15 or col == 'confirmed_level' and n not in (1, 2, 3, 4, 5):
                                    ok = False
                            except ValueError:
                                ok = False
        else:
            ok = isinstance(v, str) and len(v) <= 12000
        if not ok:
            invalid(q['key'], 'Invalid questionnaire answer')
    return {k: v for k, v in raw.items() if v is not None}, dict(notes)


def evaluate(raw, notes=None):
    a, notes = validate(raw, notes or {})
    # Keep saved history, but evaluate only currently visible inputs.
    a = {q['key']: a[q['key']] for q in QUESTIONS if q['key'] in a and visible(q, a)}
    issues, alerts, trace = [], [], []

    def issue(code, field, zh, en):
        issues.append({'code': code, 'field': field, 'zh': zh, 'en': en})

    for q in QUESTIONS:
        if q['kind'] != 'severity' and q['required'] and visible(q, a) and (a.get(q['key']) is None or a.get(q['key']) == [] or isinstance(a.get(q['key']), str) and not a[q['key']].strip()):
            issue('REQUIRED', q['key'], '请补充必填信息或受控材料引用。', 'Complete this required field or controlled evidence reference.')
    for key in ('system_owner', 'system_business_type'):
        if isinstance(a.get(key), list) and '其他' in a[key] and not notes.get(key, '').strip():
            issue('OTHER_REQUIRED', key, '请填写其他选项的具体内容。', 'Specify the Other selection.')
    if a.get('security_responsible_entity') == '是' and not notes.get('security_responsible_entity', '').strip():
        issue('RESPONSIBLE_NAME_REQUIRED', 'security_responsible_entity', '请填写主要负责单位或部门名称。', 'Enter the responsible organization or department name.')
    for key in ('security_responsible_entity',):
        if a.get(key) == '否':
            issue('QA01', key, '已选择“否”：请复核该系统是否适合作为独立定级对象。', 'You selected No: review whether this system is suitable as an independent assessment target.')
        elif a.get(key) != '是':
            issue('QA01', key, '尚未确认：请选择是否具备独立定级条件。', 'Unconfirmed: specify whether independent assessment conditions are met.')
    unknown = []
    dimensions = []
    for dimension in ('info', 'service'):
        levels = []
        saved = [obj for obj in MATRIX if f'{dimension}_{obj}_severity' in a]
        selected = [obj for obj in saved if a[f'{dimension}_{obj}_severity'] != 0] or saved[:1] or ['rights']
        for obj in selected:
            matrix = MATRIX[obj]
            key = f'{dimension}_{obj}_severity'
            severity = a.get(key)
            grade = matrix.get(severity) if type(severity) is int else None
            trace.append({'field': key, 'severity': severity, 'object': obj, 'level': grade})
            if severity in (None, '', 9, '不确定'):
                unknown.append(key)
                issue('QA02', key, '影响未知，不能形成完整初步等级。', 'Unknown impact prevents a complete preliminary grade.')
            elif not notes.get(key, '').strip():
                issue('RATIONALE', key, '请填写判断理由及证据；公共利益/国家安全需说明对象、事件链、地区和规模。', 'Explain the evidence; for public/national impact include affected parties, event chain, geography and scale.')
            if grade:
                levels.append(grade)
            if obj == 'national' and severity in (1, 2, 3):
                issue('QA06', key, '国家安全影响须取得高级专业复核意见。', 'National-security impact requires senior specialist review.')
        dimensions.append(max(levels, default=None))
    base = max((x for x in dimensions if x), default=None)
    if base is None:
        issue('QA02', 'info_rights_severity', '未识别可分析的影响，请重新核实事故情景。', 'No assessable impact: verify incident scenarios.')
    categories = a.get('data_categories', [])
    raw_count = person_bounds(a.get('personal_info_count_system'))
    count = raw_count if personal_info_status(a) == '是' else None
    if type(a.get('sensitive_pi_count')) in (int, float) and count and count[1] is not None and a['sensitive_pi_count'] > count[1]:
        issue('QA03', 'sensitive_pi_count', '敏感个人信息人数超过系统总人数。', 'Sensitive-information count exceeds the system total.')
    if a.get('external_network_access') == '存在公众可访问入口':
        alerts.append({'code': 'T01', 'zh': '公众入口：触发 Amer Sports 内部最低 2 级；国家标准矩阵等级仍独立计算。', 'en': 'Public ingress triggers the Amer Sports internal level 2 minimum; the national-standard matrix is calculated independently.'})
    for threshold, code in [(1000000, 'T02'), (10000000, 'T03')]:
        if count and count[0] >= threshold:
            alerts.append({'code': code, 'zh': '个人信息规模触发复核；处理者与系统统计分开，不自动提高等保等级。', 'en': 'Personal information scale triggers review; operator and system counts are separate and do not raise the MLPS grade.'})
    if '敏感个人信息' in categories:
        alerts.append({'code': 'T05', 'zh': '请核实敏感个人信息的泄露后果。', 'en': 'Review the consequences of sensitive personal information disclosure.'})
    if any(value in categories for value in ('重要数据', '核心数据')) or a.get('data_security_classification') in ('重要', '核心', '混合') or a.get('cii_status') == '正式认定':
        alerts.append({'code': 'T06', 'zh': '请核查行业适用性及附加保护义务。', 'en': 'Review sector applicability and additional protection obligations.'})
    minimum = None
    organization_trace = []
    if a.get('system_interaction') == '是':
        linked_grade = a.get('interconnected_system_level')
        if linked_grade in [f'{i} 级' for i in range(1, 6)]:
            organization_trace.append({'code': 'AMER-LINK-MIN', 'field': 'interconnected_system_level', 'answer': linked_grade, 'level': int(linked_grade[0]),
                                       'zh': '对接系统等级触发 Amer Sports 内部下限，本系统不低于对接系统最高等级。',
                                       'en': 'The highest connected-system grade establishes an Amer Sports internal minimum.'})
        elif linked_grade == '不确定':
            issue('LINK_GRADE_UNKNOWN', 'interconnected_system_level', '请核实对接系统最高等级，才能确认内部等级下限。', 'Verify the highest connected-system grade before confirming the internal minimum.')
    network_minimum = {'无': 1, '仅经VPN/零信任接入': 3, '存在受控互联网入口': 2, '存在公众可访问入口': 2}.get(a.get('external_network_access'))
    if network_minimum:
        organization_trace.append({'code': 'AMER-NET-MIN', 'field': 'external_network_access', 'answer': a['external_network_access'], 'level': network_minimum,
                                   'zh': '网络入口方式触发 Amer Sports 内部等级下限。', 'en': 'The network ingress choice establishes an Amer Sports internal minimum.'})
    elif a.get('external_network_access') == '不确定':
        issue('NETWORK_MIN_UNKNOWN', 'external_network_access', '请核实网络入口方式，才能确认内部等级下限。', 'Verify network ingress before confirming the internal minimum.')
    for field, code, floor, label_zh, label_en in [('public_service_nature', 'AMER-PUBLIC-MIN', 2, '公共服务', 'Public service'), ('involves_transactions', 'AMER-TRANSACTION-MIN', 2, '交易', 'Transaction involvement'), ('external_dependency_impact', 'AMER-DEPENDENCY-MIN', 2, '外部同步影响', 'External dependency impact'), ('safety_impact', 'AMER-SAFETY-MIN', 3, '安全或社会稳定影响', 'Safety or social-stability impact')]:
        value = a.get(field)
        if value == '是':
            organization_trace.append({'code': code, 'field': field, 'answer': value, 'level': floor,
                                       'zh': f'{label_zh}触发 Amer Sports 内部最低 {floor} 级。', 'en': f'{label_en} establishes an Amer Sports internal level {floor} minimum.'})
        elif value == '不确定':
            issue({'public_service_nature': 'SERVICE_MIN_UNKNOWN', 'involves_transactions': 'TRANSACTION_MIN_UNKNOWN', 'external_dependency_impact': 'DEPENDENCY_MIN_UNKNOWN', 'safety_impact': 'SAFETY_MIN_UNKNOWN'}[field], field, f'请核实是否涉及{label_zh}，才能确认内部等级下限。', f'Verify {label_en.lower()} before confirming the internal minimum.')
    importance = a.get('critical_business')
    business_floor = {'非核心': 1, '重要辅助': 2, '主要业务核心': 3}.get(importance)
    if business_floor:
        organization_trace.append({'code': 'AMER-BUSINESS-MIN', 'field': 'critical_business', 'answer': importance, 'level': business_floor,
                                   'zh': '业务重要性触发 Amer Sports 内部等级下限。', 'en': 'Business importance establishes an Amer Sports internal minimum.'})
    elif importance:
        issue('BUSINESS_MIN_UNKNOWN' if importance == '不确定' else 'BUSINESS_MIN_REVIEW', 'critical_business', '请按当前选项确认业务重要性，才能确定内部等级下限。', 'Confirm business importance using the current options before establishing the internal minimum.')
    if personal_info_status(a) == '是':
        if count:
            population_minimum = population_floor(count[0])
            organization_trace.append({'code': 'AMER-POPULATION-MIN', 'field': 'personal_info_count_system', 'answer': a['personal_info_count_system'], 'level': population_minimum,
                                       'zh': '个人信息人数触发 Amer Sports 内部等级下限；历史范围使用可确定的等级下限。', 'en': 'Personal-information population establishes an Amer Sports internal minimum; historical bands use the known lower bound.'})
            upper_floor = population_floor(count[1]) if count[1] is not None else 3
            if upper_floor != population_minimum:
                issue('POPULATION_MIN_REVIEW', 'personal_info_count_system', '历史人数范围跨越当前等级档位，请重新选择三档人数范围。', 'The historical population range crosses current grade bands; choose one of the three current ranges.')
        elif a.get('personal_info_count_system') == '不确定':
            issue('POPULATION_MIN_UNKNOWN', 'personal_info_count_system', '请核实个人信息人数范围，才能确认内部等级下限。', 'Verify the personal-information population range before confirming the internal minimum.')
    elif personal_info_status(a) == '不确定' and a.get('data_categories'):
        issue('PERSONAL_SCOPE_MIN_UNKNOWN', 'data_categories', '请核实是否涉及个人信息，以确定人数规则是否适用。', 'Verify personal-information applicability before applying the population rule.')
    data_class = a.get('data_security_classification')
    data_floor = {'一般': 1, '重要': 3, '核心': 3, '混合': 3}.get(data_class)
    if data_floor:
        organization_trace.append({'code': 'AMER-DATA-CLASS-MIN', 'field': 'data_security_classification', 'answer': data_class, 'level': data_floor,
                                   'zh': '数据安全分类触发 Amer Sports 内部等级下限。', 'en': 'Data security classification establishes an Amer Sports internal minimum.'})
    elif data_class in ('尚未评估', '不确定'):
        issue('DATA_CLASS_MIN_UNKNOWN', 'data_security_classification', '请核实数据安全分类，才能确认内部等级下限。', 'Verify data security classification before confirming the internal minimum.')
    if a.get('cross_border_data') == '是':
        organization_trace.append({'code': 'AMER-CROSS-BORDER-MIN', 'field': 'cross_border_data', 'answer': '是', 'level': 2,
                                   'zh': '数据跨境传输或向境外提供数据触发 Amer Sports 内部最低 2 级。', 'en': 'Cross-border transfer or overseas data provision establishes an Amer Sports internal level 2 minimum.'})
    elif a.get('cross_border_data') == '不确定':
        issue('CROSS_BORDER_MIN_UNKNOWN', 'cross_border_data', '请核实是否进行数据跨境传输或向境外提供数据。', 'Verify cross-border transfers or overseas data provision.')
    volume = a.get('data_volume_ranges')
    if isinstance(volume, dict) or volume == '不确定':
        ranges = volume if isinstance(volume, dict) else {}
        for group, code, mapping, label_zh, label_en in [
            ('records', 'AMER-RECORDS-MIN', {'under_100k': 1, '100k_1m': 2, '1m_10m': 3, 'over_10m': 3}, '业务记录数量', 'Business record count'),
            ('storage', 'AMER-STORAGE-MIN', {'under_1tb': 1, '1_10tb': 2, '10_100tb': 3, 'over_100tb': 3}, '数据容量', 'Data storage volume'),
        ]:
            value = ranges.get(group)
            volume_floor = mapping.get(value)
            if volume_floor:
                organization_trace.append({'code': code, 'field': 'data_volume_ranges', 'subfield': group, 'answer': value, 'level': volume_floor,
                                           'zh': f'{label_zh}触发 Amer Sports 内部等级下限。', 'en': f'{label_en} establishes an Amer Sports internal minimum.'})
            else:
                issue('RECORDS_MIN_UNKNOWN' if group == 'records' else 'STORAGE_MIN_UNKNOWN', 'data_volume_ranges', f'请核实{label_zh}范围，才能确认内部等级下限。', f'Verify the {label_en.lower()} range before confirming the internal minimum.')
    organization_minimum = max((row['level'] for row in organization_trace), default=None)
    proposed = max(base or 0, minimum or 0, organization_minimum or 0) or None
    status = 'insufficient_impact_data' if not base else 'pending_review' if issues else 'preliminary_complete'
    return {'status': status, 'business_information_level': dimensions[0], 'system_service_level': dimensions[1],
            'base_level': base, 'special_principle_minimum': minimum, 'proposed_level': proposed,
            'organization_minimum': organization_minimum, 'organization_rule_trace': organization_trace, 'organization_rule_version': 'AMER-INTERNAL/5',
            'known_lower_bound_level': proposed, 'is_lower_bound_only': bool(unknown) or base is None or any(i['code'] in ('LINK_GRADE_UNKNOWN', 'NETWORK_MIN_UNKNOWN', 'SERVICE_MIN_UNKNOWN', 'TRANSACTION_MIN_UNKNOWN', 'BUSINESS_MIN_UNKNOWN', 'BUSINESS_MIN_REVIEW', 'POPULATION_MIN_UNKNOWN', 'POPULATION_MIN_REVIEW', 'PERSONAL_SCOPE_MIN_UNKNOWN', 'DATA_CLASS_MIN_UNKNOWN', 'CROSS_BORDER_MIN_UNKNOWN', 'RECORDS_MIN_UNKNOWN', 'STORAGE_MIN_UNKNOWN', 'DEPENDENCY_MIN_UNKNOWN', 'SAFETY_MIN_UNKNOWN') or i['code'] == 'REQUIRED' and i['field'] in ('interconnected_system_level', 'public_service_nature', 'involves_transactions', 'critical_business', 'personal_info_count_system', 'data_security_classification', 'cross_border_data', 'data_volume_ranges', 'external_dependency_impact', 'safety_impact') for i in issues), 'blocking_unknown_fields': unknown,
            'issues': issues, 'alerts': alerts, 'rule_trace': trace, 'final_confirmed_level': None,
            'manual_review_required': bool(issues) or bool(proposed and proposed >= 2),
            'standard_version': 'GB/T 22240-2020', 'questionnaire_version': 'AmerSports-2.18', 'rule_engine_version': '1.8.2',
            'sector_rules_status': 'not_collected', 'verified_sector_minimum': None}


def evaluate_grading(raw, notes=None):
    """Early rule preview; full questionnaire validation still gates confirmation."""
    result = evaluate(raw, notes)
    result['issues'] = [issue for issue in result['issues'] if issue['field'] in GRADING_FIELDS]
    known = {q['key']: q for q in QUESTIONS}
    for key in GRADING_FIELDS:
        q = known[key]
        if q['kind'] == 'severity' or not visible(q, raw):
            continue
        if raw.get(key) in (None, '', []) and not any(i['field'] == key for i in result['issues']):
            result['issues'].append({'code': 'REQUIRED', 'field': key,
                                     'zh': '请补充定级所需信息。', 'en': 'Complete this grading input.'})
    result['status'] = 'insufficient_impact_data' if not result['base_level'] else 'pending_review' if result['issues'] else 'preliminary_complete'
    result['is_lower_bound_only'] = result['is_lower_bound_only'] or any(i['code'] == 'REQUIRED' for i in result['issues'])
    result['manual_review_required'] = bool(result['issues']) or bool(result['proposed_level'] and result['proposed_level'] >= 2)
    return result


def deployment_facts(value):
    """Any selected cloud environment takes precedence over local environments."""
    values = {value} if isinstance(value, str) else set(value or [])
    if values & {'专有云', '公有云', '混合云', 'SaaS'}:
        return ['cloud']
    if not values or values & {'其他', '不确定'}:
        return ['unknown']
    if values <= {'本地数据中心', '托管机房', '门店或仓库本地部署'}:
        return ['own_dc']
    return ['unknown']


def preview(db, org_id, body):
    from . import screening
    import re
    from .db import MlpsEvidence, System
    answers, notes = validate(body.get('answers', {}), body.get('notes', {}))
    for ref in re.findall(r'evidence:([a-f0-9-]{36})', json.dumps([answers, notes])):
        row = db.get(MlpsEvidence, ref)
        system = db.get(System, row.system_id) if row else None
        if not system or system.org_id != org_id or body.get('_system_id') and row.system_id != body['_system_id']:
            invalid('evidence', 'Evidence must belong to this assessment')
        if ref in system.draft.get('removed_mlps_evidence', []):
            invalid('evidence', 'Removed evidence cannot be reattached; upload the file again')
    contacts = body.get('department_contacts', {})
    department = next(q for q in QUESTIONS if q['key'] == 'system_owner')
    allowed = set(department['options'] + department.get('legacy_options', [])) - {'不确定'}
    contact_fields = {'name', 'organization', 'title', 'scope', 'contact_method'}
    def valid_contact(value):
        if isinstance(value, str):
            return len(value) <= 500
        return (isinstance(value, dict) and not set(value) - contact_fields
                and all(isinstance(v, str) and len(v) <= 500 for v in value.values()))
    if not isinstance(contacts, dict) or set(contacts) - allowed or any(not valid_contact(v) for v in contacts.values()):
        invalid('department_contacts', 'Invalid departmental contacts')
    result = evaluate(answers, notes)
    catalog, release, cfg = screening.resolve(db, org_id, body.get('catalog_id'))
    frameworks = body.get('frameworks', [])
    if not isinstance(frameworks, list) or not frameworks or any(f not in ('MLPS_LEVEL_1', 'MLPS_LEVEL_2', 'MLPS_LEVEL_3') for f in frameworks):
        invalid('frameworks', 'Choose MLPS level 1, 2 or 3 reference controls')
    facts = normalize_facts({}, cfg)
    from .mlps_applicability import facts as applicability_facts
    allowed_facts = {q['code'] for q in cfg['questions']}
    facts.update({k: v for k, v in applicability_facts(answers).items() if k in allowed_facts})
    facts['hosting.models'] = deployment_facts(answers.get('deployment_model'))
    facts['data.personal'] = {'是': 'yes', '否': 'no'}.get(personal_info_status(answers), 'unknown')
    facts['net.public_ingress'] = {'无': 'no', '存在公众可访问入口': 'yes', '存在受控互联网入口': 'yes'}.get(answers.get('external_network_access'), 'unknown')
    profiles = {f: [f'MLPS{f[-1]}_REFERENCE'] for f in frameworks}
    controls = [c for c in release.data['controls'] if not c['retired']] if release else []
    missing = [f for f in frameworks if not any(c.get('source_framework') == f for c in controls)]
    level = f"L{result['proposed_level']}" if result['proposed_level'] else None
    return {'scheme': SCHEME, 'methodology_version': SCHEME, 'mode': 'questionnaire', 'reason': '',
            'answers': answers, 'notes': notes, 'department_contacts': contacts, 'facts': facts, 'assessment': result, 'grading_assessment': evaluate_grading(answers, notes),
            'recommended_level': level, 'effective_level': level, 'input_hash': digest([answers, notes, contacts]),
            'questionnaire_hash': digest(QUESTIONS), 'questionnaire_source': 'MLPS_2.0_questionnaire_v1.0.md', 'questionnaire_profile': 'Amer Sports retail',
            'catalog_id': catalog.id if catalog else None, 'frameworks': frameworks, 'framework_profiles': profiles,
            'assessment_profiles': [p for values in profiles.values() for p in values], 'assessment_profile': next(iter(profiles.values()))[0],
            'methodology_config': cfg, 'config_hash': digest(cfg), 'controls_ready': bool(catalog) and not missing,
            'missing_frameworks': missing, 'exceptions': [], 'unknown': result['blocking_unknown_fields'],
            'matches': [{'code': c['control_code'], **screening.match(c, facts, [], frameworks, profiles)} for c in controls]}


def confirm(db, system, payload):
    from . import service
    service.require_state(system, 'DRAFT', 'CLASSIFYING', 'CONTEXT_REVIEW', 'CONTROL_REVIEW', 'PRD_REVIEW',
                          'RESULT_REVIEW', 'NEGOTIATING', 'FINAL_CONFIRMATION', 'PENDING_DEVELOPMENT', *service.revision_states(db, system))
    result = preview(db, system.org_id, {**payload, '_system_id': system.id})
    if result['assessment']['status'] != 'preliminary_complete':
        raise DomainError('MLPS_REVIEW_REQUIRED', 409, result['assessment']['issues'])
    if result['assessment']['proposed_level'] > 3:
        raise DomainError('MLPS_REFERENCE_UNAVAILABLE', 409)
    if any(int(f[-1]) < result['assessment']['proposed_level'] for f in result['frameworks']):
        raise DomainError('MLPS_REFERENCE_UNAVAILABLE', 409)
    result.pop('matches')
    if system.classification or system.context_revision_id:
        service.invalidate(db, system, 'CONTEXT_REVIEW')
        system.context_revision_id = None
    system.classification = result
    system.draft = {**system.draft, 'mlps_intake': {k: result[k] for k in ('answers', 'notes', 'department_contacts', 'frameworks', 'catalog_id')},
                    'proposal_stale': bool(system.draft.get('proposal'))}
    system.status = 'CONTEXT_REVIEW'


def confirm_information(db, system, payload):
    """Atomically confirm questionnaire facts and match controls without a brief page."""
    from . import service
    from .domain import Context
    confirm(db, system, payload)
    answers = system.classification['answers']
    previous = system.draft.get('proposal') or system.context or {}
    existing = {f['title']: f for f in previous.get('functions', [])}
    titles = list(dict.fromkeys(line.strip() for line in answers.get('system_functions', '').splitlines() if line.strip()))
    def values(key):
        value = answers.get(key, [])
        return value if isinstance(value, list) else [value] if value else []
    context = Context().model_dump()
    context.update(summary=answers.get('system_purpose', ''),
                   functions=[{'id': f'F-QUESTIONNAIRE-{i + 1}', 'title': title,
                               'description': existing.get(title, {}).get('description', ''), 'source_blocks': []}
                              for i, title in enumerate(titles)],
                   departments=values('system_owner'), roles=values('user_types'),
                   workflow=answers.get('system_scenarios', ''), data_notes='、'.join(values('data_categories')),
                   integrations=answers.get('system_interfaces_description', ''))
    # Explicit confirmation replaces the source for this revision; historical drafts stay stored.
    system.draft = {**system.draft, 'proposal_stale': False}
    service.confirm_context(db, system, {'context': context})
