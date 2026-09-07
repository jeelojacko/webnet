/**
 * Phase 8A.5 evidence-test worker helpers (TEST/EVIDENCE ONLY).
 *
 * Shared actual-worker run plumbing for the Phase 8A.5 safety calibration
 * test: single-run collection through the existing Phase 8A bridge plus
 * small deterministic formatting helpers. No production imports.
 */
import path from 'node:path';
import { Worker } from 'node:worker_threads';

import {
  isAdjustmentWorkerResponseMessage,
  type AdjustmentWorkerRequestMessage,
  type AdjustmentWorkerResponseMessage,
} from '../../src/engine/adjustmentWorkerProtocol';
import type { RunSessionOutcome, RunSessionRequest } from '../../src/engine/runSession';

export const PHASE8A5_BRIDGE_PATH = path.join(
  process.cwd(),
  'scripts/phase8aPreanalysisWorkerBridge.ts',
);

export interface Phase8a5WorkerDiagnostics {
  sparseCorrectionCalls: number;
  sparseCorrectionFallbacks: number;
  rowProductsCalls: number;
  rowProductsFallbacks: number;
  selectedCovarianceCalls: number;
  selectedCovarianceFallbacks: number;
  bundleInitialized: boolean;
  capturedSystemCount: number;
  truncated: boolean;
  oracles: Array<{
    maxCorrectionDiff: number | null;
    damping: number | null;
    conditionEstimate: number | undefined;
    sparseConditionEstimate: number | undefined;
    parameterCount: number;
    observationEquationCount: number;
  }>;
}

/** Sends one RunRequestMessage to a fresh actual worker and collects until settled. */
export const runPhase8a5WorkerOnce = (
  request: AdjustmentWorkerRequestMessage,
  timeoutMs = 240000,
): Promise<{ messages: AdjustmentWorkerResponseMessage[]; diagnostics: Phase8a5WorkerDiagnostics }> =>
  new Promise((resolve, reject) => {
    const messages: AdjustmentWorkerResponseMessage[] = [];
    let diagnostics: Phase8a5WorkerDiagnostics | null = null;
    let worker: Worker;
    try {
      worker = new Worker(PHASE8A5_BRIDGE_PATH, { execArgv: ['--import', 'tsx'] });
    } catch (error) {
      reject(error);
      return;
    }
    const timer = setTimeout(() => {
      void worker.terminate();
      reject(new Error(`worker did not settle within ${timeoutMs} ms`));
    }, timeoutMs);
    worker.on('message', (message: unknown) => {
      const record = message as { type?: unknown; runId?: unknown };
      if (record?.type === 'test-diagnostics') {
        diagnostics = (record as { diagnostics: Phase8a5WorkerDiagnostics }).diagnostics;
        if (messages.some((m) => m.type === 'success' || m.type === 'failure')) {
          clearTimeout(timer);
          void worker.terminate();
          resolve({ messages, diagnostics: diagnostics as Phase8a5WorkerDiagnostics });
        }
        return;
      }
      if (!isAdjustmentWorkerResponseMessage(message)) {
        clearTimeout(timer);
        void worker.terminate();
        reject(new Error('worker emitted a message outside the protocol guard'));
        return;
      }
      messages.push(message);
      if (message.type === 'success' || message.type === 'failure') {
        if (message.type === 'failure' || diagnostics) {
          clearTimeout(timer);
          void worker.terminate();
          if (message.type === 'failure') reject(new Error(message.error));
          else resolve({ messages, diagnostics: diagnostics as Phase8a5WorkerDiagnostics });
        }
      }
    });
    worker.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    worker.postMessage(request);
  });

export const fmtPhase8a5 = (value: number | null | undefined): string => {
  if (value == null) return 'n/a';
  if (value === 0) return '0.00e+0';
  if (!Number.isFinite(value)) return String(value);
  return value.toExponential(2);
};

export const medianPhase8a5 = (values: number[]): number => {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
};

export interface Phase8a5ReuseStressResult {
  perSessionMs: number[];
  allSuccess: boolean;
  bitIdentical: boolean;
  cancelSupported: boolean;
  cancelDetail: string;
}

/**
 * Runs N sequential preanalysis sessions on ONE reused actual worker
 * (bundle initialized once), then probes cancellation. Returns timings
 * and identity evidence; timings are recorded only, never gated.
 */
