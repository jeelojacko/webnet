/**
 * Phase 20C Wave-2B — group worker/service/resolve plumbing oracles.
 *
 * Resolve chain checks (open, inserted-vertex break, closed loop, closed
 * self-intersection), the real worker protocol round-trip through the REAL
 * engine kernel, service CURRENT agreement, SOURCE_NOT_CURRENT gate,
 * stale-revision discard, and request-key ownership.
 *
 * Wave-2B.1: the group kernel (`gradingGroupCompute.ts`) has landed, so the
 * worker/service tests run `computeGradingGroupFromSnapshots` end-to-end on a
 * tiny flat TIN — no stubs.
 */
import { describe, expect, it } from 'vitest';

import { createBlankCadDrawingDocument } from '../src/engine/cad/cadDrawingFile';
import { createCadSurfaceCache } from '../src/engine/cad/cadSurfaceCache';
import { buildCadSurface } from '../src/engine/cad/cadSurfaces';
import { createCadGradingCache } from '../src/engine/cad/grading/gradingCache';
import { computeGradingGroupFromSnapshots } from '../src/engine/cad/grading/gradingGroupCompute';
import {
  resolveGroupInputs,
  resolveGroupInputsWithReason,
} from '../src/engine/cad/grading/gradingGroupResolve';
import type {
  CadGradingGroup,
  CadGradingGroupResult,
} from '../src/engine/cad/grading/gradingGroupTypes';
import type { GradingCriterion } from '../src/engine/cad/grading/gradingTypes';
import type { CadFeatureLineEntity, CadProject, CadSurface } from '../src/engine/cad/cadTypes';
import {
  createSurfaceWorkerHandler,
  type GradingGroupComputeRequest,
  type SurfaceWorkerRequestMessage,
  type SurfaceWorkerResponseMessage,
} from '../src/workers/surfaceWorkerHandler';
import {
  SurfaceGradingService,
  type SurfaceGradingTransport,
} from '../src/workers/surfaceGradingService';
import type { PendingSurfaceGroupGrading } from '../src/workers/surfaceWorkerClient';

let seq = 0;
const nextId = (prefix: string): string => {
  seq += 1;
  return `${prefix}-20c-w2b-${seq}`;
};

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

const makeProject = (
  entities: CadProject['entities'],
  surfaces: CadSurface[],
  groups: CadGradingGroup[],
): CadProject =>
  ({
    ...createBlankCadDrawingDocument({ name: 'Groups', units: 'm' }).project,
    entities,
    surfaces,
    gradingGroups: groups,
  }) as CadProject;

const groupOf = (
  flId: string,
  targetId: string,
  courseIndices: Array<[number, number]>,
  closed = false,
): CadGradingGroup => ({
  id: nextId('grp'),
  name: 'Pad',
  sourceFeatureLineId: flId,
  sourceCourses: courseIndices.map(([a, b]) => ({
    vertexAId: `${flId}:v${a}`,
    vertexBId: `${flId}:v${b}`,
  })),
  targetSurfaceId: targetId,
  side: 'left',
  criterion: { kind: 'fixed', gradeRatio: -0.5 },
  maxSearchDistance: 1000,
  curveChordTolerance: 0.01,
  cornerMode: 'miter',
  ...(closed ? { closed: true } : {}),
});

const groupsOf = (project: CadProject): CadGradingGroup[] =>
  (project as CadProject & { gradingGroups: CadGradingGroup[] }).gradingGroups;

const flatSnapshot = (project: CadProject, targetId: string) => {
  const target = project.surfaces!.find((entry) => entry.id === targetId)!;
  const built = buildCadSurface(project, target);
  expect(built.outcome).toBe('ok');
  return {
    points: built.points.flatMap((point) => [point.x, point.y, point.z]),
    triangles: built.triangles.flatMap((triangle) => [...triangle]),
    built,
  };
};

