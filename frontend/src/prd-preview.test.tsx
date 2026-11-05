import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, expect, it, vi } from 'vitest'
import { LocaleProvider, useLocale } from './i18n'
import PrdPreview from './PrdPreview'

function Toggle() { const { setLocale } = useLocale(); return <button onClick={() => setLocale('en')}>English</button> }
function View({ id = 'v1' }: { id?: string }) {
  return <LocaleProvider><Toggle /><PrdPreview systemId="system" prdId={id} /></LocaleProvider>
}
afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals() })
it('keeps the main document readable and exposes the full appendix on demand', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('# PRD\n\n## 7 安全开发需求\n\n### 网络安全\n\n- 控制内容\n\n<!-- syseval:prd-appendix -->\n\n## 附录 A 验收清单\n\nAC-REQ-001 原始验收条件')))
  render(<QueryClientProvider client={new QueryClient()}><View /></QueryClientProvider>)
  expect(await screen.findByText('控制内容')).toBeVisible()
  expect(screen.getByText('AC-REQ-001 原始验收条件')).not.toBeVisible()
  fireEvent.click(screen.getByText('验收、实施说明与来源附录'))
  expect(screen.getByText('AC-REQ-001 原始验收条件')).toBeVisible()
})
it('displays embedded raster topology images while blocking SVG and remote image requests', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('## 系统开发架构\n\n### 网络拓扑图\n\n![网络拓扑图](data:image/png;base64,YWJj)\n\n![svg](data:image/svg+xml;base64,YWJj)\n\n![remote](https://example.test/tracker.png)')))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const { container } = render(<QueryClientProvider client={client}><View /></QueryClientProvider>)
  expect(await screen.findByRole('img', { name: '网络拓扑图' })).toHaveAttribute('src', 'data:image/png;base64,YWJj')
  expect(container.querySelectorAll('img')).toHaveLength(1)
})
it('renders saved template headings and GFM tables, retaining authored text across locale and version changes', async () => {
  const fetcher = vi.fn(async (url: string) => new Response(url.includes('/v2/') ? '# 新修订\n\n## 自定义章节' : '# 保存的文档\n\n## 7 外部集成\n\n| 接口 | 说明 |\n| --- | --- |\n| API | 原文 |\n\n## 2 角色'))
  vi.stubGlobal('fetch', fetcher)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const view = render(<QueryClientProvider client={client}><View /></QueryClientProvider>)
  await screen.findByRole('heading', { name: '保存的文档' })
  expect(screen.getAllByRole('heading').map(h => h.textContent)).toEqual(['保存的文档', '7 外部集成', '2 角色'])
  expect(screen.getByRole('table')).toHaveTextContent('API')
  fireEvent.click(screen.getByText('English'))
  expect(screen.getByLabelText('PRD template preview')).toHaveTextContent('保存的文档')
  expect(fetcher).toHaveBeenCalledWith('/api/v1/systems/system/prd-versions/v1/document', expect.objectContaining({ credentials: 'same-origin' }))
  view.rerender(<QueryClientProvider client={client}><View id="v2" /></QueryClientProvider>)
  await screen.findByRole('heading', { name: '新修订' })
  expect(screen.queryByText('保存的文档')).not.toBeInTheDocument()
})
it('does not execute raw HTML, unsafe URLs or remote images and allows retry after errors', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response('', { status: 503 })).mockResolvedValue(new Response('# Safe\n\n<script>alert(1)</script>\n\n[bad](javascript:alert)\n\n![diagram](https://example.test/tracker.png)'))
  vi.stubGlobal('fetch', fetcher)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const { container } = render(<QueryClientProvider client={client}><View /></QueryClientProvider>)
  fireEvent.click(await screen.findByRole('button', { name: '重试' }))
  await screen.findByRole('heading', { name: 'Safe' })
  expect(container.querySelector('script')).toBeNull()
  expect(container.querySelector('img')).toBeNull()
  expect(container.querySelector('a')?.getAttribute('href')).not.toContain('javascript:')
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
})
