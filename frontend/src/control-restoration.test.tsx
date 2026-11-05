import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { AuthContext } from './components'
import { ControlsPanel } from './discovery'
import { LocaleProvider, useLocale } from './i18n'
import type { Control, SystemDetail } from './types'

afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals() })

const manual: Control = { id: 'manual', code: 'M1', catalog_id: 'pinned', domain: 'cloud', levels: ['L2'], required: true,
  translations: { zh: { title: '人工排除项', description: '完整控制原文', verification: '核对' } },
  metadata: { source_framework: 'MLPS_LEVEL_2', source_ref: '7.2.1.1' },
  included: false, origin: 'manual', reason: '之前人工填写的排除理由' }
const included: Control = { ...manual, id: 'included', code: 'I1', included: true, origin: 'matched', reason: '',
  translations: { zh: { title: '已纳入项', description: '已纳入要求', verification: '核对' } } }
const rule: Control = { ...manual, id: 'rule', code: 'R1', reason: '', origin: 'inapplicable',
  metadata: { source_framework: 'MLPS_LEVEL_2', source_ref: '7.1.1.1', source: { fields: { security_domain: '安全物理环境' } } },
  match: { status: 'inapplicable', reason: 'rule_not_matched', answer_refs: ['hosting.models'], fact_values: { 'hosting.models': ['cloud'] }, responsibility: 'shared' } }
const detail = { system: { id: 's1', name: 'Test', revision: 1, context: {}, draft: {}, created_at: 1, updated_at: 1,
  version: 7, status: 'CONTROL_REVIEW', context_revision_id: 'context', classification: { catalog_id: 'pinned', effective_level: 'L2', frameworks: ['MLPS_LEVEL_2'] } },
  controls: [included, manual, rule], permissions: ['read', 'edit'], prd: null, round: null, report: null, baseline: null } as SystemDetail

function LanguageToggle() {
  const { locale, setLocale } = useLocale()
  return <button onClick={() => setLocale(locale === 'zh' ? 'en' : 'zh')}>Change language</button>
}
function LiveControls() {
  const query = useQuery<SystemDetail>({ queryKey: ['system', 's1'], queryFn: async () => detail, enabled: false })
  return <ControlsPanel detail={query.data!} />
}
function mount(initial = detail) {
  localStorage.setItem('control-layout', 'rows')
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['system', 's1'], initial)
  render(<QueryClientProvider client={client}><MemoryRouter><LocaleProvider><AuthContext.Provider value={{
    user: { id: 'u', name: 'Editor', email: 'editor@example.test', org_id: 'org', role: 'member' }, csrf: '', model_configured: false,
  }}><LanguageToggle /><LiveControls /></AuthContext.Provider></LocaleProvider></MemoryRouter></QueryClientProvider>)
  return client
}
const catalog = () => new Response(JSON.stringify({ items: [included], total: 1, domain_labels: { cloud: ['云安全', 'Cloud security'] } }))
const summary = () => screen.getByRole('region', { name: '控制匹配统计' })

it('restores a manual exclusion outside the catalog page and refreshes scope counts only after saving', async () => {
  let finish!: (response: Response) => void
  const writes: unknown[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit) => {
    if (options?.method === 'POST') {
      expect(url).toBe('/api/v1/systems/s1/controls')
      expect(options.headers).toHaveProperty('Idempotency-Key')
      writes.push(JSON.parse(options.body as string))
      return new Promise<Response>(resolve => { finish = resolve })
    }
    return catalog()
  }))
  const client = mount()
  await screen.findByText('已纳入要求')
  const count = screen.getByRole('button', { name: '豁免原因（2条）' })
  expect(count).toHaveTextContent(/^2$/)
  expect(count).toHaveAttribute('aria-expanded', 'false')
  fireEvent.click(count)
  expect(document.getElementById(count.getAttribute('aria-controls')!)).toBeVisible()
  expect(within(screen.getByRole('table', { name: '豁免条目与原因' })).getAllByRole('button')).toHaveLength(1)
  fireEvent.click(screen.getByRole('button', { name: '撤回排除 7.2.1.1' }))
  await waitFor(() => expect(writes).toEqual([{ control_id: 'manual', included: true, reason: '', version: 7 }]))
  expect(screen.getByRole('button', { name: '撤回排除 7.2.1.1' })).toBeDisabled()
  expect(screen.getByText(manual.reason!)).toBeVisible()
  const restored = { ...detail, system: { ...detail.system, version: 8 }, controls: [included, { ...manual, included: true, reason: '' }, rule] }
  await act(async () => finish(new Response(JSON.stringify(restored))))
  await waitFor(() => expect(screen.queryByRole('button', { name: /撤回排除/ })).not.toBeInTheDocument())
  expect(screen.getByRole('button', { name: '豁免原因（1条）' })).toHaveTextContent(/^1$/)
  expect(within(summary()).getByText('已纳入', { exact: true }).parentElement).toHaveTextContent('2')
  expect(screen.queryByText(manual.reason!)).not.toBeInTheDocument()
  expect(client.getQueryData<SystemDetail>(['system', 's1'])?.system.version).toBe(8)
  client.clear()
})

