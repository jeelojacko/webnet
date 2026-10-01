/**
 * Phase 20K.2 topology + product performance (measurement only, no thresholds).
 *
 * Every fixture is built ONCE outside every timed region. Each stage times the
 * ACTUAL production entry point:
 *   boundary cycles      -> `traceBoundaryCycles` (graph level, by boundary size)
 *   certificate build    -> internal to group/standalone compute
 *   certificate verify   -> `gradingTopologyCertificateError` / `...ProductError`
 *   tied-split validate  -> real Surface arc tied split via `computeGradingFromSnapshots`
 *   rounded squares      -> real closed group `computeGradingGroupFromSnapshots`
 *   curved Design Patch  -> `resolveDesignPatch` on the product group result
 *   coplanar Cut/Fill    -> `directFanOnTarget` + the tilted-cross integration solve
 *   non-planar fail path -> `directFanOnTarget` on a ridge (fails closed)
 *
 * Reported per stage: V/F/E/B (mesh vertices/faces/edges/boundary edges),
 * boundary cycles, edge components, facets crossed, median ms, digest.
 * Nothing is asserted; a failed production call is recorded verbatim.
 *
 * Usage: npx tsx scripts/phase20k2TopologyProductPerf.ts [--quick]
 */
import { computeGradingGroupFromSnapshots } from '../src/engine/cad/grading/gradingGroupCompute';
import { computeGradingFromSnapshots } from '../src/workers/surfaceGradingCompute';
import { linearizeGradingArc } from '../src/engine/cad/grading/gradingCurve';
import { validateGradingMeshTopology, traceBoundaryCycles } from '../src/engine/cad/grading/gradingTopology';
import {
  buildGradingTopologyCertificate,
  digestTopologyMesh,
  gradingTopologyCertificateError,
  gradingTopologyCertificateProductError,
} from '../src/engine/cad/grading/gradingTopologyCertificate';
import { directFanOnTarget, digestSeamMesh } from '../src/engine/cad/grading/gradingChordSeam';
import { buildTargetQuery } from '../src/engine/cad/grading/gradingTargetIndex';
import { resolveDesignPatch } from '../src/engine/cad/cadTransactionsDesignPatchCommands';
import { resolveGroupInputs } from '../src/engine/cad/grading/gradingGroupResolve';
import { createBlankCadDrawingDocument } from '../src/engine/cad/cadDrawingFile';
import { createCadHistoryState, runCadCommand } from '../src/engine/cad/cadUndoRedo';
import { parcelBulgeFromArcDefinition } from '../src/engine/cad/cadParcelArcGeometry';
import {
  DIST, ELEV, FIXED, REL, roundedSquareMembers,
} from './phase20kHybridArcPairGroups';
import type { CadFeatureLineEntity, CadProject, CadSurface } from '../src/engine/cad/cadTypes';
import type { GradingTargetMeshSnapshot, TargetQuery } from '../src/engine/cad/grading/gradingComputeTypes';
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
  components: number; cycles: number; violations: string[];
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
  return {
    v: points.length / 3, f: triangles.length / 3, e: incidence.size, b: boundary.length,
    components: topo.components, cycles: trace.cycles.length, violations: trace.violations,
  };
};

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

// ---------------------------------------------------------------------------
// Fixtures (all built once, before any timed region).
// ---------------------------------------------------------------------------

const SQUARE: ReadonlyArray<readonly [number, number]> = [[0, 0], [100, 0], [100, 100], [0, 100]];
const ALL_DIST: GradingCriterion[] = [DIST(-0.5, 20), DIST(-0.5, 20), DIST(-0.5, 20), DIST(-0.5, 20)];
const ALL_FIXED: GradingCriterion[] = [FIXED(-0.5), FIXED(-0.5), FIXED(-0.5), FIXED(-0.5)];
const MIXED: GradingCriterion[] = [DIST(-0.5, 20), ELEV(-0.5, 0), DIST(-0.5, 20), REL(-0.5, -10)];

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
  groupId: string;
  revision: string;
  result?: { gradingMesh: { points: number[]; triangles: number[] }; gradingPlanArea: number; candidateTriangleCount: number; corners: unknown[] };
  error?: string;
  target: GradingTargetMeshSnapshot;
  criteria: GradingCriterion[];
}

