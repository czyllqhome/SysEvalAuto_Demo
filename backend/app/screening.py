"""Versioned internal screening inspired by MLPS impact analysis, not statutory grading."""
import copy

from .control_rules import default_config, normalize_facts, invalid
from .domain import DomainError, digest

SCHEME = 'SYS-SCREEN/2'


def config(base=None):
    result = copy.deepcopy(base or default_config())
    extras = []
    def add(code, group, zh, en, values, risk=True):
        extras.append({'code': code, 'group': group, 'zh': zh, 'en': en, 'kind': 'enum',
                       'values': values + ['unknown'], 'risk': risk, 'when': True})
    add('screen.personal_count', 'data', '个人信息涉及人数（去重人数，不是记录行数）', 'People whose personal information is processed (distinct people, not rows)',
        ['none', 'under_10k', '10k_100k', '100k_1m', 'over_1m'])
    add('screen.sensitive_count', 'data', '敏感个人信息涉及人数（如身份、生物识别、健康、金融账户）', 'People whose sensitive personal information is processed (identity, biometrics, health, financial accounts)',
        ['none', 'under_1k', '1k_10k', '10k_100k', 'over_100k'])
    for category, group, zh, en in [('data', 'data', '数据泄露或篡改', 'Data disclosure or tampering'), ('service', 'business', '系统服务中断', 'Service interruption')]:
        add(f'screen.{category}_object', group, f'{zh}主要影响谁？', f'Who is affected by {en.lower()}?', ['rights', 'public', 'national'])
        add(f'screen.{category}_harm', group, f'{zh}的损害程度？', f'Severity of {en.lower()}?', ['minor', 'serious', 'extreme'])
    add('screen.interaction', 'network', '与其他系统如何交互？', 'How does the system interact with other systems?', ['none', 'read', 'write', 'critical'])
    add('screen.public_cloud', 'network', '是否部署在公有云？（云平台等级不等于本系统等级）', 'Hosted in a public cloud? (platform grading does not determine application grading)', ['yes', 'no'], False)
    add('screen.confidential', 'data', '是否处理商业秘密或其他非个人敏感业务信息？', 'Does the system process trade secrets or other non-personal confidential business information?', ['yes', 'no'])
    codes = {q['code'] for q in extras}
    for question in result['questions']:
        question['risk'] = question['code'] in {'net.public_ingress', 'risk.business_impact', 'risk.outage_minutes', 'biz.manual_fallback'}
    result['questions'] = [q for q in result['questions'] if q['code'] not in codes] + extras
    return result


def classify(raw, cfg, mode='questionnaire', chosen=None, reason=''):
    facts = normalize_facts(raw, cfg)
    personal, sensitive = facts['screen.personal_count'], facts['screen.sensitive_count']
    if personal == 'none' and sensitive not in ('none', 'unknown'):
        invalid('screen.sensitive_count', '敏感个人信息属于个人信息，人数回答矛盾 / Sensitive personal information is personal information')
    if (personal == 'under_10k' and sensitive in ('10k_100k', 'over_100k') or
            personal == '10k_100k' and sensitive == 'over_100k'):
        invalid('screen.sensitive_count', '敏感个人信息人数不能超过个人信息人数范围 / Sensitive count exceeds total range')
    for code, count in [('data.personal', personal)]:
        if count != 'unknown':
            derived = 'no' if count == 'none' else 'yes'
            if facts.get(code) not in ('unknown', derived):
                invalid(code, '数量与是否处理的回答矛盾 / Presence and quantity conflict')
            facts[code] = derived
    if sensitive not in ('none', 'unknown') or facts['screen.confidential'] == 'yes':
        if facts.get('data.sensitive') == 'no':
            invalid('data.sensitive', '敏感信息回答矛盾 / Sensitive-information answers conflict')
        facts['data.sensitive'] = 'yes'
    levels, triggers, expert = [1], [], []
    def trigger(level, code):
        levels.append(level)
        triggers.append({'level': f'L{level}', 'fact': code})
    core = ['screen.personal_count', 'screen.sensitive_count', 'screen.confidential', 'net.public_ingress', 'screen.interaction',
            'risk.business_impact', 'risk.outage_minutes', 'biz.manual_fallback']
    for category in ('data', 'service'):
        a, b = f'screen.{category}_object', f'screen.{category}_harm'
        core.extend([a, b])
        obj, harm = facts[a], facts[b]
        if obj == 'national':
            trigger(3, a)
            expert.append(a)
        elif obj == 'public':
            trigger(2 if harm == 'minor' else 3, a)
            if harm == 'extreme':
                expert.append(a)
        elif obj == 'rights' and harm in ('serious', 'extreme'):
            trigger(2, b)
    if personal in ('100k_1m', 'over_1m'):
        trigger(3, 'screen.personal_count')
    elif personal not in ('none', 'unknown'):
        trigger(2, 'screen.personal_count')
    if sensitive in ('1k_10k', '10k_100k', 'over_100k'):
        trigger(3, 'screen.sensitive_count')
    elif sensitive == 'under_1k':
        trigger(2, 'screen.sensitive_count')
    if facts['screen.confidential'] == 'yes':
        trigger(2, 'screen.confidential')
    if facts['net.public_ingress'] == 'yes':
        trigger(2, 'net.public_ingress')
    if facts['screen.interaction'] in ('write', 'critical'):
        trigger(3 if facts['screen.interaction'] == 'critical' else 2, 'screen.interaction')
    if facts['risk.business_impact'] in ('business', 'severe'):
        trigger(3 if facts['risk.business_impact'] == 'severe' else 2, 'risk.business_impact')
    if facts['biz.manual_fallback'] == 'no':
        trigger(2, 'biz.manual_fallback')
    minutes = facts['risk.outage_minutes']
    if type(minutes) in (int, float):
        if minutes < cfg['thresholds']['critical_minutes'] and facts['biz.manual_fallback'] == 'no':
            trigger(3, 'risk.outage_minutes')
        elif minutes < cfg['thresholds']['important_minutes']:
            trigger(2, 'risk.outage_minutes')
    unknown = [code for code in core if facts.get(code, 'unknown') == 'unknown']
    recommended = f'L{max(levels + ([2] if unknown else []))}'
    if mode not in ('questionnaire', 'manual'):
        invalid('mode', 'Invalid mode')
    if mode == 'manual' and (chosen not in ('L1', 'L2', 'L3') or not isinstance(reason, str) or not reason.strip() or len(reason) > 8000):
        raise DomainError('MANUAL_REASON_REQUIRED')
    effective = chosen if mode == 'manual' else recommended
    exceptions = ([{'code': 'UNRESOLVED_CLASSIFICATION', 'questions': unknown}] if unknown else [])
    if effective < recommended:
        exceptions.append({'code': 'MANUAL_DOWNGRADE', 'reason': reason})
    return {'scheme': SCHEME, 'methodology_version': SCHEME, 'mode': mode, 'reason': reason,
            'recommended_level': recommended, 'effective_level': effective, 'facts': facts, 'answers': {},
            'matched_rules': [t['fact'] for t in triggers], 'triggers': triggers, 'unknown': unknown,
            'expert_review': expert, 'exceptions': exceptions, 'input_hash': digest(facts)}


