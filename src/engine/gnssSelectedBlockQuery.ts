import type { SolveParameterIndex } from './adjustmentSolveTypes';
import type { GnssSelectedBlockPlan } from './gnssSelectedBlockPlan';
import type {
  SparseEquationSystem,
  SparseSelectedBlockResult,
  SparseSelectedBlockSolver,
} from './numericalBackend';

/**
 * Phase 12F.2 §§3-4 — GNSS selected-block query helper (EVIDENCE ONLY).
 *
 * Maps buildGnssSelectedBlockPlan output onto the experimental native
 * batched block API (`queryBlocks`) and folds the flat row-major result
 * into a compact named block store. No dense Qxx anywhere: diagonal
 * blocks live in one flat `diag` buffer (station ordinal × 9), off-diagonal
 * blocks in one flat `offDiag` buffer with a pair-key → slot index. No
 * object-per-block in the hot path.
 *
 * No production routing: callers pass an explicit block solver (real WASM
 * wrapper or test stub); this helper performs no fallback and no math
 * beyond buffer folding plus the transpose accessor.
 */

export const GNSS_SELECTED_BLOCK_SIZE = 3;

export interface GnssSelectedBlockStore {
  readonly blockSize: typeof GNSS_SELECTED_BLOCK_SIZE;
  readonly stationIds: readonly string[];
  /** Flat row-major 3×3 diagonal blocks, slot = station ordinal. */
  readonly diag: Float64Array;
  /** Flat row-major 3×3 off-diagonal blocks, slot = offIndex.get(key). */
  readonly offDiag: Float64Array;
  /** Canonical `a:b` (a < b, ordinals) → off-diagonal slot. */
  readonly offIndex: Map<string, number>;
}

export const gnssBlockPairKey = (blockA: number, blockB: number): string =>
  `${Math.min(blockA, blockB)}:${Math.max(blockA, blockB)}`;

export interface GnssSelectedBlockQueryInput {
  readonly plan: GnssSelectedBlockPlan;
  readonly paramIndex: SolveParameterIndex;
  readonly system: SparseEquationSystem;
  readonly solver: SparseSelectedBlockSolver;
}

export interface GnssSelectedBlockQueryResult {
  readonly store: GnssSelectedBlockStore;
  /** Native factor metadata passthrough (nnz/damping/timings). */
  readonly meta: Omit<SparseSelectedBlockResult, 'blocks'>;
  /** Unique parameter columns the block set actually needed. */
  readonly uniqueColumns: number;
}

/**
 * Runs one batched block query for every plan pair and folds the result
 * into a {@link GnssSelectedBlockStore}. Exactly one bridge call.
 */
export const queryGnssSelectedBlocks = (
  input: GnssSelectedBlockQueryInput,
): GnssSelectedBlockQueryResult => {
  const { plan, paramIndex, system, solver } = input;
  const blockRowStarts = new Int32Array(plan.pairs.length);
  const blockColStarts = new Int32Array(plan.pairs.length);
  const baseOf = (ordinal: number): number => {
    const stationId = plan.stationIds[ordinal];
    if (stationId === undefined) throw new Error(`Block plan station ordinal ${ordinal} is out of range.`);
    const base = paramIndex[stationId]?.['x'];
    if (!Number.isInteger(base)) throw new Error(`Block plan station ${stationId} has no free x column.`);
    return base as number;
  };
  plan.pairs.forEach((pair, slot) => {
    blockRowStarts[slot] = baseOf(pair.blockA);
    blockColStarts[slot] = baseOf(pair.blockB);
  });
  const needed = new Set<number>();
  plan.pairs.forEach((pair) => {
    const rowBase = baseOf(pair.blockA);
    const colBase = baseOf(pair.blockB);
    for (let k = 0; k < GNSS_SELECTED_BLOCK_SIZE; k += 1) {
      needed.add(rowBase + k);
      needed.add(colBase + k);
    }
  });
  const result = solver.queryBlocks({
    ...system,
    blockRowStarts,
    blockColStarts,
    blockSize: GNSS_SELECTED_BLOCK_SIZE,
  });
  const stride = GNSS_SELECTED_BLOCK_SIZE * GNSS_SELECTED_BLOCK_SIZE;
  if (result.blocks.length !== plan.pairs.length * stride) {
    throw new Error('Selected block result length mismatches the request plan.');
  }
  const diagCount = plan.pairs.filter((pair) => pair.blockA === pair.blockB).length;
  const diag = new Float64Array(plan.stationIds.length * stride);
  const offDiag = new Float64Array((plan.pairs.length - diagCount) * stride);
  const offIndex = new Map<string, number>();
  let offSlot = 0;
  plan.pairs.forEach((pair, slot) => {
    const chunk = result.blocks.subarray(slot * stride, (slot + 1) * stride);
    if (pair.blockA === pair.blockB) {
      diag.set(chunk, pair.blockA * stride);
    } else {
      offDiag.set(chunk, offSlot * stride);
      offIndex.set(gnssBlockPairKey(pair.blockA, pair.blockB), offSlot);
      offSlot += 1;
    }
  });
  const { blocks: _blocks, ...meta } = result;
  return {
    store: { blockSize: GNSS_SELECTED_BLOCK_SIZE, stationIds: plan.stationIds, diag, offDiag, offIndex },
    meta,
    uniqueColumns: needed.size,
  };
};

/**
 * Reads block (rowBlock, colBlock) row-major into `out` (length 9).
 * Off-diagonal transposes (B,A) are answered as the transpose of the
 * stored (A,B) chunk — no extra solve, bitwise transpose.
 */
export const readGnssBlock = (
  store: GnssSelectedBlockStore,
  rowBlock: number,
  colBlock: number,
  out: Float64Array = new Float64Array(9),
): Float64Array => {
  if (out.length !== 9) throw new Error('GNSS block read requires a length-9 output buffer.');
  const stride = 9;
  if (rowBlock === colBlock) {
    out.set(store.diag.subarray(rowBlock * stride, rowBlock * stride + stride));
    return out;
  }
  const slot = store.offIndex.get(gnssBlockPairKey(rowBlock, colBlock));
  if (slot === undefined) throw new Error(`GNSS block (${rowBlock},${colBlock}) was not queried.`);
  const chunk = store.offDiag.subarray(slot * stride, slot * stride + stride);
  if (rowBlock < colBlock) {
    out.set(chunk);
    return out;
  }
  for (let i = 0; i < 3; i += 1) {
    for (let j = 0; j < 3; j += 1) out[i * 3 + j] = chunk[j * 3 + i] as number;
  }
  return out;
};
