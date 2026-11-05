import { Fragment, useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ArrowRight, Building2, CheckCheck, ChevronDown, ClipboardCheck, Clock3, Layers3, Plus, RefreshCw, Search, ShieldCheck } from 'lucide-react'
import { api, ApiError } from './api'
import { Button, Modal, Notice, Status, useAuth } from './components'
import { statuses, useLocale } from './i18n'
import AssessmentCreate from './AssessmentCreate'
import type { DashboardData } from './dashboardTypes'

const stages: Record<string, readonly [string, string]> = {
  intake: ['定级与信息收集', 'Grading & information'], controls: ['控制审查与现状核验', 'Controls & verification'],
  prd: ['PRD 生成与审查', 'PRD preparation & review'], supplier: ['供应商答复与分析', 'Supplier response & analysis'],
  review: ['复核、整改与确认', 'Review, remediation & agreement'], complete: ['本轮完成 / 待开发', 'Complete / ready to develop'], other: ['其他阶段', 'Other stages'],
}
const remediationLabels: Record<string, readonly [string, string]> = {
  closed: ['已关闭', 'Closed'], accepted_risk: ['风险已接受', 'Risk accepted'], awaiting_retest: ['待复测', 'Awaiting retest'],
  in_progress: ['整改中', 'In progress'], pending_approval: ['待确认计划', 'Plan confirmation'], unplanned: ['待制定计划', 'No plan yet'],
}
const nextActions: Record<string, readonly [string, string]> = {
  DRAFT: ['完善定级问卷', 'Complete the grading questionnaire'], CLASSIFYING: ['确认系统定级', 'Confirm system grading'],
  CONTEXT_REVIEW: ['审查系统信息', 'Review system information'], CONTROL_REVIEW: ['审查安全控制范围', 'Review security controls'],
  PRD_REVIEW: ['审查并下发 PRD', 'Review and dispatch the PRD'], RESULT_REVIEW: ['复核供应商提交', 'Review supplier submission'],
  NEGOTIATING: ['跟进协商与整改', 'Follow up on negotiation'], FINAL_CONFIRMATION: ['跟进双方基线确认', 'Follow up on baseline confirmations'],
  VERIFYING: ['完成现状核验', 'Complete current-state verification'], GAP_REVIEW: ['审查差距评估', 'Review assessment gaps'], REMEDIATING: ['跟进整改与复测', 'Follow up on remediation & retest'],
}

function Bar({ value, max, color = 'blue', label }: { value: number; max: number; color?: string; label: string }) {
  return <div className={`db-bar ${color}`} role="meter" aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={Math.max(max, 1)}>
    <span style={{ width: `${max ? Math.min(value / max * 100, 100) : 0}%` }} />
  </div>
}

export default function AdminDashboard() {
  const auth = useAuth()
  const { t } = useLocale()
  if (!auth.user.is_admin || auth.user.role === 'vendor') return <Notice error>{t('仅系统管理员可以访问管理工作台。', 'Only administrators can access the management dashboard.')}</Notice>
  return <DashboardContent />
}

