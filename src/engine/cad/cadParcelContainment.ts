// Phase 19C Round 2 — analytic point-in-parcel for mixed line/arc boundaries.
//
// Exact boundary test + even-odd ray crossing over courses (no tessellation).
// Straight parcels delegate to cadPointInPolygon on the same normalized ring,
// so legacy classification is byte-for-byte identical (differential-proved).
// Curves are resolved through the ONE topology seam (buildParcelCourseTopology)
// — no duplicated arc math.

import { cadAngleDegFromCenter, cadDistance, type CadWorldPoint } from './cadGeometry';
import { cadIsAngleOnArcSweep } from './cadGeometryArcPrimitives';
import {
  buildParcelCourseTopology,
  type CadParcelTopologyCourse,
} from './cadParcelArcGeometry';
import {
  cadPointInPolygon,
  cadPointOnSegment,
  normalizeParcelPolygonVertices,
  PARCEL_POINT_TOLERANCE,
} from './cadCogoParcelGeometryPrimitives';
import type { CadParcelCourseGeometry, CadParcelEntity } from './cadTypes';

export type CadParcelPointClass = 'inside' | 'outside' | 'boundary';

const pointOnArcCourse = (point: CadWorldPoint, course: CadParcelTopologyCourse): boolean => {
  const arc = course.arc!;
  const radial = cadDistance(point, arc.center);
  const tolerance = Math.max(PARCEL_POINT_TOLERANCE, arc.radius * 1e-9);
  if (Math.abs(radial - arc.radius) > tolerance) return false;
  return cadIsAngleOnArcSweep(
    cadAngleDegFromCenter(arc.center, point),
    arc.startAngleDeg,
    arc.endAngleDeg,
  );
};

const normalize360 = (value: number): number => {
  const wrapped = value % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
};

const offsetWithinPiece = (
  angleA: number,
  direction: 1 | -1,
  pieceSpanDeg: number,
  candidateDeg: number,
): boolean => {
  const offset =
    direction >= 0 ? normalize360(candidateDeg - angleA) : normalize360(angleA - candidateDeg);
  return offset >= -1e-9 && offset <= pieceSpanDeg + 1e-9;
};

/**
 * Does the arc cross the +x ray from `point`? Splits the arc at its y-extrema
 * (90°/270°) into y-monotone pieces and applies the same strict (> py)
 * semi-open rule as cadPointInPolygon, so tangency never toggles and shared
 * vertices never double-count.
 */
const arcCrossesRightRay = (point: CadWorldPoint, course: CadParcelTopologyCourse): boolean => {
  const arc = course.arc!;
  const start = arc.startAngleDeg;
  const direction: 1 | -1 = arc.signedSweepDeg >= 0 ? 1 : -1;
  const span = Math.abs(arc.signedSweepDeg);
  const travelOffsetDeg = (angleDeg: number): number =>
    direction >= 0 ? normalize360(angleDeg - start) : normalize360(start - angleDeg);
  const extremumOffsets: number[] = [];
  [90, 270].forEach((extremumDeg) => {
    const offset = travelOffsetDeg(extremumDeg);
    if (offset > 1e-9 && offset < span - 1e-9) extremumOffsets.push(offset);
  });
  extremumOffsets.sort((left, right) => left - right);
  const boundaries = [0, ...extremumOffsets, span];
  const radiansPerDegree = Math.PI / 180;
  let toggles = 0;
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const offsetA = boundaries[index]!;
    const offsetB = boundaries[index + 1]!;
    const angleA = start + direction * offsetA;
    const angleB = start + direction * offsetB;
    const yA = arc.center.y + arc.radius * Math.sin(angleA * radiansPerDegree);
    const yB = arc.center.y + arc.radius * Math.sin(angleB * radiansPerDegree);
    if ((yA > point.y) === (yB > point.y)) continue;
    const sinTheta = (point.y - arc.center.y) / arc.radius;
    if (Math.abs(sinTheta) >= 1) continue;
    const asinDeg = (Math.asin(sinTheta) * 180) / Math.PI;
    const crossing = [asinDeg, 180 - asinDeg].find((candidate) =>
      offsetWithinPiece(angleA, direction, offsetB - offsetA, candidate),
    );
    if (crossing == null) continue;
    const crossingX = arc.center.x + arc.radius * Math.cos(crossing * radiansPerDegree);
    if (crossingX > point.x) toggles += 1;
  }
  return toggles % 2 === 1;
};

const lineCrossesRightRay = (point: CadWorldPoint, course: CadParcelTopologyCourse): boolean => {
  const { from, to } = course;
  if ((from.y > point.y) === (to.y > point.y)) return false;
  const ratio = (point.y - from.y) / (to.y - from.y);
  return from.x + (to.x - from.x) * ratio > point.x;
};

const courseIsBoundaryPoint = (point: CadWorldPoint, course: CadParcelTopologyCourse): boolean =>
  course.arc
    ? pointOnArcCourse(point, course)
    : cadPointOnSegment(point, course.from, course.to);

/**
 * Deterministic classification of a point against a parcel ring (line/arc).
 * Invalid course geometry fails closed to 'outside' (never a guessed class).
 */
export const cadClassifyParcelBoundaryPoint = ({
  vertices,
  courseGeometry,
  point,
}: {
  vertices: readonly CadWorldPoint[];
  courseGeometry?: readonly CadParcelCourseGeometry[];
  point: CadWorldPoint;
}): CadParcelPointClass => {
  const ring = normalizeParcelPolygonVertices(vertices);
  if (ring.length < 3) return 'outside';
  const topology = buildParcelCourseTopology(vertices, courseGeometry);
  if (!topology) return 'outside';

  if (topology.some((course) => courseIsBoundaryPoint(point, course))) return 'boundary';

  const hasArc = topology.some((course) => course.arc != null);
  if (!hasArc) {
    // Legacy straight parity: identical to cadPointInPolygon on the same ring.
    return cadPointInPolygon(point, ring) ? 'inside' : 'outside';
  }

  let inside = false;
  topology.forEach((course) => {
    if (course.arc ? arcCrossesRightRay(point, course) : lineCrossesRightRay(point, course)) {
      inside = !inside;
    }
  });
  return inside ? 'inside' : 'outside';
};

export const cadClassifyParcelPoint = (
  parcel: CadParcelEntity,
  point: CadWorldPoint,
): CadParcelPointClass =>
  cadClassifyParcelBoundaryPoint({
    vertices: parcel.vertices,
    courseGeometry: parcel.courseGeometry,
    point,
  });

/** Inside-or-boundary (matches cadPointInPolygon semantics). */
export const cadPointInCurvedParcel = (parcel: CadParcelEntity, point: CadWorldPoint): boolean =>
  cadClassifyParcelPoint(parcel, point) !== 'outside';

/** Strictly interior (excludes boundary). */
export const cadPointStrictlyInCurvedParcel = (
  parcel: CadParcelEntity,
  point: CadWorldPoint,
): boolean => cadClassifyParcelPoint(parcel, point) === 'inside';
