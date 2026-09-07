/**
 * Production browser worker: delegates runs to the lazily imported
 * `runAdjustmentSession` through the shared testable handler. Dispatch:
 * injected worker-local runtime takes precedence and bypasses all
 * auto-routes; preanalysis requests go through the Phase 8A.7 production
 * preanalysis sparse route (enabled by default; disabling short-circuits to
 * TypeScript with no WASM init); adjustment requests go through the
 * existing Phase 7C automatic sparse route. The worker protocol is unchanged.
 */
import type { AdjustmentWorkerRequestMessage } from '../engine/adjustmentWorkerProtocol';
import type { runAdjustmentSession as RunAdjustmentSessionFn } from '../engine/runSession';
import { createAdjustmentWorkerHandler, type AdjustmentWorkerSessionFn } from './adjustmentWorkerHandler';
import { runWithSparseAutoRoute } from './adjustmentSparseAutoRoute';
import { runWithPreanalysisSparseAutoRoute } from './preanalysisSparseAutoRoute';
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
  loadSession: async (): Promise<AdjustmentWorkerSessionFn> => {
    const runSession = await loadRunAdjustmentSession();
    const routed: AdjustmentWorkerSessionFn = (payload, onProgress, runtime) => {
      if (runtime !== undefined) return runSession(payload, onProgress, runtime);
      if (payload.parseSettings?.runMode === 'preanalysis') {
        return runWithPreanalysisSparseAutoRoute(payload, onProgress, { runSession }).then(
          ({ outcome }) => outcome,
        );
      }
      return runWithSparseAutoRoute(payload, onProgress, { runSession }).then(
        ({ outcome }) => outcome,
      );
    };
    return routed;
  },
  postMessage: (message) => self.postMessage(message),
  getRuntime: getAdjustmentWorkerRuntime,
});

self.onmessage = (event: MessageEvent<AdjustmentWorkerRequestMessage>) => {
  handler.handleMessage(event.data);
};
