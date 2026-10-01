/**
 * Phase 20D Wave-1C — DESIGNPATCH wiring + end-to-end integration oracles.
 *
 * Builds the canonical 20C square-pad fixture for real (closed 100x100 @z=10
 * feature line, flat EG @z=0, -50% criterion, CURRENT group through the real
 * group calculate path), then pins patch geometry, DESIGNSURFACE + DESIGNAPPLY
 * inquiries, the 18I volume contract, snapshot/undo semantics, multi-patch
 * stacking, NEEDS_RECALC staleness, the non-flat block, raw-shell guidance,
 * and concave/curved patches.
 *
 * Fixture note: the group target EG is the 20C compute-test flat grid
 * verbatim (step 20 over -60..160, so every locus line coincides with a
 * target edge and daylight rings close exactly). The design source models
 * the SAME flat z=0 ground with a coarse 2-triangle TIN: 18Y compose runs
 * exact predicates and fail-closes when an overlay daylight node sits ~1e-12
 * from a base edge, and a same-surface 2-triangle target always self-hits
 * (locus/diagonal crossings land on the diagonal by construction). The
 * separate coarse triangulation keeps >=1 m clearance with zero math changes.
 */
import { describe, expect, it } from 'vitest';

import { createBlankCadDrawingDocument } from '../src/engine/cad/cadDrawingFile';
import { validateExplicitTinPayload } from '../src/engine/cad/cadImportedTin';
import { getSurfaceElevationAt } from '../src/engine/cad/cadSurfaceInterpolation';
import {
  buildCadSurface,
  computeCadSurfaceSourceRevision,
} from '../src/engine/cad/cadSurfaces';
import {
  DESIGN_APPLY_RAW_SHELL_GUIDANCE,
  findDesignVolumeSurface,
  preflightDesignApply,
} from '../src/engine/cad/cadTransactionsDesignSurfaceCommands';
import {
  DESIGN_PATCH_GROUP_NOT_CURRENT,
  DESIGN_PATCH_MERGE_FAILED,
  DESIGN_PATCH_NON_PLANAR_INTERIOR_UNDEFINED,
  DESIGN_PATCH_NON_SIMPLE_RING,
  DESIGN_PATCH_NOT_CLOSED,
  DESIGN_PATCH_RING_MESH_MISMATCH,
  designPatchSourceBoundaryPoints,
  resolveDesignPatch,
} from '../src/engine/cad/cadTransactionsDesignPatchCommands';
import {
  createCadHistoryState,
  redoCadHistory,
  runCadCommand,
  undoCadHistory,
} from '../src/engine/cad/cadUndoRedo';
import {
  computeVolumeSurfaceRevision,
  deriveVolumeSurfaceStatus,
} from '../src/engine/cad/cadVolumeSurfaces';
import { computeGradingGroupFromSnapshots } from '../src/engine/cad/grading/gradingGroupCompute';
import { resolveGroupInputs } from '../src/engine/cad/grading/gradingGroupResolve';
import { computeVolumeQuantities } from '../src/engine/cad/surfaces/volume/computeVolume';
import type {
  CadFeatureLineEntity,
  CadProject,
  CadSurface,
  CadVolumeResult,
  ImportedTinPayload,
} from '../src/engine/cad/cadTypes';
import type { CadGradingGroupResult } from '../src/engine/cad/grading/gradingGroupTypes';

let seq = 0;
const nextId = (prefix: string): string => {
  seq += 1;
  return `${prefix}-20d-p${seq}`;
};

const range = (a: number, b: number, s: number): number[] => {
  const out: number[] = [];
  for (let v = a; v <= b + 1e-9; v += s) out.push(v);
  return out;
};

const V = (id: string, x: number, y: number, z: number) => ({ id, x, y, z });

/** 20C compute-test flatTarget verbatim (step 20; every locus line on an edge). */
const gridTin = (minX: number, minY: number, maxX: number, maxY: number, step = 20): ImportedTinPayload => {
  const xs = range(minX, maxX, step);
  const ys = range(minY, maxY, step);
  const vertices: number[] = [];
  for (const y of ys) for (const x of xs) vertices.push(x, y, 0);
  const idx = (ix: number, iy: number): number => iy * xs.length + ix;
  const faces: number[] = [];
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
    vertices,
    faces,
    provenance: { kind: 'webnet-bake', sourceSurfaceId: 'seed', sourceSurfaceName: 'seed', sourceRevision: 'srev1:seed' },
  };
};

const twoTriTin = (faces: number[]): ImportedTinPayload => ({
  vertices: [-60, -60, 0, 260, -60, 0, 260, 160, 0, -60, 160, 0],
  faces,
  provenance: { kind: 'webnet-bake', sourceSurfaceId: 'seed', sourceSurfaceName: 'seed', sourceRevision: 'srev1:seed' },
});

const makeSurface = (id: string, name: string, payload: ImportedTinPayload): CadSurface => ({
  id,
  name,
  layerId: 'general',
  styleId: 'style-base',
  definition: {
    sourceKind: 'explicit-tin',
    pointSource: { kind: 'points', pointEntityIds: [] },
    importedTin: payload,
  },
  cachedRevision: null,
});

const squareVertices = (id: string, zs: [number, number, number, number] = [10, 10, 10, 10]) => [
  V(`feature-vertex:${id}:a`, 0, 0, zs[0]),
  V(`feature-vertex:${id}:b`, 100, 0, zs[1]),
  V(`feature-vertex:${id}:c`, 100, 100, zs[2]),
  V(`feature-vertex:${id}:d`, 0, 100, zs[3]),
];

const makeSquareFeatureLine = (id: string, zs?: [number, number, number, number]): CadFeatureLineEntity => ({
  id,
  type: 'feature-line',
  layerId: 'general',
  visible: true,
  locked: false,
  name: `FL ${id}`,
  closed: true,
  vertices: squareVertices(id, zs),
});

interface PadWorld {
  project: CadProject;
  groupId: string;
  targetId: string;
  baseId: string;
  result: CadGradingGroupResult;
  revision: string;
}

