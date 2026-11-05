"""Source questionnaire, matrix edges, drafts, evidence and revision boundaries."""
import base64

import pytest

from app import methodology
from app.domain import DomainError
from app.mlps_intake import CORE, QUESTIONS, evaluate
from conftest import register
from test_workflow import BRIEF, command


def complete():
    answers = {key: 0 for key in CORE}
    answers.update(org_name='Example', system_name='Portal', system_owner='Operations',
                   system_purpose='Improve procurement', system_functions='Approve orders', system_scenarios='Employees submit requests', security_responsible_entity='是',
                   related_assets='是', industry_specific_rules='否',
                   involves_transactions='否', public_service_nature='否', critical_business='非核心',
                   data_security_classification='一般', cross_border_data='否', external_dependency_impact='否', safety_impact='否',
                   data_volume_ranges={'records': 'under_100k', 'storage': 'under_1tb'},
                   info_rights_severity=2, service_rights_severity=1, H01='Controlled ref FUNC-1', H02='Controlled ref ARCH-1')
    return answers, {**{key: 'Reviewed incident scenario and evidence reference BIA-1.' for key in CORE}, 'security_responsible_entity': 'Example security department'}


@pytest.mark.parametrize(('obj', 'severity', 'expected'), [
    ('rights', 1, 1), ('rights', 2, 2), ('rights', 3, 3),
    ('public', 1, 2), ('public', 2, 3), ('public', 3, 4),
    ('national', 1, 3), ('national', 2, 4), ('national', 3, 5),
])
@pytest.mark.parametrize('dimension', ['info', 'service'])
def test_matrix(obj, severity, expected, dimension):
    answers, notes = complete()
    answers.update({key: 0 for key in CORE})
    answers[f'{dimension}_{obj}_severity'] = severity
    result = evaluate(answers, notes)
    assert result['base_level'] == expected
    assert result['business_information_level' if dimension == 'info' else 'system_service_level'] == expected
    assert result['matrix_rule_version'] == 'AMER-MATRIX/1'
    assert result['final_confirmed_level'] is None


def test_unknown_zero_and_population_do_not_invent_grade():
    a, notes = complete()
    a.update({key: 0 for key in CORE})
    a.update(external_network_access='存在公众可访问入口', data_categories=['个人信息'], personal_info_count_system=12000000,
             personal_info_count_operator=20000000)
    r = evaluate(a, notes)
    assert r['base_level'] is None and r['status'] == 'insufficient_impact_data'
    assert {x['code'] for x in r['alerts']} == {'T01', 'T02', 'T03'}
    a.update(info_rights_severity=1, service_public_severity=9)
    r = evaluate(a, notes)
    assert r['base_level'] == 1 and r['is_lower_bound_only']
    assert r['status'] == 'pending_review'
    del a['service_public_severity']
    assert not evaluate(a, notes)['is_lower_bound_only']


def test_rights_level_three_keeps_unknown_review_and_higher_results():
    answers, notes = complete()
    answers.update(info_rights_severity=3, service_public_severity=9)
    result = evaluate(answers, notes)
    assert result['base_level'] == 3 and result['proposed_level'] == 3
    assert result['is_lower_bound_only'] and result['status'] == 'pending_review'
    answers.update(service_public_severity=3)
    assert evaluate(answers, notes)['base_level'] == 4
    answers['service_national_severity'] = 3
    assert evaluate(answers, notes)['base_level'] == 5


def test_new_matrix_preview_and_confirmation_preserve_historical_snapshot(application, monkeypatch):
    import copy
    from app.db import System
    app, client = application
    monkeypatch.setattr(methodology, 'LEGACY_FIXTURES_ENABLED', False)
    register(client)
    sid = client.post('/api/v1/systems', json={'name': 'Versioned rights matrix'}).json()['system']['id']
    answers, notes = complete()
    body = {'scheme': 'MLPS-INTAKE/1', 'answers': answers, 'notes': notes, 'frameworks': ['MLPS_LEVEL_2']}
    confirmed = command(client, sid, 'classification-confirmations', body)
    assert confirmed.status_code == 200, confirmed.text
    # An old confirmed result used severity 3 -> level 2. Reading/previewing must not rewrite it.
    with app.state.sessions.begin() as db:
        system = db.get(System, sid)
        legacy = copy.deepcopy(system.classification)
        legacy['answers']['info_rights_severity'] = 3
        legacy['assessment'].update(rule_engine_version='1.8.2', questionnaire_version='AmerSports-2.18')
        legacy['assessment'].pop('matrix_rule_version', None)
        for row in legacy['assessment']['rule_trace']:
            if row['field'] == 'info_rights_severity':
                row['severity'] = 3
        system.classification = legacy
    path = f'/api/v1/systems/{sid}'
    before = client.get(path).json()['system']
    answers['info_rights_severity'] = 3
    preview = client.post(path + '/mlps-intake/preview', json=body)
    assert preview.status_code == 200, preview.text
    assert preview.json()['assessment']['base_level'] == 3
    assert preview.json()['assessment']['proposed_level'] == 3
    assert preview.json()['effective_level'] == 'L3'
    assert preview.json()['assessment']['rule_engine_version'] == '1.11.0'
    assert client.get(path).json()['system']['classification'] == before['classification']
    rejected = command(client, sid, 'classification-confirmations', body, expected=409)
    assert rejected.status_code == 409 and rejected.json()['code'] == 'MLPS_REFERENCE_UNAVAILABLE'
    assert client.get(path).json()['system']['classification'] == before['classification']
    updated = command(client, sid, 'classification-confirmations', {**body, 'frameworks': ['MLPS_LEVEL_3']})
    assert updated.status_code == 200, updated.text
    current = updated.json()['system']
    assert current['classification']['assessment']['base_level'] == 3
    assert current['classification']['assessment']['matrix_rule_version'] == 'AMER-MATRIX/1'
    assert current['revision'] > before['revision']


def test_boundary_contradiction_and_hidden_answers_are_not_erased():
    a, notes = complete()
    a.update(handles_personal_info='否', personal_info_count_system=100, security_responsible_entity='不确定')
    result = evaluate(a, notes)
    assert {'QA01'} == {x['code'] for x in result['issues']}
    assert a['personal_info_count_system'] == 100


def test_special_principles_need_evidence_and_do_not_change_base():
    a, notes = complete()
    a.update(target_type='云计算平台/系统', platform_grade_evidence='是',
             hosted_target_levels=[{'hosted_system_name': 'Hosted', 'confirmed_level': '4', 'evidence': ''}])
    assert evaluate(a, notes)['special_principle_minimum'] is None
    a['hosted_target_levels'][0]['evidence'] = 'Confirmed report REF-1'
    r = evaluate(a, notes)
    assert r['base_level'] == 2 and r['proposed_level'] == 2
    a.update(target_type='大数据平台/系统', large_pi_public_bigdata='两者均是', bigdata_public_service_confirmed='是')
    assert evaluate(a, notes)['special_principle_minimum'] is None
    notes['bigdata_public_service_confirmed'] = 'Expert record REF-2'
    r = evaluate(a, notes)
    assert r['special_principle_minimum'] is None
    assert r['status'] == 'preliminary_complete'
    assert not any(i['field'] == 'large_pi_public_bigdata' for i in r['issues'])


@pytest.mark.parametrize('value', [-1, 1.5, True, '100', float('inf')])
def test_invalid_person_count(value):
    with pytest.raises(DomainError):
        evaluate({'personal_info_count_system': value})


def test_schema_contains_every_source_question_and_translations():
    assert len(QUESTIONS) == 92
    assert len({q['key'] for q in QUESTIONS}) == 92
    assert all(q['zh'] and q['en'] and len(q['options']) == len(q['options_en']) for q in QUESTIONS)


