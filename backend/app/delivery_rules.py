"""Pure validation for immutable evidence manifests and human decisions."""
from datetime import date, datetime, timedelta, timezone

from .domain import DomainError


def text(body, key, maximum=8000):
    value = body.get(key)
    if not isinstance(value, str) or not value.strip() or len(value) > maximum:
        raise DomainError('INVALID_FIELDS', 422, {'field': key})
    return value.strip()


def metadata(body, today=None):
    result = {k: text(body, k, 200 if k != 'description' else 8000)
              for k in ('environment', 'system_version', 'collected_on', 'description')}
    try:
        if date.fromisoformat(result['collected_on']) > (today or datetime.now(timezone(timedelta(hours=8))).date()):
            raise ValueError()
    except ValueError as exc:
        raise DomainError('INVALID_FIELDS', 422, {'field': 'collected_on'}) from exc
    return result


def validate_review(body, criteria, attachment_ids):
    decision = body.get('decision')
    if decision not in ('PASS', 'FAIL', 'NEEDS_MORE_EVIDENCE'):
        raise DomainError('INVALID_FIELDS')
    reason = text(body, 'reason')
    results = body.get('criteria_results', [])
    if not isinstance(results, list) or any(not isinstance(r, dict) for r in results):
        raise DomainError('INVALID_FIELDS')
    if decision == 'PASS':
        if not criteria or len(results) != len(criteria) or {r.get('criterion_id') for r in results} != {c['id'] for c in criteria}:
            raise DomainError('DELIVERY_CRITERIA_REQUIRED')
        for result in results:
            ids = result.get('attachment_ids')
            if result.get('result') != 'PASS' or not isinstance(ids, list) or not ids or any(i not in attachment_ids for i in ids):
                raise DomainError('DELIVERY_CRITERIA_REQUIRED')
    return {'decision': decision, 'reason': reason, 'criteria_results': results, 'mode': 'manual'}
