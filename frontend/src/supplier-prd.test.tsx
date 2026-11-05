import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import { AgreementPanel, PrdPanel } from './downstream'
import { AuthContext } from './components'
import { LocaleProvider } from './i18n'
import type { SystemDetail } from './types'
import { blankAnswer } from './supplierAnswers'

afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear() })

it('fills and saves the reusable Demo exception and can undo to the authored draft', async () => {
  const detail = fixture()
  detail.prd!.data.requirements[0] = { ...detail.prd!.data.requirements[0], origin: 'control',
    description: '当进行远程管理时，应采取必要措施防止鉴别信息在网络传输过程中被窃听。' }
  detail.round!.draft = { 'REQ-1': { ...blankAnswer(), limitations: '用户原有说明' } }
  const fetcher = vi.fn(async (_url, init) => init?.method === 'PUT' ? { ok: true, json: async () => detail } : { ok: true, text: async () => '# PRD' })
  vi.stubGlobal('fetch', fetcher)
  show(detail)
  fireEvent.click(screen.getByRole('button', { name: '一键填入 Demo' }))
  fireEvent.click(screen.getByRole('button', { name: /控制需求/ }))
  expect(screen.getByText('无法完成 · 待负责人判断')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))
  await waitFor(() => expect(fetcher.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(true))
  const saved = JSON.parse(fetcher.mock.calls.find(([, init]) => init?.method === 'PUT')![1].body).answers['REQ-1']
  expect(saved).toMatchObject({ implementation_status: 'no', duration_workdays: 20 })
  expect(saved.limitations).toContain('演示场景')
  expect(saved.alternative).toContain('停用')
  fireEvent.click(screen.getByRole('button', { name: '撤销填入' }))
  fireEvent.click(screen.getByRole('button', { name: /需要澄清 · 查看说明/ }))
  expect(screen.getByLabelText('无法或部分完成的原因／待澄清内容（必填）')).toHaveValue('用户原有说明')
})

function fixture(): SystemDetail {
  return {
    system: { id: 's', name: 'Offline service', status: 'VENDOR_FILLING', version: 1, revision: 1,
      context: {}, draft: {}, classification: {}, created_at: 0, updated_at: 0 },
    controls: [], baseline: null, report: null,
    prd: { id: 'prd', content_hash: 'hash', approved: true, language: 'zh', mode: 'local', data: {
      title: '已发布 PRD', summary: '保留业务原文', assumptions: [], open_questions: [], requirements: [{
        id: 'REQ-1', title: '身份认证', description: '拒绝匿名请求', origin: 'business', priority: 'must',
        source_context_item_ids: ['F1'], source_control_ids: [], dependencies: [], acceptance_criteria: ['匿名请求返回 403'],
      }],
    } },
    round: { id: 'r', supplier_org_id: 'supplier', status: 'open', version: 1, draft: {} },
  }
}

function show(detail: SystemDetail, agreement = false) {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><LocaleProvider><AuthContext.Provider value={{
    user: { id: 'vendor', name: 'Supplier', email: 'demo@example.test', role: 'vendor', org_id: 'supplier' }, csrf: '', model_configured: false,
  }}><MemoryRouter>{agreement ? <AgreementPanel detail={detail} /> : <PrdPanel detail={detail} />}</MemoryRouter></AuthContext.Provider></LocaleProvider></QueryClientProvider>)
}

it('allows supplier inline PRD checkboxes and exceptions, saving reasons against the same requirement', async () => {
  const detail = fixture()
  const fetcher = vi.fn().mockImplementation(async (_url, init) => init?.method === 'PUT'
    ? { ok: true, json: async () => detail }
    : { ok: true, text: async () => '# 原始 PRD' })
  vi.stubGlobal('fetch', fetcher)
  show(detail)
  expect(screen.queryByRole('textbox', { name: /无法或部分/ })).not.toBeInTheDocument()
  expect(screen.getByText('匿名请求返回 403')).not.toBeVisible()
  fireEvent.click(screen.getByText('验收条件与来源'))
  expect(screen.getByText('匿名请求返回 403')).toBeVisible()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  fireEvent.click(screen.getByLabelText('可以按本项要求完成'))
  expect(screen.getByRole('button', { name: '提交答复' })).toBeEnabled()
  expect(screen.queryByLabelText('可完成性或例外')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /有例外或需要澄清/ }))
  fireEvent.change(screen.getByLabelText('可完成性或例外'), { target: { value: 'partial' } })
  fireEvent.change(screen.getByLabelText('无法或部分完成的原因／待澄清内容（必填）'), { target: { value: '旧接口需分期改造' } })
  fireEvent.change(screen.getByLabelText('补偿性措施（选填）'), { target: { value: '先保护新接口' } })
  fireEvent.change(screen.getByLabelText('预计天数（工作日，选填）'), { target: { value: '10' } })
  expect(screen.getByRole('button', { name: '提交答复' })).toBeEnabled()
  fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))
  await waitFor(() => expect(fetcher).toHaveBeenCalledWith('/api/v1/systems/s/supplier-draft', expect.objectContaining({
    method: 'PUT', body: expect.stringContaining('旧接口需分期改造'),
  })))
  const call = fetcher.mock.calls.find(([, init]) => init?.method === 'PUT')
  expect(JSON.parse(call![1].body).answers['REQ-1'].implementation_status).toBe('partial')
})

