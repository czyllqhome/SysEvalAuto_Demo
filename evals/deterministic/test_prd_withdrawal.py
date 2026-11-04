import asyncio

from app.db import Prd
from app.worker import run_once
from test_workflow import command, current, generate_prd, invite_supplier


def test_withdrawal_preserves_history_and_requires_new_approval(owner):
    app, client, sid = generate_prd(owner)
    before = current(client, sid)
    old = before['prd']['id']
    result = command(client, sid, 'prd-withdrawal', {'prd_id': old}).json()
    assert result['system']['status'] == 'CONTROL_REVIEW'
    assert result['system']['revision'] == before['system']['revision'] + 1
    assert result['system']['context_revision_id'] == before['system']['context_revision_id']
    assert result['prd'] is None
    assert {(c['id'], c['included'], c['reason']) for c in result['controls']} == {
        (c['id'], c['included'], c['reason']) for c in before['controls']}
    with app.state.sessions() as db:
        assert db.get(Prd, old).approved
    assert client.get(f'/api/v1/systems/{sid}/prd-versions/{old}/document').status_code == 200
    selected = next(c for c in result['controls'] if c['included'])
    command(client, sid, 'controls', {'control_id': selected['id'], 'included': False, 'reason': 'Scope revised'})
    command(client, sid, 'jobs', {'kind': 'prd_generation', 'mode': 'local', 'language': 'en'})
    assert asyncio.run(run_once(app.state.sessions))
    new = current(client, sid)
    assert new['prd']['id'] != old and not new['prd']['approved']
    command(client, sid, 'supplier-rounds', {'supplier_name': 'Vendor', 'email': 'vendor@example.test'}, expected=409)


def test_withdrawal_rejects_stale_prd_and_retries_idempotently(owner):
    _, client, sid = generate_prd(owner)
    before = current(client, sid)
    command(client, sid, 'prd-withdrawal', {'prd_id': 'wrong'}, expected=409)
    body = {'prd_id': before['prd']['id'], 'version': before['system']['version']}
    path = f'/api/v1/systems/{sid}/prd-withdrawal'
    assert client.post(path, json={**body, 'version': -1}).status_code == 409
    first = client.post(path, json=body, headers={'Idempotency-Key': 'withdraw-once'})
    assert first.status_code == 200
    repeated = client.post(path, json=body, headers={'Idempotency-Key': 'withdraw-once'})
    assert repeated.json() == first.json()
    assert current(client, sid)['system']['revision'] == before['system']['revision'] + 1


def test_no_withdrawal_after_supplier_publication(owner):
    _, client, vendor, sid = invite_supplier(owner)
    before = current(client, sid)
    command(client, sid, 'prd-withdrawal', {'prd_id': before['prd']['id']}, expected=409)
    command(vendor, sid, 'prd-withdrawal', {'prd_id': before['prd']['id']}, expected=404)
    assert current(client, sid)['system'] == before['system']
