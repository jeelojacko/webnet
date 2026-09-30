/**
 * Phase 20J Wave C3 browser QA — exact common-tie hybrid grading groups
 * driven through the REAL /cad shell on a production build in headless
 * Chromium. No mocks: every flow opens a seeded .wncad and drives the live
 * ribbon / manager / Toolspace / Properties / command dock / worker,
 * pinning zero page/console/unhandled errors. Screenshots land under
 * docs/evidence/phase20j/ (at most 12 PNGs).
 *
 * Seeding rules honored: target-free hybrid groups never seed from file
 * (persistence drops them fail-closed); seeded surfaces are rebuilt
 * through the shipped Surface manager before they read CURRENT (the
 * 20F.1 honest-disabled pattern).
 *
 * Flows: A analytic seed → Surface-edit target gate → atomic hybrid attach
 * → undo/redo (3 viewports), B hybrid closed square Calculate + inquiry +
 * CSV (3 viewports, inquiry/CSV at 1366), C Extract + Bake + DesignPatch
 * with undo (1366), D Δ=−12 mismatch FAILED (3 viewports), E
 * save/reopen + last-Surface-removal target clear (1366), plus a
 * per-viewport shell regression folded into A/B/D.
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

const EVIDENCE = path.resolve(process.cwd(), 'docs/evidence/phase20j');
fs.mkdirSync(EVIDENCE, { recursive: true });

const VIEWPORTS = [
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
] as const;

let seq = 0;
const nextId = (p: string): string => `${p}-20j-${++seq}`;

const fl = (id: string, pts: Array<[number, number, number]>, closed = false): CadFeatureLineEntity => ({
  id, type: 'feature-line', layerId: 'general', visible: true, locked: false, name: `FL ${id}`,
  vertices: pts.map(([x, y, z], i) => ({ id: `${id}:v${i}`, x, y, z })),
  ...(closed ? { closed: true } : {}),
});

/** Flat Z=0 target covering the 100×100 pad ties (−20..120). */
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

const SQUARE_PTS: Array<[number, number, number]> = [[0, 0, 10], [100, 0, 10], [100, 100, 10], [0, 100, 10]];

const squareCourses = (squareId: string): CadGradingGroup['sourceCourses'] =>
  [0, 1, 2, 3].map((i) => ({
    vertexAId: `${squareId}:v${i}`, vertexBId: `${squareId}:v${(i + 1) % 4}`,
  }));

/** Wave B oracle: FIXED default + Distance/Elevation/Relative overrides (all d=20, limit Z=0). */
const hybridGroupOf = (squareId: string, targetId: string): CadGradingGroup => ({
  id: nextId('grp'),
  name: 'HybridPad',
  sourceFeatureLineId: squareId,
  sourceCourses: squareCourses(squareId),
  targetSurfaceId: targetId,
  side: 'right',
  criterion: { kind: 'fixed', gradeRatio: -0.5 },
  courseCriteria: [
    { sourceCourse: { vertexAId: `${squareId}:v1`, vertexBId: `${squareId}:v2` }, criterion: { kind: 'distance', gradeRatio: -0.5, distance: 20 } },
    { sourceCourse: { vertexAId: `${squareId}:v2`, vertexBId: `${squareId}:v3` }, criterion: { kind: 'elevation', gradeRatio: -0.5, targetElevation: 0 } },
    { sourceCourse: { vertexAId: `${squareId}:v3`, vertexBId: `${squareId}:v0` }, criterion: { kind: 'relative-elevation', gradeRatio: -0.5, relativeElevation: -10 } },
  ],
  maxSearchDistance: 100,
  curveChordTolerance: 0.01,
  cornerMode: 'miter',
  closed: true,
});

