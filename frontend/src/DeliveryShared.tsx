import { Check } from 'lucide-react'
import { useLocale } from './i18n'
import { deliveryPercent, deliveryStatuses, type DeliveryBatch } from './deliveryModel'

export function DeliveryBadge({ status }: { status: string }) {
  const { pair } = useLocale()
  return <span className={`delivery-badge state-${status.toLowerCase()}`}>{pair(deliveryStatuses[status] ?? [status, status])}</span>
}

export function DeliveryProgress({ batch }: { batch: DeliveryBatch }) {
  const { t } = useLocale()
  return <div className="delivery-progress"><div><span>{t('验收进度', 'Acceptance progress')}</span><strong>{batch.approved} <small>/ {batch.total}</small></strong></div><progress aria-label={t('验收进度', 'Acceptance progress')} max={batch.total || 1} value={batch.approved} /><span>{deliveryPercent(batch)}%</span></div>
}

export function DeliverySteps({ batch }: { batch?: DeliveryBatch }) {
  const { t } = useLocale()
  const complete = batch?.status === 'REVIEW_COMPLETE'
  const allSubmitted = !!batch?.total && batch.items.length === batch.total && batch.items.every(i => ['IN_REVIEW', 'APPROVED'].includes(i.status))
  const current = !batch ? 0 : complete ? 3 : allSubmitted ? 2 : 1
  const labels = [batch?.kind === 'plan' ? t('计划确认', 'Plan confirmed') : t('基线确认', 'Baseline confirmed'), t('开发与取证', 'Build & collect evidence'), t('逐项验收', 'Review each item'), batch?.kind === 'plan' ? t('转入客户复测', 'Customer retest') : t('交付完成', 'Delivery complete')]
  return <ol className="delivery-steps" aria-label={t('开发交付流程', 'Development delivery workflow')}>{labels.map((label, index) => <li key={index} className={index < current || complete ? 'done' : index === current ? 'current' : ''} aria-current={index === current && !complete ? 'step' : undefined}><span>{index < current || complete ? <Check size={14} /> : index + 1}</span>{label}</li>)}</ol>
}
