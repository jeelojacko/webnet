/**
 * Phase 10E agent-tier contract: automatic production Qxx reuse.
 *
 * Fast unit-scope checks (no WASM, no repeated campaigns): production
 * default automatically reuses the final dense Qxx on the eligible
 * cohort (converged 3D dense TypeScript solves), the test-only
 * force-legacy oracle reproduces the legacy path bit-identically, probe
 * call counts prove the skipped accumulation/inversion, and every
 * inadmissible shape (2D, non-converged, robust, ...) fails closed.
 */
import { describe, expect, it } from 'vitest';

import { LSAEngine } from '../src/engine/adjust';
import { invertNormalMatrixForStats } from '../src/engine/adjustNormalEquationHelpers';
import { accumulateNormalEquationsFromSparseRows, zeros } from '../src/engine/matrix';
import type { SparseMatrixRows } from '../src/engine/matrix';
import type {
  SparseSelectedCovarianceInput,
  SparseSelectedCovarianceResult,
  SparseSelectedCovarianceSolver,
} from '../src/engine/numericalBackend';
import { buildPhase6LargeBenchmarkCases } from '../src/engine/phase6BenchmarkNetworks';
import { decideStatisticsQxxReuse } from '../src/engine/statisticsQxxReuse';
import type { QxxReuseProbeEvent } from '../src/engine/qxxReuseEvidence';

const cases = buildPhase6LargeBenchmarkCases(false);
const fixture3d = cases.find((item) => item.id === 'gps-3d-cov-08');
if (!fixture3d) throw new Error('Missing genuine 3D fixture gps-3d-cov-08.');
const fixture2d = cases.find((item) => item.id === 'gps-2d-cov-08');
if (!fixture2d) throw new Error('Missing 2D fixture gps-2d-cov-08.');

const stripVolatile = (result: ReturnType<LSAEngine['solve']>) => {
  const logs = result.logs.filter((line) => !line.startsWith('Solve timing (ms):'));
  return JSON.stringify({
    success: result.success,
    converged: result.converged,
    iterations: result.iterations,
    dof: result.dof,
    seuw: result.seuw,
    stations: result.stations,
    observations: result.observations,
    condition: result.condition,
    logs,
  });
};

const solveWithProbe = (input: string, forceLegacy: boolean | undefined) => {
  const events: QxxReuseProbeEvent[] = [];
  const result = new LSAEngine({
    input,
    forceLegacyStatisticsQxx: forceLegacy,
    qxxReuseProbe: (event) => {
      events.push(event);
    },
  }).solve();
  return { result, events };
};

const maxAbsDiff = (a: number[][], b: number[][]): number => {
  let max = 0;
  for (let i = 0; i < a.length; i += 1) {
    for (let j = 0; j < a[i].length; j += 1) {
      max = Math.max(max, Math.abs(a[i][j] - b[i][j]));
    }
  }
  return max;
};

/** Dense reference selected-covariance solver: exact inverse, no selected store. */
const denseReferenceSelectedCovariance = (): SparseSelectedCovarianceSolver => ({
  querySelected(input: SparseSelectedCovarianceInput): SparseSelectedCovarianceResult {
    const eqCount = input.observationEquationCount;
    const paramCount = input.parameterCount;
    const sparseRows: SparseMatrixRows = Array.from({ length: eqCount }, () => []);
    for (let row = 0; row < eqCount; row += 1) {
      const start = input.design.rowOffsets[row] ?? 0;
      const end = input.design.rowOffsets[row + 1] ?? 0;
      for (let k = start; k < end; k += 1) {
        (sparseRows[row] as { index: number; value: number }[]).push({
          index: input.design.columns[k] ?? 0,
          value: input.design.values[k] ?? 0,
        });
      }
    }
    const weights = Array.from({ length: eqCount }, () => new Array<number>(eqCount).fill(0));
    for (let k = 0; k < input.weights.values.length; k += 1) {
      const row = input.weights.rows[k] ?? 0;
      const column = input.weights.columns[k] ?? 0;
      const value = input.weights.values[k] ?? 0;
      (weights[row] as number[])[column] = value;
      (weights[column] as number[])[row] = value;
    }
    const { normal } = accumulateNormalEquationsFromSparseRows(
      sparseRows,
      zeros(eqCount, 1),
      weights,
      paramCount,
    );
    const inverse = invertNormalMatrixForStats(normal, () => undefined);
    const covariance = new Float64Array(input.queryRows.length);
    for (let k = 0; k < input.queryRows.length; k += 1) {
      covariance[k] = inverse[input.queryRows[k] ?? 0]?.[input.queryColumns[k] ?? 0] ?? 0;
    }
    return { covariance, normalNnz: 0, factorNnz: 0, damping: 0, dampingAttempts: 0 };
  },
});

