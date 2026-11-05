import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BookOpen, ChevronRight, FileText, Layers3, Search, ShieldAlert, UploadCloud } from 'lucide-react'
import { api } from './api'
import { Button, Modal, Notice } from './components'
import { useLocale } from './i18n'
import type { LibraryState } from './libraryTypes'

type SourceControl = {
  id: string; source: string; control_identifier: string; security_domain: string;
  security_control_point: string; control_requirement: string; risk_level: string;
  sheet: string; row_number: number; mlps_level?: number; assessment_procedure?: string;
}
type SourceState = { active: boolean; can_upload: boolean; matching_ready?: boolean; controls: SourceControl[] }
const PAGE_SIZE = 24

export default function MLPSLibrary() {
  const { t } = useLocale()
  const source = useQuery({ queryKey: ['source-controls'], queryFn: () => api<SourceState>('/source-controls') })
  const legacy = useQuery({ queryKey: ['library'], queryFn: () => api<LibraryState>('/library'), enabled: !source.isPending && (source.isError || !source.data?.active) })
  if (source.isPending) return <div className="control-catalog-loading" role="status">{t('正在读取控制条目…', 'Loading controls…')}</div>
  if (source.data?.active) return <Catalog state={source.data} refresh={() => source.refetch()} />
  if (legacy.isPending) return <div className="control-catalog-loading" role="status">{t('正在读取控制条目…', 'Loading controls…')}</div>
  if (legacy.error || !legacy.data) return <Notice error>{t('控制条目库加载失败，请刷新重试。', 'Could not load the control library. Refresh and retry.')}</Notice>
  // Older read-only releases use the same browsing layout. Their pinned text and references stay intact.
  const controls: SourceControl[] = legacy.data.controls.map(control => {
    const text = control.translations.zh ?? Object.values(control.translations)[0]
    const origin = control.source as { languages?: Record<string, { filename?: string; row?: number }> } | undefined
    return {
      id: control.control_id ?? control.control_code,
      source: control.source_framework || t('历史来源', 'Historical source'),
      control_identifier: control.source_ref || control.control_code,
      security_domain: legacy.data!.config?.domains?.find(domain => domain.code === control.domain_code)?.zh ?? control.domain_code ?? '',
      security_control_point: text?.title ?? control.control_code,
      control_requirement: text?.description ?? '',
      risk_level: '', sheet: origin?.languages?.zh?.filename ?? '', row_number: origin?.languages?.zh?.row ?? 0,
      mlps_level: control.source_level ?? undefined, assessment_procedure: text?.verification ?? '',
    }
  })
  return <Catalog state={{ active: false, can_upload: false, matching_ready: !!legacy.data.published_id, controls }} refresh={() => legacy.refetch()} />
}

