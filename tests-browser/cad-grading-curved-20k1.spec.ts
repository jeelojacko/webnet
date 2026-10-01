/**
 * Phase 20K.1 Wave D2 — bounded Chromium product validation for curved
 * grading seam topology. Drives the REAL `/cad` shell on the shipped
 * engine/worker: a curved all-Distance analytic group and an arc×arc
 * hybrid freeze, at the bounded 1366×768 viewport. No mocks, no
 * screenshots (no UI text changed in this wave).
 *
 * Fixture geometry is the Phase 20K outward rounded square: 4 genuine
 * arcs, chord 100, R 252.5 (bulge 0.1), closed, Z 10. Production resolve
 * path: Feature Line `segmentGeometry` arc bulges -> `resolveGroupInputs`.
 *
 * Flows:
 *   A valid curved all-Distance group: Unbuilt -> Building -> Current ->
 *     plan/area/corner metrics -> Extract + Undo -> Bake + Undo.
 *   B save/reopen: definition survives, result absent, Unbuilt ->
 *     Calculate -> Current topology-valid.
 *   C arc×arc hybrid freeze: Failed, no Current, Extract/Bake/DesignPatch
 *     disabled, zero partial mutation.
 *   D arc×arc freeze diagnostic: CORNER_NO_SOLUTION +
 *     GRADING_SURFACE_ANALYTIC_ARC_PAIR_UNSUPPORTED, stable across recalcs.
 */
import { expect, test, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  createBlankCadDrawingDocument,
  serializeCadDrawingFile,
} from '../src/engine/cad/cadDrawingFile';
import type { CadFeatureLineEntity, CadProject, CadSurface } from '../src/engine/cad/cadTypes';
import type { CadGradingGroup } from '../src/engine/cad/grading/gradingGroupTypes';
import { entityCount, gotoCad, homeTab, openSurveyPlanDrawing } from './cad-survey-plan-19a-helpers';

const VIEWPORT = { width: 1366, height: 768 } as const;

/** Frozen production actuals (probe: plan 9452.124826335094, 128/128). */
const PLAN_AREA = '9452.125';
const AREA_3D = '10567.797';
const PLAN_AREA_ROW = '9452.1';
const TRIANGLES = '128';
const CORNER_MITER = 'miter 24.417 m';

/** Rounded-square side, chord 100, R = 252.5 -> exact bulge. */
const BULGE = 0.1;
const CORNERS: Array<[number, number]> = [[0, 0], [100, 0], [100, 100], [0, 100]];

let seq = 0;
const nextId = (prefix: string): string => `${prefix}-20k1-${++seq}`;

const curvedSquare = (id: string): CadFeatureLineEntity => ({
  id,
  type: 'feature-line',
  layerId: 'general',
  visible: true,
  locked: false,
  name: `FL ${id}`,
  vertices: CORNERS.map(([x, y], i) => ({ id: `${id}:v${i}`, x, y, z: 10 })),
  segmentGeometry: [0, 1, 2, 3].map(() => ({ kind: 'arc' as const, bulge: BULGE })),
  closed: true,
});

const flatTarget = (id: string): CadSurface => ({
  id,
  name: 'Flat',
  definition: {
    sourceKind: 'explicit-tin',
    pointSource: { kind: 'points', pointEntityIds: [] },
    importedTin: {
      vertices: [-60, -60, 0, 160, -60, 0, 160, 160, 0, -60, 160, 0],
      faces: [0, 1, 2, 0, 2, 3],
      provenance: { kind: 'webnet-bake', sourceSurfaceId: 'seed', sourceSurfaceName: 'seed', sourceRevision: 'srev1:seed' },
    },
  },
  cachedRevision: null,
});

const coursesOf = (flId: string): CadGradingGroup['sourceCourses'] =>
  [0, 1, 2, 3].map((i) => ({ vertexAId: `${flId}:v${i}`, vertexBId: `${flId}:v${(i + 1) % 4}` }));

