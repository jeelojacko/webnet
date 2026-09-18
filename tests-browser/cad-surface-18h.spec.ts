/**
 * Phase 18H browser QA — contours through the real /cad app (§95 A-K).
 *
 * Playwright (dev-server + Chromium), NOT vitest. Drives the shipped UI:
 * surface manager style select, Contours style section (geometry/appearance/
 * labels), Toolspace contours row, inquiry panel (elevation + slope/aspect),
 * layer manager, WNCAD save/reopen, and the contour worker derivation path
 * in-page. Zero page/console errors is asserted per test.
 *
 * Seed: tests-browser/fixtures/cad-surface-18g-seed.wncad (6x5 planar grid
 * z = 100 + 0.1x + 0.05y, outer ring + void ring, breakline chain).
 * Seeded meshes never persist: qa-surf-constraints opens UNBUILT.
 *
 * - A: Surface style -> Contours => contours appear (data-surface-contours).
 * - B: Minor interval change => TIN stays CURRENT + contours re-derive +
 *   levels change (path data differs, Toolspace row shows new interval).
 * - C: major/minor visually distinct (two aggregated paths, widths 1 vs 2).
 * - D: major labels appear + precision updates text, TIN untouched.
 * - E: source edit => NEEDS_REBUILD + contours not current => rebuild
 *   regenerates.
 * - F: void-seeded surface builds CURRENT; contour group stays inside the
 *   TIN extent with aggregated paths only (browser-level termination proxy;
 *   exact clipping is unit-pinned).
 * - G: elevation inquiry returns 102.250 at (15,15).
 * - H: slope inquiry returns 11.2% / 6.4° / aspect 243.4° at (15,15).
 * - I: layer OFF hides contours+TIN, ON restores, status stays CURRENT.
 * - J: save/reopen: Contours style persists, contours deterministic.
 * - K: contour worker supersession in-page (interval A-then-B, late A
 *   cannot win) + production extractor contour-success on real geometry.
 */
import { expect, test, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const SHOT_DIR = 'docs/evidence/phase18h';
const SEED = 'tests-browser/fixtures/cad-surface-18g-seed.wncad';
const CONSTRAINTS_ID = 'qa-surf-constraints';

async function gotoCad(page: Page, errors: string[]): Promise<void> {
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.addInitScript(() => {
    const record = window as unknown as Record<string, unknown>;
    delete record.showSaveFilePicker;
    delete record.showOpenFilePicker;
  });
  await page.goto('/cad', { waitUntil: 'networkidle' });
  await expect(page.getByText('WebNet CAD', { exact: true }).first()).toBeVisible({ timeout: 30000 });
  await expect(page.locator('[data-cad-viewport]')).toBeVisible({ timeout: 30000 });
}

async function openDrawing(page: Page, filePath: string, expectedEntities: number): Promise<void> {
  const fileInput = page.locator('[data-survey-cad-open-drawing-input]');
  await fileInput.evaluate((element: HTMLInputElement) => element.classList.remove('hidden')).catch(() => {});
  await fileInput.setInputFiles(filePath);
  await expect.poll(() => entityCount(page)).toBe(expectedEntities);
}

async function entityCount(page: Page): Promise<number> {
  const text = (await page.locator('[data-survey-cad-entity-count]').textContent()) ?? '';
  return Number.parseInt(text, 10);
}

async function selectionCount(page: Page): Promise<number> {
  const text = (await page.locator('[data-survey-cad-selection-count]').textContent()) ?? '';
  return Number.parseInt(text, 10);
}

function toolspaceSurface(page: Page, id: string) {
  return page.locator(`[data-cad-toolspace] [data-cad-surface="${id}"]`);
}

async function surfaceStatus(page: Page, id: string): Promise<string> {
  return (await toolspaceSurface(page, id).getAttribute('data-cad-surface-status')) ?? '';
}

async function showSurveyTab(page: Page): Promise<void> {
  await page.locator('[aria-label="Toolspace tabs"]').getByRole('tab', { name: 'Survey' }).click();
}

function managerScope(page: Page) {
  return page.locator('section[aria-label="Surface manager"]');
}

function ribbonTab(page: Page, name: string) {
  return page.locator('[aria-label="Ribbon tabs"]').getByRole('tab', { name });
}

async function openManager(page: Page): Promise<void> {
  await ribbonTab(page, 'Surface').click();
  await page.getByRole('button', { name: 'Add Point Group' }).first().click();
  await expect(managerScope(page)).toBeVisible({ timeout: 10000 });
}

/** The legacy floating workspace properties overlay covers the right dock
 *  while expanded; collapse it so dock clicks land (selection is kept). */
async function collapseFloatingPanel(page: Page): Promise<void> {
  const collapse = page.locator('button[title="Collapse panel body"]');
  if (await collapse.isVisible().catch(() => false)) {
    await collapse.click();
  }
}

async function clearSelection(page: Page): Promise<void> {
  if ((await selectionCount(page)) === 0) return;
  await ribbonTab(page, 'Home').click();
  await page.locator('[data-cad-command="SHELL_CLEAR_SELECTION"]').click();
  await expect.poll(() => selectionCount(page)).toBe(0);
}

async function canvasPoint(page: Page, fx: number, fy: number): Promise<{ x: number; y: number }> {
  const box = await page.locator('[data-cad-viewport] svg').first().boundingBox();
  if (!box) throw new Error('viewport svg has no bounding box');
  return { x: box.x + box.width * fx, y: box.y + box.height * fy };
}

async function canvasClick(page: Page, fx: number, fy: number): Promise<void> {
  const point = await canvasPoint(page, fx, fy);
  await page.mouse.click(point.x, point.y);
}

async function cancelCommand(page: Page): Promise<void> {
  const input = page.locator('[data-cad-command-input]');
  await input.focus();
  await input.press('Escape');
}

async function downloadToTemp(page: Page, trigger: () => Promise<void>, suffix: string): Promise<string> {
  const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
  await trigger();
  const download = await downloadPromise;
  const tempPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'webnet-18h-')), `file${suffix}`);
  await download.saveAs(tempPath);
  return tempPath;
}

