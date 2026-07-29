import {
  cadNormalizeAngleDeg,
  cadPointOnCircle,
  cadSignedSweepDeg,
  type CadArcDefinition,
  type CadCurveMetrics,
  type CadWorldPoint,
} from './cadGeometry';

export const cadCounterClockwiseDeltaDeg = (
  startAngleDeg: number,
  endAngleDeg: number,
): number => cadNormalizeAngleDeg(endAngleDeg - startAngleDeg);

export const cadCreateCurveMetrics = (
  radius: number,
  deltaDeg: number,
): CadCurveMetrics | null => {
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

export const cadBuildArcFromCenterAngles = (
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
    startPoint: cadPointOnCircle(center, radius, startAngleDeg),
    endPoint: cadPointOnCircle(center, radius, endAngleDeg),
    deltaDeg: Math.abs(signedSweep),
  };
};

export const cadBuildArcFromCenterSweep = (
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
