import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from './api'
import { Button, Notice } from './components'
import { useLocale } from './i18n'
import type { LibraryState } from './libraryTypes'

function LegacyMLPSLibrary() {
  const { t } = useLocale()
  const [level, setLevel] = useState('2'), [search, setSearch] = useState('')
  const query = useQuery({ queryKey: ['library'], queryFn: () => api<LibraryState>('/library') })
  if (query.error) return <Notice error>{t('控制库加载失败', 'Could not load controls')}</Notice>
  const controls = (query.data?.controls ?? []).filter(c => String(c.source_level) === level &&
    `${c.source_ref} ${Object.values(c.translations.zh ?? {}).join(' ')}`.toLowerCase().includes(search.toLowerCase()))
  return <><div className="page-heading"><div><h1>{t('MLPS 控制条目库', 'MLPS control library')}</h1><p>{t('仅使用 CN 控制库，保留中文原始要求与测评步骤；来源版本不可直接编辑。', 'CN source controls only, with original Chinese requirements and assessment procedures. Source releases are read-only.')}</p></div></div>
    <section className="paper-panel"><label>{t('框架', 'Framework')}<select value={level} onChange={e => setLevel(e.target.value)}><option value="2">{t('MLPS 2 级', 'MLPS Level 2')}</option><option value="3">{t('MLPS 3 级', 'MLPS Level 3')}</option></select></label>
    <label>{t('搜索', 'Search')}<input value={search} onChange={e => setSearch(e.target.value)} /></label><p>{controls.length} {t('条控制', 'controls')}</p>
    {controls.map(c => { const text = c.translations.zh; const source = c.source as unknown as { languages?: Record<string, { filename: string; row: number; fields: Record<string, string> }> }; const original = source?.languages?.zh; return <details className="intake-section" key={c.control_code}><summary>{c.source_ref} · {text?.title}</summary><div className="intake-body"><p style={{ whiteSpace: 'pre-wrap' }}>{text?.description}</p><h4>{t('测评步骤', 'Assessment procedure')}</h4><p style={{ whiteSpace: 'pre-wrap' }}>{text?.verification}</p><p>{original?.filename} {original ? `· ${t('行', 'row')} ${original.row} · ${original.fields.risk_level}` : ''}</p></div></details> })}</section></>
}


type SourceControl = { id: string; source: string; control_identifier: string; security_domain: string; security_control_point: string; control_requirement: string; risk_level: string; sheet: string; row_number: number; mlps_level?: number }
type SourceState = { active: boolean; can_upload: boolean; matching_ready?: boolean; controls: SourceControl[] }

export default function MLPSLibrary() {
  const query = useQuery({ queryKey: ['source-controls'], queryFn: () => api<SourceState>('/source-controls') })
  return query.data?.active ? <SixFieldLibrary state={query.data} refresh={() => query.refetch()} /> : <LegacyMLPSLibrary />
}
function SixFieldLibrary({ state, refresh }: { state: SourceState; refresh: () => Promise<unknown> }) {
  const { t } = useLocale()
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('')
  const [search, setSearch] = useState(''), [source, setSource] = useState('')
  const [level, setLevel] = useState('auto')
  const [files, setFiles] = useState<File[]>([])
  async function upload() {
    if (!files.length) return
    setBusy(true); setError(''); setMessage('')
    try {
      for (const file of files) {
        const body = new FormData(); body.append('file', file); if (level !== 'auto') body.append('level', level)
        await api('/source-controls/uploads', { method: 'POST', body })
      }
      setMessage(t('文件已校验并保存。', 'Files validated and saved.')); setFiles([])
    } catch (error) { setError(t('上传失败，请检查六列表头、必填内容及重复的来源和编号。', 'Upload failed. Check the six headers, required values and duplicate source/identifier pairs.') + ' ' + (error instanceof Error ? error.message : '')) }
    finally { await refresh(); setBusy(false) }
  }
  const rows = state.controls.filter(row => (!source || row.source === source) && Object.values(row).join(' ').toLowerCase().includes(search.toLowerCase()))
  return <><div className="page-heading"><div><h1>{t('MLPS 控制条目库', 'MLPS control library')}</h1><p>{t('六字段来源结构：来源、控制编号、安全域、安全控制点、控制要求、风险等级。', 'Six fields: source, control identifier, security domain, security control point, control requirement and risk level.')}</p></div></div>
    {state.can_upload && <section className="paper-panel"><h2>{t('上传控制条目', 'Upload controls')}</h2><p>source, control_identifier, security_domain, security_control_point, control_requirement, risk_level</p><p>{t('支持 UTF-8 CSV 或 XLSX，可选择多份文件；每份文件整批校验后保存。重复文件不会重复导入。', 'Upload UTF-8 CSV or XLSX files. Each file is validated and saved atomically. Repeated files are not imported twice.')}</p><label>{t('文件适用 MLPS 等级', 'File MLPS level')}<select value={level} onChange={event => setLevel(event.target.value)} disabled={busy}><option value="auto">{t('按 MLPS_level_1/2/3_CN 文件名识别', 'Read MLPS_level_1/2/3_CN filename')}</option>{[1, 2, 3].map(n => <option key={n} value={n}>MLPS {n}</option>)}</select></label><input aria-label={t('选择控制条目文件', 'Select control files')} type="file" accept=".csv,.xlsx" multiple disabled={busy} onChange={event => setFiles(Array.from(event.target.files ?? []))} /><Button busy={busy} disabled={!files.length} onClick={() => void upload()}>{t('校验并保存', 'Validate and save')}</Button>{error && <Notice error>{error}</Notice>}{message && <Notice>{message}</Notice>}</section>}
    <section className="paper-panel"><p>{state.matching_ready ? t('已发布，可按文件的 MLPS 等级匹配控制；High 条目无法实施时安全评估不通过。', 'Published for file-level MLPS matching. An unimplementable High control fails security assessment.') : t('尚未关联 MLPS 等级的文件只保存来源，待配置后参与评估匹配。', 'Files without an MLPS level remain source records until mapped.')}</p><label>{t('来源', 'Source')}<select value={source} onChange={event => setSource(event.target.value)}><option value="">{t('全部', 'All')}</option>{[...new Set(state.controls.map(row => row.source))].map(value => <option key={value}>{value}</option>)}</select></label><label>{t('搜索', 'Search')}<input value={search} onChange={event => setSearch(event.target.value)} /></label><p>{rows.length} {t('条控制', 'controls')}</p>{rows.map(row => <details className="intake-section" key={row.id}><summary>{row.control_identifier} · {row.security_control_point}</summary><div className="intake-body"><p>{row.source} · {row.mlps_level ? `MLPS ${row.mlps_level}` : '—'} · {row.security_domain} · {row.risk_level}</p><p className="preserve-lines">{row.control_requirement}</p><small>{row.sheet} · {t('行', 'Row')} {row.row_number}</small></div></details>)}</section></>
}
