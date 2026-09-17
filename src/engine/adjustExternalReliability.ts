/**
 * Phase 14B Worker 2: analytical external reliability (coordinate influence
 * of a marginally-detectable blunder).
 *
 * First-order / local-linear theory (Baarda/Teunissen): a blunder of size
 * nabla0 in scalar equation i shifts the estimate by
 *
 *   dx_hat = +Qxx . A' . P . e_i . nabla0
 *
 * with the POSITIVE sign verified empirically against brute-force
 * perturb-by-MDB re-solves (see tests/reliabilityExternal.test.ts).
 * With B[l] = a_l . Qxx and Qxx symmetric this is a P-column-weighted sum
 * of B rows: dx_hat = sum_l B[l] . P[l][i] . nabla0, restricted to the
 * rows coupled to i through the true weight matrix (TS-correlation groups,
 * GPS covariance blocks, CTRLXY pairs). Diagonal-only evaluation is never
 * used silently: correlated equations always use the true P column.
 *
 * Pure module: no engine imports. All inputs are plain data so the results
 * stay JSON-serializable for the worker protocol and result objects.
 */

import type { StationId } from '../typesBase';
import { recordCoupledIteration } from './structuredWeightTelemetry';

export type ExternalInfluenceMethod = 'first-order-linear';

export type ExternalMdbModel = 'statistical' | 'legacy-3.29';

/** Signed +MDB coordinate response at one station, in millimetres. */
export interface ExternalStationShift {
  stationId: StationId;
  dE: number;
  dN: number;
  /** Present on 3D runs only. */
  dH?: number;
}

export interface ExternalInfluenceAvailable {
  available: true;
  method: ExternalInfluenceMethod;
  /** True under Huber reweighting: frozen-final-weights approximation. */
  approximate: boolean;
  approximateReason?: string;
  /** MDB propagated, in native observation units. */
  mdbUsed: number;
  mdbModel: ExternalMdbModel;
  /** Max over station-coordinate unknowns of |shift|. */
  maxComponentMm: number;
  /** Max over stations of sqrt(dE^2+dN^2). */
  maxHorizontalMm: number;
  /** Station carrying maxHorizontalMm (3D: max3dMm). */
  affectedStation?: StationId;
  dEmm?: number;
  dNmm?: number;
  /** Present on 3D runs only. */
  dHmm?: number;
  /** Max over stations of |dH|; 3D only. */
  maxVerticalMm?: number;
  /** Max over stations of sqrt(dE^2+dN^2+dH^2); 3D only. */
  max3dMm?: number;
  /** horizontal (2D) or 3D magnitude at the affected station. */
  primaryMm: number;
  primaryKind: 'horizontal' | '3d';
  /** Sparse: stations with parameter columns (fixed stations are exactly 0). */
  vectorMm: ExternalStationShift[];
}

export interface ExternalInfluenceUnavailable {
  available: false;
  reason: string;
}

export type ExternalInfluence = ExternalInfluenceAvailable | ExternalInfluenceUnavailable;

/** Fail-closed reasons (never a silent diagonal approximation). */
export const EXTERNAL_REASON_FREE_NETWORK = 'free-network-datum';
export const EXTERNAL_REASON_UNTESTABLE = 'untestable-no-mdb';
export const EXTERNAL_REASON_SPARSE_ROUTE = 'sparse-route-unavailable';
export const EXTERNAL_REASON_NO_COVARIANCE = 'no-covariance';
export const EXTERNAL_REASON_PREANALYSIS = 'preanalysis-per-obs-unavailable';
export const EXTERNAL_REASON_ROBUST = 'robust-frozen-weights';

export interface ExternalParamColumn {
  stationId: StationId;
  e: number;
  n: number;
  h?: number;
}

export interface ExternalRowInput {
  row: number;
  mdbNative: number;
  mdbModel: ExternalMdbModel;
  /** Rows sharing P coupling with this row (always includes the row itself). */
  groupRows: number[];
}

export interface ComputeExternalInfluencesArgs {
  is2D: boolean;
  /** Dense B rows (a_l . Qxx); empty on the sparse row-product route. */
  B: number[][];
  /** Dense true weight matrix (with TS/GPS/CTRLXY coupling); may be undefined. */
  P?: number[][];
  /**
   * Phase 16C structured read for P[row][column]; when present it takes
   * precedence over P so statistics needs no dense weight matrix.
   */
  weightAt?: (_row: number, _column: number) => number;
  equationCount: number;
  paramColumns: ExternalParamColumn[];
  rows: ExternalRowInput[];
  freeNetwork: boolean;
  robustApproximate: boolean;
}

