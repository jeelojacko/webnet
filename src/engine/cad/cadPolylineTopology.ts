/**
 * Phase C3 — pure polyline vertex insert/delete topology core.
 *
 * NO project or history mutation: every entry point takes ONE canonical
 * `CadPolylineEntity` and returns a complete, revalidated replacement
 * entity (or a typed fail-closed code). Callers (engine transactions) own
 * the editability gate, boundary/breakline preflight, history entry and
 * selection; this module owns only the geometry + metadata topology.
 *
 * Course authority: validation resolves through the SAME C2 seams as every
 * other consumer (`sanitizeCadPolylinePath`, `resolveCadPolylineCourses`).
 * Arc math is never re-derived here: line projection uses
 * `cadClosestPointOnSegment`, arc projection/membership uses
 * `cadClosestPointOnArc` + `cadIsAngleOnArcSweep`, and the split reuses
 * `splitParcelArcCourse` (same circle, same traversal, b = tan(sweep/4)).
 * Merge sums signed sweeps and re-derives one bulge through
 * `parcelBulgeFromArcDefinition`; line+arc and off-circle arc+arc block.
 *
 * Storage law: a closed ring is stored WITHOUT the duplicate closure vertex.
 * Insert on course i lands at stored index i + 1 (the final course appends
 * last→new→first); delete of a closed vertex 0 rotates the ring and never
 * leaves a duplicate closure vertex. Every result re-runs the canonical
 * path normalizer before return, so all-line geometry / all-zero widths
 * canonicalize back to absent and legacy byte-shape stays intact.
 */

import { cadAngleDegFromCenter, cadClosestPointOnSegment } from './cadGeometry';
import { cadClosestPointOnArc, cadIsAngleOnArcSweep } from './cadGeometryArcPrimitives';
import {
  CAD_PARCEL_ARC_FULL_CIRCLE_SWEEP_DEG,
  parcelBulgeFromArcDefinition,
  splitParcelArcCourse,
} from './cadParcelArcGeometry';
import { resolveCadPolylineCourses, type CadPolylineResolvedCourse } from './cadPolylineCourses';
import {
  CAD_POLYLINE_DEDUPE_EPSILON,
  cadPolylinePointsMatch,
  cadPolylineWidthAtFraction,
  sanitizeCadPolylinePath,
  type CadPolylinePathResult,
} from './cadPolylineGeometry';
import type {
  CadPolylineEntity,
  CadPolylineSegmentGeometry,
  CadPolylineSegmentWidth,
} from './cadTypes';

export type CadPolylineTopologyFailureCode =
  | 'INVALID_ENTITY'
  | 'COURSE_NOT_FOUND'
  | 'VERTEX_NOT_FOUND'
  | 'ENDPOINT_NEAR'
  | 'OFF_COURSE'
  | 'DEGENERATE'
  | 'INCOMPATIBLE_MERGE'
  | 'MIN_COUNT';

export interface CadPolylineTopologyFailure {
  ok: false;
  code: CadPolylineTopologyFailureCode;
  message: string;
}

export type CadPolylineTopologyResult =
  | { ok: true; entity: CadPolylineEntity }
  | CadPolylineTopologyFailure;

const fail = (
  code: CadPolylineTopologyFailureCode,
  message: string,
): CadPolylineTopologyFailure => ({ ok: false, code, message });

type CanonicalPath = Extract<CadPolylinePathResult, { ok: true }>;

/**
 * Rebuild an entity from a canonical path result. Optional keys are
 * explicitly deleted when the normalizer canonicalized them away, so a
 * legacy polyline that gains/keeps absent metadata stays byte-shape clean.
 */
const applyCanonicalPath = (
  entity: CadPolylineEntity,
  path: CanonicalPath,
): CadPolylineEntity => {
  const next: CadPolylineEntity = {
    ...entity,
    vertices: path.vertices,
    vertexLabels: path.vertexLabels,
    closed: path.closed,
  };
  if (path.segmentGeometry != null) next.segmentGeometry = path.segmentGeometry;
  else delete next.segmentGeometry;
  if (path.segmentWidths != null) next.segmentWidths = path.segmentWidths;
  else delete next.segmentWidths;
  return next;
};

interface PreparedEntity {
  ok: true;
  canonical: CadPolylineEntity;
  courses: CadPolylineResolvedCourse[];
}

