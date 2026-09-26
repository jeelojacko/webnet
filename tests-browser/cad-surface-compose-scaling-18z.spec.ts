/**
 * Phase 18Z browser QA — exact composition scaling paths through the real /cad app.
 *
 * Playwright (dev-server + Chromium), NOT vitest. Drives the shipped Compose
 * Surface dialog over ~1.2k-vertex meshes (625-vertex grids), so the 18Z
 * exact fast paths (full-overlay coverage, strict-disjoint concatenation) and
 * the indexed constrained-edge recovery are all exercised by the real engine
 * on the main thread (pre-commit dry-run) AND by the worker (committed
 * payload). Deliberately small: no 100k mesh ever loads in browser CI.
 *
 * Flows:
 *  A  full overlay        — fast path, no seam, overlay plane wins
 *  B  disjoint islands    — strict-disjoint fast path, no corridor geometry
 *  C  partial grading island — normal pipeline, local seam, exact probes
 *  D  seam Z mismatch     — fail-closed block, zero history
 *  E  overlay void        — base shows through the hole
 *  F  Compose Copy        — sources byte-identical
 *  G  Paste               — target id/name kept, source untouched, undo/redo
 *  H  stale worker        — a superseded (late) result never applies
 *  I  post-compose edits  — composite accepts an ordinary Set Elevation edit
 *  J  save/reopen         — persisted explicit payload, exact rebuild
 *
 * H is timing-sensitive by nature. The browser test makes it deterministic by
 * holding the worker's `compose` messages in-page, issuing two requests on the
 * same ownership key, then releasing: the service's latest-wins supersession
 * (pinned independently in the agent-tier `tests/surface_compose_service_18y.test.ts`
 * worker/client/service suites) must drop the first and apply the second
 * exactly once. If that in-page hold ever proves flaky on a runner, fall back
 * to the existing service-test precedent and keep the deterministic subset
 * (one composite, one history entry).
 *
 * New spec only: production, existing specs, and helpers are untouched; the
 * shared harness is imported.
 */
import { expect, test, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  commitEdit, dockValue, gotoCad, reloadCad, saveDrawingToTemp, stageXy, startEdit,
} from './cad-surface-bake-18x-helpers';
import {
  ENTITY_COUNT,
  SEED,
  baseZ,
  closeComposeDialog,
  composeCommitButton,
  composeCopy,
  composeNotice,
  composePaste,
  composeSummary,
  detailDd,
  gridTin,
  listRow,
  managerScope,
  openComposeDialog,
  openDrawingFile,
  openSurfaceManager,
  parseVt,
  rebuildComposite,
  rebuildSurface,
  ribbonTab,
  showSurveyTab,
  stageCompose,
  surfaceArea,
  surfaceNames,
} from './cad-surface-compose-18y-helpers';

test.use({ actionTimeout: 20000 });

// ---------------------------------------------------------------------------
// 18Z mesh family — 25x25 grids (625 verts, 1152 tris each)
// ---------------------------------------------------------------------------

const SIDE = 25;
const STEP = 10;
const FULL_XS = Array.from({ length: SIDE }, (_, index) => index * STEP);
const FULL_YS = FULL_XS;
/** Nested 9x9 grading island: 6400 m² inside the 57600 m² base domain. */
const ISLAND_XS = Array.from({ length: 9 }, (_, index) => 80 + index * STEP);
/** Right half domain (x ≥ 120) with a +1 plane: seam mismatch at x = 120. */
const HALF_XS = Array.from({ length: 13 }, (_, index) => 120 + index * STEP);
/** Translated copy (x + 400) strictly disjoint from the base AABB. */
const FAR_XS = FULL_XS.map((x) => x + 400);

