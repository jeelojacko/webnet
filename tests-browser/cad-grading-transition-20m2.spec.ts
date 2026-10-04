/**
 * Phase 20M.2 WAVE I browser QA — collinear transition production flows
 * through the REAL /cad shell in headless Chromium. No mocks: every flow
 * opens a seeded .wncad and drives the live group manager (real worker
 * calculate), pinning zero page/console errors.
 *
 * Predicate per flow (OPEN line-only one-transition trp1, same family,
 * exact gL===gR, collinear 0, explicit W, TRANSITION_LINEAR_V1, fail
 * closed). Screenshots + geometry.json land under docs/evidence/phase20m2/.
 *
 * Flows: A Distance valid; B RelativeElevation valid; C flat Elevation
 * valid; D width exact max valid; E width too large fail closed;
 * F non-collinear rejected; G second transition rejected;
 * H save/reopen persists; I edit invalidates old result;
 * J Extract/Bake truthful + Design Patch unavailable.
 */
import { expect, test, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  createBlankCadDrawingDocument,
  serializeCadDrawingFile,
} from '../src/engine/cad/cadDrawingFile';
import type { CadFeatureLineEntity, CadProject } from '../src/engine/cad/cadTypes';
import type { CadGradingGroup } from '../src/engine/cad/grading/gradingGroupTypes';
import type { GradingCriterion } from '../src/engine/cad/grading/gradingTypes';
import {
  entityCount,
  gotoCad,
  homeTab,
  openSurveyPlanDrawing,
} from './cad-survey-plan-19a-helpers';

const EVIDENCE = path.resolve(process.cwd(), 'docs/evidence/phase20m2');
fs.mkdirSync(EVIDENCE, { recursive: true });

let seq = 0;
const nextId = (p: string): string => `${p}-20m2-${++seq}`;

const fl = (id: string, pts: Array<[number, number, number]>): CadFeatureLineEntity => ({
  id, type: 'feature-line', layerId: 'general', visible: true, locked: false, name: `FL ${id}`,
  vertices: pts.map(([x, y, z], i) => ({ id: `${id}:v${i}`, x, y, z })),
});

const DIST = (g: number, d: number): GradingCriterion => ({ kind: 'distance', gradeRatio: g, distance: d });
const REL = (g: number, dz: number): GradingCriterion => ({
  kind: 'relative-elevation', gradeRatio: g, relativeElevation: dz,
});
const ELEV = (g: number, e: number): GradingCriterion => ({
  kind: 'elevation', gradeRatio: g, targetElevation: e,
});

const STRAIGHT: Array<[number, number, number]> = [[-20, 0, 10], [0, 0, 10], [20, 0, 10]];
const BENT: Array<[number, number, number]> = [[-20, 0, 10], [0, 0, 10], [0, 20, 10]];
const THREE: Array<[number, number, number]> = [[-20, 0, 10], [0, 0, 10], [20, 0, 10], [40, 0, 10]];

const V = (line: string, i: number): string => `${line}:v${i}`;
const KEY = (line: string, a: number, b: number): string => `${V(line, a)}>${V(line, b)}`;

const intentOf = (line: string, a: number, b: number, width: number, family: string) => ({
  policyVersion: 'trp1',
  jointId: 'joint:0',
  memberIds: [KEY(line, a, a + 1), KEY(line, a + 1, b)],
  width,
  lawKind: 'TRANSITION_LINEAR_V1',
  lawVersion: 'v1',
  criterionFamily: family,
  side: 'left',
});

interface GroupSeed {
  name: string;
  line: string;
  courses: Array<[number, number]>;
  criterion: GradingCriterion;
  overrides?: Array<{ course: [number, number]; criterion: GradingCriterion }>;
  transition?: ReturnType<typeof intentOf>;
  maxSearchDistance?: number;
}

