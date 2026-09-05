/**
 * Phase 7B test-only bridge: genuinely loads the production browser worker
 * module (`src/workers/adjustmentWorker.ts`) inside a Node worker_threads
 * worker, then injects a worker-local sparse runtime via the exported
 * test-only provider seam (no protocol or `RunSessionRequest` changes).
 *
 * After each success, the bridge forwards a test-only diagnostics snapshot
 * (`{ type: 'test-diagnostics', ... }`) so the parent test can assert the
 * actual worker executed the real sparse WASM correction, row products, and
 * selected covariance routes.
 */
import { parentPort } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { createExperimentalSparseRouteDiagnostics } from '../src/engine/experimentalSparseDiagnostics';
import { createExperimentalSparseNumericalBundle } from '../src/engine/wasm/experimentalSparseNumericalBundle';
import type { WebNetWasmFactory } from '../src/engine/wasm/wasmTypes';

type WorkerEvent = { data: unknown };

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
const diagnostics = createExperimentalSparseRouteDiagnostics();

worker.setAdjustmentWorkerRuntimeProvider(() => ({
  sparseCorrectionSolver: bundle.sparseCorrectionSolver,
  sparseRowProductsSolver: bundle.sparseRowProductsSolver,
  sparseSelectedCovarianceSolver: bundle.sparseSelectedCovarianceSolver,
  experimentalSparseDiagnostics: diagnostics,
  experimentalSelectedCovarianceMode: true,
  experimentalSelectedCovarianceLegacyAllPairs: true,
}));

const snapshotDiagnostics = () => ({
  sparseCorrectionCalls: diagnostics.sparseCorrectionCalls,
  sparseCorrectionFallbacks: diagnostics.sparseCorrectionFallbacks,
  rowProductsCalls: diagnostics.rowProductsCalls,
  rowProductsFallbacks: diagnostics.rowProductsFallbacks,
  selectedCovarianceCalls: diagnostics.selectedCovarianceCalls,
  selectedCovarianceFallbacks: diagnostics.selectedCovarianceFallbacks,
  bundleInitialized: true,
});

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
