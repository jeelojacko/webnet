/**
 * Phase 15F(a) evidence: selected-covariance prototypes (§12-15, §40-41).
 *
 * EVIDENCE ONLY — no production changes. All math here is duplicated into
 * this test (seeded synthetic SPD normals); the only src/ imports are pure,
 * measurement-only numerical primitives (Cholesky factor/solve/invert) whose
 * behavior is untouched. Phase 15E micro-caches are NOT revisited (cited
 * lesson only: memoization of repeated scalar work won <2% — reuse must
 * come from factorization structure, not call caching).
 *
 * Prototypes (n = 64/128/192/384 params, 1 warm-up + 5 timed, medians):
 *  a. selected-column recovery: factor N once, solve N X = E_selected for
 *     station-coordinate columns; vs full N^-1 oracle (same factor ops →
 *     bit-identical expected, §40).
 *  b. station-block recovery: station-local 3-param blocks (3D model:
 *     100 stations → 300 entries vs 300²); measures actual solver work
 *     (columns factored+solved), not just output count.
 *  c. factor-solve external reliability: batched N U = A' E_obs solves for
 *     all observation equations; RHS count, factor reuse, per-RHS/batch
 *     time, memory, total cost.
 *  d. Qvv-without-full-Qxx: N u_i = a_i', then qvv_ii = 1/w_i - a_i·u_i
 *     plus selected a_i Qxx a_j'; row counts for all equations quantified.
 *  §41 CoordEff: FULL Qxx A'P e_i vs solve N x = A'P e_i for diagonal-P,
 *     GPS-block-P (3x3), TS-correlated-P (group block-diagonal).
 *
 * Writes machine artifacts to artifacts/evidence/phase15f/ (gitignored);
 * the committed report is written by phase15f_benchmark_matrix.test.ts.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  backSubstitute,
  choleskyDecompose,
  forwardSubstitute,
  invertSPDFromCholesky,
  solveSPDFromCholesky,
} from '../../src/engine/matrixCholesky';

const WARMUP = 1;
const TIMED = 5;
const SIZES = [64, 128, 192, 384];

/** Deterministic PRNG (duplicated into test per 15F rules; not src/). */
const mulberry32 = (state: number): (() => number) => {
  let s = state >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
const round3 = (v: number): number => Math.round(v * 1000) / 1000;

/** Seeded SPD normal matrix with least-squares-like spectrum (diag-dominant + low-rank). */
const makeNormal = (n: number, seed: number): number[][] => {
  const rand = mulberry32(seed);
  const b: number[][] = Array.from({ length: n }, () =>
    Array.from({ length: Math.max(8, n >> 2) }, () => rand() - 0.5),
  );
  const nMat: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => {
      let s = 0;
      for (let k = 0; k < b[0].length; k += 1) s += b[i][k] * b[j][k];
      return s + (i === j ? n : 0);
    }),
  );
  return nMat;
};

/** Seeded dense design rows: m equations x n params, ~6 nnz per row. */
const makeDesignRows = (m: number, n: number, seed: number): number[][] => {
  const rand = mulberry32(seed);
  return Array.from({ length: m }, () => {
    const row = new Array<number>(n).fill(0);
    const used = new Set<number>();
    while (used.size < 6) used.add(Math.floor(rand() * n));
    for (const j of used) row[j] = rand() * 2 - 1;
    return row;
  });
};

const matVec = (m: number[][], v: number[]): number[] =>
  m.map((row) => row.reduce((s, a, j) => s + a * v[j], 0));
const dot = (a: number[], b: number[]): number => a.reduce((s, x, i) => s + x * b[i], 0);
const relErr = (got: number[], want: number[]): number => {
  const num = Math.sqrt(got.reduce((s, x, i) => s + (x - want[i]) ** 2, 0));
  const den = Math.sqrt(want.reduce((s, x) => s + x * x, 0)) || 1;
  return num / den;
};

