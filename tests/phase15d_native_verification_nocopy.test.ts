/**
 * Phase 15D agent-tier contract: native verification without the T6/T7 copies.
 *
 * Proves the zero-copy change is math-identical and fail-closed:
 * (1) old-vs-new verifier parity — the same captured inputs through the
 *     pre-change copied-buffer shape and the post-change referenced-buffer
 *     shape yield identical accept/reject + C1/C2/C3 verdicts + coverage +
 *     fallback decision (legacy vs finalizer agreement included);
 * (2) mutation corpus A–H requiring consistent rejection;
 * (3) fault-injection whole-session fallback (NaN native → non-finite
 *     rejection class + clean-TS rerun + identical final result).
 *
 * Fast stub-only coverage (dense-backed counting solvers, tiny genuine 3D
 * fixture); no real WASM, no repeated campaigns.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import { LSAEngine } from '../src/engine/adjust';
import { runAdjustmentSession } from '../src/engine/runSession';
import type { RunSessionRequest } from '../src/engine/runSessionTypes';
import { buildPhase6LargeBenchmarkCases } from '../src/engine/phase6BenchmarkNetworks';
import { buildBoundedVerificationQueries } from '../src/engine/preanalysisSparseCovarianceSentinel';
import type { SparseSelectedCovarianceResult } from '../src/engine/numericalBackend';
import {
  finalizeNativeFullQxxVerification,
  isNativeFullQxxRouteEnabled,
  NativeFullQxxCaptureSolver,
  runWithNativeFullQxxAutoRoute,
  setNativeFullQxxRouteEnabled,
  verifyNativeFullQxxSystems,
  type CapturedNativeFullQxxSystem,
} from '../src/workers/adjustmentNativeFullQxxAutoRoute';
import { createRunSessionRequest } from './helpers/runSessionRequest';
import {
  countingCorrectionSolver,
  countingCovarianceSolver,
  countingRowProductsSolver,
} from './helpers/sparseTestStubs';

const cases = buildPhase6LargeBenchmarkCases(false);
const fixture3d = cases.find((item) => item.id === 'gps-3d-cov-08');
if (!fixture3d) throw new Error('Missing genuine 3D fixture gps-3d-cov-08.');

const solveCaptured = (): NativeFullQxxCaptureSolver => {
  const capture = new NativeFullQxxCaptureSolver(countingCovarianceSolver());
  const outcome = new LSAEngine({
    input: fixture3d.input,
    sparseSelectedCovarianceSolver: capture,
    experimentalSelectedCovarianceMode: false,
    allowVerifiedNativeDenseQxxReuse: true,
  }).solve();
  expect(outcome.success).toBe(true);
  expect(outcome.converged).toBe(true);
  expect(capture.systems.length).toBeGreaterThan(0);
  return capture;
};

const cloneSystem = (system: CapturedNativeFullQxxSystem): CapturedNativeFullQxxSystem => ({
  design: {
    rowOffsets: Int32Array.from(system.design.rowOffsets),
    columns: Int32Array.from(system.design.columns),
    values: Float64Array.from(system.design.values),
  },
  weights: {
    rows: Int32Array.from(system.weights.rows),
    columns: Int32Array.from(system.weights.columns),
    values: Float64Array.from(system.weights.values),
  },
  observationEquationCount: system.observationEquationCount,
  parameterCount: system.parameterCount,
  queryRows: Int32Array.from(system.queryRows),
  queryColumns: Int32Array.from(system.queryColumns),
  result: {
    ...system.result,
    covariance: Float64Array.from(system.result.covariance),
    ...(system.result.timings != null ? { timings: { ...system.result.timings } } : {}),
  },
});

/** Pre-change T6/T7 shape: every buffer deep-copied (Array.from copies). */
const asPreChangeCopy = (system: CapturedNativeFullQxxSystem): CapturedNativeFullQxxSystem => cloneSystem(system);

const queryIndex = (system: CapturedNativeFullQxxSystem, row: number, column: number): number => {
  for (let k = 0; k < system.queryRows.length; k += 1) {
    if (system.queryRows[k] === row && system.queryColumns[k] === column) return k;
  }
  throw new Error(`query entry (${row},${column}) not found`);
};

