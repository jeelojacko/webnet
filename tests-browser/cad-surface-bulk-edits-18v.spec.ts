/**
 * Phase 18V browser QA — bulk / region surface editing through the real /cad app.
 *
 * Playwright (dev-server + Chromium), NOT vitest. Drives the shipped UI:
 * ribbon SURFACE Select Points (Window/Polygon/All/Invert/Clear) + Edit group
 * bulk actions, the manager POINT SELECTION section, the bulk entry form,
 * ghost move preview, grouped edit rows / dependency warnings, undo, WNCAD
 * save/reopen, imported-TIN payload, PROJECTTRANSFORM vector mapping, and the
 * downstream analysis/contour/profile stale lifecycle. Zero page/console
 * errors is asserted per test.
 *
 * Drawing is generated in-test from the 18G seed: a 5x5 native point grid
 * (V<row><col> at (col*10,row*10), z = 100 + 0.1x + 0.2y, Tina mesh exactly
 * planar), with a breakline through V10–V11–V12, a straight alignment V-CL
 * for the profile, and a 3x3 imported LandXML TIN. One seeded drawing is
 * reused across the flows (regenerated per test — hard isolation).
 *
 * Flows (mission §107 A–N):
 * - 18V-1: A window interior set (count + highlight), B irregular polygon,
 *   Clear/Invert/All + source filter.
 * - 18V-2: C Set Selected Elevation (one row, exact Z, survey points
 *   unchanged via saved JSON), D Raise Selected (+ΔZ only), E Move Selected
 *   (ghost preview → translate → final XY), F invalid move (boundary +
 *   crossing) blocks whole op, L undo-during-build late result loses.
 * - 18V-3: G simultaneous multi-vertex move PASS, H stale selection commit
 *   blocked, I edit-created point in a bulk row + save/reopen stable,
 *   M imported TIN bulk with payload byte-identical.
 * - 18V-4: J manager disable/enable/reorder + dependency warning on bulk refs.
 * - 18V-5: K downstream analysis + contour + profile stale lifecycle.
 * - 18V-6: N PROJECTTRANSFORM vector mapping (delta scales, no translation).
 * - 18V-VISUAL: §108 visual evidence at 1366x768 / 1920x1080 / 2560x1440.
 */
import { expect, test, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const SEED = 'tests-browser/fixtures/cad-surface-18g-seed.wncad';
const SHOT_DIR = 'docs/evidence/phase18v';
const NATIVE_ID = 'v-native';
const NATIVE_NAME = 'V Native';
const IMPORTED_ID = 'v-imported';
const IMPORTED_NAME = 'V Imported';
const ENTITY_COUNT = 26; // 25 grid points + 1 alignment
const IMPORTED_VERTICES = [0, 0, 0, 10, 0, 1, 20, 0, 2, 0, 10, 3, 10, 10, 4, 20, 10, 5, 0, 20, 6, 10, 20, 7, 20, 20, 8];
const IMPORTED_FACES = [0, 1, 4, 0, 4, 3, 1, 2, 5, 1, 5, 4, 3, 4, 7, 3, 7, 6, 4, 5, 8, 4, 8, 7];

/** Base plan elevation for the planar native grid. */
const baseZ = (x: number, y: number): number => 100 + 0.1 * x + 0.2 * y;

async function gotoCad(page: Page, errors: string[]): Promise<void> {
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    errors.push(message.text());
  });
  page.on('dialog', (dialog) => void dialog.accept());
  await page.addInitScript(() => {
    const record = window as unknown as Record<string, unknown>;
    delete record.showSaveFilePicker;
    delete record.showOpenFilePicker;
  });
  await page.goto('/cad', { waitUntil: 'networkidle' });
  await expect(page.getByText('WebNet CAD', { exact: true }).first()).toBeVisible({ timeout: 30000 });
  await expect(page.locator('[data-cad-viewport]')).toBeVisible({ timeout: 30000 });
  fs.mkdirSync(SHOT_DIR, { recursive: true });
}

/** 5x5 planar native grid + breakline + alignment + 3x3 imported TIN. */
function makeDrawing(): string {
  const seed = JSON.parse(fs.readFileSync(SEED, 'utf8')) as { project: Record<string, unknown> };
  const entities: unknown[] = [];
  const nativeIds: string[] = [];
  for (let row = 0; row < 5; row += 1) {
    for (let col = 0; col < 5; col += 1) {
      const x = col * 10;
      const y = row * 10;
      const id = `v-pt-${row}${col}`;
      nativeIds.push(id);
      entities.push({
        id, type: 'survey-point', layerId: 'points', visible: true, locked: false,
        stationId: `V${row}${col}`, x, y, z: baseZ(x, y), pointClass: 'free', source: 'parsed-input',
      });
    }
  }
  entities.push({
    id: 'v-align-1', type: 'alignment', layerId: 'general', visible: true, locked: false,
    name: 'V-CL', elements: [{ kind: 'line', start: { x: -10, y: 25 }, end: { x: 50, y: 25 } }], startStation: 0,
  });
  (seed.project as { entities: unknown[] }).entities = entities;
  (seed.project as { pointGroups: unknown[] }).pointGroups = [];
  // The seed carries no bounds (view would default to ±10); pin the extents so
  // the whole grid is visible for world-coordinate canvas picks.
  (seed.project as { bounds: unknown }).bounds = { minX: -20, minY: -20, maxX: 60, maxY: 60 };
  // The seeded "No Display" style has no flags, and an unflagged style defaults
  // to showTriangles:true. Add an explicitly-empty style for stroke-free picks.
  (seed.project as { surfaceStyles: unknown[] }).surfaceStyles = [
    ...((seed.project as { surfaceStyles: unknown[] }).surfaceStyles ?? []),
    { id: 'v-empty', name: 'V Empty', showTriangles: false, showBoundary: false, showPoints: false },
  ];
  (seed.project as { surfaces: unknown[] }).surfaces = [
    {
      id: NATIVE_ID, name: NATIVE_NAME, styleId: 'surface-style-triangles', cachedRevision: null,
      definition: {
        pointSource: { kind: 'points', pointEntityIds: nativeIds },
        breaklines: [
          { id: 'v-bl', type: 'standard', name: 'v-row', source: { kind: 'point-chain', pointEntityIds: ['v-pt-10', 'v-pt-11', 'v-pt-12'] } },
        ],
        edits: [],
      },
    },
    {
      id: IMPORTED_ID, name: IMPORTED_NAME, styleId: 'surface-style-triangles', cachedRevision: null,
      definition: {
        pointSource: { kind: 'points', pointEntityIds: [] },
        sourceKind: 'imported-tin',
        importedTin: {
          vertices: [...IMPORTED_VERTICES],
          faces: [...IMPORTED_FACES],
          provenance: { format: 'LandXML', fileName: 'v.xml', surfaceName: 'Imported TIN', sourceId: 'sid-18v' },
        },
        edits: [],
      },
    },
  ];
  return JSON.stringify(seed);
}

