import { buildSurfaceGrid, getSurfaceElevationAt } from '../engine/cad/cadSurfaceInterpolation';
import type { CadSurfaceBuildResult } from '../engine/cad/cadSurfaces';
import { gradingSideNormal, toLocalFrame, fromLocalFrame } from '../engine/cad/grading/gradingCourseFrame';
import { classifySourceDelta, requireSourceCoverage, splitStationsAtZeros } from '../engine/cad/grading/gradingCutFill';
import { linearizeGradingArc } from '../engine/cad/grading/gradingCurve';
import {
  buildGradingStripMesh,
  mesh3dArea,
  meshPlanArea,
  tieStats,
} from '../engine/cad/grading/gradingMesh';
import { gradeElevation } from '../engine/cad/grading/gradingStraightSolve';
import {
  buildNearestEnvelope,
  extractZeroSegments,
  type GradingPolygonVertex,
  type ZeroSegment,
} from '../engine/cad/grading/gradingZeroLocus';
import { zeroDelta } from '../engine/cad/surfaces/volume/zero';
import type {
  CadGradingResult,
  GradingAccuracy,
  GradingCriterion,
  GradingDiagnostic,
  GradingDiagnosticCode,
  GradingResultRegion,
  GradingSide,
  ResolvedGradingSource,
} from '../engine/cad/grading/gradingTypes';

/**
 * Phase 20B — worker-side grade-to-surface calculation (flat snapshots only).
 *
 * Pure numeric pipeline composing the landed engine modules: strip bbox →
 * grid candidate triangles → local-frame map → rect clip → zero-locus →
 * nearest envelope → daylight polyline + strip mesh + stats. No CadProject,
 * no React, no project mutation. Both the surface worker handler and the
 * in-process fallback/tests run this function.
 */

export interface GradingTargetMeshSnapshot {
  /** Flat [x,y,z,...]. */
  points: number[];
  /** Flat CCW index triples. */
  triangles: number[];
}

export interface GradingComputeSource extends ResolvedGradingSource {
  // ResolvedGradingSource numbers only (start/end XYZ + length + isArc);
  // arc circle params ride along when the resolving course carried them.
}

export interface GradingComputeRequest {
  gradingId: string;
  /** `grev1:` content revision the result is calculated at. */
  revision: string;
  drawingId?: string;
  source: GradingComputeSource;
  side: GradingSide;
  criterion: GradingCriterion;
  maxSearchDistance: number;
  curveChordTolerance: number;
  target: GradingTargetMeshSnapshot;
}

export type GradingComputeOutcome =
  | { ok: true; result: CadGradingResult }
  | { ok: false; code: GradingDiagnosticCode; detail?: string };

interface LocalTri {
  u: number[];
  d: number[];
  z: number[];
}

const finiteSource = (source: GradingComputeSource): boolean =>
  Number.isFinite(source.startX) &&
  Number.isFinite(source.startY) &&
  Number.isFinite(source.endX) &&
  Number.isFinite(source.endY) &&
  Number.isFinite(source.startZ) &&
  Number.isFinite(source.endZ) &&
  Number.isFinite(source.length) &&
  source.length > 0;

interface TargetQuery {
  elevationAt: (_x: number, _y: number) => number | null;
  queryCount: number;
}

/** Adapter: flat snapshot mesh → engine barycentric query (grid + full-scan fallback). */
const buildTargetQuery = (target: GradingTargetMeshSnapshot): TargetQuery | null => {
  if (target.points.length % 3 !== 0 || target.triangles.length % 3 !== 0) return null;
  const count = target.points.length / 3;
  const points: Array<{ x: number; y: number; z: number }> = [];
  for (let i = 0; i < count; i += 1) {
    const x = target.points[i * 3]!;
    const y = target.points[i * 3 + 1]!;
    const z = target.points[i * 3 + 2]!;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
    points.push({ x, y, z });
  }
  const triangles: Array<[number, number, number]> = [];
  for (let i = 0; i + 2 < target.triangles.length; i += 3) {
    const a = target.triangles[i]!;
    const b = target.triangles[i + 1]!;
    const c = target.triangles[i + 2]!;
    if (!Number.isInteger(a) || !Number.isInteger(b) || !Number.isInteger(c)) return null;
    if (a < 0 || b < 0 || c < 0 || a >= count || b >= count || c >= count) return null;
    if (a === b || b === c || c === a) return null;
    triangles.push([a, b, c]);
  }
  const sourcePoints = points.map((p, index) => ({ entityId: `grading-target:${index}`, ...p }));
  const grid = buildSurfaceGrid(sourcePoints, triangles);
  const build = { outcome: 'ok', points, triangles, grid } as CadSurfaceBuildResult;
  let queryCount = 0;
  return {
    elevationAt: (x, y) => {
      queryCount += 1;
      return getSurfaceElevationAt(build, x, y);
    },
    get queryCount() {
      return queryCount;
    },
  };
};

