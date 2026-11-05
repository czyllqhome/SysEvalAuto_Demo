import GradingMethod from './GradingMethod'
import ControlExemptionGuide from './ControlExemptionGuide'
import AssessmentCreate from './AssessmentCreate'
import DeliveryWorkspace, { DeliveryInbox } from './DeliveryWorkspace'
import { SupplierRemediations } from './ExistingAssessment'
export { exampleBlocks } from './demoData'
import AISettings from './AISettings'
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { ArrowRight, ArrowUpRight, CircleHelp, FileStack, FolderOpen, Globe2, LogOut, Plus, Search, SlidersHorizontal } from 'lucide-react'
import { ApiError, api, setCsrf } from './api'
import { AuthContext, Button, Empty, Modal, Notice, Preferences, Status, useAuth } from './components'
import { statuses, useLocale } from './i18n'
import type { Session, SystemRow } from './types'
import Workspace from './Workspace'
import Library from './MLPSLibrary'
import { PasswordChange } from './Team'
import TeamPage from './People'
import AuditPage from './AuditPage'

export function LanguageSwitch() {
  const { locale, setLocale, t } = useLocale()
  return <button className="language-button" onClick={() => setLocale(locale === 'zh' ? 'en' : 'zh')} aria-label={t('切换为 English', 'Switch to 简体中文')}><Globe2 size={15} /><span>{locale === 'zh' ? 'EN' : '中文'}</span></button>
}
function Login() {
  const { t, error: translate } = useLocale()
  const location = useLocation()
  const token = location.pathname.startsWith('/invite/') ? location.pathname.split('/')[2] : undefined
  const invite = useQuery({ queryKey: ['invite', token], queryFn: () => api<{ email: string; organization: string; system_name: string }>(`/invitations/${token}`), enabled: !!token })
  const [register, setRegister] = useState(!!token)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const client = useQueryClient()
  const navigate = useNavigate()
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true); setError('')
    const values = Object.fromEntries(new FormData(event.currentTarget))
    try {
      const session = await api<Session>(`/auth/${register ? 'register' : 'login'}`, { method: 'POST', body: { ...values, ...(token ? { invite_token: token } : {}) } })
      setCsrf(session.csrf); client.setQueryData(['session'], session); navigate('/')
    } catch (cause) { setError(translate(cause instanceof ApiError ? cause.code : 'NETWORK_ERROR')) } finally { setBusy(false) }
  }
  return <div className="auth-page"><div className="auth-story"><Link to="/" className="system-nameplate light">{t('系统安全评估', 'System Security Assessment')}</Link><div className="auth-story-copy"><span className="eyebrow">SECURITY STARTS WITH REQUIREMENTS</span><h1>{t('将安全要求\n前置到需求阶段。', 'Define security requirements\nduring requirements planning.')}</h1><p>{t('在需求阶段明确安全边界，将控制要求融入业务设计，与供应商共同确认可追溯、可验收的交付基线。', 'Define security boundaries during requirements planning, embed controls in business design, and agree on a traceable, verifiable delivery baseline with suppliers.')}</p></div><div className="scope-art" aria-hidden="true"><div /><div /><div /><span>01 — 02 — 03</span></div><div className="auth-foot">{t('梳理 · 评估 · 协同', 'DISCOVER · ASSESS · ALIGN')}<span>SYS–RISK / R1</span></div></div><div className="auth-form-panel"><div className="auth-top"><LanguageSwitch /></div><div className="auth-form-content"><span className="eyebrow">WORKSPACE ACCESS</span><h2>{token ? t('加入供应商协同', 'Join supplier collaboration') : register ? t('建立你的工作空间', 'Create your workspace') : t('欢迎回来', 'Welcome back')}</h2><p className="muted">{token && invite.data ? `${invite.data.system_name} · ${invite.data.organization}` : t('登录后进行系统评估与供应商协同。', 'Sign in to assess systems and collaborate with suppliers.')}</p>
    {(error || invite.error) && <Notice error>{error || translate('INVITATION_INVALID')}</Notice>}
    <form onSubmit={e => void submit(e)}>
      {register && <><label>{t('你的姓名', 'Your name')}<input name="name" required autoComplete="name" maxLength={120} /></label>{!token && <label>{t('组织名称', 'Organization')}<input name="organization" required autoComplete="organization" maxLength={200} /></label>}</>}
      <label>{register ? t('邮箱', 'Email') : t('邮箱或登录名', 'Email or username')}<input name="email" type={register ? 'email' : 'text'} required autoComplete="email" key={invite.data?.email} defaultValue={invite.data?.email ?? ''} readOnly={!!invite.data} /></label>
      <label>{t('密码', 'Password')}<input name="password" type="password" required minLength={register ? 10 : undefined} maxLength={256} autoComplete={register ? 'new-password' : 'current-password'} /></label>
      {register && <span className="field-hint">{t('至少 10 个字符。', 'Use at least 10 characters.')}</span>}
      <Button type="submit" busy={busy} className="full" disabled={!!token && !invite.data}>{register ? t('创建账号', 'Create account') : t('登录工作空间', 'Sign in')}<ArrowRight size={17} /></Button>
    </form>{!token && <button className="auth-toggle" onClick={() => { setRegister(!register); setError('') }}>{register ? t('已有账号？返回登录', 'Already have an account? Sign in') : t('第一次使用？创建工作空间', 'New here? Create a workspace')}</button>}
    <div className="auth-note"><span className="dot" />{t('数据保存在所部署的数据库中。', 'Records stay in your deployment database.')}</div></div></div></div>
}

