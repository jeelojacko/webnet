// Phase 20A — feature-line inquiry (pure read-only reporting).
//
// Reuses the authoritative resolver only: stations, courses, arc metrics and
// elevations are all derived at read time. Never mutates, never fabricates a
// value outside the line.

import { cadAzimuthDeg } from './cadGeometry';
import { formatCadBearing } from './cadCogoSummaries';
import { formatCadStation } from './cadAlignmentStationing';
import {
  getFeatureLineElevationAtStation,
  getFeatureLinePointAtStation,
  resolveCadFeatureLine,
  type ResolvedFeatureLine,
  type ResolvedFeatureLineCourse,
} from './cadFeatureLines';
import type { CadFeatureLineEntity } from './cadTypes';

export interface FeatureLineInquiry {
  entityId: string;
  name: string | null;
  startStation: number;
  endStation: number;
  startStationText: string;
  endStationText: string;
  planLength: number;
  length3D: number;
  startZ: number;
  endZ: number;
  deltaZ: number;
  gradePercent: number;
  slopeAngleDeg: number;
  bearingAzimuthDeg: number;
  bearingText: string;
  start: { x: number; y: number; z: number };
  end: { x: number; y: number; z: number };
  /** Present only when the whole span sits on one arc course. */
  curve: {
    courseIndex: number;
    radius: number;
    signedSweepDeg: number;
    direction: 'left' | 'right';
    arcLength: number;
    chordLength: number;
  } | null;
}

const spanOfCourse = (
  course: ResolvedFeatureLineCourse,
  start: number,
  end: number,
): { planLength: number; length3D: number } => {
  const from = Math.max(start, course.startStation);
  const to = Math.min(end, course.endStation);
  const planSpan = Math.max(0, to - from);
  const grade = Number.isFinite(course.gradeRatio) ? course.gradeRatio : 0;
  return { planLength: planSpan, length3D: planSpan * Math.hypot(1, grade) };
};

const courseAtStation = (
  resolved: ResolvedFeatureLine,
  station: number,
): ResolvedFeatureLineCourse => {
  const clamped = Math.min(Math.max(station, 0), resolved.planLength);
  const index =
    clamped >= resolved.planLength
      ? resolved.courses.length - 1
      : resolved.courses.findIndex(
          (course) => clamped >= course.startStation && clamped < course.endStation,
        );
  return resolved.courses[Math.max(0, index)]!;
};

/**
 * Metrics for an ordered station span [startStation, endStation] within the
 * line. Null on invalid input, invalid geometry, or a span outside [0, total].
 */
export const buildFeatureLineInquiry = (
  entity: CadFeatureLineEntity,
  startStation?: number,
  endStation?: number,
): FeatureLineInquiry | null => {
  const resolved = resolveCadFeatureLine(entity);
  if (!resolved) return null;
  const start = startStation ?? 0;
  const end = endStation ?? resolved.planLength;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (end - start <= 0 || start < 0 || end > resolved.planLength) return null;
  const startPoint = getFeatureLinePointAtStation(resolved, start);
  const endPoint = getFeatureLinePointAtStation(resolved, end);
  const startZ = getFeatureLineElevationAtStation(resolved, start);
  const endZ = getFeatureLineElevationAtStation(resolved, end);
  if (!startPoint || !endPoint || startZ == null || endZ == null) return null;

  let planLength = 0;
  let length3D = 0;
  resolved.courses.forEach((course) => {
    if (course.endStation <= start || course.startStation >= end) return;
    const partial = spanOfCourse(course, start, end);
    planLength += partial.planLength;
    length3D += partial.length3D;
  });
  const deltaZ = endZ - startZ;
  const gradeRatio = planLength > 0 ? deltaZ / planLength : 0;
  const startCourse = courseAtStation(resolved, start);
  const endCourse = courseAtStation(resolved, end >= resolved.planLength ? resolved.planLength - 1e-12 : end);
  let curve: FeatureLineInquiry['curve'] = null;
  if (
    startCourse.kind === 'arc' &&
    endCourse.index === startCourse.index &&
    startCourse.radius != null &&
    startCourse.signedSweepDeg != null
  ) {
    const fractionStart = (start - startCourse.startStation) / startCourse.planLength;
    const fractionEnd = (end - startCourse.startStation) / startCourse.planLength;
    const signedSweepDeg = startCourse.signedSweepDeg * (fractionEnd - fractionStart);
    curve = {
      courseIndex: startCourse.index,
      radius: startCourse.radius,
      signedSweepDeg,
      direction: signedSweepDeg >= 0 ? 'left' : 'right',
      arcLength: Math.abs((signedSweepDeg * Math.PI) / 180) * startCourse.radius,
      chordLength: Math.hypot(endPoint.x - startPoint.x, endPoint.y - startPoint.y),
    };
  }
  const azimuth = cadAzimuthDeg(
    { x: startPoint.x, y: startPoint.y },
    { x: endPoint.x, y: endPoint.y },
  );
  return {
    entityId: entity.id,
    name: entity.name ?? null,
    startStation: start,
    endStation: end,
    startStationText: formatCadStation(start),
    endStationText: formatCadStation(end),
    planLength,
    length3D,
    startZ,
    endZ,
    deltaZ,
    gradePercent: gradeRatio * 100,
    slopeAngleDeg: (Math.atan(gradeRatio) * 180) / Math.PI,
    bearingAzimuthDeg: azimuth,
    bearingText: formatCadBearing(azimuth),
    start: { x: startPoint.x, y: startPoint.y, z: startZ },
    end: { x: endPoint.x, y: endPoint.y, z: endZ },
    curve,
  };
};
