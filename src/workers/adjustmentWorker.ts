/**
 * Production browser worker: delegates runs to the lazily imported
 * `runAdjustmentSession` through the shared testable handler. The only
 * worker-local addition is the Phase 7B runtime provider (default
 * undefined — exact legacy behavior, no protocol or routing changes).
 */
import type { AdjustmentWorkerRequestMessage } from '../engine/adjustmentWorkerProtocol';
import type { runAdjustmentSession as RunAdjustmentSessionFn } from '../engine/runSession';
import { createAdjustmentWorkerHandler } from './adjustmentWorkerHandler';
import { getAdjustmentWorkerRuntime } from './adjustmentWorkerRuntime';

export { getAdjustmentWorkerRuntime, setAdjustmentWorkerRuntime } from './adjustmentWorkerRuntime';
export { setAdjustmentWorkerRuntimeProvider } from './adjustmentWorkerRuntime';

let runAdjustmentSessionPromise: Promise<typeof RunAdjustmentSessionFn> | null = null;

const loadRunAdjustmentSession = (): Promise<typeof RunAdjustmentSessionFn> => {
  if (!runAdjustmentSessionPromise) {
    runAdjustmentSessionPromise = import('../engine/runSession').then(
      (module) => module.runAdjustmentSession,
    );
  }
  return runAdjustmentSessionPromise;
};

const handler = createAdjustmentWorkerHandler({
  loadSession: loadRunAdjustmentSession,
  postMessage: (message) => self.postMessage(message),
  getRuntime: getAdjustmentWorkerRuntime,
});

self.onmessage = (event: MessageEvent<AdjustmentWorkerRequestMessage>) => {
  handler.handleMessage(event.data);
};