function Shell() {
  const session = useAuth()
  const { t } = useLocale()
  const client = useQueryClient()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [error, setError] = useState('')
  async function logout() {
    try { await api('/auth/logout', { method: 'POST' }); await client.cancelQueries(); setCsrf(''); client.setQueryData(['session'], null); client.removeQueries({ predicate: query => query.queryKey[0] !== 'session' }); navigate('/') }
    catch { setError(t('退出失败，请重试。', 'Could not sign out. Please retry.')) }
  }
  return <div className="app-shell"><aside className="sidebar"><nav aria-label={t('主导航', 'Main navigation')}>
    <section className="sidebar-nav-group" aria-label={t('评估', 'Assessment')}><h2>{t('评估', 'Assessment')}</h2>
      <NavLink to="/deliveries"><FileStack size={18} />{t("交付证据与审核", "Delivery evidence & review")}</NavLink><NavLink to="/" end><FolderOpen size={18} />{t('系统评估', 'Assessments')}<span className="nav-dot" /></NavLink>
    </section>
    <section className="sidebar-nav-group" aria-label={t('规则', 'Rules')}><h2>{t('规则', 'Rules')}</h2>
      {session.user.role !== 'vendor' && <NavLink to="/library"><FileStack size={18} />{t('控制条目库', 'Control library')}</NavLink>}
      <NavLink to="/control-exemptions"><CircleHelp size={18} />{t('控制项豁免机制', 'Control exemptions')}</NavLink>
      <NavLink to="/method"><SlidersHorizontal size={18} />{t('分级方法', 'Classification')}</NavLink>
    </section>
    {(session.user.role !== 'vendor' || session.user.is_admin) && <section className="sidebar-nav-group" aria-label={t('配置', 'Configuration')}><h2>{t('配置', 'Configuration')}</h2>
      {session.user.role !== 'vendor' && <NavLink to="/team"><FolderOpen size={18} />{t('人员与权限', 'People & access')}</NavLink>}
      {session.user.is_admin && <NavLink to="/ai-settings"><SlidersHorizontal size={18} />{t('AI 模型与提示词', 'AI models & prompts')}</NavLink>}
      {session.user.is_admin && <NavLink to="/audit"><FileStack size={18} />{t('审计日志', 'Audit logs')}</NavLink>}
    </section>}
  </nav><div className="sidebar-bottom"><span className="dot" />{t('独立评估工作空间', 'ASSESSMENT WORKSPACE')}</div></aside><div className="main-frame"><header className="topbar"><div className="topbar-heading"><Link to="/" className="system-nameplate">{t('系统安全评估', 'System Security Assessment')}</Link><div className="breadcrumb">{t('工作空间', 'Workspace')}<span>/</span><strong>{pathname === '/audit' ? t('审计日志', 'Audit logs') : pathname === '/ai-settings' ? t('AI 模型与提示词', 'AI models & prompts') : pathname === '/team' ? t('人员与权限', 'People & access') : pathname === '/library' ? t('控制条目库', 'Control library') : pathname === '/control-exemptions' ? t('控制项豁免机制', 'Control exemptions') : pathname === '/method' ? t('分级方法', 'Classification') : t('系统评估', 'Assessments')}</strong></div></div><div className="topbar-actions"><LanguageSwitch /><span className="divider" /><span className="user-avatar">{session.user.name.slice(0, 1)}</span><div className="user-meta"><strong>{session.user.name}</strong><span>{session.user.is_admin ? t('系统管理员', 'Administrator') : session.user.role === 'owner' ? t('客户负责人', 'Customer owner') : session.user.role === 'vendor' ? t('供应商', 'Supplier') : t('组织成员', 'Organization member')}</span></div><button className="icon-button" aria-label={t('退出登录', 'Sign out')} title={t('退出登录', 'Sign out')} onClick={() => void logout()}><LogOut size={16} /></button></div></header>{error && <Notice error>{error}</Notice>}<main className="page"><Routes><Route path="/" element={<Dashboard />} /><Route path="/deliveries" element={<DeliveryInbox />} /><Route path="/delivery/:id" element={<DeliveryWorkspace />} /><Route path="/library" element={<Library />} /><Route path="/method" element={<GradingMethod />} /><Route path="/control-exemptions" element={<ControlExemptionGuide />} /><Route path="/ai-settings" element={<AISettings />} /><Route path="/team" element={<TeamPage />} /><Route path="/audit" element={<AuditPage />} /><Route path="/systems/:id/:tab?" element={<Workspace />} /><Route path="*" element={<Dashboard />} /></Routes></main><footer className="page-footer"><span>{t('系统安全评估 · 安全始于需求', 'System Security Assessment · Security starts with requirements')}</span><Link to="/method"><CircleHelp size={13} />{t('了解评估方法', 'About the method')}</Link></footer></div></div>
}


