import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import App from './App'
import { LocaleProvider } from './i18n'
import type { User } from './types'

afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals() })

function setup(user: Partial<User> = {}, path = '/rbac') {
  const session = { user: { id: 'admin', name: '原始姓名 Admin', email: 'admin@example.test', org_id: 'org', role: 'owner', is_admin: true, ...user }, csrf: '', model_configured: false }
  const fetcher = vi.fn(async (url: string) => {
    if (url.endsWith('/auth/session')) return new Response(JSON.stringify(session))
    if (url.endsWith('/systems')) return new Response('[]')
    throw new Error(`Unexpected request: ${url}`)
  })
  vi.stubGlobal('fetch', fetcher)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><LocaleProvider><MemoryRouter initialEntries={[path]}><App /></MemoryRouter></LocaleProvider></QueryClientProvider>)
  return fetcher
}

it('opens the matrix from admin navigation and switches its copy without rewriting the user name', async () => {
  const fetcher = setup({}, '/assessments')
  const nav = await screen.findByRole('navigation', { name: '主导航' })
  fireEvent.click(within(nav).getByRole('link', { name: 'RBAC 职责矩阵' }))
  expect(screen.getByRole('heading', { name: 'RBAC 职责矩阵', level: 1 })).toBeVisible()
  expect(within(nav).getByRole('link', { name: 'RBAC 职责矩阵' })).toHaveAttribute('aria-current', 'page')
  const table = screen.getByRole('table', { name: '业务操作权限矩阵' })
  expect(within(table).getAllByRole('columnheader').map(cell => cell.textContent)).toEqual(['业务操作 / 职责', '系统管理员', '负责人', '经办人', '评审人', '只读成员', '供应商'])
  expect(screen.getByRole('link', { name: '管理人员与权限' })).toHaveAttribute('href', '/team')

  fireEvent.click(screen.getByRole('button', { name: '切换为 English' }))
  expect(screen.getByRole('heading', { name: 'RBAC responsibility matrix', level: 1 })).toBeVisible()
  expect(screen.getByRole('table', { name: 'Business action permissions' })).toBeVisible()
  expect(screen.getByText('原始姓名 Admin')).toBeVisible()
  expect(screen.getByRole('link', { name: 'RBAC matrix' })).toHaveAttribute('aria-current', 'page')
  expect(screen.getByText(/Both parties must independently confirm the same baseline content hash/)).toBeVisible()
  expect(fetcher.mock.calls.every(([url]) => ['/api/v1/auth/session', '/api/v1/systems'].includes(url))).toBe(true)
})

it.each([
  { role: 'owner', organization_role: 'manager' },
  { role: 'member', organization_role: 'reviewer' },
  { role: 'vendor', organization_role: 'supplier' },
] as const)('blocks direct matrix access for a non-admin $organization_role', async user => {
  const fetcher = setup({ ...user, is_admin: false })
  expect(await screen.findByRole('alert')).toHaveTextContent('仅系统管理员可以查看 RBAC 职责矩阵')
  expect(screen.queryByRole('link', { name: 'RBAC 职责矩阵' })).not.toBeInTheDocument()
  expect(screen.queryByRole('table')).not.toBeInTheDocument()
  expect(fetcher.mock.calls.every(([url]) => url === '/api/v1/auth/session')).toBe(true)
})

it('distinguishes customer approval, independent supplier confirmation and conditional delivery review', async () => {
  const fetcher = setup()
  const table = await screen.findByRole('table', { name: '业务操作权限矩阵' })
  function permissions(label: RegExp) {
    const row = within(table).getByRole('rowheader', { name: label }).closest('tr')!
    return within(row).getAllByRole('cell').map(cell => cell.textContent)
  }
  expect(permissions(/^审批 PRD/)).toEqual(['可执行', '可执行', '不授予', '有条件', '不授予', '不授予'])
  expect(permissions(/^冻结基线/)).toEqual(['可执行', '可执行', '不授予', '不授予', '不授予', '不授予'])
  expect(permissions(/^供应商独立确认/)).toEqual(['不授予', '不授予', '不授予', '不授予', '不授予', '可执行'])
  expect(permissions(/^审核交付证据/)).toEqual(['可执行', '可执行', '有条件', '有条件', '不授予', '不授予'])
  expect(screen.getByText(/单独授予评估经办角色不包含该权限/)).toBeVisible()
  expect(fetcher.mock.calls.every(([url]) => url === '/api/v1/auth/session')).toBe(true)
})