def test_save_confirm_revisions_and_evidence(application, monkeypatch):
    app, client = application
    monkeypatch.setattr(methodology, 'LEGACY_FIXTURES_ENABLED', False)
    register(client)
    detail = client.post('/api/v1/systems', json={'name': 'MLPS intake'}).json()
    sid = detail['system']['id']
    path = f'/api/v1/systems/{sid}'
    config = client.get(path + '/mlps-intake').json()
    assert len(config['questions']) == 92
    a, notes = complete()
    body = {'scheme': 'MLPS-INTAKE/1', 'answers': a, 'notes': notes, 'department_contacts': {'信息安全部门': 'Security liaison'}, 'frameworks': ['MLPS_LEVEL_2'], 'catalog_id': config['catalog_id']}
    saved = client.put(path + '/mlps-intake', json={**body, 'version': detail['system']['version']})
    assert saved.status_code == 200, saved.text
    assert client.put(path + '/mlps-intake', json={**body, 'version': detail['system']['version']}).status_code == 409
    result = client.post(path + '/mlps-intake/preview', json=body).json()
    for categories, expected in [(['个人信息'], 'yes'), (['敏感个人信息'], 'yes'), (['公开信息'], 'no'), (['不确定'], 'unknown')]:
        derived = client.post(path + '/mlps-intake/preview', json={**body, 'answers': {**a, 'data_categories': categories, 'handles_personal_info': '否'}}).json()
        assert derived['facts']['data.personal'] == expected
    assert result['assessment']['status'] == 'preliminary_complete'
    assert result['effective_level'] == 'L2'
    assert result['department_contacts'] == {'信息安全部门': 'Security liaison'}
    detail = command(client, sid, 'classification-confirmations', body).json()
    assert detail['system']['classification']['scheme'] == 'MLPS-INTAKE/1'
    assert detail['system']['classification']['department_contacts'] == {'信息安全部门': 'Security liaison'}
    assert client.get(path + '/mlps-intake').json()['saved']['department_contacts'] == {'信息安全部门': 'Security liaison'}
    detail = command(client, sid, 'context-confirmations', {'context': BRIEF}).json()
    assert detail['system']['status'] == 'CONTROL_REVIEW'
    assert len([c for c in detail['controls'] if c['included']]) == 135
    blocked_upload = client.post(path + '/mlps-intake/evidence', json={'version': detail['system']['version'], 'question': 'H01', 'filename': 'proof.txt', 'content': base64.b64encode(b'Unsupported location').decode()})
    assert blocked_upload.status_code == 422
    evidence = client.post(path + '/mlps-intake/evidence', json={'version': detail['system']['version'], 'question': 'network_zones_description', 'filename': 'proof.txt', 'content': base64.b64encode(b'Original evidence').decode()})
    assert evidence.status_code == 200, evidence.text
    eid = evidence.json()['mlps_evidence']['id']
    assert client.get(path + '/mlps-intake/evidence/' + eid).content == b'Original evidence'
    other = client.post('/api/v1/systems', json={'name': 'Other'}).json()['system']['id']
    assert client.get(f'/api/v1/systems/{other}/mlps-intake/evidence/{eid}').status_code == 404
    a['service_public_severity'] = 9
    rejected = client.post(path + '/classification-confirmations', json={**body, 'version': evidence.json()['system']['version']})
    assert rejected.status_code == 409 and rejected.json()['code'] == 'MLPS_REVIEW_REQUIRED'
    changed = client.put(path + '/mlps-intake', json={**body, 'version': evidence.json()['system']['version']})
    assert changed.status_code == 200
    assert changed.json()['system']['revision'] > detail['system']['revision']
    assert not changed.json()['system']['classification']
    register(client, email='other@example.test')
    assert client.get(path + '/mlps-intake').status_code == 404
    assert client.get(path + '/mlps-intake/evidence/' + eid).status_code == 404


def test_retail_overview_accepts_departments_and_preserves_legacy_answers():
    from app.mlps_intake import validate, visible
    a, notes = complete()
    a.update(org_industry='零售', system_stage='已上线', existing_mlps_status='已定级')
    assert validate(a, notes)[0]['system_owner'] == 'Operations'
    assert [q['id'] for q in QUESTIONS if q['id'].startswith('A') and visible(q, a)] == ['A01', 'A02', 'A03', 'A04', 'A05', 'A06', 'A07', 'A08']
    a['system_owner'] = []
    assert any(i['field'] == 'system_owner' for i in evaluate(a, notes)['issues'])
    a['system_owner'] = ['零售运营', '电子商务']
    a['system_business_type'] = ['其他']
    assert any(i['code'] == 'OTHER_REQUIRED' for i in evaluate(a, notes)['issues'])
    notes['system_business_type'] = 'Sports equipment rental'
    assert evaluate(a, notes)['status'] == 'preliminary_complete'
    assert validate(a, notes)[0]['org_industry'] == '零售'


def test_amer_profile_numbering_examples_and_previous_choices():
    from app.mlps_intake import validate
    active = [q for q in QUESTIONS if not q.get('retired')]
    assert len(active) == 54
    for group in 'ABCDEFGH':
        group_questions = [q for q in active if q['id'].startswith(group) and not q.get('parent_key')]
        # Stable source IDs retain the B03 gap; the UI numbers visible questions.
        retired_ids = {'B03'} if group == 'B' else set()
        assert [q['id'] for q in group_questions] == [f'{group}{i:02}' for i in range(1, len(group_questions) + len(retired_ids) + 1) if f'{group}{i:02}' not in retired_ids]
    assert all(q['source_id'] and q['example_zh'] and q['example_en'] for q in active)
    assert next(q for q in active if q['key'] == 'system_name')['source_id'] == 'A03'
    answers = {'system_business_type': ['医疗服务'], 'user_types': ['政府机构'], 'data_categories': ['政务数据']}
    assert validate(answers, {})[0] == answers
    answers['system_business_type'] = ['门店销售与收银', '电商与全渠道订单']
    assert validate(answers, {})[0] == answers


def test_simplified_questionnaire_preserves_removed_answers_and_allows_no_integration():
    from app.mlps_intake import validate, visible
    a, notes = complete()
    for key in ('H01', 'H02', 'related_assets'):
        a.pop(key, None)
    a.update(system_interaction='否', registered_users='201–1,000 人')
    assert evaluate(a, notes)['status'] == 'preliminary_complete'
    assert validate({'registered_users': 345}, {})[0]['registered_users'] == 345
    assert validate({'registered_users': '不确定'}, {})[0]['registered_users'] == '不确定'
    assert next(q for q in QUESTIONS if q['key'] == 'system_dependencies')['id'] == 'E01'
    hidden = {'H01': 'Historical reference', 'monthly_active_users': 12, 'related_assets': '否'}
    assert validate(hidden, {})[0] == hidden
    assert all(not visible(q, a) for q in QUESTIONS if q['key'] in hidden)


@pytest.mark.parametrize('contacts', [{'Unknown department': 'Name'}, {'信息安全部门': 123}, {'信息安全部门': 'X' * 501}, {'信息安全部门': {'unknown': 'value'}}, {'信息安全部门': {'name': 123}}, {'信息安全部门': {'scope': 'X' * 501}}])
def test_department_contacts_validation(owner, contacts):
    _, client = owner
    detail = client.post('/api/v1/systems', json={'name': 'Contacts'}).json()
    response = client.put(f"/api/v1/systems/{detail['system']['id']}/mlps-intake", json={
        'version': detail['system']['version'], 'answers': {}, 'frameworks': ['MLPS_LEVEL_2'], 'department_contacts': contacts,
    })
    assert response.status_code == 422


