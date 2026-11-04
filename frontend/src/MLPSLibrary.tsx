import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from './api'
import { Notice } from './components'
import { useLocale } from './i18n'
import type { LibraryState } from './libraryTypes'

export default function MLPSLibrary() {
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
