"""Word exports of saved Markdown; no regeneration, database writes or remote I/O."""

import base64
import binascii
from datetime import datetime, timezone
from io import BytesIO
import re
from urllib.parse import urlsplit
from xml.etree import ElementTree as ET
from zipfile import ZIP_DEFLATED, ZipFile

from docx import Document
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.opc.constants import RELATIONSHIP_TYPE as RT
from docx.opc.packuri import PackURI
from docx.opc.part import Part
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor
from markdown_it import MarkdownIt
from PIL import Image, UnidentifiedImageError


DOCX_MEDIA_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
RENDERER_VERSION = 'syseval-docx/1'
PAGE_WIDTH = Cm(16.6)
RASTER_URL = re.compile(r'data:image/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)\Z')


def element(tag, **attrs):
    node = OxmlElement(f'w:{tag}')
    for name, value in attrs.items():
        node.set(qn(f'w:{name}'), str(value))
    return node


def configure(document, language):
    section = document.sections[0]
    section.page_width, section.page_height = Cm(21), Cm(29.7)
    section.left_margin = section.right_margin = Cm(2.2)
    section.top_margin = section.bottom_margin = Cm(2)
    for name, size in [('Normal', 10.5), ('Title', 22), *[(f'Heading {i}', max(11, 17 - i * 2)) for i in range(1, 10)]]:
        style = document.styles[name]
        style.font.name = 'Arial'
        style.font.size = Pt(size)
        style.font.color.rgb = RGBColor(0, 0, 0)
        props = style.element.get_or_add_rPr()
        props.rFonts.set(qn('w:eastAsia'), 'Microsoft YaHei')
        for attribute in ('asciiTheme', 'hAnsiTheme', 'eastAsiaTheme', 'cstheme'):
            props.rFonts.attrib.pop(qn(f'w:{attribute}'), None)
        for border in style.element.xpath('./w:pPr/w:pBdr'):
            border.getparent().remove(border)
        props.append(element('lang', val='zh-CN' if language == 'zh' else 'en-US', eastAsia='zh-CN'))
        fmt = style.paragraph_format
        fmt.space_after = Pt(6 if name == 'Normal' else 8)
        fmt.space_before = Pt(12 if name.startswith('Heading') else 0)
        fmt.line_spacing = 1.2
        fmt.widow_control = True
        fmt.keep_with_next = name != 'Normal'
    document.core_properties.author = 'System Security Assessment'
    document.core_properties.last_modified_by = ''
    document.core_properties.language = 'zh-CN' if language == 'zh' else 'en-US'
    # Exporting is not a new business revision. Avoid wall-clock metadata in derived files.
    document.core_properties.created = document.core_properties.modified = datetime(2000, 1, 1, tzinfo=timezone.utc)


def add_image(paragraph, token, width):
    """Embed only the raster bytes already published in this PRD, never fetch URLs."""
    match = RASTER_URL.fullmatch(token.attrGet('src') or '')
    if match and len(match[2]) <= 28 * 1024 * 1024:
        try:
            raw = base64.b64decode(match[2], validate=True)
            with Image.open(BytesIO(raw)) as picture:
                if picture.format not in {'PNG', 'JPEG', 'WEBP'} or picture.width * picture.height > 40_000_000:
                    raise ValueError('Unsupported raster')
                picture.verify()
            with Image.open(BytesIO(raw)) as picture:
                w, h = picture.size
                if picture.format == 'WEBP':
                    converted = BytesIO()
                    picture.save(converted, format='PNG')
                    raw = converted.getvalue()
            # Preserve aspect ratio and leave space for a heading/caption on the page.
            scale = min(width / w, Cm(18) / h, 9525)
            shape = paragraph.add_run().add_picture(BytesIO(raw), width=int(w * scale), height=int(h * scale))
            shape._inline.docPr.set('descr', token.content)
            return
        except (ValueError, OSError, binascii.Error, UnidentifiedImageError, Image.DecompressionBombError):
            pass
    # Same policy as the web preview for unsupported, broken or remote images.
    paragraph.add_run(token.content or '[Image]')