/** Curved all-Distance analytic group (target-free, the C1 seam contract). */
const curvedAnalyticGroup = (flId: string): CadGradingGroup => ({
  id: nextId('grp'),
  name: 'CurvedPad',
  sourceFeatureLineId: flId,
  sourceCourses: coursesOf(flId),
  side: 'right',
  criterion: { kind: 'distance', gradeRatio: -0.5, distance: 20 },
  maxSearchDistance: 100,
  curveChordTolerance: 0.1,
  cornerMode: 'miter',
  closed: true,
});

/** Arc×arc hybrid: one Surface override adjacent to an analytic arc course. */
const curvedHybridGroup = (flId: string, targetId: string): CadGradingGroup => ({
  ...curvedAnalyticGroup(flId),
  id: nextId('grp'),
  name: 'ArcPairPad',
  targetSurfaceId: targetId,
  courseCriteria: [{ sourceCourse: coursesOf(flId)[0]!, criterion: { kind: 'fixed', gradeRatio: -0.5 } }],
});

interface Seed {
  file: string;
  flId: string;
  targetId: string;
}

const writeWorld = (
  makeGroup: (_flId: string, _targetId: string) => CadGradingGroup,
  withTarget: boolean,
): Seed => {
  const flId = nextId('fl');
  const targetId = nextId('tgt');
  const project: CadProject = {
    ...createBlankCadDrawingDocument({ name: '20K.1 curved QA', units: 'm' }).project,
    entities: [curvedSquare(flId)],
    surfaces: withTarget ? [flatTarget(targetId)] : [],
    gradingGroups: [makeGroup(flId, targetId)],
  };
  const file = path.join(os.tmpdir(), `wn-20k1-${Date.now()}-${Math.floor(Math.random() * 1e6)}.wncad`);
  fs.writeFileSync(
    file,
    serializeCadDrawingFile({ ...createBlankCadDrawingDocument({ name: 'q', units: 'm' }), project }),
    'utf8',
  );
  return { file, flId, targetId };
};

// ---------------------------------------------------------------------------
// UI helpers (mirrors the shipped 20J browser harness)
// ---------------------------------------------------------------------------

const openGroupManager = async (page: Page): Promise<void> => {
  await homeTab(page);
  await page.locator('[data-cad-grading-group-command="GRADINGGROUP"]').click();
  await expect(page.locator('[data-cad-grading-group-table]')).toBeVisible({ timeout: 15000 });
};

const groupRow = (page: Page): ReturnType<Page['locator']> =>
  page.locator('[data-cad-grading-group-row]').first();

const rebuildSurface = async (page: Page, surfaceId: string): Promise<void> => {
  await homeTab(page);
  await page.locator('[aria-label="Ribbon tabs"]').getByRole('tab', { name: 'Surface' }).click();
  await page.getByRole('button', { name: 'Add Point Group' }).first().click();
  const manager = page.locator('section[aria-label="Surface manager"]');
  await expect(manager).toBeVisible({ timeout: 10000 });
  await manager.locator('ul button', { hasText: 'Flat' }).click();
  await manager.getByRole('button', { name: 'Rebuild', exact: true }).click();
  await page.locator('[aria-label="Toolspace tabs"]').getByRole('tab', { name: 'Survey' }).click();
  const surface = page.locator(`[data-cad-toolspace] [data-cad-surface="${surfaceId}"]`);
  await expect(surface).toBeVisible({ timeout: 15000 });
  await expect.poll(() => surface.getAttribute('data-cad-surface-status'), { timeout: 60000 }).toBe('CURRENT');
};

const undoOnce = async (page: Page): Promise<void> => {
  await homeTab(page);
  await page.locator('[data-cad-command="SHELL_UNDO"]').click();
};

const revealRowStatus = (page: Page): Promise<void> => page.evaluate(() => {
  const table = document.querySelector('[data-cad-grading-group-table]');
  if (table) table.scrollLeft = table.scrollWidth;
});