function surfaceLayer(page: Page, id: string) {
  return page.locator(`[data-surface-layer="${id}"]`);
}

/** Aggregated contour paths only (inner contour group; triangles/boundary
 *  are direct children, vertex circles carry no path). */
function contourPaths(page: Page, id: string) {
  return surfaceLayer(page, id).locator(':scope > g path');
}

function contourLabels(page: Page, id: string) {
  return surfaceLayer(page, id).locator(':scope > g text');
}

function toolspaceContoursRow(page: Page, id: string) {
  return page.locator(`[data-cad-toolspace] [data-cad-surface-contours="${id}"]`);
}

async function contourD(page: Page, id: string): Promise<string[]> {
  return contourPaths(page, id).evaluateAll((elements) =>
    elements.map((element) => element.getAttribute('d') ?? ''));
}

/** Shared setup: seed -> manager -> select QA Constraints -> Rebuild ->
 *  CURRENT. Caller picks the Contours style when the test needs it. */
async function buildConstraintsCurrent(page: Page): Promise<void> {
  await openDrawing(page, SEED, 32);
  await showSurveyTab(page);
  await expect(toolspaceSurface(page, CONSTRAINTS_ID)).toBeVisible();
  await expect.poll(() => surfaceStatus(page, CONSTRAINTS_ID)).toBe('UNBUILT');
  await openManager(page);
  const manager = managerScope(page);
  await manager.getByRole('button', { name: /QA Constraints, (Unbuilt|Needs Rebuild)/ }).click();
  await manager.getByRole('button', { name: 'Rebuild', exact: true }).click();
  await expect(manager.getByRole('status').first()).toContainText('building…');
  await expect.poll(() => surfaceStatus(page, CONSTRAINTS_ID), { timeout: 60000 }).toBe('CURRENT');
}

/* The 18G seed predates contour styles (Triangles/Triangles+Points/
 * Boundary/No Display only) and there is no style-create UI, so the
 * shipped-UI path is: pick the Triangles style, then enable contours in
 * the Contours section (Show contours + Apply geometry with defaults). */
async function selectContoursStyle(page: Page): Promise<void> {
  const manager = managerScope(page);
  await manager.getByLabel('Surface style', { exact: true }).selectOption({ label: 'Triangles' });
  await manager.getByLabel('Show contours').check();
  await manager.getByRole('button', { name: 'Apply geometry' }).click();
  await expect
    .poll(() => surfaceLayer(page, CONSTRAINTS_ID).getAttribute('data-surface-contours'), { timeout: 60000 })
    .toBe('true');
  await expect.poll(() => contourPaths(page, CONSTRAINTS_ID).count(), { timeout: 60000 }).toBe(2);
}

