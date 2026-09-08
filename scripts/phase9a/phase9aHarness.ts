/**
 * Phase 9A evidence-only harness (TEST ONLY).
 *
 * Never imported by production code. Provides:
 * - real-WASM bundle loading (actual cpp/build-wasm artifact, never a mock),
 * - a synthetic diagonal correction-system builder for the direct-bundle
 *   structural scaling probe (explicitly NOT production-route evidence),
 * - a deterministic JSON+Markdown report writer for reports/phase9a/.
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type { SparseCorrectionSolveInput } from '../../src/engine/numericalBackend';
import type { ExperimentalSparseNumericalBundle } from '../../src/engine/wasm/experimentalSparseNumericalBundle';
import { createExperimentalSparseNumericalBundle } from '../../src/engine/wasm/experimentalSparseNumericalBundle';
import type { WebNetWasmFactory } from '../../src/engine/wasm/wasmTypes';

export const PHASE9A_WASM_JS_PATH = path.join(process.cwd(), 'cpp/build-wasm/webnet_core.js');
export { PHASE9A_REPORT_DIR, writePhase9aReports } from './phase9aReport';

/** Loads the real WASM bundle, or null when the build artifact is absent. */
export const loadPhase9aRealBundle = async (): Promise<ExperimentalSparseNumericalBundle | null> => {
  try {
    const imported = (await import(pathToFileURL(PHASE9A_WASM_JS_PATH).href)) as unknown as {
      default: WebNetWasmFactory;
    };
    if (typeof imported.default !== 'function') return null;
    return await createExperimentalSparseNumericalBundle(imported.default);
  } catch {
    return null;
  }
};

/**
 * Builds a synthetic n-parameter diagonal correction system (identity
 * design, unit weights, zero misclosures). The native solution is the
 * zero correction with no damping. Used ONLY for the direct-bundle
 * structural scaling probe; it never represents a production route run.
 */
export const buildPhase9aDiagonalSystem = (parameterCount: number): SparseCorrectionSolveInput => {
  const n = parameterCount;
  const rowOffsets = new Int32Array(n + 1);
  const columns = new Int32Array(n);
  const values = new Float64Array(n);
  const weightRows = new Int32Array(n);
  const weightColumns = new Int32Array(n);
  const weightValues = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    rowOffsets[i] = i;
    columns[i] = i;
    values[i] = 1;
    weightRows[i] = i;
    weightColumns[i] = i;
    weightValues[i] = 1;
  }
  rowOffsets[n] = n;
  return {
    design: { rowOffsets, columns, values },
    weights: { rows: weightRows, columns: weightColumns, values: weightValues },
    misclosures: new Float64Array(n),
    observationEquationCount: n,
    parameterCount: n,
  };
};

export interface Phase9aScalingProbeEntry {
  parameterCount: number;
  dispatched: boolean;
  undamped: boolean;
  zeroCorrection: boolean;
  wallMs: number;
  /** Structural dense-N footprint n^2 * 8 bytes (never allocated). */
  denseBytes: number;
  error: string | null;
}

/**
 * Runs the synthetic diagonal systems straight through the REAL bundle
 * correction solver (no route, no caps, no eligibility). Sizes above 128
 * exercise bundle-level structural scaling only and MUST NOT be presented
 * as production-route evidence.
 */
export const runPhase9aScalingProbe = (
  bundle: ExperimentalSparseNumericalBundle,
  sizes: number[],
): Phase9aScalingProbeEntry[] =>
  sizes.map((parameterCount) => {
    const input = buildPhase9aDiagonalSystem(parameterCount);
    const started = Date.now();
    try {
      const result = bundle.sparseCorrectionSolver.solveFromEquations(input);
      const wallMs = Date.now() - started;
      const corrections = result.correction.flat();
      const zeroCorrection =
        corrections.length === parameterCount && corrections.every((value) => Math.abs(value) < 1e-9);
      return {
        parameterCount,
        dispatched: true,
        undamped: result.damping === 0,
        zeroCorrection,
        wallMs,
        denseBytes: parameterCount * parameterCount * 8,
        error: null,
      };
    } catch (error) {
      return {
        parameterCount,
        dispatched: false,
        undamped: false,
        zeroCorrection: false,
        wallMs: Date.now() - started,
        denseBytes: parameterCount * parameterCount * 8,
        error: error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200),
      };
    }
  });

export interface Phase9aTimingSummary {
  count: number;
  min: number;
  median: number;
  max: number;
  p95: number;
}

export const summarizePhase9aTimings = (samples: number[]): Phase9aTimingSummary => {
  if (samples.length === 0) return { count: 0, min: 0, median: 0, max: 0, p95: 0 };
  const sorted = [...samples].sort((left, right) => left - right);
  const percentile = (fraction: number): number => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)]!;
  return {
    count: sorted.length,
    min: sorted[0]!,
    median: percentile(0.5),
    max: sorted[sorted.length - 1]!,
    p95: percentile(0.95),
  };
};

export const summarizePhase9aTimingMap = (
  phases: Record<string, number[]>,
): Record<string, Phase9aTimingSummary> => Object.fromEntries(
  Object.entries(phases).map(([phase, samples]) => [phase, summarizePhase9aTimings(samples)]),
);

export interface Phase9aMemorySnapshot {
  rss: number;
  heapUsed: number;
  heapTotal: number;
}

/** Heap/RSS snapshot (observed only, never gated). */
export const snapshotPhase9aMemory = (): Phase9aMemorySnapshot => {
  const memory = process.memoryUsage();
  return { rss: memory.rss, heapUsed: memory.heapUsed, heapTotal: memory.heapTotal };
};


