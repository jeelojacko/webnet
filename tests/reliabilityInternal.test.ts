import { describe, expect, it } from 'vitest';

import { solveEngine } from '../src/engine/solveEngine';
import {
  deriveReliability,
  isTestableSensitivity,
  mdbLinearMm,
  reliabilityPoliciesEqual,
  sanitizeReliabilityPolicy,
  solveNoncentrality,
  statisticalMdb,
  statisticalSensitivity,
} from '../src/engine/reliabilityPolicy';
import type { ReliabilityPolicy } from '../src/engine/reliabilityPolicy';
import type { LocalTestPolicy } from '../src/engine/localTestPolicy';

/** Two fixed controls, one free point, plus a redundant outlier distance. */
const OUTLIER_INPUT = [
  '.2D',
  'C A 0 0 0 ! !',
  'C B 100 0 0 ! !',
  'C P 50 40 0',
  'D A-P 64.031 0.01',
  'D B-P 64.031 0.01',
  'A P-A-B 102-40-00.0 1.0',
  'D A-P 64.071 0.01',
].join('\n');

/** Small 2D GPS network: two fixed, one free, redundant via a distance. */
const GPS_INPUT = [
  '.2D',
  'C A 0 0 0 ! !',
  'C B 100 0 0 ! !',
  'C P 50 40 0',
  'G GPS1 A P 50.0 40.0 0.01 0.01',
  'G GPS1 B P -50.0 40.0 0.01 0.01',
  'D A-P 64.031 0.01',
].join('\n');

/** Outlier network plus a two-target direction set (TS-correlation shape). */
const DIRECTION_SET_INPUT = [
  ...OUTLIER_INPUT.split('\n'),
  'DB P',
  'DN A 321-48-05.0 1.0',
  'DN B 38-39-35.0 1.0',
  'DE',
].join('\n');

const run = (
  input: string,
  reliabilityPolicy?: ReliabilityPolicy,
  extraParseOptions: Record<string, unknown> = {},
  localTestPolicy?: LocalTestPolicy,
) =>
  solveEngine({
    input,
    maxIterations: 8,
    parseOptions: {
      coordMode: '2D',
      units: 'm',
      ...extraParseOptions,
      ...(reliabilityPolicy ? { reliabilityPolicy } : {}),
      ...(localTestPolicy ? { localTestPolicy } : {}),
    },
  });

const STAT = { model: 'statistical' } as ReliabilityPolicy;

/**
 * Independent normal quantile: bisection on a Simpson-integrated CDF.
 * Shares no code with the Acklam approximation under test.
 */
const quantileCache = new Map<number, number>();
const normalCdfSimpson = (x: number): number => {
  if (x === 0) return 0.5;
  const ax = Math.abs(x);
  const n = 40000;
  const h = ax / n;
  let sum = 1 + Math.exp((-ax * ax) / 2);
  for (let i = 1; i < n; i += 1) {
    const t = i * h;
    sum += (i % 2 === 0 ? 2 : 4) * Math.exp((-t * t) / 2);
  }
  const integral = ((h / 3) * sum) / Math.sqrt(2 * Math.PI);
  return x > 0 ? 0.5 + integral : 0.5 - integral;
};

const quantileIndependent = (p: number): number => {
  const cached = quantileCache.get(p);
  if (cached !== undefined) return cached;
  let lo = -10;
  let hi = 10;
  for (let i = 0; i < 100; i += 1) {
    const mid = 0.5 * (lo + hi);
    if (normalCdfSimpson(mid) < p) lo = mid;
    else hi = mid;
  }
  const result = 0.5 * (lo + hi);
  quantileCache.set(p, result);
  return result;
};

const delta0Independent = (alpha: number, power: number): number =>
  quantileIndependent(1 - alpha / 2) + quantileIndependent(power);

const distObs = (result: ReturnType<typeof run>, from: string, to: string) =>
  result.observations.find((o) => o.type === 'dist' && o.from === from && o.to === to);

