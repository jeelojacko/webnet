/**
 * Phase 18Y browser QA — shared harness for the surface-composition spec.
 *
 * Playwright (dev-server + Chromium), NOT vitest. The generated drawing is a
 * 5x5 planar native base grid (z = 100 + 0.1x + 0.2y over an outer polygon),
 * a twin native surface, and a family of explicit-TIN overlays chosen to
 * exercise the ownership policy:
 *  - Same    : overlay plane identical to base (seam Z matches everywhere)
 *  - Tilt    : overlay plane differs but agrees exactly along x = 20 (priority)
 *  - Raised  : overlay plane +1 everywhere (seam mismatch → BLOCK)
 *  - Holed   : same plane with a missing interior cell (void show-through)
 *  - Far     : disjoint overlay outside the base (union, no seam)
 * plus a void native base and a same-plane overlay that fills the void.
 * No alignment/breakline is required for composition itself.
 */
import { expect, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { openDrawingFile, reloadCad, ribbonTab, showSurveyTab } from './cad-surface-bake-18x-helpers';

export const SEED = 'tests-browser/fixtures/cad-surface-18g-seed.wncad';

export const BASE_ID = 'y-base';
export const BASE_NAME = 'Y Base';
export const SAME_ID = 'y-same';
export const SAME_NAME = 'Y Same';
export const TILT_ID = 'y-tilt';
export const TILT_NAME = 'Y Tilt';
export const RAISED_ID = 'y-raised';
export const RAISED_NAME = 'Y Raised';
export const HOLED_ID = 'y-holed';
export const HOLED_NAME = 'Y Holed';
export const FAR_ID = 'y-far';
export const FAR_NAME = 'Y Far';
export const TWIN_ID = 'y-twin';
export const TWIN_NAME = 'Y Twin';
export const VOIDBASE_ID = 'y-voidbase';
export const VOIDBASE_NAME = 'Y Void Base';
export const VOIDFILL_ID = 'y-voidfill';
export const VOIDFILL_NAME = 'Y Void Fill';
export const COMPOSITE_SUFFIX = ' - Composite';
export const ENTITY_COUNT = 27;

export const baseZ = (x: number, y: number): number => 100 + 0.1 * x + 0.2 * y;

/** Structured CCW grid TIN (x = column, y = row); `skip` drops a cell. */
export function gridTin(
  xs: number[],
  ys: number[],
  z: (_x: number, _y: number) => number,
  skip?: (_xi: number, _yi: number) => boolean,
): { vertices: number[]; faces: number[] } {
  const vertices: number[] = [];
  for (const x of xs) for (const y of ys) vertices.push(x, y, z(x, y));
  const idx = (xi: number, yi: number): number => xi * ys.length + yi;
  const faces: number[] = [];
  for (let xi = 0; xi < xs.length - 1; xi += 1) {
    for (let yi = 0; yi < ys.length - 1; yi += 1) {
      if (skip?.(xi, yi)) continue;
      const a = idx(xi, yi);
      const b = idx(xi + 1, yi);
      const c = idx(xi + 1, yi + 1);
      const d = idx(xi, yi + 1);
      faces.push(a, b, c, a, c, d);
    }
  }
  return { vertices, faces };
}

const explicitDefinition = (vertices: number[], faces: number[], name: string, id: string): Record<string, unknown> => ({
  pointSource: { kind: 'points', pointEntityIds: [] },
  sourceKind: 'imported-tin',
  importedTin: {
    vertices,
    faces,
    provenance: { format: 'LandXML', fileName: 'compose.xml', surfaceName: name, sourceId: id },
  },
  edits: [],
});

const voidPolygon = {
  id: 'y-void', type: 'polygon', layerId: 'general', visible: true, locked: false,
  vertices: [{ x: 20, y: 10 }, { x: 30, y: 10 }, { x: 30, y: 20 }, { x: 20, y: 20 }],
  vertexLabels: ['', '', '', ''],
};

/** Base + overlays + twin + void pair. */
export function makeComposeDrawing(): string {
  const seed = JSON.parse(fs.readFileSync(SEED, 'utf8')) as { project: Record<string, unknown> };
  const entities: unknown[] = [];
  const nativeIds: string[] = [];
  for (let row = 0; row < 5; row += 1) {
    for (let col = 0; col < 5; col += 1) {
      const x = col * 10;
      const y = row * 10;
      const id = `y-pt-${row}${col}`;
      nativeIds.push(id);
      entities.push({
        id, type: 'survey-point', layerId: 'points', visible: true, locked: false,
        stationId: `Y${row}${col}`, x, y, z: baseZ(x, y), pointClass: 'free', source: 'parsed-input',
      });
    }
  }
  entities.push(voidPolygon, {
    id: 'y-align', type: 'alignment', layerId: 'general', visible: true, locked: false,
    name: 'Y-CL', elements: [{ kind: 'line', start: { x: -5, y: 20 }, end: { x: 45, y: 20 } }], startStation: 0,
  });

  const xs = [20, 30, 40];
  const ys = [0, 10, 20, 30, 40];
  const same = gridTin(xs, ys, baseZ);
  // The base domain is the point hull [0,40]^2 (no outer ring), so the tilt
  // overlay's right/top/bottom edges sit on the domain boundary and the ONLY
  // seam is x = 20, where both planes agree exactly.
  const tilt = gridTin(xs, ys, (x, y) => baseZ(x, y) + 0.5 * (x - 20));
  const raised = gridTin(xs, ys, (x, y) => baseZ(x, y) + 1);
  const holed = gridTin(xs, ys, baseZ, (xi, yi) => xi === 0 && yi === 1);
  const far = gridTin([50, 60, 70], [0, 10, 20], () => 110);
  const voidFill = gridTin([20, 30], [10, 20], baseZ);

  const nativeDefinition = (voids: boolean): Record<string, unknown> => ({
    pointSource: { kind: 'points', pointEntityIds: nativeIds },
    ...(voids ? { boundaries: [{ type: 'void', sourceEntityId: 'y-void' }] } : {}),
    edits: [],
  });

  (seed.project as { entities: unknown[] }).entities = entities;
  (seed.project as { pointGroups: unknown[] }).pointGroups = [];
  (seed.project as { bounds: unknown }).bounds = { minX: -20, minY: -20, maxX: 80, maxY: 80 };
  (seed.project as { surfaceStyles: unknown[] }).surfaceStyles = [
    ...((seed.project as { surfaceStyles: unknown[] }).surfaceStyles ?? []),
    { id: 'y-empty', name: 'Y Empty', showTriangles: false, showBoundary: false, showPoints: false },
  ];
  (seed.project as { surfaces: unknown[] }).surfaces = [
    { id: BASE_ID, name: BASE_NAME, styleId: 'surface-style-triangles', layerId: 'general', cachedRevision: null, definition: nativeDefinition(false) },
    { id: TWIN_ID, name: TWIN_NAME, styleId: 'surface-style-triangles', layerId: 'general', cachedRevision: null, definition: nativeDefinition(false) },
    { id: VOIDBASE_ID, name: VOIDBASE_NAME, styleId: 'surface-style-triangles', layerId: 'general', cachedRevision: null, definition: nativeDefinition(true) },
    { id: SAME_ID, name: SAME_NAME, styleId: 'surface-style-triangles', layerId: 'general', cachedRevision: null, definition: explicitDefinition(same.vertices, same.faces, SAME_NAME, SAME_ID) },
    { id: TILT_ID, name: TILT_NAME, styleId: 'surface-style-triangles', layerId: 'general', cachedRevision: null, definition: explicitDefinition(tilt.vertices, tilt.faces, TILT_NAME, TILT_ID) },
    { id: RAISED_ID, name: RAISED_NAME, styleId: 'surface-style-triangles', layerId: 'general', cachedRevision: null, definition: explicitDefinition(raised.vertices, raised.faces, RAISED_NAME, RAISED_ID) },
    { id: HOLED_ID, name: HOLED_NAME, styleId: 'surface-style-triangles', layerId: 'general', cachedRevision: null, definition: explicitDefinition(holed.vertices, holed.faces, HOLED_NAME, HOLED_ID) },
    { id: FAR_ID, name: FAR_NAME, styleId: 'surface-style-triangles', layerId: 'general', cachedRevision: null, definition: explicitDefinition(far.vertices, far.faces, FAR_NAME, FAR_ID) },
    { id: VOIDFILL_ID, name: VOIDFILL_NAME, styleId: 'surface-style-triangles', layerId: 'general', cachedRevision: null, definition: explicitDefinition(voidFill.vertices, voidFill.faces, VOIDFILL_NAME, VOIDFILL_ID) },
  ];
  return JSON.stringify(seed);
}

export async function openComposeDrawing(page: Page, drawing = makeComposeDrawing()): Promise<void> {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'webnet-18y-')), 'compose.wncad');
  fs.writeFileSync(file, drawing);
  await openDrawingFile(page, file, ENTITY_COUNT);
}

