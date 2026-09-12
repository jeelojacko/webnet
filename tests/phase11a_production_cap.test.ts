/**
 * Phase 11A-production agent-tier contract: native full-Qxx cap 768.
 *
 * Proves the REAL production boundary with NO diagnostic override: 765
 * (255 unknowns) and 768 (256 unknowns) admitted, 771 (257 unknowns) and
 * 900 (300 unknowns) rejected with the size-cap reason. Exact 767/769 are
 * not constructible (3 params per unknown-station); 765/771 are the
 * nearest realistic rungs, documented here. Default production routing
 * (stub bundle, no maxParams override) takes native-full-qxx with
 * C1/C2/C3 accepted and empty reasons; the fault matrix fails closed to
 * clean TypeScript; correction stays OFF; the <=384 cohort routes exactly
 * as before (only 385..768 is newly reachable).
 */
import { describe, expect, it, afterEach } from 'vitest';

import { generatePhase6Large3dInput } from '../src/engine/phase6BenchmarkNetworks';
import { runAdjustmentSession } from '../src/engine/runSession';
import type { RunSessionRequest } from '../src/engine/runSessionTypes';
import {
  deriveNativeFullQxxEligibility,
  finalizeNativeFullQxxVerification,
  isNative3dCorrectionRouteEnabled,
  NATIVE_FULL_QXX_MAX_PARAMS,
  runWithNativeFullQxxAutoRoute,
  setNativeFullQxxRouteEnabled,
  verifyNativeFullQxxSystems,
} from '../src/workers/adjustmentNativeFullQxxAutoRoute';
import type { SparseAutoRouteBundle } from '../src/workers/adjustmentSparseAutoRoute';
import { createRunSessionRequest } from './helpers/runSessionRequest';
import { countingCovarianceSolver } from './helpers/sparseTestStubs';

const toRequest = (input: string): RunSessionRequest => {
  const base = createRunSessionRequest({ input });
  return {
    ...base,
    parseSettings: { ...base.parseSettings, coordMode: '3D', suspectImpactMode: 'off' },
  };
};

const ladderInput = (unknowns: number): string =>
  generatePhase6Large3dInput({
    id: `gps-3d-m${unknowns}`,
    family: 'gps-2d',
    unknownCount: unknowns,
    seed: 3000 + unknowns,
    variant: 'gps-covariance',
    dimension: '3d',
  });

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

const runRoute = (request: RunSessionRequest, bundle?: SparseAutoRouteBundle) =>
  runWithNativeFullQxxAutoRoute(request, undefined, {
    runSession: (req, onProgress, runtime) => runAdjustmentSession(req, onProgress, runtime),
    loadBundle: async () => bundle ?? stubBundle(),
  });

afterEach(() => {
  setNativeFullQxxRouteEnabled(true);
});

