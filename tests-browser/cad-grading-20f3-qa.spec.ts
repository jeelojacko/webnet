/**
 * Phase 20F.3 browser QA — truthful grading-group shell commands from snapshot
 * selection, driven through the REAL /cad shell on a production build in
 * headless Chromium. No mocks: every flow opens a seeded .wncad and drives
 * the live ribbon / manager / Toolspace / Properties / command dock.
 *
 * Flows:
 *   A  UNBUILT -> ONE ribbon Calc click -> BUILDING -> CURRENT. All setup
 *      (seeded drawing, Survey tab, group selected, Properties on group,
 *      manager row selected) happens BEFORE the click; after the click the
 *      test only observes (polls + screenshots, zero clicks).
 *   B  Closed distance group CURRENT -> Course 2 override 25/20 asymmetric
 *      analytic corner -> stale -> ribbon recalc -> FAILED
 *      CORNER_NO_SOLUTION / GRADING_ANALYTIC_CORNER_Z, stale retained,
 *      Extract/Bake disabled, diagnostic + Properties failure visible.
 *   C  Ribbon gates from snapshot selection: no-selection disabled; UNBUILT
 *      Calc enabled / Extract+Bake disabled; ribbon Calc builds the exact
 *      group only; CURRENT enables Extract+Bake; ribbon Extract adds exactly
 *      one feature line (one Undo removes); ribbon Bake adds exactly one
 *      explicit-TIN surface (one Undo removes). Plus one typed command
 *      route (GG opens the manager; GRADINGGROUPINQ fails closed empty).
 *   D  Cut/Fill composer defaults (2:1 / 3:1 valid) + reopened round-trip
 *      (2H:1V / 3H:1V, no clipping).
 * Shell §22 regression: ribbon one band <=130px, no page overflow, single
 * Properties palette + command input, flyout contained, panels scrollable.
 */
