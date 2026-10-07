/**
 * Phase C2 browser QA — PLINE Arc/Line/Width interaction (open finish,
 * mixed line+arc drafting, bulged close, width defaults, backstep
 * alignment, persistence/DXF seams). Production build, headless Chromium,
 * blank disposable drawings. Run:
 *   npx playwright test cad-draw-polyline-c2 --config=playwright.prod.config.ts
 *
 * Flows A–G. Evidence: PNGs + geometry.json under
 * docs/evidence/cad-polyline-c2/.
 *
 * Honest scope notes (verified against the working tree):
 * - Width bands are stored model data (metres, centred, tapered) and render
 *   in BOTH the draft preview (model-space edge guides) and the committed
 *   viewport (one aggregated filled band polygon). The browser assertions
 *   prove the rendered band area matches the committed band × viewport scale
 *   at two zoom levels.
 * - Curve rendering is proved on the DISPLAYED SVG arc path: the path
 *   midpoint rides off its chord in screen space, not just in saved
 *   metadata. Curve hit-testing clicks the rendered arc course (the same
 *   segment refs feed snaps); snap/intersection engines consume the
 *   identical committed bulge metadata asserted geometrically in Node.
 */
import { expect, test, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { parseCadDrawingFile } from '../src/engine/cad/cadDrawingFile';
import { describeParcelArcCourse } from '../src/engine/cad/cadParcelArcGeometry';
import { buildCadPolylineBandPoints } from '../src/engine/cad/cadPolylineCourses';
import { buildDxfExportModelWithResult } from '../src/engine/cad/dxf/dxfExportModel';

const SHOTS = 'docs/evidence/cad-polyline-c2';
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
    const bus = window as unknown as { __c2Rejections: string[] };
    bus.__c2Rejections = [];
    window.addEventListener('unhandledrejection', (e) => bus.__c2Rejections.push(String(e.reason)));
  });
  await page.goto('/cad', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('WebNet CAD', { exact: true }).first()).toBeVisible({ timeout: 30000 });
  await expect(page.locator('[data-cad-viewport]')).toBeVisible({ timeout: 30000 });
  const show = page.locator('button[title="Show ribbon"]');
  if (await show.isVisible().catch(() => false)) await show.click({ force: true });
  await expect(page.locator('[data-cad-ribbon]')).toBeVisible({ timeout: 10000 });
}
async function assertClean(page: Page, errors: string[]): Promise<void> {
  const rejections = await page.evaluate(() => (window as unknown as { __c2Rejections?: string[] }).__c2Rejections ?? []);
  expect(rejections).toEqual([]);
  expect(errors).toEqual([]);
}
const input = (page: Page) => page.locator('[data-cad-command-input]');
const prompt = (page: Page) => page.locator('[data-cad-command-prompt]');
async function ent(page: Page): Promise<number> {
  return Number.parseInt((await page.locator('[data-survey-cad-entity-count]').first().textContent()) ?? '0', 10);
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
async function saveDrawing(page: Page): Promise<{ entities: Entity[]; project: unknown }> {
  const dl = page.waitForEvent('download', { timeout: 30000 });
  await page.locator('[data-cad-quick-access] button[title="Save the drawing (WNCAD)"]').click({ force: true });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wn-c2-'));
  const file = path.join(dir, 'drawing.wncad');
  await (await dl).saveAs(file);
  const parsed = parseCadDrawingFile(fs.readFileSync(file, 'utf8'));
  if (!parsed.ok) throw new Error(`saved drawing did not parse: ${parsed.errors.join('; ')}`);
  return { entities: parsed.drawing.project.entities as Entity[], project: parsed.drawing.project };
}
const polylines = (ents: Entity[]) => ents.filter((e) => e.type === 'polyline');

const shoelaceArea = (points: Array<{ x: number; y: number }>): number => {
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const current = points[i]!;
    const next = points[(i + 1) % points.length]!;
    area += current.x * next.y - next.x * current.y;
  }
  return Math.abs(area) / 2;
};

