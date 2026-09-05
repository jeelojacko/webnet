/**
 * Phase 7D release hardening (worker-only route, fail-closed, no widening).
 *
 * Locks the release contract the Phase 7C route ships with: the exact
 * 63/64/65 unknown boundary, missing/corrupt WASM plus retry semantics,
 * every late S3 gate with a clean TypeScript restart, the kill switch,
 * condition parity, and the full session-exclusion list. No routing,
 * tolerance, C++, protocol, or persisted-state changes.
 */
import { describe, expect, it, beforeEach } from 'vitest';

import { PHASE7B7_RELATIVE_TOLERANCE } from '../src/engine/phase7b7FullContract';
import { generatePhase5BenchmarkInput } from '../src/engine/phase5BenchmarkNetworks';
import { runAdjustmentSession } from '../src/engine/runSession';
import type { RunSessionRequest } from '../src/engine/runSessionTypes';
import type {
  SparseCorrectionSolveInput,
  SparseCorrectionSolveResult,
  SparseCorrectionSolver,
  SparseRowProductsSolver,
  SparseSelectedCovarianceSolver,
} from '../src/engine/numericalBackend';
import {
  deriveSparseAutoRouteEligibility,
  isSparseAutoRouteEnabled,
  runWithSparseAutoRoute,
  setSparseAutoRouteBundleLoader,
  setSparseAutoRouteEnabled,
  verifySparseAutoRouteSystems,
  SPARSE_AUTO_ROUTE_MAX_CAPTURED_SYSTEMS,
  SPARSE_AUTO_ROUTE_MAX_UNKNOWN_COUNT,
  SparseAutoRouteCaptureSolver,
  type SparseAutoRouteBundle,
} from '../src/workers/adjustmentSparseAutoRoute';
import { createRunSessionRequest } from './helpers/runSessionRequest';
import {
  countingCorrectionSolver,
  countingCovarianceSolver,
  countingRowProductsSolver,
} from './helpers/sparseTestStubs';

const CHAIN_2D_08 = generatePhase5BenchmarkInput({
  id: 'chain-2d-08',
  family: 'chain-2d',
  unknownCount: 8,
  seed: 1108,
});

const chainRequest = (unknownCount: number, seed: number): RunSessionRequest => {
  const base = createRunSessionRequest({
    input: generatePhase5BenchmarkInput({
      id: `chain-2d-${unknownCount}`,
      family: 'chain-2d',
      unknownCount,
      seed,
    }),
  });
  return {
    ...base,
    parseSettings: { ...base.parseSettings, coordMode: '2D', suspectImpactMode: 'off' },
  };
};

const twoDRequest = (input: string): RunSessionRequest => {
  const base = createRunSessionRequest({ input });
  return {
    ...base,
    parseSettings: { ...base.parseSettings, coordMode: '2D', suspectImpactMode: 'off' },
  };
};

const stubBundle = (): SparseAutoRouteBundle => ({
  sparseCorrectionSolver: countingCorrectionSolver(),
  sparseRowProductsSolver: countingRowProductsSolver(),
  sparseSelectedCovarianceSolver: countingCovarianceSolver(),
});

const throwingRowProducts = (): SparseRowProductsSolver => ({
  queryRowProducts: () => {
    throw new Error('row products unavailable');
  },
});

const throwingCovariance = (): SparseSelectedCovarianceSolver => ({
  querySelected: () => {
    throw new Error('selected covariance unavailable');
  },
});

beforeEach(() => {
  setSparseAutoRouteEnabled(true);
  setSparseAutoRouteBundleLoader(undefined);
});

describe('phase 7D unknown-count boundary', () => {
  it('pins the evidence-based cap at exactly 64 unknowns', () => {
    expect(SPARSE_AUTO_ROUTE_MAX_UNKNOWN_COUNT).toBe(64);
  });

  it('admits 63 and 64 unknowns and rejects 65 on the size guard', () => {
    const at63 = deriveSparseAutoRouteEligibility(chainRequest(63, 1163));
    expect(at63.unknownCount).toBe(63);
    expect(at63.reasons).toEqual([]);
    expect(at63.eligible).toBe(true);

    const at64 = deriveSparseAutoRouteEligibility(chainRequest(64, 1164));
    expect(at64.unknownCount).toBe(64);
    expect(at64.reasons).toEqual([]);
    expect(at64.eligible).toBe(true);

    const at65 = deriveSparseAutoRouteEligibility(chainRequest(65, 1165));
    expect(at65.unknownCount).toBe(65);
    expect(at65.eligible).toBe(false);
    expect(at65.reasons.join(' ')).toMatch(/size guard: 65 unknowns exceed/);
  });
});

