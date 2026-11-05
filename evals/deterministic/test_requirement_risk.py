"""Offline regression for minimal residual-risk inputs, output and error reporting."""
import asyncio
import copy

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app import ai
from app.db import AdminAudit, Report, Selection, SupplierRound, System
from app.requirement_risk import KIND, prepare, validate
from app.worker import run_once
from conftest import register
from test_workflow import command, current, invite_supplier


def ready(owner):
    app, client, vendor, sid = invite_supplier(owner)
    detail = current(vendor, sid)
    target = next(r for r in detail['prd']['data']['requirements'] if r['source_control_ids'])
    with app.state.sessions.begin() as db:
        round_ = db.get(SupplierRound, detail['round']['id'])
        round_.snapshot = {**round_.snapshot,
            'context': {**round_.snapshot['context'], 'constraints': 'Pinned network isolation needs verification'},
            'classification': {'effective_level': 'L2', 'answers': {'remote_admin': 'yes'},
                               'assessment': {'large_trace': 'OMITTED ASSESSMENT TRACE'}},
            'controls': [{**c, 'translations': {'zh': {'description': 'Pinned target control' if c['id'] in target['source_control_ids'] else 'UNRELATED CONTROL'}}}
                         for c in round_.snapshot['controls']]}
        for selection in db.scalars(select(Selection).where(Selection.system_id == sid)):
            selection.snapshot = {**selection.snapshot, 'translations': {'zh': {'description': 'MUTABLE CURRENT CONTROL'}}}
    answers = {r['id']: {'implementation_status': 'yes'} for r in detail['prd']['data']['requirements']}
    answers[target['id']] = {'implementation_status': 'no', 'limitations': 'Cannot provide transport encryption',
                            'alternative': 'Disable remote entry until replacement'}
    command(vendor, sid, 'supplier-submit', {'answers': answers, 'round_version': detail['round']['version']})
    command(client, sid, 'jobs', {'kind': 'impact_analysis', 'mode': 'local', 'language': 'en'})
    assert asyncio.run(run_once(app.state.sessions))
    return app, client, vendor, sid, target['id']


def request(client, sid, rid, **extra):
    detail = current(client, sid)
    return client.post(f'/api/v1/systems/{sid}/requirement-risk', json={
        'version': detail['system']['version'], 'report_id': detail['report']['id'],
        'requirement_id': rid, 'language': 'en', **extra})


def advice(source):
    return {'residual_risk': 'If remote access is not fully disabled, unencrypted credentials may still be intercepted.'}


def test_single_advice_sends_only_pinned_control_and_supplier_response(owner, monkeypatch):
    app, client, _, sid, rid = ready(owner)
    before = current(client, sid)

    async def model(kind, source, language, mode):
        assert kind == KIND and mode == 'openrouter' and language == 'en'
        assert set(source) == {'control_items', 'supplier_response'}
        assert len(source['control_items']) == 1
        assert source['supplier_response']['alternative'] == 'Disable remote entry until replacement'
        text = str(source)
        assert 'Pinned target control' in text
        assert all(s not in text for s in ('UNRELATED CONTROL', 'MUTABLE CURRENT CONTROL', 'OMITTED ASSESSMENT TRACE', 'Pinned network isolation needs verification', 'remote_admin'))
        schema = ai.output_schema(kind, source)
        assert set(schema['properties']) == {'residual_risk'}
        assert schema['properties']['residual_risk']['maxLength'] == 240
        return advice(source), {'tokens': 30}

    monkeypatch.setattr(ai, 'generate', model)
    response = request(client, sid, rid)
    assert response.status_code == 200, response.text
    note = response.json()['findings'][0]
    assert response.json()['requirement_id'] == rid
    assert note == advice({})
    after = current(client, sid)
    assert after['report'] == before['report'] and after['system']['version'] == before['system']['version']
    with app.state.sessions() as db:
        audit = db.scalar(select(AdminAudit).where(AdminAudit.action == 'impact.single_requirement_analyzed'))
        assert audit.detail['usage']['tokens'] == 30


@pytest.mark.parametrize('failure,code,status', [('too_long', 'MODEL_SCHEMA_INVALID', 503),
    ('invented_path', 'MODEL_SCHEMA_INVALID', 503), ('provider', 'MODEL_BALANCE_EXCEEDED', 503)])
def test_single_advice_preserves_specific_errors_and_never_publishes_invalid_evidence(owner, monkeypatch, failure, code, status):
    from app.domain import DomainError
    app, client, _, sid, rid = ready(owner)
    before = current(client, sid)

    async def model(kind, source, language, mode):
        if failure == 'provider':
            raise DomainError('MODEL_BALANCE_EXCEEDED', 503)
        value = advice(source)
        if failure == 'too_long':
            value['residual_risk'] = 'R' * 241
        else:
            value['facts'] = [{'path': 'facts.ops.remote_admin', 'quote': 'Invented source'}]
        return value, {'tokens': 50}

    monkeypatch.setattr(ai, 'generate', model)
    response = request(client, sid, rid)
    assert response.status_code == status and response.json()['code'] == code
    assert current(client, sid)['report'] == before['report']
    with app.state.sessions() as db:
        audit = db.scalar(select(AdminAudit).where(AdminAudit.action == 'impact.single_requirement_failed'))
        assert audit.detail['code'] == code
        assert 'Invented source' not in str(audit.detail)


def test_single_advice_rejects_stale_results_and_keeps_organization_boundary(owner, monkeypatch):
    app, client, _, sid, rid = ready(owner)
    calls = []

    async def model(kind, source, language, mode):
        calls.append(rid)
        with app.state.sessions.begin() as db:
            db.get(System, sid).version += 1
        return advice(source), {'tokens': 20}

    monkeypatch.setattr(ai, 'generate', model)
    outsider = TestClient(app)
    register(outsider, 'risk-outsider@example.test')
    assert outsider.post(f'/api/v1/systems/{sid}/requirement-risk', json={}).status_code == 404
    assert request(client, sid, rid, version=-1).status_code == 409
    assert request(client, sid, rid, report_id='another-report').status_code == 409
    assert request(client, sid, 'another-requirement').status_code == 422
    assert calls == []
    response = request(client, sid, rid)
    assert response.status_code == 409 and response.json()['code'] == 'VERSION_CONFLICT'
    with app.state.sessions() as db:
        report = db.get(Report, db.get(System, sid).report_id)
        assert not report.reviewed


def test_advice_has_no_extra_context_and_rejects_blank_output():
    from pydantic import ValidationError
    source = {'prd': {'requirements': [{'id': 'REQ', 'title': 'Control', 'description': 'Published item', 'source_control_ids': ['C']}]},
              'answers': {'REQ': {'implementation_status': 'no', 'limitations': 'Cannot deliver'}},
              'controls': [], 'context': {'constraints': 'Offline, not verified'},
              'classification': {'answers': {'remote_admin': True}},
              'questionnaire': {'answers': {'network': 'Do not send'}}, 'negotiation_instructions': 'Do not send'}
    original = copy.deepcopy(source)
    prepared = prepare(source, 'REQ')
    assert prepared == {'control_items': [{'text': 'Published item', 'source': 'published_requirement'}],
                        'supplier_response': {'implementation_status': 'no', 'limitations': 'Cannot deliver'}}
    assert validate(advice(prepared)) == advice(prepared)
    with pytest.raises(ValidationError):
        validate({'residual_risk': '   '})
    assert source == original