describe('reliability reference noncentralities', () => {
  it('matches the Baarda/Teunissen reference delta0 values', () => {
    expect(solveNoncentrality(0.001, 0.8).delta0).toBeCloseTo(4.132, 3);
    expect(solveNoncentrality(0.05, 0.8).delta0).toBeCloseTo(2.802, 3);
    expect(solveNoncentrality(0.01, 0.8).delta0).toBeCloseTo(3.417, 3);
    expect(solveNoncentrality(0.001, 0.9).delta0).toBeCloseTo(4.572, 3);
    expect(solveNoncentrality(0.001, 0.95).delta0).toBeCloseTo(4.935, 3);
  });

  it('matches an independent Simpson-bisection quantile to 1e-6', () => {
    for (const [alpha, power] of [[0.001, 0.8], [0.05, 0.8], [0.001, 0.95]] as const) {
      expect(solveNoncentrality(alpha, power).delta0).toBeCloseTo(
        delta0Independent(alpha, power),
        6,
      );
    }
  });

  it('reports lambda0 as delta0 squared', () => {
    const { delta0, lambda0 } = solveNoncentrality(0.001, 0.8);
    expect(lambda0).toBeCloseTo(17.07, 2);
    expect(lambda0).toBeCloseTo(delta0 * delta0, 12);
  });
});

describe('statistical MDB hand check (A)', () => {
  it('matches an independent computation to 1e-9', () => {
    const result = run(OUTLIER_INPUT, STAT);
    const obs = distObs(result, 'A', 'P');
    expect(obs?.reliability?.mdbStatistical).toBeDefined();
    const r = obs?.redundancy;
    expect(typeof r).toBe('number');
    const delta0 = delta0Independent(0.001, 0.8);
    // Infer the a-priori sigma from the legacy MDB (3.29*seuw*sigma/sqrt(r)),
    // then verify the statistical MDB drops the SEUW factor with the new delta0.
    const sigma = (obs?.mdb as number) * Math.sqrt(r as number) / (3.29 * result.seuw);
    const expected = (delta0 * sigma) / Math.sqrt(r as number);
    expect(obs?.reliability?.mdbStatistical).toBeCloseTo(expected, 9);
    // delta0 to 1e-7: the residual floor is the Acklam quantile's own
    // documented ~1e-9 accuracy (independent Simpson value is exact to 4.6e-14).
    expect(result.reliabilitySummary?.delta0).toBeCloseTo(delta0, 7);
  });
});

describe('statistical MDB monotonicity (B/C/D/E)', () => {
  it('shrinks with higher redundancy, all else equal', () => {
    const base = run(OUTLIER_INPUT, STAT);
    const augmented = run(`${OUTLIER_INPUT}\nD B-P 64.071 0.01`, STAT);
    const baseMdb = distObs(base, 'A', 'P')?.reliability?.mdbStatistical as number;
    const augMdb = distObs(augmented, 'A', 'P')?.reliability?.mdbStatistical as number;
    expect(Number.isFinite(baseMdb)).toBe(true);
    expect(augMdb).toBeLessThan(baseMdb);
  });

  it('scales linearly with sigma', () => {
    const narrow = run(OUTLIER_INPUT, STAT);
    // Uniform power-of-two scaling (distances and the angle) keeps the
    // solution and redundancies fixed, so the MDB ratio is exactly 2.
    const wideInput = OUTLIER_INPUT.replaceAll(' 0.01', ' 0.02').replace(
      '102-40-00.0 1.0',
      '102-40-00.0 2.0',
    );
    const wide = run(wideInput, STAT);
    const narrowMdb = distObs(narrow, 'A', 'P')?.reliability?.mdbStatistical as number;
    const wideMdb = distObs(wide, 'A', 'P')?.reliability?.mdbStatistical as number;
    expect(wideMdb / narrowMdb).toBeCloseTo(2, 9);
  });

  it('grows with detection power 80 -> 90 -> 95', () => {
    const p80 = distObs(run(OUTLIER_INPUT, { model: 'statistical', power: 0.8 }), 'A', 'P')
      ?.reliability?.mdbStatistical as number;
    const p90 = distObs(run(OUTLIER_INPUT, { model: 'statistical', power: 0.9 }), 'A', 'P')
      ?.reliability?.mdbStatistical as number;
    const p95 = distObs(run(OUTLIER_INPUT, { model: 'statistical', power: 0.95 }), 'A', 'P')
      ?.reliability?.mdbStatistical as number;
    expect(p90).toBeGreaterThan(p80);
    expect(p95).toBeGreaterThan(p90);
  });

  it('grows with tighter alpha 0.05 -> 0.001', () => {
    const loose = distObs(run(OUTLIER_INPUT, { model: 'statistical', alpha: 0.05 }), 'A', 'P')
      ?.reliability?.mdbStatistical as number;
    const tight = distObs(run(OUTLIER_INPUT, STAT), 'A', 'P')
      ?.reliability?.mdbStatistical as number;
    expect(tight).toBeGreaterThan(loose);
  });
});

