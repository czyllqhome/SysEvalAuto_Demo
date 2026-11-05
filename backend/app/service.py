"""Workflow commands, object authorization, and immutable publication boundaries."""

from __future__ import annotations

import copy
import os
import time

from sqlalchemy import or_, select

from . import access
from .baseline_rules import validate_confirmations, validate_current_baseline
from .workflow_policy import revision_states
from .ai import redact_source, render_prd
from .narrative import MLPS_TOPIC_FIELDS, NarrativeSuggestion, TOPIC_GUIDANCE
from .catalog import control_snapshot
from .db import (
    Audit, Baseline, Catalog, Confirmation, ContextRevision, Control, Job, Prd,
    Report, Selection, Submission, SupplierRound, System,
)
from .domain import (
    Context, DomainError, classify, context_grade_facts, digest, validate_context,
    validate_prd, validate_report,
)


def system_for(db, user, system_id: str, *, write=False):
    statement = select(System).where(System.id == system_id)
    if write:
        statement = statement.with_for_update()
    system = db.scalar(statement)
    if system is None or system.draft.get('deleted_at'):
        raise DomainError("NOT_FOUND", 404)
    if user.role != 'vendor':
        caps = access.capabilities(db, user, system)
        if 'read' in caps and (not write or caps & {'edit', 'review', 'manage'}):
            return system
    if not write and user.role == "vendor" and access.supplier_project_access(db, user, system) and db.scalar(select(SupplierRound.id).where(
        SupplierRound.system_id == system.id, SupplierRound.supplier_org_id == user.org_id
    )):
        return system
    raise DomainError("NOT_FOUND", 404)


def require_state(system, *allowed):
    if system.status not in allowed:
        raise DomainError("STATE_CONFLICT", 409, {"status": system.status})


def impact_control_originals(db, system, prd):
    if not prd:
        return {}
    controls = {x.snapshot['id']: x.snapshot for x in selections(db, system)}
    result = {}
    for requirement in prd.data['requirements']:
        entries = []
        for cid in requirement['source_control_ids']:
            control = controls.get(cid)
            if not control:
                continue
            fields = control.get('metadata', {}).get('source', {}).get('fields', {})
            translations = control.get('translations', {})
            text = translations.get(prd.language) or next(iter(translations.values()), {})
            entries.append({'id': cid, 'code': control.get('code', ''),
                            'text': fields.get('control_requirement') or text.get('description', '')})
        result[requirement['id']] = entries
    return result


def mlps3_major_risk(db, system, prd, report):
    if not prd or not report:
        return False
    controls = {x.snapshot['id'] for x in selections(db, system)
                if x.snapshot.get('code', '').startswith('MLPS3-')}
    requirements = {r['id'] for r in prd.data['requirements'] if controls.intersection(r['source_control_ids'])}
    return any(f['requirement_id'] in requirements and f['severity'] in ('high', 'critical')
               for f in report.data['findings'])


def selections(db, system, *, included_only=False):
    statement = select(Selection).where(Selection.system_id == system.id, Selection.revision == system.revision)
    if included_only:
        statement = statement.where(Selection.included.is_(True))
    return list(db.scalars(statement.order_by(Selection.id)))


def requirement_domains(prd, controls):
    """Display-only domain labels from the published round's control snapshots."""
    by_id = {c['id']: c for c in controls}
    result = {}
    for requirement in prd.data['requirements']:
        labels = []
        for control_id in requirement['source_control_ids']:
            control = by_id.get(control_id)
            if not control:
                continue
            source = control.get('metadata', {}).get('source', {})
            label = (source.get('languages', {}).get('zh', {}).get('fields', {}).get('security_domain')
                     or source.get('fields', {}).get('security_domain') or control.get('domain'))
            if label and label not in labels:
                labels.append(label)
        result[requirement['id']] = labels
    return result


def selection_view(selection):
    return {**selection.snapshot, "selection_id": selection.id, "included": selection.included,
            "reason": selection.reason, "origin": selection.origin}


def current_catalog(db, org_id):
    from .db import SixFieldLibrary
    if db.get(SixFieldLibrary, org_id):
        from .db import LibraryWorkspace
        active = db.get(LibraryWorkspace, org_id)
        if not active or not active.published_id:
            raise DomainError('CATALOG_NOT_AVAILABLE', 409)
    from .db import LibraryWorkspace
    workspace = db.get(LibraryWorkspace, org_id)
    catalog = db.get(Catalog, workspace.published_id) if workspace and workspace.published_id else None
    if catalog is None:
        catalog = db.scalar(select(Catalog).where(Catalog.org_id == org_id, Catalog.code != 'ARCHIVED-DRAFT').order_by(Catalog.created_at.desc()))
    if not catalog:
        raise DomainError("CATALOG_NOT_AVAILABLE", 409)
    return catalog


def invalidate(db, system, next_status):
    old_selections = selections(db, system)
    if system.round_id:
        old_round = db.get(SupplierRound, system.round_id)
        if old_round and old_round.status == "open":
            old_round.status = "superseded"
    system.revision += 1
    for old in old_selections:
        db.add(Selection(system_id=system.id, revision=system.revision, control_id=old.control_id,
                         included=old.included, reason=old.reason, origin=old.origin, snapshot=old.snapshot))
    system.prd_id = system.round_id = system.report_id = system.baseline_id = None
    system.status = next_status


