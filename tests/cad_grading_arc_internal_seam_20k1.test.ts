/**
 * Phase 20K.1 Wave A2 — production curved-seam RED reproduction matrix.
 * EVIDENCE/RECORDING ONLY: no `src/` changes, no engine fix, no gate.
 *
 * Every fixture calls the ACTUAL production engine:
 *   - standalone courses -> `computeGradingFromSnapshots`
 *   - groups             -> `computeGradingGroupFromSnapshots`
 * and records the exact topology the shipped engine produces today:
 * engine ok/fail + status, points, triangles, corner ties, plan/3D area, the
 * exact `validateGroupMesh` result, INDEX edge components (shared-index
 * topology), the geometric-coincidence diagnostic (`geometricDiagnostic`,
 * Wave A1), boundary-edge count, boundary loops, duplicate/coincident seam
 * vertices, Bake acceptance, and Design Patch acceptance.
 *
 * The assertions FREEZE the recorded actuals. Wave B2 wired the fail-closed
 * seam gate, so E/F/G failed closed (GROUP_NON_MANIFOLD + PINCH detail).
 * Wave C2 (Surface internal chord-seam assembly) cured D/G/H: D reaches
 * CURRENT with the analytic-matching plan (2082.837637462 -> 2082.880954009,
 * overlap double-cover removed, fan added — the same new value C1 recorded
 * for A/B/C); G reaches CURRENT (43pts/41tris, exact GAP tie); H reaches
 * CURRENT (156pts/156tris, plan == analytic square 9452.124826335).
 * Old→new is recorded per row below; no mass snapshot updates.
 *
 * Production success is judged on INDEX topology; the geometric/weld
 * diagnostic is reported SEPARATELY and never used to claim success.
 */
import { describe, expect, it } from 'vitest';

import { canonicalizeBakedTin } from '../src/engine/cad/cadExplicitBake';
import { validateExplicitTinPayload } from '../src/engine/cad/cadImportedTin';
import { mergePadWithGrading, resolveDesignPatchInterior } from '../src/engine/cad/grading/designPatchBuild';
import { validateSourceRing, verifyRingAgainstMesh } from '../src/engine/cad/grading/designPatchRing';
import { computeGradingGroupFromSnapshots } from '../src/engine/cad/grading/gradingGroupCompute';
import { validateGroupMesh } from '../src/engine/cad/grading/gradingGroupMerge';
import type { GradingTargetMeshSnapshot } from '../src/engine/cad/grading/gradingComputeTypes';
import type { GradingCriterion, ResolvedGradingSource } from '../src/engine/cad/grading/gradingTypes';
import { computeGradingFromSnapshots } from '../src/workers/surfaceGradingCompute';
import { auditMesh, geometricDiagnostic } from '../scripts/phase20kHybridArcPairAudit';
import {
  DIST,
  ELEV,
  FIXED,
  REL,
  flatTin,
  roundedSquareMembers,
} from '../scripts/phase20kHybridArcPairGroups';

const TOL = 0.1;
const SEARCH = 100;

// ---------------------------------------------------------------------------
// Normalized production result
// ---------------------------------------------------------------------------

interface RawResult {
  ok: boolean;
  code?: string;
  detail?: string;
  points: number[];
  triangles: number[];
  /** Flat XYZ daylight ring/polyline. */
  daylight: number[];
  ties: number[][];
  planArea: number;
  area3d: number;
  diagnostics: string[];
  /** Closed-group source discretization (Design Patch authority). */
  sourceBoundary?: number[];
}

interface FixtureCase {
  id: string;
  label: string;
  kind: 'standalone' | 'group';
  criteria: string;
  closed: boolean;
  run: () => RawResult;
}

const straight = (
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
): ResolvedGradingSource => ({
  startX: ax, startY: ay, endX: bx, endY: by, startZ: az, endZ: bz,
  length: Math.hypot(bx - ax, by - ay), reoriented: false, isArc: false,
});

