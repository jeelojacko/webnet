/**
 * Phase 10D agent-tier contract: evidence-only Qxx comparison/reuse seam.
 *
 * Fast unit-scope checks (no WASM, no repeated campaigns): production
 * default stays legacy recompute, opt-in reuse is bit-identical on the
 * genuine 3D fixture, probe call counts prove the skipped
 * accumulation/inversion, and every inadmissible shape fails closed.
 */
import { describe, expect, it } from 'vitest';

import { LSAEngine } from '../src/engine/adjust';
import { buildPhase6LargeBenchmarkCases } from '../src/engine/phase6BenchmarkNetworks';
import {
  decideStatisticsQxxReuse,
  type QxxReuseProbeEvent,
} from '../src/engine/qxxReuseEvidence';

const fixture = buildPhase6LargeBenchmarkCases(false).find(
  (item) => item.id === 'gps-3d-cov-08',
);
if (!fixture) throw new Error('Missing genuine 3D fixture gps-3d-cov-08.');

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

const solveWithProbe = (input: string, reuse: boolean | undefined) => {
  const events: QxxReuseProbeEvent[] = [];
  const result = new LSAEngine({
    input,
    reuseFinalCovarianceInStatistics: reuse,
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

describe('Phase 10D Qxx comparison/reuse contract', () => {
  it('keeps the legacy recompute path by default', () => {
    const reference = new LSAEngine({ input: fixture.input }).solve();
    const { result, events } = solveWithProbe(fixture.input, undefined);
    expect(stripVolatile(result)).toBe(stripVolatile(reference));
    expect(events.map((e) => e.stage)).toEqual(['final-covariance', 'statistics']);
    const stats = events.find((e) => e.stage === 'statistics');
    expect(stats?.reused).toBe(false);
    expect(stats?.reason).toBe('reuse-disabled');
    expect(stats?.normalAccumulations).toBe(1);
    expect(stats?.inversions).toBe(1);
    expect(stats?.normalDimension).toBe(stats?.qxxDimension);
  });

  it('reuses the final dense Qxx bit-identically and skips the second inversion', () => {
    const reference = new LSAEngine({ input: fixture.input }).solve();
    const { result, events } = solveWithProbe(fixture.input, true);
    expect(result.success).toBe(true);
    expect(result.converged).toBe(true);
    expect(stripVolatile(result)).toBe(stripVolatile(reference));

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

    // Cross-run structural/numeric comparison: legacy statistics normal
    // and Qxx equal the recovered final ones (deterministic solves).
    const { events: legacyEvents } = solveWithProbe(fixture.input, undefined);
    const legacyFinal = legacyEvents.find((e) => e.stage === 'final-covariance');
    const legacyStats = legacyEvents.find((e) => e.stage === 'statistics');
    expect(legacyFinal?.normalDimension).toBe(legacyStats?.normalDimension);
    expect(maxAbsDiff(legacyFinal!.normal!, legacyStats!.normal!)).toBe(0);
    expect(maxAbsDiff(legacyFinal!.qxx!, legacyStats!.qxx!)).toBe(0);
    expect(maxAbsDiff(legacyFinal!.qxx!, stats!.qxx!)).toBe(0);
  });

  it('fails closed on robust Huber with full parity', () => {
    const huberInput = `${fixture.input}\n.ROBUST HUBER 1.5\n`;
    const reference = new LSAEngine({ input: huberInput }).solve();
    const { result, events } = solveWithProbe(huberInput, true);
    expect(stripVolatile(result)).toBe(stripVolatile(reference));
    const stats = events.find((e) => e.stage === 'statistics');
    expect(stats?.reused).toBe(false);
    expect(stats?.reason).toBe('robust-mode-inadmissible');
    expect(stats?.inversions).toBe(1);
  });

  it('rejects every inadmissible shape in the eligibility gate', () => {
    const base = {
      reuseRequested: true,
      preanalysisMode: false,
      robustMode: 'none' as string | undefined,
      finalQxx: [
        [2, 0.5],
        [0.5, 1],
      ],
      hasSelectedStore: false,
      sparseRowProductsAvailable: false,
      numParams: 2,
      augmentedRowCount: 0,
      finalCovarianceDamping: 0,
    };
    expect(decideStatisticsQxxReuse(base).eligible).toBe(true);
    expect(decideStatisticsQxxReuse({ ...base, reuseRequested: false }).reason).toBe(
      'reuse-disabled',
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
