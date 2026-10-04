/**
 * Phase 20N.1 WAVE I browser QA — multiple strictly-separated collinear
 * transitions through the REAL /cad shell in headless Chromium.
 *
 * Rule: primary flows stage transitions through the live Transition tab
 * (real GROUP_SET_TRANSITION / GROUP_CLEAR_TRANSITION commits + real worker
 * calculate). Seeded-file intents are used ONLY for the touching-compute
 * fail-closed control (G2), the bent-joint control (H), and the legacy
 * single (K). Screenshots + geometry.json land under docs/evidence/phase20n1/.
 *
 * Flows: A 2T distance; B 3T distance; C relative-elevation 2T; D flat
 * elevation 2T; E save/reopen; F edit/invalidation + single removal;
 * G touching/overlap; H bent-joint control; I extract/bake + patch off;
 * J undo/redo; K legacy single.
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

const EVIDENCE = path.resolve(process.cwd(), 'docs/evidence/phase20n1');
fs.mkdirSync(EVIDENCE, { recursive: true });

let seq = 100;
const nextId = (p: string): string => `${p}-20n1-${++seq}`;

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

// Member length 30 throughout: half-width sums stay strictly below 30.
const LINE3: Array<[number, number, number]> = [[-30, 0, 10], [0, 0, 10], [30, 0, 10], [60, 0, 10]];
const LINE4: Array<[number, number, number]> = [...LINE3, [90, 0, 10]];
const BENT: Array<[number, number, number]> = [[-30, 0, 10], [0, 0, 10], [30, 0, 10], [30, 30, 10]];

const V = (line: string, i: number): string => `${line}:v${i}`;

interface SeedTransition { joint: number; width: number }
interface GroupSeed {
  name: string;
  line: string;
  courses: Array<[number, number]>;
  criteria: GradingCriterion[];
  transitions?: SeedTransition[];
  maxSearchDistance?: number;
}

const groupOf = (seed: GroupSeed): CadGradingGroup => {
  const base = seed.criteria[0]!;
  const overrides = seed.criteria.slice(1).map((criterion, k) => ({
    sourceCourse: { vertexAId: V(seed.line, k + 1), vertexBId: V(seed.line, k + 2) },
    criterion,
  }));
  return {
    id: nextId('grp'),
    name: seed.name,
    sourceFeatureLineId: seed.line,
    sourceCourses: seed.courses.map(([a, b]) => ({ vertexAId: V(seed.line, a), vertexBId: V(seed.line, b) })),
    side: 'left',
    criterion: base,
    ...(overrides.length > 0 ? { courseCriteria: overrides } : {}),
    maxSearchDistance: seed.maxSearchDistance !== undefined ? seed.maxSearchDistance : 50,
    curveChordTolerance: 0.01,
    cornerMode: 'miter',
    ...(seed.transitions !== undefined ? {
      transitions: seed.transitions.map((t) => ({
        policyVersion: 'trp1',
        jointId: `joint:${t.joint}`,
        memberIds: [`${V(seed.line, t.joint)}>${V(seed.line, t.joint + 1)}`, `${V(seed.line, t.joint + 1)}>${V(seed.line, t.joint + 2)}`],
        width: t.width,
        lawKind: 'TRANSITION_LINEAR_V1',
        lawVersion: 'v1',
        criterionFamily: base.kind,
        side: 'left',
      })),
    } : {}),
  } as CadGradingGroup;
};

const writeWorld = (lines: Record<string, Array<[number, number, number]>>, groups: GroupSeed[]): string => {
  const project: CadProject = {
    ...createBlankCadDrawingDocument({ name: '20N.1 multi-transition QA', units: 'm' }).project,
    entities: Object.entries(lines).map(([id, pts]) => fl(id, pts)),
    surfaces: [],
    gradingGroups: groups.map(groupOf),
  };
  const file = path.join(os.tmpdir(), `wn-20n1-${Date.now()}-${Math.floor(Math.random() * 1e6)}.wncad`);
  fs.writeFileSync(file, serializeCadDrawingFile({ ...createBlankCadDrawingDocument({ name: 'q', units: 'm' }), project }), 'utf8');
  return file;
};

// ---------------------------------------------------------------------------
// UI helpers
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

const gotoDefinitionTab = async (page: Page): Promise<void> => {
  await page.locator('[data-cad-grading-group-tab="definition"]').click();
};

/** Stage one transition through the real authoring panel; asserts staged. */
const stageTransition = async (page: Page, name: string, joint: number, width: number): Promise<void> => {
  await openTransitionTab(page, name);
  const panel = page.locator('[data-cad-grading-group-transition-panel]');
  await panel.locator('[aria-label="Transition joint"]').selectOption(String(joint));
  await panel.locator('[aria-label="Transition width"]').fill(String(width));
  await panel.locator('[data-cad-grading-group-transition-add]').click();
  await expect(page.locator('[data-cad-grading-group-notice]')).toContainText(/stag|updat/i, { timeout: 10000 });
  await gotoDefinitionTab(page);
};

