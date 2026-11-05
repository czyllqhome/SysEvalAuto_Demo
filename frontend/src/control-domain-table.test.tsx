import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { LocaleProvider, useLocale } from './i18n'
import ControlDomainTable from './ControlDomainTable'
import type { Control } from './types'

afterEach(() => { cleanup(); localStorage.clear() })
const control: Control = { id: 'one', code: 'MLPS2-internal-id', domain: 'network', levels: ['L2'], required: true, catalog_id: 'pinned',
  translations: { zh: { title: '身份鉴别', description: '作者原文：保护通信。', verification: '保留测试证据' } },
  metadata: { source_level: 2, source_ref: '7.1.4.1 -a)', source: { schema: 'CONTROL-SIX/1', languages: {
    zh: { fields: { risk_level: 'High' } }, en: { fields: { risk_level: 'Low' } },
  } } }, included: true, origin: 'matched' }
function Toggle() { const { setLocale } = useLocale(); return <button onClick={() => setLocale('en')}>English</button> }

it('uses compact domain tables, original source codes and pinned source risk in both languages', () => {
  const onToggle = vi.fn()
  const second = { ...control, id: 'two', code: 'C2', metadata: { source: { fields: { risk_level: ' Medium ' } } }, included: false, reason: '人工豁免理由' }
  render(<LocaleProvider><Toggle /><ControlDomainTable controls={[control, second]} selections={[control, second]} domains={{ network: ['安全通信网络', 'Communication security'] }} disabled={false} onToggle={onToggle} onQuestions={vi.fn()} onExclude={vi.fn()} /></LocaleProvider>)
  const table = screen.getByRole('table', { name: '安全通信网络' })
  expect(within(table).getAllByRole('columnheader').map(el => el.textContent)).toEqual(['编码', '控制点', '要求', '风险等级'])
  expect(within(table).getByText('L2-7.1.4.1-a')).toBeVisible()
  expect(within(table).getByText('高风险', { exact: true })).toBeVisible()
  expect(within(table).getByText('中风险')).toHaveClass('control-risk-medium')
  expect(within(table).getByText('高风险')).toHaveClass('control-risk-high')
  expect(screen.getByText('人工豁免理由')).not.toBeVisible()
  expect(screen.getAllByText('保留测试证据')[0]).not.toBeVisible()
  fireEvent.click(screen.getAllByText('测评方法与预期证据')[0])
  expect(screen.getAllByText('保留测试证据')[0]).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '排除 身份鉴别' }))
  expect(onToggle).toHaveBeenCalledWith(control)
  fireEvent.click(screen.getByText('English'))
  expect(screen.getByRole('columnheader', { name: 'Risk level' })).toBeVisible()
  expect(screen.getByText('High risk', { exact: true })).toBeVisible()
  expect(screen.getByText('Medium risk')).toBeVisible()
  expect(screen.getAllByText('作者原文：保护通信。')).toHaveLength(2)
})

it('keeps candidate actions visible on expansion and disables mutations for readers', () => {
  const candidate = { ...control, included: false, origin: 'candidate' }
  const onQuestions = vi.fn(), onExclude = vi.fn()
  const props = { controls: [candidate], selections: [candidate], domains: {}, onToggle: vi.fn(), onQuestions, onExclude }
  const view = render(<LocaleProvider><ControlDomainTable {...props} disabled={false} /></LocaleProvider>)
  expect(screen.getByText(/待确认/)).toBeVisible()
  fireEvent.click(screen.getByText(/测评方法与预期证据/))
  fireEvent.click(screen.getByRole('button', { name: '补充适用信息' }))
  fireEvent.click(screen.getByRole('button', { name: '记录不适用理由' }))
  expect(onQuestions).toHaveBeenCalledOnce()
  expect(onExclude).toHaveBeenCalledWith(candidate)
  view.rerender(<LocaleProvider><ControlDomainTable {...props} disabled /></LocaleProvider>)
  expect(screen.getByRole('button', { name: '加入 身份鉴别' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '记录不适用理由' })).toBeDisabled()
})
