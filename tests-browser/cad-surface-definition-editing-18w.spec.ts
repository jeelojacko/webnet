/**
 * Phase 18W browser QA — boundary/breakline source editing through the real /cad app.
 *
 * Playwright (dev-server + Chromium), NOT vitest. Drives the shipped UI:
 * ribbon Surface Breaklines/Boundaries buttons (imported-TIN disabled),
 * the manager BREAKLINES/BOUNDARIES tables, the chain editor (ordered E/N/Z
 * rows, insert/remove/reorder/replace/rename/reverse/convert), the boundary
 * vertex editor (numeric Apply, preflight blocking), shared-source confirm,
 * parcel reference-only rows, save/reopen, and GRIDGROUND transform.
 * Zero page/console errors is asserted per test.
 *
 * Seeded drawing (regenerated per test — hard isolation): a 5x5 native point
 * grid (W<row><col> at (col*10,row*10), z = 100 + 0.1x + 0.2y, Tina mesh
 * exactly planar), one point-chain breakline (W10–W11–W12), one entity-backed
 * breakline (polyline W20–W21–W22 via vertex labels), a shared outer polygon
 * (W Native + W Twin), a parcel-backed surface (W Lot), and a 3x3 imported
 * LandXML TIN. Viewport point selection uses circle clicks; ring creation
 * uses picked survey-point XY (Z ignored) in one create+attach transaction.
 *
 * Flows (mission §126):
 * - 18W-1 (A create→CURRENT, B reverse, D membership display, undo/redo):
 *   click-pick 3 points → Add Chain → CURRENT; chain editor E/N/Z + rename;
 *   Reverse → CURRENT; SHELL_UNDO/REDO round-trip.
 * - 18W-2 (B insert/remove, C crossing blocked + source unchanged): chain
 *   editor insert-picked/remove; crossing Replace Chain From Selection
 *   blocked with the chain byte-identical.
 * - 18W-3 (E outer create + domain clip, F vertex move→rebuild, G bow-tie
 *   blocked, H void create + move-outside blocked).
 * - 18W-4 (I parcel safety + independent copy, J shared warning + both
 *   stale + isolate).
 * - 18W-5 (K seeded 18T edit survives source rebuild, M save/reopen chain
 *   order + boundary refs + edits table).
 * - 18W-6 (L stale→CURRENT lifecycle around GRIDGROUND, O refs valid +
 *   scaled coordinates in the chain editor).
 * - 18W-7 (N imported-TIN: ribbon buttons disabled, mesh-edit path open).
 */
import { expect, test, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// Bound every action: a missing element must fail loudly, never stall to the
// 300 s test timeout (the dev-server + Chromium harness is shared).
test.use({ actionTimeout: 15000 });

const SEED = 'tests-browser/fixtures/cad-surface-18g-seed.wncad';
const NATIVE_ID = 'w-native';
const NATIVE_NAME = 'W Native';
const TWIN_ID = 'w-twin';
const TWIN_NAME = 'W Twin';
const LOT_ID = 'w-lot';
const LOT_NAME = 'W Lot';
const IMPORTED_ID = 'w-imported';
const IMPORTED_NAME = 'W Imported';
const BL_ID = 'w-bl';
const ENTITY_COUNT = 29; // 25 grid points + f2f polyline + shared polygon + parcel + alignment
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
}