/** Canonicalize the stored entity through C2, then resolve its true courses. */
const prepareEntity = (
  entity: CadPolylineEntity,
): PreparedEntity | CadPolylineTopologyFailure => {
  const path = sanitizeCadPolylinePath(
    entity.vertices,
    entity.closed === true,
    entity.segmentGeometry,
    entity.segmentWidths,
    entity.vertexLabels,
  );
  if (!path.ok) return fail('INVALID_ENTITY', `PLINE cannot be edited: ${path.error}`);
  const canonical = applyCanonicalPath(entity, path);
  const courses = resolveCadPolylineCourses(canonical);
  if (!courses) return fail('INVALID_ENTITY', 'PLINE course metadata does not resolve');
  return { ok: true, canonical, courses };
};

/** Re-run the canonical normalizer before returning, so no result can be
 *  internally inconsistent or carry a redundant closure vertex. */
const finalize = (
  entity: CadPolylineEntity,
  next: {
    vertices: { x: number; y: number }[];
    vertexLabels: string[];
    segmentGeometry?: CadPolylineSegmentGeometry[];
    segmentWidths?: CadPolylineSegmentWidth[];
  },
): CadPolylineTopologyResult => {
  const path = sanitizeCadPolylinePath(
    next.vertices,
    entity.closed === true,
    next.segmentGeometry,
    next.segmentWidths,
    next.vertexLabels,
  );
  if (!path.ok) return fail('DEGENERATE', `PLINE edit produced an invalid path: ${path.error}`);
  return { ok: true, entity: applyCanonicalPath(entity, path) };
};

/**
 * Deterministic non-survey label. Legacy all-empty labels stay empty (the
 * display fallback renders `V{i+1}`, keeping old files behavior-compatible).
 * Once any explicit label exists, the inserted vertex takes the V{i+1}
 * ordinal at its slot, probing upward only to avoid colliding with an
 * existing label. Existing explicit labels are never renumbered.
 */
const insertedVertexLabel = (labels: readonly string[], insertIndex: number): string => {
  const used = new Set(labels.filter((label) => label !== ''));
  if (used.size === 0) return '';
  let ordinal = insertIndex + 1;
  while (used.has(`V${ordinal}`)) ordinal += 1;
  return `V${ordinal}`;
};

/** Insert `entries` at `courseIndex`, replacing the single course there. */
const spliceCourseEntries = <Entry>(
  entries: readonly Entry[],
  courseIndex: number,
  before: Entry,
  after: Entry,
): Entry[] => [
  ...entries.slice(0, courseIndex),
  before,
  after,
  ...entries.slice(courseIndex + 1),
];

/**
 * Width split at a course fraction: first course start→split, second
 * split→end. Returns undefined when the entity carries no widths (legacy
 * stays legacy). All-zero results canonicalize away in `finalize`.
 */
const splitWidthAtFraction = (
  widths: readonly CadPolylineSegmentWidth[] | undefined,
  courseIndex: number,
  fraction: number,
): CadPolylineSegmentWidth[] | undefined => {
  if (widths == null) return undefined;
  const current = widths[courseIndex]!;
  const atSplit = cadPolylineWidthAtFraction(current, fraction) ?? current.startWidth;
  return spliceCourseEntries(
    widths,
    courseIndex,
    { startWidth: current.startWidth, endWidth: atSplit },
    { startWidth: atSplit, endWidth: current.endWidth },
  );
};

const insertVertexAt = (
  vertices: readonly { x: number; y: number }[],
  insertAt: number,
  point: { x: number; y: number },
): { x: number; y: number }[] => [
  ...vertices.slice(0, insertAt),
  { x: point.x, y: point.y },
  ...vertices.slice(insertAt),
];

const insertLabelAt = (labels: readonly string[], insertAt: number, label: string): string[] => [
  ...labels.slice(0, insertAt),
  label,
  ...labels.slice(insertAt),
];

/**
 * Insert a vertex on ONE course addressed by `courseIndex`, riding the
 * course exactly.
 *
 * Line: the pick projects/clamps onto the finite segment; the stored vertex
 * is that exact projection (the path is geometrically unchanged). Arc: the
 * pick must fall inside the true swept circle arc, projects radially onto
 * it, and splits into two same-circle sub-arcs (signed sweeps sum to the
 * parent; never chord geometry). Either endpoint within the 1e-9 canonical
 * dedupe floor is rejected as ENDPOINT_NEAR. Width at the split interpolates
 * linearly over the TRUE length fraction (distance for a line, signed sweep
 * for an arc), producing first start→split and second split→end widths.
 */
