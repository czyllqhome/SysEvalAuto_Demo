import { Check, CircleHelp, Minus, ShieldCheck } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Notice, useAuth } from './components'
import { useLocale } from './i18n'

type Role = 'admin' | 'manager' | 'operator' | 'reviewer' | 'viewer' | 'supplier'
type Permission = 'allowed' | 'conditional' | 'denied'
type Grants = Record<Role, Permission>

// Reference only. Keep aligned with access.py, people.py and delivery_service.authorize;
// organization roles do not replace per-assessment grants in the current Demo.
const adminOnly: Grants = { admin: 'allowed', manager: 'denied', operator: 'denied', reviewer: 'denied', viewer: 'denied', supplier: 'denied' }
const managers: Grants = { ...adminOnly, manager: 'allowed' }
const editors: Grants = { ...managers, operator: 'allowed' }
const reviewers: Grants = { ...managers, reviewer: 'conditional' }
const suppliers: Grants = { admin: 'denied', manager: 'denied', operator: 'denied', reviewer: 'denied', viewer: 'denied', supplier: 'allowed' }
const readers: Grants = { admin: 'allowed', manager: 'allowed', operator: 'allowed', reviewer: 'allowed', viewer: 'allowed', supplier: 'conditional' }

export default function RbacMatrix() {
  const { user } = useAuth()
  const { t } = useLocale()
  if (!user.is_admin) return <Notice error>{t('仅系统管理员可以查看 RBAC 职责矩阵。', 'Only administrators can view the RBAC responsibility matrix.')}</Notice>

  const roles: { id: Role; name: string; scope: string; duty: string }[] = [
    { id: 'admin', name: t('系统管理员', 'Administrator'), scope: t('本组织全部评估与管理配置', 'All assessments and administration in this organization'), duty: t('管理账号、权限、控制来源与 AI 配置，统筹客户方评估全流程。', 'Manage accounts, access, control sources and AI settings, with full customer-side assessment authority.') },
    { id: 'manager', name: t('负责人', 'Manager'), scope: t('自己创建或获管理授权的评估', 'Assessments they created or are authorized to manage'), duty: t('发起评估、分派成员、审批下发、审查风险，并完成客户方基线确认。', 'Create assessments, assign members, approve and dispatch requirements, review risks and confirm the customer baseline.') },
    { id: 'operator', name: t('经办人', 'Operator'), scope: t('明确授予经办权限的评估', 'Assessments with an explicit operator grant'), duty: t('填写问卷、维护控制范围、编写和修订 PRD，补充核验与整改资料。', 'Complete questionnaires, maintain control scope, draft and revise PRDs, and record verification and remediation information.') },
    { id: 'reviewer', name: t('评审人', 'Reviewer'), scope: t('明确授予评审权限的评估', 'Assessments with an explicit reviewer grant'), duty: t('独立审批 PRD、审查供应商答复与风险，复核报告、复测及交付证据。', 'Independently approve PRDs, review supplier responses and risks, and review reports, retests and delivery evidence.') },
    { id: 'viewer', name: t('只读成员', 'Viewer'), scope: t('明确授予只读权限的评估', 'Assessments with an explicit viewer grant'), duty: t('查阅评估内容、结果与进度，跟踪过程，不承担编辑或审批操作。', 'Read assessment content, results and progress to follow the process without editing or approving it.') },
    { id: 'supplier', name: t('供应商', 'Supplier'), scope: t('明确下发给本供应商的任务', 'Tasks explicitly assigned to this supplier'), duty: t('答复需求、落实整改、提交交付证据，并独立确认供应商承诺与基线。', 'Respond to requirements, carry out remediation, submit delivery evidence and independently confirm supplier commitments and baselines.') },
  ]
  const groups: { name: string; rows: { name: string; grants: Grants; note?: string }[] }[] = [
    { name: t('组织管理', 'Organization administration'), rows: [
      { name: t('账号、组织角色与管理员授权', 'Accounts, organization roles and administrator grants'), grants: adminOnly, note: t('包括创建账号、启停账号与重置密码。', 'Includes account creation, activation, deactivation and password resets.') },
      { name: t('AI 模型、提示词与 PRD 模板配置', 'AI models, prompts and PRD templates'), grants: adminOnly },
      { name: t('上传控制来源文件', 'Upload control source files'), grants: adminOnly },
      { name: t('查看管理审计日志', 'Read administration audit logs'), grants: adminOnly },
    ] },
    { name: t('评估工作', 'Assessment work'), rows: [
      { name: t('创建系统安全评估', 'Create system security assessments'), grants: managers },
      { name: t('查看评估内容与进度', 'Read assessment content and progress'), grants: readers, note: t('供应商仅查看已下发任务的供应商视图。', 'Suppliers see only the supplier view of assigned tasks.') },
      { name: t('授权或撤销评估成员', 'Grant or revoke assessment membership'), grants: managers, note: t('仅调整普通账号的经办、评审和只读权限；不用于授予负责人或管理员。', 'Assign operator, reviewer or viewer access to ordinary accounts; this does not grant manager or administrator authority.') },
      { name: t('编辑问卷、控制范围及 PRD', 'Edit questionnaires, control scope and PRDs'), grants: editors, note: t('包括核验记录、整改资料及允许的生成操作。', 'Includes verification records, remediation information and permitted generation actions.') },
      { name: t('审批 PRD、审查风险及报告', 'Approve PRDs and review risks and reports'), grants: reviewers, note: t('包括影响分析与复测；普通评审人须无本评估编辑贡献。', 'Includes impact analysis and retests; ordinary reviewers must have no editing contribution to this assessment.') },
      { name: t('删除评估', 'Delete assessments'), grants: adminOnly },
    ] },
    { name: t('供应商协同与基线', 'Supplier collaboration and baselines'), rows: [
      { name: t('下发 PRD、发起协商轮次', 'Dispatch PRDs and open negotiation rounds'), grants: managers },
      { name: t('填写并提交供应商答复', 'Edit and submit supplier responses'), grants: suppliers },
      { name: t('冻结基线、客户方确认', 'Freeze baselines and confirm as the customer'), grants: managers },
      { name: t('供应商独立确认基线', 'Independently confirm as the supplier'), grants: suppliers },
    ] },
    { name: t('交付验收', 'Delivery acceptance'), rows: [
      { name: t('上传并提交供应商交付证据', 'Upload and submit supplier delivery evidence'), grants: suppliers },
      { name: t('审核交付证据', 'Review delivery evidence'), grants: { ...reviewers, operator: 'conditional' }, note: t('经办人还须是原任务分派的经办人；评审人须符合独立评审条件。均不得验收本人提交。', 'Operators also need the original task assignment; reviewers must meet the independence condition. No one may review their own submission.') },
    ] },
  ]
  const labels: Record<Permission, string> = {
    allowed: t('可执行', 'Allowed'), conditional: t('有条件', 'Conditional'), denied: t('不授予', 'Not granted'),
  }
  function badge(permission: Permission) {
    const Icon = permission === 'allowed' ? Check : permission === 'conditional' ? CircleHelp : Minus
    return <span className={`rbac-permission rbac-${permission}`}><Icon size={14} aria-hidden="true" />{labels[permission]}</span>
  }

  return <section className="rbac-page">
    <header className="rbac-heading">
      <div><span className="eyebrow"><ShieldCheck size={16} aria-hidden="true" />{t('角色与访问控制', 'ROLE-BASED ACCESS CONTROL')}</span><h1>{t('RBAC 职责矩阵', 'RBAC responsibility matrix')}</h1><p>{t('对照角色职责、授权范围和业务操作，明确每个角色可以做什么。', 'Compare responsibilities, access scope and business actions to see what each role can do.')}</p></div>
      <Link className="button secondary" to="/team">{t('管理人员与权限', 'Manage people & access')}</Link>
    </header>

    <section className="rbac-role-grid" aria-label={t('角色职责与范围', 'Role responsibilities and scope')}>
      {roles.map(role => <article key={role.id}><h2>{role.name}</h2><p>{role.duty}</p><div className="rbac-role-scope"><strong>{t('范围', 'Scope')}</strong><span>{role.scope}</span></div></article>)}
    </section>

    <section className="rbac-panel" aria-labelledby="rbac-permissions-title">
      <div className="rbac-panel-heading"><h2 id="rbac-permissions-title">{t('业务操作权限矩阵', 'Business action permissions')}</h2><div className="rbac-legend" aria-label={t('权限图例', 'Permission legend')}>{(['allowed', 'conditional', 'denied'] as const).map(value => <span key={value}>{badge(value)}</span>)}</div></div>
      <p className="rbac-description" id="rbac-permissions-description">{t('“可执行”均限于上方授权范围，并须满足当前流程和版本条件；“有条件”请结合该行说明。此页用于查阅，实际授权在“人员与权限”中管理。', 'Allowed actions are limited to the scopes above and remain subject to workflow and version checks. Read each row’s notes for conditional access. This is a reference page; manage actual grants in People & access.')}</p>
      <div className="rbac-table-scroll" role="region" aria-labelledby="rbac-permissions-title" tabIndex={0}>
        <table className="rbac-table" aria-labelledby="rbac-permissions-title" aria-describedby="rbac-permissions-description">
          <thead><tr><th scope="col">{t('业务操作 / 职责', 'Business action / responsibility')}</th>{roles.map(role => <th scope="col" key={role.id}>{role.name}</th>)}</tr></thead>
          {groups.map(group => <tbody key={group.name}>
            <tr className="rbac-group"><th colSpan={7} scope="rowgroup"><span>{group.name}</span></th></tr>
            {group.rows.map(row => <tr key={row.name}><th scope="row">{row.name}{row.note && <small>{row.note}</small>}</th>{roles.map(role => <td key={role.id}>{badge(row.grants[role.id])}</td>)}</tr>)}
          </tbody>)}
        </table>
      </div>
    </section>

    <section className="rbac-notes" aria-labelledby="rbac-boundaries-title"><h2 id="rbac-boundaries-title">{t('授权与职责边界', 'Access and responsibility boundaries')}</h2><ul>
      <li>{t('组织角色不自动开放全部评估。负责人仅管理自己创建或已获管理授权的评估；经办、评审和只读成员须逐评估授权，具体操作按该评估的成员角色确定。', 'An organization role does not open every assessment. Managers act on assessments they created or are authorized to manage; operators, reviewers and viewers need individual assessment grants. The assessment membership determines their actions.')}</li>
      <li>{t('普通评审人若曾编辑该评估，仅保留读取权限。管理员和负责人可跨客户方编辑、评审与确认阶段操作，但仍受来源、修订和流程检查约束。', 'Ordinary reviewers who edited an assessment retain read access only. Administrators and managers may act across customer editing, review and confirmation stages, subject to source, revision and workflow checks.')}</li>
      <li>{t('供应商使用独立身份，客户方不能代填供应商答复或代签。双方必须分别确认同一份基线内容哈希，才能完成双方确认。', 'Suppliers use an independent identity. Customers cannot submit responses or sign on their behalf. Both parties must independently confirm the same baseline content hash.')}</li>
      <li>{t('交付验收是独立权限场景：保留原任务分派的经办人可审核供应商交付证据；单独授予评估经办角色不包含该权限，也不赋予 PRD、风险报告或基线审批权限。', 'Delivery review has a separate allowance: an operator with the original task assignment may review supplier evidence. An assessment operator grant alone does not provide this access or authority to approve PRDs, risk reports or baselines.')}</li>
    </ul></section>
  </section>
}
