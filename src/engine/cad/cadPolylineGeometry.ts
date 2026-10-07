/**
 * Phase C1 — shared closed/open polyline vertex law.
 *
 * One canonical sanitizer for PLINE creation and the interactive session
 * gate: adjacent 1e-9 dedupe, then (closed only) strip a redundant final
 * vertex that repeats the first. A closed ring is persisted WITHOUT the
 * duplicate closure vertex; consumers wrap last→first through this law.
 * The tolerance mirrors the legacy PLINE/TRAVERSE adjacent-dedupe floor.
 *
 * Phase C2 extends this module with the ONE canonical polyline path
 * normalizer for optional per-course bulge + width metadata. The signed
 * bulge convention is the Phase 19C/20A seam verbatim
 * (describeParcelArcCourse: b = tan(sweepRad/4), positive = CCW =
 * center-left, |b| > 1 = major). No second convention is introduced.
 */

import {
  CAD_PARCEL_ARC_FULL_CIRCLE_SWEEP_DEG,
  CAD_PARCEL_ARC_ZERO_CHORD_TOLERANCE,
  CAD_PARCEL_BULGE_LINE_FLOOR,
  describeParcelArcCourse,
  parcelBulgeFromArcDefinition,
} from './cadParcelArcGeometry';
import { cadBuildArcFromThreePoints } from './cadGeometryArcPrimitives';
import type { CadPolylineSegmentGeometry, CadPolylineSegmentWidth } from './cadTypes';

export const CAD_POLYLINE_DEDUPE_EPSILON = 1e-9;

export const cadPolylinePointsMatch = (
  first: { x: number; y: number },
  second: { x: number; y: number },
): boolean =>
  Math.abs(first.x - second.x) <= CAD_POLYLINE_DEDUPE_EPSILON &&
  Math.abs(first.y - second.y) <= CAD_POLYLINE_DEDUPE_EPSILON;

/**
 * True when a closed ring's stored vertices still need the last→first edge
 * synthesized. False for a legacy closed ring that already repeats its first
 * vertex (e.g. TRAVERSE), so its stored N-1 edges are never doubled.
 */
export const cadPolylineVerticesWrapToFirst = (
  vertices: readonly { x: number; y: number }[],
  closed: boolean,
): boolean =>
  closed &&
  vertices.length >= 2 &&
  !cadPolylinePointsMatch(vertices[0]!, vertices[vertices.length - 1]!);

/**
 * Distinct positions under the 1e-9 equality law (closed-only gate).
 * Counts unique positions by first-seen representative; nonadjacent
 * repeats do not inflate the count. Open polylines never use this gate.
 */
export const countDistinctPlinePositions = (
  vertices: readonly { x: number; y: number }[],
): number => {
  const representatives: { x: number; y: number }[] = [];
  for (const vertex of vertices) {
    if (!representatives.some((seen) => cadPolylinePointsMatch(vertex, seen))) {
      representatives.push(vertex);
    }
  }
  return representatives.length;
};

/**
 * Canonical retained vertices. Generic in the vertex type so labels ride
 * along unchanged (no schema change, no reordering). Open rings keep every
 * distinct adjacent vertex; closed rings also drop a redundant repeated
 * final vertex.
 */
export const sanitizeCadPolylineVertices = <Vertex extends { x: number; y: number }>(
  vertices: readonly Vertex[],
  closed: boolean,
): Vertex[] => {
  const deduped = vertices.filter((vertex, index) => {
    const previous = vertices[index - 1];
    if (!previous) return true;
    return !cadPolylinePointsMatch(vertex, previous);
  });
  if (
    closed &&
    deduped.length >= 2 &&
    cadPolylinePointsMatch(deduped[0]!, deduped[deduped.length - 1]!)
  ) {
    return deduped.slice(0, -1);
  }
  return deduped;
};

// ---------------------------------------------------------------------------
// Phase C2 — per-course segment metadata (bulge + width).
// ---------------------------------------------------------------------------

/** Course count law shared with feature lines/parcels: entry [index] is the
 *  course starting at vertices[index]; open = n-1, closed = n. */
export const cadPolylineCourseCount = (vertexCount: number, closed: boolean): number =>
  closed ? vertexCount : vertexCount - 1;