const arcSource = (index: number): ResolvedGradingSource => roundedSquareMembers(10)[index]!.source;

const STANDALONE_CRITERIA: Array<[string, GradingCriterion, boolean]> = [
  ['A distance', DIST(-0.5, 20), false],
  ['B elevation', ELEV(-0.5, 0), false],
  ['C relative', REL(-0.5, -10), false],
  ['D surface fixed', FIXED(-0.5), true],
];

const standaloneFixture = (
  id: string,
  label: string,
  source: ResolvedGradingSource,
  criterion: GradingCriterion,
  needsTarget: boolean,
): FixtureCase => ({
  id, label, kind: 'standalone', criteria: JSON.stringify(criterion), closed: false,
  run: () => {
    const out = computeGradingFromSnapshots({
      gradingId: id, revision: 'r', source, side: 'right',
      criterion, maxSearchDistance: SEARCH, curveChordTolerance: TOL,
      ...(needsTarget ? { target: flatTin(0) } : {}),
    });
    if (!out.ok) return { ok: false, code: out.code, detail: out.detail, points: [], triangles: [], daylight: [], ties: [], planArea: 0, area3d: 0, diagnostics: [] };
    const r = out.result;
    return {
      ok: true, points: r.gradingMesh.points, triangles: r.gradingMesh.triangles,
      daylight: r.daylightPoints, ties: [], planArea: r.gradingPlanArea, area3d: r.grading3dArea,
      diagnostics: r.diagnostics.map((d) => d.code),
    };
  },
});

const groupFixture = (
  id: string, label: string, members: ResolvedGradingSource[],
  criteria: GradingCriterion[], closed: boolean, target?: GradingTargetMeshSnapshot,
): FixtureCase => ({
  id, label, kind: 'group', criteria: criteria.map((c) => JSON.stringify(c)).join(' , '), closed,
  run: () => {
    const out = computeGradingGroupFromSnapshots({
      groupId: id, revision: 'r', members, side: 'right', criterion: criteria[0]!,
      memberCriteria: criteria, maxSearchDistance: SEARCH, curveChordTolerance: TOL,
      closed, ...(target ? { target } : {}),
    });
    if (!out.ok) return { ok: false, code: out.code, detail: out.detail, points: [], triangles: [], daylight: [], ties: [], planArea: 0, area3d: 0, diagnostics: [] };
    const r = out.result;
    return {
      ok: true, points: r.gradingMesh.points, triangles: r.gradingMesh.triangles,
      daylight: r.daylightPoints, ties: r.corners.map((c) => c.tiePointXyz as number[]),
      planArea: r.gradingPlanArea, area3d: r.grading3dArea,
      diagnostics: r.diagnostics.map((d) => d.code),
      sourceBoundary: r.sourceBoundaryPoints,
    };
  },
});

