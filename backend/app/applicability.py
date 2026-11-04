"""Complete unresolved applicability facts against the assessment's pinned catalog."""
import copy

from . import control_library, screening, service
from .control_rules import classify_profile, evaluate_rule, normalize_facts, refs
from .db import Audit
from .domain import DomainError, digest


def unknown(value):
    return value is None or value == 'unknown' or value == ['unknown']


def configuration(db, system):
    _, release = control_library.published(db, system.org_id, system.classification.get('catalog_id'))
    return system.classification.get('methodology_config') or release.data['config']


def view(db, system):
    classification = system.classification
    supported = classification.get('scheme') in ('SYS-SCREEN/2', 'MLPS-TAGS/1', 'MLPS-INTAKE/1')
    pending = [s for s in service.selections(db, system)
               if s.origin == 'candidate' and not s.included and not s.reason]
    result = {'version': system.version, 'pending_count': len(pending), 'questions': [],
              'facts': classification.get('facts', {}), 'supported': supported}
    if not supported:
        return result
    cfg = configuration(db, system)
    questions = {q['code']: q for q in cfg['questions']}
    affected = {}

    def include(code, control, visited):
        if code in visited or code not in questions:
            return
        visited = visited | {code}
        q = questions[code]
        if unknown(result['facts'].get(code)):
            affected.setdefault(code, set()).add(control)
            for dependency in refs(q.get('when', True)):
                include(dependency, control, visited)

    for item in pending:
        for code in item.snapshot.get('match', {}).get('answer_refs', []):
            include(code, item.snapshot['code'], set())
    result.update(config=cfg, questions=[{**q, 'affected_controls': sorted(affected[q['code']])}
                                        for q in cfg['questions'] if q['code'] in affected])
    return result


def complete(db, user, system, answers):
    service.require_state(system, 'CONTROL_REVIEW')
    if not system.context_revision_id:
        raise DomainError('CONTEXT_OR_CONTROLS_REQUIRED', 409)
    current = view(db, system)
    if not current['supported']:
        raise DomainError('CLASSIFICATION_CHANGED', 409)
    allowed = {q['code']: q for q in current['questions']}
    if not isinstance(answers, dict) or not answers or set(answers) - set(allowed):
        raise DomainError('INVALID_FIELDS')
    if any(allowed[key].get('risk') for key in answers):
        raise DomainError('CLASSIFICATION_CHANGED', 409)
    cfg, before = current['config'], current['facts']
    facts = normalize_facts({**before, **answers}, cfg)
    if any(unknown(facts[key]) or evaluate_rule(allowed[key].get('when', True), facts) is not True for key in answers):
        raise DomainError('INVALID_FIELDS')
    classification = system.classification
    classify = screening.classify if classification['scheme'] == 'SYS-SCREEN/2' else classify_profile
    options = (cfg, classification.get('mode', 'questionnaire'), classification['effective_level'], classification.get('reason', ''))
    if classification['scheme'] == 'MLPS-INTAKE/1':
        prior = after = {}  # Applicability changes never re-evaluate the independent MLPS matrix.
    else:
        prior, after = classify(before, *options), classify(facts, *options)
    # Even a same-level change to grading evidence needs explicit reconfirmation.
    for key in ('recommended_level', 'effective_level', 'triggers', 'matched_rules', 'unknown', 'expert_review', 'exceptions'):
        if prior.get(key) != after.get(key):
            raise DomainError('CLASSIFICATION_CHANGED', 409)
    facts = after.get('facts', facts)
    if any(q.get('risk') and before.get(q['code']) != facts.get(q['code']) for q in cfg['questions']):
        raise DomainError('CLASSIFICATION_CHANGED', 409)
    for tag, code in (('personal_data', 'data.personal'), ('production_admin', 'ops.production_admin')):
        value = system.context.get('applicability_tags', {}).get(tag, 'unknown')
        if value != 'unknown' and facts.get(code) != value:
            raise DomainError('CLASSIFICATION_CHANGED', 409)

    service.invalidate(db, system, 'CONTROL_REVIEW')
    db.flush()
    system.classification = {**classification, 'facts': facts, 'input_hash': classification['input_hash'] if classification['scheme'] == 'MLPS-INTAKE/1' else digest(facts)}
    draft_key = 'screening' if classification['scheme'] == 'SYS-SCREEN/2' else 'tag_profile'
    if classification['scheme'] == 'MLPS-INTAKE/1':
        draft_key = 'mlps_intake'
    system.draft = {**system.draft, draft_key: {**system.draft.get(draft_key, {}), 'facts': facts}}
    changed_controls = []
    for item in service.selections(db, system):
        meta = item.snapshot.get('metadata')
        if not meta or item.origin == 'custom':
            continue
        if classification['scheme'] in ('SYS-SCREEN/2', 'MLPS-INTAKE/1'):
            decision = screening.match(meta, facts, classification['assessment_profiles'], classification['frameworks'], classification.get('framework_profiles'))
        else:
            decision = control_library.match(meta, facts, classification['assessment_profile'])
        if not any(before.get(code) != facts.get(code) for code in decision['answer_refs']):
            continue
        old = item.snapshot.get('match')
        if old == decision:
            continue
        snapshot = copy.deepcopy(item.snapshot)
        snapshot['match'] = decision
        if item.origin == 'manual' or item.reason:
            snapshot['previous_decision'] = {'included': item.included, 'reason': item.reason}
            item.origin, item.included, item.reason = 'candidate', False, ''
        elif 'previous_decision' not in snapshot:
            item.origin = 'candidate' if decision['status'] == 'unknown' else 'matched' if decision['status'] == 'applicable' else 'inapplicable'
            item.included = item.origin == 'matched'
        item.snapshot = snapshot
        changed_controls.append(item.snapshot['code'])
    db.add(Audit(system_id=system.id, actor_id=user.id, action='control.applicability_answers',
                 detail={'revision': system.revision, 'before': before, 'after': facts,
                         'answers': answers, 'changed_controls': changed_controls,
                         'catalog_id': classification['catalog_id']}))
    return {'applicability_update': {'changed_controls': len(changed_controls)}}
