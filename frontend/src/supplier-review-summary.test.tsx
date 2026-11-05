import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, useLocation } from 'react-router-dom'
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
function LocationView() { return <output data-testid="location">{useLocation().pathname}</output> }

function withReport(): SystemDetail {
  const detail = fixture()
  detail.report = { id: 'report', mode: 'local', reviewed: false, decisions: {},
    source_assessment: { status: 'pending', high_requirements: ['REQ-1', 'REQ-3', 'REQ-4'],
      failed_requirements: [], blocking_requirements: ['REQ-1', 'REQ-3'], clarification_requirements: ['REQ-3'] },
    data: { summary: 'Local review', findings: detail.supplier_review!.items.map((item, i) => ({
      id: `F-${i + 1}`, requirement_id: item.requirement_id, severity: i === 0 ? 'high' : i === 1 ? 'medium' : 'unknown',
      title: `Finding ${i + 1}`, evidence_field: 'limitations', evidence: item.answer.limitations || 'yes',
      impact: `待验证的影响 ${i + 1}`, recommendation: `Review recommendation ${i + 1}`,
    })) } }
  return detail
}

function row(n: number) { return within(screen.getByText(`需求原文 ${n}`).closest('tr')!) }

function show(detail: SystemDetail, vendor = false) {
  return render(<QueryClientProvider client={new QueryClient()}><LocaleProvider><AuthContext.Provider value={{ user: { id: 'u', name: 'Owner', email: 'test@example.test', role: vendor ? 'vendor' : 'owner', org_id: 'org' }, csrf: '', model_configured: true }}><Preferences><MemoryRouter><LanguageSwitch /><LocationView /><ImpactPanel detail={detail} /></MemoryRouter></Preferences></AuthContext.Provider></LocaleProvider></QueryClientProvider>)
}

it.each(['changes', 'accept'] as const)('saves current owner decisions and advances the %s workflow', async decision => {
  const detail = withReport()
  detail.report!.decisions = Object.fromEntries(detail.report!.data.findings.map(f => [f.id, { decision: 'accept', reason: 'Owner reviewed the commitment', owner_reviewed: true }]))
  detail.report!.decisions['F-1'] = { decision, reason: '使用指定工具', owner_reviewed: decision === 'accept' }
  const result = { ...detail, system: { ...detail.system, status: decision === 'changes' ? 'VENDOR_FILLING' : 'FINAL_CONFIRMATION' },
    baseline: decision === 'accept' ? { id: 'baseline', content_hash: 'hash', confirmations: [], finalized: false } : null }
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => result })
  vi.stubGlobal('fetch', fetcher)
  show(detail)
  fireEvent.click(screen.getByRole('button', { name: '保存审查决定' }))
  await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(decision === 'changes' ? '/systems/s/supplier' : '/systems/s/agreement'))
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ report_id: 'report', advance_workflow: true, decisions: { 'F-1': { decision, reason: '使用指定工具' } } })
})

it('shows Medium after saved high-risk acceptance while retaining the original source', () => {
  const detail = withReport()
  detail.report!.reviewed = true
  detail.report!.decisions['F-1'] = { decision: 'accept', reason: '负责人承担风险', owner_reviewed: true, residual_severity: 'medium' }
  detail.supplier_review!.items[0] = { ...detail.supplier_review!.items[0], owner_accepted: true, residual_risk: 'medium' }
  detail.supplier_review!.counts.owner_accepted = 1
  show(detail, true)
  fireEvent.click(screen.getByRole('button', { name: '负责人已接受 (1)' }))
  expect(row(1).getByText('接受后：中风险')).toBeVisible()
  expect(row(1).getByText('已接受 · 中风险')).toBeVisible()
  fireEvent.click(row(1).getByText('控制项原文与来源'))
  expect(row(1).getByText('来源风险：高风险')).toBeVisible()
  expect(row(1).getByText('负责人承担风险')).toBeVisible()
  expect(screen.queryByRole('button', { name: '保存审查决定' })).not.toBeInTheDocument()
})

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
  expect(screen.getByRole('button', { name: '按需启动 AI 影响评估' })).toBeVisible()
  expect(screen.queryByText('后续审查与双方确认')).not.toBeInTheDocument()
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

