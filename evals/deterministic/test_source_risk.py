"""High-source-risk fail and non-bypass regressions, entirely offline."""
import asyncio
import pytest
from sqlalchemy import select
from app.db import Report, Selection, SupplierRound, System
from app.source_risk import assessment
from app.worker import run_once
from test_workflow import invite_supplier, command, current


@pytest.mark.parametrize('risk,status,expected', [('High', 'no', 'failed'), ('High', 'partial', 'pending'), ('High', 'needs_clarification', 'pending'), ('High', 'yes', 'ready_for_review'), ('Medium', 'no', 'ready_for_review')])
def test_gate_is_source_risk_and_immutable_supplier_commitment(owner, risk, status, expected):
    app, client, vendor, sid = invite_supplier(owner)
    detail = current(vendor, sid)
    target = next(r for r in detail['prd']['data']['requirements'] if r['source_control_ids'])
    with app.state.sessions.begin() as db:
        system = db.get(System, sid)
        round_ = db.get(SupplierRound, system.round_id)
        control = {'id': target['source_control_ids'][0], 'metadata': {'source': {'schema': 'CONTROL-SIX/1', 'languages': {'zh': {'fields': {'risk_level': risk}}}}}}
        round_.snapshot = {**round_.snapshot, 'controls': [control]}
    answers = {r['id']: {'implementation_status': 'yes', 'duration_workdays': 5, 'owner_name': 'Supplier', 'implementation_plan': 'Implement and verify'} for r in detail['prd']['data']['requirements']}
    answers[target['id']] = {'implementation_status': status, 'duration_workdays': 5 if status in ('yes', 'partial') else None,
                            'owner_name': 'Supplier', 'implementation_plan': 'Implement agreed portion' if status in ('yes', 'partial') else '',
                            'limitations': 'Unable to implement this control' if status != 'yes' else ''}
    command(vendor, sid, 'supplier-submit', {'answers': answers, 'round_version': detail['round']['version'], 'mode': 'local', 'language': 'en'})
    assert asyncio.run(run_once(app.state.sessions))
    result = current(client, sid)
    assert result['report']['source_assessment']['status'] == expected
    if expected in ('failed', 'pending'):
        decisions = {f['id']: {'decision': 'accept', 'reason': 'Accept all risk'} for f in result['report']['data']['findings']}
        command(client, sid, 'review-decisions', {'decisions': decisions, 'exception_reason': 'Accepted'}, expected=409)
        # Even a reviewed report or a model changing severity cannot bypass the source gate.
        with app.state.sessions.begin() as db:
            system = db.get(System, sid)
            report = db.get(Report, system.report_id)
            report.reviewed = True
            report.decisions = {**decisions, '_exceptions': {'reason': 'Accepted'}}
            report.data = {**report.data, 'findings': [{**f, 'severity': 'low'} for f in report.data['findings']]}
            for row in db.scalars(select(Selection).where(Selection.system_id == sid)):
                row.snapshot = {**row.snapshot, 'metadata': {}}
            assert assessment(db, system)['status'] == expected
        assert command(client, sid, 'baselines', expected=409).json()['code'] == 'HIGH_RISK_CONTROL_UNRESOLVED'
    else:
        decisions = {f['id']: {'decision': 'accept', 'reason': 'Reviewed; acceptance evidence remains due'} for f in result['report']['data']['findings']}
        command(client, sid, 'review-decisions', {'decisions': decisions, 'exception_reason': 'Reviewed scope'})
        assert command(client, sid, 'baselines').json()['baseline']
