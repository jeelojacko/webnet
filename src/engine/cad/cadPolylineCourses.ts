/**
 * Phase C2 — shared consumer resolver for PLINE per-course bulge + width
 * metadata. One place turns a persisted polyline into its true courses
 * (line vs arc, plus centred band width), reusing the core normalizer's
 * wrap law and the single parcel endpoint+bulge arc seam. Consumers
 * (renderer, snaps, intersections, bounds, properties, transforms, DXF)
 * must not re-derive course geometry on their own; they resolve here and
 * fail closed (null) on malformed metadata instead of silently
 * straightening an arc or dropping a width.
 */

import type { CadWorldPoint } from './cadGeometry';
import { cadPolylineVerticesWrapToFirst, cadPolylineWidthAtFraction, validateCadPolylineGeometryEntry } from './cadPolylineGeometry';
import {
  CAD_PARCEL_BULGE_LINE_FLOOR,
  describeParcelArcCourse,
  parcelArcBoundsPoints,
  type CadParcelArcMetrics,
} from './cadParcelArcGeometry';
import type {
  CadPolylineEntity,
  CadPolylineSegmentGeometry,
  CadPolylineSegmentWidth,
} from './cadTypes';

export const CAD_POLYLINE_ZERO_WIDTH: CadPolylineSegmentWidth = { startWidth: 0, endWidth: 0 };

export interface CadPolylineResolvedCourse {
  index: number;
  from: CadWorldPoint;
  to: CadWorldPoint;
  kind: 'line' | 'arc';
  geometry: CadPolylineSegmentGeometry;
  width: CadPolylineSegmentWidth;
  /** Present for arc courses only (from describeParcelArcCourse). */
  metrics: CadParcelArcMetrics | null;
}

/** Ring edge points with the closed last→first edge appended (stored ring
 *  never repeats its first vertex under the C2 normalizer). */
export const cadPolylineCourseEdgePoints = (entity: CadPolylineEntity): CadWorldPoint[] => {
  const wraps = cadPolylineVerticesWrapToFirst(entity.vertices, entity.closed === true);
  if (wraps && entity.vertices.length > 0) {
    return [...entity.vertices, entity.vertices[0]!];
  }
  return [...entity.vertices];
};

/** Canonical course kind: absent/sub-floor = line (shared machine floor). */
export const cadPolylineCourseKind = (
  entry: CadPolylineSegmentGeometry | undefined,
): 'line' | 'arc' => {
  if (entry?.kind !== 'arc') return 'line';
  if (!Number.isFinite(entry.bulge)) return 'arc';
  return Math.abs(entry.bulge) < CAD_PARCEL_BULGE_LINE_FLOOR ? 'line' : 'arc';
};

/** Width entries must carry finite, non-negative start/end values. Malformed
 *  numerics (NaN/Infinity/negative) fail the resolver closed exactly like a
 *  count mismatch so consumers never straighten a course or drop a width.
 *  Accepts `unknown` so the distortion guards can validate a runtime entry
 *  before dereferencing it. */
const cadPolylineWidthIsValid = (entry: unknown): boolean => {
  if (entry == null || typeof entry !== 'object') return false;
  const { startWidth, endWidth } = entry as CadPolylineSegmentWidth;
  return (
    Number.isFinite(startWidth) &&
    Number.isFinite(endWidth) &&
    startWidth >= 0 &&
    endWidth >= 0
  );
};

/**
 * True courses in traversal order. Returns null (fail closed) when the
 * metadata arrays do not match the course count or an arc does not derive
 * a valid curve — callers must never fall back to a chord or a dropped
 * width. Absent metadata resolves to all-line, zero-width courses.
 */
