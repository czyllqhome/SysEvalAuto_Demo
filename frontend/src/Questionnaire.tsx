import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from './api'
import { Button, Notice, useAuth } from './components'
import { useLocale } from './i18n'
import type { SystemDetail } from './types'

type Option = { value: string; label: string; label_en?: string }
type Field = { key: string; label: string; label_en?: string; options: Option[] | null; optional?: boolean }
type Question = { id: string; group: number; title: string; title_en: string; kind: string; options: Option[]; when: Record<string, string[]>; fields: Field[]; details_when: string[] | string | null; hint: string }
type Answer = { value: string | string[]; details?: Record<string, unknown> | Record<string, string>[] }
type Intake = { definition: { questionnaire_version: string; mapping_version: string; questions: Question[] }; snapshot: { answers: Record<string, Answer>; tags: { code: string; label: string }[] }; version: number; workflow_status: string; suggested_facts: Record<string, string>; permissions: string[] }

export function QuestionnairePanel({ detail, onFacts }: { detail: SystemDetail; onFacts: (facts: Record<string, string>) => void }) {
  const { t } = useLocale()
  const query = useQuery({ queryKey: ['questionnaire', detail.system.id], queryFn: () => api<Intake>(`/systems/${detail.system.id}/questionnaire`) })
  if (query.error) return <Notice error>{t('问卷读取失败，请刷新。', 'Could not load the questionnaire. Please refresh.')}</Notice>
  if (!query.data) return null
  return <details className="intake-section" open={query.data.version > 0 || undefined}><summary>{t('详细分类问卷 · 19 项', 'Detailed classification questionnaire · 19 questions')} <span>{query.data.version ? t('已有草稿或提交记录', 'Saved record available') : t('按需展开，补充部署、数据和业务事实', 'Expand to capture deployment, data and business facts')}</span></summary><QuestionnaireEditor key={query.data.version} detail={detail} data={query.data} onFacts={onFacts} /></details>
}