describe('legacy default bit-identical (F)', () => {
  it('adds zero numeric change when statistical mode is off', () => {
    const implicit = run(OUTLIER_INPUT);
    const explicit = run(OUTLIER_INPUT, { model: 'legacy-3.29' });
    expect(implicit.observations.map((o) => o.mdb)).toEqual(
      explicit.observations.map((o) => o.mdb),
    );
    for (const obs of implicit.observations) {
      expect(obs.reliability?.mdb).toBe(obs.mdb);
      expect(obs.reliability?.mdbStatistical).toBeUndefined();
      expect(obs.reliability?.method).toBe('legacy-3.29');
    }
    expect(implicit.reliabilitySummary?.model).toBe('legacy-3.29');
    expect(implicit.reliabilitySummary?.method).toBe('legacy-3.29');
  });
});

describe('method provenance (G)', () => {
  it('flags pope-tau statistical as an approximation', () => {
    const result = run(OUTLIER_INPUT, STAT, {}, { mode: 'pope-tau' });
    expect(result.reliabilitySummary?.method).toBe('approximation-normal-for-tau');
    expect(result.reliabilitySummary?.approximate).toBe(true);
    expect(result.reliabilitySummary?.reason).toMatch(/tau/);
  });

  it('marks baarda-w statistical exact', () => {
    const result = run(OUTLIER_INPUT, STAT, {}, { mode: 'baarda-w' });
    expect(result.reliabilitySummary?.method).toBe('exact-normal');
    expect(result.reliabilitySummary?.approximate).toBe(false);
  });

  it('flags huber-frozen weights as approximate', () => {
    const result = run(OUTLIER_INPUT, STAT, { robustMode: 'huber' });
    expect(result.reliabilitySummary?.approximate).toBe(true);
    expect(result.reliabilitySummary?.reason).toMatch(/robust-frozen-weights/);
    const obs = distObs(result, 'A', 'P');
    expect(Number.isFinite(obs?.reliability?.mdbStatistical)).toBe(true);
  });
});

describe('input bounds (H)', () => {
  it('rejects alpha=0 with a reason and no NaN or throw', () => {
    const result = run(OUTLIER_INPUT, { model: 'statistical', alpha: 0 });
    expect(result.success).toBe(true);
    expect(result.reliabilitySummary?.reason).toMatch(/alpha/);
    for (const obs of result.observations) {
      const mdb = obs.reliability?.mdbStatistical;
      if (mdb !== undefined) expect(Number.isNaN(mdb)).toBe(false);
    }
  });

  it('rejects power=1 with a reason and no NaN or throw', () => {
    const result = run(OUTLIER_INPUT, { model: 'statistical', power: 1 });
    expect(result.success).toBe(true);
    expect(result.reliabilitySummary?.reason).toMatch(/power/);
    for (const obs of result.observations) {
      const mdb = obs.reliability?.mdbStatistical;
      if (mdb !== undefined) expect(Number.isNaN(mdb)).toBe(false);
    }
  });
});

describe('TS correlation (I)', () => {
  it('moves the statistical MDB off the diagonal-naive value', () => {
    const naive = run(DIRECTION_SET_INPUT, STAT);
    const correlated = run(DIRECTION_SET_INPUT, STAT, {
      tsCorrelationEnabled: true,
      tsCorrelationRho: 0.5,
      tsCorrelationScope: 'set',
    });
    const naiveMdb = distObs(naive, 'A', 'P')?.reliability?.mdbStatistical as number;
    const corrMdb = distObs(correlated, 'A', 'P')?.reliability?.mdbStatistical as number;
    expect(Number.isFinite(naiveMdb)).toBe(true);
    expect(Number.isFinite(corrMdb)).toBe(true);
    expect(corrMdb).not.toBe(naiveMdb);
  });
});