it('makes submitted supplier responses read-only', () => {
  const detail = fixture()
  detail.system.status = 'RESULT_REVIEW'
  detail.round!.status = 'submitted'
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => '# PRD' }))
  show(detail)
  expect(screen.getByLabelText('可以按本项要求完成')).toBeDisabled()
  expect(screen.queryByRole('button', { name: '提交答复' })).not.toBeInTheDocument()
})

it('offers a final document only after both parties confirm', () => {
  const detail = fixture()
  detail.system.status = 'FINAL_CONFIRMATION'
  detail.baseline = { id: 'b', finalized: false, content_hash: 'same-hash', confirmations: [{ party: 'customer', actor_id: 'customer', created_at: 1 }] }
  show(detail, true)
  expect(screen.queryByRole('link', { name: '下载双方确认最终稿' })).not.toBeInTheDocument()
  cleanup()
  detail.baseline.confirmations.push({ party: 'supplier', actor_id: 'vendor', created_at: 2 })
  show(detail, true)
  expect(screen.getByRole('link', { name: '下载双方确认最终稿' })).toHaveAttribute('href', '/api/v1/baselines/b/document')
})


it('saves a checkbox-only commitment and bulk fill preserves previously answered items', async () => {
  const detail = fixture()
  detail.prd!.data.requirements.push({ ...detail.prd!.data.requirements[0], id: 'REQ-2', title: '审计日志' })
  const fetcher = vi.fn(async (_url, init) => init?.method === 'PUT' ? { ok: true, json: async () => detail } : { ok: true, text: async () => '# PRD' })
  vi.stubGlobal('fetch', fetcher)
  show(detail)
  fireEvent.click(within(screen.getByRole('article', { name: 'REQ-1 身份认证' })).getByLabelText('可以按本项要求完成'))
  fireEvent.click(screen.getByRole('button', { name: '批量填写空白答复' }))
  fireEvent.change(screen.getByLabelText('可实现性'), { target: { value: 'needs_clarification' } })
  fireEvent.change(screen.getByLabelText('限制或澄清（必填）'), { target: { value: '请负责人确认日志范围' } })
  fireEvent.click(screen.getByRole('button', { name: '填入空白答复' }))
  fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))
  await waitFor(() => expect(fetcher.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(true))
  const call = fetcher.mock.calls.find(([, init]) => init?.method === 'PUT')!
  const answers = JSON.parse(call[1].body).answers
  expect(answers['REQ-1']).toMatchObject({ implementation_status: 'yes', duration_workdays: null, owner_name: '', implementation_plan: '' })
  expect(answers['REQ-2']).toMatchObject({ implementation_status: 'needs_clarification', limitations: '请负责人确认日志范围' })
  expect(screen.getByRole('button', { name: '提交答复' })).toBeEnabled()
})

