"""Offline acceptance journeys for PRD commitments, contextual risk and evidence AI."""
import asyncio
import copy
import io

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import select

from app import worker
from app.ai import local_impact
from app.db import Baseline, Confirmation, Job, SupplierRound, System
from app.delivery_ai import extract, validate_output
from app.delivery_models import DeliveryItem, EvidenceAttachment
from app.domain import DomainError, validate_report
from conftest import register
from test_delivery_workflow import finalized, submit, upload
from test_workflow import command, current, invite_supplier


def contextual():
    return {'exposure': 'No external route in the confirmed scope',
            'exploitation_conditions': 'Requires local administrative access; no remote exploitation path is established',
            'mitigations': 'Isolated network and controlled local accounts; verify at acceptance',
            'uncertainties': [], 'facts': [{'path': 'context.constraints', 'quote': 'isolated offline environment'}]}


@pytest.mark.parametrize('severity,unknown,expected', [('low', False, 'ready_for_review'), ('high', False, 'failed'), ('low', True, 'pending')])
def test_high_gap_explicit_ai_uses_pinned_system_facts_and_requires_human_review(owner, monkeypatch, severity, unknown, expected):
    app, client, vendor, sid = invite_supplier(owner)
    detail = current(vendor, sid)
    target = next(r for r in detail['prd']['data']['requirements'] if r['source_control_ids'])
    with app.state.sessions.begin() as db:
        system = db.get(System, sid)
        round_ = db.get(SupplierRound, system.round_id)
        round_.snapshot = {**round_.snapshot, 'context': {**round_.snapshot['context'], 'constraints': 'isolated offline environment'},
                           'questionnaire': {'answers': {'deployment': ['local'], 'internet': 'no'}},
                           'controls': [{'id': target['source_control_ids'][0], 'metadata': {'source': {'schema': 'CONTROL-SIX/1',
                                         'languages': {'zh': {'fields': {'risk_level': 'High'}}}}}}]}
    monkeypatch.setenv('OPENROUTER_API_KEY', 'offline-test-key')
    monkeypatch.setenv('OPENROUTER_MODEL', 'offline-model')
    observed = []

    async def model(kind, source, language, mode):
        observed.append(source)
        assert mode == 'openrouter'
        result = local_impact(source, language)
        for f in result['findings']:
            if f['requirement_id'] == target['id']:
                f.update(severity=severity, contextual_assessment=contextual())
                if unknown:
                    f['contextual_assessment']['uncertainties'] = ['Isolation has not been verified']
        return result, {'tokens': 100, 'mode': mode}

    monkeypatch.setattr(worker, 'generate', model)
    answers = {r['id']: {'implementation_status': 'yes', 'duration_workdays': 5, 'owner_name': 'Supplier',
                        'implementation_plan': 'Implement and verify'} for r in detail['prd']['data']['requirements']}
    answers[target['id']] = {'implementation_status': 'no', 'limitations': 'Cannot supply this control'}
    command(vendor, sid, 'supplier-submit', {'answers': answers, 'round_version': detail['round']['version'], 'mode': 'local', 'language': 'en'})
    assert not asyncio.run(worker.run_once(app.state.sessions))
    assert observed == []
    command(client, sid, 'jobs', {'kind': 'impact_analysis', 'mode': 'openrouter', 'language': 'en'})
    assert asyncio.run(worker.run_once(app.state.sessions))
    report = current(client, sid)['report']
    assert observed[0]['questionnaire']['answers']['internet'] == 'no'
    assert report['source_assessment']['status'] == expected
    assert not report['reviewed']
    command(client, sid, 'baselines', expected=422 if expected == 'ready_for_review' else 409)
    decisions = {f['id']: {'decision': 'accept', 'reason': 'Reviewed applicability and residual risk; verify isolation before release'} for f in report['data']['findings']}
    # A model rating never substitutes for explicit acceptance of source-High risk.
    command(client, sid, 'review-decisions', {'decisions': decisions}, expected=409)
    for finding in report['data']['findings']:
        if finding['requirement_id'] == target['id']:
            decisions[finding['id']]['owner_reviewed'] = True
    accepted = command(client, sid, 'review-decisions', {'decisions': decisions}).json()
    assert target['id'] in accepted['report']['source_assessment']['owner_accepted_requirements']
    baseline = command(client, sid, 'baselines').json()['baseline']
    assert baseline['content_hash']
    assert client.get(f"/api/v1/baselines/{baseline['id']}/document").status_code == 409


