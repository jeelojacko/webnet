/**
 * Phase 20K.3 Wave D — curved Surface worker agreement authority (GREEN).
 *
 * The engine proves daylight agreement with the single shared anchored bound
 * `anchoredElevationAgreementTol` (`elevationAgreementTol` over the grading
 * plane leverage + the world-coordinate representation share + the 1 nm
 * `AGREEMENT_FLOOR`). Before Wave D the worker settlement re-checked the SAME
 * daylight vertices against the SAME target with the bare classification floor
 * `zeroDelta` — orders of magnitude tighter than the accumulated curved-arc
 * rounding — and reconstructed the source boundary as
 * `start + chordDir·arcLength`, which overshoots a genuine arc endpoint by
 * `arcLength − chord` (≈0.665 m for chord 100 / R 252.5).
 *
 * Wave D deletes that reconstruction and routes both halves through the shared
 * authority: `validateDaylightAgainstTarget` uses the anchored target plane
 * (via the bounded query) and `sourceBoundaryCheck` compares the result's OWN
 * captured `sourceBoundaryPoints` endpoints with the persisted resolved
 * endpoints. Standalone and group settlement use the same daylight authority.
 */
import { describe, expect, it } from 'vitest';

import { createBlankCadDrawingDocument } from '../src/engine/cad/cadDrawingFile';
import { parcelBulgeFromArcDefinition } from '../src/engine/cad/cadParcelArcGeometry';
import { getSurfaceElevationAt, getSurfacePlaneAt } from '../src/engine/cad/cadSurfaceInterpolation';
import { createCadSurfaceCache } from '../src/engine/cad/cadSurfaceCache';
import { buildCadSurface } from '../src/engine/cad/cadSurfaces';
import { createCadHistoryState, runCadCommand } from '../src/engine/cad/cadUndoRedo';
import { createCadGradingCache } from '../src/engine/cad/grading/gradingCache';
import { directFanOnTarget } from '../src/engine/cad/grading/gradingChordSeam';
import { buildTargetQuery } from '../src/engine/cad/grading/gradingTargetIndex';
import { linearizeGradingArc } from '../src/engine/cad/grading/gradingCurve';
import { resolveGradingInputs } from '../src/engine/cad/grading/gradingResolve';
import { resolveGroupInputs } from '../src/engine/cad/grading/gradingGroupResolve';
import { computeGradingGroupFromSnapshots } from '../src/engine/cad/grading/gradingGroupCompute';
import {
  AGREEMENT_FLOOR,
  anchoredElevationAgreementTol,
  elevationAgreementTol,
  planeLeverage,
  type AnchoredPlane,
} from '../src/engine/cad/grading/gradingGroupSectors';
import {
  computeGradingFromSnapshots,
  validateDaylightAgainstTarget,
  validateGradingResultAgainstTarget,
  validateGradingSourceBoundary,
  type GradingTargetQuery,
} from '../src/workers/surfaceGradingCompute';
import {
  SurfaceGradingService,
  type SurfaceGradingTransport,
} from '../src/workers/surfaceGradingService';
import { roundedSquareMembers } from '../scripts/phase20kHybridArcPairGroups';
import type { CadFeatureLineEntity, CadProject, CadSurface } from '../src/engine/cad/cadTypes';
import type { CadGradingResult, GradingCriterion } from '../src/engine/cad/grading/gradingTypes';
import type { CadGradingGroupResult } from '../src/engine/cad/grading/gradingGroupTypes';
import type { GradingTargetMeshSnapshot } from '../src/engine/cad/grading/gradingComputeTypes';

const ARC_TOLERANCE = 0.1;
const SEARCH = 200;
const ARC_SOURCE = roundedSquareMembers(10)[0]!.source;
const FIXED: GradingCriterion = { kind: 'fixed', gradeRatio: -0.5 };
const CUT_FILL: GradingCriterion = { kind: 'cut-fill', cutGradeRatio: 0.5, fillGradeRatio: -2 };

let seq = 0;
const nextId = (prefix: string): string => {
  seq += 1;
  return `${prefix}-20k3-d-${seq}`;
};

