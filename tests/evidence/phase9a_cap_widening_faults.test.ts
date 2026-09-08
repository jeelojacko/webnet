/**
 * Phase 9A cap-widening evidence shard (EVIDENCE ONLY, no production change).
 *
 * phase 9A evidence: fallback and fault injection
 * Split from tests/evidence/phase9a_cap_widening_evidence.test.ts: every
 * `it` body below is preserved verbatim (only the module-level evidence
 * accumulator was renamed to a shard-local fragment). This shard is
 * independently executable and writes exactly one atomic raw fragment
 * (artifacts/evidence/phase9a/faults.json, gitignored). Report
 * assembly lives in scripts/phase9a/phase9aReport.ts; the committed
 * reports/phase9a/ verdict is checked by tests/phase9a_release_verdict.test.ts.
 */
import { afterAll, describe, expect, it } from 'vitest';

import { runAdjustmentSession } from '../../src/engine/runSession';
import {
  clearPreanalysisSparseAutoRouteTestHooks,
  derivePreanalysisSparseAutoRouteEligibility,
  runWithPreanalysisSparseAutoRoute,
  setPreanalysisSparseAutoRouteEnabled,
  setPreanalysisSparseAutoRouteTestHooks,
} from '../../src/workers/preanalysisSparseAutoRoute';
import {
  loadPhase9aRealBundle,
} from '../../scripts/phase9a/phase9aHarness';
import {
  buildChainStarInput,
  exactPhase9aStationCount,
  makePhase9aPreanalysisRequest,
  phase9aStableKey,
  PHASE9A_ANCHOR_INPUT,
  PHASE9A_CAMP_INPUT,
  writePhase9aFragment,
} from './phase9aEvidenceShared';

const fragment: Record<string, unknown> = {};