import { expect, test, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  createBlankCadDrawingDocument,
  parseCadDrawingFile,
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

const EVIDENCE = path.resolve(process.cwd(), 'docs/evidence/phase20f3');
fs.mkdirSync(EVIDENCE, { recursive: true });

const VIEWPORTS = [
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
] as const;

// ---------------------------------------------------------------------------
// seed world (same analytic families as the 20F.2 harness)
// ---------------------------------------------------------------------------

const fl = (id: string, pts: Array<[number, number, number]>, closed = false): CadFeatureLineEntity => ({
  id, type: 'feature-line', layerId: 'general', visible: true, locked: false, name: `FL ${id}`,
  vertices: pts.map(([x, y, z], i) => ({ id: `${id}:v${i}`, x, y, z })),
  ...(closed ? { closed: true } : {}),
});

const tin = (id: string, name: string): CadSurface => ({
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

const CHAIN_PTS: Array<[number, number, number]> = [[0, 0, 10], [100, 0, 10], [100, 100, 10]];
const SQUARE_PTS: Array<[number, number, number]> = [[0, 0, 10], [100, 0, 10], [100, 100, 10], [0, 100, 10]];

let seq = 0;
const nextId = (p: string): string => `${p}-20f3-${++seq}`;

interface Ids { chainId: string; squareId: string; targetId: string; }
interface GroupSeed {
  name: string; fl: 'chain' | 'square'; courses: Array<[number, number]>;
  criterion: CadGradingGroup['criterion']; closed?: boolean;
}

const writeWorld = (ids: Ids, groups: GroupSeed[], gradings: CadGrading[] = []): string => {
  const pick = (which: 'chain' | 'square'): string => (which === 'chain' ? ids.chainId : ids.squareId);
  const gradingGroups: CadGradingGroup[] = groups.map((g) => {
    const flId = pick(g.fl);
    return {
      id: nextId('grp'),
      name: g.name,
      sourceFeatureLineId: flId,
      sourceCourses: g.courses.map(([a, b]) => ({ vertexAId: `${flId}:v${a}`, vertexBId: `${flId}:v${b}` })),
      side: 'right',
      criterion: g.criterion,
      maxSearchDistance: 200,
      curveChordTolerance: 0.05,
      cornerMode: 'miter',
      ...(g.closed ? { closed: true as const } : {}),
    };
  });
  const project: CadProject = {
    ...createBlankCadDrawingDocument({ name: '20F.3 QA', units: 'm' }).project,
    entities: [fl(ids.chainId, CHAIN_PTS), fl(ids.squareId, SQUARE_PTS, true)],
    surfaces: [tin(ids.targetId, 'EG')],
    gradingGroups,
    gradings,
  };
  const file = path.join(os.tmpdir(), `wn-20f3-${Date.now()}-${Math.floor(Math.random() * 1e6)}.wncad`);
  fs.writeFileSync(file, serializeCadDrawingFile({ ...createBlankCadDrawingDocument({ name: 'q', units: 'm' }), project }), 'utf8');
  return file;
};

const freshIds = (): Ids => ({ chainId: nextId('fl-chain'), squareId: nextId('fl-square'), targetId: nextId('tgt') });
const DIST = { kind: 'distance', gradeRatio: -0.02, distance: 20 } as const;
const DIST25 = { kind: 'distance', gradeRatio: -0.5, distance: 25 } as const;

const readProject = (file: string): CadProject => {
  const parsed = parseCadDrawingFile(fs.readFileSync(file, 'utf8'));
  if (!parsed.ok) throw new Error(`seed unreadable: ${parsed.errors.join(', ')}`);
  return parsed.drawing.project;
};
const groupIdOfAt = (file: string, index: number): string => {
  const group = (readProject(file).gradingGroups ?? [])[index];
  if (!group) throw new Error(`seed group ${index} missing`);
  return group.id;
};

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

const ribbonGroupBtn = (page: Page, key: string) =>
  page.locator(`[data-cad-grading-group-command="${key}"]`);

const openGroupManager = async (page: Page): Promise<void> => {
  await homeTab(page);
  await ribbonGroupBtn(page, 'GRADINGGROUP').click();
  await expect(page.locator('[data-cad-grading-group-table]')).toBeVisible({ timeout: 15000 });
};

const openGradingManager = async (page: Page): Promise<void> => {
  await homeTab(page);
  await page.locator('[data-cad-grading-command="GRADING"]').click();
  await expect(page.locator('[data-cad-grading-table]')).toBeVisible({ timeout: 15000 });
};

const groupRow = (page: Page, id: string) => page.locator(`[data-cad-grading-group-row="${id}"]`);
const groupTree = (page: Page, id: string) =>
  page.locator(`[data-cad-toolspace] [data-cad-grading-group="${id}"] summary`);
const groupReason = (page: Page) => page.locator('[data-cad-grading-group-status-reason]');
const criteriaPanel = (page: Page) => page.locator('[data-cad-grading-group-criteria]');
const surfaceNodes = (page: Page) => page.locator('[data-cad-toolspace] [data-cad-surface]');

const toolspaceSurvey = async (page: Page): Promise<void> => {
  await page.locator('[aria-label="Toolspace tabs"]').getByRole('tab', { name: 'Survey' }).click();
};

const closeManager = async (page: Page, label: string): Promise<void> => {
  await page.locator(`section[aria-label="${label}"]`).getByRole('button', { name: 'Close' }).click();
  await expect(page.locator(`section[aria-label="${label}"]`)).toBeHidden({ timeout: 10000 });
};

const openGroupTab = async (page: Page, tab: 'definition' | 'criteria' | 'inquiry'): Promise<void> => {
  if (!(await page.locator('[data-cad-grading-group-table]').isVisible())) await openGroupManager(page);
  await page.locator(`[data-cad-grading-group-tab="${tab}"]`).click();
};

const undoOnce = async (page: Page): Promise<void> => {
  await homeTab(page);
  await page.locator('[data-cad-command="SHELL_UNDO"]').click();
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
    const groupButtons = Array.from(
      document.querySelectorAll('[data-cad-grading-group-command]'),
    ).map((el) => ({
      key: el.getAttribute('data-cad-grading-group-command'),
      disabled: (el as HTMLButtonElement).disabled,
    }));
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
      manager: box('section[aria-label="Grading group manager"]') ?? box('section[aria-label="Grading manager"]'),
      criteria: box('[data-cad-grading-group-criteria]'),
      groupButtons,
      toolspaceStatuses: Array.from(document.querySelectorAll('[data-cad-grading-group-status]'))
        .map((el) => el.getAttribute('data-cad-grading-group-status')),
      managerRows: Array.from(document.querySelectorAll('[data-cad-grading-group-row]'))
        .map((el) => (el.textContent ?? '').slice(0, 100)),
      propertiesStatus: document.querySelector('[data-cad-grading-group-status-reason]')?.textContent ?? null,
      entityCount: document.querySelector('[data-survey-cad-entity-count]')?.textContent ?? null,
      commandEcho: document.querySelector('.cad-shell-command-echo')?.textContent ?? null,
    };
  });
};

