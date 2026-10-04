/**
 * Phase 20P.1 browser QA — sparse (gapped) collinear transition sets through
 * the REAL /cad shell in headless Chromium.
 *
 * Rule: primary flows stage transitions through the live Transition tab
 * (real GROUP_SET_TRANSITION / GROUP_CLEAR_TRANSITION commits + real worker
 * calculate). Seeded-file intents are used ONLY for the bent-joint control
 * (flow 9) and the malformed-order control (flow 11). Screenshots +
 * geometry.json land under docs/evidence/phase20p1/.
 *
 * Flows: 1 sparse [0,2] CURRENT; 2 width edit keeps neighbor; 3 mixed
 * cluster [0,1,2]; 4 clear-one keeps others; 5 save/reload; 6
 * extract/bake gating + success; 7 exact-touch refused; 8 too-wide/overlap
 * refused; 9 bent ACTUAL transition joint fails closed; 10 no
 * auto-transition at skipped joints; 11 malformed stored order not repaired.
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

const EVIDENCE = path.resolve(process.cwd(), 'docs/evidence/phase20p1');
fs.mkdirSync(EVIDENCE, { recursive: true });

let seq = 500;
const nextId = (p: string): string => `${p}-20p1-${++seq}`;

const fl = (id: string, pts: Array<[number, number, number]>): CadFeatureLineEntity => ({
  id, type: 'feature-line', layerId: 'general', visible: true, locked: false, name: `FL ${id}`,
  vertices: pts.map(([x, y, z], i) => ({ id: `${id}:v${i}`, x, y, z })),
});

const DIST = (g: number, d: number): GradingCriterion => ({ kind: 'distance', gradeRatio: g, distance: d });

// Member lengths [30, 24, 26, 30]; uniform 5 m offsets keep skipped joints native-clean.
const LINE5: Array<[number, number, number]> = [[-60, 0, 10], [-30, 0, 10], [-6, 0, 10], [20, 0, 10], [50, 0, 10]];
// Same members but deflected at joint 2 (an ACTUAL transition joint).
const BENT2: Array<[number, number, number]> = [[-60, 0, 10], [-30, 0, 10], [-6, 0, 10], [20, 0, 10], [20, 26, 10]];

const V = (line: string, i: number): string => `${line}:v${i}`;

interface SeedTransition { joint: number; width: number }
interface GroupSeed {
  name: string;
  line: string;
  courses: Array<[number, number]>;
  criteria: GradingCriterion[];
  transitions?: SeedTransition[];
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
    maxSearchDistance: 50,
    curveChordTolerance: 0.01,
    cornerMode: 'miter',
    ...(seed.transitions !== undefined ? {
      // Stored order preserved verbatim (no canonicalization) for flow 11.
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

const COURSES4: Array<[number, number]> = [[0, 1], [1, 2], [2, 3], [3, 4]];
const uniformDist = (): GradingCriterion[] => [DIST(0.5, 5), DIST(0.5, 5), DIST(0.5, 5), DIST(0.5, 5)];

const writeWorld = (lines: Record<string, Array<[number, number, number]>>, groups: GroupSeed[]): string => {
  const project: CadProject = {
    ...createBlankCadDrawingDocument({ name: '20P.1 sparse QA', units: 'm' }).project,
    entities: Object.entries(lines).map(([id, pts]) => fl(id, pts)),
    surfaces: [],
    gradingGroups: groups.map(groupOf),
  };
  const file = path.join(os.tmpdir(), `wn-20p1-${Date.now()}-${Math.floor(Math.random() * 1e6)}.wncad`);
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
// Flow 1 — sparse [0,2] staged via UI solves CURRENT; both rows visible
// ===========================================================================
test('20P1 Flow 1 sparse joints 0+2 CURRENT', async ({ page }) => {
  const errors: string[] = [];
  const line = nextId('fl');
  await withWorld(page, errors, { [line]: LINE5 }, [{
    name: 'P1S', line, courses: COURSES4, criteria: uniformDist(),
  }], async () => {
    await stageTransition(page, 'P1S', 0, 8);
    await stageTransition(page, 'P1S', 2, 6);
    await openTransitionTab(page, 'P1S');
    await expect(transitionRows(page)).toHaveCount(2);
    await expect(transitionRows(page).nth(0)).toContainText('joint:0');
    await expect(transitionRows(page).nth(1)).toContainText('joint:2');
    await gotoDefinitionTab(page);
    await calculateSelected(page, 'P1S');
    const row = groupRowByName(page, 'P1S');
    await expect(row).toContainText('Current', { timeout: 60000 });
    await expect(row).not.toContainText('Failed');
    await row.getByText('Current').first().scrollIntoViewIfNeeded();
    await shot(page, 'p1-sparse-02-current');
  });
});

// ===========================================================================
// Flow 10 — no transition auto-appears at skipped joint 1
// ===========================================================================
test('20P1 Flow 10 skipped joint stays unstaged', async ({ page }) => {
  const errors: string[] = [];
  const line = nextId('fl');
  await withWorld(page, errors, { [line]: LINE5 }, [{
    name: 'P10S', line, courses: COURSES4, criteria: uniformDist(),
  }], async () => {
    await stageTransition(page, 'P10S', 0, 8);
    await stageTransition(page, 'P10S', 2, 6);
    await calculateSelected(page, 'P10S');
    await expect(groupRowByName(page, 'P10S')).toContainText('Current', { timeout: 60000 });
    await openTransitionTab(page, 'P10S');
    await expect(transitionRows(page)).toHaveCount(2);
    // The joint:1 option is offered but NOT marked staged.
    const options = await page.locator('[aria-label="Transition joint"] option').allTextContents();
    expect(options.some((t) => t.includes('joint:1 (staged'))).toBe(false);
    await expect(transitionRows(page).nth(0)).toContainText('joint:0');
    await expect(transitionRows(page).nth(1)).toContainText('joint:2');
    await transitionRows(page).nth(1).scrollIntoViewIfNeeded();
    await shot(page, 'p10-no-auto-transition');
  });
});

// ===========================================================================
// Flow 2 — edit width at joint 0; joint 2 survives with its width
// ===========================================================================
test('20P1 Flow 2 width edit keeps neighbor', async ({ page }) => {
  const errors: string[] = [];
  const line = nextId('fl');
  await withWorld(page, errors, { [line]: LINE5 }, [{
    name: 'P2S', line, courses: COURSES4, criteria: uniformDist(),
  }], async () => {
    await stageTransition(page, 'P2S', 0, 8);
    await stageTransition(page, 'P2S', 2, 6);
    await calculateSelected(page, 'P2S');
    await expect(groupRowByName(page, 'P2S')).toContainText('Current', { timeout: 60000 });

    await openTransitionTab(page, 'P2S');
    const panel = page.locator('[data-cad-grading-group-transition-panel]');
    await panel.locator('[aria-label="Transition joint"]').selectOption('0');
    await panel.locator('[aria-label="Transition width"]').fill('10');
    await panel.locator('[data-cad-grading-group-transition-add]').click();
    await expect(page.locator('[data-cad-grading-group-notice]')).toContainText(/updat/i, { timeout: 10000 });
    await expect(transitionRows(page)).toHaveCount(2);
    await expect(transitionRows(page).nth(0)).toContainText('joint:0');
    await expect(transitionRows(page).nth(0)).toContainText('10 m');
    await expect(transitionRows(page).nth(1)).toContainText('joint:2');
    await expect(transitionRows(page).nth(1)).toContainText('6 m');
    await gotoDefinitionTab(page);
    // Stale result must go not-current until rebuilt.
    await expect(groupRowByName(page, 'P2S')).not.toContainText('Current', { timeout: 15000 });
    await calculateSelected(page, 'P2S');
    await expect(groupRowByName(page, 'P2S')).toContainText('Current', { timeout: 60000 });
    await groupRowByName(page, 'P2S').getByText('Current').first().scrollIntoViewIfNeeded();
    await shot(page, 'p2-edit-keeps-neighbor');
  });
});

// ===========================================================================
// Flows 3+4 — consecutive neighbor creates a mixed cluster; clear-one keeps rest
// ===========================================================================
test('20P1 Flows 3+4 mixed cluster then clear one', async ({ page }) => {
  const errors: string[] = [];
  const line = nextId('fl');
  await withWorld(page, errors, { [line]: LINE5 }, [{
    name: 'P34S', line, courses: COURSES4, criteria: uniformDist(),
  }], async () => {
    await stageTransition(page, 'P34S', 0, 8);
    await stageTransition(page, 'P34S', 2, 6);
    // Flow 3: add consecutive joint 1 -> mixed cluster [0,1,2].
    await stageTransition(page, 'P34S', 1, 6);
    await openTransitionTab(page, 'P34S');
    await expect(transitionRows(page)).toHaveCount(3);
    await gotoDefinitionTab(page);
    await calculateSelected(page, 'P34S');
    await expect(groupRowByName(page, 'P34S')).toContainText('Current', { timeout: 60000 });
    await groupRowByName(page, 'P34S').getByText('Current').first().scrollIntoViewIfNeeded();
    await shot(page, 'p3-mixed-cluster-current');

    // Flow 4: clear joint 1; joints 0+2 survive staged and still solve.
    await openTransitionTab(page, 'P34S');
    await page.locator('[data-cad-grading-group-transition-remove="joint:1"]').click();
    await expect(page.locator('[data-cad-grading-group-notice]')).toContainText('removed', { timeout: 10000 });
    await expect(transitionRows(page)).toHaveCount(2);
    await expect(transitionRows(page).nth(0)).toContainText('joint:0');
    await expect(transitionRows(page).nth(1)).toContainText('joint:2');
    await gotoDefinitionTab(page);
    await calculateSelected(page, 'P34S');
    await expect(groupRowByName(page, 'P34S')).toContainText('Current', { timeout: 60000 });
    await groupRowByName(page, 'P34S').getByText('Current').first().scrollIntoViewIfNeeded();
    await shot(page, 'p4-clear-one-survives');
  });
});

// ===========================================================================
// Flow 5 — save/reload retains sparse ids/order/widths
// ===========================================================================
test('20P1 Flow 5 save-reload preserves sparse set', async ({ page }) => {
  const errors: string[] = [];
  const line = nextId('fl');
  await page.setViewportSize({ width: 1366, height: 768 });
  await gotoCad(page, errors);
  const file = writeWorld({ [line]: LINE5 }, [{
    name: 'P5S', line, courses: COURSES4, criteria: uniformDist(),
  }]);
  try {
    await openSurveyPlanDrawing(page, file);
    await openGroupManager(page);
    // Stage out of order: joint:2 first, then joint:0.
    await stageTransition(page, 'P5S', 2, 6);
    await stageTransition(page, 'P5S', 0, 8);
    await calculateSelected(page, 'P5S');
    await expect(groupRowByName(page, 'P5S')).toContainText('Current', { timeout: 60000 });
    const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
    await page.getByRole('button', { name: 'Save Drawing' }).first().click();
    const download = await downloadPromise;
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'wn-20p1-save-'));
    const savedPath = path.join(dir, 'drawing.wncad');
    await download.saveAs(savedPath);
    await openSurveyPlanDrawing(page, savedPath);
    await openGroupManager(page);
    await openTransitionTab(page, 'P5S');
    await expect(transitionRows(page)).toHaveCount(2);
    await expect(transitionRows(page).nth(0)).toContainText('joint:0');
    await expect(transitionRows(page).nth(0)).toContainText('8 m');
    await expect(transitionRows(page).nth(1)).toContainText('joint:2');
    await expect(transitionRows(page).nth(1)).toContainText('6 m');
    await gotoDefinitionTab(page);
    await calculateSelected(page, 'P5S');
    await expect(groupRowByName(page, 'P5S')).toContainText('Current', { timeout: 60000 });
    await groupRowByName(page, 'P5S').getByText('Current').first().scrollIntoViewIfNeeded();
    await shot(page, 'p5-save-reload-sparse');
    await fs.promises.rm(dir, { recursive: true, force: true });
  } finally {
    fs.rmSync(file, { force: true });
  }
  expect(errors).toEqual([]);
});

// ===========================================================================
// Flow 6 — extract/bake gated until CURRENT, then succeed citing both joints
// ===========================================================================
test('20P1 Flow 6 products gated then succeed', async ({ page }) => {
  const errors: string[] = [];
  const line = nextId('fl');
  await withWorld(page, errors, { [line]: LINE5 }, [{
    name: 'P6S', line, courses: COURSES4, criteria: uniformDist(),
  }], async () => {
    await stageTransition(page, 'P6S', 0, 8);
    await stageTransition(page, 'P6S', 2, 6);
    const row = groupRowByName(page, 'P6S');
    await row.click();
    await expect(page.locator('[data-cad-grading-group-extract]')).toBeDisabled();
    await expect(page.locator('[data-cad-grading-group-bake]')).toBeDisabled();
    await calculateSelected(page, 'P6S');
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
    // Both transitioned joints stay cited after the product commits.
    await openGroupManager(page);
    await openTransitionTab(page, 'P6S');
    await expect(transitionRows(page)).toHaveCount(2);
    await expect(transitionRows(page).nth(0)).toContainText('joint:0');
    await expect(transitionRows(page).nth(1)).toContainText('joint:2');
    await transitionRows(page).nth(1).scrollIntoViewIfNeeded();
    await shot(page, 'p6-products-cite-both-joints');
    await homeTab(page);
    await page.locator('[data-cad-command="SHELL_UNDO"]').click();
    await expect.poll(() => surfaceNodes(page).count()).toBe(surfacesBefore);
  });
});

// ===========================================================================
// Flow 7 — exact-touch across the skipped joint is refused at authoring
// ===========================================================================
test('20P1 Flow 7 exact touch refused', async ({ page }) => {
  const errors: string[] = [];
  const line = nextId('fl');
  await page.setViewportSize({ width: 1366, height: 768 });
  await gotoCad(page, errors);
  const file = writeWorld({ [line]: LINE5 }, [{
    name: 'P7S', line, courses: COURSES4, criteria: uniformDist(),
  }]);
  try {
    await openSurveyPlanDrawing(page, file);
    await openGroupManager(page);
    await stageTransition(page, 'P7S', 0, 48);
    // Gap S(2)-S(0) = 24+26 = 50; 48/2 + 52/2 = 50: exactly touching.
    await openTransitionTab(page, 'P7S');
    const panel = page.locator('[data-cad-grading-group-transition-panel]');
    await panel.locator('[aria-label="Transition joint"]').selectOption('2');
    await panel.locator('[aria-label="Transition width"]').fill('52');
    await panel.locator('[data-cad-grading-group-transition-add]').click();
    await expect(page.locator('[data-cad-grading-group-notice]')).toContainText(/not added/i, { timeout: 10000 });
    await expect(page.locator('[data-cad-grading-group-notice]')).toContainText(/touching/i, { timeout: 10000 });
    await expect(transitionRows(page)).toHaveCount(1);
    await page.locator('[data-cad-grading-group-notice]').scrollIntoViewIfNeeded();
    await shot(page, 'p7-exact-touch-refused');
  } finally {
    fs.rmSync(file, { force: true });
  }
  expect(errors).toEqual([]);
});

// ===========================================================================
// Flow 8 — too-wide and overlapping intents refused truthfully
// ===========================================================================
test('20P1 Flow 8 too-wide and overlap refused', async ({ page }) => {
  const errors: string[] = [];
  const line = nextId('fl');
  await page.setViewportSize({ width: 1366, height: 768 });
  await gotoCad(page, errors);
  const file = writeWorld({ [line]: LINE5 }, [{
    name: 'P8S', line, courses: COURSES4, criteria: uniformDist(),
  }]);
  try {
    await openSurveyPlanDrawing(page, file);
    await openGroupManager(page);
    await stageTransition(page, 'P8S', 0, 8);
    await openTransitionTab(page, 'P8S');
    const panel = page.locator('[data-cad-grading-group-transition-panel]');
    // Too-wide: joint 2 width 60 > 2*min(26,30) = 52.
    await panel.locator('[aria-label="Transition joint"]').selectOption('2');
    await panel.locator('[aria-label="Transition width"]').fill('60');
    await panel.locator('[data-cad-grading-group-transition-add]').click();
    await expect(page.locator('[data-cad-grading-group-notice]')).toContainText(/not added/i, { timeout: 10000 });
    await expect(transitionRows(page)).toHaveCount(1);
    // Overlap: joint 1 width 44 against staged joint 0 (8/2 + 44/2 = 26 > gap 24).
    await panel.locator('[aria-label="Transition joint"]').selectOption('1');
    await panel.locator('[aria-label="Transition width"]').fill('44');
    await panel.locator('[data-cad-grading-group-transition-add]').click();
    await expect(page.locator('[data-cad-grading-group-notice]')).toContainText(/not added/i, { timeout: 10000 });
    await expect(page.locator('[data-cad-grading-group-notice]')).toContainText(/overlapping/i, { timeout: 10000 });
    await expect(transitionRows(page)).toHaveCount(1);
    await page.locator('[data-cad-grading-group-notice]').scrollIntoViewIfNeeded();
    await shot(page, 'p8-too-wide-overlap-refused');
  } finally {
    fs.rmSync(file, { force: true });
  }
  expect(errors).toEqual([]);
});

// ===========================================================================
// Flow 9 — bent ACTUAL transition joint fails closed (seeded control)
// ===========================================================================
test('20P1 Flow 9 bent transition joint fails closed', async ({ page }) => {
  const errors: string[] = [];
  const line = nextId('fl');
  await withWorld(page, errors, { [line]: BENT2 }, [{
    name: 'P9S', line, courses: COURSES4, criteria: uniformDist(),
    transitions: [{ joint: 0, width: 8 }, { joint: 2, width: 6 }],
  }], async () => {
    await calculateSelected(page, 'P9S');
    const row = groupRowByName(page, 'P9S');
    await expect(row).toContainText('Failed', { timeout: 60000 });
    await expect(row).not.toContainText('Current');
    await expect(page.locator('[data-cad-grading-group-extract]')).toBeDisabled();
    await expect(page.locator('[data-cad-grading-group-bake]')).toBeDisabled();
    await row.getByText('Failed').first().scrollIntoViewIfNeeded();
    await shot(page, 'p9-bent-failed');
  });
});

// ===========================================================================
// Flow 11 — malformed stored order warns and fails closed (never repaired)
// ===========================================================================
test('20P1 Flow 11 malformed order not repaired', async ({ page }) => {
  const errors: string[] = [];
  const line = nextId('fl');
  await withWorld(page, errors, { [line]: LINE5 }, [{
    name: 'P11S', line, courses: COURSES4, criteria: uniformDist(),
    transitions: [{ joint: 2, width: 6 }, { joint: 0, width: 8 }],
  }], async () => {
    await openTransitionTab(page, 'P11S');
    // Display is canonical but the stored order is flagged, never silently
    // sorted: the warning persists and recalculation fails closed.
    await expect(page.locator('[data-cad-grading-group-transition-order-warning]')).toContainText(/out of order/i);
    await expect(transitionRows(page)).toHaveCount(2);
    await expect(transitionRows(page).nth(0)).toContainText('joint:0');
    await expect(transitionRows(page).nth(1)).toContainText('joint:2');
    await gotoDefinitionTab(page);
    await calculateSelected(page, 'P11S');
    const row = groupRowByName(page, 'P11S');
    await expect(row).toContainText('Failed', { timeout: 60000 });
    await expect(row).not.toContainText('Current');
    await row.getByText('Failed').first().scrollIntoViewIfNeeded();
    await shot(page, 'p11-malformed-fails-closed');
  });
});
