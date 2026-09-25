/**
 * Phase 18T browser QA — surface-local point/elevation edits through the real /cad app.
 *
 * Playwright (dev-server + Chromium), NOT vitest. Drives the shipped UI:
 * ribbon Surface → Edit group (5 new buttons), the typed entry form, the
 * command dock (Elevation/delta values), the manager EDITS table (Target/
 * Value columns + dependency warnings), Toolspace Definition → Edits rows,
 * Properties group counts, undo/redo, WNCAD save/reopen, GRIDGROUND.
 * Zero page/console errors is asserted per test.
 *
 * Seed: a 4x4 native point grid (plane z = 100 + 0.1x + 0.2y, Tina
 * triangulation is exactly planar) with a breakline through T10–T11–T12,
 * plus a 3x3 imported LandXML TIN. Flows:
 * - T1 (A add, undo-during-build): add-point with interpolated default,
 *   custom Z via dock, one-transaction undo/redo around the worker build.
 * - T2 (B set, C move, D invalid-move): set-elevation (current + base Z),
 *   valid XY move, coincident target rejected with Delete+Add guidance.
 * - T3 (E delete, F constraint): free interior delete commits; boundary
 *   and breakline-constrained deletes block with reasons before commit.
 * - T4 (G composition, H raise, J table, K downstream): add → set on E1 →
 *   raise/lower; dense columns; consumer-before-producer reorder blocked;
 *   disabling the producer warns and surfaces a disabled-producer warning.
 * - T5 (L save-reopen, M imported, N transform): stack survives
 *   save/reopen; imported V-labels work; GRIDGROUND carries edit coords.
 */
import { expect, test, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const SEED = 'tests-browser/fixtures/cad-surface-18g-seed.wncad';
const SHOT_DIR = 'docs/evidence/phase18t';
const NATIVE_ID = 't-native';
const NATIVE_NAME = 'T Native';
const IMPORTED_ID = 't-imported';

async function gotoCad(page: Page, errors: string[]): Promise<void> {
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
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

/** 4x4 planar grid (T<row><col> at (col*10,row*10)) + 3x3 imported TIN. */
function makeDrawing(): string {
  const seed = JSON.parse(fs.readFileSync(SEED, 'utf8')) as { project: Record<string, unknown> };
  const layerId = (seed.project.layers as Array<{ id: string }>)[0]?.id ?? 'general';
  const entities: unknown[] = [];
  const nativeIds: string[] = [];
  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      const id = `t-pt-${row}${col}`;
      nativeIds.push(id);
      entities.push({
        id, type: 'survey-point', layerId, visible: true, locked: false,
        stationId: `T${row}${col}`, x: col * 10, y: row * 10,
        z: 100 + 0.1 * col * 10 + 0.2 * row * 10, pointClass: 'free', source: 'parsed-input',
      });
    }
  }
  seed.project.entities = entities;
  seed.project.pointGroups = [];
  seed.project.surfaces = [
    {
      id: NATIVE_ID, name: NATIVE_NAME, cachedRevision: null,
      definition: {
        pointSource: { kind: 'points', pointEntityIds: nativeIds },
        breaklines: [
          { id: 't-bl', type: 'standard', name: 't-row', source: { kind: 'point-chain', pointEntityIds: ['t-pt-10', 't-pt-11', 't-pt-12'] } },
        ],
        edits: [],
      },
    },
    {
      id: IMPORTED_ID, name: 'T Imported', cachedRevision: null,
      definition: {
        pointSource: { kind: 'points', pointEntityIds: [] },
        sourceKind: 'imported-tin',
        importedTin: {
          vertices: [0, 0, 0, 10, 0, 1, 20, 0, 2, 0, 10, 3, 10, 10, 4, 20, 10, 5, 0, 20, 6, 10, 20, 7, 20, 20, 8],
          faces: [0, 1, 4, 0, 4, 3, 1, 2, 5, 1, 5, 4, 3, 4, 7, 3, 7, 6, 4, 5, 8, 4, 8, 7],
          provenance: { format: 'LandXML', fileName: 't.xml', surfaceName: 'Imported TIN', sourceId: 'sid-18t' },
        },
        edits: [],
      },
    },
  ];
  return JSON.stringify(seed);
}

