import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { LocaleProvider } from './i18n'
import PrdTemplateEditor from './PrdTemplateEditor'

afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals() })
it('rejects non-md files, edits explicitly and deletes with revision protection', async () => {
  const writes: any[] = []
  vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
    if (options.method === 'PUT') writes.push(JSON.parse(options.body))
    return new Response(JSON.stringify({ version: 4 + writes.length, template: writes.length ? writes.at(-1).template : { filename: 'prd.md', content: '# {{name}}' }, slots: ['name'] }))
  }))
  render(<QueryClientProvider client={new QueryClient()}><LocaleProvider><PrdTemplateEditor /></LocaleProvider></QueryClientProvider>)
  const field = await screen.findByLabelText('Markdown 模板内容')
  fireEvent.change(screen.getByLabelText('上传 .md 模板'), { target: { files: [new File(['bad'], 'bad.docx')] } })
  await screen.findByText('仅接受不超过 100 KB 的 UTF-8 .md 文件。')
  expect(field).toHaveValue('# {{name}}')
  fireEvent.change(field, { target: { value: '# 我的 {{name}}' } })
  expect(writes).toHaveLength(0)
  fireEvent.click(screen.getByText('保存 PRD 模板'))
  await waitFor(() => expect(writes).toHaveLength(1))
  expect(writes[0]).toEqual({ version: 4, template: { filename: 'prd.md', content: '# 我的 {{name}}' } })
  await waitFor(() => expect(screen.getByText('删除 PRD 模板')).not.toBeDisabled())
  fireEvent.click(screen.getByText('删除 PRD 模板'))
  await screen.findByText('未配置自定义模板。')
  expect(writes[1]).toEqual({ version: 5, template: null })
})