export const insertCadPolylineVertexOnCourse = (
  entity: CadPolylineEntity,
  input: { courseIndex: number; x: number; y: number },
): CadPolylineTopologyResult => {
  const { courseIndex, x, y } = input;
  if (!Number.isInteger(courseIndex)) {
    return fail('COURSE_NOT_FOUND', `course index ${courseIndex} is not an integer`);
  }
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return fail('DEGENERATE', 'insert point is not finite');
  }
  const prepared = prepareEntity(entity);
  if (!prepared.ok) return prepared;
  const { canonical, courses } = prepared;
  const course = courses[courseIndex];
  if (!course) return fail('COURSE_NOT_FOUND', `course index ${courseIndex} is out of range`);
  const pick = { x, y };
  const insertAt = courseIndex + 1;

  if (course.kind === 'line') {
    const projected = cadClosestPointOnSegment(pick, course.from, course.to);
    if (cadPolylinePointsMatch(projected, course.from) || cadPolylinePointsMatch(projected, course.to)) {
      return fail('ENDPOINT_NEAR', 'projected vertex is on a course endpoint');
    }
    const length = Math.hypot(course.to.x - course.from.x, course.to.y - course.from.y);
    const fraction = length > 0
      ? Math.hypot(projected.x - course.from.x, projected.y - course.from.y) / length
      : 0;
    const geometry =
      canonical.segmentGeometry == null
        ? undefined
        : spliceCourseEntries<CadPolylineSegmentGeometry>(
            canonical.segmentGeometry,
            courseIndex,
            { kind: 'line' },
            { kind: 'line' },
          );
    return finalize(entity, {
      vertices: insertVertexAt(canonical.vertices, insertAt, projected),
      vertexLabels: insertLabelAt(
        canonical.vertexLabels,
        insertAt,
        insertedVertexLabel(canonical.vertexLabels, insertAt),
      ),
      segmentGeometry: geometry,
      segmentWidths: splitWidthAtFraction(canonical.segmentWidths, courseIndex, fraction),
    });
  }

  const metrics = course.metrics!;
  const pickAngleDeg = cadAngleDegFromCenter(metrics.center, pick);
  if (!cadIsAngleOnArcSweep(pickAngleDeg, metrics.startAngleDeg, metrics.endAngleDeg)) {
    return fail('OFF_COURSE', 'insert point is not within the arc sweep');
  }
  const projected = cadClosestPointOnArc(
    pick,
    metrics.center,
    metrics.radius,
    metrics.startAngleDeg,
    metrics.endAngleDeg,
  );
  if (cadPolylinePointsMatch(projected, course.from) || cadPolylinePointsMatch(projected, course.to)) {
    return fail('ENDPOINT_NEAR', 'projected vertex is on a course endpoint');
  }
  const entry = canonical.segmentGeometry![courseIndex] as { kind: 'arc'; bulge: number };
  const split = splitParcelArcCourse(course.from, course.to, entry.bulge, projected);
  if (!split) return fail('DEGENERATE', 'arc split failed at the projected point');
  const fraction = metrics.signedSweepDeg !== 0
    ? split.signedSweepBeforeDeg / metrics.signedSweepDeg
    : 0;
  const geometry = spliceCourseEntries<CadPolylineSegmentGeometry>(
    canonical.segmentGeometry!,
    courseIndex,
    { kind: 'arc', bulge: split.bulgeBefore },
    { kind: 'arc', bulge: split.bulgeAfter },
  );
  return finalize(entity, {
    vertices: insertVertexAt(canonical.vertices, insertAt, projected),
    vertexLabels: insertLabelAt(
      canonical.vertexLabels,
      insertAt,
      insertedVertexLabel(canonical.vertexLabels, insertAt),
    ),
    segmentGeometry: geometry,
    segmentWidths: splitWidthAtFraction(canonical.segmentWidths, courseIndex, fraction),
  });
};

const mergeCircleTolerance = (radiusA: number, radiusB: number): number =>
  Math.max(CAD_POLYLINE_DEDUPE_EPSILON, radiusA * CAD_POLYLINE_DEDUPE_EPSILON, radiusB * CAD_POLYLINE_DEDUPE_EPSILON);

