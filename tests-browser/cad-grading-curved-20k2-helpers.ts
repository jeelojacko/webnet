/**
 * Phase 20K.2 browser-QA shared fixtures + UI helpers.
 *
 * Fixtures are the persisted-path geometry: a single outward rounded-square
 * bottom arc (chord 100, R = 252.5, exact `bulge = 0.1`) and a closed
 * four-arc all-Distance group, resolved through the shipped
 * `segmentGeometry` -> `resolveGroupInputs` -> worker path. `offlineGroup`
 * replays the same project through the engine so the browser product
 * availability can be compared against execution.
 */
import { expect, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  createBlankCadDrawingDocument,
  serializeCadDrawingFile,
} from '../src/engine/cad/cadDrawingFile';
import { resolveGroupInputs } from '../src/engine/cad/grading/gradingGroupResolve';
import { computeGradingGroupFromSnapshots } from '../src/engine/cad/grading/gradingGroupCompute';
import type { CadFeatureLineEntity, CadProject, CadSurface } from '../src/engine/cad/cadTypes';
import type { CadGradingGroup } from '../src/engine/cad/grading/gradingGroupTypes';
import { entityCount, gotoCad, homeTab, openSurveyPlanDrawing } from './cad-survey-plan-19a-helpers';

export const VIEWPORT = { width: 1366, height: 768 } as const;

let seq = 0;
export const nextId = (prefix: string): string => `${prefix}-20k2-${++seq}`;

const range = (a: number, b: number, s: number): number[] => {
  const out: number[] = [];
  for (let v = a; v <= b + 1e-9; v += s) out.push(v);
  return out;
};

export const XS = range(-100, 200, 10);
export const YS = range(-60, 60, 10);
export const XS_FINE = range(-100, 200, 5);
export const TILT = (x: number): number => 10 + 0.1 * (x - 50);
export const RIDGE = (x: number): number =>
  TILT(x) + (x > 10 && x < 40 ? 5 * (1 - Math.abs((x - 25) / 15)) : 0);
export const CUT_FILL = { kind: 'cut-fill' as const, cutGradeRatio: 0.5, fillGradeRatio: -2 };

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

export const gridSurface = (
  id: string,
  name: string,
  elevation: (_x: number, _y: number) => number,
  xs: number[],
  ys: number[],
): CadSurface => {
  const vertices: number[] = [];
  for (const y of ys) for (const x of xs) vertices.push(x, y, elevation(x, y));
  const faces: number[] = [];
  const idx = (ix: number, iy: number): number => iy * xs.length + ix;
  for (let ix = 0; ix + 1 < xs.length; ix += 1) {
    for (let iy = 0; iy + 1 < ys.length; iy += 1) {
      const a = idx(ix, iy);
      const b = idx(ix + 1, iy);
      const c = idx(ix + 1, iy + 1);
      const d = idx(ix, iy + 1);
      faces.push(a, b, c, a, c, d);
    }
  }
  return {
    id,
    name,
    layerId: 'general',
    styleId: 'style-base',
    definition: {
      sourceKind: 'explicit-tin',
      pointSource: { kind: 'points', pointEntityIds: [] },
      importedTin: {
        vertices,
        faces,
        provenance: { kind: 'webnet-bake', sourceSurfaceId: 'seed', sourceSurfaceName: 'seed', sourceRevision: 'srev1:seed' },
      },
    },
    cachedRevision: null,
  };
};

const arcLine = (id: string): CadFeatureLineEntity => ({
  id,
  type: 'feature-line',
  layerId: 'general',
  visible: true,
  locked: false,
  name: `FL ${id}`,
  vertices: [
    { id: `${id}:v0`, x: 0, y: 0, z: 10 },
    { id: `${id}:v1`, x: 100, y: 0, z: 10 },
  ],
  segmentGeometry: [{ kind: 'arc' as const, bulge: 0.1 }],
});

const straightLine = (id: string): CadFeatureLineEntity => ({
  ...arcLine(id),
  segmentGeometry: [{ kind: 'line' as const }],
});

export interface ArcGroupWorld {
  file: string;
  project: CadProject;
  groupId: string;
  targetId: string;
  targetName: string;
}

