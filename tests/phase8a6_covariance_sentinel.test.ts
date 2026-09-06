/**
 * Phase 8A.6 packed sparse covariance sentinel units (TEST/EVIDENCE ONLY).
 *
 * Pure coverage over the test-only sentinel: packed accumulation vs a
 * naive oracle, deterministic column probes, C1 dense-selected oracle,
 * C2 inverse residual, C3 hybrid, physical validation, the unknown-count
 * cap, deterministic fault injection (diagonal/off-diagonal/sign/swap/
 * NaN/Infinity/missing/duplicate/packing) with blind-spot experiments,
 * and C1/C2/C3 timing plus all-pairs/selected scaling at 64/128 unknowns.
 * No production routing, worker, or engine behavior is touched.
 */
import { describe, expect, it } from 'vitest';

import { choleskyDecomposeWithDamping, invertSPDFromCholesky } from '../src/engine/matrixCholesky';
import {
  scaleNormalMatrix,
  unscaleNormalInverse,
} from '../src/engine/adjustNormalMatrixHelpers';
import {
  accumulatePackedNormal,
  buildAllPairsQueries,
  buildDiagonalQueries,
  evaluateSentinelC1,
  evaluateSentinelC2,
  evaluateSentinelC3,
  probeSelectedCovariance,
  validateSentinelPhysical,
  type Phase8a6PackedSystem,
} from '../src/engine/phase8a6SparseCovarianceSentinel';
import { buildSentinelFaultSuite } from '../src/engine/phase8a6SentinelFaults';

/**
 * Deterministic synthetic packed system: m = 2n equations, row 2i is the
 * unit row e_i, row 2i+1 mixes e_i with 0.5 e_{i+1 mod n}; diagonal
 * weights 1 + 0.1 i. N is SPD by construction. Optionally adds one small
 * off-diagonal weight entry between rows 0 and 1.
 */
const buildSyntheticPacked = (n: number, withOffDiagonal: boolean): Phase8a6PackedSystem => {
  const m = 2 * n;
  const rowOffsets = new Int32Array(m + 1);
  const columns: number[] = [];
  const values: number[] = [];
  for (let row = 0; row < m; row += 1) {
    const i = Math.floor(row / 2);
    const j = (i + 1) % n;
    if (row % 2 === 0) {
      columns.push(i);
      values.push(1);
    } else if (j === i) {
      columns.push(i);
      values.push(1.5);
    } else {
      columns.push(i, j);
      values.push(1, 0.5);
    }
    rowOffsets[row + 1] = columns.length;
  }
  const wRows: number[] = [];
  const wCols: number[] = [];
  const wVals: number[] = [];
  for (let row = 0; row < m; row += 1) {
    wRows.push(row);
    wCols.push(row);
    wVals.push(1 + 0.1 * row);
  }
  if (withOffDiagonal) {
    wRows.push(0);
    wCols.push(1);
    wVals.push(0.02);
  }
  // Keep packed weights upper-sorted by (row, column) for determinism.
  const order = wRows.map((_, k) => k).sort((a, b) =>
    (wRows[a]! - wRows[b]!) !== 0 ? wRows[a]! - wRows[b]! : wCols[a]! - wCols[b]!,
  );
  return {
    design: {
      rowOffsets,
      columns: Int32Array.from(columns),
      values: Float64Array.from(values),
    },
    weights: {
      rows: Int32Array.from(order.map((k) => wRows[k]!)),
      columns: Int32Array.from(order.map((k) => wCols[k]!)),
      values: Float64Array.from(order.map((k) => wVals[k]!)),
    },
    observationEquationCount: m,
    parameterCount: n,
  };
};

