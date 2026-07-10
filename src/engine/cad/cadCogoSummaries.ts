import {
  cadAzimuthDeg,
  cadDistance,
  cadNormalizeAngleDeg,
  cadPointFromAzimuthDistance,
  type CadNamedPoint,
  type CadWorldPoint,
} from './cadGeometry';

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

export const buildCadNamedPoint = (
  point: CadWorldPoint,
  label: string,
): CadNamedPoint => ({
  ...point,
  label,
});

