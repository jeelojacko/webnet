import type { CadArcEntity } from './cadTypes';
import {
  cadAngleDegFromCenter,
  cadDistance,
  cadMidpoint,
  cadNormalizeAngleDeg,
  cadPointOnCircle,
  cadSignedSweepDeg,
  type CadArcDefinition,
  type CadCurveMetrics,
  type CadWorldPoint,
} from './cadGeometry';

const cadCounterClockwiseDeltaDeg = (startAngleDeg: number, endAngleDeg: number): number =>
  cadNormalizeAngleDeg(endAngleDeg - startAngleDeg);

const cadCreateCurveMetrics = (radius: number, deltaDeg: number): CadCurveMetrics | null => {
  if (!Number.isFinite(radius) || !Number.isFinite(deltaDeg)) return null;
  if (radius <= 1e-12 || deltaDeg <= 1e-9 || deltaDeg >= 180 - 1e-9) return null;
  const deltaRad = (deltaDeg * Math.PI) / 180;
  return {
    radius,
    deltaDeg,
    arcLength: radius * deltaRad,
    chordLength: 2 * radius * Math.sin(deltaRad / 2),
    tangentLength: radius * Math.tan(deltaRad / 2),
  };
};

export const cadBuildCurveMetricsFromRadiusDelta = (
  radius: number,
  deltaDeg: number,
): CadCurveMetrics | null => cadCreateCurveMetrics(radius, deltaDeg);

export const cadBuildCurveMetricsFromArcLength = (
  radius: number,
  arcLength: number,
): CadCurveMetrics | null => {
  if (!Number.isFinite(radius) || !Number.isFinite(arcLength) || radius <= 1e-12 || arcLength <= 1e-12) {
    return null;
  }
  const deltaDeg = (arcLength / radius) * (180 / Math.PI);
  return cadCreateCurveMetrics(radius, deltaDeg);
};

export const cadBuildCurveMetricsFromChordLength = (
  radius: number,
  chordLength: number,
): CadCurveMetrics | null => {
  if (
    !Number.isFinite(radius) ||
    !Number.isFinite(chordLength) ||
    radius <= 1e-12 ||
    chordLength <= 1e-12 ||
    chordLength >= 2 * radius - 1e-9
  ) {
    return null;
  }
  const ratio = Math.max(-1, Math.min(1, chordLength / (2 * radius)));
  const deltaDeg = (2 * Math.asin(ratio) * 180) / Math.PI;
  return cadCreateCurveMetrics(radius, deltaDeg);
};

export const cadBuildCurveMetricsFromTangentLength = (
  radius: number,
  tangentLength: number,
): CadCurveMetrics | null => {
  if (
    !Number.isFinite(radius) ||
    !Number.isFinite(tangentLength) ||
    radius <= 1e-12 ||
    tangentLength <= 1e-12
  ) {
    return null;
  }
  const deltaDeg = (2 * Math.atan(tangentLength / radius) * 180) / Math.PI;
  return cadCreateCurveMetrics(radius, deltaDeg);
};

export const cadArcStartPoint = (
  arc: Pick<CadArcEntity, 'centerX' | 'centerY' | 'radius' | 'startAngleDeg'>,
): CadWorldPoint => ({
  x: arc.centerX + Math.cos((arc.startAngleDeg * Math.PI) / 180) * arc.radius,
  y: arc.centerY + Math.sin((arc.startAngleDeg * Math.PI) / 180) * arc.radius,
});

export const cadIsAngleOnArcSweep = (
  angleDeg: number,
  startAngleDeg: number,
  endAngleDeg: number,
  toleranceDeg = 1e-9,
): boolean => {
  const angle = cadNormalizeAngleDeg(angleDeg);
  const start = cadNormalizeAngleDeg(startAngleDeg);
  const signedSweep = cadSignedSweepDeg(startAngleDeg, endAngleDeg);
  const magnitude = Math.abs(signedSweep);
  if (magnitude <= toleranceDeg) return true;
  if (signedSweep >= 0) {
    return cadCounterClockwiseDeltaDeg(start, angle) <= magnitude + toleranceDeg;
  }
  return cadCounterClockwiseDeltaDeg(angle, start) <= magnitude + toleranceDeg;
};

