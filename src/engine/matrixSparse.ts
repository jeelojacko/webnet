import { zeros } from './matrixBasic';
import type { Matrix, SparseMatrixEntry, SparseMatrixRows } from './matrixTypes';

export const denseRowsToSparseRows = (m: Matrix, zeroTolerance = 0): SparseMatrixRows =>
  m.map((row) => {
    const entries: SparseMatrixEntry[] = [];
    for (let column = 0; column < row.length; column += 1) {
      const value = row[column] ?? 0;
      if (Math.abs(value) <= zeroTolerance) continue;
      entries.push({ index: column, value });
    }
    return entries;
  });

export const multiplySparseRowsByDenseMatrix = (rows: SparseMatrixRows, m: Matrix): Matrix => {
  const cols = m[0]?.length ?? 0;
  const result = zeros(rows.length, cols);
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const entries = rows[rowIndex];
    for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
      const entry = entries[entryIndex];
      const sourceRow = m[entry.index];
      if (!sourceRow) continue;
      for (let col = 0; col < cols; col += 1) {
        result[rowIndex][col] += entry.value * (sourceRow[col] ?? 0);
      }
    }
  }
  return result;
};

export const accumulateNormalEquationsFromSparseRows = (
  rows: SparseMatrixRows,
  residuals: Matrix,
  weights: Matrix,
  numParams: number,
): { normal: Matrix; rhs: Matrix } => {
  const normal = zeros(numParams, numParams);
  const rhs = zeros(numParams, 1);
  const rowCount = Math.min(rows.length, weights.length, residuals.length);

  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const rowEntries = rows[rowIndex];
    if (rowEntries.length === 0) continue;
    const rowResidual = residuals[rowIndex]?.[0] ?? 0;
    const diagonalWeight = weights[rowIndex]?.[rowIndex] ?? 0;

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

    for (let colIndex = rowIndex + 1; colIndex < rowCount; colIndex += 1) {
      const weight = weights[rowIndex]?.[colIndex] ?? 0;
      if (weight === 0) continue;
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

export const symmetricQuadraticForm = (m: Matrix, v: Matrix): number => {
  let sum = 0;
  const rowCount = Math.min(m.length, v.length);
  for (let i = 0; i < rowCount; i += 1) {
    const vi = v[i]?.[0] ?? 0;
    if (vi === 0) continue;
    const diagonal = m[i]?.[i] ?? 0;
    if (diagonal !== 0) {
      sum += vi * diagonal * vi;
    }
    for (let j = i + 1; j < rowCount; j += 1) {
      const weight = m[i]?.[j] ?? 0;
      if (weight === 0) continue;
      sum += 2 * vi * weight * (v[j]?.[0] ?? 0);
    }
  }
  return sum;
};