def test_ai_application_type_keeps_impact_matrix_and_no_platform_assumptions():
    from app.mlps_intake import visible
    a, notes = complete()
    a['target_type'] = '人工智能应用'
    result = evaluate(a, notes)
    assert result['status'] == 'preliminary_complete'
    assert result['base_level'] == 2
    assert result['special_principle_minimum'] is None
    assert not any(visible(q, a) for q in QUESTIONS if q['key'] in ('hosted_target_levels', 'special_target_boundary', 'large_pi_public_bigdata'))


def test_network_split_preserves_original_and_accepts_independent_answers():
    from app.mlps_intake import validate, visible
    fields = ['network_zones_description', 'internet_entry_description', 'external_connections_description', 'system_interfaces_description']
    active = [q for q in QUESTIONS if not q.get('retired')]
    assert [(q['id'], q['key']) for q in active if q['key'] in fields] == [(f'B{i:02}', key) for i, key in enumerate(fields, 7)]
    old = next(q for q in QUESTIONS if q['key'] == 'network_boundary_description')
    assert not visible(old, {})
    answers = {'network_boundary_description': 'Original authored description', **{key: f'Answer {i}' for i, key in enumerate(fields)}}
    assert validate(answers, {})[0] == answers


def test_user_count_has_four_ranges_plus_unknown_and_preserves_previous_answers():
    from app.mlps_intake import validate
    q = next(q for q in QUESTIONS if q['key'] == 'registered_users')
    assert q['options'] == ['0–100 人', '101–1,000 人', '1,001–10,000 人', '超过 10,000 人', '不确定']
    for value in q['options'] + ['201–1,000 人', 345]:
        assert validate({'registered_users': value}, {})[0]['registered_users'] == value


def test_g_retirement_does_not_block_or_apply_hidden_answers():
    from app.mlps_intake import visible
    a, notes = complete()
    a.pop('industry_specific_rules')
    assert evaluate(a, notes)['status'] == 'preliminary_complete'
    a.update(industry_specific_rules='是', cii_status='正式认定', previous_grade='5')
    result = evaluate(a, notes)
    assert result['status'] == 'preliminary_complete'
    assert result['base_level'] == 2
    assert result['sector_rules_status'] == 'not_collected'
    assert not any(visible(q, a) for q in QUESTIONS if q['source_id'].startswith('G'))
    assert a['industry_specific_rules'] == '是'  # Authored data was not mutated.


def test_yes_requires_responsible_name_but_allows_incomplete_drafts():
    a, notes = complete()
    notes['security_responsible_entity'] = '  '
    result = evaluate(a, notes)
    assert result['status'] == 'pending_review'
    assert any(i['code'] == 'RESPONSIBLE_NAME_REQUIRED' for i in result['issues'])
    notes['security_responsible_entity'] = 'Information security department'
    assert evaluate(a, notes)['status'] == 'preliminary_complete'
    a['security_responsible_entity'] = '否'
    assert not any(i['code'] == 'RESPONSIBLE_NAME_REQUIRED' for i in evaluate(a, notes)['issues'])
    assert notes['security_responsible_entity'] == 'Information security department'


def test_description_split_uses_three_required_fields_and_keeps_legacy_text():
    from app.mlps_intake import validate, visible
    fields = ('system_purpose', 'system_functions', 'system_scenarios')
    active = [q for q in QUESTIONS if not q.get('retired')]
    assert [(q['id'], q['key']) for q in active if q['key'] in fields] == [('A04', fields[0]), ('A05', fields[1]), ('A06', fields[2])]
    assert all(q['required'] and q['ai_topic'] for q in active if q['key'] in fields)
    old = next(q for q in QUESTIONS if q['key'] == 'system_description')
    assert not visible(old, {})
    assert validate({'system_description': 'Original combined text'}, {})[0]['system_description'] == 'Original combined text'
    a, notes = complete()
    del a['system_functions']
    assert any(i['field'] == 'system_functions' for i in evaluate(a, notes)['issues'])


@pytest.mark.parametrize(('band', 'expected'), [('0 人', set()), ('1–99,999 人', set()), ('100,000–999,999 人', set()), ('1,000,000–9,999,999 人', {'T02'}), ('10,000,000 人及以上', {'T02', 'T03'}), ('不确定', set())])
def test_historical_person_ranges_keep_lower_bound_scale_alerts(band, expected):
    a, notes = complete()
    a.update(data_categories=['个人信息'], personal_info_count_system=band, personal_info_count_operator=20000000)
    r = evaluate(a, notes)
    assert {i['code'] for i in r['alerts']} == expected
    assert r['base_level'] == 2
    assert r['status'] == ('pending_review' if band in ('不确定', '1–99,999 人') else 'preliminary_complete')


def test_person_visibility_contradictions_and_separate_volume_ranges():
    from app.mlps_intake import validate, visible
    q = next(q for q in QUESTIONS if q['key'] == 'personal_info_count_system')
    assert not visible(q, {}) and not visible(q, {'handles_personal_info': '不确定'})
    assert not visible(q, {'handles_personal_info': '是'})
    assert visible(q, {'data_categories': ['个人信息']})
    a, notes = complete()
    a.update(handles_personal_info='否', personal_info_count_system='1–99,999 人')
    assert not any(i['code'] == 'QA03' for i in evaluate(a, notes)['issues'])
    a.update(data_categories=['敏感个人信息'], sensitive_pi_count=100000)
    assert any(i['field'] == 'sensitive_pi_count' for i in evaluate(a, notes)['issues'])
    a['personal_info_count_system'] = '100,000–999,999 人'
    assert not any(i['field'] == 'sensitive_pi_count' for i in evaluate(a, notes)['issues'])
    old = [{'amount': '200000', 'unit': '记录'}, {'amount': '3', 'unit': 'TB'}]
    raw = {'data_volume_records': old, 'data_volume_ranges': {'records': '100k_1m', 'storage': '1_10tb'}}
    assert validate(raw, {})[0] == raw
    with pytest.raises(DomainError):
        validate({'data_volume_ranges': {'records': '1_10tb'}}, {})
    with pytest.raises(DomainError):
        validate({'data_volume_ranges': {'storage': 10}}, {})


def test_person_count_subquestion_has_finer_ranges_and_keeps_previous_bounds():
    from app.mlps_intake import POPULATION_POLICY, person_bounds, validate
    q = next(q for q in QUESTIONS if q['key'] == 'personal_info_count_system')
    assert q['parent_key'] == 'data_categories' and q['id'] == 'D01.1'
    assert q['options'] == ['0–9,999 人', '10,000–99,999 人', '100,000 人及以上', '不确定']
    assert q['options'][:-1] == [band['zh'] for band in POPULATION_POLICY['bands']]
    assert q['options_en'][:-1] == [band['en'] for band in POPULATION_POLICY['bands']]
    assert all(person_bounds(band['zh']) == [band['lower'], band['upper']] for band in POPULATION_POLICY['bands'])
    assert '0 人' not in q['options'] and '0 人' in q['legacy_options']
    assert person_bounds('101–1,000 人') == [101, 1000]
    assert person_bounds('1–99,999 人') == [1, 99999]
    assert '超过 50,000 人' not in q['options']
    assert '超过 50,000 人' in q['legacy_options']
    for value in q['options'] + q['legacy_options'] + [50000]:
        assert validate({'personal_info_count_system': value}, {})[0]['personal_info_count_system'] == value


def test_removed_loss_question_preserves_history_without_affecting_grade():
    from app.mlps_intake import validate, visible
    q = next(q for q in QUESTIONS if q['key'] == 'financial_loss_estimate')
    assert not visible(q, {})
    answers, notes = complete()
    before = evaluate(answers, notes)
    answers['financial_loss_estimate'] = [{'scenario': 'Historical outage', 'amount_rmb': '50000', 'basis': 'Original estimate'}]
    assert validate(answers, notes)[0]['financial_loss_estimate'] == answers['financial_loss_estimate']
    assert evaluate(answers, notes) == before


