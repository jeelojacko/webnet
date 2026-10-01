/**
 * Phase 20K.3 Wave E3 — Chromium QA for the surface-curve authority wave.
 *
 * Production build + `vite preview` only (see `playwright.prod.config.ts`);
 * the REAL `/cad` shell drives the shipped worker. No mocks, no injected
 * results. Zero page / console / unhandled errors asserted per flow.
 *
 * Flows (per viewport 1366x768, 1920x1080, 2560x1440):
 *   A  open curved Surface group, tied split -> BUILDING -> CURRENT (2/2):
 *      Extract unavailable (multi-region), Bake enabled + executes + Undo,
 *      disabled controls are no-ops. Captures `-surface-tied-current` and
 *      `-surface-tied-products`.
 *   B  standalone curved Surface grading -> CURRENT (1/1), no
 *      SOURCE_BOUNDARY reject, Extract + Bake both available, Extract Undo.
 *   C  all-Surface rounded-square group -> CURRENT -> Design Patch enabled ->
 *      one `[PATCH]` surface -> Undo -> Redo. Captures
 *      `-all-surface-design-patch`.
 *   D  closed inward-arc group (chords simple, arcs cross): undeclared extra
 *      boundary cycle -> stable PINCH/NON_MANIFOLD, never CURRENT, zero
 *      mutation. Captures `-extra-cycle-failed`.
 *   E  non-planar Cut/Fill ridge group -> stable TRANSITION_REQUIRED, never
 *      CURRENT, zero partial mutation.
 *   F  arc×arc hybrid joint -> stable CORNER_NO_SOLUTION /
 *      ARC_PAIR_UNSUPPORTED, never CURRENT.
 */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

import {
  calculateGroupToCurrent,
  calculateGroupToFailed,
  countEntities,
  expectClean,
  groupRow,
  openCad,
  openDesignWorkflow,
  openGroupManager,
  openSurveyPlanDrawing,
  redoOnce,
  rebuildSurface,
  showSurveyTree,
  surfaceNodes,
  undoOnce,
  type Errors,
} from './cad-grading-curved-20k2-helpers';
import { homeTab } from './cad-survey-plan-19a-helpers';
import {
  VIEWPORTS,
  writeAllSurfaceWorld,
  writeArcPairWorld,
  writeExtraCycleWorld,
  writeRidgeWorld,
  writeStandaloneArcWorld,
  writeTiedGroupWorld,
} from './cad-grading-curved-20k3-helpers';

const EVIDENCE_DIR = 'docs/evidence/phase20k3';

interface ManifestRow {
  file: string;
  width: number;
  height: number;
  sha256: string;
  viewport: string;
  flow: string;
}

const manifest: ManifestRow[] = [];

/** Viewport screenshot + IHDR dimensions + SHA-256 for the evidence manifest. */
const shot = async (
  page: Page,
  viewport: { width: number; height: number },
  tag: string,
  flow: string,
): Promise<void> => {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const file = `${EVIDENCE_DIR}/${viewport.width}-${tag}.png`;
  await page.screenshot({ path: file });
  const buffer = fs.readFileSync(file);
  manifest.push({
    file,
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    sha256: createHash('sha256').update(buffer).digest('hex'),
    viewport: `${viewport.width}x${viewport.height}`,
    flow,
  });
};

