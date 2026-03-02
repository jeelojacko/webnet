export type Matrix = number[][];
export interface DampedCholeskyResult {
  factor: Matrix;
  damping: number;
  attempts: number;
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
