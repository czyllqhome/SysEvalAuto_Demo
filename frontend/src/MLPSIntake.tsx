import gradingFields from '../../backend/app/data/mlps_grading_fields.json'
import type { DepartmentContact } from './types'
import { selectedImpactFields } from './impactSelection'
import MLPSGradeResult from './MLPSGradeResult'
import { createPortal } from 'react-dom'
import ImpactDimension from './ImpactDimension'
import DataCategoryOption from './DataCategoryOption'
import NarrativeRefinement from './NarrativeRefinement'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Check, FileText, Sparkles, Undo2 } from 'lucide-react'
import { api, ApiError } from './api'
import { Button, Notice, useCommand } from './components'
import { useLocale } from './i18n'
import type { SystemDetail } from './types'

type Value = Record<string, string | number> | string | number | string[] | Record<string, string>[] | Record<string, string>
type Answers = Record<string, Value>
export type Question = { id: string; key: string; zh: string; en: string; hint: string; hint_en: string; rule: string; kind: string; options: string[]; options_en: string[]; options_zh?: string[]; required: boolean; retired?: boolean; supporting_fields?: boolean; source_id?: string; parent_key?: string; policy_hint_zh?: string; policy_hint_en?: string; ai_topic?: string; range_groups?: Record<string, { values: string[]; zh: string[]; en: string[] }>; example_zh?: string; example_en?: string; legacy_options?: string[] }
type Draft = { department_contacts?: Record<string, DepartmentContact>; answers?: Answers; notes?: Record<string, string>; frameworks?: string[]; catalog_id?: string; evidence_assets?: { question: string; filename: string; content: string }[] }
type EvidenceRef = { id: string; filename: string; sha256: string }
function withoutEvidence<T>(value: T, ref: EvidenceRef): T {
  if (typeof value === 'string') return value.replaceAll(`${ref.filename} | evidence:${ref.id} | SHA-256:${ref.sha256}`, '').replaceAll(`evidence:${ref.id}`, '') as T
  if (Array.isArray(value)) return value.map(item => withoutEvidence(item, ref)) as T
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, withoutEvidence(item, ref)])) as T
  return value
}
type Settings = { demo_template?: Draft | null; questions: Question[]; saved: Draft; legacy: boolean; catalog_id: string; permissions: string[] }
type Issue = { code: string; field?: string; zh: string; en: string }
export type Assessment = { organization_minimum?: number | null; organization_rule_trace?: { code: string; field: string; subfield?: string; answer: string | number; level: number; zh: string; en: string }[]; status: string; base_level: number | null; proposed_level: number | null; business_information_level: number | null; system_service_level: number | null; special_principle_minimum: number | null; is_lower_bound_only: boolean; issues: Issue[]; alerts: Issue[]; rule_trace: { field: string; severity: number | null; level: number | null }[] }
type Result = { grading_assessment?: Assessment; assessment: Assessment; controls_ready: boolean }
const steps = [['GRADE', '优先定级', 'Grade first'], ['A', '系统概况', 'System overview'], ['B', '系统部署与连接', 'Deployment & connections'], ['C', '服务与规模', 'Service & scale'], ['D', '数据与个人信息', 'Data & privacy'], ['E', '业务连续性与影响分析', 'Business continuity & impact analysis']]
const compactGradingKeys = new Set(['security_responsible_entity', 'system_interaction', 'external_network_access', 'involves_transactions', 'public_service_nature', 'critical_business', 'data_security_classification', 'cross_border_data', 'external_dependency_impact', 'safety_impact'])

function personalInfoStatus(a: Answers) {
  const categories = a.data_categories as string[] | undefined
  if (Array.isArray(categories) && categories.length) {
    if (categories.includes('个人信息') || categories.includes('敏感个人信息')) return '是'
    return categories.includes('不确定') ? '不确定' : '否'
  }
  return '不确定'
}

export function isVisible(q: Question, a: Answers) {
  if (q.retired) return false
  const target = a.target_type
  if (['hosted_target_levels', 'platform_grade_evidence'].includes(q.key)) return ['云计算平台/系统', '通信网络设施'].includes(String(target))
  if (['large_pi_public_bigdata', 'bigdata_public_service_confirmed'].includes(q.key)) return target === '大数据平台/系统'
  if (q.key === 'special_target_boundary') return !!target && !['独立业务信息系统', '人工智能应用', '其他', '不确定'].includes(String(target))
  if (q.key === 'interconnected_system_level') return a.system_interaction === '是'
  if (q.key === 'personal_info_count_system') return personalInfoStatus(a) === '是'
  if (['personal_info_count_operator', 'pi_subject_scope'].includes(q.key)) return personalInfoStatus(a) !== '否'
  if (['sensitive_pi_types', 'sensitive_pi_count'].includes(q.key)) return (a.data_categories as string[] | undefined)?.includes('敏感个人信息') ?? false
  if (q.key === 'important_data_basis') return (a.data_categories as string[] | undefined)?.includes('重要数据') ?? false
  if (q.key === 'core_data_details') return (a.data_categories as string[] | undefined)?.includes('核心数据') ?? false
  return true
}
const filled = (v: Value | undefined) => v !== undefined && (typeof v !== 'string' || !!v.trim()) && (!Array.isArray(v) || v.length > 0)

