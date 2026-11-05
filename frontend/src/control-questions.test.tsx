import { AuthContext } from './components'
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { LocaleProvider } from './i18n'
import ControlQuestions from './ControlQuestions'
import { ControlsPanel } from './discovery'
import type { SystemDetail } from './types'

afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals() })
const data = { version: 5, supported: true, pending_count: 1, facts: { 'ops.remote_admin': 'unknown' },
  config: { questions: [], profiles: [], domains: [], topics: [] },
  questions: [{ code: 'ops.remote_admin', group: 'operations', zh: '是否远程管理？', en: 'Remote administration?', kind: 'enum', values: ['yes', 'no', 'unknown'], when: true, affected_controls: ['REMOTE-1'] }] }
function mount(permissions = ['edit']) {
  const detail = { system: { id: 's1', version: 5, status: 'CONTROL_REVIEW' }, permissions } as SystemDetail
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><LocaleProvider><ControlQuestions detail={detail} pending={1} /></LocaleProvider></MemoryRouter></QueryClientProvider>)
}
it('submits explicit answers with the displayed revision and retains answers on conflict', async () => {
  const writes: unknown[] = []
  vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
    if (options?.method === 'PUT') {
      writes.push(JSON.parse(options.body))
      return new Response(JSON.stringify({ code: 'CLASSIFICATION_CHANGED' }), { status: 409 })
    }
    return new Response(JSON.stringify(data))
  }))
  mount()
  const field = await screen.findByLabelText('是否远程管理？')
  expect(field).toHaveAttribute('aria-required', 'true')
  expect(screen.getByText('保存答案并更新匹配')).toBeDisabled()
  expect(screen.getByText('REMOTE-1')).toBeInTheDocument()
  fireEvent.change(field, { target: { value: 'no' } })
  fireEvent.click(screen.getByText('保存答案并更新匹配'))
  await waitFor(() => expect(writes).toEqual([{ version: 5, answers: { 'ops.remote_admin': 'no' } }]))
  await screen.findByText('前往确认等级')
  expect(field).toHaveValue('no')
})
it('shows questions without allowing read-only users to edit them', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(data))))
  mount(['read'])
  expect(await screen.findByLabelText('是否远程管理？')).toBeDisabled()
  expect(screen.getByText('保存答案并更新匹配')).toBeDisabled()
})

it('switches between cards and domain rows without changing selections', async () => {
  const control = { id: 'c1', code: 'C1', domain: 'D1', levels: ['L2'], required: true, catalog_id: 'cat', included: true, origin: 'matched', translations: { zh: { title: '测试条目', description: '保留要求', verification: '核对' } } }
  const detail = { system: { id: 's1', name: 'Test', revision: 1, context: {}, draft: {}, created_at: 1, updated_at: 1, version: 1, status: 'CONTROL_REVIEW', context_revision_id: 'context', classification: { effective_level: 'L2' } }, controls: [control], permissions: ['read'], prd: null, round: null, report: null, baseline: null } as SystemDetail
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ items: [control], total: 1, domain_labels: { D1: ['测试控制域', 'Test domain'] } })))
  vi.stubGlobal('fetch', fetcher)
  render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><LocaleProvider><AuthContext.Provider value={{ user: { id: 'u', name: 'Reader', email: 'reader@example.com', org_id: 'org', role: 'member' }, csrf: '', model_configured: false }}><ControlsPanel detail={detail} /></AuthContext.Provider></LocaleProvider></MemoryRouter></QueryClientProvider>)
  await screen.findByText('测试条目')
  fireEvent.click(screen.getByRole('button', { name: '控制域 · 表格' }))
  expect(await screen.findByRole('heading', { name: /测试控制域/ })).toBeVisible()
  expect(document.querySelector('.control-domain-table-view')).not.toBeNull()
  expect(screen.getByRole('button', { name: '排除 测试条目' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: '卡片' }))
  expect(document.querySelector('.control-domain-table-view')).toBeNull()
  expect(fetcher.mock.calls.length).toBeGreaterThanOrEqual(2)
})


