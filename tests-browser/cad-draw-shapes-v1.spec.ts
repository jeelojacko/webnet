/**
 * Shapes V1 browser QA — production build, headless Chromium, blank drawings.
 * Run: npm run build && npx playwright test cad-draw-shapes-v1 --config=playwright.prod.config.ts
 */
import { expect, test, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { parseCadDrawingFile } from '../src/engine/cad/cadDrawingFile';

const SHOTS = 'docs/evidence/cad-draw-shapes-v1';
fs.mkdirSync(SHOTS, { recursive: true });

async function boot(page: Page, errors: string[]): Promise<void> {
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('dialog', (d) => { if (d.type() === 'confirm') void d.accept(); else void d.dismiss().catch(() => undefined); });
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    delete w.showSaveFilePicker; delete w.showOpenFilePicker;
  });
  await page.goto('/cad', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('WebNet CAD', { exact: true }).first()).toBeVisible({ timeout: 30000 });
  await expect(page.locator('[data-cad-viewport]')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('[data-cad-ribbon]')).toBeVisible({ timeout: 10000 });
}
const input = (page: Page) => page.locator('[data-cad-command-input]');
const prompt = (page: Page) => page.locator('[data-cad-command-prompt]');
async function ent(page: Page): Promise<number> {
  return Number.parseInt((await page.locator('[data-survey-cad-entity-count]').textContent()) ?? '0', 10);
}
async function grips(page: Page): Promise<number> {
  return page.locator('[data-survey-cad-grip-handle]').count();
}
async function viewportPoint(page: Page, fx: number, fy: number): Promise<{ x: number; y: number }> {
  const box = await page.locator('[data-cad-viewport] svg').first().boundingBox();
  if (!box) throw new Error('no viewport box');
  return { x: box.x + box.width * fx, y: box.y + box.height * fy };
}
async function click(page: Page, fx: number, fy: number): Promise<void> {
  const p = await viewportPoint(page, fx, fy);
  await page.mouse.click(p.x, p.y);
}
async function move(page: Page, fx: number, fy: number): Promise<void> {
  const p = await viewportPoint(page, fx, fy);
  await page.mouse.move(p.x, p.y);
}
async function type(page: Page, text: string): Promise<void> {
  await input(page).fill(text);
  await input(page).press('Enter');
}
async function esc(page: Page): Promise<void> {
  await input(page).focus();
  await input(page).press('Escape');
  await page.waitForTimeout(150);
}
async function start(page: Page, key: string): Promise<void> {
  await input(page).fill(key);
  await input(page).press('Enter');
  await expect(prompt(page)).toContainText(new RegExp(key.split('_')[0], 'i'), { timeout: 10000 });
}
async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}
async function saveEntities(page: Page) {
  const dl = page.waitForEvent('download', { timeout: 30000 });
  await page.locator('[data-cad-quick-access] button[title="Save the drawing (WNCAD)"]').click({ force: true });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wn-shapes-'));
  const file = path.join(dir, 'drawing.wncad');
  await (await dl).saveAs(file);
  const text = fs.readFileSync(file, 'utf8');
  const parsed = parseCadDrawingFile(text);
  if (!parsed.ok) throw new Error(`saved drawing did not parse: ${parsed.errors.join('; ')}`);
  return { file, entities: parsed.drawing.project.entities as Array<Record<string, any>> };
}
const polys = (ents: Array<Record<string, any>>) => ents.filter((e) => e.type === 'polygon');

test('A: shapes face enabled, rectangle default, neighbors planned', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  await boot(page, errors);
  const face = page.locator('[data-cad-family="shapes"] .cad-ribbon-split__primary').first();
  await expect(face).toBeEnabled();
  await expect(face).toHaveAttribute('aria-label', 'Shapes: Rectangle');
  const tip = (await face.getAttribute('title')) ?? '';
  expect(tip).not.toMatch(/Planned|Not implemented/);
  await page.locator('[data-cad-family-caret="shapes"]').click({ force: true });
  const fly = page.locator('[data-cad-ribbon-flyout="shapes"]');
  await expect(fly).toBeVisible({ timeout: 5000 });
  expect(await fly.locator('[data-cad-variant]').count()).toBe(2);
  expect(await fly.locator('[data-cad-variant][aria-disabled="true"]').count()).toBe(0);
  expect(await fly.locator('[data-cad-variant="shapes-rectangle"]').getAttribute('data-cad-command')).toBe('RECTANGLE');
  expect(await fly.locator('[data-cad-variant="shapes-polygon"]').getAttribute('data-cad-command')).toBe('POLYGON');
  await page.keyboard.press('Escape');
  for (const fam of ['circle', 'bestfit', 'ellipse', 'hatch']) {
    await page.locator(`[data-cad-family-caret="${fam}"]`).click({ force: true });
    const f = page.locator(`[data-cad-ribbon-flyout="${fam}"]`);
    await expect(f).toBeVisible({ timeout: 5000 });
    expect(await f.locator('[data-cad-variant]:not([aria-disabled])').count()).toBe(0);
    await page.keyboard.press('Escape');
  }
  await shot(page, 'A-ribbon');
  expect(errors).toEqual([]);
});

