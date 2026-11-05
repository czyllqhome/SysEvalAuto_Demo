import { useState, type ReactNode } from 'react'
import { useLocale } from './i18n'
import SupplierRequirement from './SupplierRequirement'
import { answerComplete, answerNeedsAttention, blankAnswer } from './supplierAnswers'
import type { Answer, Requirement } from './types'

export default function SupplierResponseList({ requirements, domains, highRiskIds = [], heading, answers, editable, update, feedback = {} }: {
  requirements: Requirement[]; domains: Record<string, string[]>; answers: Record<string, Answer>; editable: boolean;
  highRiskIds?: string[]; heading?: ReactNode;
  feedback?: Record<string, { finding_id: string; reason: string }[]>;
  update: (id: string, values: Partial<Answer>) => void;
}) {
  const { t } = useLocale()
  const [search, setSearch] = useState(''), [domain, setDomain] = useState(''), [status, setStatus] = useState('all')
  const [highOnly, setHighOnly] = useState(false)
  const highRisk = new Set(highRiskIds)
  const highCount = (rows: Requirement[]) => rows.filter(r => highRisk.has(r.id)).length
  const completeCount = (rows: Requirement[]) => rows.filter(r => answerComplete(answers[r.id])).length
  const attentionBadge = (rows: Requirement[]) => {
    const count = rows.filter(r => answerNeedsAttention(answers[r.id], highRisk.has(r.id))).length
    const label = t(`需关注 ${count} 项`, `${count} need attention`)
    return count > 0 ? <span className="supplier-attention-count" role="img" aria-label={label} title={label}>{count}</span> : null
  }
  const groups = new Map<string, Requirement[]>()
  for (const requirement of requirements) {
    const name = domains[requirement.id]?.join(' / ') || (requirement.origin === 'business' ? t('业务功能', 'Business functions') : t('未分类控制', 'Unclassified controls'))
    groups.set(name, [...(groups.get(name) ?? []), requirement])
  }
  const query = search.trim().toLocaleLowerCase()
  const matches = (r: Requirement, name: string) => {
    const answer = answers[r.id]
    return (!domain || domain === name) && (!highOnly || highRisk.has(r.id)) && (!query || `${r.id} ${r.title} ${r.description} ${name}`.toLocaleLowerCase().includes(query)) && (
      status === 'all' || status === 'attention' && answerNeedsAttention(answer, highRisk.has(r.id)) || status === 'unanswered' && !answer || status === 'incomplete' && !answerComplete(answer)
      || status === 'yes' && answer?.implementation_status === 'yes' || status === 'no' && answer?.implementation_status === 'no' || status === 'exceptions' && answer && answer.implementation_status !== 'yes')
  }
  const shown = [...groups].flatMap(([name, rows]) => rows.filter(r => matches(r, name))).length
  return <div className="supplier-response-layout">
    <nav className="domain-rail supplier-domain-rail" aria-label={t('控制域筛选', 'Filter by control domain')}>
      <span className="eyebrow">{t('控制域', 'CONTROL DOMAINS')}</span>
      <button type="button" className={!domain ? 'active' : ''} aria-pressed={!domain} onClick={() => setDomain('')}><strong>{t('全部控制域', 'All domains')}{attentionBadge(requirements)}</strong><span>{completeCount(requirements)} / {requirements.length}</span></button>
      {[...groups].map(([name, rows]) => <button type="button" key={name} className={domain === name ? 'active' : ''} aria-pressed={domain === name} onClick={() => setDomain(name)}><strong>{name}{attentionBadge(rows)}</strong><span>{completeCount(rows)} / {rows.length}</span>{highCount(rows) > 0 && <small>{t('高风险', 'High risk')} {highCount(rows)}</small>}</button>)}
      <p className="field-hint">{t('已完成 / 总数；红圈为需关注项：无法完成，或高风险且尚未承诺可完成（含部分完成、需要澄清、未填写）。', 'Complete / total; red circles count Cannot deliver, plus high-risk items without a Can deliver commitment (partial, clarification or unanswered).')}</p>
    </nav>
    <article className="prd-paper supplier-prd">
    {heading}
    <div className="supplier-response-workspace">
    <div className="supplier-response-filters">
      <label>{t('搜索需求', 'Search requirements')}<input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder={t('标题、正文或需求编号', 'Title, text or requirement ID')} /></label>
      <label>{t('答复状态', 'Response status')}<select value={status} onChange={e => setStatus(e.target.value)}><option value="all">{t('全部状态', 'All statuses')}</option><option value="unanswered">{t('未填写', 'Unanswered')}</option><option value="incomplete">{t('未完成答复', 'Incomplete responses')}</option><option value="yes">{t('可完成', 'Can deliver')}</option><option value="attention">{t('需关注项（红圈）', 'Needs attention (red circle)')}</option><option value="no">{t('无法完成', 'Cannot deliver')}</option><option value="exceptions">{t('例外／待澄清', 'Exceptions / clarification')}</option></select></label>
    </div>
    <div className="supplier-risk-filter"><label><input type="checkbox" checked={highOnly} onChange={e => setHighOnly(e.target.checked)} />{t('只看高风险', 'High risk only')} · {highCount(requirements)}</label><span>{t('依据本轮发布的控制来源风险等级', 'Based on source risk in this published round')}</span></div>
    <p className="supplier-filter-count" role="status">{t('当前显示', 'Showing')} {shown} / {requirements.length} · {t('未填写', 'Unanswered')} {requirements.filter(r => !answers[r.id]).length} / {requirements.length}</p>
    {[...groups].map(([name, rows]) => {
      const visible = rows.filter(r => matches(r, name))
      if (!visible.length) return null
      return <details className="supplier-domain-group" key={name} open>
        <summary><strong>{name}</strong><span>{t('已完成', 'Complete')} {rows.filter(r => answerComplete(answers[r.id])).length} / {rows.length}</span><span>{t('未填写', 'Unanswered')} {rows.filter(r => !answers[r.id]).length} / {rows.length}</span></summary>
        <div className="supplier-responses">{visible.map(requirement => <SupplierRequirement key={requirement.id} requirement={requirement} feedback={feedback[requirement.id]} highRisk={highRisk.has(requirement.id)} answer={answers[requirement.id] ?? blankAnswer()} answered={!!answers[requirement.id]} editable={editable} complete={answerComplete(answers[requirement.id])} update={values => update(requirement.id, values)} />)}</div>
      </details>
    })}
    {!shown && <p>{t('没有符合筛选条件的需求。', 'No requirements match these filters.')}</p>}
    </div>
    </article>
  </div>
}