it('loads every catalog page before filtering and keeps all selected cloud controls in one collapsible domain', async () => {
  localStorage.setItem('control-layout', 'rows')
  const controls = Array.from({ length: 126 }, (_, i) => ({ id: `c${i}`, code: `C${i}`, domain: i < 3 || i >= 100 ? 'cloud' : 'other', levels: ['L2'], required: true, catalog_id: 'pinned', included: i < 3 || i >= 100, origin: 'matched', translations: { zh: { title: `控制${i}`, description: `要求${i}`, verification: '核对' } } }))
  const detail = { system: { id: 's1', name: 'Test', revision: 1, context: {}, draft: {}, created_at: 1, updated_at: 1, version: 1, status: 'CONTROL_REVIEW', context_revision_id: 'context', classification: { effective_level: 'L2' } }, controls, permissions: ['read'], prd: null, round: null, report: null, baseline: null } as SystemDetail
  const requested: number[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const page = Number(new URL(url, 'http://localhost').searchParams.get('page'))
    requested.push(page)
    return new Response(JSON.stringify({ items: controls.slice((page - 1) * 100, page * 100), total: controls.length, domain_labels: { cloud: ['云计算安全扩展要求', 'Cloud'], other: ['其他域', 'Other'] } }))
  }))
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><LocaleProvider><AuthContext.Provider value={{ user: { id: 'u', name: 'Reader', email: 'reader@example.com', org_id: 'org', role: 'member' }, csrf: '', model_configured: false }}><ControlsPanel detail={detail} /></AuthContext.Provider></LocaleProvider></MemoryRouter></QueryClientProvider>)
  await screen.findByText('控制125')
  expect(screen.getByLabelText('选择状态')).toHaveValue('selected')
  expect(requested).toEqual([1, 2])
  expect(screen.getByRole('table', { name: '云计算安全扩展要求' }).querySelectorAll('tbody tr')).toHaveLength(29)
  expect(screen.queryByRole('table', { name: '其他域' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '下一页' })).not.toBeInTheDocument()
  const heading = screen.getByRole('button', { name: /云计算安全扩展要求 \(29\)/ })
  fireEvent.click(heading)
  expect(heading).toHaveAttribute('aria-expanded', 'false')
  expect(screen.getByText('要求125')).not.toBeVisible()
  fireEvent.click(heading)
  expect(screen.getByText('要求125')).toBeVisible()
  expect(screen.getAllByRole('button', { name: /^排除 控制/ })).toHaveLength(29)
  fireEvent.change(screen.getByLabelText('选择状态'), { target: { value: 'excluded' } })
  expect(screen.getByRole('table', { name: '其他域' }).querySelectorAll('tbody tr')).toHaveLength(97)
  expect(requested).toEqual([1, 2])
})

it.each([false, true])('bounds parallel catalog loading and handles navigation away (%s)', async leave => {
  localStorage.setItem('control-layout', 'rows')
  const controls = Array.from({ length: 410 }, (_, i) => ({ id: `c${i}`, code: `C${i}`, domain: 'cloud', levels: ['L2'], required: true, catalog_id: 'pinned', included: i === 0 || i === 409, origin: 'matched', translations: { zh: { title: `控制${i}`, description: `要求${i}`, verification: '核对' } } }))
  const detail = { system: { id: 's1', name: 'Test', revision: 1, context: {}, draft: {}, created_at: 1, updated_at: 1, version: 1, status: 'CONTROL_REVIEW', context_revision_id: 'context', classification: { effective_level: 'L2', catalog_id: 'pinned' } }, controls, permissions: ['read'], prd: null, round: null, report: null, baseline: null } as SystemDetail
  const requested: number[] = [], signals: AbortSignal[] = []
  const complete: Record<number, () => void> = {}
  vi.stubGlobal('fetch', vi.fn((url: string, options: RequestInit) => {
    const page = Number(new URL(url, 'http://localhost').searchParams.get('page'))
    requested.push(page)
    signals.push(options.signal as AbortSignal)
    const response = () => new Response(JSON.stringify({ items: controls.slice((page - 1) * 100, page * 100), total: controls.length, domain_labels: { cloud: ['云计算安全扩展要求', 'Cloud'] } }))
    return page >= 2 && page <= 4 ? new Promise<Response>(resolve => { complete[page] = () => resolve(response()) }) : Promise.resolve(response())
  }))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const mounted = render(<QueryClientProvider client={client}><MemoryRouter><LocaleProvider><AuthContext.Provider value={{ user: { id: 'u', name: 'Reader', email: 'reader@example.com', org_id: 'org', role: 'member' }, csrf: '', model_configured: false }}><ControlsPanel detail={detail} /></AuthContext.Provider></LocaleProvider></MemoryRouter></QueryClientProvider>)
  await waitFor(() => expect(requested).toEqual([1, 2, 3, 4]))
  expect(screen.queryByText('控制0')).not.toBeInTheDocument()
  if (leave) mounted.unmount()
  await act(async () => { complete[4](); complete[3](); complete[2]() })
  if (leave) {
    expect(signals.every(signal => signal.aborted)).toBe(true)
    expect(requested).toEqual([1, 2, 3, 4])
  } else {
    await screen.findByText('控制409')
    expect(requested).toEqual([1, 2, 3, 4, 5])
    expect(screen.getByRole('table', { name: '云计算安全扩展要求' }).querySelectorAll('tbody tr')).toHaveLength(2)
  }
  client.clear()
})
