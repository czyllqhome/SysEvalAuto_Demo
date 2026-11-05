import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowRight, ChevronRight, ClipboardCheck, FolderOpen, LockKeyhole, Search } from 'lucide-react'
import { api, ApiError } from './api'
import { Button, Notice } from './components'
import { useLocale } from './i18n'
import DeliveryBoard from './DeliveryBoard'
import { DeliveryBadge, DeliveryProgress, DeliverySteps } from './DeliveryShared'
import { deliveryStatuses, type DeliveryBatch } from './deliveryModel'

export function DeliveryInbox() {
  const { t } = useLocale()
  const [search, setSearch] = useState(''), [filter, setFilter] = useState('ACTIVE')
  const query = useQuery({ queryKey: ['delivery-inbox'], queryFn: ({ signal }) => api<DeliveryBatch[]>('/delivery-batches', { signal }) })
  const batches = query.data ?? []
  const visible = batches.filter(b => (!filter || b.status === filter) && b.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
  return <section className="delivery-page">
    <header className="delivery-heading"><div><span className="eyebrow">DEVELOPMENT & DELIVERY</span><h1>{t('开发进度追踪', 'Development tracking')}</h1><p>{t('跟进开发交付、补充证据与逐项验收。', 'Track development, evidence and acceptance in one place.')}</p></div><Link className="button secondary" to="/assessments"><FolderOpen size={16} />{t('评估台账', 'Assessments')}</Link></header>
    {query.error && <Notice error>{t('无法读取交付任务。', 'Could not load delivery tasks.')} <Button variant="text" onClick={() => void query.refetch()}>{t('重试', 'Retry')}</Button></Notice>}
    <div className="delivery-inbox-summary">{[['ACTIVE', t('进行中的交付', 'Active deliveries')], ['REVIEW_COMPLETE', t('审核已完成', 'Reviews completed')], ['SUPERSEDED', t('历史来源', 'Historical sources')]].map(([key, label]) => <button key={key} className={filter === key ? 'selected' : ''} aria-pressed={filter === key} onClick={() => setFilter(key)}><span>{label}</span><strong>{query.data ? batches.filter(b => b.status === key).length : '—'}</strong><ChevronRight size={18} /></button>)}</div>
    <div className="delivery-toolbar"><label className="delivery-search"><Search size={17} /><input aria-label={t('搜索交付任务', 'Search delivery tasks')} placeholder={t('搜索系统名称…', 'Search system name…')} value={search} onChange={e => setSearch(e.target.value)} /></label><label className="delivery-filter-label">{t('交付状态', 'Delivery status')}<select value={filter} onChange={e => setFilter(e.target.value)}><option value="">{t('全部状态', 'All statuses')}</option>{['ACTIVE', 'REVIEW_COMPLETE', 'SUPERSEDED'].map(s => <option key={s} value={s}>{t(...deliveryStatuses[s])}</option>)}</select></label></div>
    {query.isPending && <p role="status">{t('正在加载交付任务…', 'Loading delivery tasks…')}</p>}
    <div className="delivery-batch-list">{visible.map(b => <Link key={b.id} className="delivery-batch-card" to={`/delivery/${b.id}`}><span className="delivery-batch-icon"><ClipboardCheck size={23} /></span><div><div className="delivery-card-tags"><span>{b.kind === 'plan' ? t('整改交付', 'Remediation delivery') : t('开发交付', 'Development delivery')}</span><DeliveryBadge status={b.status} /></div><h2>{b.name}</h2><p>{b.kind === 'plan' ? t('证据验收后转入客户复测', 'Customer retesting follows evidence review') : t('基于双方确认的开发范围', 'Based on the jointly agreed scope')}</p></div><DeliveryProgress batch={b} /><ArrowRight size={19} /></Link>)}</div>
    {query.data && !visible.length && <div className="delivery-empty"><FolderOpen size={30} /><h3>{batches.length ? t('没有符合条件的交付任务', 'No matching deliveries') : t('尚未开启开发交付', 'No delivery tracking yet')}</h3><p>{batches.length ? t('调整搜索或筛选条件后重试。', 'Try a different search or status.') : t('双方确认基线后，由客户负责人在评估的开发进度追踪页开启。', 'After both parties confirm the baseline, the customer starts tracking from the assessment.')}</p>{batches.length > 0 && <Button variant="secondary" onClick={() => { setFilter(''); setSearch('') }}>{t('查看全部任务', 'View all deliveries')}</Button>}</div>}
  </section>
}

export function DeliveryStart({ systemId, version, planId, canManage = false }: { systemId: string; version: number; planId?: string; canManage?: boolean }) {
  const { t, error: translate } = useLocale(), cache = useQueryClient(), navigate = useNavigate()
  const [failure, setFailure] = useState(''), [busy, setBusy] = useState(false), [selected, setSelected] = useState('')
  const batches = useQuery({ queryKey: ['system-deliveries', systemId], queryFn: ({ signal }) => api<DeliveryBatch[]>(`/systems/${systemId}/delivery-batches`, { signal }) })
  const matching = batches.data?.filter(b => planId ? b.kind === 'plan' && b.source_id === planId : b.kind === 'baseline') ?? []
  const current = matching.filter(b => b.status !== 'SUPERSEDED')
  const batch = current.find(b => b.id === selected) ?? current.at(-1)
  if (batches.isPending) return <p role="status">{t('正在读取开发进度…', 'Loading development progress…')}</p>
  if (batches.error) return <Notice error>{t('无法读取本系统交付任务。', 'Could not load system delivery tasks.')} <Button variant="text" onClick={() => void batches.refetch()}>{t('重试', 'Retry')}</Button></Notice>
  return <div className="delivery-page">
    {batch ? <>{current.length > 1 && <label>{t('选择交付批次', 'Select delivery batch')}<select value={batch.id} onChange={e => setSelected(e.target.value)}>{current.map(b => <option key={b.id} value={b.id}>{b.name} · {b.approved}/{b.total} · {b.id.slice(0, 8)}</option>)}</select></label>}<DeliveryWorkspace key={batch.id} batchId={batch.id} embedded /></> : <section className="delivery-start"><span className="delivery-start-icon"><ClipboardCheck size={28} /></span><h2>{t('开启开发进度追踪', 'Start development tracking')}</h2><p>{t('将已确认的开发承诺转为逐项交付清单，持续跟进证据提交、退回补充和人工验收。', 'Turn agreed commitments into delivery items, with evidence submission, changes and human acceptance.')}</p><DeliverySteps />
      <div className="delivery-start-roles"><div><strong>{t('供应商', 'Supplier')}</strong><p>{t('完成开发 → 上传材料 → 对应验收条件 → 提交验收', 'Implement → upload evidence → map criteria → submit for review')}</p></div><div><strong>{t('客户负责人', 'Customer reviewer')}</strong><p>{t('核对证据 → 通过或退回 → 全部通过后完成交付审核', 'Verify evidence → accept or return → complete the delivery review')}</p></div></div>
      {failure && <Notice error>{failure}</Notice>}{canManage ? <Button busy={busy} onClick={async () => {
        setBusy(true); setFailure('')
        try { const result = await api<DeliveryBatch>(`/systems/${systemId}/delivery-batches`, { method: 'POST', key: crypto.randomUUID(), body: { version, source_kind: planId ? 'plan' : 'baseline', source_id: planId } }); cache.setQueryData(['delivery', result.id], result); await cache.invalidateQueries({ queryKey: ['system-deliveries', systemId] }); void cache.invalidateQueries({ queryKey: ['system', systemId] }); void cache.invalidateQueries({ queryKey: ['delivery-inbox'] }); if (planId) navigate(`/delivery/${result.id}`) }
        catch (e) { setFailure(translate(e instanceof ApiError ? e.code : 'NETWORK_ERROR')) } finally { setBusy(false) }
      }}>{t('开启交付证据跟踪', 'Start delivery evidence tracking')}<ArrowRight size={16} /></Button> : <p className="delivery-wait"><LockKeyhole size={16} />{t('等待客户负责人开启交付任务。', 'Waiting for the customer to start delivery tracking.')}</p>}
    </section>}
    {matching.some(b => b.status === 'SUPERSEDED') && <details className="delivery-history"><summary>{t('查看历史交付批次', 'View historical deliveries')}</summary>{matching.filter(b => b.status === 'SUPERSEDED').map(b => <p key={b.id}><Link to={`/delivery/${b.id}`}>{b.name} · {b.id.slice(0, 8)}</Link> · {t('来源已更新 · 只读', 'Source superseded · Read only')}</p>)}</details>}
  </div>
}

export default function DeliveryWorkspace({ batchId, embedded = false }: { batchId?: string; embedded?: boolean }) {
  const params = useParams(), id = batchId ?? params.id ?? '', { t } = useLocale()
  const query = useQuery({ queryKey: ['delivery', id], queryFn: ({ signal }) => api<DeliveryBatch>(`/delivery-batches/${id}`, { signal }), refetchInterval: q => q.state.error ? false : q.state.data?.items.some(i => i.submissions.some(s => ['queued', 'running'].includes(s.ai?.state ?? ''))) ? 2000 : q.state.data?.status === 'ACTIVE' ? 15000 : false })
  if (query.error && !query.data) return <Notice error>{t('无法访问交付任务。', 'Delivery task unavailable.')} <Button variant="text" onClick={() => void query.refetch()}>{t('重试', 'Retry')}</Button></Notice>
  if (!query.data) return <p role="status">{t('正在加载开发任务…', 'Loading development items…')}</p>
  return <>{query.error && <Notice error>{t('进度刷新失败，当前显示上次读取的记录。', 'Refresh failed. Showing the last loaded records.')} <Button variant="text" onClick={() => void query.refetch()}>{t('重试', 'Retry')}</Button></Notice>}<DeliveryBoard key={id} batch={query.data} embedded={embedded} refreshing={query.isFetching} refresh={() => void query.refetch()} /></>
}