def test_contextual_risk_cannot_invent_system_evidence():
    source = {'context': {'constraints': 'isolated offline environment'}, 'prd': {'requirements': [{'id': 'R', 'title': 'Control'}]},
              'answers': {'R': {'implementation_status': 'no', 'limitations': 'Cannot deliver'}}}
    result = local_impact(source, 'en')
    result['findings'][0].update(severity='low', contextual_assessment=contextual())
    assert validate_report(result, source['prd']['requirements'], source['answers'], contextual_source=source)['findings'][0]['severity'] == 'low'
    result['findings'][0]['contextual_assessment']['facts'][0]['quote'] = 'Verified air gap and hardware write protection'
    with pytest.raises(DomainError, match='INVALID_SOURCE_REFERENCE'):
        validate_report(result, source['prd']['requirements'], source['answers'], contextual_source=source)


def test_final_document_requires_two_confirmations_and_contains_pinned_commitments(owner):
    app, client, vendor, sid, baseline, _ = finalized(owner)
    path = f"/api/v1/baselines/{baseline['id']}/document"
    response = vendor.get(path)
    assert response.status_code == 200
    assert baseline['content_hash'] in response.text
    assert 'Supplier commitments and review decisions' in response.text or '供应商承诺与审查决定' in response.text
    with app.state.sessions() as db:
        p = db.get(Baseline, baseline['id']).payload
        assert p['answers'][next(iter(p['answers']))]['implementation_plan'] in response.text
    outsider = TestClient(app)
    register(outsider, 'outsider-final@example.test')
    assert outsider.get(path).status_code == 404
    with app.state.sessions.begin() as db:
        db.delete(db.scalar(select(Confirmation).where(Confirmation.baseline_id == baseline['id'], Confirmation.party == 'supplier')))
    assert client.get(path).status_code == 409


def test_delivery_ai_reads_immutable_attachment_and_preserves_customer_acceptance(owner, monkeypatch):
    app, client, vendor, sid, _, batch = finalized(owner)
    monkeypatch.setenv('OPENROUTER_API_KEY', 'offline-test-key')
    monkeypatch.setenv('OPENROUTER_MODEL', 'offline-model')
    calls = []

    async def model(kind, source, language, mode):
        calls.append(source)
        assert kind.startswith('delivery_evidence:') and mode == 'openrouter'
        assert source['attachments'][0]['text'] == 'Permission denied: expected result'
        return {'summary': 'Evidence inspected', 'criteria': [
            {'criterion_id': c['id'], 'result': 'PASS', 'rationale': 'Observed permission denied in the supplied test output',
             'attachment_ids': source['draft']['criteria_evidence_map'][c['id']]} for c in source['criteria']]}, {'tokens': 70}

    monkeypatch.setattr(worker, 'generate', model)
    item = submit(vendor, batch, batch['items'][0])
    assert item['submissions'][-1]['ai']['state'] == 'queued'
    assert asyncio.run(worker.run_once(app.state.sessions))
    item = vendor.get(f"/api/v1/delivery-items/{item['id']}").json()
    assert item['status'] == 'IN_REVIEW'  # AI never impersonates customer acceptance.
    assert item['submissions'][-1]['ai']['output']['decision'] == 'PASS'
    assert item['submissions'][-1]['review'] is None
    sub_id = item['submissions'][-1]['id']
    assert vendor.post(f'/api/v1/delivery-submissions/{sub_id}/ai-assessments', json={'version': item['version']}).status_code == 200
    assert len(calls) == 1
    outsider = TestClient(app)
    register(outsider, 'outsider-ai@example.test')
    assert outsider.post(f'/api/v1/delivery-submissions/{sub_id}/ai-assessments', json={'version': item['version']}).status_code == 404


