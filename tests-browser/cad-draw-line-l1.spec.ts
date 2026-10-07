/**
 * CAD Draw Phase L1 browser QA — the 16 Line-creation modes + the 17-live
 * Line ribbon family.
 *
 * Production build, headless Chromium, disposable drawings. Run:
 *   npx playwright test cad-draw-line-l1 --config=playwright.prod.config.ts
 *
 * Flows A–F: ribbon truth (17 live rows + icons), sticky/typed/reset laws,
 * NE asymmetry, CRS fail-closed + CRS success (source-bridge import),
 * point range/name, bearing/azimuth/angle/deflection/side-shot,
 * extension-in-place / from-end / perpendicular, dock echo + idle
 * autocomplete, undo/redo, zero page/console/unhandled errors.
 * Evidence: PNGs + geometry.json under docs/evidence/cad-line-l1/.
 */
import { expect, test, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { parseCadDrawingFile } from '../src/engine/cad/cadDrawingFile';

const SHOTS = 'docs/evidence/cad-line-l1';
fs.mkdirSync(SHOTS, { recursive: true });
const evidence: Record<string, unknown> = {};
const writeEvidence = (): void => {
  fs.writeFileSync(`${SHOTS}/geometry.json`, JSON.stringify(evidence, null, 2));
};

type Entity = Record<string, any>;

const VARIANT_ROWS: ReadonlyArray<readonly [string, string, string]> = [
  ['line-create', 'LINE', 'draw-line'],
  ['line-by-point-range', 'LINE_POINT_RANGE', 'draw-line-point-range'],
  ['line-by-point-object', 'LINE_POINT_OBJECT', 'draw-line-point-object'],
  ['line-by-point-name', 'LINE_POINT_NAME', 'draw-line-point-name'],
  ['line-by-northing-easting', 'LINE_NE', 'draw-line-northing-easting'],
  ['line-by-grid-ne', 'LINE_GRID_NE', 'draw-line-grid-ne'],
  ['line-by-lat-long', 'LINE_LATLONG', 'draw-line-lat-long'],
  ['line-by-bearing', 'LINE_BEARING', 'draw-line-bearing'],
  ['line-by-azimuth', 'LINE_AZIMUTH', 'draw-line-azimuth'],
  ['line-by-angle', 'LINE_ANGLE', 'draw-line-angle'],
  ['line-by-deflection', 'LINE_DEFLECTION', 'draw-line-deflection'],
  ['line-by-station-offset', 'LINE_STATION_OFFSET', 'draw-line-station-offset'],
  ['line-by-side-shot', 'LINE_SIDE_SHOT', 'draw-line-side-shot'],
  ['line-by-extension', 'LINE_EXTENSION', 'draw-line-extension'],
  ['line-from-end-of-object', 'LINE_FROM_END', 'draw-line-from-end'],
  ['line-tangent-from-point', 'LINE_TANGENT_POINT', 'draw-line-tangent-point'],
  ['line-perpendicular-from-point', 'LINE_PERP_POINT', 'draw-line-perp-point'],
];

async function boot(page: Page, errors: string[]): Promise<void> {
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('dialog', (d) => { void d.accept().catch(() => undefined); });
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    delete w.showSaveFilePicker; delete w.showOpenFilePicker;
    const bus = window as unknown as { __l1Rejections: string[] };
    bus.__l1Rejections = [];
    window.addEventListener('unhandledrejection', (e) => bus.__l1Rejections.push(String(e.reason)));
  });
  await page.goto('/cad', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('WebNet CAD', { exact: true }).first()).toBeVisible({ timeout: 30000 });
  await expect(page.locator('[data-cad-viewport]')).toBeVisible({ timeout: 30000 });
  const show = page.locator('button[title="Show ribbon"]');
  if (await show.isVisible().catch(() => false)) await show.click({ force: true });
  await expect(page.locator('[data-cad-ribbon]')).toBeVisible({ timeout: 10000 });
}
async function assertClean(page: Page, errors: string[]): Promise<void> {
  const rejections = await page.evaluate(() => (window as unknown as { __l1Rejections?: string[] }).__l1Rejections ?? []);
  expect(rejections).toEqual([]);
  expect(errors).toEqual([]);
}
const input = (page: Page) => page.locator('[data-cad-command-input]');
const prompt = (page: Page) => page.locator('[data-cad-command-prompt]');
const face = (page: Page) => page.locator('[data-cad-family="line"] .cad-ribbon-split__primary').first();
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
  await expect(prompt(page)).not.toContainText('Unknown command', { timeout: 10000 });
  await expect(prompt(page)).toContainText(/active/i, { timeout: 10000 });
}
async function esc(page: Page): Promise<void> {
  await input(page).focus();
  await input(page).press('Escape');
  await page.waitForTimeout(80);
}
async function historyAction(page: Page, label: 'Undo' | 'Redo'): Promise<void> {
  await page.getByRole('button', { name: 'Edit', exact: true }).click({ force: true });
  await page.getByRole('menuitem', { name: label }).click({ force: true });
}
async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}
async function saveEntities(page: Page): Promise<Entity[]> {
  const dl = page.waitForEvent('download', { timeout: 30000 });
  await page.locator('[data-cad-quick-access] button[title="Save the drawing (WNCAD)"]').click({ force: true });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wn-l1-'));
  const file = path.join(dir, 'drawing.wncad');
  await (await dl).saveAs(file);
  const parsed = parseCadDrawingFile(fs.readFileSync(file, 'utf8'));
  if (!parsed.ok) throw new Error(`saved drawing did not parse: ${parsed.errors.join('; ')}`);
  return parsed.drawing.project.entities as Entity[];
}
const lines = (ents: Entity[]) => ents.filter((e) => e.type === 'line');
const lineGeom = (ents: Entity[]) =>
  lines(ents).map((e) => ({ id: e.id, fromX: e.fromX, fromY: e.fromY, toX: e.toX, toY: e.toY, createdBy: e.metadata?.createdBy ?? null }));

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
async function clickLineAt(page: Page, index: number, t: number): Promise<void> {
  const line = page.locator('[data-survey-cad-hit-target="true"]').nth(index);
  const a = await line.evaluate((el) => ({
    x1: Number(el.getAttribute('x1')), y1: Number(el.getAttribute('y1')),
    x2: Number(el.getAttribute('x2')), y2: Number(el.getAttribute('y2')),
  }));
  const pt = await svgViewToClient(page, a.x1 + t * (a.x2 - a.x1), a.y1 + t * (a.y2 - a.y1));
  await page.mouse.click(pt.x, pt.y);
}
/** Click an arbitrary viewBox coordinate (free picks off an entity). */
async function clickView(page: Page, vx: number, vy: number): Promise<void> {
  const pt = await svgViewToClient(page, vx, vy);
  await page.mouse.click(pt.x, pt.y);
}
async function drawLine(page: Page, a: string, b: string): Promise<void> {
  await start(page, 'LINE');
  await type(page, a);
  await type(page, b);
  await expect(input(page)).toHaveValue('', { timeout: 5000 });
}