async function openDrawing(page: Page, expectedEntities = ENTITY_COUNT): Promise<void> {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'webnet-18v-')), 'drawing.wncad');
  fs.writeFileSync(file, makeDrawing());
  const input = page.locator('[data-survey-cad-open-drawing-input]');
  await input.evaluate((element: HTMLInputElement) => element.classList.remove('hidden')).catch(() => {});
  await input.setInputFiles(file);
  await expect.poll(() => entityCount(page)).toBe(expectedEntities);
}

async function saveDrawingToTemp(page: Page): Promise<string> {
  const savedPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'webnet-18v-save-')), 'v.wncad');
  const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
  await ribbonTab(page, 'Home').click();
  await page.getByRole('button', { name: 'Save Drawing' }).first().click();
  const download = await downloadPromise;
  await download.saveAs(savedPath);
  return savedPath;
}

async function entityCount(page: Page): Promise<number> {
  const text = (await page.locator('[data-survey-cad-entity-count]').textContent()) ?? '';
  return Number.parseInt(text, 10);
}

function ribbonTab(page: Page, name: string) {
  return page.locator('[aria-label="Ribbon tabs"]').getByRole('tab', { name });
}

async function showSurveyTab(page: Page): Promise<void> {
  await page.locator('[aria-label="Toolspace tabs"]').getByRole('tab', { name: 'Survey' }).click();
}

function managerScope(page: Page) {
  return page.locator('section[aria-label="Surface manager"]');
}

/** The floating workspace properties overlay covers the dock while expanded. */
async function collapseFloatingPanel(page: Page): Promise<void> {
  const collapse = page.locator('button[title="Collapse panel body"]');
  if (await collapse.isVisible().catch(() => false)) await collapse.click();
}

async function openManager(page: Page): Promise<void> {
  await ribbonTab(page, 'Surface').click();
  await page.getByRole('button', { name: 'Add Point Group' }).first().click();
  await expect(managerScope(page)).toBeVisible({ timeout: 10000 });
  await collapseFloatingPanel(page);
}

async function closeManager(page: Page): Promise<void> {
  await managerScope(page).getByRole('button', { name: 'Close', exact: true }).click();
  await expect(managerScope(page)).toBeHidden({ timeout: 10000 });
}

async function selectManagerSurface(page: Page, name: string): Promise<void> {
  await managerScope(page).locator(`button[aria-label^="Surface ${name},"]`).first().click();
}

function toolspaceSurface(page: Page, id: string) {
  return page.locator(`[data-cad-toolspace] [data-cad-surface="${id}"]`);
}

async function surfaceStatus(page: Page, id: string): Promise<string> {
  return (await toolspaceSurface(page, id).getAttribute('data-cad-surface-status')) ?? '';
}

/** Profile status from the Toolspace tree (no manager required). */
async function profileStatusToolspace(page: Page, id: string): Promise<string> {
  return (await page.locator(`[data-cad-toolspace] [data-cad-profile="${id}"]`).getAttribute('data-cad-profile-status')) ?? '';
}

async function waitCurrent(page: Page, id: string): Promise<void> {
  await expect.poll(() => surfaceStatus(page, id), { timeout: 60000 }).toBe('CURRENT');
}

async function rebuildAndWait(page: Page, id: string): Promise<void> {
  await managerScope(page).getByRole('button', { name: 'Rebuild', exact: true }).click();
  await waitCurrent(page, id);
}

/** Select the native surface, rebuild it, and leave the manager open. */
async function prepareNative(page: Page): Promise<void> {
  await showSurveyTab(page);
  await openManager(page);
  await selectManagerSurface(page, NATIVE_NAME);
  await rebuildAndWait(page, NATIVE_ID);
}

/** Large map assets can cover the canvas corners; hide triangles for picks. */
async function setStyle(page: Page, label: string): Promise<void> {
  const select = managerScope(page).getByLabel('Surface style', { exact: true });
  await select.selectOption({ label });
  await expect(select).not.toHaveValue('');
}

/** Hide both generated surfaces so interior canvas picks reach the background. */
async function hideSurfaces(page: Page): Promise<void> {
  await selectManagerSurface(page, NATIVE_NAME);
  await setStyle(page, 'V Empty');
  await selectManagerSurface(page, IMPORTED_NAME);
  await setStyle(page, 'V Empty');
  await selectManagerSurface(page, NATIVE_NAME);
}

function ribbon(page: Page, key: string) {
  return page.locator(`[data-cad-surface="${key}"]`);
}

async function selectViaRibbon(page: Page, key: string): Promise<void> {
  await ribbonTab(page, 'Surface').click();
  await ribbon(page, key).click();
}

type Projector = (_x: number, _y: number) => Promise<{ x: number; y: number }>;

/**
 * World→client-pixel projector derived from two known rendered vertices and
 * the SVG screen CTM (accounts for viewBox + preserveAspectRatio).
 */
async function projector(page: Page): Promise<Projector> {
  const read = async (id: string) => {
    const loc = page.locator(`[data-survey-cad-preview] circle[data-survey-cad-entity-id="${id}"]`).first();
    await expect(loc).toBeAttached();
    return loc.evaluate((element) => ({ x: Number(element.getAttribute('cx')), y: Number(element.getAttribute('cy')) }));
  };
  const origin = await read('v-pt-00'); // world (0,0)
  const far = await read('v-pt-44'); // world (40,40)
  const sx = (far.x - origin.x) / 40;
  const sy = (far.y - origin.y) / 40;
  return (wx, wy) => page.evaluate(([vx, vy]) => {
    const svg = document.querySelector('[data-survey-cad-preview]') as SVGSVGElement;
    const point = svg.createSVGPoint();
    point.x = vx as number;
    point.y = vy as number;
    const at = point.matrixTransform(svg.getScreenCTM() as DOMMatrix);
    return { x: at.x, y: at.y };
  }, [origin.x + wx * sx, origin.y + wy * sy] as [number, number]);
}