export type CadPolylineSegmentMetadataIssueCode =
  | 'GEOMETRY_NOT_ARRAY'
  | 'GEOMETRY_COUNT_MISMATCH'
  | 'INVALID_GEOMETRY_ENTRY'
  | 'NON_FINITE_BULGE'
  | 'ZERO_BULGE_ARC'
  | 'SUB_FLOOR_ARC'
  | 'ZERO_CHORD_ARC'
  | 'SWEEP_NEAR_FULL_CIRCLE'
  | 'INVALID_ARC'
  | 'WIDTHS_NOT_ARRAY'
  | 'WIDTHS_COUNT_MISMATCH'
  | 'INVALID_WIDTH_ENTRY'
  | 'NON_FINITE_WIDTH'
  | 'NEGATIVE_WIDTH';

export interface CadPolylineSegmentMetadataIssue {
  courseIndex: number;
  code: CadPolylineSegmentMetadataIssueCode;
  message: string;
}

const metadataIssue = (
  courseIndex: number,
  code: CadPolylineSegmentMetadataIssueCode,
  message: string,
): CadPolylineSegmentMetadataIssue => ({ courseIndex, code, message });

/**
 * Per-entry validation of ONE segmentGeometry entry against its course
 * endpoints. Shared by the full metadata validator AND the consumer course
 * resolver so a malformed entry (absent, unknown kind, sub-floor/zero/
 * non-finite bulge, degenerate chord, underivable arc) can never be
 * silently straightened to a line. Returns null when the entry is a valid
 * line or arc. Never converts an arc to a line.
 */
export const validateCadPolylineGeometryEntry = (
  courseIndex: number,
  entry: CadPolylineSegmentGeometry | null | undefined,
  from: { x: number; y: number } | undefined,
  to: { x: number; y: number } | undefined,
): CadPolylineSegmentMetadataIssue | null => {
  if (entry == null || typeof entry !== 'object') {
    return metadataIssue(courseIndex, 'INVALID_GEOMETRY_ENTRY', `course ${courseIndex} geometry entry is malformed`);
  }
  if (entry.kind === 'line') return null;
  if (entry.kind !== 'arc') {
    return metadataIssue(courseIndex, 'INVALID_GEOMETRY_ENTRY', `course ${courseIndex} geometry kind is not line/arc`);
  }
  if (!Number.isFinite(entry.bulge)) {
    return metadataIssue(courseIndex, 'NON_FINITE_BULGE', `course ${courseIndex} arc bulge is non-finite`);
  }
  if (entry.bulge === 0) {
    return metadataIssue(courseIndex, 'ZERO_BULGE_ARC', `course ${courseIndex} declares arc with zero bulge (declare line instead)`);
  }
  if (Math.abs(entry.bulge) < CAD_PARCEL_BULGE_LINE_FLOOR) {
    return metadataIssue(courseIndex, 'SUB_FLOOR_ARC', `course ${courseIndex} arc bulge is below the line floor (declare line instead)`);
  }
  if (![from?.x, from?.y, to?.x, to?.y].every(Number.isFinite)) {
    return metadataIssue(courseIndex, 'INVALID_ARC', `course ${courseIndex} has a non-finite endpoint`);
  }
  if (!(Math.hypot(to!.x - from!.x, to!.y - from!.y) > CAD_PARCEL_ARC_ZERO_CHORD_TOLERANCE)) {
    return metadataIssue(courseIndex, 'ZERO_CHORD_ARC', `course ${courseIndex} declares arc on coincident endpoints`);
  }
  const sweepDeg = (4 * Math.atan(entry.bulge) * 180) / Math.PI;
  if (Math.abs(sweepDeg) >= CAD_PARCEL_ARC_FULL_CIRCLE_SWEEP_DEG) {
    return metadataIssue(courseIndex, 'SWEEP_NEAR_FULL_CIRCLE', `course ${courseIndex} sweep ~360deg is blocked`);
  }
  if (!describeParcelArcCourse(from!, to!, entry.bulge)) {
    return metadataIssue(courseIndex, 'INVALID_ARC', `course ${courseIndex} derives no valid arc`);
  }
  return null;
};

/**
 * Structural + numeric validation of optional segmentGeometry/segmentWidths
 * against a vertex array (NO dedupe/strip — callers own canonical ring
 * shape). Absent metadata is valid. Present arrays must match the course
 * count exactly. Line entries are trivially valid; arc entries require a
 * finite, at/above-floor, non-zero bulge whose exact arc derives on a
 * non-degenerate chord (describeParcelArcCourse). Widths require finite,
 * >=0 values. Used by the path normalizer AND the persistence clone
 * (fail-closed load). Never converts an arc to a line.
 */