describe('phase 7D WASM failure and retry semantics', () => {
  it('retries cleanly after a bundle init failure (no poisoned cache)', async () => {
    let calls = 0;
    setSparseAutoRouteBundleLoader(async () => {
      calls += 1;
      if (calls === 1) throw new Error('no wasm here');
      return stubBundle();
    });
    const first = await runWithSparseAutoRoute(twoDRequest(CHAIN_2D_08), undefined, {
      runSession: runAdjustmentSession,
    });
    expect(first.route).toBe('typescript');
    expect(first.reasons.join(' ')).toMatch(/WASM bundle init failed/);

    const second = await runWithSparseAutoRoute(twoDRequest(CHAIN_2D_08), undefined, {
      runSession: runAdjustmentSession,
    });
    expect(second.route).toBe('sparse');
    expect(second.reasons).toEqual([]);
    expect(calls).toBe(2);
  });

  it('rejects numerically corrupt corrections (NaN) and restarts clean TypeScript', async () => {
    const nanBase = countingCorrectionSolver();
    const nanSolver: SparseCorrectionSolver = {
      solveFromEquations(input: SparseCorrectionSolveInput): SparseCorrectionSolveResult {
        const result = nanBase.solveFromEquations(input);
        return {
          ...result,
          correction: result.correction.map(() => [Number.NaN]),
        };
      },
    };
    setSparseAutoRouteBundleLoader(async () => ({ ...stubBundle(), sparseCorrectionSolver: nanSolver }));
    const reference = runAdjustmentSession(twoDRequest(CHAIN_2D_08));
    const attempt = await runWithSparseAutoRoute(twoDRequest(CHAIN_2D_08), undefined, {
      runSession: runAdjustmentSession,
    });
    expect(attempt.route).toBe('typescript');
    expect(attempt.reasons.join(' ')).toMatch(/non-finite correction agreement/);
    expect(attempt.outcome.result.success).toBe(reference.result.success);
    for (const [id, station] of Object.entries(reference.result.stations)) {
      expect(attempt.outcome.result.stations[id]?.x).toBe(station.x);
      expect(attempt.outcome.result.stations[id]?.y).toBe(station.y);
    }
  });
});

describe('phase 7D late S3 gates and clean restart', () => {
  it('rejects row-products and selected-covariance fallbacks with byte-identical restart', async () => {
    const reference = runAdjustmentSession(twoDRequest(CHAIN_2D_08));

    setSparseAutoRouteBundleLoader(async () => ({
      ...stubBundle(),
      sparseRowProductsSolver: throwingRowProducts(),
    }));
    const rowAttempt = await runWithSparseAutoRoute(twoDRequest(CHAIN_2D_08), undefined, {
      runSession: runAdjustmentSession,
    });
    expect(rowAttempt.route).toBe('typescript');
    expect(rowAttempt.reasons.join(' ')).toMatch(/row-products fallbacks/);
    for (const [id, station] of Object.entries(reference.result.stations)) {
      expect(rowAttempt.outcome.result.stations[id]?.x).toBe(station.x);
      expect(rowAttempt.outcome.result.stations[id]?.y).toBe(station.y);
    }

    setSparseAutoRouteBundleLoader(async () => ({
      ...stubBundle(),
      sparseSelectedCovarianceSolver: throwingCovariance(),
    }));
    const covAttempt = await runWithSparseAutoRoute(twoDRequest(CHAIN_2D_08), undefined, {
      runSession: runAdjustmentSession,
    });
    expect(covAttempt.route).toBe('typescript');
    expect(covAttempt.reasons.join(' ')).toMatch(/selected-covariance fallbacks/);
    for (const [id, station] of Object.entries(reference.result.stations)) {
      expect(covAttempt.outcome.result.stations[id]?.x).toBe(station.x);
      expect(covAttempt.outcome.result.stations[id]?.y).toBe(station.y);
    }
  });

  it('rejects a non-finite sparse result and restarts clean TypeScript', async () => {
    const reference = runAdjustmentSession(twoDRequest(CHAIN_2D_08));
    let calls = 0;
    setSparseAutoRouteBundleLoader(async () => stubBundle());
    const attempt = await runWithSparseAutoRoute(
      twoDRequest(CHAIN_2D_08),
      undefined,
      {
        runSession: ((request: RunSessionRequest) => {
          calls += 1;
          const outcome = runAdjustmentSession(request);
          if (calls === 1) {
            return {
              ...outcome,
              result: { ...outcome.result, seuw: Number.NaN },
            };
          }
          return outcome;
        }) as typeof runAdjustmentSession,
      },
    );
    expect(attempt.route).toBe('typescript');
    expect(attempt.reasons.join(' ')).toMatch(/non-finite/);
    expect(calls).toBe(2);
    expect(attempt.outcome.result.seuw).toBe(reference.result.seuw);
  });

  it('rejects empty capture and capture-bound truncation at the verifier', () => {
    const empty = verifySparseAutoRouteSystems([], false, 3, 1);
    expect(empty.accepted).toBe(false);
    expect(empty.reasons.join(' ')).toMatch(/no correction systems captured/);

    const truncated = verifySparseAutoRouteSystems([], true, 0, 1);
    expect(truncated.accepted).toBe(false);
    expect(truncated.reasons.join(' ')).toMatch(
      new RegExp(`capture truncated at ${SPARSE_AUTO_ROUTE_MAX_CAPTURED_SYSTEMS} systems`),
    );
  });

  it('treats condition-threshold excess as a warning, never a rejection', async () => {
    const request = twoDRequest(CHAIN_2D_08);
    const bundle = stubBundle();
    const capture = new SparseAutoRouteCaptureSolver(bundle.sparseCorrectionSolver);
    const outcome = runAdjustmentSession(request, undefined, {
      sparseCorrectionSolver: capture,
      sparseRowProductsSolver: bundle.sparseRowProductsSolver,
      sparseSelectedCovarianceSolver: bundle.sparseSelectedCovarianceSolver,
      experimentalSelectedCovarianceMode: true,
      experimentalSelectedCovarianceLegacyAllPairs: true,
    });
    expect(outcome.result.success).toBe(true);
    expect(capture.systems.length).toBe(outcome.result.iterations);
    const verification = verifySparseAutoRouteSystems(
      capture.systems,
      capture.truncated,
      outcome.result.iterations,
      outcome.result.condition?.estimate,
      undefined,
      1,
    );
    expect(verification.accepted).toBe(true);
    expect(verification.warnings.length).toBeGreaterThan(0);
    expect(verification.warnings.join(' ')).toMatch(/ill-conditioned/);
  });
});

