import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import { ImpactPanel } from './downstream'
import { AuthContext, Preferences } from './components'
import { LocaleProvider } from './i18n'
import type { SystemDetail } from './types'

afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals() })

it('shows a specific single-item error only on its card and shows only a brief residual risk on retry', async () => {
  const detail: SystemDetail = {
    system: { id: 's', name: 'Test', status: 'RESULT_REVIEW', version: 4, revision: 1,
      context: {}, draft: {}, classification: {}, created_at: 0, updated_at: 0 },
    permissions: ['read', 'edit', 'review', 'manage'], controls: [], prd: null, round: null, baseline: null,
    report: { id: 'r', mode: 'local', reviewed: false, decisions: {}, data: { summary: 'Review', findings: [1, 2].map(n => ({
      id: `F-${n}`, requirement_id: `REQ-${n}`, severity: 'high', title: `Risk ${n}`,
      evidence_field: 'limitations', evidence: `Supplier limitation ${n}`, impact: 'Pending', recommendation: 'Verify',
    })) } },
  }
  const fetcher = vi.fn()
    .mockResolvedValueOnce({ ok: false, json: async () => ({ code: 'INVALID_SOURCE_REFERENCE' }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ findings: [{ residual_risk: 'Credentials may be exposed.' }] }) })
  vi.stubGlobal('fetch', fetcher)
  render(<QueryClientProvider client={new QueryClient()}><LocaleProvider><AuthContext.Provider value={{
    user: { id: 'm', name: 'Manager', email: 'm@test', role: 'member', org_id: 'org' }, csrf: '', model_configured: true,
  }}><Preferences><MemoryRouter><ImpactPanel detail={detail} /></MemoryRouter></Preferences></AuthContext.Provider></LocaleProvider></QueryClientProvider>)
  const first = within(screen.getByText('Supplier limitation 1').closest('article')!)
  const second = within(screen.getByText('Supplier limitation 2').closest('article')!)
  fireEvent.change(first.getByLabelText('客户决定'), { target: { value: 'changes' } })
  fireEvent.change(first.getByLabelText('理由与责任安排'), { target: { value: 'Require verification before release' } })
  fireEvent.click(first.getByRole('button', { name: 'AI 分析残余风险' }))
  await waitFor(() => expect(first.getByText('输出引用了无效来源，未发布结果。')).toBeVisible())
  expect(second.queryByText('输出引用了无效来源，未发布结果。')).not.toBeInTheDocument()
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ version: 4, report_id: 'r', requirement_id: 'REQ-1', language: 'zh' })
  fireEvent.click(first.getByRole('button', { name: 'AI 分析残余风险' }))
  await waitFor(() => expect(first.getByText('Credentials may be exposed.')).toBeVisible())
  expect(first.queryByText('输出引用了无效来源，未发布结果。')).not.toBeInTheDocument()
  expect(first.queryByText('处理建议')).not.toBeInTheDocument()
  expect(first.queryByText('引用依据')).not.toBeInTheDocument()
  expect(first.getByLabelText('客户决定')).toHaveValue('changes')
  expect(first.getByLabelText('理由与责任安排')).toHaveValue('Require verification before release')
  expect(fetcher).toHaveBeenCalledTimes(2)
})

it('explains why accepted findings still need rationale, including hidden findings', () => {
  const detail: SystemDetail = {
    system: { id: 's', name: 'Test', status: 'RESULT_REVIEW', version: 1, revision: 1,
      context: {}, draft: {}, classification: {}, created_at: 0, updated_at: 0 },
    permissions: ['read', 'edit', 'review', 'manage'], controls: [], prd: null, round: null, baseline: null,
    report: { id: 'r', mode: 'local', reviewed: false, decisions: {
      f: { decision: 'accept', reason: '' }, _exceptions: { decision: 'accept', reason: 'No exceptions' },
    }, data: { summary: 'Review', findings: [{ id: 'f', requirement_id: 'REQ-1', severity: 'unknown',
      title: 'Evidence', evidence_field: 'implementation_plan', evidence: 'Plan', impact: 'Pending', recommendation: 'Verify' }] } },
  }
  render(<QueryClientProvider client={new QueryClient()}><LocaleProvider><AuthContext.Provider value={{
    user: { id: 'm', name: 'Manager', email: 'm@test', role: 'member', org_id: 'org' }, csrf: '', model_configured: false,
  }}><Preferences><MemoryRouter><ImpactPanel detail={detail} /></MemoryRouter></Preferences></AuthContext.Provider></LocaleProvider></QueryClientProvider>)
  expect(screen.getByRole('button', { name: '保存并下发至供应商' })).toBeDisabled()
  expect(screen.getByRole('status')).toHaveTextContent('还有 1 项未填写理由与责任安排')
  fireEvent.change(screen.getByLabelText('筛选严重度'), { target: { value: 'high' } })
  expect(screen.getByRole('status')).toHaveTextContent('还有 1 项未填写理由与责任安排')
  fireEvent.change(screen.getByLabelText('筛选严重度'), { target: { value: 'all' } })
  fireEvent.click(screen.getByRole('button', { name: /点击查看与审查/ }))
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('理由与责任安排'), { target: { value: 'Owner will verify evidence before release' } })
  expect(screen.getByRole('button', { name: '保存并下发至供应商' })).toBeEnabled()
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
})

