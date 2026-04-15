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
import {
  createColdstreamRunSessionRequest,
  createRunSessionRequest,
  createTraverseRunSessionRequest,
} from './helpers/runSessionRequest';

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

  it(
    'matches the Coldstream imported-file parity case through the shared run-session path',
    () => {
      const outcome = runAdjustmentSession(createColdstreamRunSessionRequest());

      expect(outcome.result.success).toBe(true);
      expect(outcome.result.converged).toBe(true);
      expect(outcome.result.iterations).toBe(5);
      expect(outcome.result.seuw).toBeCloseTo(0.5334038439, 3);

      const byGroup = outcome.result.statisticalSummary?.byGroup ?? [];
      expect(byGroup.find((row) => row.label === 'Directions')?.count).toBe(411);
      expect(byGroup.find((row) => row.label === 'Distances')?.count).toBe(409);
      expect(byGroup.find((row) => row.label === 'Az/Bearings')?.count).toBe(1);
      expect(byGroup.find((row) => row.label === 'Zenith')?.count).toBe(227);

      expect(outcome.result.statisticalSummary?.totalCount).toBe(1048);
      expect(Object.keys(outcome.result.stations)).toHaveLength(40);

      expect(outcome.result.stations['101']?.y).toBeCloseTo(5566424.5729, 4);
      expect(outcome.result.stations['101']?.x).toBeCloseTo(338887.5802, 4);
      expect(outcome.result.stations['101']?.h).toBeCloseTo(397.0340, 4);
      expect(outcome.result.stations['102']?.y).toBeCloseTo(5566523.2517, 4);
      expect(outcome.result.stations['102']?.x).toBeCloseTo(338768.3745, 4);
      expect(outcome.result.stations['102']?.h).toBeCloseTo(395.9435, 4);
      expect(
        Math.hypot(
          (outcome.result.stations['108']?.y ?? 0) - 5566495.8965,
          (outcome.result.stations['108']?.x ?? 0) - 338529.8592,
        ),
      ).toBeLessThan(0.03);
      expect(outcome.result.stations['108']?.h ?? Number.NaN).toBeCloseTo(392.7916, 2);
      expect(
        Math.hypot(
          (outcome.result.stations['109']?.y ?? 0) - 5566273.8948,
          (outcome.result.stations['109']?.x ?? 0) - 338590.3073,
        ),
      ).toBeLessThan(0.03);
      expect(outcome.result.stations['109']?.h ?? Number.NaN).toBeCloseTo(392.9076, 2);
      expect(outcome.result.stations['1001']?.y).toBeCloseTo(5566451.9510, 4);
      expect(outcome.result.stations['1001']?.x).toBeCloseTo(338919.0400, 4);
      expect(outcome.result.stations['1001']?.h).toBeCloseTo(404.9865, 4);
      expect(outcome.result.stations['2005']?.y).toBeCloseTo(5566326.1627, 3);
      expect(outcome.result.stations['2005']?.x).toBeCloseTo(338911.9584, 3);
      expect(outcome.result.stations['2005']?.h).toBeCloseTo(395.5840, 4);
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
