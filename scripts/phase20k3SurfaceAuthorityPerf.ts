/**
 * Phase 20K.3 Wave E2 — Surface authority performance (measurement only, no thresholds).
 *
 * Every fixture is built ONCE outside every timed region, and every stage
 * times the ACTUAL production entry point:
 *   expected-topology derivation -> `deriveGradingTopologyExpectation` /
 *                                   `countPositiveWidthStationRuns`
 *   boundary-cycle validation    -> `validateGradingMeshTopology` /
 *                                   `traceBoundaryCycles`
 *   digest construction          -> gtop1 `digestTopologyMesh` (FNV over
 *                                   `toPrecision(12)` text) vs gtop2
 *                                   `digestTopologyMeshExact` (SHA-256 over
 *                                   exact F64 bits + u32 indices)
 *   certificate build            -> `buildGradingTopologyCertificate` (gtop1)
 *                                   vs `...CertificateExact` (gtop2)
 *   gtop2 product revalidation   -> `gradingTopologyCertificateError` /
 *                                   `...ExactError` / `...ProductError`
 *   Surface source               -> `resolveDesignPatchRing` canonicalization
 *     canonicalization              (raw captured ring -> canonical stations)
 *   Calculate (all-Surface)      -> `computeGradingGroupFromSnapshots`
 *   worker agreement             -> `validateDaylightAgainstTarget` /
 *                                   `validateGradingResultAgainstTarget` /
 *                                   `validateGradingSourceBoundary`
 *   tied split                   -> `computeGradingFromSnapshots` (real arc)
 *   Design Patch                 -> `resolveDesignPatch`
 *   local/projected/stress       -> the anchored agreement bound at each
 *                                   coordinate magnitude
 *
 * Reported per stage: V/F/E/B (mesh vertices/faces/edges/boundary edges),
 * components/cycles expected vs measured, digest input bytes, median ms, and
 * the digest string. Nothing is asserted; a failed production call is
 * recorded verbatim. Exactness is never relaxed for speed.
 *
 * Usage: npx tsx scripts/phase20k3SurfaceAuthorityPerf.ts [--quick]
 */
import { buildCadSurface } from '../src/engine/cad/cadSurfaces';
import { getSurfaceElevationAt, getSurfacePlaneAt } from '../src/engine/cad/cadSurfaceInterpolation';
import { createBlankCadDrawingDocument } from '../src/engine/cad/cadDrawingFile';
import { parcelBulgeFromArcDefinition } from '../src/engine/cad/cadParcelArcGeometry';
import { createCadHistoryState, runCadCommand } from '../src/engine/cad/cadUndoRedo';
import { resolveDesignPatch } from '../src/engine/cad/cadTransactionsDesignPatchCommands';
import { linearizeGradingArc } from '../src/engine/cad/grading/gradingCurve';
import { computeGradingGroupFromSnapshots } from '../src/engine/cad/grading/gradingGroupCompute';
import { resolveGradingInputs } from '../src/engine/cad/grading/gradingResolve';
import { resolveGroupInputs } from '../src/engine/cad/grading/gradingGroupResolve';
import {
  AGREEMENT_FLOOR,
  anchoredElevationAgreementTol,
  elevationAgreementTol,
  planeLeverage,
  type AnchoredPlane,
} from '../src/engine/cad/grading/gradingGroupSectors';
import { resolveDesignPatchRing } from '../src/engine/cad/grading/designPatchBuild';
import { traceBoundaryCycles, validateGradingMeshTopology } from '../src/engine/cad/grading/gradingTopology';
import {
  buildGradingTopologyCertificate,
  buildGradingTopologyCertificateExact,
  digestTopologyMesh,
  digestTopologyMeshExact,
  gradingTopologyCertificateError,
  gradingTopologyCertificateExactError,
  gradingTopologyCertificateProductError,
} from '../src/engine/cad/grading/gradingTopologyCertificate';
import {
  countPositiveWidthStationRuns,
  deriveGradingTopologyExpectation,
  type DeriveTopologyExpectationInput,
} from '../src/engine/cad/grading/gradingTopologyExpectation';
import { computeGradingFromSnapshots, validateDaylightAgainstTarget, validateGradingResultAgainstTarget, validateGradingSourceBoundary, type GradingTargetQuery } from '../src/workers/surfaceGradingCompute';
import { FIXED, roundedSquareMembers } from './phase20kHybridArcPairGroups';
import type { CadFeatureLineEntity, CadProject, CadSurface } from '../src/engine/cad/cadTypes';
import type { GradingTargetMeshSnapshot } from '../src/engine/cad/grading/gradingComputeTypes';
import type { CadGradingGroupResult } from '../src/engine/cad/grading/gradingGroupTypes';
import type { CadGradingResult } from '../src/engine/cad/grading/gradingTypes';
import type { GradingCriterion } from '../src/engine/cad/grading/gradingTypes';

