import AssessmentCreate from './AssessmentCreate'
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { api, ApiError, setCsrf } from './api'
import { Button, Modal, Notice, useAuth } from './components'
import { useLocale } from './i18n'
import type { SystemDetail } from './types'
import { CreateAccount, MembershipEditor, RoleGuide } from './ProjectRoles'
import type { Team } from './ProjectRoles'

export function PasswordChange() {
  const { t, error: translate } = useLocale(); const client = useQueryClient(); const [error, setError] = useState(''); const [busy, setBusy] = useState(false)
  return <main className="password-page paper-panel"><Link to="/" className="system-nameplate">{t('系统安全评估', 'System Security Assessment')}</Link><h1>{t('设置你的新密码', 'Set your new password')}</h1><p>{t('临时密码需要更换后才能进入工作空间。', 'Replace your temporary password before entering the workspace.')}</p>{error && <Notice error>{error}</Notice>}<form onSubmit={async e => { e.preventDefault(); const values = Object.fromEntries(new FormData(e.currentTarget)); if (values.password !== values.confirm) { setError(t('两次密码不一致。', 'Passwords do not match.')); return } setBusy(true); try { await api('/auth/password', { method: 'POST', body: values }); setCsrf(''); client.clear(); window.location.assign('/') } catch (e) { setError(translate(e instanceof ApiError ? e.code : 'NETWORK_ERROR')) } finally { setBusy(false) } }}><label>{t('当前密码', 'Current password')}<input name="current_password" type="password" required autoComplete="current-password" /></label><label>{t('新密码', 'New password')}<input name="password" type="password" minLength={10} maxLength={256} required autoComplete="new-password" /></label><label>{t('再次输入', 'Confirm password')}<input name="confirm" type="password" required autoComplete="new-password" /></label><Button type="submit" busy={busy}>{t('保存并重新登录', 'Save and sign in again')}</Button></form></main>
}