function QuestionnaireEditor({ detail, data, onFacts }: { detail: SystemDetail; data: Intake; onFacts: (facts: Record<string, string>) => void }) {
  const { t, locale, error: translate } = useLocale()
  const client = useQueryClient()
  const [answers, setAnswers] = useState<Record<string, Answer>>(data.snapshot.answers)
  const [group, setGroup] = useState(0)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [reason, setReason] = useState('')
  const editable = data.permissions.includes('edit') && ['draft', 'returned'].includes(data.workflow_status)
  const label = (item: { label: string; label_en?: string }) => locale === 'en' ? item.label_en ?? item.label : item.label
  const visible = data.definition.questions.filter(q => Object.entries(q.when).every(([id, values]) => values.includes(String(answers[id]?.value ?? ''))))
  function patch(id: string, value: Partial<Answer>) { setAnswers(old => ({ ...old, [id]: { ...(old[id] ?? { value: '' }), ...value } })) }
  function fields(q: Question, row: Record<string, string>, update: (value: Record<string, string>) => void) {
    return <div className="intake-fields">{q.fields.map(f => <label key={f.key}>{label(f)}{f.options ? <select value={row[f.key] ?? ''} onChange={e => update({ ...row, [f.key]: e.target.value })}><option value="">{t('请选择', 'Select')}</option>{f.options.map(o => <option value={o.value} key={o.value}>{label(o)}</option>)}</select> : <input maxLength={2000} value={row[f.key] ?? ''} placeholder={t('未知可填“待确认”', 'Enter unknown if undecided')} onChange={e => update({ ...row, [f.key]: e.target.value })} />}</label>)}</div>
  }
  async function save(action: 'draft' | 'submit' | 'return') {
    setBusy(true); setError('')
    try {
      const updated = await api<Intake>(`/systems/${detail.system.id}/questionnaire${action === 'return' ? '/return' : ''}`, { method: action === 'return' ? 'POST' : 'PUT', body: action === 'return' ? { version: detail.system.version, reason } : { version: detail.system.version, questionnaire_revision: data.version, questionnaire_version: data.definition.questionnaire_version, mapping_version: data.definition.mapping_version, answers, action } })
      client.setQueryData(['questionnaire', detail.system.id], updated)
      await client.invalidateQueries({ queryKey: ['system', detail.system.id] })
      if (action === 'submit') onFacts(updated.suggested_facts)
    } catch (e) { setError(e instanceof ApiError ? translate(e.code) + (e.detail ? '\n' + JSON.stringify(e.detail) : '') : translate('NETWORK_ERROR')) }
    finally { setBusy(false) }
  }
  return <div className="intake-body"><p>{t('答案用于推导标签并补充等级依据，提交后可继续下方等级确认。修改已确认系统的事实将重新开启分级与审查。', 'Answers derive tags and support classification. Submit, then confirm the level below. Changing confirmed facts reopens classification and review.')}</p><div className="segmented">{[t('外网与部署', 'Network & deployment'), t('数据处理', 'Data processing'), t('业务连续性', 'Continuity'), t('系统交互', 'Integrations')].map((name, i) => <button className={i === group ? 'active' : ''} key={i} onClick={() => setGroup(i)}>{name}</button>)}</div>{error && <Notice error>{error}</Notice>}<fieldset className="permission-fieldset" disabled={!editable || busy}>{visible.filter(q => q.group === group).map(q => {
    const a = answers[q.id] ?? { value: '' }; const value = a.value
    const options = q.kind === 'deployment' ? [{ value: 'provided', label: '填写明细', label_en: 'Provide details' }, { value: 'unknown', label: '待确认', label_en: 'To be confirmed' }] : q.options
    const needDetails = q.details_when === 'known' ? !!value && value !== 'unknown' && JSON.stringify(value) !== '["unknown"]' : Array.isArray(q.details_when) && q.details_when.includes(String(value))
    return <article className="intake-question" key={q.id}><span className="mono muted">{q.id}</span><h3>{locale === 'en' ? q.title_en : q.title}</h3>{q.kind === 'multi' ? <div className="intake-options">{options.map(o => <label className="check-label" key={o.value}><input type="checkbox" checked={Array.isArray(value) && value.includes(o.value)} onChange={e => { const old = Array.isArray(value) ? value : []; patch(q.id, { value: e.target.checked ? o.value === 'unknown' ? ['unknown'] : [...old.filter(v => v !== 'unknown'), o.value] : old.filter(v => v !== o.value) }) }} />{label(o)}</label>)}</div> : <select aria-label={locale === 'en' ? q.title_en : q.title} value={String(value)} onChange={e => patch(q.id, { value: e.target.value })}><option value="">{t('请选择', 'Select')}</option>{options.map(o => <option value={o.value} key={o.value}>{label(o)}</option>)}</select>}
      {q.kind === 'duration' && value === 'duration' && <div className="intake-fields"><input aria-label={t('中断时长', 'Outage duration')} type="number" min="0.000001" step="any" value={String((a.details as Record<string, string>)?.amount ?? '')} onChange={e => patch(q.id, { details: { ...(a.details ?? {}), amount: e.target.value } })} /><select aria-label={t('时间单位', 'Time unit')} value={String((a.details as Record<string, string>)?.unit ?? 'minutes')} onChange={e => patch(q.id, { details: { ...(a.details ?? {}), unit: e.target.value } })}>{[['minutes', t('分钟', 'Minutes')], ['hours', t('小时', 'Hours')], ['days', t('天', 'Days')]].map(([v, l]) => <option value={v} key={v}>{l}</option>)}</select></div>}
      {q.kind === 'deployment' && value === 'provided' && (Array.isArray(answers['DEP-01']?.value) ? answers['DEP-01'].value : []).filter(env => env !== 'unknown').map(env => <div key={env}><h4>{label(data.definition.questions.find(q => q.id === 'DEP-01')!.options.find(o => o.value === env)!)}</h4>{fields(q, (a.details as Record<string, Record<string, string>>)?.[env] ?? {}, row => patch(q.id, { details: { ...(a.details ?? {}), [env]: row } }))}</div>)}
      {needDetails && q.kind !== 'records' && fields(q, a.details as Record<string, string> ?? {}, row => patch(q.id, { details: row }))}
      {needDetails && q.kind === 'records' && <>{(Array.isArray(a.details) ? a.details : [{}]).map((row, i, rows) => <div className="intake-record" key={i}>{fields(q, row, updated => patch(q.id, { details: rows.map((r, j) => j === i ? updated : r) }))}<button type="button" className="inline-action" onClick={() => patch(q.id, { details: rows.filter((_, j) => j !== i) })}>{t('移除此系统', 'Remove system')}</button></div>)}<Button variant="secondary" onClick={() => patch(q.id, { details: [...(Array.isArray(a.details) ? a.details : []), {}] })}>{t('增加交互系统', 'Add integration')}</Button></>}
    </article>
  })}</fieldset><div className="stage-actions">{editable && <><Button variant="secondary" busy={busy} onClick={() => void save('draft')}>{t('保存问卷草稿', 'Save questionnaire draft')}</Button><Button busy={busy} onClick={() => void save('submit')}>{t('提交问卷并带入分级', 'Submit and use for classification')}</Button></>}{data.workflow_status === 'submitted' && data.permissions.includes('manage') && <><input aria-label={t('退回原因', 'Return reason')} placeholder={t('退回修改原因', 'Reason for returning')} value={reason} onChange={e => setReason(e.target.value)} /><Button variant="secondary" disabled={!reason.trim()} onClick={() => void save('return')}>{t('退回修改', 'Return for changes')}</Button></>}</div>{!!data.snapshot.tags.length && <details><summary>{t('已推导标签', 'Derived tags')} · {data.snapshot.tags.length}</summary><div className="intake-tags">{data.snapshot.tags.map(tag => <span key={tag.code} title={tag.label}>{tag.code}</span>)}</div></details>}<CsvExchange detail={detail} kind="questionnaire" /></div>
}