const QUICK = process.argv.includes('--quick');
const REPS = QUICK ? 1 : 5;
const SEARCH = 100;
const Z = 10;

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
};
const fmt = (v: number): string => (v >= 100 ? v.toFixed(1) : v.toFixed(3));

const timed = (fn: () => void, reps = REPS): number => {
  const ts: number[] = [];
  for (let r = 0; r < reps; r += 1) {
    const t = performance.now();
    fn();
    ts.push(performance.now() - t);
  }
  return median(ts);
};

interface MeshStats {
  v: number; f: number; e: number; b: number;
  components: number; cycles: number;
}

const meshStats = (points: readonly number[], triangles: readonly number[]): MeshStats => {
  const incidence = new Map<string, number>();
  const pairs = new Map<string, [number, number]>();
  const bump = (a: number, b: number): void => {
    const k = a < b ? `${a}|${b}` : `${b}|${a}`;
    incidence.set(k, (incidence.get(k) ?? 0) + 1);
    if (!pairs.has(k)) pairs.set(k, [a, b]);
  };
  for (let i = 0; i + 2 < triangles.length; i += 3) {
    bump(triangles[i]!, triangles[i + 1]!);
    bump(triangles[i + 1]!, triangles[i + 2]!);
    bump(triangles[i + 2]!, triangles[i]!);
  }
  const boundary = [...incidence].filter(([, c]) => c === 1).map(([k]) => pairs.get(k)!);
  const trace = traceBoundaryCycles(boundary);
  const topo = validateGradingMeshTopology(points, triangles, { scope: 'group' });
  return { v: points.length / 3, f: triangles.length / 3, e: incidence.size, b: boundary.length, components: topo.components, cycles: trace.cycles.length };
};

const meshDigestBytes = (points: readonly number[], triangles: readonly number[]): number =>
  points.length * 8 + triangles.length * 4;

const gridTin = (fn: (_x: number, _y: number) => number, xs: number[], ys: number[]): GradingTargetMeshSnapshot => {
  const points: number[] = [];
  for (const y of ys) for (const x of xs) points.push(x, y, fn(x, y));
  const triangles: number[] = [];
  const idx = (ix: number, iy: number): number => iy * xs.length + ix;
  for (let ix = 0; ix + 1 < xs.length; ix += 1) {
    for (let iy = 0; iy + 1 < ys.length; iy += 1) {
      triangles.push(idx(ix, iy), idx(ix + 1, iy), idx(ix + 1, iy + 1));
      triangles.push(idx(ix, iy), idx(ix + 1, iy + 1), idx(ix, iy + 1));
    }
  }
  return { points, triangles };
};
const range = (a: number, b: number, s: number): number[] => {
  const out: number[] = [];
  for (let v = a; v <= b + 1e-9; v += s) out.push(v);
  return out;
};

const pad = (rows: string[][], header: string[]): void => {
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)));
  const line = (cs: string[]): string => cs.map((c, i) => (c ?? '').padEnd(widths[i]!)).join('  ');
  console.log(line(header));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const r of rows) console.log(line(r));
};

// ---------------------------------------------------------------------------
// Fixtures (all built once, before any timed region).
// ---------------------------------------------------------------------------

const SQUARE: ReadonlyArray<readonly [number, number]> = [[0, 0], [100, 0], [100, 100], [0, 100]];
const FIXED05: GradingCriterion = FIXED(-0.5);
const ALL_FIXED: GradingCriterion[] = [FIXED05, FIXED05, FIXED05, FIXED05];
const TIN = [-600, -600, 0, 1000, -600, 0, 1000, 1000, 0, -600, 1000, 0];
const TIN_FACES = [0, 1, 2, 0, 2, 3];
const FLAT_TARGET: GradingTargetMeshSnapshot = { points: TIN, triangles: TIN_FACES };

const arcGeometry = (): Array<{ kind: 'arc'; bulge: number }> => {
  const members = roundedSquareMembers(Z);
  return members.map((member, k) => {
    const arc = member.source.arc!;
    let sweep = ((((arc.endAngle - arc.startAngle) * 180) / Math.PI) % 360 + 360) % 360;
    if (!arc.sweepCCW) sweep -= 360;
    const bulge = parcelBulgeFromArcDefinition({
      from: { x: SQUARE[k]![0], y: SQUARE[k]![1] },
      to: { x: SQUARE[(k + 1) % 4]![0], y: SQUARE[(k + 1) % 4]![1] },
      center: { x: arc.centerX, y: arc.centerY },
      radius: arc.radius,
      signedSweepDeg: sweep,
    });
    if (bulge == null) throw new Error(`bulge ${k} unresolved`);
    return { kind: 'arc', bulge };
  });
};