const unavailable = (reason: string): ExternalInfluenceUnavailable => ({
  available: false,
  reason,
});

/**
 * Free-network datum gate: no fixed/weighted coordinate components and no
 * constraint rows means the datum is observation-defined, so a blunder
 * influence is datum-dependent. Any anchored component keeps external
 * reliability available.
 */
export const isFreeNetworkDatum = ({
  stations,
  constraintCount,
}: {
  stations: Record<string, { fixedX?: boolean; fixedY?: boolean; fixedH?: boolean }>;
  constraintCount: number;
}): boolean => {
  if (constraintCount > 0) return false;
  return !Object.values(stations).some(
    (station) => station.fixedX === true || station.fixedY === true || station.fixedH === true,
  );
};

const shiftForRow = (
  is2D: boolean,
  B: number[][],
  P: number[][],
  weightAt: ((_row: number, _column: number) => number) | undefined,
  groupRows: number[],
  row: number,
  mdb: number,
  paramColumns: ExternalParamColumn[],
): ExternalStationShift[] => {
  const delta = new Array<number>(B[0]?.length ?? 0).fill(0);
  let coupledVisited = 0;
  for (const coupled of groupRows) {
    const weight = weightAt ? weightAt(coupled, row) : (P[coupled]?.[row] ?? 0);
    if (!Number.isFinite(weight) || weight === 0 || B[coupled] == null) continue;
    coupledVisited += 1;
    const brow = B[coupled] as number[];
    for (let k = 0; k < delta.length; k += 1) delta[k] += brow[k] * weight * mdb;
  }
  const shifts = paramColumns.map((col) => {
    const shift: ExternalStationShift = {
      stationId: col.stationId,
      dE: (delta[col.e] ?? 0) * 1000,
      dN: (delta[col.n] ?? 0) * 1000,
    };
    if (!is2D && col.h != null) shift.dH = (delta[col.h] ?? 0) * 1000;
    return shift;
  });
  recordCoupledIteration(coupledVisited);
  return shifts;
}

/**
 * Argmax stability for worst-station selection: symmetric geometries
 * (e.g. leveling between adjacent benchmarks) produce exact-magnitude
 * ties with opposite signs, and native-vs-TS Qxx noise flips strict->
 * winners in the last ulp — relabeling the affected station and the
 * reported shift sign. Keep the incumbent (earlier station) unless the
 * challenger leads beyond solver-noise scale (1e-9 relative, 1e-18 mm
 * floor); reported magnitudes are unaffected at display/parity resolution.
 */
const isDecisiveLead = (candidate: number, incumbent: number): boolean =>
  candidate > incumbent * (1 + 1e-9) && candidate > incumbent + 1e-18;

const summarizeShifts = (
  is2D: boolean,
  shifts: ExternalStationShift[],
  mdb: number,
  mdbModel: ExternalMdbModel,
  robustApproximate: boolean,
): ExternalInfluenceAvailable => {
  let maxComponentMm = 0;
  let maxHorizontalMm = 0;
  let affectedStation: StationId | undefined;
  let affected: ExternalStationShift | undefined;
  let maxVerticalMm: number | undefined;
  let max3dMm: number | undefined;
  for (const shift of shifts) {
    maxComponentMm = Math.max(maxComponentMm, Math.abs(shift.dE), Math.abs(shift.dN));
    if (shift.dH != null) maxComponentMm = Math.max(maxComponentMm, Math.abs(shift.dH));
    const horizontal = Math.sqrt(shift.dE * shift.dE + shift.dN * shift.dN);
    if (isDecisiveLead(horizontal, maxHorizontalMm)) {
      maxHorizontalMm = horizontal;
      if (is2D) {
        affectedStation = shift.stationId;
        affected = shift;
      }
    }
    if (!is2D && shift.dH != null) {
      maxVerticalMm = Math.max(maxVerticalMm ?? 0, Math.abs(shift.dH));
      const mag3d = Math.sqrt(horizontal * horizontal + shift.dH * shift.dH);
      if (max3dMm == null || isDecisiveLead(mag3d, max3dMm)) {
        max3dMm = mag3d;
        affectedStation = shift.stationId;
        affected = shift;
      }
    }
  }
  const primaryKind = !is2D ? '3d' : 'horizontal';
  const primaryMm = !is2D ? (max3dMm ?? 0) : maxHorizontalMm;
  return {
    available: true,
    method: 'first-order-linear',
    approximate: robustApproximate,
    ...(robustApproximate ? { approximateReason: EXTERNAL_REASON_ROBUST } : {}),
    mdbUsed: mdb,
    mdbModel,
    maxComponentMm,
    maxHorizontalMm,
    ...(affectedStation != null ? { affectedStation } : {}),
    ...(affected != null ? { dEmm: affected.dE, dNmm: affected.dN } : {}),
    ...(affected?.dH != null ? { dHmm: affected.dH } : {}),
    ...(maxVerticalMm != null ? { maxVerticalMm } : {}),
    ...(max3dMm != null ? { max3dMm } : {}),
    primaryMm,
    primaryKind,
    vectorMm: shifts,
  };
};

