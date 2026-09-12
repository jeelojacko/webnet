/**
 * Phase 12D — per-baseline residual statistics for static GNSS adjustments.
 *
 * Stochastic contract (12A section 10, WebNet scalar practice):
 * - the imported 3x3 IS the a-priori covariance C_ll, numerically equal to
 *   the cofactor Q_ll (a-priori variance factor sigma0^2 = 1);
 * - P_i = Q_ll,i^-1; Qxx = (A^T P A)^-1 in that same a-priori scale;
 * - posterior scale seuw^2 = v^T P v / dof is estimated from the residuals
 *   and NEVER fed back into the weights (no double scaling);
 * - Qvv_i = Q_ll,i - A_i Qxx A_i^T (cofactor), Cvv_i = seuw^2 Qvv_i.
 *
 * Consequence: the block statistic T_i = v^T Cvv_i^+ v is a normalized
 * diagnostic WITHOUT a p-value (its scale is estimated in-adjustment, so
 * neither chi-square nor F applies exactly). Component t_j = v_j/sqrt(Cvv)
 * are correlated diagnostics, not independent tests. Block MDB deferred.
 *
 * TS-dense path only. No global dense Qvv is ever formed: each 3x3 block
 * costs a constant number of Qxx lookups through the [-I +I] row structure.
 */
import type { SolveParameterIndex } from './adjustmentSolveTypes';
import type { GnssBaselineObservation } from './gnssBaselineTypes';
import {
  gnssCovarianceToDense,
  invertGnssBaselineCovariance,
} from './gnssBaselineCovariance';
import { gnssBaselineLabel } from './gnssBaselineEquationRows';
import type { GnssBaselineAdjustedResidual } from './gnssBaselineAdjust';

export interface GnssQvvBlock {
  xx: number;
  xy: number;
  xz: number;
  yy: number;
  yz: number;
  zz: number;
}

export type GnssBlockDistributionKind = 'diagnostic-only';

export type GnssStatisticStatus = 'ok' | 'limited' | 'no-freedom' | 'no-scale';

export interface GnssBaselineStatistics {
  readonly baselineId: number;
  readonly from: string;
  readonly to: string;
  /** Residual cofactor block Qvv = Qll - A Qxx A^T (a-priori scale). */
  readonly qvv: GnssQvvBlock;
  /** Estimated residual covariance Cvv = seuw^2 Qvv. */
  readonly cvv: GnssQvvBlock;
  readonly residualSigma: { x?: number; y?: number; z?: number };
  readonly residualCorrelation: { xy?: number; xz?: number; yz?: number };
  /** Component diagnostics t = v/sqrt(Cvv); correlated, not independent. */
  readonly standardized: { x?: number; y?: number; z?: number };
  readonly redundancy: { x: number; y: number; z: number; trace: number };
  /** Descriptive v^T P v (NOT the Cvv-based test). */
  readonly qObs: number;
  /** Normalized block diagnostic v^T Cvv^+ v; no p-value (scale estimated). */
  readonly blockT?: number;
  readonly blockRank?: number;
  readonly distributionKind: GnssBlockDistributionKind;
  readonly status: GnssStatisticStatus;
}

/** Scale-aware rank threshold: 3*sqrt(eps) relative to lambda_max. */
export const GNSS_RANK_TOL_REL = 3 * Math.sqrt(Number.EPSILON);

interface Eigen3 {
  values: [number, number, number];
  /** Columns are unit eigenvectors. */
  vectors: [[number, number, number], [number, number, number], [number, number, number]];
}

