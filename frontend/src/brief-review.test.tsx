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

const brief: Brief = { ...emptyBrief(), summary: 'Confirmed service purpose', functions: [{ id: 'F-001', title: 'Create tickets', description: 'Create a service request', source_blocks: ['functions'] }], departments: ['Service'], roles: ['Operator'], owner_role: 'Service owner', scope: '', questions: ['Who approves closure?'] }
const detail: SystemDetail = { system: { id: 'review-test', name: 'Portal', status: 'CONTEXT_REVIEW', revision: 1, version: 1, context: {}, draft: { blocks: { goal: 'Original authored note', functions: 'Create tickets' }, proposal: brief }, classification: { effective_level: 'L2', answers: { Q3: 'L1' } }, created_at: 1, updated_at: 1 }, controls: [], prd: null, round: null, report: null, baseline: null }
const session: Session = { user: { id: 'owner', name: 'Owner', email: 'owner@example.test', org_id: 'org', role: 'owner' }, csrf: 'csrf', model_configured: false }
function show(value = detail, description = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><LocaleProvider><AuthContext.Provider value={session}><Preferences><MemoryRouter>{description ? <DiscoveryPanel detail={value} /> : <BriefReviewPanel detail={value} />}</MemoryRouter></Preferences></AuthContext.Provider></LocaleProvider></QueryClientProvider>)
}
afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })

it('shows uploaded topology evidence in the architecture chapter without duplicating questionnaire inputs', () => {
  show({ ...detail, system: { ...detail.system, network_topology: [{ id: 'image-1', filename: 'Network Diagram.png', mime: 'image/png', sha256: 'hash' }] } })
  const image = screen.getByRole('img', { name: '网络拓扑图' })
  expect(image).toHaveAttribute('src', '/api/v1/systems/review-test/network-topology/image-1')
  expect(image.closest('[data-prd-section="06"]')).toHaveTextContent('系统开发架构')
  expect(screen.getByText('Network Diagram.png')).toBeVisible()
})

it('shows the structured brief with read-only evidence instead of repeating the narrative form', () => {
  show()
  expect(screen.queryByLabelText('范围与不做事项')).not.toBeInTheDocument()
  expect(screen.queryByLabelText('目标摘要')).not.toBeInTheDocument()
  expect(screen.queryByLabelText('建设目标')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '01 建设目标' })).not.toBeInTheDocument()
  expect(screen.queryByText('Original authored note')).not.toBeInTheDocument()
  expect(screen.getByText('待澄清事项')).toBeVisible()
})

it('does not match controls on page entry or before explicit confirmation', async () => {
  const fetcher = vi.fn(async (_url: string, _options?: RequestInit) => new Response(JSON.stringify({ ...detail, system: { ...detail.system, status: 'CONTROL_REVIEW', version: 2 } })))
  vi.stubGlobal('fetch', fetcher)
  show()
  expect(fetcher).not.toHaveBeenCalled()
  fireEvent.click(screen.getByLabelText('我已核对说明和职责'))
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
  fireEvent.click(screen.getByLabelText('我已核对说明和职责'))
  expect(screen.getByText('分级依据存在差异')).toBeVisible()
  expect(screen.getByRole('button', { name: '保存并核对等级' })).toBeEnabled()
  expect(screen.getByRole('button', { name: '确认说明并匹配控制' })).toBeDisabled()
  expect(screen.getByText('L2')).toBeVisible()
})