describe('correlated sensitivity hand check (L)', () => {
  // One-parameter, two-equation hand system with non-diagonal weights:
  // A = [[1], [1]], P = [[4, 1], [1, 2]]. Then N = A'PA = 8, Qxx = 1/8,
  // Qll = P^-1 = [[2/7, -1/7], [-1/7, 4/7]], A Qxx A' = ones(2,2)/8, and
  // R = Qvv P has R_00 = 21/56 = 0.375 = 1 - 5/8.
  const P = [[4, 1], [1, 2]];
  const QXX = 1 / 8;
  const cross = (_rowA: number, _rowB: number): number => QXX;
  const weightAt = (coupledRow: number, row: number): number => P[coupledRow][row];
  const QLL_00 = 2 / 7;
  const QVV_00 = 2 / 7 - 1 / 8;
  const R_00 = 0.375;

  it('matches the direct QvvP product for non-diagonal P', () => {
    // Independent reference: explicit Qvv row dotted with the P column.
    const qvv00 = QLL_00 - QXX;
    const qvv01 = -1 / 7 - QXX;
    const expected = qvv00 * P[0][0] + qvv01 * P[1][0];
    expect(expected).toBeCloseTo(R_00, 15);
    expect(statisticalSensitivity(0, [0, 1], cross, weightAt)).toBeCloseTo(expected, 15);
  });

  it('passes the new MDB while the diagonal-naive formula fails', () => {
    const delta0 = 4.132;
    expect(statisticalMdb(QVV_00, R_00, delta0)).toBeCloseTo(
      (delta0 * Math.sqrt(QVV_00)) / R_00,
      15,
    );
    // Diagonal-naive legacy-style value from r = qvv/qll.
    const rDiag = QVV_00 / QLL_00;
    const mdbOld = (delta0 * Math.sqrt(QLL_00)) / Math.sqrt(rDiag);
    expect(Math.abs(mdbOld - statisticalMdb(QVV_00, R_00, delta0)) / mdbOld).toBeGreaterThan(
      0.1,
    );
  });

  it('coincides with the diagonal formula when P is diagonal', () => {
    const delta0 = 4.132;
    const qxx = 1 / 6;
    const crossD = (): number => qxx;
    const weightD = (coupledRow: number, row: number): number =>
      coupledRow === row ? (row === 0 ? 4 : 2) : 0;
    const r = statisticalSensitivity(0, [0], crossD, weightD);
    expect(r).toBeCloseTo(1 - qxx * 4, 15);
    const qvv = 1 / 4 - qxx;
    expect(statisticalMdb(qvv, r, delta0)).toBeCloseTo(
      (delta0 * Math.sqrt(1 / 4)) / Math.sqrt(qvv / (1 / 4)),
      12,
    );
  });

  it('fails closed on missing coupling or vanishing sensitivity', () => {
    expect(statisticalSensitivity(0, [0, 1], () => undefined, weightAt)).toBeNaN();
    expect(isTestableSensitivity(0.5)).toBe(true);
    expect(isTestableSensitivity(1e-13)).toBe(false);
    expect(isTestableSensitivity(Number.NaN)).toBe(false);
  });
});

describe('correlated GPS block (M)', () => {
  // Same network as (J) but with a strong E/N correlation: the 2x2 P
  // block couples the components, so the full-column sensitivity must
  // move the statistical MDBs off the diagonal-naive scaled-legacy value.
  const CORR_INPUT = GPS_INPUT.replaceAll(' 0.01 0.01\n', ' 0.01 0.01 0.9\n');

  it('moves the statistical components off the diagonal-naive value', () => {
    const result = run(CORR_INPUT, STAT);
    const gps = result.observations.find((o) => o.type === 'gps');
    const summary = result.reliabilitySummary;
    const ratio = (summary?.delta0 as number) / (3.29 * result.seuw);
    const comps = gps?.mdbComponents as { mE: number; mN: number };
    const statComps = gps?.reliability?.mdbStatisticalComponents;
    expect(statComps).toBeDefined();
    for (const [legacy, stat] of [[comps.mE, statComps?.mE], [comps.mN, statComps?.mN]] as const) {
      const naive = (legacy as number) * ratio;
      const relDiff = Math.abs((stat as number) - naive) / naive;
      expect(relDiff).toBeGreaterThan(1e-3);
    }
    expect(gps?.reliability?.mdbStatistical).toBe(
      Math.min(statComps?.mE as number, statComps?.mN as number),
    );
  });
});

describe('GPS components (J)', () => {
  it('scales per-component MDBs by delta0/(3.29*seuw) with min aggregate', () => {
    const result = run(GPS_INPUT, STAT);
    const gps = result.observations.find((o) => o.type === 'gps');
    const summary = result.reliabilitySummary;
    expect(summary?.delta0).toBeDefined();
    const ratio = (summary?.delta0 as number) / (3.29 * result.seuw);
    const comps = gps?.mdbComponents;
    const statComps = gps?.reliability?.mdbStatisticalComponents;
    expect(comps).toBeDefined();
    expect(statComps).toBeDefined();
    expect(statComps?.mE).toBeCloseTo((comps?.mE as number) * ratio, 9);
    expect(statComps?.mN).toBeCloseTo((comps?.mN as number) * ratio, 9);
    expect(gps?.reliability?.mdbStatistical).toBe(
      Math.min(statComps?.mE as number, statComps?.mN as number),
    );
  });
});

