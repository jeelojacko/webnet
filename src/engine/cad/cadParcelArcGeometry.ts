// Phase 19C Round 1 — mixed line/arc parcel course geometry (engine core).
//
// ONE endpoint+bulge → arc-metrics seam feeding the generalized resolver,
// exact area/perimeter, bounds, persistence, and oracles. No duplicates:
// sweep/midpoint/containment reuse cadSignedSweepDeg/cadArcMidpoint/
// cadIsAngleOnArcSweep; chord inverse reuses buildCadInverseSummary;
// intersections reuse cadGeometryCurveIntersections.

import {
  cadAngleDegFromCenter,
  cadDistance,
  cadIsAngleOnArcSweep,
  cadNormalizeAngleDeg,
  cadPointOnCircle,
  cadSegmentIntersection,
  cadSignedSweepDeg,
  type CadWorldPoint,
} from './cadGeometry';
import { cadArcMidpoint } from './cadGeometryArcPrimitives';
import {
  cadIntersectArcArc,
  cadIntersectSegmentArc,
} from './cadGeometryCurveIntersections';
import { buildCadInverseSummary, formatCadBearing } from './cadCogoSummaries';
import type { CadParcelCourseGeometry } from './cadTypes';

export interface CadParcelArcMetrics {
  center: CadWorldPoint;
  radius: number;
  /** Traversal-signed sweep in degrees: positive = CCW = center-left. */
  signedSweepDeg: number;
  /** |sweep| in degrees (0, 360). */
  deltaDeg: number;
  direction: 'left' | 'right';
  arcLength: number;
  chordLength: number;
  chordAzimuthDeg: number;
  chordBearing: string;
  startAngleDeg: number;
  endAngleDeg: number;
  /** TRUE curve midpoint (never the chord midpoint). */
  midpoint: CadWorldPoint;
  startTangentAzimuthDeg: number;
  startTangentBearing: string;
  endTangentAzimuthDeg: number;
  endTangentBearing: string;
}

// ---------------------------------------------------------------------------
// Machine-conditioning constants (NOT survey tolerances, NOT topology).
// ---------------------------------------------------------------------------

/**
 * |bulge| below this floor canonicalizes to LINE. Explicit machine floor
 * (float-noise scale), never a survey-distance tolerance: callers must
 * declare straight courses as {kind:'line'} — an exact bulge of 0 on an
 * arc entry is a modeling error and validates ZERO_BULGE_ARC.
 */
export const CAD_PARCEL_BULGE_LINE_FLOOR = 1e-12;

/** Chord at/below this length cannot carry an arc (matches isSameVertex). */
export const CAD_PARCEL_ARC_ZERO_CHORD_TOLERANCE = 1e-9;

/**
 * |sweep| at/above this is a ~360° (full-circle) definition: BLOCKED —
 * identical start/end cannot address a circle in a vertex ring (use ≥2
 * arc courses). Finite bulges asymptote to 360° from below, so only
 * pathological magnitudes trip this.
 */
export const CAD_PARCEL_ARC_FULL_CIRCLE_SWEEP_DEG = 360 - 1e-6;

/**
 * Tangent-continuity decision band (machine-conditioning scale on
 * atan2-derived bearings, NOT a survey tolerance): exact tangent
 * constructions agree to ~1e-11 deg; anything above the band is genuinely
 * kinked. Reports TANGENT/NON-TANGENT, never a visual guess.
 */
export const CAD_PARCEL_ARC_TANGENT_TOLERANCE_DEG = 1e-6;

/**
 * Signed angular offset from `startAngleDeg`, carrying the traversal sign
 * (positive = CCW). Shared by containment and split so arc sub-span math has
 * ONE definition.
 */
export const parcelSweepOffsetDeg = (
  startAngleDeg: number,
  angleDeg: number,
  signedSweepDeg: number,
): number => {
  const normalize360 = (value: number): number => {
    const wrapped = value % 360;
    return wrapped < 0 ? wrapped + 360 : wrapped;
  };
  return signedSweepDeg >= 0
    ? normalize360(angleDeg - startAngleDeg)
    : -normalize360(startAngleDeg - angleDeg);
};