test('18H-AB: contour style select shows contours; interval change re-derives with TIN CURRENT', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  await gotoCad(page, errors);
  await buildConstraintsCurrent(page);
  const manager = managerScope(page);

  // Style default: seeded surface has no contour style => no contour layer.
  await expect(surfaceLayer(page, CONSTRAINTS_ID)).toBeVisible();
  await expect(surfaceLayer(page, CONSTRAINTS_ID).getAttribute('data-surface-contours')).resolves.toBeNull();
  await expect(toolspaceContoursRow(page, CONSTRAINTS_ID)).toContainText('Contours: off');

  // (A) Style -> Contours: derived contours attach (aggregated minor+major).
  await selectContoursStyle(page);
  await expect(toolspaceContoursRow(page, CONSTRAINTS_ID)).toContainText('Contours: minor 1 major every 5');
  const before = await contourD(page, CONSTRAINTS_ID);
  expect(before).toHaveLength(2);
  expect(before[0]!.length).toBeGreaterThan(200);
  expect(before[1]!.length).toBeGreaterThan(0);
  await page.screenshot({ path: `${SHOT_DIR}/18h-AB-contours-on.png` });

  // (B) Interval 1 -> 2: new derivation (levels change), TIN stays CURRENT.
  await manager.getByLabel('Minor contour interval').fill('2');
  await manager.getByRole('button', { name: 'Apply geometry' }).click();
  await expect(manager.getByRole('status').first()).toContainText('re-deriving');
  await expect.poll(() => toolspaceContoursRow(page, CONSTRAINTS_ID).textContent(), { timeout: 60000 })
    .toContain('minor 2');
  await expect
    .poll(() => contourD(page, CONSTRAINTS_ID).then((ds) => ds.join('|') === before.join('|') ? '' : 'changed'))
    .toBe('changed');
  // At interval 2 the only major level (100) is a degenerate corner
  // touch, so only the aggregated minor path renders — assert re-derive
  // (>= 1 path, changed levels), not a fixed path count.
  const after = await contourD(page, CONSTRAINTS_ID);
  expect(after.length).toBeGreaterThanOrEqual(1);
  expect(after.join('|')).not.toBe(before.join('|'));
  expect(await surfaceStatus(page, CONSTRAINTS_ID)).toBe('CURRENT');
  expect(await surfaceLayer(page, CONSTRAINTS_ID).getAttribute('data-surface-stale')).toBeNull();
  await page.screenshot({ path: `${SHOT_DIR}/18h-AB-interval-2.png` });
  expect(errors).toEqual([]);
});

test('18H-CD: major/minor distinct paths + labels; precision updates text without rebuild', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  await gotoCad(page, errors);
  await buildConstraintsCurrent(page);
  await selectContoursStyle(page);
  await clearSelection(page);
  const manager = managerScope(page);

  // (C) Two aggregated contour paths with distinct stroke widths (1 vs 2).
  const paths = contourPaths(page, CONSTRAINTS_ID);
  await expect.poll(() => paths.count()).toBe(2);
  const widths = await paths.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute('stroke-width') ?? ''));
  expect(widths).toEqual(['1', '2']);
  // Contour-DOM discipline: no per-segment nodes — the whole layer is at
  // most triangles + boundary + minor + major paths, labels are capped.
  expect(await surfaceLayer(page, CONSTRAINTS_ID).locator('path').count()).toBeLessThanOrEqual(4);
  const labelCount = await contourLabels(page, CONSTRAINTS_ID).count();
  expect(labelCount).toBeGreaterThan(0);
  expect(labelCount).toBeLessThanOrEqual(200);

  // (D) Major labels render at precision 1, then update to precision 2.
  const firstLabel = contourLabels(page, CONSTRAINTS_ID).first();
  await expect(firstLabel).toContainText(/^\d+\.\d$/);
  const trianglesBefore = await surfaceLayer(page, CONSTRAINTS_ID)
    .locator(':scope > path').first().getAttribute('d');
  await manager.getByLabel('Contour label precision').fill('2');
  await manager.getByRole('button', { name: 'Apply labels' }).click();
  await expect(manager.getByRole('status').first()).toContainText('labels updated');
  await expect.poll(() => firstLabel.textContent()).toMatch(/^\d+\.\d{2}$/);
  // Precision is display-only: TIN untouched (same triangles, still CURRENT).
  expect(await surfaceStatus(page, CONSTRAINTS_ID)).toBe('CURRENT');
  expect(await surfaceLayer(page, CONSTRAINTS_ID).getAttribute('data-surface-stale')).toBeNull();
  expect(await surfaceLayer(page, CONSTRAINTS_ID).locator(':scope > path').first().getAttribute('d'))
    .toBe(trianglesBefore);
  await page.screenshot({ path: `${SHOT_DIR}/18h-CD-labels.png` });
  expect(errors).toEqual([]);
});

