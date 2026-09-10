/**
 * Phase 10I agent-tier contract: worker-only native full-Qxx route.
 *
 * Fast unit-scope checks (no WASM, no campaigns): eligibility preserves
 * 2D/preanalysis, kill switch fails closed, verified provenance feeds
 * Phase 10E statistics reuse with full parity, the route injects
 * covariance-only (no correction/row-products/selected store), and every
 * failure falls back to a clean TypeScript rerun.
 */
import { describe, expect, it, beforeEach } from 'vitest';

import { LSAEngine } from '../src/engine/adjust';
import { runAdjustmentSession } from '../src/engine/runSession';
import type { RunSessionRequest } from '../src/engine/runSessionTypes';
import { buildPhase6LargeBenchmarkCases } from '../src/engine/phase6BenchmarkNetworks';
import { decideStatisticsQxxReuse } from '../src/engine/statisticsQxxReuse';
import type { QxxReuseProbeEvent } from '../src/engine/qxxReuseEvidence';
import {
  deriveNativeFullQxxEligibility,
  isNativeFullQxxRouteEnabled,
  runWithNativeFullQxxAutoRoute,
  setNativeFullQxxRouteEnabled,
  verifyNativeFullQxxSystems,
  NATIVE_FULL_QXX_MAX_PARAMS,
} from '../src/workers/adjustmentNativeFullQxxAutoRoute';
import type { SparseAutoRouteBundle } from '../src/workers/adjustmentSparseAutoRoute';
import type { AdjustmentRuntime } from '../src/engine/adjustmentRuntime';
import { createRunSessionRequest } from './helpers/runSessionRequest';
import {
  countingCorrectionSolver,
  countingCovarianceSolver,
  countingRowProductsSolver,
} from './helpers/sparseTestStubs';

const cases = buildPhase6LargeBenchmarkCases(false);
const fixture3d = cases.find((item) => item.id === 'gps-3d-cov-08');
if (!fixture3d) throw new Error('Missing genuine 3D fixture gps-3d-cov-08.');

const request3d = (patch?: Partial<RunSessionRequest['parseSettings']>): RunSessionRequest => {
  const base = createRunSessionRequest({ input: fixture3d.input });
  return {
    ...base,
    parseSettings: {
      ...base.parseSettings,
      coordMode: '3D',
      suspectImpactMode: 'off',
      ...patch,
    },
  };
};

const throwingCorrection = () => ({
  solveFromEquations: () => {
    throw new Error('correction must not be injected');
  },
});

const throwingRowProducts = () => ({
  queryRowProducts: () => {
    throw new Error('row-products must not be injected');
  },
});

const stubBundle = (): SparseAutoRouteBundle => ({
  sparseCorrectionSolver: throwingCorrection() as unknown as ReturnType<typeof countingCorrectionSolver>,
  sparseRowProductsSolver: throwingRowProducts() as unknown as ReturnType<typeof countingRowProductsSolver>,
  sparseSelectedCovarianceSolver: countingCovarianceSolver(),
});

beforeEach(() => {
  setNativeFullQxxRouteEnabled(true);
});

describe('Phase 10I native full-Qxx eligibility', () => {
  it('admits an ordinary small 3D adjustment job within cap', () => {
    const verdict = deriveNativeFullQxxEligibility(request3d());
    expect(verdict.eligible).toBe(true);
    expect(verdict.reasons).toEqual([]);
    expect(verdict.numParams).toBeGreaterThan(0);
    expect(verdict.numParams).toBeLessThanOrEqual(NATIVE_FULL_QXX_MAX_PARAMS);
  });

  it('preserves 2D and preanalysis on their existing routes', () => {
    expect(
      deriveNativeFullQxxEligibility(request3d({ coordMode: '2D' })).eligible,
    ).toBe(false);
    expect(
      deriveNativeFullQxxEligibility(request3d({ coordMode: '2D' })).reasons.join(' '),
    ).toMatch(/2D preserved/);
    expect(
      deriveNativeFullQxxEligibility(
        request3d({ runMode: 'preanalysis', preanalysisMode: true }),
      ).eligible,
    ).toBe(false);
  });

  it('fails closed on kill switch, robust, and multi-solve shapes', () => {
    setNativeFullQxxRouteEnabled(false);
    expect(isNativeFullQxxRouteEnabled()).toBe(false);
    expect(deriveNativeFullQxxEligibility(request3d()).eligible).toBe(false);
    setNativeFullQxxRouteEnabled(true);
    expect(deriveNativeFullQxxEligibility(request3d({ robustMode: 'huber' })).eligible).toBe(
      false,
    );
    expect(
      deriveNativeFullQxxEligibility(request3d({ suspectImpactMode: 'auto' })).eligible,
    ).toBe(false);
    expect(
      deriveNativeFullQxxEligibility(request3d({ autoAdjustEnabled: true })).eligible,
    ).toBe(false);
  });
});

