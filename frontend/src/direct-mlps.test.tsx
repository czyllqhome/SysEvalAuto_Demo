import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import App from './App'
import MLPSLibrary from './MLPSLibrary'
import People from './People'
import { AuthContext } from './components'
import { LocaleProvider, useLocale } from './i18n'

afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals() })
function Switch() { const { setLocale } = useLocale(); return <button onClick={() => setLocale('en')}>English</button> }
function setup(child: React.ReactNode) {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><LocaleProvider><AuthContext.Provider value={{ user: { id: 'admin', org_id: 'org', role: 'owner', name: 'Admin', email: 'admin@test', is_admin: true }, csrf: 'test', model_configured: false }}><MemoryRouter><Switch />{child}</MemoryRouter></AuthContext.Provider></LocaleProvider></QueryClientProvider>)
}
it('keeps Chinese source controls when switching the interface to English', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ controls: [{ control_code: 'MLPS2-1', source_level: 2, source_ref: '7.1', translations: { zh: { title: '原始中文', description: '中文要求', verification: '中文步骤' } }, source: { languages: { zh: { filename: 'CN.xlsx', row: 2, fields: {} } } } }] }))))
  setup(<MLPSLibrary />)
  await screen.findByText('原始中文')
  expect(screen.queryByRole('button', { name: /发布|编辑/ })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '查看详情' }))
  fireEvent.click(screen.getByText('English'))
  expect(screen.getAllByText('原始中文').length).toBeGreaterThan(0)
  expect(screen.getByText('中文要求')).toBeInTheDocument()
  expect(screen.queryByText('Source not provided in this language')).not.toBeInTheDocument()
})
it('creates an organization manager without sending project fields', async () => {
  const writes: Record<string, unknown>[] = []
  vi.stubGlobal('fetch', vi.fn(async (_url: string, options?: RequestInit) => {
    if (options?.method === 'POST') { writes.push(JSON.parse(String(options.body))); return new Response(JSON.stringify({ temporary_password: 'temporary-test' })) }
    return new Response(JSON.stringify({ users: [], assessments: [] }))
  }))
  setup(<People />)
  fireEvent.click(await screen.findByRole('button', { name: '新增账号' }))
  fireEvent.change(screen.getByLabelText('姓名'), { target: { value: '负责人原文' } })
  fireEvent.change(screen.getByLabelText('登录名'), { target: { value: 'manager' } })
  fireEvent.click(screen.getByRole('button', { name: '创建账号' }))
  await waitFor(() => expect(writes).toEqual([{ name: '负责人原文', username: 'manager', role: 'manager' }]))
  expect(screen.queryByLabelText('所属项目')).not.toBeInTheDocument()
})

it('uses one creation flow and selects the system type inside the dialog', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(
    url.endsWith('/auth/session') ? { user: { id: 'owner', org_id: 'org', role: 'owner', name: 'Owner', email: 'owner@test', can_create: true }, csrf: 'test', model_configured: false }
    : url.endsWith('/assessment-options') ? { projects: [], assets: [] } : []
  ))))
  setup(<App />)
  const entries = await screen.findAllByRole('button', { name: '新建系统安全评估' })
  expect(screen.queryByRole('button', { name: '现有系统评估' })).not.toBeInTheDocument()
  fireEvent.click(entries[0])
  expect(screen.getByRole('dialog', { name: '新建系统安全评估' })).toBeInTheDocument()
  expect(screen.getByLabelText('系统类型')).toHaveValue('new')
  expect(screen.getByLabelText('待评估系统名称')).toBeInTheDocument()
  expect(screen.queryByText('填入可编辑的客户服务门户示例')).not.toBeInTheDocument()
  expect(screen.queryByText('创建独立评估记录，保留历史基线和原始文本。')).not.toBeInTheDocument()
  expect(screen.getByRole('option', { name: '待开发系统' })).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('系统类型'), { target: { value: 'existing' } })
  expect(screen.getByLabelText('评估范围')).toBeInTheDocument()
  expect(screen.getByLabelText('系统类型')).toHaveValue('existing')
})

it('uploads six-field source files only on an explicit administrator action', async () => {
  const writes: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
    if (options?.method === 'POST') { writes.push(url); return new Response(JSON.stringify({ active: true, controls: [] })) }
    return new Response(JSON.stringify(url.endsWith('/source-controls') ? { active: true, can_upload: true, controls: [] } : { controls: [] }))
  }))
  setup(<MLPSLibrary />)
  fireEvent.click(await screen.findByRole('button', { name: '导入条目' }))
  expect(screen.getByRole('button', { name: '校验并保存' })).toBeDisabled()
  expect(writes).toEqual([])
  const file = new File(['source,control_identifier,security_domain,security_control_point,control_requirement,risk_level'], 'controls.csv', { type: 'text/csv' })
  fireEvent.change(screen.getByLabelText('选择控制条目文件'), { target: { files: [file] } })
  fireEvent.click(screen.getByRole('button', { name: '校验并保存' }))
  await waitFor(() => expect(writes).toEqual(['/api/v1/source-controls/uploads']))
  expect(await screen.findByText('文件已校验并保存。')).toBeVisible()
})
