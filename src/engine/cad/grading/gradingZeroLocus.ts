/**
 * Phase 20B — analytic zero-locus extraction and nearest-outward envelope.
 *
 * Operates on numbers only (clipped `(u, d)` polygons with per-vertex delta
 * and bare zero segments). No imports from sibling grading modules; all zero
 * classification uses the shared Phase 18I `zeroDelta` policy.
 */
import { zeroDelta } from '../surfaces/volume/zero';

/** A clipped polygon vertex carrying the target-minus-grading delta at that vertex. */
export interface GradingPolygonVertex {
  u: number;
  d: number;
  delta: number;
}

/** One analytic piece of the null locus, in the local (u, d) frame. */
export interface ZeroSegment {
  u0: number;
  d0: number;
  u1: number;
  d1: number;
}

export interface ZeroLocus {
  segments: ZeroSegment[];
  /** True when the whole polygon is zeroDelta-coincident over nonzero area. */
  coincident: boolean;
}

/** A node of the nearest-positive lower envelope d(u). */
export interface EnvelopePoint {
  u: number;
  d: number;
}

export type EnvelopeFailureCode = 'BRANCH_DISCONTINUITY' | 'NO_SOLUTION';

export type EnvelopeResult =
  | { ok: true; polyline: EnvelopePoint[] }
  | { ok: false; code: EnvelopeFailureCode };

const isZeroScalar = (value: number): boolean =>
  Math.abs(value) <= zeroDelta(value, 0);

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

const samePoint = (aU: number, aD: number, bU: number, bD: number): boolean =>
  Math.abs(aU - bU) <= zeroDelta(aU, bU) &&
  Math.abs(aD - bD) <= zeroDelta(aD, bD);

const planarArea2 = (polygon: GradingPolygonVertex[]): number => {
  let sum = 0;
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    sum += a.u * b.d - b.u * a.d;
  }
  return sum;
};

/** Lexicographically smaller endpoint first, so a segment has one canonical form. */
const canonicalSegment = (s: ZeroSegment): ZeroSegment =>
  s.u0 < s.u1 || (s.u0 === s.u1 && s.d0 <= s.d1)
    ? { u0: s.u0, d0: s.d0, u1: s.u1, d1: s.d1 }
    : { u0: s.u1, d0: s.d1, u1: s.u0, d1: s.d0 };

const segmentOrder = (a: ZeroSegment, b: ZeroSegment): number =>
  a.u0 - b.u0 || a.d0 - b.d0 || a.u1 - b.u1 || a.d1 - b.d1;

const dedupePoints = (points: EnvelopePoint[], closed: boolean): EnvelopePoint[] => {
  const out: EnvelopePoint[] = [];
  for (const p of points) {
    const prev = out[out.length - 1];
    if (!prev || !samePoint(p.u, p.d, prev.u, prev.d)) out.push(p);
  }
  if (closed && out.length > 1) {
    const first = out[0];
    const last = out[out.length - 1];
    if (samePoint(first.u, first.d, last.u, last.d)) out.pop();
  }
  return out;
};

const dedupeSegments = (segments: ZeroSegment[]): ZeroSegment[] => {
  const out: ZeroSegment[] = [];
  for (const s of segments) {
    const duplicate = out.some(
      (kept) =>
        samePoint(kept.u0, kept.d0, s.u0, s.d0) &&
        samePoint(kept.u1, kept.d1, s.u1, s.d1),
    );
    if (!duplicate) out.push(s);
  }
  return out;
};

/** Boundary zero of one polygon edge: an exact vertex hit or a linear crossing. */
const edgeZero = (
  a: GradingPolygonVertex,
  b: GradingPolygonVertex,
): EnvelopePoint | null => {
  const az = isZeroScalar(a.delta);
  const bz = isZeroScalar(b.delta);
  if (az) return { u: a.u, d: a.d };
  if (bz) return { u: b.u, d: b.d };
  if ((a.delta > 0) === (b.delta > 0)) return null;
  const t = a.delta / (a.delta - b.delta);
  return { u: lerp(a.u, b.u, t), d: lerp(a.d, b.d, t) };
};

/**
 * Analytic zero locus of a per-vertex-delta polygon. Affine delta yields the
 * exact chord; coincident edges are emitted directly. Linear edge
 * interpolation t = deltaA / (deltaA − deltaB). Output is canonical and
 * sorted; duplicates (zeroDelta-exact) are removed.
 */
export const extractZeroSegments = (
  polygon: GradingPolygonVertex[],
  closed = true,
): ZeroLocus => {
  const n = polygon.length;
  if (n < 2) return { segments: [], coincident: false };
  const allZero = polygon.every((vertex) => isZeroScalar(vertex.delta));
  if (closed && allZero && !isZeroScalar(planarArea2(polygon))) {
    return { segments: [], coincident: true };
  }
  const edgeCount = closed ? n : n - 1;
  const segments: ZeroSegment[] = [];
  const points: EnvelopePoint[] = [];
  const coincidentPoints: EnvelopePoint[] = [];
  for (let i = 0; i < edgeCount; i += 1) {
    const a = polygon[i];
    const b = polygon[(i + 1) % n];
    if (isZeroScalar(a.delta) && isZeroScalar(b.delta)) {
      segments.push(canonicalSegment({ u0: a.u, d0: a.d, u1: b.u, d1: b.d }));
      coincidentPoints.push({ u: a.u, d: a.d }, { u: b.u, d: b.d });
      continue;
    }
    const point = edgeZero(a, b);
    if (point) points.push(point);
  }
  const kept = dedupePoints(points, closed).filter(
    (p) => !coincidentPoints.some((c) => samePoint(p.u, p.d, c.u, c.d)),
  );
  for (let i = 0; i + 1 < kept.length; i += 2) {
    const a = kept[i];
    const b = kept[i + 1];
    if (!samePoint(a.u, a.d, b.u, b.d)) {
      segments.push(canonicalSegment({ u0: a.u, d0: a.d, u1: b.u, d1: b.d }));
    }
  }
  return { segments: dedupeSegments(segments).sort(segmentOrder), coincident: false };
};

