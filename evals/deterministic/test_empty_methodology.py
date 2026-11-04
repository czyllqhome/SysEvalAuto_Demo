"""The real application must not recreate retired demonstration content."""
from sqlalchemy import select, func
from app import methodology
from app.catalog import seed_catalog
from app.db import Control
from app.intake.questionnaire import schema
from conftest import register


def test_empty_methodology_blocks_old_questions_and_auto_seeding(application, monkeypatch):
    monkeypatch.setattr(methodology, 'LEGACY_FIXTURES_ENABLED', False)
    app, client = application
    user = register(client)['user']
    assert schema()['questions'] == []
    assert schema()['tags'] == {}
    with app.state.sessions() as db:
        seed_catalog(db, user['org_id'])
        db.commit()
        assert db.scalar(select(func.count()).select_from(Control)) == 346
    detail = client.post('/api/v1/systems', json={'name': 'Empty methodology'}).json()
    sid = detail['system']['id']
    assert client.get(f'/api/v1/systems/{sid}/questionnaire').json()['definition']['questions'] == []
    result = client.post(f'/api/v1/systems/{sid}/classification-confirmations', json={
        'version': detail['system']['version'], 'mode': 'questionnaire', 'answers': {'Q1': 'L3'}})
    assert result.status_code == 409
    assert client.put(f'/api/v1/systems/{sid}/questionnaire', json={}).status_code == 409
