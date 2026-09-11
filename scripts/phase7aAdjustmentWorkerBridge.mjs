import { parentPort } from 'node:worker_threads';
import { shim } from './phase7aAdjustmentWorkerShim.mjs';
import '../src/workers/adjustmentWorker.ts';

parentPort?.on('message', (data) => {
  shim.onmessage?.({ data });
});