def test_recovery_targets_preserve_downtime_and_validate_independent_values():
    from app.mlps_intake import validate, visible
    q = next(q for q in QUESTIONS if q['key'] == 'maximum_tolerable_downtime_h')
    assert not visible(q, {})
    raw = {'maximum_tolerable_downtime_h': 8, 'recovery_objectives_h': {'rto': 4, 'rpo': 0.5}}
    assert validate(raw, {})[0] == raw
    assert validate({'recovery_objectives_h': {'rto': 0, 'rpo': '不确定'}}, {})[0]['recovery_objectives_h']['rto'] == 0
    for values in [{'rto': -1}, {'rpo': float('nan')}, {'rto': True}, {'rpo': '4'}, {'other': 1}]:
        with pytest.raises(DomainError):
            validate({'recovery_objectives_h': values}, {})


def test_impact_section_merge_retires_only_scenarios_and_keeps_matrix_inputs():
    from app.mlps_intake import visible, validate
    removed = [q for q in QUESTIONS if q['source_id'] in ('F01', 'F02', 'F03', 'F04', 'F05', 'F06')]
    assert len(removed) == 6 and all(not visible(q, {}) for q in removed)
    for key in CORE:
        q = next(q for q in QUESTIONS if q['key'] == key)
        assert visible(q, {}) and q['id'] == ('E09' if key.startswith('info_') else 'E10')
    answers, notes = complete()
    before = evaluate(answers, notes)
    answers.update(scenario_disclosure='Historical scenario', impact_evidence='Historical evidence')
    assert validate(answers, notes)[0]['scenario_disclosure'] == 'Historical scenario'
    assert evaluate(answers, notes) == before


def test_saved_demo_snapshot_is_valid_scoped_and_independent():
    from app.mlps_intake import DEMO_TEMPLATE, demo_template_for_org, validate, visible
    org = DEMO_TEMPLATE['source_org_id']
    demo = demo_template_for_org(org)
    assert demo and demo_template_for_org('another-organization') is None
    assert validate(demo['answers'], demo['notes'])[0] == demo['answers']
    assert all(not next(q for q in QUESTIONS if q['key'] == key).get('retired') for key in demo['answers'])
    main = [q for q in QUESTIONS if not q.get('parent_key') and visible(q, demo['answers'])]
    assert len(main) == DEMO_TEMPLATE['visible_question_count'] == 44
    assert sum(q['key'] in demo['answers'] for q in main) == 44
    assert demo['answers']['involves_transactions'] in ('是', '否', '不确定')
    assert 'evidence:' not in str(demo)
    original = demo['answers']['system_name']
    demo['answers']['system_name'] = 'Changed'
    assert demo_template_for_org(org)['answers']['system_name'] == original


def test_grading_demo_retains_the_requested_assessment_snapshot_and_source_hash():
    from app.domain import digest
    from app.mlps_intake import DEMO_TEMPLATE, GRADING_FIELDS, evaluate_grading
    template = DEMO_TEMPLATE['template']
    source = DEMO_TEMPLATE['grading_source']
    captured = {part: {key: value for key, value in template[part].items() if key in GRADING_FIELDS} for part in ('answers', 'notes')}
    assert source['source_system_id'] == '024b425f-8b89-42b4-9e6d-a5884243c187'
    assert source['source_org_id'] == DEMO_TEMPLATE['source_org_id']
    assert source['source_system_version'] > 0 and source['source_revision'] > 0
    assert source['source_hash'] == digest(captured)
    assert source['visible_question_count'] == 14
    assert captured['notes']['security_responsible_entity'] == 'PwC Cyber '
    assert evaluate_grading(captured['answers'], captured['notes'])['status'] == 'preliminary_complete'
    assert template['answers']['system_name'] == '户外运动与产品介绍AI客服'
    assert template['department_contacts']['零售运营']['name'] == 'Alice'


def test_impact_demo_retains_both_authored_judgments_and_separate_provenance():
    from app.domain import digest
    from app.mlps_intake import DEMO_TEMPLATE
    source = DEMO_TEMPLATE['impact_source']
    captured = {part: {key: DEMO_TEMPLATE['template'][part][key] for key in source['fields']}
                for part in ('answers', 'notes')}
    assert source['question_ids'] == ['G13', 'G14']
    assert source['source_system_id'] == '3e1a517d-37fe-42c8-a2b4-932b1d60052a'
    assert source['source_hash'] == digest(captured)
    for dimension in ('info', 'service'):
        assert captured['answers'][f'{dimension}_rights_severity'] == 1
        assert captured['answers'][f'{dimension}_public_severity'] == 0
        assert captured['answers'][f'{dimension}_national_severity'] == 0
        assert captured['notes'][f'{dimension}_rights_severity'] == '系统不涉及核心业务流程，主要作为辅助用途。不涉及个人敏感信息，不涉及重要信息，不涉及核心信息'


def test_information_demo_pins_all_thirty_answers_contacts_and_reusable_topology():
    import hashlib
    from app.domain import digest
    from app.evidence_service import validate_file
    from app.mlps_intake import DEMO_TEMPLATE, GRADING_FIELDS, demo_template_for_org, visible
    source = DEMO_TEMPLATE['information_source']
    demo = demo_template_for_org(DEMO_TEMPLATE['source_org_id'])
    captured = {part: {key: value for key, value in demo[part].items() if key not in GRADING_FIELDS} for part in ('answers', 'notes')}
    captured.update(department_contacts=demo['department_contacts'], evidence_assets=DEMO_TEMPLATE['evidence_assets'])
    assert source['source_hash'] == digest(captured)
    assert source['source_system_id'] == DEMO_TEMPLATE['grading_source']['source_system_id']
    main = [q for q in QUESTIONS if not q.get('parent_key') and q['key'] not in GRADING_FIELDS and visible(q, demo['answers'])]
    assert len(main) == source['visible_question_count'] == 30
    assert source['section_counts'] == {'A': 8, 'B': 11, 'C': 2, 'D': 3, 'E': 6}
    assert len(captured['answers']) == 30 and all(q['key'] in captured['answers'] for q in main)
    assert demo['department_contacts']['零售运营']['contact_method'] == 'alice.retail@example.com'
    asset = demo['evidence_assets'][0]
    content = base64.b64decode(asset['content'])
    assert hashlib.sha256(content).hexdigest() == DEMO_TEMPLATE['evidence_assets'][0]['sha256']
    assert validate_file(asset['filename'], content)[1] == 'image/png'
    assert 'source_evidence_id' not in asset and 'evidence:' not in str(demo['notes'])
    assert demo_template_for_org('unrelated-organization') is None


def test_demo_topology_upload_uses_independent_assessment_refs_and_revision_checks(owner):
    from app.mlps_intake import DEMO_TEMPLATE, demo_template_for_org
    _, client = owner
    asset = demo_template_for_org(DEMO_TEMPLATE['source_org_id'])['evidence_assets'][0]
    systems = [client.post('/api/v1/systems', json={'name': name}).json()['system'] for name in ('Demo target A', 'Demo target B')]
    refs = []
    for system in systems:
        path = f"/api/v1/systems/{system['id']}"
        uploaded = client.post(path + '/mlps-intake/evidence', json={**asset, 'version': system['version']})
        assert uploaded.status_code == 200, uploaded.text
        ref = uploaded.json()['mlps_evidence']['id']
        refs.append(ref)
        assert ref != DEMO_TEMPLATE['evidence_assets'][0]['source_evidence_id']
        assert client.get(path + '/mlps-intake/evidence/' + ref).content == base64.b64decode(asset['content'])
        assert client.post(path + '/mlps-intake/evidence', json={**asset, 'version': system['version']}).status_code == 409
    assert refs[0] != refs[1]
    assert client.get(f"/api/v1/systems/{systems[1]['id']}/mlps-intake/evidence/{refs[0]}").status_code == 404


