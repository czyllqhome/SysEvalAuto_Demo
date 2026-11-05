import { expect, it } from 'vitest'
import { supplierDemoAnswer } from './supplierDemo'
import { answerComplete } from './supplierAnswers'
import type { Requirement } from './types'
import latestCases from '../../evals/fixtures/supplier-demo-latest.json'

const base: Requirement = { id: 'REQ-renumbered', title: '控制要求', description: '', origin: 'control', priority: 'must', source_context_item_ids: [], source_control_ids: ['source'], acceptance_criteria: [], dependencies: [] }

it.each(latestCases)('reuses the latest authored high-risk example for $description in both languages', ({ description, answer: saved }) => {
  expect(supplierDemoAnswer({ ...base, description }, 'zh')).toEqual(saved)
  for (const locale of ['zh', 'en'] as const) {
    const answer = supplierDemoAnswer({ ...base, description: description.replaceAll('，', '，\n ') }, locale)
    expect(answer).toMatchObject({ implementation_status: saved.implementation_status, duration_workdays: saved.duration_workdays })
    expect(answer.limitations).not.toMatch(/^(演示|Demo)/)
    expect(answer.alternative).not.toMatch(/^(演示|Demo)/)
    expect(answer.alternative).toContain(locale === 'zh' ? '负责人' : 'owner')
    expect(answerComplete(answer)).toBe(true)
  }
})

it('does not assign exceptions by REQ number or a generic control title', () => {
  expect(supplierDemoAnswer({ ...base, id: 'REQ-046', title: '身份鉴别', description: '应对登录的用户进行身份标识和鉴别。' }, 'zh').implementation_status).toBe('yes')
  expect(supplierDemoAnswer({ ...base, origin: 'business', description: '远程管理鉴别信息窃听演示' }, 'zh').implementation_status).toBe('yes')
})