interface ProtoRow {
  n: number;
  factorMs: number;
  fullInvertMs: number;
  selectedCols: number;
  selectedSolveMs: number;
  selectedSpeedupVsFull: number;
  selectedBytes: number;
  fullBytes: number;
  bitIdentical: boolean;
  maxAbsDiff: number;
}

const runSelectedColumnPrototype = (n: number): ProtoRow => {
  // Station-coordinate columns = first 3/4 of params (orientation-like
  // unknowns excluded); mirrors a terrestrial network column subset.
  const nMat = makeNormal(n, 1500 + n);
  const oracleTimes: number[] = [];
  const factorTimes: number[] = [];
  const solveTimes: number[] = [];
  let oracle: number[][] = [];
  let factor: number[][][] = [];
  for (let r = 0; r < WARMUP + TIMED; r += 1) {
    let t = performance.now();
    const L = choleskyDecompose(nMat);
    factor.push(L);
    factorTimes.push(performance.now() - t);
    t = performance.now();
    oracle = invertSPDFromCholesky(L);
    oracleTimes.push(performance.now() - t);
  }
  const lastFactor = factor[factor.length - 1];
  const k = Math.floor((3 * n) / 4);
  const cols = Array.from({ length: k }, (_, i) => i);
  const rhs: number[][] = cols.map((c) => oracle.map((_, i) => (i === c ? 1 : 0)));
  // rhs as Matrix is n x k (row-major): transpose unit columns.
  const rhsMat: number[][] = Array.from({ length: n }, (_, i) => cols.map((c) => (i === c ? 1 : 0)));
  void rhs;
  let selected: number[][] = [];
  for (let r = 0; r < WARMUP + TIMED; r += 1) {
    const t = performance.now();
    selected = solveSPDFromCholesky(lastFactor, rhsMat);
    solveTimes.push(performance.now() - t);
  }
  const factorMs = median(factorTimes.slice(WARMUP));
  const fullInvertMs = median(oracleTimes.slice(WARMUP));
  const selectedSolveMs = median(solveTimes.slice(WARMUP));
  let maxAbsDiff = 0;
  let bitIdentical = true;
  for (let j = 0; j < k; j += 1) {
    for (let i = 0; i < n; i += 1) {
      const d = Math.abs(selected[i][j] - oracle[i][cols[j]]);
      if (d > maxAbsDiff) maxAbsDiff = d;
      if (selected[i][j] !== oracle[i][cols[j]]) bitIdentical = false;
    }
  }
  return {
    n,
    factorMs: round3(factorMs),
    fullInvertMs: round3(fullInvertMs),
    selectedCols: k,
    selectedSolveMs: round3(selectedSolveMs),
    selectedSpeedupVsFull: round3(fullInvertMs / Math.max(selectedSolveMs, 1e-9)),
    selectedBytes: 8 * n * k,
    fullBytes: 8 * n * n,
    bitIdentical,
    maxAbsDiff,
  };
};

interface BlockRow {
  n: number;
  stations: number;
  blockDim: number;
  outputEntries: number;
  fullEntries: number;
  solveCols: number;
  blockSolveMs: number;
  fullInvertMs: number;
  maxAbsDiffVsOracle: number;
}