async function clickWorld(page: Page, toPage: Projector, wx: number, wy: number): Promise<void> {
  const at = await toPage(wx, wy);
  await page.mouse.click(at.x, at.y);
}

async function windowSelect(page: Page, a: [number, number], b: [number, number]): Promise<void> {
  await selectViaRibbon(page, 'select-window');
  await collapseFloatingPanel(page);
  await expect(selectForm(page).locator('[data-cad-surface-bulk-status]')).toContainText('SURFSELECTPOINTS window');
  const toPage = await projector(page);
  await clickWorld(page, toPage, a[0], a[1]);
  await page.waitForTimeout(150);
  await clickWorld(page, toPage, b[0], b[1]);
}

async function polygonSelect(page: Page, points: Array<[number, number]>): Promise<void> {
  await selectViaRibbon(page, 'select-polygon');
  await collapseFloatingPanel(page);
  await expect(selectForm(page).locator('[data-cad-surface-bulk-status]')).toContainText('SURFSELECTPOINTS polygon');
  const toPage = await projector(page);
  for (const [x, y] of points) {
    await clickWorld(page, toPage, x, y);
    await page.waitForTimeout(150);
  }
}

function selectForm(page: Page) {
  return page.locator('[data-cad-surface-bulk-form="select"]');
}

async function commitSelection(page: Page): Promise<void> {
  await selectForm(page).getByRole('button', { name: 'Commit selection' }).click();
  await expect(selectForm(page)).toBeHidden();
}

async function selectionCount(page: Page, surfaceId: string): Promise<number> {
  const heading = managerScope(page).locator(`[data-cad-surface-selection="${surfaceId}"] h3`);
  const text = (await heading.textContent()) ?? '';
  const match = text.match(/Selected:\s*(\d+)/);
  return match ? Number.parseInt(match[1] as string, 10) : -1;
}

async function highlightCount(page: Page): Promise<number> {
  return page.locator('[data-survey-cad-preview] circle[data-survey-cad-render-entity-id="surface-bulk-overlay"]').count();
}

function bulkForm(page: Page, kind: string) {
  return page.locator(`[data-cad-surface-bulk-form="${kind}"]`);
}

async function startBulk(page: Page, key: string, kind: string): Promise<void> {
  await selectViaRibbon(page, key);
  await expect(bulkForm(page, kind)).toBeVisible({ timeout: 10000 });
}

async function stageValue(page: Page, kind: string, value: string): Promise<void> {
  const form = bulkForm(page, kind);
  const input = form.locator('input[aria-label="Stage value"]');
  await input.fill(value);
  await input.press('Enter');
}

async function stageMove(page: Page, base: [number, number], dest: [number, number]): Promise<void> {
  const form = bulkForm(page, 'move');
  const stage = async (x: number, y: number): Promise<void> => {
    await form.locator('input[aria-label="Stage X"]').fill(String(x));
    await form.locator('input[aria-label="Stage Y"]').fill(String(y));
    await form.getByRole('button', { name: 'Stage point' }).click();
  };
  await stage(base[0], base[1]);
  await stage(dest[0], dest[1]);
}

async function commitBulk(page: Page, kind: string): Promise<void> {
  await bulkForm(page, kind).getByRole('button', { name: 'Commit bulk edit' }).click();
  await expect(bulkForm(page, kind)).toBeHidden();
}

async function cancelBulk(page: Page, kind: string): Promise<void> {
  await bulkForm(page, kind).getByRole('button', { name: 'Cancel' }).click();
  await expect(bulkForm(page, kind)).toBeHidden();
}

async function editRowCount(page: Page, id: string): Promise<number> {
  return managerScope(page).locator(`[data-cad-surface-edits="${id}"] [data-cad-surface-edit]`).count();
}

async function inquiryElevation(page: Page, surfaceName: string, x: number, y: number): Promise<string> {
  const panel = managerScope(page)
    .locator('div')
    .filter({ has: page.getByRole('heading', { name: `Inquiry — ${surfaceName}` }) })
    .last();
  await page.getByLabel('Inquiry easting', { exact: true }).fill(String(x));
  await page.getByLabel('Inquiry northing', { exact: true }).fill(String(y));
  await panel.getByRole('button', { name: 'Query', exact: true }).click();
  const answer = panel.locator('[role="status"]').last();
  await expect(answer).not.toHaveText('No query yet.');
  return (await answer.textContent()) ?? '';
}

/** Raise the surface, then wait for the auto-queued rebuild. */
async function raiseSelected(page: Page, delta: string): Promise<void> {
  await startBulk(page, 'bulk-raise-lower', 'raise-lower');
  await stageValue(page, 'raise-lower', delta);
  await commitBulk(page, 'raise-lower');
}

async function setSelectedZ(page: Page, z: string): Promise<void> {
  await startBulk(page, 'bulk-set-z', 'set-elevation');
  await stageValue(page, 'set-elevation', z);
  await commitBulk(page, 'set-elevation');
}