it('includes supplier commitments without another owner acceptance and allows joint confirmation', () => {
  const detail: SystemDetail = {
    system: { id: 's', name: 'Test', status: 'RESULT_REVIEW', version: 1, revision: 1,
      context: {}, draft: {}, classification: {}, created_at: 0, updated_at: 0 },
    permissions: ['read', 'edit', 'review', 'manage'], controls: [], prd: null, round: { id: 'round', status: 'submitted', version: 1, supplier_org_id: 'supplier', draft: { 'REQ-1': { implementation_status: 'yes', duration_workdays: 5, owner_name: 'Supplier', implementation_plan: 'Deliver', limitations: '', alternative: '' } } }, baseline: null,
    report: { id: 'r', mode: 'local', reviewed: false, decisions: {
      f: { decision: '', reason: '' }, _exceptions: { decision: 'accept', reason: 'No exceptions' },
    }, data: { summary: 'Review', findings: [{ id: 'f', requirement_id: 'REQ-1', severity: 'unknown',
      title: 'Evidence', evidence_field: 'implementation_plan', evidence: 'Plan', impact: 'Pending', recommendation: 'Verify' }] } },
  }
  render(<QueryClientProvider client={new QueryClient()}><LocaleProvider><AuthContext.Provider value={{
    user: { id: 'm', name: 'Manager', email: 'm@test', role: 'member', org_id: 'org' }, csrf: '', model_configured: false,
  }}><Preferences><MemoryRouter><ImpactPanel detail={detail} /></MemoryRouter></Preferences></AuthContext.Provider></LocaleProvider></QueryClientProvider>)
  expect(screen.queryByRole('button', { name: /一键接受可实施项/ })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '保存并下发至供应商' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '冻结方案并收集双方确认' })).toBeEnabled()
  fireEvent.click(screen.getByRole('button', { name: /点击查看与审查/ }))
  expect(screen.getByText('供应商已确认开发')).toBeVisible()
  expect(screen.queryByLabelText('客户决定')).not.toBeInTheDocument()
  expect(screen.queryByLabelText('理由与责任安排')).not.toBeInTheDocument()
})

it('requires explicit owner acceptance before freezing a source High gap', () => {
  const detail: SystemDetail = {
    system: { id: 's', name: 'Test', status: 'RESULT_REVIEW', version: 1, revision: 1, context: {}, draft: {}, classification: {}, created_at: 0, updated_at: 0 },
    permissions: ['read', 'edit', 'review', 'manage'], controls: [], prd: null, round: null, baseline: null,
    report: { id: 'r', mode: 'local', reviewed: true, source_assessment: { status: 'failed', failed_requirements: ['REQ-1'], blocking_requirements: ['REQ-1'] },
      decisions: { f: { decision: '', reason: '' }, _exceptions: { decision: 'accept', reason: 'Reviewed' } },
      data: { summary: 'Review', findings: [{ id: 'f', requirement_id: 'REQ-1', severity: 'low', title: 'Finding', evidence_field: 'limitations', evidence: 'Cannot implement', impact: 'Gap', recommendation: 'Revise' }] } },
  }
  render(<QueryClientProvider client={new QueryClient()}><LocaleProvider><AuthContext.Provider value={{ user: { id: 'm', name: 'Manager', email: 'm@test', role: 'member', org_id: 'org' }, csrf: '', model_configured: false }}><Preferences><MemoryRouter><ImpactPanel detail={detail} /></MemoryRouter></Preferences></AuthContext.Provider></LocaleProvider></QueryClientProvider>)
  expect(screen.getByText('系统安全评估结果：未通过')).toBeVisible()
  expect(screen.getByRole('button', { name: '冻结方案并收集双方确认' })).toBeDisabled()
  expect(screen.getByRole('option', { name: '接受并承担已记录残余风险' })).toBeEnabled()
})

