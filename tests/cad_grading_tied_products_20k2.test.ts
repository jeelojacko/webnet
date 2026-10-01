/**
 * Phase 20K.2 Worker B — tied-split Calculate/Product consistency.
 *
 * Wave A2 RED (recorded against the pre-fix product gates): a genuine
 * Surface arc tied split returns a CURRENT result from Calculate (the
 * worker gate attributes the second positive-width region to the recorded
 * tied station) while Extract/Bake returned null, because they re-validated
 * the mesh with `{ scope: 'arc' }` (expectedComponents default 1) and NO
 * tied coordinates. The certificate closes that gap: products consume the
 * worker-recorded topology + tied stations, never guess.
 *
 * Bounded behavior: a genuine tied split is MULTI-REGION — the daylight
 * boundary collapses to repeated vertices at the tie, so one FeatureLine
 * cannot represent it. Extract is marked unavailable for multi-region meshes
 * (`extractable` false, command null, truthful notice, zero mutation) rather
 * than emitting a silent concat or an enabled command that returns null.
 * Phase 20K.3 Wave E1 makes Bake an independent explicit-TIN product: the
 * engine materializes arbitrary validated face sets 1:1, so a multi-region
 * mesh IS bakeable as one surface (one Undo, truthful provenance) even while
 * Extract stays unavailable. Single-region certified meshes keep extracting
 * and baking as one undo entry each.
 *
 * Fixture: the canonical rounded-square bottom arc (R=252.5, chord 100,
 * sagitta 5) at tolerance 0.5 (4 chords). The target is the single plane
 * through the middle chord (k=2), so that chord's source ties (d = 0) while
 * both neighbours stay positive width — one genuine tied interval with
 * positive-width grading on both sides.
 *
 * The fixture is computed from the canonical arc source; the persisted
 * FeatureLine round-trip (bulge -> centre/radius) differs by ulps and would
 * tip the seam solver, so the project only supplies identity + revision and
 * the command gates revalidate the certified mesh (they never re-solve).
 */
import { describe, expect, it } from 'vitest';

import { createBlankCadDrawingDocument } from '../src/engine/cad/cadDrawingFile';
import {
  createCadHistoryState,
  runCadCommand,
} from '../src/engine/cad/cadUndoRedo';
import { resolveGradingInputs } from '../src/engine/cad/grading/gradingResolve';
import { resolveGroupInputs } from '../src/engine/cad/grading/gradingGroupResolve';
import { linearizeGradingArc } from '../src/engine/cad/grading/gradingCurve';
import {
  buildGradingTopologyCertificate,
  buildGradingTopologyCertificateExact,
  gradingTopologyCertificateError,
  gradingTopologyCertificateProductError,
} from '../src/engine/cad/grading/gradingTopologyCertificate';
import { deriveGradingTopologyExpectation } from '../src/engine/cad/grading/gradingTopologyExpectation';
import { validateGradingMeshTopology } from '../src/engine/cad/grading/gradingTopology';
import type {
  CadFeatureLineEntity,
  CadProject,
  CadSurface,
} from '../src/engine/cad/cadTypes';
import type { CadGradingResult } from '../src/engine/cad/grading/gradingTypes';
import type { CadGradingGroupResult } from '../src/engine/cad/grading/gradingGroupTypes';
import type { GradingTargetMeshSnapshot } from '../src/engine/cad/grading/gradingComputeTypes';
import { computeGradingFromSnapshots } from '../src/workers/surfaceGradingCompute';
import { computeGradingGroupFromSnapshots } from '../src/engine/cad/grading/gradingGroupCompute';
import { roundedSquareMembers } from '../scripts/phase20kHybridArcPairGroups';

const ARC_TOLERANCE = 0.5;
const SEARCH = 200;

let seq = 0;
const nextId = (prefix: string): string => {
  seq += 1;
  return `${prefix}-20k2-b-${seq}`;
};

