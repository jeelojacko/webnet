/**
 * Phase 12B — deterministic 3x3 covariance validation and inversion for
 * static GNSS baseline observations.
 *
 * Canonical storage is covariance (m^2), never correlation. Inversion
 * happens at solve preparation; the importer/parser layer (Phase 12C)
 * normalizes units once. Nothing here repairs malformed input: invalid
 * covariance fails closed with a deterministic error.
 */
import type { GnssBaselineCovariance } from './gnssBaselineTypes';

export type GnssCovarianceMatrix = [
  [number, number, number],
  [number, number, number],
  [number, number, number],
];

export const gnssCovarianceToDense = (
  covariance: GnssBaselineCovariance,
): GnssCovarianceMatrix => [
  [covariance.xx, covariance.xy, covariance.xz],
  [covariance.xy, covariance.yy, covariance.yz],
  [covariance.xz, covariance.yz, covariance.zz],
];

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/**
 * Strict positive-definite validation via Cholesky decomposition.
 * Rejects non-finite values, non-positive diagonal, and non-PD matrices
 * (non-positive pivots). No epsilon repair, no clamping, no symmetrization
 * of conflicting input: the six stored values ARE the symmetric matrix.
 */
export const validateGnssBaselineCovariance = (
  covariance: GnssBaselineCovariance,
  label: string,
): void => {
  const { xx, xy, xz, yy, yz, zz } = covariance;
  for (const [name, value] of [
    ['xx', xx],
    ['xy', xy],
    ['xz', xz],
    ['yy', yy],
    ['yz', yz],
    ['zz', zz],
  ] as const) {
    if (!isFiniteNumber(value)) {
      throw new Error(
        `Invalid GNSS baseline covariance for ${label}: ${name} is not finite.`,
      );
    }
  }
  if (xx <= 0 || yy <= 0 || zz <= 0) {
    throw new Error(
      `Invalid GNSS baseline covariance for ${label}: variances must be positive ` +
        `(xx=${xx}, yy=${yy}, zz=${zz}).`,
    );
  }
  // Cholesky pivot sequence for [[xx,xy,xz],[xy,yy,yz],[xz,yz,zz]].
  // First pivot is xx, already proven positive above.
  const pivot2 = yy - (xy * xy) / xx;
  if (!(pivot2 > 0)) {
    throw new Error(
      `Invalid GNSS baseline covariance for ${label}: matrix is not positive definite (2x2 pivot ${pivot2}).`,
    );
  }
  const l31 = xz / xx;
  const l32 = (yz - (xy * xz) / xx) / pivot2;
  const pivot3 = zz - l31 * l31 * xx - l32 * l32 * pivot2;
  if (!(pivot3 > 0)) {
    throw new Error(
      `Invalid GNSS baseline covariance for ${label}: matrix is not positive definite (3x3 pivot ${pivot3}).`,
    );
  }
};

const determinant3x3 = (matrix: GnssCovarianceMatrix): number => {
  const [[a, b, c], [d, e, f], [g, h, i]] = matrix;
  return a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
};

/**
 * Full 3x3 inverse via adjugate/determinant with a C*P~=I verification.
 * Callers must validate first; inversion re-checks the determinant so a
 * near-singular matrix that passed validation marginally still fails
 * closed here instead of producing an unbounded weight block.
 */
export const invertGnssBaselineCovariance = (
  covariance: GnssBaselineCovariance,
  label: string,
): GnssCovarianceMatrix => {
  validateGnssBaselineCovariance(covariance, label);
  const matrix = gnssCovarianceToDense(covariance);
  const [[a, b, c], [d, e, f], [g, h, i]] = matrix;
  const det = determinant3x3(matrix);
  if (!Number.isFinite(det) || det <= 0) {
    throw new Error(
      `Invalid GNSS baseline covariance for ${label}: non-positive determinant (${det}).`,
    );
  }
  const inverse: GnssCovarianceMatrix = [
    [(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det],
    [(f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det],
    [(d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det],
  ];
  // Verify C*P ~= I entry-wise (tight deterministic tolerance).
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      let sum = 0;
      for (let k = 0; k < 3; k += 1) {
        sum += (matrix[row]?.[k] ?? 0) * (inverse[k]?.[column] ?? 0);
      }
      const expected = row === column ? 1 : 0;
      if (Math.abs(sum - expected) > 1e-9) {
        throw new Error(
          `Invalid GNSS baseline covariance for ${label}: inverse verification failed at (${row},${column}).`,
        );
      }
    }
  }
  return inverse;
};

/** Descriptive weighted contribution v^T P v for one baseline residual. */
export const gnssBaselineQuadraticForm = (
  inverse: GnssCovarianceMatrix,
  vX: number,
  vY: number,
  vZ: number,
): number => {
  const pvX = inverse[0][0] * vX + inverse[0][1] * vY + inverse[0][2] * vZ;
  const pvY = inverse[1][0] * vX + inverse[1][1] * vY + inverse[1][2] * vZ;
  const pvZ = inverse[2][0] * vX + inverse[2][1] * vY + inverse[2][2] * vZ;
  return vX * pvX + vY * pvY + vZ * pvZ;
};