export default function MLPSIntake({ detail, phase = 'all' }: { detail: SystemDetail; phase?: 'all' | 'grading' | 'information' | 'result' }) {
  const { t } = useLocale()
  const query = useQuery({ queryKey: ['mlps-intake', detail.system.id], queryFn: ({ signal }) => api<Settings>(`/systems/${detail.system.id}/mlps-intake`, { signal }) })
  if (query.error) return <Notice error>{t('问卷读取失败。', 'Could not load the questionnaire.')}<Button onClick={() => void query.refetch()}>{t('重试', 'Retry')}</Button></Notice>
  if (!query.data) return <p>{t('正在读取 MLPS 信息收集问卷…', 'Loading the MLPS questionnaire…')}</p>
  return <Editor key={`${detail.system.id}-${phase}`} detail={detail} settings={query.data} phase={phase} />
}

function Editor({ detail, settings, phase }: { detail: SystemDetail; settings: Settings; phase: string }) {
  const { t, locale, error: translate } = useLocale()
  const navigate = useNavigate()
  const client = useQueryClient()
  const { run, busy, error } = useCommand(detail)
  const [answers, setAnswers] = useState<Answers>(settings.saved.answers ?? { system_name: detail.system.name })
  const [notes, setNotes] = useState<Record<string, string>>(settings.saved.notes ?? {})
  const [contacts, setContacts] = useState<Record<string, DepartmentContact>>(settings.saved.department_contacts ?? {})
  const [frameworks, setFrameworks] = useState(settings.saved.frameworks ?? ['MLPS_LEVEL_2'])
  const [frameworkMode, setFrameworkMode] = useState('auto')
  const [earlyResult, setEarlyResult] = useState(false)
  const [step, setStep] = useState(phase === 'information' ? 1 : 0), [dirty, setDirty] = useState(false)
  const sectionHeading = useRef<HTMLDivElement>(null)
  const previousStep = useRef(step)
  useEffect(() => {
    if (previousStep.current === step) return
    previousStep.current = step
    sectionHeading.current?.scrollIntoView?.({ block: 'start', behavior: 'auto' })
  }, [step])
  const [impactInputRevision, setImpactInputRevision] = useState(0)
  const [demoUndo, setDemoUndo] = useState<{ keys: string[]; answers: Answers; notes: Record<string, string>; contacts: Record<string, DepartmentContact>; frameworks: string[] } | null>(null)
  const [result, setResult] = useState<Result | null>(null), [waiting, setWaiting] = useState(false), [problem, setProblem] = useState('')
  const sequence = useRef(0)
  const editable = settings.permissions.includes('edit')
  const locked = busy || waiting || !editable
  const [catalogId, setCatalogId] = useState(settings.catalog_id)
  const body = { scheme: 'MLPS-INTAKE/1', answers, notes, department_contacts: contacts, frameworks, catalog_id: catalogId }
  const lastSaved = useRef({ version: detail.system.version, body: JSON.stringify({
    scheme: 'MLPS-INTAKE/1', answers: settings.saved.answers, notes: settings.saved.notes,
    department_contacts: settings.saved.department_contacts, frameworks: settings.saved.frameworks, catalog_id: settings.saved.catalog_id,
  }) })
  let dataQuestionNumber = 0
  const visible = settings.questions.filter(q => !q.parent_key && isVisible(q, answers)).filter(q => q.kind !== 'severity' || q.key.endsWith('_rights_severity')).map(q => q.kind === 'severity' ? { ...q, id: q.key.startsWith('info_') ? 'E09' : 'E10' } : q.id.startsWith('D') ? { ...q, id: `D${String(++dataQuestionNumber).padStart(2, '0')}` } : q)
  const answered = (q: Question) => ['data_categories', 'system_interaction'].includes(q.key) ? filled(answers[q.key]) && settings.questions.filter(child => child.parent_key === q.key && isVisible(child, answers)).every(child => filled(answers[child.key])) : q.kind === 'recovery_targets' ? ['rto', 'rpo'].every(key => filled((answers[q.key] as Record<string, string | number> | undefined)?.[key])) : q.kind === 'volume_ranges' ? !!((answers[q.key] as Record<string, string> | undefined)?.records && (answers[q.key] as Record<string, string> | undefined)?.storage) : q.kind === 'severity' ? selectedImpactFields(q.key.startsWith('info_') ? 'info' : 'service', answers).length > 0 && selectedImpactFields(q.key.startsWith('info_') ? 'info' : 'service', answers).every(key => filled(answers[key])) : filled(answers[q.key])
  const progressQuestions = visible.filter(q => phase === 'grading' ? gradingFields.includes(q.key) : phase === 'information' ? !gradingFields.includes(q.key) : true)
  const complete = visible.filter(answered).length
  const progressComplete = progressQuestions.filter(answered).length
  const inStep = (q: Question, index: number) => index === 0 ? gradingFields.includes(q.key) : !gradingFields.includes(q.key) && q.id.startsWith(steps[index]?.[0] ?? '!')
  const gradeQuestions = settings.questions.filter(q => !q.retired && !q.parent_key && gradingFields.includes(q.key))
  const displayQuestion = (q: Question): Question => {
    if (phase === 'all') return q
    const parent = settings.questions.find(item => item.key === q.parent_key)
    const index = gradeQuestions.findIndex(item => item.key === (parent?.key ?? q.key))
    if (index >= 0) return { ...q, id: `G${String(index + 1).padStart(2, '0')}` }
    const section = (parent ?? q).id[0]
    const information = visible.filter(item => !gradingFields.includes(item.key) && item.id.startsWith(section))
    const position = information.findIndex(item => item.key === (parent?.key ?? q.key))
    return position < 0 ? q : { ...q, id: `${section}${String(position + 1).padStart(2, '0')}` }
  }
  const current = visible.filter(q => inStep(q, step))
  const questionGroups: Question[][] = []
  for (const question of current) {
    const compact = step === 0 && compactGradingKeys.has(question.key)
    const previous = questionGroups.at(-1)
    if (compact && previous && compactGradingKeys.has(previous[0].key)) previous.push(question)
    else questionGroups.push([question])
  }
  const change = () => { sequence.current++; setDirty(true); setResult(null); setEarlyResult(false); setProblem('') }
  const update = (key: string, value: Value) => { setAnswers(a => ({ ...a, [key]: value })); change() }
  useEffect(() => {
    const prevent = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault() }
    window.addEventListener('beforeunload', prevent)
    return () => window.removeEventListener('beforeunload', prevent)
  }, [dirty])
  async function save(rethrow = false, payload = body, skipUnchanged = false) {
    const serialized = JSON.stringify(payload)
    const latest = client.getQueryData<SystemDetail>(['system', detail.system.id]) ?? detail
    if (skipUnchanged && serialized === lastSaved.current.body && latest.system.version === lastSaved.current.version) {
      setDirty(false)
      return true
    }
    const seq = sequence.current
    try {
      const saved = await run(`/systems/${detail.system.id}/mlps-intake`, payload, 'PUT')
      lastSaved.current = { version: saved.system.version, body: serialized }
      client.setQueryData(['mlps-intake', detail.system.id], { ...settings, saved: payload })
      if (seq === sequence.current) setDirty(false)
      return true
    } catch (cause) { if (rethrow) throw cause; return false }
  }
  async function loadLatest() {
    setWaiting(true); setProblem('')
    try {
      const latest = await api<Settings>(`/systems/${detail.system.id}/mlps-intake?latest=true`)
      setCatalogId(latest.catalog_id); change(); setStep(phase === 'information' ? 1 : 0)
    } catch (error) { setProblem(translate(error instanceof ApiError ? error.code : 'NETWORK_ERROR')) }
    finally { setWaiting(false) }
  }
  async function preview() {
    setWaiting(true); setProblem('')
    const seq = sequence.current
    try { const data = await api<Result>(`/systems/${detail.system.id}/mlps-intake/preview`, { method: 'POST', body }); if (seq === sequence.current) { setResult(data); if (frameworkMode === 'auto') { setFrameworks([data.assessment.proposed_level === 1 ? 'MLPS_LEVEL_1' : data.assessment.proposed_level === 3 ? 'MLPS_LEVEL_3' : 'MLPS_LEVEL_2']); setDirty(true) } return true } }
    catch (e) { setProblem(translate(e instanceof ApiError ? e.code : 'NETWORK_ERROR')) }
    finally { setWaiting(false) }
    return false
  }
  useEffect(() => { if (phase === 'result') { setEarlyResult(true); void preview() } }, [])
  async function upload(q: Question, file: File) {
    if (file.size > 2 * 1024 * 1024) { setProblem(t('每份材料最多 2 MB。', 'Each file must be at most 2 MB.')); return }
    setWaiting(true)
    try {
      const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = reject; reader.readAsDataURL(file) })
      const response = await run(`/systems/${detail.system.id}/mlps-intake/evidence`, { question: q.key, filename: file.name, content: data }) as SystemDetail & { mlps_evidence: { id: string; filename: string; sha256: string } }
      const ref = response.mlps_evidence
      const line = `${ref.filename} | evidence:${ref.id} | SHA-256:${ref.sha256}`
      if (q.kind === 'evidence' || q.key === 'impact_evidence') setAnswers(a => ({ ...a, [q.key]: [a[q.key], line].filter(Boolean).join('\n') }))
      else setNotes(n => ({ ...n, [q.key]: [n[q.key], line].filter(Boolean).join('\n') }))
      change()
    } catch (e) { setProblem(translate(e instanceof ApiError ? e.code : 'NETWORK_ERROR')) } finally { setWaiting(false) }
  }
  async function removeEvidence(id: string) {
    setWaiting(true); setProblem('')
    try {
      const response = await run(`/systems/${detail.system.id}/mlps-intake/evidence-removals`, { evidence_id: id }) as SystemDetail & { mlps_evidence_removed: EvidenceRef }
      setAnswers(a => withoutEvidence(a, response.mlps_evidence_removed))
      setNotes(n => withoutEvidence(n, response.mlps_evidence_removed))
      setDemoUndo(null)
      void client.invalidateQueries({ queryKey: ['mlps-intake', detail.system.id] })
      change()
    } catch (e) { setProblem(translate(e instanceof ApiError ? e.code : 'NETWORK_ERROR')) }
    finally { setWaiting(false) }
  }
  function evidenceLinks(text: string, removable = false) {
    return [...new Set([...text.matchAll(/evidence:([a-f0-9-]{36})/g)].map(m => m[1]))].map(id => <span className="mlps-evidence-item" key={id}><a href={`/api/v1/systems/${detail.system.id}/mlps-intake/evidence/${id}`}>{t('下载已上传材料', 'Download uploaded evidence')} · {id.slice(0, 8)}</a>{removable && editable && <Button variant="text" disabled={locked} aria-label={`${t('移除材料', 'Remove evidence')} ${id.slice(0, 8)}`} onClick={() => void removeEvidence(id)}>{t('移除', 'Remove')}</Button>}</span>)
  }
  const field = (original: Question): ReactNode => {
    const q = displayQuestion(original)
    if (q.kind === 'severity') return <ImpactDimension key={`${q.key}-${impactInputRevision}`} code={q.id} dimension={q.key.startsWith('info_') ? 'info' : 'service'} answers={answers} notes={notes} update={(patch, rationale) => { setAnswers(old => { const next = { ...old }; for (const [key, value] of Object.entries(patch)) { if (value === undefined) delete next[key]; else next[key] = value }; return next }); if (rationale) setNotes(old => ({ ...old, ...rationale })); change() }} />
    const v = answers[q.key], title = locale === 'zh' ? q.zh : q.en
    const hint = q.kind === 'severity' ? t('0 为无侵害，9 为无法判断；1–3 是损害程度，不是等保等级。每项均需判断理由。', q.hint_en) : q.kind === 'enum' || q.kind === 'multi' ? t('按实际情况选择；尚未核实的信息请选择不确定。', q.hint_en) : (locale === 'zh' ? q.hint.replace(/^(long_text|text|integer|decimal|number|file\/链接)[，：； ]*/, '').replace(/boolean_3[； ]*/, '') : q.hint_en)
    const topology = q.key === 'network_zones_description'
    const selections = Array.isArray(v) ? v as string[] : []
    const rangeValues = v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, string> : {}
    const hasOther = q.kind === 'multi' && selections.includes('其他') || q.kind === 'enum' && v === '其他'
    const options = q.options.map((value, i) => ({ value, label: locale === 'zh' ? q.options_zh?.[i] ?? value : q.options_en[i] }))
    const oldChoices = q.kind === 'multi' ? selections : q.kind === 'enum' && (typeof v === 'string' || typeof v === 'number') ? [String(v)] : []
    for (const old of oldChoices) if (!options.some(o => o.value === old)) options.push({ value: old, label: `${old} (${t('历史答案', 'saved answer')})` })
    const columns: Record<string, string[]> = { hosted: ['hosted_system_name', 'confirmed_level', 'evidence'], loss: ['scenario', 'amount_rmb', 'basis'], workload: ['average', 'peak', 'unit'], volume: ['amount', 'unit'] }
    const labels: Record<string, string> = { hosted_system_name: t('承载系统名称', 'Hosted system'), confirmed_level: t('已确认等级（1–5）', 'Confirmed level (1–5)'), evidence: t('证据引用', 'Evidence reference'), scenario: t('事故情景', 'Scenario'), amount_rmb: t('金额（人民币）', 'Amount (RMB)'), basis: t('估计依据', 'Estimation basis'), average: t('日均量', 'Daily average'), peak: t('日峰值', 'Daily peak'), unit: t('单位', 'Unit'), amount: t('数量', 'Amount') }
    const Container = q.parent_key ? 'div' : 'article'
    return <Container className={`${q.parent_key ? 'mlps-subquestion' : 'mlps-question'} ${q.kind === 'severity' ? 'impact-question' : ''}`} key={q.key}>
      {!q.parent_key && <div className="mlps-question-meta"><span>{q.id}</span><span title={q.rule}>{q.rule === 'D' ? t('直接定级', 'Direct impact') : q.rule.includes('P') ? t('系统类型核查', 'System type check') : q.rule.includes('R') ? t('规则核查', 'Rule review') : q.rule.includes('T') ? t('风险提示', 'Risk alert') : t('系统情况', 'System information')}</span>{q.required && <span>{t('必填', 'Required')}</span>}</div>}
      <label id={`${q.key}-label`} htmlFor={q.key} className="mlps-question-title">{title}</label>
      {q.policy_hint_zh && <p className="field-hint">{locale === 'zh' ? q.policy_hint_zh : q.policy_hint_en}</p>}
      {!['enum', 'multi'].includes(q.kind) && <p className="field-hint" id={`${q.key}-hint`}>{hint || t('填写实际情况及责任归属。', 'Record the facts and responsibilities.')}</p>}
      {q.kind === 'enum' ? <select id={q.key} value={String(v ?? '')} onChange={e => update(q.key, ['registered_users', 'personal_info_count_system'].includes(q.key) && /^\d+$/.test(e.target.value) ? Number(e.target.value) : e.target.value)}><option value="">{t('请选择', 'Select an answer')}</option>{options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
        : q.kind === 'recovery_targets' ? <div className="mlps-recovery-targets">{['rto', 'rpo'].map(key => {
          const recovery = (v && typeof v === 'object' && !Array.isArray(v) ? v : {}) as Record<string, string | number>
          const value = recovery[key]
          const label = key === 'rto' ? t('RTO · 恢复服务的目标时间（小时）', 'RTO · Target time to restore service (hours)') : t('RPO · 最多可接受的数据丢失时长（小时）', 'RPO · Maximum acceptable data-loss window (hours)')
          return <div key={key}><label htmlFor={`recovery-${key}`}>{label}</label><div className="mlps-number"><input id={`recovery-${key}`} type="number" min={0} step="any" value={typeof value === 'number' ? value : ''} disabled={value === '不确定' || locked} onChange={e => update(q.key, { ...recovery, [key]: e.target.value === '' ? '' : Number(e.target.value) })} /><label><input aria-label={`${key.toUpperCase()} ${t('不确定', 'Unknown')}`} type="checkbox" checked={value === '不确定'} onChange={e => update(q.key, { ...recovery, [key]: e.target.checked ? '不确定' : '' })} />{t('不确定，待核实', 'Unknown, verify later')}</label></div></div>
        })}</div>
        : q.kind === 'volume_ranges' ? <div className="mlps-volume-ranges">{Object.entries(q.range_groups ?? {}).map(([key, group]) => <label key={key}>{key === 'records' ? t('业务记录数量范围', 'Business record count range') : t('数据容量范围（TB）', 'Storage volume range (TB)')}<select aria-label={key === 'records' ? t('业务记录数量范围', 'Business record count range') : t('数据容量范围（TB）', 'Storage volume range (TB)')} value={rangeValues[key] ?? ''} onChange={e => update(q.key, { ...rangeValues, [key]: e.target.value })}><option value="">{t('请选择', 'Select an answer')}</option>{group.values.map((value, i) => <option key={value} value={value}>{locale === 'zh' ? group.zh[i] : group.en[i]}</option>)}</select></label>)}{Array.isArray(answers.data_volume_records) && answers.data_volume_records.length > 0 && <details><summary>{t('查看原有数据量记录', 'View previous volume records')}</summary><p style={{ whiteSpace: 'pre-wrap' }}>{(answers.data_volume_records as Record<string, string>[]).map(row => `${row.amount ?? ''} ${row.unit ?? ''}`).join('\n')}</p></details>}</div>
        : q.kind === 'multi' ? <div className="mlps-options" role="group" aria-labelledby={`${q.key}-label`}>{options.map(o => ['data_categories', 'system_interaction'].includes(q.key) ? <DataCategoryOption key={o.value} value={o.value} label={o.label} checked={selections.includes(o.value)} onChange={checked => update(q.key, checked ? o.value === '不确定' ? ['不确定'] : [...selections.filter(x => x !== '不确定'), o.value] : selections.filter(x => x !== o.value))} /> : <label key={o.value}><input type="checkbox" checked={selections.includes(o.value)} onChange={e => { const old = selections; if (q.key === 'system_owner' && typeof v === 'string' && v.trim()) setNotes(n => ({ ...n, [q.key]: n[q.key] || v })); update(q.key, e.target.checked ? o.value === '不确定' ? ['不确定'] : [...old.filter(x => x !== '不确定'), o.value] : old.filter(x => x !== o.value)) }} />{o.label}</label>)}</div>
        : ['integer', 'number'].includes(q.kind) ? <div className="mlps-number"><input id={q.key} type="number" min={0} step={q.kind === 'integer' ? 1 : 'any'} value={typeof v === 'number' ? v : ''} disabled={v === '不确定' || locked} onChange={e => update(q.key, e.target.value === '' ? '' : Number(e.target.value))} /><label><input type="checkbox" checked={v === '不确定'} onChange={e => update(q.key, e.target.checked ? '不确定' : '')} />{t('不确定，待核实', 'Unknown, verify later')}</label></div>
        : columns[q.kind] ? <div className="mlps-records">{((v as Record<string, string>[] | undefined) ?? []).map((row, i, rows) => <div className="mlps-record" key={i}>{columns[q.kind].map(c => <label key={c}>{labels[c]}<input value={row[c] ?? ''} onChange={e => update(q.key, rows.map((r, j) => j === i ? { ...r, [c]: e.target.value } : r))} /></label>)}<Button variant="text" onClick={() => update(q.key, rows.filter((_, j) => j !== i))}>{t('移除此行', 'Remove row')}</Button></div>)}<Button variant="secondary" onClick={() => update(q.key, [...((v as Record<string, string>[] | undefined) ?? []), {}])}>{t('添加记录', 'Add record')}</Button></div>
        : q.ai_topic ? <NarrativeRefinement topic={q.ai_topic} text={String(v ?? '')} apply={text => update(q.key, text)} start={async () => {
          await save(true)
          const response = await run(`/systems/${detail.system.id}/jobs`, { kind: `narrative_refinement:${q.ai_topic}`, mode: 'openrouter', language: locale })
          return response.job_id!
        }}>{['system_functions', 'system_scenarios'].includes(q.key)
          ? <div className="mlps-records">{String(v ?? '').split('\n').map((line, index, lines) => {
              const isFunction = q.key === 'system_functions'
              const itemLabel = isFunction ? t('功能', 'Function') : t('场景', 'Scenario')
              return <div className="mlps-narrative-item" key={index}>
                <input id={index === 0 ? q.key : undefined} aria-label={index > 0 ? `${itemLabel} ${index + 1}` : undefined} value={line}
                  maxLength={Math.max(line.length, 10000 - String(v ?? '').length + line.length)}
                  onChange={e => update(q.key, lines.map((item, i) => i === index ? e.target.value : item).join('\n'))} />
                {lines.length > 1 && <Button variant="text" aria-label={`${t('移除', 'Remove')} ${itemLabel} ${index + 1}`} onClick={() => update(q.key, lines.filter((_, i) => i !== index).join('\n'))}>{t('移除', 'Remove')}</Button>}
              </div>
            })}<Button variant="secondary" disabled={!String(v ?? '').split('\n').slice(-1)[0]?.trim() || String(v ?? '').length >= 10000} onClick={() => update(q.key, `${v ?? ''}\n`)}>{q.key === 'system_functions' ? t('添加功能', 'Add function') : t('添加场景', 'Add scenario')}</Button></div>
          : <textarea id={q.key} maxLength={10000} rows={7} value={String(v ?? '')} onChange={e => update(q.key, e.target.value)} placeholder={t('简单描述本题内容，再点击 AI 优化描述。', 'Write a brief answer to this question, then choose Refine with AI.')} />}</NarrativeRefinement>
        : ['org_name', 'system_name'].includes(q.key) ? <input id={q.key} value={String(v ?? '')} onChange={e => update(q.key, e.target.value)} />
        : <textarea id={q.key} rows={q.kind === 'evidence' ? 3 : 4} value={String(v ?? '')} onChange={e => update(q.key, e.target.value)} placeholder={q.kind === 'evidence' ? t('粘贴受控材料编号或链接，或上传文件。', 'Enter a controlled document ID/link, or upload a file.') : t('根据实际情况填写；未知事项请明确说明。', 'Describe the facts and identify any unknowns.')} />}
      {settings.questions.filter(child => child.parent_key === q.key && isVisible(child, answers)).map(child => field(child))}
      {q.key === 'system_purpose' && answers.system_description && <details><summary>{t('查看拆分前的原始系统描述', 'View the original combined system description')}</summary><p style={{ whiteSpace: 'pre-wrap' }}>{String(answers.system_description)}</p></details>}
      {q.key === 'security_responsible_entity' && v === '是' && <label>{t('主要负责外部单位名称（必填）', 'Responsible external organization (required)')}<input maxLength={500} value={notes[q.key] ?? ''} onChange={e => { setNotes(n => ({ ...n, [q.key]: e.target.value })); change() }} placeholder={t('填写实际负责的外部单位全称', 'Enter the responsible external organization name')} /></label>}
      {q.key === 'system_owner' && selections.some(d => d !== '不确定') && <div className="mlps-department-contacts"><h4>{t('部门对接人', 'Department contacts')}</h4>{selections.filter(d => d !== '不确定').map(d => {
        const person = typeof contacts[d] === 'string' ? { name: contacts[d] as string } : contacts[d] ?? {}
        const departmentLabel = d === '其他' ? notes.system_owner || options.find(o => o.value === d)?.label || d : options.find(o => o.value === d)?.label ?? d
        return <fieldset key={d}><legend>{departmentLabel}</legend>{([
          ['name', '人员姓名', 'Person name'], ['organization', '所属部门/公司（外包）', 'Department / company (outsourced)'],
          ['title', '职务/职称', 'Position / title'], ['scope', '负责范围', 'Responsibilities'], ['contact_method', '联系方法', 'Contact method'],
        ] as const).map(([key, zh, en]) => <label key={key}>{t(zh, en)}<input aria-label={`${departmentLabel} · ${t(zh, en)}`} maxLength={500} value={person[key] ?? ''} onChange={e => { setContacts(c => ({ ...c, [d]: { ...(typeof c[d] === 'string' ? { name: c[d] as string } : c[d] ?? {}), [key]: e.target.value } })); change() }} /></label>)}</fieldset>
      })}</div>}
      {q.key === 'system_owner' && typeof v === 'string' && v.trim() && <p className="field-hint">{t('原有责任信息：', 'Previous responsibility information: ')}{v}</p>}
      {hasOther && <label>{q.key === 'system_owner' ? t('其他部门', 'Other department') : q.key === 'system_business_type' ? t('其他业务类型', 'Other business type') : t('其他选项说明', 'Specify other')}<input value={notes[q.key] ?? ''} onChange={e => { setNotes(n => ({ ...n, [q.key]: e.target.value })); change() }} /></label>}
      {topology && q.example_zh && <details className="mlps-answer-example"><summary>{t('填写参考（示例，须按实际情况确认）', 'Answer guidance (illustrative; verify actual facts)')}</summary><p>{locale === 'zh' ? q.example_zh : q.example_en}</p></details>}
      {q.kind === 'severity' && <label>{t('判断理由（必填）', 'Rationale (required)')}<textarea aria-label={`${q.id} ${t('说明与依据', 'Rationale')}`} rows={3} value={notes[q.key] ?? ''} onChange={e => { setNotes(n => ({ ...n, [q.key]: e.target.value })); change() }} /></label>}
      {topology && (answers.network_boundary_description || notes.network_boundary_description) && <details className="mlps-legacy-network"><summary>{t('查看拆分前的原始描述', 'View the original combined description')}</summary><p style={{ whiteSpace: 'pre-wrap' }}>{String(answers.network_boundary_description ?? '')}</p><p style={{ whiteSpace: 'pre-wrap' }}>{notes.network_boundary_description ?? ''}</p>{evidenceLinks(`${answers.network_boundary_description ?? ''}\n${notes.network_boundary_description ?? ''}`)}</details>}
      <div className="mlps-evidence">{topology && <label className="mlps-upload"><FileText size={14} />{t('附加材料', 'Attach evidence')}<input aria-label={`${q.id} ${t('上传材料', 'Upload evidence')}`} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.docx,.xlsx,.txt,.csv,.md" onChange={e => { if (e.target.files?.[0]) void upload(q, e.target.files[0]); e.target.value = '' }} /></label>}{evidenceLinks(`${typeof v === 'string' ? v : ''}\n${notes[q.key] ?? ''}`, true)}</div>
      {topology && editable && /evidence:/.test(`${v ?? ''}\n${notes[q.key] ?? ''}`) && <p className="field-hint">{t('移除后不再用于当前问卷和后续 PRD，历史文件保留；已确认的信息需重新确认。其他未保存内容请继续保存。', 'Removal excludes this file from the current questionnaire and future PRDs, retaining historical files. Confirmed information needs reconfirmation. Save any other unsaved edits separately.')}</p>}
    </Container>
  }
  async function fillDemo() {
    if (!settings.demo_template || locked) return
    const demo = structuredClone(settings.demo_template)
    const roots = new Set(current.map(q => q.key))
    const keys = settings.questions.filter(q => !q.retired && (phase === 'all' || phase === 'information' ? phase === 'all' || !gradingFields.includes(q.key) : roots.has(q.key) || roots.has(q.parent_key ?? ''))).map(q => q.key)
    const activeKeys = new Set(keys)
    const nextAnswers = { ...Object.fromEntries(Object.entries(answers).filter(([key]) => !activeKeys.has(key))), ...Object.fromEntries(Object.entries(demo.answers ?? {}).filter(([key]) => activeKeys.has(key))) }
    const nextNotes = { ...Object.fromEntries(Object.entries(notes).filter(([key]) => !activeKeys.has(key))), ...Object.fromEntries(Object.entries(demo.notes ?? {}).filter(([key]) => activeKeys.has(key))) }
    const nextContacts = activeKeys.has('system_owner') ? demo.department_contacts ?? {} : contacts
    setWaiting(true); setProblem('')
    try {
      for (const asset of phase === 'information' ? demo.evidence_assets ?? [] : []) {
        if (!activeKeys.has(asset.question)) continue
        const response = await run(`/systems/${detail.system.id}/mlps-intake/evidence`, asset) as SystemDetail & { mlps_evidence: EvidenceRef }
        const ref = response.mlps_evidence
        nextNotes[asset.question] = [nextNotes[asset.question], `${ref.filename} | evidence:${ref.id} | SHA-256:${ref.sha256}`].filter(Boolean).join('\n')
      }
      setDemoUndo({ keys, answers, notes, contacts, frameworks })
      setAnswers(nextAnswers); setNotes(nextNotes); setContacts(nextContacts)
      if (phase !== 'information') setImpactInputRevision(value => value + 1)
      if (phase === 'all') { setFrameworks(demo.frameworks ?? frameworks); setStep(0) }
      change()
      if (phase === 'information') await save(false, { ...body, answers: nextAnswers, notes: nextNotes, department_contacts: nextContacts })
    } catch (e) { setProblem(translate(e instanceof ApiError ? e.code : 'NETWORK_ERROR')) }
    finally { setWaiting(false) }
  }
  async function undoDemo() {
    if (!demoUndo || locked) return
    const restore = <T,>(now: Record<string, T>, before: Record<string, T>) => ({ ...Object.fromEntries(Object.entries(now).filter(([key]) => !demoUndo.keys.includes(key))), ...Object.fromEntries(Object.entries(before).filter(([key]) => demoUndo.keys.includes(key))) })
    const nextAnswers = restore(answers, demoUndo.answers), nextNotes = restore(notes, demoUndo.notes)
    setAnswers(nextAnswers); setNotes(nextNotes)
    if (phase !== 'information') setImpactInputRevision(value => value + 1)
    if (demoUndo.keys.includes('system_owner')) setContacts(demoUndo.contacts)
    if (phase === 'all') { setFrameworks(demoUndo.frameworks); setStep(0) }
    change(); setDemoUndo(null)
    if (phase === 'information') await save(false, { ...body, answers: nextAnswers, notes: nextNotes, department_contacts: demoUndo.contacts })
  }
  const demoActions = settings.demo_template && editable && phase !== 'result' ? <div className="mlps-demo-actions">{demoUndo && <Button variant="secondary" disabled={locked} onClick={undoDemo}><Undo2 size={15} />{t('撤销 Demo 填入', 'Undo Demo fill')}</Button>}<Button variant="secondary" disabled={locked || !!demoUndo} onClick={fillDemo}><Sparkles size={15} />{t('一键填入 Demo', 'Fill Demo answers')}</Button></div> : null
  const demoHost = document.getElementById(`assessment-demo-actions-${detail.system.id}`)
  const a = earlyResult ? result?.grading_assessment ?? result?.assessment : result?.assessment
  if ((earlyResult || step === steps.length) && a) return <section className="mlps-intake mlps-grade-screen">
    {demoHost ? createPortal(demoActions, demoHost) : demoActions}{editable && <Button variant="secondary" disabled={locked} onClick={() => void loadLatest()}>{t('加载最新控制库', 'Load latest controls')}</Button>}
    <div ref={sectionHeading} className="mlps-grade-anchor" />
    {(error || problem) && <Notice error>{error || problem}</Notice>}
    <MLPSGradeResult assessment={a} answers={answers} notes={notes} questions={settings.questions.map(q => displayQuestion({ ...q, id: visible.find(main => main.key === q.key)?.id ?? visible.find(main => main.key === q.parent_key)?.id ?? q.id }))} frameworks={frameworks} locked={locked}
      early={earlyResult} frameworkMode={frameworkMode} setFrameworkMode={setFrameworkMode}
      setFrameworks={values => { setFrameworks(values); setDirty(true) }}
      back={field => { if (phase === 'result') { navigate(`/systems/${detail.system.id}/classification`); return }; const q = settings.questions.find(q => q.key === field); setEarlyResult(false); setStep(q ? gradingFields.includes(q.key) ? 0 : Math.max(1, steps.findIndex(s => s[0] === q.id[0])) : earlyResult ? 0 : steps.length - 1) }}
      confirm={() => { if (earlyResult) { if (phase === 'result') { void save().then(ok => { if (ok) navigate(`/systems/${detail.system.id}/information`) }); return }; setEarlyResult(false); setStep(1); return }; void run(`/systems/${detail.system.id}/classification-confirmations`, body).then(() => { client.setQueryData(['mlps-intake', detail.system.id], { ...settings, saved: body }); setDirty(false); navigate(`/systems/${detail.system.id}/brief`) }).catch(() => {}) }} />
  </section>
  if (phase === 'result') return <section>{(error || problem) ? <Notice error>{error || problem}</Notice> : <p>{t('正在计算定级结果…', 'Calculating grade…')}</p>}<Button onClick={() => navigate(`/systems/${detail.system.id}/classification`)}>{t('返回系统定级', 'Back to grading')}</Button></section>
  return <section className="mlps-intake">
    {demoHost ? createPortal(demoActions, demoHost) : demoActions}{editable && <Button variant="secondary" disabled={locked} onClick={() => void loadLatest()}>{t('加载最新控制库', 'Load latest controls')}</Button>}
    <header className="mlps-header">{phase === 'information' ? <div><h2>{t('系统信息收集', 'System information collection')}</h2><p>{t('收集系统概况、部署连接、服务规模、数据处理及业务连续性信息，为安全评估和控制匹配提供依据。', 'Collect system overview, deployment and connections, service scale, data handling, and business continuity information to support security assessment and control matching.')}</p></div> : <div><span className="eyebrow">MLPS 2.0 / INFORMATION COLLECTION</span><h2>{t('从系统事实，到有依据的初步定级', 'From system facts to evidence-based grading')}</h2><p>{t('先回答影响等级的问题并查看初步等级，再补齐其余信息；确认应用说明后按等级匹配控制项。', 'Answer grading questions first, review the preliminary grade, then complete the remaining information. Match controls by grade after confirming the brief.')}</p></div>}</header>
    {settings.legacy && <Notice>{t('旧版分级分类答案已保留。请按新问卷重新填报，保存变更会产生修订并使后续结果待重新确认。', 'Legacy answers are preserved. Complete this new questionnaire; saving changes creates a revision and requires downstream reconfirmation.')}</Notice>}
    {(error || problem) && <Notice error>{error || problem}</Notice>}
    <div className="mlps-layout"><aside className="mlps-rail"><div className="mlps-progress"><strong>{progressComplete}<small> / {progressQuestions.length}</small></strong><span>{t('已填写问题', 'Questions answered')}</span><progress value={progressComplete} max={progressQuestions.length} /></div><nav aria-label={t('问卷章节', 'Questionnaire sections')}>{steps.map(([code, zh, en], i) => { if (phase === 'grading' && i !== 0 || phase === 'information' && i === 0) return null; const qs = visible.filter(q => inStep(q, i)); const count = qs.filter(answered).length; return <button key={code} onClick={() => setStep(i)} aria-current={step === i ? 'step' : undefined} className={step === i ? 'active' : ''}><span className="mlps-step-letter">{count === qs.length && count > 0 ? <Check size={15} /> : i === 0 ? '1' : code}</span><span>{t(zh, en)}<small>{count} / {qs.length}</small></span></button> })}</nav><p>{t('规则草稿 · 不调用模型', 'Rule-based draft · No model call')}</p></aside>
    <main className="mlps-main"><div ref={sectionHeading} className="mlps-section-heading"><span className="eyebrow">{step < steps.length ? `${steps[step][0]} / ${phase === 'information' ? '05 TOPICS' : phase === 'grading' ? 'GRADING' : '06 STEPS'}` : 'REVIEW / MATRIX'}</span><h3>{step < steps.length ? t(steps[step][1], steps[step][2]) : t('检查信息与初步定级', 'Review information and preliminary grade')}</h3>{step === 0 && <p>{t('分别选择受侵害客体和损害程度，取矩阵最高等级。未核实的客体仍按未知处理。', 'Choose affected parties and severities; use the highest matrix grade. Unverified parties remain unknown.')}</p>}</div>
    <fieldset disabled={locked} className="mlps-fields">
      {questionGroups.map(group => step === 0 && compactGradingKeys.has(group[0].key) ? <div className="mlps-grading-compact" key={group[0].key}>{group.map(field)}</div> : group.map(field))}
    </fieldset>
    <footer className="mlps-footer"><span role="status">{step === steps.length - 1 && progressComplete < progressQuestions.length ? t(`还有 ${progressQuestions.length - progressComplete} 个问题待填写`, `${progressQuestions.length - progressComplete} questions remain`) : dirty ? t('有未保存更改', 'Unsaved changes') : t('草稿已载入 / 已保存', 'Draft loaded / saved')}</span><div><Button variant="secondary" disabled={step === (phase === 'information' ? 1 : 0) || locked} onClick={() => setStep(step - 1)}><ArrowLeft size={15} />{t('上一步', 'Back')}</Button><Button variant="secondary" disabled={locked || !frameworks.length} onClick={() => void save()}>{t('保存草稿', 'Save draft')}</Button>{phase === 'all' && step < steps.length - 1 && <Button variant="secondary" disabled={locked || !frameworks.length || complete < visible.length} onClick={async () => { if (await save() && await preview()) setStep(steps.length) }}>{t('查看系统等级', 'View system grade')}<ArrowRight size={15} /></Button>}{step < steps.length && <Button disabled={locked || !frameworks.length || step === steps.length - 1 && complete < visible.length} onClick={async () => { if (await save(false, body, true)) { if (step === 0) { if (phase === 'grading') navigate(`/systems/${detail.system.id}/grade-result`); else if (await preview()) setEarlyResult(true) } else if (phase === 'information' && step === steps.length - 1) { try { await run(`/systems/${detail.system.id}/information-confirmations`, body); setDirty(false); navigate(`/systems/${detail.system.id}/controls`) } catch { /* Validation errors remain visible for correction. */ } } else if (step < steps.length - 1 || await preview()) setStep(step + 1) } }}>{step === 0 ? t('先计算系统等级', 'Calculate grade first') : phase === 'information' && step === steps.length - 1 ? t('确认系统信息', 'Confirm system information') : step === steps.length - 1 ? t('下一步：查看系统等级', 'Next: view system grade') : t('保存并继续', 'Save & continue')}<ArrowRight size={15} /></Button>}</div></footer></main></div>
  </section>
}
