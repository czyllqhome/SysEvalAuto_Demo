import { useState } from 'react'
import type { Control, SystemDetail } from './types'
import { useLocale } from './i18n'

function isRuleExcluded(c: Control) {
  return !c.included && !c.reason?.trim() && c.origin !== 'candidate' && c.match?.status === 'inapplicable'
}

const scopeLabels: Record<string, [string, string]> = {
  'ops.outsourced': ['外包运维服务', 'outsourced operations'],
  'scope.physical_media': ['实体存储介质管理', 'physical storage-media management'],
  'scope.media_transport': ['实体介质线下运输或交付', 'physical media transport or delivery'],
  'scope.facility_management': ['机房安全管理责任（含云商取证）', 'facility security including provider assurance'],
  'scope.physical_visitors': ['外部人员访问受控物理区域', 'external visits to controlled physical areas'],
}

export function ruleExemptionKind(c: Control): 'deployment' | 'scope' | null {
  if (!isRuleExcluded(c) || c.match?.reason !== 'rule_not_matched') return null
  const source = c.metadata?.source
  const domain = source?.languages?.zh?.fields?.security_domain ?? source?.fields?.security_domain
  const hosting = c.match?.fact_values?.['hosting.models']
  if (domain?.trim() === '安全物理环境' && c.match.answer_refs.includes('hosting.models')
    && Array.isArray(hosting) && hosting.some(value => value === 'cloud' || value === 'saas')) return 'deployment'
  // Extensions are not general controls, even when another scope fact is present.
  if (domain?.includes('扩展')) return null
  if (Object.keys(scopeLabels).some(key => c.match!.answer_refs.includes(key) && c.match!.fact_values[key] === 'no')) return 'scope'
  const delivery = c.match.fact_values['delivery.models']
  const requiredModes = c.match.rule?.value
  if (c.match.answer_refs.includes('delivery.models') && Array.isArray(delivery) && delivery.length > 0
    && !delivery.includes('unknown') && Array.isArray(requiredModes) && requiredModes.length > 0
    && requiredModes.every(value => value === 'in_house' || value === 'outsourced')
    && !requiredModes.some(value => delivery.includes(value))) return 'scope'
  return null
}

export function isRuleExempted(c: Control) {
  return ruleExemptionKind(c) !== null
}

export function isRuleInapplicable(c: Control) {
  return isRuleExcluded(c) && !isRuleExempted(c)
}

export function summarizeControls(detail: SystemDetail) {
  const classification = detail.system.classification
  const original = detail.controls.filter(c => c.origin !== 'custom' && (!classification.catalog_id || c.catalog_id === classification.catalog_id) && (c.metadata?.source_framework
    ? classification.frameworks?.includes(c.metadata.source_framework)
    : c.levels.includes(classification.effective_level ?? '')))
  const included = original.filter(c => c.included)
  const excluded = original.filter(c => !c.included && (c.reason?.trim() || isRuleExempted(c)))
  const inapplicable = original.filter(isRuleInapplicable)
  return { original, included, excluded, inapplicable, pending: original.length - included.length - excluded.length - inapplicable.length,
    additional: detail.controls.filter(c => c.included && !original.includes(c)).length }
}

export function exemptionReason(c: Control, t: (zh: string, en: string) => string) {
    if (c.reason?.trim()) return c.reason
    if (ruleExemptionKind(c) === 'deployment') return t('安全物理环境属于通用控制；已确认采用云相关部署，按部署规则豁免，并纳入云计算安全扩展要求。', 'Physical-environment controls are general controls exempted by the confirmed cloud-deployment rule; cloud security extensions are included.')
    const hosting = c.match?.fact_values['hosting.models']
    if (c.match?.answer_refs.includes('hosting.models') && Array.isArray(hosting)) {
      return hosting.some(v => v === 'cloud' || v === 'saas')
        ? t('采用云环境，安全物理环境域不适用，改为匹配云计算安全扩展要求。', 'Cloud deployment: physical-environment controls are replaced by cloud security extensions.')
        : t('采用非云环境，云计算安全扩展要求不适用，匹配安全物理环境。', 'Non-cloud deployment: cloud extensions are not applicable and physical-environment controls apply.')
    }
    for (const [key, labels] of Object.entries(scopeLabels)) {
      if (isRuleExempted(c) && c.match?.answer_refs.includes(key) && c.match.fact_values[key] === 'no') return t(`系统信息收集已确认不涉及${labels[0]}，对应通用控制按范围规则豁免。`, `System information confirms no ${labels[1]}; the corresponding general control is exempted by the scope rule.`)
    }
    if (c.match?.answer_refs.includes('delivery.models')) {
      const values = c.match.rule?.value
      const inHouse = Array.isArray(values) && values.includes('in_house')
      if (isRuleExempted(c)) return t(`已选择的软件开发/交付方式不包含${inHouse ? '自行开发' : '外包开发'}（含二次开发），对应通用控制按范围规则豁免。`, `Selected delivery modes do not include ${inHouse ? 'in-house' : 'outsourced'} development or customization; the corresponding general control is exempted by the scope rule.`)
    }
    return t('依据已确认适用条件自动判定不适用。', 'Not applicable under confirmed applicability rules.')
  }