/** 5x5 planar native grid + chain/entity breaklines + shared outer + parcel lot + imported TIN. */
function makeDrawing(): string {
  const seed = JSON.parse(fs.readFileSync(SEED, 'utf8')) as { project: Record<string, unknown> };
  const entities: unknown[] = [];
  const nativeIds: string[] = [];
  for (let row = 0; row < 5; row += 1) {
    for (let col = 0; col < 5; col += 1) {
      const x = col * 10;
      const y = row * 10;
      const id = `w-pt-${row}${col}`;
      nativeIds.push(id);
      entities.push({
        id, type: 'survey-point', layerId: 'points', visible: true, locked: false,
        stationId: `W${row}${col}`, x, y, z: baseZ(x, y), pointClass: 'free', source: 'parsed-input',
      });
    }
  }
  // Breakline endpoints must stay strictly inside the outer ring: an endpoint
  // exactly on the ring is an illegal touch (INTERSECT_WITHOUT_VERTEX).
  entities.push({
    id: 'w-f2f', type: 'polyline', layerId: 'general', visible: true, locked: false,
    vertices: [{ x: 10, y: 20 }, { x: 20, y: 20 }, { x: 30, y: 20 }],
    vertexLabels: ['W21', 'W22', 'W23'], closed: false,
  });
  entities.push({
    id: 'w-shared', type: 'polygon', layerId: 'general', visible: true, locked: false,
    vertices: [{ x: -5, y: -5 }, { x: 45, y: -5 }, { x: 45, y: 45 }, { x: -5, y: 45 }],
    vertexLabels: ['', '', '', ''],
  });
  entities.push({
    id: 'w-parcel-1', type: 'parcel', layerId: 'general', visible: true, locked: false,
    vertices: [{ x: 30, y: 30 }, { x: 50, y: 30 }, { x: 50, y: 50 }, { x: 30, y: 50 }],
    vertexLabels: ['', '', '', ''], parcelName: 'Lot 1',
  });
  entities.push({
    id: 'w-align-1', type: 'alignment', layerId: 'general', visible: true, locked: false,
    // Kept clear of the point grid: its wide hit-rect must not cover pick targets.
    name: 'W-CL', elements: [{ kind: 'line', start: { x: -10, y: 60 }, end: { x: 50, y: 60 } }], startStation: 0,
  });
  (seed.project as { entities: unknown[] }).entities = entities;
  (seed.project as { pointGroups: unknown[] }).pointGroups = [];
  (seed.project as { bounds: unknown }).bounds = { minX: -20, minY: -20, maxX: 80, maxY: 80 };
  (seed.project as { surfaceStyles: unknown[] }).surfaceStyles = [
    ...((seed.project as { surfaceStyles: unknown[] }).surfaceStyles ?? []),
    { id: 'w-empty', name: 'W Empty', showTriangles: false, showBoundary: false, showPoints: false },
  ];
  const lotIds = ['w-pt-33', 'w-pt-34', 'w-pt-43', 'w-pt-44'];
  (seed.project as { surfaces: unknown[] }).surfaces = [
    {
      id: NATIVE_ID, name: NATIVE_NAME, styleId: 'surface-style-triangles', cachedRevision: null,
      definition: {
        pointSource: { kind: 'points', pointEntityIds: nativeIds },
        breaklines: [
          { id: BL_ID, type: 'standard', name: 'w-row', source: { kind: 'point-chain', pointEntityIds: ['w-pt-11', 'w-pt-12', 'w-pt-13'] } },
          { id: 'w-f2f-bl', type: 'standard', name: 'w-f2f', source: { kind: 'entity', entityId: 'w-f2f' } },
        ],
        boundaries: [{ type: 'outer', sourceEntityId: 'w-shared' }],
        edits: [{ id: 'e-w-add', kind: 'add-point', x: 5, y: 25, z: 120 }],
      },
    },
    {
      id: TWIN_ID, name: TWIN_NAME, styleId: 'surface-style-triangles', cachedRevision: null,
      definition: {
        pointSource: { kind: 'points', pointEntityIds: nativeIds },
        boundaries: [{ type: 'outer', sourceEntityId: 'w-shared' }],
        edits: [],
      },
    },
    {
      id: LOT_ID, name: LOT_NAME, styleId: 'surface-style-triangles', cachedRevision: null,
      definition: {
        pointSource: { kind: 'points', pointEntityIds: lotIds },
        boundaries: [{ type: 'outer', sourceEntityId: 'w-parcel-1' }],
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
          provenance: { format: 'LandXML', fileName: 'w.xml', surfaceName: 'Imported TIN', sourceId: 'sid-18w' },
        },
        edits: [],
      },
    },
  ];
  return JSON.stringify(seed);
}