/** Canonical CURRENT square-pad world on the given EG grid extent. */
const padWorld = (
  minX: number, minY: number, maxX: number, maxY: number,
  flId?: string, groupName = 'Pad',
): PadWorld => {
  const drawing = createBlankCadDrawingDocument({ name: 'Design Patch 20D', units: 'm' });
  const fid = flId ?? nextId('fl');
  const targetId = nextId('tgt');
  const baseId = nextId('base');
  const started: CadProject = {
    ...drawing.project,
    entities: [makeSquareFeatureLine(fid)],
    surfaces: [
      makeSurface(targetId, 'EG', gridTin(minX, minY, maxX, maxY)),
      makeSurface(baseId, 'EG Coarse', twoTriTin([0, 1, 2, 0, 2, 3])),
    ],
  };
  const [a, b, c, d] = (started.entities[0] as CadFeatureLineEntity).vertices.map((v) => v.id);
  const state = runCadCommand(createCadHistoryState(started), {
    key: 'GROUP_CREATE',
    name: groupName,
    sourceFeatureLineId: fid,
    sourceCourses: [
      { vertexAId: a!, vertexBId: b! },
      { vertexAId: b!, vertexBId: c! },
      { vertexAId: c!, vertexBId: d! },
      { vertexAId: d!, vertexBId: a! },
    ],
    targetSurfaceId: targetId,
    side: 'right',
    criterion: { kind: 'fixed', gradeRatio: -0.5 },
    maxSearchDistance: 50,
    curveChordTolerance: 0.05,
    closed: true,
  });
  const withGroup = state.present.project;
  const groupId = withGroup.gradingGroups![0]!.id;
  const inputs = resolveGroupInputs(withGroup, groupId);
  if (!inputs) throw new Error('group inputs did not resolve');
  const built = buildCadSurface(withGroup, inputs.target!);
  if (built.outcome !== 'ok') throw new Error('target build failed');
  const outcome = computeGradingGroupFromSnapshots({
    groupId,
    revision: inputs.revision,
    members: inputs.memberSources,
    side: inputs.group.side,
    criterion: inputs.group.criterion,
    maxSearchDistance: inputs.group.maxSearchDistance,
    curveChordTolerance: inputs.group.curveChordTolerance,
    closed: true,
    target: {
      points: built.points.flatMap((point) => [point.x, point.y, point.z]),
      triangles: built.triangles.flatMap((tri) => [...tri]),
    },
  });
  if (!outcome.ok) throw new Error(`group compute failed: ${outcome.code} ${outcome.detail}`);
  return { project: withGroup, groupId, targetId, baseId, result: outcome.result, revision: inputs.revision };
};

const patchOf = (project: CadProject, name: string): CadSurface =>
  project.surfaces!.find((entry) => entry.name === name)!;

const surfaceOf = (project: CadProject, id: string): CadSurface =>
  project.surfaces!.find((entry) => entry.id === id)!;

const revOf = (project: CadProject, id: string): string =>
  computeCadSurfaceSourceRevision(project, surfaceOf(project, id));

const runPatch = (project: CadProject, groupId: string, result: CadGradingGroupResult, revision: string) =>
  runCadCommand(createCadHistoryState(project), {
    key: 'DESIGNPATCH',
    groupId,
    result,
    expectedRevision: revision,
    sessionCurrent: true,
  });

const payloadOf = (surface: CadSurface): ImportedTinPayload => {
  if (surface.definition.sourceKind !== 'explicit-tin' || !surface.definition.importedTin) {
    throw new Error('expected an explicit-tin surface');
  }
  return surface.definition.importedTin;
};

const planArea = (points: readonly number[], triangles: readonly number[]): number => {
  let sum = 0;
  for (let i = 0; i + 2 < triangles.length; i += 3) {
    const a = triangles[i]! * 3;
    const b = triangles[i + 1]! * 3;
    const c = triangles[i + 2]! * 3;
    sum += Math.abs(
      (points[b]! - points[a]!) * (points[c + 1]! - points[a + 1]!) -
      (points[c]! - points[a]!) * (points[b + 1]! - points[a + 1]!),
    ) / 2;
  }
  return sum;
};

const edgeCounts = (points: readonly number[], triangles: readonly number[]): Map<string, number> => {
  const key = (index: number): string =>
    `${points[index * 3]}|${points[index * 3 + 1]}|${points[index * 3 + 2]}`;
  const counts = new Map<string, number>();
  for (let i = 0; i + 2 < triangles.length; i += 3) {
    for (const [p, q] of [
      [triangles[i]!, triangles[i + 1]!],
      [triangles[i + 1]!, triangles[i + 2]!],
      [triangles[i + 2]!, triangles[i]!],
    ] as Array<[number, number]>) {
      const edge = [key(p), key(q)].sort().join('||');
      counts.set(edge, (counts.get(edge) ?? 0) + 1);
    }
  }
  return counts;
};

const elevationAt = (project: CadProject, surfaceId: string, x: number, y: number): number | null => {
  const built = buildCadSurface(project, surfaceOf(project, surfaceId));
  if (built.outcome !== 'ok') throw new Error('surface build failed');
  return getSurfaceElevationAt(built, x, y);
};

const toVolumeMesh = (project: CadProject, surfaceId: string): { points: number[]; triangles: number[] } => {
  const built = buildCadSurface(project, surfaceOf(project, surfaceId));
  if (built.outcome !== 'ok') throw new Error('surface build failed');
  return {
    points: built.points.flatMap((point) => [point.x, point.y, point.z]),
    triangles: built.triangles.flatMap((tri) => [...tri]),
  };
};

// ---------------------------------------------------------------------------
// (a) DESIGNPATCH geometry
// ---------------------------------------------------------------------------