interface ProductSquare {
  project: CadProject;
  entity: CadFeatureLineEntity;
  surface: CadSurface;
  groupId: string;
  revision: string;
  result: CadGradingGroupResult;
  target: GradingTargetMeshSnapshot;
}

const buildSquare = (): ProductSquare => {
  const drawing = createBlankCadDrawingDocument({ name: '20K.3 E2', units: 'm' });
  const entity: CadFeatureLineEntity = {
    id: 'fl', type: 'feature-line', layerId: 'general', visible: true, locked: false,
    name: 'Rounded square', closed: true,
    vertices: SQUARE.map(([x, y], k) => ({ id: `v${k}`, x, y, z: Z })),
    segmentGeometry: arcGeometry(),
  };
  const surface: CadSurface = {
    id: 'tgt', name: 'EG', layerId: 'general',
    definition: {
      sourceKind: 'explicit-tin', pointSource: { kind: 'points', pointEntityIds: [] },
      importedTin: {
        vertices: TIN, faces: TIN_FACES,
        provenance: { kind: 'webnet-bake', sourceSurfaceId: 'seed', sourceSurfaceName: 'seed', sourceRevision: 'srev1:seed' },
      },
    },
    cachedRevision: null,
  };
  const project: CadProject = { ...drawing.project, entities: [entity], surfaces: [surface] };
  const ids = entity.vertices.map((v) => v.id);
  const history = runCadCommand(createCadHistoryState(project), {
    key: 'GROUP_CREATE', name: 'RG', sourceFeatureLineId: 'fl',
    sourceCourses: ids.map((id, i) => ({ vertexAId: id, vertexBId: ids[(i + 1) % 4]! })),
    targetSurfaceId: 'tgt', side: 'right', criterion: FIXED05, maxSearchDistance: SEARCH,
    curveChordTolerance: 0.1, closed: true,
  });
  const withGroup = history.present.project;
  const groupId = withGroup.gradingGroups![0]!.id;
  const inputs = resolveGroupInputs(withGroup, groupId)!;
  const out = computeGradingGroupFromSnapshots({
    groupId, revision: inputs.revision, members: inputs.memberSources,
    side: inputs.group.side, criterion: inputs.group.criterion, memberCriteria: ALL_FIXED,
    maxSearchDistance: inputs.group.maxSearchDistance,
    curveChordTolerance: inputs.group.curveChordTolerance, closed: true,
    target: FLAT_TARGET,
  });
  if (!out.ok) throw new Error(`all-Surface square failed: ${out.code} ${out.detail ?? ''}`);
  return { project: withGroup, entity, surface, groupId, revision: inputs.revision, result: out.result, target: FLAT_TARGET };
};

const tiedArcSource = roundedSquareMembers(Z)[0]!.source;
const tiedPlaneTarget = (): GradingTargetMeshSnapshot => {
  const arc = tiedArcSource.arc!;
  const lin = linearizeGradingArc(arc.centerX, arc.centerY, arc.radius, arc.startAngle, arc.endAngle, arc.sweepCCW, tiedArcSource.startZ, tiedArcSource.endZ, 0.5)!;
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
  return gridTin((x, y) => tiedArcSource.startZ + a * (x - p0.x) + b * (y - p0.y), range(-200, 300, 25), range(-200, 300, 25));
};

const buildTiedSplit = () => computeGradingFromSnapshots({
  gradingId: 'perf', revision: 'perf', source: tiedArcSource, side: 'right',
  criterion: FIXED05, maxSearchDistance: 200, curveChordTolerance: 0.5, target: tiedPlaneTarget(),
});

const square = buildSquare();
const tied = buildTiedSplit();
if (!tied.ok) throw new Error(`tied split failed: ${tied.code}`);
const tiedResult = tied.result;

const buildSurface = buildCadSurface(square.project, square.surface);
const workerQuery: GradingTargetQuery = {
  elevationAt: (x, y) => getSurfaceElevationAt(buildSurface, x, y),
  planeAt: (x, y) => getSurfacePlaneAt(buildSurface, x, y),
};

/** Single-arc standalone on a flat target: the real Wave D agreement fixture. */
const surfaceFromTin = (id: string, tin: GradingTargetMeshSnapshot): CadSurface => ({
  id, name: 'EG', layerId: 'general',
  definition: {
    sourceKind: 'explicit-tin', pointSource: { kind: 'points', pointEntityIds: [] },
    importedTin: {
      vertices: [...tin.points], faces: [...tin.triangles],
      provenance: { kind: 'webnet-bake', sourceSurfaceId: 'seed', sourceSurfaceName: 'seed', sourceRevision: 'srev1:seed' },
    },
  },
  cachedRevision: null,
});