test('18V-1: A window interior set (count + highlight), B irregular polygon, Clear/Invert/All/filter', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  await gotoCad(page, errors);
  await openDrawing(page);
  await prepareNative(page);
  await closeManager(page);

  // A: inclusive window over the x=0 column (both corners outside the mesh hull).
  await windowSelect(page, [-5, -5], [5, 45]);
  await expect(selectForm(page).locator('[data-cad-surface-bulk-status]')).toContainText('5 vertices inside');
  await commitSelection(page);
  await openManager(page);
  await expect.poll(() => selectionCount(page, NATIVE_ID)).toBe(5);
  await expect.poll(() => highlightCount(page)).toBe(5);
  await page.screenshot({ path: `${SHOT_DIR}/18v-1-window-highlight.png` });

  // B: irregular rotated-square polygon centred on (20,20) → 13 strictly-interior refs.
  await closeManager(page);
  await polygonSelect(page, [[-5, 20], [20, -5], [45, 20], [20, 45]]);
  await expect(selectForm(page).locator('[data-cad-surface-bulk-status]')).toContainText('13 inside');
  await commitSelection(page);
  await openManager(page);
  await expect.poll(() => selectionCount(page, NATIVE_ID)).toBe(13);
  await expect.poll(() => highlightCount(page)).toBe(13);

  // Clear → none.
  await selectViaRibbon(page, 'select-clear');
  await expect.poll(() => selectionCount(page, NATIVE_ID)).toBe(0);
  await expect.poll(() => highlightCount(page)).toBe(0);

  // All = every stable editable ref; Invert of All = none; filter by source.
  await selectViaRibbon(page, 'select-all');
  await expect.poll(() => selectionCount(page, NATIVE_ID)).toBe(25);
  await managerScope(page).getByLabel('Selection source filter').selectOption('imported');
  await expect.poll(() => selectionCount(page, NATIVE_ID)).toBe(0);
  await managerScope(page).getByLabel('Selection source filter').selectOption('source');
  await expect.poll(() => selectionCount(page, NATIVE_ID)).toBe(25);
  await selectViaRibbon(page, 'select-invert');
  await expect.poll(() => selectionCount(page, NATIVE_ID)).toBe(0);
  expect(errors).toEqual([]);
});