const range = (a: number, b: number, s: number): number[] => {
  const out: number[] = [];
  for (let v = a; v <= b + 1e-9; v += s) out.push(v);
  return out;
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

const flatTin = (): GradingTargetMeshSnapshot => ({
  points: [-400, -400, 0, 500, -400, 0, 500, 500, 0, -400, 500, 0],
  triangles: [0, 1, 2, 0, 2, 3],
});

/** Plane through the middle linearized chord: one genuine tied interval. */
const tiedPlaneTin = (): GradingTargetMeshSnapshot => {
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

/** Tilted cross target: a genuine CUT/FILL split on the bottom arc. */
const crossTin = (): GradingTargetMeshSnapshot =>
  gridTin((x) => 10 + 0.1 * (x - 50), range(-100, 200, 10), range(-60, 60, 10));

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

const surfaceFromTin = (id: string, tin: GradingTargetMeshSnapshot): CadSurface => ({
  id,
  name: `Target ${id}`,
  definition: {
    sourceKind: 'explicit-tin',
    pointSource: { kind: 'points', pointEntityIds: [] },
    importedTin: {
      vertices: [...tin.points],
      faces: [...tin.triangles],
      provenance: { kind: 'webnet-bake', sourceSurfaceId: 'seed', sourceSurfaceName: 'seed', sourceRevision: 'srev1:seed' },
    },
  },
  cachedRevision: null,
});

const buildArcWorld = (
  key: 'GRADING_CREATE' | 'GROUP_CREATE',
  tin: GradingTargetMeshSnapshot,
  criterion: GradingCriterion = FIXED,
): { project: CadProject; id: string; revision: string; targetId: string; built: ReturnType<typeof buildCadSurface> } => {
  const drawing = createBlankCadDrawingDocument({ name: '20K.3 D', units: 'm' });
  const flId = nextId('fl');
  const targetId = nextId('tgt');
  const project: CadProject = {
    ...drawing.project,
    entities: [arcFeatureLine(flId)],
    surfaces: [surfaceFromTin(targetId, tin)],
  };
  const course = { vertexAId: `feature-vertex:${flId}:a`, vertexBId: `feature-vertex:${flId}:b` };
  const created = runCadCommand(createCadHistoryState(project), key === 'GRADING_CREATE'
    ? {
        key,
        name: 'Curved Surface',
        sourceFeatureLineId: flId,
        vertexAId: course.vertexAId,
        vertexBId: course.vertexBId,
        targetSurfaceId: targetId,
        side: 'right',
        criterion,
        maxSearchDistance: SEARCH,
        curveChordTolerance: ARC_TOLERANCE,
      }
    : {
        key,
        name: 'Curved Group',
        sourceFeatureLineId: flId,
        sourceCourses: [course],
        targetSurfaceId: targetId,
        side: 'right',
        criterion,
        maxSearchDistance: SEARCH,
        curveChordTolerance: ARC_TOLERANCE,
      });
  const withGrading = created.present.project;
  const id = key === 'GRADING_CREATE' ? withGrading.gradings![0]!.id : withGrading.gradingGroups![0]!.id;
  const revision = key === 'GRADING_CREATE'
    ? resolveGradingInputs(withGrading, id)!.revision
    : resolveGroupInputs(withGrading, id)!.revision;
  return {
    project: withGrading,
    id,
    revision,
    targetId,
    built: buildCadSurface(withGrading, withGrading.surfaces!.find((s) => s.id === targetId)!),
  };
};

const snapOf = (built: ReturnType<typeof buildCadSurface>): GradingTargetMeshSnapshot => ({
  points: built.points.flatMap((p) => [p.x, p.y, p.z]),
  triangles: built.triangles.flatMap((tri) => [...tri]),
});

/** Exactly the service's cached-TIN query (`targetMeshQuery`). */
const workerQueryOf = (built: ReturnType<typeof buildCadSurface>): GradingTargetQuery => ({
  elevationAt: (x, y) => getSurfaceElevationAt(built as never, x, y),
  planeAt: (x, y) => getSurfacePlaneAt(built as never, x, y),
});

const engineResult = (project: CadProject, gradingId: string): CadGradingResult => {
  const inputs = resolveGradingInputs(project, gradingId)!;
  const built = buildCadSurface(project, inputs.target!);
  const outcome = computeGradingFromSnapshots({
    gradingId,
    revision: inputs.revision,
    source: inputs.resolvedSource,
    side: 'right',
    criterion: (project.gradings!.find((g) => g.id === gradingId)!.criterion),
    maxSearchDistance: SEARCH,
    curveChordTolerance: ARC_TOLERANCE,
    target: snapOf(built),
  });
  if (!outcome.ok) throw new Error(`engine failed: ${outcome.code} ${outcome.detail ?? ''}`);
  return outcome.result;
};

const flush = async (rounds = 5): Promise<void> => {
  for (let i = 0; i < rounds; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

const cacheTin = (
  tinCache: ReturnType<typeof createCadSurfaceCache>,
  targetId: string,
  revision: string,
  built: ReturnType<typeof buildCadSurface>,
): void => {
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

/** Real loopback settlement: the service transport returns the engine result. */
const settle = async (
  project: CadProject,
  gradingId: string,
  targetId: string,
  built: ReturnType<typeof buildCadSurface>,
): Promise<{ diagnostic: string | undefined; status: string }> => {
  const inputs = resolveGradingInputs(project, gradingId)!;
  const tinCache = createCadSurfaceCache('20k3');
  const gradingCache = createCadGradingCache('20k3');
  cacheTin(tinCache, targetId, inputs.targetRevision!, built);
  const transport: SurfaceGradingTransport = {
    alive: true,
    deriveGrading: (request) => ({
      requestId: `lb-${request.gradingId}`,
      done: Promise.resolve((() => {
        const outcome = computeGradingFromSnapshots(request);
        if (!outcome.ok) throw new Error(`${outcome.code}: ${outcome.detail ?? ''}`);
        return outcome.result;
      })()),
      cancel: () => undefined,
    }),
    cancel: () => undefined,
    dispose: () => undefined,
  };
  const service = new SurfaceGradingService({
    drawingId: '20k3',
    getProject: () => project,
    getDrawingId: () => '20k3',
    tinCache,
    gradingCache,
    createTransport: () => transport,
    notify: () => undefined,
    onStateChange: () => undefined,
  });
  service.requestGrading(gradingId);
  await flush();
  const diagnostic = service.gradingDiagnostics().get(gradingId)?.error;
  return { diagnostic, status: service.statusOf(gradingId).status };
};

/** Loopback group settlement through the real service. */
const settleGroup = async (
  project: CadProject,
  groupId: string,
  targetId: string,
  built: ReturnType<typeof buildCadSurface>,
): Promise<{ diagnostic: string | undefined; status: string; result: CadGradingGroupResult | null }> => {
  const inputs = resolveGroupInputs(project, groupId)!;
  const tinCache = createCadSurfaceCache('20k3g');
  cacheTin(tinCache, targetId, inputs.targetRevision!, built);
  let captured: CadGradingGroupResult | null = null;
  const transport: SurfaceGradingTransport = {
    alive: true,
    deriveGrading: () => {
      throw new Error('unused');
    },
    deriveGroupGrading: (request) => ({
      requestId: `lb-${request.groupId}`,
      done: Promise.resolve((() => {
        const outcome = computeGradingGroupFromSnapshots({
          groupId: request.groupId,
          revision: request.revision,
          members: request.memberSources,
          side: request.side,
          criterion: request.criterion,
          memberCriteria: request.memberCriteria,
          maxSearchDistance: request.maxSearchDistance,
          curveChordTolerance: request.curveChordTolerance,
          closed: request.closed,
          ...(request.target ? { target: request.target } : {}),
        });
        if (!outcome.ok) throw new Error(`${outcome.code}: ${outcome.detail ?? ''}`);
        captured = outcome.result;
        return outcome.result;
      })()),
      cancel: () => undefined,
    }),
    cancel: () => undefined,
    dispose: () => undefined,
  };
  const service = new SurfaceGradingService({
    drawingId: '20k3g',
    getProject: () => project,
    getDrawingId: () => '20k3g',
    tinCache,
    gradingCache: createCadGradingCache('20k3g'),
    createTransport: () => transport,
    notify: () => undefined,
    onStateChange: () => undefined,
  });
  service.requestGroupGrading(groupId);
  await flush();
  return {
    diagnostic: service.groupGradingDiagnostics().get(groupId)?.error,
    status: service.groupStatusOf(groupId).status,
    result: captured,
  };
};

const engineGroupResult = (
  project: CadProject,
  groupId: string,
  target: GradingTargetMeshSnapshot,
): CadGradingGroupResult => {
  const inputs = resolveGroupInputs(project, groupId)!;
  const outcome = computeGradingGroupFromSnapshots({
    groupId,
    revision: inputs.revision,
    members: inputs.memberSources,
    side: inputs.group.side,
    criterion: inputs.group.criterion,
    memberCriteria: inputs.memberCriteria,
    maxSearchDistance: inputs.group.maxSearchDistance,
    curveChordTolerance: inputs.group.curveChordTolerance,
    closed: inputs.group.closed === true,
    target,
  });
  if (!outcome.ok) throw new Error(`group engine failed: ${outcome.code} ${outcome.detail ?? ''}`);
  return outcome.result;
};

// ---------------------------------------------------------------------------
// Wave D authority — curved arc settlement
// ---------------------------------------------------------------------------

describe('20K.3 Wave D curved Surface worker agreement authority', () => {
  it('(A) tied split arc: engine CURRENT, worker daylight authority passes, service CURRENT', async () => {
    const world = buildArcWorld('GRADING_CREATE', tiedPlaneTin());
    const result = engineResult(world.project, world.id);
    expect(result.topologyCertificate?.components).toBe(2);
    expect(result.daylightPoints.length % 3).toBe(0);

    // Shared anchored authority accepts the genuine tied split.
    const query = workerQueryOf(world.built);
    expect(validateDaylightAgainstTarget(result.daylightPoints, query)).toBeNull();

    const settled = await settle(world.project, world.id, world.targetId, world.built);
    expect(settled.diagnostic).toBeUndefined();
    expect(settled.status).toBe('CURRENT');
  });

  it('(B) single-region arc flat-target Fixed: service CURRENT with gtop2', async () => {
    const world = buildArcWorld('GRADING_CREATE', flatTin());
    const result = engineResult(world.project, world.id);
    expect(result.topologyCertificate).toMatchObject({ version: 'gtop2', scope: 'standalone', components: 1, boundaryCycles: 1 });
    expect(validateDaylightAgainstTarget(result.daylightPoints, workerQueryOf(world.built))).toBeNull();

    const settled = await settle(world.project, world.id, world.targetId, world.built);
    expect(settled.diagnostic).toBeUndefined();
    expect(settled.status).toBe('CURRENT');
  });

  it('(C) source boundary compares the captured authoritative arc endpoints, never chord×arcLength', () => {
    const world = buildArcWorld('GRADING_CREATE', flatTin());
    const source = resolveGradingInputs(world.project, world.id)!.resolvedSource;
    const result = engineResult(world.project, world.id);
    const boundary = result.sourceBoundaryPoints!;
    expect(boundary.length % 3).toBe(0);

    const expectedFirst = { x: source.startX, y: source.startY, z: source.startZ };
    const expectedLast = { x: source.endX, y: source.endY, z: source.endZ };
    const first = { x: boundary[0]!, y: boundary[1]!, z: boundary[2]! };
    const last = { x: boundary[boundary.length - 3]!, y: boundary[boundary.length - 2]!, z: boundary[boundary.length - 1]! };
    const coordinateScale = Math.max(
      Math.abs(source.arc!.centerX),
      Math.abs(source.arc!.centerY),
      source.arc!.radius,
    );
    // Captured real-arc endpoints agree with the persisted endpoints.
    expect(validateGradingSourceBoundary({ first, last, expectedFirst, expectedLast, coordinateScale })).toBeNull();

    // The deleted reconstruction `start + chordDir·arcLength` overshoots by arc−chord.
    const chord = Math.hypot(source.endX - source.startX, source.endY - source.startY);
    expect(chord).toBeCloseTo(100, 12);
    expect(source.length).toBeCloseTo(100.66533901607366, 9);
    const overshoot = source.length - chord;
    expect(overshoot).toBeCloseTo(0.6653390160736592, 9);
    const dirX = (source.endX - source.startX) / chord;
    const dirY = (source.endY - source.startY) / chord;
    const reconstructedLast = {
      x: source.startX + dirX * source.length,
      y: source.startY + dirY * source.length,
      z: source.endZ,
    };
    expect(Math.hypot(reconstructedLast.x - source.endX, reconstructedLast.y - source.endY)).toBeCloseTo(overshoot, 9);
    expect(
      validateGradingSourceBoundary({ first, last: reconstructedLast, expectedFirst, expectedLast, coordinateScale }),
    ).toBe('GRADING_AGREEMENT_SOURCE_BOUNDARY');

    // A tampered captured endpoint fails closed.
    expect(
      validateGradingSourceBoundary({
        first,
        last: { x: last.x + 1, y: last.y, z: last.z },
        expectedFirst,
        expectedLast,
        coordinateScale,
      }),
    ).toBe('GRADING_AGREEMENT_SOURCE_BOUNDARY');
  });

  it('(D) group gate is daylight-only; standalone gate is source+daylight', () => {
    const world = buildArcWorld('GROUP_CREATE', flatTin());
    const group = engineGroupResult(world.project, world.id, snapOf(world.built));
    const query = workerQueryOf(world.built);
    const daylight = group.daylightPoints ?? [];
    expect(validateDaylightAgainstTarget(daylight, query)).toBeNull();

    const inputs = resolveGroupInputs(world.project, world.id)!;
    const member = inputs.memberSources[0]!;
    const sourceCheck = {
      first: { x: group.sourceBoundaryPoints![0]!, y: group.sourceBoundaryPoints![1]!, z: group.sourceBoundaryPoints![2]! },
      last: {
        x: group.sourceBoundaryPoints![group.sourceBoundaryPoints!.length - 3]!,
        y: group.sourceBoundaryPoints![group.sourceBoundaryPoints!.length - 2]!,
        z: group.sourceBoundaryPoints![group.sourceBoundaryPoints!.length - 1]!,
      },
      expectedFirst: { x: member.startX, y: member.startY, z: member.startZ },
      expectedLast: { x: member.endX, y: member.endY, z: member.endZ },
      coordinateScale: member.arc
        ? Math.max(Math.abs(member.arc.centerX), Math.abs(member.arc.centerY), member.arc.radius)
        : 0,
    };
    expect(validateGradingResultAgainstTarget(daylight, query, sourceCheck)).toBeNull();
  });

  it('(E) group arc settles CURRENT through the real service', async () => {
    const world = buildArcWorld('GROUP_CREATE', flatTin());
    const settled = await settleGroup(world.project, world.id, world.targetId, world.built);
    expect(settled.diagnostic).toBeUndefined();
    expect(settled.status).toBe('CURRENT');
  });

  it('(F) tampered daylight fails closed (never CURRENT)', async () => {
    const world = buildArcWorld('GRADING_CREATE', flatTin());
    const query = workerQueryOf(world.built);
    const result = engineResult(world.project, world.id);
    const tampered = [...result.daylightPoints];
    tampered[2] = tampered[2]! + 1;
    expect(validateDaylightAgainstTarget(tampered, query)).toBe('GRADING_AGREEMENT_DAYLIGHT_Z');

    // Off-mesh daylight is a distinct target-gap rejection.
    const off = [10_000, 10_000, 0];
    expect(validateDaylightAgainstTarget(off, query)).toBe('GRADING_AGREEMENT_DAYLIGHT_OFF_TARGET');
    // Non-finite daylight fails closed.
    expect(validateDaylightAgainstTarget([Number.NaN, 0, 0], query)).toBe('GRADING_AGREEMENT_MALFORMED_DAYLIGHT');
  });
});

// ---------------------------------------------------------------------------
// Wave D mismatch ladder (local + projected)
// ---------------------------------------------------------------------------

const planeQuery = (zAt: number, plane: AnchoredPlane): GradingTargetQuery => ({
  elevationAt: () => zAt,
  planeAt: () => ({ z: zAt, ...plane }),
});

describe('20K.3 Wave D agreement mismatch ladder', () => {
  it('local coordinates: noise/floor pass, mismatch fails', () => {
    const query = planeQuery(0, { gx: 0, gy: 0, ax: 0, ay: 0 });
    const classify = (dz: number): string | null => validateDaylightAgainstTarget([0, 0, dz], query);
    expect(classify(0)).toBeNull();
    expect(classify(1e-12)).toBeNull();
    expect(classify(1e-9)).toBeNull();
    // The genuine curved seam residual measured in Wave A.
    expect(classify(3.48e-13)).toBeNull();
    expect(classify(1e-8)).toBe('GRADING_AGREEMENT_DAYLIGHT_Z');
    expect(classify(1e-6)).toBe('GRADING_AGREEMENT_DAYLIGHT_Z');
    expect(classify(1e-3)).toBe('GRADING_AGREEMENT_DAYLIGHT_Z');
    // The 1 nm floor is untouched.
    expect(AGREEMENT_FLOOR).toBe(1e-9);
  });

  it('projected coordinates: leverage justifies >1 nm, mm still fails', () => {
    const E = 5_000_000;
    const N = 5_000_000;
    const query = planeQuery(0, { gx: 0.2, gy: 0.1, ax: E, ay: N });
    const scale = Math.max(1, Math.abs(E), Math.abs(N));
    const bound =
      elevationAgreementTol(0, 0, planeLeverage({ gx: 0.2, gy: 0.1, ax: E, ay: N }, E, N)) +
      (0.2 + 0.1) * 32 * Number.EPSILON * scale +
      AGREEMENT_FLOOR;
    expect(bound).toBeGreaterThan(1e-9);
    // Just above the local floor: leverage justifies it at projected coords.
    expect(validateDaylightAgainstTarget([E, N, 1e-8], query)).toBeNull();
    // A millimetre still fails everywhere.
    expect(validateDaylightAgainstTarget([E, N, 1e-3], query)).toBe('GRADING_AGREEMENT_DAYLIGHT_Z');
    // Sanity: the shared authority is the bound being applied.
    expect(anchoredElevationAgreementTol(0, 1e-8, planeLeverage(query.planeAt!(E, N)!, E, N), 0.3, E, N)).toBeCloseTo(bound, 12);
  });
});

// ---------------------------------------------------------------------------
// Wave D real CURRENT-path oracles via SurfaceGradingService
// ---------------------------------------------------------------------------

const straightFeatureLine = (id: string): CadFeatureLineEntity => ({
  id,
  type: 'feature-line',
  layerId: 'general',
  visible: true,
  locked: false,
  name: `FL ${id}`,
  vertices: [
    { id: `feature-vertex:${id}:a`, x: 0, y: 0, z: 10 },
    { id: `feature-vertex:${id}:b`, x: 100, y: 0, z: 10 },
  ],
});

const buildStraightWorld = (
  tin: GradingTargetMeshSnapshot,
  criterion: GradingCriterion,
): { project: CadProject; id: string; targetId: string; built: ReturnType<typeof buildCadSurface> } => {
  const drawing = createBlankCadDrawingDocument({ name: '20K.3 D straight', units: 'm' });
  const flId = nextId('fl');
  const targetId = nextId('tgt');
  const project: CadProject = {
    ...drawing.project,
    entities: [straightFeatureLine(flId)],
    surfaces: [surfaceFromTin(targetId, tin)],
  };
  const created = runCadCommand(createCadHistoryState(project), {
    key: 'GRADING_CREATE',
    name: 'Straight Surface',
    sourceFeatureLineId: flId,
    vertexAId: `feature-vertex:${flId}:a`,
    vertexBId: `feature-vertex:${flId}:b`,
    targetSurfaceId: targetId,
    side: 'right',
    criterion,
    maxSearchDistance: 100,
    curveChordTolerance: ARC_TOLERANCE,
  });
  const withGrading = created.present.project;
  const id = withGrading.gradings![0]!.id;
  return {
    project: withGrading,
    id,
    targetId,
    built: buildCadSurface(withGrading, withGrading.surfaces!.find((s) => s.id === targetId)!),
  };
};

describe('20K.3 Wave D real CURRENT-path oracles via SurfaceGradingService', () => {
  it('standalone straight Fixed settles CURRENT', async () => {
    const world = buildStraightWorld(flatTin(), FIXED);
    const result = engineResult(world.project, world.id);
    expect(result.topologyCertificate?.components).toBe(1);
    const settled = await settle(world.project, world.id, world.targetId, world.built);
    expect(settled.diagnostic).toBeUndefined();
    expect(settled.status).toBe('CURRENT');
  });

  it('standalone Cut/Fill settles CURRENT with both regions', async () => {
    const world = buildStraightWorld(crossTin(), CUT_FILL);
    const result = engineResult(world.project, world.id);
    const kinds = new Set(result.regions.map((r) => r.classification));
    expect(kinds.has('CUT')).toBe(true);
    expect(kinds.has('FILL')).toBe(true);
    const settled = await settle(world.project, world.id, world.targetId, world.built);
    expect(settled.diagnostic).toBeUndefined();
    expect(settled.status).toBe('CURRENT');
  });

  it('standalone tied split settles CURRENT with 2/2 topology, no daylight reject', async () => {
    const world = buildArcWorld('GRADING_CREATE', tiedPlaneTin());
    const result = engineResult(world.project, world.id);
    expect(result.topologyCertificate).toMatchObject({ components: 2, boundaryCycles: 2 });
    const settled = await settle(world.project, world.id, world.targetId, world.built);
    expect(settled.diagnostic).toBeUndefined();
    expect(settled.status).toBe('CURRENT');
  });

  it('group tied split: correct N/N topology, no daylight reject, CURRENT', async () => {
    const world = buildArcWorld('GROUP_CREATE', tiedPlaneTin());
    const result = engineGroupResult(world.project, world.id, snapOf(world.built));
    expect(result.topologyCertificate).toMatchObject({ components: 2, boundaryCycles: 2 });
    const query = workerQueryOf(world.built);
    expect(validateDaylightAgainstTarget(result.daylightPoints, query)).toBeNull();
    const settled = await settleGroup(world.project, world.id, world.targetId, world.built);
    expect(settled.diagnostic).toBeUndefined();
    expect(settled.status).toBe('CURRENT');
  });

  it('straight source boundary is bit-exact (straight path unchanged)', () => {
    const world = buildStraightWorld(flatTin(), FIXED);
    const result = engineResult(world.project, world.id);
    const source = resolveGradingInputs(world.project, world.id)!.resolvedSource;
    const boundary = result.sourceBoundaryPoints!;
    expect(boundary[0]).toBe(source.startX);
    expect(boundary[1]).toBe(source.startY);
    expect(boundary[boundary.length - 3]).toBe(source.endX);
    expect(boundary[boundary.length - 2]).toBe(source.endY);
  });

  it('all-Surface rounded square settles CURRENT through the service', async () => {
    const world = buildSquareWorld();
    const inputs = resolveGroupInputs(world.project, world.id)!;
    const settled = await settleGroup(world.project, world.id, world.targetId, world.built);
    expect(settled.diagnostic).toBeUndefined();
    expect(settled.status).toBe('CURRENT');
    expect(inputs.memberSources).toHaveLength(4);
    expect(settled.result?.topologyCertificate).toMatchObject({ components: 1, boundaryCycles: 2 });
    // The daylight authority accepts every merged square daylight vertex.
    expect(validateDaylightAgainstTarget(settled.result!.daylightPoints, workerQueryOf(world.built))).toBeNull();
  });

  it('non-planar fan across a ridge is not a direct cut/fill transition', () => {
    // The seam admits a direct CUT/FILL transition fan ONLY on a proven
    // planar bridge; the caller maps a false fan to
    // GRADING_SURFACE_SEAM_TRANSITION_REQUIRED. A ridge between qIn/qOut is
    // the canonical fail-closed case.
    const ridge = gridTin(
      (x) => (x > 2 && x < 8 ? 5 * (1 - Math.abs((x - 5) / 3)) : 0),
      range(-20, 20, 1),
      range(-20, 20, 4),
    );
    const query = buildTargetQuery(ridge)!;
    const cutFill: GradingCriterion = { kind: 'cut-fill', cutGradeRatio: 0.5, fillGradeRatio: -2 };
    expect(directFanOnTarget(cutFill, query, { x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, { x: 0, y: -10, z: 0 })).toBe(false);
  });

  it('hybrid arc×arc joint stays fail-closed (CORNER_NO_SOLUTION / ARC_PAIR_UNSUPPORTED)', () => {
    const members = roundedSquareMembers(10);
    const out = computeGradingGroupFromSnapshots({
      groupId: 'arcxarc',
      revision: 'r',
      members: [members[0]!.source, members[1]!.source],
      side: 'right',
      criterion: FIXED,
      memberCriteria: [FIXED, { kind: 'distance', gradeRatio: -0.5, distance: 20 }],
      maxSearchDistance: SEARCH,
      curveChordTolerance: ARC_TOLERANCE,
      closed: false,
      target: flatTin(),
    });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.code).toBe('CORNER_NO_SOLUTION');
    expect(out.detail).toContain('GRADING_SURFACE_ANALYTIC_ARC_PAIR_UNSUPPORTED');
  });
});

// ---------------------------------------------------------------------------
// Wave D all-Surface rounded-square product fixture
// ---------------------------------------------------------------------------

const SQUARE_CORNERS: ReadonlyArray<readonly [number, number]> = [[0, 0], [100, 0], [100, 100], [0, 100]];

const squareFeatureLine = (id: string): CadFeatureLineEntity => {
  const members = roundedSquareMembers(10);
  const segmentGeometry = members.map((member, k) => {
    const arc = member.source.arc!;
    let sweep = ((((arc.endAngle - arc.startAngle) * 180) / Math.PI) % 360 + 360) % 360;
    if (!arc.sweepCCW) sweep -= 360;
    const from = SQUARE_CORNERS[k]!;
    const to = SQUARE_CORNERS[(k + 1) % 4]!;
    const bulge = parcelBulgeFromArcDefinition({
      from: { x: from[0], y: from[1] },
      to: { x: to[0], y: to[1] },
      center: { x: arc.centerX, y: arc.centerY },
      radius: arc.radius,
      signedSweepDeg: sweep,
    });
    if (bulge == null) throw new Error(`square bulge ${k} unresolved`);
    return { kind: 'arc' as const, bulge };
  });
  return {
    id,
    type: 'feature-line',
    layerId: 'general',
    visible: true,
    locked: false,
    name: `FL ${id}`,
    closed: true,
    vertices: SQUARE_CORNERS.map(([x, y], k) => ({ id: `${id}:v${k}`, x, y, z: 10 })),
    segmentGeometry,
  };
};

const buildSquareWorld = (): {
  project: CadProject;
  id: string;
  targetId: string;
  built: ReturnType<typeof buildCadSurface>;
} => {
  const drawing = createBlankCadDrawingDocument({ name: '20K.3 D square', units: 'm' });
  const flId = nextId('sqfl');
  const targetId = nextId('sqtgt');
  const entity = squareFeatureLine(flId);
  const project: CadProject = {
    ...drawing.project,
    entities: [entity],
    surfaces: [surfaceFromTin(targetId, flatTin())],
  };
  const ids = entity.vertices.map((v) => v.id);
  const created = runCadCommand(createCadHistoryState(project), {
    key: 'GROUP_CREATE',
    name: 'Rounded Square',
    sourceFeatureLineId: flId,
    sourceCourses: ids.map((id, i) => ({ vertexAId: id, vertexBId: ids[(i + 1) % 4]! })),
    targetSurfaceId: targetId,
    side: 'right',
    criterion: FIXED,
    maxSearchDistance: 100,
    curveChordTolerance: ARC_TOLERANCE,
    closed: true,
  });
  const withGroup = created.present.project;
  return {
    project: withGroup,
    id: withGroup.gradingGroups![0]!.id,
    targetId,
    built: buildCadSurface(withGroup, withGroup.surfaces!.find((s) => s.id === targetId)!),
  };
};
