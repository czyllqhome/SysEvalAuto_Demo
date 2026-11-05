import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import App from './App'
import type { DashboardData } from './dashboardTypes'
import { LocaleProvider } from './i18n'

const data: DashboardData = {
  generated_at: 1793851200, organization: '原文组织 Original',
  summary: { total: 3, new: 2, existing: 1, in_progress: 2, complete: 1, agreed: 1, suppliers: 1, todos: 1, delivery_review: 0 },
  stages: [{ key: 'intake', count: 1 }, { key: 'review', count: 1 }, { key: 'complete', count: 1 }],
  remediation: { total: 3, overdue: 1, states: { closed: 1, accepted_risk: 1, awaiting_retest: 0, in_progress: 1, pending_approval: 0, unplanned: 0 }, risks: { high: 1, medium: 0, low: 0, unknown: 0 }, stale_assessments: 0 },
  suppliers: [{ id: 'supplier', name: '供应商原名 Original', systems: [{ id: 'system', name: '系统原文 Original', status: 'RESULT_REVIEW' }], awaiting_response: 0, awaiting_review: 1, agreed: 1, gaps: 3, closed: 1, overdue: 1 }],
  todos: [{ id: 'system', key: 'system', name: '系统原文 Original', status: 'RESULT_REVIEW', kind: 'assessment', href: '/systems/system', updated_at: 1793851200, count: 1, priority: 1 }],
  levels: [{ key: 'L2', count: 2 }, { key: 'unclassified', count: 1 }], departments: [{ name: '业务原文 Original', count: 2 }],
}
afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals() })

function setup({ admin = true, role = 'owner', path = '/', fail = false }: { admin?: boolean; role?: string; path?: string; fail?: boolean } = {}) {
  const fetcher = vi.fn(async (url: string, _options?: RequestInit) => {
    if (url.endsWith('/auth/session')) return new Response(JSON.stringify({ user: { id: 'admin', name: 'Admin', role, is_admin: admin, org_id: 'org' }, csrf: '', model_configured: false }))
    if (url.includes('/admin/dashboard?')) return new Response(JSON.stringify(fail ? { code: 'NETWORK_ERROR' } : data), { status: fail ? 500 : 200 })
    if (url.endsWith('/systems')) return new Response('[]')
    if (url.endsWith('/assessment-options')) return new Response(JSON.stringify({ projects: [], assets: [] }))
    throw new Error(`Unexpected request: ${url}`)
  })
  vi.stubGlobal('fetch', fetcher)
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><LocaleProvider><MemoryRouter initialEntries={[path]}><App /></MemoryRouter></LocaleProvider></QueryClientProvider>)
  return fetcher
}

it('lands admins on the dashboard and preserves authored names when switching language', async () => {
  const fetcher = setup()
  expect(await screen.findByRole('heading', { name: '管理工作台', level: 1 })).toBeVisible()
  const table = await screen.findByRole('table', { name: '供应商协同与整改明细' })
  expect(within(table).getByText('33%')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '供应商原名 Original' }))
  expect(screen.getAllByRole('link', { name: /系统原文 Original/ })).toHaveLength(2)
  expect(screen.getByRole('meter', { name: '供应商原名 Original 整改关闭率' })).toHaveAttribute('aria-valuenow', '1')
  fireEvent.click(screen.getByRole('button', { name: '切换为 English' }))
  expect(screen.getByRole('heading', { name: 'Management dashboard' })).toBeVisible()
  expect(screen.getByRole('button', { name: '供应商原名 Original' })).toBeVisible()
  expect(screen.getByText('业务原文 Original')).toBeVisible()
  expect(screen.getByText(/Accepted risks are separate/)).toBeVisible()
  expect(fetcher.mock.calls.every(([, options]) => !options || !(options as RequestInit).method || (options as RequestInit).method === 'GET')).toBe(true)
})

it.each(['owner', 'member', 'vendor'])('denies a non-admin %s direct dashboard access without fetching its data', async role => {
  const fetcher = setup({ admin: false, role, path: '/dashboard' })
  expect(await screen.findByRole('alert')).toHaveTextContent('仅系统管理员')
  expect(screen.queryByRole('link', { name: '管理工作台' })).not.toBeInTheDocument()
  expect(fetcher.mock.calls.some(([url]) => url.includes('/admin/dashboard'))).toBe(false)
})

it('applies scope and text filters, refreshes, and opens the existing creation dialog', async () => {
  const fetcher = setup()
  await screen.findByRole('table')
  fireEvent.click(screen.getByRole('button', { name: '现有系统' }))
  await waitFor(() => expect(fetcher.mock.calls.some(([url]) => url.includes('kind=existing'))).toBe(true))
  fireEvent.change(screen.getByRole('textbox', { name: '搜索系统或部门' }), { target: { value: '财务' } })
  await waitFor(() => expect(fetcher.mock.calls.some(([url]) => url.includes(`q=${encodeURIComponent('财务')}`) && url.includes('kind=existing'))).toBe(true))
  expect(screen.getByRole('link', { name: /评估总数 3/ })).toHaveAttribute('href', `/assessments?q=${encodeURIComponent('财务')}&kind=existing`)
  await waitFor(() => expect(screen.getByRole('button', { name: '刷新工作台' })).toBeEnabled())
  const before = fetcher.mock.calls.length
  fireEvent.click(screen.getByRole('button', { name: '刷新工作台' }))
  await waitFor(() => expect(fetcher.mock.calls.length).toBeGreaterThan(before))
  fireEvent.click(screen.getByRole('button', { name: '新建系统安全评估' }))
  expect(screen.getByRole('dialog', { name: '新建系统安全评估' })).toBeVisible()
  expect(screen.getByLabelText('系统类型')).toHaveValue('new')
})

it('shows a retryable error without presenting zero statistics as a successful response', async () => {
  setup({ fail: true })
  expect(await screen.findByRole('alert')).toBeVisible()
  expect(screen.getByRole('button', { name: '重新加载' })).toBeVisible()
  expect(screen.queryByRole('region', { name: '核心指标' })).not.toBeInTheDocument()
  expect(screen.queryByRole('table')).not.toBeInTheDocument()
})

it('retains the assessment ledger at a separate route for administrators', async () => {
  setup({ path: '/assessments' })
  expect(await screen.findByRole('heading', { name: '系统安全评估管理' })).toBeVisible()
  const nav = screen.getByRole('navigation', { name: '主导航' })
  expect(within(nav).getByRole('link', { name: '系统评估' })).toHaveAttribute('aria-current', 'page')
})

it('carries dashboard search and assessment type into the ledger', async () => {
  setup({ path: '/assessments?kind=existing&q=Original&active=true' })
  expect(await screen.findByLabelText('评估类型筛选')).toHaveValue('existing')
  expect(screen.getByRole('textbox', { name: '搜索评估' })).toHaveValue('Original')
  expect(screen.getByText('仅显示进行中的评估')).toBeVisible()
})
