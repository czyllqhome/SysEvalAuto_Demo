"""Explicit, additive Demo fixture. No model calls or usable account credentials."""
import argparse
import json
import os
import sqlite3
import sys
from datetime import timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))
os.environ.pop('OPENROUTER_API_KEY', None)  # This offline seed process only.

from sqlalchemy import select  # noqa: E402
from app import ai, service, existing_service as ex, delivery_service as delivery  # noqa: E402
from app.admin_dashboard import overview  # noqa: E402
from app.assessment_creation import create_assessment  # noqa: E402
from app.catalog import control_snapshot  # noqa: E402
from app.db import (AccountPolicy, Audit, Baseline, ContextRevision, Control, ManagedSupplier,  # noqa: E402
                    Organization, OrganizationRole, Prd, Report, Selection, SupplierRound,
                    System, User, make_engine, make_sessions)
from app.delivery_models import DeliverySubmission  # noqa: E402

MARK = 'amer-sports-dashboard-demo-v1'
NOTE = '【虚构演示 / FICTIONAL DEMO】仅模拟 Amer Sports 零售业务场景，不代表真实系统、供应商、风险或批准。'
CASES = [
    ('全球商品企划与需求预测', '商品企划 / Merchandising', None, 'new', '跨品牌汇总季节商品计划、区域需求预测和补货建议'),
    ('门店运动体验预约平台', '零售运营 / Retail Operations', 'L1', 'new', '预约跑步、滑雪及户外装备体验，管理门店时段与活动容量'),
    ('会员与售后服务平台', '会员与客户服务 / Consumer Services', 'L2', 'new', '管理会员服务工单、产品维修、保修资格及售后进度'),
    ('全渠道订单与退换货中台', '数字商务 / Digital Commerce', 'L3', 'new', '协同线上订单、门店自提、跨渠道退换货及退款审批'),
    ('门店 POS 与支付接口安全整改', '零售运营 / Retail Operations', 'L3', 'existing', '核验门店终端权限、支付接口隔离、审计日志及恢复能力'),
    ('全球库存可视化与仓配协同', '供应链与物流 / Supply Chain', 'L2', 'new', '汇总区域仓与门店库存，跟踪调拨、发运和签收异常'),
]


