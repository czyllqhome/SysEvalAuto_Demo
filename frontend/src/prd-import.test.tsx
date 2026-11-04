import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import { AuthContext } from './components'
import { DiscoveryPanel } from './narrative'
import PrdImport from './PrdImport'
import { LocaleProvider, topicData } from './i18n'
import type { Session, SystemDetail } from './types'

const session: Session = { user: { id: 'u', name: 'User', email: 'u@example.test', org_id: 'o', role: 'owner' }, csrf: 'test', model_configured: true }
const detail: SystemDetail = { permissions: ['read', 'edit'], system: { id: 's', name: 'System', status: 'DRAFT', revision: 1, version: 1, context: {}, draft: {}, classification: {}, created_at: 1, updated_at: 1 }, controls: [], prd: null, round: null, report: null, baseline: null }
const found = { status: 'found', text: '采购申请，不包含付款', evidence: [{ source_id: 'L2', quote: '采购申请，不包含付款' }] }
const missing = { status: 'missing', text: '', evidence: [] }
function imported() {
  return { id: 'i', filename: 'scope.md', markdown: '# PRD\n采购申请，不包含付款', requires_revision: false,
    job: { id: 'j', state: 'succeeded', error: '' },
    result: { fields: Object.fromEntries(topicData.map(t => [t.key, t.key === 'functions' ? found : missing])), name: missing, questions: [] }, applications: [] }
}
function show(value = detail, panel = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['system', 's'], value)
  function View() {
    const query = useQuery({ queryKey: ['system', 's'], queryFn: async () => value, enabled: false })
    return panel ? <PrdImport detail={query.data!} save={async () => {}} /> : <DiscoveryPanel detail={query.data!} />
  }
  render(<QueryClientProvider client={client}><LocaleProvider><AuthContext.Provider value={session}><MemoryRouter><View /></MemoryRouter></AuthContext.Provider></LocaleProvider></QueryClientProvider>)
  fireEvent.click(screen.getByText('从已有 PRD 导入'))
  return client
}
afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('does not call a model on entry and previews Markdown safely before explicit parsing', async () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
  show(detail, true)
  const file = new File(['# PRD'], 'scope.md', { type: 'text/markdown' })
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new TextEncoder().encode('# PRD\n<script>bad()</script>').buffer })
  fireEvent.change(screen.getByLabelText('上传 Markdown PRD'), { target: { files: [file] } })
  await screen.findByText('scope.md')
  expect(fetcher).not.toHaveBeenCalled()
  expect(document.querySelector('script')).toBeNull()
  expect(screen.getByRole('button', { name: '解析并自动填充' })).toBeEnabled()
})

it('shows all eight topics, evidence and missing values without applying suggestions on load', async () => {
  const fetcher = vi.fn(async () => new Response(JSON.stringify(imported())))
  vi.stubGlobal('fetch', fetcher)
  show({ ...detail, system: { ...detail.system, draft: { prd_import_id: 'i' } } }, true)
  await screen.findByText('功能与范围 · 待应用建议')
  expect(screen.getByText('数据与接口 · 未找到')).toBeInTheDocument()
  expect(screen.getByText('建设目标 · 未找到')).toBeInTheDocument()
  expect(screen.getByText('L2')).toBeInTheDocument()
  expect(fetcher.mock.calls.length).toBe(1)
  expect(screen.getByRole('button', { name: '应用所选更新' })).toBeDisabled()
})

it('merges server autofill into untouched fields while preserving unsaved local typing', async () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
  const client = show()
  fireEvent.change(screen.getByLabelText('建设目标'), { target: { value: '正在输入的人工目标' } })
  await act(async () => {
    client.setQueryData(['system', 's'], { ...detail, system: { ...detail.system, version: 2, draft: { blocks: { goal: '模型目标', data: '无外部接口' } } } })
  })
  expect(screen.getByLabelText('建设目标')).toHaveValue('正在输入的人工目标')
  fireEvent.click(screen.getByRole('button', { name: /06\s*数据与接口/ }))
  await waitFor(() => expect(screen.getByLabelText('数据与接口')).toHaveValue('无外部接口'))
  expect(fetcher).not.toHaveBeenCalled()
})

it('requires explicit impact acknowledgement before applying changes to a confirmed assessment', async () => {
  const result = { ...imported(), requires_revision: true }
  const fetcher = vi.fn(async () => new Response(JSON.stringify(result)))
  vi.stubGlobal('fetch', fetcher)
  show({ ...detail, system: { ...detail.system, draft: { prd_import_id: 'i' } } }, true)
  await screen.findByText('功能与范围 · 待应用建议')
  fireEvent.click(screen.getAllByLabelText('选择更新此字段（可编辑合并或清空）')[1])
  expect(screen.getByRole('button', { name: '应用所选更新' })).toBeDisabled()
  fireEvent.click(screen.getByLabelText('确认创建修订并重新审查'))
  await waitFor(() => expect(screen.getByRole('button', { name: '应用所选更新' })).toBeEnabled())
  expect(fetcher.mock.calls.length).toBe(1)
})

it('uploads then explicitly schedules extraction and displays the persisted autofill without per-field acceptance', async () => {
  let server = detail
  const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
    if (url === '/api/v1/systems/s/prd-imports' && options?.method === 'POST') {
      const body = JSON.parse(options.body as string)
      expect(body.filename).toBe('scope.md')
      expect(body.markdown).toContain('采购申请')
      server = { ...server, system: { ...server.system, version: 2, draft: { prd_import_id: 'i' } } }
      return new Response(JSON.stringify({ ...server, import_id: 'i' }))
    }
    if (url === '/api/v1/systems/s/jobs' && options?.method === 'POST') {
      const body = JSON.parse(options.body as string)
      expect(body.kind).toBe('prd_import_extraction')
      expect(body.mode).toBe('openrouter')
      expect(body.version).toBe(2)
      server = { ...server, system: { ...server.system, version: 3, draft: { prd_import_id: 'i', blocks: { functions: found.text } } } }
      return new Response(JSON.stringify({ ...server, job_id: 'j' }))
    }
    if (url === '/api/v1/systems/s/prd-imports/i') return new Response(JSON.stringify(imported()))
    throw new Error('Unexpected request: ' + url)
  })
  vi.stubGlobal('fetch', fetcher)
  show()
  const file = new File(['# PRD'], 'scope.md')
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new TextEncoder().encode('# PRD\n采购申请，不包含付款').buffer })
  fireEvent.change(screen.getByLabelText('上传 Markdown PRD'), { target: { files: [file] } })
  await waitFor(() => expect(screen.getByRole('button', { name: '解析并自动填充' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: '解析并自动填充' }))
  await screen.findByText('功能与范围 · 已填入 · 待核对')
  fireEvent.click(screen.getByRole('button', { name: /02\s*功能与范围/ }))
  expect(screen.getByLabelText('功能与范围')).toHaveValue(found.text)
  fireEvent.click(screen.getByRole('button', { name: /06\s*数据与接口/ }))
  expect(screen.getByLabelText('数据与接口')).toHaveValue('')
  expect(fetcher.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(2)
})
