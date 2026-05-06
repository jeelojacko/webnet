import type {
  AdjustmentWorkerRequestMessage,
  AdjustmentWorkerResponseMessage,
} from '../engine/adjustmentWorkerProtocol';
import type { runAdjustmentSession as RunAdjustmentSessionFn } from '../engine/runSession';

const cancelledRequestIds = new Set<string>();
let runAdjustmentSessionPromise: Promise<typeof RunAdjustmentSessionFn> | null = null;

const loadRunAdjustmentSession = (): Promise<typeof RunAdjustmentSessionFn> => {
  if (!runAdjustmentSessionPromise) {
    runAdjustmentSessionPromise = import('../engine/runSession').then(
      (module) => module.runAdjustmentSession,
    );
  }
  return runAdjustmentSessionPromise;
};

const postWorkerMessage = (message: AdjustmentWorkerResponseMessage) => {
  self.postMessage(message);
};

self.onmessage = (event: MessageEvent<AdjustmentWorkerRequestMessage>) => {
  const message = event.data;
  if (!message) return;

  if (message.type === 'cancel') {
    cancelledRequestIds.add(message.runId);
    postWorkerMessage({ type: 'cancelled', runId: message.runId });
    return;
  }

  if (message.type === 'run') {
    const { runId, payload } = message;
    postWorkerMessage({ type: 'progress', runId, phase: 'queued' });

    setTimeout(() => {
      if (cancelledRequestIds.has(runId)) return;
      try {
        postWorkerMessage({ type: 'progress', runId, phase: 'solving' });
        void loadRunAdjustmentSession()
          .then((runAdjustmentSession) => {
            const outcome = runAdjustmentSession(payload, (progress) => {
              if (cancelledRequestIds.has(runId)) return;
              postWorkerMessage({
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
            });
            if (cancelledRequestIds.has(runId)) return;
            postWorkerMessage({ type: 'progress', runId, phase: 'finalizing' });
            postWorkerMessage({ type: 'success', runId, payload: outcome });
          })
          .catch((error) => {
            if (cancelledRequestIds.has(runId)) return;
            postWorkerMessage({
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
        postWorkerMessage({
          type: 'failure',
          runId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }, 0);
    return;
  }
};
