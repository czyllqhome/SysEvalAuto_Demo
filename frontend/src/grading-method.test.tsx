import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import App from './App'
import { LocaleProvider } from './i18n'

afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals() })
function setup(admin = true, role = 'owner') {
  const fetcher = vi.fn(async (url: string) => {
    if (url !== '/api/v1/auth/session') throw new Error(`Unexpected request: ${url}`)
    return new Response(JSON.stringify({ user: { id: 'user', org_id: 'org', name: '姓名原文', role, is_admin: admin }, csrf: '', model_configured: false }))
  })
  vi.stubGlobal('fetch', fetcher)
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><LocaleProvider><MemoryRouter initialEntries={['/method']}><App /></MemoryRouter></LocaleProvider></QueryClientProvider>)
  return fetcher
}

it('shows the current matrix and concise guidance with RBAC in Rules and a separate Audit group in both languages', async () => {
  const fetcher = setup()
  const title = await screen.findByRole('heading', { name: '系统等级如何确定？' })
  const method = title.closest('.grading-method')!
  expect(method.querySelectorAll('.method-card')).toHaveLength(3)
  const rows = within(screen.getAllByRole('table')[0]).getAllByRole('row')
  expect(within(rows[1]).getAllByRole('cell').map(cell => cell.textContent)).toEqual(['1级', '2级', '3级'])
  expect(rows[1].querySelectorAll('td')[2]).toHaveClass('grade-3')
  expect(method).toHaveTextContent('本应用按 3 级计算')
  expect(method).not.toHaveTextContent('E09')
  expect(method).not.toHaveTextContent('E10')
  expect(method).not.toHaveTextContent('示例：')
  expect(method).not.toHaveTextContent('零损害与未知答案如何处理')
  expect(method).not.toHaveTextContent('从矩阵结果到初步建议')
  expect(method).not.toHaveTextContent('未知等级、网络入口、业务属性')
  const minima = screen.getAllByRole('table')[1]
  for (const [name, level] of [['D01：个人信息 0–9,999 人', '1级'], ['D01：个人信息 10,000–99,999 人', '2级'], ['D01：个人信息 100,000 人及以上', '3级']]) {
    expect(within(within(minima).getByRole('row', { name: `${name} ${level.replace('级', ' 级')}` })).getByRole('cell')).toHaveTextContent(level.replace('级', ' 级'))
  }
  const nav = screen.getByRole('navigation', { name: '主导航' })
  const group = (name: string) => within(nav).getByLabelText(name, { selector: 'section' })
  expect(within(group('规则')).getByRole('link', { name: 'RBAC 职责矩阵' })).toHaveAttribute('href', '/rbac')
  expect(within(group('审计')).getByRole('link', { name: '审计日志' })).toHaveAttribute('href', '/audit')
  expect(within(group('配置')).queryByRole('link', { name: 'RBAC 职责矩阵' })).not.toBeInTheDocument()
  expect(within(group('配置')).queryByRole('link', { name: '审计日志' })).not.toBeInTheDocument()
  expect(screen.queryByText('ASSESSMENT & SUPPLIER COLLABORATION')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '切换为 English' }))
  expect(screen.getByRole('heading', { name: 'How is the system grade determined?' })).toBeVisible()
  expect(within(within(minima).getByRole('row', { name: 'D01: personal information for 10,000–99,999 people 2 Level' })).getByRole('cell')).toHaveTextContent('2 Level')
  expect(within(within(minima).getByRole('row', { name: 'D01: personal information for 100,000 people or more 3 Level' })).getByRole('cell')).toHaveTextContent('3 Level')
  expect(within(group('Rules')).getByRole('link', { name: 'RBAC matrix' })).toBeVisible()
  expect(within(group('Audit')).getByRole('link', { name: 'Audit logs' })).toBeVisible()
  expect(screen.getByText('姓名原文')).toBeVisible()
  expect(fetcher.mock.calls.every(([url]) => url === '/api/v1/auth/session')).toBe(true)
})

it.each(['owner', 'vendor'])('keeps administrator-only rule and audit links hidden for a non-admin %s', async role => {
  setup(false, role)
  await screen.findByRole('heading', { name: '系统等级如何确定？' })
  expect(screen.queryByRole('link', { name: 'RBAC 职责矩阵' })).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: '审计日志' })).not.toBeInTheDocument()
  expect(screen.getByRole('navigation', { name: '主导航' }).querySelector('section[aria-label="审计"]')).not.toBeInTheDocument()
})