it('groups by pinned domain and filters unanswered requirements without losing edits or global progress', () => {
  const detail = fixture()
  const base = detail.prd!.data.requirements[0]
  detail.prd!.data.requirements = [
    { ...base, origin: 'control', source_control_ids: ['C1'] },
    { ...base, id: 'REQ-2', title: '审计日志', origin: 'control', source_control_ids: ['C2'] },
  ]
  detail.prd!.requirement_domains = { 'REQ-1': ['安全计算环境'], 'REQ-2': ['安全管理中心'] }
  detail.prd!.high_risk_requirements = ['REQ-1']
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => '# PRD' }))
  show(detail)
  fireEvent.click(screen.getByRole('button', { name: /控制需求/ }))
  expect(screen.getAllByRole('article', { name: /REQ-/ })).toHaveLength(2)
  const rail = within(screen.getByRole('navigation', { name: '控制域筛选' }))
  expect(within(screen.getByRole('article', { name: 'REQ-1 身份认证' })).getByText('高风险')).toBeVisible()
  expect(within(screen.getByRole('article', { name: 'REQ-2 审计日志' })).queryByText('高风险')).not.toBeInTheDocument()
  fireEvent.click(rail.getByRole('button', { name: /安全计算环境/ }))
  expect(rail.getByRole('button', { name: /安全计算环境/ })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getAllByRole('article', { name: /REQ-/ })).toHaveLength(1)
  fireEvent.click(screen.getByLabelText('可以按本项要求完成'))
  expect(screen.getByRole('button', { name: /控制需求 · 1 \/ 2/ })).toBeVisible()
  expect(rail.getByRole('button', { name: /安全计算环境/ })).toHaveTextContent('1 / 1')
  expect(within(screen.getByRole('article', { name: 'REQ-1 身份认证' })).getByText('高风险')).toBeVisible()
  fireEvent.click(rail.getByRole('button', { name: /全部控制域/ }))
  fireEvent.click(screen.getByLabelText(/只看高风险/))
  expect(screen.getAllByRole('article', { name: /REQ-/ })).toHaveLength(1)
  fireEvent.click(rail.getByRole('button', { name: /安全管理中心/ }))
  expect(screen.getByText('没有符合筛选条件的需求。')).toBeVisible()
  fireEvent.click(rail.getByRole('button', { name: /全部控制域/ }))
  fireEvent.click(screen.getByLabelText(/只看高风险/))
  fireEvent.change(screen.getByLabelText('答复状态'), { target: { value: 'unanswered' } })
  expect(screen.queryByRole('article', { name: 'REQ-1 身份认证' })).not.toBeInTheDocument()
  expect(screen.getByRole('article', { name: 'REQ-2 审计日志' })).toBeVisible()
  fireEvent.change(screen.getByLabelText('答复状态'), { target: { value: 'all' } })
  fireEvent.change(screen.getByLabelText('搜索需求'), { target: { value: '身份认证' } })
  expect(screen.getByLabelText('可以按本项要求完成')).toBeChecked()
})

it('localizes risk and domain navigation without changing authored requirement text', () => {
  localStorage.setItem('scope-language', 'en')
  const detail = fixture()
  detail.prd!.high_risk_requirements = ['REQ-1']
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => '# PRD' }))
  show(detail)
  expect(screen.getByRole('navigation', { name: 'Filter by control domain' })).toBeVisible()
  expect(within(screen.getByRole('article', { name: 'REQ-1 身份认证' })).getByText('High risk')).toBeVisible()
  fireEvent.click(screen.getByLabelText(/High risk only/))
  expect(screen.getByText('拒绝匿名请求')).toBeVisible()
  expect(screen.getByText(/Showing 1 \/ 1/)).toHaveAttribute('role', 'status')
})

it.each(['zh', 'en'])('counts only cannot-deliver responses by domain, highlights them and updates after edits (%s)', language => {
  localStorage.setItem('scope-language', language)
  const en = language === 'en'
  const detail = fixture()
  const base = detail.prd!.data.requirements[0]
  detail.prd!.data.requirements = Array.from({ length: 5 }, (_, i) => ({ ...base, id: `REQ-${i + 1}`, title: `条目${i + 1}`, origin: 'control' }))
  detail.prd!.requirement_domains = { 'REQ-1': ['域A'], 'REQ-2': ['域A'], 'REQ-3': ['域A'], 'REQ-4': ['域B'], 'REQ-5': ['域B'] }
  detail.prd!.high_risk_requirements = ['REQ-5']
  detail.round!.draft = {
    'REQ-1': { ...blankAnswer(), implementation_status: 'no', limitations: '已有原因' },
    'REQ-2': { ...blankAnswer(), implementation_status: 'no' },
    'REQ-3': { ...blankAnswer(), implementation_status: 'partial', limitations: '部分完成' },
    'REQ-4': { ...blankAnswer(), limitations: '待澄清' },
    'REQ-5': { ...blankAnswer(), implementation_status: 'yes' },
  }
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => '# PRD' }))
  show(detail)
  fireEvent.click(screen.getByRole('button', { name: en ? /Control requirements/ : /控制需求/ }))
  const rail = within(screen.getByRole('navigation', { name: en ? 'Filter by control domain' : '控制域筛选' }))
  const domainA = within(rail.getByRole('button', { name: /域A/ }))
  expect(domainA.getByRole('img', { name: en ? '2 need attention' : '需关注 2 项' })).toHaveTextContent('2')
  expect(within(rail.getByRole('button', { name: /域B/ })).queryByRole('img')).not.toBeInTheDocument()
  expect(screen.getByRole('article', { name: 'REQ-1 条目1' })).toHaveClass('needs-attention')
  expect(screen.getByRole('article', { name: 'REQ-2 条目2' })).toHaveClass('needs-attention')
  expect(screen.getByRole('article', { name: 'REQ-3 条目3' })).not.toHaveClass('needs-attention')
  fireEvent.change(screen.getByLabelText(en ? 'Search requirements' : '搜索需求'), { target: { value: '条目3' } })
  expect(domainA.getByRole('img')).toHaveTextContent('2') // Full-domain count survives filters.
  fireEvent.change(screen.getByLabelText(en ? 'Search requirements' : '搜索需求'), { target: { value: '' } })
  fireEvent.change(screen.getByLabelText(en ? 'Response status' : '答复状态'), { target: { value: 'no' } })
  expect(screen.getAllByRole('article', { name: /REQ-/ })).toHaveLength(2)
  fireEvent.click(within(screen.getByRole('article', { name: 'REQ-1 条目1' })).getByLabelText(en ? 'Can deliver this requirement' : '可以按本项要求完成'))
  expect(domainA.getByRole('img')).toHaveTextContent('1')
  expect(screen.queryByRole('article', { name: 'REQ-1 条目1' })).not.toBeInTheDocument()
  fireEvent.click(within(screen.getByRole('article', { name: 'REQ-2 条目2' })).getByLabelText(en ? 'Can deliver this requirement' : '可以按本项要求完成'))
  expect(rail.queryByRole('img')).not.toBeInTheDocument()
  fireEvent.change(screen.getByLabelText(en ? 'Response status' : '答复状态'), { target: { value: 'all' } })
  expect(screen.getByRole('article', { name: 'REQ-2 条目2' })).not.toHaveClass('needs-attention')
})

