/**
 * Phase 20F.2 browser QA — grading session sync, FAILED truthfulness, and
 * Cut/Fill composer defaults, driven through the REAL /cad shell in
 * production Chromium. No mocks: every flow opens a seeded .wncad, drives the
 * live ribbon/manager/criteria UI, and pins zero page/console errors.
 * Screenshots land under docs/evidence/phase20f2/.
 *
 * Flows:
 *   A  live chrome refresh — UNBUILT -> Calculate -> BUILDING -> CURRENT in
 *      Manager, Toolspace and Properties with NO synthetic refresh command;
 *      the same for a standalone grading.
 *   B  FAILED after stale — analytic group CURRENT -> override -> NEEDS_RECALC
 *      -> recalc with an incompatible analytic corner (25/20, nonzero grade)
 *      -> FAILED (stale), reason visible, Bake/Extract disabled, no promotion.
 *   C  edit-while-building — delayed worker keeps BUILDING observable; a
 *      definition edit retires the pending run promptly, never auto-recalcs,
 *      and the late result never becomes CURRENT.
 *   D  Cut/Fill defaults — untouched 2:1 / 3:1 compose a valid criterion,
 *      Apply/Create proceeds, and a re-opened cut/fill criterion stays valid.
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
  annotateTab,
  canvasClick,
  gotoCad,
  homeTab,
  openSurveyPlanDrawing,
  selectAll,
  selectionCount,
  writeSurveyPlanFixture,
} from './cad-survey-plan-19a-helpers';

const EVIDENCE = path.resolve(process.cwd(), 'docs/evidence/phase20f2');
fs.mkdirSync(EVIDENCE, { recursive: true });

const VIEWPORTS = [
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
] as const;

let seq = 0;
const nextId = (p: string): string => `${p}-20f2-${++seq}`;

// ---------------------------------------------------------------------------
// seed world
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

interface Ids { chainId: string; squareId: string; targetId: string; }
interface GroupSeed {
  name: string; fl: 'chain' | 'square'; courses: Array<[number, number]>;
  criterion: CadGradingGroup['criterion']; closed?: boolean;
}
interface GradingSeed {
  name: string; fl: 'chain' | 'square'; course: [number, number]; criterion: CadGrading['criterion'];
  side?: CadGrading['side'];
}

const writeWorld = (ids: Ids, groups: GroupSeed[], gradings: GradingSeed[] = []): string => {
  const pick = (which: 'chain' | 'square'): string => (which === 'chain' ? ids.chainId : ids.squareId);
  const gradingGroups: CadGradingGroup[] = groups.map((g) => {
    const flId = pick(g.fl);
    return {
      id: nextId('grp'),
      name: g.name,
      sourceFeatureLineId: flId,
      sourceCourses: g.courses.map(([a, b]) => ({ vertexAId: `${flId}:v${a}`, vertexBId: `${flId}:v${b}` })),
      ...(g.criterion.kind === 'fixed' || g.criterion.kind === 'cut-fill'
        ? { targetSurfaceId: ids.targetId } : {}),
      side: 'right',
      criterion: g.criterion,
      maxSearchDistance: 200,
      curveChordTolerance: 0.05,
      cornerMode: 'miter',
      ...(g.closed ? { closed: true as const } : {}),
    };
  });
  const standaloneGradings: CadGrading[] = gradings.map((g) => {
    const flId = pick(g.fl);
    return {
      id: nextId('grad'),
      name: g.name,
      sourceFeatureLineId: flId,
      sourceCourse: { vertexAId: `${flId}:v${g.course[0]}`, vertexBId: `${flId}:v${g.course[1]}` },
      side: g.side ?? 'right',
      criterion: g.criterion,
      maxSearchDistance: 200,
      curveChordTolerance: 0.05,
    };
  });
  const project: CadProject = {
    ...createBlankCadDrawingDocument({ name: '20F.2 QA', units: 'm' }).project,
    entities: [fl(ids.chainId, CHAIN_PTS), fl(ids.squareId, SQUARE_PTS, true)],
    surfaces: [tin(ids.targetId, 'EG')],
    gradingGroups,
    gradings: standaloneGradings,
  };
  const file = path.join(os.tmpdir(), `wn-20f2-${Date.now()}-${Math.floor(Math.random() * 1e6)}.wncad`);
  fs.writeFileSync(file, serializeCadDrawingFile({ ...createBlankCadDrawingDocument({ name: 'q', units: 'm' }), project }), 'utf8');
  return file;
};

const freshIds = (): Ids => ({ chainId: nextId('fl-chain'), squareId: nextId('fl-square'), targetId: nextId('tgt') });

const DIST = { kind: 'distance', gradeRatio: -0.02, distance: 20 } as const;
const DIST25 = { kind: 'distance', gradeRatio: -0.5, distance: 25 } as const;
const SURF = { kind: 'fixed', gradeRatio: -0.5 } as const;
const ELEV = { kind: 'elevation', gradeRatio: -0.02, targetElevation: 9.8 } as const;

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

const openGroupManager = async (page: Page): Promise<void> => {
  await homeTab(page);
  await page.locator('[data-cad-grading-group-command="GRADINGGROUP"]').click();
  await expect(page.locator('[data-cad-grading-group-table]')).toBeVisible({ timeout: 15000 });
};

const openGradingManager = async (page: Page): Promise<void> => {
  await homeTab(page);
  await page.locator('[data-cad-grading-command="GRADING"]').click();
  await expect(page.locator('[data-cad-grading-table]')).toBeVisible({ timeout: 15000 });
};

const groupRow = (page: Page, id: string) => page.locator(`[data-cad-grading-group-row="${id}"]`);
const gradingRow = (page: Page, id: string) => page.locator(`[data-cad-grading-row="${id}"]`);
const groupTree = (page: Page, id: string) =>
  page.locator(`[data-cad-toolspace] [data-cad-grading-group="${id}"] summary`);
const gradingTree = (page: Page, id: string) =>
  page.locator(`[data-cad-toolspace] [data-cad-grading="${id}"] summary`);

const openGroupTab = async (page: Page, tab: 'definition' | 'criteria' | 'inquiry'): Promise<void> => {
  if (!(await page.locator('[data-cad-grading-group-table]').isVisible())) await openGroupManager(page);
  await page.locator(`[data-cad-grading-group-tab="${tab}"]`).click();
};

const calculateGroupAndWaitCurrent = async (page: Page, id: string): Promise<void> => {
  await groupRow(page, id).click();
  await expect(page.locator('[data-cad-grading-group-calculate]')).toBeEnabled({ timeout: 15000 });
  await page.locator('[data-cad-grading-group-calculate]').click();
  await expect(groupRow(page, id)).toContainText('Current', { timeout: 60000 });
};

const criteriaPanel = (page: Page) => page.locator('[data-cad-grading-group-criteria]');

/**
 * Objective per-screenshot geometry. The harness has no vision model, so each
 * capture is accompanied by the live DOM boxes/scroll metrics of every shell
 * region that matters (ribbon, viewport, Toolspace, Properties, command dock,
 * manager, criteria panel) plus document overflow.
 */
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
    const statuses = Array.from(document.querySelectorAll('[data-cad-grading-group-status]'))
      .map((el) => el.getAttribute('data-cad-grading-group-status'));
    const rows = Array.from(document.querySelectorAll('[data-cad-grading-group-row]'))
      .map((el) => (el.textContent ?? '').slice(0, 90));
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
      toolspaceStatuses: statuses,
      managerRows: rows,
      propertiesStatus: document.querySelector('[data-cad-grading-group-status-reason]')?.textContent ?? null,
    };
  });
};

