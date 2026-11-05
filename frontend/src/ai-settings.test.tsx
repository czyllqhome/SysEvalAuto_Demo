import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { LocaleProvider, useLocale } from './i18n'
import { AuthContext } from './components'
import AISettings from './AISettings'
import type { Session } from './types'

afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals() })
function Language() { const { setLocale } = useLocale(); return <button onClick={() => setLocale('en')}>English</button> }
const catalog = [
  { key: 'prd_generation', status: 'active', group: 'generation', title: { zh: 'PRD 生成', en: 'PRD generation' } },
  { key: 'narrative_refinement:mlps_purpose', status: 'active', group: 'intake', title: { zh: '建设目的优化', en: 'Refine system purpose' } },
  { key: 'impact_analysis', status: 'active', group: 'review', title: { zh: '供应商整轮影响分析', en: 'Supplier round impact analysis' } },
  { key: 'context_organization', status: 'legacy', group: 'legacy', title: { zh: '应用说明整理', en: 'Organize application brief' } },
  { key: 'requirement_risk', status: 'system', group: 'review', title: { zh: '单项残余风险分析', en: 'Single-item residual risk' }, instruction: 'System risk instruction' },
].map(item => ({ ...item, usage: { zh: '对应业务入口', en: 'Workflow entry' } }))

function setup({ conflict = false, admin = true } = {}) {
  const defaults = { model: 'sample/model', providers: 'sample-provider', zdr: false, max_tokens: 12000, reasoning_tokens: '2048', prompts: { context_organization: '历史自定义模板', prd_generation: 'PRD template {language}', 'narrative_refinement:mlps_purpose': 'Purpose template', impact_analysis: 'Impact template' } }
  let saved = { ...structuredClone(defaults), version: 2, defaults: structuredClone(defaults), key_configured: true }
  const writes: { path: string; body: Record<string, unknown> }[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
    if (url.endsWith('/ai-prompts')) return new Response(JSON.stringify({ items: catalog }))
    if (url.endsWith('/prd-template')) {
      if (options?.method === 'PUT') { writes.push({ path: url, body: JSON.parse(String(options.body)) }); saved = { ...saved, version: saved.version + 1 } }
      return new Response(JSON.stringify({ version: 4, template: { filename: 'prd.md', content: '# 模板 {{name}}' }, slots: ['name'] }))
    }
    if (options?.method === 'PUT') {
      const body = JSON.parse(String(options.body))
      writes.push({ path: url, body })
      if (conflict) return new Response(JSON.stringify({ code: 'VERSION_CONFLICT' }), { status: 409 })
      saved = { ...saved, ...body, version: saved.version + 1 }
    }
    return new Response(JSON.stringify(saved))
  }))
  const session = { user: { is_admin: admin } } as Session
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><LocaleProvider><AuthContext.Provider value={session}><MemoryRouter><Language /><AISettings /></MemoryRouter></AuthContext.Provider></LocaleProvider></QueryClientProvider>)
  return { writes }
}

it('preserves edits across prompt selection and locale changes, saving the revision and unchanged legacy prompts', async () => {
  const { writes } = setup()
  const input = await screen.findByRole('textbox', { name: 'PRD 生成' })
  fireEvent.change(input, { target: { value: '用户编写的模板 {language}' } })
  fireEvent.click(screen.getByRole('button', { name: /建设目的优化/ }))
  expect(screen.getByRole('textbox', { name: '建设目的优化' })).toHaveValue('Purpose template')
  fireEvent.click(screen.getByText('English'))
  fireEvent.click(screen.getByRole('button', { name: /PRD generation/ }))
  expect(screen.getByRole('textbox', { name: 'PRD generation' })).toHaveValue('用户编写的模板 {language}')
  expect(writes).toHaveLength(0)
  fireEvent.click(screen.getByRole('button', { name: 'Save configuration' }))
  await waitFor(() => expect(writes).toHaveLength(1))
  expect(writes[0].body.version).toBe(2)
  expect(writes[0].body.prompts).toMatchObject({ prd_generation: '用户编写的模板 {language}', context_organization: '历史自定义模板' })
  expect(writes[0].body).not.toHaveProperty('key_configured')
  expect(writes[0].body).not.toHaveProperty('defaults')
  expect(await screen.findByText('REV. 3')).toBeVisible()
})

