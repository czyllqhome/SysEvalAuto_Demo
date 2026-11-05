import { expect, test } from '@playwright/test'

const domains = ['安全物理环境', '安全通信网络', '安全区域边界', '安全计算环境', '安全管理中心', '安全管理制度', '安全管理机构', '安全建设管理']
const controls = Array.from({ length: 487 }, (_, index) => ({
  id: `control-${index + 1}`, source: index % 3 ? '企业安全规范' : 'MLPS 原始来源',
  control_identifier: `6.${Math.floor(index / 100) + 1}.${index + 1}`, security_domain: domains[index % domains.length],
  security_control_point: `${['身份鉴别与账号生命周期管理', '敏感数据传输加密与证书管理', '访问权限分配与审批'][index % 3]} · ${index + 1}`,
  control_requirement: `对关键业务系统落实可追溯的控制要求，保留审查记录与验收证据。第 ${index + 1} 项。`,
  risk_level: index % 5 ? 'Medium' : 'High', sheet: 'MLPS_source.xlsx', row_number: index + 2, mlps_level: index % 2 ? 2 : 3,
}))

test('control library is readable and responsive with 487 source rows', async ({ page }, testInfo) => {
  const writes: string[] = [], unexpected: string[] = []
  await page.route('**/api/v1/**', route => {
    const request = route.request(), path = new URL(request.url()).pathname
    if (request.method() !== 'GET') { writes.push(`${request.method()} ${path}`); return route.fulfill({ status: 403, json: { code: 'FORBIDDEN' } }) }
    if (path === '/api/v1/auth/session') return route.fulfill({ json: { user: { id: 'admin', name: 'Administration', org_id: 'demo', role: 'owner', is_admin: true }, csrf: 'offline-test', model_configured: false } })
    if (path === '/api/v1/source-controls') return route.fulfill({ json: { active: true, can_upload: true, matching_ready: true, controls } })
    unexpected.push(path)
    return route.fulfill({ status: 404, json: { code: 'NOT_FOUND' } })
  })
  await page.setViewportSize({ width: 1928, height: 1105 })
  await page.goto('/library')
  await expect(page.getByRole('heading', { name: '控制条目库' })).toBeVisible()
  await expect(page.getByRole('button', { name: '查看详情' })).toHaveCount(24)
  await page.screenshot({ path: testInfo.outputPath('catalog-desktop.png'), fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
  expect(await page.locator('body').innerText()).not.toMatch(/MLPS/i)
  await page.getByRole('button', { name: '查看详情' }).first().click()
  await expect(page.getByRole('dialog', { name: '控制条目详情' })).toBeVisible()
  await expect(page.getByRole('dialog').getByText(/对关键业务系统落实可追溯的控制要求/)).toBeVisible()
  await page.getByRole('button', { name: '关闭' }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: '切换为 English' }).click()
  await expect(page.getByRole('heading', { name: 'Control library' })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('catalog-mobile.png'), fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
  expect(writes).toEqual([])
  expect(unexpected).toEqual([])
})
