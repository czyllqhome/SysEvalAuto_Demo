import { defineConfig } from '@playwright/test'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  testDir: './evals/e2e', testMatch: 'delivery-tracking.spec.ts', workers: 1,
  timeout: 45_000, expect: { timeout: 8_000 },
  use: { baseURL: 'http://127.0.0.1:4176', channel: process.env.SYSEVAL_E2E_CHANNEL || 'msedge', viewport: { width: 1600, height: 1050 }, trace: 'retain-on-failure' },
  outputDir: '../test-results/delivery-tracking',
  webServer: { command: 'node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4176 --strictPort', cwd: fileURLToPath(new URL('.', import.meta.url)), url: 'http://127.0.0.1:4176', reuseExistingServer: false },
})
