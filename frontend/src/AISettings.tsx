import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Archive, ArrowUpRight, BookOpen, ChevronDown, Cpu, FileCode2, FileText, KeyRound, LockKeyhole, RotateCcw, Save, Search, ShieldCheck, SlidersHorizontal, Workflow } from 'lucide-react'
import { api, ApiError } from './api'
import { Button, Notice, useAuth } from './components'
import { useLocale } from './i18n'
import PrdTemplateEditor from './PrdTemplateEditor'

type Values = { model: string; providers: string; zdr: boolean; max_tokens: number; reasoning_tokens: string; prompts: Record<string, string> }
type Settings = Values & { version: number; key_configured: boolean; defaults: Values }
type Localized = { zh: string; en: string }
type Prompt = { key: string; status: 'active' | 'system' | 'legacy'; group: string; title: Localized; usage: Localized; instruction?: string }
type Scope = 'current' | 'legacy' | 'all'
function values(data: Settings): Values {
  return { model: data.model, providers: data.providers, zdr: data.zdr, max_tokens: data.max_tokens, reasoning_tokens: data.reasoning_tokens, prompts: data.prompts }
}

export default function AISettings() {
  const { user } = useAuth(), { t } = useLocale()
  const query = useQuery({ queryKey: ['ai-settings'], queryFn: () => api<Settings>('/admin/ai-settings'), enabled: user.is_admin })
  const catalog = useQuery({ queryKey: ['ai-prompts'], queryFn: () => api<{ items: Prompt[] }>('/admin/ai-prompts'), enabled: user.is_admin })
  if (!user.is_admin) return <Notice error>{t('仅管理员可以管理 AI 配置。', 'Administrator access is required.')}</Notice>
  if (query.error || catalog.error) return <Notice error>{t('配置读取失败。', 'Could not load configuration.')} <Button variant="text" onClick={() => { void query.refetch(); void catalog.refetch() }}>{t('重新加载', 'Retry')}</Button></Notice>
  return query.data && catalog.data ? <Editor initial={query.data} catalog={catalog.data.items} /> : <div className="ai-loading" role="status">{t('正在加载模型配置…', 'Loading model configuration…')}</div>
}