export const runPhase8a5ReuseStress = (
  payload: RunSessionRequest,
  sessionCount: number,
): Promise<Phase8a5ReuseStressResult> =>
  new Promise((resolveStress, rejectStress) => {
    const perSessionMs: number[] = [];
    let allSuccess = true;
    let bitIdentical = true;
    let baseline: Record<string, { x: number; y: number }> | null = null;
    let cancelSupported = false;
    let cancelDetail = 'not run';
    let worker: Worker;
    try {
      worker = new Worker(PHASE8A5_BRIDGE_PATH, { execArgv: ['--import', 'tsx'] });
    } catch (error) {
      rejectStress(error);
      return;
    }
    const timer = setTimeout(() => {
      void worker.terminate();
      rejectStress(new Error('stress worker did not settle within 600000 ms'));
    }, 600000);
    const pending = new Map<string, {
      resolve: (_v: { ok: boolean }) => void;
      t0: number;
      outcome: RunSessionOutcome | null;
      diagnostics: Phase8a5WorkerDiagnostics | null;
    }>();
    let cancelSettled = false;
    const maybeFinish = (runId: string): void => {
      const entry = pending.get(runId);
      if (!entry || !entry.outcome || !entry.diagnostics) return;
      pending.delete(runId);
      perSessionMs.push(Date.now() - entry.t0);
      const coords: Record<string, { x: number; y: number }> = {};
      for (const [id, station] of Object.entries(entry.outcome.result.stations)) {
        coords[id] = { x: station.x, y: station.y };
      }
      if (!baseline) {
        baseline = coords;
      } else if (JSON.stringify(coords) !== JSON.stringify(baseline)) {
        bitIdentical = false;
      }
      if (!entry.outcome.result.success || !entry.diagnostics.bundleInitialized) {
        allSuccess = false;
      }
      entry.resolve({ ok: true });
      if (pending.size === 0 && cancelSettled) {
        clearTimeout(timer);
        void worker.terminate();
        resolveStress({ perSessionMs, allSuccess, bitIdentical, cancelSupported, cancelDetail });
      }
    };
    worker.on('message', (message: unknown) => {
      const record = message as { type?: unknown; runId?: unknown };
      if (record?.type === 'test-diagnostics') {
        const entry = pending.get(record.runId as string);
        if (entry) {
          entry.diagnostics = (record as { diagnostics: Phase8a5WorkerDiagnostics }).diagnostics;
          maybeFinish(record.runId as string);
        }
        return;
      }
      if (!isAdjustmentWorkerResponseMessage(message)) {
        clearTimeout(timer);
        void worker.terminate();
        rejectStress(new Error('stress worker emitted a message outside the protocol guard'));
        return;
      }
      if (message.type === 'progress') return;
      if (message.type === 'cancelled' && message.runId === 'phase8a5-cancel-probe') {
        cancelSupported = true;
        cancelDetail = "bridge answered 'cancelled' to a cancel probe";
        cancelSettled = true;
        if (pending.size === 0) {
          clearTimeout(timer);
          void worker.terminate();
          resolveStress({ perSessionMs, allSuccess, bitIdentical, cancelSupported, cancelDetail });
        }
        return;
      }
      const entry = pending.get(message.runId);
      if (!entry) return;
      if (message.type === 'success') {
        entry.outcome = message.payload as RunSessionOutcome;
        maybeFinish(message.runId);
      } else {
        pending.delete(message.runId);
        allSuccess = false;
        entry.resolve({ ok: false });
      }
      if (pending.size === 0 && cancelSettled) {
        clearTimeout(timer);
        void worker.terminate();
        resolveStress({ perSessionMs, allSuccess, bitIdentical, cancelSupported, cancelDetail });
      }
    });
    worker.once('error', (error) => {
      clearTimeout(timer);
      rejectStress(error);
    });
    (async () => {
      for (let i = 0; i < sessionCount; i += 1) {
        const runId = `phase8a5-stress-${i}`;
        const done = new Promise<{ ok: boolean }>((resolve) => {
          pending.set(runId, { resolve, t0: Date.now(), outcome: null, diagnostics: null });
        });
        worker.postMessage({
          type: 'run',
          runId,
          payload,
        } satisfies AdjustmentWorkerRequestMessage);
        const settled = await done;
        if (!settled.ok) allSuccess = false;
      }
      const cancelDone = new Promise<void>((resolve) => {
        const check = setInterval(() => {
          if (cancelSettled) {
            clearInterval(check);
            resolve();
          }
        }, 25);
        setTimeout(() => {
          clearInterval(check);
          resolve();
        }, 15000);
      });
      worker.postMessage({ type: 'cancel', runId: 'phase8a5-cancel-probe' } satisfies AdjustmentWorkerRequestMessage);
      await cancelDone;
      if (!cancelSettled) {
        cancelDetail = 'no cancelled answer within 15 s (fail-open probe, not a gate)';
      }
      clearTimeout(timer);
      void worker.terminate();
      resolveStress({ perSessionMs, allSuccess, bitIdentical, cancelSupported, cancelDetail });
    })().catch(rejectStress);
  });
