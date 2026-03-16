import type {
  AdjustmentWorkerRequestMessage,
  AdjustmentWorkerResponseMessage,
} from '../engine/adjustmentWorkerProtocol';
import { runAdjustmentSession } from '../engine/runSession';

const cancelledRunIds = new Set<string>();

const postWorkerMessage = (message: AdjustmentWorkerResponseMessage) => {
  self.postMessage(message);
};

self.onmessage = (event: MessageEvent<AdjustmentWorkerRequestMessage>) => {
  const message = event.data;
  if (!message) return;

  if (message.type === 'cancel') {
    cancelledRunIds.add(message.runId);
    postWorkerMessage({ type: 'cancelled', runId: message.runId });
    return;
  }

  const { runId, payload } = message;
  postWorkerMessage({ type: 'progress', runId, phase: 'queued' });

  setTimeout(() => {
    if (cancelledRunIds.has(runId)) return;
    try {
      postWorkerMessage({ type: 'progress', runId, phase: 'solving' });
      const outcome = runAdjustmentSession(payload);
      if (cancelledRunIds.has(runId)) return;
      postWorkerMessage({ type: 'progress', runId, phase: 'finalizing' });
      postWorkerMessage({ type: 'success', runId, payload: outcome });
    } catch (error) {
      if (cancelledRunIds.has(runId)) return;
      postWorkerMessage({
        type: 'failure',
        runId,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      cancelledRunIds.delete(runId);
    }
  }, 0);
};