export const resolveCadPolylineCourses = (
  entity: CadPolylineEntity,
): CadPolylineResolvedCourse[] | null => {
  const points = cadPolylineCourseEdgePoints(entity);
  const edgeCount = points.length - 1;
  if (edgeCount < 1) return null;
  const geometry = entity.segmentGeometry;
  const widths = entity.segmentWidths;
  // Array.isArray guards: a malformed runtime value (e.g. {length:n}) must
  // fail closed instead of reaching `.length`/index reads that throw or
  // silently substitute a default. Dense arrays keep identical behavior.
  if (geometry != null && (!Array.isArray(geometry) || geometry.length !== edgeCount)) return null;
  if (widths != null) {
    if (!Array.isArray(widths) || widths.length !== edgeCount) return null;
    // Index iteration (NOT every): sparse holes must fail closed and never be
    // substituted with CAD_POLYLINE_ZERO_WIDTH.
    for (let index = 0; index < widths.length; index += 1) {
      if (!cadPolylineWidthIsValid(widths[index])) return null;
    }
  }
  const courses: CadPolylineResolvedCourse[] = [];
  for (let index = 0; index < edgeCount; index += 1) {
    const from = points[index]!;
    const to = points[index + 1]!;
    const entry = geometry?.[index];
    const width = widths?.[index] ?? CAD_POLYLINE_ZERO_WIDTH;
    // Fail closed on ANY malformed geometry entry (absent, unknown kind,
    // sub-floor/zero/non-finite bulge, degenerate chord, underivable arc)
    // instead of silently resolving it as a straight line. Absent metadata
    // (geometry == null) still resolves to all-line courses.
    if (geometry != null && validateCadPolylineGeometryEntry(index, entry, from, to) != null) {
      return null;
    }
    if (cadPolylineCourseKind(entry) === 'arc') {
      const metrics = describeParcelArcCourse(from, to, (entry as { bulge: number }).bulge);
      if (!metrics) return null;
      courses.push({ index, from, to, kind: 'arc', geometry: entry!, width, metrics });
    } else {
      courses.push({ index, from, to, kind: 'line', geometry: { kind: 'line' }, width, metrics: null });
    }
  }
  return courses;
};

/**
 * Phase C3 — the TRUE midpoint of one resolved course: a line's finite
 * midpoint, or the signed-sweep arc midpoint from `describeParcelArcCourse`
 * (which rides `cadArcMidpoint`, never the chord midpoint). Shared by the
 * insert grips and the Properties/command insert actions so all three
 * surfaces agree on the immediate insertion point.
 */
export const cadPolylineCourseMidpoint = (
  course: CadPolylineResolvedCourse,
): CadWorldPoint =>
  course.kind === 'arc' && course.metrics != null
    ? course.metrics.midpoint
    : { x: (course.from.x + course.to.x) / 2, y: (course.from.y + course.to.y) / 2 };

/** Course count the resolver actually accepts for an entity: the stored
 *  ring's edge count. A canonical closed ring wraps last→first (n edges); a
 *  legacy closed ring that repeats its first vertex keeps n-1 edges. This is
 *  the exact count `resolveCadPolylineCourses` pairs metadata against. */
const cadPolylineResolvedEdgeCount = (entity: CadPolylineEntity): number =>
  cadPolylineCourseEdgePoints(entity).length - 1;

/** True when a geometry entry is a canonical arc. A malformed entry (absent,
 *  non-object, or an unknown kind) fails closed as TRUE: the block distortion
 *  guard must take the omit-and-warn path rather than throw or silently treat
 *  an unknown course as a straight line. */
const cadPolylineGeometryEntryIsArc = (entry: unknown): boolean => {
  if (entry == null || typeof entry !== 'object') return true;
  const kind = (entry as { kind?: unknown }).kind;
  if (kind === 'arc') return true;
  if (kind === 'line') return false;
  return true;
};

/** True when any course is a canonical arc. Absent geometry = false
 *  (validation is the caller's responsibility). PRESENT geometry that is
 *  non-array, does not match the course count, or resolves to no course at
 *  all fails closed as TRUE so chord-only callers refuse exactly what the
 *  resolver rejects. A malformed entry (hole/non-object/unknown kind/arc)
 *  also fails closed as true via cadPolylineGeometryEntryIsArc. Index
 *  iteration (NOT `.some`) so a sparse hole is seen as a malformed entry,
 *  matching resolveCadPolylineCourses rejecting it rather than skipping it. */