describe('Phase 10I verified provenance reuse', () => {
  it('reuses native-derived dense Qxx with full parity, legacy without provenance', () => {
    const solver = countingCovarianceSolver();
    const nativeEvents: QxxReuseProbeEvent[] = [];
    const native = new LSAEngine({
      input: fixture3d.input,
      sparseSelectedCovarianceSolver: solver,
      experimentalSelectedCovarianceMode: false,
      allowVerifiedNativeDenseQxxReuse: true,
      qxxReuseProbe: (event) => {
        nativeEvents.push(event);
      },
    }).solve();
    expect(native.success).toBe(true);
    expect(native.converged).toBe(true);
    const stats = nativeEvents.find((event) => event.stage === 'statistics');
    expect(stats?.reused).toBe(true);
    expect(stats?.reason).toBe('reused-final-dense-qxx');

    const oracle = new LSAEngine({
      input: fixture3d.input,
      forceLegacyStatisticsQxx: true,
    }).solve();
    // Native packed assembly uses different FP summation order than the
    // dense TS path (Phase 10G: ~4e-10), so parity is judged at the 1e-6
    // evidence tolerance, not bit-identity.
    expect(native.success).toBe(oracle.success);
    expect(native.converged).toBe(oracle.converged);
    expect(Math.abs(native.seuw - oracle.seuw)).toBeLessThan(1e-6);
    let worst = 0;
    for (const [id, station] of Object.entries(native.stations)) {
      const expected = oracle.stations[id];
      worst = Math.max(
        worst,
        Math.abs(station.x - expected.x),
        Math.abs(station.y - expected.y),
        Math.abs((station.h ?? 0) - (expected.h ?? 0)),
      );
    }
    expect(worst).toBeLessThan(1e-6);

    const legacyEvents: QxxReuseProbeEvent[] = [];
    new LSAEngine({
      input: fixture3d.input,
      sparseSelectedCovarianceSolver: countingCovarianceSolver(),
      experimentalSelectedCovarianceMode: false,
      qxxReuseProbe: (event) => {
        legacyEvents.push(event);
      },
    }).solve();
    const legacyStats = legacyEvents.find((event) => event.stage === 'statistics');
    expect(legacyStats?.reused).toBe(false);
    expect(legacyStats?.reason).toBe('sparse-selected-solver-active');
  });

  it('gates verified provenance in the eligibility unit', () => {
    const base = {
      forceLegacy: false,
      converged: true,
      is2D: false,
      preanalysisMode: false,
      robustMode: 'none' as string | undefined,
      finalQxx: [
        [2, 0.5],
        [0.5, 1],
      ],
      hasSelectedStore: false,
      hasSparseSelectedCovarianceSolver: true,
      sparseRowProductsAvailable: false,
      numParams: 2,
      augmentedRowCount: 0,
      finalCovarianceDamping: 0,
    };
    expect(decideStatisticsQxxReuse(base).reason).toBe('sparse-selected-solver-active');
    expect(
      decideStatisticsQxxReuse({ ...base, allowVerifiedNativeDenseQxxReuse: true }).eligible,
    ).toBe(true);
    expect(
      decideStatisticsQxxReuse({
        ...base,
        allowVerifiedNativeDenseQxxReuse: true,
        forceLegacy: true,
      }).reason,
    ).toBe('force-legacy-oracle');
  });
});

