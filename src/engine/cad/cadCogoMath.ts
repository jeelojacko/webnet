import {
  cadBuildParallelLine as buildParallelLineGeometry,
  cadBuildPerpendicularFoot as buildPerpendicularFootGeometry,
  cadAzimuthDeg,
  cadDistance,
  cadIntersectArcArc,
  cadIntersectCircleCircle,
  cadIntersectInfiniteLineCircle,
  cadIntersectSegmentArc,
  cadInfiniteLineIntersection,
  cadOffsetLineSegment as offsetLineSegmentGeometry,
  cadParseBearingDegrees,
  cadPointFromAzimuthDistance,
  cadProjectPointOntoInfiniteLine,
  cadSegmentIntersection,
  type CadNamedPoint,
  type CadWorldPoint,
} from './cadGeometry';
import type {
  CadArcEntity,
  CadEntity,
  CadEntityId,
  CadLineEntity,
  CadParcelLayoutRemainderDistribution,
  CadParcelLayoutSettings,
  CadParcelEntity,
  CadPolylineEntity,
} from './cadTypes';

export * from './cadCogoCurveMath';

export * from './cadCogoSummaries';

export interface CadIntersectionSolution {
  point: CadWorldPoint;
  label: string;
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

export const cadPointFromBearingDistance = (
  from: CadWorldPoint,
  bearing: string,
  distance: number,
): CadWorldPoint | null => {
  const azimuthDeg = cadParseBearingDegrees(bearing);
  if (azimuthDeg == null) return null;
  return cadPointFromAzimuthDistance(from, azimuthDeg, distance);
};

export const cadComputeTurnedAnglePoint = ({
  occupyPoint,
  backsightPoint,
  angleDeg,
  distance,
  side,
}: {
  occupyPoint: CadWorldPoint;
  backsightPoint: CadWorldPoint;
  angleDeg: number;
  distance: number;
  side: 'left' | 'right';
}): CadWorldPoint => {
  const backsightAzimuth = cadAzimuthDeg(occupyPoint, backsightPoint);
  const forwardAzimuth = side === 'right' ? backsightAzimuth + angleDeg : backsightAzimuth - angleDeg;
  return cadPointFromAzimuthDistance(occupyPoint, forwardAzimuth, distance);
};

export const cadComputeDeflectionAnglePoint = ({
  lineStart,
  lineEnd,
  angleDeg,
  distance,
  side,
}: {
  lineStart: CadWorldPoint;
  lineEnd: CadWorldPoint;
  angleDeg: number;
  distance: number;
  side: 'left' | 'right';
}): CadWorldPoint => {
  const tangentAzimuth = cadAzimuthDeg(lineStart, lineEnd);
  const forwardAzimuth = side === 'right' ? tangentAzimuth + angleDeg : tangentAzimuth - angleDeg;
  return cadPointFromAzimuthDistance(lineEnd, forwardAzimuth, distance);
};

export const cadPointAtDistanceAlongLine = (
  start: CadWorldPoint,
  end: CadWorldPoint,
  distanceAlong: number,
): CadWorldPoint | null => {
  const length = cadDistance(start, end);
  if (!Number.isFinite(distanceAlong) || length <= 1e-12) return null;
  const ratio = distanceAlong / length;
  return {
    x: start.x + (end.x - start.x) * ratio,
    y: start.y + (end.y - start.y) * ratio,
  };
};

export const cadPointAtFractionAlongLine = (
  start: CadWorldPoint,
  end: CadWorldPoint,
  fraction: number,
): CadWorldPoint | null => {
  if (!Number.isFinite(fraction)) return null;
  return {
    x: start.x + (end.x - start.x) * fraction,
    y: start.y + (end.y - start.y) * fraction,
  };
};

export const cadExtendLineByDistance = (
  start: CadWorldPoint,
  end: CadWorldPoint,
  distance: number,
): CadWorldPoint | null => {
  const length = cadDistance(start, end);
  if (!Number.isFinite(distance) || length <= 1e-12) return null;
  return cadPointAtDistanceAlongLine(start, end, length + distance);
};

export const cadOffsetPointFromLine = ({
  lineStart,
  lineEnd,
  alongDistance,
  offsetDistance,
  side,
}: {
  lineStart: CadWorldPoint;
  lineEnd: CadWorldPoint;
  alongDistance: number;
  offsetDistance: number;
  side: 'left' | 'right';
}): CadWorldPoint | null => {
  const basePoint = cadPointAtDistanceAlongLine(lineStart, lineEnd, alongDistance);
  const lineLength = cadDistance(lineStart, lineEnd);
  if (!basePoint || lineLength <= 1e-12 || !Number.isFinite(offsetDistance)) return null;
  const unitX = (lineEnd.x - lineStart.x) / lineLength;
  const unitY = (lineEnd.y - lineStart.y) / lineLength;
  const leftX = -unitY;
  const leftY = unitX;
  const multiplier = side === 'left' ? 1 : -1;
  return {
    x: basePoint.x + leftX * offsetDistance * multiplier,
    y: basePoint.y + leftY * offsetDistance * multiplier,
  };
};

const sortIntersectionSolutions = (
  solutions: readonly CadIntersectionSolution[],
): CadIntersectionSolution[] =>
  [...solutions].sort((left, right) => {
    if (Math.abs(right.point.y - left.point.y) > 1e-9) return right.point.y - left.point.y;
    if (Math.abs(left.point.x - right.point.x) > 1e-9) return left.point.x - right.point.x;
    return left.label.localeCompare(right.label);
  });

export const cadIntersectBearings = ({
  firstPoint,
  firstBearing,
  secondPoint,
  secondBearing,
  firstLabel = 'A',
  secondLabel = 'B',
}: {
  firstPoint: CadWorldPoint;
  firstBearing: string;
  secondPoint: CadWorldPoint;
  secondBearing: string;
  firstLabel?: string;
  secondLabel?: string;
}): CadIntersectionSolution | null => {
  const firstAzimuthDeg = cadParseBearingDegrees(firstBearing);
  const secondAzimuthDeg = cadParseBearingDegrees(secondBearing);
  if (firstAzimuthDeg == null || secondAzimuthDeg == null) return null;
  const firstAhead = cadPointFromAzimuthDistance(firstPoint, firstAzimuthDeg, 1);
  const secondAhead = cadPointFromAzimuthDistance(secondPoint, secondAzimuthDeg, 1);
  const point = cadInfiniteLineIntersection(firstPoint, firstAhead, secondPoint, secondAhead);
  if (!point) return null;
  return {
    point,
    label: `${firstLabel} ${firstBearing} x ${secondLabel} ${secondBearing}`,
  };
};

export const cadIntersectBearingDistance = ({
  bearingPoint,
  bearing,
  distancePoint,
  distance,
  bearingLabel = 'A',
  distanceLabel = 'B',
}: {
  bearingPoint: CadWorldPoint;
  bearing: string;
  distancePoint: CadWorldPoint;
  distance: number;
  bearingLabel?: string;
  distanceLabel?: string;
}): CadIntersectionSolution[] => {
  const azimuthDeg = cadParseBearingDegrees(bearing);
  if (azimuthDeg == null || !Number.isFinite(distance) || distance < 0) return [];
  return sortIntersectionSolutions(
    cadIntersectInfiniteLineCircle(
      bearingPoint,
      cadPointFromAzimuthDistance(bearingPoint, azimuthDeg, 1),
      distancePoint,
      distance,
    ).map((point, index) => ({
      point,
      label: `${bearingLabel} ${bearing} x ${distanceLabel} r=${distance.toFixed(3)} (${index + 1})`,
    })),
  );
};

export const cadIntersectDistanceDistance = ({
  firstPoint,
  firstDistance,
  secondPoint,
  secondDistance,
  firstLabel = 'A',
  secondLabel = 'B',
}: {
  firstPoint: CadWorldPoint;
  firstDistance: number;
  secondPoint: CadWorldPoint;
  secondDistance: number;
  firstLabel?: string;
  secondLabel?: string;
}): CadIntersectionSolution[] => {
  if (
    !Number.isFinite(firstDistance) ||
    !Number.isFinite(secondDistance) ||
    firstDistance < 0 ||
    secondDistance < 0
  ) {
    return [];
  }
  return sortIntersectionSolutions(
    cadIntersectCircleCircle(firstPoint, firstDistance, secondPoint, secondDistance).map((point, index) => ({
      point,
      label: `${firstLabel} r=${firstDistance.toFixed(3)} x ${secondLabel} r=${secondDistance.toFixed(3)} (${index + 1})`,
    })),
  );
};

export const cadIntersectLineCircle = ({
  lineStart,
  lineEnd,
  center,
  radius,
  lineLabel = 'Line',
  centerLabel = 'Center',
}: {
  lineStart: CadWorldPoint;
  lineEnd: CadWorldPoint;
  center: CadWorldPoint;
  radius: number;
  lineLabel?: string;
  centerLabel?: string;
}): CadIntersectionSolution[] => {
  if (!Number.isFinite(radius) || radius < 0) return [];
  return sortIntersectionSolutions(
    cadIntersectInfiniteLineCircle(lineStart, lineEnd, center, radius).map((point, index) => ({
      point,
      label: `${lineLabel} x ${centerLabel} r=${radius.toFixed(3)} (${index + 1})`,
    })),
  );
};

export const cadIntersectOffsetLines = ({
  firstLineStart,
  firstLineEnd,
  firstOffset,
  secondLineStart,
  secondLineEnd,
  secondOffset,
  firstLabel = 'L1',
  secondLabel = 'L2',
}: {
  firstLineStart: CadWorldPoint;
  firstLineEnd: CadWorldPoint;
  firstOffset: number;
  secondLineStart: CadWorldPoint;
  secondLineEnd: CadWorldPoint;
  secondOffset: number;
  firstLabel?: string;
  secondLabel?: string;
}): CadIntersectionSolution | null => {
  const firstOffsetLine = cadOffsetLineSegment(firstLineStart, firstLineEnd, firstOffset);
  const secondOffsetLine = cadOffsetLineSegment(secondLineStart, secondLineEnd, secondOffset);
  const point = cadInfiniteLineIntersection(
    firstOffsetLine.start,
    firstOffsetLine.end,
    secondOffsetLine.start,
    secondOffsetLine.end,
  );
  if (!point) return null;
  return {
    point,
    label: `${firstLabel} off ${firstOffset.toFixed(3)} x ${secondLabel} off ${secondOffset.toFixed(3)}`,
  };
};

export const cadIntersectPerpendicular = ({
  lineStart,
  lineEnd,
  fromPoint,
  lineLabel = 'Line',
  pointLabel = 'Point',
}: {
  lineStart: CadWorldPoint;
  lineEnd: CadWorldPoint;
  fromPoint: CadWorldPoint;
  lineLabel?: string;
  pointLabel?: string;
}): CadIntersectionSolution | null => {
  const projection = cadProjectPointOntoInfiniteLine(fromPoint, lineStart, lineEnd);
  return {
    point: projection.point,
    label: `${pointLabel} perp ${lineLabel}`,
  };
};

export const cadIntersectSkew = ({
  lineStart,
  lineEnd,
  fromPoint,
  angleDeg,
  side,
  lineLabel = 'Line',
  pointLabel = 'Point',
}: {
  lineStart: CadWorldPoint;
  lineEnd: CadWorldPoint;
  fromPoint: CadWorldPoint;
  angleDeg: number;
  side: 'left' | 'right';
  lineLabel?: string;
  pointLabel?: string;
}): CadIntersectionSolution | null => {
  if (!Number.isFinite(angleDeg)) return null;
  const lineAzimuth = cadAzimuthDeg(lineStart, lineEnd);
  const skewAzimuth = side === 'left' ? lineAzimuth - angleDeg : lineAzimuth + angleDeg;
  const point = cadInfiniteLineIntersection(
    lineStart,
    lineEnd,
    fromPoint,
    cadPointFromAzimuthDistance(fromPoint, skewAzimuth, 1),
  );
  if (!point) return null;
  return {
    point,
    label: `${pointLabel} skew ${side} ${angleDeg.toFixed(4)} on ${lineLabel}`,
  };
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
