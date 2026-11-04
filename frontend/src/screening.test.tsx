import { useState } from 'react'
import { FactFields } from './TagClassification'
import type { Config, Fact } from './libraryTypes'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { LocaleProvider } from './i18n'
import ScreeningClassification from './ScreeningClassification'
import type { SystemDetail } from './types'

afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals() })
it('offers screening without a catalog and submits explicitly selected frameworks', async () => {
  const writes: Record<string, unknown>[] = []
  vi.stubGlobal('fetch', vi.fn(async (_url: string, options?: RequestInit) => {
    if (options?.method === 'POST') {
      writes.push(JSON.parse(String(options.body)))
      return new Response(JSON.stringify({ recommended_level: 'L2', effective_level: 'L2', unknown: [], expert_review: [],
        exceptions: [], matched_rules: [], controls_ready: false, missing_frameworks: ['MLPS_LEVEL_3'], matches: [] }))
    }
    return new Response(JSON.stringify({ catalog_id: null, permissions: ['edit'], framework_options: ['MLPS_LEVEL_2', 'MLPS_LEVEL_3'], saved: {},
      config: { questions: [{ code: 'net.public_ingress', group: 'network', zh: '是否公网访问？', en: 'Public entry?', kind: 'enum', values: ['yes', 'no', 'unknown'], when: true }], profiles: [], domains: [], topics: [], thresholds: { critical_minutes: 240, important_minutes: 1440 } } }))
  }))
  const detail = { system: { id: 'screen', version: 1, classification: {} } } as SystemDetail
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><LocaleProvider><ScreeningClassification detail={detail} /></LocaleProvider></MemoryRouter></QueryClientProvider>)
  await screen.findByText('系统初步分级与框架选择')
  expect(screen.queryByText('分类方法待配置')).not.toBeInTheDocument()
  fireEvent.click(screen.getByLabelText('MLPS 2 级'))
  expect(screen.getByText('预览分级与控制范围')).toBeDisabled()
  fireEvent.click(screen.getByLabelText('MLPS 3 级'))
  fireEvent.change(screen.getByLabelText('是否公网访问？'), { target: { value: 'yes' } })
  fireEvent.click(screen.getByText('预览分级与控制范围'))
  await waitFor(() => expect(writes[0].frameworks).toEqual(['MLPS_LEVEL_3']))
  await screen.findByText(/初筛可以确认/)
  expect(writes[0].scheme).toBe('SYS-SCREEN/2')
})


it('shows saved multi-selections and keeps unknown exclusive with checkbox cards', () => {
  function Fields() {
    const [facts, setFacts] = useState<Record<string, Fact>>({ 'hosting.models': ['cloud', 'saas'] })
    const config = { questions: [{ code: 'hosting.models', group: 'network', zh: '部署方式', en: 'Hosting', kind: 'multi', values: ['cloud', 'saas', 'unknown'], when: true }] } as Config
    return <FactFields config={config} facts={facts} setFacts={setFacts} />
  }
  render(<LocaleProvider><Fields /></LocaleProvider>)
  expect(screen.getByRole('checkbox', { name: '云服务' })).toBeChecked()
  expect(screen.getByRole('checkbox', { name: 'SaaS' })).toBeChecked()
  expect(screen.getByRole('checkbox', { name: 'SaaS' }).closest('label')).toHaveClass('selected')
  fireEvent.click(screen.getByRole('checkbox', { name: '待确认' }))
  expect(screen.getByRole('checkbox', { name: '云服务' })).not.toBeChecked()
  expect(screen.getByRole('checkbox', { name: 'SaaS' })).not.toBeChecked()
  fireEvent.click(screen.getByRole('checkbox', { name: '云服务' }))
  expect(screen.getByRole('checkbox', { name: '待确认' })).not.toBeChecked()
  fireEvent.click(screen.getByRole('checkbox', { name: '云服务' }))
  expect(screen.getByRole('checkbox', { name: '待确认' })).toBeChecked()
})

it('shows the relevant rule on hover or focus and dismisses it without changing answers', async () => {
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ catalog_id: null, permissions: ['edit'], framework_options: ['MLPS'],
    saved: { facts: { 'screen.personal_count': 'under_10k', 'screen.sensitive_count': 'none' } },
    config: { questions: [
      { code: 'screen.personal_count', group: 'data', zh: '个人信息人数', en: 'Personal information count', kind: 'enum', values: ['none', 'under_10k', 'unknown'], when: true },
      { code: 'screen.sensitive_count', group: 'data', zh: '敏感个人信息人数', en: 'Sensitive personal information count', kind: 'enum', values: ['none', 'under_1k', 'unknown'], when: true },
    ], profiles: [], domains: [], topics: [], thresholds: { critical_minutes: 240, important_minutes: 1440 } },
  })))
  vi.stubGlobal('fetch', fetcher)
  const detail = { system: { id: 'screen', version: 1, classification: {} } } as SystemDetail
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><LocaleProvider><ScreeningClassification detail={detail} /></LocaleProvider></MemoryRouter></QueryClientProvider>)
  fireEvent.click(await screen.findByRole('button', { name: '数据与权限' }))
  expect(screen.queryByText('查看初筛规则与数量门槛')).not.toBeInTheDocument()
  const personal = screen.getByRole('img', { name: '个人信息人数 · 初筛规则说明' })
  expect(within(personal).queryByRole('tooltip')).not.toBeInTheDocument()
  fireEvent.mouseEnter(personal)
  expect(within(personal).getByRole('tooltip')).toHaveTextContent('达到 10 万人至少 L3')
  expect(within(personal).getByRole('tooltip')).toHaveTextContent('不是法规或 MLPS 定级人数标准')
  fireEvent.mouseLeave(personal)
  expect(within(personal).queryByRole('tooltip')).not.toBeInTheDocument()
  const sensitive = screen.getByRole('img', { name: '敏感个人信息人数 · 初筛规则说明' })
  fireEvent.focus(sensitive)
  expect(within(sensitive).getByRole('tooltip')).toHaveTextContent('达到 1 千人至少 L3')
  fireEvent.keyDown(sensitive, { key: 'Escape' })
  expect(within(sensitive).queryByRole('tooltip')).not.toBeInTheDocument()
  expect(screen.getByLabelText('个人信息人数')).toHaveValue('under_10k')
  expect(screen.getByLabelText('敏感个人信息人数')).toHaveValue('none')
  expect(fetcher).toHaveBeenCalledTimes(1)
})
