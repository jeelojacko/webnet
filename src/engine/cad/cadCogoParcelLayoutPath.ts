import {
  cadDistance,
  cadPointOnCircle,
  cadSignedSweepDeg,
  type CadWorldPoint,
} from './cadGeometry';
import type { CadParcelEntity } from './cadTypes';
import type { CadParcelLayoutFrontageReference } from './cadCogoParcelFrontage';
import { normalizeParcelPolygonVertices } from './cadCogoParcelGeometry';

export interface CadParcelLayoutFrontagePathLineSegment {
  kind: 'line';
  startDistance: number;
  endDistance: number;
  startPoint: CadWorldPoint;
  endPoint: CadWorldPoint;
}

export interface CadParcelLayoutFrontagePathArcSegment {
  kind: 'arc';
  startDistance: number;
  endDistance: number;
  center: CadWorldPoint;
  radius: number;
  startAngleDeg: number;
  endAngleDeg: number;
}

type CadParcelLayoutFrontagePathSegment =
  | CadParcelLayoutFrontagePathLineSegment
  | CadParcelLayoutFrontagePathArcSegment;

export interface CadParcelLayoutFrontagePath {
  segments: CadParcelLayoutFrontagePathSegment[];
  totalLengthMeters: number;
}

export interface CadParcelLayoutFrontageSample {
  point: CadWorldPoint;
  tangent: CadWorldPoint;
}

export const cadDotWorldPoint = (left: CadWorldPoint, right: CadWorldPoint): number =>
  left.x * right.x + left.y * right.y;

export const cadBuildParcelLayoutFrontagePath = (
  parcel: CadParcelEntity,
  frontageReference: CadParcelLayoutFrontageReference,
): CadParcelLayoutFrontagePath | null => {
  if (frontageReference.parcelSegmentLabelPairs && frontageReference.parcelSegmentLabelPairs.length > 0) {
    const vertices = normalizeParcelPolygonVertices(parcel.vertices);
    if (vertices.length < 2 || parcel.vertexLabels.length !== vertices.length) return null;
    const labels = parcel.vertexLabels.map((label, index) => label ?? `CAD${index + 1}`);
    let runningDistance = 0;
    const segments: CadParcelLayoutFrontagePathSegment[] = [];
    frontageReference.parcelSegmentLabelPairs.forEach(([startLabel, endLabel]) => {
      const startIndex = labels.findIndex((label) => label === startLabel);
      const endIndex = labels.findIndex((label) => label === endLabel);
      if (startIndex < 0 || endIndex < 0) return;
      const directNextIndex = (startIndex + 1) % vertices.length;
      const directPreviousIndex = (startIndex + vertices.length - 1) % vertices.length;
      const startPoint = vertices[startIndex]!;
      let endPoint: CadWorldPoint | null = null;
      if (directNextIndex === endIndex) {
        endPoint = vertices[endIndex]!;
      } else if (directPreviousIndex === endIndex) {
        endPoint = vertices[endIndex]!;
      }
      if (!endPoint) return;
      const segmentLength = cadDistance(startPoint, endPoint);
      if (segmentLength <= 1e-9) return;
      segments.push({
        kind: 'line',
        startDistance: runningDistance,
        endDistance: runningDistance + segmentLength,
        startPoint: { x: startPoint.x, y: startPoint.y },
        endPoint: { x: endPoint.x, y: endPoint.y },
      });
      runningDistance += segmentLength;
    });
    return segments.length > 0
      ? {
          segments,
          totalLengthMeters: runningDistance,
        }
      : null;
  }

  const geometry = frontageReference.sourceGeometry;
  if (geometry?.kind === 'polyline') {
    if (geometry.vertices.length < 2) return null;
    let runningDistance = 0;
    const segments: CadParcelLayoutFrontagePathSegment[] = [];
    for (let index = 0; index < geometry.vertices.length - 1; index += 1) {
      const startPoint = geometry.vertices[index]!;
      const endPoint = geometry.vertices[index + 1]!;
      const segmentLength = cadDistance(startPoint, endPoint);
      if (segmentLength <= 1e-9) continue;
      segments.push({
        kind: 'line',
        startDistance: runningDistance,
        endDistance: runningDistance + segmentLength,
        startPoint: { x: startPoint.x, y: startPoint.y },
        endPoint: { x: endPoint.x, y: endPoint.y },
      });
      runningDistance += segmentLength;
    }
    return segments.length > 0
      ? {
          segments,
          totalLengthMeters: runningDistance,
        }
      : null;
  }

  if (geometry?.kind === 'arc') {
    const sweepDeg = cadSignedSweepDeg(geometry.startAngleDeg, geometry.endAngleDeg);
    const arcLength = Math.abs((sweepDeg * Math.PI * geometry.radius) / 180);
    if (arcLength <= 1e-9) return null;
    return {
      segments: [
        {
          kind: 'arc',
          startDistance: 0,
          endDistance: arcLength,
          center: { x: geometry.center.x, y: geometry.center.y },
          radius: geometry.radius,
          startAngleDeg: geometry.startAngleDeg,
          endAngleDeg: geometry.endAngleDeg,
        },
      ],
      totalLengthMeters: arcLength,
    };
  }

  const startPoint = { x: frontageReference.frontageLine.fromX, y: frontageReference.frontageLine.fromY };
  const endPoint = { x: frontageReference.frontageLine.toX, y: frontageReference.frontageLine.toY };
  const lengthMeters = cadDistance(startPoint, endPoint);
  if (lengthMeters <= 1e-9) return null;
  return {
    segments: [
      {
        kind: 'line',
        startDistance: 0,
        endDistance: lengthMeters,
        startPoint,
        endPoint,
      },
    ],
    totalLengthMeters: lengthMeters,
  };
};

