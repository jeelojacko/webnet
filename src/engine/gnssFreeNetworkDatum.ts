/**
 * Phase 12I.0 Worker A — EVIDENCE ONLY free-network datum math (part 1).
 *
 * Production-unreachable helpers: nothing here is imported by any
 * production solver, preflight, tolerance, routing, UI, or import path.
 * Pure dense functions over assembled GNSS design matrices.
 *
 * Row convention mirrors `appendGnssBaselineEquationRows`
 * (src/engine/gnssBaselineEquationRows.ts): one baseline contributes 3
 * scalar rows with A = [-I3 +I3] (FROM -1, TO +1).
 *
 * Analytic [-I +I] . 1-translation = 0 proof (datum defect origin):
 * for a translation mode t_k (all stations shifted by unit vector e_k),
 * each scalar row r of baseline (from f, to o) reads
 *   (A t_k)[r] = -1 * [s(f)==axis k] + 1 * [s(o)==axis k] = -1 + 1 = 0,
 * because every baseline row touches exactly one FROM unknown and one TO
 * unknown on the SAME axis. Hence each e_k mode is in null(A), so
 * null(N) with N = A'PA always contains the 3 translation modes of every
 * connected component: defect >= 3 per component, and exactly 3 when the
 * component graph is connected (any null vector must be constant per
 * axis along edges: -a_f + a_o = 0 per row forces a constant).
 */
import type { StationMap } from '../types';
import type { GnssBaselineObservation } from './gnssBaselineTypes';
import { invertGnssBaselineCovariance } from './gnssBaselineCovariance';
import { gnssBaselineLabel } from './gnssBaselineEquationRows';
import { gnssBaselineComponents } from './gnssBaselinePreflight';

export interface FreeNetworkAssembly {
  readonly stationIds: string[];
  /** Column of station's x/y/h unknowns: colOf.get(id) = [cx, cy, ch]. */
  readonly colOf: Map<string, [number, number, number]>;
  /** Connected components (baseline edges) over stationIds. */
  readonly components: string[][];
  /** Design matrix (nScalar x numParams), all stations free. */
  readonly A: number[][];
  /** Observed-minus-computed vector (nScalar x 1). */
  readonly L: number[][];
  /** Dense block-diagonal weight matrix (nScalar x nScalar). */
  readonly P: number[][];
  /** Normal matrix N = A'PA (numParams x numParams). */
  readonly N: number[][];
  /** Normal RHS u = A'PL (numParams x 1). */
  readonly u: number[][];
  readonly nScalar: number;
  readonly numParams: number;
}

/** Assemble the all-free design system from a-priori coords + baselines. */
export const assembleFreeNetwork = (
  stations: StationMap,
  baselines: GnssBaselineObservation[],
): FreeNetworkAssembly => {
  const stationIds = Object.keys(stations).sort();
  const colOf = new Map<string, [number, number, number]>();
  stationIds.forEach((id, s) => colOf.set(id, [3 * s, 3 * s + 1, 3 * s + 2]));
  const ordered = [...baselines].sort((a, b) => a.id - b.id);
  const nScalar = 3 * ordered.length;
  const numParams = 3 * stationIds.length;
  const A: number[][] = Array.from({ length: nScalar }, () => new Array(numParams).fill(0));
  const L: number[][] = Array.from({ length: nScalar }, () => [0]);
  const P: number[][] = Array.from({ length: nScalar }, () => new Array(nScalar).fill(0));
  ordered.forEach((baseline, b) => {
    const from = stations[baseline.from];
    const to = stations[baseline.to];
    if (!from || !to) {
      throw new Error(`Free-network evidence: missing station for ${gnssBaselineLabel(baseline)}.`);
    }
    const calc = [to.x - from.x, to.y - from.y, to.h - from.h];
    const obs = [baseline.vector.x, baseline.vector.y, baseline.vector.z];
    const [fx, fy, fz] = colOf.get(baseline.from) as [number, number, number];
    const [tx, ty, tz] = colOf.get(baseline.to) as [number, number, number];
    const fromCols = [fx, fy, fz];
    const toCols = [tx, ty, tz];
    // Weight block P_b = C^-1 via the verified production inverter.
    const weight = invertGnssBaselineCovariance(baseline.covariance, gnssBaselineLabel(baseline));
    for (let k = 0; k < 3; k += 1) {
      const row = 3 * b + k;
      L[row]![0] = (obs[k] ?? 0) - (calc[k] ?? 0);
      A[row]![fromCols[k] as number] = -1;
      A[row]![toCols[k] as number] = 1;
      for (let j = 0; j < 3; j += 1) {
        P[row]![3 * b + j] = weight[k]?.[j] ?? 0;
      }
    }
  });
  const N = multiply(transpose(A), multiply(P, A));
  const u = multiply(transpose(A), multiply(P, L));
  const components = gnssBaselineComponents(ordered);
  return { stationIds, colOf, components, A, L, P, N, u, nScalar, numParams };
};

