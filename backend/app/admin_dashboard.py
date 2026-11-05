"""Read-only, organization-scoped management overview of current workflow records."""
import time
from collections import Counter, defaultdict
from datetime import date

from sqlalchemy import or_, select

from . import access, existing_service
from .baseline_rules import validate_confirmations
from .db import AssessmentProfile, Baseline, Confirmation, ManagedSupplier, Organization, SupplierRound, System, User
from .delivery_models import DeliveryBatch, DeliveryItem
from .delivery_service import fresh
from .domain import DomainError


STAGES = {
    'intake': {'DRAFT', 'CLASSIFYING', 'CONTEXT_REVIEW'},
    'controls': {'CONTROL_REVIEW', 'VERIFYING'},
    'prd': {'PRD_GENERATING', 'PRD_REVIEW'},
    'supplier': {'VENDOR_FILLING', 'ANALYZING'},
    'review': {'RESULT_REVIEW', 'NEGOTIATING', 'GAP_REVIEW', 'REMEDIATING', 'FINAL_CONFIRMATION'},
    'complete': {'PENDING_DEVELOPMENT', 'ASSESSMENT_COMPLETE', 'ACCEPTED_RISKS'},
}
TODO_STATES = {
    'DRAFT', 'CLASSIFYING', 'CONTEXT_REVIEW', 'CONTROL_REVIEW', 'PRD_REVIEW',
    'RESULT_REVIEW', 'NEGOTIATING', 'FINAL_CONFIRMATION', 'VERIFYING', 'GAP_REVIEW', 'REMEDIATING',
}
REMEDIATION_STATES = ('closed', 'accepted_risk', 'awaiting_retest', 'in_progress', 'pending_approval', 'unplanned')


