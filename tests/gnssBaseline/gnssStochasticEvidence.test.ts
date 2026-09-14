import { describe, expect, it } from 'vitest';
import {
  applyModelCL,
  applyModelEnuFloor,
  applyModelF,
  applyModelS,
  averageFormalCovariance,
  chi2Cdf3,
  chi2PValue3,
  ecefToEnuRotation,
  empiricalCovariance,
  loopClosureT,
  meanBaseline,
  normalizedDifferenceT,
  rotateCovariance,
  scaleRatioDiagnostics,
} from '../../src/engine/gnssStochasticEvidence';

const ID = { xx: 1, xy: 0, xz: 0, yy: 1, yz: 0, zz: 1 };

describe('gnssStochasticEvidence', () => {
  it('mean of 3 vectors (hand-computed)', () => {
    expect(meanBaseline([[1, 2, 3], [4, 5, 6], [7, 8, 9]])).toEqual([4, 5, 6]);
  });

  it('empirical covariance (hand-computed golden)', () => {
    // x: 0,2,4 -> mean 2, SS 8 -> var 4; y const -> 0; z: 1,3,5 -> var 4; cov xz = 8/2 = 4
    const r = empiricalCovariance([[0, 1, 1], [2, 1, 3], [4, 1, 5]]);
    expect(r.mean).toEqual([2, 1, 3]);
    expect(r.n).toBe(3);
    expect(r.cov.xx).toBeCloseTo(4, 12);
    expect(r.cov.yy).toBeCloseTo(0, 12);
    expect(r.cov.zz).toBeCloseTo(4, 12);
    expect(r.cov.xz).toBeCloseTo(4, 12);
    expect(r.cov.xy).toBeCloseTo(0, 12);
    expect(r.cov.yz).toBeCloseTo(0, 12);
  });

  it('averageFormalCovariance element-wise mean', () => {
    const a = averageFormalCovariance([
      { covariance: { xx: 1, xy: 0, xz: 0, yy: 2, yz: 0, zz: 3 } },
      { covariance: { xx: 3, xy: 0, xz: 0, yy: 4, yz: 0, zz: 5 } },
    ]);
    expect(a).toEqual({ xx: 2, xy: 0, xz: 0, yy: 3, yz: 0, zz: 4 });
  });

  it('scaleRatioDiagnostics ratios + sigma ratios', () => {
    const d = scaleRatioDiagnostics(
      { xx: 4, xy: 0, xz: 0, yy: 9, yz: 0, zz: 16 },
      { xx: 1, xy: 0, xz: 0, yy: 1, yz: 0, zz: 1 },
    );
    expect(d).toEqual({ xx: 4, yy: 9, zz: 16, trace: 29 / 3, sigmaX: 2, sigmaY: 3, sigmaZ: 4 });
  });

  it('ENU rotation at equator lon=0 is identity-ish', () => {
    const R = ecefToEnuRotation([6378137, 0, 0]);
    const flat = R.flat();
    expect(flat[0]).toBeCloseTo(0, 12);
    expect(flat[1]).toBeCloseTo(1, 12);
    expect(R[1][2]).toBeCloseTo(1, 12);
    expect(R[2][0]).toBeCloseTo(1, 12);
    // Orthonormal: R R^T = I
    const c = rotateCovariance(ID, R);
    expect(c.xx).toBeCloseTo(1, 12);
    expect(c.yy).toBeCloseTo(1, 12);
    expect(c.zz).toBeCloseTo(1, 12);
    expect(c.xy).toBeCloseTo(0, 12);
  });

  it('ENU rotation near pole stays orthonormal', () => {
    const R = ecefToEnuRotation([1, 1, 6378137]);
    // rows unit + mutually orthogonal
    for (const row of R) {
      expect(Math.hypot(...row)).toBeCloseTo(1, 12);
    }
    const dot = (a: number[], b: number[]): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    expect(dot(R[0], R[1])).toBeCloseTo(0, 12);
    expect(dot(R[0], R[2])).toBeCloseTo(0, 12);
    expect(dot(R[1], R[2])).toBeCloseTo(0, 12);
  });

  it('T with identity covariance = squared norm', () => {
    expect(normalizedDifferenceT([1, 2, 2], ID)).toBeCloseTo(9, 12);
  });

  it('loop closure of exact triangle = 0 vector, T = 0', () => {
    const r = loopClosureT([
      { d: [1, 0, 0], c: ID },
      { d: [0, 1, 0], c: ID },
      { d: [-1, -1, 0], c: ID },
    ]);
    expect(r.closure).toEqual([0, 0, 0]);
    expect(r.cSum).toEqual({ xx: 3, xy: 0, xz: 0, yy: 3, yz: 0, zz: 3 });
    expect(r.T).toBeCloseTo(0, 12);
  });

  it('model F is identity, model S 2x sigma = 4x variance', () => {
    expect(applyModelF(ID)).toEqual(ID);
    expect(applyModelS(ID, 2)).toEqual({ xx: 4, xy: 0, xz: 0, yy: 4, yz: 0, zz: 4 });
  });

  it('ENU floor adds h/v variance (zero formal -> diag floors in ENU)', () => {
    const zero = { xx: 0, xy: 0, xz: 0, yy: 0, yz: 0, zz: 0 };
    const out = applyModelEnuFloor(zero, [6378137, 0, 0], 0.003, 0.005);
    const R = ecefToEnuRotation([6378137, 0, 0]);
    const back = rotateCovariance(out, R);
    expect(back.xx).toBeCloseTo(9e-6, 15);
    expect(back.yy).toBeCloseTo(9e-6, 15);
    expect(back.zz).toBeCloseTo(25e-6, 15);
  });

  it('model CL with zero length = constant only', () => {
    const zero = { xx: 0, xy: 0, xz: 0, yy: 0, yz: 0, zz: 0 };
    const out = applyModelCL(zero, [6378137, 0, 0], 0.004, 10, 0.008, 20, 0);
    const R = ecefToEnuRotation([6378137, 0, 0]);
    const back = rotateCovariance(out, R);
    expect(back.xx).toBeCloseTo(16e-6, 15);
    expect(back.zz).toBeCloseTo(64e-6, 15);
  });

  it('chi2 CDF at 0 = 0, large x ~ 1, p-value complements', () => {
    expect(chi2Cdf3(0)).toBe(0);
    expect(chi2Cdf3(-5)).toBe(0);
    expect(chi2Cdf3(100)).toBeCloseTo(1, 6);
    expect(chi2PValue3(0)).toBe(1);
    expect(chi2Cdf3(1) + chi2PValue3(1)).toBeCloseTo(1, 12);
    // Known value: F_3(2) ≈ 0.427593
    expect(chi2Cdf3(2)).toBeCloseTo(0.427593, 4);
  });

  it('non-SPD covariance throws', () => {
    expect(() => normalizedDifferenceT([1, 0, 0], { xx: 0, xy: 0, xz: 0, yy: 1, yz: 0, zz: 1 })).toThrow();
    expect(() =>
      normalizedDifferenceT([1, 0, 0], { xx: 1, xy: 2, xz: 0, yy: 1, yz: 0, zz: 1 }),
    ).toThrow();
  });

  it('empty/degenerate inputs throw', () => {
    expect(() => meanBaseline([])).toThrow();
    expect(() => empiricalCovariance([[1, 2, 3]])).toThrow();
    expect(() => averageFormalCovariance([])).toThrow();
    expect(() => loopClosureT([])).toThrow();
  });
});
