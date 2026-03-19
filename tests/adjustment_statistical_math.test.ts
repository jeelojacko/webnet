import { describe, expect, it } from 'vitest';

import {
  buildChiSquareSummary,
  chiSquarePValue,
  chiSquareQuantile,
} from '../src/engine/adjustmentStatisticalMath';

describe('adjustmentStatisticalMath', () => {
  it('matches known chi-square quantiles to practical engineering precision', () => {
    expect(chiSquareQuantile(0.95, 4)).toBeCloseTo(9.4877, 3);
    expect(chiSquareQuantile(0.975, 10)).toBeCloseTo(20.4832, 3);
  });

  it('inverts chi-square upper-tail probabilities against the extracted quantile helper', () => {
    const dof = 8;
    const cdfProbability = 0.975;
    const quantile = chiSquareQuantile(cdfProbability, dof);
    const upperTail = chiSquarePValue(quantile, dof);

    expect(upperTail).toBeCloseTo(1 - cdfProbability, 6);
  });

  it('builds chi-square summary payloads with variance-factor bounds', () => {
    const summary = buildChiSquareSummary(10, 10, 0.05);

    expect(summary).toBeDefined();
    expect(summary).toMatchObject({
      T: 10,
      dof: 10,
      alpha: 0.05,
      varianceFactor: 1,
      pass95: true,
    });
    expect((summary?.lower ?? 0) < 10).toBe(true);
    expect((summary?.upper ?? 0) > 10).toBe(true);
    expect((summary?.varianceFactorLower ?? 0) < 1).toBe(true);
    expect((summary?.varianceFactorUpper ?? 0) > 1).toBe(true);
  });

  it('returns no chi-square summary when degrees of freedom are not positive', () => {
    expect(buildChiSquareSummary(5, 0, 0.05)).toBeUndefined();
  });
});
