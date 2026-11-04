import { useId, useState } from 'react'
import { CircleAlert } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { api, ApiError } from './api'
import { Button, Notice, useCommand } from './components'
import { useLocale } from './i18n'
import type { Config, Fact, Rule } from './libraryTypes'
import type { SystemDetail } from './types'

type Profile = { config: Config; available: boolean; catalog_id: string | null; facts: Record<string, Fact>; assessment_profile?: string; permissions: string[] }
type Preview = { recommended_level: string; effective_level: string; assessment_profile: string; matched_rules: string[]; unknown: string[]; matches: { code: string; status: string; answer_refs: string[] }[] }

function visible(rule: Rule | undefined, facts: Record<string, Fact>) {
  if (!rule || rule === true) return true
  return rule.any.some(g => g.all.every(a => { const v = facts[a.tag]; if (v === undefined || v === 'unknown') return false; return a.op === 'eq' ? v === a.value : (Array.isArray(v) ? v : [v]).some(x => (a.value as string[]).includes(String(x))) }))
}

function QuestionRuleHint({ label, text }: { label: string; text: string }) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const { t } = useLocale()
  return <span className="question-rule-hint" tabIndex={0} role="img"
    aria-label={label + t(' · 初筛规则说明', ' · Screening rule')}
    aria-describedby={open ? id : undefined}
    onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}
    onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
    onKeyDown={event => { if (event.key === 'Escape') setOpen(false) }}>
    <CircleAlert size={15} aria-hidden="true" />
    <span id={id} role="tooltip" hidden={!open}>{text}</span>
  </span>
}