const arcFeatureLine = (id: string): CadFeatureLineEntity => {
  const arc = tiedArcSource.arc!;
  const sweep = Math.abs(arc.endAngle - arc.startAngle);
  const signed = arc.sweepCCW ? sweep : -sweep;
  return {
    id, type: 'feature-line', layerId: 'general', visible: true, locked: false, name: `FL ${id}`,
    vertices: [
      { id: `feature-vertex:${id}:a`, x: tiedArcSource.startX, y: tiedArcSource.startY, z: tiedArcSource.startZ },
      { id: `feature-vertex:${id}:b`, x: tiedArcSource.endX, y: tiedArcSource.endY, z: tiedArcSource.endZ },
    ],
    segmentGeometry: [{ kind: 'arc', bulge: Math.tan(signed / 4) }],
  };
};

interface ArcStandalone {
  result: CadGradingResult;
  built: ReturnType<typeof buildCadSurface>;
  query: GradingTargetQuery;
}

const buildArcStandalone = (): ArcStandalone => {
  const drawing = createBlankCadDrawingDocument({ name: '20K.3 E2 arc', units: 'm' });
  const flId = 'afl';
  const tgtId = 'atgt';
  const project: CadProject = { ...drawing.project, entities: [arcFeatureLine(flId)], surfaces: [surfaceFromTin(tgtId, FLAT_TARGET)] };
  const created = runCadCommand(createCadHistoryState(project), {
    key: 'GRADING_CREATE', name: 'Arc', sourceFeatureLineId: flId,
    vertexAId: `feature-vertex:${flId}:a`, vertexBId: `feature-vertex:${flId}:b`,
    targetSurfaceId: tgtId, side: 'right', criterion: FIXED05, maxSearchDistance: 200, curveChordTolerance: 0.1,
  });
  const withGrading = created.present.project;
  const gradingId = withGrading.gradings![0]!.id;
  const inputs = resolveGradingInputs(withGrading, gradingId)!;
  const built = buildCadSurface(withGrading, withGrading.surfaces!.find((s) => s.id === tgtId)!);
  const out = computeGradingFromSnapshots({
    gradingId, revision: inputs.revision, source: inputs.resolvedSource, side: 'right',
    criterion: FIXED05, maxSearchDistance: 200, curveChordTolerance: 0.1,
    target: { points: built.points.flatMap((p) => [p.x, p.y, p.z]), triangles: built.triangles.flatMap((tri) => [...tri]) },
  });
  if (!out.ok) throw new Error(`arc standalone failed: ${out.code} ${out.detail ?? ''}`);
  return {
    result: out.result,
    built,
    query: {
      elevationAt: (x, y) => getSurfaceElevationAt(built, x, y),
      planeAt: (x, y) => getSurfacePlaneAt(built, x, y),
    },
  };
};

const arcWorld = buildArcStandalone();
const arcSource = tiedArcSource;
const arcBoundary = arcWorld.result.sourceBoundaryPoints!;
const arcSourceCheck = {
  first: { x: arcBoundary[0]!, y: arcBoundary[1]!, z: arcBoundary[2]! },
  last: { x: arcBoundary[arcBoundary.length - 3]!, y: arcBoundary[arcBoundary.length - 2]!, z: arcBoundary[arcBoundary.length - 1]! },
  expectedFirst: { x: arcSource.startX, y: arcSource.startY, z: arcSource.startZ },
  expectedLast: { x: arcSource.endX, y: arcSource.endY, z: arcSource.endZ },
  coordinateScale: Math.max(Math.abs(arcSource.arc!.centerX), Math.abs(arcSource.arc!.centerY), arcSource.arc!.radius),
};
const stressBase = (): { points: number[]; triangles: number[] } => ({
  points: [100000000, 0, 0, 100000010, 0, 0, 100000010, 2, 0, 100000000, 2, 0],
  triangles: [0, 1, 2, 0, 2, 3],
});
const stressShifted = (): { points: number[]; triangles: number[] } => {
  const m = stressBase();
  m.points[0] = 100000000.0001;
  return m;
};
const stressExpectation = deriveGradingTopologyExpectation({ scope: 'standalone', closed: false, positiveWidthRegions: 1 });
const stressCert = buildGradingTopologyCertificateExact({ scope: 'standalone', ...stressBase(), expectation: stressExpectation })!;

const planeQuery = (zAt: number, plane: AnchoredPlane): GradingTargetQuery => ({
  elevationAt: () => zAt,
  planeAt: () => ({ z: zAt, ...plane }),
});

console.log(`phase20k3 Surface authority perf (${QUICK ? 'quick 1 rep' : `${REPS} reps, median`}) — times in ms`);
console.log(`fixtures built outside all timed regions; production entry points only\n`);

