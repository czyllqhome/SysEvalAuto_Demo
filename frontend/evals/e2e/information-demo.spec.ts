import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import questions from '../../../backend/app/data/mlps_questionnaire.json' with { type: 'json' }
import demo from '../../../backend/app/data/mlps_demo_template.json' with { type: 'json' }

test('information Demo copies the current thirty answers and topology with independent references and undo', async ({ page }, testInfo) => {
  const fixture = demo.evidence_assets[0]
  const content = readFileSync(new URL('../../../backend/app/data/mlps_demo_network.png', import.meta.url)).toString('base64')
  const saved = { answers: { system_name: '原始填写 / Original', external_network_access: '无' }, notes: { info_rights_severity: '保留定级理由' }, department_contacts: {}, frameworks: ['MLPS_LEVEL_2'] }
  const detail = { system: { id: 'information-demo', name: '信息 Demo 回归', status: 'CLASSIFYING', version: 1, revision: 1, context: {}, draft: { mlps_intake: saved }, classification: {}, assessment_type: 'new' }, permissions: ['read', 'edit', 'manage'], controls: [], prd: null, round: null, report: null, baseline: null, job: null }
  const writes: { path: string; body: Record<string, any> }[] = []
  const unexpected: string[] = []
  await page.route('**/api/v1/**', route => {
    const request = route.request(), path = new URL(request.url()).pathname
    if (request.method() === 'GET') {
      if (path === '/api/v1/auth/session') return route.fulfill({ json: { user: { id: 'admin', name: 'Administration', org_id: 'demo', role: 'owner', is_admin: true }, csrf: 'offline', model_configured: false } })
      if (path === '/api/v1/systems/information-demo') return route.fulfill({ json: detail })
      if (path.endsWith('/mlps-intake')) return route.fulfill({ json: { questions, saved, demo_template: { ...demo.template, evidence_assets: [{ question: fixture.question, filename: fixture.filename, content }] }, legacy: false, catalog_id: 'catalog', permissions: detail.permissions } })
    }
    if (request.method() === 'POST' && path.endsWith('/mlps-intake/evidence')) {
      const body = request.postDataJSON(); writes.push({ path, body })
      return route.fulfill({ json: { ...detail, system: { ...detail.system, version: 2 }, mlps_evidence: { id: '12345678-1234-1234-1234-123456789abc', filename: fixture.filename, sha256: fixture.sha256 } } })
    }
    if (request.method() === 'PUT' && path.endsWith('/mlps-intake')) {
      const body = request.postDataJSON(); writes.push({ path, body })
      return route.fulfill({ json: { ...detail, system: { ...detail.system, version: writes.length + 1, draft: { mlps_intake: body } } } })
    }
    unexpected.push(`${request.method()} ${path}`)
    return route.fulfill({ status: 403, json: { code: 'FORBIDDEN' } })
  })
  await page.setViewportSize({ width: 1420, height: 1105 })
  await page.goto('/systems/information-demo/information')
  await expect(page.locator('.mlps-header h2')).toHaveText('系统信息收集')
  await expect(page.locator('.mlps-header p')).toHaveText('收集系统概况、部署连接、服务规模、数据处理及业务连续性信息，为安全评估和控制匹配提供依据。')
  await expect(page.locator('.mlps-header .eyebrow')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'AI 优化描述', exact: true })).toHaveCount(3)
  await expect(page.locator('.refinement-controls .field-hint')).toHaveCount(0)
  for (const chapter of ['系统概况', '系统部署与连接', '服务与规模', '数据与个人信息', '业务连续性与影响分析']) {
    await page.getByRole('button', { name: new RegExp(chapter) }).click()
    await expect(page.locator('.mlps-section-heading > p')).toHaveCount(0)
  }
  await page.getByRole('button', { name: /系统部署与连接/ }).click()
  await page.getByRole('button', { name: '一键填入 Demo', exact: true }).click()
  await expect(page.getByRole('progressbar')).toHaveAttribute('value', '30')
  await expect(page.getByRole('button', { name: '撤销 Demo 填入' })).toBeEnabled()
  expect(writes).toHaveLength(2)
  expect(writes[0].body.version).toBe(1)
  expect(createHash('sha256').update(Buffer.from(writes[0].body.content, 'base64')).digest('hex')).toBe(fixture.sha256)
  expect(writes[1].body.version).toBe(2)
  expect(writes[1].body.answers.external_network_access).toBe('无')
  expect(writes[1].body.department_contacts['零售运营'].name).toBe('Alice')
  expect(writes[1].body.notes.network_zones_description).toContain('evidence:12345678-1234-1234-1234-123456789abc')
  expect(JSON.stringify(writes[1])).not.toContain(fixture.source_evidence_id)
  await expect(page.getByRole('link', { name: /下载已上传材料/ })).toHaveAttribute('href', '/api/v1/systems/information-demo/mlps-intake/evidence/12345678-1234-1234-1234-123456789abc')
  await page.screenshot({ path: testInfo.outputPath('information-demo-updated.png'), fullPage: true })
  await page.getByRole('button', { name: '撤销 Demo 填入' }).click()
  await expect(page.getByRole('button', { name: '一键填入 Demo', exact: true })).toBeEnabled()
  expect(writes).toHaveLength(3)
  expect(writes[2].body.version).toBe(3)
  expect(writes[2].body.answers).toEqual(saved.answers)
  expect(writes[2].body.notes).toEqual(saved.notes)
  await page.getByRole('button', { name: '切换为 English' }).click()
  await expect(page.locator('.mlps-header h2')).toHaveText('System information collection')
  await expect(page.locator('.mlps-header p')).toHaveText('Collect system overview, deployment and connections, service scale, data handling, and business continuity information to support security assessment and control matching.')
  await expect(page.locator('.mlps-section-heading > p')).toHaveCount(0)
  expect(unexpected).toEqual([])
})