describe('Phase 10E production Qxx reuse contract', () => {
  it('automatically reuses the final dense Qxx on converged 3D with full parity', () => {
    const { result, events } = solveWithProbe(fixture3d.input, undefined);
    expect(result.success).toBe(true);
    expect(result.converged).toBe(true);

    const oracle = solveWithProbe(fixture3d.input, true);
    expect(stripVolatile(result)).toBe(stripVolatile(oracle.result));

    const final = events.find((e) => e.stage === 'final-covariance');
    const stats = events.find((e) => e.stage === 'statistics');
    expect(final?.reused).toBe(false);
    expect(final?.normalAccumulations).toBe(1);
    expect(final?.inversions).toBe(1);
    expect(stats?.reused).toBe(true);
    expect(stats?.reason).toBe('reused-final-dense-qxx');
    expect(stats?.normalAccumulations).toBe(0);
    expect(stats?.inversions).toBe(0);
    expect(stats?.normalDimension).toBeNull();

    // Cross-run comparison: legacy oracle statistics normal and Qxx equal
    // the recovered final ones (deterministic solves).
    const legacyFinal = oracle.events.find((e) => e.stage === 'final-covariance');
    const legacyStats = oracle.events.find((e) => e.stage === 'statistics');
    expect(legacyStats?.reused).toBe(false);
    expect(legacyStats?.reason).toBe('force-legacy-oracle');
    expect(legacyStats?.normalAccumulations).toBe(1);
    expect(legacyStats?.inversions).toBe(1);
    expect(legacyFinal?.normalDimension).toBe(legacyStats?.normalDimension);
    expect(maxAbsDiff(legacyFinal!.normal!, legacyStats!.normal!)).toBe(0);
    expect(maxAbsDiff(legacyFinal!.qxx!, legacyStats!.qxx!)).toBe(0);
    expect(maxAbsDiff(legacyFinal!.qxx!, stats!.qxx!)).toBe(0);
  });

  it('keeps 2D solves on the legacy path with full parity', () => {
    const { result, events } = solveWithProbe(fixture2d.input, undefined);
    expect(result.success).toBe(true);
    expect(result.converged).toBe(true);
    const oracle = solveWithProbe(fixture2d.input, true);
    expect(stripVolatile(result)).toBe(stripVolatile(oracle.result));
    const stats = events.find((e) => e.stage === 'statistics');
    expect(stats?.reused).toBe(false);
    expect(stats?.reason).toBe('two-dimensional-legacy');
    expect(stats?.inversions).toBe(1);
  });

  it('fails closed on robust Huber with full parity', () => {
    const huberInput = `${fixture3d.input}\n.ROBUST HUBER 1.5\n`;
    const { result, events } = solveWithProbe(huberInput, undefined);
    const oracle = solveWithProbe(huberInput, true);
    expect(stripVolatile(result)).toBe(stripVolatile(oracle.result));
    const stats = events.find((e) => e.stage === 'statistics');
    expect(stats?.reused).toBe(false);
    expect(stats?.reason).toBe('robust-mode-inadmissible');
    expect(stats?.inversions).toBe(1);
  });

  it('reuses under TS correlation with full parity', () => {
    const tscorrInput = `${fixture3d.input}\n.TSCORR ON\n`;
    const { result, events } = solveWithProbe(tscorrInput, undefined);
    const oracle = solveWithProbe(tscorrInput, true);
    expect(result.tsCorrelationDiagnostics?.enabled).toBe(true);
    expect(stripVolatile(result)).toBe(stripVolatile(oracle.result));
    const stats = events.find((e) => e.stage === 'statistics');
    expect(stats?.reused).toBe(true);
    expect(stats?.reason).toBe('reused-final-dense-qxx');
  });

  it('rejects automatic reuse when a sparse selected solver is active even with no selected store', () => {
    const events: QxxReuseProbeEvent[] = [];
    const result = new LSAEngine({
      input: fixture3d.input,
      sparseSelectedCovarianceSolver: denseReferenceSelectedCovariance(),
      qxxReuseProbe: (event) => {
        events.push(event);
      },
    }).solve();
    expect(result.success).toBe(true);
    expect(result.converged).toBe(true);
    // Non-experimental solver mode captures a sparse-derived dense Qxx with
    // no selected store; statistics must still take the legacy path.
    const final = events.find((e) => e.stage === 'final-covariance');
    expect(final?.reason).toBe('sparse-dense-qxx-captured');
    const stats = events.find((e) => e.stage === 'statistics');
    expect(stats?.reused).toBe(false);
    expect(stats?.reason).toBe('sparse-selected-solver-active');
    expect(stats?.inversions).toBe(1);
  });

  it('rejects every inadmissible shape in the eligibility gate', () => {
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
      hasSparseSelectedCovarianceSolver: false,
      sparseRowProductsAvailable: false,
      numParams: 2,
      augmentedRowCount: 0,
      finalCovarianceDamping: 0,
    };
    expect(decideStatisticsQxxReuse(base).eligible).toBe(true);
    expect(decideStatisticsQxxReuse({ ...base, forceLegacy: true }).reason).toBe(
      'force-legacy-oracle',
    );
    expect(decideStatisticsQxxReuse({ ...base, converged: false }).reason).toBe(
      'not-converged',
    );
    expect(decideStatisticsQxxReuse({ ...base, is2D: true }).reason).toBe(
      'two-dimensional-legacy',
    );
    expect(decideStatisticsQxxReuse({ ...base, preanalysisMode: true }).reason).toBe(
      'preanalysis-mode',
    );
    expect(decideStatisticsQxxReuse({ ...base, finalQxx: null }).reason).toBe(
      'missing-final-qxx',
    );
    expect(decideStatisticsQxxReuse({ ...base, hasSelectedStore: true }).reason).toBe(
      'non-dense-selected-store',
    );
    expect(
      decideStatisticsQxxReuse({ ...base, hasSparseSelectedCovarianceSolver: true }).reason,
    ).toBe('sparse-selected-solver-active');
    expect(
      decideStatisticsQxxReuse({ ...base, hasSparseSelectedCovarianceSolver: true })
        .eligible,
    ).toBe(false);
    // Test-only oracle keeps precedence over every production rejection.
    expect(
      decideStatisticsQxxReuse({
        ...base,
        forceLegacy: true,
        hasSparseSelectedCovarianceSolver: true,
      }).reason,
    ).toBe('force-legacy-oracle');
    expect(
      decideStatisticsQxxReuse({ ...base, sparseRowProductsAvailable: true }).reason,
    ).toBe('sparse-row-products-active');
    expect(decideStatisticsQxxReuse({ ...base, robustMode: 'huber' }).reason).toBe(
      'robust-mode-inadmissible',
    );
    expect(
      decideStatisticsQxxReuse({
        ...base,
        finalQxx: [
          [2, 0.5],
          [0.5, 1],
          [0, 0],
        ],
      }).reason,
    ).toBe('dimension-mismatch-or-non-finite');
    expect(
      decideStatisticsQxxReuse({
        ...base,
        finalQxx: [
          [2, Number.NaN],
          [0.5, 1],
        ],
      }).reason,
    ).toBe('dimension-mismatch-or-non-finite');
    expect(decideStatisticsQxxReuse({ ...base, augmentedRowCount: 2 }).reason).toBe(
      'covariance-augmentation-active',
    );
    expect(
      decideStatisticsQxxReuse({ ...base, finalCovarianceDamping: 1e-12 }).reason,
    ).toBe('damped-final-recovery');
  });
});
