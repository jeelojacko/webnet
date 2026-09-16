/**
 * Phase 14C — agent-tier stochastic group diagnostics.
 *
 * The dense oracles below are built INLINE with explicit matrix math and
 * never call production code, so they independently verify the first-pass
 * formulas (Ω_k = v'Pv, R_k = tr(P·Qvv), s_k² = Ω_k/R_k).
 *
 * Evidence-tier follow-up (not here): Monte-Carlo behavior of the diagnostic
 * scale and iterated Helmert/MINQUE/REML convergence belong under
 * tests/evidence/.
 */
import {
  assembleStochasticGroupInputs,
  computeStochasticGroupDiagnostics,
  stochasticGroupLabel,
  unavailableStochasticDiagnostics,
} from '../src/engine/stochasticGroupDiagnostics';
import {
  formatStochasticRedundancy,
  formatStochasticStatus,
} from '../src/engine/stochasticDiagnosticsDisplay';
import { solveEngine } from '../src/engine/solveEngine';
import { describe, expect, it } from 'vitest';

// --- tiny dense oracle (independent of production code) ---
const transpose = (m: number[][]): number[][] =>
  m[0].map((_, j) => m.map((row) => row[j] as number));
const matMul = (a: number[][], b: number[][]): number[][] =>
  a.map((row) => b[0].map((_, j) => row.reduce((s, v, k) => s + v * (b[k]?.[j] ?? 0), 0)));
const matVec = (a: number[][], v: number[]): number[] =>
  a.map((row) => row.reduce((s, x, j) => s + x * (v[j] ?? 0), 0));
const invert = (m: number[][]): number[][] => {
  const n = m.length;
  const aug = m.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let r = col + 1; r < n; r += 1) {
      if (Math.abs(aug[r]?.[col] ?? 0) > Math.abs(aug[pivot]?.[col] ?? 0)) pivot = r;
    }
    const tmp = aug[col] as number[];
    aug[col] = aug[pivot] as number[];
    aug[pivot] = tmp;
    const div = aug[col]?.[col] as number;
    for (let j = 0; j < 2 * n; j += 1) aug[col][j] /= div;
    for (let r = 0; r < n; r += 1) {
      if (r === col) continue;
      const factor = aug[r]?.[col] as number;
      for (let j = 0; j < 2 * n; j += 1) aug[r][j] -= factor * (aug[col]?.[j] ?? 0);
    }
  }
  return aug.map((row) => row.slice(n));
};

/** Two-group synthetic network: rows 0-2 Distances, rows 3-5 Angles. */
const twoGroupOracle = (perturbScale: number[] = [1, 1]) => {
  const A = [[1, 0], [0, 1], [1, 1], [1, -1], [2, 1], [0, 2]];
  const sigmas = [0.01, 0.01, 0.01, 0.02, 0.02, 0.02];
  const base = [0.005, -0.003, 0.004, 0.01, -0.012, 0.008];
  const l = base.map((v, i) => v * (i < 3 ? perturbScale[0] : perturbScale[1]));
  const P = sigmas.map((s, i) => sigmas.map((_, j) => (i === j ? 1 / (s * s) : 0)));
  const N = matMul(matMul(transpose(A), P), A);
  const Qxx = invert(N);
  const xhat = matVec(Qxx, matVec(matMul(transpose(A), P), l));
  const v = matVec(A, xhat).map((val, i) => val - (l[i] ?? 0));
  const AQ = matMul(A, Qxx);
  const Qvv = sigmas.map((s, i) =>
    sigmas.map((_, j) => (i === j ? s * s : 0) - (AQ[i] ?? []).reduce((sum, a, k) => sum + a * (A[j]?.[k] ?? 0), 0)),
  );
  const group = (rows: number[]) => {
    let R = 0;
    let quad = 0;
    for (const i of rows) {
      for (const j of rows) {
        R += (P[i]?.[j] ?? 0) * (Qvv[j]?.[i] ?? 0);
        quad += (v[i] ?? 0) * (P[i]?.[j] ?? 0) * (v[j] ?? 0);
      }
    }
    return { R, quad, v: rows.map((i) => v[i] as number), qvvDiag: rows.map((i) => Qvv[i]?.[i] as number) };
  };
  return { dist: group([0, 1, 2]), ang: group([3, 4, 5]) };
};

