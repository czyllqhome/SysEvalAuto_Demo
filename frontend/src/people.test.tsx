import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import { AuthContext } from './components'
import { LocaleProvider, useLocale } from './i18n'
import People from './People'

const original = {
  users: [
    { id: 'admin', name: '管理员原文', username: 'admin', role: 'owner', organization_role: 'manager', is_admin: true, active: true },
    { id: 'operator', name: '业务经办 原文', username: 'operator', role: 'member', organization_role: 'operator', is_admin: false, active: true },
    { id: 'reviewer', name: '评审成员', username: 'reviewer', role: 'member', organization_role: 'reviewer', is_admin: false, active: false },
    { id: 'supplier', name: '供应商原文', username: 'supplier', role: 'vendor', organization_role: 'supplier', is_admin: false, active: true },
    { id: 'demo-supplier', name: '【演示】峰岚会员科技交付负责人', username: 'demo_supplier', role: 'vendor', organization_role: 'supplier', is_admin: false, active: false },
    { id: 'fictional-supplier', name: '【演示虚构】星途供应链科技', username: 'fictional_supplier', role: 'vendor', organization_role: 'supplier', is_admin: false, active: false },
  ],
  assessments: [{ id: 'assessment', name: '零售平台原文', version: 7, owner_id: 'admin', members: [{ user_id: 'operator', role: 'viewer' }] }],
}

function Switch() {
  const { locale, setLocale } = useLocale()
  return <button onClick={() => setLocale(locale === 'zh' ? 'en' : 'zh')}>Switch</button>
}

function setup() {
  const data = structuredClone(original)
  const writes: { url: string; body: Record<string, unknown> }[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
    if (!options?.method || options.method === 'GET') return new Response(JSON.stringify(data))
    const body = JSON.parse(String(options.body)) as Record<string, unknown>
    writes.push({ url, body })
    if (url.endsWith('/members/operator')) {
      data.assessments[0].version++
      data.assessments[0].members[0].role = String(body.role)
    }
    if (url.endsWith('/role')) data.users[1].organization_role = String(body.role)
    if (url.endsWith('/admin/users')) return new Response(JSON.stringify({ temporary_password: 'Test temporary password' }))
    return new Response(JSON.stringify({ ok: true }))
  }))
  const auth = { user: { id: 'admin', org_id: 'org', role: 'owner' as const, name: 'Admin', email: 'admin@test', is_admin: true }, csrf: 'test', model_configured: false }
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><LocaleProvider><AuthContext.Provider value={auth}><MemoryRouter><Switch /><People /></MemoryRouter></AuthContext.Provider></LocaleProvider></QueryClientProvider>)
  return { writes }
}

afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals() })

it('filters the directory without losing names or making a request when switching language', async () => {
  const { writes } = setup()
  expect(await screen.findByRole('heading', { name: '账号目录' })).toBeVisible()
  fireEvent.change(screen.getByRole('textbox', { name: '搜索账号' }), { target: { value: '业务经办' } })
  expect(screen.getByText('业务经办 原文')).toBeVisible()
  expect(screen.queryByText('供应商原文')).not.toBeInTheDocument()
  fireEvent.click(screen.getByText('Switch'))
  expect(screen.getByRole('heading', { name: 'Account directory' })).toBeVisible()
  expect(screen.getByText('业务经办 原文')).toBeVisible()
  expect(writes).toHaveLength(0)
})

it('uses company initials for demo avatars while preserving authored names in both languages', async () => {
  const { writes } = setup()
  const name = '【演示】峰岚会员科技交付负责人'
  const row = (await screen.findByText(name)).closest('tr')!
  expect(row.querySelector('.people-avatar')).toHaveTextContent('峰')
  expect(screen.getByText('【演示虚构】星途供应链科技').closest('tr')!.querySelector('.people-avatar')).toHaveTextContent('星')
  expect(screen.getByText('管理员原文').closest('tr')!.querySelector('.people-avatar')).toHaveTextContent('管')
  fireEvent.click(within(row).getByRole('button', { name: '配置权限' }))
  const dialog = screen.getByRole('dialog', { name: `${name} · 账号配置` })
  expect(dialog.querySelector('.people-avatar')).toHaveTextContent('峰')
  fireEvent.click(screen.getByText('Switch'))
  expect(screen.getByRole('dialog', { name: `${name} · Account settings` })).toBeVisible()
  expect(dialog.querySelector('.people-avatar')).toHaveTextContent('峰')
  expect(within(dialog).getByText(name)).toBeVisible()
  expect(writes).toHaveLength(0)
})

it('creates an account from the dialog with the selected organization role', async () => {
  const { writes } = setup()
  fireEvent.click(await screen.findByRole('button', { name: '新增账号' }))
  const dialog = within(screen.getByRole('dialog', { name: '新增组织账号' }))
  fireEvent.change(dialog.getByLabelText('姓名'), { target: { value: '新成员原文' } })
  fireEvent.change(dialog.getByLabelText('登录名'), { target: { value: 'new_member' } })
  fireEvent.change(dialog.getByLabelText('组织角色'), { target: { value: 'reviewer' } })
  fireEvent.click(dialog.getByRole('button', { name: '创建账号' }))
  await waitFor(() => expect(writes).toEqual([{ url: '/api/v1/admin/users', body: { name: '新成员原文', username: 'new_member', role: 'reviewer' } }]))
  expect(await screen.findByText('Test temporary password')).toBeVisible()
})

it('updates an account role and a scoped assessment grant using the latest version', async () => {
  const { writes } = setup()
  fireEvent.click((await screen.findAllByRole('button', { name: '配置权限' }))[1])
  const dialog = within(screen.getByRole('dialog', { name: '业务经办 原文 · 账号配置' }))
  fireEvent.change(dialog.getByRole('combobox', { name: '业务经办 原文 角色' }), { target: { value: 'reviewer' } })
  await waitFor(() => expect(writes[0]).toEqual({ url: '/api/v1/people/operator/role', body: { role: 'reviewer' } }))
  fireEvent.click(dialog.getByRole('button', { name: '关闭' }))
  fireEvent.change(screen.getByLabelText('选择评估'), { target: { value: 'assessment' } })
  const grant = screen.getByRole('combobox', { name: '业务经办 原文 评估权限' })
  expect(grant).toHaveValue('viewer')
  fireEvent.change(grant, { target: { value: 'operator' } })
  await waitFor(() => expect(writes[1]).toEqual({ url: '/api/v1/systems/assessment/members/operator', body: { version: 7, role: 'operator' } }))
  expect(await screen.findByText('REV. 8')).toBeVisible()
  expect(grant).toHaveValue('operator')
})
