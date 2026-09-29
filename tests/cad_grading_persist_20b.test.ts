/**
 * Phase 20B persist slice: WNCAD round-trip, legacy backfill, history
 * (Both-Sides atomicity, delete no-cascade, single-entry undo/redo for
 * extract/bake, target-reassign NEEDS_RECALC), save/reopen UNBUILT.
 */
import { describe, expect, it } from 'vitest';

import {
  createBlankCadDrawingDocument,
  parseCadDrawingFile,
  serializeCadDrawingFile,
} from '../src/engine/cad/cadDrawingFile';
import { cloneCadProject } from '../src/engine/cad/cadPersistence';
import { createCadSurfaceCache } from '../src/engine/cad/cadSurfaceCache';
import { buildCadSurface, computeCadSurfaceSourceRevision } from '../src/engine/cad/cadSurfaces';
import {
  createCadHistoryState,
  redoCadHistory,
  runCadCommand,
  undoCadHistory,
} from '../src/engine/cad/cadUndoRedo';
import { resolveGradingInputs } from '../src/engine/cad/grading/gradingResolve';
import { createCadGradingCache } from '../src/engine/cad/grading/gradingCache';
import { SurfaceGradingService } from '../src/workers/surfaceGradingService';
import { computeGradingFromSnapshots } from '../src/workers/surfaceGradingCompute';
import type {
  CadFeatureLineEntity,
  CadProject,
  CadSurface,
} from '../src/engine/cad/cadTypes';
import type { CadGrading } from '../src/engine/cad/grading/gradingTypes';

