import { useId, useState } from 'react'
import { CheckLabel } from './components'
import { useLocale } from './i18n'
import { answerNeedsAttention } from './supplierAnswers'
import type { Answer, Requirement } from './types'

export default function SupplierRequirement({ requirement, answer, answered, editable, complete, highRisk = false, update }: {
  requirement: Requirement; answer: Answer; answered: boolean; editable: boolean; complete: boolean; highRisk?: boolean; update: (value: Partial<Answer>) => void
}) {
  const { t } = useLocale()
  const [expanded, setExpanded] = useState(false)
  const panelId = useId()
  const labels = { yes: t('可完成', 'Can deliver'), partial: t('部分可完成', 'Partially deliverable'), no: t('无法完成', 'Cannot deliver'), needs_clarification: t('需要澄清', 'Needs clarification') }
  const exception = answered && answer.implementation_status !== 'yes'
  const needsAttention = answerNeedsAttention(answered ? answer : undefined, highRisk)
  const responseLabel = !answered ? t('未填写', 'Unanswered') : exception
    ? `${labels[answer.implementation_status]} · ${complete ? t('待负责人判断', 'Owner review required') : t('待补充说明', 'Explanation needed')}`
    : complete ? t('可完成', 'Can deliver') : t('待补充说明', 'Explanation needed')
  const hasHistory = !!(answer.owner_name || answer.implementation_plan || answer.estimated_start_date || answer.estimated_finish_date || answer.duration_workdays != null)
  return <article className={`supplier-prd-requirement ${complete ? 'complete' : ''} ${needsAttention ? 'needs-attention' : ''}`} aria-label={`${requirement.id} ${requirement.title}`}>
    <header><code>{requirement.id}</code><h3>{requirement.title}</h3><span className={`supplier-response-status ${complete && !exception ? 'complete' : ''}`}>{responseLabel}</span></header>
    {highRisk && <span className="supplier-high-risk" title={t('本轮发布的来源控制标记为 High', 'A source control published in this round is marked High')}>{t('高风险', 'High risk')}</span>}
    <p className="preserve-lines">{requirement.description}</p>
    <details className="supplier-acceptance"><summary>{t('验收条件与来源', 'Acceptance criteria and sources')}</summary><ul>{requirement.acceptance_criteria.map((c, i) => <li key={i}>{c}</li>)}</ul><div className="source-trace">{[...requirement.source_context_item_ids, ...requirement.source_control_ids].map(id => <code key={id}>{id}</code>)}</div></details>
    <fieldset disabled={!editable} className="supplier-response-choice"><legend className="sr-only">{t('供应商对本项 PRD 的承诺', 'Supplier commitment for this PRD item')}</legend>
      <CheckLabel checked={answer.implementation_status === 'yes'} onChange={checked => { update({ implementation_status: checked ? 'yes' : 'needs_clarification', ...(checked && answer.duration_workdays === 0 ? { duration_workdays: null } : {}) }); setExpanded(!checked) }}>{t('可以按本项要求完成', 'Can deliver this requirement')}</CheckLabel>
    </fieldset>
    <button type="button" className="inline-action supplier-exception-toggle" aria-expanded={expanded} aria-controls={panelId} onClick={() => setExpanded(!expanded)}>{exception ? `${labels[answer.implementation_status]} · ${t('查看说明', 'View explanation')}` : t('有例外或需要澄清', 'Exception or clarification')}{expanded ? ' ▴' : ' ▾'}</button>
    {expanded && <fieldset id={panelId} disabled={!editable} className="supplier-inline-response"><legend>{t('提交负责人判断', 'For accountable owner review')}</legend>
      <label>{t('可完成性或例外', 'Feasibility or exception')}<select value={answered ? answer.implementation_status : ''} onChange={e => { update({ implementation_status: e.target.value as Answer['implementation_status'] }); if (e.target.value === 'yes') setExpanded(false) }}><option value="" disabled>{t('请选择', 'Choose')}</option>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      {answer.implementation_status !== 'yes' && <><label>{t('无法或部分完成的原因／待澄清内容（必填）', 'Reason for inability, partial delivery or clarification (required)')}<textarea rows={3} value={answer.limitations} onChange={e => update({ limitations: e.target.value })} /></label><label>{t('补偿性措施（选填）', 'Compensating measures (optional)')}<textarea rows={2} value={answer.alternative} onChange={e => update({ alternative: e.target.value })} /></label><label>{t('预计天数（工作日，选填）', 'Estimated workdays (optional)')}<input type="number" min="1" max="10000" value={answer.duration_workdays ?? ''} onChange={e => update({ duration_workdays: e.target.value ? Number(e.target.value) : null })} /></label><p className="field-hint">{t('提交后由负责人结合原因、补偿措施和影响分析决定是否接受。', 'The owner reviews your explanation, compensating measures and impact analysis before deciding whether to accept.')}</p></>}
      {hasHistory && <details><summary>{t('已有交付安排（选填）', 'Existing delivery arrangements (optional)')}</summary><div className="form-grid">{answer.implementation_status === 'yes' && <label>{t('预计天数（工作日，选填）', 'Estimated workdays (optional)')}<input type="number" min="1" max="10000" value={answer.duration_workdays ?? ''} onChange={e => update({ duration_workdays: e.target.value ? Number(e.target.value) : null })} /></label>}<label>{t('相关负责人', 'Accountable owner')}<input value={answer.owner_name} onChange={e => update({ owner_name: e.target.value })} /></label><label>{t('预计开始', 'Planned start')}<input type="date" value={answer.estimated_start_date ?? ''} onChange={e => update({ estimated_start_date: e.target.value || null })} /></label><label>{t('预计完成', 'Planned finish')}<input type="date" value={answer.estimated_finish_date ?? ''} onChange={e => update({ estimated_finish_date: e.target.value || null })} /></label></div><label>{t('实现方案', 'Implementation plan')}<textarea rows={3} value={answer.implementation_plan} onChange={e => update({ implementation_plan: e.target.value })} /></label></details>}
    </fieldset>}
  </article>
}
