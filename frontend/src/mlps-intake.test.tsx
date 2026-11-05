import gradingFields from '../../backend/app/data/mlps_grading_fields.json'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { LocaleProvider, useLocale } from './i18n'
import MLPSIntake from './MLPSIntake'
import demoFixture from '../../backend/app/data/mlps_demo_template.json'
import questions from '../../backend/app/data/mlps_questionnaire.json'
import type { SystemDetail } from './types'

afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals() })
function Language() { const { setLocale } = useLocale(); return <button onClick={() => setLocale('en')}>English</button> }
const resultFixture = {
  status: 'preliminary_complete', base_level: 2, proposed_level: 2, business_information_level: 2, system_service_level: 1,
  special_principle_minimum: null, is_lower_bound_only: false, issues: [], alerts: [],
  rule_trace: [
    { field: 'info_rights_severity', severity: 2, level: 2 }, { field: 'info_public_severity', severity: 0, level: null }, { field: 'info_national_severity', severity: 0, level: null },
    { field: 'service_rights_severity', severity: 1, level: 1 }, { field: 'service_public_severity', severity: 0, level: null }, { field: 'service_national_severity', severity: 0, level: null },
  ],
}
function setup(saved = {}, result = resultFixture, previewFailure = false, phase: 'all' | 'grading' | 'information' = 'all', removalFailure = false, permissions = ['edit'], client = new QueryClient({ defaultOptions: { queries: { retry: false } } }), demoAssets: { question: string; filename: string; content: string }[] = []) {
  const writes: Record<string, unknown>[] = []
  let jobTopic = 'mlps_purpose'
  const detail = { system: { id: 'mlps', name: 'Authored name', version: 1, classification: {} } } as SystemDetail
  vi.stubGlobal('fetch', vi.fn(async (_url: string, options?: RequestInit) => {
    if (_url.endsWith('/mlps-intake/evidence')) { writes.push(JSON.parse(String(options?.body))); return new Response(JSON.stringify({ ...detail, system: { ...detail.system, version: 2 }, mlps_evidence: { id: '12345678-1234-1234-1234-123456789abc', filename: 'Network Diagram.png', sha256: 'demo-sha' } })) }
    if (_url.endsWith('/mlps-intake/evidence-removals')) { writes.push(JSON.parse(String(options?.body))); return removalFailure ? new Response(JSON.stringify({ code: 'VERSION_CONFLICT' }), { status: 409 }) : new Response(JSON.stringify({ ...detail, system: { ...detail.system, version: 2 }, mlps_evidence_removed: { id: '12345678-1234-1234-1234-123456789abc', filename: 'Topology.png', sha256: 'abc' } })) }
    if (_url.endsWith('/mlps-intake/preview')) return previewFailure ? new Response(JSON.stringify({ code: 'INVALID_FIELDS' }), { status: 422 }) : new Response(JSON.stringify({ assessment: result, grading_assessment: result, controls_ready: true }))
    if (_url.endsWith('/jobs') && options?.method === 'POST') { const request = JSON.parse(String(options.body)); writes.push(request); jobTopic = request.kind.split(':')[1]; return new Response(JSON.stringify({ ...detail, job_id: 'mlps-ai-job' })) }
    if (_url.endsWith('/jobs/mlps-ai-job')) return new Response(JSON.stringify({ state: 'succeeded', output: { topic: jobTopic, original: '门店查库存', text: '帮助门店员工查询商品库存，提升库存信息获取效率。', questions: ['是否包含跨店查询？'] } }))
    if (options?.method === 'PUT') { writes.push(JSON.parse(String(options.body))); return new Response(JSON.stringify({ ...detail, system: { ...detail.system, version: 2 } })) }
    return new Response(JSON.stringify({ questions, saved, demo_template: { ...demoFixture.template, evidence_assets: demoAssets }, legacy: true, permissions, catalog_id: 'catalog' }))
  }))
  render(<QueryClientProvider client={client}><MemoryRouter><LocaleProvider><Language /><MLPSIntake detail={detail} phase={phase} /></LocaleProvider></MemoryRouter></QueryClientProvider>)
  return writes
}

it('advances an unchanged saved questionnaire without writing and still saves edits and newer revisions', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const writes = setup({ answers: { system_name: 'Saved name' }, notes: {}, department_contacts: {}, frameworks: ['MLPS_LEVEL_2'], catalog_id: 'catalog' }, resultFixture, false, 'information', false, ['edit'], client)
  await screen.findByRole('progressbar')
  fireEvent.click(screen.getByText('保存并继续'))
  await waitFor(() => expect(screen.getByRole('heading', { name: '系统部署与连接' })).toBeVisible())
  expect(writes).toHaveLength(0)

  fireEvent.click(screen.getByText('上一步'))
  fireEvent.change(screen.getByLabelText('运营/使用该系统的单位名称？'), { target: { value: 'Authored edit' } })
  fireEvent.click(screen.getByText('保存并继续'))
  await waitFor(() => expect(screen.getByRole('heading', { name: '系统部署与连接' })).toBeVisible())
  expect(writes).toHaveLength(1)
  expect(writes[0]).toMatchObject({ answers: { org_name: 'Authored edit' }, version: 1 })

  fireEvent.click(screen.getByText('上一步'))
  fireEvent.click(screen.getByText('保存并继续'))
  await waitFor(() => expect(screen.getByRole('heading', { name: '系统部署与连接' })).toBeVisible())
  expect(writes).toHaveLength(1)

  client.setQueryData(['system', 'mlps'], { system: { id: 'mlps', version: 3 } })
  fireEvent.click(screen.getByText('上一步'))
  fireEvent.click(screen.getByText('保存并继续'))
  await waitFor(() => expect(writes).toHaveLength(2))
  expect(writes[1]).toMatchObject({ version: 3, answers: { org_name: 'Authored edit' } })
})

it('keeps edited answers on the same step when saving fails', async () => {
  setup({}, resultFixture, false, 'information')
  await screen.findByRole('progressbar')
  const originalFetch = globalThis.fetch
  vi.stubGlobal('fetch', vi.fn((url, options) => options?.method === 'PUT'
    ? Promise.resolve(new Response(JSON.stringify({ code: 'VERSION_CONFLICT' }), { status: 409 }))
    : originalFetch(url, options)))
  fireEvent.change(screen.getByLabelText('运营/使用该系统的单位名称？'), { target: { value: 'Keep this edit' } })
  fireEvent.click(screen.getByText('保存并继续'))
  await screen.findByRole('alert')
  expect(screen.getByRole('heading', { name: '系统概况' })).toBeVisible()
  expect(screen.getByLabelText('运营/使用该系统的单位名称？')).toHaveValue('Keep this edit')
  expect(screen.getByText('有未保存更改')).toBeVisible()
})
it('replaces old screening with eight source sections and preserves authored text across languages', async () => {
  const writes = setup()
  await screen.findByRole('progressbar')
  fireEvent.click(screen.getByRole('button', { name: /系统概况/ }))
  expect(screen.queryByText('系统初步分级与框架选择')).not.toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('运营/使用该系统的单位名称？'), { target: { value: '用户撰写的名称' } })
  fireEvent.click(screen.getByText('English'))
  expect(screen.getByLabelText('What organization operates or uses this system?')).toHaveValue('用户撰写的名称')
  fireEvent.click(screen.getByText('Save & continue'))
  await waitFor(() => expect(writes).toHaveLength(1))
  expect(writes[0].scheme).toBe('MLPS-INTAKE/1')
  expect(writes[0].answers).toMatchObject({ org_name: '用户撰写的名称', system_name: 'Authored name' })
  await screen.findByText('Target type')
})
it('uses paired dropdowns and distinguishes zero, unknown and unanswered parties', async () => {
  const writes = setup()
  await screen.findByRole('progressbar')
  fireEvent.click(screen.getByRole('button', { name: /系统概况/ }))
  fireEvent.click(screen.getByRole('button', { name: /优先定级/ }))
  const info = screen.getByText('业务信息被泄露、篡改或丢失后，会影响谁？').closest('article')!
  expect(within(info).getByLabelText('损害程度 1')).toBeDisabled()
  fireEvent.change(within(info).getByLabelText('受侵害客体 1'), { target: { value: 'rights' } })
  fireEvent.change(within(info).getByLabelText('损害程度 1'), { target: { value: '0' } })
  expect(within(info).getByLabelText('损害程度 1')).toHaveValue('0')
  expect(screen.queryByText('添加另一类受侵害客体')).not.toBeInTheDocument()
  fireEvent.change(within(info).getByLabelText('受侵害客体 1'), { target: { value: 'public' } })
  fireEvent.change(within(info).getByLabelText('损害程度 1'), { target: { value: '9' } })
  fireEvent.click(screen.getByText('保存草稿'))
  await waitFor(() => expect(writes).toHaveLength(1))
  expect(writes[0].answers).toMatchObject({ info_public_severity: 9 })
  expect((writes[0].answers as Record<string, unknown>).info_rights_severity).toBeUndefined()
  expect((writes[0].answers as Record<string, unknown>).info_national_severity).toBeUndefined()
})
it('reveals platform questions conditionally and retains answers while hidden', async () => {
  const writes = setup({ answers: { target_type: '云计算平台/系统', hosted_target_levels: [{ hosted_system_name: 'Saved hosted system', confirmed_level: '3', evidence: 'REF-1' }] } })
  await screen.findByRole('progressbar')
  fireEvent.click(screen.getByRole('button', { name: /系统概况/ }))
  fireEvent.click(screen.getByRole('button', { name: /系统部署与连接/ }))
  expect(screen.queryByDisplayValue('Saved hosted system')).not.toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('本次拟定级对象属于哪一类？'), { target: { value: '独立业务信息系统' } })
  expect(screen.queryByDisplayValue('Saved hosted system')).not.toBeInTheDocument()
  fireEvent.click(screen.getByText('保存草稿'))
  await waitFor(() => expect(writes).toHaveLength(1))
  expect(writes[0].answers).toMatchObject({ hosted_target_levels: [{ hosted_system_name: 'Saved hosted system', confirmed_level: '3', evidence: 'REF-1' }] })
})

