import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './evals/e2e',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  workers: 1,
  use: { baseURL: process.env.SYSEVAL_E2E_URL ?? 'http://127.0.0.1:8000', channel: process.env.SYSEVAL_E2E_CHANNEL || undefined, viewport: { width: 1440, height: 1000 }, trace: 'retain-on-failure' },
  outputDir: '../test-results',
})