export const cadSampleParcelLayoutFrontagePath = (
  path: CadParcelLayoutFrontagePath,
  distanceMeters: number,
): CadParcelLayoutFrontageSample | null => {
  if (!Number.isFinite(distanceMeters)) return null;
  const clampedDistance = Math.max(0, Math.min(path.totalLengthMeters, distanceMeters));
  const segment =
    path.segments.find(
      (candidate) =>
        clampedDistance >= candidate.startDistance - 1e-9 &&
        clampedDistance <= candidate.endDistance + 1e-9,
    ) ?? path.segments[path.segments.length - 1];
  if (!segment) return null;
  const localDistance = Math.max(0, Math.min(segment.endDistance - segment.startDistance, clampedDistance - segment.startDistance));
  if (segment.kind === 'line') {
    const segmentLength = cadDistance(segment.startPoint, segment.endPoint);
    if (segmentLength <= 1e-9) return null;
    const unit = {
      x: (segment.endPoint.x - segment.startPoint.x) / segmentLength,
      y: (segment.endPoint.y - segment.startPoint.y) / segmentLength,
    };
    return {
      point: {
        x: segment.startPoint.x + unit.x * localDistance,
        y: segment.startPoint.y + unit.y * localDistance,
      },
      tangent: unit,
    };
  }
  const sweepDeg = cadSignedSweepDeg(segment.startAngleDeg, segment.endAngleDeg);
  const signedLocalDeg = (localDistance / segment.radius) * (180 / Math.PI) * (sweepDeg >= 0 ? 1 : -1);
  const angleDeg = segment.startAngleDeg + signedLocalDeg;
  const angleRad = (angleDeg * Math.PI) / 180;
  const point = cadPointOnCircle(segment.center, segment.radius, angleDeg);
  const tangent = sweepDeg >= 0 ? { x: -Math.sin(angleRad), y: Math.cos(angleRad) } : { x: Math.sin(angleRad), y: -Math.cos(angleRad) };
  return {
    point,
    tangent,
  };
};

export const cadBuildParcelLayoutFrontageSubPath = (
  path: CadParcelLayoutFrontagePath,
  startDistanceMeters: number,
  endDistanceMeters: number,
): CadParcelLayoutFrontagePath | null => {
  if (endDistanceMeters - startDistanceMeters <= 1e-9) return null;
  const segments: CadParcelLayoutFrontagePathSegment[] = [];
  let runningDistance = 0;
  path.segments.forEach((segment) => {
    const overlapStart = Math.max(startDistanceMeters, segment.startDistance);
    const overlapEnd = Math.min(endDistanceMeters, segment.endDistance);
    if (overlapEnd - overlapStart <= 1e-9) return;
    if (segment.kind === 'line') {
      const startSample = cadSampleParcelLayoutFrontagePath(path, overlapStart);
      const endSample = cadSampleParcelLayoutFrontagePath(path, overlapEnd);
      if (!startSample || !endSample) return;
      const lengthMeters = cadDistance(startSample.point, endSample.point);
      if (lengthMeters <= 1e-9) return;
      segments.push({
        kind: 'line',
        startDistance: runningDistance,
        endDistance: runningDistance + lengthMeters,
        startPoint: startSample.point,
        endPoint: endSample.point,
      });
      runningDistance += lengthMeters;
      return;
    }
    const localStartDistance = overlapStart - segment.startDistance;
    const localEndDistance = overlapEnd - segment.startDistance;
    const sweepDeg = cadSignedSweepDeg(segment.startAngleDeg, segment.endAngleDeg);
    const signedStartDeltaDeg = (localStartDistance / segment.radius) * (180 / Math.PI) * (sweepDeg >= 0 ? 1 : -1);
    const signedEndDeltaDeg = (localEndDistance / segment.radius) * (180 / Math.PI) * (sweepDeg >= 0 ? 1 : -1);
    const subStartAngleDeg = segment.startAngleDeg + signedStartDeltaDeg;
    const subEndAngleDeg = segment.startAngleDeg + signedEndDeltaDeg;
    const lengthMeters = overlapEnd - overlapStart;
    segments.push({
      kind: 'arc',
      startDistance: runningDistance,
      endDistance: runningDistance + lengthMeters,
      center: { x: segment.center.x, y: segment.center.y },
      radius: segment.radius,
      startAngleDeg: subStartAngleDeg,
      endAngleDeg: subEndAngleDeg,
    });
    runningDistance += lengthMeters;
  });
  return segments.length > 0
    ? {
        segments,
        totalLengthMeters: runningDistance,
      }
    : null;
};
