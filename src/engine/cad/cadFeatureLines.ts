// Phase 20A CORE — first-class 3D feature-line authoritative geometry.
//
// Pure helpers only (no UI, no persistence, no worker). Stations derive at
// read time from cumulative HORIZONTAL (plan) length, station 0 at the first
// vertex. Grades derive from dZ over plan length. Z is never defaulted —
// absent/non-finite Z fails closed, never 0.
//
// Plan arcs reuse the Phase 19C endpoint+bulge seam verbatim
// (describeParcelArcCourse — DO NOT invent a second bulge convention).
// 3D length = H*sqrt(1+grade^2) = hypot(H, dZ). Elevation along a course is
// linear in PLAN fraction (arc = arc-length fraction, NOT chord).

import { createStableRuntimeId } from '../id';
import { cadPointOnCircle } from './cadGeometry';
import {
  CAD_PARCEL_ARC_FULL_CIRCLE_SWEEP_DEG,
  CAD_PARCEL_ARC_ZERO_CHORD_TOLERANCE,
  CAD_PARCEL_BULGE_LINE_FLOOR,
  describeParcelArcCourse,
} from './cadParcelArcGeometry';
import type {
  CadFeatureLineEntity,
  CadFeatureLineSegmentGeometry,
  CadFeatureLineVertex,
} from './cadTypes';

export interface FeatureLineSanitizeIssue {
  courseIndex: number;
  code:
    | 'TOO_FEW_VERTICES'
    | 'MISSING_VERTEX_ID'
    | 'DUPLICATE_VERTEX_ID'
    | 'NON_FINITE_XYZ'
    | 'GEOMETRY_LENGTH_MISMATCH'
    | 'NON_FINITE_BULGE'
    | 'ZERO_BULGE_ARC'
    | 'ZERO_PLAN_LENGTH_COURSE'
    | 'SWEEP_NEAR_FULL_CIRCLE'
    | 'INVALID_ARC';
  message: string;
}

export interface ResolvedFeatureLineCourse {
  index: number;
  fromVertexId: string;
  toVertexId: string;
  from: CadFeatureLineVertex;
  to: CadFeatureLineVertex;
  kind: 'line' | 'arc';
  /** Horizontal (plan) length: line = chord, arc = |arc length|. */
  planLength: number;
  /** 3D length = hypot(planLength, dZ). */
  length3D: number;
  startStation: number;
  endStation: number;
  gradeRatio: number;
  gradePercent: number;
  center?: { x: number; y: number };
  radius?: number;
  signedSweepDeg?: number;
  startAngleDeg?: number;
  midpoint?: CadFeatureLineVertex;
  startTangentAzimuthDeg?: number;
  endTangentAzimuthDeg?: number;
}

export interface ResolvedFeatureLine {
  entityId: string;
  closed: boolean;
  courses: ResolvedFeatureLineCourse[];
  /** Prefix stations: stations[i] = start of course i, last = total. */
  stations: number[];
  planLength: number;
  length3D: number;
}

/** Course count: vertices.length - 1 open, vertices.length closed. */
export const getFeatureLineCourseCount = (entity: CadFeatureLineEntity): number =>
  entity.closed === true ? entity.vertices.length : entity.vertices.length - 1;

const isClosed = (entity: CadFeatureLineEntity): boolean => entity.closed === true;

const issue = (
  courseIndex: number,
  code: FeatureLineSanitizeIssue['code'],
  message: string,
): FeatureLineSanitizeIssue => ({ courseIndex, code, message });

/**
 * Fail-closed structural + numeric validation. Never defaults Z to 0:
 * non-finite x/y/z is an issue. Sub-floor nonzero bulge canonicalizes to
 * LINE (same machine floor as parcels) and is valid.
 */