const groupOf = (seed: GroupSeed): CadGradingGroup => ({
  id: nextId('grp'),
  name: seed.name,
  sourceFeatureLineId: seed.line,
  sourceCourses: seed.courses.map(([a, b]) => ({ vertexAId: V(seed.line, a), vertexBId: V(seed.line, b) })),
  side: 'left',
  criterion: seed.criterion,
  ...(seed.overrides !== undefined
    ? {
        courseCriteria: seed.overrides.map((o) => ({
          sourceCourse: { vertexAId: V(seed.line, o.course[0]), vertexBId: V(seed.line, o.course[1]) },
          criterion: o.criterion,
        })),
      }
    : {}),
  maxSearchDistance: seed.maxSearchDistance ?? 50,
  curveChordTolerance: 0.01,
  cornerMode: 'miter',
  ...(seed.transition !== undefined ? { transitions: [seed.transition] } : {}),
} as CadGradingGroup);

const writeWorld = (lines: Record<string, Array<[number, number, number]>>, groups: GroupSeed[]): string => {
  const project: CadProject = {
    ...createBlankCadDrawingDocument({ name: '20M.2 transition QA', units: 'm' }).project,
    entities: Object.entries(lines).map(([id, pts]) => fl(id, pts)),
    surfaces: [],
    gradingGroups: groups.map(groupOf),
  };
  const file = path.join(os.tmpdir(), `wn-20m2-${Date.now()}-${Math.floor(Math.random() * 1e6)}.wncad`);
  fs.writeFileSync(file, serializeCadDrawingFile({ ...createBlankCadDrawingDocument({ name: 'q', units: 'm' }), project }), 'utf8');
  return file;
};

const stdGroups = (line: string): GroupSeed[] => [
  {
    name: 'Tdist', line, courses: [[0, 1], [1, 2]], criterion: DIST(0.5, 5),
    overrides: [{ course: [1, 2], criterion: DIST(0.5, 7) }],
    transition: intentOf(line, 0, 2, 8, 'distance'),
  },
  {
    name: 'Trel', line, courses: [[0, 1], [1, 2]], criterion: REL(0.5, 2),
    overrides: [{ course: [1, 2], criterion: REL(0.5, 4) }],
    transition: intentOf(line, 0, 2, 8, 'relative-elevation'),
  },
  {
    name: 'Telev', line, courses: [[0, 1], [1, 2]], criterion: ELEV(0.5, 12),
    overrides: [{ course: [1, 2], criterion: ELEV(0.5, 14) }],
    transition: intentOf(line, 0, 2, 8, 'elevation'),
  },
  {
    name: 'Tmax', line, courses: [[0, 1], [1, 2]], criterion: DIST(0.5, 5),
    overrides: [{ course: [1, 2], criterion: DIST(0.5, 7) }],
    transition: intentOf(line, 0, 2, 40, 'distance'),
  },
  {
    name: 'Twide', line, courses: [[0, 1], [1, 2]], criterion: DIST(0.5, 5),
    overrides: [{ course: [1, 2], criterion: DIST(0.5, 7) }],
    transition: intentOf(line, 0, 2, 41, 'distance'),
  },
];

// ---------------------------------------------------------------------------
// UI helpers (cad-grading-* pattern)
// ---------------------------------------------------------------------------

const openGroupManager = async (page: Page): Promise<void> => {
  await homeTab(page);
  await page.locator('[data-cad-grading-group-command="GRADINGGROUP"]').click();
  await expect(page.locator('[data-cad-grading-group-table]')).toBeVisible({ timeout: 15000 });
};

const groupRowByName = (page: Page, name: string) =>
  page.locator('[data-cad-grading-group-row]', { hasText: name }).first();

const calculateSelected = async (page: Page, name: string): Promise<void> => {
  const row = groupRowByName(page, name);
  await row.click();
  await expect(page.locator('[data-cad-grading-group-calculate]')).toBeEnabled({ timeout: 15000 });
  await page.locator('[data-cad-grading-group-calculate]').click();
};

