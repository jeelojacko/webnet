/**
 * Phase 8A.6 evidence-test worker helpers (TEST/EVIDENCE ONLY).
 *
 * Single-run collection through the Phase 8A.6 covariance-capture bridge
 * plus reused-worker mixed-session stress with cancellation probing. No
 * production imports; timings are recorded only, never gated.
 */
import path from 'node:path';
import { Worker } from 'node:worker_threads';

import {
  isAdjustmentWorkerResponseMessage,
  type AdjustmentWorkerRequestMessage,
  type AdjustmentWorkerResponseMessage,
} from '../../src/engine/adjustmentWorkerProtocol';
import type { RunSessionOutcome, RunSessionRequest } from '../../src/engine/runSession';

export const PHASE8A6_BRIDGE_PATH = path.join(
  process.cwd(),
  'scripts/phase8a6CovarianceSentinelBridge.ts',
);

export interface Phase8a6CovarianceCallMetrics {
  parameterCount: number;
  observationEquationCount: number;
  queryCount: number;
  designNnz: number;
  weightNnz: number;
  designFingerprint: number;
  weightFingerprint: number;
  queryFingerprint: number;
  damping: number | null;
  threw: boolean;
  allFinite: boolean;
  minValue: number | null;
  maxValue: number | null;
  meanValue: number | null;
  queryRows: number[];
  queryColumns: number[];
  queriesTruncated: boolean;
  c2MaxResidual: number | null;
  c2Pass: boolean | null;
  c2ColumnsChecked: number;
  c2Note: string;
}

export interface Phase8a6WorkerDiagnostics {
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
  sentinelMetrics: Array<{
    parameterCount: number;
    observationEquationCount: number;
    damped: boolean;
    c1MaxRelativeDiff: number | null;
    c1Pass: boolean | null;
    c2MaxResidual: number | null;
    c2Pass: boolean | null;
    c2ColumnsChecked: number;
    c2Note: string;
    c3Pass: boolean | null;
    physicalValid: boolean | null;
    note: string;
  }>;
  covarianceCalls: Phase8a6CovarianceCallMetrics[];
  covarianceTruncated: boolean;
}

/** Sends one RunRequestMessage to a fresh actual worker and collects until settled. */
export const runPhase8a6WorkerOnce = (
  request: AdjustmentWorkerRequestMessage,
  timeoutMs = 240000,
): Promise<{ messages: AdjustmentWorkerResponseMessage[]; diagnostics: Phase8a6WorkerDiagnostics }> =>
  new Promise((resolve, reject) => {
    const messages: AdjustmentWorkerResponseMessage[] = [];
    let diagnostics: Phase8a6WorkerDiagnostics | null = null;
    let worker: Worker;
    try {
      worker = new Worker(PHASE8A6_BRIDGE_PATH, { execArgv: ['--import', 'tsx'] });
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
        diagnostics = (record as { diagnostics: Phase8a6WorkerDiagnostics }).diagnostics;
        if (messages.some((m) => m.type === 'success' || m.type === 'failure')) {
          clearTimeout(timer);
          void worker.terminate();
          resolve({ messages, diagnostics: diagnostics as Phase8a6WorkerDiagnostics });
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
          else resolve({ messages, diagnostics: diagnostics as Phase8a6WorkerDiagnostics });
        }
      }
    });
    worker.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    worker.postMessage(request);
  });

export interface Phase8a6ReuseStressResult {
  perSessionMs: number[];
  allSuccess: boolean;
  bitIdenticalPerInput: boolean;
  zeroFallbacks: boolean;
  cancelSupported: boolean;
  cancelDetail: string;
  settledSessions: number;
}

/**
 * Runs mixed preanalysis sessions sequentially on ONE reused actual
 * worker (bundle initialized once), cycling through the payloads, then
 * probes cancellation. Coordinates must be bit-identical per repeated
 * input; every session must report zero sparse fallbacks.
 */