def resolve(db, org_id, catalog_id=None):
    from .control_library import published, state
    try:
        catalog, release = published(db, org_id, catalog_id)
        return catalog, release, config(release.data['config'])
    except DomainError as exc:
        if catalog_id or exc.code not in ('CATALOG_NOT_AVAILABLE', 'METHODOLOGY_NOT_CONFIGURED'):
            raise
        return None, None, config(state(db, org_id)['config'])


def match(item, facts, profiles, frameworks, framework_profiles=None):
    from .control_library import match as base_match
    if framework_profiles:
        profiles = framework_profiles.get(item.get('source_framework', '').strip().upper(), [])
    profile = next((p for p in profiles if p in item['assessment_profiles']), '')
    result = base_match(item, facts, profile)
    if item.get('source_framework', '').strip().casefold() not in {f.casefold() for f in frameworks}:
        result.update(status='inapplicable', reason='framework_not_selected')
    return result


def preview(db, org_id, body):
    catalog, release, cfg = resolve(db, org_id, body.get('catalog_id'))
    result = classify(body.get('facts', {}), cfg, body.get('mode', 'questionnaire'), body.get('level'), body.get('reason', ''))
    frameworks = body.get('frameworks', [])
    if not isinstance(frameworks, list) or not frameworks or len(frameworks) > 30 or any(not isinstance(f, str) or not f.strip() or len(f) > 100 for f in frameworks):
        invalid('frameworks', '请选择至少一个评估框架 / Choose at least one framework')
    frameworks = sorted({f.strip().upper() for f in frameworks})
    from .mlps_source import FRAMEWORKS
    if any(f not in FRAMEWORKS for f in frameworks):
        invalid('frameworks', 'Choose MLPS level 2 or MLPS level 3')
    target = body.get('mlps_target')
    if target not in (None, '', '2', '3') or target and 'MLPS' not in frameworks:
        invalid('mlps_target', 'Invalid MLPS target')
    level = f'L{target}' if target else result['effective_level']
    if level < result['effective_level']:
        result['exceptions'].append({'code': 'CONTROL_PROFILE_DOWNGRADE', 'effective_level': result['effective_level'], 'target': level})
    framework_profiles = {f: [f'MLPS{f[-1]}_REFERENCE'] for f in frameworks}
    for framework in frameworks:
        if f'L{framework[-1]}' < result['effective_level']:
            result['exceptions'].append({'code': 'CONTROL_PROFILE_DOWNGRADE', 'effective_level': result['effective_level'], 'target': framework})
    profiles = sorted({p for values in framework_profiles.values() for p in values})
    controls = [c for c in release.data['controls'] if not c['retired']] if release else []
    missing = [f for f in frameworks if not any(c.get('source_framework', '').strip().upper() == f and set(c['assessment_profiles']) & set(framework_profiles[f]) for c in controls)]
    matches = [{'code': c['control_code'], **match(c, result['facts'], profiles, frameworks, framework_profiles)} for c in controls]
    return {**result, 'catalog_id': catalog.id if catalog else None, 'frameworks': frameworks,
            'assessment_profiles': profiles, 'framework_profiles': framework_profiles, 'assessment_profile': profiles[0] if profiles else '', 'mlps_target': target,
            'config_hash': digest(cfg), 'methodology_config': cfg, 'matches': matches,
            'missing_frameworks': missing, 'controls_ready': bool(catalog) and not missing}
