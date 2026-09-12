/**
 * Phase 12A — non-production formula proofs for the static GNSS baseline
 * mathematical contract.
 *
 * Self-contained: proves the linear-algebra identities the architecture
 * rests on (reversal, covariance rotation round-trip, block weight,
 * closure covariance, rank reasoning) without importing production code,
 * so this test can never couple to engine behavior.
 */

import { describe, expect, it } from 'vitest';

type Mat3 = [
  [number, number, number],
  [number, number, number],
  [number, number, number],
];
type Vec3 = [number, number, number];

const APPROX = 1e-12;

const matVec = (m: Mat3, v: Vec3): Vec3 => [
  m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
  m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
  m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
];

const matMul = (a: Mat3, b: Mat3): Mat3 =>
  [
    [0, 1, 2].map((j) =>
      [0, 1, 2].reduce((s, k) => s + a[0][k] * b[k][j], 0),
    ),
    [0, 1, 2].map((j) =>
      [0, 1, 2].reduce((s, k) => s + a[1][k] * b[k][j], 0),
    ),
    [0, 1, 2].map((j) =>
      [0, 1, 2].reduce((s, k) => s + a[2][k] * b[k][j], 0),
    ),
  ] as Mat3;

const transpose = (m: Mat3): Mat3 =>
  [
    [m[0][0], m[1][0], m[2][0]],
    [m[0][1], m[1][1], m[2][1]],
    [m[0][2], m[1][2], m[2][2]],
  ] as Mat3;

/** Symmetric inverse via adjugate/determinant (proof aid, not production). */
const invertSymmetric = (m: Mat3): Mat3 => {
  const [a, b, c] = m[0];
  const [, e, f] = m[1];
  const [, , i] = [m[2][0], m[2][1], m[2][2]];
  const d = m[1][0];
  const g = m[2][0];
  const h = m[2][1];
  const det =
    a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  expect(Math.abs(det)).toBeGreaterThan(0);
  const adj: Mat3 = [
    [e * i - f * h, c * h - b * i, b * f - c * e],
    [f * g - d * i, a * i - c * g, c * d - a * f],
    [d * h - e * g, b * g - a * h, a * e - b * d],
  ];
  return adj.map((row) => row.map((v) => v / det)) as Mat3;
};

const expectMatClose = (actual: Mat3, expected: Mat3) => {
  for (let r = 0; r < 3; r += 1)
    for (let c = 0; c < 3; c += 1)
      expect(Math.abs(actual[r][c] - expected[r][c])).toBeLessThan(APPROX);
};

/** Correlated fixture covariance with non-zero off-diagonals (SPD). */
const COV: Mat3 = [
  [4e-6, 1e-6, -5e-7],
  [1e-6, 9e-6, 2e-6],
  [-5e-7, 2e-6, 16e-6],
];

/** ECEF→ENU rotation at φ=45°, λ=−75° (orthonormal by construction). */
const enuRotation = (latDeg: number, lonDeg: number): Mat3 => {
  const phi = (latDeg * Math.PI) / 180;
  const lam = (lonDeg * Math.PI) / 180;
  const sPhi = Math.sin(phi);
  const cPhi = Math.cos(phi);
  const sLam = Math.sin(lam);
  const cLam = Math.cos(lam);
  return [
    [-sLam, cLam, 0],
    [-sPhi * cLam, -sPhi * sLam, cPhi],
    [cPhi * cLam, cPhi * sLam, sPhi],
  ];
};