def test_transactions_are_informational_and_registered_users_relocate_without_data_changes():
    from app.mlps_intake import validate, visible
    registered = next(q for q in QUESTIONS if q['key'] == 'registered_users')
    assert registered['id'] == 'D02' and registered['source_id'] == 'C02'
    transaction = next(q for q in QUESTIONS if q['key'] == 'involves_transactions')
    assert transaction['id'] == 'C02' and transaction['options'] == ['是', '否', '不确定']
    answers, notes = complete()
    before = evaluate(answers, notes)
    for value in transaction['options']:
        answers['involves_transactions'] = value
        assert validate(answers, notes)[0]['involves_transactions'] == value
        result = evaluate(answers, notes)
        assert result['base_level'] == before['base_level']
        assert result['organization_minimum'] == (2 if value == '是' else 1)
        assert (result['status'] == 'pending_review') == (value == '不确定')
    answers['registered_users'] = 345
    assert validate(answers, notes)[0]['registered_users'] == 345
    assert visible(registered, answers)


def test_user_count_is_d03_before_remaining_privacy_questions():
    active = [q for q in QUESTIONS if q['id'].startswith('D') and not q.get('retired') and not q.get('parent_key')]
    assert [q['key'] for q in active[:4]] == ['data_categories', 'registered_users', 'pi_subject_scope', 'data_volume_ranges']
    assert [q['id'] for q in active] == [f'D{i:02}' for i in range(1, len(active) + 1)]


def test_legacy_person_count_five_bands_keep_bounds_and_threshold_alerts():
    from app.mlps_intake import person_bounds
    bands = ['0–1,000 人', '1,001–10,000 人', '10,001–100,000 人', '100,001–1,000,000 人', '超过 1,000,000 人']
    bounds = [person_bounds(value) for value in bands]
    assert bounds == [[0, 1000], [1001, 10000], [10001, 100000], [100001, 1000000], [1000001, None]]
    assert all(left[1] + 1 == right[0] for left, right in zip(bounds, bounds[1:]))
    answers, notes = complete()
    for value, expected_alert in [(bands[3], False), (bands[4], True)]:
        answers.update(data_categories=['个人信息'], personal_info_count_system=value)
        result = evaluate(answers, notes)
        assert any(a['code'] == 'T02' for a in result['alerts']) == expected_alert
        assert not any(a['code'] == 'T03' for a in result['alerts'])
    assert person_bounds('1,000,000–9,999,999 人') == [1000000, 9999999]


@pytest.mark.parametrize(('categories', 'expected'), [(['个人信息'], '是'), (['敏感个人信息'], '是'), (['公开信息'], '否'), (['不确定'], '不确定')])
def test_d01_categories_override_retired_personal_flag(categories, expected):
    from app.mlps_intake import personal_info_status
    answers = {'data_categories': categories, 'handles_personal_info': '否' if expected == '是' else '是'}
    assert personal_info_status(answers) == expected


def test_data_details_are_nested_conditional_preserved_and_required_when_selected():
    from app.mlps_intake import visible, validate
    by = {q['key']: q for q in QUESTIONS}
    assert not visible(by['handles_personal_info'], {})
    children = ('personal_info_count_system', 'sensitive_pi_types', 'sensitive_pi_count', 'important_data_basis', 'core_data_details')
    assert all(by[key]['parent_key'] == 'data_categories' for key in children)
    answers, notes = complete()
    answers.update(data_categories=['敏感个人信息', '重要数据', '核心数据'], handles_personal_info='否')
    assert all(visible(by[key], answers) for key in children)
    missing = {i['field'] for i in evaluate(answers, notes)['issues'] if i['code'] == 'REQUIRED'}
    assert set(children) <= missing
    answers.update(personal_info_count_system='0–1,000 人', sensitive_pi_types=['医疗健康'], sensitive_pi_count=10, important_data_basis='Important dataset description', core_data_details='Core dataset description')
    assert not any(i['field'] in children for i in evaluate(answers, notes)['issues'])
    assert any(i['code'] == 'T06' for i in evaluate(answers, notes)['alerts'])
    answers['data_categories'] = ['公开信息']
    assert all(not visible(by[key], answers) for key in children)
    assert not any(i['code'] in ('QA03', 'T02', 'T03', 'T05', 'T06') for i in evaluate(answers, notes)['issues'] + evaluate(answers, notes)['alerts'])
    assert validate(answers, notes)[0]['core_data_details'] == 'Core dataset description'


@pytest.mark.parametrize(('answer', 'floor'), [('仅经VPN/零信任接入', 3), ('存在受控互联网入口', 2), ('存在公众可访问入口', 2), ('无', 1)])
def test_internal_network_minimum_is_separate_from_national_matrix(answer, floor):
    answers, notes = complete()
    answers.update(info_rights_severity=1, external_network_access=answer)
    result = evaluate(answers, notes)
    assert result['base_level'] == 1
    assert result['organization_minimum'] == (floor or 1)
    assert result['proposed_level'] == (floor or 1)
    assert result['organization_rule_version'] == 'AMER-INTERNAL/7'
    assert [row['field'] for row in result['organization_rule_trace'] if row['code'] == 'AMER-NET-MIN'] == (['external_network_access'] if floor else [])


@pytest.mark.parametrize('grade', [1, 2, 3, 4, 5])
def test_connected_grade_floor_applies_only_when_interaction_is_yes(grade):
    from app.mlps_intake import visible
    answers, notes = complete()
    answers.update(system_interaction='是', interconnected_system_level=f'{grade} 级')
    result = evaluate(answers, notes)
    assert result['base_level'] == 2 and result['proposed_level'] == max(2, grade)
    assert result['organization_minimum'] == grade
    q = next(q for q in QUESTIONS if q['key'] == 'interconnected_system_level')
    assert visible(q, answers) and q['parent_key'] == 'system_interaction'
    answers['system_interaction'] = '否'
    hidden = evaluate(answers, notes)
    assert not visible(q, answers) and hidden['organization_minimum'] == 1 and hidden['proposed_level'] == 2
    assert answers['interconnected_system_level'] == f'{grade} 级'


def test_custom_minima_take_maximum_and_do_not_resolve_unknown_impacts():
    answers, notes = complete()
    answers.update(system_interaction='是', interconnected_system_level='2 级', external_network_access='仅经VPN/零信任接入')
    result = evaluate(answers, notes)
    assert result['base_level'] == 2 and result['proposed_level'] == 3
    assert [r['level'] for r in result['organization_rule_trace'] if r['field'] in ('interconnected_system_level', 'external_network_access')] == [2, 3]
    answers['info_public_severity'] = 3
    assert evaluate(answers, notes)['proposed_level'] == 4
    answers.update(info_public_severity=9)
    pending = evaluate(answers, notes)
    assert pending['proposed_level'] == 3 and pending['status'] == 'pending_review' and pending['is_lower_bound_only']
    answers.update({key: 0 for key in CORE})
    insufficient = evaluate(answers, notes)
    assert insufficient['proposed_level'] == 3 and insufficient['base_level'] is None
    assert insufficient['status'] == 'insufficient_impact_data'


def test_unknown_internal_minima_block_confirmation_and_invalid_grades_are_rejected():
    from app.mlps_intake import validate
    answers, notes = complete()
    answers.update(system_interaction='是', interconnected_system_level='不确定', external_network_access='不确定')
    result = evaluate(answers, notes)
    assert result['status'] == 'pending_review' and result['is_lower_bound_only']
    assert {'LINK_GRADE_UNKNOWN', 'NETWORK_MIN_UNKNOWN'} <= {i['code'] for i in result['issues']}
    answers.pop('interconnected_system_level')
    assert any(i['code'] == 'REQUIRED' and i['field'] == 'interconnected_system_level' for i in evaluate(answers, notes)['issues'])
    with pytest.raises(DomainError):
        validate({'interconnected_system_level': '6 级'}, {})


