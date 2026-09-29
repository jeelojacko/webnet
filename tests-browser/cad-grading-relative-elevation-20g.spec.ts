/**
 * Phase 20G browser QA — Grade to Relative Elevation driven through the REAL
 * /cad shell on a production build in headless Chromium. No mocks: every
 * flow opens a seeded .wncad and drives the live ribbon / manager /
 * Toolspace / Properties / command dock, pinning zero page/console errors.
 * Screenshots land under docs/evidence/phase20g/ (exactly 12, no extras).
 *
 * Flows: A standalone relative create->calc->CURRENT->properties/inquiry,
 * B relative-vs-absolute distinction, C edit+undo/redo+save/reopen, D group
 * lock+override+reset->CURRENT->extract/bake->incompatible FAILED, E failure
 * gates, plus a per-viewport shell regression (§22 + GTRE reachability).
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
import type { CadGrading } from '../src/engine/cad/grading/gradingTypes';
import type { CadGradingGroup } from '../src/engine/cad/grading/gradingGroupTypes';
import {
  entityCount,
  gotoCad,
  homeTab,
  openSurveyPlanDrawing,
  selectionCount,
} from './cad-survey-plan-19a-helpers';

const EVIDENCE = path.resolve(process.cwd(), 'docs/evidence/phase20g');
fs.mkdirSync(EVIDENCE, { recursive: true });

const VIEWPORTS = [
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
] as const;

// ---------------------------------------------------------------------------
// seed world
// ---------------------------------------------------------------------------

let seq = 0;
const nextId = (p: string): string => `${p}-20g-${++seq}`;

const fl = (id: string, pts: Array<[number, number, number]>, closed = false): CadFeatureLineEntity => ({
  id, type: 'feature-line', layerId: 'general', visible: true, locked: false, name: `FL ${id}`,
  vertices: pts.map(([x, y, z], i) => ({ id: `${id}:v${i}`, x, y, z })),
  ...(closed ? { closed: true } : {}),
});

/** Deliberately UNBUILT (never rebuilt through the Surface manager). */
const unbuiltTin = (id: string, name: string): CadSurface => ({
  id, name, layerId: 'general', styleId: 'style-base',
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

const SLOPE_PTS: Array<[number, number, number]> = [[0, 0, 100], [100, 0, 102]];
const SQUARE_PTS: Array<[number, number, number]> = [[0, 0, 10], [100, 0, 10], [100, 100, 10], [0, 100, 10]];

const REL = { kind: 'relative-elevation', gradeRatio: -0.5, relativeElevation: -10 } as const;

interface StandaloneSeed {
  slopeId: string; squareId: string; surfaceId: string;
  withSurface: boolean; gradings: CadGrading[];
}

const writeStandalone = (seed: StandaloneSeed): string => {
  const project: CadProject = {
    ...createBlankCadDrawingDocument({ name: '20G QA', units: 'm' }).project,
    entities: [fl(seed.slopeId, SLOPE_PTS), fl(seed.squareId, SQUARE_PTS, true)],
    surfaces: seed.withSurface ? [unbuiltTin(seed.surfaceId, 'EG')] : [],
    gradings: seed.gradings,
  };
  const file = path.join(os.tmpdir(), `wn-20g-${Date.now()}-${Math.floor(Math.random() * 1e6)}.wncad`);
  fs.writeFileSync(file, serializeCadDrawingFile({ ...createBlankCadDrawingDocument({ name: 'q', units: 'm' }), project }), 'utf8');
  return file;
};

const freshStandalone = (gradings: CadGrading[] = [], withSurface = false): StandaloneSeed => ({
  slopeId: nextId('fl-slope'), squareId: nextId('fl-square'), surfaceId: nextId('tgt'),
  withSurface, gradings,
});

const writeGroupWorld = (squareId: string, group: CadGradingGroup): string => {
  const project: CadProject = {
    ...createBlankCadDrawingDocument({ name: '20G group QA', units: 'm' }).project,
    entities: [fl(squareId, SQUARE_PTS, true)],
    surfaces: [],
    gradingGroups: [group],
  };
  const file = path.join(os.tmpdir(), `wn-20gg-${Date.now()}-${Math.floor(Math.random() * 1e6)}.wncad`);
  fs.writeFileSync(file, serializeCadDrawingFile({ ...createBlankCadDrawingDocument({ name: 'q', units: 'm' }), project }), 'utf8');
  return file;
};

const closedGroupOf = (squareId: string): CadGradingGroup => ({
  id: nextId('grp'),
  name: 'RelGrp',
  sourceFeatureLineId: squareId,
  sourceCourses: [0, 1, 2, 3].map((i) => ({
    vertexAId: `${squareId}:v${i}`, vertexBId: `${squareId}:v${(i + 1) % 4}`,
  })),
  side: 'right',
  criterion: { ...REL },
  maxSearchDistance: 50,
  curveChordTolerance: 0.05,
  cornerMode: 'miter',
  closed: true,
});

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

const openGradingManager = async (page: Page): Promise<void> => {
  await homeTab(page);
  await page.locator('[data-cad-grading-command="GRADING"]').click();
  await expect(page.locator('[data-cad-grading-table]')).toBeVisible({ timeout: 15000 });
};

const openGroupManager = async (page: Page): Promise<void> => {
  await homeTab(page);
  await page.locator('[data-cad-grading-group-command="GRADINGGROUP"]').click();
  await expect(page.locator('[data-cad-grading-group-table]')).toBeVisible({ timeout: 15000 });
};

const toolspaceSurvey = async (page: Page): Promise<void> => {
  await page.locator('[aria-label="Toolspace tabs"]').getByRole('tab', { name: 'Survey' }).click();
};

/** Select a feature line from the Toolspace Survey tree (canvas-free). */
const selectFeatureLine = async (page: Page, name: string): Promise<void> => {
  await toolspaceSurvey(page);
  await page.locator('[data-cad-toolspace]').getByRole('button', { name }).click();
  await expect.poll(() => selectionCount(page)).toBe(1);
};

const clearCanvasSelection = async (page: Page): Promise<void> => {
  await homeTab(page);
  await page.locator('[data-cad-command="SHELL_CLEAR_SELECTION"]').click();
  await expect.poll(() => selectionCount(page)).toBe(0);
};

const undoOnce = async (page: Page): Promise<void> => {
  await homeTab(page);
  await page.locator('[data-cad-command="SHELL_UNDO"]').click();
};

const redoOnce = async (page: Page): Promise<void> => {
  await homeTab(page);
  await page.locator('[data-cad-command="SHELL_REDO"]').click();
};

const gradingRowByName = (page: Page, name: string) =>
  page.locator('[data-cad-grading-row]', { hasText: name }).first();
const groupRowByName = (page: Page, name: string) =>
  page.locator('[data-cad-grading-group-row]', { hasText: name }).first();

const surfaceNodes = (page: Page) => page.locator('[data-cad-toolspace] [data-cad-surface]');

/** Fill the standalone create form for a -50% / Δ-10 relative grading. */
const fillRelativeCreate = async (page: Page, maxSearch: string): Promise<void> => {
  const form = page.locator('[data-cad-grading-create]');
  await form.locator('[data-cad-grading-field="cad-grading-method"]').selectOption('relative-elevation');
  await form.locator('[aria-label="Grade magnitude"]').fill('50');
  await form.locator('[aria-label="Grade direction"]').selectOption('down');
  await form.locator('[data-cad-grading-field="cad-grading-relative-elevation"]').fill('-10');
  await form.locator('[aria-label="Max search distance"]').fill(maxSearch);
};

const geometry: Record<string, unknown> = {};
test.afterAll(() => {
  fs.writeFileSync(`${EVIDENCE}/geometry.json`, JSON.stringify(geometry, null, 2));
});

const recordGeometry = async (page: Page, label: string): Promise<void> => {
  geometry[label] = await page.evaluate(() => {
    const box = (sel: string): Record<string, number | null> | null => {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        x: r.x, y: r.y, w: r.width, h: r.height,
        scrollW: el.scrollWidth, clientW: el.clientWidth,
        scrollH: el.scrollHeight, clientH: el.clientHeight,
      };
    };
    return {
      innerW: window.innerWidth,
      innerH: window.innerHeight,
      docScrollW: document.documentElement.scrollWidth,
      docScrollH: document.documentElement.scrollHeight,
      ribbon: box('[data-cad-ribbon]'),
      viewport: box('[data-cad-viewport]'),
      toolspace: box('[data-cad-toolspace]'),
      properties: box('[data-cad-properties]'),
      commandInput: box('[data-cad-command-input]'),
      manager: box('section[aria-label="Grading manager"]') ?? box('section[aria-label="Grading group manager"]'),
      relativeButtons: Array.from(document.querySelectorAll('[data-cad-grading-command="GRADETORELATIVEELEVATION"]'))
        .map((el) => ({ disabled: (el as HTMLButtonElement).disabled })),
    };
  });
};

const shot = async (page: Page, name: string): Promise<void> => {
  await recordGeometry(page, name);
  await page.screenshot({ path: `${EVIDENCE}/${name}.png` });
};

// ===========================================================================
// Flow A — standalone Relative Elevation, no surfaces anywhere
// ===========================================================================
for (const viewport of VIEWPORTS) {
  test(`20G Flow A standalone relative elevation @ ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    await gotoCad(page, errors);
    const seed = freshStandalone();
    const file = writeStandalone(seed);
    const tag = `${viewport.width}`;
    try {
      await openSurveyPlanDrawing(page, file);

      // Select the sloped course, then invoke the real ribbon control.
      await selectFeatureLine(page, `FL ${seed.slopeId}`);
      await homeTab(page);
      const gtre = page.locator('[data-cad-grading-command="GRADETORELATIVEELEVATION"]');
      await expect(gtre).toBeEnabled({ timeout: 10000 });
      await gtre.click();
      await expect(page.locator('[data-cad-grading-table]')).toBeVisible({ timeout: 15000 });
      // The manager opens preselected to Method = Relative Elevation.
      await expect(page.locator('[data-cad-grading-create] [data-cad-grading-field="cad-grading-method"]'))
        .toHaveValue('relative-elevation');

      // Grade -50% down, Δ -10, max search 30 (> 20 derived offset).
      await fillRelativeCreate(page, '30');
      const summary = page.locator('[data-cad-grading-create] [data-cad-grading-criterion-summary]');
      await expect(summary).toContainText('Grade -50.000% → relative elev -10.000 m · offset 20.000 m');
      await expect(page.locator('[data-cad-grading-create] [data-cad-grading-diagnosis]')).toHaveCount(0);
      await expect(page.locator('[data-cad-grading-create] [data-cad-grading-field="cad-grading-elevation"]')).toHaveCount(0);
      await shot(page, `${tag}-relative-create`);

      await page.locator('[data-cad-grading-create-submit]').click();
      await expect(page.locator('[data-cad-grading-notice]')).toContainText('Created', { timeout: 10000 });
      const row = page.locator('[data-cad-grading-row]').first();
      await expect(row).toHaveAttribute('data-cad-grading-row-method', 'relative-elevation');
      await expect(row).toContainText('Unbuilt', { timeout: 15000 });

      // Calculate exactly ONCE; observe BUILDING then CURRENT.
      await row.click();
      await expect(page.locator('[data-cad-grading-calculate]')).toBeEnabled({ timeout: 15000 });
      await page.locator('[data-cad-grading-calculate]').click();
      await expect(row).toContainText(/(Building|Current)/, { timeout: 15000 });
      await expect(row).toContainText('Current', { timeout: 60000 });

      // Manager agrees: distinct method label, constant 20 m tie, Grading Limit extract.
      await expect(row.locator('td').nth(1)).toHaveText('Relative Elevation');
      await expect(row).toContainText('20.00–20.00 m');
      await expect(page.locator('[data-cad-grading-extract]')).toContainText('Grading Limit');

      // Toolspace agrees: method, signed Δ, derived offset, no target surface.
      await toolspaceSurvey(page);
      const def = page.locator('[data-cad-toolspace] [data-cad-grading-definition]').first();
      await expect(def).toContainText('Method Relative Elevation');
      await expect(def).toContainText('Target: Relative Elevation -10.000 m relative · grade -50.000%');
      await expect(page.locator('[data-cad-toolspace] [data-cad-grading-relative-grade]').first())
        .toContainText('-50.000%');
      await expect(page.locator('[data-cad-toolspace] [data-cad-grading-relative-elevation]').first())
        .toContainText('-10.000 m relative');
      await expect(page.locator('[data-cad-toolspace] [data-cad-grading-relative-offset]').first())
        .toContainText('20.000 m');
      const result = page.locator('[data-cad-toolspace] [data-cad-grading-result]').first();
      await expect(result).toContainText('grading limit verts');

      // Properties agrees (canvas selection cleared so the grading block shows).
      await clearCanvasSelection(page);
      const props = page.locator('[data-cad-grading-properties]');
      await expect(props.locator('[data-cad-grading-properties-method]')).toHaveText('Relative Elevation');
      await expect(props.locator('[data-cad-grading-relative-elevation]')).toHaveText('-10.000 m relative');
      await expect(props.locator('[data-cad-grading-relative-offset]')).toHaveText('20.000 m');
      await expect(props).toContainText('Grading Limit vertices');

      // Inquiry agrees.
      if (!(await page.locator('[data-cad-grading-table]').isVisible())) await openGradingManager(page);
      await page.locator('[data-cad-grading-tab="inquiry"]').click();
      const report = page.locator('[data-cad-grading-inquiry-report]');
      await expect(report).toContainText('Target: Relative Elevation -10.000 m relative · grade -50.000%', { timeout: 15000 });
      await expect(report).toContainText('Tie distance: min 20.000 / max 20.000');
      await expect(report).toContainText('Grading Limit vertices');
      await report.scrollIntoViewIfNeeded();
      await page.locator('[data-cad-grading-tab="definition"]').click();
      await row.scrollIntoViewIfNeeded();
      if (tag === '1366') {
        // Properties is a separate dock: bring its Grading Limit wording into
        // view without moving the manager, so one frame carries both.
        await page.evaluate(() => {
          const host = document.querySelector('[data-cad-grading-properties]');
          const target = Array.from(host?.querySelectorAll('*') ?? [])
            .find((el) => (el.textContent ?? '').includes('Grading Limit vertices'));
          target?.scrollIntoView({ block: 'nearest' });
        });
      }
      await shot(page, `${tag}-relative-current`);
    } finally {
      fs.rmSync(file, { force: true });
    }
    expect(errors).toEqual([]);
  });
}

// ===========================================================================
// Flow B — Relative vs absolute Elevation stay distinct
// ===========================================================================
for (const viewport of VIEWPORTS) {
  test(`20G Flow B relative vs absolute @ ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    await gotoCad(page, errors);
    const seed = freshStandalone();
    const file = writeStandalone(seed);
    const tag = `${viewport.width}`;
    try {
      await openSurveyPlanDrawing(page, file);
      await selectFeatureLine(page, `FL ${seed.slopeId}`);
      await homeTab(page);
      await page.locator('[data-cad-grading-command="GRADETORELATIVEELEVATION"]').click();
      await expect(page.locator('[data-cad-grading-table]')).toBeVisible({ timeout: 15000 });

      // Relative: grade -50%, Δ -10 (constant 20 m projection, limit Z 90→92).
      await page.locator('[data-cad-grading-create] [aria-label="New grading name"]').fill('RelB');
      await fillRelativeCreate(page, '30');
      await page.locator('[data-cad-grading-create-submit]').click();
      await expect(page.locator('[data-cad-grading-notice]')).toContainText('Created', { timeout: 10000 });

      // Absolute: grade -50%, E 90 (20→24 m projection, single limit Z 90).
      const form = page.locator('[data-cad-grading-create]');
      await form.locator('[aria-label="New grading name"]').fill('AbsB');
      await form.locator('[data-cad-grading-field="cad-grading-method"]').selectOption('elevation');
      await form.locator('[aria-label="Grade magnitude"]').fill('50');
      await form.locator('[aria-label="Grade direction"]').selectOption('down');
      await form.locator('[data-cad-grading-field="cad-grading-elevation"]').fill('90');
      await form.locator('[aria-label="Max search distance"]').fill('30');
      await expect(page.locator('[data-cad-grading-create] [data-cad-grading-criterion-summary]'))
        .toContainText('Grade -50.000% → elev 90.000 m');
      await page.locator('[data-cad-grading-create-submit]').click();
      await expect(page.locator('[data-cad-grading-notice]')).toContainText('Created', { timeout: 10000 });

      const rel = gradingRowByName(page, 'RelB');
      const abs = gradingRowByName(page, 'AbsB');
      for (const target of [rel, abs]) {
        await target.click();
        await expect(page.locator('[data-cad-grading-calculate]')).toBeEnabled({ timeout: 15000 });
        await page.locator('[data-cad-grading-calculate]').click();
        await expect(target).toContainText('Current', { timeout: 60000 });
      }

      // UI keeps the two methods distinct — never both plain "Elevation".
      await expect(rel.locator('td').nth(1)).toHaveText('Relative Elevation');
      await expect(abs.locator('td').nth(1)).toHaveText('Elevation');
      await expect(rel).toContainText('20.00–20.00 m');
      await expect(abs).toContainText('20.00–24.00 m');

      // Properties label each distinctly.
      await clearCanvasSelection(page);
      await rel.click();
      await expect(page.locator('[data-cad-grading-properties-method]')).toHaveText('Relative Elevation');
      await expect(page.locator('[data-cad-grading-properties] [data-cad-grading-relative-offset]')).toHaveText('20.000 m');
      await abs.click();
      await expect(page.locator('[data-cad-grading-properties-method]')).toHaveText('Elevation');
      await expect(page.locator('[data-cad-grading-properties]')).toContainText('90.000');

      // Inquiry labels each distinctly.
      if (!(await page.locator('[data-cad-grading-table]').isVisible())) await openGradingManager(page);
      await rel.click();
      await page.locator('[data-cad-grading-tab="inquiry"]').click();
      await expect(page.locator('[data-cad-grading-inquiry-report]'))
        .toContainText('Target: Relative Elevation -10.000 m relative', { timeout: 15000 });
      await page.locator('[data-cad-grading-tab="definition"]').click();
      await abs.click();
      await page.locator('[data-cad-grading-tab="inquiry"]').click();
      await expect(page.locator('[data-cad-grading-inquiry-report]'))
        .toContainText('Target: Elevation 90.000 m', { timeout: 15000 });
      await page.locator('[data-cad-grading-tab="definition"]').click();
      await rel.scrollIntoViewIfNeeded();
      await abs.scrollIntoViewIfNeeded();
      await shot(page, `${tag}-relative-vs-absolute`);
    } finally {
      fs.rmSync(file, { force: true });
    }
    expect(errors).toEqual([]);
  });
}

