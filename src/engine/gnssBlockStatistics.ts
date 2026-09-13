import type { SolveParameterIndex } from './adjustmentSolveTypes';
import type { GnssBaselineObservation } from './gnssBaselineTypes';
import type { GnssBaselineAdjustedResidual } from './gnssBaselineAdjust';
import {
  gnssCovarianceToDense,
  invertGnssBaselineCovariance,
} from './gnssBaselineCovariance';
import { gnssBaselineLabel } from './gnssBaselineEquationRows';
import {
  GNSS_RANK_TOL_REL,
  symmetricEigen3,
  symmetricRank3,
  type GnssBaselineStatistics,
  type GnssStatisticStatus,
} from './gnssBaselineStatistics';
import { readGnssBlock, type GnssSelectedBlockStore } from './gnssSelectedBlockQuery';

/**
 * Phase 12F.2 — block-store Phase 12D reconstruction (EVIDENCE ONLY).
 *
 * Same stochastic contract and IDENTICAL per-baseline formulas as
 * recoverGnssBaselineStatistics: Qvv = Qll - A_i Qxx A_i^T through the
 * [-I +I] row structure, then R = Qvv P, Cvv = seuw^2 Qvv, eigen block T.
 * The ONLY swap is the Qxx source: entries come from the batched block
 * store (Q_AA/Q_BB diagonal + Q_AB off-diagonal with transpose accessor)
 * instead of a dense qxx number[][] mirror. No dense Qxx is formed here.
 *
 * Fail-closed, never silent full-Qxx fallback: a baseline touching a
 * block the plan did not query throws (readGnssBlock's "was not queried").
 */

export interface BlockStatisticsInput {
  readonly baselines: GnssBaselineObservation[];
  readonly residuals: GnssBaselineAdjustedResidual[];
  readonly paramIndex: SolveParameterIndex;
  readonly stationIds: readonly string[];
  readonly store: GnssSelectedBlockStore;
  readonly seuw: number;
}

