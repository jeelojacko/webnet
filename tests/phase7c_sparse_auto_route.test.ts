/**
 * Phase 7C automatic sparse route tests (worker routing, fail-closed).
 *
 * Covers eligibility derivation from parsed/prepared state (ordinary 2D
 * adjustment admitted; 3D/robust/correlation/preanalysis/oversize/weak
 * geometry/kill-switch rejected), the sparse accept path through
 * dense-backed stub solvers, and clean TypeScript reruns on throw,
 * damping, correction mismatch, and bundle init failure. The worker
 * protocol itself is unchanged (one async-compat check).
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, beforeEach } from 'vitest';

import { runAdjustmentSession } from '../src/engine/runSession';
import { generatePhase5BenchmarkInput } from '../src/engine/phase5BenchmarkNetworks';
import type {
  SparseCorrectionSolveInput,
  SparseCorrectionSolveResult,
  SparseCorrectionSolver,
} from '../src/engine/numericalBackend';
import { createAdjustmentWorkerHandler } from '../src/workers/adjustmentWorkerHandler';
import {
  deriveSparseAutoRouteEligibility,
  loadSparseAutoRouteBundle,
  resolveSparseWasmGlueUrl,
  runWithSparseAutoRoute,
  setSparseAutoRouteBundleLoader,
  setSparseAutoRouteEnabled,
  type SparseAutoRouteBundle,
} from '../src/workers/adjustmentSparseAutoRoute';
import { createRunSessionRequest } from './helpers/runSessionRequest';
import {
  countingCorrectionSolver,
  countingCovarianceSolver,
  countingRowProductsSolver,
  type CountingCorrectionSolver,
} from './helpers/sparseTestStubs';

const readExample = (file: string): string =>
  fs.readFileSync(path.join(process.cwd(), 'public/examples', file), 'utf-8');

const TRIANGULATION_2D = readExample('ts_triangulation_trilateration_2d.dat');
const CHAIN_2D_08 = generatePhase5BenchmarkInput({
  id: 'chain-2d-08',
  family: 'chain-2d',
  unknownCount: 8,
  seed: 1108,
});
const RESECTION = readExample('industry_resection_pillars.dat');
const CHAIN_128 = generatePhase5BenchmarkInput({
  id: 'chain-2d-128',
  family: 'chain-2d',
  unknownCount: 128,
  seed: 1128,
});

import type { RunSessionRequest } from '../src/engine/runSessionTypes';

const withParsePatch = (
  input: string,
  patch: Partial<RunSessionRequest['parseSettings']>,
): RunSessionRequest => {
  const base = createRunSessionRequest({ input });
  return { ...base, parseSettings: { ...base.parseSettings, ...patch } };
};

const twoDRequest = (input: string): RunSessionRequest =>
  withParsePatch(input, { coordMode: '2D', suspectImpactMode: 'off' });

const stubBundle = (): SparseAutoRouteBundle => ({
  sparseCorrectionSolver: countingCorrectionSolver(),
  sparseRowProductsSolver: countingRowProductsSolver(),
  sparseSelectedCovarianceSolver: countingCovarianceSolver(),
});

beforeEach(() => {
  setSparseAutoRouteEnabled(true);
  setSparseAutoRouteBundleLoader(undefined);
});

describe('phase 7C sparse auto-route eligibility', () => {
  it('admits an ordinary small 2D adjustment job', () => {
    const verdict = deriveSparseAutoRouteEligibility(twoDRequest(TRIANGULATION_2D));
    expect(verdict.reasons).toEqual([]);
    expect(verdict.eligible).toBe(true);
    expect(verdict.unknownCount).toBeGreaterThan(0);
  });

  it('rejects 3D, robust, correlated, and non-adjustment modes', () => {
    expect(
      deriveSparseAutoRouteEligibility(createRunSessionRequest({ input: TRIANGULATION_2D }))
        .eligible,
    ).toBe(false);
    expect(
      deriveSparseAutoRouteEligibility(withParsePatch(TRIANGULATION_2D, { robustMode: 'huber' }))
        .eligible,
    ).toBe(false);
    expect(
      deriveSparseAutoRouteEligibility(
        withParsePatch(TRIANGULATION_2D, { tsCorrelationEnabled: true }),
      ).reasons,
    ).toContain('TS correlation not cleared for sparse auto-route');
    for (const runMode of ['preanalysis', 'data-check', 'blunder-detect'] as const) {
      const verdict = deriveSparseAutoRouteEligibility(
        withParsePatch(TRIANGULATION_2D, { runMode }),
      );
      expect(verdict.eligible, runMode).toBe(false);
    }
  });

  it('rejects oversize networks on the 64-unknown size guard', () => {
    const verdict = deriveSparseAutoRouteEligibility(twoDRequest(CHAIN_128));
    expect(verdict.eligible).toBe(false);
    expect(verdict.reasons.join(' ')).toMatch(/size guard: 128 unknowns exceed/);
  });

  it('rejects weak angular-only geometry at preflight', () => {
    const verdict = deriveSparseAutoRouteEligibility(twoDRequest(RESECTION));
    expect(verdict.eligible).toBe(false);
    expect(verdict.reasons.some((reason) => reason.startsWith('preflight:'))).toBe(true);
  });

  it('rejects everything when the kill switch is off', () => {
    setSparseAutoRouteEnabled(false);
    const verdict = deriveSparseAutoRouteEligibility(twoDRequest(TRIANGULATION_2D));
    expect(verdict).toEqual({
      eligible: false,
      reasons: ['sparse auto-route disabled by kill switch'],
      unknownCount: null,
    });
  });

  it('rejects multi-solve session features (suspect impact, auto-adjust, cluster dual-pass)', () => {
    expect(
      deriveSparseAutoRouteEligibility(withParsePatch(CHAIN_2D_08, { suspectImpactMode: 'auto' }))
        .eligible,
    ).toBe(false);
    expect(
      deriveSparseAutoRouteEligibility(
        withParsePatch(CHAIN_2D_08, { suspectImpactMode: 'auto' }),
      ).reasons.join(' '),
    ).toMatch(/suspect-impact mode 'auto'/);
    expect(
      deriveSparseAutoRouteEligibility(withParsePatch(CHAIN_2D_08, { autoAdjustEnabled: true }))
        .reasons.join(' '),
    ).toMatch(/auto-adjust not cleared/);
    const base = twoDRequest(CHAIN_2D_08);
    const clustered: RunSessionRequest = {
      ...base,
      parseSettings: { ...base.parseSettings, clusterDetectionEnabled: true },
      approvedClusterMerges: [{ from: 'A', to: 'B' }] as never,
    };
    expect(deriveSparseAutoRouteEligibility(clustered).reasons.join(' ')).toMatch(
      /cluster dual-pass/,
    );
  });
});

describe('phase 7C sparse auto-route execution', () => {
  it('runs the sparse bundle when eligible and matches the TypeScript reference', async () => {
    const request = twoDRequest(CHAIN_2D_08);
    const reference = runAdjustmentSession(request);
    expect(reference.result.success).toBe(true);
    const bundle = stubBundle();
    setSparseAutoRouteBundleLoader(async () => bundle);
    const attempt = await runWithSparseAutoRoute(request, undefined, {
      runSession: runAdjustmentSession,
    });
    expect(attempt.route).toBe('sparse');
    expect(attempt.reasons).toEqual([]);
    expect(attempt.outcome.result.success).toBe(true);
    const correction = bundle.sparseCorrectionSolver as CountingCorrectionSolver;
    expect(correction.inputs.length).toBeGreaterThan(0);
    for (const [id, station] of Object.entries(reference.result.stations)) {
      const candidate = attempt.outcome.result.stations[id];
      expect(candidate, `station ${id} agrees`).toBeDefined();
      expect(Math.abs((candidate?.x ?? NaN) - station.x)).toBeLessThan(1e-9);
      expect(Math.abs((candidate?.y ?? NaN) - station.y)).toBeLessThan(1e-9);
    }
  });

  it('stays TypeScript for ineligible jobs without touching the bundle', async () => {
    let loads = 0;
    setSparseAutoRouteBundleLoader(async () => {
      loads += 1;
      return stubBundle();
    });
    const request = twoDRequest(RESECTION);
    const attempt = await runWithSparseAutoRoute(request, undefined, {
      runSession: runAdjustmentSession,
    });
    expect(attempt.route).toBe('typescript');
    expect(loads).toBe(0);
    expect(attempt.outcome.result).toBeDefined();
  });

  it('reruns clean TypeScript when the sparse backend throws', async () => {
    const throwing: SparseCorrectionSolver = {
      solveFromEquations(_input: SparseCorrectionSolveInput): SparseCorrectionSolveResult {
        throw new Error('boom');
      },
    };
    setSparseAutoRouteBundleLoader(async () => ({ ...stubBundle(), sparseCorrectionSolver: throwing }));
    const request = twoDRequest(CHAIN_2D_08);
    const reference = runAdjustmentSession(request);
    const attempt = await runWithSparseAutoRoute(request, undefined, {
      runSession: runAdjustmentSession,
    });
    expect(attempt.route).toBe('typescript');
    expect(attempt.reasons.join(' ')).toMatch(/threw|no correction/);
    expect(attempt.outcome.result.success).toBe(reference.result.success);
    for (const [id, station] of Object.entries(reference.result.stations)) {
      expect(attempt.outcome.result.stations[id]?.x).toBe(station.x);
      expect(attempt.outcome.result.stations[id]?.y).toBe(station.y);
    }
  });

  it('reruns clean TypeScript on damping and on correction mismatch', async () => {
    const dampedBase = countingCorrectionSolver();
    const damped: SparseCorrectionSolver = {
      solveFromEquations(input: SparseCorrectionSolveInput): SparseCorrectionSolveResult {
        const result = dampedBase.solveFromEquations(input);
        return { ...result, damping: 1e-3 };
      },
    };
    setSparseAutoRouteBundleLoader(async () => ({ ...stubBundle(), sparseCorrectionSolver: damped }));
    const dampedAttempt = await runWithSparseAutoRoute(twoDRequest(CHAIN_2D_08), undefined, {
      runSession: runAdjustmentSession,
    });
    expect(dampedAttempt.route).toBe('typescript');
    expect(dampedAttempt.reasons.join(' ')).toMatch(/damping/);

    const skewedBase = countingCorrectionSolver();
    const skewed: SparseCorrectionSolver = {
      solveFromEquations(input: SparseCorrectionSolveInput): SparseCorrectionSolveResult {
        const result = skewedBase.solveFromEquations(input);
        return {
          ...result,
          correction: result.correction.map(([value]) => [(value ?? 0) + 1e-6]),
        };
      },
    };
    setSparseAutoRouteBundleLoader(async () => ({ ...stubBundle(), sparseCorrectionSolver: skewed }));
    const skewedAttempt = await runWithSparseAutoRoute(twoDRequest(CHAIN_2D_08), undefined, {
      runSession: runAdjustmentSession,
    });
    expect(skewedAttempt.route).toBe('typescript');
    expect(skewedAttempt.reasons.join(' ')).toMatch(/correction agreement/);
  });

  it('stays TypeScript without loading the bundle when the kill switch is off', async () => {
    setSparseAutoRouteEnabled(false);
    let loads = 0;
    setSparseAutoRouteBundleLoader(async () => {
      loads += 1;
      return stubBundle();
    });
    const request = twoDRequest(CHAIN_2D_08);
    const reference = runAdjustmentSession(request);
    const attempt = await runWithSparseAutoRoute(request, undefined, {
      runSession: runAdjustmentSession,
    });
    expect(attempt.route).toBe('typescript');
    expect(loads).toBe(0);
    expect(attempt.reasons).toEqual(['sparse auto-route disabled by kill switch']);
    for (const [id, station] of Object.entries(reference.result.stations)) {
      expect(attempt.outcome.result.stations[id]?.x).toBe(station.x);
      expect(attempt.outcome.result.stations[id]?.y).toBe(station.y);
    }
  });

  it('reruns clean TypeScript when result.condition is missing or the capture count diverges', async () => {
    setSparseAutoRouteBundleLoader(async () => stubBundle());
    const stripCondition = (
      req: RunSessionRequest,
      prog?: never,
      runtime?: never,
    ): ReturnType<typeof runAdjustmentSession> => {
      const outcome = runAdjustmentSession(req, prog, runtime);
      return { ...outcome, result: { ...outcome.result, condition: undefined } };
    };
    const stripped = await runWithSparseAutoRoute(twoDRequest(CHAIN_2D_08), undefined, {
      runSession: stripCondition as typeof runAdjustmentSession,
    });
    expect(stripped.route).toBe('typescript');
    expect(stripped.reasons.join(' ')).toMatch(/no finite result\.condition/);

    const bumpIterations = (
      req: RunSessionRequest,
      prog?: never,
      runtime?: never,
    ): ReturnType<typeof runAdjustmentSession> => {
      const outcome = runAdjustmentSession(req, prog, runtime);
      return {
        ...outcome,
        result: { ...outcome.result, iterations: outcome.result.iterations + 1 },
      };
    };
    const bumped = await runWithSparseAutoRoute(twoDRequest(CHAIN_2D_08), undefined, {
      runSession: bumpIterations as typeof runAdjustmentSession,
    });
    expect(bumped.route).toBe('typescript');
    expect(bumped.reasons.join(' ')).toMatch(/captured .* systems != .* correction iterations/);
  });

  it('reruns clean TypeScript when bundle init fails', async () => {
    setSparseAutoRouteBundleLoader(async () => {
      throw new Error('no wasm here');
    });
    const request = twoDRequest(CHAIN_2D_08);
    const attempt = await runWithSparseAutoRoute(request, undefined, {
      runSession: runAdjustmentSession,
    });
    expect(attempt.route).toBe('typescript');
    expect(attempt.reasons.join(' ')).toMatch(/WASM bundle init failed/);
    expect(attempt.outcome.result.success).toBe(true);
  });
});

describe('phase 7C sparse condition parity', () => {
  it('records result.condition on the sparse-injected path', async () => {
    const { LSAEngine } = await import('../src/engine/adjust');
    const reference = new LSAEngine({ input: CHAIN_2D_08, maxIterations: 10 }).solve();
    expect(reference.condition?.estimate).toBeDefined();
    const candidate = new LSAEngine({
      input: CHAIN_2D_08,
      maxIterations: 10,
      sparseCorrectionSolver: countingCorrectionSolver(),
    }).solve();
    expect(candidate.success).toBe(reference.success);
    expect(candidate.condition).toBeDefined();
    expect(Number.isFinite(candidate.condition?.estimate ?? NaN)).toBe(true);
    expect(candidate.condition?.threshold).toBe(reference.condition?.threshold);
  });
});

describe('phase 7C wasm serving', () => {
  it('fails closed with an explicit diagnostic outside a browser worker', async () => {
    expect(typeof globalThis.location).toBe('undefined');
    expect(() => resolveSparseWasmGlueUrl()).toThrow(/browser worker location/);
    await expect(loadSparseAutoRouteBundle()).rejects.toThrow(/browser worker location/);
  });
});

describe('phase 7C worker protocol', () => {
  it('supports async session functions without protocol changes', async () => {
    const posted: unknown[] = [];
    const handler = createAdjustmentWorkerHandler({
      loadSession: async () => async (payload) => runAdjustmentSession(payload),
      postMessage: (message) => posted.push(message),
      defer: (callback) => callback(),
    });
    handler.handleMessage({ type: 'run', runId: 'phase7c-async', payload: twoDRequest(CHAIN_2D_08) });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const types = posted.map((message) => (message as { type?: string }).type);
    expect(types[0]).toBe('progress');
    expect(types[types.length - 1]).toBe('success');
    const success = posted[posted.length - 1] as { payload?: { result?: { success?: boolean } } };
    expect(success.payload?.result?.success).toBe(true);
  });
});
