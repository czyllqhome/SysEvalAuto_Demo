import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import Workspace from './Workspace'
import { AuthContext } from './components'
import { LocaleProvider } from './i18n'

vi.mock('./downstream', () => ({ AgreementPanel: () => <h2>Joint confirmation ready</h2>, ImpactPanel: () => <h2>Review</h2>, SupplierPanel: () => null, PrdPanel: () => null }))
afterEach(cleanup)

it.each(['vendor', 'member'] as const)('redirects completed remediation links to confirmation for %s', async role => {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } })
  client.setQueryData(['system', 's'], { system: { id: 's', status: 'FINAL_CONFIRMATION', name: 'Test', draft: {}, classification: {}, context: {} },
    controls: [], baseline: { id: 'b', confirmations: [], content_hash: 'same-hash', finalized: false } })
  render(<QueryClientProvider client={client}><LocaleProvider><AuthContext.Provider value={{ user: { id: 'u', role, org_id: 'org', name: 'Test', email: 'test@example.test' }, csrf: '', model_configured: false }}><MemoryRouter initialEntries={['/systems/s/impact']}><Routes><Route path="/systems/:id/:tab" element={<Workspace />} /></Routes></MemoryRouter></AuthContext.Provider></LocaleProvider></QueryClientProvider>)
  expect(await screen.findByRole('heading', { name: 'Joint confirmation ready' })).toBeVisible()
  expect(screen.queryByRole('heading', { name: 'Review' })).not.toBeInTheDocument()
})
