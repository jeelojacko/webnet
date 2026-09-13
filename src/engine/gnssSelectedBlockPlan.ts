import type { SolveParameterIndex } from './adjustmentSolveTypes';

/**
 * Phase 12F.2 §2 — canonical GNSS selected-covariance block request set.
 *
 * EVIDENCE ONLY: pure function, no native calls, no production routing.
 * Collapses the per-edge R2 query list (21 scalar queries/edge, no
 * cross-edge dedup) into the minimal deduplicated block set a batched
 * block API would request: one Q_ii diagonal block per free station
 * involved, one Q_ij off-diagonal block per unique free-free observed
 * pair (Q_ji is the transpose, never requested twice).
 *
 * Rules: free-only side for fixed/free edges (no block for a fixed
 * station); repeated baselines over the same unordered pair requested
 * ONCE; fully-fixed baselines contribute nothing; output ordering is
 * deterministic (sorted station ids, lexicographic pairs).
 */

/** One requested 3x3 block; block = free-station ordinal over stationIds. */
export interface GnssSelectedBlockPair {
  /** Canonical: blockA <= blockB; diagonal (A == B) is a Q_ii request. */
  readonly blockA: number;
  readonly blockB: number;
}

export interface GnssSelectedBlockCounts {
  /** Free stations involved in at least one baseline. */
  readonly stations: number;
  /** Distinct unordered free-free observed pairs. */
  readonly uniqueFreeFreeEdges: number;
  /** Baselines beyond the first per unordered pair (dedup savings). */
  readonly repeatedObservationsSkipped: number;
  /** Diagonal + off-diagonal 3x3 blocks requested. */
  readonly uniqueBlocks: number;
  /** Scalar entries: 6 per diagonal (upper triangle) + 9 per off-diagonal. */
  readonly scalarEntries: number;
}

export interface GnssSelectedBlockPlan {
  /** Sorted free-station ids; index = block ordinal. */
  readonly stationIds: string[];
  /** Deduplicated canonical pairs, lexicographically sorted. */
  readonly pairs: GnssSelectedBlockPair[];
  readonly counts: GnssSelectedBlockCounts;
}

export interface GnssBlockPlanBaseline {
  readonly from: string;
  readonly to: string;
}

const AXES = ['x', 'y', 'h'] as const;

export const buildGnssSelectedBlockPlan = (
  paramIndex: SolveParameterIndex,
  baselines: GnssBlockPlanBaseline[],
  numParams: number,
): GnssSelectedBlockPlan => {
  if (!Number.isInteger(numParams) || numParams <= 0) {
    throw new Error('Block plan requires a positive parameter count.');
  }
  // Free stations involved in at least one baseline, sorted (determinism).
  // A block needs all of x/y/h free; partial fixing is fail-closed.
  const stationIds = [...new Set(baselines.flatMap((b) => [b.from, b.to]))]
    .filter((id) => paramIndex[id] !== undefined)
    .sort();
  stationIds.forEach((id) => {
    const cols = AXES.map((axis) => paramIndex[id]![axis]);
    if (cols.some((col) => !Number.isInteger(col) || col! < 0 || col! >= numParams)) {
      throw new Error(`Block plan station ${id} is partially fixed; need all of x/y/h free or fixed.`);
    }
  });
  const ordinal = new Map(stationIds.map((id, index) => [id, index] as const));
  const pairKeys = new Set<string>();
  const pairs: GnssSelectedBlockPair[] = [];
  const add = (first: number, second: number): void => {
    const blockA = Math.min(first, second);
    const blockB = Math.max(first, second);
    const key = `${blockA}:${blockB}`;
    if (pairKeys.has(key)) return;
    pairKeys.add(key);
    pairs.push({ blockA, blockB });
  };
  const observedKeys = new Set<string>();
  let observedWithFreeSide = 0;
  const freeFreeKeys = new Set<string>();
  baselines.forEach((baseline) => {
    if (baseline.from === baseline.to) throw new Error('Block plan rejects a self-baseline.');
    const fromFree = ordinal.get(baseline.from);
    const toFree = ordinal.get(baseline.to);
    if (fromFree === undefined && toFree === undefined) return;
    observedWithFreeSide += 1;
    const unordered = [baseline.from, baseline.to].sort().join('|');
    observedKeys.add(unordered);
    if (fromFree !== undefined) add(fromFree, fromFree);
    if (toFree !== undefined) add(toFree, toFree);
    if (fromFree !== undefined && toFree !== undefined) {
      freeFreeKeys.add(`${Math.min(fromFree, toFree)}:${Math.max(fromFree, toFree)}`);
      add(fromFree, toFree);
    }
  });
  pairs.sort((a, b) => a.blockA - b.blockA || a.blockB - b.blockB);
  const diagonals = pairs.filter((p) => p.blockA === p.blockB).length;
  return {
    stationIds,
    pairs,
    counts: {
      stations: stationIds.length,
      uniqueFreeFreeEdges: freeFreeKeys.size,
      repeatedObservationsSkipped: observedWithFreeSide - observedKeys.size,
      uniqueBlocks: pairs.length,
      scalarEntries: diagonals * 6 + (pairs.length - diagonals) * 9,
    },
  };
};