async function openDrawingFile(page: Page, file: string, expectedEntities = ENTITY_COUNT): Promise<void> {
  const input = page.locator('[data-survey-cad-open-drawing-input]');
  await input.evaluate((element: HTMLInputElement) => element.classList.remove('hidden')).catch(() => {});
  await input.setInputFiles(file);
  await expect.poll(() => entityCount(page)).toBe(expectedEntities);
}

async function openDrawing(page: Page): Promise<void> {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'webnet-18w-')), 'drawing.wncad');
  fs.writeFileSync(file, makeDrawing());
  await openDrawingFile(page, file);
}

async function saveDrawingToTemp(page: Page): Promise<string> {
  const savedPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'webnet-18w-save-')), 'w.wncad');
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

function breaklineRow(page: Page, id: string) {
  return managerScope(page).locator(`tr[data-breakline-row="${id}"]`);
}

function chainEditor(page: Page, id: string) {
  return managerScope(page).locator(`[data-breakline-editor="${id}"]`);
}

function boundaryRow(page: Page, sourceEntityId: string) {
  return managerScope(page).locator(`tr[data-boundary-row="${sourceEntityId}"]`);
}

function boundaryEditor(page: Page, sourceEntityId: string) {
  return managerScope(page).locator(`[data-boundary-editor="${sourceEntityId}"]`);
}

/** Click viewport point circles to build an ordered selection. The visible
 * render circle sits above the transparent hit-target and takes the click.
 * Call hideSurfaces() first: built TIN layers intercept point clicks. */
async function selectPoints(page: Page, ids: string[]): Promise<void> {
  for (const [index, id] of ids.entries()) {
    await page.locator(
      `[data-survey-cad-preview] circle[data-survey-cad-render-entity-id="${id}"]`,
    ).first().click(index === 0 ? {} : { modifiers: ['Shift'] });
  }
}

/** Hide every generated surface so interior picks reach the survey points. */
async function setStyle(page: Page, label: string): Promise<void> {
  const select = managerScope(page).getByLabel('Surface style', { exact: true });
  await select.selectOption({ label });
  await expect(select).not.toHaveValue('');
}

async function hideSurfaces(page: Page): Promise<void> {
  for (const name of [NATIVE_NAME, TWIN_NAME, LOT_NAME, IMPORTED_NAME]) {
    await selectManagerSurface(page, name);
    await setStyle(page, 'W Empty');
  }
  await selectManagerSurface(page, NATIVE_NAME);
}

async function addChainCount(page: Page): Promise<number> {
  const text = (await managerScope(page).getByRole('button', { name: /^Add Chain \(\d+\)$/ }).textContent()) ?? '';
  return Number.parseInt(text.replace(/[^0-9]/g, ''), 10);
}

test('18W-1: create breakline → CURRENT; chain editor membership display + rename; reverse → CURRENT; undo/redo', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  await gotoCad(page, errors);
  await openDrawing(page);
  await prepareNative(page);
  await hideSurfaces(page);

  // A: pick 3 bottom-row points in order, create the chain, rebuild to CURRENT.
  await selectPoints(page, ['w-pt-00', 'w-pt-01', 'w-pt-02']);
  await expect.poll(() => addChainCount(page), { timeout: 10000 }).toBe(3);
  await managerScope(page).getByRole('button', { name: 'Add Chain (3)' }).click();
  const createdRow = managerScope(page).locator('tr[data-breakline-row]').last();
  await expect(createdRow).toContainText('Point Chain');
  const createdId = (await createdRow.getAttribute('data-breakline-row')) ?? '';
  expect(createdId).not.toBe('');
  await rebuildAndWait(page, NATIVE_ID);
  await expect(breaklineRow(page, createdId)).toContainText('3');

  // D: chain editor shows live member E/N/Z (membership, never stored copies).
  await breaklineRow(page, createdId).getByRole('button', { name: 'Edit Chain' }).click();
  const editor = chainEditor(page, createdId);
  await expect(editor).toBeVisible();
  await expect(editor.locator('tbody tr').nth(0)).toContainText('0.000');
  await expect(editor.locator('tbody tr').nth(1)).toContainText('10.000');
  // Rename commits through history.
  await editor.getByLabel('Breakline name').fill('w-toe');
  await editor.getByRole('button', { name: 'Rename' }).click();
  await expect(breaklineRow(page, createdId)).toContainText('w-toe');

  // B: reverse rebuilds to an equivalent CURRENT mesh.
  await editor.getByRole('button', { name: 'Reverse' }).first().click();
  await editor.getByRole('button', { name: 'Close' }).click();
  await rebuildAndWait(page, NATIVE_ID);
  await expect(breaklineRow(page, createdId)).toContainText('w-toe');

  // Undo unwinds reverse + rename + create (one entry each); redo restores.
  await ribbonTab(page, 'Home').click();
  for (let i = 0; i < 3; i += 1) await page.locator('[data-cad-command="SHELL_UNDO"]').click();
  await expect.poll(() => managerScope(page).locator('tr[data-breakline-row]').count(), { timeout: 10000 }).toBe(2);
  for (let i = 0; i < 3; i += 1) await page.locator('[data-cad-command="SHELL_REDO"]').click();
  await expect.poll(() => managerScope(page).locator('tr[data-breakline-row]').count(), { timeout: 10000 }).toBe(3);
  await rebuildAndWait(page, NATIVE_ID);
  expect(errors).toEqual([]);
});

