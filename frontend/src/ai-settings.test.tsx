import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { LocaleProvider, useLocale } from './i18n'
import { AuthContext } from './components'
import AISettings from './AISettings'
import type { Session } from './types'
afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals() })
function Language() { const { setLocale } = useLocale(); return <button onClick={() => setLocale('en')}>English</button> }
it('preserves prompt edits through locale changes and saves explicitly with revision', async () => {
  const values = { model: 'sample/model', providers: '', zdr: false, max_tokens: 12000, reasoning_tokens: '', prompts: { context_organization: 'Original template', prd_generation: 'PRD template' } }
  const writes: Record<string, unknown>[] = []
  vi.stubGlobal('fetch', vi.fn(async (_url: string, options?: RequestInit) => {
    if (_url.endsWith('/prd-template')) return new Response(JSON.stringify({ version: 2, template: null, slots: ['name'] }))
    if (options?.method === 'PUT') writes.push(JSON.parse(String(options.body)))
    return new Response(JSON.stringify({ ...values, version: writes.length ? 3 : 2, defaults: values, key_configured: true }))
  }))
  const session = { user: { is_admin: true } } as Session
  render(<QueryClientProvider client={new QueryClient()}><LocaleProvider><AuthContext.Provider value={session}><Language /><AISettings /></AuthContext.Provider></LocaleProvider></QueryClientProvider>)
  const input = await screen.findByLabelText('应用说明整理')
  fireEvent.change(input, { target: { value: '用户编写的模板 {language}' } })
  fireEvent.click(screen.getByText('English'))
  expect(screen.getByLabelText('Organize application brief')).toHaveValue('用户编写的模板 {language}')
  expect(writes).toHaveLength(0)
  fireEvent.click(screen.getByRole('button', { name: 'Save model & templates' }))
  await waitFor(() => expect(writes).toHaveLength(1))
  expect(writes[0].version).toBe(2)
  expect((writes[0].prompts as Record<string, string>).context_organization).toBe('用户编写的模板 {language}')
  expect(writes[0]).not.toHaveProperty('key_configured')
})
