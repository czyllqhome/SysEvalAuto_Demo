import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { LocaleProvider } from './i18n'
import ControlQuestions from './ControlQuestions'
import type { SystemDetail } from './types'

afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals() })
const data = { version: 5, supported: true, pending_count: 1, facts: { 'ops.remote_admin': 'unknown' },
  config: { questions: [], profiles: [], domains: [], topics: [] },
  questions: [{ code: 'ops.remote_admin', group: 'operations', zh: '是否远程管理？', en: 'Remote administration?', kind: 'enum', values: ['yes', 'no', 'unknown'], when: true, affected_controls: ['REMOTE-1'] }] }
function mount(permissions = ['edit']) {
  const detail = { system: { id: 's1', version: 5, status: 'CONTROL_REVIEW' }, permissions } as SystemDetail
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><LocaleProvider><ControlQuestions detail={detail} pending={1} /></LocaleProvider></MemoryRouter></QueryClientProvider>)
}
it('submits explicit answers with the displayed revision and retains answers on conflict', async () => {
  const writes: unknown[] = []
  vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
    if (options?.method === 'PUT') {
      writes.push(JSON.parse(options.body))
      return new Response(JSON.stringify({ code: 'CLASSIFICATION_CHANGED' }), { status: 409 })
    }
    return new Response(JSON.stringify(data))
  }))
  mount()
  const field = await screen.findByLabelText('是否远程管理？')
  expect(field).toHaveAttribute('aria-required', 'true')
  expect(screen.getByText('保存答案并更新匹配')).toBeDisabled()
  expect(screen.getByText('REMOTE-1')).toBeInTheDocument()
  fireEvent.change(field, { target: { value: 'no' } })
  fireEvent.click(screen.getByText('保存答案并更新匹配'))
  await waitFor(() => expect(writes).toEqual([{ version: 5, answers: { 'ops.remote_admin': 'no' } }]))
  await screen.findByText('前往确认等级')
  expect(field).toHaveValue('no')
})
it('shows questions without allowing read-only users to edit them', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(data))))
  mount(['read'])
  expect(await screen.findByLabelText('是否远程管理？')).toBeDisabled()
  expect(screen.getByText('保存答案并更新匹配')).toBeDisabled()
})