export const sanitizeFeatureLine = (
  entity: CadFeatureLineEntity,
): { ok: boolean; issues: FeatureLineSanitizeIssue[] } => {
  const issues: FeatureLineSanitizeIssue[] = [];
  const vertices = entity.vertices;
  const closed = isClosed(entity);
  const minVertices = closed ? 3 : 2;
  if (!Array.isArray(vertices) || vertices.length < minVertices) {
    return {
      ok: false,
      issues: [
        issue(
          -1,
          'TOO_FEW_VERTICES',
          `feature line needs >=${minVertices} vertices (${closed ? 'closed' : 'open'}), got ${Array.isArray(vertices) ? vertices.length : 'n/a'}`,
        ),
      ],
    };
  }
  const seenIds = new Set<string>();
  vertices.forEach((vertex, vertexIndex) => {
    if (typeof vertex?.id !== 'string' || vertex.id.length === 0) {
      issues.push(issue(vertexIndex, 'MISSING_VERTEX_ID', `vertex ${vertexIndex} has no stable id`));
    } else if (seenIds.has(vertex.id)) {
      issues.push(issue(vertexIndex, 'DUPLICATE_VERTEX_ID', `duplicate vertex id ${vertex.id}`));
    } else {
      seenIds.add(vertex.id);
    }
    if (![vertex?.x, vertex?.y, vertex?.z].every(Number.isFinite)) {
      issues.push(
        issue(vertexIndex, 'NON_FINITE_XYZ', `vertex ${vertexIndex} has non-finite x/y/z (Z never defaults to 0)`),
      );
    }
  });
  const courseCount = getFeatureLineCourseCount(entity);
  const geometry = entity.segmentGeometry;
  if (geometry != null) {
    if (!Array.isArray(geometry) || geometry.length !== courseCount) {
      issues.push(
        issue(
          -1,
          'GEOMETRY_LENGTH_MISMATCH',
          `segmentGeometry.length ${Array.isArray(geometry) ? geometry.length : 'n/a'} !== course count ${courseCount}`,
        ),
      );
    } else {
      geometry.forEach((entry, courseIndex) => {
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
        if (Math.abs(entry.bulge) < CAD_PARCEL_BULGE_LINE_FLOOR) return;
        const from = vertices[courseIndex]!;
        const to = vertices[(courseIndex + 1) % vertices.length]!;
        if (![from?.x, from?.y, to?.x, to?.y].every(Number.isFinite)) return;
        const chord = Math.hypot(to.x - from.x, to.y - from.y);
        if (!(chord > CAD_PARCEL_ARC_ZERO_CHORD_TOLERANCE)) {
          issues.push(issue(courseIndex, 'ZERO_PLAN_LENGTH_COURSE', `course ${courseIndex} declares arc on coincident plan endpoints`));
          return;
        }
        const sweepDeg = (4 * Math.atan(entry.bulge) * 180) / Math.PI;
        if (Math.abs(sweepDeg) >= CAD_PARCEL_ARC_FULL_CIRCLE_SWEEP_DEG) {
          issues.push(issue(courseIndex, 'SWEEP_NEAR_FULL_CIRCLE', `course ${courseIndex} sweep ~360deg is blocked`));
          return;
        }
        if (!describeParcelArcCourse(from, to, entry.bulge)) {
          issues.push(issue(courseIndex, 'INVALID_ARC', `course ${courseIndex} derives no valid arc`));
        }
      });
    }
  }
  // Zero-plan-length line courses advance no station and carry no grade —
  // fail closed (callers must drop/merge the vertex explicitly).
  for (let courseIndex = 0; courseIndex < courseCount; courseIndex += 1) {
    const entry = geometry?.[courseIndex];
    if (entry?.kind === 'arc' && Math.abs(entry.bulge) >= CAD_PARCEL_BULGE_LINE_FLOOR) continue;
    const from = vertices[courseIndex]!;
    const to = vertices[(courseIndex + 1) % vertices.length]!;
    if (![from?.x, from?.y, to?.x, to?.y].every(Number.isFinite)) continue;
    if (!(Math.hypot(to.x - from.x, to.y - from.y) > CAD_PARCEL_ARC_ZERO_CHORD_TOLERANCE)) {
      issues.push(issue(courseIndex, 'ZERO_PLAN_LENGTH_COURSE', `course ${courseIndex} has zero plan length`));
    }
  }
  return { ok: issues.length === 0, issues };
};

/**
 * Authoritative course resolver. Stations start at 0 and increment by
 * horizontal plan length. Returns null on invalid input (fail closed —
 * never silent line conversion, never Z defaulting).
 */