/** Analytic seed (no target): the only file-seedable starting point for Flow A. */
const analyticGroupOf = (squareId: string): CadGradingGroup => ({
  id: nextId('grp'),
  name: 'HybridPad',
  sourceFeatureLineId: squareId,
  sourceCourses: squareCourses(squareId),
  side: 'right',
  criterion: { kind: 'distance', gradeRatio: -0.5, distance: 20 },
  maxSearchDistance: 100,
  curveChordTolerance: 0.01,
  cornerMode: 'miter',
  closed: true,
});

const writeWorld = (group: (_squareId: string, _targetId: string) => CadGradingGroup): { file: string; targetId: string } => {
  const squareId = nextId('fl-square');
  const targetId = nextId('tgt');
  const project: CadProject = {
    ...createBlankCadDrawingDocument({ name: '20J hybrid QA', units: 'm' }).project,
    entities: [fl(squareId, SQUARE_PTS, true)],
    surfaces: [flatTarget(targetId)],
    gradingGroups: [group(squareId, targetId)],
  };
  const file = path.join(os.tmpdir(), `wn-20j-${Date.now()}-${Math.floor(Math.random() * 1e6)}.wncad`);
  fs.writeFileSync(file, serializeCadDrawingFile({ ...createBlankCadDrawingDocument({ name: 'q', units: 'm' }), project }), 'utf8');
  return { file, targetId };
};

const openGroupManager = async (page: Page): Promise<void> => {
  await homeTab(page);
  await page.locator('[data-cad-grading-group-command="GRADINGGROUP"]').click();
  await expect(page.locator('[data-cad-grading-group-table]')).toBeVisible({ timeout: 15000 });
};

/** Rebuild the seeded Flat surface through the shipped Surface manager (20F.1 pattern). */
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

const redoOnce = async (page: Page): Promise<void> => {
  await homeTab(page);
  await page.locator('[data-cad-command="SHELL_REDO"]').click();
};

const revealRowStatus = (page: Page): Promise<void> => page.evaluate(() => {
  const table = document.querySelector('[data-cad-grading-group-table]');
  if (table) table.scrollLeft = table.scrollWidth;
});
const revealRowMethod = (page: Page): Promise<void> => page.evaluate(() => {
  const table = document.querySelector('[data-cad-grading-group-table]');
  if (table) table.scrollLeft = 0;
});

const surfaceNodes = (page: Page): ReturnType<Page['locator']> =>
  page.locator('[data-cad-toolspace] [data-cad-surface]');
const groupRow = (page: Page): ReturnType<Page['locator']> =>
  page.locator('[data-cad-grading-group-row]').first();

const geometry: Record<string, unknown> = {};
test.afterAll(() => {
  fs.writeFileSync(`${EVIDENCE}/geometry.json`, JSON.stringify(geometry, null, 2));
});

const shot = async (page: Page, name: string): Promise<void> => {
  geometry[name] = await page.evaluate(() => {
    const box = (sel: string): Record<string, number> | null => {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height, scrollW: el.scrollWidth, clientW: el.clientWidth };
    };
    return {
      innerW: window.innerWidth, innerH: window.innerHeight,
      docScrollW: document.documentElement.scrollWidth, docScrollH: document.documentElement.scrollHeight,
      ribbon: box('[data-cad-ribbon]'), viewport: box('[data-cad-viewport]'), manager: box('section[aria-label="Grading group manager"]'),
    };
  });
  await page.screenshot({ path: `${EVIDENCE}/${name}.png` });
};

