import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AdjustmentWorkerRequestMessage,
  AdjustmentWorkerResponseMessage,
  RunPhase,
} from '../engine/adjustmentWorkerProtocol';
import {
  runAdjustmentSession,
  type RunSessionOutcome,
  type RunSessionRequest,
} from '../engine/runSession';

export interface RunPipelineState {
  status: 'idle' | 'running' | 'cancelled' | 'failed';
  runId: string | null;
  phase: RunPhase | null;
  error: string | null;
  workerBacked: boolean;
  elapsedMs: number | null;
  detail: string | null;
  solveIndex: number | null;
  solveTotalHint: number | null;
  iteration: number | null;
  maxIterations: number | null;
}

type PendingRun = {
  cancelled: boolean;
  resolve: (_value: RunSessionOutcome) => void;
  reject: (_reason?: unknown) => void;
};

const INITIAL_STATE: RunPipelineState = {
  status: 'idle',
  runId: null,
  phase: null,
  error: null,
  workerBacked: false,
  elapsedMs: null,
  detail: null,
  solveIndex: null,
  solveTotalHint: null,
  iteration: null,
  maxIterations: null,
};

export const useAdjustmentRunner = (
  directRunner?: (_request: RunSessionRequest) => RunSessionOutcome,
) => {
  const [pipelineState, setPipelineState] = useState<RunPipelineState>(INITIAL_STATE);
  const workerRef = useRef<Worker | null>(null);
  const pendingRunsRef = useRef(new Map<string, PendingRun>());

  useEffect(() => {
    if (typeof Worker === 'undefined') return undefined;
    const worker = new Worker(new URL('../workers/adjustmentWorker.ts', import.meta.url), {
      type: 'module',
    });
    workerRef.current = worker;

    const handleMessage = (event: MessageEvent<AdjustmentWorkerResponseMessage>) => {
      const message = event.data;
      if (!message) return;
      if (!('runId' in message)) return;
      const pending = pendingRunsRef.current.get(message.runId);
      if (!pending) return;

      if (message.type === 'progress') {
        setPipelineState({
          status: 'running',
          runId: message.runId,
          phase: message.phase,
          error: null,
          workerBacked: true,
          elapsedMs: message.elapsedMs ?? null,
          detail: message.stageLabel ?? null,
          solveIndex: message.solveIndex ?? null,
          solveTotalHint: message.solveTotalHint ?? null,
          iteration: message.iteration ?? null,
          maxIterations: message.maxIterations ?? null,
        });
        return;
      }

      pendingRunsRef.current.delete(message.runId);

      if (message.type === 'success') {
        setPipelineState({
          status: 'idle',
          runId: null,
          phase: null,
          error: null,
          workerBacked: true,
          elapsedMs: null,
          detail: null,
          solveIndex: null,
          solveTotalHint: null,
          iteration: null,
          maxIterations: null,
        });
        pending.resolve(message.payload);
        return;
      }

      if (message.type === 'cancelled') {
        setPipelineState({
          status: 'cancelled',
          runId: null,
          phase: null,
          error: null,
          workerBacked: true,
          elapsedMs: null,
          detail: null,
          solveIndex: null,
          solveTotalHint: null,
          iteration: null,
          maxIterations: null,
        });
        pending.reject(new Error('Run cancelled'));
        return;
      }

      setPipelineState({
        status: 'failed',
        runId: null,
        phase: null,
        error: message.error,
        workerBacked: true,
        elapsedMs: null,
        detail: null,
        solveIndex: null,
        solveTotalHint: null,
        iteration: null,
        maxIterations: null,
      });
      pending.reject(new Error(message.error));
    };

    worker.addEventListener('message', handleMessage);
    return () => {
      worker.removeEventListener('message', handleMessage);
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  const run = useCallback(
    (request: RunSessionRequest) => {
      const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      setPipelineState({
        status: 'running',
        runId,
        phase: 'queued',
        error: null,
        workerBacked: workerRef.current != null,
        elapsedMs: null,
        detail: null,
        solveIndex: null,
        solveTotalHint: null,
        iteration: null,
        maxIterations: null,
      });
      return new Promise<RunSessionOutcome>((resolve, reject) => {
        pendingRunsRef.current.set(runId, { cancelled: false, resolve, reject });
        if (workerRef.current) {
          const message: AdjustmentWorkerRequestMessage = {
            type: 'run',
            runId,
            payload: request,
          };
          workerRef.current.postMessage(message);
          return;
        }

        setTimeout(() => {
          const pending = pendingRunsRef.current.get(runId);
          if (!pending || pending.cancelled) {
            pendingRunsRef.current.delete(runId);
            setPipelineState({
              status: 'cancelled',
              runId: null,
              phase: null,
              error: null,
              workerBacked: false,
              elapsedMs: null,
              detail: null,
              solveIndex: null,
              solveTotalHint: null,
              iteration: null,
              maxIterations: null,
            });
            reject(new Error('Run cancelled'));
            return;
          }
          try {
            setPipelineState({
              status: 'running',
              runId,
              phase: 'solving',
              error: null,
              workerBacked: false,
              elapsedMs: null,
              detail: null,
              solveIndex: null,
              solveTotalHint: null,
              iteration: null,
              maxIterations: null,
            });
            const outcome = (directRunner ?? runAdjustmentSession)(request);
            const latest = pendingRunsRef.current.get(runId);
            pendingRunsRef.current.delete(runId);
            if (!latest || latest.cancelled) {
              setPipelineState({
                status: 'cancelled',
                runId: null,
                phase: null,
                error: null,
                workerBacked: false,
                elapsedMs: null,
                detail: null,
                solveIndex: null,
                solveTotalHint: null,
                iteration: null,
                maxIterations: null,
              });
              reject(new Error('Run cancelled'));
              return;
            }
            setPipelineState({
              status: 'idle',
              runId: null,
              phase: null,
              error: null,
              workerBacked: false,
              elapsedMs: null,
              detail: null,
              solveIndex: null,
              solveTotalHint: null,
              iteration: null,
              maxIterations: null,
            });
            resolve(outcome);
          } catch (error) {
            pendingRunsRef.current.delete(runId);
            const message = error instanceof Error ? error.message : String(error);
            setPipelineState({
              status: 'failed',
              runId: null,
              phase: null,
              error: message,
              workerBacked: false,
              elapsedMs: null,
              detail: null,
              solveIndex: null,
              solveTotalHint: null,
              iteration: null,
              maxIterations: null,
            });
            reject(new Error(message));
          }
        }, 0);
      });
    },
    [directRunner],
  );

  const cancel = useCallback(() => {
    const activeRunId = pipelineState.runId;
    if (!activeRunId) return;
    const pending = pendingRunsRef.current.get(activeRunId);
    if (pending) pending.cancelled = true;
    if (workerRef.current) {
      const message: AdjustmentWorkerRequestMessage = {
        type: 'cancel',
        runId: activeRunId,
      };
      workerRef.current.postMessage(message);
      return;
    }
    pendingRunsRef.current.delete(activeRunId);
    setPipelineState({
      status: 'cancelled',
      runId: null,
      phase: null,
      error: null,
      workerBacked: false,
      elapsedMs: null,
      detail: null,
      solveIndex: null,
      solveTotalHint: null,
      iteration: null,
      maxIterations: null,
    });
  }, [pipelineState.runId]);

  return { pipelineState, run, cancel };
};
