import type { StationErrorEllipse } from '../types';

export interface PrecisionParameterIndex {
  x?: number | null;
  y?: number | null;
  h?: number | null;
}

export interface HorizontalCovarianceComponents {
  cEE: number;
  cEN: number;
  cNN: number;
}

export interface RelativeCovarianceComponents extends HorizontalCovarianceComponents {
  cEH?: number;
  cNH?: number;
  cHH?: number;
}

export type PrecisionCovarianceAccessor = (_a?: number | null, _b?: number | null) => number;

const PRECISION_TINY_NEGATIVE_EPSILON = 1e-18;

export const clampTinyNegativePrecision = (value: number, scaleHint = 1): number => {
  if (!Number.isFinite(value) || value >= 0) return value;
  const tolerance = Math.max(PRECISION_TINY_NEGATIVE_EPSILON, Math.abs(scaleHint) * 1e-12);
  return value >= -tolerance ? 0 : value;
};

export const sqrtPrecisionComponent = (value: number, scaleHint = Math.abs(value)): number => {
  const clamped = clampTinyNegativePrecision(value, scaleHint);
  return clamped <= 0 ? 0 : Math.sqrt(clamped);
};

export const buildHorizontalErrorEllipse = (
  varE: number,
  varN: number,
  covEN: number,
): { ellipse: StationErrorEllipse; semiMajor: number; semiMinor: number } => {
  const term1 = (varE + varN) / 2;
  const radicand = ((varE - varN) / 2) ** 2 + covEN * covEN;
  const term2 = Math.sqrt(Math.max(0, clampTinyNegativePrecision(radicand, radicand)));
  const semiMajorVariance = clampTinyNegativePrecision(term1 + term2, Math.max(Math.abs(term1), Math.abs(term2)));
  const semiMinorVariance = clampTinyNegativePrecision(term1 - term2, Math.max(Math.abs(term1), Math.abs(term2)));
  const semiMajor = Math.sqrt(Math.max(0, semiMajorVariance));
  const semiMinor = Math.sqrt(Math.max(0, semiMinorVariance));
  const theta = 0.5 * Math.atan2(2 * covEN, varE - varN);
  return {
    ellipse: {
      semiMajor,
      semiMinor,
      theta: (theta * 180) / Math.PI,
    },
    semiMajor,
    semiMinor,
  };
};

const relativeCovarianceComponent = (
  covariance: PrecisionCovarianceAccessor,
  fromA?: number | null,
  toA?: number | null,
  fromB?: number | null,
  toB?: number | null,
): number =>
  covariance(toA, toB) -
  covariance(toA, fromB) -
  covariance(fromA, toB) +
  covariance(fromA, fromB);

export const buildRelativeCovarianceFromEndpoints = (
  covariance: PrecisionCovarianceAccessor,
  from: PrecisionParameterIndex | undefined,
  to: PrecisionParameterIndex | undefined,
  includeHeight = false,
): RelativeCovarianceComponents => {
  const horizontal = {
    cEE: relativeCovarianceComponent(covariance, from?.x, to?.x, from?.x, to?.x),
    cEN: relativeCovarianceComponent(covariance, from?.x, to?.x, from?.y, to?.y),
    cNN: relativeCovarianceComponent(covariance, from?.y, to?.y, from?.y, to?.y),
  };
  if (!includeHeight) return horizontal;
  return {
    ...horizontal,
    cEH: relativeCovarianceComponent(covariance, from?.x, to?.x, from?.h, to?.h),
    cNH: relativeCovarianceComponent(covariance, from?.y, to?.y, from?.h, to?.h),
    cHH: relativeCovarianceComponent(covariance, from?.h, to?.h, from?.h, to?.h),
  };
};

export const buildDistanceAzimuthPrecision = (
  deltaE: number,
  deltaN: number,
  covariance: HorizontalCovarianceComponents,
): { sigmaDist?: number; sigmaAz?: number } => {
  const distance = Math.hypot(deltaE, deltaN);
  if (!(distance > 0)) return {};
  const invDistanceSq = 1 / (distance * distance);
  const varDist =
    invDistanceSq *
    (deltaE * deltaE * covariance.cEE +
      deltaN * deltaN * covariance.cNN +
      2 * deltaE * deltaN * covariance.cEN);
  const varAz =
    (deltaN * deltaN * covariance.cEE +
      deltaE * deltaE * covariance.cNN -
      2 * deltaE * deltaN * covariance.cEN) *
    invDistanceSq *
    invDistanceSq;
  return {
    sigmaDist: sqrtPrecisionComponent(varDist, Math.abs(varDist)),
    sigmaAz: sqrtPrecisionComponent(varAz, Math.abs(varAz)),
  };
};
