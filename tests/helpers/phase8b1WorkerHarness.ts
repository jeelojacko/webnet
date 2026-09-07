/**
 * Phase 8B.1 shared stress harness (TEST ONLY).
 *
 * Drives the exact production worker (`scripts/phase8bPreanalysisWorkerBridge.ts`,
 * real cpp/build-wasm bundle, no injected runtime) through one REUSED
 * worker_threads worker across many sequential sessions. Route
 * classification uses per-session native-call counter deltas (a sparse
 * accept executes natively; a fail-closed fallback never delegates
 * over-cap systems and shows no correction delta).
 */
import fs from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';

import type { RunSessionOutcome, RunSessionRequest } from '../../src/engine/runSession';
import { createRunSessionRequest } from './runSessionRequest';

export const PHASE8B1_BRIDGE_PATH = path.join(process.cwd(), 'scripts/phase8bPreanalysisWorkerBridge.ts');

export interface Phase8b1Counters {
  bundleInitCount: number;
  realWasm: boolean;
  correctionCalls: number;
  correctionThrows: number;
  rowProductsCalls: number;
  rowProductsThrows: number;
  covarianceCalls: number;
  covarianceThrows: number;
  covarianceDamped: number;
}

export interface Phase8b1Memory {
  rss: number;
  heapUsed: number;
  heapTotal: number;
}

const readFixture = (file: string): string =>
  fs.readFileSync(path.join(process.cwd(), 'tests/fixtures', file), 'utf-8');

export const FIXTURE_INPUT: Record<string, string> = {
  anchor: readFixture('preanalysis_cli.dat'),
  closure: readFixture('traverse_closure.dat'),
  smoke: readFixture('cli_smoke.dat'),
  campTraverse: readFixture('camp_design_preanalysis_traverse_only.dat'),
  campFull: readFixture('camp_design_preanalysis_input.dat'),
  coldstream: readFixture('coldstream_case_source_a.dat'),
  traverse: readFixture('traverse.dat'),
  triang: fs.readFileSync(path.join(process.cwd(), 'public/examples/ts_triangulation_trilateration_2d.dat'), 'utf-8'),
};

export const makePreanalysisRequest = (input: string): RunSessionRequest => {
  const base = createRunSessionRequest({ input });
  return createRunSessionRequest({
    input,
    parseSettings: {
      ...base.parseSettings,
      runMode: 'preanalysis',
      coordMode: '2D',
      robustMode: 'none',
      tsCorrelationEnabled: false,
      autoAdjustEnabled: false,
    },
  });
};

/** Ordinary 2D adjustment request (cross-mode interleave through Phase 7C). */
export const makeAdjustmentRequest = (input: string): RunSessionRequest => {
  const base = createRunSessionRequest({ input });
  return createRunSessionRequest({
    input,
    parseSettings: {
      ...base.parseSettings,
      runMode: 'adjustment',
      coordMode: '2D',
      suspectImpactMode: 'off',
    },
  });
};

const stripVolatile = (result: unknown): unknown => {
  const clone = JSON.parse(JSON.stringify(result)) as Record<string, unknown>;
  delete clone.solveTimingProfile;
  if (Array.isArray(clone.logs)) {
    clone.logs = (clone.logs as string[]).filter((line) => !line.startsWith('Solve timing (ms):'));
  }
  return clone;
};

/** Deterministic identity of a session outcome (no timings). */
export const stableKeyOf = (outcome: RunSessionOutcome): string =>
  JSON.stringify({
    result: stripVolatile(outcome.result),
    effectiveExcludedIds: outcome.effectiveExcludedIds,
    activePreanalysisAdditionIds: outcome.activePreanalysisAdditionIds,
    effectiveClusterApprovedMerges: outcome.effectiveClusterApprovedMerges,
    droppedExclusions: outcome.droppedExclusions,
    droppedPreanalysisAdditions: outcome.droppedPreanalysisAdditions,
    droppedOverrides: outcome.droppedOverrides,
    droppedClusterMerges: outcome.droppedClusterMerges,
    inputChangedSinceLastRun: outcome.inputChangedSinceLastRun,
  });

export interface Phase8b1RunResult {
  outcome: RunSessionOutcome;
  before: Phase8b1Counters;
  after: Phase8b1Counters;
}

