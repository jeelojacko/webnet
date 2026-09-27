/**
 * Phase 20C Wave-3 group persistence: trailing `gradingGroups` key
 * (backfill/clone/order-stability), sanitizer fail-closed, WNCAD round-trip
 * (open + closed + cut-fill + curve groups), save/reopen definitions-exact
 * with results absent + deterministic recalc, transform passthrough.
 */
import { describe, expect, it } from 'vitest';

import {
  createBlankCadDrawingDocument,
  parseCadDrawingFile,
  serializeCadDrawingFile,
} from '../src/engine/cad/cadDrawingFile';
import { cloneCadProject } from '../src/engine/cad/cadPersistence';
import { createCadSurfaceCache } from '../src/engine/cad/cadSurfaceCache';
import { buildCadSurface } from '../src/engine/cad/cadSurfaces';
import {
  createCadHistoryState,
  runCadCommand,
} from '../src/engine/cad/cadUndoRedo';
import { resolveGroupInputs } from '../src/engine/cad/grading/gradingGroupResolve';
import { computeGradingGroupFromSnapshots } from '../src/engine/cad/grading/gradingGroupCompute';
import { SurfaceGradingService } from '../src/workers/surfaceGradingService';
import { createCadGradingCache } from '../src/engine/cad/grading/gradingCache';
import type {
  CadFeatureLineEntity,
  CadProject,
  CadSurface,
} from '../src/engine/cad/cadTypes';
import type {
  CadGradingGroup,
  CadGradingGroupResult,
} from '../src/engine/cad/grading/gradingGroupTypes';

let seq = 0;
const nextId = (prefix: string): string => {
  seq += 1;
  return `${prefix}-20c-gp${seq}`;
};

const vertex = (id: string, x: number, y: number, z: number) => ({ id, x, y, z });

const makeChainFeatureLine = (id: string): CadFeatureLineEntity => ({
  id,
  type: 'feature-line',
  layerId: 'general',
  visible: true,
  locked: false,
  name: `FL ${id}`,
  vertices: [
    vertex(`feature-vertex:${id}:a`, 0, 0, 10),
    vertex(`feature-vertex:${id}:b`, 100, 0, 10),
    vertex(`feature-vertex:${id}:c`, 100, 100, 10),
  ],
});

const makeSquareFeatureLine = (id: string): CadFeatureLineEntity => ({
  id,
  type: 'feature-line',
  layerId: 'general',
  visible: true,
  locked: false,
  name: `FL ${id}`,
  closed: true,
  vertices: [
    vertex(`feature-vertex:${id}:a`, 0, 0, 10),
    vertex(`feature-vertex:${id}:b`, 100, 0, 10),
    vertex(`feature-vertex:${id}:c`, 100, 100, 10),
    vertex(`feature-vertex:${id}:d`, 0, 100, 10),
  ],
});

const makeArcFeatureLine = (id: string): CadFeatureLineEntity => ({
  id,
  type: 'feature-line',
  layerId: 'general',
  visible: true,
  locked: false,
  name: `FL ${id}`,
  vertices: [
    vertex(`feature-vertex:${id}:a`, 50, 0, 10),
    vertex(`feature-vertex:${id}:b`, 0, 50, 10),
  ],
  segmentGeometry: [{ kind: 'arc', bulge: Math.tan(Math.PI / 8) }],
});

