import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import { LocaleProvider } from './i18n'
import DeliveryWorkspace from './DeliveryWorkspace'

afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear() })

function renderBatch(actions = ['read', 'review', 'complete'], status = 'IN_REVIEW') {
  const item = { id: 'i', source_id: 'f', status, version: 3, draft: {}, snapshot: { finding: { title: '保留原始 finding' } }, criteria: [{ id: 'AC-1', text: 'Denied request tested' }], attachments: [], submissions: [{ id: 'sub', round_no: 1, manifest_hash: 'hash', payload: { draft: { description: '供应商原文', attachment_ids: ['a'], criteria_evidence_map: { 'AC-1': ['a'] } }, attachments: [] }, review: null }] }
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'b', name: 'System', status: 'ACTIVE', kind: 'plan', source_hash: 'source', version: 2, total: 1, approved: 0, allowed_actions: actions, items: [item] }) })
  vi.stubGlobal('fetch', fetcher)
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><LocaleProvider><MemoryRouter initialEntries={['/delivery/b']}><Routes><Route path="/delivery/:id" element={<DeliveryWorkspace />} /></Routes></MemoryRouter></LocaleProvider></QueryClientProvider>)
  return fetcher
}

it('requires rationale and per-criterion checks before passing a frozen submission', async () => {
  const fetcher = renderBatch()
  await screen.findByText('保留原始 finding')
  expect(screen.getByText('供应商原文')).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('结论'), { target: { value: 'PASS' } })
  fireEvent.change(screen.getByLabelText('审核依据'), { target: { value: 'Verified' } })
  expect(screen.getByRole('button', { name: '保存审核结论' })).toBeDisabled()
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(screen.getByRole('button', { name: '保存审核结论' }))
  await waitFor(() => expect(fetcher).toHaveBeenCalledWith('/api/v1/delivery-submissions/sub/reviews', expect.objectContaining({ body: expect.stringContaining('"submission_hash":"hash"') })))
  expect(screen.getByRole('button', { name: '完成本批交付审核' })).toBeDisabled()
})

it('does not expose customer decisions to a supplier and preserves drafts on errors', async () => {
  const fetcher = renderBatch(['read', 'upload'], 'OPEN')
  await screen.findByText('保留原始 finding')
  expect(screen.queryByLabelText('结论')).not.toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('完成与证据说明'), { target: { value: 'Keep my evidence description' } })
  fetcher.mockResolvedValueOnce({ ok: false, json: async () => ({ code: 'VERSION_CONFLICT' }) })
  fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))
  await screen.findByText(/VERSION_CONFLICT/)
  expect(screen.getByLabelText('完成与证据说明')).toHaveValue('Keep my evidence description')
  expect(screen.getByRole('button', { name: '正式提交' })).toBeDisabled()
})