describe('phase 9A evidence: fallback and fault injection', () => {
  it('falls back clean on direction-heavy camp, corrupt, sign-flip, and init failure', async () => {
    const bundle = await loadPhase9aRealBundle();
    if (!bundle) {
      fragment.campDirectionHeavyFallback = { skipped: 'WASM artifact absent' };
      fragment.faultRestartCorrupt = { skipped: 'WASM artifact absent' };
      fragment.adversarialSignFlip = { skipped: 'WASM artifact absent' };
      fragment.faultRestartInitFailure = { skipped: 'WASM artifact absent' };
      return;
    }
    setPreanalysisSparseAutoRouteEnabled(true);
    clearPreanalysisSparseAutoRouteTestHooks();
    try {
      const campRequest = makePhase9aPreanalysisRequest(PHASE9A_CAMP_INPUT);
      const campStaticUnknowns = derivePreanalysisSparseAutoRouteEligibility(campRequest).unknownCount;
      const camp = await runWithPreanalysisSparseAutoRoute(campRequest, undefined, {
        runSession: runAdjustmentSession,
        loadBundle: () => Promise.resolve(bundle),
      });
      expect(camp.route).toBe('typescript');
      expect(camp.reasons.join(' ')).toMatch(/parameterCount|cap|fail-closed/);
      expect(phase9aStableKey(camp.outcome)).toBe(phase9aStableKey(runAdjustmentSession(campRequest)));
      fragment.campDirectionHeavyFallback = {
        route: camp.route,
        staticUnknownCount: campStaticUnknowns,
        restartIdentical: true,
      };
      const anchorRequest = makePhase9aPreanalysisRequest(PHASE9A_ANCHOR_INPUT);
      const corrupting = {
        ...bundle,
        sparseSelectedCovarianceSolver: {
          querySelected: (
            input: Parameters<typeof bundle.sparseSelectedCovarianceSolver.querySelected>[0],
          ) => {
            const result = bundle.sparseSelectedCovarianceSolver.querySelected(input);
            const covariance = Float64Array.from(result.covariance);
            if (covariance.length > 0) covariance[0] = covariance[0]! * 4 + 1;
            return { ...result, covariance };
          },
        },
      };
      const corrupt = await runWithPreanalysisSparseAutoRoute(anchorRequest, undefined, {
        runSession: runAdjustmentSession,
        loadBundle: () => Promise.resolve(corrupting),
      });
      expect(corrupt.route).toBe('typescript');
      expect(phase9aStableKey(corrupt.outcome)).toBe(phase9aStableKey(runAdjustmentSession(anchorRequest)));
      fragment.faultRestartCorrupt = { route: corrupt.route, restartIdentical: true };
      const signFlip = {
        ...bundle,
        sparseSelectedCovarianceSolver: {
          querySelected: (
            input: Parameters<typeof bundle.sparseSelectedCovarianceSolver.querySelected>[0],
          ) => {
            const result = bundle.sparseSelectedCovarianceSolver.querySelected(input);
            const covariance = Float64Array.from(result.covariance).map((value) => -value);
            return { ...result, covariance };
          },
        },
      };
      const flipped = await runWithPreanalysisSparseAutoRoute(anchorRequest, undefined, {
        runSession: runAdjustmentSession,
        loadBundle: () => Promise.resolve(signFlip),
      });
      expect(flipped.route).toBe('typescript');
      expect(phase9aStableKey(flipped.outcome)).toBe(phase9aStableKey(runAdjustmentSession(anchorRequest)));
      fragment.adversarialSignFlip = { route: flipped.route, restartIdentical: true };
      const initFail = await runWithPreanalysisSparseAutoRoute(anchorRequest, undefined, {
        runSession: runAdjustmentSession,
        loadBundle: () => Promise.reject(new Error('phase9a injected init failure')),
      });
      expect(initFail.route).toBe('typescript');
      expect(phase9aStableKey(initFail.outcome)).toBe(phase9aStableKey(runAdjustmentSession(anchorRequest)));
      fragment.faultRestartInitFailure = { route: initFail.route, restartIdentical: true };
    } finally {
      setPreanalysisSparseAutoRouteEnabled(false);
    }
  }, 180000);

  it('restarts cleanly after real-WASM covariance faults at 256 and 512', async () => {
    const bundle = await loadPhase9aRealBundle();
    if (!bundle) {
      fragment.faultInjection9a1 = { status: 'NOT_EVALUATED', reason: 'WASM artifact absent' };
      return;
    }
    const rows: Array<Record<string, unknown>> = [];
    for (const [requested, mode] of [[256, 'corrupt'], [512, 'throw']] as const) {
      const stationUnknownCount = (requested - 4) / 2;
      const input = buildChainStarInput(stationUnknownCount);
      const request = makePhase9aPreanalysisRequest(input);
      const faultyBundle = {
        ...bundle,
        sparseSelectedCovarianceSolver: {
          querySelected: (queryInput: Parameters<typeof bundle.sparseSelectedCovarianceSolver.querySelected>[0]) => {
            if (mode === 'throw') throw new Error('phase9a1 injected native covariance failure');
            const result = bundle.sparseSelectedCovarianceSolver.querySelected(queryInput);
            const covariance = Float64Array.from(result.covariance);
            if (covariance.length > 0) covariance[0] = Number.NaN;
            return { ...result, covariance };
          },
        },
      };
      setPreanalysisSparseAutoRouteEnabled(true);
      setPreanalysisSparseAutoRouteTestHooks({
        stationUnknownCapOverride: stationUnknownCount,
        parameterCapOverride: requested,
        systemCapOverride: 64,
      });
      const attempt = await runWithPreanalysisSparseAutoRoute(request, undefined, {
        runSession: runAdjustmentSession,
        loadBundle: () => Promise.resolve(faultyBundle),
      });
      const forced = runAdjustmentSession(request);
      expect(attempt.route).toBe('typescript');
      expect(phase9aStableKey(attempt.outcome)).toBe(phase9aStableKey(forced));
      const actualParameterCount = requested;
      rows.push({ requested, actualParameterCount, mode, route: attempt.route, restartEquality: true });
    }
    clearPreanalysisSparseAutoRouteTestHooks();
    setPreanalysisSparseAutoRouteEnabled(false);
    fragment.faultInjection9a1 = { status: 'EXECUTED', rows };
  }, 900000);

  it('completes the 256 fault corpus and key 512 fail-closed faults', async () => {
    const bundle = await loadPhase9aRealBundle();
    if (!bundle) {
      fragment.faults256 = { status: 'NOT_EVALUATED', reason: 'WASM artifact absent' };
      fragment.faults512 = { status: 'NOT_EVALUATED', reason: 'WASM artifact absent' };
      return;
    }
    const runFault = async (target: 256 | 512, mode: string): Promise<Record<string, unknown>> => {
      const stationUnknownCount = exactPhase9aStationCount(target);
      const request = makePhase9aPreanalysisRequest(buildChainStarInput(stationUnknownCount));
      const faultyBundle = {
        ...bundle,
        sparseCorrectionSolver: {
          solveFromEquations: (input: Parameters<typeof bundle.sparseCorrectionSolver.solveFromEquations>[0]) => {
            if (mode === 'native-correction-throw') throw new Error('phase9a native correction fault');
            const result = bundle.sparseCorrectionSolver.solveFromEquations(input);
            return result;
          },
        },
        sparseSelectedCovarianceSolver: {
          querySelected: (input: Parameters<typeof bundle.sparseSelectedCovarianceSolver.querySelected>[0]) => {
            if (mode === 'native-covariance-throw') throw new Error('phase9a native covariance fault');
            const result = bundle.sparseSelectedCovarianceSolver.querySelected(input);
            if (mode === 'damping') return { ...result, damping: 1 };
            if (!['nan', 'infinity', 'sign-flip'].includes(mode)) return result;
            const covariance = Float64Array.from(result.covariance);
            if (mode === 'nan') covariance[0] = Number.NaN;
            if (mode === 'infinity') covariance[0] = Number.POSITIVE_INFINITY;
            if (mode === 'sign-flip') covariance[0] = -Math.abs(covariance[0] ?? 1);
            return { ...result, covariance };
          },
        },
      };
      setPreanalysisSparseAutoRouteEnabled(true);
      setPreanalysisSparseAutoRouteTestHooks({ stationUnknownCapOverride: stationUnknownCount, parameterCapOverride: target, systemCapOverride: 64, forceC2Failure: mode === 'forced-c2', forcePhysicalFailure: mode === 'forced-physical' });
      const attempt = await runWithPreanalysisSparseAutoRoute(request, undefined, { runSession: runAdjustmentSession, loadBundle: () => mode === 'bundle-init-failure' ? Promise.reject(new Error('phase9a bundle init fault')) : Promise.resolve(faultyBundle) });
      const forced = runAdjustmentSession(request);
      expect(attempt.route).toBe('typescript');
      expect(phase9aStableKey(attempt.outcome)).toBe(phase9aStableKey(forced));
      return { targetParameterCount: target, mode, route: attempt.route, restartEquality: true, fallbackReason: attempt.reasons[0] ?? null };
    };
    try {
    const rows256 = [];
    for (const mode of ['nan', 'infinity', 'sign-flip', 'native-covariance-throw', 'native-correction-throw', 'damping', 'forced-c2', 'forced-physical', 'bundle-init-failure']) rows256.push(await runFault(256, mode));
    const rows512 = [];
    for (const mode of ['nan', 'forced-c2', 'native-covariance-throw', 'damping']) rows512.push(await runFault(512, mode));
    fragment.faults256 = { status: 'EXECUTED', rows: rows256 };
    fragment.faults512 = { status: 'EXECUTED', rows: rows512 };
    } finally {
      clearPreanalysisSparseAutoRouteTestHooks();
      setPreanalysisSparseAutoRouteEnabled(false);
    }
  }, 3600000);
});

afterAll(() => {
  writePhase9aFragment('faults', fragment);
});
