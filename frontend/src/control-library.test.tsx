import { useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { LocaleProvider, useLocale } from './i18n'
import ControlLibrary, { RuleEditor } from './ControlLibrary'
import { FactFields } from './TagClassification'
import type { Config, Fact, LibraryState, Rule } from './libraryTypes'

const config: Config = {
  schema_version: 'mlps-tags-1', domains: [{ code: 'BOUNDARY', zh: '边界', en: 'Boundary' }],
  profiles: [{ code: 'MLPS2_REFERENCE', zh: '二级参考', en: 'Level 2 reference', level: 'L2' }], topics: [],
  questions: [
    { code: 'net.public_ingress', zh: '公网入口？', en: 'Public entry?', kind: 'enum', group: 'network', values: ['yes', 'no', 'unknown'], risk: false, when: true },
    { code: 'net.cross_zone', zh: '跨区域访问？', en: 'Cross-zone access?', kind: 'enum', group: 'network', values: ['yes', 'no', 'unknown'], risk: false, when: true },
    { code: 'net.details', zh: '公网明细？', en: 'Public details?', kind: 'enum', group: 'network', values: ['yes', 'no', 'unknown'], risk: false, when: { any: [{ all: [{ tag: 'net.public_ingress', op: 'eq', value: 'yes' }] }] } },
  ], thresholds: { critical_minutes: 240, important_minutes: 1440 },
}

afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals() })

function Toggle() {
  const { locale, setLocale } = useLocale()
  return <button onClick={() => setLocale(locale === 'zh' ? 'en' : 'zh')}>Switch</button>
}

it('builds OR alternatives without collapsing them into AND', () => {
  function Harness() {
    const [rule, setRule] = useState<Rule>(true)
    return <LocaleProvider><RuleEditor rule={rule} config={config} onChange={setRule} /><output>{JSON.stringify(rule)}</output></LocaleProvider>
  }
  render(<Harness />)
  fireEvent.change(screen.getByLabelText('适用方式'), { target: { value: 'conditional' } })
  fireEvent.click(screen.getByRole('button', { name: '增加 OR 条件组' }))
  fireEvent.change(screen.getAllByLabelText('事实标签')[1], { target: { value: 'net.cross_zone' } })
  const rule = JSON.parse(screen.getByRole('status').textContent!)
  expect(rule.any).toHaveLength(2)
  expect(rule.any[0].all[0].tag).toBe('net.public_ingress')
  expect(rule.any[1].all[0].tag).toBe('net.cross_zone')
})

it('keeps unknown distinct from no and preserves answers across language changes', () => {
  function Harness() {
    const [facts, setFacts] = useState<Record<string, Fact>>({})
    return <LocaleProvider><Toggle /><FactFields config={config} facts={facts} setFacts={setFacts} /></LocaleProvider>
  }
  render(<Harness />)
  expect(screen.getByLabelText(/公网入口/)).toHaveValue('unknown')
  expect(screen.queryByLabelText(/公网明细/)).not.toBeInTheDocument()
  fireEvent.change(screen.getByLabelText(/公网入口/), { target: { value: 'yes' } })
  expect(screen.getByLabelText(/公网明细/)).toBeInTheDocument()
  fireEvent.click(screen.getByText('Switch'))
  expect(screen.getByLabelText(/Public entry/)).toHaveValue('yes')
  fireEvent.change(screen.getByLabelText(/Public entry/), { target: { value: 'no' } })
  expect(screen.queryByLabelText(/Public details/)).not.toBeInTheDocument()
})