describe('Phase 11A production cap 768', () => {
  it('pins the production cap at 768 with correction OFF', () => {
    expect(NATIVE_FULL_QXX_MAX_PARAMS).toBe(768);
    expect(isNative3dCorrectionRouteEnabled()).toBe(false);
  });

  it('admits 765/768 and rejects 771/900 on the default production route', () => {
    for (const [unknowns, params] of [[255, 765], [256, 768]] as const) {
      const verdict = deriveNativeFullQxxEligibility(toRequest(ladderInput(unknowns)));
      expect(verdict.numParams).toBe(params);
      expect(verdict.eligible, `${params} params must be admitted`).toBe(true);
      expect(verdict.reasons).toEqual([]);
    }
    for (const [unknowns, params] of [[257, 771], [300, 900]] as const) {
      const verdict = deriveNativeFullQxxEligibility(toRequest(ladderInput(unknowns)));
      expect(verdict.numParams).toBe(params);
      expect(verdict.eligible, `${params} params must be rejected`).toBe(false);
      expect(verdict.reasons.join(' ')).toMatch(/exceeds native full-Qxx cap 768/);
    }
  });

  it('routes 384 and 768 native with verification accepted and empty reasons', async () => {
    for (const [unknowns, params] of [[128, 384], [256, 768]] as const) {
      const attempt = await runRoute(toRequest(ladderInput(unknowns)));
      expect(attempt.route, `${params} params must take the native route`).toBe('native-full-qxx');
      expect(attempt.verification?.accepted, `${params} C1/C2/C3 accept`).toBe(true);
      expect(attempt.reasons, `${params} reasons empty`).toEqual([]);
      expect(attempt.outcome.result.success).toBe(true);
      expect(attempt.outcome.result.converged).toBe(true);
    }
  });

  it('routes over-cap work straight to TypeScript with no bundle load', async () => {
    let loaded = false;
    const attempt = await runWithNativeFullQxxAutoRoute(toRequest(ladderInput(257)), undefined, {
      runSession: (req, onProgress, runtime) => runAdjustmentSession(req, onProgress, runtime),
      loadBundle: async () => {
        loaded = true;
        return stubBundle();
      },
    });
    expect(attempt.route).toBe('typescript');
    expect(loaded).toBe(false);
    expect(attempt.reasons.join(' ')).toMatch(/exceeds native full-Qxx cap 768/);
    expect(attempt.outcome.result.success).toBe(true);
  });

  it('fails closed to clean TypeScript across the fault matrix', async () => {
    const request = toRequest(ladderInput(32));
    const cleanTs = async (
      label: string,
      attempt: Awaited<ReturnType<typeof runRoute>>,
      pattern: RegExp,
    ): Promise<void> => {
      expect(attempt.route, `${label} clean TS`).toBe('typescript');
      expect(attempt.outcome.result.success, `${label} TS outcome succeeds`).toBe(true);
      expect(attempt.reasons.join(' '), `${label} reason`).toMatch(pattern);
    };
    await cleanTs(
      'init-fail',
      await runWithNativeFullQxxAutoRoute(request, undefined, {
        runSession: (req, onProgress, runtime) => runAdjustmentSession(req, onProgress, runtime),
        loadBundle: async () => {
          throw new Error('synthetic bundle init failure');
        },
      }),
      /init failed/,
    );
    await cleanTs(
      'run-throw',
      await runWithNativeFullQxxAutoRoute(request, undefined, {
        runSession: ((req, onProgress, runtime) => {
          if (runtime !== undefined) throw new Error('synthetic native throw');
          return runAdjustmentSession(req, onProgress, runtime);
        }) as typeof runAdjustmentSession,
        loadBundle: async () => stubBundle(),
      }),
      /threw/,
    );
    setNativeFullQxxRouteEnabled(false);
    try {
      await cleanTs('kill-switch', await runRoute(request), /kill switch/);
    } finally {
      setNativeFullQxxRouteEnabled(true);
    }
    const doctor = (
      mutate: (_outcome: ReturnType<typeof runAdjustmentSession>) => ReturnType<typeof runAdjustmentSession>,
      label: string,
      pattern: RegExp,
    ) =>
      runWithNativeFullQxxAutoRoute(request, undefined, {
        runSession: ((req, onProgress, runtime) => {
          const outcome = runAdjustmentSession(req, onProgress, runtime);
          return runtime === undefined ? outcome : mutate(outcome);
        }) as typeof runAdjustmentSession,
        loadBundle: async () => stubBundle(),
      }).then((attempt) => cleanTs(label, attempt, pattern));
    await doctor(
      (o) => ({ ...o, result: { ...o.result, success: true, converged: false } }),
      'non-converge',
      /not converged/,
    );
    await doctor(
      (o) => {
        const names = Object.keys(o.result.stations);
        const first = names[0]!;
        return {
          ...o,
          result: {
            ...o.result,
            stations: { ...o.result.stations, [first]: { ...o.result.stations[first]!, x: Number.NaN } },
          },
        };
      },
      'non-finite',
      /finite/,
    );
    const corruptBundle = (mutate: (_cov: Float64Array) => Float64Array): SparseAutoRouteBundle => {
      const base = stubBundle();
      const delegate = base.sparseSelectedCovarianceSolver;
      return {
        ...base,
        sparseSelectedCovarianceSolver: {
          querySelected: (input) => {
            const result = delegate.querySelected(input);
            return { ...result, covariance: mutate(result.covariance) };
          },
        },
      };
    };
    await cleanTs(
      'damped-solver',
      await runWithNativeFullQxxAutoRoute(request, undefined, {
        runSession: (req, onProgress, runtime) => runAdjustmentSession(req, onProgress, runtime),
        loadBundle: async () => {
          const base = stubBundle();
          const delegate = base.sparseSelectedCovarianceSolver;
          return {
            ...base,
            sparseSelectedCovarianceSolver: {
              querySelected: (input) => ({ ...delegate.querySelected(input), damping: 1 }),
            },
          };
        },
      }),
      /damping|fallback/,
    );
    await cleanTs(
      'nonfinite-solver',
      await runRoute(request, corruptBundle((cov) => Float64Array.from(cov, (v, i) => (i === 0 ? Number.NaN : v)))),
      /non-finite|fallback/,
    );
    await cleanTs(
      'c1-corrupt',
      await runRoute(request, corruptBundle((cov) => Float64Array.from(cov, (v, i) => (i === 0 ? v + 1e-3 : v)))),
      /C1|fallback/,
    );
    const truncated = verifyNativeFullQxxSystems([], false, null);
    expect(truncated.accepted, 'empty capture rejects').toBe(false);
    const mismatched = finalizeNativeFullQxxVerification([], [], false, null);
    expect(mismatched.accepted, 'empty finalizer rejects').toBe(false);
  });

  it('keeps the <=384 cohort on its existing path (only 385..768 newly reachable)', async () => {
    for (const unknowns of [32, 128]) {
      const attempt = await runRoute(toRequest(ladderInput(unknowns)));
      expect(attempt.route, `m${unknowns} stays native`).toBe('native-full-qxx');
      expect(attempt.verification?.accepted).toBe(true);
      expect(attempt.reasons).toEqual([]);
    }
    const over = deriveNativeFullQxxEligibility(toRequest(ladderInput(129)));
    expect(over.numParams).toBe(387);
    expect(over.eligible, '387 params newly reachable').toBe(true);
  });
});