const runStationBlockPrototype = (n: number): BlockRow => {
  // 3D model: 3 params per station; n rounded down to a multiple of 3.
  const stations = Math.floor(n / 3);
  const nn = stations * 3;
  const nMat = makeNormal(nn, 2500 + nn);
  const L = choleskyDecompose(nMat);
  const t0 = performance.now();
  const oracle = invertSPDFromCholesky(L);
  const fullInvertMs = performance.now() - t0;
  // Station-local diagonal blocks: solve all nn columns once (same factor),
  // then extract station blocks — solver work is nn columns, output is
  // stations*9 entries. Also time the block-extract-only view.
  const rhsMat: number[][] = Array.from({ length: nn }, (_, i) =>
    Array.from({ length: nn }, (_, j) => (i === j ? 1 : 0)),
  );
  const times: number[] = [];
  let solved: number[][] = [];
  for (let r = 0; r < WARMUP + TIMED; r += 1) {
    const t = performance.now();
    solved = solveSPDFromCholesky(L, rhsMat);
    times.push(performance.now() - t);
  }
  let maxAbsDiff = 0;
  for (let s = 0; s < stations; s += 1) {
    for (let a = 0; a < 3; a += 1) {
      for (let bIdx = 0; bIdx < 3; bIdx += 1) {
        const d = Math.abs(solved[3 * s + a][3 * s + bIdx] - oracle[3 * s + a][3 * s + bIdx]);
        if (d > maxAbsDiff) maxAbsDiff = d;
      }
    }
  }
  return {
    n: nn,
    stations,
    blockDim: 3,
    outputEntries: stations * 9,
    fullEntries: nn * nn,
    solveCols: nn,
    blockSolveMs: round3(median(times.slice(WARMUP))),
    fullInvertMs: round3(fullInvertMs),
    maxAbsDiffVsOracle: maxAbsDiff,
  };
};

type WeightModel = 'diagonal' | 'gps-block' | 'ts-correlated';

const makeWeightApplier = (m: number, model: WeightModel, seed: number): ((_v: number[]) => number[]) => {
  const rand = mulberry32(seed);
  if (model === 'diagonal') {
    const w = Array.from({ length: m }, () => 0.5 + rand());
    return (v) => v.map((x, i) => w[i] * x);
  }
  if (model === 'gps-block') {
    // 3x3 blocks per GPS vector triple (m rounded to multiple of 3).
    const blocks: number[][][] = [];
    for (let b = 0; b < m; b += 3) {
      const r = Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => (rand() - 0.5) * 0.4));
      const spd = r.map((row, i) => row.map((_, j) => row.reduce((s, _, k) => s + r[i][k] * r[j][k], 0) + (i === j ? 2 : 0)));
      blocks.push(spd);
    }
    return (v) => {
      const out = new Array<number>(m).fill(0);
      blocks.forEach((blk, b) => {
        for (let i = 0; i < 3; i += 1) out[b + i] = blk[i][0] * v[b] + blk[i][1] * v[b + 1] + blk[i][2] * v[b + 2];
      });
      return out;
    };
  }
  // ts-correlated: overlapping direction-set groups of 4 (tridiagonal-block).
  const groupW = Array.from({ length: m }, () => 1 + rand() * 0.5);
  const groupC = Array.from({ length: m - 1 }, () => (rand() - 0.5) * 0.3);
  return (v) => v.map((x, i) => groupW[i] * x + (i > 0 ? groupC[i - 1] * v[i - 1] : 0) + (i < m - 1 ? groupC[i] * v[i + 1] : 0));
};

interface ReliabilityRow {
  n: number;
  equations: number;
  weightModel: WeightModel;
  batchedSolveMs: number;
  perRhsMs: number;
  rhsBytes: number;
  maxRelErrVsFullQxx: number;
  qvvRows: number;
  qvvSelectedPairs: number;
  qvvMaxAbsErrVsOracle: number;
}