it('saves authored controls to a draft and requires separate publication', async () => {
  const state: LibraryState = { version: 0, published_id: null, config, controls: [], can_edit: true }
  const writes: { url: string; body: Record<string, unknown> }[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
    if (options?.method === 'POST') {
      const body = JSON.parse(String(options.body)); writes.push({ url, body })
      return new Response(JSON.stringify({ ...state, version: 1, controls: [{ ...body.control, control_id: 'stable', revision: 1 }] }))
    }
    return new Response(JSON.stringify(url.endsWith('/history') ? [] : state))
  }))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><LocaleProvider><Toggle /><ControlLibrary /></LocaleProvider></QueryClientProvider>)
  fireEvent.click(await screen.findByRole('button', { name: '新增控制项' }))
  fireEvent.change(screen.getByLabelText('控制编号'), { target: { value: 'ORG-1' } })
  fireEvent.change(screen.getByLabelText('评估对象'), { target: { value: '业务系统' } })
  fireEvent.change(screen.getAllByLabelText('标题')[0], { target: { value: '原始要求 Original title' } })
  fireEvent.change(screen.getAllByLabelText('控制要求')[0], { target: { value: '用户编写的要求' } })
  fireEvent.change(screen.getAllByLabelText('评估方法和证据')[0], { target: { value: '提供访问记录' } })
  fireEvent.click(screen.getByText('Switch'))
  expect(screen.getAllByLabelText('Title')[0]).toHaveValue('原始要求 Original title')
  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))
  await waitFor(() => expect(writes).toHaveLength(1))
  expect(writes[0].url).toBe('/api/v1/library/controls')
  expect(writes[0].body.operation).toBe('create')
  expect((writes[0].body.control as { review_status: string }).review_status).toBe('draft')
  expect(writes.every(w => !w.url.endsWith('/publish'))).toBe(true)
})
import LibraryBrowser from './LibraryBrowser'
import type { LibraryControl } from './libraryTypes'