/** Cyclic Jacobi eigensolver for symmetric 3x3 (deterministic, ~15 lines). */
export const symmetricEigen3 = (matrix: [
  [number, number, number],
  [number, number, number],
  [number, number, number],
]): Eigen3 => {
  const a: number[][] = [
    [matrix[0][0], matrix[0][1], matrix[0][2]],
    [matrix[1][0], matrix[1][1], matrix[1][2]],
    [matrix[2][0], matrix[2][1], matrix[2][2]],
  ];
  const v: number[][] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 20; sweep += 1) {
    let off = 0;
    for (let p = 0; p < 3; p += 1) {
      for (let q = p + 1; q < 3; q += 1) off += (a[p]?.[q] ?? 0) ** 2;
    }
    if (off < 1e-300) break;
    for (let p = 0; p < 3; p += 1) {
      for (let q = p + 1; q < 3; q += 1) {
        const apq = a[p]?.[q] ?? 0;
        if (Math.abs(apq) < 1e-300) continue;
        const app = a[p]?.[p] ?? 0;
        const aqq = a[q]?.[q] ?? 0;
        const theta = (aqq - app) / (2 * apq);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < 3; k += 1) {
          const akp = a[k]?.[p] ?? 0;
          const akq = a[k]?.[q] ?? 0;
          a[k]![p] = c * akp - s * akq;
          a[k]![q] = s * akp + c * akq;
        }
        for (let k = 0; k < 3; k += 1) {
          const apk = a[p]?.[k] ?? 0;
          const aqk = a[q]?.[k] ?? 0;
          a[p]![k] = c * apk - s * aqk;
          a[q]![k] = s * apk + c * aqk;
        }
        for (let k = 0; k < 3; k += 1) {
          const vkp = v[k]?.[p] ?? 0;
          const vkq = v[k]?.[q] ?? 0;
          v[k]![p] = c * vkp - s * vkq;
          v[k]![q] = s * vkp + c * vkq;
        }
      }
    }
  }
  return {
    values: [a[0]?.[0] ?? 0, a[1]?.[1] ?? 0, a[2]?.[2] ?? 0],
    vectors: [
      [v[0]?.[0] ?? 0, v[1]?.[0] ?? 0, v[2]?.[0] ?? 0],
      [v[0]?.[1] ?? 0, v[1]?.[1] ?? 0, v[2]?.[1] ?? 0],
      [v[0]?.[2] ?? 0, v[1]?.[2] ?? 0, v[2]?.[2] ?? 0],
    ],
  };
};

/**
 * Deterministic numerical rank of a symmetric 3x3 with eigenpairs.
 * Threshold tau = lambda_max * GNSS_RANK_TOL_REL. A materially negative
 * smallest eigenvalue (below -tau) is a hard PSD failure, never clipped.
 */
export const symmetricRank3 = (
  eigen: Eigen3,
  label: string,
): { rank: number; threshold: number } => {
  const values = [...eigen.values];
  for (const value of values) {
    if (!Number.isFinite(value)) {
      throw new Error(`GNSS statistics for ${label}: non-finite Qvv eigenvalue.`);
    }
  }
  const lambdaMax = Math.max(...values);
  if (!(lambdaMax > 0)) {
    return { rank: 0, threshold: 0 };
  }
  const threshold = lambdaMax * GNSS_RANK_TOL_REL;
  const lambdaMin = Math.min(...values);
  if (lambdaMin < -threshold) {
    throw new Error(
      `GNSS statistics for ${label}: Qvv block is materially non-PSD ` +
        `(lambda_min=${lambdaMin}, tau=${threshold}).`,
    );
  }
  return { rank: values.filter((value) => value > threshold).length, threshold };
};

const denseToBlock = (m: number[][]): GnssQvvBlock => ({
  xx: m[0]?.[0] ?? 0,
  xy: ((m[0]?.[1] ?? 0) + (m[1]?.[0] ?? 0)) / 2,
  xz: ((m[0]?.[2] ?? 0) + (m[2]?.[0] ?? 0)) / 2,
  yy: m[1]?.[1] ?? 0,
  yz: ((m[1]?.[2] ?? 0) + (m[2]?.[1] ?? 0)) / 2,
  zz: m[2]?.[2] ?? 0,
});

const blockToDense = (block: GnssQvvBlock): [[number, number, number], [number, number, number], [number, number, number]] => [
  [block.xx, block.xy, block.xz],
  [block.xy, block.yy, block.yz],
  [block.xz, block.yz, block.zz],
];

