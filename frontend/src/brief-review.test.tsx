import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import { BriefReviewPanel } from './BriefReview'
import { DiscoveryPanel } from './narrative'
import { emptyBrief, gradingFacts } from './brief'
import { AuthContext, Preferences } from './components'
import { LocaleProvider } from './i18n'
import type { Brief, Session, SystemDetail } from './types'

const brief: Brief = { ...emptyBrief(), summary: 'Confirmed service purpose', functions: [{ id: 'F-001', title: 'Create tickets', description: 'Create a service request', source_blocks: ['functions'] }], departments: ['Service'], roles: ['Operator'], owner_role: 'Service owner', scope: 'Ticket lifecycle only', questions: ['Who approves closure?'] }
const detail: SystemDetail = { system: { id: 'review-test', name: 'Portal', status: 'CONTEXT_REVIEW', revision: 1, version: 1, context: {}, draft: { blocks: { goal: 'Original authored note', functions: 'Create tickets' }, proposal: brief }, classification: { effective_level: 'L2', answers: { Q3: 'L1' } }, created_at: 1, updated_at: 1 }, controls: [], prd: null, round: null, report: null, baseline: null }
const session: Session = { user: { id: 'owner', name: 'Owner', email: 'owner@example.test', org_id: 'org', role: 'owner' }, csrf: 'csrf', model_configured: false }
function show(value = detail, description = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><LocaleProvider><AuthContext.Provider value={session}><Preferences><MemoryRouter>{description ? <DiscoveryPanel detail={value} /> : <BriefReviewPanel detail={value} />}</MemoryRouter></Preferences></AuthContext.Provider></LocaleProvider></QueryClientProvider>)
}
afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })

it('shows the structured brief with read-only evidence instead of repeating the narrative form', () => {
  show()
  expect(screen.getByLabelText('目标摘要')).toHaveValue('Confirmed service purpose')
  expect(screen.queryByLabelText('建设目标')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '01 建设目标' })).not.toBeInTheDocument()
  expect(screen.getByText('Original authored note')).toBeInTheDocument()
  expect(screen.getByText('待澄清事项')).toBeVisible()
})

it('does not match controls on page entry or before explicit confirmation', async () => {
  const fetcher = vi.fn(async (_url: string, _options?: RequestInit) => new Response(JSON.stringify({ ...detail, system: { ...detail.system, status: 'CONTROL_REVIEW', version: 2 } })))
  vi.stubGlobal('fetch', fetcher)
  show()
  expect(fetcher).not.toHaveBeenCalled()
  fireEvent.click(screen.getByLabelText('我已核对说明、职责和范围'))
  expect(fetcher).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '确认说明并匹配控制' }))
  await waitFor(() => expect(fetcher).toHaveBeenCalledOnce())
  expect(fetcher.mock.calls[0][0]).toContain('/context-confirmations')
})

it('saves narrative edits without sending or replacing the structured proposal', async () => {
  const fetcher = vi.fn(async (_url: string, options: RequestInit) => {
    const body = JSON.parse(options.body as string)
    return new Response(JSON.stringify({ ...detail, system: { ...detail.system, version: 2, draft: { ...detail.system.draft, blocks: body.blocks } } }))
  })
  vi.stubGlobal('fetch', fetcher)
  show(detail, true)
  fireEvent.change(screen.getByLabelText('建设目标'), { target: { value: 'Updated original note' } })
  fireEvent.click(screen.getByRole('button', { name: '保存原始描述' }))
  await waitFor(() => expect(fetcher).toHaveBeenCalledOnce())
  const body = JSON.parse(fetcher.mock.calls[0][1].body as string)
  expect(Object.keys(body).sort()).toEqual(['blocks', 'version'])
  expect(body.blocks.goal).toBe('Updated original note')
  expect(screen.queryByLabelText('目标摘要')).not.toBeInTheDocument()
})

