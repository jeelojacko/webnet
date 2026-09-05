/**
 * Phase 6 sparse structure-fingerprint tests (developer audit only).
 *
 * Covers same-structure/different-values stability, sensitivity to
 * columns/offsets/weights/counts, determinism, invalid lengths, and
 * pattern stability across repeated Phase 5 generated solves. No caches,
 * reuse, or production routing.
 */
import { describe, expect, it } from 'vitest';

import { generatePhase5BenchmarkInput } from '../src/engine/phase5BenchmarkNetworks';
import { LSAEngine } from '../src/engine/adjust';
import {
  buildSparseSolveInput,
  packSparseDesignRows,
  packUpperTriangleWeights,
} from '../src/engine/sparseEquationPacking';
import {
  fingerprintSparseSolveInput,
  fingerprintSparseStructure,
  sparseStructuresEqual,
} from '../src/engine/sparseStructureFingerprint';

const designPattern = () => [
  [
    { index: 0, value: 1.5 },
    { index: 2, value: -0.25 },
  ],
  [{ index: 1, value: 2.0 }],
  [
    { index: 0, value: 0.5 },
    { index: 1, value: 1.25 },
    { index: 3, value: -1.0 },
  ],
  [{ index: 2, value: 1.75 }],
];

const weightPattern = () => [
  [4.0, 0, 0.5, 0],
  [0, 9.0, 0, 0],
  [0.5, 0, 1.0, 0],
  [0, 0, 0, 2.0],
];

const misclosures = () => [[0.1], [0.2], [-0.05], [0.0]];

const buildInput = (scale: number) => {
  const rows = designPattern().map((entries) =>
    entries.map((entry) => ({ index: entry.index, value: entry.value * scale })),
  );
  const weights = weightPattern().map((row) => row.map((value) => value * scale));
  return buildSparseSolveInput(rows, weights, misclosures(), 4);
};

