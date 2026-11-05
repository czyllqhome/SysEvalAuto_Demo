"""Explicit intake-to-control applicability mappings; no grading contribution."""
import re

FLAGS = {
    'outsourced_operations': ('ops.outsourced', '外包运维', 'Outsourced operations'),
    'physical_media': ('scope.physical_media', '实体存储介质管理', 'Physical storage media'),
    'physical_media_transport': ('scope.media_transport', '实体介质线下运输', 'Physical media transport'),
    'facility_management': ('scope.facility_management', '机房安全管理责任（含云商取证）', 'Facility security including provider assurance'),
    'physical_visitors': ('scope.physical_visitors', '外部人员物理访问', 'External physical visitors'),
}


def configure(config):
    for code, zh, en in FLAGS.values():
        if not any(q['code'] == code for q in config['questions']):
            config['questions'].append({'code': code, 'group': 'operations', 'zh': zh, 'en': en,
                                        'kind': 'enum', 'values': ['yes', 'no', 'unknown'], 'risk': False, 'when': True})


def facts(answers):
    result = {code: {'是': 'yes', '否': 'no'}.get(answers.get(key), 'unknown') for key, (code, _, _) in FLAGS.items()}
    models = answers.get('development_models', [])
    mapping = {'自行开发': 'in_house', '外包开发': 'outsourced', '采购成品或SaaS': 'purchased'}
    result['delivery.models'] = [mapping[m] for m in models if m in mapping] if models and '不确定' not in models else ['unknown']
    return result


def rule(identifier, level):
    ref = re.sub(r'\s+', '', identifier)
    if level in (2, 3):
        prefix = str(level + 5)
        for section, value in [('9.4', 'in_house'), ('9.5', 'outsourced')]:
            if ref.startswith(prefix + '.1.' + section + '-') and re.fullmatch(r'.*-[a-g]\)', ref):
                return {'tag': 'delivery.models', 'op': 'in', 'value': [value]}
        if ref.startswith(prefix + '.1.10.14-'):
            return {'tag': 'ops.outsourced', 'op': 'eq', 'value': 'yes'}
        tags = {f'{prefix}.1.10.3-a)': 'scope.physical_media', f'{prefix}.1.10.3-b)': 'scope.media_transport',
                f'{prefix}.1.10.1-a)': 'scope.facility_management', f'{prefix}.1.10.1-b)': 'scope.facility_management',
                f'{prefix}.1.8.4-a)': 'scope.physical_visitors'}
    else:
        tags = {'6.1.9.1-a)': 'scope.facility_management', '6.1.9.1-b)': 'scope.facility_management', '6.1.9.2': 'scope.physical_media'}
    tag = tags.get(ref)
    return {'tag': tag, 'op': 'eq', 'value': 'yes'} if tag else True