export const cadPolylineHasArcCourse = (entity: CadPolylineEntity): boolean => {
  const geometry = entity.segmentGeometry;
  if (geometry == null) return false;
  const edgeCount = cadPolylineResolvedEdgeCount(entity);
  if (edgeCount < 1 || !Array.isArray(geometry) || geometry.length !== edgeCount) return true;
  for (let index = 0; index < geometry.length; index += 1) {
    if (cadPolylineGeometryEntryIsArc(geometry[index])) return true;
  }
  return false;
};

/** True when any course carries a nonzero centred band width. Absent widths
 *  = false (validation is the caller's responsibility). PRESENT widths that
 *  are non-array, do not match the course count, or resolve to no course at
 *  all fails closed as TRUE so chord-only callers refuse exactly what the
 *  resolver rejects. A malformed entry (null/non-object, non-finite or
 *  negative width) also fails closed as TRUE so the distortion guard
 *  omits-and-warns instead of throwing or reporting a false "hairline".
 *  Index iteration (NOT `.some`) so a sparse hole is seen as a malformed
 *  entry, matching resolveCadPolylineCourses rejecting it rather than
 *  skipping it. */
export const cadPolylineHasNonzeroWidth = (entity: CadPolylineEntity): boolean => {
  const widths = entity.segmentWidths;
  if (widths == null) return false;
  const edgeCount = cadPolylineResolvedEdgeCount(entity);
  if (edgeCount < 1 || !Array.isArray(widths) || widths.length !== edgeCount) return true;
  for (let index = 0; index < widths.length; index += 1) {
    const entry = widths[index];
    if (!cadPolylineWidthIsValid(entry)) return true;
    if (entry.startWidth !== 0 || entry.endWidth !== 0) return true;
  }
  return false;
};

/**
 * Phase C2 edit-safety guard: true when a polyline carries a true arc or a
 * nonzero band. Chord-based straight-only edit kernels (TRIM/EXTEND/FILLET)
 * must fail closed on these instead of treating the course as a hot/cold
 * chord or dropping the width.
 */
export const cadPolylineHasCurveOrWidth = (entity: CadPolylineEntity): boolean =>
  cadPolylineHasArcCourse(entity) || cadPolylineHasNonzeroWidth(entity);

const offsetRadially = (
  point: CadWorldPoint,
  center: CadWorldPoint,
  distance: number,
): CadWorldPoint[] => {
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  const length = Math.hypot(dx, dy);
  if (!(length > 1e-12)) return [];
  return [
    { x: point.x + (dx / length) * distance, y: point.y + (dy / length) * distance },
    { x: point.x - (dx / length) * distance, y: point.y - (dy / length) * distance },
  ];
};

/**
 * Phase C2 width envelope sample points: centreline endpoints + arc
 * in-sweep quadrant extrema, each offset by half the (tapered) band width
 * so the true drawn band, not the hairline centreline, drives bounds and
 * cursor-box culling. Legacy/zero-width polylines return the plain
 * centreline samples. Malformed metadata fails closed (empty list).
 */