/** Candidate target triangles via grid bbox over the swept strip (sorted, deterministic). */
const candidateTriangles = (
  target: GradingTargetMeshSnapshot,
  corners: Array<{ x: number; y: number }>,
): number[] | null => {
  const count = target.points.length / 3;
  const points: Array<{ x: number; y: number; z: number }> = [];
  for (let i = 0; i < count; i += 1) {
    points.push({ x: target.points[i * 3]!, y: target.points[i * 3 + 1]!, z: target.points[i * 3 + 2]! });
  }
  const triangles: Array<[number, number, number]> = [];
  for (let i = 0; i + 2 < target.triangles.length; i += 3) {
    triangles.push([target.triangles[i]!, target.triangles[i + 1]!, target.triangles[i + 2]!]);
  }
  const sourcePoints = points.map((p, index) => ({ entityId: `grading-target:${index}`, ...p }));
  const grid = buildSurfaceGrid(sourcePoints, triangles);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of corners) {
    minX = Math.min(minX, c.x);
    minY = Math.min(minY, c.y);
    maxX = Math.max(maxX, c.x);
    maxY = Math.max(maxY, c.y);
  }
  const { minX: gx, minY: gy, cellSize, cells } = grid;
  const x0 = Math.floor((minX - gx) / cellSize);
  const x1 = Math.floor((maxX - gx) / cellSize);
  const y0 = Math.floor((minY - gy) / cellSize);
  const y1 = Math.floor((maxY - gy) / cellSize);
  const found = new Set<number>();
  for (let ix = x0; ix <= x1; ix += 1) {
    for (let iy = y0; iy <= y1; iy += 1) {
      const list = cells.get(`${ix},${iy}`);
      if (list) for (const index of list) found.add(index);
    }
  }
  // Cell miss (strip outside indexed span): fall back to bbox overlap scan.
  if (found.size === 0) {
    for (let i = 0; i < triangles.length; i += 1) {
      const tri = triangles[i]!;
      const xs = [points[tri[0]]!.x, points[tri[1]]!.x, points[tri[2]]!.x];
      const ys = [points[tri[0]]!.y, points[tri[1]]!.y, points[tri[2]]!.y];
      if (Math.max(...xs) >= minX && Math.min(...xs) <= maxX && Math.max(...ys) >= minY && Math.min(...ys) <= maxY) {
        found.add(i);
      }
    }
  }
  return [...found].sort((a, b) => a - b);
};

/** Sutherland–Hodgman clip of a (u,d) polygon to the axis rect. */
const clipRect = (
  polygon: Array<{ u: number; d: number }>,
  uMin: number,
  uMax: number,
  dMax: number,
): Array<{ u: number; d: number }> => {
  const clipEdge = (
    poly: Array<{ u: number; d: number }>,
    inside: (_p: { u: number; d: number }) => boolean,
    cross: (_a: { u: number; d: number }, _b: { u: number; d: number }) => { u: number; d: number },
  ): Array<{ u: number; d: number }> => {
    const out: Array<{ u: number; d: number }> = [];
    for (let i = 0; i < poly.length; i += 1) {
      const a = poly[i]!;
      const b = poly[(i + 1) % poly.length]!;
      const aIn = inside(a);
      const bIn = inside(b);
      if (aIn) out.push(a);
      if (aIn !== bIn) out.push(cross(a, b));
    }
    return out;
  };
  const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
  const tFor = (a: number, b: number, edge: number): number => (edge - a) / (b - a);
  let poly = polygon;
  poly = clipEdge(poly, (p) => p.u >= uMin, (a, b) => {
    const t = tFor(a.u, b.u, uMin);
    return { u: uMin, d: lerp(a.d, b.d, t) };
  });
  if (poly.length === 0) return poly;
  poly = clipEdge(poly, (p) => p.u <= uMax, (a, b) => {
    const t = tFor(a.u, b.u, uMax);
    return { u: uMax, d: lerp(a.d, b.d, t) };
  });
  if (poly.length === 0) return poly;
  poly = clipEdge(poly, (p) => p.d >= 0, (a, b) => {
    const t = tFor(a.d, b.d, 0);
    return { u: lerp(a.u, b.u, t), d: 0 };
  });
  if (poly.length === 0) return poly;
  poly = clipEdge(poly, (p) => p.d <= dMax, (a, b) => {
    const t = tFor(a.d, b.d, dMax);
    return { u: lerp(a.u, b.u, t), d: dMax };
  });
  return poly;
};

interface SpanSolve {
  nodes: Array<{ u: number; d: number }>;
  segments: ZeroSegment[];
  coincident: boolean;
  beyondMax: boolean;
}

