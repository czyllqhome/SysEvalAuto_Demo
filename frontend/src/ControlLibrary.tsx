import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from './api'
import { Button, Notice } from './components'
import { useLocale } from './i18n'
import LibraryBrowser from './LibraryBrowser'
import type { LibraryRelease } from './LibraryBrowser'
import { FactFields } from './TagClassification'
import type { Atom, Config, Definition, Fact, LibraryControl, LibraryState, Rule } from './libraryTypes'

function ControlSummary({ item }: { item: LibraryControl | null }) {
  const { t, locale } = useLocale()
  if (!item) return <p>—</p>
  const text = item.translations[locale] ?? Object.values(item.translations)[0]
  return <div><h4>{text.title}</h4><p>{text.description}</p><p>{text.verification}</p><p>{item.assessment_profiles.join(' / ')} · {item.required ? t('必选', 'Required') : t('可选', 'Optional')}</p><p>{item.rule === true ? t('始终适用', 'Always applicable') : item.rule.any.map(g => g.all.map(a => `${a.tag} ${a.op} ${JSON.stringify(a.value)}`).join(' AND ')).join(' OR ')}</p><p>{item.source_ref}</p><p>{item.review_status} · {item.responsibility_rule}</p></div>
}

export function RuleEditor({ rule, config, onChange }: { rule: Rule; config: Config; onChange: (r: Rule) => void }) {
  const { t, locale } = useLocale()
  const first = config.questions[0]
  const makeAtom = (q = first): Atom => ({ tag: q.code, op: q.kind === 'multi' ? 'in' : 'eq', value: q.kind === 'number' ? 0 : q.kind === 'multi' ? [q.values![0]] : q.values![0] })
  const groups = rule === true ? [] : rule.any
  return <div className="rule-editor"><label>{t('适用方式', 'Applicability')}<select value={rule === true ? 'always' : 'conditional'} onChange={e => onChange(e.target.value === 'always' ? true : { any: [{ all: [makeAtom()] }] })}><option value="always">{t('始终适用', 'Always applicable')}</option><option value="conditional">{t('满足条件', 'Conditional')}</option></select></label>{groups.map((group, i) => <div className="rule-group" key={i}><strong>{t('任一组满足；组内全部满足', 'Any group matches; all conditions within a group')} {i + 1}</strong>{group.all.map((atom, j) => {
    const q = config.questions.find(q => q.code === atom.tag) ?? first
    const patch = (next: Atom) => onChange({ any: groups.map((g, n) => n === i ? { all: g.all.map((a, k) => k === j ? next : a) } : g) })
    return <div className="intake-fields" key={j}><select aria-label={t('事实标签', 'Fact tag')} value={atom.tag} onChange={e => patch(makeAtom(config.questions.find(q => q.code === e.target.value)!))}>{config.questions.map(q => <option key={q.code} value={q.code}>{q[locale]} ({q.code})</option>)}</select>{q.kind === 'number' ? <input aria-label={t('条件值', 'Condition value')} type="number" min={0} value={Number(atom.value)} onChange={e => patch({ ...atom, value: Number(e.target.value) })} /> : <select aria-label={t('条件值', 'Condition value')} multiple={q.kind === 'multi'} value={q.kind === 'multi' ? Array.isArray(atom.value) ? atom.value : [String(atom.value)] : String(atom.value)} onChange={e => patch({ ...atom, value: q.kind === 'multi' ? Array.from(e.target.selectedOptions).map(o => o.value) : e.target.value })}>{q.values!.filter(v => v !== 'unknown').map(v => <option key={v}>{v}</option>)}</select>}<Button variant="secondary" onClick={() => onChange({ any: groups.map((g, n) => n === i ? { all: g.all.filter((_, k) => k !== j) } : g).filter(g => g.all.length) })}>{t('移除条件', 'Remove condition')}</Button></div>
  })}<Button variant="secondary" onClick={() => onChange({ any: groups.map((g, n) => n === i ? { all: [...g.all, makeAtom()] } : g) })}>{t('增加 AND 条件', 'Add AND condition')}</Button></div>)}{rule !== true && <Button variant="secondary" onClick={() => onChange({ any: [...groups, { all: [makeAtom()] }] })}>{t('增加 OR 条件组', 'Add OR group')}</Button>}</div>
}