interface StripSeg {
  u0: number;
  d0: number;
  u1: number;
  d1: number;
}

const segLo = (s: StripSeg): number => Math.min(s.u0, s.u1);
const segHi = (s: StripSeg): number => Math.max(s.u0, s.u1);
const isVertical = (s: StripSeg): boolean => isZeroScalar(s.u1 - s.u0);

const coversStation = (s: StripSeg, u: number): boolean =>
  u >= segLo(s) - zeroDelta(u, segLo(s)) && u <= segHi(s) + zeroDelta(u, segHi(s));

/** d(u) on a segment; a vertical segment contributes its nearest endpoint distance. */
const segDistanceAt = (s: StripSeg, u: number): number => {
  const du = s.u1 - s.u0;
  if (isZeroScalar(du)) return Math.min(s.d0, s.d1);
  return s.d0 + (s.d1 - s.d0) * ((u - s.u0) / du);
};

const normalizeSegment = (s: ZeroSegment): StripSeg =>
  s.u0 <= s.u1 ? { ...s } : { u0: s.u1, d0: s.d1, u1: s.u0, d1: s.d0 };

/** Keep a segment only when its nearest end lies within the search limit. */
const withinSearch = (s: StripSeg, maxSearchDistance: number): boolean => {
  const nearest = Math.min(s.d0, s.d1);
  return nearest <= maxSearchDistance + zeroDelta(nearest, maxSearchDistance);
};

const crossingStation = (a: StripSeg, b: StripSeg): number | null => {
  if (isVertical(a) || isVertical(b)) return null;
  const slopeA = (a.d1 - a.d0) / (a.u1 - a.u0);
  const slopeB = (b.d1 - b.d0) / (b.u1 - b.u0);
  const denom = slopeA - slopeB;
  if (isZeroScalar(denom)) return null;
  const u = (slopeA * a.u0 - a.d0 - slopeB * b.u0 + b.d0) / denom;
  return coversStation(a, u) && coversStation(b, u) ? u : null;
};

/** All segment endpoints plus every pairwise crossover, sorted and deduped. */
const collectEvents = (segs: StripSeg[]): number[] => {
  const raw: number[] = [];
  for (const s of segs) raw.push(s.u0, s.u1);
  for (let i = 0; i < segs.length; i += 1) {
    for (let j = i + 1; j < segs.length; j += 1) {
      const u = crossingStation(segs[i], segs[j]);
      if (u !== null) raw.push(u);
    }
  }
  raw.sort((a, b) => a - b);
  const out: number[] = [];
  for (const u of raw) {
    const prev = out[out.length - 1];
    if (prev === undefined || Math.abs(u - prev) > zeroDelta(u, prev)) out.push(u);
  }
  return out;
};

const nearestDistanceAt = (segs: StripSeg[], u: number): number | null => {
  let best: number | null = null;
  for (const s of segs) {
    if (!coversStation(s, u)) continue;
    const d = segDistanceAt(s, u);
    if (best === null || d < best) best = d;
  }
  return best;
};

/** True when one zero segment carries the envelope across the whole [a, b] span. */
const intervalConnected = (
  segs: StripSeg[],
  a: EnvelopePoint,
  b: EnvelopePoint,
): boolean =>
  segs.some(
    (s) =>
      coversStation(s, a.u) &&
      coversStation(s, b.u) &&
      isZeroScalar(segDistanceAt(s, a.u) - a.d) &&
      isZeroScalar(segDistanceAt(s, b.u) - b.d),
  );

/**
 * Nearest-positive lower envelope over station u.
 *
 * Segments are sorted, sampled at every endpoint/crossover, and reduced to the
 * minimum valid distance at each station. Overlapping-u conflicts keep the
 * minimum d. Any break in a single covering branch (u-gap or d-jump beyond
 * conditioning) fails closed with `BRANCH_DISCONTINUITY`; no usable branch at
 * all fails with `NO_SOLUTION`.
 */
export const buildNearestEnvelope = (
  segments: ZeroSegment[],
  maxSearchDistance: number,
): EnvelopeResult => {
  const segs = segments
    .map(normalizeSegment)
    .filter((s) => withinSearch(s, maxSearchDistance))
    .sort(segmentOrder);
  if (segs.length === 0) return { ok: false, code: 'NO_SOLUTION' };
  const polyline: EnvelopePoint[] = [];
  for (const u of collectEvents(segs)) {
    const d = nearestDistanceAt(segs, u);
    if (d === null) return { ok: false, code: 'BRANCH_DISCONTINUITY' };
    if (d > maxSearchDistance && d - maxSearchDistance > zeroDelta(d, maxSearchDistance)) {
      return { ok: false, code: 'NO_SOLUTION' };
    }
    polyline.push({ u, d });
  }
  if (polyline.length < 2) return { ok: false, code: 'NO_SOLUTION' };
  for (let i = 0; i + 1 < polyline.length; i += 1) {
    if (!intervalConnected(segs, polyline[i], polyline[i + 1])) {
      return { ok: false, code: 'BRANCH_DISCONTINUITY' };
    }
  }
  return { ok: true, polyline };
};