// 1. Expected-topology derivation (pre-mesh declaration).
console.log('== expected-topology derivation (deriveGradingTopologyExpectation) ==');
{
  const cases: Array<{ label: string; input: DeriveTopologyExpectationInput }> = [
    { label: 'standalone.open', input: { scope: 'standalone', closed: false, positiveWidthRegions: 1 } },
    { label: 'standalone.split-3', input: { scope: 'standalone', closed: false, positiveWidthRegions: 3, tiedSplitCoords: [1, 2, 3, 4, 5, 6, 7, 8, 9] } },
    { label: 'standalone.empty-tied', input: { scope: 'standalone', closed: false, positiveWidthRegions: 0 } },
    { label: 'group.closed-annulus', input: { scope: 'group', closed: true, positiveWidthRegions: 1 } },
    { label: 'group.open-2', input: { scope: 'group', closed: false, positiveWidthRegions: 2 } },
  ];
  const rows: string[][] = [];
  for (const c of cases) {
    const e = deriveGradingTopologyExpectation(c.input);
    const ms = timed(() => void deriveGradingTopologyExpectation(c.input));
    rows.push([c.label, e.shape, String(e.expectedFaceComponents), String(e.expectedBoundaryCycles), String(e.tiedSplitCoords.length / 3), fmt(ms)]);
  }
  pad(rows, ['case', 'shape', 'components', 'cycles', 'tiedStations', 'ms']);
  // Real strip sampling: 6 stations, stations 2..3 tied -> 2 regions.
  const src = range(0, 50, 10).map((x) => ({ x, y: 0, z: 0 }));
  const day = src.map((p, i) => (i === 2 || i === 3 ? { ...p } : { ...p, z: 99 }));
  const regions = countPositiveWidthStationRuns(src, day);
  const regionsMs = timed(() => void countPositiveWidthStationRuns(src, day));
  console.log(`countPositiveWidthStationRuns: 6 stations, tied {2,3} -> regions=${regions} (${fmt(regionsMs)} ms)`);
}

// 2. Boundary-cycle validation by mesh size.
console.log('\n== boundary-cycle validation (validateGradingMeshTopology + traceBoundaryCycles) ==');
{
  const rows: string[][] = [];
  for (const n of [16, 64, 256, 1024, 4096]) {
    const points: number[] = [0, 0, 0];
    for (let i = 0; i < n; i += 1) {
      const a = (2 * Math.PI * i) / n;
      points.push(Math.cos(a) * 100, Math.sin(a) * 100, 0);
    }
    const triangles: number[] = [];
    for (let i = 0; i < n; i += 1) triangles.push(0, (i % n) + 1, ((i + 1) % n) + 1);
    const expect = { scope: 'arc' as const, expectedComponents: 1, expectedBoundaryLoops: 1 };
    const probe = validateGradingMeshTopology(points, triangles, expect);
    const st = meshStats(points, triangles);
    const edges: Array<[number, number]> = [];
    for (let i = 0; i < n; i += 1) edges.push([i, (i + 1) % n]);
    const validateMs = timed(() => void validateGradingMeshTopology(points, triangles, expect));
    const traceMs = timed(() => void traceBoundaryCycles(edges));
    rows.push([String(n), String(st.v), String(st.f), String(st.e), String(st.b), String(st.components), `${probe.ok ? 'ok' : probe.code}:${st.components}/${st.cycles}`, fmt(validateMs), fmt(traceMs)]);
  }
  pad(rows, ['boundaryEdges', 'V', 'F', 'E', 'B', 'measured components', 'validate (1/1)', 'validateMs', 'traceMs']);
}