export const cadArcMidpoint = (
  center: CadWorldPoint,
  radius: number,
  startAngleDeg: number,
  endAngleDeg: number,
): CadWorldPoint => {
  const midpointAngleDeg = startAngleDeg + cadSignedSweepDeg(startAngleDeg, endAngleDeg) / 2;
  return cadPointOnCircle(center, radius, midpointAngleDeg);
};

export const cadClosestPointOnArc = (
  point: CadWorldPoint,
  center: CadWorldPoint,
  radius: number,
  startAngleDeg: number,
  endAngleDeg: number,
): CadWorldPoint => {
  const projectedAngleDeg = cadAngleDegFromCenter(center, point);
  if (cadIsAngleOnArcSweep(projectedAngleDeg, startAngleDeg, endAngleDeg)) {
    return cadPointOnCircle(center, radius, projectedAngleDeg);
  }
  const startPoint = cadPointOnCircle(center, radius, startAngleDeg);
  const endPoint = cadPointOnCircle(center, radius, endAngleDeg);
  return cadDistance(point, startPoint) <= cadDistance(point, endPoint) ? startPoint : endPoint;
};

export const cadProjectPointOntoCircle = (
  point: CadWorldPoint,
  center: CadWorldPoint,
  fallbackRadius: number,
): CadWorldPoint => {
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  const length = Math.hypot(dx, dy);
  const radius = length > 1e-12 ? length : Math.max(fallbackRadius, 1e-6);
  if (length <= 1e-12) {
    return {
      x: center.x + radius,
      y: center.y,
    };
  }
  return {
    x: center.x + (dx / length) * radius,
    y: center.y + (dy / length) * radius,
  };
};

const cadChooseArcSweepAngles = (
  firstAngleDeg: number,
  throughAngleDeg: number,
  secondAngleDeg: number,
): { startAngleDeg: number; endAngleDeg: number; deltaDeg: number } => {
  const forwardDelta = cadCounterClockwiseDeltaDeg(firstAngleDeg, secondAngleDeg);
  const throughDelta = cadCounterClockwiseDeltaDeg(firstAngleDeg, throughAngleDeg);
  if (throughDelta <= forwardDelta + 1e-9) {
    return {
      startAngleDeg: cadNormalizeAngleDeg(firstAngleDeg),
      endAngleDeg: cadNormalizeAngleDeg(secondAngleDeg),
      deltaDeg: forwardDelta,
    };
  }
  const reverseDelta = cadCounterClockwiseDeltaDeg(secondAngleDeg, firstAngleDeg);
  return {
    startAngleDeg: cadNormalizeAngleDeg(secondAngleDeg),
    endAngleDeg: cadNormalizeAngleDeg(firstAngleDeg),
    deltaDeg: reverseDelta,
  };
};

export const cadBuildArcFromThreePoints = (
  startPoint: CadWorldPoint,
  throughPoint: CadWorldPoint,
  endPoint: CadWorldPoint,
): CadArcDefinition | null => {
  const denominator =
    2 *
    (
      startPoint.x * (throughPoint.y - endPoint.y) +
      throughPoint.x * (endPoint.y - startPoint.y) +
      endPoint.x * (startPoint.y - throughPoint.y)
    );
  if (Math.abs(denominator) <= 1e-12) return null;

  const startSquared = startPoint.x * startPoint.x + startPoint.y * startPoint.y;
  const throughSquared = throughPoint.x * throughPoint.x + throughPoint.y * throughPoint.y;
  const endSquared = endPoint.x * endPoint.x + endPoint.y * endPoint.y;
  const center = {
    x:
      (startSquared * (throughPoint.y - endPoint.y) +
        throughSquared * (endPoint.y - startPoint.y) +
        endSquared * (startPoint.y - throughPoint.y)) /
      denominator,
    y:
      (startSquared * (endPoint.x - throughPoint.x) +
        throughSquared * (startPoint.x - endPoint.x) +
        endSquared * (throughPoint.x - startPoint.x)) /
      denominator,
  };
  const startAngleDeg = cadAngleDegFromCenter(center, startPoint);
  const throughAngleDeg = cadAngleDegFromCenter(center, throughPoint);
  const endAngleDeg = cadAngleDegFromCenter(center, endPoint);
  const sweep = cadChooseArcSweepAngles(startAngleDeg, throughAngleDeg, endAngleDeg);
  return {
    center,
    radius: cadDistance(center, startPoint),
    startAngleDeg: sweep.startAngleDeg,
    endAngleDeg: sweep.endAngleDeg,
    startPoint:
      Math.abs(sweep.startAngleDeg - startAngleDeg) <= 1e-9 ? { ...startPoint } : { ...endPoint },
    endPoint:
      Math.abs(sweep.endAngleDeg - endAngleDeg) <= 1e-9 ? { ...endPoint } : { ...startPoint },
    deltaDeg: sweep.deltaDeg,
  };
};

