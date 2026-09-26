// Phase 19A slice A — stable parcel course identity + authoritative resolver.
//
// ONE seam for course ids: creation assigns them, load paths backfill them
// deterministically, transforms carry them untouched, vertex insert retires
// one and mints two, splits mint fresh sets. Per-leg math reuses ONLY the
// existing helpers (buildCadInverseSummary, formatCadNorthAzimuthDms via the
// report path); ring order is preserved, never sorted. No new formulas.

import { cadBuildParcelClosureSummary } from './cadCogoParcelGeometrySummaries';
import { buildCadInverseSummary, formatCadNorthAzimuthDms } from './cadCogoMath';
import { normalizeParcelVertexLabel } from './cadCogoParcelGeometryPrimitives';
import type { CadParcelReportSummary } from './cadCogoParcelGeometryTypes';
import type { CadDisplayPoint } from './cadDisplayTypes';
import type { CadParcelEntity } from './cadTypes';

export interface CadParcelCourse {
  courseId: string;
  index: number;
  fromVertex: CadDisplayPoint;
  toVertex: CadDisplayPoint;
  fromLabel: string;
  toLabel: string;
  azimuthDeg: number;
  azimuthText: string;
  bearing: string;
  distanceMeters: number;
  midpoint: CadDisplayPoint;
  directionX: number;
  directionY: number;
}

/** Deterministic course id for the course starting at vertex `index`. */
export const buildParcelCourseId = (parcelId: string, index: number): string =>
  `parcel-course:${parcelId}:${index}`;

/** Fresh deterministic id set for a parcel with `courseCount` courses. */
export const buildParcelCourseIds = (parcelId: string, courseCount: number): string[] =>
  Array.from({ length: courseCount }, (_, index) => buildParcelCourseId(parcelId, index));

const hasValidCourseIds = (parcel: CadParcelEntity): boolean =>
  Array.isArray(parcel.courseIds) &&
  parcel.courseIds.length === parcel.vertices.length &&
  parcel.courseIds.every((id) => typeof id === 'string' && id.length > 0);

/**
 * Deterministic migration: parcels with a valid id set pass through by
 * reference; legacy parcels (absent/short/invalid) get fresh deterministic
 * ids derived from the parcel id. No randomness — repeated loads agree.
 * The key stays trailing (persistence signatures are key-order-sensitive).
 */
export const ensureParcelCourseIds = (parcel: CadParcelEntity): CadParcelEntity => {
  if (hasValidCourseIds(parcel)) return parcel;
  return {
    ...parcel,
    courseIds: buildParcelCourseIds(parcel.id, parcel.vertices.length),
  };
};

/** Same 1e-9 adjacency rule as the parcel closure/report summaries. */
const isSameVertex = (a: CadDisplayPoint, b: CadDisplayPoint): boolean =>
  Math.abs(a.x - b.x) <= 1e-9 && Math.abs(a.y - b.y) <= 1e-9;

interface RingEntry {
  vertex: CadDisplayPoint;
  label: string;
  rawIndex: number;
}

const buildParcelRing = (parcel: CadParcelEntity): RingEntry[] => {
  const sanitized: RingEntry[] = [];
  parcel.vertices.forEach((vertex, rawIndex) => {
    const previous = sanitized[sanitized.length - 1];
    if (previous && isSameVertex(previous.vertex, vertex)) return;
    sanitized.push({
      vertex,
      label: normalizeParcelVertexLabel(parcel.vertexLabels[rawIndex], rawIndex),
      rawIndex,
    });
  });
  if (sanitized.length < 3) return [];
  const ring =
    sanitized.length > 3 && isSameVertex(sanitized[0]!.vertex, sanitized[sanitized.length - 1]!.vertex)
      ? sanitized.slice(0, -1)
      : sanitized;
  return ring.length >= 3 ? ring : [];
};

/**
 * Authoritative pure course resolver. Ring order preserved, no sorting.
 * Adjacent-duplicate sanitization + explicit-close handling mirror
 * cadBuildParcelReportSummary exactly, so derived bearings/distances match
 * the existing report values leg for leg.
 */