describe('linear MDB (K)', () => {
  it('converts angular MDB to mm via the effective distance', () => {
    const result = run(OUTLIER_INPUT, STAT);
    const angle = result.observations.find((o) => o.type === 'angle');
    const linear = angle?.reliability?.mdbLinearMm;
    expect(Number.isFinite(linear)).toBe(true);
    // Linear equivalent follows the active run model (statistical here).
    const expected =
      (angle?.reliability?.mdbStatistical as number) * (angle?.effectiveDistance as number) * 1000;
    expect(linear).toBeCloseTo(expected, 9);
    expect(mdbLinearMm(1e-4, 100)).toBeCloseTo(10, 12);
    expect(mdbLinearMm(Number.NaN, 100)).toBeUndefined();
    expect(mdbLinearMm(1e-4, undefined)).toBeUndefined();
  });
});

describe('preanalysis guard', () => {
  it('keeps the summary a-priori without per-observation MDBs', () => {
    const result = run(OUTLIER_INPUT, STAT, { runMode: 'preanalysis' });
    expect(result.preanalysisMode).toBe(true);
    expect(result.reliabilitySummary?.available).toBe(true);
    expect(result.reliabilitySummary?.reason).toMatch(/preanalysis-a-priori/);
    expect(
      result.observations.every((o) => o.reliability?.mdbStatistical === undefined),
    ).toBe(true);
  });
});

describe('policy helpers', () => {
  it('sanitizes and compares policies for later workers', () => {
    expect(sanitizeReliabilityPolicy(undefined)).toBeUndefined();
    expect(sanitizeReliabilityPolicy({ model: 'nope' })).toBeUndefined();
    expect(sanitizeReliabilityPolicy({ model: 'statistical', alpha: 0 })).toBeUndefined();
    expect(sanitizeReliabilityPolicy({ model: 'statistical', power: 1 })).toBeUndefined();
    expect(sanitizeReliabilityPolicy({ model: 'statistical', alpha: 0.01, power: 0.9 })).toEqual({
      model: 'statistical',
      alpha: 0.01,
      power: 0.9,
    });
    expect(reliabilityPoliciesEqual(undefined, { model: 'legacy-3.29' })).toBe(true);
    expect(reliabilityPoliciesEqual(STAT, { model: 'statistical', alpha: 0.001, power: 0.8 })).toBe(
      true,
    );
    expect(reliabilityPoliciesEqual(STAT, { model: 'legacy-3.29' })).toBe(false);
  });

  it('never returns NaN from the scalar MDB helper on bad input', () => {
    expect(statisticalMdb(0, 0.5, 4.132)).toBe(Number.POSITIVE_INFINITY);
    expect(statisticalMdb(1e-4, 0, 4.132)).toBe(Number.POSITIVE_INFINITY);
    expect(statisticalMdb(1e-4, Number.NaN, 4.132)).toBe(Number.POSITIVE_INFINITY);
    expect(statisticalMdb(1e-4, 1e-13, 4.132)).toBe(Number.POSITIVE_INFINITY);
    expect(statisticalMdb(1e-4, 0.5, Number.NaN)).toBe(Number.POSITIVE_INFINITY);
    expect(statisticalMdb(1e-4, 0.5, 0)).toBe(Number.POSITIVE_INFINITY);
    // Fail closed: an invalid direct policy is unavailable, never clamped.
    const badAlpha = deriveReliability({ policy: { model: 'statistical', alpha: -1 } });
    expect(badAlpha.available).toBe(false);
    expect(badAlpha.reason).toMatch(/alpha/);
    expect(badAlpha.delta0).toBe(Number.POSITIVE_INFINITY);
  });

  it('enforces 0.5 <= power < 1 with no clamping', () => {
    expect(
      deriveReliability({ policy: { model: 'statistical', power: 0.5 } }).available,
    ).toBe(true);
    expect(
      deriveReliability({ policy: { model: 'statistical', power: 0.99 } }).available,
    ).toBe(true);
    for (const power of [0.4, 0, -1, 1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const summary = deriveReliability({ policy: { model: 'statistical', power } });
      expect(summary.available).toBe(false);
      expect(summary.reason).toMatch(/power/);
      expect(summary.delta0).toBe(Number.POSITIVE_INFINITY);
      expect(Number.isNaN(summary.delta0)).toBe(false);
    }
    expect(sanitizeReliabilityPolicy({ model: 'statistical', power: 0.4 })).toBeUndefined();
    expect(sanitizeReliabilityPolicy({ model: 'statistical', power: 0.5 })).toEqual({
      model: 'statistical',
      power: 0.5,
    });
  });
});
