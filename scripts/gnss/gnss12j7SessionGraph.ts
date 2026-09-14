#!/usr/bin/env tsx
/**
 * Phase 12J.7 Stage 2 — session-graph comparison (EVIDENCE ONLY).
 * Read-only use of engine helpers: composeSession/selectSpanningTree
 * (gnssRawSession) + covToMatrix/ecefToEnuRotation (gnssStochasticEvidence).
 * No src/ changes. Compares deterministic STAR vs MST(operator) vs engine tree
 * vs full-graph LS on one window (DOY124 h00 prec): adjusted coords,
 * residuals, formal cov, SEUW. Verdict: SPANNING_TREE_SUFFICIENT_INITIAL or
 * CROSS_COVARIANCE_REQUIRED. Usage: npx tsx scripts/gnss/gnss12j7SessionGraph.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { composeSession, selectSpanningTree } from '../../src/engine/gnssRawSession';
import { covToMatrix } from '../../src/engine/gnssStochasticEvidence';
import type { GnssBaselineCovariance } from '../../src/engine/gnssBaselineTypes';
import type { RawSessionMember } from '../../src/engine/gnssRawSession';

type V3 = [number, number, number];
const W = join(process.env['HOME'] ?? '~', 'Downloads/webnet-gnss-medium/belgian/work12j7');
const sol = JSON.parse(readFileSync(join(W, 'solutions.json'), 'utf8')).runs as Array<{
  pair: string; doy: string; tag: string; eph: string; status: string;
  vec: V3; cov: number[][]; ratio: number; fix: number; epochs: number; nsat: number;
}>;
const MARKER: Record<string, V3> = {
  WARE: [4031947.1301, 370150.7758, 4911905.3657],
  TGRN: [4023470.1812, 385846.4845, 4917555.1248],
  VOER: [4022975.3119, 402278.5823, 4916612.3104],
  WERB: [4055527.7993, 403142.4181, 4890387.0011],
};
// directed edges from->to with value to-minus-from (DOY124 h00 prec FIXED)
const DOY = process.env['DOY'] ?? '124'; // independent-data check: DOY=125..128 reruns
const g = sol.filter((r) => r.doy === DOY && r.tag === 'h00' && r.eph === 'prec' && r.status === 'FIXED');
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const neg = (a: V3): V3 => [-a[0], -a[1], -a[2]];
interface Edge { from: string; to: string; d: V3; c: GnssBaselineCovariance; ratio: number; pair: string }
const byPair = (p: string) => g.find((r) => r.pair === p);
const toCov = (m: number[][]): GnssBaselineCovariance =>
  ({ xx: m[0][0], xy: m[0][1], xz: m[0][2], yy: m[1][1], yz: m[1][2], zz: m[2][2] });
const edges: Edge[] = [
  { from: 'WARE', to: 'TGRN', d: byPair('TGRN-WARE')!.vec, c: toCov(byPair('TGRN-WARE')!.cov), ratio: 0, pair: 'TGRN-WARE' },
  { from: 'WARE', to: 'VOER', d: byPair('VOER-WARE')!.vec, c: toCov(byPair('VOER-WARE')!.cov), ratio: 0, pair: 'VOER-WARE' },
  { from: 'WARE', to: 'WERB', d: byPair('WERB-WARE')!.vec, c: toCov(byPair('WERB-WARE')!.cov), ratio: 0, pair: 'WERB-WARE' },
  { from: 'TGRN', to: 'VOER', d: neg(byPair('TGRN-VOER')!.vec), c: toCov(byPair('TGRN-VOER')!.cov), ratio: 0, pair: 'TGRN-VOER' },
  { from: 'VOER', to: 'WERB', d: neg(byPair('VOER-WERB')!.vec), c: toCov(byPair('VOER-WERB')!.cov), ratio: 0, pair: 'VOER-WERB' },
  { from: 'TGRN', to: 'WERB', d: neg(byPair('TGRN-WERB')!.vec), c: toCov(byPair('TGRN-WERB')!.cov), ratio: 0, pair: 'TGRN-WERB' },
];
for (const e of edges) e.ratio = g.find((r) => r.pair === e.pair)!.ratio;

// engine session: compose + select spanning tree (hashes = real DOY124 crx sha256)
const SHA: Record<string, string> = {
  WARE: 'a2bf6cbec6cb72f8c513d02e69104fb7438dce676bfe547ddaed4cdc4c5220a3',
  TGRN: '93d337961ccd579fc0685296e0af0cc0dd229bd3ccb907caacca1328dff74bdb',
  VOER: '2bfe87152f84bdadef42da5339558352dcd99de6b450eac5c77fc65eb7f13a1e',
  WERB: '1e6dd97ea52b9430eeda60ceb7f7b42c76d0ad8f74d95502146a713e052b497d',
};
const review = composeSession(
  edges.map((e) => ({
    result: {
      status: 'FIXED', from: e.from, to: e.to, deltaX: e.d[0], deltaY: e.d[1], deltaZ: e.d[2],
      covarianceAssessment: { status: 'FORMAL_UNCALIBRATED' },
      antennaAssessment: { overall: 'FULL' },
      solutionQuality: { ratio: e.ratio, fixedEpochs: 1, usedEpochs: 1, satellites: 8 },
    } as unknown as RawSessionMember['result'],
    baseObsSha: `sha256:${SHA[e.from]}`,
    roverObsSha: `sha256:${SHA[e.to]}`,
  })),
  'p12j7-graph', '2026-05-04T00:00:00Z',
);
const tree = selectSpanningTree(review);
console.log('engine tree winners:', tree.filter((m) => m.role !== 'REDUNDANT').map((m) => `${m.result.from}->${m.result.to}`).join(' '));
console.log('dependency groups:', [...new Set(tree.map((m) => m.dependencyGroup))].length, 'warnings:', review.warnings.length);

// weighted LS with WARE fixed. Unknowns order TGRN,VOER,WERB xyz.
function solveWLS(es: Edge[]): { x: Record<string, V3>; seuw: number | null; dof: number } {
  const stations = ['TGRN', 'VOER', 'WERB'];
  const idx = (s: string, k: number) => stations.indexOf(s) * 3 + k;
  const n = 9;
  const N: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  const u: number[] = new Array(n).fill(0);
  // invert 3x3 (SPD gate: det>0, finite)
  const inv3 = (m: number[][]): number[][] => {
    const [a, b, c] = m[0];
    const [d, e, f] = m[1];
    const [g2, h, i] = m[2];
    const det = a * (e * i - f * h) - b * (d * i - f * g2) + c * (d * h - e * g2);
    if (!(det > 0) || !Number.isFinite(det)) throw new Error('not SPD');
    return [
      [(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det],
      [(f * g2 - d * i) / det, (a * i - c * g2) / det, (c * d - a * f) / det],
      [(d * h - e * g2) / det, (b * g2 - a * h) / det, (a * e - b * d) / det],
    ];
  };
  for (const e of es) {
    const M = covToMatrix(e.c);
    const Wm = inv3([[M[0][0], M[0][1], M[0][2]], [M[1][0], M[1][1], M[1][2]], [M[2][0], M[2][1], M[2][2]]]);
    const rows: Array<{ s: string; sgn: number }> = [];
    if (e.from !== 'WARE') rows.push({ s: e.from, sgn: -1 });
    if (e.to !== 'WARE') rows.push({ s: e.to, sgn: 1 });
    // model: d = x_to - x_from; WARE anchored at MARKER (no to==WARE edges here)
    const rhs: V3 = [...e.d] as V3;
    if (e.from === 'WARE') { rhs[0] += MARKER.WARE[0]; rhs[1] += MARKER.WARE[1]; rhs[2] += MARKER.WARE[2]; }
    for (const r1 of rows) for (let k = 0; k < 3; k++) {
      u[idx(r1.s, k)] += r1.sgn * (Wm[k][0] * rhs[0] + Wm[k][1] * rhs[1] + Wm[k][2] * rhs[2]);
      for (const r2 of rows) for (let l = 0; l < 3; l++) N[idx(r1.s, k)][idx(r2.s, l)] += r1.sgn * r2.sgn * Wm[k][l];
    }
  }
  // Gaussian elimination
  const A = N.map((row, i) => [...row, u[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    const d = A[c][c];
    if (!(Math.abs(d) > 0)) throw new Error('singular');
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = A[r][c] / d;
      for (let k = c; k <= n; k++) A[r][k] -= f * A[c][k];
    }
  }
  const xhat = A.map((row, i) => row[n] / (A[i][i] as number));
  const x: Record<string, V3> = {
    TGRN: [xhat[0], xhat[1], xhat[2]], VOER: [xhat[3], xhat[4], xhat[5]], WERB: [xhat[6], xhat[7], xhat[8]],
  };
  let q = 0;
  const dof = es.length * 3 - 9;
  if (dof > 0) {
    for (const e of es) {
      const pred = sub(x[e.to], e.from === 'WARE' ? MARKER.WARE : x[e.from]);
      const r = sub(pred, e.d);
      const M = covToMatrix(e.c);
      const Wm = inv3([[M[0][0], M[0][1], M[0][2]], [M[1][0], M[1][1], M[1][2]], [M[2][0], M[2][1], M[2][2]]]);
      q += r[0] * (Wm[0][0] * r[0] + Wm[0][1] * r[1] + Wm[0][2] * r[2])
        + r[1] * (Wm[1][0] * r[0] + Wm[1][1] * r[1] + Wm[1][2] * r[2])
        + r[2] * (Wm[2][0] * r[0] + Wm[2][1] * r[1] + Wm[2][2] * r[2]);
    }
  }
  return { x, seuw: dof > 0 ? Math.sqrt(q / dof) : null, dof };
}
const pick = (...pairs: string[]) => edges.filter((e) => pairs.includes(e.pair));
const STAR = solveWLS(pick('TGRN-WARE', 'VOER-WARE', 'WERB-WARE'));
const MST = solveWLS(pick('TGRN-VOER', 'TGRN-WARE', 'VOER-WERB'));
const FULL = solveWLS(edges);
console.log(`FULL dof=${FULL.dof} SEUW=${FULL.seuw?.toFixed(1)}`);
for (const s of ['TGRN', 'VOER', 'WERB'] as const) {
  const ds = Math.hypot(...sub(STAR.x[s], FULL.x[s])) * 1000;
  const dm = Math.hypot(...sub(MST.x[s], FULL.x[s])) * 1000;
  const dsm = Math.hypot(...sub(STAR.x[s], MST.x[s])) * 1000;
  console.log(`${s}: |STAR-FULL|=${ds.toFixed(1)}mm |MST-FULL|=${dm.toFixed(1)}mm |STAR-MST|=${dsm.toFixed(1)}mm`);
}
const mx = Math.max(...(['TGRN', 'VOER', 'WERB'] as const).map((s) => Math.hypot(...sub(STAR.x[s], MST.x[s])) * 1000));
console.log(mx < 100 ? 'VERDICT: SPANNING_TREE_SUFFICIENT_INITIAL' : 'VERDICT: CROSS_COVARIANCE_REQUIRED');
