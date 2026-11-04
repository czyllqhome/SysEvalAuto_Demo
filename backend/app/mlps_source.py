"""Strict, Chinese-only MLPS workbook ingestion. Workbook cells are evidence, never instructions."""
import hashlib
import re
from pathlib import Path
from functools import lru_cache
from zipfile import ZipFile
from defusedxml import ElementTree as ET

from .control_rules import default_config
from .domain import digest

ROOT = Path(__file__).with_name('data') / 'mlps'
NS = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
FIELDS = ['source', 'control_identifier', 'security_domain', 'security_control_point',
          'control_requirement', 'assessment_procedure', 'risk_level']
FRAMEWORKS = ['MLPS_LEVEL_1', 'MLPS_LEVEL_2', 'MLPS_LEVEL_3']


def read_book(path):
    """Read physical XML rows, ignoring Excel's inflated formatted used range."""
    checksum = hashlib.sha256(path.read_bytes()).hexdigest()
    with ZipFile(path) as book:
        sheet_name = ET.fromstring(book.read('xl/workbook.xml')).find('s:sheets/s:sheet', NS).attrib['name']
        strings = []
        if 'xl/sharedStrings.xml' in book.namelist():
            strings = [''.join(x.itertext()) for x in ET.fromstring(book.read('xl/sharedStrings.xml')).findall('s:si', NS)]
        rows = []
        with book.open('xl/worksheets/sheet1.xml') as stream:
            container = None
            for event, row in ET.iterparse(stream, events=('start', 'end')):
                if event == 'start' and row.tag == '{' + NS['s'] + '}sheetData':
                    container = row
                if event != 'end' or row.tag != '{' + NS['s'] + '}row':
                    continue
                values = [''] * 7
                for cell in row.findall('s:c', NS):
                    value = cell.find('s:v', NS)
                    inline = cell.find('s:is', NS)
                    if value is None and inline is None:
                        continue
                    column = re.match(r'[A-Z]+', cell.attrib['r'])[0]
                    value = value.text if value is not None else ''
                    if cell.attrib.get('t') == 's':
                        value = strings[int(value)]
                    elif inline is not None:
                        value = ''.join(inline.itertext())
                    if column in 'ABCDEFG' and len(column) == 1:
                        values[ord(column) - 65] = value or ''
                if any(v.strip() for v in values):
                    rows.append((int(row.attrib['r']), values))
                row.clear()
                if container is not None:
                    container.clear()
    header = [re.sub(r'[ _]+', '_', v.strip().lower()) for v in rows[0][1]]
    if header != FIELDS:
        raise ValueError(f'{path.name}: unsupported columns {header}')
    result = {}
    for number, values in rows[1:]:
        fields = dict(zip(FIELDS, values))
        code = fields['control_identifier'].strip()
        if not code or code in result or any(not fields[k].strip() for k in FIELDS[1:6]):
            raise ValueError(f'{path.name}:{number}: missing field or duplicate identifier {code}')
        result[code] = {'filename': path.name, 'sheet': sheet_name, 'row': number, 'fields': fields,
                        'sha256': checksum}
    return result


@lru_cache(maxsize=1)
def dataset():
    config = default_config()
    config['domains'] = []
    controls = []
    for level in (2, 3):
        chinese_controls = read_book(ROOT / f'MLPS_level_{level}_CN.xlsx')
        for identifier, chinese in chinese_controls.items():
            sources = {'zh': chinese}
            domain = 'MLPS-' + identifier.split('.')[2]
            labels = {lang: source['fields']['security_domain'] for lang, source in sources.items()}
            if not any(d['code'] == domain for d in config['domains']):
                config['domains'].append({'code': domain, **labels})
            code = f'MLPS{level}-' + re.sub(r'[^A-Za-z0-9_.-]', '', identifier)
            translations = {lang: {'title': source['fields']['security_control_point'],
                'description': source['fields']['control_requirement'],
                'verification': source['fields']['assessment_procedure']} for lang, source in sources.items()}
            controls.append({'control_id': digest([level, identifier])[:36], 'revision': 1,
                'control_code': code, 'translations': translations,
                'assessment_object': labels['zh'], 'domain_code': domain,
                'assessment_profiles': [f'MLPS{level}_REFERENCE'], 'required': True, 'topic_tags': [],
                'applicability_mode': 'always', 'rule': True, 'responsibility_rule': 'shared',
                'source_framework': f'MLPS_LEVEL_{level}', 'source_version': 'uploaded-2026-11',
                'source_ref': identifier, 'source_level': level, 'control_family_id': code,
                'change_reason': 'User supplied Chinese MLPS source', 'review_status': 'reviewed',
                'retired': False, 'source': {'languages': sources}, 'tagging_basis': ''})
    return {'config': config, 'controls': controls}


def ensure_catalog(db, org_id):
    from .db import SixFieldLibrary
    if db.get(SixFieldLibrary, org_id):
        return None
    from sqlalchemy import select
    from .db import Catalog, Control, ControlMetadata, LibraryRelease, LibraryWorkspace
    row = db.get(LibraryWorkspace, org_id)
    if row and row.published_id:
        active = db.get(Catalog, row.published_id)
        release = db.get(LibraryRelease, row.published_id)
        if active and active.org_id == org_id and active.code == 'MLPS-CN' and release:
            recorded = {s['filename']: s['sha256'] for c in release.data['controls']
                        for s in c.get('source', {}).get('languages', {}).values()}
            actual = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in ROOT.glob('MLPS_level_*_CN.xlsx')}
            if len(actual) == 2 and recorded == actual:
                return active
    data = dataset()
    content_hash = digest(data)
    catalog = db.scalar(select(Catalog).where(Catalog.org_id == org_id, Catalog.code == 'MLPS-CN', Catalog.content_hash == content_hash))
    if catalog is None:
        catalog = Catalog(org_id=org_id, code='MLPS-CN', version='2026.11-' + content_hash[:12], content_hash=content_hash)
        db.add(catalog)
        db.flush()
        db.add(LibraryRelease(catalog_id=catalog.id, data={**data, 'publication_mode': 'source'}))
        for item in data['controls']:
            control = Control(org_id=org_id, catalog_id=catalog.id, code=item['control_code'],
                domain=item['domain_code'], levels=[f"L{item['source_level']}"], required=True,
                translations=item['translations'], tags=[])
            db.add(control)
            db.flush()
            db.add(ControlMetadata(control_id=control.id, data=item))
    if row is None:
        row = LibraryWorkspace(org_id=org_id, data=data, published_id=catalog.id)
        db.add(row)
    elif row.published_id != catalog.id:
        archive_hash = digest(row.data)
        archive = db.scalar(select(Catalog).where(Catalog.org_id == org_id, Catalog.code == 'ARCHIVED-DRAFT', Catalog.content_hash == archive_hash))
        if archive is None:
            archive = Catalog(org_id=org_id, code='ARCHIVED-DRAFT', version=archive_hash[:16], content_hash=archive_hash)
            db.add(archive)
            db.flush()
            db.add(LibraryRelease(catalog_id=archive.id, data={**row.data, 'publication_mode': 'archived_draft'}))
        row.data, row.published_id = data, catalog.id
        row.version += 1
    db.flush()
    return catalog
