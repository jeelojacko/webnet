/**
 * CAD Best Fit E1 browser QA — ribbon truth, line/arc/parabola construction,
 * min-gate, failure handling, undo/redo, Properties, zero errors.
 *
 * Production build, headless Chromium, blank disposable drawings. Run:
 *   npx playwright test cad-draw-best-fit-e1 --config=playwright.prod.config.ts
 *
 * Flows A–G (flyout truth/icons/faces, line preview+report, arc via alias +
 * min-gate, rotated parabola via ribbon + Properties, aliases/sticky/min-gate/
 * escape, degenerate failure + undo/redo, zero page/console/unhandled
 * errors). Evidence: PNGs + geometry.json under
 * docs/evidence/cad-best-fit-e1/.
 */
import { expect, test, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { parseCadDrawingFile } from '../src/engine/cad/cadDrawingFile';

const SHOTS = 'docs/evidence/cad-best-fit-e1';
fs.mkdirSync(SHOTS, { recursive: true });
const evidence: Record<string, unknown> = {};
const writeEvidence = (): void => {
  fs.writeFileSync(`${SHOTS}/geometry.json`, JSON.stringify(evidence, null, 2));
};

type Entity = Record<string, any>;
const VARIANT_ROWS: ReadonlyArray<readonly [string, string, string]> = [
  ['bestfit-line', 'BESTFITLINE', 'draw-best-fit-line'],
  ['bestfit-arc', 'BESTFITARC', 'draw-best-fit-arc'],
  ['bestfit-parabola', 'BESTFITPARABOLA', 'draw-best-fit-parabola'],
];

async function boot(page: Page, errors: string[]): Promise<void> {
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('dialog', (d) => { if (d.type() === 'confirm') void d.accept(); else void d.dismiss().catch(() => undefined); });
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    delete w.showSaveFilePicker; delete w.showOpenFilePicker;
    const bus = window as unknown as { __bfRejections: string[] };
    bus.__bfRejections = [];
    window.addEventListener('unhandledrejection', (e) => bus.__bfRejections.push(String(e.reason)));
  });
  await page.goto('/cad', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('WebNet CAD', { exact: true }).first()).toBeVisible({ timeout: 30000 });
  await expect(page.locator('[data-cad-viewport]')).toBeVisible({ timeout: 30000 });
  const show = page.locator('button[title="Show ribbon"]');
  if (await show.isVisible().catch(() => false)) await show.click({ force: true });
  await expect(page.locator('[data-cad-ribbon]')).toBeVisible({ timeout: 10000 });
}
async function assertClean(page: Page, errors: string[]): Promise<void> {
  const rejections = await page.evaluate(() => (window as unknown as { __bfRejections?: string[] }).__bfRejections ?? []);
  expect(rejections).toEqual([]);
  expect(errors).toEqual([]);
}
const input = (page: Page) => page.locator('[data-cad-command-input]');
const prompt = (page: Page) => page.locator('[data-cad-command-prompt]');
const face = (page: Page) => page.locator('[data-cad-family="bestfit"] .cad-ribbon-split__primary').first();
async function ent(page: Page): Promise<number> {
  return Number.parseInt((await page.locator('[data-survey-cad-entity-count]').first().textContent()) ?? '0', 10);
}
async function type(page: Page, text: string): Promise<void> {
  await input(page).fill(text);
  await input(page).press('Enter');
}
const PROMPT_TOKEN: Record<string, string> = {
  BESTFITLINE: 'BESTFITLINE',
  BESTFITARC: 'BESTFITARC',
  BESTFITPARABOLA: 'BESTFITPARABOLA',
  BFL: 'BESTFITLINE',
  BFA: 'BESTFITARC',
  BFP: 'BESTFITPARABOLA',
};
async function start(page: Page, key: string): Promise<void> {
  await input(page).fill(key);
  await input(page).press('Enter');
  await expect(prompt(page)).toContainText(new RegExp(PROMPT_TOKEN[key] ?? key, 'i'), { timeout: 10000 });
}
async function esc(page: Page): Promise<void> {
  await input(page).focus();
  await input(page).press('Escape');
  await page.waitForTimeout(150);
}
async function historyAction(page: Page, label: 'Undo' | 'Redo'): Promise<void> {
  await page.getByRole('button', { name: 'Edit', exact: true }).click({ force: true });
  await page.getByRole('menuitem', { name: label }).click({ force: true });
}
async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}
async function saveDrawing(page: Page): Promise<{ entities: Entity[]; project: Record<string, any> }> {
  const dl = page.waitForEvent('download', { timeout: 30000 });
  await page.locator('[data-cad-quick-access] button[title="Save the drawing (WNCAD)"]').click({ force: true });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wn-bf-'));
  const file = path.join(dir, 'drawing.wncad');
  await (await dl).saveAs(file);
  const parsed = parseCadDrawingFile(fs.readFileSync(file, 'utf8'));
  if (!parsed.ok) throw new Error(`saved drawing did not parse: ${parsed.errors.join('; ')}`);
  return { entities: parsed.drawing.project.entities as Entity[], project: parsed.drawing.project as unknown as Record<string, any> };
}
async function showProperties(page: Page): Promise<void> {
  if (await page.locator('[data-cad-properties]').isVisible().catch(() => false)) return;
  await page.getByRole('button', { name: 'View', exact: true }).click();
  const item = page.locator('[role="menu"][aria-label="View"] [role="menuitem"]', { hasText: 'Properties:' });
  if (((await item.textContent()) ?? '').includes('Hidden')) await item.click();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-cad-properties]')).toBeVisible({ timeout: 10000 });
}