function blank(config: Config): LibraryControl {
  return { control_code: '', translations: { zh: { title: '', description: '', verification: '' } }, assessment_object: '',
    domain_code: config.domains[0].code, assessment_profiles: config.profiles[0] ? [config.profiles[0].code] : [], required: true, topic_tags: [],
    applicability_mode: 'always', rule: true, responsibility_rule: 'customer', source_framework: 'CUSTOM', source_version: '',
    source_ref: '', control_family_id: '', change_reason: '', review_status: 'draft', retired: false }
}

export default function ControlLibrary() {
  const { t, locale, error: translate } = useLocale()
  const client = useQueryClient()
  const query = useQuery({ queryKey: ['library'], queryFn: () => api<LibraryState>('/library') })
  const history = useQuery({ queryKey: ['library-history'], queryFn: () => api<LibraryRelease[]>('/library/history') })
  const [editor, setEditor] = useState<LibraryControl | null>(null)
  const [editorVersion, setEditorVersion] = useState(0)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('')
  const [preview, setPreview] = useState<{ id: string; annotated?: boolean; warnings?: { zh: string; en: string }[]; errors: unknown[]; changes: { code: string; operation: string; before: LibraryControl | null; after: LibraryControl }[] } | null>(null)
  const [configOpen, setConfigOpen] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [trialFacts, setTrialFacts] = useState<Record<string, Fact>>({})
  const [trialResult, setTrialResult] = useState<{ status: string; answer_refs: string[] } | null>(null)
  async function action(work: () => Promise<void>) {
    setBusy(true); setError(''); setMessage('')
    try { await work() } catch (e) { setError(e instanceof ApiError ? `${translate(e.code)}${e.detail ? '\n' + JSON.stringify(e.detail) : ''}` : translate('NETWORK_ERROR')) }
    finally { setBusy(false) }
  }
  function update(data: LibraryState) { client.setQueryData(['library'], data); void client.invalidateQueries({ queryKey: ['library-history'] }); void client.invalidateQueries({ queryKey: ['controls'] }) }
  if (query.error) return <Notice error>{t('控制库加载失败', 'Could not load the library')}</Notice>
  if (!query.data) return <p>{t('加载中…', 'Loading…')}</p>
  const data = query.data
  async function directPublish() {
    await action(async () => {
      const result = await api<{ state: LibraryState }>('/library/publish', { method: 'POST', body: { version: data.version, publication_mode: 'direct' }, key: crypto.randomUUID() })
      update(result.state); setPublishing(false)
      setMessage(t('控制库已一键发布。返回评估加载最新控制库并重新确认分级，即可继续。', 'Library published directly. Load the latest library in your assessment and reconfirm grading to continue.'))
    })
  }
  function edit(control: LibraryControl) { setEditor(structuredClone(control)); setEditorVersion(data.version); setPublishing(false); setTrialResult(null) }
  function changeEditor(next: LibraryControl) {
    if (next.review_status === editor?.review_status) next.review_status = 'draft'
    setEditor(next); setTrialResult(null)
  }
  async function save(operation: 'create' | 'update' | 'retire') {
    if (!editor) return
    await action(async () => { update(await api('/library/controls', { method: 'POST', body: { version: editorVersion, operation, control: { ...editor, translations: Object.fromEntries(Object.entries(editor.translations).filter(([, fields]) => Object.values(fields).some(v => v.trim()))) } } })); setEditor(null); setMessage(t('草稿已保存，发布后用于新评估。', 'Draft saved. Publish to use it for new assessments.')) })
  }
  async function upload(file?: File) {
    if (!file) return
    await action(async () => { const body = new FormData(); body.append('file', file); setPreview(await api('/library/imports', { method: 'POST', body })); setEditor(null) })
  }
  return <section><div className="page-heading"><div><h1>{t('控制库', 'Control library')}</h1><p>{t('维护控制要求、适用标签与评估依据；支持一键发布或审核后发布。', 'Maintain controls, applicability and evidence. Publish directly or after review.')}</p></div><span>{t('草稿版本', 'Draft revision')} {data.version}</span></div>
    {error && <Notice error>{error}</Notice>}{message && <Notice>{message}</Notice>}
    <div className="stage-actions">{data.can_edit && <><Button onClick={() => edit(blank(data.config))}>{t('新增控制项', 'New control')}</Button><a className="button secondary" href="/api/v1/control-template">{t('下载 Excel 模板', 'Download Excel template')}</a><label className="csv-file">{t('上传 Excel（含七列标签表）', 'Upload Excel (including labeled sheets)')}<input type="file" accept=".xlsx" disabled={busy} onChange={e => void upload(e.target.files?.[0])} /></label><Button variant="secondary" onClick={() => setConfigOpen(!configOpen)}>{t('分类问题与标签', 'Questions & tags')}</Button><Button variant="secondary" disabled={busy || !data.controls.length || !!editor} onClick={() => setPublishing(true)}>{t('预览发布', 'Review publication')}</Button><Button busy={busy} disabled={!!editor || !data.controls.some(c => !c.retired)} onClick={() => void directPublish()}>{t('一键发布', 'Publish now')}</Button></>}<a className="button secondary" href="/api/v1/library/export">{t('导出草稿 Excel', 'Export draft Excel')}</a></div>
    {publishing && <div className="paper-panel"><h2>{t('发布新版本', 'Publish a new release')}</h2><p>{t('此版本包含', 'This release contains')} {data.controls.filter(c => !c.retired).length} {t('条有效控制；未审核', 'active controls; unreviewed')}: {data.controls.filter(c => !c.retired && c.review_status !== 'reviewed').length}。</p><p>{t('已有评估继续使用原版本。', 'Existing assessments retain their pinned versions.')}</p><Button busy={busy} disabled={data.controls.some(c => !c.retired && c.review_status !== 'reviewed')} onClick={() => void action(async () => { const result = await api<{ state: LibraryState }>('/library/publish', { method: 'POST', body: { version: data.version } }); update(result.state); setPublishing(false); setMessage(t('控制库已发布。', 'Library published.')) })}>{t('确认发布', 'Confirm publication')}</Button>{data.can_edit && <Button busy={busy} disabled={!!editor || !data.controls.some(c => !c.retired)} onClick={() => void directPublish()}>{t('一键发布（无需逐项审核）', 'Publish now (no item review)')}</Button>}<Button variant="secondary" onClick={() => setPublishing(false)}>{t('取消', 'Cancel')}</Button></div>}
    {configOpen && <ConfigEditor key={data.version} config={data.config} busy={busy} save={config => void action(async () => { update(await api('/library/config', { method: 'PUT', body: { version: data.version, config } })); setConfigOpen(false) })} />}
    {preview && <div className="paper-panel"><h2>{t('上传预览', 'Upload preview')}</h2>{preview.warnings?.map((warning, i) => <Notice key={i}>{warning[locale]}</Notice>)}{preview.annotated && <a className="button secondary" href={`/api/v1/library/imports/${preview.id}/annotated`}>{t('下载带标签 MLPS 草稿', 'Download tagged MLPS draft')}</a>}<p>{preview.changes.length} {t('条变更', 'changes')} · {preview.errors.length} {t('项错误', 'errors')}</p>{preview.errors.length > 0 && <><pre>{JSON.stringify(preview.errors, null, 2)}</pre><a className="button secondary" href={`/api/v1/library/imports/${preview.id}/errors`}>{t('下载错误清单', 'Download error report')}</a></>}<div className="library-preview">{preview.changes.map(c => <details key={c.code}><summary>{c.code} · {c.operation}</summary><div className="intake-fields"><div><h4>{t('原内容', 'Before')}</h4><ControlSummary item={c.before} /></div><div><h4>{t('新内容', 'After')}</h4><ControlSummary item={c.after} /></div></div></details>)}</div><Button busy={busy} disabled={preview.errors.length > 0} onClick={() => void action(async () => { update(await api(`/library/imports/${preview.id}/apply`, { method: 'POST' })); setPreview(null); setMessage(t('已合并到草稿，请审核各条适用条件后发布。', 'Applied to draft. Review each mapping before publication.')) })}>{t('合并到草稿', 'Apply to draft')}</Button><Button variant="secondary" onClick={() => setPreview(null)}>{t('关闭预览', 'Close preview')}</Button></div>}
    {editor && <div className="paper-panel"><h2>{editor.control_id ? t('修改控制项', 'Edit control') : t('新增控制项', 'New control')}</h2><fieldset disabled={busy}><div className="intake-fields"><label>{t('控制编号', 'Control code')}<input disabled={!!editor.control_id} value={editor.control_code} onChange={e => changeEditor({ ...editor, control_code: e.target.value })} /></label><label>{t('安全域', 'Domain')}<select value={editor.domain_code} onChange={e => changeEditor({ ...editor, domain_code: e.target.value })}>{data.config.domains.map(d => <option key={d.code} value={d.code}>{d[locale]}</option>)}</select></label><label>{t('评估对象', 'Assessment object')}<input value={editor.assessment_object} onChange={e => changeEditor({ ...editor, assessment_object: e.target.value })} /></label></div>
      {(['zh', 'en'] as const).map(lang => <details key={lang} open={lang === locale}><summary>{lang === 'zh' ? '中文内容' : 'English content'}</summary>{(['title', 'description', 'verification'] as const).map(field => <label key={field}>{({ title: t('标题', 'Title'), description: t('控制要求', 'Requirement'), verification: t('评估方法和证据', 'Verification and evidence') })[field]}<textarea rows={field === 'title' ? 2 : 4} value={editor.translations[lang]?.[field] ?? ''} onChange={e => { const translations = { ...editor.translations, [lang]: { ...(editor.translations[lang] ?? { title: '', description: '', verification: '' }), [field]: e.target.value } }; if (Object.values(translations[lang]).every(v => !v)) delete translations[lang]; changeEditor({ ...editor, translations }) }} /></label>)}</details>)}
      <div className="intake-fields"><label>{t('适用评估方案（多选）', 'Assessment profiles (multiple)')}<select multiple value={editor.assessment_profiles} onChange={e => changeEditor({ ...editor, assessment_profiles: Array.from(e.target.selectedOptions).map(o => o.value) })}>{data.config.profiles.map(p => <option key={p.code} value={p.code}>{p[locale]} ({p.level})</option>)}</select></label><label>{t('主题标签（多选）', 'Topic tags (multiple)')}<select multiple value={editor.topic_tags} onChange={e => changeEditor({ ...editor, topic_tags: Array.from(e.target.selectedOptions).map(o => o.value) })}>{data.config.topics.map(p => <option key={p.code} value={p.code}>{p[locale]}</option>)}</select></label><label>{t('责任主体', 'Responsibility')}<select value={editor.responsibility_rule} onChange={e => changeEditor({ ...editor, responsibility_rule: e.target.value })}>{['customer', 'supplier', 'shared', 'by_component'].map(v => <option key={v}>{v}</option>)}</select></label></div>
      <RuleEditor rule={editor.rule} config={data.config} onChange={rule => changeEditor({ ...editor, rule, applicability_mode: rule === true ? 'always' : 'conditional' })} />
      <details><summary>{t('使用示例画像试算适用条件', 'Try applicability with sample facts')}</summary><FactFields config={data.config} facts={trialFacts} setFacts={f => { setTrialFacts(f); setTrialResult(null) }} /><Button variant="secondary" onClick={() => void action(async () => { setTrialResult(await api('/library/rule-preview', { method: 'POST', body: { control: editor, facts: trialFacts, profile: editor.assessment_profiles[0] } })) })}>{t('试算当前条件', 'Test current rule')}</Button>{trialResult && <p>{t('试算快照；编辑规则后请重新试算', 'Trial snapshot; run again after editing')}: {trialResult.status} · {trialResult.answer_refs.join(', ')}</p>}</details>
      <div className="intake-fields">{(['source_framework', 'source_version', 'source_ref', 'control_family_id'] as const).map((field, i) => <label key={field}>{[t('来源框架', 'Source framework'), t('来源版本', 'Source version'), t('来源定位', 'Source reference'), t('跨版本控制族（可选）', 'Control family (optional)')][i]}<input value={editor[field]} onChange={e => changeEditor({ ...editor, [field]: e.target.value })} /></label>)}</div>
      <label>{t('来源标准等级（可选）', 'Source standard level (optional)')}<select value={editor.source_level ?? ''} onChange={e => changeEditor({ ...editor, source_level: e.target.value ? Number(e.target.value) : null })}><option value="">{t('不适用 / 未指定', 'Not applicable / unspecified')}</option><option value="2">{t('2级', 'Level 2')}</option><option value="3">{t('3级', 'Level 3')}</option></select></label>
      {editor.tagging_basis && <Notice>{editor.tagging_basis}</Notice>}<label>{t('修改原因', 'Change reason')}<textarea value={editor.change_reason} onChange={e => changeEditor({ ...editor, change_reason: e.target.value })} /></label><label className="check-label"><input type="checkbox" checked={editor.required} onChange={e => changeEditor({ ...editor, required: e.target.checked })} />{t('适用时为必选控制', 'Required when applicable')}</label><label className="check-label"><input type="checkbox" checked={editor.review_status === 'reviewed'} onChange={e => changeEditor({ ...editor, review_status: e.target.checked ? 'reviewed' : 'draft' })} />{t('已审核条款、适用条件与来源', 'Requirement, applicability and source reviewed')}</label>
      <div className="stage-actions"><Button onClick={() => void save(editor.control_id ? 'update' : 'create')}>{t('保存草稿', 'Save draft')}</Button>{editor.control_id && <Button variant="secondary" disabled={!editor.change_reason.trim()} onClick={() => void save('retire')}>{t('停用此控制', 'Retire control')}</Button>}<Button variant="secondary" onClick={() => setEditor(null)}>{t('取消编辑', 'Cancel edit')}</Button></div></fieldset></div>}
    <LibraryBrowser key={data.version} data={data} releases={history.data ?? []} historyError={!!history.error} edit={edit} busy={busy} bulkDelete={async (control_ids, reason) => {
      let success = false
      await action(async () => {
        update(await api('/library/controls/bulk-delete', { method: 'POST', body: { version: data.version, control_ids, reason } }))
        setEditor(null); setPreview(null); setPublishing(false); success = true
        setMessage(t('已从草稿删除所选控制项；已发布版本和历史评估保留。', 'Selected controls removed from the draft. Published versions and historical assessments remain.'))
      })
      return success
    }} />
    <details><summary>{t('已发布版本与控制历史', 'Published versions and control history')}</summary>{history.data?.map(r => <details key={r.catalog_id}><summary>{r.version} · {r.publication_mode === 'direct' ? t('一键发布', 'Published directly') : t('审核后发布', 'Published after review')} · {new Date(r.created_at * 1000).toLocaleString()} · {r.controls.length}</summary>{r.controls.map(c => <p key={c.control_code}>{c.control_code} · r{c.revision} · {(c.translations[locale] ?? Object.values(c.translations)[0]).title} · {c.change_reason}</p>)}</details>)}</details>
  </section>
}