/** Seed a published adjustment source (numeric stations + CRS) and import it. */
async function bootWithSource(page: Page, errors: string[], options: { crsId: string }): Promise<void> {
  await boot(page, errors);
  // Station XY are genuine CA_NAD83_CSRS_UTM_20N grid coordinates (projections
  // of 45,-75 / 45.01,-75 / 45.02,-75.02), so the imported drawing's XY really
  // IS the grid the CRS names — not local (0,0)-(100,100) relabelled.
  const stations: Record<string, { x: number; y: number; h: number; fixed: boolean }> = {
    '1': { x: -445748.66307161003, y: 5053500.026238931, h: 0, fixed: true },
    '2': { x: -445581.70718193986, y: 5054610.662742255, h: 0, fixed: false },
    '3': { x: -446990.12387401506, y: 5055958.379245737, h: 0, fixed: false },
  };
  const snapshot = {
    schemaVersion: 1,
    sourceId: 'cad-src:proj-l1:fp-l1',
    projectId: 'proj-l1',
    projectName: 'L1 QA',
    runMode: 'adjustment',
    appliedRunIdentity: {
      inputFingerprint: 'in-l1', mathFingerprint: 'math-l1', exclusionFingerprint: 'ex-l1', runMode: 'adjustment',
    },
    resultFingerprint: 'fp-l1',
    generatedAt: '2026-10-06T00:00:00.000Z',
    coordinateContext: { units: 'm', crsId: options.crsId, crsLabel: options.crsId },
    stations,
    stationCount: 3,
  };
  await page.addInitScript((payload) => {
    window.localStorage.setItem('webnet.cad-source-snapshots.v1', JSON.stringify({ [payload.snapshot.sourceId]: payload.snapshot }));
    window.localStorage.setItem('webnet.cad-source-registry.v1', JSON.stringify({
      [payload.snapshot.projectId]: {
        latestSourceId: payload.snapshot.sourceId,
        projectId: payload.snapshot.projectId,
        projectName: payload.snapshot.projectName,
        generatedAt: payload.snapshot.generatedAt,
        resultFingerprint: payload.snapshot.resultFingerprint,
        stationCount: payload.snapshot.stationCount,
        appliedRunIdentity: payload.snapshot.appliedRunIdentity,
      },
    }));
  }, { snapshot });
  await page.goto(`/cad?source=${encodeURIComponent(snapshot.sourceId)}`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-cad-pending-source]')).toBeVisible({ timeout: 30000 });
  await page.getByRole('button', { name: 'Import / Refresh' }).click({ force: true });
  await expect.poll(() => ent(page), { timeout: 15000 }).toBeGreaterThanOrEqual(3);
}