const cadBuildArcFromCenterAngles = (
  center: CadWorldPoint,
  radius: number,
  startAngleDeg: number,
  endAngleDeg: number,
): CadArcDefinition => {
  const signedSweep = cadSignedSweepDeg(startAngleDeg, endAngleDeg);
  return {
    center,
    radius,
    startAngleDeg,
    endAngleDeg,
    startPoint: {
      x: center.x + Math.cos((startAngleDeg * Math.PI) / 180) * radius,
      y: center.y + Math.sin((startAngleDeg * Math.PI) / 180) * radius,
    },
    endPoint: {
      x: center.x + Math.cos((endAngleDeg * Math.PI) / 180) * radius,
      y: center.y + Math.sin((endAngleDeg * Math.PI) / 180) * radius,
    },
    deltaDeg: Math.abs(signedSweep),
  };
};

const cadBuildArcFromCenterSweep = (
  center: CadWorldPoint,
  radius: number,
  startAngleDeg: number,
  sweepDeg: number,
): CadArcDefinition | null => {
  if (!Number.isFinite(sweepDeg) || Math.abs(sweepDeg) <= 1e-9 || Math.abs(sweepDeg) >= 360 - 1e-9) {
    return null;
  }
  return cadBuildArcFromCenterAngles(center, radius, startAngleDeg, startAngleDeg + sweepDeg);
};

export const cadBuildArcFromStartCenterEnd = (
  startPoint: CadWorldPoint,
  centerPoint: CadWorldPoint,
  endPoint: CadWorldPoint,
  reverseDirection = false,
): CadArcDefinition | null => {
  const radius = cadDistance(centerPoint, startPoint);
  if (!Number.isFinite(radius) || radius <= 1e-12) return null;
  const endRadius = cadDistance(centerPoint, endPoint);
  if (!Number.isFinite(endRadius) || endRadius <= 1e-12) return null;
  const normalizedEndPoint = {
    x: centerPoint.x + ((endPoint.x - centerPoint.x) / endRadius) * radius,
    y: centerPoint.y + ((endPoint.y - centerPoint.y) / endRadius) * radius,
  };
  const startAngleDeg = cadAngleDegFromCenter(centerPoint, startPoint);
  const endAngleDeg = cadAngleDegFromCenter(centerPoint, normalizedEndPoint);
  const ccwDelta = cadCounterClockwiseDeltaDeg(startAngleDeg, endAngleDeg);
  const shortSweep = ccwDelta <= 180 ? ccwDelta : -(360 - ccwDelta);
  const signedSweep = reverseDirection
    ? (shortSweep >= 0 ? shortSweep - 360 : shortSweep + 360)
    : shortSweep;
  return cadBuildArcFromCenterSweep(centerPoint, radius, startAngleDeg, signedSweep);
};

export const cadBuildArcFromStartCenterAngle = (
  startPoint: CadWorldPoint,
  centerPoint: CadWorldPoint,
  deltaDeg: number,
  reverseDirection = false,
): CadArcDefinition | null => {
  if (!Number.isFinite(deltaDeg) || Math.abs(deltaDeg) <= 1e-9 || Math.abs(deltaDeg) >= 360 - 1e-9) {
    return null;
  }
  const radius = cadDistance(centerPoint, startPoint);
  if (!Number.isFinite(radius) || radius <= 1e-12) return null;
  const startAngleDeg = cadAngleDegFromCenter(centerPoint, startPoint);
  const sweep = Math.abs(deltaDeg);
  return cadBuildArcFromCenterSweep(centerPoint, radius, startAngleDeg, reverseDirection ? -sweep : sweep);
};