export const validateCadPolylineSegmentMetadata = (
  vertices: readonly { x: number; y: number }[],
  closed: boolean,
  segmentGeometry?: readonly CadPolylineSegmentGeometry[],
  segmentWidths?: readonly CadPolylineSegmentWidth[],
): { ok: boolean; issues: CadPolylineSegmentMetadataIssue[] } => {
  const issues: CadPolylineSegmentMetadataIssue[] = [];
  const courseCount = cadPolylineCourseCount(vertices.length, closed);

  if (segmentGeometry != null) {
    if (!Array.isArray(segmentGeometry)) {
      issues.push(metadataIssue(-1, 'GEOMETRY_NOT_ARRAY', 'segmentGeometry is not an array'));
    } else if (segmentGeometry.length !== courseCount) {
      issues.push(
        metadataIssue(
          -1,
          'GEOMETRY_COUNT_MISMATCH',
          `segmentGeometry.length ${segmentGeometry.length} !== course count ${courseCount}`,
        ),
      );
    } else {
      // Index iteration (NOT forEach/every): a sparse array must never skip a
      // hole and validate. A hole reads as undefined and fails closed through
      // validateCadPolylineGeometryEntry, matching the resolver.
      for (let courseIndex = 0; courseIndex < segmentGeometry.length; courseIndex += 1) {
        const issue = validateCadPolylineGeometryEntry(
          courseIndex,
          segmentGeometry[courseIndex],
          vertices[courseIndex],
          vertices[(courseIndex + 1) % vertices.length],
        );
        if (issue) issues.push(issue);
      }
    }
  }

  if (segmentWidths != null) {
    if (!Array.isArray(segmentWidths)) {
      issues.push(metadataIssue(-1, 'WIDTHS_NOT_ARRAY', 'segmentWidths is not an array'));
    } else if (segmentWidths.length !== courseCount) {
      issues.push(
        metadataIssue(
          -1,
          'WIDTHS_COUNT_MISMATCH',
          `segmentWidths.length ${segmentWidths.length} !== course count ${courseCount}`,
        ),
      );
    } else {
      // Index iteration (NOT forEach): a sparse array hole reads as undefined
      // and fails closed as a malformed width entry instead of being skipped.
      for (let courseIndex = 0; courseIndex < segmentWidths.length; courseIndex += 1) {
        const entry = segmentWidths[courseIndex];
        if (entry == null || typeof entry !== 'object') {
          issues.push(metadataIssue(courseIndex, 'INVALID_WIDTH_ENTRY', `course ${courseIndex} width entry is malformed`));
          continue;
        }
        if (!Number.isFinite(entry.startWidth) || !Number.isFinite(entry.endWidth)) {
          issues.push(metadataIssue(courseIndex, 'NON_FINITE_WIDTH', `course ${courseIndex} width is non-finite`));
          continue;
        }
        if (entry.startWidth < 0 || entry.endWidth < 0) {
          issues.push(metadataIssue(courseIndex, 'NEGATIVE_WIDTH', `course ${courseIndex} width is negative`));
        }
      }
    }
  }

  return { ok: issues.length === 0, issues };
};

/** Vertex accepted by the path normalizer: plain XY plus an optional label
 *  (command payloads carry `label`; persisted entities pass `labels`). */
export interface CadPolylinePathVertex {
  x: number;
  y: number;
  label?: string;
}

export type CadPolylinePathResult =
  | {
      ok: true;
      vertices: { x: number; y: number }[];
      vertexLabels: string[];
      segmentGeometry?: CadPolylineSegmentGeometry[];
      segmentWidths?: CadPolylineSegmentWidth[];
      closed: boolean;
    }
  | { ok: false; error: string };

const failPath = (error: string): CadPolylinePathResult => ({ ok: false, error });

/** Retained-vertex minimum + closed-distinct gate (same law as the command). */
const gateRetainedPolylineVertices = (
  vertices: readonly { x: number; y: number }[],
  closed: boolean,
): string | null => {
  const minimum = closed ? 3 : 2;
  if (vertices.length < minimum) {
    return `PLINE ${closed ? 'closed' : 'open'} needs >=${minimum} retained vertices`;
  }
  if (closed && countDistinctPlinePositions(vertices) < 3) {
    return 'PLINE closed ring needs >=3 distinct vertices';
  }
  return null;
};