/** Shell regression: ribbon ≤130px, one band, no overflow, one palette/input, scrollable table. */
const assertShell = async (page: Page): Promise<void> => {
  const shell = await page.evaluate(() => {
    const ribbon = document.querySelector('[data-cad-ribbon]') as HTMLElement | null;
    const groups = document.querySelector('.cad-shell-ribbon-groups') as HTMLElement | null;
    const table = document.querySelector('[data-cad-grading-group-table]') as HTMLElement | null;
    const viewportEl = document.querySelector('[data-cad-viewport]') as HTMLElement | null;
    const cs = (el: Element | null, prop: string): string =>
      el == null ? 'missing' : getComputedStyle(el).getPropertyValue(prop);
    return {
      ribbonH: ribbon?.getBoundingClientRect().height ?? -1,
      bands: document.querySelectorAll('[data-cad-ribbon] .cad-shell-ribbon-groups').length,
      groupsWrap: groups ? cs(groups, 'flex-wrap') : 'missing',
      groupsOverflowX: groups ? cs(groups, 'overflow-x') : 'missing',
      tableOverflowX: table ? cs(table, 'overflow-x') : 'missing',
      docScrollW: document.documentElement.scrollWidth,
      docScrollH: document.documentElement.scrollHeight,
      innerW: window.innerWidth,
      innerH: window.innerHeight,
      propertiesCount: document.querySelectorAll('[data-cad-properties]').length,
      commandInputCount: document.querySelectorAll('[data-cad-command-input]').length,
      viewportH: viewportEl?.getBoundingClientRect().height ?? -1,
      modelPresent: viewportEl?.querySelector('svg') != null || viewportEl?.querySelector('canvas') != null,
    };
  });
  expect(shell.ribbonH).toBeLessThanOrEqual(130);
  expect(shell.bands).toBe(1);
  expect(shell.groupsWrap).toBe('nowrap');
  expect(['auto', 'scroll']).toContain(shell.groupsOverflowX);
  expect(['auto', 'scroll']).toContain(shell.tableOverflowX);
  expect(shell.propertiesCount).toBe(1);
  expect(shell.commandInputCount).toBe(1);
  expect(shell.docScrollH).toBeLessThanOrEqual(shell.innerH + 1);
  expect(shell.docScrollW).toBeLessThanOrEqual(shell.innerW + 1);
  expect(shell.viewportH).toBeGreaterThan(300);
  expect(shell.modelPresent).toBe(true);
};