/** Canonical kind: absent entry = line; sub-floor |bulge| = line. */
export const parcelCourseCanonicalKind = (
  geometry: CadParcelCourseGeometry | undefined,
): 'line' | 'arc' => {
  if (geometry?.kind !== 'arc') return 'line';
  if (!Number.isFinite(geometry.bulge)) return 'arc';
  return Math.abs(geometry.bulge) < CAD_PARCEL_BULGE_LINE_FLOOR ? 'line' : 'arc';
};

const tangentAzimuthDeg = (radialAngleDeg: number, counterClockwise: boolean): number =>
  cadNormalizeAngleDeg(counterClockwise ? -radialAngleDeg : 180 - radialAngleDeg);

/**
 * Endpoint A/B + signed bulge → exact arc metrics.
 * b = tan(sweepRad/4), sign = direction. Center sits left of A→B for
 * b > 0 (CCW) by h = chord·(1−b²)/(4b) along the left normal; 180°
 * (|b| = 1) gives h = 0, so the center is the chord midpoint and the
 * sweep sign alone selects the side — deterministic from the sign.
 * Returns null on degenerate input (never throws, never guesses).
 */
export const describeParcelArcCourse = (
  from: CadWorldPoint,
  to: CadWorldPoint,
  bulge: number,
): CadParcelArcMetrics | null => {
  if (![from.x, from.y, to.x, to.y, bulge].every(Number.isFinite)) return null;
  const chordLength = cadDistance(from, to);
  if (!(chordLength > CAD_PARCEL_ARC_ZERO_CHORD_TOLERANCE)) return null;
  if (Math.abs(bulge) < CAD_PARCEL_BULGE_LINE_FLOOR) return null;
  const sweepRad = 4 * Math.atan(bulge);
  const signedSweepDeg = (sweepRad * 180) / Math.PI;
  if (!(Math.abs(signedSweepDeg) > 0) || Math.abs(signedSweepDeg) >= CAD_PARCEL_ARC_FULL_CIRCLE_SWEEP_DEG) {
    return null;
  }
  const halfSweepRad = sweepRad / 2;
  const sinHalf = Math.sin(halfSweepRad);
  if (!(Math.abs(sinHalf) > 1e-12)) return null;
  const radius = Math.abs(chordLength / (2 * sinHalf));
  if (!(radius > 0) || !Number.isFinite(radius)) return null;
  // Center: chord midpoint offset along the left normal of A→B.
  const midX = (from.x + to.x) / 2;
  const midY = (from.y + to.y) / 2;
  const leftNormalX = -(to.y - from.y) / chordLength;
  const leftNormalY = (to.x - from.x) / chordLength;
  const offset = (chordLength * (1 - bulge * bulge)) / (4 * bulge);
  const center = { x: midX + leftNormalX * offset, y: midY + leftNormalY * offset };
  if (!Number.isFinite(center.x) || !Number.isFinite(center.y)) return null;
  const counterClockwise = sweepRad > 0;
  const startAngleDeg = cadAngleDegFromCenter(center, from);
  // Unnormalized end angle preserves major sweeps exactly for midpoint
  // and sweep-containment (cadSignedSweepDeg handles ±360 range).
  const endAngleDeg = startAngleDeg + signedSweepDeg;
  const midpoint = cadArcMidpoint(center, radius, startAngleDeg, endAngleDeg);
  const inverse = buildCadInverseSummary(from, to);
  const startTangentAzimuthDeg = tangentAzimuthDeg(startAngleDeg, counterClockwise);
  const endTangentAzimuthDeg = tangentAzimuthDeg(
    cadNormalizeAngleDeg(endAngleDeg),
    counterClockwise,
  );
  return {
    center,
    radius,
    signedSweepDeg,
    deltaDeg: Math.abs(signedSweepDeg),
    direction: counterClockwise ? 'left' : 'right',
    arcLength: Math.abs(sweepRad) * radius,
    chordLength,
    chordAzimuthDeg: inverse.azimuthDeg,
    chordBearing: inverse.bearing,
    startAngleDeg,
    endAngleDeg,
    midpoint,
    startTangentAzimuthDeg,
    startTangentBearing: formatCadBearing(startTangentAzimuthDeg),
    endTangentAzimuthDeg,
    endTangentBearing: formatCadBearing(endTangentAzimuthDeg),
  };
};

