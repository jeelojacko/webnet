/**
 * Phase 12I.0 Worker A — EVIDENCE ONLY free-network solvers (part 2).
 *
 * Three independent minimum-norm / inner-constraint routes over the same
 * assembled system; production-unreachable (no production imports this).
 * Shared statistics use the [-I +I] block structure (no global dense Qvv).
 */
import type { GnssBaselineObservation } from './gnssBaselineTypes';
import {
  invertGnssBaselineCovariance,
  gnssBaselineQuadraticForm,
} from './gnssBaselineCovariance';
import { gnssBaselineLabel } from './gnssBaselineEquationRows';
import { symmetricEigen3, symmetricRank3 } from './gnssBaselineStatistics';
import {
  centeringMatrix,
  componentTranslationModes,
  invertDense,
  maxAbs,
  multiply,
  orthonormalizeColumns,
  solveDense,
  transpose,
  type FreeNetworkAssembly,
} from './gnssFreeNetworkDatum';

export interface FreeNetworkSolution {
  readonly method: string;
  readonly dx: number[][];
  readonly Qxx: number[][];
  readonly residuals: number[][];
  readonly vTPv: number;
  readonly seuw: number;
  readonly dof: number;
  readonly qvvBlocks: number[][][];
  readonly redundancyTrace: number;
  readonly blockT: (number | undefined)[];
  /** Per-baseline descriptive v'Pv (production `quadraticForm` analogue). */
  readonly qObs: number[];
  /** Z'dx constraint sums: [sumDx, sumDy, sumDz] per component. */
  readonly constraintSums: number[][];
}

export interface FreeNetworkEvidenceInput {
  stations: { [id: string]: { x: number; y: number; h: number } };
  baselines: GnssBaselineObservation[];
}

/** Rank-based DOF: dof = nScalar - rank(A). */
export const rankBasedDof = (assembly: FreeNetworkAssembly, rank: number): number =>
  assembly.nScalar - rank;

/** Orthonormal per-component translation basis Z for an assembly. */
export const freeNetworkZ = (assembly: FreeNetworkAssembly): number[][] =>
  orthonormalizeColumns(componentTranslationModes(assembly));

/** Inner-constraint matrix G (n x 3c): unit entries select component-axis sums. */
export const innerConstraintMatrix = (assembly: FreeNetworkAssembly): number[][] => {
  const { numParams, components, colOf } = assembly;
  const d = 3 * components.length;
  const G: number[][] = Array.from({ length: numParams }, () => new Array(d).fill(0));
  components.forEach((component, c) => {
    component.forEach((id) => {
      const cols = colOf.get(id);
      if (!cols) return;
      for (let k = 0; k < 3; k += 1) G[cols[k] as number]![3 * c + k] = 1;
    });
  });
  return G;
};