/** Fixed-g solve over one station span: clip → zero-locus → nearest envelope. */
const solveSpan = (
  target: GradingTargetMeshSnapshot,
  candidates: number[],
  source: GradingComputeSource,
  normal: { nx: number; ny: number },
  gs: number,
  g: number,
  uMin: number,
  uMax: number,
  maxSearchDistance: number,
): SpanSolve | { code: GradingDiagnosticCode } => {
  const segments: ZeroSegment[] = [];
  let coincident = false;
  let beyondMax = false;
  for (const index of candidates) {
    const tri: LocalTri = { u: [], d: [], z: [] };
    for (let k = 0; k < 3; k += 1) {
      const vi = target.triangles[index * 3 + k]!;
      const local = toLocalFrame(target.points[vi * 3]!, target.points[vi * 3 + 1]!, source, normal);
      if (!local) continue;
      tri.u.push(local.u);
      tri.d.push(local.d);
      tri.z.push(target.points[vi * 3 + 2]!);
    }
    if (tri.u.length !== 3) continue;
    const clipped = clipRect(
      tri.u.map((u, k) => ({ u, d: tri.d[k]! })),
      uMin,
      uMax,
      maxSearchDistance,
    );
    if (clipped.length < 3) continue;
    const withDelta: GradingPolygonVertex[] = clipped.map((p) => ({
      ...p,
      delta: triZAt(tri, p.u, p.d) - gradeElevation(source.startZ, gs, p.u, g, p.d),
    }));
    const locus = extractZeroSegments(withDelta, true);
    if (locus.coincident) coincident = true;
    for (const s of locus.segments) segments.push(s);
    // Beyond-max probe: unclipped triangle zero content past the search wall.
    const full: GradingPolygonVertex[] = tri.u.map((u, k) => ({
      u,
      d: tri.d[k]!,
      delta: tri.z[k]! - gradeElevation(source.startZ, gs, u, g, tri.d[k]!),
    }));
    for (const s of extractZeroSegments(full, true).segments) {
      const far = Math.max(s.d0, s.d1);
      if (far > maxSearchDistance + zeroDelta(far, maxSearchDistance)) beyondMax = true;
    }
  }
  if (segments.length === 0) {
    return { code: coincident ? 'COINCIDENT_TARGET' : 'NO_SOLUTION' };
  }
  // Joint conditioning: zero-segment endpoints from adjacent same-plane
  // triangles are computed by independent edge interpolations and can
  // diverge by a few ulps (~1e-15) — beyond the envelope's zeroDelta-exact
  // connectivity floor. Snap endpoints to 1e-12 (picometres, exact and
  // deterministic), then merge adjacent same-line segments so shared
  // joints vanish instead of surviving as noise-bearing envelope events.
  // Position error ≤5e-13 m never affects the daylight agreement gate
  // (which compares plane residuals at the same station, ~1e-14).
  const snap = (value: number): number => Math.round(value * 1e12) / 1e12;
  const snapped = segments.map((s) => ({ u0: snap(s.u0), d0: snap(s.d0), u1: snap(s.u1), d1: snap(s.d1) }));
  const ordered = [...snapped].sort(
    (a, b) => a.u0 - b.u0 || a.d0 - b.d0 || a.u1 - b.u1 || a.d1 - b.d1,
  );
  const merged: ZeroSegment[] = [];
  for (const s of ordered) {
    const prev = merged[merged.length - 1];
    if (
      prev &&
      prev.u1 === s.u0 &&
      prev.d1 === s.d0 &&
      lineDistance(prev, s.u1, s.d1) <= 1e-9
    ) {
      prev.u1 = s.u1;
      prev.d1 = s.d1;
      continue;
    }
    merged.push({ ...s });
  }
  const conditioned = merged;
  const envelope = buildNearestEnvelope(conditioned, maxSearchDistance);
  if (!envelope.ok) {
    return { code: envelope.code };
  }
  return { nodes: envelope.polyline, segments: conditioned, coincident, beyondMax };
};

/** Perpendicular distance of (u, d) from the line through segment s. */
const lineDistance = (s: ZeroSegment, u: number, d: number): number => {
  const du = s.u1 - s.u0;
  const dd = s.d1 - s.d0;
  const len = Math.hypot(du, dd);
  if (!(len > 0)) return Math.hypot(u - s.u0, d - s.d0);
  return Math.abs((u - s.u0) * dd - (d - s.d0) * du) / len;
};

/** Barycentric Z of the affine local triangle at (u, d). */
const triZAt = (tri: LocalTri, u: number, d: number): number => {
  const [u0, u1, u2] = tri.u as [number, number, number];
  const [d0, d1, d2] = tri.d as [number, number, number];
  const [z0, z1, z2] = tri.z as [number, number, number];
  const det = (u1 - u0) * (d2 - d0) - (u2 - u0) * (d1 - d0);
  if (det === 0) return (z0 + z1 + z2) / 3;
  const l1 = ((u - u0) * (d2 - d0) - (d - d0) * (u2 - u0)) / det;
  const l2 = ((u1 - u0) * (d - d0) - (d1 - d0) * (u - u0)) / det;
  return z0 + l1 * (z1 - z0) + l2 * (z2 - z0);
}

/* Source-tangent probe helper lives inline at the call site (atSource). */

// ---------------------------------------------------------------------------
// Straight-chord solve (the exact solver; arc sources run it once per chord)
// ---------------------------------------------------------------------------

/**
 * Fail-closed cap on arc subdivision: a pathological tolerance must refuse
 * with a diagnostic, never hang the worker rebuilding the target index per
 * chord. R=50 m at 0.005 m needs 56 chords; 4096 covers any sane job.
 */
const MAX_ARC_SUBDIVISIONS = 4096;

interface StraightChordSolve {
  regions: GradingResultRegion[];
  diagnostics: GradingDiagnostic[];
  /** Arc-mapped stations parallel to the polylines (chord solve: raw u). */
  nodeStations: number[];
  sourcePts: Array<{ x: number; y: number; z: number }>;
  daylightPts: Array<{ x: number; y: number; z: number }>;
  daylightFlat: number[];
  distances: number[];
  candidateTriangleCount: number;
  intersectionSegmentCount: number;
  multipleSolutionCount: number;
}