/**
 * Arc-definition → bulge (exact inverse of describeParcelArcCourse:
 * b = tan(sweepRad/4)). Null unless both endpoints ride the circle at
 * the stated radius and the sweep is a valid non-full-circle value.
 */
/**
 * Exact sub-arc geometry between two points that both ride the parent arc,
 * preserving traversal sign (endpoints may be the parent endpoints or any
 * on-arc split points). Null when either point is off-circle / degenerate.
 * ONE sub-arc seam for split and swing kernels.
 */
export const parcelSubArcGeometry = (
  arc: CadParcelArcMetrics,
  from: CadWorldPoint,
  to: CadWorldPoint,
): CadParcelCourseGeometry | null => {
  const fromOffset = parcelSweepOffsetDeg(
    arc.startAngleDeg,
    cadAngleDegFromCenter(arc.center, from),
    arc.signedSweepDeg,
  );
  const toOffset = parcelSweepOffsetDeg(
    arc.startAngleDeg,
    cadAngleDegFromCenter(arc.center, to),
    arc.signedSweepDeg,
  );
  const subSweepDeg = toOffset - fromOffset;
  if (!(Math.abs(subSweepDeg) > 0) || Math.abs(subSweepDeg) >= CAD_PARCEL_ARC_FULL_CIRCLE_SWEEP_DEG) {
    return null;
  }
  const bulge = parcelBulgeFromArcDefinition({
    from,
    to,
    center: arc.center,
    radius: arc.radius,
    signedSweepDeg: subSweepDeg,
  });
  return bulge == null ? null : { kind: 'arc', bulge };
};

export const parcelBulgeFromArcDefinition = ({
  from,
  to,
  center,
  radius,
  signedSweepDeg,
}: {
  from: CadWorldPoint;
  to: CadWorldPoint;
  center: CadWorldPoint;
  radius: number;
  signedSweepDeg: number;
}): number | null => {
  if (![from.x, from.y, to.x, to.y, center.x, center.y, radius, signedSweepDeg].every(Number.isFinite)) {
    return null;
  }
  if (!(radius > 0)) return null;
  if (!(Math.abs(signedSweepDeg) > 0) || Math.abs(signedSweepDeg) >= CAD_PARCEL_ARC_FULL_CIRCLE_SWEEP_DEG) {
    return null;
  }
  const chordLength = cadDistance(from, to);
  if (!(chordLength > CAD_PARCEL_ARC_ZERO_CHORD_TOLERANCE)) return null;
  const tolerance = Math.max(1e-9, radius * 1e-9);
  if (Math.abs(cadDistance(center, from) - radius) > tolerance) return null;
  if (Math.abs(cadDistance(center, to) - radius) > tolerance) return null;
  return Math.tan(((signedSweepDeg * Math.PI) / 180) / 4);
};

// ---------------------------------------------------------------------------
// Validation (fail safe — never silent line conversion).
// ---------------------------------------------------------------------------

export interface ParcelCourseGeometryIssue {
  courseIndex: number;
  code:
    | 'COURSE_GEOMETRY_LENGTH_MISMATCH'
    | 'NON_FINITE_BULGE'
    | 'ZERO_BULGE_ARC'
    | 'ZERO_CHORD_ARC'
    | 'SWEEP_NEAR_FULL_CIRCLE'
    | 'NON_FINITE_ARC_CENTER'
    | 'NON_POSITIVE_ARC_RADIUS'
    | 'NON_FINITE_VERTEX';
  message: string;
}

const issue = (
  courseIndex: number,
  code: ParcelCourseGeometryIssue['code'],
  message: string,
): ParcelCourseGeometryIssue => ({ courseIndex, code, message });

/**
 * Structural + numeric validation of courseGeometry against vertices.
 * Absent geometry = all-line legacy (valid). Present geometry must match
 * vertices.length exactly; every arc entry must be finite, non-zero-bulge,
 * non-zero-chord, non-full-circle, with finite center and positive radius.
 * Sub-floor nonzero bulge is NOT an issue (canonical line per the floor
 * const). Check issues in order; ok = issues empty.
 */