// ===========================================================================
// Flow A — analytic seed → Surface-edit target gate → atomic hybrid → undo/redo
// ===========================================================================
for (const viewport of VIEWPORTS) {
  test(`20J Flow A hybrid target gate + undo/redo @ ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    await gotoCad(page, errors);
    const { file, targetId } = writeWorld((_squareId) => analyticGroupOf(_squareId));
    const tag = `${viewport.width}`;
    try {
      await openSurveyPlanDrawing(page, file);
      // No rebuild yet: Flat is not CURRENT, so the target gate is live.
      await openGroupManager(page);
      const row = groupRow(page);
      await expect(row).toHaveAttribute('data-cad-grading-group-row-method', 'Distance', { timeout: 15000 });
      await expect(row).toContainText('Not applicable');
      await expect(row).toContainText('Unbuilt');

      // Composer offers all four methods with no domain lock.
      await page.locator('[data-cad-grading-group-tab="criteria"]').click();
      const panel = page.locator('[data-cad-grading-group-criteria]');
      await expect(panel).toBeVisible({ timeout: 10000 });
      const select = panel.locator('[data-cad-grading-field="cad-grading-group-criteria-method"]');
      await expect(select).toBeVisible();
      const options = await select.locator('option').allTextContents();
      expect(options).toEqual(['Surface', 'Distance', 'Elevation', 'Relative Elevation']);
      await expect(panel.locator('[data-cad-grading-field="cad-grading-group-criteria-method-locked"]')).toHaveCount(0);

      // Target gate: a Surface edit with no CURRENT surface is rejected — nothing mutates.
      await panel.locator('[aria-label="Select Course 1"]').check();
      await select.selectOption('surface');
      await expect(panel.locator('[data-cad-grading-group-hybrid-warning]')).toContainText('one exact common tie');
      await panel.locator('[data-cad-grading-group-criteria-apply-selected]').click();
      await expect(page.locator('[data-cad-grading-group-notice]')).toContainText('needs a CURRENT target', { timeout: 10000 });
      await page.locator('[data-cad-grading-group-tab="definition"]').click();
      await expect(groupRow(page)).toHaveAttribute('data-cad-grading-group-row-method', 'Distance');
      if (viewport.width === 1366) await shot(page, '1366-hybrid-target-gate');

      // Rebuild Flat, then the same Surface edit attaches target + override atomically.
      await rebuildSurface(page, targetId);
      await openGroupManager(page);
      await page.locator('[data-cad-grading-group-tab="criteria"]').click();
      await panel.locator('[aria-label="Select Course 1"]').check();
      await select.selectOption('surface');
      await panel.locator('[data-cad-grading-group-criteria-apply-selected]').click();
      await expect(page.locator('[data-cad-grading-group-notice]')).toContainText('verrid', { timeout: 10000 });
      await expect(panel.locator('[data-cad-grading-group-hybrid-warning]')).toContainText('one exact common tie');
      await page.locator('[data-cad-grading-group-tab="definition"]').click();
      await expect(row).toHaveAttribute('data-cad-grading-group-row-method', 'Hybrid');
      await expect(row).toContainText('Flat');
      await expect(page.locator('[data-cad-grading-group-calculate]')).toBeEnabled({ timeout: 15000 });

      // Undo removes override + target atomically; redo restores both.
      await undoOnce(page);
      if (!(await page.locator('[data-cad-grading-group-table]').isVisible())) await openGroupManager(page);
      await expect(groupRow(page)).toHaveAttribute('data-cad-grading-group-row-method', 'Distance');
      await expect(groupRow(page)).toContainText('Not applicable');
      await redoOnce(page);
      if (!(await page.locator('[data-cad-grading-group-table]').isVisible())) await openGroupManager(page);
      await expect(groupRow(page)).toHaveAttribute('data-cad-grading-group-row-method', 'Hybrid');
      await expect(groupRow(page)).toContainText('Flat');
      await page.locator('[data-cad-grading-group-tab="definition"]').click();
      await groupRow(page).scrollIntoViewIfNeeded();
      await revealRowMethod(page);
      await assertShell(page);
      await shot(page, `${tag}-hybrid-editor`);
    } finally {
      fs.rmSync(file, { force: true });
    }
    expect(errors).toEqual([]);
  });
}

// ===========================================================================
// Flow B — hybrid closed square: Calculate + inquiry + CSV
// ===========================================================================
for (const viewport of VIEWPORTS) {
  test(`20J Flow B hybrid CURRENT square @ ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    await gotoCad(page, errors);
    const { file, targetId } = writeWorld((squareId, tgt) => hybridGroupOf(squareId, tgt));
    const tag = `${viewport.width}`;
    try {
      await openSurveyPlanDrawing(page, file);
      await rebuildSurface(page, targetId);
      await openGroupManager(page);
      const row = groupRow(page);
      await expect(row).toHaveAttribute('data-cad-grading-group-row-method', 'Hybrid');
      await row.click();
      await expect(page.locator('[data-cad-grading-group-calculate]')).toBeEnabled({ timeout: 15000 });
      await page.locator('[data-cad-grading-group-calculate]').click();
      await expect(row).toContainText('Current', { timeout: 60000 });
      await expect(row).toContainText('Flat');
      await expect(row).toContainText('20.00–20.00 m');
      await expect(row).toContainText('9600.0');
      await groupRow(page).scrollIntoViewIfNeeded();
      await revealRowStatus(page);
      // The manager table is wider than the dialog: the status scroll
      // clips the row's Method cell, so bring the Toolspace tree's
      // `Method Hybrid` row into the frame alongside the metrics
      // (no-op where already visible).
      await page.locator('[data-cad-grading-group-definition]').first().scrollIntoViewIfNeeded();
      await assertShell(page);
      await shot(page, `${tag}-hybrid-current`);

      if (viewport.width === 1366) {
        await page.locator('[data-cad-grading-group-tab="inquiry"]').click();
        const report = page.locator('[data-cad-grading-group-inquiry-report]');
        await expect(report).toContainText(
          'Termination: Hybrid · Methods: Surface + Distance + Elevation + Relative Elevation', { timeout: 15000 },
        );
        await expect(report).toContainText('Target: Flat');
        await expect(report).toContainText('Areas: plan 9600.000');
        await expect(report).toContainText('miter 28.284 m');
        await expect(report).toContainText('Grading Boundary');
        await report.scrollIntoViewIfNeeded();
        await shot(page, '1366-hybrid-inquiry');

        const downloadPromise = page.waitForEvent('download', { timeout: 15000 });
        await page.locator('[data-cad-grading-group-csv]').click();
        const csvText = await (await downloadPromise).createReadStream().then(
          (stream) => new Promise<string>((resolve, reject) => {
            let data = '';
            stream.on('data', (chunk) => { data += chunk; });
            stream.on('end', () => resolve(data));
            stream.on('error', reject);
          }),
        );
        expect(csvText).toContain('Termination,Hybrid');
        expect(csvText).toContain('Methods,Hybrid — Surface + Distance + Elevation + Relative Elevation');
        expect(csvText).toContain('Target,Flat');
        expect(csvText).toContain('Plan Area,9600.000');
        expect(csvText).toContain('Grading Boundary E,Grading Boundary N,Grading Boundary Z');
      }
    } finally {
      fs.rmSync(file, { force: true });
    }
    expect(errors).toEqual([]);
  });
}