const gridTin = (
  fn: (_x: number, _y: number) => number,
  xs: number[],
  ys: number[],
): GradingTargetMeshSnapshot => {
  const points: number[] = [];
  for (const y of ys) for (const x of xs) points.push(x, y, fn(x, y));
  const triangles: number[] = [];
  const idx = (ix: number, iy: number): number => iy * xs.length + ix;
  for (let ix = 0; ix + 1 < xs.length; ix += 1)
    for (let iy = 0; iy + 1 < ys.length; iy += 1) {
      const a = idx(ix, iy);
      const b = idx(ix + 1, iy);
      const c = idx(ix + 1, iy + 1);
      const d = idx(ix, iy + 1);
      triangles.push(a, b, c, a, c, d);
    }
  return { points, triangles };
};
const range = (a: number, b: number, s: number): number[] => {
  const out: number[] = [];
  for (let v = a; v <= b + 1e-9; v += s) out.push(v);
  return out;
};

const ARC_SOURCE = roundedSquareMembers(10)[0]!.source;

/** Plane through the middle linearized chord: tie there, positive both sides. */
const tiedPlaneTarget = (): GradingTargetMeshSnapshot => {
  const lin = linearizeGradingArc(
    ARC_SOURCE.arc!.centerX, ARC_SOURCE.arc!.centerY, ARC_SOURCE.arc!.radius,
    ARC_SOURCE.arc!.startAngle, ARC_SOURCE.arc!.endAngle, ARC_SOURCE.arc!.sweepCCW,
    ARC_SOURCE.startZ, ARC_SOURCE.endZ, ARC_TOLERANCE,
  )!;
  const k = Math.floor(lin.points.length / 2);
  const p0 = lin.points[k]!;
  const p1 = lin.points[k + 1]!;
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const len = Math.hypot(dx, dy);
  const gx = -dy / len;
  const gy = dx / len;
  const far = lin.points[0]!;
  const sign = gx * (far.x - p0.x) + gy * (far.y - p0.y) > 0 ? -1 : 1;
  const a = sign * 0.2 * gx;
  const b = sign * 0.2 * gy;
  return gridTin(
    (x, y) => ARC_SOURCE.startZ + a * (x - p0.x) + b * (y - p0.y),
    range(-200, 300, 25),
    range(-200, 300, 25),
  );
};

const flatSurface = (id: string): CadSurface => ({
  id,
  name: 'Target',
  definition: {
    sourceKind: 'explicit-tin',
    pointSource: { kind: 'points', pointEntityIds: [] },
    importedTin: {
      vertices: [-400, -400, 0, 500, -400, 0, 500, 500, 0, -400, 500, 0],
      faces: [0, 1, 2, 0, 2, 3],
      provenance: { kind: 'webnet-bake', sourceSurfaceId: 'seed', sourceSurfaceName: 'seed', sourceRevision: 'srev1:seed' },
    },
  },
  cachedRevision: null,
});

const arcFeatureLine = (id: string): CadFeatureLineEntity => {
  const sweep = Math.abs(ARC_SOURCE.arc!.endAngle - ARC_SOURCE.arc!.startAngle);
  const signed = ARC_SOURCE.arc!.sweepCCW ? sweep : -sweep;
  return {
    id,
    type: 'feature-line',
    layerId: 'general',
    visible: true,
    locked: false,
    name: `FL ${id}`,
    vertices: [
      { id: `feature-vertex:${id}:a`, x: ARC_SOURCE.startX, y: ARC_SOURCE.startY, z: ARC_SOURCE.startZ },
      { id: `feature-vertex:${id}:b`, x: ARC_SOURCE.endX, y: ARC_SOURCE.endY, z: ARC_SOURCE.endZ },
    ],
    segmentGeometry: [{ kind: 'arc', bulge: Math.tan(signed / 4) }],
  };
};

interface ArcWorld {
  project: CadProject;
  gradingId: string;
  revision: string;
}

