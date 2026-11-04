import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from './api'
import { Button, Modal, Notice, useAuth } from './components'
import { useLocale } from './i18n'
import type { Team } from './ProjectRoles'

type Audit = { id: string; action: string; actor_id: string; created_at: number; detail?: unknown }
type Imported = { id: string; source_table: string; data: unknown }
const pageSize = 30

export default function AuditPage() {
  const { user } = useAuth()
  const { t, locale } = useLocale()
  const [q, setQ] = useState('')
  const [actor, setActor] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [page, setPage] = useState(0)
  const [history, setHistory] = useState(false)
  const [selected, setSelected] = useState<Audit | Imported | null>(null)
  const params = new URLSearchParams({ q, actor_id: actor, offset: String(page * pageSize), limit: String(pageSize + 1), summary: 'true' })
  if (start) params.set('start', String(new Date(`${start}T00:00:00`).getTime() / 1000))
  if (end) { const nextDay = new Date(`${end}T00:00:00`); nextDay.setDate(nextDay.getDate() + 1); params.set('end', String(nextDay.getTime() / 1000)) }
  const invalidRange = !!start && !!end && start > end
  const team = useQuery({ queryKey: ['team'], queryFn: () => api<Team>('/team'), enabled: !!user.is_admin })
  const audits = useQuery({ queryKey: ['admin-audits', params.toString()], queryFn: () => api<Audit[]>(`/admin/audits?${params}`), enabled: !!user.is_admin && !history && !invalidRange })
  const imported = useQuery({ queryKey: ['import-history'], queryFn: () => api<Imported[]>('/admin/import-history'), enabled: !!user.is_admin && history })
  const detail = useQuery({ queryKey: ['admin-audit', selected?.id], queryFn: () => api<Audit>(`/admin/audits/${selected!.id}`), enabled: !!user.is_admin && !!selected && !('data' in selected) })
  const importedRows = (imported.data ?? []).filter(item => JSON.stringify(item.data).toLowerCase().includes(q.toLowerCase()))
  const rows = history ? importedRows.slice(page * pageSize, (page + 1) * pageSize) : (audits.data ?? []).slice(0, pageSize)
  const more = history ? importedRows.length > (page + 1) * pageSize : (audits.data?.length ?? 0) > pageSize
  const time = (value: number) => new Date(value * 1000).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-GB')
  const actorName = (id: string) => team.data?.users.find(person => person.id === id)?.name ?? id
  if (!user.is_admin) return <Notice error>{t('仅系统管理员可以查看日志。', 'Only administrators can view logs.')}</Notice>
  return <>
    <div className="page-heading"><div><span className="eyebrow">{t('操作记录', 'ACTIVITY RECORDS')}</span><h1>{t('审计日志', 'Audit logs')}</h1><p>{t('筛选管理操作，点击记录查看详细信息。', 'Filter administration activity and open a record for details.')}</p></div></div>
    <section className="paper-panel">
      <div className="audit-filters">
        <label>{t('记录来源', 'Source')}<select value={history ? 'imported' : 'current'} onChange={event => { setHistory(event.target.value === 'imported'); setPage(0); setQ('') }}><option value="current">{t('管理审计', 'Administration audit')}</option><option value="imported">{t('迁入历史', 'Imported history')}</option></select></label>
        <label>{history ? t('搜索历史记录', 'Search imported records') : t('筛选审计操作', 'Filter audit actions')}<input value={q} onChange={event => { setQ(event.target.value); setPage(0) }} placeholder={history ? t('关键词', 'Keyword') : t('按操作名称筛选', 'Filter by action')} /></label>
        {!history && <><label>{t('操作人', 'Actor')}<select value={actor} onChange={event => { setActor(event.target.value); setPage(0) }}><option value="">{t('全部人员', 'All actors')}</option>{team.data?.users.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
          <label>{t('开始日期', 'Start date')}<input type="date" value={start} onChange={event => { setStart(event.target.value); setPage(0) }} /></label><label>{t('结束日期', 'End date')}<input type="date" value={end} onChange={event => { setEnd(event.target.value); setPage(0) }} /></label></>}
        <Button variant="secondary" onClick={() => { setQ(''); setActor(''); setStart(''); setEnd(''); setPage(0) }}>{t('清除筛选', 'Clear filters')}</Button>
      </div>
      {invalidRange && !history && <Notice error>{t('结束日期不能早于开始日期。', 'End date must be on or after start date.')}</Notice>}
      {(history ? imported.error : audits.error) && <Notice error>{t('读取日志失败，请重试。', 'Could not load logs. Please retry.')}<Button variant="secondary" onClick={() => void (history ? imported.refetch() : audits.refetch())}>{t('重试', 'Retry')}</Button></Notice>}
      {(history ? imported.isFetching : audits.isFetching) && <p role="status">{t('正在加载…', 'Loading…')}</p>}
      {!invalidRange || history ? <div className="table-scroll"><table><thead><tr><th>{t('时间 / 来源', 'Time / source')}</th><th>{t('操作', 'Action')}</th><th>{t('操作人', 'Actor')}</th><th>{t('详情', 'Details')}</th></tr></thead><tbody>{rows.map(item => <tr key={item.id}><td>{'data' in item ? t('迁入历史', 'Imported history') : time(item.created_at)}</td><td>{'data' in item ? item.source_table : item.action}</td><td>{'data' in item ? '—' : actorName(item.actor_id)}</td><td><Button variant="secondary" onClick={() => setSelected(item)}>{t('查看详情', 'View details')}</Button></td></tr>)}</tbody></table></div> : null}
      {!rows.length && !(history ? imported.isFetching : audits.isFetching) && <p>{t('没有匹配的日志。', 'No matching logs.')}</p>}
      <div className="audit-pagination"><Button variant="secondary" disabled={!page} onClick={() => setPage(value => value - 1)}>{t('上一页', 'Previous')}</Button><span>{t(`第 ${page + 1} 页`, `Page ${page + 1}`)}</span><Button variant="secondary" disabled={!more} onClick={() => setPage(value => value + 1)}>{t('下一页', 'Next')}</Button></div>
      {history && <p className="field-hint">{t('迁入历史最多显示 1000 条，支持关键词筛选。', 'Imported history shows up to 1,000 records with keyword filtering.')}</p>}
    </section>
    {selected && <Modal title={t('日志详情', 'Log details')} close={() => setSelected(null)} wide>
      {!('data' in selected) && <dl className="audit-metadata"><dt>{t('时间', 'Time')}</dt><dd>{time(selected.created_at)}</dd><dt>{t('操作', 'Action')}</dt><dd>{selected.action}</dd><dt>{t('操作人', 'Actor')}</dt><dd>{actorName(selected.actor_id)}</dd></dl>}
      {detail.isFetching && !('data' in selected) && <p>{t('正在加载…', 'Loading…')}</p>}
      {detail.error && !('data' in selected) && <Notice error>{t('读取详情失败。', 'Could not load details.')}<Button onClick={() => void detail.refetch()}>{t('重试', 'Retry')}</Button></Notice>}
      {('data' in selected || detail.data) && <pre className="audit-detail">{JSON.stringify('data' in selected ? selected.data : detail.data?.detail, null, 2)}</pre>}
    </Modal>}
  </>
}