function Catalog({ state, refresh }: { state: SourceState; refresh: () => Promise<unknown> }) {
  const { t, locale } = useLocale()
  const [uploadOpen, setUploadOpen] = useState(false)
  const [selected, setSelected] = useState<SourceControl | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [uploadLevel, setUploadLevel] = useState('auto')
  const [search, setSearch] = useState('')
  const [source, setSource] = useState('')
  const [domain, setDomain] = useState('')
  const [risk, setRisk] = useState('')
  const [level, setLevel] = useState('')
  const [page, setPage] = useState(0)
  const controls = state.controls
  const high = (value: string) => /^(high|高)/i.test(value.trim())
  const sourceLabel = (value: string) => value.replace(/MLPS/gi, locale === 'zh' ? '等级保护' : 'Classified protection')
  const domains = [...new Set(controls.map(row => row.security_domain).filter(Boolean))].sort((a, b) => a.localeCompare(b, locale === 'zh' ? 'zh-CN' : 'en'))
  const sources = [...new Set(controls.map(row => row.source).filter(Boolean))].sort((a, b) => a.localeCompare(b))
  const risks = [...new Set(controls.map(row => row.risk_level).filter(Boolean))].sort((a, b) => a.localeCompare(b))
  const levels = [...new Set(controls.map(row => row.mlps_level).filter((value): value is number => value != null))].sort()
  const matches = controls.filter(row => {
    const haystack = [row.control_identifier, row.security_control_point, row.control_requirement, row.source,
      row.security_domain, row.risk_level, row.sheet, row.assessment_procedure].join(' ').toLocaleLowerCase()
    return (!search.trim() || haystack.includes(search.trim().toLocaleLowerCase()))
      && (!source || row.source === source) && (!domain || row.security_domain === domain)
      && (!risk || row.risk_level === risk) && (!level || String(row.mlps_level ?? '') === level)
  })
  const pageCount = Math.max(1, Math.ceil(matches.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount - 1)
  const visible = matches.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE)
  const update = (setter: (value: string) => void, value: string) => { setter(value); setPage(0) }
  const clear = () => { setSearch(''); setSource(''); setDomain(''); setRisk(''); setLevel(''); setPage(0) }
  const filtered = Boolean(search || source || domain || risk || level)

  async function upload() {
    if (!files.length || busy) return
    setBusy(true); setError(''); setMessage('')
    try {
      for (const file of files) {
        const body = new FormData()
        body.append('file', file)
        if (uploadLevel !== 'auto') body.append('level', uploadLevel)
        await api('/source-controls/uploads', { method: 'POST', body })
      }
      setMessage(t('文件已校验并保存。', 'Files validated and saved.'))
      setFiles([]); setUploadLevel('auto'); setUploadOpen(false)
    } catch (cause) {
      setError(t('上传失败，请检查表头、必填内容及重复的来源和编号。', 'Upload failed. Check headers, required values and duplicate source/identifier pairs.')
        + ' ' + (cause instanceof Error ? cause.message : ''))
    } finally { await refresh(); setBusy(false) }
  }

  return <div className="control-catalog">
    <header className="catalog-heading"><div><span className="eyebrow">CONTROL LIBRARY</span><h1>{t('控制条目库', 'Control library')}</h1>
      <p>{t('集中查阅控制要求、来源与风险等级，按业务需要快速定位条目。', 'Browse control requirements, sources and risk levels in one searchable workspace.')}</p></div>
      {state.can_upload && <Button onClick={() => setUploadOpen(true)}><UploadCloud size={17} />{t('导入条目', 'Import controls')}</Button>}</header>

    {message && <Notice>{message}</Notice>}
    <section className="catalog-metrics" aria-label={t('条目概览', 'Control overview')}>
      <div><BookOpen size={20} /><span>{t('条目总数', 'Total controls')}</span><strong>{controls.length}</strong></div>
      <div><ShieldAlert size={20} /><span>{t('高风险条目', 'High risk controls')}</span><strong>{controls.filter(row => high(row.risk_level)).length}</strong></div>
      <div><Layers3 size={20} /><span>{t('来源数量', 'Sources')}</span><strong>{sources.length}</strong></div>
      <div><FileText size={20} /><span>{t('控制域', 'Domains')}</span><strong>{domains.length}</strong></div>
    </section>

    <div className={`catalog-state ${state.matching_ready ? 'ready' : 'pending'}`} role="status">
      <span className="catalog-state-dot" /><strong>{state.matching_ready ? t('已发布', 'Published') : t('来源待配置', 'Source mapping pending')}</strong>
      <span>{state.matching_ready
        ? t('已按来源等级建立匹配；高风险条目无法实施时仍按现有评估规则处理。', 'Controls are mapped by source level. Existing review rules still apply to unimplementable high risk items.')
        : t('未关联等级的来源记录保留原文，完成配置后可参与评估匹配。', 'Unmapped source records retain their original text until configured for assessment matching.')}</span>
    </div>

    <div className="catalog-workspace">
      <aside className="catalog-domain-panel" aria-label={t('按控制域浏览', 'Browse by domain')}><div className="catalog-domain-heading"><h2>{t('控制域', 'Domains')}</h2><span>{domains.length}</span></div>
        <button className={!domain ? 'active' : ''} onClick={() => update(setDomain, '')} aria-pressed={!domain}><span>{t('全部条目', 'All controls')}</span><b>{controls.length}</b></button>
        {domains.map(value => <button key={value} className={domain === value ? 'active' : ''} onClick={() => update(setDomain, value)} aria-pressed={domain === value} title={value}><span>{value}</span><b>{controls.filter(row => row.security_domain === value).length}</b></button>)}
      </aside>

      <section className="catalog-results" aria-labelledby="catalog-results-title">
        <div className="catalog-results-head"><div><span className="eyebrow">BROWSE & FILTER</span><h2 id="catalog-results-title">{t('条目检索', 'Browse controls')}</h2></div><span className="catalog-results-count" aria-live="polite">{t('符合筛选', 'Matching')} <strong>{matches.length}</strong> / {controls.length}</span></div>
        <div className="catalog-toolbar"><label className="catalog-search"><Search size={17} /><input aria-label={t('搜索控制条目', 'Search controls')} placeholder={t('搜索编号、控制点、要求或来源', 'Search identifier, point, requirement or source')} value={search} onChange={event => update(setSearch, event.target.value)} /></label>
          <label>{t('来源', 'Source')}<select value={source} onChange={event => update(setSource, event.target.value)}><option value="">{t('全部来源', 'All sources')}</option>{sources.map(value => <option key={value} value={value}>{sourceLabel(value)}</option>)}</select></label>
          <label>{t('风险', 'Risk')}<select value={risk} onChange={event => update(setRisk, event.target.value)}><option value="">{t('全部风险', 'All risks')}</option>{risks.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
          <label>{t('来源等级', 'Source level')}<select value={level} onChange={event => update(setLevel, event.target.value)}><option value="">{t('全部等级', 'All levels')}</option>{levels.map(value => <option key={value} value={value}>{t(`${value} 级`, `Level ${value}`)}</option>)}</select></label>
        </div>
        {filtered && <div className="catalog-filter-line"><span>{t('筛选已生效', 'Filters applied')}</span><Button variant="text" onClick={clear}>{t('清除筛选', 'Clear filters')}</Button></div>}
        <div className="catalog-table-scroll"><table><thead><tr><th scope="col">{t('编号与控制点', 'Identifier and control point')}</th><th scope="col">{t('控制域 / 来源', 'Domain / source')}</th><th scope="col">{t('等级', 'Level')}</th><th scope="col">{t('风险', 'Risk')}</th><th scope="col">{t('操作', 'Action')}</th></tr></thead><tbody>
          {visible.map(row => <tr key={row.id}><td><div className="catalog-title"><code>{row.control_identifier}</code><strong>{row.security_control_point}</strong></div></td>
            <td><div className="catalog-source"><strong>{row.security_domain || '—'}</strong><span>{sourceLabel(row.source) || '—'}</span></div></td>
            <td>{row.mlps_level ? <span className="catalog-level">{t(`${row.mlps_level} 级`, `Level ${row.mlps_level}`)}</span> : '—'}</td>
            <td><span className={`catalog-risk ${high(row.risk_level) ? 'high' : /medium|中/i.test(row.risk_level) ? 'medium' : 'other'}`}>{row.risk_level || '—'}</span></td>
            <td><Button variant="secondary" onClick={() => setSelected(row)}>{t('查看详情', 'View details')}<ChevronRight size={14} /></Button></td></tr>)}
        </tbody></table></div>
        {!visible.length && <div className="catalog-empty"><Search size={24} /><strong>{controls.length ? t('没有符合条件的条目', 'No matching controls') : t('当前还没有控制条目', 'No controls yet')}</strong><p>{controls.length ? t('调整关键词或清除筛选后重试。', 'Adjust the search or clear filters and try again.') : t('由管理员导入来源文件后，可在此检索和查阅。', 'Ask an administrator to import source files to browse controls here.')}</p>{filtered && <Button variant="secondary" onClick={clear}>{t('清除筛选', 'Clear filters')}</Button>}</div>}
        {!!visible.length && <div className="catalog-pagination"><span>{t('显示', 'Showing')} {currentPage * PAGE_SIZE + 1}–{currentPage * PAGE_SIZE + visible.length} / {matches.length}</span><div><Button variant="secondary" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>{t('上一页', 'Previous')}</Button><span>{currentPage + 1} / {pageCount}</span><Button variant="secondary" disabled={currentPage === pageCount - 1} onClick={() => setPage(currentPage + 1)}>{t('下一页', 'Next')}</Button></div></div>}
      </section>
    </div>

    {uploadOpen && <Modal title={t('导入控制条目', 'Import controls')} close={() => { if (!busy) { setUploadOpen(false); setError('') } }}><div className="catalog-upload">
      <p>{t('支持 UTF-8 CSV 或 XLSX，可一次选择多份文件。系统逐份校验、保存，并保留原始来源记录。', 'Upload one or more UTF-8 CSV or XLSX files. Each file is validated and saved with its original source records.')}</p>
      {error && <Notice error>{error}</Notice>}
      <label>{t('文件所属等级', 'File source level')}<select value={uploadLevel} onChange={event => setUploadLevel(event.target.value)} disabled={busy}><option value="auto">{t('按文件名自动识别', 'Detect from filename')}</option>{[1, 2, 3].map(value => <option key={value} value={value}>{t(`${value} 级`, `Level ${value}`)}</option>)}</select></label>
      <label>{t('选择控制条目文件', 'Select control files')}<input type="file" accept=".csv,.xlsx" multiple disabled={busy} onChange={event => setFiles(Array.from(event.target.files ?? []))} /></label>
      <details><summary>{t('查看导入字段', 'View import columns')}</summary><code>source, control_identifier, security_domain, security_control_point, control_requirement, risk_level</code></details>
      <div className="catalog-modal-actions"><Button variant="secondary" disabled={busy} onClick={() => setUploadOpen(false)}>{t('取消', 'Cancel')}</Button><Button busy={busy} disabled={!files.length} onClick={() => void upload()}>{t('校验并保存', 'Validate and save')}</Button></div>
    </div></Modal>}

    {selected && <Modal title={t('控制条目详情', 'Control details')} close={() => setSelected(null)} wide><div className="catalog-detail">
      <div className="catalog-detail-head"><div><span className="eyebrow">SOURCE CONTROL</span><code>{selected.control_identifier}</code><h2>{selected.security_control_point}</h2></div><span className={`catalog-risk ${high(selected.risk_level) ? 'high' : /medium|中/i.test(selected.risk_level) ? 'medium' : 'other'}`}>{selected.risk_level || '—'}</span></div>
      <div className="catalog-detail-meta"><div><span>{t('控制域', 'Domain')}</span><strong>{selected.security_domain || '—'}</strong></div><div><span>{t('来源', 'Source')}</span><strong>{sourceLabel(selected.source) || '—'}</strong></div><div><span>{t('来源等级', 'Source level')}</span><strong>{selected.mlps_level ? t(`${selected.mlps_level} 级`, `Level ${selected.mlps_level}`) : '—'}</strong></div></div>
      <section><h3>{t('控制要求原文', 'Original requirement')}</h3><p className="preserve-lines">{selected.control_requirement}</p></section>
      {selected.assessment_procedure && <section><h3>{t('测评步骤原文', 'Original assessment procedure')}</h3><p className="preserve-lines">{selected.assessment_procedure}</p></section>}
      <div className="catalog-provenance"><FileText size={16} /><span>{t('来源文件记录', 'Source file record')} · {selected.sheet ? sourceLabel(selected.sheet) : '—'}{selected.row_number ? ` · ${t('第', 'Row ')}${selected.row_number}${locale === 'zh' ? ' 行' : ''}` : ''}</span></div>
    </div></Modal>}
  </div>
}