def confirm_classification(db, system, payload):
    if payload.get('scheme') == 'MLPS-INTAKE/1':
        from .mlps_intake import confirm
        return confirm(db, system, payload)
    if payload.get('scheme') == 'SYS-SCREEN/2':
        from . import screening
        require_state(system, 'DRAFT', 'CLASSIFYING', 'CONTEXT_REVIEW', 'CONTROL_REVIEW', 'PRD_REVIEW', 'RESULT_REVIEW', 'NEGOTIATING', 'FINAL_CONFIRMATION', 'PENDING_DEVELOPMENT', *revision_states(db, system))
        result = screening.preview(db, system.org_id, payload)
        result.pop('matches')
        if system.classification or system.context_revision_id:
            invalidate(db, system, 'CONTEXT_REVIEW')
            system.context_revision_id = None
        system.classification = result
        saved = {k: result[k] for k in ('catalog_id', 'facts', 'frameworks', 'mlps_target', 'mode', 'reason')}
        saved['level'] = result['effective_level']
        system.draft = {**system.draft, 'screening': saved, 'proposal_stale': bool(system.draft.get('proposal'))}
        system.status = 'CONTEXT_REVIEW'
        return
    if payload.get('scheme') == 'MLPS-TAGS/1':
        from .control_library import published, profile_choice
        from .control_rules import classify_profile, normalize_facts
        require_state(system, "DRAFT", "CLASSIFYING", "CONTEXT_REVIEW", "CONTROL_REVIEW", "PRD_REVIEW",
                      "RESULT_REVIEW", "NEGOTIATING", "FINAL_CONFIRMATION", "PENDING_DEVELOPMENT", *revision_states(db, system))
        catalog, release = published(db, system.org_id, payload.get('catalog_id'))
        facts = normalize_facts(payload.get('facts', {}), release.data['config'])
        result = classify_profile(facts, release.data['config'], payload.get('mode', 'questionnaire'), payload.get('level'), payload.get('reason', ''))
        profile = profile_choice(release.data['config'], result, payload.get('assessment_profile'), payload.get('mlps_target'))
        if not any(not c['retired'] and profile in c['assessment_profiles'] for c in release.data['controls']):
            raise DomainError('PROFILE_NOT_CONFIGURED', 409)
        if system.classification or system.context_revision_id:
            invalidate(db, system, 'CONTEXT_REVIEW')
            system.context_revision_id = None
        system.classification = {**result, 'catalog_id': catalog.id, 'assessment_profile': profile,
                                 'config_hash': digest(release.data['config']), 'mlps_target': payload.get('mlps_target')}
        system.draft = {**system.draft, 'tag_profile': {'catalog_id': catalog.id, 'facts': facts,
                        'assessment_profile': profile, 'config_hash': digest(release.data['config'])}}
        system.status = 'CONTEXT_REVIEW'
        return
    from . import methodology
    if not methodology.LEGACY_FIXTURES_ENABLED and (payload.get('mode') != 'manual' or payload.get('answers')):
        raise DomainError('METHODOLOGY_NOT_CONFIGURED', 409)
    require_state(system, "DRAFT", "CLASSIFYING", "CONTEXT_REVIEW", "CONTROL_REVIEW", "PRD_REVIEW",
                  "RESULT_REVIEW", "NEGOTIATING", "FINAL_CONFIRMATION", "PENDING_DEVELOPMENT", *revision_states(db, system))
    from .db import Questionnaire
    from .intake.service import facts
    questionnaire = db.get(Questionnaire, system.id)
    answers = payload.get("answers", {})
    if questionnaire:
        if questionnaire.workflow_status != 'submitted' and payload.get('mode') != 'manual':
            raise DomainError('QUESTIONNAIRE_SUBMIT_REQUIRED', 409)
        answers = dict(answers)
        for key, value in facts(questionnaire.snapshot.get('answers', {})).items():
            if answers.get(key, 'unknown') not in {'L1', 'L2', 'L3'} or value > answers[key]:
                answers[key] = value
    result = classify(answers, payload.get("mode", "questionnaire"),
                      payload.get("level"), payload.get("reason", ""))
    if questionnaire:
        result['questionnaire_hash'] = digest(questionnaire.snapshot)
    if system.prd_id or system.baseline_id or system.status == "CONTROL_REVIEW" or system.status in revision_states(db, system):
        invalidate(db, system, "CONTEXT_REVIEW")
    system.classification = result
    system.status = "CONTEXT_REVIEW"