def seed(db, admin):
    previous = [s for s in db.scalars(select(System).where(System.org_id == admin.org_id)) if s.draft.get('demo_seed') == MARK]
    if previous:
        assert len(previous) == 6, 'Partial demo already exists; refusing duplicate import.'
        return previous
    actors = []

    def actor(name, org_id, role, number):
        u = User(name=name, org_id=org_id, role=role, email=f'{MARK}-{number}@example.invalid', password_hash='!disabled-demo-no-password')
        db.add(u)
        db.flush()
        db.add(AccountPolicy(user_id=u.id, active=True, admin=False))
        db.add(OrganizationRole(user_id=u.id, role='supplier' if role == 'vendor' else 'manager'))
        actors.append(u)
        return u

    owner = actor('【演示】客户负责人 / Demo customer', admin.org_id, 'owner', 'customer')
    vendors = []
    for n, name in enumerate(['峰岚会员科技', '跃驰全渠道软件', '远峰门店运维', '星途供应链科技']):
        org = Organization(name=f'【演示虚构】{name}', kind='supplier')
        db.add(org)
        db.flush()
        u = actor(f'【演示】{name}交付负责人', org.id, 'vendor', n)
        db.add(ManagedSupplier(user_id=u.id, customer_org_id=admin.org_id))
        vendors.append(u)
    catalog = service.current_catalog(db, admin.org_id)
    available = list(db.scalars(select(Control).where(Control.catalog_id == catalog.id).order_by(Control.code)))
    assert len(available) >= 6, 'Published source controls required.'

    def generate(system, kind):
        job = service.schedule(db, system, kind, 'local', 'zh')
        result = ai.local_prd(job.input, 'zh') if kind == 'prd_generation' else ai.local_impact(job.input, 'zh')
        service.publish_job(db, system, job, result)
        job.state = 'succeeded'
        job.usage = {**job.usage, 'tokens': 0, 'demo_seed': MARK}
        db.flush()

    def evidence_batch(system, vendor, source_kind='baseline', source_id=None, approve=False):
        batch = delivery.initialize(db, owner, system, {'source_kind': source_kind, 'source_id': source_id})
        for item in delivery.items(db, batch)[:2 if source_kind == 'baseline' else 100]:
            meta = {'description': NOTE + '模拟允许与拒绝路径的验证记录。', 'environment': 'demo-sandbox', 'system_version': 'demo-v1', 'collected_on': ex.today().isoformat()}
            file = delivery.upload(db, vendor, batch, item, {**meta, 'filename': 'FICTIONAL-DEMO-evidence.txt'}, NOTE.encode('utf-8'))
            delivery.save_draft(db, batch, item, {'draft': {**meta, 'attachment_ids': [file.id], 'criteria_evidence_map': {c['id']: [file.id] for c in item.criteria}}})
            delivery.submit(db, vendor, batch, item, {'expected_source_hash': batch.source_hash})
            db.flush()
            if approve:
                submission = db.scalar(select(DeliverySubmission).where(DeliverySubmission.item_id == item.id))
                delivery.review(db, owner, batch, item, submission, {'submission_hash': submission.manifest_hash, 'source_hash': batch.source_hash,
                    'decision': 'PASS', 'reason': NOTE + '模拟客户验证通过。',
                    'criteria_results': [{'criterion_id': c['id'], 'result': 'PASS', 'attachment_ids': [file.id]} for c in item.criteria]})
        if approve:
            delivery.complete(db, owner, batch)
        db.flush()
        return batch

    systems = []
    for index, (title, department, level, kind, description) in enumerate(CASES):
        body = {'name': f'【演示】Amer Sports · {title}', 'assessment_type': kind}
        if kind == 'existing':
            body.update(scope=NOTE + description, environment='demo-sandbox', system_version='demo-v1', as_of=ex.today().isoformat(), trigger='演示现状核验')
        system = create_assessment(db, admin, body)
        system.owner_id = owner.id
        system.draft = {'demo_seed': MARK, 'demo_notice': NOTE, 'blocks': {'goal': NOTE + description, 'functions': description, 'people': department}}
        systems.append(system)
        if level:
            system.classification = {'mode': 'manual', 'effective_level': level, 'reason': NOTE + '演示范围人工定级，不构成真实等级结论。', 'exceptions': [], 'catalog_id': catalog.id}
            system.context = {'summary': NOTE + description, 'functions': [{'id': 'F-DEMO-1', 'title': title, 'description': description, 'source_blocks': ['functions']}],
                              'departments': [department, '信息技术 / IT'], 'roles': ['业务负责人', '门店/区域经办', '供应商交付负责人'],
                              'owner_role': '演示业务负责人', 'scope': NOTE + '仅对六项来源控制进行演示抽样，不代表完整合规评估。',
                              'workflow': '业务申请 → 负责人审批 → 供应商实施 → 客户验证', 'data_notes': '仅使用虚构商品、门店、会员及订单数据。',
                              'integrations': '演示 ERP、OMS、WMS 与统一身份接口', 'constraints': '演示隔离环境，不接入真实支付或客户资料。', 'questions': [], 'grading_facts': {}}
            revision = ContextRevision(system_id=system.id, source={'demo_seed': MARK, 'blocks': system.draft['blocks']}, data=system.context)
            db.add(revision)
            db.flush()
            system.context_revision_id = revision.id
            controls = [c for c in available if level in c.levels][:6]
            assert len(controls) == 6, f'Insufficient controls for {level}'
            for control in controls:
                db.add(Selection(system_id=system.id, revision=system.revision, control_id=control.id, included=True, origin='manual', reason=NOTE + '演示抽样范围', snapshot=control_snapshot(control)))
            system.status = 'CONTROL_REVIEW'
            db.flush()
        if index in (1, 2, 3, 5):
            generate(system, 'prd_generation')
        if index in (2, 3, 5):
            vendor = vendors[{2: 0, 3: 1, 5: 3}[index]]
            prd = db.get(Prd, system.prd_id)
            prd.approved = True
            round_ = SupplierRound(system_id=system.id, supplier_org_id=vendor.org_id, prd_id=prd.id,
                snapshot={'controls': [s.snapshot for s in service.selections(db, system)], 'context': system.context,
                          'classification': system.classification, 'context_revision_id': system.context_revision_id, 'demo_seed': MARK})
            db.add(round_)
            db.flush()
            system.round_id, system.status = round_.id, 'VENDOR_FILLING'
            answers = {r['id']: {'implementation_status': 'yes', 'duration_workdays': 10, 'owner_name': vendor.name,
                       'implementation_plan': NOTE + '按需求实施并提供验收记录。'} for r in prd.data['requirements']}
            if index == 2:
                round_.draft = dict(list(answers.items())[:3])
            else:
                if index == 3:
                    for key, value in zip(list(answers)[:3], ['partial', 'no', 'needs_clarification']):
                        answers[key].update(implementation_status=value, limitations=NOTE + '跨区域订单一致性与退货审批边界待澄清。', alternative='分阶段交付并保留人工复核。')
                service.save_submission(db, system, round_, vendor, {'round_version': round_.version, 'answers': answers})
                generate(system, 'impact_analysis')
                if index == 5:
                    report = db.get(Report, system.report_id)
                    service.review_report(db, system, {'decisions': {f['id']: {'decision': 'accept', 'reason': NOTE + '模拟接受承诺，交付证据另行验收。'} for f in report.data['findings']}})
                    service.freeze_baseline(db, system)
                    baseline = db.get(Baseline, system.baseline_id)
                    for person in (owner, vendor):
                        service.confirm_baseline(db, system, baseline, person, baseline.content_hash)
                    evidence_batch(system, vendor)
        if index == 4:
            ex.begin(db, system)
            db.flush()
            def evidence():
                return ex.add_evidence(db, system, owner, {'description': NOTE + '模拟终端权限与日志测试记录。', 'environment': 'demo-sandbox', 'system_version': 'demo-v1', 'collected_on': ex.today().isoformat()})['evidence_id']
            eid = evidence()
            risks = {}
            for n, control in enumerate(controls):
                ex.verify(db, system, owner, {'control_id': control.id, 'conclusion': 'partial', 'reason': NOTE + '模拟配置与证据缺口。', 'method': '演示场景复核', 'evidence_ids': [eid]})
                risks[control.id] = {'impact': ['high', 'medium', 'low'][n % 3], 'likelihood': 'medium', 'reason': NOTE}
            ex.publish_report(db, system, owner, {'summary': NOTE + '门店终端整改演示', 'risk_reviews': risks})
            for n, control in enumerate(controls[:4]):
                # First plan is closed, second awaiting retest, third in progress, fourth pending approval.
                ex.plan(db, system, owner, {'plan': {'gap_ids': [control.id], 'owner_id': owner.id, 'due_on': (ex.today() + timedelta(days=[-5, -2, 14, -1][n])).isoformat(),
                    'kind': 'configuration', 'scope': NOTE + ['权限最小化', '日志留存与复核', '支付网络隔离', '终端基线加固'][n], 'acceptance_criteria': ['模拟允许/拒绝路径通过且保留审查证据']}, 'supplier_id': vendors[2].id})
                run = ex.current_run(db, system)
                plan = next(p for p in run.data['plans'].values() if control.id in p['payload']['gap_ids'])
                plan_id = plan['id']
                if n < 3:
                    for person in (owner, vendors[2]):
                        ex.approve_plan(db, system, person, {'plan_id': plan_id, 'content_hash': plan['content_hash']}, supplier=person.role == 'vendor')
                if n < 2:
                    evidence_batch(system, vendors[2], 'plan', plan_id, approve=True)
                    if n == 0:
                        ex.retest(db, system, owner, {'plan_id': plan_id, 'content_hash': plan['content_hash'], 'passed': True, 'reason': NOTE + '模拟复测通过。', 'system_version': 'demo-v1', 'evidence_ids': [evidence()]})
            ex.accept_risk(db, system, owner, {'gap_id': controls[4].id, 'acceptance': {'owner_id': owner.id, 'reason': NOTE + '模拟有期限风险接受。', 'compensating_measures': '每日人工核对', 'review_on': (ex.today() + timedelta(days=30)).isoformat()}})
        db.add(Audit(system_id=system.id, actor_id=admin.id, action='demo.seeded', detail={'seed': MARK, 'notice': NOTE, 'simulated_actors': True}))
        db.flush()
    for person in actors:
        db.get(AccountPolicy, person.id).active = False
    db.flush()
    # All links and source checks must work before the single atomic commit.
    for system in systems:
        service.system_view(db, system, admin)
    return systems