test('B: rectangle click flow, preview, 4 grips', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  await boot(page, errors);
  await start(page, 'RECTANGLE');
  await click(page, 0.35, 0.4);
  // After the first corner, the transient preview must show the full closed
  // rectangle outline (4 dashed edges) before the opposite corner commits.
  await move(page, 0.55, 0.6);
  await expect(page.locator('[data-survey-cad-command-preview]')).toBeVisible();
  await expect(page.locator('[data-survey-cad-command-preview-line]')).toHaveCount(4);
  await click(page, 0.55, 0.6);
  await expect.poll(() => ent(page), { timeout: 15000 }).toBe(1);
  const id = await page.locator('[data-survey-cad-render-entity-id]').first().getAttribute('data-survey-cad-render-entity-id');
  await page.locator(`[data-survey-cad-render-entity-id="${id}"]`).first().click({ force: true });
  await expect.poll(() => grips(page), { timeout: 10000 }).toBe(4);
  await shot(page, 'B-rectangle');
  expect(errors).toEqual([]);
});

test('C: typed and snap rectangle corners', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  await boot(page, errors);
  await start(page, 'RECTANGLE');
  await type(page, '0,0');
  await type(page, '10,5');
  await expect.poll(() => ent(page), { timeout: 15000 }).toBe(1);
  let ents = (await saveEntities(page)).entities;
  expect(polys(ents)[0].vertices).toHaveLength(4);
  await page.locator('[data-cad-quick-access] button[title="New drawing"]').click({ force: true });
  await expect.poll(() => ent(page), { timeout: 15000 }).toBe(0);
  await start(page, 'RECTANGLE');
  await type(page, '0,0');
  await type(page, '@45,10'); // relative corner: distinct opposite corner
  await expect.poll(() => ent(page), { timeout: 15000 }).toBe(1);
  ents = (await saveEntities(page)).entities;
  const xs = polys(ents)[0].vertices.map((v: any) => v.x);
  expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(0);
  await shot(page, 'C-typed');
  expect(errors).toEqual([]);
});

test('D: grip-drag, undo-redo, move, rotate', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  await boot(page, errors);
  await start(page, 'RECTANGLE');
  await type(page, '0,0');
  await type(page, '20,10');
  await expect.poll(() => ent(page), { timeout: 15000 }).toBe(1);
  const before = polys((await saveEntities(page)).entities)[0].vertices;
  const id = await page.locator('[data-survey-cad-render-entity-id]').first().getAttribute('data-survey-cad-render-entity-id');
  await page.locator(`[data-survey-cad-render-entity-id="${id}"]`).first().click({ force: true });
  await expect.poll(() => grips(page), { timeout: 10000 }).toBe(4);
  const g = page.locator('[data-survey-cad-grip-handle]').first();
  const box = await g.boundingBox();
  if (!box) throw new Error('no grip box');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 60, box.y + 40, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => ent(page), { timeout: 10000 }).toBe(1);
  const after = polys((await saveEntities(page)).entities)[0].vertices;
  expect(JSON.stringify(after)).not.toBe(JSON.stringify(before));
  await page.locator('[data-cad-command="SHELL_UNDO"]').click({ force: true });
  await page.locator('[data-cad-command="SHELL_REDO"]').click({ force: true });
  await expect.poll(() => ent(page), { timeout: 10000 }).toBe(1);
  await page.locator(`[data-survey-cad-render-entity-id="${id}"]`).first().click({ force: true });
  await start(page, 'MOVE');
  await click(page, 0.4, 0.5);
  await click(page, 0.5, 0.5);
  await expect.poll(() => ent(page), { timeout: 10000 }).toBe(1);
  await page.locator(`[data-survey-cad-render-entity-id="${id}"]`).first().click({ force: true });
  await start(page, 'ROTATE');
  await click(page, 0.5, 0.5);
  await type(page, '90');
  await esc(page);
  await expect.poll(() => ent(page), { timeout: 10000 }).toBe(1);
  await shot(page, 'D-grip-move-rotate');
  expect(errors).toEqual([]);
});