/** Shared residual/statistics recovery from (A, P, dx, Qxx). */
export const recoverFreeStatistics = (
  assembly: FreeNetworkAssembly,
  method: string,
  dx: number[][],
  Qxx: number[][],
  baselines: GnssBaselineObservation[],
  dof: number,
  zOrth: number[][],
): FreeNetworkSolution => {
  const { A, P } = assembly;
  // Production-sign residuals: v = L - A dx equals the final-assembly
  // observed-minus-computed vector at the solved state (WebNet sign).
  const Adx = multiply(A, dx);
  const residuals = Adx.map((row, i) => [(assembly.L[i]?.[0] ?? 0) - (row[0] ?? 0)]);
  const Pv = multiply(P, residuals);
  let vTPv = 0;
  residuals.forEach((row, i) => {
    vTPv += (row[0] ?? 0) * (Pv[i]?.[0] ?? 0);
  });
  const seuw = dof > 0 ? Math.sqrt(Math.max(vTPv / dof, 0)) : 0;
  const ordered = [...baselines].sort((a, b) => a.id - b.id);
  const qvvBlocks: number[][][] = [];
  const blockT: (number | undefined)[] = [];
  const qObs: number[] = [];
  let redundancyTrace = 0;
  ordered.forEach((baseline, b) => {
    const label = gnssBaselineLabel(baseline);
    const [fx, fy, fz] = assembly.colOf.get(baseline.from) as [number, number, number];
    const [tx, ty, tz] = assembly.colOf.get(baseline.to) as [number, number, number];
    const fromCols = [fx, fy, fz];
    const toCols = [tx, ty, tz];
    // A_b Qxx A_b' through the [-I +I] structure (constant small-block work).
    const aqa: number[][] = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ];
    for (let r = 0; r < 3; r += 1) {
      for (let s = 0; s < 3; s += 1) {
        const rows: [number, number][] = [
          [fromCols[r] as number, -1],
          [toCols[r] as number, 1],
        ];
        const cols: [number, number][] = [
          [fromCols[s] as number, -1],
          [toCols[s] as number, 1],
        ];
        let sum = 0;
        rows.forEach(([p, sp]) => {
          cols.forEach(([q, sq]) => {
            sum += sp * (Qxx[p]?.[q] ?? 0) * sq;
          });
        });
        aqa[r]![s] = sum;
      }
    }
    const C = baseline.covariance;
    const cll = [
      [C.xx, C.xy, C.xz],
      [C.xy, C.yy, C.yz],
      [C.xz, C.yz, C.zz],
    ];
    const qvv = cll.map((row, r) => row.map((value, c) => value - (aqa[r]?.[c] ?? 0)));
    qvvBlocks.push(qvv);
    const weight = invertGnssBaselineCovariance(C, label);
    const wDense = [
      [weight[0][0], weight[0][1], weight[0][2]],
      [weight[1][0], weight[1][1], weight[1][2]],
      [weight[2][0], weight[2][1], weight[2][2]],
    ];
    const red = multiply(qvv, wDense);
    redundancyTrace += (red[0]?.[0] ?? 0) + (red[1]?.[1] ?? 0) + (red[2]?.[2] ?? 0);
    const v = [residuals[3 * b]?.[0] ?? 0, residuals[3 * b + 1]?.[0] ?? 0, residuals[3 * b + 2]?.[0] ?? 0];
    qObs.push(gnssBaselineQuadraticForm(weight, v[0] ?? 0, v[1] ?? 0, v[2] ?? 0));
    if (seuw === 0) {
      blockT.push(0);
      return;
    }
    const scale = seuw * seuw;
    const cvv = qvv.map((row) => row.map((value) => value * scale)) as [
      [number, number, number],
      [number, number, number],
      [number, number, number],
    ];
    const eigen = symmetricEigen3(cvv);
    const { rank } = symmetricRank3(eigen, `${label} (free evidence)`);
    if (rank === 0) {
      blockT.push(0);
      return;
    }
    let sum = 0;
    for (let j = 0; j < 3; j += 1) {
      const lambda = eigen.values[j] ?? 0;
      if (lambda <= 0) continue;
      const projection =
        (eigen.vectors[j]?.[0] ?? 0) * (v[0] ?? 0) +
        (eigen.vectors[j]?.[1] ?? 0) * (v[1] ?? 0) +
        (eigen.vectors[j]?.[2] ?? 0) * (v[2] ?? 0);
      sum += (projection * projection) / lambda;
    }
    blockT.push(sum);
  });
  // Z'dx per component-axis (inner-constraint sums, expect ~0).
  const constraintSums: number[][] = [];
  for (let c = 0; c < zOrth.length; c += 3) {
    const sums: number[] = [];
    for (let k = 0; k < 3; k += 1) {
      const z = zOrth[c + k] as number[];
      sums.push(dx.reduce((sum, row, i) => sum + (z[i] ?? 0) * (row[0] ?? 0), 0));
    }
    constraintSums.push(sums);
  }
  return {
    method, dx, Qxx, residuals, vTPv, seuw, dof,
    qvvBlocks, redundancyTrace, blockT, qObs, constraintSums,
  };
};