def test_internal_minimum_is_saved_as_effective_grade_and_reference_checks_remain(application):
    _, client = application
    register(client)
    detail = client.post('/api/v1/systems', json={'name': 'Internal minimum'}).json()
    path = f"/api/v1/systems/{detail['system']['id']}"
    config = client.get(path + '/mlps-intake').json()
    answers, notes = complete()
    answers.update(system_interaction='是', interconnected_system_level='3 级', external_network_access='存在受控互联网入口')
    payload = {'scheme': 'MLPS-INTAKE/1', 'version': detail['system']['version'], 'answers': answers, 'notes': notes, 'frameworks': ['MLPS_LEVEL_2'], 'catalog_id': config['catalog_id']}
    previewed = client.post(path + '/mlps-intake/preview', json=payload).json()
    assert previewed['assessment']['base_level'] == 2 and previewed['effective_level'] == 'L3'
    rejected = client.post(path + '/classification-confirmations', json=payload)
    assert rejected.status_code == 409 and rejected.json()['code'] == 'MLPS_REFERENCE_UNAVAILABLE'
    accepted = client.post(path + '/classification-confirmations', json={**payload, 'frameworks': ['MLPS_LEVEL_3']})
    assert accepted.status_code == 200, accepted.text
    classification = accepted.json()['system']['classification']
    assert classification['effective_level'] == 'L3'
    assert classification['assessment']['organization_rule_trace'][0]['level'] == 3


@pytest.mark.parametrize(('field', 'value', 'floor'), [('public_service_nature', '是', 2), ('involves_transactions', '是', 2), ('critical_business', '非核心', 1), ('critical_business', '重要辅助', 2), ('critical_business', '主要业务核心', 3)])
def test_service_transaction_and_importance_minima(field, value, floor):
    answers, notes = complete()
    answers.update(info_rights_severity=1, **{field: value})
    result = evaluate(answers, notes)
    assert result['base_level'] == 1 and result['proposed_level'] == floor
    assert any(row['field'] == field and row['level'] == floor for row in result['organization_rule_trace'])


@pytest.mark.parametrize(('value', 'floor', 'alerts'), [(0, 1, set()), (1, 1, set()), (9999, 1, set()), (10000, 2, set()), (10001, 2, set()), (50000, 2, set()), (50001, 2, set()), (99999, 2, set()), (100000, 3, set()), (999999, 3, set()), (1000000, 3, {'T02'}), (9999999, 3, {'T02'}), (10000000, 3, {'T02', 'T03'}), ('0–9,999 人', 1, set()), ('10,000–99,999 人', 2, set()), ('100,000 人及以上', 3, set()), ('0 人', 1, set()), ('100,000–999,999 人', 3, set()), ('1,000,000–9,999,999 人', 3, {'T02'}), ('10,000,000 人及以上', 3, {'T02', 'T03'}), ('10,001–50,000 人', 2, set())])
def test_population_minima_use_exact_boundaries_and_current_visible_scope(value, floor, alerts):
    answers, notes = complete()
    answers.update(info_rights_severity=1, data_categories=['个人信息'], personal_info_count_system=value)
    result = evaluate(answers, notes)
    assert result['base_level'] == 1 and result['proposed_level'] == floor
    assert result['status'] == 'preliminary_complete'
    assert {row['code'] for row in result['alerts']} == alerts
    population = next(row for row in result['organization_rule_trace'] if row['code'] == 'AMER-POPULATION-MIN')
    assert population['level'] == floor and population['answer'] == value
    assert result['population_rule_version'] == 'AMER-POPULATION/1'
    answers['data_categories'] = ['公开信息']
    hidden = evaluate(answers, notes)
    assert hidden['proposed_level'] == 1
    assert all(row['code'] != 'AMER-POPULATION-MIN' for row in hidden['organization_rule_trace'])


@pytest.mark.parametrize(('value', 'lower_bound'), [('0–10,000 人', 1), ('1–99,999 人', 1), ('10,001–100,000 人', 2), ('超过 50,000 人', 2)])
def test_historical_population_ranges_crossing_new_grade_boundaries_remain_pending(value, lower_bound):
    answers, notes = complete()
    answers.update(info_rights_severity=1, data_categories=['个人信息'], personal_info_count_system=value)
    result = evaluate(answers, notes)
    assert result['proposed_level'] == lower_bound
    assert result['status'] == 'pending_review' and result['is_lower_bound_only']
    assert any(row['code'] == 'POPULATION_RANGE_REVIEW' for row in result['issues'])
    answers['personal_info_count_system'] = '100,000 人及以上'
    assert evaluate(answers, notes)['status'] == 'preliminary_complete'


@pytest.mark.parametrize('value', ['0–9,999 人', '10,000–99,999 人', '100,000 人及以上'])
def test_population_minimum_cannot_lower_higher_impacts_or_resolve_unknowns(value):
    answers, notes = complete()
    answers.update(data_categories=['个人信息'], personal_info_count_system=value, info_public_severity=3)
    higher = evaluate(answers, notes)
    assert higher['base_level'] == 4 and higher['proposed_level'] == 4
    answers['info_public_severity'] = 9
    unknown = evaluate(answers, notes)
    assert unknown['status'] == 'pending_review' and unknown['is_lower_bound_only']
    assert any(row['code'] == 'QA02' for row in unknown['issues'])


def test_historical_population_band_and_removed_business_choice_require_reconfirmation():
    from app.mlps_intake import validate
    answers, notes = complete()
    answers.update(data_categories=['个人信息'], personal_info_count_system='超过 50,000 人', critical_business='核心公共服务/关键生产')
    assert validate(answers, notes)[0] == answers
    result = evaluate(answers, notes)
    assert {'POPULATION_RANGE_REVIEW', 'BUSINESS_MIN_REVIEW'} <= {i['code'] for i in result['issues']}
    assert result['is_lower_bound_only'] and result['status'] == 'pending_review'
    q = next(q for q in QUESTIONS if q['key'] == 'critical_business')
    assert '核心公共服务/关键生产' not in q['options']
    assert '核心公共服务/关键生产' in q['legacy_options']


def test_new_internal_unknowns_remain_pending_and_high_matrix_still_wins():
    answers, notes = complete()
    answers.update(involves_transactions='不确定', public_service_nature='不确定', critical_business='不确定', data_categories=['个人信息'], personal_info_count_system='不确定')
    result = evaluate(answers, notes)
    assert {'TRANSACTION_MIN_UNKNOWN', 'SERVICE_MIN_UNKNOWN', 'BUSINESS_MIN_UNKNOWN', 'POPULATION_UNKNOWN'} <= {i['code'] for i in result['issues']}
    assert result['is_lower_bound_only'] and result['status'] == 'pending_review'
    answers.update(involves_transactions='是', public_service_nature='是', critical_business='主要业务核心', personal_info_count_system='超过 50,000 人', info_public_severity=3)
    result = evaluate(answers, notes)
    assert result['base_level'] == 4 and result['proposed_level'] == 4 and result['organization_minimum'] == 3


