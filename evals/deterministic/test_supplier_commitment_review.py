"""Submitted delivery commitments need no repeated owner acceptance."""
import copy

from app.db import Report, Submission, SupplierRound
from test_workflow import command, current, invite_supplier


def submit(owner, *, exceptions=False):
    app, customer, supplier, sid = invite_supplier(owner)
    before = current(supplier, sid)
    requirements = before['prd']['data']['requirements']
    answers = {r['id']: {'implementation_status': 'yes'} for r in requirements}
    targets = [r for r in requirements if r['source_control_ids']][:3] if exceptions else []
    with app.state.sessions.begin() as db:
        round_ = db.get(SupplierRound, before['round']['id'])
        round_.snapshot = {**round_.snapshot, 'controls': [{**c, 'metadata': {'source': {
            'schema': 'CONTROL-SIX/1', 'languages': {'zh': {'fields': {'risk_level': 'High'}}}}}}
            for c in round_.snapshot['controls']]}
    for target, status in zip(targets, ('no', 'partial', 'needs_clarification')):
        answers[target['id']] = {'implementation_status': status, 'limitations': 'Keep the supplier explanation'}
    submitted = command(supplier, sid, 'supplier-submit', {
        'round_version': before['round']['version'], 'answers': answers}).json()
    return app, customer, supplier, sid, submitted, targets


def test_all_confirmed_commitments_proceed_directly_to_independent_confirmation(owner):
    app, customer, supplier, sid, submitted, _ = submit(owner)
    assert not submitted['report']['reviewed'] and submitted['report']['decisions'] == {}
    command(supplier, sid, 'baselines', expected=404)
    command(customer, sid, 'baselines', {'version': -1}, expected=409)
    frozen = command(customer, sid, 'baselines', key='freeze-commitments').json()
    assert frozen['system']['status'] == 'FINAL_CONFIRMATION'
    assert not frozen['baseline']['confirmations'] and frozen['report']['reviewed']
    assert frozen['supplier_review']['counts']['owner_accepted'] == 0
    assert frozen['supplier_review']['counts']['attention'] == 0
    assert frozen['report']['data'] == submitted['report']['data']
    for decision in frozen['report']['decisions'].values():
        assert decision['decision'] == 'accept' and decision['decision_source'] == 'supplier_commitment'
        assert 'implementation evidence' in decision['reason']
        assert 'owner_reviewed' not in decision and 'residual_severity' not in decision
    baseline = frozen['baseline']
    path = f"/api/v1/baselines/{baseline['id']}"
    assert customer.post(path + '/confirmations', json={
        'version': frozen['system']['version'], 'content_hash': 'wrong'}).status_code == 409
    for party in (customer, supplier):
        response = party.post(path + '/confirmations', json={
            'version': current(party, sid)['system']['version'], 'content_hash': baseline['content_hash']})
        assert response.status_code == 200, response.text
        if party is customer:
            assert response.json()['system']['status'] == 'FINAL_CONFIRMATION'
            assert customer.get(path + '/document').status_code == 409
    assert response.json()['system']['status'] == 'PENDING_DEVELOPMENT'
    document = customer.get(path + '/document')
    assert document.status_code == 200
    assert 'Development commitment: Supplier confirmed delivery' in document.text
    assert 'Customer decision:' not in document.text
    with app.state.sessions() as db:
        assert db.get(Submission, submitted['submission_id']).data == submitted['round']['draft']


def test_owner_only_reviews_exceptions_using_immutable_supplier_answers(owner):
    app, customer, _, sid, submitted, targets = submit(owner, exceptions=True)
    report = submitted['report']
    decisions = {f['id']: {'decision': 'accept', 'reason': 'Owner will coordinate the remaining work', 'owner_reviewed': True}
                 for f in report['data']['findings'] if f['requirement_id'] in {r['id'] for r in targets}}
    command(customer, sid, 'review-decisions', {'decisions': {}}, expected=422)
    command(customer, sid, 'baselines', expected=409)
    missing = {key: value for key, value in list(decisions.items())[1:]}
    command(customer, sid, 'review-decisions', {'decisions': missing}, expected=422)
    # Mutable drafts cannot promote a submitted exception into an automatic commitment.
    with app.state.sessions.begin() as db:
        round_ = db.get(SupplierRound, submitted['round']['id'])
        round_.draft = {rid: {**value, 'implementation_status': 'yes'} for rid, value in round_.draft.items()}
    spoofed = {key: {'decision': 'accept', 'reason': 'Pretend to be a commitment', 'decision_source': 'supplier_commitment'}
               for key in decisions}
    command(customer, sid, 'review-decisions', {'decisions': spoofed}, expected=409)
    command(customer, sid, 'review-decisions', {'decisions': decisions, 'report_id': 'stale'}, expected=409)
    reviewed = command(customer, sid, 'review-decisions', {'decisions': decisions, 'report_id': report['id']}).json()
    assert reviewed['report']['data'] == report['data']
    assert reviewed['supplier_review']['counts']['owner_accepted'] == 3
    for finding in report['data']['findings']:
        saved = reviewed['report']['decisions'][finding['id']]
        if finding['id'] in decisions:
            assert saved['residual_severity'] == 'medium' and 'decision_source' not in saved
        else:
            assert saved['decision_source'] == 'supplier_commitment' and 'residual_severity' not in saved
    with app.state.sessions() as db:
        assert db.get(Submission, submitted['submission_id']).data == submitted['round']['draft']


def test_preserves_existing_authored_decisions_on_supplier_confirmed_items(owner):
    app, customer, _, sid, submitted, _ = submit(owner)
    authored = {'decision': 'accept', 'reason': '历史负责人说明\nKeep this original rationale.'}
    key = submitted['report']['data']['findings'][0]['id']
    with app.state.sessions.begin() as db:
        db.get(Report, submitted['report']['id']).decisions = {key: copy.deepcopy(authored)}
    saved = command(customer, sid, 'review-decisions', {'decisions': {}}).json()
    assert saved['report']['decisions'][key] == authored
    assert saved['supplier_review']['counts']['owner_accepted'] == 1
    assert len(saved['report']['decisions']) == len(submitted['report']['data']['findings'])