test('18W-2: chain insert/remove; crossing replace blocked with the source unchanged', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  await gotoCad(page, errors);
  await openDrawing(page);
  await prepareNative(page);
  await hideSurfaces(page);

  // B: insert a picked point below row 2, then remove it again.
  await breaklineRow(page, BL_ID).getByRole('button', { name: 'Edit Chain' }).click();
  const editor = chainEditor(page, BL_ID);
  await expect(editor.locator('tbody tr')).toHaveCount(3);
  await selectPoints(page, ['w-pt-01']);
  await editor.locator('tbody tr').nth(1).getByRole('button', { name: '+↓' }).click();
  await expect(editor.locator('tbody tr')).toHaveCount(4);
  await editor.locator('tbody tr').nth(2).getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(editor.locator('tbody tr')).toHaveCount(3);
  await rebuildAndWait(page, NATIVE_ID);

  // C: reorder into a crossing (B endpoint landing mid-segment of a
  // non-adjacent edge) blocks in preflight; the committed chain is untouched.
  // Chain is [W11, W12, W13]: insert W01 (10,0) below row 2 first (W31 would
  // cross the seeded f2f line and the engine rightly rejects it).
  await selectPoints(page, ['w-pt-01']);
  await editor.locator('tbody tr').nth(1).getByRole('button', { name: '+↓' }).click();
  await expect(editor.locator('tbody tr')).toHaveCount(4);
  // [W11, W12, W01, W13] → ↓ on row 1 commits [W12, W11, W01, W13] …
  await editor.locator('tbody tr').nth(0).getByRole('button', { name: '↓', exact: true }).click();
  await expect(editor.locator('tbody tr').nth(0)).toContainText('W12');
  // … then ↓ on row 2 would land W11 mid-segment: blocked, order kept.
  await editor.locator('tbody tr').nth(1).getByRole('button', { name: '↓', exact: true }).click();
  await expect(editor.locator('p').filter({ hasText: 'Blocked' }).first()).toBeVisible({ timeout: 10000 });
  // Member labels show station ids once coords refresh, else entity ids.
  const order = await editor.locator('tbody tr').allTextContents();
  expect(order[0]).toMatch(/w-pt-12|W12/);
  expect(order[1]).toMatch(/w-pt-11|W11/);
  expect(order[2]).toMatch(/w-pt-01|W01/);
  expect(order[3]).toMatch(/w-pt-13|W13/);
  // Rejected commits never advance the draft: inserting W31 would cross the
  // seeded f2f line, so the engine rejects and the 4-row draft is kept
  // (no divergence for later index-addressed removes to corrupt).
  await selectPoints(page, ['w-pt-31']);
  await editor.locator('tbody tr').nth(0).getByRole('button', { name: '+↓' }).click();
  await expect(editor.locator('p').filter({ hasText: 'Blocked' }).first()).toBeVisible({ timeout: 10000 });
  await expect(editor.locator('tbody tr')).toHaveCount(4);
  await editor.getByRole('button', { name: 'Close' }).click();
  await rebuildAndWait(page, NATIVE_ID);
  // Committed source of truth: reopening shows the kept 4-point order.
  await breaklineRow(page, BL_ID).getByRole('button', { name: 'Edit Chain' }).click();
  const reopened = chainEditor(page, BL_ID);
  await expect(reopened.locator('tbody tr')).toHaveCount(4);
  const kept = await reopened.locator('tbody tr').allTextContents();
  expect(kept[0]).toMatch(/w-pt-12|W12/);
  expect(kept[3]).toMatch(/w-pt-13|W13/);
  await reopened.getByRole('button', { name: 'Close' }).click();
  expect(errors).toEqual([]);
});