test('A: straight C1 regression — open finish, dock Line options, undo/redo', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  await boot(page, errors);
  await start(page, 'PLINE');
  await type(page, '0,0');
  // Dock stays on the session path and advertises the C2 option set.
  await expect(prompt(page)).toContainText(/Line.*A.*Arc.*W.*Width/s, { timeout: 10000 });
  await type(page, '20,10');
  await type(page, 'N45-00-00E,20');
  await type(page, '');
  await expect(prompt(page)).toContainText('PLINE committed with 3 vertices.', { timeout: 10000 });
  await expect.poll(() => ent(page), { timeout: 15000 }).toBe(1);
  const geom = polylines((await saveDrawing(page)).entities);
  expect(geom).toHaveLength(1);
  expect(geom[0]!.closed).toBe(false);
  expect(geom[0]!.vertices).toHaveLength(3);
  expect('segmentGeometry' in geom[0]!).toBe(false);
  await historyAction(page, 'Undo');
  await expect.poll(() => ent(page), { timeout: 15000 }).toBe(0);
  await historyAction(page, 'Redo');
  await expect.poll(() => ent(page), { timeout: 15000 }).toBe(1);
  await shot(page, 'A-open-committed');
  evidence.flowA = { closed: geom[0]!.closed, vertices: geom[0]!.vertices };
  writeEvidence();
  await assertClean(page, errors);
});

test('B: mixed line+arc — dock Arc options, true curve, click-hit on the arc', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  await boot(page, errors);
  await start(page, 'PLINE');
  await type(page, '0,0');
  await type(page, '40,0');
  await type(page, 'A');
  // Arc mode is discoverable in the dock before any further pick.
  await expect(prompt(page)).toContainText(/Arc.*through-point/s, { timeout: 10000 });
  await type(page, '50,10');
  await expect(prompt(page)).toContainText(/arc end point/i, { timeout: 10000 });
  await shot(page, 'B-mixed-draft');
  await type(page, '60,0');
  await expect(prompt(page)).toContainText(/3 vertices captured/, { timeout: 10000 });
  await type(page, '');
  await expect.poll(() => ent(page), { timeout: 15000 }).toBe(1);
  await shot(page, 'B-committed-mixed');
  const { entities } = await saveDrawing(page);
  const geom = polylines(entities);
  expect(geom).toHaveLength(1);
  expect(geom[0]!.vertices).toHaveLength(3);
  expect(geom[0]!.segmentGeometry.map((entry: { kind: string }) => entry.kind)).toEqual(['line', 'arc']);
  // Off-chord proof on the committed metadata: the arc is a semicircle
  // (|bulge| = 1; CW here so the sign is negative) whose midpoint rides
  // 10 m off the chord.
  const arcEntry = geom[0]!.segmentGeometry[1] as { kind: 'arc'; bulge: number };
  expect(Math.abs(arcEntry.bulge)).toBeCloseTo(1, 9);
  const metrics = describeParcelArcCourse({ x: 40, y: 0 }, { x: 60, y: 0 }, arcEntry.bulge);
  expect(metrics).not.toBeNull();
  expect(metrics!.radius).toBeCloseTo(10, 6);
  expect(metrics!.midpoint.x).toBeCloseTo(50, 6);
  expect(metrics!.midpoint.y).toBeCloseTo(10, 6);
  const chordMid = { x: 50, y: 0 };
  const offChord = Math.hypot(metrics!.midpoint.x - chordMid.x, metrics!.midpoint.y - chordMid.y);
  expect(offChord).toBeCloseTo(10, 6);
  // The arc course renders as its own hittable segment node …
  const id = geom[0]!.id as string;
  await expect(page.locator(`[data-survey-cad-segment-id="${id}#1"]`)).toHaveCount(1, { timeout: 10000 });
  // … and the DISPLAYED curve — not just the saved metadata — is off its
  // chord: sample the rendered SVG path, not a recomputed model arc.
  const rendered = await page
    .locator(`path[data-survey-cad-render-entity-id="${id}"]`)
    .first()
    .evaluate((el) => {
      const path = el as SVGPathElement;
      const total = path.getTotalLength();
      const start = path.getPointAtLength(0);
      const end = path.getPointAtLength(total);
      const mid = path.getPointAtLength(total / 2);
      const chordMid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
      return {
        command: path.getAttribute('d') ?? '',
        chord: Math.hypot(end.x - start.x, end.y - start.y),
        offChord: Math.hypot(mid.x - chordMid.x, mid.y - chordMid.y),
      };
    });
  expect(rendered.command).toMatch(/[Aa]/);
  // A semicircle displays 10 m of rise over a 20 m chord: ratio 0.5.
  expect(rendered.offChord).toBeGreaterThan(rendered.chord * 0.4);
  // Deselect, then click the crown of the DISPLAYED arc (screen-transformed
  // path midpoint) so the polyline reselects through the same segment refs
  // that feed snaps.
  await page.getByRole('tab', { name: 'Home' }).click({ force: true });
  await page.locator('[data-cad-command="SHELL_CLEAR_SELECTION"]').click({ force: true });
  await expect.poll(() => selCount(page), { timeout: 10000 }).toBe(0);
  const crown = await page
    .locator(`path[data-survey-cad-render-entity-id="${id}"]`)
    .first()
    .evaluate((el) => {
      const path = el as SVGPathElement;
      const mid = path.getPointAtLength(path.getTotalLength() / 2);
      const ctm = path.getScreenCTM();
      const screen = ctm ? mid.matrixTransform(ctm) : { x: mid.x, y: mid.y };
      return { x: screen.x, y: screen.y };
    });
  await page.mouse.click(crown.x, crown.y);
  await expect.poll(() => selCount(page), { timeout: 10000 }).toBe(1);
  evidence.flowB = {
    segmentGeometry: geom[0]!.segmentGeometry,
    arcMidpoint: metrics!.midpoint,
    offChordMeters: offChord,
    renderedOffChordPixels: rendered.offChord,
    renderedChordPixels: rendered.chord,
  };
  writeEvidence();
  await assertClean(page, errors);
});