it('counts and highlights high-risk clarification, partial and unanswered items using the same attention filter', () => {
  const detail = fixture()
  const base = detail.prd!.data.requirements[0]
  detail.prd!.data.requirements = Array.from({ length: 5 }, (_, i) => ({ ...base, id: `REQ-${i + 1}`, title: `条目${i + 1}`, origin: 'control' }))
  detail.prd!.requirement_domains = { 'REQ-1': ['域A'], 'REQ-2': ['域A'], 'REQ-3': ['域B'], 'REQ-4': ['域B'], 'REQ-5': ['域B'] }
  detail.prd!.high_risk_requirements = ['REQ-2', 'REQ-3', 'REQ-4', 'REQ-5']
  detail.round!.draft = {
    'REQ-1': { ...blankAnswer(), implementation_status: 'no', limitations: '无法交付' },
    'REQ-2': { ...blankAnswer(), limitations: '请确认防护责任' },
    'REQ-3': { ...blankAnswer(), implementation_status: 'partial', limitations: '只能覆盖新接口' },
    'REQ-5': { ...blankAnswer(), implementation_status: 'yes' },
  }
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => '# PRD' }))
  show(detail)
  fireEvent.click(screen.getByRole('button', { name: /控制需求/ }))
  const rail = within(screen.getByRole('navigation', { name: '控制域筛选' }))
  const total = within(rail.getByRole('button', { name: /全部控制域/ }))
  expect(total.getByRole('img')).toHaveTextContent('4')
  expect(within(rail.getByRole('button', { name: /域A/ })).getByRole('img')).toHaveTextContent('2')
  expect(within(rail.getByRole('button', { name: /域B/ })).getByRole('img')).toHaveTextContent('2')
  for (const id of [1, 2, 3, 4]) expect(screen.getByRole('article', { name: `REQ-${id} 条目${id}` })).toHaveClass('needs-attention')
  expect(screen.getByRole('article', { name: 'REQ-5 条目5' })).not.toHaveClass('needs-attention')
  expect(within(screen.getByRole('article', { name: 'REQ-2 条目2' })).getByText('需要澄清 · 待负责人判断')).toBeVisible()
  fireEvent.change(screen.getByLabelText('答复状态'), { target: { value: 'attention' } })
  expect(screen.getAllByRole('article', { name: /REQ-/ })).toHaveLength(4)
  fireEvent.click(within(screen.getByRole('article', { name: 'REQ-2 条目2' })).getByLabelText('可以按本项要求完成'))
  expect(total.getByRole('img')).toHaveTextContent('3')
  expect(screen.queryByRole('article', { name: 'REQ-2 条目2' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByLabelText(/只看高风险/))
  expect(screen.getAllByRole('article', { name: /REQ-/ })).toHaveLength(2)
  expect(total.getByRole('img')).toHaveTextContent('3')
})