test.afterAll(() => {
  if (manifest.length === 0) return;
  fs.writeFileSync(`${EVIDENCE_DIR}/png-manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
  const digests = manifest.map((entry) => entry.sha256);
  expect(new Set(digests).size).toBe(digests.length);
  for (const entry of manifest) {
    expect(entry.width, `${entry.file} width`).toBe(Number(entry.viewport.split('x')[0]));
    expect(entry.height, `${entry.file} height`).toBe(Number(entry.viewport.split('x')[1]));
  }
});

const openStandaloneManager = async (page: Page): Promise<void> => {
  await homeTab(page);
  await page.locator('[data-cad-grading-command="GRADING"]').click();
  await expect(page.locator('[data-cad-grading-table]')).toBeVisible({ timeout: 15000 });
};

// ---------------------------------------------------------------------------
// Flow A — open curved Surface group, tied split
// ---------------------------------------------------------------------------
const flowA = async (page: Page, viewport: { width: number; height: number }, errors: Errors): Promise<void> => {
  const world = writeTiedGroupWorld();
  try {
    await openSurveyPlanDrawing(page, world.file);
    await rebuildSurface(page, world.targetName!, world.targetId!);
    await openGroupManager(page);
    await calculateGroupToCurrent(page);
    await page.locator('[data-cad-grading-group-tab="definition"]').click();
    await expect(groupRow(page)).toContainText('Current');
    await shot(page, viewport, 'surface-tied-current', 'A');

    // Tied split: Extract cannot represent a disjoint boundary, Bake can.
    await expect(page.locator('[data-cad-grading-group-extract]')).toBeDisabled();
    await expect(page.locator('[data-cad-grading-group-bake]')).toBeEnabled();
    await page.locator('[data-cad-grading-group-tab="inquiry"]').click();
    await expect(page.locator('[data-cad-grading-group-inquiry-report]')).toContainText('Areas');
    await page.locator('[data-cad-grading-group-tab="definition"]').click();

    await showSurveyTree(page);
    const surfacesBefore = await surfaceNodes(page).count();
    await openGroupManager(page);
    await groupRow(page).click();
    await page.locator('[data-cad-grading-group-bake]').click();
    await expect(page.locator('[data-cad-grading-group-notice]')).toContainText('Baked');
    await shot(page, viewport, 'surface-tied-products', 'A');
    await showSurveyTree(page);
    await expect.poll(() => surfaceNodes(page).count(), { timeout: 30000 }).toBe(surfacesBefore + 1);
    await undoOnce(page);
    await expect.poll(() => surfaceNodes(page).count()).toBe(surfacesBefore);

    // No enabled no-op: disabled Extract stays disabled and a second Undo
    // changes nothing (empty stack).
    await openGroupManager(page);
    await groupRow(page).click();
    await expect(page.locator('[data-cad-grading-group-extract]')).toBeDisabled();
    await expect(page.locator('[data-cad-grading-group-bake]')).toBeEnabled();
    const entitiesBefore = await countEntities(page);
    await homeTab(page);
    await expect(page.locator('[data-cad-command="SHELL_UNDO"]')).toBeDisabled();
    await expect.poll(() => countEntities(page)).toBe(entitiesBefore);
  } finally {
    fs.rmSync(world.file, { force: true });
  }
  await expectClean(page, errors);
};

// ---------------------------------------------------------------------------
// Flow B — standalone curved Surface grading
// ---------------------------------------------------------------------------
const flowB = async (page: Page, errors: Errors): Promise<void> => {
  const world = writeStandaloneArcWorld();
  try {
    await openSurveyPlanDrawing(page, world.file);
    await rebuildSurface(page, world.targetName, world.targetId);
    await openStandaloneManager(page);
    await page.locator('[data-cad-grading-row]').first().click();
    await expect(page.locator('[data-cad-grading-calculate]')).toBeEnabled({ timeout: 15000 });
    await page.locator('[data-cad-grading-calculate]').click();
    const row = page.locator('[data-cad-grading-row]').first();
    await expect(row).toContainText('Current', { timeout: 60000 });

    // Wave D: the arc endpoint agreement uses the captured boundary, so no
    // SOURCE_BOUNDARY / DAYLIGHT_Z reject; a single-region strip is 1/1.
    const notice = page.locator('[data-cad-grading-notice]');
    await expect(notice).not.toContainText('GRADING_AGREEMENT_SOURCE_BOUNDARY');
    await expect(notice).not.toContainText('GRADING_AGREEMENT_DAYLIGHT_Z');
    await expect(page.locator('[data-cad-grading-extract]')).toBeEnabled();
    await expect(page.locator('[data-cad-grading-bake]')).toBeEnabled();

    const entitiesBefore = await countEntities(page);
    await page.locator('[data-cad-grading-extract]').click();
    await expect.poll(() => countEntities(page), { timeout: 30000 }).toBe(entitiesBefore + 1);
    await undoOnce(page);
    await expect.poll(() => countEntities(page)).toBe(entitiesBefore);
  } finally {
    fs.rmSync(world.file, { force: true });
  }
  await expectClean(page, errors);
};

// ---------------------------------------------------------------------------
// Flow C — all-Surface Design Patch
// ---------------------------------------------------------------------------
const flowC = async (page: Page, viewport: { width: number; height: number }, errors: Errors): Promise<void> => {
  const world = writeAllSurfaceWorld();
  try {
    await openSurveyPlanDrawing(page, world.file);
    await rebuildSurface(page, world.targetName!, world.targetId!);
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
    const manager = page.locator('section[aria-label="Surface manager"]');
    await expect(
      manager.locator('ul button', { hasText: `${world.groupName} - Design Patch [PATCH]` }),
    ).toBeVisible({ timeout: 15000 });
    await shot(page, viewport, 'all-surface-design-patch', 'C');

    await undoOnce(page);
    await expect.poll(() => surfaceNodes(page).count()).toBe(before);
    await redoOnce(page);
    await expect.poll(() => surfaceNodes(page).count()).toBe(before + 1);
  } finally {
    fs.rmSync(world.file, { force: true });
  }
  await expectClean(page, errors);
};

// ---------------------------------------------------------------------------
// Flow D — undeclared extra cycle (inward arcs), fail-closed
// ---------------------------------------------------------------------------
const flowD = async (page: Page, viewport: { width: number; height: number }, errors: Errors): Promise<void> => {
  const world = writeExtraCycleWorld();
  try {
    await openSurveyPlanDrawing(page, world.file);
    await openGroupManager(page);
    await calculateGroupToFailed(page);

    const row = groupRow(page);
    await expect(row).not.toContainText('Current');
    await expect(row).toContainText(/GROUP_NON_MANIFOLD|ARC_SEAM_PINCH/);
    const first = (await row.textContent()) ?? '';

    // Stable: a second Calculate reaches the same terminal text.
    await page.locator('[data-cad-grading-group-calculate]').click();
    await expect(row).toContainText('Failed', { timeout: 60000 });
    expect((await row.textContent()) ?? '').toBe(first);

    await expect(page.locator('[data-cad-grading-group-extract]')).toBeDisabled();
    await expect(page.locator('[data-cad-grading-group-bake]')).toBeDisabled();
    await expect(page.locator('[data-cad-grading-group-notice]')).toContainText(/failed/i);
    await expect(page.locator('[data-cad-grading-group-notice]')).toContainText(/GROUP_NON_MANIFOLD|PINCH/);
    await page.locator('[data-cad-grading-group-tab="inquiry"]').click();
    await expect(page.locator('[data-cad-grading-group-inquiry-report]')).toContainText('No CURRENT result');
    await shot(page, viewport, 'extra-cycle-failed', 'D');

    const entitiesBefore = await countEntities(page);
    await showSurveyTree(page);
    const surfacesBefore = await surfaceNodes(page).count();
    await expect.poll(() => countEntities(page)).toBe(entitiesBefore);
    await expect.poll(() => surfaceNodes(page).count()).toBe(surfacesBefore);
  } finally {
    fs.rmSync(world.file, { force: true });
  }
  await expectClean(page, errors);
};

// ---------------------------------------------------------------------------
// Flow E — non-planar Cut/Fill transition, fail-closed
// ---------------------------------------------------------------------------
const flowE = async (page: Page, errors: Errors): Promise<void> => {
  const world = writeRidgeWorld();
  try {
    await openSurveyPlanDrawing(page, world.file);
    await rebuildSurface(page, world.targetName!, world.targetId!);
    await openGroupManager(page);
    await calculateGroupToFailed(page);
    const notice = page.locator('[data-cad-grading-group-notice]');
    await expect(notice).toContainText('TRANSITION_REQUIRED');
    await expect(groupRow(page)).not.toContainText('Current');
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
};

// ---------------------------------------------------------------------------
// Flow F — arc×arc unsupported diagnostic
// ---------------------------------------------------------------------------
const flowF = async (page: Page, errors: Errors): Promise<void> => {
  const world = writeArcPairWorld();
  try {
    await openSurveyPlanDrawing(page, world.file);
    await rebuildSurface(page, world.targetName!, world.targetId!);
    await openGroupManager(page);
    await calculateGroupToFailed(page);
    const notice = page.locator('[data-cad-grading-group-notice]');
    await expect(notice).toContainText('ARC_PAIR_UNSUPPORTED');
    await expect(notice).toContainText('CORNER_NO_SOLUTION');
    await expect(groupRow(page)).not.toContainText('Current');
    await expect(page.locator('[data-cad-grading-group-extract]')).toBeDisabled();
    await expect(page.locator('[data-cad-grading-group-bake]')).toBeDisabled();
  } finally {
    fs.rmSync(world.file, { force: true });
  }
  await expectClean(page, errors);
};

for (const viewport of VIEWPORTS) {
  const suffix = `@ ${viewport.width}x${viewport.height}`;

  test(`20K.3 E3 Flow A curved Surface tied split ${suffix}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const errors = await openCad(page);
    await flowA(page, viewport, errors);
  });

  test(`20K.3 E3 Flow B standalone curved Surface ${suffix}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const errors = await openCad(page);
    await flowB(page, errors);
  });

  test(`20K.3 E3 Flow C all-Surface Design Patch ${suffix}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const errors = await openCad(page);
    await flowC(page, viewport, errors);
  });

  test(`20K.3 E3 Flow D extra-cycle fail-closed ${suffix}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const errors = await openCad(page);
    await flowD(page, viewport, errors);
  });

  test(`20K.3 E3 Flow E non-planar Cut/Fill transition ${suffix}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const errors = await openCad(page);
    await flowE(page, errors);
  });

  test(`20K.3 E3 Flow F arc×arc unsupported ${suffix}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const errors = await openCad(page);
    await flowF(page, errors);
  });
}
