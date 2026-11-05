"""Evidence-bound contextual assessment; network isolation is never an automatic waiver."""
import json

from .domain import DomainError

PROMPT = (
    ' For every partial/no supplier response, provide contextual_assessment. Evaluate actual exposure, '
    'attack prerequisites (including local access, removable media, insider and supply-chain paths), '
    'existing mitigations and residual severity using the pinned context, classification and questionnaire. '
    'Offline alone is not proof of safety. Preserve source High rating in controls; severity is the contextual '
    'residual risk, not a change to the original rating. Missing or unverified conditions go in uncertainties '
    'and severity unknown. facts must cite exact quotes with dot-separated paths starting context, '
    'classification or questionnaire. Do not cite supplier promises as proven mitigations. '
    'Explain why the specific control gap is or is not exploitable; never assert an actual vulnerability '
    'without evidence. Return null contextual_assessment for unrelated unassessed findings.'
)


def validate_contextual_risk(value, source):
    if not value['facts'] or any(not value[k].strip() for k in ('exposure', 'exploitation_conditions', 'mitigations')):
        raise DomainError('INVALID_SOURCE_REFERENCE')
    for evidence in value['facts']:
        parts = evidence['path'].split('.')
        if parts[0] not in ('context', 'classification', 'questionnaire'):
            raise DomainError('INVALID_SOURCE_REFERENCE')
        current = source
        try:
            for part in parts:
                current = current[int(part)] if isinstance(current, list) else current[part]
        except (KeyError, IndexError, TypeError, ValueError):
            raise DomainError('INVALID_SOURCE_REFERENCE') from None
        text = current if isinstance(current, str) else json.dumps(current, ensure_ascii=False)
        if not evidence['quote'].strip() or evidence['quote'] not in text:
            raise DomainError('INVALID_SOURCE_REFERENCE')
