import { ContourLevelLimitError } from './contourTypes';
import type { ComputedLevel, ContourLevelSpec } from './contourTypes';

/**
 * Resolve contour elevations spanning [minZ, maxZ] from integer indices:
 * level(k) = base + k * interval (direct evaluation, never an accumulation loop,
 * so large |k| cannot drift). Major when k is a multiple of majorEvery
 * (symmetric for negative k). Intervals are in drawing units.
 */
export const computeContourLevels = (
  minZ: number,
  maxZ: number,
  spec: ContourLevelSpec,
  maxLevels = 2000,
): ComputedLevel[] => {
  const { minorInterval, majorEvery, baseElevation } = spec;
  if (!Number.isFinite(minorInterval) || minorInterval <= 0) {
    throw new Error('SURFACE_CONTOUR_INVALID_INTERVAL');
  }
  if (!Number.isInteger(majorEvery) || majorEvery < 1) {
    throw new Error('SURFACE_CONTOUR_INVALID_MAJOR_EVERY');
  }
  if (!Number.isFinite(minZ) || !Number.isFinite(maxZ) || !Number.isFinite(baseElevation)) {
    throw new Error('SURFACE_CONTOUR_INVALID_RANGE');
  }
  if (maxZ < minZ) return [];
  // Epsilon keeps exact-boundary levels (fp division may land a hair short).
  const kMin = Math.ceil((minZ - baseElevation) / minorInterval - 1e-9);
  const kMax = Math.floor((maxZ - baseElevation) / minorInterval + 1e-9);
  if (kMax < kMin) return [];
  const count = kMax - kMin + 1;
  if (count > maxLevels) throw new ContourLevelLimitError(count, maxLevels);
  const levels: ComputedLevel[] = [];
  for (let k = kMin; k <= kMax; k += 1) {
    const mod = ((k % majorEvery) + majorEvery) % majorEvery;
    levels.push({
      elevation: baseElevation + k * minorInterval,
      levelIndex: k,
      kind: mod === 0 ? 'major' : 'minor',
    });
  }
  return levels;
};
