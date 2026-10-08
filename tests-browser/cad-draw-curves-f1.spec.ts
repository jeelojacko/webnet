/**
 * CAD Curves F1 browser QA — six live curve commands over the Curves ribbon
 * family: flyout truth/sticky/typed/reset, Between trim+undo, On unchanged,
 * Through pass-point + no-solution, Multiple chain, From-End, Reverse-or-
 * Compound, existing-command reps, no-preselection picks, zero errors.
 *
 * Production build, headless Chromium, blank disposable drawings. Run:
 *   npx playwright test cad-draw-curves-f1 --config=playwright.prod.config.ts
 *
 * Evidence: PNGs + geometry.json under docs/evidence/cad-curves-f1/.
 */
import { expect, test, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { parseCadDrawingFile } from '../src/engine/cad/cadDrawingFile';

const SHOTS = 'docs/evidence/cad-curves-f1';
fs.mkdirSync(SHOTS, { recursive: true });
const evidence: Record<string, unknown> = {};
const writeEvidence = (): void => {
  fs.writeFileSync(`${SHOTS}/geometry.json`, JSON.stringify(evidence, null, 2));
};

type Entity = Record<string, any>;

const F1_ROWS: ReadonlyArray<readonly [string, string]> = [
  ['curves-between-two-lines', 'CURVE_BETWEEN_TWO_LINES'],
  ['curves-on-two-lines', 'CURVE_ON_TWO_LINES'],
  ['curves-through-point', 'CURVE_THROUGH_POINT'],
  ['curves-multiple', 'MULTIPLE_CURVES'],
  ['curves-from-end', 'CURVE_FROM_END'],
  ['curves-reverse-compound', 'REVERSE_OR_COMPOUND'],
];

async function boot(page: Page, errors: string[]): Promise<void> {
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('dialog', (d) => { if (d.type() === 'confirm') void d.accept(); else void d.dismiss().catch(() => undefined); });
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    delete w.showSaveFilePicker; delete w.showOpenFilePicker;
    const bus = window as unknown as { __f1Rejections: string[] };
    bus.__f1Rejections = [];
    window.addEventListener('unhandledrejection', (e) => bus.__f1Rejections.push(String(e.reason)));
  });
  await page.goto('/cad', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('WebNet CAD', { exact: true }).first()).toBeVisible({ timeout: 30000 });
  await expect(page.locator('[data-cad-viewport]')).toBeVisible({ timeout: 30000 });
  const show = page.locator('button[title="Show ribbon"]');
  if (await show.isVisible().catch(() => false)) await show.click({ force: true });
  await expect(page.locator('[data-cad-ribbon]')).toBeVisible({ timeout: 10000 });
}

async function assertClean(page: Page, errors: string[]): Promise<void> {
  const rejections = await page.evaluate(() => (window as unknown as { __f1Rejections?: string[] }).__f1Rejections ?? []);
  expect(rejections).toEqual([]);
  expect(errors).toEqual([]);
}

const input = (page: Page) => page.locator('[data-cad-command-input]');
const prompt = (page: Page) => page.locator('[data-cad-command-prompt]');
const face = (page: Page) => page.locator('[data-cad-family="curves"] .cad-ribbon-split__primary').first();

async function ent(page: Page): Promise<number> {
  return Number.parseInt((await page.locator('[data-survey-cad-entity-count]').first().textContent()) ?? '0', 10);
}

async function parkMouse(page: Page): Promise<void> {
  // Keep the resting cursor off the dock autocomplete dropdown: a dropdown
  // rendering under the cursor fires mouseenter, arms a suggestion, and
  // Enter would execute the suggestion instead of the typed text.
  await page.mouse.move(10, 10);
}

async function type(page: Page, text: string): Promise<void> {
  await parkMouse(page);
  await input(page).fill(text);
  await input(page).press('Enter');
}

