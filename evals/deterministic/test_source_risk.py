"""High-source-risk fail and non-bypass regressions, entirely offline."""
import asyncio
import pytest
from sqlalchemy import select
from app.db import Report, Selection, SupplierRound, System
from app.source_risk import assessment
from app.worker import run_once
from test_workflow import invite_supplier, command, current


@pytest.mark.parametrize('risk,status,expected', [('High', 'no', 'pending'), ('High', 'partial', 'pending'), ('High', 'needs_clarification', 'pending'), ('High', 'yes', 'ready_for_review'), ('Medium', 'no', 'ready_for_review')])
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
    command(client, sid, 'jobs', {'kind': 'impact_analysis', 'mode': 'local', 'language': 'en'})
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
        marked = {key: {**value, 'owner_reviewed': True} for key, value in decisions.items()}
        accepted = command(client, sid, 'review-decisions', {'decisions': marked}).json()
        finding = next(f for f in accepted['report']['data']['findings'] if f['requirement_id'] == target['id'])
        assert accepted['report']['decisions'][finding['id']]['residual_severity'] == 'medium'
        assert accepted['report']['source_assessment']['blocking_requirements'] == []
    else:
        decisions = {f['id']: {'decision': 'accept', 'reason': 'Reviewed; acceptance evidence remains due'} for f in result['report']['data']['findings']}
        command(client, sid, 'review-decisions', {'decisions': decisions, 'exception_reason': 'Reviewed scope'})
        assert command(client, sid, 'baselines').json()['baseline']


@pytest.mark.parametrize('decision', ['accept', 'changes'])
def test_high_clarification_requires_explicit_owner_decision_without_ai(owner, decision):
    app, client, vendor, sid = invite_supplier(owner)
    detail = current(vendor, sid)
    target = next(r for r in detail['prd']['data']['requirements'] if r['source_control_ids'])
    with app.state.sessions.begin() as db:
        round_ = db.get(SupplierRound, detail['round']['id'])
        round_.snapshot = {**round_.snapshot, 'controls': [{'id': target['source_control_ids'][0],
            'metadata': {'source': {'schema': 'CONTROL-SIX/1', 'languages': {'zh': {'fields': {'risk_level': 'High'}}}}}}]}
    answers = {r['id']: {'implementation_status': 'yes'} for r in detail['prd']['data']['requirements']}
    answers[target['id']] = {'implementation_status': 'needs_clarification', 'limitations': 'Confirm responsibility for host protection'}
    command(vendor, sid, 'supplier-submit', {'answers': answers, 'round_version': detail['round']['version']})
    assert not asyncio.run(run_once(app.state.sessions))
    command(client, sid, 'jobs', {'kind': 'impact_analysis', 'mode': 'local', 'language': 'en'})
    assert asyncio.run(run_once(app.state.sessions))
    report = current(client, sid)['report']
    finding = next(f for f in report['data']['findings'] if f['requirement_id'] == target['id'])
    assert finding['severity'] == 'unknown'
    assert report['source_assessment']['clarification_requirements'] == [target['id']]
    decisions = {f['id']: {'decision': 'accept', 'reason': 'Owner will verify implementation evidence'} for f in report['data']['findings']}
    command(client, sid, 'review-decisions', {'decisions': decisions}, expected=409)
    decisions[finding['id']] = {'decision': decision, 'reason': 'Customer security owner accepts responsibility; obtain hosting evidence before release', 'owner_reviewed': True}
    # Neither a blank rationale nor a stale version can publish an owner decision.
    invalid = {**decisions, finding['id']: {**decisions[finding['id']], 'reason': ' '}}
    command(client, sid, 'review-decisions', {'decisions': invalid, 'exception_reason': 'Reviewed'}, expected=422)
    command(client, sid, 'review-decisions', {'decisions': decisions, 'exception_reason': 'Reviewed', 'version': -1}, expected=409)
    command(vendor, sid, 'review-decisions', {'decisions': decisions, 'exception_reason': 'Reviewed'}, expected=404)
    result = command(client, sid, 'review-decisions', {'decisions': decisions}).json()
    source = result['report']['source_assessment']
    assert result['supplier_review']['counts']['high_unconfirmed'] == (0 if decision == 'accept' else 1)
    assert result['report']['data'] == report['data']  # Source risk and unknown severity are not rewritten.
    assert result['report']['decisions'][finding['id']]['owner_reviewed'] is True
    if decision == 'changes':
        assert result['system']['status'] == 'NEGOTIATING'
        assert source['blocking_requirements'] == [target['id']]
        command(client, sid, 'baselines', expected=409)
        return
    assert source['owner_accepted_requirements'] == [target['id']]
    assert source['blocking_requirements'] == []
    # A subsequent save cannot inherit the earlier explicit acceptance marker.
    no_marker = {**decisions, finding['id']: {'decision': 'accept', 'reason': 'Generic bulk rationale'}}
    command(client, sid, 'review-decisions', {'decisions': no_marker, 'exception_reason': 'Reviewed'}, expected=409)
    baseline = command(client, sid, 'baselines').json()['baseline']
    command(client, sid, 'baselines', expected=409)  # Frozen state still requires independent confirmations.
    for party in (client, vendor):
        response = party.post(f"/api/v1/baselines/{baseline['id']}/confirmations", json={
            'version': current(party, sid)['system']['version'], 'content_hash': baseline['content_hash']})
        assert response.status_code == 200, response.text
    response = client.post(f"/api/v1/baselines/{baseline['id']}/finalize", json={'version': current(client, sid)['system']['version']})
    assert response.status_code == 200, response.text
    assert response.json()['system']['status'] == 'PENDING_DEVELOPMENT'


def test_high_clarification_acceptance_is_bound_to_report_and_submission(owner):
    from app.db import Prd, Submission, User
    app, _, _, sid = invite_supplier(owner)
    with app.state.sessions.begin() as db:
        system = db.get(System, sid)
        round_ = db.get(SupplierRound, system.round_id)
        target = next(r for r in db.get(Prd, round_.prd_id).data['requirements'] if r['source_control_ids'])
        round_.snapshot = {**round_.snapshot, 'controls': [{'id': target['source_control_ids'][0],
            'metadata': {'source': {'schema': 'CONTROL-SIX/1', 'languages': {'zh': {'fields': {'risk_level': 'High'}}}}}}]}
        actor = db.scalar(select(User.id).where(User.org_id == round_.supplier_org_id))
        submission = Submission(round_id=round_.id, actor_id=actor,
                                data={target['id']: {'implementation_status': 'needs_clarification'}})
        db.add(submission)
        db.flush()
        round_.submitted_id = submission.id
        report = Report(system_id=sid, submission_id=submission.id, mode='local', reviewed=True,
            data={'findings': [{'id': 'F', 'requirement_id': target['id'], 'severity': 'unknown'}]},
            decisions={'F': {'decision': 'accept', 'reason': 'Reviewed individually', 'owner_reviewed': True}})
        db.add(report)
        db.flush()
        system.report_id = report.id
        assert assessment(db, system)['owner_accepted_requirements'] == [target['id']]
        report.reviewed = False
        assert assessment(db, system)['blocking_requirements'] == [target['id']]
        report.reviewed = True
        # A report from another submission cannot release the current gate.
        report.submission_id = 'different-submission'
        with db.no_autoflush:
            assert assessment(db, system)['blocking_requirements'] == [target['id']]
        db.rollback()