type StraightChordOutcome =
  | { ok: true; solve: StraightChordSolve }
  | { ok: false; code: GradingDiagnosticCode; detail?: string };

interface StraightChordInput {
  source: GradingComputeSource;
  side: GradingSide;
  criterion: GradingCriterion;
  maxSearchDistance: number;
  target: GradingTargetMeshSnapshot;
  query: TargetQuery;
  /** Arc-station offset added to every chord-local station. */
  stationBase: number;
  /** Chord-u → arc-station scale (straight solve: 1). */
  stationScale: number;
}

/**
 * Exact straight-chord solve through world polylines. The solver math is
 * untouched by the arc slice: station mapping is affine (base + u*scale),
 * so the straight path (base 0, scale 1) reproduces its stations bitwise.
 */
const solveStraightChord = (input: StraightChordInput): StraightChordOutcome => {
  const { source, side, criterion, maxSearchDistance, target, query, stationBase, stationScale } = input;
  if (!finiteSource(source)) return { ok: false, code: 'NO_SOLUTION', detail: 'GRADING_BAD_SOURCE' };
  const dx = source.endX - source.startX;
  const dy = source.endY - source.startY;
  const len = Math.hypot(dx, dy);
  if (!(len > 0) || !Number.isFinite(len)) return { ok: false, code: 'NO_SOLUTION', detail: 'GRADING_DEGENERATE_SOURCE' };
  const normal = gradingSideNormal(dx / len, dy / len, side);
  if (!normal) return { ok: false, code: 'NO_SOLUTION', detail: 'GRADING_BAD_SIDE' };
  let fixedG: number | null = null;
  if (criterion.kind === 'fixed') {
    if (!Number.isFinite(criterion.gradeRatio)) return { ok: false, code: 'NO_SOLUTION', detail: 'GRADING_BAD_CRITERION' };
    fixedG = criterion.gradeRatio;
  } else {
    if (!Number.isFinite(criterion.cutGradeRatio) || !Number.isFinite(criterion.fillGradeRatio)) {
      return { ok: false, code: 'NO_SOLUTION', detail: 'GRADING_BAD_CRITERION' };
    }
  }
  const tx = dx / len;
  const ty = dy / len;
  const gs = (source.endZ - source.startZ) / source.length;
  const atSource = (u: number): { x: number; y: number; z: number } => ({
    x: source.startX + tx * u,
    y: source.startY + ty * u,
    z: source.startZ + gs * u,
  });

  // Strip corners for the grid-bbox candidate pass.
  const corner = (u: number, d: number): { x: number; y: number } => {
    const p = fromLocalFrame(u, d, source, normal);
    return { x: p?.x ?? NaN, y: p?.y ?? NaN };
  };
  const candidates = candidateTriangles(target, [
    corner(0, 0),
    corner(source.length, 0),
    corner(0, maxSearchDistance),
    corner(source.length, maxSearchDistance),
  ]);
  if (!candidates) return { ok: false, code: 'NO_SOLUTION', detail: 'GRADING_BAD_TARGET_MESH' };

  // Station plan: fixed = one span; cut/fill = coverage-gated zero-split spans.
  interface Span {
    u0: number;
    u1: number;
    g: number;
    region: GradingResultRegion['classification'];
  }
  let spans: Span[];
  if (fixedG !== null) {
    spans = [{ u0: 0, u1: source.length, g: fixedG, region: 'FIXED' }];
  } else {
    const cutG = (criterion as Extract<GradingCriterion, { kind: 'cut-fill' }>).cutGradeRatio;
    const fillG = (criterion as Extract<GradingCriterion, { kind: 'cut-fill' }>).fillGradeRatio;
    // Coverage probe: endpoints + every candidate-vertex station clamped in.
    const probeSet = new Set<number>([0, source.length]);
    for (const index of candidates) {
      for (let k = 0; k < 3; k += 1) {
        const vi = target.triangles[index * 3 + k]!;
        const local = toLocalFrame(target.points[vi * 3]!, target.points[vi * 3 + 1]!, source, normal);
        if (local && local.u >= 0 && local.u <= source.length) probeSet.add(local.u);
      }
    }
    const probes = [...probeSet].sort((a, b) => a - b);
    const deltas: Array<number | null> = probes.map((u) => {
      const p = atSource(u);
      const z = query.elevationAt(p.x, p.y);
      return z === null ? null : z - p.z;
    });
    if (!requireSourceCoverage(deltas)) {
      return { ok: false, code: 'TARGET_GAP', detail: 'GRADING_CUTFILL_SOURCE_COVERAGE' };
    }
    const split = splitStationsAtZeros(probes, deltas as number[]);
    spans = [];
    for (let i = 0; i + 1 < split.length; i += 1) {
      const u0 = split[i]!;
      const u1 = split[i + 1]!;
      const mid = (u0 + u1) / 2;
      const p = atSource(mid);
      const z = query.elevationAt(p.x, p.y);
      const delta = z === null ? 0 : z - p.z;
      const cls = classifySourceDelta(delta);
      spans.push({
        u0,
        u1,
        g: cls === 'CUT' ? cutG : cls === 'FILL' ? fillG : 0,
        region: cls === 'TIED' ? 'FIXED' : cls,
      });
    }
  }

  const diagnostics: GradingDiagnostic[] = [];
  const regions: GradingResultRegion[] = [];
  // Nodes carry their producing span: a joint station shared by two spans
  // can hold two valid elevations (one per grading plane, e.g. a target
  // cliff) — same-span dedupe only, never across the joint.
  const daylight: Array<{ u: number; d: number; span: number }> = [];
  let intersectionSegmentCount = 0;
  let multipleSolutionCount = 0;
  let spanFailed = false;
  let spanFailure: StraightChordOutcome | null = null;
  spans.forEach((span, spanIndex) => {
    if (spanFailed) return;
    if (span.g === 0 && span.region === 'FIXED' && fixedG === null) {
      // Tied cut/fill span: daylight rides the source (zero width).
      daylight.push({ u: span.u0, d: 0, span: spanIndex }, { u: span.u1, d: 0, span: spanIndex });
      regions.push({ classification: 'FIXED', stationSpan: [span.u0, span.u1] });
      return;
    }
    const solved = solveSpan(target, candidates, source, normal, gs, span.g, span.u0, span.u1, maxSearchDistance);
    if ('code' in solved) {
      if (solved.code === 'BRANCH_DISCONTINUITY') {
        // Void probe along the source line before reporting the branch code.
        const mid = (span.u0 + span.u1) / 2;
        const probes = [span.u0, mid, span.u1].map((u) => {
          const p = atSource(u);
          return query.elevationAt(p.x, p.y);
        });
        if (probes.some((z) => z === null)) {
          spanFailure = { ok: false, code: 'TARGET_GAP', detail: 'GRADING_TARGET_VOID' };
          spanFailed = true;
          return;
        }
      }
      spanFailure = { ok: false, code: solved.code };
      spanFailed = true;
      return;
    }
    intersectionSegmentCount += solved.segments.length;
    multipleSolutionCount += countMultipleSolutions(solved.segments);
    if (solved.coincident) {
      diagnostics.push({ code: 'COINCIDENT_TARGET', stationSpan: [span.u0, span.u1] });
    }
    if (solved.beyondMax) {
      diagnostics.push({ code: 'MAX_DISTANCE_REACHED', stationSpan: [span.u0, span.u1] });
    }
    for (const node of solved.nodes) {
      const prev = daylight[daylight.length - 1];
      if (prev && Math.abs(prev.u - node.u) <= zeroDelta(prev.u, node.u) && Math.abs(prev.d - node.d) <= zeroDelta(prev.d, node.d)) {
        // Same station+offset: collapse only when both grading planes agree
        // on z (continuous hinge); a true z-step keeps both sides.
        const zPrev = gradeElevation(source.startZ, gs, prev.u, spans[prev.span]!.g, prev.d);
        const zNode = gradeElevation(source.startZ, gs, node.u, spans[spanIndex]!.g, node.d);
        if (Math.abs(zPrev - zNode) <= zeroDelta(zPrev, zNode)) continue;
      }
      daylight.push({ ...node, span: spanIndex });
    }
    regions.push({ classification: span.region, stationSpan: [span.u0, span.u1] });
  });

  if (spanFailure) return spanFailure;

  if (daylight.length < 2) return { ok: false, code: 'NO_SOLUTION' };
  daylight.sort((a, b) => a.u - b.u || a.span - b.span);
  // Drop interior joints d-collinear under one grading plane: TIN
  // diagonals inject event stations along a straight tie; z is then
  // mathematically determined by (u, d), so no separate z check is
  // needed (and its float noise would only keep dead nodes). Cross-plane
  // joints (cut/fill z-steps) keep both sides via the samePlane gate.
  const simplified: Array<{ u: number; d: number; span: number }> = [daylight[0]!];
  for (let i = 1; i + 1 < daylight.length; i += 1) {
    const prev = simplified[simplified.length - 1]!;
    const mid = daylight[i]!;
    const next = daylight[i + 1]!;
    const samePlane = prev.span === mid.span && mid.span === next.span;
    const du = next.u - prev.u;
    const expectedD = du === 0 ? prev.d : prev.d + ((next.d - prev.d) * (mid.u - prev.u)) / du;
    const dFlat = Math.abs(mid.d - expectedD) <= zeroDelta(mid.d, expectedD);
    if (samePlane && dFlat) continue;
    simplified.push(mid);
  }
  simplified.push(daylight[daylight.length - 1]!);
  daylight.length = 0;
  daylight.push(...simplified);

  // World daylight + source XYZ (grading-plane Z after proven agreement).
  const daylightFlat: number[] = [];
  const sourcePts: Array<{ x: number; y: number; z: number }> = [];
  const daylightPts: Array<{ x: number; y: number; z: number }> = [];
  const distances: number[] = [];
  const nodeStations: number[] = [];
  for (const node of daylight) {
    const world = fromLocalFrame(node.u, node.d, source, normal);
    if (!world) return { ok: false, code: 'NO_SOLUTION', detail: 'GRADING_FRAME' };
    const s = atSource(node.u);
    // Daylight Z agreement: target-plane Z must match grading-plane Z.
    const zt = query.elevationAt(world.x, world.y);
    const zg = gradeElevation(source.startZ, gs, node.u, spans[node.span]!.g, node.d);
    if (zt === null) return { ok: false, code: 'NO_SOLUTION', detail: 'GRADING_DAYLIGHT_OFF_TARGET' };
    if (Math.abs(zt - zg) > zeroDelta(zt, zg)) {
      return { ok: false, code: 'NO_SOLUTION', detail: 'GRADING_DAYLIGHT_DISAGREE' };
    }
    sourcePts.push(s);
    daylightPts.push({ x: world.x, y: world.y, z: zg });
    daylightFlat.push(world.x, world.y, zg);
    distances.push(node.d);
    nodeStations.push(stationBase + node.u * stationScale);
  }

  // Affine station map preserves order (scale > 0), so mapped spans stay sorted.
  const mapStation = (u: number): number => stationBase + u * stationScale;
  return {
    ok: true,
    solve: {
      regions: regions.map((region) => ({
        classification: region.classification,
        stationSpan: [mapStation(region.stationSpan[0]), mapStation(region.stationSpan[1])] as [number, number],
      })),
      diagnostics: diagnostics.map((diagnostic) =>
        diagnostic.stationSpan
          ? {
              ...diagnostic,
              stationSpan: [
                mapStation(diagnostic.stationSpan[0]),
                mapStation(diagnostic.stationSpan[1]),
              ] as [number, number],
            }
          : diagnostic,
      ),
      nodeStations,
      sourcePts,
      daylightPts,
      daylightFlat,
      distances,
      candidateTriangleCount: candidates.length,
      intersectionSegmentCount,
      multipleSolutionCount,
    },
  };
};