function ConfigEditor({ config, busy, save }: { config: Config; busy: boolean; save: (c: Config) => void }) {
  const { t } = useLocale()
  const [draft, setDraft] = useState(structuredClone(config))
  const [kind, setKind] = useState<'questions' | 'domains' | 'topics' | 'profiles'>('questions')
  const [entry, setEntry] = useState<Definition>({ code: '', zh: '', en: '', kind: 'enum', group: 'operations', values: ['yes', 'no', 'unknown'], risk: false, when: true, level: 'L2' })
  return <section className="paper-panel"><h2>{t('分类问题与标签配置', 'Question and tag configuration')}</h2><p>{t('新增事实标签同时建立一个分类问题。内置分级输入的含义保持稳定；新标签用于控制筛选。', 'A new fact tag creates a classification question. Built-in grading inputs retain their meanings; new tags drive control matching.')}</p><fieldset disabled={busy}><div className="intake-fields"><label>{t('关键中断阈值（分钟）', 'Critical outage threshold (minutes)')}<input type="number" value={draft.thresholds.critical_minutes} onChange={e => setDraft({ ...draft, thresholds: { ...draft.thresholds, critical_minutes: Number(e.target.value) } })} /></label><label>{t('重要中断阈值（分钟）', 'Important outage threshold (minutes)')}<input type="number" value={draft.thresholds.important_minutes} onChange={e => setDraft({ ...draft, thresholds: { ...draft.thresholds, important_minutes: Number(e.target.value) } })} /></label></div><select value={kind} onChange={e => setKind(e.target.value as typeof kind)}>{(['questions', 'domains', 'topics', 'profiles'] as const).map((k, i) => <option key={k} value={k}>{[t('问题和事实标签', 'Questions and facts'), t('安全域', 'Domains'), t('主题标签', 'Topics'), t('评估方案', 'Profiles')][i]}</option>)}</select><div className="intake-fields">{(['code', 'zh', 'en'] as const).map((k, i) => <label key={k}>{[t('稳定代码', 'Stable code'), '中文名称 / 问题', 'English label / question'][i]}<input value={entry[k]} onChange={e => setEntry({ ...entry, [k]: e.target.value })} /></label>)}</div>{kind === 'questions' && <><select aria-label={t('题型', 'Question type')} value={entry.kind} onChange={e => setEntry({ ...entry, kind: e.target.value as Definition['kind'] })}><option value="enum">{t('单选', 'Single choice')}</option><option value="multi">{t('多选', 'Multiple choice')}</option><option value="number">{t('非负数值', 'Nonnegative number')}</option></select><label>{t('选项代码，以 | 分隔', 'Option codes separated by |')}<input value={entry.values!.join('|')} onChange={e => setEntry({ ...entry, values: e.target.value.split('|') })} /></label><RuleEditor rule={entry.when ?? true} config={draft} onChange={when => setEntry({ ...entry, when })} /></>}{kind === 'profiles' && <select value={entry.level} onChange={e => setEntry({ ...entry, level: e.target.value })}>{['L1', 'L2', 'L3'].map(v => <option key={v}>{v}</option>)}</select>}<Button variant="secondary" disabled={!entry.code || !entry.zh || !entry.en} onClick={() => { setDraft({ ...draft, [kind]: [...draft[kind].filter(d => d.code !== entry.code), structuredClone(entry)] }); setEntry({ ...entry, code: '', zh: '', en: '' }) }}>{t('加入配置草稿', 'Add to configuration draft')}</Button><details><summary>{t('查看/编辑现有定义', 'View/edit definitions')} ({draft[kind].length})</summary>{draft[kind].map(d => <div className="stage-actions" key={d.code}><span>{d.code} · {d.zh} · {d.en}</span><Button variant="secondary" onClick={() => setEntry({ ...entry, ...structuredClone(d) })}>{t('编辑', 'Edit')}</Button></div>)}</details><Button onClick={() => save(draft)}>{t('保存配置草稿', 'Save configuration draft')}</Button></fieldset></section>
}