async function openGeneratedDrawing(page: Page): Promise<void> {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'webnet-18t-')), 'drawing.wncad');
  fs.writeFileSync(file, makeDrawing());
  const input = page.locator('[data-survey-cad-open-drawing-input]');
  await input.evaluate((element: HTMLInputElement) => element.classList.remove('hidden')).catch(() => {});
  await input.setInputFiles(file);
  await expect.poll(() => entityCount(page)).toBe(16);
}

async function entityCount(page: Page): Promise<number> {
  const text = (await page.locator('[data-survey-cad-entity-count]').textContent()) ?? '';
  return Number.parseInt(text, 10);
}

function ribbonTab(page: Page, name: string) {
  return page.locator('[aria-label="Ribbon tabs"]').getByRole('tab', { name });
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

async function openManager(page: Page): Promise<void> {
  await ribbonTab(page, 'Surface').click();
  await page.getByRole('button', { name: 'Add Point Group' }).first().click();
  await expect(managerScope(page)).toBeVisible({ timeout: 10000 });
}

async function selectManagerSurface(page: Page, name: string): Promise<void> {
  await managerScope(page).locator('ul button', { hasText: name }).first().click();
}

async function waitCurrent(page: Page, id: string): Promise<void> {
  await expect.poll(() => surfaceStatus(page, id), { timeout: 60000 }).toBe('CURRENT');
}

async function rebuildAndWait(page: Page, id: string): Promise<void> {
  await managerScope(page).getByRole('button', { name: 'Rebuild', exact: true }).click();
  await expect.poll(() => surfaceStatus(page, id), { timeout: 60000 }).toBe('CURRENT');
}

function pointForm(page: Page, mode: string) {
  return page.locator(`[data-cad-surface-point-form="${mode}"]`);
}

async function startEdit(page: Page, key: string, mode: string): Promise<void> {
  await ribbonTab(page, 'Surface').click();
  await page.locator(`[data-cad-surface="${key}"]`).click();
  await expect(pointForm(page, mode)).toBeVisible({ timeout: 10000 });
}

async function stageXy(page: Page, mode: string, x: string, y: string): Promise<void> {
  const form = pointForm(page, mode);
  await form.locator('input[aria-label="Stage X"]').fill(x);
  await form.locator('input[aria-label="Stage Y"]').fill(y);
  await form.getByRole('button', { name: 'Stage', exact: true }).click();
}

async function dockValue(page: Page, text: string): Promise<void> {
  const input = page.locator('[data-cad-command-input]');
  await input.fill(text);
  await input.press('Enter');
}

async function commitEdit(page: Page, mode: string): Promise<void> {
  await pointForm(page, mode).getByRole('button', { name: 'Commit point edit' }).click();
}

async function cancelEdit(page: Page, mode: string): Promise<void> {
  await pointForm(page, mode).getByRole('button', { name: 'Cancel point edit' }).click();
  await expect(pointForm(page, mode)).toBeHidden();
}

async function editRowCount(page: Page, id: string): Promise<number> {
  return managerScope(page).locator(`[data-cad-surface-edits="${id}"] [data-cad-surface-edit]`).count();
}

test('18T-1: add-point stages the interpolated default, commits custom Z, undo/redo is one transaction', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  await gotoCad(page, errors);
  await openGeneratedDrawing(page);
  await showSurveyTab(page);
  await openManager(page);
  await selectManagerSurface(page, NATIVE_NAME);
  await rebuildAndWait(page, NATIVE_ID);

  await startEdit(page, 'add-point', 'add-point');
  await stageXy(page, 'add-point', '15', '25');
  // Planar grid: interpolated default is exactly 106.500, Surface-only copy.
  await expect(pointForm(page, 'add-point').locator('[data-cad-surface-point-status]')).toContainText('106.500');
  await expect(pointForm(page, 'add-point').locator('[data-cad-surface-point-status]')).toContainText('Surface-only');
  await dockValue(page, '107.25');
  await expect(pointForm(page, 'add-point').locator('[data-cad-surface-point-status]')).toContainText('107.250');
  await commitEdit(page, 'add-point');
  await expect.poll(() => editRowCount(page, NATIVE_ID), { timeout: 30000 }).toBe(1);
  const manager = managerScope(page);
  await expect(manager.locator('[data-cad-surface-edit]')).toContainText('Add Point');
  await expect(manager.locator('[data-cad-surface-edit]')).toContainText('107.250');
  await page.screenshot({ path: `${SHOT_DIR}/18t-1-added.png` });

  // Undo during the worker build removes the single transaction; redo restores it.
  await ribbonTab(page, 'Home').click();
  await page.locator('[data-cad-command="SHELL_UNDO"]').click();
  await expect.poll(() => editRowCount(page, NATIVE_ID), { timeout: 30000 }).toBe(0);
  await page.locator('[data-cad-command="SHELL_REDO"]').click();
  await expect.poll(() => editRowCount(page, NATIVE_ID), { timeout: 30000 }).toBe(1);
  // Undo/redo never auto-build: the user rebuilds (worker completion alone
  // never creates history, and history alone never schedules a build).
  await rebuildAndWait(page, NATIVE_ID);
  await cancelEdit(page, 'add-point');
  expect(errors).toEqual([]);
});