def confirm_context(db, system, payload):
    require_state(system, "CONTEXT_REVIEW", "CONTROL_REVIEW", "PRD_REVIEW", "NEGOTIATING", "PENDING_DEVELOPMENT", *revision_states(db, system))
    if system.draft.get("proposal_stale"):
        raise DomainError("CONTEXT_STALE", 409)
    data = validate_context(payload.get("context", {}))
    previous = system.classification.get("answers", {})
    facts = context_grade_facts(data, previous)
    if not system.classification:
        raise DomainError("CLASSIFICATION_REQUIRED", 409)
    modern = system.classification.get('scheme') in ('MLPS-TAGS/1', 'SYS-SCREEN/2', 'MLPS-INTAKE/1')
    if system.classification.get('scheme') in ('SYS-SCREEN/2', 'MLPS-INTAKE/1') and not system.classification.get('controls_ready'):
        raise DomainError('PROFILE_NOT_CONFIGURED', 409)
    if not modern and any(previous.get(key, "unknown") != value for key, value in facts.items()):
        raise DomainError("CLASSIFICATION_CHANGED", 409, {"facts": facts})
    if modern:
        confirmed = system.classification['facts']
        # Explicit contradictory brief facts require returning to classification.
        for old, new in (('personal_data', 'data.personal'), ('production_admin', 'ops.production_admin')):
            value = data['applicability_tags'].get(old, 'unknown')
            if value != 'unknown' and confirmed.get(new, 'unknown') != value:
                raise DomainError('CLASSIFICATION_CHANGED', 409, {'fact': new})
    if system.context_revision_id and (system.context != data or system.status in revision_states(db, system)):
        invalidate(db, system, "CONTEXT_REVIEW")
    revision = ContextRevision(system_id=system.id, source=copy.deepcopy(system.draft), data=data)
    db.add(revision)
    db.flush()
    system.context, system.context_revision_id = data, revision.id
    catalog_id = system.classification.get("catalog_id") or current_catalog(db, system.org_id).id
    system.classification = {**system.classification, "catalog_id": catalog_id}
    if modern:
        match_profile_controls(db, system)
        system.status = 'CONTROL_REVIEW'
        return
    existing = {item.control_id for item in selections(db, system)}
    for control in db.scalars(select(Control).where(Control.org_id == system.org_id,
                                                   Control.catalog_id == catalog_id,
                                                   or_(Control.project_id.is_(None), Control.project_id == system.id))):
        decisions = [data["applicability_tags"].get(tag, "unknown") for tag in control.tags]
        if system.classification["effective_level"] in control.levels and control.id not in existing and "no" not in decisions:
            pending = "unknown" in decisions
            db.add(Selection(system_id=system.id, revision=system.revision, control_id=control.id,
                             included=not pending, origin="candidate" if pending else "matched",
                             reason="", snapshot=control_snapshot(control)))
    system.status = "CONTROL_REVIEW"


def match_profile_controls(db, system):
    from sqlalchemy import delete
    from .control_library import match, published
    catalog, _release = published(db, system.org_id, system.classification['catalog_id'])
    old_rows = selections(db, system)
    previous = {s.snapshot.get('metadata', {}).get('control_id', s.control_id): s for s in old_rows}
    # Only rebuild selections for this revision; historical revisions remain immutable.
    db.execute(delete(Selection).where(Selection.system_id == system.id, Selection.revision == system.revision))
    for control in db.scalars(select(Control).where(Control.catalog_id == catalog.id, Control.org_id == system.org_id,
                                                   or_(Control.project_id.is_(None), Control.project_id == system.id))):
        snapshot = control_snapshot(control)
        meta = snapshot.get('metadata')
        if not meta:
            continue
        if system.classification.get('scheme') in ('SYS-SCREEN/2', 'MLPS-INTAKE/1'):
            from .screening import match as screening_match
            decision = screening_match(meta, system.classification['facts'], system.classification['assessment_profiles'], system.classification['frameworks'], system.classification.get('framework_profiles'))
        else:
            decision = match(meta, system.classification['facts'], system.classification['assessment_profile'])
        snapshot['match'] = decision
        old = previous.pop(meta['control_id'], None)
        manual = old and (old.origin in ('manual', 'custom') or bool(old.reason))
        if manual:
            snapshot['previous_decision'] = {'included': old.included, 'reason': old.reason,
                                             'control_id': old.control_id, 'revision': old.snapshot.get('metadata', {}).get('revision')}
        origin = 'candidate' if manual or decision['status'] == 'unknown' else 'matched' if decision['status'] == 'applicable' else 'inapplicable'
        db.add(Selection(system_id=system.id, revision=system.revision, control_id=control.id,
                         included=origin == 'matched', reason='', origin=origin, snapshot=snapshot))
    for old in previous.values():
        if old.origin in ('manual', 'custom') or old.reason:
            snapshot = copy.deepcopy(old.snapshot)
            snapshot['previous_decision'] = {'included': old.included, 'reason': old.reason}
            db.add(Selection(system_id=system.id, revision=system.revision, control_id=old.control_id,
                             included=False, reason='', origin='candidate', snapshot=snapshot))