export const validateParcelCourseGeometry = (
  vertices: readonly CadWorldPoint[],
  courseGeometry: readonly CadParcelCourseGeometry[] | undefined,
): { ok: boolean; issues: ParcelCourseGeometryIssue[] } => {
  if (courseGeometry == null) return { ok: true, issues: [] };
  if (!Array.isArray(courseGeometry) || courseGeometry.length !== vertices.length) {
    return {
      ok: false,
      issues: [
        issue(
          -1,
          'COURSE_GEOMETRY_LENGTH_MISMATCH',
          `courseGeometry.length ${Array.isArray(courseGeometry) ? courseGeometry.length : 'n/a'} !== vertices.length ${vertices.length}`,
        ),
      ],
    };
  }
  const issues: ParcelCourseGeometryIssue[] = [];
  courseGeometry.forEach((entry, courseIndex) => {
    const from = vertices[courseIndex]!;
    const to = vertices[(courseIndex + 1) % vertices.length]!;
    if (![from?.x, from?.y, to?.x, to?.y].every(Number.isFinite)) {
      issues.push(issue(courseIndex, 'NON_FINITE_VERTEX', `course ${courseIndex} has a non-finite endpoint`));
      return;
    }
    if (entry?.kind !== 'arc') return;
    if (!Number.isFinite(entry.bulge)) {
      issues.push(issue(courseIndex, 'NON_FINITE_BULGE', `course ${courseIndex} has a non-finite bulge`));
      return;
    }
    if (entry.bulge === 0) {
      issues.push(
        issue(courseIndex, 'ZERO_BULGE_ARC', `course ${courseIndex} declares arc with zero bulge (declare line instead)`),
      );
      return;
    }
    // Sub-floor nonzero bulge canonicalizes to LINE (machine floor) — valid.
    if (Math.abs(entry.bulge) < CAD_PARCEL_BULGE_LINE_FLOOR) return;
    if (!(cadDistance(from, to) > CAD_PARCEL_ARC_ZERO_CHORD_TOLERANCE)) {
      issues.push(
        issue(
          courseIndex,
          'ZERO_CHORD_ARC',
          `course ${courseIndex} declares arc on coincident endpoints (full-circle single course blocked: use >=2 arc courses)`,
        ),
      );
      return;
    }
    const sweepDeg = (4 * Math.atan(entry.bulge) * 180) / Math.PI;
    if (Math.abs(sweepDeg) >= CAD_PARCEL_ARC_FULL_CIRCLE_SWEEP_DEG) {
      issues.push(
        issue(courseIndex, 'SWEEP_NEAR_FULL_CIRCLE', `course ${courseIndex} sweep ~360deg is blocked`),
      );
      return;
    }
    const metrics = describeParcelArcCourse(from, to, entry.bulge);
    if (!metrics) {
      issues.push(issue(courseIndex, 'NON_POSITIVE_ARC_RADIUS', `course ${courseIndex} derives no valid arc`));
      return;
    }
    if (!Number.isFinite(metrics.center.x) || !Number.isFinite(metrics.center.y)) {
      issues.push(issue(courseIndex, 'NON_FINITE_ARC_CENTER', `course ${courseIndex} derives a non-finite center`));
    }
    if (!(metrics.radius > 0) || !Number.isFinite(metrics.radius)) {
      issues.push(issue(courseIndex, 'NON_POSITIVE_ARC_RADIUS', `course ${courseIndex} derives a non-positive radius`));
    }
  });
  return { ok: issues.length === 0, issues };
};

// ---------------------------------------------------------------------------
// Boundary topology: self-intersection block (line×line, line×arc,
// arc×arc). Tangent-touch policy: ANY touch between non-adjacent courses
// — including a single tangent point — is a self-intersection (BLOCKED).
// Adjacent courses share exactly one vertex; intersections within 1e-9 of
// that shared vertex are the join itself, anything else is a defect.
// ---------------------------------------------------------------------------

