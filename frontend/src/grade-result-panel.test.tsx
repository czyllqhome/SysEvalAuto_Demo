import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import Workspace from './Workspace'
import { AuthContext, Preferences } from './components'
import { LocaleProvider } from './i18n'
import { emptyBrief } from './brief'
import type { SystemDetail } from './types'

const detail: SystemDetail = { system: { id: 'grade-view', name: 'Saved system', status: 'CONTEXT_REVIEW', revision: 2, version: 4,
  context: {}, draft: { proposal: { ...emptyBrief(), functions: [{ id: 'F1', title: 'Function', description: '', source_blocks: [] }] } },
  classification: { effective_level: 'L2', scheme: 'MLPS-INTAKE/1', frameworks: ['MLPS_LEVEL_2'], answers: { system_name: 'Saved system' },
    assessment: { status: 'preliminary_complete', proposed_level: 2, base_level: 2, business_information_level: 2, system_service_level: 1,
      special_principle_minimum: null, is_lower_bound_only: false, rule_trace: [], issues: [], alerts: [], organization_minimum: 2,
      organization_rule_trace: [{ code: 'SAVED', field: 'critical_business', answer: 'Saved answer', level: 2, zh: '已确认的分级依据', en: 'Saved grading basis' }] } },
  created_at: 1, updated_at: 1 }, permissions: ['read'], controls: [], prd: null, round: null, report: null, baseline: null }

afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals() })
function show(value = detail, tab = 'brief', vendor = false) {
  const fetcher = vi.fn(async (_url: string) => new Response(JSON.stringify(value)))
  vi.stubGlobal('fetch', fetcher)
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><LocaleProvider><AuthContext.Provider value={{ user: { id: 'u', name: 'Reader', email: 'reader@test', org_id: 'org', role: vendor ? 'vendor' : 'member' }, csrf: '', model_configured: false }}><Preferences><MemoryRouter initialEntries={[`/systems/grade-view/${tab}`]}><Routes><Route path="/systems/:id/:tab" element={<Workspace />} /></Routes></MemoryRouter></Preferences></AuthContext.Provider></LocaleProvider></QueryClientProvider>)
  return fetcher
}

it('adds a result node after grading and displays the saved snapshot without recalculation or mutation', async () => {
  const fetcher = show()
  const node = await screen.findByRole('button', { name: /2定级结果/ })
  expect(node).toBeEnabled()
  fireEvent.click(node)
  expect(await screen.findByText('当前展示已确认的定级结果快照。查看不会重新计算等级或修改问卷。')).toBeVisible()
  expect(screen.getByText('已确认的分级依据')).toBeVisible()
  expect(screen.getByRole('heading', { name: '系统等级' })).toBeVisible()
  expect(screen.queryByRole('button', { name: '确认等级，继续审查应用说明' })).not.toBeInTheDocument()
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: '返回系统定级' })).toHaveAttribute('href', '/systems/grade-view/classification')
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
  expect(fetcher.mock.calls[0][0]).toBe('/api/v1/systems/grade-view')
})

it('disables the result node until a grade is confirmed', async () => {
  const value = structuredClone(detail); value.system.classification = {}
  show(value, 'grade-result')
  expect(await screen.findByRole('button', { name: /2定级结果/ })).toBeDisabled()
  expect(screen.getByText('尚无已确认的定级结果')).toBeVisible()
})

it('does not add the customer grading-result node to the supplier workflow', async () => {
  show(detail, 'grade-result', true)
  const nav = await screen.findByRole('navigation', { name: '评估步骤' })
  expect(within(nav).queryByRole('button', { name: /定级结果/ })).not.toBeInTheDocument()
  expect(screen.queryByText('已确认的分级依据')).not.toBeInTheDocument()
})