const openTransitionTab = async (page: Page, name: string): Promise<void> => {
  await groupRowByName(page, name).click();
  await page.locator('[data-cad-grading-group-tab="transition"]').click();
  await expect(page.locator('[data-cad-grading-group-transition-panel]')).toBeVisible({ timeout: 10000 });
};

const surfaceNodes = (page: Page) => page.locator('[data-cad-toolspace] [data-cad-surface]');

const toolspaceSurvey = async (page: Page): Promise<void> => {
  await page.locator('[aria-label="Toolspace tabs"]').getByRole('tab', { name: 'Survey' }).click();
};

const geometry: Record<string, unknown> = {};
test.afterAll(() => {
  fs.writeFileSync(`${EVIDENCE}/geometry.json`, JSON.stringify(geometry, null, 2));
});

const shot = async (page: Page, name: string): Promise<void> => {
  geometry[name] = await page.evaluate(() => {
    const box = (sel: string) => {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    };
    return {
      innerW: window.innerWidth, innerH: window.innerHeight,
      manager: box('section[aria-label="Grading group manager"]'),
      viewport: box('[data-cad-viewport]'),
    };
  });
  await page.screenshot({ path: `${EVIDENCE}/${name}.png` });
};

// ===========================================================================
// Flows A–C — admitted families go CURRENT through the real worker
// ===========================================================================
for (const [flow, name] of [['a-distance', 'Tdist'], ['b-relative', 'Trel'], ['c-elevation', 'Telev']] as const) {
  test(`20M2 Flow ${flow} admitted transition CURRENT`, async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    const errors: string[] = [];
    await gotoCad(page, errors);
    const line = nextId('flt');
    const file = writeWorld({ [line]: STRAIGHT }, stdGroups(line));
    try {
      await openSurveyPlanDrawing(page, file);
      await openGroupManager(page);
      const row = groupRowByName(page, name);
      await expect(row).toContainText('Unbuilt', { timeout: 15000 });
      await calculateSelected(page, name);
      await expect(row).toContainText('Current', { timeout: 60000 });
      await expect(row).not.toContainText('Failed');
      await shot(page, `${flow}-current`);
    } finally {
      fs.rmSync(file, { force: true });
    }
    expect(errors).toEqual([]);
  });
}

// ===========================================================================
// Flow D — width exactly 2xmin is feasible (valid)
// ===========================================================================
test('20M2 Flow d-exact-max width 40 CURRENT', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const errors: string[] = [];
  await gotoCad(page, errors);
  const line = nextId('flt');
  const file = writeWorld({ [line]: STRAIGHT }, stdGroups(line));
  try {
    await openSurveyPlanDrawing(page, file);
    await openGroupManager(page);
    await calculateSelected(page, 'Tmax');
    await expect(groupRowByName(page, 'Tmax')).toContainText('Current', { timeout: 60000 });
    await shot(page, 'd-exact-max-current');
  } finally {
    fs.rmSync(file, { force: true });
  }
  expect(errors).toEqual([]);
});

// ===========================================================================
// Flow E — width 41 (> 2xmin) fails closed, never CURRENT
// ===========================================================================
test('20M2 Flow e-too-wide fail closed', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const errors: string[] = [];
  await gotoCad(page, errors);
  const line = nextId('flt');
  const file = writeWorld({ [line]: STRAIGHT }, stdGroups(line));
  try {
    await openSurveyPlanDrawing(page, file);
    await openGroupManager(page);
    await calculateSelected(page, 'Twide');
    const row = groupRowByName(page, 'Twide');
    await expect(row).toContainText('Failed', { timeout: 60000 });
    await expect(row).not.toContainText('Current');
    await expect(page.locator('[data-cad-grading-group-notice]')).toContainText('Calculate failed', { timeout: 10000 });
    await expect(page.locator('[data-cad-grading-group-extract]')).toBeDisabled();
    await expect(page.locator('[data-cad-grading-group-bake]')).toBeDisabled();
    await shot(page, 'e-too-wide-failed');
  } finally {
    fs.rmSync(file, { force: true });
  }
  expect(errors).toEqual([]);
});

