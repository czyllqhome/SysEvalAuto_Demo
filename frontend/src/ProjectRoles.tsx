import { useEffect, useState } from 'react'
import { Button, useAuth } from './components'
import { useLocale } from './i18n'

export type ProjectRole = 'manager' | 'operator' | 'reviewer' | 'viewer' | 'supplier'
export type TeamUser = {
  id: string; name: string; role?: string; email?: string; username?: string; active?: boolean; is_admin?: boolean
  memberships: { project_id: string; role: string }[]
}
export type Team = {
  projects: { id: string; name: string; active: boolean; roles: string[] }[]
  assessments?: { id: string; name: string; project_id: string | null }[]
  users: TeamUser[]
}
export type Change = (path: string, body: unknown, method?: string) => Promise<boolean>

export function useProjectRoles() {
  const { t } = useLocale()
  return [
    { code: 'manager' as const, name: t('业务负责人', 'Manager'), description: t('拥有项目全部客户方权限，可授权普通角色、经办、评审和最终确认。', 'Full customer project access, ordinary role grants, editing, review and final confirmation.') },
    { code: 'operator' as const, name: t('业务经办人', 'Operator'), description: t('维护受派评估的资料、问卷和草稿。', 'Maintain assigned assessment information, questionnaires and drafts.') },
    { code: 'reviewer' as const, name: t('评审人员', 'Reviewer'), description: t('审查受派评估的需求文档和结果。', 'Review PRDs and findings for assigned assessments.') },
    { code: 'supplier' as const, name: t('供应商', 'Supplier'), description: t('答复已下发 PRD 的需求与控制要求，参与协商并独立确认基线。', 'Respond to assigned PRD requirements and controls, collaborate on revisions and independently confirm the baseline.') },
    { code: 'viewer' as const, name: t('只读查看者', 'Viewer'), description: t('查看项目资料，不允许修改或审批。', 'Read project records without editing or approval.') },
  ]
}

function RoleChoices({ chosen, setChosen, disabled }: {
  chosen: string[]; setChosen: (value: string[]) => void; disabled: boolean
}) {
  const { t } = useLocale()
  const { user } = useAuth()
  const options = useProjectRoles().filter(role => user.is_admin || role.code !== 'manager')
  return <fieldset className="project-role-choices" disabled={disabled}>
    <legend>{t('项目业务角色（供应商不可兼任客户角色）', 'Project roles (supplier is exclusive)')}</legend>
    <div className="role-options">{options.map(role => <label key={role.code} className="check-label role-option">
      <input type="checkbox" aria-label={role.name} checked={chosen.includes(role.code)} onChange={event => setChosen(event.target.checked ? role.code === 'supplier' ? ['supplier'] : [...chosen.filter(value => value !== 'supplier'), role.code] : chosen.filter(value => value !== role.code))} />
      <span><strong>{role.name}</strong><small>{role.description}</small></span>
    </label>)}</div>
  </fieldset>
}