test('18V-2: C set-Z (exact Z + survey points unchanged), D raise, E move ghost + final XY, F invalid move, L undo-during-build', async ({ page }) => {
  test.setTimeout(480_000);
  const errors: string[] = [];
  await gotoCad(page, errors);
  await openDrawing(page);
  await prepareNative(page);
  await hideSurfaces(page);
  await closeManager(page);

  // C: Set Selected Elevation on the 2x2 interior block (free vertices).
  await windowSelect(page, [15, 15], [35, 35]);
  await expect(selectForm(page).locator('[data-cad-surface-bulk-status]')).toContainText('4 vertices inside');
  await commitSelection(page);
  await setSelectedZ(page, '150');
  await openManager(page);
  await expect.poll(() => editRowCount(page, NATIVE_ID), { timeout: 30000 }).toBe(1);
  await expect(managerScope(page).locator('[data-cad-surface-edit]')).toContainText('Set Elevation (bulk)');
  await expect(managerScope(page).locator('[data-cad-surface-edit]')).toContainText('4 vertices');
  await expect(managerScope(page).locator('[data-cad-surface-edit]')).toContainText('150.000');
  await waitCurrent(page, NATIVE_ID);
  expect(await inquiryElevation(page, NATIVE_NAME, 20, 20)).toContain('elevation 150.000');
  expect(await inquiryElevation(page, NATIVE_NAME, 10, 10)).toContain('elevation 103.000');
  await closeManager(page);

  // D: Raise Selected by +5 — only the selected vertices move.
  await windowSelect(page, [15, 15], [35, 35]);
  await commitSelection(page);
  await raiseSelected(page, '5');
  await openManager(page);
  await expect.poll(() => editRowCount(page, NATIVE_ID), { timeout: 30000 }).toBe(2);
  await expect(managerScope(page).locator('[data-cad-surface-edit]').nth(1)).toContainText('Raise/Lower (selected)');
  await expect(managerScope(page).locator('[data-cad-surface-edit]').nth(1)).toContainText('+5.000');
  await waitCurrent(page, NATIVE_ID);
  expect(await inquiryElevation(page, NATIVE_NAME, 20, 20)).toContain('elevation 155.000');
  await closeManager(page);

  // E: Move Selected (1,1) — ghost preview, then exact final XY (Z unchanged).
  await windowSelect(page, [15, 15], [35, 35]);
  await commitSelection(page);
  await startBulk(page, 'bulk-move', 'move');
  await stageMove(page, [0, 0], [1, 1]);
  await expect(bulkForm(page, 'move').locator('[data-cad-surface-bulk-status]')).toContainText('Move staged');
  await expect.poll(() => page.locator('[data-survey-cad-preview] line[data-survey-cad-render-entity-id="surface-bulk-overlay"]').count())
    .toBeGreaterThanOrEqual(4);
  await page.screenshot({ path: `${SHOT_DIR}/18v-2-move-ghost.png` });
  await commitBulk(page, 'move');
  await openManager(page);
  await expect.poll(() => editRowCount(page, NATIVE_ID), { timeout: 30000 }).toBe(3);
  await expect(managerScope(page).locator('[data-cad-surface-edit]').nth(2)).toContainText('Move Points');
  await expect(managerScope(page).locator('[data-cad-surface-edit]').nth(2)).toContainText('(1.000, 1.000)');
  await waitCurrent(page, NATIVE_ID);
  expect(await inquiryElevation(page, NATIVE_NAME, 21, 21)).toContain('elevation 155.000');
  await closeManager(page);

  // F(a): Select All includes boundary/constrained vertices → whole move blocks.
  await selectViaRibbon(page, 'select-all');
  await startBulk(page, 'bulk-move', 'move');
  await stageMove(page, [0, 0], [1, 1]);
  await expect(bulkForm(page, 'move').locator('[data-cad-surface-bulk-status]'))
    .toContainText(/blocked \(SURFACE_EDIT_MOVE_POINT_(BOUNDARY|CONSTRAINED)\)/);
  await cancelBulk(page, 'move');

  // F(b): crossing move of the free interior set blocks all-or-nothing.
  await selectViaRibbon(page, 'select-clear');
  await windowSelect(page, [15, 15], [35, 35]);
  await commitSelection(page);
  await startBulk(page, 'bulk-move', 'move');
  await stageMove(page, [0, 0], [60, 0]);
  await expect(bulkForm(page, 'move').locator('[data-cad-surface-bulk-status]')).toContainText(/blocked \(SURFACE_EDIT_MOVE_POINT_/);
  await page.screenshot({ path: `${SHOT_DIR}/18v-2-invalid-move.png` });
  await cancelBulk(page, 'move');
  await openManager(page);
  expect(await editRowCount(page, NATIVE_ID)).toBe(3);
  await closeManager(page);

  // L: undo during the worker build — the late result never resurrects the edit.
  await windowSelect(page, [15, 15], [35, 35]);
  await commitSelection(page);
  await setSelectedZ(page, '160');
  await ribbonTab(page, 'Home').click();
  await page.locator('[data-cad-command="SHELL_UNDO"]').click();
  await openManager(page);
  await expect.poll(() => editRowCount(page, NATIVE_ID), { timeout: 30000 }).toBe(3);
  await waitCurrent(page, NATIVE_ID);
  expect(await editRowCount(page, NATIVE_ID)).toBe(3);
  await ribbonTab(page, 'Home').click();
  await page.locator('[data-cad-command="SHELL_REDO"]').click();
  await expect.poll(() => editRowCount(page, NATIVE_ID), { timeout: 30000 }).toBe(4);
  await waitCurrent(page, NATIVE_ID);

  // Survey Points unchanged + all three bulk kinds persisted.
  await closeManager(page);
  const savedPath = await saveDrawingToTemp(page);
  const doc = JSON.parse(fs.readFileSync(savedPath, 'utf8')) as {
    project: {
      entities: Array<{ id: string; type: string; z?: number }>;
      surfaces: Array<{ id: string; definition: { edits: Array<{ kind: string; vertices?: Array<{ key: string }> }> } }>;
    };
  };
  expect(doc.project.entities).toHaveLength(ENTITY_COUNT);
  expect(doc.project.entities.find((entry) => entry.id === 'v-pt-00')?.z).toBe(100);
  expect(doc.project.entities.find((entry) => entry.id === 'v-pt-22')?.z).toBe(baseZ(20, 20));
  const native = doc.project.surfaces.find((entry) => entry.id === NATIVE_ID);
  const kinds = (native?.definition.edits ?? []).map((edit) => edit.kind);
  expect(kinds).toContain('set-elevation-many');
  expect(kinds).toContain('raise-lower-points');
  expect(kinds).toContain('move-points');
  fs.rmSync(path.dirname(savedPath), { recursive: true, force: true });
  expect(errors).toEqual([]);
});

test('18V-3: G simultaneous move PASS, H stale selection blocked, I edit-created ref in bulk + reopen, M imported payload unchanged', async ({ page }) => {
  test.setTimeout(480_000);
  const errors: string[] = [];
  await gotoCad(page, errors);
  await openDrawing(page);
  await prepareNative(page);
  await hideSurfaces(page);
  await closeManager(page);

  // G: simultaneous rigid translation of 4 adjacent interior vertices.
  await windowSelect(page, [15, 15], [35, 35]);
  await commitSelection(page);
  await startBulk(page, 'bulk-move', 'move');
  await stageMove(page, [0, 0], [1, 1]);
  await expect(bulkForm(page, 'move').locator('[data-cad-surface-bulk-status]')).toContainText('Move staged');
  await commitBulk(page, 'move');
  await openManager(page);
  await expect.poll(() => editRowCount(page, NATIVE_ID), { timeout: 30000 }).toBe(1);
  await waitCurrent(page, NATIVE_ID);
  // Every one of the four proposed final positions is now a mesh vertex.
  expect(await inquiryElevation(page, NATIVE_NAME, 21, 21)).toContain('elevation 106.000');
  expect(await inquiryElevation(page, NATIVE_NAME, 31, 21)).toContain('elevation 107.000');
  await closeManager(page);

  // H: stale selection after a source-revision change blocks the bulk commit.
  await windowSelect(page, [-5, -5], [5, 45]);
  await commitSelection(page);
  await openManager(page);
  await expect.poll(() => selectionCount(page, NATIVE_ID)).toBe(5);
  await closeManager(page);
  const addForm = page.locator('[data-cad-surface-point-form="add-point"]');
  await selectViaRibbon(page, 'add-point');
  await expect(addForm).toBeVisible({ timeout: 10000 });
  await addForm.locator('input[aria-label="Stage X"]').fill('15');
  await addForm.locator('input[aria-label="Stage Y"]').fill('35');
  await addForm.getByRole('button', { name: 'Stage', exact: true }).click();
  await addForm.getByRole('button', { name: 'Commit point edit' }).click();
  // Add-point keeps its session open after commit (pick again) — the edit row
  // is the authoritative signal; starting the bulk session ends it.
  await openManager(page);
  await expect.poll(() => editRowCount(page, NATIVE_ID), { timeout: 30000 }).toBe(2);
  await waitCurrent(page, NATIVE_ID);
  await expect(managerScope(page).locator(`[data-cad-surface-selection="${NATIVE_ID}"] [data-cad-selection-stale]`)).toBeVisible();
  await managerScope(page).locator(`[data-cad-surface-selection="${NATIVE_ID}"] [data-cad-selection-action="set-elevation"]`).click();
  await expect(page.locator('[data-survey-cad-file-status]')).toContainText(/SURFACE_EDIT_STALE_REVISION|reselect/i);
  await expect.poll(() => selectionCount(page, NATIVE_ID)).toBe(0);
  expect(await editRowCount(page, NATIVE_ID)).toBe(2);

  // I: bulk row consumes the edit-created (E1) vertex; stack survives save/reopen.
  await selectViaRibbon(page, 'select-all');
  await expect.poll(() => selectionCount(page, NATIVE_ID)).toBe(26);
  await setSelectedZ(page, '175');
  await expect.poll(() => editRowCount(page, NATIVE_ID), { timeout: 30000 }).toBe(3);
  await waitCurrent(page, NATIVE_ID);
  const savedPath = await saveDrawingToTemp(page);
  const doc = JSON.parse(fs.readFileSync(savedPath, 'utf8')) as {
    project: {
      entities: unknown[];
      surfaces: Array<{ id: string; definition: { edits: Array<{ kind: string; vertices?: Array<{ key: string }> }> } }>;
    };
  };
  expect(doc.project.entities).toHaveLength(ENTITY_COUNT);
  const nativeEdits = doc.project.surfaces.find((entry) => entry.id === NATIVE_ID)?.definition.edits ?? [];
  expect(nativeEdits).toHaveLength(3);
  const bulkEdit = nativeEdits.find((edit) => edit.kind === 'set-elevation-many');
  expect(bulkEdit?.vertices?.some((vertex) => vertex.key.startsWith('edit:'))).toBe(true);
  await page.goto('/cad', { waitUntil: 'networkidle' });
  await expect(page.getByText('WebNet CAD', { exact: true }).first()).toBeVisible({ timeout: 30000 });
  const fileInput = page.locator('[data-survey-cad-open-drawing-input]');
  await fileInput.evaluate((element: HTMLInputElement) => element.classList.remove('hidden')).catch(() => {});
  await fileInput.setInputFiles(savedPath);
  await expect.poll(() => entityCount(page)).toBe(ENTITY_COUNT);
  await showSurveyTab(page);
  await openManager(page);
  await selectManagerSurface(page, NATIVE_NAME);
  await expect.poll(() => editRowCount(page, NATIVE_ID), { timeout: 30000 }).toBe(3);
  await rebuildAndWait(page, NATIVE_ID);

  // M: imported TIN bulk set — payload byte-identical, edit recorded.
  await selectManagerSurface(page, IMPORTED_NAME);
  await rebuildAndWait(page, IMPORTED_ID);
  await closeManager(page);
  await selectViaRibbon(page, 'select-all');
  await startBulk(page, 'bulk-set-z', 'set-elevation');
  await stageValue(page, 'set-elevation', '55');
  await commitBulk(page, 'set-elevation');
  await openManager(page);
  await expect.poll(() => editRowCount(page, IMPORTED_ID), { timeout: 30000 }).toBe(1);
  await waitCurrent(page, IMPORTED_ID);
  await closeManager(page);
  const importedSave = await saveDrawingToTemp(page);
  const importedDoc = JSON.parse(fs.readFileSync(importedSave, 'utf8')) as {
    project: {
      surfaces: Array<{
        id: string;
        definition: {
          importedTin?: { vertices: number[]; faces: number[] };
          edits: Array<{ kind: string; vertices?: Array<{ key: string }> }>;
        };
      }>;
    };
  };
  const imported = importedDoc.project.surfaces.find((entry) => entry.id === IMPORTED_ID);
  expect(imported?.definition.importedTin?.vertices).toEqual(IMPORTED_VERTICES);
  expect(imported?.definition.importedTin?.faces).toEqual(IMPORTED_FACES);
  expect(imported?.definition.edits).toHaveLength(1);
  expect(imported?.definition.edits[0]?.kind).toBe('set-elevation-many');
  expect(imported?.definition.edits[0]?.vertices).toHaveLength(9);
  fs.rmSync(path.dirname(savedPath), { recursive: true, force: true });
  fs.rmSync(path.dirname(importedSave), { recursive: true, force: true });
  expect(errors).toEqual([]);
});

test('18V-4: J manager disable/enable/reorder + dependency warning on bulk refs', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  await gotoCad(page, errors);
  await openDrawing(page);
  await prepareNative(page);
  await closeManager(page);

  // Producer: single-point Add Point (creates E1); consumer: bulk set over all refs.
  const addForm = page.locator('[data-cad-surface-point-form="add-point"]');
  await selectViaRibbon(page, 'add-point');
  await expect(addForm).toBeVisible({ timeout: 10000 });
  await addForm.locator('input[aria-label="Stage X"]').fill('15');
  await addForm.locator('input[aria-label="Stage Y"]').fill('35');
  await addForm.getByRole('button', { name: 'Stage', exact: true }).click();
  await addForm.getByRole('button', { name: 'Commit point edit' }).click();
  await openManager(page);
  await expect.poll(() => editRowCount(page, NATIVE_ID), { timeout: 30000 }).toBe(1);
  await waitCurrent(page, NATIVE_ID);
  await closeManager(page);

  await selectViaRibbon(page, 'select-all');
  await setSelectedZ(page, '130');
  await openManager(page);
  await expect.poll(() => editRowCount(page, NATIVE_ID), { timeout: 30000 }).toBe(2);
  await waitCurrent(page, NATIVE_ID);
  const manager = managerScope(page);
  const rows = manager.locator('[data-cad-surface-edit]');

  // Reorder consumer before producer blocks with a producer reason.
  await rows.nth(1).locator('[data-cad-edit-action="up"]').click();
  await expect(manager.getByRole('status').first()).toContainText(/producer/i);
  expect(await editRowCount(page, NATIVE_ID)).toBe(2);

  // Disable the add-point producer → bulk consumer reports a disabled producer.
  await rows.nth(0).locator('[data-cad-edit-action="toggle"]').click();
  await expect(manager.locator('[data-cad-edit-dependency-warning]')).toContainText('disabled producer', { timeout: 30000 });
  await expect.poll(() => editRowCount(page, NATIVE_ID), { timeout: 30000 }).toBe(2);
  await rows.nth(0).locator('[data-cad-edit-action="toggle"]').click();
  await expect(manager.locator('[data-cad-edit-dependency-warning]')).toHaveCount(0, { timeout: 30000 });

  // Disable/enable the bulk row itself keeps the stack intact.
  await rows.nth(1).locator('[data-cad-edit-action="toggle"]').click();
  await expect(rows.nth(1)).toContainText('No');
  await editRowCount(page, NATIVE_ID);
  await rows.nth(1).locator('[data-cad-edit-action="toggle"]').click();
  await expect(rows.nth(1)).toContainText('Yes');
  expect(await editRowCount(page, NATIVE_ID)).toBe(2);
  expect(errors).toEqual([]);
});

