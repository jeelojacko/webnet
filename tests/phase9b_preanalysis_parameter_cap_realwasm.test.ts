/**
 * Phase 9B compact real-WASM production-shaped proof (WASM tier, no campaign).
 *
 * One exact no-override chain-star session through the EXACT production
 * route with the real cpp/build-wasm bundle: 126 free stations
 * (stationUnknownCount 126 <= station cap 128, so no overrides) with
 * actual per-system parameterCount 256 (2 coords per station + 4
 * direction orientations), following the Phase 9A ladder pattern
 * (`buildChainStarInput` + `exactPhase9aStationCount` arithmetic).
 * Counts native correction/covariance delegation and asserts sparse
 * route + full-contract agreement. Skips (not fails) when the WASM
 * artifact is absent so the agent tier stays artifact-free. Single
 * session only — scaling/fault campaigns remain manual-only evidence.
 */
import { describe, expect, it } from 'vitest';

import { buildChainStarInput } from '../src/engine/phase8a5PreanalysisSafetyCorpus';
import { runAdjustmentSession } from '../src/engine/runSession';
import { comparePreanalysisContract } from '../src/engine/preanalysisSparseEvidence';
import {
  clearPreanalysisSparseAutoRouteTestHooks,
  derivePreanalysisSparseAutoRouteEligibility,
  runWithPreanalysisSparseAutoRoute,
  setPreanalysisSparseAutoRouteEnabled,
} from '../src/workers/preanalysisSparseAutoRoute';
import { loadPhase9aRealBundle } from '../scripts/phase9a/phase9aHarness';
import { createRunSessionRequest } from './helpers/runSessionRequest';
import {
  buildSupportedPhase9aPlainGpsInput,
  exactPhase9aStationCount,
} from './evidence/phase9aEvidenceShared';

const TARGET_PARAMETER_COUNT = 256;
const STATION_COUNT = exactPhase9aStationCount(TARGET_PARAMETER_COUNT);

const makePreanalysisRequest = (input: string) => {
  const base = createRunSessionRequest({ input });
  return createRunSessionRequest({
    input,
    parseSettings: {
      ...base.parseSettings,
      runMode: 'preanalysis',
      coordMode: '2D',
      robustMode: 'none',
      tsCorrelationEnabled: false,
      autoAdjustEnabled: false,
    },
  });
};

