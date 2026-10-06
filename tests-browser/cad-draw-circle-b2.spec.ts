/**
 * Phase B2 browser QA — Circle construction modes + global command dock.
 *
 * Production build, headless Chromium, blank disposable drawings. Run:
 *   npx playwright test cad-draw-circle-b2 --config=playwright.prod.config.ts
 *
 * Flows A–F (ribbon truth/icons, 2P/3P/TTR/TTT viewport construction,
 * command-input regression, idle autocomplete, compact/history layout, zero
 * page/console/unhandled errors). Evidence: PNGs + geometry.json under
 * docs/evidence/cad-circle-b2-command-dock/.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { parseCadDrawingFile } from '../src/engine/cad/cadDrawingFile';

const SHOTS = 'docs/evidence/cad-circle-b2-command-dock';
fs.mkdirSync(SHOTS, { recursive: true });
const evidence: Record<string, unknown> = {};
const writeEvidence = (): void => {
  fs.writeFileSync(`${SHOTS}/geometry.json`, JSON.stringify(evidence, null, 2));
};

type Entity = Record<string, any>;
const VARIANT_ROWS: ReadonlyArray<readonly [string, string, string]> = [
  ['circle-center-radius', 'CIRCLE', 'draw-circle-center-radius'],
  ['circle-center-diameter', 'CIRCLECD', 'draw-circle-center-diameter'],
  ['circle-2point', 'CIRCLE2P', 'draw-circle-2point'],
  ['circle-3point', 'CIRCLE3P', 'draw-circle-3point'],
  ['circle-tan-tan-radius', 'CIRCLETTR', 'draw-circle-tan-tan-radius'],
  ['circle-tan-tan-tan', 'CIRCLETTT', 'draw-circle-tan-tan-tan'],
];

async function boot(page: Page, errors: string[]): Promise<void> {
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('dialog', (d) => { if (d.type() === 'confirm') void d.accept(); else void d.dismiss().catch(() => undefined); });
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    delete w.showSaveFilePicker; delete w.showOpenFilePicker;
    const bus = window as unknown as { __b2Rejections: string[] };
    bus.__b2Rejections = [];
    window.addEventListener('unhandledrejection', (e) => bus.__b2Rejections.push(String(e.reason)));
  });
  await page.goto('/cad', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('WebNet CAD', { exact: true }).first()).toBeVisible({ timeout: 30000 });
  await expect(page.locator('[data-cad-viewport]')).toBeVisible({ timeout: 30000 });
  const show = page.locator('button[title="Show ribbon"]');
  if (await show.isVisible().catch(() => false)) await show.click({ force: true });
  await expect(page.locator('[data-cad-ribbon]')).toBeVisible({ timeout: 10000 });
}
async function assertClean(page: Page, errors: string[]): Promise<void> {
  const rejections = await page.evaluate(() => (window as unknown as { __b2Rejections?: string[] }).__b2Rejections ?? []);
  expect(rejections).toEqual([]);
  expect(errors).toEqual([]);
}
const input = (page: Page) => page.locator('[data-cad-command-input]');
const prompt = (page: Page) => page.locator('[data-cad-command-prompt]');
const dock = (page: Page) => page.locator('[data-cad-command-dock]');
const face = (page: Page) => page.locator('[data-cad-family="circle"] .cad-ribbon-split__primary').first();
async function ent(page: Page): Promise<number> {
  return Number.parseInt((await page.locator('[data-survey-cad-entity-count]').first().textContent()) ?? '0', 10);
}
async function viewportPoint(page: Page, fx: number, fy: number): Promise<{ x: number; y: number }> {
  const box = await page.locator('[data-survey-cad-preview]').first().boundingBox();
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
async function endSession(page: Page): Promise<void> {
  await esc(page);
  await expect(page.locator('[data-cad-command][aria-pressed="true"]')).toHaveCount(0, { timeout: 10000 });
}
async function historyAction(page: Page, label: 'Undo' | 'Redo'): Promise<void> {
  await page.getByRole('button', { name: 'Edit', exact: true }).click({ force: true });
  await page.getByRole('menuitem', { name: label }).click({ force: true });
}
async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}
async function saveEntities(page: Page): Promise<{ file: string; entities: Entity[] }> {
  const dl = page.waitForEvent('download', { timeout: 30000 });
  await page.locator('[data-cad-quick-access] button[title="Save the drawing (WNCAD)"]').click({ force: true });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wn-b2-'));
  const file = path.join(dir, 'drawing.wncad');
  await (await dl).saveAs(file);
  const parsed = parseCadDrawingFile(fs.readFileSync(file, 'utf8'));
  if (!parsed.ok) throw new Error(`saved drawing did not parse: ${parsed.errors.join('; ')}`);
  return { file, entities: parsed.drawing.project.entities as Entity[] };
}
const circles = (ents: Entity[]) => ents.filter((e) => e.type === 'circle');
const circleGeom = (ents: Entity[]) =>
  circles(ents).map((e) => ({ id: e.id, type: e.type, centerX: e.centerX, centerY: e.centerY, radius: e.radius, createdBy: e.metadata?.createdBy ?? null }));

async function svgViewToClient(page: Page, viewX: number, viewY: number): Promise<{ x: number; y: number }> {
  const svg = page.locator('[data-survey-cad-preview]').first();
  const box = await svg.boundingBox();
  if (!box) throw new Error('no svg box');
  const vb = ((await svg.getAttribute('viewBox')) ?? '0 0 900 520').trim().split(/\s+/).map(Number);
  const w = vb[2]!; const h = vb[3]!;
  const sf = Math.min(box.width / w, box.height / h);
  const offX = (box.width - w * sf) / 2;
  const offY = (box.height - h * sf) / 2;
  return { x: box.x + offX + viewX * sf, y: box.y + offY + viewY * sf };
}
/** Click the Nth line hit-target at world parameter t (start=0, end=1). */
async function clickLineAt(page: Page, index: number, t: number): Promise<void> {
  const line = page.locator('[data-survey-cad-hit-target="true"]').nth(index);
  const a = await line.evaluate((el) => ({
    x1: Number(el.getAttribute('x1')), y1: Number(el.getAttribute('y1')),
    x2: Number(el.getAttribute('x2')), y2: Number(el.getAttribute('y2')),
  }));
  const pt = await svgViewToClient(page, a.x1 + t * (a.x2 - a.x1), a.y1 + t * (a.y2 - a.y1));
  await page.mouse.click(pt.x, pt.y);
}