const transitionRows = (page: Page) =>
  page.locator('[data-cad-grading-group-transition-panel] [data-cad-grading-group-transition-list] > li');

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

const withWorld = async (
  page: Page, errors: string[],
  lines: Record<string, Array<[number, number, number]>>, groups: GroupSeed[],
  run: () => Promise<void>,
): Promise<void> => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await gotoCad(page, errors);
  const ids = Object.keys(lines);
  void ids;
  const file = writeWorld(lines, groups);
  try {
    await openSurveyPlanDrawing(page, file);
    await openGroupManager(page);
    await run();
  } finally {
    fs.rmSync(file, { force: true });
  }
  expect(errors).toEqual([]);
};

// ===========================================================================
// Flow A — two transitions / distance, unequal widths, both via UI
// ===========================================================================
test('20N1 Flow A two-transition distance CURRENT', async ({ page }) => {
  const errors: string[] = [];
  const line = nextId('fl');
  await withWorld(page, errors, { [line]: LINE3 }, [{
    name: 'A2T', line, courses: [[0, 1], [1, 2], [2, 3]],
    criteria: [DIST(0.5, 5), DIST(0.5, 7), DIST(0.5, 9)],
  }], async () => {
    await stageTransition(page, 'A2T', 0, 8);
    await stageTransition(page, 'A2T', 1, 12);
    await openTransitionTab(page, 'A2T');
    await expect(transitionRows(page)).toHaveCount(2);
    await expect(transitionRows(page).nth(0)).toContainText('joint:0');
    await expect(transitionRows(page).nth(1)).toContainText('joint:1');
    await gotoDefinitionTab(page);
    await calculateSelected(page, 'A2T');
    const row = groupRowByName(page, 'A2T');
    await expect(row).toContainText('Current', { timeout: 60000 });
    await expect(row).not.toContainText('Failed');
    await shot(page, 'a-two-transition-current');
  });
});

// ===========================================================================
// Flow B — three transitions / distance on a 4-member group
// ===========================================================================
test('20N1 Flow B three-transition distance CURRENT', async ({ page }) => {
  const errors: string[] = [];
  const line = nextId('fl');
  await withWorld(page, errors, { [line]: LINE4 }, [{
    name: 'B3T', line, courses: [[0, 1], [1, 2], [2, 3], [3, 4]],
    criteria: [DIST(0.5, 5), DIST(0.5, 7), DIST(0.5, 9), DIST(0.5, 11)],
  }], async () => {
    await stageTransition(page, 'B3T', 0, 8);
    await stageTransition(page, 'B3T', 1, 10);
    await stageTransition(page, 'B3T', 2, 8);
    await openTransitionTab(page, 'B3T');
    await expect(transitionRows(page)).toHaveCount(3);
    await gotoDefinitionTab(page);
    await calculateSelected(page, 'B3T');
    const row = groupRowByName(page, 'B3T');
    await expect(row).toContainText('Current', { timeout: 90000 });
    await expect(row).not.toContainText('Failed');
    await shot(page, 'b-three-transition-current');
  });
});