// ===========================================================================
// Flow F — non-collinear joint rejects the persisted intent
// ===========================================================================
test('20M2 Flow f-noncollinear rejected', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const errors: string[] = [];
  await gotoCad(page, errors);
  const line = nextId('flb');
  const file = writeWorld({ [line]: BENT }, [{
    name: 'Tbent', line, courses: [[0, 1], [1, 2]], criterion: DIST(0.5, 5),
    overrides: [{ course: [1, 2], criterion: DIST(0.5, 7) }],
    transition: intentOf(line, 0, 2, 8, 'distance'),
  }]);
  try {
    await openSurveyPlanDrawing(page, file);
    await openGroupManager(page);
    await calculateSelected(page, 'Tbent');
    const row = groupRowByName(page, 'Tbent');
    await expect(row).toContainText('Failed', { timeout: 60000 });
    await expect(row).not.toContainText('Current');
    await shot(page, 'f-noncollinear-failed');
  } finally {
    fs.rmSync(file, { force: true });
  }
  expect(errors).toEqual([]);
});

// ===========================================================================
// Flow G — one staged transition still solves CURRENT. (20N.1 supersedes the old
// 20M.2 "Add is gone" pin: per-joint authoring keeps Add/Update visible.)
// ===========================================================================
test('20M2 Flow g-single-transition', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const errors: string[] = [];
  await gotoCad(page, errors);
  const line = nextId('fl3');
  const file = writeWorld({ [line]: THREE }, [{
    name: 'T3', line, courses: [[0, 1], [1, 2], [2, 3]], criterion: DIST(0.5, 5),
    overrides: [
      { course: [1, 2], criterion: DIST(0.5, 7) },
      { course: [2, 3], criterion: DIST(0.5, 7) },
    ],
    transition: intentOf(line, 0, 2, 8, 'distance'),
  }]);
  try {
    await openSurveyPlanDrawing(page, file);
    await openGroupManager(page);
    await openTransitionTab(page, 'T3');
    const panel = page.locator('[data-cad-grading-group-transition-panel]');
    await expect(panel).toContainText('joint:0');
    await expect(panel.locator('[data-cad-grading-group-transition-remove]')).toBeVisible();
    // 20N.1 intentionally supersedes the 20M.2 single-transition pin: per-joint
    // authoring keeps Add/Update visible so further strictly-separated transitions
    // can be staged; a staged joint offers "Update transition".
    await expect(panel.locator('[data-cad-grading-group-transition-add]')).toContainText('Update');
    // The single staged transition still solves CURRENT (joint:0 fills).
    await page.locator('[data-cad-grading-group-tab="definition"]').click();
    await calculateSelected(page, 'T3');
    await expect(groupRowByName(page, 'T3')).toContainText('Current', { timeout: 60000 });
    await shot(page, 'g-single-transition');
  } finally {
    fs.rmSync(file, { force: true });
  }
  expect(errors).toEqual([]);
});

