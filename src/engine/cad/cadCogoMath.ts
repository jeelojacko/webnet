import {
  cadBuildArcFromThreePoints as buildArcFromThreePointsGeometry,
  cadBuildArcFromStartEndRadius as buildArcFromStartEndRadiusGeometry,
  cadBuildParallelLine as buildParallelLineGeometry,
  cadBuildPerpendicularFoot as buildPerpendicularFootGeometry,
  cadBuildArcFromStartTangentRadiusDelta as buildArcFromStartTangentRadiusDeltaGeometry,
  cadBuildCurveMetricsFromArcLength as buildCurveMetricsFromArcLengthGeometry,
  cadBuildCurveMetricsFromChordLength as buildCurveMetricsFromChordLengthGeometry,
  cadBuildCurveMetricsFromRadiusDelta as buildCurveMetricsFromRadiusDeltaGeometry,
  cadBuildCurveMetricsFromTangentLength as buildCurveMetricsFromTangentLengthGeometry,
  cadBuildTangentCurve as buildTangentCurveGeometry,
  cadArcEndPoint,
  cadArcEndTangentAzimuthDeg,
  cadAzimuthDeg,
  cadDistance,
  cadIntersectArcArc,
  cadIntersectCircleCircle,
  cadIntersectInfiniteLineCircle,
  cadIntersectSegmentArc,
  cadInfiniteLineIntersection,
  cadNormalizeAngleDeg,
  cadOffsetLineSegment as offsetLineSegmentGeometry,
  cadParseBearingDegrees,
  cadPointFromAzimuthDistance,
  cadPointOnCircle,
  cadProjectPointOntoInfiniteLine,
  cadSignedSweepDeg,
  cadSegmentIntersection,
  type CadNamedPoint,
  type CadCurveMetrics,
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

export interface CadInverseSummary {
  distance: number;
  azimuthDeg: number;
  bearing: string;
}

export interface CadDistanceSummary {
  deltaX: number;
  deltaY: number;
  distance2d: number;
}

export interface CadMultiInverseLegSummary extends CadInverseSummary {
  fromLabel: string;
  toLabel: string;
}

export interface CadMultiInverseSummary {
  legs: CadMultiInverseLegSummary[];
  totalDistance: number;
}

export type CadTraverseAdjustmentMethod = 'angular' | 'bowditch' | 'transit';

export interface CadTraverseAdjustmentLegSummary {
  fromLabel: string;
  toLabel: string;
  distanceMeters: number;
  rawBearing: string;
  adjustedBearing: string;
  rawDeltaX: number;
  rawDeltaY: number;
  adjustedDeltaX: number;
  adjustedDeltaY: number;
  correctionX: number;
  correctionY: number;
}

export interface CadTraverseAdjustmentSummary {
  method: CadTraverseAdjustmentMethod;
  targetLabel: string;
  rawClosureDeltaX: number;
  rawClosureDeltaY: number;
  rawClosureDistanceMeters: number;
  adjustedClosureDeltaX: number;
  adjustedClosureDeltaY: number;
  adjustedClosureDistanceMeters: number;
  rawClosureBearing: string | null;
  adjustedClosureBearing: string | null;
  angularCorrectionPerLegDeg: number | null;
  angularCorrectionPerLegSec: number | null;
  legs: CadTraverseAdjustmentLegSummary[];
  adjustedPoints: CadNamedPoint[];
}

export interface CadIntersectionSolution {
  point: CadWorldPoint;
  label: string;
}

export interface CadCurveMetricsSummary extends CadCurveMetrics {
  externalDistance: number;
  middleOrdinate: number;
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
export const formatCadNorthAzimuthDms = (azimuthDeg: number): string => {
  const normalized = ((azimuthDeg % 360) + 360) % 360;
  let degrees = Math.floor(normalized);
  let minutesFloat = (normalized - degrees) * 60;
  let minutes = Math.floor(minutesFloat);
  let seconds = Math.round((minutesFloat - minutes) * 60);

  if (seconds >= 60) {
    seconds = 0;
    minutes += 1;
  }
  if (minutes >= 60) {
    minutes = 0;
    degrees += 1;
  }
  if (degrees >= 360) {
    degrees = 0;
  }

  return `${degrees}°${padInteger(minutes, 2)}'${padInteger(seconds, 2)}"`;
};

export const formatCadSweepDms = (sweepDeg: number): string => {
  const absoluteSweep = Math.abs(sweepDeg);
  const normalized =
    Math.abs(absoluteSweep - 360) <= 1e-9
      ? 360
      : ((absoluteSweep % 360) + 360) % 360;
  let degrees = Math.floor(normalized);
  let minutesFloat = (normalized - degrees) * 60;
  let minutes = Math.floor(minutesFloat);
  let seconds = Math.round((minutesFloat - minutes) * 60);

  if (seconds >= 60) {
    seconds = 0;
    minutes += 1;
  }
  if (minutes >= 60) {
    minutes = 0;
    degrees += 1;
  }
  if (degrees > 360) {
    degrees = 360;
    minutes = 0;
    seconds = 0;
  }

  return `${degrees}°${padInteger(minutes, 2)}'${padInteger(seconds, 2)}"`;
};

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

export const buildCadDistanceSummary = (
  from: CadWorldPoint,
  to: CadWorldPoint,
): CadDistanceSummary => ({
  deltaX: to.x - from.x,
  deltaY: to.y - from.y,
  distance2d: cadDistance(from, to),
});

export const buildCadMultiInverseSummary = (
  points: readonly CadNamedPoint[],
): CadMultiInverseSummary => {
  const legs: CadMultiInverseLegSummary[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const from = points[index]!;
    const to = points[index + 1]!;
    const inverse = buildCadInverseSummary(from, to);
    legs.push({
      ...inverse,
      fromLabel: from.label,
      toLabel: to.label,
    });
  }
  return {
    legs,
    totalDistance: legs.reduce((sum, leg) => sum + leg.distance, 0),
  };
};

export const cadAdjustTraverse = ({
  points,
  targetPoint,
  method,
}: {
  points: readonly CadNamedPoint[];
  targetPoint: CadNamedPoint;
  method: CadTraverseAdjustmentMethod;
}): CadTraverseAdjustmentSummary | null => {
  if (points.length < 2) return null;
  const startPoint = points[0]!;
  const lastPoint = points[points.length - 1]!;
  const rawClosure = buildCadDistanceSummary(lastPoint, targetPoint);
  const rawClosureBearing =
    rawClosure.distance2d > 1e-9 ? buildCadInverseSummary(lastPoint, targetPoint).bearing : null;
  const rawLegs = points.slice(1).map((point, index) => {
    const fromPoint = points[index]!;
    const inverse = buildCadInverseSummary(fromPoint, point);
    const distance = buildCadDistanceSummary(fromPoint, point);
    return {
      fromPoint,
      toPoint: point,
      distanceMeters: inverse.distance,
      azimuthDeg: inverse.azimuthDeg,
      bearing: inverse.bearing,
      deltaX: distance.deltaX,
      deltaY: distance.deltaY,
    };
  });
  if (rawLegs.length === 0) return null;

  const adjustedPoints: CadNamedPoint[] = [{ label: startPoint.label, x: startPoint.x, y: startPoint.y }];
  const legSummaries: CadTraverseAdjustmentLegSummary[] = [];
  let angularCorrectionPerLegDeg: number | null = null;

  if (method === 'angular') {
    const finalLeg = rawLegs[rawLegs.length - 1]!;
    const targetAzimuthDeg =
      rawClosure.distance2d > 1e-9 ? cadAzimuthDeg(lastPoint, targetPoint) : finalLeg.azimuthDeg;
    const azimuthDifferenceDeg = cadNormalizeAngleDeg(targetAzimuthDeg - finalLeg.azimuthDeg);
    angularCorrectionPerLegDeg = azimuthDifferenceDeg / rawLegs.length;
    rawLegs.forEach((leg, index) => {
      const adjustedAzimuthDeg = cadNormalizeAngleDeg(leg.azimuthDeg + angularCorrectionPerLegDeg! * (index + 1));
      const nextPoint = cadPointFromAzimuthDistance(
        adjustedPoints[adjustedPoints.length - 1]!,
        adjustedAzimuthDeg,
        leg.distanceMeters,
      );
      const adjustedDelta = buildCadDistanceSummary(adjustedPoints[adjustedPoints.length - 1]!, nextPoint);
      adjustedPoints.push({
        label: leg.toPoint.label,
        x: nextPoint.x,
        y: nextPoint.y,
      });
      legSummaries.push({
        fromLabel: leg.fromPoint.label,
        toLabel: leg.toPoint.label,
        distanceMeters: leg.distanceMeters,
        rawBearing: leg.bearing,
        adjustedBearing: formatCadBearing(adjustedAzimuthDeg),
        rawDeltaX: leg.deltaX,
        rawDeltaY: leg.deltaY,
        adjustedDeltaX: adjustedDelta.deltaX,
        adjustedDeltaY: adjustedDelta.deltaY,
        correctionX: adjustedDelta.deltaX - leg.deltaX,
        correctionY: adjustedDelta.deltaY - leg.deltaY,
      });
    });
  } else {
    const totalLength = rawLegs.reduce((sum, leg) => sum + leg.distanceMeters, 0);
    const totalAbsDeltaX = rawLegs.reduce((sum, leg) => sum + Math.abs(leg.deltaX), 0);
    const totalAbsDeltaY = rawLegs.reduce((sum, leg) => sum + Math.abs(leg.deltaY), 0);
    rawLegs.forEach((leg) => {
      const deltaXWeight =
        method === 'bowditch'
          ? totalLength > 1e-12
            ? leg.distanceMeters / totalLength
            : 0
          : totalAbsDeltaX > 1e-12
            ? Math.abs(leg.deltaX) / totalAbsDeltaX
            : totalLength > 1e-12
              ? leg.distanceMeters / totalLength
              : 0;
      const deltaYWeight =
        method === 'bowditch'
          ? totalLength > 1e-12
            ? leg.distanceMeters / totalLength
            : 0
          : totalAbsDeltaY > 1e-12
            ? Math.abs(leg.deltaY) / totalAbsDeltaY
            : totalLength > 1e-12
              ? leg.distanceMeters / totalLength
              : 0;
      const adjustedDeltaX = leg.deltaX + rawClosure.deltaX * deltaXWeight;
      const adjustedDeltaY = leg.deltaY + rawClosure.deltaY * deltaYWeight;
      const nextPoint = {
        x: adjustedPoints[adjustedPoints.length - 1]!.x + adjustedDeltaX,
        y: adjustedPoints[adjustedPoints.length - 1]!.y + adjustedDeltaY,
      };
      adjustedPoints.push({
        label: leg.toPoint.label,
        x: nextPoint.x,
        y: nextPoint.y,
      });
      legSummaries.push({
        fromLabel: leg.fromPoint.label,
        toLabel: leg.toPoint.label,
        distanceMeters: Math.hypot(adjustedDeltaX, adjustedDeltaY),
        rawBearing: leg.bearing,
        adjustedBearing: formatCadBearing(cadAzimuthDeg(adjustedPoints[adjustedPoints.length - 2]!, nextPoint)),
        rawDeltaX: leg.deltaX,
        rawDeltaY: leg.deltaY,
        adjustedDeltaX,
        adjustedDeltaY,
        correctionX: adjustedDeltaX - leg.deltaX,
        correctionY: adjustedDeltaY - leg.deltaY,
      });
    });
  }

  const adjustedLastPoint = adjustedPoints[adjustedPoints.length - 1]!;
  const adjustedClosure = buildCadDistanceSummary(adjustedLastPoint, targetPoint);
  const adjustedClosureBearing =
    adjustedClosure.distance2d > 1e-9 ? buildCadInverseSummary(adjustedLastPoint, targetPoint).bearing : null;
  return {
    method,
    targetLabel: targetPoint.label,
    rawClosureDeltaX: rawClosure.deltaX,
    rawClosureDeltaY: rawClosure.deltaY,
    rawClosureDistanceMeters: rawClosure.distance2d,
    adjustedClosureDeltaX: adjustedClosure.deltaX,
    adjustedClosureDeltaY: adjustedClosure.deltaY,
    adjustedClosureDistanceMeters: adjustedClosure.distance2d,
    rawClosureBearing,
    adjustedClosureBearing,
    angularCorrectionPerLegDeg,
    angularCorrectionPerLegSec:
      angularCorrectionPerLegDeg == null ? null : angularCorrectionPerLegDeg * 3600,
    legs: legSummaries,
    adjustedPoints,
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

const buildCadCurveMetricsSummary = (
  metrics: CadCurveMetrics | null,
): CadCurveMetricsSummary | null => {
  if (!metrics) return null;
  const halfDeltaRad = (metrics.deltaDeg * Math.PI) / 360;
  return {
    ...metrics,
    externalDistance: metrics.radius * (1 / Math.cos(halfDeltaRad) - 1),
    middleOrdinate: metrics.radius * (1 - Math.cos(halfDeltaRad)),
  };
};

const solveCurveDeltaFromBisection = (
  evaluator: (_deltaRad: number) => number,
): number | null => {
  let low = 1e-9;
  let high = Math.PI - 1e-9;
  let lowValue = evaluator(low);
  let highValue = evaluator(high);
  if (!Number.isFinite(lowValue) || !Number.isFinite(highValue) || lowValue === 0) {
    return lowValue === 0 ? low : null;
  }
  if (highValue === 0) return high;
  if (Math.sign(lowValue) === Math.sign(highValue)) return null;
  for (let iteration = 0; iteration < 80; iteration += 1) {
    const mid = (low + high) / 2;
    const value = evaluator(mid);
    if (!Number.isFinite(value)) return null;
    if (Math.abs(value) <= 1e-12) return mid;
    if (Math.sign(value) === Math.sign(lowValue)) {
      low = mid;
      lowValue = value;
    } else {
      high = mid;
      highValue = value;
    }
    if (Math.abs(high - low) <= 1e-12 || Math.abs(highValue - lowValue) <= 1e-12) break;
  }
  return (low + high) / 2;
};

export const cadSolveCurveMetrics = ({
  pair,
  firstValue,
  secondValue,
}: {
  pair:
    | 'radius-delta'
    | 'radius-arc'
    | 'radius-chord'
    | 'radius-tangent'
    | 'delta-arc'
    | 'delta-chord'
    | 'delta-tangent'
    | 'arc-chord'
    | 'arc-tangent'
    | 'chord-tangent';
  firstValue: number;
  secondValue: number;
}): CadCurveMetricsSummary | null => {
  if (!Number.isFinite(firstValue) || !Number.isFinite(secondValue)) return null;
  switch (pair) {
    case 'radius-delta':
      return buildCadCurveMetricsSummary(cadBuildCurveMetricsFromRadiusDelta(firstValue, secondValue));
    case 'radius-arc':
      return buildCadCurveMetricsSummary(cadBuildCurveMetricsFromArcLength(firstValue, secondValue));
    case 'radius-chord':
      return buildCadCurveMetricsSummary(cadBuildCurveMetricsFromChordLength(firstValue, secondValue));
    case 'radius-tangent':
      return buildCadCurveMetricsSummary(cadBuildCurveMetricsFromTangentLength(firstValue, secondValue));
    case 'delta-arc': {
      const deltaRad = (firstValue * Math.PI) / 180;
      if (Math.abs(deltaRad) <= 1e-12) return null;
      return buildCadCurveMetricsSummary(cadBuildCurveMetricsFromRadiusDelta(secondValue / deltaRad, firstValue));
    }
    case 'delta-chord': {
      const halfDeltaRad = (firstValue * Math.PI) / 360;
      const sinHalf = Math.sin(halfDeltaRad);
      if (Math.abs(sinHalf) <= 1e-12) return null;
      return buildCadCurveMetricsSummary(
        cadBuildCurveMetricsFromRadiusDelta(secondValue / (2 * sinHalf), firstValue),
      );
    }
    case 'delta-tangent': {
      const halfDeltaRad = (firstValue * Math.PI) / 360;
      const tangent = Math.tan(halfDeltaRad);
      if (Math.abs(tangent) <= 1e-12) return null;
      return buildCadCurveMetricsSummary(
        cadBuildCurveMetricsFromRadiusDelta(secondValue / tangent, firstValue),
      );
    }
    case 'arc-chord': {
      const deltaRad = solveCurveDeltaFromBisection(
        (candidate) => 2 * (firstValue / candidate) * Math.sin(candidate / 2) - secondValue,
      );
      if (deltaRad == null) return null;
      return buildCadCurveMetricsSummary(
        cadBuildCurveMetricsFromRadiusDelta(firstValue / deltaRad, (deltaRad * 180) / Math.PI),
      );
    }
    case 'arc-tangent': {
      const deltaRad = solveCurveDeltaFromBisection(
        (candidate) => (firstValue / candidate) * Math.tan(candidate / 2) - secondValue,
      );
      if (deltaRad == null) return null;
      return buildCadCurveMetricsSummary(
        cadBuildCurveMetricsFromRadiusDelta(firstValue / deltaRad, (deltaRad * 180) / Math.PI),
      );
    }
    case 'chord-tangent': {
      const deltaRad = solveCurveDeltaFromBisection(
        (candidate) =>
          (secondValue * 2 * Math.sin(candidate / 2)) / Math.tan(candidate / 2) - firstValue,
      );
      if (deltaRad == null) return null;
      const radius = firstValue / (2 * Math.sin(deltaRad / 2));
      return buildCadCurveMetricsSummary(
        cadBuildCurveMetricsFromRadiusDelta(radius, (deltaRad * 180) / Math.PI),
      );
    }
  }
};

export const cadBuildCurveMetricsSummaryFromRadiusDelta = (
  radius: number,
  deltaDeg: number,
): CadCurveMetricsSummary | null =>
  buildCadCurveMetricsSummary(cadBuildCurveMetricsFromRadiusDelta(radius, deltaDeg));

export const cadArcPointByArcDistance = (
  arc: Pick<CadArcEntity, 'centerX' | 'centerY' | 'radius' | 'startAngleDeg' | 'endAngleDeg'>,
  arcDistance: number,
): CadWorldPoint | null => {
  if (!Number.isFinite(arcDistance) || arc.radius <= 1e-12) return null;
  const sweepDeg = cadSignedSweepDeg(arc.startAngleDeg, arc.endAngleDeg);
  const totalArcLength = Math.abs((sweepDeg * Math.PI * arc.radius) / 180);
  if (arcDistance < -1e-9 || arcDistance - totalArcLength > 1e-9) return null;
  const deltaDeg = (arcDistance / arc.radius) * (180 / Math.PI);
  const angleDeg = arc.startAngleDeg + (sweepDeg >= 0 ? deltaDeg : -deltaDeg);
  return cadPointOnCircle({ x: arc.centerX, y: arc.centerY }, arc.radius, angleDeg);
};

export const cadArcPointByChordDistance = (
  arc: Pick<CadArcEntity, 'centerX' | 'centerY' | 'radius' | 'startAngleDeg' | 'endAngleDeg'>,
  chordDistance: number,
): CadWorldPoint | null => {
  const metrics = cadBuildCurveMetricsFromChordLength(arc.radius, chordDistance);
  const totalSweep = Math.abs(cadSignedSweepDeg(arc.startAngleDeg, arc.endAngleDeg));
  if (!metrics || metrics.deltaDeg - totalSweep > 1e-9) return null;
  const angleDeg =
    arc.startAngleDeg + (cadSignedSweepDeg(arc.startAngleDeg, arc.endAngleDeg) >= 0 ? metrics.deltaDeg : -metrics.deltaDeg);
  return cadPointOnCircle({ x: arc.centerX, y: arc.centerY }, arc.radius, angleDeg);
};

export const cadArcSubdivisionPoints = ({
  arc,
  mode,
  value,
}: {
  arc: Pick<CadArcEntity, 'centerX' | 'centerY' | 'radius' | 'startAngleDeg' | 'endAngleDeg'>;
  mode: 'equal' | 'arc' | 'chord';
  value: number;
}): CadWorldPoint[] => {
  const totalSweep = cadSignedSweepDeg(arc.startAngleDeg, arc.endAngleDeg);
  const totalArcLength = Math.abs((totalSweep * Math.PI * arc.radius) / 180);
  if (!Number.isFinite(value) || value <= 0 || totalArcLength <= 1e-12) return [];
  if (mode === 'equal') {
    const divisionCount = Math.floor(value);
    if (divisionCount < 2) return [];
    return Array.from({ length: divisionCount - 1 }, (_, index) => {
      const fraction = (index + 1) / divisionCount;
      const angleDeg = arc.startAngleDeg + totalSweep * fraction;
      return cadPointOnCircle({ x: arc.centerX, y: arc.centerY }, arc.radius, angleDeg);
    });
  }
  const points: CadWorldPoint[] = [];
  let cursor = value;
  while (cursor < totalArcLength - 1e-9) {
    const point =
      mode === 'arc'
        ? cadArcPointByArcDistance(arc, cursor)
        : cadArcPointByChordDistance(arc, cursor);
    if (!point) break;
    points.push(point);
    cursor += value;
  }
  return points;
};

export const cadOffsetArc = ({
  arc,
  offsetDistance,
  side,
}: {
  arc: Pick<CadArcEntity, 'centerX' | 'centerY' | 'radius' | 'startAngleDeg' | 'endAngleDeg'>;
  offsetDistance: number;
  side: 'left' | 'right';
}): {
  center: CadWorldPoint;
  radius: number;
  startAngleDeg: number;
  endAngleDeg: number;
} | null => {
  const sweep = cadSignedSweepDeg(arc.startAngleDeg, arc.endAngleDeg);
  const radiusDelta =
    sweep >= 0
      ? side === 'left'
        ? -offsetDistance
        : offsetDistance
      : side === 'left'
        ? offsetDistance
        : -offsetDistance;
  const radius = arc.radius + radiusDelta;
  if (!Number.isFinite(radius) || radius <= 1e-6) return null;
  return {
    center: { x: arc.centerX, y: arc.centerY },
    radius,
    startAngleDeg: arc.startAngleDeg,
    endAngleDeg: arc.endAngleDeg,
  };
};

export const cadRadialBearingAtArcAngle = ({
  arc: _arc,
  angleDeg,
}: {
  arc: Pick<CadArcEntity, 'centerX' | 'centerY'>;
  angleDeg: number;
}): string => formatCadBearing(cadNormalizeAngleDeg(90 - angleDeg));

export const cadBuildArcFromPiRadiusDelta = ({
  piPoint,
  backTangentPoint,
  radius,
  deltaDeg,
  side,
}: {
  piPoint: CadWorldPoint;
  backTangentPoint: CadWorldPoint;
  radius: number;
  deltaDeg: number;
  side: 'left' | 'right';
}) => {
  const metrics = cadBuildCurveMetricsFromRadiusDelta(radius, deltaDeg);
  if (!metrics) return null;
  const backAzimuthFromPi = cadAzimuthDeg(piPoint, backTangentPoint);
  const incomingTangentAzimuth = cadNormalizeAngleDeg(backAzimuthFromPi + 180);
  const startPoint = cadPointFromAzimuthDistance(piPoint, backAzimuthFromPi, metrics.tangentLength);
  return buildArcFromStartTangentRadiusDeltaGeometry(
    startPoint,
    incomingTangentAzimuth,
    radius,
    deltaDeg,
    side,
  );
};

export const cadBuildArcFromChordBearingRadius = ({
  startPoint,
  chordBearing,
  chordDistance,
  radius,
  side,
}: {
  startPoint: CadWorldPoint;
  chordBearing: string;
  chordDistance: number;
  radius: number;
  side: 'left' | 'right';
}) => {
  const endPoint = cadPointFromBearingDistance(startPoint, chordBearing, chordDistance);
  if (!endPoint) return null;
  return side === 'left'
    ? buildArcFromStartEndRadiusGeometry(startPoint, endPoint, radius, false)
    : buildArcFromStartEndRadiusGeometry(startPoint, endPoint, radius, true);
};

export const cadBuildReverseCurve = ({
  sourceArc,
  radius,
  deltaDeg,
}: {
  sourceArc: Pick<CadArcEntity, 'centerX' | 'centerY' | 'radius' | 'startAngleDeg' | 'endAngleDeg'>;
  radius: number;
  deltaDeg: number;
}) => {
  const sourceSweep = cadSignedSweepDeg(sourceArc.startAngleDeg, sourceArc.endAngleDeg);
  const side: 'left' | 'right' = sourceSweep >= 0 ? 'right' : 'left';
  return buildArcFromStartTangentRadiusDeltaGeometry(
    cadArcEndPoint(sourceArc),
    cadArcEndTangentAzimuthDeg(sourceArc),
    radius,
    deltaDeg,
    side,
  );
};

export const cadBuildCompoundCurve = ({
  sourceArc,
  radius,
  deltaDeg,
}: {
  sourceArc: Pick<CadArcEntity, 'centerX' | 'centerY' | 'radius' | 'startAngleDeg' | 'endAngleDeg'>;
  radius: number;
  deltaDeg: number;
}) => {
  const sourceSweep = cadSignedSweepDeg(sourceArc.startAngleDeg, sourceArc.endAngleDeg);
  const side: 'left' | 'right' = sourceSweep >= 0 ? 'left' : 'right';
  return buildArcFromStartTangentRadiusDeltaGeometry(
    cadArcEndPoint(sourceArc),
    cadArcEndTangentAzimuthDeg(sourceArc),
    radius,
    deltaDeg,
    side,
  );
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