const canonicalStations = (result: { stations: Record<string, unknown> }): string =>
  JSON.stringify(result.stations);

describe('Phase 15D zero-copy verification parity', () => {
  it('captured covariance is the engine-owned buffer by reference (T6 removed)', () => {
    const inner = countingCovarianceSolver();
    let handed: Float64Array | null = null;
    const capture = new NativeFullQxxCaptureSolver({
      querySelected: (input) => {
        const out: SparseSelectedCovarianceResult = inner.querySelected(input);
        handed = out.covariance;
        return out;
      },
    });
    const outcome = new LSAEngine({
      input: fixture3d.input,
      sparseSelectedCovarianceSolver: capture,
      experimentalSelectedCovarianceMode: false,
      allowVerifiedNativeDenseQxxReuse: true,
    }).solve();
    expect(outcome.success).toBe(true);
    expect(handed).not.toBeNull();
    expect(capture.systems[0]?.result.covariance).toBe(handed);
  });

  it('old-copy vs new-reference inputs verify identically (accept path)', () => {
    const capture = solveCaptured();
    const systems = [...capture.systems];
    const n = systems[0]?.parameterCount ?? 0;
    const preChange = systems.map(asPreChangeCopy);
    const legacyOld = verifyNativeFullQxxSystems(preChange, false, n);
    const legacyNew = verifyNativeFullQxxSystems(systems, false, n);
    expect(legacyNew.accepted).toBe(true);
    expect(legacyNew.accepted).toBe(legacyOld.accepted);
    expect(legacyNew.reasons).toEqual(legacyOld.reasons);
    expect(legacyNew.maxC1Diff).toBe(legacyOld.maxC1Diff);
    expect(legacyNew.maxC2Residual).toBe(legacyOld.maxC2Residual);
    expect(legacyNew.verifiedColumns).toEqual(legacyOld.verifiedColumns);
    expect(legacyNew.oracledSystemCount).toBe(legacyOld.oracledSystemCount);
    // Fallback decision agrees through the cached finalizer on both shapes.
    const cachedNew = finalizeNativeFullQxxVerification(
      systems,
      systems.map((s) => verifyNativeFullQxxSystems([s], false, s.parameterCount)),
      false,
      n,
    );
    const cachedOld = finalizeNativeFullQxxVerification(
      preChange,
      preChange.map((s) => verifyNativeFullQxxSystems([s], false, s.parameterCount)),
      false,
      n,
    );
    expect(cachedNew).toEqual(cachedOld);
    expect(cachedNew.accepted).toBe(true);
  });

  it('mutation corpus A–H rejects consistently on both shapes', () => {
    const capture = solveCaptured();
    const base = capture.systems[0] as CapturedNativeFullQxxSystem;
    const n = base.parameterCount;
    const bounded = buildBoundedVerificationQueries(n, undefined, 768);
    const verified = new Set(bounded.verifiedColumns);
    let unsampled = -1;
    for (let j = 0; j < n; j += 1) {
      if (!verified.has(j)) {
        unsampled = j;
        break;
      }
    }
    expect(unsampled).toBeGreaterThanOrEqual(0);
    const mutate = (label: string, fn: (_s: CapturedNativeFullQxxSystem) => void): void => {
      const fresh = cloneSystem(base);
      fn(fresh);
      const preChange = asPreChangeCopy(fresh);
      const rejNew = verifyNativeFullQxxSystems([fresh], false, n);
      const rejOld = verifyNativeFullQxxSystems([preChange], false, n);
      expect(rejNew.accepted, `${label}: new path must reject`).toBe(false);
      expect(rejOld.accepted, `${label}: old path must reject`).toBe(false);
      expect(rejNew.reasons, `${label}: verdicts must match`).toEqual(rejOld.reasons);
    };
    // A: sampled value (C1).
    mutate('A sampled-value', (s) => {
      const k = queryIndex(s, 0, 0);
      s.result.covariance[k] = (s.result.covariance[k] ?? 0) + 1;
    });
    // B: unsampled-by-C1 value in a complete column (C2).
    mutate('B unsampled-C2-value', (s) => {
      const k = queryIndex(s, 0, 1);
      s.result.covariance[k] = (s.result.covariance[k] ?? 0) + 1;
    });
    // C: unsampled off-diagonal breaking symmetry (isolated C3-physical).
    mutate('C physical entry', (s) => {
      const k = queryIndex(s, 0, unsampled);
      s.result.covariance[k] = (s.result.covariance[k] ?? 0) + 1;
    });
    // D: NaN.
    mutate('D NaN', (s) => {
      s.result.covariance[5] = Number.NaN;
    });
    // E: Infinity.
    mutate('E Infinity', (s) => {
      s.result.covariance[5] = Number.POSITIVE_INFINITY;
    });
    // F: wrong dimension (covariance length mismatch).
    mutate('F wrong dimension', (s) => {
      s.result.covariance = s.result.covariance.slice(0, s.result.covariance.length - 1);
    });
    // G: missing query (coverage mismatch).
    mutate('G missing query', (s) => {
      s.queryRows = s.queryRows.slice(0, s.queryRows.length - 1);
      s.queryColumns = s.queryColumns.slice(0, s.queryColumns.length - 1);
    });
    // H: packed-N corruption (oracle normal differs from native values).
    mutate('H packed-N corruption', (s) => {
      s.design.values[0] = (s.design.values[0] ?? 0) + 1;
    });
  });

  it('isolated C3 rejection carries no C1/C2 reasons on the new path', () => {
    const capture = solveCaptured();
    const base = capture.systems[0] as CapturedNativeFullQxxSystem;
    const n = base.parameterCount;
    const bounded = buildBoundedVerificationQueries(n, undefined, 768);
    const verified = new Set(bounded.verifiedColumns);
    let unsampled = -1;
    for (let j = 0; j < n; j += 1) {
      if (!verified.has(j)) {
        unsampled = j;
        break;
      }
    }
    expect(unsampled).toBeGreaterThanOrEqual(0);
    const corrupt = cloneSystem(base);
    const k = queryIndex(corrupt, 0, unsampled);
    corrupt.result.covariance[k] = (corrupt.result.covariance[k] ?? 0) + 1;
    const verdict = verifyNativeFullQxxSystems([corrupt], false, n);
    expect(verdict.accepted).toBe(false);
    expect(verdict.reasons.join(' ')).toMatch(/C3-physical/);
    expect(verdict.reasons.join(' ')).not.toMatch(/C1:|C2 column/);
  });
});

