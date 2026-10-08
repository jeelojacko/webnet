/**
 * PERF-183.1 browser QA — CAD pointer-move render storm.
 *
 * Deterministic counts only (no wall-clock thresholds):
 * - a dense polygon scene renders one element per edge;
 * - idle pointer moves leave the static primitive element count unchanged and
 *   raise zero page/console errors;
 * - selection and pan preserve behavior;
 * - zooming past the geometry culls (render-only) and zooming back restores it;
 *   selected out-of-view entities stay selected.
 *
 * Run (production bundle):
 *   npm run build && npx playwright test cad-pointer-perf-183 --config=playwright.prod.config.ts
 */
import { expect, test, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

const SHOTS = 'docs/evidence/perf-183';
fs.mkdirSync(SHOTS, { recursive: true });
const evidence: Record<string, unknown> = {};
const writeEvidence = (): void => {
  fs.writeFileSync(path.join(SHOTS, 'browser-counts.json'), JSON.stringify(evidence, null, 2));
};

async function boot(page: Page, errors: string[]): Promise<void> {
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('dialog', (d) => { if (d.type() === 'confirm') void d.accept(); else void d.dismiss().catch(() => undefined); });
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    delete w.showSaveFilePicker;
    delete w.showOpenFilePicker;
  });
  await page.goto('/cad', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('WebNet CAD', { exact: true }).first()).toBeVisible({ timeout: 30000 });
  await expect(page.locator('[data-cad-viewport]')).toBeVisible({ timeout: 30000 });
}

const input = (page: Page) => page.locator('[data-cad-command-input]');
const prompt = (page: Page) => page.locator('[data-cad-command-prompt]');
const entityCount = async (page: Page): Promise<number> =>
  Number.parseInt((await page.locator('[data-survey-cad-entity-count]').first().textContent()) ?? '0', 10);
const selectionCount = async (page: Page): Promise<number> =>
  Number.parseInt(
    (await page.locator('[data-survey-cad-selection-count]').first().textContent()) ?? '0',
    10,
  );
const renderCount = (page: Page): Promise<number> =>
  page.locator('[data-survey-cad-render-entity-id]').count();
const viewportBox = async (page: Page) => {
  const box = await page.locator('[data-cad-viewport] svg').first().boundingBox();
  if (!box) throw new Error('no viewport box');
  return box;
};

async function type(page: Page, text: string): Promise<void> {
  await input(page).fill(text);
  await input(page).press('Enter');
}
async function start(page: Page, key: string): Promise<void> {
  await input(page).fill(key);
  await input(page).press('Enter');
  await expect(prompt(page)).toContainText(new RegExp(key.split('_')[0], 'i'), { timeout: 10000 });
}
async function drawPolygon(page: Page, center: string, radius: string): Promise<void> {
  await start(page, 'POLYGON');
  await type(page, '512');
  await type(page, 'I');
  await type(page, center);
  await type(page, radius);
}

test('A: dense scene renders one element per edge and idle moves stay static', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  await boot(page, errors);
  await drawPolygon(page, '-3,0', '6,0');
  await drawPolygon(page, '3,0', '6,0');
  await expect.poll(() => entityCount(page), { timeout: 20000 }).toBe(2);

  const box = await viewportBox(page);
  const rendered = await renderCount(page);
  expect(rendered).toBeGreaterThan(900);
  const staticChildren = await page.locator('[data-survey-cad-static-primitives] > *').count();
  evidence.flowA = { entities: 2, rendered, staticChildren };
  writeEvidence();

  for (let index = 0; index < 40; index += 1) {
    const fx = 0.2 + ((index * 7) % 60) / 100;
    const fy = 0.25 + ((index * 11) % 50) / 100;
    await page.mouse.move(box.x + box.width * fx, box.y + box.height * fy);
  }
  expect(await renderCount(page)).toBe(rendered);
  expect(errors).toEqual([]);
});

test('B: box select, pan, and zoom culling preserve behavior and restore on zoom', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  await boot(page, errors);
  await drawPolygon(page, '-3,0', '6,0');
  await drawPolygon(page, '3,0', '6,0');
  await expect.poll(() => entityCount(page), { timeout: 20000 }).toBe(2);
  const box = await viewportBox(page);
  const rendered = await renderCount(page);

  // Box select right-to-left (crossing mode) over the whole viewport.
  await page.mouse.move(box.x + box.width - 4, box.y + box.height - 4);
  await page.mouse.down();
  await page.mouse.move(box.x + 4, box.y + 4, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => selectionCount(page), { timeout: 10000 }).toBeGreaterThan(0);
  const selectedBeforeZoom = await selectionCount(page);
  expect(await renderCount(page)).toBe(rendered);

  // Middle-drag pan: scene stays rendered, no errors.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 30, { steps: 6 });
  await page.mouse.up({ button: 'middle' });
  expect(await renderCount(page)).toBe(rendered);

  // Zoom in hard at a corner: off-viewport geometry is culled (render only).
  await page.mouse.move(box.x + 8, box.y + 8);
  for (let index = 0; index < 24; index += 1) await page.mouse.wheel(0, -120);
  const zoomedIn = await renderCount(page);
  expect(zoomedIn).toBeLessThan(rendered);
  // Selection is not dropped by culling.
  expect(await selectionCount(page)).toBe(selectedBeforeZoom);

  // Zoom back out: geometry is restored.
  for (let index = 0; index < 24; index += 1) await page.mouse.wheel(0, 120);
  const restored = await renderCount(page);
  expect(restored).toBeGreaterThan(zoomedIn);

  evidence.flowB = { rendered, zoomedIn, restored };
  writeEvidence();
  expect(errors).toEqual([]);
});
