export interface Attachment {
  id: string; filename: string; mime: string; size: number; sha256: string
  meta: Record<string, string>; created_at?: number
}
export interface Draft {
  description?: string; environment?: string; system_version?: string; collected_on?: string
  attachment_ids?: string[]; criteria_evidence_map?: Record<string, string[]>
}
export interface AIResult {
  id: string; state: string; error: string
  output: { decision: string; summary: string; criteria: { criterion_id: string; result: string; rationale: string; attachment_ids: string[] }[] } | null
}
export interface Submission {
  id: string; round_no: number; manifest_hash: string; created_at?: number; ai?: AIResult | null
  payload: { draft: Draft; attachments: Attachment[] }
  review: { decision: string; reason: string; mode: string; created_at?: number } | null
}
export interface DeliveryItem {
  id: string; source_id: string; status: string; version: number
  reopen_feedback?: { reason: string; created_at: number } | null
  criteria: { id: string; text: string }[]; draft: Draft
  snapshot: {
    finding: { title?: string; reason?: string; severity?: string }
    requirement?: { title?: string; description: string; origin?: string; source_control_ids?: string[] }
    commitment?: { implementation_status: string; implementation_plan?: string; limitations?: string; alternative?: string; owner_name?: string; estimated_start_date?: string | null; estimated_finish_date?: string | null; duration_workdays?: number | null }
  }
  attachments: Attachment[]; submissions: Submission[]
}
export interface DeliveryBatch {
  id: string; name: string; system_id: string; kind: string; source_id?: string; status: string
  source_hash: string; version: number; total: number; approved: number; allowed_actions: string[]; items: DeliveryItem[]
}

export const deliveryStatuses: Record<string, [string, string]> = {
  OPEN: ['待提交', 'Awaiting submission'], IN_REVIEW: ['待验收', 'Awaiting review'],
  CHANGES_REQUESTED: ['退回补充', 'Changes requested'], APPROVED: ['已验收', 'Accepted'],
  ACTIVE: ['开发交付中', 'Delivery in progress'], REVIEW_COMPLETE: ['交付审核完成', 'Delivery review complete'],
  SUPERSEDED: ['来源已更新', 'Source superseded'],
  PASS: ['通过', 'Passed'], FAIL: ['不通过', 'Failed'], NEEDS_MORE_EVIDENCE: ['需补充证据', 'More evidence needed'],
}
export const deliveryTitle = (item: DeliveryItem) => item.snapshot.requirement?.title || item.snapshot.finding.title || item.snapshot.finding.reason || item.source_id
export const deliveryPercent = (batch: DeliveryBatch) => batch.total ? Math.round(batch.approved / batch.total * 100) : 0
export function isOverdue(item: DeliveryItem, batch: DeliveryBatch, today: string) {
  const due = item.snapshot.commitment?.estimated_finish_date
  return batch.status === 'ACTIVE' && item.status !== 'APPROVED' && !!due && /^\d{4}-\d{2}-\d{2}$/.test(due) && due < today
}
export function deliveryMatches(item: DeliveryItem, batch: DeliveryBatch, filter: string, search: string, today: string) {
  const matchesStatus = !filter || (filter === 'OVERDUE' ? isOverdue(item, batch, today) : item.status === filter)
  const content = [item.source_id, deliveryTitle(item), item.snapshot.requirement?.description, item.snapshot.commitment?.owner_name, item.snapshot.commitment?.implementation_plan].join(' ').toLocaleLowerCase()
  return matchesStatus && content.includes(search.trim().toLocaleLowerCase())
}

// Mirrors the existing submission contract; the server remains authoritative.
export function evidenceReadiness(item: DeliveryItem, draft: Draft, today = new Date().toISOString().slice(0, 10)) {
  const date = draft.collected_on ?? ''
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date && date <= today
  const metadata = !!draft.description?.trim() && !!draft.environment?.trim() && !!draft.system_version?.trim() && validDate
  const ids = draft.attachment_ids ?? []
  const files = item.attachments.filter(a => ids.includes(a.id))
  const attachments = ids.length >= 1 && ids.length <= 10 && files.length === ids.length && new Set(ids).size === ids.length && files.reduce((sum, a) => sum + a.size, 0) <= 100 * 1024 * 1024
  const scope = files.length > 0 && files.every(a => a.meta.environment === draft.environment?.trim() && a.meta.system_version === draft.system_version?.trim())
  const map = draft.criteria_evidence_map ?? {}
  const mapped = item.criteria.filter(c => map[c.id]?.length && map[c.id].every(id => ids.includes(id))).length
  const criteria = item.criteria.length > 0 && mapped === item.criteria.length && Object.keys(map).every(id => item.criteria.some(c => c.id === id))
  return { metadata, attachments, scope, criteria, mapped, ready: metadata && attachments && scope && criteria }
}

export function removeDraftAttachment(draft: Draft, id: string): Draft {
  return { ...draft, attachment_ids: draft.attachment_ids?.filter(value => value !== id),
    criteria_evidence_map: Object.fromEntries(Object.entries(draft.criteria_evidence_map ?? {}).map(([key, values]) => [key, values.filter(value => value !== id)])) }
}