test('A: circle flyout shows 6 live rows with 6 curated icons; faces switch', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  await boot(page, errors);
  await page.locator('[data-cad-family-caret="circle"]').click({ force: true });
  const fly = page.locator('[data-cad-ribbon-flyout="circle"]');
  await expect(fly).toBeVisible({ timeout: 5000 });
  expect(await fly.locator('[data-cad-variant]').count()).toBe(6);
  expect(await fly.locator('[data-cad-variant][aria-disabled="true"]').count()).toBe(0);
  const srcs: string[] = [];
  const mapping: Record<string, { command: string; icon: string }> = {};
  for (const [id, command, icon] of VARIANT_ROWS) {
    const row = fly.locator(`[data-cad-variant="${id}"]`);
    await expect(row).toHaveAttribute('data-cad-command', command);
    const img = row.locator('img');
    expect(await img.count()).toBe(1);
    srcs.push((await img.getAttribute('src')) ?? '');
    expect((await row.locator('.cad-ribbon-flyout__label').textContent())?.trim().length).toBeGreaterThan(0);
    mapping[id] = { command, icon };
  }
  expect(new Set(srcs).size).toBe(6);
  await shot(page, 'A-circle-flyout');
  await page.keyboard.press('Escape');
  evidence.flowA = { variants: mapping, distinctIcons: new Set(srcs).size };

  const select = async (id: string, label: string, icon: string, command: string): Promise<void> => {
    await page.locator('[data-cad-family-caret="circle"]').click({ force: true });
    await expect(fly).toBeVisible({ timeout: 5000 });
    await fly.locator(`[data-cad-variant="${id}"]`).click({ force: true });
    await expect(face(page)).toHaveAttribute('data-cad-command', command);
    await expect(face(page)).toHaveAttribute('data-cad-ribbon-icon', icon);
    await expect(face(page)).toHaveAttribute('aria-label', label);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
  };
  await select('circle-2point', 'Circle: 2-Point', 'draw-circle-2point', 'CIRCLE2P');
  await shot(page, 'A-face-2point');
  await select('circle-3point', 'Circle: 3-Point', 'draw-circle-3point', 'CIRCLE3P');
  await shot(page, 'A-face-3point');
  await select('circle-tan-tan-radius', 'Circle: Tan, Tan, Radius', 'draw-circle-tan-tan-radius', 'CIRCLETTR');
  await shot(page, 'A-face-ttr');
  writeEvidence();
  await assertClean(page, errors);
});