test('18V-5: K downstream analysis + contour + profile stale lifecycle after a bulk edit', async ({ page }) => {
  test.setTimeout(480_000);
  const errors: string[] = [];
  await gotoCad(page, errors);
  await openDrawing(page);
  await prepareNative(page);

  // Contours on (Triangles style + Show contours), stays CURRENT.
  await setStyle(page, 'Triangles');
  await managerScope(page).getByLabel('Show contours').check();
  await managerScope(page).getByRole('button', { name: 'Apply geometry' }).click();
  const surfaceLayer = page.locator(`[data-surface-layer="${NATIVE_ID}"]`);
  await expect.poll(() => surfaceLayer.getAttribute('data-surface-contours'), { timeout: 60000 }).toBe('true');

  // Analysis map CURRENT.
  await managerScope(page).locator('[data-cad-analysis-new-elevation]').click();
  const analysisId = (await managerScope(page).locator('[data-cad-analysis-list] [data-cad-analysis]').last().getAttribute('data-cad-analysis')) as string;
  await managerScope(page).locator(`[data-cad-analysis="${analysisId}"]`).click();
  await managerScope(page).locator('[data-cad-analysis-calculate]').click();
  await expect.poll(() => managerScope(page).locator(`[data-cad-analysis="${analysisId}"]`).getAttribute('data-cad-analysis-status'), { timeout: 60000 }).toBe('CURRENT');
  await closeManager(page);

  // Profile CURRENT against the native surface.
  await ribbonTab(page, 'Surface').click();
  await page.getByRole('button', { name: 'Profile Manager', exact: true }).first().click();
  const profileManager = page.locator('section[aria-label="Profile manager"]');
  await expect(profileManager).toBeVisible({ timeout: 10000 });
  await profileManager.getByLabel('New profile name').fill('V-EG');
  await profileManager.getByLabel('New profile alignment').selectOption({ label: 'V-CL' });
  await profileManager.getByLabel('New profile surface').selectOption({ label: NATIVE_NAME });
  await profileManager.getByRole('button', { name: 'Create Surface Profile' }).click();
  const profileId = (await profileManager.locator('[data-profile-list] [data-cad-profile]').last().getAttribute('data-cad-profile')) as string;
  await profileManager.locator(`[data-profile-list] [data-cad-profile="${profileId}"]`).click();
  await profileManager.locator('[data-profile-detail]').getByRole('button', { name: 'Rebuild', exact: true }).click();
  await expect.poll(() => profileStatusToolspace(page, profileId), { timeout: 60000 }).toBe('CURRENT');
  await profileManager.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(profileManager).toBeHidden();

  // Bulk edit commits and auto-rebuilds; downstream never stays falsely CURRENT.
  await selectViaRibbon(page, 'select-all');
  await setSelectedZ(page, '120');
  await waitCurrent(page, NATIVE_ID);
  await openManager(page);
  const analysisStatus = (): Promise<string | null> =>
    managerScope(page).locator(`[data-cad-analysis="${analysisId}"]`).getAttribute('data-cad-analysis-status');
  // The analysis saw the source revision change → NEEDS_RECALC (retained, not CURRENT).
  await expect.poll(analysisStatus, { timeout: 60000 }).toBe('NEEDS_RECALC');
  await expect.poll(() => profileStatusToolspace(page, profileId)).not.toBe('CURRENT');

  // Deterministic stale window: disable the bulk row (no auto-rebuild), so the
  // retained mesh is honestly NEEDS_REBUILD and every consumer goes stale.
  const bulkRow = managerScope(page).locator('[data-cad-surface-edits] [data-cad-surface-edit]').first();
  await bulkRow.locator('[data-cad-edit-action="toggle"]').click();
  await expect.poll(() => surfaceStatus(page, NATIVE_ID), { timeout: 60000 }).toBe('NEEDS_REBUILD');
  await expect.poll(() => surfaceLayer.getAttribute('data-surface-stale')).toBe('true');
  await expect.poll(() => surfaceLayer.getAttribute('data-surface-contours')).toBe('true');
  await expect.poll(analysisStatus).toBe('SOURCE_NOT_CURRENT');
  await expect.poll(() => profileStatusToolspace(page, profileId)).toBe('SOURCE_NOT_CURRENT');
  await page.screenshot({ path: `${SHOT_DIR}/18v-5-stale.png` });

  // Re-enable + rebuild chain restores CURRENT; analysis needs an explicit recalc.
  await bulkRow.locator('[data-cad-edit-action="toggle"]').click();
  await rebuildAndWait(page, NATIVE_ID);
  await expect.poll(() => surfaceLayer.getAttribute('data-surface-stale')).toBeNull();
  await expect.poll(analysisStatus).toBe('NEEDS_RECALC');
  await managerScope(page).locator(`[data-cad-analysis="${analysisId}"]`).click();
  await managerScope(page).locator('[data-cad-analysis-calculate]').click();
  await expect.poll(analysisStatus, { timeout: 60000 }).toBe('CURRENT');
  await closeManager(page);
  await ribbonTab(page, 'Surface').click();
  await page.getByRole('button', { name: 'Profile Manager', exact: true }).first().click();
  await expect.poll(() => profileStatusToolspace(page, profileId), { timeout: 60000 }).not.toBe('CURRENT');
  await profileManager.locator(`[data-profile-list] [data-cad-profile="${profileId}"]`).click();
  await profileManager.locator('[data-profile-detail]').getByRole('button', { name: 'Rebuild', exact: true }).click();
  await expect.poll(() => profileStatusToolspace(page, profileId), { timeout: 60000 }).toBe('CURRENT');
  await page.screenshot({ path: `${SHOT_DIR}/18v-5-post-rebuild.png` });
  expect(errors).toEqual([]);
});

