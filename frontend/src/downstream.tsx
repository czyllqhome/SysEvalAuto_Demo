import SupplierResponseList from './SupplierResponseList'
import SupplierReviewSummary from './SupplierReviewSummary'
import { answerComplete, blankAnswer } from './supplierAnswers'
import { supplierDemoAnswer } from './supplierDemo'
export { answerComplete } from './supplierAnswers'
import PrdPreview from './PrdPreview'
import { useQuery } from '@tanstack/react-query'
import { api } from './api'
import DemoFill from './DemoFill'
import { useContext, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowDownToLine, ArrowRight, Check, CheckCheck, Copy, FileCheck2, FileText, LockKeyhole, Pencil, Plus, RefreshCw, Send, ShieldCheck } from 'lucide-react'
import { Button, CheckLabel, Empty, JobNotice, Modal, ModeControl, Notice, PreferencesContext, useAuth, useCommand } from './components'
import { useLocale } from './i18n'
import type { Answer, Decision, Finding, Requirement, SystemDetail } from './types'

function ModeStamp({ mode }: { mode: string }) {
  const { t } = useLocale()
  return <span className={`mode-stamp ${mode === 'openrouter' ? 'model' : ''}`}>{mode === 'openrouter' ? 'OPENROUTER' : mode === 'manual' ? t('人工修订', 'HUMAN REVISION') : t('本地规则草稿', 'LOCAL RULE-BASED DRAFT')}</span>
}
export function PrdPanel({ detail }: { detail: SystemDetail }) {
  const { t, locale } = useLocale()
  const { user } = useAuth()
  const prefs = useContext(PreferencesContext)
  const navigate = useNavigate()
  const { run, busy, error } = useCommand(detail)
  const [reviewed, setReviewed] = useState(false)
  const [withdrawOpen, setWithdrawOpen] = useState(false)
  const [origin, setOrigin] = useState('all')
  const [editing, setEditing] = useState<Requirement | null>(null)
  const [documentEdit, setDocumentEdit] = useState<NonNullable<SystemDetail['prd']>['data'] | null>(null)
  const [editPrdId, setEditPrdId] = useState('')
  const [editSearch, setEditSearch] = useState('')
  const prd = detail.prd
  async function generate() {
    try { await run(`/systems/${detail.system.id}/jobs`, { kind: 'prd_generation', mode: prefs.mode, language: prefs.outputLanguage === 'auto' ? locale : prefs.outputLanguage }) } catch { /* Displayed below. */ }
  }
  async function approve() {
    try { await run(`/systems/${detail.system.id}/prd-approval`); setReviewed(false) } catch { /* Displayed below. */ }
  }
  async function edit() {
    if (!editing || !prd) return
    try { await run(`/systems/${detail.system.id}/prd-versions`, { data: { ...prd.data, requirements: prd.data.requirements.map(item => item.id === editing.id ? editing : item) } }); setEditing(null); setReviewed(false) } catch { /* Preserve edits. */ }
  }
  if (user.role === 'vendor' && detail.round) return <SupplierPanel detail={detail} />
  if (!prd) return <><Empty title={detail.job?.state === 'failed' ? t('PRD 生成未完成，可修正后重试', 'PRD generation did not complete. Review the error and retry.') : detail.system.status === 'PRD_GENERATING' ? t('正在将范围整理为需求文档', 'Turning the scope into a requirements document') : t('这里将形成完整 PRD', 'Your complete PRD will take shape here')} description={t('合并已确认的业务说明、等级、例外和控制要求，同时校验业务与控制覆盖。', 'Combine the confirmed brief, classification, exceptions, and controls; validate business and control coverage.')} >{user.role !== 'vendor' && <><ModeControl /><Button busy={busy || ['queued', 'running'].includes(detail.job?.state ?? '')} onClick={() => void generate()}><FileText size={16} />{t('生成 PRD 文档', 'Generate the PRD')}</Button></>}</Empty>{error && <Notice error>{error}</Notice>}</>
  const requirements = prd.data.requirements.filter(item => origin === 'all' || item.origin === origin || item.origin === 'both')
  const businessCoverage = new Set(prd.data.requirements.flatMap(r => r.source_context_item_ids)).size
  const controlCoverage = new Set(prd.data.requirements.flatMap(r => r.source_control_ids)).size
  return <section><div className="section-heading"><div><span className="eyebrow">PRD REVIEW</span><h2>{t('PRD 审查与确认', 'PRD review and approval')}</h2><p className="muted">{t('每项业务功能和每条控制，都保留来源与验收条件。', 'Every business function and control retains its source and acceptance criteria.')}</p></div><div className="controls-heading-actions">{user.role !== 'vendor' && detail.system.status === 'PRD_REVIEW' && (!detail.permissions || detail.permissions.some(p => p === 'edit' || p === 'manage')) && <Button variant="secondary" disabled={busy} onClick={() => { setDocumentEdit(structuredClone(prd.data)); setEditPrdId(prd.id); setEditSearch('') }}><Pencil size={16} />{t('修改 PRD', 'Edit PRD')}</Button>}{user.role !== 'vendor' && detail.system.status === 'PRD_REVIEW' && (!detail.permissions || detail.permissions.some(p => p === 'edit' || p === 'manage')) && <Button variant="secondary" disabled={busy} onClick={() => setWithdrawOpen(true)}>{t('撤销并返回控制审查', 'Withdraw and review controls')}</Button>}{user.role !== 'vendor' && detail.system.status === 'PRD_REVIEW' && (!detail.permissions || detail.permissions.some(p => p === 'edit' || p === 'manage')) && <Button variant="secondary" disabled={busy} onClick={async () => { try { await run(`/systems/${detail.system.id}/prd-versions`, { refresh_template: true, prd_id: prd.id }); setReviewed(false) } catch { /* Displayed below. */ } }}>{t('应用当前模板（新修订）', 'Apply current template (new revision)')}</Button>}<a className="button secondary" href={`/api/v1/systems/${detail.system.id}/prd-versions/${prd.id}/document`}><ArrowDownToLine size={16} />{t('下载 PRD', 'Download PRD')}</a></div></div>{error && <Notice error>{error}</Notice>}<div className="prd-layout"><article className="prd-paper"><header className="prd-preview-meta"><ModeStamp mode={prd.mode} /><span className="mono muted">{prd.id.slice(0, 8).toUpperCase()} / {prd.language === 'zh' ? 'ZH–CN' : 'EN'} / REV. {detail.system.revision}</span></header><PrdPreview systemId={detail.system.id} prdId={prd.id} /><details className="prd-requirement-editor"><summary>{t('逐项需求审查与编辑', 'Review and edit individual requirements')}</summary><div className="document-section"><span className="document-number">03</span><div className="requirements-section"><div className="requirements-heading"><h3>{t('需求与验收', 'Requirements & acceptance')}</h3><select aria-label={t('需求来源', 'Requirement source')} value={origin} onChange={e => setOrigin(e.target.value)}><option value="all">{t('全部来源', 'All sources')}</option><option value="business">{t('业务功能', 'Business')}</option><option value="control">{t('控制要求', 'Controls')}</option></select></div>{requirements.map(item => <div className="requirement" key={item.id}><div className="requirement-heading"><span className="mono">{item.id}</span><span className="origin-label">{item.origin === 'business' ? t('业务功能', 'BUSINESS') : item.origin === 'control' ? t('控制要求', 'CONTROL') : t('混合来源', 'COMBINED')}</span>{user.role !== 'vendor' && detail.system.status === 'PRD_REVIEW' && <button className="icon-button" aria-label={`${t('编辑', 'Edit')} ${item.id}`} onClick={() => setEditing(structuredClone(item))}><Pencil size={14} /></button>}</div><h4>{item.title}</h4><p>{item.description}</p><div className="criteria"><strong>{t('验收条件', 'Acceptance criteria')}</strong>{item.acceptance_criteria.map((criterion, i) => <p key={i}><Check size={13} />{criterion}</p>)}</div><div className="source-trace"><span>{t('来源', 'Source')}</span>{[...item.source_context_item_ids, ...item.source_control_ids].map(source => <code key={source}>{source.length > 16 ? source.slice(0, 8) : source}</code>)}</div></div>)}</div></div></details></article><aside className="document-aside"><span className="eyebrow">COVERAGE AT A GLANCE</span><h3>{t('双重来源覆盖', 'Business and control coverage')}</h3><div className="coverage-stat"><strong>{businessCoverage}<small>/ {detail.system.context.functions?.length ?? businessCoverage}</small></strong><span>{t('本期业务功能', 'IN-SCOPE FUNCTIONS')}</span></div><div className="coverage-stat"><strong>{controlCoverage}<small>/ {detail.controls.filter(c => c.included).length || controlCoverage}</small></strong><span>{t('纳入控制要求', 'INCLUDED CONTROLS')}</span></div><hr /><p>{t('业务需求不必附会控制编号；控制要求不能遗漏。', 'Business requirements do not need an artificial control mapping. Selected controls cannot be omitted.')}</p><p className="field-hint">{t('界面切换不会翻译已保存的文档。输出语言在生成时选择。', 'Changing the interface language does not translate a saved document. Choose its language when generating.')}</p><span className="approval-label">{prd.approved ? <><Check size={16} />{t('客户已审查确认', 'CUSTOMER APPROVED')}</> : <>{t('等待客户审查', 'AWAITING CUSTOMER REVIEW')}</>}</span></aside></div>
    {user.role !== 'vendor' && detail.system.status === 'PRD_REVIEW' && <div className="stage-actions">{!prd.approved ? <><CheckLabel checked={reviewed} onChange={setReviewed}>{t('我已核对业务范围、控制来源与验收条件', 'I reviewed scope, sources, and acceptance criteria')}</CheckLabel><Button disabled={!reviewed} busy={busy} onClick={() => void approve()}><CheckCheck size={16} />{t('确认 PRD', 'Approve PRD')}</Button></> : <Button onClick={() => navigate(`/systems/${detail.system.id}/supplier`)}>{t('下发给供应商', 'Send to supplier')}<ArrowRight size={16} /></Button>}</div>}
    {documentEdit && <Modal wide title={t('手动修改 PRD', 'Edit PRD manually')} close={() => { if (!busy) setDocumentEdit(null) }}>
      {error && <Notice error>{error}</Notice>}
      {prd.id !== editPrdId && <Notice error>{t('文档已更新，请关闭后重新打开修改。', 'The document changed. Close and reopen the editor.')}</Notice>}
      <label>{t('文档标题', 'Document title')}<input value={documentEdit.title} onChange={e => setDocumentEdit({ ...documentEdit, title: e.target.value })} /></label>
      <label>{t('摘要', 'Summary')}<textarea rows={4} value={documentEdit.summary} onChange={e => setDocumentEdit({ ...documentEdit, summary: e.target.value })} /></label>
      <label>{t('查找要修改的需求', 'Find a requirement to edit')}<input type="search" value={editSearch} placeholder={t('输入编号、标题或内容', 'Search ID, title or description')} onChange={e => setEditSearch(e.target.value)} /></label>
      {documentEdit.requirements.map((item, index) => ({ item, index })).filter(({ item }) => `${item.id} ${item.title} ${item.description}`.toLowerCase().includes(editSearch.toLowerCase())).map(({ item, index }) => <details className="prd-edit-item" key={item.id}><summary>{item.id} · {item.title}</summary><fieldset className="prd-manual-requirement" key={item.id}><legend>{item.id}</legend>
        <label>{t('需求标题', 'Requirement title')}<input value={item.title} onChange={e => setDocumentEdit({ ...documentEdit, requirements: documentEdit.requirements.map((r, i) => i === index ? { ...r, title: e.target.value } : r) })} /></label>
        <label>{t('需求描述', 'Description')}<textarea rows={3} value={item.description} onChange={e => setDocumentEdit({ ...documentEdit, requirements: documentEdit.requirements.map((r, i) => i === index ? { ...r, description: e.target.value } : r) })} /></label>
        <label>{t('验收条件，每行一个', 'Acceptance criteria, one per line')}<textarea rows={3} value={item.acceptance_criteria.join('\n')} onChange={e => setDocumentEdit({ ...documentEdit, requirements: documentEdit.requirements.map((r, i) => i === index ? { ...r, acceptance_criteria: e.target.value.split('\n') } : r) })} /></label>
      </fieldset></details>)}
      <label>{t('前提假设，每行一个', 'Assumptions, one per line')}<textarea rows={3} value={documentEdit.assumptions.join('\n')} onChange={e => setDocumentEdit({ ...documentEdit, assumptions: e.target.value.split('\n') })} /></label>
      <label>{t('待澄清问题，每行一个', 'Open questions, one per line')}<textarea rows={3} value={documentEdit.open_questions.join('\n')} onChange={e => setDocumentEdit({ ...documentEdit, open_questions: e.target.value.split('\n') })} /></label>
      <p className="field-hint">{t('保存为新版本，保留来源引用，保存后需重新确认 PRD。', 'Save as a new revision with source references retained. Approval is required again.')}</p>
      <div className="modal-actions"><Button variant="secondary" disabled={busy} onClick={() => setDocumentEdit(null)}>{t('取消', 'Cancel')}</Button><Button busy={busy} disabled={prd.id !== editPrdId} onClick={async () => { try { await run(`/systems/${detail.system.id}/prd-versions`, { data: documentEdit }); setDocumentEdit(null); setReviewed(false) } catch { /* Keep authored edits. */ } }}>{t('保存新修订', 'Save revision')}</Button></div>
    </Modal>}
    {withdrawOpen && <Modal title={t('确认撤销当前 PRD', 'Confirm PRD withdrawal')} close={() => { if (!busy) setWithdrawOpen(false) }}>
      {error && <Notice error>{error}</Notice>}
      <p>{t('撤销后将返回控制审查，可增减控制条目。当前 PRD 保留为历史版本，不再用于下发；调整范围后必须重新生成并审核 PRD。', 'Return to control review to add or remove controls. The current PRD remains in history and cannot be assigned. Generate and approve a new PRD after changing the scope.')}</p>
      <div className="modal-actions"><Button variant="secondary" disabled={busy} onClick={() => setWithdrawOpen(false)}>{t('取消', 'Cancel')}</Button><Button busy={busy} onClick={async () => { try { await run(`/systems/${detail.system.id}/prd-withdrawal`, { prd_id: prd.id }); setWithdrawOpen(false); setReviewed(false); navigate(`/systems/${detail.system.id}/controls`) } catch { /* Keep confirmation open and show the error. */ } }}>{t('确认撤销', 'Confirm withdrawal')}</Button></div>
    </Modal>}
    {editing && <Modal title={`${t('编辑需求', 'Edit requirement')} · ${editing.id}`} close={() => setEditing(null)} wide>{error && <Notice error>{error}</Notice>}<label>{t('需求标题', 'Requirement title')}<input value={editing.title} onChange={e => setEditing({ ...editing, title: e.target.value })} /></label><label>{t('需求描述', 'Description')}<textarea rows={5} value={editing.description} onChange={e => setEditing({ ...editing, description: e.target.value })} /></label><label>{t('验收条件，每行一个', 'Acceptance criteria, one per line')}<textarea rows={5} value={editing.acceptance_criteria.join('\n')} onChange={e => setEditing({ ...editing, acceptance_criteria: e.target.value.split('\n') })} /></label><p className="field-hint">{t('保存为新的 PRD 版本，需要重新审查确认。来源引用保持不变。', 'Saves a new PRD version requiring approval again. Source references remain unchanged.')}</p><div className="modal-actions"><Button variant="secondary" onClick={() => setEditing(null)}>{t('取消', 'Cancel')}</Button><Button busy={busy} onClick={() => void edit()}>{t('保存新修订', 'Save revision')}</Button></div></Modal>}
  </section>
}


