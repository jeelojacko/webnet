/**
 * Phase C1 browser QA — PLINE Close + session backstep (open finish,
 * session-local Undo, closed ring topology). Production build, headless
 * Chromium, blank disposable drawings. Run:
 *   npx playwright test cad-draw-polyline-c1 --config=playwright.prod.config.ts
 *
 * Flows A–E. Evidence: PNGs + geometry.json under
 * docs/evidence/cad-polyline-c1-close-backstep/.
 */
import { expect, test, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { parseCadDrawingFile } from '../src/engine/cad/cadDrawingFile';

const SHOTS = 'docs/evidence/cad-polyline-c1-close-backstep';
fs.mkdirSync(SHOTS, { recursive: true });
const evidence: Record<string, unknown> = {};
const writeEvidence = (): void => {
  fs.writeFileSync(`${SHOTS}/geometry.json`, JSON.stringify(evidence, null, 2));
};

type Entity = Record<string, any>;

async function boot(page: Page, errors: string[]): Promise<void> {
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('dialog', (d) => { if (d.type() === 'confirm') void d.accept(); else void d.dismiss().catch(() => undefined); });
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    delete w.showSaveFilePicker; delete w.showOpenFilePicker;
    const bus = window as unknown as { __c1Rejections: string[] };
    bus.__c1Rejections = [];
    window.addEventListener('unhandledrejection', (e) => bus.__c1Rejections.push(String(e.reason)));
  });
  await page.goto('/cad', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('WebNet CAD', { exact: true }).first()).toBeVisible({ timeout: 30000 });
  await expect(page.locator('[data-cad-viewport]')).toBeVisible({ timeout: 30000 });
  const show = page.locator('button[title="Show ribbon"]');
  if (await show.isVisible().catch(() => false)) await show.click({ force: true });
  await expect(page.locator('[data-cad-ribbon]')).toBeVisible({ timeout: 10000 });
}
async function assertClean(page: Page, errors: string[]): Promise<void> {
  const rejections = await page.evaluate(() => (window as unknown as { __c1Rejections?: string[] }).__c1Rejections ?? []);
  expect(rejections).toEqual([]);
  expect(errors).toEqual([]);
}
const input = (page: Page) => page.locator('[data-cad-command-input]');
const prompt = (page: Page) => page.locator('[data-cad-command-prompt]');
async function ent(page: Page): Promise<number> {
  return Number.parseInt((await page.locator('[data-survey-cad-entity-count]').first().textContent()) ?? '0', 10);
}
async function type(page: Page, text: string): Promise<void> {
  await input(page).fill(text);
  await input(page).press('Enter');
}
async function start(page: Page, key: string): Promise<void> {
  await input(page).fill(key);
  await input(page).press('Enter');
  await expect(prompt(page)).toContainText(new RegExp(key.split('_')[0], 'i'), { timeout: 10000 });
}
async function esc(page: Page): Promise<void> {
  await input(page).focus();
  await input(page).press('Escape');
  await page.waitForTimeout(120);
}
async function historyAction(page: Page, label: 'Undo' | 'Redo'): Promise<void> {
  await page.getByRole('button', { name: 'Edit', exact: true }).click({ force: true });
  await page.getByRole('menuitem', { name: label }).click({ force: true });
}
async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}
async function saveEntities(page: Page): Promise<{ entities: Entity[] }> {
  const dl = page.waitForEvent('download', { timeout: 30000 });
  await page.locator('[data-cad-quick-access] button[title="Save the drawing (WNCAD)"]').click({ force: true });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wn-c1-'));
  const file = path.join(dir, 'drawing.wncad');
  await (await dl).saveAs(file);
  const parsed = parseCadDrawingFile(fs.readFileSync(file, 'utf8'));
  if (!parsed.ok) throw new Error(`saved drawing did not parse: ${parsed.errors.join('; ')}`);
  return { entities: parsed.drawing.project.entities as Entity[] };
}
const polylines = (ents: Entity[]) => ents.filter((e) => e.type === 'polyline');
const polylineGeom = (ents: Entity[]) =>
  polylines(ents).map((e) => ({
    id: e.id,
    closed: e.closed,
    vertices: e.vertices,
    vertexLabels: e.vertexLabels,
    createdBy: e.metadata?.createdBy ?? null,
  }));

