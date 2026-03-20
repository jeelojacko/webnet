import { useCallback, useEffect, useRef } from 'react';
import type {
  AdjustmentWorkerRequestMessage,
  AdjustmentWorkerResponseMessage,
} from '../engine/adjustmentWorkerProtocol';
import {
  buildExportArtifacts,
  type BuildExportArtifactsRequest,
  type BuildExportArtifactsResult,
} from '../engine/exportArtifacts';

type PendingArtifactRequest = {
  resolve: (_value: BuildExportArtifactsResult) => void;
  reject: (_reason?: unknown) => void;
};

export const useArtifactBuilder = (
  directBuilder: (
    _request: BuildExportArtifactsRequest,
  ) => BuildExportArtifactsResult = buildExportArtifacts,
) => {
  const workerRef = useRef<Worker | null>(null);
  const pendingRequestsRef = useRef(new Map<string, PendingArtifactRequest>());

  useEffect(() => {
    if (typeof Worker === 'undefined') return undefined;
    const worker = new Worker(new URL('../workers/adjustmentWorker.ts', import.meta.url), {
      type: 'module',
    });
    workerRef.current = worker;

    const handleMessage = (event: MessageEvent<AdjustmentWorkerResponseMessage>) => {
      const message = event.data;
      if (!message || !('taskId' in message)) return;
      const pending = pendingRequestsRef.current.get(message.taskId);
      if (!pending) return;
      if (message.type === 'artifact-progress') {
        return;
      }
      pendingRequestsRef.current.delete(message.taskId);
      if (message.type === 'artifact-success') {
        pending.resolve(message.payload);
        return;
      }
      pending.reject(new Error(message.error));
    };

    worker.addEventListener('message', handleMessage);
    return () => {
      worker.removeEventListener('message', handleMessage);
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  const buildArtifacts = useCallback(
    (request: BuildExportArtifactsRequest) => {
      const taskId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      return new Promise<BuildExportArtifactsResult>((resolve, reject) => {
        pendingRequestsRef.current.set(taskId, { resolve, reject });
        if (workerRef.current) {
          const message: AdjustmentWorkerRequestMessage = {
            type: 'artifact',
            taskId,
            payload: request,
          };
          workerRef.current.postMessage(message);
          return;
        }

        setTimeout(() => {
          try {
            const latest = pendingRequestsRef.current.get(taskId);
            pendingRequestsRef.current.delete(taskId);
            if (!latest) {
              reject(new Error('Artifact build cancelled'));
              return;
            }
            resolve(directBuilder(request));
          } catch (error) {
            pendingRequestsRef.current.delete(taskId);
            reject(error);
          }
        }, 0);
      });
    },
    [directBuilder],
  );

  return {
    buildArtifacts,
  };
};
