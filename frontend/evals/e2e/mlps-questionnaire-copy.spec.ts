import { expect, test } from '@playwright/test'
import questions from '../../../backend/app/data/mlps_questionnaire.json' with { type: 'json' }
import demo from '../../../backend/app/data/mlps_demo_template.json' with { type: 'json' }

test('questionnaire copy and population grade bands preserve authored answers on desktop and mobile', async ({ page }, testInfo) => {
  const unexpected: string[] = []
  const saved = { ...demo.template, notes: { ...demo.template.notes, security_responsible_entity: '外部单位原文 / Authored supplier' } }
  const detail = { system: { id: 'copy-review', name: '问卷界面回归示例', status: 'CLASSIFYING', revision: 1, version: 1, context: {}, draft: {}, classification: {}, assessment_type: 'new' }, controls: [], prd: null, round: null, report: null, baseline: null, job: null, permissions: ['read', 'edit', 'manage'] }
  await page.route('**/api/v1/**', route => {
    const request = route.request(), path = new URL(request.url()).pathname
    if (request.method() === 'GET') {
      if (path === '/api/v1/auth/session') return route.fulfill({ json: { user: { id: 'admin', name: 'Administration', role: 'owner', is_admin: true, org_id: 'demo' }, csrf: 'offline', model_configured: false } })
      if (path === '/api/v1/systems/copy-review') return route.fulfill({ json: detail })
      if (path === '/api/v1/systems/copy-review/mlps-intake') return route.fulfill({ json: { questions, saved, demo_template: demo.template, permissions: detail.permissions, catalog_id: 'catalog', legacy: false } })
    }
    unexpected.push(`${request.method()} ${path}`)
    return route.fulfill({ status: 403, json: { code: 'FORBIDDEN' } })
  })
  await page.setViewportSize({ width: 2391, height: 1105 })
  await page.goto('/systems/copy-review/classification')
  await expect(page.getByLabel('是否已明确由哪一家外部单位对这个系统的安全负主要责任？')).toBeVisible()
  await expect(page.getByLabel('主要负责外部单位名称（必填）')).toHaveValue('外部单位原文 / Authored supplier')
  const network = page.locator('#external_network_access')
  await expect(network).toHaveValue('存在公众可访问入口')
  await expect(network.locator('option:checked')).toHaveText('公网可访问入口')
  const count = page.locator('#personal_info_count_system')
  await expect(count.locator('option')).toHaveText(['请选择', '0–9,999 人', '10,000–99,999 人', '100,000 人及以上', '不确定'])
  await expect(count).toHaveValue('100,000 人及以上')
  await expect(page.getByText(/内部最低等级：0–9,999 人为 1 级，10,000–99,999 人为 2 级，100,000 人及以上为 3 级/)).toBeVisible()
  const compact = page.locator('.mlps-grading-compact')
  const cards = compact.locator(':scope > .mlps-question')
  await expect(compact.locator('.mlps-question-meta > span:first-child')).toHaveText(['G01', 'G02', 'G03', 'G04', 'G05', 'G06', 'G09', 'G10', 'G11', 'G12'])
  await expect(page.locator('.mlps-fields > .mlps-question .mlps-question-meta > span:first-child')).toHaveText(['G07', 'G08', 'G13', 'G14'])
  const desktopRects = await cards.evaluateAll(elements => elements.map(element => { const rect = element.getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width } }))
  expect(desktopRects[0].y).toBe(desktopRects[1].y)
  expect(desktopRects[1].x).toBeGreaterThan(desktopRects[0].x)
  await page.getByRole('button', { name: '一键填入 Demo' }).click()
  await expect(page.getByLabel('主要负责外部单位名称（必填）')).toHaveValue('PwC Cyber ')
  await expect(count).toHaveValue('100,000 人及以上')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('questionnaire-copy-desktop.png'), fullPage: true })
  await page.setViewportSize({ width: 1420, height: 1105 })
  const mediumRects = await cards.evaluateAll(elements => elements.map(element => { const rect = element.getBoundingClientRect(); return { x: rect.x, y: rect.y } }))
  expect(mediumRects[0].y).toBe(mediumRects[1].y)
  expect(mediumRects[1].x).toBeGreaterThan(mediumRects[0].x)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
  await page.getByRole('button', { name: '撤销 Demo 填入' }).click()
  await expect(page.getByLabel('主要负责外部单位名称（必填）')).toHaveValue('外部单位原文 / Authored supplier')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: '切换为 English' }).click()
  await expect(page.getByLabel('Is it clear which external organization is primarily responsible for this system’s security?')).toBeVisible()
  await expect(page.getByLabel('Responsible external organization (required)')).toHaveValue('外部单位原文 / Authored supplier')
  await expect(network.locator('option:checked')).toHaveText('Public internet ingress')
  await expect(count.locator('option')).toHaveText(['Select an answer', '0–9,999 people', '10,000–99,999 people', '100,000 people or more', 'Unknown'])
  await expect(count).toHaveValue('100,000 人及以上')
  const mobileRects = await cards.evaluateAll(elements => elements.map(element => { const rect = element.getBoundingClientRect(); return { x: rect.x, y: rect.y } }))
  expect(mobileRects[0].x).toBe(mobileRects[1].x)
  expect(mobileRects[1].y).toBeGreaterThan(mobileRects[0].y)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('questionnaire-copy-mobile.png'), fullPage: true })
  expect(unexpected).toEqual([])
})
