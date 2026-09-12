/**
 * Phase 10N agent-tier contract: native 3D correction experiment.
 *
 * Proves the SEPARATE default-OFF correction kill switch over the Phase 10M
 * route: default OFF restores exact 10M behavior, enabling routes native
 * correction with S3 + C1/C2/C3 proof, every proof failure reruns clean
 * TypeScript (never a mixed TS-correction+native-Qxx attempt), and the
 * A/B/C arms hold correction-level + final-result parity. Fast unit scope
 * only (dense-backed stubs, no WASM, no campaigns).
 */
import { describe, expect, it, afterEach, beforeEach } from 'vitest';

import { buildPhase6LargeBenchmarkCases } from '../src/engine/phase6BenchmarkNetworks';
import { runAdjustmentSession } from '../src/engine/runSession';
import type { AdjustmentRuntime } from '../src/engine/adjustmentRuntime';
import type { RunSessionRequest } from '../src/engine/runSessionTypes';
import type {
  SparseCorrectionSolveInput,
  SparseCorrectionSolveResult,
  SparseSelectedCovarianceInput,
  SparseSelectedCovarianceResult,
} from '../src/engine/numericalBackend';
import {
  deriveNativeFullQxxEligibility,
  isNative3dCorrectionRouteEnabled,
  runWithNativeFullQxxAutoRoute,
  setNative3dCorrectionRouteEnabled,
  setNativeFullQxxRouteEnabled,
} from '../src/workers/adjustmentNativeFullQxxAutoRoute';
import type { SparseAutoRouteBundle } from '../src/workers/adjustmentSparseAutoRoute';
import { verifySparseAutoRouteSystems } from '../src/workers/adjustmentSparseAutoRoute';
import { createRunSessionRequest } from './helpers/runSessionRequest';
import { countingCorrectionSolver, countingCovarianceSolver } from './helpers/sparseTestStubs';

const cases = buildPhase6LargeBenchmarkCases(false);
const fixtureIds = ['gps-3d-cov-08', 'gps-3d-32'];
const fixtures = fixtureIds.map((id) => {
  const found = cases.find((item) => item.id === id);
  if (!found) throw new Error(`Missing genuine 3D fixture ${id}.`);
  return found;
});
const fixture3d = fixtures[0]!;

const request3d = (input: string = fixture3d.input, patch?: Partial<RunSessionRequest['parseSettings']>): RunSessionRequest => {
  const base = createRunSessionRequest({ input });
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

/** Full stub bundle: dense-backed correction + covariance (+ unused row-products). */
const fullStubBundle = () => {
  const correction = countingCorrectionSolver();
  const covariance = countingCovarianceSolver();
  const bundle: SparseAutoRouteBundle = {
    sparseCorrectionSolver: correction,
    sparseRowProductsSolver: {
      queryRowProducts: () => {
        throw new Error('row-products must not be injected');
      },
    } as unknown as SparseAutoRouteBundle['sparseRowProductsSolver'],
    sparseSelectedCovarianceSolver: covariance,
  };
  return { bundle, correction, covariance };
};

/** Phase 10M-style bundle: correction must never be injected. */
const covarianceOnlyBundle = () => {
  const covariance = countingCovarianceSolver();
  const bundle: SparseAutoRouteBundle = {
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
    sparseSelectedCovarianceSolver: covariance,
  };
  return { bundle, covariance };
};

const runRoute = (request: RunSessionRequest, bundle: SparseAutoRouteBundle) =>
  runWithNativeFullQxxAutoRoute(request, undefined, {
    runSession: (req, onProgress, runtime) => runAdjustmentSession(req, onProgress, runtime),
    loadBundle: async () => bundle,
  });

const rounded = (value: unknown): unknown => {
  if (typeof value === 'number') return Math.round(value * 1e6) / 1e6;
  if (Array.isArray(value)) return value.map(rounded);
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rounded(v)]));
  return value;
};
const comparable = (outcome: ReturnType<typeof runAdjustmentSession>): unknown => {
  const { logs: _logs, solveTimingProfile: _timing, ...stable } =
    outcome.result as unknown as Record<string, unknown>;
  return rounded(stable);
};
const maxDiff = (a: unknown, b: unknown): number => {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b);
  if (Array.isArray(a) && Array.isArray(b))
    return Math.max(0, ...a.map((v, i) => maxDiff(v, b[i])));
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = Object.keys(a as object);
    return Math.max(0, ...keys.map((key) => maxDiff((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])));
  }
  return 0;
};

beforeEach(() => {
  setNativeFullQxxRouteEnabled(true);
  setNative3dCorrectionRouteEnabled(false);
});

afterEach(() => {
  setNativeFullQxxRouteEnabled(true);
  setNative3dCorrectionRouteEnabled(false);
});

