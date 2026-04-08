import { describe, expect, it } from 'vitest';

import {
  collectSuspectImpactCandidates,
  resolveSuspectImpactSkipReason,
  runAdjustmentSession,
} from '../src/engine/runSession';
import {
  getScenarioRunServiceStats,
  resetScenarioRunServiceCache,
} from '../src/engine/solveEngine';
import { createRunSessionRequest, createTraverseRunSessionRequest } from './helpers/runSessionRequest';

describe('runAdjustmentSession', () => {
  it('solves the default mixed network through the shared run-session path', () => {
    const outcome = runAdjustmentSession(createRunSessionRequest());

    expect(outcome.result.success).toBe(true);
    expect(outcome.result.converged).toBe(true);
    expect(outcome.result.observations.length).toBeGreaterThan(0);
    expect(outcome.effectiveExcludedIds).toEqual([]);
    expect(outcome.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(outcome.profile.totalElapsedMs).toBeGreaterThanOrEqual(0);
    expect(outcome.profile.solveInvocationCount).toBeGreaterThanOrEqual(1);
    expect(outcome.profile.stages.length).toBeGreaterThan(0);
    expect(outcome.result.solveTimingProfile).toBeDefined();
    expect(outcome.result.solveTimingProfile?.equationAssemblyMs).toBeGreaterThanOrEqual(0);
    expect(outcome.result.solveTimingProfile?.matrixFactorizationMs).toBeGreaterThanOrEqual(0);
    expect(outcome.result.solveTimingProfile?.precisionAndDiagnosticsMs).toBeGreaterThanOrEqual(0);
    expect(outcome.result.logs.some((line) => line.startsWith('Solve timing (ms):'))).toBe(true);
  });

  it(
    'keeps the traverse parity startup convergent through the shared run-session path',
    () => {
      const outcome = runAdjustmentSession(createTraverseRunSessionRequest());

      expect(outcome.result.success).toBe(true);
      expect(outcome.result.converged).toBe(true);
      expect(outcome.result.iterations).toBeLessThanOrEqual(4);
      const byGroup = outcome.result.statisticalSummary?.byGroup ?? [];
      expect(byGroup.find((row) => row.label === 'Directions')?.sumSquares ?? Number.NaN).toBeCloseTo(
        248.927,
        0,
      );
      expect(byGroup.find((row) => row.label === 'Distances')?.sumSquares ?? Number.NaN).toBeCloseTo(
        96.93,
        0,
      );
      expect(byGroup.find((row) => row.label === 'Zenith')?.sumSquares ?? Number.NaN).toBeCloseTo(
        807.697,
        0,
      );
      expect(outcome.result.parseState?.verticalDeflectionNorthSec ?? Number.NaN).toBeCloseTo(
        -2.91,
        6,
      );
      expect(outcome.result.parseState?.verticalDeflectionEastSec ?? Number.NaN).toBeCloseTo(
        -1.46,
        6,
      );
    },
    120000,
  );

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
    expect(afterFirstRun.planningCacheMisses).toBeGreaterThan(0);
    expect(afterSecondRun.parseCacheMisses).toBe(1);
    expect(afterSecondRun.parseCacheHits).toBeGreaterThan(afterFirstRun.parseCacheHits);
    expect(afterSecondRun.planningCacheMisses).toBe(afterFirstRun.planningCacheMisses);
    expect(afterSecondRun.planningCacheHits).toBeGreaterThan(afterFirstRun.planningCacheHits);
  });

  it('ranks suspect-impact candidates by local-failure severity before plain residual size', () => {
    const candidates = collectSuspectImpactCandidates({
      observations: [
        {
          id: 1,
          type: 'dist',
          from: 'A',
          to: 'B',
          sigma: 1,
          stdRes: 2.1,
          localTest: { pass: true, threshold: 3.29 },
        },
        {
          id: 2,
          type: 'dist',
          from: 'A',
          to: 'C',
          sigma: 1,
          stdRes: 2.05,
          localTest: { pass: false, threshold: 3.29 },
        },
        {
          id: 3,
          type: 'dist',
          from: 'A',
          to: 'D',
          sigma: 1,
          stdRes: 5.2,
          localTest: { pass: true, threshold: 3.29 },
        },
      ],
    } as never);

    expect(candidates.map((obs) => obs.id)).toEqual([2, 3, 1]);
  });

  it('auto-skips suspect-impact reruns only after a heavy main solve', () => {
    expect(
      resolveSuspectImpactSkipReason({
        mode: 'auto',
        mainSolveElapsedMs: 6000,
        candidateCount: 4,
      }),
    ).toContain('auto-skip triggered');
    expect(
      resolveSuspectImpactSkipReason({
        mode: 'auto',
        mainSolveElapsedMs: 2000,
        candidateCount: 4,
      }),
    ).toBeNull();
    expect(
      resolveSuspectImpactSkipReason({
        mode: 'off',
        mainSolveElapsedMs: 6000,
        candidateCount: 4,
      }),
    ).toContain('disabled');
    expect(
      resolveSuspectImpactSkipReason({
        mode: 'on',
        mainSolveElapsedMs: 6000,
        candidateCount: 4,
      }),
    ).toBeNull();
  });
});