test('18W-3: outer create + domain clip; vertex move → rebuild; bow-tie blocked; void create + move-outside blocked', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  await gotoCad(page, errors);
  await openDrawing(page);
  await prepareNative(page);
  await hideSurfaces(page);

  // E: drop the seeded outer + both breaklines (boundary-only surface for
  // this flow), then recreate the outer from picked point XY in one
  // create+attach transaction and rebuild to a CURRENT clipped domain.
  // NOTE: picked XY applies in sorted selection order, so the picked set must
  // already be a simple ring when sorted: (0,0), (40,0), (40,10), (0,40).
  // The quad keeps the seeded add-point edit (5,25) inside the domain.
  await boundaryRow(page, 'w-shared').getByRole('button', { name: 'Remove' }).click();
  await expect(boundaryRow(page, 'w-shared')).toBeHidden({ timeout: 10000 });
  await breaklineRow(page, 'w-f2f-bl').getByRole('button', { name: 'Remove' }).click();
  await expect(breaklineRow(page, 'w-f2f-bl')).toBeHidden({ timeout: 10000 });
  await breaklineRow(page, BL_ID).getByRole('button', { name: 'Remove' }).click();
  await expect(breaklineRow(page, BL_ID)).toBeHidden({ timeout: 10000 });
  // Ring preflight needs a CURRENT mesh: rebuild after the removes first.
  await rebuildAndWait(page, NATIVE_ID);
  await managerScope(page).getByRole('button', { name: 'New Outer Ring' }).click();
  await selectPoints(page, ['w-pt-00', 'w-pt-04', 'w-pt-14', 'w-pt-40']);
  await managerScope(page).getByRole('button', { name: 'Add Picked (4)' }).click();
  await managerScope(page).getByRole('button', { name: 'Create (4)' }).click();
  await rebuildAndWait(page, NATIVE_ID);
  const outerRow = managerScope(page).locator('tr[data-boundary-row]').first();
  const outerId = (await outerRow.getAttribute('data-boundary-row')) ?? '';
  expect(outerId).not.toBe('');
  await expect(outerRow).toContainText('outer');

  // F: numeric vertex move stales the surface; rebuild restores CURRENT.
  await outerRow.getByRole('button', { name: 'Edit Vertices' }).click();
  const vertexEditor = boundaryEditor(page, outerId);
  await vertexEditor.getByLabel('Vertex 1 E').fill('-5');
  await vertexEditor.getByRole('button', { name: 'Apply' }).click();
  await rebuildAndWait(page, NATIVE_ID);

  // G: a self-intersecting candidate blocks Apply; the ring is untouched.
  // Ring is (-5,0), (40,0), (40,10), (0,40): moving V3 to (-5,20) crosses V1-V4.
  // (A successful Apply closes the editor, so reopen it first.)
  await outerRow.getByRole('button', { name: 'Edit Vertices' }).click();
  const bowtieEditor = boundaryEditor(page, outerId);
  await bowtieEditor.getByLabel('Vertex 3 E').fill('-5');
  await bowtieEditor.getByLabel('Vertex 3 N').fill('20');
  await expect(bowtieEditor.getByRole('button', { name: 'Apply' })).toBeDisabled({ timeout: 10000 });
  await bowtieEditor.getByRole('button', { name: 'Close' }).click();
  await outerRow.getByRole('button', { name: 'Edit Vertices' }).click();
  await expect(boundaryEditor(page, outerId).getByLabel('Vertex 3 E')).toHaveValue('40');

  // H: void triangle inside the domain, then a move-outside edit is blocked.
  // Sorted picks (10,10), (30,10), (10,30) already form a simple triangle,
  // clear of the dead f2f linework (y=20) for picks.
  // (Ring arming stays on after Create: close the outer session first.)
  await managerScope(page).getByRole('button', { name: 'Close New Ring' }).click();
  await managerScope(page).getByLabel('Boundary kind').selectOption('void');
  await managerScope(page).getByRole('button', { name: 'New Void Ring' }).click();
  await selectPoints(page, ['w-pt-11', 'w-pt-13', 'w-pt-31']);
  await managerScope(page).getByRole('button', { name: 'Add Picked (3)' }).click();
  await managerScope(page).getByRole('button', { name: 'Create (3)' }).click();
  await rebuildAndWait(page, NATIVE_ID);
  const voidRow = managerScope(page).locator('tr[data-boundary-row]').last();
  const voidId = (await voidRow.getAttribute('data-boundary-row')) ?? '';
  await voidRow.getByRole('button', { name: 'Edit Vertices' }).click();
  const voidEditor = boundaryEditor(page, voidId);
  await voidEditor.getByLabel('Vertex 1 E').fill('-50');
  await expect(voidEditor.getByRole('button', { name: 'Apply' })).toBeDisabled({ timeout: 10000 });
  await voidEditor.getByRole('button', { name: 'Close' }).click();
  await rebuildAndWait(page, NATIVE_ID);
  expect(errors).toEqual([]);
});