const shot = async (page: Page, name: string): Promise<void> => {
  await recordGeometry(page, name);
  await page.screenshot({ path: `${EVIDENCE}/${name}.png` });
};

/** Grading nodes live under the Toolspace Survey tab (Prospector is summary-only). */
const toolspaceSurvey = async (page: Page): Promise<void> => {
  await page.locator('[aria-label="Toolspace tabs"]').getByRole('tab', { name: 'Survey' }).click();
};

const closeManager = async (page: Page, label: string): Promise<void> => {
  await page.locator(`section[aria-label="${label}"]`).getByRole('button', { name: 'Close' }).click();
  await expect(page.locator(`section[aria-label="${label}"]`)).toBeHidden({ timeout: 10000 });
};

/**
 * Artificial worker latency for grading ops only. The initial `postMessage`
 * is held in-page so the service's BUILDING window stays observable; `cancel`
 * still posts immediately and the delayed request is dropped by the worker.
 * `Worker.prototype.postMessage` is patched before the app boots.
 */
const installGradingDelay = async (page: Page): Promise<void> => {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__wnGradingDelayMs = 0;
    try {
      const proto = Worker.prototype as unknown as { postMessage: (..._args: unknown[]) => unknown };
      const orig = proto.postMessage;
      proto.postMessage = function (this: Worker, message: unknown, ...rest: unknown[]): unknown {
        const delay = Number(w.__wnGradingDelayMs ?? 0);
        const type = (message as { type?: string } | null)?.type;
        if (delay > 0 && (type === 'grading' || type === 'group-grading')) {
          return new Promise<void>((resolve) => setTimeout(resolve, delay)).then(() =>
            orig.apply(this, [message, ...rest]),
          );
        }
        return orig.apply(this, [message, ...rest]);
      };
    } catch {
      /* prototype patch unavailable — flows fall back to fast workers */
    }
  });
};

