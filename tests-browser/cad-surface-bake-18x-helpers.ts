/**
 * Phase 18X browser QA — shared harness for the explicit-bake spec.
 *
 * Playwright (dev-server + Chromium), NOT vitest. The generated drawing is a
 * 5x5 planar native grid (X<row><col> at (col*10, row*10), z = 100 + 0.1x +
 * 0.2y), one point-chain breakline, a shared outer polygon, one seeded
 * add-point edit, an alignment for profiles, a twin native surface, and a 3x3
 * imported LandXML TIN. A second generator produces a large imported TIN for
 * the transient-BUILDING gate.
 */
import { expect, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export const SEED = 'tests-browser/fixtures/cad-surface-18g-seed.wncad';
export const NATIVE_ID = 'x-native';
export const NATIVE_NAME = 'X Native';
export const TWIN_ID = 'x-twin';
export const TWIN_NAME = 'X Twin';
export const IMPORTED_ID = 'x-imported';
export const IMPORTED_NAME = 'X Imported';
export const BL_ID = 'x-bl';
/** 25 grid points + shared polygon + alignment. */
export const ENTITY_COUNT = 27;
export const IMPORTED_VERTICES = [
  0, 0, 0, 10, 0, 1, 20, 0, 2, 0, 10, 3, 10, 10, 4, 20, 10, 5, 0, 20, 6, 10, 20, 7, 20, 20, 8,
];
export const IMPORTED_FACES = [0, 1, 4, 0, 4, 3, 1, 2, 5, 1, 5, 4, 3, 4, 7, 3, 7, 6, 4, 5, 8, 4, 8, 7];

export const baseZ = (x: number, y: number): number => 100 + 0.1 * x + 0.2 * y;

export async function gotoCad(page: Page, errors: string[]): Promise<void> {
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

/** 5x5 planar native grid + breakline + outer + edit, twin, imported TIN, alignment. */
export function makeDrawing(): string {
  const seed = JSON.parse(fs.readFileSync(SEED, 'utf8')) as { project: Record<string, unknown> };
  const entities: unknown[] = [];
  const nativeIds: string[] = [];
  for (let row = 0; row < 5; row += 1) {
    for (let col = 0; col < 5; col += 1) {
      const x = col * 10;
      const y = row * 10;
      const id = `x-pt-${row}${col}`;
      nativeIds.push(id);
      entities.push({
        id, type: 'survey-point', layerId: 'points', visible: true, locked: false,
        stationId: `X${row}${col}`, x, y, z: baseZ(x, y), pointClass: 'free', source: 'parsed-input',
      });
    }
  }
  entities.push({
    id: 'x-shared', type: 'polygon', layerId: 'general', visible: true, locked: false,
    vertices: [{ x: -5, y: -5 }, { x: 45, y: -5 }, { x: 45, y: 45 }, { x: -5, y: 45 }],
    vertexLabels: ['', '', '', ''],
  });
  entities.push({
    id: 'x-align-1', type: 'alignment', layerId: 'general', visible: true, locked: false,
    name: 'X-CL', elements: [{ kind: 'line', start: { x: -5, y: 20 }, end: { x: 45, y: 20 } }], startStation: 0,
  });
  (seed.project as { entities: unknown[] }).entities = entities;
  (seed.project as { pointGroups: unknown[] }).pointGroups = [];
  (seed.project as { bounds: unknown }).bounds = { minX: -20, minY: -20, maxX: 80, maxY: 80 };
  (seed.project as { surfaceStyles: unknown[] }).surfaceStyles = [
    ...((seed.project as { surfaceStyles: unknown[] }).surfaceStyles ?? []),
    { id: 'x-empty', name: 'X Empty', showTriangles: false, showBoundary: false, showPoints: false },
  ];
  (seed.project as { surfaces: unknown[] }).surfaces = [
    {
      id: NATIVE_ID, name: NATIVE_NAME, styleId: 'surface-style-triangles', layerId: 'general', cachedRevision: null,
      definition: {
        pointSource: { kind: 'points', pointEntityIds: nativeIds },
        breaklines: [
          { id: BL_ID, type: 'standard', name: 'x-row', source: { kind: 'point-chain', pointEntityIds: ['x-pt-11', 'x-pt-12', 'x-pt-13'] } },
        ],
        boundaries: [{ type: 'outer', sourceEntityId: 'x-shared' }],
        edits: [{ id: 'e-x-add', kind: 'add-point', x: 5, y: 25, z: 120 }],
      },
    },
    {
      id: TWIN_ID, name: TWIN_NAME, styleId: 'surface-style-triangles', layerId: 'general', cachedRevision: null,
      definition: {
        pointSource: { kind: 'points', pointEntityIds: nativeIds },
        boundaries: [{ type: 'outer', sourceEntityId: 'x-shared' }],
        edits: [],
      },
    },
    {
      id: IMPORTED_ID, name: IMPORTED_NAME, styleId: 'surface-style-triangles', layerId: 'general', cachedRevision: null,
      definition: {
        pointSource: { kind: 'points', pointEntityIds: [] },
        sourceKind: 'imported-tin',
        importedTin: {
          vertices: [...IMPORTED_VERTICES],
          faces: [...IMPORTED_FACES],
          provenance: { format: 'LandXML', fileName: 'x.xml', surfaceName: 'Imported TIN', sourceId: 'sid-18x' },
        },
        edits: [],
      },
    },
  ];
  return JSON.stringify(seed);
}

/** Large imported TIN (50k vertices) with an empty style: worker BUILDING is observable. */
export function makeLargeImportedDrawing(vertexCount = 50_000): string {
  const cols = 250;
  const rows = vertexCount / cols;
  const vertices: number[] = [];
  const faces: number[] = [];
  const id = (row: number, col: number): number => row * cols + col;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const x = col * 5;
      const y = row * 5;
      vertices.push(x, y, 100 + 0.01 * x + 0.02 * y);
    }
  }
  for (let row = 0; row < rows - 1; row += 1) {
    for (let col = 0; col < cols - 1; col += 1) {
      const a = id(row, col);
      const b = id(row, col + 1);
      const c = id(row + 1, col + 1);
      const d = id(row + 1, col);
      faces.push(a, b, c, a, c, d);
    }
  }
  const seed = JSON.parse(fs.readFileSync(SEED, 'utf8')) as { project: Record<string, unknown> };
  (seed.project as { entities: unknown[] }).entities = [];
  (seed.project as { pointGroups: unknown[] }).pointGroups = [];
  (seed.project as { surfaces: unknown[] }).surfaces = [
    {
      id: 'x-large', name: 'X Large', styleId: 'x-empty', layerId: 'general', cachedRevision: null,
      definition: {
        pointSource: { kind: 'points', pointEntityIds: [] },
        sourceKind: 'imported-tin',
        importedTin: {
          vertices,
          faces,
          provenance: { format: 'LandXML', fileName: 'large.xml', surfaceName: 'Large TIN', sourceId: 'x-large' },
        },
        edits: [],
      },
    },
  ];
  (seed.project as { surfaceStyles: unknown[] }).surfaceStyles = [
    ...((seed.project as { surfaceStyles: unknown[] }).surfaceStyles ?? []),
    { id: 'x-empty', name: 'X Empty', showTriangles: false, showBoundary: false, showPoints: false },
  ];
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'webnet-18x-large-')), 'large.wncad');
  fs.writeFileSync(file, JSON.stringify(seed));
  return file;
}

