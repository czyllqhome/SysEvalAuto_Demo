import { useState } from 'react'
import { domainNames, useLocale } from './i18n'
import type { SourceRisk, SupplierReview, SupplierReviewItem } from './types'
import './supplier-review.css'

type Filter = 'attention' | 'high' | 'medium' | 'yes' | 'all'

export default function SupplierReviewSummary({ review }: { review: SupplierReview }) {
  const { t, locale, pair } = useLocale()
  const [filter, setFilter] = useState<Filter>('attention')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const { counts, items } = review
  const percent = counts.total ? (counts.yes / counts.total * 100).toFixed(1) : '0.0'
  const statusLabels: Record<SupplierReviewItem['status'], string> = {
    yes: t('已确认可完成', 'Confirmed deliverable'), partial: t('部分完成', 'Partially deliverable'),
    no: t('无法完成', 'Cannot deliver'), needs_clarification: t('待澄清', 'Needs clarification'), unanswered: t('未填写', 'Unanswered'),
  }
  const riskLabels: Record<SourceRisk, string> = { high: t('高风险', 'High risk'), medium: t('中风险', 'Medium risk'), low: t('低风险', 'Low risk'), unknown: t('风险未标注', 'Risk unspecified') }
  const domainLabel = (item: SupplierReviewItem) => item.domains.map(d => domainNames[d] ? pair(domainNames[d]) : d).join(' / ') || (item.origin === 'business' ? t('业务功能', 'Business functions') : t('未分类控制', 'Unclassified controls'))
  const matchesTab = (item: SupplierReviewItem) => filter === 'all' || (filter === 'attention' ? item.status !== 'yes' : filter === 'yes' ? item.status === 'yes' : item.source_risk === filter && item.status !== 'yes')
  const query = search.trim().toLocaleLowerCase()
  const rank = { high: 0, medium: 1, unknown: 2, low: 3 }
  const rows = items.filter(item => matchesTab(item) && (status === 'all' || status === item.status) && (!query || [item.requirement_id, item.title, item.description, domainLabel(item), item.answer.limitations, item.answer.alternative, ...item.controls.flatMap(c => [c.source, c.identifier, c.text])].join(' ').toLocaleLowerCase().includes(query))).sort((a, b) => rank[a.source_risk] - rank[b.source_risk])
  const groups = new Map<string, SupplierReviewItem[]>()
  for (const item of rows) {
    const domain = domainLabel(item)
    groups.set(domain, [...(groups.get(domain) ?? []), item])
  }
  const tabs: [Filter, string, number][] = [
    ['attention', t('需关注', 'Needs attention'), counts.attention], ['high', t('高风险未确认', 'High risk unconfirmed'), counts.high_unconfirmed],
    ['medium', t('中风险未确认', 'Medium risk unconfirmed'), counts.medium_unconfirmed], ['yes', t('已确认可完成', 'Confirmed deliverable'), counts.yes], ['all', t('全部', 'All'), counts.total],
  ]
  return <section className="supplier-review-summary">
    <div className="section-heading"><div><span className="eyebrow">SUPPLIER REVIEW</span><h2>{t('供应商复核结果', 'Supplier review results')}</h2><p className="muted">{t('查看开发项确认程度，优先处理尚未确认可完整完成的中高风险项。', 'Review development commitments and prioritize unconfirmed medium- and high-risk items.')}</p></div><span className="commitment-round">{t('本轮已提交', 'Round submitted')}</span></div>
    <div className="commitment-overview">
      <div className="commitment-overview-heading"><h3>{t('开发项确认汇总', 'Development commitment summary')}</h3><span>{new Date(review.submitted_at * 1000).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-GB')}</span></div>
      <p className="commitment-disclaimer">{t('依据供应商本轮已提交答复与原始控制风险等级统计；确认可完成代表交付承诺，尚未经过实施验收。', 'Counts use submitted supplier responses and original control risk ratings. Delivery commitments still require implementation acceptance.')}</p>
      <div className="commitment-metrics">
        <div className="commitment-progress"><span>{t('开发项确认程度', 'Development confirmation')}</span><strong>{percent}%</strong><progress aria-label={t('开发项确认程度', 'Development confirmation')} value={counts.yes} max={counts.total || 1} /><small>{t('已确认可完成', 'Confirmed deliverable')} {counts.yes} / {counts.total}</small></div>
        <div><span>{t('可完成 / 部分 / 无法 / 待澄清', 'Deliverable / Partial / Cannot / Clarify')}</span><strong className="commitment-distribution">{counts.yes} / {counts.partial} / {counts.no} / {counts.needs_clarification}</strong><small>{t('全部开发项', 'All development items')} {counts.total}{counts.unanswered > 0 && ` · ${t('未填写', 'Unanswered')} ${counts.unanswered}`}</small></div>
        <button className="commitment-risk-metric high" onClick={() => { setFilter('high'); setStatus('all'); setSearch('') }}><span>{t('高风险未确认可完成', 'High risk unconfirmed')}</span><strong>{counts.high_unconfirmed}</strong><small>{t('点击查看原文与答复', 'View source and response')}</small></button>
        <button className="commitment-risk-metric medium" onClick={() => { setFilter('medium'); setStatus('all'); setSearch('') }}><span>{t('中风险未确认可完成', 'Medium risk unconfirmed')}</span><strong>{counts.medium_unconfirmed}</strong><small>{t('点击查看原文与答复', 'View source and response')}</small></button>
      </div>
      <div className={`commitment-message ${counts.attention ? 'attention' : 'complete'}`}>
        <strong>{counts.attention ? t('待负责人处理', 'Owner follow-up required') : t('全部开发项已确认可完成', 'All items confirmed deliverable')}</strong>
        <span>{counts.attention ? t(`无法完成 ${counts.no} 项，部分完成 ${counts.partial} 项，待澄清 ${counts.needs_clarification} 项。`, `${counts.no} cannot be delivered, ${counts.partial} are partial, and ${counts.needs_clarification} need clarification.`) : t('后续由负责人审查并收集双方确认。', 'Owner review and joint confirmation follow.')}</span>
      </div>
    </div>
    <div className="commitment-list">
      <div className="commitment-filters" role="group" aria-label={t('复核结果筛选', 'Filter review results')}>{tabs.map(([key, label, count]) => <button key={key} aria-pressed={filter === key} className={filter === key ? 'active' : ''} onClick={() => setFilter(key)}>{label} <span>({count})</span></button>)}</div>
      <div className="commitment-search"><label>{t('搜索开发项', 'Search development items')}<input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder={t('需求、来源编号或供应商说明', 'Requirement, source ID or supplier explanation')} /></label><label>{t('确认状态', 'Confirmation status')}<select value={status} onChange={e => setStatus(e.target.value)}><option value="all">{t('全部状态', 'All statuses')}</option>{Object.entries(statusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></div>
      <p className="commitment-list-hint">{t(`当前显示 ${rows.length} / ${counts.total} 项；中高风险未确认包含部分完成、无法完成和待澄清，按开发项去重统计。`, `Showing ${rows.length} / ${counts.total}. Unconfirmed risk items include partial, unavailable and clarification responses; each development item is counted once.`)}</p>
      {[...groups].map(([domain, group]) => <section className="commitment-domain" key={domain}><h3>{domain} <span>({group.length})</span></h3><div className="commitment-table-scroll"><table aria-label={domain}><thead><tr><th scope="col">{t('开发项 / 要求', 'Development item / Requirement')}</th><th scope="col">{t('供应商答复', 'Supplier response')}</th><th scope="col">{t('确认状态', 'Confirmation status')}</th></tr></thead><tbody>{group.map(item => <tr key={item.requirement_id} className={item.status !== 'yes' ? `commitment-row-${item.source_risk}` : ''}>
        <td><div className="commitment-item-title"><code>{item.requirement_id}</code>{item.origin !== 'business' && <span className={`commitment-badge risk-${item.source_risk}`}>{riskLabels[item.source_risk]}</span>}</div><h4>{item.title}</h4><p className="preserve-lines">{item.description}</p>{!!item.controls.length && <details className="commitment-originals"><summary>{t('控制项原文与来源', 'Original controls and sources')}</summary>{item.controls.map(c => <div key={c.id}><strong>{c.source || t('来源未提供', 'Source not provided')} · {c.identifier || t('标识未提供', 'Identifier not provided')}</strong><p className="preserve-lines">{c.text || t('原文未提供', 'Original text not provided')}</p><small>{t('来源风险：', 'Source risk: ')}{riskLabels[c.risk]}</small></div>)}</details>}</td>
        <td><strong>{statusLabels[item.status]}</strong>{item.answer.limitations && <p className="preserve-lines">{item.answer.limitations}</p>}{item.answer.alternative && <div><small>{t('补偿措施 / 替代方案', 'Compensating measures / Alternative')}</small><p className="preserve-lines">{item.answer.alternative}</p></div>}{item.answer.implementation_plan && <details><summary>{t('实施安排', 'Implementation plan')}</summary><p className="preserve-lines">{item.answer.implementation_plan}</p></details>}{item.answer.duration_workdays != null && <small>{t('预计工作日：', 'Estimated workdays: ')}{item.answer.duration_workdays}</small>}{item.answer.owner_name && <p>{t('交付负责人：', 'Delivery owner: ')}{item.answer.owner_name}</p>}</td>
        <td><span className={`commitment-badge status-${item.status}`}>{statusLabels[item.status]}</span>{item.status !== 'yes' && <p className="commitment-follow-up">{item.status === 'needs_clarification' ? t('需补充澄清后确认', 'Clarification needed before confirmation') : item.status === 'partial' ? t('尚有要求未承诺完成', 'Some requirements remain uncommitted') : item.status === 'no' ? t('需协调方案或调整承诺', 'Resolve the approach or commitment') : t('需补充答复', 'Response required')}</p>}</td>
      </tr>)}</tbody></table></div></section>)}
      {!rows.length && <div className="commitment-empty">{counts.attention === 0 && filter === 'attention' && !query && status === 'all' ? t('本轮没有需要关注的开发项。可切换“全部”查看完整答复。', 'No items need attention this round. Select All to see every response.') : t('没有符合当前筛选条件的开发项。', 'No development items match these filters.')}</div>}
    </div>
  </section>
}