export function CreateAccount({ team, change, busy, newProject }: { team: Team; change: Change; busy: boolean; newProject: string }) {
  const { t } = useLocale()
  const [project, setProject] = useState('')
  const [chosen, setChosen] = useState<string[]>([])
  const activeProjects = team.projects.filter(item => item.active)
  useEffect(() => { if (newProject) { setProject(newProject); setChosen([]) } }, [newProject])
  return <form className="paper-panel" aria-label={t('新增账号', 'Create account')} onSubmit={async event => {
    event.preventDefault()
    const form = event.currentTarget
    const account = Object.fromEntries(new FormData(form))
    const created = await change('/admin/users', { ...account, ...(project ? { project_id: project, roles: chosen } : {}) }, 'POST')
    if (created) { form.reset(); setChosen([]) }
  }}>
    <h2>{t('新增账号并分配角色', 'Create an account with project roles')}</h2>
    <label>{t('登录名', 'Username')}<input name="username" required pattern="[A-Za-z0-9_.-]{3,64}" disabled={busy} /></label>
    <label>{t('姓名', 'Display name')}<input name="name" required maxLength={120} disabled={busy} /></label>
    <label>{t('初始授权项目', 'Initial project')}<select value={project} disabled={busy || !activeProjects.length} onChange={event => { setProject(event.target.value); setChosen([]) }}>
      <option value="">{t('仅创建账号，稍后授权', 'Create without project access')}</option>
      {activeProjects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
    </select></label>
    {!activeProjects.length && <p className="field-hint">{t('尚无项目。请先在“新增项目”中创建，再选择项目与业务角色。', 'No projects yet. Create a project first, then select its business roles.')}</p>}
    <RoleChoices chosen={chosen} setChosen={setChosen} disabled={busy || !project} />
    <p className="field-hint">{project ? t('请选择至少一个项目角色；账号与角色会一起保存。', 'Choose at least one role. The account and its roles are saved together.') : t('未选择项目的账号没有项目业务权限。管理员权限在账号列表中单独设置。', 'An account without a project has no project access. Administrator access is managed separately below.')}</p>
    <Button type="submit" busy={busy} disabled={!!project && !chosen.length}>{project ? t('创建账号并授权', 'Create account and grant roles') : t('创建临时密码账号', 'Create with temporary password')}</Button>
  </form>
}

export function MembershipEditor({ person, team, update, busy }: { person: TeamUser; team: Team; update: Change; busy: boolean }) {
  const { t } = useLocale()
  const options = useProjectRoles()
  const activeProjects = team.projects.filter(item => item.active)
  const projectIds = activeProjects.map(item => item.id).join(',')
  const [project, setProject] = useState(activeProjects[0]?.id ?? '')
  const [chosen, setChosen] = useState<string[]>([])
  const saved = person.memberships.filter(item => item.project_id === project).map(item => item.role).sort().join(',')
  useEffect(() => {
    setProject(current => projectIds.split(',').includes(current) ? current : projectIds.split(',')[0])
  }, [projectIds])
  useEffect(() => { setChosen(saved ? saved.split(',') : []) }, [project, saved])
  return <form className="membership-editor" aria-label={`${person.name} · ${t('项目角色授权', 'Project role assignment')}`} onSubmit={event => {
    event.preventDefault()
    void update(`/admin/projects/${project}/members/${person.id}`, { roles: chosen })
  }}>
    <h3>{t('项目角色授权', 'Project role assignment')}</h3>
    <div className="membership-summary">{person.memberships.length ? person.memberships.map(item => <span className="role-badge" key={`${item.project_id}:${item.role}`}>
      {team.projects.find(value => value.id === item.project_id)?.name ?? item.project_id} · {options.find(value => value.code === item.role)?.name ?? item.role}
    </span>) : <span className="field-hint">{t('尚未分配任何项目业务角色。', 'No project business roles assigned.')}</span>}</div>
    <label>{t('授权项目', 'Project to authorize')}<select value={project} disabled={busy || !person.active || !activeProjects.length} onChange={event => setProject(event.target.value)}>
      <option value="">{t('选择项目', 'Select project')}</option>{activeProjects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
    </select></label>
    {!activeProjects.length && <p className="field-hint">{t('请先创建项目，再分配业务角色。', 'Create a project before assigning business roles.')}</p>}
    {!person.active && <p className="field-hint">{t('请先启用账号，再修改项目角色。', 'Enable this account before changing project roles.')}</p>}
    <RoleChoices chosen={chosen} setChosen={setChosen} disabled={busy || !person.active || !project} />
    <p className="field-hint">{t('保存会替换所选项目的角色；全部取消即撤销该项目权限。修改本人权限后需重新登录。', 'Saving replaces roles in this project; clear all to revoke its access. Changing your own access requires signing in again.')}</p>
    <Button type="submit" variant="secondary" busy={busy} disabled={!project || !person.active}>{t('保存项目角色', 'Save project roles')}</Button>
  </form>
}

export function RoleGuide() {
  const { t } = useLocale()
  const options = useProjectRoles()
  return <section className="paper-panel role-guide"><h2>{t('角色与授权范围', 'Roles and access scopes')}</h2>
    <p>{t('管理员负责组织管理；项目角色按职责授权。客户方角色可组合，供应商必须使用独立账号。', 'Administrators manage the organization. Customer project roles can be combined; suppliers must use independent accounts.')}</p>
    <div className="table-scroll"><table><thead><tr><th>{t('角色', 'Role')}</th><th>{t('作用范围', 'Scope')}</th><th>{t('主要权限', 'Capabilities')}</th></tr></thead><tbody>
      <tr><td>{t('系统管理员', 'Administrator')}</td><td>{t('当前组织', 'Current organization')}</td><td>{t('本组织全部项目进度及业务权限、账号、角色授权、任务分派与管理审计。', 'Full organization project access, progress, accounts, role grants, assignments and audit.')}</td></tr>
      {options.map(role => <tr key={role.code}><td>{role.name}</td><td>{t('授权项目', 'Authorized project')}</td><td>{role.description}</td></tr>)}
    </tbody></table></div>
    <p className="field-hint">{t('可直接创建供应商账号并授权项目，也可通过评估邀请外部供应商。负责人下发已审核 PRD 后，供应商才能查看和答复具体任务。普通经办和评审仍遵循职责分离；管理员和业务负责人拥有完整客户方权限。已有客户业务记录的账号不能改为供应商，请新建独立账号。', 'Create a supplier account with project access or invite an external supplier. Suppliers see specific tasks only after a manager publishes an approved PRD. Ordinary operators and reviewers retain separate duties; administrators and managers have full customer access. Accounts with customer activity cannot become suppliers; create an independent account.')}</p>
  </section>
}