export const cadPolylineWidthEnvelopePoints = (entity: CadPolylineEntity): CadWorldPoint[] => {
  const courses = resolveCadPolylineCourses(entity);
  if (!courses) return [];
  const points: CadWorldPoint[] = [];
  for (const course of courses) {
    const halfStart = course.width.startWidth / 2;
    const halfEnd = course.width.endWidth / 2;
    const half = Math.max(halfStart, halfEnd);
    if (course.kind === 'line') {
      points.push(course.from, course.to);
      if (half > 0) {
        const dx = course.to.x - course.from.x;
        const dy = course.to.y - course.from.y;
        const length = Math.hypot(dx, dy);
        if (length > 1e-12) {
          const nx = -dy / length;
          const ny = dx / length;
          points.push(
            { x: course.from.x + nx * halfStart, y: course.from.y + ny * halfStart },
            { x: course.from.x - nx * halfStart, y: course.from.y - ny * halfStart },
            { x: course.to.x + nx * halfEnd, y: course.to.y + ny * halfEnd },
            { x: course.to.x - nx * halfEnd, y: course.to.y - ny * halfEnd },
          );
        }
      }
      continue;
    }
    const metrics = course.metrics!;
    const bulge = (course.geometry as { bulge: number }).bulge;
    const samples = parcelArcBoundsPoints(course.from, course.to, bulge);
    points.push(...samples);
    if (half > 0) {
      samples.forEach((point) => {
        points.push(...offsetRadially(point, metrics.center, half));
      });
    }
  }
  return points;
};

/** Largest half band width across a polyline's courses (0 = hairline).
 *  Non-array metadata fails closed as 0 instead of throwing on a `.reduce`.
 *  A malformed entry has no safe numeric width, so it returns NaN: any
 *  consumer guarding on a finite max-half-width then fails closed and omits
 *  rather than exporting a plausible-but-wrong band value. */
export const cadPolylineMaxHalfWidth = (entity: CadPolylineEntity): number => {
  const widths = entity.segmentWidths;
  if (widths == null || !Array.isArray(widths)) return 0;
  let max = 0;
  for (const entry of widths) {
    if (!cadPolylineWidthIsValid(entry)) return Number.NaN;
    max = Math.max(max, entry.startWidth / 2, entry.endWidth / 2);
  }
  return max;
};

interface BandSample {
  point: CadWorldPoint;
  normal: CadWorldPoint;
  halfWidth: number;
}

const sampleArcBand = (
  course: CadPolylineResolvedCourse,
  intervals: number,
): BandSample[] => {
  const metrics = course.metrics!;
  const sweepRad = (metrics.signedSweepDeg * Math.PI) / 180;
  const steps = Math.max(1, Math.floor(intervals));
  const samples: BandSample[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const angleDeg = metrics.startAngleDeg + metrics.signedSweepDeg * t;
    const angleRad = (angleDeg * Math.PI) / 180;
    const point = {
      x: metrics.center.x + metrics.radius * Math.cos(angleRad),
      y: metrics.center.y + metrics.radius * Math.sin(angleRad),
    };
    // Radial normal at this sample, signed to the travel direction: a CCW
    // (positive-sweep) course keeps the centre on its left (-radial), a CW
    // course on its right (+radial). Never the tangent — a tangent offset
    // would slide the band along the arc instead of widening it.
    const sideSign = sweepRad >= 0 ? -1 : 1;
    const normal = {
      x: Math.cos(angleRad) * sideSign,
      y: Math.sin(angleRad) * sideSign,
    };
    samples.push({
      point,
      normal,
      halfWidth: cadPolylineWidthAtFraction(course.width, t)! / 2,
    });
  }
  return samples;
};

const sampleLineBand = (course: CadPolylineResolvedCourse): BandSample[] => {
  const dx = course.to.x - course.from.x;
  const dy = course.to.y - course.from.y;
  const length = Math.hypot(dx, dy);
  const normal = length > 1e-12 ? { x: -dy / length, y: dx / length } : { x: 0, y: 0 };
  return [
    { point: course.from, normal, halfWidth: course.width.startWidth / 2 },
    { point: course.to, normal, halfWidth: course.width.endWidth / 2 },
  ];
};

/** Natural arc tessellation intervals for a sweep (6° per step, 2..max). */
const arcIntervalCount = (signedSweepDeg: number, maxArcSamples: number): number =>
  Math.min(maxArcSamples, Math.max(2, Math.ceil(Math.abs(signedSweepDeg) / 6)));