it('keeps the exclusion and authored reason when restoring fails', async () => {
  vi.stubGlobal('fetch', vi.fn(async (_url: string, options: RequestInit) => options?.method === 'POST'
    ? new Response(JSON.stringify({ code: 'VERSION_CONFLICT' }), { status: 409 }) : catalog()))
  const client = mount()
  fireEvent.click(screen.getByRole('button', { name: '豁免原因（2条）' }))
  fireEvent.click(screen.getByRole('button', { name: '撤回排除 7.2.1.1' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('内容已有更新')
  expect(screen.getByText(manual.reason!)).toBeVisible()
  expect(screen.getByRole('button', { name: '撤回排除 7.2.1.1' })).toBeEnabled()
  expect(screen.getByRole('button', { name: '豁免原因（2条）' })).toHaveTextContent(/^2$/)
  expect(client.getQueryData(['system', 's1'])).toEqual(detail)
  client.clear()
})

it.each([
  { permissions: ['read'], status: 'CONTROL_REVIEW' },
  { permissions: ['read', 'review'], status: 'CONTROL_REVIEW' },
  { permissions: ['read', 'edit'], status: 'PRD_REVIEW' },
])('disables restore for permissions $permissions at $status', async ({ permissions, status }) => {
  const fetcher = vi.fn(async (_url: string, _options: RequestInit) => catalog())
  vi.stubGlobal('fetch', fetcher)
  const client = mount({ ...detail, permissions, system: { ...detail.system, status } })
  await screen.findByText('已纳入要求')
  fireEvent.click(screen.getByRole('button', { name: '豁免原因（2条）' }))
  const restore = screen.getByRole('button', { name: '撤回排除 7.2.1.1' })
  expect(restore).toBeDisabled()
  fireEvent.click(restore)
  expect(fetcher.mock.calls.every(([, options]) => options?.method !== 'POST')).toBe(true)
  client.clear()
})

it('uses one concise bilingual page introduction and toggles reasons with the count', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => catalog()))
  const client = mount()
  await screen.findByText('已纳入要求')
  expect(screen.getByRole('heading', { name: '安全控制匹配' })).toBeVisible()
  expect(screen.getByText('根据系统等级与适用信息匹配安全控制，支持补充、排除和恢复控制项。')).toBeVisible()
  expect(screen.queryByText(/按所选 MLPS 框架匹配控制/)).not.toBeInTheDocument()
  expect(summary().querySelector(':scope > p:not(.control-exemption-breakdown)')).toBeNull()
  const count = screen.getByRole('button', { name: '豁免原因（2条）' })
  fireEvent.click(count)
  fireEvent.click(count)
  expect(count).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByRole('table', { name: '豁免条目与原因' })).not.toBeInTheDocument()
  fireEvent.click(count)
  fireEvent.click(screen.getByRole('button', { name: 'Change language' }))
  expect(screen.getByRole('heading', { name: 'Security control matching' })).toBeVisible()
  expect(screen.queryByText(/Matches the selected MLPS framework/)).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Exemption reasons (2 controls)' })).toHaveTextContent(/^2$/)
  expect(screen.getByRole('button', { name: 'Undo exclusion 7.2.1.1' })).toBeEnabled()
  expect(screen.getByText(manual.reason!)).toBeVisible()
  client.clear()
})
