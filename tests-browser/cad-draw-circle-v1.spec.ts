/**
 * Circle V1 browser QA — production build, headless Chromium, blank drawings.
 * Run: npm run build && npx playwright test cad-draw-circle-v1 --config=playwright.prod.config.ts
 */
import { expect, test, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { parseCadDrawingFile } from '../src/engine/cad/cadDrawingFile';

const SHOTS = 'docs/evidence/cad-draw-circle-v1';
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wn-circle-'));
  const file = path.join(dir, 'drawing.wncad');
  await (await dl).saveAs(file);
  const text = fs.readFileSync(file, 'utf8');
  const parsed = parseCadDrawingFile(text);
  if (!parsed.ok) throw new Error(`saved drawing did not parse: ${parsed.errors.join('; ')}`);
  return { file, entities: parsed.drawing.project.entities as Array<Record<string, any>> };
}
const circles = (ents: Array<Record<string, any>>) => ents.filter((e) => e.type === 'circle');

test('A: circle face enabled, CR default, CD runnable, rest planned', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  await boot(page, errors);
  const face = page.locator('[data-cad-family="circle"] .cad-ribbon-split__primary').first();
  await expect(face).toBeEnabled();
  await expect(face).toHaveAttribute('aria-label', 'Circle: Center, Radius');
  const tip = (await face.getAttribute('title')) ?? '';
  expect(tip).not.toMatch(/Planned|Not implemented/);
  await page.locator('[data-cad-family-caret="circle"]').click({ force: true });
  const fly = page.locator('[data-cad-ribbon-flyout="circle"]');
  await expect(fly).toBeVisible({ timeout: 5000 });
  expect(await fly.locator('[data-cad-variant]:not([aria-disabled])').count()).toBe(2);
  expect(await fly.locator('[data-cad-variant="circle-center-radius"]').getAttribute('data-cad-command')).toBe('CIRCLE');
  expect(await fly.locator('[data-cad-variant="circle-center-diameter"]').getAttribute('data-cad-command')).toBe('CIRCLECD');
  await page.keyboard.press('Escape');
  await shot(page, 'A-circle-face');
  expect(errors).toEqual([]);
});

test('B: center/radius click flow, preview, 2 grips', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  await boot(page, errors);
  await start(page, 'CIRCLE');
  await click(page, 0.4, 0.5);
  await move(page, 0.6, 0.5);
  await expect(page.locator('[data-survey-cad-command-preview]')).toBeVisible();
  await expect(page.locator('[data-survey-cad-command-preview-circle]')).toHaveCount(1);
  await click(page, 0.6, 0.5);
  await expect.poll(() => ent(page), { timeout: 15000 }).toBe(1);
  const id = await page.locator('[data-survey-cad-render-entity-id]').first().getAttribute('data-survey-cad-render-entity-id');
  await page.locator(`[data-survey-cad-render-entity-id="${id}"]`).first().click({ force: true });
  await expect.poll(() => grips(page), { timeout: 10000 }).toBe(2);
  const ents = (await saveEntities(page)).entities;
  expect(circles(ents)).toHaveLength(1);
  expect(circles(ents)[0]).not.toHaveProperty('startAngleDeg');
  await shot(page, 'B-circle');
  expect(errors).toEqual([]);
});

test('C: center/diameter keeps the center, radius is half', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  await boot(page, errors);
  await start(page, 'CIRCLECD');
  await type(page, '0,0');
  await type(page, '30');
  await expect.poll(() => ent(page), { timeout: 15000 }).toBe(1);
  const ents = (await saveEntities(page)).entities;
  const circle = circles(ents)[0];
  expect(circle.centerX).toBe(0);
  expect(circle.centerY).toBe(0);
  expect(circle.radius).toBe(15);
  await shot(page, 'C-diameter');
  expect(errors).toEqual([]);
});

test('D: invalid and cancel paths commit nothing', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  await boot(page, errors);
  await start(page, 'CIRCLE');
  await esc(page);
  await expect.poll(() => ent(page), { timeout: 15000 }).toBe(0);
  await start(page, 'CIRCLECD');
  await type(page, '5,5');
  await type(page, '0');
  await expect.poll(() => ent(page), { timeout: 15000 }).toBe(0);
  await esc(page);
  await expect.poll(() => ent(page), { timeout: 15000 }).toBe(0);
  await shot(page, 'D-invalid');
  expect(errors).toEqual([]);
});

test('E: save/reopen keeps the first-class circle', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  await boot(page, errors);
  await start(page, 'CIRCLE');
  await type(page, '0,0');
  await type(page, '10');
  await start(page, 'CIRCLECD');
  await type(page, '50,50');
  await type(page, '20');
  await expect.poll(() => ent(page), { timeout: 15000 }).toBe(2);
  const saved = await saveEntities(page);
  const geom = saved.entities.map((e) => ({
    id: e.id, type: e.type,
    centerX: (e as any).centerX ?? null, centerY: (e as any).centerY ?? null,
    radius: (e as any).radius ?? null,
  }));
  expect(geom.every((e) => e.type === 'circle')).toBe(true);
  fs.writeFileSync(`${SHOTS}/geometry.json`, JSON.stringify(geom, null, 2));
  await page.locator('[data-cad-quick-access] button[title="New drawing"]').click({ force: true });
  await expect.poll(() => ent(page), { timeout: 15000 }).toBe(0);
  const fi = page.locator('[data-survey-cad-open-drawing-input]');
  await fi.evaluate((el: HTMLInputElement) => el.classList.remove('hidden')).catch(() => undefined);
  await fi.setInputFiles(saved.file);
  await expect.poll(() => ent(page), { timeout: 30000 }).toBe(2);
  const reopened = (await saveEntities(page)).entities.map((e) => ({
    id: e.id, type: e.type,
    centerX: (e as any).centerX ?? null, centerY: (e as any).centerY ?? null,
    radius: (e as any).radius ?? null,
  }));
  expect(reopened).toEqual(geom);
  await shot(page, 'E-reopened');
  expect(errors).toEqual([]);
});
