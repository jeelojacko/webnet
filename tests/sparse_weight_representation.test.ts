import { describe, expect, it } from 'vitest';
import {
  DenseWeightWriter,
  SparseWeightWriter,
  SymmetricWeightBuilder,
  structuredWeightsFromDense,
  structuredWeightsToDense,
  structuredWeightsToPackedUpper,
} from '../src/engine/sparseWeightRepresentation';
import { packUpperTriangleWeights } from '../src/engine/sparseEquationPacking';

describe('structured symmetric weights', () => {
  it('stores an explicit diagonal and canonical sorted off-diagonals', () => {
    const builder = new SymmetricWeightBuilder(3);
    builder.setDiagonal(0, 2);
    builder.setDiagonal(1, 3);
    builder.setDiagonal(2, 4);
    builder.setOffDiagonal(2, 0, 0.5);
    builder.setOffDiagonal(2, 1, 0.1);
    const finalized = builder.finalize();
    expect([...finalized.diagonal]).toEqual([2, 3, 4]);
    expect([...finalized.offRows]).toEqual([0, 1]);
    expect([...finalized.offColumns]).toEqual([2, 2]);
    expect([...finalized.offValues]).toEqual([0.5, 0.1]);
  });

  it('applies last-wins duplicate handling and drops exact zeros', () => {
    const builder = new SymmetricWeightBuilder(2);
    builder.set(0, 0, 2);
    builder.set(0, 1, 0.5);
    builder.set(1, 0, 0.9);
    builder.setOffDiagonal(0, 1, 0);
    const finalized = builder.finalize();
    expect([...finalized.diagonal]).toEqual([2, 0]);
    expect(finalized.offRows.length).toBe(0);
  });

  it('rejects non-finite values, out-of-bounds indices, and row==col off-diagonals', () => {
    const builder = new SymmetricWeightBuilder(2);
    expect(() => builder.setDiagonal(0, Number.NaN)).toThrow('non-finite');
    expect(() => builder.setOffDiagonal(0, 1, Number.POSITIVE_INFINITY)).toThrow('non-finite');
    expect(() => builder.setDiagonal(2, 1)).toThrow('out of bounds');
    expect(() => builder.setOffDiagonal(-1, 1, 0.5)).toThrow('out of bounds');
    expect(() => builder.setOffDiagonal(1, 1, 0.5)).toThrow('row<col');
    expect(() => new SymmetricWeightBuilder(-1)).toThrow('non-negative integer');
  });

  it('converts dense matrices with packing symmetry rules', () => {
    const structured = structuredWeightsFromDense([[2, 0.5, 0], [0.5, 3, 0.1], [0, 0.1, 4]], 3);
    expect([...structured.diagonal]).toEqual([2, 3, 4]);
    expect([...structured.offValues]).toEqual([0.5, 0.1]);
    expect(() => structuredWeightsFromDense([[2, 0.5], [0.9, 3]], 2)).toThrow('not symmetric');
    expect(() => structuredWeightsFromDense([[Number.NaN]], 1)).toThrow('non-finite');
    expect(() => structuredWeightsFromDense([[2, 0.5], [Number.NaN, 3]], 2)).toThrow('non-finite');
    const upperOnly = structuredWeightsFromDense([[2, 0.5], [0, 3]], 2);
    expect([...upperOnly.offValues]).toEqual([0.5]);
  });

  it('packs deterministically and matches dense packing output', () => {
    const dense = [[2, 0.5, 0], [0.5, 3, 0.1], [0, 0.1, 4]];
    const packedFromStructured = structuredWeightsToPackedUpper(structuredWeightsFromDense(dense, 3));
    const packedFromDense = packUpperTriangleWeights(dense, 3);
    expect([...packedFromStructured.rows]).toEqual([...packedFromDense.rows]);
    expect([...packedFromStructured.columns]).toEqual([...packedFromDense.columns]);
    expect([...packedFromStructured.values]).toEqual([...packedFromDense.values]);
  });

  it('reconstructs dense matrices symmetrically', () => {
    const writer = new SparseWeightWriter(3);
    writer.setDiagonal(0, 2);
    writer.setDiagonal(1, 3);
    writer.setDiagonal(2, 4);
    writer.set(2, 0, 0.5);
    writer.set(1, 2, 0.1);
    const dense = structuredWeightsToDense(writer.finalize());
    expect(dense).toEqual([[2, 0, 0.5], [0, 3, 0.1], [0.5, 0.1, 4]]);
  });

  it('mirrors dense writer updates symmetrically and round-trips', () => {
    const matrix = [[0, 0], [0, 0]];
    const writer = new DenseWeightWriter(matrix);
    writer.setDiagonal(0, 2);
    writer.setOffDiagonal(0, 1, 0.5);
    expect(matrix).toEqual([[2, 0.5], [0.5, 0]]);
    const structured = writer.toStructured();
    expect([...structured.diagonal]).toEqual([2, 0]);
    expect([...structured.offValues]).toEqual([0.5]);
    expect(() => writer.set(0, 5, 1)).toThrow('out of bounds');
  });
});