const arcWorld = (): ArcWorld => {
  const drawing = createBlankCadDrawingDocument({ name: 'B2 tied', units: 'm' });
  const flId = nextId('fl');
  const targetId = nextId('tgt');
  const project: CadProject = {
    ...drawing.project,
    entities: [arcFeatureLine(flId)],
    surfaces: [flatSurface(targetId)],
  };
  const created = runCadCommand(createCadHistoryState(project), {
    key: 'GRADING_CREATE',
    name: 'Tied',
    sourceFeatureLineId: flId,
    vertexAId: `feature-vertex:${flId}:a`,
    vertexBId: `feature-vertex:${flId}:b`,
    targetSurfaceId: targetId,
    side: 'right',
    criterion: { kind: 'fixed', gradeRatio: -0.5 },
    maxSearchDistance: SEARCH,
    curveChordTolerance: ARC_TOLERANCE,
  });
  const withGrading = created.present.project;
  const gradingId = withGrading.gradings![0]!.id;
  const inputs = resolveGradingInputs(withGrading, gradingId)!;
  return { project: withGrading, gradingId, revision: inputs.revision };
};

/** Genuine Surface arc tied split, certified by the production assembly. */
const calculateTiedSplit = (world: ArcWorld): CadGradingResult => {
  const outcome = computeGradingFromSnapshots({
    gradingId: world.gradingId,
    revision: world.revision,
    source: ARC_SOURCE,
    side: 'right',
    criterion: { kind: 'fixed', gradeRatio: -0.5 },
    maxSearchDistance: SEARCH,
    curveChordTolerance: ARC_TOLERANCE,
    target: tiedPlaneTarget(),
  });
  if (!outcome.ok) throw new Error(`tied compute failed: ${outcome.code} ${outcome.detail ?? ''}`);
  return outcome.result;
};

const PINCHED_MESH = {
  points: [0, 0, 0, 1, 0, 0, 1, 1, 0, -1, 0, 0, -1, -1, 0],
  triangles: [0, 1, 2, 0, 3, 4],
};