def job_input(db, system, kind):
    if kind.startswith('delivery_evidence:'):
        from .delivery_ai import job_source
        return job_source(db, system, kind.split(':', 1)[1])
    if isinstance(kind, str) and kind.startswith('function_expansion:'):
        require_state(system, 'DRAFT', 'CLASSIFYING', 'CONTEXT_REVIEW', 'CONTROL_REVIEW', 'PRD_REVIEW')
        context = system.draft.get('proposal') or system.context
        function = next((f for f in context.get('functions', []) if isinstance(f, dict) and isinstance(f.get('id'), str) and digest(f['id'])[:16] == kind.split(':', 1)[1]), None)
        from .domain import ContextItem
        try:
            function = ContextItem.model_validate(function).model_dump()
        except ValueError as exc:
            raise DomainError('INVALID_FIELDS') from exc
        if not function['title'].strip():
            raise DomainError('INVALID_FIELDS')
        return {'topic': 'function_expansion', 'function_id': function['id'],
                'text': function['title'] + '\n\n' + function.get('description', ''), 'revision': system.revision}
    if kind == 'prd_import_extraction':
        from .prd_imports import source
        return source(db, system)
    if isinstance(kind, str) and kind.startswith('narrative_refinement:'):
        topic = kind.split(':', 1)[1]
        if topic not in TOPIC_GUIDANCE:
            raise DomainError('INVALID_FIELDS')
        require_state(system, 'DRAFT', 'CLASSIFYING', 'CONTEXT_REVIEW')
        text = (system.draft.get('mlps_intake', {}).get('answers', {}).get(MLPS_TOPIC_FIELDS[topic], '')
                if topic in MLPS_TOPIC_FIELDS else system.draft.get('blocks', {}).get(topic, ''))
        if not isinstance(text, str) or not text.strip() or len(text) > 10000:
            raise DomainError('INVALID_FIELDS')
        return {'topic': topic, 'text': text, 'revision': system.revision}
    from .db import Questionnaire
    questionnaire = db.get(Questionnaire, system.id)
    evidence = questionnaire.snapshot if questionnaire else {}
    if kind == "context_organization":
        return {"name": system.name, "draft": {"blocks": system.draft.get("blocks", {})},
                "classification": system.classification, "questionnaire": evidence}
    if kind == "prd_generation":
        from .topology import snapshot as topology_snapshot
        from .db import AssessmentProfile
        profile = db.get(AssessmentProfile, system.id)
        trace = profile.data.get('remediation_source') if profile else None
        return {"name": system.name, "revision": system.revision, "context": system.context,
                "context_revision_id": system.context_revision_id, "classification": system.classification,
                "controls": [item.snapshot for item in selections(db, system, included_only=True)], "questionnaire": evidence,
                "network_topology": topology_snapshot(db, system.id),
                **({'remediation_source': trace} if trace else {})}
    if kind == "impact_analysis":
        from .negotiation import scope
        round_ = db.get(SupplierRound, system.round_id) if system.round_id else None
        if not round_ or not round_.submitted_id:
            raise DomainError("STATE_CONFLICT", 409)
        prd = db.get(Prd, round_.prd_id)
        active = scope(round_, prd)
        return {"round_id": round_.id, "prd": {**prd.data, 'requirements': [r for r in prd.data['requirements'] if r['id'] in active]},
                "context": round_.snapshot["context"],
                "answers": {rid: answer for rid, answer in db.get(Submission, round_.submitted_id).data.items() if rid in active},
                "classification": round_.snapshot.get('classification', {}),
                "questionnaire": round_.snapshot.get('questionnaire', {}),
                "controls": round_.snapshot.get('controls', []),
                "negotiation_instructions": round_.snapshot.get("instructions", "")}
    raise DomainError("INVALID_JOB_TYPE")


def schedule(db, system, kind, mode, language, *, reparse=False):
    if isinstance(kind, str) and (kind.startswith(('narrative_refinement:', 'function_expansion:', 'delivery_evidence:')) or kind == 'prd_import_extraction') and mode != 'openrouter':
        raise DomainError('INVALID_GENERATION_MODE')
    if mode not in ("local", "openrouter") or language not in ("zh", "en"):
        raise DomainError("INVALID_GENERATION_MODE")
    from .ai_settings import configured, snapshot
    if mode == "openrouter" and not configured(db, system.org_id):
        raise DomainError("MODEL_NOT_CONFIGURED", 503)
    if kind == "context_organization":
        require_state(system, "DRAFT", "CLASSIFYING", "CONTEXT_REVIEW")
    elif kind == "prd_generation":
        from .db import AssessmentProfile
        profile = db.get(AssessmentProfile, system.id)
        if profile and profile.kind == 'existing':
            raise DomainError('STATE_CONFLICT', 409)
        require_state(system, "CONTROL_REVIEW", "PRD_GENERATING", "PRD_REVIEW")
        if system.draft.get("proposal_stale"):
            raise DomainError("CONTEXT_STALE", 409)
        if not system.context_revision_id or not selections(db, system, included_only=True):
            raise DomainError("CONTEXT_OR_CONTROLS_REQUIRED", 409)
        if any(item.origin == "candidate" and not item.included and not item.reason
               for item in selections(db, system)):
            raise DomainError("APPLICABILITY_REVIEW_REQUIRED", 409)
    elif kind == "impact_analysis":
        require_state(system, "ANALYZING", "RESULT_REVIEW", "NEGOTIATING")
    used = sum(job.usage.get("tokens", 0) for job in db.scalars(select(Job).where(Job.system_id == system.id)))
    if used >= int(os.getenv("SYSEVAL_SYSTEM_TOKEN_BUDGET", "500000")):
        raise DomainError("MODEL_BUDGET_EXCEEDED", 409)
    source = job_input(db, system, kind)
    source_hash = digest(source)
    config = snapshot(db, system.org_id) if mode == "openrouter" else None
    active = db.scalar(select(Job).where(Job.system_id == system.id, Job.kind == kind,
                                         Job.state.in_(["queued", "running"])))
    if active:
        if active.source_hash == source_hash and active.language == language and active.mode == mode:
            return active
        raise DomainError("JOB_ALREADY_RUNNING", 409)
    if kind == 'prd_import_extraction' and not reparse:
        previous = db.scalars(select(Job).where(Job.system_id == system.id, Job.kind == kind,
                                               Job.source_hash == source_hash, Job.state == 'succeeded')
                              .order_by(Job.created_at.desc()))
        for candidate in previous:
            if candidate.usage.get('ai_config_hash') == digest(config):
                return candidate
    job = Job(system_id=system.id, kind=kind, mode=mode, language=language, input=source, source_hash=source_hash)
    job.usage = {"ai_config": config, "ai_config_version": config["version"], "ai_config_hash": digest(config)} if config else {}
    if kind == 'prd_generation':
        from . import prd_templates
        job.usage = {**job.usage, 'prd_template': prd_templates.snapshot(db, system.org_id)}
    db.add(job)
    db.flush()
    if kind == "prd_generation":
        system.status = "PRD_GENERATING"
    elif kind == 'impact_analysis':
        system.status = 'ANALYZING'
    return job


