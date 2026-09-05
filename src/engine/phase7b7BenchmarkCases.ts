/**
 * Phase 7B.7 deterministic benchmark cases (test-only, no routing).
 *
 * Chain-2d networks from the Phase 5 seeded generator at representative
 * unknown counts. Seeds are fixed per size so reruns are byte-identical.
 * Production defaults and parsers are untouched.
 */
import {
  generatePhase5BenchmarkInput,
  type Phase5NetworkSpec,
} from './phase5BenchmarkNetworks';

export interface Phase7b7BenchmarkCase extends Phase5NetworkSpec {
  input: string;
  stationCount: number;
}

/** Representative unknown counts; 96/128 exercise the upper candidacy range. */
export const PHASE7B7_BENCHMARK_SIZES = [8, 16, 25, 50, 64, 96, 128] as const;

/** Quick subset for smoke/tests: the two smallest sizes. */
export const PHASE7B7_QUICK_SIZES = [8, 16] as const;

const seedForSize = (unknownCount: number): number => 7000 + unknownCount * 13;

export const listPhase7b7BenchmarkCases = (quick: boolean): Phase7b7BenchmarkCase[] => {
  const sizes = quick ? PHASE7B7_QUICK_SIZES : PHASE7B7_BENCHMARK_SIZES;
  return sizes.map((unknownCount) => {
    const spec: Phase5NetworkSpec = {
      id: `chain-2d-${String(unknownCount).padStart(2, '0')}`,
      family: 'chain-2d',
      unknownCount,
      seed: seedForSize(unknownCount),
    };
    return {
      ...spec,
      input: generatePhase5BenchmarkInput(spec),
      stationCount: unknownCount + 2,
    };
  });
};

/**
 * Fails-closed size guard: returns a skip reason above budget, else null.
 * Mirrors the Phase 5 guard wording family for report consistency.
 */
export const phase7b7SizeSkipReason = (
  spec: Phase5NetworkSpec,
  maxUnknowns: number,
): string | null =>
  spec.unknownCount > maxUnknowns
    ? `size guard: ${spec.unknownCount} unknowns exceed PHASE7B7_MAX_UNKNOWN_COUNT=${maxUnknowns}`
    : null;
