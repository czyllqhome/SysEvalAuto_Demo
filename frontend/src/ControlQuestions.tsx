import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api, ApiError } from './api'
import { Button, Notice } from './components'
import { useLocale } from './i18n'
import { FactFields } from './TagClassification'
import type { Config, Definition, Fact } from './libraryTypes'
import type { SystemDetail } from './types'

type Questions = { version: number; supported: boolean; config: Config; facts: Record<string, Fact>; pending_count: number; questions: (Definition & { affected_controls: string[] })[] }
const known = (value: Fact) => value !== 'unknown' && value !== '' && !(Array.isArray(value) && value.includes('unknown'))

export default function ControlQuestions({ detail, pending }: { detail: SystemDetail; pending: number }) {
  const { t } = useLocale()
  const query = useQuery({ queryKey: ['applicability', detail.system.id, detail.system.version], queryFn: () => api<Questions>(`/systems/${detail.system.id}/applicability-questions`) })
  return <section className="paper-panel applicability-questions" aria-label={t('待补充的控制适用信息', 'Missing control applicability information')}>
    <h3>{t('补充适用信息，完成控制审查', 'Complete applicability information to finish control review')}</h3>
    <p>{query.data && (!query.data.supported || !query.data.questions.length)
      ? t(`还有 ${pending} 条控制需要人工复核。当前没有可补填的问卷项，请在控制卡片中明确纳入，或记录不适用理由后排除。`, `${pending} controls need manual review. There are no additional questionnaire fields. Include each control or exclude it with a rationale.`)
      : t(`还有 ${pending} 条控制待决定。请补充下方适用信息，或在条目中明确纳入／排除。`, `${pending} controls need a decision. Complete the applicability fields below, or explicitly include/exclude each control.`)}</p>
    {query.isPending && <p>{t('正在查找待补充问题…', 'Finding missing questions…')}</p>}
    {query.error && <Notice error>{t('读取问题失败。', 'Could not load questions.')}<Button onClick={() => void query.refetch()}>{t('重试', 'Retry')}</Button></Notice>}
    {query.data && <Answers key={`${detail.system.id}:${query.data.version}`} detail={detail} data={query.data} />}
  </section>
}

function Answers({ detail, data }: { detail: SystemDetail; data: Questions }) {
  const { t, locale, error: translate } = useLocale()
  const client = useQueryClient()
  const [answers, setAnswers] = useState<Record<string, Fact>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [code, setCode] = useState('')
  const editable = (!detail.permissions || detail.permissions.includes('edit')) && detail.system.status === 'CONTROL_REVIEW'
  const supplied = Object.fromEntries(Object.entries(answers).filter(([, value]) => known(value)))
  async function save() {
    setBusy(true); setError(''); setCode('')
    try {
      const result = await api<SystemDetail>(`/systems/${detail.system.id}/applicability-answers`, { method: 'PUT', body: { version: data.version, answers: supplied }, key: crypto.randomUUID() })
      client.setQueryData(['system', detail.system.id], result)
      await Promise.all([client.invalidateQueries({ queryKey: ['controls', detail.system.id] }), client.invalidateQueries({ queryKey: ['applicability', detail.system.id] }), client.invalidateQueries({ queryKey: ['systems'] }), client.invalidateQueries({ queryKey: ['screening', detail.system.id] })])
    } catch (cause) {
      const next = cause instanceof ApiError ? cause.code : 'NETWORK_ERROR'
      setCode(next); setError(translate(next))
    } finally { setBusy(false) }
  }
  if (!data.supported || !data.questions.length) return <Notice>{t('没有待填写的必填问题。候选条目可能来自方案变化后的既有选择；请查看卡片的“验收证据与匹配依据”，再决定纳入或排除。', 'There are no required questions to fill. Candidates may be earlier selections affected by a profile change. Review each card’s matching rationale before including or excluding it.')}</Notice>
  return <>
    {error && <Notice error>{error}{code === 'CLASSIFICATION_CHANGED' && <p>{t('这些答案涉及分级依据或与已确认说明不一致，请返回确认等级后继续。', 'These answers affect grading evidence or conflict with the confirmed brief. Reconfirm classification to continue.')} <Link to={`/systems/${detail.system.id}/classification`}>{t('前往确认等级', 'Review classification')}</Link></p>}</Notice>}
    {!editable && <Notice>{t('请由该评估的经办人补充答案。', 'The assigned operator must complete these answers.')}</Notice>}
    {data.questions.map(question => <fieldset key={question.code} disabled={!editable || busy || !!question.risk}>
      <FactFields flat required config={{ ...data.config, questions: [question] }} facts={{ ...data.facts, ...answers }} setFacts={facts => setAnswers(old => ({ ...old, [question.code]: facts[question.code] }))} />
      <details><summary>{t(`影响 ${question.affected_controls.length} 条控制，查看编号`, `Affects ${question.affected_controls.length} controls — view codes`)}</summary><p>{question.affected_controls.join(' · ')}</p></details>
      {question.risk && <p>{question[locale]} — {t('涉及分级依据，需返回确认等级填写。', 'This is grading evidence; answer it on Classification.')} <Link to={`/systems/${detail.system.id}/classification`}>{t('前往确认等级', 'Review classification')}</Link></p>}
    </fieldset>)}
    <p className="field-hint">{t('保存后更新当前控制匹配。受答案影响的既有人工决定会提示重新复核；等级保持已确认值。', 'Saving updates control matching. Existing manual decisions affected by these answers require review. The confirmed level is retained.')}</p>
    <Button busy={busy} disabled={!editable || !Object.keys(supplied).length} onClick={() => void save()}>{t('保存答案并更新匹配', 'Save answers & update matching')}</Button>
  </>
}