// ===========================================================================
// Flow H — save/reopen persists the staged transition intent
// ===========================================================================
test('20M2 Flow h-save-reopen persists', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const errors: string[] = [];
  await gotoCad(page, errors);
  const line = nextId('flt');
  const file = writeWorld({ [line]: STRAIGHT }, stdGroups(line));
  try {
    await openSurveyPlanDrawing(page, file);
    await openGroupManager(page);
    await calculateSelected(page, 'Tdist');
    await expect(groupRowByName(page, 'Tdist')).toContainText('Current', { timeout: 60000 });
    const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
    await page.getByRole('button', { name: 'Save Drawing' }).first().click();
    const download = await downloadPromise;
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'wn-20m2-save-'));
    const savedPath = path.join(dir, 'drawing.wncad');
    await download.saveAs(savedPath);
    await openSurveyPlanDrawing(page, savedPath);
    await openGroupManager(page);
    // The intent survives the round trip: Transition tab still stages it.
    await openTransitionTab(page, 'Tdist');
    const panel = page.locator('[data-cad-grading-group-transition-panel]');
    await expect(panel).toContainText('joint:0');
    await expect(panel).toContainText('8 m');
    await page.locator('[data-cad-grading-group-tab="definition"]').click();
    await calculateSelected(page, 'Tdist');
    await expect(groupRowByName(page, 'Tdist')).toContainText('Current', { timeout: 60000 });
    await shot(page, 'h-save-reopen-current');
    await fs.promises.rm(dir, { recursive: true, force: true });
  } finally {
    fs.rmSync(file, { force: true });
  }
  expect(errors).toEqual([]);
});

// ===========================================================================
// Flow I — width/member-criterion edits invalidate the old result
// ===========================================================================
test('20M2 Flow i-edit-invalidates', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const errors: string[] = [];
  await gotoCad(page, errors);
  const line = nextId('flt');
  const file = writeWorld({ [line]: STRAIGHT }, stdGroups(line).slice(0, 1));
  try {
    await openSurveyPlanDrawing(page, file);
    await openGroupManager(page);
    await calculateSelected(page, 'Tdist');
    await expect(groupRowByName(page, 'Tdist')).toContainText('Current', { timeout: 60000 });

    // Removal restores the legacy gap: the offset step (5 vs 7) has no
    // native corner, so recalculate fails closed with CORNER_NO_SOLUTION.
    await openTransitionTab(page, 'Tdist');
    await page.locator('[data-cad-grading-group-transition-remove]').click();
    await expect(page.locator('[data-cad-grading-group-notice]')).toContainText('removed', { timeout: 10000 });
    await page.locator('[data-cad-grading-group-tab="definition"]').click();
    await calculateSelected(page, 'Tdist');
    await expect(groupRowByName(page, 'Tdist')).toContainText('Failed', { timeout: 60000 });
    await expect(groupRowByName(page, 'Tdist')).toContainText(/CORNER_NO_SOLUTION/);
    await shot(page, 'i-removal-restores-gap');

    // Re-add with a narrower explicit width: staged, then CURRENT again.
    await openTransitionTab(page, 'Tdist');
    await page.locator('[aria-label="Transition width"]').fill('4');
    await page.locator('[data-cad-grading-group-transition-add]').click();
    await expect(page.locator('[data-cad-grading-group-notice]')).toContainText('staged', { timeout: 10000 });
    await page.locator('[data-cad-grading-group-tab="definition"]').click();
    await calculateSelected(page, 'Tdist');
    await expect(groupRowByName(page, 'Tdist')).toContainText('Current', { timeout: 60000 });

    // Member-criterion edit (grade 50% -> 75% on course 2) breaks exact
    // gL===gR: recalculate fails closed instead of reusing the old result.
    await page.locator('[data-cad-grading-group-tab="criteria"]').click();
    const panel = page.locator('[data-cad-grading-group-criteria]');
    await panel.locator('[aria-label="Select Course 2"]').check();
    await panel.locator('[aria-label="Grade magnitude"]').fill('75');
    await panel.locator('[data-cad-grading-group-criteria-apply-selected]').click();
    await expect(page.locator('[data-cad-grading-group-notice]')).toContainText('verrid', { timeout: 10000 });
    await page.locator('[data-cad-grading-group-tab="definition"]').click();
    await calculateSelected(page, 'Tdist');
    const row = groupRowByName(page, 'Tdist');
    await expect(row).toContainText('Failed', { timeout: 60000 });
    await expect(row).not.toContainText('Current');
    await shot(page, 'i-criterion-edit-failed');

    // Reset restores the admitted pair: CURRENT again.
    await page.locator('[data-cad-grading-group-tab="criteria"]').click();
    await panel.locator('[data-cad-grading-group-criteria-reset="1"]').click();
    await page.locator('[data-cad-grading-group-tab="definition"]').click();
    await calculateSelected(page, 'Tdist');
    await expect(groupRowByName(page, 'Tdist')).toContainText('Current', { timeout: 60000 });
    await shot(page, 'i-reset-current');
  } finally {
    fs.rmSync(file, { force: true });
  }
  expect(errors).toEqual([]);
});