/** Naive dense oracle for accumulation: expands packed rows (test only). */
const naiveNormal = (system: Phase8a6PackedSystem): number[][] => {
  const n = system.parameterCount;
  const m = system.observationEquationCount;
  const rows: Array<Array<{ index: number; value: number }>> = [];
  for (let row = 0; row < m; row += 1) {
    const start = system.design.rowOffsets[row] ?? 0;
    const end = system.design.rowOffsets[row + 1] ?? start;
    const entries: Array<{ index: number; value: number }> = [];
    for (let k = start; k < end; k += 1) {
      entries.push({ index: system.design.columns[k] ?? -1, value: system.design.values[k] ?? 0 });
    }
    rows.push(entries);
  }
  const normal = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let k = 0; k < system.weights.rows.length; k += 1) {
    const r = system.weights.rows[k] ?? -1;
    const c = system.weights.columns[k] ?? -1;
    const w = system.weights.values[k] ?? 0;
    const rowR = rows[r] ?? [];
    const rowC = rows[c] ?? [];
    for (const a of rowR) {
      for (const b of rowC) {
        normal[a.index]![b.index]! += a.value * w * b.value;
        if (r !== c) normal[b.index]![a.index]! += a.value * w * b.value;
      }
    }
  }
  return normal;
};

const denseDiagonalReference = (normal: number[][]): number[] => {
  const scaled = scaleNormalMatrix(normal);
  const factorization = choleskyDecomposeWithDamping(scaled.scaled);
  expect(factorization.damping).toBe(0);
  const inverse = unscaleNormalInverse(invertSPDFromCholesky(factorization.factor), scaled.scale);
  return inverse.map((row, i) => row[i] ?? Number.NaN);
};