// ===========================================================================
// Flow C — edit + undo/redo + save/reopen (1366)
// ===========================================================================
test('20G Flow C edit + persistence @ 1366x768', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const errors: string[] = [];
  await gotoCad(page, errors);
  const seed = freshStandalone([{
    id: nextId('grad'), name: 'DistC', sourceFeatureLineId: '',
    sourceCourse: { vertexAId: '', vertexBId: '' },
    side: 'right', criterion: { kind: 'distance', gradeRatio: -0.5, distance: 20 },
    maxSearchDistance: 50, curveChordTolerance: 0.05,
  }], true);
  // Point the seeded grading at the real sloped course.
  seed.gradings[0]!.sourceFeatureLineId = seed.slopeId;
  seed.gradings[0]!.sourceCourse = { vertexAId: `${seed.slopeId}:v0`, vertexBId: `${seed.slopeId}:v1` };
  const file = writeStandalone(seed);
  try {
    await openSurveyPlanDrawing(page, file);
    await openGradingManager(page);
    const row = gradingRowByName(page, 'DistC');
    await expect(row).toHaveAttribute('data-cad-grading-row-method', 'distance');

    // Distance -> Relative Elevation commits with no target surface.
    await row.click();
    await page.locator('[data-cad-grading-edit-criteria]').click();
    const edit = page.locator('[data-cad-grading-edit-panel]');
    await expect(edit).toBeVisible({ timeout: 10000 });
    await edit.locator('[data-cad-grading-field="cad-grading-edit-method"]').selectOption('relative-elevation');
    await edit.locator('[aria-label="Grade magnitude"]').fill('50');
    await edit.locator('[aria-label="Grade direction"]').selectOption('down');
    await edit.locator('[data-cad-grading-field="cad-grading-edit-relative-elevation"]').fill('-10');
    await expect(edit.locator('[data-cad-grading-criterion-summary]'))
      .toContainText('relative elev -10.000 m · offset 20.000 m');
    await page.locator('[data-cad-grading-edit-apply]').click();
    await expect(page.locator('[data-cad-grading-notice]')).toContainText('Criteria updated', { timeout: 10000 });
    await expect(row).toHaveAttribute('data-cad-grading-row-method', 'relative-elevation');
    await expect(row.locator('td').nth(4)).toHaveText('—');

    // One Undo restores Distance; Redo restores Relative Elevation.
    await undoOnce(page);
    await expect(row).toHaveAttribute('data-cad-grading-row-method', 'distance', { timeout: 10000 });
    await redoOnce(page);
    await expect(row).toHaveAttribute('data-cad-grading-row-method', 'relative-elevation', { timeout: 10000 });

    // Relative -> Surface with no eligible (CURRENT) target: editor stays
    // open, Apply disabled, truthful notice, zero mutation.
    await row.click();
    await page.locator('[data-cad-grading-edit-criteria]').click();
    const edit2 = page.locator('[data-cad-grading-edit-panel]');
    await expect(edit2).toBeVisible({ timeout: 10000 });
    await edit2.locator('[data-cad-grading-field="cad-grading-edit-method"]').selectOption('surface');
    await expect(page.locator('[data-cad-grading-edit-surface-blocked]'))
      .toContainText('Surface grading needs a CURRENT target surface — none is eligible.');
    await expect(page.locator('[data-cad-grading-edit-apply]')).toBeDisabled();
    await expect(edit2).toBeVisible();
    await expect(row).toHaveAttribute('data-cad-grading-row-method', 'relative-elevation');
    await page.locator('[data-cad-grading-edit-cancel]').click();

    // Save the WNCAD, reopen it: definition persists, result honestly UNBUILT.
    const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
    await page.getByRole('button', { name: 'Save Drawing' }).first().click();
    const download = await downloadPromise;
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'wn-20g-save-'));
    const savedPath = path.join(dir, 'drawing.wncad');
    await download.saveAs(savedPath);
    await openSurveyPlanDrawing(page, savedPath);
    await openGradingManager(page);
    const reopened = gradingRowByName(page, 'DistC');
    await expect(reopened).toHaveAttribute('data-cad-grading-row-method', 'relative-elevation', { timeout: 15000 });
    await expect(reopened.locator('td').nth(1)).toHaveText('Relative Elevation');
    await expect(reopened).toContainText('Unbuilt');
    await expect(reopened.locator('td').nth(9)).toHaveText('--');
    await fs.promises.rm(dir, { recursive: true, force: true });
  } finally {
    fs.rmSync(file, { force: true });
  }
  expect(errors).toEqual([]);
});