test('18T-2: set-elevation shows current/base Z; move commits; coincident move is rejected with Delete+Add guidance', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  await gotoCad(page, errors);
  await openGeneratedDrawing(page);
  await showSurveyTab(page);
  await openManager(page);
  await selectManagerSurface(page, NATIVE_NAME);
  await rebuildAndWait(page, NATIVE_ID);

  // T22 = (20,20), base z = 100+2+4 = 106.
  await startEdit(page, 'set-elevation', 'set-elevation');
  await stageXy(page, 'set-elevation', '20', '20');
  const setStatus = pointForm(page, 'set-elevation').locator('[data-cad-surface-point-status]');
  await expect(setStatus).toContainText('T22');
  await expect(setStatus).toContainText('106.000');
  await expect(setStatus).toContainText('Surface-only elevation override');
  await dockValue(page, '200');
  await commitEdit(page, 'set-elevation');
  await expect.poll(() => editRowCount(page, NATIVE_ID), { timeout: 30000 }).toBe(1);
  await expect(managerScope(page).locator('[data-cad-surface-edit]')).toContainText('Set Elevation');
  await waitCurrent(page, NATIVE_ID);

  await startEdit(page, 'move-point', 'move-point');
  await stageXy(page, 'move-point', '20', '20');
  await stageXy(page, 'move-point', '21', '21');
  await expect(pointForm(page, 'move-point').locator('[data-cad-surface-point-status]')).toContainText('Z unchanged');
  await commitEdit(page, 'move-point');
  await expect.poll(() => editRowCount(page, NATIVE_ID), { timeout: 30000 }).toBe(2);
  await waitCurrent(page, NATIVE_ID);

  // Invalid: target coincides with T21 (10,20) — rejected, Delete+Add named, no clamp, no commit.
  await startEdit(page, 'move-point', 'move-point');
  await stageXy(page, 'move-point', '21', '21');
  await stageXy(page, 'move-point', '10', '20');
  await expect(pointForm(page, 'move-point').locator('[data-cad-surface-point-status]')).toContainText('Delete + Add');
  await commitEdit(page, 'move-point');
  expect(await editRowCount(page, NATIVE_ID)).toBe(2);
  await cancelEdit(page, 'move-point');
  expect(errors).toEqual([]);
});

test('18T-3: free interior delete commits; boundary and constrained deletes block with reasons', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  await gotoCad(page, errors);
  await openGeneratedDrawing(page);
  await showSurveyTab(page);
  await openManager(page);
  await selectManagerSurface(page, NATIVE_NAME);
  await rebuildAndWait(page, NATIVE_ID);

  // Free interior T21 = (10,20).
  await startEdit(page, 'delete-point', 'delete-point');
  await stageXy(page, 'delete-point', '10', '20');
  await expect(pointForm(page, 'delete-point').locator('[data-cad-surface-point-status]')).toContainText('T21');
  await commitEdit(page, 'delete-point');
  await expect.poll(() => editRowCount(page, NATIVE_ID), { timeout: 30000 }).toBe(1);
  await expect(managerScope(page).locator('[data-cad-surface-edit]')).toContainText('Delete Point');
  await waitCurrent(page, NATIVE_ID);

  // Boundary T00 = (0,0) blocks before commit.
  await startEdit(page, 'delete-point', 'delete-point');
  await stageXy(page, 'delete-point', '0', '0');
  await expect(pointForm(page, 'delete-point').locator('[data-cad-surface-point-status]')).toContainText('BOUNDARY');
  await commitEdit(page, 'delete-point');
  expect(await editRowCount(page, NATIVE_ID)).toBe(1);

  // Breakline-constrained T11 = (10,10) blocks before commit.
  await stageXy(page, 'delete-point', '10', '10');
  await expect(pointForm(page, 'delete-point').locator('[data-cad-surface-point-status]')).toContainText('CONSTRAINED');
  await commitEdit(page, 'delete-point');
  expect(await editRowCount(page, NATIVE_ID)).toBe(1);
  await cancelEdit(page, 'delete-point');
  expect(errors).toEqual([]);
});