export function FactFields({ config, facts, setFacts, flat = false, required = false, ruleHints = {} }: { ruleHints?: Record<string, string>; flat?: boolean; required?: boolean; config: Config; facts: Record<string, Fact>; setFacts: (f: Record<string, Fact>) => void }) {
  const { t, locale } = useLocale()
  const [group, setGroup] = useState('network')
  const legacyLabels: Record<string, string> = {
    '是否使用服务账号？': '系统是否使用供程序或系统调用的专用身份或访问凭据？',
    'Are service accounts used?': 'Does the system use dedicated identities or access credentials for applications or system-to-system calls?',
    '操作权限的影响？': '账号或程序权限被误用时，可能影响哪些数据或业务？',
    'Impact of authorized operations?': 'What data or business operations could be affected if account or application permissions were misused?',
  }
  const hints: Record<string, string> = {
    'identity.service_accounts': t('例如后台连接数据库的账号、定时任务身份，或程序调用模型/API 使用的专用密钥。不清楚后台实现时选“待确认”。', 'Examples: database accounts used by the backend, scheduled-task identities, or dedicated keys for model/API calls. Choose Unknown if the implementation is not yet known.'),
    'risk.privilege_impact': t('考虑普通用户、管理员和程序拥有的最大权限：仅影响个人设置且易恢复，选“影响有限且可恢复”；影响多人业务，选“影响日常业务”；可批量删除关键数据、修改全局权限或控制生产系统，选“严重影响”。', 'Consider the maximum permissions of users, administrators and applications: easily reversible personal settings mean bounded impact; disruption to multiple users means business impact; deleting critical data in bulk, changing global permissions or controlling production systems means severe impact.'),
  }
  const groups = [['network', t('网络与部署', 'Network & hosting')], ['data', t('数据与权限', 'Data & access')], ['business', t('业务影响', 'Business impact')], ['operations', t('开发运维', 'Delivery & operations')]]
  const names: Record<string, string> = { none: t('无', 'None'), under_10k: t('少于 1 万人', 'Under 10,000'), '10k_100k': t('1 万至不足 10 万人', '10,000–99,999'), '100k_1m': t('10 万至不足 100 万人', '100,000–999,999'), over_1m: t('100 万人及以上', '1,000,000 or more'), under_1k: t('少于 1 千人', 'Under 1,000'), '1k_10k': t('1 千至不足 1 万人', '1,000–9,999'), over_100k: t('10 万人及以上', '100,000 or more'), rights: t('个人、企业或其他组织的合法权益', 'Rights of individuals or organizations'), public: t('社会秩序或公共利益', 'Social order or public interests'), national: t('国家安全（需专家复核）', 'National security (expert review)'), minor: t('一般损害，可恢复、影响有限', 'Minor, recoverable and limited harm'), serious: t('严重损害，显著损失或业务受阻', 'Serious loss or disruption'), extreme: t('特别严重损害，广泛或长期影响', 'Extreme, widespread or lasting harm'), read: t('只读查询或接收数据', 'Read-only access or receiving data'), write: t('写入数据或发起业务交易', 'Write data or initiate transactions'), critical: t('控制关键生产或核心系统', 'Control critical production or core systems'), yes: t('是', 'Yes'), no: t('否', 'No'), unknown: t('待确认', 'Unknown'), low: t('低影响', 'Low impact'), business: t('影响日常业务', 'Business impact'), severe: t('严重影响', 'Severe impact'), bounded: t('影响有限且可恢复', 'Bounded and reversible'), limited: t('影响有限', 'Limited'), team: t('单一团队', 'One team'), multiple: t('多个团队', 'Multiple teams'), customers: t('外部客户', 'External customers'), own_dc: t('自有机房', 'Own data center'), vendor_dc: t('托管机房', 'Hosted data center'), cloud: t('云服务', 'Cloud'), saas: 'SaaS', in_house: t('自行开发', 'In-house'), outsourced: t('外包开发', 'Outsourced'), purchased: t('采购成品', 'Purchased'), customer_facility: t('机房设施由客户负责', 'Customer: facilities'), supplier_facility: t('机房设施由供应商负责', 'Supplier: facilities'), customer_network: t('网络由客户负责', 'Customer: networks'), supplier_network: t('网络由供应商负责', 'Supplier: networks'), customer_host: t('主机由客户负责', 'Customer: hosts'), supplier_host: t('主机由供应商负责', 'Supplier: hosts'), customer_app: t('应用由客户负责', 'Customer: application'), supplier_app: t('应用由供应商负责', 'Supplier: application') }
  return <>{!flat && <div className="segmented classification-topic-tabs">{groups.map(([id, title]) => <button type="button" key={id} className={group === id ? 'active' : ''} onClick={() => setGroup(id)}>{title}</button>)}</div>}{config.questions.filter(q => (flat || q.group === group) && visible(q.when, facts)).map(q => q.kind === 'multi' ? <fieldset className="tag-fact-field fact-multi" key={q.code}>
    <legend>{legacyLabels[q[locale]] ?? q[locale]} {ruleHints[q.code] && <QuestionRuleHint label={legacyLabels[q[locale]] ?? q[locale]} text={ruleHints[q.code]} />} {required && <span className="required-mark" aria-hidden="true">{t('必填', 'Required')}</span>} {q.risk && <small>{t('（影响分级）', '(grading input)')}</small>}</legend>
    <small>{t('可直接勾选多项；蓝色背景和勾选标记表示已选。', 'Select multiple options directly. Blue backgrounds and checkmarks indicate selections.')}</small>
    <div className="fact-multi-options">{q.values!.map(value => {
      const selected = Array.isArray(facts[q.code]) && (facts[q.code] as string[]).length ? facts[q.code] as string[] : ['unknown']
      const checked = selected.includes(value)
      return <label className={`check-label fact-multi-option${checked ? ' selected' : ''}`} key={value}>
        <input type="checkbox" checked={checked} onChange={event => {
          const next = event.target.checked ? value === 'unknown' ? ['unknown'] : [...selected.filter(item => item !== 'unknown'), value] : selected.filter(item => item !== value)
          setFacts({ ...facts, [q.code]: next.length ? next : ['unknown'] })
        }} /><span>{names[value] ?? value}</span>
      </label>
    })}</div>
  </fieldset> : <label className="tag-fact-field" key={q.code}><span>{legacyLabels[q[locale]] ?? q[locale]} {ruleHints[q.code] && <QuestionRuleHint label={legacyLabels[q[locale]] ?? q[locale]} text={ruleHints[q.code]} />} {required && <span className="required-mark" aria-hidden="true">{t('必填', 'Required')}</span>} {q.risk && <small>{t('（影响分级）', '(grading input)')}</small>}</span>{hints[q.code] && <small className="field-hint">{hints[q.code]}</small>}{q.kind === 'number' ? <input aria-label={legacyLabels[q[locale]] ?? q[locale]} aria-required={required} type="number" min={0} placeholder={t('留空为待确认', 'Empty means unknown')} value={facts[q.code] === 'unknown' ? '' : String(facts[q.code] ?? '')} onChange={e => setFacts({ ...facts, [q.code]: e.target.value === '' ? 'unknown' : Number(e.target.value) })} /> : <select aria-label={legacyLabels[q[locale]] ?? q[locale]} aria-required={required} value={String(facts[q.code] ?? 'unknown')} onChange={e => setFacts({ ...facts, [q.code]: e.target.value })}>{q.values!.map(v => <option value={v} key={v}>{names[v] ?? v}</option>)}</select>}</label>)}</>
}

