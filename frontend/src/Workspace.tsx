import { DeliveryStart } from './DeliveryWorkspace'
import ExistingAssessment from './ExistingAssessment'
import AssessmentCreate from './AssessmentCreate'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Check, Clock3 } from 'lucide-react'
import { api, ApiError } from './api'
import { Button, Empty, JobNotice, Modal, Notice, Status, useAuth } from './components'
import { useLocale } from './i18n'
import type { SystemDetail } from './types'
import { ClassificationPanel, ControlsPanel } from './discovery'
import { BriefReviewPanel } from './BriefReview'
import { CsvExchange } from './Questionnaire'
import SystemNameEditor from './SystemNameEditor'
import { AgreementPanel, ImpactPanel, PrdPanel, SupplierPanel } from './downstream'

export function stageTab(status: string, vendor = false, _hasDescription = true) {
  if (['VERIFYING', 'GAP_REVIEW', 'REMEDIATING', 'ACCEPTED_RISKS', 'ASSESSMENT_COMPLETE'].includes(status)) return 'existing'
  if (vendor && status === 'VENDOR_FILLING') return 'supplier'
  return ({ DRAFT: 'classification', CLASSIFYING: 'classification', CONTEXT_REVIEW: 'brief', CONTROL_REVIEW: 'controls',
    PRD_GENERATING: 'prd', PRD_REVIEW: 'prd', VENDOR_FILLING: 'supplier', ANALYZING: 'impact',
    RESULT_REVIEW: 'impact', NEGOTIATING: 'impact', FINAL_CONFIRMATION: 'agreement', PENDING_DEVELOPMENT: 'agreement' } as Record<string, string>)[status] ?? 'unavailable'
}
export default function Workspace() {
  const { id = '', tab } = useParams()
  const { t, locale, error } = useLocale()
  const { user } = useAuth()
  const vendor = user.role === 'vendor'
  const navigate = useNavigate()
  const [historyOpen, setHistoryOpen] = useState(false)
  const [followup, setFollowup] = useState(false)
  const query = useQuery({ queryKey: ['system', id], queryFn: () => api<SystemDetail>(`/systems/${id}`),
    refetchInterval: query => ['queued', 'running'].includes(query.state.data?.job?.state ?? '') ? 900 :
      ['VENDOR_FILLING', 'ANALYZING', 'FINAL_CONFIRMATION', 'REMEDIATING'].includes(query.state.data?.system.status ?? '') ? 2500 : false })
  const history = useQuery({ queryKey: ['history', id, historyOpen], queryFn: () => api<{ id: string; action: string; created_at: number; detail: Record<string, unknown> }[]>(`/systems/${id}/history`), enabled: historyOpen && !vendor })
  if (query.isPending) return <Empty title={t('正在打开评估…', 'Opening assessment…')} />
  if (query.error || !query.data) return <Notice error>{error(query.error instanceof ApiError ? query.error.code : 'NOT_FOUND')}</Notice>
  const detail = query.data, system = detail.system
  const existing = system.assessment_type === 'existing'
  const hasDescription = Object.values(system.draft.blocks ?? {}).some(text => text.trim())
  if (!vendor && tab === 'discovery') return <Navigate to={`/systems/${id}/${system.classification.effective_level ? 'brief' : 'classification'}`} replace />
  const active = tab ?? stageTab(system.status, vendor, hasDescription)
  const steps = [
    ['classification', t('系统定级', 'System grading')], ['brief', t('审查应用说明', 'Review brief')],
    ['controls', t('控制审查', 'Controls')], ['prd', t('PRD 文档', 'PRD')], ['supplier', t('供应商', 'Supplier')],
    ['impact', t('影响评估', 'Impact')], ['agreement', t('双方确认', 'Agreement')],
    ['existing', t('现状评估与整改', 'Verification & remediation')],
  ].filter(([key]) => existing ? !['prd', 'supplier', 'impact', 'agreement'].includes(key) : key !== 'existing').filter(([key]) => !vendor || ['prd', 'supplier', 'impact', 'agreement'].includes(key))
  const available = (key: string) => key === 'existing' && !!system.context_revision_id || !vendor && (key === 'classification') ||
    key === 'brief' && !!system.classification.effective_level || key === 'controls' && !!system.context_revision_id ||
    key === 'prd' && (!!system.context_revision_id || !!detail.prd) || key === 'supplier' && !!detail.prd ||
    key === 'impact' && !!detail.round || key === 'agreement' && (!!detail.report || !!detail.baseline)
  const currentStep = steps.findIndex(([key]) => key === stageTab(system.status, vendor, hasDescription))
  const panels: Record<string, React.ReactNode> = {
    existing: existing && !vendor ? <ExistingAssessment detail={detail} /> : null,
    classification: !vendor ? <ClassificationPanel detail={detail} /> : null,
    brief: !vendor ? <BriefReviewPanel key={`${id}-brief`} detail={detail} /> : null,
    controls: !vendor ? <ControlsPanel detail={detail} /> : null,
    prd: <PrdPanel detail={detail} />, supplier: <SupplierPanel detail={detail} />,
    impact: <ImpactPanel detail={detail} />, agreement: <AgreementPanel detail={detail} />,
  }
  const auditLabels: Record<string, string> = {
    'system.created': t('建立评估', 'Assessment created'), 'context.draft_saved': t('保存输入草稿', 'Input draft saved'),
    'context.confirmed': t('确认应用说明', 'Brief confirmed'), 'classification.confirmed': t('确认系统等级', 'Classification confirmed'),
    'control.applicability_completed': t('补充适用条件并更新控制匹配', 'Applicability answers and controls updated'),
    'control.applicability_answers': t('记录适用条件答案', 'Applicability answers recorded'),
    'control.domains_excluded': t('按控制域批量移除控制', 'Controls removed by domain'),
    'control.selection_changed': t('调整控制范围', 'Control scope changed'), 'job.queued': t('任务已排队', 'Task queued'),
    'context_organization.completed': t('完成应用梳理', 'Discovery organized'), 'prd_generation.completed': t('生成 PRD', 'PRD generated'),
    'impact_analysis.completed': t('完成影响分析', 'Impact analysis completed'), 'prd.approved': t('确认 PRD', 'PRD approved'),
    'prd.withdrawn': t('撤销 PRD 并返回控制审查', 'PRD withdrawn for control review'),
    'prd.revised': t('修订 PRD', 'PRD revised'), 'supplier.round_published': t('下发供应商', 'Supplier round published'),
    'supplier.draft_saved': t('保存供应商草稿', 'Supplier draft saved'), 'supplier.submitted': t('提交供应商答复', 'Supplier response submitted'),
    'report.reviewed': t('审查评估报告', 'Impact report reviewed'), 'baseline.frozen': t('冻结开发基线', 'Baseline frozen'),
    'baseline.confirmed': t('确认开发基线', 'Baseline confirmed'), 'baseline.finalized': t('归档为待开发', 'Ready for development'),
    'negotiation.opened': t('开启协商轮次', 'Negotiation round opened'),
  }
  return <><div className="workspace-breadcrumb"><Link to="/"><ArrowLeft size={14} />{t('返回评估台账', 'Back to assessments')}</Link><span className="mono">ASSESSMENT / {id.slice(0, 8).toUpperCase()}</span></div><header className="assessment-header"><div className="workspace-heading"><div><div className="title-overline"><Status status={system.status} /><span className="mono muted">REV. {String(system.revision).padStart(2, '0')}</span></div><h1>{system.name}</h1>{!vendor && <SystemNameEditor detail={detail} />}<p>{system.context.departments?.join(' / ') || t('业务归属和责任将在应用梳理中明确。', 'Clarify departments and accountability in the application brief.')}</p></div><div className="workspace-heading-actions">{system.classification.effective_level && <div className={`large-level ${system.classification.effective_level}`}><span className="mono">{t('初步等级', 'PRELIMINARY')}</span><strong>{system.classification.effective_level}</strong></div>}{!vendor && <Button variant="secondary" onClick={() => setHistoryOpen(true)}><Clock3 size={16} />{t('变更记录', 'History')}</Button>}</div></div>
    <nav className={`workflow-nav${vendor ? ' supplier-workflow' : ''}`} aria-label={t('评估步骤', 'Assessment steps')}>{steps.map(([key, label], index) => <button key={key} aria-current={active === key ? 'step' : undefined} className={active === key ? 'active' : index < currentStep ? 'done' : ''} disabled={!available(key)} onClick={() => navigate(`/systems/${id}/${key}`)}><span>{index < currentStep && <Check size={13} />}{index + 1}</span>{label}</button>)}</nav><div id={`assessment-demo-actions-${id}`} className="assessment-demo-actions" /></header>
    <JobNotice detail={detail} />{system.status === "PENDING_DEVELOPMENT" && <DeliveryStart systemId={id} version={system.version} canManage={detail.permissions?.includes("manage")} />}{!vendor && detail.permissions?.length === 1 && <Notice>{t('你具有此评估的只读权限。', 'You have read-only access to this assessment.')}</Notice>}
    <fieldset className="permission-fieldset" disabled={!vendor && !!detail.permissions && !detail.permissions.some(p => p !== 'read')}>{(steps.some(([key]) => key === active) ? panels[active] : null) ?? <Empty title={t('该步骤暂不可用', 'This step is not available yet')} />}</fieldset>
    {active === 'supplier' && detail.round?.status === 'open' && <CsvExchange key={detail.round.version} detail={detail} kind="prd" />}
    {!vendor && detail.permissions?.includes('manage') && <Button variant="secondary" onClick={() => setFollowup(true)}>{t('创建关联后继评估', 'Create linked follow-up assessment')}</Button>}{followup && <Modal title={t('创建关联后继评估', 'Create linked follow-up assessment')} close={() => setFollowup(false)}><AssessmentCreate initialKind="existing" predecessor={detail} onCreated={() => setFollowup(false)} /></Modal>}
    {historyOpen && <Modal title={t('评估变更记录', 'Assessment history')} close={() => setHistoryOpen(false)} wide>{history.error && <Notice error>{t('无法读取记录。', 'Could not load the history.')}</Notice>}<div className="history-list">{history.data?.map(item => <div key={item.id}><span className="timeline-dot" /><div><strong>{auditLabels[item.action] ?? t('评估记录更新', 'Assessment record updated')}</strong><span className="mono muted">{new Date(item.created_at * 1000).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-GB')}</span></div><code>{item.action}</code></div>)}</div></Modal>}
  </>
}