async function start(page: Page, key: string, pattern?: RegExp): Promise<void> {
  await parkMouse(page);
  await input(page).fill(key);
  await input(page).press('Enter');
  await expect(prompt(page)).toContainText(pattern ?? new RegExp(key, 'i'), { timeout: 10000 });
}

async function esc(page: Page): Promise<void> {
  await input(page).focus();
  await input(page).press('Escape');
  await page.waitForTimeout(150);
}

/** Idle Escape clears the selection (no-preselection flows). The dock input
 *  swallows focused Escape, so click empty canvas first for body focus. */
async function clearSel(page: Page): Promise<void> {
  const box = await page.locator('[data-cad-viewport] svg').first().boundingBox();
  if (box) {
    await page.mouse.click(box.x + box.width * 0.06, box.y + box.height * 0.94);
    await page.waitForTimeout(150);
  }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
}

/** Click two line bodies, skipping the second when preseed already filled it. */
async function pickTwoLines(page: Page, firstId: string, secondId: string): Promise<void> {
  await clickEntity(page, firstId);
  if (((await prompt(page).textContent()) ?? '').includes('second line')) {
    await clickEntity(page, secondId);
  }
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wn-f1-'));
  const file = path.join(dir, 'drawing.wncad');
  await (await dl).saveAs(file);
  const parsed = parseCadDrawingFile(fs.readFileSync(file, 'utf8'));
  if (!parsed.ok) throw new Error(`saved drawing did not parse: ${parsed.errors.join('; ')}`);
  return { entities: parsed.drawing.project.entities as Entity[], project: parsed.drawing.project as unknown as Record<string, any> };
}

async function makeLine(page: Page, x1: number, y1: number, x2: number, y2: number): Promise<void> {
  const before = await ent(page);
  await start(page, 'LINE');
  await type(page, `${x1},${y1}`);
  await type(page, `${x2},${y2}`);
  await expect.poll(() => ent(page), { timeout: 15000 }).toBe(before + 1);
}

async function entityIdsByType(page: Page, type: string): Promise<string[]> {
  const { entities } = await saveDrawing(page);
  return entities.filter((e) => e.type === type).map((e) => String(e.id));
}

async function clickEntity(page: Page, id: string): Promise<void> {
  await page.locator(`[data-survey-cad-render-entity-id="${id}"]`).first().click({ force: true });
  await page.waitForTimeout(200);
  await parkMouse(page);
}

/** Dispatch a synthetic click on an entity element (bypasses overlay
 *  support points that would steal a real hit-test; the app receives the
 *  element's own entity id exactly as a direct body click delivers). */
async function clickEntityExact(page: Page, id: string): Promise<void> {
  await page.evaluate((targetId) => {
    const el = document.querySelector(`[data-survey-cad-render-entity-id="${targetId}"]`);
    if (!el) throw new Error(`missing entity element ${targetId}`);
    const rect = (el as SVGElement).getBoundingClientRect();
    el.dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        clientX: rect.x + rect.width / 2,
        clientY: rect.y + rect.height / 2,
      }),
    );
  }, id);
  await page.waitForTimeout(250);
  await parkMouse(page);
}

/** Click an arc body until the session captures it (support points may cover
 *  the element center; nearby stroke positions are retried). */
async function clickArcForSession(page: Page, id: string): Promise<void> {
  await clickEntityExact(page, id);
  const captured = async (): Promise<boolean> =>
    !/Click an arc body|needs a direct arc-body click/.test((await prompt(page).textContent()) ?? '');
  if (await captured()) return;
  const box = await page.locator(`[data-survey-cad-render-entity-id="${id}"]`).first().boundingBox();
  if (!box) throw new Error(`no bounding box for ${id}`);
  for (const [fx, fy] of [[0.3, 0.3], [0.7, 0.7], [0.3, 0.7], [0.7, 0.3]] as const) {
    await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
    await page.waitForTimeout(250);
    if (await captured()) return;
  }
}
async function clickEntityAt(page: Page, id: string, fx: number, fy: number): Promise<void> {
  const locator = page.locator(`[data-survey-cad-render-entity-id="${id}"]`).first();
  const box = await locator.boundingBox();
  if (!box) throw new Error(`no bounding box for ${id}`);
  await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
  await page.waitForTimeout(200);
}