it('blocks confirmation when new applicability facts conflict with the confirmed grading inputs', () => {
  show({ ...detail, system: { ...detail.system, draft: { ...detail.system.draft, proposal: { ...brief, applicability_tags: { production_admin: 'yes' } } } } })
  fireEvent.click(screen.getByLabelText('我已核对说明、职责和范围'))
  expect(screen.getByText('分级依据存在差异')).toBeVisible()
  expect(screen.getByRole('button', { name: '保存并核对等级' })).toBeEnabled()
  expect(screen.getByRole('button', { name: '确认说明并匹配控制' })).toBeDisabled()
  expect(screen.getByText('L2')).toBeVisible()
})

it('requires missing structured information even after checking the review box', () => {
  show({ ...detail, system: { ...detail.system, draft: { ...detail.system.draft, proposal: { ...brief, owner_role: '' } } } })
  fireEvent.click(screen.getByLabelText('我已核对说明、职责和范围'))
  expect(screen.getByText('待补充必填内容')).toBeVisible()
  expect(screen.getByRole('button', { name: '确认说明并匹配控制' })).toBeDisabled()
})

it('organizes existing notes only on request after classification, without asking for repeated input', async () => {
  const empty = { ...detail, system: { ...detail.system, draft: { blocks: detail.system.draft.blocks } } }
  const fetcher = vi.fn(async (_url: string, _options?: RequestInit) => new Response(JSON.stringify(empty)))
  vi.stubGlobal('fetch', fetcher)
  show(empty)
  expect(fetcher).not.toHaveBeenCalled()
  expect(screen.queryByLabelText('建设目标')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '整理已有描述' }))
  await waitFor(() => expect(fetcher).toHaveBeenCalledOnce())
  const [path, options] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
  expect(path).toContain('/jobs')
  expect(JSON.parse(options.body as string)).toMatchObject({ kind: 'context_organization', mode: 'local' })
})

it('preserves higher known risk when deriving tag-based grading checks', () => {
  expect(gradingFacts({ applicability_tags: { personal_data: 'yes', production_admin: 'yes' } }, { Q1: 'L3', Q3: 'L1' })).toEqual({ Q3: 'L3' })
})

it('keeps newer edits when a delayed save response arrives while another save is waiting', async () => {
  vi.useFakeTimers()
  const pending: (() => void)[] = []
  const bodies: { proposal: Brief; version: number }[] = []
  vi.stubGlobal('fetch', vi.fn((_url: string, options: RequestInit) => {
    const body = JSON.parse(options.body as string)
    bodies.push(body)
    return new Promise<Response>(resolve => pending.push(() => resolve(new Response(JSON.stringify({
      ...detail, system: { ...detail.system, version: body.version + 1, draft: { ...detail.system.draft, proposal: body.proposal } },
    })))))
  }))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  function LiveReview() {
    const query = useQuery({ queryKey: ['system', detail.system.id], queryFn: async () => detail, initialData: detail })
    return <BriefReviewPanel detail={query.data} />
  }
  render(<QueryClientProvider client={client}><LocaleProvider><AuthContext.Provider value={session}><Preferences><MemoryRouter><LiveReview /></MemoryRouter></Preferences></AuthContext.Provider></LocaleProvider></QueryClientProvider>)
  fireEvent.change(screen.getByLabelText('目标摘要'), { target: { value: 'First edit' } })
  fireEvent.click(screen.getByRole('button', { name: '保存说明修改' }))
  fireEvent.change(screen.getByLabelText('目标摘要'), { target: { value: 'Newer edit while saving' } })
  await act(async () => { await vi.advanceTimersByTimeAsync(1100) })
  await act(async () => { pending.shift()!(); await vi.advanceTimersByTimeAsync(1) })
  expect(screen.getByLabelText('目标摘要')).toHaveValue('Newer edit while saving')
  expect(bodies[1].proposal.summary).toBe('Newer edit while saving')
  await act(async () => { pending.shift()!(); await vi.advanceTimersByTimeAsync(1) })
  expect(screen.getByLabelText('目标摘要')).toHaveValue('Newer edit while saving')
})

