import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { api, ApiError } from './api'
import { Button, Notice } from './components'
import { useLocale } from './i18n'
import type { SystemDetail } from './types'

export type AssessmentKind = 'new' | 'existing'
export interface AssessmentOptions { projects: { id: string; name: string; purpose: AssessmentKind }[]; assets: { id: string; name: string; project_id: string }[] }

export default function AssessmentCreate({ initialKind = 'new', predecessor, onCreated }: {
  initialKind?: AssessmentKind; predecessor?: SystemDetail; onCreated?: () => void;
}) {
  const { t, error: translate } = useLocale()
  const client = useQueryClient(), navigate = useNavigate()
  const query = useQuery({ queryKey: ['assessment-options'], queryFn: () => api<AssessmentOptions>('/assessment-options') })
  const [kind, setKind] = useState<AssessmentKind>(initialKind)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [key, setKey] = useState(() => crypto.randomUUID())
  return <form onChange={() => setKey(crypto.randomUUID())} onSubmit={async event => {
    event.preventDefault(); setBusy(true); setError('')
    const values = Object.fromEntries(new FormData(event.currentTarget))
    try {
      const result = await api<SystemDetail>('/systems', { method: 'POST', key, body: {
        ...values, assessment_type: kind,
        predecessor_id: predecessor?.system.id,
      } })
      client.setQueryData(['system', result.system.id], result)
      await client.invalidateQueries({ queryKey: ['systems'] }); await client.invalidateQueries({ queryKey: ['assessment-options'] })
      onCreated?.(); navigate(`/systems/${result.system.id}/classification`)
    } catch (e) { setError(translate(e instanceof ApiError ? e.code : 'NETWORK_ERROR')) } finally { setBusy(false) }
  }}>
    {(error || query.error) && <Notice error>{error || t('创建选项加载失败', 'Could not load creation options')}</Notice>}
    <label>{t('系统类型', 'System type')}<select value={kind} onChange={e => setKind(e.target.value as AssessmentKind)}><option value="new">{t('待开发系统', 'System to be developed')}</option><option value="existing">{t('现有系统', 'Existing system')}</option></select></label>
    <label>{t('待评估系统名称', 'System name to assess')}<input required name="name" maxLength={200} defaultValue={predecessor?.system.name ?? ''} /></label>
    {kind === 'existing' && <>
      <label>{t('评估范围', 'Assessment scope')}<textarea name="scope" required maxLength={8000} /></label>
      <label>{t('评估基准日期', 'Assessment reference date')}<input name="as_of" type="date" required /></label>
      <label>{t('部署环境', 'Environment')}<input name="environment" required maxLength={200} /></label>
      <label>{t('系统版本', 'System version')}<input name="system_version" required maxLength={200} /></label>
      <label>{t('评估原因', 'Assessment trigger')}<select name="trigger"><option value="initial">{t('首次评估', 'Initial assessment')}</option><option value="periodic">{t('周期复评', 'Periodic review')}</option><option value="change">{t('重大变更', 'Major change')}</option><option value="remediation">{t('整改复评', 'Remediation review')}</option></select></label>
    </>}
    <Button type="submit" busy={busy} disabled={query.isPending}>{t('创建评估', 'Create assessment')}</Button>
  </form>
}
