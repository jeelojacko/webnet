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
import {
  describeParcelArcCourse,
  parcelCourseCanonicalKind,
  splitParcelArcCourse,
  validateParcelCourseGeometry,
} from './cadParcelArcGeometry';
import type { CadParcelReportSummary } from './cadCogoParcelGeometryTypes';
import type { CadDisplayPoint } from './cadDisplayTypes';
import type { CadParcelCourseGeometry, CadParcelEntity } from './cadTypes';

/** Shared course identity + endpoints (geometry kind never affects identity). */
export interface CadParcelCourseBase {
  courseId: string;
  index: number;
  fromVertex: CadDisplayPoint;
  toVertex: CadDisplayPoint;
  fromLabel: string;
  toLabel: string;
  /** Line courses: chord midpoint. Arc courses: TRUE curve midpoint. */
  midpoint: CadDisplayPoint;
}

export interface CadParcelLineCourse extends CadParcelCourseBase {
  kind: 'line';
  azimuthDeg: number;
  azimuthText: string;
  bearing: string;
  distanceMeters: number;
  directionX: number;
  directionY: number;
}

export interface CadParcelArcCourse extends CadParcelCourseBase {
  kind: 'arc';
  center: CadDisplayPoint;
  radius: number;
  /** Traversal-signed sweep: positive = CCW = left. */
  signedSweepDeg: number;
  deltaDeg: number;
  direction: 'left' | 'right';
  arcLength: number;
  chordLength: number;
  chordAzimuthDeg: number;
  chordBearing: string;
  startTangentAzimuthDeg: number;
  startTangentBearing: string;
  endTangentAzimuthDeg: number;
  endTangentBearing: string;
}

/** Discriminated line/arc course. Legacy parcels resolve as all-line. */
export type CadParcelCourse = CadParcelLineCourse | CadParcelArcCourse;

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
 * the existing report values leg for leg. Legacy parcels (absent geometry)
 * resolve EXACTLY as before (all-line, same values); geometry kind never
 * affects courseId. Invalid course geometry fails closed (no courses —
 * never silent line conversion).
 */
export const resolveCadParcelCourses = (parcel: CadParcelEntity): CadParcelCourse[] => {
  const ring = buildParcelRing(parcel);
  if (ring.length === 0) return [];
  const geometry = parcel.courseGeometry;
  if (geometry != null && !validateParcelCourseGeometry(parcel.vertices, geometry).ok) return [];
  const courses: CadParcelCourse[] = [];
  for (let index = 0; index < ring.length; index += 1) {
    const entry = ring[index]!;
    const next = ring[(index + 1) % ring.length]!;
    const courseId = parcel.courseIds?.[entry.rawIndex] ?? buildParcelCourseId(parcel.id, entry.rawIndex);
    const fromVertex = { x: entry.vertex.x, y: entry.vertex.y };
    const toVertex = { x: next.vertex.x, y: next.vertex.y };
    if (parcelCourseCanonicalKind(geometry?.[entry.rawIndex]) === 'arc') {
      const metrics = describeParcelArcCourse(entry.vertex, next.vertex, (geometry?.[entry.rawIndex] as { bulge: number }).bulge);
      // Validated above, so metrics exist; fail closed if they ever don't.
      if (!metrics) return [];
      courses.push({
        kind: 'arc',
        courseId,
        index,
        fromVertex,
        toVertex,
        fromLabel: entry.label,
        toLabel: next.label,
        midpoint: { ...metrics.midpoint },
        center: { ...metrics.center },
        radius: metrics.radius,
        signedSweepDeg: metrics.signedSweepDeg,
        deltaDeg: metrics.deltaDeg,
        direction: metrics.direction,
        arcLength: metrics.arcLength,
        chordLength: metrics.chordLength,
        chordAzimuthDeg: metrics.chordAzimuthDeg,
        chordBearing: metrics.chordBearing,
        startTangentAzimuthDeg: metrics.startTangentAzimuthDeg,
        startTangentBearing: metrics.startTangentBearing,
        endTangentAzimuthDeg: metrics.endTangentAzimuthDeg,
        endTangentBearing: metrics.endTangentBearing,
      });
      continue;
    }
    const inverse = buildCadInverseSummary(entry.vertex, next.vertex);
    const distance = inverse.distance;
    courses.push({
      kind: 'line',
      courseId,
      index,
      fromVertex,
      toVertex,
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
    });
  }
  return courses;
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
  // Phase 19C: course geometry mirrors the id splices so the length
  // contract holds. Line-course splits stay exact lines; arc courses split
  // into two exact sub-arcs on the same circle (insert point must ride the
  // arc — splitParcelArcCourse fails closed otherwise, never straightens).
  let courseGeometry: CadParcelCourseGeometry[] | undefined;
  if (ensured.courseGeometry != null) {
    if (!validateParcelCourseGeometry(ensured.vertices, ensured.courseGeometry).ok) return null;
    const splitEntry = ensured.courseGeometry[retireAt];
    courseGeometry = [...ensured.courseGeometry];
    if (parcelCourseCanonicalKind(splitEntry) === 'arc' && splitEntry?.kind === 'arc') {
      const splitCourse = ring[courseIndex]!;
      const splitNext = ring[(courseIndex + 1) % ring.length]!;
      const split = splitParcelArcCourse(splitCourse.vertex, splitNext.vertex, splitEntry.bulge, point);
      if (!split) return null;
      courseGeometry.splice(retireAt, 1, { kind: 'arc', bulge: split.bulgeBefore });
      courseGeometry.splice(rawInsertAt, 0, { kind: 'arc', bulge: split.bulgeAfter });
    } else {
      courseGeometry.splice(retireAt, 1, { kind: 'line' });
      courseGeometry.splice(rawInsertAt, 0, { kind: 'line' });
    }
  }
  const metrics = cadBuildParcelClosureSummary(vertices, { courseGeometry });
  return {
    ...ensured,
    vertices,
    vertexLabels,
    courseIds,
    ...(courseGeometry != null ? { courseGeometry } : {}),
    areaSquareMeters: metrics?.areaSquareMeters,
    perimeterMeters: metrics?.perimeterMeters,
    closureDeltaX: metrics?.closureDeltaX,
    closureDeltaY: metrics?.closureDeltaY,
    closureDistanceMeters: metrics?.closureDistanceMeters,
  };
};

