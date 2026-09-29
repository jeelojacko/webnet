/**
 * Phase 20F.2 §§8-12 — pending-request reconciliation seam.
 *
 * One authoritative sweep (`reconcilePendingWithProject`) retires in-flight
 * standalone AND group work whose resolved `grev1:`/`ggrev1:` revision moved
 * (source geometry, criterion/override, target reassignment, delete) while
 * leaving unrelated edits, analytic (target-free) gradings, and same-revision
 * rebuilds alone. Late results for a reconciled run never become CURRENT. The
 * seam never auto-calculates and never promotes a stale result.
 */
import { describe, expect, it } from 'vitest';

import { createBlankCadDrawingDocument } from '../src/engine/cad/cadDrawingFile';
import { createCadSurfaceCache } from '../src/engine/cad/cadSurfaceCache';
import { buildCadSurface } from '../src/engine/cad/cadSurfaces';
import { createCadHistoryState, runCadCommand } from '../src/engine/cad/cadUndoRedo';
import { createCadGradingCache } from '../src/engine/cad/grading/gradingCache';
import { createCadGradingGroupCache } from '../src/engine/cad/grading/gradingGroupCache';
import { computeGradingGroupFromSnapshots } from '../src/engine/cad/grading/gradingGroupCompute';
import { resolveGroupInputs } from '../src/engine/cad/grading/gradingGroupResolve';
import type { CadGradingGroup, CadGradingGroupResult } from '../src/engine/cad/grading/gradingGroupTypes';
import { resolveGradingInputs } from '../src/engine/cad/grading/gradingResolve';
import type { CadGradingResult, GradingCriterion } from '../src/engine/cad/grading/gradingTypes';
import type { CadFeatureLineEntity, CadProject, CadSurface } from '../src/engine/cad/cadTypes';
import { computeGradingFromSnapshots } from '../src/workers/surfaceGradingCompute';
import type { GradingGroupComputeRequest, SurfaceGradingRequest } from '../src/workers/surfaceWorkerHandler';
import {
  SurfaceGradingService,
  type SurfaceGradingTransport,
} from '../src/workers/surfaceGradingService';

let seq = 0;
const nextId = (prefix: string): string => {
  seq += 1;
  return `${prefix}-20f2-${seq}`;
};

const makeFeatureLine = (
  id: string,
  vertices: Array<{ x: number; y: number; z: number }>,
): CadFeatureLineEntity => ({
  id,
  type: 'feature-line',
  layerId: 'general',
  visible: true,
  locked: false,
  name: `FL ${id}`,
  vertices: vertices.map((vertex, index) => ({ id: `${id}:v${index}`, ...vertex })),
});

const makeFlatTarget = (id: string, name: string): CadSurface => ({
  id,
  name,
  definition: {
    sourceKind: 'explicit-tin',
    pointSource: { kind: 'points', pointEntityIds: [] },
    importedTin: {
      vertices: [-10, -10, 0, 110, -10, 0, 110, 60, 0, -10, 60, 0],
      faces: [0, 1, 2, 0, 2, 3],
      provenance: { kind: 'webnet-bake', sourceSurfaceId: 'seed', sourceSurfaceName: 'seed', sourceRevision: 'srev1:seed' },
    },
  },
  cachedRevision: null,
});

const blankProject = (name: string): CadProject =>
  createBlankCadDrawingDocument({ name, units: 'm' }).project;