/** Calculate through the manager, pin the Building notice, await Current. */
const calculateToCurrent = async (page: Page): Promise<void> => {
  await page.locator('[data-cad-grading-group-tab="definition"]').click();
  const row = groupRow(page);
  await row.click();
  const calculate = page.locator('[data-cad-grading-group-calculate]');
  await expect(calculate).toBeEnabled({ timeout: 15000 });
  await calculate.click();
  // The dispatch notice is the operator-visible BUILDING phase.
  await expect(page.locator('[data-cad-grading-group-notice]')).toContainText('Computing grading group', { timeout: 10000 });
  await expect(row).toContainText('Current', { timeout: 60000 });
};

const surfaceNodes = (page: Page): ReturnType<Page['locator']> =>
  page.locator('[data-cad-toolspace] [data-cad-surface]');

/** Bring the Survey toolspace tab (the surface list) into view. */
const showSurveyTree = async (page: Page): Promise<void> => {
  await page.locator('[aria-label="Toolspace tabs"]').getByRole('tab', { name: 'Survey' }).click();
};

/** Open the Design workflow panel (Surface tab -> Add Points). */
const openDesignWorkflow = async (page: Page): Promise<ReturnType<Page['locator']>> => {
  await homeTab(page);
  await page.locator('[aria-label="Ribbon tabs"]').getByRole('tab', { name: 'Surface' }).click();
  await page.getByRole('button', { name: 'Add Points' }).first().click();
  const workflow = page.locator('section[aria-label="Design workflow"]');
  await expect(workflow).toBeVisible({ timeout: 15000 });
  return workflow;
};

// ---------------------------------------------------------------------------
// Error ledger
// ---------------------------------------------------------------------------

interface Errors {
  page: string[];
  console: string[];
  unhandled: string[];
}

const openCad = async (page: Page): Promise<Errors> => {
  const errors: Errors = { page: [], console: [], unhandled: [] };
  await page.addInitScript(() => {
    const record = window as unknown as { __unhandled?: string[] };
    record.__unhandled = [];
    window.addEventListener('unhandledrejection', (event) => {
      record.__unhandled?.push(String((event as PromiseRejectionEvent).reason));
    });
  });
  page.on('pageerror', (error) => errors.page.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.console.push(message.text());
  });
  await gotoCad(page, []);
  return errors;
};

const drainUnhandled = async (page: Page): Promise<string[]> =>
  page.evaluate(() => (window as unknown as { __unhandled?: string[] }).__unhandled ?? []);

const expectClean = async (page: Page, errors: Errors): Promise<void> => {
  errors.unhandled.push(...(await drainUnhandled(page)));
  expect(errors.page).toEqual([]);
  expect(errors.console).toEqual([]);
  expect(errors.unhandled).toEqual([]);
};