const buildFixtures = (): FixtureCase[] => {
  const square = roundedSquareMembers(10);
  const cases: FixtureCase[] = STANDALONE_CRITERIA.map(([label, criterion, needsTarget]) =>
    standaloneFixture(`standalone.${label}`, label, arcSource(0), criterion, needsTarget));
  // E — closed all-Distance rounded square (4 genuine arcs).
  cases.push(groupFixture('closed.square.all-distance', 'E closed all-Distance',
    square.map((m) => m.source), [DIST(-0.5, 20), DIST(-0.5, 20), DIST(-0.5, 20), DIST(-0.5, 20)], true));
  // F — mixed-analytic arc group (D/E/REL equivalents, one analytic domain).
  cases.push(groupFixture('closed.square.mixed-analytic', 'F mixed-analytic',
    square.map((m) => m.source), [DIST(-0.5, 20), ELEV(-0.5, 0), REL(-0.5, -10), DIST(-0.5, 20)], true));
  // G — one-arc hybrid: curved Surface + adjacent straight analytic.
  cases.push(groupFixture('open.hybrid.one-arc', 'G one-arc hybrid',
    [arcSource(0), straight(100, 0, 10, 100, 100, 10)],
    [FIXED(-0.5), DIST(-0.5, 20)], false, flatTin(0)));
  // H — Surface-only curved group (S↔S corners on arcs).
  cases.push(groupFixture('closed.square.all-surface', 'H surface-only curved',
    square.map((m) => m.source), [FIXED(-0.5), FIXED(-0.5), FIXED(-0.5), FIXED(-0.5)], true, flatTin(0)));
  // I — straight controls (must stay clean).
  cases.push(standaloneFixture('standalone.straight.fixed', 'I1 straight standalone', straight(0, 0, 10, 100, 0, 10), FIXED(-0.5), true));
  cases.push(groupFixture('closed.square.straight', 'I2 straight square', [
    straight(0, 0, 10, 100, 0, 10), straight(100, 0, 10, 100, 100, 10),
    straight(100, 100, 10, 0, 100, 10), straight(0, 100, 10, 0, 0, 10),
  ], [FIXED(-0.5), FIXED(-0.5), FIXED(-0.5), FIXED(-0.5)], true, flatTin(0)));
  return cases;
};

// ---------------------------------------------------------------------------
// Topology metrics (pure; production helpers only)
// ---------------------------------------------------------------------------

/** Boundary-loop count over the index boundary edges (manifold: cycles/paths). */
const boundaryLoopsOf = (triangles: number[]): number => {
  const edgeCount = new Map<string, number>();
  for (let f = 0; f + 2 < triangles.length; f += 3) {
    const tri = [triangles[f]!, triangles[f + 1]!, triangles[f + 2]!];
    for (let e = 0; e < 3; e += 1) {
      const a = tri[e]!;
      const b = tri[(e + 1) % 3]!;
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      edgeCount.set(key, (edgeCount.get(key) ?? 0) + 1);
    }
  }
  const adj = new Map<number, number[]>();
  for (const [key, count] of edgeCount) {
    if (count !== 1) continue;
    const [a, b] = key.split('|').map(Number) as [number, number];
    (adj.get(a) ?? adj.set(a, []).get(a)!).push(b);
    (adj.get(b) ?? adj.set(b, []).get(b)!).push(a);
  }
  let loops = 0;
  const seen = new Set<number>();
  for (const start of adj.keys()) {
    if (seen.has(start)) continue;
    loops += 1;
    const stack = [start];
    while (stack.length > 0) {
      const v = stack.pop()!;
      if (seen.has(v)) continue;
      seen.add(v);
      for (const n of adj.get(v) ?? []) if (!seen.has(n)) stack.push(n);
    }
  }
  return loops;
};

// ---------------------------------------------------------------------------
// §8 classification + product-stage eligibility
// ---------------------------------------------------------------------------

type Classification =
  | 'TOPOLOGY_VALID' | 'INDEX_SEAM_CRACK' | 'GEOMETRIC_SEAM_GAP' | 'VERTEX_PINCH'
  | 'DUPLICATE_COINCIDENT_EDGE' | 'INTERIOR_OVERLAP' | 'SELF_INTERSECTION'
  | 'EXPECTED_TIED_SPLIT' | 'EXISTING_FAIL_CLOSED';

interface AuditLike {
  vertexComponents: number;
  edgeComponents: number;
  boundaryEdges: number;
  daylightSimple: boolean;
  overlap: boolean;
}

interface DiagLike {
  coincidentVertexSets: number;
  exactDuplicateVertexSets: number;
  coincidentNonSharedEdges: number;
  weldedEdgeComponents: number;
  weldedDegenerateTriangles: number;
}

