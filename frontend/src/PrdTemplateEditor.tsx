import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, ApiError } from './api'
import { Button, Notice } from './components'
import { useLocale } from './i18n'

type Template = { filename: string; content: string }
type State = { version: number; template: Template | null; slots: string[] }
export default function PrdTemplateEditor() {
  const { t } = useLocale()
  const query = useQuery({ queryKey: ['prd-template'], queryFn: () => api<State>('/admin/prd-template') })
  return <section className="paper-panel"><h2>{t('PRD 文档模板（Markdown）', 'PRD document template (Markdown)')}</h2>
    {query.error && <Notice error>{t('模板读取失败，请刷新重试。', 'Could not load the template. Refresh to retry.')}</Notice>}
    {query.data && <Editor initial={query.data} />}</section>
}
function Editor({ initial }: { initial: State }) {
  const { t, error: translate } = useLocale()
  const [data, setData] = useState(initial), [busy, setBusy] = useState(false), [message, setMessage] = useState('')
  const [problem, setProblem] = useState('')
  async function upload(file?: File) {
    if (!file) return
    setProblem(''); setMessage('')
    if (!file.name.toLowerCase().endsWith('.md') || file.size > 100000) { setProblem(t('仅接受不超过 100 KB 的 UTF-8 .md 文件。', 'Only UTF-8 .md files up to 100 KB are accepted.')); return }
    try {
      const content = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())
      setData(old => ({ ...old, template: { filename: file.name, content } }))
    } catch { setProblem(t('无法读取 UTF-8 Markdown 文件。', 'Could not read UTF-8 Markdown.')) }
  }
  async function save(template: Template | null) {
    setBusy(true); setProblem(''); setMessage('')
    try {
      const result = await api<State>('/admin/prd-template', { method: 'PUT', body: { version: data.version, template } })
      setData(result)
      setMessage(t('已保存。新建 PRD 任务生效；已有文档和排队任务保持原模板。', 'Saved. New PRD jobs use this change; existing documents and queued jobs retain their template.'))
    } catch (e) { setProblem(e instanceof ApiError ? translate(e.code) : translate('NETWORK_ERROR')) }
    finally { setBusy(false) }
  }
  return <><p>{t('模板控制文档结构，业务和安全需求来自已确认说明与已纳入控制。缺失值标记为待确认；删除模板后使用基础文档格式。', 'The template controls layout. Business and security requirements come from the confirmed brief and included controls. Missing values become questions; deletion restores the basic document layout.')}</p>
    {message && <Notice>{message}</Notice>}{problem && <Notice error>{problem}</Notice>}
    <fieldset disabled={busy}><label>{t('上传 .md 模板', 'Upload .md template')}<input type="file" accept=".md" onChange={e => void upload(e.target.files?.[0])} /></label>
      {data.template ? <><p>{data.template.filename}</p><label>{t('Markdown 模板内容', 'Markdown template content')}<textarea className="prompt-editor" rows={20} value={data.template.content} onChange={e => setData(old => ({ ...old, template: { ...old.template!, content: e.target.value } }))} /></label></> : <p>{t('未配置自定义模板。', 'No custom template configured.')}</p>}
      <details><summary>{t('可自动填充的字段', 'Supported fields')}</summary><p>{data.slots.map(s => `{{${s}}}`).join(' · ')}</p><p>{t('不认识的占位符转为待确认项；缺少需求或追踪字段时会自动补充，避免遗漏已纳入的安全控制。模板正文不会作为系统指令执行。', 'Unknown placeholders become open questions. Missing requirement and traceability sections are appended to preserve coverage. Template content is not executed as system instructions.')}</p></details>
      <div className="stage-actions"><Button disabled={!data.template} onClick={() => void save(null)} variant="secondary">{t('删除 PRD 模板', 'Delete PRD template')}</Button><Button disabled={!data.template?.content.trim()} onClick={() => void save(data.template)}>{t('保存 PRD 模板', 'Save PRD template')}</Button></div>
    </fieldset></>
}
