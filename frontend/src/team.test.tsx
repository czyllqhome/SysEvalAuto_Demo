import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import { AuthContext } from './components'
import { LocaleProvider, useLocale } from './i18n'
import TeamPage from './Team'
import type { Team } from './ProjectRoles'
import type { Session } from './types'

const session: Session = {
  user: { id: 'admin', name: 'Admin', email: 'admin@example.test', role: 'owner', org_id: 'org', is_admin: true },
  csrf: 'test', model_configured: false,
}
function Toggle() {
  const { locale, setLocale } = useLocale()
  return <button onClick={() => setLocale(locale === 'zh' ? 'en' : 'zh')}>Switch</button>
}
function setup(initial?: Team, reject = false, auth = session) {
  const team: Team = structuredClone(initial ?? {
    projects: [{ id: 'project-a', name: '业务项目 Authored project', active: true, roles: [] }],
    users: [{ id: 'member', name: '测试成员', username: 'member', active: true, is_admin: false, memberships: [] }],
  })
  const writes: { url: string; body: Record<string, unknown> }[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
    if (options?.method && options.method !== 'GET') {
      const body = JSON.parse(String(options.body)); writes.push({ url, body })
      if (reject) return new Response(JSON.stringify({ code: 'INVALID_FIELDS' }), { status: 422 })
      if (url.endsWith('/admin/projects')) {
        team.projects.push({ id: 'new-project', name: String(body.name), active: true, roles: [] })
        return new Response(JSON.stringify({ id: 'new-project' }))
      }
      if (url.endsWith('/admin/users')) return new Response(JSON.stringify({ id: 'new-user', temporary_password: 'Test-only-temporary-password' }))
      if (url.includes('/members/')) {
        const person = team.users.find(item => url.endsWith(`/members/${item.id}`))!
        person.memberships = (body.roles as string[]).map(role => ({ project_id: 'project-a', role }))
      }
      return new Response(JSON.stringify({ ok: true }))
    }
    return new Response(JSON.stringify(url.endsWith('/team') ? team : url.endsWith('/assessment-options') ? { projects: team.projects.map(p => ({ ...p, purpose: 'new' })), assets: [] } : []))
  }))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><LocaleProvider><AuthContext.Provider value={auth}><MemoryRouter><Toggle /><TeamPage /></MemoryRouter></AuthContext.Provider></LocaleProvider></QueryClientProvider>)
  return { writes, client }
}

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('lets managers grant ordinary roles without organization or manager controls', async () => {
  const { writes } = setup({
    projects: [{ id: 'project-a', name: 'Managed project', active: true, roles: ['manager'] }],
    users: [{ id: 'member', name: 'Member', active: true, memberships: [] }],
  }, false, { ...session, user: { ...session.user, is_admin: false, role: 'member' } })
  fireEvent.click(await screen.findByRole('button', { name: 'Member' }))
  const dialog = within(screen.getByRole('dialog'))
  expect(dialog.queryByRole('button', { name: '设为管理员' })).not.toBeInTheDocument()
  expect(dialog.queryByRole('checkbox', { name: '业务负责人' })).not.toBeInTheDocument()
  fireEvent.click(dialog.getByRole('checkbox', { name: '评审人员' }))
  fireEvent.click(dialog.getByRole('button', { name: '保存项目角色' }))
  await waitFor(() => expect(writes).toHaveLength(1))
  expect(writes[0].body).toEqual({ roles: ['reviewer'] })
})

it('lets administrators select projects for assignments without manager membership', async () => {
  setup()
  await screen.findByRole('button', { name: '创建评估' })
  expect(screen.queryByLabelText('所属项目')).not.toBeInTheDocument()
})

it('opens account settings from the compact list and shows all four project roles and saves existing-account roles without toggling admin', async () => {
  const { writes } = setup()
  fireEvent.click(await screen.findByRole('button', { name: '测试成员' }))
  const editor = within(await screen.findByRole('form', { name: '测试成员 · 项目角色授权' }))
  for (const name of ['业务负责人', '业务经办人', '评审人员', '只读查看者']) expect(editor.getByRole('checkbox', { name })).toBeEnabled()
  expect(editor.getByLabelText('授权项目')).toHaveValue('project-a')
  fireEvent.click(editor.getByRole('checkbox', { name: '业务经办人' }))
  fireEvent.click(editor.getByRole('checkbox', { name: '只读查看者' }))
  fireEvent.click(editor.getByRole('button', { name: '保存项目角色' }))
  await waitFor(() => expect(writes).toHaveLength(1))
  expect(writes[0]).toEqual({ url: '/api/v1/admin/projects/project-a/members/member', body: { roles: ['operator', 'viewer'] } })
  expect((await screen.findAllByText('权限设置已保存。受影响的账号需重新登录后使用。')).length).toBeGreaterThan(0)
  expect(editor.getByRole('checkbox', { name: '业务经办人' })).toBeChecked()
})

