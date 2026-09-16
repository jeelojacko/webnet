/**
 * Phase 16B structured-weight oracle (§8) plus the dense-identical
 * structured normal accumulator used by the covariance-recovery candidate
 * path. Pure functions over StructuredSymmetricWeights; no solver, settings,
 * or output-format knowledge.
 */
import { zeros } from './matrix';
import type { Matrix, SparseMatrixRows } from './matrix';
import { structuredWeightsToDense } from './sparseWeightRepresentation';
import type { StructuredSymmetricWeights } from './sparseWeightRepresentation';

export interface StructuredWeightRoundTrip {
  maxAbs: number;
  maxRel: number;
  exact: boolean;
}

/**
 * Phase 16B routing: dense fallback below the measured crossover.
 * Assembly probes (median ms, dense vs structured-omit): chain m=32
 * 0.06/0.09, m=64 0.22/0.07; setup-scope m=32 0.20/0.64, m=64 0.20/1.27;
 * ts-set-8x8 (m=64) 0.24/0.38. Below 128 the dense allocation is at most
 * 128KB while the structured finalize dominates, so dense is the standing
 * choice there. Both paths are bit-identical (oracle-proven), so this is
 * performance-only routing.
 */
export const structuredWeightTransferEligible = (equationCount: number): boolean =>
  Number.isInteger(equationCount) && equationCount >= 128;

/**
 * Materializes structured weights and compares every entry against the
 * reference dense P. Bit-identical comparison; maxRel is reported against
 * the largest reference magnitude for context.
 */
export const compareStructuredWeightsToDense = (
  weights: StructuredSymmetricWeights,
  reference: number[][],
): StructuredWeightRoundTrip => {
  const materialized = structuredWeightsToDense(weights);
  if (materialized.length !== reference.length) {
    throw new Error(
      `Structured round-trip size mismatch (got ${materialized.length} for ${reference.length}).`,
    );
  }
  let maxAbs = 0;
  let refMax = 0;
  for (let row = 0; row < reference.length; row += 1) {
    const actualRow = materialized[row] ?? [];
    const expectedRow = reference[row] ?? [];
    if (actualRow.length !== expectedRow.length) {
      throw new Error(`Structured round-trip row ${row} length mismatch.`);
    }
    for (let column = 0; column < expectedRow.length; column += 1) {
      const expected = expectedRow[column] ?? 0;
      const diff = Math.abs((actualRow[column] ?? 0) - expected);
      if (diff > maxAbs) maxAbs = diff;
      if (Math.abs(expected) > refMax) refMax = Math.abs(expected);
    }
  }
  return { maxAbs, maxRel: refMax === 0 ? maxAbs : maxAbs / refMax, exact: maxAbs === 0 };
};

const requireSupportedShape = (weights: StructuredSymmetricWeights): void => {
  if (weights.diagonal.length !== weights.size) {
    throw new Error('Structured accumulation needs diagonal length equal to size.');
  }
  if (
    weights.offRows.length !== weights.offColumns.length ||
    weights.offRows.length !== weights.offValues.length
  ) {
    throw new Error('Structured accumulation needs matching off-diagonal triplet arrays.');
  }
  for (let position = 0; position < weights.offRows.length; position += 1) {
    const row = weights.offRows[position] as number;
    const column = weights.offColumns[position] as number;
    if (
      !Number.isInteger(row) ||
      !Number.isInteger(column) ||
      row < 0 ||
      column < 0 ||
      row >= weights.size ||
      column >= weights.size ||
      row >= column
    ) {
      throw new Error(`Structured accumulation rejects unsupported triplet at position ${position}.`);
    }
  }
};

/**
 * Structured A'PA accumulation replicating
 * accumulateNormalEquationsFromSparseRows statement-for-statement (per-row
 * diagonal pass, then canonical row-major off-diagonal pairs) so N and rhs
 * are bit-identical to the dense-weight result. Triplet arrays must be in
 * canonical (row, column) order as emitted by finalize(); anything else
 * throws so the caller falls back to dense.
 */
export const accumulateNormalFromStructuredWeights = (
  rows: SparseMatrixRows,
  residuals: Matrix,
  weights: StructuredSymmetricWeights,
  numParams: number,
): { normal: Matrix; rhs: Matrix } => {
  requireSupportedShape(weights);
  const normal = zeros(numParams, numParams);
  const rhs = zeros(numParams, 1);
  const rowCount = Math.min(rows.length, weights.size, residuals.length);
  let triplet = 0;
  const tripletCount = weights.offRows.length;

  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const rowEntries = rows[rowIndex];
    if (triplet < tripletCount && (weights.offRows[triplet] as number) < rowIndex) {
      throw new Error('Structured accumulation needs canonical triplet order.');
    }
    if (rowEntries.length === 0) {
      while (triplet < tripletCount && (weights.offRows[triplet] as number) === rowIndex) {
        triplet += 1;
      }
      continue;
    }
    const rowResidual = residuals[rowIndex]?.[0] ?? 0;
    const diagonalWeight = weights.diagonal[rowIndex] as number;

    if (diagonalWeight !== 0) {
      for (let a = 0; a < rowEntries.length; a += 1) {
        const left = rowEntries[a];
        rhs[left.index][0] += left.value * diagonalWeight * rowResidual;
        for (let b = a; b < rowEntries.length; b += 1) {
          const right = rowEntries[b];
          const contribution = left.value * diagonalWeight * right.value;
          normal[left.index][right.index] += contribution;
          if (left.index !== right.index) {
            normal[right.index][left.index] += contribution;
          }
        }
      }
    }

    while (triplet < tripletCount && (weights.offRows[triplet] as number) === rowIndex) {
      const colIndex = weights.offColumns[triplet] as number;
      const weight = weights.offValues[triplet] as number;
      triplet += 1;
      if (colIndex >= rowCount) continue;
      const otherEntries = rows[colIndex];
      if (otherEntries.length === 0) continue;
      const otherResidual = residuals[colIndex]?.[0] ?? 0;

      for (let a = 0; a < rowEntries.length; a += 1) {
        const left = rowEntries[a];
        rhs[left.index][0] += left.value * weight * otherResidual;
      }
      for (let b = 0; b < otherEntries.length; b += 1) {
        const right = otherEntries[b];
        rhs[right.index][0] += right.value * weight * rowResidual;
      }

      for (let a = 0; a < rowEntries.length; a += 1) {
        const left = rowEntries[a];
        for (let b = 0; b < otherEntries.length; b += 1) {
          const right = otherEntries[b];
          const contribution = left.value * weight * right.value;
          normal[left.index][right.index] += contribution;
          normal[right.index][left.index] += contribution;
        }
      }
    }
  }

  return { normal, rhs };
};
