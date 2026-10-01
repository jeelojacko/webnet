import { defineConfig } from '@playwright/test';

/**
 * Phase 20K.3 Wave E3 — production-build Chromium QA.
 *
 * Unlike `playwright.config.ts` (Vite dev server on 4174), this config serves
 * the FRESH `dist/` production bundle through `vite preview` on 4175. Build
 * (`npm run build`) before running; the webServer command rebuilds only when
 * the preview is not already up.
 */
export default defineConfig({
  testDir: './tests-browser',
  timeout: 180_000,
  expect: {
    timeout: 20_000,
  },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    headless: true,
    viewport: { width: 1366, height: 768 },
    baseURL: 'http://127.0.0.1:4175',
  },
  webServer: {
    command: 'npm run build && npx vite preview --host 127.0.0.1 --port 4175',
    url: 'http://127.0.0.1:4175/cad',
    reuseExistingServer: true,
    timeout: 600_000,
  },
});
