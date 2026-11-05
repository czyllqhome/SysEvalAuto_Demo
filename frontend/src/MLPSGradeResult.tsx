import { selectedImpactFields } from './impactSelection'
import { ArrowLeft, ArrowRight, Check, ShieldCheck } from 'lucide-react'
import { Button, Notice } from './components'
import { useLocale } from './i18n'
import type { Assessment, Question } from './MLPSIntake'

export default function MLPSGradeResult({ assessment: a, answers, notes, questions, frameworks, locked, frameworkMode, setFrameworkMode, setFrameworks, back, confirm, readOnly = false, early = false }: {
  early?: boolean; readOnly?: boolean; assessment: Assessment; answers: Record<string, unknown>; notes: Record<string, string>; questions: Question[];
  frameworks: string[]; locked: boolean; frameworkMode: string; setFrameworkMode: (value: string) => void; setFrameworks: (values: string[]) => void; back: (field?: string) => void; confirm: () => void
}) {
  const { t, locale } = useLocale()
  const level = (value: number | null) => value ? t(`${value} 级`, `Level ${value}`) : t('待确定', 'Undetermined')
  const party = (field: string) => field.includes('_rights_') ? t('个人和企业的合法权益', 'Individual / organizational rights') : field.includes('_public_') ? t('社会秩序或公共利益', 'Public order / public interests') : t('国家安全', 'National security')
  const severity = (value: number | null) => [t('无侵害', 'No harm'), t('一般损害', 'Minor harm'), t('严重损害', 'Serious harm'), t('特别严重损害', 'Particularly serious harm')][value ?? 9] ?? t('无法判断', 'Unknown')
  const code = (field: string) => questions.find(q => q.key === field)?.id ?? (field.startsWith('info_') ? 'E09' : 'E10')
  const selected = new Set([...selectedImpactFields('info', answers), ...selectedImpactFields('service', answers)])
  const scoreRows = ['rights', 'public', 'national'].flatMap(party => a.rule_trace.filter(row => selected.has(row.field) && row.field.includes(`_${party}_`)))
  const internalTitle = (field: string, subfield?: string) => field === 'data_volume_ranges' ? subfield === 'records' ? t('业务记录数量', 'Business record count') : t('数据容量', 'Data storage volume') : ({
    interconnected_system_level: t('对接系统最高等级', 'Highest connected-system grade'),
    external_network_access: t('网络入口方式', 'Network ingress'),
    public_service_nature: t('公共服务', 'Public service'),
    involves_transactions: t('是否涉及交易', 'Transaction involvement'),
    critical_business: t('业务重要性', 'Business importance'),
    personal_info_count_system: t('个人信息人数', 'Personal-information population'),
    data_security_classification: t('数据安全分类', 'Data security classification'),
    cross_border_data: t('数据跨境传输', 'Cross-border data transfer'),
    external_dependency_impact: t('外部同步影响', 'External dependency impact'),
    safety_impact: t('安全及社会稳定影响', 'Safety and social-stability impact'),
  } as Record<string, string>)[field] ?? field
  const questionText = (field: string, subfield?: string) => {
    const question = questions.find(q => q.key === field)
    const text = question ? locale === 'zh' ? question.zh : question.en : internalTitle(field, subfield)
    return field === 'data_volume_ranges' && subfield ? `${text} · ${internalTitle(field, subfield)}` : text
  }
  const internalAnswer = (field: string, answer: string | number, subfield?: string) => {
    if (typeof answer === 'number') return t(`${answer.toLocaleString()} 人`, `${answer.toLocaleString()} people`)
    const q = questions.find(q => q.key === field)
    const group = subfield ? q?.range_groups?.[subfield] : undefined
    if (group) { const index = group.values.indexOf(answer); if (index >= 0) return locale === 'zh' ? group.zh[index] : group.en[index] }
    const index = q?.options?.indexOf(answer) ?? -1
    return index >= 0 ? locale === 'en' ? q!.options_en?.[index] ?? answer : q!.options_zh?.[index] ?? answer : answer
  }
  const internalOptions = (field: string, answer: string | number, subfield?: string) => {
    const q = questions.find(q => q.key === field)
    const group = subfield ? q?.range_groups?.[subfield] : undefined
    const options: { value: string | number; label: string; saved: boolean }[] = (group?.values ?? q?.options ?? []).map(value => ({ value, label: internalAnswer(field, value, subfield), saved: false }))
    if (!options.some(option => option.value === answer)) options.unshift({ value: answer, label: internalAnswer(field, answer, subfield), saved: true })
    return options
  }
  const tooLow = frameworks.some(f => Number(f.slice(-1)) < (a.proposed_level ?? 0))
  return <div className="mlps-grade-results" aria-live="polite">
    <header className="grade-page-header"><div><span className="eyebrow">ASSESSMENT / SYSTEM GRADE</span><h2>{t('系统等级', 'System grade')}</h2><p>{early ? t('定级问题已优先计算。补齐其余问题后再次校验，确认应用说明后匹配控制项。', 'Grading inputs are evaluated first. Complete the remaining questions for final validation, then confirm the brief to match controls.') : readOnly ? t('查看已确认问卷对应的等级计算结果和依据。', 'View the confirmed questionnaire grade and its calculation basis.') : t('从问卷答案追溯等级依据，确认后继续审查应用说明。', 'Trace the grade to questionnaire answers, then confirm to continue.')}</p></div>{!readOnly && <Button variant="secondary" disabled={locked} onClick={() => back()}><ArrowLeft size={16} />{t('返回修改问卷', 'Edit questionnaire')}</Button>}</header>
    <section className="grade-overview"><div className="grade-summary"><ShieldCheck size={30} /><span>{t('初步建议等级', 'Preliminary recommended grade')}</span><strong>{level(a.proposed_level)}</strong><p>{a.is_lower_bound_only ? t('影响或内部下限尚未完整核实，当前仅展示已知等级下限。', 'Impacts or internal minima remain unverified; this is a known lower bound.') : a.status === 'preliminary_complete' ? t('初步计算已完成，正式定级仍需后续核准。', 'Preliminary calculation complete; formal approval remains separate.') : t('存在待补充或待复核事项。', 'Missing or unresolved information requires review.')}</p></div><div className="grade-formula"><h3>{t('等级如何得出', 'How the grade is determined')}</h3><p>{t('建议等级取当前问卷影响矩阵与 Amer Sports 内部规则下限的最高值。', 'The recommendation is the maximum of the current questionnaire impact matrix and Amer Sports internal minimum.')}</p><div className="grade-dimension-totals"><div>{t('业务信息影响', 'Information impact')}<strong>{level(a.business_information_level)}</strong></div><div>{t('系统服务影响', 'Service impact')}<strong>{level(a.system_service_level)}</strong></div><div>{t('Amer Sports 内部下限', 'Amer Sports internal minimum')}<strong>{a.organization_minimum ? level(a.organization_minimum) : t('不适用', 'Not applicable')}</strong></div>{readOnly ? <p>{t('已选参考控制库：', 'Selected reference controls: ')}{frameworks.join(' / ')}</p> : <fieldset disabled={locked} className="grade-reference-controls"><label htmlFor="grade-framework">{t('希望参考哪套信息安全评估底稿？', 'Which security assessment reference would you like to use?')}</label><select id="grade-framework" value={frameworkMode} onChange={e => { const mode = e.target.value; setFrameworkMode(mode); setFrameworks([mode === 'auto' ? a.proposed_level === 1 ? 'MLPS_LEVEL_1' : a.proposed_level === 3 ? 'MLPS_LEVEL_3' : 'MLPS_LEVEL_2' : mode]) }}><option value="auto">{t('按初步建议等级匹配', 'Match the recommended grade')}</option><option value="MLPS_LEVEL_1">{t('MLPS 1级底稿', 'MLPS level 1 reference')}</option><option value="MLPS_LEVEL_2">{t('MLPS 2级底稿', 'MLPS level 2 reference')}</option><option value="MLPS_LEVEL_3">{t('MLPS 3级底稿', 'MLPS level 3 reference')}</option></select></fieldset>}</div></div></section>
    <section className="grade-causes grade-internal-rules"><h3>{t('系统分级依据', 'System grading basis')}</h3><p>{t('以下展示各项答案及其对应的等级依据。', 'The cards below show each answer and its contribution to the grade.')}</p><div className="grade-score-grid">{a.organization_rule_trace?.map(row => {
      const highest = row.level === a.organization_minimum
      const title = `${questions.find(q => q.key === row.field)?.id ?? ''} · ${internalTitle(row.field, row.subfield)}`
      return <article className={`grade-score-card${highest ? ' grade-driver' : ''}`} key={row.code}>
        <header><span>{title}</span>{highest && <b>{t('决定内部下限', 'Internal minimum driver')}</b>}</header>
        <h4>{questionText(row.field, row.subfield)}</h4>
        <div className="grade-score-reading"><span className="grade-score-answer"><small>{t('已选答案', 'Selected answer')}</small><b>{internalAnswer(row.field, row.answer, row.subfield)}</b></span><span className="grade-score-level"><small>{t('内部最低等级', 'Internal minimum grade')}</small><strong>{level(row.level)}</strong></span></div>
        <ul className="grade-answer-options" aria-label={`${internalTitle(row.field, row.subfield)} · ${t('全部选项', 'All options')}`}>{internalOptions(row.field, row.answer, row.subfield).map(option => <li key={`${typeof option.value}:${option.value}`} aria-current={option.value === row.answer ? 'true' : undefined}>
          <span>{option.label}{option.saved && <small className="grade-option-history">{t('已保存答案', 'Saved answer')}</small>}</span>
          {option.value === row.answer && <span className="grade-option-selected"><Check size={14} aria-hidden="true" />{t('已选', 'Selected')}</span>}
        </li>)}</ul>
        <p>{locale === 'zh' ? row.zh : row.en}</p>
        {!readOnly && <Button variant="text" disabled={locked} onClick={() => back(row.field)}>{t('查看或修改答案', 'View or edit answer')}<ArrowRight size={14} /></Button>}
      </article>
    })}{scoreRows.map(row => {
      const known = row.severity !== null && row.severity >= 0 && row.severity <= 3
      const highest = row.level !== null && row.level === a.base_level
      return <article className={`grade-score-card${highest ? ' grade-driver' : ''}`} key={row.field}><header><span>{code(row.field)} · {row.field.startsWith('info_') ? t('业务信息影响', 'Information impact') : t('系统服务影响', 'Service impact')}</span>{highest && <b>{t('决定矩阵等级', 'Matrix grade driver')}</b>}</header><h4>{questionText(row.field)}</h4><div className="grade-score-reading"><span className="grade-score-answer"><small>{t('已选答案', 'Selected answer')}</small><b>{severity(row.severity)}</b></span><span className="grade-score-level"><small>{t('对应等级', 'Mapped grade')}</small><strong>{row.level ? level(row.level) : known ? t('无定级贡献', 'No matrix grade contribution') : t('待核实', 'Unverified')}</strong></span></div>{known ? <><input type="range" min={0} max={3} step={1} value={row.severity!} disabled aria-label={`${code(row.field)} ${party(row.field)}`} aria-valuetext={severity(row.severity)} style={{ background: `linear-gradient(to right, ${highest ? '#2563eb' : '#7189ac'} ${(row.severity ?? 0) / 3 * 100}%, #dce5f2 ${(row.severity ?? 0) / 3 * 100}%)` }} /><div className="grade-score-ticks"><span>0 · {t('无侵害', 'None')}</span><span>1 · {t('一般', 'Minor')}</span><span>2 · {t('严重', 'Serious')}</span><span>3 · {t('特别严重', 'Extreme')}</span></div></> : <div className="grade-score-unknown">{t('未确定损害程度，不能按 0 分处理。', 'Unknown severity is not treated as zero.')}</div>}{notes[row.field] && <p className="grade-rationale"><b>{t('你的判断理由：', 'Your rationale: ')}</b>{notes[row.field]}</p>}{!readOnly && <Button variant="text" disabled={locked} onClick={() => back(row.field)}>{t('查看或修改答案', 'View or edit answer')}<ArrowRight size={14} /></Button>}</article>
    })}</div></section>
    {!!a.issues.length && <section className="grade-review-issues"><h3>{t('待补充与待复核', 'Missing information & review')}</h3>{a.issues.map((issue, i) => readOnly ? <p key={i}>{questions.find(q => q.key === issue.field)?.id} · {locale === 'zh' ? issue.zh : issue.en}</p> : <Button key={i} variant="secondary" disabled={locked} onClick={() => back(issue.field)}>{questions.find(q => q.key === issue.field)?.id} · {locale === 'zh' ? issue.zh : issue.en}<ArrowRight size={14} /></Button>)}</section>}
    {tooLow && <Notice>{t('所选参考库低于初步建议等级，请调整选择。', 'A selected reference library is below the proposed grade; update your selection.')}</Notice>}
    {(a.proposed_level ?? 0) > 3 && <Notice>{t('四级或五级须转专业复核，现有二级、三级参考库不覆盖完整要求。', 'Level 4 or 5 requires specialist review beyond the available reference libraries.')}</Notice>}
    {!readOnly && <footer className="grade-result-actions">{!readOnly && <Button variant="secondary" disabled={locked} onClick={() => back()}><ArrowLeft size={16} />{t('返回修改问卷', 'Edit questionnaire')}</Button>}<Button disabled={locked || !frameworks.length || a.status !== 'preliminary_complete' || (a.proposed_level ?? 0) > 3 || tooLow} onClick={confirm}>{early ? t('采用初步等级，继续填写其余问题', 'Use preliminary grade & complete remaining questions') : t('确认等级，继续审查应用说明', 'Confirm grade & review brief')}<ArrowRight size={16} /></Button></footer>}
  </div>
}
