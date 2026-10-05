/**
 * Phase 20Q.1 Wave L browser QA — singular sloped-source transitions via the
 * REAL /cad shell in headless Chromium (production build). Seeded .wncad +
 * live group manager (real worker calculate), zero page/console errors.
 * S1 scope: ONE joint-continuous sloped intent per group (3 families).
 * Flows 1-10 in 3 tests; PNGs + geometry.json: docs/evidence/phase20q1/.
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
import type { GradingCriterion as GC } from '../src/engine/cad/grading/gradingTypes';
import {
  entityCount,
  gotoCad,
  homeTab,
  openSurveyPlanDrawing,
  selectionCount,
} from './cad-survey-plan-19a-helpers';

const EVIDENCE = path.resolve(process.cwd(), 'docs/evidence/phase20q1');
fs.mkdirSync(EVIDENCE, { recursive: true });

let seq = 0;
const nextId = (p: string): string => `${p}-20q1-${++seq}`;
const boot = async (page: Page): Promise<string[]> => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const errors: string[] = [];
  await gotoCad(page, errors);
  return errors;
};
const fl = (id: string, pts: Array<[number, number, number]>): CadFeatureLineEntity => ({
  id,
  type: 'feature-line',
  layerId: 'general',
  visible: true,
  locked: false,
  name: `FL ${id}`,
  vertices: pts.map(([x, y, z], i) => ({ id: `${id}:v${i}`, x, y, z })),
});
const DIST = (g: number, d: number): GC => ({ kind: 'distance', gradeRatio: g, distance: d });
const REL = (g: number, dz: number): GC => ({
  kind: 'relative-elevation',
  gradeRatio: g,
  relativeElevation: dz,
});
const ELEV = (g: number, e: number): GC => ({
  kind: 'elevation',
  gradeRatio: g,
  targetElevation: e,
});
type Pt = [number, number, number];
const UP: Pt[] = [8, 10, 12].map((z, i): Pt => [(i - 1) * 30, 0, z]);
const CREST: Pt[] = [8, 10, 8].map((z, i): Pt => [(i - 1) * 30, 0, z]);
const SAG: Pt[] = [12, 10, 12].map((z, i): Pt => [(i - 1) * 30, 0, z]);
const THREE: Pt[] = [8, 10, 12, 14].map((z, i): Pt => [(i - 1) * 30, 0, z]);
// 2 m Z jump in a 1 mm course: passes file sanitize (tol 1e-9) but no 8 m
// transition fits (width ceiling 2 mm) — fails closed at admission.
const STEPX = [-30, 0, 0.001, 30];
const STEPZ = [8, 10, 12, 12];
const STEP: Pt[] = STEPX.map((x, i): Pt => [x, 0, STEPZ[i]!]);
const FLAT4: Pt[] = [-45, -15, 15, 45, 75].map((x): Pt => [x, 0, 10]);
const V = (line: string, i: number): string => `${line}:v${i}`;
const KEY = (line: string, a: number, b: number): string => `${V(line, a)}>${V(line, b)}`;
const intentOf = (line: string, a: number, b: number, width: number, family: string) => ({
  policyVersion: 'trp1',
  jointId: `joint:${a}`,
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
  courses: Array<{ vertexAId: string; vertexBId: string }>;
  criterion: GC;
  overrides: CC[];
  transitions: Array<ReturnType<typeof intentOf>>;
}
const cc = (line: string, c: [number, number]) => ({
  vertexAId: V(line, c[0]),
  vertexBId: V(line, c[1]),
});
type CC = { sourceCourse: { vertexAId: string; vertexBId: string }; criterion: GC };
const ov = (line: string, a: number, b: number, criterion: GC) => ({
  sourceCourse: { vertexAId: V(line, a), vertexBId: V(line, b) },
  criterion,
});
const groupOf = (seed: GroupSeed): CadGradingGroup =>
  ({
    id: nextId('grp'),
    name: seed.name,
    sourceFeatureLineId: seed.line,
    sourceCourses: seed.courses,
    side: 'left',
    criterion: seed.criterion,
    courseCriteria: seed.overrides,
    maxSearchDistance: 50,
    curveChordTolerance: 0.01,
    cornerMode: 'miter',
    transitions: seed.transitions,
  }) as CadGradingGroup;
const writeWorld = (lines: Record<string, Pt[]>, groups: GroupSeed[]): string => {
  const project: CadProject = {
    ...createBlankCadDrawingDocument({ name: '20Q.1 sloped QA', units: 'm' }).project,
    entities: Object.entries(lines).map(([id, pts]) => fl(id, pts)),
    surfaces: [],
    gradingGroups: groups.map(groupOf),
  };
  const doc = { ...createBlankCadDrawingDocument({ name: 'q', units: 'm' }), project };
  const file = path.join(os.tmpdir(), `wn-20q1-${Date.now()}-${Math.random()}.wncad`);
  fs.writeFileSync(file, serializeCadDrawingFile(doc), 'utf8');
  return file;
};
const sloped1 = (line: string, name: string, base: GC, over: GC, f: string): GroupSeed => ({
  name,
  line,
  courses: [cc(line, [0, 1]), cc(line, [1, 2])],
  criterion: base,
  overrides: [ov(line, 1, 2, over)],
  transitions: [intentOf(line, 0, 2, 8, f)],
});
const C3 = [0, 1, 2].map((i): [number, number] => [i, i + 1]);
const C4 = [0, 1, 2, 3].map((i): [number, number] => [i, i + 1]);
const d5 = (
  name: string,
  line: string,
  courses: Array<[number, number]>,
  transitions: GroupSeed['transitions'],
  overrides?: GroupSeed['overrides'],
): GroupSeed => ({
  name,
  line,
  courses: courses.map((c) => cc(line, c)),
  criterion: D5,
  overrides: overrides ?? [],
  transitions,
});
const oneLine = (
  shot: string,
  pts: Pt[],
  group: (_line: string) => GroupSeed,
  want: 'Current' | 'Failed',
  ui?: number,
) => {
  const line = nextId('flq');
  return { shot, lines: { [line]: pts }, groups: [group(line)], want, uiRefuseJoint: ui };
};
const openGroupManager = async (page: Page): Promise<void> => {
  await homeTab(page);
  await page.locator('[data-cad-grading-group-command="GRADINGGROUP"]').click();
  await expect(page.locator('[data-cad-grading-group-table]')).toBeVisible({ timeout: 15000 });
};
const groupRowByName = (page: Page, name: string) =>
  page.locator('[data-cad-grading-group-row]', { hasText: name }).first();
const calculateSelected = async (page: Page, name: string): Promise<void> => {
  await groupRowByName(page, name).click();
  await expect(page.locator('[data-cad-grading-group-calculate]')).toBeEnabled({ timeout: 15000 });
  await page.locator('[data-cad-grading-group-calculate]').click();
};
const geometry: Record<string, unknown> = {};
test.afterAll(() => {
  fs.writeFileSync(`${EVIDENCE}/geometry.json`, JSON.stringify(geometry, null, 2));
});
/**
 * Capture-time framing. The create form (434 px tall) fills the manager's
 * clipped 274 px viewport and pushes the row table/notice out of the frame,
 * and the row table is wider than the 480 px panel so the Status column sits
 * past its right edge. Collapse the create form (it is not part of any
 * claim), pin the manager to the top so the notice is legible, and bring the
 * selected group's Status cell into view. Assertions are unchanged.
 */
