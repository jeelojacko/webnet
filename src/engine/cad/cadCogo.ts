import {
  cadBuildArcFromThreePoints as buildArcFromThreePointsGeometry,
  cadBuildParallelLine as buildParallelLineGeometry,
  cadBuildPerpendicularFoot as buildPerpendicularFootGeometry,
  cadBuildCurveMetricsFromArcLength as buildCurveMetricsFromArcLengthGeometry,
  cadBuildCurveMetricsFromChordLength as buildCurveMetricsFromChordLengthGeometry,
  cadBuildCurveMetricsFromRadiusDelta as buildCurveMetricsFromRadiusDeltaGeometry,
  cadBuildCurveMetricsFromTangentLength as buildCurveMetricsFromTangentLengthGeometry,
  cadBuildTangentCurve as buildTangentCurveGeometry,
  cadAzimuthDeg,
  cadDistance,
  cadIntersectArcArc,
  cadIntersectSegmentArc,
  cadOffsetLineSegment as offsetLineSegmentGeometry,
  cadParseBearingDegrees,
  cadPointFromAzimuthDistance,
  cadSegmentIntersection,
  type CadNamedPoint,
  type CadWorldPoint,
} from './cadGeometry';
import type { CadArcEntity, CadEntity, CadLineEntity, CadPolylineEntity } from './cadTypes';

export interface CadInverseSummary {
  distance: number;
  azimuthDeg: number;
  bearing: string;
}

interface CadSegmentRef {
  start: CadWorldPoint;
  end: CadWorldPoint;
  label: string;
}

export interface CadEntityIntersection {
  point: CadWorldPoint;
  label: string;
}

const padInteger = (value: number, width: number): string => value.toString().padStart(width, '0');

export const formatCadBearing = (azimuthDeg: number): string => {
  const normalized = ((azimuthDeg % 360) + 360) % 360;
  let prefix: 'N' | 'S' = 'N';
  let suffix: 'E' | 'W' = 'E';
  let angle = normalized;
  if (normalized <= 90) {
    prefix = 'N';
    suffix = 'E';
    angle = normalized;
  } else if (normalized <= 180) {
    prefix = 'S';
    suffix = 'E';
    angle = 180 - normalized;
  } else if (normalized <= 270) {
    prefix = 'S';
    suffix = 'W';
    angle = normalized - 180;
  } else {
    prefix = 'N';
    suffix = 'W';
    angle = 360 - normalized;
  }

  let degrees = Math.floor(angle);
  let minutesFloat = (angle - degrees) * 60;
  let minutes = Math.floor(minutesFloat);
  let seconds = (minutesFloat - minutes) * 60;

  // Keep formatted bearing stable when floating point lands on carry boundaries.
  if (seconds >= 59.995) {
    seconds = 0;
    minutes += 1;
  }
  if (minutes >= 60) {
    minutes = 0;
    degrees += 1;
  }
  if (degrees > 90) {
    degrees = 90;
    minutes = 0;
    seconds = 0;
  }

  return `${prefix}${padInteger(degrees, 2)}-${padInteger(minutes, 2)}-${seconds
    .toFixed(2)
    .padStart(5, '0')}${suffix}`;
};

export const buildCadInverseSummary = (
  from: CadWorldPoint,
  to: CadWorldPoint,
): CadInverseSummary => {
  const azimuthDeg = cadAzimuthDeg(from, to);
  return {
    distance: cadDistance(from, to),
    azimuthDeg,
    bearing: formatCadBearing(azimuthDeg),
  };
};

export const cadPointFromBearingDistance = (
  from: CadWorldPoint,
  bearing: string,
  distance: number,
): CadWorldPoint | null => {
  const azimuthDeg = cadParseBearingDegrees(bearing);
  if (azimuthDeg == null) return null;
  return cadPointFromAzimuthDistance(from, azimuthDeg, distance);
};

const lineEntitySegments = (entity: CadLineEntity): CadSegmentRef[] => [
  {
    start: { x: entity.fromX, y: entity.fromY },
    end: { x: entity.toX, y: entity.toY },
    label: `${entity.fromStationId}-${entity.toStationId}`,
  },
];

const polylineEntitySegments = (entity: CadPolylineEntity): CadSegmentRef[] =>
  entity.vertices.slice(0, -1).map((vertex, index) => ({
    start: vertex,
    end: entity.vertices[index + 1],
    label: `${entity.vertexLabels[index] ?? `V${index + 1}`}-${entity.vertexLabels[index + 1] ?? `V${index + 2}`}`,
  }));