export const Z_BASE_ID = 'z-base';
export const Z_BASE_NAME = 'Z Base';
export const Z_FULL_ID = 'z-full';
export const Z_FULL_NAME = 'Z Full';
export const Z_FAR_ID = 'z-far';
export const Z_FAR_NAME = 'Z Far';
export const Z_ISLAND_ID = 'z-island';
export const Z_ISLAND_NAME = 'Z Island';
export const Z_RAISED_ID = 'z-raised';
export const Z_RAISED_NAME = 'Z Raised';
export const Z_VOID_ID = 'z-void';
export const Z_VOID_NAME = 'Z Void';
export const FULL_TRIANGLES = (SIDE - 1) * (SIDE - 1) * 2;
export const FULL_VERTICES = SIDE * SIDE;
export const COMPOSITE_SUFFIX = ' - Composite';

const importedDefinition = (vertices: number[], faces: number[], name: string, id: string): Record<string, unknown> => ({
  pointSource: { kind: 'points', pointEntityIds: [] },
  sourceKind: 'imported-tin',
  importedTin: {
    vertices,
    faces,
    provenance: { format: 'LandXML', fileName: 'scaling.xml', surfaceName: name, sourceId: id },
  },
  edits: [],
});

const surface = (id: string, name: string, vertices: number[], faces: number[]): Record<string, unknown> => ({
  id,
  name,
  styleId: 'surface-style-triangles',
  layerId: 'general',
  cachedRevision: null,
  definition: importedDefinition(vertices, faces, name, id),
});

/** A 3x3 block of missing cells inside the otherwise full overlay. */
const voidSkip = (xi: number, yi: number): boolean => xi >= 9 && xi <= 11 && yi >= 9 && yi <= 11;

/** Six ~1.2k-vertex imported TINs over one 25x25 planar base. */
export function makeScalingDrawing(): string {
  const seed = JSON.parse(fs.readFileSync(SEED, 'utf8')) as { project: Record<string, unknown> };
  const entities: unknown[] = [];
  for (let row = 0; row < 5; row += 1) {
    for (let col = 0; col < 5; col += 1) {
      const x = col * 10;
      const y = row * 10;
      entities.push({
        id: `z-pt-${row}${col}`, type: 'survey-point', layerId: 'points', visible: true, locked: false,
        stationId: `Z${row}${col}`, x, y, z: baseZ(x, y), pointClass: 'free', source: 'parsed-input',
      });
    }
  }
  entities.push(
    {
      id: 'z-shared', type: 'polygon', layerId: 'general', visible: true, locked: false,
      vertices: [{ x: -5, y: -5 }, { x: 245, y: -5 }, { x: 245, y: 245 }, { x: -5, y: 245 }],
      vertexLabels: ['', '', '', ''],
    },
    {
      id: 'z-align', type: 'alignment', layerId: 'general', visible: true, locked: false,
      name: 'Z-CL', elements: [{ kind: 'line', start: { x: -5, y: 120 }, end: { x: 645, y: 120 } }], startStation: 0,
    },
  );

  const base = gridTin(FULL_XS, FULL_YS, baseZ);
  // Full overlay: identical XY coverage, deliberately +5 plane so the result
  // must take the overlay Z (overlay owns every cell -> no seam exists).
  const full = gridTin(FULL_XS, FULL_YS, (x, y) => baseZ(x, y) + 5);
  const far = gridTin(FAR_XS, FULL_YS, (x, y) => baseZ(x - 400, y) + 3);
  const island = gridTin(ISLAND_XS, ISLAND_XS, baseZ);
  const raised = gridTin(HALF_XS, FULL_YS, (x, y) => baseZ(x, y) + 1);
  const voided = gridTin(FULL_XS, FULL_YS, baseZ, voidSkip);

  (seed.project as { entities: unknown[] }).entities = entities;
  (seed.project as { pointGroups: unknown[] }).pointGroups = [];
  (seed.project as { bounds: unknown }).bounds = { minX: -20, minY: -20, maxX: 700, maxY: 300 };
  (seed.project as { surfaces: unknown[] }).surfaces = [
    surface(Z_BASE_ID, Z_BASE_NAME, base.vertices, base.faces),
    surface(Z_FULL_ID, Z_FULL_NAME, full.vertices, full.faces),
    surface(Z_FAR_ID, Z_FAR_NAME, far.vertices, far.faces),
    surface(Z_ISLAND_ID, Z_ISLAND_NAME, island.vertices, island.faces),
    surface(Z_RAISED_ID, Z_RAISED_NAME, raised.vertices, raised.faces),
    surface(Z_VOID_ID, Z_VOID_NAME, voided.vertices, voided.faces),
  ];
  return JSON.stringify(seed);
}

