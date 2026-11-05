import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { LocaleProvider, useLocale } from './i18n'
import Library from './MLPSLibrary'

const controls = Array.from({ length: 55 }, (_, index) => ({
  id: `control-${index}`, source: index % 2 ? 'MLPS 原始来源' : '企业安全规范',
  control_identifier: `6.1.${index + 1}`, security_domain: index % 3 ? '安全计算环境' : '安全通信网络',
  security_control_point: `控制点原文 ${index + 1}`, control_requirement: `完整要求原文 ${index + 1}\n第二行必须保留`,
  risk_level: index % 4 ? 'Medium' : 'High', sheet: 'MLPS_source.xlsx', row_number: index + 2,
  mlps_level: index % 2 ? 3 : 2,
}))

function Toggle() {
  const { locale, setLocale } = useLocale()
  return <button onClick={() => setLocale(locale === 'zh' ? 'en' : 'zh')}>Switch</button>
}

function setup() {
  const writes: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
    if (options?.method && options.method !== 'GET') writes.push(url)
    return new Response(JSON.stringify({ active: true, can_upload: true, matching_ready: true, controls }))
  }))
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><LocaleProvider><Toggle /><Library /></LocaleProvider></QueryClientProvider>)
  return writes
}

afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals() })

it('paginates the source library and narrows it by domain, risk and source without writing', async () => {
  const writes = setup()
  expect(await screen.findByRole('heading', { name: '控制条目库' })).toBeVisible()
  expect(screen.getByText('55', { selector: '.catalog-metrics strong' })).toBeVisible()
  expect(screen.getAllByRole('button', { name: '查看详情' })).toHaveLength(24)
  fireEvent.click(screen.getByRole('button', { name: '下一页' }))
  expect(screen.getByText('6.1.25')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: /安全通信网络/ }))
  expect(screen.getByText('6.1.1')).toBeVisible()
  expect(screen.queryByText('6.1.2')).not.toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('风险'), { target: { value: 'High' } })
  expect(screen.getByText('6.1.1')).toBeVisible()
  expect(screen.queryByText('6.1.4')).not.toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('来源'), { target: { value: '企业安全规范' } })
  expect(screen.getByText('6.1.1')).toBeVisible()
  expect(writes).toEqual([])
})

it('keeps original requirement text and source row visible in detail while interface copy avoids acronym labels', async () => {
  setup()
  await screen.findByRole('heading', { name: '控制条目库' })
  expect(document.body.textContent).not.toMatch(/MLPS/i)
  fireEvent.click(screen.getAllByRole('button', { name: '查看详情' })[1])
  const dialog = within(screen.getByRole('dialog', { name: '控制条目详情' }))
  expect(dialog.getByText(/完整要求原文 2/).textContent).toBe('完整要求原文 2\n第二行必须保留')
  expect(dialog.getByText(/第3 行/)).toBeVisible()
  expect(dialog.queryByText(/MLPS/i)).not.toBeInTheDocument()
  fireEvent.click(screen.getByText('Switch'))
  expect(dialog.getByRole('heading', { name: 'Original requirement' })).toBeVisible()
  expect(dialog.getByText(/完整要求原文 2/).textContent).toBe('完整要求原文 2\n第二行必须保留')
})

it('opens import on demand and leaves source rows untouched until explicit upload', async () => {
  const writes = setup()
  fireEvent.click(await screen.findByRole('button', { name: '导入条目' }))
  const dialog = within(screen.getByRole('dialog', { name: '导入控制条目' }))
  expect(dialog.getByRole('button', { name: '校验并保存' })).toBeDisabled()
  expect(writes).toEqual([])
  fireEvent.click(dialog.getByText('查看导入字段'))
  expect(dialog.getByText(/control_identifier/)).toBeVisible()
})

it('keeps older read-only source releases browsable when the newer endpoint is unavailable', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/source-controls')
    ? new Response(JSON.stringify({ code: 'NOT_FOUND' }), { status: 404 })
    : new Response(JSON.stringify({ published_id: 'release', can_edit: false, config: { domains: [] }, controls: [{
      control_code: 'SOURCE-1', source_ref: '7.1', source_framework: 'MLPS', source_level: 2,
      translations: { zh: { title: '历史控制点原文', description: '历史要求原文', verification: '历史测评步骤' } },
    }] }))))
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><LocaleProvider><Library /></LocaleProvider></QueryClientProvider>)
  expect(await screen.findByText('历史控制点原文')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '查看详情' }))
  expect(screen.getByText('历史要求原文')).toBeVisible()
  expect(screen.getByText('历史测评步骤')).toBeVisible()
  expect(document.body.textContent).not.toMatch(/MLPS/i)
})