it('requires missing structured information even after checking the review box', () => {
  show({ ...detail, system: { ...detail.system, draft: { ...detail.system.draft, proposal: { ...brief, functions: [] } } } })
  fireEvent.click(screen.getByLabelText('我已核对说明和职责'))
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
  fireEvent.change(screen.getByLabelText('功能 1'), { target: { value: 'First edit' } })
  fireEvent.click(screen.getByRole('button', { name: '保存说明修改' }))
  fireEvent.change(screen.getByLabelText('功能 1'), { target: { value: 'Newer edit while saving' } })
  await act(async () => { await vi.advanceTimersByTimeAsync(1100) })
  await act(async () => { pending.shift()!(); await vi.advanceTimersByTimeAsync(1) })
  expect(screen.getByLabelText('功能 1')).toHaveValue('Newer edit while saving')
  expect(bodies[1].proposal.functions[0].title).toBe('Newer edit while saving')
  await act(async () => { pending.shift()!(); await vi.advanceTimersByTimeAsync(1) })
  expect(screen.getByLabelText('功能 1')).toHaveValue('Newer edit while saving')
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
  for (const name of ['功能 1']) {
    const field = screen.getByRole('textbox', { name })
    expect(field).toBeRequired()
    expect(field.closest('label')?.querySelector('.required-mark')).toHaveTextContent('必填')
  }
  expect(screen.getByRole('textbox', { name: '功能说明' })).not.toBeRequired()
  expect(screen.queryByRole('textbox', { name: '业务流程' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('checkbox', { name: '我已核对说明和职责' }))
  expect(screen.getByRole('button', { name: '确认说明并匹配控制' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '保存说明修改' })).toBeEnabled()
  expect(fetcher).not.toHaveBeenCalled()
})

it('allows confirmation with a ready published profile and marks a missing required field locally', () => {
  show({ ...detail, system: { ...detail.system, classification: { scheme: 'SYS-SCREEN/2', effective_level: 'L3', controls_ready: true }, draft: { ...detail.system.draft, proposal: { ...brief, functions: [{ ...brief.functions[0], title: '' }] } } } })
  const owner = screen.getByRole('textbox', { name: '功能 1' })
  expect(owner).toHaveAttribute('aria-invalid', 'true')
  expect(screen.getAllByText('请补充功能需求').length).toBeGreaterThan(0)
  fireEvent.change(owner, { target: { value: '业务责任人' } })
  fireEvent.click(screen.getByRole('checkbox', { name: '我已核对说明和职责' }))
  expect(screen.getByRole('button', { name: '确认说明并匹配控制' })).toBeEnabled()
})


it('opens an editable questionnaire-prefilled brief without the retired information page', () => {
  show({ ...detail, system: { ...detail.system, draft: {}, classification: {
    effective_level: 'L2', scheme: 'MLPS-INTAKE/1', controls_ready: true,
    answers: { system_purpose: 'Authored purpose', system_functions: 'Authored function', system_scenarios: 'Authored scenario' },
  } } })
  expect(screen.getByText('Authored purpose')).toBeVisible()
  expect(screen.getByLabelText('功能 1')).toHaveValue('Authored function')
  expect(screen.getByText('Authored scenario')).toBeVisible()
  expect(screen.queryByLabelText('业务责任角色')).not.toBeInTheDocument()
  expect(screen.getByText('问卷内容预填 · 待人工核对')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '确认说明并匹配控制' })).toBeDisabled()
  expect(document.querySelector('a[href$="/discovery"]')).toBeNull()
})

it('uses eight PRD draft ranges with grouped questions and a blank security-development area', () => {
  const value = structuredClone(detail)
  value.system.classification.answers = { system_purpose: 'Authored purpose', system_functions: 'Authored function', system_scenarios: 'Authored workflow', system_interfaces_description: 'Authored API', deployment_model: '公有云', system_interaction: '否', interconnected_system_level: 'Hidden grade', system_description: 'Retired text' }
  show(value)
  const headings = [...document.querySelectorAll('.review-content > section > .review-section-title > h3')].map(node => node.textContent?.replace('必填', '').trim())
  expect(headings).toEqual(['开发范围', '角色权限', '业务流程', '功能需求', '数据接口', '系统开发架构', '安全开发需求', 'SLA', '上线计划'])
  expect(document.querySelector('.security-development-blank')).toBeEmptyDOMElement()
  expect(screen.getByText('Authored API').closest('section')).toHaveTextContent('数据接口')
  expect(screen.getByText('公有云').closest('section')).toHaveTextContent('系统开发架构')
  expect(screen.queryByText('Hidden grade')).not.toBeInTheDocument()
  expect(screen.queryByText('Retired text')).not.toBeInTheDocument()
  expect(screen.queryByLabelText('目标摘要')).not.toBeInTheDocument()
  expect(document.querySelector('.review-content')).not.toHaveTextContent('已选控制条目将按控制域编入正式 PRD')
})

