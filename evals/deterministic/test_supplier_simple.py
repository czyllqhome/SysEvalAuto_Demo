"""Simple supplier commitments retain pinned domains and independent review."""
import asyncio

import pytest
from sqlalchemy import select

from app.db import Selection, SupplierRound, System
from app.domain import SupplierAnswer
from app.source_risk import high_source_requirements
from app.worker import run_once
from test_workflow import command, current, invite_supplier


@pytest.mark.parametrize('status', ['yes', 'partial', 'no', 'needs_clarification'])
def test_supplier_commitments_do_not_require_a_fabricated_schedule(status):
    payload = {'implementation_status': status}
    if status != 'yes':
        payload.update(limitations='Please review this dependency', alternative='Manual reconciliation')
    result = SupplierAnswer.model_validate(payload)
    assert result.duration_workdays is None
    assert result.owner_name == result.implementation_plan == ''
    assert result.implementation_status == status


def test_simple_responses_submit_for_review_with_pinned_domain_labels(owner):
    app, customer, vendor, sid = invite_supplier(owner)
    with app.state.sessions.begin() as db:
        system = db.get(System, sid)
        round_ = db.get(SupplierRound, system.round_id)
        pinned = round_.snapshot['controls'][0]
        pinned_id, pinned_domain = pinned['id'], pinned['domain']
        round_.snapshot = {**round_.snapshot, 'controls': [
            {**c, 'metadata': {'source': {'schema': 'CONTROL-SIX/1', 'languages': {
                'zh': {'fields': {'risk_level': 'High' if c['id'] == pinned_id else 'Medium'}}}}}}
            for c in round_.snapshot['controls']]}
        # A newer current selection must not rename this round's published domain.
        selection = db.scalar(select(Selection).where(Selection.system_id == sid, Selection.control_id == pinned_id))
        selection.snapshot = {**selection.snapshot, 'domain': 'CHANGED_AFTER_PUBLICATION'}
    detail = current(vendor, sid)
    requirements = detail['prd']['data']['requirements']
    affected = next(r for r in requirements if pinned_id in r['source_control_ids'])
    assert detail['prd']['requirement_domains'][affected['id']] == [pinned_domain]
    assert detail['prd']['high_risk_requirements'] == [r['id'] for r in requirements if pinned_id in r['source_control_ids']]
    assert detail['controls'] == []  # Do not expose the customer's full control set.
    answers = {r['id']: {'implementation_status': 'yes'} for r in requirements}
    for requirement, status in zip(requirements[:3], ('partial', 'no', 'needs_clarification')):
        answers[requirement['id']] = {'implementation_status': status, 'limitations': 'Owner must review the gap',
                                     'alternative': 'Compensating manual check', 'duration_workdays': 3}
    response = command(vendor, sid, 'supplier-submit', {'round_version': detail['round']['version'],
                       'answers': answers, 'mode': 'local', 'language': 'en'}).json()
    assert response['round']['status'] == 'submitted'
    assert response['system']['status'] == 'RESULT_REVIEW'
    assert response['report'] is None
    assert response['supplier_review']['counts']['yes'] == len(requirements) - 3
    assert response['baseline'] is None
    assert response['round']['draft'][requirements[-1]['id']]['duration_workdays'] is None
    assert not asyncio.run(run_once(app.state.sessions))
    command(customer, sid, 'jobs', {'kind': 'impact_analysis', 'mode': 'local', 'language': 'en'})
    assert asyncio.run(run_once(app.state.sessions))
    reviewed = current(customer, sid)
    assert reviewed['report'], reviewed.get('job')
    assert reviewed['report']['reviewed'] is False
    assert reviewed['baseline'] is None
    assert any(f['severity'] == 'unknown' for f in reviewed['report']['data']['findings'])
    yes_finding = next(f for f in reviewed['report']['data']['findings'] if f['requirement_id'] == requirements[-1]['id'])
    assert yes_finding['evidence_field'] == 'implementation_status'
    assert yes_finding['evidence'] == 'yes'
    assert yes_finding['severity'] == 'unknown'


def test_high_source_flags_use_pinned_risk_not_priority_or_translated_values():
    def control(id_, risk, english='High'):
        return {'id': id_, 'metadata': {'source': {'schema': 'CONTROL-SIX/1', 'languages': {
            'zh': {'fields': {'risk_level': risk}}, 'en': {'fields': {'risk_level': english}}}}}}
    controls = [control('high', ' HIGH ', 'Medium'), control('medium', 'Medium'), control('unknown', '')]
    requirements = [{'id': id_, 'priority': 'must', 'source_control_ids': refs} for id_, refs in [
        ('mixed', ['medium', 'high']), ('normal', ['medium']), ('missing', ['unknown', 'absent']), ('business', [])]]
    assert high_source_requirements({'requirements': requirements}, controls) == ['mixed']
    assert high_source_requirements({'requirements': requirements}, []) == []