// ===========================================================================
// Flow C — relative-elevation 2T real UI flow CURRENT
// ===========================================================================
test('20N1 Flow C relative-elevation 2T CURRENT', async ({ page }) => {
  const errors: string[] = [];
  const line = nextId('fl');
  await withWorld(page, errors, { [line]: LINE3 }, [{
    name: 'C2T', line, courses: [[0, 1], [1, 2], [2, 3]],
    criteria: [REL(0.5, 2), REL(0.5, 4), REL(0.5, 6)],
  }], async () => {
    await stageTransition(page, 'C2T', 0, 8);
    await stageTransition(page, 'C2T', 1, 12);
    await calculateSelected(page, 'C2T');
    const row = groupRowByName(page, 'C2T');
    await expect(row).toContainText('Current', { timeout: 60000 });
    await expect(row).not.toContainText('Failed');
    await shot(page, 'c-relative-2t-current');
  });
});

// ===========================================================================
// Flow D — flat elevation 2T real UI flow CURRENT
// ===========================================================================
test('20N1 Flow D flat-elevation 2T CURRENT', async ({ page }) => {
  const errors: string[] = [];
  const line = nextId('fl');
  await withWorld(page, errors, { [line]: LINE3 }, [{
    name: 'D2T', line, courses: [[0, 1], [1, 2], [2, 3]],
    criteria: [ELEV(0.5, 12), ELEV(0.5, 14), ELEV(0.5, 16)],
  }], async () => {
    await stageTransition(page, 'D2T', 0, 8);
    await stageTransition(page, 'D2T', 1, 12);
    await calculateSelected(page, 'D2T');
    const row = groupRowByName(page, 'D2T');
    await expect(row).toContainText('Current', { timeout: 60000 });
    await expect(row).not.toContainText('Failed');
    await shot(page, 'd-flat-elevation-2t-current');
  });
});

// ===========================================================================
// Flow E — save/reopen preserves both transitions in canonical order
// ===========================================================================
test('20N1 Flow E save-reopen preserves 2T', async ({ page }) => {
  const errors: string[] = [];
  const line = nextId('fl');
  await page.setViewportSize({ width: 1366, height: 768 });
  await gotoCad(page, errors);
  const file = writeWorld({ [line]: LINE3 }, [{
    name: 'E2T', line, courses: [[0, 1], [1, 2], [2, 3]],
    criteria: [DIST(0.5, 5), DIST(0.5, 7), DIST(0.5, 9)],
  }]);
  try {
    await openSurveyPlanDrawing(page, file);
    await openGroupManager(page);
    // Stage out of order: joint:1 first, then joint:0.
    await stageTransition(page, 'E2T', 1, 12);
    await stageTransition(page, 'E2T', 0, 8);
    await calculateSelected(page, 'E2T');
    await expect(groupRowByName(page, 'E2T')).toContainText('Current', { timeout: 60000 });
    const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
    await page.getByRole('button', { name: 'Save Drawing' }).first().click();
    const download = await downloadPromise;
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'wn-20n1-save-'));
    const savedPath = path.join(dir, 'drawing.wncad');
    await download.saveAs(savedPath);
    await openSurveyPlanDrawing(page, savedPath);
    await openGroupManager(page);
    await openTransitionTab(page, 'E2T');
    await expect(transitionRows(page)).toHaveCount(2);
    await expect(transitionRows(page).nth(0)).toContainText('joint:0');
    await expect(transitionRows(page).nth(0)).toContainText('8 m');
    await expect(transitionRows(page).nth(1)).toContainText('joint:1');
    await expect(transitionRows(page).nth(1)).toContainText('12 m');
    await gotoDefinitionTab(page);
    await calculateSelected(page, 'E2T');
    await expect(groupRowByName(page, 'E2T')).toContainText('Current', { timeout: 60000 });
    await shot(page, 'e-save-reopen-current');
    await fs.promises.rm(dir, { recursive: true, force: true });
  } finally {
    fs.rmSync(file, { force: true });
  }
  expect(errors).toEqual([]);
});

