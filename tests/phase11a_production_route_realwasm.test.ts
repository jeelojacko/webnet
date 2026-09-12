/**
 * Phase 11A-production real-WASM contract: default production route at the
 * 768 cap (WASM tier, real cpp/build-wasm bundle, NO diagnostic override).
 *
 * Proves the actual default production route at 384/513/639/768 params:
 * native-full-qxx with C1/C2/C3 accepted, empty reasons, no fallback, and
 * native-vs-TS parity within the unchanged 1e-6 tolerance. Over-cap work
 * (771) routes clean TypeScript with the size-cap reason. The fault matrix
 * on the 768-param case fails closed to clean TypeScript, and sequential
 * 768 runs stay admitted with verification accepted (no retained capture).
 * Correction stays OFF. No timing assertions (walls are observation-only
 * and never gated).
 */
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

import { generatePhase6Large3dInput } from '../src/engine/phase6BenchmarkNetworks';
import { runAdjustmentSession } from '../src/engine/runSession';
import type {
  SparseSelectedCovarianceInput,
  SparseSelectedCovarianceResult,
  SparseSelectedCovarianceSolver,
} from '../src/engine/numericalBackend';
import { createExperimentalSparseNumericalBundle } from '../src/engine/wasm/experimentalSparseNumericalBundle';
import type { WebNetWasmFactory } from '../src/engine/wasm/wasmTypes';
import {
  deriveNativeFullQxxEligibility,
  isNative3dCorrectionRouteEnabled,
  NATIVE_FULL_QXX_MAX_PARAMS,
  runWithNativeFullQxxAutoRoute,
  setNativeFullQxxRouteEnabled,
} from '../src/workers/adjustmentNativeFullQxxAutoRoute';
import { createRunSessionRequest } from './helpers/runSessionRequest';

const PARITY_TOL = 1e-6;

const toRequest = (input: string) => {
  const base = createRunSessionRequest({ input });
  return { ...base, parseSettings: { ...base.parseSettings, coordMode: '3D' as const, suspectImpactMode: 'off' as const } };
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

const rounded = (value: unknown): unknown => {
  if (typeof value === 'number') return Math.round(value * 1e6) / 1e6;
  if (Array.isArray(value)) return value.map(rounded);
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rounded(v)]));
  return value;
};
const comparable = (result: unknown): unknown => {
  const rec = result as Record<string, unknown>;
  const { logs: _logs, solveTimingProfile: _timing, ...stable } = rec;
  return rounded(stable);
};
const maxDiff = (a: unknown, b: unknown): number => {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b);
  if (Array.isArray(a) && Array.isArray(b)) return Math.max(0, ...a.map((v, i) => maxDiff(v, b[i])));
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = Object.keys(a as object);
    return Math.max(0, ...keys.map((key) => maxDiff((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])));
  }
  return 0;
};

type Bundle = {
  sparseCorrectionSolver: never;
  sparseRowProductsSolver: never;
  sparseSelectedCovarianceSolver: SparseSelectedCovarianceSolver;
};

let bundle: Bundle | null = null;
const loadBundle = async (): Promise<Bundle> => {
  if (bundle) return bundle;
  const mod = (await import(
    pathToFileURL(`${process.cwd()}/cpp/build-wasm/webnet_core.js`).href
  )) as { default: WebNetWasmFactory };
  if (typeof mod.default !== 'function') throw new Error('WASM factory missing');
  const real = await createExperimentalSparseNumericalBundle(mod.default);
  bundle = {
    sparseCorrectionSolver: real.sparseCorrectionSolver as never,
    sparseRowProductsSolver: real.sparseRowProductsSolver as never,
    sparseSelectedCovarianceSolver: real.sparseSelectedCovarianceSolver,
  };
  return bundle;
};