test('18H-E: source edit => NEEDS_REBUILD + contours not current => rebuild regenerates', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  await gotoCad(page, errors);
  await buildConstraintsCurrent(page);
  await selectContoursStyle(page);
  const manager = managerScope(page);
  const before = await contourD(page, CONSTRAINTS_ID);

  // Shift every source point (select-all + MOVE): TIN goes NEEDS_REBUILD
  // with the stale mesh kept; contours are definitionally not current.
  await ribbonTab(page, 'Home').click();
  await page.locator('[data-cad-command="SHELL_SELECT_ALL"]').click();
  await expect.poll(() => selectionCount(page)).toBe(32);
  await page.locator('[data-cad-command="MOVE"]').click();
  await canvasClick(page, 0.3, 0.5);
  await canvasClick(page, 0.35, 0.55);
  await cancelCommand(page);
  await expect.poll(() => surfaceStatus(page, CONSTRAINTS_ID)).toBe('NEEDS_REBUILD');
  await expect(page.locator(`[data-surface-layer="${CONSTRAINTS_ID}"][data-surface-stale="true"]`)).toBeVisible();
  const staleContourCount = await contourPaths(page, CONSTRAINTS_ID).count();
  const staleFlag = await surfaceLayer(page, CONSTRAINTS_ID).getAttribute('data-surface-stale');
  expect(staleFlag === 'true' || staleContourCount === 0).toBe(true);
  await page.screenshot({ path: `${SHOT_DIR}/18h-E-needs-rebuild.png` });

  // Rebuild restores CURRENT and regenerates contours from moved sources.
  await clearSelection(page);
  await openManager(page);
  await managerScope(page).getByRole('button', { name: /QA Constraints, Needs Rebuild/ }).click();
  await managerScope(page).getByRole('button', { name: 'Rebuild', exact: true }).click();
  await expect.poll(() => surfaceStatus(page, CONSTRAINTS_ID), { timeout: 60000 }).toBe('CURRENT');
  await expect.poll(() => contourPaths(page, CONSTRAINTS_ID).count(), { timeout: 60000 }).toBe(2);
  await expect
    .poll(() => contourD(page, CONSTRAINTS_ID).then((ds) => ds.join('|') === before.join('|') ? '' : 'changed'))
    .toBe('changed');
  expect(manager).toBeTruthy();
  await page.screenshot({ path: `${SHOT_DIR}/18h-E-regenerated.png` });
  expect(errors).toEqual([]);
});

