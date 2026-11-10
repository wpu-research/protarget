import { defineConfig } from '@playwright/test';
if (!process.env.PLAYWRIGHT_BASE_URL || !process.env.SEED_ADMIN_PASSWORD || !process.env.SEED_TENANT_PASSWORD) {
  throw new Error('E2E requires PLAYWRIGHT_BASE_URL and explicitly supplied local seed passwords');
}
export default defineConfig({
  testDir: './e2e', fullyParallel: false, workers: 1, retries: 0, timeout: 30000,
  reporter: [['list']], use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL,
    trace: 'off', screenshot: 'off', video: 'off',
  },
});