it('simplifies overview and saves retail departments and other business text', async () => {
  const writes = setup()
  await screen.findByRole('progressbar')
  fireEvent.click(screen.getByRole('button', { name: /系统概况/ }))
  expect(screen.getAllByRole('article')[0].querySelector('label')).toHaveTextContent('系统正式名称及简称？')
  expect(screen.queryByText('所属行业？')).not.toBeInTheDocument()
  expect(screen.queryByText('系统处于什么阶段？')).not.toBeInTheDocument()
  expect(screen.queryByText('该系统是否已有定级/备案/测评结果？')).not.toBeInTheDocument()
  const owner = screen.getByText('系统涉及哪些业务部门？').closest('article')!
  fireEvent.click(within(owner).getByRole('checkbox', { name: '零售运营' }))
  fireEvent.click(within(owner).getByRole('checkbox', { name: '电子商务' }))
  expect(within(owner).queryByText('补充说明、统计口径与证据')).not.toBeInTheDocument()
  expect(within(owner).queryByLabelText('A03 上传材料')).not.toBeInTheDocument()
  const purpose = screen.getByText('系统的主要建设目的是什么？').closest('article')!
  expect(within(purpose).queryByLabelText('A04 上传材料')).not.toBeInTheDocument()
  const business = screen.getByText('主要承载的业务类型？').closest('article')!
  fireEvent.click(within(business).getByRole('checkbox', { name: '其他' }))
  fireEvent.change(screen.getByLabelText('其他业务类型'), { target: { value: '运动装备租赁' } })
  fireEvent.click(screen.getByText('保存草稿'))
  await waitFor(() => expect(writes).toHaveLength(1))
  expect(writes[0].answers).toMatchObject({ system_owner: ['零售运营', '电子商务'], system_business_type: ['其他'] })
  expect(writes[0].notes).toMatchObject({ system_business_type: '运动装备租赁' })
})

it('shows continuous overview numbering and Amer Sports answer guidance', async () => {
  setup({ answers: { system_business_type: ['客户服务'] } })
  await screen.findByRole('progressbar')
  fireEvent.click(screen.getByRole('button', { name: /系统概况/ }))
  const articles = screen.getAllByRole('article')
  expect(articles.map(a => a.querySelector('.mlps-question-meta span')?.textContent)).toEqual(['A01', 'A02', 'A03', 'A04', 'A05', 'A06', 'A07', 'A08'])
  expect(screen.getByRole('checkbox', { name: '门店销售与收银' })).toBeInTheDocument()
  expect(screen.getByRole('checkbox', { name: '客户服务 (历史答案)' })).toBeChecked()
  expect(screen.queryByText('填写参考（示例，须按实际情况确认）')).not.toBeInTheDocument()
  expect(document.querySelectorAll('input[type=file]')).toHaveLength(0)
  fireEvent.click(screen.getByText('English'))
  expect(screen.getByRole('checkbox', { name: 'Store sales & checkout' })).toBeInTheDocument()
})

it('keeps guidance and uploads only for network topology questions', async () => {
  setup()
  await screen.findByRole('progressbar')
  fireEvent.click(screen.getByRole('button', { name: /系统概况/ }))
  fireEvent.click(screen.getByRole('button', { name: /系统部署与连接/ }))
  expect(screen.getByLabelText('B07 上传材料')).toBeInTheDocument()
  expect(document.querySelectorAll('input[type=file]')).toHaveLength(1)
  expect(screen.getAllByText('填写参考（示例，须按实际情况确认）')).toHaveLength(1)
  expect(screen.queryByRole('button', { name: /H.*佐证材料/ })).not.toBeInTheDocument()

})

it('uses simple sections, user ranges and relocates dependencies without generic explanation fields', async () => {
  const writes = setup({ answers: { registered_users: 345, related_assets: '否', monthly_active_users: 12 } })
  await screen.findByRole('progressbar')
  fireEvent.click(screen.getByRole('button', { name: /系统概况/ }))
  fireEvent.click(screen.getByRole('button', { name: /优先定级/ }))
  expect(screen.getByLabelText('系统是否与其他系统交换数据或对接功能？')).toHaveValue('')
  fireEvent.change(screen.getByLabelText('系统是否与其他系统交换数据或对接功能？'), { target: { value: '否' } })
  expect(screen.queryByText('补充说明、统计口径与证据')).not.toBeInTheDocument()
  expect(screen.queryByText('事实与佐证')).not.toBeInTheDocument()
  expect(screen.queryByText('对象原则')).not.toBeInTheDocument()
  expect(screen.queryByLabelText('系统依赖哪些其他系统？如果它故障，哪些下游系统/服务可能受影响？')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /服务与规模/ }))
  expect(screen.queryByLabelText('系统的注册或授权用户总数大约在哪个范围？')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /数据与个人信息/ }))
  expect(screen.getByLabelText('系统的注册或授权用户总数大约在哪个范围？')).toHaveValue('345')
  fireEvent.change(screen.getByLabelText('系统的注册或授权用户总数大约在哪个范围？'), { target: { value: '101–1,000 人' } })
  expect(screen.queryByText('月活跃用户数量？')).not.toBeInTheDocument()
  expect(screen.queryByText('峰值并发人数/连接数？')).not.toBeInTheDocument()
  expect(screen.queryByText('每日平均及峰值业务处理量、交易量、请求量？')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /业务连续性/ }))
  expect(screen.getByLabelText('系统依赖哪些其他系统？如果它故障，哪些下游系统/服务可能受影响？')).toBeInTheDocument()
  expect(screen.getAllByRole('article')[0].querySelector('.mlps-question-meta')).toHaveTextContent('E01')
  fireEvent.click(screen.getByText('保存草稿'))
  await waitFor(() => expect(writes).toHaveLength(1))
  expect(writes[0].answers).toMatchObject({ registered_users: '101–1,000 人', related_assets: '否', system_interaction: '否', monthly_active_users: 12 })
})

it('collects selected department contacts and retains them when a department is deselected', async () => {
  const writes = setup()
  await screen.findByRole('progressbar')
  fireEvent.click(screen.getByRole('button', { name: /系统概况/ }))
  fireEvent.click(screen.getByRole('checkbox', { name: '信息安全部门' }))
  fireEvent.change(screen.getByLabelText('信息安全部门 · 人员姓名'), { target: { value: '安全负责人' } })
  for (const label of ['所属部门/公司（外包）', '职务/职称', '负责范围', '联系方法']) fireEvent.change(screen.getByLabelText(`信息安全部门 · ${label}`), { target: { value: label + '原文' } })
  fireEvent.click(screen.getByRole('checkbox', { name: '信息安全部门' }))
  expect(screen.queryByLabelText('信息安全部门 · 人员姓名')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('checkbox', { name: '信息安全部门' }))
  expect(screen.getByLabelText('信息安全部门 · 人员姓名')).toHaveValue('安全负责人')
  fireEvent.click(screen.getByText('保存草稿'))
  await waitFor(() => expect(writes).toHaveLength(1))
  expect(writes[0].department_contacts).toEqual({ 信息安全部门: { name: '安全负责人', organization: '所属部门/公司（外包）原文', title: '职务/职称原文', scope: '负责范围原文', contact_method: '联系方法原文' } })
})

