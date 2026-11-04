"""Organization settings; secrets remain exclusively in server configuration."""
import os
from contextvars import ContextVar

from fastapi import Depends
from . import access
from .db import AISettings
from .domain import DomainError
from .narrative import TOPIC_GUIDANCE

active_config = ContextVar('ai_config', default=None)


def defaults():
    from .ai import default_instruction
    kinds = ['context_organization', 'prd_generation', 'impact_analysis', 'prd_import_extraction']
    prompts = {k: default_instruction(k, 'en').replace('in English,', 'in {language},') for k in kinds}
    prompts.update({f'narrative_refinement:{t}': default_instruction('narrative_refinement', 'en', t) for t in TOPIC_GUIDANCE})
    return {'model': os.getenv('OPENROUTER_MODEL', ''), 'providers': os.getenv('OPENROUTER_PROVIDERS', ''),
            'zdr': os.getenv('OPENROUTER_ZDR', 'false').lower() == 'true',
            'max_tokens': int(os.getenv('SYSEVAL_MAX_OUTPUT_TOKENS', '12000')),
            'reasoning_tokens': os.getenv('OPENROUTER_REASONING_TOKENS', ''), 'prompts': prompts}


def snapshot(db, org_id):
    row = db.get(AISettings, org_id)
    base = defaults()
    saved = row.data if row else {}
    return {**base, **({k: v for k, v in row.data.items() if k not in ('prd_template', 'prd_template_version', 'prd_template_generation')} if row else {}), 'version': row.version if row else 0, 'prompts': {**base['prompts'], **saved.get('prompts', {})}}


def configured(db, org_id):
    return bool(os.getenv('OPENROUTER_API_KEY') and snapshot(db, org_id)['model'])


def register_routes(app, current, get_db):
    from . import prd_templates
    prd_templates.register_routes(app, current, get_db)
    @app.get('/api/v1/admin/ai-settings')
    def read(user=Depends(current), db=Depends(get_db)):
        access.require_admin(db, user)
        return {**snapshot(db, user.org_id), 'key_configured': bool(os.getenv('OPENROUTER_API_KEY')), 'defaults': defaults()}

    @app.put('/api/v1/admin/ai-settings')
    def save(body: dict, user=Depends(current), db=Depends(get_db)):
        access.require_admin(db, user)
        expected = defaults()
        if set(body) != set(expected) | {'version'}:
            raise DomainError('INVALID_FIELDS', 422)
        for key, limit in [('model', 200), ('providers', 1000)]:
            if not isinstance(body[key], str) or len(body[key]) > limit or any(ord(c) < 32 for c in body[key]):
                raise DomainError('INVALID_FIELDS', 422)
        if type(body['zdr']) is not bool or type(body['max_tokens']) is not int or not 256 <= body['max_tokens'] <= 100000:
            raise DomainError('INVALID_FIELDS', 422)
        reasoning = body['reasoning_tokens']
        if not isinstance(reasoning, str) or (reasoning and (not reasoning.isdigit() or not 0 < int(reasoning) < body['max_tokens'])):
            raise DomainError('INVALID_FIELDS', 422)
        prompts = body['prompts']
        if not isinstance(prompts, dict) or set(prompts) != set(expected['prompts']) or any(not isinstance(v, str) or not v.strip() or len(v) > 20000 for v in prompts.values()):
            raise DomainError('INVALID_FIELDS', 422)
        row = db.get(AISettings, user.org_id)
        if type(body['version']) is not int or body['version'] != (row.version if row else 0):
            raise DomainError('VERSION_CONFLICT', 409)
        if row is None:
            row = AISettings(org_id=user.org_id)
            db.add(row)
        row.data = {**(row.data or {}), **{k: body[k] for k in expected}}
        db.flush()
        access.audit(db, user, 'ai.settings.updated', {'version': row.version, 'settings': row.data})
        db.commit()
        return read(user, db)