test('C: arc close — closed ring, no duplicate vertex, bulged closing course', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  await boot(page, errors);
  await start(page, 'PLINE');
  await type(page, 'A');
  await type(page, '0,0');
  await type(page, '10,-4');
  await type(page, '20,0');
  await type(page, '30,4');
  await type(page, '20,10');
  // Refusing Close without a pending through-point is truthful in Arc mode.
  await type(page, 'C');
  await expect(prompt(page)).toContainText(/arc-through point first/i, { timeout: 10000 });
  expect(await ent(page)).toBe(0);
  await type(page, '4,6');
  await type(page, 'C');
  await expect(prompt(page)).toContainText('PLINE closed with 3 vertices.', { timeout: 10000 });
  await expect.poll(() => ent(page), { timeout: 15000 }).toBe(1);
  const geom = polylines((await saveDrawing(page)).entities);
  expect(geom).toHaveLength(1);
  expect(geom[0]!.closed).toBe(true);
  expect(geom[0]!.vertices).toHaveLength(3);
  expect(geom[0]!.vertices[0]).not.toEqual(geom[0]!.vertices[2]);
  expect(geom[0]!.segmentGeometry).toHaveLength(3);
  expect(geom[0]!.segmentGeometry.every((g: { kind: string }) => g.kind === 'arc')).toBe(true);
  const closing = geom[0]!.segmentGeometry[2] as { kind: 'arc'; bulge: number };
  const closingMetrics = describeParcelArcCourse(
    geom[0]!.vertices[2] as { x: number; y: number },
    geom[0]!.vertices[0] as { x: number; y: number },
    closing.bulge,
  );
  expect(closingMetrics).not.toBeNull();
  await expect(page.locator(`[data-survey-cad-segment-id="${geom[0]!.id}#2"]`)).toHaveCount(1, { timeout: 10000 });
  await shot(page, 'C-curved-close');
  evidence.flowC = {
    closed: true,
    vertices: geom[0]!.vertices,
    closingBulge: closing.bulge,
    closingSweepDeg: closingMetrics!.signedSweepDeg,
  };
  writeEvidence();
  await assertClean(page, errors);
});