const frameEvidence = async (page: Page, rowName: string, focus?: string): Promise<void> => {
  await page.evaluate(() => {
    const form = document.querySelector('[data-cad-grading-group-create]');
    if (form instanceof HTMLElement) form.style.display = 'none';
    const manager = document.querySelector('section[aria-label="Grading group manager"]');
    if (manager instanceof HTMLElement) manager.scrollTop = 0;
  });
  const target = focus ? page.locator(focus) : groupRowByName(page, rowName).locator('td').nth(6);
  await target.scrollIntoViewIfNeeded();
};
const shot = async (page: Page, name: string, rowName: string, focus?: string): Promise<void> => {
  await frameEvidence(page, rowName, focus);
  geometry[name] = await page.evaluate(() => {
    const box = (s: string) => document.querySelector(s)?.getBoundingClientRect().toJSON() ?? null;
    const managerEl = document.querySelector(
      'section[aria-label="Grading group manager"]',
    ) as HTMLElement | null;
    return {
      innerW: window.innerWidth,
      innerH: window.innerHeight,
      manager: box('section[aria-label="Grading group manager"]'),
      managerScroll: managerEl
        ? {
            top: managerEl.scrollTop,
            client: managerEl.clientHeight,
            scroll: managerEl.scrollHeight,
          }
        : null,
      create: box('[data-cad-grading-group-create]'),
      notice: box('[data-cad-grading-group-notice]'),
      selectedRow: box('[data-cad-grading-group-row][data-selected="true"]'),
      statusCell: box('[data-cad-grading-group-row][data-selected="true"] td:nth-child(7)'),
      viewport: box('[data-cad-viewport]'),
    };
  });
  await page.screenshot({ path: `${EVIDENCE}/${name}.png` });
};
const surveyTab = '[aria-label="Toolspace tabs"]';
const D5 = DIST(0.5, 5);
const D7 = DIST(0.5, 7);