interface Row {
  id: string;
  label: string;
  kind: 'standalone' | 'group';
  criteria: string;
  closed: boolean;
  engineOk: boolean;
  status: string;
  points: number;
  triangles: number;
  tieCount: number;
  planArea: number;
  area3d: number;
  validator: string | null;
  index: AuditLike & { boundaryLoops: number };
  diag: DiagLike;
  diagnostics: string[];
  classification: Classification;
  flags: Classification[];
  canCurrent: boolean;
  canExtract: boolean;
  canBake: boolean;
  canDesignPatch: boolean;
  designPatchDetail: string | null;
}

const round = (v: number, d = 9): number => Number(v.toFixed(d));

const classify = (
  engineOk: boolean,
  tied: boolean,
  index: AuditLike,
  diag: DiagLike,
  validator: string | null,
): { classification: Classification; flags: Classification[] } => {
  const flags: Classification[] = [];
  if (!engineOk) return { classification: 'EXISTING_FAIL_CLOSED', flags };
  if (index.overlap) flags.push('INTERIOR_OVERLAP');
  if (!index.daylightSimple) flags.push('SELF_INTERSECTION');
  if (diag.coincidentNonSharedEdges > 0) flags.push('DUPLICATE_COINCIDENT_EDGE');
  if (tied) return { classification: 'EXPECTED_TIED_SPLIT', flags };
  if (!index.daylightSimple) return { classification: 'SELF_INTERSECTION', flags };
  if (index.overlap) return { classification: 'INTERIOR_OVERLAP', flags };
  if (index.edgeComponents <= 1 && validator === null) return { classification: 'TOPOLOGY_VALID', flags };
  if (diag.weldedEdgeComponents <= 1) return { classification: 'INDEX_SEAM_CRACK', flags };
  if (index.vertexComponents <= 1) return { classification: 'VERTEX_PINCH', flags };
  if (diag.coincidentNonSharedEdges > 0) return { classification: 'DUPLICATE_COINCIDENT_EDGE', flags };
  return { classification: 'GEOMETRIC_SEAM_GAP', flags };
};

/** Production Design Patch gates over the captured source boundary capture. */
const designPatchGate = (raw: RawResult, closed: boolean): { ok: boolean; detail: string | null } => {
  if (!closed) return { ok: false, detail: 'not-closed' };
  if (!raw.ok) return { ok: false, detail: 'engine-failed' };
  if (!raw.sourceBoundary) return { ok: false, detail: 'no-source-boundary-capture' };
  const mesh = { points: raw.points, triangles: raw.triangles };
  const ring = [...raw.sourceBoundary];
  if (ring.length >= 6 && ring[0] === ring[ring.length - 3] && ring[1] === ring[ring.length - 2] && ring[2] === ring[ring.length - 1]) {
    ring.length -= 3;
  }
  const valid = validateSourceRing(ring);
  if (!valid.ok) return { ok: false, detail: `${valid.code}:${valid.detail ?? ''}` };
  const interior = resolveDesignPatchInterior(ring);
  if (!interior.ok) return { ok: false, detail: `${interior.code}:${interior.detail ?? ''}` };
  const verify = verifyRingAgainstMesh(ring, mesh);
  if (!verify.ok) return { ok: false, detail: `${verify.code}:${verify.detail ?? ''}` };
  const merge = mergePadWithGrading(interior.pad.padPoints, interior.pad.padTriangles, mesh);
  if (!merge.ok) return { ok: false, detail: `${merge.code}:${merge.detail ?? ''}` };
  return { ok: true, detail: null };
};