export const cadBuildArcFromStartCenterChord = (
  startPoint: CadWorldPoint,
  centerPoint: CadWorldPoint,
  chordLength: number,
  reverseDirection = false,
): CadArcDefinition | null => {
  const radius = cadDistance(centerPoint, startPoint);
  const metrics = cadBuildCurveMetricsFromChordLength(radius, chordLength);
  if (!metrics) return null;
  return cadBuildArcFromStartCenterAngle(startPoint, centerPoint, metrics.deltaDeg, reverseDirection);
};

export const cadBuildArcFromStartEndAngle = (
  startPoint: CadWorldPoint,
  endPoint: CadWorldPoint,
  deltaDeg: number,
  reverseDirection = false,
): CadArcDefinition | null => {
  if (!Number.isFinite(deltaDeg) || Math.abs(deltaDeg) <= 1e-9 || Math.abs(deltaDeg) >= 360 - 1e-9) {
    return null;
  }
  const chordLength = cadDistance(startPoint, endPoint);
  if (chordLength <= 1e-12) return null;
  const halfDeltaRad = (Math.abs(deltaDeg) * Math.PI) / 360;
  const sinHalfDelta = Math.sin(halfDeltaRad);
  if (Math.abs(sinHalfDelta) <= 1e-12) return null;
  const radius = chordLength / (2 * sinHalfDelta);
  const halfChord = chordLength / 2;
  const offset = Math.sqrt(Math.max(0, radius * radius - halfChord * halfChord));
  const midpoint = cadMidpoint(startPoint, endPoint);
  const dx = endPoint.x - startPoint.x;
  const dy = endPoint.y - startPoint.y;
  const length = Math.hypot(dx, dy);
  if (length <= 1e-12) return null;
  const leftNormal = { x: -dy / length, y: dx / length };
  const center = reverseDirection
    ? {
        x: midpoint.x - leftNormal.x * offset,
        y: midpoint.y - leftNormal.y * offset,
      }
    : {
        x: midpoint.x + leftNormal.x * offset,
        y: midpoint.y + leftNormal.y * offset,
      };
  const startAngleDeg = cadAngleDegFromCenter(center, startPoint);
  const endAngleDeg = cadAngleDegFromCenter(center, endPoint);
  const ccwDelta = cadCounterClockwiseDeltaDeg(startAngleDeg, endAngleDeg);
  const desiredDelta = Math.abs(deltaDeg);
  const signedSweep =
    Math.abs(ccwDelta - desiredDelta) <= 1e-6 ? ccwDelta : ccwDelta - 360;
  return cadBuildArcFromCenterSweep(center, radius, startAngleDeg, signedSweep);
};

export const cadBuildArcFromStartEndRadius = (
  startPoint: CadWorldPoint,
  endPoint: CadWorldPoint,
  radius: number,
  reverseDirection = false,
): CadArcDefinition | null => {
  if (!Number.isFinite(radius) || radius <= 1e-12) return null;
  const chordLength = cadDistance(startPoint, endPoint);
  if (chordLength <= 1e-12 || chordLength > 2 * radius + 1e-9) return null;
  const midpoint = cadMidpoint(startPoint, endPoint);
  const halfChord = chordLength / 2;
  const offset = Math.sqrt(Math.max(0, radius * radius - halfChord * halfChord));
  const dx = endPoint.x - startPoint.x;
  const dy = endPoint.y - startPoint.y;
  const length = Math.hypot(dx, dy);
  if (length <= 1e-12) return null;
  const leftNormal = { x: -dy / length, y: dx / length };
  const center = reverseDirection
    ? {
        x: midpoint.x - leftNormal.x * offset,
        y: midpoint.y - leftNormal.y * offset,
      }
    : {
        x: midpoint.x + leftNormal.x * offset,
        y: midpoint.y + leftNormal.y * offset,
      };
  const startAngleDeg = cadAngleDegFromCenter(center, startPoint);
  const endAngleDeg = cadAngleDegFromCenter(center, endPoint);
  const ccwDelta = cadCounterClockwiseDeltaDeg(startAngleDeg, endAngleDeg);
  const signedSweep = ccwDelta <= 180 ? ccwDelta : ccwDelta - 360;
  return cadBuildArcFromCenterSweep(center, radius, startAngleDeg, signedSweep);
};