export type DeleteParcelCourseVertexResult =
  | { ok: true; parcel: CadParcelEntity }
  | { ok: false; reason: string };

/**
 * Vertex delete at a ring vertex: the two courses meeting there merge into
 * one, their ids retire, one fresh deterministic id takes their place.
 * Policy (fail closed, never silent chord): line+line merges to a line;
 * arc+arc merges only on the same circle with compatible direction (merged
 * sweep = sweep sum, bulge re-derived — single arc authority, no chord);
 * line+arc BLOCKS; deleting below 3 vertices BLOCKS. Pure: null-free
 * result with an explicit reason on every block path.
 */
export const deleteParcelCourseVertex = ({
  parcel,
  vertexIndex,
}: {
  parcel: CadParcelEntity;
  vertexIndex: number;
}): DeleteParcelCourseVertexResult => {
  const block = (reason: string): DeleteParcelCourseVertexResult => ({ ok: false, reason });
  const ring = buildParcelRing(parcel);
  if (ring.length === 0 || !ring[vertexIndex]) {
    return block(`PARCEL_VERTEX_DELETE_UNKNOWN_VERTEX: no ring vertex ${vertexIndex}.`);
  }
  if (ring.length <= 3) {
    return block('PARCEL_VERTEX_DELETE_MIN_VERTICES: a parcel needs at least 3 vertices.');
  }
  const ensured = ensureParcelCourseIds(parcel);
  const geometry = ensured.courseGeometry;
  if (geometry != null && !validateParcelCourseGeometry(ensured.vertices, geometry).ok) {
    return block('PARCEL_VERTEX_DELETE_INVALID_GEOMETRY: course geometry fails validation.');
  }
  const prevPos = (vertexIndex - 1 + ring.length) % ring.length;
  const prevEntry = ring[prevPos]!;
  const removeEntry = ring[vertexIndex]!;
  const nextEntry = ring[(vertexIndex + 1) % ring.length]!;
  const prevKind = parcelCourseCanonicalKind(geometry?.[prevEntry.rawIndex]);
  const nextKind = parcelCourseCanonicalKind(geometry?.[removeEntry.rawIndex]);
  let merged: CadParcelCourseGeometry = { kind: 'line' };
  if (prevKind === 'arc' || nextKind === 'arc') {
    if (prevKind !== 'arc' || nextKind !== 'arc') {
      return block(
        'PARCEL_VERTEX_DELETE_MIXED_CURVATURE: cannot merge a line course with an arc course ' +
          `(courses ${prevPos} and ${vertexIndex}); delete the arc course's other endpoint instead.`,
      );
    }
    const prevBulge = (geometry?.[prevEntry.rawIndex] as { bulge: number }).bulge;
    const nextBulge = (geometry?.[removeEntry.rawIndex] as { bulge: number }).bulge;
    const prevMetrics = describeParcelArcCourse(prevEntry.vertex, removeEntry.vertex, prevBulge);
    const nextMetrics = describeParcelArcCourse(removeEntry.vertex, nextEntry.vertex, nextBulge);
    if (!prevMetrics || !nextMetrics) {
      return block('PARCEL_VERTEX_DELETE_INVALID_GEOMETRY: arc courses derive no valid arc.');
    }
    // Same-circle test (radius-relative tolerance, the converter rule) +
    // compatible direction (sweep signs agree). A kinked or S-curved join
    // BLOCKS instead of inventing a non-circular blend.
    const tolerance = Math.max(1e-9, prevMetrics.radius * 1e-9);
    const centerGap = Math.hypot(
      prevMetrics.center.x - nextMetrics.center.x,
      prevMetrics.center.y - nextMetrics.center.y,
    );
    const sameCircle =
      centerGap <= tolerance && Math.abs(prevMetrics.radius - nextMetrics.radius) <= tolerance;
    const sameDirection =
      Math.sign(prevMetrics.signedSweepDeg) === Math.sign(nextMetrics.signedSweepDeg);
    if (!sameCircle || !sameDirection) {
      return block(
        'PARCEL_VERTEX_DELETE_ARC_MISMATCH: arc courses are not on one circle in one direction ' +
          `(courses ${prevPos} and ${vertexIndex}); split the arc instead of deleting its vertex.`,
      );
    }
    const mergedSweepDeg = prevMetrics.signedSweepDeg + nextMetrics.signedSweepDeg;
    const mergedBulge = Math.tan(((mergedSweepDeg * Math.PI) / 180) / 4);
    if (
      !Number.isFinite(mergedBulge) ||
      !describeParcelArcCourse(prevEntry.vertex, nextEntry.vertex, mergedBulge)
    ) {
      return block('PARCEL_VERTEX_DELETE_ARC_MISMATCH: merged arc is degenerate.');
    }
    merged = { kind: 'arc', bulge: mergedBulge };
  }
  const rawRemove = removeEntry.rawIndex;
  const newTotal = ensured.vertices.length - 1;
  const mergedId = `parcel-course:${parcel.id}:${prevPos}-${newTotal}m`;
  const vertices = ensured.vertices
    .filter((_, rawIndex) => rawIndex !== rawRemove)
    .map((vertex) => ({ x: vertex.x, y: vertex.y }));
  const vertexLabels = ensured.vertexLabels.filter((_, rawIndex) => rawIndex !== rawRemove);
  // Both meeting course ids retire; the merged id lands on the surviving
  // previous course slot (adjusted for the removed vertex).
  const courseIds = (ensured.courseIds ?? []).filter((_, rawIndex) => rawIndex !== rawRemove);
  const prevAdjusted = prevEntry.rawIndex > rawRemove ? prevEntry.rawIndex - 1 : prevEntry.rawIndex;
  courseIds[prevAdjusted] = mergedId;
  let courseGeometry: CadParcelCourseGeometry[] | undefined;
  if (geometry != null) {
    courseGeometry = geometry.filter((_, rawIndex) => rawIndex !== rawRemove);
    courseGeometry[prevAdjusted] = merged;
  }
  const metrics = cadBuildParcelClosureSummary(vertices, { courseGeometry });
  if (!metrics) {
    return block('PARCEL_VERTEX_DELETE_DEGENERATE: merged ring has no valid closure.');
  }
  return {
    ok: true,
    parcel: {
      ...ensured,
      vertices,
      vertexLabels,
      courseIds,
      ...(courseGeometry != null ? { courseGeometry } : {}),
      areaSquareMeters: metrics.areaSquareMeters,
      perimeterMeters: metrics.perimeterMeters,
      closureDeltaX: metrics.closureDeltaX,
      closureDeltaY: metrics.closureDeltaY,
      closureDistanceMeters: metrics.closureDistanceMeters,
    },
  };
};

