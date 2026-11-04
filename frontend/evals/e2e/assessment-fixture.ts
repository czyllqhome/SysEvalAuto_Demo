import { expect, type Page } from '@playwright/test'

export async function prepareScope(page: Page, sid: string) {
  const session = await (await page.request.get('/api/v1/auth/session')).json()
  const headers = { 'X-CSRF-Token': session.csrf }
  const state = await (await page.request.get('/api/v1/library')).json()
  const added = await page.request.post('/api/v1/library/controls', { headers, data: { version: state.version, operation: 'create', control: {
    control_code: 'QA-AUDIT-1', translations: { en: { title: 'Record privileged operations', description: 'Record privileged actions and their results.', verification: 'Inspect retained audit records.' } },
    assessment_object: 'Business system', domain_code: 'BOUNDARY', assessment_profiles: ['MLPS2_REFERENCE'], required: true, topic_tags: ['boundary'],
    applicability_mode: 'always', rule: true, responsibility_rule: 'shared', source_framework: 'CUSTOM', source_ref: 'Synthetic QA policy', review_status: 'reviewed',
  } } })
  expect(added.ok(), await added.text()).toBeTruthy()
  const published = await page.request.post('/api/v1/library/publish', { headers, data: { version: (await added.json()).version } })
  expect(published.ok(), await published.text()).toBeTruthy()
  async function command(action: string, body: unknown) {
    const current = await (await page.request.get(`/api/v1/systems/${sid}`)).json()
    const response = await page.request.post(`/api/v1/systems/${sid}/${action}`, { headers, data: { version: current.system.version, ...body as object } })
    expect(response.ok(), await response.text()).toBeTruthy()
  }
  await command('classification-confirmations', { scheme: 'SYS-SCREEN/2', mode: 'manual', level: 'L2', reason: 'QA reviewed business impact', frameworks: ['CUSTOM'], facts: {} })
  await command('context-confirmations', { context: {
    summary: 'Production service portal', functions: [{ id: 'F1', title: 'Create tickets', description: 'Create and assign service tickets', source_blocks: ['functions'] }],
    departments: ['Service'], roles: ['Operator'], owner_role: 'Service owner', scope: 'Ticket lifecycle', workflow: 'Create, assign, close',
    data_notes: 'Customer requests', integrations: 'Directory', constraints: 'Business hours', questions: [], grading_facts: {},
  } })
}
