import type { DeliveryBatch, DeliveryItem, Draft } from '../../src/deliveryModel'

// Synthetic data shared by offline UI tests and isolated browser screenshots.
export function deliveryFixture(actions = ['read', 'review', 'complete', 'analyze']): DeliveryBatch {
  const draft: Draft = { description: '已完成统一身份认证接入，并验证离职账号无法继续登录。详见测试记录与配置说明。', environment: 'UAT', system_version: 'v2.4.0', collected_on: '2026-01-01', attachment_ids: ['a-review'], criteria_evidence_map: { 'AC-1': ['a-review'], 'AC-2': ['a-review'] } }
  const item: DeliveryItem = {
    id: 'i-review', source_id: 'REQ-SEC-001', version: 7, status: 'IN_REVIEW', draft,
    snapshot: { finding: { title: '统一身份认证与账号生命周期管理' }, requirement: { title: '统一身份认证与账号生命周期管理', description: '系统应接入企业统一身份认证，支持账号创建、权限变更与离职停用的完整生命周期管理。敏感操作须验证当前账号状态，并保留可追溯的操作记录。', origin: 'control' }, commitment: { implementation_status: 'yes', implementation_plan: '通过企业身份提供方接入 SSO，离职账号同步禁用。', owner_name: '示例供应商 · 王工', estimated_start_date: '2026-01-01', estimated_finish_date: '2026-01-31', duration_workdays: 15 } },
    criteria: [{ id: 'AC-1', text: '统一身份认证登录成功，未授权账号无法访问系统。' }, { id: 'AC-2', text: '停用账号在下一次请求时被拒绝，并记录审计日志。' }],
    attachments: [{ id: 'a-review', filename: 'SSO 集成与账号停用测试报告.md', mime: 'text/plain', size: 5640, sha256: 'attachment-hash', meta: { description: '测试记录', environment: 'UAT', system_version: 'v2.4.0', collected_on: '2026-01-01' } }], submissions: [],
  }
  item.submissions = [{ id: 'sub-review', round_no: 1, manifest_hash: 'manifest-review', created_at: 1767225600, payload: { draft, attachments: item.attachments }, review: null, ai: { id: 'ai-review', state: 'succeeded', error: '', output: { decision: 'NEEDS_MORE_EVIDENCE', summary: '登录与账号禁用测试记录完整；停用后的会话失效证据仍需补充，建议核对审计日志与实际请求结果。', criteria: [{ criterion_id: 'AC-1', result: 'PASS', rationale: '测试记录覆盖授权登录与拒绝访问两种情况。', attachment_ids: ['a-review'] }, { criterion_id: 'AC-2', result: 'NEEDS_MORE_EVIDENCE', rationale: '缺少账号停用后的在途会话与审计记录。', attachment_ids: ['a-review'] }] } } }]
  const returned = structuredClone(item)
  returned.id = 'i-changes'; returned.source_id = 'REQ-SEC-002'; returned.status = 'CHANGES_REQUESTED'
  returned.snapshot.requirement!.title = '敏感数据传输加密与证书管理'
  returned.snapshot.requirement!.description = '敏感业务数据通过加密通道传输，证书应具备有效期监控与更新机制。'
  returned.criteria = [{ id: 'AC-1', text: '敏感接口启用有效加密协议，并拒绝旧版不安全协议。' }, { id: 'AC-2', text: '证书到期前触发告警，并留存证书更新记录。' }]
  returned.draft.description = '已完成敏感接口加密改造，补充证书告警与协议验证记录。'
  returned.attachments[0].filename = '接口加密与证书配置说明.md'
  returned.snapshot.commitment!.owner_name = '示例供应商 · 李工'
  returned.submissions[0].id = 'sub-changes'; returned.submissions[0].manifest_hash = 'manifest-changes'
  returned.submissions[0].review = { decision: 'NEEDS_MORE_EVIDENCE', mode: 'manual', reason: '请补充证书到期告警截图，以及旧协议被禁用的验证记录。', created_at: 1767312000 }
  returned.submissions[0].ai = null
  const pending = structuredClone(item)
  pending.id = 'i-open'; pending.source_id = 'REQ-SEC-003'; pending.status = 'OPEN'; pending.draft = {}; pending.attachments = []; pending.submissions = []
  pending.snapshot.requirement!.title = '关键业务数据备份与恢复验证'
  pending.snapshot.requirement!.description = '定期备份关键业务数据，并验证备份可恢复。'
  pending.criteria = [{ id: 'AC-1', text: '备份任务按已确认的策略执行并留存结果。' }, { id: 'AC-2', text: '恢复演练验证数据完整性并形成记录。' }]
  pending.snapshot.commitment = { implementation_status: 'partial', limitations: '恢复演练按阶段实施。' }
  const accepted = structuredClone(item)
  accepted.id = 'i-approved'; accepted.source_id = 'REQ-SEC-004'; accepted.status = 'APPROVED'
  accepted.snapshot.requirement!.title = '操作审计日志留存与访问控制'
  accepted.snapshot.requirement!.description = '关键操作形成完整审计记录，限制日志访问并按照已确认要求留存。'
  accepted.criteria = [{ id: 'AC-1', text: '关键操作的账号、时间、对象和结果均有审计记录。' }, { id: 'AC-2', text: '日志访问权限与留存配置符合已确认要求。' }]
  accepted.attachments[0].filename = '审计日志与访问权限验证.md'
  accepted.draft.description = '已验证关键操作日志、访问权限与留存配置。'
  accepted.submissions[0].id = 'sub-approved'; accepted.submissions[0].review = { decision: 'PASS', mode: 'manual', reason: '已核对日志完整性、访问权限和留存配置，满足验收要求。', created_at: 1767312000 }
  accepted.submissions[0].ai = null
  for (const candidate of [item, returned, accepted]) {
    const fileId = candidate.id.replace('i-', 'a-')
    candidate.attachments[0].id = fileId
    candidate.draft.attachment_ids = [fileId]
    candidate.draft.criteria_evidence_map = Object.fromEntries(candidate.criteria.map(c => [c.id, [fileId]]))
    candidate.submissions = candidate.submissions.map(s => ({ ...s, payload: { draft: structuredClone(candidate.draft), attachments: structuredClone(candidate.attachments) } }))
  }
  return { id: 'delivery-demo', system_id: 'system-demo', name: '供应链协同管理系统 · 示例', kind: 'baseline', source_id: 'baseline-demo', source_hash: '7d25bfa098ef6f32cc69f1e5a7a4f9b810d3b43d7c81e78c34b5f2fa46e26c81', version: 12, status: 'ACTIVE', total: 4, approved: 1, allowed_actions: actions, items: [item, returned, pending, accepted] }
}