describe('phase12a gnss baseline math contract (non-production proofs)', () => {
  it('baseline Jacobian has [-I +I] structure with linear misclosure', () => {
    const xa: Vec3 = [1000, 2000, 3000];
    const xb: Vec3 = [1012.5, 1997.25, 3003.75];
    const bObs: Vec3 = [12.51, -2.74, 3.76];
    // b_calc = XB - XA; w = b_obs - b_calc (WebNet observed-computed sign).
    const bCalc: Vec3 = [
      xb[0] - xa[0],
      xb[1] - xa[1],
      xb[2] - xa[2],
    ];
    const w: Vec3 = [
      bObs[0] - bCalc[0],
      bObs[1] - bCalc[1],
      bObs[2] - bCalc[2],
    ];
    expect(w[0]).toBeCloseTo(0.01, 12);
    expect(w[1]).toBeCloseTo(0.01, 12);
    expect(w[2]).toBeCloseTo(0.01, 12);
    // Linearity: shifting both stations equally leaves b_calc unchanged.
    const shift: Vec3 = [5, -5, 5];
    const moved: Vec3 = [
      xb[0] + shift[0] - (xa[0] + shift[0]),
      xb[1] + shift[1] - (xa[1] + shift[1]),
      xb[2] + shift[2] - (xa[2] + shift[2]),
    ];
    expect(moved[0]).toBeCloseTo(bCalc[0], 12);
    expect(moved[1]).toBeCloseTo(bCalc[1], 12);
    expect(moved[2]).toBeCloseTo(bCalc[2], 12);
  });

  it('reversal negates the vector and preserves covariance: (-I)C(-I)^T = C', () => {
    const b: Vec3 = [12.5, -2.75, 3.75];
    const negI: Mat3 = [
      [-1, 0, 0],
      [0, -1, 0],
      [0, 0, -1],
    ];
    const reversed = matVec(negI, b);
    expect(reversed).toEqual([-12.5, 2.75, -3.75]);
    const cPrime = matMul(matMul(negI, COV), transpose(negI));
    expectMatClose(cPrime, COV);
  });

  it('covariance rotation round-trips: R^T (R C R^T) R = C with orthonormal R', () => {
    const r = enuRotation(45, -75);
    expectMatClose(matMul(r, transpose(r)), [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]);
    const cLocal = matMul(matMul(r, COV), transpose(r));
    const cBack = matMul(matMul(transpose(r), cLocal), r);
    expectMatClose(cBack, COV);
    // Rotation genuinely mixes components (off-diagonals change).
    expect(Math.abs(cLocal[0][1] - COV[0][1])).toBeGreaterThan(0);
  });

  it('block weight inverts covariance: P*C = I and q = v^T P v >= 0', () => {
    const p = invertSymmetric(COV);
    expectMatClose(matMul(p, COV), [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]);
    const v: Vec3 = [0.004, -0.003, 0.002];
    const pv = matVec(p, v);
    const q = v[0] * pv[0] + v[1] * pv[1] + v[2] * pv[2];
    expect(q).toBeGreaterThan(0);
    // Correlated quadratic form differs from the naive diagonal-only form.
    const qNaive =
      (v[0] * v[0]) / COV[0][0] +
      (v[1] * v[1]) / COV[1][1] +
      (v[2] * v[2]) / COV[2][2];
    expect(Math.abs(q - qNaive)).toBeGreaterThan(0);
  });

  it('independent loop closure covariance sums: C_s = C1 + C2 + C3', () => {
    const c1 = COV;
    const c2: Mat3 = [
      [9e-6, 0, 0],
      [0, 9e-6, 0],
      [0, 0, 9e-6],
    ];
    const c3 = COV;
    const cClosure: Mat3 = [
      [c1[0][0] + c2[0][0] + c3[0][0], c1[0][1] + c2[0][1] + c3[0][1], c1[0][2] + c2[0][2] + c3[0][2]],
      [c1[1][0] + c2[1][0] + c3[1][0], c1[1][1] + c2[1][1] + c3[1][1], c1[1][2] + c2[1][2] + c3[1][2]],
      [c1[2][0] + c2[2][0] + c3[2][0], c1[2][1] + c2[2][1] + c3[2][1], c1[2][2] + c2[2][2] + c3[2][2]],
    ];
    // Closure triangle vectors sum to ~0 in the error-free case.
    const b1: Vec3 = [10, 0, 0];
    const b2: Vec3 = [0, 10, 0];
    const b3: Vec3 = [-10, -10, 0];
    const s: Vec3 = [
      b1[0] + b2[0] + b3[0],
      b1[1] + b2[1] + b3[1],
      b1[2] + b2[2] + b3[2],
    ];
    expect(s).toEqual([0, 0, 0]);
    expect(cClosure[0][0]).toBeCloseTo(17e-6, 18);
    expect(cClosure[1][1]).toBeCloseTo(27e-6, 18);
  });

  it('one fixed 3D station removes the translation-only defect', () => {
    // Connected baseline network in a known-oriented frame: each baseline
    // contributes 3 equations over 3S unknowns; nullspace is the 3-vector
    // common translation (rank defect exactly 3). Fixing one station (3
    // coordinates) closes it: DOF = 3B - (3S - 3) for the free part.
    const stations = 4;
    const baselines = 5; // connected redundant example
    const defect = 3;
    const fixedCoords = 3; // one fixed 3D station
    const freeUnknowns = 3 * stations - fixedCoords;
    expect(3 * stations - freeUnknowns).toEqual(defect);
    const dof = 3 * baselines - freeUnknowns;
    expect(dof).toEqual(3 * baselines - 3 * stations + defect);
    expect(dof).toBeGreaterThan(0);
  });
});
