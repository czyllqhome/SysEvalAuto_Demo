import { selectedImpactFields } from './impactSelection'
import { useState } from 'react'
import { X } from 'lucide-react'
import { Button } from './components'
import { useLocale } from './i18n'

type Choice = { value: string; zh: string; en: string; detailZh: string; detailEn: string }
const objects: Choice[] = [
  { value: 'rights', zh: '个人和企业的合法权益', en: 'Individual / organizational rights', detailZh: '例如会员隐私、消费者权益、合同权益、员工权益或企业资产受到损害。', detailEn: 'For example harm to member privacy, consumer rights, contracts, employee rights or company assets.' },
  { value: 'public', zh: '社会秩序或公共利益', en: 'Public order / public interests', detailZh: '影响超出个人或企业自身，波及社会公共秩序、公共服务或公共安全。面向消费者提供服务不自动代表存在此类侵害。', detailEn: 'Harm extending beyond individual or business interests to public order, services or safety. Serving consumers alone does not establish this impact.' },
  { value: 'national', zh: '国家安全', en: 'National security', detailZh: '有现实依据的事故情景会危害国家安全。不能仅凭国际品牌、全国业务或政府客户来判断。', detailEn: 'A credible incident scenario threatens national security. International branding, nationwide operations or government customers alone are not sufficient.' },
]
const severities: Choice[] = [
  { value: '0', zh: '无侵害', en: 'No harm', detailZh: '经核实，该事故情景不会侵害所选客体；需要说明理由。不参与最高等级计算。', detailEn: 'The scenario does not harm this party, after verification. Explain why; this does not contribute a matrix grade.' },
  { value: '1', zh: '一般损害', en: 'Minor harm', detailZh: '业务能力局部下降，但主要功能仍基本可用；损失较低，影响范围有限。', detailEn: 'Limited reduction in business capability; main functions largely remain available, with relatively low losses and limited scope.' },
  { value: '2', zh: '严重损害', en: 'Serious harm', detailZh: '业务能力明显下降，主要功能受到严重影响；损失较高，影响范围较广。', detailEn: 'Significant reduction in capability; main functions are seriously affected, with higher losses and broader impact.' },
  { value: '3', zh: '特别严重损害', en: 'Particularly serious harm', detailZh: '业务能力严重下降或主要功能无法执行；损失极高，或造成大范围、极严重后果。', detailEn: 'Severe loss of capability or unavailable main functions, with extremely high losses or widespread, extremely serious consequences.' },
  { value: '9', zh: '无法判断', en: 'Unknown', detailZh: '信息或依据不足，暂时无法确定损害程度。只展示已知等级下限，不能形成完整建议。', detailEn: 'Insufficient information to determine severity. Only a known lower bound may be shown; the recommendation remains incomplete.' },
]

function ExplainedSelect({ id, label, choices, value, onChange, disabledValues = [], disabled = false }: {
  id: string; label: string; choices: Choice[]; value: string; onChange: (value: string) => void; disabledValues?: string[]; disabled?: boolean
}) {
  const { t, locale } = useLocale()
  return <div className="impact-select"><div className="impact-select-label"><label htmlFor={id}>{label}</label></div>
    <select id={id} disabled={disabled} value={value} onChange={e => onChange(e.target.value)}><option value="">{t('请选择', 'Select an answer')}</option>{choices.map(c => <option key={c.value} value={c.value} disabled={disabledValues.includes(c.value)}>{locale === 'zh' ? `${c.zh} — ${c.detailZh}` : `${c.en} — ${c.detailEn}`}</option>)}</select>
    {value && <p className="impact-selected-explanation">{locale === 'zh' ? choices.find(c => c.value === value)?.detailZh : choices.find(c => c.value === value)?.detailEn}</p>}
  </div>
}

export default function ImpactDimension({ dimension, code, answers, notes, update }: {
  dimension: 'info' | 'service'; code: string; answers: Record<string, unknown>; notes: Record<string, string>;
  update: (answers: Record<string, number | string | undefined>, notes?: Record<string, string>) => void
}) {
  const { t, locale } = useLocale()
  const field = (obj: string) => `${dimension}_${obj}_severity`
  const [subjects, setSubjects] = useState<string[]>(() => {
    const selected = selectedImpactFields(dimension, answers).map(key => key.split('_')[1])
    return selected.length ? selected : ['']
  })
  return <article className="mlps-question impact-dimension">
    <div className="mlps-question-meta"><span>{code}</span><span>{t('直接定级', 'Direct impact')}</span><span>{t('必填', 'Required')}</span></div>
    <h3>{dimension === 'info' ? t('业务信息被泄露、篡改或丢失后，会影响谁？', 'Who is harmed by information disclosure, tampering or loss?') : t('系统服务中断或失效后，会影响谁？', 'Who is harmed by service interruption or failure?')}</h3>
    <p>{t('请选择受影响的客体和损害程度，并填写判断理由。', 'Choose the affected party and severity, then explain your judgment.')}</p>
    {subjects.map((obj, index) => <div className="impact-pair" key={`${index}-${obj}`}>
      <ExplainedSelect id={`${dimension}-object-${index}`} label={`${t('受侵害客体', 'Affected party')} ${index + 1}`} choices={objects} value={obj} disabledValues={subjects.filter((_, i) => i !== index)} onChange={next => {
        setSubjects(old => old.map((v, i) => i === index ? next : v))
        update({ ...(obj ? { [field(obj)]: undefined } : {}), ...(next ? { [field(next)]: typeof answers[field(next)] === 'number' ? answers[field(next)] as number : '' } : {}) })
      }} />
      <ExplainedSelect id={`${dimension}-severity-${index}`} label={`${t('损害程度', 'Severity')} ${index + 1}`} choices={severities} disabled={!obj} value={obj ? String(answers[field(obj)] ?? '') : ''} onChange={v => {
        if (obj) update({ [field(obj)]: v === '' ? '' : Number(v) })
      }} />
      {obj && <label className="impact-rationale">{t('判断理由（必填）', 'Rationale (required)')}<textarea rows={3} aria-label={`${code} ${locale === 'zh' ? objects.find(o => o.value === obj)?.zh : objects.find(o => o.value === obj)?.en} ${t('判断理由', 'rationale')}`} value={notes[field(obj)] ?? ''} onChange={e => update({}, { [field(obj)]: e.target.value })} /></label>}
      {subjects.length > 1 && <Button variant="text" onClick={() => { setSubjects(subjects.filter((_, i) => i !== index)); if (obj) update({ [field(obj)]: undefined }) }}><X size={14} />{t('移除此项判断', 'Remove judgment')}</Button>}
    </div>)}

  </article>
}