it.each([
  ['system_purpose', 'mlps_purpose', '系统的主要建设目的是什么？'],
  ['system_functions', 'mlps_functions', '系统需要提供哪些主要业务功能？'],
  ['system_scenarios', 'mlps_scenarios', '系统的典型使用场景是什么？'],
])('refines %s independently with explicit acceptance and undo', async (key, topic, title) => {
  const originals = { system_description: '旧综合描述', system_purpose: '建设目的原文', system_functions: '功能原文', system_scenarios: '场景原文', [key]: '门店查库存' }
  const writes = setup({ answers: originals })
  await screen.findByRole('progressbar')
  fireEvent.click(screen.getByRole('button', { name: /系统概况/ }))
  const article = screen.getByLabelText(title).closest('article')!
  expect(screen.getAllByText('AI 优化描述')).toHaveLength(3)
  expect(writes).toHaveLength(0)
  fireEvent.click(within(article).getByText('AI 优化描述'))
  await within(article).findByText('帮助门店员工查询商品库存，提升库存信息获取效率。')
  expect(writes[0].answers).toMatchObject(originals)
  expect(writes[1]).toMatchObject({ kind: `narrative_refinement:${topic}`, mode: 'openrouter', version: 2 })
  expect(screen.getByLabelText(title)).toHaveValue('门店查库存')
  fireEvent.click(within(article).getByText('采纳并替换描述'))
  expect(screen.getByLabelText(title)).toHaveValue('帮助门店员工查询商品库存，提升库存信息获取效率。')
  for (const q of questions.filter(q => ['system_purpose', 'system_functions', 'system_scenarios'].includes(q.key) && q.key !== key)) {
    expect(screen.getByLabelText(q.zh)).toHaveValue(originals[q.key as keyof typeof originals])
  }
  fireEvent.click(within(article).getByText('撤销本次采纳'))
  expect(screen.getByLabelText(title)).toHaveValue('门店查库存')
})
it('retains the combined description without guessing the three new answers', async () => {
  const writes = setup({ answers: { system_description: '原综合描述，请保留' } })
  await screen.findByRole('progressbar')
  fireEvent.click(screen.getByRole('button', { name: /系统概况/ }))
  expect(screen.getByText('查看拆分前的原始系统描述')).toBeInTheDocument()
  expect(screen.getByText('原综合描述，请保留')).toBeInTheDocument()
  for (const title of ['系统的主要建设目的是什么？', '系统需要提供哪些主要业务功能？', '系统的典型使用场景是什么？']) expect(screen.getByLabelText(title)).toHaveValue('')
  fireEvent.click(screen.getByText('保存草稿'))
  await waitFor(() => expect(writes).toHaveLength(1))
  expect(writes[0].answers).toMatchObject({ system_description: '原综合描述，请保留' })
})

it('splits network details into four numbered questions without guessing from old text', async () => {
  const writes = setup({ answers: { network_boundary_description: '旧描述及网络拓扑 evidence:12345678-1234-1234-1234-123456789abc' } })
  await screen.findByRole('progressbar')
  fireEvent.click(screen.getByRole('button', { name: /系统概况/ }))
  fireEvent.click(screen.getByRole('button', { name: /系统部署与连接/ }))
  const titles = ['系统预计划分哪些网络区域？', '系统预计提供哪些互联网访问入口？', '系统计划与哪些外部单位建立连接？', '系统计划通过哪些接口与其他系统交互？']
  titles.forEach((title, i) => {
    expect(screen.getByLabelText(title)).toHaveValue('')
    expect(screen.getByLabelText(title).closest('article')?.querySelector('.mlps-question-meta span')).toHaveTextContent(`B${String(i + 7).padStart(2, '0')}`)
    fireEvent.change(screen.getByLabelText(title), { target: { value: `分项答案 ${i}` } })
  })
  expect(screen.getByText('查看拆分前的原始描述')).toBeInTheDocument()
  expect(screen.getByText(/旧描述及网络拓扑/)).toBeInTheDocument()
  expect(screen.getByText(/下载已上传材料/)).toBeInTheDocument()
  expect(document.querySelectorAll('input[type=file]')).toHaveLength(1)
  fireEvent.click(screen.getByText('保存草稿'))
  await waitFor(() => expect(writes).toHaveLength(1))
  expect(writes[0].answers).toMatchObject({ network_zones_description: '分项答案 0', internet_entry_description: '分项答案 1', external_connections_description: '分项答案 2', system_interfaces_description: '分项答案 3', network_boundary_description: '旧描述及网络拓扑 evidence:12345678-1234-1234-1234-123456789abc' })
})

it('removes G from sections, questions and completion counts but preserves saved answers', async () => {
  const writes = setup({ answers: { industry_specific_rules: '是', previous_grade: '5' } })
  await screen.findByRole('progressbar')
  fireEvent.click(screen.getByRole('button', { name: /系统概况/ }))
  expect(screen.queryByRole('button', { name: /G.*监管与复核/ })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '检查与初步结果' })).not.toBeInTheDocument()
  expect(screen.queryByText('适用文件与条款')).not.toBeInTheDocument()
  fireEvent.click(screen.getByText('保存草稿'))
  await waitFor(() => expect(writes).toHaveLength(1))
  expect(writes[0].answers).toMatchObject({ industry_specific_rules: '是', previous_grade: '5' })
})

it('omits other-party panels and preserves saved judgments', async () => {
  const writes = setup({ answers: { info_rights_severity: 1, info_public_severity: 0, info_national_severity: 0 }, notes: { info_public_severity: 'Saved reason', info_national_severity: 'Saved reason' } })
  await screen.findByRole('progressbar')
  fireEvent.click(screen.getByRole('button', { name: /系统概况/ }))
  fireEvent.click(screen.getByRole('button', { name: /优先定级/ }))
  const info = screen.getByText('业务信息被泄露、篡改或丢失后，会影响谁？').closest('article')!
  fireEvent.change(within(info).getByLabelText('受侵害客体 1'), { target: { value: 'rights' } })
  fireEvent.change(within(info).getByLabelText('损害程度 1'), { target: { value: '3' } })
  expect(document.querySelector('.impact-other-parties')).toBeNull()
  expect(screen.queryByText('确认其余客体无侵害')).not.toBeInTheDocument()
  const severity = within(info).getByLabelText('损害程度 1')
  expect(within(severity).getByRole('option', { name: /一般损害.*损失较低，影响范围有限/ })).toBeInTheDocument()
  expect(within(severity).getByRole('option', { name: /严重损害.*损失较高，影响范围较广/ })).toBeInTheDocument()
  expect(within(severity).getByRole('option', { name: /特别严重损害.*极严重后果/ })).toBeInTheDocument()
  expect(within(info).queryByRole('button', { name: /查看选项解释/ })).not.toBeInTheDocument()
  fireEvent.click(screen.getByText('保存草稿'))
  await waitFor(() => expect(writes).toHaveLength(1))
  expect(writes[0].answers).toMatchObject({ info_rights_severity: 3, info_public_severity: 0, info_national_severity: 0 })
  expect(writes[0].notes).toMatchObject({ info_public_severity: 'Saved reason', info_national_severity: 'Saved reason' })
})

it('collects the responsible name only for Yes and preserves it when hidden', async () => {
  const writes = setup()
  await screen.findByRole('progressbar')
  fireEvent.click(screen.getByRole('button', { name: /系统概况/ }))
  fireEvent.click(screen.getByRole('button', { name: /优先定级/ }))
  const question = screen.getByLabelText('是否已明确由哪一家外部单位对这个系统的安全负主要责任？')
  expect(screen.queryByLabelText('主要负责外部单位名称（必填）')).not.toBeInTheDocument()
  fireEvent.change(question, { target: { value: '是' } })
  fireEvent.change(screen.getByLabelText('主要负责外部单位名称（必填）'), { target: { value: '信息安全部门' } })
  fireEvent.change(question, { target: { value: '不确定' } })
  expect(screen.queryByLabelText('主要负责外部单位名称（必填）')).not.toBeInTheDocument()
  fireEvent.change(question, { target: { value: '是' } })
  expect(screen.getByLabelText('主要负责外部单位名称（必填）')).toHaveValue('信息安全部门')
  fireEvent.click(screen.getByText('保存草稿'))
  await waitFor(() => expect(writes).toHaveLength(1))
  expect(writes[0].notes).toMatchObject({ security_responsible_entity: '信息安全部门' })
})