// ===========================================================================
// Flow J — Extract/Bake ride the CURRENT result; Design Patch stays off
// ===========================================================================
test('20M2 Flow j-products truthful patch off', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const errors: string[] = [];
  await gotoCad(page, errors);
  const line = nextId('flt');
  const file = writeWorld({ [line]: STRAIGHT }, stdGroups(line).slice(0, 1));
  try {
    await openSurveyPlanDrawing(page, file);
    await openGroupManager(page);
    const row = groupRowByName(page, 'Tdist');
    await row.click();
    // Before calculate: products are unavailable, never silently built.
    await expect(page.locator('[data-cad-grading-group-extract]')).toBeDisabled();
    await expect(page.locator('[data-cad-grading-group-bake]')).toBeDisabled();
    await calculateSelected(page, 'Tdist');
    await expect(row).toContainText('Current', { timeout: 60000 });

    // Extract adds exactly one entity; one Undo removes it.
    const entitiesBefore = await entityCount(page);
    await expect(page.locator('[data-cad-grading-group-extract]')).toBeEnabled({ timeout: 10000 });
    await page.locator('[data-cad-grading-group-extract]').click();
    await expect.poll(() => entityCount(page)).toBe(entitiesBefore + 1);
    await homeTab(page);
    await page.locator('[data-cad-command="SHELL_UNDO"]').click();
    await expect.poll(() => entityCount(page)).toBe(entitiesBefore);

    // Bake adds exactly one surface; one Undo removes it.
    await openGroupManager(page);
    await row.click();
    await toolspaceSurvey(page);
    const surfacesBefore = await surfaceNodes(page).count();
    if (!(await page.locator('[data-cad-grading-group-table]').isVisible())) await openGroupManager(page);
    await row.click();
    await expect(page.locator('[data-cad-grading-group-bake]')).toBeEnabled({ timeout: 10000 });
    await page.locator('[data-cad-grading-group-bake]').click();
    await expect.poll(() => surfaceNodes(page).count()).toBe(surfacesBefore + 1);
    await homeTab(page);
    await page.locator('[data-cad-command="SHELL_UNDO"]').click();
    await expect.poll(() => surfaceNodes(page).count()).toBe(surfacesBefore);
    await expect(row).toContainText('Current');
    await shot(page, 'j-products');

    // Design Patch stays unavailable for the open transition route.
    await homeTab(page);
    await page.getByRole('tab', { name: 'Surface' }).click();
    await page.getByRole('button', { name: 'Add Points' }).first().click();
    const workflow = page.locator('section[aria-label="Design workflow"]');
    await expect(workflow).toBeVisible({ timeout: 15000 });
    const groupSelect = workflow.locator('[aria-label="Grading group"]');
    const optionLabels = await groupSelect.locator('option').allTextContents();
    const targetLabel = optionLabels.find((text) => text.includes('Tdist'));
    expect(targetLabel).toBeDefined();
    await groupSelect.selectOption({ label: targetLabel! });
    await expect(workflow.getByRole('button', { name: 'Build Design Patch' })).toBeDisabled();
    await shot(page, 'j-patch-off');
  } finally {
    fs.rmSync(file, { force: true });
  }
  expect(errors).toEqual([]);
});
