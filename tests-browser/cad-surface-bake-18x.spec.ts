/**
 * Phase 18X browser QA — explicit baked-TIN surfaces through the real /cad app.
 *
 * Playwright (dev-server + Chromium), NOT vitest. Drives the shipped UI:
 * ribbon Definition Tools (Bake Copy / Bake In Place), the Surface Manager
 * baked-source block + bake buttons, the EDITS table, Toolspace, the surface
 * inquiry/rebuild lifecycle, Profile/Volume/Analysis dependents, PROJECT
 * TRANSFORM, WNCAD save/reopen, the Export Center LandXML round-trip, and the
 * transient worker BUILDING gate. Zero page/console errors per test.
 *
 * Mission §101 A–M:
 * - 18X-1: A bake copy native (original unchanged, baked label) + C geometry
 *   equivalence + F imported bake-copy distinction (never LandXML).
 * - 18X-2: B bake in place (id/name/style/layer kept, old def/edits gone,
 *   explicit present) + D post-bake Set Elevation with a readable ref + E
 *   re-bake flatten.
 * - 18X-3: G Profile + Volume + Analysis dependents stale → rebuild yields an
 *   equivalent result.
 * - 18X-4: H stale-source bake blocked (manager + ribbon).
 * - 18X-5: I worker BUILDING bake blocked (MutationObserver over the status
 *   attribute; no timing race).
 * - 18X-6: J save/reopen persists the baked source as honest UNBUILT then
 *   rebuilds exact + K undo restores the native definition/edit history, redo
 *   restores the baked definition.
 * - 18X-7: L PROJECTTRANSFORM moves explicit vertices exactly once + M LandXML
 *   export → reimport is equivalent.
 */
import { expect, test, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  IMPORTED_ID,
  IMPORTED_NAME,
  NATIVE_ID,
  NATIVE_NAME,
  BL_ID,
  TWIN_ID,
  TWIN_NAME,
  bakeCopyButton,
  bakeInPlaceButton,
  breaklineRow,
  closeManager,
  commitEdit,
  detailDd,
  dockValue,
  editRowCount,
  gotoCad,
  listRow,
  listStats,
  makeLargeImportedDrawing,
  managerScope,
  openDrawing,
  openDrawingFile,
  openManager,
  pointForm,
  prepareNative,
  rebuildAndWait,
  reloadCad,
  ribbonTab,
  saveDrawingToTemp,
  selectManagerSurface,
  showSurveyTab,
  stageXy,
  startEdit,
  surfaceStatus,
  toolspaceSurface,
  waitCurrent,
} from './cad-surface-bake-18x-helpers';

test.use({ actionTimeout: 15000 });

const BAKED_SUFFIX = ' - Baked';
const bakedName = (source: string): string => `${source}${BAKED_SUFFIX}`;

/** Keep the numeric result, drop the revision-tagged tail (revisions legitimately change). */
const resultText = (text: string | null): string => (text ?? '').split('Source revisions')[0]!;

async function rebuildSelectedAndWait(page: Page, name: string): Promise<void> {
  await managerScope(page).getByRole('button', { name: 'Rebuild', exact: true }).click();
  await expect.poll(async () => (await listRow(page, name).textContent()) ?? '', { timeout: 60000 }).toContain('Current');
}

// ---------------------------------------------------------------------------
// A + C + F
// ---------------------------------------------------------------------------

