"""Actual scoped audit excerpts are read-only until explicitly uploaded and saved."""
import base64
import copy
import json
from datetime import date
from io import BytesIO

from fastapi.testclient import TestClient
from PIL import Image

from app.db import Audit
from app.delivery_models import DeliveryItem
from conftest import register
from test_delivery_workflow import finalized


def test_collection_date_uses_local_calendar_day():
    import pytest
    from app.delivery_rules import metadata
    from app.domain import DomainError
    body = {'description': 'Audit evidence', 'environment': 'Local', 'system_version': 'v0.1', 'collected_on': '2026-11-06'}
    assert metadata(body, today=date(2026, 11, 6))['collected_on'] == '2026-11-06'
    with pytest.raises(DomainError):
        metadata({**body, 'collected_on': '2026-11-07'}, today=date(2026, 11, 6))


def test_actual_audit_preview_is_scoped_bilingual_and_does_not_change_delivery(owner):
    app, customer, supplier, sid, _, batch = finalized(owner)
    item = batch['items'][0]
    with app.state.sessions.begin() as db:
        row = db.get(DeliveryItem, item['id'])
        row.snapshot = {**row.snapshot, 'requirement': {**row.snapshot['requirement'], 'title': '安全审计'}}
        db.add(Audit(system_id=sid, action='supplier.submitted', actor_id=None,
                     detail={'secret': 'must-never-appear-in-evidence'}))
    path = f"/api/v1/delivery-items/{item['id']}/audit-evidence-preview"
    before = copy.deepcopy(supplier.get(f"/api/v1/delivery-items/{item['id']}").json())
    for language in ('zh', 'en'):
        result = supplier.get(path, params={'language': language})
        assert result.status_code == 200, result.text
        data = result.json()
        assert 'must-never-appear' not in str(data)
        assert all(word not in data['draft']['description'].lower() for word in ('演示', 'demo', 'demonstration'))
        image = Image.open(BytesIO(base64.b64decode(data['image_base64'])))
        assert image.format == 'PNG' and image.width == 1320 and image.height > 190
    assert supplier.get(f"/api/v1/delivery-items/{item['id']}").json() == before
    assert customer.get(path).status_code in (403, 404)
    assert supplier.get(path, params={'language': 'bad'}).status_code == 422
    other_item = batch['items'][1]
    assert supplier.get(f"/api/v1/delivery-items/{other_item['id']}/audit-evidence-preview").status_code == 422
    with TestClient(app) as outsider:
        register(outsider, 'outside-audit-demo@example.test')
        assert outsider.get(path).status_code == 404
    uploaded = supplier.post(f"/api/v1/delivery-items/{item['id']}/attachments",
        content=base64.b64decode(data['image_base64']), headers={
            'Content-Type': 'application/octet-stream',
            'X-Evidence-Metadata': base64.b64encode(json.dumps({**data['draft'],
                'filename': data['filename'], 'version': before['version']}).encode()).decode()})
    assert uploaded.status_code == 200, uploaded.text
    assert uploaded.json()['attachment']['mime'] == 'image/png'