/** Method A: KKT inner constraints — solve [N G; G' 0][dx; l] = [u; 0]. */
export const solveFreeKKT = (
  assembly: FreeNetworkAssembly,
  baselines: GnssBaselineObservation[],
  rank: number,
): FreeNetworkSolution => {
  const { N, u, numParams } = assembly;
  const G = innerConstraintMatrix(assembly);
  const d = G[0]?.length ?? 0;
  const top = N.map((row, i) => [...row, ...(G[i] ?? [])]);
  const Gt = transpose(G);
  const bottom = Gt.map((row) => [...row, ...new Array(d).fill(0)]);
  const M = [...top, ...bottom];
  const rhs = [...u.map((row) => [...row]), ...Array.from({ length: d }, () => [0])];
  const solved = solveDense(M, rhs);
  const dx = solved.slice(0, numParams).map((row) => [row[0] ?? 0]);
  // Qxx_inner = top-left (n x n) block of inv(KKT).
  const inv = invertDense(M);
  const Qxx = inv.slice(0, numParams).map((row) => row.slice(0, numParams));
  const zOrth = freeNetworkZ(assembly);
  return recoverFreeStatistics(assembly, 'KKT-inner', dx, Qxx, baselines, rankBasedDof(assembly, rank), zOrth);
};

/**
 * Method B: generalized inverse — minimum-norm dx via nullspace projection.
 * Nreg = N + Z Z' is full rank; dx = Nreg^-1 u is the minimum-norm
 * solution (u lies in range(N)); N+ = Nreg^-1 - Z Z' is the pseudoinverse.
 */
export const solveFreeGinv = (
  assembly: FreeNetworkAssembly,
  baselines: GnssBaselineObservation[],
  rank: number,
): FreeNetworkSolution => {
  const { N, u, numParams } = assembly;
  const zOrth = freeNetworkZ(assembly);
  const ZZt: number[][] = Array.from({ length: numParams }, () => new Array(numParams).fill(0));
  zOrth.forEach((z) => {
    for (let i = 0; i < numParams; i += 1) {
      for (let j = 0; j < numParams; j += 1) ZZt[i]![j]! += (z[i] ?? 0) * (z[j] ?? 0);
    }
  });
  const Nreg = N.map((row, i) => row.map((value, j) => value + (ZZt[i]?.[j] ?? 0)));
  const dx = solveDense(Nreg, u.map((row) => [...row]));
  const NregInv = invertDense(Nreg);
  const Nplus = NregInv.map((row, i) => row.map((value, j) => value - (ZZt[i]?.[j] ?? 0)));
  return recoverFreeStatistics(assembly, 'GINV-minimum-norm', dx, Nplus, baselines, rankBasedDof(assembly, rank), zOrth);
};

/** Verify Penrose conditions + symmetry + Z'dx = 0 for a Method-B result.
 * Penrose/symmetry residuals are scale-relative (divided by maxAbs of the
 * reference matrix) so the 1e-9 gate is conditioning-honest. */
export const verifyPenrose = (
  N: number[][],
  Nplus: number[][],
  dx: number[][],
  zOrth: number[][],
): Record<string, number> => {
  const NNpN = multiply(multiply(N, Nplus), N);
  const NpNNp = multiply(multiply(Nplus, N), Nplus);
  const NNp = multiply(N, Nplus);
  const NpN = multiply(Nplus, N);
  const scaleN = Math.max(1e-300, maxAbs(N));
  const scaleNp = Math.max(1e-300, maxAbs(Nplus));
  const scaleNNp = Math.max(1e-300, maxAbs(NNp));
  const scaleNpN = Math.max(1e-300, maxAbs(NpN));
  const residuals: Record<string, number> = {
    penrose1: maxAbs(NNpN.map((row, i) => row.map((value, j) => value - (N[i]?.[j] ?? 0)))) / scaleN,
    penrose2: maxAbs(NpNNp.map((row, i) => row.map((value, j) => value - (Nplus[i]?.[j] ?? 0)))) / scaleNp,
    symmetry1: maxAbs(NNp.map((row, i) => row.map((value, j) => value - (NNp[j]?.[i] ?? 0)))) / scaleNNp,
    symmetry2: maxAbs(NpN.map((row, i) => row.map((value, j) => value - (NpN[j]?.[i] ?? 0)))) / scaleNpN,
    nullspace: 0,
  };
  let worst = 0;
  zOrth.forEach((z) => {
    worst = Math.max(worst, Math.abs(dx.reduce((sum, row, i) => sum + (z[i] ?? 0) * (row[0] ?? 0), 0)));
  });
  residuals.nullspace = worst;
  return residuals;
};

