import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { api } from './api'
import { useCommand } from './components'
import { LocaleProvider } from './i18n'
import type { SystemDetail } from './types'

afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals() })

it('cancels an overlapping poll so an old read cannot roll back a completed save', async () => {
  const initial = { system: { id: 's1', version: 1 } } as SystemDetail
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  let finishSave!: (response: Response) => void
  let finishPoll!: (response: Response) => void
  let pollSignal: AbortSignal | undefined
  vi.stubGlobal('fetch', vi.fn((_url, options) => new Promise<Response>(resolve => {
    if (options.method === 'PUT') finishSave = resolve
    else { finishPoll = resolve; pollSignal = options.signal }
  })))
  function Probe() {
    const { data = initial } = useQuery({ queryKey: ['system', 's1'], initialData: initial, refetchOnMount: false,
      queryFn: ({ signal }) => api<SystemDetail>('/systems/s1', { signal }) })
    const { run, busy } = useCommand(data)
    return <><span>Version {data.system.version}</span><button disabled={busy} onClick={() => void run('/systems/s1/mlps-intake', {}, 'PUT')}>Save</button></>
  }
  render(<QueryClientProvider client={client}><LocaleProvider><Probe /></LocaleProvider></QueryClientProvider>)
  fireEvent.click(screen.getByText('Save'))
  await waitFor(() => expect(finishSave).toBeDefined())
  let poll!: Promise<void>
  act(() => { poll = client.refetchQueries({ queryKey: ['system', 's1'] }) })
  await waitFor(() => expect(finishPoll).toBeDefined())
  await act(async () => { finishSave(new Response(JSON.stringify({ system: { id: 's1', version: 2 } }))) })
  await screen.findByText('Version 2')
  expect(pollSignal?.aborted).toBe(true)
  await act(async () => { finishPoll(new Response(JSON.stringify(initial))); await poll })
  expect(screen.getByText('Version 2')).toBeVisible()
  client.clear()
})