// 3. gtop1 vs gtop2 digest + certificate construction.
console.log('\n== gtop1 vs gtop2 digest + certificate construction ==');
{
  const rows: string[][] = [];
  const meshes: Array<{ label: string; points: number[]; triangles: number[]; tied: number[]; expectation: ReturnType<typeof deriveGradingTopologyExpectation> }> = [
    {
      label: 'square.all-Surface', points: square.result.gradingMesh.points, triangles: square.result.gradingMesh.triangles,
      tied: square.result.topologyCertificate!.tiedSplitCoords,
      expectation: deriveGradingTopologyExpectation({ scope: 'group', closed: true, positiveWidthRegions: 1 }),
    },
    {
      label: 'tied-split.arc', points: tiedResult.gradingMesh.points, triangles: tiedResult.gradingMesh.triangles,
      tied: tiedResult.topologyCertificate!.tiedSplitCoords,
      expectation: deriveGradingTopologyExpectation({ scope: 'standalone', closed: false, positiveWidthRegions: tiedResult.topologyCertificate!.expectedComponents ?? 1, tiedSplitCoords: tiedResult.topologyCertificate!.tiedSplitCoords }),
    },
  ];
  for (const m of meshes) {
    const gtop1TextBytes = m.points.map((v) => v.toPrecision(12)).join(',').length + m.triangles.join(',').length + 1;
    const gtop2Bytes = meshDigestBytes(m.points, m.triangles) + m.tied.length * 8;
    const d1 = digestTopologyMesh(m.points, m.triangles);
    const d2 = digestTopologyMeshExact(m.points, m.triangles)!;
    const h1 = timed(() => void digestTopologyMesh(m.points, m.triangles));
    const h2 = timed(() => void digestTopologyMeshExact(m.points, m.triangles));
    const c1 = buildGradingTopologyCertificate({ scope: m.expectation.scope, points: m.points, triangles: m.triangles });
    const c2 = buildGradingTopologyCertificateExact({ scope: m.expectation.scope, points: m.points, triangles: m.triangles, expectation: m.expectation });
    const c1Ms = timed(() => void buildGradingTopologyCertificate({ scope: m.expectation.scope, points: m.points, triangles: m.triangles }));
    const c2Ms = timed(() => void buildGradingTopologyCertificateExact({ scope: m.expectation.scope, points: m.points, triangles: m.triangles, expectation: m.expectation }));
    rows.push([m.label, `${gtop1TextBytes}/${gtop2Bytes}`, `${fmt(h1)}/${fmt(h2)}`, d1, d2.slice(0, 16), c1 ? c1.version : 'null', c2 ? c2.version : 'null', `${fmt(c1Ms)}/${fmt(c2Ms)}`]);
  }
  pad(rows, ['mesh', 'digest bytes txt/bin', 'hashMs gtop1/gtop2', 'gtop1 FNV digest', 'gtop2 SHA-256', 'gtop1 cert', 'gtop2 cert', 'certMs gtop1/gtop2']);
  const a = stressBase();
  const b = stressShifted();
  const collision = digestTopologyMesh(a.points, a.triangles) === digestTopologyMesh(b.points, b.triangles);
  const exactDiffers = digestTopologyMeshExact(a.points, a.triangles) !== digestTopologyMeshExact(b.points, b.triangles);
  console.log(`stress 1e8 + 1e-4: gtop1 collision=${collision} (same FNV digest), gtop2 diverges=${exactDiffers}`);
}

// 4. gtop2 product revalidation.
console.log('\n== gtop2 product revalidation ==');
{
  const cert = square.result.topologyCertificate!;
  const mesh = square.result.gradingMesh;
  const boundaries = { sourceBoundaryPoints: square.result.sourceBoundaryPoints, gradingBoundaryPoints: square.result.daylightPoints };
  const verify = gradingTopologyCertificateError(cert, 'group', mesh, boundaries);
  const exact = gradingTopologyCertificateExactError(cert, 'group', mesh, boundaries);
  const product = gradingTopologyCertificateProductError(cert, 'group', mesh, boundaries);
  const verifyMs = timed(() => void gradingTopologyCertificateError(cert, 'group', mesh, boundaries));
  const exactMs = timed(() => void gradingTopologyCertificateExactError(cert, 'group', mesh, boundaries));
  const productMs = timed(() => void gradingTopologyCertificateProductError(cert, 'group', mesh, boundaries));
  const tiedCert = tiedResult.topologyCertificate!;
  const tiedBoundaries = { sourceBoundaryPoints: tiedResult.sourceBoundaryPoints, gradingBoundaryPoints: tiedResult.daylightPoints };
  const tiedProduct = gradingTopologyCertificateProductError(tiedCert, 'standalone', tiedResult.gradingMesh, tiedBoundaries);
  const tiedProductMs = timed(() => void gradingTopologyCertificateProductError(tiedCert, 'standalone', tiedResult.gradingMesh, tiedBoundaries));
  const shifted = { points: [...mesh.points], triangles: mesh.triangles };
  shifted.points[0] = shifted.points[0]! + 1e-9;
  const shiftedError = gradingTopologyCertificateExactError(cert, 'group', shifted, boundaries);
  const rows = [
    ['square.all-Surface', cert.version, String(cert.expectedComponents), String(cert.expectedBoundaryCycles), `${fmt(verifyMs)}/${fmt(exactMs)}/${fmt(productMs)}`, `${verify ?? 'ok'} / ${exact ?? 'ok'} / ${product ?? 'ok'}`],
    ['tied-split.arc', tiedCert.version, String(tiedCert.expectedComponents), String(tiedCert.expectedBoundaryCycles), `${fmt(tiedProductMs)}`, tiedProduct ?? 'ok'],
  ];
  pad(rows, ['cert', 'version', 'expected C', 'expected cycles', 'verify/exact/product ms', 'product gate']);
  console.log(`square.shifted(+1e-9): exact revalidation -> ${shiftedError ?? 'ok'}`);
  console.log(`stress.quad gtop2 cert: expected=${stressExpectation.expectedFaceComponents}/${stressExpectation.expectedBoundaryCycles} bytes=${meshDigestBytes(stressBase().points, stressBase().triangles)}`);
  console.log(`stress.quad gtop2 revalidate (base) -> ${gradingTopologyCertificateExactError(stressCert, 'standalone', stressBase()) ?? 'ok'}`);
  console.log(`stress.quad gtop2 revalidate (shifted) -> ${gradingTopologyCertificateExactError(stressCert, 'standalone', stressShifted()) ?? 'ok'}`);
}