it('nests the inherited personal-information count in D01 and retains it when deselected', async () => {
  const writes = setup({ answers: { data_categories: ['公开信息'], handles_personal_info: '是', personal_info_count_system: 50000, personal_info_count_operator: 20000000 } })
  await screen.findByRole('progressbar')
  fireEvent.click(screen.getByRole('button', { name: /系统概况/ }))
  fireEvent.click(screen.getByRole('button', { name: /优先定级/ }))
  const parent = screen.getByText('系统收集、存储、使用、加工、传输、提供或删除哪些类型的数据？').closest('article')!
  expect(screen.queryByLabelText('是否收集、存储、使用、加工、传输、提供或删除个人信息？')).not.toBeInTheDocument()
  expect(screen.queryByLabelText('本系统处理的个人信息涉及多少人（按去重人数选择范围）？')).not.toBeInTheDocument()
  fireEvent.click(within(parent).getByRole('checkbox', { name: '个人信息' }))
  const count = screen.getByLabelText('本系统处理的个人信息涉及多少人（按去重人数选择范围）？')
  expect(count.closest('article')).toBe(parent)
  expect(parent.querySelector('.mlps-question-meta span')).toHaveTextContent('D01')
  expect(within(count).getByRole('option', { name: '10,000–99,999 人' })).toBeInTheDocument()
  expect(count).toHaveValue('50000')
  fireEvent.change(count, { target: { value: '100,000 人及以上' } })
  fireEvent.click(within(parent).getByRole('checkbox', { name: '不确定' }))
  expect(screen.queryByLabelText('本系统处理的个人信息涉及多少人（按去重人数选择范围）？')).not.toBeInTheDocument()
  fireEvent.click(within(parent).getByRole('checkbox', { name: '个人信息' }))
  expect(screen.getByLabelText('本系统处理的个人信息涉及多少人（按去重人数选择范围）？')).toHaveValue('100,000 人及以上')
  fireEvent.click(screen.getByText('保存草稿'))
  await waitFor(() => expect(writes).toHaveLength(1))
  expect(writes[0].answers).toMatchObject({ handles_personal_info: '是', personal_info_count_system: '100,000 人及以上', personal_info_count_operator: 20000000 })
})

it('uses separate record and storage range dropdowns while retaining original records', async () => {
  const old = [{ amount: '200000', unit: '记录' }, { amount: '3', unit: 'TB' }]
  const writes = setup({ answers: { data_volume_records: old } })
  await screen.findByRole('progressbar')
  fireEvent.click(screen.getByRole('button', { name: /系统概况/ }))
  fireEvent.click(screen.getByRole('button', { name: /优先定级/ }))
  const article = screen.getByText('系统的业务记录数量和数据容量大约在哪个范围？').closest('article')!
  expect(within(article).queryByText('添加记录')).not.toBeInTheDocument()
  expect(within(article).getByText('查看原有数据量记录')).toBeInTheDocument()
  fireEvent.change(within(article).getByLabelText('业务记录数量范围'), { target: { value: '100k_1m' } })
  fireEvent.change(within(article).getByLabelText('数据容量范围（TB）'), { target: { value: '1_10tb' } })
  expect(article.querySelector('.mlps-question-meta span')).toHaveTextContent('D04')
  fireEvent.click(screen.getByText('保存草稿'))
  await waitFor(() => expect(writes).toHaveLength(1))
  expect(writes[0].answers).toMatchObject({ data_volume_records: old, data_volume_ranges: { records: '100k_1m', storage: '1_10tb' } })
})


it('removes the loss estimate and renumbers continuity questions while preserving saved answers', async () => {
  const old = [{ scenario: 'Historical outage', amount_rmb: '50000', basis: 'Original estimate' }]
  const writes = setup({ answers: { financial_loss_estimate: old } })
  await screen.findByRole('progressbar')
  fireEvent.click(screen.getByRole('button', { name: /系统概况/ }))
  fireEvent.click(screen.getByRole('button', { name: /业务连续性/ }))
  expect(screen.queryByLabelText(/估计直接\/间接经济损失/)).not.toBeInTheDocument()
  const codes = Array.from(document.querySelectorAll('.mlps-question-meta > span:first-child')).map(node => node.textContent)
  expect(codes).toEqual(['E01', 'E02', 'E03', 'E04', 'E05', 'E08'])
  fireEvent.click(screen.getByText('保存草稿'))
  await waitFor(() => expect(writes).toHaveLength(1))
  expect(writes[0].answers).toMatchObject({ financial_loss_estimate: old })
})


it('collects independent RTO and RPO under E02 without interpreting old downtime as RTO', async () => {
  const writes = setup({ answers: { maximum_tolerable_downtime_h: 8 } })
  await screen.findByRole('progressbar')
  fireEvent.click(screen.getByRole('button', { name: /系统概况/ }))
  fireEvent.click(screen.getByRole('button', { name: /业务连续性/ }))
  const rto = screen.getByLabelText('RTO · 恢复服务的目标时间（小时）')
  const rpo = screen.getByLabelText('RPO · 最多可接受的数据丢失时长（小时）')
  expect(rto).toHaveValue(null)
  expect(rpo.closest('article')).toBe(rto.closest('article'))
  expect(rto.closest('article')!.querySelector('.mlps-question-meta span')).toHaveTextContent('E02')
  fireEvent.change(rto, { target: { value: '4' } })
  fireEvent.change(rpo, { target: { value: '0.5' } })
  fireEvent.click(screen.getByLabelText('RPO 不确定'))
  expect(rpo).toBeDisabled()
  expect(rto).toHaveValue(4)
  fireEvent.click(screen.getByLabelText('RPO 不确定'))
  fireEvent.change(rpo, { target: { value: '0' } })
  fireEvent.click(screen.getByText('保存草稿'))
  await waitFor(() => expect(writes).toHaveLength(1))
  expect(writes[0].answers).toMatchObject({ maximum_tolerable_downtime_h: 8, recovery_objectives_h: { rto: 4, rpo: 0 } })
})


it('merges impact judgments into continuity and retains removed scenario answers', async () => {
  const old = { scenario_disclosure: 'Original scenario', scenario_confidence: '高' }
  const writes = setup({ answers: old })
  await screen.findByRole('progressbar')
  fireEvent.click(screen.getByRole('button', { name: /系统概况/ }))
  expect(screen.queryByRole('button', { name: /核心影响判断/ })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /优先定级/ }))
  expect(screen.queryByLabelText(/假设本系统最重要的数据遭到/)).not.toBeInTheDocument()
  const info = screen.getByText('业务信息被泄露、篡改或丢失后，会影响谁？').closest('article')!
  const service = screen.getByText('系统服务中断或失效后，会影响谁？').closest('article')!
  expect(info.querySelector('.mlps-question-meta span')).toHaveTextContent('E09')
  expect(service.querySelector('.mlps-question-meta span')).toHaveTextContent('E10')
  expect(within(info).getByRole('option', { name: /国家安全.*全国业务或政府客户/ })).toBeInTheDocument()
  fireEvent.click(screen.getByText('保存草稿'))
  await waitFor(() => expect(writes).toHaveLength(1))
  expect(writes[0].answers).toMatchObject(old)
})


it('fills the saved Demo answers only on click and restores authored input on undo', async () => {
  const writes = setup({ answers: { system_name: '用户原有系统', system_purpose: 'Original purpose', financial_loss_estimate: [{ scenario: 'Historical', amount_rmb: '8', basis: 'Original' }] }, notes: { system_owner: 'Original note' }, department_contacts: { 财务: 'Original contact' } })
  await screen.findByRole('progressbar')
  fireEvent.click(screen.getByRole('button', { name: /系统概况/ }))
  expect(screen.getByLabelText('系统正式名称及简称？')).toHaveValue('用户原有系统')
  fireEvent.click(screen.getByText('一键填入 Demo'))
  fireEvent.click(screen.getByRole('button', { name: /系统概况/ }))
  expect(writes).toHaveLength(0)
  expect(screen.getByLabelText('系统正式名称及简称？')).toHaveValue(demoFixture.template.answers.system_name)
  fireEvent.change(screen.getByLabelText('系统正式名称及简称？'), { target: { value: 'Demo edited' } })
  fireEvent.click(screen.getByText('撤销 Demo 填入'))
  fireEvent.click(screen.getByRole('button', { name: /系统概况/ }))
  expect(screen.getByLabelText('系统正式名称及简称？')).toHaveValue('用户原有系统')
  fireEvent.click(screen.getByText('一键填入 Demo'))
  fireEvent.click(screen.getByRole('button', { name: /系统概况/ }))
  fireEvent.click(screen.getByText('保存草稿'))
  await waitFor(() => expect(writes).toHaveLength(1))
  const activeDemoAnswers = Object.fromEntries(Object.entries(demoFixture.template.answers).filter(([key]) => questions.some(q => q.key === key && !q.retired)))
  expect(writes[0].answers).toMatchObject({ ...activeDemoAnswers, financial_loss_estimate: [{ scenario: 'Historical', amount_rmb: '8', basis: 'Original' }] })
  expect(writes[0].answers).not.toHaveProperty('independent_business')
  expect(writes[0].notes).toEqual(demoFixture.template.notes)
  expect(writes[0].department_contacts).toEqual(demoFixture.template.department_contacts)
})


