import type { CadSurfaceProfileResult } from './profileExtraction';

/**
 * Phase 18J profile stats (engine only, pure derivation over a result).
 * Lengths are raw-chainage lengths; elevations are interpolated samples.
 */

export interface ProfileStats {
  coveredLength: number;
  gapLength: number;
  minElevation: number | null;
  maxElevation: number | null;
  startElevation: number | null;
  endElevation: number | null;
  segmentCount: number;
  sampleCount: number;
}

export const profileStats = (result: CadSurfaceProfileResult): ProfileStats => {
  let sampleCount = 0;
  let startElevation: number | null = null;
  let endElevation: number | null = null;
  for (const segment of result.segments) {
    sampleCount += segment.samples.length;
    const first = segment.samples[0];
    const last = segment.samples[segment.samples.length - 1];
    if (first && startElevation == null) startElevation = first.elevation;
    if (last) endElevation = last.elevation;
  }
  return {
    coveredLength: result.coveredLength,
    gapLength: result.gapLength,
    minElevation: result.minElevation,
    maxElevation: result.maxElevation,
    startElevation,
    endElevation,
    segmentCount: result.segments.length,
    sampleCount,
  };
};