let seq = 0;
const nextId = (prefix: string): string => {
  seq += 1;
  return `${prefix}-20b-p${seq}`;
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

const projectWithGradingWorld = (): { project: CadProject; flId: string; targetId: string } => {
  const drawing = createBlankCadDrawingDocument({ name: 'Grading Persist', units: 'm' });
  const flId = nextId('fl');
  const targetId = nextId('tgt');
  const project: CadProject = {
    ...drawing.project,
    entities: [makeFeatureLine(flId, { x: 0, y: 0, z: 10 }, { x: 100, y: 0, z: 10 })],
    surfaces: [makeFlatTarget(targetId, 'Target')],
  };
  return { project, flId, targetId };
};

const vertexIds = (project: CadProject, flId: string): [string, string] => {
  const entity = project.entities.find((entry) => entry.id === flId) as CadFeatureLineEntity;
  return [entity.vertices[0]!.id, entity.vertices[1]!.id];
};

const createSingleGrading = (project: CadProject, flId: string, targetId: string, name: string) => {
  const [a, b] = vertexIds(project, flId);
  const state = runCadCommand(createCadHistoryState(project), {
    key: 'GRADING_CREATE',
    name,
    sourceFeatureLineId: flId,
    vertexAId: a,
    vertexBId: b,
    targetSurfaceId: targetId,
    side: 'left',
    criterion: { kind: 'fixed', gradeRatio: -0.5 },
    maxSearchDistance: 1000,
    curveChordTolerance: 0.01,
  });
  return state.present.project;
};

/** Cache a CURRENT result for the grading using the real snapshot compute. */
const calculateIntoCaches = (
  project: CadProject,
  gradingId: string,
  tinCache: ReturnType<typeof createCadSurfaceCache>,
  gradingCache: ReturnType<typeof createCadGradingCache>,
) => {
  const inputs = resolveGradingInputs(project, gradingId)!;
  const built = buildCadSurface(project, inputs.target!);
  expect(built.outcome).toBe('ok');
  const mesh = {
    revision: inputs.targetRevision!,
    points: built.points,
    triangles: built.triangles,
    stats: built.stats,
    grid: built.grid,
    adjacency: built.adjacency,
    edgeKinds: built.edgeKinds,
  };
  tinCache.set(inputs.target!.id, inputs.targetRevision!, mesh);
  const flat = (points: Array<{ x: number; y: number; z: number }>): number[] =>
    points.flatMap((p) => [p.x, p.y, p.z]);
  const outcome = computeGradingFromSnapshots({
    gradingId,
    revision: inputs.revision,
    source: inputs.resolvedSource,
    side: inputs.grading.side,
    criterion: inputs.grading.criterion,
    maxSearchDistance: inputs.grading.maxSearchDistance,
    curveChordTolerance: inputs.grading.curveChordTolerance,
    target: {
      points: flat(built.points),
      triangles: built.triangles.flatMap((tri) => [...tri]),
    },
  });
  if (!outcome.ok) throw new Error(`grading compute failed: ${outcome.code}`);
  gradingCache.set(gradingId, outcome.result);
  return { inputs, result: outcome.result };
};

const serviceFor = (
  project: CadProject,
  tinCache: ReturnType<typeof createCadSurfaceCache>,
  gradingCache: ReturnType<typeof createCadGradingCache>,
) =>
  new SurfaceGradingService({
    drawingId: 'drawing-20b',
    getProject: () => project,
    getDrawingId: () => 'drawing-20b',
    tinCache,
    gradingCache,
    createTransport: () => null,
    notify: () => undefined,
    onStateChange: () => undefined,
  });

describe('grading persistence', () => {
  it('WNCAD round-trip keeps definitions byte-exact incl curve tolerance', () => {
    const { project, flId, targetId } = projectWithGradingWorld();
    const [a, b] = vertexIds(project, flId);
    const withGrading = createSingleGrading(project, flId, targetId, 'G1');
    const grading = withGrading.gradings![0]!;
    expect(grading.curveChordTolerance).toBe(0.01);
    const drawing = { ...createBlankCadDrawingDocument({ name: 'x', units: 'm' }), project: withGrading };
    const parsed = parseCadDrawingFile(serializeCadDrawingFile(drawing));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.drawing.project.gradings).toEqual(withGrading.gradings);
    // Key order: gradings trails sharedParcelBoundaries in the serialized project.
    const keys = Object.keys(JSON.parse(serializeCadDrawingFile(drawing)).project);
    expect(keys.indexOf('gradings')).toBeGreaterThan(keys.indexOf('sharedParcelBoundaries'));
    void a;
    void b;
  });

  it('legacy files backfill gradings: [] and clone preserves key order', () => {
    const { project } = projectWithGradingWorld();
    const without: CadProject = { ...project };
    delete without.gradings;
    expect(without.gradings).toBeUndefined();
    const drawing = { ...createBlankCadDrawingDocument({ name: 'x', units: 'm' }), project: without };
    const raw = JSON.parse(serializeCadDrawingFile(drawing)) as Record<string, unknown>;
    delete (raw['project'] as Record<string, unknown>)['gradings'];
    const parsed = parseCadDrawingFile(JSON.stringify(raw));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.drawing.project.gradings).toEqual([]);
    // Clone keeps the trailing position (signature-sensitive).
    const cloned = cloneCadProject({ ...without, gradings: [{ id: 'g', name: 'G', sourceFeatureLineId: 'fl', sourceCourse: { vertexAId: 'a', vertexBId: 'b' }, targetSurfaceId: 't', side: 'left', criterion: { kind: 'fixed', gradeRatio: -0.5 }, maxSearchDistance: 10, curveChordTolerance: 0.01 }] as CadGrading[] });
    expect(cloned.gradings).toHaveLength(1);
    expect(Object.keys(cloned).indexOf('gradings')).toBeGreaterThan(Object.keys(cloned).indexOf('sharedParcelBoundaries'));
  });

  it('malformed definitions drop fail-closed, valid ones survive', () => {
    const { project, flId, targetId } = projectWithGradingWorld();
    const withGrading = createSingleGrading(project, flId, targetId, 'G1');
    const drawing = { ...createBlankCadDrawingDocument({ name: 'x', units: 'm' }), project: withGrading };
    const raw = JSON.parse(serializeCadDrawingFile(drawing)) as Record<string, unknown>;
    const proj = raw['project'] as Record<string, unknown>;
    proj['gradings'] = [
      ...((proj['gradings'] as unknown[]) ?? []),
      { id: '', name: 'Bad', criterion: { kind: 'fixed', gradeRatio: NaN } },
      { id: 'g2', name: 'Bad2', sourceFeatureLineId: flId },
    ];
    const parsed = parseCadDrawingFile(JSON.stringify(raw));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.drawing.project.gradings).toHaveLength(1);
    expect(parsed.drawing.project.gradings![0]!.name).toBe('G1');
  });

  it('save/reopen keeps definitions exact with results absent and status UNBUILT', () => {
    const { project, flId, targetId } = projectWithGradingWorld();
    const withGrading = createSingleGrading(project, flId, targetId, 'G1');
    const gradingId = withGrading.gradings![0]!.id;
    const tinCache = createCadSurfaceCache('persist-unbuilt');
    const gradingCache = createCadGradingCache('persist-unbuilt');
    calculateIntoCaches(withGrading, gradingId, tinCache, gradingCache);
    // Save/reopen: fresh session caches (results never persist).
    const drawing = { ...createBlankCadDrawingDocument({ name: 'x', units: 'm' }), project: withGrading };
    const parsed = parseCadDrawingFile(serializeCadDrawingFile(drawing));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.drawing.project.gradings).toEqual(withGrading.gradings);
    const reopened = parsed.drawing.project;
    const freshTin = createCadSurfaceCache('reopened');
    const freshGrading = createCadGradingCache('reopened');
    const service = serviceFor(reopened, freshTin, freshGrading);
    expect(service.statusOf(gradingId).status).toBe('UNBUILT');
  });

  it('Both-Sides creates the atomic pair; invalid input creates neither', () => {
    const { project, flId, targetId } = projectWithGradingWorld();
    const [a, b] = vertexIds(project, flId);
    const base = {
      key: 'GRADING_CREATE' as const,
      name: 'Both',
      sourceFeatureLineId: flId,
      vertexAId: a,
      vertexBId: b,
      targetSurfaceId: targetId,
      side: 'both' as const,
      criterion: { kind: 'fixed' as const, gradeRatio: -0.5 },
      maxSearchDistance: 100,
      curveChordTolerance: 0.01,
    };
    const done = runCadCommand(createCadHistoryState(project), base);
    const pair = done.present.project.gradings!;
    expect(pair).toHaveLength(2);
    expect(pair.map((entry) => entry.side).sort()).toEqual(['left', 'right']);
    expect(pair.map((entry) => entry.name).sort()).toEqual(['Both - Left', 'Both - Right']);
    // Invalid criterion: atomic — neither side is created.
    const bad = runCadCommand(createCadHistoryState(project), {
      ...base,
      criterion: { kind: 'cut-fill' as const, cutGradeRatio: -1, fillGradeRatio: 1 },
    });
    expect(bad.present.project.gradings ?? []).toHaveLength(0);
    expect(bad.undoStack).toHaveLength(0);
  });

  it('delete removes only the definition (extract + baked surface stay)', () => {
    const { project, flId, targetId } = projectWithGradingWorld();
    let current = createSingleGrading(project, flId, targetId, 'G1');
    const gradingId = current.gradings![0]!.id;
    const tinCache = createCadSurfaceCache('persist-nocascade');
    const gradingCache = createCadGradingCache('persist-nocascade');
    const { inputs, result } = calculateIntoCaches(current, gradingId, tinCache, gradingCache);
    let history = createCadHistoryState(current);
    history = runCadCommand(history, {
      key: 'GRADINGEXTRACTDAYLIGHT',
      gradingId,
      result,
      expectedRevision: inputs.revision,
      sessionCurrent: true,
    });
    history = runCadCommand(history, {
      key: 'GRADINGBAKE',
      gradingId,
      result,
      expectedRevision: inputs.revision,
      sessionCurrent: true,
    });
    current = history.present.project;
    const extractCount = current.entities.filter((entry) => entry.type === 'feature-line').length;
    expect(extractCount).toBe(2);
    expect(current.surfaces).toHaveLength(2);
    history = runCadCommand(history, { key: 'GRADING_DELETE', gradingId });
    current = history.present.project;
    expect(current.gradings ?? []).toHaveLength(0);
    expect(current.entities.filter((entry) => entry.type === 'feature-line')).toHaveLength(2);
    expect(current.surfaces).toHaveLength(2);
  });

  it('extract and bake are one history entry each (undo/redo)', () => {
    const { project, flId, targetId } = projectWithGradingWorld();
    const current = createSingleGrading(project, flId, targetId, 'G1');
    const gradingId = current.gradings![0]!.id;
    const tinCache = createCadSurfaceCache('persist-undoredo');
    const gradingCache = createCadGradingCache('persist-undoredo');
    const { inputs, result } = calculateIntoCaches(current, gradingId, tinCache, gradingCache);
    let history = createCadHistoryState(current);
    const depth = history.undoStack.length;
    history = runCadCommand(history, {
      key: 'GRADINGEXTRACTDAYLIGHT',
      gradingId,
      result,
      expectedRevision: inputs.revision,
      sessionCurrent: true,
    });
    expect(history.undoStack.length).toBe(depth + 1);
    history = undoCadHistory(history);
    expect(history.present.project.entities.filter((entry) => entry.type === 'feature-line')).toHaveLength(1);
    history = redoCadHistory(history);
    expect(history.present.project.entities.filter((entry) => entry.type === 'feature-line')).toHaveLength(2);
    history = runCadCommand(history, {
      key: 'GRADINGBAKE',
      gradingId,
      result,
      expectedRevision: inputs.revision,
      sessionCurrent: true,
    });
    expect(history.present.project.surfaces!).toHaveLength(2);
    history = undoCadHistory(history);
    expect(history.present.project.surfaces!).toHaveLength(1);
    history = redoCadHistory(history);
    expect(history.present.project.surfaces!).toHaveLength(2);
    const baked = history.present.project.surfaces![1]!;
    expect(baked.definition.sourceKind).toBe('explicit-tin');
    expect(baked.definition.importedTin!.provenance).toMatchObject({ kind: 'webnet-grading-bake', gradingId });
  });

  it('target reassign moves the revision to NEEDS_RECALC', () => {
    const { project, flId, targetId } = projectWithGradingWorld();
    let current = createSingleGrading(project, flId, targetId, 'G1');
    const gradingId = current.gradings![0]!.id;
    const tinCache = createCadSurfaceCache('persist-reassign');
    const gradingCache = createCadGradingCache('persist-reassign');
    calculateIntoCaches(current, gradingId, tinCache, gradingCache);
    // Second target with identical geometry (revision differs by surface id).
    const target2 = makeFlatTarget(nextId('tgt'), 'Target 2');
    current = { ...current, surfaces: [...current.surfaces!, target2] };
    const history = runCadCommand(createCadHistoryState(current), {
      key: 'GRADING_REASSIGN_TARGET',
      gradingId,
      targetSurfaceId: target2.id,
    });
    current = history.present.project;
    const inputs = resolveGradingInputs(current, gradingId)!;
    const built = buildCadSurface(current, inputs.target!);
    tinCache.set(inputs.target!.id, inputs.targetRevision!, {
      revision: inputs.targetRevision!,
      points: built.points,
      triangles: built.triangles,
      stats: built.stats,
      grid: built.grid,
      adjacency: built.adjacency,
      edgeKinds: built.edgeKinds,
    });
    const service = serviceFor(current, tinCache, gradingCache);
    const status = service.statusOf(gradingId);
    // Old result is stale for the new revision → NEEDS_RECALC, never CURRENT.
    expect(status.status).toBe('NEEDS_RECALC');
    void computeCadSurfaceSourceRevision;
  });

  it('criteria edit moves the revision (calculate produces no history)', () => {
    const { project, flId, targetId } = projectWithGradingWorld();
    const current = createSingleGrading(project, flId, targetId, 'G1');
    const gradingId = current.gradings![0]!.id;
    const before = resolveGradingInputs(current, gradingId)!.revision;
    const history = runCadCommand(createCadHistoryState(current), {
      key: 'GRADING_EDIT_CRITERIA',
      gradingId,
      criterion: { kind: 'fixed', gradeRatio: -0.25 },
    });
    const after = resolveGradingInputs(history.present.project, gradingId)!.revision;
    expect(after).not.toBe(before);
  });
});
