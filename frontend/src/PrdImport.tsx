import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from './api'
import { Button, Notice, useAuth, useCommand } from './components'
import { topicData, useLocale } from './i18n'
import type { SystemDetail } from './types'

type Field = { text: string; status: 'found' | 'missing' | 'conflict'; evidence: { source_id: string; quote: string }[] }
type ImportDetail = { id: string; filename: string; markdown: string; requires_revision: boolean;
  job: { id: string; state: string; error: string } | null;
  result: { fields: Record<string, Field>; name: Field; questions: string[] } | null;
  applications: { id: string; changes: Record<string, { before: string; after: string }>; undone: string[] }[] }

export default function PrdImport({ detail, save }: { detail: SystemDetail; save: () => Promise<void> }) {
  const { t, pair, locale, error: translate } = useLocale(), client = useQueryClient(), auth = useAuth()
  const { run, busy, error } = useCommand(detail)
  const [file, setFile] = useState<{ filename: string; markdown: string } | null>(null)
  const [problem, setProblem] = useState(''), [working, setWorking] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false), [viewId, setViewId] = useState('')
  const [values, setValues] = useState<Record<string, string>>({})
  const [acknowledge, setAcknowledge] = useState(false), [useName, setUseName] = useState(false)
  const [message, setMessage] = useState('')
  const id = detail.system.id, activeId = detail.system.draft.prd_import_id
  const importId = viewId || activeId
  const base = `/systems/${id}/prd-imports`
  const query = useQuery({ queryKey: ['prd-import', id, importId], enabled: !!importId,
    queryFn: () => api<ImportDetail>(`${base}/${importId}`),
    refetchInterval: q => ['queued', 'running'].includes(q.state.data?.job?.state ?? '') ? 1000 : false })
  const history = useQuery({ queryKey: ['prd-import-history', id], enabled: historyOpen,
    queryFn: () => api<{ id: string; filename: string }[]>(base) })
  const data = query.data, result = data?.result
  const pending = ['queued', 'running'].includes(data?.job?.state ?? '')
  const canEdit = !detail.permissions || detail.permissions.includes('edit')
  useEffect(() => {
    if (data?.job?.state === 'succeeded') void client.invalidateQueries({ queryKey: ['system', id] })
    setValues({}); setUseName(false); setAcknowledge(false)
  }, [data?.job?.id, data?.job?.state])
  async function operation(action: () => Promise<void>) {
    setWorking(true); setProblem(''); setMessage('')
    try { await save(); await action(); await client.invalidateQueries({ queryKey: ['prd-import', id] }); await client.invalidateQueries({ queryKey: ['prd-import-history', id] }) }
    catch (e) { setProblem(translate(e instanceof ApiError ? e.code : 'NETWORK_ERROR')) }
    finally { setWorking(false) }
  }
  const disabled = busy || working || !canEdit
  return <section className="paper-panel prd-import-panel" aria-label={t('PRD 导入', 'PRD import')}>
    <details className="prd-import-disclosure">
    <summary><strong>{t('从已有 PRD 导入', 'Import an existing PRD')}</strong><span className="field-hint">{t('Markdown · 展开上传或查看历史', 'Markdown · Expand to upload or view history')}</span></summary>
    <div className="prd-import-content">
    <p className="field-hint">{t('上传 UTF-8 Markdown（最大 60 KB）。点击解析后发送给外部模型，查找全部八类描述并自动填入空白项；未找到留空，已有内容保留。', 'Upload UTF-8 Markdown (up to 60 KB). Parsing sends it to the external model, extracts all eight topics and fills empty fields. Missing information stays blank; existing text is preserved.')}</p>
    {!auth?.model_configured && <Notice>{t('请管理员先配置 OpenRouter；仍可手动填写。', 'Ask an administrator to configure OpenRouter. You can still enter notes manually.')}</Notice>}
    <div className="prd-import-toolbar">
    <input type="file" accept=".md,text/markdown" disabled={disabled || pending} aria-label={t('上传 Markdown PRD', 'Upload Markdown PRD')} onChange={async e => {
      const selected = e.target.files?.[0]; setProblem(''); setFile(null)
      if (!selected) return
      try {
        if (!selected.name.toLowerCase().endsWith('.md') || selected.size > 60000) throw new ApiError('PRD_IMPORT_INVALID_FILE')
        const markdown = new TextDecoder('utf-8', { fatal: true }).decode(await selected.arrayBuffer())
        if (!markdown.trim()) throw new ApiError('PRD_IMPORT_INVALID_FILE')
        setFile({ filename: selected.name, markdown }); setViewId('')
      } catch { setProblem(translate('PRD_IMPORT_INVALID_FILE')) }
    }} />
    <div className="prd-import-actions">
      <Button busy={working} disabled={disabled || pending || !file || !auth?.model_configured} onClick={() => void operation(async () => {
        await run(base, file!)
        setViewId(''); setFile(null)
        await run(`/systems/${id}/jobs`, { kind: 'prd_import_extraction', mode: 'openrouter', language: locale })
        await client.invalidateQueries({ queryKey: ['prd-import', id] })
      })}>{t('解析并自动填充', 'Parse and autofill')}</Button>
      <Button variant="secondary" onClick={() => setHistoryOpen(!historyOpen)}>{t('导入历史', 'Import history')}</Button>
    </div>
    </div>
    {file && <details><summary>{file.filename}</summary><pre style={{ whiteSpace: 'pre-wrap', maxHeight: 240, overflow: 'auto' }}>{file.markdown}</pre></details>}
    {historyOpen && <div>{history.error && <Notice error>{t('历史读取失败。', 'Could not load history.')}</Notice>}{history.data?.map(row => <button key={row.id} className="button text" onClick={() => { setViewId(row.id); setValues({}) }}>{row.filename}</button>)}</div>}
    {(problem || error) && <Notice error>{problem || error}</Notice>}
    {query.error && <Notice error>{t('导入结果读取失败，请刷新。', 'Could not load the import. Refresh to retry.')}</Notice>}
    {message && <Notice>{message}</Notice>}
    {pending && <Notice>{t('正在解析 PRD，离开页面后仍会继续。你可以继续填写描述。', 'Parsing PRD in the background. You can continue editing or leave this page.')}</Notice>}
    {data && <>
      <details><summary>{t('查看已上传原文：', 'View uploaded source: ')}{data.filename}</summary><pre style={{ whiteSpace: 'pre-wrap', maxHeight: 240, overflow: 'auto' }}>{data.markdown}</pre></details>
      {data.job && ['failed', 'stale'].includes(data.job.state) && <Notice error>{data.job.state === 'stale' ? t('评估或来源已变更，请重新解析。', 'The assessment or source changed. Parse again.') : translate(data.job.error)}</Notice>}
      {importId === activeId && !pending && <Button variant="secondary" disabled={disabled || !auth?.model_configured} onClick={() => void operation(async () => {
        await run(`/systems/${id}/jobs`, { kind: 'prd_import_extraction', mode: 'openrouter', language: locale, reparse: true })
      })}>{t('重新解析（调用模型）', 'Parse again (calls model)')}</Button>}
    </>}
    {result && <>
      <p>{t('提取结果 · 待核对。未找到的字段保持空白；已有值不会被自动清除。', 'Extraction · Review needed. Missing fields remain blank; existing values are never cleared automatically.')}</p>
      <p>{t('找到', 'Found')} {Object.values(result.fields).filter(f => f.status === 'found').length} / 8 · {t('未找到', 'Missing')} {Object.values(result.fields).filter(f => f.status === 'missing').length} · {t('冲突', 'Conflicts')} {Object.values(result.fields).filter(f => f.status === 'conflict').length}</p>
      {topicData.map(topic => {
        const field = result.fields[topic.key], current = detail.system.draft.blocks?.[topic.key] ?? ''
        const origin = detail.system.draft.block_sources?.[topic.key]
        const unchangedImport = origin && origin.text === current
        return <details key={topic.key}>
          <summary>{pair(topic.label)} · {field.status === 'missing' ? t('未找到', 'Missing') : field.status === 'conflict' ? t('原文冲突', 'Source conflict') : field.text === current ? t('已填入 · 待核对', 'Filled · Review needed') : t('待应用建议', 'Suggestion')}{origin && !unchangedImport ? t(' · 已人工修改', ' · Edited manually') : ''}</summary>
          <p style={{ whiteSpace: 'pre-wrap' }}>{t('当前值：', 'Current: ')}{current || '—'}</p>
          <p style={{ whiteSpace: 'pre-wrap' }}>{t('提取值：', 'Extracted: ')}{field.text || '—'}</p>
          {field.evidence.map((e, i) => <blockquote key={i}><span className="mono">{e.source_id}</span> {e.quote}</blockquote>)}
          {importId === activeId && <><label><input type="checkbox" disabled={disabled} checked={topic.key in values} onChange={e => setValues(old => {
            const next = { ...old }; if (e.target.checked) next[topic.key] = field.text || current; else delete next[topic.key]; return next
          })} />{t('选择更新此字段（可编辑合并或清空）', 'Update this field (edit, merge or clear)')}</label>
          {topic.key in values && <textarea aria-label={t('导入更新：', 'Import update: ') + pair(topic.label)} maxLength={10000} value={values[topic.key]} onChange={e => setValues(old => ({ ...old, [topic.key]: e.target.value }))} />}</>}
        </details>
      })}
      {!!result.questions.length && <ul>{result.questions.map((q, i) => <li key={i}>{q}</li>)}</ul>}
      {importId === activeId && <>
        {result.name.status === 'found' && <label><input type="checkbox" checked={useName} onChange={e => setUseName(e.target.checked)} />{t('使用名称建议：', 'Use suggested name: ')}{result.name.text}</label>}
        {data?.requires_revision && <Notice>{t('应用更改将创建新评估修订，清除当前分级确认和下游成果指针；历史记录保留，需重新确认等级、说明和基线。', 'Applying changes creates a new assessment revision and requires classification, brief and baseline review again. Historical records are retained.')}<label><input type="checkbox" checked={acknowledge} onChange={e => setAcknowledge(e.target.checked)} />{t('确认创建修订并重新审查', 'Create revision and review again')}</label></Notice>}
        <div className="stage-actions"><Button variant="secondary" disabled={disabled} onClick={() => setValues(Object.fromEntries(Object.entries(result.fields).filter(([key, f]) => f.status === 'found' && detail.system.draft.block_sources?.[key]?.text === detail.system.draft.blocks?.[key]).map(([k, f]) => [k, f.text])))}>{t('选择未被人工修改的导入字段', 'Select unchanged imported fields')}</Button>
        <Button disabled={disabled || (!Object.keys(values).length && !useName) || (!!data?.requires_revision && !acknowledge)} onClick={() => void operation(async () => {
          await run(`${base}/${importId}/apply`, { job_id: data!.job!.id, values, use_name: useName, acknowledge_revision: acknowledge }); setValues({}); setUseName(false)
        })}>{t('应用所选更新', 'Apply selected updates')}</Button></div>
      </>}
      {data?.applications.filter(a => Object.keys(a.changes).some(k => !a.undone.includes(k))).slice(0, 1).map(a => <Button key={a.id} variant="secondary" disabled={disabled || (!!data.requires_revision && !acknowledge)} onClick={() => void operation(async () => {
        const response = await run(`${base}/${importId}/undo`, { application_id: a.id, acknowledge_revision: acknowledge }) as SystemDetail & { undo_skipped: string[] }
        setMessage(response.undo_skipped.length ? t('已撤销安全字段；后续编辑的字段保留。', 'Reverted unchanged fields; later edits were preserved.') : t('已撤销本次填充。', 'Application undone.'))
      })}>{t('撤销最近一次填充（保留后续编辑）', 'Undo last application (preserve later edits)')}</Button>)}
    </>}
    </div></details>
  </section>
}
