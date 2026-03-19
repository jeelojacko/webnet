import type { AdjustmentResult } from '../types';

const EPS = 1e-10;

const gammln = (xx: number): number => {
  const cof = [
    76.180091729471,
    -86.505320329417,
    24.014098240831,
    -1.23173957245,
    1.208650973866e-3,
    -5.395239384953e-6,
  ];
  let x = xx;
  let y = xx;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < cof.length; j += 1) {
    y += 1;
    ser += cof[j] / y;
  }
  return -tmp + Math.log((2.506628274631 * ser) / x);
};

const gser = (a: number, x: number): number => {
  if (x <= 0) return 0;
  let sum = 1 / a;
  let del = sum;
  let ap = a;
  for (let n = 1; n <= 100; n += 1) {
    ap += 1;
    del *= x / ap;
    sum += del;
    if (Math.abs(del) < Math.abs(sum) * EPS) break;
  }
  return sum * Math.exp(-x + a * Math.log(x) - gammln(a));
};

const gcf = (a: number, x: number): number => {
  let b = x + 1 - a;
  let c = 1 / 1e-30;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i <= 100; i += 1) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = b + an / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return Math.exp(-x + a * Math.log(x) - gammln(a)) * h;
};

const gammp = (a: number, x: number): number => {
  if (x < 0 || a <= 0) return 0;
  if (x < a + 1) {
    return gser(a, x);
  }
  return 1 - gcf(a, x);
};

export const chiSquarePValue = (T: number, dof: number): number => {
  if (dof <= 0 || T < 0) return 0;
  const a = dof / 2;
  const x = T / 2;
  const cdf = gammp(a, x);
  return Math.max(0, Math.min(1, 1 - cdf));
};

export const chiSquareQuantile = (prob: number, dof: number): number => {
  if (dof <= 0) return 0;
  if (prob <= 0) return 0;
  if (prob >= 1) return Number.POSITIVE_INFINITY;
  const a = dof / 2;
  const cdf = (x: number) => gammp(a, x / 2);

  let lo = 0;
  let hi = Math.max(1, dof + 10 * Math.sqrt(2 * dof));
  while (cdf(hi) < prob) {
    hi *= 2;
    if (hi > 1e9) break;
  }

  for (let i = 0; i < 80; i += 1) {
    const mid = 0.5 * (lo + hi);
    if (cdf(mid) < prob) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return 0.5 * (lo + hi);
};

export const buildChiSquareSummary = (
  weightedResidualSum: number,
  dof: number,
  alpha = 0.05,
): AdjustmentResult['chiSquare'] | undefined => {
  if (dof <= 0) return undefined;
  const lower = chiSquareQuantile(alpha / 2, dof);
  const upper = chiSquareQuantile(1 - alpha / 2, dof);
  const pUpper = chiSquarePValue(weightedResidualSum, dof);
  const pLower = 1 - pUpper;
  const pTwo = Math.max(0, Math.min(1, 2 * Math.min(pUpper, pLower)));
  const varianceFactor = weightedResidualSum / dof;
  return {
    T: weightedResidualSum,
    dof,
    p: pTwo,
    pass95: weightedResidualSum >= lower && weightedResidualSum <= upper,
    alpha,
    lower,
    upper,
    varianceFactor,
    varianceFactorLower: lower / dof,
    varianceFactorUpper: upper / dof,
  };
};