test('D: constant + tapered widths — draft edges, committed band fill, two zooms', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  await boot(page, errors);
  await start(page, 'PLINE');
  await type(page, '0,0');
  await type(page, 'W');
  await expect(prompt(page)).toContainText(/width/i, { timeout: 10000 });
  await type(page, '6');
  await type(page, '30,0');
  await type(page, 'W');
  await type(page, '2,8');
  await type(page, '30,20');
  await shot(page, 'D-width-draft');
  await type(page, '');
  await expect.poll(() => ent(page), { timeout: 15000 }).toBe(1);
  const geom = polylines((await saveDrawing(page)).entities);
  expect(geom).toHaveLength(1);
  expect(geom[0]!.segmentWidths).toEqual([
    { startWidth: 6, endWidth: 6 },
    { startWidth: 2, endWidth: 8 },
  ]);
  const id = geom[0]!.id as string;
  // Committed band polygon area (model space) drives the displayed proof.
  const modelBand = buildCadPolylineBandPoints(geom[0] as never)!;
  expect(modelBand.length).toBeGreaterThan(3);
  const modelBandArea = shoelaceArea(modelBand);
  const bandProof = async () => {
    const polygon = page.locator(`polygon[data-survey-cad-render-entity-id="${id}"]`);
    await expect(polygon).toHaveCount(1, { timeout: 10000 });
    expect(await polygon.getAttribute('fill')).not.toBe('none');
    const screenArea = await polygon.evaluate((el) => {
      const raw = (el.getAttribute('points') ?? '').trim();
      const points = raw.split(/\s+/).filter(Boolean).map((pair) => pair.split(',').map(Number));
      let area = 0;
      for (let i = 0; i < points.length; i += 1) {
        const [x1, y1] = points[i]!;
        const [x2, y2] = points[(i + 1) % points.length]!;
        area += x1! * y2! - x2! * y1!;
      }
      return Math.abs(area) / 2;
    });
    const segment = await page
      .locator(`line[data-survey-cad-segment-id="${id}#0"]`)
      .first()
      .evaluate((el) => ({
        x1: Number(el.getAttribute('x1')),
        y1: Number(el.getAttribute('y1')),
        x2: Number(el.getAttribute('x2')),
        y2: Number(el.getAttribute('y2')),
      }));
    const scale = Math.hypot(segment.x2 - segment.x1, segment.y2 - segment.y1) / 30;
    return { screenArea, scale, ratio: screenArea / (modelBandArea * scale * scale) };
  };
  const firstZoom = await bandProof();
  expect(firstZoom.ratio).toBeGreaterThan(0.98);
  expect(firstZoom.ratio).toBeLessThan(1.02);
  await shot(page, 'D-width-committed');
  // Zoom onto the band and re-prove the same committed geometry at a
  // different viewport scale.
  const viewport = page.locator('[data-cad-viewport] svg').first();
  const center = await viewport.boundingBox().then((box) => {
    if (!box) throw new Error('no viewport box');
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  });
  await page.mouse.move(center.x, center.y);
  await page.mouse.wheel(0, -600);
  await page.waitForTimeout(500);
  const secondZoom = await bandProof();
  expect(secondZoom.ratio).toBeGreaterThan(0.98);
  expect(secondZoom.ratio).toBeLessThan(1.02);
  expect(secondZoom.scale).toBeGreaterThan(firstZoom.scale);
  await shot(page, 'D-width-zoomed');
  evidence.flowD = {
    segmentWidths: geom[0]!.segmentWidths,
    modelBandArea,
    firstZoom,
    secondZoom,
  };
  writeEvidence();
  await assertClean(page, errors);
});