// ===========================================================================
// Flow C — Extract + Bake + DesignPatch with undo (1366)
// ===========================================================================
test('20J Flow C hybrid products + undo', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const errors: string[] = [];
  await gotoCad(page, errors);
  const { file, targetId } = writeWorld((squareId, tgt) => hybridGroupOf(squareId, tgt));
  try {
    await openSurveyPlanDrawing(page, file);
    await rebuildSurface(page, targetId);
    await openGroupManager(page);
    const row = groupRow(page);
    await row.click();
    await expect(page.locator('[data-cad-grading-group-calculate]')).toBeEnabled({ timeout: 15000 });
    await page.locator('[data-cad-grading-group-calculate]').click();
    await expect(row).toContainText('Current', { timeout: 60000 });

    // Extract adds exactly one feature line; one Undo removes it.
    await page.locator('[data-cad-grading-group-tab="definition"]').click();
    await row.click();
    const entitiesBefore = await entityCount(page);
    await expect(page.locator('[data-cad-grading-group-extract]')).toBeEnabled({ timeout: 10000 });
    await page.locator('[data-cad-grading-group-extract]').click();
    await expect.poll(() => entityCount(page)).toBe(entitiesBefore + 1);
    await undoOnce(page);
    await expect.poll(() => entityCount(page)).toBe(entitiesBefore);
    await expect(row).toContainText('Current');

    // Bake adds exactly one surface; one Undo removes it.
    const surfacesBefore = await surfaceNodes(page).count();
    if (!(await page.locator('[data-cad-grading-group-table]').isVisible())) await openGroupManager(page);
    await row.click();
    await expect(page.locator('[data-cad-grading-group-bake]')).toBeEnabled({ timeout: 10000 });
    await page.locator('[data-cad-grading-group-bake]').click();
    await expect.poll(() => surfaceNodes(page).count()).toBe(surfacesBefore + 1);
    await shot(page, '1366-hybrid-products');

    // DesignPatch from the CURRENT hybrid result via the Design workflow
    // panel; one Undo removes the patch surface.
    await homeTab(page);
    await page.locator('[aria-label="Ribbon tabs"]').getByRole('tab', { name: 'Surface' }).click();
    await page.getByRole('button', { name: 'Add Points' }).first().click();
    const workflow = page.locator('section[aria-label="Design workflow"]');
    await expect(workflow).toBeVisible({ timeout: 15000 });
    await workflow.getByLabel('Grading group').selectOption({ index: 1 });
    const patchButton = workflow.getByRole('button', { name: 'Build Design Patch' });
    await expect(patchButton).toBeEnabled({ timeout: 15000 });
    await patchButton.click();
    await expect.poll(() => surfaceNodes(page).count()).toBe(surfacesBefore + 2);
    await undoOnce(page);
    await expect.poll(() => surfaceNodes(page).count()).toBe(surfacesBefore + 1);
    await undoOnce(page);
    await expect.poll(() => surfaceNodes(page).count()).toBe(surfacesBefore);
  } finally {
    fs.rmSync(file, { force: true });
  }
  expect(errors).toEqual([]);
});