test('B1: CIRCLE2P midpoint and CIRCLE3P circumcircle commit once; undo/redo', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  await boot(page, errors);
  await start(page, 'CIRCLE2P');
  await type(page, '10,20');
  await type(page, '40,20');
  await expect.poll(() => ent(page), { timeout: 15000 }).toBe(1);
  await shot(page, 'B-2point');
  let geom = circleGeom((await saveEntities(page)).entities);
  expect(geom).toHaveLength(1);
  expect(geom[0]!.centerX).toBeCloseTo(25, 6);
  expect(geom[0]!.centerY).toBeCloseTo(20, 6);
  expect(geom[0]!.radius).toBeCloseTo(15, 6);
  evidence.flowB2P = geom[0];

  await click(page, 0.5, 0.85);
  await historyAction(page, 'Undo');
  await expect.poll(() => ent(page), { timeout: 15000 }).toBe(0);
  await historyAction(page, 'Redo');
  await expect.poll(() => ent(page), { timeout: 15000 }).toBe(1);

  await start(page, 'CIRCLE3P');
  await type(page, '150,200');
  await type(page, '100,250');
  await move(page, 0.55, 0.45);
  await expect(page.locator('[data-survey-cad-command-preview]')).toBeVisible();
  await type(page, '50,200');
  await expect.poll(() => ent(page), { timeout: 15000 }).toBe(2);
  await shot(page, 'B-3point');
  geom = circleGeom((await saveEntities(page)).entities);
  const c3 = geom.find((e) => e.createdBy === 'CIRCLE3P');
  expect(c3).toBeTruthy();
  expect(c3!.centerX).toBeCloseTo(100, 6);
  expect(c3!.centerY).toBeCloseTo(200, 6);
  expect(c3!.radius).toBeCloseTo(50, 6);
  evidence.flowB3P = c3;
  writeEvidence();
  await assertClean(page, errors);
});

test('B2: CIRCLETTR nearest tangency; CIRCLETTT incircle picks one of four candidates', async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  await boot(page, errors);
  for (const [a, b] of [['0,0', '100,0'], ['0,0', '0,100']]) {
    await start(page, 'LINE');
    await type(page, a!);
    await type(page, b!);
  }
  await expect.poll(() => ent(page), { timeout: 15000 }).toBe(2);
  await start(page, 'CIRCLETTR');
  await clickLineAt(page, 0, 0.8);
  await clickLineAt(page, 1, 0.8);
  await type(page, '10');
  await expect.poll(() => ent(page), { timeout: 15000 }).toBe(3);
  await shot(page, 'B-ttr');
  let geom = circleGeom((await saveEntities(page)).entities);
  expect(geom).toHaveLength(1);
  expect(geom[0]!.centerX).toBeCloseTo(10, 2);
  expect(geom[0]!.centerY).toBeCloseTo(10, 2);
  expect(geom[0]!.radius).toBeCloseTo(10, 6);
  evidence.flowTTR = geom[0];
  await historyAction(page, 'Undo');
  await expect.poll(() => ent(page), { timeout: 15000 }).toBe(2);
  await historyAction(page, 'Redo');
  await expect.poll(() => ent(page), { timeout: 15000 }).toBe(3);

  // TTT: triangle lines a(0,0)-(100,0), b(0,0)-(0,100), c(100,0)-(0,100).
  for (const [a, b] of [['0,0', '100,0'], ['0,0', '0,100'], ['100,0', '0,100']]) {
    await start(page, 'LINE');
    await type(page, a!);
    await type(page, b!);
  }
  await expect.poll(() => ent(page), { timeout: 15000 }).toBe(6);
  await start(page, 'CIRCLETTT');
  await clickLineAt(page, 3, 0.8);
  await clickLineAt(page, 4, 0.8);
  await clickLineAt(page, 5, 0.4);
  await expect.poll(() => ent(page), { timeout: 15000 }).toBe(7);
  await shot(page, 'B-ttt');
  geom = circleGeom((await saveEntities(page)).entities);
  const ttt = geom.find((e) => e.createdBy === 'CIRCLETTT');
  expect(ttt).toBeTruthy();
  const incircleR = (200 - 100 * Math.SQRT2) / 2;
  expect(ttt!.centerX).toBeCloseTo(incircleR, 1);
  expect(ttt!.centerY).toBeCloseTo(incircleR, 1);
  expect(ttt!.radius).toBeCloseTo(incircleR, 1);
  evidence.flowTTT = { ...ttt, expectedIncircleRadius: incircleR };
  writeEvidence();
  await assertClean(page, errors);
});

test('C: session value typed on the viewport appears in the dock and Enter commits', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  await boot(page, errors);
  await page.locator('[data-cad-family="circle"] .cad-ribbon-split__primary').first().click({ force: true });
  await expect(prompt(page)).toContainText(/CIRCLE/i, { timeout: 10000 });
  await click(page, 0.45, 0.5);
  await page.keyboard.type('5');
  await expect(input(page)).toHaveValue('5', { timeout: 5000 });
  await shot(page, 'C-typed-before-enter');
  await page.keyboard.press('Enter');
  await expect.poll(() => ent(page), { timeout: 15000 }).toBe(1);
  await shot(page, 'C-committed');
  const geom = circleGeom((await saveEntities(page)).entities);
  expect(geom).toHaveLength(1);
  expect(geom[0]!.radius).toBeCloseTo(5, 6);
  evidence.flowC = geom[0];
  writeEvidence();
  await assertClean(page, errors);
});

