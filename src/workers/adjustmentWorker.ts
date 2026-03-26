import type {
  AdjustmentWorkerRequestMessage,
  AdjustmentWorkerResponseMessage,
} from '../engine/adjustmentWorkerProtocol';
import { buildExportArtifacts } from '../engine/exportArtifacts';
import { runAdjustmentSession } from '../engine/runSession';

const cancelledRequestIds = new Set<string>();

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
      } catch (error) {
        if (cancelledRequestIds.has(runId)) return;
        postWorkerMessage({
          type: 'failure',
          runId,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        cancelledRequestIds.delete(runId);
      }
    }, 0);
    return;
  }

  const { taskId, payload } = message;
  postWorkerMessage({ type: 'artifact-progress', taskId, phase: 'queued' });
  setTimeout(() => {
    if (cancelledRequestIds.has(taskId)) return;
    try {
      postWorkerMessage({ type: 'artifact-progress', taskId, phase: 'building' });
      const outcome = buildExportArtifacts(payload);
      if (cancelledRequestIds.has(taskId)) return;
      postWorkerMessage({ type: 'artifact-progress', taskId, phase: 'finalizing' });
      postWorkerMessage({ type: 'artifact-success', taskId, payload: outcome });
    } catch (error) {
      if (cancelledRequestIds.has(taskId)) return;
      postWorkerMessage({
        type: 'artifact-failure',
        taskId,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      cancelledRequestIds.delete(taskId);
    }
  }, 0);
};
