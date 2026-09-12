/**
 * Phase 10M evidence: fallback-matrix gap coverage (fast, no WASM).
 *
 * The Phase 10I agent contract (tests/phase10i_native_fullqxx_route.test.ts)
 * covers WASM init failure, solver throw, C1/C2 verification rejection,
 * damped metadata, non-finite native entries, and truncated/malformed output
 * — but never drives a non-converged or non-finite *session result* through
 * the route (route lines 777-786: `!success || !converged` and
 * `isFiniteNativeResult` gates). These two tests close that gap with a
 * stubbed runSession: the native-runtime call returns a doctored outcome,
 * the clean-TS rerun (runtime undefined) runs the real session.
 *
 * Test-only; no production changes.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import { runAdjustmentSession } from '../../src/engine/runSession';
import { buildPhase6LargeBenchmarkCases } from '../../src/engine/phase6BenchmarkNetworks';
import {
  runWithNativeFullQxxAutoRoute,
  setNativeFullQxxRouteEnabled,
} from '../../src/workers/adjustmentNativeFullQxxAutoRoute';
import type { SparseAutoRouteBundle } from '../../src/workers/adjustmentSparseAutoRoute';
import { createRunSessionRequest } from '../helpers/runSessionRequest';
import { countingCovarianceSolver } from '../helpers/sparseTestStubs';

const cases = buildPhase6LargeBenchmarkCases(false);
const fixture3d = cases.find((item) => item.id === 'gps-3d-cov-08');
if (!fixture3d) throw new Error('Missing genuine 3D fixture gps-3d-cov-08.');

const request3d = () => {
  const base = createRunSessionRequest({ input: fixture3d.input });
  return {
    ...base,
    parseSettings: { ...base.parseSettings, coordMode: '3D' as const, suspectImpactMode: 'off' as const },
  };
};

const stubBundle = (): SparseAutoRouteBundle => ({
  sparseCorrectionSolver: {
    solveFromEquations: () => {
      throw new Error('correction must not be injected');
    },
  } as unknown as SparseAutoRouteBundle['sparseCorrectionSolver'],
  sparseRowProductsSolver: {
    queryRowProducts: () => {
      throw new Error('row-products must not be injected');
    },
  } as unknown as SparseAutoRouteBundle['sparseRowProductsSolver'],
  sparseSelectedCovarianceSolver: countingCovarianceSolver(),
});

beforeEach(() => {
  setNativeFullQxxRouteEnabled(true);
});
afterEach(() => {
  setNativeFullQxxRouteEnabled(true);
});

describe('Phase 10M fallback gap: result-shape gates', () => {
  it('falls back to clean TypeScript on a non-converged native result', async () => {
    let reranClean = false;
    const attempt = await runWithNativeFullQxxAutoRoute(request3d(), undefined, {
      runSession: (request, onProgress, runtime) => {
        if (runtime === undefined) {
          reranClean = true;
          return runAdjustmentSession(request, onProgress, runtime);
        }
        const outcome = runAdjustmentSession(request, onProgress, runtime);
        return {
          ...outcome,
          result: { ...outcome.result, success: true, converged: false },
        };
      },
      loadBundle: async () => stubBundle(),
    });
    expect(attempt.route).toBe('typescript');
    expect(reranClean).toBe(true);
    expect(attempt.outcome.result.success).toBe(true);
    expect(attempt.reasons.join(' ')).toMatch(/not converged/);
  });

  it('falls back to clean TypeScript on a non-finite native result', async () => {
    let reranClean = false;
    const attempt = await runWithNativeFullQxxAutoRoute(request3d(), undefined, {
      runSession: (request, onProgress, runtime) => {
        if (runtime === undefined) {
          reranClean = true;
          return runAdjustmentSession(request, onProgress, runtime);
        }
        const outcome = runAdjustmentSession(request, onProgress, runtime);
        const names = Object.keys(outcome.result.stations);
        const first = names[0];
        if (first == null) throw new Error('No stations in doctored outcome.');
        return {
          ...outcome,
          result: {
            ...outcome.result,
            stations: {
              ...outcome.result.stations,
              [first]: { ...outcome.result.stations[first], x: Number.NaN },
            },
          },
        };
      },
      loadBundle: async () => stubBundle(),
    });
    expect(attempt.route).toBe('typescript');
    expect(reranClean).toBe(true);
    expect(attempt.outcome.result.success).toBe(true);
    expect(attempt.reasons.join(' ')).toMatch(/finite/);
  });
});
