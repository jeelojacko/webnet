/**
 * Test-only bridge that genuinely loads the production browser worker
 * module (`src/workers/adjustmentWorker.ts`) inside a Node worker_threads
 * worker. The only shim is the browser `self` global (postMessage routed
 * to parentPort, onmessage fed from parentPort). No production code is
 * touched; the worker source is imported unmodified, including its lazy
 * `import('../engine/runSession')` delegation.
 */
import { parentPort } from 'node:worker_threads';

type WorkerEvent = { data: unknown };

const shim: {
  postMessage: (_message: unknown) => void;
  onmessage: ((_event: WorkerEvent) => void) | null;
} = {
  postMessage: (message: unknown) => parentPort?.postMessage(message),
  onmessage: null,
};

(globalThis as Record<string, unknown>).self = shim;

await import('../src/workers/adjustmentWorker.ts');

parentPort?.on('message', (data: unknown) => {
  shim.onmessage?.({ data });
});