// Flows 1–4 + 9 (admitted: per-family sloped, CREST+SAG, all-flat sparse go
// CURRENT) and flows 7 + 8 (degenerate step, two sloped intents fail closed
// with no partial CURRENT; second joint refused in UI with a bounded reason).
test('20Q1 transition sets resolve truthfully', async ({ page }) => {
  const errors = await boot(page);
  const worlds: ReturnType<typeof oneLine>[] = [];
  for (const [tag, base, over, f] of [
    ['A', DIST(0.5, 5), DIST(0.5, 7), 'distance'],
    ['B', REL(0.5, 2), REL(0.5, 4), 'relative-elevation'],
    ['C', ELEV(0.5, 12), ELEV(0.5, 14), 'elevation'],
  ] as const)
    worlds.push(
      oneLine(
        `flow-${tag}-current`,
        UP,
        (line) => sloped1(line, `Q${tag}`, base, over, f),
        'Current',
      ),
    );
  worlds.push(
    oneLine(
      'flow-4-crest-current',
      CREST,
      (line) => sloped1(line, 'Qcrest', D5, D7, 'distance'),
      'Current',
    ),
  );
  worlds.push(
    oneLine(
      'flow-4-sag-current',
      SAG,
      (line) => sloped1(line, 'Qsag', REL(0.5, 2), REL(0.5, 4), 'relative-elevation'),
      'Current',
    ),
  );
  worlds.push(
    oneLine(
      'flow-9-flat-sparse-current',
      FLAT4,
      (line) =>
        d5('Qflat', line, C4, [
          intentOf(line, 0, 2, 8, 'distance'),
          intentOf(line, 2, 4, 8, 'distance'),
        ]),
      'Current',
    ),
  );
  worlds.push(
    oneLine(
      'flow-7-step-failed',
      STEP,
      (line) =>
        d5('Qxstep', line, C3, [intentOf(line, 1, 3, 8, 'distance')], [ov(1, 2, D7), ov(2, 3, D7)]),
      'Failed',
    ),
  );
  worlds.push(
    oneLine(
      'flow-8-double-failed',
      THREE,
      (line) =>
        d5(
          'Qtwo',
          line,
          C3,
          [intentOf(line, 0, 2, 8, 'distance'), intentOf(line, 1, 3, 8, 'distance')],
          [ov(1, 2, D7), ov(2, 3, DIST(0.5, 9))],
        ),
      'Failed',
    ),
  );
  worlds.push(
    oneLine(
      'flow-8-second-refused-ui',
      THREE,
      (line) =>
        d5('Qone', line, C3, [intentOf(line, 0, 2, 8, 'distance')], [ov(1, 2, D7), ov(2, 3, D7)]),
      'Current',
      1,
    ),
  );
  for (const world of worlds) {
    const file = writeWorld(world.lines, world.groups);
    try {
      await openSurveyPlanDrawing(page, file);
      await openGroupManager(page);
      for (const group of world.groups) {
        await calculateSelected(page, group.name);
        const row = groupRowByName(page, group.name);
        await expect(row).toContainText(world.want, { timeout: 60000 });
        await expect(row).not.toContainText(world.want === 'Current' ? 'Failed' : 'Current');
      }
      if (world.want === 'Failed') {
        await expect(page.locator('[data-cad-grading-group-notice]')).toContainText(
          'Calculate failed',
        );
        await expect(page.locator('[data-cad-grading-group-extract]')).toBeDisabled();
        await expect(page.locator('[data-cad-grading-group-bake]')).toBeDisabled();
      }
      if (world.uiRefuseJoint !== undefined) {
        const joint = '[aria-label="Transition joint"]';
        await groupRowByName(page, world.groups[0]!.name).click();
        await page.locator('[data-cad-grading-group-tab="transition"]').click();
        await page.locator(joint).selectOption(String(world.uiRefuseJoint));
        const options = await page.locator(`${joint} option`).allTextContents();
        const hit = options.find((text) => text.startsWith(`joint:${world.uiRefuseJoint}`));
        expect(hit).toContain('singular sloped only');
        await expect(page.locator('[data-cad-grading-group-transition-add]')).toBeDisabled();
      }
      await shot(
        page,
        world.shot,
        world.groups[0]!.name,
        world.uiRefuseJoint === undefined ? undefined : '[data-cad-grading-group-transition-add]',
      );
    } finally {
      fs.rmSync(file, { force: true });
    }
  }
  expect(errors).toEqual([]);
});