describe('Phase 11A production route (real WASM, default cap)', () => {
  it('default production route at 384/513/639/768: native, verified, parity', async () => {
    setNativeFullQxxRouteEnabled(true);
    expect(NATIVE_FULL_QXX_MAX_PARAMS).toBe(768);
    expect(isNative3dCorrectionRouteEnabled()).toBe(false);
    const diffs: Record<number, number> = {};
    for (const [unknowns, params] of [[128, 384], [171, 513], [213, 639], [256, 768]] as const) {
      const request = toRequest(ladderInput(unknowns));
      const eligibility = deriveNativeFullQxxEligibility(request);
      expect(eligibility.numParams).toBe(params);
      expect(eligibility.eligible, `${params} params eligible by default`).toBe(true);
      const tsOutcome = runAdjustmentSession(request, undefined, undefined);
      expect(tsOutcome.result.success, `${params} TS succeeds`).toBe(true);
      const attempt = await runWithNativeFullQxxAutoRoute(request, undefined, {
        runSession: runAdjustmentSession,
        loadBundle,
      });
      expect(attempt.route, `${params} production route`).toBe('native-full-qxx');
      expect(attempt.verification?.accepted, `${params} C1/C2/C3 accept`).toBe(true);
      expect(attempt.reasons, `${params} reasons empty`).toEqual([]);
      const diff =
        JSON.stringify(comparable(tsOutcome.result)) === JSON.stringify(comparable(attempt.outcome.result))
          ? 0
          : maxDiff(comparable(tsOutcome.result), comparable(attempt.outcome.result));
      expect(diff, `${params} native-vs-TS parity`).toBeLessThan(PARITY_TOL);
      diffs[params] = diff;
    }
    console.log(`production route max diffs: ${JSON.stringify(diffs)}`);
  }, 600000);

  it('over-cap production work routes clean TypeScript with the size-cap reason', async () => {
    const request = toRequest(ladderInput(257));
    const eligibility = deriveNativeFullQxxEligibility(request);
    expect(eligibility.numParams).toBe(771);
    expect(eligibility.eligible).toBe(false);
    let bundleTouched = false;
    const attempt = await runWithNativeFullQxxAutoRoute(request, undefined, {
      runSession: (req, onProgress, runtime) => runAdjustmentSession(req, onProgress, runtime),
      loadBundle: async () => {
        bundleTouched = true;
        return loadBundle();
      },
    });
    expect(attempt.route).toBe('typescript');
    expect(bundleTouched).toBe(false);
    expect(attempt.reasons.join(' ')).toMatch(/exceeds native full-Qxx cap 768/);
    expect(attempt.outcome.result.success).toBe(true);
  }, 600000);

  it('fault matrix on the 768-param case fails closed to clean TypeScript', async () => {
    setNativeFullQxxRouteEnabled(true);
    const request = toRequest(ladderInput(256));
    const cleanTs = async (
      label: string,
      attempt: Awaited<ReturnType<typeof runWithNativeFullQxxAutoRoute>>,
      pattern: RegExp,
    ): Promise<void> => {
      expect(attempt.route, `${label} clean TS`).toBe('typescript');
      expect(attempt.outcome.result.success, `${label} TS outcome succeeds`).toBe(true);
      expect(attempt.reasons.join(' '), `${label} reason`).toMatch(pattern);
    };
    await cleanTs(
      'init-fail',
      await runWithNativeFullQxxAutoRoute(request, undefined, {
        runSession: runAdjustmentSession,
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
        loadBundle,
      }),
      /threw/,
    );
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
        loadBundle,
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
    const wrapSolver = (
      mutate: (_r: SparseSelectedCovarianceResult) => SparseSelectedCovarianceResult,
    ): (() => Promise<Bundle>) => async () => {
      const real = await loadBundle();
      const delegate = real.sparseSelectedCovarianceSolver;
      return {
        sparseCorrectionSolver: real.sparseCorrectionSolver,
        sparseRowProductsSolver: real.sparseRowProductsSolver,
        sparseSelectedCovarianceSolver: {
          querySelected(input: SparseSelectedCovarianceInput): SparseSelectedCovarianceResult {
            return mutate(delegate.querySelected(input));
          },
        },
      };
    };
    await cleanTs(
      'damped-solver',
      await runWithNativeFullQxxAutoRoute(request, undefined, {
        runSession: runAdjustmentSession,
        loadBundle: wrapSolver((r) => ({ ...r, damping: 1 })),
      }),
      /damping|fallback/,
    );
    await cleanTs(
      'nonfinite-solver',
      await runWithNativeFullQxxAutoRoute(request, undefined, {
        runSession: runAdjustmentSession,
        loadBundle: wrapSolver((r) => ({
          ...r,
          covariance: Float64Array.from(r.covariance, (v, i) => (i === 0 ? Number.NaN : v)),
        })),
      }),
      /non-finite|fallback/,
    );
    await cleanTs(
      'c1-corrupt',
      await runWithNativeFullQxxAutoRoute(request, undefined, {
        runSession: runAdjustmentSession,
        loadBundle: wrapSolver((r) => ({
          ...r,
          covariance: Float64Array.from(r.covariance, (v, i) => (i === 0 ? v + 1e-3 : v)),
        })),
      }),
      /C1|fallback/,
    );
  }, 600000);

  it('sequential 768 runs stay admitted with verification accepted', async () => {
    setNativeFullQxxRouteEnabled(true);
    const request = toRequest(ladderInput(256));
    for (let i = 0; i < 3; i += 1) {
      const attempt = await runWithNativeFullQxxAutoRoute(request, undefined, {
        runSession: runAdjustmentSession,
        loadBundle,
      });
      expect(attempt.route, `run ${i} native`).toBe('native-full-qxx');
      expect(attempt.verification?.accepted, `run ${i} accepted`).toBe(true);
      expect(attempt.reasons, `run ${i} reasons empty`).toEqual([]);
    }
  }, 600000);
});