/**
 * Authoritative reverse of one mixed course. Course id is identity (kept).
 * Lines re-invert; arcs re-derive from the negated bulge through the single
 * arc authority (endpoints swap, sweep sign flips, left<->right, chord
 * bearing +180 by construction, midpoint unchanged — same point set).
 * Null when the reversed arc derives nothing (fail closed, never chord).
 */
export const reverseCadParcelCourse = (course: CadParcelCourse): CadParcelCourse | null => {
  if (course.kind === 'line') {
    const inverse = buildCadInverseSummary(course.toVertex, course.fromVertex);
    const distance = inverse.distance;
    return {
      ...course,
      fromVertex: { ...course.toVertex },
      toVertex: { ...course.fromVertex },
      fromLabel: course.toLabel,
      toLabel: course.fromLabel,
      azimuthDeg: inverse.azimuthDeg,
      azimuthText: formatCadNorthAzimuthDms(inverse.azimuthDeg),
      bearing: inverse.bearing,
      distanceMeters: distance,
      midpoint: {
        x: (course.fromVertex.x + course.toVertex.x) / 2,
        y: (course.fromVertex.y + course.toVertex.y) / 2,
      },
      directionX: distance > 1e-12 ? (course.fromVertex.x - course.toVertex.x) / distance : 0,
      directionY: distance > 1e-12 ? (course.fromVertex.y - course.toVertex.y) / distance : 0,
    };
  }
  // tan is odd: negating the sweep negates the bulge exactly.
  const reversedBulge = -Math.tan(((course.signedSweepDeg * Math.PI) / 180) / 4);
  const metrics = describeParcelArcCourse(course.toVertex, course.fromVertex, reversedBulge);
  if (!metrics) return null;
  return {
    ...course,
    fromVertex: { ...course.toVertex },
    toVertex: { ...course.fromVertex },
    fromLabel: course.toLabel,
    toLabel: course.fromLabel,
    midpoint: { ...metrics.midpoint },
    center: { ...metrics.center },
    radius: metrics.radius,
    signedSweepDeg: metrics.signedSweepDeg,
    deltaDeg: metrics.deltaDeg,
    direction: metrics.direction,
    arcLength: metrics.arcLength,
    chordLength: metrics.chordLength,
    chordAzimuthDeg: metrics.chordAzimuthDeg,
    chordBearing: metrics.chordBearing,
    startTangentAzimuthDeg: metrics.startTangentAzimuthDeg,
    startTangentBearing: metrics.startTangentBearing,
    endTangentAzimuthDeg: metrics.endTangentAzimuthDeg,
    endTangentBearing: metrics.endTangentBearing,
  };
};