test('18T-4: add→set composition, raise/lower, dense table, reorder blocked, producer disable warns', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  await gotoCad(page, errors);
  await openGeneratedDrawing(page);
  await showSurveyTab(page);
  await openManager(page);
  await selectManagerSurface(page, NATIVE_NAME);
  await rebuildAndWait(page, NATIVE_ID);
  const manager = managerScope(page);

  // Composition: add-point at (15,25), then set-elevation on the E1 vertex.
  await startEdit(page, 'add-point', 'add-point');
  await stageXy(page, 'add-point', '15', '25');
  await commitEdit(page, 'add-point');
  await expect.poll(() => editRowCount(page, NATIVE_ID), { timeout: 30000 }).toBe(1);
  await waitCurrent(page, NATIVE_ID);
  await startEdit(page, 'set-elevation', 'set-elevation');
  await stageXy(page, 'set-elevation', '15', '25');
  await expect(pointForm(page, 'set-elevation').locator('[data-cad-surface-point-status]')).toContainText('E1');
  await dockValue(page, '150');
  await commitEdit(page, 'set-elevation');
  await expect.poll(() => editRowCount(page, NATIVE_ID), { timeout: 30000 }).toBe(2);
  await waitCurrent(page, NATIVE_ID);

  // Raise/lower: explicit delta + separate confirm gesture.
  await startEdit(page, 'raise-lower', 'raise-lower');
  await dockValue(page, '2');
  await expect(pointForm(page, 'raise-lower').locator('[data-cad-surface-point-status]')).toContainText('Surface-only');
  await commitEdit(page, 'raise-lower');
  await expect.poll(() => editRowCount(page, NATIVE_ID), { timeout: 30000 }).toBe(3);

  // Dense columns: Type/Target/Value per row.
  const rows = manager.locator('[data-cad-surface-edit]');
  await expect(rows.nth(0)).toContainText('Add Point');
  await expect(rows.nth(1)).toContainText('Set Elevation');
  await expect(rows.nth(1)).toContainText('E1');
  await expect(rows.nth(2)).toContainText('Raise/Lower');

  // Consumer-before-producer reorder blocks with a reason (dialog-free notice).
  await rows.nth(1).locator('[data-cad-edit-action="up"]').click();
  await expect(manager.getByRole('status').first()).toContainText(/producer/i);
  await expect.poll(() => editRowCount(page, NATIVE_ID), { timeout: 30000 }).toBe(3);

  // Disabling the add-point producer warns (confirm auto-accepted) and the
  // downstream consumer reports a disabled producer.
  await rows.nth(0).locator('[data-cad-edit-action="toggle"]').click();
  await expect(manager.locator('[data-cad-edit-dependency-warning]')).toContainText('disabled producer', { timeout: 30000 });
  // Toggle participates (cached revision cleared → NEEDS_REBUILD); the
  // disabled-producer stack replays fail-closed — the worker reports
  // SURFACE_TRIANGULATION_FAILED and the surface honestly stays
  // NEEDS_REBUILD on its last mesh (never a stale CURRENT).
  await manager.getByRole('button', { name: 'Rebuild', exact: true }).click();
  await expect.poll(() => surfaceStatus(page, NATIVE_ID), { timeout: 60000 }).toBe('NEEDS_REBUILD');
  await page.screenshot({ path: `${SHOT_DIR}/18t-4-table.png` });

  // Properties: concise Topology/Point/Elevation counts, no record dump.
  const summary = page.locator(`[data-cad-surface-edit-summary="${NATIVE_ID}"]`);
  await expect(summary).toContainText('Point edits');
  await expect(summary).toContainText('Elevation edits');
  expect(errors).toEqual([]);
});