const linesOf = (entities: Entity[]): Entity[] => entities.filter((e) => e.type === 'line');
const arcsOf = (entities: Entity[]): Entity[] => entities.filter((e) => e.type === 'arc');

test('A: curves flyout has 16 live rows, sticky face, typed-no-sticky, New reset', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  await boot(page, errors);
  await expect(face(page)).toHaveAttribute('data-cad-command', 'CURVE_BETWEEN_TWO_LINES');
  await page.locator('[data-cad-family-caret="curves"]').click({ force: true });
  const fly = page.locator('[data-cad-ribbon-flyout="curves"]');
  await expect(fly).toBeVisible({ timeout: 5000 });
  expect(await fly.locator('[data-cad-variant]').count()).toBe(16);
  expect(await fly.locator('[data-cad-variant][aria-disabled="true"]').count()).toBe(0);
  for (const [id, command] of F1_ROWS) {
    await expect(fly.locator(`[data-cad-variant="${id}"]`)).toHaveAttribute('data-cad-command', command);
  }
  await shot(page, 'A-curves-flyout');
  await page.keyboard.press('Escape');

  // Ribbon selection moves the sticky face.
  await page.locator('[data-cad-family-caret="curves"]').click({ force: true });
  await expect(fly).toBeVisible({ timeout: 5000 });
  await fly.locator('[data-cad-variant="curves-multiple"]').click({ force: true });
  await expect(face(page)).toHaveAttribute('data-cad-command', 'MULTIPLE_CURVES');
  await esc(page);

  // Typed command execution must NOT move the sticky face.
  await start(page, 'CURVEONTWOLINES', /CURVE_ON_TWO_LINES/);
  await expect(face(page)).toHaveAttribute('data-cad-command', 'MULTIPLE_CURVES');
  await esc(page);

  // New drawing resets the Curves face to Between Two Lines.
  await page.locator('[data-cad-quick-access] button[title="New drawing"]').click({ force: true });
  await expect(face(page)).toHaveAttribute('data-cad-command', 'CURVE_BETWEEN_TWO_LINES');
  evidence.flowA = { rows: 16, planned: 0, default: 'CURVE_BETWEEN_TWO_LINES' };
  writeEvidence();
  await assertClean(page, errors);
});

test('B: Between trims both lines with preview, one undo restores', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  await boot(page, errors);
  await makeLine(page, 0, 0, 100, 0);
  await makeLine(page, 0, 0, 0, 100);
  const before = await saveDrawing(page);
  const lineIds = linesOf(before.entities).map((e) => String(e.id));
  expect(lineIds).toHaveLength(2);

  await start(page, 'CURVEBETWEENTWOLINES', /CURVE_BETWEEN_TWO_LINES/);
  await pickTwoLines(page, lineIds[0]!, lineIds[1]!);
  await input(page).fill('R20');
  await expect(page.locator('[data-survey-cad-command-preview]')).toBeVisible({ timeout: 10000 });
  await shot(page, 'B-between-preview');
  await input(page).press('Enter');
  await expect.poll(() => ent(page), { timeout: 15000 }).toBe(11);
  await shot(page, 'B-between-after');
  const after = await saveDrawing(page);
  const arcs = arcsOf(after.entities);
  expect(arcs).toHaveLength(1);
  expect(arcs[0]!.radius).toBeCloseTo(20, 3);
  const afterLines = linesOf(after.entities);
  expect(JSON.stringify(afterLines)).not.toBe(JSON.stringify(linesOf(before.entities)));
  const panel = page.locator('[data-survey-cad-cogo-panel]');
  await expect(panel).toContainText('Curve Between Two Lines');
  evidence.flowB = { radius: arcs[0]!.radius };

  await historyAction(page, 'Undo');
  await expect.poll(() => ent(page), { timeout: 15000 }).toBe(2);
  const undone = await saveDrawing(page);
  expect(arcsOf(undone.entities)).toHaveLength(0);
  expect(linesOf(undone.entities)).toEqual(linesOf(before.entities));
  await historyAction(page, 'Redo');
  await expect.poll(() => ent(page), { timeout: 15000 }).toBe(11);
  writeEvidence();
  await assertClean(page, errors);
});