test('A: best-fit flyout shows 3 live rows with 3 curated icons; faces switch', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  await boot(page, errors);
  await page.locator('[data-cad-family-caret="bestfit"]').click({ force: true });
  const fly = page.locator('[data-cad-ribbon-flyout="bestfit"]');
  await expect(fly).toBeVisible({ timeout: 5000 });
  expect(await fly.locator('[data-cad-variant]').count()).toBe(3);
  expect(await fly.locator('[data-cad-variant][aria-disabled="true"]').count()).toBe(0);
  const srcs: string[] = [];
  for (const [id, command] of VARIANT_ROWS) {
    const row = fly.locator(`[data-cad-variant="${id}"]`);
    await expect(row).toHaveAttribute('data-cad-command', command);
    expect(await row.locator('img').count()).toBe(1);
    srcs.push((await row.locator('img').getAttribute('src')) ?? '');
  }
  expect(new Set(srcs).size).toBe(3);
  await shot(page, 'A-bestfit-flyout');
  await page.keyboard.press('Escape');
  evidence.flowA = { rows: VARIANT_ROWS.map(([id, command, icon]) => ({ id, command, icon })), distinctIcons: new Set(srcs).size };

  await page.locator('[data-cad-family-caret="bestfit"]').click({ force: true });
  await expect(fly).toBeVisible({ timeout: 5000 });
  await fly.locator('[data-cad-variant="bestfit-arc"]').click({ force: true });
  await expect(face(page)).toHaveAttribute('data-cad-command', 'BESTFITARC');
  await expect(face(page)).toHaveAttribute('data-cad-ribbon-icon', 'draw-best-fit-arc');
  await page.waitForTimeout(100);
  await page.locator('[data-cad-family-caret="bestfit"]').click({ force: true });
  await expect(fly).toBeVisible({ timeout: 5000 });
  await fly.locator('[data-cad-variant="bestfit-parabola"]').click({ force: true });
  await expect(face(page)).toHaveAttribute('data-cad-command', 'BESTFITPARABOLA');
  await esc(page);
  writeEvidence();
  await assertClean(page, errors);
});

