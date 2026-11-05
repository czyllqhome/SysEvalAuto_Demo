import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import DeliveryWorkspace, { DeliveryStart } from './DeliveryWorkspace'
import { LocaleProvider, useLocale } from './i18n'
import { deliveryFixture } from '../evals/fixtures/delivery'
import { evidenceReadiness, isOverdue, type DeliveryBatch } from './deliveryModel'
import { stageTab } from './Workspace'

afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear() })
function Language() { const { setLocale } = useLocale(); return <button onClick={() => setLocale('en')}>English</button> }
function mount(batch = deliveryFixture(), start = false) {
  let current = structuredClone(batch)
  const fetcher = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null
    if (url.endsWith('/draft')) { const item = current.items.find(i => url.includes(i.id))!; item.draft = body.draft; item.version++; current.version++ }
    if (url.endsWith('/submissions')) { const item = current.items.find(i => url.includes(i.id))!; item.status = 'IN_REVIEW'; item.version++; current.version++ }
    const value = url.includes('/systems/') && url.endsWith('/delivery-batches') ? [current] : current
    return { ok: true, json: async () => structuredClone(value) }
  })
  vi.stubGlobal('fetch', fetcher)
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  render(<QueryClientProvider client={cache}><LocaleProvider><MemoryRouter initialEntries={['/delivery/delivery-demo']}><Language /><Routes><Route path="/delivery/:id" element={start ? <DeliveryStart systemId="system-demo" version={9} canManage /> : <DeliveryWorkspace />} /></Routes></MemoryRouter></LocaleProvider></QueryClientProvider>)
  return { fetcher, cache, replace: async (next: DeliveryBatch) => { current = next; await act(async () => { cache.setQueryData(['delivery', batch.id], next) }) } }
}
const filters = () => within(screen.getByRole('group', { name: '开发项状态筛选' }))

it('keeps totals and review input across filtering, collapse and language changes', async () => {
  mount()
  await screen.findByLabelText('审核依据')
  fireEvent.change(screen.getByLabelText('审核依据'), { target: { value: '保留我的核验说明' } })
  fireEvent.click(filters().getByRole('button', { name: /^已验收/ }))
  expect(screen.getByRole('progressbar', { name: '验收进度' })).toHaveAttribute('max', '4')
  expect(screen.getByRole('progressbar', { name: '验收进度' })).toHaveAttribute('value', '1')
  expect(screen.getByText(/筛选隐藏了尚未保存的输入/)).toBeInTheDocument()
  fireEvent.click(filters().getByRole('button', { name: /^全部开发项/ }))
  fireEvent.click(screen.getByRole('button', { name: /REQ-SEC-001.*收起/ }))
  fireEvent.click(screen.getByRole('button', { name: 'English' }))
  fireEvent.click(screen.getByRole('button', { name: /REQ-SEC-001.*Open item/ }))
  expect(screen.getByLabelText('Review rationale')).toHaveValue('保留我的核验说明')
  expect(screen.getByText('统一身份认证与账号生命周期管理')).toBeInTheDocument()
})

it('saves and submits once using the returned item version and the pinned source hash', async () => {
  const { fetcher } = mount(deliveryFixture(['read', 'upload']))
  await screen.findByLabelText('完成与证据说明')
  fireEvent.change(screen.getByLabelText('完成与证据说明'), { target: { value: '已补充完整测试与截图。' } })
  fireEvent.click(screen.getByRole('button', { name: '保存并提交验收' }))
  await waitFor(() => expect(fetcher).toHaveBeenCalledWith('/api/v1/delivery-items/i-changes/submissions', expect.objectContaining({ body: expect.any(String) })))
  const calls = fetcher.mock.calls.filter(([, init]) => init.method !== 'GET')
  expect(calls.map(([url]) => url)).toEqual(['/api/v1/delivery-items/i-changes/draft', '/api/v1/delivery-items/i-changes/submissions'])
  expect(JSON.parse(calls[0][1].body).version).toBe(7)
  expect(JSON.parse(calls[1][1].body)).toMatchObject({ version: 8, expected_source_hash: deliveryFixture().source_hash, language: 'zh' })
  expect(screen.queryByLabelText('结论')).not.toBeInTheDocument()
})

it('does not submit after a save conflict and retains supplier input through search', async () => {
  const { fetcher } = mount(deliveryFixture(['read', 'upload']))
  await screen.findByLabelText('完成与证据说明')
  fireEvent.change(screen.getByLabelText('完成与证据说明'), { target: { value: '不能丢失的新材料说明' } })
  fetcher.mockResolvedValueOnce({ ok: false, json: async () => ({ code: 'VERSION_CONFLICT' }) })
  fireEvent.click(screen.getByRole('button', { name: '保存并提交验收' }))
  await screen.findByText(/VERSION_CONFLICT/)
  expect(fetcher.mock.calls.some(([url]) => url.endsWith('/submissions'))).toBe(false)
  fireEvent.change(screen.getByLabelText('搜索开发项'), { target: { value: '不存在' } })
  expect(screen.getByText('没有符合条件的开发项')).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('搜索开发项'), { target: { value: '' } })
  expect(screen.getByLabelText('完成与证据说明')).toHaveValue('不能丢失的新材料说明')
})