const shot = async (page: Page, name: string): Promise<void> => {
  await recordGeometry(page, name);
  await page.screenshot({ path: `${EVIDENCE}/${name}.png` });
};

// ===========================================================================
// Flow A — one ribbon Calc click, observe only (§16)
// ===========================================================================
for (const viewport of VIEWPORTS) {
  test(`20F.3 Flow A one-click ribbon Calc @ ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    await gotoCad(page, errors);
    const ids = freshIds();
    const file = writeWorld(ids, [
      { name: 'RibbonCalc', fl: 'chain', courses: [[0, 1], [1, 2]], criterion: { ...DIST } },
    ]);
    const group = groupIdOfAt(file, 0);
    const tag = `${viewport.width}`;
    try {
      await openSurveyPlanDrawing(page, file);
      // ---- setup BEFORE the click: manager row selected (snapshot
      // selection), Survey tab open, Properties on the group.
      await openGroupManager(page);
      await groupRow(page, group).click();
      await expect(groupRow(page, group)).toContainText('Unbuilt', { timeout: 15000 });
      // Group Properties renders only with zero drawing selection (palette
      // rule): clear it in setup, reopen the manager if the tab switch hid it.
      await homeTab(page);
      await page.locator('[data-cad-command="SHELL_CLEAR_SELECTION"]').click();
      await expect.poll(() => selectionCount(page)).toBe(0);
      if (!(await page.locator('[data-cad-grading-group-table]').isVisible())) await openGroupManager(page);
      await toolspaceSurvey(page);
      await expect(groupTree(page, group)).toHaveAttribute('data-cad-grading-group-status', 'UNBUILT');
      await expect(groupReason(page)).toContainText('Unbuilt', { timeout: 10000 });
      await expect(ribbonGroupBtn(page, 'GRADINGGROUPCALC')).toBeEnabled({ timeout: 10000 });

      // ---- the ONE click; everything below is observation (no clicks).
      await ribbonGroupBtn(page, 'GRADINGGROUPCALC').click();
      await expect(groupRow(page, group)).toContainText('Building', { timeout: 15000 });
      await expect(groupTree(page, group)).toHaveAttribute('data-cad-grading-group-status', 'BUILDING', { timeout: 15000 });
      await shot(page, `${tag}-live-building`);
      await expect(groupRow(page, group)).toContainText('Current', { timeout: 60000 });
      await expect(groupTree(page, group)).toHaveAttribute('data-cad-grading-group-status', 'CURRENT', { timeout: 15000 });
      await expect(groupReason(page)).toContainText('Current', { timeout: 15000 });
      await shot(page, `${tag}-live-current`);
    } finally {
      fs.rmSync(file, { force: true });
    }
    expect(errors).toEqual([]);
  });
}

// ===========================================================================
// Flow B — FAILED after stale, 25/20 analytic corner (§17)
// ===========================================================================
for (const viewport of VIEWPORTS) {
  test(`20F.3 Flow B FAILED after stale @ ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    await gotoCad(page, errors);
    const ids = freshIds();
    const file = writeWorld(ids, [{
      name: 'PadFail', fl: 'square', courses: [[0, 1], [1, 2], [2, 3], [3, 0]],
      criterion: { ...DIST25 }, closed: true,
    }]);
    const group = groupIdOfAt(file, 0);
    const tag = `${viewport.width}`;
    try {
      await openSurveyPlanDrawing(page, file);
      await openGroupManager(page);
      await groupRow(page, group).click();
      await ribbonGroupBtn(page, 'GRADINGGROUPCALC').click();
      await expect(groupRow(page, group)).toContainText('Current', { timeout: 60000 });
      await toolspaceSurvey(page);

      // Override Course 2: 25 -> 20 (asymmetric analytic corner).
      await openGroupTab(page, 'criteria');
      const panel = criteriaPanel(page);
      await expect(panel).toBeVisible({ timeout: 10000 });
      await panel.locator('[aria-label="Select Course 2"]').check();
      await panel.locator('[data-cad-grading-field="cad-grading-group-criteria-distance"]').fill('20');
      await panel.locator('[data-cad-grading-group-criteria-apply-selected]').click();
      await expect(page.locator('[data-cad-grading-group-notice]')).toContainText('overridden', { timeout: 10000 });
      await openGroupTab(page, 'definition');
      await groupRow(page, group).click();
      await expect(groupRow(page, group)).toContainText('Needs Recalc', { timeout: 15000 });
      await expect(groupRow(page, group)).toContainText('(stale)');

      // Ribbon recalc fails closed.
      await ribbonGroupBtn(page, 'GRADINGGROUPCALC').click();
      await expect(groupRow(page, group)).toContainText('Failed', { timeout: 60000 });
      await expect(groupRow(page, group)).toContainText('CORNER_NO_SOLUTION');
      await expect(groupRow(page, group)).toContainText('(stale)');
      await expect(groupTree(page, group)).toHaveAttribute('data-cad-grading-group-status', 'FAILED', { timeout: 10000 });
      await expect(ribbonGroupBtn(page, 'GRADINGGROUPEXTRACTDAYLIGHT')).toBeDisabled();
      await expect(ribbonGroupBtn(page, 'GRADINGGROUPBAKE')).toBeDisabled();
      await expect(page.locator('[data-cad-grading-group-extract]')).toBeDisabled();
      await expect(page.locator('[data-cad-grading-group-bake]')).toBeDisabled();
      await expect(groupRow(page, group)).not.toContainText('Current');
      // Capture the FAILED state itself: the Status column sits off the 480px
      // table's right edge (horizontal table scroller) and the row's disabled
      // Extract/Bake live below the table in the manager's vertical scroller.
      // Same scrollIntoViewIfNeeded technique as the toolspace-properties
      // frame below, applied to the manager's own scrollers.
      await groupRow(page, group).locator('td').nth(6).scrollIntoViewIfNeeded();
      await page
        .locator(`[data-cad-grading-group-actions="${group}"] [data-cad-grading-group-bake]`)
        .scrollIntoViewIfNeeded();
      await shot(page, `${tag}-failed-manager`);

      // Toolspace diagnostic + Properties failure, scrolled into frame.
      const diagnostic = page.locator(`[data-cad-grading-group-diagnostic="${group}"]`);
      await expect(diagnostic).toContainText('GRADING_ANALYTIC_CORNER_Z');
      await closeManager(page, 'Grading group manager');
      await homeTab(page);
      await page.locator('[data-cad-command="SHELL_CLEAR_SELECTION"]').click();
      await expect.poll(() => selectionCount(page)).toBe(0);
      await toolspaceSurvey(page);
      await diagnostic.scrollIntoViewIfNeeded();
      await groupTree(page, group).scrollIntoViewIfNeeded();
      await expect(groupReason(page)).toContainText('Failed', { timeout: 10000 });
      await expect(groupReason(page)).toContainText('CORNER_NO_SOLUTION');
      await shot(page, `${tag}-failed-toolspace-properties`);
    } finally {
      fs.rmSync(file, { force: true });
    }
    expect(errors).toEqual([]);
  });
}