test('D: idle autocomplete suggestions, Down+Enter and double-click launch, session hides list', async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  await boot(page, errors);
  await click(page, 0.5, 0.85);
  await page.keyboard.type('cir');
  const suggestions = page.locator('[data-cad-command-suggestion]');
  await expect(suggestions.first()).toBeVisible({ timeout: 5000 });
  expect(await suggestions.count()).toBeLessThanOrEqual(8);
  await expect(input(page)).toBeFocused();
  await shot(page, 'D-suggestions');
  const firstKey = ((await suggestions.first().locator('strong').textContent()) ?? '').trim();
  evidence.flowD = { suggestionCount: await suggestions.count(), firstKey };
  await input(page).focus();
  await input(page).press('ArrowDown');
  const activeOption = page.locator('#cad-shell-command-suggest [role="option"][aria-selected="true"]');
  await expect(activeOption).toHaveCount(1);
  const activeKey = ((await activeOption.getAttribute('id')) ?? '').replace('cad-shell-command-suggest-', '');
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toContainText(new RegExp(activeKey, 'i'), { timeout: 10000 });
  await esc(page);

  await click(page, 0.5, 0.85);
  await page.keyboard.type('cir');
  await expect(suggestions.first()).toBeVisible({ timeout: 5000 });
  const dblKey = ((await suggestions.first().locator('strong').textContent()) ?? '').trim();
  await suggestions.first().dblclick();
  await expect(prompt(page)).toContainText(new RegExp(dblKey, 'i'), { timeout: 10000 });
  await shot(page, 'D-doubleclick');
  await esc(page);

  // Active session: no suggestions for a radius value.
  await start(page, 'CIRCLE');
  await click(page, 0.45, 0.5);
  await page.keyboard.type('5');
  await expect(input(page)).toHaveValue('5');
  expect(await suggestions.count()).toBe(0);
  await esc(page);
  writeEvidence();
  await assertClean(page, errors);
});

const HISTORY_KEYS = ['CIRCLE', 'LINE', 'PLINE', 'POINT', 'RECTANGLE', 'POLYGON', 'CIRCLE2P', 'CIRCLE3P', 'CIRCLETTR', 'CIRCLETTT'];
async function compactHistoryFlow(page: Page, width: number): Promise<void> {
  const errors: string[] = [];
  await page.setViewportSize({ width, height: 900 });
  await boot(page, errors);
  await expect(dock(page)).toHaveAttribute('data-cad-command-expanded', 'false');
  expect(await page.locator('[data-cad-command-history]').count()).toBe(0);
  const collapsedBox = await dock(page).boundingBox();
  await shot(page, `E-collapsed-${width}`);

  await page.locator('[data-cad-command-history-toggle]').click({ force: true });
  await expect(dock(page)).toHaveAttribute('data-cad-command-expanded', 'true');
  await expect(page.locator('[data-cad-command-dock] [role="separator"]')).toBeVisible();
  for (let i = 0; i < 18; i += 1) {
    await input(page).fill(HISTORY_KEYS[i % HISTORY_KEYS.length]!);
    await input(page).press('Enter');
    await endSession(page);
  }
  const list = page.locator('[data-cad-command-history]');
  await expect(list).toBeVisible();
  expect(await list.locator('span').count()).toBeGreaterThanOrEqual(18);
  const scroll = await list.evaluate((el) => ({ top: el.scrollTop, client: el.clientHeight, height: el.scrollHeight }));
  expect(scroll.height).toBeGreaterThan(scroll.client);
  expect(scroll.top + scroll.client).toBeGreaterThanOrEqual(scroll.height - 4);
  const expandedBox = await dock(page).boundingBox();
  await shot(page, `E-expanded-${width}`);

  await page.locator('[data-cad-command-history-toggle]').click({ force: true });
  await expect(dock(page)).toHaveAttribute('data-cad-command-expanded', 'false');
  const reclaimedBox = await dock(page).boundingBox();
  expect(reclaimedBox!.height).toBeLessThan(expandedBox!.height);
  expect(reclaimedBox!.height).toBeLessThan(120);
  evidence[`flowE_${width}`] = { collapsedHeight: collapsedBox!.height, expandedHeight: expandedBox!.height, reclaimedHeight: reclaimedBox!.height, historyScrollHeight: scroll.height };
  writeEvidence();
  await assertClean(page, errors);
}

test('E1: compact/history layout at 1366 collapsed, expanded-scroll, reclaimed', async ({ page }) => {
  test.setTimeout(150_000);
  await compactHistoryFlow(page, 1366);
});

test('E2: compact/history layout at 1920 collapsed, expanded-scroll, reclaimed', async ({ page }) => {
  test.setTimeout(150_000);
  await compactHistoryFlow(page, 1920);
});
