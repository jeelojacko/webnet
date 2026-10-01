/**
 * Phase 20K.2 Wave — bounded Chromium validation for the curved-topology
 * closeout worktree. Drives the REAL `/cad` shell on the shipped
 * engine/worker at the bounded 1366×768 viewport. No mocks. No screenshots
 * (no UI text changed in this wave). Zero page/console/unhandled errors
 * asserted per flow. Fixtures + UI helpers live in
 * `cad-grading-curved-20k2-helpers.ts`.
 *
 * Honest scope note. The worktree's surface-terminated curved path does not
 * reach CURRENT through the browser worker: the daylight-Z agreement gate
 * (`GRADING_AGREEMENT_DAYLIGHT_Z`, a ~9e-16 `zeroDelta`) rejects the ~1e-13
 * curve-seam residual, while the offline engine compute succeeds with a
 * two-region tied mesh. Flows A/C record that terminal state honestly; the
 * browser-reachable planar Cut/Fill control is a straight source (Flow D).
 * See `docs/evidence/phase20k2-browser-qa.md`.
 *
 * Flows:
 *   A  partially tied curved Surface: records the honest worker terminal
 *      state, never CURRENT, products disabled, zero mutation; the offline
 *      replay of the SAME project computes a certified two-region mesh.
 *   A2 multi-region availability reachable (straight control): CURRENT but
 *      Extract/Bake UNAVAILABLE, zero mutation — availability == engine gate.
 *   B  valid curved Design Patch: one `[PATCH]` surface with truthful
 *      provenance, one Undo removes, Redo restores.
 *   C  non-planar Cut/Fill fail-closed (curved ridge): stable FAILED, never
 *      CURRENT, products disabled, zero partial mutation.
 *   D  planar Cut/Fill control (straight source, flat target): CURRENT,
 *      single positive-width region, topology-certified, products execute
 *      (Extract + Undo, Bake + Undo).
 *   E  arc×arc freeze: stable CORNER_NO_SOLUTION +
 *      GRADING_SURFACE_ANALYTIC_ARC_PAIR_UNSUPPORTED, never CURRENT.
 */
import { expect, test } from '@playwright/test';
import * as fs from 'node:fs';
import {
  CUT_FILL,
  RIDGE,
  TILT,
  VIEWPORT,
  XS,
  XS_FINE,
  YS,
  calculateGroupToCurrent,
  calculateGroupToFailed,
  countEntities,
  curvedAnalyticGroup,
  curvedHybridGroup,
  expectClean,
  gridSurface,
  groupRow,
  offlineGroup,
  openCad,
  openDesignWorkflow,
  openGroupManager,
  openSurveyPlanDrawing,
  redoOnce,
  rebuildSurface,
  showSurveyTree,
  surfaceNodes,
  undoOnce,
  writeArcGroupWorld,
  writeGroupWorld,
} from './cad-grading-curved-20k2-helpers';

// ===========================================================================
// Flow A — partially tied curved Surface: honest worker terminal state
// ===========================================================================
test('20K.2 Flow A partially tied curved Surface: honest worker terminal state @ 1366x768', async ({ page }) => {
  await page.setViewportSize(VIEWPORT);
  const errors = await openCad(page);
  const world = writeArcGroupWorld(gridSurface('tgt-tilt', 'Tilt', TILT, XS, YS));
  try {
    // Offline replay of the SAME project: the engine computes a genuinely
    // two-region (partially tied) CURRENT mesh.
    const offline = offlineGroup(world);
    expect(offline.ok).toBe(true);
    expect(offline.components).toBe(2);
    expect(offline.certified).toBe(true);

    await openSurveyPlanDrawing(page, world.file);
    await rebuildSurface(page, world.targetName, world.targetId);
    await openGroupManager(page);
    await calculateGroupToFailed(page);

    // Browser worker terminal state: the daylight agreement gate is stricter
    // than the engine seam residual, so CURRENT is never reached and products
    // stay disabled (availability == execution: not CURRENT -> unavailable).
    const row = groupRow(page);
    await expect(row).toContainText('GRADING_AGREEMENT_DAYLIGHT_Z');
    await expect(row).not.toContainText('Current');
    await expect(page.locator('[data-cad-grading-group-extract]')).toBeDisabled();
    await expect(page.locator('[data-cad-grading-group-bake]')).toBeDisabled();
    await page.locator('[data-cad-grading-group-tab="inquiry"]').click();
    await expect(page.locator('[data-cad-grading-group-inquiry-report]')).toContainText('No CURRENT result');

    // Zero partial mutation.
    await expect(page.locator('[data-cad-grading-group-row]')).toHaveCount(1);
    const entitiesBefore = await countEntities(page);
    await showSurveyTree(page);
    const surfacesBefore = await surfaceNodes(page).count();
    await expect.poll(() => countEntities(page)).toBe(entitiesBefore);
    await expect.poll(() => surfaceNodes(page).count()).toBe(surfacesBefore);
  } finally {
    fs.rmSync(world.file, { force: true });
  }
  await expectClean(page, errors);
});

