/**
 * Phase C3 browser QA — polyline vertex insert/delete via grips, typed
 * commands, and Properties. Production build, headless Chromium, blank
 * disposable drawings. Run:
 *   npx playwright test cad-draw-polyline-c3 --config=playwright.prod.config.ts
 *
 * Flows A–J. Evidence: PNGs + geometry.json under
 * docs/evidence/cad-polyline-c3-vertex-editing/.
 *
 * Scope notes:
 * - Insert grips are secondary hollow diamonds (`polyline-insert`); vertex
 *   grips stay solid `vertex` circles. Grip drag-release projects the cursor
 *   back onto the ORIGINAL course, so the committed vertex always rides the
 *   original line/arc (proved from the saved drawing, not the DOM alone).
 * - Delete/insert are count-changing engine transactions: one history entry
 *   each, zero mutation on refusal.
 */
import { expect, test, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { parseCadDrawingFile } from '../src/engine/cad/cadDrawingFile';
import { describeParcelArcCourse } from '../src/engine/cad/cadParcelArcGeometry';

const SHOTS = 'docs/evidence/cad-polyline-c3-vertex-editing';
fs.mkdirSync(SHOTS, { recursive: true });
const evidence: Record<string, unknown> = {};
const writeEvidence = (): void => {
  fs.writeFileSync(`${SHOTS}/geometry.json`, JSON.stringify(evidence, null, 2));
};

type Entity = Record<string, any>;

async function boot(page: Page, errors: string[]): Promise<void> {
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('dialog', (d) => {
    if (d.type() === 'confirm') void d.accept();
    else void d.dismiss().catch(() => undefined);
  });
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    delete w.showSaveFilePicker;
    delete w.showOpenFilePicker;
    const bus = window as unknown as { __c3Rejections: string[] };
    bus.__c3Rejections = [];
    window.addEventListener('unhandledrejection', (e) => bus.__c3Rejections.push(String(e.reason)));
  });
  await page.goto('/cad', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('WebNet CAD', { exact: true }).first()).toBeVisible({ timeout: 30000 });
  await expect(page.locator('[data-cad-viewport]')).toBeVisible({ timeout: 30000 });
  const show = page.locator('button[title="Show ribbon"]');
  if (await show.isVisible().catch(() => false)) await show.click({ force: true });
  await expect(page.locator('[data-cad-ribbon]')).toBeVisible({ timeout: 10000 });
}
async function assertClean(page: Page, errors: string[]): Promise<void> {
  const rejections = await page.evaluate(
    () => (window as unknown as { __c3Rejections?: string[] }).__c3Rejections ?? [],
  );
  expect(rejections).toEqual([]);
  expect(errors).toEqual([]);
}
const input = (page: Page) => page.locator('[data-cad-command-input]');
const prompt = (page: Page) => page.locator('[data-cad-command-prompt]');
async function ent(page: Page): Promise<number> {
  return Number.parseInt(
    (await page.locator('[data-survey-cad-entity-count]').first().textContent()) ?? '0',
    10,
  );
}
async function selCount(page: Page): Promise<number> {
  const text = (await page.locator('[data-survey-cad-selection-count]').first().textContent()) ?? '0 selected';
  return Number.parseInt(text, 10);
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
async function historyAction(page: Page, label: 'Undo' | 'Redo'): Promise<void> {
  await page.getByRole('button', { name: 'Edit', exact: true }).click({ force: true });
  await page.getByRole('menuitem', { name: label }).click({ force: true });
}
async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}
async function saveDrawing(page: Page): Promise<{ entities: Entity[]; project: unknown }> {
  const dl = page.waitForEvent('download', { timeout: 30000 });
  await page
    .locator('[data-cad-quick-access] button[title="Save the drawing (WNCAD)"]')
    .click({ force: true });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wn-c3-'));
  const file = path.join(dir, 'drawing.wncad');
  await (await dl).saveAs(file);
  const parsed = parseCadDrawingFile(fs.readFileSync(file, 'utf8'));
  if (!parsed.ok) throw new Error(`saved drawing did not parse: ${parsed.errors.join('; ')}`);
  return { entities: parsed.drawing.project.entities as Entity[], project: parsed.drawing.project };
}
const polylines = (ents: Entity[]) => ents.filter((e) => e.type === 'polyline');

