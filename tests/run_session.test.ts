import { describe, expect, it } from 'vitest';

import { runAdjustmentSession } from '../src/engine/runSession';
import {
  getScenarioRunServiceStats,
  resetScenarioRunServiceCache,
} from '../src/engine/solveEngine';
import { createRunSessionRequest } from './helpers/runSessionRequest';

describe('runAdjustmentSession', () => {
  it('solves the default mixed network through the shared run-session path', () => {
    const outcome = runAdjustmentSession(createRunSessionRequest());

    expect(outcome.result.success).toBe(true);
    expect(outcome.result.converged).toBe(true);
    expect(outcome.result.observations.length).toBeGreaterThan(0);
    expect(outcome.effectiveExcludedIds).toEqual([]);
    expect(outcome.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it('clears stale exclusions, overrides, and approved cluster merges when the input changed', () => {
    const outcome = runAdjustmentSession(
      createRunSessionRequest({
        lastRunInput: 'OLDER INPUT',
        parseSettings: {
          ...createRunSessionRequest().parseSettings,
          clusterDetectionEnabled: true,
        },
        excludedIds: [1, 2],
        overrides: {
          3: { stdDev: 0.25 },
        },
        approvedClusterMerges: [{ aliasId: 'P2', canonicalId: 'P1' }],
      }),
    );

    expect(outcome.inputChangedSinceLastRun).toBe(true);
    expect(outcome.droppedExclusions).toBe(2);
    expect(outcome.droppedOverrides).toBe(1);
    expect(outcome.droppedClusterMerges).toBe(1);
    expect(outcome.effectiveExcludedIds).toEqual([]);
    expect(outcome.effectiveClusterApprovedMerges).toEqual([]);
  });

  it('reuses the parsed scenario for unchanged-input reruns', () => {
    resetScenarioRunServiceCache();
    const request = createRunSessionRequest();

    runAdjustmentSession(request);
    const afterFirstRun = getScenarioRunServiceStats();
    runAdjustmentSession(request);
    const afterSecondRun = getScenarioRunServiceStats();

    expect(afterFirstRun.parseCacheMisses).toBe(1);
    expect(afterSecondRun.parseCacheMisses).toBe(1);
    expect(afterSecondRun.parseCacheHits).toBeGreaterThan(afterFirstRun.parseCacheHits);
  });
});