const lineLikeSegments = (entity: CadLineEntity | CadPolylineEntity): CadSegmentRef[] =>
  entity.type === 'line' ? lineEntitySegments(entity) : polylineEntitySegments(entity);

export const isCadLineLikeEntity = (
  entity: CadEntity,
): entity is CadLineEntity | CadPolylineEntity => entity.type === 'line' || entity.type === 'polyline';

export const cadIntersectLineLikeEntities = (
  first: CadLineEntity | CadPolylineEntity,
  second: CadLineEntity | CadPolylineEntity,
): CadEntityIntersection | null => {
  const firstSegments = lineLikeSegments(first);
  const secondSegments = lineLikeSegments(second);

  for (const firstSegment of firstSegments) {
    for (const secondSegment of secondSegments) {
      const point = cadSegmentIntersection(
        firstSegment.start,
        firstSegment.end,
        secondSegment.start,
        secondSegment.end,
      );
      if (!point) continue;
      return {
        point,
        label: `${firstSegment.label} x ${secondSegment.label}`,
      };
    }
  }
  return null;
};

export const cadIntersectLineArcEntity = (
  lineLike: CadLineEntity | CadPolylineEntity,
  arc: CadArcEntity,
): CadEntityIntersection[] =>
  lineLikeSegments(lineLike)
    .flatMap((segment) =>
      cadIntersectSegmentArc(
        segment.start,
        segment.end,
        { x: arc.centerX, y: arc.centerY },
        arc.radius,
        arc.startAngleDeg,
        arc.endAngleDeg,
      ).map((point) => ({
        point,
        label: `${segment.label} x ${arc.id}`,
      })),
    )
    .sort((left, right) => {
      if (Math.abs(left.point.x - right.point.x) > 1e-9) return left.point.x - right.point.x;
      return left.point.y - right.point.y;
    });

export const cadIntersectArcEntities = (
  first: CadArcEntity,
  second: CadArcEntity,
): CadEntityIntersection[] =>
  cadIntersectArcArc(
    { x: first.centerX, y: first.centerY },
    first.radius,
    first.startAngleDeg,
    first.endAngleDeg,
    { x: second.centerX, y: second.centerY },
    second.radius,
    second.startAngleDeg,
    second.endAngleDeg,
  ).map((point) => ({
    point,
    label: `${first.id} x ${second.id}`,
  }));

export const cadOffsetLineSegment = (
  start: CadWorldPoint,
  end: CadWorldPoint,
  offsetDistance: number,
) => offsetLineSegmentGeometry(start, end, offsetDistance);

export const cadBuildParallelLine = (
  start: CadWorldPoint,
  end: CadWorldPoint,
  throughPoint: CadWorldPoint,
) => buildParallelLineGeometry(start, end, throughPoint);

export const cadBuildPerpendicularFoot = (
  lineStart: CadWorldPoint,
  lineEnd: CadWorldPoint,
  fromPoint: CadWorldPoint,
) => buildPerpendicularFootGeometry(lineStart, lineEnd, fromPoint);

export const cadBuildCurveMetricsFromRadiusDelta = (
  radius: number,
  deltaDeg: number,
) => buildCurveMetricsFromRadiusDeltaGeometry(radius, deltaDeg);

export const cadBuildCurveMetricsFromArcLength = (
  radius: number,
  arcLength: number,
) => buildCurveMetricsFromArcLengthGeometry(radius, arcLength);

export const cadBuildCurveMetricsFromChordLength = (
  radius: number,
  chordLength: number,
) => buildCurveMetricsFromChordLengthGeometry(radius, chordLength);

export const cadBuildCurveMetricsFromTangentLength = (
  radius: number,
  tangentLength: number,
) => buildCurveMetricsFromTangentLengthGeometry(radius, tangentLength);

export const cadBuildArcFromThreePoints = (
  startPoint: CadWorldPoint,
  throughPoint: CadWorldPoint,
  endPoint: CadWorldPoint,
) => buildArcFromThreePointsGeometry(startPoint, throughPoint, endPoint);

export const cadBuildTangentCurve = (
  piPoint: CadWorldPoint,
  backTangentPoint: CadWorldPoint,
  aheadTangentPoint: CadWorldPoint,
  radius: number,
) => buildTangentCurveGeometry(piPoint, backTangentPoint, aheadTangentPoint, radius);

export const buildCadNamedPoint = (
  point: CadWorldPoint,
  label: string,
): CadNamedPoint => ({
  ...point,
  label,
});