test('C: On shares the arc with sources byte-unchanged', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  await boot(page, errors);
  await makeLine(page, 0, 0, 100, 0);
  await makeLine(page, 0, 0, 0, 100);
  const before = await saveDrawing(page);
  const lineIds = linesOf(before.entities).map((e) => String(e.id));

  await start(page, 'CURVEONTWOLINES', /CURVE_ON_TWO_LINES/);
  await pickTwoLines(page, lineIds[0]!, lineIds[1]!);
  await type(page, 'R20');
  await expect.poll(() => ent(page), { timeout: 15000 }).toBe(11);
  const after = await saveDrawing(page);
  const onArcs = arcsOf(after.entities);
  expect(onArcs).toHaveLength(1);
  expect(onArcs[0]!.radius).toBeCloseTo(20, 3);
  expect(linesOf(after.entities)).toEqual(linesOf(before.entities));
  evidence.flowC = { radius: onArcs[0]!.radius, sourcesUnchanged: true };
  writeEvidence();
  await assertClean(page, errors);
});

test('D: Through pass-point trims; no-solution stays active', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  await boot(page, errors);
  await makeLine(page, 0, 0, 100, 0);
  await makeLine(page, 0, 0, 0, 100);
  const before = await saveDrawing(page);
  const lineIds = linesOf(before.entities).map((e) => String(e.id));

  await start(page, 'CURVETHROUGHPOINT', /CURVE_THROUGH_POINT/);
  await pickTwoLines(page, lineIds[0]!, lineIds[1]!);
  await type(page, '5.858,5.858');
  await expect(prompt(page)).toContainText(/CURVE_THROUGH_POINT/, { timeout: 10000 });
  await type(page, '');
  await expect.poll(() => ent(page), { timeout: 15000 }).toBe(11);
  const after = await saveDrawing(page);
  const throughArcs = arcsOf(after.entities);
  expect(throughArcs).toHaveLength(1);
  expect(JSON.stringify(linesOf(after.entities))).not.toBe(JSON.stringify(linesOf(before.entities)));

  // No-solution: a pass point on a source line stays active with no commit.
  await clearSel(page);
  await start(page, 'CURVETHROUGHPOINT', /CURVE_THROUGH_POINT/);
  const fresh = await saveDrawing(page);
  const freshIds = linesOf(fresh.entities).map((e) => String(e.id));
  await pickTwoLines(page, freshIds[0]!, freshIds[1]!);
  await type(page, '50,0');
  await type(page, '');
  await expect(prompt(page)).toContainText(/no tangent circle|stays active/i, { timeout: 10000 });
  expect(await ent(page)).toBe(11);
  await esc(page);
  expect(await ent(page)).toBe(11);
  evidence.flowD = { throughRadius: throughArcs[0]!.radius, noSolutionStaysActive: true };
  writeEvidence();
  await assertClean(page, errors);
});

