import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests-browser',
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  workers: 1,
  use: {
    headless: true,
    viewport: { width: 1440, height: 900 },
    baseURL: 'http://127.0.0.1:4174',
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4174',
    url: 'http://127.0.0.1:4174/map-pan-harness.html',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
