/** OLS descriptive trend + sign-run helpers for systematic pattern diagnostics. */

export interface OlsTrend {
  slope: number;
  intercept: number;
  /**
   * Deterministic design-collinearity proxy from the regressor spread only:
   * -mean(x)/sqrt(mean(x^2)). It is a pure function of where observations
   * fall on the x-axis, not a stochastic correlation between coefficient
   * estimates: adjusted residuals are correlated (Cov(v) = Qvv), so no
   * IID-based correlation interpretation applies. Used only as a heuristic
   * practical-separability guard for intercept-vs-slope shape descriptors.
   */
  designCollinearity: number;
}

/** Ordinary least squares on (xs, ys); null when degenerate. No p-values. */
export const olsTrend = (xs: number[], ys: number[]): OlsTrend | null => {
  const n = xs.length;
  if (n < 2 || ys.length !== n) return null;
  let sumX = 0;
  let sumY = 0;
  let sumXX = 0;
  let sumXY = 0;
  for (let i = 0; i < n; i += 1) {
    const x = xs[i];
    const y = ys[i];
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    sumX += x;
    sumY += y;
    sumXX += x * x;
    sumXY += x * y;
  }
  const denom = n * sumXX - sumX * sumX;
  if (!(denom > 0)) return null;
  const slope = (n * sumXY - sumX * sumY) / denom;
  const meanX = sumX / n;
  const meanY = sumY / n;
  const intercept = meanY - slope * meanX;
  const meanXX = sumXX / n;
  const collinearity = meanXX > 0 ? -meanX / Math.sqrt(meanXX) : 0;
  return { slope, intercept, designCollinearity: collinearity };
};

export interface SignRunStats {
  pos: number;
  neg: number;
  longestPos: number;
  longestNeg: number;
  longestSameSign: number;
  signChanges: number;
}

/** Descriptive sign-run counts over an ordered sign sequence (+1/-1/0). */
export const signRunStats = (signs: number[]): SignRunStats => {
  let pos = 0;
  let neg = 0;
  let longestPos = 0;
  let longestNeg = 0;
  let runSign = 0;
  let runLen = 0;
  let signChanges = 0;
  let prevNonZero = 0;
  for (const s of signs) {
    if (s > 0) pos += 1;
    else if (s < 0) neg += 1;
    else continue;
    const cur = s > 0 ? 1 : -1;
    if (prevNonZero !== 0 && cur !== prevNonZero) signChanges += 1;
    prevNonZero = cur;
    if (cur === runSign) {
      runLen += 1;
    } else {
      runSign = cur;
      runLen = 1;
    }
    if (cur > 0) longestPos = Math.max(longestPos, runLen);
    else longestNeg = Math.max(longestNeg, runLen);
  }
  return {
    pos,
    neg,
    longestPos,
    longestNeg,
    longestSameSign: Math.max(longestPos, longestNeg),
    signChanges,
  };
};

/** Sign of a residual with a tiny zero tolerance; 0 counts as untestable. */
export const residualSign = (value: number, tol = 1e-12): number => {
  if (!Number.isFinite(value)) return 0;
  if (value > tol) return 1;
  if (value < -tol) return -1;
  return 0;
};
