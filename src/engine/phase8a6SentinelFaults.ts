/**
 * Phase 8A.6 sentinel fault injection (TEST/EVIDENCE ONLY).
 *
 * Deterministic corruptors over cloned packed sentinel inputs plus a
 * blind-spot experiment list. Every corruptor is a pure function of its
 * arguments; labels are fixed strings so reports are byte-deterministic.
 * Nothing in production imports this module.
 */

import type { Phase8a6PackedSystem } from './phase8a6SparseCovarianceSentinel';

export interface Phase8a6FaultCase {
  label: string;
  kind:
    | 'diagonal'
    | 'off-diagonal'
    | 'sign'
    | 'swap'
    | 'nan'
    | 'infinity'
    | 'missing-query'
    | 'duplicate-query'
    | 'packing'
    | 'blind-spot';
  system: Phase8a6PackedSystem;
  queryRows: Int32Array;
  queryColumns: Int32Array;
  /** True when the corruptor itself must throw (packing fault). */
  expectThrow: boolean;
  note: string;
}

const cloneSystem = (system: Phase8a6PackedSystem): Phase8a6PackedSystem => ({
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
});

const firstDiagonalWeight = (system: Phase8a6PackedSystem): number => {
  for (let k = 0; k < system.weights.rows.length; k += 1) {
    if (system.weights.rows[k] === system.weights.columns[k]) return k;
  }
  return -1;
};

const firstOffDiagonalWeight = (system: Phase8a6PackedSystem): number => {
  for (let k = 0; k < system.weights.rows.length; k += 1) {
    if (system.weights.rows[k] !== system.weights.columns[k]) return k;
  }
  return -1;
};

/**
 * Builds the deterministic fault-injection suite for one captured packed
 * system. Faults that need an off-diagonal weight entry are skipped
 * (empty) when the system is diagonal-weighted; the skip is explicit in
 * the returned list via the `note` of the surviving cases.
 */
