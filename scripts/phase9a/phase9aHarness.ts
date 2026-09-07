/**
 * Phase 9A evidence-only harness (TEST ONLY).
 *
 * Never imported by production code. Provides:
 * - real-WASM bundle loading (actual cpp/build-wasm artifact, never a mock),
 * - a synthetic diagonal correction-system builder for the direct-bundle
 *   structural scaling probe (explicitly NOT production-route evidence),
 * - a deterministic JSON+Markdown report writer for reports/phase9a/.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type { SparseCorrectionSolveInput } from '../../src/engine/numericalBackend';
import type { ExperimentalSparseNumericalBundle } from '../../src/engine/wasm/experimentalSparseNumericalBundle';
import { createExperimentalSparseNumericalBundle } from '../../src/engine/wasm/experimentalSparseNumericalBundle';
import type { WebNetWasmFactory } from '../../src/engine/wasm/wasmTypes';

export const PHASE9A_WASM_JS_PATH = path.join(process.cwd(), 'cpp/build-wasm/webnet_core.js');
export const PHASE9A_REPORT_DIR = path.join(process.cwd(), 'reports/phase9a');

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

/**
 * Writes the deterministic Phase 9A JSON+Markdown reports. Key/line order
 * is fixed by construction; only measured wallMs/RSS fields vary run to run.
 */
export const writePhase9aReports = (evidence: Record<string, unknown>): { jsonPath: string; mdPath: string } => {
  fs.mkdirSync(PHASE9A_REPORT_DIR, { recursive: true });
  const jsonPath = path.join(PHASE9A_REPORT_DIR, 'cap-widening-evidence.json');
  const mdPath = path.join(PHASE9A_REPORT_DIR, 'cap-widening-evidence.md');
  fs.writeFileSync(jsonPath, `${JSON.stringify(evidence, null, 2)}\n`);
  const stringify = (value: unknown): string => JSON.stringify(value);
  const ladderRows = ((evidence.fullRouteLadder as { rows?: Array<Record<string, unknown>> } | undefined)?.rows ?? []);
  const tableRows = ladderRows.map((row) =>
    `| ${row.targetParameterCount ?? '-'} | ${row.actualParameterCount ?? '-'} | ${row.stationUnknownCount ?? '-'} | ${row.orientationParameterCount ?? '-'} | ${row.equationCount ?? '-'} | ${row.designNNZ ?? '-'} | ${row.nativeCorrectionMs ? JSON.stringify(row.nativeCorrectionMs) : '-'} | ${row.nativeCovarianceMs ? JSON.stringify(row.nativeCovarianceMs) : '-'} | ${row.verifierPhaseMs ? JSON.stringify((row.verifierPhaseMs as Record<string, unknown>).c1 ?? '-') : '-'} | ${row.sessionWallMs ?? '-'} |`,
  );
  const lines = [
    '# Phase 9A cap-widening evidence (evidence-only, no production change)',
    '',
    `- baselineSha: ${stringify(evidence.baselineSha)}`,
    `- headSha: ${stringify(evidence.headSha)}`,
    `- productionChanged: ${stringify(evidence.productionChanged)}`,
    `- wasmArtifact: ${stringify(evidence.wasmArtifact)}`,
    `- wasmPresent: ${stringify(evidence.wasmPresent)}`,
    `- productionCaps: ${stringify(evidence.productionCaps)}`,
    `- staticBoundary127_128_129: ${stringify(evidence.staticBoundary127_128_129)}`,
    `- extendedStaticBoundaries255_256_257_511_512_513: ${stringify(evidence.extendedStaticBoundaries255_256_257_511_512_513)}`,
    `- routeAnchorSparse: ${stringify(evidence.routeAnchorSparse)}`,
    `- actualParameterCounts: ${stringify(evidence.actualParameterCounts)}`,
    `- campDirectionHeavyFallback: ${stringify(evidence.campDirectionHeavyFallback)}`,
    `- faultRestartCorrupt: ${stringify(evidence.faultRestartCorrupt)}`,
    `- faultRestartInitFailure: ${stringify(evidence.faultRestartInitFailure)}`,
    `- adversarialSignFlip: ${stringify(evidence.adversarialSignFlip)}`,
    `- gpsCovarianceGate: ${stringify(evidence.gpsCovarianceGate)}`,
    `- exclusionGuards: ${stringify(evidence.exclusionGuards)}`,
    `- productionControls9a1: ${stringify(evidence.productionControls9a1)}`,
    `- capOverrides9a1: ${stringify(evidence.capOverrides9a1)}`,
    `- directBundleScalingProbe: ${stringify(evidence.directBundleScalingProbe)}`,
    `- unavailableVerifierEvidence: ${stringify(evidence.unavailableVerifierEvidence)}`,
    `- unavailableSessionEvidence: ${stringify(evidence.unavailableSessionEvidence)}`,
    `- memorySnapshots: ${stringify(evidence.memorySnapshots)}`,
    `- verdict: ${stringify(evidence.verdict)}`,
    '',
    '## Full real-WASM route ladder',
    '',
    '| requested | actual params | station unknowns | orientation params | equations | design NNZ | native correction ms | native covariance ms | C1 ms | session ms |',
    '|---:|---:|---:|---:|---:|---:|---|---|---|---:|',
    ...tableRows,
    '',
    'Scope: evidence-only. No production behavior, constants, routing, or tolerances changed.',
    'Phase 9A.1 evidence mode widens only internal test caps; production remains capped at 128.',
    'The full route ladder is real-WASM route evidence at approximate actual dimensions.',
    'Coverage limitations and any NOT YET EVALUATED verdicts are recorded in JSON above; the',
    'direct-bundle scaling probe remains supplemental structural evidence only.',
    '',
  ];
  fs.writeFileSync(mdPath, `${lines.join('\n')}\n`);
  return { jsonPath, mdPath };
};
