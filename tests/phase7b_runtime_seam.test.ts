/**
 * Phase 7B runtime seam: session -> scenario -> LSAEngine threading plus
 * worker handler semantics (init failure / cancellation / failure-reset).
 *
 * Bounds: no `RunSessionRequest` / protocol / persisted-state / UI changes;
 * no production routing. The live worker sparse proof lives in
 * `phase7b_worker_sparse_proof.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { toEngineOptions, type AdjustmentRuntime } from '../src/engine/adjustmentRuntime';
import { createExperimentalSparseRouteDiagnostics } from '../src/engine/experimentalSparseDiagnostics';
import { runAdjustmentSession } from '../src/engine/runSession';
import { runAdjustmentScenario } from '../src/engine/scenarioRunService';
import { createAdjustmentWorkerHandler } from '../src/workers/adjustmentWorkerHandler';
import type { AdjustmentWorkerResponseMessage } from '../src/engine/adjustmentWorkerProtocol';
import { createRunSessionRequest } from './helpers/runSessionRequest';
import {
  countingCorrectionSolver,
  countingCovarianceSolver,
  countingRowProductsSolver,
} from './helpers/sparseTestStubs';

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

const buildRuntime = () => {
  const diagnostics = createExperimentalSparseRouteDiagnostics();
  const correction = countingCorrectionSolver();
  const rowProducts = countingRowProductsSolver();
  const covariance = countingCovarianceSolver();
  const runtime: AdjustmentRuntime = {
    sparseCorrectionSolver: correction,
    sparseRowProductsSolver: rowProducts,
    sparseSelectedCovarianceSolver: covariance,
    experimentalSparseDiagnostics: diagnostics,
  };
  return { runtime, diagnostics, correction, rowProducts, covariance };
};

const stationCoords = (stations: Record<string, { x: number; y: number; h?: number }>) =>
  Object.fromEntries(
    Object.entries(stations).map(([id, s]) => [id, [s.x, s.y, s.h]]),
  );

describe('phase 7B runtime seam threading', () => {
  it('maps only defined runtime fields into engine options', () => {
    expect(toEngineOptions(undefined)).toEqual({});
    expect(toEngineOptions({})).toEqual({});
    const { runtime } = buildRuntime();
    const options = toEngineOptions(runtime);
    expect(options.sparseCorrectionSolver).toBe(runtime.sparseCorrectionSolver);
    expect(options.sparseRowProductsSolver).toBe(runtime.sparseRowProductsSolver);
    expect(options.sparseSelectedCovarianceSolver).toBe(runtime.sparseSelectedCovarianceSolver);
    expect(options.experimentalSparseDiagnostics).toBe(runtime.experimentalSparseDiagnostics);
    expect(options.experimentalSelectedCovarianceMode).toBeUndefined();
    expect(toEngineOptions({ experimentalSelectedCovarianceMode: true }).experimentalSelectedCovarianceMode).toBe(true);
  });

  it('preserves exact behavior when runtime is undefined', () => {
    const request = createRunSessionRequest({ input: SMALL_3D_INPUT });
    const baseline = runAdjustmentSession(createRunSessionRequest({ input: SMALL_3D_INPUT }));
    const withUndefined = runAdjustmentSession(request, undefined, undefined);
    expect(withUndefined.result.success).toBe(true);
    expect(stationCoords(withUndefined.result.stations)).toEqual(stationCoords(baseline.result.stations));
    expect(withUndefined.result.success).toBe(baseline.result.success);
  });

  it('executes sparse correction, row products, and selected covariance via session runtime', () => {
    const { runtime, diagnostics, correction, rowProducts, covariance } = buildRuntime();
    const baseline = runAdjustmentSession(createRunSessionRequest({ input: SMALL_3D_INPUT }));
    const outcome = runAdjustmentSession(
      createRunSessionRequest({ input: SMALL_3D_INPUT }),
      undefined,
      runtime,
    );
    expect(outcome.result.success).toBe(true);
    expect(outcome.result.converged).toBe(true);
    expect(correction.inputs.length).toBeGreaterThan(0);
    expect(rowProducts.inputs.length).toBeGreaterThan(0);
    expect(covariance.inputs.length).toBeGreaterThan(0);
    expect(diagnostics.sparseCorrectionCalls).toBe(correction.inputs.length);
    expect(diagnostics.rowProductsCalls).toBe(rowProducts.inputs.length);
    expect(diagnostics.selectedCovarianceCalls).toBe(covariance.inputs.length);
    expect(diagnostics.sparseCorrectionFallbacks).toBe(0);
    expect(diagnostics.rowProductsFallbacks).toBe(0);
    expect(diagnostics.selectedCovarianceFallbacks).toBe(0);
    expect(stationCoords(outcome.result.stations)).toEqual(stationCoords(baseline.result.stations));
  });

  it('propagates runtime solvers into nested LSAEngine solves', () => {
    const { runtime, correction } = buildRuntime();
    const outcome = runAdjustmentSession(
      createRunSessionRequest({
        input: SMALL_3D_INPUT,
        parseSettings: {
          ...createRunSessionRequest().parseSettings,
          runMode: 'blunder-detect',
        },
      }),
      undefined,
      runtime,
    );
    expect(outcome.result.success).toBe(true);
    // Blunder-detect fans out into nested LSAEngine solves; every nested
    // solve inherits the injected correction solver, so more than one
    // sparse correction executes through the shared runtime instance.
    expect(correction.inputs.length).toBeGreaterThanOrEqual(2);
  });

  it('threads runtime through the scenario service', () => {
    const { runtime, diagnostics, correction } = buildRuntime();
    const result = runAdjustmentScenario({
      input: SMALL_3D_INPUT,
      maxIterations: 10,
      runtime,
    });
    expect(result.success).toBe(true);
    expect(correction.inputs.length).toBeGreaterThan(0);
    expect(diagnostics.sparseCorrectionCalls).toBe(correction.inputs.length);
    const legacy = runAdjustmentScenario({ input: SMALL_3D_INPUT, maxIterations: 10 });
    expect(legacy.success).toBe(true);
    for (const [id, station] of Object.entries(result.stations)) {
      expect(legacy.stations[id]?.x).toBe(station.x);
      expect(legacy.stations[id]?.y).toBe(station.y);
    }
  });
});

describe('phase 7B worker handler semantics', () => {
  const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

  it('emits failure when session init rejects, then resets for the next run', async () => {
    const messages: AdjustmentWorkerResponseMessage[] = [];
    let calls = 0;
    const handler = createAdjustmentWorkerHandler({
      loadSession: () => {
        calls += 1;
        return calls === 1
          ? Promise.reject(new Error('init offline'))
          : Promise.resolve((request) => runAdjustmentSession(request));
      },
      postMessage: (message) => messages.push(message),
      defer: (callback) => callback(),
    });
    handler.handleMessage({ type: 'run', runId: 'r1', payload: createRunSessionRequest({ input: SMALL_3D_INPUT }) });
    await flush();
    await flush();
    const failure = messages.find((m) => m.type === 'failure');
    expect(failure?.type).toBe('failure');
    if (failure?.type === 'failure') expect(failure.error).toContain('init offline');

    handler.handleMessage({ type: 'run', runId: 'r1', payload: createRunSessionRequest({ input: SMALL_3D_INPUT }) });
    await flush();
    await flush();
    const success = messages.filter((m) => m.type === 'success' && m.runId === 'r1');
    expect(success.length).toBe(1);
    expect(calls).toBe(2);
  });

  it('suppresses success after cancellation', async () => {
    const messages: AdjustmentWorkerResponseMessage[] = [];
    const deferredHolder: { current: (() => void) | null } = { current: null };
    const handler = createAdjustmentWorkerHandler({
      loadSession: () => Promise.resolve((request) => runAdjustmentSession(request)),
      postMessage: (message) => messages.push(message),
      defer: (callback) => {
        deferredHolder.current = callback;
      },
    });
    handler.handleMessage({ type: 'run', runId: 'rc', payload: createRunSessionRequest({ input: SMALL_3D_INPUT }) });
    handler.handleMessage({ type: 'cancel', runId: 'rc' });
    deferredHolder.current?.();
    await flush();
    await flush();
    expect(messages.some((m) => m.type === 'cancelled')).toBe(true);
    expect(messages.some((m) => m.type === 'success')).toBe(false);
    expect(messages.some((m) => m.type === 'failure')).toBe(false);
  });

  it('forwards the worker-local runtime into the session call', async () => {
    const seen: (AdjustmentRuntime | undefined)[] = [];
    const { runtime } = buildRuntime();
    const handler = createAdjustmentWorkerHandler({
      loadSession: () =>
        Promise.resolve((request, _onProgress, passed) => {
          seen.push(passed);
          return runAdjustmentSession(request, _onProgress, passed);
        }),
      postMessage: () => undefined,
      getRuntime: () => runtime,
      defer: (callback) => callback(),
    });
    handler.handleMessage({ type: 'run', runId: 'rt', payload: createRunSessionRequest({ input: SMALL_3D_INPUT }) });
    await flush();
    await flush();
    expect(seen).toEqual([runtime]);
  });
});