describe('phase 7D kill switch', () => {
  it('is enabled by default, blocks the bundle when off, and re-arms', async () => {
    expect(isSparseAutoRouteEnabled()).toBe(true);

    setSparseAutoRouteEnabled(false);
    let loads = 0;
    setSparseAutoRouteBundleLoader(async () => {
      loads += 1;
      return stubBundle();
    });
    const blocked = await runWithSparseAutoRoute(twoDRequest(CHAIN_2D_08), undefined, {
      runSession: runAdjustmentSession,
    });
    expect(blocked.route).toBe('typescript');
    expect(loads).toBe(0);

    setSparseAutoRouteEnabled(true);
    const rearmed = await runWithSparseAutoRoute(twoDRequest(CHAIN_2D_08), undefined, {
      runSession: runAdjustmentSession,
    });
    expect(rearmed.route).toBe('sparse');
    expect(loads).toBe(1);
  });
});

describe('phase 7D condition parity', () => {
  it('keeps sparse result.condition within relative tolerance of TypeScript', async () => {
    const request = twoDRequest(CHAIN_2D_08);
    const reference = runAdjustmentSession(request);
    setSparseAutoRouteBundleLoader(async () => stubBundle());
    const attempt = await runWithSparseAutoRoute(request, undefined, {
      runSession: runAdjustmentSession,
    });
    expect(attempt.route).toBe('sparse');
    const expected = reference.result.condition?.estimate;
    const actual = attempt.outcome.result.condition?.estimate;
    expect(Number.isFinite(expected ?? NaN)).toBe(true);
    expect(Number.isFinite(actual ?? NaN)).toBe(true);
    const allowed =
      PHASE7B7_RELATIVE_TOLERANCE * Math.max(1, Math.abs(expected ?? 0));
    expect(Math.abs((actual ?? NaN) - (expected ?? NaN))).toBeLessThanOrEqual(allowed);
    expect(attempt.outcome.result.condition?.threshold).toBe(
      reference.result.condition?.threshold,
    );
  });
});

describe('phase 7D session exclusions', () => {
  it('rejects preanalysis sessions without touching the bundle', async () => {
    let loads = 0;
    setSparseAutoRouteBundleLoader(async () => {
      loads += 1;
      return stubBundle();
    });
    const base = twoDRequest(CHAIN_2D_08);
    const request: RunSessionRequest = {
      ...base,
      parseSettings: { ...base.parseSettings, preanalysisMode: true },
    };
    const verdict = deriveSparseAutoRouteEligibility(request);
    expect(verdict.eligible).toBe(false);
    expect(verdict.reasons).toContain('preanalysis mode not cleared for sparse auto-route');
    const attempt = await runWithSparseAutoRoute(request, undefined, {
      runSession: runAdjustmentSession,
    });
    expect(attempt.route).toBe('typescript');
    expect(loads).toBe(0);
  });

  it('rejects inline auto-adjust directives (single-solve sessions only)', () => {
    const request = twoDRequest(`${CHAIN_2D_08}\n.AUTOADJUST\n`);
    const verdict = deriveSparseAutoRouteEligibility(request);
    expect(verdict.eligible).toBe(false);
    expect(verdict.reasons.join(' ')).toMatch(/inline auto-adjust directive/);
  });

  it('rejects GPS covariance weighting', () => {
    const input = [
      '.GPS WEIGHT COVARIANCE',
      'C A 500000 0 100 ! ! !',
      'C B 500100 100 90',
      "G0 'session_a.asc",
      'G1 A-B 57.559600 280.508300 184.546200',
      'G2 1.8006862774E-06 8.9217319328E-06 9.4458864623E-06',
      'G3 -3.5520472466E-06 3.5240054785E-06 -8.6638065113E-06',
    ].join('\n');
    const verdict = deriveSparseAutoRouteEligibility(twoDRequest(input));
    expect(verdict.eligible).toBe(false);
    expect(verdict.reasons).toContain('GPS covariance weighting not cleared for sparse auto-route');
  });
});
