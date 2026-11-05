import { expect, test } from '@playwright/test'

test('grade-result cards show complete answer choices on desktop and mobile without changing the snapshot', async ({ page }, testInfo) => {
  const unexpected: string[] = []
  const traces = [
    { code: 'link', field: 'interconnected_system_level', answer: '1 级', level: 1 },
    { code: 'network', field: 'external_network_access', answer: '存在公众可访问入口', level: 2 },
    { code: 'business', field: 'critical_business', answer: '非核心', level: 1 },
    { code: 'population', field: 'personal_info_count_system', answer: '100,000 人及以上', level: 3 },
    { code: 'records', field: 'data_volume_ranges', subfield: 'records', answer: 'under_100k', level: 1 },
    { code: 'storage', field: 'data_volume_ranges', subfield: 'storage', answer: '1_10tb', level: 2 },
  ].map(row => ({ ...row, zh: '固定的历史计算依据', en: 'Pinned historical grading basis' }))
  const detail = { system: { id: 'grade-options', name: '定级选项展示示例', status: 'CONTEXT_REVIEW', revision: 2, version: 5, context: {}, draft: {}, assessment_type: 'new', classification: {
    scheme: 'MLPS-INTAKE/1', effective_level: 'L3', frameworks: ['MLPS_LEVEL_3'], answers: { external_network_access: '存在公众可访问入口', personal_info_count_system: '100,000 人及以上' },
    assessment: { status: 'preliminary_complete', proposed_level: 3, base_level: 1, business_information_level: 1, system_service_level: 1, special_principle_minimum: null, is_lower_bound_only: false, rule_trace: [], issues: [], alerts: [], organization_minimum: 3, organization_rule_trace: traces },
  } }, permissions: ['read'], controls: [], prd: null, round: null, report: null, baseline: null, job: null }
  await page.route('**/api/v1/**', route => {
    const request = route.request(), path = new URL(request.url()).pathname
    if (request.method() === 'GET' && path === '/api/v1/auth/session') return route.fulfill({ json: { user: { id: 'reader', name: '审查人原文', role: 'member', org_id: 'demo', is_admin: false }, csrf: 'offline', model_configured: false } })
    if (request.method() === 'GET' && path === '/api/v1/systems/grade-options') return route.fulfill({ json: detail })
    unexpected.push(`${request.method()} ${path}`)
    return route.fulfill({ status: 403, json: { code: 'FORBIDDEN' } })
  })
  await page.setViewportSize({ width: 2391, height: 1105 })
  await page.goto('/systems/grade-options/grade-result')
  const network = page.getByRole('list', { name: '网络入口方式 · 全部选项' })
  await expect(network.getByRole('listitem')).toHaveText(['无', '仅经VPN/零信任接入', '存在受控互联网入口', '公网可访问入口已选', '不确定'])
  await expect(network.locator('[aria-current="true"]')).toContainText('公网可访问入口')
  await expect(page.locator('.grade-score-card input[type=range]')).toHaveCount(0)
  await network.getByText('存在受控互联网入口', { exact: true }).click()
  await expect(network.locator('[aria-current="true"]')).toContainText('公网可访问入口')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('grade-result-options-desktop.png'), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: '切换为 English' }).click()
  const englishNetwork = page.getByRole('list', { name: 'Network ingress · All options' })
  await expect(englishNetwork.getByRole('listitem')).toHaveText(['None', 'VPN/zero-trust only', 'Controlled internet ingress', 'Public internet ingressSelected', 'Unknown'])
  await expect(page.getByRole('list', { name: 'Data storage volume · All options' }).getByText('100 TB or more')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('grade-result-options-mobile.png'), fullPage: true })
  expect(unexpected).toEqual([])
})