it('applies PRD review exclusions and shows recorded department contacts and security entity', () => {
  const value = structuredClone(detail)
  value.system.classification = { effective_level: 'L2', scheme: 'MLPS-INTAKE/1', controls_ready: true,
    answers: { system_owner: ['零售运营'] as unknown as string, independent_business: '是', public_service_nature: '否', system_functions: 'Duplicate function', security_responsible_entity: '是' },
    notes: { security_responsible_entity: 'Recorded security entity' }, department_contacts: { '零售运营': 'Recorded contact' } }
  value.system.draft.proposal = { ...brief, roles: [], owner_role: '' }
  show(value)
  expect(screen.getByText('Recorded contact')).toBeVisible()
  expect(screen.getByText('Recorded security entity')).toBeVisible()
  expect(screen.queryByLabelText('业务责任角色')).not.toBeInTheDocument()
  expect(screen.queryByLabelText('使用和审批角色')).not.toBeInTheDocument()
  expect(screen.queryByText('控制适用条件')).not.toBeInTheDocument()
  expect(screen.queryByText(/B03 ·/)).not.toBeInTheDocument()
  expect(screen.queryByText(/C04 ·/)).not.toBeInTheDocument()
  expect(screen.queryByText(/A05 ·/)).not.toBeInTheDocument()
  expect(screen.queryByText('Duplicate function')).not.toBeInTheDocument()
  fireEvent.click(screen.getByLabelText('我已核对说明和职责'))
  expect(screen.getByRole('button', { name: '确认说明并匹配控制' })).toBeEnabled()
})

it('places deployment in architecture and outage scenarios in acceptance, omitting grading-only impact fields', () => {
  const value = structuredClone(detail)
  value.system.classification.answers = { deployment_model: '公有云', impact_after_4h: 'Four hour impact', impact_after_24h: 'Day impact', impact_after_72h: 'Three day impact', system_interaction: '是', interconnected_system_level: '2 级', external_dependency_impact: '是', safety_impact: '是', info_rights_severity: '1', service_rights_severity: '1' }
  show(value)
  expect(screen.getByText('公有云').closest('section')).toHaveTextContent('系统开发架构')
  for (const text of ['Four hour impact', 'Day impact', 'Three day impact']) expect(screen.getByText(text).closest('section')).toHaveTextContent('SLA')
  for (const id of ['B04.1', 'E06', 'E07', 'E09', 'E10']) expect(document.querySelector('.review-content')).not.toHaveTextContent(`${id} ·`)
  expect(document.querySelector('.security-development-blank')).toBeEmptyDOMElement()
})

it('renders questionnaire facts as declarative subheadings while preserving source identity', () => {
  show()
  const captions = [...document.querySelectorAll('.prd-questionnaire-facts dt')].map(node => node.textContent ?? '')
  expect(captions).toContain('系统的主要建设目的')
  expect(captions.every(text => text.length > 0 && !/[？?]/.test(text) && !/^[A-F]\d/.test(text))).toBe(true)
  expect(document.querySelector('[data-source-field="system_purpose"]')).toHaveAttribute('data-source-question', 'A04')
})


it('omits the duplicate department input and retains questionnaire department contacts', () => {
  const value = structuredClone(detail)
  value.system.draft.proposal = { ...brief, departments: [] }
  value.system.classification = { scheme: 'MLPS-INTAKE/1', controls_ready: true, effective_level: 'L2',
    answers: { system_owner: ['零售运营'] as unknown as string }, department_contacts: { '零售运营': 'Alice' } }
  show(value)
  expect(screen.queryByLabelText('涉及部门')).not.toBeInTheDocument()
  expect(screen.getByText('业务部门及对接人')).toBeVisible()
  expect(screen.getByText('Alice')).toBeVisible()
  fireEvent.click(screen.getByLabelText('我已核对说明和职责'))
  expect(screen.getByRole('button', { name: '确认说明并匹配控制' })).toBeEnabled()
})