export default function ControlMatchSummary({ detail, domains }: { detail: SystemDetail; domains: Record<string, readonly [string, string]> }) {
  const { t, pair } = useLocale()
  const summary = summarizeControls(detail)
  const deploymentExemptions = summary.excluded.filter(c => ruleExemptionKind(c) === 'deployment').length
  const scopeExemptions = summary.excluded.filter(c => ruleExemptionKind(c) === 'scope').length
  const manualExemptions = summary.excluded.length - deploymentExemptions - scopeExemptions
  const [reasonKind, setReasonKind] = useState<'exempted' | 'inapplicable' | null>(null)
  const reasonRows = reasonKind === 'inapplicable' ? summary.inapplicable : reasonKind === 'exempted' ? summary.excluded : []
  const stats = [
    { key: 'original', label: t('原始条目', 'Original controls'), count: summary.original.length },
    { key: 'included', label: t('已纳入', 'Included'), count: summary.included.length },
    { key: 'inapplicable', label: t('不适用', 'Not applicable'), count: summary.inapplicable.length },
    { key: 'exempted', label: t('豁免条目', 'Exempted'), count: summary.excluded.length },
    { key: 'pending', label: t('待确认', 'Pending'), count: summary.pending },
  ]
  return <section className="control-match-summary" aria-label={t('控制匹配统计', 'Control matching summary')}>
    <p>{t('统计基于本次所选等级和已固定的控制库，不受搜索、分页或控制域筛选影响。通用控制在确认不涉及相关开发、运维活动，或云部署下豁免物理环境控制时计入豁免；非云部署下的云安全扩展计入不适用。人工排除仍计入豁免并需例外审查；条件不明的条目保留待确认。', 'Counts use the selected reference levels and pinned catalog, across all pages and filters. General controls for confirmed out-of-scope development or operations, and physical-environment controls under cloud deployment, count as exemptions. Cloud extensions are not applicable to non-cloud deployment. Manual exclusions remain exemptions requiring exception review. Unknown conditions remain pending.')}</p>
    <div className="stat-strip">{stats.map(({ key, label, count }) => <div key={key}><span>{label}{!!count && (key === 'exempted' || key === 'inapplicable') && <button className="inline-action" aria-expanded={reasonKind === key} onClick={() => setReasonKind(reasonKind === key ? null : key)}>{key === 'inapplicable' ? t('不适用原因', 'Applicability reasons') : t('豁免原因', 'Exemption reasons')}</button>}</span><strong>{count}</strong></div>)}</div>
    {!!summary.additional && <p>{t('额外纳入条目', 'Additional included controls')}: {summary.additional}</p>}
    {!!summary.excluded.length && <p className="control-exemption-breakdown">{t(`豁免构成：部署规则 ${deploymentExemptions} 条，范围规则 ${scopeExemptions} 条，人工排除 ${manualExemptions} 条。`, `Exemption breakdown: ${deploymentExemptions} deployment-rule, ${scopeExemptions} scope-rule, ${manualExemptions} manual exclusions.`)}</p>}
    {!!reasonRows.length && <div className="table-scroll"><table className="control-reason-table">
      <caption>{reasonKind === 'inapplicable' ? t('不适用条目与原因', 'Not-applicable controls and reasons') : t('豁免条目与原因', 'Exempted controls and reasons')}</caption>
      <colgroup><col className="reason-source" /><col className="reason-identifier" /><col className="reason-requirement" /><col className="reason-domain" /><col className="reason-decision" /><col className="reason-explanation" /></colgroup>
      <thead><tr><th scope="col">Source</th><th scope="col">Identifier</th><th scope="col">{t('控制项原文', 'Original control text')}</th><th scope="col">{t('控制域', 'Domain')}</th><th scope="col">{t('判定方式', 'Decision type')}</th><th scope="col">{t('原因', 'Reason')}</th></tr></thead>
      <tbody>{reasonRows.map(c => {
        // Keep pinned source wording intact when switching the interface language.
        const source = c.metadata?.source
        const fields = [source?.languages?.zh?.fields, source?.fields, ...Object.values(source?.languages ?? {}).map(language => language.fields)]
        const sourceField = (key: string) => fields.map(f => f?.[key]).find(value => value?.trim())
        const authored = c.translations.zh ?? Object.values(c.translations)[0]
        const requirement = sourceField('control_requirement') ?? authored?.description
        return <tr key={c.id}>
          <td>{sourceField('source') ?? c.metadata?.source_framework ?? t('未提供来源', 'Source not provided')}</td>
          <td>{sourceField('control_identifier') ?? c.metadata?.source_ref ?? t('未提供标识', 'Identifier not provided')}</td>
          <td><p className="control-reason-original">{requirement || t('未提供控制项原文', 'Original control text not provided')}</p></td>
          <td>{domains[c.domain] ? pair(domains[c.domain]) : c.domain}</td>
          <td>{reasonKind === 'inapplicable' ? t('规则判定不适用', 'Not applicable by rule') : isRuleExempted(c) ? ruleExemptionKind(c) === 'deployment' ? t('部署规则豁免', 'Deployment-rule exemption') : t('范围规则豁免', 'Scope-rule exemption') : t('人工排除', 'Manual exclusion')}</td>
          <td>{exemptionReason(c, t)}</td>
        </tr>
      })}</tbody>
    </table></div>}

  </section>
}