function Editor({ initial, catalog }: { initial: Settings; catalog: Prompt[] }) {
  const { t, locale, error: translate } = useLocale(), client = useQueryClient()
  const [data, setData] = useState(initial), [saved, setSaved] = useState(initial)
  const [selected, setSelected] = useState('prd_generation'), [scope, setScope] = useState<Scope>('current'), [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [problem, setProblem] = useState('')
  const [documentLoaded, setDocumentLoaded] = useState(false)
  const text = (value: Localized) => value[locale]
  const currentCount = catalog.filter(item => item.status !== 'legacy').length
  const legacyCount = catalog.filter(item => item.status === 'legacy').length
  const editableCount = catalog.filter(item => item.status === 'active').length
  const dirty = JSON.stringify(values(data)) !== JSON.stringify(values(saved))
  const changes = Object.keys(values(data)).filter(key => key !== 'prompts' && data[key as keyof Values] !== saved[key as keyof Values]).length
    + Object.keys(data.prompts).filter(key => data.prompts[key] !== saved.prompts[key]).length
  const filtered = catalog.filter(item => (scope === 'all' || (scope === 'legacy' ? item.status === 'legacy' : item.status !== 'legacy'))
    && `${text(item.title)} ${text(item.usage)} ${item.key}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
  const prompt = filtered.find(item => item.key === selected) ?? filtered[0]
  const editable = prompt?.status === 'active'
  const promptText = prompt ? prompt.status === 'system' ? prompt.instruction ?? '' : data.prompts[prompt.key] ?? '' : ''
  const customized = prompt && prompt.status !== 'system' && data.prompts[prompt.key] !== data.defaults.prompts[prompt.key]
  const maxValid = Number.isInteger(data.max_tokens) && data.max_tokens >= 256 && data.max_tokens <= 100000
  const reasoningValid = data.reasoning_tokens === '' || /^\d+$/.test(data.reasoning_tokens) && Number(data.reasoning_tokens) > 0 && Number(data.reasoning_tokens) < data.max_tokens
  const promptsValid = Object.values(data.prompts).every(value => value.trim() && value.length <= 20000)
  const valid = maxValid && reasoningValid && promptsValid
  const reasoning = Number(data.reasoning_tokens) || 0
  const budgetPercent = maxValid && reasoningValid ? reasoning / data.max_tokens * 100 : 0
  const groups: Record<string, string> = { generation: t('需求文档', 'Requirements'), intake: t('系统信息收集', 'System information'), review: t('供应商复核', 'Supplier review'), delivery: t('开发交付', 'Development delivery'), legacy: t('历史流程', 'Historical workflow') }
  const statusName = (status: Prompt['status']) => status === 'active' ? t('可配置', 'Editable') : status === 'system' ? t('系统内置', 'System managed') : t('历史兼容', 'Legacy')

  function change(value: Partial<Values>) { setData(old => ({ ...old, ...value })); setMessage('') }
  async function save() {
    if (!dirty || !valid || busy) return
    setBusy(true); setProblem(''); setMessage('')
    try {
      const result = await api<Settings>('/admin/ai-settings', { method: 'PUT', body: { ...values(data), version: data.version } })
      setData(result); setSaved(result); client.setQueryData(['ai-settings'], result)
      await client.invalidateQueries({ queryKey: ['session'] })
      setMessage(t('配置已保存，新建模型任务使用此修订。', 'Configuration saved. New model jobs use this revision.'))
    } catch (e) { setProblem(e instanceof ApiError ? translate(e.code) : translate('NETWORK_ERROR')) } finally { setBusy(false) }
  }
  async function documentSaved() {
    try {
      const fresh = await api<Settings>('/admin/ai-settings')
      client.setQueryData(['ai-settings'], fresh)
      // A document-only save advances the shared row revision. Keep unsaved model/prompt edits.
      if (JSON.stringify(values(fresh)) === JSON.stringify(values(saved))) {
        setData(old => ({ ...old, version: fresh.version })); setSaved(fresh)
      } else setProblem(t('模型配置已被更新。本页输入已保留，请核对最新配置后再保存。', 'Model configuration changed. Your edits are preserved; review the latest configuration before saving.'))
    } catch { setProblem(t('文档模板已保存，但未能刷新配置修订。请重新加载后再保存模型配置。', 'Document template saved, but the configuration revision could not be refreshed. Reload before saving model settings.')) }
  }

  return <div className="ai-console">
    <header className="ai-heading"><div><span className="eyebrow">AI CONFIGURATION</span><h1>{t('AI 模型与提示词', 'AI models & prompts')}</h1><p>{t('管理组织内的模型路由、生成预算与业务提示词。', 'Manage model routing, generation budgets and business prompts for your organization.')}</p></div>
      <div className="ai-heading-actions"><Button variant="secondary" disabled={!dirty || busy} onClick={() => { setData(saved); setMessage(''); setProblem('') }}><RotateCcw size={16} />{t('放弃修改', 'Discard changes')}</Button><Button disabled={!dirty || !valid} busy={busy} onClick={() => void save()}><Save size={16} />{t('保存配置', 'Save configuration')}</Button></div>
    </header>
    {problem && <Notice error>{problem}</Notice>}{message && <Notice>{message}</Notice>}
    <section className="ai-overview" aria-label={t('AI 配置概览', 'AI configuration overview')}>
      <div><Cpu size={20} /><span>{t('已保存模型', 'Saved model')}</span><strong className="ai-model-name">{saved.model || t('未指定模型', 'No model selected')}</strong><small>OpenRouter</small></div>
      <div><KeyRound size={20} /><span>{t('服务端密钥', 'Server credential')}</span><strong>{data.key_configured ? t('已配置', 'Configured') : t('未配置', 'Not configured')}</strong><small>{t('连接与额度未验证', 'Connectivity and quota unverified')}</small></div>
      <div><BookOpen size={20} /><span>{t('当前 AI 场景', 'Current AI scenarios')}</span><strong>{currentCount}<small>{t('个', 'scenarios')}</small></strong><small>{editableCount} {t('项可配置', 'editable')} · {currentCount - editableCount} {t('项系统内置', 'system managed')}</small></div>
      <div><Workflow size={20} /><span>{t('配置修订', 'Configuration revision')}</span><strong>REV. {data.version}</strong><small>{dirty ? t('有未保存修改', 'Unsaved changes') : t('与已保存配置一致', 'Matches saved configuration')}</small></div>
    </section>
    <div className={`ai-save-state ${dirty ? 'pending' : ''}`} role="status"><span className="ai-state-dot" /><strong>{dirty ? t(`已修改 ${changes} 项配置`, `${changes} configuration changes`) : t('配置已同步', 'Configuration synchronized')}</strong><span>{t('保存后对新任务生效，已排队任务保留原配置。', 'Saving applies to new jobs; queued jobs retain their configuration.')}</span><Link to="/audit">{t('查看管理审计', 'View admin audit')}<ArrowUpRight size={14} /></Link></div>

    <fieldset disabled={busy} className="ai-configuration-fields"><legend className="sr-only">{t('模型配置', 'Model configuration')}</legend><div className="ai-connection-grid">
      <section className="ai-card"><div className="ai-card-heading"><span className="ai-section-icon"><Cpu size={20} /></span><div><h2>{t('模型与路由', 'Model & routing')}</h2><p>{t('组织内所有 AI 场景共用此连接。', 'Shared by all AI scenarios in this organization.')}</p></div><span className="ai-tag">OpenRouter</span></div>
        <div className="ai-routing-fields"><label>{t('模型 ID', 'Model ID')}<input value={data.model} placeholder="provider/model" maxLength={200} onChange={e => change({ model: e.target.value })} /><span className="ai-field-note">{t('使用完整模型标识。留空将停用新建模型任务。', 'Use the full model identifier. Leave empty to disable new model jobs.')}</span></label>
          <label>{t('提供商路由', 'Provider routing')}<input value={data.providers} placeholder={t('留空使用自动路由', 'Leave empty for automatic routing')} maxLength={1000} onChange={e => change({ providers: e.target.value })} /><span className="ai-field-note">{t('填写提供商标识，多个提供商用逗号分隔。', 'Enter provider slugs separated by commas.')}</span></label></div>
        <div className="ai-route-preview"><span>{t('路由范围', 'Route scope')}</span><div>{data.providers.split(',').map(part => part.trim()).filter(Boolean).map((part, index) => <code key={`${part}-${index}`}>{part}</code>)}{!data.providers.split(',').some(part => part.trim()) && <span>{t('自动选择符合条件的端点', 'Automatically select an eligible endpoint')}</span>}</div></div>
        <div className="ai-credential"><KeyRound size={17} /><div><strong>{data.key_configured ? t('密钥由服务端管理', 'Credential managed on the server') : t('需要配置服务端密钥', 'Server credential required')}</strong><p>{data.key_configured ? t('此页面不读取或存储密钥；配置状态不代表连接已验证。', 'This page does not read or store the key. Configuration does not verify connectivity.') : t('在服务器环境或 .env 中设置 OPENROUTER_API_KEY 后重启服务。', 'Set OPENROUTER_API_KEY in the server environment or .env, then restart.')}</p></div></div>
      </section>
      <section className="ai-card"><div className="ai-card-heading"><span className="ai-section-icon"><SlidersHorizontal size={20} /></span><div><h2>{t('生成预算与隐私', 'Generation budget & privacy')}</h2><p>{t('分配单次请求的输出与推理额度。', 'Allocate output and reasoning tokens per request.')}</p></div></div>
        <div className="ai-budget-fields"><label>{t('最大输出 Token', 'Maximum output tokens')}<input type="number" min={256} max={100000} step={1} value={Number.isFinite(data.max_tokens) ? data.max_tokens : ''} aria-invalid={!maxValid} onChange={e => change({ max_tokens: e.currentTarget.valueAsNumber })} /></label><label>{t('推理 Token 预算', 'Reasoning token budget')}<input type="number" min={1} max={data.max_tokens - 1} step={1} placeholder={t('可留空', 'Optional')} value={data.reasoning_tokens} aria-invalid={!reasoningValid} onChange={e => change({ reasoning_tokens: e.target.value })} /></label></div>
        {(!maxValid || !reasoningValid) && <p className="ai-validation" role="alert">{t('输出额度须为 256–100,000 的整数；推理额度留空或填写小于输出额度的正整数。', 'Output must be an integer from 256–100,000. Reasoning must be empty or a positive integer below output tokens.')}</p>}
        <div className="ai-token-meter" aria-label={t('Token 预算分配', 'Token budget allocation')}><div><span style={{ width: `${budgetPercent}%` }} /></div><p><span><i />{t('推理预算', 'Reasoning')} <strong>{data.reasoning_tokens || t('未指定', 'Unspecified')}</strong></span><span>{t('正文预算参考', 'Estimated text budget')} <strong>{maxValid && reasoningValid ? (data.max_tokens - reasoning).toLocaleString() : '—'}</strong></span></p></div>
        <label className="ai-privacy-option"><input type="checkbox" checked={data.zdr} onChange={e => change({ zdr: e.target.checked })} /><span><strong>{t('仅使用零数据保留端点', 'Zero data retention endpoints only')}</strong><small>{t('限制路由至支持零数据保留的端点。', 'Restrict routing to endpoints supporting zero data retention.')}</small></span><ShieldCheck size={19} /></label>
      </section>
    </div></fieldset>

    <section className="ai-prompt-workspace" aria-labelledby="ai-prompts-title">
      <div className="ai-prompt-heading"><div className="ai-card-heading"><span className="ai-section-icon"><FileCode2 size={20} /></span><div><h2 id="ai-prompts-title">{t('业务提示词', 'Business prompts')}</h2><p>{t('按实际业务入口管理，系统内置与历史模板单独标识。', 'Organized by actual workflow, with system and historical templates clearly marked.')}</p></div></div><span className="ai-tag">{currentCount} {t('项当前使用', 'in use')}</span></div>
      <div className="ai-prompt-toolbar"><div className="ai-prompt-scopes" role="group" aria-label={t('模板适用范围', 'Prompt applicability')}>{([['current', t('当前使用', 'Current'), currentCount], ['legacy', t('历史兼容', 'Legacy'), legacyCount], ['all', t('全部', 'All'), catalog.length]] as const).map(([key, label, count]) => <button type="button" key={key} aria-pressed={scope === key} onClick={() => { setScope(key); setSearch('') }}>{label}<span>{count}</span></button>)}</div><label className="ai-prompt-search"><Search size={16} /><input aria-label={t('搜索提示词', 'Search prompts')} placeholder={t('搜索场景、用途或模板标识', 'Search scenario, usage or key')} value={search} onChange={e => setSearch(e.target.value)} /></label></div>
      <div className="ai-prompt-layout"><nav className="ai-prompt-list" aria-label={t('提示词列表', 'Prompt list')}>{Object.keys(groups).map(group => {
        const items = filtered.filter(item => item.group === group)
        return items.length ? <div className="ai-prompt-group" key={group}><h3>{groups[group]}</h3>{items.map(item => <button type="button" key={item.key} aria-pressed={prompt?.key === item.key} onClick={() => setSelected(item.key)}><span>{text(item.title)}{item.status === 'system' && <LockKeyhole size={13} />}{item.status === 'legacy' && <Archive size={13} />}</span><small>{item.status === 'active' && data.prompts[item.key] !== saved.prompts[item.key] ? t('有未保存修改', 'Unsaved changes') : statusName(item.status)}</small></button>)}</div> : null
      })}{!filtered.length && <p className="ai-no-prompts">{t('没有匹配的模板。', 'No matching prompts.')}</p>}</nav>
      {prompt ? <div className="ai-prompt-detail"><div className="ai-prompt-detail-heading"><div><span className="eyebrow">{groups[prompt.group]}</span><h3>{text(prompt.title)}</h3></div><div><span className={`ai-prompt-badge ${prompt.status}`}>{statusName(prompt.status)}</span>{prompt.status === 'active' && <span className="ai-prompt-badge">{customized ? t('已自定义', 'Customized') : t('默认模板', 'Default template')}</span>}</div></div>
        <p className="ai-prompt-usage"><Workflow size={15} />{text(prompt.usage)}</p>
        {prompt.status !== 'active' && <div className={`ai-readonly-note ${prompt.status}`}><LockKeyhole size={16} /><span>{prompt.status === 'legacy' ? t('当前流程已无此入口，仅保留历史配置与任务兼容。', 'No entry in the current workflow. Retained for historical configuration and job compatibility.') : t('随应用版本维护，只读展示实际系统指令。', 'Maintained with application releases. The actual system instructions are read-only.')}</span></div>}
        <label className="ai-prompt-label" htmlFor="ai-prompt-text">{t('系统指令', 'System instructions')}<span>{promptText.includes('{language}') ? t('{language} 随任务输出语言替换', '{language} follows the job output language') : t('保留模板中的语言约束', 'Preserves the template language rules')}</span></label>
        <textarea id="ai-prompt-text" aria-label={text(prompt.title)} className="ai-prompt-editor" readOnly={!editable} disabled={busy} maxLength={20000} spellCheck={false} value={promptText} onChange={e => { if (editable) change({ prompts: { ...data.prompts, [prompt.key]: e.target.value } }) }} />
        {editable && !promptText.trim() && <p className="ai-validation" role="alert">{t('提示词不能为空。', 'The prompt cannot be empty.')}</p>}
        <div className="ai-prompt-editor-footer"><span>{promptText.length.toLocaleString()} / 20,000 {t('字符', 'characters')}</span>{editable && <Button variant="secondary" disabled={busy || !customized} onClick={() => change({ prompts: { ...data.prompts, [prompt.key]: data.defaults.prompts[prompt.key] } })}><RotateCcw size={14} />{t('恢复此模板默认值', 'Restore this default template')}</Button>}</div>
        <details className="ai-prompt-contract"><summary>{t('模板标识与校验', 'Template key & validation')}</summary><code>{prompt.key}</code><p>{t('业务证据单独传递；输出格式、来源引用和完整性仍由系统校验。', 'Business evidence is sent separately. The system validates output format, source references and completeness.')}</p></details>
      </div> : <div className="ai-prompt-empty"><Search size={28} /><strong>{t('没有匹配的提示词', 'No matching prompts')}</strong><span>{t('试试其他关键词或适用范围。', 'Try another search or applicability filter.')}</span></div>}</div>
      <div className="ai-prompt-footnote"><ShieldCheck size={16} /><span>{t('模板只影响后续模型任务，AI 结果仍需人工复核。', 'Templates affect subsequent model jobs. AI results still require human review.')}</span></div>
    </section>

    <details className="ai-document-panel" onToggle={event => { if (event.currentTarget.open) setDocumentLoaded(true) }}><summary><span className="ai-section-icon"><FileText size={20} /></span><span><strong>{t('PRD 文档版式', 'PRD document layout')}</strong><small>{t('独立维护 Markdown 文档结构与占位符。', 'Manage Markdown document structure and placeholders separately.')}</small></span><span className="ai-tag">{t('文档模板', 'Document template')}</span><ChevronDown size={18} /></summary>{documentLoaded && <PrdTemplateEditor onSaved={documentSaved} />}</details>
  </div>
}