export const recoverGnssBaselineStatisticsFromBlocks = (
  input: BlockStatisticsInput,
): GnssBaselineStatistics[] => {
  const { baselines, residuals, paramIndex, stationIds, store, seuw } = input;
  if (!(seuw >= 0) || !Number.isFinite(seuw)) {
    throw new Error('GNSS block statistics requires a finite non-negative SEUW.');
  }
  const ordinal = new Map(stationIds.map((id, index) => [id, index] as const));
  const residualById = new Map(residuals.map((residual) => [residual.baselineId, residual]));
  return baselines.map((baseline) => {
    const label = gnssBaselineLabel(baseline);
    const residual = residualById.get(baseline.id);
    if (!residual) throw new Error(`GNSS statistics for ${label}: residual missing.`);
    const fromOrd = ordinal.get(baseline.from);
    const toOrd = ordinal.get(baseline.to);
    if (fromOrd === undefined && toOrd === undefined) {
      throw new Error(`GNSS statistics for ${label}: neither endpoint is in the block plan.`);
    }
    const rowCols: (number | undefined)[][] = [0, 1, 2].map((component) => {
      const keys = ['x', 'y', 'h'] as const;
      return [
        paramIndex[baseline.from]?.[keys[component]],
        paramIndex[baseline.to]?.[keys[component]],
      ];
    });
    const aqxxat: number[][] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
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
            sum += sp * qxxEntry(store, paramIndex, stationIds, p, qq) * sq;
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
    const roundoffFloor = Math.max(cll[0]?.[0] ?? 0, cll[1]?.[1] ?? 0, cll[2]?.[2] ?? 0) * 1e-9;
    if (qvv.xx < -roundoffFloor || qvv.yy < -roundoffFloor || qvv.zz < -roundoffFloor) {
      throw new Error(`GNSS statistics for ${label}: negative Qvv diagonal beyond roundoff.`);
    }
    const weight = invertGnssBaselineCovariance(baseline.covariance, label);
    const redundancyDense = qvvDense.map((row) => [0, 1, 2].map(
      (c) => (row[0] ?? 0) * (weight[0]?.[c] ?? 0) + (row[1] ?? 0) * (weight[1]?.[c] ?? 0) + (row[2] ?? 0) * (weight[2]?.[c] ?? 0),
    ));
    const rx = redundancyDense[0]?.[0] ?? 0;
    const ry = redundancyDense[1]?.[1] ?? 0;
    const rz = redundancyDense[2]?.[2] ?? 0;
    const scale = seuw * seuw;
    const cvv = { xx: qvv.xx * scale, xy: qvv.xy * scale, xz: qvv.xz * scale, yy: qvv.yy * scale, yz: qvv.yz * scale, zz: qvv.zz * scale };
    const v = [residual.vX, residual.vY, residual.vZ];
    if (seuw === 0) {
      return {
        baselineId: baseline.id, from: baseline.from, to: baseline.to, qvv, cvv,
        residualSigma: {}, residualCorrelation: {}, standardized: {},
        redundancy: { x: rx, y: ry, z: rz, trace: rx + ry + rz },
        qObs: residual.quadraticForm, distributionKind: 'diagnostic-only', status: 'no-scale',
      };
    }
    const sigma = {
      x: cvv.xx > 0 ? Math.sqrt(cvv.xx) : undefined,
      y: cvv.yy > 0 ? Math.sqrt(cvv.yy) : undefined,
      z: cvv.zz > 0 ? Math.sqrt(cvv.zz) : undefined,
    };
    const correlation = {
      xy: sigma.x != null && sigma.y != null && sigma.x > 0 && sigma.y > 0 ? cvv.xy / (sigma.x * sigma.y) : undefined,
      xz: sigma.x != null && sigma.z != null && sigma.x > 0 && sigma.z > 0 ? cvv.xz / (sigma.x * sigma.z) : undefined,
      yz: sigma.y != null && sigma.z != null && sigma.y > 0 && sigma.z > 0 ? cvv.yz / (sigma.y * sigma.z) : undefined,
    };
    const standardized = {
      x: sigma.x != null && sigma.x > 0 ? v[0]! / sigma.x : undefined,
      y: sigma.y != null && sigma.y > 0 ? v[1]! / sigma.y : undefined,
      z: sigma.z != null && sigma.z > 0 ? v[2]! / sigma.z : undefined,
    };
    const eigen = symmetricEigen3(blockToDense(cvv));
    const { rank } = symmetricRank3(eigen, label);
    void GNSS_RANK_TOL_REL;
    let blockT: number | undefined;
    let status: GnssStatisticStatus = rank < 3 ? 'limited' : 'ok';
    if (rank === 0) {
      const magnitude = Math.sqrt(v[0]! ** 2 + v[1]! ** 2 + v[2]! ** 2);
      if (magnitude > 1e-9) {
        throw new Error(`GNSS statistics for ${label}: non-zero residual with zero residual freedom.`);
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
      baselineId: baseline.id, from: baseline.from, to: baseline.to, qvv, cvv,
      residualSigma: sigma, residualCorrelation: correlation, standardized,
      redundancy: { x: rx, y: ry, z: rz, trace: rx + ry + rz },
      qObs: residual.quadraticForm, blockT, blockRank: rank,
      distributionKind: 'diagnostic-only', status,
    };
  });
};

/** Route one absolute (row, col) Qxx lookup through its station block. */
const qxxEntry = (
  store: GnssSelectedBlockStore,
  paramIndex: SolveParameterIndex,
  stationIds: readonly string[],
  row: number,
  col: number,
): number => {
  const rowOrd = owningOrdinal(paramIndex, stationIds, row);
  const colOrd = owningOrdinal(paramIndex, stationIds, col);
  if (rowOrd === undefined || colOrd === undefined) {
    throw new Error(`GNSS block statistics: parameter ${row},${col} is outside the block plan.`);
  }
  const buf = new Float64Array(9);
  readGnssBlock(store, rowOrd, colOrd, buf);
  const rowBase = paramIndex[stationIds[rowOrd]!]!['x']! as number;
  const colBase = paramIndex[stationIds[colOrd]!]!['x']! as number;
  return buf[(row - rowBase) * 3 + (col - colBase)] ?? Number.NaN;
};

const owningOrdinal = (
  paramIndex: SolveParameterIndex,
  stationIds: readonly string[],
  param: number,
): number | undefined => {
  for (let ord = 0; ord < stationIds.length; ord += 1) {
    const base = paramIndex[stationIds[ord]!]!['x']! as number;
    if (param >= base && param < base + 3) return ord;
  }
  return undefined;
};

const denseToBlock = (m: number[][]) => ({
  xx: m[0]?.[0] ?? 0,
  xy: ((m[0]?.[1] ?? 0) + (m[1]?.[0] ?? 0)) / 2,
  xz: ((m[0]?.[2] ?? 0) + (m[2]?.[0] ?? 0)) / 2,
  yy: m[1]?.[1] ?? 0,
  yz: ((m[1]?.[2] ?? 0) + (m[2]?.[1] ?? 0)) / 2,
  zz: m[2]?.[2] ?? 0,
});

const blockToDense = (block: { xx: number; xy: number; xz: number; yy: number; yz: number; zz: number }) =>
  [
    [block.xx, block.xy, block.xz],
    [block.xy, block.yy, block.yz],
    [block.xz, block.yz, block.zz],
  ] as [[number, number, number], [number, number, number], [number, number, number]];
