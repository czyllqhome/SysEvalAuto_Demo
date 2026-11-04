import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, ApiError } from './api'
import { Button, Notice, useAuth } from './components'
import { useLocale } from './i18n'

type Person = { id: string; name: string; username?: string; role: string; organization_role: string; is_admin: boolean; active: boolean }
type Assessment = { id: string; name: string; version: number; owner_id: string; members: { user_id: string; role: string }[] }
export default function People() {
  const { user } = useAuth(), { t, error: translate } = useLocale()
  const query = useQuery({ queryKey: ['people'], queryFn: () => api<{ users: Person[]; assessments: Assessment[] }>('/people') })
  const [error, setError] = useState(''), [secret, setSecret] = useState(''), [busy, setBusy] = useState(false)
  const [assessment, setAssessment] = useState('')
  const labels: Record<string, string> = { manager: t('负责人', 'Manager'), operator: t('经办人', 'Operator'), reviewer: t('评审人', 'Reviewer'), viewer: t('只读成员', 'Viewer'), supplier: t('供应商', 'Supplier') }
  async function change(path: string, body: unknown, method = 'PUT') {
    setBusy(true); setError(''); setSecret('')
    try { const result = await api<{ temporary_password?: string }>(path, { method, body }); setSecret(result.temporary_password ?? ''); await query.refetch(); if (path.includes(user.id)) window.dispatchEvent(new Event('scope-session-expired')) }
    catch (e) { setError(translate(e instanceof ApiError ? e.code : 'NETWORK_ERROR')) } finally { setBusy(false) }
  }
  const current = query.data?.assessments.find(a => a.id === assessment)
  return <><div className="page-heading"><div><h1>{t('人员与权限', 'People & access')}</h1><p>{t('负责人和管理员可直接发起评估；经办人、评审人和只读成员按评估授权。', 'Managers and administrators create assessments directly. Operators, reviewers and viewers receive access to individual assessments.')}</p></div></div>
    {(error || query.error) && <Notice error>{error || t('无法读取人员，请使用负责人或管理员账号。', 'Sign in as a manager or administrator to manage people.')}</Notice>}
    {secret && <Notice><p>{t('临时密码仅本次显示，首次登录须更改：', 'Temporary password, shown once; change it at first sign-in:')}</p><code>{secret}</code><Button onClick={() => setSecret('')}>{t('关闭', 'Dismiss')}</Button></Notice>}
    {user.is_admin && <form className="paper-panel" onSubmit={e => { e.preventDefault(); void change('/admin/users', Object.fromEntries(new FormData(e.currentTarget)), 'POST') }}><h2>{t('创建账号', 'Create account')}</h2><label>{t('姓名', 'Name')}<input name="name" required /></label><label>{t('登录名', 'Username')}<input name="username" pattern="[a-zA-Z0-9_.-]{3,64}" required /></label><label>{t('组织角色', 'Organization role')}<select name="role">{Object.entries(labels).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label><Button type="submit" busy={busy}>{t('创建账号', 'Create account')}</Button></form>}
    <section className="paper-panel"><h2>{t('账号与组织角色', 'Accounts and organization roles')}</h2>{query.data?.users.map(p => <div className="stage-actions" key={p.id}><strong>{p.name} ({p.username ?? p.role})</strong>{user.is_admin && p.role !== 'vendor' ? <select aria-label={`${p.name} ${t('角色', 'role')}`} disabled={busy} value={p.organization_role} onChange={e => void change(`/people/${p.id}/role`, { role: e.target.value })}>{Object.entries(labels).filter(([key]) => key !== 'supplier').map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select> : labels[p.organization_role]}{user.is_admin && <><Button disabled={busy} onClick={() => void change(`/admin/users/${p.id}/reset-password`, {}, 'POST')}>{t('重置密码', 'Reset password')}</Button><Button disabled={busy} onClick={() => void change(`/admin/users/${p.id}`, { active: !p.active })}>{p.active ? t('停用', 'Deactivate') : t('启用', 'Activate')}</Button>{p.role !== 'vendor' && <Button disabled={busy} onClick={() => void change(`/admin/users/${p.id}`, { is_admin: !p.is_admin })}>{p.is_admin ? t('取消管理员', 'Remove admin') : t('设为管理员', 'Make admin')}</Button>}</>}</div>)}</section>
    <section className="paper-panel"><h2>{t('评估成员', 'Assessment members')}</h2><select aria-label={t('选择评估', 'Select assessment')} value={assessment} onChange={e => setAssessment(e.target.value)}><option value="">{t('选择评估', 'Select assessment')}</option>{query.data?.assessments.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select>{current && query.data?.users.filter(p => p.role !== 'vendor' && !p.is_admin && p.organization_role !== 'manager' && p.id !== current.owner_id).map(p => <label key={p.id}>{p.name}<select disabled={busy} value={current.members.find(m => m.user_id === p.id)?.role ?? ''} onChange={e => void change(`/systems/${current.id}/members/${p.id}`, { version: current.version, role: e.target.value })}><option value="">{t('未授权', 'No access')}</option>{['operator', 'reviewer', 'viewer'].map(key => <option value={key} key={key}>{labels[key]}</option>)}</select></label>)}</section></>
}