// Flows 5 + 6: save/reopen persists the sloped intent; a source-Z edit
// (FLRAISELOWER +1 m) invalidates and recalc rebuilds CURRENT.
test('20Q1 Flow 56 save-reopen then source-Z rebuild', async ({ page }) => {
  const errors = await boot(page);
  const line = nextId('flq');
  const file = writeWorld({ [line]: UP }, [sloped1(line, 'QdistS', D5, D7, 'distance')]);
  try {
    await openSurveyPlanDrawing(page, file);
    await openGroupManager(page);
    await calculateSelected(page, 'QdistS');
    await expect(groupRowByName(page, 'QdistS')).toContainText('Current', { timeout: 60000 });
    const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
    await page.getByRole('button', { name: 'Save Drawing' }).first().click();
    const download = await downloadPromise;
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'wn-20q1-save-'));
    const savedPath = path.join(dir, 'drawing.wncad');
    await download.saveAs(savedPath);
    await openSurveyPlanDrawing(page, savedPath);
    await openGroupManager(page);
    await groupRowByName(page, 'QdistS').click();
    await page.locator('[data-cad-grading-group-tab="transition"]').click();
    const panel = page.locator('[data-cad-grading-group-transition-panel]');
    await expect(panel).toContainText('joint:0');
    await expect(panel).toContainText('8 m');
    await page.locator('[data-cad-grading-group-tab="definition"]').click();
    await calculateSelected(page, 'QdistS');
    await expect(groupRowByName(page, 'QdistS')).toContainText('Current', { timeout: 60000 });
    await shot(page, 'flow-5-save-reopen-current', 'QdistS');
    await page.locator(surveyTab).getByRole('tab', { name: 'Survey' }).click();
    await page.locator('button[title="Select this feature line."]').click();
    await expect.poll(() => selectionCount(page)).toBe(1);
    await homeTab(page);
    page.on('dialog', (dialog) => {
      if (dialog.type() === 'prompt') void dialog.accept('1');
    });
    await page.locator('[data-cad-feature-line="FLRAISELOWER"]').click();
    await openGroupManager(page);
    const row = groupRowByName(page, 'QdistS');
    await expect(row).not.toContainText('Current', { timeout: 30000 });
    await calculateSelected(page, 'QdistS');
    await expect(row).toContainText('Current', { timeout: 60000 });
    await expect(row).not.toContainText('Failed');
    await shot(page, 'flow-6-raised-rebuilt-current', 'QdistS');
    await fs.promises.rm(dir, { recursive: true, force: true });
  } finally {
    fs.rmSync(file, { force: true });
  }
  expect(errors).toEqual([]);
});

// Flow 10: Extract/Bake ride the sloped CURRENT result, one Undo each.
test('20Q1 Flow 10 sloped products truthful', async ({ page }) => {
  const errors = await boot(page);
  const line = nextId('flq');
  const file = writeWorld({ [line]: UP }, [sloped1(line, 'QdistP', D5, D7, 'distance')]);
  const surfaces = '[data-cad-toolspace] [data-cad-surface]';
  try {
    await openSurveyPlanDrawing(page, file);
    await openGroupManager(page);
    const row = groupRowByName(page, 'QdistP');
    await row.click();
    await expect(page.locator('[data-cad-grading-group-extract]')).toBeDisabled();
    await expect(page.locator('[data-cad-grading-group-bake]')).toBeDisabled();
    await calculateSelected(page, 'QdistP');
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
    await page.locator(surveyTab).getByRole('tab', { name: 'Survey' }).click();
    const surfacesBefore = await page.locator(surfaces).count();
    if (!(await page.locator('[data-cad-grading-group-table]').isVisible()))
      await openGroupManager(page);
    await row.click();
    await expect(page.locator('[data-cad-grading-group-bake]')).toBeEnabled({ timeout: 10000 });
    await page.locator('[data-cad-grading-group-bake]').click();
    await expect.poll(() => page.locator(surfaces).count()).toBe(surfacesBefore + 1);
    await homeTab(page);
    await page.locator('[data-cad-command="SHELL_UNDO"]').click();
    await expect.poll(() => page.locator(surfaces).count()).toBe(surfacesBefore);
    await expect(row).toContainText('Current');
    await shot(page, 'flow-10-products', 'QdistP');
  } finally {
    fs.rmSync(file, { force: true });
  }
  expect(errors).toEqual([]);
});