async function gripCount(page: Page): Promise<number> {
  return page.locator('[data-survey-cad-grip-handle]').count();
}
async function insertGripCount(page: Page): Promise<number> {
  return page.locator('[data-survey-cad-grip-handle="polyline-insert"]').count();
}
async function dragGrip(page: Page, index: number, dx: number, dy: number): Promise<void> {
  const grip = page.locator('[data-survey-cad-grip-handle="polyline-insert"]').nth(index);
  await expect(grip).toBeVisible({ timeout: 10000 });
  const box = await grip.boundingBox();
  if (!box) throw new Error('insert grip has no bounding box');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + dx, cy + dy, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(250);
}
async function showProperties(page: Page): Promise<void> {
  if (await page.locator('[data-cad-properties]').isVisible().catch(() => false)) return;
  await page.getByRole('button', { name: 'View', exact: true }).click();
  const item = page.locator('[role="menu"][aria-label="View"] [role="menuitem"]', {
    hasText: 'Properties:',
  });
  if (((await item.textContent()) ?? '').includes('Hidden')) await item.click();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-cad-properties]')).toBeVisible({ timeout: 10000 });
}

test('A: straight insert via grip projects onto the course + undo/redo', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  await boot(page, errors);
  await start(page, 'PLINE');
  await type(page, '0,0');
  await type(page, '20,0');
  await type(page, '20,20');
  await type(page, '');
  await expect.poll(() => ent(page), { timeout: 15000 }).toBe(1);
  await expect.poll(() => selCount(page), { timeout: 10000 }).toBe(1);
  // Open N=3: 3 vertex grips + 2 insert grips.
  await expect.poll(() => gripCount(page), { timeout: 10000 }).toBe(5);
  await expect.poll(() => insertGripCount(page), { timeout: 10000 }).toBe(2);
  await shot(page, 'A-mixed-grips');
  await dragGrip(page, 0, 70, 0);
  const geom = polylines((await saveDrawing(page)).entities);
  expect(geom).toHaveLength(1);
  expect(geom[0]!.vertices).toHaveLength(4);
  const inserted = geom[0]!.vertices[1] as { x: number; y: number };
  // Projected exactly onto the original course y=0, strictly interior.
  expect(inserted.y).toBeCloseTo(0, 6);
  expect(inserted.x).toBeGreaterThan(0);
  expect(inserted.x).toBeLessThan(20);
  evidence.flowA = { vertices: geom[0]!.vertices };
  await historyAction(page, 'Undo');
  expect(polylines((await saveDrawing(page)).entities)[0]!.vertices).toHaveLength(3);
  await historyAction(page, 'Redo');
  expect(polylines((await saveDrawing(page)).entities)[0]!.vertices).toHaveLength(4);
  await shot(page, 'A-undo-redo');
  writeEvidence();
  await assertClean(page, errors);
});

