// Phase 18Q oracles: Helmert2D solver, ALIGN2D derivation, Grid/Ground math.
import { describe, expect, it } from 'vitest';

import {
  deriveAlign2DTransform,
  gridGroundTransform,
  solveHelmert2D,
  type HelmertControlPair,
} from '../src/engine/cad/cadHelmert2D';
import { applyPoint, compose, translation } from '../src/engine/cad/cadTransform2D';

const relErr = (actual: number, expected: number): number =>
  Math.abs(actual - expected) / Math.max(Math.abs(expected), 1);

describe('helmert 2D exact 2-point oracle (18Q)', () => {
  it('recovers a known rotation/scale/translation', () => {
    const rotDeg = 30;
    const scale = 1.00005;
    const tE = 100;
    const tN = -50;
    const r = (rotDeg * Math.PI) / 180;
    const a = scale * Math.cos(r);
    const b = scale * Math.sin(r);
    const project = (e: number, n: number): [number, number] => [
      tE + a * e - b * n,
      tN + b * e + a * n,
    ];
    const sources: Array<[number, number]> = [
      [10, 20],
      [110, -40],
    ];
    const pairs: HelmertControlPair[] = sources.map(([e, n]) => {
      const [te, tn] = project(e, n);
      return { sourceE: e, sourceN: n, targetE: te, targetN: tn };
    });
    const result = solveHelmert2D(pairs, 'SIMILARITY');
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('helmert failed');
    expect(relErr(result.translationE, tE)).toBeLessThan(1e-9);
    expect(relErr(result.translationN, tN)).toBeLessThan(1e-9);
    expect(Math.abs(result.rotationDeg - rotDeg)).toBeLessThan(1e-9);
    expect(relErr(result.scale, scale)).toBeLessThan(1e-9);
    expect(result.scalePpm).toBeCloseTo((scale - 1) * 1e6, 6);
    expect(result.rmsResidual).toBeLessThan(1e-9);
    // Applying the solved transform equals the analytic projection.
    const check = applyPoint(result.transform, { x: 55, y: 5 });
    const [ee, nn] = project(55, 5);
    expect(relErr(check.x, ee)).toBeLessThan(1e-9);
    expect(relErr(check.y, nn)).toBeLessThan(1e-9);
  });
});

describe('helmert 2D redundant oracle (18Q)', () => {
  it('matches hand-computed least-squares values with deterministic residuals', () => {
    // Fixture: unit square scaled x100, true rot 5 deg, s 1.0001, t (10,-7),
    // targets perturbed by fixed deterministic offsets (see below).
    const rotDeg = 5;
    const s = 1.0001;
    const tE = 10;
    const tN = -7;
    const rad = (rotDeg * Math.PI) / 180;
    const aTrue = s * Math.cos(rad);
    const bTrue = s * Math.sin(rad);
    const sources: Array<[number, number]> = [
      [0, 0],
      [100, 0],
      [100, 50],
      [0, 50],
    ];
    const pert: Array<[number, number]> = [
      [0.01, -0.02],
      [-0.015, 0.01],
      [0.02, 0.015],
      [-0.01, -0.005],
    ];
    const pairs: HelmertControlPair[] = sources.map(([e, n], i) => ({
      sourceE: e,
      sourceN: n,
      targetE: tE + aTrue * e - bTrue * n + pert[i][0],
      targetN: tN + bTrue * e + aTrue * n + pert[i][1],
    }));
    const result = solveHelmert2D(pairs, 'SIMILARITY');
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('helmert failed');
    // Expected values from an independent inline centred least-squares
    // computation (plain arithmetic, not the solver under test).
    const n = pairs.length;
    const srcE = (0 + 100 + 100 + 0) / 4;
    const srcN = (0 + 0 + 50 + 50) / 4;
    let tgtE = 0;
    let tgtN = 0;
    for (const p of pairs) {
      tgtE += p.targetE;
      tgtN += p.targetN;
    }
    tgtE /= n;
    tgtN /= n;
    let spread = 0;
    let numA = 0;
    let numB = 0;
    for (const p of pairs) {
      const se = p.sourceE - srcE;
      const sn = p.sourceN - srcN;
      const te = p.targetE - tgtE;
      const tn = p.targetN - tgtN;
      spread += se * se + sn * sn;
      numA += se * te + sn * tn;
      numB += se * tn - sn * te;
    }
    const expA = numA / spread;
    const expB = numB / spread;
    const expTE = tgtE - expA * srcE + expB * srcN;
    const expTN = tgtN - expB * srcE - expA * srcN;
    expect(result.transform.a).toBe(expA);
    expect(result.transform.b).toBe(expB);
    expect(result.translationE).toBe(expTE);
    expect(result.translationN).toBe(expTN);
    // Precomputed literals pin the oracle against silent drift.
    expect(result.translationE).toBeCloseTo(10.0025, 9);
    expect(result.translationN).toBeCloseTo(-7.01, 9);
    expect(result.rotationDeg).toBeCloseTo(5.009401956873651, 9);
    expect(result.scalePpm).toBeCloseTo(174.60162410443127, 6);
    const expR = [0.012499999999989696, 0.023690715480962393, 0.02061552812808851, 0.004472135955020139];
    expect(result.residuals).toHaveLength(4);
    result.residuals.forEach((res, i) => {
      expect(res.r).toBeCloseTo(expR[i], 9);
    });
    expect(result.rmsResidual).toBeCloseTo(0.01704772712123119, 9);
    expect(result.maxResidual).toBeCloseTo(0.023690715480962393, 9);
  });
});

