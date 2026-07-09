import {
  cadBuildArcFromThreePoints as buildArcFromThreePointsGeometry,
  cadBuildArcFromStartEndRadius as buildArcFromStartEndRadiusGeometry,
  cadBuildArcFromStartTangentRadiusDelta as buildArcFromStartTangentRadiusDeltaGeometry,
  cadBuildCurveMetricsFromArcLength as buildCurveMetricsFromArcLengthGeometry,
  cadBuildCurveMetricsFromChordLength as buildCurveMetricsFromChordLengthGeometry,
  cadBuildCurveMetricsFromRadiusDelta as buildCurveMetricsFromRadiusDeltaGeometry,
  cadBuildCurveMetricsFromTangentLength as buildCurveMetricsFromTangentLengthGeometry,
  cadBuildTangentCurve as buildTangentCurveGeometry,
  cadArcEndPoint,
  cadArcEndTangentAzimuthDeg,
  cadAzimuthDeg,
  cadNormalizeAngleDeg,
  cadParseBearingDegrees,
  cadPointFromAzimuthDistance,
  cadPointOnCircle,
  cadSignedSweepDeg,
  type CadCurveMetrics,
  type CadWorldPoint,
} from './cadGeometry';
import type { CadArcEntity } from './cadTypes';

export interface CadCurveMetricsSummary extends CadCurveMetrics {
  externalDistance: number;
  middleOrdinate: number;
}

const padInteger = (value: number, width: number): string => value.toString().padStart(width, '0');

const formatCadBearingForCurve = (azimuthDeg: number): string => {
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

const cadPointFromBearingDistanceForCurve = (
  from: CadWorldPoint,
  bearing: string,
  distance: number,
): CadWorldPoint | null => {
  const azimuthDeg = cadParseBearingDegrees(bearing);
  if (azimuthDeg == null) return null;
  return cadPointFromAzimuthDistance(from, azimuthDeg, distance);
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
}): string => formatCadBearingForCurve(cadNormalizeAngleDeg(90 - angleDeg));

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
  const endPoint = cadPointFromBearingDistanceForCurve(startPoint, chordBearing, chordDistance);
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