test('18W-4: parcel reference-only + independent copy; shared warning + both stale + isolate', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  await gotoCad(page, errors);
  await openDrawing(page);
  await prepareNative(page);

  // I: parcel-backed rows are reference-only; Make Independent copies to a
  // polygon (parcel untouched) and the copy is editable + rebuilds CURRENT.
  await selectManagerSurface(page, LOT_NAME);
  await rebuildAndWait(page, LOT_ID);
  const parcelRow = boundaryRow(page, 'w-parcel-1');
  await expect(parcelRow).toContainText('Source: Parcel');
  await expect(parcelRow.getByRole('button', { name: 'Edit Vertices' })).toBeDisabled();
  await parcelRow.getByRole('button', { name: 'Make Independent' }).click();
  const lotOuter = managerScope(page).locator('tr[data-boundary-row]').first();
  const copyId = (await lotOuter.getAttribute('data-boundary-row')) ?? '';
  expect(copyId).not.toBe('w-parcel-1');
  await expect(lotOuter).toContainText('polygon');
  await lotOuter.getByRole('button', { name: 'Edit Vertices' }).click();
  const lotEditor = boundaryEditor(page, copyId);
  await lotEditor.getByLabel('Vertex 1 E').fill('31');
  await lotEditor.getByRole('button', { name: 'Apply' }).click();
  await rebuildAndWait(page, LOT_ID);

  // J: the shared w-shared source warns, stales both surfaces, and an
  // independent copy isolates the twin.
  await selectManagerSurface(page, TWIN_NAME);
  await rebuildAndWait(page, TWIN_ID);
  await boundaryRow(page, 'w-shared').getByRole('button', { name: 'Edit Vertices' }).click();
  await expect(managerScope(page).getByRole('button', { name: 'Edit Shared Source' })).toBeVisible({ timeout: 10000 });
  await managerScope(page).getByRole('button', { name: 'Make Independent Copy' }).click();
  const twinOuter = managerScope(page).locator('tr[data-boundary-row]').first();
  const twinCopy = (await twinOuter.getAttribute('data-boundary-row')) ?? '';
  expect(twinCopy).not.toBe('w-shared');
  await expect(twinOuter).toContainText('1');
  await closeManager(page);
  await openManager(page);
  await selectManagerSurface(page, NATIVE_NAME);
  await expect(boundaryRow(page, 'w-shared')).toBeVisible({ timeout: 10000 });
  await rebuildAndWait(page, NATIVE_ID);
  expect(errors).toEqual([]);
});

