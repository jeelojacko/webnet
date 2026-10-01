/**
 * Phase 20F.2 §13-17 — FAILED status truthfulness + service/snapshot parity.
 *
 * Pins the shared FAILED overlay: a worker/agreement diagnostic recorded for
 * the CURRENT revision reads FAILED even when an older result is retained
 * (stale evidence stays visible but never hides the failure); a diagnostic
 * from a different revision never poisons a new one; BROKEN_REFERENCE /
 * BUILDING / SOURCE_NOT_CURRENT / CURRENT keep precedence; service statusOf
 * and the snapshot builders agree for the same session state. Also pins the
 * §17 asymmetric analytic-corner fail-closed case (distance 25 / 20 with a
 * nonzero grade) — honesty, never averaging.
 */
import { describe, expect, it } from 'vitest';

import { createBlankCadDrawingDocument } from '../src/engine/cad/cadDrawingFile';
import { createCadSurfaceCache, type CadSurfaceCache } from '../src/engine/cad/cadSurfaceCache';
import { buildCadSurface } from '../src/engine/cad/cadSurfaces';
import { createCadGradingCache } from '../src/engine/cad/grading/gradingCache';
import { createCadGradingGroupCache } from '../src/engine/cad/grading/gradingGroupCache';
import { computeGradingGroupFromSnapshots } from '../src/engine/cad/grading/gradingGroupCompute';
import {
  createGroupDefinition,
  setCourseCriteriaOverrides,
} from '../src/engine/cad/grading/gradingGroupAuthoring';
import { resolveGradingInputs } from '../src/engine/cad/grading/gradingResolve';
import { resolveGroupInputs } from '../src/engine/cad/grading/gradingGroupResolve';
import { buildGradingTopologyCertificate } from '../src/engine/cad/grading/gradingTopologyCertificate';
import { deriveFailedEffectiveStatus } from '../src/engine/cad/grading/gradingStatus';
import {
  buildCadGradingSnapshot,
  type CadGradingResultCache,
} from '../src/cad-app/shell/cadGradingSnapshot';
import {
  buildCadGradingGroupSnapshot,
  type CadGradingGroupResultCache,
} from '../src/cad-app/shell/cadGradingGroupSnapshot';
import {
  toGroupSolveInput,
  type GradingGroupComputeRequest,
} from '../src/workers/surfaceWorkerHandler';
import {
  SurfaceGradingService,
  type SurfaceGradingTransport,
} from '../src/workers/surfaceGradingService';
import { computeGradingFromSnapshots } from '../src/workers/surfaceGradingCompute';
import type {
  CadFeatureLineEntity,
  CadProject,
  CadSurface,
} from '../src/engine/cad/cadTypes';
import type {
  CadGrading,
  CadGradingResult,
  GradingCriterion,
  ResolvedGradingSource,
} from '../src/engine/cad/grading/gradingTypes';
import type {
  CadGradingGroup,
  CadGradingGroupResult,
} from '../src/engine/cad/grading/gradingGroupTypes';