/**
 * Phase C2 canonical polyline path normalizer.
 *
 * Legacy input (no metadata) keeps the C1 law byte-for-byte: adjacent 1e-9
 * dedupe, closed redundant-final strip, label alignment. With metadata
 * present an adjacent/interior duplicate would shift arc/width ownership,
 * so it FAILS CLOSED instead of silently dedupe-shifting. A closed
 * redundant final vertex is stripped together with its outgoing (zero-length)
 * course entry; a nonzero arc/width on that entry fails closed as ambiguous.
 * Present geometry/width arrays must match the course count; arcs validate
 * through the shared parcel seam; widths are finite and >=0. All-line
 * geometry and all-zero widths canonicalize back to absent so legacy files
 * stay byte-clean. Explicit arcs/widths are preserved exactly — never
 * straightened, never sign-flipped.
 */
export const sanitizeCadPolylinePath = (
  vertices: readonly CadPolylinePathVertex[],
  closed: boolean,
  segmentGeometry?: readonly CadPolylineSegmentGeometry[],
  segmentWidths?: readonly CadPolylineSegmentWidth[],
  labels?: readonly string[],
): CadPolylinePathResult => {
  if (!Array.isArray(vertices)) return failPath('PLINE vertices is not an array');
  if (labels != null && (!Array.isArray(labels) || labels.length !== vertices.length)) {
    return failPath('PLINE vertexLabels length does not match vertices');
  }
  const resolvedLabels = vertices.map((vertex, index) => {
    if (labels != null) return labels[index] ?? '';
    return typeof vertex?.label === 'string' ? vertex.label : '';
  });

  const hasGeometry = segmentGeometry != null;
  const hasWidths = segmentWidths != null;
  if (hasGeometry && !Array.isArray(segmentGeometry)) return failPath('PLINE segmentGeometry is not an array');
  if (hasWidths && !Array.isArray(segmentWidths)) return failPath('PLINE segmentWidths is not an array');

  // Legacy plain path: no shift risk, C1 law applies verbatim.
  if (!hasGeometry && !hasWidths) {
    const annotated = vertices.map((vertex, index) => ({
      x: vertex.x,
      y: vertex.y,
      label: resolvedLabels[index]!,
    }));
    const retained = sanitizeCadPolylineVertices(annotated, closed);
    const gateError = gateRetainedPolylineVertices(retained, closed);
    if (gateError) return failPath(gateError);
    return {
      ok: true,
      vertices: retained.map(({ x, y }) => ({ x, y })),
      vertexLabels: retained.map((vertex) => vertex.label),
      closed,
    };
  }

  const rawCourseCount = cadPolylineCourseCount(vertices.length, closed);
  if (hasGeometry && segmentGeometry!.length !== rawCourseCount) {
    return failPath(`PLINE segmentGeometry.length ${segmentGeometry!.length} !== course count ${rawCourseCount}`);
  }
  if (hasWidths && segmentWidths!.length !== rawCourseCount) {
    return failPath(`PLINE segmentWidths.length ${segmentWidths!.length} !== course count ${rawCourseCount}`);
  }

  let workVertices = vertices.map((vertex, index) => ({
    x: vertex.x,
    y: vertex.y,
    label: resolvedLabels[index]!,
  }));
  let workGeometry = hasGeometry ? [...segmentGeometry!] : undefined;
  let workWidths = hasWidths ? [...segmentWidths!] : undefined;

  // Closed redundant final vertex: strip only its outgoing (zero-length)
  // course entry. A real arc/width there is ambiguous ownership.
  if (
    closed &&
    workVertices.length >= 2 &&
    cadPolylinePointsMatch(workVertices[0]!, workVertices[workVertices.length - 1]!)
  ) {
    const lastIndex = workVertices.length - 1;
    const outgoingGeometry = workGeometry?.[lastIndex];
    if (outgoingGeometry != null && outgoingGeometry.kind !== 'line') {
      return failPath('PLINE redundant closure vertex carries an arc course (ambiguous ownership)');
    }
    const outgoingWidth = workWidths?.[lastIndex];
    if (outgoingWidth != null && (outgoingWidth.startWidth !== 0 || outgoingWidth.endWidth !== 0)) {
      return failPath('PLINE redundant closure vertex carries a nonzero width (ambiguous ownership)');
    }
    workVertices = workVertices.slice(0, -1);
    if (workGeometry) workGeometry = workGeometry.slice(0, -1);
    if (workWidths) workWidths = workWidths.slice(0, -1);
  }

  // Any remaining adjacent duplicate would shift metadata ownership: fail
  // closed, never silently dedupe.
  for (let index = 1; index < workVertices.length; index += 1) {
    if (cadPolylinePointsMatch(workVertices[index - 1]!, workVertices[index]!)) {
      return failPath(
        `PLINE adjacent duplicate vertex at index ${index} cannot be deduped without shifting segment metadata`,
      );
    }
  }
  if (
    closed &&
    workVertices.length >= 2 &&
    cadPolylinePointsMatch(workVertices[0]!, workVertices[workVertices.length - 1]!)
  ) {
    return failPath('PLINE closed metadata ring still repeats its first vertex');
  }

  const gateError = gateRetainedPolylineVertices(workVertices, closed);
  if (gateError) return failPath(gateError);

  const validation = validateCadPolylineSegmentMetadata(workVertices, closed, workGeometry, workWidths);
  if (!validation.ok) return failPath(validation.issues[0]!.message);

  const canonicalGeometry =
    workGeometry && workGeometry.some((entry) => entry.kind === 'arc')
      ? workGeometry.map((entry) =>
          entry.kind === 'arc'
            ? ({ kind: 'arc', bulge: entry.bulge } as const)
            : ({ kind: 'line' } as const),
        )
      : undefined;
  const canonicalWidths =
    workWidths && workWidths.some((entry) => entry.startWidth !== 0 || entry.endWidth !== 0)
      ? workWidths.map((entry) => ({
          startWidth: entry.startWidth,
          endWidth: entry.endWidth,
        }))
      : undefined;

  return {
    ok: true,
    vertices: workVertices.map(({ x, y }) => ({ x, y })),
    vertexLabels: workVertices.map((vertex) => vertex.label),
    ...(canonicalGeometry ? { segmentGeometry: canonicalGeometry } : {}),
    ...(canonicalWidths ? { segmentWidths: canonicalWidths } : {}),
    closed,
  };
};

