import {
  cadAngleDegFromCenter,
  type CadArcDefinition,
  type CadWorldPoint,
} from './cadGeometry';
import {
  cadBuildArcFromCenterSweep,
  cadCounterClockwiseDeltaDeg,
  cadCreateCurveMetrics,
} from './cadGeometryCurveCore';

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