/** Raw translation modes (one unit shift per axis, all stations). */
export const translationModes = (numStations: number): number[][] => {
  const n = 3 * numStations;
  const modes: number[][] = [new Array(n).fill(0), new Array(n).fill(0), new Array(n).fill(0)];
  for (let s = 0; s < numStations; s += 1) {
    for (let k = 0; k < 3; k += 1) modes[k]![3 * s + k] = 1;
  }
  return modes;
};

/** Per-component translation modes (n x 3c, disjoint support per component). */
export const componentTranslationModes = (assembly: FreeNetworkAssembly): number[][] => {
  const { stationIds, colOf, components } = assembly;
  const indexOf = new Map(stationIds.map((id, s) => [id, s]));
  return components.flatMap((component) => {
    const modes: number[][] = [
      new Array(assembly.numParams).fill(0),
      new Array(assembly.numParams).fill(0),
      new Array(assembly.numParams).fill(0),
    ];
    component.forEach((id) => {
      const cols = colOf.get(id);
      const s = indexOf.get(id);
      if (!cols || s === undefined || !stationIds.includes(id)) return;
      for (let k = 0; k < 3; k += 1) modes[k]![cols[k] as number] = 1;
    });
    return modes;
  });
};

/** Normalize nonzero columns to unit length (translation modes are orthogonal). */
export const orthonormalizeColumns = (cols: number[][]): number[][] =>
  cols.map((col) => {
    const norm = Math.sqrt(col.reduce((sum, value) => sum + value * value, 0));
    if (!(norm > 0)) throw new Error('Free-network evidence: zero nullspace column.');
    return col.map((value) => value / norm);
  });

/** Centering S-transform S = I - Z Z' (Z orthonormal nullspace basis). */
export const centeringMatrix = (zOrth: number[][], n: number): number[][] => {
  const S: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  );
  zOrth.forEach((z) => {
    for (let i = 0; i < n; i += 1) {
      for (let j = 0; j < n; j += 1) S[i]![j]! -= (z[i] ?? 0) * (z[j] ?? 0);
    }
  });
  return S;
};

/** Relative covariance Q_(Xi-Xj) = J Q J' with J = [-I +I] selector. */
export const relativeCovariance = (
  Q: number[][],
  from: [number, number, number],
  to: [number, number, number],
): number[][] => {
  const rel: number[][] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let r = 0; r < 3; r += 1) {
    for (let s = 0; s < 3; s += 1) {
      const p = [from[r], to[r]];
      const q = [from[s], to[s]];
      rel[r]![s] =
        (Q[p[0] as number]?.[q[0] as number] ?? 0) -
        (Q[p[0] as number]?.[q[1] as number] ?? 0) -
        (Q[p[1] as number]?.[q[0] as number] ?? 0) +
        (Q[p[1] as number]?.[q[1] as number] ?? 0);
    }
  }
  return rel;
};

// --- Small self-contained dense linear algebra (no new deps). ---

export const transpose = (M: number[][]): number[][] => {
  if (M.length === 0) return [];
  return (M[0] as number[]).map((_, j) => M.map((row) => row[j] ?? 0));
};

export const multiply = (A: number[][], B: number[][]): number[][] => {
  if (A.length === 0 || B.length === 0) return Array.from({ length: A.length }, () => []);
  const inner = B.length;
  const cols = B[0]?.length ?? 0;
  return A.map((row) => {
    const out = new Array(cols).fill(0);
    for (let k = 0; k < inner; k += 1) {
      const aik = row[k] ?? 0;
      if (aik === 0) continue;
      for (let j = 0; j < cols; j += 1) out[j]! += aik * (B[k]?.[j] ?? 0);
    }
    return out;
  });
};

