import { zeros } from './matrixBasic';
import type { InvertSymmetricLDLTResult, Matrix, PivotedLDLTResult } from './matrixTypes';

const BUNCH_KAUFMAN_ALPHA = (1 + Math.sqrt(17)) / 8;

const swapRowsAndColumns = (m: Matrix, a: number, b: number): void => {
  if (a === b) return;
  [m[a], m[b]] = [m[b], m[a]];
  for (let i = 0; i < m.length; i += 1) {
    [m[i][a], m[i][b]] = [m[i][b], m[i][a]];
  }
};

const swapLowerPrefixRows = (lower: Matrix, a: number, b: number, prefixCols: number): void => {
  if (a === b) return;
  for (let col = 0; col < prefixCols; col += 1) {
    [lower[a][col], lower[b][col]] = [lower[b][col], lower[a][col]];
  }
};

export const ldltDecomposeSymmetric = (m: Matrix, tolerance = 1e-14): PivotedLDLTResult => {
  const n = m.length;
  if (n === 0) {
    return { lower: [], diagonal: [], offDiagonal: [], blockSizes: [], permutation: [] };
  }
  if (m.some((row) => row.length !== n)) {
    throw new Error('LDLT decomposition requires a square matrix.');
  }

  const work = m.map((row, i) => row.map((value, j) => 0.5 * (value + (m[j]?.[i] ?? value))));
  const lower = zeros(n, n);
  const diagonal = new Array(n).fill(0);
  const offDiagonal = new Array(n).fill(0);
  const blockSizes = new Array(n).fill(0);
  const permutation = Array.from({ length: n }, (_, i) => i);

  let k = 0;
  while (k < n) {
    const absakk = Math.abs(work[k][k] ?? 0);
    let imax = k;
    let colmax = 0;
    for (let i = k + 1; i < n; i += 1) {
      const candidate = Math.abs(work[i][k] ?? 0);
      if (candidate > colmax) {
        colmax = candidate;
        imax = i;
      }
    }

    if (
      Math.max(absakk, colmax) <= tolerance ||
      !Number.isFinite(absakk) ||
      !Number.isFinite(colmax)
    ) {
      throw new Error(`Symmetric LDLT pivot too small at step ${k} (pivot=${work[k][k]}).`);
    }

    let kp = k;
    let kstep = 1;
    if (absakk < BUNCH_KAUFMAN_ALPHA * colmax) {
      let rowmax = 0;
      for (let j = k; j < n; j += 1) {
        if (j === imax) continue;
        rowmax = Math.max(rowmax, Math.abs(work[imax][j] ?? 0));
      }
      const absaimax = Math.abs(work[imax][imax] ?? 0);
      if (absaimax >= BUNCH_KAUFMAN_ALPHA * rowmax) {
        kp = imax;
      } else {
        kp = imax;
        kstep = 2;
      }
    }

    if (kstep === 1) {
      if (kp !== k) {
        swapRowsAndColumns(work, k, kp);
        [permutation[k], permutation[kp]] = [permutation[kp], permutation[k]];
        swapLowerPrefixRows(lower, k, kp, k);
      }

      const pivot = work[k][k];
      if (!Number.isFinite(pivot) || Math.abs(pivot) <= tolerance) {
        throw new Error(`Symmetric LDLT pivot vanished at step ${k} (pivot=${pivot}).`);
      }
      diagonal[k] = pivot;
      blockSizes[k] = 1;
      lower[k][k] = 1;

      for (let i = k + 1; i < n; i += 1) {
        lower[i][k] = work[i][k] / pivot;
      }

      for (let i = k + 1; i < n; i += 1) {
        for (let j = i; j < n; j += 1) {
          work[j][i] -= lower[i][k] * pivot * lower[j][k];
          work[i][j] = work[j][i];
        }
      }

      k += 1;
      continue;
    }

    if (kp !== k + 1) {
      swapRowsAndColumns(work, k + 1, kp);
      [permutation[k + 1], permutation[kp]] = [permutation[kp], permutation[k + 1]];
      swapLowerPrefixRows(lower, k + 1, kp, k);
    }

    const a11 = work[k][k];
    const a21 = work[k + 1][k];
    const a22 = work[k + 1][k + 1];
    const det = a11 * a22 - a21 * a21;
    if (!Number.isFinite(det) || Math.abs(det) <= tolerance) {
      throw new Error(`Symmetric LDLT 2x2 pivot too small at step ${k} (det=${det}).`);
    }

    diagonal[k] = a11;
    diagonal[k + 1] = a22;
    offDiagonal[k] = a21;
    blockSizes[k] = 2;
    blockSizes[k + 1] = -1;
    lower[k][k] = 1;
    lower[k + 1][k + 1] = 1;

    for (let i = k + 2; i < n; i += 1) {
      const c1 = work[i][k];
      const c2 = work[i][k + 1];
      lower[i][k] = (c1 * a22 - c2 * a21) / det;
      lower[i][k + 1] = (c2 * a11 - c1 * a21) / det;
    }

    for (let i = k + 2; i < n; i += 1) {
      for (let j = i; j < n; j += 1) {
        const delta =
          lower[i][k] * (a11 * lower[j][k] + a21 * lower[j][k + 1]) +
          lower[i][k + 1] * (a21 * lower[j][k] + a22 * lower[j][k + 1]);
        work[j][i] -= delta;
        work[i][j] = work[j][i];
      }
    }

    k += 2;
  }

  return { lower, diagonal, offDiagonal, blockSizes, permutation };
};

