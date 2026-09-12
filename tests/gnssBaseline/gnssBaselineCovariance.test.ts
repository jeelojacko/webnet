/**
 * Phase 12B — covariance validation/inversion unit tests (GATE B support).
 */
import { describe, expect, it } from 'vitest';
import {
  gnssBaselineQuadraticForm,
  gnssCovarianceToDense,
  invertGnssBaselineCovariance,
  validateGnssBaselineCovariance,
} from '../../src/engine/gnssBaselineCovariance';
import type { GnssBaselineCovariance } from '../../src/engine/gnssBaselineTypes';

const SPD: GnssBaselineCovariance = {
  xx: 4e-6, xy: 1e-6, xz: -5e-7, yy: 9e-6, yz: 2e-6, zz: 16e-6,
};

describe('gnssBaselineCovariance', () => {
  it('accepts a positive-definite matrix with off-diagonals', () => {
    expect(() => validateGnssBaselineCovariance(SPD, 'proof')).not.toThrow();
  });

  it.each([
    ['negative variance', { ...SPD, xx: -1e-6 }],
    ['zero variance', { ...SPD, yy: 0 }],
    ['NaN entry', { ...SPD, xy: Number.NaN }],
    ['infinite entry', { ...SPD, zz: Number.POSITIVE_INFINITY }],
    // |xy| = 6e-6 > sqrt(4e-6 * 9e-6): violates Cauchy-Schwarz, not PD.
    ['non-PD correlation', { ...SPD, xy: 6e-6 }],
    // Zero 2x2 pivot: xx*yy - xy^2 = 0.
    ['singular block', { xx: 4e-6, xy: 6e-6, xz: 0, yy: 9e-6, yz: 0, zz: 1e-6 }],
  ])('rejects %s without repair', (_label, covariance) => {
    expect(() =>
      validateGnssBaselineCovariance(covariance as GnssBaselineCovariance, 'proof'),
    ).toThrow();
  });

  it('inverts with C*P ~= I to 1e-9 entry-wise', () => {
    const inverse = invertGnssBaselineCovariance(SPD, 'proof');
    const dense = gnssCovarianceToDense(SPD);
    for (let row = 0; row < 3; row += 1) {
      for (let column = 0; column < 3; column += 1) {
        let sum = 0;
        for (let k = 0; k < 3; k += 1) sum += dense[row]![k]! * inverse[k]![column]!;
        expect(Math.abs(sum - (row === column ? 1 : 0))).toBeLessThan(1e-9);
      }
    }
    // Off-diagonal weights are non-zero: correlation is not dropped.
    expect(inverse[0]![1]).not.toBe(0);
    expect(inverse[0]![2]).not.toBe(0);
    expect(inverse[1]![2]).not.toBe(0);
  });

  it('quadratic form matches the explicit dense computation', () => {
    const inverse = invertGnssBaselineCovariance(SPD, 'proof');
    const [vX, vY, vZ] = [0.004, -0.003, 0.002];
    const dense = gnssCovarianceToDense(SPD);
    // Independent route: solve C*y = v via Cramer-free elimination here is
    // overkill; compare against the transposed accumulation instead.
    const pv = [0, 1, 2].map(
      (row) => inverse[row]![0]! * vX + inverse[row]![1]! * vY + inverse[row]![2]! * vZ,
    );
    const expected = vX * pv[0]! + vY * pv[1]! + vZ * pv[2]!;
    expect(gnssBaselineQuadraticForm(inverse, vX, vY, vZ)).toBeCloseTo(expected, 15);
    // And differs from the naive diagonal-only form (correlation matters).
    const naive = (vX * vX) / dense[0]![0]! + (vY * vY) / dense[1]![1]! + (vZ * vZ) / dense[2]![2]!;
    expect(Math.abs(expected - naive)).toBeGreaterThan(0);
  });
});