function Dashboard() {
  const { t, locale, error: translate } = useLocale()
  const auth = useAuth()
  const query = useQuery({ queryKey: ['systems'], queryFn: () => api<SystemRow[]>('/systems') })
  const canCreate = auth.user.can_create ?? (auth.user.is_admin || auth.user.role === 'owner')
  const [typeFilter, setTypeFilter] = useState('')
  const [assetFilter, setAssetFilter] = useState(''), [dateFilter, setDateFilter] = useState(''), [statusFilter, setStatusFilter] = useState('')
  const [newOpen, setNewOpen] = useState(false)
  const [deleting, setDeleting] = useState<SystemRow | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  async function deleteAssessment() {
    if (!deleting) return
    setDeleteBusy(true); setDeleteError('')
    try {
      await api(`/systems/${deleting.id}`, { method: 'DELETE', body: { version: deleting.version } })
      setDeleting(null); await query.refetch()
    } catch (error) { setDeleteError(translate(error instanceof ApiError ? error.code : 'NETWORK_ERROR')) }
    finally { setDeleteBusy(false) }
  }
  const [search, setSearch] = useState('')
  const systems = query.data ?? []
  const filtered = systems.filter(s => (!typeFilter || (s.assessment_type ?? 'new') === typeFilter) && (!assetFilter || s.asset_id === assetFilter) && (!dateFilter || s.assessment_scope?.as_of === dateFilter) && (!statusFilter || s.status === statusFilter) && (s.name + s.department).toLowerCase().includes(search.toLowerCase()))
  return <><div className="page-kicker"><span className="eyebrow">ASSESSMENT WORKSPACE</span><span className="mono muted">{new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-GB', { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date())}</span></div><section className="dashboard-hero"><div className="hero-copy"><h1>{t('系统安全评估管理', 'System security assessments')}</h1><p>{t('管理系统信息、分级、控制要求、供应商答复及开发基线。', 'Manage system information, classification, controls, supplier responses and development baselines.')}</p>{canCreate && <Button onClick={() => setNewOpen(true)}><Plus size={17} />{t('新建系统安全评估', 'Create system security assessment')}</Button>}</div></section>
    <div className="stat-strip"><div><span>{t('全部系统', 'All systems')}</span><strong>{String(systems.length).padStart(2, '0')}</strong></div><div><span>{t('评估进行中', 'In progress')}</span><strong>{String(systems.filter(s => !['PENDING_DEVELOPMENT', 'ASSESSMENT_COMPLETE', 'ACCEPTED_RISKS'].includes(s.status)).length).padStart(2, '0')}</strong></div><div><span>{t('已形成共识', 'Agreed baselines')}</span><strong>{String(systems.filter(s => s.status === 'PENDING_DEVELOPMENT').length).padStart(2, '0')}</strong></div></div>
    <section className="ledger"><div className="form-grid"><label>{t('系统档案筛选', 'Filter system asset')}<select value={assetFilter} onChange={e => setAssetFilter(e.target.value)}><option value="">{t('全部', 'All')}</option>{Array.from(new Map(systems.filter(s => s.asset_id).map(s => [s.asset_id!, s.asset_name ?? s.name])).entries()).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label><label>{t('基准日期筛选', 'Filter reference date')}<input type="date" value={dateFilter} onChange={e => setDateFilter(e.target.value)} /></label><label>{t('处置状态筛选', 'Filter disposition status')}<select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}><option value="">{t('全部', 'All')}</option>{[...new Set(systems.map(s => s.status))].map(status => <option key={status} value={status}>{statuses[status] ? t(...statuses[status]) : status}</option>)}</select></label></div><label>{t('评估类型筛选', 'Filter assessment type')}<select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}><option value="">{t('全部', 'All')}</option><option value="new">{t('新建系统', 'New system')}</option><option value="existing">{t('现有系统', 'Existing system')}</option></select></label><div className="section-heading"><div><span className="eyebrow">YOUR ASSESSMENTS</span><h2>{t('评估台账', 'Assessment ledger')}</h2></div><label className="search-field"><Search size={16} /><input aria-label={t('搜索评估', 'Search assessments')} placeholder={t('按名称或部门搜索', 'Search name or department')} value={search} onChange={e => setSearch(e.target.value)} /></label></div>
    {query.error && <Notice error>{translate(query.error instanceof ApiError ? query.error.code : 'NETWORK_ERROR')}</Notice>}
    {query.isPending ? <Empty title={t('正在载入工作空间…', 'Loading your workspace…')} /> : !filtered.length ? <Empty title={search ? t('没有匹配的评估', 'No matching assessments') : t('你的第一份评估，从一句话开始。', 'Your first assessment starts with a description.')} description={t('说清系统要做什么、谁会使用、希望改善什么。其余事项，我们逐步理清。', 'Describe what the system does, who uses it, and what should improve. Work through the rest one step at a time.')} >{canCreate && !search && <Button variant="secondary" onClick={() => setNewOpen(true)}>{t('新建系统安全评估', 'Create system security assessment')}<ArrowRight size={16} /></Button>}</Empty> : <div className="table-scroll"><table><thead><tr><th>{t('系统 / 业务归属', 'SYSTEM / DEPARTMENT')}</th><th>{t('等级', 'LEVEL')}</th><th>{t('当前阶段', 'CURRENT STAGE')}</th><th>{t('最近更新', 'LAST UPDATED')}</th><th /></tr></thead><tbody>{filtered.map((s, index) => <tr key={s.id}><td><Link className="system-name" to={`/systems/${s.id}`}><span className="row-index">{String(index + 1).padStart(2, '0')}</span><div><strong>{s.name}</strong>{s.asset_name && <small>{s.asset_name} · {t('评估轮次', 'Assessment round')} {s.assessment_round} · {s.assessment_scope?.as_of ?? '—'}</small>}<small>{s.assessment_type === 'existing' ? t('现有系统评估', 'Existing-system assessment') : t('新建系统评估', 'New-system assessment')} · </small><small>{s.department || t('业务归属待梳理', 'Department to be clarified')}</small></div></Link></td><td>{s.level ? <span className={`level-badge ${s.level}`}>{s.level}</span> : <span className="muted">—</span>}</td><td><Status status={s.status} /></td><td className="muted mono">{new Date(s.updated_at * 1000).toLocaleDateString(locale === 'zh' ? 'zh-CN' : 'en-GB')}</td><td>{auth.user.is_admin && <Button variant="text" onClick={() => { setDeleteError(''); setDeleting(s) }} aria-label={`${t('删除评估', 'Delete assessment')} ${s.name}`}>{t('删除', 'Delete')}</Button>}<Link className="icon-button" aria-label={`${t('打开', 'Open')} ${s.name}`} to={`/systems/${s.id}`}><ArrowUpRight size={18} /></Link></td></tr>)}</tbody></table></div>}</section>
    {deleting && <Modal title={t('删除评估', 'Delete assessment')} close={() => { if (!deleteBusy) setDeleting(null) }}><p>{t('确认删除此评估？删除后将从台账隐藏并停止访问，历史记录及审计信息保留。', 'Delete this assessment? It will be hidden from the ledger and access will stop. History and audit records are retained.')}</p><p><strong>{deleting.name}</strong></p>{deleteError && <Notice error>{deleteError}</Notice>}<Button variant="secondary" disabled={deleteBusy} onClick={() => setDeleting(null)}>{t('取消', 'Cancel')}</Button><Button busy={deleteBusy} onClick={() => void deleteAssessment()}>{t('确认删除', 'Confirm deletion')}</Button></Modal>}
    {auth.user.role === 'vendor' && <SupplierRemediations />}
    {newOpen && <Modal title={t('新建系统安全评估', 'Create system security assessment')} close={() => setNewOpen(false)}><AssessmentCreate onCreated={() => setNewOpen(false)} /></Modal>}
  </>
}

