import { useCallback, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Check, CheckCircle2, ChevronRight, Download, FileCheck2, LockKeyhole, RefreshCw, Search } from 'lucide-react'
import { api, ApiError } from './api'
import { Button, Notice } from './components'
import { useLocale } from './i18n'
import DeliveryItemPanel from './DeliveryItemPanel'
import { DeliveryBadge, DeliveryProgress, DeliverySteps } from './DeliveryShared'
import { deliveryMatches, deliveryStatuses, isOverdue, type DeliveryBatch } from './deliveryModel'

export default function DeliveryBoard({ batch, embedded, refreshing, refresh }: { batch: DeliveryBatch; embedded: boolean; refreshing: boolean; refresh: () => void }) {
  const { t, error: translate } = useLocale(), cache = useQueryClient()
  const [filter, setFilter] = useState(''), [search, setSearch] = useState(''), [failure, setFailure] = useState(''), [busy, setBusy] = useState(false)
  const [dirtyItems, setDirtyItems] = useState<Record<string, boolean>>({})
  const dirtyChanged = useCallback((id: string, dirty: boolean) => setDirtyItems(old => old[id] === dirty ? old : { ...old, [id]: dirty }), [])
  const acceptResult = useCallback(async (result: DeliveryBatch) => {
    await cache.cancelQueries({ queryKey: ['delivery', result.id], exact: true })
    cache.setQueryData(['delivery', result.id], result)
    void cache.invalidateQueries({ queryKey: ['delivery-inbox'] })
    void cache.invalidateQueries({ queryKey: ['system-deliveries', result.system_id] })
    void cache.invalidateQueries({ queryKey: ['system', result.system_id] })
  }, [cache])
  const supplier = batch.allowed_actions.includes('upload'), reviewer = batch.allowed_actions.includes('review')
  const today = new Date().toLocaleDateString('en-CA')
  const count = (status: string) => batch.items.filter(i => i.status === status).length
  const overdue = batch.items.filter(i => isOverdue(i, batch, today)).length
  const preferred = supplier ? ['CHANGES_REQUESTED', 'OPEN', 'IN_REVIEW', 'APPROVED'] : ['IN_REVIEW', 'CHANGES_REQUESTED', 'OPEN', 'APPROVED']
  const items = [...batch.items].sort((a, b) => preferred.indexOf(a.status) - preferred.indexOf(b.status) || a.source_id.localeCompare(b.source_id, undefined, { numeric: true }))
  const visible = items.filter(i => deliveryMatches(i, batch, filter, search, today))
  const visibleIds = new Set(visible.map(i => i.id))
  const hiddenDirty = items.filter(i => dirtyItems[i.id] && !visibleIds.has(i.id)).length
  const complete = batch.total > 0 && batch.approved === batch.total
  const next = batch.status === 'SUPERSEDED' ? t('来源已更新，本批记录仅供查阅。请回到评估查看当前交付。', 'The source changed. This batch is read only; open the assessment for current delivery.')
    : batch.status === 'REVIEW_COMPLETE' ? batch.kind === 'plan' ? t('交付审核已完成，等待客户执行计划级复测。', 'Delivery review is complete. Customer plan-level retesting is next.') : t('本批开发项已全部验收，交付审核已完成。', 'All items are accepted and this delivery review is complete.')
      : complete ? t('全部开发项已验收，客户负责人可完成本批交付审核。', 'All items are accepted. The customer can complete the delivery review.')
        : supplier ? t('优先处理退回项，补齐材料后提交验收；已提交的轮次保持只读。', 'Address returned items first, then submit evidence. Submitted rounds remain read only.')
          : reviewer ? t('优先核验待验收项：逐条核对条件并记录依据，通过或退回供应商补充。', 'Review pending items first: check each criterion and record a rationale, then accept or return.')
            : t('你可以查看开发进度、交付证据和审核记录。', 'You can view progress, evidence and review history.')
  return <section className={`delivery-page${embedded ? ' delivery-embedded' : ''}`}>
    {!embedded && <div className="delivery-breadcrumb"><Link to="/deliveries"><ArrowLeft size={14} />{t('开发进度追踪', 'Development tracking')}</Link><ChevronRight size={14} /><span>{batch.name}</span></div>}
    <header className="delivery-heading"><div>{!embedded && <span className="eyebrow">DEVELOPMENT & DELIVERY</span>}{embedded ? <h2>{t('开发进度追踪', 'Development tracking')}</h2> : <h1>{batch.name}</h1>}<p>{t('以已确认范围为依据，逐项提交证据、核验与完成交付。', 'Submit and verify evidence for each item in the agreed delivery scope.')}</p></div><div className="delivery-heading-actions"><DeliveryBadge status={batch.status} /><Button variant="secondary" disabled={refreshing} onClick={refresh}><RefreshCw size={14} className={refreshing ? 'spin' : ''} />{t('刷新进度', 'Refresh progress')}</Button>{!embedded && <Link className="button secondary" to={`/systems/${batch.system_id}/${batch.kind === 'plan' ? 'existing' : 'agreement'}`}>{t('查看评估', 'View assessment')}<ArrowRight size={15} /></Link>}</div></header>
    <DeliverySteps batch={batch} />
    <section className="delivery-overview" aria-label={t('交付总览', 'Delivery overview')}>
      <div className="delivery-overview-heading"><div><h3>{t('开发交付总览', 'Delivery overview')}</h3><p>{t('验收进度按全量开发项计算，筛选不影响统计。', 'Acceptance progress always uses the full delivery scope.')}</p></div><span className="delivery-role">{supplier ? t('供应商视图', 'Supplier view') : reviewer ? t('客户审核视图', 'Customer review') : t('只读视图', 'Read-only view')}</span></div>
      <div className="delivery-metrics"><div className="delivery-total"><span>{t('开发项总数', 'Total items')}</span><strong>{batch.total}</strong><DeliveryProgress batch={batch} /></div>{[['OPEN', t('待提交', 'Awaiting submission'), count('OPEN')], ['IN_REVIEW', t('待验收', 'Awaiting review'), count('IN_REVIEW')], ['CHANGES_REQUESTED', t('退回补充', 'Changes requested'), count('CHANGES_REQUESTED')], ['APPROVED', t('已验收', 'Accepted'), batch.approved]].map(([key, label, total]) => <button key={key} className={`delivery-metric metric-${String(key).toLowerCase()}${filter === key ? ' selected' : ''}`} aria-pressed={filter === key} onClick={() => setFilter(filter === key ? '' : String(key))}><span>{label}</span><strong>{total}</strong><span className="delivery-metric-hint">{t('查看开发项', 'View items')}<ChevronRight size={13} /></span></button>)}</div>
      <div className={`delivery-next${batch.status === 'REVIEW_COMPLETE' ? ' finished' : ''}`}><CheckCircle2 size={18} /><span><b>{t('当前待办', 'Next action')}</b>{next}</span>{overdue > 0 && <button onClick={() => setFilter('OVERDUE')}>{t('超出承诺日期', 'Past committed date')} {overdue}<ChevronRight size={13} /></button>}</div>
    </section>
    <details className="delivery-source"><summary><LockKeyhole size={14} />{batch.kind === 'plan' ? t('已确认整改计划', 'Confirmed remediation plan') : t('双方确认的开发基线', 'Jointly confirmed baseline')}<span>{t('查看来源与内容指纹', 'View source and content hash')}</span></summary><code>{batch.source_hash}</code>{batch.kind === 'baseline' && batch.source_id && batch.status !== 'SUPERSEDED' && <a className="button secondary" href={`/api/v1/baselines/${batch.source_id}/document?format=docx`}><Download size={15} />{t('下载双方确认最终稿', 'Download agreed final document')}</a>}</details>
    {batch.kind === 'plan' && <Notice>{t('交付审核完成后，仍需客户复测通过才能关闭原差距。', 'After delivery review, customer retesting must pass before the original gaps close.')}</Notice>}
    {batch.total === 0 && <Notice>{t('无来源项，需负责人核对，不自动视为通过。', 'No source items. Owner review is required; this is not an automatic pass.')}</Notice>}
    {failure && <Notice error>{failure}</Notice>}
    <div className="delivery-toolbar"><div className="delivery-filter-tabs" role="group" aria-label={t('开发项状态筛选', 'Item status filters')}>{['', 'OPEN', 'IN_REVIEW', 'CHANGES_REQUESTED', 'APPROVED'].map(s => <button key={s} aria-pressed={filter === s} className={filter === s ? 'active' : ''} onClick={() => setFilter(s)}>{s ? t(...deliveryStatuses[s]) : t('全部开发项', 'All items')}<span>{s ? count(s) : batch.total}</span></button>)}</div><label className="delivery-search"><Search size={16} /><input aria-label={t('搜索开发项', 'Search development items')} placeholder={t('搜索编号、要求或负责人…', 'Search ID, requirement or owner…')} value={search} onChange={e => setSearch(e.target.value)} /></label></div>
    <div className="delivery-list-caption"><span>{t('显示', 'Showing')} {visible.length} / {batch.total} {t('项', 'items')}{filter === 'OVERDUE' && ` · ${t('超出承诺日期', 'Past committed date')}`}</span>{(filter || search) && <button onClick={() => { setFilter(''); setSearch('') }}>{t('清除筛选', 'Clear filters')}</button>}<span>{t('展开任务查看证据与处理记录', 'Expand an item to review evidence and history')}</span></div>
    {hiddenDirty > 0 && <Notice>{t('筛选隐藏了尚未保存的输入，切回后可继续编辑。', 'Some unsaved input is hidden by filters. Clear filters to continue editing.')} ({hiddenDirty})</Notice>}
    <div className="delivery-items">{items.map(item => <DeliveryItemPanel key={item.id} item={item} batch={batch} hidden={!visibleIds.has(item.id)} initiallyOpen={item.id === items[0]?.id} acceptResult={acceptResult} dirtyChanged={dirtyChanged} />)}</div>
    {!visible.length && batch.total > 0 && <div className="delivery-empty"><Search size={26} /><h3>{t('没有符合条件的开发项', 'No matching items')}</h3><p>{t('调整筛选或搜索关键词，已填写内容会保留。', 'Change the filters or search; your input is retained.')}</p><Button variant="secondary" onClick={() => { setFilter(''); setSearch('') }}>{t('清除筛选', 'Clear filters')}</Button></div>}
    <footer className="delivery-completion"><FileCheck2 size={24} /><div><strong>{batch.status === 'REVIEW_COMPLETE' ? t('本批交付审核已完成', 'Delivery review completed') : t('完成本批交付审核', 'Complete delivery review')}</strong><p>{batch.status === 'REVIEW_COMPLETE' ? next : complete ? t('所有开发项已由客户逐项验收，可以完成本批审核。', 'Every item has been accepted by the customer. This review can now be completed.') : t(`仍有 ${batch.total - batch.approved} 项未验收，需逐项处理后完成。`, `${batch.total - batch.approved} items still need acceptance before completion.`)}</p></div>{batch.allowed_actions.includes('complete') && batch.status === 'ACTIVE' && <Button className="delivery-success-button" busy={busy} disabled={!complete} onClick={async () => {
      setBusy(true); setFailure('')
      try { await cache.cancelQueries({ queryKey: ['delivery', batch.id], exact: true }); const result = await api<DeliveryBatch>(`/delivery-batches/${batch.id}/complete`, { method: 'POST', key: crypto.randomUUID(), body: { version: batch.version } }); await acceptResult(result) }
      catch (e) { setFailure(translate(e instanceof ApiError ? e.code : 'NETWORK_ERROR')) } finally { setBusy(false) }
    }}><Check size={16} />{t('完成本批交付审核', 'Complete delivery review')}</Button>}</footer>
  </section>
}
