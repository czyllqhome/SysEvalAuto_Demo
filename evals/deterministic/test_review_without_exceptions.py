"""Retire the separate review field without erasing history or bypassing baseline gates."""
import asyncio

from app.db import Baseline
from app.worker import run_once
from test_workflow import invite_supplier, command, current


def ready(owner):
    app, client, vendor, sid = invite_supplier(owner)
    detail = current(vendor, sid)
    answers = {r['id']: {'implementation_status': 'yes'} for r in detail['prd']['data']['requirements']}
    command(vendor, sid, 'supplier-submit', {'answers': answers, 'round_version': detail['round']['version']})
    command(client, sid, 'jobs', {'kind': 'impact_analysis', 'mode': 'local', 'language': 'en'})
    assert asyncio.run(run_once(app.state.sessions))
    decisions = {f['id']: {'decision': 'accept', 'reason': 'Owner will verify delivery evidence'}
                 for f in current(client, sid)['report']['data']['findings']}
    return app, client, vendor, sid, decisions


def test_review_and_independent_confirmation_without_retired_exception_field(owner):
    app, client, vendor, sid, decisions = ready(owner)
    result = command(client, sid, 'review-decisions', {'decisions': decisions}).json()
    assert result['report']['reviewed']
    assert result['report']['decisions'] == decisions
    baseline = command(client, sid, 'baselines').json()['baseline']
    path = f"/api/v1/baselines/{baseline['id']}"
    assert client.get(path + '/document').status_code == 409
    response = client.post(path + '/confirmations', json={'version': current(client, sid)['system']['version'], 'content_hash': 'wrong-hash'})
    assert response.status_code == 409
    for party in (client, vendor):
        response = party.post(path + '/confirmations', json={
            'version': current(party, sid)['system']['version'], 'content_hash': baseline['content_hash']})
        assert response.status_code == 200, response.text
        if party is client:
            assert client.get(path + '/document').status_code == 409
    response = client.post(path + '/finalize', json={'version': current(client, sid)['system']['version']})
    assert response.status_code == 200, response.text
    document = client.get(path + '/document')
    assert document.status_code == 200
    assert 'Exception and exclusion review' not in document.text
    assert '例外及排除审查' not in document.text
    with app.state.sessions() as db:
        assert db.get(Baseline, baseline['id']).payload['decisions'] == decisions


def test_review_preserves_authored_legacy_notes_and_still_validates_items_and_access(owner):
    app, client, vendor, sid, decisions = ready(owner)
    note = '历史人工说明\nKeep authored text and references.'
    before = command(client, sid, 'review-decisions', {'decisions': decisions, 'exception_reason': note}).json()['report']
    command(vendor, sid, 'review-decisions', {'decisions': decisions}, expected=404)
    command(client, sid, 'review-decisions', {'decisions': decisions, 'version': -1}, expected=409)
    command(client, sid, 'review-decisions', {'decisions': {}}, expected=422)
    invalid = {**decisions, next(iter(decisions)): {'decision': 'accept', 'reason': ' '}}
    command(client, sid, 'review-decisions', {'decisions': invalid}, expected=422)
    for optional in ({}, {'exception_reason': ''}, {'exception_reason': None}):
        report = command(client, sid, 'review-decisions', {'decisions': decisions, **optional}).json()['report']
        assert report['decisions']['_exceptions']['reason'] == note
        assert report['data'] == before['data']
    baseline = command(client, sid, 'baselines').json()['baseline']
    with app.state.sessions() as db:
        assert db.get(Baseline, baseline['id']).payload['decisions']['_exceptions']['reason'] == note
