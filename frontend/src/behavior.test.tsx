import { fireEvent, render, screen, cleanup, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { DiscoveryPanel, recommend } from './discovery'
import { BriefReviewPanel } from './BriefReview'
import { emptyBrief } from './brief'
import { answerComplete } from './downstream'
import { AuthContext, Modal, Preferences } from './components'
import { LocaleProvider, statuses, topicData, translateError, useLocale } from './i18n'
import type { Session, SystemDetail } from './types'
import App from './App'

const detail: SystemDetail = { system: { id: 'test-system', name: 'Original system', status: 'DRAFT', version: 1, revision: 1,
  context: {}, classification: {}, draft: { blocks: { goal: '原始业务描述 must remain unchanged' } }, created_at: 1, updated_at: 1 },
  controls: [], prd: null, round: null, report: null, baseline: null }
const session: Session = { user: { id: 'owner', name: 'Owner', email: 'owner@example.test', org_id: 'org', role: 'owner' }, csrf: 'test', model_configured: false }
function Toggle() {
  const { locale, setLocale } = useLocale()
  return <button onClick={() => setLocale(locale === 'zh' ? 'en' : 'zh')}>Switch</button>
}
function Harness() {
  const query = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={query}><LocaleProvider><AuthContext.Provider value={session}><Preferences><MemoryRouter><Toggle /><DiscoveryPanel detail={detail} /></MemoryRouter></Preferences></AuthContext.Provider></LocaleProvider></QueryClientProvider>
}
afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('bilingual interactions', () => {
  it('switches interface labels without translating authored business input', () => {
    render(<Harness />)
    expect(screen.getByLabelText('建设目标')).toHaveValue('原始业务描述 must remain unchanged')
    fireEvent.click(screen.getByText('Switch'))
    expect(screen.getByLabelText('Purpose')).toHaveValue('原始业务描述 must remain unchanged')
    expect(document.documentElement.lang).toBe('en')
    expect(screen.getByRole('button', { name: 'Continue to brief review' })).toBeEnabled()
    expect(screen.queryByLabelText('Goal summary')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('Switch'))
    expect(screen.getByLabelText('建设目标')).toHaveValue('原始业务描述 must remain unchanged')
    expect(document.documentElement.lang).toBe('zh-CN')
  })

  it('requires explicit review before context confirmation', () => {
    const client = new QueryClient()
    const reviewDetail: SystemDetail = { ...detail, system: { ...detail.system, status: 'CONTEXT_REVIEW', classification: { effective_level: 'L2' }, draft: { ...detail.system.draft, proposal: { ...emptyBrief(), summary: 'Service portal', functions: [{ id: 'F-1', title: 'Create tickets', description: 'Create tickets', source_blocks: ['functions'] }], departments: ['Service'], roles: ['Operator'], owner_role: 'Service owner', scope: 'Tickets only' } } } }
    render(<QueryClientProvider client={client}><LocaleProvider><AuthContext.Provider value={session}><Preferences><MemoryRouter><BriefReviewPanel detail={reviewDetail} /></MemoryRouter></Preferences></AuthContext.Provider></LocaleProvider></QueryClientProvider>)
    expect(screen.getByRole('button', { name: '确认说明并匹配控制' })).toBeDisabled()
    fireEvent.click(screen.getByLabelText('我已核对说明和职责'))
    expect(screen.getByRole('button', { name: '确认说明并匹配控制' })).toBeEnabled()
  })

  it('offers all discovery topics and workflow statuses in both languages', () => {
    for (const topic of topicData) {
      expect(topic.label.every(text => text.length > 0)).toBe(true)
      expect(topic.prompt.every(text => text.length > 0)).toBe(true)
    }
    expect(statuses.PENDING_DEVELOPMENT).toEqual(['待开发', 'Ready for development'])
    expect(translateError('MODEL_NOT_CONFIGURED', 'en')).toContain('Local draft')
    expect(translateError('MODEL_PROVIDER_UNAVAILABLE', 'zh')).toContain('提供商标识')
    expect(translateError('MODEL_PROVIDER_UNAVAILABLE', 'en')).toContain('provider slugs')
    expect(translateError('MODEL_REFUSED', 'en')).toContain('explicitly refused')
    expect(translateError('MODEL_OUTPUT_TRUNCATED', 'zh')).toContain('输出上限')
    expect(translateError('MODEL_OUTPUT_TRUNCATED', 'en')).toContain('output limit')
    expect(translateError('UNKNOWN_CODE', 'zh')).not.toContain('UNKNOWN_CODE')
  })
})

it('restores dialog focus and supports Escape without trapping the user', () => {
  function Demo() {
    const [open, setOpen] = useState(false)
    return <LocaleProvider><button onClick={() => setOpen(true)}>Open</button>{open && <Modal title="Dialog" close={() => setOpen(false)}><input aria-label="Name" /></Modal>}</LocaleProvider>
  }
  render(<Demo />)
  const open = screen.getByRole('button', { name: 'Open' })
  open.focus(); fireEvent.click(open)
  expect(screen.getByRole('dialog')).toBeVisible()
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(open).toHaveFocus()
})

it('does not offset a critical answer and treats missing information as provisional', () => {
  expect(recommend({ Q1: 'L1', Q2: 'L1', Q3: 'L3', Q4: 'L1', Q5: 'L1' })).toBe('L3')
  expect(recommend({})).toBe('L2')
})

it('does not enable supplier submission for incomplete or reversed-date commitments', () => {
  expect(answerComplete({ implementation_status: 'yes', duration_workdays: 5, owner_name: '', implementation_plan: 'Build', limitations: '', alternative: '' })).toBe(false)
  expect(answerComplete({ implementation_status: 'no', duration_workdays: null, owner_name: '', implementation_plan: '', limitations: 'Not supported', alternative: '' })).toBe(true)
  expect(answerComplete({ implementation_status: 'yes', duration_workdays: 5, owner_name: 'Owner', implementation_plan: 'Build', limitations: '', alternative: '', estimated_start_date: '2026-10-10', estimated_finish_date: '2026-10-01' })).toBe(false)
})

it('returns to login and removes business data from the cache on logout', async () => {
  let signedIn = true
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('/auth/logout')) { signedIn = false; return new Response(JSON.stringify({ ok: true })) }
    if (url.endsWith('/auth/session')) return new Response(JSON.stringify(signedIn ? session : { code: 'AUTH_REQUIRED' }), { status: signedIn ? 200 : 401 })
    return new Response(JSON.stringify([]))
  }))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['private-system'], { secret: 'customer-only-business-data' })
  render(<QueryClientProvider client={client}><LocaleProvider><MemoryRouter><App /></MemoryRouter></LocaleProvider></QueryClientProvider>)
  await screen.findByRole('button', { name: '退出登录' })
  fireEvent.click(screen.getByRole('button', { name: '退出登录' }))
  await waitFor(() => expect(screen.getByRole('button', { name: '登录工作空间' })).toBeVisible())
  expect(client.getQueryData(['session'])).toBeNull()
  expect(client.getQueryData(['private-system'])).toBeUndefined()
})
it('labels an administrator independently of the legacy owner type in both languages', async () => {
  const adminSession = { ...session, user: { ...session.user, name: 'Administration', is_admin: true } }
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith('/auth/session') ? adminSession : []))))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><LocaleProvider><MemoryRouter><App /></MemoryRouter></LocaleProvider></QueryClientProvider>)
  expect(await screen.findByText('Administration')).toBeVisible()
  expect(screen.getByText('系统管理员')).toBeVisible()
  expect(screen.queryByText('客户负责人')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '切换为 English' }))
  expect(screen.getByText('Administrator')).toBeVisible()
  expect(screen.getByText('Administration')).toBeVisible()
  expect(screen.queryByText('Customer owner')).not.toBeInTheDocument()
})