export async function reloadCad(page: Page): Promise<void> {
  await page.goto('/cad', { waitUntil: 'networkidle' });
  await expect(page.getByText('WebNet CAD', { exact: true }).first()).toBeVisible({ timeout: 30000 });
  await expect(page.locator('[data-cad-viewport]')).toBeVisible({ timeout: 30000 });
}

export async function openDrawingFile(page: Page, file: string, expectedEntities = ENTITY_COUNT): Promise<void> {
  const input = page.locator('[data-survey-cad-open-drawing-input]');
  await input.evaluate((element: HTMLInputElement) => element.classList.remove('hidden')).catch(() => {});
  await input.setInputFiles(file);
  await expect.poll(() => entityCount(page)).toBe(expectedEntities);
}

export async function openDrawing(page: Page, drawing = makeDrawing()): Promise<void> {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'webnet-18x-')), 'drawing.wncad');
  fs.writeFileSync(file, drawing);
  await openDrawingFile(page, file);
}

export async function saveDrawingToTemp(page: Page): Promise<string> {
  const savedPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'webnet-18x-save-')), 'x.wncad');
  const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
  await ribbonTab(page, 'Home').click();
  await page.getByRole('button', { name: 'Save Drawing' }).first().click();
  const download = await downloadPromise;
  await download.saveAs(savedPath);
  return savedPath;
}

export async function entityCount(page: Page): Promise<number> {
  const text = (await page.locator('[data-survey-cad-entity-count]').textContent()) ?? '';
  return Number.parseInt(text, 10);
}

export function ribbonTab(page: Page, name: string) {
  return page.locator('[aria-label="Ribbon tabs"]').getByRole('tab', { name });
}

export async function showSurveyTab(page: Page): Promise<void> {
  await page.locator('[aria-label="Toolspace tabs"]').getByRole('tab', { name: 'Survey' }).click();
}

