/**
 * Phase 20C Wave-1A — fixed-g station-span solve.
 *
 * Clip → zero-locus → nearest-envelope over one station span, moved verbatim
 * from `src/workers/surfaceGradingCompute.ts` (zero numerical change).
 * Corner half-sectors reuse the same machinery.
 */
import { clipRect } from './frameClip';
import { toLocalFrame, type PlanVector } from './gradingCourseFrame';
import { gradeElevation } from './gradingStraightSolve';
import {
  buildNearestEnvelope,
  extractZeroSegments,
  type GradingPolygonVertex,
  type ZeroSegment,
} from './gradingZeroLocus';
import { zeroDelta } from '../surfaces/volume/zero';
import type {
  GradingDiagnostic,
  GradingDiagnosticCode,
  GradingResultRegion,
} from './gradingTypes';
import type {
  GradingComputeSource,
  GradingTargetMeshSnapshot,
  TargetQuery,
} from './gradingComputeTypes';

interface LocalTri {
  u: number[];
  d: number[];
  z: number[];
}

export interface SpanSolve {
  nodes: Array<{ u: number; d: number }>;
  segments: ZeroSegment[];
  coincident: boolean;
  beyondMax: boolean;
}

interface SpanSegments {
  segments: ZeroSegment[];
  coincident: boolean;
  beyondMax: boolean;
}

/** Map one candidate triangle into the source-relative local frame. */
const buildLocalTri = (
  target: GradingTargetMeshSnapshot,
  index: number,
  source: GradingComputeSource,
  normal: { nx: number; ny: number },
): LocalTri | null => {
  const tri: LocalTri = { u: [], d: [], z: [] };
  for (let k = 0; k < 3; k += 1) {
    const vi = target.triangles[index * 3 + k]!;
    const local = toLocalFrame(target.points[vi * 3]!, target.points[vi * 3 + 1]!, source, normal);
    if (!local) continue;
    tri.u.push(local.u);
    tri.d.push(local.d);
    tri.z.push(target.points[vi * 3 + 2]!);
  }
  if (tri.u.length !== 3) return null;
  return tri;
};

