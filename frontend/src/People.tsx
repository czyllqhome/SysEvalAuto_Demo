import { useState } from 'react'
import type { FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, FolderLock, KeyRound, Plus, Search, ShieldCheck, UserRound, UsersRound } from 'lucide-react'
import { api, ApiError } from './api'
import { Button, Modal, Notice, useAuth } from './components'
import { useLocale } from './i18n'

type Person = { id: string; name: string; username?: string; role: string; organization_role: string; is_admin: boolean; active: boolean }
type Assessment = { id: string; name: string; version: number; owner_id: string; members: { user_id: string; role: string }[] }
type PeopleData = { users: Person[]; assessments: Assessment[] }

function accountInitial(name: string) {
  const label = name.trim().replace(/^【演示(?:虚构)?】\s*/u, '')
  return label.match(/[\p{L}\p{N}]/u)?.[0].toLocaleUpperCase() ?? '?'
}

export default function People() {
  const { user } = useAuth()
  const { t, error: translate } = useLocale()
  const query = useQuery({ queryKey: ['people'], queryFn: () => api<PeopleData>('/people') })
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [secret, setSecret] = useState('')
  const [busy, setBusy] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [selectedId, setSelectedId] = useState('')
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [assessmentId, setAssessmentId] = useState('')
  const [memberSearch, setMemberSearch] = useState('')
  const labels: Record<string, string> = {
    manager: t('负责人', 'Manager'), operator: t('经办人', 'Operator'),
    reviewer: t('评审人', 'Reviewer'), viewer: t('只读成员', 'Viewer'),
    supplier: t('供应商', 'Supplier'),
  }
  const users = query.data?.users ?? []
  const assessments = query.data?.assessments ?? []
  const selected = users.find(person => person.id === selectedId)
  const current = assessments.find(item => item.id === assessmentId)
  const eligible = users.filter(person => person.active && person.role !== 'vendor' && !person.is_admin && person.organization_role !== 'manager' && person.id !== current?.owner_id)
    .filter(person => `${person.name} ${person.username ?? ''}`.toLocaleLowerCase().includes(memberSearch.trim().toLocaleLowerCase()))
  const visible = users.filter(person => {
    const role = person.role === 'vendor' ? 'supplier' : person.organization_role
    return `${person.name} ${person.username ?? ''}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
      && (!roleFilter || (roleFilter === 'admin' ? person.is_admin : role === roleFilter))
      && (!statusFilter || (statusFilter === 'active') === person.active)
  })

  async function change(path: string, body: unknown, method = 'PUT'): Promise<boolean> {
    if (busy) return false
    setBusy(true); setError(''); setMessage(''); setSecret('')
    try {
      const result = await api<{ temporary_password?: string }>(path, { method, body })
      setSecret(result.temporary_password ?? '')
      await query.refetch()
      setMessage(path === '/admin/users'
        ? t('账号已创建。临时密码仅本次显示，请安全交付。', 'Account created. The temporary password is shown once; share it securely.')
        : path.endsWith('/reset-password')
          ? t('密码已重置。临时密码仅本次显示。', 'Password reset. The temporary password is shown once.')
          : t('权限设置已保存，受影响的账号需重新登录后使用。', 'Access saved. The affected account must sign in again.'))
      if (path.includes(user.id)) window.dispatchEvent(new Event('scope-session-expired'))
      return true
    } catch (cause) {
      setError(translate(cause instanceof ApiError ? cause.code : 'NETWORK_ERROR'))
      return false
    } finally { setBusy(false) }
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    if (await change('/admin/users', Object.fromEntries(new FormData(form)), 'POST')) {
      form.reset()
      setCreateOpen(false)
    }
  }

  return <div className="people-page">
    <header className="people-heading">
      <div><span className="eyebrow">PEOPLE & ACCESS</span><h1>{t('人员与权限', 'People & access')}</h1></div>
      {user.is_admin && <Button onClick={() => setCreateOpen(true)}><Plus size={17} />{t('新增账号', 'Create account')}</Button>}
    </header>

    {(error || query.error) && <Notice error>{error || t('无法读取人员，请使用负责人或管理员账号。', 'Could not load people. Sign in as a manager or administrator.')}</Notice>}
    {message && <Notice>{message}{secret && <div className="people-secret"><span>{t('临时密码', 'Temporary password')}</span><code>{secret}</code><Button variant="text" onClick={() => setSecret('')}>{t('关闭显示', 'Dismiss')}</Button></div>}</Notice>}

    <section className="people-overview" aria-label={t('人员概览', 'People overview')}>
      <div><UsersRound size={20} /><span>{t('账号总数', 'Total accounts')}</span><strong>{users.length}</strong></div>
      <div><UserRound size={20} /><span>{t('已启用', 'Active accounts')}</span><strong>{users.filter(person => person.active).length}</strong></div>
      <div><ShieldCheck size={20} /><span>{t('管理员', 'Administrators')}</span><strong>{users.filter(person => person.is_admin).length}</strong></div>
      <div><FolderLock size={20} /><span>{t('可管理评估', 'Managed assessments')}</span><strong>{assessments.length}</strong></div>
    </section>

    <div className="people-layout">
      <section className="people-directory" aria-labelledby="people-directory-title">
        <div className="people-section-heading"><div><span className="eyebrow">DIRECTORY</span><h2 id="people-directory-title">{t('账号目录', 'Account directory')}</h2></div><span className="people-count">{visible.length} / {users.length}</span></div>
        <div className="people-toolbar">
          <label className="people-search"><Search size={17} /><input aria-label={t('搜索账号', 'Search accounts')} placeholder={t('搜索姓名或登录名', 'Search name or username')} value={search} onChange={event => setSearch(event.target.value)} /></label>
          <label>{t('角色', 'Role')}<select aria-label={t('筛选角色', 'Filter role')} value={roleFilter} onChange={event => setRoleFilter(event.target.value)}><option value="">{t('全部角色', 'All roles')}</option><option value="admin">{t('管理员', 'Administrator')}</option>{Object.entries(labels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <label>{t('状态', 'Status')}<select aria-label={t('筛选状态', 'Filter status')} value={statusFilter} onChange={event => setStatusFilter(event.target.value)}><option value="">{t('全部状态', 'All statuses')}</option><option value="active">{t('已启用', 'Active')}</option><option value="disabled">{t('已停用', 'Disabled')}</option></select></label>
        </div>
        <div className="people-table-scroll"><table><thead><tr><th scope="col">{t('人员', 'Person')}</th><th scope="col">{t('组织角色', 'Organization role')}</th><th scope="col">{t('账号状态', 'Account status')}</th><th scope="col">{t('操作', 'Action')}</th></tr></thead><tbody>
          {visible.map(person => <tr key={person.id}><td><span className="people-identity"><span className="people-avatar" aria-hidden="true">{accountInitial(person.name)}</span><span><strong>{person.name}</strong><small>{person.username ?? person.role}</small></span></span></td>
            <td><span className={`people-role ${person.is_admin ? 'admin' : ''}`}>{person.is_admin ? t('系统管理员', 'Administrator') : labels[person.role === 'vendor' ? 'supplier' : person.organization_role] ?? person.organization_role}</span></td>
            <td><span className={`people-state ${person.active ? 'active' : 'disabled'}`}><i />{person.active ? t('已启用', 'Active') : t('已停用', 'Disabled')}</span></td>
            <td><Button variant="secondary" onClick={() => { setSelectedId(person.id); setError(''); setMessage(''); setSecret('') }}>{t('配置权限', 'Configure access')}<ArrowRight size={14} /></Button></td></tr>)}
        </tbody></table></div>
        {query.isPending && <p className="people-empty">{t('正在加载账号…', 'Loading accounts…')}</p>}
        {!query.isPending && !visible.length && <p className="people-empty">{t('没有匹配的账号。', 'No matching accounts.')}</p>}
      </section>

      <aside className="people-context" aria-label={t('权限说明', 'Access guide')}>
        <div className="people-context-icon"><ShieldCheck size={22} /></div><h2>{t('权限如何生效', 'How access works')}</h2>
        <div className="people-context-step"><span>01</span><div><strong>{t('组织角色', 'Organization role')}</strong><p>{t('管理员和负责人管理组织内的评估；其他角色按授权范围工作。', 'Administrators and managers manage assessments; other roles work within their grants.')}</p></div></div>
        <div className="people-context-step"><span>02</span><div><strong>{t('评估成员', 'Assessment members')}</strong><p>{t('经办人、评审人和只读成员按具体评估授权。', 'Operators, reviewers and viewers receive access to specific assessments.')}</p></div></div>
        <div className="people-context-step"><span>03</span><div><strong>{t('独立确认', 'Independent confirmation')}</strong><p>{t('供应商使用独立账号，双方仍需确认同一基线。', 'Suppliers use separate accounts; both parties confirm the same baseline.')}</p></div></div>
        <a href="#people-assessments" className="people-context-link">{t('查看评估授权', 'View assessment access')}<ArrowRight size={15} /></a>
      </aside>
    </div>

    <section className="people-assessments" id="people-assessments" aria-labelledby="people-assessments-title">
      <div className="people-section-heading"><div><span className="eyebrow">ASSESSMENT ACCESS</span><h2 id="people-assessments-title">{t('评估成员授权', 'Assessment member access')}</h2><p>{t('选择一项评估，为合资格成员设置经办、评审或查看权限。', 'Select an assessment to grant operator, reviewer or viewer access to eligible members.')}</p></div></div>
      <div className="people-assessment-toolbar"><label>{t('选择评估', 'Select assessment')}<select value={assessmentId} onChange={event => { setAssessmentId(event.target.value); setMemberSearch('') }}><option value="">{t('请选择评估', 'Choose an assessment')}</option>{assessments.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>{current && <label className="people-search"><Search size={17} /><input aria-label={t('搜索可授权成员', 'Search eligible members')} placeholder={t('搜索可授权成员', 'Search eligible members')} value={memberSearch} onChange={event => setMemberSearch(event.target.value)} /></label>}</div>
      {current ? <><div className="people-assessment-summary"><span><strong>{current.name}</strong> · {t('已授权', 'Granted')} {current.members.length}</span><span>REV. {current.version}</span></div>
        <div className="people-table-scroll"><table><thead><tr><th scope="col">{t('成员', 'Member')}</th><th scope="col">{t('组织角色', 'Organization role')}</th><th scope="col">{t('当前评估权限', 'Assessment access')}</th></tr></thead><tbody>
          {eligible.map(person => <tr key={person.id}><td><span className="people-identity"><span className="people-avatar" aria-hidden="true">{accountInitial(person.name)}</span><span><strong>{person.name}</strong><small>{person.username ?? person.role}</small></span></span></td><td>{labels[person.organization_role] ?? person.organization_role}</td><td><select aria-label={`${person.name} ${t('评估权限', 'assessment access')}`} disabled={busy} value={current.members.find(member => member.user_id === person.id)?.role ?? ''} onChange={event => void change(`/systems/${current.id}/members/${person.id}`, { version: current.version, role: event.target.value })}><option value="">{t('未授权', 'No access')}</option>{['operator', 'reviewer', 'viewer'].map(key => <option key={key} value={key}>{labels[key]}</option>)}</select></td></tr>)}
        </tbody></table></div>{!eligible.length && <p className="people-empty">{t('没有可授权的匹配成员。', 'No eligible members match.')}</p>}</>
        : <div className="people-assessment-empty"><FolderLock size={25} /><strong>{t('选择评估以查看成员', 'Select an assessment to view members')}</strong><span>{t('授权仅作用于所选评估。', 'Grants apply only to the selected assessment.')}</span></div>}
    </section>

    {createOpen && <Modal title={t('新增组织账号', 'Create organization account')} close={() => { if (!busy) setCreateOpen(false) }}><form className="people-create-form" onSubmit={event => void create(event)}>
      <p>{t('账号创建后会生成一次性临时密码。请选择其组织角色；供应商账号独立于客户账号。', 'A one-time temporary password is generated. Choose an organization role; supplier accounts are separate from customer accounts.')}</p>
      {error && <Notice error>{error}</Notice>}
      <label>{t('姓名', 'Name')}<input name="name" required maxLength={120} autoComplete="name" /></label>
      <label>{t('登录名', 'Username')}<input name="username" required pattern="[A-Za-z0-9_.-]{3,64}" autoComplete="username" /></label>
      <label>{t('组织角色', 'Organization role')}<select name="role">{Object.entries(labels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <div className="people-modal-actions"><Button type="button" variant="secondary" onClick={() => setCreateOpen(false)} disabled={busy}>{t('取消', 'Cancel')}</Button><Button type="submit" busy={busy}><Plus size={16} />{t('创建账号', 'Create account')}</Button></div>
    </form></Modal>}

    {selected && <Modal title={`${selected.name} · ${t('账号配置', 'Account settings')}`} close={() => { if (!busy) setSelectedId('') }} wide><div className="people-detail-head"><span className="people-avatar large" aria-hidden="true">{accountInitial(selected.name)}</span><div><strong>{selected.name}</strong><span>{selected.username ?? selected.role}</span></div><span className={`people-state ${selected.active ? 'active' : 'disabled'}`}><i />{selected.active ? t('已启用', 'Active') : t('已停用', 'Disabled')}</span></div>
      {error && <Notice error>{error}</Notice>}{message && <Notice>{message}{secret && <div className="people-secret"><span>{t('临时密码', 'Temporary password')}</span><code>{secret}</code></div>}</Notice>}
      <div className="people-detail-grid"><section><h3><ShieldCheck size={17} />{t('组织角色', 'Organization role')}</h3><p>{t('组织角色决定基础职责；管理员权限独立设置。', 'The organization role sets basic duties; administrator access is separate.')}</p>{user.is_admin && selected.role !== 'vendor' ? <label>{t('当前角色', 'Current role')}<select aria-label={`${selected.name} ${t('角色', 'role')}`} disabled={busy} value={selected.organization_role} onChange={event => void change(`/people/${selected.id}/role`, { role: event.target.value })}>{Object.entries(labels).filter(([key]) => key !== 'supplier').map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label> : <span className="people-role">{labels[selected.role === 'vendor' ? 'supplier' : selected.organization_role] ?? selected.organization_role}</span>}</section>
        <section><h3><FolderLock size={17} />{t('已授权评估', 'Assessment access')}</h3><p>{t('管理员和负责人继承相应管理权限；普通成员按评估授权。', 'Administrators and managers inherit management access; other members receive assessment grants.')}</p><strong>{assessments.filter(item => item.owner_id === selected.id || item.members.some(member => member.user_id === selected.id)).length}</strong><span>{t('项直接关联的评估', 'directly linked assessments')}</span></section></div>
      {user.is_admin && <section className="people-account-actions"><h3><KeyRound size={17} />{t('账号管理', 'Account management')}</h3><div><Button variant="secondary" disabled={busy || selected.id === user.id} onClick={() => void change(`/admin/users/${selected.id}/reset-password`, {}, 'POST')}>{t('重置密码', 'Reset password')}</Button><Button variant="secondary" disabled={busy || selected.role === 'vendor'} onClick={() => void change(`/admin/users/${selected.id}`, { is_admin: !selected.is_admin })}>{selected.is_admin ? t('取消管理员', 'Remove administrator') : t('设为管理员', 'Make administrator')}</Button><Button variant="danger" disabled={busy} onClick={() => void change(`/admin/users/${selected.id}`, { active: !selected.active })}>{selected.active ? t('停用账号', 'Deactivate account') : t('启用账号', 'Activate account')}</Button></div></section>}
    </Modal>}
  </div>
}
