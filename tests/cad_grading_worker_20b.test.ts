/**
 * Phase 20B worker slice: real worker-path flat-fill (§70 20m), service
 * control plane (stale/supersede, SOURCE_NOT_CURRENT, coverage block,
 * agreement gate), §85 reverse, §86 endpoint-move NEEDS_RECALC, §96 baked
 * analytic volume 10,000 via untouched 18I, §97 extract snapshot proof,
 * §99 save/reopen recalc-same-geometry.
 */
import { describe, expect, it } from 'vitest';

import {
  createBlankCadDrawingDocument,
  parseCadDrawingFile,
  serializeCadDrawingFile,
} from '../src/engine/cad/cadDrawingFile';
import { createCadSurfaceCache } from '../src/engine/cad/cadSurfaceCache';
import { buildCadSurface } from '../src/engine/cad/cadSurfaces';
import {
  createCadHistoryState,
  runCadCommand,
} from '../src/engine/cad/cadUndoRedo';
import { createCadGradingCache } from '../src/engine/cad/grading/gradingCache';
import { resolveGradingInputs } from '../src/engine/cad/grading/gradingResolve';
import { computeGradingFromSnapshots } from '../src/workers/surfaceGradingCompute';
import {
  createSurfaceWorkerHandler,
  type SurfaceGradingRequest,
  type SurfaceWorkerRequestMessage,
  type SurfaceWorkerResponseMessage,
} from '../src/workers/surfaceWorkerHandler';
import {
  SurfaceGradingService,
  type SurfaceGradingTransport,
} from '../src/workers/surfaceGradingService';
import { computeVolumeQuantities } from '../src/workers/surfaceVolumeEngine';
import type {
  CadFeatureLineEntity,
  CadProject,
  CadSurface,
} from '../src/engine/cad/cadTypes';
import type { CadGradingResult } from '../src/engine/cad/grading/gradingTypes';

let seq = 0;
const nextId = (prefix: string): string => {
  seq += 1;
  return `${prefix}-20b-w${seq}`;
};

const makeFeatureLine = (id: string, a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): CadFeatureLineEntity => ({
  id,
  type: 'feature-line',
  layerId: 'general',
  visible: true,
  locked: false,
  name: `FL ${id}`,
  vertices: [
    { id: `feature-vertex:${id}:a`, ...a },
    { id: `feature-vertex:${id}:b`, ...b },
  ],
});

const makeFlatTarget = (id: string, name: string): CadSurface => ({
  id,
  name,
  definition: {
    sourceKind: 'explicit-tin',
    pointSource: { kind: 'points', pointEntityIds: [] },
    importedTin: {
      vertices: [-10, -10, 0, 110, -10, 0, 110, 40, 0, -10, 40, 0],
      faces: [0, 1, 2, 0, 2, 3],
      provenance: { kind: 'webnet-bake', sourceSurfaceId: 'seed', sourceSurfaceName: 'seed', sourceRevision: 'srev1:seed' },
    },
  },
  cachedRevision: null,
});

/** Hinge target: z=12 at x=0 falling to z=10 at x=50, then to z=8 at
 * x=100 (continuous; CUT left of the hinge, FILL right of it). */
const makeBreakTarget = (id: string): CadSurface => ({
  id,
  name: 'Break',
  definition: {
    sourceKind: 'explicit-tin',
    pointSource: { kind: 'points', pointEntityIds: [] },
    importedTin: {
      vertices: [0, -10, 12, 50, -10, 10, 50, 40, 10, 0, 40, 12, 50, -10, 10, 100, -10, 8, 100, 40, 8, 50, 40, 10],
      faces: [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7],
      provenance: { kind: 'webnet-bake', sourceSurfaceId: 'seed', sourceSurfaceName: 'seed', sourceRevision: 'srev1:seed' },
    },
  },
  cachedRevision: null,
});

const world = (): { project: CadProject; flId: string; targetId: string } => {
  const drawing = createBlankCadDrawingDocument({ name: 'Grading Worker', units: 'm' });
  const flId = nextId('fl');
  const targetId = nextId('tgt');
  return {
    project: {
      ...drawing.project,
      entities: [makeFeatureLine(flId, { x: 0, y: 0, z: 10 }, { x: 100, y: 0, z: 10 })],
      surfaces: [makeFlatTarget(targetId, 'Target')],
    },
    flId,
    targetId,
  };
};

