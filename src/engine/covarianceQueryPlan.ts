import type { SparseMatrixRows } from './matrixTypes';
import type { SolveParameterIndex } from './adjustmentSolveTypes';
import type { StationId } from '../types';

export type CovariancePair = { from: StationId; to: StationId };

export type CovarianceQueryPlan = {
  requiredColumns: number[];
  queries: Array<{ row: number; column: number }>;
  connectedPairs: CovariancePair[];
  requestedPairs: CovariancePair[];
  /** Phase 7B.5: exact all-unknown pairs when legacy compat is requested. */
  allStationPairs: CovariancePair[];
  /** Equation rows are retained for row-product consumers, not copied into the plan. */
  equationRowCount: number;
};

type PlanOptions = {
  paramIndex: SolveParameterIndex;
  unknowns: readonly StationId[];
  stationParamCount: number;
  sparseRows?: SparseMatrixRows;
  connectedPairs?: readonly CovariancePair[];
  requestedPairs?: readonly CovariancePair[];
  includeHeight: boolean;
  /**
   * Phase 7B.5 (Option B): also demand every unordered unknown pair so
   * legacy all-pairs relativePrecision resolves without dense Qxx.
   * Default false preserves selected-network scaling.
   */
  includeAllStationPairs?: boolean;
};

const addQuery = (queries: Array<{ row: number; column: number }>, row?: number, column?: number): void => {
  if (row == null || column == null || row < 0 || column < 0) return;
  queries.push({ row, column });
};

const pairKey = (a: StationId, b: StationId): string => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`);

const uniquePairs = (pairs: readonly CovariancePair[]): CovariancePair[] => {
  const seen = new Set<string>();
  return pairs.filter((pair) => {
    if (!pair.from || !pair.to || pair.from === pair.to) return false;
    const key = pairKey(pair.from, pair.to);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/** Builds deterministic covariance-entry demand without calculating covariance. */
export const buildCovarianceQueryPlan = (options: PlanOptions): CovarianceQueryPlan => {
  const queries: Array<{ row: number; column: number }> = [];
  const required = new Set<number>();
  options.unknowns.forEach((stationId) => {
    const index = options.paramIndex[stationId];
    if (!index) return;
    const horizontal = [index.x, index.y];
    horizontal.forEach((row) => horizontal.forEach((column) => addQuery(queries, row, column)));
    if (options.includeHeight) {
      [index.x, index.y, index.h].forEach((row) =>
        [index.x, index.y, index.h].forEach((column) => addQuery(queries, row, column)),
      );
    }
    [index.x, index.y, ...(options.includeHeight ? [index.h] : [])].forEach((column) => {
      if (column != null && column < options.stationParamCount) required.add(column);
    });
  });
  const connectedPairs = uniquePairs(options.connectedPairs ?? []);
  const requestedPairs = uniquePairs(options.requestedPairs ?? []);
  const allStationPairs = buildAllStationPairs(options.unknowns, options.includeAllStationPairs === true);
  [...connectedPairs, ...requestedPairs, ...allStationPairs].forEach(({ from, to }) => {
    const a = options.paramIndex[from];
    const b = options.paramIndex[to];
    const indices = [a?.x, a?.y, ...(options.includeHeight ? [a?.h] : []), b?.x, b?.y, ...(options.includeHeight ? [b?.h] : [])];
    indices.forEach((index) => {
      if (index != null && index >= 0 && index < options.stationParamCount) required.add(index);
    });
    const left = [a?.x, a?.y, ...(options.includeHeight ? [a?.h] : [])];
    const right = [b?.x, b?.y, ...(options.includeHeight ? [b?.h] : [])];
    left.forEach((row) => right.forEach((column) => addQuery(queries, row, column)));
  });
  return {
    requiredColumns: Array.from(required).sort((a, b) => a - b),
    queries,
    connectedPairs,
    requestedPairs,
    allStationPairs,
    equationRowCount: options.sparseRows?.length ?? 0,
  };
};

/** Deterministic C(unknowns,2) enumeration in unknowns order. */
const buildAllStationPairs = (
  unknowns: readonly StationId[],
  enabled: boolean,
): CovariancePair[] => {
  if (!enabled) return [];
  const pairs: CovariancePair[] = [];
  for (let i = 0; i < unknowns.length; i += 1) {
    for (let j = i + 1; j < unknowns.length; j += 1) {
      const from = unknowns[i] as StationId;
      const to = unknowns[j] as StationId;
      if (!from || !to || from === to) continue;
      pairs.push({ from, to });
    }
  }
  return pairs;
};
