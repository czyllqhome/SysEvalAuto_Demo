import { expect, it } from 'vitest'
import { supplierDemoAnswer } from './supplierDemo'
import { answerComplete } from './supplierAnswers'
import type { Requirement } from './types'

const base: Requirement = { id: 'REQ-renumbered', title: '控制要求', description: '', origin: 'control', priority: 'must', source_context_item_ids: [], source_control_ids: ['source'], acceptance_criteria: [], dependencies: [] }

it.each([
  ['当进行远程管理时，应采取必要措施防止鉴别信息在网络传输过程中被窃听。', 'no', 20],
  ['应安装防恶意代码软件或配置具有相应功能的软件，并定期进行升级和更新防恶意代码库。', 'needs_clarification', 5],
  ['应在外部人员接入受控网络访问系统前先提出书面申请，批准后由专人开设账户、分配权限，\n 并登记备案；', 'needs_clarification', 3],
])('fills a reusable exception for %s in both interface languages', (description, status, days) => {
  for (const locale of ['zh', 'en'] as const) {
    const answer = supplierDemoAnswer({ ...base, description }, locale)
    expect(answer).toMatchObject({ implementation_status: status, duration_workdays: days })
    expect(answer.limitations).toContain(locale === 'zh' ? '演示' : 'Demo')
    expect(answer.alternative).toContain(locale === 'zh' ? '负责人' : 'owner')
    expect(answerComplete(answer)).toBe(true)
  }
})

it('does not assign exceptions by REQ number or a generic control title', () => {
  expect(supplierDemoAnswer({ ...base, id: 'REQ-046', title: '身份鉴别', description: '应对登录的用户进行身份标识和鉴别。' }, 'zh').implementation_status).toBe('yes')
  expect(supplierDemoAnswer({ ...base, origin: 'business', description: '远程管理鉴别信息窃听演示' }, 'zh').implementation_status).toBe('yes')
})
