"""Topology evidence stays authorized and becomes part of immutable PRD documents."""
import asyncio
import base64
from io import BytesIO

from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import select

from app.ai import prd_transport_source
from app.db import Job, Prd
from app.worker import run_once
from conftest import register
from test_workflow import command, current, prepare

buffer = BytesIO()
Image.new('RGB', (2, 2), 'white').save(buffer, format='PNG')
PNG = buffer.getvalue()


def upload(client, sid, filename='Topology.png', content=PNG):
    return command(client, sid, 'mlps-intake/evidence', {
        'question': 'network_zones_description', 'filename': filename,
        'content': base64.b64encode(content).decode()}).json()['mlps_evidence']['id']


def test_topology_routes_scope_and_images_only(owner):
    app, client, sid = prepare(owner)
    eid = upload(client, sid)
    text_id = upload(client, sid, 'Notes.txt', b'Not an image')
    path = f'/api/v1/systems/{sid}/network-topology'
    images = client.get(path).json()['images']
    assert [item['id'] for item in images] == [eid]
    assert images == current(client, sid)['system']['network_topology']
    response = client.get(path + '/' + eid)
    assert response.content == PNG
    assert response.headers['content-type'] == 'image/png'
    assert response.headers['x-content-sha256'] == images[0]['sha256']
    assert client.get(path + '/' + text_id).status_code == 404
    other_sid = client.post('/api/v1/systems', json={'name': 'Other system'}).json()['system']['id']
    assert client.get(f'/api/v1/systems/{other_sid}/network-topology/{eid}').status_code == 404
    with TestClient(app) as outsider:
        register(outsider, 'outsider-topology@example.test')
        assert outsider.get(path).status_code == 404
        assert outsider.get(path + '/' + eid).status_code == 404


def test_prd_embeds_original_topology_without_sending_image_to_model(owner):
    app, client, sid = prepare(owner)
    upload(client, sid)
    command(client, sid, 'jobs', {'kind': 'prd_generation', 'mode': 'local', 'language': 'zh'})
    with app.state.sessions() as db:
        job = db.scalar(select(Job).where(Job.system_id == sid, Job.kind == 'prd_generation'))
        assert 'data_url' not in str(job.input)
        assert 'network_topology' not in prd_transport_source(job.input, 'zh')
    assert asyncio.run(run_once(app.state.sessions))
    detail = current(client, sid)
    pid = detail['prd']['id']
    document = client.get(f'/api/v1/systems/{sid}/prd-versions/{pid}/document').text
    assert document.index('系统开发架构') < document.index('### 网络拓扑图') < document.index('## 7')
    assert 'data:image/png;base64,' + base64.b64encode(PNG).decode() in document
    command(client, sid, 'prd-versions', {'data': detail['prd']['data']})
    with app.state.sessions() as db:
        assert db.get(Prd, pid).markdown == document
        assert all('### 网络拓扑图' in p.markdown for p in db.scalars(select(Prd).where(Prd.system_id == sid)))
    command(client, sid, 'prd-approval')
    invitation = command(client, sid, 'supplier-rounds', {'supplier_name': 'Supplier', 'email': 'topology-supplier@example.test'}).json()
    with TestClient(app) as vendor:
        register(vendor, 'topology-supplier@example.test', invite_token=invitation['invite_token'])
        assigned = current(vendor, sid)
        assigned_document = vendor.get(f"/api/v1/systems/{sid}/prd-versions/{assigned['prd']['id']}/document")
        assert 'data:image/png;base64,' in assigned_document.text
        assert vendor.get(f'/api/v1/systems/{sid}/network-topology').status_code == 403
        assert 'network_topology' not in assigned['system']


def test_upload_after_scheduling_makes_prd_job_stale(owner):
    app, client, sid = prepare(owner)
    command(client, sid, 'jobs', {'kind': 'prd_generation', 'mode': 'local', 'language': 'zh'})
    upload(client, sid)
    assert asyncio.run(run_once(app.state.sessions))
    with app.state.sessions() as db:
        assert db.scalar(select(Job).where(Job.system_id == sid, Job.kind == 'prd_generation')).state == 'stale'
        assert db.scalar(select(Prd).where(Prd.system_id == sid)) is None