// ---------------------------------------------------------------------------
// Phase C2 pure geometry helpers (consumer/transform handoff seams).
// ---------------------------------------------------------------------------

/**
 * Full centred band width (metres) at a course fraction in [0,1], linear
 * from startWidth at 0 to endWidth at 1. Null outside the range or on
 * non-finite input — never clipped, never extrapolated.
 */
export const cadPolylineWidthAtFraction = (
  width: CadPolylineSegmentWidth,
  fraction: number,
): number | null => {
  if (!Number.isFinite(width.startWidth) || !Number.isFinite(width.endWidth)) return null;
  if (!Number.isFinite(fraction) || fraction < 0 || fraction > 1) return null;
  return width.startWidth + (width.endWidth - width.startWidth) * fraction;
};

/**
 * Three-point → signed bulge for a start→end course through `through`
 * (exact inverse of describeParcelArcCourse). Reuses the shared 3-point
 * circumcircle + parcel bulge seam verbatim; returns null for collinear,
 * coincident, or near-full-circle triples (never guesses a direction).
 */
export const cadPolylineBulgeFromThreePoints = (
  start: { x: number; y: number },
  through: { x: number; y: number },
  end: { x: number; y: number },
): number | null => {
  const arc = cadBuildArcFromThreePoints(start, through, end);
  if (!arc) return null;
  const forward =
    cadPolylinePointsMatch(arc.startPoint, start) && cadPolylinePointsMatch(arc.endPoint, end);
  return parcelBulgeFromArcDefinition({
    from: start,
    to: end,
    center: arc.center,
    radius: arc.radius,
    signedSweepDeg: forward ? arc.deltaDeg : -arc.deltaDeg,
  });
};

/**
 * Moved-vertex revalidation seam for grip/transform-core: a vertex move
 * keeps every stored bulge and width verbatim (metrics re-derive from the
 * moved endpoints), so the only work is confirming the new endpoints still
 * carry valid metadata. Returns the issues (empty = valid). Consumers
 * replace the vertex array and keep segmentGeometry/segmentWidths as-is;
 * a non-empty result means fail closed. Callers with no metadata should
 * keep their existing (non-deduping) move path.
 */
export const revalidateCadPolylineVertexMove = (
  vertices: readonly { x: number; y: number }[],
  closed: boolean,
  segmentGeometry?: readonly CadPolylineSegmentGeometry[],
  segmentWidths?: readonly CadPolylineSegmentWidth[],
): CadPolylineSegmentMetadataIssue[] =>
  validateCadPolylineSegmentMetadata(vertices, closed, segmentGeometry, segmentWidths).issues;