/** One reused exact-dispatch worker; sequential use only (no concurrency). */
interface PendingWaiter {
  resolve: (_value: unknown) => void;
  reject: (_error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class Phase8b1Worker {
  private worker: Worker | null = null;
  private readonly seen = new Map<string, PendingWaiter>();

  private constructor(worker: Worker) {
    this.worker = worker;
    worker.on('message', (message: unknown) => {
      const record = message as { type?: unknown; runId?: unknown };
      const key = `${String(record?.type)}:${String(record?.runId)}`;
      this.seen.get(key)?.resolve(message);
      const anyKey = `${String(record?.type)}:*`;
      this.seen.get(anyKey)?.resolve(message);
    });
    worker.on('error', (error) => {
      for (const pending of this.seen.values()) pending.reject(error);
      this.seen.clear();
    });
  }

  static launch(env: Record<string, string>): Phase8b1Worker {
    const worker = new Worker(PHASE8B1_BRIDGE_PATH, {
      execArgv: ['--import', 'tsx'],
      env: { ...process.env, ...env },
    });
    return new Phase8b1Worker(worker);
  }

  private awaitMessage(type: string, runId: string, timeoutMs: number): Promise<unknown> {
    const key = `${type}:${runId}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.seen.delete(key);
        reject(new Error(`timed out waiting for ${key}`));
      }, timeoutMs);
      // setTimeout keeps the handle referenced; unref so an abandoned
      // waiter never holds the parent process open on its own.
      timer.unref?.();
      this.seen.set(key, {
        resolve: (value) => {
          clearTimeout(timer);
          this.seen.delete(key);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          this.seen.delete(key);
          reject(error);
        },
        timer,
      });
    });
  }

  private forget(type: string, runId: string): void {
    const waiter = this.seen.get(`${type}:${runId}`);
    if (waiter) {
      // Clear the armed timer so a dropped loser can neither reject
      // unobserved nor leak its handle after the race settled.
      clearTimeout(waiter.timer);
      this.seen.delete(`${type}:${runId}`);
    }
  }

  async run(payload: RunSessionRequest, runId: string, timeoutMs = 180000): Promise<Phase8b1RunResult> {
    const before = await this.queryMemoryCounters(runId, timeoutMs);
    this.worker?.postMessage({ type: 'run', runId, payload });
    const [success, diagnostics] = await Promise.all([
      this.awaitMessage('success', runId, timeoutMs),
      this.awaitMessage('phase8b-diagnostics', runId, timeoutMs),
    ]);
    const outcome = (success as { payload: RunSessionOutcome }).payload;
    const after = (diagnostics as { diagnostics: Phase8b1Counters }).diagnostics;
    return { outcome, before, after };
  }

  /**
   * Posts a run then cancels on the next tick. Resolves true when the
   * worker reports `cancelled` (healthy cancel path); false when the run
   * won the race and succeeded (caller may retry with a slower input).
   */
  async cancelAttempt(
    payload: RunSessionRequest,
    runId: string,
    timeoutMs = 180000,
  ): Promise<{ cancelled: boolean; outcome: RunSessionOutcome | null }> {
    this.worker?.postMessage({ type: 'run', runId, payload });
    await new Promise((resolve) => setTimeout(resolve, 0));
    this.worker?.postMessage({ type: 'cancel', runId });
    const first = await Promise.race([
      this.awaitMessage('cancelled', runId, timeoutMs).then(() => 'cancelled' as const),
      this.awaitMessage('success', runId, timeoutMs).then(
        (message) => ({ success: message }) as const,
      ),
    ]);
    // Drop the losing waiter so its late timer cannot reject unobserved.
    this.forget('cancelled', runId);
    this.forget('success', runId);
    if (first === 'cancelled') return { cancelled: true, outcome: null };
    return { cancelled: false, outcome: (first.success as { payload: RunSessionOutcome }).payload };
  }

  async queryMemory(runId: string, timeoutMs = 60000): Promise<{ memory: Phase8b1Memory; diagnostics: Phase8b1Counters }> {
    this.worker?.postMessage({ type: 'phase8b-mem', runId });
    const message = (await this.awaitMessage('phase8b-mem', runId, timeoutMs)) as {
      memory: Phase8b1Memory;
      diagnostics: Phase8b1Counters;
    };
    return { memory: message.memory, diagnostics: message.diagnostics };
  }

  private async queryMemoryCounters(runId: string, timeoutMs: number): Promise<Phase8b1Counters> {
    try {
      const { diagnostics } = await this.queryMemory(`counters-${runId}`, Math.min(timeoutMs, 30000));
      return diagnostics;
    } catch {
      throw new Error('worker unreachable before run (no counters baseline)');
    }
  }

  async close(): Promise<void> {
    await this.worker?.terminate();
    this.worker = null;
  }
}