/**
 * Mixed-order reverse traversal: order flips, every course reverses, course
 * ids ride along unchanged (identity, never geometry). Null if any course
 * fails to reverse.
 */
export const reverseCadParcelCourses = (
  courses: readonly CadParcelCourse[],
): CadParcelCourse[] | null => {
  const reversed: CadParcelCourse[] = [];
  for (let index = courses.length - 1; index >= 0; index -= 1) {
    const course = reverseCadParcelCourse(courses[index]!);
    if (!course) return null;
    reversed.push({ ...course, index: reversed.length });
  }
  return reversed;
};

/**
 * Mixed-order start-course rotation: the named course becomes first, ring
 * order otherwise preserved, course ids and indices re-seated (null on
 * unknown id). Shared with the legal-description traversal contract.
 */
export const rotateParcelCoursesToStart = (
  courses: readonly CadParcelCourse[],
  startCourseId: string,
): CadParcelCourse[] | null => {
  const index = courses.findIndex((course) => course.courseId === startCourseId);
  if (index < 0) return null;
  return [...courses.slice(index), ...courses.slice(0, index)].map((course, position) => ({
    ...course,
    index: position,
  }));
};

/**
 * Structured live Parcel Course Report: same CadParcelReportSummary shape the
 * screen overlay already renders, derived from the authoritative resolver
 * (closure via the existing summary, courses via resolveCadParcelCourses).
 * Phase 19C inquiry: exact curved closure + line/arc counts + per-course
 * curve details (arc metrics only; line entries carry endpoints, no dumps).
 */
export const buildParcelCourseReportSummary = (
  parcel: CadParcelEntity,
): CadParcelReportSummary | null => {
  const closure = cadBuildParcelClosureSummary(parcel.vertices, {
    courseGeometry: parcel.courseGeometry,
  });
  if (!closure) return null;
  const courses = resolveCadParcelCourses(parcel);
  if (courses.length < 3) return null;
  return {
    parcelName: parcel.parcelName,
    ...closure,
    courseCount: courses.length,
    lineCount: courses.filter((course) => course.kind === 'line').length,
    arcCount: courses.filter((course) => course.kind === 'arc').length,
    curveDetails: courses.map((course) =>
      course.kind === 'line'
        ? {
            courseId: course.courseId,
            kind: 'line' as const,
            fromLabel: course.fromLabel,
            toLabel: course.toLabel,
          }
        : {
            courseId: course.courseId,
            kind: 'arc' as const,
            fromLabel: course.fromLabel,
            toLabel: course.toLabel,
            radius: course.radius,
            deltaDeg: course.deltaDeg,
            arcLength: course.arcLength,
            chordLength: course.chordLength,
            chordBearing: course.chordBearing,
            direction: course.direction,
          },
    ),
    // Straight report shape: arc courses contribute truthful chord values
    // (dedicated curve columns arrive in a later 19C round).
    courses: courses.map((course) =>
      course.kind === 'line'
        ? {
            fromLabel: course.fromLabel,
            toLabel: course.toLabel,
            azimuthDeg: course.azimuthDeg,
            azimuthText: course.azimuthText,
            bearing: course.bearing,
            distanceMeters: course.distanceMeters,
          }
        : {
            fromLabel: course.fromLabel,
            toLabel: course.toLabel,
            azimuthDeg: course.chordAzimuthDeg,
            azimuthText: formatCadNorthAzimuthDms(course.chordAzimuthDeg),
            bearing: course.chordBearing,
            distanceMeters: course.chordLength,
          },
    ),
  };
};
