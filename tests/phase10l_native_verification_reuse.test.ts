/**
 * Phase 10L agent-tier contract: cached verification reuse.
 *
 * Differential legacy-vs-cached corpus: finalizeNativeFullQxxVerification
 * over stored inline evidence must decide bit-identically to
 * verifyNativeFullQxxSystems over the same capture (accepted, reasons,
 * oracledSystemCount, maxC1Diff, maxC2Residual, verifiedColumns). Fault
 * matrix covers valid single/multi captures, truncation, empty capture,
 * inline C1/C2/C3 rejections, parameter-count mismatch, malformed timing
 * metadata, non-finite covariance, query-coverage mismatch, damping, raw
 * corruption, and bookkeeping faults (missing/partial/tampered evidence,
 * which fail closed by design while legacy accepts the systems).
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import { LSAEngine } from '../src/engine/adjust';
import { runAdjustmentSession } from '../src/engine/runSession';
import type { RunSessionRequest } from '../src/engine/runSessionTypes';
import { buildPhase6LargeBenchmarkCases } from '../src/engine/phase6BenchmarkNetworks';
import { buildBoundedVerificationQueries } from '../src/engine/preanalysisSparseCovarianceSentinel';
import {
  finalizeNativeFullQxxVerification,
  isNativeFullQxxRouteEnabled,
  NATIVE_FULL_QXX_MAX_PARAMS,
  NativeFullQxxCaptureSolver,
  runWithNativeFullQxxAutoRoute,
  setNativeFullQxxRouteEnabled,
  verifyNativeFullQxxSystems,
  type CapturedNativeFullQxxSystem,
  type NativeFullQxxVerification,
} from '../src/workers/adjustmentNativeFullQxxAutoRoute';
import type { SparseAutoRouteBundle } from '../src/workers/adjustmentSparseAutoRoute';
import { createRunSessionRequest } from './helpers/runSessionRequest';
import {
  countingCorrectionSolver,
  countingCovarianceSolver,
  countingRowProductsSolver,
} from './helpers/sparseTestStubs';

const cases = buildPhase6LargeBenchmarkCases(false);
const fixture3d = cases.find((item) => item.id === 'gps-3d-cov-08');
if (!fixture3d) throw new Error('Missing genuine 3D fixture gps-3d-cov-08.');

/** Deterministic corpus: one real captured system via the dense-backed stub. */
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
  expect(capture.inlineVerifications).toBe(capture.systems.length);
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

/** Index of (row, column) in the captured query order (layout-agnostic). */
const queryIndex = (
  system: CapturedNativeFullQxxSystem,
  row: number,
  column: number,
): number => {
  for (let k = 0; k < system.queryRows.length; k += 1) {
    if (system.queryRows[k] === row && system.queryColumns[k] === column) return k;
  }
  throw new Error(`query entry (${row},${column}) not found`);
};

/** Inline evidence exactly as the capture solver stores it per system. */
const inlineFor = (
  systems: readonly CapturedNativeFullQxxSystem[],
): NativeFullQxxVerification[] =>
  systems.map((system) =>
    verifyNativeFullQxxSystems([system], false, system.parameterCount),
  );

const expectExactMatch = (
  systems: readonly CapturedNativeFullQxxSystem[],
  inline: readonly NativeFullQxxVerification[],
  truncated: boolean,
  expected: number | null,
): NativeFullQxxVerification => {
  const legacy = verifyNativeFullQxxSystems(systems, truncated, expected);
  const cached = finalizeNativeFullQxxVerification(systems, inline, truncated, expected);
  expect(cached.accepted).toBe(legacy.accepted);
  expect(cached.reasons).toEqual(legacy.reasons);
  expect(cached.oracledSystemCount).toBe(legacy.oracledSystemCount);
  expect(cached.maxC1Diff).toBe(legacy.maxC1Diff);
  expect(cached.maxC2Residual).toBe(legacy.maxC2Residual);
  expect(cached.verifiedColumns).toEqual(legacy.verifiedColumns);
  return cached;
};

