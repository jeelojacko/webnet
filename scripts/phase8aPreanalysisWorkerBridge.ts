/**
 * Phase 8A test-only bridge: genuinely loads the production browser worker
 * module (`src/workers/adjustmentWorker.ts`) inside a Node worker_threads
 * worker, then injects a worker-local sparse runtime via the exported
 * test-only provider seam (no protocol or `RunSessionRequest` changes, no
 * auto-route: `runWithSparseAutoRoute` is never invoked — the production
 * worker bypasses it whenever an injected runtime is present).
 *
 * The injected runtime uses the REAL WASM sparse bundle (correction, row
 * products, selected covariance) with legacy-all-pairs selected covariance.
 * Per worker run the provider builds fresh diagnostics plus a bounded local
 * capture of every correction system (one per preanalysis solve iteration)
 * and, after each success, forwards a test-only diagnostics snapshot with
 * per-system dense-oracle summaries so the parent test can evaluate the
 * S0-S3 strategy ladder without shipping large typed arrays across threads.
 */
import { parentPort } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import {
  createExperimentalSparseRouteDiagnostics,
  type ExperimentalSparseRouteDiagnostics,
} from '../src/engine/experimentalSparseDiagnostics';
import type {
  SparseCorrectionSolveInput,
  SparseCorrectionSolveResult,
  SparseCorrectionSolver,
} from '../src/engine/numericalBackend';
import { measurePhase7b7DenseOracle } from '../src/engine/phase7b7DenseRebuild';
import { createExperimentalSparseNumericalBundle } from '../src/engine/wasm/experimentalSparseNumericalBundle';
import type { WebNetWasmFactory } from '../src/engine/wasm/wasmTypes';

type WorkerEvent = { data: unknown };

/** Session-level capture bound; exceeding it truncates fail-closed. */
const MAX_CAPTURED_SYSTEMS = 512;

interface CapturedSystem {
  design: SparseCorrectionSolveInput['design'];
  weights: SparseCorrectionSolveInput['weights'];
  misclosures: Float64Array;
  observationEquationCount: number;
  parameterCount: number;
  result: SparseCorrectionSolveResult | null;
  threw: boolean;
}

const copySystem = (input: SparseCorrectionSolveInput): Omit<CapturedSystem, 'result' | 'threw'> => ({
  design: {
    rowOffsets: Int32Array.from(input.design.rowOffsets),
    columns: Int32Array.from(input.design.columns),
    values: Float64Array.from(input.design.values),
  },
  weights: {
    rows: Int32Array.from(input.weights.rows),
    columns: Int32Array.from(input.weights.columns),
    values: Float64Array.from(input.weights.values),
  },
  misclosures: Float64Array.from(input.misclosures),
  observationEquationCount: input.observationEquationCount,
  parameterCount: input.parameterCount,
});

class LocalCaptureSolver implements SparseCorrectionSolver {
  readonly systems: CapturedSystem[] = [];

  truncated = false;

  constructor(private readonly _delegate: SparseCorrectionSolver) {}

  solveFromEquations(input: SparseCorrectionSolveInput): SparseCorrectionSolveResult {
    if (this.systems.length >= MAX_CAPTURED_SYSTEMS) {
      this.truncated = true;
      return this._delegate.solveFromEquations(input);
    }
    try {
      const result = this._delegate.solveFromEquations(input);
      this.systems.push({ ...copySystem(input), result, threw: false });
      return result;
    } catch (error) {
      this.systems.push({ ...copySystem(input), result: null, threw: true });
      throw error;
    }
  }
}

interface OracleSummary {
  maxCorrectionDiff: number | null;
  damping: number | null;
  conditionEstimate: number | undefined;
  /** Sparse-backend reported condition (result.conditionEstimate), kept beside the dense oracle. */
  sparseConditionEstimate: number | undefined;
  parameterCount: number;
  observationEquationCount: number;
}