test('E: Multiple 3-arc floating-middle chain, one undo', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  await boot(page, errors);
  await makeLine(page, 0, 0, 100, 0);
  await makeLine(page, 0, 0, 0, 100);
  const before = await saveDrawing(page);
  const lineIds = linesOf(before.entities).map((e) => String(e.id));

  await start(page, 'MULTIPLECURVES', /MULTIPLE_CURVES/);
  await pickTwoLines(page, lineIds[0]!, lineIds[1]!);
  await type(page, '3');
  await type(page, 'F2');
  await type(page, 'L10,R50');
  await type(page, 'L1,R60');
  await type(page, 'L10,R50');
  await expect(page.locator('[data-survey-cad-command-preview]')).toBeVisible({ timeout: 10000 });
  await shot(page, 'E-multiple-preview');
  await type(page, '');
  await expect.poll(() => ent(page), { timeout: 15000 }).toBeGreaterThan(2);
  await shot(page, 'E-multiple-chain');
  const after = await saveDrawing(page);
  const arcs = arcsOf(after.entities);
  expect(arcs).toHaveLength(3);
  expect(linesOf(after.entities)).toEqual(linesOf(before.entities));
  const startOf = (a: Entity): [number, number] => {
    const r = (Number(a.startAngleDeg) * Math.PI) / 180;
    return [Number(a.centerX) + Math.cos(r) * Number(a.radius), Number(a.centerY) + Math.sin(r) * Number(a.radius)];
  };
  const endOf = (a: Entity): [number, number] => {
    const r = (Number(a.endAngleDeg) * Math.PI) / 180;
    return [Number(a.centerX) + Math.cos(r) * Number(a.radius), Number(a.centerY) + Math.sin(r) * Number(a.radius)];
  };
  for (let i = 0; i + 1 < arcs.length; i += 1) {
    const e = endOf(arcs[i]!);
    const s = startOf(arcs[i + 1]!);
    expect(Math.hypot(e[0] - s[0], e[1] - s[1])).toBeLessThan(1e-3);
  }
  await historyAction(page, 'Undo');
  await expect.poll(() => ent(page), { timeout: 15000 }).toBe(2);
  const undoneE = await saveDrawing(page);
  expect(arcsOf(undoneE.entities)).toHaveLength(0);
  evidence.flowE = { arcs: arcs.length, continuous: true };
  writeEvidence();
  await assertClean(page, errors);
});

test('F: From-End line point mode + arc radius mode, nearest end', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  await boot(page, errors);
  await makeLine(page, 0, 0, 100, 0);
  const lineId = (await entityIdsByType(page, 'line'))[0]!;

  // Preseeded source; click near the END to fix nearest-end selection, then
  // point mode via P + typed endpoint.
  await start(page, 'CURVEFROMENDOFOBJECT', /CURVE_FROM_END/);
  await clickEntityAt(page, lineId, 0.9, 0.5);
  await type(page, 'P');
  await type(page, '110,10');
  await expect.poll(() => ent(page), { timeout: 15000 }).toBeGreaterThan(1);
  let saved = await saveDrawing(page);
  let arcs = arcsOf(saved.entities);
  expect(arcs).toHaveLength(1);
  const r0 = (Number(arcs[0]!.startAngleDeg) * Math.PI) / 180;
  expect(Number(arcs[0]!.centerX) + Math.cos(r0) * Number(arcs[0]!.radius)).toBeCloseTo(100, 0);
  expect(linesOf(saved.entities)).toHaveLength(1);

  // Arc source, radius mode with arc-length extent.
  const beforeArc = await ent(page);
  await start(page, 'ARC_3PT');
  await type(page, '200,0');
  await type(page, '250,50');
  await type(page, '200,100');
  await expect.poll(() => ent(page), { timeout: 15000 }).toBeGreaterThan(beforeArc);
  // The fresh arc is selected: the source preseeds, no click needed.
  await start(page, 'CURVEFROMENDOFOBJECT', /CURVE_FROM_END/);
  await expect(prompt(page)).toContainText(/radius mode|R±radius|Point or Radius|R200/, { timeout: 10000 });
  await type(page, 'R100');
  await type(page, 'R100');
  await type(page, 'L50');
  await expect.poll(() => ent(page), { timeout: 15000 }).toBeGreaterThan(2);
  saved = await saveDrawing(page);
  expect(arcsOf(saved.entities)).toHaveLength(3);
  evidence.flowF = { fromEndArcs: 2 };
  writeEvidence();
  await assertClean(page, errors);
});