// ===========================================================================
// Flow C — ribbon gates + Extract/Bake products + one Undo each (§18)
// ===========================================================================
for (const viewport of VIEWPORTS) {
  test(`20F.3 Flow C ribbon gates + products @ ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    await gotoCad(page, errors);
    const ids = freshIds();
    const file = writeWorld(ids, [
      { name: 'GateA', fl: 'chain', courses: [[0, 1], [1, 2]], criterion: { ...DIST } },
      { name: 'GateB', fl: 'chain', courses: [[0, 1], [1, 2]], criterion: { ...DIST } },
    ]);
    const groupA = groupIdOfAt(file, 0);
    const groupB = groupIdOfAt(file, 1);
    const tag = `${viewport.width}`;
    try {
      await openSurveyPlanDrawing(page, file);
      await homeTab(page);

      // No selection: selection-driven ribbon keys fail closed.
      await expect(ribbonGroupBtn(page, 'GRADINGGROUPCALC')).toBeDisabled();
      await expect(ribbonGroupBtn(page, 'GRADINGGROUPINQUIRY')).toBeDisabled();
      await expect(ribbonGroupBtn(page, 'GRADINGGROUPEXTRACTDAYLIGHT')).toBeDisabled();
      await expect(ribbonGroupBtn(page, 'GRADINGGROUPBAKE')).toBeDisabled();
      await expect(ribbonGroupBtn(page, 'GRADEGROUP')).toBeEnabled();
      await expect(ribbonGroupBtn(page, 'GRADINGGROUP')).toBeEnabled();

      // Select UNBUILT group A: Calc enabled, Extract+Bake disabled.
      await openGroupManager(page);
      await groupRow(page, groupA).click();
      await expect(groupRow(page, groupA)).toContainText('Unbuilt', { timeout: 15000 });
      await expect(ribbonGroupBtn(page, 'GRADINGGROUPCALC')).toBeEnabled({ timeout: 10000 });
      await expect(ribbonGroupBtn(page, 'GRADINGGROUPEXTRACTDAYLIGHT')).toBeDisabled();
      await expect(ribbonGroupBtn(page, 'GRADINGGROUPBAKE')).toBeDisabled();
      await toolspaceSurvey(page);
      await shot(page, `${tag}-ribbon-unbuilt`);

      // Ribbon Calc builds the exact group only.
      await ribbonGroupBtn(page, 'GRADINGGROUPCALC').click();
      await expect(groupRow(page, groupA)).toContainText('Building', { timeout: 15000 });
      await expect(groupRow(page, groupA)).toContainText('Current', { timeout: 60000 });
      await expect(groupTree(page, groupA)).toHaveAttribute('data-cad-grading-group-status', 'CURRENT', { timeout: 15000 });
      await expect(groupTree(page, groupB)).toHaveAttribute('data-cad-grading-group-status', 'UNBUILT');
      await expect(groupRow(page, groupB)).toContainText('Unbuilt');
      await expect(ribbonGroupBtn(page, 'GRADINGGROUPEXTRACTDAYLIGHT')).toBeEnabled({ timeout: 10000 });
      await expect(ribbonGroupBtn(page, 'GRADINGGROUPBAKE')).toBeEnabled({ timeout: 10000 });
      await shot(page, `${tag}-ribbon-current`);

      // Ribbon Extract: exactly one snapshot feature line; one Undo removes.
      const entitiesBefore = await entityCount(page);
      await ribbonGroupBtn(page, 'GRADINGGROUPEXTRACTDAYLIGHT').click();
      await expect.poll(() => entityCount(page)).toBe(entitiesBefore + 1);
      await shot(page, `${tag}-ribbon-extract`);
      await undoOnce(page);
      await expect.poll(() => entityCount(page)).toBe(entitiesBefore);
      await expect(groupRow(page, groupA)).toContainText('Current');

      // Ribbon Bake: exactly one explicit-TIN surface; one Undo removes.
      await toolspaceSurvey(page);
      const surfacesBefore = await surfaceNodes(page).count();
      await ribbonGroupBtn(page, 'GRADINGGROUPBAKE').click();
      await expect.poll(() => surfaceNodes(page).count()).toBe(surfacesBefore + 1);
      await shot(page, `${tag}-ribbon-bake`);
      await undoOnce(page);
      await expect.poll(() => surfaceNodes(page).count()).toBe(surfacesBefore);
      await expect(groupRow(page, groupA)).toContainText('Current');
    } finally {
      fs.rmSync(file, { force: true });
    }
    expect(errors).toEqual([]);
  });
}

// ===========================================================================
// Typed command / registry route (one route, 1366)
// ===========================================================================
test('20F.3 typed command route GG opens manager, INQ fails closed empty', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const errors: string[] = [];
  await gotoCad(page, errors);
  const ids = freshIds();
  const file = writeWorld(ids, [
    { name: 'TypedA', fl: 'chain', courses: [[0, 1], [1, 2]], criterion: { ...DIST } },
  ]);
  try {
    await openSurveyPlanDrawing(page, file);
    await homeTab(page);
    const input = page.locator('[data-cad-command-input]');
    await expect(input).toBeVisible({ timeout: 10000 });

    // No selection: typed inquiry fails closed (never a dead tab).
    await input.fill('GRADINGGROUPINQ');
    await input.press('Enter');
    await expect(page.locator('.cad-shell-command-echo')).toContainText('unavailable', { timeout: 10000 });
    await expect(page.locator('[data-cad-grading-group-table]')).toBeHidden();

    // Typed GG opens the manager definition tab (the one creation UI).
    await input.fill('GG');
    await input.press('Enter');
    await expect(page.locator('[data-cad-grading-group-table]')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[data-cad-grading-group-tab="definition"]')).toBeVisible();
  } finally {
    fs.rmSync(file, { force: true });
  }
  expect(errors).toEqual([]);
});

// ===========================================================================
// Flow D — Cut/Fill defaults + reopen round-trip (§19)
// ===========================================================================
const rebuildSurface = async (page: Page, surfaceId: string): Promise<void> => {
  await page.locator('[aria-label="Ribbon tabs"]').getByRole('tab', { name: 'Surface' }).click();
  await page.getByRole('button', { name: 'Add Point Group' }).first().click();
  const manager = page.locator('section[aria-label="Surface manager"]');
  await expect(manager).toBeVisible({ timeout: 10000 });
  await manager.locator('ul button', { hasText: 'EG' }).click();
  await manager.getByRole('button', { name: 'Rebuild', exact: true }).click();
  await page.locator('[aria-label="Toolspace tabs"]').getByRole('tab', { name: 'Survey' }).click();
  const surface = page.locator(`[data-cad-toolspace] [data-cad-surface="${surfaceId}"]`);
  await expect(surface).toBeVisible({ timeout: 15000 });
  await expect
    .poll(() => surface.getAttribute('data-cad-surface-status'), { timeout: 60000 })
    .toBe('CURRENT');
};

for (const viewport of VIEWPORTS) {
  test(`20F.3 Flow D Cut/Fill defaults @ ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    await gotoCad(page, errors);
    const ids = freshIds();
    const file = writeWorld(ids, [], [{
      id: nextId('grad'), name: 'EnableManager', sourceFeatureLineId: ids.chainId,
      sourceCourse: { vertexAId: `${ids.chainId}:v0`, vertexBId: `${ids.chainId}:v1` },
      side: 'right', criterion: { ...DIST }, maxSearchDistance: 200, curveChordTolerance: 0.05,
    } as CadGrading]);
    const tag = `${viewport.width}`;
    try {
      await openSurveyPlanDrawing(page, file);
      await rebuildSurface(page, ids.targetId);
      await openGradingManager(page);

      await page.locator('[data-cad-grading-create] [aria-label="New grading name"]').fill('CutFillDF');
      const kind = page.locator('[data-cad-grading-create] [aria-label="Criterion kind"]');
      await kind.selectOption('cut-fill');
      await expect(page.locator('[data-cad-grading-create] [aria-label="Cut ratio"]')).toHaveValue('2:1');
      await expect(page.locator('[data-cad-grading-create] [aria-label="Fill ratio"]')).toHaveValue('3:1');
      const summary = page.locator('[data-cad-grading-create] [data-cad-grading-criterion-summary]');
      await expect(summary).toContainText('Cut');
      await expect(summary).not.toContainText('invalid');
      await shot(page, `${tag}-cutfill-defaults`);

      await page.locator('[data-cad-grading-create-submit]').click();
      await expect(page.locator('[data-cad-grading-notice]')).toContainText('Created', { timeout: 10000 });

      const row = page.locator('[data-cad-grading-row]', { hasText: 'CutFillDF' }).first();
      await row.click();
      await page.locator('[data-cad-grading-edit-criteria]').click();
      const edit = page.locator('[data-cad-grading-edit-panel]');
      await expect(edit).toBeVisible({ timeout: 10000 });
      await expect(edit.locator('[aria-label="Cut ratio"]')).toHaveValue('2H:1V');
      await expect(edit.locator('[aria-label="Fill ratio"]')).toHaveValue('3H:1V');
      await expect(edit.locator('[data-cad-grading-criterion-summary]')).toContainText('Cut');
      await expect(edit.locator('[data-cad-grading-criterion-summary]')).not.toContainText('invalid');
      const clipped = await edit.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return r.right > window.innerWidth + 1 || r.left < -1;
      });
      expect(clipped).toBe(false);
      await shot(page, `${tag}-cutfill-reopened`);
    } finally {
      fs.rmSync(file, { force: true });
    }
    expect(errors).toEqual([]);
  });
}