def overview(db, user, *, q='', kind=''):
    access.require_admin(db, user)
    if user.role == 'vendor':
        raise DomainError('FORBIDDEN', 403)
    systems = [s for s in db.scalars(select(System).where(System.org_id == user.org_id)
                                   .order_by(System.updated_at.desc(), System.id)) if not s.draft.get('deleted_at')]
    ids = [s.id for s in systems]
    profiles = {p.system_id: p for p in db.scalars(select(AssessmentProfile).where(AssessmentProfile.system_id.in_(ids)))}
    rounds = {r.system_id: r for r in db.scalars(select(SupplierRound).join(System, System.round_id == SupplierRound.id)
                                               .where(System.id.in_(ids), SupplierRound.system_id == System.id))}
    organization_ids = {r.supplier_org_id for r in rounds.values()}
    # Supplier organizations are discovered only through this customer's current work.
    supplier_users = {u.id: u for u in db.scalars(select(User).where(User.role == 'vendor', or_(
        User.org_id.in_(organization_ids), User.id.in_(select(ManagedSupplier.user_id).where(
            ManagedSupplier.customer_org_id == user.org_id)))))}
    organization_ids.update(u.org_id for u in supplier_users.values())
    organizations = {o.id: o.name for o in db.scalars(select(Organization).where(Organization.id.in_(organization_ids)))}
    needle = q.strip().casefold()
    systems = [s for s in systems
               if (not kind or (profiles[s.id].kind if s.id in profiles else 'new') == kind)
               and (not needle or needle in ' '.join([s.name, *s.context.get('departments', [])]).casefold())]
    ids = [s.id for s in systems]
    baselines = {b.id: b for b in db.scalars(select(Baseline).where(Baseline.system_id.in_(ids)))}
    confirmations = defaultdict(list)
    for confirmation in db.scalars(select(Confirmation).where(Confirmation.baseline_id.in_(baselines))):
        confirmations[confirmation.baseline_id].append(confirmation)
    stages, levels, departments = Counter(), Counter(), Counter()
    remediation = Counter({key: 0 for key in REMEDIATION_STATES})
    risks = Counter({key: 0 for key in ('high', 'medium', 'low', 'unknown')})
    suppliers, todos = {}, []
    total_new = total_existing = agreed = overdue = stale = 0
    today = existing_service.today()

    def supplier_row(org_id):
        if org_id not in suppliers:
            suppliers[org_id] = {'id': org_id, 'name': organizations.get(org_id, ''), 'systems': {},
                                 'awaiting_response': 0, 'awaiting_review': 0, 'agreed': 0,
                                 'gaps': 0, 'closed': 0, 'overdue': 0}
        return suppliers[org_id]

    for system in systems:
        existing = system.id in profiles and profiles[system.id].kind == 'existing'
        total_existing += int(existing)
        total_new += int(not existing)
        stage = next((key for key, statuses in STAGES.items() if system.status in statuses), 'other')
        stages[stage] += 1
        level = system.classification.get('effective_level') or 'unclassified'
        levels[level] += 1
        names = {name.strip() for name in system.context.get('departments', []) if name.strip()}
        departments.update(names or [''])
        baseline = baselines.get(system.baseline_id)
        confirmed = False
        if baseline and baseline.finalized and baseline.system_id == system.id and system.status == 'PENDING_DEVELOPMENT':
            try:
                validate_confirmations(confirmations[baseline.id], baseline.content_hash, ('customer', 'supplier'))
                confirmed = True
            except DomainError:
                pass
        agreed += int(confirmed)
        system_ref = {'id': system.id, 'name': system.name, 'status': system.status}
        if system.status in TODO_STATES:
            todos.append({**system_ref, 'key': system.id, 'kind': 'assessment',
                          'href': f'/systems/{system.id}', 'updated_at': system.updated_at, 'count': 1,
                          'priority': 1 if system.status in {'RESULT_REVIEW', 'GAP_REVIEW', 'FINAL_CONFIRMATION'} else 2})
        round_ = rounds.get(system.id)
        if round_:
            supplier = supplier_row(round_.supplier_org_id)
            supplier['systems'][system.id] = system_ref
            supplier['awaiting_response'] += int(system.status == 'VENDOR_FILLING' and round_.status == 'open')
            supplier['awaiting_review'] += int(system.status in {'RESULT_REVIEW', 'NEGOTIATING'})
            supplier['agreed'] += int(confirmed)
        if not existing:
            continue
        try:
            run = existing_service.current_run(db, system)
        except DomainError:
            if system.status in {'VERIFYING', 'GAP_REVIEW', 'REMEDIATING', 'ACCEPTED_RISKS', 'ASSESSMENT_COMPLETE'}:
                stale += 1
            continue
        plans_by_gap = {}
        for plan in run.data.get('plans', {}).values():
            plans_by_gap.update({gap_id: plan for gap_id in plan['payload']['gap_ids']})
            assigned = supplier_users.get(plan.get('supplier_id'))
            if assigned:
                supplier_row(assigned.org_id)['systems'][system.id] = system_ref
        for gap_id, gap in run.data.get('gaps', {}).items():
            plan = plans_by_gap.get(gap_id)
            state = gap['status']
            expired = state == 'accepted_risk' and date.fromisoformat(gap['acceptance']['review_on']) <= today
            if state not in {'closed', 'accepted_risk'} or expired:
                state = plan['status'] if plan and plan['status'] in REMEDIATION_STATES else 'unplanned'
            remediation[state] += 1
            is_overdue = bool(plan and state not in {'closed', 'accepted_risk'}
                              and date.fromisoformat(plan['payload']['due_on']) < today)
            overdue += int(is_overdue)
            if state not in {'closed', 'accepted_risk'}:
                risk = gap.get('risk', {}).get('priority', 'unknown')
                risks[risk if risk in risks else 'unknown'] += 1
            assigned = supplier_users.get(plan.get('supplier_id')) if plan else None
            if assigned:
                supplier = supplier_row(assigned.org_id)
                supplier['gaps'] += 1
                supplier['closed'] += int(state == 'closed')
                supplier['overdue'] += int(is_overdue)
        # Expired risk acceptance is surfaced without the read endpoint changing records.
        expired_count = len(existing_service.expired_gaps(run.data))
        if expired_count:
            todos.append({**system_ref, 'key': system.id + ':risk', 'kind': 'risk_expired',
                          'href': f'/systems/{system.id}/existing', 'updated_at': system.updated_at,
                          'count': expired_count, 'priority': 0})

    delivery_review = 0
    system_by_id = {s.id: s for s in systems}
    batches = list(db.scalars(select(DeliveryBatch).where(DeliveryBatch.org_id == user.org_id,
                                                        DeliveryBatch.system_id.in_(ids), DeliveryBatch.status == 'ACTIVE')))
    pending_items = Counter(db.scalars(select(DeliveryItem.batch_id).where(
        DeliveryItem.batch_id.in_([b.id for b in batches]), DeliveryItem.status == 'IN_REVIEW')))
    for batch in batches:
        count = pending_items[batch.id]
        if count and fresh(db, batch):
            delivery_review += count
            system = system_by_id[batch.system_id]
            todos.append({'id': system.id, 'name': system.name, 'status': system.status,
                          'key': batch.id, 'kind': 'delivery', 'href': f'/delivery/{batch.id}',
                          'updated_at': system.updated_at, 'count': count, 'priority': 1})
    supplier_list = [{**row, 'systems': list(row['systems'].values())} for row in suppliers.values()]
    supplier_list.sort(key=lambda row: (-row['overdue'], -row['awaiting_review'], -len(row['systems']), row['name'], row['id']))
    todos.sort(key=lambda item: (item['priority'], -item['updated_at'], item['key']))
    return {
        'generated_at': time.time(), 'organization': db.get(Organization, user.org_id).name,
        'summary': {'total': len(systems), 'new': total_new, 'existing': total_existing,
                    'in_progress': len(systems) - stages['complete'], 'complete': stages['complete'],
                    'agreed': agreed, 'suppliers': len(suppliers), 'todos': len(todos), 'delivery_review': delivery_review},
        'stages': [{'key': key, 'count': stages[key]} for key in [*STAGES, 'other']],
        'remediation': {'total': sum(remediation.values()), 'overdue': overdue,
                        'states': dict(remediation), 'risks': dict(risks), 'stale_assessments': stale},
        'suppliers': supplier_list, 'todos': todos,
        'levels': [{'key': key, 'count': levels[key]} for key in ('L1', 'L2', 'L3', 'unclassified')]
                  + [{'key': key, 'count': count} for key, count in sorted(levels.items()) if key not in {'L1', 'L2', 'L3', 'unclassified'}],
        'departments': [{'name': name, 'count': count} for name, count in sorted(departments.items(), key=lambda item: (-item[1], item[0]))],
    }