export interface ParcelBoundaryTopologyIssue {
  courseIndex: number;
  otherCourseIndex: number;
  code: 'SELF_INTERSECTION' | 'INVALID_COURSE_GEOMETRY';
  message: string;
}

export interface CadParcelTopologyCourse {
  from: CadWorldPoint;
  to: CadWorldPoint;
  arc: CadParcelArcMetrics | null;
  /** Raw vertex index in the caller's array (geometry entries address raw indices). */
  rawIndex: number;
  /** Canonical geometry for this course (line when absent/all-line). */
  geometry: CadParcelCourseGeometry;
  /** Ring position (0..n-1), always the array index in the returned list. */
  position: number;
}

/**
 * Authoritative ring + per-course topology seam: sanitizes the vertex ring
 * (adjacent dups + explicit close, same rule as summaries/resolver) and
 * resolves each course to line or arc metrics. Returns null on invalid
 * geometry or fewer than 3 ring vertices (fail closed). Reused by boundary
 * validation, containment, and the split kernels — ONE ring/math seam.
 */
export const buildParcelCourseTopology = (
  vertices: readonly CadWorldPoint[],
  courseGeometry: readonly CadParcelCourseGeometry[] | undefined,
): CadParcelTopologyCourse[] | null => {
  const validation = validateParcelCourseGeometry(vertices, courseGeometry);
  if (!validation.ok) return null;
  if (vertices.length < 3) return null;
  // Ring sanitize mirrors the course resolver: drop adjacent dups, drop
  // the explicit-close dup; courses index the surviving ring.
  const ring: CadWorldPoint[] = [];
  const rawIndex: number[] = [];
  vertices.forEach((vertex, index) => {
    const previous = ring[ring.length - 1];
    if (previous && cadDistance(previous, vertex) <= CAD_PARCEL_ARC_ZERO_CHORD_TOLERANCE) return;
    ring.push(vertex);
    rawIndex.push(index);
  });
  if (ring.length >= 3 && cadDistance(ring[0]!, ring[ring.length - 1]!) <= CAD_PARCEL_ARC_ZERO_CHORD_TOLERANCE) {
    ring.pop();
    rawIndex.pop();
  }
  if (ring.length < 3) return null;
  return ring.map((from, position) => {
    const to = ring[(position + 1) % ring.length]!;
    const entry = courseGeometry?.[rawIndex[position]!];
    const canonical = parcelCourseCanonicalKind(entry) === 'arc' && entry?.kind === 'arc' ? entry : null;
    const arc = canonical ? describeParcelArcCourse(from, to, canonical.bulge) : null;
    return {
      from,
      to,
      arc,
      rawIndex: rawIndex[position]!,
      geometry: canonical ? { kind: 'arc', bulge: canonical.bulge } : { kind: 'line' },
      position,
    };
  });
};

const buildTopologyCourses = buildParcelCourseTopology;

const isNearPoint = (point: CadWorldPoint, target: CadWorldPoint, tolerance: number): boolean =>
  Math.abs(point.x - target.x) <= tolerance && Math.abs(point.y - target.y) <= tolerance;