interface AssembledResultInput {
  gradingId: string;
  revision: string;
  sourceLength: number;
  accuracy: GradingAccuracy;
  regions: GradingResultRegion[];
  diagnostics: GradingDiagnostic[];
  sourcePts: Array<{ x: number; y: number; z: number }>;
  daylightPts: Array<{ x: number; y: number; z: number }>;
  daylightFlat: number[];
  distances: number[];
  nodeStations: number[];
  query: TargetQuery;
  candidateTriangleCount: number;
  intersectionSegmentCount: number;
  multipleSolutionCount: number;
}

/** Strip mesh + areas + stats over stitched polylines (solver-independent). */
const assembleGradingResult = (input: AssembledResultInput): GradingComputeOutcome => {
  const {
    gradingId,
    revision,
    sourceLength,
    accuracy,
    regions,
    diagnostics,
    sourcePts,
    daylightPts,
    daylightFlat,
    distances,
    nodeStations,
    query,
    candidateTriangleCount,
    intersectionSegmentCount,
    multipleSolutionCount,
  } = input;
  const mesh = buildGradingStripMesh(sourcePts, daylightPts);
  if (!mesh.ok) {
    // Fully already-tied course: CURRENT with zero area (bake stays blocked).
    const stats = tieStats(distances);
    return {
      ok: true,
      result: {
        gradingId,
        revision,
        accuracy,
        regions,
        daylightPoints: daylightFlat,
        gradingMesh: { points: [], triangles: [] },
        sourceLength,
        gradingPlanArea: 0,
        grading3dArea: 0,
        minProjectionDistance: stats.min,
        maxProjectionDistance: stats.max,
        meanProjectionDistance: stats.mean,
        cutSourceLength: 0,
        fillSourceLength: 0,
        tiedSourceLength: sourceLength,
        candidateTriangleCount,
        intersectionSegmentCount,
        multipleSolutionCount,
        diagnostics: [{ code: 'ALREADY_TIED' }],
      },
    };
  }

  // Cut/fill/tied source lengths from delta-at-source sign along the stations.
  let cutSourceLength = 0;
  let fillSourceLength = 0;
  let tiedSourceLength = 0;
  for (let i = 0; i + 1 < sourcePts.length; i += 1) {
    const width = Math.max(0, nodeStations[i + 1]! - nodeStations[i]!);
    if (!(width > 0)) continue;
    const pa = sourcePts[i]!;
    const pb = sourcePts[i + 1]!;
    const za = query.elevationAt(pa.x, pa.y);
    const zb = query.elevationAt(pb.x, pb.y);
    if (za === null || zb === null) continue;
    const da = za - pa.z;
    const db = zb - pb.z;
    const zaZero = Math.abs(da) <= zeroDelta(da, 0);
    const zbZero = Math.abs(db) <= zeroDelta(db, 0);
    if (zaZero && zbZero) tiedSourceLength += width;
    else if (!zaZero && !zbZero && (da > 0) === (db > 0)) {
      if (da > 0) cutSourceLength += width;
      else fillSourceLength += width;
    } else {
      // Zero crossing inside: split proportionally (linear delta).
      const t = Math.abs(da - db) <= zeroDelta(da, db) ? 0.5 : Math.abs(da) / (Math.abs(da) + Math.abs(db));
      if (da > 0) {
        cutSourceLength += width * t;
        fillSourceLength += width * (1 - t);
      } else if (da < 0) {
        fillSourceLength += width * t;
        cutSourceLength += width * (1 - t);
      } else {
        tiedSourceLength += width * t;
        if (db > 0) cutSourceLength += width * (1 - t);
        else fillSourceLength += width * (1 - t);
      }
    }
  }

  const stats = tieStats(distances);
  return {
    ok: true,
    result: {
      gradingId,
      revision,
      accuracy,
      regions,
      daylightPoints: daylightFlat,
      gradingMesh: { points: mesh.points, triangles: mesh.triangles },
      sourceLength,
      gradingPlanArea: meshPlanArea(mesh.points, mesh.triangles),
      grading3dArea: mesh3dArea(mesh.points, mesh.triangles),
      minProjectionDistance: stats.min,
      maxProjectionDistance: stats.max,
      meanProjectionDistance: stats.mean,
      cutSourceLength,
      fillSourceLength,
      tiedSourceLength,
      candidateTriangleCount,
      intersectionSegmentCount,
      multipleSolutionCount,
      diagnostics,
    },
  };
};