/**
 * Batch external influence over testable scalar equations: O(n.u) via B
 * rows, no per-observation re-solve. Untestable rows (non-finite or
 * non-positive MDB) are unavailable; the whole batch is unavailable on a
 * free-network datum or without dense B/P rows. Never throws.
 */
export const computeExternalInfluences = (
  args: ComputeExternalInfluencesArgs,
): Map<number, ExternalInfluence> => {
  const result = new Map<number, ExternalInfluence>();
  try {
    if (args.freeNetwork) {
      for (const input of args.rows) result.set(input.row, unavailable(EXTERNAL_REASON_FREE_NETWORK));
      return result;
    }
    const usable =
      args.B.length >= args.equationCount &&
      (args.weightAt != null ||
        (args.P != null && args.P.length >= args.equationCount)) &&
      (args.B[0]?.length ?? 0) > 0;
    if (!usable) {
      const reason =
        args.B.length > 0 || (args.P == null && args.weightAt == null)
          ? EXTERNAL_REASON_SPARSE_ROUTE
          : EXTERNAL_REASON_NO_COVARIANCE;
      for (const input of args.rows) result.set(input.row, unavailable(reason));
      return result;
    }
    const P = (args.P ?? []) as number[][];
    const weightAt = args.weightAt;
    for (const input of args.rows) {
      if (!Number.isFinite(input.mdbNative) || input.mdbNative <= 0) {
        result.set(input.row, unavailable(EXTERNAL_REASON_UNTESTABLE));
        continue;
      }
      const shifts = shiftForRow(
        args.is2D,
        args.B,
        P,
        weightAt,
        input.groupRows,
        input.row,
        input.mdbNative,
        args.paramColumns,
      );
      result.set(
        input.row,
        summarizeShifts(args.is2D, shifts, input.mdbNative, input.mdbModel, args.robustApproximate),
      );
    }
  } catch {
    for (const input of args.rows) {
      if (!result.has(input.row)) result.set(input.row, unavailable(EXTERNAL_REASON_NO_COVARIANCE));
    }
  }
  return result;
};

export interface CouplingRowInfo {
  obsId: number;
  component?: string;
}

/**
 * Rows sharing true-P coupling with each row: same GPS observation
 * (covariance block), same TS-correlation group, else the row itself.
 * Constraint rows (null info) are singletons. Mirrors the solve's weight
 * assembly: TS correlation skips component rows, GPS blocks are per
 * observation, so the grouping keys used here match exactly.
 */
export const buildCouplingGroupRows = (
  rowInfo: (CouplingRowInfo | null | undefined)[],
  tsGroupKeyOf: (_obsId: number) => string | null,
): Map<number, number[]> => {
  const keyOf = (row: number): string => {
    const info = rowInfo[row];
    if (info == null) return `row:${row}`;
    if (info.component != null) return `gps:${info.obsId}`;
    return tsGroupKeyOf(info.obsId) ?? `row:${row}`;
  };
  const members = new Map<string, number[]>();
  rowInfo.forEach((_info, row) => {
    const key = keyOf(row);
    const group = members.get(key) ?? [];
    group.push(row);
    members.set(key, group);
  });
  const byRow = new Map<number, number[]>();
  members.forEach((group) => {
    for (const row of group) byRow.set(row, group);
  });
  return byRow;
};