describe('Phase 10N kill-switch matrix', () => {
  it('ships default OFF on fresh import', () => {
    expect(isNative3dCorrectionRouteEnabled()).toBe(false);
  });

  it('routes native correction with S3 + C1/C2/C3 proof when enabled', async () => {
    setNative3dCorrectionRouteEnabled(true);
    const { bundle, correction, covariance } = fullStubBundle();
    const seen: (AdjustmentRuntime | undefined)[] = [];
    const attempt = await runWithNativeFullQxxAutoRoute(request3d(), undefined, {
      runSession: (req, onProgress, runtime) => {
        seen.push(runtime);
        return runAdjustmentSession(req, onProgress, runtime);
      },
      loadBundle: async () => bundle,
    });
    expect(attempt.route).toBe('native-full-qxx');
    expect(attempt.outcome.result.success).toBe(true);
    expect(attempt.outcome.result.converged).toBe(true);
    expect(attempt.reasons).toEqual([]);
    expect(attempt.verification?.accepted).toBe(true);
    expect(attempt.correctionVerification?.accepted).toBe(true);
    expect(attempt.correctionVerification?.reasons ?? []).toEqual([]);
    const iterations = attempt.outcome.result.iterations;
    expect(iterations).toBeGreaterThan(0);
    expect(attempt.nativeCorrectionCalls).toBe(iterations);
    expect(correction.inputs.length).toBe(iterations);
    expect(covariance.inputs.length).toBeGreaterThan(0);
    expect(attempt.correctionVerification?.oracledSystemCount).toBe(iterations);
    expect(attempt.correctionVerification?.maxCorrectionDiff).toBeLessThan(1e-9);
    const nativeRuntime = seen[0];
    expect(nativeRuntime?.sparseCorrectionSolver).toBeDefined();
    expect(nativeRuntime?.sparseSelectedCovarianceSolver).toBeDefined();
    expect(nativeRuntime?.sparseRowProductsSolver).toBeUndefined();
    expect(nativeRuntime?.experimentalSelectedCovarianceMode).toBe(false);
    expect(nativeRuntime?.allowVerifiedNativeDenseQxxReuse).toBe(true);
  });

  it('restores the exact Phase 10M path when disabled', async () => {
    const { bundle, covariance } = covarianceOnlyBundle();
    const seen: (AdjustmentRuntime | undefined)[] = [];
    const attempt = await runWithNativeFullQxxAutoRoute(request3d(), undefined, {
      runSession: (req, onProgress, runtime) => {
        seen.push(runtime);
        return runAdjustmentSession(req, onProgress, runtime);
      },
      loadBundle: async () => bundle,
    });
    expect(attempt.route).toBe('native-full-qxx');
    expect(attempt.verification?.accepted).toBe(true);
    expect(attempt.correctionVerification).toBeUndefined();
    expect(attempt.nativeCorrectionCalls).toBeUndefined();
    expect(covariance.inputs.length).toBeGreaterThan(0);
    expect(seen[0]?.sparseCorrectionSolver).toBeUndefined();
    const clean10m = await runRoute(request3d(), covarianceOnlyBundle().bundle);
    expect(maxDiff(comparable(attempt.outcome), comparable(clean10m.outcome))).toBe(0);
  });

  it('falls back to clean TypeScript when full-Qxx is disabled, regardless of the correction switch', async () => {
    setNativeFullQxxRouteEnabled(false);
    setNative3dCorrectionRouteEnabled(true);
    expect(deriveNativeFullQxxEligibility(request3d()).eligible).toBe(false);
    let loaded = false;
    const attempt = await runWithNativeFullQxxAutoRoute(request3d(), undefined, {
      runSession: (req, onProgress, runtime) => runAdjustmentSession(req, onProgress, runtime),
      loadBundle: async () => {
        loaded = true;
        return fullStubBundle().bundle;
      },
    });
    expect(attempt.route).toBe('typescript');
    expect(loaded).toBe(false);
    expect(attempt.correctionVerification).toBeUndefined();
    const clean = runAdjustmentSession(request3d(), undefined, undefined);
    expect(maxDiff(comparable(attempt.outcome), comparable(clean))).toBe(0);
  });

  it('never routes 2D work through the correction experiment', async () => {
    setNative3dCorrectionRouteEnabled(true);
    let loaded = false;
    const attempt = await runWithNativeFullQxxAutoRoute(request3d(fixture3d.input, { coordMode: '2D' }), undefined, {
      runSession: (req, onProgress, runtime) => runAdjustmentSession(req, onProgress, runtime),
      loadBundle: async () => {
        loaded = true;
        return fullStubBundle().bundle;
      },
    });
    expect(attempt.route).toBe('typescript');
    expect(loaded).toBe(false);
    expect(attempt.outcome.result.success).toBe(true);
  });
});