test('A: 17 live Line rows with icons; sticky follows; typed does not change sticky', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  await boot(page, errors);
  await page.locator('[data-cad-family-caret="line"]').click({ force: true });
  const fly = page.locator('[data-cad-ribbon-flyout="line"]');
  await expect(fly).toBeVisible({ timeout: 5000 });
  expect(await fly.locator('[data-cad-variant]').count()).toBe(17);
  expect(await fly.locator('[data-cad-variant][aria-disabled="true"]').count()).toBe(0);
  const srcs: string[] = [];
  for (const [id, command, icon] of VARIANT_ROWS) {
    const row = fly.locator(`[data-cad-variant="${id}"]`);
    await expect(row).toHaveAttribute('data-cad-command', command);
    const img = row.locator('img');
    expect(await img.count()).toBe(1);
    srcs.push((await img.getAttribute('src')) ?? '');
    void icon;
  }
  expect(new Set(srcs).size).toBe(17);
  await shot(page, 'A-line-flyout-17-live');
  await page.keyboard.press('Escape');
  evidence.flowA = { rows: 17, distinctIcons: new Set(srcs).size, planned: 0 };

  // Sticky: choosing a row moves the face.
  await page.locator('[data-cad-family-caret="line"]').click({ force: true });
  await expect(fly).toBeVisible({ timeout: 5000 });
  await fly.locator('[data-cad-variant="line-by-bearing"]').click({ force: true });
  await expect(face(page)).toHaveAttribute('data-cad-command', 'LINE_BEARING');
  await expect(face(page)).toHaveAttribute('data-cad-ribbon-icon', 'draw-line-bearing');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);

  // Typed LINE_* starts the session but does NOT change the sticky face.
  await start(page, 'LINE_NE');
  await expect(face(page)).toHaveAttribute('data-cad-command', 'LINE_BEARING');
  await esc(page);
  await shot(page, 'A-sticky-after-typed');
  writeEvidence();
  await assertClean(page, errors);
});

test('B: LINE_NE is asymmetric (N first); dock echo; undo/redo', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  await boot(page, errors);
  const before = await ent(page);
  await start(page, 'LINE_NE');
  await expect(prompt(page)).toContainText(/Northing\/Easting/i);
  await type(page, '0,0');
  await type(page, '100,50');
  await type(page, '');
  await expect.poll(() => ent(page), { timeout: 15000 }).toBe(before + 1);
  await shot(page, 'B-ne-committed');
  const geom = lineGeom(await saveEntities(page));
  const created = geom.find((e) => e.createdBy === 'LINE_NE')!;
  expect(created).toBeTruthy();
  expect({ fromX: created.fromX, fromY: created.fromY, toX: created.toX, toY: created.toY }).toEqual({
    fromX: 0, fromY: 0, toX: 50, toY: 100,
  });
  evidence.flowB = created;
  await historyAction(page, 'Undo');
  await expect.poll(() => ent(page), { timeout: 15000 }).toBe(before);
  await historyAction(page, 'Redo');
  await expect.poll(() => ent(page), { timeout: 15000 }).toBe(before + 1);
  writeEvidence();
  await assertClean(page, errors);
});