it('reviews inside the domain table, preserves filtered decisions and requires individual high-risk clarification', async () => {
  const detail = withReport()
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => detail })
  vi.stubGlobal('fetch', fetcher)
  show(detail)
  expect(screen.queryByText('后续审查与双方确认')).not.toBeInTheDocument()
  expect(screen.queryByText('影响评估与处理')).not.toBeInTheDocument()
  expect(screen.getByRole('columnheader', { name: '负责人审查' })).toBeVisible()
  expect(screen.getByRole('columnheader', { name: '风险与辅助分析' })).toBeVisible()
  expect(screen.getByText('本地规则草稿')).toBeVisible()
  expect(row(1).getByRole('option', { name: '接受并承担已记录残余风险' })).toBeEnabled()
  expect(row(3).getByLabelText('负责人决定')).toBeVisible()
  expect(fetcher).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '一键接受可实施项 (2)' }))
  fireEvent.change(screen.getByLabelText('批量审查理由'), { target: { value: 'Shared follow-up' } })
  fireEvent.click(screen.getByRole('button', { name: '接受未处理项并记录理由' }))
  expect(row(1).getByLabelText('负责人决定')).toHaveValue('')
  fireEvent.change(row(1).getByLabelText('负责人决定'), { target: { value: 'changes' } })
  fireEvent.change(row(1).getByLabelText('理由与责任安排'), { target: { value: 'Shared follow-up' } })
  expect(row(3).getByLabelText('负责人决定')).toHaveValue('')
  expect(row(3).getByLabelText('理由与责任安排')).toHaveValue('')
  fireEvent.change(row(3).getByLabelText('负责人决定'), { target: { value: 'accept' } })
  fireEvent.change(row(3).getByLabelText('理由与责任安排'), { target: { value: '负责人落实补充证据并承担残余风险' } })
  fireEvent.change(screen.getByLabelText('搜索开发项'), { target: { value: 'REQ-1' } })
  expect(screen.queryByText('需求原文 3')).not.toBeInTheDocument()
  expect(screen.getByText('40.0%')).toBeVisible()
  fireEvent.change(screen.getByLabelText('搜索开发项'), { target: { value: '' } })
  expect(row(3).getByLabelText('负责人决定')).toHaveValue('accept')
  expect(row(3).getByLabelText('理由与责任安排')).toHaveValue('负责人落实补充证据并承担残余风险')
  expect(screen.getByRole('button', { name: '待负责人审查 (0)' })).toBeVisible()
  expect(screen.queryByText('例外与排除项审查')).not.toBeInTheDocument()
  expect(screen.queryByLabelText('例外审查结论')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '保存审查决定' })).toBeEnabled()
  fireEvent.click(screen.getByRole('button', { name: '保存审查决定' }))
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).not.toHaveProperty('exception_reason')
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ version: 1, decisions: {
    'F-1': { decision: 'changes', reason: 'Shared follow-up' },
    'F-3': { decision: 'accept', owner_reviewed: true, reason: '负责人落实补充证据并承担残余风险' },
    'F-4': { decision: 'accept' }, 'F-5': { decision: 'accept' },
  } })
  expect(screen.getByRole('button', { name: '冻结方案并收集双方确认' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'English' }))
  expect(row(3).getByLabelText('Owner decision')).toHaveValue('accept')
  expect(row(3).getByLabelText('Rationale and accountability')).toHaveValue('负责人落实补充证据并承担残余风险')
})

it('keeps all findings of a requirement independently reviewable and counts pending requirements once', () => {
  const detail = withReport()
  detail.report!.data.findings.push({ ...detail.report!.data.findings[1], id: 'F-extra', title: 'Second finding' })
  show(detail)
  expect(row(2).getAllByLabelText('负责人决定')).toHaveLength(2)
  expect(screen.getByRole('button', { name: '待负责人审查 (5)' })).toBeVisible()
  fireEvent.change(row(2).getAllByLabelText('负责人决定')[0], { target: { value: 'accept' } })
  fireEvent.change(row(2).getAllByLabelText('理由与责任安排')[0], { target: { value: 'First finding addressed' } })
  expect(screen.getByRole('button', { name: '待负责人审查 (5)' })).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '待负责人审查 (5)' }))
  expect(row(2).getByText('Second finding')).toBeVisible()
  expect(screen.getByRole('button', { name: '保存审查决定' })).toBeDisabled()
})