it('expands source High clarification, includes it in high-risk filters and requires an individual owner decision', async () => {
  const detail: SystemDetail = {
    system: { id: 's', name: 'Test', status: 'RESULT_REVIEW', version: 4, revision: 1, context: {}, draft: {}, classification: {}, created_at: 0, updated_at: 0 },
    permissions: ['read', 'review', 'manage'], controls: [], prd: null, baseline: null,
    round: { id: 'round', status: 'submitted', version: 1, supplier_org_id: 'supplier', draft: {
      'REQ-C': { implementation_status: 'needs_clarification', duration_workdays: null, owner_name: '', implementation_plan: '', limitations: 'Clarify the hosting responsibility', alternative: '' },
      'REQ-Y': { implementation_status: 'yes', duration_workdays: null, owner_name: '', implementation_plan: '', limitations: '', alternative: '' },
    } },
    report: { id: 'report', mode: 'local', reviewed: false, source_assessment: {
      status: 'pending', failed_requirements: [], blocking_requirements: ['REQ-C'], high_requirements: ['REQ-C'], clarification_requirements: ['REQ-C'],
    }, decisions: { _exceptions: { decision: 'accept', reason: 'Reviewed exceptions' } }, data: { summary: 'Review', findings: [
      { id: 'F-C', requirement_id: 'REQ-C', severity: 'unknown', title: 'Clarification', evidence_field: 'limitations', evidence: 'Clarify the hosting responsibility', impact: 'Responsibility is unknown', recommendation: 'Owner must decide' },
      { id: 'F-Y', requirement_id: 'REQ-Y', severity: 'unknown', title: 'Evidence pending', evidence_field: 'implementation_status', evidence: 'yes', impact: 'Pending evidence', recommendation: 'Verify at acceptance' },
    ] } },
  }
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => detail })
  vi.stubGlobal('fetch', fetcher)
  render(<QueryClientProvider client={new QueryClient()}><LocaleProvider><AuthContext.Provider value={{
    user: { id: 'm', name: 'Manager', email: 'm@test', role: 'member', org_id: 'org' }, csrf: '', model_configured: false,
  }}><Preferences><MemoryRouter><ImpactPanel detail={detail} /></MemoryRouter></Preferences></AuthContext.Provider></LocaleProvider></QueryClientProvider>)
  expect(screen.getByText('高风险待澄清项需负责人逐项决定')).toBeVisible()
  expect(screen.getByLabelText('负责人决定')).toBeVisible()
  expect(screen.getByText('Clarify the hosting responsibility').closest('article')).toHaveClass('risk-tone-high', 'expanded-risk-card')
  expect(screen.getByRole('option', { name: '接受并承担已记录残余风险' })).toBeEnabled()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.queryByLabelText('批量审查理由')).not.toBeInTheDocument()
  expect(screen.getByLabelText('负责人决定')).toHaveValue('')
  expect(screen.getByLabelText('理由与责任安排')).toHaveValue('')
  expect(screen.getByRole('button', { name: '保存并下发至供应商' })).toBeDisabled()
  fireEvent.change(screen.getByLabelText('筛选严重度'), { target: { value: 'major' } })
  expect(screen.getByLabelText('负责人决定')).toBeVisible()
  expect(screen.queryByText('Evidence pending')).not.toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('负责人决定'), { target: { value: 'accept' } })
  expect(screen.getByRole('button', { name: '保存并下发至供应商' })).toBeDisabled()
  fireEvent.change(screen.getByLabelText('理由与责任安排'), { target: { value: '安全负责人承担宿主机防护责任，发布前补充验收证据。' } })
  expect(screen.getByRole('button', { name: '保存并下发至供应商' })).toBeEnabled()
  expect(screen.getByRole('button', { name: '冻结方案并收集双方确认' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: '保存并下发至供应商' }))
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ version: 4, decisions: {
    'F-C': { decision: 'accept', owner_reviewed: true, reason: '安全负责人承担宿主机防护责任，发布前补充验收证据。' },
  } })
})
