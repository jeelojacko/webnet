/**
 * Phase 8B production-worker bridge (TEST ONLY).
 *
 * Loads the exact production browser worker (`src/workers/adjustmentWorker.ts`)
 * inside a Node worker_threads worker and drives it through the REAL
 * production dispatch (`runWithPreanalysisSparseAutoRoute` /
 * `runWithSparseAutoRoute`). No injected worker-local runtime: the
 * production dispatch runs untouched. The ONLY test seam is the bundle
 * loader override, pointed at the ACTUAL cpp/build-wasm generated
 * JS/WASM bundle (never a fake), wrapped in counting delegates that
 * observe calls/results without changing them.
 *
 * Control via worker env (default everything OFF):
 * - PHASE8B_ROUTE=1: enable the preanalysis sparse auto-route kill switch.
 * - PHASE8B_WASM=1: install the real-WASM bundle loader. Without it the
 *   default loader throws in Node (no worker location) and the route
 *   falls back to TypeScript, proving the init-failure restart path.
 * - PHASE8B_WASM_FAIL=1: install a throwing loader (clean retry evidence).
 * - PHASE8B_HOOKS=<json>: test-only route hooks (unknownCountOverride,
 *   systemCapOverride, forceC2Failure, forcePhysicalFailure).
 *
 * After every success the bridge posts a `phase8b-diagnostics` message
 * with native call counters so the parent can prove which route ran.
 */
import { parentPort } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import type {
  SparseCorrectionSolveInput,
  SparseCorrectionSolveResult,
  SparseCorrectionSolver,
  SparseRowProductsInput,
  SparseRowProductsResult,
  SparseRowProductsSolver,
  SparseSelectedCovarianceInput,
  SparseSelectedCovarianceResult,
  SparseSelectedCovarianceSolver,
} from '../src/engine/numericalBackend';
import { createExperimentalSparseNumericalBundle } from '../src/engine/wasm/experimentalSparseNumericalBundle';
import type { WebNetWasmFactory } from '../src/engine/wasm/wasmTypes';
import { setSparseAutoRouteBundleLoader } from '../src/workers/adjustmentSparseAutoRoute';
import {
  clearPreanalysisSparseAutoRouteTestHooks,
  setPreanalysisSparseAutoRouteEnabled,
  setPreanalysisSparseAutoRouteTestHooks,
} from '../src/workers/preanalysisSparseAutoRoute';

type WorkerEvent = { data: unknown };

export interface Phase8bBridgeDiagnostics {
  bundleInitCount: number;
  realWasm: boolean;
  correctionCalls: number;
  correctionThrows: number;
  rowProductsCalls: number;
  rowProductsThrows: number;
  covarianceCalls: number;
  covarianceThrows: number;
  covarianceDamped: number;
}

const counters: Phase8bBridgeDiagnostics = {
  bundleInitCount: 0,
  realWasm: false,
  correctionCalls: 0,
  correctionThrows: 0,
  rowProductsCalls: 0,
  rowProductsThrows: 0,
  covarianceCalls: 0,
  covarianceThrows: 0,
  covarianceDamped: 0,
};

const shim = Object.assign(Object.create(globalThis) as {
  postMessage: (_message: unknown) => void;
  onmessage: ((_event: WorkerEvent) => void) | null;
}, {
  postMessage: (message: unknown) => parentPort?.postMessage(message),
  onmessage: null,
});

(globalThis as Record<string, unknown>).self = shim;

// Side-effect import: registers the production dispatch on the self shim.
await import('../src/workers/adjustmentWorker.ts');

const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
const routeEnabled = env?.PHASE8B_ROUTE === '1';
const useRealWasm = env?.PHASE8B_WASM === '1';
const failWasm = env?.PHASE8B_WASM_FAIL === '1';

setPreanalysisSparseAutoRouteEnabled(routeEnabled);
clearPreanalysisSparseAutoRouteTestHooks();
if (env?.PHASE8B_HOOKS) {
  setPreanalysisSparseAutoRouteTestHooks(
    JSON.parse(env.PHASE8B_HOOKS) as Parameters<typeof setPreanalysisSparseAutoRouteTestHooks>[0],
  );
}

if (failWasm) {
  setSparseAutoRouteBundleLoader(() => {
    counters.bundleInitCount += 1;
    return Promise.reject(new Error('phase8b injected WASM init failure (fail-closed)'));
  });
} else if (useRealWasm) {
  const wasmModule = (await import(
    pathToFileURL(path.join(process.cwd(), 'cpp/build-wasm/webnet_core.js')).href,
  )) as unknown as { default: WebNetWasmFactory };
  const real = await createExperimentalSparseNumericalBundle(wasmModule.default);
  counters.realWasm = true;
  const countingCorrection: SparseCorrectionSolver = {
    solveFromEquations: (input: SparseCorrectionSolveInput): SparseCorrectionSolveResult => {
      counters.correctionCalls += 1;
      try {
        return real.sparseCorrectionSolver.solveFromEquations(input);
      } catch (error) {
        counters.correctionThrows += 1;
        throw error;
      }
    },
  };
  const countingRowProducts: SparseRowProductsSolver = {
    queryRowProducts: (input: SparseRowProductsInput): SparseRowProductsResult => {
      counters.rowProductsCalls += 1;
      try {
        return real.sparseRowProductsSolver.queryRowProducts(input);
      } catch (error) {
        counters.rowProductsThrows += 1;
        throw error;
      }
    },
  };
  const countingCovariance: SparseSelectedCovarianceSolver = {
    querySelected: (input: SparseSelectedCovarianceInput): SparseSelectedCovarianceResult => {
      counters.covarianceCalls += 1;
      try {
        const result = real.sparseSelectedCovarianceSolver.querySelected(input);
        if (!Number.isFinite(result.damping) || result.damping !== 0) counters.covarianceDamped += 1;
        return result;
      } catch (error) {
        counters.covarianceThrows += 1;
        throw error;
      }
    },
  };
  // Worker-lifetime bundle cache: one real-WASM init serves every
  // session on this worker (mirrors the production cachedBundlePromise).
  let cachedBundle: Promise<{
    sparseCorrectionSolver: SparseCorrectionSolver;
    sparseRowProductsSolver: SparseRowProductsSolver;
    sparseSelectedCovarianceSolver: SparseSelectedCovarianceSolver;
  }> | null = null;
  setSparseAutoRouteBundleLoader(() => {
    cachedBundle ??= (() => {
      counters.bundleInitCount += 1;
      return Promise.resolve({
        sparseCorrectionSolver: countingCorrection,
        sparseRowProductsSolver: countingRowProducts,
        sparseSelectedCovarianceSolver: countingCovariance,
      });
    })();
    return cachedBundle;
  });
}

const rawPost = shim.postMessage;
shim.postMessage = (message: unknown) => {
  rawPost(message);
  const record = message as { type?: unknown; runId?: unknown };
  if (record?.type === 'success' && typeof record.runId === 'string') {
    parentPort?.postMessage({
      type: 'phase8b-diagnostics',
      runId: record.runId,
      diagnostics: { ...counters },
    });
  }
};

parentPort?.on('message', (data: unknown) => {
  shim.onmessage?.({ data });
});