export const validateParcelBoundaryTopology = (
  vertices: readonly CadWorldPoint[],
  courseGeometry?: readonly CadParcelCourseGeometry[],
): { ok: boolean; issues: ParcelBoundaryTopologyIssue[] } => {
  const courses = buildTopologyCourses(vertices, courseGeometry);
  if (!courses) {
    return {
      ok: false,
      issues: [{ courseIndex: -1, otherCourseIndex: -1, code: 'INVALID_COURSE_GEOMETRY', message: 'boundary needs valid course geometry (see validateParcelCourseGeometry)' }],
    };
  }
  const issues: ParcelBoundaryTopologyIssue[] = [];
  for (let index = 0; index < courses.length; index += 1) {
    for (let other = index + 1; other < courses.length; other += 1) {
      const first = courses[index]!;
      const second = courses[other]!;
      const adjacent = other === index + 1 || (index === 0 && other === courses.length - 1);
      let hits: CadWorldPoint[];
      if (first.arc && second.arc) {
        hits = cadIntersectArcArc(
          first.arc.center, first.arc.radius, first.arc.startAngleDeg, first.arc.endAngleDeg,
          second.arc.center, second.arc.radius, second.arc.startAngleDeg, second.arc.endAngleDeg,
        );
      } else if (first.arc) {
        hits = cadIntersectSegmentArc(
          second.from, second.to, first.arc.center, first.arc.radius,
          first.arc.startAngleDeg, first.arc.endAngleDeg,
        );
      } else if (second.arc) {
        hits = cadIntersectSegmentArc(
          first.from, first.to, second.arc.center, second.arc.radius,
          second.arc.startAngleDeg, second.arc.endAngleDeg,
        );
      } else {
        const hit = cadSegmentIntersection(first.from, first.to, second.from, second.to);
        hits = hit ? [hit] : [];
      }
      const shared = adjacent
        ? [index === 0 && other === courses.length - 1 ? first.from : first.to]
        : [];
      const defects = hits.filter(
        (hit) => !shared.some((vertex) => isNearPoint(hit, vertex, CAD_PARCEL_ARC_ZERO_CHORD_TOLERANCE)),
      );
      if (defects.length > 0) {
        issues.push({
          courseIndex: index,
          otherCourseIndex: other,
          code: 'SELF_INTERSECTION',
          message: `courses ${index} and ${other} intersect (${defects.length} point(s); tangent-touch counts)`,
        });
      }
    }
  }
  return { ok: issues.length === 0, issues };
};

// ---------------------------------------------------------------------------
// Tangency: per-vertex incoming end-tangent vs outgoing start-tangent.
// ---------------------------------------------------------------------------

export interface ParcelCourseTangentReport {
  vertexIndex: number;
  incomingAzimuthDeg: number;
  outgoingAzimuthDeg: number;
  deviationDeg: number;
  status: 'TANGENT' | 'NON_TANGENT';
}

const wrapDeviationDeg = (fromAzimuth: number, toAzimuth: number): number => {
  const raw = cadNormalizeAngleDeg(toAzimuth - fromAzimuth);
  return raw > 180 ? 360 - raw : raw;
};

/**
 * Per-ring-vertex tangent continuity. Line courses contribute their chord
 * azimuth; arc courses their analytic end/start tangent azimuth. Empty on
 * invalid geometry (validate first) — fail closed, never guessed.
 */
export const checkParcelCourseTangency = (
  vertices: readonly CadWorldPoint[],
  courseGeometry?: readonly CadParcelCourseGeometry[],
): ParcelCourseTangentReport[] => {
  const courses = buildTopologyCourses(vertices, courseGeometry);
  if (!courses) return [];
  return courses.map((course, position) => {
    const incoming = courses[(position + courses.length - 1) % courses.length]!;
    const incomingAzimuth = incoming.arc
      ? incoming.arc.endTangentAzimuthDeg
      : buildCadInverseSummary(incoming.from, incoming.to).azimuthDeg;
    const outgoingAzimuth = course.arc
      ? course.arc.startTangentAzimuthDeg
      : buildCadInverseSummary(course.from, course.to).azimuthDeg;
    const deviationDeg = wrapDeviationDeg(incomingAzimuth, outgoingAzimuth);
    return {
      vertexIndex: position,
      incomingAzimuthDeg: incomingAzimuth,
      outgoingAzimuthDeg: outgoingAzimuth,
      deviationDeg,
      status: deviationDeg <= CAD_PARCEL_ARC_TANGENT_TOLERANCE_DEG ? 'TANGENT' : 'NON_TANGENT',
    };
  });
};

/**
 * Mirror (reflection) image of a course-geometry array: signed bulges flip
 * (left<->right, magnitude kept), lines pass through. Endpoint-owned bulge
 * needs no center/radius rewrite — the mirrored endpoints + flipped bulge
 * re-derive the mirrored arc exactly via describeParcelArcCourse.
 */
export const mirrorParcelCourseGeometry = (
  courseGeometry: readonly CadParcelCourseGeometry[],
): CadParcelCourseGeometry[] =>
  courseGeometry.map((entry) =>
    entry.kind === 'arc' ? { kind: 'arc', bulge: -entry.bulge } : { kind: 'line' },
  );

