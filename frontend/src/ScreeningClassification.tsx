import DemoFill from './DemoFill'
import { useRef, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { api, ApiError } from './api'
import { Button, Notice, useCommand } from './components'
import { useLocale } from './i18n'
import { FactFields } from './TagClassification'
import type { Config, Fact } from './libraryTypes'
import type { SystemDetail } from './types'

type Draft = { facts?: Record<string, Fact>; frameworks?: string[]; mode?: string; level?: string; reason?: string; mlps_target?: string }
type Settings = { config: Config; catalog_id: string | null; framework_options: string[]; saved: Draft; permissions: string[] }
type Result = { recommended_level: string; effective_level: string; unknown: string[]; expert_review: string[]; exceptions: { code: string }[];
  matched_rules: string[]; controls_ready: boolean; missing_frameworks: string[]; assessment_profiles: string[];
  matches: { code: string; status: string; reason: string }[] }

export default function ScreeningClassification({ detail }: { detail: SystemDetail }) {
  const { t } = useLocale()
  const [latest, setLatest] = useState(false)
  const query = useQuery({ queryKey: ['screening', detail.system.id, latest], queryFn: () => api<Settings>(`/systems/${detail.system.id}/screening?latest=${latest}`) })
  if (query.error) return <Notice error>{t('初筛配置读取失败，请刷新重试。', 'Could not load screening. Refresh to retry.')}</Notice>
  if (!query.data) return <p>{t('加载初筛问卷…', 'Loading screening…')}</p>
  return <Editor refresh={<Button variant="secondary" onClick={() => { if (latest) void query.refetch(); else setLatest(true) }}>{t('加载最新控制库（先保存当前初筛草稿）', 'Load latest library (save screening draft first)')}</Button>} key={query.data.catalog_id ?? 'no-library'} detail={detail} settings={query.data} />
}

function Editor({ detail, settings, refresh }: { detail: SystemDetail; settings: Settings; refresh: ReactNode }) {
  const { t, locale, error: translate } = useLocale()
  const { run, busy, error } = useCommand(detail)
  const navigate = useNavigate()
  const saved = settings.saved
  const [facts, setFacts] = useState(saved.facts ?? {})
  const [frameworks, setFrameworks] = useState(saved.frameworks?.filter(f => ['MLPS_LEVEL_2', 'MLPS_LEVEL_3'].includes(f)).length ? saved.frameworks.filter(f => ['MLPS_LEVEL_2', 'MLPS_LEVEL_3'].includes(f)) : ['MLPS_LEVEL_2'])
  const [mode, setMode] = useState(saved.mode ?? 'questionnaire'), [level, setLevel] = useState(saved.level ?? 'L2')
  const [reason, setReason] = useState(saved.reason ?? ''), [target, setTarget] = useState(saved.mlps_target ?? '')
  const [result, setResult] = useState<Result | null>(null), [problem, setProblem] = useState(''), [waiting, setWaiting] = useState(false)
  const beforeDemo = useRef({ facts, frameworks, mode, level, reason, target })
  const [extras, setExtras] = useState(false)
  const body = { scheme: 'SYS-SCREEN/2', catalog_id: settings.catalog_id, facts, frameworks, mode, level, reason, mlps_target: undefined }
  const primary = new Set(['net.public_ingress', 'hosting.models', 'risk.business_impact', 'risk.outage_minutes', 'biz.manual_fallback'])
  const config = { ...settings.config, questions: settings.config.questions.filter(q => primary.has(q.code) || q.code.startsWith('screen.')) }
  const extraConfig = { ...settings.config, questions: settings.config.questions.filter(q => !primary.has(q.code) && !q.code.startsWith('screen.')) }
  const extraHelp = t('补充远程管理、网络互联、账号权限、外包运维与责任边界，帮助判断控制是否适用及由谁负责。展开后仅在本区域显示；收起保留已填答案，未填写按待确认处理。', 'Add remote administration, network connections, access, outsourced operations and responsibility boundaries to determine control applicability and ownership. Questions appear only in this section. Collapsing preserves answers; unanswered details remain unknown.')
  const ruleScope = t('采用最高触发等级，不取平均；关键答案未知时至少暂定 L2。这是内部初筛，不是正式等保定级。', 'The highest triggered level applies, without averaging. Unknown core answers mean provisional L2 or higher. This is internal screening, not formal MLPS grading.')
  const ruleHints: Record<string, string> = {
    'screen.personal_count': t('按去重人数计算，不是记录行数。涉及 1–99,999 人至少 L2；达到 10 万人至少 L3。人数门槛是本应用内部规则，不是法规或 MLPS 定级人数标准。', 'Count distinct people, not rows. 1–99,999 people triggers at least L2; 100,000 or more triggers at least L3. These are internal application thresholds, not statutory or MLPS population criteria.'),
    'screen.sensitive_count': t('敏感个人信息属于个人信息，人数范围不能与个人信息总人数矛盾。涉及 1–999 人至少 L2；达到 1 千人至少 L3。人数门槛是本应用内部规则，不是法规或 MLPS 定级人数标准。', 'Sensitive personal information is a subset of personal information; its count range must be consistent with the total. 1–999 people triggers at least L2; 1,000 or more triggers at least L3. These are internal thresholds, not statutory or MLPS population criteria.'),
    'screen.confidential': t('处理商业秘密或其他非个人敏感业务信息至少 L2；此项与敏感个人信息人数分开判断。', 'Processing trade secrets or other non-personal confidential business information triggers at least L2, separately from sensitive personal information counts.'),
    'net.public_ingress': t('存在公网入口至少 L2，包含认证或白名单入口。', 'Public ingress triggers at least L2, including authenticated or allowlisted entry.'),
    'screen.public_cloud': t('云和供应商机房本身不提升等级；云平台等级不等于本系统等级。', 'Cloud and supplier hosting alone do not raise the level. Platform grading does not determine application grading.'),
    'hosting.models': t('部署方式用于判断责任和控制适用性，本身不提升等级。', 'Hosting determines responsibilities and control applicability; hosting alone does not raise the level.'),
    'screen.interaction': t('向其他系统写入或发起交易至少 L2；控制关键生产或核心系统至少 L3。', 'Writing to other systems or initiating transactions triggers at least L2; controlling critical production or core systems triggers at least L3.'),
    'risk.business_impact': t('影响日常业务至少 L2；严重业务中断至少 L3，不能被其他低影响答案抵消。', 'Business impact triggers at least L2; severe business disruption triggers at least L3 and cannot be offset by low-impact answers.'),
    'risk.outage_minutes': t(`容忍中断低于 ${settings.config.thresholds.critical_minutes} 分钟且无人工替代时至少 L3；否则，低于 ${settings.config.thresholds.important_minutes} 分钟时至少 L2。`, `Tolerance below ${settings.config.thresholds.critical_minutes} minutes without manual fallback triggers at least L3; otherwise, tolerance below ${settings.config.thresholds.important_minutes} minutes triggers at least L2.`),
    'biz.manual_fallback': t('无可行人工替代流程至少 L2；人工替代不能抵消已触发的严重影响。', 'No viable manual fallback triggers at least L2. Manual fallback cannot offset an already triggered severe impact.'),
  }
  for (const category of ['data', 'service']) {
    const impactRule = t('结合受影响对象和损害程度判断：合法权益严重或特别严重损害至少 L2；公共利益一般损害至少 L2，严重或特别严重损害至少 L3；国家安全相关至少 L3。国家安全或公共利益特别严重损害另需专家复核，不能简单理解为正式三级。', 'Assess the affected party together with severity: serious or extreme harm to individual or organizational rights triggers at least L2; minor public-interest harm triggers at least L2, serious or extreme harm at least L3; national-security impact at least L3. National-security impact or extreme public-interest harm also requires expert review and does not mean formal MLPS level 3.')
    ruleHints[`screen.${category}_object`] = impactRule
    ruleHints[`screen.${category}_harm`] = impactRule
  }
  for (const code of Object.keys(ruleHints)) ruleHints[code] += ' ' + ruleScope
  const label = (code: string) => settings.config.questions.find(q => q.code === code)?.[locale] ?? code
  return <section className="screening-panel"><div className="section-heading"><div><span className="eyebrow">02 / SYSTEM CLASSIFICATION</span><h2>{t('系统初步分级与框架选择', 'Initial system grading and framework selection')}</h2></div><div className="page-heading-actions"><DemoFill disabled={busy || waiting || !settings.permissions.includes('edit')} apply={() => {
        beforeDemo.current = { facts, frameworks, mode, level, reason, target }
        const sample: Record<string, Fact> = { 'screen.personal_count': 'under_10k', 'screen.sensitive_count': 'none', 'screen.data_object': 'rights', 'screen.service_object': 'rights', 'screen.data_harm': 'minor', 'screen.service_harm': 'minor', 'screen.interaction': 'read', 'screen.public_cloud': 'no', 'screen.confidential': 'no', 'net.public_ingress': 'no', 'hosting.models': ['own_dc'], 'risk.business_impact': 'business', 'risk.outage_minutes': 480, 'biz.manual_fallback': 'yes', 'data.personal': 'yes', 'data.sensitive': 'no', 'risk.data_impact': 'business', 'risk.privilege_impact': 'business', 'risk.dependency_scope': 'multiple', 'delivery.models': ['in_house'], 'responsibility.layers': ['customer_facility', 'customer_network', 'customer_host', 'customer_app'] }
        setFacts(Object.fromEntries(settings.config.questions.map(q => [q.code, sample[q.code] ?? (q.kind === 'multi' ? ['unknown'] : q.values?.includes('no') ? 'no' : 'unknown')]))); setMode('questionnaire'); setTarget(''); setReason(''); setResult(null)
        setFrameworks(['MLPS_LEVEL_2'])
      }} undo={() => { const old = beforeDemo.current; setFacts(old.facts); setFrameworks(old.frameworks); setMode(old.mode); setLevel(old.level); setReason(old.reason); setTarget(old.target); setResult(null) }} /></div></div><div className="paper-panel"><div className="screening-library-action">{refresh}</div>

    {(error || problem) && <Notice error>{error || problem}</Notice>}
    <fieldset disabled={busy || waiting || !settings.permissions.includes('edit')}>
      <h3 className="screening-section-title">{t('分级方式与采用等级', 'Grading mode and effective level')}</h3>
      <div className="intake-fields"><label>{t('分级方式', 'Grading mode')}<select value={mode} onChange={e => { setMode(e.target.value); setResult(null) }}><option value="questionnaire">{t('按回答推荐', 'Recommend from answers')}</option><option value="manual">{t('人工调整（需说明原因）', 'Manual adjustment (reason required)')}</option></select></label>
        {mode === 'manual' && <><label>{t('采用等级', 'Effective level')}<select value={level} onChange={e => { setLevel(e.target.value); setResult(null) }}>{['L1', 'L2', 'L3'].map(l => <option key={l}>{l}</option>)}</select></label><label>{t('调整原因', 'Adjustment reason')}<textarea value={reason} onChange={e => { setReason(e.target.value); setResult(null) }} /></label></>}
      </div>

      <h3>{t('希望使用哪些控制框架？', 'Which control frameworks should be used?')}</h3>
      {settings.framework_options.map(f => <label className="check-label" key={f}><input type="checkbox" checked={frameworks.includes(f)} onChange={e => {
        setFrameworks(e.target.checked ? [...frameworks, f] : frameworks.filter(x => x !== f)); setResult(null)
        if (f === 'MLPS' && !e.target.checked) setTarget('')
      }} />{f === 'MLPS_LEVEL_2' ? t('MLPS 2 级', 'MLPS Level 2') : t('MLPS 3 级', 'MLPS Level 3')}</label>)}
      <p className="field-hint">{t('框架来自组织控制库；匹配时同时检查来源框架、等级方案和适用条件。', 'Framework choices come from the organization library. Matching checks source framework, level profile and applicability together.')}</p>
      <section className="screening-facts" aria-labelledby="screening-facts-title">
        <h3 id="screening-facts-title" className="screening-section-title">{t('填写系统情况', 'Describe the system')}</h3>
        <p className="field-hint">{t('按分类填写网络、数据、业务影响与开发运维情况，用于初步分级；不确定的信息可保留为待确认。', 'Complete the network, data, business impact and delivery categories for initial grading. Leave uncertain information as unknown.')}</p>
        <FactFields ruleHints={ruleHints} config={config} facts={facts} setFacts={value => { setFacts(value); setResult(null) }} />
      </section>
      <section className="screening-extras" aria-labelledby="screening-extras-title">
        <div className="screening-extras-heading"><h3 id="screening-extras-title">{t('补充控制适用条件', 'Additional control applicability')}</h3>
          <span className="screening-help" tabIndex={0} aria-label={extraHelp}>?<span role="tooltip">{extraHelp}</span></span>
          <button type="button" className="button secondary" aria-expanded={extras} aria-controls="screening-extra-fields" onClick={() => setExtras(!extras)}>{extras ? t('收起补充问题', 'Collapse additional questions') : t('展开补充问题', 'Expand additional questions')}</button>
        </div>
        <p className="field-hint">{t('可稍后填写，用于明确控制适用范围与责任分工。补充问题仅显示在下方独立区域，收起不会清除答案。', 'Complete later to clarify control applicability and responsibilities. Additional questions stay in this section; collapsing keeps your answers.')}</p>
        <div id="screening-extra-fields" hidden={!extras}>
          {extras && <FactFields config={extraConfig} facts={facts} setFacts={value => { setFacts(value); setResult(null) }} />}
        </div>
      </section>
      <div className="stage-actions"><Button variant="secondary" disabled={!frameworks.length} onClick={() => void run(`/systems/${detail.system.id}/screening`, body, 'PUT').catch(() => {})}>{t('保存初筛草稿', 'Save screening draft')}</Button>
        <Button disabled={!frameworks.length} onClick={async () => { setWaiting(true); setProblem(''); try { setResult(await api(`/systems/${detail.system.id}/screening/preview`, { method: 'POST', body })) } catch (e) { setProblem(e instanceof ApiError ? translate(e.code) + (e.detail ? JSON.stringify(e.detail) : '') : translate('NETWORK_ERROR')) } finally { setWaiting(false) } }}>{t('预览分级与控制范围', 'Preview grading and controls')}</Button></div>
      {result && <div className="paper-panel"><h3>{t('建议等级', 'Recommended')}: {result.recommended_level} · {t('采用等级', 'Effective')}: {result.effective_level}</h3>
        {result.exceptions.some(e => e.code === 'CONTROL_PROFILE_DOWNGRADE') && <Notice>{t('指定的 MLPS 控制目标低于内部初筛等级，已记录差异，请复核控制覆盖。', 'The specified MLPS control target is below the internal screening level. Review the coverage difference.')}</Notice>}
        <ul>{[...new Set(result.matched_rules)].map(code => <li key={code}>{label(code)}</li>)}</ul>
        {!!result.unknown.length && <Notice>{t('存在待确认信息，建议为暂定等级。', 'Unresolved facts: this recommendation is provisional.')}<ul>{result.unknown.map(code => <li key={code}>{label(code)}</li>)}</ul></Notice>}
        {!!result.expert_review.length && <Notice>{t('涉及国家安全或特别严重公共影响，请转专家复核；本系统的 L3 不代表正式等保三级。', 'National-security or extreme public impact requires expert review. Internal L3 does not mean formal MLPS level 3.')}</Notice>}
        {!result.controls_ready && <Notice>{t('初筛可以确认，但以下框架尚无对应等级的已发布控制，控制匹配尚未就绪：', 'Screening can be confirmed, but published controls for this level are missing for:')} {result.missing_frameworks.join(', ')}。<Link to="/library">{t('维护控制库', 'Maintain library')}</Link>{t('。发布后返回此页刷新并重新确认分类。', '. After publication, refresh this page and reconfirm classification.')}</Notice>}
        <p>{t('适用', 'Applicable')}: {result.matches.filter(m => m.status === 'applicable').length} · {t('待确认', 'Unknown')}: {result.matches.filter(m => m.status === 'unknown').length}</p>
        <details><summary>{t('查看控制匹配结果', 'View control matches')}</summary>{result.matches.map(m => <p key={m.code}>{m.code} · {m.status} · {m.reason}</p>)}</details>
        <Button onClick={() => void run(`/systems/${detail.system.id}/classification-confirmations`, body).then(() => navigate(`/systems/${detail.system.id}/brief`)).catch(() => {})}>{t('确认初步分级', 'Confirm initial grading')}</Button>
      </div>}
    </fieldset>
    </div>
  </section>
}
