"""Supplier publication never schedules AI; summaries preserve published evidence."""
import asyncio
import copy

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.db import Job, Prd, Selection, Submission, SupplierRound, System
from app.worker import run_once
from conftest import register
from test_workflow import command, current, invite_supplier


@pytest.mark.parametrize('configured', [False, True])
def test_submit_only_publishes_and_returns_pinned_risk_summary(owner, monkeypatch, configured):
    app, customer, vendor, sid = invite_supplier(owner)
    monkeypatch.setenv('OPENROUTER_API_KEY', 'offline-test-key' if configured else '')
    monkeypatch.setenv('OPENROUTER_MODEL', 'offline-model' if configured else '')
    # Submission and summary must also work when the model budget is exhausted.
    monkeypatch.setenv('SYSEVAL_SYSTEM_TOKEN_BUDGET', '0')
    detail = current(vendor, sid)
    assert detail['supplier_review'] is None
    requirements = detail['prd']['data']['requirements']
    targets = [r for r in requirements if r['source_control_ids']][:4]
    risk_status = [('High', 'no'), ('Medium', 'partial'), ('High', 'needs_clarification'), ('Medium', 'yes')]
    by_control = {r['source_control_ids'][0]: risk for r, (risk, _) in zip(targets, risk_status)}
    with app.state.sessions.begin() as db:
        round_ = db.get(SupplierRound, detail['round']['id'])
        round_.snapshot = {**round_.snapshot, 'controls': [{**c, 'metadata': {'source': {'schema': 'CONTROL-SIX/1',
            'languages': {'zh': {'fields': {'risk_level': by_control.get(c['id'], ''), 'source': 'Published source',
                'control_identifier': c['code'], 'security_domain': 'Published domain',
                'control_requirement': '保留来源原文 Original source requirement'}}}}}}
            for c in round_.snapshot['controls']]}
    answers = {r['id']: {'implementation_status': 'yes'} for r in requirements}
    for requirement, (_, status) in zip(targets, risk_status):
        answers[requirement['id']] = {'implementation_status': status,
                                     'limitations': '供应商原文 Original explanation' if status != 'yes' else '',
                                     'alternative': 'Manual compensating check' if status != 'yes' else ''}
    # Older clients may still send mode=openrouter. It cannot authorize generation.
    submitted = command(vendor, sid, 'supplier-submit', {'round_version': detail['round']['version'],
                        'answers': answers, 'mode': 'openrouter'}, key='publish-summary').json()
    assert submitted['system']['status'] == 'RESULT_REVIEW'
    assert submitted['report'] is None and submitted['baseline'] is None
    assert 'job_id' not in submitted
    assert not asyncio.run(run_once(app.state.sessions))
    with app.state.sessions() as db:
        assert not list(db.scalars(select(Job).where(Job.system_id == sid, Job.kind == 'impact_analysis')))
    result = current(customer, sid)['supplier_review']
    assert result == submitted['supplier_review']
    assert result['submission_id'] == submitted['submission_id']
    assert result['counts'] == {'total': len(requirements), 'yes': len(requirements) - 3,
        'no': 1, 'partial': 1, 'needs_clarification': 1, 'unanswered': 0, 'attention': 3,
        'high_unconfirmed': 2, 'medium_unconfirmed': 1, 'owner_accepted': 0, 'accepted_previous': 0}
    first = next(i for i in result['items'] if i['requirement_id'] == targets[0]['id'])
    assert first['source_risk'] == 'high'
    assert first['domains'] == ['Published domain']
    assert first['controls'][0]['text'] == '保留来源原文 Original source requirement'
    assert first['answer']['limitations'] == '供应商原文 Original explanation'
    # Current selections and the draft are not immutable submission evidence.
    with app.state.sessions.begin() as db:
        round_ = db.get(SupplierRound, detail['round']['id'])
        round_.draft = {r['id']: {'implementation_status': 'yes'} for r in requirements}
        for selection in db.scalars(select(Selection).where(Selection.system_id == sid)):
            selection.snapshot = {**selection.snapshot, 'metadata': {}, 'domain': 'Changed current domain'}
    assert current(customer, sid)['supplier_review'] == result
    command(customer, sid, 'review-decisions', {'decisions': {}, 'exception_reason': 'Reviewed'}, expected=422)
    command(customer, sid, 'baselines', expected=409)
    outsider = TestClient(app)
    register(outsider, 'summary-outsider@example.test')
    assert outsider.get(f'/api/v1/systems/{sid}').status_code == 404
    command(vendor, sid, 'jobs', {'kind': 'impact_analysis', 'mode': 'openrouter'}, expected=404)
    new = command(customer, sid, 'negotiation-rounds', {'reason': 'Resolve the remaining commitments'}).json()
    assert new['supplier_review'] is None
    with app.state.sessions() as db:
        assert db.get(Submission, result['submission_id']).data[targets[0]['id']]['implementation_status'] == 'no'


def test_summary_deduplicates_requirements_and_keeps_unknown_source_risk(owner):
    from app.supplier_review import summary
    app, _, vendor, sid = invite_supplier(owner)
    detail = current(vendor, sid)
    command(vendor, sid, 'supplier-submit', {'round_version': detail['round']['version'],
        'answers': {r['id']: {'implementation_status': 'yes'} for r in detail['prd']['data']['requirements']}})
    with app.state.sessions.begin() as db:
        system = db.get(System, sid)
        round_ = db.get(SupplierRound, system.round_id)
        prd = db.get(Prd, round_.prd_id)
        data = copy.deepcopy(prd.data)
        target, missing = [r for r in data['requirements'] if r['source_control_ids']][:2]
        target['source_control_ids'] = ['high', 'medium', 'high']
        missing['source_control_ids'] = ['absent']
        prd.data = data
        round_.snapshot = {**round_.snapshot, 'controls': [{'id': id_, 'metadata': {'source': {'schema': 'CONTROL-SIX/1',
            'languages': {'zh': {'fields': {'risk_level': risk}}, 'en': {'fields': {'risk_level': 'High'}}}}}}
            for id_, risk in [('high', ' HIGH '), ('medium', 'Medium')]]}
        result = summary(db, round_)
        indexed = {i['requirement_id']: i for i in result['items']}
        assert indexed[target['id']]['source_risk'] == 'high'
        assert len(indexed[target['id']]['controls']) == 2
        assert indexed[missing['id']]['source_risk'] == 'unknown'
        assert result['counts']['yes'] == result['counts']['total'] == len(data['requirements'])
        assert result['counts']['high_unconfirmed'] == result['counts']['medium_unconfirmed'] == 0