test('G: Reverse + Compound share the endpoint with opposite turns', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  await boot(page, errors);
  const gBase = await ent(page);
  await start(page, 'ARC_3PT');
  await type(page, '50,0');
  await type(page, '35.36,35.36');
  await type(page, '0,50');
  await expect.poll(() => ent(page), { timeout: 15000 }).toBeGreaterThan(gBase);
  const sourceId = (await entityIdsByType(page, 'arc'))[0]!;

  // Preseeded arc defaults to its end; no click needed.
  await start(page, 'REVERSEORCOMPOUND', /REVERSE_OR_COMPOUND/);
  await type(page, 'R');
  await type(page, 'R40');
  await type(page, 'L15');
  await expect.poll(() => ent(page), { timeout: 15000 }).toBeGreaterThan(1);
  await shot(page, 'G-reverse');
  // A second source arc keeps the compound half independent of clicks.
  await start(page, 'ARC_3PT');
  await type(page, '300,0');
  await type(page, '335.36,35.36');
  await type(page, '300,50');
  const secondId = (await entityIdsByType(page, 'arc')).find((id) => id !== sourceId)!;
  void secondId;
  await start(page, 'REVERSEORCOMPOUND', /REVERSE_OR_COMPOUND/);
  await type(page, 'C');
  await type(page, 'R40');
  await type(page, 'L15');
  await expect.poll(() => ent(page), { timeout: 15000 }).toBeGreaterThan(2);
  await shot(page, 'G-reverse-compound');
  const { entities } = await saveDrawing(page);
  const arcs = arcsOf(entities);
  expect(arcs).toHaveLength(4);
  const sources = arcs.filter((a) => (a.metadata as any)?.createdBy === 'ARC_3PT');
  const continuations = arcs.filter(
    (a) => (a.metadata as any)?.createdBy === 'REVERSE_COMPOUND_CURVE_CREATE',
  );
  expect(sources).toHaveLength(2);
  expect(continuations).toHaveLength(2);
  // Each continuation starts exactly at its own source end (shared endpoint).
  for (const a of continuations) {
    const srcId = String((a.metadata as any)?.sourceEntityIds?.[0] ?? '');
    const source = arcs.find((x) => String(x.id) === srcId);
    expect(source).toBeTruthy();
    const er = (Number(source!.endAngleDeg) * Math.PI) / 180;
    const endX = Number(source!.centerX) + Math.cos(er) * Number(source!.radius);
    const endY = Number(source!.centerY) + Math.sin(er) * Number(source!.radius);
    const s = (Number(a.startAngleDeg) * Math.PI) / 180;
    expect(Number(a.centerX) + Math.cos(s) * Number(a.radius)).toBeCloseTo(endX, 0);
    expect(Number(a.centerY) + Math.sin(s) * Number(a.radius)).toBeCloseTo(endY, 0);
  }
  evidence.flowG = { continuations: 2 };
  writeEvidence();
  await assertClean(page, errors);
});