const coursesShareCircle = (
  before: CadPolylineResolvedCourse,
  after: CadPolylineResolvedCourse,
): boolean => {
  const a = before.metrics!;
  const b = after.metrics!;
  if (Math.sign(a.signedSweepDeg) !== Math.sign(b.signedSweepDeg)) return false;
  const tolerance = mergeCircleTolerance(a.radius, b.radius);
  return (
    Math.hypot(a.center.x - b.center.x, a.center.y - b.center.y) <= tolerance &&
    Math.abs(a.radius - b.radius) <= tolerance
  );
};

/**
 * Merge incoming + outgoing courses around a deleted vertex.
 * line+line → line; arc+arc → one arc only on the same circle, same
 * traversal sign, with the summed signed sweep below the full-circle cap.
 * line+arc / arc+line and off-circle or opposite-direction arc joins BLOCK
 * (never silently straightened).
 */
const mergeAdjacentCourses = (
  before: CadPolylineResolvedCourse,
  after: CadPolylineResolvedCourse,
): { ok: true; geometry: CadPolylineSegmentGeometry } | CadPolylineTopologyFailure => {
  if (before.kind === 'line' && after.kind === 'line') {
    return { ok: true, geometry: { kind: 'line' } };
  }
  if (before.kind !== 'arc' || after.kind !== 'arc') {
    return fail(
      'INCOMPATIBLE_MERGE',
      `cannot merge ${before.kind}+${after.kind} courses (mixed curvature never straightens)`,
    );
  }
  if (!coursesShareCircle(before, after)) {
    return fail('INCOMPATIBLE_MERGE', 'arc courses do not share one circle and traversal direction');
  }
  const mergedSweepDeg = before.metrics!.signedSweepDeg + after.metrics!.signedSweepDeg;
  if (Math.abs(mergedSweepDeg) >= CAD_PARCEL_ARC_FULL_CIRCLE_SWEEP_DEG) {
    return fail('INCOMPATIBLE_MERGE', 'merged arc sweep reaches the full-circle cap');
  }
  const bulge = parcelBulgeFromArcDefinition({
    from: before.from,
    to: after.to,
    center: before.metrics!.center,
    radius: before.metrics!.radius,
    signedSweepDeg: mergedSweepDeg,
  });
  if (bulge == null) return fail('INCOMPATIBLE_MERGE', 'merged arc does not derive a valid bulge');
  return { ok: true, geometry: { kind: 'arc', bulge } };
};

/** Replace the two merged course entries with one, respecting the closed
 *  wrapping pair (vertex 0: the merged leg closes the rotated ring, so it
 *  moves to the last slot). */
const replaceMergedCourse = <Entry>(
  entries: readonly Entry[],
  beforeIndex: number,
  afterIndex: number,
  merged: Entry,
): Entry[] => {
  const first = Math.min(beforeIndex, afterIndex);
  const second = Math.max(beforeIndex, afterIndex);
  if (second - first === 1) {
    return [...entries.slice(0, first), merged, ...entries.slice(second + 1)];
  }
  // Wrapped pair (closed vertex 0): entries[0] and entries[last] merge into
  // the closing leg of the rotated ring.
  return [...entries.slice(1, second), ...entries.slice(second + 1), merged];
};

/**
 * Delete a vertex and repair course topology.
 *
 * Open endpoints drop their single adjacent course (minimum 2 vertices
 * retained). Interior / closed vertices merge the incoming and outgoing
 * courses. Closed vertex 0 rotates the ring and reindexes so no duplicate
 * closure vertex is stored; a closed ring retains >=3 distinct vertices.
 * Widths at a merge take the incoming start at the surviving previous
 * vertex and the outgoing end at the surviving next vertex.
 */