test('B: BESTFITLINE preview, commit, report, undo/redo', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  await boot(page, errors);
  await start(page, 'BESTFITLINE');
  await expect(prompt(page)).toContainText(/minimum 2/, { timeout: 10000 });
  await type(page, '0,0.1');
  await expect(prompt(page)).toContainText(/1 sample.*minimum 2/, { timeout: 10000 });
  await type(page, '10,10.2');
  await expect(prompt(page)).toContainText(/2 samples.*minimum 2/, { timeout: 10000 });
  await expect(page.locator('[data-survey-cad-command-preview]')).toBeVisible({ timeout: 10000 });
  await shot(page, 'B-line-preview');
  await type(page, '20,19.8');
  await type(page, '30,30.3');
  await type(page, '');
  await expect(prompt(page)).toContainText(/BEST_FIT_LINE committed/, { timeout: 15000 });
  await expect.poll(() => ent(page), { timeout: 15000 }).toBe(1);
  const panel = page.locator('[data-survey-cad-cogo-panel]');
  await expect(panel).toBeVisible({ timeout: 10000 });
  await expect(panel).toContainText('Best Fit Line');
  await expect(panel).toContainText(/Sample count/);
  await shot(page, 'B-line-report');
  const { entities, project } = await saveDrawing(page);
  const lines = entities.filter((e) => e.type === 'polyline');
  expect(lines).toHaveLength(1);
  expect(lines[0]!.vertices).toHaveLength(2);
  expect(lines[0]!.closed).toBe(false);
  expect('segmentGeometry' in lines[0]!).toBe(false);
  expect(lines[0]!.metadata?.createdBy).toBe('BEST_FIT_LINE');
  const computations = (project['cogoComputations'] ?? []) as Array<Record<string, any>>;
  expect(computations).toHaveLength(1);
  expect(computations[0]!['toolKey']).toBe('BEST_FIT_LINE');
  expect(computations[0]!['report']['tables'][0]['rows']).toHaveLength(4);
  evidence.flowB = { vertices: lines[0]!.vertices, rows: computations[0]!['report']['rows'] };
  await historyAction(page, 'Undo');
  await expect.poll(() => ent(page), { timeout: 15000 }).toBe(0);
  await historyAction(page, 'Redo');
  await expect.poll(() => ent(page), { timeout: 15000 }).toBe(1);
  writeEvidence();
  await assertClean(page, errors);
});

test('C: BFA alias, min-gate refusal, arc commit', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  await boot(page, errors);
  await start(page, 'BFA');
  await expect(prompt(page)).toContainText(/minimum 3/, { timeout: 10000 });
  await type(page, '10,0');
  await type(page, '7.07,7.07');
  await type(page, '');
  await expect(prompt(page)).toContainText(/at least 3 samples/, { timeout: 10000 });
  await expect.poll(() => ent(page), { timeout: 5000 }).toBe(0);
  await type(page, '0,10');
  await type(page, '-7.07,7.07');
  await type(page, '');
  await expect(prompt(page)).toContainText(/BEST_FIT_ARC committed/, { timeout: 15000 });
  await expect.poll(() => ent(page), { timeout: 15000 }).toBe(1);
  await shot(page, 'C-arc-committed');
  const { entities, project } = await saveDrawing(page);
  const arcs = entities.filter((e) => e.type === 'arc');
  expect(arcs).toHaveLength(1);
  expect(arcs[0]!.centerX).toBeCloseTo(0, 0);
  expect(arcs[0]!.centerY).toBeCloseTo(0, 0);
  expect(arcs[0]!.radius).toBeCloseTo(10, 0);
  expect(arcs[0]!.metadata?.createdBy).toBe('BEST_FIT_ARC');
  const computations = (project['cogoComputations'] ?? []) as Array<Record<string, any>>;
  expect(computations).toHaveLength(1);
  expect(computations[0]!['report']['tables'][0]['rows']).toHaveLength(4);
  evidence.flowC = { center: [arcs[0]!.centerX, arcs[0]!.centerY], radius: arcs[0]!.radius };
  await historyAction(page, 'Undo');
  await expect.poll(() => ent(page), { timeout: 15000 }).toBe(0);
  await historyAction(page, 'Redo');
  await expect.poll(() => ent(page), { timeout: 15000 }).toBe(1);
  writeEvidence();
  await assertClean(page, errors);
});