export default function TagClassification({ detail, fallback }: { detail: SystemDetail; fallback: React.ReactNode }) {
  const query = useQuery({ queryKey: ['tag-profile', detail.system.id], queryFn: () => api<Profile>(`/systems/${detail.system.id}/tag-profile`) })
  const { t } = useLocale()
  if (query.error) return <Notice error>{t('分类配置读取失败，请重试。', 'Could not load classification configuration. Please retry.')}</Notice>
  if (!query.data) return <p>{t('加载分类配置…', 'Loading classification…')}</p>
  if (!query.data.available) return <>{fallback}<p><Link to="/library">{t('维护并发布控制库后启用标签问卷', 'Publish a control library to enable the tag questionnaire')}</Link></p></>
  return <Editor key={query.data.catalog_id} detail={detail} initial={query.data} />
}

function Editor({ detail, initial }: { detail: SystemDetail; initial: Profile }) {
  const { t, locale, error: translate } = useLocale()
  const navigate = useNavigate()
  const { run, busy, error } = useCommand(detail)
  const [config, setConfig] = useState(initial.config), [catalogId, setCatalogId] = useState(initial.catalog_id)
  const [facts, setFacts] = useState(initial.facts)
  const [mode, setMode] = useState('questionnaire'), [level, setLevel] = useState('L2'), [reason, setReason] = useState('')
  const [target, setTarget] = useState(''), [profile, setProfile] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null), [previewError, setPreviewError] = useState('')
  const [waiting, setWaiting] = useState(false)
  const [upgrade, setUpgrade] = useState<{ catalog_id: string; config: Config; facts: Record<string, Fact>; changes: { code: string; after: string }[] } | null>(null)
  const body = { scheme: 'MLPS-TAGS/1', catalog_id: catalogId, facts, mode, level, reason, assessment_profile: target ? `MLPS${target}_REFERENCE` : profile || undefined, mlps_target: target || undefined }
  const editable = initial.permissions.includes('edit')
  function changed(next: Record<string, Fact>) { setFacts(next); setPreview(null) }
  async function check() {
    setWaiting(true); setPreviewError('')
    try { setPreview(await api(`/systems/${detail.system.id}/tag-profile/preview`, { method: 'POST', body })) }
    catch (e) { setPreviewError(e instanceof ApiError ? translate(e.code) + (e.detail ? JSON.stringify(e.detail) : '') : translate('NETWORK_ERROR')) }
    finally { setWaiting(false) }
  }
  return <section><div className="section-heading"><div><span className="eyebrow">02 / SYSTEM CLASSIFICATION</span><h2>{t('系统分类与适用标签', 'Classification and applicability')}</h2><p>{t('回答系统事实，查看内部 L1/L2/L3 建议。控制库的二级、三级来源单独记录。', 'Describe system facts to obtain an internal L1/L2/L3 recommendation. MLPS source levels are recorded separately.')}</p></div></div><div className="paper-panel">{(error || previewError) && <Notice error>{error || previewError}</Notice>}<fieldset disabled={!editable || busy || waiting}>
    <FactFields config={config} facts={facts} setFacts={changed} />
    <div className="intake-fields"><label>{t('分级方式', 'Classification mode')}<select value={mode} onChange={e => { setMode(e.target.value); setPreview(null) }}><option value="questionnaire">{t('按回答推荐', 'Recommend from answers')}</option><option value="manual">{t('人工选择', 'Manual selection')}</option></select></label>{mode === 'manual' && <><label>{t('内部等级', 'Internal level')}<select value={level} onChange={e => { setLevel(e.target.value); setPreview(null) }}>{['L1', 'L2', 'L3'].map(v => <option key={v}>{v}</option>)}</select></label><label>{t('选择理由', 'Reason')}<textarea value={reason} onChange={e => { setReason(e.target.value); setPreview(null) }} /></label></>}<label>{t('已指定 MLPS 评估目标', 'Specified MLPS assessment target')}<select value={target} onChange={e => { setTarget(e.target.value); setPreview(null) }}><option value="">{t('未指定', 'Not specified')}</option><option value="2">MLPS 2</option><option value="3">MLPS 3</option></select></label>{!target && <label>{t('控制方案', 'Control profile')}<select value={profile} onChange={e => { setProfile(e.target.value); setPreview(null) }}><option value="">{t('按内部等级选择', 'Use the internal level')}</option>{config.profiles.map(p => <option key={p.code} value={p.code}>{p.code}</option>)}</select></label>}</div>
    <div className="stage-actions"><Button variant="secondary" onClick={() => void run(`/systems/${detail.system.id}/tag-profile`, body, 'PUT').catch(() => {})}>{t('保存画像草稿', 'Save profile draft')}</Button><Button onClick={() => void check()}>{t('预览分类和适用范围', 'Preview classification and scope')}</Button><Button variant="secondary" onClick={() => void api<typeof upgrade>(`/systems/${detail.system.id}/catalog-upgrade-preview`, { method: 'POST' }).then(setUpgrade).catch(e => setPreviewError(translate(e instanceof ApiError ? e.code : 'NETWORK_ERROR')))}>{t('检查控制库升级', 'Check library upgrade')}</Button></div>
    {upgrade && <div className="paper-panel"><h3>{t('升级预览', 'Upgrade preview')}</h3><p>{t('应用后需要重新确认分类和后续成果。', 'Applying requires classification and downstream results to be reconfirmed.')}</p><details><summary>{upgrade.changes.length} {t('条控制状态', 'control decisions')}</summary>{upgrade.changes.map(c => <p key={c.code}>{c.code}: {c.after}</p>)}</details><Button variant="secondary" onClick={() => { setCatalogId(upgrade.catalog_id); setConfig(upgrade.config); setFacts(upgrade.facts); setPreview(null); setUpgrade(null) }}>{t('使用此版本重新预览', 'Use this version for a new preview')}</Button></div>}
    {preview && <div className="paper-panel"><h3>{t('建议等级', 'Recommended level')}: {preview.recommended_level} · {t('采用等级', 'Effective level')}: {preview.effective_level}</h3><p>{preview.assessment_profile}</p><p>{t('触发依据', 'Triggered by')}: {preview.matched_rules.map(code => config.questions.find(q => q.code === code)?.[locale] ?? code).join('; ') || (preview.unknown.length ? t('存在待确认事实，建议等级为暂定', 'Unresolved inputs; recommendation is provisional') : t('已知低影响条件', 'Known low-impact facts'))}</p>{preview.unknown.length > 0 && <Notice>{t('分级事实待确认', 'Unresolved grading facts')}: {preview.unknown.length}<details><summary>{t('查看待补充的问题', 'View unresolved questions')}</summary><ul>{preview.unknown.map(code => <li key={code}>{config.questions.find(q => q.code === code)?.[locale] ?? code}</li>)}</ul></details></Notice>}<p>{['applicable', 'unknown', 'inapplicable'].map(status => `${status}: ${preview.matches.filter(m => m.status === status).length}`).join(' · ')}</p><details><summary>{t('查看逐条适用依据', 'Inspect matching reasons')}</summary>{preview.matches.map(m => <p key={m.code}>{m.code} · {m.status} · {m.answer_refs.join(', ')}</p>)}</details><Button onClick={() => void run(`/systems/${detail.system.id}/classification-confirmations`, body).then(() => navigate(`/systems/${detail.system.id}/brief`)).catch(() => {})}>{t('确认分类与画像', 'Confirm classification and profile')}</Button></div>}
  </fieldset></div></section>
}