const SINGULAR_TOL = 1e-14;

/** Gaussian elimination with partial pivot, multiple RHS. Throws when singular. */
export const solveDense = (M: number[][], B: number[][]): number[][] => {
  const n = M.length;
  const aug = M.map((row, i) => [...row, ...(B[i] ?? new Array(B[0]?.length ?? 1).fill(0))]);
  const nrhs = B[0]?.length ?? 1;
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(aug[row]?.[col] ?? 0) > Math.abs(aug[pivot]?.[col] ?? 0)) pivot = row;
    }
    const pivotValue = aug[pivot]?.[col] ?? 0;
    const scale = Math.max(1, ...aug.map((row) => Math.max(...row.map(Math.abs))));
    if (Math.abs(pivotValue) < SINGULAR_TOL * scale) {
      throw new Error(`Free-network evidence: singular system (pivot ${col} ~ 0).`);
    }
    if (pivot !== col) {
      const tmp = aug[col] as number[];
      aug[col] = aug[pivot] as number[];
      aug[pivot] = tmp;
    }
    const divisor = aug[col]?.[col] ?? 1;
    for (let row = col + 1; row < n; row += 1) {
      const factor = (aug[row]?.[col] ?? 0) / divisor;
      if (factor === 0) continue;
      for (let j = col; j < n + nrhs; j += 1) aug[row]![j]! -= factor * (aug[col]?.[j] ?? 0);
    }
  }
  const X: number[][] = Array.from({ length: n }, () => new Array(nrhs).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = 0; j < nrhs; j += 1) {
      let sum = aug[i]?.[n + j] ?? 0;
      for (let k = i + 1; k < n; k += 1) sum -= (aug[i]?.[k] ?? 0) * (X[k]?.[j] ?? 0);
      X[i]![j] = sum / (aug[i]?.[i] ?? 1);
    }
  }
  return X;
};

export const invertDense = (M: number[][]): number[][] => {
  const n = M.length;
  const identity = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  );
  return solveDense(M, identity);
};

/** Rank via row-echelon pivot count (relative tolerance). */
export const rankOf = (A: number[][], tolRel = 1e-9): number => {
  const R = A.map((row) => [...row]);
  const rows = R.length;
  const cols = R[0]?.length ?? 0;
  const maxAbs = Math.max(0, ...R.flatMap((row) => row.map(Math.abs)));
  const tol = maxAbs * tolRel;
  let rank = 0;
  for (let col = 0; col < cols && rank < rows; col += 1) {
    let pivot = -1;
    for (let row = rank; row < rows; row += 1) {
      if (Math.abs(R[row]?.[col] ?? 0) > tol) {
        pivot = row;
        break;
      }
    }
    if (pivot < 0) continue;
    const tmp = R[rank] as number[];
    R[rank] = R[pivot] as number[];
    R[pivot] = tmp;
    const divisor = R[rank]?.[col] ?? 1;
    for (let row = rank + 1; row < rows; row += 1) {
      const factor = (R[row]?.[col] ?? 0) / divisor;
      if (factor === 0) continue;
      for (let j = col; j < cols; j += 1) R[row]![j]! -= factor * (R[rank]?.[j] ?? 0);
    }
    rank += 1;
  }
  return rank;
};

/** Nullspace basis of square M via echelon back-substitution (one vector per free column). */
export const nullspaceBasis = (M: number[][], tolRel = 1e-9): number[][] => {
  const n = M.length;
  const R = M.map((row) => [...row]);
  const maxAbs = Math.max(1e-300, ...R.flatMap((row) => row.map(Math.abs)));
  const tol = maxAbs * tolRel;
  const pivotCol = new Array(n).fill(-1);
  let rank = 0;
  for (let col = 0; col < n && rank < n; col += 1) {
    let pivot = -1;
    for (let row = rank; row < n; row += 1) {
      if (Math.abs(R[row]?.[col] ?? 0) > tol) {
        pivot = row;
        break;
      }
    }
    if (pivot < 0) continue;
    const tmp = R[rank] as number[];
    R[rank] = R[pivot] as number[];
    R[pivot] = tmp;
    for (let row = rank + 1; row < n; row += 1) {
      const factor = (R[row]?.[col] ?? 0) / (R[rank]?.[col] ?? 1);
      if (factor === 0) continue;
      for (let j = col; j < n; j += 1) R[row]![j]! -= factor * (R[rank]?.[j] ?? 0);
    }
    pivotCol[rank] = col;
    rank += 1;
  }
  const isPivot = new Set(pivotCol.slice(0, rank));
  const freeCols: number[] = [];
  for (let col = 0; col < n; col += 1) if (!isPivot.has(col)) freeCols.push(col);
  return freeCols.map((free) => {
    const x = new Array(n).fill(0);
    x[free] = 1;
    for (let r = rank - 1; r >= 0; r -= 1) {
      const col = pivotCol[r] as number;
      let sum = 0;
      for (let j = col + 1; j < n; j += 1) sum += (R[r]?.[j] ?? 0) * (x[j] ?? 0);
      x[col] = -sum / (R[r]?.[col] ?? 1);
    }
    return x;
  });
};