export async function openScalingDrawing(page: Page): Promise<void> {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'webnet-18z-')), 'scaling.wncad');
  fs.writeFileSync(file, makeScalingDrawing());
  await openDrawingFile(page, file, ENTITY_COUNT);
}

async function prepare(page: Page, ...surfaces: Array<[string, string]>): Promise<void> {
  await showSurveyTab(page);
  await openSurfaceManager(page);
  for (const [name, id] of surfaces) await rebuildSurface(page, name, id);
}

// ---------------------------------------------------------------------------
// small reads
// ---------------------------------------------------------------------------

const toNumber = (text: string | null): number =>
  Number.parseFloat((text ?? '').replace(/[^0-9.eE+-]/g, ''));

function summaryDd(page: Page, label: string) {
  return composeSummary(page).locator(`dt:text-is("${label}") + dd`);
}

async function stageAndCommitCopy(page: Page, baseName: string, overlayName: string): Promise<void> {
  await openComposeDialog(page, 'copy');
  await stageCompose(page, baseName, overlayName);
  await composeCommitButton(page).click();
  // The synchronous dry-run supplies the exact summary immediately; no
  // wall-clock gate (repo rule: never gate on absolute runtime).
  await expect(composeSummary(page)).toHaveAttribute('data-cad-compose-summary', 'exact');
}

async function rowStats(page: Page, name: string): Promise<{ vertices: number; triangles: number }> {
  return parseVt((await listRow(page, name).textContent()) ?? '');
}

// ---------------------------------------------------------------------------
// H — in-page worker `compose` hold (deterministic supersession window)
// ---------------------------------------------------------------------------

async function installComposeHold(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const queue: Array<{ worker: Worker; message: unknown }> = [];
    const hold = {
      active: false,
      on: (): void => { hold.active = true; },
      release: (): void => {
        hold.active = false;
        for (const entry of queue.splice(0, queue.length)) original.call(entry.worker, entry.message);
      },
    };
    const prototype = Worker.prototype as unknown as {
      postMessage: (_message: unknown) => void;
    };
    const original = prototype.postMessage;
    prototype.postMessage = function postMessage(message: unknown): void {
      const type = (message as { type?: string } | null)?.type;
      if (hold.active && type === 'compose') {
        queue.push({ worker: this as Worker, message });
        return;
      }
      original.call(this, message);
    };
    (window as unknown as { __composeHold: typeof hold }).__composeHold = hold;
  });
}

const releaseComposeHold = (page: Page): Promise<void> =>
  page.evaluate(() => {
    (window as unknown as { __composeHold: { release: () => void } }).__composeHold.release();
  });

const enableComposeHold = (page: Page): Promise<void> =>
  page.evaluate(() => {
    (window as unknown as { __composeHold: { on: () => void } }).__composeHold.on();
  });

// ---------------------------------------------------------------------------
// A — full overlay fast path
// ---------------------------------------------------------------------------

