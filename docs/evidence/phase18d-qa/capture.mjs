/**
 * Phase 18D browser QA (legs A/C/G/H-partial/L + toolspace + properties).
 * Run: node docs/evidence/phase18d-qa/capture.mjs
 * Requires dev server on http://127.0.0.1:4174. Writes PNGs next to this script.
 */
import { chromium } from '@playwright/test';

const OUT = new URL('.', import.meta.url).pathname;
const errors = [];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => errors.push(`pageerror: ${e}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
await page.addInitScript(() => {
  const r = window;
  delete r.showSaveFilePicker;
  delete r.showOpenFilePicker;
});

const result = {};
try {
  await page.goto('http://127.0.0.1:4174/cad', { waitUntil: 'networkidle' });
  await page.getByText('WebNet CAD', { exact: true }).first().waitFor({ timeout: 30000 });
  await page.locator('[data-cad-viewport]').waitFor({ timeout: 30000 });

  // F2F sample load + commit (legs H/L).
  await page.getByRole('tab', { name: 'Output' }).click();
  await page.locator('[data-cad-command="SHELL_SHEETS_LAYERS"]').click();
  await page.getByRole('tab', { name: 'Field-to-Finish' }).click();
  await page.getByRole('tab', { name: 'Import review' }).click();
  await page.locator('[data-f2f-import-sample]').click();
  await page.locator('[data-f2f-review-summary]').waitFor({ timeout: 15000 });
  result.review = (await page.locator('[data-f2f-review-summary]').textContent())?.trim();
  await page.getByRole('tab', { name: 'Preview & commit' }).click();
  await page.locator('[data-f2f-commit]').click();
  await page.waitForFunction(
    async () => Number.parseInt(document.querySelector('[data-survey-cad-entity-count]')?.textContent ?? '0', 10) > 0,
    { timeout: 15000 },
  );
  result.entities = (await page.locator('[data-survey-cad-entity-count]').textContent())?.trim();
  const ids = await page.$$eval('[data-survey-cad-render-entity-id]', (els) => [
    ...new Set(els.map((e) => e.getAttribute('data-survey-cad-render-entity-id') ?? '')),
  ]);
  result.renderIds = ids;
  await page.locator('[data-survey-cad-close-drafting-panel]').click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}qa-01-viewport.png` });

  // Select C1 -> Properties shows style rows (legs A/G).
  const target = ids.includes('pt:C1') ? 'pt:C1' : ids.find((id) => id.startsWith('pt:'));
  await page.locator(`[data-survey-cad-render-entity-id="${target}"]`).first().click();
  await page.waitForTimeout(500);
  await page.locator('[data-cad-properties]').waitFor({ timeout: 10000 });
  const propsBefore = (await page.locator('[data-cad-properties]').innerText() ?? '').replace(/\s+/g, ' ');
  result.propsBefore = propsBefore.slice(0, 400);
  result.hasStyleRows = propsBefore.includes('Point Style Override') && propsBefore.includes('Effective');
  await page.screenshot({ path: `${OUT}qa-02-properties.png` });

  const effectiveRows = () =>
    page.locator('[data-cad-properties] dd', { hasText: 'Effective:' }).allInnerTexts();

  // Manual override via Properties (leg G): set Monument, read Effective, then clear.
  const styleSelect = page.getByLabel('Point Style Override');
  await styleSelect.selectOption('point-style-monument');
  await page.waitForTimeout(500);
  result.effectiveAfterOverride = (await effectiveRows()).join(' | ');
  await page.screenshot({ path: `${OUT}qa-03-override.png` });
  await styleSelect.selectOption('');
  await page.waitForTimeout(500);
  result.effectiveAfterClear = (await effectiveRows()).join(' | ');

  // Label style switch (leg B): pick None, confirm effective label.
  const labelSelect = page.getByLabel('Label Style Override');
  await labelSelect.selectOption('point-label-none');
  await page.waitForTimeout(500);
  result.effectiveLabelNone = (await effectiveRows()).join(' | ');
  await labelSelect.selectOption('');
  await page.waitForTimeout(300);
} catch (error) {
  result.fatal = String(error);
}
result.errors = errors.length ? errors : 'none';
console.log(JSON.stringify(result, null, 2));
await browser.close();
if (result.fatal || errors.length > 0) process.exitCode = 1;