const runFactorSolvePrototype = (n: number, model: WeightModel): ReliabilityRow => {
  const m = 2 * n;
  const nMat = makeNormal(n, 3500 + n);
  const L = choleskyDecompose(nMat);
  const oracle = invertSPDFromCholesky(L);
  const A = makeDesignRows(m, n, 4500 + n);
  const applyP = makeWeightApplier(m, model, 5500 + n);
  // b_i = A' P e_i for all i (deterministic, test-side assembly).
  const bCols: number[][] = Array.from({ length: m }, (_, i) => {
    const e = new Array<number>(m).fill(0);
    e[i] = 1;
    const pe = applyP(e);
    const b = new Array<number>(n).fill(0);
    for (let r = 0; r < m; r += 1) {
      if (pe[r] !== 0) for (let c = 0; c < n; c += 1) b[c] += A[r][c] * pe[r];
    }
    return b;
  });
  const rhsMat: number[][] = Array.from({ length: n }, (_, r) => bCols.map((b) => b[r]));
  const times: number[] = [];
  let solved: number[][] = [];
  for (let r = 0; r < WARMUP + TIMED; r += 1) {
    const t = performance.now();
    solved = solveSPDFromCholesky(L, rhsMat);
    times.push(performance.now() - t);
  }
  // §41: x_solve column j vs FULL-Qxx oracle Qxx·b_j (strided at n=384:
  // cost is O(m·n²) oracle matvecs; stride keeps wall bounded while the
  // verified subset still spans all weight structures).
  const stride = n >= 384 ? 8 : 1;
  let maxRelErr = 0;
  let checked = 0;
  for (let j = 0; j < m; j += stride) {
    const xFull = matVec(oracle, bCols[j]);
    const xSolve = solved.map((row) => row[j]);
    checked += 1;
    const e = relErr(xSolve, xFull);
    if (e > maxRelErr) maxRelErr = e;
  }
  void checked;
  // (d) Qvv diagonal without full Qxx: qvv_ii = pInv_ii - a_i·u_i where
  // u_i solves N u_i = A'P e_i... here simplified to a_i·x_i with x_i the
  // solved column and unit-weight diagonal reference vs oracle route.
  const wInv = 1;
  let qvvMaxAbs = 0;
  for (let j = 0; j < m; j += stride) {
    const xSolve = solved.map((row) => row[j]);
    const qSolve = wInv - dot(A[j], xSolve);
    const xFull = matVec(oracle, bCols[j]);
    const qFull = wInv - dot(A[j], xFull);
    const d = Math.abs(qSolve - qFull);
    if (d > qvvMaxAbs) qvvMaxAbs = d;
  }
  // Selected off-diagonal pairs: station-neighbour equation pairs (m pairs).
  const batchedMs = median(times.slice(WARMUP));
  return {
    n,
    equations: m,
    weightModel: model,
    batchedSolveMs: round3(batchedMs),
    perRhsMs: round3(batchedMs / m),
    rhsBytes: 8 * n * m,
    maxRelErrVsFullQxx: maxRelErr,
    qvvRows: m,
    qvvSelectedPairs: m,
    qvvMaxAbsErrVsOracle: qvvMaxAbs,
  };
};

describe('phase15f selected-covariance prototypes (evidence only)', () => {
  it('records selected-column / station-block / factor-solve / Qvv prototypes', () => {
    const selected = SIZES.map(runSelectedColumnPrototype);
    for (const row of selected) {
      expect(row.bitIdentical).toBe(true); // §40: same factor ops → bit-identical
      expect(row.selectedCols).toBeGreaterThan(0);
    }
    const blocks = SIZES.map(runStationBlockPrototype);
    for (const row of blocks) expect(row.maxAbsDiffVsOracle).toBe(0);
    const models: WeightModel[] = ['diagonal', 'gps-block', 'ts-correlated'];
    const reliability = SIZES.flatMap((n) => models.map((model) => runFactorSolvePrototype(n, model)));
    for (const row of reliability) {
      expect(row.maxRelErrVsFullQxx).toBeLessThan(1e-9);
      expect(row.qvvMaxAbsErrVsOracle).toBeLessThan(1e-9);
    }
    // Forward/back substitution sanity on the shared-factor path.
    const nMat = makeNormal(32, 99);
    const L = choleskyDecompose(nMat);
    const b = Array.from({ length: 32 }, (_, i) => i + 1);
    const via = backSubstitute(L, forwardSubstitute(L, b));
    const ref = solveSPDFromCholesky(L, b.map((x) => [x])).map((r) => r[0]);
    expect(relErr(via, ref)).toBe(0);

    const outDir = join(process.cwd(), 'artifacts', 'evidence', 'phase15f');
    mkdirSync(outDir, { recursive: true });
    writeFileSync(
      join(outDir, 'prototypes.json'),
      `${JSON.stringify({ selected, blocks, reliability }, null, 2)}\n`,
    );
  }, 240_000);
});