export interface RecoverQvvInput {
  baselines: GnssBaselineObservation[];
  residuals: GnssBaselineAdjustedResidual[];
  paramIndex: SolveParameterIndex;
  qxx: number[][];
  seuw: number;
}

/**
 * Recover every baseline's 3x3 Qvv/Cvv block plus redundancy and block
 * diagnostics. O(B) small-block work; no global dense Qvv is formed.
 */
export const recoverGnssBaselineStatistics = (
  input: RecoverQvvInput,
): GnssBaselineStatistics[] => {
  const { baselines, residuals, paramIndex, qxx, seuw } = input;
  if (!(seuw >= 0) || !Number.isFinite(seuw)) {
    throw new Error('GNSS statistics requires a finite non-negative SEUW.');
  }
  const residualById = new Map(residuals.map((residual) => [residual.baselineId, residual]));
  return baselines.map((baseline) => {
    const label = gnssBaselineLabel(baseline);
    const residual = residualById.get(baseline.id);
    if (!residual) {
      throw new Error(`GNSS statistics for ${label}: residual missing.`);
    }
    // A_i rows through the [-I +I] structure: at most 2 nonzeros each.
    const rowCols: (number | undefined)[][] = [0, 1, 2].map((component) => {
      const keys = ['x', 'y', 'h'] as const;
      const fromCol = paramIndex[baseline.from]?.[keys[component]];
      const toCol = paramIndex[baseline.to]?.[keys[component]];
      return [fromCol, toCol];
    });
    const aqxxat: number[][] = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ];
    for (let r = 0; r < 3; r += 1) {
      for (let s = 0; s < 3; s += 1) {
        let sum = 0;
        const rowEntries: [number | undefined, number][] = [
          [rowCols[r]?.[0], -1],
          [rowCols[r]?.[1], 1],
        ];
        const colEntries: [number | undefined, number][] = [
          [rowCols[s]?.[0], -1],
          [rowCols[s]?.[1], 1],
        ];
        rowEntries.forEach(([p, sp]) => {
          if (p == null) return;
          colEntries.forEach(([qq, sq]) => {
            if (qq == null) return;
            sum += sp * (qxx[p]?.[qq] ?? 0) * sq;
          });
        });
        aqxxat[r]![s] = sum;
      }
    }
    const cll = gnssCovarianceToDense(baseline.covariance);
    const qvvDense = cll.map((row, r) => row.map((value, c) => value - (aqxxat[r]?.[c] ?? 0)));
    const qvv = denseToBlock(qvvDense);
    for (const value of [qvv.xx, qvv.xy, qvv.xz, qvv.yy, qvv.yz, qvv.zz]) {
      if (!Number.isFinite(value)) {
        throw new Error(`GNSS statistics for ${label}: non-finite Qvv block.`);
      }
    }
    // Scale-aware roundoff floor: negatives within 1e-9 of the largest
    // input variance are Qxx-chain roundoff on ~zero-redundancy blocks.
    const roundoffFloor = Math.max(cll[0]?.[0] ?? 0, cll[1]?.[1] ?? 0, cll[2]?.[2] ?? 0) * 1e-9;
    if (qvv.xx < -roundoffFloor || qvv.yy < -roundoffFloor || qvv.zz < -roundoffFloor) {
      throw new Error(`GNSS statistics for ${label}: negative Qvv diagonal beyond roundoff.`);
    }
    // Redundancy block R = Qvv P (cofactor scale; seuw cancels).
    const weight = invertGnssBaselineCovariance(baseline.covariance, label);
    const redundancyDense = qvvDense.map((row) => [0, 1, 2].map(
      (c) => (row[0] ?? 0) * (weight[0]?.[c] ?? 0) + (row[1] ?? 0) * (weight[1]?.[c] ?? 0) + (row[2] ?? 0) * (weight[2]?.[c] ?? 0),
    ));
    const rx = redundancyDense[0]?.[0] ?? 0;
    const ry = redundancyDense[1]?.[1] ?? 0;
    const rz = redundancyDense[2]?.[2] ?? 0;
    // Estimated residual covariance Cvv = seuw^2 Qvv.
    const scale = seuw * seuw;
    const cvv: GnssQvvBlock = {
      xx: qvv.xx * scale,
      xy: qvv.xy * scale,
      xz: qvv.xz * scale,
      yy: qvv.yy * scale,
      yz: qvv.yz * scale,
      zz: qvv.zz * scale,
    };
    const v = [residual.vX, residual.vY, residual.vZ];
    if (seuw === 0) {
      // Zero DOF: no estimated scale; Qvv/redundancy remain valid.
      return {
        baselineId: baseline.id,
        from: baseline.from,
        to: baseline.to,
        qvv,
        cvv,
        residualSigma: {},
        residualCorrelation: {},
        standardized: {},
        redundancy: { x: rx, y: ry, z: rz, trace: rx + ry + rz },
        qObs: residual.quadraticForm,
        distributionKind: 'diagnostic-only',
        status: 'no-scale',
      };
    }
    const sigma = {
      x: cvv.xx > 0 ? Math.sqrt(cvv.xx) : undefined,
      y: cvv.yy > 0 ? Math.sqrt(cvv.yy) : undefined,
      z: cvv.zz > 0 ? Math.sqrt(cvv.zz) : undefined,
    };
    const correlation = {
      xy: sigma.x != null && sigma.y != null && sigma.x > 0 && sigma.y > 0
        ? cvv.xy / (sigma.x * sigma.y) : undefined,
      xz: sigma.x != null && sigma.z != null && sigma.x > 0 && sigma.z > 0
        ? cvv.xz / (sigma.x * sigma.z) : undefined,
      yz: sigma.y != null && sigma.z != null && sigma.y > 0 && sigma.z > 0
        ? cvv.yz / (sigma.y * sigma.z) : undefined,
    };
    const standardized = {
      x: sigma.x != null && sigma.x > 0 ? v[0]! / sigma.x : undefined,
      y: sigma.y != null && sigma.y > 0 ? v[1]! / sigma.y : undefined,
      z: sigma.z != null && sigma.z > 0 ? v[2]! / sigma.z : undefined,
    };
    // Block diagnostic T = v^T Cvv^+ v via the Cvv eigenbasis.
    const eigen = symmetricEigen3(blockToDense(cvv));
    const { rank } = symmetricRank3(eigen, label);
    let blockT: number | undefined;
    let status: GnssStatisticStatus = rank < 3 ? 'limited' : 'ok';
    if (rank === 0) {
      const magnitude = Math.sqrt(v[0]! ** 2 + v[1]! ** 2 + v[2]! ** 2);
      if (magnitude > 1e-9) {
        throw new Error(
          `GNSS statistics for ${label}: non-zero residual with zero residual freedom.`,
        );
      }
      blockT = 0;
      status = 'no-freedom';
    } else {
      let sum = 0;
      for (let j = 0; j < 3; j += 1) {
        const lambda = eigen.values[j] ?? 0;
        if (lambda <= 0) continue;
        const projection =
          (eigen.vectors[j]?.[0] ?? 0) * v[0]! +
          (eigen.vectors[j]?.[1] ?? 0) * v[1]! +
          (eigen.vectors[j]?.[2] ?? 0) * v[2]!;
        sum += (projection * projection) / lambda;
      }
      blockT = sum;
    }
    return {
      baselineId: baseline.id,
      from: baseline.from,
      to: baseline.to,
      qvv,
      cvv,
      residualSigma: sigma,
      residualCorrelation: correlation,
      standardized,
      redundancy: { x: rx, y: ry, z: rz, trace: rx + ry + rz },
      qObs: residual.quadraticForm,
      blockT,
      blockRank: rank,
      distributionKind: 'diagnostic-only',
      status,
    };
  });
};

/** Whole-block suspect ranking (descending blockT); the blunder unit is one baseline. */
export const rankGnssBaselineSuspects = (
  statistics: GnssBaselineStatistics[],
): GnssBaselineStatistics[] =>
  [...statistics]
    .filter((entry) => entry.blockT != null)
    .sort((a, b) => (b.blockT ?? 0) - (a.blockT ?? 0));

export { blockToDense as gnssBlockToDense };