describe('Phase 10I route execution and fallback', () => {
  it('accepts the covariance-only native route without touching correction/row-products', async () => {
    const seen: (AdjustmentRuntime | undefined)[] = [];
    const bundle = stubBundle();
    const attempt = await runWithNativeFullQxxAutoRoute(request3d(), undefined, {
      runSession: (request, onProgress, runtime) => {
        seen.push(runtime);
        return runAdjustmentSession(request, onProgress, runtime);
      },
      loadBundle: async () => bundle,
    });
    expect(attempt.route).toBe('native-full-qxx');
    expect(attempt.outcome.result.success).toBe(true);
    expect(attempt.outcome.result.converged).toBe(true);
    expect(attempt.verification?.accepted).toBe(true);
    expect(attempt.verification?.oracledSystemCount).toBeGreaterThan(0);
    expect(attempt.verification?.verifiedColumns.length).toBeGreaterThan(0);
    expect(bundle.sparseSelectedCovarianceSolver).toHaveProperty('inputs');
    expect(
      (bundle.sparseSelectedCovarianceSolver as unknown as { inputs: unknown[] }).inputs
        .length,
    ).toBeGreaterThan(0);
    const nativeRuntime = seen[0];
    expect(nativeRuntime?.sparseSelectedCovarianceSolver).toBeDefined();
    expect(nativeRuntime?.sparseCorrectionSolver).toBeUndefined();
    expect(nativeRuntime?.sparseRowProductsSolver).toBeUndefined();
    expect(nativeRuntime?.experimentalSelectedCovarianceMode).toBe(false);
    expect(nativeRuntime?.allowVerifiedNativeDenseQxxReuse).toBe(true);
  });

  it('falls back to clean TypeScript on bundle init failure and solver fallback', async () => {
    const bundleFailure = await runWithNativeFullQxxAutoRoute(request3d(), undefined, {
      runSession: (request, onProgress, runtime) =>
        runAdjustmentSession(request, onProgress, runtime),
      loadBundle: async () => {
        throw new Error('no bundle');
      },
    });
    expect(bundleFailure.route).toBe('typescript');
    expect(bundleFailure.outcome.result.success).toBe(true);

    const throwingCovariance = {
      querySelected: () => {
        throw new Error('native covariance unavailable');
      },
    };
    const fallback = await runWithNativeFullQxxAutoRoute(request3d(), undefined, {
      runSession: (request, onProgress, runtime) =>
        runAdjustmentSession(request, onProgress, runtime),
      loadBundle: async () => ({
        sparseCorrectionSolver: countingCorrectionSolver(),
        sparseRowProductsSolver: countingRowProductsSolver(),
        sparseSelectedCovarianceSolver:
          throwingCovariance as unknown as SparseAutoRouteBundle['sparseSelectedCovarianceSolver'],
      }),
    });
    expect(fallback.route).toBe('typescript');
    expect(fallback.outcome.result.success).toBe(true);
    expect(fallback.reasons.join(' ')).toMatch(/fail-closed/);
  });

describe('Phase 10I native verification faults', () => {
  const corruptingBundle = (
    mutate: (_result: {
      covariance: Float64Array;
      damping: number;
      dampingAttempts: number;
    }) => void,
  ): SparseAutoRouteBundle => {
    const delegate = countingCovarianceSolver();
    return {
      sparseCorrectionSolver: countingCorrectionSolver(),
      sparseRowProductsSolver: countingRowProductsSolver(),
      sparseSelectedCovarianceSolver: {
        querySelected: (input) => {
          const result = delegate.querySelected(input);
          const view = {
            covariance: Float64Array.from(result.covariance),
            damping: result.damping,
            dampingAttempts: result.dampingAttempts,
          };
          mutate(view);
          return { ...result, covariance: view.covariance, damping: view.damping };
        },
      },
    };
  };

  const runWith = (bundle: SparseAutoRouteBundle) =>
    runWithNativeFullQxxAutoRoute(request3d(), undefined, {
      runSession: (request, onProgress, runtime) =>
        runAdjustmentSession(request, onProgress, runtime),
      loadBundle: async () => bundle,
    });

  it('rejects a corrupted native value (C1/C2) with a clean TypeScript rerun', async () => {
    const attempt = await runWith(
      corruptingBundle((view) => {
        view.covariance[0] = (view.covariance[0] ?? 0) + 1;
      }),
    );
    expect(attempt.route).toBe('typescript');
    expect(attempt.outcome.result.success).toBe(true);
    expect(attempt.verification).toBeUndefined();
    expect(attempt.reasons.join(' ')).toMatch(/C1|C2/);
  });

  it('rejects damped native metadata', async () => {
    const attempt = await runWith(
      corruptingBundle((view) => {
        view.damping = 1e-9;
      }),
    );
    expect(attempt.route).toBe('typescript');
    expect(attempt.reasons.join(' ')).toMatch(/damping/);
  });

  it('rejects non-finite native entries', async () => {
    const attempt = await runWith(
      corruptingBundle((view) => {
        view.covariance[5] = Number.NaN;
      }),
    );
    expect(attempt.route).toBe('typescript');
    expect(attempt.reasons.join(' ')).toMatch(/non-finite/);
  });

  it('rejects truncated native covariance (dimension mismatch)', async () => {
    const delegate = countingCovarianceSolver();
    const bundle: SparseAutoRouteBundle = {
      sparseCorrectionSolver: countingCorrectionSolver(),
      sparseRowProductsSolver: countingRowProductsSolver(),
      sparseSelectedCovarianceSolver: {
        querySelected: (input) => {
          const result = delegate.querySelected(input);
          return { ...result, covariance: result.covariance.slice(0, result.covariance.length - 1) };
        },
      },
    };
    const attempt = await runWith(bundle);
    expect(attempt.route).toBe('typescript');
    expect(attempt.reasons.join(' ')).toMatch(/dimension mismatch/);
  });

  it('fails closed on empty capture, truncation, and dimension mismatch units', () => {
    expect(verifyNativeFullQxxSystems([], false, 2).reasons.join(' ')).toMatch(
      /no native covariance systems captured/,
    );
    expect(verifyNativeFullQxxSystems([], true, 2).reasons.join(' ')).toMatch(
      /capture truncated/,
    );
    const shortQuery = {
      design: {
        rowOffsets: new Int32Array([0]),
        columns: new Int32Array([]),
        values: new Float64Array([]),
      },
      weights: {
        rows: new Int32Array([]),
        columns: new Int32Array([]),
        values: new Float64Array([]),
      },
      observationEquationCount: 1,
      parameterCount: 2,
      queryRows: new Int32Array([0]),
      queryColumns: new Int32Array([0]),
      result: {
        covariance: new Float64Array([1, 0, 0, 1]),
        normalNnz: 0,
        factorNnz: 0,
        damping: 0,
        dampingAttempts: 0,
      },
    };
    expect(verifyNativeFullQxxSystems([shortQuery], false, 2).reasons.join(' ')).toMatch(
      /all-entry/,
    );
    expect(
      verifyNativeFullQxxSystems([shortQuery], false, 3).reasons.join(' '),
    ).toMatch(/dimension\/provenance mismatch/);
  });
});

  it('routes ineligible 2D work straight to TypeScript with no bundle load', async () => {
    let loaded = false;
    const attempt = await runWithNativeFullQxxAutoRoute(
      request3d({ coordMode: '2D' }),
      undefined,
      {
        runSession: (request, onProgress, runtime) =>
          runAdjustmentSession(request, onProgress, runtime),
        loadBundle: async () => {
          loaded = true;
          return stubBundle();
        },
      },
    );
    expect(attempt.route).toBe('typescript');
    expect(loaded).toBe(false);
    expect(attempt.outcome.result.success).toBe(true);
  });
});