export const resolveCadFeatureLine = (entity: CadFeatureLineEntity): ResolvedFeatureLine | null => {
  if (!sanitizeFeatureLine(entity).ok) return null;
  const closed = isClosed(entity);
  const courseCount = getFeatureLineCourseCount(entity);
  const courses: ResolvedFeatureLineCourse[] = [];
  const stations: number[] = [0];
  let planLength = 0;
  let length3D = 0;
  for (let index = 0; index < courseCount; index += 1) {
    const from = entity.vertices[index]!;
    const to = entity.vertices[(index + 1) % entity.vertices.length]!;
    const entry = entity.segmentGeometry?.[index];
    const isArc = entry?.kind === 'arc' && Math.abs(entry.bulge) >= CAD_PARCEL_BULGE_LINE_FLOOR;
    const startStation = stations[index]!;
    let plan: number;
    let arc:
      | {
          center: { x: number; y: number };
          radius: number;
          signedSweepDeg: number;
          startAngleDeg: number;
          midpoint: CadFeatureLineVertex;
          startTangentAzimuthDeg: number;
          endTangentAzimuthDeg: number;
        }
      | null = null;
    if (isArc) {
      const metrics = describeParcelArcCourse(from, to, (entry as { bulge: number }).bulge);
      if (!metrics) return null;
      plan = metrics.arcLength;
      // Midpoint Z is linear in arc-length fraction (halfway = mean Z).
      arc = {
        center: { ...metrics.center },
        radius: metrics.radius,
        signedSweepDeg: metrics.signedSweepDeg,
        startAngleDeg: metrics.startAngleDeg,
        midpoint: {
          id: `${from.id}->${to.id}:mid`,
          x: metrics.midpoint.x,
          y: metrics.midpoint.y,
          z: (from.z + to.z) / 2,
        },
        startTangentAzimuthDeg: metrics.startTangentAzimuthDeg,
        endTangentAzimuthDeg: metrics.endTangentAzimuthDeg,
      };
    } else {
      plan = Math.hypot(to.x - from.x, to.y - from.y);
    }
    const deltaZ = to.z - from.z;
    const gradeRatio = deltaZ / plan;
    const courseLength3D = Math.hypot(plan, deltaZ);
    const endStation = startStation + plan;
    stations.push(endStation);
    planLength += plan;
    length3D += courseLength3D;
    courses.push({
      index,
      fromVertexId: from.id,
      toVertexId: to.id,
      from: { ...from },
      to: { ...to },
      kind: isArc ? 'arc' : 'line',
      planLength: plan,
      length3D: courseLength3D,
      startStation,
      endStation,
      gradeRatio,
      gradePercent: gradeRatio * 100,
      ...(arc ?? {}),
    });
  }
  return { entityId: entity.id, closed, courses, stations, planLength, length3D };
};

/** Binary search over prefix stations: course index containing `station`. */
const findCourseIndexAtStation = (stations: readonly number[], station: number): number => {
  let low = 0;
  let high = stations.length - 2;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (stations[mid]! <= station) low = mid;
    else high = mid - 1;
  }
  return low;
};

const asResolved = (
  entityOrResolved: CadFeatureLineEntity | ResolvedFeatureLine,
): ResolvedFeatureLine | null =>
  Array.isArray((entityOrResolved as ResolvedFeatureLine).courses)
    ? (entityOrResolved as ResolvedFeatureLine)
    : resolveCadFeatureLine(entityOrResolved as CadFeatureLineEntity);

/**
 * Elevation at a plan station: linear Z by plan fraction (arc courses use
 * arc-length fraction, NOT chord). Null outside [0, total] or on invalid
 * input — never extrapolated, never defaulted.
 */
export const getFeatureLineElevationAtStation = (
  entityOrResolved: CadFeatureLineEntity | ResolvedFeatureLine,
  station: number,
): number | null => {
  const resolved = asResolved(entityOrResolved);
  if (!resolved || !Number.isFinite(station)) return null;
  if (station < 0 || station > resolved.planLength) return null;
  if (resolved.courses.length === 0) return null;
  const courseIndex =
    station >= resolved.planLength
      ? resolved.courses.length - 1
      : findCourseIndexAtStation(resolved.stations, station);
  const course = resolved.courses[courseIndex]!;
  const span = course.endStation - course.startStation;
  if (!(span > 0)) return null;
  const fraction = (station - course.startStation) / span;
  return course.from.z + (course.to.z - course.from.z) * fraction;
};

export interface FeatureLinePointAtStation {
  x: number;
  y: number;
  z: number;
  courseIndex: number;
  localFraction: number;
  gradeRatio: number;
}

/**
 * Full 3D point at a plan station: lines interpolate XY linearly, arcs ride
 * the true circle (startAngle + signedSweep * fraction). Null outside range
 * or on invalid input.
 */
