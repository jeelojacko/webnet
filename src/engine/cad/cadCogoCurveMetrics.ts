import {
  cadBuildCurveMetricsFromArcLength,
  cadBuildCurveMetricsFromChordLength,
  cadBuildCurveMetricsFromRadiusDelta,
  cadBuildCurveMetricsFromTangentLength,
  type CadCurveMetrics,
} from './cadGeometry';

export interface CadCurveMetricsSummary extends CadCurveMetrics {
  externalDistance: number;
  middleOrdinate: number;
}

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