describe('20K.2 tied split: Calculate CURRENT + bounded products', () => {
  it('Calculate yields a certified two-region CURRENT mesh', () => {
    const world = arcWorld();
    const result = calculateTiedSplit(world);
    const cert = result.topologyCertificate;
    expect(cert).toMatchObject({
      version: 'gtop2',
      scope: 'standalone',
      components: 2,
      boundaryCycles: 2,
      positiveWidthRegionCount: 2,
    });
    expect(cert!.tiedSplitCoords.length).toBeGreaterThanOrEqual(3);
    expect(
      gradingTopologyCertificateError(cert, 'standalone', result.gradingMesh),
    ).toBeNull();
    // Multi-region cannot be represented by one FeatureLine: products are
    // bounded off, not silently concatenated and not enabled-and-null.
    expect(
      gradingTopologyCertificateProductError(cert, 'standalone', result.gradingMesh, {
        sourceBoundaryPoints: result.sourceBoundaryPoints,
        gradingBoundaryPoints: result.daylightPoints,
      }),
    ).toBe('GRADING_TOPOLOGY_MULTI_REGION_NOT_EXPORTABLE');
    // Wave A2 RED (pre-fix product gate): the old `{ scope: 'arc' }` call
    // with default expectedComponents rejects this same CURRENT mesh.
    const legacy = validateGradingMeshTopology(
      result.gradingMesh.points,
      result.gradingMesh.triangles,
      { scope: 'arc' },
    );
    expect(legacy.ok).toBe(false);
    expect(legacy.components).toBe(2);
  });

  it('the mesh digest never enters the grev1 revision', () => {
    const world = arcWorld();
    const result = calculateTiedSplit(world);
    const after = resolveGradingInputs(world.project, world.gradingId)!;
    expect(after.revision).toBe(world.revision);
    expect(after.revision.startsWith('grev1:')).toBe(true);
    expect(after.revision.includes(result.topologyCertificate!.meshDigest)).toBe(false);
  });

  it('multi-region tied split blocks Extract while Bake emits one surface', () => {
    const world = arcWorld();
    const result = calculateTiedSplit(world);
    const before = JSON.stringify(world.project);
    let history = createCadHistoryState(world.project);
    history = runCadCommand(history, {
      key: 'GRADINGEXTRACTDAYLIGHT',
      gradingId: world.gradingId, result,
      expectedRevision: world.revision, sessionCurrent: true,
    });
    expect(history.undoStack.length).toBe(0);
    expect(JSON.stringify(history.present.project)).toBe(before);
    // Wave E1: Bake is an explicit-TIN product and IS available for the
    // same certified multi-region mesh (availability != Extract's).
    history = runCadCommand(history, {
      key: 'GRADINGBAKE',
      gradingId: world.gradingId, result,
      expectedRevision: world.revision, sessionCurrent: true,
    });
    expect(history.undoStack.length).toBe(1);
    expect(history.present.project.surfaces).toHaveLength(world.project.surfaces!.length + 1);
  });

  it('a forged mesh swap blocks products with zero mutation', () => {
    const world = arcWorld();
    const result = calculateTiedSplit(world);
    const forged: CadGradingResult = { ...result, gradingMesh: { ...PINCHED_MESH } };
    const before = JSON.stringify(world.project);
    let history = createCadHistoryState(world.project);
    history = runCadCommand(history, {
      key: 'GRADINGEXTRACTDAYLIGHT',
      gradingId: world.gradingId, result: forged,
      expectedRevision: world.revision, sessionCurrent: true,
    });
    history = runCadCommand(history, {
      key: 'GRADINGBAKE',
      gradingId: world.gradingId, result: forged,
      expectedRevision: world.revision, sessionCurrent: true,
    });
    expect(history.undoStack.length).toBe(0);
    expect(JSON.stringify(history.present.project)).toBe(before);
  });

  it('a stale revision and a missing certificate both block products', () => {
    const world = arcWorld();
    const result = calculateTiedSplit(world);
    const stale = runCadCommand(createCadHistoryState(world.project), {
      key: 'GRADINGEXTRACTDAYLIGHT',
      gradingId: world.gradingId, result,
      expectedRevision: `${world.revision}-stale`, sessionCurrent: true,
    });
    expect(stale.undoStack.length).toBe(0);

    const { topologyCertificate: _dropped, ...uncertified } = result;
    const noCert = runCadCommand(createCadHistoryState(world.project), {
      key: 'GRADINGEXTRACTDAYLIGHT',
      gradingId: world.gradingId,
      result: uncertified as CadGradingResult,
      expectedRevision: world.revision, sessionCurrent: true,
    });
    expect(noCert.undoStack.length).toBe(0);
  });

  it('the legacy single-station CUT->TIED->FILL split stays CURRENT at the cert level', () => {
    // A separate, pre-existing fixture. The sibling 20K.2 real-cycle
    // contract rejects its figure-eight boundary at the worker gate; that
    // classification is owned by gradingTopology.ts, not this certificate.
    // Here we only pin that the certificate records the fixture's real
    // topology if it is ever assembled (2 components / 2 cycles) and that
    // product revalidation is fail-closed, never silently accepting.
    const pinned = buildGradingTopologyCertificate({
      scope: 'standalone',
      points: [
        0, 0, 0, 10, 0, 0, 10, 2, 0, 0, 2, 0,
        20, 20, 0, 30, 20, 0, 30, 22, 0, 20, 22, 0,
      ],
      triangles: [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7],
      tiedSplitCoords: [20, 20, 0],
      expectedComponents: 1,
    });
    expect(pinned).toMatchObject({ components: 2, boundaryCycles: 2, positiveWidthRegionCount: 1 });
    expect(
      gradingTopologyCertificateError(pinned ?? undefined, 'standalone', {
        points: [0, 0, 0, 10, 0, 0, 10, 2, 0, 0, 2, 0, 20, 20, 0, 30, 20, 0, 30, 22, 0, 20, 22, 0],
        triangles: [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7],
      }),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Group product path: a single-region certified group stays exportable; a
// multi-region group mesh is bounded off exactly like the standalone case.
// ---------------------------------------------------------------------------

const makeChainFeatureLine = (id: string): CadFeatureLineEntity => ({
  id,
  type: 'feature-line',
  layerId: 'general',
  visible: true,
  locked: false,
  name: `FL ${id}`,
  vertices: [
    { id: `feature-vertex:${id}:a`, x: 0, y: 0, z: 10 },
    { id: `feature-vertex:${id}:b`, x: 100, y: 0, z: 10 },
    { id: `feature-vertex:${id}:c`, x: 100, y: 100, z: 10 },
  ],
});

interface GroupWorld {
  project: CadProject;
  groupId: string;
  revision: string;
  result: CadGradingGroupResult;
}

const groupWorld = (): GroupWorld => {
  const drawing = createBlankCadDrawingDocument({ name: 'B2 group', units: 'm' });
  const flId = nextId('fl');
  const targetId = nextId('tgt');
  const project: CadProject = {
    ...drawing.project,
    entities: [makeChainFeatureLine(flId)],
    surfaces: [flatSurface(targetId)],
  };
  const created = runCadCommand(createCadHistoryState(project), {
    key: 'GROUP_CREATE',
    name: 'GG1',
    sourceFeatureLineId: flId,
    sourceCourses: [
      { vertexAId: `feature-vertex:${flId}:a`, vertexBId: `feature-vertex:${flId}:b` },
      { vertexAId: `feature-vertex:${flId}:b`, vertexBId: `feature-vertex:${flId}:c` },
    ],
    targetSurfaceId: targetId,
    side: 'right',
    criterion: { kind: 'fixed', gradeRatio: -0.5 },
    maxSearchDistance: 100,
    curveChordTolerance: 0.05,
  });
  const withGroup = created.present.project;
  const groupId = withGroup.gradingGroups![0]!.id;
  const inputs = resolveGroupInputs(withGroup, groupId)!;
  const out = computeGradingGroupFromSnapshots({
    groupId,
    revision: inputs.revision,
    members: inputs.memberSources,
    side: inputs.group.side,
    criterion: inputs.group.criterion,
    maxSearchDistance: inputs.group.maxSearchDistance,
    curveChordTolerance: inputs.group.curveChordTolerance,
    closed: false,
    target: { points: [-60, -60, 0, 260, -60, 0, 260, 160, 0, -60, 160, 0], triangles: [0, 1, 2, 0, 2, 3] },
  });
  if (!out.ok) throw new Error(`group compute failed: ${out.code} ${out.detail ?? ''}`);
  return { project: withGroup, groupId, revision: inputs.revision, result: out.result };
};

describe('20K.2 group products consume the certificate', () => {
  const tiedGroupMesh = {
    points: [0, 0, 0, 10, 0, 0, 10, 2, 0, 0, 2, 0, 20, 20, 0, 30, 20, 0, 30, 22, 0, 20, 22, 0],
    triangles: [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7],
  };

  it('a single-region certified group extracts and bakes (one undo each)', () => {
    const world = groupWorld();
    expect(
      gradingTopologyCertificateProductError(world.result.topologyCertificate, 'group', world.result.gradingMesh, {
        sourceBoundaryPoints: world.result.sourceBoundaryPoints,
        gradingBoundaryPoints: world.result.daylightPoints,
      }),
    ).toBeNull();
    let history = createCadHistoryState(world.project);
    history = runCadCommand(history, {
      key: 'GROUPEXTRACTDAYLIGHT',
      groupId: world.groupId, result: world.result,
      expectedRevision: world.revision, sessionCurrent: true,
    });
    expect(history.undoStack.length).toBe(1);
    history = runCadCommand(history, {
      key: 'GROUPBAKE',
      groupId: world.groupId, result: world.result,
      expectedRevision: world.revision, sessionCurrent: true,
    });
    expect(history.undoStack.length).toBe(2);
    expect(history.present.project.surfaces).toHaveLength(2);
  });

  it('a multi-region group mesh blocks Extract while Bake emits one surface', () => {
    const world = groupWorld();
    const cert = buildGradingTopologyCertificateExact({
      scope: 'group',
      points: tiedGroupMesh.points,
      triangles: tiedGroupMesh.triangles,
      expectation: deriveGradingTopologyExpectation({
        scope: 'group', closed: false, positiveWidthRegions: 2, tiedSplitCoords: [20, 20, 0],
      }),
      sourceBoundaryPoints: world.result.sourceBoundaryPoints,
      gradingBoundaryPoints: world.result.daylightPoints,
    });
    if (!cert) throw new Error('group certificate build failed');
    const tied: CadGradingGroupResult = {
      ...world.result, gradingMesh: { ...tiedGroupMesh }, topologyCertificate: cert,
    };
    expect(gradingTopologyCertificateError(cert, 'group', tied.gradingMesh)).toBeNull();
    expect(gradingTopologyCertificateProductError(cert, 'group', tied.gradingMesh, {
      sourceBoundaryPoints: tied.sourceBoundaryPoints,
      gradingBoundaryPoints: tied.daylightPoints,
    })).toBe('GRADING_TOPOLOGY_MULTI_REGION_NOT_EXPORTABLE');
    const before = JSON.stringify(world.project);
    let history = createCadHistoryState(world.project);
    history = runCadCommand(history, {
      key: 'GROUPEXTRACTDAYLIGHT',
      groupId: world.groupId, result: tied,
      expectedRevision: world.revision, sessionCurrent: true,
    });
    expect(history.undoStack.length).toBe(0);
    expect(JSON.stringify(history.present.project)).toBe(before);
    // Wave E1: the same multi-region group mesh bakes as one explicit-TIN surface.
    history = runCadCommand(history, {
      key: 'GROUPBAKE',
      groupId: world.groupId, result: tied,
      expectedRevision: world.revision, sessionCurrent: true,
    });
    expect(history.undoStack.length).toBe(1);
    expect(history.present.project.surfaces).toHaveLength(2);
  });

  it('a forged daylight boundary blocks group products with zero mutation', () => {
    const world = groupWorld();
    // Certified mesh, wrong exported boundary: the product gate re-derives the
    // grading digest from the result's daylightPoints and rejects.
    const forged: CadGradingGroupResult = {
      ...world.result,
      daylightPoints: world.result.daylightPoints.map((v, i) => (i % 3 === 2 ? v + 5 : v)),
    };
    const before = JSON.stringify(world.project);
    let history = createCadHistoryState(world.project);
    history = runCadCommand(history, {
      key: 'GROUPEXTRACTDAYLIGHT',
      groupId: world.groupId, result: forged,
      expectedRevision: world.revision, sessionCurrent: true,
    });
    history = runCadCommand(history, {
      key: 'GROUPBAKE',
      groupId: world.groupId, result: forged,
      expectedRevision: world.revision, sessionCurrent: true,
    });
    expect(history.undoStack.length).toBe(0);
    expect(JSON.stringify(history.present.project)).toBe(before);
  });

  it('the same group mesh without the certificate is blocked', () => {
    const world = groupWorld();
    const { topologyCertificate: _dropped, ...uncertified } = world.result;
    const before = JSON.stringify(world.project);
    let history = createCadHistoryState(world.project);
    history = runCadCommand(history, {
      key: 'GROUPEXTRACTDAYLIGHT',
      groupId: world.groupId, result: uncertified as CadGradingGroupResult,
      expectedRevision: world.revision, sessionCurrent: true,
    });
    history = runCadCommand(history, {
      key: 'GROUPBAKE',
      groupId: world.groupId, result: uncertified as CadGradingGroupResult,
      expectedRevision: world.revision, sessionCurrent: true,
    });
    expect(history.undoStack.length).toBe(0);
    expect(JSON.stringify(history.present.project)).toBe(before);
  });
});