export interface ParcelArcCourseSplit {
  /** Exact sub-arc bulge for from -> point (same circle, same direction). */
  bulgeBefore: number;
  /** Exact sub-arc bulge for point -> to (same circle, same direction). */
  bulgeAfter: number;
  signedSweepBeforeDeg: number;
  signedSweepAfterDeg: number;
}

/** Interior-split floor in degrees (machine-conditioning scale, NOT a survey
 * tolerance): splits closer than this to an endpoint are degenerate. */
const ARC_SPLIT_INTERIOR_FLOOR_DEG = 1e-9;

/**
 * Exact arc split at an ON-ARC point: both sub-arcs ride the same circle in
 * the same direction, sweeps sum to the parent sweep (lengths sum exactly).
 * Null unless the point rides the circle (radius-relative tolerance, same
 * rule as parcelBulgeFromArcDefinition) inside the signed sweep and strictly
 * interior to both endpoints. Never throws, never snaps an off-arc point.
 */
export const splitParcelArcCourse = (
  from: CadWorldPoint,
  to: CadWorldPoint,
  bulge: number,
  point: CadWorldPoint,
): ParcelArcCourseSplit | null => {
  const metrics = describeParcelArcCourse(from, to, bulge);
  if (!metrics) return null;
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  const onCircleTolerance = Math.max(1e-9, metrics.radius * 1e-9);
  if (Math.abs(cadDistance(metrics.center, point) - metrics.radius) > onCircleTolerance) return null;
  const pointAngleDeg = cadAngleDegFromCenter(metrics.center, point);
  if (!cadIsAngleOnArcSweep(pointAngleDeg, metrics.startAngleDeg, metrics.endAngleDeg)) return null;
  const sweepBeforeDeg = cadSignedSweepDeg(metrics.startAngleDeg, pointAngleDeg);
  // Same direction as the parent traversal (zero = exactly on an endpoint).
  if (sweepBeforeDeg === 0 || Math.sign(sweepBeforeDeg) !== Math.sign(metrics.signedSweepDeg)) return null;
  const sweepAfterDeg = metrics.signedSweepDeg - sweepBeforeDeg;
  if (
    Math.abs(sweepBeforeDeg) <= ARC_SPLIT_INTERIOR_FLOOR_DEG ||
    Math.abs(sweepAfterDeg) <= ARC_SPLIT_INTERIOR_FLOOR_DEG ||
    Math.abs(sweepAfterDeg) >= CAD_PARCEL_ARC_FULL_CIRCLE_SWEEP_DEG
  ) {
    return null;
  }
  const bulgeBefore = Math.tan(((sweepBeforeDeg * Math.PI) / 180) / 4);
  const bulgeAfter = Math.tan(((sweepAfterDeg * Math.PI) / 180) / 4);
  if (!Number.isFinite(bulgeBefore) || !Number.isFinite(bulgeAfter)) return null;
  return {
    bulgeBefore,
    bulgeAfter,
    signedSweepBeforeDeg: sweepBeforeDeg,
    signedSweepAfterDeg: sweepAfterDeg,
  };
};

// ---------------------------------------------------------------------------
// Bounds: arc extrema (quadrant angles inside the signed sweep).
// ---------------------------------------------------------------------------

/**
 * Arc bound points: endpoints plus 0/90/180/270° circle points inside the
 * signed sweep. Empty on degenerate input (callers keep vertex points).
 */
export const parcelArcBoundsPoints = (
  from: CadWorldPoint,
  to: CadWorldPoint,
  bulge: number,
): CadWorldPoint[] => {
  const metrics = describeParcelArcCourse(from, to, bulge);
  if (!metrics) return [];
  const points = [{ ...from }, { ...to }];
  [0, 90, 180, 270].forEach((candidateDeg) => {
    if (cadIsAngleOnArcSweep(candidateDeg, metrics.startAngleDeg, metrics.endAngleDeg)) {
      points.push(cadPointOnCircle(metrics.center, metrics.radius, candidateDeg));
    }
  });
  return points;
};
