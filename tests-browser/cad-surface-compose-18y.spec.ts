/**
 * Phase 18Y browser QA — exact two-surface composition through the real /cad app.
 *
 * Playwright (dev-server + Chromium), NOT vitest. Drives the shipped UI:
 * ribbon Definition Tools (Compose / Paste), the Surface Manager
 * `Compose Surface…` dialog (copy vs paste, exact summary), the Toolspace
 * composite provenance block, PROJECT TRANSFORM, WNCAD save/reopen, and the
 * Export Center LandXML round-trip. Zero page/console errors per test.
 */
import { expect, test, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { gotoCad, saveDrawingToTemp } from './cad-surface-bake-18x-helpers';
import {
  BASE_ID,
  BASE_NAME,
  ENTITY_COUNT,
  FAR_ID,
  FAR_NAME,
  HOLED_ID,
  HOLED_NAME,
  RAISED_ID,
  RAISED_NAME,
  SAME_ID,
  SAME_NAME,
  TILT_ID,
  TILT_NAME,
  TWIN_ID,
  TWIN_NAME,
  VOIDBASE_ID,
  VOIDBASE_NAME,
  VOIDFILL_ID,
  VOIDFILL_NAME,
  closeComposeDialog,
  closeSurfaceManager,
  composeCommitButton,
  composeCopy,
  composeNotice,
  composePaste,
  composeSummary,
  detailDd,
  listRow,
  managerScope,
  openComposeDialog,
  openComposeDrawing,
  openDrawingFile,
  openSurfaceManager,
  rebuildComposite,
  rebuildSurface,
  ribbonTab,
  showSurveyTab,
  stageCompose,
  surfaceArea,
  surfaceNames,
  toolspaceSurface,
  waitCurrent,
} from './cad-surface-compose-18y-helpers';
import { commitEdit, dockValue, stageXy, startEdit } from './cad-surface-bake-18x-helpers';

test.use({ actionTimeout: 15000 });

async function prepare(page: Page, ...surfaces: Array<[string, string]>): Promise<void> {
  await showSurveyTab(page);
  await openSurfaceManager(page);
  for (const [name, id] of surfaces) await rebuildSurface(page, name, id);
}

// ---------------------------------------------------------------------------
// copy + priority + source immutability
// ---------------------------------------------------------------------------

test('18Y-1: compose copy writes one explicit composite (sources untouched) and the overlay plane wins inside its coverage', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  await gotoCad(page, errors);
  await openComposeDrawing(page);
  await prepare(page, [BASE_NAME, BASE_ID], [SAME_NAME, SAME_ID], [TILT_NAME, TILT_ID]);

  const baseRowBefore = (await listRow(page, BASE_NAME).textContent()) ?? '';
  const sameRowBefore = (await listRow(page, SAME_NAME).textContent()) ?? '';

  const copy = await composeCopy(page, BASE_NAME, SAME_NAME);
  await expect(composeSummary(page)).toHaveAttribute('data-cad-compose-summary', 'exact');
  await expect(composeSummary(page).locator('dt:text-is("Verdict") + dd')).toHaveText('Exact');
  await expect(composeSummary(page).locator('dt:text-is("Overlap") + dd')).not.toHaveText('—');
  await closeComposeDialog(page);

  await listRow(page, copy).click();
  await expect(detailDd(page, 'Source Type')).toHaveText('Composite Explicit TIN');
  await expect(detailDd(page, 'Base')).toHaveText(BASE_NAME);
  await expect(detailDd(page, 'Overlay')).toHaveText(SAME_NAME);
  await expect(detailDd(page, 'Policy')).toHaveText('Overlay Coverage Wins');

  // Toolspace shows the composite provenance block, not a live dependency.
  await expect(toolspaceSurface(page, BASE_ID)).toBeVisible();
  expect((await listRow(page, BASE_NAME).textContent()) ?? '').toBe(baseRowBefore);
  expect((await listRow(page, SAME_NAME).textContent()) ?? '').toBe(sameRowBefore);

  await rebuildComposite(page, copy);

  // Priority: the TILT overlay agrees with base only along the seam, so the
  // composite max Z must exceed the planar base max Z.
  await listRow(page, BASE_NAME).click();
  const baseMaxZ = Number.parseFloat(((await detailDd(page, 'Max Z').textContent()) ?? '').replace(/[^0-9.]/g, ''));
  const tiltCopy = await composeCopy(page, BASE_NAME, TILT_NAME);
  await closeComposeDialog(page);
  await rebuildComposite(page, tiltCopy);
  const tiltMaxZ = Number.parseFloat(((await detailDd(page, 'Max Z').textContent()) ?? '').replace(/[^0-9.]/g, ''));
  expect(tiltMaxZ).toBeGreaterThan(baseMaxZ + 5);
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------
// paste identity + undo/redo
// ---------------------------------------------------------------------------

test('18Y-2: paste keeps target identity, leaves the source byte-identical; undo restores the native definition and redo restores the composite', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  await gotoCad(page, errors);
  await openComposeDrawing(page);
  await prepare(page, [BASE_NAME, BASE_ID], [SAME_NAME, SAME_ID]);

  const sameRowBefore = (await listRow(page, SAME_NAME).textContent()) ?? '';
  await composePaste(page, BASE_NAME, SAME_NAME);
  await expect(page.locator('[data-survey-cad-file-status]')).toContainText('Pasted', { timeout: 60000 });
  await closeComposeDialog(page);
  await listRow(page, BASE_NAME).click();
  await expect(detailDd(page, 'Source Type')).toHaveText('Composite Explicit TIN');

  await expect(detailDd(page, 'Base')).toHaveText(BASE_NAME);
  await expect(detailDd(page, 'Overlay')).toHaveText(SAME_NAME);
  await expect(toolspaceSurface(page, BASE_ID)).toBeVisible();
  expect((await listRow(page, SAME_NAME).textContent()) ?? '').toBe(sameRowBefore);

  // Undo → native definition; redo → composite again.
  await ribbonTab(page, 'Home').click();
  await page.locator('[data-cad-command="SHELL_UNDO"]').click();
  await showSurveyTab(page);
  await listRow(page, BASE_NAME).click();
  await expect(detailDd(page, 'Source')).toContainText('Native TIN (survey points)');
  await ribbonTab(page, 'Home').click();
  await page.locator('[data-cad-command="SHELL_REDO"]').click();
  await showSurveyTab(page);
  await listRow(page, BASE_NAME).click();
  await expect(detailDd(page, 'Source Type')).toHaveText('Composite Explicit TIN');
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------
// mismatch blocked + zero history
// ---------------------------------------------------------------------------

test('18Y-3: a seam Z mismatch blocks before any history entry (no new surface, no undo step)', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  await gotoCad(page, errors);
  await openComposeDrawing(page);
  await prepare(page, [BASE_NAME, BASE_ID], [RAISED_NAME, RAISED_ID]);

  const namesBefore = await surfaceNames(page);
  await openComposeDialog(page, 'copy');
  await stageCompose(page, BASE_NAME, RAISED_NAME);
  await composeCommitButton(page).click();
  await expect(composeNotice(page)).toContainText('Blocked', { timeout: 30000 });
  await expect(composeNotice(page)).toContainText('mismatch');
  await closeComposeDialog(page);

  expect(await surfaceNames(page)).toEqual(namesBefore);
  // No compose history entry: there is nothing to undo.
  await ribbonTab(page, 'Home').click();
  await expect(page.locator('[data-cad-command="SHELL_UNDO"]')).toBeDisabled();
  await showSurveyTab(page);
  expect(await surfaceNames(page)).toEqual(namesBefore);
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------
// void show-through + base-void fill + disjoint
// ---------------------------------------------------------------------------

test('18Y-4: an overlay hole exposes the base (seam present) and a same-plane overlay fills a base void', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  await gotoCad(page, errors);
  await openComposeDrawing(page);
  await prepare(page, [BASE_NAME, BASE_ID], [HOLED_NAME, HOLED_ID]);

  const holedCopy = await composeCopy(page, BASE_NAME, HOLED_NAME);
  await expect(composeSummary(page).locator('dt:text-is("Seam length") + dd')).not.toHaveText('0.000 m');
  await closeComposeDialog(page);
  await rebuildComposite(page, holedCopy);
  await listRow(page, BASE_NAME).click();
  const baseArea = await surfaceArea(page);
  await listRow(page, holedCopy).click();
  const holedArea = await surfaceArea(page);
  // The base shows through the hole: the composed domain is the full base.
  expect(holedArea).toBeGreaterThan(baseArea * 0.98);

  // Base void filled by a same-plane overlay.
  await prepare(page, [VOIDBASE_NAME, VOIDBASE_ID], [VOIDFILL_NAME, VOIDFILL_ID]);
  await listRow(page, VOIDBASE_NAME).click();
  const voidBaseArea = await surfaceArea(page);
  const fillCopy = await composeCopy(page, VOIDBASE_NAME, VOIDFILL_NAME);
  await closeComposeDialog(page);
  await rebuildComposite(page, fillCopy);
  const filledArea = await surfaceArea(page);
  expect(filledArea).toBeGreaterThan(voidBaseArea * 1.03);
  expect(errors).toEqual([]);
});

test('18Y-5: disjoint surfaces union with no seam (result area = base + overlay)', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  await gotoCad(page, errors);
  await openComposeDrawing(page);
  await prepare(page, [BASE_NAME, BASE_ID], [FAR_NAME, FAR_ID]);

  await listRow(page, BASE_NAME).click();
  const baseArea = await surfaceArea(page);
  await listRow(page, FAR_NAME).click();
  const farArea = await surfaceArea(page);
  const copy = await composeCopy(page, BASE_NAME, FAR_NAME);
  await expect(composeSummary(page).locator('dt:text-is("Seam length") + dd')).toHaveText('0.000 m');
  await closeComposeDialog(page);
  await rebuildComposite(page, copy);
  const resultArea = await surfaceArea(page);
  expect(resultArea).toBeGreaterThan((baseArea + farArea) * 0.97);
  expect(resultArea).toBeLessThan((baseArea + farArea) * 1.03);
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------
// post-compose edits (18T)
// ---------------------------------------------------------------------------

test('18Y-6: a composite accepts an ordinary Set Elevation edit and rebuilds CURRENT', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  await gotoCad(page, errors);
  await openComposeDrawing(page);
  await prepare(page, [BASE_NAME, BASE_ID], [SAME_NAME, SAME_ID]);
  await composePaste(page, BASE_NAME, SAME_NAME);
  await expect(page.locator('[data-survey-cad-file-status]')).toContainText('Pasted', { timeout: 60000 });
  await closeComposeDialog(page);
  await listRow(page, BASE_NAME).click();
  await expect(detailDd(page, 'Source Type')).toHaveText('Composite Explicit TIN');
  await rebuildComposite(page, BASE_NAME);

  await startEdit(page, 'set-elevation', 'set-elevation');
  await stageXy(page, 'set-elevation', '20', '20');
  await dockValue(page, '200');
  await commitEdit(page, 'set-elevation');
  await waitCurrent(page, BASE_ID);
  await listRow(page, BASE_NAME).click();
  await expect(detailDd(page, 'Post-composite Edits')).toHaveText('1');
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------
// dependents stale + rebuild
// ---------------------------------------------------------------------------

test('18Y-7: pasting into a composite source stales its Volume + Analysis dependents, which rebuild to equivalent results', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  await gotoCad(page, errors);
  await openComposeDrawing(page);
  await prepare(page, [BASE_NAME, BASE_ID], [TWIN_NAME, TWIN_ID], [SAME_NAME, SAME_ID]);
  const copy = await composeCopy(page, BASE_NAME, TWIN_NAME);
  await closeComposeDialog(page);
  await rebuildComposite(page, copy);

  const manager = managerScope(page);
  await manager.getByLabel('New volume name').fill('Y-Vol');
  await manager.getByLabel('New volume base surface').selectOption({ label: copy });
  await manager.getByLabel('New volume comparison surface').selectOption({ label: TWIN_NAME });
  await manager.getByRole('button', { name: 'Create Volume' }).click();
  const volumeRow = manager.locator('[data-volume-list] [data-cad-volume]').first();
  const volumeId = (await volumeRow.getAttribute('data-cad-volume')) ?? '';
  const volumeDetail = manager.locator(`[data-volume-detail="${volumeId}"]`);
  await volumeRow.click();
  await volumeDetail.getByRole('button', { name: /^Calculate|Recalculate$/ }).click();
  const quantities = manager.locator('[data-volume-quantities="current"]');
  await expect.poll(async () => (await quantities.textContent()) ?? '', { timeout: 60000 }).toContain('Net volume');

  await listRow(page, copy).click();
  await manager.locator('[data-cad-analysis-new-elevation]').click();
  const analysisRow = manager.locator('[data-cad-analysis-list] [data-cad-analysis]').last();
  const analysisId = (await analysisRow.getAttribute('data-cad-analysis')) ?? '';
  await analysisRow.click();
  await manager.locator('[data-cad-analysis-calculate]').click();
  await expect.poll(
    () => manager.locator(`[data-cad-analysis="${analysisId}"]`).getAttribute('data-cad-analysis-status'),
    { timeout: 60000 },
  ).toBe('CURRENT');

  // Paste SAME into the composite → the composite's revision advances, so
  // every dependent goes stale.
  await listRow(page, copy).click();
  await composePaste(page, copy, SAME_NAME);
  await expect(page.locator('[data-survey-cad-file-status]')).toContainText('Pasted', { timeout: 60000 });
  await closeComposeDialog(page);
  await listRow(page, copy).click();
  await expect(detailDd(page, 'Source Type')).toHaveText('Composite Explicit TIN');
  await volumeRow.click();
  await expect(manager.locator('[data-volume-quantities="stale"]')).toBeVisible({ timeout: 30000 });
  await expect.poll(
    () => manager.locator(`[data-cad-analysis="${analysisId}"]`).getAttribute('data-cad-analysis-status'),
    { timeout: 60000 },
  ).not.toBe('CURRENT');
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------
// save/reopen
// ---------------------------------------------------------------------------

test('18Y-8: a composite persists as explicit topology (honest UNBUILT) and rebuilds exactly after reopen', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  await gotoCad(page, errors);
  await openComposeDrawing(page);
  await prepare(page, [BASE_NAME, BASE_ID], [SAME_NAME, SAME_ID]);
  const copy = await composeCopy(page, BASE_NAME, SAME_NAME);
  await closeComposeDialog(page);
  const stats = await rebuildComposite(page, copy);

  const savedPath = await saveDrawingToTemp(page);
  await page.goto('/cad', { waitUntil: 'networkidle' });
  await expect(page.getByText('WebNet CAD', { exact: true }).first()).toBeVisible({ timeout: 30000 });
  await openDrawingFile(page, savedPath, ENTITY_COUNT);
  await showSurveyTab(page);
  await openSurfaceManager(page);
  await listRow(page, copy).click();
  await expect(detailDd(page, 'Source Type')).toHaveText('Composite Explicit TIN');
  await expect(detailDd(page, 'Status')).toHaveText('Unbuilt');
  const rebuilt = await rebuildComposite(page, copy);
  expect(rebuilt).toEqual(stats);
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------
// transform + LandXML
// ---------------------------------------------------------------------------

test('18Y-9: PROJECTTRANSFORM scales composite vertices exactly once; the composite exports to LandXML with its own geometry', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  await gotoCad(page, errors);
  await openComposeDrawing(page);
  await prepare(page, [BASE_NAME, BASE_ID], [SAME_NAME, SAME_ID]);
  const copy = await composeCopy(page, BASE_NAME, SAME_NAME);
  await closeComposeDialog(page);
  await rebuildComposite(page, copy);
  await listRow(page, copy).click();
  const areaBefore = await surfaceArea(page);

  await closeSurfaceManager(page);
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

  await showSurveyTab(page);
  await openSurfaceManager(page);
  await rebuildComposite(page, copy);
  await listRow(page, copy).click();
  const areaAfter = await surfaceArea(page);
  expect(areaAfter / areaBefore).toBeGreaterThan(3.9);
  expect(areaAfter / areaBefore).toBeLessThan(4.1);

  const stats = await rebuildComposite(page, copy);
  await closeSurfaceManager(page);
  await ribbonTab(page, 'Output').click();
  await page.locator('[data-cad-command="SHELL_EXPORT_CENTER"]').click();
  const center = page.locator('section[aria-label="Export Center"]');
  await expect(center).toBeVisible({ timeout: 10000 });
  await center.getByRole('tab', { name: 'LandXML (CAD geometry)' }).click();
  const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
  await center.locator('[data-export-center-download]').click();
  const download = await downloadPromise;
  const xmlPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'webnet-18y-xml-')), 'composite.xml');
  await download.saveAs(xmlPath);
  const surfaceBlock = /<Surface[\s\S]*?<\/Surface>/.exec(fs.readFileSync(xmlPath, 'utf8'))?.[0] ?? '';
  expect(surfaceBlock).toContain(`name="${copy}"`);
  expect((surfaceBlock.match(/<P id=/g) ?? []).length).toBe(stats.vertices);
  expect((surfaceBlock.match(/<F>/g) ?? []).length).toBe(stats.triangles);
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------
// registry/ribbon gates
// ---------------------------------------------------------------------------

test('18Y-10: Compose/Paste need two CURRENT surfaces (ribbon + manager disabled otherwise)', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  await gotoCad(page, errors);
  await openComposeDrawing(page);

  await showSurveyTab(page);
  await openSurfaceManager(page);
  await expect(managerScope(page).locator('[data-cad-compose-open]')).toBeDisabled();
  await closeSurfaceManager(page);
  await ribbonTab(page, 'Surface').click();
  await expect(page.locator('[data-cad-surface="compose"]')).toBeDisabled();
  await expect(page.locator('[data-cad-surface="paste"]')).toBeDisabled();

  await showSurveyTab(page);
  await openSurfaceManager(page);
  await rebuildSurface(page, BASE_NAME, BASE_ID);
  // One CURRENT surface is still not enough.
  await expect(managerScope(page).locator('[data-cad-compose-open]')).toBeDisabled();
  await rebuildSurface(page, SAME_NAME, SAME_ID);
  await expect(managerScope(page).locator('[data-cad-compose-open]')).toBeEnabled();
  await closeSurfaceManager(page);
  await ribbonTab(page, 'Surface').click();
  await expect(page.locator('[data-cad-surface="compose"]')).toBeEnabled();
  await expect(page.locator('[data-cad-surface="paste"]')).toBeEnabled();
  expect(errors).toEqual([]);
});