const makeFlatTarget = (id: string, name: string): CadSurface => ({
  id,
  name,
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

const projectWithGroupWorld = (): { project: CadProject; chainId: string; squareId: string; arcId: string; targetId: string } => {
  const drawing = createBlankCadDrawingDocument({ name: 'Group Persist', units: 'm' });
  const chainId = nextId('fl');
  const squareId = nextId('fl');
  const arcId = nextId('fl');
  const targetId = nextId('tgt');
  const project: CadProject = {
    ...drawing.project,
    entities: [makeChainFeatureLine(chainId), makeSquareFeatureLine(squareId), makeArcFeatureLine(arcId)],
    surfaces: [makeFlatTarget(targetId, 'Target')],
  };
  return { project, chainId, squareId, arcId, targetId };
};

const chainVertexIds = (project: CadProject, flId: string): string[] => {
  const entity = project.entities.find((entry) => entry.id === flId) as CadFeatureLineEntity;
  return entity.vertices.map((v) => v.id);
};

const createGroup = (
  project: CadProject,
  params: {
    name: string;
    flId: string;
    courses: Array<[string, string]>;
    targetId: string;
    criterion?: CadGradingGroup['criterion'];
    curveChordTolerance?: number;
    closed?: boolean;
  },
): CadProject => {
  const state = runCadCommand(createCadHistoryState(project), {
    key: 'GROUP_CREATE',
    name: params.name,
    sourceFeatureLineId: params.flId,
    sourceCourses: params.courses.map(([vertexAId, vertexBId]) => ({ vertexAId, vertexBId })),
    targetSurfaceId: params.targetId,
    side: 'right',
    criterion: params.criterion ?? { kind: 'fixed', gradeRatio: -0.5 },
    maxSearchDistance: 50,
    curveChordTolerance: params.curveChordTolerance ?? 0.05,
    ...(params.closed === true ? { closed: true as const } : {}),
  });
  return state.present.project;
};

/** Synchronous CURRENT result via the real snapshot compute (no worker). */
const calculateGroup = (project: CadProject, groupId: string): CadGradingGroupResult => {
  const inputs = resolveGroupInputs(project, groupId);
  if (!inputs) throw new Error('group inputs did not resolve');
  const built = buildCadSurface(project, inputs.target);
  expect(built.outcome).toBe('ok');
  if (built.outcome !== 'ok') throw new Error('target build failed');
  const flat = (points: Array<{ x: number; y: number; z: number }>): number[] =>
    points.flatMap((p) => [p.x, p.y, p.z]);
  const outcome = computeGradingGroupFromSnapshots({
    groupId,
    revision: inputs.revision,
    members: inputs.memberSources,
    side: inputs.group.side,
    criterion: inputs.group.criterion,
    maxSearchDistance: inputs.group.maxSearchDistance,
    curveChordTolerance: inputs.group.curveChordTolerance,
    closed: inputs.group.closed === true,
    target: {
      points: flat(built.points),
      triangles: built.triangles.flatMap((tri) => [...tri]),
    },
  });
  if (!outcome.ok) throw new Error(`group compute failed: ${outcome.code} ${outcome.detail}`);
  return outcome.result;
};

const roundTrip = (project: CadProject): CadProject => {
  const drawing = { ...createBlankCadDrawingDocument({ name: 'x', units: 'm' }), project };
  const parsed = parseCadDrawingFile(serializeCadDrawingFile(drawing));
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error('round-trip parse failed');
  return parsed.drawing.project;
};

describe('grading-group persistence', () => {
  it('blank drawings seed gradingGroups: [] trailing gradings', () => {
    const drawing = createBlankCadDrawingDocument({ name: 'x', units: 'm' });
    expect(drawing.project.gradingGroups).toEqual([]);
    const keys = Object.keys(drawing.project);
    expect(keys.indexOf('gradingGroups')).toBeGreaterThan(keys.indexOf('gradings'));
  });

  it('legacy files backfill gradingGroups: [] and clone preserves key order', () => {
    const { project } = projectWithGroupWorld();
    const without: CadProject = { ...project };
    delete without.gradingGroups;
    expect(without.gradingGroups).toBeUndefined();
    expect(roundTrip(without).gradingGroups).toEqual([]);
    const cloned = cloneCadProject({ ...without, gradingGroups: [] });
    expect(cloned.gradingGroups).toEqual([]);
    expect(Object.keys(cloned).indexOf('gradingGroups')).toBeGreaterThan(
      Object.keys(cloned).indexOf('gradings'),
    );
  });

  it('malformed group definitions drop fail-closed, valid ones survive', () => {
    const { project, chainId, targetId } = projectWithGroupWorld();
    const [a, b, c] = chainVertexIds(project, chainId);
    const withGroup = createGroup(project, {
      name: 'G1', flId: chainId, targetId, courses: [[a!, b!], [b!, c!]],
    });
    const drawing = { ...createBlankCadDrawingDocument({ name: 'x', units: 'm' }), project: withGroup };
    const raw = JSON.parse(serializeCadDrawingFile(drawing)) as Record<string, unknown>;
    const proj = raw['project'] as Record<string, unknown>;
    proj['gradingGroups'] = [
      ...((proj['gradingGroups'] as unknown[]) ?? []),
      { id: '', name: 'Bad', sourceCourses: [] },
      { id: 'g2', name: 'Bad2', sourceFeatureLineId: chainId, sourceCourses: [{ vertexAId: a, vertexBId: c }] },
      { id: 'g3', name: 'Bad3', sourceFeatureLineId: chainId, sourceCourses: [{ vertexAId: a, vertexBId: b }], criterion: { kind: 'fixed', gradeRatio: NaN } },
    ];
    const parsed = parseCadDrawingFile(JSON.stringify(raw));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.drawing.project.gradingGroups).toHaveLength(1);
    expect(parsed.drawing.project.gradingGroups![0]!.name).toBe('G1');
  });

  it('WNCAD round-trips open + closed + cut-fill + curve groups byte-exact', () => {
    const { project, chainId, squareId, arcId, targetId } = projectWithGroupWorld();
    const [a, b, c] = chainVertexIds(project, chainId);
    const [s0, s1, s2, s3] = chainVertexIds(project, squareId);
    const [r0, r1] = chainVertexIds(project, arcId);
    let withGroups = createGroup(project, {
      name: 'Open', flId: chainId, targetId, courses: [[a!, b!], [b!, c!]],
    });
    withGroups = createGroup(withGroups, {
      name: 'Pad', flId: squareId, targetId,
      courses: [[s0!, s1!], [s1!, s2!], [s2!, s3!], [s3!, s0!]],
      closed: true,
    });
    withGroups = createGroup(withGroups, {
      name: 'CutFill', flId: chainId, targetId, courses: [[a!, b!], [b!, c!]],
      criterion: { kind: 'cut-fill', cutGradeRatio: 0.5, fillGradeRatio: -0.5 },
    });
    withGroups = createGroup(withGroups, {
      name: 'Curve', flId: arcId, targetId, courses: [[r0!, r1!]],
      curveChordTolerance: 0.5,
    });
    expect(withGroups.gradingGroups).toHaveLength(4);
    const reopened = roundTrip(withGroups);
    expect(reopened.gradingGroups).toEqual(withGroups.gradingGroups);
    expect(reopened.gradingGroups!.find((g) => g.name === 'Pad')!.closed).toBe(true);
    expect(reopened.gradingGroups!.find((g) => g.name === 'CutFill')!.criterion).toEqual(
      { kind: 'cut-fill', cutGradeRatio: 0.5, fillGradeRatio: -0.5 },
    );
    expect(reopened.gradingGroups!.find((g) => g.name === 'Curve')!.curveChordTolerance).toBe(0.5);
    // Key order: gradingGroups trails gradings in the serialized project.
    const drawing = { ...createBlankCadDrawingDocument({ name: 'x', units: 'm' }), project: withGroups };
    const keys = Object.keys(JSON.parse(serializeCadDrawingFile(drawing)).project);
    expect(keys.indexOf('gradingGroups')).toBeGreaterThan(keys.indexOf('gradings'));
  });

  it('save/reopen keeps definitions exact with results absent and recalc deterministic', () => {
    const { project, squareId, targetId } = projectWithGroupWorld();
    const [s0, s1, s2, s3] = chainVertexIds(project, squareId);
    const withGroup = createGroup(project, {
      name: 'Pad', flId: squareId, targetId,
      courses: [[s0!, s1!], [s1!, s2!], [s2!, s3!], [s3!, s0!]],
      closed: true,
    });
    const groupId = withGroup.gradingGroups![0]!.id;
    const before = calculateGroup(withGroup, groupId);
    expect(before.gradingPlanArea).toBeGreaterThan(0);
    const reopened = roundTrip(withGroup);
    expect(reopened.gradingGroups).toEqual(withGroup.gradingGroups);
    // Results never persist: a fresh session opens UNBUILT.
    const service = new SurfaceGradingService({
      drawingId: 'drawing-20c',
      getProject: () => reopened,
      getDrawingId: () => 'drawing-20c',
      tinCache: createCadSurfaceCache('reopened'),
      gradingCache: createCadGradingCache('reopened'),
      createTransport: () => null,
      notify: () => undefined,
      onStateChange: () => undefined,
    });
    expect(service.groupStatusOf(groupId).status).toBe('UNBUILT');
    // Recalculation is deterministic: same revision, same daylight digest.
    const after = calculateGroup(reopened, groupId);
    expect(after.revision).toBe(before.revision);
    expect(after.daylightPoints).toEqual(before.daylightPoints);
    expect(after.gradingMesh.triangles).toEqual(before.gradingMesh.triangles);
    service.dispose();
  });

  it('project signatures do not ping-pong: clone → serialize is key-order stable', () => {
    const { project, chainId, targetId } = projectWithGroupWorld();
    const [a, b, c] = chainVertexIds(project, chainId);
    const withGroup = createGroup(project, {
      name: 'G1', flId: chainId, targetId, courses: [[a!, b!], [b!, c!]],
    });
    const drawing = { ...createBlankCadDrawingDocument({ name: 'x', units: 'm' }), project: withGroup };
    const first = serializeCadDrawingFile(drawing);
    const parsed = parseCadDrawingFile(first);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const cloned = cloneCadProject(parsed.drawing.project);
    const second = serializeCadDrawingFile({ ...parsed.drawing, project: cloned });
    expect(JSON.parse(second).project.gradingGroups).toEqual(JSON.parse(first).project.gradingGroups);
    expect(Object.keys(JSON.parse(second).project)).toEqual(Object.keys(JSON.parse(first).project));
  });

  it('PROJECTTRANSFORM and GRIDGROUND pass groups through; revision moves', () => {
    const { project, chainId, targetId } = projectWithGroupWorld();
    const [a, b, c] = chainVertexIds(project, chainId);
    const withGroup = createGroup(project, {
      name: 'G1', flId: chainId, targetId, courses: [[a!, b!], [b!, c!]],
    });
    const groupId = withGroup.gradingGroups![0]!.id;
    const revisionBefore = resolveGroupInputs(withGroup, groupId)!.revision;
    const pairs = [
      { sourceE: 0, sourceN: 0, targetE: 100, targetN: 50 },
      { sourceE: 100, sourceN: 0, targetE: 200, targetN: 50 },
    ];
    const moved = runCadCommand(createCadHistoryState(withGroup), {
      key: 'PROJECTTRANSFORM',
      request: { kind: 'HELMERT_2D', mode: 'RIGID', pairs },
    });
    const after = moved.present.project;
    // Refs remain, ratios fixed, distance-likes untouched (20B semantics).
    expect(after.gradingGroups).toEqual(withGroup.gradingGroups);
    // Result invalidated: source/target geometry moved, so the revision moved.
    expect(resolveGroupInputs(after, groupId)!.revision).not.toBe(revisionBefore);
    // GRIDGROUND (selection-scoped) also preserves the group table.
    const ground = runCadCommand(createCadHistoryState(after, [chainId]), {
      key: 'GRIDGROUND',
      originE: 0,
      originN: 0,
      combinedScaleFactor: 1.0001,
      direction: 'GRID_TO_GROUND',
    });
    expect(ground.present.project.gradingGroups).toEqual(withGroup.gradingGroups);
  });
});