it('separates legacy and fixed system instructions, supports search, and performs no writes', async () => {
  const { writes } = setup()
  const list = within(await screen.findByRole('navigation', { name: '提示词列表' }))
  expect(list.queryByRole('button', { name: /应用说明整理/ })).not.toBeInTheDocument()
  fireEvent.click(list.getByRole('button', { name: /单项残余风险分析/ }))
  expect(screen.getByRole('textbox', { name: '单项残余风险分析' })).toHaveAttribute('readonly')
  expect(screen.getByRole('textbox', { name: '单项残余风险分析' })).toHaveValue('System risk instruction')
  fireEvent.click(screen.getByRole('button', { name: /历史兼容/ }))
  expect(screen.getByRole('textbox', { name: '应用说明整理' })).toHaveAttribute('readonly')
  expect(screen.getByRole('textbox', { name: '应用说明整理' })).toHaveValue('历史自定义模板')
  fireEvent.change(screen.getByRole('textbox', { name: '搜索提示词' }), { target: { value: 'not-a-template' } })
  expect(screen.getByText('没有匹配的提示词')).toBeVisible()
  expect(writes).toHaveLength(0)
})

it('validates budgets and empty prompts and restores defaults without writing', async () => {
  const { writes } = setup()
  const input = await screen.findByRole('textbox', { name: 'PRD 生成' })
  const save = screen.getByRole('button', { name: '保存配置' })
  fireEvent.change(input, { target: { value: '' } })
  expect(screen.getByText('提示词不能为空。')).toBeVisible()
  expect(save).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: '恢复此模板默认值' }))
  expect(input).toHaveValue('PRD template {language}')
  fireEvent.change(screen.getByRole('spinbutton', { name: '推理 Token 预算' }), { target: { value: '12000' } })
  expect(screen.getByRole('alert')).toBeVisible()
  expect(save).toBeDisabled()
  fireEvent.change(screen.getByRole('spinbutton', { name: '推理 Token 预算' }), { target: { value: '1024' } })
  expect(save).toBeEnabled()
  fireEvent.click(screen.getByRole('button', { name: '放弃修改' }))
  expect(screen.getByRole('spinbutton', { name: '推理 Token 预算' })).toHaveValue(2048)
  expect(save).toBeDisabled()
  expect(writes).toHaveLength(0)
})

it('retains authored edits after a version conflict', async () => {
  setup({ conflict: true })
  const input = await screen.findByRole('textbox', { name: 'PRD 生成' })
  fireEvent.change(input, { target: { value: '保留未保存提示词' } })
  fireEvent.click(screen.getByRole('button', { name: '保存配置' }))
  await waitFor(() => expect(screen.getByRole('alert')).toBeVisible())
  expect(input).toHaveValue('保留未保存提示词')
  expect(screen.getByText('REV. 2')).toBeVisible()
})

it('refreshes the shared revision after saving document layout without losing pending model edits', async () => {
  const { writes } = setup()
  await screen.findByRole('textbox', { name: 'PRD 生成' })
  fireEvent.change(screen.getByLabelText(/模型 ID/), { target: { value: 'authored/model' } })
  fireEvent.click(screen.getByText('PRD 文档版式'))
  const template = await screen.findByLabelText('Markdown 模板内容')
  fireEvent.change(template, { target: { value: '# 新版 {{name}}' } })
  fireEvent.click(screen.getByRole('button', { name: '保存 PRD 模板' }))
  expect(await screen.findByText('REV. 3')).toBeVisible()
  expect(screen.getByLabelText(/模型 ID/)).toHaveValue('authored/model')
  fireEvent.click(screen.getByRole('button', { name: '保存配置' }))
  await waitFor(() => expect(writes).toHaveLength(2))
  expect(writes[1].body).toMatchObject({ version: 3, model: 'authored/model' })
})

it('denies non-administrators without fetching settings or the prompt catalog', () => {
  setup({ admin: false })
  expect(screen.getByRole('alert')).toHaveTextContent('仅管理员')
  expect(fetch).not.toHaveBeenCalled()
})
