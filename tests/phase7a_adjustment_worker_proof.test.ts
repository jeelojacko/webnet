/**
 * Phase 7A bounded test-only actual adjustment-worker protocol proof.
 *
 * What is proven:
 * - The test spawns a Node worker_threads worker running
 *   `scripts/phase7aAdjustmentWorkerBridge.ts`, which installs only a
 *   browser `self` postMessage/onmessage shim and then imports the
 *   UNMODIFIED production module `src/workers/adjustmentWorker.ts`
 *   (including its lazy `import('../engine/runSession')` delegation).
 * - A real `RunRequestMessage` goes through the existing worker protocol;
 *   every response is validated with `isAdjustmentWorkerResponseMessage`,
 *   and the run returns queued/solving progress plus a converged success
 *   over TypeScript assembly (small deterministic 3D case).
 * - Determinism is checked by repeating the same payload through the
 *   directly imported `runAdjustmentSession` (the exact function the
 *   worker lazy-loads) and comparing station coordinates exactly.
 *
 * What is NOT proven / out of scope:
 * - The injected sparse numerical bundle is not exercised: the worker
 *   request protocol carries only `RunSessionRequest`, which has no
 *   engine-options/sparse-solver fields, and the runSession -> solveEngine
 *   -> scenario path has no sparse injection point. Wiring one in would be
 *   a production routing change (forbidden for this proof). The absence of
 *   that seam is asserted below.
 * - No production routing is changed; no tolerances are altered.
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
import { createRunSessionRequest } from './helpers/runSessionRequest';

const BRIDGE_PATH = path.join(process.cwd(), 'scripts/phase7aAdjustmentWorkerBridge.ts');

const SMALL_3D_INPUT = [
  '.3D',
  'C A 0 0 10 ! ! !',
  'C B 100 0 10 ! ! !',
  'C C 50 80 12 ! ! !',
  'C P 50 40 11',
  'D A-P 64.1 0.01',
  'D B-P 64.1 0.01',
  'D C-P 40.1 0.01',
].join('\n');

const createProofRequest = (): ReturnType<typeof createRunSessionRequest> =>
  createRunSessionRequest({ input: SMALL_3D_INPUT });

/** Sends one RunRequestMessage to the actual worker and collects until settled. */
const runActualWorker = (
  request: AdjustmentWorkerRequestMessage,
  timeoutMs = 60000,
): Promise<AdjustmentWorkerResponseMessage[]> =>
  new Promise((resolve, reject) => {
    const messages: AdjustmentWorkerResponseMessage[] = [];
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
      if (!isAdjustmentWorkerResponseMessage(message)) {
        clearTimeout(timer);
        void worker.terminate();
        reject(new Error('worker emitted a message outside the protocol guard'));
        return;
      }
      messages.push(message);
      if (message.type === 'success' || message.type === 'failure') {
        clearTimeout(timer);
        void worker.terminate();
        if (message.type === 'failure') reject(new Error(message.error));
        else resolve(messages);
      }
    });
    worker.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    worker.postMessage(request);
  });

describe('phase 7A adjustment-worker protocol proof', () => {
  it(
    'runs a RunRequestMessage through the actual adjustment worker with success/progress',
    async () => {
      const requestMessage: AdjustmentWorkerRequestMessage = {
        type: 'run',
        runId: 'phase7a-worker-proof',
        payload: createProofRequest(),
      };

      // No sparse-injection seam exists on the session request: wiring an
      // injected sparse bundle through would require production routing
      // changes, so the proof stays on the TypeScript assembly path.
      expect(requestMessage.payload).not.toHaveProperty('sparseCorrectionSolver');
      expect(requestMessage.payload).not.toHaveProperty('experimentalSparseDiagnostics');

      const messages = await runActualWorker(requestMessage);
      const phases = messages.filter((m) => m.type === 'progress').map((m) => m.phase);

      // Progress sequence from the real worker: queued, solving, then at
      // least one solving callback update, then finalizing.
      expect(phases[0]).toBe('queued');
      expect(phases[1]).toBe('solving');
      expect(phases[phases.length - 1]).toBe('finalizing');
      expect(phases.length).toBeGreaterThan(3);

      const success = messages[messages.length - 1];
      expect(success?.type).toBe('success');
      if (success?.type !== 'success') return;
      expect(success.runId).toBe(requestMessage.runId);

      // TypeScript assembly path: converged success with measured
      // equation-assembly timing and adjusted stations.
      expect(success.payload.result.success).toBe(true);
      expect(success.payload.result.converged).toBe(true);
      expect(success.payload.result.solveTimingProfile?.equationAssemblyMs).toBeGreaterThanOrEqual(
        0,
      );
      expect(Object.keys(success.payload.result.stations).length).toBeGreaterThan(0);

      // Deterministic repeat through the worker's delegated session function.
      const repeat = runAdjustmentSession(createProofRequest());
      expect(repeat.result.success).toBe(true);
      for (const [id, station] of Object.entries(success.payload.result.stations)) {
        const other = repeat.result.stations[id];
        expect(other, `station ${id} repeats deterministically`).toBeDefined();
        expect(other?.x).toBe(station.x);
        expect(other?.y).toBe(station.y);
        expect(other?.h).toBe(station.h);
      }
    },
    120000,
  );

  it('shapes a cancel message for the worker protocol', () => {
    const cancelMessage: AdjustmentWorkerRequestMessage = {
      type: 'cancel',
      runId: 'phase7a-worker-proof',
    };
    expect(cancelMessage.type).toBe('cancel');
    expect(typeof cancelMessage.runId).toBe('string');
  });
});