def publish_job(db, system, job, output):
    if job.kind.startswith('delivery_evidence:'):
        from .delivery_ai import validate_output
        job.output = validate_output(output, job.input)
    elif job.kind == 'prd_import_extraction':
        from .prd_imports import publish
        publish(db, system, job, output)
    elif job.kind.startswith(('narrative_refinement:', 'function_expansion:')):
        suggestion = NarrativeSuggestion.model_validate(output).model_dump()
        if not suggestion['text'].strip() or any(not q.strip() or len(q) > 1000 for q in suggestion['questions']):
            raise DomainError('INVALID_MODEL_OUTPUT')
        if job.kind.startswith('function_expansion:') and len(suggestion['text']) > 4000:
            raise DomainError('INVALID_MODEL_OUTPUT')
        job.output = {**suggestion, 'revision': job.input.get('revision'), 'topic': job.input['topic'], 'original': job.input['text'],
                      'prompt_version': 'narrative-R2'}
    elif job.kind == "context_organization":
        proposal = Context.model_validate(output).model_dump()
        keys = set(system.draft.get("blocks", {}))
        if any(not set(item["source_blocks"]) <= keys for item in proposal["functions"]):
            raise DomainError("INVALID_SOURCE_REFERENCE")
        if len(proposal["questions"]) > 3:
            raise DomainError("INVALID_MODEL_OUTPUT")
        system.draft = {**system.draft, "proposal": proposal, "proposal_stale": False, "proposal_mode": job.mode}
        job.output = proposal
    elif job.kind == "prd_generation":
        data = validate_prd(output, job.input["context"], job.input["controls"])
        from . import prd_templates
        pinned = job.usage.get('prd_template')
        from .topology import embed
        source = {**job.input, 'generation_mode': job.mode, 'network_topology': embed(db, system.id, job.input.get('network_topology', []))}
        markdown = render_prd(data, source, job.language, pinned)
        prd = Prd(system_id=system.id, revision=system.revision, language=job.language, mode=job.mode,
                  data=data, markdown=markdown, content_hash=digest({"data": data, "markdown": markdown, "renderer": "R1"}))
        db.add(prd)
        db.flush()
        system.prd_id, system.status = prd.id, "PRD_REVIEW"
        prd_templates.record(db, prd, pinned)
        job.output = {"prd_id": prd.id}
    elif job.kind == "impact_analysis":
        report = publish_impact_report(db, system, job.input, output, job.mode)
        job.output = {"report_id": report.id}
    system.updated_at = time.time()
    db.add(Audit(system_id=system.id, action=f"{job.kind}.completed", detail={"job_id": job.id, "mode": job.mode}))


def publish_impact_report(db, system, source, output, mode):
    from .negotiation import carried_findings
    evidence = redact_source(source['answers']) if mode == 'openrouter' else source['answers']
    data = validate_report(output, source['prd']['requirements'], evidence,
                           contextual_source=redact_source(source) if mode == 'openrouter' else None)
    round_ = db.get(SupplierRound, source['round_id'])
    carried, decisions = carried_findings(round_)
    data = {**data, 'findings': [*carried, *data['findings']]}
    if round_.snapshot.get('legacy_exceptions'):
        decisions['_exceptions'] = round_.snapshot['legacy_exceptions']
    report = Report(system_id=system.id, submission_id=round_.submitted_id,
                    data=data, mode=mode, decisions=decisions, reviewed=False)
    db.add(report)
    db.flush()
    system.report_id, system.status = report.id, 'RESULT_REVIEW'
    return report


