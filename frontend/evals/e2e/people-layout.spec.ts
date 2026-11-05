import { expect, test } from '@playwright/test'

const people = {
  users: [
    { id: 'admin', name: 'Administration', username: 'admin', role: 'owner', organization_role: 'manager', is_admin: true, active: true },
    { id: 'manager', name: '项目负责人', username: 'manager_01', role: 'member', organization_role: 'manager', is_admin: false, active: true },
    { id: 'operator', name: '业务经办人', username: 'operator_01', role: 'member', organization_role: 'operator', is_admin: false, active: true },
    { id: 'reviewer', name: '安全评审人', username: 'reviewer_01', role: 'member', organization_role: 'reviewer', is_admin: false, active: true },
    { id: 'supplier', name: '合作供应商', username: 'supplier_01', role: 'vendor', organization_role: 'supplier', is_admin: false, active: false },
    { id: 'demo-supplier', name: '【演示】峰岚会员科技交付负责人', username: 'demo_supplier', role: 'vendor', organization_role: 'supplier', is_admin: false, active: false },
  ],
  assessments: [{ id: 'assessment', name: '零售业务平台', version: 4, owner_id: 'admin', members: [{ user_id: 'operator', role: 'operator' }] }],
}

test('people directory and access controls fit desktop and mobile without mutating records', async ({ page }, testInfo) => {
  const unexpected: string[] = []
  await page.route('**/api/v1/**', route => {
    const request = route.request(), path = new URL(request.url()).pathname
    if (request.method() !== 'GET') { unexpected.push(`${request.method()} ${path}`); return route.fulfill({ status: 403, json: { code: 'FORBIDDEN' } }) }
    if (path === '/api/v1/auth/session') return route.fulfill({ json: { user: { id: 'admin', name: 'Administration', role: 'owner', is_admin: true, org_id: 'demo' }, csrf: 'offline-test', model_configured: false } })
    if (path === '/api/v1/people') return route.fulfill({ json: people })
    unexpected.push(`GET ${path}`)
    return route.fulfill({ status: 404, json: { code: 'NOT_FOUND' } })
  })
  await page.goto('/team')
  await expect(page.getByRole('heading', { name: '账号目录' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '评估成员授权' })).toBeVisible()
  await expect(page.locator('.people-heading p, .people-directory .people-section-heading p')).toHaveCount(0)
  await expect(page.locator('.people-directory .people-identity strong').first()).toHaveCSS('font-size', '16px')
  await expect(page.locator('.people-directory .people-identity small').first()).toHaveCSS('font-size', '14px')
  await expect(page.locator('.people-directory .people-role').first()).toHaveCSS('font-size', '14px')
  await expect(page.locator('.people-directory .people-state').first()).toHaveCSS('font-size', '14px')
  const supplier = page.getByRole('row').filter({ hasText: '【演示】峰岚会员科技交付负责人' })
  await expect(supplier.locator('.people-avatar')).toHaveText('峰')
  await supplier.getByRole('button', { name: '配置权限' }).click()
  await expect(page.getByRole('dialog').locator('.people-avatar')).toHaveText('峰')
  await page.getByRole('button', { name: '关闭' }).click()
  await page.screenshot({ path: testInfo.outputPath('people-desktop.png'), fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
  await page.getByRole('button', { name: '配置权限' }).nth(2).click()
  await expect(page.getByRole('dialog', { name: /业务经办人.*账号配置/ })).toBeVisible()
  await page.getByRole('button', { name: '关闭' }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: '切换为 English' }).click()
  await expect(page.getByRole('heading', { name: 'Account directory' })).toBeVisible()
  await expect(page.locator('.people-heading p, .people-directory .people-section-heading p')).toHaveCount(0)
  await expect(supplier.locator('.people-avatar')).toHaveText('峰')
  await page.screenshot({ path: testInfo.outputPath('people-mobile.png'), fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
  await page.getByLabel('Select assessment').selectOption('assessment')
  await expect(page.getByRole('combobox', { name: '业务经办人 assessment access' })).toHaveValue('operator')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
  expect(unexpected).toEqual([])
})
