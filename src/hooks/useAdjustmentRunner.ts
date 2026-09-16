import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AdjustmentWorkerRequestMessage,
  AdjustmentWorkerResponseMessage,
  RunPhase,
} from '../engine/adjustmentWorkerProtocol';
import { isAdjustmentWorkerResponseMessage } from '../engine/adjustmentWorkerProtocol';
import {
  runAdjustmentSession,
  type RunSessionOutcome,
  type RunSessionRequest,
} from '../engine/runSession';
import { createStableRuntimeId } from '../engine/id';
import { beginUiPerfRun, noteUiPerfStage } from './useUiPerfMonitor';

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

/** Rejection reason for a run that was superseded by a newer run. Not a failure. */
export const RUN_SUPERSEDED_REASON = 'Run superseded';
export const RUN_CANCELLED_REASON = 'Run cancelled';

type PendingRun = {
  cancelled: boolean;
  settled: boolean;
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

const idlePipeline = (workerBacked: boolean): RunPipelineState => ({
  ...INITIAL_STATE,
  workerBacked,
});

const cancelledPipeline = (workerBacked: boolean): RunPipelineState => ({
  ...INITIAL_STATE,
  status: 'cancelled',
  workerBacked,
});

export const useAdjustmentRunner = (
  directRunner?: (_request: RunSessionRequest) => RunSessionOutcome,
) => {
  const [pipelineState, setPipelineState] = useState<RunPipelineState>(INITIAL_STATE);
  const workerRef = useRef<Worker | null>(null);
  const pendingRunsRef = useRef(new Map<string, PendingRun>());
  // Authoritative generation: the latest started run. Only this run may
  // publish pipeline transitions or resolve an outcome to the workflow.
  // Checked synchronously via ref so stale async callbacks can never win.
  const latestRunIdRef = useRef<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const isCurrentRun = useCallback((runId: string) => latestRunIdRef.current === runId, []);

  // Settle a stale run exactly once without touching shared pipeline state
  // and without clearing a newer latest run.
  const settleStale = useCallback((runId: string) => {
    const pending = pendingRunsRef.current.get(runId);
    if (pending && !pending.settled) {
      pending.settled = true;
      pendingRunsRef.current.delete(runId);
      pending.reject(new Error(RUN_SUPERSEDED_REASON));
    } else {
      pendingRunsRef.current.delete(runId);
    }
  }, []);

  useEffect(() => {
    if (typeof Worker === 'undefined') return undefined;
    const worker = new Worker(new URL('../workers/adjustmentWorker.ts', import.meta.url), {
      type: 'module',
    });
    workerRef.current = worker;

    const handleMessage = (event: MessageEvent<AdjustmentWorkerResponseMessage>) => {
      const message = event.data;
      if (!isAdjustmentWorkerResponseMessage(message)) return;
      if (!('runId' in message)) return;
      const runId = message.runId as string;
      const pending = pendingRunsRef.current.get(runId);
      if (!pending || pending.settled) return;
      // Stale runs never publish: drop progress/state/outcome silently.
      if (latestRunIdRef.current !== runId) {
        settleStale(runId);
        return;
      }

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

      // Terminal messages settle exactly once and clear generation only
      // when they are still the latest run.
      const clearGeneration = () => {
        if (latestRunIdRef.current === runId) latestRunIdRef.current = null;
      };

      if (message.type === 'success') {
        noteUiPerfStage('workerSuccessReceived');
        pending.settled = true;
        pendingRunsRef.current.delete(runId);
        if (pending.cancelled) {
          clearGeneration();
          setPipelineState(cancelledPipeline(true));
          pending.reject(new Error(RUN_CANCELLED_REASON));
          return;
        }
        clearGeneration();
        setPipelineState(idlePipeline(true));
        pending.resolve(message.payload);
        return;
      }

      if (message.type === 'cancelled') {
        pending.settled = true;
        pendingRunsRef.current.delete(runId);
        clearGeneration();
        setPipelineState(cancelledPipeline(true));
        pending.reject(new Error(RUN_CANCELLED_REASON));
        return;
      }

      if (message.type !== 'failure' && message.type !== 'gnss-failure') return;
      pending.settled = true;
      pendingRunsRef.current.delete(runId);
      // Cancellation wins over any terminal failure type: a cancelled run
      // never reports failed.
      if (pending.cancelled) {
        clearGeneration();
        setPipelineState(cancelledPipeline(true));
        pending.reject(new Error(RUN_CANCELLED_REASON));
        return;
      }
      clearGeneration();
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
  }, [settleStale]);

  // Reject leftovers on unmount so no promise leaks; no state updates here.
  useEffect(() => {
    const pending = pendingRunsRef.current;
    return () => {
      for (const [, entry] of pending) {
        if (!entry.settled) {
          entry.settled = true;
          entry.reject(new Error(RUN_CANCELLED_REASON));
        }
      }
      pending.clear();
      latestRunIdRef.current = null;
    };
  }, []);

  const run = useCallback(
    (request: RunSessionRequest) => {
      const runId = createStableRuntimeId('run');
      beginUiPerfRun();
      // Publish generation synchronously so any late callback from an
      // older run is stale from this point on.
      latestRunIdRef.current = runId;
      // Eagerly supersede older pendings: they settle as superseded now
      // and can never resolve an outcome the workflow would apply.
      for (const [id] of pendingRunsRef.current) {
        if (id !== runId) settleStale(id);
      }
      const workerBacked = workerRef.current != null;
      setPipelineState({
        status: 'running',
        runId,
        phase: 'queued',
        error: null,
        workerBacked,
        elapsedMs: null,
        detail: null,
        solveIndex: null,
        solveTotalHint: null,
        iteration: null,
        maxIterations: null,
      });
      return new Promise<RunSessionOutcome>((resolve, reject) => {
        const settleResolve = (value: RunSessionOutcome) => {
          const pending = pendingRunsRef.current.get(runId);
          if (pending && !pending.settled) {
            pending.settled = true;
            pendingRunsRef.current.delete(runId);
          } else {
            pendingRunsRef.current.delete(runId);
          }
          resolve(value);
        };
        const settleReject = (reason?: unknown) => {
          const pending = pendingRunsRef.current.get(runId);
          if (pending && !pending.settled) {
            pending.settled = true;
            pendingRunsRef.current.delete(runId);
          } else {
            pendingRunsRef.current.delete(runId);
          }
          reject(reason);
        };
        pendingRunsRef.current.set(runId, {
          cancelled: false,
          settled: false,
          resolve: settleResolve,
          reject: settleReject,
        });
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
          if (!mountedRef.current) {
            settleStale(runId);
            return;
          }
          // Superseded before the direct run even started: never publish.
          if (latestRunIdRef.current !== runId) {
            settleStale(runId);
            return;
          }
          const pending = pendingRunsRef.current.get(runId);
          if (!pending || pending.settled) return;
          if (pending.cancelled) {
            pending.settled = true;
            pendingRunsRef.current.delete(runId);
            if (latestRunIdRef.current === runId) latestRunIdRef.current = null;
            setPipelineState(cancelledPipeline(false));
            settleReject(new Error(RUN_CANCELLED_REASON));
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
            if (!mountedRef.current) {
              settleStale(runId);
              return;
            }
            // Re-check generation after the synchronous solve: a newer run
            // or cancel started during the solve wins.
            if (latestRunIdRef.current !== runId) {
              settleStale(runId);
              return;
            }
            const latest = pendingRunsRef.current.get(runId);
            if (!latest || latest.settled || latest.cancelled) {
              if (latest && !latest.settled) {
                latest.settled = true;
                pendingRunsRef.current.delete(runId);
              } else {
                pendingRunsRef.current.delete(runId);
              }
              if (latestRunIdRef.current === runId) latestRunIdRef.current = null;
              setPipelineState(cancelledPipeline(false));
              settleReject(new Error(RUN_CANCELLED_REASON));
              return;
            }
            latest.settled = true;
            pendingRunsRef.current.delete(runId);
            if (latestRunIdRef.current === runId) latestRunIdRef.current = null;
            setPipelineState(idlePipeline(false));
            settleResolve(outcome);
          } catch (error) {
            if (latestRunIdRef.current !== runId) {
              settleStale(runId);
              return;
            }
            const latest = pendingRunsRef.current.get(runId);
            if (latest && !latest.settled && latest.cancelled) {
              latest.settled = true;
              pendingRunsRef.current.delete(runId);
              if (latestRunIdRef.current === runId) latestRunIdRef.current = null;
              setPipelineState(cancelledPipeline(false));
              settleReject(new Error(RUN_CANCELLED_REASON));
              return;
            }
            if (latest && !latest.settled) {
              latest.settled = true;
              pendingRunsRef.current.delete(runId);
            } else {
              pendingRunsRef.current.delete(runId);
            }
            if (latestRunIdRef.current === runId) latestRunIdRef.current = null;
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
            settleReject(new Error(message));
          }
        }, 0);
      });
    },
    [directRunner, settleStale],
  );

  const cancel = useCallback(() => {
    // Target exactly the latest run via ref (never a stale closure).
    const activeRunId = latestRunIdRef.current;
    if (!activeRunId) return;
    const pending = pendingRunsRef.current.get(activeRunId);
    if (pending && !pending.settled) pending.cancelled = true;
    if (workerRef.current) {
      const message: AdjustmentWorkerRequestMessage = {
        type: 'cancel',
        runId: activeRunId,
      };
      workerRef.current.postMessage(message);
      return;
    }
    setPipelineState(cancelledPipeline(false));
  }, []);

  return { pipelineState, run, cancel, isCurrentRun, RUN_SUPERSEDED_REASON };
};