def inline(paragraph, tokens, width=PAGE_WIDTH):
    bold = italic = strike = 0
    link = None
    for token in tokens or []:
        if token.type in {'strong_open', 'strong_close'}:
            bold += token.nesting
        elif token.type in {'em_open', 'em_close'}:
            italic += token.nesting
        elif token.type in {'s_open', 's_close'}:
            strike += token.nesting
        elif token.type == 'link_open':
            href = token.attrGet('href') or ''
            if urlsplit(href).scheme.lower() in {'', 'https', 'http', 'mailto'}:
                link = element('hyperlink')
                if href.startswith('#'):
                    link.set(qn('w:anchor'), href[1:])
                else:
                    link.set(qn('r:id'), paragraph.part.relate_to(href, RT.HYPERLINK, is_external=True))
                paragraph._p.append(link)
        elif token.type == 'link_close':
            link = None
        elif token.type == 'image':
            add_image(paragraph, token, width)
        elif token.type in {'text', 'code_inline', 'softbreak', 'hardbreak'} or (
            token.type == 'html_inline' and re.fullmatch(r'<br\s*/?>', token.content, re.I)
        ):
            text = token.content if token.type in {'text', 'code_inline'} else '\n'
            run = paragraph.add_run(text)
            if bold:
                run.bold = True
            if italic:
                run.italic = True
            if strike:
                run.font.strike = True
            if token.type == 'code_inline':
                run.font.name = 'Consolas'
            if link is not None:
                run.font.underline = True
                link.append(run._r)


def add_table(document, tokens):
    rows = []
    for token in tokens:
        if token.type == 'tr_open':
            rows.append([])
        elif token.type in {'th_open', 'td_open'}:
            rows[-1].append({'tokens': [], 'alignment': token.attrGet('style') or ''})
        elif token.type == 'inline':
            rows[-1][-1]['tokens'] = token.children
    if not rows:
        return
    count = len(rows[0])
    weights = [max(4, min(60, max(sum(len(t.content) for t in row[i]['tokens']) for row in rows))) ** .5 for i in range(count)]
    widths = [int(PAGE_WIDTH * w / sum(weights)) for w in weights]
    table = document.add_table(rows=0, cols=count)
    table.autofit = False
    props = table._tbl.tblPr
    borders = element('tblBorders')
    for side in ('top', 'left', 'bottom', 'right', 'insideH', 'insideV'):
        borders.append(element(side, val='single', sz=4, color='D9D9D9'))
    props.append(borders)
    margins = element('tblCellMar')
    for side in ('top', 'left', 'bottom', 'right'):
        margins.append(element(side, w=90, type='dxa'))
    props.append(margins)
    for col, width in zip(table.columns, widths):
        col.width = width
    for index, cells in enumerate(rows):
        row = table.add_row()
        if index == 0:
            row._tr.get_or_add_trPr().append(element('tblHeader'))
        for cell, value, width in zip(row.cells, cells, widths):
            cell.width = width
            cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
            if index == 0:
                cell._tc.get_or_add_tcPr().append(element('shd', fill='E8EFF6'))
            paragraph = cell.paragraphs[0]
            paragraph.paragraph_format.space_after = Pt(3)
            paragraph.paragraph_format.space_before = Pt(3)
            paragraph.paragraph_format.line_spacing = 1.15
            alignment = value['alignment']
            paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER if 'center' in alignment else (
                WD_ALIGN_PARAGRAPH.RIGHT if 'right' in alignment else WD_ALIGN_PARAGRAPH.LEFT)
            inline(paragraph, value['tokens'], max(Cm(1), width - Cm(.4)))
            for run in paragraph.runs:
                run.font.size = Pt(9)
                if index == 0:
                    run.bold = True
    document.add_paragraph().paragraph_format.space_after = Pt(2)