test('18H-FGH: void termination + elevation inquiry + slope inquiry', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  await gotoCad(page, errors);
  await buildConstraintsCurrent(page);
  await selectContoursStyle(page);
  const manager = managerScope(page);

  // (F) Void-seeded surface is CURRENT with contours; the contour group
  // stays inside the TIN extent and stays aggregated (2 paths, capped
  // labels) — browser-level termination proxy, exact clipping unit-pinned.
  expect(await surfaceStatus(page, CONSTRAINTS_ID)).toBe('CURRENT');
  await expect.poll(() => contourPaths(page, CONSTRAINTS_ID).count()).toBe(2);
  const layerBox = await surfaceLayer(page, CONSTRAINTS_ID).boundingBox();
  const contourBox = await contourPaths(page, CONSTRAINTS_ID).first().boundingBox();
  expect(layerBox).not.toBeNull();
  expect(contourBox).not.toBeNull();
  expect(contourBox!.x).toBeGreaterThanOrEqual(layerBox!.x - 2);
  expect(contourBox!.y).toBeGreaterThanOrEqual(layerBox!.y - 2);
  expect(contourBox!.x + contourBox!.width).toBeLessThanOrEqual(layerBox!.x + layerBox!.width + 2);
  expect(contourBox!.y + contourBox!.height).toBeLessThanOrEqual(layerBox!.y + layerBox!.height + 2);
  expect(await surfaceLayer(page, CONSTRAINTS_ID).locator('path').count()).toBeLessThanOrEqual(4);

  // (G) Elevation inquiry on the planar seed: z = 100 + 0.1x + 0.05y.
  await manager.getByLabel('Inquiry easting').fill('15');
  await manager.getByLabel('Inquiry northing').fill('15');
  await manager.getByRole('button', { name: 'Query' }).click();
  await expect(manager.getByRole('status').last()).toContainText('elevation 102.250');

  // (H) Slope/aspect inquiry: gradient (0.1, 0.05) => 11.2% (6.4°), 243.4°.
  await manager.locator('[aria-label="Inquiry mode"] button', { hasText: 'Slope' }).click();
  await manager.getByRole('button', { name: 'Query' }).click();
  await expect(manager.getByRole('status').last()).toContainText('slope 11.2%');
  await expect(manager.getByRole('status').last()).toContainText('aspect 243.4');
  await page.screenshot({ path: `${SHOT_DIR}/18h-FGH-inquiry.png` });
  expect(errors).toEqual([]);
});

test('18H-IJ: layer OFF hides contours+TIN and ON restores (no rebuild); save/reopen deterministic', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  await gotoCad(page, errors);
  await buildConstraintsCurrent(page);
  await selectContoursStyle(page);

  const before = await contourD(page, CONSTRAINTS_ID);
  const labelsBefore = await contourLabels(page, CONSTRAINTS_ID).allTextContents();

  // (I) Layer OFF hides the whole surface layer (TIN + contours); ON
  // restores it with the TIN still CURRENT (no rebuild happened).
  await clearSelection(page);
  await collapseFloatingPanel(page);
  await page.getByRole('button', { name: 'Open layer manager' }).click();
  const layers = page.locator('[data-cad-layers]');
  await layers.locator('input[aria-label="Toggle on/off for layer General"]').uncheck();
  await expect(page.locator('[data-surface-layer]')).toHaveCount(0);
  expect(await surfaceStatus(page, CONSTRAINTS_ID)).toBe('CURRENT');
  await page.screenshot({ path: `${SHOT_DIR}/18h-IJ-layer-off.png` });
  await layers.locator('input[aria-label="Toggle on/off for layer General"]').check();
  await expect.poll(() => surfaceLayer(page, CONSTRAINTS_ID).count()).toBe(1);
  await expect.poll(() => contourPaths(page, CONSTRAINTS_ID).count(), { timeout: 60000 }).toBe(2);
  expect(await surfaceStatus(page, CONSTRAINTS_ID)).toBe('CURRENT');

  // (J) Save/reopen: the Contours style persists; rebuild re-derives the
  // identical contour geometry (deterministic extraction).
  await ribbonTab(page, 'Home').click();
  const savedPath = await downloadToTemp(
    page,
    () => page.getByRole('button', { name: 'Save Drawing' }).first().click(),
    '.wncad',
  );
  expect(fs.readFileSync(savedPath, 'utf8')).toContain('showContours');
  await page.goto('/cad', { waitUntil: 'networkidle' });
  await expect(page.getByText('WebNet CAD', { exact: true }).first()).toBeVisible({ timeout: 30000 });
  await openDrawing(page, savedPath, 32);
  await showSurveyTab(page);
  await expect.poll(() => surfaceStatus(page, CONSTRAINTS_ID)).toMatch(/UNBUILT|NEEDS_REBUILD/);
  // Style intent survived the round trip (Toolspace still offers contours).
  await expect(toolspaceContoursRow(page, CONSTRAINTS_ID)).toContainText('Contours: minor 1 major every 5');
  await openManager(page);
  await managerScope(page).getByRole('button', { name: /QA Constraints, (Unbuilt|Needs Rebuild)/ }).click();
  await managerScope(page).getByRole('button', { name: 'Rebuild', exact: true }).click();
  await expect.poll(() => surfaceStatus(page, CONSTRAINTS_ID), { timeout: 60000 }).toBe('CURRENT');
  await expect.poll(() => contourPaths(page, CONSTRAINTS_ID).count(), { timeout: 60000 }).toBe(2);
  expect(await contourD(page, CONSTRAINTS_ID)).toEqual(before);
  expect(await contourLabels(page, CONSTRAINTS_ID).allTextContents()).toEqual(labelsBefore);
  await page.screenshot({ path: `${SHOT_DIR}/18h-IJ-reopened.png` });
  fs.rmSync(path.dirname(savedPath), { recursive: true, force: true });
  expect(errors).toEqual([]);
});