test('C: GRID_NE/LATLONG fail closed without CRS; succeed after a source import', async ({ page }) => {
  test.setTimeout(150_000);
  const blankErrors: string[] = [];
  await boot(page, blankErrors);
  const before = await ent(page);
  await start(page, 'LINE_GRID_NE');
  await type(page, '500000,5000000');
  await expect(prompt(page)).toContainText(/grid/i);
  expect(await ent(page)).toBe(before);
  await esc(page);
  await start(page, 'LINE_LATLONG');
  await type(page, '45,-75');
  await expect(prompt(page)).toContainText(/grid/i);
  expect(await ent(page)).toBe(before);
  await esc(page);
  await shot(page, 'C-crs-refusal');
  evidence.flowC = { refusalOk: true };
  await assertClean(page, blankErrors);

  const errors: string[] = [];
  await bootWithSource(page, errors, { crsId: 'CA_NAD83_CSRS_UTM_20N' });
  const base = await ent(page);
  // GRID_NE is Northing,Easting: use the exact grid coords of imported stations
  // 1 and 2 (also the projection of the LATLONG points below).
  await start(page, 'LINE_GRID_NE');
  await type(page, '5053500.026238931,-445748.66307161');
  await type(page, '5054610.662742255,-445581.70718193986');
  await type(page, '');
  await expect.poll(() => ent(page), { timeout: 15000 }).toBe(base + 1);
  await start(page, 'LINE_LATLONG');
  await type(page, '45,-75');
  await type(page, '45.01,-75');
  await type(page, '');
  await expect.poll(() => ent(page), { timeout: 15000 }).toBe(base + 2);
  await shot(page, 'C-crs-success');
  const geom = lineGeom(await saveEntities(page));
  evidence.flowC = {
    ...(evidence.flowC as object),
    grid: geom.find((e) => e.createdBy === 'LINE_GRID_NE'),
    latlong: geom.find((e) => e.createdBy === 'LINE_LATLONG'),
  };
  writeEvidence();
  await assertClean(page, errors);
});

test('D: point range / name from imported numeric survey points', async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  await bootWithSource(page, errors, { crsId: 'CA_NAD83_CSRS_UTM_20N' });
  const before = await ent(page);
  await start(page, 'LINE_POINT_RANGE');
  await type(page, '1-3');
  await expect.poll(() => ent(page), { timeout: 15000 }).toBe(before + 2);
  await start(page, 'LINE_POINT_NAME');
  await type(page, '1,3');
  await expect.poll(() => ent(page), { timeout: 15000 }).toBe(before + 3);
  await start(page, 'LINE_POINT_NAME');
  await type(page, '1,99');
  await expect(prompt(page)).toContainText(/No drawing point/i);
  expect(await ent(page)).toBe(before + 3);
  await esc(page);
  // LINE_POINT_OBJECT: pick the imported survey points (point hit targets).
  await start(page, 'LINE_POINT_OBJECT');
  const pointHits = page.locator('[data-survey-cad-hit-target="true"][r]');
  const pointCount = Math.min(await pointHits.count(), 3);
  const clicked = new Set<string>();
  for (let i = 0; i < pointCount; i += 1) {
    const target = pointHits.nth(i);
    const c = await target.evaluate((el) => ({
      cx: Number(el.getAttribute('cx')), cy: Number(el.getAttribute('cy')),
    }));
    const key = `${Math.round(c.cx)}:${Math.round(c.cy)}`;
    if (clicked.has(key)) continue;
    clicked.add(key);
    // Dispatch on the survey-point hit target itself: a wide line hit-stroke
    // overlaps the shared endpoint, and LINE_POINT_OBJECT (correctly) refuses a
    // non-survey-point body. The pick still carries the point entity id, and
    // the handler resolves geometry from the station id.
    await target.dispatchEvent('click');
  }
  await expect(prompt(page)).not.toContainText('not a survey point');
  await type(page, '');
  await page.waitForTimeout(200);
  const geom = lineGeom(await saveEntities(page));
  const objectSegments = geom.filter((e) => e.createdBy === 'LINE_POINT_OBJECT').length;
  expect(objectSegments).toBeGreaterThanOrEqual(1);
  await expect.poll(() => ent(page), { timeout: 15000 }).toBe(before + 3 + objectSegments);
  await shot(page, 'D-range-name-object');
  evidence.flowD = {
    rangeSegments: geom.filter((e) => e.createdBy === 'LINE_POINT_RANGE').length,
    nameSegments: geom.filter((e) => e.createdBy === 'LINE_POINT_NAME').length,
    objectSegments,
  };
  writeEvidence();
  await assertClean(page, errors);
});