def render_docx(markdown: str, *, language='zh', identifier='', content_hash='') -> bytes:
    """Convert an immutable document to editable Word paragraphs, tables and pictures."""
    document = Document()
    configure(document, language)
    document.core_properties.identifier = identifier
    document.core_properties.subject = f'SHA-256: {content_hash}' if content_hash else ''
    parser = MarkdownIt('commonmark').enable(['table', 'strikethrough'])
    tokens = parser.parse(markdown)
    paragraph = None
    lists = []
    quote_depth = 0
    title_seen = False
    index = 0
    while index < len(tokens):
        token = tokens[index]
        if token.type == 'table_open':
            end = index + 1
            while tokens[end].type != 'table_close':
                end += 1
            add_table(document, tokens[index + 1:end])
            index = end
        elif token.type in {'bullet_list_open', 'ordered_list_open'}:
            lists.append({'ordered': token.type == 'ordered_list_open', 'next': int(token.attrGet('start') or 1), 'prefix': ''})
        elif token.type in {'bullet_list_close', 'ordered_list_close'}:
            lists.pop()
        elif token.type == 'list_item_open':
            current = lists[-1]
            current['prefix'] = f"{current['next']}. " if current['ordered'] else '• '
            current['next'] += 1
        elif token.type in {'blockquote_open', 'blockquote_close'}:
            quote_depth += token.nesting
        elif token.type in {'heading_open', 'paragraph_open'}:
            style = 'Normal'
            if token.type == 'heading_open':
                style = 'Title' if token.tag == 'h1' and not title_seen else f'Heading {max(1, int(token.tag[1:]) - 1)}'
                title_seen = True
            paragraph = document.add_paragraph(style=style)
            if quote_depth or lists:
                paragraph.paragraph_format.left_indent = Cm(.5 * (quote_depth + len(lists)))
            if lists and lists[-1]['prefix']:
                paragraph.paragraph_format.first_line_indent = Cm(-.4)
                paragraph.add_run(lists[-1]['prefix'])
                lists[-1]['prefix'] = ''
        elif token.type == 'inline' and paragraph is not None:
            inline(paragraph, token.children)
            if paragraph.style.name == 'Title':
                document.core_properties.title = paragraph.text[:255]
        elif token.type in {'fence', 'code_block'}:
            for line in token.content.rstrip('\n').split('\n'):
                paragraph = document.add_paragraph()
                paragraph.paragraph_format.space_after = Pt(0)
                paragraph.paragraph_format.line_spacing = 1.05
                run = paragraph.add_run(line)
                run.font.name = 'Consolas'
                run.font.size = Pt(9)
        elif token.type == 'hr':
            document.add_paragraph().paragraph_format.space_after = Pt(8)
        # HTML and renderer comments are not rendered/executed, as in the preview.
        index += 1

    # Preserve the exact Markdown, including hidden source locators and image bytes,
    # in an inert custom XML part; it is never a new canonical PRD or confirmation.
    record = ET.Element('export', {'xmlns': 'urn:syseval:document-export', 'renderer': RENDERER_VERSION,
                                 'identifier': identifier, 'content-hash': content_hash})
    ET.SubElement(record, 'markdown').text = markdown
    part = Part(PackURI('/customXml/syseval.xml'), 'application/xml', ET.tostring(record, encoding='utf-8', xml_declaration=True), document.part.package)
    document.part.relate_to(part, RT.CUSTOM_XML)
    output = BytesIO()
    document.save(output)
    # Stable ZIP timestamps make repeated exports of the same revision identical.
    stable = BytesIO()
    with ZipFile(output) as source, ZipFile(stable, 'w', ZIP_DEFLATED) as target:
        for entry in source.infolist():
            entry.date_time = (2000, 1, 1, 0, 0, 0)
            target.writestr(entry, source.read(entry.filename))
    return stable.getvalue()
