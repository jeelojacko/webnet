import { describe, expect, it } from 'vitest';
import { denseRowsToSparseRows } from '../src/engine/matrix';
import { buildSparseSolveInput, packMisclosures, packSparseDesignRows, packUpperTriangleWeights } from '../src/engine/sparseEquationPacking';

describe('sparse equation packing', () => {
  it('packs sorted sparse design rows without dense A', () => {
    const packed = packSparseDesignRows(denseRowsToSparseRows([[1, 0, 2], [0, 3, 0]]));
    expect([...packed.rowOffsets]).toEqual([0, 2, 3]);
    expect([...packed.columns]).toEqual([0, 2, 1]);
    expect([...packed.values]).toEqual([1, 2, 3]);
  });

  it('keeps only nonzero upper-triangle weights', () => {
    const packed = packUpperTriangleWeights([[2, 0.5, 0], [0.5, 3, 0.1], [0, 0.1, 4]], 3);
    expect([...packed.rows]).toEqual([0, 0, 1, 1, 2]);
    expect([...packed.columns]).toEqual([0, 1, 1, 2, 2]);
    expect([...packed.values]).toEqual([2, 0.5, 3, 0.1, 4]);
  });

  it('rejects unsorted and non-finite boundary values', () => {
    expect(() => packSparseDesignRows([[{ index: 1, value: 1 }, { index: 0, value: 2 }]])).toThrow('strictly column-sorted');
    expect(() => packUpperTriangleWeights([[Number.NaN]], 1)).toThrow('non-finite');
    expect(() => packMisclosures([[1], [2]], 1)).toThrow('one misclosure');
  });

  it('rejects asymmetric nonzero P entries while keeping upper-only packing', () => {
    expect(() => packUpperTriangleWeights([[2, 0.5], [0.9, 3]], 2)).toThrow('not symmetric');
    expect(() => packUpperTriangleWeights([[2, 0.5], [Number.NaN, 3]], 2)).toThrow('non-finite');
    const upperOnly = packUpperTriangleWeights([[2, 0.5], [0, 3]], 2);
    expect([...upperOnly.values]).toEqual([2, 0.5, 3]);
  });

  it('requires one design row per misclosure before packing', () => {
    const rows = denseRowsToSparseRows([[1, 2], [3, 4]]);
    expect(() => buildSparseSolveInput(rows, [[2, 0], [0, 3]], [[5]], 2)).toThrow('one design row per misclosure');
    const packed = buildSparseSolveInput(rows, [[2, 0], [0, 3]], [[5], [11]], 2);
    expect(packed.observationEquationCount).toBe(2);
    expect(packed.misclosures.length).toBe(2);
  });
});