test('18V-6: N PROJECTTRANSFORM vector mapping (move delta scales, set-Z invariant)', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  await gotoCad(page, errors);
  await openDrawing(page);
  await prepareNative(page);
  await hideSurfaces(page);
  await closeManager(page);

  await windowSelect(page, [15, 15], [35, 35]);
  await commitSelection(page);
  await startBulk(page, 'bulk-move', 'move');
  await stageMove(page, [0, 0], [2, 2]);
  await commitBulk(page, 'move');
  await openManager(page);
  await expect.poll(() => editRowCount(page, NATIVE_ID), { timeout: 30000 }).toBe(1);
  await expect(managerScope(page).locator('[data-cad-surface-edit]').first()).toContainText('(2.000, 2.000)');

  const rows = await managerScope(page).locator('[data-cad-surface-edits] [data-cad-surface-edit]').count();
  expect(rows).toBe(1);
  await closeManager(page);

  // Grid/Ground combined factor 0.5 about the origin = Grid→Ground scale 2:
  // the move displacement vector scales, the set-Z value is frame-invariant.
  await ribbonTab(page, 'Home').click();
  await page.locator('[data-cad-command="PROJECTTRANSFORM"]').click();
  const panel = page.locator('[data-survey-cad-project-transform-panel]');
  await expect(panel).toBeVisible({ timeout: 10000 });
  await panel.getByRole('button', { name: 'Grid/Ground' }).click();
  await page.locator('[data-project-transform-origin-input]').fill('0,0');
  await page.locator('[data-project-transform-origin-set]').click();
  await page.locator('[data-project-transform-factor-input]').fill('0.5');
  await page.locator('[data-project-transform-factor-set]').click();
  await page.locator('[data-project-transform-apply]').click();
  await expect(panel).toBeHidden({ timeout: 30000 });

  await openManager(page);
  await selectManagerSurface(page, NATIVE_NAME);
  await expect.poll(() => editRowCount(page, NATIVE_ID), { timeout: 30000 }).toBe(1);
  await expect(managerScope(page).locator('[data-cad-surface-edit]').first()).toContainText('(4.000, 4.000)');
  await rebuildAndWait(page, NATIVE_ID);

  // Add a set-Z edit; a second transform leaves z bit-identical while the
  // move delta scales again.
  await closeManager(page);
  await selectViaRibbon(page, 'select-all');
  await setSelectedZ(page, '140');
  await openManager(page);
  await expect.poll(() => editRowCount(page, NATIVE_ID), { timeout: 30000 }).toBe(2);
  await waitCurrent(page, NATIVE_ID);
  await expect(managerScope(page).locator('[data-cad-surface-edit]').nth(1)).toContainText('140.000');
  await closeManager(page);

  await ribbonTab(page, 'Home').click();
  await page.locator('[data-cad-command="PROJECTTRANSFORM"]').click();
  await expect(panel).toBeVisible({ timeout: 10000 });
  await panel.getByRole('button', { name: 'Grid/Ground' }).click();
  await page.locator('[data-project-transform-origin-input]').fill('0,0');
  await page.locator('[data-project-transform-origin-set]').click();
  await page.locator('[data-project-transform-factor-input]').fill('0.5');
  await page.locator('[data-project-transform-factor-set]').click();
  await page.locator('[data-project-transform-apply]').click();
  await expect(panel).toBeHidden({ timeout: 30000 });
  await openManager(page);
  await selectManagerSurface(page, NATIVE_NAME);
  await expect(managerScope(page).locator('[data-cad-surface-edit]').first()).toContainText('(8.000, 8.000)');
  await expect(managerScope(page).locator('[data-cad-surface-edit]').nth(1)).toContainText('140.000');
  expect(errors).toEqual([]);
});

