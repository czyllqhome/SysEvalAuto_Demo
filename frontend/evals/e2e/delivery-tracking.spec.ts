import { expect, test, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { deliveryFixture } from '../fixtures/delivery'
import type { DeliveryBatch } from '../../src/deliveryModel'

const artifacts = fileURLToPath(new URL('../../../artifacts/development-tracking/', import.meta.url))
async function screenshot(page: Page, name: string) {
  await mkdir(artifacts, { recursive: true })
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: `${artifacts}/${name}.png`, fullPage: true })
}
async function mockDelivery(page: Page, batch: DeliveryBatch, supplier = false) {
  const errors: string[] = [], writes: { path: string; body: Record<string, unknown> }[] = []
  page.on('pageerror', error => errors.push(error.message))
  // Every API request is intercepted. These tests cannot read or mutate runtime records.
  await page.route('**/api/v1/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname
    if (path === '/api/v1/auth/session') return route.fulfill({ json: { user: { id: supplier ? 'supplier-demo' : 'customer-demo', org_id: 'demo', name: supplier ? '示例供应商' : '示例审核人', role: supplier ? 'vendor' : 'owner', is_admin: !supplier }, csrf: 'offline-test', model_configured: false } })
    if (request.method() === 'GET') {
      if (path === '/api/v1/delivery-batches' || path.endsWith('/system-demo/delivery-batches')) return route.fulfill({ json: [batch] })
      if (path === `/api/v1/delivery-batches/${batch.id}`) return route.fulfill({ json: batch })
      errors.push(`Unexpected API read: ${path}`)
      return route.fulfill({ status: 404, json: { code: 'NOT_FOUND' } })
    }
    if (path.endsWith('/attachments')) {
      const meta = JSON.parse(Buffer.from(request.headers()['x-evidence-metadata'], 'base64').toString('utf8'))
      const item = batch.items.find(i => path.includes(i.id))!
      expect(meta.version).toBe(item.version)
      const attachment = { id: 'uploaded-proof', filename: meta.filename, mime: 'text/plain', size: 100, sha256: 'uploaded-hash', meta }
      item.attachments.push(attachment); item.version++; batch.version++
      writes.push({ path, body: meta })
      return route.fulfill({ json: { ...batch, attachment } })
    }
    const body = request.postDataJSON()
    writes.push({ path, body })
    if (path.endsWith('/draft')) {
      const item = batch.items.find(i => path.includes(i.id))!
      expect(body.version).toBe(item.version); item.draft = body.draft; item.version++
    } else if (path.endsWith('/submissions')) {
      const item = batch.items.find(i => path.includes(i.id))!
      expect(body.version).toBe(item.version); expect(body.expected_source_hash).toBe(batch.source_hash)
      item.status = 'IN_REVIEW'; item.version++; item.reopen_feedback = null
      item.submissions.push({ id: 'new-submission', round_no: item.submissions.length + 1, created_at: 1767398400, manifest_hash: 'new-frozen-manifest', payload: { draft: structuredClone(item.draft), attachments: item.attachments.filter(a => item.draft.attachment_ids?.includes(a.id)) }, review: null })
    } else if (path.endsWith('/complete')) {
      expect(body.version).toBe(batch.version); expect(batch.approved).toBe(batch.total); batch.status = 'REVIEW_COMPLETE'
    } else if (path.endsWith('/reopen')) {
      const item = batch.items.find(i => path.includes(i.id))!
      expect(body.version).toBe(item.version); item.status = 'CHANGES_REQUESTED'; item.version++
      item.reopen_feedback = { reason: body.reason, created_at: 1767398400 }; batch.status = 'ACTIVE'; batch.approved--
    } else { errors.push(`Unexpected mutation: ${path}`); return route.fulfill({ status: 400, json: { code: 'INVALID_FIELDS' } }) }
    batch.version++
    return route.fulfill({ json: batch })
  })
  return { errors, writes }
}

test('customer workspace has a responsive review layout and preserves authored input', async ({ page }) => {
  const { errors, writes } = await mockDelivery(page, deliveryFixture())
  await page.goto('/delivery/delivery-demo')
  await expect(page.getByLabel('审核依据')).toBeVisible()
  await expect(page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '开发进度追踪' })).toHaveClass(/active/)
  await screenshot(page, 'customer-desktop')
  await page.getByLabel('审核依据').fill('核验原文保持不变。')
  await page.getByRole('group', { name: '开发项状态筛选' }).getByRole('button', { name: /^已验收/ }).click()
  await expect(page.getByRole('progressbar')).toHaveAttribute('max', '4')
  await page.getByRole('group', { name: '开发项状态筛选' }).getByRole('button', { name: /^全部开发项/ }).click()
  await page.getByRole('button', { name: '切换为 English' }).click()
  await expect(page.getByLabel('Review rationale')).toHaveValue('核验原文保持不变。')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByLabel('Review rationale').scrollIntoViewIfNeeded()
  await expect(page.getByLabel('Review rationale')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
  await screenshot(page, 'customer-mobile-en')
  expect(errors).toEqual([]); expect(writes).toEqual([])
})

test('supplier uploads, maps evidence and saves then submits the returned item', async ({ page }) => {
  const { errors, writes } = await mockDelivery(page, deliveryFixture(['read', 'upload']), true)
  await page.goto('/delivery/delivery-demo')
  await expect(page.getByText('请补充证书到期告警截图，以及旧协议被禁用的验证记录。').first()).toBeVisible()
  await page.getByLabel('完成与证据说明').fill('已补充证书告警与旧协议验证报告。')
  await page.getByLabel('上传截图、代码或报告（每个最多 20 MiB）').setInputFiles({ name: 'protocol-proof.txt', mimeType: 'text/plain', buffer: Buffer.from('TLS verification evidence') })
  await expect(page.getByRole('checkbox', { name: '本轮使用: protocol-proof.txt' })).toBeChecked()
  for (const mapping of await page.locator('.delivery-mapping').all()) await mapping.getByRole('checkbox', { name: 'protocol-proof.txt' }).check()
  await screenshot(page, 'supplier-desktop')
  await expect(page.getByRole('button', { name: '保存审核结论' })).toHaveCount(0)
  await page.getByRole('button', { name: '保存并提交验收' }).click()
  await expect(page.getByText('已提交验收，等待客户核验。')).toBeVisible()
  expect(writes.map(w => w.path.split('/').at(-1))).toEqual(['attachments', 'draft', 'submissions'])
  expect(writes[2].body.version).toBe(9)
  expect(errors).toEqual([])
})

test('completion and reopening retain the old decision separately from the new request', async ({ page }) => {
  const batch = deliveryFixture(); batch.items = [batch.items[3]]; batch.total = 1; batch.approved = 1
  const { errors } = await mockDelivery(page, batch)
  await page.goto('/delivery/delivery-demo')
  await page.getByRole('button', { name: '完成本批交付审核' }).click()
  await expect(page.getByText('本批交付审核已完成')).toBeVisible()
  await page.getByText('需要再次核验？重新打开此项').click()
  await page.getByLabel('重新打开原因').fill('新增失败场景，请补充最新日志。')
  await page.getByRole('button', { name: '重新打开', exact: true }).click()
  await expect(page.locator('.delivery-return-note')).toContainText('新增失败场景，请补充最新日志。')
  await expect(page.locator('.delivery-review-record')).toContainText('已核对日志完整性、访问权限和留存配置，满足验收要求。')
  await expect(page.getByRole('button', { name: '完成本批交付审核' })).toBeDisabled()
  expect(errors).toEqual([])
})
