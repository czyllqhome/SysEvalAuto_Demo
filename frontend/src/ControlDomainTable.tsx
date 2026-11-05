import { Check, Plus } from 'lucide-react'
import { useId, useState } from 'react'
import { useLocale } from './i18n'
import { exemptionReason, isRuleExempted, isRuleInapplicable } from './ControlMatchSummary'
import type { Control } from './types'
import './control-domain-table.css'

export function displayControlCode(control: Control) {
  const ref = control.metadata?.source_ref?.trim()
  const level = control.metadata?.source_level
  return ref ? level ? `L${level}-${ref.replace(/\s+/g, '').replace(/\)$/, '')}` : ref : control.code
}

export default function ControlDomainTable({ controls, selections, domains, disabled, onToggle, onQuestions, onExclude }: {
  controls: Control[]; selections: Control[]; domains: Record<string, readonly [string, string]>; disabled: boolean;
  onToggle: (control: Control) => void; onQuestions: () => void; onExclude: (control: Control) => void;
}) {
  const { t, locale, pair } = useLocale()
  const id = useId()
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const byId = new Map(selections.map(c => [c.id, c]))
  const groups = new Map<string, Control[]>()
  for (const control of controls) groups.set(control.domain, [...(groups.get(control.domain) ?? []), control])
  return <div className="control-domain-table-view">{[...groups].map(([domain, rows], index) => {
    const label = domains[domain] ? pair(domains[domain]) : domain
    const expanded = !collapsed.has(domain)
    const panelId = `${id}-domain-${index}`
    return <section className="control-domain-table-section" key={domain}>
      <h3><button type="button" className="control-domain-heading-toggle" aria-expanded={expanded} aria-controls={panelId} onClick={() => setCollapsed(previous => {
        const next = new Set(previous)
        if (next.has(domain)) next.delete(domain); else next.add(domain)
        return next
      })}><span aria-hidden="true">{expanded ? '▾' : '▸'}</span><span>{label} ({rows.length})</span><small>{t('本域已选总数', 'Total selected in domain')} {selections.filter(c => c.domain === domain && c.included).length}</small></button></h3>
      <div id={panelId} hidden={!expanded} className="control-domain-table-scroll"><table aria-label={label}>
        <colgroup><col className="control-code-column" /><col className="control-point-column" /><col /><col className="control-risk-column" /></colgroup>
        <thead><tr><th scope="col">{t('编码', 'Code')}</th><th scope="col">{t('控制点', 'Control point')}</th><th scope="col">{t('要求', 'Requirement')}</th><th scope="col">{t('风险等级', 'Risk level')}</th></tr></thead>
        <tbody>{[...rows].sort((a, b) => displayControlCode(a).localeCompare(displayControlCode(b), undefined, { numeric: true })).map(control => {
          const text = control.translations[locale] ?? Object.values(control.translations)[0]
          const selection = byId.get(control.id)
          const source = control.metadata?.source
          const fields = source?.languages?.[locale]?.fields ?? source?.languages?.zh?.fields ?? source?.fields
          // Source risk uses the same pinned Chinese field as backend source-risk review.
          const risk = (source?.languages?.zh?.fields?.risk_level ?? fields?.risk_level ?? '').trim().toLowerCase()
          const pending = selection?.origin === 'candidate' && !selection.included && !selection.reason
          const outside = ['framework_not_selected', 'profile_not_selected'].includes(selection?.match?.reason ?? '') && !selection?.reason
          return <tr key={control.id}>
            <td><div className="control-table-code"><button type="button" className={`selection-toggle ${selection?.included ? 'on' : ''}`} disabled={disabled} aria-label={`${selection?.included ? t('排除', 'Exclude') : t('加入', 'Include')} ${text.title}`} onClick={() => onToggle(control)}>{selection?.included ? <Check size={14} /> : <Plus size={14} />}</button><strong>{displayControlCode(control)}</strong></div></td>
            <td>{text.title}</td>
            <td><p className="control-table-requirement">{text.description}</p><details><summary>{t('测评方法与预期证据', 'Assessment method and expected evidence')}{pending && <span className="control-table-pending"> · {t('待确认', 'Pending')}</span>}</summary>
              <p>{fields?.assessment_procedure || text.verification}</p>
              <p>{t('内部编码', 'Internal code')}: {control.code} · {control.required ? t('必选', 'Required') : t('可选', 'Optional')} · {control.levels.join(' / ')}</p>
              {control.metadata?.source_ref && <p>{t('来源条款', 'Source clause')}: {control.metadata.source_ref}</p>}
              {selection && !selection.included && (selection.reason || isRuleInapplicable(selection) || isRuleExempted(selection)) && <p><strong>{outside ? t('范围说明', 'Reference scope') : isRuleInapplicable(selection) ? t('不适用原因', 'Not-applicable reason') : t('豁免原因', 'Exemption reason')}: </strong>{outside ? t('不属于本次所选等级参考库，不计入豁免数量。', 'Outside the selected reference level; not counted as an exemption.') : exemptionReason(selection, t)}</p>}
              {selection?.match && <p>{t('匹配依据', 'Matching rationale')}: {selection.match.answer_refs.map(key => `${key}=${JSON.stringify(selection.match!.fact_values[key])}`).join(' · ')}</p>}
              {selection?.origin === 'manual' && <p>{t('用户手动补充', 'Manually added by the customer')}</p>}
              {pending && <div className="control-table-actions"><button type="button" className="inline-action" disabled={disabled} onClick={onQuestions}>{t('补充适用信息', 'Complete applicability information')}</button><button type="button" className="inline-action" disabled={disabled} onClick={() => onExclude(control)}>{t('记录不适用理由', 'Record inapplicability reason')}</button></div>}
            </details></td>
            <td className="control-table-risk">{risk === 'high' || risk === 'medium' ? <span className={`control-risk-badge control-risk-${risk}`}>{risk === 'high' ? t('高风险', 'High risk') : t('中风险', 'Medium risk')}</span> : <span className="control-risk-dash" title={!risk ? t('来源未提供风险等级', 'Source risk level not provided') : undefined}>-</span>}</td>
          </tr>
        })}</tbody>
      </table></div>
    </section>
  })}</div>
}