// ===========================================================================
// Flow A — valid curved all-Distance group: products + undo
// ===========================================================================
test('20K.1 Flow A curved all-Distance CURRENT + products/undo @ 1366x768', async ({ page }) => {
  await page.setViewportSize(VIEWPORT);
  const errors = await openCad(page);
  const { file } = writeWorld((flId) => curvedAnalyticGroup(flId), false);
  try {
    await openSurveyPlanDrawing(page, file);
    await openGroupManager(page);
    const row = groupRow(page);
    await expect(row).toHaveAttribute('data-cad-grading-group-row-method', 'Distance', { timeout: 15000 });
    await expect(row).toContainText('Unbuilt');
    await expect(row).toContainText('Not applicable');
    await expect(row).toContainText('4 (closed)');

    await calculateToCurrent(page);

    // Plan / area / corner metrics through the shipped inquiry report.
    await expect(row).toContainText('Current');
    await expect(row).toContainText(PLAN_AREA_ROW);
    await expect(row).toContainText(TRIANGLES);
    await page.locator('[data-cad-grading-group-tab="inquiry"]').click();
    const report = page.locator('[data-cad-grading-group-inquiry-report]');
    await expect(report).toContainText('Termination: Distance', { timeout: 15000 });
    await expect(report).toContainText(`Areas: plan ${PLAN_AREA} / 3D ${AREA_3D}`);
    await expect(report).toContainText('Members: 4 · corners: 4');
    await expect(report).toContainText(`#0 GAP · ${CORNER_MITER}`);

    // Extract adds one feature line; one Undo removes it (CURRENT retained).
    await page.locator('[data-cad-grading-group-tab="definition"]').click();
    await row.click();
    const entitiesBefore = await entityCount(page);
    await page.locator('[data-cad-grading-group-extract]').click();
    await expect.poll(() => entityCount(page)).toBe(entitiesBefore + 1);
    await undoOnce(page);
    await expect.poll(() => entityCount(page)).toBe(entitiesBefore);
    await expect(row).toContainText('Current');

    // Bake adds one surface; one Undo removes it.
    await showSurveyTree(page);
    const surfacesBefore = await surfaceNodes(page).count();
    if (!(await page.locator('[data-cad-grading-group-table]').isVisible())) await openGroupManager(page);
    await groupRow(page).click();
    await page.locator('[data-cad-grading-group-bake]').click();
    await expect.poll(() => surfaceNodes(page).count()).toBe(surfacesBefore + 1);
    await undoOnce(page);
    await expect.poll(() => surfaceNodes(page).count()).toBe(surfacesBefore);
    await revealRowStatus(page);
    await expect(groupRow(page)).toContainText('Current');
  } finally {
    fs.rmSync(file, { force: true });
  }
  await expectClean(page, errors);
});

// ===========================================================================
// Flow B — save/reopen: definition survives, result absent
// ===========================================================================
test('20K.1 Flow B curved all-Distance save/reopen @ 1366x768', async ({ page }) => {
  await page.setViewportSize(VIEWPORT);
  const errors = await openCad(page);
  const { file } = writeWorld((flId) => curvedAnalyticGroup(flId), false);
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'wn-20k1-save-'));
  try {
    await openSurveyPlanDrawing(page, file);
    await openGroupManager(page);
    await expect(groupRow(page)).toHaveAttribute('data-cad-grading-group-row-method', 'Distance', { timeout: 15000 });

    const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
    await page.getByRole('button', { name: 'Save Drawing' }).first().click();
    const savedPath = path.join(dir, 'drawing.wncad');
    await (await downloadPromise).saveAs(savedPath);

    await openSurveyPlanDrawing(page, savedPath);
    await openGroupManager(page);
    const reopened = groupRow(page);
    await expect(reopened).toHaveAttribute('data-cad-grading-group-row-method', 'Distance', { timeout: 15000 });
    await expect(reopened).toContainText('4 (closed)');
    await expect(reopened).toContainText('Unbuilt');
    await expect(reopened).toContainText('--'); // no retained result in the area column
    await expect(reopened).not.toContainText('Current');

    // Calculate -> CURRENT topology-valid (same frozen metrics).
    await calculateToCurrent(page);
    await expect(reopened).toContainText(PLAN_AREA_ROW);
    await expect(reopened).toContainText(TRIANGLES);
    await page.locator('[data-cad-grading-group-tab="inquiry"]').click();
    const report = page.locator('[data-cad-grading-group-inquiry-report]');
    await expect(report).toContainText('Members: 4 · corners: 4', { timeout: 15000 });
    await expect(report).toContainText('Corners:');
    await expect(report).not.toContainText('Failure:');
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
    fs.rmSync(file, { force: true });
  }
  await expectClean(page, errors);
});