// 5. All-Surface square Calculate + Surface source canonicalization.
console.log('\n== all-Surface square (Calculate) + source canonicalization ==');
{
  const r = square.result;
  const inputs = resolveGroupInputs(square.project, square.groupId)!;
  const calcMs = timed(() => void computeGradingGroupFromSnapshots({
    groupId: square.groupId, revision: inputs.revision, members: inputs.memberSources,
    side: inputs.group.side, criterion: inputs.group.criterion, memberCriteria: ALL_FIXED,
    maxSearchDistance: inputs.group.maxSearchDistance, curveChordTolerance: inputs.group.curveChordTolerance,
    closed: true, target: square.target,
  }));
  const st = meshStats(r.gradingMesh.points, r.gradingMesh.triangles);
  const cert = r.topologyCertificate!;
  const rawStations = r.sourceBoundaryPoints!.length / 3;
  const ringOut = resolveDesignPatchRing(inputs.group, square.entity, 0.1, r.sourceBoundaryPoints);
  if (!ringOut.ok) throw new Error(`ring canonicalization failed: ${ringOut.code}`);
  const canonicalStations = ringOut.ring.length / 3;
  const canonMs = timed(() => void resolveDesignPatchRing(inputs.group, square.entity, 0.1, r.sourceBoundaryPoints));
  const micro = (() => {
    const ring = ringOut.ring;
    const n = ring.length / 3;
    let count = 0;
    for (let i = 0; i < n; i += 1) {
      const j = (i + 1) % n;
      const plan = Math.hypot(ring[i * 3]! - ring[j * 3]!, ring[i * 3 + 1]! - ring[j * 3 + 1]!);
      if (plan > 0 && plan < 1e-6) count += 1;
    }
    return count;
  })();
  const rows = [
    ['square', String(st.v), String(st.f), String(st.e), String(st.b), `${cert.expectedComponents}/${st.components}`, `${cert.expectedBoundaryCycles}/${st.cycles}`, String(r.candidateTriangleCount), fmt(calcMs)],
  ];
  pad(rows, ['fixture', 'V', 'F', 'E', 'B', 'C exp/meas', 'cycles exp/meas', 'facets', 'calcMs']);
  console.log(`source canonicalization: raw=${rawStations} stations -> canonical=${canonicalStations} stations, microEdges=${micro} (${fmt(canonMs)} ms)`);
  console.log(`mesh digest bytes=${meshDigestBytes(r.gradingMesh.points, r.gradingMesh.triangles)} digest=${r.topologyCertificate!.meshDigest.slice(0, 16)}`);
}

// 6. Worker agreement (daylight + source boundary).
console.log('\n== worker agreement ==');
{
  const daylight = square.result.daylightPoints;
  const daylightMs = timed(() => void validateDaylightAgainstTarget(daylight, workerQuery), Math.max(1, REPS * 4));
  const daylightErr = validateDaylightAgainstTarget(daylight, workerQuery);
  const tampered = [...daylight];
  tampered[2] = tampered[2]! + 1;
  const tamperedErr = validateDaylightAgainstTarget(tampered, workerQuery);
  const arcDaylight = arcWorld.result.daylightPoints;
  const arcResultErr = validateGradingResultAgainstTarget(arcDaylight, arcWorld.query, arcSourceCheck);
  const arcResultMs = timed(() => void validateGradingResultAgainstTarget(arcDaylight, arcWorld.query, arcSourceCheck), Math.max(1, REPS * 4));
  const rows = [
    ['square.all-Surface.daylight', String(daylight.length / 3), fmt(daylightMs), daylightErr ?? 'ok'],
    ['square.all-Surface.tampered', String(daylight.length / 3), fmt(timed(() => void validateDaylightAgainstTarget(tampered, workerQuery))), tamperedErr ?? 'ok'],
    ['arc.standalone.result', String(arcDaylight.length / 3), fmt(arcResultMs), arcResultErr ?? 'ok'],
  ];
  pad(rows, ['check', 'daylight vertices', 'ms', 'result']);
  // Source-boundary half: real arc endpoints vs the deleted chord×arcLength reconstruction.
  const source = arcSource;
  const realOk = validateGradingSourceBoundary(arcSourceCheck);
  const chord = Math.hypot(source.endX - source.startX, source.endY - source.startY);
  const dirX = (source.endX - source.startX) / chord;
  const dirY = (source.endY - source.startY) / chord;
  const reconstructed = { x: source.startX + dirX * source.length, y: source.startY + dirY * source.length, z: source.endZ };
  const reconstructedErr = validateGradingSourceBoundary({ ...arcSourceCheck, last: reconstructed });
  const boundMs = timed(() => void validateGradingSourceBoundary(arcSourceCheck), Math.max(1, REPS * 4));
  console.log(`source boundary: captured arc endpoints=${realOk ?? 'ok'}, chord×arcLength overshoot=${reconstructedErr ?? 'ok'} (overshoot=${(source.length - chord).toFixed(6)} m, ${fmt(boundMs)} ms)`);
}

