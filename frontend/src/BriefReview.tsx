import NetworkTopology from './NetworkTopology'
import NarrativeRefinement from './NarrativeRefinement'
import factHeadings from '../../backend/app/data/prd_fact_headings.json'
import { isVisible, type Question } from './MLPSIntake'
import questionnaire from '../../backend/app/data/mlps_questionnaire.json'
import { useContext, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, CheckCheck, Plus, RotateCcw, Trash2, WandSparkles } from 'lucide-react'
import { Button, CheckLabel, Empty, ModeControl, Notice, PreferencesContext, useCommand } from './components'
import { briefFromQuestionnaire, gradingFacts, missingBriefFields } from './brief'
import { useLocale } from './i18n'
import type { Brief, SystemDetail } from './types'

export function BriefReviewPanel({ detail }: { detail: SystemDetail }) {
  const { t, locale } = useLocale()
  const navigate = useNavigate()
  const prefs = useContext(PreferencesContext)
  const incoming = detail.system.draft.proposal ?? (detail.system.context_revision_id ? detail.system.context : null)
  const incomingSnapshot = JSON.stringify(incoming)
  const [brief, setBrief] = useState<Brief>(() => ({ ...briefFromQuestionnaire(detail.system.classification.answers ?? {}), ...incoming }))
  const [reviewed, setReviewed] = useState(false)
  const [, refreshSaved] = useState(0)
  const { run, busy, error } = useCommand(detail)
  const snapshot = JSON.stringify(brief)
  const latest = useRef(brief)
  latest.current = brief
  const savedSnapshot = useRef(snapshot)
  const lastIncoming = useRef(incomingSnapshot)
  const ownSaves = useRef(new Set<string>())
  const inFlight = useRef<Promise<void> | null>(null)
  const blocks = detail.system.draft.blocks ?? {}
  const hasNotes = Object.values(blocks).some(value => value.trim())
  const hasBrief = !!incoming || !hasNotes
  const stale = !!detail.system.draft.proposal_stale
  const modelBusy = ['queued', 'running'].includes(detail.job?.state ?? '') && !detail.job?.kind.startsWith('function_expansion:')
  const classified = !!detail.system.classification.effective_level
  const canExpand = classified && ['DRAFT', 'CLASSIFYING', 'CONTEXT_REVIEW', 'CONTROL_REVIEW', 'PRD_REVIEW'].includes(detail.system.status)
  const canOrganize = classified && ['DRAFT', 'CLASSIFYING', 'CONTEXT_REVIEW'].includes(detail.system.status)
  const fields: Record<string, string> = {
    summary: t('目标摘要', 'Goal summary'), functions: t('功能需求', 'Functional requirements'),
    departments: t('涉及部门', 'Departments'), roles: t('使用和审批角色', 'Operating and approval roles'),
    owner_role: t('业务责任角色', 'Accountable business role'),
  }
  const missing = missingBriefFields(brief)
  const requiredMark = <span className="required-mark" aria-hidden="true">{t('必填', 'Required')}</span>
  const fieldIssue = (key: string) => missing.includes(key) ? <small className="required-error">{t('请补充', 'Please complete ')}{fields[key]}</small> : null
  const libraryBlocked = ['SYS-SCREEN/2', 'MLPS-INTAKE/1'].includes(detail.system.classification.scheme ?? '') && detail.system.classification.controls_ready !== true
  const requiredFrameworks = (detail.system.classification.missing_frameworks?.length ? detail.system.classification.missing_frameworks : detail.system.classification.frameworks ?? []).join(' / ')
  const previous = detail.system.classification.answers ?? {}
  const facts = gradingFacts(brief, previous)
  const modern = ['MLPS-TAGS/1', 'SYS-SCREEN/2', 'MLPS-INTAKE/1'].includes(detail.system.classification.scheme ?? '')
  const conflicts = modern ? Object.entries(brief.applicability_tags ?? {}).filter(([key, value]) => {
    const mapped = ({ personal_data: 'data.personal', production_admin: 'ops.production_admin' } as Record<string, string>)[key]
    return mapped && value !== 'unknown' && detail.system.classification.facts?.[mapped] !== value
  }) : Object.entries(facts).filter(([key, value]) => (previous[key] ?? 'unknown') !== value)
  const questionNames: Record<string, string> = {
    Q1: t('数据敏感度', 'Data sensitivity'), Q2: t('中断影响', 'Outage impact'),
    Q3: t('操作权限', 'Operational authority'), Q4: t('访问范围', 'Access exposure'), Q5: t('业务覆盖', 'Business reach'),
  }

  useEffect(() => {
    if (lastIncoming.current === incomingSnapshot) return
    lastIncoming.current = incomingSnapshot
    if (!incoming) return
    if (ownSaves.current.delete(JSON.stringify(incoming))) return
    const next = { ...briefFromQuestionnaire(detail.system.classification.answers ?? {}), ...incoming }
    setBrief(next)
    savedSnapshot.current = JSON.stringify(next)
    setReviewed(false)
  }, [incomingSnapshot])

  async function save(acknowledge = false) {
    if (inFlight.current) await inFlight.current
    const proposal = latest.current
    const next = JSON.stringify(proposal)
    if (incoming && savedSnapshot.current === next && !(acknowledge && stale)) return
    ownSaves.current.add(next)
    if (ownSaves.current.size > 20) ownSaves.current.delete(ownSaves.current.values().next().value!)
    const operation = run(`/systems/${detail.system.id}/context-draft`, {
      proposal, acknowledge_source_change: acknowledge,
    }, 'PUT').then(() => { savedSnapshot.current = next; refreshSaved(value => value + 1) })
    inFlight.current = operation
    try { await operation } finally { if (inFlight.current === operation) inFlight.current = null }
  }
  useEffect(() => {
    if (!hasBrief || modelBusy || savedSnapshot.current === snapshot) return
    const timer = setTimeout(() => { void save().catch(() => {}) }, 1000)
    return () => clearTimeout(timer)
  }, [snapshot, modelBusy, detail.system.version, hasBrief])
  function update<K extends keyof Brief>(key: K, value: Brief[K]) {
    setBrief(old => ({ ...old, [key]: value }))
    setReviewed(false)
  }
  async function expandFunction(functionId: string) {
    await save()
    const result = await run(`/systems/${detail.system.id}/jobs`, {
      kind: 'function_expansion', function_id: functionId, mode: 'openrouter',
      language: prefs.outputLanguage === 'auto' ? locale : prefs.outputLanguage,
    })
    return result.job_id as string
  }
  async function organize(mode = prefs.mode) {
    try {
      if (hasBrief) await save()
      await run(`/systems/${detail.system.id}/jobs`, {
        kind: 'context_organization', mode, language: prefs.outputLanguage === 'auto' ? locale : prefs.outputLanguage,
      })
      setReviewed(false)
    } catch { /* The localized command error preserves the editable brief. */ }
  }
  async function leave(destination: 'classification') {
    try { if (hasBrief) await save(); navigate(`/systems/${detail.system.id}/${destination}`) } catch { /* Preserve edits. */ }
  }
  async function confirm() {
    try {
      await save(reviewed)
      await run(`/systems/${detail.system.id}/context-confirmations`, { context: latest.current })
      navigate(`/systems/${detail.system.id}/controls`)
    } catch { /* Keep corrections and the review state visible. */ }
  }
  function questionGroup(key: string) {
    if (['system_owner', 'org_name', 'security_responsible_entity', 'user_types'].includes(key)) return 'roles'
    if (['system_scenarios', 'involves_transactions', 'available_workaround'].includes(key)) return 'workflow'
    if (key === 'system_functions') return 'functions'
    if (key === 'deployment_model') return 'security'
    if (['recovery_objectives_h', 'impact_after_4h', 'impact_after_24h', 'impact_after_72h'].includes(key)) return 'acceptance'
    if (['system_name', 'system_purpose', 'system_business_type', 'target_type', 'independent_business', 'service_geography', 'public_service_nature', 'critical_business'].includes(key)) return 'scope'
    if (['system_interaction', 'system_interfaces_description', 'external_connections_description', 'system_dependencies'].includes(key) || /^(data_|personal_|sensitive_|important_|core_|pi_|cross_border|registered_)/.test(key)) return 'data'
    return 'security'
  }
  function questionFacts(group: string) {
    const answers = detail.system.classification.answers ?? {}
    const rows = (questionnaire as Question[]).filter(q => !['system_interaction', 'independent_business', 'public_service_nature', 'system_functions', 'interconnected_system_level', 'external_dependency_impact', 'safety_impact'].includes(q.key) && q.kind !== 'severity' && isVisible(q, answers) && questionGroup(q.key) === group && !(q.kind === 'severity' && Number(answers[q.key]) === 0))
    const display = (value: unknown, q: Question): string => {
      if (value === undefined || value === null) return ''
      if (Array.isArray(value)) return value.map(item => display(item, q)).join(' / ')
      if (typeof value === 'object') return Object.entries(value).map(([key, item]) => `${key.toUpperCase()} · ${display(item, q)}`).join(' / ')
      const index = q.options?.indexOf(String(value)) ?? -1
      return locale === 'en' && index >= 0 ? q.options_en?.[index] ?? String(value) : String(value)
    }
    const classification = detail.system.classification
    return <dl className="prd-questionnaire-facts">{rows.map(q => {
      const notes = classification.notes ?? {}
      const heading = (factHeadings as Record<string, string[]>)[q.key]
      const label = heading ? heading[locale === 'zh' ? 0 : 1] : ''
      const value = q.key === 'security_responsible_entity' ? answers[q.key] === '是' ? notes[q.key] ?? '' : '' : display(answers[q.key], q)
      return <div key={q.key} data-source-question={q.id} data-source-field={q.key}><dt>{label}</dt><dd className="preserve-lines">{q.key === 'system_owner' ? <table><thead><tr><th>{t('部门', 'Department')}</th><th>{t('对接人', 'Contact')}</th></tr></thead><tbody>{(Array.isArray(answers[q.key]) ? answers[q.key] as unknown as string[] : []).map(department => <tr key={department}><td>{department === '其他' ? notes.system_owner || department : department}</td><td>{classification.department_contacts?.[department] ?? ''}</td></tr>)}</tbody></table> : value}</dd></div>
    })}</dl>
  }


  return <section className="brief-review">
    <div className="section-heading"><div><span className="eyebrow">02 / BRIEF REVIEW</span><h2>{t('产品需求说明书（PRD）初稿', 'Product requirements document (PRD) draft')}</h2><p className="muted">{t('沿用已填写的原文，只核对整理结果、补充遗漏和纠正偏差。确认后才匹配控制条目。', 'Use the notes already captured. Review the organized result, fill gaps, and correct interpretations. Controls are matched only after confirmation.')}</p></div><div className="page-heading-actions">{!hasBrief && canOrganize && hasNotes && <Button className="demo-action" variant="secondary" title={t('使用已保存描述生成规则草稿，随后审查并确认。', 'Build a rule-based draft from saved notes, then review and confirm.')} busy={busy || modelBusy} onClick={() => void organize('local')}><WandSparkles size={14} />{t('Demo：整理已有描述', 'Demo: organize saved notes')}</Button>}<span className="save-state"><i className={snapshot === savedSnapshot.current ? 'saved' : ''} />{busy ? t('保存中…', 'Saving…') : snapshot === savedSnapshot.current ? t('已保存', 'Saved') : t('修改未保存', 'Unsaved edits')}</span></div></div>
    {error && <Notice error>{error}</Notice>}
    {libraryBlocked && <Notice error>
      <strong>{t('下一步前置条件：已发布且匹配所选方案的控制库', 'Prerequisite: published controls matching the selected profile')}</strong>
      <p>{t('当前已确认的分类尚未就绪，无法匹配控制。请完成以下步骤：', 'The confirmed classification is not ready for control matching. Complete these steps:')} {requiredFrameworks} · {detail.system.classification.effective_level}</p>
      <ol>
        <li>{t('管理员：进入“控制条目库”，确保包含所选框架与等级方案的控制，点击“一键发布”；也可逐项审核保存后，通过“预览发布”→“确认发布”发布。', 'Administrator: open Control library, ensure it contains controls for the selected framework and level profile, then choose Publish now. Alternatively, review and save each item before Review publication → Confirm publication.')} <Link to="/library">{t('查看控制条目库', 'View control library')}</Link></li>
        <li>{t('经办人：保存本页修改，返回“确认等级”，先保存初筛草稿，再点击“加载最新控制库”，预览并重新确认初步分级。', 'Operator: save this brief and return to classification. Save the screening draft, load the latest library, preview and reconfirm the initial grading.')} <Button variant="text" busy={busy} onClick={() => void leave('classification')}>{t('保存说明并前往确认等级', 'Save brief & open classification')}</Button></li>
        <li>{t('返回本页，补齐标为“必填”的内容，勾选核对确认，再点击“确认说明并匹配控制”。', 'Return here, complete the required fields, check the review confirmation, then confirm the brief and match controls.')}</li>
      </ol>
      <p>{t('控制库发布后仍需重新确认分类，本页可以继续编辑和保存。', 'After publication, classification must still be reconfirmed. You can continue editing and saving this brief.')}</p>
    </Notice>}
    {!classified && <Notice error>{t('请先确认等级，再审查应用说明。', 'Confirm the system level before reviewing the brief.')} <Link to={`/systems/${detail.system.id}/classification`}>{t('前往确认等级', 'Confirm the level')}<ArrowRight size={14} /></Link></Notice>}
    {stale && <Notice>{t('原始描述已更新。这份整理结果需要重新核对：可重新整理，或修订下方内容并在最后确认已核对原文。', 'The original notes changed. Reorganize the brief, or revise the content below and explicitly confirm that you reviewed the updated source notes.')}</Notice>}
    {!hasBrief ? <div className="review-empty"><Empty title={t('从已有描述，整理应用说明。', 'Build the brief from your existing notes.')} description={t('无需重新填写八个主题。选择整理方式后，会生成可编辑的说明和待澄清事项；只有你确认后才生效。', 'No need to enter the eight topics again. Organize the existing notes into an editable brief and clarification list; your confirmation makes it effective.')}><ModeControl /><Button busy={busy || modelBusy} disabled={!hasNotes || !canOrganize} onClick={() => void organize()}><WandSparkles size={16} />{t('整理已有描述', 'Organize existing notes')}</Button></Empty>{!hasNotes && <p className="field-hint">{t('尚未提供原始描述。', 'No original notes yet.')} <Link to={`/systems/${detail.system.id}/classification`}>{t('前往分级问卷', 'Open grading questionnaire')}</Link></p>}</div> : <>
      <div className="review-layout"><div className="review-content"><h2>{detail.system.name}</h2><p>{t('产品需求说明书 · 审查草稿', 'Product requirements document · Review draft')}</p><header className="review-document-heading"><span className="eyebrow">PRD DRAFT / R{detail.system.revision}</span><span className="review-mode">{detail.system.draft.proposal_mode === 'openrouter' ? t('模型整理 · 待人工核对', 'MODEL DRAFT · HUMAN REVIEW') : detail.system.draft.proposal_mode === 'local' ? t('本地规则整理 · 待人工核对', 'LOCAL RULE DRAFT · HUMAN REVIEW') : !incoming ? t('问卷内容预填 · 待人工核对', 'QUESTIONNAIRE PREFILL · HUMAN REVIEW') : t('可编辑的审查说明', 'EDITABLE REVIEW BRIEF')}</span></header>
        <section className="review-section"><div className="review-section-title"><span>01</span><h3>{t('开发范围', 'Development scope')}</h3></div>{questionFacts('scope')}</section>
        <section className="review-section"><div className="review-section-title"><span>02</span><h3>{t('角色权限', 'Roles and permissions')}</h3></div>{questionFacts('roles')}</section>
        <section className="review-section" data-prd-section="03"><div className="review-section-title"><span>03</span><h3>{t('业务流程', 'Business workflows')}</h3></div>{questionFacts('workflow')}</section>
        <section className="review-section"><div className="review-section-title"><span>04</span><h3>{fields.functions} {requiredMark}</h3><span className="mono">{brief.functions.length}</span></div><p className="field-hint">{t('至少填写一项功能，每项功能名称必填。功能说明可选填。', 'Add at least one function. Each function name is required; descriptions are optional.')}</p>{fieldIssue('functions')}{brief.functions.map((item, index) => <div className="review-function" key={item.id}><div><span className="mono">{item.id.slice(0, 12)}</span><button className="icon-button" disabled={modelBusy} aria-label={`${t('删除功能', 'Remove function')} ${index + 1}`} onClick={() => update('functions', brief.functions.filter(value => value.id !== item.id))}><Trash2 size={14} /></button></div><label>{`${t('功能', 'Function')} ${index + 1}`}{requiredMark}<input required aria-label={`${t('功能', 'Function')} ${index + 1}`} aria-invalid={!item.title.trim()} disabled={modelBusy} value={item.title} onChange={event => update('functions', brief.functions.map(value => value.id === item.id ? { ...value, title: event.target.value } : value))} /></label><label>{t('功能说明', 'Function description')}<textarea disabled={modelBusy} rows={2} value={item.description} onChange={event => update('functions', brief.functions.map(value => value.id === item.id ? { ...value, description: event.target.value } : value))} /></label><NarrativeRefinement compact sourceRevision={detail.system.revision} disabled={modelBusy || !canExpand || !item.title.trim()} buttonLabel={t('AI 扩写功能说明', 'Expand description with AI')} topic="function_expansion" text={item.title + '\n\n' + item.description} value={item.description} start={() => expandFunction(item.id)} apply={description => update('functions', latest.current.functions.map(value => value.id === item.id ? { ...value, description } : value))} /></div>)}<Button variant="text" disabled={modelBusy} onClick={() => update('functions', [...brief.functions, { id: `F-${crypto.randomUUID().slice(0, 8)}`, title: '', description: '', source_blocks: [] }])}><Plus size={14} />{t('补充遗漏功能', 'Add a missing function')}</Button>{questionFacts('functions')}</section>
        <section className="review-section" data-prd-section="05"><div className="review-section-title"><span>05</span><h3>{t('数据接口', 'Data and interfaces')}</h3></div>{questionFacts('data')}</section>
        <section className="review-section" data-prd-section="06"><div className="review-section-title"><span>06</span><h3>{t('系统开发架构', 'System development architecture')}</h3></div>{questionFacts('security')}<NetworkTopology systemId={detail.system.id} images={detail.system.network_topology ?? []} /></section>
        <section className="review-section" data-prd-section="07"><div className="review-section-title"><span>07</span><h3>{t('安全开发需求', 'Security development requirements')}</h3></div><div className="security-development-blank" aria-label={t('安全开发需求留空', 'Security development requirements left blank')} /></section>
        <section className="review-section" data-prd-section="08"><div className="review-section-title"><span>08</span><h3>{t('SLA', 'SLA')}</h3></div>{questionFacts('acceptance')}</section>
        <section className="review-section" data-prd-section="09"><div className="review-section-title"><span>09</span><h3>{t('上线计划', 'Release plan')}</h3></div><label>{t('交付约束', 'Constraints')}<textarea disabled={modelBusy} rows={3} value={brief.constraints} onChange={event => update('constraints', event.target.value)} /></label>{questionFacts('release')}</section>
        
      </div><aside className="review-aside"><div className="review-readiness"><span className="eyebrow">REVIEW CHECKPOINT</span><h3>{t('确认前检查', 'Pre-confirmation checks')}</h3>{libraryBlocked && <p className="review-issue">{t('控制库待发布或分类待重新确认，请按页首步骤处理。', 'Controls need publication or classification needs reconfirmation. Follow the steps above.')}</p>}<div className="review-level"><span>{t('已确认等级', 'Confirmed level')}</span><strong>{detail.system.classification.effective_level ?? '—'}</strong></div><p className="field-hint">{t('审查和修改说明不会自动改变等级。', 'Reviewing or editing this brief never changes the level automatically.')}</p>{missing.length ? <div className="review-issue"><strong>{t('待补充必填内容', 'Required information missing')}</strong><ul>{missing.map(key => <li key={key}>{fields[key]}</li>)}</ul></div> : <p className="review-ready"><CheckCheck size={16} />{t('必填说明已完整', 'Required brief fields complete')}</p>}{conflicts.length ? <div className="review-issue"><strong>{t('分级依据存在差异', 'Grading facts differ')}</strong><ul>{conflicts.map(([key, value]) => <li key={key}>{questionNames[key] ?? key}: {previous[key] ?? t('未知', 'Unknown')} → {value}</li>)}</ul><Button variant="text" busy={busy} onClick={() => void leave('classification')}>{t('保存并核对等级', 'Save & review the level')}<ArrowRight size={14} /></Button></div> : <p className="review-ready"><CheckCheck size={16} />{t('未发现分级依据冲突', 'No grading fact conflict detected')}</p>}</div>
        <div className="review-questions"><span className="eyebrow">TO CLARIFY / {brief.questions.length}</span><h3>{t('待澄清事项', 'Open questions')}</h3>{brief.questions.length ? <><p className="field-hint">{t('先在说明中补充答案，再标记已补充；保留的问题会进入 PRD。', 'Add answers to the brief before resolving a question. Unresolved questions carry into the PRD.')}</p>{brief.questions.map((question, index) => <div className="review-question" key={`${index}-${question}`}><span className="mono">{String(index + 1).padStart(2, '0')}</span><p>{question}</p><button disabled={modelBusy} className="inline-action" onClick={() => update('questions', brief.questions.filter((_, item) => item !== index))}>{t('已补充到说明', 'Addressed in the brief')}</button></div>)}</> : <p className="field-hint">{t('当前未记录待澄清事项。', 'No open questions recorded.')}</p>}</div>
        <details className="review-regenerate"><summary><RotateCcw size={14} />{t('重新整理已有描述', 'Reorganize existing notes')}</summary><p className="field-hint">{t('重新整理会替换当前草稿及人工修改。需要保留的内容请先补充到原始描述；原文不会被覆盖。', 'Reorganizing replaces this proposal and manual edits. Add anything you need to preserve to the original notes first; those notes remain unchanged.')}</p><ModeControl /><Button variant="secondary" busy={busy || modelBusy} disabled={!hasNotes || !canOrganize} onClick={() => void organize()}><WandSparkles size={14} />{t('重新整理', 'Reorganize')}</Button>{!canOrganize && <Button variant="text" onClick={() => void leave('classification')}>{t('先重新确认等级', 'Reconfirm the level first')}<ArrowRight size={14} /></Button>}</details>
      </aside></div>
      <div className="stage-actions review-confirmation"><Button variant="secondary" busy={busy} onClick={() => void save().catch(() => {})}>{t('保存说明修改', 'Save brief edits')}</Button><CheckLabel required inputLabel={t('我已核对说明和职责', 'I reviewed the brief and responsibilities')} checked={reviewed} onChange={setReviewed}>{t('我已核对说明和职责', 'I reviewed the brief and responsibilities')}{requiredMark}</CheckLabel><Button busy={busy || modelBusy} disabled={!reviewed || !classified || !!missing.length || !!conflicts.length || libraryBlocked} onClick={() => void confirm()}><CheckCheck size={16} />{t('确认说明并匹配控制', 'Confirm brief & match controls')}</Button></div>
    </>}
  </section>
}