const setGradingDelay = async (page: Page, ms: number): Promise<void> => {
  await page.evaluate((value) => {
    (window as unknown as Record<string, unknown>).__wnGradingDelayMs = value;
  }, ms);
};

/** Rebuild the seeded EG surface through the shipped Surface manager. */
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

// ===========================================================================
// §34 shell contract — one band, no page overflow, single palettes, flyout
// ===========================================================================
for (const viewport of VIEWPORTS) {
  test(`20F.2 §34 shell contract @ ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    await gotoCad(page, errors);
    const { file } = (() => {
      const ids = freshIds();
      return { file: writeWorld(ids, [], []) };
    })();
    try {
      await openSurveyPlanDrawing(page, file);

      const shell = await page.evaluate(() => {
        const ribbon = document.querySelector('[data-cad-ribbon]') as HTMLElement | null;
        const groups = document.querySelector('.cad-shell-ribbon-groups') as HTMLElement | null;
        const viewportEl = document.querySelector('[data-cad-viewport]') as HTMLElement | null;
        const cs = (el: Element | null, prop: string): string =>
          el == null ? 'missing' : getComputedStyle(el).getPropertyValue(prop);
        return {
          ribbonH: ribbon?.getBoundingClientRect().height ?? -1,
          ribbonOverflowY: cs(ribbon, 'overflow-y'),
          groupsOverflowX: cs(groups, 'overflow-x'),
          docScrollW: document.documentElement.scrollWidth,
          docScrollH: document.documentElement.scrollHeight,
          bodyScrollW: document.body.scrollWidth,
          bodyScrollH: document.body.scrollHeight,
          innerW: window.innerWidth,
          innerH: window.innerHeight,
          propertiesCount: document.querySelectorAll('[data-cad-properties]').length,
          commandInputCount: document.querySelectorAll('[data-cad-command-input]').length,
          viewportBox: viewportEl == null ? null : viewportEl.getBoundingClientRect().toJSON(),
        };
      });
      console.log(`20F2 SHELL ${viewport.width}: ` + JSON.stringify(shell));
      expect(shell.ribbonH).toBeLessThanOrEqual(130);
      expect(['auto', 'scroll']).not.toContain(shell.ribbonOverflowY);
      expect(shell.propertiesCount).toBe(1);
      expect(shell.commandInputCount).toBe(1);
      expect(shell.docScrollH).toBeLessThanOrEqual(shell.innerH + 1);
      expect(shell.docScrollW).toBeLessThanOrEqual(shell.innerW + 1);
      expect(shell.bodyScrollH).toBeLessThanOrEqual(shell.innerH + 1);
      expect(shell.viewportBox).not.toBeNull();
      expect(shell.viewportBox!.height).toBeGreaterThan(300);
      expect(shell.viewportBox!.width).toBeGreaterThan(600);

      // Flyout must open fully inside the viewport (observer-recorded geometry).
      await page.evaluate(() => {
        const w = window as unknown as Record<string, unknown>;
        w.__flyoutBox = null;
        const take = (): void => {
          if (w.__flyoutBox != null) return;
          const el = document.querySelector('[data-cad-ribbon-flyout="arc"]');
          if (el == null) return;
          const box = el.getBoundingClientRect();
          if (box.width === 0 && box.height === 0) return;
          w.__flyoutBox = { x: box.x, y: box.y, width: box.width, height: box.height };
        };
        const ob = new MutationObserver(take);
        ob.observe(document.body, { childList: true, subtree: true });
        w.__flyoutOb = ob;
        take();
      });
      await page.locator('[data-cad-family-caret="arc"]').click({ force: true, timeout: 10000 });
      await shot(page, `${viewport.width}-ribbon-flyout`);
      await expect.poll(
        async () => page.evaluate(() => (window as unknown as Record<string, unknown>).__flyoutBox != null),
        { timeout: 10000 },
      ).toBe(true);
      const flyout = await page.evaluate(() => ({
        box: (window as unknown as Record<string, { x: number; y: number; width: number; height: number } | null>).__flyoutBox!,
        innerW: window.innerWidth,
        innerH: window.innerHeight,
      }));
      console.log(`20F2 FLYOUT ${viewport.width}: ` + JSON.stringify(flyout));
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

// ===========================================================================
// Flow A — live chrome refresh (Manager + Toolspace + Properties)
// ===========================================================================
for (const viewport of VIEWPORTS) {
  test(`20F.2 Flow A live chrome refresh @ ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    await installGradingDelay(page);
    await gotoCad(page, errors);
    const ids = freshIds();
    const file = writeWorld(
      ids,
      [
        { name: 'DistSync', fl: 'chain', courses: [[0, 1], [1, 2]], criterion: { ...DIST } },
        { name: 'SurfSync', fl: 'square', courses: [[0, 1], [1, 2], [2, 3], [3, 0]], criterion: { ...SURF }, closed: true },
        { name: 'ElevSync', fl: 'chain', courses: [[0, 1], [1, 2]], criterion: { ...ELEV } },
      ],
      [{ name: 'StandDist', fl: 'chain', course: [0, 1], criterion: { ...DIST } }],
    );
    const group = groupIdOf(file);
    const surfaceGroup = groupIdOfAt(file, 1);
    const elevationGroup = groupIdOfAt(file, 2);
    const tag = `${viewport.width}`;
    try {
      await openSurveyPlanDrawing(page, file);
      await openGroupManager(page);
      await groupRow(page, group).click();
      await expect(groupRow(page, group)).toContainText('Unbuilt', { timeout: 15000 });
      await toolspaceSurvey(page);
      await expect(groupTree(page, group)).toHaveAttribute('data-cad-grading-group-status', 'UNBUILT');
      await shot(page, `${tag}-unbuilt`);

      // --- Manager-driven Calculate, BUILDING held by the delayed worker.
      await setGradingDelay(page, 3500);
      await page.locator('[data-cad-grading-group-calculate]').click();
      await expect(groupRow(page, group)).toContainText('Building', { timeout: 10000 });
      await expect(groupTree(page, group)).toHaveAttribute('data-cad-grading-group-status', 'BUILDING', { timeout: 10000 });
      await shot(page, `${tag}-building`);

      // --- Properties auto-sync: close the manager while BUILDING, then read
      // the in-flight and finished status without any synthetic refresh.
      await closeManager(page, 'Grading group manager');
      await homeTab(page);
      await page.locator('[data-cad-command="SHELL_CLEAR_SELECTION"]').click();
      const reason = page.locator('[data-cad-grading-group-status-reason]');
      await expect(reason).toContainText('Building', { timeout: 10000 });
      await expect(reason).toContainText('Current', { timeout: 30000 });
      await expect(groupTree(page, group)).toHaveAttribute('data-cad-grading-group-status', 'CURRENT', { timeout: 10000 });
      await shot(page, `${tag}-properties-current`);

      // --- Manager carries the same CURRENT result (reopened, no refresh).
      await openGroupManager(page);
      await groupRow(page, group).click();
      await expect(groupRow(page, group)).toContainText('Current', { timeout: 15000 });
      await shot(page, `${tag}-current-toolspace-sync`);

      // --- Standalone grading auto-sync.
      await openGradingManager(page);
      const stand = gradingIdOf(file);
      await gradingRow(page, stand).click();
      await expect(gradingRow(page, stand)).toContainText('Unbuilt', { timeout: 15000 });
      await setGradingDelay(page, 2200);
      await page.locator('[data-cad-grading-calculate]').click();
      await expect(gradingRow(page, stand)).toContainText('Building', { timeout: 10000 });
      await expect(gradingTree(page, stand)).toHaveAttribute('data-cad-grading-status', 'BUILDING', { timeout: 10000 });
      await expect(gradingRow(page, stand)).toContainText('Current', { timeout: 30000 });
      await expect(gradingTree(page, stand)).toHaveAttribute('data-cad-grading-status', 'CURRENT', { timeout: 10000 });
      await shot(page, `${tag}-standalone-current`);
      await closeManager(page, 'Grading manager');

      // --- Composer family controls (locked family + distance/elevation + surface).
      await openGroupTab(page, 'criteria');
      await groupRow(page, group).click();
      await expect(criteriaPanel(page)).toBeVisible({ timeout: 10000 });
      await expect(page.locator('[data-cad-grading-field="cad-grading-group-criteria-method-locked"]')).toContainText('Distance');
      await criteriaPanel(page).scrollIntoViewIfNeeded();
      await page.waitForTimeout(200);
      await shot(page, `${tag}-locked-family-editor`);
      await shot(page, `${tag}-distance-elevation-control`);

      await groupRow(page, elevationGroup).click();
      await expect(criteriaPanel(page)).toBeVisible({ timeout: 10000 });
      await expect(page.locator('[data-cad-grading-field="cad-grading-group-criteria-method-locked"]')).toContainText('Elevation');
      await shot(page, `${tag}-elevation-control`);

      await groupRow(page, surfaceGroup).click();
      await expect(criteriaPanel(page)).toBeVisible({ timeout: 10000 });
      await expect(page.locator('[data-cad-grading-field="cad-grading-group-criteria-method-locked"]')).toContainText('Surface');
      await expect(page.locator('[data-cad-grading-group-criteria] [aria-label="Criterion kind"]')).toBeVisible();
      await shot(page, `${tag}-surface-control`);
    } finally {
      fs.rmSync(file, { force: true });
    }
    expect(errors).toEqual([]);
  });
}

