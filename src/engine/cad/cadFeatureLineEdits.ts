// Phase 20A CORE — feature-line edit operators (pure, engine only).
//
// Every operator takes an entity and returns a NEW entity (never mutates
// input), or a fail-closed { ok: false, reason }. Stations always
// re-derive from plan geometry at resolve time, so edits never persist
// stationing — reverse "resets stations" by construction.

import { createStableRuntimeId } from '../id';
import {
  CAD_PARCEL_ARC_FULL_CIRCLE_SWEEP_DEG,
  CAD_PARCEL_BULGE_LINE_FLOOR,
  parcelBulgeFromArcDefinition,
  splitParcelArcCourse,
} from './cadParcelArcGeometry';
import {
  buildFeatureLineVertexId,
  createFeatureLineVertexId,
  getFeatureLineCourseCount,
  getFeatureLineElevationAtStation,
  getFeatureLinePointAtStation,
  resolveCadFeatureLine,
  sanitizeFeatureLine,
} from './cadFeatureLines';
import type { CadFeatureLineEntity, CadFeatureLineSegmentGeometry } from './cadTypes';

export type FeatureLineEditResult =
  | { ok: true; entity: CadFeatureLineEntity }
  | { ok: false; reason: string };

const STATION_TOLERANCE = 1e-9;

const cloneGeometry = (
  geometry: readonly CadFeatureLineSegmentGeometry[] | undefined,
): CadFeatureLineSegmentGeometry[] | undefined =>
  geometry?.map((entry) => ({ ...entry }));

const canonicalKind = (entry: CadFeatureLineSegmentGeometry | undefined): 'line' | 'arc' =>
  entry?.kind === 'arc' && Math.abs(entry.bulge) >= CAD_PARCEL_BULGE_LINE_FLOOR ? 'arc' : 'line';

/**
 * COPY: new entity id + fresh vertex ids (never shared with the source),
 * optional XY offset (Z unchanged), owned geometry clone (endpoint-relative
 * bulges translate exactly — no source association, no shared array).
 */
export const copyFeatureLineEntity = (
  entity: CadFeatureLineEntity,
  deltaX = 0,
  deltaY = 0,
): CadFeatureLineEntity => {
  const copyId = createStableRuntimeId('cad-feature-line');
  const stableSuffixes = entity.vertices.map(() => createStableRuntimeId('feature-line-vertex'));
  return {
    ...entity,
    id: copyId,
    vertices: entity.vertices.map((vertex, index) => ({
      id: buildFeatureLineVertexId(copyId, stableSuffixes[index]!),
      x: vertex.x + deltaX,
      y: vertex.y + deltaY,
      z: vertex.z,
    })),
    segmentGeometry: cloneGeometry(entity.segmentGeometry),
    metadata: { ...entity.metadata, createdBy: 'COPY', manual: true },
  };
};

/**
 * Insert a vertex on a course at an interior plan station. The new vertex
 * rides the course exactly (line = linear, arc = true circle at the
 * arc-length station, Z by plan fraction). Fails closed on endpoint
 * stations, out-of-range stations, or un-splittable arcs.
 */
export const insertFeatureLineVertex = (
  entity: CadFeatureLineEntity,
  courseIndex: number,
  station: number,
): FeatureLineEditResult => {
  const resolved = resolveCadFeatureLine(entity);
  if (!resolved) return { ok: false, reason: 'FEATURE_LINE_INVALID' };
  const course = resolved.courses[courseIndex];
  if (!course) return { ok: false, reason: 'FEATURE_LINE_COURSE_NOT_FOUND' };
  if (!Number.isFinite(station)) return { ok: false, reason: 'FEATURE_LINE_STATION_NOT_FINITE' };
  if (station <= course.startStation + STATION_TOLERANCE || station >= course.endStation - STATION_TOLERANCE) {
    return { ok: false, reason: 'FEATURE_LINE_INSERT_AT_ENDPOINT_BLOCKED' };
  }
  const point = getFeatureLinePointAtStation(resolved, station);
  if (!point) return { ok: false, reason: 'FEATURE_LINE_STATION_OUT_OF_RANGE' };
  const entry = entity.segmentGeometry?.[courseIndex];
  let newEntries: CadFeatureLineSegmentGeometry[] | undefined;
  if (entity.segmentGeometry != null) {
    if (canonicalKind(entry) === 'arc') {
      const split = splitParcelArcCourse(
        { x: course.from.x, y: course.from.y },
        { x: course.to.x, y: course.to.y },
        (entry as { bulge: number }).bulge,
        { x: point.x, y: point.y },
      );
      if (!split) return { ok: false, reason: 'FEATURE_LINE_ARC_SPLIT_FAILED' };
      newEntries = [
        ...entity.segmentGeometry.slice(0, courseIndex),
        { kind: 'arc', bulge: split.bulgeBefore },
        { kind: 'arc', bulge: split.bulgeAfter },
        ...entity.segmentGeometry.slice(courseIndex + 1),
      ];
    } else {
      newEntries = [
        ...entity.segmentGeometry.slice(0, courseIndex),
        { kind: 'line' },
        { kind: 'line' },
        ...entity.segmentGeometry.slice(courseIndex + 1),
      ];
    }
  }
  const vertex = { id: createFeatureLineVertexId(entity.id), x: point.x, y: point.y, z: point.z };
  // Closing course (index === vertices.length - 1 on a closed line) appends.
  const insertAt = courseIndex + 1;
  return {
    ok: true,
    entity: {
      ...entity,
      vertices: [...entity.vertices.slice(0, insertAt), vertex, ...entity.vertices.slice(insertAt)],
      ...(newEntries != null ? { segmentGeometry: newEntries } : {}),
    },
  };
};

