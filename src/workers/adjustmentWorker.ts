/**
 * Production browser worker: delegates runs to `runAdjustmentSession`
 * through the shared testable handler. Dispatch:
 * injected worker-local runtime takes precedence and bypasses all
 * auto-routes; preanalysis requests go through the Phase 8A.7 production
 * preanalysis sparse route (enabled by default; disabling short-circuits to
 * TypeScript with no WASM init); 3D adjustment requests go through the
 * Phase 10I native full-Qxx route (final covariance only, <=384 params,
 * fail-closed to TypeScript); other adjustment requests go through the
 * existing Phase 7C automatic sparse route. The worker protocol is unchanged.
 */
import type { AdjustmentWorkerRequestMessage } from '../engine/adjustmentWorkerProtocol';
import { runAdjustmentSession } from '../engine/runSession';
import { createAdjustmentWorkerHandler, type AdjustmentWorkerSessionFn } from './adjustmentWorkerHandler';
import { runWithNativeFullQxxAutoRoute } from './adjustmentNativeFullQxxAutoRoute';
import { runWithSparseAutoRoute } from './adjustmentSparseAutoRoute';
import { runWithPreanalysisSparseAutoRoute } from './preanalysisSparseAutoRoute';
import { getAdjustmentWorkerRuntime } from './adjustmentWorkerRuntime';

export { getAdjustmentWorkerRuntime, setAdjustmentWorkerRuntime } from './adjustmentWorkerRuntime';
export { setAdjustmentWorkerRuntimeProvider } from './adjustmentWorkerRuntime';

const handler = createAdjustmentWorkerHandler({
  loadSession: async (): Promise<AdjustmentWorkerSessionFn> => {
    const runSession = runAdjustmentSession;
    const routed: AdjustmentWorkerSessionFn = async (payload, onProgress, runtime) => {
      if (runtime !== undefined) return runSession(payload, onProgress, runtime);
      if (payload.parseSettings?.runMode === 'preanalysis') {
        return runWithPreanalysisSparseAutoRoute(payload, onProgress, { runSession }).then(
          ({ outcome }) => outcome,
        );
      }
      if (payload.parseSettings?.coordMode === '3D') {
        const native = await runWithNativeFullQxxAutoRoute(payload, onProgress, { runSession });
        return native.outcome;
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