/** Real closed rounded-square feature-line group; Surface criterion carries the target. */
const buildSquare = (criterion: GradingCriterion, memberCriteria: GradingCriterion[]): ProductSquare => {
  const drawing = createBlankCadDrawingDocument({ name: '20K.2 perf', units: 'm' });
  const entity: CadFeatureLineEntity = {
    id: 'fl', type: 'feature-line', layerId: 'general', visible: true, locked: false,
    name: 'Rounded square', closed: true,
    vertices: SQUARE.map(([x, y], k) => ({ id: `v${k}`, x, y, z: Z })),
    segmentGeometry: arcGeometry(),
  };
  const tin = [-600, -600, 0, 1000, -600, 0, 1000, 1000, 0, -600, 1000, 0];
  const target: CadSurface = {
    id: 'tgt', name: 'EG', layerId: 'general',
    definition: {
      sourceKind: 'explicit-tin', pointSource: { kind: 'points', pointEntityIds: [] },
      importedTin: {
        vertices: tin, faces: [0, 1, 2, 0, 2, 3],
        provenance: { kind: 'webnet-bake', sourceSurfaceId: 'seed', sourceSurfaceName: 'seed', sourceRevision: 'srev1:seed' },
      },
    },
    cachedRevision: null,
  };
  const project: CadProject = { ...drawing.project, entities: [entity], surfaces: [target] };
  const ids = entity.vertices.map((v) => v.id);
  const history = runCadCommand(createCadHistoryState(project), {
    key: 'GROUP_CREATE', name: 'RG', sourceFeatureLineId: 'fl',
    sourceCourses: ids.map((id, i) => ({ vertexAId: id, vertexBId: ids[(i + 1) % 4]! })),
    targetSurfaceId: 'tgt', side: 'right', criterion, maxSearchDistance: SEARCH,
    curveChordTolerance: 0.1, closed: true,
  });
  const withGroup = history.present.project;
  const groupId = withGroup.gradingGroups![0]!.id;
  const inputs = resolveGroupInputs(withGroup, groupId)!;
  const surface = criterion.kind === 'fixed' || criterion.kind === 'cut-fill';
  const targetSnap: GradingTargetMeshSnapshot = { points: tin, triangles: [0, 1, 2, 0, 2, 3] };
  const out = computeGradingGroupFromSnapshots({
    groupId, revision: inputs.revision, members: inputs.memberSources,
    side: inputs.group.side, criterion: inputs.group.criterion, memberCriteria,
    maxSearchDistance: inputs.group.maxSearchDistance,
    curveChordTolerance: inputs.group.curveChordTolerance, closed: true,
    ...(surface ? { target: targetSnap } : {}),
  });
  return {
    project: withGroup, groupId, revision: inputs.revision, target: targetSnap, criteria: memberCriteria,
    ...(out.ok
      ? { result: out.result as unknown as ProductSquare['result'] }
      : { error: `${out.code}${out.detail ? `:${out.detail}` : ''}` }),
  };
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
  criterion: FIXED(-0.5), maxSearchDistance: 200, curveChordTolerance: 0.5, target: tiedPlaneTarget(),
});

const squareDist = buildSquare(DIST(-0.5, 20), ALL_DIST);
const squareSurface = buildSquare(FIXED(-0.5), ALL_FIXED);
const squareMixed = buildSquare(DIST(-0.5, 20), MIXED);
const tiedSplit = buildTiedSplit();