test('B: arc insert splits 1 arc into 2 coincident arcs (same circle)', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  await boot(page, errors);
  await start(page, 'PLINE');
  await type(page, 'A');
  await type(page, '0,0');
  await type(page, '10,-4');
  await type(page, '20,0');
  await type(page, '');
  await expect.poll(() => ent(page), { timeout: 15000 }).toBe(1);
  const before = polylines((await saveDrawing(page)).entities)[0]!;
  expect(before.segmentGeometry).toHaveLength(1);
  const parentMetrics = describeParcelArcCourse(before.vertices[0], before.vertices[1], before.segmentGeometry[0].bulge)!;
  await expect.poll(() => insertGripCount(page), { timeout: 10000 }).toBe(1);
  await dragGrip(page, 0, 40, 0);
  const after = polylines((await saveDrawing(page)).entities)[0]!;
  expect(after.vertices).toHaveLength(3);
  expect(after.segmentGeometry).toHaveLength(2);
  expect(after.segmentGeometry.every((entry: { kind: string }) => entry.kind === 'arc')).toBe(true);
  for (let index = 0; index < 2; index += 1) {
    const metrics = describeParcelArcCourse(
      after.vertices[index],
      after.vertices[index + 1],
      after.segmentGeometry[index].bulge,
    )!;
    // Same circle as the parent arc.
    expect(metrics.radius).toBeCloseTo(parentMetrics.radius, 4);
    expect(Math.hypot(metrics.center.x - parentMetrics.center.x, metrics.center.y - parentMetrics.center.y)).toBeLessThan(1e-3);
  }
  evidence.flowB = {
    before: before.segmentGeometry,
    after: after.segmentGeometry,
    vertices: after.vertices,
  };
  await shot(page, 'B-arc-insert');
  writeEvidence();
  await assertClean(page, errors);
});

test('C: tapered width insert interpolates the split width pair', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  await boot(page, errors);
  await start(page, 'PLINE');
  await type(page, '0,0');
  await type(page, 'W');
  await type(page, '2,8');
  await type(page, '20,0');
  await type(page, '');
  await expect.poll(() => ent(page), { timeout: 15000 }).toBe(1);
  await start(page, 'PLINEINSERTVERTEX');
  await type(page, 'C1');
  const geom = polylines((await saveDrawing(page)).entities)[0]!;
  expect(geom.vertices).toHaveLength(3);
  expect(geom.segmentWidths).toHaveLength(2);
  expect(geom.segmentWidths[0]).toEqual({ startWidth: 2, endWidth: 5 });
  expect(geom.segmentWidths[1]).toEqual({ startWidth: 5, endWidth: 8 });
  evidence.flowC = { segmentWidths: geom.segmentWidths, vertices: geom.vertices };
  writeEvidence();
  await assertClean(page, errors);
});

test('D: open interior delete via command + undo/redo', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  await boot(page, errors);
  await start(page, 'PLINE');
  await type(page, '0,0');
  await type(page, '10,0');
  await type(page, '10,10');
  await type(page, '0,10');
  await type(page, '');
  await expect.poll(() => ent(page), { timeout: 15000 }).toBe(1);
  await start(page, 'PLINEDELETEVERTEX');
  await type(page, 'V2');
  let geom = polylines((await saveDrawing(page)).entities)[0]!;
  expect(geom.vertices).toEqual([
    { x: 0, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ]);
  await historyAction(page, 'Undo');
  expect(polylines((await saveDrawing(page)).entities)[0]!.vertices).toHaveLength(4);
  await historyAction(page, 'Redo');
  geom = polylines((await saveDrawing(page)).entities)[0]!;
  expect(geom.vertices).toHaveLength(3);
  evidence.flowD = { vertices: geom.vertices };
  writeEvidence();
  await assertClean(page, errors);
});

test('E: closed legal delete keeps a closed ring with no duplicate closure vertex', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  await boot(page, errors);
  await start(page, 'PLINE');
  await type(page, '0,0');
  await type(page, '10,0');
  await type(page, '10,10');
  await type(page, '0,10');
  await type(page, 'C');
  await expect(prompt(page)).toContainText(/closed with 4 vertices/i, { timeout: 10000 });
  await expect.poll(() => ent(page), { timeout: 15000 }).toBe(1);
  await start(page, 'PLINEDELETEVERTEX');
  await type(page, 'V2');
  const geom = polylines((await saveDrawing(page)).entities)[0]!;
  expect(geom.closed).toBe(true);
  expect(geom.vertices).toHaveLength(3);
  expect(geom.vertices[0]).not.toEqual(geom.vertices[2]);
  evidence.flowE = { vertices: geom.vertices, closed: geom.closed };
  writeEvidence();
  await assertClean(page, errors);
});

