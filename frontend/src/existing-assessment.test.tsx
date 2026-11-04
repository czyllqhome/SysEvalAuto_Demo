import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import AssessmentCreate from './AssessmentCreate'
import ExistingAssessment from './ExistingAssessment'
import { AuthContext } from './components'
import { LocaleProvider, useLocale } from './i18n'
import { stageTab } from './Workspace'
import type { SystemDetail } from './types'
import type { ReactNode } from 'react'

const detail: SystemDetail = { system: { id: 'system', name: 'Running service', assessment_type: 'existing',
  status: 'VERIFYING', version: 7, revision: 1, context: {}, classification: {}, draft: {}, created_at: 1, updated_at: 1 },
  controls: [{ id: 'control', code: 'CTRL-1', domain: 'IAM', levels: ['L2'], required: true, catalog_id: 'catalog', included: true,
    translations: { zh: { title: '检查账号', description: '检查', verification: '日志' } } }],
  permissions: ['read', 'edit', 'review', 'manage'], prd: null, round: null, report: null, baseline: null }
function Toggle() { const { locale, setLocale } = useLocale(); return <button onClick={() => setLocale(locale === 'zh' ? 'en' : 'zh')}>Switch</button> }
function setup(child: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><LocaleProvider><AuthContext.Provider value={{ user: { id: 'owner', name: 'Owner', email: 'owner@example.test', org_id: 'org', role: 'owner', is_admin: true }, csrf: 'test', model_configured: false }}><MemoryRouter><Toggle />{child}</MemoryRouter></AuthContext.Provider></LocaleProvider></QueryClientProvider>)
}
afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('shares creation form while preserving authored fields across language and type changes', async () => {
  const writes: Record<string, unknown>[] = []
  vi.stubGlobal('fetch', vi.fn(async (_url: string, options?: RequestInit) => {
    if (options?.method === 'POST') { writes.push(JSON.parse(String(options.body))); return new Response(JSON.stringify(detail)) }
    return new Response(JSON.stringify({ projects: [{ id: 'p', name: '项目原文', purpose: 'existing' }], assets: [{ id: 'asset', project_id: 'p', name: '运行系统原文' }] }))
  }))
  setup(<AssessmentCreate initialKind="existing" />)
  await waitFor(() => expect(screen.getByRole('button', { name: '创建评估' })).not.toBeDisabled())
  expect(screen.queryByLabelText('所属项目')).not.toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('待评估系统名称'), { target: { value: '评估原文 Authored' } })
  fireEvent.change(screen.getByLabelText('评估范围'), { target: { value: '生产业务范围' } })
  fireEvent.change(screen.getByLabelText('评估基准日期'), { target: { value: '2026-11-01' } })
  fireEvent.change(screen.getByLabelText('部署环境'), { target: { value: 'production' } })
  fireEvent.change(screen.getByLabelText('系统版本'), { target: { value: 'v1' } })
  fireEvent.click(screen.getByText('Switch'))
  expect(screen.getByLabelText('System name to assess')).toHaveValue('评估原文 Authored')
  expect(screen.getByLabelText('Assessment scope')).toHaveValue('生产业务范围')
  fireEvent.click(screen.getByRole('button', { name: 'Create assessment' }))
  await waitFor(() => expect(writes).toHaveLength(1))
  expect(writes[0]).toMatchObject({ assessment_type: 'existing', scope: '生产业务范围', system_version: 'v1' })
})

it('records insufficient evidence explicitly without pretending supplier claims are verified', async () => {
  const writes: Record<string, unknown>[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
    if (options?.method === 'POST') { writes.push(JSON.parse(String(options.body))); return new Response(JSON.stringify(detail)) }
    if (url.endsWith('/existing-assignees')) return new Response(JSON.stringify({ users: [] }))
    return new Response(JSON.stringify({ scope: { scope: 'Production', environment: 'production', system_version: 'v1', as_of: '2026-11-01' },
      run: { verifications: {}, reports: [], gaps: {}, plans: {}, history: [] }, evidence: [], expired_gaps: [], history_revisions: [1] }))
  }))
  setup(<ExistingAssessment detail={detail} />)
  fireEvent.click(await screen.findByRole('button', { name: '核验' }))
  expect(screen.getByLabelText('实施结论')).toHaveValue('insufficient_evidence')
  fireEvent.change(screen.getByLabelText('判断理由'), { target: { value: '供应商声明尚无佐证' } })
  fireEvent.change(screen.getByLabelText('核验方法'), { target: { value: '访谈' } })
  fireEvent.click(screen.getByRole('button', { name: '确认并保存' }))
  await waitFor(() => expect(writes).toHaveLength(1))
  expect(writes[0]).toMatchObject({ version: 7, control_id: 'control', conclusion: 'insufficient_evidence', evidence_ids: [] })
})

it('routes current-state stages independently and does not fall back to supplier for unknown states', () => {
  expect(stageTab('DRAFT')).toBe('classification')
  expect(stageTab('CONTEXT_REVIEW', false, false)).toBe('brief')
  expect(stageTab('CONTEXT_REVIEW', false, true)).toBe('brief')
  expect(stageTab('REMEDIATING')).toBe('existing')
  expect(stageTab('ACCEPTED_RISKS')).toBe('existing')
  expect(stageTab('UNKNOWN')).toBe('unavailable')
  expect(stageTab('PRD_REVIEW')).toBe('prd')
})
