/**
 * Internal/test-only selected-network covariance store.
 *
 * Holds only the Qxx entries demanded by the covariance query plan
 * (station blocks plus connected/requested pairs) instead of the dense
 * n x n reconstruction. Reads are fail-closed: an unqueried entry throws
 * so precision code can never silently consume a zero. Null indices still
 * read as zero because fixed stations own no parameters.
 */
import type { SolveParameterIndex } from './adjustmentSolveTypes';
import type { CovariancePair } from './covarianceQueryPlan';
import type { Observation, StationId } from '../types';

export interface SelectedCovarianceQuery {
  row: number;
  column: number;
}

export interface SelectedCovarianceStore {
  readonly parameterCount: number;
  /** Solver queries issued; strictly below n^2 in selected mode. */
  readonly queryCount: number;
  readonly values: ReadonlyMap<number, number>;
}

const keyOf = (parameterCount: number, row: number, column: number): number =>
  Math.min(row, column) * parameterCount + Math.max(row, column);

/** Builds a deterministic store; duplicate queries keep their first value. */
export const createSelectedCovarianceStore = (
  parameterCount: number,
  queries: readonly SelectedCovarianceQuery[],
  covariance: ArrayLike<number>,
): SelectedCovarianceStore => {
  if (!Number.isInteger(parameterCount) || parameterCount <= 0) {
    throw new Error('Selected covariance store requires a positive parameter count.');
  }
  if (covariance.length !== queries.length) {
    throw new Error('Selected covariance returned an unexpected entry count.');
  }
  const values = new Map<number, number>();
  queries.forEach((query, index) => {
    if (
      !Number.isInteger(query.row) ||
      !Number.isInteger(query.column) ||
      query.row < 0 ||
      query.column < 0 ||
      query.row >= parameterCount ||
      query.column >= parameterCount
    ) {
      throw new Error('Selected covariance query index is out of range.');
    }
    const value = covariance[index] ?? 0;
    if (!Number.isFinite(value)) {
      throw new Error('Selected covariance contains a non-finite entry.');
    }
    const key = keyOf(parameterCount, query.row, query.column);
    if (!values.has(key)) values.set(key, value);
  });
  return { parameterCount, queryCount: queries.length, values };
};

/** Fail-closed read; null indices (fixed stations) read as zero. */
export const readSelectedCovariance = (
  store: SelectedCovarianceStore,
  row?: number | null,
  column?: number | null,
): number => {
  if (row == null || column == null) return 0;
  const value = store.values.get(keyOf(store.parameterCount, row, column));
  if (value == null) {
    throw new Error(
      `Selected covariance entry (${row},${column}) was not queried in selected mode.`,
    );
  }
  return value;
};

/** Deduplicates plan queries in first-occurrence order. */
export const dedupeSelectedQueries = (
  queries: readonly SelectedCovarianceQuery[],
): SelectedCovarianceQuery[] => {
  const seen = new Set<string>();
  return queries.filter((query) => {
    const row = Math.min(query.row, query.column);
    const column = Math.max(query.row, query.column);
    const key = `${row},${column}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/** Counts station parameters (orientation unknowns live outside this range). */
export const stationParamCountOf = (paramIndex: SolveParameterIndex): number => {
  let count = 0;
  Object.values(paramIndex).forEach((entry) => {
    [entry?.x, entry?.y, entry?.h].forEach((index) => {
      if (index != null && index >= count) count = index + 1;
    });
  });
  return count;
};

/**
 * Collects observed station pairs with the same derivation as precision
 * propagation (angle at/from/to, direction at/to, otherwise from/to),
 * sorted for determinism. Must stay in sync with that derivation so every
 * connected-pair read hits a queried entry.
 */
export const collectConnectedStationPairs = (
  observations: readonly Observation[],
): CovariancePair[] => {
  const seen = new Set<string>();
  const pairs: CovariancePair[] = [];
  const add = (from: StationId, to: StationId): void => {
    if (!from || !to || from === to) return;
    const key = from < to ? `${from}\u0000${to}` : `${to}\u0000${from}`;
    if (seen.has(key)) return;
    seen.add(key);
    pairs.push({ from, to });
  };
  observations.forEach((obs) => {
    if (obs.type === 'angle') {
      add(obs.at, obs.from);
      add(obs.at, obs.to);
      return;
    }
    if (obs.type === 'direction') {
      add(obs.at, obs.to);
      return;
    }
    if ('from' in obs && 'to' in obs) {
      add(obs.from, obs.to);
    }
  });
  pairs.sort((a, b) => (a.from === b.from ? (a.to < b.to ? -1 : 1) : a.from < b.from ? -1 : 1));
  return pairs;
};
