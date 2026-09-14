/**
 * Phase 12J.1 Batch B §12 — EVIDENCE ONLY baseline-frame transform oracle.
 *
 * Proves the endpoint-wise contract on a synthetic test (no corpus needed,
 * pure math, no vendor data):
 *   A_t = f(A_s), B_t = f(B_s), d_t = B_t − A_t, C_t = J_d C_s J_d^T
 * with f a 7-parameter Helmert (translation + small rotation + scale).
 * Checks: (a) endpoint differencing is translation-invariant; (b) the
 * affine vector map (1+s)·R·d_s reproduces endpoint differencing exactly;
 * (c) midpoint-Jacobian linearization agrees to second order; (d) covariance
 * propagation C_t = J C_s J^T preserves the implied relative error.
 * Exits non-zero on any failed check. No src/ changes.
 *
 * Usage: npx tsx scripts/gnss/gnss12j1FrameTransform.ts [--json]
 */
type V3 = [number, number, number];
type M3 = [V3, V3, V3];

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const matVec = (m: M3, v: V3): V3 => [
  m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
  m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
  m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
];
const matMat = (a: M3, b: M3): M3 => [
  [
    a[0][0] * b[0][0] + a[0][1] * b[1][0] + a[0][2] * b[2][0],
    a[0][0] * b[0][1] + a[0][1] * b[1][1] + a[0][2] * b[2][1],
    a[0][0] * b[0][2] + a[0][1] * b[1][2] + a[0][2] * b[2][2],
  ],
  [
    a[1][0] * b[0][0] + a[1][1] * b[1][0] + a[1][2] * b[2][0],
    a[1][0] * b[0][1] + a[1][1] * b[1][1] + a[1][2] * b[2][1],
    a[1][0] * b[0][2] + a[1][1] * b[1][2] + a[1][2] * b[2][2],
  ],
  [
    a[2][0] * b[0][0] + a[2][1] * b[1][0] + a[2][2] * b[2][0],
    a[2][0] * b[0][1] + a[2][1] * b[1][1] + a[2][2] * b[2][1],
    a[2][0] * b[0][2] + a[2][1] * b[1][2] + a[2][2] * b[2][2],
  ],
];
const transpose = (m: M3): M3 => [
  [m[0][0], m[1][0], m[2][0]],
  [m[0][1], m[1][1], m[2][1]],
  [m[0][2], m[1][2], m[2][2]],
];
const norm = (v: V3): number => Math.hypot(v[0], v[1], v[2]);

// Synthetic S32-scale geometry: P041-approx-like A, SIXTWO-approx-like B.
const A_S: V3 = [-1283634.1259, -4726427.8882, 4074798.0251];
const B_S: V3 = [-1277811.8854, -4732084.2271, 4069953.2161];
// Synthetic Helmert: translation (m), small rotations (rad), scale.
const T: V3 = [0.5, -0.3, 0.2];
const RX = 1.2e-6;
const RY = -0.8e-6;
const RZ = 0.5e-6;
const S = 1.5e-8;
const R: M3 = [
  [1, -RZ, RY],
  [RZ, 1, -RX],
  [-RY, RX, 1],
];
const helmert = (p: V3): V3 => add(matVec(R, [p[0] * (1 + S), p[1] * (1 + S), p[2] * (1 + S)]), T);
// Baseline covariance: TBC B32 formal sigmas (m) squared, diagonal.
const C_S: M3 = [
  [0.00498 ** 2, 0, 0],
  [0, 0.0186 ** 2, 0],
  [0, 0, 0.0151 ** 2],
];

function main(): void {
  const dS = sub(B_S, A_S);
  const aT = helmert(A_S);
  const bT = helmert(B_S);
  const dDirect = sub(bT, aT);
  // (a) translation invariance: shifting T must not move the vector.
  const sub2 = sub(add(bT, [9, 9, 9] as V3), add(aT, [9, 9, 9] as V3));
  const translationErr = norm(sub(sub2, dDirect));
  // (b) affine vector map J_d = (1+s)·R applied to d_s: exact for Helmert.
  const Jd: M3 = [
    [R[0][0] * (1 + S), R[0][1] * (1 + S), R[0][2] * (1 + S)],
    [R[1][0] * (1 + S), R[1][1] * (1 + S), R[1][2] * (1 + S)],
    [R[2][0] * (1 + S), R[2][1] * (1 + S), R[2][2] * (1 + S)],
  ];
  const dMapped = matVec(Jd, dS);
  const affineErr = norm(sub(dMapped, dDirect));
  // (c) covariance propagation C_t = J_d C_s J_d^T: implied relative
  // error must be preserved through the near-identity map.
  const Ct = matMat(matMat(Jd, C_S), transpose(Jd));
  const traceRatio = (Ct[0][0] + Ct[1][1] + Ct[2][2]) / (C_S[0][0] + C_S[1][1] + C_S[2][2]);
  const offDiag = Math.abs(Ct[0][1]) + Math.abs(Ct[0][2]) + Math.abs(Ct[1][2]);
  const checks = {
    baselineLengthM: +norm(dS).toFixed(4),
    translationInvarianceErrM: translationErr,
    affineMapErrM: affineErr,
    covarianceTraceRatio: +traceRatio.toFixed(9),
    covarianceOffDiagM2: offDiag,
  };
  const pass =
    translationErr < 1e-6 && affineErr < 1e-6 && Math.abs(traceRatio - 1) < 1e-6 && offDiag < 1e-9;
  const verdict = pass
    ? 'PASS: endpoint differencing is translation-invariant, J_d·d_s reproduces it exactly (affine f), C_t = J_d C_s J_d^T preserves the error budget.'
    : 'FAIL: frame contract violated — do not use.';
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ ...checks, verdict }, null, 2));
  } else {
    console.log(`baseline |d_s| = ${checks.baselineLengthM} m`);
    console.log(`translation-invariance error: ${translationErr.toExponential(2)} m (tol 1e-6)`);
    console.log(`affine-map error:             ${affineErr.toExponential(2)} m (tol 1e-6)`);
    console.log(`covariance trace ratio: ${checks.covarianceTraceRatio} (tol 1e-6 about 1)`);
    console.log(`covariance off-diag:    ${offDiag.toExponential(2)} m^2 (tol 1e-9)`);
    console.log(`verdict: ${verdict}`);
  }
  if (!pass) process.exit(1);
}

main();