def prepare_local_review(db, system, language='zh', actor_id=None):
    """Prepare deterministic review in the command transaction, without model jobs."""
    require_state(system, 'RESULT_REVIEW', 'NEGOTIATING')
    if language not in ('zh', 'en'):
        raise DomainError('INVALID_FIELDS')
    round_ = db.get(SupplierRound, system.round_id) if system.round_id else None
    if not round_ or not round_.submitted_id:
        raise DomainError('STATE_CONFLICT', 409)
    report = db.get(Report, system.report_id) if system.report_id else None
    if report:
        if report.submission_id != round_.submitted_id:
            raise DomainError('VERSION_CONFLICT', 409)
        return report
    source = job_input(db, system, 'impact_analysis')
    from .ai import local_impact
    report = publish_impact_report(db, system, source, local_impact(source, language), 'local')
    db.add(Audit(system_id=system.id, actor_id=actor_id, action='impact_analysis.completed', detail={
        'mode': 'local', 'report_id': report.id, 'submission_id': round_.submitted_id,
        'source_hash': digest(source), 'automatic': True}))
    return report


def save_submission(db, system, round_, user, payload):
    from .negotiation import merge_answers
    if round_.supplier_org_id != user.org_id or user.role != "vendor":
        raise DomainError("FORBIDDEN", 403)
    if system.round_id != round_.id or round_.status != "open":
        raise DomainError("ROUND_CLOSED", 409)
    if payload.get("round_version") != round_.version:
        raise DomainError("VERSION_CONFLICT", 409)
    validated = merge_answers(round_, db.get(Prd, round_.prd_id), payload.get('answers', {}), complete=True)
    submission = Submission(round_id=round_.id, actor_id=user.id, data=validated)
    db.add(submission)
    db.flush()
    round_.status, round_.submitted_id = "submitted", submission.id
    round_.draft = validated
    round_.version += 1
    # Deterministic preparation is part of publication; payload mode cannot start AI.
    system.status, system.report_id = "RESULT_REVIEW", None
    prepare_local_review(db, system, payload.get('language', 'zh'), actor_id=user.id)
    prepare_remediation_agreement(db, system, actor_id=user.id)
    return submission


def prepare_remediation_agreement(db, system, actor_id=None):
    """Finish a scoped owner-requested correction without another acceptance step."""
    from .negotiation import accepted, scope
    if system.status != 'RESULT_REVIEW' or system.baseline_id:
        return False
    round_ = db.get(SupplierRound, system.round_id)
    if not round_ or not round_.submitted_id or not accepted(round_):
        return False
    prd = db.get(Prd, round_.prd_id)
    submission = db.get(Submission, round_.submitted_id)
    current_scope = scope(round_, prd)
    if not current_scope or any(submission.data.get(rid, {}).get('implementation_status') != 'yes'
                                for rid in current_scope):
        return False
    freeze_baseline(db, system)
    db.add(Audit(system_id=system.id, actor_id=actor_id, action='baseline.frozen', detail={
        'baseline_id': system.baseline_id, 'submission_id': submission.id,
        'automatic': True, 'reason': 'remediation_commitments_complete'}))
    return True


def review_report(db, system, payload, actor_id=None):
    from .negotiation import carried_findings, open_round
    require_state(system, "RESULT_REVIEW", "NEGOTIATING")
    report = db.get(Report, system.report_id) if system.report_id else None
    if not report:
        raise DomainError("REVIEW_INCOMPLETE")
    round_ = db.get(SupplierRound, system.round_id) if system.round_id else None
    if not round_ or report.submission_id != round_.submitted_id:
        raise DomainError("VERSION_CONFLICT", 409)
    if payload.get('report_id', report.id) != report.id:
        raise DomainError('VERSION_CONFLICT', 409)
    decisions = copy.deepcopy(payload.get("decisions", {}))
    _, carried_decisions = carried_findings(round_)
    expected = {finding["id"] for finding in report.data["findings"]}
    from .supplier_review import commitment_decisions
    commitments = commitment_decisions(db, round_, report)
    required = expected - set(carried_decisions) - set(commitments)
    if not isinstance(decisions, dict) or not required <= set(decisions) or not set(decisions) <= expected:
        raise DomainError("REVIEW_INCOMPLETE")
    if any(decisions[key] != value for key, value in carried_decisions.items() if key in decisions):
        raise DomainError('ACCEPTED_REQUIREMENT_LOCKED', 409)
    # Older explicit owner decisions retain their authored reasons. New clients only
    # submit exceptions; the server derives commitments from the immutable submission.
    commitments.update({key: copy.deepcopy(value) for key, value in report.decisions.items()
                        if key in commitments and value.get('decision') in ('accept', 'changes')
                        and isinstance(value.get('reason'), str) and value['reason'].strip()})
    for key, value in decisions.items():
        if isinstance(value, dict) and value != commitments.get(key):
            value.pop('decision_source', None)
    decisions = {**commitments, **decisions, **carried_decisions}
    for item in decisions.values():
        if not isinstance(item, dict) or item.get("decision") not in ("accept", "changes") or not isinstance(item.get('reason'), str) or not item['reason'].strip():
            raise DomainError("REVIEW_INCOMPLETE")
    from .source_risk import assessment
    source_review = assessment(db, system)
    high = set(source_review.get('high_requirements', []))
    answers = db.get(Submission, round_.submitted_id).data
    for finding in report.data['findings']:
        decision = decisions[finding['id']]
        if finding['id'] in carried_decisions:
            continue
        decision.pop('residual_severity', None)
        if decision.get('decision_source') == 'supplier_commitment':
            continue
        if decision['decision'] != 'accept':
            continue
        source_exception = (finding['requirement_id'] in high
                            and answers[finding['requirement_id']]['implementation_status'] != 'yes')
        if source_exception:
            if decision.get('owner_reviewed') is not True:
                raise DomainError('HIGH_RISK_CONTROL_UNRESOLVED', 409)
        if source_exception or finding['severity'] in ('high', 'critical'):
            decision['residual_severity'] = 'medium'
    # The separate exception review is retired. Preserve authored historical notes,
    # including when a new client omits the old optional compatibility field.
    legacy_exceptions = report.decisions.get("_exceptions")
    legacy_reason = payload.get("exception_reason")
    if isinstance(legacy_reason, str) and legacy_reason.strip():
        legacy_exceptions = {"reason": legacy_reason}
    report.decisions = {**decisions, **({"_exceptions": legacy_exceptions} if legacy_exceptions else {})}
    report.reviewed = True
    system.status = "NEGOTIATING" if any(d["decision"] == "changes" for d in decisions.values()) else "RESULT_REVIEW"
    if payload.get('advance_workflow') is True:
        if system.status == 'NEGOTIATING':
            return open_round(db, system, actor_id=actor_id)
        freeze_baseline(db, system)
        db.add(Audit(system_id=system.id, actor_id=actor_id, action='baseline.frozen',
                     detail={'baseline_id': system.baseline_id, 'report_id': report.id}))