describe('phase 9B compact real-WASM production shape', () => {
  it('admits the exact 126-station / 256-parameter chain-star sparsely with contract agreement', async () => {
    expect(STATION_COUNT).toBe(126);
    const bundle = await loadPhase9aRealBundle();
    if (!bundle) {
      console.warn('phase9b real-WASM proof skipped: WASM artifact absent');
      return;
    }
    setPreanalysisSparseAutoRouteEnabled(true);
    clearPreanalysisSparseAutoRouteTestHooks();
    try {
      // No overrides: 126 stations fit the station cap 128 and the exact
      // 256 parameters fit the Phase 9B runtime cap 256.
      const request = makePreanalysisRequest(buildChainStarInput(STATION_COUNT));
      const eligibility = derivePreanalysisSparseAutoRouteEligibility(request);
      expect(eligibility.eligible).toBe(true);
      expect(eligibility.unknownCount).toBe(STATION_COUNT);
      const correctionCounts: number[] = [];
      const covarianceCounts: number[] = [];
      const counting = {
        ...bundle,
        sparseCorrectionSolver: {
          solveFromEquations: (
            input: Parameters<typeof bundle.sparseCorrectionSolver.solveFromEquations>[0],
          ) => {
            correctionCounts.push(input.parameterCount);
            return bundle.sparseCorrectionSolver.solveFromEquations(input);
          },
        },
        sparseSelectedCovarianceSolver: {
          querySelected: (
            input: Parameters<typeof bundle.sparseSelectedCovarianceSolver.querySelected>[0],
          ) => {
            covarianceCounts.push(input.parameterCount);
            return bundle.sparseSelectedCovarianceSolver.querySelected(input);
          },
        },
      };
      const attempt = await runWithPreanalysisSparseAutoRoute(request, undefined, {
        runSession: runAdjustmentSession,
        loadBundle: () =>
          Promise.resolve({
            sparseCorrectionSolver: counting.sparseCorrectionSolver,
            sparseRowProductsSolver: bundle.sparseRowProductsSolver,
            sparseSelectedCovarianceSolver: counting.sparseSelectedCovarianceSolver,
          }),
      });
      expect(attempt.route).toBe('sparse');
      expect(correctionCounts.length).toBeGreaterThan(0);
      expect(covarianceCounts.length).toBeGreaterThan(0);
      expect(Math.max(...correctionCounts)).toBe(TARGET_PARAMETER_COUNT);
      expect(Math.max(...covarianceCounts)).toBe(TARGET_PARAMETER_COUNT);
      const direct = runAdjustmentSession(request);
      const comparison = comparePreanalysisContract(direct.result, attempt.outcome.result);
      expect(comparison.pass, comparison.reasons.join('; ')).toBe(true);

      // The adjacent 127-station chain reaches 257 parameters. Static
      // eligibility still passes, but the runtime gate must restart cleanly
      // before any native delegate sees the offending system.
      correctionCounts.length = 0;
      covarianceCounts.length = 0;
      const overCapRequest = makePreanalysisRequest(buildChainStarInput(127));
      const overCapEligibility = derivePreanalysisSparseAutoRouteEligibility(overCapRequest);
      expect(overCapEligibility.eligible).toBe(true);
      expect(overCapEligibility.unknownCount).toBe(127);
      const overCapAttempt = await runWithPreanalysisSparseAutoRoute(overCapRequest, undefined, {
        runSession: runAdjustmentSession,
        loadBundle: () =>
          Promise.resolve({
            sparseCorrectionSolver: counting.sparseCorrectionSolver,
            sparseRowProductsSolver: bundle.sparseRowProductsSolver,
            sparseSelectedCovarianceSolver: counting.sparseSelectedCovarianceSolver,
          }),
      });
      expect(overCapAttempt.route).toBe('typescript');
      expect(overCapAttempt.reasons.join(' ')).toMatch(/parameterCount 257 exceeds cap 256/);
      // Earlier systems may have delegated before the offending system; the
      // 257-parameter system itself must never reach either native delegate.
      expect(correctionCounts.every((count) => count <= 256)).toBe(true);
      expect(covarianceCounts.every((count) => count <= 256)).toBe(true);
      const overCapDirect = runAdjustmentSession(overCapRequest);
      const overCapComparison = comparePreanalysisContract(
        overCapDirect.result,
        overCapAttempt.outcome.result,
      );
      expect(overCapComparison.pass, overCapComparison.reasons.join('; ')).toBe(true);

      // One compact plain-GPS production case remains admissible below 256.
      correctionCounts.length = 0;
      covarianceCounts.length = 0;
      const plainGpsRequest = makePreanalysisRequest(buildSupportedPhase9aPlainGpsInput(4));
      const plainGpsAttempt = await runWithPreanalysisSparseAutoRoute(plainGpsRequest, undefined, {
        runSession: runAdjustmentSession,
        loadBundle: () =>
          Promise.resolve({
            sparseCorrectionSolver: counting.sparseCorrectionSolver,
            sparseRowProductsSolver: bundle.sparseRowProductsSolver,
            sparseSelectedCovarianceSolver: counting.sparseSelectedCovarianceSolver,
          }),
      });
      expect(plainGpsAttempt.route).toBe('sparse');
      expect(Math.max(...correctionCounts)).toBeLessThanOrEqual(256);
      expect(Math.max(...covarianceCounts)).toBeLessThanOrEqual(256);
      const plainGpsDirect = runAdjustmentSession(plainGpsRequest);
      const plainGpsComparison = comparePreanalysisContract(
        plainGpsDirect.result,
        plainGpsAttempt.outcome.result,
      );
      expect(plainGpsComparison.pass, plainGpsComparison.reasons.join('; ')).toBe(true);
    } finally {
      clearPreanalysisSparseAutoRouteTestHooks();
      setPreanalysisSparseAutoRouteEnabled(false);
    }
  }, 180000);
});
