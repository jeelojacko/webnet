/**
 * Phase 7B.5 legacy all-pairs precision compatibility (Option B).
 *
 * Bounded batch: explicit demand policy, deterministic all-station query
 * planning without dense Qxx, identical TS formulas/order/undefined/default
 * behavior, and Option A versus Option B demand evidence. No production
 * routing, tolerance, or baseline changes.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { LSAEngine } from '../src/engine/adjust';
import { accumulateNormalEquationsFromSparseRows, zeros } from '../src/engine/matrix';
import { invertNormalMatrixForStats } from '../src/engine/adjustNormalEquationHelpers';
import type { SparseMatrixRows } from '../src/engine/matrix';
import type {
  SparseSelectedCovarianceInput,
  SparseSelectedCovarianceResult,
  SparseSelectedCovarianceSolver,
} from '../src/engine/numericalBackend';
import { buildCovarianceQueryPlan } from '../src/engine/covarianceQueryPlan';
import {
  PHASE7B_COVARIANCE_DEMAND_POLICY,
  PHASE7B_PRECISION_POLICY,
  describePhase7b5Coverage,
  describePhase7bCoverage,
} from '../src/engine/phase7bPrecisionPolicy';
import { comparePhase7bCompatDemand } from '../src/engine/phase7bPrecisionCompat';
import { buildPhase7bEnuSmallInput } from '../src/engine/phase7bEnuFixtures';
import {
  createSelectedCovarianceStore,
  readSelectedCovariance,
} from '../src/engine/selectedCovarianceStore';
import type { Observation } from '../src/types';

/** Dense reference solver: inverts N densely, answers any query subset exactly. */
const denseReferenceSolver = (): SparseSelectedCovarianceSolver & {
  seen: SparseSelectedCovarianceInput[];
} => {
  const seen: SparseSelectedCovarianceInput[] = [];
  return {
    seen,
    querySelected(input: SparseSelectedCovarianceInput): SparseSelectedCovarianceResult {
      seen.push(input);
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
  };
};

const loadCombinedInput = (): string =>
  fs.readFileSync(path.join(process.cwd(), 'public/examples/ts_triangulation_trilateration_2d.dat'), 'utf-8');

const assertClose = (actual: unknown, expected: unknown, label: string): void => {
  if (typeof actual === 'number' && typeof expected === 'number') {
    if (Object.is(actual, expected)) return;
    expect(Math.abs(actual - expected), label).toBeLessThan(
      1e-9 * Math.max(1, Math.abs(actual), Math.abs(expected)),
    );
    return;
  }
  if (actual === undefined && expected === undefined) return;
  if (Array.isArray(actual) && Array.isArray(expected)) {
    expect(actual.length, label).toBe(expected.length);
    actual.forEach((value, index) => assertClose(value, expected[index], `${label}[${index}]`));
    return;
  }
  if (actual && expected && typeof actual === 'object' && typeof expected === 'object') {
    const keys = new Set([...Object.keys(actual), ...Object.keys(expected)]);
    keys.forEach((key) => assertClose(
      (actual as Record<string, unknown>)[key],
      (expected as Record<string, unknown>)[key],
      `${label}.${key}`,
    ));
    return;
  }
  expect(actual, label).toEqual(expected);
};

describe('phase 7B.5 explicit demand policy', () => {
  it('distinguishes selected-network, compat, and dense contracts', () => {
    expect(PHASE7B_COVARIANCE_DEMAND_POLICY['selected-network'].legacyAllPairsProduced).toBe(false);
    expect(PHASE7B_COVARIANCE_DEMAND_POLICY['selected-network'].denseQxxAllocated).toBe(false);
    expect(PHASE7B_COVARIANCE_DEMAND_POLICY['legacy-all-pairs-compat'].legacyAllPairsProduced).toBe(true);
    expect(PHASE7B_COVARIANCE_DEMAND_POLICY['legacy-all-pairs-compat'].denseQxxAllocated).toBe(false);
    expect(PHASE7B_COVARIANCE_DEMAND_POLICY['dense-all-entry'].legacyAllPairsProduced).toBe(true);
    expect(PHASE7B_COVARIANCE_DEMAND_POLICY['dense-all-entry'].denseQxxAllocated).toBe(true);
  });

  it('leaves Phase 7B tolerances and coverage untouched', () => {
    expect(PHASE7B_PRECISION_POLICY.shadowToleranceM).toBe(1e-6);
    expect(PHASE7B_PRECISION_POLICY.conditionThreshold).toBe(1e12);
    expect(describePhase7bCoverage().fixtureKinds).toEqual([
      'full-enu-small-grid',
      'full-enu-scaling-chain-grid',
    ]);
    const compat = describePhase7b5Coverage();
    expect(compat.demandKinds).toEqual(['selected-network', 'legacy-all-pairs-compat', 'dense-all-entry']);
    expect(compat.fixtureKinds.length).toBeGreaterThan(describePhase7bCoverage().fixtureKinds.length);
    expect(compat.compatNotes.length).toBeGreaterThan(0);
  });
});

describe('phase 7B.5 deterministic all-station query planning', () => {
  it('is off by default, preserving selected-network demand', () => {
    const options = {
      paramIndex: { A: { x: 0, y: 1 }, B: { x: 2, y: 3 } },
      unknowns: ['A', 'B'],
      stationParamCount: 4,
      includeHeight: false,
    };
    const selected = buildCovarianceQueryPlan({ ...options });
    const compat = buildCovarianceQueryPlan({ ...options, includeAllStationPairs: true });
    expect(selected.allStationPairs).toEqual([]);
    expect(selected.queries).toHaveLength(8);
    expect(compat.allStationPairs).toEqual([{ from: 'A', to: 'B' }]);
    // Station blocks (8) plus one 2x2 cross block (4).
    expect(compat.queries).toHaveLength(12);
    expect(buildCovarianceQueryPlan({ ...options, includeAllStationPairs: true }).queries).toEqual(
      compat.queries,
    );
  });

  it('enumerates C(unknowns,2) in unknowns order and dedupes connected pairs', () => {
    const plan = buildCovarianceQueryPlan({
      paramIndex: { A: { x: 0, y: 1 }, B: { x: 2, y: 3 }, C: { x: 4, y: 5 } },
      unknowns: ['A', 'B', 'C'],
      stationParamCount: 6,
      includeHeight: false,
      connectedPairs: [{ from: 'A', to: 'B' }],
      includeAllStationPairs: true,
    });
    expect(plan.allStationPairs).toEqual([
      { from: 'A', to: 'B' },
      { from: 'A', to: 'C' },
      { from: 'B', to: 'C' },
    ]);
    // 3 station blocks (12) + connected A-B (4) + all-pairs A-B/A-C/B-C (12).
    expect(plan.queries).toHaveLength(28);
  });

  it('skips fixed-station unknowns without queries', () => {
    const plan = buildCovarianceQueryPlan({
      paramIndex: { A: { x: 0, y: 1 } },
      unknowns: ['A', 'FIXED'],
      stationParamCount: 2,
      includeHeight: false,
      includeAllStationPairs: true,
    });
    expect(plan.allStationPairs).toEqual([{ from: 'A', to: 'FIXED' }]);
    // Only station block A (4); the fixed endpoint contributes no indices.
    expect(plan.queries).toHaveLength(4);
    expect(plan.requiredColumns).toEqual([0, 1]);
  });

  it('emits 3x3 blocks with height and stays out of orientation range', () => {
    const plan = buildCovarianceQueryPlan({
      paramIndex: { A: { x: 0, y: 1, h: 2 }, B: { x: 3, y: 4, h: 5 } },
      unknowns: ['A', 'B'],
      stationParamCount: 6,
      includeHeight: true,
      includeAllStationPairs: true,
    });
    expect(plan.allStationPairs).toEqual([{ from: 'A', to: 'B' }]);
    // 2 station 3x3 blocks (26: 4 + 9 each with horizontal-first ordering)
    // plus one 3x3 cross block (9).
    expect(plan.queries).toHaveLength(13 + 13 + 9);
    expect(plan.requiredColumns).toEqual([0, 1, 2, 3, 4, 5]);
    expect(plan.queries.every((q) => q.row < 6 && q.column < 6)).toBe(true);
  });
});

describe('phase 7B.5 legacy compat precision parity (dense reference solver)', () => {
  it('matches dense station/relative/all-pairs rows on the 2D combined case', () => {
    const input = loadCombinedInput();
    const baseline = new LSAEngine({ input }).solve();
    expect(baseline.success).toBe(true);
    expect(baseline.relativePrecision?.length).toBeGreaterThan(0);
    const solver = denseReferenceSolver();
    const compat = new LSAEngine({
      input,
      sparseSelectedCovarianceSolver: solver,
      experimentalSelectedCovarianceMode: true,
      experimentalSelectedCovarianceLegacyAllPairs: true,
    }).solve();
    expect(compat.success).toBe(true);
    assertClose(compat.stationCovariances, baseline.stationCovariances, 'stations');
    assertClose(compat.relativeCovariances, baseline.relativeCovariances, 'relative');
    assertClose(compat.relativePrecision, baseline.relativePrecision, 'all-pairs');
    expect(compat.relativePrecision?.length).toBe(baseline.relativePrecision?.length);
    const queried = solver.seen[0];
    expect(queried).toBeDefined();
    if (queried) {
      // Option B never allocates dense Qxx: queries stay below n^2.
      expect(queried.queryRows.length).toBeLessThan(
        queried.parameterCount * queried.parameterCount,
      );
    }
  });

  it('matches arbitrary REL/PTOL pairs including non-connected stations', () => {
    const input = `${loadCombinedInput()}\n.RELATIVE 2->4\n.PTOLERANCE 2->5\n`;
    const baseline = new LSAEngine({ input }).solve();
    expect(baseline.success).toBe(true);
    const solver = denseReferenceSolver();
    const compat = new LSAEngine({
      input,
      sparseSelectedCovarianceSolver: solver,
      experimentalSelectedCovarianceMode: true,
      experimentalSelectedCovarianceLegacyAllPairs: true,
    }).solve();
    expect(compat.success).toBe(true);
    assertClose(compat.relativeCovariances, baseline.relativeCovariances, 'relative');
    assertClose(compat.relativePrecision, baseline.relativePrecision, 'all-pairs');
  });

  it('matches dense rows when a REL pair references a fixed control station', () => {
    const input = `${loadCombinedInput()}\n.RELATIVE 1->4\n`;
    const baseline = new LSAEngine({ input }).solve();
    expect(baseline.success).toBe(true);
    const solver = denseReferenceSolver();
    const compat = new LSAEngine({
      input,
      sparseSelectedCovarianceSolver: solver,
      experimentalSelectedCovarianceMode: true,
      experimentalSelectedCovarianceLegacyAllPairs: true,
    }).solve();
    expect(compat.success).toBe(true);
    assertClose(compat.relativeCovariances, baseline.relativeCovariances, 'relative');
    assertClose(compat.relativePrecision, baseline.relativePrecision, 'all-pairs');
  });

  it('matches dense rows with orientation unknowns (direction set) and saves versus dense n^2', () => {
    const input = `${loadCombinedInput()}\nDB 6\nDN 5 000-00-00 2.0\nDN 4 060-00-00 2.0\nDE\n`;
    const baseline = new LSAEngine({ input }).solve();
    expect(baseline.success).toBe(true);
    expect(baseline.relativePrecision?.length).toBeGreaterThan(0);
    const solver = denseReferenceSolver();
    const compat = new LSAEngine({
      input,
      sparseSelectedCovarianceSolver: solver,
      experimentalSelectedCovarianceMode: true,
      experimentalSelectedCovarianceLegacyAllPairs: true,
    }).solve();
    expect(compat.success).toBe(true);
    assertClose(compat.stationCovariances, baseline.stationCovariances, 'stations-orient');
    assertClose(compat.relativeCovariances, baseline.relativeCovariances, 'relative-orient');
    assertClose(compat.relativePrecision, baseline.relativePrecision, 'all-pairs-orient');
    const queried = solver.seen[0];
    expect(queried).toBeDefined();
    if (queried) {
      // Orientation unknowns live outside the station range, so exact
      // station-only compat demand stays strictly below dense n^2.
      expect(queried.queryRows.length).toBeLessThan(
        queried.parameterCount * queried.parameterCount,
      );
    }
  });

  it('keeps selected-network omission unchanged when compat is not requested', () => {
    const input = loadCombinedInput();
    const solver = denseReferenceSolver();
    const selected = new LSAEngine({
      input,
      sparseSelectedCovarianceSolver: solver,
      experimentalSelectedCovarianceMode: true,
    }).solve();
    expect(selected.success).toBe(true);
    expect(selected.relativePrecision).toEqual([]);
    const queried = solver.seen[0];
    expect(queried).toBeDefined();
  });

  it('matches dense 3D height blocks on the full-ENU small fixture', () => {
    const input = buildPhase7bEnuSmallInput();
    const baseline = new LSAEngine({ input }).solve();
    expect(baseline.success).toBe(true);
    expect(baseline.converged).toBe(true);
    const solver = denseReferenceSolver();
    const compat = new LSAEngine({
      input,
      sparseSelectedCovarianceSolver: solver,
      experimentalSelectedCovarianceMode: true,
      experimentalSelectedCovarianceLegacyAllPairs: true,
    }).solve();
    expect(compat.success).toBe(true);
    assertClose(compat.stationCovariances, baseline.stationCovariances, 'stations-3d');
    assertClose(compat.relativeCovariances, baseline.relativeCovariances, 'relative-3d');
    assertClose(compat.relativePrecision, baseline.relativePrecision, 'all-pairs-3d');
  });

  it('propagates the compat flag into nested solves', () => {
    const input = loadCombinedInput();
    const seen: unknown[] = [];
    const originalSolve = LSAEngine.prototype.solve;
    // eslint-disable-next-line no-unused-vars
    LSAEngine.prototype.solve = function (this: LSAEngine) {
      seen.push(
        (this as unknown as Record<string, unknown>)['experimentalSelectedCovarianceLegacyAllPairs'],
      );
      return originalSolve.apply(this);
    };
    try {
      const solver = denseReferenceSolver();
      const result = new LSAEngine({
        input,
        parseOptions: { runMode: 'blunder-detect' },
        sparseSelectedCovarianceSolver: solver,
        experimentalSelectedCovarianceMode: true,
        experimentalSelectedCovarianceLegacyAllPairs: true,
      }).solve();
      expect(result.success).toBe(true);
      expect(result.relativePrecision?.length).toBeGreaterThan(0);
    } finally {
      LSAEngine.prototype.solve = originalSolve;
    }
    expect(seen.length).toBeGreaterThanOrEqual(2);
    seen.forEach((flag) => expect(flag).toBe(true));
  });
});

describe('phase 7B.5 orientation-unknown demand and Option A versus B', () => {
  it('keeps compat demand below dense n^2 when orientation unknowns exist', () => {
    // Synthetic station range of 4 plus one orientation unknown (index 4).
    const report = comparePhase7bCompatDemand({
      paramIndex: { A: { x: 0, y: 1 }, B: { x: 2, y: 3 } },
      unknowns: ['A', 'B'],
      includeHeight: false,
      parameterCount: 5,
    });
    expect(report.stationParamCount).toBe(4);
    expect(report.denseAllEntryQueries).toBe(25);
    // Deduped symmetric station demand: 4x5/2 = 10 unique entries.
    expect(report.compatSelectedQueries).toBeLessThan(report.denseAllEntryQueries);
    expect(report.selectedNetworkQueries).toBeLessThanOrEqual(report.compatSelectedQueries);
    expect(report.compatFractionOfDense).toBeLessThan(1);
  });

  it('fails closed on unqueried entries while fixed indices read as zero', () => {
    const store = createSelectedCovarianceStore(
      4,
      [{ row: 0, column: 0 }, { row: 0, column: 1 }],
      [1.5, 0.25],
      { legacyAllPairsCovered: true },
    );
    expect(store.legacyAllPairsCovered).toBe(true);
    expect(readSelectedCovariance(store, 0, 0)).toBe(1.5);
    expect(readSelectedCovariance(store, null, 0)).toBe(0);
    expect(() => readSelectedCovariance(store, 2, 3)).toThrow(/not queried/);
    const plain = createSelectedCovarianceStore(4, [{ row: 0, column: 0 }], [1]);
    expect(plain.legacyAllPairsCovered).toBeUndefined();
  });

  it('benchmarks Option A versus B on the 2D combined case', () => {
    const input = loadCombinedInput();
    const baseline = new LSAEngine({ input }).solve();
    expect(baseline.success).toBe(true);
    const solver = denseReferenceSolver();
    const compat = new LSAEngine({
      input,
      sparseSelectedCovarianceSolver: solver,
      experimentalSelectedCovarianceMode: true,
      experimentalSelectedCovarianceLegacyAllPairs: true,
    }).solve();
    expect(compat.success).toBe(true);
    const queried = solver.seen[0];
    expect(queried).toBeDefined();
    if (queried) {
      const report = comparePhase7bCompatDemand({
        paramIndex: { A: { x: 0, y: 1 }, B: { x: 2, y: 3 } },
        unknowns: ['A', 'B'],
        includeHeight: false,
        parameterCount: queried.parameterCount,
      });
      // Synthetic demand shape is illustrative; the solved demand is exact.
      expect(report.compatSelectedQueries).toBeLessThan(report.denseAllEntryQueries);
      const solvedDense = queried.parameterCount * queried.parameterCount;
      expect(queried.queryRows.length).toBeLessThan(solvedDense);
      // Exact solved demand numbers are reported for the parity log.
      expect(solvedDense).toBeGreaterThan(0);
      expect(queried.queryRows.length).toBeGreaterThan(0);
    }
  });

  it('summarizes observation stats identically under compat', () => {
    const input = loadCombinedInput();
    const baseline = new LSAEngine({ input }).solve();
    const solver = denseReferenceSolver();
    const compat = new LSAEngine({
      input,
      sparseSelectedCovarianceSolver: solver,
      experimentalSelectedCovarianceMode: true,
      experimentalSelectedCovarianceLegacyAllPairs: true,
    }).solve();
    const summarize = (observations: Observation[]): unknown =>
      observations.map((obs) => ({
        id: obs.id,
        stdRes: obs.stdRes,
        redundancy: obs.redundancy,
        mdb: obs.mdb,
      }));
    assertClose(summarize(compat.observations), summarize(baseline.observations), 'stats');
  });
});