/** Seam equality under the zeroDelta floor (plan + elevation). */
const seamEquals = (
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
): boolean =>
  Math.abs(a.x - b.x) <= zeroDelta(a.x, b.x) &&
  Math.abs(a.y - b.y) <= zeroDelta(a.y, b.y) &&
  Math.abs(a.z - b.z) <= zeroDelta(a.z, b.z);

/**
 * Grade-to-surface calculation on flat snapshots. Arc sources with circle
 * parameters subdivide via linearizeGradingArc at the definition's
 * curveChordTolerance and run the exact straight-chord solve per chord;
 * arc sources WITHOUT parameters keep the legacy single-chord solve
 * (CURVE_APPROXIMATED accuracy); straight sources are EXACT. Cut/fill
 * splits stations at exact zero crossings and solves each span under its
 * classified slope; any null source coverage BLOCKS cut/fill.
 */
export const computeGradingFromSnapshots = (
  request: GradingComputeRequest,
): GradingComputeOutcome => {
  const { source, side, criterion, maxSearchDistance, target } = request;
  if (!finiteSource(source)) return { ok: false, code: 'NO_SOLUTION', detail: 'GRADING_BAD_SOURCE' };
  if (!(maxSearchDistance > 0) || !Number.isFinite(maxSearchDistance)) {
    return { ok: false, code: 'NO_SOLUTION', detail: 'GRADING_BAD_SEARCH_DISTANCE' };
  }
  const query = buildTargetQuery(target);
  if (!query) return { ok: false, code: 'NO_SOLUTION', detail: 'GRADING_BAD_TARGET_MESH' };

  if (source.isArc && source.arc) {
    const tolerance = request.curveChordTolerance;
    if (!Number.isFinite(tolerance) || !(tolerance > 0)) {
      return { ok: false, code: 'NO_SOLUTION', detail: 'GRADING_BAD_TOLERANCE' };
    }
    const linearized = linearizeGradingArc(
      source.arc.centerX,
      source.arc.centerY,
      source.arc.radius,
      source.arc.startAngle,
      source.arc.endAngle,
      source.arc.sweepCCW,
      source.startZ,
      source.endZ,
      tolerance,
    );
    if (!linearized) return { ok: false, code: 'NO_SOLUTION', detail: 'GRADING_ARC_LINEARIZE' };
    if (linearized.subdivisions > MAX_ARC_SUBDIVISIONS) {
      return { ok: false, code: 'NO_SOLUTION', detail: 'GRADING_ARC_TOO_FINE' };
    }
    // Uniform subdivision ⇒ uniform arc-length stations per chord.
    const segArc = source.length / linearized.subdivisions;
    const regions: GradingResultRegion[] = [];
    const diagnostics: GradingDiagnostic[] = [];
    const sourcePts: Array<{ x: number; y: number; z: number }> = [];
    const daylightPts: Array<{ x: number; y: number; z: number }> = [];
    const daylightFlat: number[] = [];
    const distances: number[] = [];
    const nodeStations: number[] = [];
    let candidateTriangleCount = 0;
    let intersectionSegmentCount = 0;
    let multipleSolutionCount = 0;
    for (let k = 0; k < linearized.subdivisions; k += 1) {
      const p0 = linearized.points[k]!;
      const p1 = linearized.points[k + 1]!;
      const chordLen = Math.hypot(p1.x - p0.x, p1.y - p0.y);
      if (!(chordLen > 0) || !Number.isFinite(chordLen)) {
        return { ok: false, code: 'NO_SOLUTION', detail: 'GRADING_ARC_LINEARIZE' };
      }
      const solved = solveStraightChord({
        source: {
          startX: p0.x,
          startY: p0.y,
          endX: p1.x,
          endY: p1.y,
          startZ: p0.z,
          endZ: p1.z,
          length: chordLen,
          reoriented: source.reoriented,
          isArc: false,
        },
        side,
        criterion,
        maxSearchDistance,
        target,
        query,
        stationBase: k * segArc,
        stationScale: segArc / chordLen,
      });
      if (!solved.ok) return solved;
      const chord = solved.solve;
      // Stitch in station order: the shared joint node is solved by both
      // adjacent chords, so drop the duplicate when both boundaries agree
      // under the zeroDelta floor (span-tagged same-plane convention).
      let skipFirst = 0;
      if (
        sourcePts.length > 0 &&
        seamEquals(sourcePts[sourcePts.length - 1]!, chord.sourcePts[0]!) &&
        seamEquals(daylightPts[daylightPts.length - 1]!, chord.daylightPts[0]!)
      ) {
        skipFirst = 1;
      }
      regions.push(...chord.regions);
      diagnostics.push(...chord.diagnostics);
      for (let i = skipFirst; i < chord.sourcePts.length; i += 1) {
        sourcePts.push(chord.sourcePts[i]!);
        daylightPts.push(chord.daylightPts[i]!);
        distances.push(chord.distances[i]!);
        nodeStations.push(chord.nodeStations[i]!);
      }
      for (let i = skipFirst * 3; i < chord.daylightFlat.length; i += 1) {
        daylightFlat.push(chord.daylightFlat[i]!);
      }
      candidateTriangleCount += chord.candidateTriangleCount;
      intersectionSegmentCount += chord.intersectionSegmentCount;
      multipleSolutionCount += chord.multipleSolutionCount;
    }
    return assembleGradingResult({
      gradingId: request.gradingId,
      revision: request.revision,
      sourceLength: source.length,
      accuracy: 'CURVE_APPROXIMATED',
      regions,
      diagnostics,
      sourcePts,
      daylightPts,
      daylightFlat,
      distances,
      nodeStations,
      query,
      candidateTriangleCount,
      intersectionSegmentCount,
      multipleSolutionCount,
    });
  }

  const solved = solveStraightChord({
    source,
    side,
    criterion,
    maxSearchDistance,
    target,
    query,
    stationBase: 0,
    stationScale: 1,
  });
  if (!solved.ok) return solved;
  const chord = solved.solve;
  return assembleGradingResult({
    gradingId: request.gradingId,
    revision: request.revision,
    sourceLength: source.length,
    accuracy: source.isArc ? 'CURVE_APPROXIMATED' : 'EXACT',
    regions: chord.regions,
    diagnostics: chord.diagnostics,
    sourcePts: chord.sourcePts,
    daylightPts: chord.daylightPts,
    daylightFlat: chord.daylightFlat,
    distances: chord.distances,
    nodeStations: chord.nodeStations,
    query,
    candidateTriangleCount: chord.candidateTriangleCount,
    intersectionSegmentCount: chord.intersectionSegmentCount,
    multipleSolutionCount: chord.multipleSolutionCount,
  });
};