type Preview = { batch_id: string; can_confirm: boolean; errors: unknown[]; changes: { field: string; before: string; after: string }[] }
export function CsvExchange({ detail, kind }: { detail: SystemDetail; kind: 'questionnaire' | 'prd' }) {
  const { t, error: translate } = useLocale(); const { user } = useAuth(); const client = useQueryClient()
  const [supplier, setSupplier] = useState(''); const [slots, setSlots] = useState(5); const [error, setError] = useState(''); const [preview, setPreview] = useState<Preview | null>(null); const [busy, setBusy] = useState(false)
  const query = useQuery({ queryKey: ['csv-forms', detail.system.id, detail.system.revision], queryFn: () => api<{ id: string; kind: string; supplier_id: string }[]>(`/systems/${detail.system.id}/csv-forms`) })
  const form = query.data?.find(f => f.kind === kind)
  const canIssue = kind === 'prd' ? user.role === 'vendor' || detail.permissions?.includes('manage') : detail.permissions?.includes('manage')
  const canImport = kind === 'prd' ? user.role === 'vendor' : detail.permissions?.includes('edit')
  const path = `/systems/${detail.system.id}/csv-forms`
  async function action(operation: () => Promise<void>) { setBusy(true); setError(''); try { await operation() } catch (e) { setError(translate(e instanceof ApiError ? e.code : 'NETWORK_ERROR')) } finally { setBusy(false) } }
  async function upload(file?: File) {
    if (!file || !form) return
    if (file.size > 5 * 1024 * 1024) { setError(t('文件不能超过 5 MB。', 'Maximum file size: 5 MB.')); return }
    await action(async () => { const bytes = new Uint8Array(await file.arrayBuffer()); let text = ''; for (const byte of bytes) text += String.fromCharCode(byte); setPreview(await api<Preview>(`${path}/${form.id}/preview`, { method: 'POST', body: { content_base64: btoa(text) } })) })
  }
  return <section className="csv-exchange"><h3>{t('供应商 CSV 往返填写', 'Supplier CSV exchange')}</h3><p className="field-hint">{t('下载固定模板，仅填写 value 列；上传后先检查差异，再确认导入。导入只保存草稿，仍需单独提交。', 'Download the fixed template and edit only value cells. Review changes before importing. Import saves a draft; submission remains explicit.')}</p>{error && <Notice error>{error}</Notice>}{!form && canIssue && <div className="intake-fields">{kind === 'questionnaire' && <><label>{t('供应商编号', 'Supplier reference')}<input value={supplier} onChange={e => setSupplier(e.target.value)} /></label><label>{t('交互系统预留数量', 'Integration slots')}<input type="number" min={1} max={100} value={slots} onChange={e => setSlots(Number(e.target.value))} /></label></>}<Button disabled={kind === 'questionnaire' && !supplier.trim()} busy={busy} onClick={() => void action(async () => { await api(path, { method: 'POST', body: { kind, supplier_id: supplier, slots, version: detail.system.version } }); await query.refetch() })}>{t('建立填写模板', 'Create template')}</Button></div>}{form && <div className="stage-actions"><a className="button secondary" href={`/api/v1${path}/${form.id}/template`}>{t('下载 CSV 模板', 'Download CSV template')}</a>{canImport && <label className="csv-file">{t('上传填写结果并预览', 'Upload and preview')}<input type="file" accept=".csv,text/csv" disabled={busy} onChange={e => void upload(e.target.files?.[0])} /></label>}</div>}{preview && <div><p>{t('变更字段', 'Changed fields')}: {preview.changes.length} · {t('错误', 'Errors')}: {preview.errors.length}</p>{preview.errors.length > 0 && <pre>{JSON.stringify(preview.errors, null, 2)}</pre>}<div className="table-scroll"><table><thead><tr><th>{t('字段', 'Field')}</th><th>{t('原值', 'Before')}</th><th>{t('新值', 'After')}</th></tr></thead><tbody>{preview.changes.map(c => <tr key={c.field}><td>{c.field}</td><td>{c.before}</td><td>{c.after}</td></tr>)}</tbody></table></div><Button disabled={!preview.can_confirm} busy={busy} onClick={() => void action(async () => { const updated = await api<SystemDetail>(`${path}/${form!.id}/confirm`, { method: 'POST', body: { batch_id: preview.batch_id, version: detail.system.version } }); client.setQueryData(['system', detail.system.id], updated); await client.invalidateQueries({ queryKey: ['questionnaire', detail.system.id] }); setPreview(null) })}>{t('确认导入草稿', 'Confirm draft import')}</Button></div>}</section>
}
