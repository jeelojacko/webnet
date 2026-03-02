export type Matrix = number[][];
export interface DampedCholeskyResult {
  factor: Matrix;
  damping: number;
  attempts: number;
}
export interface PivotedLDLTResult {
  lower: Matrix;
  diagonal: number[];
  offDiagonal: number[];
  blockSizes: number[];
  permutation: number[];
}
export interface InvertSymmetricLDLTResult {
  inverse: Matrix;
  factorization: PivotedLDLTResult;
  twoByTwoPivotCount: number;
}

export const zeros = (rows: number, cols: number): Matrix =>
  Array.from({ length: rows }, () => Array.from({ length: cols }, () => 0));

export const transpose = (m: Matrix): Matrix => m[0].map((_, i) => m.map((row) => row[i]));

export const multiply = (a: Matrix, b: Matrix): Matrix => {
  const r1 = a.length;
  const c1 = a[0]?.length ?? 0;
  const c2 = b[0]?.length ?? 0;
  const res = zeros(r1, c2);
  for (let i = 0; i < r1; i++) {
    for (let j = 0; j < c2; j++) {
      let sum = 0;
      for (let k = 0; k < c1; k++) {
        sum += (a[i][k] ?? 0) * (b[k][j] ?? 0);
      }
      res[i][j] = sum;
    }
  }
  return res;
};

export const choleskyDecompose = (m: Matrix): Matrix => {
  const n = m.length;
  if (n === 0) return [];
  if (m.some((row) => row.length !== n)) {
    throw new Error('Cholesky decomposition requires a square matrix.');
  }

  const l = zeros(n, n);
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j <= i; j += 1) {
      let sum = i === j ? m[i][i] : 0.5 * ((m[i][j] ?? 0) + (m[j][i] ?? 0));
      for (let k = 0; k < j; k += 1) {
        sum -= l[i][k] * l[j][k];
      }

      if (i === j) {
        if (!Number.isFinite(sum) || sum <= 1e-12) {
          throw new Error(`Normal matrix not SPD at diagonal ${i} (pivot=${sum}).`);
        }
        l[i][j] = Math.sqrt(sum);
      } else {
        l[i][j] = sum / l[j][j];
      }
    }
  }
  return l;
};

const diagonalScale = (m: Matrix): number => {
  const n = m.length;
  let scale = 1;
  for (let i = 0; i < n; i += 1) {
    scale = Math.max(scale, Math.abs(m[i][i] ?? 0));
  }
  return scale;
};

const withDiagonalDamping = (m: Matrix, damping: number): Matrix =>
  m.map((row, i) => row.map((value, j) => (i === j ? value + damping : value)));

export const choleskyDecomposeWithDamping = (
  m: Matrix,
  {
    initialFactor = 1e-18,
    growthFactor = 10,
    maxAttempts = 24,
    minDamping = 1e-18,
  }: {
    initialFactor?: number;
    growthFactor?: number;
    maxAttempts?: number;
    minDamping?: number;
  } = {},
): DampedCholeskyResult => {
  try {
    return {
      factor: choleskyDecompose(m),
      damping: 0,
      attempts: 0,
    };
  } catch (error) {
    const scale = diagonalScale(m);
    let damping = Math.max(minDamping, scale * initialFactor);
    let lastError = error;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return {
          factor: choleskyDecompose(withDiagonalDamping(m, damping)),
          damping,
          attempts: attempt,
        };
      } catch (nextError) {
        lastError = nextError;
        damping *= growthFactor;
      }
    }

    const detail = lastError instanceof Error ? lastError.message : 'Unknown factorization error.';
    throw new Error(
      `Normal matrix could not be regularized for Cholesky after ${maxAttempts} damping attempts (last lambda=${damping / growthFactor}). ${detail}`,
    );
  }
};

