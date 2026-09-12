/**
 * Phase 10M agent-tier contract: native full-Qxx route default ON.
 *
 * Proves the production toggle with NO test-only enabler: the fresh-module
 * default is enabled, an eligible 3D <=384 job routes `native-full-qxx`
 * without any setter call, every ineligibility gate still fails closed,
 * the kill switch forces a bit-identical clean TypeScript fallback, and
 * the full fallback matrix plus the production-equivalent corpus hold
 * with the default on. Fast unit scope only (dense-backed stubs, no WASM).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, afterEach } from 'vitest';

import { buildPhase6LargeBenchmarkCases, generatePhase6Large3dInput } from '../src/engine/phase6BenchmarkNetworks';
import { buildPhase7bEnuSmallInput } from '../src/engine/phase7bEnuFixtures';
import { runAdjustmentSession } from '../src/engine/runSession';
import type { RunSessionRequest } from '../src/engine/runSessionTypes';
import {
  deriveNativeFullQxxEligibility,
  isNativeFullQxxRouteEnabled,
  runWithNativeFullQxxAutoRoute,
  setNativeFullQxxRouteEnabled,
} from '../src/workers/adjustmentNativeFullQxxAutoRoute';
import type { SparseAutoRouteBundle } from '../src/workers/adjustmentSparseAutoRoute';
import { createRunSessionRequest } from './helpers/runSessionRequest';
import { countingCovarianceSolver } from './helpers/sparseTestStubs';

const cases = buildPhase6LargeBenchmarkCases(false);
const corpusIds = ['gps-3d-cov-08', 'gps-3d-32', 'gps-3d-64', 'gps-3d-128'];
const corpus = corpusIds.map((id) => {
  const found = cases.find((item) => item.id === id);
  if (!found) throw new Error(`Missing genuine 3D fixture ${id}.`);
  return found;
});
const fixture3d = corpus[0]!;

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

afterEach(() => {
  setNativeFullQxxRouteEnabled(true);
});

describe('Phase 10M default-ON routing (no setter)', () => {
  it('ships enabled by default on fresh import', () => {
    expect(isNativeFullQxxRouteEnabled()).toBe(true);
  });

  it('routes an eligible 3D <=384 job native with no enabler call', async () => {
    let loaded = false;
    const attempt = await runWithNativeFullQxxAutoRoute(request3d(), undefined, {
      runSession: (req, onProgress, runtime) => runAdjustmentSession(req, onProgress, runtime),
      loadBundle: async () => {
        loaded = true;
        return stubBundle();
      },
    });
    expect(loaded).toBe(true);
    expect(attempt.route).toBe('native-full-qxx');
    expect(attempt.outcome.result.success).toBe(true);
    expect(attempt.outcome.result.converged).toBe(true);
    expect(attempt.verification?.accepted).toBe(true);
    expect(attempt.reasons).toEqual([]);
  });

  it('keeps every ineligibility gate fail-closed with the default on', () => {
    const gates: Array<{ label: string; request: RunSessionRequest; reason: RegExp }> = [
      { label: '2D', request: request3d(fixture3d.input, { coordMode: '2D' }), reason: /2D preserved/ },
      {
        label: 'preanalysis',
        request: request3d(fixture3d.input, { runMode: 'preanalysis', preanalysisMode: true }),
        reason: /preanalysis/,
      },
      { label: 'robust', request: request3d(fixture3d.input, { robustMode: 'huber' }), reason: /robust/ },
      {
        label: 'TS correlation',
        request: request3d(fixture3d.input, { tsCorrelationEnabled: true }),
        reason: /TS correlation/,
      },
      {
        label: 'orientation params',
        request: request3d(readFileSync('tests/fixtures/direction_face_balanced.dat', 'utf-8')),
        reason: /orientation parameters/,
      },
      {
        label: 'auto-adjust shape',
        request: request3d(fixture3d.input, { autoAdjustEnabled: true }),
        reason: /auto-adjust/,
      },
      {
        label: 'multi-solve suspect-impact shape',
        request: request3d(fixture3d.input, { suspectImpactMode: 'auto' }),
        reason: /suspect-impact/,
      },
      {
        label: 'inline auto-adjust directive',
        request: request3d(`${fixture3d.input}\n.AUTOADJUST\n`),
        reason: /auto-adjust/,
      },
      {
        label: 'unsupported GPS covariance weight shape',
        request: request3d(buildPhase7bEnuSmallInput()),
        reason: /GPS covariance/,
      },
      {
        label: '>384 params',
        request: request3d(
          generatePhase6Large3dInput({
            id: 'gps-3d-256',
            family: 'gps-2d',
            unknownCount: 256,
            seed: 2401,
            variant: 'gps-covariance',
            dimension: '3d',
          }),
        ),
        reason: /exceeds native full-Qxx cap/,
      },
    ];
    for (const gate of gates) {
      const verdict = deriveNativeFullQxxEligibility(gate.request);
      expect(verdict.eligible, `${gate.label} must stay ineligible`).toBe(false);
      expect(verdict.reasons.join(' '), `${gate.label} reason`).toMatch(gate.reason);
    }
  });

  it('routes ineligible work straight to TypeScript with no bundle load', async () => {
    let loaded = false;
    const attempt = await runWithNativeFullQxxAutoRoute(request3d(fixture3d.input, { coordMode: '2D' }), undefined, {
      runSession: (req, onProgress, runtime) => runAdjustmentSession(req, onProgress, runtime),
      loadBundle: async () => {
        loaded = true;
        return stubBundle();
      },
    });
    expect(attempt.route).toBe('typescript');
    expect(loaded).toBe(false);
    expect(attempt.outcome.result.success).toBe(true);
  });
});

describe('Phase 10M kill-switch proof', () => {
  it('disables to a bit-identical clean TS fallback and re-enables', async () => {
    expect(isNativeFullQxxRouteEnabled()).toBe(true);
    setNativeFullQxxRouteEnabled(false);
    expect(isNativeFullQxxRouteEnabled()).toBe(false);
    expect(deriveNativeFullQxxEligibility(request3d()).eligible).toBe(false);

    let loaded = false;
    const attempt = await runWithNativeFullQxxAutoRoute(request3d(), undefined, {
      runSession: (req, onProgress, runtime) => runAdjustmentSession(req, onProgress, runtime),
      loadBundle: async () => {
        loaded = true;
        return stubBundle();
      },
    });
    expect(attempt.route).toBe('typescript');
    expect(loaded).toBe(false);
    expect(attempt.reasons.join(' ')).toMatch(/kill switch/);
    const clean = runAdjustmentSession(request3d(), undefined, undefined);
    expect(maxDiff(comparable(attempt.outcome), comparable(clean))).toBe(0);

    setNativeFullQxxRouteEnabled(true);
    expect(isNativeFullQxxRouteEnabled()).toBe(true);
    const reenabled = await runRoute(request3d());
    expect(reenabled.route).toBe('native-full-qxx');
  });
});

describe('Phase 10M fallback matrix under default ON', () => {
  it('covers init failure, solver throw, covariance fallback, and verification rejection', async () => {
    const initFailure = await runWithNativeFullQxxAutoRoute(request3d(), undefined, {
      runSession: (req, onProgress, runtime) => runAdjustmentSession(req, onProgress, runtime),
      loadBundle: async () => {
        throw new Error('no bundle');
      },
    });
    expect(initFailure.route).toBe('typescript');
    expect(initFailure.outcome.result.success).toBe(true);
    expect(initFailure.reasons.join(' ')).toMatch(/WASM bundle init failed/);

    const solverThrow = await runWithNativeFullQxxAutoRoute(request3d(), undefined, {
      runSession: (req, onProgress, runtime) => {
        if (runtime !== undefined) throw new Error('native run threw');
        return runAdjustmentSession(req, onProgress, runtime);
      },
      loadBundle: async () => stubBundle(),
    });
    expect(solverThrow.route).toBe('typescript');
    expect(solverThrow.outcome.result.success).toBe(true);
    expect(solverThrow.reasons.join(' ')).toMatch(/native full-Qxx run threw/);

    const covarianceFallback = await runWithNativeFullQxxAutoRoute(request3d(), undefined, {
      runSession: (req, onProgress, runtime) => runAdjustmentSession(req, onProgress, runtime),
      loadBundle: async () => ({
        ...stubBundle(),
        sparseSelectedCovarianceSolver: {
          querySelected: () => {
            throw new Error('native covariance unavailable');
          },
        } as unknown as SparseAutoRouteBundle['sparseSelectedCovarianceSolver'],
      }),
    });
    expect(covarianceFallback.route).toBe('typescript');
    expect(covarianceFallback.outcome.result.success).toBe(true);
    expect(covarianceFallback.reasons.join(' ')).toMatch(/fail-closed/);

    const corrupted = await runWithNativeFullQxxAutoRoute(request3d(), undefined, {
      runSession: (req, onProgress, runtime) => runAdjustmentSession(req, onProgress, runtime),
      loadBundle: async () => {
        const bundle = stubBundle();
        const delegate = bundle.sparseSelectedCovarianceSolver;
        return {
          ...bundle,
          sparseSelectedCovarianceSolver: {
            querySelected: (input) => {
              const result = delegate.querySelected(input);
              const covariance = Float64Array.from(result.covariance);
              covariance[0] = (covariance[0] ?? 0) + 1;
              return { ...result, covariance };
            },
          },
        };
      },
    });
    expect(corrupted.route).toBe('typescript');
    expect(corrupted.outcome.result.success).toBe(true);
    expect(corrupted.verification).toBeUndefined();
    expect(corrupted.reasons.join(' ')).toMatch(/C1|C2/);
  });

  it('falls back clean on non-converged and non-finite native results', async () => {
    const doctored = async (
      mutate: (_outcome: ReturnType<typeof runAdjustmentSession>) => ReturnType<typeof runAdjustmentSession>,
      reason: RegExp,
    ) => {
      let reranClean = false;
      const attempt = await runWithNativeFullQxxAutoRoute(request3d(), undefined, {
        runSession: (req, onProgress, runtime) => {
          if (runtime === undefined) {
            reranClean = true;
            return runAdjustmentSession(req, onProgress, runtime);
          }
          return mutate(runAdjustmentSession(req, onProgress, runtime));
        },
        loadBundle: async () => stubBundle(),
      });
      expect(attempt.route).toBe('typescript');
      expect(reranClean).toBe(true);
      expect(attempt.outcome.result.success).toBe(true);
      expect(attempt.reasons.join(' ')).toMatch(reason);
    };
    await doctored(
      (outcome) => ({ ...outcome, result: { ...outcome.result, success: true, converged: false } }),
      /not converged/,
    );
    await doctored((outcome) => {
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
    }, /finite/);
  });
});

describe('Phase 10M numerical proof under default ON (no enabler)', () => {
  it.each(corpus.map((item) => [item.id, item.input] as [string, string]))(
    'routes %s native with coordinate parity, C1/C2/C3 accepted, and no fallback',
    async (_id, input) => {
      const request = request3d(input);
      const attempt = await runRoute(request);
      expect(attempt.route).toBe('native-full-qxx');
      expect(attempt.verification?.accepted).toBe(true);
      expect(attempt.verification?.oracledSystemCount).toBeGreaterThan(0);
      expect(attempt.verification?.verifiedColumns.length).toBeGreaterThan(0);
      expect(attempt.reasons).toEqual([]);
      expect(attempt.outcome.result.success).toBe(true);
      expect(attempt.outcome.result.converged).toBe(true);

      const clean = runAdjustmentSession(request, undefined, undefined);
      expect(maxDiff(comparable(attempt.outcome), comparable(clean))).toBeLessThan(1e-6);
      let worstCoord = 0;
      for (const [stationId, station] of Object.entries(attempt.outcome.result.stations)) {
        const expected = clean.result.stations[stationId];
        if (expected == null) continue;
        worstCoord = Math.max(
          worstCoord,
          Math.abs(station.x - expected.x),
          Math.abs(station.y - expected.y),
          Math.abs((station.h ?? 0) - (expected.h ?? 0)),
        );
      }
      expect(worstCoord).toBeLessThan(1e-6);
      expect(Math.abs(attempt.outcome.result.seuw - clean.result.seuw)).toBeLessThan(1e-6);
    },
  );
});