// ===========================================================================
// Flow D — group lock + override/reset + CURRENT + products + FAILED
// ===========================================================================
for (const viewport of VIEWPORTS) {
  test(`20G Flow D group + overrides @ ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    await gotoCad(page, errors);
    const squareId = nextId('fl-square');
    const file = writeGroupWorld(squareId, closedGroupOf(squareId));
    const tag = `${viewport.width}`;
    try {
      await openSurveyPlanDrawing(page, file);
      await openGroupManager(page);
      const row = groupRowByName(page, 'RelGrp');
      await expect(row).toHaveAttribute('data-cad-grading-group-row-method', 'relative-elevation');
      // Calculate is explicit: still UNBUILT until clicked.
      await expect(row).toContainText('Unbuilt', { timeout: 15000 });

      // One-family lock: locked Relative Elevation label, no cross-family options.
      await page.locator('[data-cad-grading-group-tab="criteria"]').click();
      const panel = page.locator('[data-cad-grading-group-criteria]');
      await expect(panel).toBeVisible({ timeout: 10000 });
      await expect(panel.locator('[data-cad-grading-field="cad-grading-group-criteria-method-locked"]'))
        .toContainText('Method: Relative Elevation (locked to group family)');
      await expect(panel.locator('[data-cad-grading-field="cad-grading-group-criteria-method"]')).toHaveCount(0);
      await expect(panel.locator('[data-cad-grading-field="cad-grading-group-criteria-distance"]')).toHaveCount(0);
      await expect(panel.locator('[data-cad-grading-field="cad-grading-group-criteria-elevation"]')).toHaveCount(0);

      // A valid same-family override applies, then resets.
      await panel.locator('[aria-label="Select Course 1"]').check();
      await panel.locator('[data-cad-grading-field="cad-grading-group-criteria-relative-elevation"]').fill('-12');
      await panel.locator('[data-cad-grading-group-criteria-apply-selected]').click();
      await expect(page.locator('[data-cad-grading-group-notice]')).toContainText('verrid', { timeout: 10000 });
      await expect(panel.locator('[data-cad-grading-group-criteria-row="0"]')).toContainText('Relative Elevation');
      await expect(panel.locator('[data-cad-grading-group-criteria-row="0"]')).toContainText('Override');
      await panel.locator('[data-cad-grading-group-criteria-reset="0"]').click();
      await expect(page.locator('[data-cad-grading-group-notice]')).toContainText('cleared', { timeout: 10000 });
      await expect(panel.locator('[data-cad-grading-group-criteria-default]')).toContainText('Overrides: 0', { timeout: 10000 });

      // Explicit Calculate -> CURRENT on the default (140x140 outer, 9,600 m²).
      await page.locator('[data-cad-grading-group-tab="definition"]').click();
      await row.click();
      await expect(page.locator('[data-cad-grading-group-calculate]')).toBeEnabled({ timeout: 15000 });
      await page.locator('[data-cad-grading-group-calculate]').click();
      await expect(row).toContainText('Current', { timeout: 60000 });
      await expect(row).toContainText('20.00–20.00 m');
      await expect(row).toContainText('9600.0');

      // Engine-backed Inquiry carries area + 20√2 corner extents; CSV agrees.
      await page.locator('[data-cad-grading-group-tab="inquiry"]').click();
      const report = page.locator('[data-cad-grading-group-inquiry-report]');
      await expect(report).toContainText('Target: Relative Elevation -10.000 m relative', { timeout: 15000 });
      await expect(report).toContainText('Areas: plan 9600.000');
      await expect(report).toContainText('miter 28.284 m');
      await expect(report).toContainText('Grading Limit vertices');
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
      expect(csvText).toContain('9600');
      await expect(csvText).toContain('Relative Elevation');
      await report.scrollIntoViewIfNeeded();
      if (tag === '1366') {
        // Align the group row 8px below the manager's top edge so the row,
        // its Relative Elevation method cell, the target line and the default
        // Δ / derived-offset course line share one frame (the manager section
        // is its own scroller).
        await page.evaluate(() => {
          const section = document.querySelector('section[aria-label="Grading group manager"]') as HTMLElement | null;
          const target = document.querySelector('[data-cad-grading-group-row]') as HTMLElement | null;
          if (section && target) {
            section.scrollTop += target.getBoundingClientRect().top - section.getBoundingClientRect().top - 8;
          }
        });
      }
      await shot(page, `${tag}-relative-group`);
      if (tag === '1366') {
        // Complementary frame: the group row and the Areas/corner tail cannot
        // share 768 px, so center the report body. This frame carries the
        // grading evidence — `Areas: plan 9600.000`, the four 28.284 m miters
        // and the Grading Limit vertex count; the default Δ lives in the
        // `${tag}-relative-group` frame, not here.
        await page.evaluate(() => {
          document.querySelector('[data-cad-grading-group-inquiry-report]')?.scrollIntoView({ block: 'center' });
          const section = document.querySelector('section[aria-label="Grading group manager"]') as HTMLElement | null;
          // The Areas line sits two rows above the Source-lengths line: nudge
          // up so `Areas: plan 9600.000` heads the frame.
          if (section) section.scrollTop -= 50;
        });
        await shot(page, `${tag}-relative-group-areas`);
      }

      // Extract adds exactly one entity; one Undo removes it.
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
      await toolspaceSurvey(page);
      const surfacesBefore = await surfaceNodes(page).count();
      if (!(await page.locator('[data-cad-grading-group-table]').isVisible())) await openGroupManager(page);
      await row.click();
      await expect(page.locator('[data-cad-grading-group-bake]')).toBeEnabled({ timeout: 10000 });
      await page.locator('[data-cad-grading-group-bake]').click();
      await expect.poll(() => surfaceNodes(page).count()).toBe(surfacesBefore + 1);
      await undoOnce(page);
      await expect.poll(() => surfaceNodes(page).count()).toBe(surfacesBefore);
      await expect(row).toContainText('Current');

      // ONE incompatible per-course override (differing Δ) -> FAILED, stable,
      // Extract/Bake disabled, never CURRENT.
      if (!(await page.locator('[data-cad-grading-group-table]').isVisible())) await openGroupManager(page);
      await page.locator('[data-cad-grading-group-tab="criteria"]').click();
      const panel2 = page.locator('[data-cad-grading-group-criteria]');
      await panel2.locator('[aria-label="Select Course 1"]').check();
      await panel2.locator('[data-cad-grading-field="cad-grading-group-criteria-relative-elevation"]').fill('-12');
      await panel2.locator('[data-cad-grading-group-criteria-apply-selected]').click();
      await expect(page.locator('[data-cad-grading-group-notice]')).toContainText('verrid', { timeout: 10000 });
      await page.locator('[data-cad-grading-group-tab="definition"]').click();
      await row.click();
      await expect(page.locator('[data-cad-grading-group-calculate]')).toBeEnabled({ timeout: 15000 });
      await page.locator('[data-cad-grading-group-calculate]').click();
      await expect(row).toContainText('Failed', { timeout: 60000 });
      await expect(row).toContainText(/(CORNER_NO_SOLUTION|GRADING_[A-Z_]+)/);
      await expect(row).not.toContainText('Current');
      const diagnostic = (await row.textContent()) ?? '';
      await expect(page.locator('[data-cad-grading-group-extract]')).toBeDisabled();
      await expect(page.locator('[data-cad-grading-group-bake]')).toBeDisabled();
      // Stable: a second Calculate fails with the identical diagnostic.
      await page.locator('[data-cad-grading-group-calculate]').click();
      await expect(row).toContainText('Failed', { timeout: 60000 });
      const diagnosticAfter = (await row.textContent()) ?? '';
      expect(diagnosticAfter).toBe(diagnostic);
    } finally {
      fs.rmSync(file, { force: true });
    }
    expect(errors).toEqual([]);
  });
}

// ===========================================================================
// Flow E — failure gates (1366)
// ===========================================================================
test('20G Flow E failure gates @ 1366x768', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const errors: string[] = [];
  await gotoCad(page, errors);
  const seed = freshStandalone();
  const file = writeStandalone(seed);
  try {
    await openSurveyPlanDrawing(page, file);
    await selectFeatureLine(page, `FL ${seed.slopeId}`);
    await homeTab(page);
    await page.locator('[data-cad-grading-command="GRADETORELATIVEELEVATION"]').click();
    await expect(page.locator('[data-cad-grading-table]')).toBeVisible({ timeout: 15000 });
    const form = page.locator('[data-cad-grading-create]');
    const summary = page.locator('[data-cad-grading-create] [data-cad-grading-criterion-summary]');
    const diagnosis = page.locator('[data-cad-grading-create] [data-cad-grading-diagnosis]');
    const rows = () => page.locator('[data-cad-grading-row]').count();

    // Wrong-sign draft is blocked BEFORE any mutation.
    await form.locator('[data-cad-grading-field="cad-grading-method"]').selectOption('relative-elevation');
    await form.locator('[aria-label="Grade magnitude"]').fill('50');
    await form.locator('[aria-label="Grade direction"]').selectOption('up');
    await form.locator('[data-cad-grading-field="cad-grading-relative-elevation"]').fill('-10');
    await expect(diagnosis).toHaveText(
      'Criterion: invalid — grade and relative elevation point in opposite directions');
    await expect(summary).toContainText('Criterion: invalid');
    await page.locator('[data-cad-grading-create-submit]').click();
    await expect(page.locator('[data-cad-grading-notice]')).toContainText('rejected', { timeout: 10000 });
    expect(await rows()).toBe(0);

    // Zero grade and zero relative elevation both mark the draft invalid.
    await form.locator('[aria-label="Grade direction"]').selectOption('level');
    await expect(summary).toContainText('Criterion: invalid');
    await page.locator('[data-cad-grading-create-submit]').click();
    expect(await rows()).toBe(0);
    await form.locator('[aria-label="Grade direction"]').selectOption('down');
    await form.locator('[data-cad-grading-field="cad-grading-relative-elevation"]').fill('0');
    await expect(summary).toContainText('Criterion: invalid');
    await page.locator('[data-cad-grading-create-submit]').click();
    expect(await rows()).toBe(0);

    // Over-search (valid Δ=-20, offset 40 > max 30) fails Calculate.
    await form.locator('[data-cad-grading-field="cad-grading-relative-elevation"]').fill('-20');
    await form.locator('[aria-label="Max search distance"]').fill('30');
    await expect(summary).toContainText('offset 40.000 m');
    await page.locator('[data-cad-grading-create-submit]').click();
    await expect(page.locator('[data-cad-grading-notice]')).toContainText('Created', { timeout: 10000 });
    const over = page.locator('[data-cad-grading-row]').first();
    await over.click();
    await expect(page.locator('[data-cad-grading-calculate]')).toBeEnabled({ timeout: 15000 });
    await page.locator('[data-cad-grading-calculate]').click();
    await expect(over).toContainText('Failed', { timeout: 60000 });
    await expect(over).toContainText(/(MAX_DISTANCE_REACHED|GRADING_RELATIVE_ELEVATION_BEYOND_SEARCH)/);

    // A no-surface drawing still calculates a valid Relative Elevation grading.
    await form.locator('[aria-label="New grading name"]').fill('NoSurf');
    await form.locator('[data-cad-grading-field="cad-grading-relative-elevation"]').fill('-10');
    await expect(summary).toContainText('offset 20.000 m');
    await page.locator('[data-cad-grading-create-submit]').click();
    await expect(page.locator('[data-cad-grading-notice]')).toContainText('Created', { timeout: 10000 });
    const ok = gradingRowByName(page, 'NoSurf');
    await ok.click();
    await expect(page.locator('[data-cad-grading-calculate]')).toBeEnabled({ timeout: 15000 });
    await page.locator('[data-cad-grading-calculate]').click();
    await expect(ok).toContainText('Current', { timeout: 60000 });
    await expect(surfaceNodes(page)).toHaveCount(0);
  } finally {
    fs.rmSync(file, { force: true });
  }
  expect(errors).toEqual([]);
});

// ===========================================================================
// Shell regression (per viewport)
// ===========================================================================
for (const viewport of VIEWPORTS) {
  test(`20G shell regression @ ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    await gotoCad(page, errors);
    const seed = freshStandalone();
    const file = writeStandalone(seed);
    try {
      await openSurveyPlanDrawing(page, file);
      await selectFeatureLine(page, `FL ${seed.slopeId}`);
      await homeTab(page);

      const shell = await page.evaluate(() => {
        const ribbon = document.querySelector('[data-cad-ribbon]') as HTMLElement | null;
        const groups = document.querySelector('.cad-shell-ribbon-groups') as HTMLElement | null;
        const viewportEl = document.querySelector('[data-cad-viewport]') as HTMLElement | null;
        const toolspace = document.querySelector('[data-cad-toolspace]') as HTMLElement | null;
        const cs = (el: Element | null, prop: string): string =>
          el == null ? 'missing' : getComputedStyle(el).getPropertyValue(prop);
        const gtre = document.querySelector('[data-cad-grading-command="GRADETORELATIVEELEVATION"]') as HTMLButtonElement | null;
        const bands = document.querySelectorAll('[data-cad-ribbon] .cad-shell-ribbon-groups').length;
        return {
          ribbonH: ribbon?.getBoundingClientRect().height ?? -1,
          ribbonOverflowY: cs(ribbon, 'overflow-y'),
          groupsWrap: groups ? cs(groups, 'flex-wrap') : 'missing',
          groupsOverflowX: groups ? cs(groups, 'overflow-x') : 'missing',
          bands,
          docScrollW: document.documentElement.scrollWidth,
          docScrollH: document.documentElement.scrollHeight,
          innerW: window.innerWidth,
          innerH: window.innerHeight,
          propertiesCount: document.querySelectorAll('[data-cad-properties]').length,
          commandInputCount: document.querySelectorAll('[data-cad-command-input]').length,
          toolspaceVisible: toolspace != null && toolspace.getBoundingClientRect().width > 0,
          gtreVisible: gtre != null && gtre.getBoundingClientRect().width > 0,
          gtreEnabled: gtre != null && !gtre.disabled,
          viewportH: viewportEl?.getBoundingClientRect().height ?? -1,
          modelPresent: viewportEl?.querySelector('svg') != null || viewportEl?.querySelector('canvas') != null,
        };
      });
      console.log(`20G SHELL ${viewport.width}: ` + JSON.stringify(shell));
      expect(shell.ribbonH).toBeLessThanOrEqual(130);
      expect(shell.bands).toBe(1);
      expect(shell.groupsWrap).toBe('nowrap');
      expect(['auto', 'scroll']).toContain(shell.groupsOverflowX);
      expect(shell.propertiesCount).toBe(1);
      expect(shell.commandInputCount).toBe(1);
      expect(shell.docScrollH).toBeLessThanOrEqual(shell.innerH + 1);
      expect(shell.docScrollW).toBeLessThanOrEqual(shell.innerW + 1);
      expect(shell.toolspaceVisible).toBe(true);
      expect(shell.gtreVisible).toBe(true);
      expect(shell.gtreEnabled).toBe(true);
      expect(shell.viewportH).toBeGreaterThan(300);
      expect(shell.modelPresent).toBe(true);

      // Manager contained in the viewport while open on the relative form.
      await page.locator('[data-cad-grading-command="GRADETORELATIVEELEVATION"]').click();
      await expect(page.locator('[data-cad-grading-table]')).toBeVisible({ timeout: 15000 });
      const mgr = await page.evaluate(() => {
        const el = document.querySelector('section[aria-label="Grading manager"]') as HTMLElement | null;
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { right: r.right, bottom: r.bottom, innerW: window.innerWidth, innerH: window.innerHeight };
      });
      expect(mgr).not.toBeNull();
      expect(mgr!.right).toBeLessThanOrEqual(mgr!.innerW + 1);
      expect(mgr!.bottom).toBeLessThanOrEqual(mgr!.innerH + 1);
      await recordGeometry(page, `${viewport.width}-shell`);

      // Flyout opens unclipped (observer armed before the click).
      await page.evaluate(() => {
        (window as unknown as Record<string, unknown>).__flyoutBox = null;
        const take = (): void => {
          const w = window as unknown as Record<string, unknown>;
          if (w.__flyoutBox != null) return;
          const el = document.querySelector('[data-cad-ribbon-flyout="arc"]');
          if (el == null) return;
          const box = el.getBoundingClientRect();
          if (box.width === 0 && box.height === 0) return;
          w.__flyoutBox = { x: box.x, y: box.y, width: box.width, height: box.height };
        };
        new MutationObserver(take).observe(document.body, { childList: true, subtree: true });
        take();
      });
      await page.locator('[data-cad-family-caret="arc"]').click({ force: true, timeout: 10000 });
      await expect.poll(
        async () => page.evaluate(() => (window as unknown as Record<string, unknown>).__flyoutBox != null),
        { timeout: 10000 },
      ).toBe(true);
      const flyout = await page.evaluate(() => ({
        box: (window as unknown as Record<string, { x: number; y: number; width: number; height: number } | null>).__flyoutBox!,
        innerW: window.innerWidth,
        innerH: window.innerHeight,
      }));
      expect(flyout.box.x).toBeGreaterThanOrEqual(-0.5);
      expect(flyout.box.y).toBeGreaterThanOrEqual(-0.5);
      expect(flyout.box.x + flyout.box.width).toBeLessThanOrEqual(flyout.innerW + 0.5);
      expect(flyout.box.y + flyout.box.height).toBeLessThanOrEqual(flyout.innerH + 0.5);
      await page.keyboard.press('Escape');
    } finally {
      fs.rmSync(file, { force: true });
    }
    expect(errors).toEqual([]);
  });
}