export function managerScope(page: Page) {
  return page.locator('section[aria-label="Surface manager"]');
}

/** The floating workspace properties overlay covers the dock while expanded. */
export async function collapseFloatingPanel(page: Page): Promise<void> {
  const collapse = page.locator('button[title="Collapse panel body"]');
  if (await collapse.isVisible().catch(() => false)) await collapse.click();
}

export async function openManager(page: Page): Promise<void> {
  await ribbonTab(page, 'Surface').click();
  await page.getByRole('button', { name: 'Add Point Group' }).first().click();
  await expect(managerScope(page)).toBeVisible({ timeout: 10000 });
  await collapseFloatingPanel(page);
}

export async function closeManager(page: Page): Promise<void> {
  await managerScope(page).getByRole('button', { name: 'Close', exact: true }).click();
  await expect(managerScope(page)).toBeHidden({ timeout: 10000 });
}

export function listRow(page: Page, name: string) {
  return managerScope(page).locator(`button[aria-label^="Surface ${name},"]`).first();
}

export async function selectManagerSurface(page: Page, name: string): Promise<void> {
  await listRow(page, name).click();
}

export function toolspaceSurface(page: Page, id: string) {
  return page.locator(`[data-cad-toolspace] [data-cad-surface="${id}"]`);
}

export async function surfaceStatus(page: Page, id: string): Promise<string> {
  return (await toolspaceSurface(page, id).getAttribute('data-cad-surface-status')) ?? '';
}

export async function waitCurrent(page: Page, id: string): Promise<void> {
  await expect.poll(() => surfaceStatus(page, id), { timeout: 60000 }).toBe('CURRENT');
}

export async function rebuildAndWait(page: Page, id: string): Promise<void> {
  await managerScope(page).getByRole('button', { name: 'Rebuild', exact: true }).click();
  await waitCurrent(page, id);
}

/** `dt`-labelled value in the selected-surface properties block. */
export function detailDd(page: Page, dtText: string) {
  return managerScope(page).locator(`dt:text-is("${dtText}") + dd`);
}

export function bakeCopyButton(page: Page) {
  return managerScope(page).getByRole('button', { name: 'Create Baked Copy' });
}

export function bakeInPlaceButton(page: Page) {
  return managerScope(page).getByRole('button', { name: 'Bake In Place' });
}

export function editRows(page: Page) {
  return managerScope(page).locator('[data-cad-surface-edit]');
}

export async function editRowCount(page: Page): Promise<number> {
  return editRows(page).count();
}

export function breaklineRow(page: Page, id: string) {
  return managerScope(page).locator(`tr[data-breakline-row="${id}"]`);
}

/** Parse the list row's `Nv Mt` stats badge. */
export function parseVt(text: string): { vertices: number; triangles: number } {
  const match = /(\d+)v (\d+)t/.exec(text);
  if (!match) throw new Error(`no stats badge in list row: ${text}`);
  return { vertices: Number(match[1]), triangles: Number(match[2]) };
}

export async function listStats(page: Page, name: string): Promise<{ vertices: number; triangles: number }> {
  return parseVt((await listRow(page, name).textContent()) ?? '');
}

/** Select the native surface and rebuild it to CURRENT. */
export async function prepareNative(page: Page): Promise<void> {
  await showSurveyTab(page);
  await openManager(page);
  await selectManagerSurface(page, NATIVE_NAME);
  await rebuildAndWait(page, NATIVE_ID);
}

// --- 18T point-edit plumbing (used by the post-bake edit flow) -------------

export function pointForm(page: Page, mode: string) {
  return page.locator(`[data-cad-surface-point-form="${mode}"]`);
}

export async function startEdit(page: Page, key: string, mode: string): Promise<void> {
  await ribbonTab(page, 'Surface').click();
  await page.locator(`[data-cad-surface="${key}"]`).click();
  await expect(pointForm(page, mode)).toBeVisible({ timeout: 10000 });
}

export async function stageXy(page: Page, mode: string, x: string, y: string): Promise<void> {
  const form = pointForm(page, mode);
  await form.locator('input[aria-label="Stage X"]').fill(x);
  await form.locator('input[aria-label="Stage Y"]').fill(y);
  await form.getByRole('button', { name: 'Stage', exact: true }).click();
}

export async function dockValue(page: Page, text: string): Promise<void> {
  const input = page.locator('[data-cad-command-input]');
  await input.fill(text);
  await input.press('Enter');
}

export async function commitEdit(page: Page, mode: string): Promise<void> {
  await pointForm(page, mode).getByRole('button', { name: 'Commit point edit' }).click();
}