const evaluate = (fx: FixtureCase): Row => {
  const raw = fx.run();
  const tied = raw.ok && raw.triangles.length === 0;
  const mesh = { points: raw.points, triangles: raw.triangles };
  const mergePoints = Array.from({ length: Math.floor(raw.daylight.length / 3) }, (_, i) => ({
    x: raw.daylight[i * 3]!, y: raw.daylight[i * 3 + 1]!, z: raw.daylight[i * 3 + 2]!,
  }));
  const validator = validateGroupMesh(mesh);
  const audit = auditMesh(mesh, mergePoints, fx.closed, tied ? 0 : raw.planArea);
  const index: AuditLike = {
    vertexComponents: audit.components,
    edgeComponents: audit.edgeComponents,
    boundaryEdges: audit.boundaryEdges,
    daylightSimple: audit.checks.daylight === true,
    overlap: audit.checks.noInteriorOverlap === false,
  };
  const diagRaw = geometricDiagnostic(mesh);
  const diag: DiagLike = {
    coincidentVertexSets: diagRaw.coincidentSets.length,
    exactDuplicateVertexSets: diagRaw.exactDuplicateSets.length,
    coincidentNonSharedEdges: diagRaw.coincidentNonSharedEdges,
    weldedEdgeComponents: diagRaw.weldedEdgeComponents,
    weldedDegenerateTriangles: diagRaw.weldedDegenerateTriangles,
  };
  const { classification, flags } = classify(raw.ok, tied, index, diag, validator);

  const canonical = raw.triangles.length > 0 ? canonicalizeBakedTin(raw.points, raw.triangles) : null;
  const bakeError = canonical
    ? validateExplicitTinPayload({
      vertices: canonical.vertices, faces: canonical.faces,
      provenance: { format: 'explicit', fileName: 'group', surfaceName: 'group' } as never,
    })
    : 'empty';
  const canBake = raw.ok && raw.triangles.length > 0 && bakeError === null;
  const design = designPatchGate(raw, fx.closed);

  const status = raw.ok
    ? tied ? 'TIED' : `ok(${raw.diagnostics.join(',') || 'CLEAN'})`
    : `${raw.code}/${raw.detail ?? ''}`;
  return {
    id: fx.id, label: fx.label, kind: fx.kind, criteria: fx.criteria, closed: fx.closed,
    engineOk: raw.ok, status,
    points: raw.points.length / 3, triangles: raw.triangles.length / 3,
    tieCount: raw.ties.length, planArea: tied ? 0 : round(raw.planArea), area3d: tied ? 0 : round(raw.area3d),
    validator, index: { ...index, boundaryLoops: boundaryLoopsOf(raw.triangles) }, diag,
    diagnostics: raw.diagnostics,
    classification, flags,
    canCurrent: raw.ok && !tied,
    canExtract: raw.ok && !tied && validator === null,
    canBake,
    canDesignPatch: design.ok,
    designPatchDetail: design.detail,
  };
};

const buildMatrix = (): Row[] => buildFixtures().map(evaluate);

// Frozen actuals (RED): the shipped engine's measured topology. Update only
// with a deliberate engine fix and a matching audit-doc revision.
interface Expected {
  engineOk: boolean;
  status: string;
  points: number;
  triangles: number;
  tieCount: number;
  planArea: number;
  area3d: number;
  validator: string | null;
  indexEdgeComponents: number;
  indexBoundaryEdges: number;
  indexBoundaryLoops: number;
  coincidentVertexSets: number;
  coincidentNonSharedEdges: number;
  weldedEdgeComponents: number;
  classification: Classification;
  canCurrent: boolean;
  canExtract: boolean;
  canBake: boolean;
  canDesignPatch: boolean;
}