it('advances directly from the completed questionnaire to causal grade results and supports edits', async () => {
  const writes = setup({ answers: { ...demoFixture.template.answers, involves_transactions: '否', interconnected_system_level: '1 级' }, notes: demoFixture.template.notes })
  await screen.findByRole('progressbar')
  fireEvent.click(screen.getByRole('button', { name: /系统概况/ }))
  expect(screen.queryByRole('button', { name: '检查与初步结果' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /业务连续性与影响分析/ }))
  fireEvent.click(screen.getByText('下一步：查看系统等级'))
  await screen.findByRole('heading', { name: '系统等级' })
  expect(writes).toHaveLength(1)
  expect(screen.queryByRole('navigation', { name: '问卷章节' })).not.toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: '哪些答案决定了等级' })).not.toBeInTheDocument()
  expect(screen.getAllByRole('slider')).toHaveLength(2)
  expect(screen.queryByRole('heading', { name: '社会秩序或公共利益' })).not.toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: '国家安全' })).not.toBeInTheDocument()
  expect(screen.getByRole('slider', { name: 'E09 个人和企业的合法权益' })).toHaveValue('2')
  expect(screen.getByRole('slider', { name: 'E09 个人和企业的合法权益' })).toBeDisabled()
  expect(screen.getAllByText('决定矩阵等级')).toHaveLength(1)
  expect(screen.getByText('确认等级，继续审查应用说明')).toBeEnabled()
  fireEvent.click(screen.getAllByText('返回修改问卷')[0])
  expect(screen.getByLabelText('RTO · 恢复服务的目标时间（小时）')).toHaveValue(demoFixture.template.answers.recovery_objectives_h.rto)
})

it('keeps unknown severity separate from zero and blocks confirmation for pending review', async () => {
  const pending = { ...resultFixture, status: 'pending_review', is_lower_bound_only: true, rule_trace: resultFixture.rule_trace.map(row => row.field === 'info_public_severity' ? { ...row, severity: 9, level: null } : row) }
  setup({ answers: { ...demoFixture.template.answers, involves_transactions: '否', interconnected_system_level: '1 级', info_public_severity: 9 } }, pending)
  await screen.findByRole('progressbar')
  fireEvent.click(screen.getByRole('button', { name: /系统概况/ }))
  fireEvent.click(screen.getByRole('button', { name: /业务连续性与影响分析/ }))
  fireEvent.click(screen.getByText('下一步：查看系统等级'))
  await screen.findByRole('heading', { name: '系统等级' })
  expect(screen.getAllByRole('slider')).toHaveLength(2)
  expect(screen.getByText('未确定损害程度，不能按 0 分处理。')).toBeInTheDocument()
  expect(screen.getByText('确认等级，继续审查应用说明')).toBeDisabled()
})

it('keeps the questionnaire available when calculation fails and requires complete input before Next', async () => {
  setup({}, resultFixture, true)
  await screen.findByRole('progressbar')
  fireEvent.click(screen.getByRole('button', { name: /系统概况/ }))
  fireEvent.click(screen.getByRole('button', { name: /业务连续性与影响分析/ }))
  expect(screen.getByText('下一步：查看系统等级')).toBeDisabled()
  fireEvent.click(screen.getByText('一键填入 Demo'))
  fireEvent.click(screen.getByRole('button', { name: /优先定级/ }))
  fireEvent.change(screen.getByLabelText('系统是否涉及交易（如商品下单、支付、退款或资金结算）？'), { target: { value: '否' } })
  fireEvent.click(screen.getByRole('button', { name: /优先定级/ }))
  fireEvent.change(screen.getByLabelText('对接系统中，已确认的最高系统等级是几级？'), { target: { value: '1 级' } })
  fireEvent.click(screen.getByRole('button', { name: /业务连续性与影响分析/ }))
  fireEvent.click(screen.getByText('下一步：查看系统等级'))
  await waitFor(() => expect(screen.getByText('下一步：查看系统等级')).toBeEnabled())
  expect(screen.queryByRole('heading', { name: '系统等级' })).not.toBeInTheDocument()
  expect(screen.getByLabelText('RTO · 恢复服务的目标时间（小时）')).toBeInTheDocument()
})


it('collects transaction involvement in C02 and places the saved user count at D03', async () => {
  const writes = setup({ answers: { ...demoFixture.template.answers, involves_transactions: '' } })
  await screen.findByRole('progressbar')
  fireEvent.click(screen.getByRole('button', { name: /系统概况/ }))
  fireEvent.click(screen.getByRole('button', { name: /优先定级/ }))
  const question = screen.getByLabelText('系统是否涉及交易（如商品下单、支付、退款或资金结算）？')
  expect(question).toHaveValue('')
  expect(question.closest('article')!.querySelector('.mlps-question-meta span')).toHaveTextContent('C02')
  expect(screen.queryByLabelText('系统的注册或授权用户总数大约在哪个范围？')).not.toBeInTheDocument()
  fireEvent.change(question, { target: { value: '是' } })
  fireEvent.click(screen.getByRole('button', { name: /数据与个人信息/ }))
  const count = screen.getByLabelText('系统的注册或授权用户总数大约在哪个范围？')
  expect(count).toHaveValue(demoFixture.template.answers.registered_users)
  const codes = Array.from(document.querySelectorAll('.mlps-question-meta > span:first-child')).map(node => node.textContent)
  expect(new Set(codes).size).toBe(codes.length)
  expect(count.closest('article')!.querySelector('.mlps-question-meta span')).toHaveTextContent('D02')
  fireEvent.click(screen.getByText('保存草稿'))
  await waitFor(() => expect(writes).toHaveLength(1))
  expect(writes[0].answers).toMatchObject({ involves_transactions: '是', registered_users: demoFixture.template.answers.registered_users })
})


it('expands sensitive, important and core data details inside D01 and restores hidden answers', async () => {
  const writes = setup({ answers: { data_categories: ['公开信息'] } })
  await screen.findByRole('progressbar')
  fireEvent.click(screen.getByRole('button', { name: /系统概况/ }))
  fireEvent.click(screen.getByRole('button', { name: /优先定级/ }))
  const parent = screen.getByText('系统收集、存储、使用、加工、传输、提供或删除哪些类型的数据？').closest('article')!
  fireEvent.click(within(parent).getByRole('checkbox', { name: '敏感个人信息' }))
  expect(screen.getByLabelText('本系统处理的个人信息涉及多少人（按去重人数选择范围）？').closest('article')).toBe(parent)
  expect(within(parent).getByRole('group', { name: '涉及哪些敏感个人信息类别？' })).toBeInTheDocument()
  fireEvent.click(within(parent).getByRole('checkbox', { name: '医疗健康' }))
  fireEvent.change(screen.getByLabelText('敏感个人信息涉及多少人（去重人数）？'), { target: { value: '15' } })
  fireEvent.click(within(parent).getByRole('checkbox', { name: '重要数据' }))
  fireEvent.click(within(parent).getByRole('checkbox', { name: '核心数据' }))
  fireEvent.change(screen.getByLabelText('涉及哪些重要数据？请说明数据内容、用途及认定依据。'), { target: { value: 'Important details' } })
  fireEvent.change(screen.getByLabelText('涉及哪些核心数据？请说明数据内容、用途及认定依据。'), { target: { value: 'Core details' } })
  fireEvent.click(within(parent).getByRole('checkbox', { name: '核心数据' }))
  expect(screen.queryByLabelText('涉及哪些核心数据？请说明数据内容、用途及认定依据。')).not.toBeInTheDocument()
  fireEvent.click(within(parent).getByRole('checkbox', { name: '核心数据' }))
  expect(screen.getByLabelText('涉及哪些核心数据？请说明数据内容、用途及认定依据。')).toHaveValue('Core details')
  const codes = Array.from(document.querySelectorAll('.mlps-question-meta > span:first-child')).map(node => node.textContent)
  expect(new Set(codes).size).toBe(codes.length)
  fireEvent.click(screen.getByText('保存草稿'))
  await waitFor(() => expect(writes).toHaveLength(1))
  expect(writes[0].answers).toMatchObject({ sensitive_pi_types: ['医疗健康'], sensitive_pi_count: 15, important_data_basis: 'Important details', core_data_details: 'Core details' })
})


