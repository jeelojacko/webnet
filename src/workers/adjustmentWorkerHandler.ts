/**
 * Phase 7B testable adjustment-worker message handler.
 *
 * Extracts the worker's run/cancel protocol (queued -> solving ->
 * finalizing -> success/failure/cancelled) from the `self` global so unit
 * tests can drive init failure, cancellation, and failure-reset semantics
 * without spawning a real worker. Production `adjustmentWorker.ts` wires
 * this handler to the live lazy import plus the worker-local runtime
 * provider; the request protocol is unchanged.
 */
import type { AdjustmentRuntime } from '../engine/adjustmentRuntime';
import type {
  AdjustmentWorkerRequestMessage,
  AdjustmentWorkerResponseMessage,
  RunPhase,
} from '../engine/adjustmentWorkerProtocol';
import type {
  RunSessionOutcome,
  RunSessionProgressCallback,
  RunSessionRequest,
} from '../engine/runSession';

export type AdjustmentWorkerSessionFn = (
  _request: RunSessionRequest,
  _onProgress?: RunSessionProgressCallback,
  _runtime?: AdjustmentRuntime,
) => RunSessionOutcome | Promise<RunSessionOutcome>;

export interface AdjustmentWorkerHandlerDeps {
  loadSession: () => Promise<AdjustmentWorkerSessionFn>;
  postMessage: (_message: AdjustmentWorkerResponseMessage) => void;
  getRuntime?: () => AdjustmentRuntime | undefined;
  defer?: (_callback: () => void) => void;
}

export interface AdjustmentWorkerHandler {
  handleMessage: (_message: AdjustmentWorkerRequestMessage) => void;
  resetForTests: () => void;
}

const postProgress = (
  postMessage: (_message: AdjustmentWorkerResponseMessage) => void,
  runId: string,
  phase: RunPhase,
): void => {
  postMessage({ type: 'progress', runId, phase });
};

export const createAdjustmentWorkerHandler = (
  deps: AdjustmentWorkerHandlerDeps,
): AdjustmentWorkerHandler => {
  const cancelledRequestIds = new Set<string>();
  const defer = deps.defer ?? ((callback) => setTimeout(callback, 0));

  const handleRun = (runId: string, payload: RunSessionRequest): void => {
    deps.postMessage({ type: 'progress', runId, phase: 'queued' });
    defer(() => {
      if (cancelledRequestIds.has(runId)) return;
      try {
        postProgress(deps.postMessage, runId, 'solving');
        void deps
          .loadSession()
          .then((runAdjustmentSession) => {
            const progressCallback: RunSessionProgressCallback = (progress) => {
              if (cancelledRequestIds.has(runId)) return;
              deps.postMessage({
                type: 'progress',
                runId,
                phase: progress.phase,
                elapsedMs: progress.elapsedMs,
                stageLabel: progress.stageLabel,
                solveIndex: progress.solveIndex,
                solveTotalHint: progress.solveTotalHint,
                iteration: progress.iteration,
                maxIterations: progress.maxIterations,
              });
            };
            // Phase 7C: the session function may synchronously return an
            // outcome or asynchronously resolve one (sparse auto-route with
            // a clean TypeScript rerun on any sparse failure). Awaiting here
            // keeps the run/finalizing/success protocol unchanged.
            return Promise.resolve()
              .then(() => runAdjustmentSession(payload, progressCallback, deps.getRuntime?.()))
              .then((outcome) => {
                if (cancelledRequestIds.has(runId)) return;
                postProgress(deps.postMessage, runId, 'finalizing');
                deps.postMessage({ type: 'success', runId, payload: outcome });
              });
          })
          .catch((error) => {
            if (cancelledRequestIds.has(runId)) return;
            deps.postMessage({
              type: 'failure',
              runId,
              error: error instanceof Error ? error.message : String(error),
            });
          })
          .finally(() => {
            cancelledRequestIds.delete(runId);
          });
      } catch (error) {
        if (cancelledRequestIds.has(runId)) return;
        deps.postMessage({
          type: 'failure',
          runId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
  };

  return {
    handleMessage: (message: AdjustmentWorkerRequestMessage): void => {
      if (!message) return;
      if (message.type === 'cancel') {
        cancelledRequestIds.add(message.runId);
        deps.postMessage({ type: 'cancelled', runId: message.runId });
        return;
      }
      if (message.type === 'run') {
        handleRun(message.runId, message.payload);
      }
    },
    resetForTests: (): void => {
      cancelledRequestIds.clear();
    },
  };
};