const sameCircle = (
  before: { center: { x: number; y: number }; radius: number; signedSweepDeg: number },
  after: { center: { x: number; y: number }; radius: number; signedSweepDeg: number },
): boolean => {
  if (Math.sign(before.signedSweepDeg) !== Math.sign(after.signedSweepDeg)) return false;
  const tolerance = Math.max(1e-9, before.radius * 1e-9, after.radius * 1e-9);
  return (
    Math.hypot(before.center.x - after.center.x, before.center.y - after.center.y) <= tolerance &&
    Math.abs(before.radius - after.radius) <= tolerance
  );
};

/**
 * Delete a vertex. Endpoints of an open line drop freely. Interior merges
 * follow the policy: line+line = new straight leg; arc+arc merges only on
 * the same circle, same direction, contiguous (else BLOCK); line+arc in
 * either order BLOCKS (never silently straightens a curve).
 */
export const deleteFeatureLineVertex = (
  entity: CadFeatureLineEntity,
  vertexIndex: number,
): FeatureLineEditResult => {
  const closed = entity.closed === true;
  const vertexCount = entity.vertices.length;
  if (!Number.isInteger(vertexIndex) || vertexIndex < 0 || vertexIndex >= vertexCount) {
    return { ok: false, reason: 'FEATURE_LINE_VERTEX_NOT_FOUND' };
  }
  const minVertices = closed ? 3 : 2;
  if (vertexCount - 1 < minVertices) return { ok: false, reason: 'FEATURE_LINE_DELETE_MIN_VERTICES' };
  const resolved = resolveCadFeatureLine(entity);
  if (!resolved) return { ok: false, reason: 'FEATURE_LINE_INVALID' };
  const isEndpoint = !closed && (vertexIndex === 0 || vertexIndex === vertexCount - 1);
  if (isEndpoint) {
    const vertices =
      vertexIndex === 0 ? entity.vertices.slice(1) : entity.vertices.slice(0, -1);
    let segmentGeometry = cloneGeometry(entity.segmentGeometry);
    if (segmentGeometry != null) {
      segmentGeometry = vertexIndex === 0 ? segmentGeometry.slice(1) : segmentGeometry.slice(0, -1);
    }
    return {
      ok: true,
      entity: { ...entity, vertices, ...(segmentGeometry != null ? { segmentGeometry } : {}) },
    };
  }
  const courseCount = getFeatureLineCourseCount(entity);
  const beforeIndex = (vertexIndex + courseCount - 1) % courseCount;
  const afterIndex = closed ? vertexIndex % courseCount : vertexIndex;
  const beforeEntry = entity.segmentGeometry?.[beforeIndex];
  const afterEntry = entity.segmentGeometry?.[afterIndex];
  const beforeKind = canonicalKind(beforeEntry);
  const afterKind = canonicalKind(afterEntry);
  if (beforeKind !== afterKind) {
    return { ok: false, reason: 'FEATURE_LINE_DELETE_MIXED_CURVATURE_BLOCKED' };
  }
  let segmentGeometry = cloneGeometry(entity.segmentGeometry);
  if (segmentGeometry != null) {
    if (beforeKind === 'arc') {
      const beforeCourse = resolved.courses[beforeIndex]!;
      const afterCourse = resolved.courses[afterIndex]!;
      if (
        beforeCourse.center == null || afterCourse.center == null ||
        beforeCourse.radius == null || afterCourse.radius == null ||
        beforeCourse.signedSweepDeg == null || afterCourse.signedSweepDeg == null
      ) {
        return { ok: false, reason: 'FEATURE_LINE_INVALID' };
      }
      if (!sameCircle(
        { center: beforeCourse.center, radius: beforeCourse.radius, signedSweepDeg: beforeCourse.signedSweepDeg },
        { center: afterCourse.center, radius: afterCourse.radius, signedSweepDeg: afterCourse.signedSweepDeg },
      )) {
        return { ok: false, reason: 'FEATURE_LINE_DELETE_ARC_MERGE_BLOCKED' };
      }
      const mergedSweepDeg = beforeCourse.signedSweepDeg + afterCourse.signedSweepDeg;
      if (Math.abs(mergedSweepDeg) >= CAD_PARCEL_ARC_FULL_CIRCLE_SWEEP_DEG) {
        return { ok: false, reason: 'FEATURE_LINE_DELETE_ARC_MERGE_BLOCKED' };
      }
      const mergedBulge = parcelBulgeFromArcDefinition({
        from: { x: beforeCourse.from.x, y: beforeCourse.from.y },
        to: { x: afterCourse.to.x, y: afterCourse.to.y },
        center: beforeCourse.center,
        radius: beforeCourse.radius,
        signedSweepDeg: mergedSweepDeg,
      });
      if (mergedBulge == null) return { ok: false, reason: 'FEATURE_LINE_DELETE_ARC_MERGE_BLOCKED' };
      const ordered = [beforeIndex, afterIndex].sort((a, b) => a - b);
      const [first, second] = [ordered[0]!, ordered[1]!];
      if (second - first === 1) {
        // Adjacent pair: replace both with the merged arc.
        segmentGeometry = [
          ...segmentGeometry.slice(0, first),
          { kind: 'arc', bulge: mergedBulge },
          ...segmentGeometry.slice(second + 1),
        ];
      } else {
        // Wrapped pair (vertex 0 of a closed line: closing + opening
        // courses): merged leg closes the new ring, so it goes last.
        segmentGeometry = [
          ...segmentGeometry.slice(1, second),
          ...segmentGeometry.slice(second + 1),
          { kind: 'arc', bulge: mergedBulge },
        ];
      }
    } else {
      const ordered = [beforeIndex, afterIndex].sort((a, b) => a - b);
      const [first, second] = [ordered[0]!, ordered[1]!];
      if (second - first === 1) {
        segmentGeometry = [
          ...segmentGeometry.slice(0, first),
          { kind: 'line' } as CadFeatureLineSegmentGeometry,
          ...segmentGeometry.slice(second + 1),
        ];
      } else {
        // Wrapped pair (vertex 0 of a closed line): merged leg closes
        // the new ring, so it goes last.
        segmentGeometry = [
          ...segmentGeometry.slice(1, second),
          ...segmentGeometry.slice(second + 1),
          { kind: 'line' } as CadFeatureLineSegmentGeometry,
        ];
      }
    }
  }
  // Zero-plan-length guard: merging two legs must still advance station.
  const next: CadFeatureLineEntity = {
    ...entity,
    vertices: [...entity.vertices.slice(0, vertexIndex), ...entity.vertices.slice(vertexIndex + 1)],
    ...(segmentGeometry != null ? { segmentGeometry } : {}),
  };
  const issues = sanitizeFeatureLine(next);
  if (!issues.ok) return { ok: false, reason: `FEATURE_LINE_DELETE_INVALID:${issues.issues[0]?.code ?? 'UNKNOWN'}` };
  return { ok: true, entity: next };
};

