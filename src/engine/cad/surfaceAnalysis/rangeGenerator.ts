/** Phase 18U — equal-width analysis range generator (pure, no I/O). */

import { DEFAULT_ANALYSIS_BAND_COUNT, MAX_ANALYSIS_BANDS } from '../cadAnalysisTypes';

/**
 * Single home for the cap is `cadAnalysisTypes.ts` (drawing model owns the
 * bounds); re-exported here so engine callers keep one import path.
 */
export { MAX_ANALYSIS_BANDS };

export interface GeneratedRange {
  id: string;
  lower: number;
  upper: number;
}

/**
 * Equal-width bands covering [min, max] exactly (last upper === max).
 * Count defaults to the drawing-model default and clamps to 1..MAX.
 * Throws on non-finite min/max or min >= max (fail-closed, never a silent
 * zero-width band).
 */
export const generateEqualRanges = (
  min: number,
  max: number,
  count = DEFAULT_ANALYSIS_BAND_COUNT,
): GeneratedRange[] => {
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    throw new Error('generateEqualRanges: min and max must be finite');
  }
  if (!(min < max)) throw new Error('generateEqualRanges: min must be < max');
  const n = Math.min(MAX_ANALYSIS_BANDS, Math.max(1, Math.floor(count)));
  const width = (max - min) / n;
  const bands: GeneratedRange[] = [];
  for (let i = 0; i < n; i += 1) {
    bands.push({
      id: `band-${i + 1}`,
      lower: i === 0 ? min : min + i * width,
      upper: i === n - 1 ? max : min + (i + 1) * width,
    });
  }
  return bands;
};