// 7. Tied split (real Surface arc, 2/2 gtop2).
console.log('\n== tied split (real Surface arc) ==');
{
  const r = tiedResult;
  const st = meshStats(r.gradingMesh.points, r.gradingMesh.triangles);
  const inputs = { source: tiedArcSource };
  const calcMs = timed(() => void computeGradingFromSnapshots({
    gradingId: 'perf', revision: 'perf', source: inputs.source, side: 'right',
    criterion: FIXED05, maxSearchDistance: 200, curveChordTolerance: 0.5, target: tiedPlaneTarget(),
  }));
  const cert = r.topologyCertificate!;
  const rows = [
    ['standalone.surface.arc.tied', String(st.v), String(st.f), String(st.e), String(st.b), `${cert.expectedComponents}/${st.components}`, `${cert.expectedBoundaryCycles}/${st.cycles}`, String(r.candidateTriangleCount), fmt(calcMs)],
  ];
  pad(rows, ['fixture', 'V', 'F', 'E', 'B', 'C exp/meas', 'cycles exp/meas', 'facets', 'calcMs']);
  console.log(`digest bytes=${meshDigestBytes(r.gradingMesh.points, r.gradingMesh.triangles)} digest=${cert.meshDigest.slice(0, 16)} cycleSizes=${JSON.stringify(cert.cycleSizes)}`);
}

// 8. Local / projected / stress coordinate agreement.
console.log('\n== agreement bound by coordinate magnitude ==');
{
  const N = 2000;
  const cases: Array<{ label: string; e: number; n: number; plane: AnchoredPlane }> = [
    { label: 'local (0,0)', e: 0, n: 0, plane: { gx: 0, gy: 0, ax: 0, ay: 0 } },
    { label: 'projected (5e6,5e6)', e: 5000000, n: 5000000, plane: { gx: 0.2, gy: 0.1, ax: 5000000, ay: 5000000 } },
    { label: 'stress (1e8,1e8)', e: 100000000, n: 100000000, plane: { gx: 0.2, gy: 0.1, ax: 100000000, ay: 100000000 } },
  ];
  const rows: string[][] = [];
  for (const c of cases) {
    const q = planeQuery(0, c.plane);
    const pts: number[] = [];
    for (let i = 0; i < N; i += 1) pts.push(c.e + i, c.n + i, 0);
    const bound = anchoredElevationAgreementTol(0, 0, planeLeverage(c.plane, c.e, c.n), Math.abs(c.plane.gx) + Math.abs(c.plane.gy), c.e, c.n);
    const ms = timed(() => void validateDaylightAgainstTarget(pts, q), Math.max(1, REPS));
    // Just above the local floor: justified by leverage at projected/stress.
    const aboveFloor = validateDaylightAgainstTarget([c.e, c.n, 1e-8], q);
    const mm = validateDaylightAgainstTarget([c.e, c.n, 1e-3], q);
    rows.push([c.label, bound.toExponential(3), aboveFloor ?? 'ok', mm ?? 'ok', String(N), fmt(ms)]);
  }
  pad(rows, ['coords', 'agreement bound', 'dz 1e-8', 'dz 1e-3', 'points', 'ms']);
  console.log(`local leverageless bound = elevationAgreementTol(0,0,[]) + AGREEMENT_FLOOR = ${(elevationAgreementTol(0, 0, []) + AGREEMENT_FLOOR).toExponential(3)}`);
}

// 9. Design Patch.
console.log('\n== Design Patch (resolveDesignPatch) ==');
{
  const dp = resolveDesignPatch(square.project, square.groupId, square.result, square.revision, true);
  const ms = timed(() => void resolveDesignPatch(square.project, square.groupId, square.result, square.revision, true));
  const rows = dp.ok
    ? [['all-Surface.rounded-square', String(dp.value.points.length / 3), String(dp.value.triangles.length / 3), fmt(ms), 'ok']]
    : [['all-Surface.rounded-square', '—', '—', fmt(ms), `${dp.code}${dp.detail ? `:${dp.detail}` : ''}`]];
  pad(rows, ['fixture', 'V', 'F', 'ms', 'result']);
}

const mem = process.memoryUsage();
console.log(`\nheap: heapUsed=${(mem.heapUsed / 1024 / 1024).toFixed(1)} MB rss=${(mem.rss / 1024 / 1024).toFixed(1)} MB`);
console.log('dominant stage: the whole-call Calculate solve (seam/merge/canonicalization/certificate internal to it); gtop2 digest + certificate are the bounded post-assembly stages, and agreement is one linear pass over the daylight polyline.');