describe('Phase 10N fallback matrix (clean-TS rerun, no native state)', () => {
  beforeEach(() => {
    setNative3dCorrectionRouteEnabled(true);
  });

  const expectCleanFallback = async (
    bundle: SparseAutoRouteBundle,
    reason: RegExp,
    mutate?: (_outcome: ReturnType<typeof runAdjustmentSession>) => ReturnType<typeof runAdjustmentSession>,
  ) => {
    let reranClean = false;
    const attempt = await runWithNativeFullQxxAutoRoute(request3d(), undefined, {
      runSession: (req, onProgress, runtime) => {
        if (runtime === undefined) {
          reranClean = true;
          return runAdjustmentSession(req, onProgress, runtime);
        }
        const outcome = runAdjustmentSession(req, onProgress, runtime);
        return mutate ? mutate(outcome) : outcome;
      },
      loadBundle: async () => bundle,
    });
    expect(attempt.route).toBe('typescript');
    expect(reranClean).toBe(true);
    expect(attempt.outcome.result.success).toBe(true);
    expect(attempt.correctionVerification).toBeUndefined();
    expect(attempt.verification).toBeUndefined();
    expect(attempt.reasons.join(' ')).toMatch(reason);
  };

  it('covers bundle init failure and native run throw', async () => {
    const initFailure = await runWithNativeFullQxxAutoRoute(request3d(), undefined, {
      runSession: (req, onProgress, runtime) => runAdjustmentSession(req, onProgress, runtime),
      loadBundle: async () => {
        throw new Error('no bundle');
      },
    });
    expect(initFailure.route).toBe('typescript');
    expect(initFailure.outcome.result.success).toBe(true);
    expect(initFailure.reasons.join(' ')).toMatch(/WASM bundle init failed/);

    const runThrow = await runWithNativeFullQxxAutoRoute(request3d(), undefined, {
      runSession: (req, onProgress, runtime) => {
        if (runtime !== undefined) throw new Error('native run threw');
        return runAdjustmentSession(req, onProgress, runtime);
      },
      loadBundle: async () => fullStubBundle().bundle,
    });
    expect(runThrow.route).toBe('typescript');
    expect(runThrow.outcome.result.success).toBe(true);
    expect(runThrow.reasons.join(' ')).toMatch(/native 3D correction run threw/);
  });

  it('covers correction throw, mixed-trajectory fallback, and covariance throw', async () => {
    const throwing = fullStubBundle();
    await expectCleanFallback(
      {
        ...throwing.bundle,
        sparseCorrectionSolver: {
          solveFromEquations: () => {
            throw new Error('native correction unavailable');
          },
        } as unknown as SparseAutoRouteBundle['sparseCorrectionSolver'],
      },
      /fail-closed|mixed trajectory/,
    );

    const delegate = countingCorrectionSolver();
    let calls = 0;
    await expectCleanFallback(
      {
        ...fullStubBundle().bundle,
        sparseCorrectionSolver: {
          solveFromEquations: (input: SparseCorrectionSolveInput) => {
            calls += 1;
            if (calls > 1) throw new Error('late native correction failure');
            return delegate.solveFromEquations(input);
          },
        } as unknown as SparseAutoRouteBundle['sparseCorrectionSolver'],
      },
      /mixed trajectory/,
    );

    const throwingCov = fullStubBundle();
    await expectCleanFallback(
      {
        ...throwingCov.bundle,
        sparseSelectedCovarianceSolver: {
          querySelected: () => {
            throw new Error('native covariance unavailable');
          },
        } as unknown as SparseAutoRouteBundle['sparseSelectedCovarianceSolver'],
      },
      /fail-closed/,
    );
  });

  it('covers S3 mismatch, damping, and non-finite correction', async () => {
    const corrupt = (
      mutate: (_result: SparseCorrectionSolveResult) => SparseCorrectionSolveResult,
      reason: RegExp,
    ) => {
      const stubs = fullStubBundle();
      const delegate = stubs.correction;
      return expectCleanFallback(
        {
          ...stubs.bundle,
          sparseCorrectionSolver: {
            solveFromEquations: (input: SparseCorrectionSolveInput) => mutate(delegate.solveFromEquations(input)),
          } as unknown as SparseAutoRouteBundle['sparseCorrectionSolver'],
        },
        reason,
      );
    };
    await corrupt((result) => {
      const correction = result.correction.map((row) => [...row]);
      correction[0]![0] = (correction[0]?.[0] ?? 0) + 1e-3;
      return { ...result, correction };
    }, /correction agreement/);
    await corrupt((result) => ({ ...result, damping: 1e-9 }), /damping/);
    await corrupt((result) => {
      const correction = result.correction.map((row) => [...row]);
      correction[0]![0] = Number.NaN;
      return { ...result, correction };
    }, /non-finite/);
  });

  it('covers covariance C1/C2 rejection, missing condition, non-convergence, and non-finite final', async () => {
    const stubs = fullStubBundle();
    const delegate = stubs.covariance;
    await expectCleanFallback(
      {
        ...stubs.bundle,
        sparseSelectedCovarianceSolver: {
          querySelected: (input: SparseSelectedCovarianceInput) => {
            const result = delegate.querySelected(input);
            const covariance = Float64Array.from(result.covariance);
            covariance[0] = (covariance[0] ?? 0) + 1;
            return { ...result, covariance } as SparseSelectedCovarianceResult;
          },
        } as unknown as SparseAutoRouteBundle['sparseSelectedCovarianceSolver'],
      },
      /C1|C2/,
    );

    await expectCleanFallback(
      fullStubBundle().bundle,
      /no finite result\.condition/,
      (outcome) => ({ ...outcome, result: { ...outcome.result, condition: undefined } }),
    );
    await expectCleanFallback(
      fullStubBundle().bundle,
      /not converged/,
      (outcome) => ({ ...outcome, result: { ...outcome.result, success: true, converged: false } }),
    );
    await expectCleanFallback(
      fullStubBundle().bundle,
      /finite/,
      (outcome) => {
        const names = Object.keys(outcome.result.stations);
        const first = names[0];
        if (first == null) throw new Error('No stations in doctored outcome.');
        return {
          ...outcome,
          result: {
            ...outcome.result,
            stations: {
              ...outcome.result.stations,
              [first]: { ...outcome.result.stations[first]!, x: Number.NaN },
            },
          },
        };
      },
    );
  });

  it('holds the shared S3 contract fail-closed on truncation, empty capture, and count mismatch', () => {
    expect(verifySparseAutoRouteSystems([], true, 0).accepted).toBe(false);
    expect(verifySparseAutoRouteSystems([], true, 0).reasons.join(' ')).toMatch(/truncated/);
    expect(verifySparseAutoRouteSystems([], false, 0).accepted).toBe(false);
    expect(verifySparseAutoRouteSystems([], false, 0).reasons.join(' ')).toMatch(/no correction systems captured/);
  });
});