export const cadBuildArcFromStartEndDirection = (
  startPoint: CadWorldPoint,
  endPoint: CadWorldPoint,
  directionAzimuthDeg: number,
  reverseDirection = false,
): CadArcDefinition | null => {
  if (!Number.isFinite(directionAzimuthDeg)) return null;
  const directionRadians = (directionAzimuthDeg * Math.PI) / 180;
  const tangent = {
    x: Math.sin(directionRadians),
    y: Math.cos(directionRadians),
  };
  const normal = reverseDirection
    ? { x: tangent.y, y: -tangent.x }
    : { x: -tangent.y, y: tangent.x };
  const chord = {
    x: endPoint.x - startPoint.x,
    y: endPoint.y - startPoint.y,
  };
  const denominator = 2 * (chord.x * normal.x + chord.y * normal.y);
  if (Math.abs(denominator) <= 1e-12) return null;
  const t = (chord.x * chord.x + chord.y * chord.y) / denominator;
  const center = {
    x: startPoint.x + normal.x * t,
    y: startPoint.y + normal.y * t,
  };
  const startAngleDeg = cadAngleDegFromCenter(center, startPoint);
  const endAngleDeg = cadAngleDegFromCenter(center, endPoint);
  const ccwDelta = cadCounterClockwiseDeltaDeg(startAngleDeg, endAngleDeg);
  const ccwTangentAzimuth = cadNormalizeAngleDeg(360 - startAngleDeg);
  const tangentMatches = (candidateAzimuthDeg: number): boolean => {
    const difference = cadNormalizeAngleDeg(candidateAzimuthDeg - directionAzimuthDeg);
    return Math.min(difference, 360 - difference) <= 1e-6;
  };
  const signedSweep = tangentMatches(ccwTangentAzimuth) ? ccwDelta : ccwDelta - 360;
  return cadBuildArcFromCenterSweep(center, cadDistance(center, startPoint), startAngleDeg, signedSweep);
};

export const cadBuildArcFromStartTangentRadiusDelta = (
  startPoint: CadWorldPoint,
  tangentAzimuthDeg: number,
  radius: number,
  deltaDeg: number,
  side: 'left' | 'right',
): CadArcDefinition | null => {
  if (
    !Number.isFinite(tangentAzimuthDeg) ||
    !Number.isFinite(radius) ||
    !Number.isFinite(deltaDeg) ||
    radius <= 1e-12 ||
    Math.abs(deltaDeg) <= 1e-9 ||
    Math.abs(deltaDeg) >= 360 - 1e-9
  ) {
    return null;
  }
  const tangentRadians = (tangentAzimuthDeg * Math.PI) / 180;
  const tangent = {
    x: Math.sin(tangentRadians),
    y: Math.cos(tangentRadians),
  };
  const leftNormal = {
    x: -tangent.y,
    y: tangent.x,
  };
  const center =
    side === 'left'
      ? {
          x: startPoint.x + leftNormal.x * radius,
          y: startPoint.y + leftNormal.y * radius,
        }
      : {
          x: startPoint.x - leftNormal.x * radius,
          y: startPoint.y - leftNormal.y * radius,
        };
  const startAngleDeg = cadAngleDegFromCenter(center, startPoint);
  return cadBuildArcFromCenterSweep(
    center,
    radius,
    startAngleDeg,
    side === 'left' ? Math.abs(deltaDeg) : -Math.abs(deltaDeg),
  );
};

