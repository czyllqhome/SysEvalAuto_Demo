import ControlDomainTable from './ControlDomainTable'
import ControlMatchSummary, { exemptionReason, isRuleExempted, isRuleInapplicable } from './ControlMatchSummary'
import { Fragment, useContext, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Check, Plus, Search } from 'lucide-react'
import { api } from './api'
import ControlQuestions from './ControlQuestions'
import MLPSIntake from './MLPSIntake'
import { Button, Empty, Modal, ModeControl, Notice, PreferencesContext, useCommand } from './components'
import { domainNames, useLocale } from './i18n'
import type { Control, SystemDetail } from './types'

export { DiscoveryPanel } from './narrative'

export function recommend(answers: Record<string, string>) {
  const values = ['Q1', 'Q2', 'Q3', 'Q4', 'Q5'].map(key => answers[key] ?? 'unknown')
  if (values.includes('L3')) return 'L3'
  if (values.includes('L2') || values.includes('unknown')) return 'L2'
  return 'L1'
}
export function ClassificationPanel({ detail }: { detail: SystemDetail }) {
  return <MLPSIntake detail={detail} />
}
export function ControlsPanel({ detail }: { detail: SystemDetail }) {
  const { t, locale, pair } = useLocale()
  const prefs = useContext(PreferencesContext)
  const navigate = useNavigate()
  const [layout, setLayout] = useState<'cards' | 'rows'>(() => localStorage.getItem('control-layout') === 'rows' ? 'rows' : 'cards')
  const [domain, setDomain] = useState(''), [search, setSearch] = useState(''), [filter, setFilter] = useState('selected'), [page, setPage] = useState(1)
  const [questionsOpen, setQuestionsOpen] = useState(false)
  const [exclude, setExclude] = useState<Control | null>(null), [reason, setReason] = useState('')
  const [bulkOpen, setBulkOpen] = useState(false), [bulkDomains, setBulkDomains] = useState<string[]>([]), [bulkReason, setBulkReason] = useState('')
  const { run, busy, error } = useCommand(detail)
  const query = useQuery({ queryKey: ['controls', detail.system.id, detail.system.classification.catalog_id, domain, search, layout === 'rows' ? 'all' : page], queryFn: async ({ signal }) => {
    type ControlPage = { items: Control[]; total: number; domain_labels?: Record<string, [string, string]> }
    const load = (number: number) => api<ControlPage>(`/controls?system_id=${detail.system.id}&domain=${encodeURIComponent(domain)}&q=${encodeURIComponent(search)}&page=${number}`, { signal })
    const first = await load(layout === 'rows' ? 1 : page)
    if (layout !== 'rows') return first
    // Complete the pinned catalog query before filtering/grouping so a domain is never split.
    const items = [...first.items]
    const pages = Math.ceil(first.total / 100)
    for (let number = 2; number <= pages; number += 3) {
      signal.throwIfAborted()
      const batch = await Promise.all(Array.from({ length: Math.min(3, pages - number + 1) }, (_, offset) => load(number + offset)))
      for (const next of batch) {
        if (!next.items.length || next.total !== first.total) throw new Error('Incomplete control catalog')
        items.push(...next.items)
      }
    }
    if (items.length !== first.total) throw new Error('Incomplete control catalog')
    return { ...first, items }
  } })
  const domains = Object.keys(query.data?.domain_labels ?? {}).length ? query.data!.domain_labels! : domainNames
  if (!detail.system.context_revision_id) return <Empty title={t('先完成系统信息收集', 'Complete system information first')}><Link to={`/systems/${detail.system.id}/information`} className="button primary">{t('完善系统信息', 'Complete system information')}</Link></Empty>
  const canChangeControls = !detail.permissions || detail.permissions.some(p => p === 'edit' || p === 'manage')
  const pending = detail.controls.filter(item => item.origin === 'candidate' && !item.included && !item.reason).length
  const selected = detail.controls.filter(item => item.included)
  const bulkControls = selected.filter(c => bulkDomains.includes(c.domain))
  const byId = Object.fromEntries(detail.controls.map(item => [item.id, item]))
  const records = (query.data?.items ?? []).filter(item => filter === 'all' || filter === 'selected' && byId[item.id]?.included || filter === 'excluded' && byId[item.id] && !byId[item.id].included)
  const displayed = layout === 'rows' ? [...records].sort((a, b) => a.domain.localeCompare(b.domain) || a.code.localeCompare(b.code)) : records
  async function toggle(control: Control, included: boolean) {
    try { await run(`/systems/${detail.system.id}/controls`, { control_id: control.id, included, reason: included ? '' : reason }); setExclude(null); setReason('') } catch { /* Displayed in the notice. */ }
  }
  async function generate() {
    if (detail.system.assessment_type === 'existing') {
      try { await run(`/systems/${detail.system.id}/existing/begin`); navigate(`/systems/${detail.system.id}/existing`) } catch { /* Shown by command notice. */ }
      return
    }
    try { await run(`/systems/${detail.system.id}/jobs`, { kind: 'prd_generation', mode: prefs.mode, language: prefs.outputLanguage === 'auto' ? locale : prefs.outputLanguage }); navigate(`/systems/${detail.system.id}/prd`) } catch { /* Displayed in the notice. */ }
  }
  return <section><div className="section-heading"><div><h2>{t('安全控制匹配', 'Security control matching')}</h2><p className="muted">{t('根据系统等级与适用信息匹配安全控制，支持补充、排除和恢复控制项。', 'Match security controls to the system level and applicability, then add, exclude or restore controls.')}</p></div><div className="controls-heading-actions">{!!pending && <Button variant="secondary" onClick={() => setQuestionsOpen(true)}>{t('补充适用信息', 'Complete applicability information')} ({pending})</Button>}<span className="count-emphasis">{selected.length}<small>{t('已选控制', 'SELECTED CONTROLS')}</small></span><Button variant="secondary" disabled={busy || !canChangeControls || detail.system.status !== 'CONTROL_REVIEW' || !selected.length} onClick={() => { setBulkDomains([]); setBulkReason(''); setBulkOpen(true) }}>{t('按控制域批量移除', 'Remove by control domain')}</Button></div></div>{error && <Notice error>{error}</Notice>}
    <ControlMatchSummary detail={detail} domains={domains} onRestore={control => void toggle(control, true)} disabled={busy || !canChangeControls || detail.system.status !== 'CONTROL_REVIEW'} />
    {!!pending && <ControlQuestions detail={detail} pending={pending} />}{questionsOpen && <Modal wide title={t('补充控制适用信息', 'Complete control applicability information')} close={() => setQuestionsOpen(false)}><ControlQuestions detail={detail} pending={pending} /></Modal>}
    <div className="controls-layout"><aside className="domain-rail"><span className="eyebrow">{t('控制域', 'CONTROL DOMAINS')}</span><button className={!domain ? 'active' : ''} onClick={() => { setDomain(''); setPage(1) }}>{t('全部条目', 'All controls')}<span>{selected.length}</span></button>{Object.entries(domains).map(([key, label]) => <button className={domain === key ? 'active' : ''} key={key} onClick={() => { setDomain(key); setPage(1) }}>{pair(label)}<span>{selected.filter(c => c.domain === key).length}</span></button>)}<p className="field-hint">{t('右侧数字为当前已选数量。', 'Counts show the selected controls.')}</p><div className="domain-rule"><span className="mono">{detail.system.classification.effective_level}</span></div></aside>
    <div className="control-table-panel"><div className="control-toolbar"><div className="control-view-switch" role="group" aria-label={t('控制展示方式', 'Control view')}>
      {(['cards', 'rows'] as const).map(value => <button type="button" key={value} aria-pressed={layout === value} onClick={() => { setLayout(value); localStorage.setItem('control-layout', value) }}>{value === 'cards' ? t('卡片', 'Cards') : t('控制域 · 表格', 'Domains · Table')}</button>)}
    </div><label className="search-field"><Search size={15} /><input aria-label={t('搜索控制', 'Search controls')} placeholder={t('搜索编码、标题或内容', 'Search code, title, or text')} value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} /></label><select aria-label={t('选择状态', 'Selection status')} value={filter} onChange={e => setFilter(e.target.value)}><option value="all">{t('全部条目', 'All controls')}</option><option value="selected">{layout === 'rows' ? t('已选条目', 'Selected controls') : t('当前页已选', 'Selected on this page')}</option><option value="excluded">{layout === 'rows' ? t('已排除条目', 'Excluded controls') : t('当前页已排除', 'Excluded on this page')}</option></select></div>
    {layout === 'cards' && <p className="field-hint">{t('列表每页最多 100 条，按当前页分组；左侧数字为跨页已选总数。点击左侧控制域可集中查看该域条目。', 'The list shows up to 100 controls per page, grouped within that page. Sidebar counts include selected controls across all pages. Select a domain on the left to view its controls together.')}</p>}
    {query.isPending && <p role="status" className="field-hint">{t('正在加载控制条目…', 'Loading controls…')}</p>}{query.error && <Notice error>{t('条目加载失败，请刷新。', 'Could not load controls. Please refresh.')}</Notice>}{layout === 'rows' ? <><ControlDomainTable controls={displayed} selections={detail.controls} domains={domains} disabled={busy || !canChangeControls || detail.system.status !== 'CONTROL_REVIEW'} onToggle={control => { const selection = byId[control.id]; if (selection?.included) { setExclude(control); setReason(selection.reason ?? '') } else void toggle(control, true) }} onQuestions={() => setQuestionsOpen(true)} onExclude={control => { setExclude(control); setReason('') }} />{!query.isPending && !query.error && !records.length && <Empty title={t('没有匹配条目', 'No matching controls')} />}</> : <div className="control-card-grid">{displayed.map((control) => { const text = control.translations[locale] ?? Object.values(control.translations)[0], selection = byId[control.id]; return <Fragment key={control.id}><article className={`control-row ${selection?.included ? 'included' : ''}`} key={control.id}><button className={`selection-toggle ${selection?.included ? 'on' : ''}`} disabled={busy || !canChangeControls || detail.system.status !== 'CONTROL_REVIEW'} aria-label={`${selection?.included ? t('排除', 'Exclude') : t('加入', 'Include')} ${text.title}`} onClick={() => { if (selection?.included) { setExclude(control); setReason(selection.reason ?? '') } else void toggle(control, true) }}>{selection?.included ? <Check size={14} /> : <Plus size={14} />}</button><div><div className="control-meta"><span className="mono">{control.code}</span><span>{control.required ? t('必选', 'Required') : t('可选', 'Optional')}</span><span>{control.levels.join(' / ')}</span></div><h3>{text.title}</h3>{selection && !selection.included && (selection.reason || selection.origin !== 'candidate' && selection.match?.status === 'inapplicable') && <p className="exclusion-reason"><strong>{isRuleInapplicable(selection) ? t('不适用原因', 'Not-applicable reason') : isRuleExempted(selection) ? t('豁免原因', 'Exemption reason') : t('排除原因', 'Exclusion reason')}: </strong>{['framework_not_selected', 'profile_not_selected'].includes(selection.match?.reason ?? '') && !selection.reason ? t('不属于本次所选等级参考库，不计入豁免数量。', 'Outside the selected reference level; not counted as an exemption.') : exemptionReason(selection, t)}</p>}<p>{text.description}</p><details><summary>{t('验收证据与匹配依据', 'Verification and matching rationale')}</summary><p>{text.verification}</p>{selection?.match && <p>{selection.match.status} · {selection.match.answer_refs.map(code => `${code}=${JSON.stringify(selection.match!.fact_values[code])}`).join(', ')} · {selection.match.responsibility}</p>}{control.metadata?.source_ref && <p>{control.metadata.source_ref}</p>}<p>{selection?.origin === 'manual' ? t('用户手动补充', 'Manually added by the customer') : control.levels.includes(detail.system.classification.effective_level ?? '') ? t('适用于已确认等级', 'Applicable to the confirmed level') : t('未自动匹配，可手动纳入', 'Not automatically matched; available for manual inclusion')}</p></details>{selection?.origin === 'candidate' && !selection.included && !selection.reason && <div className="candidate-notice"><span>{selection.match?.status === 'inapplicable' ? t('当前等级或框架方案不匹配，请复核后明确纳入或排除。', 'This control does not match the current level or framework profile. Review and explicitly include or exclude it.') : t('适用条件未知，请纳入或明确排除。', 'Applicability is unknown. Include or explicitly exclude this control.')}</span><button className="inline-action" onClick={() => setQuestionsOpen(true)}>{t('补充适用信息', 'Complete applicability information')}</button><button className="inline-action" onClick={() => { setExclude(control); setReason('') }}>{t('记录不适用理由', 'Record inapplicability reason')}</button></div>}</div></article></Fragment> })}{!query.isPending && !query.error && !records.length && <Empty title={t('没有匹配条目', 'No matching controls')} />}</div>}
    {layout === 'cards' && <div className="pagination"><span>{query.data?.total ?? 0} {t('条结果', 'results')} · {t('页', 'Page')} {page}</span><button className="icon-button" disabled={page <= 1} aria-label={t('上一页', 'Previous page')} onClick={() => setPage(page - 1)}><ArrowLeft size={15} /></button><button className="icon-button" disabled={page * 100 >= (query.data?.total ?? 0)} aria-label={t('下一页', 'Next page')} onClick={() => setPage(page + 1)}><ArrowRight size={15} /></button></div>}</div>
    <aside className="selection-summary"><span className="eyebrow">SELECTED CONTROLS</span><h3>{t('当前控制范围', 'Selected scope')}</h3><div className="selection-number">{selected.length}<span>/ {detail.controls.length} {t('已记录', 'recorded')}</span></div><div className="coverage-bars">{Object.entries(domains).map(([key, label]) => <div key={key}><span>{pair(label)}</span><div><i style={{ width: `${Math.min(100, selected.filter(c => c.domain === key).length * 28)}%` }} /></div><strong>{selected.filter(c => c.domain === key).length}</strong></div>)}</div><hr /><p className="field-hint">{t('排除必选控制的理由会进入最终例外审查；不会删除全局条目。', 'Exclusions of required controls enter the final exception review and never delete catalog records.')}</p><Link className="inline-action" to="/library">{t('管理控制库', 'Manage the catalog')}<ArrowRight size={14} /></Link></aside></div>
    <div className="stage-actions">{detail.system.assessment_type !== 'existing' && <ModeControl />}<Button busy={busy} disabled={!!pending || (!!detail.permissions && !detail.permissions.includes('edit')) || !selected.length || !['CONTROL_REVIEW', 'PRD_REVIEW'].includes(detail.system.status)} onClick={() => void generate()}>{detail.system.assessment_type === 'existing' ? t('确认范围并开始核验', 'Confirm scope & start verification') : t('确认范围并生成 PRD', 'Confirm scope & generate PRD')}<ArrowRight size={16} /></Button></div>
    {bulkOpen && <Modal title={t('按控制域批量移除', 'Remove by control domain')} close={() => { if (!busy) setBulkOpen(false) }} wide>
      {error && <Notice error>{error}</Notice>}
      <p>{t('移除所选控制域内当前已纳入的全部控制，不受搜索或分页限制。已排除条目的原因保持不变。', 'Remove all currently included controls in the selected domains, across all pages and filters. Existing exclusion reasons remain unchanged.')}</p>
      <fieldset disabled={busy}><legend>{t('选择控制域', 'Select control domains')}</legend><div className="fact-multi-options">{[...new Set(selected.map(c => c.domain))].map(key => <label className="check-label fact-multi-option" key={key}><input type="checkbox" checked={bulkDomains.includes(key)} onChange={e => setBulkDomains(e.target.checked ? [...bulkDomains, key] : bulkDomains.filter(d => d !== key))} />{domains[key] ? pair(domains[key]) : key} · {selected.filter(c => c.domain === key).length}</label>)}</div>
      <p aria-live="polite">{t('将移除', 'Controls to remove')}: {bulkControls.length} · {t('其中必选控制', 'Required controls')}: {bulkControls.filter(c => c.required).length}</p>
      <details><summary>{t('查看受影响条目', 'View affected controls')}</summary>{bulkControls.map(c => <p key={c.id}>{c.code} · {(c.translations[locale] ?? Object.values(c.translations)[0]).title}</p>)}</details>
      <label>{t('统一移除原因', 'Shared exclusion reason')}<textarea rows={3} value={bulkReason} onChange={e => setBulkReason(e.target.value)} /></label>
      <p className="field-hint">{t('原因将记录到每条控制；必选控制的排除仍需在最终例外审查中处理。', 'The reason is saved on every control. Required-control exclusions still need final exception review.')}</p>
      <div className="modal-actions"><Button variant="secondary" onClick={() => setBulkOpen(false)}>{t('取消', 'Cancel')}</Button><Button busy={busy} disabled={!bulkControls.length || !bulkReason.trim()} onClick={async () => { try { await run(`/systems/${detail.system.id}/controls/exclude-domains`, { domains: bulkDomains, reason: bulkReason }); setBulkOpen(false) } catch { /* Preserve selections and reason for correction. */ } }}>{t('确认批量移除', 'Confirm bulk removal')}</Button></div></fieldset>
    </Modal>}
    {exclude && <Modal title={t('记录控制排除理由', 'Record the exclusion reason')} close={() => setExclude(null)}><p>{(exclude.translations[locale] ?? Object.values(exclude.translations)[0]).title}</p>{exclude.required && <Notice>{t('这是必选控制。排除记录需要在最终审查中明确处理。', 'This is a required control. Its exclusion must be explicitly dispositioned in final review.')}</Notice>}<label>{t('为什么不适用或暂不纳入？', 'Why is it inapplicable or excluded?')}<textarea rows={4} value={reason} onChange={e => setReason(e.target.value)} /></label><div className="modal-actions"><Button variant="secondary" onClick={() => setExclude(null)}>{t('取消', 'Cancel')}</Button><Button busy={busy} disabled={!reason.trim()} onClick={() => void toggle(exclude, false)}>{t('保存排除决定', 'Save exclusion')}</Button></div></Modal>}
  </section>
}