it('omits the integration yes-no fact while retaining actual interface descriptions', () => {
  const value = structuredClone(detail)
  value.system.classification.answers = { system_interaction: '是', system_interfaces_description: 'Authored interface contract' }
  show(value)
  expect(document.querySelector('[data-source-field="system_interaction"]')).toBeNull()
  expect(screen.getByText('Authored interface contract')).toBeVisible()
})

it('omits duplicate context editors while retaining questionnaire facts and saved source text', () => {
  const value = structuredClone(detail)
  value.system.draft.proposal = { ...brief, summary: '', scope: 'Saved scope', workflow: 'Saved workflow', data_notes: 'Saved data', integrations: 'Saved integrations' }
  value.system.classification = { scheme: 'MLPS-INTAKE/1', controls_ready: true, effective_level: 'L2', answers: { system_purpose: 'Questionnaire purpose', system_scenarios: 'Questionnaire scenario', system_interfaces_description: 'Questionnaire interfaces', data_categories: ['公开信息'] as unknown as string } }
  show(value)
  for (const name of ['目标摘要', '开发范围说明', '业务流程', '系统集成', '数据说明']) expect(screen.queryByRole('textbox', { name })).not.toBeInTheDocument()
  for (const text of ['Questionnaire purpose', 'Questionnaire scenario', 'Questionnaire interfaces', '公开信息']) expect(screen.getByText(text)).toBeVisible()
  fireEvent.click(screen.getByLabelText('我已核对说明和职责'))
  expect(screen.getByRole('button', { name: '确认说明并匹配控制' })).toBeEnabled()
})

it('offers AI expansion for each function and applies the reviewed result to that description only', async () => {
  const value = structuredClone(detail)
  value.system.draft.proposal = { ...brief, functions: [brief.functions[0], { id: 'F-2', title: 'Second function', description: 'Second authored description', source_blocks: [] }] }
  const writes: Record<string, unknown>[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
    if (url.endsWith('/jobs/function-job')) return new Response(JSON.stringify({ state: 'succeeded', output: { revision: 1, topic: 'function_expansion', original: 'Create tickets\n\nCreate a service request', text: 'Expanded single function', questions: [] } }))
    const body = JSON.parse(String(options?.body ?? '{}')); writes.push(body)
    return new Response(JSON.stringify({ ...value, system: { ...value.system, version: 2 }, job_id: 'function-job' }))
  }))
  show(value)
  expect(writes).toEqual([])
  expect(screen.getAllByRole('button', { name: 'AI 扩写功能说明' })).toHaveLength(2)
  fireEvent.click(screen.getAllByRole('button', { name: 'AI 扩写功能说明' })[0])
  await screen.findByText('Expanded single function')
  expect(writes[0]).toMatchObject({ kind: 'function_expansion', function_id: 'F-001', mode: 'openrouter' })
  const fields = screen.getAllByRole('textbox', { name: '功能说明' })
  expect(fields[0]).toHaveValue('Create a service request')
  fireEvent.click(screen.getByRole('button', { name: '采纳并替换描述' }))
  expect(fields[0]).toHaveValue('Expanded single function')
  expect(fields[1]).toHaveValue('Second authored description')
  expect(screen.getByLabelText('功能 1')).toHaveValue('Create tickets')
})

it.each(['CONTROL_REVIEW', 'PRD_REVIEW'])('allows per-function AI expansion while reviewing %s', status => {
  const value = structuredClone(detail)
  value.system.status = status
  show(value)
  expect(screen.getByRole('button', { name: 'AI 扩写功能说明' })).toBeEnabled()
})