// ===========================================================================
// §22 shell regression (per resolution)
// ===========================================================================
for (const viewport of VIEWPORTS) {
  test(`20F.3 §22 shell regression @ ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    await gotoCad(page, errors);
    const ids = freshIds();
    const file = writeWorld(ids, [
      { name: 'ShellA', fl: 'chain', courses: [[0, 1], [1, 2]], criterion: { ...DIST } },
    ]);
    try {
      await openSurveyPlanDrawing(page, file);
      await homeTab(page);

      const shell = await page.evaluate(() => {
        const ribbon = document.querySelector('[data-cad-ribbon]') as HTMLElement | null;
        const groups = document.querySelector('.cad-shell-ribbon-groups') as HTMLElement | null;
        const viewportEl = document.querySelector('[data-cad-viewport]') as HTMLElement | null;
        const toolspace = document.querySelector('[data-cad-toolspace]') as HTMLElement | null;
        const cs = (el: Element | null, prop: string): string =>
          el == null ? 'missing' : getComputedStyle(el).getPropertyValue(prop);
        const svg = viewportEl?.querySelector('svg') != null;
        const canvas = viewportEl?.querySelector('canvas') != null;
        return {
          ribbonH: ribbon?.getBoundingClientRect().height ?? -1,
          ribbonOverflowY: cs(ribbon, 'overflow-y'),
          ribbonWrap: groups ? cs(groups, 'flex-wrap') : 'missing',
          groupsOverflowX: cs(groups, 'overflow-x'),
          docScrollW: document.documentElement.scrollWidth,
          docScrollH: document.documentElement.scrollHeight,
          innerW: window.innerWidth,
          innerH: window.innerHeight,
          propertiesCount: document.querySelectorAll('[data-cad-properties]').length,
          commandInputCount: document.querySelectorAll('[data-cad-command-input]').length,
          viewportBox: viewportEl == null ? null : viewportEl.getBoundingClientRect().toJSON(),
          viewportBg: viewportEl ? cs(viewportEl, 'background-color') : 'missing',
          modelPresent: svg || canvas,
          toolspaceScrollable: toolspace ? toolspace.scrollHeight >= toolspace.clientHeight : false,
        };
      });
      console.log(`20F3 SHELL ${viewport.width}: ` + JSON.stringify(shell));
      expect(shell.ribbonH).toBeLessThanOrEqual(130);
      expect(['auto', 'scroll']).not.toContain(shell.ribbonOverflowY);
      expect(shell.propertiesCount).toBe(1);
      expect(shell.commandInputCount).toBe(1);
      expect(shell.docScrollH).toBeLessThanOrEqual(shell.innerH + 1);
      expect(shell.docScrollW).toBeLessThanOrEqual(shell.innerW + 1);
      expect(shell.viewportBox).not.toBeNull();
      expect(shell.viewportBox!.height).toBeGreaterThan(300);
      expect(shell.viewportBox!.width).toBeGreaterThan(600);
      expect(shell.modelPresent).toBe(true);

      // Manager open: scrollable internally, no page overflow, contained.
      await openGroupManager(page);
      const mgr = await page.evaluate(() => {
        const el = document.querySelector('section[aria-label="Grading group manager"]') as HTMLElement | null;
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return {
          x: r.x, y: r.y, w: r.width, h: r.height,
          scrollH: el.scrollHeight, clientH: el.clientHeight,
          right: r.right, bottom: r.bottom,
          innerW: window.innerWidth, innerH: window.innerHeight,
        };
      });
      expect(mgr).not.toBeNull();
      expect(mgr!.right).toBeLessThanOrEqual(mgr!.innerW + 1);
      expect(mgr!.bottom).toBeLessThanOrEqual(mgr!.innerH + 1);
      await shot(page, `${viewport.width}-shell`);

      // Flyout contained in viewport.
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