it.each([true, false])('restricts assessment deletion to admin=%s and confirms before sending', async (admin) => {
  let deleted = false
  const row = { id: 'delete-target', name: 'Deletion target', status: 'DRAFT', revision: 1, version: 7, updated_at: 1, department: '', level: null }
  const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
    if (url.endsWith('/auth/session')) return new Response(JSON.stringify({ ...session, user: { ...session.user, is_admin: admin } }))
    if (options?.method === 'DELETE') { deleted = true; return new Response(JSON.stringify({ deleted: true })) }
    return new Response(JSON.stringify(url.endsWith('/systems') && !deleted ? [row] : []))
  })
  vi.stubGlobal('fetch', fetcher)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><LocaleProvider><MemoryRouter><App /></MemoryRouter></LocaleProvider></QueryClientProvider>)
  await screen.findByText('Deletion target')
  if (!admin) { expect(screen.queryByRole('button', { name: '删除评估 Deletion target' })).not.toBeInTheDocument(); return }
  fireEvent.click(screen.getByRole('button', { name: '删除评估 Deletion target' }))
  expect(deleted).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: '取消' }))
  expect(deleted).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: '删除评估 Deletion target' }))
  fireEvent.click(screen.getByRole('button', { name: '确认删除' }))
  await waitFor(() => expect(screen.queryByText('Deletion target')).not.toBeInTheDocument())
  expect(fetcher).toHaveBeenCalledWith('/api/v1/systems/delete-target', expect.objectContaining({ method: 'DELETE', body: JSON.stringify({ version: 7 }) }))
})
