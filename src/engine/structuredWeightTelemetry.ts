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
}

const counters: StructuredWeightTransferCounters = {
  densePAllocations: 0,
  densePBytesAllocated: 0,
  structuredWeightBuilds: 0,
  structuredNnz: 0,
  denseMaterializations: 0,
  denseMaterializationBytes: 0,
  structuredFallbacks: 0,
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

export const resetStructuredWeightTelemetry = (): void => {
  counters.densePAllocations = 0;
  counters.densePBytesAllocated = 0;
  counters.structuredWeightBuilds = 0;
  counters.structuredNnz = 0;
  counters.denseMaterializations = 0;
  counters.denseMaterializationBytes = 0;
  counters.structuredFallbacks = 0;
};

export const snapshotStructuredWeightTelemetry = (): StructuredWeightTransferCounters => ({
  ...counters,
});