/**
 * Per-course arc tessellation intervals bounded so the assembled outline
 * (both sides) never exceeds maxTotalPoints. Lines keep their exact two
 * endpoints and are never reduced or sliced; arcs give back intervals
 * uniformly only when the natural tessellation would overflow. When even
 * the two-sample-per-course minimum overflows, the full outline is returned
 * rather than a truncated polygon — the ceiling is a soft budget, never a
 * cut.
 */
const allocateArcIntervals = (
  courses: CadPolylineResolvedCourse[],
  maxArcSamples: number,
  maxTotalPoints: number,
): number[] => {
  const intervals = courses.map((course) =>
    course.kind === 'arc' ? arcIntervalCount(course.metrics!.signedSweepDeg, maxArcSamples) : 0,
  );
  const minimumSamples = 2 * courses.length;
  const perSideBudget = Math.max(minimumSamples, Math.floor(maxTotalPoints / 2));
  const sampleTotal = (values: number[]): number =>
    courses.reduce(
      (sum, course, index) => sum + (course.kind === 'arc' ? values[index]! + 1 : 2),
      0,
    );
  if (sampleTotal(intervals) <= perSideBudget) return intervals;
  const requestedExtra = courses.reduce(
    (sum, course, index) => sum + (course.kind === 'arc' ? intervals[index]! - 1 : 0),
    0,
  );
  const allowedExtra = Math.max(0, perSideBudget - minimumSamples);
  if (requestedExtra <= allowedExtra) return intervals;
  const ratio = allowedExtra / requestedExtra;
  const reduced = intervals.map((value) =>
    value > 0 ? Math.max(1, 1 + Math.floor((value - 1) * ratio)) : 0,
  );
  while (sampleTotal(reduced) > perSideBudget) {
    let widest = -1;
    for (let index = 0; index < reduced.length; index += 1) {
      if (reduced[index]! > 1 && (widest < 0 || reduced[index]! > reduced[widest]!)) widest = index;
    }
    if (widest < 0) break;
    reduced[widest] -= 1;
  }
  return reduced;
};

/**
 * Phase C2: aggregated width-band outline (model space) for one polyline.
 * Returns null on malformed metadata (fail closed) and [] when every course
 * is zero-width (no band; the centreline path is used verbatim). Arc
 * courses are tessellated under a per-course budget so the assembled
 * outline (both sides) is bounded WITHOUT ever slicing the polygon, and the
 * width is interpolated via cadPolylineWidthAtFraction so the band follows
 * the true centreline radially. The result is ONE closed polygon shared by
 * viewport and SVG/PDF.
 */
export const buildCadPolylineBandPoints = (
  entity: CadPolylineEntity,
  options?: { maxArcSamples?: number; maxTotalPoints?: number },
): CadWorldPoint[] | null => {
  const courses = resolveCadPolylineCourses(entity);
  if (!courses) return null;
  if (!courses.some((course) => course.width.startWidth !== 0 || course.width.endWidth !== 0)) {
    return [];
  }
  const maxArcSamples = Math.max(2, options?.maxArcSamples ?? 64);
  const maxTotalPoints = Math.max(16, options?.maxTotalPoints ?? 2048);
  const arcIntervals = allocateArcIntervals(courses, maxArcSamples, maxTotalPoints);
  const left: CadWorldPoint[] = [];
  const right: CadWorldPoint[] = [];
  for (let index = 0; index < courses.length; index += 1) {
    const course = courses[index]!;
    const samples =
      course.kind === 'arc' ? sampleArcBand(course, arcIntervals[index]!) : sampleLineBand(course);
    for (const sample of samples) {
      left.push({
        x: sample.point.x + sample.normal.x * sample.halfWidth,
        y: sample.point.y + sample.normal.y * sample.halfWidth,
      });
      right.push({
        x: sample.point.x - sample.normal.x * sample.halfWidth,
        y: sample.point.y - sample.normal.y * sample.halfWidth,
      });
    }
  }
  if (left.length < 2) return [];
  return [...left, ...[...right].reverse()];
};
