import { describe, expect, it } from 'vitest';

import {
  getScenarioRunServiceStats,
  resetScenarioRunServiceCache,
  solveEngine,
} from '../src/engine/solveEngine';

const input = ['.2D', 'C A 0 0 0 ! !', 'C B 100 0 0 ! !', 'C P 50 40 0', 'D A-P 64.0 0.01'].join(
  '\n',
);

describe('scenario run service', () => {
  it('reuses the parsed model for exclusion scenarios with unchanged input/settings', () => {
    resetScenarioRunServiceCache();

    const baseline = solveEngine({
      input,
      maxIterations: 8,
      parseOptions: {
        coordMode: '2D',
        units: 'm',
      },
    });
    const excludedObservationId = baseline.observations[0]?.id;

    expect(excludedObservationId).toBeDefined();
    expect(getScenarioRunServiceStats().parseCacheMisses).toBe(1);
    expect(getScenarioRunServiceStats().parseCacheHits).toBe(0);

    solveEngine({
      input,
      maxIterations: 8,
      excludeIds: new Set([excludedObservationId as number]),
      parseOptions: {
        coordMode: '2D',
        units: 'm',
      },
    });

    const stats = getScenarioRunServiceStats();
    expect(stats.parseCacheMisses).toBe(1);
    expect(stats.parseCacheHits).toBe(1);
  });
});