def baseline_payload(db, system):
    from .negotiation import accepted
    prd = db.get(Prd, system.prd_id)
    round_ = db.get(SupplierRound, system.round_id)
    report = db.get(Report, system.report_id)
    return {"name": system.name, "revision": system.revision, "context_revision_id": system.context_revision_id,
            "context": system.context, "classification": system.classification,
            "controls": [selection_view(item) for item in selections(db, system)],
            "prd_id": prd.id, "prd_hash": prd.content_hash, "prd": prd.data,
            "round_id": round_.id, "supplier_org_id": round_.supplier_org_id,
            "submission_id": round_.submitted_id, "answers": db.get(Submission, round_.submitted_id).data,
            "report_id": report.id, "report": report.data, "decisions": report.decisions,
            **({'accepted_requirements': accepted(round_)} if accepted(round_) else {})}


def freeze_baseline(db, system):
    from .source_risk import require_passable
    require_passable(db, system)
    require_state(system, "RESULT_REVIEW")
    report = db.get(Report, system.report_id)
    round_ = db.get(SupplierRound, system.round_id)
    prd = db.get(Prd, system.prd_id)
    if report and not report.reviewed and report.submission_id == round_.submitted_id:
        from .negotiation import carried_findings
        from .supplier_review import commitment_decisions
        _, carried = carried_findings(round_)
        resolved = set(commitment_decisions(db, round_, report)) | set(carried)
        if {f['id'] for f in report.data['findings']} <= resolved:
            review_report(db, system, {'decisions': {}})
    if (not report or not report.reviewed or report.submission_id != round_.submitted_id or not prd.approved
            or {f['requirement_id'] for f in report.data['findings']} != {r['id'] for r in prd.data['requirements']}
            or any(report.decisions.get(f['id'], {}).get('decision') != 'accept'
                   or not report.decisions[f['id']].get('reason', '').strip() for f in report.data['findings'])):
        raise DomainError("REVIEW_INCOMPLETE")
    payload = baseline_payload(db, system)
    baseline = Baseline(system_id=system.id, payload=payload, content_hash=digest(payload))
    db.add(baseline)
    db.flush()
    system.baseline_id, system.status = baseline.id, "FINAL_CONFIRMATION"


def confirm_baseline(db, system, baseline, user, content_hash):
    require_state(system, "FINAL_CONFIRMATION", "PENDING_DEVELOPMENT")
    from .source_risk import require_passable
    require_passable(db, system)
    validate_current_baseline(baseline.id, system.baseline_id, baseline.content_hash, content_hash)
    if user.role != "vendor" and user.id == system.owner_id:
        party = "customer"
    elif user.role == "vendor" and user.org_id == baseline.payload["supplier_org_id"]:
        party = "supplier"
    else:
        raise DomainError("FORBIDDEN", 403)
    confirmations = list(db.scalars(select(Confirmation).where(Confirmation.baseline_id == baseline.id)))
    if any(item.actor_id == user.id and item.party != party for item in confirmations):
        raise DomainError("DISTINCT_APPROVERS_REQUIRED", 409)
    if not any(item.party == party for item in confirmations):
        db.add(Confirmation(baseline_id=baseline.id, actor_id=user.id, party=party, content_hash=content_hash))
    db.flush()
    confirmations = list(db.scalars(select(Confirmation).where(Confirmation.baseline_id == baseline.id)))
    if {item.party for item in confirmations} == {'customer', 'supplier'} and not baseline.finalized:
        finalize_agreement(db, system, baseline)
        db.add(Audit(system_id=system.id, actor_id=user.id, action='baseline.finalized',
                     detail={'baseline_id': baseline.id, 'automatic_after_joint_confirmation': True}))


def finalize(db, system, baseline, user):
    if user.id != system.owner_id or user.role == "vendor":
        raise DomainError("FORBIDDEN", 403)
    finalize_agreement(db, system, baseline)


