/**
 * Phase 12J.5 — stochastic evidence helpers (EVIDENCE ONLY).
 *
 * Pure functions for offline calibration analysis of formal GNSS covariances.
 * No production math changes; nothing here enters the solve path.
 * Units: metres, m^2, radians internally.
 */
import type { GnssBaselineCovariance } from './gnssBaselineTypes';
import type { ProcessedRawGnssBaseline } from './gnssRawTypes';

export type Vec3 = [number, number, number];
export type Mat3 = [Vec3, Vec3, Vec3];

export interface EmpiricalCovarianceResult {
  mean: Vec3;
  cov: GnssBaselineCovariance;
  n: number;
}

export interface ScaleRatioDiagnostics {
  xx: number;
  yy: number;
  zz: number;
  trace: number;
  sigmaX: number;
  sigmaY: number;
  sigmaZ: number;
}

export interface ClosureInput {
  d: Vec3;
  c: GnssBaselineCovariance;
}

export interface LoopClosureResult {
  closure: Vec3;
  cSum: GnssBaselineCovariance;
  T: number;
}

/** Mean of baseline vectors. Throws on empty input. */
export function meanBaseline(vectors: Vec3[]): Vec3 {
  if (vectors.length === 0) throw new Error('meanBaseline requires >= 1 vector');
  let x = 0;
  let y = 0;
  let z = 0;
  for (const v of vectors) {
    x += v[0];
    y += v[1];
    z += v[2];
  }
  const n = vectors.length;
  return [x / n, y / n, z / n];
}

/** Sample covariance with 1/(n-1). Throws when n < 2. */
export function empiricalCovariance(vectors: Vec3[]): EmpiricalCovarianceResult {
  if (vectors.length < 2) throw new Error('empiricalCovariance requires >= 2 vectors');
  const mean = meanBaseline(vectors);
  const n = vectors.length;
  let xx = 0;
  let xy = 0;
  let xz = 0;
  let yy = 0;
  let yz = 0;
  let zz = 0;
  for (const v of vectors) {
    const dx = v[0] - mean[0];
    const dy = v[1] - mean[1];
    const dz = v[2] - mean[2];
    xx += dx * dx;
    xy += dx * dy;
    xz += dx * dz;
    yy += dy * dy;
    yz += dy * dz;
    zz += dz * dz;
  }
  const s = 1 / (n - 1);
  return { mean, cov: { xx: xx * s, xy: xy * s, xz: xz * s, yy: yy * s, yz: yz * s, zz: zz * s }, n };
}

/** Element-wise mean of formal covariances. Throws on empty input. */
export function averageFormalCovariance(
  baselines: Pick<ProcessedRawGnssBaseline, 'covariance'>[],
): GnssBaselineCovariance {
  if (baselines.length === 0) throw new Error('averageFormalCovariance requires >= 1 baseline');
  let xx = 0;
  let xy = 0;
  let xz = 0;
  let yy = 0;
  let yz = 0;
  let zz = 0;
  for (const b of baselines) {
    xx += b.covariance.xx;
    xy += b.covariance.xy;
    xz += b.covariance.xz;
    yy += b.covariance.yy;
    yz += b.covariance.yz;
    zz += b.covariance.zz;
  }
  const n = baselines.length;
  return { xx: xx / n, xy: xy / n, xz: xz / n, yy: yy / n, yz: yz / n, zz: zz / n };
}

function ratio(a: number, b: number): number {
  if (b === 0) return a === 0 ? 1 : Number.POSITIVE_INFINITY;
  return a / b;
}

/** Per-component variance ratios + trace ratio + per-axis sigma ratios. */
export function scaleRatioDiagnostics(
  empirical: GnssBaselineCovariance,
  formal: GnssBaselineCovariance,
): ScaleRatioDiagnostics {
  const xx = ratio(empirical.xx, formal.xx);
  const yy = ratio(empirical.yy, formal.yy);
  const zz = ratio(empirical.zz, formal.zz);
  const trace = ratio(
    empirical.xx + empirical.yy + empirical.zz,
    formal.xx + formal.yy + formal.zz,
  );
  return {
    xx,
    yy,
    zz,
    trace,
    sigmaX: Math.sqrt(xx),
    sigmaY: Math.sqrt(yy),
    sigmaZ: Math.sqrt(zz),
  };
}