export const cadArcEndPoint = (arc: Pick<CadArcEntity, 'centerX' | 'centerY' | 'radius' | 'endAngleDeg'>): CadWorldPoint => ({
  x: arc.centerX + Math.cos((arc.endAngleDeg * Math.PI) / 180) * arc.radius,
  y: arc.centerY + Math.sin((arc.endAngleDeg * Math.PI) / 180) * arc.radius,
});

export const cadArcEndTangentAzimuthDeg = (
  arc: Pick<CadArcEntity, 'startAngleDeg' | 'endAngleDeg'>,
): number =>
  cadSignedSweepDeg(arc.startAngleDeg, arc.endAngleDeg) >= 0
    ? cadNormalizeAngleDeg(360 - arc.endAngleDeg)
    : cadNormalizeAngleDeg(180 - arc.endAngleDeg);

export const cadBuildContinuedArc = (
  sourceArc: Pick<CadArcEntity, 'centerX' | 'centerY' | 'radius' | 'startAngleDeg' | 'endAngleDeg'>,
  endPoint: CadWorldPoint,
  reverseDirection = false,
): CadArcDefinition | null =>
  cadBuildArcFromStartEndDirection(
    cadArcEndPoint(sourceArc),
    endPoint,
    cadArcEndTangentAzimuthDeg(sourceArc),
    reverseDirection,
  );

export const cadBuildTangentCurve = (
  piPoint: CadWorldPoint,
  backTangentPoint: CadWorldPoint,
  aheadTangentPoint: CadWorldPoint,
  radius: number,
): CadArcDefinition | null => {
  if (!Number.isFinite(radius) || radius <= 1e-12) return null;
  const backVector = {
    x: backTangentPoint.x - piPoint.x,
    y: backTangentPoint.y - piPoint.y,
  };
  const aheadVector = {
    x: aheadTangentPoint.x - piPoint.x,
    y: aheadTangentPoint.y - piPoint.y,
  };
  const backLength = Math.hypot(backVector.x, backVector.y);
  const aheadLength = Math.hypot(aheadVector.x, aheadVector.y);
  if (backLength <= 1e-12 || aheadLength <= 1e-12) return null;

  const incomingDirection = {
    x: -backVector.x / backLength,
    y: -backVector.y / backLength,
  };
  const outgoingDirection = {
    x: aheadVector.x / aheadLength,
    y: aheadVector.y / aheadLength,
  };
  const dot = Math.max(
    -1,
    Math.min(1, incomingDirection.x * outgoingDirection.x + incomingDirection.y * outgoingDirection.y),
  );
  const deltaDeg = (Math.acos(dot) * 180) / Math.PI;
  const metrics = cadCreateCurveMetrics(radius, deltaDeg);
  if (!metrics) return null;
  if (metrics.tangentLength > backLength + 1e-9 || metrics.tangentLength > aheadLength + 1e-9) return null;

  const startPoint = {
    x: piPoint.x + (backVector.x / backLength) * metrics.tangentLength,
    y: piPoint.y + (backVector.y / backLength) * metrics.tangentLength,
  };
  const endPoint = {
    x: piPoint.x + (aheadVector.x / aheadLength) * metrics.tangentLength,
    y: piPoint.y + (aheadVector.y / aheadLength) * metrics.tangentLength,
  };
  const turnCross = incomingDirection.x * outgoingDirection.y - incomingDirection.y * outgoingDirection.x;
  const leftNormal = { x: -incomingDirection.y, y: incomingDirection.x };
  const rightNormal = { x: incomingDirection.y, y: -incomingDirection.x };
  const normal = turnCross >= 0 ? leftNormal : rightNormal;
  const center = {
    x: startPoint.x + normal.x * radius,
    y: startPoint.y + normal.y * radius,
  };
  const startAngleDeg = cadAngleDegFromCenter(center, startPoint);
  const endAngleDeg = cadAngleDegFromCenter(center, endPoint);
  const ccwDelta = cadCounterClockwiseDeltaDeg(startAngleDeg, endAngleDeg);
  const signedSweep = Math.abs(ccwDelta - deltaDeg) <= 1e-6 ? ccwDelta : ccwDelta - 360;
  return cadBuildArcFromCenterSweep(center, radius, startAngleDeg, signedSweep);
};