def finalize_agreement(db, system, baseline):
    """Called only after explicit independent confirmations or the authorized legacy command."""
    if baseline.id != system.baseline_id:
        raise DomainError("BASELINE_CHANGED", 409)
    if baseline.finalized and system.status == "PENDING_DEVELOPMENT":
        return
    require_state(system, "FINAL_CONFIRMATION")
    from .source_risk import require_passable
    require_passable(db, system)
    confirmations = list(db.scalars(select(Confirmation).where(Confirmation.baseline_id == baseline.id)))
    validate_confirmations(confirmations, baseline.content_hash, ("customer", "supplier"))
    if digest(baseline_payload(db, system)) != baseline.content_hash:
        raise DomainError("BASELINE_CHANGED", 409)
    if not db.get(Report, system.report_id).reviewed or not db.get(Prd, system.prd_id).approved:
        raise DomainError("REVIEW_INCOMPLETE")
    baseline.finalized, system.status = True, "PENDING_DEVELOPMENT"


def system_view(db, system, user):
    from .negotiation import accepted, round_number, scope
    from .supplier_review import summary as supplier_summary
    from .source_risk import assessment as source_assessment
    from .source_risk import high_source_requirements
    from .assessment_creation import profile_view
    info = {"id": system.id, "name": system.name, "status": system.status, "version": system.version,
            "revision": system.revision, "updated_at": system.updated_at, "created_at": system.created_at,
            "classification": system.classification, "context": system.context, "draft": system.draft,
            "context_revision_id": system.context_revision_id}
    if user.role != 'vendor':
        from .topology import snapshot as topology_snapshot
        info['network_topology'] = topology_snapshot(db, system.id)
    info.update(profile_view(db, system))
    prd = db.get(Prd, system.prd_id) if system.prd_id else None
    round_ = db.get(SupplierRound, system.round_id) if system.round_id else None
    if user.role == "vendor":
        assigned = list(db.scalars(select(SupplierRound).where(SupplierRound.system_id == system.id,
                                                              SupplierRound.supplier_org_id == user.org_id)))
        round_ = next((item for item in assigned if item.id == system.round_id), assigned[-1])
        info.update({"context": round_.snapshot["context"], "classification": round_.snapshot["classification"],
                     "draft": {}, "context_revision_id": round_.snapshot["context_revision_id"]})
        prd = db.get(Prd, round_.prd_id)
        if round_.id != system.round_id:
            info["status"] = "ROUND_CLOSED"
    report = db.get(Report, system.report_id) if system.report_id else None
    if user.role == "vendor" and report and (not round_ or report.submission_id != round_.submitted_id):
        report = None
    baseline = db.get(Baseline, system.baseline_id) if system.baseline_id else None
    if user.role == "vendor" and baseline and baseline.payload["supplier_org_id"] != user.org_id:
        baseline = None
    jobs = list(db.scalars(select(Job).where(Job.system_id == system.id).order_by(Job.created_at.desc()).limit(20)))
    if user.role == "vendor":
        jobs = [job for job in jobs if job.kind == "impact_analysis" and round_ and job.input.get("round_id") == round_.id]
    latest_job = jobs[0] if jobs else None
    prd_controls = (round_.snapshot.get('controls', []) if round_ and prd and round_.prd_id == prd.id
                    else [item.snapshot for item in selections(db, system)] if prd else [])
    return {"system": info, "permissions": sorted(access.capabilities(db, user, system)),
            "job": {"id": latest_job.id, "state": latest_job.state, "kind": latest_job.kind,
                    "mode": latest_job.mode, "error": latest_job.error, "attempts": latest_job.attempts} if latest_job else None,
            "controls": [selection_view(item) for item in selections(db, system)] if user.role != "vendor" else [],
            "prd": {"id": prd.id, "data": prd.data, "approved": prd.approved,
                    "language": prd.language, "mode": prd.mode, "content_hash": prd.content_hash,
                    "requirement_domains": requirement_domains(prd, prd_controls),
                    "high_risk_requirements": high_source_requirements(prd.data, prd_controls)} if prd else None,
            "round": {"id": round_.id, "status": round_.status, "version": round_.version,
                      "draft": round_.draft, "submitted_id": round_.submitted_id,
                      "instructions": round_.snapshot.get("instructions", ""),
                      "number": round_number(db, round_),
                      "review_scope": sorted(scope(round_, prd)),
                      "accepted_requirement_ids": sorted(accepted(round_)),
                      "owner_feedback": round_.snapshot.get('owner_feedback', {}),
                      "supplier_org_id": round_.supplier_org_id} if round_ else None,
            "supplier_review": supplier_summary(db, round_, report),
            "report": {"id": report.id, "data": report.data, "mode": report.mode,
                       "mlps3_major_risk": mlps3_major_risk(db, system, prd, report),
                       "source_assessment": source_assessment(db, system),
                       "control_originals": impact_control_originals(db, system, prd),
                       "reviewed": report.reviewed, "decisions": report.decisions} if report else None,
            "baseline": {"id": baseline.id, "content_hash": baseline.content_hash, "finalized": baseline.finalized,
                         "confirmations": [{"party": c.party, "actor_id": c.actor_id, "created_at": c.created_at}
                                           for c in db.scalars(select(Confirmation).where(Confirmation.baseline_id == baseline.id))]} if baseline else None}