export default function App() {

  const client = useQueryClient()

  useEffect(() => {

    const expired = () => {

      setCsrf('')

      client.setQueryData(['session'], null)

      client.removeQueries({ predicate: query => query.queryKey[0] !== 'session' })

    }

    window.addEventListener('scope-session-expired', expired)

    return () => window.removeEventListener('scope-session-expired', expired)

  }, [client])

  const session = useQuery({ queryKey: ['session'], queryFn: async () => { try { const data = await api<Session>('/auth/session'); setCsrf(data.csrf); return data } catch (error) { if (error instanceof ApiError && error.code === 'AUTH_REQUIRED') return null; throw error } } })

  const { t } = useLocale()

  useEffect(() => { document.title = t('系统安全评估', 'System Security Assessment') }, [t])

  if (session.isPending) return <div className="boot"><span className="system-nameplate">{t('系统安全评估', 'System Security Assessment')}</span><p>{t('正在打开工作空间…', 'Opening your workspace…')}</p></div>

  if (!session.data) return <>{session.error && <div className="connection-error"><Notice error>{t('无法连接后端，请确认服务已启动。', 'Cannot connect to the backend. Check the service is running.')}</Notice></div>}<Login /></>

  return <AuthContext.Provider value={session.data}><Preferences>{session.data.user.must_change_password ? <PasswordChange /> : <Shell />}</Preferences></AuthContext.Provider>

}