// ===========================================================================
// Flow B — FAILED after stale (analytic corner 25/20, nonzero grade)
// ===========================================================================
for (const viewport of VIEWPORTS) {
  test(`20F.2 Flow B FAILED after stale @ ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    await gotoCad(page, errors);
    const ids = freshIds();
    const file = writeWorld(ids, [{
      name: 'PadFail', fl: 'square', courses: [[0, 1], [1, 2], [2, 3], [3, 0]],
      criterion: { ...DIST25 }, closed: true,
    }]);
    const group = groupIdOf(file);
    const tag = `${viewport.width}`;
    try {
      await openSurveyPlanDrawing(page, file);
      await openGroupManager(page);
      await calculateGroupAndWaitCurrent(page, group);
      await toolspaceSurvey(page);

      // Override Course 2 to 20 -> 25/20 nonzero grade; revision moves.
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
      await shot(page, `${tag}-needs-recalc`);

      // Recalc fails closed: FAILED + stale, reason visible, no promotion.
      await expect(page.locator('[data-cad-grading-group-calculate]')).toBeEnabled({ timeout: 15000 });
      await page.locator('[data-cad-grading-group-calculate]').click();
      await expect(groupRow(page, group)).toContainText('Failed', { timeout: 60000 });
      await expect(groupRow(page, group)).toContainText('CORNER_NO_SOLUTION');
      await expect(groupRow(page, group)).toContainText('(stale)');
      await expect(groupTree(page, group)).toHaveAttribute('data-cad-grading-group-status', 'FAILED', { timeout: 10000 });
      await expect(page.locator('[data-cad-grading-group-extract]')).toBeDisabled();
      await expect(page.locator('[data-cad-grading-group-bake]')).toBeDisabled();
      await shot(page, `${tag}-failed-stale`);

      // Toolspace diagnostic carries the full bounded reason.
      const diagnostic = page.locator(`[data-cad-grading-group-diagnostic="${group}"]`);
      await expect(diagnostic).toContainText('Failed');
      await expect(diagnostic).toContainText('GRADING_ANALYTIC_CORNER_Z');
      await expect(groupRow(page, group)).not.toContainText('Current');
      await shot(page, `${tag}-diagnostic`);

      // Properties shows the same failure reason.
      await closeManager(page, 'Grading group manager');
      await homeTab(page);
      await page.locator('[data-cad-command="SHELL_CLEAR_SELECTION"]').click();
      const reason = page.locator('[data-cad-grading-group-status-reason]');
      await expect(reason).toContainText('Failed', { timeout: 10000 });
      await expect(reason).toContainText('CORNER_NO_SOLUTION');
    } finally {
      fs.rmSync(file, { force: true });
    }
    expect(errors).toEqual([]);
  });
}

// ===========================================================================
// Flow D — Cut/Fill composer defaults + reopen round-trip
// ===========================================================================
for (const viewport of VIEWPORTS) {
  test(`20F.2 Flow D Cut/Fill defaults @ ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    await gotoCad(page, errors);
    const ids = freshIds();
    const file = writeWorld(
      ids,
      [],
      [{ name: 'EnableManager', fl: 'chain', course: [0, 1], criterion: { ...DIST } }],
    );
    const tag = `${viewport.width}`;
    try {
      await openSurveyPlanDrawing(page, file);
      await rebuildSurface(page, ids.targetId);
      await openGradingManager(page);

      // Composer: Cut/Fill with UNTOUCHED defaults must be valid immediately.
      await page.locator('[data-cad-grading-create] [aria-label="New grading name"]').fill('CutFillDF');
      const kind = page.locator('[data-cad-grading-create] [aria-label="Criterion kind"]');
      await kind.selectOption('cut-fill');
      await expect(page.locator('[data-cad-grading-create] [aria-label="Cut ratio"]')).toHaveValue('2:1');
      await expect(page.locator('[data-cad-grading-create] [aria-label="Fill ratio"]')).toHaveValue('3:1');
      const summary = page.locator('[data-cad-grading-create] [data-cad-grading-criterion-summary]');
      await expect(summary).toContainText('Cut');
      await expect(summary).not.toContainText('invalid');
      await shot(page, `${tag}-surface-control`);
      await shot(page, `${tag}-cutfill-default-valid`);

      await page.locator('[data-cad-grading-create-submit]').click();
      await expect(page.locator('[data-cad-grading-notice]')).toContainText('Created', { timeout: 10000 });

      // Re-open the created Cut/Fill criterion: fields + summary stay valid.
      const row = page.locator('[data-cad-grading-row]', { hasText: 'CutFillDF' }).first();
      await row.click();
      await page.locator('[data-cad-grading-edit-criteria]').click();
      const edit = page.locator('[data-cad-grading-edit-panel]');
      await expect(edit).toBeVisible({ timeout: 10000 });
      await expect(edit.locator('[aria-label="Cut ratio"]')).toHaveValue('2H:1V');
      await expect(edit.locator('[aria-label="Fill ratio"]')).toHaveValue('3H:1V');
      await expect(edit.locator('[data-cad-grading-criterion-summary]')).toContainText('Cut');
      await expect(edit.locator('[data-cad-grading-criterion-summary]')).not.toContainText('invalid');
      await shot(page, `${tag}-cutfill-reopen-valid`);
    } finally {
      fs.rmSync(file, { force: true });
    }
    expect(errors).toEqual([]);
  });
}

