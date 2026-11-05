import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import { ImpactPanel } from './downstream'
import { AuthContext, Preferences } from './components'
import { LocaleProvider, useLocale } from './i18n'
import type { SupplierReview, SystemDetail } from './types'

afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals() })

function fixture(): SystemDetail {
  const states = ['no', 'partial', 'needs_clarification', 'yes', 'yes'] as const
  const review: SupplierReview = {
    round_id: 'round', submission_id: 'submission', submitted_at: 1793836800,
    counts: { total: 5, yes: 2, partial: 1, no: 1, needs_clarification: 1, unanswered: 0, attention: 3, high_unconfirmed: 2, medium_unconfirmed: 1 },
    items: states.map((status, i) => ({ requirement_id: `REQ-${i + 1}`, title: `需求原文 ${i + 1}`, description: `完整开发要求 ${i + 1}`,
      origin: i === 4 ? 'business' : 'control', source_risk: i === 1 ? 'medium' : i === 4 ? 'unknown' : 'high',
      domains: i === 4 ? [] : ['访问控制'], status, answer: { implementation_status: status, limitations: status !== 'yes' ? `供应商说明 ${i + 1}` : '', alternative: '既有补偿措施' },
      controls: i === 4 ? [] : [{ id: `C${i}`, source: 'Source', identifier: `8.1.${i}`, text: `双语原文 Original source ${i + 1}`, risk: i === 1 ? 'medium' : 'high' }],
    })),
  }
  return { system: { id: 's', name: 'Test', status: 'RESULT_REVIEW', version: 1, revision: 1,
    context: {}, draft: {}, classification: {}, created_at: 0, updated_at: 0 },
    permissions: ['read', 'review', 'manage'], controls: [], prd: null, report: null, baseline: null,
    round: { id: 'round', status: 'submitted', version: 2, supplier_org_id: 'vendor', submitted_id: 'submission', draft: {} }, supplier_review: review,
  }
}

function LanguageSwitch() { const { setLocale } = useLocale(); return <button onClick={() => setLocale('en')}>English</button> }
function show(detail: SystemDetail, vendor = false) {
  return render(<QueryClientProvider client={new QueryClient()}><LocaleProvider><AuthContext.Provider value={{ user: { id: 'u', name: 'Owner', email: 'test@example.test', role: vendor ? 'vendor' : 'owner', org_id: 'org' }, csrf: '', model_configured: true }}><Preferences><MemoryRouter><LanguageSwitch /><ImpactPanel detail={detail} /></MemoryRouter></Preferences></AuthContext.Provider></LocaleProvider></QueryClientProvider>)
}

it('shows confirmation instead of an AI result and filters source risk without changing totals', () => {
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  show(fixture())
  expect(screen.getByText('40.0%')).toBeVisible()
  expect(screen.getByRole('progressbar')).toHaveAttribute('value', '2')
  expect(screen.getByText('需求原文 1')).toBeVisible()
  expect(screen.getByText('需求原文 3')).toBeVisible()
  expect(screen.queryByText('需求原文 4')).not.toBeInTheDocument()
  expect(screen.queryByText(/系统安全评估结果/)).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /AI/ })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '中风险未确认 (1)' }))
  expect(screen.getByText('需求原文 2')).toBeVisible()
  expect(screen.queryByText('需求原文 1')).not.toBeInTheDocument()
  expect(screen.getByText('40.0%')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '全部 (5)' }))
  fireEvent.change(screen.getByLabelText('确认状态'), { target: { value: 'no' } })
  expect(screen.getByText('供应商说明 1')).toBeVisible()
  expect(screen.queryByText('需求原文 2')).not.toBeInTheDocument()
  fireEvent.click(screen.getByText('控制项原文与来源'))
  expect(screen.getByText('双语原文 Original source 1')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'English' }))
  expect(screen.getByText('Supplier review results')).toBeVisible()
  expect(screen.getByText('供应商说明 1')).toBeVisible()
  expect(screen.getByText('双语原文 Original source 1')).toBeVisible()
  expect(fetcher).not.toHaveBeenCalled()
})

it('only schedules subsequent review after the owner explicitly requests it', async () => {
  const detail = fixture()
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => detail })
  vi.stubGlobal('fetch', fetcher)
  show(detail)
  fireEvent.click(screen.getByText('后续审查与双方确认'))
  await waitFor(() => expect(screen.getByRole('button', { name: '开始人工审查（本地规则）' })).toBeVisible())
  expect(fetcher).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '开始人工审查（本地规则）' }))
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
  expect(fetcher.mock.calls[0][0]).toBe('/api/v1/systems/s/jobs')
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ kind: 'impact_analysis', mode: 'local', version: 1 })
})

it('shows a submitted acknowledgment to suppliers without customer review actions', () => {
  show(fixture(), true)
  expect(screen.getByText('答复已提交，等待负责人审查。')).toBeVisible()
  expect(screen.queryByText('后续审查与双方确认')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '发起新一轮协商' })).not.toBeInTheDocument()
})

it('keeps all confirmed items available and does not imply acceptance', () => {
  const detail = fixture()
  detail.supplier_review!.items = detail.supplier_review!.items.map(i => ({ ...i, status: 'yes' }))
  detail.supplier_review!.counts = { total: 5, yes: 5, partial: 0, no: 0, needs_clarification: 0, unanswered: 0, attention: 0, high_unconfirmed: 0, medium_unconfirmed: 0 }
  show(detail)
  expect(screen.getByText('100.0%')).toBeVisible()
  expect(screen.getByText(/本轮没有需要关注的开发项/)).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '全部 (5)' }))
  expect(within(screen.getByRole('table', { name: '访问控制' })).getAllByRole('row')).toHaveLength(5)
  expect(screen.getByText(/尚未经过实施验收/)).toBeVisible()
})

it('handles empty results and keeps unlabelled risk distinct', () => {
  const detail = fixture()
  detail.supplier_review!.items[0].source_risk = 'unknown'
  show(detail)
  expect(screen.getByText('风险未标注')).toBeVisible()
  fireEvent.change(screen.getByLabelText('搜索开发项'), { target: { value: 'does not exist' } })
  expect(screen.getByText('没有符合当前筛选条件的开发项。')).toBeVisible()
  expect(screen.getByText('40.0%')).toBeVisible()
})
