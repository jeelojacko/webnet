export type Matrix = number[][];

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