export const buildSentinelFaultSuite = (args: {
  system: Phase8a6PackedSystem;
  queryRows: Int32Array;
  queryColumns: Int32Array;
}): Phase8a6FaultCase[] => {
  const cases: Phase8a6FaultCase[] = [];
  const base = args.system;
  const qr = Int32Array.from(args.queryRows);
  const qc = Int32Array.from(args.queryColumns);

  {
    const mutated = cloneSystem(base);
    const k = firstDiagonalWeight(mutated);
    if (k >= 0) {
      mutated.weights.values[k]! *= 4;
      cases.push({
        label: 'diagonal-x4',
        kind: 'diagonal',
        system: mutated,
        queryRows: qr,
        queryColumns: qc,
        expectThrow: false,
        note: 'first diagonal weight quadrupled; C1/C2 must detect',
      });
    }
  }
  {
    const mutated = cloneSystem(base);
    const k = firstOffDiagonalWeight(mutated);
    if (k >= 0) {
      mutated.weights.values[k]! *= 3;
      cases.push({
        label: 'off-diagonal-x3',
        kind: 'off-diagonal',
        system: mutated,
        queryRows: qr,
        queryColumns: qc,
        expectThrow: false,
        note: 'first off-diagonal weight tripled; C1/C2 must detect',
      });
    }
  }
  {
    const mutated = cloneSystem(base);
    const k = firstOffDiagonalWeight(mutated);
    if (k >= 0) {
      mutated.weights.values[k]! *= -1;
      cases.push({
        label: 'off-diagonal-sign-flip',
        kind: 'sign',
        system: mutated,
        queryRows: qr,
        queryColumns: qc,
        expectThrow: false,
        note: 'first off-diagonal weight sign-flipped; symmetry/C1 must detect',
      });
    }
  }
  if (qr.length >= 2) {
    const swappedRows = Int32Array.from(qr);
    const swappedCols = Int32Array.from(qc);
    const t = swappedRows[0]!;
    swappedRows[0] = swappedRows[1]!;
    swappedRows[1] = t;
    const u = swappedCols[0]!;
    swappedCols[0] = swappedCols[1]!;
    swappedCols[1] = u;
    cases.push({
      label: 'swap-first-two-queries',
      kind: 'swap',
      system: cloneSystem(base),
      queryRows: swappedRows,
      queryColumns: swappedCols,
      expectThrow: false,
      note: 'first two queries swapped; value order must follow queries exactly',
    });
  }
  {
    const mutated = cloneSystem(base);
    if (mutated.design.values.length > 0) {
      mutated.design.values[0] = Number.NaN;
      cases.push({
        label: 'nan-design-value',
        kind: 'nan',
        system: mutated,
        queryRows: qr,
        queryColumns: qc,
        expectThrow: true,
        note: 'NaN design value must throw fail-closed at accumulation',
      });
    }
  }
  {
    const mutated = cloneSystem(base);
    if (mutated.weights.values.length > 0) {
      mutated.weights.values[0] = Number.POSITIVE_INFINITY;
      cases.push({
        label: 'infinity-weight-value',
        kind: 'infinity',
        system: mutated,
        queryRows: qr,
        queryColumns: qc,
        expectThrow: true,
        note: 'Infinite weight must throw fail-closed at accumulation',
      });
    }
  }
  if (qr.length >= 2) {
    cases.push({
      label: 'missing-first-query',
      kind: 'missing-query',
      system: cloneSystem(base),
      queryRows: qr.slice(1),
      queryColumns: qc.slice(1),
      expectThrow: false,
      note: 'dropped query shortens the probe; C1 length gate must detect',
    });
  }
  if (qr.length >= 1) {
    const dupRows = Int32Array.from([...qr, qr[0]!]);
    const dupCols = Int32Array.from([...qc, qc[0]!]);
    cases.push({
      label: 'duplicate-first-query',
      kind: 'duplicate-query',
      system: cloneSystem(base),
      queryRows: dupRows,
      queryColumns: dupCols,
      expectThrow: false,
      note: 'duplicated query lengthens the probe; C1 length gate must detect',
    });
  }
  {
    // Packing fault: rowOffsets truncated by one row (safe: pure throw expected).
    const mutated = cloneSystem(base);
    mutated.design = {
      rowOffsets: mutated.design.rowOffsets.slice(0, Math.max(1, mutated.design.rowOffsets.length - 1)),
      columns: mutated.design.columns,
      values: mutated.design.values,
    };
    cases.push({
      label: 'packing-truncated-row-offsets',
      kind: 'packing',
      system: mutated,
      queryRows: qr,
      queryColumns: qc,
      expectThrow: false,
      note: 'truncated rowOffsets misalign design rows; C1/C2 should disagree (throw acceptable)',
    });
  }
  {
    // Blind-spot experiment: symmetric (r,c)->(c,r) query swap on a
    // symmetric covariance is invisible to value comparison by design.
    const swappedRows = Int32Array.from(qc);
    const swappedCols = Int32Array.from(qr);
    cases.push({
      label: 'blind-spot-transposed-queries',
      kind: 'blind-spot',
      system: cloneSystem(base),
      queryRows: swappedRows,
      queryColumns: swappedCols,
      expectThrow: false,
      note: 'transposed query order on symmetric Qxx yields identical values: expected sentinel blind spot',
    });
  }
  {
    // Blind-spot experiment: sub-tolerance diagonal nudge stays inside C1.
    const mutated = cloneSystem(base);
    const k = firstDiagonalWeight(mutated);
    if (k >= 0) {
      mutated.weights.values[k]! *= 1 + 1e-12;
      cases.push({
        label: 'blind-spot-sub-tolerance-diagonal',
        kind: 'blind-spot',
        system: mutated,
        queryRows: qr,
        queryColumns: qc,
        expectThrow: false,
        note: '1e-12 relative diagonal nudge stays inside C1 tolerance: expected blind spot by design',
      });
    }
  }
  return cases;
};
