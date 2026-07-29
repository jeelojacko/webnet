import {
  cadAngleDegFromCenter,
  cadDistance,
  cadMidpoint,
  cadNormalizeAngleDeg,
  type CadArcDefinition,
  type CadWorldPoint,
} from './cadGeometry';
import { cadArcEndPoint, cadArcEndTangentAzimuthDeg } from './cadGeometryArcPrimitives';
import {
  cadBuildArcFromCenterSweep,
  cadBuildCurveMetricsFromChordLength,
  cadCounterClockwiseDeltaDeg,
} from './cadGeometryCurveCore';
import type { CadArcEntity } from './cadTypes';

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
