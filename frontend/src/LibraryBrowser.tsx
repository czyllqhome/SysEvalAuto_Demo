import { useState } from 'react'
import { Button, Notice } from './components'
import { useLocale } from './i18n'
import DownwardSelect from './DownwardSelect'
import type { Config, LibraryControl, LibraryState } from './libraryTypes'

export type LibraryRelease = { publication_mode?: string; catalog_id: string; version: string; created_at: number; controls: LibraryControl[]; config: Config }

export default function LibraryBrowser({ data, releases, historyError, edit, bulkDelete, busy = false }: {
  data: LibraryState; releases: LibraryRelease[]; historyError: boolean; edit: (c: LibraryControl) => void;
  bulkDelete?: (ids: string[], reason: string) => Promise<boolean>; busy?: boolean
}) {
  const { t, locale } = useLocale()
  const [view, setView] = useState<'cards' | 'list'>('cards')
  const [release, setRelease] = useState('')
  const [filters, setFilters] = useState<Record<string, string>>({})
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState<string[]>([])
  const [confirming, setConfirming] = useState(false)
  const [reason, setReason] = useState('')
  const resetSelection = () => { setSelected([]); setConfirming(false); setReason('') }
  const snapshot = releases.find(r => r.catalog_id === release)
  const controls = snapshot?.controls ?? data.controls
  const config = snapshot?.config ?? data.config
  const change = (key: string, value: string) => { setFilters({ ...filters, [key]: value }); setPage(0); resetSelection() }
  const labels = (codes: string[], definitions: Config['domains']) => codes.map(code => definitions.find(d => d.code === code)?.[locale] ?? code).join(' / ')
  const levels = (c: LibraryControl) => [...new Set(config.profiles.filter(p => c.assessment_profiles.includes(p.code)).map(p => p.level ?? ''))]
  const frameworkName = (c: LibraryControl) => c.source_framework.trim().toUpperCase() === 'MLPS' && [2, 3].includes(c.source_level ?? 0)
    ? `MLPS Level ${c.source_level}` : c.source_framework
  const filtered = controls.filter(c => {
    const status = c.retired ? 'retired' : c.review_status
    const searchable = [c.control_code, ...Object.values(c.translations).flatMap(v => Object.values(v)), c.source_framework, c.source_version, c.source_ref, c.assessment_object, labels(c.topic_tags, config.topics), labels(c.assessment_profiles, config.profiles), labels([c.domain_code], config.domains)].join(' ').toLowerCase()
    return (!filters.search || searchable.includes(filters.search.trim().toLowerCase())) &&
      (!filters.framework || frameworkName(c) === filters.framework) &&
      (!filters.sourceLevel || String(c.source_level ?? '') === filters.sourceLevel) &&
      (!filters.level || levels(c).includes(filters.level)) &&
      (!filters.profile || c.assessment_profiles.includes(filters.profile)) &&
      (!filters.domain || c.domain_code === filters.domain) &&
      (!filters.topic || c.topic_tags.includes(filters.topic)) &&
      (!filters.status || status === filters.status)
  })
  const lastPage = Math.max(0, Math.ceil(filtered.length / 30) - 1)
  const currentPage = Math.min(page, lastPage)
  const options = (key: string, title: string, values: { code: string; label: string }[]) => <label>{title}<select value={filters[key] ?? ''} onChange={e => change(key, e.target.value)}><option value="">{t('全部', 'All')}</option>{values.map(v => <option key={v.code} value={v.code}>{v.label}</option>)}</select></label>
  return <section className="library-browser" aria-label={t('控制条目浏览', 'Browse controls')}>
    <div className="library-filters">
      <label>{t('查看版本', 'View version')}<select value={release} onChange={e => { setRelease(e.target.value); setFilters({}); setPage(0); resetSelection() }}><option value="">{t('当前草稿', 'Current draft')} · {data.version}</option>{releases.map(r => <option key={r.catalog_id} value={r.catalog_id}>{t('已发布', 'Published')} · {r.version}</option>)}</select></label>
      <label className="library-search">{t('搜索控制', 'Search controls')}<input placeholder={t('编号、要求、标签或来源条款', 'Code, requirement, tags or source reference')} value={filters.search ?? ''} onChange={e => change('search', e.target.value)} /></label>
      {options('framework', t('来源框架', 'Source framework'), [...new Set(controls.map(frameworkName).filter(Boolean))].sort().map(code => ({ code, label: code })))}
      {options('sourceLevel', t('来源标准等级', 'Source standard level'), [...new Set(controls.map(c => c.source_level).filter(v => v != null && String(v) !== ''))].sort().map(v => ({ code: String(v), label: t(`${v}级`, `Level ${v}`) })))}
      {options('level', t('系统适用等级', 'System applicability level'), ['L1', 'L2', 'L3'].map(code => ({ code, label: code })))}
      {options('profile', t('适用评估方案', 'Assessment profile'), config.profiles.map(d => ({ code: d.code, label: d[locale] })))}
      <DownwardSelect label={t('控制域', 'Control domain')} value={filters.domain ?? ''}
        options={[{ code: '', label: t('全部', 'All') }, ...config.domains.map(d => ({ code: d.code, label: d[locale] }))]}
        onChange={value => change('domain', value)} />
      {options('topic', t('主题标签', 'Topic tag'), config.topics.map(d => ({ code: d.code, label: d[locale] })))}
      {options('status', t('条目状态', 'Control status'), [{ code: 'draft', label: t('待审核', 'Awaiting review') }, { code: 'reviewed', label: t('已审核', 'Reviewed') }, { code: 'retired', label: t('已停用', 'Retired') }])}
      <div className="library-filter-reset"><Button variant="secondary" onClick={() => { setFilters({}); setPage(0); resetSelection() }}>{t('清除筛选', 'Clear filters')}</Button></div>
    </div>
    {historyError && <Notice error>{t('已发布版本加载失败，请刷新重试。', 'Could not load published versions. Refresh to retry.')}</Notice>}
    <div className="stage-actions"><p aria-live="polite">{t('符合筛选', 'Matching')} {filtered.length} / {controls.length} {t('条控制', 'controls')}</p><div className="segmented library-view-switch" role="group" aria-label={t('显示方式', 'View mode')}><button type="button" className={view === 'cards' ? 'active' : ''} aria-pressed={view === 'cards'} onClick={() => setView('cards')}>{t('卡片', 'Cards')}</button><button type="button" className={view === 'list' ? 'active' : ''} aria-pressed={view === 'list'} onClick={() => setView('list')}>{t('列表', 'List')}</button></div></div>
    {data.can_edit && !release && bulkDelete && <fieldset disabled={busy}>
      <div className="stage-actions"><span>{t('已选择', 'Selected')} {selected.length}</span>
        <Button variant="secondary" disabled={!filtered.length} onClick={() => { setSelected(filtered.map(c => c.control_id!)); setConfirming(false) }}>{t('选择全部筛选结果（跨页）', 'Select all matches (all pages)')}</Button>
        <Button variant="secondary" onClick={resetSelection}>{t('取消选择', 'Clear selection')}</Button>
        <Button disabled={!selected.length} onClick={() => setConfirming(true)}>{t('批量删除', 'Bulk delete')}</Button></div>
      {confirming && <div className="paper-panel"><h3>{t('确认删除所选草稿控制项', 'Confirm deletion from draft')}</h3>
        <p>{t(`将从当前草稿删除 ${selected.length} 条控制。已发布版本、历史评估和审计记录保留；发布新版本后才改变新评估的控制范围。`, `Remove ${selected.length} controls from the current draft. Published versions, historical assessments and audit records remain. Publish a new version to change the scope for new assessments.`)}</p>
        <details><summary>{t('查看所选条目', 'View selected controls')}</summary>{controls.filter(c => selected.includes(c.control_id!)).map(c => <p key={c.control_id}>{c.control_code} · {(c.translations[locale] ?? Object.values(c.translations)[0]).title}</p>)}</details>
        <label>{t('删除原因', 'Deletion reason')}<textarea value={reason} onChange={e => setReason(e.target.value)} /></label>
        <Button disabled={!reason.trim()} onClick={async () => { if (await bulkDelete(selected, reason)) resetSelection() }}>{t('确认批量删除', 'Confirm bulk deletion')}</Button>
        <Button variant="secondary" onClick={() => setConfirming(false)}>{t('取消', 'Cancel')}</Button></div>}
    </fieldset>}
    <p className="field-hint">{t('来源标准等级与系统等级分别筛选。系统等级按评估方案的显式映射检索；具体是否适用还需结合系统事实与条件规则确认。', 'Source levels and system levels are separate filters. System levels use explicit profile mappings; actual applicability also depends on system facts and rules.')}</p>
    {!controls.length ? <div className="paper-panel"><h2>{t('当前版本尚无控制条目', 'No controls in this version')}</h2><p>{data.can_edit ? t('请新增控制项，或上传七列标签表、MLPS 原始表或标准 Excel。七列标签表按 source 和 label 支持框架与控制域筛选；检查预览后合并草稿并发布。', 'Create a control or upload a seven-column labeled workbook, MLPS source or standard Excel. Labeled sheets support framework and domain filters through source and label. Review the preview, apply to draft and publish.') : t('请联系管理员导入并发布控制库。', 'Ask an administrator to import and publish controls.')}</p></div> : !filtered.length ? <Notice>{t('没有符合当前筛选条件的控制条目，请调整或清除筛选。', 'No controls match these filters. Adjust or clear them.')}</Notice> : <div className={`control-library-grid${view === 'list' ? ' control-library-list' : ''}`}>{filtered.slice(currentPage * 30, (currentPage + 1) * 30).map(c => {
      const text = c.translations[locale] ?? Object.values(c.translations)[0]
      return <article className="library-control" key={c.control_code}>{data.can_edit && !release && bulkDelete && <label className="check-label"><input type="checkbox" disabled={busy} checked={selected.includes(c.control_id!)} onChange={e => { setSelected(e.target.checked ? [...selected, c.control_id!] : selected.filter(id => id !== c.control_id)); setConfirming(false) }} />{t('选择', 'Select')} {c.control_code}</label>}<span className="mono">{c.control_code} · r{c.revision ?? 1}</span><h3>{text.title}</h3><p>{text.description}</p>
        <dl><dt>{t('来源', 'Source')}</dt><dd>{[c.source_framework, c.source_version, c.source_level ? t(`${c.source_level}级`, `Level ${c.source_level}`) : '', c.source_ref].filter(Boolean).join(' · ') || '—'}</dd>
          <dt>{t('控制域', 'Control domain')}</dt><dd>{labels([c.domain_code], config.domains)}</dd><dt>{t('适用评估方案', 'Assessment profile')}</dt><dd>{labels(c.assessment_profiles, config.profiles)} · {levels(c).join(' / ')}</dd></dl>
        <p>{c.retired ? t('已停用', 'Retired') : c.review_status === 'reviewed' ? t('已审核', 'Reviewed') : t('规则草案待审核', 'Rule draft awaiting review')} · {c.required ? t('适用时必选', 'Required when applicable') : t('可选', 'Optional')}</p>
        <details><summary>{t('评估证据与适用条件', 'Evidence and applicability')}</summary><p>{text.verification}</p><p>{t('评估对象', 'Assessment object')}: {c.assessment_object || '—'}</p><p>{labels(c.topic_tags, config.topics)}</p><p>{c.rule === true ? t('始终适用', 'Always applicable') : c.rule.any.map(g => g.all.map(a => `${config.questions.find(q => q.code === a.tag)?.[locale] ?? a.tag} = ${JSON.stringify(a.value)}`).join(t(' 且 ', ' AND '))).join(t(' 或 ', ' OR '))}</p><p>{c.change_reason}</p></details>
        {data.can_edit && !release && <div className="stage-actions"><Button variant="secondary" onClick={() => edit(c)}>{t('编辑', 'Edit')}</Button><Button variant="secondary" onClick={() => { const copy = structuredClone(c); delete copy.control_id; delete copy.revision; copy.control_code += '-COPY'; copy.retired = false; copy.review_status = 'draft'; edit(copy) }}>{t('复制', 'Duplicate')}</Button></div>}
      </article>
    })}</div>}
    {!!filtered.length && <div className="pagination"><Button variant="secondary" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>{t('上一页', 'Previous')}</Button><span>{currentPage + 1} / {lastPage + 1}</span><Button variant="secondary" disabled={currentPage === lastPage} onClick={() => setPage(currentPage + 1)}>{t('下一页', 'Next')}</Button></div>}
    <Notice>{t('业务负责人可在所负责评估的“控制审查”中手动纳入控制或新增项目专属控制，并记录变更。参与编辑后不能兼任该评估的评审或最终确认。组织控制库的维护与发布由管理员完成。', 'Project managers can manually include controls or add project-only controls in their assessment’s Control review. Contributors cannot review or finalize the same assessment. Administrators maintain and publish the organization library.')}</Notice>
  </section>
}
