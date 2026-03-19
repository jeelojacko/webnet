import type { Observation, ReductionUsageSummary } from '../types';

export const createReductionUsageSummary = (): ReductionUsageSummary => ({
  bearing: { grid: 0, measured: 0 },
  angle: { grid: 0, measured: 0 },
  direction: { grid: 0, measured: 0 },
  distance: { ground: 0, grid: 0, ellipsoidal: 0 },
  total: 0,
});

export const summarizeReductionUsage = (observations: Observation[]): ReductionUsageSummary => {
  const summary = createReductionUsageSummary();
  observations.forEach((obs) => {
    if (obs.type === 'bearing') {
      const mode = obs.gridObsMode === 'measured' ? 'measured' : 'grid';
      summary.bearing[mode] += 1;
      summary.total += 1;
      return;
    }
    if (obs.type === 'angle') {
      const mode = obs.gridObsMode === 'grid' ? 'grid' : 'measured';
      summary.angle[mode] += 1;
      summary.total += 1;
      return;
    }
    if (obs.type === 'direction' || obs.type === 'dir') {
      const mode = obs.gridObsMode === 'grid' ? 'grid' : 'measured';
      summary.direction[mode] += 1;
      summary.total += 1;
      return;
    }
    if (obs.type === 'dist') {
      const kind: 'ground' | 'grid' | 'ellipsoidal' =
        obs.distanceKind ??
        (obs.gridDistanceMode === 'ellipsoidal'
          ? 'ellipsoidal'
          : obs.gridDistanceMode === 'grid'
            ? 'grid'
            : 'ground');
      summary.distance[kind] += 1;
      summary.total += 1;
    }
  });
  return summary;
};