def test_population_minimum_is_persisted_and_rejects_a_lower_reference(application):
    _, client = application
    register(client)
    detail = client.post('/api/v1/systems', json={'name': 'Population impact evidence'}).json()
    path = f"/api/v1/systems/{detail['system']['id']}"
    config = client.get(path + '/mlps-intake').json()
    answers, notes = complete()
    answers.update(info_rights_severity=1, data_categories=['个人信息'], personal_info_count_system='100,000 人及以上')
    payload = {'scheme': 'MLPS-INTAKE/1', 'version': detail['system']['version'], 'answers': answers, 'notes': notes, 'frameworks': ['MLPS_LEVEL_3'], 'catalog_id': config['catalog_id']}
    rejected = client.post(path + '/classification-confirmations', json={**payload, 'frameworks': ['MLPS_LEVEL_2']})
    assert rejected.status_code == 409 and rejected.json()['code'] == 'MLPS_REFERENCE_UNAVAILABLE'
    accepted = client.post(path + '/classification-confirmations', json=payload)
    assert accepted.status_code == 200, accepted.text
    classification = accepted.json()['system']['classification']
    assert classification['effective_level'] == 'L3'
    assessment = classification['assessment']
    assert assessment['base_level'] == 1 and assessment['organization_minimum'] == 3
    assert any(row['code'] == 'AMER-POPULATION-MIN' and row['level'] == 3 for row in assessment['organization_rule_trace'])
    assert classification['answers']['personal_info_count_system'] == '100,000 人及以上'
    assert assessment['population_rule_version'] == 'AMER-POPULATION/1'


def test_population_preview_does_not_rewrite_a_historical_confirmed_grade(owner):
    import copy
    from app.db import System
    app, client = owner
    sid = client.post('/api/v1/systems', json={'name': 'Historical population grade'}).json()['system']['id']
    answers, notes = complete()
    answers.update(info_rights_severity=1, data_categories=['个人信息'], personal_info_count_system='超过 50,000 人')
    old = {'scheme': 'MLPS-INTAKE/1', 'effective_level': 'L1', 'answers': copy.deepcopy(answers), 'notes': notes,
           'assessment': {'base_level': 1, 'proposed_level': 1, 'organization_minimum': 1, 'rule_engine_version': '1.10.0',
                          'organization_rule_trace': []}}
    with app.state.sessions.begin() as db:
        db.get(System, sid).classification = old
    path = f'/api/v1/systems/{sid}'
    before = client.get(path).json()['system']
    preview = client.post(path + '/mlps-intake/preview', json={'answers': {**answers, 'personal_info_count_system': '100,000 人及以上'}, 'notes': notes, 'frameworks': ['MLPS_LEVEL_3']})
    assert preview.status_code == 200, preview.text
    assessment = preview.json()['assessment']
    assert assessment['proposed_level'] == 3
    assert assessment['rule_engine_version'] == '1.11.0'
    assert any(row['code'] == 'AMER-POPULATION-MIN' for row in assessment['organization_rule_trace'])
    after = client.get(path).json()['system']
    assert after['classification'] == old == before['classification']
    assert after['version'] == before['version'] and after['revision'] == before['revision']


def test_external_responsibility_and_public_internet_copy_preserve_stable_answers():
    from app.mlps_intake import validate
    responsibility = next(q for q in QUESTIONS if q['key'] == 'security_responsible_entity')
    network = next(q for q in QUESTIONS if q['key'] == 'external_network_access')
    assert '哪一家外部单位' in responsibility['zh']
    index = network['options'].index('存在公众可访问入口')
    assert network['options_zh'][index] == '公网可访问入口'
    assert network['options_en'][index] == 'Public internet ingress'
    assert len(network['options_zh']) == len(network['options'])
    answers, notes = complete()
    answers['external_network_access'] = '存在公众可访问入口'
    notes['security_responsible_entity'] = 'Original authored department / company'
    assert validate(answers, notes) == (answers, notes)
    result = evaluate(answers, notes)
    row = next(row for row in result['organization_rule_trace'] if row['code'] == 'AMER-NET-MIN')
    assert row['level'] == 2 and row['answer'] == '存在公众可访问入口'


@pytest.mark.parametrize(('value', 'floor'), [('一般', 1), ('重要', 3), ('核心', 3), ('混合', 3)])
def test_data_classification_minima(value, floor):
    answers, notes = complete()
    answers.update(info_rights_severity=1, data_security_classification=value)
    result = evaluate(answers, notes)
    assert result['base_level'] == 1 and result['proposed_level'] == floor
    assert any(row['code'] == 'AMER-DATA-CLASS-MIN' and row['level'] == floor for row in result['organization_rule_trace'])


@pytest.mark.parametrize(('field', 'floor'), [('cross_border_data', 2), ('external_dependency_impact', 2), ('safety_impact', 3)])
def test_cross_border_dependency_and_safety_minima(field, floor):
    answers, notes = complete()
    answers.update(info_rights_severity=1, **{field: '是'})
    result = evaluate(answers, notes)
    assert result['base_level'] == 1 and result['proposed_level'] == floor
    assert any(row['field'] == field and row['level'] == floor for row in result['organization_rule_trace'])


@pytest.mark.parametrize(('group', 'value', 'floor'), [
    ('records', 'under_100k', 1), ('records', '100k_1m', 2), ('records', '1m_10m', 3), ('records', 'over_10m', 3),
    ('storage', 'under_1tb', 1), ('storage', '1_10tb', 2), ('storage', '10_100tb', 3), ('storage', 'over_100tb', 3),
])
def test_volume_minima_use_both_ranges_independently(group, value, floor):
    answers, notes = complete()
    answers['info_rights_severity'] = 1
    answers['data_volume_ranges'][group] = value
    result = evaluate(answers, notes)
    assert result['base_level'] == 1 and result['proposed_level'] == floor
    trace = [row for row in result['organization_rule_trace'] if row['field'] == 'data_volume_ranges']
    assert len(trace) == 2
    assert any(row['subfield'] == group and row['answer'] == value and row['level'] == floor for row in trace)


def test_new_policy_unknowns_and_volume_partial_answers_remain_pending():
    answers, notes = complete()
    answers.update(data_security_classification='尚未评估', cross_border_data='不确定', external_dependency_impact='不确定', safety_impact='不确定', data_volume_ranges={'records': 'unknown', 'storage': 'unknown'})
    result = evaluate(answers, notes)
    assert {'DATA_CLASS_MIN_UNKNOWN', 'CROSS_BORDER_MIN_UNKNOWN', 'DEPENDENCY_MIN_UNKNOWN', 'SAFETY_MIN_UNKNOWN', 'RECORDS_MIN_UNKNOWN', 'STORAGE_MIN_UNKNOWN'} <= {i['code'] for i in result['issues']}
    assert result['status'] == 'pending_review' and result['is_lower_bound_only']
    answers['data_volume_ranges'] = {'records': 'under_100k'}
    assert any(i['code'] == 'STORAGE_MIN_UNKNOWN' for i in evaluate(answers, notes)['issues'])


def test_data_volume_floor_is_persisted_and_does_not_replace_matrix(application):
    _, client = application
    register(client)
    detail = client.post('/api/v1/systems', json={'name': 'Volume minimum'}).json()
    path = f"/api/v1/systems/{detail['system']['id']}"
    config = client.get(path + '/mlps-intake').json()
    answers, notes = complete()
    answers.update(info_rights_severity=1, data_volume_ranges={'records': 'under_100k', 'storage': '10_100tb'})
    payload = {'scheme': 'MLPS-INTAKE/1', 'version': detail['system']['version'], 'answers': answers, 'notes': notes, 'frameworks': ['MLPS_LEVEL_3'], 'catalog_id': config['catalog_id']}
    response = client.post(path + '/classification-confirmations', json=payload)
    assert response.status_code == 200, response.text
    saved = response.json()['system']['classification']
    assert saved['effective_level'] == 'L3' and saved['assessment']['base_level'] == 1
    assert any(row['code'] == 'AMER-STORAGE-MIN' and row['level'] == 3 for row in saved['assessment']['organization_rule_trace'])
    answers.update(info_public_severity=3)
    assert evaluate(answers, notes)['proposed_level'] == 4