/** Clip every candidate triangle and collect its zero-locus segments. */
const collectSpanSegments = (
  target: GradingTargetMeshSnapshot,
  candidates: number[],
  source: GradingComputeSource,
  normal: { nx: number; ny: number },
  gs: number,
  g: number,
  uMin: number,
  uMax: number,
  maxSearchDistance: number,
): SpanSegments => {
  const segments: ZeroSegment[] = [];
  let coincident = false;
  let beyondMax = false;
  for (const index of candidates) {
    const tri = buildLocalTri(target, index, source, normal);
    if (!tri) continue;
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
  return { segments, coincident, beyondMax };
};

/** Snap + merge conditioning for jointly-solved zero segments. */
const conditionSegments = (segments: ZeroSegment[]): ZeroSegment[] => {
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
  return merged;
};

/** Fixed-g solve over one station span: clip → zero-locus → nearest envelope. */
export const solveSpan = (
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
  const collected = collectSpanSegments(
    target,
    candidates,
    source,
    normal,
    gs,
    g,
    uMin,
    uMax,
    maxSearchDistance,
  );
  if (collected.segments.length === 0) {
    return { code: collected.coincident ? 'COINCIDENT_TARGET' : 'NO_SOLUTION' };
  }
  const conditioned = conditionSegments(collected.segments);
  const envelope = buildNearestEnvelope(conditioned, maxSearchDistance);
  if (!envelope.ok) {
    return { code: envelope.code };
  }
  return {
    nodes: envelope.polyline,
    segments: conditioned,
    coincident: collected.coincident,
    beyondMax: collected.beyondMax,
  };
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
};

/** Event stations covered by ≥2 segments (overlapping-u multiple roots). */
export const countMultipleSolutions = (segments: ZeroSegment[]): number => {
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

export interface ChordSpan {
  u0: number;
  u1: number;
  g: number;
  region: GradingResultRegion['classification'];
}

export type SourcePointFn = (_u: number) => { x: number; y: number; z: number };

export interface SpanAccum {
  diagnostics: GradingDiagnostic[];
  regions: GradingResultRegion[];
  // Nodes carry their producing span: a joint station shared by two spans
  // can hold two valid elevations (one per grading plane, e.g. a target
  // cliff) — same-span dedupe only, never across the joint.
  daylight: Array<{ u: number; d: number; span: number }>;
  intersectionSegmentCount: number;
  multipleSolutionCount: number;
}

/** Void probe along the source line before reporting the branch code. */
const probeSpanVoid = (
  span: ChordSpan,
  atSource: SourcePointFn,
  query: TargetQuery,
): boolean => {
  const mid = (span.u0 + span.u1) / 2;
  const probes = [span.u0, mid, span.u1].map((u) => {
    const p = atSource(u);
    return query.elevationAt(p.x, p.y);
  });
  return probes.some((z) => z === null);
};

/** Merge solved span nodes with same-plane hinge dedupe. */
const mergeSpanNodes = (
  daylight: SpanAccum['daylight'],
  nodes: Array<{ u: number; d: number }>,
  spans: ChordSpan[],
  spanIndex: number,
  source: GradingComputeSource,
  gs: number,
): void => {
  for (const node of nodes) {
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
};

export interface SpanSolveCtx {
  target: GradingTargetMeshSnapshot;
  candidates: number[];
  source: GradingComputeSource;
  normal: PlanVector;
  gs: number;
  maxSearchDistance: number;
  atSource: SourcePointFn;
  query: TargetQuery;
  fixedG: number | null;
  spans: ChordSpan[];
}

/** Single-span failure (subset of the chord outcome). */
type SpanFailure = { ok: false; code: GradingDiagnosticCode; detail?: string };

/** Solve one station span into the accumulator. */
const solveOneSpan = (
  ctx: SpanSolveCtx,
  span: ChordSpan,
  spanIndex: number,
  accum: SpanAccum,
): SpanFailure | null => {
  const { target, candidates, source, normal, gs, maxSearchDistance, atSource, query, fixedG } = ctx;
  if (span.g === 0 && span.region === 'FIXED' && fixedG === null) {
    // Tied cut/fill span: daylight rides the source (zero width).
    accum.daylight.push({ u: span.u0, d: 0, span: spanIndex }, { u: span.u1, d: 0, span: spanIndex });
    accum.regions.push({ classification: 'FIXED', stationSpan: [span.u0, span.u1] });
    return null;
  }
  const solved = solveSpan(target, candidates, source, normal, gs, span.g, span.u0, span.u1, maxSearchDistance);
  if ('code' in solved) {
    if (solved.code === 'BRANCH_DISCONTINUITY' && probeSpanVoid(span, atSource, query)) {
      return { ok: false, code: 'TARGET_GAP', detail: 'GRADING_TARGET_VOID' };
    }
    return { ok: false, code: solved.code };
  }
  accum.intersectionSegmentCount += solved.segments.length;
  accum.multipleSolutionCount += countMultipleSolutions(solved.segments);
  if (solved.coincident) {
    accum.diagnostics.push({ code: 'COINCIDENT_TARGET', stationSpan: [span.u0, span.u1] });
  }
  if (solved.beyondMax) {
    accum.diagnostics.push({ code: 'MAX_DISTANCE_REACHED', stationSpan: [span.u0, span.u1] });
  }
  mergeSpanNodes(accum.daylight, solved.nodes, ctx.spans, spanIndex, source, gs);
  accum.regions.push({ classification: span.region, stationSpan: [span.u0, span.u1] });
  return null;
};

/** Solve every station span in order (fail-closed on the first failure). */
type StationSpanResult =
  | { ok: true; accum: SpanAccum }
  | { ok: false; code: GradingDiagnosticCode; detail?: string };

export const solveStationSpans = (ctx: SpanSolveCtx): StationSpanResult => {
  const accum: SpanAccum = {
    diagnostics: [],
    regions: [],
    daylight: [],
    intersectionSegmentCount: 0,
    multipleSolutionCount: 0,
  };
  let spanFailed = false;
  let spanFailure: SpanFailure | null = null;
  ctx.spans.forEach((span, spanIndex) => {
    if (spanFailed) return;
    const failure = solveOneSpan(ctx, span, spanIndex, accum);
    if (failure) {
      spanFailure = failure;
      spanFailed = true;
    }
  });
  if (spanFailure) return spanFailure;
  return { ok: true, accum };
};