const browseControl = (code: string, framework = 'MLPS', sourceLevel = 2, profile = 'MLPS2_REFERENCE'): LibraryControl => ({
  control_code: code, translations: { zh: { title: code + ' 原文', description: '原始控制要求', verification: '检查证据' } },
  assessment_object: '系统', domain_code: 'BOUNDARY', assessment_profiles: [profile], required: true, topic_tags: [],
  applicability_mode: 'always', rule: true, responsibility_rule: 'customer', source_framework: framework, source_version: '2026',
  source_ref: '条款 1', source_level: sourceLevel, control_family_id: '', change_reason: '', review_status: 'reviewed', retired: false,
})
function browse(controls: LibraryControl[]) {
  const state: LibraryState = { version: 3, published_id: 'release', config, controls, can_edit: true }
  const historical = { ...config, profiles: [{ code: 'OLD', zh: '历史三级方案', en: 'Historical L3 profile', level: 'L3' }] }
  render(<LocaleProvider><Toggle /><LibraryBrowser data={state} releases={[{ catalog_id: 'release', version: 'v1', created_at: 1, controls: [browseControl('HISTORY', 'NIST', 3, 'OLD')], config: historical }]} historyError={false} edit={vi.fn()} /></LocaleProvider>)
}
it('confirms cross-page deletion and clears selection when filters or versions change', async () => {
  const controls = Array.from({ length: 31 }, (_, i) => ({ ...browseControl(`ROW-${i}`), control_id: `id-${i}` }))
  const bulkDelete = vi.fn(async () => true)
  const data: LibraryState = { version: 3, published_id: 'release', config, controls, can_edit: true }
  render(<LocaleProvider><LibraryBrowser data={data} releases={[{ catalog_id: 'release', version: 'v1', created_at: 1, controls, config }]} historyError={false} edit={vi.fn()} bulkDelete={bulkDelete} /></LocaleProvider>)
  fireEvent.click(screen.getByText('选择全部筛选结果（跨页）'))
  fireEvent.click(screen.getByRole('button', { name: '批量删除' }))
  expect(screen.getByRole('button', { name: '确认批量删除' })).toBeDisabled()
  fireEvent.change(screen.getByLabelText('删除原因'), { target: { value: '重新整理底稿' } })
  fireEvent.click(screen.getByRole('button', { name: '确认批量删除' }))
  await waitFor(() => expect(bulkDelete).toHaveBeenCalledWith(controls.map(c => c.control_id), '重新整理底稿'))
  fireEvent.click(screen.getByLabelText('选择 ROW-0'))
  fireEvent.change(screen.getByLabelText('搜索控制'), { target: { value: 'ROW-1' } })
  expect(screen.getByRole('button', { name: '批量删除' })).toBeDisabled()
  fireEvent.change(screen.getByLabelText('查看版本'), { target: { value: 'release' } })
  expect(screen.queryByRole('button', { name: '批量删除' })).not.toBeInTheDocument()
})
it('separates MLPS levels in the framework filter without another filter', () => {
  browse([browseControl('LEVEL-TWO'), browseControl('LEVEL-THREE', 'MLPS', 3, 'MLPS3_REFERENCE')])
  expect(screen.getByRole('option', { name: 'MLPS Level 2' })).toBeVisible()
  expect(screen.getByRole('option', { name: 'MLPS Level 3' })).toBeVisible()
  fireEvent.change(screen.getByLabelText('来源框架'), { target: { value: 'MLPS Level 2' } })
  expect(screen.getByRole('heading', { name: 'LEVEL-TWO 原文' })).toBeVisible()
  expect(screen.queryByRole('heading', { name: 'LEVEL-THREE 原文' })).not.toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('来源框架'), { target: { value: 'MLPS Level 3' } })
  expect(screen.getByRole('heading', { name: 'LEVEL-THREE 原文' })).toBeVisible()
  expect(screen.queryByRole('heading', { name: 'LEVEL-TWO 原文' })).not.toBeInTheDocument()
})
it('combines source and applicability filters without confusing source level with system level', () => {
  browse([browseControl('MLPS-2'), browseControl('MLPS-3', 'MLPS', 3), browseControl('NIST-1', 'NIST', 2)])
  fireEvent.change(screen.getByLabelText('来源框架'), { target: { value: 'MLPS Level 3' } })
  fireEvent.change(screen.getByLabelText('来源标准等级'), { target: { value: '3' } })
  fireEvent.change(screen.getByLabelText('系统适用等级'), { target: { value: 'L2' } })
  expect(screen.getByRole('heading', { name: 'MLPS-3 原文' })).toBeVisible()
  expect(screen.queryByRole('heading', { name: 'MLPS-2 原文' })).not.toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'NIST-1 原文' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByText('Switch'))
  expect(screen.getByLabelText('Source standard level')).toHaveValue('3')
  expect(screen.getByRole('heading', { name: 'MLPS-3 原文' })).toBeVisible()
  fireEvent.change(screen.getByLabelText('System applicability level'), { target: { value: 'L3' } })
  expect(screen.getByText('No controls match these filters. Adjust or clear them.')).toBeVisible()
  fireEvent.click(screen.getByText('Clear filters'))
  expect(screen.getByRole('heading', { name: 'NIST-1 原文' })).toBeVisible()
})
it('reads historical controls with their published profile definitions and disables editing', () => {
  browse([browseControl('DRAFT')])
  fireEvent.change(screen.getByLabelText('查看版本'), { target: { value: 'release' } })
  fireEvent.change(screen.getByLabelText('系统适用等级'), { target: { value: 'L3' } })
  expect(screen.getByRole('heading', { name: 'HISTORY 原文' })).toBeVisible()
  expect(screen.queryByRole('button', { name: '编辑' })).not.toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'DRAFT 原文' })).not.toBeInTheDocument()
})
it('distinguishes an empty library from an empty filter result and resets pagination', () => {
  browse(Array.from({ length: 31 }, (_, i) => browseControl(`ROW-${i}`)))
  fireEvent.click(screen.getByText('下一页'))
  expect(screen.getByRole('heading', { name: 'ROW-30 原文' })).toBeVisible()
  fireEvent.change(screen.getByLabelText('搜索控制'), { target: { value: 'ROW-0' } })
  expect(screen.getByRole('heading', { name: 'ROW-0 原文' })).toBeVisible()
  expect(screen.getByRole('button', { name: '上一页' })).toBeDisabled()
  cleanup()
  browse([])
  expect(screen.getByRole('heading', { name: '当前版本尚无控制条目' })).toBeVisible()
})


it('publishes unreviewed controls directly with one explicit click', async () => {
  const item = { ...browseControl('DIRECT'), review_status: 'draft' }
  const state: LibraryState = { version: 4, published_id: null, config, controls: [item], can_edit: true }
  const writes: unknown[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
    if (options?.method === 'POST') {
      writes.push(JSON.parse(String(options.body)))
      return new Response(JSON.stringify({ state: { ...state, version: 5, published_id: 'new' } }))
    }
    return new Response(JSON.stringify(url.endsWith('/history') ? [] : state))
  }))
  render(<QueryClientProvider client={new QueryClient()}><LocaleProvider><ControlLibrary /></LocaleProvider></QueryClientProvider>)
  const button = await screen.findByRole('button', { name: '一键发布' })
  expect(button).toBeEnabled()
  expect(writes).toHaveLength(0)
  fireEvent.click(button)
  await waitFor(() => expect(writes).toEqual([{ version: 4, publication_mode: 'direct' }]))
  expect(await screen.findByText('控制库已一键发布。返回评估加载最新控制库并重新确认分级，即可继续。')).toBeVisible()
})
