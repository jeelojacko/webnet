/**
 * Phase 12C — shared-origin ENU <-> ECEF rotation for the import boundary.
 *
 * 12A mathdoc section 6 contract (normative):
 *   R = ECEF -> ENU at latitude phi, longitude lambda (degrees in, radians used)
 *   R = [ -sinL              cosL            0
 *         -sinP*cosL   -sinP*sinL      cosP
 *          cosP*cosL    cosP*sinL      sinP ]
 *   b_enu  = R   * b_ecef
 *   C_enu  = R   * C_ecef * R^T
 *   b_ecef = R^T * b_enu
 *   C_ecef = R^T * C_enu  * R
 *
 * Component order is East, North, Up. One constant R per file/network,
 * built from the single declared origin; the engine never rotates per
 * observation. Vector and covariance always travel together.
 */
import type {
  GnssBaselineCovariance,
  GnssBaselineVector,
} from './gnssBaselineTypes';

export type Matrix3x3 = [
  [number, number, number],
  [number, number, number],
  [number, number, number],
];

const degToRad = (degrees: number): number => (degrees * Math.PI) / 180;

/** ECEF -> ENU rotation at the declared origin. Throws on non-finite input. */
export const buildEnuRotation = (latDeg: number, lonDeg: number): Matrix3x3 => {
  if (!Number.isFinite(latDeg) || !Number.isFinite(lonDeg)) {
    throw new Error(
      `Invalid ENU origin: lat=${latDeg} lon=${lonDeg} must be finite degrees.`,
    );
  }
  if (latDeg < -90 || latDeg > 90) {
    throw new Error(`Invalid ENU origin latitude ${latDeg}: must be within [-90, 90].`);
  }
  const phi = degToRad(latDeg);
  const lambda = degToRad(lonDeg);
  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const sinLambda = Math.sin(lambda);
  const cosLambda = Math.cos(lambda);
  return [
    [-sinLambda, cosLambda, 0],
    [-sinPhi * cosLambda, -sinPhi * sinLambda, cosPhi],
    [cosPhi * cosLambda, cosPhi * sinLambda, sinPhi],
  ];
};

export const transpose3x3 = (matrix: Matrix3x3): Matrix3x3 => [
  [matrix[0][0], matrix[1][0], matrix[2][0]],
  [matrix[0][1], matrix[1][1], matrix[2][1]],
  [matrix[0][2], matrix[1][2], matrix[2][2]],
];

const multiply3x3 = (a: Matrix3x3, b: Matrix3x3): Matrix3x3 => {
  const out: Matrix3x3 = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      out[row][column] =
        a[row][0] * b[0][column] + a[row][1] * b[1][column] + a[row][2] * b[2][column];
    }
  }
  return out;
};

/** Max |R*R^T - I| entry. Must be ~1e-16 for a valid rotation. */
export const orthonormalityError = (rotation: Matrix3x3): number => {
  const product = multiply3x3(rotation, transpose3x3(rotation));
  let worst = 0;
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      const expected = row === column ? 1 : 0;
      worst = Math.max(worst, Math.abs(product[row][column] - expected));
    }
  }
  return worst;
};

/** Fail-closed orthonormality gate for an importer-supplied rotation. */
export const verifyRotationOrthonormal = (rotation: Matrix3x3, label: string): void => {
  const error = orthonormalityError(rotation);
  if (!Number.isFinite(error) || error > 1e-12) {
    throw new Error(
      `Invalid ENU rotation for ${label}: R*R^T deviates from I by ${error}.`,
    );
  }
};

const applyRotation = (
  rotation: Matrix3x3,
  vector: { x: number; y: number; z: number },
): { x: number; y: number; z: number } => ({
  x: rotation[0][0] * vector.x + rotation[0][1] * vector.y + rotation[0][2] * vector.z,
  y: rotation[1][0] * vector.x + rotation[1][1] * vector.y + rotation[1][2] * vector.z,
  z: rotation[2][0] * vector.x + rotation[2][1] * vector.y + rotation[2][2] * vector.z,
});

const denseOf = (covariance: GnssBaselineCovariance): Matrix3x3 => [
  [covariance.xx, covariance.xy, covariance.xz],
  [covariance.xy, covariance.yy, covariance.yz],
  [covariance.xz, covariance.yz, covariance.zz],
];

/** ENU -> ECEF: b_ecef = R^T * b_enu. */
export const rotateEnuVectorToEcef = (
  rotation: Matrix3x3,
  vector: GnssBaselineVector,
): GnssBaselineVector => applyRotation(transpose3x3(rotation), vector);

/** ECEF -> ENU: b_enu = R * b_ecef (test/reference direction). */
export const rotateEcefVectorToEnu = (
  rotation: Matrix3x3,
  vector: GnssBaselineVector,
): GnssBaselineVector => applyRotation(rotation, vector);

/**
 * ENU -> ECEF: C_ecef = R^T * C_enu * R.
 * Symmetry is enforced by construction (lower triangle mirrored).
 */
export const rotateEnuCovarianceToEcef = (
  rotation: Matrix3x3,
  covariance: GnssBaselineCovariance,
): GnssBaselineCovariance => {
  const dense = denseOf(covariance);
  const rt = transpose3x3(rotation);
  const result = multiply3x3(multiply3x3(rt, dense), rotation);
  return {
    xx: result[0][0],
    xy: (result[0][1] + result[1][0]) / 2,
    xz: (result[0][2] + result[2][0]) / 2,
    yy: result[1][1],
    yz: (result[1][2] + result[2][1]) / 2,
    zz: result[2][2],
  };
};

/** ECEF -> ENU: C_enu = R * C_ecef * R^T (test/reference direction). */
export const rotateEcefCovarianceToEnu = (
  rotation: Matrix3x3,
  covariance: GnssBaselineCovariance,
): GnssBaselineCovariance => {
  const dense = denseOf(covariance);
  const result = multiply3x3(multiply3x3(rotation, dense), transpose3x3(rotation));
  return {
    xx: result[0][0],
    xy: (result[0][1] + result[1][0]) / 2,
    xz: (result[0][2] + result[2][0]) / 2,
    yy: result[1][1],
    yz: (result[1][2] + result[2][1]) / 2,
    zz: result[2][2],
  };
}