export const resolveCadParcelCourses = (parcel: CadParcelEntity): CadParcelCourse[] => {
  const ring = buildParcelRing(parcel);
  if (ring.length === 0) return [];
  return ring.map((entry, index) => {
    const next = ring[(index + 1) % ring.length]!;
    const inverse = buildCadInverseSummary(entry.vertex, next.vertex);
    const distance = inverse.distance;
    return {
      courseId: parcel.courseIds?.[entry.rawIndex] ?? buildParcelCourseId(parcel.id, entry.rawIndex),
      index,
      fromVertex: { x: entry.vertex.x, y: entry.vertex.y },
      toVertex: { x: next.vertex.x, y: next.vertex.y },
      fromLabel: entry.label,
      toLabel: next.label,
      azimuthDeg: inverse.azimuthDeg,
      azimuthText: formatCadNorthAzimuthDms(inverse.azimuthDeg),
      bearing: inverse.bearing,
      distanceMeters: distance,
      midpoint: {
        x: (entry.vertex.x + next.vertex.x) / 2,
        y: (entry.vertex.y + next.vertex.y) / 2,
      },
      directionX: distance > 1e-12 ? (next.vertex.x - entry.vertex.x) / distance : 0,
      directionY: distance > 1e-12 ? (next.vertex.y - entry.vertex.y) / distance : 0,
    };
  });
};

/**
 * Vertex insert on a course: the old course id retires, two NEW deterministic
 * ids take its place (generation = post-insert vertex count, so repeated
 * inserts at any course stay unique within the parcel). Metrics recomputed
 * via the existing closure summary.
 */
export const insertParcelCourseVertex = ({
  parcel,
  courseIndex,
  point,
  label,
}: {
  parcel: CadParcelEntity;
  courseIndex: number;
  point: CadDisplayPoint;
  label?: string;
}): CadParcelEntity | null => {
  const ring = buildParcelRing(parcel);
  if (ring.length === 0) return null;
  if (!ring[courseIndex]) return null;
  const ensured = ensureParcelCourseIds(parcel);
  const vertexCount = ensured.vertices.length;
  const isClosingLeg = courseIndex === ring.length - 1;
  // Raw insert position: before the course's `to` vertex, except the closing
  // leg (whose `to` is vertices[0]) which appends at the end.
  const rawInsertAt = isClosingLeg ? vertexCount : ring[(courseIndex + 1) % ring.length]!.rawIndex;
  const newTotal = vertexCount + 1;
  const newIdA = `parcel-course:${parcel.id}:${courseIndex}-${newTotal}a`;
  const newIdB = `parcel-course:${parcel.id}:${courseIndex}-${newTotal}b`;
  const vertices = ensured.vertices.map((vertex) => ({ x: vertex.x, y: vertex.y }));
  vertices.splice(rawInsertAt, 0, { x: point.x, y: point.y });
  const vertexLabels = [...ensured.vertexLabels];
  vertexLabels.splice(
    rawInsertAt,
    0,
    label?.trim() ? label.trim() : normalizeParcelVertexLabel(undefined, rawInsertAt),
  );
  const courseIds = [...(ensured.courseIds ?? [])];
  // Retire the old course id: it lives at the course's `from` raw index.
  const retireAt = ring[courseIndex]!.rawIndex;
  courseIds.splice(retireAt, 1, newIdA);
  courseIds.splice(rawInsertAt, 0, newIdB);
  const metrics = cadBuildParcelClosureSummary(vertices);
  return {
    ...ensured,
    vertices,
    vertexLabels,
    courseIds,
    areaSquareMeters: metrics?.areaSquareMeters,
    perimeterMeters: metrics?.perimeterMeters,
    closureDeltaX: metrics?.closureDeltaX,
    closureDeltaY: metrics?.closureDeltaY,
    closureDistanceMeters: metrics?.closureDistanceMeters,
  };
};

/**
 * Structured live Parcel Course Report: same CadParcelReportSummary shape the
 * screen overlay already renders, derived from the authoritative resolver
 * (closure via the existing summary, courses via resolveCadParcelCourses).
 */
export const buildParcelCourseReportSummary = (
  parcel: CadParcelEntity,
): CadParcelReportSummary | null => {
  const closure = cadBuildParcelClosureSummary(parcel.vertices);
  if (!closure) return null;
  const courses = resolveCadParcelCourses(parcel);
  if (courses.length < 3) return null;
  return {
    parcelName: parcel.parcelName,
    ...closure,
    courseCount: courses.length,
    courses: courses.map((course) => ({
      fromLabel: course.fromLabel,
      toLabel: course.toLabel,
      azimuthDeg: course.azimuthDeg,
      azimuthText: course.azimuthText,
      bearing: course.bearing,
      distanceMeters: course.distanceMeters,
    })),
  };
};
