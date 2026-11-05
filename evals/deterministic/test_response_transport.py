"""Response optimizations preserve authored content, replay and revision checks."""

from test_workflow import prepare


def test_compressed_detail_and_command_replay_preserve_the_same_state(owner):
    _, client, sid = prepare(owner)
    path = f'/api/v1/systems/{sid}'
    plain = client.get(path, headers={'Accept-Encoding': 'identity'})
    compressed = client.get(path, headers={'Accept-Encoding': 'gzip'})
    assert compressed.headers['content-encoding'] == 'gzip'
    assert compressed.headers['cache-control'] == 'no-store'
    assert 'Accept-Encoding' in compressed.headers['vary']
    assert int(compressed.headers['content-length']) < len(plain.content)
    assert compressed.json() == plain.json()

    state = compressed.json()
    body = {'version': state['system']['version'], 'control_id': state['controls'][0]['id'],
            'included': False, 'reason': '保留客户原文 / Authored rationale'}
    saved = client.post(path + '/controls', json=body,
                        headers={'Accept-Encoding': 'gzip', 'Idempotency-Key': 'transport-replay'})
    replay = client.post(path + '/controls', json=body,
                         headers={'Accept-Encoding': 'identity', 'Idempotency-Key': 'transport-replay'})
    assert saved.status_code == replay.status_code == 200
    assert saved.headers['content-encoding'] == 'gzip'
    assert saved.json() == replay.json()
    assert saved.json()['system']['version'] == state['system']['version'] + 1
    control = next(c for c in saved.json()['controls'] if c['id'] == body['control_id'])
    assert control['reason'] == body['reason']
    assert client.post(path + '/controls', json=body).status_code == 409