export const deleteCadPolylineVertex = (
  entity: CadPolylineEntity,
  input: { vertexIndex: number },
): CadPolylineTopologyResult => {
  const { vertexIndex } = input;
  const prepared = prepareEntity(entity);
  if (!prepared.ok) return prepared;
  const { canonical, courses } = prepared;
  const closed = canonical.closed === true;
  const vertexCount = canonical.vertices.length;
  if (!Number.isInteger(vertexIndex) || vertexIndex < 0 || vertexIndex >= vertexCount) {
    return fail('VERTEX_NOT_FOUND', `vertex index ${vertexIndex} is out of range`);
  }
  const minimum = closed ? 3 : 2;
  if (vertexCount - 1 < minimum) {
    return fail(
      'MIN_COUNT',
      `PLINE ${closed ? 'closed' : 'open'} needs >=${minimum} retained vertices after delete`,
    );
  }

  const isOpenEndpoint = !closed && (vertexIndex === 0 || vertexIndex === vertexCount - 1);
  if (isOpenEndpoint) {
    const dropFirst = vertexIndex === 0;
    return finalize(entity, {
      vertices: dropFirst ? canonical.vertices.slice(1) : canonical.vertices.slice(0, -1),
      vertexLabels: dropFirst ? canonical.vertexLabels.slice(1) : canonical.vertexLabels.slice(0, -1),
      segmentGeometry:
        canonical.segmentGeometry == null
          ? undefined
          : dropFirst
            ? canonical.segmentGeometry.slice(1)
            : canonical.segmentGeometry.slice(0, -1),
      segmentWidths:
        canonical.segmentWidths == null
          ? undefined
          : dropFirst
            ? canonical.segmentWidths.slice(1)
            : canonical.segmentWidths.slice(0, -1),
    });
  }

  const courseCount = courses.length;
  const beforeIndex = closed ? (vertexIndex + courseCount - 1) % courseCount : vertexIndex - 1;
  const afterIndex = closed ? vertexIndex % courseCount : vertexIndex;
  const before = courses[beforeIndex]!;
  const after = courses[afterIndex]!;
  const merged = mergeAdjacentCourses(before, after);
  if (merged.ok === false) return merged;

  const geometry =
    canonical.segmentGeometry == null
      ? undefined
      : replaceMergedCourse(
          canonical.segmentGeometry,
          beforeIndex,
          afterIndex,
          merged.geometry,
        );

  const incomingWidth = canonical.segmentWidths?.[beforeIndex];
  const outgoingWidth = canonical.segmentWidths?.[afterIndex];
  const widths =
    canonical.segmentWidths == null
      ? undefined
      : replaceMergedCourse(
          canonical.segmentWidths,
          beforeIndex,
          afterIndex,
          { startWidth: incomingWidth!.startWidth, endWidth: outgoingWidth!.endWidth },
        );

  return finalize(entity, {
    vertices: [
      ...canonical.vertices.slice(0, vertexIndex),
      ...canonical.vertices.slice(vertexIndex + 1),
    ],
    vertexLabels: [
      ...canonical.vertexLabels.slice(0, vertexIndex),
      ...canonical.vertexLabels.slice(vertexIndex + 1),
    ],
    segmentGeometry: geometry,
    segmentWidths: widths,
  });
};

/**
 * Phase C3 Properties preflight: report WHY deleting `vertexIndex` would be
 * rejected WITHOUT producing or mutating any entity. Runs the same pure
 * checks as `deleteCadPolylineVertex` (canonicalize, range, minimum count,
 * and the merge legality of the adjacent courses). Returns null when the
 * delete is legal, otherwise the operator-facing reason. Because it never
 * builds the replacement entity it is O(n) per row, not O(n^2).
 */
export const describeCadPolylineVertexDeleteBlock = (
  entity: CadPolylineEntity,
  vertexIndex: number,
): string | null => {
  const prepared = prepareEntity(entity);
  if (!prepared.ok) return prepared.message;
  const { canonical, courses } = prepared;
  const closed = canonical.closed === true;
  const vertexCount = canonical.vertices.length;
  if (!Number.isInteger(vertexIndex) || vertexIndex < 0 || vertexIndex >= vertexCount) {
    return `vertex index ${vertexIndex} is out of range`;
  }
  const minimum = closed ? 3 : 2;
  if (vertexCount - 1 < minimum) {
    return `PLINE ${closed ? 'closed' : 'open'} needs >=${minimum} retained vertices after delete`;
  }
  // Open endpoints simply drop a course; no merge to validate.
  if (!closed && (vertexIndex === 0 || vertexIndex === vertexCount - 1)) return null;
  const courseCount = courses.length;
  const beforeIndex = closed ? (vertexIndex + courseCount - 1) % courseCount : vertexIndex - 1;
  const afterIndex = closed ? vertexIndex % courseCount : vertexIndex;
  const merged = mergeAdjacentCourses(courses[beforeIndex]!, courses[afterIndex]!);
  return merged.ok ? null : merged.message;
};