it('fills demo notes only on request and restores authored text on undo', () => {
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  show(detail, true)
  fireEvent.click(screen.getByRole('button', { name: '一键填入 Demo' }))
  expect((screen.getByLabelText('建设目标') as HTMLTextAreaElement).value).toContain('客户服务门户')
  expect(fetcher).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '撤销填入' }))
  expect(screen.getByLabelText('建设目标')).toHaveValue('Original authored note')
  expect(fetcher).not.toHaveBeenCalled()
})


it('explains unpublished controls before confirmation and preserves editable required brief fields', () => {
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  show({ ...detail, system: { ...detail.system, classification: { scheme: 'SYS-SCREEN/2', effective_level: 'L3', controls_ready: false, frameworks: ['MLPS'], missing_frameworks: ['MLPS'] } } })
  expect(screen.getByRole('alert')).toHaveTextContent('下一步前置条件：已发布且匹配所选方案的控制库')
  expect(screen.getByRole('link', { name: '查看控制条目库' })).toHaveAttribute('href', '/library')
  expect(screen.getByRole('button', { name: '保存说明并前往确认等级' })).toBeEnabled()
  for (const name of ['目标摘要', '范围与不做事项', '功能 1', '涉及部门', '使用和审批角色', '业务责任角色']) {
    const field = screen.getByRole('textbox', { name })
    expect(field).toBeRequired()
    expect(field.closest('label')?.querySelector('.required-mark')).toHaveTextContent('必填')
  }
  expect(screen.getByRole('textbox', { name: '功能说明' })).not.toBeRequired()
  expect(screen.getByRole('textbox', { name: '业务流程' })).not.toBeRequired()
  fireEvent.click(screen.getByRole('checkbox', { name: '我已核对说明、职责和范围' }))
  expect(screen.getByRole('button', { name: '确认说明并匹配控制' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '保存说明修改' })).toBeEnabled()
  expect(fetcher).not.toHaveBeenCalled()
})

it('allows confirmation with a ready published profile and marks a missing required field locally', () => {
  show({ ...detail, system: { ...detail.system, classification: { scheme: 'SYS-SCREEN/2', effective_level: 'L3', controls_ready: true }, draft: { ...detail.system.draft, proposal: { ...brief, owner_role: '' } } } })
  const owner = screen.getByRole('textbox', { name: '业务责任角色' })
  expect(owner).toHaveAttribute('aria-invalid', 'true')
  expect(screen.getByText('请补充业务责任角色')).toBeVisible()
  fireEvent.change(owner, { target: { value: '业务责任人' } })
  fireEvent.click(screen.getByRole('checkbox', { name: '我已核对说明、职责和范围' }))
  expect(screen.getByRole('button', { name: '确认说明并匹配控制' })).toBeEnabled()
})


it('opens an editable questionnaire-prefilled brief without the retired information page', () => {
  show({ ...detail, system: { ...detail.system, draft: {}, classification: {
    effective_level: 'L2', scheme: 'MLPS-INTAKE/1', controls_ready: true,
    answers: { system_purpose: 'Authored purpose', system_functions: 'Authored function', system_scenarios: 'Authored scenario' },
  } } })
  expect(screen.getByLabelText('目标摘要')).toHaveValue('Authored purpose')
  expect(screen.getByLabelText('功能 1')).toHaveValue('Authored function')
  expect(screen.getByLabelText('业务流程')).toHaveValue('Authored scenario')
  expect(screen.getByLabelText('业务责任角色')).toHaveValue('')
  expect(screen.getByText('问卷内容预填 · 待人工核对')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '确认说明并匹配控制' })).toBeDisabled()
  expect(document.querySelector('a[href$="/discovery"]')).toBeNull()
})