export interface DatumDefectReport {
  readonly rank: number;
  readonly defect: number;
  readonly expectedDefect: number;
  readonly basis: number[][];
}

/**
 * Datum-defect analysis: rank(A), defect = p - rank, nullspace basis.
 * Throws a DISTINCT extra-defect error (never a silent solve) when any
 * component's defect differs from 3 — isolated/unobserved stations,
 * disconnected free stations, or degenerate-only (zero-row) topology.
 */
export const analyzeDatumDefect = (assembly: FreeNetworkAssembly): DatumDefectReport => {
  const { stationIds, colOf, components, A, numParams } = assembly;
  const rank = rankOf(A);
  const defect = numParams - rank;
  // Stations with no baseline edge at all carry 3 silent zero-columns each.
  const edged = new Set(components.flat());
  const isolated = stationIds.filter((id) => !edged.has(id));
  // Per-edge-component expectation: 3*(s-1) rank over its own columns.
  let expectedRank = 0;
  components.forEach((component) => {
    const cols = component.flatMap((id) => colOf.get(id) ?? []);
    const sub = A.map((row) => cols.map((c) => row[c] ?? 0));
    expectedRank += rankOf(sub);
  });
  const expectedDefect = numParams - expectedRank;
  if (isolated.length > 0 || defect !== 3 * components.length || expectedDefect !== 3 * components.length) {
    throw new Error(
      `Free-network evidence: extra rank defect detected (rank=${rank}, defect=${defect}, ` +
        `components=${components.length}, isolated=[${isolated.join(', ')}]): ` +
        'network is not a connected free network with defect 3/component.',
    );
  }
  const basis = nullspaceBasis(multiply(transpose(A), A));
  if (basis.length !== defect) {
    throw new Error(
      `Free-network evidence: nullspace basis mismatch (basis=${basis.length}, defect=${defect}).`,
    );
  }
  return { rank, defect, expectedDefect: 3 * components.length, basis };
};

/** Max |N z| over translation modes: proves the analytic nullspace numerically. */
export const maxTranslationResidual = (N: number[][], modes: number[][]): number => {
  let worst = 0;
  modes.forEach((mode) => {
    const column = mode.map((value) => [value]);
    const product = multiply(N, column);
    product.forEach((row) => {
      worst = Math.max(worst, Math.abs(row[0] ?? 0));
    });
  });
  return worst;
};

/** Max projection of numeric null vectors off span(Z): proves translation-only modes. */
export const maxOffSpanResidual = (basis: number[][], zOrth: number[][]): number => {
  let worst = 0;
  basis.forEach((vec) => {
    const residual = [...vec];
    zOrth.forEach((z) => {
      const dot = vec.reduce((sum, value, i) => sum + value * (z[i] ?? 0), 0);
      for (let i = 0; i < residual.length; i += 1) residual[i]! -= dot * (z[i] ?? 0);
    });
    worst = Math.max(worst, Math.sqrt(residual.reduce((sum, value) => sum + value * value, 0)));
  });
  return worst;
};

export const maxAbsDiff = (A: number[][], B: number[][]): number => {
  let worst = 0;
  for (let i = 0; i < A.length; i += 1) {
    for (let j = 0; j < (A[0]?.length ?? 0); j += 1) {
      worst = Math.max(worst, Math.abs((A[i]?.[j] ?? 0) - (B[i]?.[j] ?? 0)));
    }
  }
  return worst;
};

export const maxAbs = (A: number[][]): number =>
  Math.max(0, ...A.flatMap((row) => row.map((value) => Math.abs(value))));