// ===========================================================================
// Flow F — edit middle width invalidates; removal leaves the other intact
// ===========================================================================
test('20N1 Flow F edit invalidates remove-one keeps other', async ({ page }) => {
  const errors: string[] = [];
  const line = nextId('fl');
  await withWorld(page, errors, { [line]: LINE4 }, [{
    name: 'F3T', line, courses: [[0, 1], [1, 2], [2, 3], [3, 4]],
    criteria: [DIST(0.5, 5), DIST(0.5, 7), DIST(0.5, 9), DIST(0.5, 11)],
  }], async () => {
    await stageTransition(page, 'F3T', 0, 8);
    await stageTransition(page, 'F3T', 1, 10);
    await stageTransition(page, 'F3T', 2, 8);
    await calculateSelected(page, 'F3T');
    await expect(groupRowByName(page, 'F3T')).toContainText('Current', { timeout: 90000 });

    // Edit the middle width: the old result must go not-current until rebuild.
    await openTransitionTab(page, 'F3T');
    const panel = page.locator('[data-cad-grading-group-transition-panel]');
    await panel.locator('[aria-label="Transition joint"]').selectOption('1');
    await panel.locator('[aria-label="Transition width"]').fill('14');
    await panel.locator('[data-cad-grading-group-transition-add]').click();
    await expect(page.locator('[data-cad-grading-group-notice]')).toContainText(/updat/i, { timeout: 10000 });
    await gotoDefinitionTab(page);
    const stale = groupRowByName(page, 'F3T');
    await expect(stale).not.toContainText('Current', { timeout: 15000 });
    await calculateSelected(page, 'F3T');
    await expect(groupRowByName(page, 'F3T')).toContainText('Current', { timeout: 90000 });
    await expect(transitionRows(page)).toHaveCount(0); // definition tab: list hidden
    await openTransitionTab(page, 'F3T');
    await expect(transitionRows(page).nth(1)).toContainText('14 m');

    // Remove joint:0: joints 1+2 stay staged and intact. The uncovered
    // joint:0 (5 m vs 7 m offsets, no transition) cannot solve, so the
    // whole group fails closed with CORNER_NO_SOLUTION — no partial CURRENT.
    await page.locator('[data-cad-grading-group-transition-remove="joint:0"]').click();
    await expect(page.locator('[data-cad-grading-group-notice]')).toContainText('removed', { timeout: 10000 });
    await expect(transitionRows(page)).toHaveCount(2);
    await expect(transitionRows(page).nth(0)).toContainText('joint:1');
    await expect(transitionRows(page).nth(1)).toContainText('joint:2');
    await gotoDefinitionTab(page);
    await calculateSelected(page, 'F3T');
    const uncovered = groupRowByName(page, 'F3T');
    await expect(uncovered).toContainText('Failed', { timeout: 90000 });
    await expect(uncovered).toContainText(/CORNER_NO_SOLUTION/);
    await expect(uncovered).not.toContainText('Current');
    await shot(page, 'f-edit-remove-fail-closed');
  });
});

// ===========================================================================
// Flow G — touching/overlap: authoring rejects; seeded touching fails closed
// ===========================================================================
test('20N1 Flow G1 authoring rejects touching overlap', async ({ page }) => {
  const errors: string[] = [];
  const line = nextId('fl');
  await page.setViewportSize({ width: 1366, height: 768 });
  await gotoCad(page, errors);
  const file = writeWorld({ [line]: LINE3 }, [{
    name: 'G2T', line, courses: [[0, 1], [1, 2], [2, 3]],
    criteria: [DIST(0.5, 5), DIST(0.5, 7), DIST(0.5, 9)],
  }]);
  try {
    await openSurveyPlanDrawing(page, file);
    await openGroupManager(page);
    await stageTransition(page, 'G2T', 0, 8);
    // 8/2 + 52/2 = 30 = shared member length: exactly touching.
    await openTransitionTab(page, 'G2T');
    const panel = page.locator('[data-cad-grading-group-transition-panel]');
    await panel.locator('[aria-label="Transition joint"]').selectOption('1');
    await panel.locator('[aria-label="Transition width"]').fill('52');
    await panel.locator('[data-cad-grading-group-transition-add]').click();
    await expect(page.locator('[data-cad-grading-group-notice]')).toContainText(/not added/i, { timeout: 10000 });
    await expect(transitionRows(page)).toHaveCount(1);
    // Overlapping: 8/2 + 54/2 = 31 > 30.
    await panel.locator('[aria-label="Transition width"]').fill('54');
    await panel.locator('[data-cad-grading-group-transition-add]').click();
    await expect(page.locator('[data-cad-grading-group-notice]')).toContainText(/not added/i, { timeout: 10000 });
    await expect(transitionRows(page)).toHaveCount(1);
    await shot(page, 'g-authoring-rejects-touching-overlap');
  } finally {
    fs.rmSync(file, { force: true });
  }
  expect(errors).toEqual([]);
});