describe('helmert 2D large-coordinate oracle (18Q)', () => {
  it('stays stable at E~2e6 / N~7e6 via centred normal equations', () => {
    const rotDeg = 12.5;
    const scale = 1 + 35e-6;
    const tE = 250;
    const tN = -180;
    const rad = (rotDeg * Math.PI) / 180;
    const a = scale * Math.cos(rad);
    const b = scale * Math.sin(rad);
    const base: Array<[number, number]> = [
      [2_000_000, 7_000_000],
      [2_000_100, 7_000_000],
      [2_000_100, 7_000_050],
      [2_000_000, 7_000_050],
    ];
    const pairs: HelmertControlPair[] = base.map(([e, n]) => ({
      sourceE: e,
      sourceN: n,
      targetE: tE + a * e - b * n,
      targetN: tN + b * e + a * n,
    }));
    const result = solveHelmert2D(pairs, 'SIMILARITY');
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('helmert failed');
    expect(Math.abs(result.rotationDeg - rotDeg)).toBeLessThan(1e-9);
    expect(relErr(result.scale, scale)).toBeLessThan(1e-9);
    // Translation absorbs lever-arm amplification (rotation err x 2e6 centroid),
    // so only absolute recovery is meaningful here; forward fit stays exact.
    expect(Math.abs(result.translationE - tE)).toBeLessThan(1e-4);
    expect(Math.abs(result.translationN - tN)).toBeLessThan(1e-4);
    for (const p of pairs) {
      const got = applyPoint(result.transform, { x: p.sourceE, y: p.sourceN });
      expect(Math.abs(got.x - p.targetE)).toBeLessThan(1e-6);
      expect(Math.abs(got.y - p.targetN)).toBeLessThan(1e-6);
    }
  });
});

describe('helmert 2D RIGID oracle (18Q)', () => {
  it('recovers pure rotation+translation with scale exactly 1', () => {
    const rotDeg = -17;
    const tE = 33;
    const tN = 44;
    const rad = (rotDeg * Math.PI) / 180;
    const c = Math.cos(rad);
    const sn = Math.sin(rad);
    const sources: Array<[number, number]> = [
      [0, 0],
      [50, 10],
      [-20, 70],
    ];
    const pairs: HelmertControlPair[] = sources.map(([e, n]) => ({
      sourceE: e,
      sourceN: n,
      targetE: tE + c * e - sn * n,
      targetN: tN + sn * e + c * n,
    }));
    const result = solveHelmert2D(pairs, 'RIGID');
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('helmert failed');
    expect(result.scale).toBe(1);
    expect(result.scalePpm).toBe(0);
    expect(Math.abs(result.rotationDeg - rotDeg)).toBeLessThan(1e-9);
    expect(relErr(result.translationE, tE)).toBeLessThan(1e-9);
    expect(relErr(result.translationN, tN)).toBeLessThan(1e-9);
    expect(result.rmsResidual).toBeLessThan(1e-9);
  });
});

describe('helmert 2D degeneracy pins (18Q)', () => {
  const pair = (e: number, n: number, te: number, tn: number): HelmertControlPair => ({
    sourceE: e,
    sourceN: n,
    targetE: te,
    targetN: tn,
  });
  it('fails on coincident sources', () => {
    const r = solveHelmert2D([pair(5, 5, 100, 200), pair(5, 5, 110, 210)], 'SIMILARITY');
    expect(r.ok).toBe(false);
  });
  it('fails on a single pair', () => {
    expect(solveHelmert2D([pair(0, 0, 1, 1)], 'SIMILARITY').ok).toBe(false);
  });
  it('fails on non-finite input', () => {
    const bad = solveHelmert2D(
      [pair(0, 0, 1, 1), pair(1, 0, NaN, 1)],
      'SIMILARITY',
    );
    expect(bad.ok).toBe(false);
    const inf = solveHelmert2D(
      [pair(0, 0, 1, 1), pair(Infinity, 0, 2, 1)],
      'RIGID',
    );
    expect(inf.ok).toBe(false);
  });
});