it('collects the highest connected grade under B04 and retains it when hidden', async () => {
  const writes = setup({ answers: { system_interaction: '否', interconnected_system_level: '2 级' } })
  await screen.findByRole('progressbar')
  fireEvent.click(screen.getByRole('button', { name: /系统概况/ }))
  fireEvent.click(screen.getByRole('button', { name: /优先定级/ }))
  expect(screen.queryByLabelText('对接系统中，已确认的最高系统等级是几级？')).not.toBeInTheDocument()
  const interaction = screen.getByLabelText('系统是否与其他系统交换数据或对接功能？')
  fireEvent.change(interaction, { target: { value: '是' } })
  const grade = screen.getByLabelText('对接系统中，已确认的最高系统等级是几级？')
  expect(grade).toHaveValue('2 级')
  expect(grade.closest('article')).toBe(interaction.closest('article'))
  fireEvent.change(grade, { target: { value: '3 级' } })
  expect(screen.getByText(/仅经 VPN\/零信任接入为 3 级/)).toBeInTheDocument()
  fireEvent.change(interaction, { target: { value: '否' } })
  fireEvent.click(screen.getByText('保存草稿'))
  await waitFor(() => expect(writes).toHaveLength(1))
  expect(writes[0].answers).toMatchObject({ system_interaction: '否', interconnected_system_level: '3 级' })
})

it('shows organization-specific grade drivers separately and requires sufficient reference controls', async () => {
  const result = { ...resultFixture, proposed_level: 3, organization_minimum: 3, organization_rule_trace: [
    { code: 'AMER-LINK-MIN', field: 'interconnected_system_level', answer: '2 级', level: 2, zh: '对接系统内部下限', en: 'Connected-system internal minimum' },
    { code: 'AMER-NET-MIN', field: 'external_network_access', answer: '仅经VPN/零信任接入', level: 3, zh: '网络入口内部下限', en: 'Network ingress internal minimum' },
    { code: 'AMER-TRANSACTION-MIN', field: 'involves_transactions', answer: '是', level: 2, zh: '交易下限', en: 'Transaction minimum' },
    { code: 'AMER-PUBLIC-MIN', field: 'public_service_nature', answer: '是', level: 2, zh: '公共服务下限', en: 'Public service minimum' },
    { code: 'AMER-BUSINESS-MIN', field: 'critical_business', answer: '主要业务核心', level: 3, zh: '业务重要性下限', en: 'Business importance minimum' },
    { code: 'AMER-POPULATION-MIN', field: 'personal_info_count_system', answer: '超过 50,000 人', level: 3, zh: '个人信息人数下限', en: 'Population minimum' },
    { code: 'AMER-DATA-CLASS-MIN', field: 'data_security_classification', answer: '重要', level: 3, zh: '数据分类下限', en: 'Data classification minimum' },
    { code: 'AMER-CROSS-BORDER-MIN', field: 'cross_border_data', answer: '是', level: 2, zh: '跨境下限', en: 'Cross-border minimum' },
    { code: 'AMER-RECORDS-MIN', field: 'data_volume_ranges', subfield: 'records', answer: '1m_10m', level: 3, zh: '记录数量下限', en: 'Record minimum' },
    { code: 'AMER-STORAGE-MIN', field: 'data_volume_ranges', subfield: 'storage', answer: '10_100tb', level: 3, zh: '容量下限', en: 'Storage minimum' },
    { code: 'AMER-DEPENDENCY-MIN', field: 'external_dependency_impact', answer: '是', level: 2, zh: '外部影响下限', en: 'External impact minimum' },
    { code: 'AMER-SAFETY-MIN', field: 'safety_impact', answer: '是', level: 3, zh: '安全影响下限', en: 'Safety impact minimum' },
  ] }
  setup({ answers: { ...demoFixture.template.answers, interconnected_system_level: '2 级' } }, result)
  await screen.findByRole('progressbar')
  fireEvent.click(screen.getByRole('button', { name: /系统概况/ }))
  fireEvent.click(screen.getByRole('button', { name: /业务连续性与影响分析/ }))
  fireEvent.click(screen.getByText('下一步：查看系统等级'))
  await screen.findByRole('heading', { name: '系统等级' })
  expect(screen.getByRole('heading', { name: '系统分级依据' })).toBeInTheDocument()
  expect(screen.getByText(/B04 · 对接系统最高等级/)).toBeInTheDocument()
  expect(screen.getByText(/B06 · 网络入口方式/)).toBeInTheDocument()
  expect(screen.getByText(/C02 · 是否涉及交易/)).toBeInTheDocument()
  expect(screen.getByText(/C04 · 公共服务/)).toBeInTheDocument()
  expect(screen.getByText(/C05 · 业务重要性/)).toBeInTheDocument()
  expect(screen.getByText(/D01 · 个人信息人数/)).toBeInTheDocument()
  for (const label of [/D04 · 业务记录数量/, /D04 · 数据容量/, /D05 · 数据安全分类/, /D06 · 数据跨境传输/, /E06 · 外部同步影响/, /E07 · 安全及社会稳定影响/]) expect(screen.getByText(label)).toBeInTheDocument()
  expect(screen.getByText('确认等级，继续审查应用说明')).toBeEnabled()
  expect(screen.queryByText('其他答案触发的复核提示')).not.toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('希望参考哪套信息安全评估底稿？'), { target: { value: 'MLPS_LEVEL_2' } })
  expect(screen.getByText('确认等级，继续审查应用说明')).toBeDisabled()
  fireEvent.change(screen.getByLabelText('希望参考哪套信息安全评估底稿？'), { target: { value: 'MLPS_LEVEL_3' } })
  expect(screen.getByText('确认等级，继续审查应用说明')).toBeEnabled()
})


it('offers three population grade bands without standalone zero and removes the obsolete business option', async () => {
  setup({ answers: { ...demoFixture.template.answers, personal_info_count_system: '100,000 人及以上', critical_business: '重要辅助' } })
  await screen.findByRole('progressbar')
  fireEvent.click(screen.getByRole('button', { name: /系统概况/ }))
  fireEvent.click(screen.getByRole('button', { name: /优先定级/ }))
  const importance = screen.getByLabelText('该系统对业务的重要性属于哪一类？')
  expect(within(importance).getAllByRole('option').map(o => o.textContent)).toEqual(['请选择', '非核心', '重要辅助', '主要业务核心', '不确定'])
  expect(screen.queryByText(/非核心为 1 级，重要辅助为 2 级，主要业务核心为 3 级/)).not.toBeInTheDocument()
  expect(screen.queryByText(/涉及交易时，最低为 2 级/)).not.toBeInTheDocument()
  expect(screen.queryByText(/直接提供公共服务或公共设施支撑时，最低为 2 级/)).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /优先定级/ }))
  const count = screen.getByLabelText('本系统处理的个人信息涉及多少人（按去重人数选择范围）？')
  expect(within(count).getAllByRole('option').map(o => o.textContent)).toEqual(['请选择', '0–9,999 人', '10,000–99,999 人', '100,000 人及以上', '不确定'])
  expect(screen.getByText(/内部最低等级：0–9,999 人为 1 级，10,000–99,999 人为 2 级，100,000 人及以上为 3 级/)).toBeVisible()
})


it('preserves a historical population range until a new grade band is explicitly selected', async () => {
  const writes = setup({ answers: { ...demoFixture.template.answers, personal_info_count_system: '10,001–100,000 人' } })
  await screen.findByRole('progressbar')
  fireEvent.click(screen.getByRole('button', { name: /系统概况/ }))
  fireEvent.click(screen.getByRole('button', { name: /优先定级/ }))
  const count = screen.getByLabelText('本系统处理的个人信息涉及多少人（按去重人数选择范围）？')
  expect(within(count).getByRole('option', { name: /10,001–100,000.*历史答案/ })).toBeInTheDocument()
  expect(count).toHaveValue('10,001–100,000 人')
  expect(writes).toHaveLength(0)
  fireEvent.change(count, { target: { value: '100,000 人及以上' } })
  fireEvent.click(screen.getByText('保存草稿'))
  await waitFor(() => expect(writes).toHaveLength(1))
  expect(writes[0].answers).toMatchObject({ personal_info_count_system: '100,000 人及以上' })
})