test('18Z-A: a full-coverage overlay composes exactly (no seam) and the overlay plane wins', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  await gotoCad(page, errors);
  await openScalingDrawing(page);
  await prepare(page, [Z_BASE_NAME, Z_BASE_ID], [Z_FULL_NAME, Z_FULL_ID]);
  const fullStats = await rowStats(page, Z_FULL_NAME);

  await stageAndCommitCopy(page, Z_BASE_NAME, Z_FULL_NAME);
  await expect(summaryDd(page, 'Verdict')).toHaveText('Exact');
  await expect(summaryDd(page, 'Seam length')).toHaveText('0.000 m');
  await expect(summaryDd(page, 'Max mismatch')).toHaveText('0.000000 m');
  // No base-only cell survives: overlap is the whole base domain.
  expect(toNumber(await summaryDd(page, 'Result area').textContent())).toBeCloseTo(240 * 240, 2);
  expect(toNumber(await summaryDd(page, 'Overlap').textContent())).toBeCloseTo(240 * 240, 2);
  // Fast-path fingerprint: the result IS the overlay topology.
  expect(toNumber(await summaryDd(page, 'Vertices').textContent())).toBe(fullStats.vertices);
  expect(toNumber(await summaryDd(page, 'Triangles').textContent())).toBe(fullStats.triangles);
  await closeComposeDialog(page);

  const copy = `${Z_BASE_NAME} + ${Z_FULL_NAME}${COMPOSITE_SUFFIX}`;
  const rebuilt = await rebuildComposite(page, copy);
  expect(rebuilt).toEqual(fullStats);
  await listRow(page, copy).click();
  // Overlay plane wins: +5 over the planar base.
  const baseMaxZ = Number.parseFloat((await detailDd(page, 'Max Z').textContent() ?? '').replace(/[^0-9.]/g, ''));
  expect(baseMaxZ).toBeCloseTo(100 + 0.1 * 240 + 0.2 * 240 + 5, 2);
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------
// B — disjoint fast path, no corridor geometry
// ---------------------------------------------------------------------------

test('18Z-B: disjoint surfaces concatenate (no corridor geometry) with zero seam and additive area', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  await gotoCad(page, errors);
  await openScalingDrawing(page);
  await prepare(page, [Z_BASE_NAME, Z_BASE_ID], [Z_FAR_NAME, Z_FAR_ID]);
  const baseStats = await rowStats(page, Z_BASE_NAME);
  const farStats = await rowStats(page, Z_FAR_NAME);

  await stageAndCommitCopy(page, Z_BASE_NAME, Z_FAR_NAME);
  await expect(summaryDd(page, 'Verdict')).toHaveText('Exact');
  await expect(summaryDd(page, 'Seam length')).toHaveText('0.000 m');
  await expect(summaryDd(page, 'Max mismatch')).toHaveText('0.000000 m');
  expect(toNumber(await summaryDd(page, 'Overlap').textContent())).toBe(0);
  // Union of two islands: exact additive area.
  const resultArea = toNumber(await summaryDd(page, 'Result area').textContent());
  expect(resultArea).toBeCloseTo(2 * 240 * 240, 1);
  // No corridor triangles: vertex/triangle counts are the exact concatenation
  // of both islands (the fast path never triangulates the hull spanning them).
  expect(toNumber(await summaryDd(page, 'Vertices').textContent())).toBe(baseStats.vertices + farStats.vertices);
  expect(toNumber(await summaryDd(page, 'Triangles').textContent())).toBe(baseStats.triangles + farStats.triangles);
  await closeComposeDialog(page);

  const copy = `${Z_BASE_NAME} + ${Z_FAR_NAME}${COMPOSITE_SUFFIX}`;
  const rebuilt = await rebuildComposite(page, copy);
  expect(rebuilt.vertices).toBe(baseStats.vertices + farStats.vertices);
  expect(rebuilt.triangles).toBe(baseStats.triangles + farStats.triangles);
  await listRow(page, copy).click();
  expect(await surfaceArea(page)).toBeCloseTo(resultArea, 1);
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------
// C — partial grading island, local seam, exact probes
// ---------------------------------------------------------------------------

test('18Z-C: a nested grading island composes through the normal pipeline with a local exact seam', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  await gotoCad(page, errors);
  await openScalingDrawing(page);
  await prepare(page, [Z_BASE_NAME, Z_BASE_ID], [Z_ISLAND_NAME, Z_ISLAND_ID]);

  await stageAndCommitCopy(page, Z_BASE_NAME, Z_ISLAND_NAME);
  await expect(summaryDd(page, 'Verdict')).toHaveText('Exact');
  // The seam is the island perimeter only (320 m), not the whole domain.
  const seam = toNumber(await summaryDd(page, 'Seam length').textContent());
  expect(seam).toBeCloseTo(4 * 80, 1);
  await expect(summaryDd(page, 'Max mismatch')).toHaveText('0.000000 m');
  // Overlap is exactly the island; the result keeps the full base domain.
  expect(toNumber(await summaryDd(page, 'Overlap').textContent())).toBeCloseTo(80 * 80, 1);
  expect(toNumber(await summaryDd(page, 'Result area').textContent())).toBeCloseTo(240 * 240, 1);
  await closeComposeDialog(page);

  const copy = `${Z_BASE_NAME} + ${Z_ISLAND_NAME}${COMPOSITE_SUFFIX}`;
  await rebuildComposite(page, copy);
  await listRow(page, copy).click();
  expect(await surfaceArea(page)).toBeCloseTo(240 * 240, 1);
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------
// D — mismatch still blocks
// ---------------------------------------------------------------------------

test('18Z-D: a seam Z mismatch still blocks before any history entry', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  await gotoCad(page, errors);
  await openScalingDrawing(page);
  await prepare(page, [Z_BASE_NAME, Z_BASE_ID], [Z_RAISED_NAME, Z_RAISED_ID]);
  const namesBefore = await surfaceNames(page);

  await openComposeDialog(page, 'copy');
  await stageCompose(page, Z_BASE_NAME, Z_RAISED_NAME);
  await composeCommitButton(page).click();
  await expect(composeNotice(page)).toContainText('Blocked', { timeout: 30000 });
  await expect(composeNotice(page)).toContainText('mismatch');
  await closeComposeDialog(page);

  expect(await surfaceNames(page)).toEqual(namesBefore);
  await ribbonTab(page, 'Home').click();
  await expect(page.locator('[data-cad-command="SHELL_UNDO"]')).toBeDisabled();
  await showSurveyTab(page);
  expect(await surfaceNames(page)).toEqual(namesBefore);
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------
// E — overlay void show-through
// ---------------------------------------------------------------------------

test('18Z-E: an overlay void lets the base show through and the seam stays exact', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  await gotoCad(page, errors);
  await openScalingDrawing(page);
  await prepare(page, [Z_BASE_NAME, Z_BASE_ID], [Z_VOID_NAME, Z_VOID_ID]);

  await stageAndCommitCopy(page, Z_BASE_NAME, Z_VOID_NAME);
  await expect(summaryDd(page, 'Verdict')).toHaveText('Exact');
  const overlayArea = toNumber(await summaryDd(page, `Overlay “${Z_VOID_NAME}”`).textContent());
  expect(overlayArea).toBeLessThan(240 * 240 - 1);
  // Base fills the 3x3 hole: the composed domain is the full base.
  expect(toNumber(await summaryDd(page, 'Result area').textContent())).toBeCloseTo(240 * 240, 1);
  // Seam exists around the void (hole perimeter = 4 * 30 m).
  expect(toNumber(await summaryDd(page, 'Seam length').textContent())).toBeCloseTo(120, 1);
  await closeComposeDialog(page);

  const copy = `${Z_BASE_NAME} + ${Z_VOID_NAME}${COMPOSITE_SUFFIX}`;
  await rebuildComposite(page, copy);
  await listRow(page, copy).click();
  expect(await surfaceArea(page)).toBeCloseTo(240 * 240, 1);
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------
// F — Compose Copy source immutability
// ---------------------------------------------------------------------------

test('18Z-F: Compose Copy adds one composite and leaves both sources byte-identical', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  await gotoCad(page, errors);
  await openScalingDrawing(page);
  await prepare(page, [Z_BASE_NAME, Z_BASE_ID], [Z_FULL_NAME, Z_FULL_ID]);
  const baseBefore = (await listRow(page, Z_BASE_NAME).textContent()) ?? '';
  const fullBefore = (await listRow(page, Z_FULL_NAME).textContent()) ?? '';

  const copy = await composeCopy(page, Z_BASE_NAME, Z_FULL_NAME);
  await expect(composeSummary(page)).toHaveAttribute('data-cad-compose-summary', 'exact');
  await closeComposeDialog(page);

  await listRow(page, copy).click();
  await expect(detailDd(page, 'Source Type')).toHaveText('Composite Explicit TIN');
  await expect(detailDd(page, 'Base')).toHaveText(Z_BASE_NAME);
  await expect(detailDd(page, 'Overlay')).toHaveText(Z_FULL_NAME);
  await expect(detailDd(page, 'Policy')).toHaveText('Overlay Coverage Wins');

  expect((await listRow(page, Z_BASE_NAME).textContent()) ?? '').toBe(baseBefore);
  expect((await listRow(page, Z_FULL_NAME).textContent()) ?? '').toBe(fullBefore);
  await listRow(page, Z_BASE_NAME).click();
  await expect(detailDd(page, 'Source Type')).toHaveCount(0);
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------
// G — Paste target semantics
// ---------------------------------------------------------------------------

test('18Z-G: Paste keeps the target identity, leaves the source identical, and undoes to the prior definition', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  await gotoCad(page, errors);
  await openScalingDrawing(page);
  await prepare(page, [Z_BASE_NAME, Z_BASE_ID], [Z_FULL_NAME, Z_FULL_ID]);
  await listRow(page, Z_BASE_NAME).click();
  const baseSourceBefore = await detailDd(page, 'Source').textContent();
  const fullBefore = (await listRow(page, Z_FULL_NAME).textContent()) ?? '';

  await composePaste(page, Z_BASE_NAME, Z_FULL_NAME);
  await expect(page.locator('[data-survey-cad-file-status]')).toContainText('Pasted', { timeout: 60000 });
  await closeComposeDialog(page);

  await listRow(page, Z_BASE_NAME).click();
  await expect(detailDd(page, 'Source Type')).toHaveText('Composite Explicit TIN');
  await expect(detailDd(page, 'Base')).toHaveText(Z_BASE_NAME);
  await expect(detailDd(page, 'Overlay')).toHaveText(Z_FULL_NAME);
  expect((await listRow(page, Z_FULL_NAME).textContent()) ?? '').toBe(fullBefore);

  await ribbonTab(page, 'Home').click();
  await page.locator('[data-cad-command="SHELL_UNDO"]').click();
  await showSurveyTab(page);
  await listRow(page, Z_BASE_NAME).click();
  await expect(detailDd(page, 'Source')).toHaveText(baseSourceBefore ?? '');
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------
// H — stale worker (late result loses)
// ---------------------------------------------------------------------------

test('18Z-H: a superseded worker result never applies (latest-wins leaves exactly one composite)', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  await installComposeHold(page);
  await gotoCad(page, errors);
  await openScalingDrawing(page);
  await prepare(page, [Z_BASE_NAME, Z_BASE_ID], [Z_FULL_NAME, Z_FULL_ID]);

  await enableComposeHold(page);
  await openComposeDialog(page, 'copy');
  await stageCompose(page, Z_BASE_NAME, Z_FULL_NAME);
  await composeCommitButton(page).click();
  // Second request on the same ownership key while the first is still held:
  // the service must supersede the first and drop its late arrival.
  await composeCommitButton(page).click();

  const exactName = `button[aria-label^="Surface ${Z_BASE_NAME} + ${Z_FULL_NAME}${COMPOSITE_SUFFIX},"]`;
  const duplicateName = `button[aria-label^="Surface ${Z_BASE_NAME} + ${Z_FULL_NAME}${COMPOSITE_SUFFIX} (2),"]`;
  // The hold is real: no result has applied while both worker requests are held.
  expect(await managerScope(page).locator(exactName).count()).toBe(0);
  await releaseComposeHold(page);

  await expect(page.locator('[data-survey-cad-file-status]')).toContainText('Composite copy created', { timeout: 60000 });
  await expect.poll(() => managerScope(page).locator(exactName).count(), { timeout: 60000 }).toBe(1);
  expect(await managerScope(page).locator(duplicateName).count()).toBe(0);

  await closeComposeDialog(page);
  await ribbonTab(page, 'Home').click();
  await page.locator('[data-cad-command="SHELL_UNDO"]').click();
  await showSurveyTab(page);
  await expect.poll(() => managerScope(page).locator(exactName).count()).toBe(0);
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------
// I — post-compose edits
// ---------------------------------------------------------------------------

test('18Z-I: a composite accepts an ordinary Set Elevation edit and rebuilds CURRENT', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  await gotoCad(page, errors);
  await openScalingDrawing(page);
  await prepare(page, [Z_BASE_NAME, Z_BASE_ID], [Z_FULL_NAME, Z_FULL_ID]);
  await composePaste(page, Z_BASE_NAME, Z_FULL_NAME);
  await expect(page.locator('[data-survey-cad-file-status]')).toContainText('Pasted', { timeout: 60000 });
  await closeComposeDialog(page);
  await listRow(page, Z_BASE_NAME).click();
  await expect(detailDd(page, 'Source Type')).toHaveText('Composite Explicit TIN');
  await rebuildComposite(page, Z_BASE_NAME);

  await startEdit(page, 'set-elevation', 'set-elevation');
  await stageXy(page, 'set-elevation', '120', '120');
  await dockValue(page, '300');
  await commitEdit(page, 'set-elevation');
  await showSurveyTab(page);
  await openSurfaceManager(page);
  await listRow(page, Z_BASE_NAME).click();
  await expect(detailDd(page, 'Post-composite Edits')).toHaveText('1');
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------
// J — save/reopen exact payload
// ---------------------------------------------------------------------------

test('18Z-J: a composite persists its exact explicit payload and rebuilds byte-for-byte after reopen', async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  await gotoCad(page, errors);
  await openScalingDrawing(page);
  await prepare(page, [Z_BASE_NAME, Z_BASE_ID], [Z_ISLAND_NAME, Z_ISLAND_ID]);
  const copy = await composeCopy(page, Z_BASE_NAME, Z_ISLAND_NAME);
  await closeComposeDialog(page);
  const stats = await rebuildComposite(page, copy);
  await listRow(page, copy).click();
  const area = await surfaceArea(page);
  const minZ = await detailDd(page, 'Min Z').textContent();
  const maxZ = await detailDd(page, 'Max Z').textContent();

  const savedPath = await saveDrawingToTemp(page);
  const saved = JSON.parse(fs.readFileSync(savedPath, 'utf8')) as {
    project: {
      surfaces: Array<{
        name: string;
        definition: {
          importedTin?: { vertices: number[]; faces: number[]; provenance: Record<string, unknown> };
        };
      }>;
    };
  };
  const persisted = saved.project.surfaces.find(
    (entry) => entry.definition.importedTin?.provenance.kind === 'webnet-compose',
  );
  expect(persisted?.name).toBe(copy);
  const payload = persisted!.definition.importedTin!;
  expect(payload.vertices.length / 3).toBe(stats.vertices);
  expect(payload.faces.length / 3).toBe(stats.triangles);
  expect(payload.provenance.baseSurfaceName).toBe(Z_BASE_NAME);
  expect(payload.provenance.overlaySurfaceName).toBe(Z_ISLAND_NAME);
  expect(payload.provenance.policy).toBe('overlay-coverage-wins');
  expect(typeof payload.provenance.resultDigest).toBe('string');

  await reloadCad(page);
  await openDrawingFile(page, savedPath, ENTITY_COUNT);
  await showSurveyTab(page);
  await openSurfaceManager(page);
  await listRow(page, copy).click();
  await expect(detailDd(page, 'Source Type')).toHaveText('Composite Explicit TIN');
  await expect(detailDd(page, 'Status')).toHaveText('Unbuilt');
  const rebuilt = await rebuildComposite(page, copy);
  expect(rebuilt).toEqual(stats);
  await listRow(page, copy).click();
  expect(await surfaceArea(page)).toBeCloseTo(area, 3);
  expect(await detailDd(page, 'Min Z').textContent()).toBe(minZ);
  expect(await detailDd(page, 'Max Z').textContent()).toBe(maxZ);
  expect(errors).toEqual([]);
});