// Seeded exactly-touching pair (30/30) fails closed at compute: never CURRENT.
// Separate test: a second page.goto in one context trips the CAD unsaved guard.
test('20N1 Flow G2 seeded touching fails closed', async ({ page }) => {
  const errors: string[] = [];
  const line = nextId('fl');
  await withWorld(page, errors, { [line]: LINE3 }, [{
    name: 'Gtouch', line, courses: [[0, 1], [1, 2], [2, 3]],
    criteria: [DIST(0.5, 5), DIST(0.5, 7), DIST(0.5, 9)],
    transitions: [{ joint: 0, width: 30 }, { joint: 1, width: 30 }],
  }], async () => {
    await calculateSelected(page, 'Gtouch');
    const row = groupRowByName(page, 'Gtouch');
    await expect(row).toContainText('Failed', { timeout: 60000 });
    await expect(row).not.toContainText('Current');
    await expect(page.locator('[data-cad-grading-group-extract]')).toBeDisabled();
    await expect(page.locator('[data-cad-grading-group-bake]')).toBeDisabled();
    await shot(page, 'g-touching-failed');
  });
});

// ===========================================================================
// Flow H — bent-joint control still fails; no new plan law appears
// ===========================================================================
test('20N1 Flow H bent joint fails closed', async ({ page }) => {
  const errors: string[] = [];
  const line = nextId('fl');
  await withWorld(page, errors, { [line]: BENT }, [{
    name: 'Hbend', line, courses: [[0, 1], [1, 2], [2, 3]],
    criteria: [DIST(0.5, 5), DIST(0.5, 7), DIST(0.5, 9)],
    transitions: [{ joint: 0, width: 8 }, { joint: 1, width: 8 }],
  }], async () => {
    await calculateSelected(page, 'Hbend');
    const row = groupRowByName(page, 'Hbend');
    await expect(row).toContainText('Failed', { timeout: 60000 });
    await expect(row).not.toContainText('Current');
    // Law selector still offers only the single registered transition law.
    await openTransitionTab(page, 'Hbend');
    const laws = await page.locator('[aria-label="Transition law"] option').allTextContents();
    expect(laws).toEqual(['TRANSITION_LINEAR_V1/v1']);
    await shot(page, 'h-bent-failed');
  });
});

// ===========================================================================
// Flow I — multi-transition CURRENT permits extract + bake; patch stays off
// ===========================================================================
test('20N1 Flow I products truthful patch off', async ({ page }) => {
  const errors: string[] = [];
  const line = nextId('fl');
  await withWorld(page, errors, { [line]: LINE3 }, [{
    name: 'I2T', line, courses: [[0, 1], [1, 2], [2, 3]],
    criteria: [DIST(0.5, 5), DIST(0.5, 7), DIST(0.5, 9)],
  }], async () => {
    await stageTransition(page, 'I2T', 0, 8);
    await stageTransition(page, 'I2T', 1, 12);
    const row = groupRowByName(page, 'I2T');
    await row.click();
    await expect(page.locator('[data-cad-grading-group-extract]')).toBeDisabled();
    await expect(page.locator('[data-cad-grading-group-bake]')).toBeDisabled();
    await calculateSelected(page, 'I2T');
    await expect(row).toContainText('Current', { timeout: 60000 });

    const entitiesBefore = await entityCount(page);
    await expect(page.locator('[data-cad-grading-group-extract]')).toBeEnabled({ timeout: 10000 });
    await page.locator('[data-cad-grading-group-extract]').click();
    await expect.poll(() => entityCount(page)).toBe(entitiesBefore + 1);
    await homeTab(page);
    await page.locator('[data-cad-command="SHELL_UNDO"]').click();
    await expect.poll(() => entityCount(page)).toBe(entitiesBefore);

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
    await shot(page, 'i-products');

    await homeTab(page);
    await page.getByRole('tab', { name: 'Surface' }).click();
    await page.getByRole('button', { name: 'Add Points' }).first().click();
    const workflow = page.locator('section[aria-label="Design workflow"]');
    await expect(workflow).toBeVisible({ timeout: 15000 });
    const groupSelect = workflow.locator('[aria-label="Grading group"]');
    const optionLabels = await groupSelect.locator('option').allTextContents();
    const targetLabel = optionLabels.find((text) => text.includes('I2T'));
    expect(targetLabel).toBeDefined();
    await groupSelect.selectOption({ label: targetLabel! });
    await expect(workflow.getByRole('button', { name: 'Build Design Patch' })).toBeDisabled();
    await shot(page, 'i-patch-off');
  });
});