// ===========================================================================
// Flow A2 — multi-region availability reachable (straight source)
// ===========================================================================
test('20K.2 Flow A2 multi-region availability bound (straight control) @ 1366x768', async ({ page }) => {
  await page.setViewportSize(VIEWPORT);
  const errors = await openCad(page);
  const world = writeArcGroupWorld(gridSurface('tgt-stilt', 'Slope', TILT, XS, YS), CUT_FILL, true);
  try {
    // Offline replay: the genuinely multi-region mesh cannot be certified.
    const offline = offlineGroup(world);
    expect(offline.ok).toBe(true);
    expect(offline.certified).toBe(false);

    await openSurveyPlanDrawing(page, world.file);
    await rebuildSurface(page, world.targetName, world.targetId);
    await openGroupManager(page);
    await calculateGroupToCurrent(page);
    await expect(groupRow(page)).toContainText('Current');

    // Availability == execution: the certificate product gate disables both.
    await expect(page.locator('[data-cad-grading-group-extract]')).toBeDisabled();
    await expect(page.locator('[data-cad-grading-group-bake]')).toBeDisabled();
    const entitiesBefore = await countEntities(page);
    await showSurveyTree(page);
    const surfacesBefore = await surfaceNodes(page).count();
    await expect.poll(() => countEntities(page)).toBe(entitiesBefore);
    await expect.poll(() => surfaceNodes(page).count()).toBe(surfacesBefore);
  } finally {
    fs.rmSync(world.file, { force: true });
  }
  await expectClean(page, errors);
});

// ===========================================================================
// Flow B — valid curved Design Patch: one [PATCH] surface, undo/redo
// ===========================================================================
test('20K.2 Flow B valid curved Design Patch: one patch surface, undo/redo @ 1366x768', async ({ page }) => {
  await page.setViewportSize(VIEWPORT);
  const errors = await openCad(page);
  const world = writeGroupWorld((flId) => curvedAnalyticGroup(flId), false);
  try {
    await openSurveyPlanDrawing(page, world.file);
    await openGroupManager(page);
    await calculateGroupToCurrent(page);

    const workflow = await openDesignWorkflow(page);
    await workflow.getByLabel('Grading group').selectOption({ index: 1 });
    const build = workflow.getByRole('button', { name: 'Build Design Patch' });
    await expect(build).toBeEnabled({ timeout: 15000 });

    await showSurveyTree(page);
    const before = await surfaceNodes(page).count();
    await build.click();
    await expect.poll(() => surfaceNodes(page).count(), { timeout: 30000 }).toBe(before + 1);

    // Truthful provenance: the named Design Patch surface with the [PATCH] role.
    const manager = page.locator('section[aria-label="Surface manager"]');
    await expect(
      manager.locator('ul button', { hasText: `${world.groupName} - Design Patch [PATCH]` }),
    ).toBeVisible({ timeout: 15000 });

    // Exactly one patch: one Undo removes it, Redo restores it.
    await undoOnce(page);
    await expect.poll(() => surfaceNodes(page).count()).toBe(before);
    await redoOnce(page);
    await expect.poll(() => surfaceNodes(page).count()).toBe(before + 1);
    await expect(
      manager.locator('ul button', { hasText: `${world.groupName} - Design Patch [PATCH]` }),
    ).toBeVisible({ timeout: 15000 });
  } finally {
    fs.rmSync(world.file, { force: true });
  }
  await expectClean(page, errors);
});

// ===========================================================================
// Flow C — non-planar Cut/Fill fail-closed
// ===========================================================================
test('20K.2 Flow C non-planar Cut/Fill ridge fails closed @ 1366x768', async ({ page }) => {
  await page.setViewportSize(VIEWPORT);
  const errors = await openCad(page);
  const world = writeArcGroupWorld(gridSurface('tgt-ridge', 'Ridge', RIDGE, XS_FINE, YS));
  try {
    expect(offlineGroup(world).ok).toBe(false); // offline engine: same fail-closed
    await openSurveyPlanDrawing(page, world.file);
    await rebuildSurface(page, world.targetName, world.targetId);
    await openGroupManager(page);
    await calculateGroupToFailed(page);
    const row = groupRow(page);
    const first = (await row.textContent()) ?? '';
    await expect(row).not.toContainText('Current');
    await expect(page.locator('[data-cad-grading-group-extract]')).toBeDisabled();
    await expect(page.locator('[data-cad-grading-group-bake]')).toBeDisabled();

    // Stable FAILED: a second Calculate reaches the same terminal status text.
    await page.locator('[data-cad-grading-group-calculate]').click();
    await expect(row).toContainText('Failed', { timeout: 60000 });
    expect((await row.textContent()) ?? '').toBe(first);

    // Zero partial mutation.
    const entitiesBefore = await countEntities(page);
    await showSurveyTree(page);
    const surfacesBefore = await surfaceNodes(page).count();
    await expect.poll(() => countEntities(page)).toBe(entitiesBefore);
    await expect.poll(() => surfaceNodes(page).count()).toBe(surfacesBefore);
  } finally {
    fs.rmSync(world.file, { force: true });
  }
  await expectClean(page, errors);
});

