"""Offline Word downloads preserve pinned content, images and access boundaries."""

import base64
from io import BytesIO
from xml.etree import ElementTree as ET
from zipfile import ZipFile

from docx import Document
from fastapi.testclient import TestClient
from PIL import Image
import pytest
from sqlalchemy import select

from app.db import Baseline, Confirmation, Prd
from app.document_export import DOCX_MEDIA_TYPE, render_docx
from app.domain import digest
from conftest import register
from test_delivery_workflow import finalized
from test_prd_templates import save
from test_workflow import command, current, generate_prd, invite_supplier


def read_word(response):
    assert response.status_code == 200, response.text[:100] if response.status_code != 200 else ''
    assert response.headers['content-type'] == DOCX_MEDIA_TYPE
    assert response.headers['content-disposition'].endswith('.docx"')
    assert response.headers['cache-control'] == 'no-store'
    return Document(BytesIO(response.content))


def text(document):
    return '\n'.join(p.text for p in document.paragraphs) + '\n' + '\n'.join(
        cell.text for table in document.tables for row in table.rows for cell in row.cells)


@pytest.mark.parametrize('language', ['zh', 'en'])
def test_word_preserves_authored_text_tables_lists_code_and_source_metadata(language):
    markdown = '''<!-- syseval:prd-layout-v3 -->
# 系统需求 PRD

本地规则草稿 / Local rule-based draft

## 功能需求

保留 **中文原文** and *English*, ~~旧说明~~ and `REQ-001`.

3. 第三项
   - 嵌套项
4. 第四项

| 编号 | 说明 | 数量 |
| --- | --- | ---: |
| C-1 | 原文 A & B<br>第二行 | 10 |

<!-- syseval:prd-appendix -->
## 来源附录

<!-- questionnaire:A01 system_name -->
来源 source.xlsx / F1 / C-1

```json
{"content_hash": "original-hash", "authored": "中文"}
```
'''
    data = render_docx(markdown, language=language, identifier='prd-id', content_hash='original-hash')
    document = Document(BytesIO(data))
    assert document.paragraphs[0].style.name == 'Title'
    assert document.paragraphs[0].text == '系统需求 PRD'
    assert not document.styles['Title'].element.xpath('./w:pPr/w:pBdr')
    for phrase in ['本地规则草稿 / Local rule-based draft', '中文原文', 'English', 'REQ-001',
                   '3. 第三项', '• 嵌套项', '4. 第四项', '来源附录', 'source.xlsx / F1 / C-1', 'original-hash']:
        assert phrase in text(document)
    assert 'syseval:prd-appendix' not in text(document)
    assert document.tables[0].cell(1, 1).text == '原文 A & B\n第二行'
    assert document.core_properties.identifier == 'prd-id'
    with ZipFile(BytesIO(data)) as package:
        record = ET.fromstring(package.read('customXml/syseval.xml'))
        assert record.find('{urn:syseval:document-export}markdown').text == markdown
        assert 'w:tblHeader' in package.read('word/document.xml').decode()
    assert render_docx(markdown, language=language, identifier='prd-id', content_hash='original-hash') == data


@pytest.mark.parametrize('format,mime', [('PNG', 'png'), ('JPEG', 'jpeg'), ('WEBP', 'webp')])
def test_word_embeds_published_raster_and_ignores_remote_or_active_content(format, mime):
    picture = BytesIO()
    Image.new('RGB', (1600, 900), 'navy').save(picture, format=format)
    raw = picture.getvalue()
    markdown = f'''# Topology

![原始网络图](data:image/{mime};base64,{base64.b64encode(raw).decode()})

![remote](https://example.test/tracker.png)

![svg](data:image/svg+xml;base64,PHN2Zy8+)

![broken](data:image/png;base64,YWJj)

<script>DO_NOT_EXECUTE_OR_RENDER</script>

[source](https://example.test/source) and [unsafe](javascript:alert)
'''
    data = render_docx(markdown)
    document = Document(BytesIO(data))
    assert len(document.inline_shapes) == 1
    assert document.inline_shapes[0].width <= 16.6 * 360000
    assert 'remote' in text(document) and 'broken' in text(document)
    assert 'DO_NOT_EXECUTE_OR_RENDER' not in text(document)
    with ZipFile(BytesIO(data)) as package:
        pictures = [name for name in package.namelist() if name.startswith('word/media/')]
        assert len(pictures) == 1
        if format != 'WEBP':
            assert package.read(pictures[0]) == raw
        else:
            assert Image.open(BytesIO(package.read(pictures[0]))).size == (1600, 900)
        rels = package.read('word/_rels/document.xml.rels').decode()
        assert 'example.test/source' in rels
        assert 'tracker.png' not in rels and 'javascript:' not in rels


