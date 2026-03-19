import { describe, expect, it } from 'vitest';

import { createReductionUsageSummary, summarizeReductionUsage } from '../src/engine/reductionUsageSummary';
import type { Observation } from '../src/types';

describe('reductionUsageSummary', () => {
  it('creates an empty reduction-usage summary shape', () => {
    expect(createReductionUsageSummary()).toEqual({
      bearing: { grid: 0, measured: 0 },
      angle: { grid: 0, measured: 0 },
      direction: { grid: 0, measured: 0 },
      distance: { ground: 0, grid: 0, ellipsoidal: 0 },
      total: 0,
    });
  });

  it('counts reduction usage by observation family and effective distance mode', () => {
    const observations = [
      { id: 1, type: 'bearing', gridObsMode: 'grid' },
      { id: 2, type: 'bearing', gridObsMode: 'measured' },
      { id: 3, type: 'angle', gridObsMode: 'measured' },
      { id: 4, type: 'angle', gridObsMode: 'grid' },
      { id: 5, type: 'direction', gridObsMode: 'measured' },
      { id: 6, type: 'dir', gridObsMode: 'grid' },
      { id: 7, type: 'dist', gridDistanceMode: 'measured' },
      { id: 8, type: 'dist', gridDistanceMode: 'grid' },
      { id: 9, type: 'dist', gridDistanceMode: 'ellipsoidal' },
      { id: 10, type: 'dist', distanceKind: 'grid', gridDistanceMode: 'measured' },
      { id: 11, type: 'gps' },
    ] as Observation[];

    expect(summarizeReductionUsage(observations)).toEqual({
      bearing: { grid: 1, measured: 1 },
      angle: { grid: 1, measured: 1 },
      direction: { grid: 1, measured: 1 },
      distance: { ground: 1, grid: 2, ellipsoidal: 1 },
      total: 10,
    });
  });
});
