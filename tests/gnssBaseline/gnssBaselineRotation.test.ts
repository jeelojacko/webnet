/**
 * Phase 12C — shared-origin ENU rotation golden tests.
 *
 * The reference implementation below is coded independently from
 * src/engine/gnssBaselineRotation.ts (own matrix literal + own
 * multiplication); agreement is genuine parity, not self-comparison.
 * Round-trip alone is NOT accepted as proof (two wrong transforms can
 * round-trip): basis vectors are checked against hand-derived values.
 */
import { describe, expect, it } from 'vitest';
import {
  buildEnuRotation,
  orthonormalityError,
  rotateEcefCovarianceToEnu,
  rotateEcefVectorToEnu,
  rotateEnuCovarianceToEcef,
  rotateEnuVectorToEcef,
  verifyRotationOrthonormal,
  type Matrix3x3,
} from '../../src/engine/gnssBaselineRotation';

const deg = (value: number): number => (value * Math.PI) / 180;

/** Independent reference: 12A section 6 matrix, separately written. */
const referenceRotation = (latDeg: number, lonDeg: number): Matrix3x3 => {
  const phi = deg(latDeg);
  const lambda = deg(lonDeg);
  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const sinLambda = Math.sin(lambda);
  const cosLambda = Math.cos(lambda);
  const east = [-sinLambda, cosLambda, 0];
  const north = [-sinPhi * cosLambda, -sinPhi * sinLambda, cosPhi];
  const up = [cosPhi * cosLambda, cosPhi * sinLambda, sinPhi];
  return [east, north, up] as Matrix3x3;
};

const applyReference = (
  rotation: Matrix3x3,
  vector: [number, number, number],
): [number, number, number] => [
  rotation[0][0] * vector[0] + rotation[0][1] * vector[1] + rotation[0][2] * vector[2],
  rotation[1][0] * vector[0] + rotation[1][1] * vector[1] + rotation[1][2] * vector[2],
  rotation[2][0] * vector[0] + rotation[2][1] * vector[1] + rotation[2][2] * vector[2],
];

describe('gnss ENU rotation goldens', () => {
  it('matches the independent reference at trivial and non-trivial origins', () => {
    for (const [lat, lon] of [[0, 0], [46.123, -67.456], [-33.86, 151.2], [89, 179]] as const) {
      const production = buildEnuRotation(lat, lon);
      const reference = referenceRotation(lat, lon);
      for (let row = 0; row < 3; row += 1) {
        for (let column = 0; column < 3; column += 1) {
          expect(Math.abs(production[row][column] - reference[row][column])).toBeLessThan(1e-15);
        }
      }
      expect(orthonormalityError(production)).toBeLessThan(1e-15);
    }
  });

  it('has hand-verified orientation at lat=0 lon=0', () => {
    // At phi=0, lambda=0: R = [[0,1,0],[0,0,1],[1,0,0]].
    // ECEF +X (equator/prime-meridian) -> Up; +Y -> East; +Z (pole) -> North.
    const rotation = buildEnuRotation(0, 0);
    const flat = [...rotation[0], ...rotation[1], ...rotation[2]];
    const expected = [0, 1, 0, 0, 0, 1, 1, 0, 0];
    flat.forEach((value, index) => expect(Math.abs(value - (expected[index] ?? 0))).toBeLessThan(1e-15));
    const east = rotateEcefVectorToEnu(rotation, { x: 0, y: 1, z: 0 });
    expect([east.x, east.y, east.z]).toEqual([1, 0, 0]);
    const north = rotateEcefVectorToEnu(rotation, { x: 0, y: 0, z: 1 });
    expect([north.x, north.y, north.z]).toEqual([0, 1, 0]);
    const up = rotateEcefVectorToEnu(rotation, { x: 1, y: 0, z: 0 });
    expect([up.x, up.y, up.z]).toEqual([0, 0, 1]);
  });

  it('maps ENU basis vectors to expected ECEF at a non-trivial origin', () => {
    const lat = 45;
    const lon = 0;
    const rotation = buildEnuRotation(lat, lon);
    // lon=0: East must be +Y exactly; North/Up span the X/Z plane.
    const east = rotateEnuVectorToEcef(rotation, { x: 1, y: 0, z: 0 });
    expect(Math.abs(east.x)).toBeLessThan(1e-15);
    expect(east.y).toBeCloseTo(1, 15);
    expect(Math.abs(east.z)).toBeLessThan(1e-15);
    const up = rotateEnuVectorToEcef(rotation, { x: 0, y: 0, z: 1 });
    expect(up.x).toBeCloseTo(Math.cos(deg(45)), 15);
    expect(Math.abs(up.y)).toBeLessThan(1e-15);
    expect(up.z).toBeCloseTo(Math.sin(deg(45)), 15);
  });

  it('round-trips vectors and covariances through both directions', () => {
    const rotation = buildEnuRotation(46.123, -67.456);
    const vector = { x: 12.5, y: -4.25, z: 1.75 };
    const enu = rotateEcefVectorToEnu(rotation, vector);
    const back = rotateEnuVectorToEcef(rotation, enu);
    expect(Math.abs(back.x - vector.x)).toBeLessThan(1e-12);
    expect(Math.abs(back.y - vector.y)).toBeLessThan(1e-12);
    expect(Math.abs(back.z - vector.z)).toBeLessThan(1e-12);
    const covariance = { xx: 4e-6, xy: 1e-6, xz: 2e-7, yy: 9e-6, yz: -3e-7, zz: 16e-6 };
    const enuCov = rotateEcefCovarianceToEnu(rotation, covariance);
    const backCov = rotateEnuCovarianceToEcef(rotation, enuCov);
    for (const key of ['xx', 'xy', 'xz', 'yy', 'yz', 'zz'] as const) {
      expect(Math.abs(backCov[key] - covariance[key])).toBeLessThan(1e-20);
    }
  });

  it('rejects invalid origins and non-orthonormal matrices', () => {
    expect(() => buildEnuRotation(91, 0)).toThrow();
    expect(() => buildEnuRotation(Number.NaN, 0)).toThrow();
    expect(() => verifyRotationOrthonormal([[2, 0, 0], [0, 1, 0], [0, 0, 1]], 'test')).toThrow();
    expect(() => verifyRotationOrthonormal(buildEnuRotation(10, 20), 'test')).not.toThrow();
  });

  it('cross-checks production rotation against the reference on vectors', () => {
    const rotation = buildEnuRotation(-33.86, 151.2);
    const reference = referenceRotation(-33.86, 151.2);
    const vector: [number, number, number] = [3.25, -8.5, 0.75];
    const [rx, ry, rz] = applyReference(reference, vector);
    const production = rotateEcefVectorToEnu(rotation, { x: vector[0], y: vector[1], z: vector[2] });
    expect(Math.abs(production.x - rx)).toBeLessThan(1e-12);
    expect(Math.abs(production.y - ry)).toBeLessThan(1e-12);
    expect(Math.abs(production.z - rz)).toBeLessThan(1e-12);
  });
});