it('fills the three authored review examples without saving, can undo, and requires individual high-risk acknowledgement', async () => {
  const detail = withReport()
  const clauses = [
    '当进行远程管理时，应采取必要措施防止鉴别信息在网络传输过程中被窃听。',
    '应安装防恶意代码软件或配置具有相应功能的软件，并定期进行升级和更新防恶意代码库。',
    '应在外部人员接入受控网络访问系统前先提出书面申请，批准后由专人开设账户、分配权限，并登记备案；',
  ]
  for (let i = 0; i < 3; i++) {
    Object.assign(detail.supplier_review!.items[i], { description: clauses[i], source_risk: 'high', status: i ? 'needs_clarification' : 'no' })
  }
  Object.assign(detail.report!.source_assessment!, { blocking_requirements: ['REQ-1', 'REQ-2', 'REQ-3'], clarification_requirements: ['REQ-2', 'REQ-3'] })
  detail.report!.decisions['F-4'] = { decision: 'accept', reason: 'Keep other authored decision' }
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => detail })
  vi.stubGlobal('fetch', fetcher)
  show(detail)
  fireEvent.change(row(1).getByLabelText('负责人决定'), { target: { value: 'changes' } })
  fireEvent.change(row(1).getByLabelText('理由与责任安排'), { target: { value: 'Before Demo, unsaved' } })
  fireEvent.click(screen.getByRole('button', { name: '一键填入 Demo' }))
  expect(row(1).getByLabelText('负责人决定')).toHaveValue('changes')
  expect(row(1).getByLabelText('理由与责任安排')).toHaveValue('使用指定工具')
  expect(row(2).getByLabelText('理由与责任安排')).toHaveValue('定期进行漏洞和系统安全评估')
  expect(row(3).getByLabelText('理由与责任安排')).toHaveValue('需经过正是审批流程')
  expect(row(2).getByLabelText('负责人决定')).toHaveValue('accept')
  expect(row(3).getByLabelText('负责人决定')).toHaveValue('accept')
  expect(screen.getAllByRole('checkbox', { name: '我已逐项核对本项决定与责任安排' })).toHaveLength(2)
  expect(fetcher).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '撤销填入' }))
  expect(row(1).getByLabelText('理由与责任安排')).toHaveValue('Before Demo, unsaved')
  expect(row(2).getByLabelText('负责人决定')).toHaveValue('')
  fireEvent.click(screen.getByRole('button', { name: '一键填入 Demo' }))
  fireEvent.click(screen.getByRole('button', { name: '一键接受可实施项 (1)' }))
  expect(screen.getByRole('button', { name: '保存审查决定' })).toBeDisabled()
  fireEvent.click(row(2).getByRole('checkbox', { name: '我已逐项核对本项决定与责任安排' }))
  expect(screen.getByRole('button', { name: '保存审查决定' })).toBeDisabled()
  fireEvent.click(row(3).getByRole('checkbox', { name: '我已逐项核对本项决定与责任安排' }))
  expect(screen.getByRole('button', { name: '保存审查决定' })).toBeEnabled()
  expect(screen.queryByLabelText('例外审查结论')).not.toBeInTheDocument()
  expect(fetcher).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '保存审查决定' }))
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ decisions: {
    'F-1': { decision: 'changes', reason: '使用指定工具' },
    'F-2': { decision: 'accept', owner_reviewed: true, reason: '定期进行漏洞和系统安全评估' },
    'F-3': { decision: 'accept', owner_reviewed: true, reason: '需经过正是审批流程' },
    'F-4': { decision: 'accept', reason: 'Keep other authored decision' },
  } })
})

it('runs single-item AI only on request inside its table row and preserves review input', async () => {
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ findings: [{
    residual_risk: '单条模型建议',
  }] }) })
  vi.stubGlobal('fetch', fetcher)
  show(withReport())
  fireEvent.change(row(1).getByLabelText('负责人决定'), { target: { value: 'changes' } })
  fireEvent.change(row(1).getByLabelText('理由与责任安排'), { target: { value: '保留我的审查意见' } })
  expect(fetcher).not.toHaveBeenCalled()
  fireEvent.click(row(1).getByRole('button', { name: 'AI 分析残余风险' }))
  await waitFor(() => expect(row(1).getByText('单条模型建议')).toBeVisible())
  expect(fetcher.mock.calls[0][0]).toBe('/api/v1/systems/s/requirement-risk')
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ report_id: 'report', requirement_id: 'REQ-1' })
  expect(row(1).getByText('AI 残余风险 · 待核对')).toBeVisible()
  expect(row(2).queryByText('单条模型建议')).not.toBeInTheDocument()
  expect(row(1).getByLabelText('理由与责任安排')).toHaveValue('保留我的审查意见')
  expect(row(1).getByRole('option', { name: '接受并承担已记录残余风险' })).toBeEnabled()
})

it('shows submitted decisions read-only for suppliers and links to independent baseline confirmation', () => {
  const detail = withReport()
  detail.report!.decisions['F-1'] = { decision: 'changes', reason: 'Saved owner rationale' }
  detail.baseline = { id: 'baseline', content_hash: 'same-hash', finalized: false, confirmations: [{ party: 'customer', actor_id: 'customer', created_at: 1 }] }
  detail.system.status = 'FINAL_CONFIRMATION'
  show(detail, true)
  expect(row(1).getByText('Saved owner rationale')).toBeVisible()
  expect(screen.queryByLabelText('负责人决定')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '保存审查决定' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /一键接受/ })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '一键填入 Demo' })).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: '查看并确认基线' })).toHaveAttribute('href', '/systems/s/agreement')
  expect(screen.queryByRole('button', { name: '确认这份基线' })).not.toBeInTheDocument()
})

it('only schedules subsequent review after the owner explicitly requests it', async () => {
  const detail = fixture()
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => detail })
  vi.stubGlobal('fetch', fetcher)
  show(detail)
  expect(screen.getByRole('button', { name: '开始人工审查（本地规则）' })).toBeVisible()
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