const CUT_FILL: GradingCriterion = { kind: 'cut-fill', cutGradeRatio: 0.5, fillGradeRatio: -2 };
const crossTarget = gridTin((x) => 10 + 0.1 * (x - 50), range(-100, 200, 10), range(-60, 60, 10));
const fanQuery: TargetQuery = buildTargetQuery(gridTin(() => 0, range(-50, 50, 10), range(-50, 50, 10)))!;
const ridgeQuery: TargetQuery = buildTargetQuery(gridTin(
  (x) => (x > 2 && x < 8 ? 5 * (1 - Math.abs((x - 5) / 3)) : 0), range(-20, 20, 1), range(-20, 20, 4),
))!;
const V = { x: 0, y: 0, z: 0 };
const Q_IN = { x: 10, y: 0, z: 0 };
const Q_OUT = { x: 0, y: -10, z: 0 };

// ---------------------------------------------------------------------------
// Output helpers.
// ---------------------------------------------------------------------------

const pad = (rows: string[][], header: string[]): void => {
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)));
  const line = (cs: string[]): string => cs.map((c, i) => (c ?? '').padEnd(widths[i]!)).join('  ');
  console.log(line(header));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const r of rows) console.log(line(r));
};

console.log(`phase20k2 topology/product perf (${QUICK ? 'quick 1 rep' : `${REPS} reps, median`}) — times in ms`);
console.log(`fixtures built outside timed regions; production entry points only\n`);

// 1. Boundary-cycle analysis by boundary size (graph level).
console.log('== boundary-cycle analysis by boundary size (traceBoundaryCycles) ==');
{
  const rows: string[][] = [];
  for (const n of [16, 64, 256, 1024, 4096, 16384]) {
    const edges: Array<[number, number]> = [];
    for (let i = 0; i < n; i += 1) edges.push([i, (i + 1) % n]);
    const ms = timed(() => void traceBoundaryCycles(edges));
    const t = traceBoundaryCycles(edges);
    rows.push([String(n), String(n), String(t.components), String(t.cycles.length), String(t.violations.length), fmt(ms)]);
  }
  pad(rows, ['boundaryEdges', 'E', 'components', 'cycles', 'violations', 'ms']);
}

// 2. Certificate build / verify on the real product meshes.
console.log('\n== certificate build / verify (gtop1) ==');
{
  const rows: string[][] = [];
  for (const [label, sq, scope] of [
    ['square.all-Distance', squareDist, 'group'],
    ['square.all-Surface', squareSurface, 'group'],
    ['square.mixed-analytic', squareMixed, 'group'],
  ] as const) {
    if (!sq.result) { rows.push([label, '—', '—', '—', '—', '—', '—', sq.error ?? 'no result']); continue; }
    const mesh = sq.result.gradingMesh;
    const st = meshStats(mesh.points, mesh.triangles);
    const buildMs = timed(() => void buildGradingTopologyCertificate({ scope, points: mesh.points, triangles: mesh.triangles }));
    const cert = buildGradingTopologyCertificate({ scope, points: mesh.points, triangles: mesh.triangles });
    const verifyMs = cert ? timed(() => void gradingTopologyCertificateError(cert, scope, mesh)) : NaN;
    const productMs = cert ? timed(() => void gradingTopologyCertificateProductError(cert, scope, mesh)) : NaN;
    rows.push([
      label, String(st.v), String(st.f), String(st.e), String(st.b), String(st.components), String(st.cycles),
      `${fmt(buildMs)}/${fmt(verifyMs)}/${fmt(productMs)}  cert=${cert ? 'ok' : 'null'} digest=${digestTopologyMesh(mesh.points, mesh.triangles)}`,
    ]);
  }
  if (tiedSplit.ok && tiedSplit.result.topologyCertificate) {
    const mesh = tiedSplit.result.gradingMesh;
    const st = meshStats(mesh.points, mesh.triangles);
    const cert = tiedSplit.result.topologyCertificate;
    const verifyMs = timed(() => void gradingTopologyCertificateError(cert, 'standalone', mesh));
    const productMs = timed(() => void gradingTopologyCertificateProductError(cert, 'standalone', mesh));
    rows.push([
      'tied-split.arc', String(st.v), String(st.f), String(st.e), String(st.b), String(st.components), String(st.cycles),
      `—/${fmt(verifyMs)}/${fmt(productMs)}  cert=${cert.version} product=${gradingTopologyCertificateProductError(cert, 'standalone', mesh)}`,
    ]);
  }
  pad(rows, ['mesh', 'V', 'F', 'E', 'B', 'components', 'cycles', 'build/verify/product ms + digest']);
}