/**
 * Reverse vertex order (ids ride with their vertices), reverse the geometry
 * array, flip bulge signs (handedness flips with traversal). Stations
 * re-derive from 0 at resolve time; grades flip sign honestly.
 */
export const reverseFeatureLine = (entity: CadFeatureLineEntity): CadFeatureLineEntity => {
  const courseCount = getFeatureLineCourseCount(entity);
  const vertices = [...entity.vertices].reverse();
  let segmentGeometry = cloneGeometry(entity.segmentGeometry);
  if (segmentGeometry != null) {
    const reversed: CadFeatureLineSegmentGeometry[] = [];
    for (let index = courseCount - 1; index >= 0; index -= 1) {
      const entry = segmentGeometry[index]!;
      reversed.push(entry.kind === 'arc' ? { kind: 'arc', bulge: -entry.bulge } : { kind: 'line' });
    }
    segmentGeometry = reversed;
  }
  return { ...entity, vertices, ...(segmentGeometry != null ? { segmentGeometry } : {}) };
};

export interface FeatureLineGradeSpan {
  fromStation: number;
  toStation: number;
  gradeRatio: number;
}

/**
 * Set a constant grade over an ordered station span:
 * z(s) = zStart + grade*(s - sStart) for every vertex in the span
 * (grade-all-intermediates default). Vertices outside the span keep
 * their Z. Fails closed on non-finite input or out-of-range spans.
 */