// ===========================================================================
// Flow J — undo/redo round-trips the staged transition array
// ===========================================================================
test('20N1 Flow J undo redo transition array', async ({ page }) => {
  const errors: string[] = [];
  const line = nextId('fl');
  await withWorld(page, errors, { [line]: LINE3 }, [{
    name: 'J2T', line, courses: [[0, 1], [1, 2], [2, 3]],
    criteria: [DIST(0.5, 5), DIST(0.5, 7), DIST(0.5, 9)],
  }], async () => {
    await stageTransition(page, 'J2T', 0, 8);
    await stageTransition(page, 'J2T', 1, 12);
    await openTransitionTab(page, 'J2T');
    await expect(transitionRows(page)).toHaveCount(2);

    // Undo drops joint:1; redo restores it.
    await homeTab(page);
    await page.locator('[data-cad-command="SHELL_UNDO"]').click();
    await openGroupManager(page);
    await openTransitionTab(page, 'J2T');
    await expect(transitionRows(page)).toHaveCount(1);
    await expect(transitionRows(page).nth(0)).toContainText('joint:0');
    await homeTab(page);
    await page.locator('[data-cad-command="SHELL_REDO"]').click();
    await openGroupManager(page);
    await openTransitionTab(page, 'J2T');
    await expect(transitionRows(page)).toHaveCount(2);

    // Remove joint:0 then undo the removal: both back.
    await page.locator('[data-cad-grading-group-transition-remove="joint:0"]').click();
    await expect(transitionRows(page)).toHaveCount(1);
    await homeTab(page);
    await page.locator('[data-cad-command="SHELL_UNDO"]').click();
    await openGroupManager(page);
    await openTransitionTab(page, 'J2T');
    await expect(transitionRows(page)).toHaveCount(2);
    await expect(transitionRows(page).nth(0)).toContainText('joint:0');
    await expect(transitionRows(page).nth(1)).toContainText('joint:1');

    // Width edit round-trips: 12 -> 14 -> undo -> 12.
    const panel = page.locator('[data-cad-grading-group-transition-panel]');
    await panel.locator('[aria-label="Transition joint"]').selectOption('1');
    await panel.locator('[aria-label="Transition width"]').fill('14');
    await panel.locator('[data-cad-grading-group-transition-add]').click();
    await expect(transitionRows(page).nth(1)).toContainText('14 m');
    await homeTab(page);
    await page.locator('[data-cad-command="SHELL_UNDO"]').click();
    await openGroupManager(page);
    await openTransitionTab(page, 'J2T');
    await expect(transitionRows(page).nth(1)).toContainText('12 m');
    await shot(page, 'j-undo-redo');
  });
});

// ===========================================================================
// Flow K — legacy single transition behaves as Phase 20M.2
// ===========================================================================
test('20N1 Flow K legacy single transition CURRENT', async ({ page }) => {
  const errors: string[] = [];
  const line = nextId('fl');
  await withWorld(page, errors, { [line]: LINE3 }, [{
    name: 'K1T', line, courses: [[0, 1], [1, 2], [2, 3]],
    criteria: [DIST(0.5, 5), DIST(0.5, 7), DIST(0.5, 7)],
  }], async () => {
    await stageTransition(page, 'K1T', 0, 8);
    await openTransitionTab(page, 'K1T');
    await expect(transitionRows(page)).toHaveCount(1);
    await gotoDefinitionTab(page);
    await calculateSelected(page, 'K1T');
    const row = groupRowByName(page, 'K1T');
    await expect(row).toContainText('Current', { timeout: 60000 });
    await expect(row).not.toContainText('Failed');
    await shot(page, 'k-legacy-single-current');
  });
});