// ===========================================================================
// Flow C — edit while BUILDING (delayed worker)
// ===========================================================================
test('20F.2 Flow C edit while BUILDING retires pending work', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const errors: string[] = [];
  await installGradingDelay(page);
  await gotoCad(page, errors);
  const ids = freshIds();
  const file = writeWorld(ids, [{ name: 'DistEdit', fl: 'chain', courses: [[0, 1], [1, 2]], criterion: { ...DIST } }]);
  const group = groupIdOf(file);
  try {
    await openSurveyPlanDrawing(page, file);
    await openGroupManager(page);
    await groupRow(page, group).click();
    await expect(groupRow(page, group)).toContainText('Unbuilt', { timeout: 15000 });
    await toolspaceSurvey(page);

    // Start a long calculation, then change the definition inside the window.
    await setGradingDelay(page, 4000);
    await page.locator('[data-cad-grading-group-calculate]').click();
    await expect(groupRow(page, group)).toContainText('Building', { timeout: 10000 });
    await shot(page, `1366-editwhilebuilding-building`);

    await page.locator('[data-cad-grading-group-edit-criteria]').click();
    const edit = page.locator('[data-cad-grading-group-edit-panel]');
    await expect(edit).toBeVisible({ timeout: 10000 });
    await edit.locator('[data-cad-grading-field="cad-grading-group-edit-distance"]').fill('15');
    await edit.locator('[data-cad-grading-group-edit-apply]').click();
    await expect(page.locator('[data-cad-grading-group-notice]')).toContainText('Criteria updated', { timeout: 10000 });

    // BUILDING must clear promptly (well before the delayed worker settles).
    await expect(groupRow(page, group)).not.toContainText('Building', { timeout: 2500 });
    await expect(groupTree(page, group)).not.toHaveAttribute('data-cad-grading-group-status', 'BUILDING', { timeout: 2500 });
    // No auto-recalc: status is not BUILDING/CURRENT and Calculate is re-enabled.
    await expect(page.locator('[data-cad-grading-group-calculate]')).toBeEnabled({ timeout: 10000 });
    await shot(page, `1366-editwhilebuilding-retired`);

    // Past the delayed worker window: the late result never becomes CURRENT.
    await page.waitForTimeout(4500);
    await expect(groupRow(page, group)).not.toContainText('Current');
    await expect(groupTree(page, group)).not.toHaveAttribute('data-cad-grading-group-status', 'CURRENT');
    await expect(groupRow(page, group)).toContainText('Unbuilt', { timeout: 10000 });
  } finally {
    fs.rmSync(file, { force: true });
  }
  expect(errors).toEqual([]);
});

