"""Bounded in-memory validation. Originals remain in the configured database."""
import io
import zipfile
from pathlib import PurePath

from defusedxml import ElementTree
from PIL import Image
from pypdf import PdfReader

from .domain import DomainError

MAX_FILE = 20 * 1024 * 1024
MAX_TOTAL = 100 * 1024 * 1024
MAX_ASSESSMENT = 1024 * 1024 * 1024
MIMES = {'png': 'image/png', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'webp': 'image/webp',
         'pdf': 'application/pdf', 'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
         'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
         'txt': 'text/plain', 'csv': 'text/csv', 'md': 'text/markdown'}
MIMES.update({ext: 'text/plain' for ext in ('py', 'js', 'ts', 'tsx', 'jsx', 'java', 'cs', 'go', 'rs', 'sql', 'json', 'yaml', 'yml', 'sh', 'ps1', 'c', 'cpp', 'h', 'diff', 'log')})


def validate_file(filename, content):
    if not isinstance(filename, str) or not filename or len(filename) > 255 or any(ord(c) < 32 for c in filename):
        raise DomainError('INVALID_FIELDS')
    filename = filename.replace('\\', '/').split('/')[-1]
    ext = PurePath(filename).suffix.lower().lstrip('.')
    if not content or len(content) > MAX_FILE:
        raise DomainError('UPLOAD_LIMIT_EXCEEDED', 413)
    if ext not in MIMES:
        raise DomainError('UNSUPPORTED_EVIDENCE_TYPE', 415)
    try:
        if ext in ('png', 'jpg', 'jpeg', 'webp'):
            with Image.open(io.BytesIO(content)) as picture:
                if picture.width * picture.height > 25_000_000 or picture.format != {'png': 'PNG', 'jpg': 'JPEG', 'jpeg': 'JPEG', 'webp': 'WEBP'}[ext]:
                    raise ValueError()
                picture.verify()
        elif ext == 'pdf':
            if not content.startswith(b'%PDF-'):
                raise ValueError()
            pdf = PdfReader(io.BytesIO(content), strict=True)
            if pdf.is_encrypted or len(pdf.pages) > 1000:
                raise ValueError()
        elif ext in ('docx', 'xlsx'):
            with zipfile.ZipFile(io.BytesIO(content)) as archive:
                members = archive.infolist()
                if len(members) > 2000 or sum(m.file_size for m in members) > MAX_TOTAL:
                    raise ValueError()
                names = archive.namelist()
                if len(names) != len(set(names)) or '[Content_Types].xml' not in names or ('word/document.xml' if ext == 'docx' else 'xl/workbook.xml') not in names:
                    raise ValueError()
                for member in members:
                    if member.flag_bits & 1 or '..' in member.filename.split('/') or 'vba' in member.filename.lower():
                        raise ValueError()
                    if member.filename.endswith(('.xml', '.rels')):
                        root = ElementTree.fromstring(archive.read(member))
                        if any(e.attrib.get('TargetMode') == 'External' or 'macroEnabled' in e.attrib.get('ContentType', '') for e in root.iter()):
                            raise ValueError()
        else:
            value = content.decode('utf-8-sig')
            if '\x00' in value or any(ord(c) < 32 and c not in '\n\r\t' for c in value):
                raise ValueError()
    except Exception as exc:
        raise DomainError('UNSUPPORTED_EVIDENCE_TYPE', 415) from exc
    return filename, MIMES[ext]


def preview(content):
    with Image.open(io.BytesIO(content)) as picture:
        picture.thumbnail((1600, 1600))
        output = io.BytesIO()
        picture.convert('RGB').save(output, format='PNG')
        return output.getvalue()