it('renames public internet ingress in both languages while preserving its saved value and authored responsible party', async () => {
  const writes = setup({ answers: { ...demoFixture.template.answers, personal_info_count_system: '超过 50,000 人', external_network_access: '存在公众可访问入口' }, notes: { security_responsible_entity: '原外部单位名称 / Authored company' } }, resultFixture, false, 'grading')
  await screen.findByRole('progressbar')
  const ingress = screen.getByLabelText('系统是否存在互联网可访问的服务、域名、IP、API、VPN入口或移动端入口？')
  expect(ingress).toHaveDisplayValue('公网可访问入口')
  expect(ingress).toHaveValue('存在公众可访问入口')
  expect(screen.getByLabelText('主要负责外部单位名称（必填）')).toHaveValue('原外部单位名称 / Authored company')
  const count = screen.getByLabelText('本系统处理的个人信息涉及多少人（按去重人数选择范围）？')
  expect(count).toHaveDisplayValue('超过 50,000 人 (历史答案)')
  fireEvent.click(screen.getByText('English'))
  expect(screen.getByLabelText('External network access')).toHaveDisplayValue('Public internet ingress')
  expect(screen.getByLabelText('Responsible external organization (required)')).toHaveValue('原外部单位名称 / Authored company')
  expect(screen.getByLabelText('How many distinct people have personal information processed by this system?')).toHaveDisplayValue('超过 50,000 人 (saved answer)')
  expect(writes).toHaveLength(0)
  fireEvent.change(screen.getByLabelText('Responsible external organization (required)'), { target: { value: '原外部单位名称 / Authored company edited' } })
  fireEvent.click(screen.getByText('Save draft'))
  await waitFor(() => expect(writes).toHaveLength(1))
  expect(writes[0].answers).toMatchObject({ external_network_access: '存在公众可访问入口', personal_info_count_system: '超过 50,000 人' })
  expect(writes[0].notes).toMatchObject({ security_responsible_entity: '原外部单位名称 / Authored company edited' })
})

it('keeps existing multiple impact judgments without an add-another control', async () => {
  const writes = setup({ answers: { info_rights_severity: 2, info_public_severity: 3 } })
  await screen.findByRole('progressbar')
  fireEvent.click(screen.getByRole('button', { name: /系统概况/ }))
  fireEvent.click(screen.getByRole('button', { name: /优先定级/ }))
  expect(screen.queryByText('添加另一类受侵害客体')).not.toBeInTheDocument()
  const info = screen.getByText('业务信息被泄露、篡改或丢失后，会影响谁？').closest('article')!
  expect(within(info).getByLabelText('损害程度 1')).toHaveValue('2')
  expect(within(info).getByLabelText('损害程度 2')).toHaveValue('3')
  fireEvent.click(screen.getByText('保存草稿'))
  await waitFor(() => expect(writes).toHaveLength(1))
  expect(writes[0].answers).toMatchObject({ info_rights_severity: 2, info_public_severity: 3 })
})


it('opens grading directly from every earlier questionnaire page after saving', async () => {
  const writes = setup({ answers: demoFixture.template.answers, notes: demoFixture.template.notes })
  await screen.findByRole('progressbar')
  fireEvent.click(screen.getByRole('button', { name: /系统概况/ }))
  for (const section of ['系统概况', '系统部署与连接', '服务与规模', '数据与个人信息']) {
    fireEvent.click(screen.getByRole('button', { name: new RegExp(section) }))
    expect(screen.getByRole('button', { name: '查看系统等级' })).toBeEnabled()
  }
  fireEvent.click(screen.getByRole('button', { name: '查看系统等级' }))
  await screen.findByRole('heading', { name: '系统等级' })
  expect(writes).toHaveLength(1)
  expect(writes[0].answers).toMatchObject(demoFixture.template.answers)
})


it('edits and saves functions and scenarios as separate entries', async () => {
  const writes = setup({ answers: { system_functions: '查询库存\n导出报表', system_scenarios: '门店盘点' } })
  await screen.findByRole('progressbar')
  fireEvent.click(screen.getByRole('button', { name: /系统概况/ }))
  expect(screen.getByLabelText('功能 2')).toHaveValue('导出报表')
  fireEvent.click(screen.getByRole('button', { name: '添加功能' }))
  fireEvent.change(screen.getByLabelText('功能 3'), { target: { value: '审批请求' } })
  fireEvent.click(screen.getByRole('button', { name: '移除 功能 2' }))
  fireEvent.click(screen.getByRole('button', { name: '添加场景' }))
  fireEvent.change(screen.getByLabelText('场景 2'), { target: { value: '月末对账' } })
  fireEvent.click(screen.getByText('保存草稿'))
  await waitFor(() => expect(writes).toHaveLength(1))
  expect(writes[0].answers).toMatchObject({
    system_functions: '查询库存\n审批请求',
    system_scenarios: '门店盘点\n月末对账',
  })
})


it('starts with grading drivers and calculates before remaining questions without confirming the assessment', async () => {
  setup({ answers: Object.fromEntries(Object.entries(demoFixture.template.answers).filter(([key]) => gradingFields.includes(key))), notes: demoFixture.template.notes })
  await screen.findByRole('progressbar')
  expect(screen.getByRole('button', { name: /优先定级/ })).toHaveAttribute('aria-current', 'step')
  expect(screen.getByLabelText('系统是否与其他系统交换数据或对接功能？')).toBeVisible()
  expect(screen.queryByLabelText('系统正式名称及简称？')).not.toBeInTheDocument()
  fireEvent.click(screen.getByText('先计算系统等级'))
  const next = await screen.findByText('采用初步等级，继续填写其余问题')
  expect(next.closest('button')).toBeEnabled()
  fireEvent.click(next)
  expect(screen.getByLabelText('系统正式名称及简称？')).toBeVisible()
  expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('classification-confirmations'))).toBe(false)
})


it('keeps grading questions in order with two compact groups and limits the captured Demo to grading', async () => {
  const writes = setup({ answers: { system_name: 'Preserved name', system_purpose: 'Authored purpose' }, notes: { system_owner: 'Keep note' }, department_contacts: { 财务: 'Keep contact' } }, resultFixture, false, 'grading')
  await screen.findByRole('progressbar')
  const compact = document.querySelectorAll('.mlps-grading-compact')
  expect(compact).toHaveLength(2)
  expect(Array.from(compact[0].querySelectorAll('.mlps-question-meta > span:first-child')).map(n => n.textContent)).toEqual(['G01', 'G02', 'G03', 'G04', 'G05', 'G06'])
  expect(Array.from(compact[1].querySelectorAll('.mlps-question-meta > span:first-child')).map(n => n.textContent)).toEqual(['G09', 'G10', 'G11', 'G12'])
  expect(Array.from(document.querySelectorAll('.mlps-fields > .mlps-grading-compact > .mlps-question, .mlps-fields > .mlps-question')).map(n => n.querySelector('.mlps-question-meta > span:first-child')?.textContent)).toEqual(Array.from({ length: 14 }, (_, i) => `G${String(i + 1).padStart(2, '0')}`))
  expect(Array.from(document.querySelectorAll('.mlps-fields > .mlps-question .mlps-question-meta > span:first-child')).map(n => n.textContent)).toEqual(['G07', 'G08', 'G13', 'G14'])
  fireEvent.click(screen.getByText('一键填入 Demo'))
  expect(writes).toHaveLength(0)
  expect(screen.getByLabelText('主要负责外部单位名称（必填）')).toHaveValue('PwC Cyber ')
  expect(screen.getByLabelText('本系统处理的个人信息涉及多少人（按去重人数选择范围）？')).toHaveValue('100,000 人及以上')
  expect(screen.getByRole('progressbar')).toHaveAttribute('value', '14')
  const impactReason = '系统不涉及核心业务流程，主要作为辅助用途。不涉及个人敏感信息，不涉及重要信息，不涉及核心信息'
  for (const code of ['G13', 'G14']) {
    const question = Array.from(document.querySelectorAll('.mlps-fields > .mlps-question')).find(n => n.querySelector('.mlps-question-meta > span:first-child')?.textContent === code)!
    expect(within(question as HTMLElement).getByRole('textbox')).toHaveValue(impactReason)
  }
  fireEvent.click(screen.getByText('English'))
  expect(screen.getByLabelText('Responsible external organization (required)')).toHaveValue('PwC Cyber ')
  fireEvent.click(screen.getByText('Save draft'))
  await waitFor(() => expect(writes).toHaveLength(1))
  expect(writes[0].answers).toMatchObject({ system_name: 'Preserved name', system_purpose: 'Authored purpose' })
  expect(writes[0].department_contacts).toEqual({ 财务: 'Keep contact' })
  expect(writes[0].notes).toMatchObject({ system_owner: 'Keep note' })
  expect(writes[0].notes).toMatchObject({ security_responsible_entity: 'PwC Cyber ' })
  fireEvent.click(screen.getByText('Undo Demo fill'))
  for (const select of screen.getAllByLabelText('Affected party 1')) expect(select).toHaveValue('')
})