/** Event stations covered by ≥2 segments (overlapping-u multiple roots). */
const countMultipleSolutions = (segments: ZeroSegment[]): number => {
  const events = new Set<number>();
  for (const s of segments) {
    events.add(s.u0);
    events.add(s.u1);
  }
  let count = 0;
  for (const u of events) {
    let covering = 0;
    for (const s of segments) {
      const lo = Math.min(s.u0, s.u1);
      const hi = Math.max(s.u0, s.u1);
      if (u >= lo - zeroDelta(u, lo) && u <= hi + zeroDelta(u, hi)) covering += 1;
    }
    if (covering >= 2) count += 1;
  }
  return count;
};

// ---------------------------------------------------------------------------
// Daylight/target agreement gate (GO-gate logic, service-side before CURRENT)
// ---------------------------------------------------------------------------

export interface GradingTargetQuery {
  elevationAt: (_x: number, _y: number) => number | null;
}

export interface GradingSourceBoundaryCheck {
  /** First/last source-boundary XYZ of the cached strip mesh. */
  first: { x: number; y: number; z: number };
  last: { x: number; y: number; z: number };
  /** Feature Line evaluated at the same persisted stations. */
  expectedFirst: { x: number; y: number; z: number };
  expectedLast: { x: number; y: number; z: number };
}