// 3. Tied-split validation (real Surface arc tied split).
console.log('\n== tied-split validation (real Surface arc tied split) ==');
{
  const rows: string[][] = [];
  if (tiedSplit.ok) {
    const r = tiedSplit.result;
    const st = meshStats(r.gradingMesh.points, r.gradingMesh.triangles);
    const computeMs = timed(() => void buildTiedSplit());
    const cert = r.topologyCertificate;
    const verifyErr = cert ? gradingTopologyCertificateError(cert, 'standalone', r.gradingMesh) : 'no-cert';
    const productErr = cert ? gradingTopologyCertificateProductError(cert, 'standalone', r.gradingMesh) : 'no-cert';
    rows.push([
      'standalone.surface.arc.tied', String(st.v), String(st.f), String(st.e), String(st.b),
      String(st.components), String(st.cycles), String(r.candidateTriangleCount), fmt(computeMs),
      `verify=${verifyErr ?? 'ok'} product=${productErr ?? 'ok'} digest=${digestTopologyMesh(r.gradingMesh.points, r.gradingMesh.triangles)}`,
    ]);
  } else {
    rows.push(['standalone.surface.arc.tied', '—', '—', '—', '—', '—', '—', '—', '—', `fail:${tiedSplit.code}`]);
  }
  pad(rows, ['fixture', 'V', 'F', 'E', 'B', 'components', 'cycles', 'facets', 'ms', 'gate/digest']);
}

// 4. Rounded squares — real closed group compute.
console.log('\n== rounded squares (closed group compute) ==');
{
  const rows: string[][] = [];
  for (const [label, sq] of [
    ['all-Distance', squareDist], ['all-Surface', squareSurface], ['mixed-analytic', squareMixed],
  ] as const) {
    if (!sq.result) { rows.push([label, '—', '—', '—', '—', '—', '—', '—', '—', sq.error ?? 'no result']); continue; }
    const mesh = sq.result.gradingMesh;
    const st = meshStats(mesh.points, mesh.triangles);
    const inputs = resolveGroupInputs(sq.project, sq.groupId)!;
    const surface = sq.criteria === ALL_FIXED;
    const ms = timed(() => void computeGradingGroupFromSnapshots({
      groupId: sq.groupId, revision: inputs.revision, members: inputs.memberSources,
      side: inputs.group.side, criterion: inputs.group.criterion, memberCriteria: sq.criteria,
      maxSearchDistance: inputs.group.maxSearchDistance, curveChordTolerance: inputs.group.curveChordTolerance,
      closed: true, ...(surface ? { target: sq.target } : {}),
    }));
    rows.push([
      label, String(st.v), String(st.f), String(st.e), String(st.b), String(st.components), String(st.cycles),
      String(sq.result.candidateTriangleCount), fmt(ms), digestSeamMesh(mesh.points, mesh.triangles),
    ]);
  }
  pad(rows, ['fixture', 'V', 'F', 'E', 'B', 'components', 'cycles', 'facets', 'ms', 'digest']);
}