const flush = async (rounds = 4): Promise<void> => {
  for (let i = 0; i < rounds; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

const setTin = (tinCache: ReturnType<typeof createCadSurfaceCache>, project: CadProject, targetId: string, revision: string): void => {
  const target = project.surfaces!.find((entry) => entry.id === targetId)!;
  const built = buildCadSurface(project, target);
  expect(built.outcome).toBe('ok');
  tinCache.set(targetId, revision, {
    revision,
    points: built.points,
    triangles: built.triangles,
    stats: built.stats,
    grid: built.grid,
    adjacency: built.adjacency,
    edgeKinds: built.edgeKinds,
  });
};

/** Immutable Feature-Line vertex-Z edit (source geometry move). */
const moveFeatureLine = (project: CadProject, flId: string, dz: number): CadProject => ({
  ...project,
  entities: project.entities.map((entity) =>
    entity.id === flId && entity.type === 'feature-line'
      ? { ...entity, vertices: entity.vertices.map((vertex) => ({ ...vertex, z: vertex.z + dz })) }
      : entity,
  ),
});

// ---------------------------------------------------------------------------
// Standalone grading world
// ---------------------------------------------------------------------------

const standaloneWorld = () => {
  const flId = nextId('fl');
  const otherFlId = nextId('fl-other');
  const targetId = nextId('tgt');
  const otherTargetId = nextId('tgt-other');
  const base: CadProject = {
    ...blankProject('Reconcile Standalone'),
    entities: [
      makeFeatureLine(flId, [{ x: 0, y: 0, z: 10 }, { x: 100, y: 0, z: 10 }]),
      makeFeatureLine(otherFlId, [{ x: 0, y: 200, z: 10 }, { x: 100, y: 200, z: 10 }]),
    ],
    surfaces: [makeFlatTarget(targetId, 'Target'), makeFlatTarget(otherTargetId, 'Other')],
  };
  const entity = base.entities.find((entry) => entry.id === flId) as CadFeatureLineEntity;
  const withGrading = runCadCommand(createCadHistoryState(base), {
    key: 'GRADING_CREATE',
    name: 'G',
    sourceFeatureLineId: flId,
    vertexAId: entity.vertices[0]!.id,
    vertexBId: entity.vertices[1]!.id,
    targetSurfaceId: targetId,
    side: 'left',
    criterion: { kind: 'fixed', gradeRatio: -0.5 },
    maxSearchDistance: 1000,
    curveChordTolerance: 0.01,
  }).present.project;
  const gradingId = withGrading.gradings![0]!.id;
  return { project: withGrading, flId, otherFlId, targetId, otherTargetId, gradingId };
};

const analyticGradingWorld = () => {
  const flId = nextId('fl-analytic');
  const base: CadProject = {
    ...blankProject('Reconcile Analytic'),
    entities: [makeFeatureLine(flId, [{ x: 0, y: 0, z: 10 }, { x: 100, y: 0, z: 10 }])],
    surfaces: [],
  };
  const entity = base.entities[0] as CadFeatureLineEntity;
  const withGrading = runCadCommand(createCadHistoryState(base), {
    key: 'GRADING_CREATE',
    name: 'Analytic',
    sourceFeatureLineId: flId,
    vertexAId: entity.vertices[0]!.id,
    vertexBId: entity.vertices[1]!.id,
    side: 'left',
    criterion: { kind: 'distance', gradeRatio: -0.02, distance: 10 },
    maxSearchDistance: 1000,
    curveChordTolerance: 0.01,
  }).present.project;
  return { project: withGrading, flId, gradingId: withGrading.gradings![0]!.id };
};

// ---------------------------------------------------------------------------
// Group grading world
// ---------------------------------------------------------------------------

const groupWorld = () => {
  const flId = nextId('gfl');
  const otherFlId = nextId('gfl-other');
  const targetId = nextId('gtgt');
  const otherTargetId = nextId('gtgt-other');
  const base = {
    ...blankProject('Reconcile Group'),
    entities: [
      makeFeatureLine(flId, [{ x: 0, y: 0, z: 10 }, { x: 50, y: 0, z: 10 }, { x: 50, y: 50, z: 10 }]),
      makeFeatureLine(otherFlId, [{ x: 0, y: 200, z: 10 }, { x: 50, y: 200, z: 10 }]),
    ],
    surfaces: [makeFlatTarget(targetId, 'Target'), makeFlatTarget(otherTargetId, 'Other')],
  } as CadProject;
  const group: CadGradingGroup = {
    id: nextId('grp'),
    name: 'Pad',
    sourceFeatureLineId: flId,
    sourceCourses: [
      { vertexAId: `${flId}:v0`, vertexBId: `${flId}:v1` },
      { vertexAId: `${flId}:v1`, vertexBId: `${flId}:v2` },
    ],
    targetSurfaceId: targetId,
    side: 'left',
    criterion: { kind: 'fixed', gradeRatio: -0.5 },
    maxSearchDistance: 1000,
    curveChordTolerance: 0.01,
    cornerMode: 'miter',
  };
  const project = { ...base, gradingGroups: [group] } as CadProject;
  return { project, flId, otherFlId, targetId, otherTargetId, groupId: group.id };
};

// ---------------------------------------------------------------------------
// Deferred transports + service harness
// ---------------------------------------------------------------------------

interface DeferredStandalone {
  request: SurfaceGradingRequest;
  resolve: (_result: CadGradingResult | null) => void;
}

const deferredStandaloneTransport = (): {
  transport: SurfaceGradingTransport;
  deferred: DeferredStandalone[];
} => {
  const deferred: DeferredStandalone[] = [];
  const transport: SurfaceGradingTransport = {
    alive: true,
    deriveGrading: (request) => {
      let resolve!: (_result: CadGradingResult | null) => void;
      const done = new Promise<CadGradingResult | null>((res) => {
        resolve = res;
      });
      deferred.push({ request, resolve });
      return { requestId: `ds-${deferred.length}`, done, cancel: () => undefined };
    },
    cancel: () => undefined,
    dispose: () => undefined,
  };
  return { transport, deferred };
};

interface DeferredGroup {
  request: GradingGroupComputeRequest;
  resolve: (_result: CadGradingGroupResult | null) => void;
}

const deferredGroupTransport = (): {
  transport: SurfaceGradingTransport;
  deferred: DeferredGroup[];
} => {
  const deferred: DeferredGroup[] = [];
  const transport: SurfaceGradingTransport = {
    alive: true,
    deriveGrading: () => {
      throw new Error('standalone path unused');
    },
    deriveGroupGrading: (request) => {
      let resolve!: (_result: CadGradingGroupResult | null) => void;
      const done = new Promise<CadGradingGroupResult | null>((res) => {
        resolve = res;
      });
      deferred.push({ request, resolve });
      return { requestId: `dg-${deferred.length}`, done, cancel: () => undefined };
    },
    cancel: () => undefined,
    dispose: () => undefined,
  };
  return { transport, deferred };
};

const computeStandalone = (request: SurfaceGradingRequest): CadGradingResult => {
  const outcome = computeGradingFromSnapshots(request);
  if (!outcome.ok) throw new Error(outcome.detail ?? outcome.code);
  return outcome.result;
};

const computeGroup = (request: GradingGroupComputeRequest): CadGradingGroupResult => {
  const outcome = computeGradingGroupFromSnapshots({
    groupId: request.groupId,
    revision: request.revision,
    members: request.memberSources,
    side: request.side,
    criterion: request.criterion,
    maxSearchDistance: request.maxSearchDistance,
    curveChordTolerance: request.curveChordTolerance,
    closed: request.closed,
    target: request.target,
  });
  if (!outcome.ok) throw new Error(`${outcome.code}${outcome.detail ? `: ${outcome.detail}` : ''}`);
  return outcome.result;
};

const makeService = (
  drawingId: string,
  getProject: () => CadProject,
  tinCache: ReturnType<typeof createCadSurfaceCache>,
  transport: SurfaceGradingTransport,
  onStateChange: () => void,
) => {
  const gradingCache = createCadGradingCache(drawingId);
  const groupCache = createCadGradingGroupCache(drawingId);
  const service = new SurfaceGradingService({
    drawingId,
    getProject,
    getDrawingId: () => drawingId,
    tinCache,
    gradingCache,
    groupCache,
    createTransport: () => transport,
    notify: () => undefined,
    onStateChange,
  });
  return { service, gradingCache, groupCache };
};

const criterionEdit = (project: CadProject, gradingId: string, criterion: GradingCriterion): CadProject =>
  runCadCommand(createCadHistoryState(project), { key: 'GRADING_EDIT_CRITERIA', gradingId, criterion })
    .present.project;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('pending reconciliation — standalone grading', () => {
  it('revision edit cancels the pending run and its late result is ignored', async () => {
    const { project, gradingId } = standaloneWorld();
    const tinCache = createCadSurfaceCache('rec-standalone-rev');
    const inputs = resolveGradingInputs(project, gradingId)!;
    setTin(tinCache, project, inputs.target!.id, inputs.targetRevision!);
    const { transport, deferred } = deferredStandaloneTransport();
    let current = project;
    let stateChanges = 0;
    const { service, gradingCache } = makeService('rec-standalone-rev', () => current, tinCache, transport, () => {
      stateChanges += 1;
    });

    service.requestGrading(gradingId);
    await flush();
    expect(service.buildingGradingIds().has(gradingId)).toBe(true);

    const before = stateChanges;
    current = criterionEdit(current, gradingId, { kind: 'fixed', gradeRatio: -0.25 });
    service.reconcilePendingWithProject();
    expect(service.buildingGradingIds().has(gradingId)).toBe(false);
    expect(stateChanges).toBeGreaterThan(before);

    const staleRevision = deferred[0]!.request.revision;
    deferred[0]!.resolve(computeStandalone(deferred[0]!.request));
    await flush();
    expect(gradingCache.get(gradingId, staleRevision)).toBeUndefined();
    expect(service.statusOf(gradingId).status).not.toBe('CURRENT');
  });

  it('an unrelated source edit does not cancel; the affected source edit does', async () => {
    const { project, gradingId, flId, otherFlId } = standaloneWorld();
    const tinCache = createCadSurfaceCache('rec-standalone-src');
    const inputs = resolveGradingInputs(project, gradingId)!;
    setTin(tinCache, project, inputs.target!.id, inputs.targetRevision!);
    const { transport } = deferredStandaloneTransport();
    let current = project;
    let stateChanges = 0;
    const { service } = makeService('rec-standalone-src', () => current, tinCache, transport, () => {
      stateChanges += 1;
    });

    service.requestGrading(gradingId);
    await flush();
    expect(service.buildingGradingIds().has(gradingId)).toBe(true);

    const before = stateChanges;
    // No-op sweep: pending set unchanged → no state change (loop guard).
    service.reconcilePendingWithProject();
    current = moveFeatureLine(current, otherFlId, 5);
    service.reconcilePendingWithProject();
    expect(stateChanges).toBe(before);
    expect(service.buildingGradingIds().has(gradingId)).toBe(true);

    current = moveFeatureLine(current, flId, 5);
    service.reconcilePendingWithProject();
    expect(service.buildingGradingIds().has(gradingId)).toBe(false);
    expect(stateChanges).toBeGreaterThan(before);
  });

  it('target reassignment cancels the pending run', async () => {
    const { project, gradingId, otherTargetId } = standaloneWorld();
    const tinCache = createCadSurfaceCache('rec-standalone-tgt');
    const inputs = resolveGradingInputs(project, gradingId)!;
    setTin(tinCache, project, inputs.target!.id, inputs.targetRevision!);
    const { transport } = deferredStandaloneTransport();
    let current = project;
    const { service } = makeService('rec-standalone-tgt', () => current, tinCache, transport, () => undefined);

    service.requestGrading(gradingId);
    await flush();
    current = runCadCommand(createCadHistoryState(current), {
      key: 'GRADING_REASSIGN_TARGET',
      gradingId,
      targetSurfaceId: otherTargetId,
    }).present.project;
    service.reconcilePendingWithProject();
    expect(service.buildingGradingIds().has(gradingId)).toBe(false);
  });

  it('deletion cancels the pending run', async () => {
    const { project, gradingId } = standaloneWorld();
    const tinCache = createCadSurfaceCache('rec-standalone-del');
    const inputs = resolveGradingInputs(project, gradingId)!;
    setTin(tinCache, project, inputs.target!.id, inputs.targetRevision!);
    const { transport } = deferredStandaloneTransport();
    let current = project;
    const { service } = makeService('rec-standalone-del', () => current, tinCache, transport, () => undefined);

    service.requestGrading(gradingId);
    await flush();
    current = runCadCommand(createCadHistoryState(current), { key: 'GRADING_DELETE', gradingId }).present.project;
    service.reconcilePendingWithProject();
    expect(service.buildingGradingIds().has(gradingId)).toBe(false);
  });

  it('an analytic grading is unaffected by a target rebuild and republishes', async () => {
    const { project, gradingId } = analyticGradingWorld();
    const tinCache = createCadSurfaceCache('rec-analytic');
    const { transport } = deferredStandaloneTransport();
    let stateChanges = 0;
    const { service } = makeService('rec-analytic', () => project, tinCache, transport, () => {
      stateChanges += 1;
    });

    service.requestGrading(gradingId);
    await flush();
    expect(service.buildingGradingIds().has(gradingId)).toBe(true);

    const before = stateChanges;
    // A surface cache rebuild republishes, but carries no target identity, so
    // the analytic run is untouched (no dormant target wakeup).
    service.notifyTargetBuilt('some-dormant-surface');
    expect(service.buildingGradingIds().has(gradingId)).toBe(true);
    expect(stateChanges).toBe(before + 1);
  });
});

describe('pending reconciliation — grading group', () => {
  it('revision edit cancels the group pending run and its late result is ignored', async () => {
    const { project, groupId } = groupWorld();
    const tinCache = createCadSurfaceCache('rec-group-rev');
    const inputs = resolveGroupInputs(project, groupId)!;
    setTin(tinCache, project, inputs.target!.id, inputs.targetRevision!);
    const { transport, deferred } = deferredGroupTransport();
    let current = project;
    let stateChanges = 0;
    const { service, groupCache } = makeService('rec-group-rev', () => current, tinCache, transport, () => {
      stateChanges += 1;
    });

    service.requestGroupGrading(groupId);
    await flush();
    expect(service.buildingGroupIds().has(groupId)).toBe(true);

    const before = stateChanges;
    current = runCadCommand(createCadHistoryState(current), {
      key: 'GROUP_EDIT_CRITERIA',
      groupId,
      criterion: { kind: 'fixed', gradeRatio: -0.25 },
    }).present.project;
    service.reconcilePendingWithProject();
    expect(service.buildingGroupIds().has(groupId)).toBe(false);
    expect(stateChanges).toBeGreaterThan(before);

    const staleRevision = deferred[0]!.request.revision;
    deferred[0]!.resolve(computeGroup(deferred[0]!.request));
    await flush();
    expect(groupCache.get(groupId, staleRevision)).toBeUndefined();
    expect(service.groupStatusOf(groupId).status).not.toBe('CURRENT');
  });

  it('cancels only the affected source edit', async () => {
    const { project, groupId, flId, otherFlId } = groupWorld();
    const tinCache = createCadSurfaceCache('rec-group-src');
    const inputs = resolveGroupInputs(project, groupId)!;
    setTin(tinCache, project, inputs.target!.id, inputs.targetRevision!);
    const { transport } = deferredGroupTransport();
    let current = project;
    let stateChanges = 0;
    const { service } = makeService('rec-group-src', () => current, tinCache, transport, () => {
      stateChanges += 1;
    });

    service.requestGroupGrading(groupId);
    await flush();
    expect(service.buildingGroupIds().has(groupId)).toBe(true);

    const before = stateChanges;
    current = moveFeatureLine(current, otherFlId, 5);
    service.reconcilePendingWithProject();
    expect(service.buildingGroupIds().has(groupId)).toBe(true);
    expect(stateChanges).toBe(before);

    current = moveFeatureLine(current, flId, 5);
    service.reconcilePendingWithProject();
    expect(service.buildingGroupIds().has(groupId)).toBe(false);
  });
});