/** One open single-course group (curved or straight) target-bound by a Surface. */
export const writeArcGroupWorld = (
  target: CadSurface,
  criterion: CadGradingGroup['criterion'] = CUT_FILL,
  straight = false,
): ArcGroupWorld => {
  const flId = nextId('fl');
  const groupId = nextId('grp');
  const project: CadProject = {
    ...createBlankCadDrawingDocument({ name: '20K.2 curved QA', units: 'm' }).project,
    entities: [straight ? straightLine(flId) : arcLine(flId)],
    surfaces: [target],
    gradingGroups: [
      {
        id: groupId,
        name: straight ? 'LineCutFill' : 'ArcCutFill',
        sourceFeatureLineId: flId,
        sourceCourses: [{ vertexAId: `${flId}:v0`, vertexBId: `${flId}:v1` }],
        targetSurfaceId: target.id,
        side: 'right',
        criterion,
        maxSearchDistance: 100,
        curveChordTolerance: 0.1,
        cornerMode: 'miter',
      },
    ],
  };
  const file = path.join(os.tmpdir(), `wn-20k2-${Date.now()}-${Math.floor(Math.random() * 1e6)}.wncad`);
  fs.writeFileSync(
    file,
    serializeCadDrawingFile({ ...createBlankCadDrawingDocument({ name: 'q', units: 'm' }), project }),
    'utf8',
  );
  return { file, project, groupId, targetId: target.id, targetName: target.name };
};

/** Offline replay of the same persisted path through the shipped engine. */
export const offlineGroup = (
  world: ArcGroupWorld,
): { ok: boolean; components: number | null; certified: boolean; planarArea: number } => {
  const inputs = resolveGroupInputs(world.project, world.groupId);
  if (!inputs) return { ok: false, components: null, certified: false, planarArea: 0 };
  const surface = (world.project.surfaces ?? []).find((entry) => entry.id === inputs.group.targetSurfaceId);
  const tin = surface?.definition.importedTin;
  if (!tin) return { ok: false, components: null, certified: false, planarArea: 0 };
  const out = computeGradingGroupFromSnapshots({
    groupId: world.groupId,
    revision: inputs.revision,
    members: inputs.memberSources,
    side: inputs.group.side,
    criterion: inputs.group.criterion,
    ...(inputs.memberCriteria ? { memberCriteria: inputs.memberCriteria } : {}),
    maxSearchDistance: inputs.group.maxSearchDistance,
    curveChordTolerance: inputs.group.curveChordTolerance,
    closed: inputs.group.closed === true,
    target: { points: [...tin.vertices], triangles: [...tin.faces] },
  });
  if (!out.ok) return { ok: false, components: null, certified: false, planarArea: 0 };
  return {
    ok: true,
    components: out.result.topologyCertificate?.components ?? null,
    certified: out.result.topologyCertificate != null,
    planarArea: out.result.gradingPlanArea,
  };
};

const curvedSquare = (id: string): CadFeatureLineEntity => ({
  id,
  type: 'feature-line',
  layerId: 'general',
  visible: true,
  locked: false,
  name: `FL ${id}`,
  vertices: [[0, 0], [100, 0], [100, 100], [0, 100]].map(([x, y], i) => ({
    id: `${id}:v${i}`,
    x: x!,
    y: y!,
    z: 10,
  })),
  segmentGeometry: [0, 1, 2, 3].map(() => ({ kind: 'arc' as const, bulge: 0.1 })),
  closed: true,
});

const coursesOf = (flId: string): CadGradingGroup['sourceCourses'] =>
  [0, 1, 2, 3].map((i) => ({ vertexAId: `${flId}:v${i}`, vertexBId: `${flId}:v${(i + 1) % 4}` }));