// ===========================================================================
// Flow D — planar Cut/Fill control: CURRENT single-region, products execute
// ===========================================================================
test('20K.2 Flow D planar Cut/Fill control: CURRENT + products undo @ 1366x768', async ({ page }) => {
  await page.setViewportSize(VIEWPORT);
  const errors = await openCad(page);
  const world = writeArcGroupWorld(gridSurface('tgt-flat', 'Flat', () => 0, XS, YS), CUT_FILL, true);
  try {
    const offline = offlineGroup(world);
    expect(offline.ok).toBe(true);
    expect(offline.components).toBe(1); // single positive-width region
    expect(offline.certified).toBe(true);

    await openSurveyPlanDrawing(page, world.file);
    await rebuildSurface(page, world.targetName, world.targetId);
    await openGroupManager(page);
    await calculateGroupToCurrent(page);

    await page.locator('[data-cad-grading-group-tab="inquiry"]').click();
    const report = page.locator('[data-cad-grading-group-inquiry-report]');
    await expect(report).toContainText('Areas: plan 500.000', { timeout: 15000 });
    await expect(report).toContainText('mesh triangles: 20');
    await page.locator('[data-cad-grading-group-tab="definition"]').click();

    // Availability truthful: single-region -> both products enabled and execute.
    await expect(page.locator('[data-cad-grading-group-extract]')).toBeEnabled();
    await expect(page.locator('[data-cad-grading-group-bake]')).toBeEnabled();

    const entitiesBefore = await countEntities(page);
    await page.locator('[data-cad-grading-group-extract]').click();
    await expect.poll(() => countEntities(page)).toBe(entitiesBefore + 1);
    await undoOnce(page);
    await expect.poll(() => countEntities(page)).toBe(entitiesBefore);

    await showSurveyTree(page);
    const surfacesBefore = await surfaceNodes(page).count();
    if (!(await page.locator('[data-cad-grading-group-table]').isVisible())) await openGroupManager(page);
    await groupRow(page).click();
    await page.locator('[data-cad-grading-group-bake]').click();
    await expect.poll(() => surfaceNodes(page).count()).toBe(surfacesBefore + 1);
    await undoOnce(page);
    await expect.poll(() => surfaceNodes(page).count()).toBe(surfacesBefore);
    await expect(groupRow(page)).toContainText('Current');
  } finally {
    fs.rmSync(world.file, { force: true });
  }
  await expectClean(page, errors);
});

// ===========================================================================
// Flow E — arc×arc freeze: bounded codes, stable, never CURRENT
// ===========================================================================
test('20K.2 Flow E arc×arc freeze diagnostic stable @ 1366x768', async ({ page }) => {
  await page.setViewportSize(VIEWPORT);
  const errors = await openCad(page);
  const world = writeGroupWorld((flId, targetId) => curvedHybridGroup(flId, targetId), true);
  try {
    await openSurveyPlanDrawing(page, world.file);
    await rebuildSurface(page, 'Flat', world.targetId);
    await openGroupManager(page);
    await calculateGroupToFailed(page);

    const notice = page.locator('[data-cad-grading-group-notice]');
    await expect(notice).toContainText('CORNER_NO_SOLUTION', { timeout: 15000 });
    await expect(notice).toContainText('GRADING_SURFACE_ANALYTIC_ARC_PAIR_UNSUPPORTED');
    const first = (await notice.textContent()) ?? '';

    await page.locator('[data-cad-grading-group-calculate]').click();
    await expect(notice).toContainText('GRADING_SURFACE_ANALYTIC_ARC_PAIR_UNSUPPORTED', { timeout: 60000 });
    expect((await notice.textContent()) ?? '').toBe(first);
    await expect(groupRow(page)).toContainText('Failed');
    await expect(groupRow(page)).not.toContainText('Current');
  } finally {
    fs.rmSync(world.file, { force: true });
  }
  await expectClean(page, errors);
});
