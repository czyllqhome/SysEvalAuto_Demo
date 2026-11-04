import { useState } from 'react'
import { Button, Notice, useCommand } from './components'
import { useLocale } from './i18n'
import type { SystemDetail } from './types'

export default function SystemNameEditor({ detail }: { detail: SystemDetail }) {
  const { t } = useLocale()
  const [editing, setEditing] = useState(false), [name, setName] = useState(detail.system.name)
  const { run, busy, error } = useCommand(detail)
  if (!detail.permissions?.includes('edit') || !['DRAFT', 'CLASSIFYING', 'CONTEXT_REVIEW'].includes(detail.system.status)) return null
  return <div>{editing ? <><label>{t('系统名称', 'System name')}<input maxLength={200} value={name} onChange={e => setName(e.target.value)} /></label>
    {error && <Notice error>{error}</Notice>}<Button busy={busy} disabled={!name.trim()} onClick={() => void run(`/systems/${detail.system.id}/name`, { name }, 'PUT').then(() => setEditing(false)).catch(() => {})}>{t('保存名称', 'Save name')}</Button>
    <Button variant="secondary" disabled={busy} onClick={() => setEditing(false)}>{t('取消', 'Cancel')}</Button></> : <Button variant="secondary" onClick={() => { setName(detail.system.name); setEditing(true) }}>{t('修改名称', 'Rename')}</Button>}</div>
}