test('A: open PLINE finishes on empty Enter with 3 vertices; undo/redo', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  await boot(page, errors);
  await start(page, 'PLINE');
  await type(page, '0,0');
  await type(page, '20,10');
  await type(page, 'N45-00-00E,20');
  await type(page, '');
  await expect(prompt(page)).toContainText('PLINE committed with 3 vertices.', { timeout: 10000 });
  await expect.poll(() => ent(page), { timeout: 15000 }).toBe(1);
  await shot(page, 'A-open-committed');
  const geom = polylineGeom((await saveEntities(page)).entities);
  expect(geom).toHaveLength(1);
  expect(geom[0]!.closed).toBe(false);
  expect(geom[0]!.vertices).toHaveLength(3);
  evidence.flowA = geom[0];
  await historyAction(page, 'Undo');
  await expect.poll(() => ent(page), { timeout: 15000 }).toBe(0);
  await historyAction(page, 'Redo');
  await expect.poll(() => ent(page), { timeout: 15000 }).toBe(1);
  await shot(page, 'A-undo-redo');
  writeEvidence();
  await assertClean(page, errors);
});

test('B: session Undo drops the newest vertex without an entity/undo entry; D completes A,B,D', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  await boot(page, errors);
  await start(page, 'PLINE');
  await type(page, '0,0');
  await type(page, '20,0');
  await type(page, '20,20');
  await type(page, 'U');
  await expect(prompt(page)).toContainText('2 vertices captured', { timeout: 10000 });
  expect(await ent(page)).toBe(0);
  await shot(page, 'B-after-backstep');
  await type(page, '40,0');
  await type(page, '');
  await expect.poll(() => ent(page), { timeout: 15000 }).toBe(1);
  const geom = polylineGeom((await saveEntities(page)).entities);
  expect(geom[0]!.vertices).toEqual([
    { x: 0, y: 0 },
    { x: 20, y: 0 },
    { x: 40, y: 0 },
  ]);
  // One undo entry for the whole draft: a single session Undo never committed.
  await historyAction(page, 'Undo');
  await expect.poll(() => ent(page), { timeout: 15000 }).toBe(0);
  evidence.flowB = geom[0];
  writeEvidence();
  await assertClean(page, errors);
});

test('C: Close commits a 3-vertex closed ring with a real closing segment and 3 grips', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  await boot(page, errors);
  await start(page, 'PLINE');
  await type(page, '0,0');
  await type(page, '20,0');
  await type(page, '20,20');
  await type(page, 'C');
  await expect(prompt(page)).toContainText('PLINE closed with 3 vertices.', { timeout: 10000 });
  await expect.poll(() => ent(page), { timeout: 15000 }).toBe(1);
  const geom = polylineGeom((await saveEntities(page)).entities);
  expect(geom).toHaveLength(1);
  expect(geom[0]!.closed).toBe(true);
  expect(geom[0]!.vertices).toHaveLength(3);
  await expect(page.locator(`[data-survey-cad-segment-id="${geom[0]!.id}#2"]`)).toHaveCount(1, { timeout: 10000 });
  await expect(page.locator(`[data-survey-cad-grip-entity-id="${geom[0]!.id}"]`)).toHaveCount(3, { timeout: 10000 });
  await shot(page, 'C-closed-ring');
  await historyAction(page, 'Undo');
  await expect.poll(() => ent(page), { timeout: 15000 }).toBe(0);
  await historyAction(page, 'Redo');
  await expect.poll(() => ent(page), { timeout: 15000 }).toBe(1);
  evidence.flowC = geom[0];
  writeEvidence();
  await assertClean(page, errors);
});

test('D: Close<3 and Undo guards keep the session active with no entity', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  await boot(page, errors);
  await start(page, 'PLINE');
  await type(page, '0,0');
  await type(page, '20,0');
  await type(page, 'C');
  await expect(prompt(page)).toContainText('needs at least 3 distinct vertices', { timeout: 10000 });
  expect(await ent(page)).toBe(0);
  await type(page, 'U');
  await expect(prompt(page)).toContainText('1 vertex captured', { timeout: 10000 });
  await type(page, 'U');
  await expect(prompt(page)).toContainText('first vertex', { timeout: 10000 });
  await type(page, 'U');
  await expect(prompt(page)).toContainText('nothing to undo', { timeout: 10000 });
  await shot(page, 'D-guards');
  await esc(page);
  expect(await ent(page)).toBe(0);
  writeEvidence();
  await assertClean(page, errors);
});

test('E: typed relative input after a backstep derives from the new last vertex', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  await boot(page, errors);
  await start(page, 'PLINE');
  await type(page, '0,0');
  await type(page, '10,0');
  await type(page, '10,10');
  await type(page, 'U');
  // Base is now (10,0): azimuth 0 (north) distance 10 => (10,10).
  await type(page, '@0,10');
  await type(page, '');
  await expect.poll(() => ent(page), { timeout: 15000 }).toBe(1);
  const geom = polylineGeom((await saveEntities(page)).entities);
  expect(geom[0]!.vertices).toEqual([
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
  ]);
  evidence.flowE = geom[0];
  writeEvidence();
  await assertClean(page, errors);
});
