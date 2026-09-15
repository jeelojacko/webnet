import { describe, expect, it } from 'vitest';

import {
  deriveLocalTestCritical,
  effectiveAlpha,
  incompleteBeta,
  isTestableEquation,
  normalQuantile,
  normalizeLocalTestPolicy,
  studentTQuantile,
  tauCritical,
} from '../src/engine/localTestPolicy';

describe('localTestPolicy normal quantiles', () => {
  it('matches reference two-sided critical values', () => {
    expect(normalQuantile(1 - 0.05 / 2)).toBeCloseTo(1.959963985, 6);
    expect(normalQuantile(1 - 0.01 / 2)).toBeCloseTo(2.575829304, 6);
    expect(normalQuantile(1 - 0.001 / 2)).toBeCloseTo(3.290526731, 6);
  });

  it('returns NaN outside (0, 1) without throwing', () => {
    for (const p of [0, 1, -0.1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(normalQuantile(p)).toBeNaN();
    }
    expect(normalQuantile(0.5)).toBeCloseTo(0, 9);
  });
});

describe('localTestPolicy multiplicity corrections', () => {
  it('reduces alpha per correction rule', () => {
    expect(effectiveAlpha(0.05, 1, 'bonferroni')).toBeCloseTo(0.05, 12);
    expect(effectiveAlpha(0.05, 1, 'sidak')).toBeCloseTo(0.05, 12);
    expect(effectiveAlpha(0.05, 10, 'bonferroni')).toBeCloseTo(0.005, 12);
    expect(effectiveAlpha(0.05, 10, 'sidak')).toBeCloseTo(1 - Math.pow(0.95, 0.1), 12);
    expect(effectiveAlpha(0.01, 10, 'bonferroni')).toBeCloseTo(0.001, 12);
  });

  it('matches reference Bonferroni/Sidak criticals at m=861', () => {
    const bono05 = effectiveAlpha(0.05, 861, 'bonferroni');
    const sidak05 = effectiveAlpha(0.05, 861, 'sidak');
    expect(normalQuantile(1 - bono05 / 2)).toBeCloseTo(4.020511, 5);
    expect(normalQuantile(1 - sidak05 / 2)).toBeCloseTo(4.014499, 5);
    const bono01 = effectiveAlpha(0.01, 861, 'bonferroni');
    const sidak01 = effectiveAlpha(0.01, 861, 'sidak');
    expect(normalQuantile(1 - bono01 / 2)).toBeCloseTo(4.384703, 5);
    expect(normalQuantile(1 - sidak01 / 2)).toBeCloseTo(4.383611, 5);
  });

  it('orders criticals none < sidak < bonferroni for m > 1', () => {
    for (const m of [2, 4, 10, 861]) {
      const none = normalQuantile(1 - effectiveAlpha(0.05, m, 'none') / 2);
      const sidak = normalQuantile(1 - effectiveAlpha(0.05, m, 'sidak') / 2);
      const bono = normalQuantile(1 - effectiveAlpha(0.05, m, 'bonferroni') / 2);
      expect(none).toBeLessThan(sidak);
      expect(sidak).toBeLessThan(bono);
    }
  });

  it('returns NaN for invalid alpha or count without throwing', () => {
    for (const alpha of [0, -0.05, 0.51, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(effectiveAlpha(alpha, 10, 'bonferroni')).toBeNaN();
      expect(effectiveAlpha(alpha, 10, 'sidak')).toBeNaN();
    }
    expect(effectiveAlpha(0.05, 0, 'bonferroni')).toBeNaN();
    expect(effectiveAlpha(0.05, 2.5, 'sidak')).toBeNaN();
  });
});

describe('localTestPolicy Student-t and tau', () => {
  it('inverts known t quantiles', () => {
    expect(studentTQuantile(0.975, 3)).toBeCloseTo(3.182446305, 5);
    expect(studentTQuantile(0.975, 1)).toBeCloseTo(12.706204736, 4);
    expect(studentTQuantile(0.025, 3)).toBeCloseTo(-studentTQuantile(0.975, 3), 9);
    expect(studentTQuantile(0.5, 5)).toBe(0);
  });

  it('matches reference Pope tau criticals', () => {
    expect(tauCritical(4, 0.05)).toBeCloseTo(1.756679, 5);
    expect(tauCritical(4, 0.01)).toBeCloseTo(1.91747, 5);
    expect(tauCritical(13, 0.05)).toBeCloseTo(1.919642, 5);
    expect(tauCritical(30, 0.001)).toBeCloseTo(3.078456, 5);
  });

  it('returns NaN for degenerate dof or invalid input without throwing', () => {
    expect(tauCritical(1, 0.05)).toBeNaN();
    expect(tauCritical(0, 0.05)).toBeNaN();
    expect(tauCritical(-3, 0.05)).toBeNaN();
    expect(tauCritical(4, 0)).toBeNaN();
    expect(tauCritical(4, Number.NaN)).toBeNaN();
    expect(tauCritical(Number.POSITIVE_INFINITY, 0.05)).toBeNaN();
    expect(studentTQuantile(0.975, 0)).toBeNaN();
    expect(studentTQuantile(1, 5)).toBeNaN();
    expect(incompleteBeta(0.5, 1, 1)).toBeCloseTo(0.5, 12);
  });
});

describe('deriveLocalTestCritical', () => {
  it('derives legacy-fixed as always-available tau 3.29', () => {
    const derived = deriveLocalTestCritical({ mode: 'legacy-fixed', testCount: 10, dof: 5 });
    expect(derived).toMatchObject({
      statisticFamily: 'tau',
      criticalValue: 3.29,
      available: true,
      twoSided: true,
    });
    expect(derived.unavailableReason).toBeUndefined();
  });

  it('marks formal modes unavailable with reasons on bad dof', () => {
    const wZero = deriveLocalTestCritical({ mode: 'baarda-w', testCount: 4, dof: 0 });
    expect(wZero.available).toBe(false);
    expect(wZero.unavailableReason).toBe('non-positive-dof');
    const tauOne = deriveLocalTestCritical({ mode: 'pope-tau', testCount: 4, dof: 1 });
    expect(tauOne.available).toBe(false);
    expect(tauOne.unavailableReason).toBe('dof-too-small');
    const tauZero = deriveLocalTestCritical({ mode: 'pope-tau', testCount: 4, dof: 0 });
    expect(tauZero.available).toBe(false);
  });

  it('never throws on hostile input', () => {
    expect(() =>
      deriveLocalTestCritical({
        mode: 'baarda-w',
        alpha: Number.NaN,
        testCount: 0,
        dof: Number.POSITIVE_INFINITY,
      }),
    ).not.toThrow();
    const derived = deriveLocalTestCritical({
      mode: 'pope-tau',
      alpha: -1,
      testCount: -5,
      dof: Number.NaN,
    });
    expect(derived.available).toBe(false);
  });

  it('normalizes defaults for absent policy fields', () => {
    expect(normalizeLocalTestPolicy(undefined)).toEqual({
      mode: 'legacy-fixed',
      alpha: 0.05,
      correction: 'none',
      critical: 3.29,
    });
    expect(isTestableEquation(0.5, 1)).toBe(true);
    expect(isTestableEquation(1e-12, 1)).toBe(false);
    expect(isTestableEquation(0, 0.01)).toBe(false);
    expect(isTestableEquation(-1e-9, 0.01)).toBe(false);
    expect(isTestableEquation(0.5, 0)).toBe(false);
    expect(isTestableEquation(0, 0)).toBe(false);
  });

  it('gates pope-tau on a positive SEUW while baarda-w and legacy stay available', () => {
    for (const seuw of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const tau = deriveLocalTestCritical({ mode: 'pope-tau', testCount: 6, dof: 2, seuw });
      expect(tau.available).toBe(false);
      expect(tau.unavailableReason).toBe('seuw-not-positive');
      const w = deriveLocalTestCritical({ mode: 'baarda-w', testCount: 6, dof: 2, seuw });
      expect(w.available).toBe(true);
      const legacy = deriveLocalTestCritical({
        mode: 'legacy-fixed',
        testCount: 6,
        dof: 2,
        seuw,
      });
      expect(legacy.available).toBe(true);
    }
    const ok = deriveLocalTestCritical({ mode: 'pope-tau', testCount: 6, dof: 2, seuw: 1.5 });
    expect(ok.available).toBe(true);
  });
});