def test_word_download_uses_the_saved_revision_without_modifying_or_refreshing_it(owner):
    app, client, sid = generate_prd(owner)
    before = current(client, sid)
    original = before['prd']
    path = f"/api/v1/systems/{sid}/prd-versions/{original['id']}/document"
    markdown = client.get(path).text
    save(client, {'filename': 'next.md', 'content': '# DIFFERENT CURRENT TEMPLATE {{name}}'})
    document = read_word(client.get(path, params={'format': 'docx'}))
    assert original['data']['requirements'][0]['id'] in text(document)
    assert 'DIFFERENT CURRENT TEMPLATE' not in text(document)
    assert client.get(path, params={'format': 'markdown'}).text == markdown
    assert client.get(path, params={'format': 'pdf'}).status_code == 422
    assert current(client, sid) == before
    with app.state.sessions() as db:
        prd = db.get(Prd, original['id'])
        assert prd.markdown == markdown and prd.content_hash == original['content_hash']
        assert prd.approved == original['approved']
    command(client, sid, 'prd-versions', {'refresh_template': True, 'prd_id': original['id']})
    assert 'DIFFERENT CURRENT TEMPLATE' not in text(read_word(client.get(path, params={'format': 'docx'})))


def test_supplier_word_download_remains_scoped_to_published_prds(owner):
    app, client, vendor, sid = invite_supplier(owner)
    prd_id = current(vendor, sid)['prd']['id']
    path = f'/api/v1/systems/{sid}/prd-versions/{prd_id}/document?format=docx'
    assert text(read_word(vendor.get(path))) == text(read_word(client.get(path)))
    with app.state.sessions.begin() as db:
        original = db.get(Prd, prd_id)
        unpublished = Prd(system_id=sid, revision=original.revision, language='zh', mode='local',
                          data=original.data, markdown='# Not published', content_hash=digest('unpublished'))
        db.add(unpublished)
        db.flush()
        hidden_id = unpublished.id
    assert vendor.get(f'/api/v1/systems/{sid}/prd-versions/{hidden_id}/document?format=docx').status_code == 404
    outsider = TestClient(app)
    register(outsider, 'word-outsider@example.test')
    assert outsider.get(path).status_code == 404
    assert TestClient(app).get(path).status_code == 401


def test_final_word_requires_independent_confirmations_and_keeps_the_baseline(owner):
    app, client, vendor, sid, baseline, _ = finalized(owner)
    path = f"/api/v1/baselines/{baseline['id']}/document?format=docx"
    before = current(client, sid)
    document = read_word(vendor.get(path))
    assert baseline['content_hash'] in text(document)
    assert '供应商承诺与审查决定' in text(document) or 'Supplier commitments and review decisions' in text(document)
    with app.state.sessions() as db:
        frozen = db.get(Baseline, baseline['id'])
        assert frozen.content_hash == digest(frozen.payload)
        for answer in frozen.payload['answers'].values():
            assert answer['implementation_plan'] in text(document)
        for confirmation in db.scalars(select(Confirmation).where(Confirmation.baseline_id == baseline['id'])):
            assert confirmation.actor_id in text(document)
    assert current(client, sid) == before
    outsider = TestClient(app)
    register(outsider, 'final-word-outsider@example.test')
    assert outsider.get(path).status_code == 404
    with app.state.sessions.begin() as db:
        confirmation = db.scalar(select(Confirmation).where(Confirmation.baseline_id == baseline['id'], Confirmation.party == 'supplier'))
        confirmation.content_hash = 'wrong-hash'
    assert client.get(path).status_code == 409
    with app.state.sessions.begin() as db:
        db.delete(db.scalar(select(Confirmation).where(Confirmation.baseline_id == baseline['id'], Confirmation.party == 'supplier')))
    assert client.get(path).status_code == 409