def test_changed_delivery_source_discards_ai_result(owner, monkeypatch):
    app, _, vendor, sid, _, batch = finalized(owner)
    monkeypatch.setenv('OPENROUTER_API_KEY', 'offline-test-key')
    monkeypatch.setenv('OPENROUTER_MODEL', 'offline-model')
    item = submit(vendor, batch, batch['items'][0])

    async def model(kind, source, language, mode):
        with app.state.sessions.begin() as db:
            db.get(System, sid).revision += 1
        return {'summary': 'Stale', 'criteria': []}, {'tokens': 10}

    monkeypatch.setattr(worker, 'generate', model)
    assert asyncio.run(worker.run_once(app.state.sessions))
    with app.state.sessions() as db:
        job = db.get(Job, item['submissions'][-1]['ai']['id'])
        assert job.state == 'stale'
        assert not job.output


def test_evidence_validation_rejects_wrong_refs_and_incomplete_extraction():
    source = {'criteria': [{'id': 'AC-1'}], 'draft': {'criteria_evidence_map': {'AC-1': ['a']}},
              'attachments': [{'id': 'a', 'read_status': 'partial'}], 'manifest_hash': 'm', 'source_hash': 's'}
    output = {'summary': 'Review', 'criteria': [{'criterion_id': 'AC-1', 'result': 'PASS', 'rationale': 'Observed', 'attachment_ids': ['a']}]}
    assert validate_output(output, source)['decision'] == 'NEEDS_MORE_EVIDENCE'
    bad = copy.deepcopy(output)
    bad['criteria'][0]['attachment_ids'] = ['other-item-file']
    with pytest.raises(DomainError, match='INVALID_SOURCE_REFERENCE'):
        validate_output(bad, source)
    with pytest.raises(DomainError, match='INCOMPLETE_COVERAGE'):
        validate_output({'summary': 'Review', 'criteria': []}, source)
    row = EvidenceAttachment(filename='proof.py', mime='text/plain', content=b'assert request.status_code == 403')
    assert extract(row)['text'].startswith('assert request')


def test_delivery_screenshots_reach_vision_payload(owner, monkeypatch):
    from app.delivery_ai import job_source, with_images
    app, _, vendor, sid, _, batch = finalized(owner)
    picture = io.BytesIO()
    Image.new('RGB', (16, 16), 'blue').save(picture, format='PNG')
    result = upload(vendor, batch['items'][0], 'screen.png', picture.getvalue())
    row = result['attachment']
    item = next(i for i in result['items'] if i['id'] == batch['items'][0]['id'])
    draft = {**row['meta'], 'attachment_ids': [row['id']], 'criteria_evidence_map': {c['id']: [row['id']] for c in item['criteria']}}
    response = vendor.put(f"/api/v1/delivery-items/{item['id']}/draft", json={'version': item['version'], 'draft': draft}).json()
    item = next(i for i in response['items'] if i['id'] == item['id'])
    response = vendor.post(f"/api/v1/delivery-items/{item['id']}/submissions", json={'version': item['version'], 'expected_source_hash': batch['source_hash']})
    assert response.status_code == 200
    sub = next(i for i in response.json()['items'] if i['id'] == item['id'])['submissions'][-1]
    with app.state.sessions() as db:
        src = with_images(db, job_source(db, db.get(System, sid), sub['id']))
        assert src['_images'][0]['url'].startswith('data:image/png;base64,')
        assert src['_images'][0]['id'] == row['id']
        assert db.get(DeliveryItem, item['id']).status == 'IN_REVIEW'


def test_large_impact_report_batches_without_losing_references(monkeypatch):
    from app import ai
    reqs = [{'id': f'R-{i}', 'title': f'Control {i}', 'source_control_ids': [f'C-{i}']} for i in range(29)]
    source = {'prd': {'requirements': reqs}, 'context': {},
              'controls': [{'id': f'C-{i}'} for i in range(29)],
              'answers': {r['id']: {'implementation_status': 'yes', 'implementation_plan': 'Implement and verify'} for r in reqs}}
    calls = []

    async def model(kind, subset, language, mode):
        calls.append(subset)
        assert len(subset['prd']['requirements']) <= 12
        assert set(subset['answers']) == {r['id'] for r in subset['prd']['requirements']}
        return local_impact(subset, language), {'tokens': 100, 'cost': 0.01}

    monkeypatch.setattr(ai, 'generate_single', model)
    output, usage = asyncio.run(ai.generate('impact_analysis', source, 'en', 'openrouter'))
    assert len(calls) == 3 and usage['tokens'] == 300
    assert len({f['id'] for f in output['findings']}) == 29
    assert {f['requirement_id'] for f in output['findings']} == set(source['answers'])
