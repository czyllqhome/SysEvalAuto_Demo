"""Authorized network-topology images and immutable PRD embedding."""
import base64
import hashlib
import re

from fastapi import Depends, Response
from sqlalchemy import select

from .db import MlpsEvidence, System
from .domain import DomainError

IMAGE_MIMES = ('image/png', 'image/jpeg', 'image/webp')


def snapshot(db, system_id):
    system = db.get(System, system_id)
    removed = system.draft.get('removed_mlps_evidence', []) if system else []
    rows = db.execute(select(MlpsEvidence.id, MlpsEvidence.filename, MlpsEvidence.mime, MlpsEvidence.sha256).where(
        MlpsEvidence.system_id == system_id, MlpsEvidence.question == 'network_zones_description',
        MlpsEvidence.mime.in_(IMAGE_MIMES)).order_by(MlpsEvidence.created_at, MlpsEvidence.id))
    return [dict(row._mapping) for row in rows if row.id not in removed]


def image(db, system_id, evidence_id):
    row = db.get(MlpsEvidence, evidence_id)
    if not row or row.system_id != system_id or row.question != 'network_zones_description' or row.mime not in IMAGE_MIMES:
        raise DomainError('NOT_FOUND', 404)
    if hashlib.sha256(row.content).hexdigest() != row.sha256:
        raise DomainError('INVALID_SOURCE_REFERENCE')
    return row


def embed(db, system_id, images):
    result = []
    for source in images:
        row = image(db, system_id, source['id'])
        if any(source[key] != getattr(row, key) for key in ('filename', 'mime', 'sha256')):
            raise DomainError('INVALID_SOURCE_REFERENCE')
        result.append({**source, 'data_url': f'data:{row.mime};base64,' + base64.b64encode(row.content).decode('ascii')})
    return result


def markdown(images, language):
    if not images:
        return ''
    title = '网络拓扑图' if language == 'zh' else 'Network topology diagram'
    lines = ['### ' + title, '']
    for source in images:
        uri = source.get('data_url', '')
        if not re.fullmatch(r'data:image/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+', uri):
            raise DomainError('INVALID_SOURCE_REFERENCE')
        filename = re.sub(r'([\\`*_{}\[\]()#+.!|<>])', r'\\\1', source['filename'])
        lines += [f'![{title}]({uri})', '', f"{filename} · SHA-256: {source['sha256']}", '']
    return '\n'.join(lines)


def register_routes(app, current, get_db):
    from . import service

    def authorized(db, user, system_id):
        if user.role == 'vendor':
            raise DomainError('FORBIDDEN', 403)
        return service.system_for(db, user, system_id)

    @app.get('/api/v1/systems/{system_id}/network-topology')
    def read(system_id: str, user=Depends(current), db=Depends(get_db)):
        authorized(db, user, system_id)
        return {'images': snapshot(db, system_id)}

    @app.get('/api/v1/systems/{system_id}/network-topology/{evidence_id}')
    def read_image(system_id: str, evidence_id: str, user=Depends(current), db=Depends(get_db)):
        authorized(db, user, system_id)
        row = image(db, system_id, evidence_id)
        return Response(row.content, media_type=row.mime,
                        headers={'Content-Disposition': 'inline', 'X-Content-SHA256': row.sha256})