// ===========================================================================
// Flow D — Δ=−12 mismatch fails closed (3 viewports)
// ===========================================================================
for (const viewport of VIEWPORTS) {
  test(`20J Flow D hybrid mismatch FAILED @ ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    await gotoCad(page, errors);
    const { file, targetId } = writeWorld((squareId, tgt) => hybridGroupOf(squareId, tgt));
    const tag = `${viewport.width}`;
    try {
      await openSurveyPlanDrawing(page, file);
      await rebuildSurface(page, targetId);
      await openGroupManager(page);
      const row = groupRow(page);
      await page.locator('[data-cad-grading-group-tab="criteria"]').click();
      const panel = page.locator('[data-cad-grading-group-criteria]');
      await panel.locator('[aria-label="Select Course 2"]').check();
      await panel.locator('[data-cad-grading-field="cad-grading-group-criteria-method"]').selectOption('relative-elevation');
      await panel.locator('[data-cad-grading-field="cad-grading-group-criteria-relative-elevation"]').fill('-12');
      await panel.locator('[data-cad-grading-group-criteria-apply-selected]').click();
      await expect(page.locator('[data-cad-grading-group-notice]')).toContainText('verrid', { timeout: 10000 });

      await page.locator('[data-cad-grading-group-tab="definition"]').click();
      await row.click();
      await expect(page.locator('[data-cad-grading-group-calculate]')).toBeEnabled({ timeout: 15000 });
      await page.locator('[data-cad-grading-group-calculate]').click();
      await expect(row).toContainText('Failed', { timeout: 60000 });
      await expect(row).toHaveAttribute('data-cad-grading-group-row-method', 'Hybrid');
      await expect(row).toContainText(/(CORNER_NO_SOLUTION|GRADING_SURFACE_ANALYTIC_TRANSITION_REQUIRED)/);
      await expect(row).not.toContainText('Current');
      await expect(page.locator('[data-cad-grading-group-extract]')).toBeDisabled();
      await expect(page.locator('[data-cad-grading-group-bake]')).toBeDisabled();
      const diagnostic = (await row.textContent()) ?? '';
      await page.locator('[data-cad-grading-group-calculate]').click();
      await expect(row).toContainText('Failed', { timeout: 60000 });
      expect((await row.textContent()) ?? '').toBe(diagnostic);
      await groupRow(page).scrollIntoViewIfNeeded();
      await revealRowStatus(page);
      // Same split as Flow B: the status scroll clips the row's Method
      // cell, so keep the Toolspace tree's `Method Hybrid` row in the
      // frame alongside the diagnostic (no-op where already visible).
      await page.locator('[data-cad-grading-group-definition]').first().scrollIntoViewIfNeeded();
      await assertShell(page);
      await shot(page, `${tag}-hybrid-failed`);
    } finally {
      fs.rmSync(file, { force: true });
    }
    expect(errors).toEqual([]);
  });
}

// ===========================================================================
// Flow E — save/reopen + last-Surface-removal clears target (1366)
// ===========================================================================
test('20J Flow E hybrid persistence + target clear', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const errors: string[] = [];
  await gotoCad(page, errors);
  // Default Distance + one Surface override: the override is the only
  // surface-effective course, so resetting it clears the target atomically.
  const squareId = nextId('fl-square');
  const targetId = nextId('tgt');
  const project: CadProject = {
    ...createBlankCadDrawingDocument({ name: '20J E', units: 'm' }).project,
    entities: [fl(squareId, [[0, 0, 10], [100, 0, 10], [100, 100, 10]], false)],
    surfaces: [flatTarget(targetId)],
    gradingGroups: [{
      id: nextId('grp'),
      name: 'HybridOpen',
      sourceFeatureLineId: squareId,
      sourceCourses: [
        { vertexAId: `${squareId}:v0`, vertexBId: `${squareId}:v1` },
        { vertexAId: `${squareId}:v1`, vertexBId: `${squareId}:v2` },
      ],
      targetSurfaceId: targetId,
      side: 'right',
      criterion: { kind: 'distance', gradeRatio: -0.5, distance: 20 },
      courseCriteria: [
        { sourceCourse: { vertexAId: `${squareId}:v0`, vertexBId: `${squareId}:v1` }, criterion: { kind: 'fixed', gradeRatio: -0.5 } },
      ],
      maxSearchDistance: 100,
      curveChordTolerance: 0.01,
      cornerMode: 'miter',
      closed: false,
    }],
  };
  const file = path.join(os.tmpdir(), `wn-20j-e-${Date.now()}.wncad`);
  fs.writeFileSync(file, serializeCadDrawingFile({ ...createBlankCadDrawingDocument({ name: 'q', units: 'm' }), project }), 'utf8');
  try {
    await openSurveyPlanDrawing(page, file);
    await rebuildSurface(page, targetId);
    await openGroupManager(page);
    const row = groupRow(page);
    await expect(row).toHaveAttribute('data-cad-grading-group-row-method', 'Hybrid', { timeout: 15000 });
    await expect(row).toContainText('Unbuilt');

    // Save + reopen: hybrid overrides persist, result honestly UNBUILT.
    const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
    await page.getByRole('button', { name: 'Save Drawing' }).first().click();
    const download = await downloadPromise;
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'wn-20j-save-'));
    const savedPath = path.join(dir, 'drawing.wncad');
    await download.saveAs(savedPath);
    await openSurveyPlanDrawing(page, savedPath);
    await rebuildSurface(page, targetId);
    await openGroupManager(page);
    const reopened = groupRow(page);
    await expect(reopened).toHaveAttribute('data-cad-grading-group-row-method', 'Hybrid', { timeout: 15000 });
    await expect(reopened).toContainText('Unbuilt');
    await page.locator('[data-cad-grading-group-tab="criteria"]').click();
    const panel = page.locator('[data-cad-grading-group-criteria]');
    await expect(panel.locator('[data-cad-grading-group-criteria-row="0"]')).toContainText('Override');
    await expect(panel.locator('[data-cad-grading-group-criteria-row="0"]')).toContainText('Surface Fixed');
    await fs.promises.rm(dir, { recursive: true, force: true });

    // Calculate → CURRENT, then reset the last Surface override: the
    // group goes target-free and the dormant target id clears atomically.
    await page.locator('[data-cad-grading-group-tab="definition"]').click();
    await reopened.click();
    await expect(page.locator('[data-cad-grading-group-calculate]')).toBeEnabled({ timeout: 15000 });
    await page.locator('[data-cad-grading-group-calculate]').click();
    await expect(reopened).toContainText('Current', { timeout: 60000 });
    await page.locator('[data-cad-grading-group-tab="criteria"]').click();
    await panel.locator('[aria-label="Select Course 1"]').check();
    await panel.locator('[data-cad-grading-group-criteria-reset-selected]').click();
    await page.locator('[data-cad-grading-group-tab="definition"]').click();
    await expect(groupRow(page)).toContainText('Not applicable');
    // One Undo restores override + target together.
    await undoOnce(page);
    if (!(await page.locator('[data-cad-grading-group-table]').isVisible())) await openGroupManager(page);
    await expect(groupRow(page)).toContainText('Flat');
  } finally {
    fs.rmSync(file, { force: true });
  }
  expect(errors).toEqual([]);
});