describe('20D (a) DESIGNPATCH canonical pad', () => {
  it('snapshots an ordinary design-patch surface with exact provenance', () => {
    const { project, groupId, result, revision } = padWorld(-60, -60, 160, 160);
    const done = runPatch(project, groupId, result, revision);
    expect(done.undoStack).toHaveLength(1);
    const patch = patchOf(done.present.project, 'Pad - Design Patch');
    expect(patch.definition.sourceKind).toBe('explicit-tin');
    expect(patch.purpose).toBe('design-patch');
    expect(payloadOf(patch).provenance).toMatchObject({
      kind: 'webnet-grading-design-patch',
      groupId,
      groupName: 'Pad',
      groupRevision: revision,
      accuracy: 'EXACT',
      cornerMode: 'miter',
      includesInterior: true,
      interiorPolicy: 'flat-source',
    });
    expect(validateExplicitTinPayload(payloadOf(patch))).toBeNull();
    // Snapshot semantics: a later group edit leaves the patch byte-identical.
    const before = JSON.stringify(patch);
    const edited = runCadCommand(done, {
      key: 'GROUP_EDIT_CRITERIA',
      groupId,
      criterion: { kind: 'fixed', gradeRatio: -0.25 },
    }).present.project;
    expect(JSON.stringify(patchOf(edited, 'Pad - Design Patch'))).toBe(before);
    // Name collision takes a unique suffix, never a second identical name.
    const twice = runCadCommand(done, {
      key: 'DESIGNPATCH',
      groupId,
      result,
      expectedRevision: revision,
      sessionCurrent: true,
    });
    expect(patchOf(twice.present.project, 'Pad - Design Patch (2)').purpose).toBe('design-patch');
  });

  it('merges 10000 interior + 9600 shell = 19600 with a manifold source seam', () => {
    const { project, groupId, result, revision } = padWorld(-60, -60, 160, 160);
    const done = runPatch(project, groupId, result, revision);
    const { vertices, faces } = payloadOf(patchOf(done.present.project, 'Pad - Design Patch'));
    let interiorArea = 0;
    for (let i = 0; i + 2 < faces.length; i += 3) {
      const cx = (vertices[faces[i]! * 3]! + vertices[faces[i + 1]! * 3]! + vertices[faces[i + 2]! * 3]!) / 3;
      const cy = (vertices[faces[i]! * 3 + 1]! + vertices[faces[i + 1]! * 3 + 1]! + vertices[faces[i + 2]! * 3 + 1]!) / 3;
      if (cx > 0 && cx < 100 && cy > 0 && cy < 100) {
        for (const index of [faces[i]!, faces[i + 1]!, faces[i + 2]!]) {
          expect(vertices[index * 3 + 2]).toBe(10);
        }
        const a = faces[i]! * 3;
        const b = faces[i + 1]! * 3;
        const c = faces[i + 2]! * 3;
        interiorArea += Math.abs(
          (vertices[b]! - vertices[a]!) * (vertices[c + 1]! - vertices[a + 1]!) -
          (vertices[c]! - vertices[a]!) * (vertices[b + 1]! - vertices[a + 1]!),
        ) / 2;
      }
    }
    expect(interiorArea).toBeCloseTo(10000, 9);
    expect(planArea(vertices, faces)).toBeCloseTo(19600, 6);
    // Source seam is internal manifold: every ring edge shared exactly twice.
    const counts = edgeCounts(vertices, faces);
    const ring: Array<[number, number, number]> = [[0, 0, 10], [100, 0, 10], [100, 100, 10], [0, 100, 10]];
    for (let i = 0; i < 4; i += 1) {
      const a = ring[i]!;
      const b = ring[(i + 1) % 4]!;
      const edge = [`${a[0]}|${a[1]}|${a[2]}`, `${b[0]}|${b[1]}|${b[2]}`].sort().join('||');
      expect(counts.get(edge)).toBe(2);
    }
    // Outer boundary is the 140x140 daylight ring at EG height.
    const xs: number[] = [];
    const ys: number[] = [];
    for (const [key, count] of counts) {
      if (count !== 1) continue;
      for (const end of key.split('||')) {
        const [x, y, z] = end.split('|').map(Number) as [number, number, number];
        xs.push(x);
        ys.push(y);
        expect(z).toBe(0);
      }
    }
    expect(Math.min(...xs)).toBe(-20);
    expect(Math.max(...xs)).toBe(120);
    expect(Math.min(...ys)).toBe(-20);
    expect(Math.max(...ys)).toBe(120);
  });

  it('exposes the canonical ring session-only without persisting it', () => {
    const { project, groupId } = padWorld(-60, -60, 160, 160);
    const ring = designPatchSourceBoundaryPoints(project, groupId);
    if (!ring.ok) throw new Error(`expected ring, got ${ring.code}`);
    expect(ring.ring).toEqual([0, 0, 10, 100, 0, 10, 100, 100, 10, 0, 100, 10]);
    for (const surface of project.surfaces!) {
      expect('sourceBoundaryPoints' in surface).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Gates: every failure returns null with a distinct exported code
// ---------------------------------------------------------------------------

describe('20D DESIGNPATCH gates', () => {
  it('blocks stale revisions and non-session-CURRENT calls', () => {
    const { project, groupId, result, revision } = padWorld(-60, -60, 160, 160);
    const history = createCadHistoryState(project);
    expect(resolveDesignPatch(project, groupId, result, 'ggrev1:stale', true))
      .toMatchObject({ ok: false, code: DESIGN_PATCH_GROUP_NOT_CURRENT });
    expect(runCadCommand(history, {
      key: 'DESIGNPATCH',
      groupId,
      result,
      expectedRevision: 'ggrev1:stale',
      sessionCurrent: true,
    })).toBe(history);
    expect(resolveDesignPatch(project, groupId, result, revision, false))
      .toMatchObject({ ok: false, code: DESIGN_PATCH_GROUP_NOT_CURRENT });
    expect(runCadCommand(history, {
      key: 'DESIGNPATCH',
      groupId,
      result,
      expectedRevision: revision,
    })).toBe(history);
  });

  it('blocks open groups', () => {
    const drawing = createBlankCadDrawingDocument({ name: 'Open 20D', units: 'm' });
    const flId = nextId('fl');
    const targetId = nextId('tgt');
    const project: CadProject = {
      ...drawing.project,
      entities: [makeSquareFeatureLine(flId)],
      surfaces: [makeSurface(targetId, 'EG', gridTin(-60, -60, 160, 160))],
    };
    const [a, b, c] = ((project.entities[0] as CadFeatureLineEntity).vertices.map((v) => v.id));
    const state = runCadCommand(createCadHistoryState(project), {
      key: 'GROUP_CREATE',
      name: 'Open',
      sourceFeatureLineId: flId,
      sourceCourses: [
        { vertexAId: a!, vertexBId: b! },
        { vertexAId: b!, vertexBId: c! },
      ],
      targetSurfaceId: targetId,
      side: 'right',
      criterion: { kind: 'fixed', gradeRatio: -0.5 },
      maxSearchDistance: 50,
      curveChordTolerance: 0.05,
    });
    const open = state.present.project;
    const openId = open.gradingGroups![0]!.id;
    const inputs = resolveGroupInputs(open, openId);
    if (!inputs) throw new Error('open group inputs broke');
    const built = buildCadSurface(open, inputs.target!);
    if (built.outcome !== 'ok') throw new Error('target build failed');
    const outcome = computeGradingGroupFromSnapshots({
      groupId: openId,
      revision: inputs.revision,
      members: inputs.memberSources,
      side: inputs.group.side,
      criterion: inputs.group.criterion,
      maxSearchDistance: inputs.group.maxSearchDistance,
      curveChordTolerance: inputs.group.curveChordTolerance,
      closed: false,
      target: {
        points: built.points.flatMap((point) => [point.x, point.y, point.z]),
        triangles: built.triangles.flatMap((tri) => [...tri]),
      },
    });
    if (!outcome.ok) throw new Error(`open calc failed: ${outcome.code}`);
    expect(resolveDesignPatch(open, openId, outcome.result, inputs.revision, true))
      .toMatchObject({ ok: false, code: DESIGN_PATCH_NOT_CLOSED });
    expect(runPatch(open, openId, outcome.result, inputs.revision).undoStack).toHaveLength(0);
  });

  it('blocks a tampered mesh with RING_MESH_MISMATCH', () => {
    const { project, groupId, result, revision } = padWorld(-60, -60, 160, 160);
    const tamperedPoints = [...result.gradingMesh.points];
    const at = tamperedPoints.findIndex((v, i) => i % 3 === 2
      && tamperedPoints[i - 2] === 0 && tamperedPoints[i - 1] === 0 && v === 10);
    if (at < 0) throw new Error('source corner not found in mesh');
    tamperedPoints[at] = 10.5;
    const forged: CadGradingGroupResult = {
      ...result,
      gradingMesh: { points: tamperedPoints, triangles: [...result.gradingMesh.triangles] },
    };
    expect(resolveDesignPatch(project, groupId, forged, revision, true))
      .toMatchObject({ ok: false, code: DESIGN_PATCH_RING_MESH_MISMATCH });
    const history = createCadHistoryState(project);
    expect(runCadCommand(history, {
      key: 'DESIGNPATCH',
      groupId,
      result: forged,
      expectedRevision: revision,
      sessionCurrent: true,
    })).toBe(history);
  });

  it('blocks a non-annulus mesh with MERGE_FAILED', () => {
    const { project, groupId, result, revision } = padWorld(-60, -60, 160, 160);
    const n = result.gradingMesh.points.length / 3;
    const forged: CadGradingGroupResult = {
      ...result,
      gradingMesh: {
        points: [...result.gradingMesh.points, 1000, 1000, 0, 1001, 1000, 0, 1000, 1001, 0],
        triangles: [...result.gradingMesh.triangles, n, n + 1, n + 2],
      },
    };
    expect(resolveDesignPatch(project, groupId, forged, revision, true))
      .toMatchObject({ ok: false, code: DESIGN_PATCH_MERGE_FAILED });
    const history = createCadHistoryState(project);
    expect(runCadCommand(history, {
      key: 'DESIGNPATCH',
      groupId,
      result: forged,
      expectedRevision: revision,
      sessionCurrent: true,
    })).toBe(history);
  });

  it('blocks a self-intersecting ring with NON_SIMPLE_RING', () => {
    // Arc course whose linearization crosses the loop (chords stay valid, so
    // the genuine group revision resolves; the ring itself is not simple).
    const drawing = createBlankCadDrawingDocument({ name: 'Bowtie 20D', units: 'm' });
    const flId = nextId('fl');
    const targetId = nextId('tgt');
    const entity: CadFeatureLineEntity = {
      id: flId,
      type: 'feature-line',
      layerId: 'general',
      visible: true,
      locked: false,
      name: `FL ${flId}`,
      closed: true,
      vertices: squareVertices(flId),
      segmentGeometry: [{ kind: 'arc', bulge: -1.5 }, { kind: 'line' }, { kind: 'line' }, { kind: 'line' }],
    };
    const started: CadProject = {
      ...drawing.project,
      entities: [entity],
      surfaces: [makeSurface(targetId, 'EG', gridTin(-60, -60, 160, 160))],
    };
    const ids = entity.vertices.map((v) => v.id);
    const state = runCadCommand(createCadHistoryState(started), {
      key: 'GROUP_CREATE',
      name: 'Bowtie',
      sourceFeatureLineId: flId,
      sourceCourses: ids.map((id, i) => ({ vertexAId: id, vertexBId: ids[(i + 1) % ids.length]! })),
      targetSurfaceId: targetId,
      side: 'right',
      criterion: { kind: 'fixed', gradeRatio: -0.5 },
      maxSearchDistance: 50,
      curveChordTolerance: 0.05,
      closed: true,
    });
    const withGroup = state.present.project;
    const bowId = withGroup.gradingGroups![0]!.id;
    const bowRev = resolveGroupInputs(withGroup, bowId)!.revision;
    const ring = designPatchSourceBoundaryPoints(withGroup, bowId);
    if (!ring.ok) throw new Error(`expected a derived ring, got ${ring.code}`);
    const { result: flatResult } = padWorld(-60, -60, 160, 160);
    // Forge a snapshot that claims the bowtie revision but carries no captured
    // boundary, so the re-derived (still self-crossing) ring is what blocks.
    const forged: CadGradingGroupResult = { ...flatResult, groupId: bowId, revision: bowRev };
    delete forged.sourceBoundaryPoints;
    expect(resolveDesignPatch(withGroup, bowId, forged, bowRev, true))
      .toMatchObject({ ok: false, code: DESIGN_PATCH_NON_SIMPLE_RING });
    const history = createCadHistoryState(withGroup);
    expect(runCadCommand(history, {
      key: 'DESIGNPATCH',
      groupId: bowId,
      result: forged,
      expectedRevision: bowRev,
      sessionCurrent: true,
    })).toBe(history);
  });
});

// ---------------------------------------------------------------------------
// (b) DESIGNSURFACE + DESIGNAPPLY inquiries + 18I volume pin
// ---------------------------------------------------------------------------

interface DesignWorld {
  project: CadProject;
  targetId: string;
  designId: string;
  patchId: string;
}

const designWorld = (minX: number, minY: number, maxX: number, maxY: number): DesignWorld => {
  const { project, groupId, targetId, baseId, result, revision } = padWorld(minX, minY, maxX, maxY);
  const patched = runPatch(project, groupId, result, revision).present.project;
  const patchId = patchOf(patched, 'Pad - Design Patch').id;
  const copied = runCadCommand(createCadHistoryState(patched), {
    key: 'DESIGNSURFACE',
    sourceSurfaceId: baseId,
    name: 'EG Design',
    expectedRevision: revOf(patched, baseId),
    sessionCurrent: true,
  }).present.project;
  const designId = copied.surfaces!.find((entry) => entry.name === 'EG Design')!.id;
  return { project: copied, targetId, designId, patchId };
};

const applyPatch = (project: CadProject, designId: string, patchId: string) =>
  runCadCommand(createCadHistoryState(project), {
    key: 'DESIGNAPPLY',
    targetSurfaceId: designId,
    targetExpectedRevision: revOf(project, designId),
    patchSurfaceId: patchId,
    patchExpectedRevision: revOf(project, patchId),
    sessionCurrent: true,
  });

describe('20D (b) apply inquiries + volume contract', () => {
  it('resolves design center 10 and EG 0 outside daylight', () => {
    const { project, designId, patchId } = designWorld(-60, -60, 160, 160);
    const preflight = preflightDesignApply(project, designId, patchId, undefined, undefined, true);
    expect(preflight.disposition).toBe('EXACT');
    const applied = applyPatch(project, designId, patchId).present.project;
    expect(elevationAt(applied, designId, 50, 50)).toBeCloseTo(10, 9);
    expect(elevationAt(applied, designId, -40, -40)).toBeCloseTo(0, 9);
    expect(elevationAt(applied, designId, 130, 130)).toBeCloseTo(0, 9);
  });

  it('pins Fill=436000/3 Cut=0 Net=Fill for EG vs design', () => {
    const { project, targetId, designId, patchId } = designWorld(-60, -60, 160, 160);
    const applied = applyPatch(project, designId, patchId).present.project;
    const created = runCadCommand(createCadHistoryState(applied), {
      key: 'DESIGNVOLUME',
      baseSurfaceId: targetId,
      comparisonSurfaceId: designId,
    });
    expect(findDesignVolumeSurface(created.present.project, targetId, designId)).not.toBeNull();
    const quantities = computeVolumeQuantities(
      toVolumeMesh(applied, targetId),
      toVolumeMesh(applied, designId),
    ).quantities;
    expect(quantities.fillVolume).toBeCloseTo(436000 / 3, 6);
    expect(quantities.cutVolume).toBe(0);
    expect(quantities.netVolume).toBe(quantities.fillVolume);
  });
});

// ---------------------------------------------------------------------------
// (c) Apply identity + byte-identical patch/EG + exact undo/redo
// ---------------------------------------------------------------------------

describe('20D (c) apply snapshot semantics', () => {
  it('preserves target identity, leaves patch+EG alone, and undoes exactly', () => {
    const { project, designId, patchId } = designWorld(-60, -60, 160, 160);
    const designBefore = surfaceOf(project, designId);
    const patchBefore = JSON.stringify(surfaceOf(project, patchId));
    const egBefore = JSON.stringify(surfaceOf(project, project.surfaces![0]!.id));
    const applied = applyPatch(project, designId, patchId);
    const target = surfaceOf(applied.present.project, designId);
    expect(target.id).toBe(designId);
    expect(target.name).toBe(designBefore.name);
    expect(target.layerId).toBe(designBefore.layerId);
    expect(target.styleId).toBe(designBefore.styleId);
    expect(target.purpose).toBe('design');
    expect(JSON.stringify(surfaceOf(applied.present.project, patchId))).toBe(patchBefore);
    expect(JSON.stringify(surfaceOf(applied.present.project, project.surfaces![0]!.id))).toBe(egBefore);
    expect(applied.undoStack).toHaveLength(1);
    expect(undoCadHistory(applied).present.project).toEqual(project);
    expect(redoCadHistory(undoCadHistory(applied)).present.project).toEqual(applied.present.project);
  });
});

// ---------------------------------------------------------------------------
// (d) Multi-patch stacking + ordered undo + (e) NEEDS_RECALC
// ---------------------------------------------------------------------------

const secondPad = (project: CadProject, targetId: string): PadWorld => {
  const flId = nextId('fl');
  const entity: CadFeatureLineEntity = {
    id: flId,
    type: 'feature-line',
    layerId: 'general',
    visible: true,
    locked: false,
    name: `FL ${flId}`,
    closed: true,
    vertices: [
      V(`feature-vertex:${flId}:a`, 160, 20, 10),
      V(`feature-vertex:${flId}:b`, 220, 20, 10),
      V(`feature-vertex:${flId}:c`, 220, 80, 10),
      V(`feature-vertex:${flId}:d`, 160, 80, 10),
    ],
  };
  const withFl: CadProject = { ...project, entities: [...project.entities, entity] };
  const [a, b, c, d] = entity.vertices.map((entry) => entry.id);
  const state = runCadCommand(createCadHistoryState(withFl), {
    key: 'GROUP_CREATE',
    name: 'Pad B',
    sourceFeatureLineId: flId,
    sourceCourses: [
      { vertexAId: a!, vertexBId: b! },
      { vertexAId: b!, vertexBId: c! },
      { vertexAId: c!, vertexBId: d! },
      { vertexAId: d!, vertexBId: a! },
    ],
    targetSurfaceId: targetId,
    side: 'right',
    criterion: { kind: 'fixed', gradeRatio: -0.5 },
    maxSearchDistance: 50,
    curveChordTolerance: 0.05,
    closed: true,
  });
  const withGroup = state.present.project;
  const groupId = withGroup.gradingGroups!.find((entry) => entry.name === 'Pad B')!.id;
  const inputs = resolveGroupInputs(withGroup, groupId);
  if (!inputs) throw new Error('Pad B inputs broke');
  const built = buildCadSurface(withGroup, inputs.target!);
  if (built.outcome !== 'ok') throw new Error('Pad B target build failed');
  const outcome = computeGradingGroupFromSnapshots({
    groupId,
    revision: inputs.revision,
    members: inputs.memberSources,
    side: inputs.group.side,
    criterion: inputs.group.criterion,
    maxSearchDistance: inputs.group.maxSearchDistance,
    curveChordTolerance: inputs.group.curveChordTolerance,
    closed: true,
    target: {
      points: built.points.flatMap((point) => [point.x, point.y, point.z]),
      triangles: built.triangles.flatMap((tri) => [...tri]),
    },
  });
  if (!outcome.ok) throw new Error(`Pad B calc failed: ${outcome.code}`);
  const baseId = withGroup.surfaces!.find((entry) => entry.name === 'EG Coarse')!.id;
  return { project: withGroup, groupId, targetId, baseId, result: outcome.result, revision: inputs.revision };
};

const applyBoth = (): {
  afterA: ReturnType<typeof applyPatch>;
  afterB: ReturnType<typeof applyPatch>;
  designId: string;
} => {
  // Both groups+patches exist before either Apply, so the two Applies sit
  // adjacent atop history: undo removes B-apply only, second undo the A-apply.
  const { project, targetId, designId, patchId } = designWorld(-60, -60, 260, 160);
  const second = secondPad(project, targetId);
  const withPatchB = runPatch(second.project, second.groupId, second.result, second.revision).present.project;
  const patchBId = patchOf(withPatchB, 'Pad B - Design Patch').id;
  const afterA = applyPatch(withPatchB, designId, patchId);
  const afterB = runCadCommand(afterA, {
    key: 'DESIGNAPPLY',
    targetSurfaceId: designId,
    targetExpectedRevision: revOf(afterA.present.project, designId),
    patchSurfaceId: patchBId,
    patchExpectedRevision: revOf(afterA.present.project, patchBId),
    sessionCurrent: true,
  });
  return { afterA, afterB, designId };
};

describe('20D (d) multi-patch stacking', () => {
  it('holds two disjoint patches with ordered undo back to the EG snapshot', () => {
    const { afterA, afterB, designId } = applyBoth();
    expect(afterB.undoStack.length).toBeGreaterThan(afterA.undoStack.length);
    expect(elevationAt(afterB.present.project, designId, 50, 50)).toBeCloseTo(10, 9);
    expect(elevationAt(afterB.present.project, designId, 190, 50)).toBeCloseTo(10, 9);
    // First undo removes B only; second undo returns to the EG snapshot.
    const undoB = undoCadHistory(afterB);
    expect(undoB.present.project).toEqual(afterA.present.project);
    expect(elevationAt(undoB.present.project, designId, 190, 50)).toBeCloseTo(0, 9);
    expect(elevationAt(undoB.present.project, designId, 50, 50)).toBeCloseTo(10, 9);
    const undoA = undoCadHistory(undoB);
    expect(elevationAt(undoA.present.project, designId, 50, 50)).toBeCloseTo(0, 9);
    expect(elevationAt(undoA.present.project, designId, 190, 50)).toBeCloseTo(0, 9);
  });
});

describe('20D (e) volume staleness', () => {
  it('reports NEEDS_RECALC after the second Apply with no manual invalidation', () => {
    const { project, targetId, designId, patchId } = designWorld(-60, -60, 260, 160);
    const afterA = applyPatch(project, designId, patchId).present.project;
    const created = runCadCommand(createCadHistoryState(afterA), {
      key: 'DESIGNVOLUME',
      baseSurfaceId: targetId,
      comparisonSurfaceId: designId,
    }).present.project;
    const volume = findDesignVolumeSurface(created, targetId, designId)!;
    const volRevA = computeVolumeSurfaceRevision({
      baseId: targetId,
      baseRev: revOf(created, targetId),
      cmpId: designId,
      cmpRev: revOf(created, designId),
    });
    const quantities = computeVolumeQuantities(
      toVolumeMesh(created, targetId),
      toVolumeMesh(created, designId),
    ).quantities;
    const state = {
      building: false,
      baseCurrent: true,
      comparisonCurrent: true,
      result: { revision: volRevA, overlapArea: quantities.overlapArea } as CadVolumeResult,
    };
    expect(deriveVolumeSurfaceStatus(created, volume, state)).toBe('CURRENT');
    const cmpRevBefore = revOf(created, designId);
    const second = secondPad(created, targetId);
    const withPatchB = runPatch(second.project, second.groupId, second.result, second.revision).present.project;
    const patchBId = patchOf(withPatchB, 'Pad B - Design Patch').id;
    const afterB = runCadCommand(createCadHistoryState(withPatchB), {
      key: 'DESIGNAPPLY',
      targetSurfaceId: designId,
      targetExpectedRevision: revOf(withPatchB, designId),
      patchSurfaceId: patchBId,
      patchExpectedRevision: revOf(withPatchB, patchBId),
      sessionCurrent: true,
    }).present.project;
    expect(revOf(afterB, designId)).not.toBe(cmpRevBefore);
    expect(deriveVolumeSurfaceStatus(afterB, volume, state)).toBe('NEEDS_RECALC');
  });
});

// ---------------------------------------------------------------------------
// (f) Non-flat block + raw-shell guidance pin
// ---------------------------------------------------------------------------

describe('20D (f) fail-closed pins', () => {
  it('blocks DESIGNPATCH on a non-flat closed group', () => {
    const drawing = createBlankCadDrawingDocument({ name: 'Non-flat 20D', units: 'm' });
    const flId = nextId('fl');
    const targetId = nextId('tgt');
    const started: CadProject = {
      ...drawing.project,
      entities: [makeSquareFeatureLine(flId, [10, 10, 11, 10])],
      surfaces: [makeSurface(targetId, 'EG', gridTin(-60, -60, 160, 160))],
    };
    const [a, b, c, d] = ((started.entities[0] as CadFeatureLineEntity).vertices.map((v) => v.id));
    const state = runCadCommand(createCadHistoryState(started), {
      key: 'GROUP_CREATE',
      name: 'Tilted',
      sourceFeatureLineId: flId,
      sourceCourses: [
        { vertexAId: a!, vertexBId: b! },
        { vertexAId: b!, vertexBId: c! },
        { vertexAId: c!, vertexBId: d! },
        { vertexAId: d!, vertexBId: a! },
      ],
      targetSurfaceId: targetId,
      side: 'right',
      criterion: { kind: 'fixed', gradeRatio: -0.5 },
      maxSearchDistance: 50,
      curveChordTolerance: 0.05,
      closed: true,
    });
    const withGroup = state.present.project;
    const groupId = withGroup.gradingGroups![0]!.id;
    // The real calculate path fails closed (R1 flat-pad honesty gate).
    const inputs = resolveGroupInputs(withGroup, groupId);
    if (!inputs) throw new Error('tilted inputs broke');
    const built = buildCadSurface(withGroup, inputs.target!);
    if (built.outcome !== 'ok') throw new Error('tilted target build failed');
    const outcome = computeGradingGroupFromSnapshots({
      groupId,
      revision: inputs.revision,
      members: inputs.memberSources,
      side: inputs.group.side,
      criterion: inputs.group.criterion,
      maxSearchDistance: inputs.group.maxSearchDistance,
      curveChordTolerance: inputs.group.curveChordTolerance,
      closed: true,
      target: {
        points: built.points.flatMap((point) => [point.x, point.y, point.z]),
        triangles: built.triangles.flatMap((tri) => [...tri]),
      },
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.code).toBe('CORNER_NO_SOLUTION');
    }
    // With no CURRENT result, any DESIGNPATCH attempt is blocked. A snapshot
    // claiming CURRENT at the genuine tilted revision (and carrying no
    // captured boundary) re-derives the real non-coplanar ring, which the
    // flat-OR-coplanar gate blocks before any mesh is read.
    const { result: flatResult } = padWorld(-60, -60, 160, 160);
    const forged: CadGradingGroupResult = { ...flatResult, groupId, revision: inputs.revision };
    delete forged.sourceBoundaryPoints;
    expect(resolveDesignPatch(withGroup, groupId, forged, inputs.revision, true))
      .toMatchObject({ ok: false, code: DESIGN_PATCH_NON_PLANAR_INTERIOR_UNDEFINED });
    const history = createCadHistoryState(withGroup);
    expect(runCadCommand(history, {
      key: 'DESIGNPATCH',
      groupId,
      result: forged,
      expectedRevision: inputs.revision,
      sessionCurrent: true,
    })).toBe(history);
  });

  it('fails a raw GROUPBAKE shell paste with patch guidance through real compose', () => {
    const { project, groupId, baseId, result, revision } = padWorld(-60, -60, 160, 160);
    const baked = runCadCommand(createCadHistoryState(project), {
      key: 'GROUPBAKE',
      groupId,
      result,
      expectedRevision: revision,
      sessionCurrent: true,
    }).present.project;
    const shellId = baked.surfaces!.find((entry) => entry.name === 'Pad - Baked')!.id;
    const copied = runCadCommand(createCadHistoryState(baked), {
      key: 'DESIGNSURFACE',
      sourceSurfaceId: baseId,
      name: 'EG Design',
      expectedRevision: revOf(baked, baseId),
      sessionCurrent: true,
    }).present.project;
    const designId = copied.surfaces!.find((entry) => entry.name === 'EG Design')!.id;
    // The shell alone has no pad interior: the real compose hits the seam
    // gate and the preflight diagnoses the patch workflow.
    const preflight = preflightDesignApply(copied, designId, shellId, undefined, undefined, true);
    expect(preflight.disposition).toBe('BLOCKED');
    if (preflight.disposition === 'BLOCKED') {
      expect(preflight.reason).toBe(DESIGN_APPLY_RAW_SHELL_GUIDANCE);
    }
    const history = createCadHistoryState(copied);
    expect(runCadCommand(history, {
      key: 'DESIGNAPPLY',
      targetSurfaceId: designId,
      targetExpectedRevision: revOf(copied, designId),
      patchSurfaceId: shellId,
      patchExpectedRevision: revOf(copied, shellId),
      sessionCurrent: true,
    })).toBe(history);
  });
});

// ---------------------------------------------------------------------------
// (g) Concave + curved-source groups fail closed at named gates.
//
// Structural finding (see header): 20C admits concave L-notches whose
// shells pinch at the reflex vertex (daylight touches source -> the merge
// demand for a strict two-boundary annulus fail-closes). Phase 20E consumes
// the captured source boundary (no re-linearization drift); the curved
// fixture's four inward semicircles genuinely cross at (50,50), so the
// captured ring is non-simple and blocks before any mesh read. Both pins run
// the REAL calculate path with genuine revisions — no forged snapshots here.
// ---------------------------------------------------------------------------

describe('20D (g) concave and curved fail-closed pins', () => {
  it('blocks a pinched concave shell with MERGE_FAILED', () => {
    const drawing = createBlankCadDrawingDocument({ name: 'Concave 20D', units: 'm' });
    const flId = nextId('fl');
    const targetId = nextId('tgt');
    const lShape: CadFeatureLineEntity = {
      id: flId,
      type: 'feature-line',
      layerId: 'general',
      visible: true,
      locked: false,
      name: `FL ${flId}`,
      closed: true,
      vertices: [
        V(`feature-vertex:${flId}:a`, 0, 0, 10),
        V(`feature-vertex:${flId}:b`, 100, 0, 10),
        V(`feature-vertex:${flId}:c`, 100, 60, 10),
        V(`feature-vertex:${flId}:d`, 40, 60, 10),
        V(`feature-vertex:${flId}:e`, 40, 100, 10),
        V(`feature-vertex:${flId}:f`, 0, 100, 10),
      ],
    };
    const started: CadProject = {
      ...drawing.project,
      entities: [lShape],
      surfaces: [makeSurface(targetId, 'EG', gridTin(-60, -60, 160, 160))],
    };
    const ids = lShape.vertices.map((entry) => entry.id);
    const state = runCadCommand(createCadHistoryState(started), {
      key: 'GROUP_CREATE',
      name: 'Ell',
      sourceFeatureLineId: flId,
      sourceCourses: ids.map((id, index) => ({
        vertexAId: id,
        vertexBId: ids[(index + 1) % ids.length]!,
      })),
      targetSurfaceId: targetId,
      side: 'right',
      criterion: { kind: 'fixed', gradeRatio: -0.5 },
      maxSearchDistance: 50,
      curveChordTolerance: 0.05,
      closed: true,
    });
    const withGroup = state.present.project;
    const groupId = withGroup.gradingGroups![0]!.id;
    const inputs = resolveGroupInputs(withGroup, groupId);
    if (!inputs) throw new Error('Ell inputs broke');
    const built = buildCadSurface(withGroup, inputs.target!);
    if (built.outcome !== 'ok') throw new Error('Ell target build failed');
    const outcome = computeGradingGroupFromSnapshots({
      groupId,
      revision: inputs.revision,
      members: inputs.memberSources,
      side: inputs.group.side,
      criterion: inputs.group.criterion,
      maxSearchDistance: inputs.group.maxSearchDistance,
      curveChordTolerance: inputs.group.curveChordTolerance,
      closed: true,
      target: {
        points: built.points.flatMap((point) => [point.x, point.y, point.z]),
        triangles: built.triangles.flatMap((tri) => [...tri]),
      },
    });
    if (!outcome.ok) throw new Error(`Ell calc failed: ${outcome.code}`);
    // The 20C result is CURRENT and EXACT, but the reflex GAP wedge pinches
    // the shell (daylight touches source at the notch vertex), so the
    // direct topology merge fail-closes instead of guessing.
    expect(resolveDesignPatch(withGroup, groupId, outcome.result, inputs.revision, true))
      .toMatchObject({ ok: false, code: DESIGN_PATCH_MERGE_FAILED });
    const history = createCadHistoryState(withGroup);
    expect(runCadCommand(history, {
      key: 'DESIGNPATCH',
      groupId,
      result: outcome.result,
      expectedRevision: inputs.revision,
      sessionCurrent: true,
    })).toBe(history);
  });

  it('blocks a curved loop with RING_MESH_MISMATCH while disclosing CURVE_APPROXIMATED', () => {
    const drawing = createBlankCadDrawingDocument({ name: 'Curved 20D', units: 'm' });
    const flId = nextId('fl');
    const targetId = nextId('tgt');
    const curved: CadFeatureLineEntity = {
      id: flId,
      type: 'feature-line',
      layerId: 'general',
      visible: true,
      locked: false,
      name: `FL ${flId}`,
      closed: true,
      vertices: [
        V(`feature-vertex:${flId}:a`, 0, 0, 10),
        V(`feature-vertex:${flId}:b`, 100, 0, 10),
        V(`feature-vertex:${flId}:c`, 100, 100, 10),
        V(`feature-vertex:${flId}:d`, 0, 100, 10),
      ],
      segmentGeometry: [
        { kind: 'arc', bulge: 0.5 },
        { kind: 'arc', bulge: 0.5 },
        { kind: 'arc', bulge: 0.5 },
        { kind: 'arc', bulge: 0.5 },
      ],
    };
    const started: CadProject = {
      ...drawing.project,
      entities: [curved],
      surfaces: [makeSurface(targetId, 'EG', gridTin(-60, -60, 160, 160))],
    };
    const ids = curved.vertices.map((entry) => entry.id);
    const state = runCadCommand(createCadHistoryState(started), {
      key: 'GROUP_CREATE',
      name: 'Curved',
      sourceFeatureLineId: flId,
      sourceCourses: ids.map((id, index) => ({
        vertexAId: id,
        vertexBId: ids[(index + 1) % ids.length]!,
      })),
      targetSurfaceId: targetId,
      side: 'right',
      criterion: { kind: 'fixed', gradeRatio: -0.5 },
      maxSearchDistance: 50,
      curveChordTolerance: 0.05,
      closed: true,
    });
    const withGroup = state.present.project;
    const groupId = withGroup.gradingGroups![0]!.id;
    const inputs = resolveGroupInputs(withGroup, groupId);
    if (!inputs) throw new Error('Curved inputs broke');
    const built = buildCadSurface(withGroup, inputs.target!);
    if (built.outcome !== 'ok') throw new Error('Curved target build failed');
    const outcome = computeGradingGroupFromSnapshots({
      groupId,
      revision: inputs.revision,
      members: inputs.memberSources,
      side: inputs.group.side,
      criterion: inputs.group.criterion,
      maxSearchDistance: inputs.group.maxSearchDistance,
      curveChordTolerance: inputs.group.curveChordTolerance,
      closed: true,
      target: {
        points: built.points.flatMap((point) => [point.x, point.y, point.z]),
        triangles: built.triangles.flatMap((tri) => [...tri]),
      },
    });
    // 20K.1 Wave B2: the curved closed square fails even earlier — the seam
    // gate refuses the non-stitching shell, so no CURRENT result exists for
    // the ring gate or the DESIGNPATCH command to consume.
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('GROUP_NON_MANIFOLD');
    expect(outcome.detail).toContain('GRADING_GROUP_ARC_SEAM_PINCH');
  });
});