export function SupplierPanel({ detail }: { detail: SystemDetail }) {
  const { t, locale } = useLocale()
  const { user } = useAuth()
  const { run, busy, error } = useCommand(detail)
  const [supplierName, setSupplierName] = useState(''), [email, setEmail] = useState(''), [invite, setInvite] = useState('')
  const [supplierId, setSupplierId] = useState('')
  const suppliers = useQuery({ queryKey: ['supplier-candidates', detail.system.id], queryFn: () => api<{ id: string; name: string }[]>(`/systems/${detail.system.id}/supplier-candidates`), enabled: user.role !== 'vendor' && !detail.round })
  const [copied, setCopied] = useState(false), [bulkOpen, setBulkOpen] = useState(false)
  const [responsePage, setResponsePage] = useState<'business' | 'control'>('business')
  const [alreadyJoined, setAlreadyJoined] = useState(false)
  const [bulk, setBulk] = useState<Answer>({ ...blankAnswer(), implementation_status: 'yes' })
  const [answers, setAnswers] = useState<Record<string, Answer>>(detail.round?.draft ?? {})
  const savedSnapshot = useRef(JSON.stringify(detail.round?.draft ?? {}))
  const saving = useRef(false)
  const [saved, setSaved] = useState(false)
  const beforeDemo = useRef(answers)
  const roundId = detail.round?.id
  useEffect(() => { setAnswers(detail.round?.draft ?? {}); savedSnapshot.current = JSON.stringify(detail.round?.draft ?? {}); setSaved(false) }, [roundId])
  const editable = user.role === 'vendor' && detail.round?.status === 'open' && detail.system.status === 'VENDOR_FILLING'
  const serverAnswers = JSON.stringify(detail.round?.draft ?? {})
  useEffect(() => {
    if (!editable) setAnswers(detail.round?.draft ?? {})
  }, [serverAnswers, editable])
  const snapshot = JSON.stringify(answers)
  async function save() {
    if (!detail.round || saving.current) return undefined
    saving.current = true
    try {
      const result = await run(`/systems/${detail.system.id}/supplier-draft`, { answers, round_version: detail.round.version }, 'PUT')
      savedSnapshot.current = snapshot; setSaved(true)
      return result
    } finally { saving.current = false }
  }
  useEffect(() => {
    if (!editable || snapshot === savedSnapshot.current) return
    setSaved(false)
    const timer = setTimeout(() => { void save().catch(() => {}) }, 1400)
    return () => clearTimeout(timer)
  }, [snapshot, detail.system.version, editable, busy])
  async function publish() {
    try {
      const result = await run(`/systems/${detail.system.id}/supplier-rounds`, supplierId ? { supplier_user_id: supplierId } : { supplier_name: supplierName, email })
      setInvite(result.invite_token ? `${window.location.origin}/invite/${result.invite_token}` : '')
    } catch { /* Displayed below. */ }
  }
  async function reissue() {
    try {
      const result = await run(`/systems/${detail.system.id}/supplier-invitations`)
      setInvite(result.invite_token ? `${window.location.origin}/invite/${result.invite_token}` : '')
      setAlreadyJoined(!!result.existing_supplier)
    } catch { /* Display the localized command error. */ }
  }
  async function submit() {
    try {
      const savedDetail = await save()
      await run(`/systems/${detail.system.id}/supplier-submit`, { answers, round_version: savedDetail?.round?.version ?? detail.round?.version,
        language: locale })
      window.location.assign(`/systems/${detail.system.id}/impact`)
    } catch { /* Preserve form contents. */ }
  }
  const requirements = detail.prd?.data.requirements ?? []
  const complete = requirements.filter(item => answerComplete(answers[item.id])).length
  const responseGroups = { business: requirements.filter(item => item.origin !== 'control'), control: requirements.filter(item => item.origin !== 'business') }
  const update = (id: string, values: Partial<Answer>) => setAnswers(old => ({ ...old, [id]: { ...(old[id] ?? blankAnswer()), ...values } }))
  const labels = { yes: t('可实现', 'Can implement'), partial: t('部分实现', 'Partial implementation'), no: t('无法实现', 'Cannot implement'), needs_clarification: t('需要澄清', 'Needs clarification') }
  if (!detail.prd) return <Empty title={t('先形成可审查的 PRD', 'Generate a reviewable PRD first')} />
  return <section><div className="section-heading"><div><span className="eyebrow">SUPPLIER RESPONSES</span><h2>{t('供应商答复', 'Supplier responses')}</h2><p className="muted">{user.role !== 'vendor' ? t('通过站内任务协同，邀请链接由你分享，不会自动发送邮件。', 'Collaborate through an assigned task. Share the invite yourself; no email is sent automatically.') : t('可以完成的需求直接勾选；有例外或需澄清时填写说明，可补充补偿措施和预计天数，提交后由负责人判断。', 'Check requirements you can deliver. Explain exceptions or clarification needs, optionally add compensating measures and estimated workdays, then submit for the accountable owner to review.')}</p></div><div className="page-heading-actions">{editable && <DemoFill key={roundId} disabled={busy} apply={() => { beforeDemo.current = answers; setAnswers(Object.fromEntries(requirements.map(r => [r.id, supplierDemoAnswer(r, locale)]))) }} undo={() => setAnswers(beforeDemo.current)} />}{detail.round && <span className="round-badge mono">{t('轮次', 'ROUND')} / {detail.round.id.slice(0, 6).toUpperCase()}</span>}</div></div>{error && <Notice error>{error}</Notice>}{detail.round?.instructions && <Notice><strong>{t('本轮协商要求', 'Requested changes this round')}</strong><p className="preserve-lines">{detail.round.instructions}</p></Notice>}
    {user.role !== 'vendor' && !detail.round && <div className="publish-layout"><div className="publish-letter"><span className="eyebrow">SUPPLIER TASK</span><h3>{t('下发供应商任务', 'Assign supplier review')}</h3><p>{t('供应商会看到已发布的 PRD 和对应业务说明，填写每项需求的交付承诺。', 'The supplier sees the published PRD and business brief and responds to each requirement.')}</p><div className="publish-count"><strong>{requirements.length}</strong><span>{t('项需求等待回应', 'requirements awaiting a response')}</span></div></div><div className="paper-panel"><h3>{t('指定供应商', 'Assign a supplier')}</h3>{!detail.prd.approved && <Notice>{t('下发前需要先确认 PRD。', 'Approve the PRD before publication.')}</Notice>}<label>{t('选择供应商账号', 'Select supplier account')}<select value={supplierId} onChange={e => setSupplierId(e.target.value)}><option value="">{t('通过邮箱邀请外部供应商', 'Invite external supplier by email')}</option>{suppliers.data?.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>{suppliers.error && <Notice error>{t('供应商账号加载失败，请刷新重试。', 'Could not load supplier accounts. Refresh to retry.')}</Notice>}{!supplierId && <><label>{t('供应商名称', 'Supplier organization')}<input value={supplierName} onChange={e => setSupplierName(e.target.value)} /></label><label>{t('供应商确认人邮箱', 'Supplier approver email')}<input type="email" value={email} onChange={e => setEmail(e.target.value)} /></label></>}<Button busy={busy} disabled={!detail.prd.approved || (!supplierId && (!supplierName.trim() || !email.includes('@')))} onClick={() => void publish()}><Send size={16} />{supplierId ? t('下发供应商任务', 'Assign supplier task') : t('发布任务并生成邀请', 'Publish task & create invitation')}</Button></div></div>}
    {user.role !== 'vendor' && detail.round && <><div className="supplier-assignment"><span className="assignment-check"><Check size={22} /></span><div><h3>{detail.round.status === 'open' ? t('任务已下发，等待供应商填写。', 'The task is assigned. Awaiting the supplier.') : t('供应商答复已保存。', 'The supplier response has been saved.')}</h3><p>{t('供应商在独立账号下填写和确认，双方承诺保留不同身份。', 'The supplier responds and confirms from a separate account, preserving distinct approval identities.')}</p></div></div>{detail.round.status === 'open' && !invite && <Button variant="secondary" busy={busy} onClick={() => void reissue()}><RefreshCw size={15} />{t('生成新的邀请链接', 'Generate a new invitation link')}</Button>}{alreadyJoined && <Notice>{t('供应商已建立账号，可直接登录查看任务。', 'The supplier already has an account and can sign in to view the task.')}</Notice>}{invite && <div className="invite-box"><label>{t('邀请链接（请复制分享）', 'Invitation link — copy and share')}<input readOnly value={invite} onFocus={e => e.target.select()} /></label><Button variant="secondary" onClick={() => { void navigator.clipboard.writeText(invite).then(() => setCopied(true)).catch(() => setCopied(false)) }}><Copy size={15} />{copied ? t('已复制', 'Copied') : t('复制链接', 'Copy link')}</Button><p>{t('邀请有效期为 7 天。此链接仅在本次发布后显示，请妥善分享。', 'The invitation expires in seven days. Save and share the link shown after publication.')}</p></div>}{detail.round.status !== 'open' && <Link className="button primary" to={`/systems/${detail.system.id}/impact`}>{t('查看复核结果', 'Review supplier responses')}<ArrowRight size={16} /></Link>}</>}
    {detail.round && <><nav className="response-toolbar" aria-label={t('答复分类', 'Response categories')}><div>{(['business', 'control'] as const).map(kind => <Button key={kind} variant={responsePage === kind ? 'primary' : 'secondary'} aria-pressed={responsePage === kind} onClick={() => { setResponsePage(kind) }}>{kind === 'business' ? t('业务功能', 'Business functions') : t('控制需求', 'Control requirements')} · {responseGroups[kind].filter(item => answerComplete(answers[item.id])).length} / {responseGroups[kind].length}</Button>)}</div></nav><div className="response-toolbar"><div><strong>{t('需求答复', 'Requirement responses')}</strong><span>{complete} / {requirements.length} {t('已完成', 'complete')}</span><span>{requirements.filter(r => !answers[r.id]).length} / {requirements.length} {t('未填写', 'unanswered')}</span></div>{editable && <Button variant="secondary" onClick={() => setBulkOpen(true)}><Plus size={15} />{t('批量填写空白答复', 'Fill blank responses')}</Button>}</div>{!editable && user.role !== 'vendor' && detail.round.status === 'open' ? <Empty title={t('供应商尚未提交', 'No supplier submission yet')} description={t('请将邀请链接分享给供应商。对方提交后，此处将显示具体承诺。', 'Share the invitation with the supplier. Their commitments appear here after submission.')} /> : <SupplierResponseList key={responsePage} requirements={responseGroups[responsePage]} domains={detail.prd.requirement_domains ?? {}} highRiskIds={detail.prd.high_risk_requirements ?? []} heading={<><h2>{detail.prd.data.title}</h2><p>{detail.prd.data.summary}</p><details><summary>{t('查看完整 PRD 模板文档', 'View the complete PRD document')}</summary><PrdPreview systemId={detail.system.id} prdId={detail.prd.id} /></details></>} answers={answers} editable={!!editable} update={update} />}
    {editable && <><p className="field-hint">{t('勾选可完成即可完成答复；部分完成、无法完成或需澄清项须填写说明，由负责人审查。预计天数及补偿措施可补充。', 'Checking Can deliver completes the response. Partial, unavailable and clarification responses need an explanation for owner review. Workdays and compensating measures are optional.')}</p><div className="stage-actions"><span className="save-state">{saved ? t('草稿已保存', 'Draft saved') : t('答复可继续修改', 'Responses remain editable')}</span>{complete !== requirements.length && <span role="status">{t('尚有未完整填写的答复：', 'Incomplete responses: ')}{requirements.length - complete}</span>}<Button variant="secondary" busy={busy} onClick={() => void save().catch(() => {})}>{t('保存草稿', 'Save draft')}</Button><Button busy={busy} disabled={complete !== requirements.length} onClick={() => void submit()}><Send size={15} />{t('提交答复', 'Submit responses')}</Button></div></>}
    </>}
    {bulkOpen && <Modal title={t('为尚未填写的需求批量填入承诺', 'Apply a commitment to blank responses')} close={() => setBulkOpen(false)}><Notice>{t('只填入尚未编辑的答复。你仍需逐条检查，批量填写不等于已经实现。', 'Only untouched responses are filled. Review every requirement; applying a response is not proof of implementation.')}</Notice><label>{t('可实现性', 'Feasibility')}<select value={bulk.implementation_status} onChange={e => setBulk({ ...bulk, implementation_status: e.target.value as Answer['implementation_status'] })}>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>{bulk.implementation_status !== 'yes' && <><label>{t('限制或澄清（必填）', 'Limitations or clarification (required)')}<textarea rows={3} value={bulk.limitations} onChange={e => setBulk({ ...bulk, limitations: e.target.value })} /></label><label>{t('补偿性措施（选填）', 'Compensating measures (optional)')}<textarea rows={2} value={bulk.alternative} onChange={e => setBulk({ ...bulk, alternative: e.target.value })} /></label><label>{t('预计天数（工作日，选填）', 'Estimated workdays (optional)')}<input type="number" min="1" max="10000" value={bulk.duration_workdays ?? ''} onChange={e => setBulk({ ...bulk, duration_workdays: e.target.value ? Number(e.target.value) : null })} /></label></>}<div className="modal-actions"><Button disabled={!answerComplete(bulk)} onClick={() => { setAnswers(old => Object.fromEntries(requirements.map(r => [r.id, old[r.id] ?? { ...bulk }]))); setBulkOpen(false) }}>{t('填入空白答复', 'Apply to blank responses')}</Button></div></Modal>}
  </section>
}

function ImpactFindingDetail({ inline, title, close, children }: { inline: boolean; title: string; close: () => void; children: React.ReactNode }) {
  const content = <div className="impact-detail">{children}</div>
  return inline ? content : <Modal wide title={title} close={close}>{content}</Modal>
}

export function ImpactPanel({ detail }: { detail: SystemDetail }) {
  const { t } = useLocale()
  const { user } = useAuth()
  const [expanded, setExpanded] = useState(false)
  const [negotiating, setNegotiating] = useState(false)
  const [reason, setReason] = useState('')
  const { run, busy, error } = useCommand(detail)
  const navigate = useNavigate()
  const review = detail.supplier_review
  if (!review) return <ImpactDecisions detail={detail} />
  const canReview = user.role !== 'vendor' && (!detail.permissions || detail.permissions.some(p => ['review', 'manage'].includes(p)))
  async function negotiate() {
    try {
      await run(`/systems/${detail.system.id}/negotiation-rounds`, { reason })
      navigate(`/systems/${detail.system.id}/supplier`)
    } catch { /* Preserve the requested changes. */ }
  }
  return <>
    <SupplierReviewSummary key={review.submission_id} review={review} />
    {user.role === 'vendor' && <Notice>{t('答复已提交，等待负责人审查。', 'Responses submitted. Awaiting owner review.')}</Notice>}
    {error && <Notice error>{error}</Notice>}
    {canReview && !detail.report && ['RESULT_REVIEW', 'NEGOTIATING'].includes(detail.system.status) && <div className="stage-actions"><Button variant="secondary" onClick={() => setNegotiating(true)}>{t('发起新一轮协商', 'Open another response round')}</Button></div>}
    {(user.role !== 'vendor' || detail.report) && <details className="commitment-next" open={expanded} onToggle={e => setExpanded(e.currentTarget.open)}><summary>{t('后续审查与双方确认', 'Further review and joint confirmation')}</summary>{expanded && <>{detail.job?.kind === 'impact_analysis' && <JobNotice detail={detail} />}<ImpactDecisions detail={detail} /></>}</details>}
    {negotiating && <Modal title={t('明确新一轮需要调整什么', 'Specify what needs to change')} close={() => setNegotiating(false)}><label>{t('修改要求和沟通结论', 'Requested changes and discussion outcome')}<textarea rows={5} value={reason} onChange={e => setReason(e.target.value)} /></label><div className="modal-actions"><Button busy={busy} disabled={!reason.trim()} onClick={() => void negotiate()}>{t('开启新的填写轮次', 'Open a new response round')}</Button></div></Modal>}
  </>
}

function ImpactDecisions({ detail }: { detail: SystemDetail }) {
  const { t, locale } = useLocale()
  const { user } = useAuth()
  const prefs = useContext(PreferencesContext)
  const { run, busy, error } = useCommand(detail)
  const navigate = useNavigate()
  const report = detail.report
  const [decisions, setDecisions] = useState<Record<string, Decision>>(() => Object.fromEntries((report?.data.findings ?? []).map(item => [item.id, report?.decisions[item.id] ?? { decision: '', reason: '' }])))
  const [exceptionReason, setExceptionReason] = useState(report?.decisions._exceptions?.reason ?? '')
  const [bulkReason, setBulkReason] = useState(''), [filter, setFilter] = useState('all')
  const [negotiation, setNegotiation] = useState(false), [negotiationReason, setNegotiationReason] = useState('')
  const [riskNotes, setRiskNotes] = useState<Record<string, { impact: string; recommendation: string }[]>>({})
  const [riskBusy, setRiskBusy] = useState('')
  const [riskError, setRiskError] = useState('')
  async function analyzeRisk(id: string) {
    setRiskBusy(id); setRiskError('')
    try {
      const result = await api<{ findings: { impact: string; recommendation: string }[] }>(`/systems/${detail.system.id}/requirement-risk`, { method: 'POST', body: { version: detail.system.version, report_id: report?.id, requirement_id: id, language: locale } })
      setRiskNotes(old => ({ ...old, [id]: result.findings }))
    } catch { setRiskError(t('单条风险分析失败，请重试；如报告已更新，请刷新页面。', 'Risk analysis failed. Retry, or refresh if the report changed.')) }
    finally { setRiskBusy('') }
  }
  const [activeFinding, setActiveFinding] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  useEffect(() => { setDecisions(Object.fromEntries((report?.data.findings ?? []).map(item => [item.id, report?.decisions[item.id] ?? { decision: '', reason: '' }]))); setExceptionReason(report?.decisions._exceptions?.reason ?? ''); setDirty(false) }, [report?.id])
  async function retry(mode = prefs.mode) {
    try { await run(`/systems/${detail.system.id}/jobs`, { kind: 'impact_analysis', mode, language: prefs.outputLanguage === 'auto' ? locale : prefs.outputLanguage }) } catch { /* Displayed below. */ }
  }
  async function review() {
    try { await run(`/systems/${detail.system.id}/review-decisions`, { decisions, exception_reason: exceptionReason }); setDirty(false) } catch { /* Preserve decisions. */ }
  }
  async function freeze() {
    try { await run(`/systems/${detail.system.id}/baselines`); navigate(`/systems/${detail.system.id}/agreement`) } catch { /* Displayed below. */ }
  }
  async function negotiate() {
    try { await run(`/systems/${detail.system.id}/negotiation-rounds`, { reason: negotiationReason }); setNegotiation(false); navigate(`/systems/${detail.system.id}/supplier`) } catch { /* Displayed below. */ }
  }
  if (!report) return <><Empty title={detail.job?.kind === 'impact_analysis' && ['queued', 'running'].includes(detail.job.state) ? t('正在准备审查内容。', 'Preparing review content.') : detail.round?.submitted_id ? t('按需开始后续审查', 'Start further review when needed') : t('等待供应商提交复核答复。', 'Awaiting submitted supplier responses.')} description={t('提交仅记录供应商承诺，不自动调用 AI。负责人可开始本地规则辅助的人工审查，或按需启动 AI 影响评估。', 'Submission only records commitments and does not call AI. The owner may start rule-assisted manual review or explicitly request AI impact assessment.')}>
    {user.role !== 'vendor' && detail.round?.submitted_id && ['RESULT_REVIEW', 'NEGOTIATING', 'ANALYZING'].includes(detail.system.status) && (!detail.permissions || detail.permissions.some(p => ['review', 'manage'].includes(p))) && <><Button disabled={['queued', 'running'].includes(detail.job?.state ?? '')} onClick={() => void retry('local')} busy={busy}>{t('开始人工审查（本地规则）', 'Start manual review (local rules)')}</Button><Button variant="secondary" disabled={['queued', 'running'].includes(detail.job?.state ?? '')} onClick={() => void retry('openrouter')} busy={busy}>{t('按需启动 AI 影响评估', 'Request AI impact assessment')}</Button></>}
    </Empty>{error && <Notice error>{error}</Notice>}</>
  const severityLabels: Record<string, string> = { low: t('低', 'Low'), medium: t('中等风险', 'Moderate risk'), high: t('重大风险', 'Major risk'), critical: t('关键', 'Critical'), unknown: t('待确认', 'Unknown') }
  const findings = report.data.findings
  const implementable = findings.filter(f => detail.round?.status !== 'open' && detail.round?.draft?.[f.requirement_id]?.implementation_status === 'yes' && !decisions[f.id]?.decision)
  const sourceGate = report.source_assessment
  const hasSourceGate = sourceGate && sourceGate.status !== 'legacy' && sourceGate.status !== 'awaiting_submission'
  const blockedHigh = sourceGate?.blocking_requirements ?? []
  const failedHigh = sourceGate?.failed_requirements ?? []
  const clarificationIds = new Set(sourceGate?.clarification_requirements ?? detail.supplier_review?.items.filter(item => item.source_risk === 'high' && item.status === 'needs_clarification').map(item => item.requirement_id) ?? (detail.prd?.high_risk_requirements ?? []).filter(id => detail.round?.draft[id]?.implementation_status === 'needs_clarification'))
  const highClarification = (finding: Finding) => clarificationIds.has(finding.requirement_id)
  const highPriority = (finding: Finding) => highClarification(finding) || ['high', 'critical'].includes(finding.severity)
  const expandedRisk = (finding: Finding) => highClarification(finding) || ['low', 'medium', 'high', 'critical'].includes(finding.severity)
  const displayTone = (finding: Finding) => highClarification(finding) ? 'high' : finding.severity
  const major = new Set(findings.filter(highPriority).map(f => f.requirement_id)).size
  const missingOwnerDecisions = findings.filter(f => highClarification(f) && decisions[f.id]?.decision === 'accept' && !decisions[f.id]?.owner_reviewed).length
  const moderate = findings.filter(f => f.severity === 'medium').length
  const missingDecisions = findings.filter(item => !decisions[item.id]?.decision).length
  const missingReasons = findings.filter(item => !decisions[item.id]?.reason.trim()).length
  const complete = missingDecisions === 0 && missingReasons === 0 && missingOwnerDecisions === 0 && !!exceptionReason.trim()
  const readOnly = user.role === 'vendor' || !['RESULT_REVIEW', 'NEGOTIATING'].includes(detail.system.status)
  return <section className="impact-review-page"><div className="section-heading"><div><span className="eyebrow">IMPACT REVIEW</span><h2>{t('影响评估与处理', 'Impact assessment and decisions')}</h2><p className="muted">{t('结论保留供应商原文依据，风险由客户审查和决定。', 'Findings retain supplier evidence. The customer reviews and decides on risk.')}</p></div><ModeStamp mode={report.mode} /></div>{error && <Notice error>{error}</Notice>}<div className="risk-overview"><div><span>{t('风险结论与审查状态', 'Risk assessment and review status')}</span><div className="risk-result-line"><h3>{hasSourceGate ? failedHigh.length ? t('系统安全评估结果：未通过', 'System security assessment: Not passed') : blockedHigh.some(id => clarificationIds.has(id)) ? t('高风险待澄清项需负责人逐项决定', 'High-risk clarification requires individual owner decisions') : blockedHigh.length ? t('High 项尚待情境风险分析或补充证据', 'High items require contextual analysis or evidence') : t('High 风险拦截已通过，待完成客户审查与验收', 'High-risk gate cleared; customer review and acceptance remain') : major ? t('系统安全评估结果：未通过', 'System security assessment: Not passed') : moderate ? t('存在中等风险', 'Moderate risks present') : t('待核对实施证据', 'Implementation evidence needs review')}</h3>{(hasSourceGate ? failedHigh.length > 0 : major > 0) && <p className="mlps-major-risk-alert" role="status">{hasSourceGate ? t('来源 High 项无法完整实施：需 AI 结合系统情况评估。残余风险仍高、事实不足或尚未分析时，暂不能接受并冻结。', 'A source-rated High item is incomplete. Contextual AI assessment is required; high or unknown residual risk blocks acceptance and freezing.') : t('未通过原因：存在重大风险隐患项', 'Reason: Major risk findings present')}</p>}</div></div><div className="risk-count-actions"><button type="button" onClick={() => setFilter('all')}><strong>{findings.length}</strong> {t('项待核对结论', 'findings to review')}<span className="risk-total-breakdown"><span>{detail.prd?.data.requirements.filter(r => r.origin === 'control' || r.origin === 'both').length ?? 0} {t('条纳入控制要求', 'included control requirements')}</span><span>{detail.prd?.data.requirements.filter(r => r.origin === 'business' || r.origin === 'both').length ?? 0} {t('条本期业务功能', 'in-scope business functions')}</span></span></button><button type="button" onClick={() => { setFilter('major'); setActiveFinding(findings.find(highPriority)?.id ?? null) }}><strong>{major}</strong> {clarificationIds.size ? t('项高风险（含待澄清）', 'high-risk items (including clarification)') : t('项重大风险', 'major risks')}</button><button type="button" onClick={() => { setFilter('medium'); setActiveFinding(findings.find(f => f.severity === 'medium')?.id ?? null) }}><strong>{moderate}</strong> {t('项中等风险', 'moderate risks')}</button></div></div>
    {user.role !== 'vendor' && ['ANALYZING', 'RESULT_REVIEW', 'NEGOTIATING'].includes(detail.system.status) && <div className="paper-panel"><Button disabled={busy || ['queued', 'running'].includes(detail.job?.state ?? '')} onClick={() => void retry('openrouter')}>{t('结合系统情况重新进行 AI 影响评估', 'Reassess impact with AI and system context')}</Button><p className="field-hint">{t('依据本轮固定的定级、信息收集和供应商答复，生成新报告并重新审查；离线不等于风险消失。', 'Uses the pinned classification, system information and supplier responses. A new report requires review again; offline does not imply no risk.')}</p></div>}<div className="impact-toolbar"><select aria-label={t('筛选严重度', 'Filter severity')} value={filter} onChange={e => setFilter(e.target.value)}><option value="all">{t('全部影响等级', 'All impact levels')}</option><option value="risk">{t('存在风险', 'All risks')}</option><option value="major">{clarificationIds.size ? t('高风险（含待澄清）', 'High risk (including clarification)') : t('重大风险', 'Major risks')}</option>{Object.entries(severityLabels).filter(([value]) => value !== 'high').map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>{!readOnly && <div className="bulk-review"><Button disabled={busy || !implementable.length} onClick={() => { setDecisions(old => { const next = { ...old }; for (const finding of implementable.filter(f => !blockedHigh.includes(f.requirement_id) && !highClarification(f))) next[finding.id] = { decision: 'accept', reason: old[finding.id]?.reason.trim() ? old[finding.id].reason : t('接受供应商可实施承诺；供应商负责按需求交付，客户在验收时核验实施证据，并承担本项已记录的残余风险。', 'Accept the supplier feasibility commitment. The supplier is responsible for delivery; the customer will verify implementation evidence at acceptance and accepts the recorded residual risk.') }; return next }); setDirty(true) }}>{t('一键接受可实施项', 'Accept all implementable items')} ({implementable.length})</Button><span className="field-hint">{t('仅填入尚未决定的可实施项；完成审查后点击“保存审查决定”。', 'Fills undecided implementable items only. Save review decisions when review is complete.')}</span><input aria-label={t('批量审查理由', 'Bulk review rationale')} placeholder={t('为未处理项填写共同审查理由', 'Shared rationale for unresolved findings')} value={bulkReason} onChange={e => setBulkReason(e.target.value)} /><Button variant="secondary" disabled={!bulkReason.trim()} onClick={() => { setDecisions(old => Object.fromEntries(findings.map(f => [f.id, old[f.id]?.decision || highClarification(f) ? (old[f.id] ?? { decision: '', reason: '' }) : { decision: blockedHigh.includes(f.requirement_id) ? 'changes' : 'accept', reason: bulkReason }]))); setDirty(true) }}>{t('接受未处理项并记录理由', 'Accept unresolved findings with rationale')}</Button></div>}</div>
    <div className="findings impact-card-grid">{findings.filter(item => filter === 'all' || (filter === 'risk' && expandedRisk(item)) || item.severity === filter || (filter === 'major' && highPriority(item))).sort((a, b) => { const rank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, unknown: 4 }; return rank[displayTone(a)] - rank[displayTone(b)] }).map(finding => { const requirement = detail.prd?.data.requirements.find(r => r.id === finding.requirement_id); const decision = decisions[finding.id] ?? { decision: '', reason: '' }; return <article className={`finding risk-tone-${displayTone(finding)} ${detail.round?.draft?.[finding.requirement_id]?.implementation_status === 'yes' ? 'supplier-confirmed' : ''} ${expandedRisk(finding) ? 'expanded-risk-card' : ''}`} key={finding.id}><button type="button" className="impact-card-button" aria-haspopup="dialog" onClick={() => setActiveFinding(finding.id)}><div className="finding-top"><span className={`severity ${displayTone(finding)}`}>{highClarification(finding) ? t('来源高风险 · 待澄清', 'Source High · Needs clarification') : severityLabels[finding.severity]}</span><code>{finding.requirement_id}</code><h3>{finding.title}</h3></div><h4>{requirement?.title}</h4><span className="field-hint">{t('点击查看与审查', 'Open to review')}</span></button>{(expandedRisk(finding) || activeFinding === finding.id) && <ImpactFindingDetail inline={expandedRisk(finding)} title={requirement?.title ?? finding.title} close={() => setActiveFinding(null)}><h3 className="risk-control-title">{requirement?.title ?? finding.requirement_id}</h3><div className="finding-top"><span className={`severity ${displayTone(finding)}`}>{highClarification(finding) ? t('来源高风险 · 待澄清', 'Source High · Needs clarification') : severityLabels[finding.severity]}</span><code>{finding.requirement_id}</code><h3>{finding.title}</h3></div><div className="finding-evidence"><span className="eyebrow">{t('控制项原文', 'Original control requirement')}</span>{report.control_originals?.[finding.requirement_id]?.length ? report.control_originals[finding.requirement_id].map(c => <div key={c.id}><code>{c.code}</code><p className="preserve-lines">{c.text}</p></div>) : <p>{requirement?.description ?? t('未关联控制项', 'No linked control')}</p>}</div><div className="finding-evidence"><span className="eyebrow">{t('供应商反馈', 'Supplier feedback')}</span><blockquote>{finding.evidence}</blockquote></div><div className="contextual-risk">{(sourceGate?.high_requirements?.includes(finding.requirement_id) || highClarification(finding)) && <strong>{t('来源风险：High（保留原始等级）', 'Source risk: High (original rating retained)')}</strong>}{finding.contextual_assessment && <p>{t('情境残余风险：', 'Contextual residual risk: ')}{severityLabels[finding.severity]}</p>}<p>{finding.impact}</p><p>{finding.recommendation}</p>{finding.contextual_assessment && <><strong>{t('AI 情境风险分析 · 待客户审查', 'AI contextual risk · Customer review required')}</strong><p>{t('暴露面：', 'Exposure: ')}{finding.contextual_assessment.exposure}</p><p>{t('利用前提：', 'Exploitation conditions: ')}{finding.contextual_assessment.exploitation_conditions}</p><p>{t('缓解措施：', 'Mitigations: ')}{finding.contextual_assessment.mitigations}</p>{finding.contextual_assessment.uncertainties.map((u, i) => <p key={i}>{t('待确认：', 'Unknown: ')}{u}</p>)}<details><summary>{t('系统事实依据', 'System evidence')}</summary>{finding.contextual_assessment.facts.map((f, i) => <blockquote key={i}><code>{f.path}</code> · {f.quote}</blockquote>)}</details></>}</div>{['low', 'medium', 'high', 'critical'].includes(finding.severity) && <div className="single-risk-analysis"><Button variant="secondary" disabled={!!riskBusy} onClick={() => void analyzeRisk(finding.requirement_id)}>{riskBusy === finding.requirement_id ? t('分析中…', 'Analyzing…') : t('AI 分析漏洞与风险', 'Analyze vulnerabilities and risks')}</Button>{riskNotes[finding.requirement_id] && <p className="preserve-lines"><strong>{t('AI 辅助分析 · 待核对', 'AI assistance · Review required')}</strong><br />{riskNotes[finding.requirement_id].map((note, index) => <span className="ai-risk-result" key={index}><span><b>{t('风险与漏洞', 'Risks and vulnerabilities')}</b><br />{note.impact}</span><span><b>{t('处理建议', 'Recommendation')}</b><br />{note.recommendation}</span></span>)}</p>}{riskError && <Notice error>{riskError}</Notice>}</div>}{!readOnly ? <div className="finding-decision">{highClarification(finding) && <p className="owner-clarification-notice">{t('待澄清不等于可完成。请负责人逐项选择接受并承担待澄清风险，或要求补充澄清，并记录理由与责任安排。', 'Clarification is not a delivery commitment. The owner must individually accept the unresolved risk or request clarification, recording rationale and accountability.')}</p>}<label>{highClarification(finding) ? t('负责人决定', 'Owner decision') : t('客户决定', 'Customer decision')}<select value={decision.decision} onChange={e => { setDecisions({ ...decisions, [finding.id]: { ...decision, decision: e.target.value as Decision['decision'], ...(highClarification(finding) ? { owner_reviewed: e.target.value === 'accept' } : {}) } }); setDirty(true) }}><option value="">{t('请选择', 'Choose a decision')}</option><option value="accept" disabled={blockedHigh.includes(finding.requirement_id) && !highClarification(finding)}>{t('接受并承担已记录残余风险', 'Accept the recorded residual risk')}</option><option value="changes">{highClarification(finding) ? t('要求补充澄清或修改', 'Request clarification or changes') : t('要求修改或补充证据', 'Request changes or evidence')}</option></select></label><label>{t('理由与责任安排', 'Rationale and accountability')}<textarea rows={2} value={decision.reason} onChange={e => { setDecisions({ ...decisions, [finding.id]: { ...decision, reason: e.target.value } }); setDirty(true) }} /></label></div> : decision.reason && <p className="review-rationale"><Check size={14} />{decision.reason}</p>}</ImpactFindingDetail>}</article> })}</div>
    <section className="paper-panel exception-review"><span className="eyebrow">EXCEPTIONS & EXCLUSIONS</span><h3>{t('例外与排除项审查', 'Exception and exclusion review')}</h3><p>{t('请核对分级未知项、手动降级、必选控制排除。没有例外时也请明确记录；有缺口时写明理由、责任人及跟进安排。', 'Review classification unknowns, manual downgrades, and required-control exclusions. Explicitly record when none apply; otherwise name the rationale, owner, and follow-up.')}</p><div className="exception-counts"><span>{detail.system.classification.exceptions?.length ?? 0} {t('项分级例外或未知', 'classification exceptions/unknowns')}</span><span>{detail.controls.filter(c => !c.included && c.required).length} {t('项必选控制排除', 'required-control exclusions')}</span></div><label>{t('例外审查结论', 'Exception review rationale')}<textarea rows={3} value={exceptionReason} disabled={readOnly} onChange={e => { setExceptionReason(e.target.value); setDirty(true) }} /></label></section>
    {!readOnly && !complete && <div className="review-completion" role="status">
      <strong>{t('完成以下内容后才能保存审查决定', 'Complete the following before saving review decisions')}</strong>
      {missingDecisions > 0 && <p>{t(`还有 ${missingDecisions} 项未选择客户决定。`, `${missingDecisions} findings need a customer decision.`)}</p>}
      {missingReasons > 0 && <p>{t(`还有 ${missingReasons} 项未填写理由与责任安排；仅选择“接受”还不够。`, `${missingReasons} findings need a rationale and accountability; selecting Accept alone is not sufficient.`)}</p>}
      {missingOwnerDecisions > 0 && <p>{t(`还有 ${missingOwnerDecisions} 项高风险待澄清项需要负责人逐项选择决定。`, `${missingOwnerDecisions} high-risk clarification items require an individual owner decision.`)}</p>}
      {!exceptionReason.trim() && <p>{t('请填写例外审查结论。', 'Enter the exception review rationale.')}</p>}
      <p>{t('检查范围包含所有影响等级，当前筛选隐藏的项目也需要完成。', 'All findings are checked, including those hidden by the current severity filter.')}</p>
    </div>}
    {user.role !== 'vendor' && <div className="stage-actions"><Button variant="secondary" disabled={!['RESULT_REVIEW', 'NEGOTIATING', 'FINAL_CONFIRMATION'].includes(detail.system.status)} onClick={() => setNegotiation(true)}>{t('发起新一轮协商', 'Open another response round')}</Button>{!readOnly && <Button variant="secondary" busy={busy} disabled={!complete} onClick={() => void review()}><CheckCheck size={16} />{t('保存审查决定', 'Save review decisions')}</Button>}<Button busy={busy} disabled={blockedHigh.length > 0 || !report.reviewed || dirty || detail.system.status !== 'RESULT_REVIEW'} onClick={() => void freeze()}><LockKeyhole size={16} />{t('冻结方案并收集双方确认', 'Freeze baseline for joint confirmation')}</Button></div>}
    {negotiation && <Modal title={t('明确新一轮需要调整什么', 'Specify what needs to change')} close={() => setNegotiation(false)}><p>{t('保留当前 PRD，复制原答复供供应商修订。旧基线确认不再用于新轮次。', 'Keep the PRD and copy previous answers for supplier revision. Earlier baseline confirmations do not carry forward.')}</p><label>{t('修改要求和沟通结论', 'Requested changes and discussion outcome')}<textarea rows={5} value={negotiationReason} onChange={e => setNegotiationReason(e.target.value)} /></label><div className="modal-actions"><Button disabled={!negotiationReason.trim()} busy={busy} onClick={() => void negotiate()}>{t('开启新的填写轮次', 'Open a new response round')}<ArrowRight size={15} /></Button></div></Modal>}
  </section>
}

export function AgreementPanel({ detail }: { detail: SystemDetail }) {
  const { t } = useLocale()
  const { user } = useAuth()
  const { run, busy, error } = useCommand(detail)
  const [reviewed, setReviewed] = useState(false)
  const baseline = detail.baseline
  if (!baseline) return <Empty title={t('先完成影响与例外审查。', 'Complete impact and exception review first.')} description={t('双方将分别确认同一个不可变开发基线。', 'Both parties will confirm the same immutable development baseline.')}><Link className="button secondary" to={`/systems/${detail.system.id}/impact`}>{t('查看评估结果', 'Review the findings')}<ArrowRight size={15} /></Link></Empty>
  const ownParty = user.role !== 'vendor' ? 'customer' : 'supplier'
  const confirmed = baseline.confirmations.some(item => item.party === ownParty)
  const both = baseline.confirmations.length === 2
  async function confirm() {
    try { await run(`/baselines/${baseline!.id}/confirmations`, { content_hash: baseline!.content_hash }); setReviewed(false) } catch { /* Displayed below. */ }
  }
  async function finalize() {
    try { await run(`/baselines/${baseline!.id}/finalize`) } catch { /* Displayed below. */ }
  }
  return <section><div className="section-heading"><div><span className="eyebrow">BASELINE CONFIRMATION</span><h2>{baseline.finalized ? t('开发基线已确认', 'Development baseline finalized') : t('开发基线双方确认', 'Joint baseline confirmation')}</h2><p className="muted">{t('双方确认关联同一基线和内容指纹；内容变化将要求重新确认。', 'Both confirmations bind to the same baseline and content hash. Changes require confirmation again.')}</p></div><ShieldCheck size={35} className="agreement-symbol" /></div>{error && <Notice error>{error}</Notice>}{both && <a className="button primary" href={`/api/v1/baselines/${baseline.id}/document`}><ArrowDownToLine size={16} />{t('下载双方确认最终稿', 'Download jointly confirmed final document')}</a>}{baseline.finalized && <div className="ready-banner"><FileCheck2 size={23} /><div><strong>{t('系统已保存为待开发', 'Saved as ready for development')}</strong><span>{t('应用说明、PRD、供应商承诺和审查结论已形成可追溯基线。', 'The brief, PRD, commitments, and review decisions form a traceable baseline.')}</span></div><span className="mono">READY</span></div>}
    <div className="agreement-layout"><article className="agreement-document"><span className="eyebrow">BASELINE / {baseline.id.slice(0, 8).toUpperCase()}</span><h2>{detail.system.name}</h2><p className="preserve-lines">{detail.system.context.summary}</p><dl className="brief-definition"><dt>{t('范围边界', 'Scope')}</dt><dd>{detail.system.context.scope}</dd><dt>{t('业务责任', 'Accountable role')}</dt><dd>{detail.system.context.owner_role}</dd><dt>{t('最终等级', 'Effective level')}</dt><dd>{detail.system.classification.effective_level}</dd><dt>{t('需求数量', 'Requirements')}</dt><dd>{detail.prd?.data.requirements.length}</dd><dt>{t('PRD 内容指纹', 'PRD content hash')}</dt><dd><code className="full-hash">{detail.prd?.content_hash}</code></dd><dt>{t('例外及排除审查', 'Exception/exclusion review')}</dt><dd>{detail.report?.decisions._exceptions?.reason}</dd></dl><details><summary>{t('查看逐项审查结论', 'Review individual decisions')}</summary>{detail.report?.data.findings.map(finding => <div className="baseline-decision" key={finding.id}><code>{finding.requirement_id}</code><strong>{finding.title}</strong><p>{detail.report?.decisions[finding.id]?.reason}</p></div>)}</details><div className="hash-box"><span className="eyebrow">SHA–256 / CONTENT FINGERPRINT</span><code>{baseline.content_hash}</code><p>{t('相同指纹，代表双方确认相同内容。', 'The same fingerprint identifies the same confirmed content.')}</p></div>{detail.prd && <a className="inline-action" href={`/api/v1/systems/${detail.system.id}/prd-versions/${detail.prd.id}/document`}><ArrowDownToLine size={14} />{t('下载对应 PRD', 'Download the corresponding PRD')}</a>}</article><aside className="confirmation-panel"><span className="eyebrow">CONFIRMATION STATUS</span><h3>{t('双方确认状态', 'Joint confirmation')}</h3>{[['customer', t('客户负责人', 'Customer owner')], ['supplier', t('供应商确认人', 'Supplier approver')]].map(([party, label]) => { const accepted = baseline.confirmations.some(item => item.party === party); return <div className={`party-confirmation ${accepted ? 'accepted' : ''}`} key={party}><span>{accepted ? <Check size={18} /> : <span className="confirmation-circle" />}</span><div><strong>{label}</strong><small>{accepted ? t('已确认当前基线', 'Confirmed this baseline') : t('等待独立确认', 'Awaiting independent confirmation')}</small></div></div> })}<hr />{!confirmed && !baseline.finalized ? <><CheckLabel checked={reviewed} onChange={setReviewed}>{t('我代表本方接受当前范围、交付承诺及已记录例外', 'I accept this scope, commitments, and recorded exceptions on behalf of my party')}</CheckLabel><Button className="full" busy={busy} disabled={!reviewed} onClick={() => void confirm()}><CheckCheck size={16} />{t('确认这份基线', 'Confirm this baseline')}</Button></> : <p className="approval-label"><Check size={16} />{t('本方已完成确认', 'Your party has confirmed')}</p>}{user.role !== 'vendor' && !baseline.finalized && <Button className="full" busy={busy} disabled={!both} onClick={() => void finalize()}><FileCheck2 size={16} />{t('保存并转为待开发', 'Save & mark ready for development')}</Button>}<p className="field-hint">{t('同一个账号不能替双方确认。任何范围调整都会使旧确认失效。', 'One account cannot confirm for both parties. Scope changes invalidate earlier confirmations.')}</p></aside></div>
  </section>
}
