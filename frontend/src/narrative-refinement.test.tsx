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