def test_refreshed_demo_has_current_population_answer():
    from app.mlps_intake import DEMO_TEMPLATE
    assert DEMO_TEMPLATE['template']['answers']['personal_info_count_system'] == '100,000 人及以上'


@pytest.mark.parametrize('answer', ['是', '否', '不确定'])
def test_boundary_review_distinguishes_no_from_unanswered(answer):
    answers, notes = complete()
    answers['security_responsible_entity'] = answer
    issues = [i for i in evaluate(answers, notes)['issues'] if i['code'] == 'QA01' and i['field'] == 'security_responsible_entity']
    if answer == '是':
        assert not issues
    elif answer == '否':
        assert '已选择“否”' in issues[0]['zh']
    else:
        assert '尚未确认' in issues[0]['zh']


@pytest.mark.parametrize('answer', [None, '', '是', '否', '不确定'])
def test_retired_independent_business_does_not_affect_grading(answer):
    from app.mlps_intake import GRADING_FIELDS, evaluate_grading, validate, visible
    answers, notes = complete()
    baseline = evaluate(answers, notes)
    early_baseline = evaluate_grading(answers, notes)
    if answer is not None:
        answers['independent_business'] = answer
        notes['independent_business'] = 'Historical authored explanation'
    question = next(q for q in QUESTIONS if q['key'] == 'independent_business')
    assert not visible(question, answers)
    assert 'independent_business' not in GRADING_FIELDS
    assert evaluate(answers, notes) == baseline
    assert evaluate_grading(answers, notes) == early_baseline
    assert baseline['status'] == 'preliminary_complete'
    assert validate(answers, notes) == (answers, notes)


def test_legacy_independent_business_no_can_be_confirmed_and_is_preserved(owner):
    _, client = owner
    detail = client.post('/api/v1/systems', json={'name': 'Retired boundary question'}).json()
    sid = detail['system']['id']
    answers, notes = complete()
    answers['independent_business'] = '否'
    notes['independent_business'] = 'Historical boundary explanation'
    response = command(client, sid, 'classification-confirmations', {
        'scheme': 'MLPS-INTAKE/1', 'answers': answers, 'notes': notes, 'frameworks': ['MLPS_LEVEL_2'],
    })
    assert response.status_code == 200, response.text
    saved = response.json()['system']['classification']
    assert saved['answers']['independent_business'] == '否'
    assert saved['notes']['independent_business'] == notes['independent_business']
    assert saved['assessment']['status'] == 'preliminary_complete'
    assert not any(i['field'] == 'independent_business' for i in saved['assessment']['issues'])


def test_unselected_parties_do_not_require_hidden_answers_or_rationales():
    a, notes = complete()
    for key in CORE:
        if not key.endswith('_rights_severity'):
            a.pop(key)
            notes.pop(key)
    result = evaluate(a, notes)
    assert result['status'] == 'preliminary_complete'
    assert {r['field'] for r in result['rule_trace']} == {'info_rights_severity', 'service_rights_severity'}


def test_retired_and_conditionally_hidden_answers_do_not_change_current_result():
    a, notes = complete()
    a.update(target_type='云计算平台/系统', data_categories=['其他'])
    baseline = evaluate(a, notes)
    a.update(hosted_target_levels=[{'hosted_system_name': 'Old', 'confirmed_level': '5', 'evidence': 'Old report'}],
             handles_personal_info='是', personal_info_count_system=99999999, sensitive_pi_count=99999999,
             cii_status='正式认定', large_pi_public_bigdata='两者均是')
    assert evaluate(a, notes) == baseline
    assert a['hosted_target_levels'][0]['confirmed_level'] == '5'

@pytest.mark.parametrize('entry', ['无', '存在公众可访问入口'])
def test_network_minimum_never_reduces_higher_matrix_result(entry):
    answers, notes = complete()
    answers.update(info_national_severity=1, external_network_access=entry)
    result = evaluate(answers, notes)
    assert result['base_level'] == 3
    assert result['proposed_level'] == 3
    assert result['rule_engine_version'] == '1.11.0'


def test_structured_department_contact_roundtrip(owner):
    _, client = owner
    detail = client.post('/api/v1/systems', json={'name': 'Structured contacts'}).json()
    sid = detail['system']['id']
    contact = {'name': 'Alice', 'organization': 'Supplier company', 'title': 'Engineer', 'scope': 'API integration', 'contact_method': 'alice@example.test'}
    body = {'version': detail['system']['version'], 'answers': {'system_owner': ['信息安全部门']}, 'frameworks': ['MLPS_LEVEL_2'], 'department_contacts': {'信息安全部门': contact, '财务': 'Legacy contact'}}
    response = client.put(f'/api/v1/systems/{sid}/mlps-intake', json=body)
    assert response.status_code == 200, response.text
    assert client.get(f'/api/v1/systems/{sid}/mlps-intake').json()['saved']['department_contacts'] == body['department_contacts']


def test_grade_first_preview_does_not_require_remaining_questionnaire():
    from app.mlps_intake import DEMO_TEMPLATE, GRADING_FIELDS, evaluate_grading
    template = DEMO_TEMPLATE['template']
    answers = {k: v for k, v in template['answers'].items() if k in GRADING_FIELDS}
    notes = template['notes']
    early = evaluate_grading(answers, notes)
    assert early['status'] == 'preliminary_complete'
    assert early['proposed_level'] == evaluate(template['answers'], notes)['proposed_level']
    assert evaluate(answers, notes)['status'] == 'pending_review'
    assert any(i['field'] == 'system_name' for i in evaluate(answers, notes)['issues'])
    del answers['external_network_access']
    missing = evaluate_grading(answers, notes)
    assert missing['status'] == 'pending_review'
    assert missing['is_lower_bound_only']
    assert any(i['field'] == 'external_network_access' for i in missing['issues'])


def test_grade_first_keeps_unknown_and_rationale_review():
    from app.mlps_intake import DEMO_TEMPLATE, evaluate_grading
    answers = {**DEMO_TEMPLATE['template']['answers'], 'service_rights_severity': 9}
    result = evaluate_grading(answers, {})
    assert result['status'] != 'preliminary_complete'
    assert {'QA02', 'RATIONALE'} <= {i['code'] for i in result['issues']}


def test_information_confirmation_matches_controls_without_brief_page(owner, monkeypatch):
    from app import methodology
    monkeypatch.setattr(methodology, 'LEGACY_FIXTURES_ENABLED', False)
    app, client = owner
    detail = client.post('/api/v1/systems', json={'name': 'Direct information'}).json()
    sid = detail['system']['id']
    from app.mlps_source import ensure_catalog
    from app.db import User
    from sqlalchemy import select
    with app.state.sessions.begin() as db:
        ensure_catalog(db, db.scalar(select(User)).org_id)
    answers, notes = complete()
    payload = {'answers': answers, 'notes': notes, 'frameworks': ['MLPS_LEVEL_2']}
    response = command(client, sid, 'information-confirmations', payload)
    assert response.status_code == 200, response.text
    result = response.json()
    assert result['system']['status'] == 'CONTROL_REVIEW'
    assert result['system']['context_revision_id']
    assert result['system']['context']['functions'][0]['title'] == answers['system_functions']
    assert any(c['included'] for c in result['controls'])
    bad = {**payload, 'answers': {**answers, 'service_rights_severity': 9}}
    rejected = client.post(f'/api/v1/systems/{sid}/information-confirmations', json={**bad, 'version': result['system']['version']})
    assert rejected.status_code == 409
    after = client.get(f'/api/v1/systems/{sid}').json()
    assert after['system']['context_revision_id'] == result['system']['context_revision_id']
    assert after['system']['revision'] == result['system']['revision']