describe('stochasticGroupDiagnostics', () => {
  it('matches a dense independent oracle for redundancy, quadform, and s_k²', () => {
    const oracle = twoGroupOracle();
    const result = computeStochasticGroupDiagnostics({
      scalarRows: [
        ...oracle.dist.v.map((vv, k) => ({
          row: k, group: 'Distances', v: vv, w: 1 / (0.01 * 0.01), qvv: oracle.dist.qvvDiag[k] as number,
        })),
        ...oracle.ang.v.map((vv, k) => ({
          row: k + 3, group: 'Angles', v: vv, w: 1 / (0.02 * 0.02), qvv: oracle.ang.qvvDiag[k] as number,
        })),
      ],
      blocks: [],
      crossTerms: [],
      crossGroupContaminatedGroups: [],
      robustMode: 'none',
    });
    expect(result.groups.map((g) => g.label)).toEqual(['Angles', 'Distances']);
    const angles = result.groups[0] as (typeof result.groups)[number];
    const dists = result.groups[1] as (typeof result.groups)[number];
    expect(angles.equations).toBe(3);
    expect(dists.equations).toBe(3);
    expect(angles.redundancyDof).toBeCloseTo(oracle.ang.R, 9);
    expect(dists.redundancyDof).toBeCloseTo(oracle.dist.R, 9);
    expect(angles.quadForm).toBeCloseTo(oracle.ang.quad, 9);
    expect(dists.quadForm).toBeCloseTo(oracle.dist.quad, 9);
    expect(angles.varianceFactor).toBeCloseTo(oracle.ang.quad / oracle.ang.R, 9);
    expect(dists.varianceFactor).toBeCloseTo(oracle.dist.quad / oracle.dist.R, 9);
    expect(angles.sigmaScale).toBeCloseTo(Math.sqrt(oracle.ang.quad / oracle.ang.R), 9);
    expect(angles.descriptiveFactor).toBeCloseTo(Math.sqrt(oracle.ang.quad / 3), 9);
    expect(angles.status).toBe('estimated');
    expect(result.globalNote).toMatch(/first-pass/);
  });

  it('tracks stated precision through a TRUE re-adjustment (halved sigmas → s²≈4)', () => {
    // Two genuine solveEngine runs on identical data, one group's stated
    // sigmas halved: the re-solved residuals AND redundancy both move, so an
    // ≈4x scale shift proves end-to-end sensitivity (not algebraic rescaling
    // of solved residuals against a fixed R).
    const net = (dSigma: number) =>
      [
        '.2D',
        'C A 0 0 0 ! !',
        'C B 100 0 0 ! !',
        'C P 50 40 0',
        `D A-P 64.031 ${dSigma}`,
        `D B-P 64.031 ${dSigma}`,
        'A P-A-B 102-40-00.0 1.0',
        `D A-P 64.071 ${dSigma}`,
      ].join('\n');
    const scaleOf = (input: string): { s2: number; r: number; v: (number | undefined)[] } => {
      const result = solveEngine({
        input,
        maxIterations: 8,
        parseOptions: { coordMode: '2D', units: 'm' },
      });
      const group = result.stochasticDiagnostics?.groups.find((g) => g.label === 'Distances');
      expect(group?.status).toBe('estimated');
      return {
        s2: group?.varianceFactor as number,
        r: group?.redundancyDof as number,
        v: result.observations.map((o) => o.residual as number | undefined),
      };
    };
    const base = scaleOf(net(0.01));
    const tight = scaleOf(net(0.005));
    // Identical data with 2x tighter stated precision: s² ≈ 4x.
    expect(tight.s2 / base.s2).toBeGreaterThan(3.5);
    expect(tight.s2 / base.s2).toBeLessThan(4.5);
    // Genuine re-solve proof: redundancy and residuals both moved.
    expect(tight.r).not.toBeCloseTo(base.r, 9);
    expect(tight.v).not.toEqual(base.v);
  });

  it('uses the full TS cross-cofactor Qvv_AB = ρσ_Aσ_B − a_A·Qxx·a_B\'', () => {
    // Inline correlated oracle: rows 0-1 share ρ = 0.4 (same TS group), row 2
    // independent. Production assembly must add the Qll cross term to R;
    // omitting it understates same-group redundancy by 2·P_01·Qll_01.
    const rho = 0.4;
    const sigmas = [0.02, 0.02, 0.01];
    const A = [[1, 0], [1, 0.5], [0, 1]];
    const l = [0.01, -0.015, 0.005];
    const Qll = sigmas.map((s, i) =>
      sigmas.map((t, j) => {
        if (i === j) return s * s;
        if ((i === 0 && j === 1) || (i === 1 && j === 0)) return rho * s * t;
        return 0;
      }),
    );
    const P = invert(Qll);
    const N = matMul(matMul(transpose(A), P), A);
    const Qxx = invert(N);
    const xhat = matVec(Qxx, matVec(matMul(transpose(A), P), l));
    const v = matVec(A, xhat).map((val, i) => val - (l[i] ?? 0));
    const AQ = matMul(A, Qxx);
    const Qvv = Qll.map((row, i) =>
      row.map((qllVal, j) => qllVal - (AQ[i] ?? []).reduce((s, a, k) => s + a * (A[j]?.[k] ?? 0), 0)),
    );
    let oracleR = 0;
    let oracleQuad = 0;
    for (let i = 0; i < 3; i += 1) {
      for (let j = 0; j < 3; j += 1) {
        oracleR += (P[i]?.[j] ?? 0) * (Qvv[j]?.[i] ?? 0);
        oracleQuad += (v[i] ?? 0) * (P[i]?.[j] ?? 0) * (v[j] ?? 0);
      }
    }
    const crossAqxxat = (rowA: number, rowB: number): number =>
      (AQ[rowA] ?? []).reduce((s, a, k) => s + a * (A[rowB]?.[k] ?? 0), 0);
    const weightAt = (row: number, col: number): number => P[row]?.[col] ?? Number.NaN;
    const qllCrossAt = (rowA: number, rowB: number): number => {
      const pair = [rowA, rowB].sort().join(',');
      return pair === '0,1' ? rho * (sigmas[0] as number) * (sigmas[1] as number) : 0;
    };
    const labels = [{ obsType: 'angle' }, { obsType: 'angle' }, { obsType: 'angle' }];
    const assembled = assembleStochasticGroupInputs({
      rowLabels: labels,
      residuals: v,
      qvvDiagonalByRow: new Map([[0, Qvv[0]?.[0] as number], [1, Qvv[1]?.[1] as number], [2, Qvv[2]?.[2] as number]]),
      couplingGroups: [[0, 1]],
      crossAqxxat,
      weightAt,
      qllCrossAt,
      gpsCovarianceOf: () => ({ cEE: 1, cNN: 1, cEN: 0 }),
    });
    expect(assembled.crossTerms).toHaveLength(1);
    // Full cross-cofactor, not just −a·Qxx·a'.
    expect(assembled.crossTerms[0]?.qvvAB).toBeCloseTo(
      (Qll[0]?.[1] as number) - crossAqxxat(0, 1), 12,
    );
    const result = computeStochasticGroupDiagnostics({
      ...assembled,
      robustMode: 'none',
    });
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]?.redundancyDof).toBeCloseTo(oracleR, 9);
    expect(result.groups[0]?.quadForm).toBeCloseTo(oracleQuad, 9);
    expect(result.groups[0]?.varianceFactor).toBeCloseTo(oracleQuad / oracleR, 9);
    // The Qll cross term is material: dropping it understates R.
    const dropped = assembleStochasticGroupInputs({
      rowLabels: labels,
      residuals: v,
      qvvDiagonalByRow: new Map([[0, Qvv[0]?.[0] as number], [1, Qvv[1]?.[1] as number], [2, Qvv[2]?.[2] as number]]),
      couplingGroups: [[0, 1]],
      crossAqxxat,
      weightAt,
      gpsCovarianceOf: () => ({ cEE: 1, cNN: 1, cEN: 0 }),
    });
    const droppedR = computeStochasticGroupDiagnostics({ ...dropped, robustMode: 'none' })
      .groups[0]?.redundancyDof as number;
    const gap = 2 * (P[0]?.[1] as number) * (Qll[0]?.[1] as number);
    expect(Math.abs(gap)).toBeGreaterThan(0.01);
    expect(droppedR).toBeCloseTo(oracleR - gap, 9);
  });

  it('fails closed: zero redundancy, single equation, robust, preanalysis, no-model', () => {
    const scalar = { row: 0, group: 'Distances', v: 0.01, w: 10000, qvv: 5e-6 };
    const zeroR = computeStochasticGroupDiagnostics({
      scalarRows: [{ ...scalar, qvv: 0 }],
      blocks: [],
      crossTerms: [],
      crossGroupContaminatedGroups: [],
      robustMode: 'none',
    });
    expect(zeroR.groups[0]?.status).toBe('unestimable');
    const robust = computeStochasticGroupDiagnostics({
      scalarRows: [scalar],
      blocks: [],
      crossTerms: [],
      crossGroupContaminatedGroups: [],
      robustMode: 'huber',
    });
    expect(robust.groups[0]?.status).toBe('unavailable');
    expect(robust.groups[0]?.varianceFactor).toBeUndefined();
    for (const flags of [{ preanalysisMode: true }, { hasModel: false }]) {
      const unavailable = computeStochasticGroupDiagnostics({
        scalarRows: [scalar],
        blocks: [],
        crossTerms: [],
        crossGroupContaminatedGroups: [],
        robustMode: 'none',
        ...flags,
      });
      expect(unavailable.groups[0]?.status).toBe('unavailable');
      expect(unavailable.groups[0]?.varianceFactor).toBeUndefined();
    }
    const spanned = computeStochasticGroupDiagnostics({
      scalarRows: [scalar, { row: 1, group: 'Angles', v: 0.001, w: 2500, qvv: 2e-4 }],
      blocks: [],
      crossTerms: [],
      crossGroupContaminatedGroups: ['Distances', 'Angles'],
      robustMode: 'none',
    });
    expect(spanned.groups.map((g) => g.status)).toEqual(['unestimable', 'unestimable']);
  });

  it('uses the full GPS block trace, not the diagonal sum', () => {
    const v = [0.01, -0.02];
    const P = [[10000, 2000], [2000, 9000]];
    const Qvv = [[1.1e-4, 2e-5], [2e-5, 1.2e-4]];
    const oracleR = P[0][0] * Qvv[0][0] + P[0][1] * Qvv[1][0] + P[1][0] * Qvv[0][1] + P[1][1] * Qvv[1][1];
    const diagSum = (P[0]?.[0] ?? 0) * (Qvv[0]?.[0] ?? 0) + (P[1]?.[1] ?? 0) * (Qvv[1]?.[1] ?? 0);
    expect(Math.abs(oracleR - diagSum)).toBeGreaterThan(0.05);
    const result = computeStochasticGroupDiagnostics({
      scalarRows: [],
      blocks: [{ group: 'GPS', rows: [0, 1], v, P, Qvv }],
      crossTerms: [],
      crossGroupContaminatedGroups: [],
      robustMode: 'none',
    });
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]?.redundancyDof).toBeCloseTo(oracleR, 12);
    expect(result.groups[0]?.redundancyDof).not.toBeCloseTo(diagSum, 6);
    const oracleQuad = v[0] * (P[0][0] * v[0] + P[0][1] * v[1]) + v[1] * (P[1][0] * v[0] + P[1][1] * v[1]);
    expect(result.groups[0]?.quadForm).toBeCloseTo(oracleQuad as number, 12);
    expect(result.groups[0]?.varianceFactor).toBeCloseTo((oracleQuad as number) / oracleR, 12);
  });

  it('maps groups conservatively and audits cross-group correlation', () => {
    expect(stochasticGroupLabel('angle')).toBe('Angles');
    expect(stochasticGroupLabel('direction')).toBe('Directions');
    expect(stochasticGroupLabel('dir')).toBe('Directions');
    expect(stochasticGroupLabel('bearing')).toBe('Az/Bearings');
    expect(stochasticGroupLabel('gps', 'E')).toBe('GPS');
    expect(stochasticGroupLabel('gnssBaseline', 'X')).toBe('GPS');
    // GNSS baseline trap: 3 coupled X/Y/Z rows form ONE GPS block (3 equations).
    const assembled = assembleStochasticGroupInputs({
      rowLabels: [
        { obsType: 'gnssBaseline', component: 'X', covariance: { xx: 1e-4, xy: 1e-5, xz: 0, yy: 1e-4, yz: 0, zz: 1e-4 } },
        { obsType: 'gnssBaseline', component: 'Y', covariance: { xx: 1e-4, xy: 1e-5, xz: 0, yy: 1e-4, yz: 0, zz: 1e-4 } },
        { obsType: 'gnssBaseline', component: 'Z', covariance: { xx: 1e-4, xy: 1e-5, xz: 0, yy: 1e-4, yz: 0, zz: 1e-4 } },
        null, // constraint row: excluded
        { obsType: 'angle' },
        { obsType: 'direction' },
      ],
      residuals: [0.01, 0.02, 0.03, 999, 0.001, 0.002],
      qvvDiagonalByRow: new Map([[4, 1e-6], [5, 2e-6]]),
      couplingGroups: [[0, 1, 2], [4, 5]],
      crossAqxxat: () => 0,
      weightAt: (r, c) => (r === c ? 10000 : 0),
      gpsCovarianceOf: () => ({ cEE: 1e-4, cNN: 1e-4, cEN: 0 }),
    });
    expect(assembled.blocks).toHaveLength(1);
    expect(assembled.blocks[0]?.group).toBe('GPS');
    expect(assembled.blocks[0]?.rows).toEqual([0, 1, 2]);
    // Angle + direction sharing one TS pair: BOTH groups contaminated, no split.
    expect(assembled.crossTerms).toHaveLength(0);
    expect(new Set(assembled.crossGroupContaminatedGroups)).toEqual(new Set(['Angles', 'Directions']));
    // Constraint residual (999) never enters any group input.
    expect(assembled.scalarRows.map((r) => r.row).sort()).toEqual([4, 5]);
  });

  it('marks a single equation UNESTIMABLE even with positive redundancy', () => {
    // One equation carries no redundancy check: a healthy-looking R must not
    // produce a diagnostic scale.
    const result = computeStochasticGroupDiagnostics({
      scalarRows: [{ row: 0, group: 'Distances', v: 0.01, w: 10000, qvv: 5e-5 }],
      blocks: [],
      crossTerms: [],
      crossGroupContaminatedGroups: [],
      robustMode: 'none',
    });
    expect(result.groups[0]?.redundancyDof).toBeCloseTo(0.5, 12);
    expect(result.groups[0]?.status).toBe('unestimable');
    expect(result.groups[0]?.reason).toMatch(/single-equation/);
    expect(result.groups[0]?.varianceFactor).toBeUndefined();
    expect(result.groups[0]?.sigmaScale).toBeUndefined();
  });

  it('withholds quadform/descriptive values for cross-group-contaminated groups', () => {
    const result = computeStochasticGroupDiagnostics({
      scalarRows: [
        { row: 0, group: 'Distances', v: 0.01, w: 10000, qvv: 5e-5 },
        { row: 1, group: 'Angles', v: 0.001, w: 2500, qvv: 2e-4 },
      ],
      blocks: [],
      crossTerms: [],
      crossGroupContaminatedGroups: ['Distances', 'Angles'],
      robustMode: 'none',
    });
    for (const group of result.groups) {
      expect(group.status).toBe('unestimable');
      expect(group.quadForm).toBeNull();
      expect(group.descriptiveFactor).toBeNull();
      expect(group.varianceFactor).toBeUndefined();
    }
  });

  it('fails closed on non-finite inputs without a NaN scale', () => {
    for (const qvv of [Number.POSITIVE_INFINITY, Number.NaN]) {
      const result = computeStochasticGroupDiagnostics({
        scalarRows: [
          { row: 0, group: 'Distances', v: 0.01, w: 10000, qvv },
          { row: 1, group: 'Distances', v: -0.02, w: 10000, qvv: 5e-5 },
        ],
        blocks: [],
        crossTerms: [],
        crossGroupContaminatedGroups: [],
        robustMode: 'none',
      });
      expect(result.groups[0]?.status).toBe('unestimable');
      expect(result.groups[0]?.varianceFactor).toBeUndefined();
      expect(result.groups[0]?.sigmaScale).toBeUndefined();
    }
  });

  it('treats one static-GNSS baseline as a single 3-row correlated GPS block', () => {
    // The standalone GNSS-baseline route builds no stochastic diagnostics by
    // contract; this pins the main-route assembly contract instead: X/Y/Z
    // rows form ONE GPS block with the full 3x3 covariance trace.
    const Qll = [
      [1.0e-4, 2.0e-5, 1.0e-5],
      [2.0e-5, 1.2e-4, -1.5e-5],
      [1.0e-5, -1.5e-5, 9.0e-5],
    ];
    const P = invert(Qll);
    const A = [[1, 0], [0, 1], [1, 1]];
    const Qxx = [[1e-6, 0], [0, 1e-6]];
    const AQ = matMul(A, Qxx);
    const Qvv = Qll.map((row, i) =>
      row.map((qllVal, j) => qllVal - (AQ[i] ?? []).reduce((s, a, k) => s + a * (A[j]?.[k] ?? 0), 0)),
    );
    const v = [0.01, 0.02, -0.015];
    const cov = { xx: 1.0e-4, xy: 2.0e-5, xz: 1.0e-5, yy: 1.2e-4, yz: -1.5e-5, zz: 9.0e-5 };
    const assembled = assembleStochasticGroupInputs({
      rowLabels: [
        { obsType: 'gnssBaseline', component: 'X', covariance: cov },
        { obsType: 'gnssBaseline', component: 'Y', covariance: cov },
        { obsType: 'gnssBaseline', component: 'Z', covariance: cov },
      ],
      residuals: v,
      qvvDiagonalByRow: new Map(),
      couplingGroups: [[0, 1, 2]],
      crossAqxxat: (rowA, rowB) =>
        (AQ[rowA] ?? []).reduce((s, a, k) => s + a * (A[rowB]?.[k] ?? 0), 0),
      weightAt: (row, col) => P[row]?.[col] ?? Number.NaN,
      gpsCovarianceOf: () => ({ cEE: 1, cNN: 1, cEN: 0 }),
    });
    expect(assembled.blocks).toHaveLength(1);
    expect(assembled.blocks[0]?.group).toBe('GPS');
    expect(assembled.blocks[0]?.rows).toEqual([0, 1, 2]);
    const result = computeStochasticGroupDiagnostics({ ...assembled, robustMode: 'none' });
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]?.equations).toBe(3);
    let oracleR = 0;
    let oracleQuad = 0;
    for (let i = 0; i < 3; i += 1) {
      for (let j = 0; j < 3; j += 1) {
        oracleR += (P[i]?.[j] ?? 0) * (Qvv[j]?.[i] ?? 0);
        oracleQuad += (v[i] ?? 0) * (P[i]?.[j] ?? 0) * (v[j] ?? 0);
      }
    }
    const diagOnly = (P[0]?.[0] ?? 0) * (Qvv[0]?.[0] ?? 0)
      + (P[1]?.[1] ?? 0) * (Qvv[1]?.[1] ?? 0)
      + (P[2]?.[2] ?? 0) * (Qvv[2]?.[2] ?? 0);
    expect(Math.abs(oracleR - diagOnly)).toBeGreaterThan(0.05);
    expect(result.groups[0]?.redundancyDof).toBeCloseTo(oracleR, 9);
    expect(result.groups[0]?.quadForm).toBeCloseTo(oracleQuad, 9);
    expect(result.groups[0]?.status).toBe('estimated');
  });

  it('records assembly failures as unavailable-with-reason', () => {
    const diagnostics = unavailableStochasticDiagnostics('group assembly failed: boom');
    expect(diagnostics.groups).toEqual([]);
    expect(diagnostics.reason).toMatch(/boom/);
  });

  it('formats tiny redundancy adaptively and softens weak-redundancy rows', () => {
    expect(formatStochasticRedundancy(1.234567)).toBe('1.235');
    expect(formatStochasticRedundancy(4e-5)).toBe((4e-5).toExponential(2));
    expect(formatStochasticRedundancy(Number.NaN)).toBe('-');
    expect(formatStochasticStatus({ status: 'estimated', redundancyDof: 2 })).toBe('diagnostic');
    expect(
      formatStochasticStatus({ status: 'estimated', redundancyDof: 0.004 }),
    ).toMatch(/indicative only/);
    expect(
      formatStochasticStatus({ status: 'unestimable', reason: 'r', redundancyDof: 0 }),
    ).toBe('unestimable — r');
  });
});
