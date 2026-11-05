import { expect, it } from 'vitest'
import { reviewDemoDecisions } from './reviewDemo'
import type { Finding, SupplierReviewItem } from './types'

const item: SupplierReviewItem = { requirement_id: 'REQ-renumbered', title: '恶意代码防范',
  description: 'Unrelated generated description', origin: 'control', source_risk: 'high', domains: [],
  status: 'needs_clarification', answer: {}, controls: [{ id: 'pinned-control', source: 'MLPS', identifier: 'clause',
    text: '应安装防恶意代码软件或配置具有相应功能的软件，并定期进行升级和更新防恶意代码库。', risk: 'high' }] }
const finding: Finding = { id: 'F-new', requirement_id: item.requirement_id, severity: 'unknown', title: 'Clarify',
  evidence_field: 'limitations', evidence: 'Missing evidence', impact: 'Unverified', recommendation: 'Review' }

it('matches immutable clauses after renumbering and localizes new examples without changing input', () => {
  const original = { untouched: { decision: 'changes' as const, reason: 'Authored elsewhere' } }
  const result = reviewDemoDecisions(original, [finding], [item], [item.requirement_id], new Set([item.requirement_id]), 'en')
  expect(result['F-new']).toEqual({ decision: 'accept', reason: 'Perform periodic vulnerability and system security assessments', owner_reviewed: false })
  expect(original).not.toHaveProperty('F-new')
  expect(result.untouched).toBe(original.untouched)
})

it('does not fill by generic title, old IDs, unrelated status or multiple findings', () => {
  const fill = (items: SupplierReviewItem[], findings = [finding], clarification = new Set([item.requirement_id])) =>
    reviewDemoDecisions({}, findings, items, [item.requirement_id], clarification, 'zh')
  expect(fill([{ ...item, controls: [] }])).toEqual({})
  expect(fill([{ ...item, origin: 'business' }])).toEqual({})
  expect(fill([{ ...item, status: 'no' }])).toEqual({})
  expect(fill([item], [finding, { ...finding, id: 'F-another' }])).toEqual({})
  expect(fill([item], [finding], new Set())).toEqual({})
})