/** Standard ECEF->ENU rotation at geocentric point xyz (rows: E, N, U). */
export function ecefToEnuRotation(xyz: Vec3): Mat3 {
  const [x, y, z] = xyz;
  const p = Math.hypot(x, y);
  const lon = Math.atan2(y, x);
  const lat = Math.atan2(z, p);
  const sLon = Math.sin(lon);
  const cLon = Math.cos(lon);
  const sLat = Math.sin(lat);
  const cLat = Math.cos(lat);
  return [
    [-sLon, cLon, 0],
    [-sLat * cLon, -sLat * sLon, cLat],
    [cLat * cLon, cLat * sLon, sLat],
  ];
}

export function covToMatrix(c: GnssBaselineCovariance): Mat3 {
  return [
    [c.xx, c.xy, c.xz],
    [c.xy, c.yy, c.yz],
    [c.xz, c.yz, c.zz],
  ];
}

export function matrixToCov(m: Mat3): GnssBaselineCovariance {
  return {
    xx: m[0][0],
    xy: (m[0][1] + m[1][0]) / 2,
    xz: (m[0][2] + m[2][0]) / 2,
    yy: m[1][1],
    yz: (m[1][2] + m[2][1]) / 2,
    zz: m[2][2],
  };
}

function matMul(a: Mat3, b: Mat3): Mat3 {
  const out: Mat3 = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      out[i][j] = a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j];
    }
  }
  return out;
}

function transpose(m: Mat3): Mat3 {
  return [
    [m[0][0], m[1][0], m[2][0]],
    [m[0][1], m[1][1], m[2][1]],
    [m[0][2], m[1][2], m[2][2]],
  ];
}

/** C_enu = R C R^T. */
export function rotateCovariance(cov: GnssBaselineCovariance, r: Mat3): GnssBaselineCovariance {
  const c = covToMatrix(cov);
  return matrixToCov(matMul(matMul(r, c), transpose(r)));
}

/** Rotate an ENU covariance back to ECEF: C = R^T C_enu R. */
function rotateCovarianceBack(enu: Mat3, r: Mat3): GnssBaselineCovariance {
  const rt = transpose(r);
  return matrixToCov(matMul(matMul(rt, enu), r));
}

function det3(m: Mat3): number {
  return (
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
  );
}

/**
 * Hotelling-style statistic T = d^T C^-1 d via closed-form 3x3 inverse.
 * Under H0 (d ~ N(0, C)) T follows chi-square with 3 DOF.
 * Throws when C is not symmetric positive-definite.
 */
export function normalizedDifferenceT(d: Vec3, cSum: GnssBaselineCovariance): number {
  const m = covToMatrix(cSum);
  const det = det3(m);
  if (!(det > 0) || !Number.isFinite(det)) throw new Error('normalizedDifferenceT: covariance is not SPD');
  const inv: Mat3 = [
    [
      (m[1][1] * m[2][2] - m[1][2] * m[2][1]) / det,
      (m[0][2] * m[2][1] - m[0][1] * m[2][2]) / det,
      (m[0][1] * m[1][2] - m[0][2] * m[1][1]) / det,
    ],
    [
      (m[1][2] * m[2][0] - m[1][0] * m[2][2]) / det,
      (m[0][0] * m[2][2] - m[0][2] * m[2][0]) / det,
      (m[0][2] * m[1][0] - m[0][0] * m[1][2]) / det,
    ],
    [
      (m[1][0] * m[2][1] - m[1][1] * m[2][0]) / det,
      (m[0][1] * m[2][0] - m[0][0] * m[2][1]) / det,
      (m[0][0] * m[1][1] - m[0][1] * m[1][0]) / det,
    ],
  ];
  // Leading principal minors must be positive for SPD.
  if (!(m[0][0] > 0 && m[0][0] * m[1][1] - m[0][1] * m[0][1] > 0)) {
    throw new Error('normalizedDifferenceT: covariance is not SPD');
  }
  const t0 = inv[0][0] * d[0] + inv[0][1] * d[1] + inv[0][2] * d[2];
  const t1 = inv[1][0] * d[0] + inv[1][1] * d[1] + inv[1][2] * d[2];
  const t2 = inv[2][0] * d[0] + inv[2][1] * d[1] + inv[2][2] * d[2];
  const t = d[0] * t0 + d[1] * t1 + d[2] * t2;
  if (!Number.isFinite(t) || t < 0) throw new Error('normalizedDifferenceT: covariance is not SPD');
  return t;
}