it('removes a deselected attachment from criterion mappings and blocks incomplete submission', async () => {
  const { fetcher } = mount(deliveryFixture(['read', 'upload']))
  await screen.findByLabelText('完成与证据说明')
  fireEvent.click(screen.getByRole('checkbox', { name: /^本轮使用/ }))
  expect(screen.getByRole('button', { name: '保存并提交验收' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))
  await waitFor(() => expect(fetcher.mock.calls.some(([url]) => url.endsWith('/draft'))).toBe(true))
  const body = JSON.parse(fetcher.mock.calls.find(([url]) => url.endsWith('/draft'))![1].body)
  expect(body.draft.attachment_ids).toEqual([])
  expect(body.draft.criteria_evidence_map).toEqual({ 'AC-1': [], 'AC-2': [] })
})

it('requires every human criterion even when AI reports PASS and binds the review to the submission', async () => {
  const batch = deliveryFixture(); batch.items[0].submissions[0].ai!.output!.decision = 'PASS'
  const { fetcher } = mount(batch)
  await screen.findByLabelText('结论')
  fireEvent.change(screen.getByLabelText('结论'), { target: { value: 'PASS' } })
  fireEvent.change(screen.getByLabelText('审核依据'), { target: { value: '逐项核对本轮原始材料。' } })
  const save = screen.getByRole('button', { name: '保存审核结论' })
  expect(save).toBeDisabled()
  fireEvent.click(screen.getAllByRole('checkbox')[0]); expect(save).toBeDisabled()
  fireEvent.click(screen.getAllByRole('checkbox')[1]); fireEvent.click(save)
  await waitFor(() => expect(fetcher.mock.calls.some(([url]) => url.endsWith('/reviews'))).toBe(true))
  const body = JSON.parse(fetcher.mock.calls.find(([url]) => url.endsWith('/reviews'))![1].body)
  expect(body).toMatchObject({ version: 7, decision: 'PASS', submission_hash: 'manifest-review', source_hash: batch.source_hash })
  expect(body.criteria_results).toHaveLength(2)
  expect(screen.getByRole('button', { name: '完成本批交付审核' })).toBeDisabled()
})

it('retains a draft review but blocks using it against a newer immutable submission', async () => {
  const batch = deliveryFixture(), { replace } = mount(batch)
  await screen.findByLabelText('审核依据')
  fireEvent.change(screen.getByLabelText('审核依据'), { target: { value: '旧轮次的核验输入' } })
  const next = structuredClone(batch); next.items[0].submissions[0].manifest_hash = 'new-manifest'
  await replace(next)
  await screen.findByText(/已有新的证据提交/)
  expect(screen.getByLabelText('审核依据')).toHaveValue('旧轮次的核验输入')
  expect(screen.getByRole('button', { name: '保存审核结论' })).toBeDisabled()
  expect(screen.getByText(/已有新的证据提交/)).toBeInTheDocument()
})

it('opens the current system batch inline without automatically creating or submitting anything', async () => {
  const { fetcher } = mount(deliveryFixture(), true)
  await screen.findByLabelText('审核依据')
  expect(screen.queryByRole('button', { name: '开启交付证据跟踪' })).not.toBeInTheDocument()
  expect(fetcher.mock.calls.every(([, init]) => init.method === 'GET')).toBe(true)
  expect(stageTab('PENDING_DEVELOPMENT')).toBe('delivery')
})

it('keeps superseded sources read only and does not treat an empty scope as complete', async () => {
  const batch = deliveryFixture(); batch.status = 'SUPERSEDED'; batch.allowed_actions = ['read']
  const { replace } = mount(batch)
  await screen.findByText(/本批记录仅供查阅/)
  expect(screen.queryByLabelText('审核依据')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'AI 评估本轮证据' })).not.toBeInTheDocument()
  const empty = { ...batch, total: 0, approved: 0, items: [], status: 'ACTIVE', allowed_actions: ['read', 'complete'] }
  await replace(empty)
  expect(await screen.findByRole('button', { name: '完成本批交付审核' })).toBeDisabled()
  expect(screen.getByText(/无来源项/)).toBeInTheDocument()
})

it('validates file scope, coverage and dates and calculates overdue from commitments only', () => {
  const batch = deliveryFixture(), item = batch.items[0]
  expect(evidenceReadiness(item, item.draft, '2026-02-01').ready).toBe(true)
  expect(evidenceReadiness(item, { ...item.draft, system_version: 'different' }).scope).toBe(false)
  expect(evidenceReadiness(item, { ...item.draft, collected_on: '2026-02-30' }).metadata).toBe(false)
  expect(evidenceReadiness(item, { ...item.draft, collected_on: '2030-01-01' }, '2026-02-01').metadata).toBe(false)
  expect(isOverdue(item, batch, '2026-02-01')).toBe(true)
  expect(isOverdue(batch.items[2], batch, '2026-02-01')).toBe(false)
  expect(isOverdue(batch.items[3], batch, '2026-02-01')).toBe(false)
  expect(isOverdue(item, { ...batch, status: 'SUPERSEDED' }, '2026-02-01')).toBe(false)
})
