import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import DeliveryItemPanel from './DeliveryItemPanel'
import { LocaleProvider } from './i18n'
import { api, uploadEvidence } from './api'
import { deliveryFixture } from '../evals/fixtures/delivery'
import type { DeliveryBatch } from './deliveryModel'
import { deliveryToday } from './deliveryModel'

vi.mock('./api', async original => ({ ...await original<typeof import('./api')>(), api: vi.fn(), uploadEvidence: vi.fn() }))
afterEach(() => { cleanup(); vi.clearAllMocks(); localStorage.clear() })
const originalText = '保留已有说明'
it('uses the Beijing collection day during UTC midnight crossover', () => {
  expect(deliveryToday(new Date('2026-11-05T22:00:00Z'))).toBe('2026-11-06')
})
function Harness() {
  const initial = deliveryFixture(['read', 'upload'])
  const audit = initial.items.find(i => i.status === 'OPEN')!
  audit.snapshot.requirement!.title = '安全审计'; audit.draft = { description: originalText }
  audit.criteria = [{ id: 'AC-1', text: '核对审计记录' }]
  const [batch, setBatch] = useState(initial)
  return <DeliveryItemPanel batch={batch} item={batch.items.find(i => i.id === audit.id)!} initiallyOpen hidden={false} dirtyChanged={() => {}} acceptResult={async value => setBatch(value)} />
}
function show() { render(<QueryClientProvider client={new QueryClient()}><LocaleProvider><Harness /></LocaleProvider></QueryClientProvider>) }

it('fills actual audit evidence as an editable draft, maps the criterion, and restores original text on undo', async () => {
  const metadata = { description: '真实日志摘录及待核验范围', environment: '本地运行环境', system_version: 'v0.1', collected_on: '2026-01-01' }
  vi.mocked(api).mockResolvedValue({ filename: 'security-audit-log.png', image_base64: 'aGVsbG8=', draft: metadata })
  vi.mocked(uploadEvidence).mockImplementation(async () => {
    const batch: DeliveryBatch = deliveryFixture(['read', 'upload'])
    const item = batch.items.find(i => i.status === 'OPEN')!
    item.snapshot.requirement!.title = '安全审计'; item.criteria = [{ id: 'AC-1', text: '核对审计记录' }]
    item.draft = { description: originalText }; item.version++
    const attachment = { id: 'actual-log', filename: 'security-audit-log.png', mime: 'image/png', size: 5, sha256: 'hash', meta: metadata }
    item.attachments = [attachment]
    return { ...batch, attachment }
  })
  show()
  fireEvent.click(screen.getByRole('button', { name: '一键填入 Demo' }))
  await waitFor(() => expect(screen.getByLabelText('完成与证据说明')).toHaveValue(metadata.description))
  expect(uploadEvidence).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('checkbox', { name: 'security-audit-log.png' })).toBeChecked()
  expect(vi.mocked(api).mock.calls.every(([path]) => !path.includes('/submissions') && !path.endsWith('/draft'))).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: '撤销填入' }))
  expect(screen.getByLabelText('完成与证据说明')).toHaveValue(originalText)
})

it('retains authored input and offers retry when the audit preview fails', async () => {
  vi.mocked(api).mockRejectedValue(new Error('offline'))
  show(); fireEvent.click(screen.getByRole('button', { name: '一键填入 Demo' }))
  await screen.findByText(/NETWORK_ERROR/)
  expect(screen.getByLabelText('完成与证据说明')).toHaveValue(originalText)
  expect(screen.getByRole('button', { name: '一键填入 Demo' })).toBeEnabled()
  expect(uploadEvidence).not.toHaveBeenCalled()
})