// ===========================================================================
// §35 focused chrome checks — f2f / surveyTable / parcel updates, no loops
// ===========================================================================
test('20F.2 §35 f2f + surveyTable + parcel chrome updates without publication loops', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const errors: string[] = [];
  await gotoCad(page, errors);
  const file = writeSurveyPlanFixture();
  try {
    await openSurveyPlanDrawing(page, file);
    await toolspaceSurvey(page);

    // Every subtree is rendered from real drawing data.
    await expect(page.locator('[data-cad-toolspace] [data-cad-f2f-node]').first()).toBeVisible({ timeout: 15000 });
    const parcelNode = page.locator('[data-cad-toolspace] [data-cad-parcel-node]').first();
    await expect(parcelNode).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[data-cad-toolspace] [data-cad-parcel-schedule]').first()).toBeVisible({ timeout: 15000 });

    // Idle must not churn the shell (no publication loop).
    const mutations = await page.evaluate(async () => {
      const root = document.querySelector('[data-cad-toolspace]') ?? document.body;
      let count = 0;
      const ob = new MutationObserver((records) => { count += records.length; });
      ob.observe(root, { childList: true, subtree: true, characterData: true });
      await new Promise((resolve) => setTimeout(resolve, 1200));
      ob.disconnect();
      return count;
    });
    console.log('20F2 §35 idle toolspace mutations: ' + mutations);
    expect(mutations).toBeLessThanOrEqual(4);

    // Parcel update behaves: the schedule select action drives a real selection.
    await page.locator('[data-cad-toolspace] [data-cad-parcel-schedule-select]').first().click();
    await expect.poll(() => selectionCount(page)).toBeGreaterThan(0);

    // SurveyTable update behaves: create a line table, node appears in the tree.
    await selectAll(page);
    await annotateTab(page);
    await page.locator('[data-cad-command="LINETABLE"]').click();
    await canvasClick(page, 0.2, 0.2);
    await expect(page.locator('[data-cad-toolspace] [data-cad-survey-table-node]').first()).toBeVisible({ timeout: 15000 });
    await shot(page, `1366-f2f-surveyTable-parcel`);
  } finally {
    fs.rmSync(file, { force: true });
  }
  expect(errors).toEqual([]);
});

const readProject = (file: string): CadProject => {
  const parsed = parseCadDrawingFile(fs.readFileSync(file, 'utf8'));
  if (!parsed.ok) throw new Error(`seed unreadable: ${parsed.errors.join(', ')}`);
  return parsed.drawing.project;
};

const groupIdOf = (file: string): string => {
  const group = (readProject(file).gradingGroups ?? [])[0];
  if (!group) throw new Error('seed group missing');
  return group.id;
};

const groupIdOfAt = (file: string, index: number): string => {
  const group = (readProject(file).gradingGroups ?? [])[index];
  if (!group) throw new Error(`seed group ${index} missing`);
  return group.id;
};

const gradingIdOf = (file: string): string => {
  const grading = (readProject(file).gradings ?? [])[0];
  if (!grading) throw new Error('seed grading missing');
  return grading.id;
};