test('18H-K: contour worker supersession in Chromium (interval A-then-B, late A cannot win)', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  await gotoCad(page, errors);
  const verdict = await page.evaluate(async (handlerUrl: string) => {
    const mod = await import(handlerUrl);
    const mesh = {
      points: [
        { x: 0, y: 0, z: 10 },
        { x: 10, y: 0, z: 12 },
        { x: 10, y: 10, z: 14 },
        { x: 0, y: 10, z: 11 },
      ],
      triangles: [[0, 1, 2], [0, 2, 3]] as Array<readonly [number, number, number]>,
    };
    const requestFor = (contourGeometryRevision: string, minorInterval: number) => ({
      surfaceId: 's',
      surfaceRevision: 'tin-rev-1',
      contourGeometryRevision,
      mesh,
      spec: { minorInterval, majorEvery: 5, baseElevation: 0 },
    });
    // Production extractor on real geometry (same fn surfaceWorker.ts runs).
    const posted: Array<{ type: string; requestId: string }> = [];
    const live = mod.createSurfaceWorkerHandler({
      loadBuilder: async () => async () => {
        throw new Error('unused');
      },
      postMessage: (message: { type: string; requestId: string }) =>
        posted.push({ type: message.type, requestId: message.requestId }),
    });
    live.handleMessage({ type: 'contours', requestId: 'live', request: requestFor('gLive', 1) });
    for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
    const liveSuccess = posted.some((entry) => entry.type === 'contour-success' && entry.requestId === 'live');

    // Controllable seam: manually-resolved extractors, flushable defer queue.
    const posted2: Array<{ type: string; requestId: string }> = [];
    const defers: Array<() => void> = [];
    const resolvers: Record<string, (_value: unknown) => void> = {};
    // The extractor receives derived extract-args (not the request), so
    // resolvers are keyed by invocation order: call 0 = reqA, 1 = reqB.
    let calls = 0;
    const extractor = () =>
      new Promise((_resolve) => {
        resolvers[`call${calls++}`] = _resolve as (_value: unknown) => void;
      });
    const handler = mod.createSurfaceWorkerHandler({
      loadBuilder: async () => async () => {
        throw new Error('unused');
      },
      loadContourExtractor: async () => extractor,
      postMessage: (message: { type: string; requestId: string }) =>
        posted2.push({ type: message.type, requestId: message.requestId }),
      defer: (callback: () => void) => defers.push(callback),
    });
    const flushDefers = (): void => {
      const pending = defers.splice(0);
      for (const callback of pending) callback();
    };
    const tick = async (): Promise<void> => {
      for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
    };
    handler.handleMessage({ type: 'contours', requestId: 'reqA', request: requestFor('gA', 1) });
    handler.handleMessage({ type: 'contours', requestId: 'reqB', request: requestFor('gB', 2) });
    flushDefers();
    await tick();
    resolvers['call1']!({ stats: { segmentCount: 1 } });
    await tick();
    resolvers['call0']!({ stats: { segmentCount: 1 } });
    await tick();
    return {
      liveSuccess,
      successes: posted2.filter((entry) => entry.type === 'contour-success').map((entry) => entry.requestId),
    };
  }, '/src/workers/surfaceWorkerHandler.ts');
  expect(verdict.liveSuccess).toBe(true);
  // Latest-wins: only the newer geometry revision posts success; the
  // superseded interval-A derivation is discarded (injected order).
  expect(verdict.successes).toEqual(['reqB']);
  expect(errors).toEqual([]);
});