it('removes the independent-business question in both languages and preserves its historical answer', async () => {
  const writes = setup({ answers: { ...demoFixture.template.answers, independent_business: '否' }, notes: { ...demoFixture.template.notes, independent_business: 'Historical explanation' } }, resultFixture, false, 'grading')
  await screen.findByRole('progressbar')
  const retired = questions.find(q => q.key === 'independent_business')!
  expect(screen.queryByText(retired.zh)).not.toBeInTheDocument()
  expect(document.getElementById('independent_business')).toBeNull()
  expect(screen.getByRole('progressbar')).toHaveAttribute('max', '14')
  expect(screen.getByRole('progressbar')).toHaveAttribute('value', '14')
  fireEvent.click(screen.getByText('English'))
  expect(screen.queryByText(retired.en)).not.toBeInTheDocument()
  fireEvent.click(screen.getByText('Save draft'))
  await waitFor(() => expect(writes).toHaveLength(1))
  expect(writes[0].answers).toMatchObject({ independent_business: '否' })
  expect(writes[0].notes).toMatchObject({ independent_business: 'Historical explanation' })
})

it('fills and saves all five information dimensions from any chapter without changing grading', async () => {
  const writes = setup({ answers: { external_network_access: '无', system_name: 'Original' }, notes: { info_rights_severity: 'Keep grading rationale' } }, resultFixture, false, 'information')
  await screen.findByRole('progressbar')
  fireEvent.click(screen.getByRole('button', { name: /系统部署与连接/ }))
  fireEvent.click(screen.getByText('一键填入 Demo'))
  await waitFor(() => expect(writes).toHaveLength(1))
  const expected = Object.fromEntries(Object.entries(demoFixture.template.answers).filter(([key]) => !gradingFields.includes(key) && questions.some(q => q.key === key && !q.retired)))
  expect(writes[0].answers).toMatchObject({ ...expected, external_network_access: '无' })
  expect(writes[0].notes).toMatchObject({ info_rights_severity: 'Keep grading rationale' })
  expect(screen.getByRole('button', { name: /系统部署与连接/ })).toHaveAttribute('aria-current', 'step')
  fireEvent.click(screen.getByText('撤销 Demo 填入'))
  await waitFor(() => expect(writes).toHaveLength(2))
  expect(writes[1].answers).toEqual({ external_network_access: '无', system_name: 'Original' })
})


it('copies the information Demo topology before saving with the new version and restores authored content on undo', async () => {
  const assets = [{ question: 'network_zones_description', filename: 'Network Diagram.png', content: 'cG5n' }]
  const writes = setup({ answers: { external_network_access: '无', system_name: 'Original' }, notes: { info_rights_severity: 'Keep grading' } }, resultFixture, false, 'information', false, ['edit'], undefined, assets)
  await screen.findByRole('progressbar')
  fireEvent.click(screen.getByText('一键填入 Demo'))
  await waitFor(() => expect(writes).toHaveLength(2))
  expect(writes[0]).toMatchObject({ ...assets[0], version: 1 })
  expect(writes[1]).toMatchObject({ version: 2, answers: { external_network_access: '无' }, notes: { info_rights_severity: 'Keep grading', network_zones_description: 'Network Diagram.png | evidence:12345678-1234-1234-1234-123456789abc | SHA-256:demo-sha' } })
  expect(writes[1].department_contacts).toEqual(demoFixture.template.department_contacts)
  expect(JSON.stringify(writes)).not.toContain('e388ff12-a2ab-4e7f-9af5-830c71544a21')
  await waitFor(() => expect(screen.getByText('撤销 Demo 填入')).toBeEnabled())
  fireEvent.click(screen.getByText('撤销 Demo 填入'))
  await waitFor(() => expect(writes).toHaveLength(3))
  expect(writes[2].answers).toEqual({ external_network_access: '无', system_name: 'Original' })
  expect(writes[2].notes).toEqual({ info_rights_severity: 'Keep grading' })
})

it('keeps authored information when copying a Demo attachment fails', async () => {
  const assets = [{ question: 'network_zones_description', filename: 'Network Diagram.png', content: 'cG5n' }]
  const writes = setup({ answers: { system_name: 'Original information' } }, resultFixture, false, 'information', false, ['edit'], undefined, assets)
  await screen.findByRole('progressbar')
  const original = globalThis.fetch
  vi.stubGlobal('fetch', vi.fn((url, options) => String(url).endsWith('/mlps-intake/evidence') ? Promise.resolve(new Response(JSON.stringify({ code: 'VERSION_CONFLICT' }), { status: 409 })) : original(url, options)))
  fireEvent.click(screen.getByText('一键填入 Demo'))
  await waitFor(() => expect(screen.getByText('一键填入 Demo')).toBeEnabled())
  expect(screen.getByLabelText('系统正式名称及简称？')).toHaveValue('Original information')
  expect(screen.queryByText('撤销 Demo 填入')).not.toBeInTheDocument()
  expect(writes).toHaveLength(0)
})

it('numbers information sections continuously and counts only visible information questions', async () => {
  setup({ answers: demoFixture.template.answers, notes: demoFixture.template.notes }, resultFixture, false, 'information')
  await screen.findByRole('progressbar')
  const sections = [['A', '系统概况', 8], ['B', '系统部署与连接', 11], ['C', '服务与规模', 2], ['D', '数据与个人信息', 3], ['E', '业务连续性与影响分析', 6]] as const
  expect(screen.getByRole('progressbar')).toHaveAttribute('max', '30')
  expect(screen.getByRole('progressbar')).toHaveAttribute('value', '30')
  for (const [code, name, count] of sections) {
    fireEvent.click(screen.getByRole('button', { name: new RegExp(name) }))
    expect(Array.from(document.querySelectorAll('.mlps-question-meta > span:first-child')).map(n => n.textContent)).toEqual(Array.from({ length: count }, (_, i) => `${code}${String(i + 1).padStart(2, '0')}`))
  }
  expect(screen.getByText('确认系统信息')).toBeEnabled()
})

it('removes an uploaded reference without losing unsaved authored answers', async () => {
  const id = '12345678-1234-1234-1234-123456789abc'
  const writes = setup({ answers: { network_zones_description: 'Original description' }, notes: { network_zones_description: `Authored note\nTopology.png | evidence:${id} | SHA-256:abc` } })
  await screen.findByRole('progressbar')
  fireEvent.click(screen.getByRole('button', { name: /系统部署与连接/ }))
  const field = document.getElementById('network_zones_description')!
  fireEvent.change(field, { target: { value: 'Unsaved authored description' } })
  fireEvent.click(screen.getByRole('button', { name: '移除材料 12345678' }))
  await waitFor(() => expect(screen.queryByText(/下载已上传材料/)).not.toBeInTheDocument())
  expect(field).toHaveValue('Unsaved authored description')
  expect(writes[0]).toMatchObject({ evidence_id: id, version: 1 })
  fireEvent.click(screen.getByText('保存并继续'))
  await waitFor(() => expect(writes).toHaveLength(2))
  expect(writes[1].answers).toMatchObject({ network_zones_description: 'Unsaved authored description' })
  expect(writes[1].notes).toMatchObject({ network_zones_description: 'Authored note\n' })
  expect(writes[1].version).toBe(2)
})
it('retains the evidence link after a removal conflict and hides removal for readers', async () => {
  const saved = { notes: { network_zones_description: 'Topology.png | evidence:12345678-1234-1234-1234-123456789abc | SHA-256:abc' } }
  setup(saved, resultFixture, false, 'information', true)
  await screen.findByRole('progressbar')
  fireEvent.click(screen.getByRole('button', { name: /系统部署与连接/ }))
  fireEvent.click(screen.getByRole('button', { name: '移除材料 12345678' }))
  await waitFor(() => expect(screen.getByRole('button', { name: '移除材料 12345678' })).not.toBeDisabled())
  expect(screen.getByText(/下载已上传材料/)).toBeInTheDocument()
  cleanup()
  setup(saved, resultFixture, false, 'information', false, ['read'])
  await screen.findByRole('progressbar')
  fireEvent.click(screen.getByRole('button', { name: /系统部署与连接/ }))
  expect(screen.queryByRole('button', { name: '移除材料 12345678' })).not.toBeInTheDocument()
  expect(screen.getByText(/下载已上传材料/)).toBeInTheDocument()
})