describe('Phase 15D fault-injection whole-session fallback', () => {
  const wasEnabled = isNativeFullQxxRouteEnabled();

  const request3d = (): RunSessionRequest => {
    const base = createRunSessionRequest({ input: fixture3d.input });
    return {
      ...base,
      parseSettings: { ...base.parseSettings, coordMode: '3D', suspectImpactMode: 'off' },
    };
  };

  beforeEach(() => {
    setNativeFullQxxRouteEnabled(true);
  });

  afterEach(() => {
    setNativeFullQxxRouteEnabled(wasEnabled);
  });

  it('NaN native covariance rejects non-finite, reruns clean TS with identical result', async () => {
    const request = request3d();
    const expected = runAdjustmentSession(request, undefined, undefined);
    expect(expected.result.success).toBe(true);
    const poisoned = countingCovarianceSolver();
    const nanSolver = {
      ...poisoned,
      querySelected: ((input: Parameters<typeof poisoned.querySelected>[0]) => {
        const out = poisoned.querySelected(input);
        out.covariance[0] = Number.NaN;
        return out;
      }),
    };
    const attempt = await runWithNativeFullQxxAutoRoute(request, undefined, {
      runSession: runAdjustmentSession,
      loadBundle: async () => ({
        sparseCorrectionSolver: countingCorrectionSolver(),
        sparseRowProductsSolver: countingRowProductsSolver(),
        sparseSelectedCovarianceSolver: nanSolver,
      }),
    });
    expect(attempt.route).toBe('typescript');
    expect(attempt.reasons.join(' ')).toMatch(/non-finite/);
    expect(attempt.outcome.result.success).toBe(true);
    expect(attempt.outcome.result.converged).toBe(expected.result.converged);
    expect(canonicalStations(attempt.outcome.result)).toBe(canonicalStations(expected.result));
  });
});