describe('align2D oracle (18Q)', () => {
  const s1 = { e: 0, n: 0 };
  const s2 = { e: 10, n: 0 };
  const t1 = { e: 100, n: 200 };
  const t2 = { e: 100, n: 220 };
  it('rigid mode preserves length and maps source1 -> target1', () => {
    const r = deriveAlign2DTransform(s1, s2, t1, t2, false);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('align failed');
    expect(r.scale).toBe(1);
    const p1 = applyPoint(r.transform, { x: s1.e, y: s1.n });
    expect(p1.x).toBeCloseTo(t1.e, 9);
    expect(p1.y).toBeCloseTo(t1.n, 9);
    const p2 = applyPoint(r.transform, { x: s2.e, y: s2.n });
    expect(Math.hypot(p2.x - p1.x, p2.y - p1.y)).toBeCloseTo(10, 9);
    expect(p2.x).toBeCloseTo(100, 9);
    expect(p2.y).toBeCloseTo(210, 9);
  });
  it('scale-to-fit mode doubles length pointing north without reflection', () => {
    const r = deriveAlign2DTransform(s1, s2, t1, t2, true);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('align failed');
    expect(r.scale).toBeCloseTo(2, 9);
    const p2 = applyPoint(r.transform, { x: s2.e, y: s2.n });
    expect(p2.x).toBeCloseTo(t2.e, 9);
    expect(p2.y).toBeCloseTo(t2.n, 9);
    // Orientation-preserving: determinant positive.
    expect(r.transform.a * r.transform.d - r.transform.b * r.transform.c).toBeGreaterThan(0);
  });
  it('fails on coincident sources', () => {
    expect(deriveAlign2DTransform(s1, s1, t1, t2, false).ok).toBe(false);
    expect(deriveAlign2DTransform(s1, s1, t1, t2, true).ok).toBe(false);
  });
});

describe('grid/ground oracle (18Q)', () => {
  it('scales about the origin by 1/CSF and round-trips', () => {
    const csf = 0.99995;
    const originE = 500_000;
    const originN = 100_000;
    const fwd = gridGroundTransform(originE, originN, csf, 'GRID_TO_GROUND');
    expect(fwd.ok).toBe(true);
    if (!fwd.ok) throw new Error('grid->ground failed');
    expect(fwd.effectiveFactor).toBeCloseTo(1 / csf, 12);
    expect(fwd.formula).toBe(`Grid->Ground: factor = 1/${csf}`);
    // Analytic check against plain arithmetic.
    const p = { x: 500_100, y: 100_050 };
    const actual = applyPoint(fwd.transform, p);
    const f = 1 / csf;
    expect(actual.x).toBeCloseTo(originE + (p.x - originE) * f, 6);
    expect(actual.y).toBeCloseTo(originN + (p.y - originN) * f, 6);
    const back = gridGroundTransform(originE, originN, csf, 'GROUND_TO_GRID');
    expect(back.ok).toBe(true);
    if (!back.ok) throw new Error('ground->grid failed');
    expect(back.effectiveFactor).toBe(csf);
    const round = applyPoint(back.transform, actual);
    expect(relErr(round.x, p.x)).toBeLessThan(1e-9);
    expect(relErr(round.y, p.y)).toBeLessThan(1e-9);
  });
  it('rejects invalid CSF values', () => {
    expect(gridGroundTransform(0, 0, 0, 'GRID_TO_GROUND').ok).toBe(false);
    expect(gridGroundTransform(0, 0, -0.5, 'GROUND_TO_GRID').ok).toBe(false);
    expect(gridGroundTransform(0, 0, NaN, 'GRID_TO_GROUND').ok).toBe(false);
  });
});

describe('helmert composition check (18Q)', () => {
  it('composes with the kernel equivalently', () => {
    const pairs: HelmertControlPair[] = [
      { sourceE: 0, sourceN: 0, targetE: 10, targetN: -7 },
      { sourceE: 100, sourceN: 0, targetE: 109.6, targetN: 1.7 },
      { sourceE: 0, sourceN: 50, targetE: 5.6, targetN: 42.8 },
    ];
    const h = solveHelmert2D(pairs, 'SIMILARITY');
    expect(h.ok).toBe(true);
    if (!h.ok) throw new Error('helmert failed');
    const move = translation(5, 7);
    const composed = compose(move, h.transform);
    const p = { x: 11, y: -4 };
    const sequential = applyPoint(move, applyPoint(h.transform, p));
    const single = applyPoint(composed, p);
    expect(single.x).toBeCloseTo(sequential.x, 9);
    expect(single.y).toBeCloseTo(sequential.y, 9);
  });
});