describe('Phase 10N A/B/C parity (pure-TS vs 10M vs experimental)', () => {
  beforeEach(() => {
    setNative3dCorrectionRouteEnabled(true);
  });

  it.each(fixtures.map((item) => [item.id, item.input] as [string, string]))(
    'holds correction-level + final-result parity on %s',
    async (_id, input) => {
      const request = request3d(input);
      const armA = runAdjustmentSession(request, undefined, undefined);
      expect(armA.result.success).toBe(true);
      expect(armA.result.converged).toBe(true);

      setNative3dCorrectionRouteEnabled(false);
      const armB = await runRoute(request, covarianceOnlyBundle().bundle);
      setNative3dCorrectionRouteEnabled(true);
      const armC = await runRoute(request, fullStubBundle().bundle);

      expect(armB.route).toBe('native-full-qxx');
      expect(armC.route).toBe('native-full-qxx');
      expect(armB.verification?.accepted).toBe(true);
      expect(armC.verification?.accepted).toBe(true);
      expect(armC.correctionVerification?.accepted).toBe(true);
      expect(armC.correctionVerification?.reasons ?? []).toEqual([]);
      expect(armC.nativeCorrectionCalls).toBe(armC.outcome.result.iterations);
      expect(armC.correctionVerification?.oracledSystemCount).toBe(armC.outcome.result.iterations);
      expect(armC.correctionVerification?.maxCorrectionDiff).toBeLessThan(1e-9);
      expect(armB.outcome.result.iterations).toBe(armA.result.iterations);
      expect(armC.outcome.result.iterations).toBe(armA.result.iterations);

      expect(maxDiff(comparable(armB.outcome), comparable(armA))).toBeLessThan(1e-6);
      expect(maxDiff(comparable(armC.outcome), comparable(armA))).toBeLessThan(1e-6);
      expect(Math.abs(armC.outcome.result.seuw - armA.result.seuw)).toBeLessThan(1e-6);
      let worstCoord = 0;
      for (const [stationId, station] of Object.entries(armC.outcome.result.stations)) {
        const expected = armA.result.stations[stationId];
        if (expected == null) continue;
        worstCoord = Math.max(
          worstCoord,
          Math.abs(station.x - expected.x),
          Math.abs(station.y - expected.y),
          Math.abs((station.h ?? 0) - (expected.h ?? 0)),
        );
      }
      expect(worstCoord).toBeLessThan(1e-6);
    },
  );
});
