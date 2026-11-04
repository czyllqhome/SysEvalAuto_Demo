import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Cpu, Save } from 'lucide-react'
import { api, ApiError } from './api'
import { Button, Notice, useAuth } from './components'
import { useLocale, topicData } from './i18n'
import PrdTemplateEditor from './PrdTemplateEditor'

type Values = { model: string; providers: string; zdr: boolean; max_tokens: number; reasoning_tokens: string; prompts: Record<string, string> }
type Settings = Values & { version: number; key_configured: boolean; defaults: Values }
export default function AISettings() {
  const { user } = useAuth(), { t } = useLocale()
  const query = useQuery({ queryKey: ['ai-settings'], queryFn: () => api<Settings>('/admin/ai-settings'), enabled: user.is_admin })
  if (!user.is_admin) return <Notice error>{t('仅管理员可以管理 AI 配置。', 'Administrator access is required.')}</Notice>
  if (query.error) return <Notice error>{t('配置读取失败，请刷新重试。', 'Could not load settings. Refresh to retry.')}</Notice>
  return query.data ? <><Editor initial={query.data} /><PrdTemplateEditor /></> : <p>{t('加载配置…', 'Loading settings…')}</p>
}
function Editor({ initial }: { initial: Settings }) {
  const { t, pair, error: translate } = useLocale(), client = useQueryClient()
  const [data, setData] = useState(initial), [selected, setSelected] = useState('context_organization')
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [problem, setProblem] = useState('')
  const names: Record<string, string> = { 'narrative_refinement:function_expansion': t('PRD 初稿 · 功能说明扩写', 'PRD draft · Expand function description'), 'narrative_refinement:mlps_purpose': t('定级问卷 · 建设目的优化', 'MLPS intake · Refine purpose'), 'narrative_refinement:mlps_functions': t('定级问卷 · 业务功能优化', 'MLPS intake · Refine functions'), 'narrative_refinement:mlps_scenarios': t('定级问卷 · 使用场景优化', 'MLPS intake · Refine scenarios'), 'narrative_refinement:mlps_description': t('定级问卷 · 系统描述优化', 'MLPS intake · Refine system description'), prd_import_extraction: t('PRD 导入提取', 'Extract imported PRD'), context_organization: t('应用说明整理', 'Organize application brief'), prd_generation: t('PRD 生成', 'Generate PRD'), impact_analysis: t('供应商影响分析', 'Supplier impact analysis') }
  topicData.forEach(topic => { names[`narrative_refinement:${topic.key}`] = t('描述优化 · ', 'Refine notes · ') + pair(topic.label) })
  function change(value: Partial<Settings>) { setData(old => ({ ...old, ...value })); setMessage('') }
  async function save() {
    setBusy(true); setProblem(''); setMessage('')
    try {
      const { defaults: _defaults, key_configured: _key, ...body } = data
      const result = await api<Settings>('/admin/ai-settings', { method: 'PUT', body })
      setData(result); client.setQueryData(['ai-settings'], result)
      await client.invalidateQueries({ queryKey: ['session'] })
      setMessage(t('配置已保存，新建模型任务立即使用此版本。', 'Saved. New model jobs use this revision immediately.'))
    } catch (e) { setProblem(e instanceof ApiError ? translate(e.code) : translate('NETWORK_ERROR')) } finally { setBusy(false) }
  }
  return <section className="ai-settings"><div className="section-heading"><div><span className="eyebrow">AI STUDIO / OPENROUTER</span><h1><Cpu size={28} /> {t('AI 模型与提示词', 'Models & prompt templates')}</h1><p className="muted">{t('集中配置模型路由，按使用场景维护 Prompt Template。', 'Configure model routing and maintain prompts for each interaction.')}</p></div><span className="status-badge">{t('修订', 'Revision')} {data.version}</span></div>
    {problem && <Notice error>{problem}</Notice>}{message && <Notice>{message}</Notice>}
    <fieldset disabled={busy}><div className="paper-panel"><h2>{t('模型连接', 'Model connection')}</h2><p>{data.key_configured ? t('服务端 API Key 已配置（未验证额度或可用性）', 'Server API key configured (availability and quota unverified)') : t('服务端尚未配置 OPENROUTER_API_KEY，请在服务器环境或 .env 中设置后重启。', 'Set OPENROUTER_API_KEY in the server environment or .env and restart.')}</p><div className="ai-fields">
      <label>{t('模型 ID', 'Model ID')}<input value={data.model} placeholder="provider/model" maxLength={200} onChange={e => change({ model: e.target.value })} /></label>
      <label>{t('供应商路由（逗号分隔，可留空）', 'Provider routing (comma separated, optional)')}<input value={data.providers} maxLength={1000} onChange={e => change({ providers: e.target.value })} /></label>
      <label>{t('最大输出 Token', 'Maximum output tokens')}<input type="number" min={256} max={100000} value={data.max_tokens} onChange={e => change({ max_tokens: Number(e.target.value) })} /></label>
      <label>{t('推理 Token 预算（可留空）', 'Reasoning token budget (optional)')}<input type="number" min={1} max={data.max_tokens - 1} value={data.reasoning_tokens} onChange={e => change({ reasoning_tokens: e.target.value })} /></label></div>
      <label className="check-label"><input type="checkbox" checked={data.zdr} onChange={e => change({ zdr: e.target.checked })} />{t('仅路由至零数据保留端点', 'Route only to zero data retention endpoints')}</label></div>
    <div className="paper-panel"><h2>Prompt Templates</h2><p className="muted">{t('模板为发送给模型的系统指令。{language} 会替换为输出语言；描述优化默认保留原文语言。业务证据通过独立消息发送，JSON Schema、来源和完整性校验仍由服务端执行。', 'Templates are system instructions. {language} resolves to the output language; refinement preserves the original language by default. Evidence is sent separately. Server schema, source and completeness validation still apply.')}</p>
      <div className="prompt-layout"><div className="prompt-nav" role="group" aria-label={t('LLM 使用位置', 'LLM interaction locations')}>{Object.keys(data.prompts).map(key => <button type="button" key={key} className={selected === key ? 'active' : ''} onClick={() => setSelected(key)}>{names[key] ?? key}</button>)}</div><div><label>{names[selected]}<textarea className="prompt-editor" rows={19} maxLength={20000} spellCheck={false} value={data.prompts[selected]} onChange={e => change({ prompts: { ...data.prompts, [selected]: e.target.value } })} /></label><div className="stage-actions"><span className="field-hint">{data.prompts[selected].length} / 20,000</span><Button variant="secondary" onClick={() => change({ prompts: { ...data.prompts, [selected]: data.defaults.prompts[selected] } })}>{t('恢复此模板默认值', 'Restore this default template')}</Button></div></div></div></div>
    <div className="stage-actions"><p className="field-hint">{t('组织内生效；保存记录可在管理审计中追溯。已排队任务保留原配置。', 'Applies to this organization and is recorded in admin audit. Queued jobs retain their configuration.')}</p><Button busy={busy} onClick={() => void save()}><Save size={16} />{t('保存模型与模板', 'Save model & templates')}</Button></div></fieldset></section>
}