const summarizeSystems = (systems: CapturedSystem[]): OracleSummary[] =>
  systems.map((system) => {
    if (system.threw || system.result == null) {
      return {
        maxCorrectionDiff: null,
        damping: null,
        conditionEstimate: undefined,
        sparseConditionEstimate: undefined,
        parameterCount: system.parameterCount,
        observationEquationCount: system.observationEquationCount,
      };
    }
    const measured = measurePhase7b7DenseOracle(
      {
        design: system.design,
        weights: system.weights,
        misclosures: system.misclosures,
        observationEquationCount: system.observationEquationCount,
        parameterCount: system.parameterCount,
      },
      system.result.conditionEstimate,
    );
    let maxCorrectionDiff: number | null = null;
    if (measured.denseCorrection) {
      let worst = 0;
      let nonfinite = false;
      for (let param = 0; param < system.parameterCount; param += 1) {
        const sparse = system.result?.correction[param]?.[0] ?? Number.NaN;
        const diff = Math.abs((measured.denseCorrection[param] ?? Number.NaN) - sparse);
        if (!Number.isFinite(diff)) {
          nonfinite = true;
          break;
        }
        worst = Math.max(worst, diff);
      }
      maxCorrectionDiff = nonfinite ? Number.POSITIVE_INFINITY : worst;
    }
    return {
      maxCorrectionDiff,
      damping: system.result.damping,
      conditionEstimate: measured.conditionEstimate,
      sparseConditionEstimate: system.result.conditionEstimate,
      parameterCount: system.parameterCount,
      observationEquationCount: system.observationEquationCount,
    };
  });

const shim = Object.assign(Object.create(globalThis) as {
  postMessage: (_message: unknown) => void;
  onmessage: ((_event: WorkerEvent) => void) | null;
}, {
  postMessage: (message: unknown) => parentPort?.postMessage(message),
  onmessage: null,
});

(globalThis as Record<string, unknown>).self = shim;

const worker = await import('../src/workers/adjustmentWorker.ts');
const wasmModule = (await import(
  pathToFileURL(path.join(process.cwd(), 'cpp/build-wasm/webnet_core.js')).href,
)) as unknown as { default: WebNetWasmFactory };
const bundle = await createExperimentalSparseNumericalBundle(wasmModule.default);

let current: {
  diagnostics: ExperimentalSparseRouteDiagnostics;
  capture: LocalCaptureSolver;
} | null = null;

worker.setAdjustmentWorkerRuntimeProvider(() => {
  const diagnostics = createExperimentalSparseRouteDiagnostics();
  const capture = new LocalCaptureSolver(bundle.sparseCorrectionSolver);
  current = { diagnostics, capture };
  return {
    sparseCorrectionSolver: capture,
    sparseRowProductsSolver: bundle.sparseRowProductsSolver,
    sparseSelectedCovarianceSolver: bundle.sparseSelectedCovarianceSolver,
    experimentalSparseDiagnostics: diagnostics,
    experimentalSelectedCovarianceMode: true,
    experimentalSelectedCovarianceLegacyAllPairs: true,
  };
});

const snapshotDiagnostics = () => {
  const diagnostics = current?.diagnostics;
  const capture = current?.capture;
  return {
    sparseCorrectionCalls: diagnostics?.sparseCorrectionCalls ?? 0,
    sparseCorrectionFallbacks: diagnostics?.sparseCorrectionFallbacks ?? 0,
    rowProductsCalls: diagnostics?.rowProductsCalls ?? 0,
    rowProductsFallbacks: diagnostics?.rowProductsFallbacks ?? 0,
    selectedCovarianceCalls: diagnostics?.selectedCovarianceCalls ?? 0,
    selectedCovarianceFallbacks: diagnostics?.selectedCovarianceFallbacks ?? 0,
    bundleInitialized: true,
    capturedSystemCount: capture?.systems.length ?? 0,
    truncated: capture?.truncated ?? false,
    oracles: summarizeSystems(capture?.systems ?? []),
  };
};

const rawPost = shim.postMessage;
shim.postMessage = (message: unknown) => {
  rawPost(message);
  const record = message as { type?: unknown; runId?: unknown };
  if (record?.type === 'success' && typeof record.runId === 'string') {
    parentPort?.postMessage({
      type: 'test-diagnostics',
      runId: record.runId,
      diagnostics: snapshotDiagnostics(),
    });
  }
};

parentPort?.on('message', (data: unknown) => {
  shim.onmessage?.({ data });
});
