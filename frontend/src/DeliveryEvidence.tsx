import { FileText, Paperclip, Sparkles } from 'lucide-react'
import { Button } from './components'
import { useLocale } from './i18n'
import { DeliveryBadge } from './DeliveryShared'
import type { Attachment, Submission } from './deliveryModel'

export function DeliveryAttachments({ attachments }: { attachments: Attachment[] }) {
  const { t } = useLocale()
  return <div className="delivery-attachments">{attachments.map(a => <div className="delivery-attachment" key={a.id}><FileText size={18} /><div><a href={`/api/v1/evidence-attachments/${a.id}/content`}>{a.filename}</a><p>{Math.max(1, Math.ceil(a.size / 1024))} KB · {a.meta.environment} / {a.meta.system_version} · {a.meta.collected_on}</p>{a.mime.startsWith('image/') && <details><summary>{t('查看截图', 'View screenshot')}</summary><img alt={a.filename} src={`/api/v1/evidence-attachments/${a.id}/preview`} loading="lazy" /></details>}</div></div>)}</div>
}

export function SubmissionEvidence({ submission: s, analyze, busy }: { submission: Submission; analyze?: () => void; busy: boolean }) {
  const { t, locale, error: translate } = useLocale()
  const date = (value?: number) => value ? new Date(value * 1000).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-GB', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''
  const aiPending = ['queued', 'running'].includes(s.ai?.state ?? '')
  return <>
    <section className="delivery-evidence-block"><div className="delivery-block-heading"><h4><Paperclip size={16} />{t('供应商提交的证据', 'Supplier evidence')}</h4><span>{t('第', 'Round')} {s.round_no} {t('轮', '')} · {date(s.created_at)}</span></div><p className="preserve-lines">{s.payload.draft.description}</p><div className="delivery-evidence-meta"><span>{t('环境', 'Environment')}: {s.payload.draft.environment || '—'}</span><span>{t('系统版本', 'System version')}: {s.payload.draft.system_version || '—'}</span><span>{t('采集日期', 'Collected on')}: {s.payload.draft.collected_on || '—'}</span></div><DeliveryAttachments attachments={s.payload.attachments} />{!s.payload.attachments.length && <p className="muted">{t('本轮没有附件记录。', 'No attachments recorded for this round.')}</p>}</section>
    <section className="delivery-ai-block"><div className="delivery-block-heading"><h4><Sparkles size={16} />{t('AI 证据评估', 'AI evidence assessment')}</h4><span className="delivery-advisory">{t('辅助参考 · 需人工核验', 'Advisory · Human verification required')}</span></div>
      {s.ai?.state === 'succeeded' && s.ai.output ? <><DeliveryBadge status={s.ai.output.decision} /><p className="preserve-lines">{s.ai.output.summary}</p><details className="delivery-ai-criteria"><summary>{t('查看逐条验收条件分析', 'View analysis by criterion')}</summary>{s.ai.output.criteria.map(c => <div key={c.criterion_id}><strong>{c.criterion_id}</strong> <DeliveryBadge status={c.result} /><p className="preserve-lines">{c.rationale}</p>{c.attachment_ids.map(id => { const file = s.payload.attachments.find(a => a.id === id); return file ? <a key={id} href={`/api/v1/evidence-attachments/${id}/content`}><Paperclip size={13} />{file.filename}</a> : <span key={id}>{id}</span> })}</div>)}</details></> : <p role="status">{s.ai?.state === 'failed' ? `${t('AI 评估未完成：', 'AI assessment failed: ')}${translate(s.ai.error)} (${s.ai.error})` : s.ai?.state === 'stale' ? t('来源已变化，请评估当前提交。', 'Source changed; assess the current submission.') : s.ai?.state === 'cancelled' ? t('AI 评估已取消，可重新发起。', 'AI assessment was cancelled. You can retry.') : aiPending ? t('AI 正在核对附件与验收条件…', 'AI is checking attachments against criteria…') : t('尚未进行 AI 评估；配置模型后可发起。', 'No AI assessment yet. Configure a model to begin.')}</p>}
      {analyze && <Button variant="secondary" disabled={busy || aiPending || s.ai?.state === 'succeeded'} onClick={analyze}><Sparkles size={14} />{t('AI 评估本轮证据', 'Assess this evidence with AI')}</Button>}<p className="delivery-assistance-note">{t('模型结果绑定本轮证据与基线，不代替客户的人工验收。', 'Model results are bound to this evidence and baseline. Customer acceptance remains independent.')}</p>
    </section>
    {s.review && <div className={`delivery-review-record ${s.review.decision === 'PASS' ? 'accepted' : 'returned'}`}><div className="delivery-block-heading"><h4>{t('人工审核结论', 'Human review decision')}</h4><span>{date(s.review.created_at)}</span></div><DeliveryBadge status={s.review.decision} /><p className="preserve-lines">{s.review.reason}</p></div>}
    <details className="delivery-manifest"><summary>{t('提交内容指纹（不可变）', 'Submission content hash (immutable)')}</summary><code>{s.manifest_hash}</code></details>
  </>
}