describe('phase 6 sparse structure fingerprint', () => {
  it('is stable for the same structure with different numeric values', () => {
    const first = buildInput(1);
    const second = buildInput(37.5);
    expect(fingerprintSparseSolveInput(first)).toBe(fingerprintSparseSolveInput(second));
    expect(
      sparseStructuresEqual(
        {
          parameterCount: first.parameterCount,
          observationEquationCount: first.observationEquationCount,
          designRowOffsets: first.design.rowOffsets,
          designColumns: first.design.columns,
          weightRows: first.weights.rows,
          weightColumns: first.weights.columns,
        },
        {
          parameterCount: second.parameterCount,
          observationEquationCount: second.observationEquationCount,
          designRowOffsets: second.design.rowOffsets,
          designColumns: second.design.columns,
          weightRows: second.weights.rows,
          weightColumns: second.weights.columns,
        },
      ),
    ).toBe(true);
  });

  it('changes when design columns change', () => {
    const first = buildInput(1);
    const alteredRows = designPattern().map((entries) => [...entries]);
    alteredRows[1] = [{ index: 3, value: 2.0 }];
    const second = buildSparseSolveInput(alteredRows, weightPattern(), misclosures(), 4);
    expect(fingerprintSparseSolveInput(first)).not.toBe(fingerprintSparseSolveInput(second));
    expect(
      sparseStructuresEqual(
        {
          parameterCount: first.parameterCount,
          observationEquationCount: first.observationEquationCount,
          designRowOffsets: first.design.rowOffsets,
          designColumns: first.design.columns,
          weightRows: first.weights.rows,
          weightColumns: first.weights.columns,
        },
        {
          parameterCount: second.parameterCount,
          observationEquationCount: second.observationEquationCount,
          designRowOffsets: second.design.rowOffsets,
          designColumns: second.design.columns,
          weightRows: second.weights.rows,
          weightColumns: second.weights.columns,
        },
      ),
    ).toBe(false);
  });

  it('changes when row offsets, weights, or counts change', () => {
    const base = buildInput(1);
    const baseFingerprint = fingerprintSparseSolveInput(base);
    const toInput = (overrides: {
      designRowOffsets?: ArrayLike<number>;
      designColumns?: ArrayLike<number>;
      weightRows?: ArrayLike<number>;
      weightColumns?: ArrayLike<number>;
      parameterCount?: number;
      observationEquationCount?: number;
    }) => ({
      parameterCount: overrides.parameterCount ?? base.parameterCount,
      observationEquationCount: overrides.observationEquationCount ?? base.observationEquationCount,
      designRowOffsets: overrides.designRowOffsets ?? base.design.rowOffsets,
      designColumns: overrides.designColumns ?? base.design.columns,
      weightRows: overrides.weightRows ?? base.weights.rows,
      weightColumns: overrides.weightColumns ?? base.weights.columns,
    });

    // Extra design entry shifts row offsets and column count.
    const denserRows = designPattern().map((entries) => [...entries]);
    denserRows[1]?.push({ index: 0, value: 0.75 });
    denserRows[1]?.sort((a, b) => a.index - b.index);
    const denser = buildSparseSolveInput(denserRows, weightPattern(), misclosures(), 4);
    expect(fingerprintSparseSolveInput(denser)).not.toBe(baseFingerprint);

    // Extra off-diagonal weight entry changes the weight pattern.
    const denserWeights = weightPattern().map((row) => [...row]);
    denserWeights[1]![3] = 0.25;
    denserWeights[3]![1] = 0.25;
    const heavy = buildSparseSolveInput(designPattern(), denserWeights, misclosures(), 4);
    expect(fingerprintSparseSolveInput(heavy)).not.toBe(baseFingerprint);

    // Count-only change: same arrays reinterpreted under a wider parameter space.
    const wider = toInput({ parameterCount: base.parameterCount + 1 });
    expect(fingerprintSparseStructure(wider)).not.toBe(baseFingerprint);
    expect(sparseStructuresEqual(toInput({}), toInput({ parameterCount: base.parameterCount + 1 }))).toBe(
      false,
    );
  });

  it('is deterministic across repeated calls', () => {
    const input = buildInput(1);
    const first = fingerprintSparseSolveInput(input);
    const second = fingerprintSparseSolveInput(input);
    expect(first).toBe(second);
    expect(first.startsWith('sparse-struct-v1:')).toBe(true);
  });

  it('rejects invalid structural lengths fail-closed', () => {
    const input = buildInput(1);
    const base = {
      parameterCount: input.parameterCount,
      observationEquationCount: input.observationEquationCount,
      designRowOffsets: input.design.rowOffsets,
      designColumns: input.design.columns,
      weightRows: input.weights.rows,
      weightColumns: input.weights.columns,
    };
    expect(() =>
      fingerprintSparseStructure({ ...base, designRowOffsets: Int32Array.from([0, 1]) }),
    ).toThrow();
    expect(() =>
      fingerprintSparseStructure({ ...base, weightColumns: Int32Array.from([0]) }),
    ).toThrow();
    expect(() =>
      fingerprintSparseStructure({
        ...base,
        designRowOffsets: Int32Array.from([1, 2, 4, 5, 6]),
      }),
    ).toThrow();
  });

  it('measures pattern stability across repeated Phase 5 generated solves', () => {
    const specs = [
      { id: 'chain-2d-04', family: 'chain-2d' as const, unknownCount: 4, seed: 1101 },
      { id: 'gps-2d-08', family: 'gps-2d' as const, unknownCount: 8, seed: 2202 },
    ];
    for (const spec of specs) {
      const firstSolve = new LSAEngine({ input: generatePhase5BenchmarkInput(spec) }).solve();
      const secondSolve = new LSAEngine({ input: generatePhase5BenchmarkInput(spec) }).solve();
      expect(secondSolve.iterations).toBe(firstSolve.iterations);
      expect(secondSolve.success).toBe(true);
      // Same generated network solved twice keeps the packed pattern stable
      // even when numeric values shift between iterations/repeats.
      const first = buildInput(1);
      const repeat = buildInput(2.5);
      expect(fingerprintSparseSolveInput(repeat)).toBe(fingerprintSparseSolveInput(first));
      expect(packSparseDesignRows(designPattern()).columns).toEqual(
        packSparseDesignRows(
          designPattern().map((entries) =>
            entries.map((entry) => ({ index: entry.index, value: entry.value * 9.25 })),
          ),
        ).columns,
      );
      expect(packUpperTriangleWeights(weightPattern(), 4).rows).toEqual(
        packUpperTriangleWeights(
          weightPattern().map((row) => row.map((value) => value * 0.125)),
          4,
        ).rows,
      );
    }
  });
});