test('F: mixed line+arc vertex delete refuses with zero mutation', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  await boot(page, errors);
  await start(page, 'PLINE');
  await type(page, '0,0');
  await type(page, '20,0');
  await type(page, 'A');
  await type(page, '30,10');
  await type(page, '40,0');
  await type(page, '');
  await expect.poll(() => ent(page), { timeout: 15000 }).toBe(1);
  const before = polylines((await saveDrawing(page)).entities)[0]!;
  expect(before.segmentGeometry.map((entry: { kind: string }) => entry.kind)).toEqual(['line', 'arc']);
  await start(page, 'PLINEDELETEVERTEX');
  await type(page, 'V2');
  const after = polylines((await saveDrawing(page)).entities)[0]!;
  expect(after.vertices).toEqual(before.vertices);
  expect(after.segmentGeometry).toEqual(before.segmentGeometry);
  await shot(page, 'F-safe-refusal');
  evidence.flowF = { vertices: after.vertices };
  writeEvidence();
  await assertClean(page, errors);
});

test('G: same-circle arc+arc merge succeeds on delete', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  await boot(page, errors);
  // One semicircle, split by an arc insert, then merged back by deleting the
  // inserted vertex. Both sub-arcs are guaranteed same-circle by the insert
  // topology, so this proves the merge seam without fragile 3-point inputs.
  await start(page, 'PLINE');
  await type(page, 'A');
  await type(page, '0,0');
  await type(page, '10,10');
  await type(page, '20,0');
  await type(page, '');
  await expect.poll(() => ent(page), { timeout: 15000 }).toBe(1);
  const parent = polylines((await saveDrawing(page)).entities)[0]!;
  expect(parent.vertices).toHaveLength(2);
  expect(parent.segmentGeometry).toHaveLength(1);
  await start(page, 'PLINEINSERTVERTEX');
  await type(page, 'C1');
  const split = polylines((await saveDrawing(page)).entities)[0]!;
  expect(split.vertices).toHaveLength(3);
  expect(split.segmentGeometry).toHaveLength(2);
  expect(split.segmentGeometry.every((entry: { kind: string }) => entry.kind === 'arc')).toBe(true);
  const first = describeParcelArcCourse(split.vertices[0], split.vertices[1], split.segmentGeometry[0].bulge)!;
  const second = describeParcelArcCourse(split.vertices[1], split.vertices[2], split.segmentGeometry[1].bulge)!;
  expect(Math.hypot(first.center.x - second.center.x, first.center.y - second.center.y)).toBeLessThan(1e-3);
  expect(first.radius).toBeCloseTo(second.radius, 4);
  await start(page, 'PLINEDELETEVERTEX');
  await type(page, 'V2');
  const after = polylines((await saveDrawing(page)).entities)[0]!;
  expect(after.vertices).toHaveLength(2);
  expect(after.segmentGeometry).toHaveLength(1);
  expect(after.segmentGeometry[0].kind).toBe('arc');
  const single = describeParcelArcCourse(after.vertices[0], after.vertices[1], after.segmentGeometry[0].bulge)!;
  expect(single.radius).toBeCloseTo(first.radius, 4);
  evidence.flowG = { vertices: after.vertices, geometry: after.segmentGeometry };
  writeEvidence();
  await assertClean(page, errors);
});