const vertexIds = (project: CadProject, flId: string): [string, string] => {
  const entity = project.entities.find((entry) => entry.id === flId) as CadFeatureLineEntity;
  return [entity.vertices[0]!.id, entity.vertices[1]!.id];
};

const createFixedGrading = (project: CadProject, flId: string, targetId: string): CadProject => {
  const [a, b] = vertexIds(project, flId);
  return runCadCommand(createCadHistoryState(project), {
    key: 'GRADING_CREATE',
    name: 'G-fixed',
    sourceFeatureLineId: flId,
    vertexAId: a,
    vertexBId: b,
    targetSurfaceId: targetId,
    side: 'left',
    criterion: { kind: 'fixed', gradeRatio: -0.5 },
    maxSearchDistance: 1000,
    curveChordTolerance: 0.01,
  }).present.project;
};

const flatSnapshot = (project: CadProject, targetId: string) => {
  const target = project.surfaces!.find((entry) => entry.id === targetId)!;
  const built = buildCadSurface(project, target);
  expect(built.outcome).toBe('ok');
  return {
    points: built.points.flatMap((p) => [p.x, p.y, p.z]),
    triangles: built.triangles.flatMap((tri) => [...tri]),
    built,
  };
};

const flush = async (rounds = 5): Promise<void> => {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

describe('grading worker path', () => {
  it('§70 flat fill ties at d=20 through the REAL worker handler', async () => {
    const { project, flId, targetId } = world();
    const withGrading = createFixedGrading(project, flId, targetId);
    const gradingId = withGrading.gradings![0]!.id;
    const inputs = resolveGradingInputs(withGrading, gradingId)!;
    const snap = flatSnapshot(withGrading, targetId);
    const request: SurfaceGradingRequest = {
      gradingId,
      revision: inputs.revision,
      source: inputs.resolvedSource,
      side: 'left',
      criterion: { kind: 'fixed', gradeRatio: -0.5 },
      maxSearchDistance: 1000,
      curveChordTolerance: 0.01,
      target: { points: snap.points, triangles: snap.triangles },
    };
    const sent: SurfaceWorkerResponseMessage[] = [];
    const handler = createSurfaceWorkerHandler({
      loadBuilder: () => Promise.reject(new Error('unused')),
      postMessage: (message) => sent.push(message),
      defer: (callback) => callback(),
    });
    handler.handleMessage({ type: 'grading', requestId: 'greq-1', request } as SurfaceWorkerRequestMessage);
    await flush();
    const success = sent.find((message) => message.type === 'grading-success');
    expect(success).toBeDefined();
    if (success?.type !== 'grading-success') return;
    const result = success.result;
    expect(result.accuracy).toBe('EXACT');
    expect(result.daylightPoints).toEqual([0, 20, 0, 100, 20, 0]);
    expect(result.gradingPlanArea).toBe(2000);
    expect(result.grading3dArea).toBeCloseTo(2000 * Math.sqrt(1.25), 9);
    expect(result.minProjectionDistance).toBe(20);
    expect(result.maxProjectionDistance).toBe(20);
    expect(result.regions).toEqual([{ classification: 'FIXED', stationSpan: [0, 100] }]);
    expect(result.fillSourceLength).toBeCloseTo(100, 9);
  });

  it('cut/fill splits CUT/FILL at the exact zero crossing', () => {
    const drawing = createBlankCadDrawingDocument({ name: 'Break', units: 'm' });
    const flId = nextId('fl');
    const targetId = nextId('tgt');
    const project: CadProject = {
      ...drawing.project,
      entities: [makeFeatureLine(flId, { x: 0, y: 0, z: 10 }, { x: 100, y: 0, z: 10 })],
      surfaces: [makeBreakTarget(targetId)],
    };
    const [a, b] = vertexIds(project, flId);
    const withGrading = runCadCommand(createCadHistoryState(project), {
      key: 'GRADING_CREATE',
      name: 'G-cf',
      sourceFeatureLineId: flId,
      vertexAId: a,
      vertexBId: b,
      targetSurfaceId: targetId,
      side: 'left',
      criterion: { kind: 'cut-fill', cutGradeRatio: 0.5, fillGradeRatio: -0.5 },
      maxSearchDistance: 1000,
      curveChordTolerance: 0.01,
    }).present.project;
    const gradingId = withGrading.gradings![0]!.id;
    const inputs = resolveGradingInputs(withGrading, gradingId)!;
    const snap = flatSnapshot(withGrading, targetId);
    const outcome = computeGradingFromSnapshots({
      gradingId,
      revision: inputs.revision,
      source: inputs.resolvedSource,
      side: 'left',
      criterion: { kind: 'cut-fill', cutGradeRatio: 0.5, fillGradeRatio: -0.5 },
      maxSearchDistance: 1000,
      curveChordTolerance: 0.01,
      target: { points: snap.points, triangles: snap.triangles },
    });
    if (!outcome.ok) throw new Error(`cut/fill failed: ${outcome.code}`);
    // Hinge at u=50: CUT ties (0,4,12)→(50,0,10), FILL ties (50,0,10)→(100,4,8).
    expect(outcome.result.daylightPoints).toEqual([0, 4, 12, 50, 0, 10, 100, 4, 8]);
    expect(outcome.result.regions).toEqual([
      { classification: 'CUT', stationSpan: [0, 50] },
      { classification: 'FILL', stationSpan: [50, 100] },
    ]);
    expect(outcome.result.cutSourceLength).toBeCloseTo(50, 9);
    expect(outcome.result.fillSourceLength).toBeCloseTo(50, 9);
  });

  it('service Calculate reaches CURRENT then SOURCE_NOT_CURRENT after target loss (§88)', async () => {
    const { project, flId, targetId } = world();
    let current = createFixedGrading(project, flId, targetId);
    const gradingId = current.gradings![0]!.id;
    const tinCache = createCadSurfaceCache('w88');
    const gradingCache = createCadGradingCache('w88');
    const inputs = resolveGradingInputs(current, gradingId)!;
    const snap = flatSnapshot(current, targetId);
    tinCache.set(inputs.target.id, inputs.targetRevision, {
      revision: inputs.targetRevision,
      points: snap.built.points,
      triangles: snap.built.triangles,
      stats: snap.built.stats,
      grid: snap.built.grid,
      adjacency: snap.built.adjacency,
      edgeKinds: snap.built.edgeKinds,
    });
    const loopback = (run: (_request: SurfaceGradingRequest) => CadGradingResult): SurfaceGradingTransport => ({
      alive: true,
      deriveGrading: (request) =>
        ({ requestId: `lb-${request.gradingId}`, done: Promise.resolve(run(request)), cancel: () => undefined }),
      cancel: () => undefined,
      dispose: () => undefined,
    });
    const computeDirect = (request: SurfaceGradingRequest): CadGradingResult => {
      const outcome = computeGradingFromSnapshots(request);
      if (!outcome.ok) throw new Error(outcome.detail ?? outcome.code);
      return outcome.result;
    };
    const service = new SurfaceGradingService({
      drawingId: 'd88',
      getProject: () => current,
      getDrawingId: () => 'd88',
      tinCache,
      gradingCache,
      createTransport: () => loopback(computeDirect),
      notify: () => undefined,
      onStateChange: () => undefined,
    });
    service.requestGrading(gradingId);
    await flush();
    expect(service.statusOf(gradingId).status).toBe('CURRENT');
    // Target mesh lost (rebuild invalidated) → SOURCE_NOT_CURRENT, never CURRENT.
    tinCache.invalidate(inputs.target.id);
    expect(service.statusOf(gradingId).status).toBe('SOURCE_NOT_CURRENT');
    const blocked = service.requestGrading(gradingId);
    expect(blocked).toContain('SOURCE_NOT_CURRENT');
  });

  it('stale late results never become CURRENT (§89 supersede)', async () => {
    const { project, flId, targetId } = world();
    let current = createFixedGrading(project, flId, targetId);
    const gradingId = current.gradings![0]!.id;
    const tinCache = createCadSurfaceCache('w89');
    const gradingCache = createCadGradingCache('w89');
    const gate = (proj: CadProject) => {
      const i = resolveGradingInputs(proj, gradingId)!;
      const s = flatSnapshot(proj, i.target.id);
      tinCache.set(i.target.id, i.targetRevision, {
        revision: i.targetRevision,
        points: s.built.points,
        triangles: s.built.triangles,
        stats: s.built.stats,
        grid: s.built.grid,
        adjacency: s.built.adjacency,
        edgeKinds: s.built.edgeKinds,
      });
      return i;
    };
    gate(current);
    const resolvers: Array<(_incoming: CadGradingResult | null) => void> = [];
    const transport: SurfaceGradingTransport = {
      alive: true,
      deriveGrading: (request) => {
        const outcome = computeGradingFromSnapshots(request);
        if (!outcome.ok) throw new Error(outcome.code);
        let resolve!: (_incoming: CadGradingResult | null) => void;
        const done = new Promise<CadGradingResult | null>((res) => {
          resolve = res;
        });
        resolvers.push((incoming) => resolve(incoming));
        return { requestId: `deferred-${resolvers.length}`, done, cancel: () => undefined };
      },
      cancel: () => undefined,
      dispose: () => undefined,
    };
    const service = new SurfaceGradingService({
      drawingId: 'd89',
      getProject: () => current,
      getDrawingId: () => 'd89',
      tinCache,
      gradingCache,
      createTransport: () => transport,
      notify: () => undefined,
      onStateChange: () => undefined,
    });
    service.requestGrading(gradingId);
    await flush(2);
    expect(service.buildingGradingIds().has(gradingId)).toBe(true);
    // Revision moves (criteria edit) + second request supersedes the first.
    current = runCadCommand(createCadHistoryState(current), {
      key: 'GRADING_EDIT_CRITERIA',
      gradingId,
      criterion: { kind: 'fixed', gradeRatio: -0.25 },
    }).present.project;
    const inputs2 = gate(current);
    service.requestGrading(gradingId);
    await flush(2);
    // Late first result arrives for the superseded revision → discarded.
    const stale = computeGradingFromSnapshots({
      gradingId,
      revision: 'grev1:stale',
      source: inputs2.resolvedSource,
      side: 'left',
      criterion: { kind: 'fixed', gradeRatio: -0.5 },
      maxSearchDistance: 1000,
      curveChordTolerance: 0.01,
      target: { points: flatSnapshot(current, inputs2.target.id).points, triangles: flatSnapshot(current, inputs2.target.id).triangles },
    });
    if (!stale.ok) throw new Error('stale compute failed');
    resolvers[0]!({ ...stale.result, revision: 'grev1:stale' });
    await flush();
    expect(gradingCache.get(gradingId, inputs2.revision)).toBeUndefined();
    expect(service.statusOf(gradingId).status).not.toBe('CURRENT');
    // Current revision resolves → CURRENT.
    const fresh = computeGradingFromSnapshots({
      gradingId,
      revision: inputs2.revision,
      source: inputs2.resolvedSource,
      side: inputs2.grading.side,
      criterion: inputs2.grading.criterion,
      maxSearchDistance: inputs2.grading.maxSearchDistance,
      curveChordTolerance: inputs2.grading.curveChordTolerance,
      target: { points: flatSnapshot(current, inputs2.target.id).points, triangles: flatSnapshot(current, inputs2.target.id).triangles },
    });
    if (!fresh.ok) throw new Error('fresh compute failed');
    resolvers[1]!(fresh.result);
    await flush();
    expect(service.statusOf(gradingId).status).toBe('CURRENT');
  });

  it('cut/fill without source coverage blocks TARGET_GAP (never CURRENT)', async () => {
    const drawing = createBlankCadDrawingDocument({ name: 'Gap', units: 'm' });
    const flId = nextId('fl');
    const targetId = nextId('tgt');
    // Target far from the source: no coverage at all.
    const far: CadSurface = {
      id: targetId,
      name: 'Far',
      definition: {
        sourceKind: 'explicit-tin',
        pointSource: { kind: 'points', pointEntityIds: [] },
        importedTin: {
          vertices: [500, 500, 0, 600, 500, 0, 600, 600, 0, 500, 600, 0],
          faces: [0, 1, 2, 0, 2, 3],
          provenance: { kind: 'webnet-bake', sourceSurfaceId: 'seed', sourceSurfaceName: 'seed', sourceRevision: 'srev1:seed' },
        },
      },
      cachedRevision: null,
    };
    const project: CadProject = {
      ...drawing.project,
      entities: [makeFeatureLine(flId, { x: 0, y: 0, z: 10 }, { x: 100, y: 0, z: 10 })],
      surfaces: [far],
    };
    const [a, b] = vertexIds(project, flId);
    const withGrading = runCadCommand(createCadHistoryState(project), {
      key: 'GRADING_CREATE',
      name: 'G-gap',
      sourceFeatureLineId: flId,
      vertexAId: a,
      vertexBId: b,
      targetSurfaceId: targetId,
      side: 'left',
      criterion: { kind: 'cut-fill', cutGradeRatio: 0.5, fillGradeRatio: -0.5 },
      maxSearchDistance: 1000,
      curveChordTolerance: 0.01,
    }).present.project;
    const gradingId = withGrading.gradings![0]!.id;
    const inputs = resolveGradingInputs(withGrading, gradingId)!;
    const snap = flatSnapshot(withGrading, targetId);
    const outcome = computeGradingFromSnapshots({
      gradingId,
      revision: inputs.revision,
      source: inputs.resolvedSource,
      side: 'left',
      criterion: { kind: 'cut-fill', cutGradeRatio: 0.5, fillGradeRatio: -0.5 },
      maxSearchDistance: 1000,
      curveChordTolerance: 0.01,
      target: { points: snap.points, triangles: snap.triangles },
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('TARGET_GAP');
  });

  it('agreement gate rejects tampered daylight (never CURRENT)', async () => {
    const { project, flId, targetId } = world();
    const current = createFixedGrading(project, flId, targetId);
    const gradingId = current.gradings![0]!.id;
    const tinCache = createCadSurfaceCache('wagree');
    const gradingCache = createCadGradingCache('wagree');
    const inputs = resolveGradingInputs(current, gradingId)!;
    const snap = flatSnapshot(current, targetId);
    tinCache.set(inputs.target.id, inputs.targetRevision, {
      revision: inputs.targetRevision,
      points: snap.built.points,
      triangles: snap.built.triangles,
      stats: snap.built.stats,
      grid: snap.built.grid,
      adjacency: snap.built.adjacency,
      edgeKinds: snap.built.edgeKinds,
    });
    const good = computeGradingFromSnapshots({
      gradingId,
      revision: inputs.revision,
      source: inputs.resolvedSource,
      side: inputs.grading.side,
      criterion: inputs.grading.criterion,
      maxSearchDistance: inputs.grading.maxSearchDistance,
      curveChordTolerance: inputs.grading.curveChordTolerance,
      target: { points: snap.points, triangles: snap.triangles },
    });
    if (!good.ok) throw new Error('baseline compute failed');
    // Tamper: raise every daylight Z by 1m.
    const tampered: CadGradingResult = {
      ...good.result,
      daylightPoints: good.result.daylightPoints.map((value, index) => (index % 3 === 2 ? value + 1 : value)),
    };
    const transport: SurfaceGradingTransport = {
      alive: true,
      deriveGrading: () => ({ requestId: 'tamper-1', done: Promise.resolve(tampered), cancel: () => undefined }),
      cancel: () => undefined,
      dispose: () => undefined,
    };
    const service = new SurfaceGradingService({
      drawingId: 'dagree',
      getProject: () => current,
      getDrawingId: () => 'dagree',
      tinCache,
      gradingCache,
      createTransport: () => transport,
      notify: () => undefined,
      onStateChange: () => undefined,
    });
    service.requestGrading(gradingId);
    await flush();
    expect(gradingCache.get(gradingId, inputs.revision)).toBeUndefined();
    expect(service.statusOf(gradingId).status).toBe('FAILED');
    expect(service.gradingDiagnostics().get(gradingId)!.error).toContain('GRADING_AGREEMENT');
  });

  it('§85 reversed storage grades the same physical side', () => {
    const { project, flId, targetId } = world();
    const withGrading = createFixedGrading(project, flId, targetId);
    const gradingId = withGrading.gradings![0]!.id;
    const forward = resolveGradingInputs(withGrading, gradingId)!;
    // Reverse storage (B->A course order, same vertex ids).
    const entity = withGrading.entities.find((entry) => entry.id === flId) as CadFeatureLineEntity;
    const reversed: CadFeatureLineEntity = {
      ...entity,
      vertices: [...entity.vertices].reverse(),
    };
    const reversedProject: CadProject = {
      ...withGrading,
      entities: withGrading.entities.map((entry) => (entry.id === flId ? reversed : entry)),
    };
    const back = resolveGradingInputs(reversedProject, gradingId)!;
    expect(back.resolvedSource.reoriented).toBe(true);
    const snap = flatSnapshot(withGrading, targetId);
    const run = (source: typeof forward.resolvedSource) =>
      computeGradingFromSnapshots({
        gradingId,
        revision: 'grev1:probe',
        source,
        side: 'left',
        criterion: { kind: 'fixed', gradeRatio: -0.5 },
        maxSearchDistance: 1000,
        curveChordTolerance: 0.01,
        target: { points: snap.points, triangles: snap.triangles },
      });
    const a = run(forward.resolvedSource);
    const b = run(back.resolvedSource);
    if (!a.ok || !b.ok) throw new Error('reverse compute failed');
    // Same physical side: identical daylight geometry through the worker path.
    expect(b.result.daylightPoints).toEqual(a.result.daylightPoints);
    expect(back.revision).toBe(forward.revision);
  });

  it('§86 endpoint move drives NEEDS_RECALC', () => {
    const { project, flId, targetId } = world();
    const current = createFixedGrading(project, flId, targetId);
    const gradingId = current.gradings![0]!.id;
    const tinCache = createCadSurfaceCache('w86');
    const gradingCache = createCadGradingCache('w86');
    const inputs = resolveGradingInputs(current, gradingId)!;
    const snap = flatSnapshot(current, targetId);
    tinCache.set(inputs.target.id, inputs.targetRevision, {
      revision: inputs.targetRevision,
      points: snap.built.points,
      triangles: snap.built.triangles,
      stats: snap.built.stats,
      grid: snap.built.grid,
      adjacency: snap.built.adjacency,
      edgeKinds: snap.built.edgeKinds,
    });
    const outcome = computeGradingFromSnapshots({
      gradingId,
      revision: inputs.revision,
      source: inputs.resolvedSource,
      side: inputs.grading.side,
      criterion: inputs.grading.criterion,
      maxSearchDistance: inputs.grading.maxSearchDistance,
      curveChordTolerance: inputs.grading.curveChordTolerance,
      target: { points: snap.points, triangles: snap.triangles },
    });
    if (!outcome.ok) throw new Error('baseline compute failed');
    gradingCache.set(gradingId, outcome.result);
    // Move endpoint B +5m east (same ids, still adjacent → NEEDS_RECALC).
    const entity = current.entities.find((entry) => entry.id === flId) as CadFeatureLineEntity;
    const moved: CadFeatureLineEntity = {
      ...entity,
      vertices: entity.vertices.map((vertex, index) =>
        index === 1 ? { ...vertex, x: vertex.x + 5 } : vertex,
      ),
    };
    const movedProject: CadProject = {
      ...current,
      entities: current.entities.map((entry) => (entry.id === flId ? moved : entry)),
    };
    const service = new SurfaceGradingService({
      drawingId: 'd86',
      getProject: () => movedProject,
      getDrawingId: () => 'd86',
      tinCache,
      gradingCache,
      createTransport: () => null,
      notify: () => undefined,
      onStateChange: () => undefined,
    });
    expect(service.statusOf(gradingId).status).toBe('NEEDS_RECALC');
  });

  it('§96 baked strip reproduces the 10,000 analytic volume through ordinary 18I', () => {
    const { project, flId, targetId } = world();
    const withGrading = createFixedGrading(project, flId, targetId);
    const gradingId = withGrading.gradings![0]!.id;
    const inputs = resolveGradingInputs(withGrading, gradingId)!;
    const snap = flatSnapshot(withGrading, targetId);
    const outcome = computeGradingFromSnapshots({
      gradingId,
      revision: inputs.revision,
      source: inputs.resolvedSource,
      side: 'left',
      criterion: { kind: 'fixed', gradeRatio: -0.5 },
      maxSearchDistance: 1000,
      curveChordTolerance: 0.01,
      target: { points: snap.points, triangles: snap.triangles },
    });
    if (!outcome.ok) throw new Error('baseline compute failed');
    // Bake path: canonicalize exactly like GRADINGBAKE, then ordinary 18I.
    const history = runCadCommand(createCadHistoryState(withGrading), {
      key: 'GRADINGBAKE',
      gradingId,
      result: outcome.result,
      expectedRevision: inputs.revision,
      sessionCurrent: true,
    });
    const baked = history.present.project.surfaces!.find((entry) => entry.id !== targetId)!;
    expect(baked.definition.sourceKind).toBe('explicit-tin');
    const payload = baked.definition.importedTin!;
    // Triangular prism 100 × 20 × 10 → exactly 10,000 via ordinary 18I.
    const quantities = computeVolumeQuantities(
      { points: snap.points, triangles: snap.triangles },
      { points: payload.vertices, triangles: payload.faces },
      { includeDisplay: false },
    );
    expect(quantities.quantities.overlapArea).toBeCloseTo(2000, 9);
    const total = quantities.quantities.cutVolume + quantities.quantities.fillVolume;
    expect(total).toBeCloseTo(10000, 6);
  });

  it('§97 moving the extract leaves the grading definition and result untouched', () => {
    const { project, flId, targetId } = world();
    const withGrading = createFixedGrading(project, flId, targetId);
    const gradingId = withGrading.gradings![0]!.id;
    const inputs = resolveGradingInputs(withGrading, gradingId)!;
    const snap = flatSnapshot(withGrading, targetId);
    const outcome = computeGradingFromSnapshots({
      gradingId,
      revision: inputs.revision,
      source: inputs.resolvedSource,
      side: inputs.grading.side,
      criterion: inputs.grading.criterion,
      maxSearchDistance: inputs.grading.maxSearchDistance,
      curveChordTolerance: inputs.grading.curveChordTolerance,
      target: { points: snap.points, triangles: snap.triangles },
    });
    if (!outcome.ok) throw new Error('baseline compute failed');
    let history = createCadHistoryState(withGrading);
    history = runCadCommand(history, {
      key: 'GRADINGEXTRACTDAYLIGHT',
      gradingId,
      result: outcome.result,
      expectedRevision: inputs.revision,
      sessionCurrent: true,
    });
    const definitionsBefore = history.present.project.gradings!;
    const extract = history.present.project.entities.find(
      (entry) => entry.type === 'feature-line' && entry.id !== flId,
    )!;
    const selected = createCadHistoryState(history.present.project, [extract.id]);
    history = { ...history, present: selected.present };
    history = runCadCommand(history, { key: 'MOVE', deltaX: 5, deltaY: 7 });
    const moved = history.present.project.entities.find((entry) => entry.id === extract.id) as CadFeatureLineEntity;
    expect(moved.vertices[0]!.x).toBeCloseTo(5, 9);
    expect(moved.vertices[0]!.y).toBeCloseTo(27, 9);
    // Grading definition byte-identical; cached daylight geometry unaffected.
    expect(history.present.project.gradings).toEqual(definitionsBefore);
    expect(outcome.result.daylightPoints).toEqual([0, 20, 0, 100, 20, 0]);
  });

  it('§99 save/reopen recalculates byte-identical geometry', () => {
    const { project, flId, targetId } = world();
    const withGrading = createFixedGrading(project, flId, targetId);
    const gradingId = withGrading.gradings![0]!.id;
    const inputs = resolveGradingInputs(withGrading, gradingId)!;
    const snap = flatSnapshot(withGrading, targetId);
    const before = computeGradingFromSnapshots({
      gradingId,
      revision: inputs.revision,
      source: inputs.resolvedSource,
      side: inputs.grading.side,
      criterion: inputs.grading.criterion,
      maxSearchDistance: inputs.grading.maxSearchDistance,
      curveChordTolerance: inputs.grading.curveChordTolerance,
      target: { points: snap.points, triangles: snap.triangles },
    });
    if (!before.ok) throw new Error('baseline compute failed');
    const drawing = { ...createBlankCadDrawingDocument({ name: 'x', units: 'm' }), project: withGrading };
    const parsed = parseCadDrawingFile(serializeCadDrawingFile(drawing));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const reopened = parsed.drawing.project;
    const again = resolveGradingInputs(reopened, gradingId)!;
    expect(again.revision).toBe(inputs.revision);
    const snap2 = flatSnapshot(reopened, targetId);
    const after = computeGradingFromSnapshots({
      gradingId,
      revision: again.revision,
      source: again.resolvedSource,
      side: again.grading.side,
      criterion: again.grading.criterion,
      maxSearchDistance: again.grading.maxSearchDistance,
      curveChordTolerance: again.grading.curveChordTolerance,
      target: { points: snap2.points, triangles: snap2.triangles },
    });
    if (!after.ok) throw new Error('reopen compute failed');
    expect(after.result.daylightPoints).toEqual(before.result.daylightPoints);
    expect(after.result.gradingMesh).toEqual(before.result.gradingMesh);
  });
});