def run(path):
    engine = make_engine('sqlite:///' + str(path).replace('\\', '/'))
    sessions = make_sessions(engine)
    with sessions.begin() as db:
        admin = db.scalar(select(User).join(AccountPolicy).where(AccountPolicy.username == 'admin', AccountPolicy.admin.is_(True)))
        assert admin is not None
        # Capture every pre-existing row; fail/rollback if any old record changes.
        connection = db.connection()
        tables = [r[0] for r in connection.exec_driver_sql("select name from sqlite_master where type='table' and name not like 'sqlite_%'")]
        before = {table: set(connection.exec_driver_sql(f'SELECT * FROM "{table}"').all()) for table in tables}
        systems = seed(db, admin)
        for table, rows in before.items():
            assert rows <= set(connection.exec_driver_sql(f'SELECT * FROM "{table}"').all()), f'Existing records changed: {table}'
        report = overview(db, admin)
        print(json.dumps({'systems': [{'id': s.id, 'name': s.name, 'status': s.status} for s in systems], 'summary': report['summary'], 'remediation': report['remediation'], 'existing_records_unchanged': True}, ensure_ascii=True))
    engine.dispose()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--database', type=Path, required=True)
    args = parser.parse_args()
    target = args.database.resolve()
    assert target.is_relative_to(ROOT), 'Only the Demo checkout is allowed.'
    assert target.is_file(), 'An existing database is required.'
    with sqlite3.connect(f'file:{target.as_posix()}?mode=ro', uri=True) as check:
        assert check.execute("select count(*) from ai_jobs where state in ('queued','running')").fetchone()[0] == 0, 'Wait for active jobs.'
    run(target)