test('18X-1: Bake Copy leaves the native original untouched (baked label) and copies the mesh exactly; imported copies are never labelled LandXML', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  await gotoCad(page, errors);
  await openDrawing(page);
  await prepareNative(page);

  const nativeBefore = await listStats(page, NATIVE_NAME);
  expect(nativeBefore.triangles).toBeGreaterThan(0);
  expect(await editRowCount(page)).toBe(1);
  const nativeRowBefore = (await listRow(page, NATIVE_NAME).textContent()) ?? '';

  // A: Bake Copy creates a new surface; the original is byte-identical.
  await bakeCopyButton(page).click();
  await expect(listRow(page, bakedName(NATIVE_NAME))).toBeVisible({ timeout: 10000 });
  await selectManagerSurface(page, bakedName(NATIVE_NAME));
  await expect(detailDd(page, 'Source Type')).toHaveText('Baked Explicit TIN');
  await expect(detailDd(page, 'Baked From')).toHaveText(NATIVE_NAME);
  await expect(detailDd(page, 'Post-bake Edits')).toHaveText('0');

  await selectManagerSurface(page, NATIVE_NAME);
  expect((await listRow(page, NATIVE_NAME).textContent()) ?? '').toBe(nativeRowBefore);
  await expect(detailDd(page, 'Source')).toContainText('Native TIN (survey points)');
  expect(await editRowCount(page)).toBe(1);
  await expect(detailDd(page, 'Status')).toHaveText('Current');

  // C: the baked copy rebuilds to CURRENT with the same topology.
  await selectManagerSurface(page, bakedName(NATIVE_NAME));
  await rebuildSelectedAndWait(page, bakedName(NATIVE_NAME));
  const nativeAfterCopy = await listStats(page, NATIVE_NAME);
  expect(nativeAfterCopy).toEqual(nativeBefore);
  const baked = await listStats(page, bakedName(NATIVE_NAME));
  expect(baked.triangles).toBe(nativeBefore.triangles);

  // F: imported bake copy is a baked source, never mislabelled LandXML.
  await selectManagerSurface(page, IMPORTED_NAME);
  await rebuildAndWait(page, IMPORTED_ID);
  await bakeCopyButton(page).click();
  await expect(listRow(page, bakedName(IMPORTED_NAME))).toBeVisible({ timeout: 10000 });
  await selectManagerSurface(page, bakedName(IMPORTED_NAME));
  await expect(detailDd(page, 'Source Type')).toHaveText('Baked Explicit TIN');
  await expect(detailDd(page, 'Baked From')).toHaveText(IMPORTED_NAME);
  await expect(managerScope(page)).not.toContainText('Imported LandXML TIN — 9 vertices');

  // Imported original untouched and still labelled imported.
  await selectManagerSurface(page, IMPORTED_NAME);
  await expect(detailDd(page, 'Source')).toContainText('Imported LandXML TIN');
  await expect(detailDd(page, 'Status')).toHaveText('Current');
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------
// B + D + E
// ---------------------------------------------------------------------------

test('18X-2: Bake In Place keeps identity, flattens the definition/edits, keeps geometry; post-bake Set Elevation uses a readable V-ref and re-bake flattens it', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  await gotoCad(page, errors);
  await openDrawing(page);
  await prepareNative(page);

  const preBake = await listStats(page, NATIVE_NAME);
  const preBakeRow = (await listRow(page, NATIVE_NAME).textContent()) ?? '';
  expect(await editRowCount(page)).toBe(1);

  // B: in-place bake preserves the surface identity and drops the old sources.
  await bakeInPlaceButton(page).click();
  await expect(detailDd(page, 'Source Type')).toHaveText('Baked Explicit TIN');
  await expect(detailDd(page, 'Baked From')).toHaveText(NATIVE_NAME);
  await expect(detailDd(page, 'Post-bake Edits')).toHaveText('0');
  await expect(toolspaceSurface(page, NATIVE_ID)).toBeVisible();
  await expect(managerScope(page)).toContainText('Baked explicit topology');
  expect(await editRowCount(page)).toBe(0);
  // The list badge keeps the surface name/badge slot; only the status flips.
  expect((await listRow(page, NATIVE_NAME).textContent()) ?? '').not.toBe(preBakeRow);

  // Geometry preserved through a rebuild.
  await rebuildAndWait(page, NATIVE_ID);
  expect(await listStats(page, NATIVE_NAME)).toEqual(preBake);

  // D: post-bake Set Elevation on a baked vertex resolves a readable V-ref.
  await startEdit(page, 'set-elevation', 'set-elevation');
  await stageXy(page, 'set-elevation', '20', '20');
  const status = pointForm(page, 'set-elevation').locator('[data-cad-surface-point-status]');
  await expect(status).toContainText(/V\d+/);
  await expect(status).not.toContainText('explicit:');
  await dockValue(page, '200');
  await commitEdit(page, 'set-elevation');
  await expect.poll(() => editRowCount(page), { timeout: 30000 }).toBe(1);
  await waitCurrent(page, NATIVE_ID);
  await expect(managerScope(page).locator('[data-cad-surface-edit]')).toContainText(/Set Elevation V\d+/);

  // E: re-bake folds the new edit into the explicit topology.
  const withEdit = await listStats(page, NATIVE_NAME);
  await bakeInPlaceButton(page).click();
  await expect(detailDd(page, 'Post-bake Edits')).toHaveText('0');
  expect(await editRowCount(page)).toBe(0);
  await rebuildAndWait(page, NATIVE_ID);
  expect(await listStats(page, NATIVE_NAME)).toEqual(withEdit);
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------
// G — dependents
// ---------------------------------------------------------------------------

test('18X-3: Profile + Volume + Analysis go stale after in-place bake and return an equivalent result once rebuilt/recalculated', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  await gotoCad(page, errors);
  await openDrawing(page);

  // Profile first (its own manager) — needs both surfaces CURRENT.
  await prepareNative(page);
  await selectManagerSurface(page, TWIN_NAME);
  await rebuildAndWait(page, TWIN_ID);
  await closeManager(page);

  await ribbonTab(page, 'Surface').click();
  await page.getByRole('button', { name: 'Profile Manager', exact: true }).first().click();
  const profileManager = page.locator('section[aria-label="Profile manager"]');
  await expect(profileManager).toBeVisible({ timeout: 10000 });
  await profileManager.getByLabel('New profile name').fill('X-EG');
  await profileManager.getByLabel('New profile alignment').selectOption({ label: 'X-CL' });
  await profileManager.getByLabel('New profile surface').selectOption({ label: NATIVE_NAME });
  await profileManager.getByRole('button', { name: 'Create Surface Profile' }).click();
  const profileRow = profileManager.locator('[data-profile-list] [data-cad-profile]').last();
  const profileId = (await profileRow.getAttribute('data-cad-profile')) ?? '';
  expect(profileId).not.toBe('');
  await profileRow.click();
  await profileManager.locator('[data-profile-detail]').getByRole('button', { name: 'Rebuild', exact: true }).click();
  const profileStatus = (): Promise<string | null> =>
    page.locator(`[data-cad-toolspace] [data-cad-profile="${profileId}"]`).getAttribute('data-cad-profile-status');
  await expect.poll(profileStatus, { timeout: 60000 }).toBe('CURRENT');
  const profileBefore = resultText(await profileManager.locator('[data-profile-stats]').textContent());
  await profileManager.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(profileManager).toBeHidden({ timeout: 10000 });

  // Volume + Analysis live inside the Surface Manager.
  await openManager(page);
  await selectManagerSurface(page, NATIVE_NAME);
  const manager = managerScope(page);
  await manager.getByLabel('New volume name').fill('X-Vol');
  await manager.getByLabel('New volume base surface').selectOption({ label: NATIVE_NAME });
  await manager.getByLabel('New volume comparison surface').selectOption({ label: TWIN_NAME });
  await manager.getByRole('button', { name: 'Create Volume' }).click();
  await expect.poll(() => manager.locator('[data-volume-list] [data-cad-volume]').count()).toBe(1);
  const volumeRow = manager.locator('[data-volume-list] [data-cad-volume]').first();
  const volumeId = (await volumeRow.getAttribute('data-cad-volume')) ?? '';
  const volumeDetail = manager.locator(`[data-volume-detail="${volumeId}"]`);
  const recalcVolume = () => volumeDetail.getByRole('button', { name: /^Calculate|Recalculate$/ }).click();
  await volumeRow.click();
  await recalcVolume();
  const quantities = manager.locator('[data-volume-quantities="current"]');
  await expect.poll(async () => (await quantities.textContent()) ?? '', { timeout: 60000 }).toContain('Net volume');
  const volumeBefore = resultText(await quantities.textContent());

  await selectManagerSurface(page, NATIVE_NAME);
  await manager.locator('[data-cad-analysis-new-elevation]').click();
  const analysisRow = manager.locator('[data-cad-analysis-list] [data-cad-analysis]').last();
  const analysisId = (await analysisRow.getAttribute('data-cad-analysis')) ?? '';
  expect(analysisId).not.toBe('');
  await analysisRow.click();
  await manager.locator('[data-cad-analysis-calculate]').click();
  const analysisStatus = (): Promise<string | null> =>
    manager.locator(`[data-cad-analysis="${analysisId}"]`).getAttribute('data-cad-analysis-status');
  await expect.poll(analysisStatus, { timeout: 60000 }).toBe('CURRENT');
  const analysisDetail = manager.locator(`[data-cad-analysis-detail="${analysisId}"]`);
  const analysisBefore = resultText(await analysisDetail.textContent());

  // Bake in place: every dependent is now stale.
  await selectManagerSurface(page, NATIVE_NAME);
  await bakeInPlaceButton(page).click();
  await expect(detailDd(page, 'Source Type')).toHaveText('Baked Explicit TIN');
  await expect.poll(profileStatus).not.toBe('CURRENT');
  await expect.poll(analysisStatus).not.toBe('CURRENT');
  await volumeRow.click();
  await expect(manager.locator('[data-volume-quantities="stale"]')).toBeVisible({ timeout: 10000 });

  // Rebuild the baked surface, then rebuild/recalculate every dependent.
  await selectManagerSurface(page, NATIVE_NAME);
  await rebuildAndWait(page, NATIVE_ID);
  await selectManagerSurface(page, TWIN_NAME);
  await rebuildAndWait(page, TWIN_ID);
  await volumeRow.click();
  await recalcVolume();
  await expect.poll(async () => resultText(await quantities.textContent()), { timeout: 60000 }).toContain('Net volume');
  await expect.poll(async () => resultText(await quantities.textContent())).toBe(volumeBefore);
  await analysisRow.click();
  await manager.locator('[data-cad-analysis-calculate]').click();
  await expect.poll(analysisStatus, { timeout: 60000 }).toBe('CURRENT');
  expect(resultText(await analysisDetail.textContent())).toBe(analysisBefore);

  await closeManager(page);
  await ribbonTab(page, 'Surface').click();
  await page.getByRole('button', { name: 'Profile Manager', exact: true }).first().click();
  await expect(page.locator('section[aria-label="Profile manager"]')).toBeVisible({ timeout: 10000 });
  const pm = page.locator('section[aria-label="Profile manager"]');
  await pm.locator(`[data-profile-list] [data-cad-profile="${profileId}"]`).click();
  await pm.locator('[data-profile-detail]').getByRole('button', { name: 'Rebuild', exact: true }).click();
  await expect.poll(profileStatus, { timeout: 60000 }).toBe('CURRENT');
  expect(resultText(await pm.locator('[data-profile-stats]').textContent())).toBe(resultText(profileBefore));
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------
// H + I — gates
// ---------------------------------------------------------------------------

test('18X-4: altering a source without rebuilding blocks Bake (manager and ribbon disabled)', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  await gotoCad(page, errors);
  await openDrawing(page);
  await prepareNative(page);
  await expect(bakeInPlaceButton(page)).toBeEnabled();

  // Alter the native source (drop the breakline) and do not rebuild.
  await breaklineRow(page, BL_ID).getByRole('button', { name: 'Remove' }).click();
  await expect.poll(() => surfaceStatus(page, NATIVE_ID)).toBe('NEEDS_REBUILD');

  await expect(bakeCopyButton(page)).toBeDisabled();
  await expect(bakeInPlaceButton(page)).toBeDisabled();
  await ribbonTab(page, 'Surface').click();
  await expect(page.locator('[data-cad-surface="bake-copy"]')).toBeDisabled();
  await expect(page.locator('[data-cad-surface="bake-in-place"]')).toBeDisabled();
  expect(errors).toEqual([]);
});

test('18X-5: a surface in the transient worker BUILDING state blocks Bake; it re-enables at CURRENT', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  await gotoCad(page, errors);
  await openDrawingFile(page, makeLargeImportedDrawing(), 0);
  await showSurveyTab(page);
  await openManager(page);
  await selectManagerSurface(page, 'X Large');

  // Capture the first worker build: attach the observer BEFORE the UNBUILT →
  // BUILDING transition (a second Rebuild on a CURRENT surface is a cache-hit
  // no-op). Record the status + the Bake button's disabled state at the exact
  // mutation, so there is no polling race.
  await page.evaluate(() => {
    const record = window as unknown as Record<string, unknown>;
    record.__x18SawBuilding = false;
    record.__x18BakeDisabledDuringBuilding = null;
    const observer = new MutationObserver(() => {
      const node = document.querySelector('[data-cad-toolspace] [data-cad-surface="x-large"]');
      if (node?.getAttribute('data-cad-surface-status') !== 'BUILDING') return;
      record.__x18SawBuilding = true;
      const button = Array.from(
        document.querySelectorAll('section[aria-label="Surface manager"] button'),
      ).find((candidate) => candidate.textContent?.trim() === 'Bake In Place');
      record.__x18BakeDisabledDuringBuilding = button ? (button as HTMLButtonElement).disabled : null;
    });
    observer.observe(document.body, { attributes: true, attributeFilter: ['data-cad-surface-status'], subtree: true });
  });

  await managerScope(page).getByRole('button', { name: 'Rebuild', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as Record<string, unknown>).__x18SawBuilding)).toBe(true);
  expect(
    await page.evaluate(() => (window as unknown as Record<string, unknown>).__x18BakeDisabledDuringBuilding),
  ).toBe(true);
  await waitCurrent(page, 'x-large');
  expect((await listRow(page, 'X Large').textContent()) ?? '').toContain('Current');
  await expect(bakeInPlaceButton(page)).toBeEnabled();
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------
// J + K
// ---------------------------------------------------------------------------

test('18X-6: save/reopen persists the baked source as honest UNBUILT then rebuilds exact; undo restores the native definition+edits and redo restores the bake', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  await gotoCad(page, errors);
  await openDrawing(page);
  await prepareNative(page);

  await bakeInPlaceButton(page).click();
  expect(await editRowCount(page)).toBe(0);

  // K: undo restores the pre-bake native definition + seeded edit; redo rebakes
  // (both while the bake is still in the session history).
  await ribbonTab(page, 'Home').click();
  await page.locator('[data-cad-command="SHELL_UNDO"]').click();
  await showSurveyTab(page);
  await selectManagerSurface(page, NATIVE_NAME);
  await expect(detailDd(page, 'Source')).toContainText('Native TIN (survey points)');
  await expect(breaklineRow(page, BL_ID)).toBeVisible({ timeout: 10000 });
  await expect.poll(() => editRowCount(page), { timeout: 30000 }).toBe(1);

  await ribbonTab(page, 'Home').click();
  await page.locator('[data-cad-command="SHELL_REDO"]').click();
  await showSurveyTab(page);
  await selectManagerSurface(page, NATIVE_NAME);
  await expect(detailDd(page, 'Source Type')).toHaveText('Baked Explicit TIN');
  expect(await editRowCount(page)).toBe(0);

  // J: save → full app reload → reopen. Topology persists; the mesh never
  // does, so the surface returns honest UNBUILT, then rebuilds exact.
  await rebuildAndWait(page, NATIVE_ID);
  const baked = await listStats(page, NATIVE_NAME);
  const savedPath = await saveDrawingToTemp(page);
  await reloadCad(page);
  await openDrawingFile(page, savedPath);
  await showSurveyTab(page);
  await openManager(page);
  await selectManagerSurface(page, NATIVE_NAME);
  await expect(detailDd(page, 'Source Type')).toHaveText('Baked Explicit TIN');
  await expect(detailDd(page, 'Baked From')).toHaveText(NATIVE_NAME);
  await expect(detailDd(page, 'Status')).toHaveText('Unbuilt');
  await rebuildAndWait(page, NATIVE_ID);
  expect(await listStats(page, NATIVE_NAME)).toEqual(baked);
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------
// L + M
// ---------------------------------------------------------------------------

test('18X-7: PROJECTTRANSFORM moves baked vertices exactly once; the baked surface exports to LandXML and reimports equivalent', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  await gotoCad(page, errors);
  await openDrawing(page);
  await prepareNative(page);
  await bakeInPlaceButton(page).click();
  await rebuildAndWait(page, NATIVE_ID);

  const areaBefore = Number.parseFloat(((await detailDd(page, 'Area').textContent()) ?? '').replace(/[^0-9.]/g, ''));

  // L: Grid→Ground factor 0.5 = scale 2 about the origin. Explicit vertices
  // scale once, so planimetric area scales by 4 (a double-apply would be 16x).
  await closeManager(page);
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
  await openManager(page);
  await selectManagerSurface(page, NATIVE_NAME);
  await rebuildAndWait(page, NATIVE_ID);
  const areaAfter = Number.parseFloat(((await detailDd(page, 'Area').textContent()) ?? '').replace(/[^0-9.]/g, ''));
  expect(areaAfter / areaBefore).toBeGreaterThan(3.9);
  expect(areaAfter / areaBefore).toBeLessThan(4.1);

  // M: export the baked surface, then reimport it into a fresh drawing.
  const stats = await listStats(page, NATIVE_NAME);
  await closeManager(page);
  await ribbonTab(page, 'Output').click();
  await page.locator('[data-cad-command="SHELL_EXPORT_CENTER"]').click();
  const center = page.locator('section[aria-label="Export Center"]');
  await expect(center).toBeVisible({ timeout: 10000 });
  await center.getByRole('tab', { name: 'LandXML (CAD geometry)' }).click();
  const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
  await center.locator('[data-export-center-download]').click();
  const download = await downloadPromise;
  const xmlPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'webnet-18x-xml-')), 'baked.xml');
  await download.saveAs(xmlPath);
  const xml = fs.readFileSync(xmlPath, 'utf8');
  const surfaceBlock = /<Surface[\s\S]*?<\/Surface>/.exec(xml)?.[0] ?? '';
  expect(surfaceBlock).toContain(`name="${NATIVE_NAME}"`);
  expect((surfaceBlock.match(/<P id=/g) ?? []).length).toBe(stats.vertices);
  expect((surfaceBlock.match(/<F>/g) ?? []).length).toBe(stats.triangles);

  await center.locator('[data-export-center-close]').click();
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: 'New Drawing' }).click();

  const importInput = page.locator('[data-landxml-import-input]');
  await importInput.evaluate((element: HTMLInputElement) => element.classList.remove('hidden')).catch(() => {});
  await importInput.setInputFiles(xmlPath);
  const review = page.locator('[data-landxml-import-review]');
  await expect(review).toBeVisible({ timeout: 15000 });
  await expect(review.locator('[data-landxml-surfaces]')).toContainText(`${stats.vertices} verts`);
  await review.locator('[data-landxml-import-selected]').click();
  const importedRow = page
    .locator('[data-cad-toolspace] [data-cad-surface]')
    .filter({ hasText: NATIVE_NAME })
    .first();
  await expect.poll(async () => importedRow.getAttribute('data-cad-surface-status'), { timeout: 60000 }).toBe('CURRENT');
  expect(errors).toEqual([]);
});
