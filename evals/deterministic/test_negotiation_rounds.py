"""Offline owner/supplier remediation loop, accepted risk and final baseline."""
import asyncio
import base64
import copy
import csv
import io

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.db import Baseline, Confirmation, Job, Report, Submission, SupplierRound
from app.worker import run_once
from conftest import register
from test_workflow import command, current, invite_supplier


def analyze(app, customer, sid):
    command(customer, sid, 'jobs', {'kind': 'impact_analysis', 'mode': 'local', 'language': 'en'})
    assert asyncio.run(run_once(app.state.sessions))
    return current(customer, sid)


def review_decisions(detail, returned=None):
    carried = set(detail['round']['accepted_requirement_ids'])
    return {f['id']: {'decision': 'changes' if f['requirement_id'] == returned else 'accept',
                       'reason': 'Use the designated secure tool' if f['requirement_id'] == returned else 'Owner accepts responsibility; verify evidence before release',
                       'owner_reviewed': True}
            for f in detail['report']['data']['findings'] if f['requirement_id'] not in carried
            and detail['round']['draft'][f['requirement_id']]['implementation_status'] != 'yes'}


def test_targeted_rounds_preserve_accepted_items_until_independent_finalization(owner):
    app, customer, supplier, sid = invite_supplier(owner)
    detail = current(supplier, sid)
    requirements = detail['prd']['data']['requirements']
    targets = [r for r in requirements if r['source_control_ids']][:3]
    returned = targets[0]['id']
    with app.state.sessions.begin() as db:
        round_ = db.get(SupplierRound, detail['round']['id'])
        high = {r['source_control_ids'][0] for r in targets}
        round_.snapshot = {**round_.snapshot, 'controls': [{**c, 'metadata': {'source': {'schema': 'CONTROL-SIX/1',
            'languages': {'zh': {'fields': {'risk_level': 'High' if c['id'] in high else 'Medium'}}}}}}
            for c in round_.snapshot['controls']]}
    answers = {r['id']: {'implementation_status': 'yes'} for r in requirements}
    for r, status in zip(targets, ['no', 'needs_clarification', 'partial'], strict=True):
        answers[r['id']] = {'implementation_status': status, 'limitations': 'Authored supplier explanation'}
    submitted = command(supplier, sid, 'supplier-submit', {'answers': answers, 'round_version': detail['round']['version']}).json()
    first_submission = submitted['submission_id']
    detail = analyze(app, customer, sid)
    original_report = copy.deepcopy(detail['report'])
    decisions = review_decisions(detail, returned)
    command(supplier, sid, 'review-decisions', {'decisions': decisions, 'advance_workflow': True}, expected=404)
    response = command(customer, sid, 'review-decisions', {'decisions': decisions,
        'report_id': detail['report']['id'], 'advance_workflow': True}, key='owner-first-review')
    new = response.json()
    assert new['system']['status'] == 'VENDOR_FILLING'
    assert new['round']['review_scope'] == [returned]
    assert len(new['round']['accepted_requirement_ids']) == len(requirements) - 1
    assert new['round']['owner_feedback'][returned][0]['reason'] == 'Use the designated secure tool'
    assert new['round']['number'] == 2
    assert new['report'] is None and new['supplier_review'] is None
    replay = customer.post(f'/api/v1/systems/{sid}/review-decisions', content=response.request.content,
                           headers={'Idempotency-Key': 'owner-first-review', 'Content-Type': 'application/json'})
    assert replay.status_code == 200 and replay.json()['round']['id'] == new['round']['id']
    command(customer, sid, 'review-decisions', {'decisions': decisions, 'version': detail['system']['version']}, expected=409)
    outsider = TestClient(app)
    register(outsider, 'unrelated-remediation@example.test')
    assert outsider.get(f'/api/v1/systems/{sid}').status_code == 404
    with app.state.sessions() as db:
        old_report = db.get(Report, original_report['id'])
        assert old_report.data == original_report['data']
        old_submission = copy.deepcopy(db.get(Submission, first_submission).data)
        for target in targets[1:]:
            f = next(f for f in old_report.data['findings'] if f['requirement_id'] == target['id'])
            assert old_report.decisions[f['id']]['residual_severity'] == 'medium'
    # Editing a previously accepted answer is rejected on both draft and submission routes.
    tampered = copy.deepcopy(new['round']['draft'])
    tampered[targets[1]['id']]['implementation_status'] = 'yes'
    for suffix, method in [('supplier-draft', 'put'), ('supplier-submit', 'post')]:
        failure = command(supplier, sid, suffix, {'answers': tampered, 'round_version': new['round']['version']},
                          method=method, expected=409)
        assert failure.json()['code'] == 'ACCEPTED_REQUIREMENT_LOCKED'
    for round_number in (2, 3):
        detail = current(supplier, sid)
        if round_number == 2:
            prefix = f'/api/v1/systems/{sid}/csv-forms'
            issued = supplier.post(prefix, json={'kind': 'prd', 'version': detail['system']['version']})
            assert issued.status_code == 200
            route = prefix + '/' + issued.json()['id']
            template = supplier.get(route + '/template')
            rows = list(csv.reader(io.StringIO(template.text.lstrip('\ufeff'))))
            assert all(row[rows[0].index('record_id')].startswith(returned + '.') for row in rows[1:])
            assert 'Use the designated secure tool' in template.text
            for row in rows[1:]:
                row[-1] = {'implementation_status': 'partial', 'limitations': 'Authored CSV revision'}.get(row[5], '')
            stream = io.StringIO()
            csv.writer(stream).writerows(rows)
            preview = supplier.post(route + '/preview', json={'content_base64': base64.b64encode(stream.getvalue().encode()).decode()}).json()
            assert preview['can_confirm'], preview
            imported = supplier.post(route + '/confirm', json={'batch_id': preview['batch_id'], 'version': current(supplier, sid)['system']['version']})
            assert imported.status_code == 200, imported.text
            assert imported.json()['round']['draft'][targets[1]['id']] == old_submission[targets[1]['id']]
            detail = current(supplier, sid)
        answer = {'implementation_status': 'partial', 'limitations': 'Revised tool proposal'} if round_number == 2 else {'implementation_status': 'yes'}
        partial = {returned: answer}
        command(supplier, sid, 'supplier-submit', {'answers': partial, 'round_version': -1}, expected=409)
        command(supplier, sid, 'supplier-submit', {'answers': {}, 'round_version': detail['round']['version']}, expected=422)
        saved = command(supplier, sid, 'supplier-draft', {'answers': partial, 'round_version': detail['round']['version']}, method='put').json()
        assert saved['round']['draft'][targets[1]['id']] == old_submission[targets[1]['id']]
        submitted = command(supplier, sid, 'supplier-submit', {'answers': partial, 'round_version': saved['round']['version']}).json()
        assert submitted['report']['mode'] == 'local'
        assert submitted['system']['status'] == ('FINAL_CONFIRMATION' if round_number == 3 else 'RESULT_REVIEW')
        assert len(submitted['report']['data']['findings']) == len(requirements)
        assert submitted['supplier_review']['counts']['total'] == 1
        assert submitted['supplier_review']['counts']['accepted_previous'] == len(requirements) - 1
        assert [i['requirement_id'] for i in submitted['supplier_review']['items']] == [returned]
        assert not asyncio.run(run_once(app.state.sessions))
        if round_number == 3:
            next_detail = submitted
            assert next_detail['baseline'] and not next_detail['baseline']['confirmations']
            assert next_detail['report']['reviewed']
            continue
        detail = analyze(app, customer, sid)
        assert len(detail['report']['data']['findings']) == len(requirements)
        with app.state.sessions() as db:
            job = db.scalars(select(Job).where(Job.system_id == sid, Job.kind == 'impact_analysis').order_by(Job.created_at.desc())).first()
            assert [r['id'] for r in job.input['prd']['requirements']] == [returned]
            assert set(job.input['answers']) == {returned}
        all_decisions = {**detail['report']['decisions'], **review_decisions(detail)}
        carried_key = next(iter(detail['report']['decisions']))
        all_decisions[carried_key] = {'decision': 'changes', 'reason': 'Tamper with prior acceptance'}
        command(customer, sid, 'review-decisions', {'decisions': all_decisions, 'advance_workflow': True}, expected=409)
        next_detail = command(customer, sid, 'review-decisions', {'decisions': review_decisions(detail, returned if round_number == 2 else None),
            'report_id': detail['report']['id'], 'advance_workflow': True}).json()
        if round_number == 2:
            assert next_detail['round']['number'] == 3
            assert next_detail['round']['review_scope'] == [returned]
            assert len(next_detail['round']['accepted_requirement_ids']) == len(requirements) - 1
        else:
            assert next_detail['system']['status'] == 'FINAL_CONFIRMATION'
            assert not next_detail['baseline']['confirmations']
    baseline = next_detail['baseline']
    path = f"/api/v1/baselines/{baseline['id']}"
    assert supplier.get(path + '/document').status_code == 409
    failed = customer.post(path + '/confirmations', json={'version': next_detail['system']['version'], 'content_hash': 'wrong'})
    assert failed.status_code == 409
    for party in (customer, supplier):
        result = party.post(path + '/confirmations', json={'version': current(party, sid)['system']['version'], 'content_hash': baseline['content_hash']})
        assert result.status_code == 200, result.text
        if party is customer:
            assert result.json()['system']['status'] == 'FINAL_CONFIRMATION'
            assert customer.get(path + '/document').status_code == 409
    assert result.json()['system']['status'] == 'PENDING_DEVELOPMENT'
    assert result.json()['baseline']['finalized']
    document = customer.get(path + '/document')
    assert document.status_code == 200
    assert supplier.get(path + '/document').text == document.text
    assert 'Risk after owner acceptance: Medium' in document.text
    assert outsider.get(path + '/document').status_code == 404
    with app.state.sessions() as db:
        assert db.get(Submission, first_submission).data == old_submission
        assert db.get(Report, original_report['id']).data == original_report['data']
        frozen = db.get(Baseline, baseline['id'])
        assert len(frozen.payload['answers']) == len(requirements)
        assert frozen.payload['answers'][targets[1]['id']]['implementation_status'] == 'needs_clarification'
        assert frozen.payload['accepted_requirements'][targets[1]['id']]['submission_id'] == first_submission
        assert len(list(db.scalars(select(Confirmation).where(Confirmation.baseline_id == baseline['id'])))) == 2


def test_owner_cannot_advance_without_complete_current_review(owner):
    app, customer, supplier, sid = invite_supplier(owner)
    detail = current(supplier, sid)
    answers = {r['id']: {'implementation_status': 'yes'} for r in detail['prd']['data']['requirements']}
    answers[next(iter(answers))] = {'implementation_status': 'partial', 'limitations': 'Owner must review this exception'}
    command(supplier, sid, 'supplier-submit', {'answers': answers, 'round_version': detail['round']['version']})
    detail = analyze(app, customer, sid)
    decisions = review_decisions(detail)
    command(customer, sid, 'review-decisions', {'decisions': {}, 'advance_workflow': True}, expected=422)
    command(customer, sid, 'review-decisions', {'decisions': decisions, 'report_id': 'stale', 'advance_workflow': True}, expected=409)
    assert current(customer, sid)['baseline'] is None