test('D: rotated parabola via ribbon + Properties', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  await boot(page, errors);
  await page.locator('[data-cad-family-caret="bestfit"]').click({ force: true });
  const fly = page.locator('[data-cad-ribbon-flyout="bestfit"]');
  await expect(fly).toBeVisible({ timeout: 5000 });
  await fly.locator('[data-cad-variant="bestfit-parabola"]').click({ force: true });
  await expect(prompt(page)).toContainText(/BESTFITPARABOLA.*minimum 5/, { timeout: 10000 });
  for (const sample of ['101.575,61.204', '99.190,54.398', '101.603,48.704', '107.205,47.916', '116.001,49.536', '127.992,53.564']) {
    await type(page, sample);
  }
  await expect(prompt(page)).toContainText(/6 samples.*minimum 5/, { timeout: 10000 });
  await expect(page.locator('[data-survey-cad-command-preview]')).toBeVisible({ timeout: 10000 });
  await shot(page, 'D-parabola-preview');
  await type(page, '');
  await expect(prompt(page)).toContainText(/BEST_FIT_PARABOLA committed/, { timeout: 15000 });
  await expect.poll(() => ent(page), { timeout: 15000 }).toBe(1);
  const { entities, project } = await saveDrawing(page);
  const parabolas = entities.filter((e) => e.type === 'parabola');
  expect(parabolas).toHaveLength(1);
  expect(parabolas[0]!.focalLength).toBeCloseTo(2, 0);
  expect(parabolas[0]!.tEnd).toBeGreaterThan(parabolas[0]!.tStart);
  const computations = (project['cogoComputations'] ?? []) as Array<Record<string, any>>;
  expect(computations).toHaveLength(1);
  expect(computations[0]!['report']['tables'][0]['rows']).toHaveLength(6);
  evidence.flowD = { vertex: [parabolas[0]!.vertexX, parabolas[0]!.vertexY], focal: parabolas[0]!.focalLength };
  await showProperties(page);
  const props = page.locator('[data-cad-properties]');
  await expect(props).toContainText(/Parabola/i, { timeout: 10000 });
  await shot(page, 'D-parabola-properties');
  writeEvidence();
  await assertClean(page, errors);
});

test('E: aliases resolve, typed use keeps the sticky face, Escape cancels', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  await boot(page, errors);
  await page.locator('[data-cad-family-caret="bestfit"]').click({ force: true });
  const fly = page.locator('[data-cad-ribbon-flyout="bestfit"]');
  await expect(fly).toBeVisible({ timeout: 5000 });
  await fly.locator('[data-cad-variant="bestfit-arc"]').click({ force: true });
  await expect(face(page)).toHaveAttribute('data-cad-command', 'BESTFITARC');
  await esc(page);
  await start(page, 'BFL');
  await expect(prompt(page)).toContainText(/BESTFITLINE/, { timeout: 10000 });
  // Typed use never moves the sticky ribbon face.
  await expect(face(page)).toHaveAttribute('data-cad-command', 'BESTFITARC');
  await type(page, 'U');
  await expect(prompt(page)).toContainText(/nothing to undo/, { timeout: 10000 });
  await esc(page);
  await expect.poll(() => ent(page), { timeout: 5000 }).toBe(0);
  await expect(face(page)).toHaveAttribute('data-cad-command', 'BESTFITARC');
  await start(page, 'BFP');
  await expect(prompt(page)).toContainText(/BESTFITPARABOLA/, { timeout: 10000 });
  await expect(face(page)).toHaveAttribute('data-cad-command', 'BESTFITARC');
  await esc(page);
  evidence.flowE = { stickyKept: true };
  writeEvidence();
  await assertClean(page, errors);
});

test('F: degenerate arc fails closed with zero mutation', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  await boot(page, errors);
  await start(page, 'BESTFITARC');
  await type(page, '0,0');
  await type(page, '10,0');
  await type(page, '20,0');
  await type(page, '');
  await expect(prompt(page)).toContainText(/could not fit/, { timeout: 10000 });
  await expect.poll(() => ent(page), { timeout: 5000 }).toBe(0);
  const { project } = await saveDrawing(page);
  expect((project['cogoComputations'] ?? [])).toHaveLength(0);
  await esc(page);
  await expect.poll(() => ent(page), { timeout: 5000 }).toBe(0);
  evidence.flowF = { zeroMutation: true };
  writeEvidence();
  await assertClean(page, errors);
});

test('G: idle autocomplete still resolves the new keys', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  await boot(page, errors);
  await input(page).fill('BF');
  await expect(page.locator('[data-cad-command-suggestion]').first()).toBeVisible({ timeout: 10000 });
  const suggestions = await page.locator('[data-cad-command-suggestion]').allTextContents();
  expect(suggestions.join(' ')).toMatch(/BESTFITLINE/);
  evidence.flowG = { suggestions: suggestions.length };
  writeEvidence();
  await assertClean(page, errors);
});