export const runPhase8a6ReuseStress = (
  payloads: RunSessionRequest[],
  sessionCount: number,
): Promise<Phase8a6ReuseStressResult> =>
  new Promise((resolveStress, rejectStress) => {
    const perSessionMs: number[] = [];
    let allSuccess = true;
    let bitIdenticalPerInput = true;
    let zeroFallbacks = true;
    let cancelSupported = false;
    let cancelDetail = 'not run';
    const baselines = new Map<number, string>();
    let worker: Worker;
    try {
      worker = new Worker(PHASE8A6_BRIDGE_PATH, { execArgv: ['--import', 'tsx'] });
    } catch (error) {
      rejectStress(error);
      return;
    }
    const timer = setTimeout(() => {
      void worker.terminate();
      rejectStress(new Error('stress worker did not settle within 900000 ms'));
    }, 900000);
    const pending = new Map<string, {
      resolve: (_v: { ok: boolean }) => void;
      t0: number;
      payloadIndex: number;
      outcome: RunSessionOutcome | null;
      diagnostics: Phase8a6WorkerDiagnostics | null;
    }>();
    let cancelSettled = false;
    let settledSessions = 0;
    const finish = (): void => {
      if (pending.size === 0 && cancelSettled) {
        clearTimeout(timer);
        void worker.terminate();
        resolveStress({
          perSessionMs,
          allSuccess,
          bitIdenticalPerInput,
          zeroFallbacks,
          cancelSupported,
          cancelDetail,
          settledSessions,
        });
      }
    };
    const maybeFinish = (runId: string): void => {
      const entry = pending.get(runId);
      if (!entry || !entry.outcome || !entry.diagnostics) return;
      pending.delete(runId);
      settledSessions += 1;
      perSessionMs.push(Date.now() - entry.t0);
      const coords: Record<string, { x: number; y: number }> = {};
      for (const [id, station] of Object.entries(entry.outcome.result.stations)) {
        coords[id] = { x: station.x, y: station.y };
      }
      const fingerprint = JSON.stringify(coords);
      const baseline = baselines.get(entry.payloadIndex);
      if (baseline == null) baselines.set(entry.payloadIndex, fingerprint);
      else if (baseline !== fingerprint) bitIdenticalPerInput = false;
      if (!entry.outcome.result.success || !entry.diagnostics.bundleInitialized) allSuccess = false;
      if (
        entry.diagnostics.sparseCorrectionFallbacks + entry.diagnostics.selectedCovarianceFallbacks +
        entry.diagnostics.rowProductsFallbacks > 0
      ) {
        zeroFallbacks = false;
      }
      entry.resolve({ ok: true });
      finish();
    };
    worker.on('message', (message: unknown) => {
      const record = message as { type?: unknown; runId?: unknown };
      if (record?.type === 'test-diagnostics') {
        const entry = pending.get(record.runId as string);
        if (entry) {
          entry.diagnostics = (record as { diagnostics: Phase8a6WorkerDiagnostics }).diagnostics;
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
      if (message.type === 'cancelled' && message.runId === 'phase8a6-cancel-probe') {
        cancelSupported = true;
        cancelDetail = "bridge answered 'cancelled' to a cancel probe";
        cancelSettled = true;
        finish();
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
      finish();
    });
    worker.once('error', (error) => {
      clearTimeout(timer);
      rejectStress(error);
    });
    // Sequential chain: next session starts when the previous settles.
    let next = 0;
    const launchNext = (): void => {
      if (next >= sessionCount) {
        worker.postMessage({ type: 'cancel', runId: 'phase8a6-cancel-probe' });
        // If the bridge never answers cancel, settle via timeout path below.
        setTimeout(() => {
          if (!cancelSettled) {
            cancelDetail = 'no cancelled answer to the probe (protocol has no cancel path)';
            cancelSettled = true;
            finish();
          }
        }, 5000);
        return;
      }
      const index = next;
      next += 1;
      const runId = `phase8a6-stress-${index}`;
      const payloadIndex = index % payloads.length;
      const payload = payloads[payloadIndex] as RunSessionRequest;
      const t0 = Date.now();
      let settled = false;
      pending.set(runId, {
        resolve: () => {
          if (settled) return;
          settled = true;
          launchNext();
        },
        t0,
        payloadIndex,
        outcome: null,
        diagnostics: null,
      });
      worker.postMessage({ type: 'run', runId, payload });
    };
    launchNext();
  });

export const medianPhase8a6 = (values: number[]): number => {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
};

export const fmtPhase8a6 = (value: number | null | undefined): string => {
  if (value == null) return 'n/a';
  if (value === 0) return '0.00e+0';
  if (!Number.isFinite(value)) return String(value);
  return value.toExponential(2);
};