const EXPECTED: Record<string, Expected> = {
  'standalone.A distance': { engineOk: true, status: 'ok(CLEAN)', points: 32, triangles: 30, tieCount: 0, planArea: 2082.880954009, area3d: 2328.731701102, validator: null, indexEdgeComponents: 1, indexBoundaryEdges: 32, indexBoundaryLoops: 1, coincidentVertexSets: 0, coincidentNonSharedEdges: 0, weldedEdgeComponents: 1, classification: 'TOPOLOGY_VALID', canCurrent: true, canExtract: true, canBake: true, canDesignPatch: false },
  'standalone.B elevation': { engineOk: true, status: 'ok(CLEAN)', points: 32, triangles: 30, tieCount: 0, planArea: 2082.880954009, area3d: 2328.731701102, validator: null, indexEdgeComponents: 1, indexBoundaryEdges: 32, indexBoundaryLoops: 1, coincidentVertexSets: 0, coincidentNonSharedEdges: 0, weldedEdgeComponents: 1, classification: 'TOPOLOGY_VALID', canCurrent: true, canExtract: true, canBake: true, canDesignPatch: false },
  'standalone.C relative': { engineOk: true, status: 'ok(CLEAN)', points: 32, triangles: 30, tieCount: 0, planArea: 2082.880954009, area3d: 2328.731701102, validator: null, indexEdgeComponents: 1, indexBoundaryEdges: 32, indexBoundaryLoops: 1, coincidentVertexSets: 0, coincidentNonSharedEdges: 0, weldedEdgeComponents: 1, classification: 'TOPOLOGY_VALID', canCurrent: true, canExtract: true, canBake: true, canDesignPatch: false },
  // Wave C: Surface standalone canonicalized to the analytic strip
  // (39/37 -> 32/30), coincident ULP-twin sets 2 -> 0; areas unchanged.
  'standalone.D surface fixed': { engineOk: true, status: 'ok(CLEAN)', points: 32, triangles: 30, tieCount: 0, planArea: 2082.880954009, area3d: 2328.731701102, validator: null, indexEdgeComponents: 1, indexBoundaryEdges: 32, indexBoundaryLoops: 1, coincidentVertexSets: 0, coincidentNonSharedEdges: 0, weldedEdgeComponents: 1, classification: 'TOPOLOGY_VALID', canCurrent: true, canExtract: true, canBake: true, canDesignPatch: false },
  'closed.square.all-distance': { engineOk: true, status: 'ok(CURVE_CORNER_APPROXIMATED)', points: 128, triangles: 128, tieCount: 4, planArea: 9452.124826335, area3d: 10567.796821749, validator: null, indexEdgeComponents: 1, indexBoundaryEdges: 128, indexBoundaryLoops: 2, coincidentVertexSets: 0, coincidentNonSharedEdges: 0, weldedEdgeComponents: 1, classification: 'TOPOLOGY_VALID', canCurrent: true, canExtract: true, canBake: true, canDesignPatch: false },
  'closed.square.mixed-analytic': { engineOk: true, status: 'ok(CURVE_CORNER_APPROXIMATED)', points: 128, triangles: 128, tieCount: 4, planArea: 9452.124826335, area3d: 10567.796821749, validator: null, indexEdgeComponents: 1, indexBoundaryEdges: 128, indexBoundaryLoops: 2, coincidentVertexSets: 0, coincidentNonSharedEdges: 0, weldedEdgeComponents: 1, classification: 'TOPOLOGY_VALID', canCurrent: true, canExtract: true, canBake: true, canDesignPatch: false },
  // Wave C old->new G: C2 43pts/41tris -> canonicalized 36pts/34tris, 1 GAP
  // tie, area unchanged.
  'open.hybrid.one-arc': { engineOk: true, status: 'ok(CURVE_CORNER_APPROXIMATED)', points: 36, triangles: 34, tieCount: 1, planArea: 4418.559246851, area3d: 4940.099419284, validator: null, indexEdgeComponents: 1, indexBoundaryEdges: 36, indexBoundaryLoops: 1, coincidentVertexSets: 0, coincidentNonSharedEdges: 0, weldedEdgeComponents: 1, classification: 'TOPOLOGY_VALID', canCurrent: true, canExtract: true, canBake: true, canDesignPatch: false },
  // Wave C old->new H: C2 156pts/156tris/11 coincident -> canonicalized
  // 128pts/128tris/0 coincident, 4 GAP ties, plan+3D == analytic E.
  'closed.square.all-surface': { engineOk: true, status: 'ok(CURVE_CORNER_APPROXIMATED)', points: 128, triangles: 128, tieCount: 4, planArea: 9452.124826335, area3d: 10567.796821749, validator: null, indexEdgeComponents: 1, indexBoundaryEdges: 128, indexBoundaryLoops: 2, coincidentVertexSets: 0, coincidentNonSharedEdges: 0, weldedEdgeComponents: 1, classification: 'TOPOLOGY_VALID', canCurrent: true, canExtract: true, canBake: true, canDesignPatch: false },
  'standalone.straight.fixed': { engineOk: true, status: 'ok(CLEAN)', points: 4, triangles: 2, tieCount: 0, planArea: 2000, area3d: 2236.0679775, validator: null, indexEdgeComponents: 1, indexBoundaryEdges: 4, indexBoundaryLoops: 1, coincidentVertexSets: 0, coincidentNonSharedEdges: 0, weldedEdgeComponents: 1, classification: 'TOPOLOGY_VALID', canCurrent: true, canExtract: true, canBake: true, canDesignPatch: false },
  'closed.square.straight': { engineOk: true, status: 'ok(CLEAN)', points: 16, triangles: 16, tieCount: 4, planArea: 9600, area3d: 10733.126291999, validator: null, indexEdgeComponents: 1, indexBoundaryEdges: 16, indexBoundaryLoops: 2, coincidentVertexSets: 0, coincidentNonSharedEdges: 0, weldedEdgeComponents: 1, classification: 'TOPOLOGY_VALID', canCurrent: true, canExtract: true, canBake: true, canDesignPatch: true },
};