describe('Phase 10L cached verification reuse', () => {
  it('matches legacy on a valid single system', () => {
    const capture = solveCaptured();
    const systems = [...capture.systems];
    const n = systems[0]?.parameterCount ?? 0;
    const cached = expectExactMatch(systems, inlineFor(systems), false, n);
    expect(cached.accepted).toBe(true);
    expect(cached.verifiedColumns.length).toBeGreaterThan(0);
  });

  it('matches legacy on multiple valid systems', () => {
    const capture = solveCaptured();
    const systems = [capture.systems[0] as CapturedNativeFullQxxSystem].map(cloneSystem);
    const pair = [systems[0] as CapturedNativeFullQxxSystem, cloneSystem(systems[0] as CapturedNativeFullQxxSystem)];
    const n = pair[0]?.parameterCount ?? 0;
    const cached = expectExactMatch(pair, inlineFor(pair), false, n);
    expect(cached.accepted).toBe(true);
    expect(cached.oracledSystemCount).toBe(2);
  });

  it('retags a second-system rejection to its capture position', () => {
    const capture = solveCaptured();
    const base = cloneSystem(capture.systems[0] as CapturedNativeFullQxxSystem);
    const corrupt = cloneSystem(base);
    corrupt.result.covariance[queryIndex(corrupt, 0, 0)] =
      (corrupt.result.covariance[queryIndex(corrupt, 0, 0)] ?? 0) + 1;
    const pair = [base, corrupt];
    const n = base.parameterCount;
    const cached = expectExactMatch(pair, inlineFor(pair), false, n);
    expect(cached.accepted).toBe(false);
    expect(cached.reasons.join(' ')).toMatch(/system 2 C1/);
  });

  it('matches legacy on empty and truncated captures', () => {
    const empty = expectExactMatch([], [], false, 2);
    expect(empty.accepted).toBe(false);
    expect(empty.reasons.join(' ')).toMatch(/no native covariance systems captured/);
    const emptyTruncated = expectExactMatch([], [], true, 2);
    expect(emptyTruncated.reasons.join(' ')).toMatch(/capture truncated/);

    const capture = solveCaptured();
    const systems = [...capture.systems];
    const n = systems[0]?.parameterCount ?? 0;
    const truncated = expectExactMatch(systems, inlineFor(systems), true, n);
    expect(truncated.accepted).toBe(false);
    expect(truncated.reasons.join(' ')).toMatch(/capture truncated/);
  });

  it('propagates an inline C1 rejection exactly', () => {
    const capture = solveCaptured();
    const corrupt = cloneSystem(capture.systems[0] as CapturedNativeFullQxxSystem);
    const k = queryIndex(corrupt, 0, 0);
    corrupt.result.covariance[k] = (corrupt.result.covariance[k] ?? 0) + 1;
    const cached = expectExactMatch([corrupt], inlineFor([corrupt]), false, corrupt.parameterCount);
    expect(cached.accepted).toBe(false);
    expect(cached.reasons.join(' ')).toMatch(/C1/);
  });

  it('propagates an inline C2 rejection exactly', () => {
    const capture = solveCaptured();
    const corrupt = cloneSystem(capture.systems[0] as CapturedNativeFullQxxSystem);
    const k = queryIndex(corrupt, 0, 1);
    corrupt.result.covariance[k] = (corrupt.result.covariance[k] ?? 0) + 1;
    const cached = expectExactMatch([corrupt], inlineFor([corrupt]), false, corrupt.parameterCount);
    expect(cached.accepted).toBe(false);
    expect(cached.reasons.join(' ')).toMatch(/C2/);
  });

  it('propagates an isolated inline C3-physical rejection exactly', () => {
    const capture = solveCaptured();
    const base = capture.systems[0] as CapturedNativeFullQxxSystem;
    const n = base.parameterCount;
    const bounded = buildBoundedVerificationQueries(n, undefined, NATIVE_FULL_QXX_MAX_PARAMS);
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
    const cached = expectExactMatch([corrupt], inlineFor([corrupt]), false, n);
    expect(cached.accepted).toBe(false);
    expect(cached.reasons.join(' ')).toMatch(/C3-physical/);
    expect(cached.reasons.join(' ')).not.toMatch(/C1:|C2 column/);
  });

  it('matches legacy on parameter-count mismatch', () => {
    const capture = solveCaptured();
    const systems = [...capture.systems];
    const n = systems[0]?.parameterCount ?? 0;
    const cached = expectExactMatch(systems, inlineFor(systems), false, n + 1);
    expect(cached.accepted).toBe(false);
    expect(cached.reasons.join(' ')).toMatch(/dimension\/provenance mismatch/);
  });

  it('matches legacy on malformed timing metadata', () => {
    const capture = solveCaptured();
    const corrupt = cloneSystem(capture.systems[0] as CapturedNativeFullQxxSystem);
    const timings = corrupt.result.timings;
    if (timings == null) throw new Error('corpus system lacks timings');
    corrupt.result.timings = { ...timings, solveMs: -1 };
    const cached = expectExactMatch([corrupt], inlineFor([corrupt]), false, corrupt.parameterCount);
    expect(cached.accepted).toBe(false);
    expect(cached.reasons.join(' ')).toMatch(/timing metadata/);
  });

  it('matches legacy on non-finite native covariance', () => {
    const capture = solveCaptured();
    const corrupt = cloneSystem(capture.systems[0] as CapturedNativeFullQxxSystem);
    corrupt.result.covariance[5] = Number.NaN;
    const cached = expectExactMatch([corrupt], inlineFor([corrupt]), false, corrupt.parameterCount);
    expect(cached.accepted).toBe(false);
    expect(cached.reasons.join(' ')).toMatch(/non-finite/);
  });

  it('matches legacy on query-coverage mismatch', () => {
    const capture = solveCaptured();
    const corrupt = cloneSystem(capture.systems[0] as CapturedNativeFullQxxSystem);
    corrupt.queryRows = corrupt.queryRows.slice(0, corrupt.queryRows.length - 1);
    corrupt.queryColumns = corrupt.queryColumns.slice(0, corrupt.queryColumns.length - 1);
    const cached = expectExactMatch([corrupt], inlineFor([corrupt]), false, corrupt.parameterCount);
    expect(cached.accepted).toBe(false);
    expect(cached.reasons.join(' ')).toMatch(/all-entry/);
  });

  it('matches legacy on damping rejection', () => {
    const capture = solveCaptured();
    const corrupt = cloneSystem(capture.systems[0] as CapturedNativeFullQxxSystem);
    corrupt.result.damping = 1e-9;
    const cached = expectExactMatch([corrupt], inlineFor([corrupt]), false, corrupt.parameterCount);
    expect(cached.accepted).toBe(false);
    expect(cached.reasons.join(' ')).toMatch(/damping/);
  });

  it('matches legacy on a corrupted covariance value', () => {
    const capture = solveCaptured();
    const corrupt = cloneSystem(capture.systems[0] as CapturedNativeFullQxxSystem);
    const last = corrupt.result.covariance.length - 1;
    corrupt.result.covariance[last] = (corrupt.result.covariance[last] ?? 0) + 0.25;
    const cached = expectExactMatch([corrupt], inlineFor([corrupt]), false, corrupt.parameterCount);
    expect(cached.accepted).toBe(false);
  });

  it('fails closed on missing or partial inline evidence', () => {
    const capture = solveCaptured();
    const systems = [...capture.systems];
    const n = systems[0]?.parameterCount ?? 0;
    // Legacy accepts the systems; the finalizer must reject without evidence.
    expect(verifyNativeFullQxxSystems(systems, false, n).accepted).toBe(true);
    const missing = finalizeNativeFullQxxVerification(systems, [], false, n);
    expect(missing.accepted).toBe(false);
    expect(missing.reasons.join(' ')).toMatch(/inline evidence count 0 != captured 1/);

    const pair = [systems[0] as CapturedNativeFullQxxSystem, cloneSystem(systems[0] as CapturedNativeFullQxxSystem)];
    const partial = finalizeNativeFullQxxVerification(pair, inlineFor([pair[0] as CapturedNativeFullQxxSystem]), false, n);
    expect(partial.accepted).toBe(false);
    expect(partial.reasons.join(' ')).toMatch(/inline evidence count 1 != captured 2/);
  });

  it('fails closed on tampered inline metadata', () => {
    const capture = solveCaptured();
    const systems = [...capture.systems];
    const n = systems[0]?.parameterCount ?? 0;
    const [valid] = inlineFor(systems);
    expect(valid?.accepted).toBe(true);

    const rejectedWithoutReasons: NativeFullQxxVerification = {
      ...(valid as NativeFullQxxVerification),
      accepted: false,
      reasons: [],
    };
    const malformed = finalizeNativeFullQxxVerification(systems, [rejectedWithoutReasons], false, n);
    expect(malformed.accepted).toBe(false);
    expect(malformed.reasons.join(' ')).toMatch(/metadata malformed/);

    const nonFiniteMax: NativeFullQxxVerification = {
      ...(valid as NativeFullQxxVerification),
      maxC1Diff: Number.NaN,
    };
    const unprovable = finalizeNativeFullQxxVerification(systems, [nonFiniteMax], false, n);
    expect(unprovable.accepted).toBe(false);
    expect(unprovable.reasons.join(' ')).toMatch(/provenance unprovable/);
  });
});

describe('Phase 10L production route uses cached evidence', () => {
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

  it('accepts the native route via the finalizer with no second oracle pass', async () => {
    const bundle: SparseAutoRouteBundle = {
      sparseCorrectionSolver: countingCorrectionSolver(),
      sparseRowProductsSolver: countingRowProductsSolver(),
      sparseSelectedCovarianceSolver: countingCovarianceSolver(),
    };
    const attempt = await runWithNativeFullQxxAutoRoute(request3d(), undefined, {
      runSession: (request, onProgress, runtime) =>
        runAdjustmentSession(request, onProgress, runtime),
      loadBundle: async () => bundle,
    });
    expect(attempt.route).toBe('native-full-qxx');
    expect(attempt.outcome.result.success).toBe(true);
    expect(attempt.verification?.accepted).toBe(true);
    expect(attempt.verification?.oracledSystemCount).toBeGreaterThan(0);
  });
});
