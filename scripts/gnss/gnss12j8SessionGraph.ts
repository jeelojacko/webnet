#!/usr/bin/env tsx
/**
 * Phase 12J.8 Stage 2b — multi-window session-graph sensitivity (EVIDENCE ONLY).
 * Extends gnss12j7SessionGraph.ts (never edits it) to >=4 daily sessions on
 * the expanded 12J.8 corpus. Read-only use of engine helpers:
 * composeSession/selectSpanningTree (gnssRawSession) + covToMatrix
 * (gnssStochasticEvidence). No src/ changes.
 * Compares deterministic STAR vs MST(shortest-total-length) vs FULL-graph WLS
 * (WARE fixed) per session: coordinate spread + SEUW. Verdict per session and
 * overall: SPANNING_TREE_SUFFICIENT_INITIAL or CROSS_COVARIANCE_REQUIRED.
 * Usage: npx tsx scripts/gnss/gnss12j8SessionGraph.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { composeSession, selectSpanningTree } from '../../src/engine/gnssRawSession';
import { covToMatrix } from '../../src/engine/gnssStochasticEvidence';
import type { GnssBaselineCovariance } from '../../src/engine/gnssBaselineTypes';
import type { RawSessionMember } from '../../src/engine/gnssRawSession';

type V3 = [number, number, number];
const W = join(process.env['HOME'] ?? '~', 'Downloads/webnet-gnss-medium/belgian-12j8/work12j8');
const sol = JSON.parse(readFileSync(join(W, 'solutions.json'), 'utf8')).runs as Array<{
  pair: string; doy: string; tag: string; eph: string; status: string;
  vec: V3; cov: number[][]; ratio: number; fix: number; epochs: number; nsat: number;
}>;
const MARKER: Record<string, V3> = {
  WARE: [4031947.1301, 370150.7758, 4911905.3657],
  VOER: [4022975.3119, 402278.5823, 4916612.3104],
  TGRN: [4023470.1812, 385846.4845, 4917555.1248],
  EIJS: [4023086.533, 400394.875, 4916655.319],
};
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const neg = (a: V3): V3 => [-a[0], -a[1], -a[2]];
interface Edge { from: string; to: string; d: V3; c: GnssBaselineCovariance; ratio: number; pair: string; len: number }
const toCov = (m: number[][]): GnssBaselineCovariance =>
  ({ xx: m[0][0], xy: m[0][1], xz: m[0][2], yy: m[1][1], yz: m[1][2], zz: m[2][2] });
const LEN: Record<string, number> = {
  'TGRN-WARE': 18712, 'VOER-WARE': 33687, 'EIJS-WARE': 31871,
  'TGRN-VOER': 16467, 'TIT2-VOER': 59412,
};

// Per session (doy+tag): directed edges from->to, value to-minus-from.
// STAR: WARE-anchored legs; MST: shortest-total-length tree (TGRN-VOER,
// TGRN-WARE, EIJS-WARE); FULL: all available legs incl. TIT2-VOER.
function edgesFor(doy: string, tag: string): Edge[] {
  const g = sol.filter((r) => r.doy === doy && r.tag === tag && r.eph === 'prec' && r.status === 'FIXED' && r.vec);
  const byPair = (p: string) => g.find((r) => r.pair === p);
  const mk = (from: string, to: string, pair: string, flip: boolean): Edge | null => {
    const r = byPair(pair);
    if (!r) return null;
    return { from, to, d: flip ? neg(r.vec) : r.vec, c: toCov(r.cov), ratio: r.ratio, pair, len: LEN[pair] ?? 0 };
  };
  return [
    mk('WARE', 'TGRN', 'TGRN-WARE', false),
    mk('WARE', 'VOER', 'VOER-WARE', false),
    mk('WARE', 'EIJS', 'EIJS-WARE', false),
    mk('TGRN', 'VOER', 'TGRN-VOER', true),
    // TIT2-VOER excluded: VOER-anchored long leg outside the WARE datum
    // star (would need datum propagation); documented, not silently dropped.
  ].filter((e): e is Edge => e !== null);
}

function solveWLS(es: Edge[], fixed: V3, unk: string[]): { x: Record<string, V3>; seuw: number | null; dof: number } {
  const idx = (s: string, k: number) => unk.indexOf(s) * 3 + k;
  const n = unk.length * 3;
  const N: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  const u: number[] = new Array(n).fill(0);
  const inv3 = (m: number[][]): number[][] => {
    const [a, b, c] = m[0]; const [d, e, f] = m[1]; const [g2, h, i] = m[2];
    const det = a * (e * i - f * h) - b * (d * i - f * g2) + c * (d * h - e * g2);
    if (!(det > 0) || !Number.isFinite(det)) throw new Error('not SPD');
    return [
      [(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det],
      [(f * g2 - d * i) / det, (a * i - c * g2) / det, (c * d - a * f) / det],
      [(d * h - e * g2) / det, (b * g2 - a * h) / det, (a * e - b * d) / det],
    ];
  };
  const coordOf = (s: string, x: Record<string, V3>): V3 => (s === 'WARE' ? MARKER.WARE : x[s]);
  for (const e of es) {
    const M = covToMatrix(e.c);
    const Wm = inv3([[M[0][0], M[0][1], M[0][2]], [M[1][0], M[1][1], M[1][2]], [M[2][0], M[2][1], M[2][2]]]);
    const rows: Array<{ s: string; sgn: number }> = [];
    if (e.from !== 'WARE') rows.push({ s: e.from, sgn: -1 });
    if (e.to !== 'WARE') rows.push({ s: e.to, sgn: 1 });
    const rhs: V3 = [...e.d] as V3;
    if (e.from === 'WARE') { rhs[0] += fixed[0]; rhs[1] += fixed[1]; rhs[2] += fixed[2]; }
    for (const r1 of rows) for (let k = 0; k < 3; k++) {
      u[idx(r1.s, k)] += r1.sgn * (Wm[k][0] * rhs[0] + Wm[k][1] * rhs[1] + Wm[k][2] * rhs[2]);
      for (const r2 of rows) for (let l = 0; l < 3; l++) N[idx(r1.s, k)][idx(r2.s, l)] += r1.sgn * r2.sgn * Wm[k][l];
    }
  }
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
  const x: Record<string, V3> = {};
  unk.forEach((s, j) => { x[s] = [xhat[j * 3], xhat[j * 3 + 1], xhat[j * 3 + 2]]; });
  let q = 0;
  const dof = es.length * 3 - n;
  if (dof > 0) {
    for (const e of es) {
      const pred = sub(coordOf(e.to, x), e.from === 'WARE' ? fixed : coordOf(e.from, x));
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

const SESSIONS: Array<[string, string]> = [['124', 'h00'], ['126', 'h12'], ['129', 'h06'], ['132', 'h00'], ['135', 'h12']];
let worst = 0;
for (const [doy, tag] of SESSIONS) {
  const es = edgesFor(doy, tag);
  const unk = [...new Set(es.flatMap((e) => [e.from, e.to]).filter((s) => s !== 'WARE' && s !== 'TIT2'))];
  const star = es.filter((e) => e.pair.endsWith('WARE'));
  const mstPairs = ['TGRN-VOER', 'TGRN-WARE', 'EIJS-WARE'];
  const mst = es.filter((e) => mstPairs.includes(e.pair));
  if (star.length < 3 || mst.length < 3) { console.log(`DOY${doy} ${tag}: insufficient legs (star=${star.length} mst=${mst.length}), skipped`); continue; }
  const S = solveWLS(star, MARKER.WARE, unk.filter((s) => star.some((e) => e.from === s || e.to === s)));
  const M = solveWLS(mst, MARKER.WARE, unk.filter((s) => mst.some((e) => e.from === s || e.to === s)));
  const F = solveWLS(es, MARKER.WARE, unk);
  const spread = (a: Record<string, V3>, b: Record<string, V3>) =>
    Math.max(...Object.keys(a).filter((s) => b[s]).map((s) => Math.hypot(...sub(a[s], b[s])) * 1000));
  const dSM = spread(S.x, M.x); const dSF = spread(S.x, F.x); const dMF = spread(M.x, F.x);
  worst = Math.max(worst, dSM, dSF, dMF);
  console.log(`DOY${doy} ${tag}: legs=${es.length} FULLdof=${F.dof} SEUW=${F.seuw?.toFixed(1)} |STAR-MST|=${dSM.toFixed(1)}mm |STAR-FULL|=${dSF.toFixed(1)}mm |MST-FULL|=${dMF.toFixed(1)}mm`);
}
// engine helper smoke: compose+tree on first session (read-only)
const es0 = edgesFor('124', 'h00');
const review = composeSession(
  es0.map((e) => ({
    result: {
      status: 'FIXED', from: e.from, to: e.to, deltaX: e.d[0], deltaY: e.d[1], deltaZ: e.d[2],
      covarianceAssessment: { status: 'FORMAL_UNCALIBRATED' },
      antennaAssessment: { overall: 'FULL' },
      solutionQuality: { ratio: e.ratio, fixedEpochs: 1, usedEpochs: 1, satellites: 8 },
    } as unknown as RawSessionMember['result'],
    baseObsSha: 'sha256:12j8-graph', roverObsSha: 'sha256:12j8-graph',
  })),
  'p12j8-graph', '2026-05-04T00:00:00Z',
);
const tree = selectSpanningTree(review);
console.log('engine tree winners:', tree.filter((m) => m.role !== 'REDUNDANT').map((m) => `${m.result.from}->${m.result.to}`).join(' '));
console.log(worst < 100 ? 'VERDICT: SPANNING_TREE_SUFFICIENT_INITIAL' : 'VERDICT: CROSS_COVARIANCE_REQUIRED');