it('creates an account with initial project roles and preserves authored input across language switching', async () => {
  const { writes } = setup()
  const form = within(await screen.findByRole('form', { name: '新增账号' }))
  fireEvent.change(form.getByLabelText('登录名'), { target: { value: 'new-operator' } })
  fireEvent.change(form.getByLabelText('姓名'), { target: { value: '用户姓名 Original name' } })
  fireEvent.change(form.getByLabelText('初始授权项目'), { target: { value: 'project-a' } })
  expect(form.getByRole('button', { name: '创建账号并授权' })).toBeDisabled()
  fireEvent.click(form.getByRole('checkbox', { name: '业务经办人' }))
  fireEvent.click(screen.getByText('Switch'))
  expect(form.getByLabelText('Display name')).toHaveValue('用户姓名 Original name')
  expect(form.getByLabelText('Initial project')).toHaveValue('project-a')
  expect(form.getByRole('checkbox', { name: 'Operator' })).toBeChecked()
  fireEvent.click(form.getByRole('button', { name: 'Create account and grant roles' }))
  await waitFor(() => expect(writes).toHaveLength(1))
  expect(writes[0]).toEqual({ url: '/api/v1/admin/users', body: { username: 'new-operator', name: '用户姓名 Original name', project_id: 'project-a', roles: ['operator'] } })
  expect(await screen.findByText('Test-only-temporary-password')).toBeInTheDocument()
})

it('explains the empty-project state and enables role selection after creating a project', async () => {
  const { writes } = setup({ projects: [], users: [] })
  const account = within(await screen.findByRole('form', { name: '新增账号' }))
  expect(screen.getByText('尚未创建项目，业务角色需要先有授权项目。')).toBeInTheDocument()
  expect(account.getByRole('checkbox', { name: '业务负责人' })).toBeDisabled()
  fireEvent.change(account.getByLabelText('姓名'), { target: { value: '保留的名字' } })
  const project = within(screen.getByRole('form', { name: '新增项目' }))
  fireEvent.change(project.getByLabelText('项目名称'), { target: { value: '新项目 原文' } })
  fireEvent.click(project.getByRole('button', { name: '创建项目' }))
  await waitFor(() => expect(account.getByLabelText('初始授权项目')).toHaveValue('new-project'))
  expect(account.getByRole('checkbox', { name: '业务负责人' })).toBeEnabled()
  expect(account.getByLabelText('姓名')).toHaveValue('保留的名字')
  expect(writes[0].body).toEqual({ name: '新项目 原文', purpose: 'new' })
})

it('keeps the new account and role selection when the server rejects creation', async () => {
  setup(undefined, true)
  const form = within(await screen.findByRole('form', { name: '新增账号' }))
  fireEvent.change(form.getByLabelText('登录名'), { target: { value: 'retry-user' } })
  fireEvent.change(form.getByLabelText('姓名'), { target: { value: '不要丢失' } })
  fireEvent.change(form.getByLabelText('初始授权项目'), { target: { value: 'project-a' } })
  fireEvent.click(form.getByRole('checkbox', { name: '评审人员' }))
  fireEvent.click(form.getByRole('button', { name: '创建账号并授权' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('请检查输入内容')
  expect(form.getByLabelText('姓名')).toHaveValue('不要丢失')
  expect(form.getByRole('checkbox', { name: '评审人员' })).toBeChecked()
})

it('uses an empty role list to revoke only the selected project access', async () => {
  const { writes } = setup({ projects: [{ id: 'project-a', name: '项目', active: true, roles: [] }], users: [
    { id: 'member', name: '成员', active: true, is_admin: false, memberships: [{ project_id: 'project-a', role: 'viewer' }] },
  ] })
  fireEvent.click(await screen.findByRole('button', { name: '成员' }))
  const editor = within(await screen.findByRole('form', { name: '成员 · 项目角色授权' }))
  await waitFor(() => expect(editor.getByRole('checkbox', { name: '只读查看者' })).toBeChecked())
  fireEvent.click(editor.getByRole('checkbox', { name: '只读查看者' }))
  fireEvent.click(editor.getByRole('button', { name: '保存项目角色' }))
  await waitFor(() => expect(writes[0]?.body).toEqual({ roles: [] }))
})

it('ends the local session immediately after changing own project roles', async () => {
  const expired = vi.fn()
  window.addEventListener('scope-session-expired', expired)
  try {
    const { writes } = setup({ projects: [{ id: 'project-a', name: '项目', active: true, roles: [] }], users: [
      { id: 'admin', name: 'Admin', active: true, is_admin: true, memberships: [] },
    ] })
    fireEvent.click(await screen.findByRole('button', { name: 'Admin' }))
    const editor = within(await screen.findByRole('form', { name: 'Admin · 项目角色授权' }))
    fireEvent.click(editor.getByRole('checkbox', { name: '业务负责人' }))
    fireEvent.click(editor.getByRole('button', { name: '保存项目角色' }))
    await waitFor(() => expect(expired).toHaveBeenCalledOnce())
    expect(writes[0].body).toEqual({ roles: ['manager'] })
  } finally { window.removeEventListener('scope-session-expired', expired) }
})

it('does not show account grants or query admin audit to a non-admin manager', async () => {
  setup(undefined, false, { ...session, user: { ...session.user, is_admin: false } })
  await screen.findByRole('heading', { name: '角色与授权范围' })
  expect(screen.queryByRole('form', { name: '新增账号' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '设为管理员' })).not.toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: '管理审计' })).not.toBeInTheDocument()
  await waitFor(() => expect(fetch).toHaveBeenCalled())
  expect(vi.mocked(fetch).mock.calls.every(([url]) => !String(url).includes('/admin/'))).toBe(true)
})
it('shows localized role names without internal role codes', async () => {
  setup()
  fireEvent.click(await screen.findByRole('button', { name: '测试成员' }))
  await screen.findByRole('form', { name: '测试成员 · 项目角色授权' })
  for (const code of ['admin', 'manager', 'operator', 'reviewer', 'viewer']) expect(screen.queryByText(code, { exact: true })).not.toBeInTheDocument()
  expect(screen.getByText('人员与职责')).toBeVisible()
  fireEvent.click(screen.getByText('Switch'))
  expect(screen.getByText('PEOPLE & RESPONSIBILITY')).toBeVisible()
  expect(screen.getByRole('cell', { name: 'Manager' })).toBeVisible()
})