const flush = async (rounds = 5): Promise<void> => {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

/** A well-formed group result whose daylight lies on the flat z=0 TIN. */
const withCriterion = (
  project: CadProject,
  groupId: string,
  criterion: GradingCriterion,
): CadProject =>
  ({
    ...project,
    gradingGroups: groupsOf(project).map((group) =>
      group.id === groupId ? { ...group, criterion } : group,
    ),
  }) as CadProject;

const openWorld = () => {
  const flId = nextId('fl');
  const targetId = nextId('tgt');
  const project = makeProject(
    [
      makeFeatureLine(flId, [
        { x: 0, y: 0, z: 10 },
        { x: 50, y: 0, z: 10 },
        { x: 50, y: 50, z: 10 },
      ]),
    ],
    [makeFlatTarget(targetId)],
    [groupOf(flId, targetId, [[0, 1], [1, 2]])],
  );
  const groupId = groupsOf(project)[0]!.id;
  return { project, flId, targetId, groupId };
};

const setTin = (
  tinCache: ReturnType<typeof createCadSurfaceCache>,
  project: CadProject,
  targetId: string,
) => {
  const inputs = resolveGroupInputs(project, groupsOf(project)[0]!.id)!;
  const snap = flatSnapshot(project, targetId);
  tinCache.set(inputs.target.id, inputs.targetRevision, {
    revision: inputs.targetRevision,
    points: snap.built.points,
    triangles: snap.built.triangles,
    stats: snap.built.stats,
    grid: snap.built.grid,
    adjacency: snap.built.adjacency,
    edgeKinds: snap.built.edgeKinds,
  });
  return inputs;
};

const makeService = (
  drawingId: string,
  getProject: () => CadProject,
  tinCache: ReturnType<typeof createCadSurfaceCache>,
  transport: SurfaceGradingTransport | null,
) =>
  new SurfaceGradingService({
    drawingId,
    getProject,
    getDrawingId: () => drawingId,
    tinCache,
    gradingCache: createCadGradingCache(drawingId),
    createTransport: () => transport,
    notify: () => undefined,
    onStateChange: () => undefined,
  });

/** Real engine result for a request (throws on a fail-closed outcome). */
const computeGroupResult = (request: GradingGroupComputeRequest): CadGradingGroupResult => {
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

const loopbackGroupTransport = (): SurfaceGradingTransport => ({
  alive: true,
  deriveGrading: () => {
    throw new Error('unused');
  },
  deriveGroupGrading: (request) => ({
    requestId: `lb-${request.groupId}`,
    done: Promise.resolve(computeGroupResult(request)),
    cancel: () => undefined,
  }),
  cancel: () => undefined,
  dispose: () => undefined,
});

describe('grading group resolve', () => {
  it('resolves a contiguous open A->B chain', () => {
    const { project, groupId } = openWorld();
    const inputs = resolveGroupInputs(project, groupId);
    expect(inputs).not.toBeNull();
    expect(inputs!.memberSources).toHaveLength(2);
    expect(inputs!.memberSources[0]!.reoriented).toBe(false);
    expect(inputs!.memberSources[0]!.length).toBeCloseTo(50, 9);
    expect(inputs!.memberSources[1]!.length).toBeCloseTo(50, 9);
    expect(inputs!.revision.startsWith('ggrev1:')).toBe(true);
    expect(inputs!.targetRevision.startsWith('srev1:')).toBe(true);
  });

  it('fails closed when an inserted vertex breaks chain adjacency', () => {
    const flId = nextId('fl');
    const targetId = nextId('tgt');
    // Current FL: v0-v1, v1-v2, v2-v3 (v2 inserted) — the group still asks for v1->v3.
    const project = makeProject(
      [
        makeFeatureLine(flId, [
          { x: 0, y: 0, z: 10 },
          { x: 50, y: 0, z: 10 },
          { x: 60, y: 0, z: 10 },
          { x: 50, y: 50, z: 10 },
        ]),
      ],
      [makeFlatTarget(targetId)],
      [groupOf(flId, targetId, [[0, 1], [1, 3]])],
    );
    const groupId = groupsOf(project)[0]!.id;
    expect(resolveGroupInputs(project, groupId)).toBeNull();
    const outcome = resolveGroupInputsWithReason(project, groupId);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toContain('missing from the current source');
  });

  it('resolves a closed four-course loop', () => {
    const flId = nextId('fl');
    const targetId = nextId('tgt');
    const project = makeProject(
      [
        makeFeatureLine(
          flId,
          [
            { x: 0, y: 0, z: 10 },
            { x: 20, y: 0, z: 10 },
            { x: 20, y: 20, z: 10 },
            { x: 0, y: 20, z: 10 },
          ],
          true,
        ),
      ],
      [makeFlatTarget(targetId)],
      [groupOf(flId, targetId, [[0, 1], [1, 2], [2, 3], [3, 0]], true)],
    );
    const groupId = groupsOf(project)[0]!.id;
    const inputs = resolveGroupInputs(project, groupId);
    expect(inputs).not.toBeNull();
    expect(inputs!.memberSources).toHaveLength(4);
  });

  it('rejects a self-intersecting closed loop', () => {
    const flId = nextId('fl');
    const targetId = nextId('tgt');
    // Bowtie: courses v0->v1 and v2->v3 cross between shared-chain neighbours.
    const project = makeProject(
      [
        makeFeatureLine(
          flId,
          [
            { x: 0, y: 0, z: 10 },
            { x: 20, y: 20, z: 10 },
            { x: 0, y: 20, z: 10 },
            { x: 20, y: 0, z: 10 },
          ],
          true,
        ),
      ],
      [makeFlatTarget(targetId)],
      [groupOf(flId, targetId, [[0, 1], [1, 2], [2, 3], [3, 0]], true)],
    );
    const groupId = groupsOf(project)[0]!.id;
    expect(resolveGroupInputs(project, groupId)).toBeNull();
    const outcome = resolveGroupInputsWithReason(project, groupId);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toContain('self-intersect');
  });
});

describe('grading group worker protocol', () => {
  it('round-trips a group request through the REAL handler and kernel', async () => {
    const { project, targetId, groupId } = openWorld();
    const inputs = resolveGroupInputs(project, groupId)!;
    const snap = flatSnapshot(project, targetId);
    const request: GradingGroupComputeRequest = {
      groupId,
      revision: inputs.revision,
      drawingId: 'd-worker',
      memberSources: inputs.memberSources,
      side: 'left',
      criterion: { kind: 'fixed', gradeRatio: -0.5 },
      maxSearchDistance: 1000,
      curveChordTolerance: 0.01,
      closed: false,
      target: { points: snap.points, triangles: snap.triangles },
    };
    const sent: SurfaceWorkerResponseMessage[] = [];
    const handler = createSurfaceWorkerHandler({
      loadBuilder: () => Promise.reject(new Error('unused')),
      postMessage: (message) => sent.push(message),
      defer: (callback) => callback(),
    });
    handler.handleMessage({
      type: 'group-grading',
      requestId: 'ggreq-1',
      request,
    } as SurfaceWorkerRequestMessage);
    await flush();
    const success = sent.find((message) => message.type === 'group-success');
    expect(success).toBeDefined();
    if (success?.type !== 'group-success') return;
    expect(success.groupId).toBe(groupId);
    expect(success.groupRevision).toBe(inputs.revision);
    expect(success.result.memberCount).toBe(2);
    expect(success.result.cornerCount).toBe(1);
    expect(success.result.daylightPoints.length).toBeGreaterThan(0);
  });

  it('latest-wins: a superseded group revision is not posted', async () => {
    const { project, targetId, groupId } = openWorld();
    const inputs = resolveGroupInputs(project, groupId)!;
    const snap = flatSnapshot(project, targetId);
    const sent: SurfaceWorkerResponseMessage[] = [];
    const handler = createSurfaceWorkerHandler({
      loadBuilder: () => Promise.reject(new Error('unused')),
      postMessage: (message) => sent.push(message),
      defer: (callback) => callback(),
    });
    const base = {
      groupId,
      drawingId: 'd-latest',
      memberSources: inputs.memberSources,
      side: 'left' as const,
      criterion: { kind: 'fixed' as const, gradeRatio: -0.5 },
      maxSearchDistance: 1000,
      curveChordTolerance: 0.01,
      closed: false,
      target: { points: snap.points, triangles: snap.triangles },
    };
    handler.handleMessage({
      type: 'group-grading',
      requestId: 'ggreq-a',
      request: { ...base, revision: 'ggrev1:old' },
    } as SurfaceWorkerRequestMessage);
    handler.handleMessage({
      type: 'group-grading',
      requestId: 'ggreq-b',
      request: { ...base, revision: 'ggrev1:new' },
    } as SurfaceWorkerRequestMessage);
    await flush();
    const successes = sent.filter((message) => message.type === 'group-success');
    expect(successes).toHaveLength(1);
    if (successes[0]?.type !== 'group-success') return;
    expect(successes[0].groupRevision).toBe('ggrev1:new');
  });
});

interface DeferredGroupRequest {
  request: GradingGroupComputeRequest;
  resolve: (_result: CadGradingGroupResult | null) => void;
}

const deferredGroupTransport = (): {
  transport: SurfaceGradingTransport;
  deferred: DeferredGroupRequest[];
} => {
  const deferred: DeferredGroupRequest[] = [];
  const transport: SurfaceGradingTransport = {
    alive: true,
    deriveGrading: () => {
      throw new Error('unused');
    },
    deriveGroupGrading: (request): PendingSurfaceGroupGrading => {
      let resolve!: (_result: CadGradingGroupResult | null) => void;
      const done = new Promise<CadGradingGroupResult | null>((res) => {
        resolve = res;
      });
      deferred.push({ request, resolve });
      return { requestId: `deferred-${deferred.length}`, done, cancel: () => undefined };
    },
    cancel: () => undefined,
    dispose: () => undefined,
  };
  return { transport, deferred };
};

describe('grading group service', () => {
  it('reaches CURRENT agreement end-to-end', async () => {
    const { project, targetId, groupId } = openWorld();
    const tinCache = createCadSurfaceCache('grp-current');
    setTin(tinCache, project, targetId);
    const service = makeService('dgrp-current', () => project, tinCache, loopbackGroupTransport());
    service.requestGroupGrading(groupId);
    await flush();
    expect(service.groupStatusOf(groupId).status).toBe('CURRENT');
  });

  it('gates SOURCE_NOT_CURRENT after the target TIN is lost', async () => {
    const { project, targetId, groupId } = openWorld();
    const tinCache = createCadSurfaceCache('grp-stale-target');
    const inputs = setTin(tinCache, project, targetId);
    const service = makeService('dgrp-stale-target', () => project, tinCache, loopbackGroupTransport());
    service.requestGroupGrading(groupId);
    await flush();
    expect(service.groupStatusOf(groupId).status).toBe('CURRENT');
    tinCache.invalidate(inputs.target.id);
    expect(service.groupStatusOf(groupId).status).toBe('SOURCE_NOT_CURRENT');
    expect(service.requestGroupGrading(groupId)).toContain('SOURCE_NOT_CURRENT');
  });

  it('discards a late real result for a superseded revision', async () => {
    const { project, targetId, groupId } = openWorld();
    let current = project;
    const tinCache = createCadSurfaceCache('grp-rev');
    setTin(tinCache, project, targetId);
    const { transport, deferred } = deferredGroupTransport();
    const service = makeService('dgrp-rev', () => current, tinCache, transport);
    service.requestGroupGrading(groupId);
    await flush(2);
    expect(service.buildingGroupIds().has(groupId)).toBe(true);
    // Move the group revision (criterion edit), then request again.
    current = withCriterion(current, groupId, { kind: 'fixed', gradeRatio: -0.25 });
    service.requestGroupGrading(groupId);
    await flush(2);
    expect(deferred).toHaveLength(2);
    // The stale first request resolves with a REAL result — still discarded.
    deferred[0]!.resolve(computeGroupResult(deferred[0]!.request));
    await flush();
    expect(service.groupStatusOf(groupId).status).not.toBe('CURRENT');
    deferred[1]!.resolve(computeGroupResult(deferred[1]!.request));
    await flush();
    expect(service.groupStatusOf(groupId).status).toBe('CURRENT');
  });

  it('discards a late result owned by a superseded request key', async () => {
    // Same revision: ownership is the requestId, not the revision.
    const { project, targetId, groupId } = openWorld();
    const tinCache = createCadSurfaceCache('grp-owner');
    setTin(tinCache, project, targetId);
    const { transport, deferred } = deferredGroupTransport();
    const service = makeService('dgrp-owner', () => project, tinCache, transport);
    service.requestGroupGrading(groupId);
    await flush(2);
    service.requestGroupGrading(groupId);
    await flush(2);
    expect(deferred).toHaveLength(2);
    // Tampered late first result: must never reach the cache or FAILED.
    const tampered: CadGradingGroupResult = {
      ...computeGroupResult(deferred[0]!.request),
      daylightPoints: [0, 0, 5, 50, 0, 5, 50, 50, 5],
    };
    deferred[0]!.resolve(tampered);
    await flush();
    expect(service.groupStatusOf(groupId).status).not.toBe('CURRENT');
    expect(service.groupStatusOf(groupId).status).not.toBe('FAILED');
    deferred[1]!.resolve(computeGroupResult(deferred[1]!.request));
    await flush();
    expect(service.groupStatusOf(groupId).status).toBe('CURRENT');
  });
});
