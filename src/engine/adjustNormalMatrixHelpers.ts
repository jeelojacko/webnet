import { invertSymmetricLDLTWithInfo } from './matrix';

export const matrixIsFinite = (m: number[][]): boolean =>
  m.every((row) => row.every((value) => Number.isFinite(value)));

export const scaleNormalMatrix = (normal: number[][]): { scaled: number[][]; scale: number[] } => {
  const scale = normal.map((row, i) => {
    const diag = Math.abs(row[i] ?? 0);
    return diag > 1e-30 && Number.isFinite(diag) ? 1 / Math.sqrt(diag) : 1;
  });
  const scaled = normal.map((row, i) => row.map((value, j) => value * scale[i] * scale[j]));
  return { scaled, scale };
};

export const scaleNormalRhs = (rhs: number[][], scale: number[]): number[][] =>
  rhs.map((row, i) => row.map((value) => value * scale[i]));

export const unscaleNormalSolution = (solution: number[][], scale: number[]): number[][] =>
  solution.map((row, i) => row.map((value) => value * scale[i]));

export const unscaleNormalInverse = (inverse: number[][], scale: number[]): number[][] =>
  inverse.map((row, i) => row.map((value, j) => value * scale[i] * scale[j]));

export const recoverUndampedInverse = (
  scaledN: number[][],
  scale: number[],
  fallbackInverse: number[][],
  context: string,
  log: (_message: string) => void,
): number[][] => {
  try {
    const recovery = invertSymmetricLDLTWithInfo(scaledN);
    const pivotSuffix =
      recovery.twoByTwoPivotCount > 0 ? ` (2x2 pivot blocks=${recovery.twoByTwoPivotCount})` : '';
    log(
      `Warning: ${context} used pivoted symmetric LDLT recovery on the scaled undamped normal matrix to avoid damping bias in covariance output${pivotSuffix}.`,
    );
    return unscaleNormalInverse(recovery.inverse, scale);
  } catch (error) {
    const detail = error instanceof Error ? ` ${error.message}` : '';
    log(
      `Warning: ${context} could not recover the undamped covariance after regularization; using damped covariance instead.${detail}`,
    );
    return unscaleNormalInverse(fallbackInverse, scale);
  }
};
