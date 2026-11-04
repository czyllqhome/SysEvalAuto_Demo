import PrdImport from './PrdImport'
import DemoFill from './DemoFill'
import { exampleBlocks } from './demoData'
import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Check, ChevronRight, FileText } from 'lucide-react'
import { Button, Notice, useCommand } from './components'
import { topicData, useLocale } from './i18n'
import type { SystemDetail } from './types'
import NarrativeRefinement from './NarrativeRefinement'

export function DiscoveryPanel({ detail }: { detail: SystemDetail }) {
  const { t, pair, locale } = useLocale()
  const client = useQueryClient()
  const navigate = useNavigate()
  const [blocks, setBlocks] = useState<Record<string, string>>(detail.system.draft.blocks ?? {})
  const beforeDemo = useRef(blocks)
  const [topic, setTopic] = useState('goal')
  const [, refreshSaved] = useState(0)
  const savedSnapshot = useRef(JSON.stringify(blocks))
  const remoteSnapshot = useRef(detail.system.draft.blocks ?? {})
  const blocksRef = useRef(blocks)
  blocksRef.current = blocks
  useEffect(() => {
    const next = detail.system.draft.blocks ?? {}
    const previous = remoteSnapshot.current
    if (JSON.stringify(next) === JSON.stringify(previous)) return
    remoteSnapshot.current = next
    savedSnapshot.current = JSON.stringify(next)
    setBlocks(local => {
      const merged = { ...next }
      for (const key of new Set([...Object.keys(local), ...Object.keys(previous)])) {
        if ((local[key] ?? '') !== (previous[key] ?? '')) merged[key] = local[key] ?? ''
      }
      blocksRef.current = merged
      return merged
    })
  }, [detail.system.draft.blocks])
  const inFlight = useRef<Promise<void> | null>(null)
  const { run, busy, error } = useCommand(detail)
  const snapshot = JSON.stringify(blocks)
  const saved = snapshot === savedSnapshot.current
  async function save() {
    if (inFlight.current) await inFlight.current
    const authored = blocksRef.current
    const latest = client.getQueryData<SystemDetail>(['system', detail.system.id]) ?? detail
    const currentBlocks = { ...latest.system.draft.blocks }
    for (const key of new Set([...Object.keys(authored), ...Object.keys(remoteSnapshot.current)])) {
      if ((authored[key] ?? '') !== (remoteSnapshot.current[key] ?? '')) currentBlocks[key] = authored[key] ?? ''
    }
    const currentSnapshot = JSON.stringify(currentBlocks)
    if (savedSnapshot.current === currentSnapshot) return
    const operation = run(`/systems/${detail.system.id}/context-draft`, { blocks: currentBlocks }, 'PUT').then(() => {
      savedSnapshot.current = currentSnapshot
      remoteSnapshot.current = currentBlocks
      refreshSaved(value => value + 1)
    })
    inFlight.current = operation
    try { await operation } finally { if (inFlight.current === operation) inFlight.current = null }
  }
  useEffect(() => {
    if (savedSnapshot.current === snapshot) return
    const timer = setTimeout(() => { void save().catch(() => {}) }, 1000)
    return () => clearTimeout(timer)
  }, [snapshot, detail.system.version])
  const selected = topicData.find(item => item.key === topic)!
  const count = Object.values(blocks).filter(value => value.trim()).length
  async function proceed() {
    try { await save(); navigate(`/systems/${detail.system.id}/brief`) } catch { /* Keep authored text. */ }
  }
  return <section>
    <div className="section-heading"><div><span className="eyebrow">02 / SYSTEM INFORMATION</span><h2>{t('系统信息录入', 'System information')}</h2><p className="muted">{t('根据已确认的初步等级补充系统信息，之后整理为应用说明供你审查。', 'Complete system information after preliminary grading, then review a structured brief built from these notes.')}</p></div><div className="page-heading-actions"><DemoFill disabled={busy} apply={() => { beforeDemo.current = blocks; setBlocks(exampleBlocks(locale === 'zh')) }} undo={() => setBlocks(beforeDemo.current)} /><span className="save-state"><i className={saved ? 'saved' : ''} />{busy ? t('保存中…', 'Saving…') : saved ? t('已保存', 'Saved') : t('草稿', 'Draft')}</span></div></div>
    {error && <Notice error>{error}</Notice>}
    <PrdImport detail={detail} save={save} />
    <div className="description-sequence"><span>{t('确认等级', 'Confirm level')}</span><ArrowRight size={14} /><span className="current">{t('录入系统信息', 'Enter system information')}</span><ArrowRight size={14} /><span>{t('审查整理结果', 'Review the brief')}</span><ArrowRight size={14} /><span>{t('确认后匹配控制', 'Confirm & match controls')}</span></div>
    <div className="discovery-layout description-only"><aside className="topic-rail"><span className="eyebrow">{t('信息分类', 'INFORMATION CATEGORIES')}</span>{topicData.map((item, index) => <button key={item.key} className={item.key === topic ? 'active' : ''} onClick={() => setTopic(item.key)}><span className="mono">0{index + 1}</span><span>{pair(item.label)}</span>{blocks[item.key]?.trim() ? <Check size={14} /> : <ChevronRight size={14} />}</button>)}<div className="topic-rail-note"><FileText size={20} /><p>{t('原文只在这里填写。\n审查时无需重复录入。', 'Write your original notes here.\nNo repeated entry during review.')}</p><span className="mono">{count} / 08</span></div></aside>
      <NarrativeRefinement key={topic} topic={topic} text={blocks[topic] ?? ''} apply={text => setBlocks(previous => ({ ...previous, [topic]: text }))} start={async () => {
      await save()
      const result = await run(`/systems/${detail.system.id}/jobs`, { kind: `narrative_refinement:${topic}`, mode: 'openrouter', language: locale })
      return result.job_id!
    }}>
      <div className="narrative-paper"><div className="paper-heading"><span className="eyebrow">FIELD NOTE / 0{topicData.indexOf(selected) + 1}</span><span className="mono">{(blocks[topic] ?? '').length} / 10,000</span></div><h3>{pair(selected.prompt)}</h3>{detail.system.draft.block_sources?.[topic] && <span className="field-hint">{t('来自 PRD · 待核对（来源见导入面板）', 'From PRD · Review needed (see import panel for evidence)')}</span>}<p className="field-hint">{pair(selected.hint)}</p><textarea className="narrative-input" aria-label={pair(selected.label)} maxLength={10000} placeholder={t('请输入系统相关信息…', 'Enter system information…')} value={blocks[topic] ?? ''} onChange={event => setBlocks({ ...blocks, [topic]: event.target.value })} /><div className="paper-bottom"><span className="field-hint">{t('自动保存描述；主动解析 PRD 或点击 AI 优化才调用模型。', 'Notes are autosaved. AI runs only when you parse a PRD or request refinement.')}</span><div><button className="icon-button" aria-label={t('上一个主题', 'Previous topic')} disabled={topicData.indexOf(selected) === 0} onClick={() => setTopic(topicData[topicData.indexOf(selected) - 1].key)}><ArrowLeft size={16} /></button><button className="icon-button" aria-label={t('下一个主题', 'Next topic')} disabled={topicData.indexOf(selected) === topicData.length - 1} onClick={() => setTopic(topicData[topicData.indexOf(selected) + 1].key)}><ArrowRight size={16} /></button></div></div><p className="description-footnote">{t('不必一次答完八个主题。不确定的信息可以留待澄清，分级后再审查和补充整理结果。', 'You do not need all eight topics at once. Leave uncertain facts for clarification and refine the organized result after classification.')}</p></div>
      </NarrativeRefinement>
    </div>

    <div className="stage-actions"><Button variant="secondary" busy={busy} onClick={() => void save().catch(() => {})}>{t('保存原始描述', 'Save original notes')}</Button><Button busy={busy} disabled={!count} onClick={() => void proceed()}>{t('继续审查应用说明', 'Continue to brief review')}<ArrowRight size={16} /></Button></div>
  </section>
}
