/**
 * Phase 7B bounded test-only actual-worker sparse proof.
 *
 * What is proven:
 * - The test spawns a Node worker_threads worker running
 *   `scripts/phase7bAdjustmentWorkerBridge.ts`, which installs only a
 *   browser `self` postMessage/onmessage shim and then imports the
 *   UNMODIFIED production module `src/workers/adjustmentWorker.ts`
 *   (including its lazy `import('../engine/runSession')` delegation).
 * - Worker-local runtime injection uses the exported test-only provider
 *   seam (`setAdjustmentWorkerRuntime`); the `RunRequestMessage` protocol
 *   and `RunSessionRequest` shape are unchanged (no sparse fields).
 * - A real `RunRequestMessage` executes sparse correction, row products,
 *   and selected covariance through the injected real WASM bundle with zero
 *   fallbacks, and matches the TypeScript reference within the existing
 *   shadow tolerance.
 *
 * What is NOT proven / out of scope:
 * - No production routing is changed; the default worker runtime stays
 *   undefined (exact legacy TypeScript path).
 * - The sparse bundle is test-injected only; production worker defaults stay
 *   TypeScript-authoritative.
 */
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { describe, expect, it } from 'vitest';

import {
  isAdjustmentWorkerResponseMessage,
  type AdjustmentWorkerRequestMessage,
  type AdjustmentWorkerResponseMessage,
} from '../src/engine/adjustmentWorkerProtocol';
import { runAdjustmentSession } from '../src/engine/runSession';
import { compareSparseShadowResults } from '../src/engine/phase6SparseShadowCompare';
import { createRunSessionRequest } from './helpers/runSessionRequest';
import { buildPhase7bEnuSmallInput } from '../src/engine/phase7bEnuFixtures';

const BRIDGE_PATH = path.join(process.cwd(), 'scripts/phase7bAdjustmentWorkerBridge.ts');

const SMALL_3D_INPUT = buildPhase7bEnuSmallInput();
interface TestDiagnosticsSnapshot {
  sparseCorrectionCalls: number;
  sparseCorrectionFallbacks: number;
  rowProductsCalls: number;
  rowProductsFallbacks: number;
  selectedCovarianceCalls: number;
  selectedCovarianceFallbacks: number;
  bundleInitialized: boolean;
}

/** Sends one RunRequestMessage to the actual worker and collects until settled. */
const runActualWorker = (
  request: AdjustmentWorkerRequestMessage,
  timeoutMs = 90000,
): Promise<{ messages: AdjustmentWorkerResponseMessage[]; diagnostics: TestDiagnosticsSnapshot }> =>
  new Promise((resolve, reject) => {
    const messages: AdjustmentWorkerResponseMessage[] = [];
    let diagnostics: TestDiagnosticsSnapshot | null = null;
    let worker: Worker;
    try {
      worker = new Worker(BRIDGE_PATH, { execArgv: ['--import', 'tsx'] });
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
        diagnostics = (record as { diagnostics: TestDiagnosticsSnapshot }).diagnostics;
        if (messages.some((m) => m.type === 'success' || m.type === 'failure')) {
          clearTimeout(timer);
          void worker.terminate();
          resolve({ messages, diagnostics: diagnostics as TestDiagnosticsSnapshot });
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
          else resolve({ messages, diagnostics: diagnostics as TestDiagnosticsSnapshot });
        }
      }
    });
    worker.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    worker.postMessage(request);
  });

describe('phase 7B actual-worker sparse proof', () => {
  it(
    'executes sparse correction, row products, and selected covariance in the actual worker',
    async () => {
      const requestMessage: AdjustmentWorkerRequestMessage = {
        type: 'run',
        runId: 'phase7b-worker-sparse-proof',
        payload: createRunSessionRequest({ input: SMALL_3D_INPUT }),
      };

      // No protocol/request-shape change: the sparse runtime travels only
      // through the worker-local provider seam inside the worker thread.
      expect(requestMessage.payload).not.toHaveProperty('sparseCorrectionSolver');
      expect(requestMessage.payload).not.toHaveProperty('experimentalSparseDiagnostics');
      expect(requestMessage.payload).not.toHaveProperty('runtime');

      const { messages, diagnostics } = await runActualWorker(requestMessage);
      const phases = messages.filter((m) => m.type === 'progress').map((m) => m.phase);
      expect(phases[0]).toBe('queued');
      expect(phases[phases.length - 1]).toBe('finalizing');

      const success = messages[messages.length - 1];
      expect(success?.type).toBe('success');
      if (success?.type !== 'success') return;
      expect(success.payload.result.success).toBe(true);
      expect(success.payload.result.converged).toBe(true);

      // Actual worker executed all three sparse routes with zero fallbacks.
      expect(diagnostics.bundleInitialized).toBe(true);
      expect(diagnostics.sparseCorrectionCalls).toBeGreaterThan(0);
      expect(diagnostics.rowProductsCalls).toBeGreaterThan(0);
      expect(diagnostics.selectedCovarianceCalls).toBeGreaterThan(0);
      expect(diagnostics.sparseCorrectionFallbacks).toBe(0);
      expect(diagnostics.rowProductsFallbacks).toBe(0);
      expect(diagnostics.selectedCovarianceFallbacks).toBe(0);

      const reference = runAdjustmentSession(createRunSessionRequest({ input: SMALL_3D_INPUT }));
      const comparison = compareSparseShadowResults(reference.result, success.payload.result, 1e-6);
      expect(comparison.pass).toBe(true);
      expect(comparison.passReasons).toEqual([]);

      // Deterministic repeat through the same actual worker protocol.
      const repeatRun = await runActualWorker(requestMessage);
      const repeatSuccess = repeatRun.messages[repeatRun.messages.length - 1];
      expect(repeatSuccess?.type).toBe('success');
      if (repeatSuccess?.type !== 'success') return;
      for (const [id, station] of Object.entries(success.payload.result.stations)) {
        const other = repeatSuccess.payload.result.stations[id];
        expect(other, `station ${id} repeats deterministically`).toBeDefined();
        expect(other?.x).toBe(station.x);
        expect(other?.y).toBe(station.y);
        expect(other?.h).toBe(station.h);
      }
    },
    120000,
  );
});