export const solveSymmetricLDLT = (factorization: PivotedLDLTResult, b: Matrix): Matrix => {
  const n = factorization.lower.length;
  if (b.length !== n) {
    throw new Error('Symmetric LDLT solve dimension mismatch.');
  }
  const cols = b[0]?.length ?? 0;
  const x = zeros(n, cols);

  for (let col = 0; col < cols; col += 1) {
    const bp = new Array(n).fill(0);
    for (let i = 0; i < n; i += 1) {
      bp[i] = b[factorization.permutation[i]]?.[col] ?? 0;
    }

    const y = new Array(n).fill(0);
    for (let i = 0; i < n; i += 1) {
      let sum = bp[i];
      for (let k = 0; k < i; k += 1) {
        sum -= factorization.lower[i][k] * y[k];
      }
      y[i] = sum;
    }

    const z = new Array(n).fill(0);
    for (let i = 0; i < n; ) {
      const blockSize = factorization.blockSizes[i] || 1;
      if (blockSize === 1) {
        z[i] = y[i] / factorization.diagonal[i];
        i += 1;
        continue;
      }
      if (blockSize !== 2 || i + 1 >= n) {
        throw new Error(`Invalid LDLT block structure at index ${i}.`);
      }
      const a11 = factorization.diagonal[i];
      const a21 = factorization.offDiagonal[i];
      const a22 = factorization.diagonal[i + 1];
      const det = a11 * a22 - a21 * a21;
      if (!Number.isFinite(det) || Math.abs(det) <= 1e-14) {
        throw new Error(`Symmetric LDLT block solve failed at index ${i} (det=${det}).`);
      }
      z[i] = (y[i] * a22 - y[i + 1] * a21) / det;
      z[i + 1] = (y[i + 1] * a11 - y[i] * a21) / det;
      i += 2;
    }

    const xp = new Array(n).fill(0);
    for (let i = n - 1; i >= 0; i -= 1) {
      let sum = z[i];
      for (let k = i + 1; k < n; k += 1) {
        sum -= factorization.lower[k][i] * xp[k];
      }
      xp[i] = sum;
    }

    for (let i = 0; i < n; i += 1) {
      x[factorization.permutation[i]][col] = xp[i];
    }
  }

  return x;
};

export const invertSymmetricLDLTWithInfo = (m: Matrix): InvertSymmetricLDLTResult => {
  const factorization = ldltDecomposeSymmetric(m);
  const identity = zeros(m.length, m.length);
  for (let i = 0; i < m.length; i += 1) {
    identity[i][i] = 1;
  }
  return {
    inverse: solveSymmetricLDLT(factorization, identity),
    factorization,
    twoByTwoPivotCount: factorization.blockSizes.filter((size) => size === 2).length,
  };
};

export const invertSymmetricLDLT = (m: Matrix): Matrix => invertSymmetricLDLTWithInfo(m).inverse;