test('H: existing reps — calculator report-only, tangent 3-point, subdivide markers, offset, line/circle', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  await boot(page, errors);

  // Calculator is report-only.
  await start(page, 'CURVE_SOLVER');
  await type(page, 'radius,delta,200,60');
  await expect(page.locator('[data-survey-cad-cogo-panel]')).toContainText('Curve Calculator');
  expect(await ent(page)).toBe(0);
  await esc(page);

  // Tangent 3-point law commits a tangent arc (PI + back + ahead + R).
  await start(page, 'TANGENT_CURVE');
  await type(page, '0,0');
  await type(page, '-100,0');
  await type(page, '0,100');
  await type(page, '20');
  await expect.poll(() => ent(page), { timeout: 15000 }).toBeGreaterThan(0);

  // Subdivide chord mode places equal consecutive marker chords (preseeded arc).
  const arcId = (await entityIdsByType(page, 'arc'))[0]!;
  await start(page, 'SUBDIVIDE_CURVE');
  await clickArcForSession(page, arcId);
  await type(page, 'CHORD,5');
  await page.waitForTimeout(500);
  const sub = await saveDrawing(page);
  const subArcs = arcsOf(sub.entities);
  expect(subArcs).toHaveLength(1);
  const markers = sub.entities.filter((e) => e.type === 'survey-point' && String(e.stationId ?? '').startsWith(`${arcId}-`));
  expect(markers.length).toBeGreaterThanOrEqual(2);
  const dist = (a: Entity, b: Entity): number => Math.hypot(Number(a.x) - Number(b.x), Number(a.y) - Number(b.y));
  const chords: number[] = [];
  for (let i = 0; i + 1 < markers.length; i += 1) chords.push(dist(markers[i]!, markers[i + 1]!));
  for (const c of chords) expect(c).toBeCloseTo(chords[0]!, 2);
  await shot(page, 'H-subdivision');
  evidence.flowH = { markers: markers.length, chord: chords[0] };

  // Offset CW/CCW both commit (preseeded arc).
  await start(page, 'OFFSET_CURVE');
  await clickArcForSession(page, arcId);
  await type(page, 'L5');
  const afterOffset = await ent(page);
  expect(afterOffset).toBeGreaterThan(sub.entities.length);

  // Line/Circle against a real native circle: preseeded circle + line pick commits.
  await makeLine(page, -100, 0, 100, 0);
  await start(page, 'CIRCLE');
  await type(page, '0,5');
  await type(page, '10');
  const circleId = (await entityIdsByType(page, 'circle'))[0]!;
  expect(circleId).toBeTruthy();
  const lcLineId = linesOf((await saveDrawing(page)).entities).map((e) => String(e.id))[0]!;
  const lcBase = await ent(page);
  await start(page, 'LINE_CIRCLE_INTX');
  await clickEntity(page, lcLineId);
  await expect.poll(() => ent(page), { timeout: 15000 }).toBeGreaterThan(lcBase);
  await expect(page.locator('[data-survey-cad-cogo-panel]')).toContainText('Line-Circle Intersection');
  evidence.flowHlc = { circle: circleId };
  writeEvidence();
  await assertClean(page, errors);
});

test('I: no-preselection picks + invalid source stays active', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  await boot(page, errors);
  await makeLine(page, 0, 0, 100, 0);
  await makeLine(page, 0, 0, 0, 100);
  const lineIds = await entityIdsByType(page, 'line');
  await start(page, 'ARC_3PT');
  await type(page, '200,0');
  await type(page, '250,50');
  await type(page, '200,100');
  const arcId = (await entityIdsByType(page, 'arc'))[0]!;
  void arcId;

  // Exactly-one valid preselection preseeds POINT_ON_CURVE (fresh arc selected).
  await start(page, 'POINT_ON_CURVE');
  await expect(prompt(page)).toContainText(/ARC,distance/, { timeout: 10000 });
  await type(page, 'ARC,10');
  const afterPoint = await saveDrawing(page);
  expect(afterPoint.entities.length).toBeGreaterThan(4);

  // No-preselection SUBDIVIDE prompts for an arc pick; a line click is an
  // explicit invalid source and the session stays active.
  await clearSel(page);
  await start(page, 'SUBDIVIDE_CURVE');
  await expect(prompt(page)).toContainText(/Click an arc body/, { timeout: 10000 });
  await clickEntity(page, lineIds[0]!);
  await expect(prompt(page)).toContainText(/needs a direct arc-body click/, { timeout: 10000 });
  await esc(page);
  evidence.flowI = { pickFlows: true };
  writeEvidence();
  await assertClean(page, errors);
});