test('E+F: inscribed 5-gon and circumscribed 6-gon apothem', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  await boot(page, errors);
  await start(page, 'POLYGON');
  await type(page, '5');
  await type(page, 'I'); // lone `I`: the dock routes POLYGON mode-phase text to the session, so it reads as Inscribed, not INSERT
  await type(page, '0,0');
  await type(page, '10,0');
  await expect.poll(() => ent(page), { timeout: 15000 }).toBe(1);
  let v = polys((await saveEntities(page)).entities)[0].vertices;
  expect(v).toHaveLength(5);
  expect(Math.hypot(v[0].x - 0, v[0].y - 0)).toBeCloseTo(10, 1);
  await shot(page, 'E-inscribed-5gon');
  await page.locator('[data-cad-quick-access] button[title="New drawing"]').click({ force: true });
  await expect.poll(() => ent(page), { timeout: 15000 }).toBe(0);
  await start(page, 'POLYGON');
  await type(page, '6');
  await type(page, 'CIRCUMSCRIBED');
  await type(page, '0,0');
  await type(page, '8,0'); // through = apothem foot direction
  await expect.poll(() => ent(page), { timeout: 15000 }).toBe(1);
  v = polys((await saveEntities(page)).entities)[0].vertices;
  expect(v).toHaveLength(6);
  const edgeMid = { x: (v[0].x + v[1].x) / 2, y: (v[0].y + v[1].y) / 2 };
  expect(Math.hypot(edgeMid.x, edgeMid.y)).toBeCloseTo(8, 0);
  await shot(page, 'F-circumscribed-6gon');
  expect(errors).toEqual([]);
});

test('G: esc and invalid input at every phase', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  await boot(page, errors);
  await start(page, 'POLYGON');
  for (const bad of ['2', '1025', '4.5', 'abc']) {
    await type(page, bad);
    await expect(prompt(page)).not.toBeEmpty({ timeout: 10000 });
  }
  await expect.poll(() => ent(page)).toBe(0);
  await type(page, '5');
  await type(page, 'X');
  await expect(prompt(page)).not.toBeEmpty({ timeout: 10000 });
  await expect.poll(() => ent(page)).toBe(0);
  await type(page, '');
  await type(page, '0,0');
  await type(page, '0,0'); // zero radius: degenerate, stays open
  await expect.poll(() => ent(page)).toBe(0);
  await esc(page);
  await expect.poll(() => ent(page)).toBe(0);
  await start(page, 'RECTANGLE');
  await type(page, '1,1');
  await type(page, '1,9'); // zero width: degenerate, stays open
  await expect.poll(() => ent(page)).toBe(0);
  await esc(page);
  await expect.poll(() => ent(page)).toBe(0);
  await shot(page, 'G-invalid');
  expect(errors).toEqual([]);
});

test('H: save and reopen exact', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  await boot(page, errors);
  await start(page, 'RECTANGLE');
  await type(page, '0,0');
  await type(page, '12,6');
  await start(page, 'POLYGON');
  await type(page, '5');
  await type(page, '');
  await type(page, '30,30');
  await type(page, '40,30');
  await expect.poll(() => ent(page), { timeout: 15000 }).toBe(2);
  const saved = await saveEntities(page);
  const geom = saved.entities.map((e) => ({ id: e.id, type: e.type, vertices: (e as any).vertices ?? null }));
  fs.writeFileSync(`${SHOTS}/geometry.json`, JSON.stringify(geom, null, 2));
  await page.locator('[data-cad-quick-access] button[title="New drawing"]').click({ force: true });
  await expect.poll(() => ent(page), { timeout: 15000 }).toBe(0);
  const fi = page.locator('[data-survey-cad-open-drawing-input]');
  await fi.evaluate((el: HTMLInputElement) => el.classList.remove('hidden')).catch(() => undefined);
  await fi.setInputFiles(saved.file);
  await expect.poll(() => ent(page), { timeout: 30000 }).toBe(2);
  const reopened = (await saveEntities(page)).entities.map((e) => ({ id: e.id, type: e.type, vertices: (e as any).vertices ?? null }));
  expect(reopened).toEqual(geom);
  await shot(page, 'H-reopened');
  expect(errors).toEqual([]);
});

test('I: line, polyline, arc regression', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  await boot(page, errors);
  await page.locator('[data-cad-command="LINE"]').first().click({ force: true });
  await click(page, 0.3, 0.4);
  await click(page, 0.5, 0.4);
  await esc(page);
  await page.locator('[data-cad-command="PLINE"]').first().click({ force: true });
  await click(page, 0.3, 0.6);
  await click(page, 0.4, 0.6);
  await click(page, 0.5, 0.65);
  await input(page).focus();
  await input(page).press('Enter');
  await esc(page);
  await page.locator('[data-cad-family-caret="arc"]').click({ force: true });
  await page.locator('[data-cad-ribbon-flyout="arc"] [data-cad-variant="arc-3pt"]').click({ force: true });
  await click(page, 0.6, 0.4);
  await click(page, 0.65, 0.45);
  await click(page, 0.7, 0.4);
  await esc(page);
  await expect.poll(() => ent(page), { timeout: 15000 }).toBeGreaterThanOrEqual(3);
  await shot(page, 'I-regression');
  expect(errors).toEqual([]);
});