describe('phase 8A.6 packed sparse covariance sentinel', () => {
  it('accumulates N from packed inputs with no dense P and probes selected columns', () => {
    const system = buildSyntheticPacked(6, true);
    const normal = accumulatePackedNormal(system);
    const expected = naiveNormal(system);
    for (let i = 0; i < 6; i += 1) {
      for (let j = 0; j < 6; j += 1) {
        expect(normal[i]?.[j]).toBeCloseTo(expected[i]?.[j] ?? 0, 12);
      }
    }
    const { rows, columns } = buildDiagonalQueries(6);
    const probe = probeSelectedCovariance(normal, rows, columns);
    expect(probe.damped).toBe(false);
    expect(probe.probedColumns).toEqual([0, 1, 2, 3, 4, 5]);
    const reference = denseDiagonalReference(normal);
    const c1 = evaluateSentinelC1(probe.values, reference);
    expect(c1.pass).toBe(true);
    // C2 judges captured values and needs full-column coverage, so it runs
    // on all-pairs values (the TS probe stands in for native values here).
    const allPairs = buildAllPairsQueries(6);
    const fullProbe = probeSelectedCovariance(normal, allPairs.rows, allPairs.columns);
    const c2 = evaluateSentinelC2(normal, allPairs.rows, allPairs.columns, fullProbe.values);
    expect(c2.pass).toBe(true);
    expect(c2.perColumnResidual.length).toBe(6);
    const c3 = evaluateSentinelC3({ c1, c2 });
    expect(c3.pass).toBe(true);
    const physical = validateSentinelPhysical({ queryRows: rows, queryColumns: columns, values: probe.values });
    expect(physical.valid).toBe(true);
  });

  it('agrees with the dense oracle on all-pairs queries and stays symmetric', () => {
    const system = buildSyntheticPacked(5, false);
    const normal = accumulatePackedNormal(system);
    const { rows, columns } = buildAllPairsQueries(5);
    const probe = probeSelectedCovariance(normal, rows, columns);
    expect(probe.damped).toBe(false);
    const scaled = scaleNormalMatrix(normal);
    const factorization = choleskyDecomposeWithDamping(scaled.scaled);
    const inverse = unscaleNormalInverse(invertSPDFromCholesky(factorization.factor), scaled.scale);
    const reference = Array.from(
      { length: rows.length },
      (_, k) => inverse[rows[k] ?? -1]?.[columns[k] ?? -1] ?? Number.NaN,
    );
    const c1 = evaluateSentinelC1(probe.values, reference);
    expect(c1.pass).toBe(true);
    const physical = validateSentinelPhysical({ queryRows: rows, queryColumns: columns, values: probe.values });
    expect(physical.valid).toBe(true);
  });

  it('rejects physical violations: non-positive diagonal and asymmetry', () => {
    const n = 3;
    const { rows, columns } = buildDiagonalQueries(n);
    const bad = validateSentinelPhysical({
      queryRows: rows,
      queryColumns: columns,
      values: [1, -2, 3],
    });
    expect(bad.valid).toBe(false);
    const asymRows = Int32Array.from([0, 1]);
    const asymCols = Int32Array.from([1, 0]);
    const asym = validateSentinelPhysical({
      queryRows: asymRows,
      queryColumns: asymCols,
      values: [0.5, 0.9],
    });
    expect(asym.valid).toBe(false);
  });

  it('fails closed above the 128-unknown cap and accepts exactly 128', () => {
    const ok = buildSyntheticPacked(128, false);
    const normal = accumulatePackedNormal(ok);
    const { rows, columns } = buildDiagonalQueries(128);
    const probe = probeSelectedCovariance(normal, rows, columns);
    expect(probe.damped).toBe(false);
    expect(probe.probedColumns.length).toBe(128);
    const over: Phase8a6PackedSystem = {
      ...ok,
      parameterCount: 129,
    };
    expect(() => accumulatePackedNormal(over)).toThrow();
    expect(() => probeSelectedCovariance(
      Array.from({ length: 129 }, () => new Array(129).fill(0)),
      Int32Array.from([0]),
      Int32Array.from([0]),
    )).toThrow();
  });

  it('detects deterministic corruption and documents blind spots', () => {
    const system = buildSyntheticPacked(6, true);
    const normal = accumulatePackedNormal(system);
    const baseQueries = buildDiagonalQueries(6);
    const baseProbe = probeSelectedCovariance(normal, baseQueries.rows, baseQueries.columns);
    const baseReference = denseDiagonalReference(normal);
    expect(evaluateSentinelC1(baseProbe.values, baseReference).pass).toBe(true);

    const suite = buildSentinelFaultSuite({
      system,
      queryRows: baseQueries.rows,
      queryColumns: baseQueries.columns,
    });
    const labels = suite.map((fault) => fault.label);
    expect(labels).toContain('diagonal-x4');
    expect(labels).toContain('off-diagonal-x3');
    expect(labels).toContain('off-diagonal-sign-flip');
    expect(labels).toContain('swap-first-two-queries');
    expect(labels).toContain('nan-design-value');
    expect(labels).toContain('infinity-weight-value');
    expect(labels).toContain('missing-first-query');
    expect(labels).toContain('duplicate-first-query');
    expect(labels).toContain('packing-truncated-row-offsets');
    expect(labels).toContain('blind-spot-transposed-queries');
    expect(labels).toContain('blind-spot-sub-tolerance-diagonal');

    const detected: string[] = [];
    const blind: string[] = [];
    for (const fault of suite) {
      let threw = false;
      let c1Pass = false;
      let c2Pass = false;
      try {
        const faultNormal = accumulatePackedNormal(fault.system);
        const faultProbe = probeSelectedCovariance(faultNormal, fault.queryRows, fault.queryColumns);
        if (faultProbe.damped) {
          c1Pass = false;
          c2Pass = false;
        } else {
          // Compare against the PLANNED reference (base queries in base
          // order): the sentinel judges returned values against the query
          // plan, so length/shape/order faults trip the gate here. Value
          // faults trip the tolerance gate. Comparing against the fault's
          // own shifted queries would hide plan deviations by construction.
          c1Pass = evaluateSentinelC1(faultProbe.values, baseReference).pass;
          // C2 judges the fault's own values against the fault's own normal:
          // system-level faults are self-consistent (C2 passes; C1 is the
          // system-fidelity check), while shape faults fail C2 closed.
          c2Pass = evaluateSentinelC2(
            faultNormal,
            fault.queryRows,
            fault.queryColumns,
            faultProbe.values,
          ).pass;
        }
      } catch {
        threw = true;
      }
      if (fault.expectThrow) {
        expect(threw, `${fault.label}: must throw fail-closed`).toBe(true);
        detected.push(fault.label);
        continue;
      }
      if (fault.kind === 'blind-spot') {
        blind.push(`${fault.label}: c1=${c1Pass} c2=${c2Pass}`);
        continue;
      }
      if (fault.label === 'packing-truncated-row-offsets') {
        // Either a throw or a C1/C2 disagreement counts as detection.
        expect(threw || !c1Pass || !c2Pass, `${fault.label}: must be detected`).toBe(true);
        detected.push(fault.label);
        continue;
      }
      expect(threw, `${fault.label}: must not throw`).toBe(false);
      const seen = !c1Pass || !c2Pass;
      expect(seen, `${fault.label}: corruption must be detected (c1=${c1Pass} c2=${c2Pass})`).toBe(true);
      detected.push(fault.label);
    }
    // Blind-spot contract: transposed symmetric queries and the
    // sub-tolerance nudge stay invisible by design; both are recorded.
    expect(blind.length).toBe(2);
    expect(detected.length).toBeGreaterThanOrEqual(8);
  });

  it('C2 rejects corrupted captured values and fails closed without full columns', () => {
    const system = buildSyntheticPacked(5, false);
    const normal = accumulatePackedNormal(system);
    const { rows, columns } = buildAllPairsQueries(5);
    const probe = probeSelectedCovariance(normal, rows, columns);
    expect(probe.damped).toBe(false);
    // Clean captured values pass with every column checked.
    const clean = evaluateSentinelC2(normal, rows, columns, probe.values);
    expect(clean.pass).toBe(true);
    expect(clean.perColumnResidual.length).toBe(5);
    // A corrupted native value (row 2 of column 3 shifted well above tolerance) is rejected.
    const corrupted = Array.from(probe.values);
    corrupted[2 * 5 + 3] = (corrupted[2 * 5 + 3] ?? 0) + 1e-3;
    const rejected = evaluateSentinelC2(normal, rows, columns, corrupted);
    expect(rejected.pass).toBe(false);
    expect(rejected.reasons.some((reason) => reason.includes('column 3'))).toBe(true);
    // A NaN captured value is rejected, not silently skipped.
    const nanValues = Array.from(probe.values);
    nanValues[0] = Number.NaN;
    const nanRejected = evaluateSentinelC2(normal, rows, columns, nanValues);
    expect(nanRejected.pass).toBe(false);
    // Diagonal-only queries carry no complete column: fail closed.
    const diagonal = buildDiagonalQueries(5);
    const diagProbe = probeSelectedCovariance(normal, diagonal.rows, diagonal.columns);
    const incomplete = evaluateSentinelC2(normal, diagonal.rows, diagonal.columns, diagProbe.values);
    expect(incomplete.pass).toBe(false);
    expect(incomplete.reasons.some((reason) => reason.includes('no complete column'))).toBe(true);
    // Conflicting duplicates are rejected.
    const dupRows = Int32Array.from([...rows, rows[0] ?? 0]);
    const dupCols = Int32Array.from([...columns, columns[0] ?? 0]);
    const dupValues = [...probe.values, (probe.values[0] ?? 0) + 1e-3];
    const dupRejected = evaluateSentinelC2(normal, dupRows, dupCols, dupValues);
    expect(dupRejected.pass).toBe(false);
  });

  it('records C1/C2/C3 timing and all-pairs/selected scaling at 64/128 (no gates)', () => {
    const timings: Array<{ unknowns: number; queries: number; c1Ms: number; c2Ms: number }> = [];
    const scaling: Array<{ unknowns: number; allPairs: number; selected: number }> = [];
    for (const n of [64, 128]) {
      const system = buildSyntheticPacked(n, false);
      const normal = accumulatePackedNormal(system);
      const selected = buildDiagonalQueries(n);
      const allPairs = buildAllPairsQueries(n);
      scaling.push({ unknowns: n, allPairs: allPairs.rows.length, selected: selected.rows.length });
      const reference = denseDiagonalReference(normal);
      const t1 = Date.now();
      const probe = probeSelectedCovariance(normal, selected.rows, selected.columns);
      const c1 = evaluateSentinelC1(probe.values, reference);
      const c1Ms = Date.now() - t1;
      const t2 = Date.now();
      const fullProbe = probeSelectedCovariance(normal, allPairs.rows, allPairs.columns);
      const c2 = evaluateSentinelC2(normal, allPairs.rows, allPairs.columns, fullProbe.values);
      const c2Ms = Date.now() - t2;
      expect(c1.pass).toBe(true);
      expect(c2.pass).toBe(true);
      timings.push({ unknowns: n, queries: selected.rows.length, c1Ms, c2Ms });
    }
    expect(scaling).toEqual([
      { unknowns: 64, allPairs: 4096, selected: 64 },
      { unknowns: 128, allPairs: 16384, selected: 128 },
    ]);
    expect(timings.length).toBe(2);
  });
});