test('H: Properties actions refresh immediately + disabled reason for unsafe delete', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  await boot(page, errors);
  await start(page, 'PLINE');
  await type(page, '0,0');
  await type(page, '20,0');
  await type(page, '');
  await expect.poll(() => ent(page), { timeout: 15000 }).toBe(1);
  await showProperties(page);
  const props = page.locator('[data-cad-properties]');
  const deletes = props.locator('[data-cad-properties-action^="polyline-delete-vertex:"]');
  await expect(deletes).toHaveCount(2, { timeout: 10000 });
  // Min-count delete is disabled with the reason as the title.
  await expect(deletes.first()).toBeDisabled();
  expect(await deletes.first().getAttribute('title')).toMatch(/retained vertices/i);
  await shot(page, 'H-properties-actions');
  // Insert Vertex refreshes immediately: 2 vertices -> 3.
  const insert = props.locator('[data-cad-properties-action^="polyline-insert-vertex:"]').first();
  await expect(insert).toBeEnabled();
  await insert.click();
  await expect
    .poll(async () => polylines((await saveDrawing(page)).entities)[0]!.vertices.length, {
      timeout: 15000,
    })
    .toBe(3);
  evidence.flowH = { verticesAfterInsert: polylines((await saveDrawing(page)).entities)[0]!.vertices };
  writeEvidence();
  await assertClean(page, errors);
});

test('I: repeated topology edits keep course arrays aligned (no stale indices)', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  await boot(page, errors);
  await start(page, 'PLINE');
  await type(page, '0,0');
  await type(page, 'W');
  await type(page, '1,3');
  await type(page, '20,0');
  await type(page, 'A');
  await type(page, '30,10');
  await type(page, '40,0');
  await type(page, '');
  await expect.poll(() => ent(page), { timeout: 15000 }).toBe(1);
  // Insert on course 0, then insert again on the new course 1, then delete an
  // interior vertex — each step must keep geometry/width arrays aligned.
  await start(page, 'PLINEINSERTVERTEX');
  await type(page, 'C1');
  await start(page, 'PLINEINSERTVERTEX');
  await type(page, 'C2');
  let geom = polylines((await saveDrawing(page)).entities)[0]!;
  const courseCount = geom.closed ? geom.vertices.length : geom.vertices.length - 1;
  expect(geom.segmentGeometry).toHaveLength(courseCount);
  expect(geom.segmentWidths).toHaveLength(courseCount);
  await start(page, 'PLINEDELETEVERTEX');
  await type(page, 'V2');
  geom = polylines((await saveDrawing(page)).entities)[0]!;
  const nextCourseCount = geom.closed ? geom.vertices.length : geom.vertices.length - 1;
  expect(geom.segmentGeometry).toHaveLength(nextCourseCount);
  expect(geom.segmentWidths).toHaveLength(nextCourseCount);
  await showProperties(page);
  const props = page.locator('[data-cad-properties]');
  await expect(props.locator('[data-cad-properties-action^="polyline-delete-vertex:"]')).toHaveCount(
    geom.vertices.length,
    { timeout: 10000 },
  );
  evidence.flowI = {
    vertices: geom.vertices.length,
    courses: nextCourseCount,
    geometry: geom.segmentGeometry,
    widths: geom.segmentWidths,
  };
  writeEvidence();
  await assertClean(page, errors);
});

test('J: undo restores the exact pre-edit project across insert+delete', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  await boot(page, errors);
  await start(page, 'PLINE');
  await type(page, '0,0');
  await type(page, '20,0');
  await type(page, '20,20');
  await type(page, '');
  await expect.poll(() => ent(page), { timeout: 15000 }).toBe(1);
  const before = polylines((await saveDrawing(page)).entities)[0]!;
  await start(page, 'PLINEINSERTVERTEX');
  await type(page, 'C1');
  await start(page, 'PLINEDELETEVERTEX');
  await type(page, 'V2');
  const edited = polylines((await saveDrawing(page)).entities)[0]!;
  expect(edited.vertices).toHaveLength(3);
  await historyAction(page, 'Undo');
  await historyAction(page, 'Undo');
  const restored = polylines((await saveDrawing(page)).entities)[0]!;
  expect(restored.vertices).toEqual(before.vertices);
  expect(restored.segmentGeometry ?? null).toEqual(before.segmentGeometry ?? null);
  evidence.flowJ = { restored: restored.vertices };
  writeEvidence();
  await assertClean(page, errors);
});
