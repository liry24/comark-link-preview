import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'test/browser',
  timeout: 60_000,
  globalTimeout: 10 * 60_000,
  expect: { timeout: 15_000 },
  workers: 1,
  use: {
    browserName: 'chromium',
    headless: true,
    viewport: { width: 900, height: 900 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node scripts/dev.mjs',
    url: 'http://127.0.0.1:5173',
    timeout: 180_000,
    reuseExistingServer: false,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
  },
});