// 5. Curved Design Patch (production resolveDesignPatch on the group result).
console.log('\n== curved Design Patch (resolveDesignPatch) ==');
{
  const rows: string[][] = [];
  for (const [label, sq] of [['all-Distance', squareDist], ['all-Surface', squareSurface]] as const) {
    if (!sq.result) { rows.push([label, '—', '—', '—', '—', '—', '—', '—', sq.error ?? 'no result']); continue; }
    const ms = timed(() => void resolveDesignPatch(sq.project, sq.groupId, sq.result as never, sq.revision, true));
    const outcome = resolveDesignPatch(sq.project, sq.groupId, sq.result as never, sq.revision, true);
    rows.push([
      label, String(meshStats(sq.result.gradingMesh.points, sq.result.gradingMesh.triangles).v),
      String(sq.result.gradingMesh.triangles.length / 3), '—', '—', '—', '—', fmt(ms),
      outcome.ok ? 'ok' : `${outcome.code}${outcome.detail ? `:${outcome.detail}` : ''}`,
    ]);
  }
  pad(rows, ['fixture', 'V', 'F', 'E', 'B', 'components', 'cycles', 'ms', 'result']);
}

// 6. Coplanar Cut/Fill walk — direct fan + the tilted-cross integration.
console.log('\n== coplanar Cut/Fill walk ==');
{
  const rows: string[][] = [];
  const fanMs = timed(() => void directFanOnTarget(CUT_FILL, fanQuery, V, Q_IN, Q_OUT));
  const accepted = directFanOnTarget(CUT_FILL, fanQuery, V, Q_IN, Q_OUT);
  rows.push(['directFan.coplanar', '—', '—', '—', '—', '—', '—', '—', fmt(fanMs), accepted ? 'accepted' : 'rejected']);
  const out = computeGradingFromSnapshots({
    gradingId: 'perf', revision: 'perf', source: tiedArcSource, side: 'right',
    criterion: CUT_FILL, maxSearchDistance: SEARCH, curveChordTolerance: 0.1, target: crossTarget,
  });
  if (out.ok) {
    const r = out.result;
    const st = meshStats(r.gradingMesh.points, r.gradingMesh.triangles);
    const ms = timed(() => void computeGradingFromSnapshots({
      gradingId: 'perf', revision: 'perf', source: tiedArcSource, side: 'right',
      criterion: CUT_FILL, maxSearchDistance: SEARCH, curveChordTolerance: 0.1, target: crossTarget,
    }));
    rows.push([
      'curved.cutfill.cross', String(st.v), String(st.f), String(st.e), String(st.b),
      String(st.components), String(st.cycles), String(r.candidateTriangleCount), fmt(ms),
      `kinds=${[...new Set(r.regions.map((x) => x.classification))].join('+')}`,
    ]);
  } else {
    rows.push(['curved.cutfill.cross', '—', '—', '—', '—', '—', '—', '—', '—', `fail:${out.code}`]);
  }
  pad(rows, ['fixture', 'V', 'F', 'E', 'B', 'components', 'cycles', 'facets', 'ms', 'result']);
}

// 7. Non-planar fail path — the bridge crosses a ridge, must reject.
console.log('\n== non-planar fail path ==');
{
  const ms = timed(() => void directFanOnTarget(CUT_FILL, ridgeQuery, V, Q_IN, Q_OUT));
  const accepted = directFanOnTarget(CUT_FILL, ridgeQuery, V, Q_IN, Q_OUT);
  pad([['directFan.ridge', fmt(ms), accepted ? 'accepted' : 'rejected (fail-closed)']], ['fixture', 'ms', 'result']);
}

const mem = process.memoryUsage();
console.log(`\nheap: heapUsed=${(mem.heapUsed / 1024 / 1024).toFixed(1)} MB rss=${(mem.rss / 1024 / 1024).toFixed(1)} MB`);
console.log(`dominant stage: ${QUICK ? 'n/a (quick)' : 'whole-call production compute (seam/merge/certificate internal, not separately instrumented); certificate build and verify are the bounded post-assembly stages.'}`);