export { reloadCad, ribbonTab, showSurveyTab, openDrawingFile };

export function managerScope(page: Page) {
  return page.locator('section[aria-label="Surface manager"]');
}

export async function openSurfaceManager(page: Page): Promise<void> {
  await ribbonTab(page, 'Surface').click();
  await page.getByRole('button', { name: 'Add Point Group' }).first().click();
  await expect(managerScope(page)).toBeVisible({ timeout: 10000 });
}

export async function closeSurfaceManager(page: Page): Promise<void> {
  await managerScope(page).getByRole('button', { name: 'Close', exact: true }).click();
  await expect(managerScope(page)).toBeHidden({ timeout: 10000 });
}

export function listRow(page: Page, name: string) {
  return managerScope(page).locator(`button[aria-label^="Surface ${name},"]`).first();
}

export async function surfaceNames(page: Page): Promise<string[]> {
  return managerScope(page).locator('button[aria-label^="Surface "]').evaluateAll(
    (nodes) => nodes.map((node) => (node.getAttribute('aria-label') ?? '').replace(/^Surface /, '').split(',')[0]!),
  );
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

export function detailDd(page: Page, dtText: string) {
  return managerScope(page).locator(`dt:text-is("${dtText}") + dd`);
}

export function parseVt(text: string): { vertices: number; triangles: number } {
  const match = /(\d+)v (\d+)t/.exec(text);
  if (!match) throw new Error(`no stats badge in list row: ${text}`);
  return { vertices: Number(match[1]), triangles: Number(match[2]) };
}

/** Select a surface in the manager and rebuild it to CURRENT. */
export async function rebuildSurface(page: Page, name: string, id: string): Promise<void> {
  await listRow(page, name).click();
  await managerScope(page).getByRole('button', { name: 'Rebuild', exact: true }).click();
  await waitCurrent(page, id);
}

export function composeOpenButton(page: Page) {
  return managerScope(page).locator('[data-cad-compose-open]');
}

export function composeDialog(page: Page) {
  return page.locator('[data-cad-compose-dialog]');
}

export async function openComposeDialog(page: Page, mode: 'copy' | 'paste' = 'copy'): Promise<void> {
  await composeOpenButton(page).click();
  await expect(composeDialog(page)).toBeVisible({ timeout: 10000 });
  if (mode === 'paste') {
    await composeDialog(page).getByRole('radio', { name: 'Paste Into Target' }).check();
  }
}

/** Pick Base/Overlay and arm the commit (does not click it). */
export async function stageCompose(page: Page, baseName: string, overlayName: string): Promise<void> {
  await composeDialog(page).locator('[data-cad-compose-base]').selectOption({ label: baseName });
  await composeDialog(page).locator('[data-cad-compose-overlay]').selectOption({ label: overlayName });
}

export function composeCommitButton(page: Page) {
  return composeDialog(page).locator('[data-cad-compose-commit]');
}

export function composeNotice(page: Page) {
  return composeDialog(page).locator('[data-cad-compose-notice]');
}

export function composeSummary(page: Page) {
  return composeDialog(page).locator('[data-cad-compose-summary]');
}

/** Full copy flow: stage + commit + wait for the composite row. */
export async function composeCopy(page: Page, baseName: string, overlayName: string): Promise<string> {
  await openComposeDialog(page, 'copy');
  await stageCompose(page, baseName, overlayName);
  await composeCommitButton(page).click();
  const name = `${baseName} + ${overlayName}${COMPOSITE_SUFFIX}`;
  await expect(listRow(page, name)).toBeVisible({ timeout: 60000 });
  return name;
}

export async function composePaste(page: Page, targetName: string, sourceName: string): Promise<void> {
  await openComposeDialog(page, 'paste');
  await stageCompose(page, targetName, sourceName);
  await composeCommitButton(page).click();
}

export async function closeComposeDialog(page: Page): Promise<void> {
  await composeDialog(page).getByRole('button', { name: 'Close', exact: true }).click();
  await expect(composeDialog(page)).toBeHidden({ timeout: 10000 });
}

/** Rebuild an explicit composite to CURRENT and return its stats. */
export async function rebuildComposite(
  page: Page,
  name: string,
): Promise<{ vertices: number; triangles: number }> {
  await listRow(page, name).click();
  await managerScope(page).getByRole('button', { name: 'Rebuild', exact: true }).click();
  await expect.poll(
    async () => (await listRow(page, name).textContent()) ?? '',
    { timeout: 60000 },
  ).toContain('Current');
  return parseVt((await listRow(page, name).textContent()) ?? '');
}

export async function surfaceArea(page: Page): Promise<number> {
  const text = await detailDd(page, 'Area').textContent();
  return Number.parseFloat((text ?? '').replace(/[^0-9.]/g, ''));
}