describe('phase20k1 production curved-seam reproduction matrix', () => {
  const rows = buildMatrix();

  it('records every fixture deterministically', () => {
    expect(JSON.stringify(buildMatrix())).toBe(JSON.stringify(rows));
    expect(rows.map((r) => r.id)).toEqual([
      'standalone.A distance', 'standalone.B elevation', 'standalone.C relative',
      'standalone.D surface fixed', 'closed.square.all-distance', 'closed.square.mixed-analytic',
      'open.hybrid.one-arc', 'closed.square.all-surface',
      'standalone.straight.fixed', 'closed.square.straight',
    ]);
  });

  it('freezes the measured per-fixture topology (RED)', () => {
    for (const row of rows) {
      const expected = EXPECTED[row.id];
      expect(expected, `missing frozen expectation for ${row.id}`).toBeDefined();
      expect(row.engineOk, row.id).toBe(expected!.engineOk);
      expect(row.status, row.id).toBe(expected!.status);
      expect(row.points, row.id).toBe(expected!.points);
      expect(row.triangles, row.id).toBe(expected!.triangles);
      expect(row.tieCount, row.id).toBe(expected!.tieCount);
      expect(row.planArea, row.id).toBe(expected!.planArea);
      expect(row.area3d, row.id).toBe(expected!.area3d);
      expect(row.validator, row.id).toBe(expected!.validator);
      expect(row.index.edgeComponents, row.id).toBe(expected!.indexEdgeComponents);
      expect(row.index.boundaryEdges, row.id).toBe(expected!.indexBoundaryEdges);
      expect(row.index.boundaryLoops, row.id).toBe(expected!.indexBoundaryLoops);
      expect(row.diag.coincidentVertexSets, row.id).toBe(expected!.coincidentVertexSets);
      expect(row.diag.coincidentNonSharedEdges, row.id).toBe(expected!.coincidentNonSharedEdges);
      expect(row.diag.weldedEdgeComponents, row.id).toBe(expected!.weldedEdgeComponents);
      expect(row.classification, row.id).toBe(expected!.classification);
      expect(row.canCurrent, row.id).toBe(expected!.canCurrent);
      expect(row.canExtract, row.id).toBe(expected!.canExtract);
      expect(row.canBake, row.id).toBe(expected!.canBake);
      expect(row.canDesignPatch, row.id).toBe(expected!.canDesignPatch);
    }
  });
});
