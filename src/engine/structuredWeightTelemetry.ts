/**
 * Phase 16B internal transfer telemetry (no UI, no user setting).
 *
 * Module-level counters recording dense-P allocation churn versus the
 * structured candidate path. Plain integer/float increments only, so the
 * cost is negligible whether or not any test observes the snapshot.
 * Benchmarks reset before a run and snapshot after; production never reads
 * these values.
 */
export interface StructuredWeightTransferCounters {
  /** Dense m×m P allocations (assembly dense branch). */
  densePAllocations: number;
  /** Bytes requested by dense m×m P allocations (8 bytes per entry). */
  densePBytesAllocated: number;
  /** Structured weight builds finalized (assembly sparse branch). */
  structuredWeightBuilds: number;
  /** Cumulative off-diagonal triplets across structured builds. */
  structuredNnz: number;
  /** Dense materializations from structured weights. */
  denseMaterializations: number;
  /** Bytes requested by dense materializations (8 bytes per entry). */
  denseMaterializationBytes: number;
  /** Structured covariance attempts that fell back to dense. */
  structuredFallbacks: number;
  /** Statistics dense-P allocations (assembly dense branch at stats time). */
  statisticsDensePAllocations: number;
  /** Bytes requested by statistics dense-P allocations (8 bytes per entry). */
  statisticsDensePBytes: number;
  /** Statistics solves consuming structured weights without a dense P. */
  statisticsStructuredAccesses: number;
  /** weightAt reads served (either backing). */
  weightAtCalls: number;
  /** forEachCoupled traversals started. */
  coupledIterationCalls: number;
  /** Nonzero coupled entries visited. */
  coupledEntriesVisited: number;
  /** Structured-statistics attempts that fell back to dense. */
  statisticsDenseFallbacks: number;
  /** Last structured-statistics fallback reason (null when none). */
  statisticsDenseFallbackReason: string | null;
}

const counters: StructuredWeightTransferCounters = {
  densePAllocations: 0,
  densePBytesAllocated: 0,
  structuredWeightBuilds: 0,
  structuredNnz: 0,
  denseMaterializations: 0,
  denseMaterializationBytes: 0,
  structuredFallbacks: 0,
  statisticsDensePAllocations: 0,
  statisticsDensePBytes: 0,
  statisticsStructuredAccesses: 0,
  weightAtCalls: 0,
  coupledIterationCalls: 0,
  coupledEntriesVisited: 0,
  statisticsDenseFallbacks: 0,
  statisticsDenseFallbackReason: null,
};

export const recordDensePAllocation = (size: number): void => {
  counters.densePAllocations += 1;
  counters.densePBytesAllocated += size * size * 8;
};

export const recordStructuredWeightBuild = (offDiagonalCount: number): void => {
  counters.structuredWeightBuilds += 1;
  counters.structuredNnz += offDiagonalCount;
};

export const recordDenseMaterialization = (size: number): void => {
  counters.denseMaterializations += 1;
  counters.denseMaterializationBytes += size * size * 8;
};

export const recordStructuredFallback = (): void => {
  counters.structuredFallbacks += 1;
};

export const recordStatisticsDensePAllocation = (size: number): void => {
  counters.statisticsDensePAllocations += 1;
  counters.statisticsDensePBytes += size * size * 8;
};

export const recordStatisticsStructuredAccess = (): void => {
  counters.statisticsStructuredAccesses += 1;
};

export const recordWeightAtCall = (): void => {
  counters.weightAtCalls += 1;
};

export const recordCoupledIteration = (entriesVisited: number): void => {
  counters.coupledIterationCalls += 1;
  counters.coupledEntriesVisited += entriesVisited;
};

export const recordStatisticsDenseFallback = (reason: string): void => {
  counters.statisticsDenseFallbacks += 1;
  counters.statisticsDenseFallbackReason = reason;
};

export const resetStructuredWeightTelemetry = (): void => {
  counters.densePAllocations = 0;
  counters.densePBytesAllocated = 0;
  counters.structuredWeightBuilds = 0;
  counters.structuredNnz = 0;
  counters.denseMaterializations = 0;
  counters.denseMaterializationBytes = 0;
  counters.structuredFallbacks = 0;
  counters.statisticsDensePAllocations = 0;
  counters.statisticsDensePBytes = 0;
  counters.statisticsStructuredAccesses = 0;
  counters.weightAtCalls = 0;
  counters.coupledIterationCalls = 0;
  counters.coupledEntriesVisited = 0;
  counters.statisticsDenseFallbacks = 0;
  counters.statisticsDenseFallbackReason = null;
};

export const snapshotStructuredWeightTelemetry = (): StructuredWeightTransferCounters => ({
  ...counters,
});