export const forwardSubstitute = (l: Matrix, b: number[]): number[] => {
  const n = l.length;
  if (b.length !== n) {
    throw new Error('Forward substitution dimension mismatch.');
  }

  const y = new Array(n).fill(0);
  for (let i = 0; i < n; i += 1) {
    let sum = b[i];
    for (let k = 0; k < i; k += 1) {
      sum -= l[i][k] * y[k];
    }
    y[i] = sum / l[i][i];
  }
  return y;
};

export const backSubstitute = (l: Matrix, y: number[]): number[] => {
  const n = l.length;
  if (y.length !== n) {
    throw new Error('Back substitution dimension mismatch.');
  }

  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i -= 1) {
    let sum = y[i];
    for (let k = i + 1; k < n; k += 1) {
      sum -= l[k][i] * x[k];
    }
    x[i] = sum / l[i][i];
  }
  return x;
};

export const solveSPDFromCholesky = (l: Matrix, b: Matrix): Matrix => {
  const n = l.length;
  if (b.length !== n) {
    throw new Error('SPD solve dimension mismatch.');
  }
  const cols = b[0]?.length ?? 0;
  const x = zeros(n, cols);
  for (let col = 0; col < cols; col += 1) {
    const rhs = b.map((row) => row[col] ?? 0);
    const y = forwardSubstitute(l, rhs);
    const solved = backSubstitute(l, y);
    for (let row = 0; row < n; row += 1) {
      x[row][col] = solved[row];
    }
  }
  return x;
};

export const solveSPDCholesky = (m: Matrix, b: Matrix): Matrix =>
  solveSPDFromCholesky(choleskyDecompose(m), b);

export const solveSPDWithDamping = (
  m: Matrix,
  b: Matrix,
): { solution: Matrix; damping: number; attempts: number } => {
  const result = choleskyDecomposeWithDamping(m);
  return {
    solution: solveSPDFromCholesky(result.factor, b),
    damping: result.damping,
    attempts: result.attempts,
  };
};

export const invertSPDFromCholesky = (l: Matrix): Matrix => {
  const n = l.length;
  const identity = zeros(n, n);
  for (let i = 0; i < n; i += 1) {
    identity[i][i] = 1;
  }
  return solveSPDFromCholesky(l, identity);
};

export const invertSPDCholesky = (m: Matrix): Matrix =>
  invertSPDFromCholesky(choleskyDecompose(m));

export const invertSPDWithDamping = (
  m: Matrix,
): { inverse: Matrix; damping: number; attempts: number } => {
  const result = choleskyDecomposeWithDamping(m);
  return {
    inverse: invertSPDFromCholesky(result.factor),
    damping: result.damping,
    attempts: result.attempts,
  };
};

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

export const ldltDecomposeSymmetric = (
  m: Matrix,
  tolerance = 1e-14,
): PivotedLDLTResult => {
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

    if (Math.max(absakk, colmax) <= tolerance || !Number.isFinite(absakk) || !Number.isFinite(colmax)) {
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

export const inv = (m: Matrix): Matrix => {
  const n = m.length;
  const aug = m.map((row, i) => [
    ...row,
    ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  ]);

  for (let i = 0; i < n; i++) {
    let maxRow = i;
    for (let k = i + 1; k < n; k++) {
      if (Math.abs(aug[k][i]) > Math.abs(aug[maxRow][i])) maxRow = k;
    }
    [aug[i], aug[maxRow]] = [aug[maxRow], aug[i]];
    const pivot = aug[i][i];
    if (Math.abs(pivot) < 1e-10) {
      throw new Error('Singular Matrix');
    }
    for (let j = i; j < 2 * n; j++) aug[i][j] /= pivot;
    for (let k = 0; k < n; k++) {
      if (k !== i) {
        const factor = aug[k][i];
        for (let j = i; j < 2 * n; j++) aug[k][j] -= factor * aug[i][j];
      }
    }
  }
  return aug.map((row) => row.slice(n));
};