export function TaskAssignment({ detail }: { detail?: SystemDetail }) {
  const { user } = useAuth()
  const { t, error: translate } = useLocale(); const client = useQueryClient(); const navigate = useNavigate()
  const query = useQuery({ queryKey: ['team'], queryFn: () => api<Team>('/team') })
  const [project, setProject] = useState(''); const [operator, setOperator] = useState(''); const [reviewers, setReviewers] = useState<string[]>([]); const [name, setName] = useState(''); const [error, setError] = useState('')
  const team = query.data
  const projects = team?.projects.filter(p => p.active && (user.is_admin || p.roles.includes('manager'))) ?? []
  if (!team || !projects.length || detail && !detail.permissions?.includes('manage')) return null
  if (!detail) return <details className="intake-section"><summary>{t('创建项目评估', 'Create project assessment')}</summary><div className="intake-body"><AssessmentCreate /></div></details>
  const eligible = (role: string) => team.users.filter(u => u.memberships.some(m => m.project_id === project && m.role === role))
  return <details className="intake-section" open={!!detail}><summary>{detail ? t('项目与任务分派', 'Project and assignments') : t('建立项目评估任务', 'Create a project assessment')}</summary><div className="intake-body">{error && <Notice error>{error}</Notice>}<form onSubmit={async e => { e.preventDefault(); try { const result = await api<SystemDetail>(detail ? `/systems/${detail.system.id}/assignments` : '/systems', { method: detail ? 'PUT' : 'POST', body: { name, version: detail?.system.version, project_id: project, operator_id: operator, reviewer_ids: reviewers } }); client.setQueryData(['system', result.system.id], result); await client.invalidateQueries({ queryKey: ['systems'] }); await client.invalidateQueries({ queryKey: ['team'] }); navigate(`/systems/${result.system.id}/classification`) } catch (e) { setError(translate(e instanceof ApiError ? e.code : 'NETWORK_ERROR')) } }}><div className="intake-fields">{!detail && <label>{t('系统名称', 'System name')}<input required value={name} onChange={e => setName(e.target.value)} /></label>}<label>{t('所属项目', 'Project')}<select required value={project} onChange={e => { setProject(e.target.value); setOperator(''); setReviewers([]) }}><option value="">{t('选择项目', 'Select project')}</option>{projects.map(p => <option value={p.id} key={p.id}>{p.name}</option>)}</select></label><label>{t('经办人', 'Operator')}<select required value={operator} onChange={e => { setOperator(e.target.value); setReviewers(old => old.filter(id => id !== e.target.value)) }}><option value="">{t('选择经办人', 'Select operator')}</option>{eligible('operator').map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label></div><p>{t('受派评审人', 'Assigned reviewers')}</p><div className="intake-options">{eligible('reviewer').filter(u => u.id !== operator).map(u => <label key={u.id} className="check-label"><input type="checkbox" checked={reviewers.includes(u.id)} onChange={e => setReviewers(e.target.checked ? [...reviewers, u.id] : reviewers.filter(id => id !== u.id))} />{u.name}</label>)}</div><Button type="submit" disabled={!project || !operator}>{t('保存任务分派', 'Save assignment')}</Button></form></div></details>
}

export default function TeamPage() {
  const { user } = useAuth()
  const { t, error: translate } = useLocale()
  const client = useQueryClient()
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [secret, setSecret] = useState('')
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState('')
  const [busy, setBusy] = useState(false)
  const [newProject, setNewProject] = useState('')
  const [projectPurpose, setProjectPurpose] = useState('new')
  const [assessmentId, setAssessmentId] = useState('')
  const query = useQuery({ queryKey: ['team'], queryFn: () => api<Team>('/team') })
  const assessment = useQuery({ queryKey: ['system', assessmentId], queryFn: () => api<SystemDetail>(`/systems/${assessmentId}`), enabled: !!assessmentId })


  async function change(path: string, body: unknown, method = 'PUT'): Promise<boolean> {
    if (busy) return false
    setBusy(true); setError(''); setMessage('')
    try {
      const result = await api<{ id?: string; temporary_password?: string }>(path, { method, body })
      if (result.temporary_password) setSecret(result.temporary_password)
      if (path === '/admin/projects' && result.id) setNewProject(result.id)
      const selfChange = path === `/admin/users/${user.id}` || path === `/admin/users/${user.id}/reset-password` || path.endsWith(`/members/${user.id}`)
      if (selfChange) {
        await client.cancelQueries()
        setCsrf('')
        window.dispatchEvent(new Event('scope-session-expired'))
        return true
      }
      await query.refetch()
      await client.invalidateQueries({ queryKey: ['admin-audits'] })
      setMessage(path === '/admin/users'
        ? t('账号已创建，所选项目角色已一并保存。请安全交付临时密码。', 'Account created with the selected project roles. Share the temporary password securely.')
        : path === '/admin/projects'
          ? t('项目已创建。现在可以在新增账号或账号列表中分配业务角色。', 'Project created. Assign business roles when creating an account or in the account list.')
          : t('权限设置已保存。受影响的账号需重新登录后使用。', 'Access settings saved. The affected user must sign in again.'))
      return true
    } catch (cause) {
      setError(translate(cause instanceof ApiError ? cause.code : 'NETWORK_ERROR'))
      return false
    } finally { setBusy(false) }
  }

  return <>
    <div className="page-heading"><div><span className="eyebrow">{t('人员与职责', 'PEOPLE & RESPONSIBILITY')}</span><h1>{t('项目与任务分派', 'Projects & assignments')}</h1><p>{t('管理员可直接授权和分派；业务负责人可管理所负责项目的普通角色和任务。', 'Administrators can grant roles and assign tasks directly. Managers manage ordinary roles and tasks in their projects.')}</p></div></div>
    {(error || query.error) && <Notice error>{error || t('读取失败。', 'Could not load team.')}</Notice>}
    {message && <Notice>{message}</Notice>}
    {secret && <Notice><p>{t('临时密码仅本次显示，请安全交给账号使用者；首次登录须更换。', 'Temporary password shown once. Share it securely; the user must replace it on first sign-in.')}</p><code>{secret}</code><Button variant="secondary" onClick={() => setSecret('')}>{t('关闭显示', 'Dismiss')}</Button></Notice>}
    <RoleGuide />
    {user.is_admin && query.data && <>
      {!query.data.projects.some(project => project.active) && <Notice><p>{t('尚未创建项目，业务角色需要先有授权项目。', 'No project exists yet. Business roles need a project scope.')}</p><a href="#create-project">{t('先创建第一个项目', 'Create the first project')}</a></Notice>}
      <div className="admin-forms">
        <CreateAccount team={query.data} change={change} busy={busy} newProject={newProject} />
        <form className="paper-panel" id="create-project" aria-label={t('新增项目', 'Create project')} onSubmit={async event => {
          event.preventDefault()
          const form = event.currentTarget
          if (await change('/admin/projects', Object.fromEntries(new FormData(form)), 'POST')) form.reset()
        }}>
          <h2>{t('新增项目', 'Create project')}</h2><div className="stage-actions"><Button type="button" variant="secondary" onClick={() => setProjectPurpose('new')}>{t('创建新建系统项目', 'Create a new-system project')}</Button><Button type="button" variant="secondary" onClick={() => setProjectPurpose('existing')}>{t('创建现有系统评估项目', 'Create an existing-system assessment project')}</Button></div><label>{t('项目用途', 'Project purpose')}<select name="purpose" value={projectPurpose} onChange={e => setProjectPurpose(e.target.value)}><option value="new">{t('新建系统建设项目', 'New-system development project')}</option><option value="existing">{t('现有系统评估项目', 'Existing-system assessment project')}</option></select></label>
          <label>{t('项目名称', 'Project name')}<input name="name" required maxLength={200} disabled={busy} /></label>
          <Button type="submit" busy={busy}>{t('创建项目', 'Create project')}</Button>
          <p className="field-hint">{t('管理员自动拥有全部项目权限，可直接分配角色与任务。', 'Administrators have full project access and can assign roles and tasks directly.')}</p>
        </form>
      </div>
    </>}
    {!!query.data?.assessments?.length && <section className="paper-panel">
      <h2>{t('已有评估与项目', 'Existing assessments and projects')}</h2>
      <p>{t('授权按项目设置。管理员可直接关联和分派全部评估，业务负责人可分派所负责项目的评估。', 'Administrators can link and assign all assessments. Managers can assign assessments in their projects.')}</p>
      <div className="table-scroll"><table><thead><tr><th>{t('评估', 'Assessment')}</th><th>{t('所属项目', 'Project')}</th><th>{t('操作', 'Actions')}</th></tr></thead><tbody>{query.data.assessments.map(item => <tr key={item.id}>
        <td><Link to={`/systems/${item.id}/classification`}>{item.name}</Link></td><td>{query.data!.projects.find(project => project.id === item.project_id)?.name ?? t('尚未关联项目', 'Not linked to a project')}</td>
        <td>{!item.project_id && !query.data!.projects.some(project => project.name === item.name) && <Button variant="secondary" busy={busy} onClick={() => void change('/admin/projects', { name: item.name }, 'POST')}>{t('建立同名项目', 'Create matching project')}</Button>} <Button variant="secondary" onClick={() => setAssessmentId(item.id)}>{t('关联与分派', 'Link and assign')}</Button></td>
      </tr>)}</tbody></table></div>
    </section>}
    {assessmentId && <Modal title={t('关联已有评估', 'Link an existing assessment')} close={() => setAssessmentId('')} wide>
      {assessment.isPending && <p>{t('正在加载…', 'Loading…')}</p>}
      {assessment.error && <Notice error>{t('无法读取评估。', 'Could not load assessment.')}</Notice>}
      {assessment.data && <><h3>{assessment.data.system.name}</h3>{query.data?.projects.some(project => project.active && (user.is_admin || project.roles.includes('manager'))) && assessment.data.permissions?.includes('manage') ? <TaskAssignment key={assessmentId} detail={assessment.data} /> : <Notice>{t('需要此评估及目标项目的管理权限才能关联与分派，请联系管理员授权。', 'Managing this assessment and the target project is required to link and assign it. Contact an administrator for access.')}</Notice>}</>}
    </Modal>}
    <TaskAssignment />
    {query.data && <section className="paper-panel">
      <h2>{t('账号与授权', 'Accounts and permissions')}</h2>
      <p>{t('选择账号查看详情，配置组织权限和项目业务角色。', 'Select an account to configure organization access and project roles.')}</p>
      <label>{t('搜索账号', 'Search accounts')}<input value={q} onChange={event => setQ(event.target.value)} placeholder={t('姓名、登录名或邮箱', 'Name, username or email')} /></label>
      <div className="table-scroll"><table><thead><tr><th>{t('姓名', 'Name')}</th><th>{t('登录名', 'Username')}</th><th>{t('组织权限', 'Organization access')}</th><th>{t('状态', 'Status')}</th><th>{t('操作', 'Actions')}</th></tr></thead><tbody>
      {query.data.users.filter(person => `${person.name} ${person.username ?? ''} ${person.email ?? ''}`.toLowerCase().includes(q.toLowerCase())).map(person => <tr key={person.id}>
        <td><button className="account-link" onClick={() => { setSelected(person.id); setError(''); setMessage(''); setSecret('') }}>{person.name}</button></td><td>{person.username ?? person.email}</td><td>{person.is_admin ? t('系统管理员', 'Administrator') : t('内部账号', 'Internal account')}</td><td>{person.active ? t('已启用', 'Active') : t('已停用', 'Disabled')}</td><td><Button variant="secondary" onClick={() => { setSelected(person.id); setError(''); setMessage(''); setSecret('') }}>{t('配置', 'Configure')}</Button></td>
      </tr>)}</tbody></table></div>
      {!query.data.users.some(person => `${person.name} ${person.username ?? ''} ${person.email ?? ''}`.toLowerCase().includes(q.toLowerCase())) && <p>{t('没有匹配的账号。', 'No matching accounts.')}</p>}
      {query.data.users.filter(person => person.id === selected).map(person => <Modal key={person.id} title={`${person.name} · ${t('账号配置', 'Account settings')}`} close={() => { setSelected(''); setSecret('') }} wide>
        <p className="muted">{person.username ?? person.email} · {person.active ? t('已启用', 'Active') : t('已停用', 'Disabled')}</p>
        {error && <Notice error>{error}</Notice>}{message && <Notice>{message}</Notice>}
        {secret && <Notice><p>{t('临时密码仅本次显示，请安全交付。', 'Temporary password shown once. Share it securely.')}</p><code>{secret}</code></Notice>}
        {user.is_admin && <div className="account-admin"><h3>{t('组织管理权限', 'Organization administration')}</h3><div className="stage-actions">
          <Button variant="secondary" disabled={busy} onClick={() => void change(`/admin/users/${person.id}`, { active: !person.active })}>{person.active ? t('停用', 'Disable') : t('启用', 'Enable')}</Button>
          <Button variant="secondary" disabled={busy || person.role === 'vendor'} onClick={() => void change(`/admin/users/${person.id}`, { is_admin: !person.is_admin })}>{person.is_admin ? t('撤销管理员', 'Remove admin') : t('设为管理员', 'Make admin')}</Button>
          <Button variant="secondary" disabled={busy || person.id === user.id} onClick={() => void change(`/admin/users/${person.id}/reset-password`, {}, 'POST')}>{t('重置密码', 'Reset password')}</Button>
        </div></div>}
        <MembershipEditor person={person} team={query.data!} update={change} busy={busy} />
      </Modal>)}
    </section>}
  </>
}