test('18W-5: seeded 18T edit survives source rebuild; save/reopen keeps chain order, boundary refs, and edits', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  await gotoCad(page, errors);
  await openDrawing(page);
  await prepareNative(page);

  // K: the seeded add-point edit row is present and the surface is CURRENT.
  await expect(managerScope(page).locator('[data-cad-surface-edit]')).toContainText('Add Point');
  // A source rebuild (reverse the seeded chain) keeps the edit row + CURRENT.
  await breaklineRow(page, BL_ID).getByRole('button', { name: 'Reverse' }).click();
  await rebuildAndWait(page, NATIVE_ID);
  await expect(managerScope(page).locator('[data-cad-surface-edit]')).toContainText('Add Point');

  // M: save/reopen preserves chain order, boundary refs, and the edit stack.
  const savedPath = await saveDrawingToTemp(page);
  await openDrawingFile(page, savedPath);
  await showSurveyTab(page);
  await openManager(page);
  await selectManagerSurface(page, NATIVE_NAME);
  await breaklineRow(page, BL_ID).getByRole('button', { name: 'Edit Chain' }).click();
  const editor = chainEditor(page, BL_ID);
  // Reversed order survived the roundtrip: last chain point first.
  await expect(editor.locator('tbody tr').nth(0)).toContainText('W13');
  await editor.getByRole('button', { name: 'Close' }).click();
  await expect(boundaryRow(page, 'w-shared')).toBeVisible();
  await expect(managerScope(page).locator('[data-cad-surface-edit]')).toContainText('Add Point');
  await rebuildAndWait(page, NATIVE_ID);
  expect(errors).toEqual([]);
});

test('18W-6: GRIDGROUND stales → rebuild CURRENT; refs valid with scaled chain coordinates', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  await gotoCad(page, errors);
  await openDrawing(page);
  await prepareNative(page);
  await closeManager(page);

  // O + L: project transform (Grid→Ground factor 0.5 about the origin =
  // scale 2) stales the surface; rebuild restores CURRENT with refs intact.
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
  await rebuildAndWait(page, NATIVE_ID);
  // Chain refs survived; coordinates doubled in the membership display.
  await breaklineRow(page, BL_ID).getByRole('button', { name: 'Edit Chain' }).click();
  const editor = chainEditor(page, BL_ID);
  await expect(editor.locator('tbody tr').nth(1)).toContainText('40.000');
  await expect(editor.locator('tbody tr').nth(1)).toContainText('20.000');
  await editor.getByRole('button', { name: 'Close' }).click();
  expect(errors).toEqual([]);
});

test('18W-7: imported-TIN disables definition editing; entity convert stays available on native', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  await gotoCad(page, errors);
  await openDrawing(page);
  await prepareNative(page);

  // N: on the imported surface the definition buttons are disabled.
  await selectManagerSurface(page, IMPORTED_NAME);
  await ribbonTab(page, 'Surface').click();
  await expect(page.locator('[data-cad-surface="breaklines"]')).toBeDisabled({ timeout: 10000 });
  await expect(page.locator('[data-cad-surface="boundaries"]')).toBeDisabled({ timeout: 10000 });

  // Native entity-backed breakline offers Convert to Point Chain.
  await openManager(page);
  await selectManagerSurface(page, NATIVE_NAME);
  await breaklineRow(page, 'w-f2f-bl').getByRole('button', { name: 'View' }).click();
  const editor = chainEditor(page, 'w-f2f-bl');
  await expect(editor).toContainText('Read-only until converted');
  await editor.getByRole('button', { name: 'Convert to Point Chain' }).click();
  await rebuildAndWait(page, NATIVE_ID);
  await expect(breaklineRow(page, 'w-f2f-bl')).toContainText('Point Chain');
  expect(errors).toEqual([]);
});