test('18V-VISUAL: §108 evidence at 1366x768 / 1920x1080 / 2560x1440', async ({ page }) => {
  test.setTimeout(600_000);
  const errors: string[] = [];
  await gotoCad(page, errors);
  for (const [width, height] of [[1366, 768], [1920, 1080], [2560, 1440]] as const) {
    // Unmount the previous app before resizing: a live resize can trip the
    // app's resize effects (spurious "Maximum update depth exceeded").
    await page.goto('about:blank');
    await page.setViewportSize({ width, height });
    await page.goto('/cad', { waitUntil: 'networkidle' });
    await expect(page.getByText('WebNet CAD', { exact: true }).first()).toBeVisible({ timeout: 30000 });
    await openDrawing(page);
    await prepareNative(page);
    await setStyle(page, 'Triangles');
    await managerScope(page).getByLabel('Show contours').check();
    await managerScope(page).getByRole('button', { name: 'Apply geometry' }).click();
    const layer = page.locator(`[data-surface-layer="${NATIVE_ID}"]`);
    await expect.poll(() => layer.getAttribute('data-surface-contours'), { timeout: 60000 }).toBe('true');
    await managerScope(page).locator('[data-cad-analysis-new-elevation]').click();
    const analysisId = (await managerScope(page).locator('[data-cad-analysis-list] [data-cad-analysis]').last().getAttribute('data-cad-analysis')) as string;
    await managerScope(page).locator(`[data-cad-analysis="${analysisId}"]`).click();
    await managerScope(page).locator('[data-cad-analysis-calculate]').click();
    await expect.poll(() => managerScope(page).locator(`[data-cad-analysis="${analysisId}"]`).getAttribute('data-cad-analysis-status'), { timeout: 60000 }).toBe('CURRENT');
    await closeManager(page);
    const shot = async (scene: string): Promise<void> => {
      await page.screenshot({ path: `${SHOT_DIR}/${scene}-${width}x${height}.png` });
    };

    // Selection window preview → committed highlight.
    await windowSelect(page, [-5, -5], [5, 45]);
    await shot('selection-window');
    await commitSelection(page);
    await shot('highlighted-points');

    // Polygon preview.
    await polygonSelect(page, [[-5, 20], [20, -5], [45, 20], [20, 45]]);
    await shot('polygon-selection');
    await commitSelection(page);

    // Set-Z / Raise previews (no geometry ghost; highlight + entry form).
    await startBulk(page, 'bulk-set-z', 'set-elevation');
    await stageValue(page, 'set-elevation', '120');
    await shot('set-z-preview');
    await commitBulk(page, 'set-elevation');
    await selectViaRibbon(page, 'select-all');
    await startBulk(page, 'bulk-raise-lower', 'raise-lower');
    await stageValue(page, 'raise-lower', '3');
    await shot('raise-preview');
    await commitBulk(page, 'raise-lower');

    // Free-interior selection needs no triangles in the way.
    await openManager(page);
    await hideSurfaces(page);
    await closeManager(page);
    await selectViaRibbon(page, 'select-clear');
    await windowSelect(page, [15, 15], [35, 35]);
    await commitSelection(page);
    await openManager(page);
    await setStyle(page, 'Triangles');
    await closeManager(page);
    await startBulk(page, 'bulk-move', 'move');
    await stageMove(page, [0, 0], [1, 1]);
    await shot('move-ghost');
    // Invalid: huge crossing displacement turns the ghost red / blocks.
    await stageMove(page, [0, 0], [60, 0]);
    await shot('invalid-move-warning');
    await cancelBulk(page, 'move');

    // Grouped bulk rows in the manager.
    await openManager(page);
    await shot('grouped-bulk-rows');
    await closeManager(page);

    // Post-rebuild analysis + contours.
    await openManager(page);
    await rebuildAndWait(page, NATIVE_ID);
    await managerScope(page).locator(`[data-cad-analysis="${analysisId}"]`).click();
    await managerScope(page).locator('[data-cad-analysis-calculate]').click();
    await expect.poll(() => managerScope(page).locator(`[data-cad-analysis="${analysisId}"]`).getAttribute('data-cad-analysis-status'), { timeout: 60000 }).toBe('CURRENT');
    await closeManager(page);
    await shot('post-rebuild-analysis-contour');
  }
  expect(errors).toEqual([]);
});