test('18T-5: save/reopen keeps the stack; imported V-labels work; PROJECTTRANSFORM carries edit coords', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  await gotoCad(page, errors);
  await openGeneratedDrawing(page);
  await showSurveyTab(page);
  await openManager(page);
  await selectManagerSurface(page, NATIVE_NAME);
  await rebuildAndWait(page, NATIVE_ID);

  await startEdit(page, 'add-point', 'add-point');
  await stageXy(page, 'add-point', '15', '25');
  await commitEdit(page, 'add-point');
  await expect.poll(() => editRowCount(page, NATIVE_ID), { timeout: 30000 }).toBe(1);
  await cancelEdit(page, 'add-point');

  // Save/reopen: exact stack, rebuilds CURRENT again.
  const savedPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'webnet-18t-save-')), 't.wncad');
  const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
  await ribbonTab(page, 'Home').click();
  await page.getByRole('button', { name: 'Save Drawing' }).first().click();
  const download = await downloadPromise;
  await download.saveAs(savedPath);
  expect(fs.readFileSync(savedPath, 'utf8')).toContain('add-point');
  await page.goto('/cad', { waitUntil: 'networkidle' });
  await expect(page.getByText('WebNet CAD', { exact: true }).first()).toBeVisible({ timeout: 30000 });
  const fileInput = page.locator('[data-survey-cad-open-drawing-input]');
  await fileInput.evaluate((element: HTMLInputElement) => element.classList.remove('hidden')).catch(() => {});
  await fileInput.setInputFiles(savedPath);
  await expect.poll(() => entityCount(page)).toBe(16);
  await showSurveyTab(page);
  await openManager(page);
  await selectManagerSurface(page, NATIVE_NAME);
  await expect.poll(() => editRowCount(page, NATIVE_ID), { timeout: 30000 }).toBe(1);
  await rebuildAndWait(page, NATIVE_ID);

  // Imported surface: V4 set-elevation with readable labels, never raw keys.
  await selectManagerSurface(page, 'T Imported');
  await rebuildAndWait(page, IMPORTED_ID);
  await startEdit(page, 'set-elevation', 'set-elevation');
  await stageXy(page, 'set-elevation', '10', '10');
  await expect(pointForm(page, 'set-elevation').locator('[data-cad-surface-point-status]')).toContainText('V4');
  await dockValue(page, '44');
  await commitEdit(page, 'set-elevation');
  await expect.poll(() => editRowCount(page, IMPORTED_ID), { timeout: 30000 }).toBe(1);
  const importedNode = toolspaceSurface(page, IMPORTED_ID);
  await expect(importedNode.locator('[data-cad-surface-edit]')).toContainText('Set Elevation V4');
  await expect(importedNode).not.toContainText('imported:t-imported');
  await cancelEdit(page, 'set-elevation');

  // Transform: PROJECTTRANSFORM Grid/Ground x2 about the origin carries the
  // edit coordinates with the frame (entity-cohort GRIDGROUND does not).
  // (Close the manager first — it floats above the transform panel.)
  await selectManagerSurface(page, NATIVE_NAME);
  await managerScope(page).getByRole('button', { name: 'Close', exact: true }).click();
  await expect(managerScope(page)).toBeHidden({ timeout: 10000 });
  await ribbonTab(page, 'Home').click();
  await page.locator('[data-cad-command="PROJECTTRANSFORM"]').click();
  await expect(page.locator('[data-survey-cad-project-transform-panel]')).toBeVisible({ timeout: 10000 });
  await page.locator('[data-survey-cad-project-transform-panel]').getByRole('button', { name: 'Grid/Ground' }).click();
  await page.locator('[data-project-transform-origin-input]').fill('0,0');
  await page.locator('[data-project-transform-origin-set]').click();
  await page.locator('[data-project-transform-factor-input]').fill('0.5');
  await page.locator('[data-project-transform-factor-set]').click();
  await page.locator('[data-project-transform-apply]').click();
  await expect(page.locator('[data-survey-cad-project-transform-panel]')).toBeHidden({ timeout: 30000 });
  await showSurveyTab(page);
  await openManager(page);
  await selectManagerSurface(page, NATIVE_NAME);
  await expect.poll(() => editRowCount(page, NATIVE_ID), { timeout: 30000 }).toBe(1);
  await expect(managerScope(page).locator('[data-cad-surface-edit]')).toContainText('(30.000, 50.000)');
  await rebuildAndWait(page, NATIVE_ID);
  fs.rmSync(savedPath, { force: true });
  expect(errors).toEqual([]);
});