const flush = async (rounds = 5): Promise<void> => {
  for (let i = 0; i < rounds; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

const blankProject = (): CadProject =>
  ({
    ...createBlankCadDrawingDocument({ name: 'Failed status', units: 'm' }).project,
  }) as CadProject;

const makeFeatureLine = (
  id: string,
  vertices: Array<{ x: number; y: number; z: number }>,
  closed = false,
): CadFeatureLineEntity => ({
  id,
  type: 'feature-line',
  layerId: 'general',
  visible: true,
  locked: false,
  name: `FL ${id}`,
  vertices: vertices.map((vertex, index) => ({ id: `${id}:v${index}`, ...vertex })),
  ...(closed ? { closed: true } : {}),
});

const makeFlatTarget = (id: string): CadSurface => ({
  id,
  name: 'Flat',
  definition: {
    sourceKind: 'explicit-tin',
    pointSource: { kind: 'points', pointEntityIds: [] },
    importedTin: {
      vertices: [-10, -10, 0, 110, -10, 0, 110, 110, 0, -10, 110, 0],
      faces: [0, 1, 2, 0, 2, 3],
      provenance: {
        kind: 'webnet-bake',
        sourceSurfaceId: 'seed',
        sourceSurfaceName: 'seed',
        sourceRevision: 'srev1:seed',
      },
    },
  },
  cachedRevision: null,
});

/** Distance grading (target-free) on a 100 m flat source. */
const analyticGradingWorld = (): { project: CadProject; gradingId: string } => {
  const fl = makeFeatureLine('fl', [{ x: 0, y: 0, z: 10 }, { x: 100, y: 0, z: 10 }]);
  const grading: CadGrading = {
    id: 'g',
    name: 'G',
    sourceFeatureLineId: 'fl',
    sourceCourse: { vertexAId: 'fl:v0', vertexBId: 'fl:v1' },
    side: 'left',
    criterion: { kind: 'distance', gradeRatio: -0.5, distance: 20 },
    maxSearchDistance: 1000,
    curveChordTolerance: 0.01,
  };
  return { project: { ...blankProject(), entities: [fl], gradings: [grading] } as CadProject, gradingId: 'g' };
};

/** Surface grading on a flat TIN (target currency observable via the cache). */
const surfaceGradingWorld = (): { project: CadProject; gradingId: string; targetId: string } => {
  const fl = makeFeatureLine('fl', [{ x: 0, y: 0, z: 10 }, { x: 100, y: 0, z: 10 }]);
  const target = makeFlatTarget('tgt');
  const grading: CadGrading = {
    id: 'g',
    name: 'G',
    sourceFeatureLineId: 'fl',
    sourceCourse: { vertexAId: 'fl:v0', vertexBId: 'fl:v1' },
    targetSurfaceId: 'tgt',
    side: 'left',
    criterion: { kind: 'fixed', gradeRatio: -0.5 },
    maxSearchDistance: 1000,
    curveChordTolerance: 0.01,
  };
  return {
    project: { ...blankProject(), entities: [fl], surfaces: [target], gradings: [grading] } as CadProject,
    gradingId: 'g',
    targetId: 'tgt',
  };
};

/** Closed CCW 100x100 analytic (distance) group. */
const analyticGroupWorld = (): { project: CadProject; groupId: string } => {
  const fl = makeFeatureLine(
    'fl',
    [
      { x: 0, y: 0, z: 10 },
      { x: 100, y: 0, z: 10 },
      { x: 100, y: 100, z: 10 },
      { x: 0, y: 100, z: 10 },
    ],
    true,
  );
  const created = createGroupDefinition({
    id: 'grp',
    name: 'Pad',
    sourceFeatureLineId: 'fl',
    sourceCourses: [
      { vertexAId: 'fl:v0', vertexBId: 'fl:v1' },
      { vertexAId: 'fl:v1', vertexBId: 'fl:v2' },
      { vertexAId: 'fl:v2', vertexBId: 'fl:v3' },
      { vertexAId: 'fl:v3', vertexBId: 'fl:v0' },
    ],
    side: 'right',
    criterion: { kind: 'distance', gradeRatio: -0.5, distance: 25 },
    maxSearchDistance: 200,
    curveChordTolerance: 0.05,
    cornerMode: 'miter',
    closed: true,
  });
  if (!created.ok) throw new Error(created.error);
  return {
    project: { ...blankProject(), entities: [fl], gradingGroups: [created.value] } as CadProject,
    groupId: 'grp',
  };
};

const withGradingCriterion = (
  project: CadProject,
  gradingId: string,
  criterion: GradingCriterion,
): CadProject => ({
  ...project,
  gradings: (project.gradings ?? []).map((grading) =>
    grading.id === gradingId ? { ...grading, criterion } : grading,
  ),
});

const groupsOf = (project: CadProject): CadGradingGroup[] =>
  (project as CadProject & { gradingGroups?: CadGradingGroup[] }).gradingGroups ?? [];

const seedTin = (cache: CadSurfaceCache, project: CadProject, targetId: string): void => {
  const target = project.surfaces!.find((entry) => entry.id === targetId)!;
  const built = buildCadSurface(project, target);
  if (built.outcome !== 'ok') throw new Error('flat target build failed');
  const inputs = resolveGradingInputs(project, 'g')!;
  cache.set(targetId, inputs.targetRevision!, {
    revision: inputs.targetRevision!,
    points: built.points,
    triangles: built.triangles,
    stats: built.stats,
    grid: built.grid,
    adjacency: built.adjacency,
    edgeKinds: built.edgeKinds,
  });
};

const fakeGradingResult = (gradingId: string, revision: string): CadGradingResult => ({
  gradingId,
  revision,
  accuracy: 'EXACT',
  regions: [],
  daylightPoints: [0, 0, 0, 10, 0, 0],
  gradingMesh: { points: [0, 0, 0, 10, 0, 0, 5, 5, 0], triangles: [0, 1, 2] },
  sourceLength: 10,
  gradingPlanArea: 25,
  grading3dArea: 25,
  minProjectionDistance: 1,
  maxProjectionDistance: 2,
  meanProjectionDistance: 1.5,
  cutSourceLength: 5,
  fillSourceLength: 5,
  tiedSourceLength: 0,
  candidateTriangleCount: 1,
  intersectionSegmentCount: 1,
  multipleSolutionCount: 0,
  diagnostics: [],
  topologyCertificate: buildGradingTopologyCertificate({
    scope: 'standalone',
    points: [0, 0, 0, 10, 0, 0, 5, 5, 0],
    triangles: [0, 1, 2],
  }) ?? undefined,
});

const fakeGroupResult = (groupId: string, revision: string): CadGradingGroupResult => ({
  groupId,
  revision,
  accuracy: 'EXACT',
  memberCount: 4,
  cornerCount: 4,
  memberRegions: [],
  corners: [],
  daylightPoints: [0, 0, 0, 10, 0, 0, 10, 10, 0],
  gradingMesh: { points: [0, 0, 0, 10, 0, 0, 5, 5, 0], triangles: [0, 1, 2] },
  sourceLength: 40,
  gradingPlanArea: 10000,
  grading3dArea: 10000,
  minProjectionDistance: 25,
  maxProjectionDistance: 25,
  meanProjectionDistance: 25,
  cutSourceLength: 40,
  fillSourceLength: 0,
  tiedSourceLength: 0,
  candidateTriangleCount: 2,
  intersectionSegmentCount: 2,
  multipleSolutionCount: 0,
  diagnostics: [],
  topologyCertificate: buildGradingTopologyCertificate({
    scope: 'group',
    points: [0, 0, 0, 10, 0, 0, 5, 5, 0],
    triangles: [0, 1, 2],
  }) ?? undefined,
});

const gradingCacheOf = (results: CadGradingResult[]): CadGradingResultCache => ({
  get: (id, revision) => results.find((entry) => entry.gradingId === id && entry.revision === revision),
  retained: (id) => results.filter((entry) => entry.gradingId === id),
});

const groupCacheOf = (results: CadGradingGroupResult[]): CadGradingGroupResultCache => ({
  get: (id, revision) => results.find((entry) => entry.groupId === id && entry.revision === revision),
  retained: (id) => results.filter((entry) => entry.groupId === id),
});

const gradingRow = (
  project: CadProject,
  surfaceCache: CadSurfaceCache | null,
  cache: CadGradingResultCache,
  gradingId: string,
  options?: Parameters<typeof buildCadGradingSnapshot>[4],
): ReturnType<typeof buildCadGradingSnapshot>['gradings'][number] => {
  const row = buildCadGradingSnapshot(project, surfaceCache, cache, gradingId, options).gradings[0];
  if (!row) throw new Error('missing grading row');
  return row;
};

const groupRow = (
  project: CadProject,
  surfaceCache: CadSurfaceCache | null,
  cache: CadGradingGroupResultCache,
  groupId: string,
  options?: Parameters<typeof buildCadGradingGroupSnapshot>[4],
): ReturnType<typeof buildCadGradingGroupSnapshot>['groups'][number] => {
  const row = buildCadGradingGroupSnapshot(project, surfaceCache, cache, groupId, options).groups[0];
  if (!row) throw new Error('missing group row');
  return row;
};

describe('deriveFailedEffectiveStatus (shared overlay)', () => {
  const failure = { revision: 'rev-2', error: 'boom' };

  it('replaces only UNBUILT / NEEDS_RECALC on a current-revision failure', () => {
    expect(deriveFailedEffectiveStatus('UNBUILT', failure, 'rev-2')).toBe('FAILED');
    expect(deriveFailedEffectiveStatus('NEEDS_RECALC', failure, 'rev-2')).toBe('FAILED');
  });

  it('keeps BROKEN_REFERENCE / BUILDING / SOURCE_NOT_CURRENT / CURRENT', () => {
    expect(deriveFailedEffectiveStatus('BROKEN_REFERENCE', failure, 'rev-2')).toBe('BROKEN_REFERENCE');
    expect(deriveFailedEffectiveStatus('BUILDING', failure, 'rev-2')).toBe('BUILDING');
    expect(deriveFailedEffectiveStatus('SOURCE_NOT_CURRENT', failure, 'rev-2')).toBe('SOURCE_NOT_CURRENT');
    expect(deriveFailedEffectiveStatus('CURRENT', failure, 'rev-2')).toBe('CURRENT');
  });

  it('never lets another revision (or no failure) poison the row', () => {
    expect(deriveFailedEffectiveStatus('UNBUILT', failure, 'rev-3')).toBe('UNBUILT');
    expect(deriveFailedEffectiveStatus('NEEDS_RECALC', null, 'rev-2')).toBe('NEEDS_RECALC');
  });
});

describe('grading snapshot FAILED matrix', () => {
  const setup = () => {
    const { project, gradingId, targetId } = surfaceGradingWorld();
    const tin = createCadSurfaceCache('20f2-snap');
    seedTin(tin, project, targetId);
    const empty = gradingCacheOf([]);
    const revision = gradingRow(project, tin, empty, gradingId).revision;
    return { project, gradingId, targetId, tin, revision, empty };
  };

  it('UNBUILT: no result and no diagnostic', () => {
    const { project, gradingId, tin, empty } = setup();
    const row = gradingRow(project, tin, empty, gradingId);
    expect(row.status).toBe('UNBUILT');
    expect(row.diagnostic).toBeNull();
    expect(row.exportable).toBe(false);
  });

  it('CURRENT: a result at the current revision', () => {
    const { project, gradingId, tin, revision } = setup();
    const row = gradingRow(project, tin, gradingCacheOf([fakeGradingResult(gradingId, revision)]), gradingId);
    expect(row.status).toBe('CURRENT');
    expect(row.diagnostic).toBeNull();
    expect(row.exportable).toBe(true);
  });

  it('stale NEEDS_RECALC: retained result at an old revision', () => {
    const { project, gradingId, tin } = setup();
    const row = gradingRow(project, tin, gradingCacheOf([fakeGradingResult(gradingId, 'grev1:stale')]), gradingId);
    expect(row.status).toBe('NEEDS_RECALC');
    expect(row.stale).toBe(true);
    expect(row.diagnostic).toBeNull();
    expect(row.exportable).toBe(false);
  });

  it('current failure with no older result -> FAILED', () => {
    const { project, gradingId, tin, revision } = setup();
    const row = gradingRow(project, tin, gradingCacheOf([]), gradingId, {
      sessionDiagnostics: new Map([[gradingId, { revision, error: 'GRADING_ANALYTIC_CORNER_Z' }]]),
    });
    expect(row.status).toBe('FAILED');
    expect(row.stale).toBe(false);
    expect(row.diagnostic).toBe('GRADING_ANALYTIC_CORNER_Z');
    expect(row.exportable).toBe(false);
  });

  it('current failure with a stale retained result -> FAILED + stale, export withheld', () => {
    const { project, gradingId, tin, revision } = setup();
    const row = gradingRow(project, tin, gradingCacheOf([fakeGradingResult(gradingId, 'grev1:stale')]), gradingId, {
      sessionDiagnostics: new Map([[gradingId, { revision, error: 'CORNER_NO_SOLUTION: GRADING_ANALYTIC_CORNER_Z' }]]),
    });
    expect(row.status).toBe('FAILED');
    expect(row.stale).toBe(true);
    expect(row.diagnostic).toContain('GRADING_ANALYTIC_CORNER_Z');
    expect(row.exportable).toBe(false);
  });

  it('an old-revision diagnostic does not poison the new revision', () => {
    const { project, gradingId, tin, revision } = setup();
    const row = gradingRow(project, tin, gradingCacheOf([fakeGradingResult(gradingId, 'grev1:stale')]), gradingId, {
      sessionDiagnostics: new Map([[gradingId, { revision: `${revision}:old`, error: 'stale boom' }]]),
    });
    expect(row.status).toBe('NEEDS_RECALC');
    expect(row.diagnostic).toBeNull();
  });

  it('BUILDING wins over a current failure', () => {
    const { project, gradingId, tin, revision } = setup();
    const row = gradingRow(project, tin, gradingCacheOf([]), gradingId, {
      buildingGradingIds: new Set([gradingId]),
      sessionDiagnostics: new Map([[gradingId, { revision, error: 'boom' }]]),
    });
    expect(row.status).toBe('BUILDING');
    expect(row.diagnostic).toBeNull();
  });

  it('BROKEN_REFERENCE wins over a current failure', () => {
    const { project, gradingId, tin, revision } = setup();
    const broken: CadProject = { ...project, entities: [] };
    const row = gradingRow(broken, tin, gradingCacheOf([]), gradingId, {
      sessionDiagnostics: new Map([[gradingId, { revision, error: 'boom' }]]),
    });
    expect(row.status).toBe('BROKEN_REFERENCE');
    expect(row.diagnostic).toBeNull();
  });

  it('target-not-current stays SOURCE_NOT_CURRENT even with a failure', () => {
    const { project, gradingId, revision } = setup();
    const row = gradingRow(project, null, gradingCacheOf([fakeGradingResult(gradingId, 'grev1:stale')]), gradingId, {
      sessionDiagnostics: new Map([[gradingId, { revision, error: 'boom' }]]),
    });
    expect(row.status).toBe('SOURCE_NOT_CURRENT');
    expect(row.diagnostic).toBeNull();
    expect(row.exportable).toBe(false);
  });
});

describe('group snapshot FAILED matrix', () => {
  const setup = () => {
    const { project, groupId } = analyticGroupWorld();
    const empty = groupCacheOf([]);
    const revision = resolveGroupInputs(project, groupId)!.revision;
    return { project, groupId, revision, empty };
  };

  it('UNBUILT: no result and no diagnostic', () => {
    const { project, groupId, empty } = setup();
    const row = groupRow(project, null, empty, groupId);
    expect(row.status).toBe('UNBUILT');
    expect(row.diagnostic).toBeNull();
    expect(row.exportable).toBe(false);
  });

  it('CURRENT: a result at the current revision', () => {
    const { project, groupId, revision } = setup();
    const row = groupRow(project, null, groupCacheOf([fakeGroupResult(groupId, revision)]), groupId);
    expect(row.status).toBe('CURRENT');
    expect(row.diagnostic).toBeNull();
    expect(row.exportable).toBe(true);
  });

  it('stale NEEDS_RECALC: retained result at an old revision', () => {
    const { project, groupId } = setup();
    const row = groupRow(project, null, groupCacheOf([fakeGroupResult(groupId, 'ggrev1:stale')]), groupId);
    expect(row.status).toBe('NEEDS_RECALC');
    expect(row.stale).toBe(true);
    expect(row.diagnostic).toBeNull();
  });

  it('current failure with a stale retained result -> FAILED + stale + diagnostic', () => {
    const { project, groupId, revision } = setup();
    const row = groupRow(project, null, groupCacheOf([fakeGroupResult(groupId, 'ggrev1:stale')]), groupId, {
      sessionDiagnostics: new Map([
        [groupId, { revision, error: 'CORNER_NO_SOLUTION (corner 0): GRADING_ANALYTIC_CORNER_Z' }],
      ]),
    });
    expect(row.status).toBe('FAILED');
    expect(row.stale).toBe(true);
    expect(row.diagnostic).toContain('GRADING_ANALYTIC_CORNER_Z');
    expect(row.exportable).toBe(false);
  });

  it('current failure with no older result -> FAILED', () => {
    const { project, groupId, revision } = setup();
    const row = groupRow(project, null, groupCacheOf([]), groupId, {
      sessionDiagnostics: new Map([[groupId, { revision, error: 'boom' }]]),
    });
    expect(row.status).toBe('FAILED');
    expect(row.stale).toBe(false);
  });

  it('an old-revision diagnostic does not poison the new revision', () => {
    const { project, groupId, revision } = setup();
    const row = groupRow(project, null, groupCacheOf([fakeGroupResult(groupId, 'ggrev1:stale')]), groupId, {
      sessionDiagnostics: new Map([[groupId, { revision: `${revision}:old`, error: 'stale boom' }]]),
    });
    expect(row.status).toBe('NEEDS_RECALC');
    expect(row.diagnostic).toBeNull();
  });

  it('BUILDING and BROKEN_REFERENCE win over a current failure', () => {
    const { project, groupId, revision } = setup();
    const building = groupRow(project, null, groupCacheOf([]), groupId, {
      buildingGroupIds: new Set([groupId]),
      sessionDiagnostics: new Map([[groupId, { revision, error: 'boom' }]]),
    });
    expect(building.status).toBe('BUILDING');
    const broken = groupRow({ ...project, entities: [] }, null, groupCacheOf([]), groupId, {
      sessionDiagnostics: new Map([[groupId, { revision, error: 'boom' }]]),
    });
    expect(broken.status).toBe('BROKEN_REFERENCE');
    expect(broken.diagnostic).toBeNull();
  });
});

describe('service + snapshot parity', () => {
  const computeGradingResult = (request: { gradingId: string }): CadGradingResult => {
    const outcome = computeGradingFromSnapshots(
      request as unknown as Parameters<typeof computeGradingFromSnapshots>[0],
    );
    if (!outcome.ok) throw new Error(outcome.detail ?? outcome.code);
    return outcome.result;
  };

  const groupResultOf = (request: GradingGroupComputeRequest): CadGradingGroupResult => {
    const outcome = computeGradingGroupFromSnapshots(toGroupSolveInput(request));
    if (!outcome.ok) {
      const corner = outcome.cornerIndex === undefined ? '' : ` (corner ${outcome.cornerIndex})`;
      throw new Error(`${outcome.code}${corner}${outcome.detail ? `: ${outcome.detail}` : ''}`);
    }
    return outcome.result;
  };

  const groupLoopbackTransport = (): SurfaceGradingTransport => ({
    alive: true,
    deriveGrading: () => {
      throw new Error('unused');
    },
    deriveGroupGrading: (request) => ({
      requestId: `glb-${request.revision}`,
      done: Promise.resolve().then(() => groupResultOf(request)),
      cancel: () => undefined,
    }),
    cancel: () => undefined,
    dispose: () => undefined,
  });

  it('grading: FAILED with stale retained, then NEEDS_RECALC once the diagnostic expires', async () => {
    const { project, gradingId } = analyticGradingWorld();
    let current = project;
    const gradingCache = createCadGradingCache('20f2-g');
    const mode = { value: 'success' as 'success' | 'fail' };
    const service = new SurfaceGradingService({
      drawingId: '20f2-g',
      getProject: () => current,
      getDrawingId: () => '20f2-g',
      tinCache: createCadSurfaceCache('20f2-g'),
      gradingCache,
      createTransport: () => ({
        alive: true,
        deriveGrading: (request) => ({
          requestId: `req-${request.revision}`,
          done:
            mode.value === 'success'
              ? Promise.resolve(computeGradingResult(request))
              : Promise.reject(new Error('GRADING_ANALYTIC_CORNER_Z')),
          cancel: () => undefined,
        }),
        cancel: () => undefined,
        dispose: () => undefined,
      }),
      notify: () => undefined,
      onStateChange: () => undefined,
    });

    service.requestGrading(gradingId);
    await flush();
    expect(service.statusOf(gradingId)).toEqual({ status: 'CURRENT', stale: false });

    current = withGradingCriterion(current, gradingId, { kind: 'distance', gradeRatio: -0.25, distance: 20 });
    mode.value = 'fail';
    service.requestGrading(gradingId);
    await flush();
    expect(service.statusOf(gradingId)).toEqual({ status: 'FAILED', stale: true });

    const snap = gradingRow(current, null, gradingCache, gradingId, {
      sessionDiagnostics: service.gradingDiagnostics(),
    });
    expect(snap.status).toBe('FAILED');
    expect(snap.stale).toBe(true);
    expect(snap.diagnostic).toBe('GRADING_ANALYTIC_CORNER_Z');
    expect(snap.exportable).toBe(false);

    // Move the revision again: the old diagnostic must expire, not poison.
    current = withGradingCriterion(current, gradingId, { kind: 'distance', gradeRatio: -0.4, distance: 20 });
    expect(service.statusOf(gradingId).status).toBe('NEEDS_RECALC');
    const next = gradingRow(current, null, gradingCache, gradingId, {
      sessionDiagnostics: service.gradingDiagnostics(),
    });
    expect(next.status).toBe('NEEDS_RECALC');
    expect(next.stale).toBe(true);
    expect(next.diagnostic).toBeNull();
  });

  it('§17 group: distance 25/20 nonzero grade fails closed (no averaging)', () => {
    const square: ResolvedGradingSource[] = [
      { startX: 0, startY: 0, endX: 100, endY: 0, startZ: 10, endZ: 10, length: 100, reoriented: false, isArc: false },
      { startX: 100, startY: 0, endX: 100, endY: 100, startZ: 10, endZ: 10, length: 100, reoriented: false, isArc: false },
      { startX: 100, startY: 100, endX: 0, endY: 100, startZ: 10, endZ: 10, length: 100, reoriented: false, isArc: false },
      { startX: 0, startY: 100, endX: 0, endY: 0, startZ: 10, endZ: 10, length: 100, reoriented: false, isArc: false },
    ];
    const out = computeGradingGroupFromSnapshots({
      groupId: 'g17',
      revision: 'ggrev1:test',
      members: square,
      side: 'right',
      criterion: { kind: 'distance', gradeRatio: -0.5, distance: 25 },
      memberCriteria: [
        { kind: 'distance', gradeRatio: -0.5, distance: 25 },
        { kind: 'distance', gradeRatio: -0.5, distance: 20 },
        { kind: 'distance', gradeRatio: -0.5, distance: 25 },
        { kind: 'distance', gradeRatio: -0.5, distance: 25 },
      ],
      maxSearchDistance: 200,
      curveChordTolerance: 0.05,
      closed: true,
    });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.code).toBe('CORNER_NO_SOLUTION');
    expect(out.detail).toBe('GRADING_ANALYTIC_CORNER_Z');
  });

  it('group: recalc failure after CURRENT reads FAILED with stale retained; service matches snapshot', async () => {
    const { project, groupId } = analyticGroupWorld();
    let current = project;
    const groupCache = createCadGradingGroupCache('20f2-gg');
    const service = new SurfaceGradingService({
      drawingId: '20f2-gg',
      getProject: () => current,
      getDrawingId: () => '20f2-gg',
      tinCache: createCadSurfaceCache('20f2-gg'),
      gradingCache: createCadGradingCache('20f2-gg'),
      groupCache,
      createTransport: () => groupLoopbackTransport(),
      notify: () => undefined,
      onStateChange: () => undefined,
    });

    service.requestGroupGrading(groupId);
    await flush();
    expect(service.groupStatusOf(groupId)).toEqual({ status: 'CURRENT', stale: false });

    const group = groupsOf(current)[0]!;
    const overridden = setCourseCriteriaOverrides(
      group,
      [group.sourceCourses[1]!],
      { kind: 'distance', gradeRatio: -0.5, distance: 20 },
    );
    if (!overridden.ok) throw new Error(overridden.error);
    current = { ...current, gradingGroups: [overridden.value] } as CadProject;

    service.requestGroupGrading(groupId);
    await flush();
    expect(service.groupStatusOf(groupId)).toEqual({ status: 'FAILED', stale: true });
    expect(service.groupGradingDiagnostics().get(groupId)!.error).toContain('GRADING_ANALYTIC_CORNER_Z');

    const snap = groupRow(current, null, groupCache, groupId, {
      sessionDiagnostics: service.groupGradingDiagnostics(),
    });
    expect(snap.status).toBe('FAILED');
    expect(snap.stale).toBe(true);
    expect(snap.diagnostic).toContain('GRADING_ANALYTIC_CORNER_Z');
    expect(snap.exportable).toBe(false);
  });
});