function DashboardContent() {
  const { t, locale, error: translate } = useLocale()
  const auth = useAuth()
  const [search, setSearch] = useState(''), [queryText, setQueryText] = useState(''), [kind, setKind] = useState('')
  const [newOpen, setNewOpen] = useState(false), [expandedSupplier, setExpandedSupplier] = useState<string | null>(null)
  const [allTodos, setAllTodos] = useState(false), [allDepartments, setAllDepartments] = useState(false)
  useEffect(() => { const timer = window.setTimeout(() => setQueryText(search.trim()), 250); return () => window.clearTimeout(timer) }, [search])
  const query = useQuery({ queryKey: ['admin-dashboard', queryText, kind], queryFn: ({ signal }) => api<DashboardData>(`/admin/dashboard?${new URLSearchParams({ q: queryText, kind })}`, { signal }), refetchInterval: 60000 })
  const data = query.data
  const ledgerHref = (extra: Record<string, string> = {}) => {
    const params = new URLSearchParams({ ...(queryText ? { q: queryText } : {}), ...(kind ? { kind } : {}), ...extra })
    return `/assessments${params.size ? `?${params}` : ''}`
  }
  const time = (value: number) => new Date(value * 1000).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-GB', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  return <div className="admin-dashboard">
    <header className="db-heading"><div><div className="db-eyebrow">MANAGEMENT OVERVIEW</div><h1>{t('管理工作台', 'Management dashboard')}</h1><p>{t('从系统评估到供应商协同，一处掌握整体进展。', 'A clear view of system assessments, supplier collaboration and remediation.')}</p></div>
      <div className="db-heading-actions"><Link className="button secondary" to="/assessments">{t('评估台账', 'Assessment ledger')}<ArrowRight size={15} /></Link><Button onClick={() => setNewOpen(true)}><Plus size={16} />{t('新建系统安全评估', 'Create system security assessment')}</Button></div>
    </header>
    <div className="db-toolbar"><div className="db-type-tabs" role="group" aria-label={t('评估范围', 'Assessment scope')}>{[['', t('全部评估', 'All assessments')], ['new', t('待开发系统', 'New systems')], ['existing', t('现有系统', 'Existing systems')]].map(([value, label]) => <button key={value} aria-pressed={kind === value} onClick={() => setKind(value)}>{label}</button>)}</div>
      <label className="db-search search-field"><Search size={16} /><input maxLength={200} aria-label={t('搜索系统或部门', 'Search systems or departments')} placeholder={t('搜索系统、部门…', 'Search systems, departments…')} value={search} onChange={event => setSearch(event.target.value)} /></label>
      <button className="db-refresh" disabled={query.isFetching} onClick={() => void query.refetch()} aria-label={t('刷新工作台', 'Refresh dashboard')} title={t('刷新工作台', 'Refresh dashboard')}><RefreshCw size={16} className={query.isFetching ? 'spin' : ''} /></button>
    </div>
    {query.error && <Notice error>{translate(query.error instanceof ApiError ? query.error.code : 'NETWORK_ERROR')} <button className="db-inline-button" onClick={() => void query.refetch()}>{t('重新加载', 'Try again')}</button></Notice>}
    {query.isPending && !query.error && <div className="db-loading" role="status"><RefreshCw size={20} className="spin" />{t('正在汇总组织数据…', 'Loading organization overview…')}</div>}
    {data && <>
      <div className="db-scope-line"><span><i />{data.organization} <span className="db-scope-divider">/</span> {queryText || kind ? t('当前筛选范围', 'Filtered scope') : t('组织整体概览', 'Organization overview')}</span><span>{query.isFetching ? t('正在更新…', 'Refreshing…') : `${t('更新于', 'Updated')} ${time(data.generated_at)}`}</span></div>
      {!data.summary.total && <div className="db-empty-banner"><ShieldCheck size={20} /><div><strong>{queryText || kind ? t('当前筛选没有匹配的评估', 'No assessments match these filters') : t('从第一份系统评估开始', 'Start with your first assessment')}</strong><span>{t('统计仅反映已保存的业务记录。创建评估后，可在这里持续跟进。', 'Statistics reflect saved records. Create an assessment to start tracking progress here.')}</span></div>{(queryText || kind) && <button className="db-inline-button" onClick={() => { setSearch(''); setQueryText(''); setKind('') }}>{t('清除筛选', 'Clear filters')}</button>}</div>}
      <section className="db-metrics" aria-label={t('核心指标', 'Key metrics')}>
        {[
          { key: 'total', label: t('评估总数', 'Total assessments'), value: data.summary.total, hint: t(`待开发 ${data.summary.new} · 现有 ${data.summary.existing}`, `${data.summary.new} new · ${data.summary.existing} existing`), icon: Layers3, color: 'blue', href: ledgerHref() },
          { key: 'progress', label: t('评估进行中', 'In progress'), value: data.summary.in_progress, hint: t('从定级到复核与整改', 'Grading through review & remediation'), icon: Clock3, color: 'amber', href: ledgerHref({ active: 'true' }) },
          { key: 'todos', label: t('待办事项', 'Action items'), value: data.summary.todos, hint: t(`待审核交付证据 ${data.summary.delivery_review} 项`, `${data.summary.delivery_review} delivery items awaiting review`), icon: ClipboardCheck, color: 'red', href: '#dashboard-todos' },
          { key: 'agreed', label: t('已达成开发基线', 'Agreed baselines'), value: data.summary.agreed, hint: t('双方已独立确认同一基线', 'Independently confirmed by both parties'), icon: CheckCheck, color: 'green', href: ledgerHref({ status: 'PENDING_DEVELOPMENT' }) },
          { key: 'suppliers', label: t('协同供应商', 'Active suppliers'), value: data.summary.suppliers, hint: t('当前轮次与整改计划关联组织', 'Linked to current rounds & plans'), icon: Building2, color: 'slate', href: '#dashboard-suppliers' },
        ].map(card => <a href={card.href} className={`db-metric ${card.color}`} key={card.key}><div className="db-metric-top"><span>{card.label}</span><card.icon size={18} /></div><strong>{card.value}</strong><span className="db-metric-hint">{card.hint}</span></a>)}
      </section>
      <div className="db-chart-grid">
        <section className="db-panel"><div className="db-panel-heading"><h2>{t('评估阶段分布', 'Assessment progress')}</h2><span className="db-count">{data.summary.total} {t('份评估', 'assessments')}</span></div>
          <div className="db-bars">{data.stages.filter(item => item.key !== 'other' || item.count).map(item => <div className="db-bar-row" key={item.key}><span>{stages[item.key] ? t(...stages[item.key]) : item.key}</span><Bar label={stages[item.key] ? t(...stages[item.key]) : item.key} value={item.count} max={Math.max(...data.stages.map(row => row.count), 1)} color={item.key === 'complete' ? 'green' : 'blue'} /><strong>{item.count}</strong></div>)}</div>
          <Link className="db-panel-link" to="/assessments">{t('查看全部系统评估', 'View all assessments')}<ArrowRight size={14} /></Link>
        </section>
        <section className="db-panel"><div className="db-panel-heading"><h2>{t('整改处理进度', 'Remediation progress')}</h2><span className="db-count">{t('现有系统差距', 'Existing-system gaps')}</span></div>
          <div className="db-remediation-total"><div><strong>{data.remediation.states.closed}</strong><span>/ {data.remediation.total}</span><span>{t('已关闭', 'closed')}</span></div><span className="db-overdue">{t('逾期', 'Overdue')} {data.remediation.overdue}</span></div>
          <div className="db-stacked-bar" aria-label={t('整改状态分布', 'Remediation status distribution')}>{Object.entries(data.remediation.states).map(([key, count]) => <span className={`remediation-${key}`} key={key} title={`${t(...remediationLabels[key])} ${count}`} style={{ width: `${data.remediation.total ? count / data.remediation.total * 100 : 0}%` }} />)}</div>
          <div className="db-legend">{Object.entries(data.remediation.states).map(([key, count]) => <span key={key}><i className={`remediation-${key}`} />{t(...remediationLabels[key])} <b>{count}</b></span>)}</div>
          <div className="db-risk-row"><span>{t('待处置风险', 'Open risks')}</span>{Object.entries(data.remediation.risks).map(([key, count]) => <span key={key} className={`db-risk ${key}`}>{({ high: t('高', 'High'), medium: t('中', 'Medium'), low: t('低', 'Low'), unknown: t('未定', 'Unknown') } as Record<string, string>)[key]} {count}</span>)}</div>
          <p className="db-note">{t('风险接受单独计数，复测通过后才计为关闭。逾期按计划截止日计算。', 'Accepted risks are separate; closure requires a passed retest. Overdue uses the plan due date.')}</p>
          {!!data.remediation.stale_assessments && <p className="db-stale">{t(`${data.remediation.stale_assessments} 份评估的整改来源已失效，暂未计入。`, `${data.remediation.stale_assessments} assessments have stale remediation sources and are excluded.`)}</p>}
        </section>
      </div>
      <section className="db-panel db-suppliers" id="dashboard-suppliers"><div className="db-panel-heading"><div><h2>{t('供应商协同与整改', 'Supplier collaboration & remediation')}</h2><p>{t('查看当前供应商任务，展开名称进入关联评估。', 'Expand a supplier to open its current assessments.')}</p></div><Link className="db-panel-link" to="/team">{t('人员与权限', 'People & access')}<ArrowRight size={14} /></Link></div>
        <div className="db-table-scroll"><table aria-label={t('供应商协同与整改明细', 'Supplier collaboration details')}><thead><tr>{[t('供应商', 'Supplier'), t('关联评估', 'Assessments'), t('待答复', 'Awaiting response'), t('待复核', 'Awaiting review'), t('已达成基线', 'Agreed'), t('整改缺口', 'Gaps'), t('逾期', 'Overdue'), t('整改关闭率', 'Gap closure')].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>
          {!data.suppliers.length && <tr><td colSpan={8}><div className="db-table-empty"><Building2 size={25} /><strong>{t('暂无关联供应商', 'No linked suppliers yet')}</strong><span>{t('下发 PRD 或指派整改计划后，将自动汇总协同进度。', 'Dispatch a PRD or assign a remediation plan to track supplier progress.')}</span></div></td></tr>}
          {data.suppliers.map(row => <Fragment key={row.id}><tr><td><button className="db-supplier-toggle" aria-expanded={expandedSupplier === row.id} aria-controls={`supplier-${row.id}`} onClick={() => setExpandedSupplier(expandedSupplier === row.id ? null : row.id)}><ChevronDown size={14} /><strong>{row.name || t('供应商组织', 'Supplier organization')}</strong></button></td><td>{row.systems.length}</td><td>{row.awaiting_response}</td><td><span className={row.awaiting_review ? 'db-attention' : ''}>{row.awaiting_review}</span></td><td>{row.agreed}</td><td>{row.gaps}</td><td>{row.overdue ? <span className="db-overdue-badge">{row.overdue}</span> : <span className="db-muted">—</span>}</td><td><div className="db-table-progress"><Bar label={`${row.name} ${t('整改关闭率', 'gap closure')}`} value={row.closed} max={row.gaps} color="green" /><span>{row.gaps ? `${Math.round(row.closed / row.gaps * 100)}%` : '—'}</span></div></td></tr>
            {expandedSupplier === row.id && <tr id={`supplier-${row.id}`} className="db-supplier-detail"><td colSpan={8}>{row.systems.map(system => <Link key={system.id} to={`/systems/${system.id}`}><span>{system.name}</span><Status status={system.status} /><ArrowRight size={14} /></Link>)}</td></tr>}</Fragment>)}
        </tbody></table></div><div className="db-table-foot">{t(`共 ${data.suppliers.length} 家供应商`, `${data.suppliers.length} suppliers`)}<span>{t('未制定计划的缺口计入上方总览', 'Gaps without plans are included in the overview above')}</span></div>
      </section>
      <div className="db-bottom-grid">
        <section className="db-panel db-todos" id="dashboard-todos"><div className="db-panel-heading"><h2>{t('待办与提醒', 'Tasks & reminders')}<span className="db-heading-badge">{data.todos.length}</span></h2>{data.todos.length > 6 && <button className="db-inline-button" onClick={() => setAllTodos(!allTodos)}>{allTodos ? t('收起', 'Show less') : t('查看全部', 'View all')}<ArrowRight size={14} /></button>}</div>
          {!data.todos.length && <div className="db-small-empty"><CheckCheck size={25} /><strong>{t('当前没有待办', 'No action items')}</strong><span>{t('新的审查和确认任务会显示在这里。', 'New review and confirmation tasks will appear here.')}</span></div>}
          <div className={`db-task-list ${allTodos ? 'expanded' : ''}`}>{(allTodos ? data.todos : data.todos.slice(0, 6)).map(item => <Link to={item.href} className="db-task" key={item.key}><div><strong>{item.name}</strong><ArrowRight size={14} /></div><p><span className={`db-task-tag ${item.priority === 0 ? 'urgent' : ''}`}>{item.kind === 'delivery' ? t('交付', 'Delivery') : item.kind === 'risk_expired' ? t('到期', 'Expired') : t('评估', 'Assessment')}</span>{item.kind === 'delivery' ? t(`${item.count} 项交付证据待审核`, `${item.count} delivery items awaiting review`) : item.kind === 'risk_expired' ? t(`${item.count} 项风险接受已到复审日期`, `${item.count} accepted risks due for review`) : nextActions[item.status] ? t(...nextActions[item.status]) : statuses[item.status] ? t(...statuses[item.status]) : item.status}</p><time dateTime={new Date(item.updated_at * 1000).toISOString()}>{t('评估更新', 'Assessment updated')} · {time(item.updated_at)}</time></Link>)}</div>
        </section>
        <section className="db-panel"><div className="db-panel-heading"><h2>{t('系统等级分布', 'System classification')}</h2><ShieldCheck size={17} /></div><div className="db-bars db-distribution">{data.levels.map(item => <div className="db-bar-row" key={item.key}><span>{item.key === 'unclassified' ? t('未定级', 'Unclassified') : item.key}</span><Bar label={item.key === 'unclassified' ? t('未定级', 'Unclassified') : item.key} value={item.count} max={Math.max(...data.levels.map(row => row.count), 1)} color={item.key === 'L3' ? 'red' : item.key === 'L2' ? 'amber' : item.key === 'L1' ? 'blue' : 'slate'} /><strong>{item.count}</strong></div>)}</div><p className="db-note">{t('按已确认的系统等级统计；未完成定级的评估单独列示。', 'Uses confirmed system classifications. Ungraded assessments are shown separately.')}</p><Link className="db-panel-link" to="/method">{t('查看分级方法', 'View classification method')}<ArrowRight size={14} /></Link></section>
        <section className="db-panel"><div className="db-panel-heading"><h2>{t('业务部门覆盖', 'Department coverage')}</h2><Building2 size={17} /></div><div className="db-bars db-departments">{(allDepartments ? data.departments : data.departments.slice(0, 7)).map(item => <div className="db-bar-row" key={item.name}><span title={item.name}>{item.name || t('待明确部门', 'Unspecified')}</span><Bar label={item.name || t('待明确部门', 'Unspecified')} value={item.count} max={Math.max(...data.departments.map(row => row.count), 1)} /><strong>{item.count}</strong></div>)}</div>{!data.departments.length && <p className="db-note">{t('暂无部门数据', 'No department data yet')}</p>}<p className="db-note">{t('按已确认信息统计；同一评估可涉及多个部门。', 'Based on confirmed information; an assessment may cover multiple departments.')}</p>{data.departments.length > 7 && <button className="db-inline-button" onClick={() => setAllDepartments(!allDepartments)}>{allDepartments ? t('收起', 'Show less') : t('查看全部部门', 'View all departments')}</button>}</section>
      </div>
      <div className="db-footer-note"><ShieldCheck size={15} /><span>{t('当前组织 · 已保存记录 · 每分钟自动更新', 'Current organization · Saved records · Refreshes every minute')}</span><span>{auth.model_configured ? t('模型生成按需显式发起', 'Model generation runs only on request') : t('未配置模型时，仅可使用明确标注的本地规则草稿', 'Without a configured model, only labeled local rule drafts are available')}</span></div>
    </>}
    {newOpen && <Modal title={t('新建系统安全评估', 'Create system security assessment')} close={() => setNewOpen(false)}><AssessmentCreate onCreated={() => { setNewOpen(false); void query.refetch() }} /></Modal>}
  </div>
}
