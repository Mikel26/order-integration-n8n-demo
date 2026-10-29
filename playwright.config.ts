import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: process.env.DEMO_WEB_URL ?? 'http://localhost:4200',
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    viewport: { width: 1440, height: 1100 },
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
});