it('keeps account details collapsed until selected and supports searching accounts', async () => {
  setup()
  await screen.findByRole('button', { name: '测试成员' })
  expect(screen.queryByRole('form', { name: '测试成员 · 项目角色授权' })).not.toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: '管理审计' })).not.toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('搜索账号'), { target: { value: 'missing' } })
  expect(screen.queryByRole('button', { name: '测试成员' })).not.toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('搜索账号'), { target: { value: 'member' } })
  fireEvent.click(screen.getByRole('button', { name: '测试成员' }))
  expect(screen.getByRole('dialog')).toHaveTextContent('测试成员')
  fireEvent.click(screen.getByRole('button', { name: '关闭' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(vi.mocked(fetch).mock.calls.every(([url]) => !String(url).includes('/admin/audits'))).toBe(true)
})

it('shows an unlinked existing assessment and creates its explicitly requested matching project', async () => {
  const { writes } = setup({ projects: [], users: [], assessments: [{ id: 'outdoor', name: '户外运动 AI 助手', project_id: null }] })
  expect(await screen.findByText('尚未关联项目')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '建立同名项目' }))
  await waitFor(() => expect(writes[0]).toEqual({ url: '/api/v1/admin/projects', body: { name: '户外运动 AI 助手' } }))
  await waitFor(() => expect(screen.getByLabelText('初始授权项目')).toHaveValue('new-project'))
  expect(screen.getByText('尚未关联项目')).toBeVisible()
})

it('creates an exclusive supplier role and retains it across language switching', async () => {
  const { writes } = setup()
  const form = within(await screen.findByRole('form', { name: '新增账号' }))
  fireEvent.change(form.getByLabelText('登录名'), { target: { value: 'project-supplier' } })
  fireEvent.change(form.getByLabelText('姓名'), { target: { value: '供应商甲' } })
  fireEvent.change(form.getByLabelText('初始授权项目'), { target: { value: 'project-a' } })
  fireEvent.click(form.getByRole('checkbox', { name: '业务经办人' }))
  fireEvent.click(form.getByRole('checkbox', { name: '供应商' }))
  expect(form.getByRole('checkbox', { name: '业务经办人' })).not.toBeChecked()
  fireEvent.click(form.getByRole('checkbox', { name: '业务负责人' }))
  expect(form.getByRole('checkbox', { name: '供应商' })).not.toBeChecked()
  fireEvent.click(form.getByRole('checkbox', { name: '供应商' }))
  fireEvent.click(screen.getByText('Switch'))
  expect(form.getByRole('checkbox', { name: 'Supplier' })).toBeChecked()
  expect(form.getByLabelText('Display name')).toHaveValue('供应商甲')
  fireEvent.click(form.getByRole('button', { name: 'Create account and grant roles' }))
  await waitFor(() => expect(writes[0].body.roles).toEqual(['supplier']))
})