export const setFeatureLineGradeSpan = (
  entity: CadFeatureLineEntity,
  span: FeatureLineGradeSpan,
): FeatureLineEditResult => {
  const resolved = resolveCadFeatureLine(entity);
  if (!resolved) return { ok: false, reason: 'FEATURE_LINE_INVALID' };
  const { fromStation, toStation, gradeRatio } = span;
  if (![fromStation, toStation, gradeRatio].every(Number.isFinite)) {
    return { ok: false, reason: 'FEATURE_LINE_GRADE_NOT_FINITE' };
  }
  const start = Math.min(fromStation, toStation);
  const end = Math.max(fromStation, toStation);
  if (start < 0 || end > resolved.planLength + STATION_TOLERANCE || end - start <= STATION_TOLERANCE) {
    return { ok: false, reason: 'FEATURE_LINE_GRADE_SPAN_OUT_OF_RANGE' };
  }
  const zStart = getFeatureLineElevationAtStation(resolved, Math.min(end, Math.max(start, 0)));
  if (zStart == null) return { ok: false, reason: 'FEATURE_LINE_STATION_OUT_OF_RANGE' };
  const vertices = entity.vertices.map((vertex, index) => {
    const station = resolved.stations[index]!;
    if (station < start - STATION_TOLERANCE || station > end + STATION_TOLERANCE) return vertex;
    return { ...vertex, z: zStart + gradeRatio * (station - start) };
  });
  return { ok: true, entity: { ...entity, vertices } };
};

/**
 * Linearly interpolate Z by cumulative plan station across a span:
 * endpoints take the span-end elevations, intermediates lerp by station
 * (NOT by vertex index — mixed line/arc legs interpolate honestly).
 */
export const interpolateFeatureLineSpan = (
  entity: CadFeatureLineEntity,
  fromStation: number,
  toStation: number,
): FeatureLineEditResult => {
  const resolved = resolveCadFeatureLine(entity);
  if (!resolved) return { ok: false, reason: 'FEATURE_LINE_INVALID' };
  if (![fromStation, toStation].every(Number.isFinite)) {
    return { ok: false, reason: 'FEATURE_LINE_STATION_NOT_FINITE' };
  }
  const start = Math.min(fromStation, toStation);
  const end = Math.max(fromStation, toStation);
  if (start < 0 || end > resolved.planLength + STATION_TOLERANCE || end - start <= STATION_TOLERANCE) {
    return { ok: false, reason: 'FEATURE_LINE_SPAN_OUT_OF_RANGE' };
  }
  const zStart = getFeatureLineElevationAtStation(resolved, start);
  const zEnd = getFeatureLineElevationAtStation(resolved, end);
  if (zStart == null || zEnd == null) return { ok: false, reason: 'FEATURE_LINE_STATION_OUT_OF_RANGE' };
  const vertices = entity.vertices.map((vertex, index) => {
    const station = resolved.stations[index]!;
    if (station < start - STATION_TOLERANCE || station > end + STATION_TOLERANCE) return vertex;
    const fraction = (station - start) / (end - start);
    return { ...vertex, z: zStart + (zEnd - zStart) * fraction };
  });
  return { ok: true, entity: { ...entity, vertices } };
};

/**
 * Absolute Z on every vertex (or a subset by vertex id). Z channel only —
 * plan geometry never moves. Fail closed on non-finite Z or an unknown
 * vertex-id filter (never a silent no-op).
 */
export const setFeatureLineVertexElevations = (
  entity: CadFeatureLineEntity,
  z: number,
  vertexIds?: readonly string[],
): FeatureLineEditResult => {
  if (!Number.isFinite(z)) return { ok: false, reason: 'FEATURE_LINE_ELEVATION_NOT_FINITE' };
  const filter = vertexIds != null ? new Set(vertexIds) : null;
  if (filter != null && !entity.vertices.some((vertex) => filter.has(vertex.id))) {
    return { ok: false, reason: 'FEATURE_LINE_VERTEX_NOT_FOUND' };
  }
  return {
    ok: true,
    entity: {
      ...entity,
      vertices: entity.vertices.map((vertex) =>
        filter != null && !filter.has(vertex.id) ? vertex : { ...vertex, z },
      ),
    },
  };
};

/**
 * Raise/lower every vertex by deltaZ (or a subset by vertex id). Z channel
 * only — plan geometry never moves.
 */
export const raiseLowerFeatureLine = (
  entity: CadFeatureLineEntity,
  deltaZ: number,
  vertexIds?: readonly string[],
): FeatureLineEditResult => {
  if (!Number.isFinite(deltaZ)) return { ok: false, reason: 'FEATURE_LINE_DELTA_NOT_FINITE' };
  const filter = vertexIds != null ? new Set(vertexIds) : null;
  return {
    ok: true,
    entity: {
      ...entity,
      vertices: entity.vertices.map((vertex) =>
        filter != null && !filter.has(vertex.id) ? vertex : { ...vertex, z: vertex.z + deltaZ },
      ),
    },
  };
};