/** Sum loop vectors + covariances, then the T statistic. */
export function loopClosureT(closures: ClosureInput[]): LoopClosureResult {
  if (closures.length === 0) throw new Error('loopClosureT requires >= 1 leg');
  const closure: Vec3 = [0, 0, 0];
  const cSum: GnssBaselineCovariance = { xx: 0, xy: 0, xz: 0, yy: 0, yz: 0, zz: 0 };
  for (const leg of closures) {
    closure[0] += leg.d[0];
    closure[1] += leg.d[1];
    closure[2] += leg.d[2];
    cSum.xx += leg.c.xx;
    cSum.xy += leg.c.xy;
    cSum.xz += leg.c.xz;
    cSum.yy += leg.c.yy;
    cSum.yz += leg.c.yz;
    cSum.zz += leg.c.zz;
  }
  return { closure, cSum, T: normalizedDifferenceT(closure, cSum) };
}

/** Model F: identity (formal covariance unchanged). */
export function applyModelF(cov: GnssBaselineCovariance): GnssBaselineCovariance {
  return { ...cov };
}

/** Model S: uniform variance scale by s^2. */
export function applyModelS(cov: GnssBaselineCovariance, s: number): GnssBaselineCovariance {
  if (!(s > 0) || !Number.isFinite(s)) throw new Error('applyModelS requires finite s > 0');
  const k = s * s;
  return { xx: cov.xx * k, xy: cov.xy * k, xz: cov.xz * k, yy: cov.yy * k, yz: cov.yz * k, zz: cov.zz * k };
}

/**
 * Model ENU-floor: add diagonal variance floors (hFloor^2 E/N, vFloor^2 U)
 * in ENU, then rotate back to ECEF. Floors are sigmas in metres.
 */
export function applyModelEnuFloor(
  cov: GnssBaselineCovariance,
  xyz: Vec3,
  hFloor: number,
  vFloor: number,
): GnssBaselineCovariance {
  if (!Number.isFinite(hFloor) || hFloor < 0 || !Number.isFinite(vFloor) || vFloor < 0) {
    throw new Error('applyModelEnuFloor requires finite floors >= 0');
  }
  const r = ecefToEnuRotation(xyz);
  const enu = matMul(matMul(r, covToMatrix(cov)), transpose(r));
  enu[0][0] += hFloor * hFloor;
  enu[1][1] += hFloor * hFloor;
  enu[2][2] += vFloor * vFloor;
  return rotateCovarianceBack(enu, r);
}

/**
 * Model C+L: constant + ppm-with-length variance in ENU, rotated back.
 * sigmaH^2 = cH^2 + (ppmH*1e-6*lengthM)^2 added to E/N;
 * sigmaV^2 likewise to U.
 */
export function applyModelCL(
  cov: GnssBaselineCovariance,
  xyz: Vec3,
  cH: number,
  ppmH: number,
  cV: number,
  ppmV: number,
  lengthM: number,
): GnssBaselineCovariance {
  for (const v of [cH, ppmH, cV, ppmV, lengthM]) {
    if (!Number.isFinite(v) || v < 0) throw new Error('applyModelCL requires finite args >= 0');
  }
  const r = ecefToEnuRotation(xyz);
  const enu = matMul(matMul(r, covToMatrix(cov)), transpose(r));
  const sH2 = cH * cH + (ppmH * 1e-6 * lengthM) ** 2;
  const sV2 = cV * cV + (ppmV * 1e-6 * lengthM) ** 2;
  enu[0][0] += sH2;
  enu[1][1] += sH2;
  enu[2][2] += sV2;
  return rotateCovarianceBack(enu, r);
}

/** erf approximation (Abramowitz–Stegun 7.1.26), ~1e-7 accuracy. */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-ax * ax);
  return sign * y;
}

/**
 * Closed-form chi-square CDF for 3 DOF:
 * F(x) = erf(sqrt(x/2)) - sqrt(2x/pi) e^{-x/2}. Returns 0 for x <= 0.
 */
export function chi2Cdf3(x: number): number {
  if (!Number.isFinite(x) || x <= 0) return 0;
  const v = erf(Math.sqrt(x / 2)) - Math.sqrt((2 * x) / Math.PI) * Math.exp(-x / 2);
  return Math.min(1, Math.max(0, v));
}

/** Upper-tail p-value 1 - F(T) for 3 DOF. */
export function chi2PValue3(t: number): number {
  return 1 - chi2Cdf3(t);
}