// ===========================================================================
// Flow C — arc×arc hybrid FAILED: products disabled, zero partial mutation
// ===========================================================================
test('20K.1 Flow C arc×arc hybrid FAILED, no products @ 1366x768', async ({ page }) => {
  await page.setViewportSize(VIEWPORT);
  const errors = await openCad(page);
  const { file, targetId } = writeWorld((flId, tgt) => curvedHybridGroup(flId, tgt), true);
  try {
    await openSurveyPlanDrawing(page, file);
    await rebuildSurface(page, targetId);
    await openGroupManager(page);
    const row = groupRow(page);
    await expect(row).toHaveAttribute('data-cad-grading-group-row-method', 'Hybrid', { timeout: 15000 });
    await expect(row).toContainText('Unbuilt');

    const entitiesBefore = await entityCount(page);
    const surfacesBefore = await surfaceNodes(page).count();

    await row.click();
    await page.locator('[data-cad-grading-group-calculate]').click();
    await expect(row).toContainText('Failed', { timeout: 60000 });

    // No CURRENT, no phantom products, no partial mutation.
    await expect(row).not.toContainText('Current');
    await expect(page.locator('[data-cad-grading-group-extract]')).toBeDisabled();
    await expect(page.locator('[data-cad-grading-group-bake]')).toBeDisabled();
    await page.locator('[data-cad-grading-group-tab="inquiry"]').click();
    await expect(page.locator('[data-cad-grading-group-inquiry-report]')).toContainText(
      'No CURRENT result — calculate this grading group before inquiry.',
    );

    // Zero partial mutation while the manager still lists the one row.
    await expect(page.locator('[data-cad-grading-group-row]')).toHaveCount(1);
    await expect.poll(() => entityCount(page)).toBe(entitiesBefore);
    await expect.poll(() => surfaceNodes(page).count()).toBe(surfacesBefore);

    // Design Patch refuses the non-CURRENT group.
    const workflow = await openDesignWorkflow(page);
    await workflow.getByLabel('Grading group').selectOption({ index: 1 });
    await expect(workflow.getByRole('button', { name: 'Build Design Patch' })).toBeDisabled();
  } finally {
    fs.rmSync(file, { force: true });
  }
  await expectClean(page, errors);
});

// ===========================================================================
// Flow D — arc×arc freeze: exact diagnostic, stable across recalcs
// ===========================================================================
test('20K.1 Flow D arc×arc freeze diagnostic stable @ 1366x768', async ({ page }) => {
  await page.setViewportSize(VIEWPORT);
  const errors = await openCad(page);
  const { file, targetId } = writeWorld((flId, tgt) => curvedHybridGroup(flId, tgt), true);
  try {
    await openSurveyPlanDrawing(page, file);
    await rebuildSurface(page, targetId);
    await openGroupManager(page);
    const row = groupRow(page);
    await row.click();
    await page.locator('[data-cad-grading-group-calculate]').click();
    await expect(row).toContainText('Failed', { timeout: 60000 });

    const notice = page.locator('[data-cad-grading-group-notice]');
    const failure = 'Calculate failed — CORNER_NO_SOLUTION';
    await expect(notice).toContainText('CORNER_NO_SOLUTION', { timeout: 15000 });
    await expect(notice).toContainText('GRADING_SURFACE_ANALYTIC_ARC_PAIR_UNSUPPORTED');
    expect((await notice.textContent()) ?? '').toContain(failure);
    await expect(row).toContainText('CORNER_NO_SOLUTION');
    await expect(row).toHaveAttribute('data-cad-grading-group-row-method', 'Hybrid');
    const firstDiagnostic = (await notice.textContent()) ?? '';

    // Recalculate: the bounded reason is byte-stable, never CURRENT.
    await page.locator('[data-cad-grading-group-calculate]').click();
    await expect(notice).toContainText('GRADING_SURFACE_ANALYTIC_ARC_PAIR_UNSUPPORTED', { timeout: 60000 });
    expect((await notice.textContent()) ?? '').toBe(firstDiagnostic);
    await expect(row).toContainText('Failed');
    await expect(row).not.toContainText('Current');
  } finally {
    fs.rmSync(file, { force: true });
  }
  await expectClean(page, errors);
});
