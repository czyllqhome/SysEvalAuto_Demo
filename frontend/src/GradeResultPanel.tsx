import questionnaire from '../../backend/app/data/mlps_questionnaire.json'
import { Link } from 'react-router-dom'
import { Empty, Notice } from './components'
import MLPSGradeResult from './MLPSGradeResult'
import type { Question } from './MLPSIntake'
import type { SystemDetail } from './types'
import { useLocale } from './i18n'
import './mlps-intake.css'

export default function GradeResultPanel({ detail }: { detail: SystemDetail }) {
  const { t } = useLocale()
  const classification = detail.system.classification
  const assessment = classification.assessment
  const gradingLink = <Link className="button secondary" to={`/systems/${detail.system.id}/classification`}>{t('返回系统定级', 'Back to system grading')}</Link>
  if (!classification.effective_level) return <Empty title={t('尚无已确认的定级结果', 'No confirmed grade yet')}>{gradingLink}</Empty>
  if (!assessment) return <section><h2>{t('系统等级', 'System grade')} · {classification.effective_level}</h2><Notice>{t('此历史记录没有保存详细计算结果，需在系统定级中重新计算并确认后查看。', 'This historical record has no detailed calculation snapshot. Recalculate and confirm in system grading to view it.')}</Notice>{gradingLink}</section>
  return <section className="mlps-intake mlps-grade-screen grade-result-snapshot">
    <Notice>{t('当前展示已确认的定级结果快照。查看不会重新计算等级或修改问卷。', 'This is the confirmed grading snapshot. Viewing does not recalculate the grade or change questionnaire answers.')}</Notice>
    <MLPSGradeResult readOnly assessment={assessment} answers={classification.answers ?? {}} notes={classification.notes ?? {}} questions={questionnaire as Question[]} frameworks={classification.frameworks ?? []} locked frameworkMode={classification.frameworks?.[0] ?? 'auto'} setFrameworkMode={() => {}} setFrameworks={() => {}} back={() => {}} confirm={() => {}} />
    <div className="stage-actions">{gradingLink}<Link className="button" to={`/systems/${detail.system.id}/information`}>{t('继续系统信息收集', 'Collect system information')}</Link></div>
  </section>
}