test('E: bearing / azimuth / angle / deflection / side shot / station-offset refusal', async ({ page }) => {
  test.setTimeout(160_000);
  const errors: string[] = [];
  await boot(page, errors);

  await start(page, 'LINE_BEARING');
  await type(page, '0,0');
  await type(page, 'N90-00-00E,100');
  await type(page, '');
  await start(page, 'LINE_AZIMUTH');
  await type(page, '0,0');
  await type(page, '90,100');
  await type(page, '');
  await expect.poll(() => ent(page), { timeout: 15000 }).toBe(2);

  // ANGLE + DEFLECTION seed from the selected line: create + select a line.
  await drawLine(page, '0,0', '0,100');
  await clickLineAt(page, 0, 0.5); // select
  await start(page, 'LINE_ANGLE');
  await clickLineAt(page, 0, 0.05); // start near the from-end
  await type(page, 'R90,100');
  await type(page, '');
  await clickLineAt(page, 0, 0.5); // reselect the reference
  await start(page, 'LINE_DEFLECTION');
  await type(page, 'R90,100');
  await type(page, '');
  await expect.poll(() => ent(page), { timeout: 15000 }).toBe(5);

  // SIDE_SHOT: occupy (0,0) + reference (0,100) then a fixed-origin shot.
  await clickLineAt(page, 0, 0.5);
  await start(page, 'LINE_SIDE_SHOT');
  await clickLineAt(page, 0, 0.0);
  await clickLineAt(page, 0, 1.0);
  await type(page, 'AZ90,50');
  await type(page, '');
  await expect.poll(() => ent(page), { timeout: 15000 }).toBe(6);

  // STATION_OFFSET without a selected alignment fails closed.
  await start(page, 'LINE_STATION_OFFSET');
  await type(page, '0,5');
  await expect(prompt(page)).toContainText(/alignment/i);
  await esc(page);

  await shot(page, 'E-directional');
  const geom = lineGeom(await saveEntities(page));
  evidence.flowE = {
    bearing: geom.find((e) => e.createdBy === 'LINE_BEARING'),
    azimuth: geom.find((e) => e.createdBy === 'LINE_AZIMUTH'),
    angle: geom.find((e) => e.createdBy === 'LINE_ANGLE'),
    deflection: geom.find((e) => e.createdBy === 'LINE_DEFLECTION'),
    sideShot: geom.find((e) => e.createdBy === 'LINE_SIDE_SHOT'),
  };
  writeEvidence();
  await assertClean(page, errors);
});

test('F: extension in place + from-end (line) + perpendicular + tangent; idle autocomplete', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  await boot(page, errors);

  // Extension is an in-place GRIP_EDIT (same id, count unchanged after commit).
  // A diagonal source keeps the drawing bounds two-dimensional for the picks.
  await drawLine(page, '0,0', '100,100');
  await start(page, 'LINE_EXTENSION');
  await clickLineAt(page, 0, 1.0);
  await type(page, '+50');
  const extGeom = lineGeom(await saveEntities(page));
  expect(extGeom).toHaveLength(1);
  expect(Math.hypot(extGeom[0]!.toX, extGeom[0]!.toY)).toBeCloseTo(Math.hypot(100, 100) + 50, 1);
  evidence.flowF = { extension: extGeom[0] };

  // From-end creates a new collinear line.
  await start(page, 'LINE_FROM_END');
  await clickLineAt(page, 0, 1.0);
  await type(page, '25');
  await expect.poll(() => ent(page), { timeout: 15000 }).toBe(2);

  // Perpendicular from a typed point off the infinite supporting line.
  await start(page, 'LINE_PERP_POINT');
  await clickLineAt(page, 0, 0.5);
  await expect(prompt(page)).toContainText(/from point/i);
  await type(page, '30,80');
  await expect.poll(() => ent(page), { timeout: 15000 }).toBe(3);

  // Tangent from a point off a circle.
  await start(page, 'CIRCLE');
  await type(page, '0,0');
  await type(page, '50');
  await expect.poll(() => ent(page), { timeout: 15000 }).toBe(4);
  const circleHit = page.locator('[data-survey-cad-hit-target="true"][r]').last();
  const circle = await circleHit.evaluate((el) => ({
    cx: Number(el.getAttribute('cx')), cy: Number(el.getAttribute('cy')), r: Number(el.getAttribute('r')),
  }));
  await start(page, 'LINE_TANGENT_POINT');
  await clickView(page, circle.cx + circle.r * 0.9, circle.cy);
  await expect(prompt(page)).toContainText(/from point/i);
  await type(page, '-80,80');
  await expect.poll(() => ent(page), { timeout: 15000 }).toBe(5);

  await shot(page, 'F-edit-from-end-tangent');
  // Idle autocomplete surfaces LINE_* keys.
  await page.locator('[data-survey-cad-preview]').first().click({ position: { x: 5, y: 5 } });
  await input(page).fill('');
  await page.keyboard.type('LINE_');
  const suggestions = page.locator('[data-cad-command-suggestion]');
  await expect(suggestions.first()).toBeVisible({ timeout: 5000 });
  const seen = await suggestions.allTextContents();
  expect(seen.join(' ')).toMatch(/LINE_(NE|BEARING|GRID_NE|POINT_RANGE)/);
  await shot(page, 'F-idle-autocomplete');
  await esc(page);
  evidence.flowF = { ...(evidence.flowF as object), lineCount: (await saveEntities(page)).filter((e) => e.type === 'line').length };
  writeEvidence();
  await assertClean(page, errors);
});
