import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { LocaleProvider } from './i18n'
import NarrativeRefinement from './NarrativeRefinement'

afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear() })
it('requires acceptance, keeps questions separate, and can undo', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ state: 'succeeded', output: {
    topic: 'goal', original: '简单原文', text: '整理后的描述', questions: ['哪些用户？'],
  } }))))
  function Harness() {
    const [text, setText] = useState('简单原文')
    return <LocaleProvider><input aria-label="notes" value={text} onChange={e => setText(e.target.value)} /><NarrativeRefinement topic="goal" text={text} start={async () => 'job'} apply={setText} /></LocaleProvider>
  }
  render(<Harness />)
  fireEvent.click(screen.getByText('AI 优化描述'))
  await screen.findByText('整理后的描述')
  expect(screen.getByLabelText('notes')).toHaveValue('简单原文')
  fireEvent.click(screen.getByText('采纳并替换描述'))
  expect(screen.getByLabelText('notes')).toHaveValue('整理后的描述')
  fireEvent.click(screen.getByText('撤销本次采纳'))
  expect(screen.getByLabelText('notes')).toHaveValue('简单原文')
  fireEvent.click(screen.getByText('AI 优化描述'))
  await screen.findByText('整理后的描述')
  fireEvent.change(screen.getByLabelText('notes'), { target: { value: '后来修改' } })
  expect(screen.getByText('采纳并替换描述')).toBeDisabled()
})

it('expands a function into a separate destination only after acceptance and supports safe undo', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ state: 'succeeded', output: { topic: 'function_expansion', original: 'Function brief\n\nExisting description', text: 'Expanded description', questions: [] } }))))
  function FunctionHarness() {
    const [title, setTitle] = useState('Function brief'), [description, setDescription] = useState('Existing description')
    return <LocaleProvider><input aria-label="title" value={title} onChange={e => setTitle(e.target.value)} /><input aria-label="description" value={description} onChange={e => setDescription(e.target.value)} /><NarrativeRefinement compact buttonLabel="AI 扩写功能说明" topic="function_expansion" text={title + '\n\n' + description} value={description} start={async () => 'job'} apply={setDescription} /></LocaleProvider>
  }
  render(<FunctionHarness />)
  expect(screen.queryByText('AI 优化建议 · 待你确认')).not.toBeInTheDocument()
  fireEvent.click(screen.getByText('AI 扩写功能说明'))
  await screen.findByText('Expanded description')
  expect(screen.getByLabelText('description')).toHaveValue('Existing description')
  fireEvent.click(screen.getByText('采纳并替换描述'))
  expect(screen.getByLabelText('description')).toHaveValue('Expanded description')
  expect(screen.getByLabelText('title')).toHaveValue('Function brief')
  fireEvent.click(screen.getByText('撤销本次采纳'))
  expect(screen.getByLabelText('description')).toHaveValue('Existing description')
  fireEvent.click(screen.getByText('AI 扩写功能说明'))
  await screen.findByText('Expanded description')
  fireEvent.change(screen.getByLabelText('title'), { target: { value: 'Updated brief' } })
  expect(screen.getByText('采纳并替换描述')).toBeDisabled()
})