const boundaryEquals = (
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
): boolean =>
  Math.abs(a.x - b.x) <= zeroDelta(a.x, b.x) &&
  Math.abs(a.y - b.y) <= zeroDelta(a.y, b.y) &&
  Math.abs(a.z - b.z) <= zeroDelta(a.z, b.z);

/**
 * GO-gate before a worker result becomes CURRENT: every daylight vertex
 * must agree with the CURRENT target mesh within the zeroDelta floor, and
 * the strip source boundary must equal the Feature Line at the same
 * persisted stations. Returns null on agreement, else the reject reason.
 */
export const validateGradingResultAgainstTarget = (
  daylightPoints: number[],
  targetMeshQuery: GradingTargetQuery,
  sourceCheck: GradingSourceBoundaryCheck,
): string | null => {
  if (daylightPoints.length % 3 !== 0) return 'GRADING_AGREEMENT_MALFORMED_DAYLIGHT';
  if (!boundaryEquals(sourceCheck.first, sourceCheck.expectedFirst)) {
    return 'GRADING_AGREEMENT_SOURCE_BOUNDARY';
  }
  if (!boundaryEquals(sourceCheck.last, sourceCheck.expectedLast)) {
    return 'GRADING_AGREEMENT_SOURCE_BOUNDARY';
  }
  for (let i = 0; i + 2 < daylightPoints.length; i += 3) {
    const x = daylightPoints[i]!;
    const y = daylightPoints[i + 1]!;
    const z = daylightPoints[i + 2]!;
    const zt = targetMeshQuery.elevationAt(x, y);
    if (zt === null) return 'GRADING_AGREEMENT_DAYLIGHT_OFF_TARGET';
    if (Math.abs(zt - z) > zeroDelta(zt, z)) return 'GRADING_AGREEMENT_DAYLIGHT_Z';
  }
  return null;
};
