import { RAD_TO_DEG } from './angles';
import type { Observation } from '../types';

export const MIN_FAMILY_MEAN_COUNT = 2;
export const MIN_TREND_COUNT = 5;
export const MIN_TREND_SPAN_M = 20;
export const MIN_TREND_REL_SPAN = 0.05;
/**
 * Descriptive product coverage guard on the design-collinearity proxy, not a
 * calibrated test threshold: below this spread the intercept and slope shape
 * descriptors are not practically separable.
 */
export const MAX_TREND_COLLINEARITY = 0.95;
export const MIN_REPEAT_SETS = 2;
export const MIN_LEVEL_DRIFT_COUNT = 5;
export const MIN_LEVEL_DRIFT_KM = 0.05;

export const ARCSEC_PER_RAD = RAD_TO_DEG * 3600;

/** Scalar residual in native units; GPS handled separately. Null when absent. */
export const scalarResidual = (obs: Observation): number | null => {
  if (typeof obs.residual === 'number' && Number.isFinite(obs.residual)) return obs.residual;
  return null;
};

export const meanOf = (vals: number[]): number | null =>
  vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null;

export const rmsOf = (vals: number[]): number | null =>
  vals.length > 0
    ? Math.sqrt(vals.reduce((a, b) => a + b * b, 0) / vals.length)
    : null;
