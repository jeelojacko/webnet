import type { CadArcEntity } from './cadTypes';
import {
  cadAngleDegFromCenter,
  cadDistance,
  cadNormalizeAngleDeg,
  cadPointOnCircle,
  cadSignedSweepDeg,
  type CadArcDefinition,
  type CadWorldPoint,
} from './cadGeometry';
import { cadCounterClockwiseDeltaDeg } from './cadGeometryCurveCore';

export const cadArcStartPoint = (
  arc: Pick<CadArcEntity, 'centerX' | 'centerY' | 'radius' | 'startAngleDeg'>,
): CadWorldPoint => ({
  x: arc.centerX + Math.cos((arc.startAngleDeg * Math.PI) / 180) * arc.radius,
  y: arc.centerY + Math.sin((arc.startAngleDeg * Math.PI) / 180) * arc.radius,
});

export const cadArcEndPoint = (
  arc: Pick<CadArcEntity, 'centerX' | 'centerY' | 'radius' | 'endAngleDeg'>,
): CadWorldPoint => ({
  x: arc.centerX + Math.cos((arc.endAngleDeg * Math.PI) / 180) * arc.radius,
  y: arc.centerY + Math.sin((arc.endAngleDeg * Math.PI) / 180) * arc.radius,
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

export const cadArcEndTangentAzimuthDeg = (
  arc: Pick<CadArcEntity, 'startAngleDeg' | 'endAngleDeg'>,
): number =>
  cadSignedSweepDeg(arc.startAngleDeg, arc.endAngleDeg) >= 0
    ? cadNormalizeAngleDeg(360 - arc.endAngleDeg)
    : cadNormalizeAngleDeg(180 - arc.endAngleDeg);