export const getFeatureLinePointAtStation = (
  entityOrResolved: CadFeatureLineEntity | ResolvedFeatureLine,
  station: number,
): FeatureLinePointAtStation | null => {
  const resolved = asResolved(entityOrResolved);
  if (!resolved || !Number.isFinite(station)) return null;
  if (station < 0 || station > resolved.planLength) return null;
  if (resolved.courses.length === 0) return null;
  const courseIndex =
    station >= resolved.planLength
      ? resolved.courses.length - 1
      : findCourseIndexAtStation(resolved.stations, station);
  const course = resolved.courses[courseIndex]!;
  const span = course.endStation - course.startStation;
  if (!(span > 0)) return null;
  const fraction =
    station >= resolved.planLength ? 1 : (station - course.startStation) / span;
  const z = course.from.z + (course.to.z - course.from.z) * fraction;
  if (course.kind === 'arc' && course.center != null && course.radius != null && course.signedSweepDeg != null && course.startAngleDeg != null) {
    const angleDeg = course.startAngleDeg + course.signedSweepDeg * fraction;
    const plan = cadPointOnCircle(course.center, course.radius, angleDeg);
    return { x: plan.x, y: plan.y, z, courseIndex, localFraction: fraction, gradeRatio: course.gradeRatio };
  }
  return {
    x: course.from.x + (course.to.x - course.from.x) * fraction,
    y: course.from.y + (course.to.y - course.from.y) * fraction,
    z,
    courseIndex,
    localFraction: fraction,
    gradeRatio: course.gradeRatio,
  };
};

// ---------------------------------------------------------------------------
// Bounded 3D tessellation (DXF 3D POLYLINE + LandXML plan feature). Plan arcs
// are sampled on the true circle with Z linear in PLAN (arc-length) fraction;
// never a single silent chord and never a fake bulge.
// ---------------------------------------------------------------------------

export interface CadFeatureLineTessellation {
  points: CadFeatureLineVertex[];
  arcCount: number;
  closed: boolean;
}

export const CAD_FEATURE_LINE_TESSELLATE_MAX_STEP_DEG = 10;
export const CAD_FEATURE_LINE_TESSELLATE_MAX_STEPS = 64;

/**
 * Resolved feature line → ordered 3D vertices. Straight courses contribute
 * their authored endpoints; arc courses contribute `<= maxStepDeg` samples.
 * Null on invalid/empty input (fail closed). A closed ring drops the
 * duplicated closing vertex (callers carry the closed flag).
 */
export const tessellateCadFeatureLine = (
  entityOrResolved: CadFeatureLineEntity | ResolvedFeatureLine,
  options: { maxStepDeg?: number; maxSteps?: number } = {},
): CadFeatureLineTessellation | null => {
  const resolved = asResolved(entityOrResolved);
  if (!resolved || resolved.courses.length === 0) return null;
  const maxStepDeg = options.maxStepDeg ?? CAD_FEATURE_LINE_TESSELLATE_MAX_STEP_DEG;
  const maxSteps = options.maxSteps ?? CAD_FEATURE_LINE_TESSELLATE_MAX_STEPS;
  const points: CadFeatureLineVertex[] = [];
  let arcCount = 0;
  resolved.courses.forEach((course, index) => {
    const isClosing = resolved.closed && index === resolved.courses.length - 1;
    if (index === 0) points.push({ ...course.from });
    if (
      course.kind === 'arc' &&
      course.center != null &&
      course.radius != null &&
      course.startAngleDeg != null &&
      course.signedSweepDeg != null
    ) {
      arcCount += 1;
      const steps = Math.min(maxSteps, Math.max(2, Math.ceil(Math.abs(course.signedSweepDeg) / maxStepDeg)));
      for (let step = 1; step <= steps; step += 1) {
        if (isClosing && step === steps) break;
        const fraction = step / steps;
        const plan = cadPointOnCircle(
          course.center,
          course.radius,
          course.startAngleDeg + course.signedSweepDeg * fraction,
        );
        points.push({
          id: `${course.toVertexId}:a${step}`,
          x: plan.x,
          y: plan.y,
          z: course.from.z + (course.to.z - course.from.z) * fraction,
        });
      }
    } else if (!isClosing) {
      points.push({ ...course.to });
    }
  });
  if (points.length < 2) return null;
  return { points, arcCount, closed: resolved.closed };
};

// ---------------------------------------------------------------------------
// Stable vertex identity: `feature-vertex:<flId>:<stableId>` via the repo
// ID helper. COPY mints a new entity id + fresh vertex ids (see
// copyFeatureLineEntity in cadFeatureLineEdits).
// ---------------------------------------------------------------------------

export const buildFeatureLineVertexId = (featureLineId: string, stableId: string): string =>
  `feature-vertex:${featureLineId}:${stableId}`;
export const createFeatureLineVertexId = (featureLineId: string): string =>
  buildFeatureLineVertexId(featureLineId, createStableRuntimeId('feature-line-vertex'));

export const buildFeatureLineVertexIds = (featureLineId: string, count: number): string[] =>
  Array.from({ length: count }, () => createFeatureLineVertexId(featureLineId));

export type { CadFeatureLineSegmentGeometry, CadFeatureLineVertex };
