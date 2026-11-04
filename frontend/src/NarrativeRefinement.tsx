import { useEffect, useState, type ReactNode } from 'react'
import { api, ApiError } from './api'
import { Button, Notice } from './components'
import { useLocale } from './i18n'

type Suggestion = { text: string; original: string; topic: string; questions: string[] }
export default function NarrativeRefinement({ topic, text, start, apply, children }: {
  children?: ReactNode; topic: string; text: string; start: () => Promise<string>; apply: (text: string) => void
}) {
  const { t, error: translate } = useLocale()
  const [job, setJob] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null)
  const [undo, setUndo] = useState<{ before: string; after: string } | null>(null)
  useEffect(() => {
    if (!job) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    async function poll() {
      try {
        const result = await api<{ state: string; error: string; output: Suggestion | null }>(`/jobs/${job}`)
        if (cancelled) return
        if (result.state === 'succeeded') { setSuggestion(result.output); setBusy(false); setJob('') }
        else if (['failed', 'stale', 'cancelled'].includes(result.state)) {
          setError(result.state === 'stale' ? t('原文已变化，请重新优化。', 'The source changed. Request a new suggestion.') : translate(result.error || 'JOB_FAILED'))
          setBusy(false); setJob('')
        } else timer = setTimeout(poll, 1500)
      } catch (e) {
        if (!cancelled) { setError(translate(e instanceof ApiError ? e.code : 'NETWORK_ERROR')); setBusy(false); setJob('') }
      }
    }
    void poll()
    return () => { cancelled = true; clearTimeout(timer) }
  }, [job])
  const stale = suggestion && (suggestion.original !== text || suggestion.topic !== topic)
  return <div className="narrative-refinement">
    <div className="refinement-editor">{children}<div className="refinement-controls">
    <Button variant="secondary" busy={busy} disabled={busy || !text.trim()} onClick={async () => {
      setBusy(true); setError(''); setSuggestion(null)
      try { setJob(await start()) } catch (e) { setError(translate(e instanceof ApiError ? e.code : 'NETWORK_ERROR')); setBusy(false) }
    }}>{t('AI 优化描述', 'Refine with AI')}</Button>
    <p className="field-hint">{t('调用已配置的 OpenRouter 模型，围绕当前主题适度拓展和优化需求；新增建议标为待确认，采纳前请审查。', 'Uses your configured OpenRouter model to moderately expand and refine this topic. New proposals are marked for confirmation; review before accepting.')}</p>
    {undo && <Button variant="secondary" disabled={text !== undo.after} onClick={() => { apply(undo.before); setUndo(null) }}>{t('撤销本次采纳', 'Undo acceptance')}</Button>}
    </div></div>
    <aside className="refinement-results paper-panel" aria-label={t('AI 优化结果', 'AI refinement result')} aria-live="polite" aria-busy={busy}>
    <h3>{t('AI 优化建议 · 待你确认', 'AI suggestion · Awaiting your review')}</h3>
    {!suggestion && !error && <p className="field-hint">{busy ? t('正在优化描述，结果将在这里展示…', 'Refining your notes. The result will appear here…') : t('在左侧填写描述，点击下方「AI 优化描述」，在这里审阅结果后再采纳。', 'Enter notes on the left and choose Refine with AI below. Review the result here before accepting.')}</p>}
    {error && <Notice error>{error}</Notice>}
    {suggestion && <div className="refinement-suggestion">
      <details><summary>{t('查看本次原文', 'View original text')}</summary><p style={{ whiteSpace: 'pre-wrap' }}>{suggestion.original}</p></details>
      <p style={{ whiteSpace: 'pre-wrap' }}>{suggestion.text}</p>
      {!!suggestion.questions.length && <><h4>{t('待澄清问题（不会写入描述）', 'Clarifications (not inserted into your notes)')}</h4><ul>{suggestion.questions.map((q, i) => <li key={i}>{q}</li>)}</ul></>}
      {stale && <Notice>{t('原文已修改，请重新优化；旧建议不能覆盖当前内容。', 'Your text changed. Request a new suggestion; this result cannot overwrite it.')}</Notice>}
      <div className="stage-actions"><Button disabled={!!stale} onClick={() => {
        if (stale) return
        setUndo({ before: text, after: suggestion.text }); apply(suggestion.text); setSuggestion(null)
      }}>{t('采纳并替换描述', 'Accept and replace')}</Button><Button variant="secondary" onClick={() => setSuggestion(null)}>{t('保留原文', 'Keep original')}</Button></div>
    </div>}
    </aside>
  </div>
}
