"""Render the jointly confirmed immutable baseline, not the latest editable PRD."""
from datetime import datetime, timezone
import json

from sqlalchemy import select

from .baseline_rules import validate_confirmations
from .db import Confirmation, Prd
from .domain import DomainError, digest


def render(db, baseline):
    confirmations = list(db.scalars(select(Confirmation).where(Confirmation.baseline_id == baseline.id)))
    validate_confirmations(confirmations, baseline.content_hash, ('customer', 'supplier'))
    p = baseline.payload
    if digest(p) != baseline.content_hash:
        raise DomainError('BASELINE_CHANGED', 409)
    prd = db.get(Prd, p['prd_id'])
    if not prd or prd.content_hash != p['prd_hash']:
        raise DomainError('BASELINE_CHANGED', 409)
    zh = prd.language == 'zh'
    def label(cn, en):
        return cn if zh else en
    lines = [f"# {label('双方确认最终稿', 'Jointly confirmed final document')}",
             f"{label('基线编号', 'Baseline')}: {baseline.id}",
             f"SHA-256: {baseline.content_hash}",
             f"PRD SHA-256: {p['prd_hash']}",
             f"{label('修订', 'Revision')}: {p['revision']}"]
    for c in sorted(confirmations, key=lambda c: c.party):
        lines.append(f"- {c.party}: {c.actor_id} · {datetime.fromtimestamp(c.created_at, timezone.utc).isoformat()} · {c.content_hash}")
    lines += ['\n---\n', prd.markdown, '\n---\n', f"# {label('供应商承诺与审查决定', 'Supplier commitments and review decisions')}"]
    names = [('implementation_status', '可实现性', 'Feasibility'), ('owner_name', '负责人', 'Owner'),
             ('duration_workdays', '工期（工作日）', 'Duration (workdays)'), ('implementation_plan', '实施方案', 'Implementation plan'),
             ('limitations', '限制和缺口', 'Limitations'), ('alternative', '替代措施', 'Alternatives'),
             ('estimated_start_date', '计划开始', 'Planned start'), ('estimated_finish_date', '计划完成', 'Planned finish')]
    for r in p['prd']['requirements']:
        lines.append(f"\n## {r['id']} · {r['title']}")
        answer = p['answers'][r['id']]
        lines.extend(f"- {label(cn, en)}: {answer.get(k) or '—'}" for k, cn, en in names)
        for f in p['report']['findings']:
            if f['requirement_id'] != r['id']:
                continue
            lines += [f"\n### {f['id']} · {f['severity']}", f['impact'], f['recommendation']]
            if f.get('contextual_assessment'):
                lines += ['```json', json.dumps(f['contextual_assessment'], ensure_ascii=False, indent=2), '```']
            decision = p['decisions'].get(f['id'], {})
            lines.append(f"{label('客户决定', 'Customer decision')}: {decision.get('decision', '')} · {decision.get('reason', '')}")
    lines += [f"\n# {label('例外及排除审查', 'Exception and exclusion review')}", p['decisions'].get('_exceptions', {}).get('reason', ''),
              f"\n# {label('确认基线完整记录', 'Full confirmed baseline record')}", '```json',
              json.dumps(p, ensure_ascii=False, sort_keys=True, indent=2), '```']
    return '\n\n'.join(lines)