/**
 * Method C: gauge fix of anchor station(s) + centering S-transform.
 * One anchor per connected component (a single anchor leaves every other
 * component rank-deficient). Reduced full-rank solve on non-anchor columns
 * with the existing normal-equation pattern (N_r dx_r = u_r), zero-embed,
 * then dx_free = S dx_gauge and Qfree = S Qgauge S'.
 */
export const solveFreeGaugeS = (
  assembly: FreeNetworkAssembly,
  baselines: GnssBaselineObservation[],
  rank: number,
  anchorId: string | string[],
): FreeNetworkSolution => {
  const { A, P, L, numParams, colOf } = assembly;
  const anchors = Array.isArray(anchorId) ? anchorId : [anchorId];
  const anchorCols = anchors.map((anchor) => {
    const cols = colOf.get(anchor);
    if (!cols) throw new Error(`Free-network evidence: unknown anchor '${anchor}'.`);
    return cols;
  });
  const anchorLabel = anchors.join('+');
  const drop = new Set<number>(anchorCols.flatMap((cols) => [...cols]));
  const keep: number[] = [];
  for (let j = 0; j < numParams; j += 1) if (!drop.has(j)) keep.push(j);
  const Ar = A.map((row) => keep.map((j) => row[j] ?? 0));
  const Nr = multiply(transpose(Ar), multiply(P, Ar));
  const ur = multiply(transpose(Ar), multiply(P, L));
  const dxr = solveDense(Nr, ur);
  const Qr = invertDense(Nr);
  const dxGauge: number[][] = Array.from({ length: numParams }, () => [0]);
  keep.forEach((j, k) => {
    dxGauge[j]![0] = dxr[k]?.[0] ?? 0;
  });
  const Qgauge: number[][] = Array.from({ length: numParams }, () => new Array(numParams).fill(0));
  keep.forEach((j, a) => {
    keep.forEach((i, b) => {
      Qgauge[j]![i] = Qr[a]?.[b] ?? 0;
    });
  });
  const zOrth = freeNetworkZ(assembly);
  const S = centeringMatrix(zOrth, numParams);
  const dx = multiply(S, dxGauge);
  const Qfree = multiply(multiply(S, Qgauge), transpose(S));
  return recoverFreeStatistics(
    assembly, `gauge+S(anchor=${anchorLabel})`, dx, Qfree, baselines, rankBasedDof(assembly, rank), zOrth,
  );
};

/** Max entry-wise delta between two solutions' dx vectors. */
export const maxDxDelta = (a: number[][], b: number[][]): number =>
  Math.max(0, ...a.map((row, i) => Math.abs((row[0] ?? 0) - (b[i]?.[0] ?? 0))));

/** Max entry-wise delta between two square matrices. */
export const maxMatrixDelta = (A: number[][], B: number[][]): number =>
  Math.max(0, ...A.flatMap((row, i) => row.map((value, j) => Math.abs(value - (B[i]?.[j] ?? 0)))));

/** Apply a uniform ECEF translation to a station map (apriori-invariance probe). */
export const translateStations = (
  stations: { [id: string]: { x: number; y: number; h: number } },
  offset: [number, number, number],
): { [id: string]: { x: number; y: number; h: number } } =>
  Object.fromEntries(
    Object.entries(stations).map(([id, station]) => [
      id,
      { ...station, x: station.x + offset[0], y: station.y + offset[1], h: station.h + offset[2] },
    ]),
  );

/** Add a dx vector to a-priori coords to form adjusted coordinates. */
export const applyCorrections = (
  stations: { [id: string]: { x: number; y: number; h: number } },
  stationIds: string[],
  dx: number[][],
): { [id: string]: { x: number; y: number; h: number } } => {
  const out: { [id: string]: { x: number; y: number; h: number } } = {};
  stationIds.forEach((id, s) => {
    const station = stations[id];
    if (!station) throw new Error(`Free-network evidence: missing station '${id}'.`);
    out[id] = {
      ...station,
      x: station.x + (dx[3 * s]?.[0] ?? 0),
      y: station.y + (dx[3 * s + 1]?.[0] ?? 0),
      h: station.h + (dx[3 * s + 2]?.[0] ?? 0),
    };
  });
  return out;
};
