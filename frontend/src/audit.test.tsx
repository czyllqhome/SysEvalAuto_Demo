import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, expect, it, vi } from 'vitest'
import { AuthContext } from './components'
import { LocaleProvider } from './i18n'
import AuditPage from './AuditPage'

function setup(admin = true) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('/team')) return new Response(JSON.stringify({ projects: [], users: [{ id: 'actor', name: '管理员' }] }))
    if (url.endsWith('/admin/audits/a')) return new Response(JSON.stringify({ id: 'a', action: 'project.created', actor_id: 'actor', created_at: 100, detail: { evidence: 'Only in details' } }))
    return new Response(JSON.stringify([{ id: 'a', action: 'project.created', actor_id: 'actor', created_at: 100 }]))
  }))
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><LocaleProvider><AuthContext.Provider value={{ user: { id: 'actor', name: 'Admin', email: 'test@example.test', role: 'owner', org_id: 'org', is_admin: admin }, csrf: '', model_configured: false }}><AuditPage /></AuthContext.Provider></LocaleProvider></QueryClientProvider>)
}
afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals() })

it('filters summaries on the server and fetches details only after selection', async () => {
  setup()
  await screen.findByText('project.created')
  expect(screen.queryByText(/Only in details/)).not.toBeInTheDocument()
  expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith('/audits/a'))).toBe(false)
  fireEvent.change(screen.getByLabelText('筛选审计操作'), { target: { value: 'project' } })
  fireEvent.change(screen.getByLabelText('操作人'), { target: { value: 'actor' } })
  fireEvent.change(screen.getByLabelText('开始日期'), { target: { value: '2026-10-01' } })
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('q=project&actor_id=actor') && String(url).includes('start='))).toBe(true))
  fireEvent.click(await screen.findByRole('button', { name: '查看详情' }))
  expect(await screen.findByText(/Only in details/)).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '关闭' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

it('does not request audit data for non-administrators', () => {
  setup(false)
  expect(screen.getByRole('alert')).toHaveTextContent('仅系统管理员可以查看日志')
  expect(fetch).not.toHaveBeenCalled()
})