export const curvedAnalyticGroup = (flId: string): CadGradingGroup => ({
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

export const curvedHybridGroup = (flId: string, targetId: string): CadGradingGroup => ({
  ...curvedAnalyticGroup(flId),
  id: nextId('grp'),
  name: 'ArcPairPad',
  targetSurfaceId: targetId,
  courseCriteria: [{ sourceCourse: coursesOf(flId)[0]!, criterion: { kind: 'fixed', gradeRatio: -0.5 } }],
});

export interface GroupWorld {
  file: string;
  groupId: string;
  groupName: string;
  targetId: string;
}

export const writeGroupWorld = (
  makeGroup: (_flId: string, _targetId: string) => CadGradingGroup,
  withTarget: boolean,
): GroupWorld => {
  const flId = nextId('fl');
  const targetId = nextId('tgt');
  const group = makeGroup(flId, targetId);
  const project: CadProject = {
    ...createBlankCadDrawingDocument({ name: '20K.2 curved QA', units: 'm' }).project,
    entities: [curvedSquare(flId)],
    surfaces: withTarget ? [gridSurface(targetId, 'Flat', () => 0, range(-60, 160, 20), range(-60, 160, 20))] : [],
    gradingGroups: [group],
  };
  const file = path.join(os.tmpdir(), `wn-20k2-${Date.now()}-${Math.floor(Math.random() * 1e6)}.wncad`);
  fs.writeFileSync(
    file,
    serializeCadDrawingFile({ ...createBlankCadDrawingDocument({ name: 'q', units: 'm' }), project }),
    'utf8',
  );
  return { file, groupId: group.id, groupName: group.name, targetId };
};

// ---------------------------------------------------------------------------
// UI helpers (mirrors the shipped 20K.1 browser harness)
// ---------------------------------------------------------------------------

export interface Errors {
  page: string[];
  console: string[];
  unhandled: string[];
}

export const openCad = async (page: Page): Promise<Errors> => {
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

export const expectClean = async (page: Page, errors: Errors): Promise<void> => {
  errors.unhandled.push(...(await drainUnhandled(page)));
  expect(errors.page).toEqual([]);
  expect(errors.console).toEqual([]);
  expect(errors.unhandled).toEqual([]);
};

export const openGroupManager = async (page: Page): Promise<void> => {
  await homeTab(page);
  await page.locator('[data-cad-grading-group-command="GRADINGGROUP"]').click();
  await expect(page.locator('[data-cad-grading-group-table]')).toBeVisible({ timeout: 15000 });
};

export const groupRow = (page: Page): ReturnType<Page['locator']> =>
  page.locator('[data-cad-grading-group-row]').first();

export const showSurveyTree = async (page: Page): Promise<void> => {
  await page.locator('[aria-label="Toolspace tabs"]').getByRole('tab', { name: 'Survey' }).click();
};

export const surfaceNodes = (page: Page): ReturnType<Page['locator']> =>
  page.locator('[data-cad-toolspace] [data-cad-surface]');

export const rebuildSurface = async (page: Page, surfaceName: string, surfaceId: string): Promise<void> => {
  await homeTab(page);
  await page.locator('[aria-label="Ribbon tabs"]').getByRole('tab', { name: 'Surface' }).click();
  await page.getByRole('button', { name: 'Add Point Group' }).first().click();
  const manager = page.locator('section[aria-label="Surface manager"]');
  await expect(manager).toBeVisible({ timeout: 10000 });
  await manager.locator('ul button', { hasText: surfaceName }).click();
  await manager.getByRole('button', { name: 'Rebuild', exact: true }).click();
  await showSurveyTree(page);
  const surface = page.locator(`[data-cad-toolspace] [data-cad-surface="${surfaceId}"]`);
  await expect(surface).toBeVisible({ timeout: 15000 });
  await expect.poll(() => surface.getAttribute('data-cad-surface-status'), { timeout: 60000 }).toBe('CURRENT');
};

export const undoOnce = async (page: Page): Promise<void> => {
  await homeTab(page);
  await page.locator('[data-cad-command="SHELL_UNDO"]').click();
};

export const redoOnce = async (page: Page): Promise<void> => {
  await homeTab(page);
  await page.locator('[data-cad-command="SHELL_REDO"]').click();
};

const calculateGroup = async (page: Page): Promise<void> => {
  await groupRow(page).click();
  const calculate = page.locator('[data-cad-grading-group-calculate]');
  await expect(calculate).toBeEnabled({ timeout: 15000 });
  await calculate.click();
  await expect(page.locator('[data-cad-grading-group-notice]')).toContainText('Computing grading group', { timeout: 10000 });
};

export const calculateGroupToCurrent = async (page: Page): Promise<void> => {
  await calculateGroup(page);
  await expect(groupRow(page)).toContainText('Current', { timeout: 60000 });
};

export const calculateGroupToFailed = async (page: Page): Promise<void> => {
  await calculateGroup(page);
  await expect(groupRow(page)).toContainText('Failed', { timeout: 60000 });
};

export const openDesignWorkflow = async (page: Page): Promise<ReturnType<Page['locator']>> => {
  await homeTab(page);
  await page.locator('[aria-label="Ribbon tabs"]').getByRole('tab', { name: 'Surface' }).click();
  await page.getByRole('button', { name: 'Add Points' }).first().click();
  const workflow = page.locator('section[aria-label="Design workflow"]');
  await expect(workflow).toBeVisible({ timeout: 15000 });
  return workflow;
};

/** Convenience for flows that count entities after opening a drawing. */
export const countEntities = (page: Page): Promise<number> => entityCount(page);

// Re-export the shared opener so the spec keeps a single import surface.
export { openSurveyPlanDrawing };
