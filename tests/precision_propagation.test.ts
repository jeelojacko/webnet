import { describe, expect, it } from 'vitest';

import {
  buildDistanceAzimuthPrecision,
  buildHorizontalErrorEllipse,
  buildRelativeCovarianceFromEndpoints,
  clampTinyNegativePrecision,
} from '../src/engine/precisionPropagation';

describe('precision propagation helpers', () => {
  it('clamps only tiny negative numerical noise', () => {
    expect(clampTinyNegativePrecision(-1e-20, 1)).toBe(0);
    expect(clampTinyNegativePrecision(-1e-6, 1)).toBe(-1e-6);
    expect(clampTinyNegativePrecision(2e-6, 1)).toBe(2e-6);
  });

  it('builds orientation-invariant relative covariance from endpoint differences', () => {
    const grid = [
      [4, 1, 0.5, -0.25],
      [1, 9, -0.2, 0.1],
      [0.5, -0.2, 16, 2],
      [-0.25, 0.1, 2, 25],
    ];
    const covariance = (a?: number | null, b?: number | null) =>
      a == null || b == null ? 0 : (grid[a]?.[b] ?? 0);

    const forward = buildRelativeCovarianceFromEndpoints(covariance, { x: 0, y: 1 }, { x: 2, y: 3 });
    const reverse = buildRelativeCovarianceFromEndpoints(covariance, { x: 2, y: 3 }, { x: 0, y: 1 });

    expect(forward).toEqual(reverse);
  });

  it('keeps full covariance precision until final formatting', () => {
    const ellipse = buildHorizontalErrorEllipse(0.000647321, 0.000002301, 0.0000004123).ellipse;
    const stats = buildDistanceAzimuthPrecision(123.456789, 4.321987, {
      cEE: 0.000647321,
      cNN: 0.000002301,
      cEN: 0.0000004123,
    });

    expect(Math.abs(ellipse.semiMajor - Number(ellipse.semiMajor.toFixed(6)))).toBeGreaterThan(1e-10);
    expect(Math.abs(ellipse.semiMinor - Number(ellipse.semiMinor.toFixed(6)))).toBeGreaterThan(1e-10);
    expect(Math.abs(ellipse.theta - Number(ellipse.theta.toFixed(6)))).toBeGreaterThan(1e-10);
    expect(Math.abs((stats.sigmaDist ?? 0) - Number((stats.sigmaDist ?? 0).toFixed(6)))).toBeGreaterThan(1e-10);
    expect(Math.abs((stats.sigmaAz ?? 0) - Number((stats.sigmaAz ?? 0).toFixed(6)))).toBeGreaterThan(1e-10);
  });
});
