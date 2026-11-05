import type { Decision, Finding, Locale, SupplierReviewItem } from './types'

// These three owner-authored examples were supplied for this page's Demo.
// Match pinned clauses, never regenerated requirement IDs or generic titles.
const examples = [
  {
    matches: (text: string) => text.includes('远程管理') && text.includes('鉴别信息') && text.includes('窃听'),
    status: 'no', decision: 'changes',
    zh: '使用指定工具', en: 'Use the designated tool',
  },
  {
    matches: (text: string) => text.includes('安装防恶意代码软件') && text.includes('更新防恶意代码库'),
    status: 'needs_clarification', decision: 'accept',
    zh: '定期进行漏洞和系统安全评估', en: 'Perform periodic vulnerability and system security assessments',
  },
  {
    matches: (text: string) => text.includes('外部人员') && text.includes('书面申请') && text.includes('开设账户') && text.includes('登记备案'),
    status: 'needs_clarification', decision: 'accept',
    zh: '需经过正是审批流程', en: 'Follow the formal approval process',
  },
] satisfies { matches: (text: string) => boolean; status: SupplierReviewItem['status']; decision: Decision['decision']; zh: string; en: string }[]

export function reviewDemoDecisions(
  current: Record<string, Decision>, findings: Finding[], items: SupplierReviewItem[],
  blocked: string[], clarification: Set<string>, locale: Locale,
): Record<string, Decision> {
  const result = { ...current }
  for (const item of items) {
    if (item.origin === 'business') continue
    const text = [item.description, ...item.controls.map(c => c.text)].join(' ').replace(/\s+/g, '')
    const example = examples.find(e => e.status === item.status && e.matches(text))
    if (!example || (example.decision === 'accept' && blocked.includes(item.requirement_id) && !clarification.has(item.requirement_id))) continue
    const related = findings.filter(f => f.requirement_id === item.requirement_id)
    // A saved example cannot implicitly decide multiple different findings.
    if (related.length !== 1) continue
    result[related[0].id] = { decision: example.decision, reason: example[locale],
      ...(clarification.has(item.requirement_id) && example.decision === 'accept' ? { owner_reviewed: false } : {}) }
  }
  return result
}