test('E: backstep alignment — pending clears first, then the arc course, commit stays aligned', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  await boot(page, errors);
  await start(page, 'PLINE');
  await type(page, '0,0');
  await type(page, 'A');
  await type(page, '10,-4');
  await type(page, '20,0');
  await type(page, 'L');
  await type(page, '20,20');
  await type(page, 'A');
  await type(page, '14,26');
  // U clears the pending through-point only: the prompt returns to the
  // through-point state and no vertex is lost.
  await type(page, 'U');
  await expect(prompt(page)).toContainText(/through-point/i, { timeout: 10000 });
  // U again removes the completed line course into (20,20) with its metadata.
  await type(page, 'U');
  await expect(prompt(page)).toContainText(/2 vertices captured/, { timeout: 10000 });
  await type(page, '');
  await expect.poll(() => ent(page), { timeout: 15000 }).toBe(1);
  const geom = polylines((await saveDrawing(page)).entities);
  expect(geom).toHaveLength(1);
  expect(geom[0]!.closed).toBe(false);
  expect(geom[0]!.vertices).toHaveLength(2);
  // Metadata stays course-aligned after the mixed backstep sequence: the
  // surviving course is the original arc leg.
  expect(geom[0]!.segmentGeometry).toHaveLength(1);
  expect(geom[0]!.segmentGeometry[0].kind).toBe('arc');
  expect('segmentWidths' in geom[0]!).toBe(false);
  await shot(page, 'E-backstep-aligned');
  evidence.flowE = {
    vertices: geom[0]!.vertices,
    segmentGeometry: geom[0]!.segmentGeometry,
  };
  writeEvidence();
  await assertClean(page, errors);
});

test('F: persistence + DXF seams carry the C2 metadata shape', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  await boot(page, errors);
  await start(page, 'PLINE');
  await type(page, 'A');
  await type(page, '0,0');
  await type(page, '10,-4');
  await type(page, '20,0');
  await type(page, 'W');
  await type(page, '1.5');
  await type(page, 'L');
  await type(page, '20,20');
  await type(page, '');
  await expect.poll(() => ent(page), { timeout: 15000 }).toBe(1);
  const { entities, project } = await saveDrawing(page);
  const geom = polylines(entities);
  expect(geom).toHaveLength(1);
  // WNCAD round-trips the bulge + width arrays verbatim.
  expect(geom[0]!.segmentGeometry).toEqual([
    { kind: 'arc', bulge: geom[0]!.segmentGeometry[0].bulge },
    { kind: 'line' },
  ]);
  expect(geom[0]!.segmentWidths).toEqual([
    { startWidth: 0, endWidth: 0 },
    { startWidth: 1.5, endWidth: 1.5 },
  ]);
  // The existing DXF seam exports the polyline without dropping the entity.
  const dxf = buildDxfExportModelWithResult({ project: project as never });
  expect(dxf.output.polylines.map((entry) => entry.sourceId)).toContain(geom[0]!.id);
  expect(dxf.omittedEntityIds).not.toContain(geom[0]!.id);
  evidence.flowF = {
    segmentGeometry: geom[0]!.segmentGeometry,
    segmentWidths: geom[0]!.segmentWidths,
    dxfExported: true,
  };
  writeEvidence();
  await assertClean(page, errors);
});

test('G: invalid width and degenerate arc keep the draft alive with no entity', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  await boot(page, errors);
  await start(page, 'PLINE');
  await type(page, '0,0');
  await type(page, 'W');
  await type(page, '-3');
  await expect(prompt(page)).toContainText(/width invalid/i, { timeout: 10000 });
  expect(await ent(page)).toBe(0);
  await esc(page);
  await start(page, 'PLINE');
  await type(page, 'A');
  await type(page, '0,0');
  await type(page, '10,0');
  await type(page, '20,0');
  await expect(prompt(page)).toContainText(/arc rejected/i, { timeout: 10000 });
  expect(await ent(page)).toBe(0);
  await esc(page);
  expect(await ent(page)).toBe(0);
  await shot(page, 'G-guards');
  writeEvidence();
  await assertClean(page, errors);
});
