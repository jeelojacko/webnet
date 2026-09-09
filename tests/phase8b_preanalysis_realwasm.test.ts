/**
 * Phase 8B real-WASM release proof (exact production dispatch, real bundle).
 *
 * Uses the ACTUAL cpp/build-wasm generated JS/WASM bundle through the
 * EXACT production worker dispatch (`src/workers/adjustmentWorker.ts` with
 * no injected runtime). No Phase 8A bridge, no fake bundle: counting
 * delegates observe the real solvers without changing them. If the WASM
 * artifact is absent, the real-bundle gates fail with an explicit reason
 * (documented in the release report); the route stays default-OFF.
 *
 * Covers: default-OFF proof (in-process + worker), enabled small-anchor
 * admission, camp/direction-inflation preflight holdback, corrupt-restart,
 * unknown/policy-hook boundaries, worker init-failure fallback, run
 * interleave + bundle cache, sequential stress determinism, and
 * terminate/restart. Writes reports/phase8b/preanalysis-release-report.json
 * and .md (deterministic: counts/routes/reasons only, no timings).
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { describe, expect, it } from 'vitest';

import type { RunSessionOutcome, RunSessionRequest } from '../src/engine/runSession';
import { runAdjustmentSession } from '../src/engine/runSession';
import { comparePreanalysisContract } from '../src/engine/preanalysisSparseEvidence';
import type { WebNetWasmFactory } from '../src/engine/wasm/wasmTypes';
import { createExperimentalSparseNumericalBundle } from '../src/engine/wasm/experimentalSparseNumericalBundle';
import {
  setSparseAutoRouteBundleLoader,
} from '../src/workers/adjustmentSparseAutoRoute';
import {
  clearPreanalysisSparseAutoRouteTestHooks,
  derivePreanalysisSparseAutoRouteEligibility,
  runWithPreanalysisSparseAutoRoute,
  setPreanalysisSparseAutoRouteEnabled,
  setPreanalysisSparseAutoRouteTestHooks,
} from '../src/workers/preanalysisSparseAutoRoute';
import { createRunSessionRequest } from './helpers/runSessionRequest';

const REPORT_DIR = path.join(process.cwd(), 'reports/phase8b');
const BRIDGE_PATH = path.join(process.cwd(), 'scripts/phase8bPreanalysisWorkerBridge.ts');

const readFixture = (file: string): string => fs.readFileSync(path.join(process.cwd(), file), 'utf-8');
const SMALL_INPUT = readFixture('tests/fixtures/preanalysis_cli.dat');
const CAMP_INPUT = readFixture('tests/fixtures/camp_design_preanalysis_traverse_only.dat');

const makePreanalysisRequest = (input: string): RunSessionRequest => {
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

const stripVolatile = (result: unknown): unknown => {
  const clone = JSON.parse(JSON.stringify(result)) as Record<string, unknown>;
  delete clone.solveTimingProfile;
  if (Array.isArray(clone.logs)) {
    clone.logs = (clone.logs as string[]).filter((line) => !line.startsWith('Solve timing (ms):'));
  }
  return clone;
};

const stableKey = (outcome: RunSessionOutcome): string =>
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

/** Loads the real WASM factory, or null when the build is absent. */
const loadRealFactory = async (): Promise<WebNetWasmFactory | null> => {
  try {
    const imported = (await import(
      pathToFileURL(`${process.cwd()}/cpp/build-wasm/webnet_core.js`).href
    )) as unknown as { default: WebNetWasmFactory };
    if (typeof imported.default !== 'function') return null;
    return imported.default;
  } catch {
    return null;
  }
};

interface BridgeCounters {
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

interface BridgeRun {
  outcome: RunSessionOutcome;
  counters: BridgeCounters;
}

/** Drives one run through a fresh bridge worker with the given env. */
const runBridgeOnce = (
  payload: RunSessionRequest,
  runId: string,
  env: Record<string, string>,
  timeoutMs = 180000,
): Promise<BridgeRun> =>
  new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(BRIDGE_PATH, {
        execArgv: ['--import', 'tsx'],
        env: { ...process.env, ...env },
      });
    } catch (error) {
      reject(error);
      return;
    }
    let outcome: RunSessionOutcome | null = null;
    let counters: BridgeCounters | null = null;
    const done = (): void => {
      clearTimeout(timer);
      void worker.terminate();
      if (outcome && counters) resolve({ outcome, counters });
      else reject(new Error('bridge settled without outcome+diagnostics'));
    };
    const timer = setTimeout(() => {
      void worker.terminate();
      reject(new Error(`bridge did not settle within ${timeoutMs} ms`));
    }, timeoutMs);
    worker.on('message', (message: unknown) => {
      const record = message as { type?: unknown; runId?: unknown };
      if (record?.type === 'phase8b-diagnostics' && record.runId === runId) {
        counters = (record as { diagnostics: BridgeCounters }).diagnostics;
        if (outcome) done();
        return;
      }
      if (record?.type === 'success' && record.runId === runId) {
        outcome = (record as { payload: RunSessionOutcome }).payload;
        if (counters) done();
        return;
      }
      if (record?.type === 'failure' && record.runId === runId) {
        clearTimeout(timer);
        void worker.terminate();
        reject(new Error(`bridge run failed: ${(record as { error?: string }).error}`));
      }
    });
    worker.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    worker.postMessage({ type: 'run', runId, payload });
  });

const evidence: Record<string, unknown> = {};
const wasmMissing = { skip: false };

describe('phase 8B in-process real-WASM route', () => {
  it('stays default-OFF with no WASM init', async () => {
    setPreanalysisSparseAutoRouteEnabled(false);
    clearPreanalysisSparseAutoRouteTestHooks();
    expect(derivePreanalysisSparseAutoRouteEligibility(makePreanalysisRequest(SMALL_INPUT)).eligible).toBe(false);
    let initCalls = 0;
    const attempt = await runWithPreanalysisSparseAutoRoute(makePreanalysisRequest(SMALL_INPUT), undefined, {
      runSession: runAdjustmentSession,
      loadBundle: () => {
        initCalls += 1;
        throw new Error('must not init while disabled');
      },
    });
    expect(initCalls).toBe(0);
    expect(attempt.route).toBe('typescript');
    evidence.defaultOffInProcess = { route: attempt.route, initCalls };
    setPreanalysisSparseAutoRouteEnabled(false);
  });

  it('admits the small anchor through the real bundle when enabled', async () => {
    const factory = await loadRealFactory();
    if (!factory) {
      wasmMissing.skip = true;
      evidence.smallAnchorRealWasm = { skipped: 'WASM artifact absent' };
      return;
    }
    const real = await createExperimentalSparseNumericalBundle(factory);
    setSparseAutoRouteBundleLoader(() => Promise.resolve(real));
    setPreanalysisSparseAutoRouteEnabled(true);
    clearPreanalysisSparseAutoRouteTestHooks();
    try {
      const request = makePreanalysisRequest(SMALL_INPUT);
      expect(derivePreanalysisSparseAutoRouteEligibility(request).eligible).toBe(true);
      const attempt = await runWithPreanalysisSparseAutoRoute(request, undefined, {
        runSession: runAdjustmentSession,
      });
      expect(attempt.route).toBe('sparse');
      expect(attempt.reasons).toEqual([]);
      const direct = runAdjustmentSession(request);
      const comparison = comparePreanalysisContract(direct.result, attempt.outcome.result);
      expect(comparison.pass).toBe(true);
      evidence.smallAnchorRealWasm = {
        route: attempt.route,
        contractPass: true,
        maxCoordDiff: comparison.maxCoordDiff,
        maxCovarianceDiff: comparison.maxCovarianceDiff,
      };
    } finally {
      setPreanalysisSparseAutoRouteEnabled(false);
      setSparseAutoRouteBundleLoader(undefined);
    }
  }, 120000);

  it('holds back camp direction inflation before the Phase 9B sparse attempt', async () => {
    const factory = await loadRealFactory();
    if (!factory) {
      evidence.campCapRealWasm = { skipped: 'WASM artifact absent' };
      return;
    }
    const real = await createExperimentalSparseNumericalBundle(factory);
    setSparseAutoRouteBundleLoader(() => Promise.resolve(real));
    setPreanalysisSparseAutoRouteEnabled(true);
    clearPreanalysisSparseAutoRouteTestHooks();
    try {
      const request = makePreanalysisRequest(CAMP_INPUT);
      const eligibility = derivePreanalysisSparseAutoRouteEligibility(request);
      expect(eligibility.eligible).toBe(false);
      expect(eligibility.preflight?.admitted).toBe(false);
      const attempt = await runWithPreanalysisSparseAutoRoute(request, undefined, {
        runSession: runAdjustmentSession,
      });
      expect(attempt.route).toBe('typescript');
      expect(attempt.sparseAttempted).toBe(false);
      expect(attempt.bundleLoaded).toBe(false);
      expect(attempt.reasons.join(' ')).toMatch(/direction-heavy preflight holdback/);
      expect(stableKey(attempt.outcome)).toBe(stableKey(runAdjustmentSession(request)));
      evidence.campCapRealWasm = {
        route: attempt.route,
        reasonSample: attempt.reasons[0]?.slice(0, 120),
        restartIdentical: true,
      };
    } finally {
      setPreanalysisSparseAutoRouteEnabled(false);
      setSparseAutoRouteBundleLoader(undefined);
    }
  }, 120000);

  it('restarts identical on corrupted native covariance', async () => {
    const factory = await loadRealFactory();
    if (!factory) {
      evidence.corruptRestart = { skipped: 'WASM artifact absent' };
      return;
    }
    const real = await createExperimentalSparseNumericalBundle(factory);
    const corrupting = {
      ...real,
      sparseSelectedCovarianceSolver: {
        querySelected: (input: Parameters<typeof real.sparseSelectedCovarianceSolver.querySelected>[0]) => {
          const result = real.sparseSelectedCovarianceSolver.querySelected(input);
          const covariance = Float64Array.from(result.covariance);
          if (covariance.length > 0) covariance[0] = covariance[0]! * 4 + 1;
          return { ...result, covariance };
        },
      },
    };
    setPreanalysisSparseAutoRouteEnabled(true);
    clearPreanalysisSparseAutoRouteTestHooks();
    try {
      const request = makePreanalysisRequest(SMALL_INPUT);
      const attempt = await runWithPreanalysisSparseAutoRoute(request, undefined, {
        runSession: runAdjustmentSession,
        loadBundle: () => Promise.resolve(corrupting),
      });
      expect(attempt.route).toBe('typescript');
      expect(attempt.reasons.length).toBeGreaterThan(0);
      expect(stableKey(attempt.outcome)).toBe(stableKey(runAdjustmentSession(request)));
      evidence.corruptRestart = { route: attempt.route, restartIdentical: true };
    } finally {
      setPreanalysisSparseAutoRouteEnabled(false);
      setSparseAutoRouteBundleLoader(undefined);
    }
  }, 120000);

  it('honours the static unknown-count hook and policy-hook boundaries', async () => {
    // unknownCountOverride: 129 exercises the STATIC eligibility hook only;
    // the real per-system parameterCount boundary (including
    // direction-inflated counts such as the camp fixture's 170) is covered
    // by the Phase 8A.7 pre-dispatch gate tests, not here.
    const factory = await loadRealFactory();
    if (!factory) {
      evidence.boundaries = { skipped: 'WASM artifact absent' };
      return;
    }
    const real = await createExperimentalSparseNumericalBundle(factory);
    setSparseAutoRouteBundleLoader(() => Promise.resolve(real));
    setPreanalysisSparseAutoRouteEnabled(true);
    try {
      const request = makePreanalysisRequest(SMALL_INPUT);
      setPreanalysisSparseAutoRouteTestHooks({ unknownCountOverride: 129 });
      expect(derivePreanalysisSparseAutoRouteEligibility(request).eligible).toBe(false);
      setPreanalysisSparseAutoRouteTestHooks({ forceC2Failure: true });
      const forced = await runWithPreanalysisSparseAutoRoute(request, undefined, {
        runSession: runAdjustmentSession,
      });
      expect(forced.route).toBe('typescript');
      expect(forced.reasons.join(' ')).toMatch(/forced C2 failure/);
      expect(stableKey(forced.outcome)).toBe(stableKey(runAdjustmentSession(request)));
      evidence.boundaries = { staticUnknownHook129Eligible: false, forcedC2Fallback: true };
    } finally {
      clearPreanalysisSparseAutoRouteTestHooks();
      setPreanalysisSparseAutoRouteEnabled(false);
      setSparseAutoRouteBundleLoader(undefined);
    }
  }, 120000);
});

describe('phase 8B exact-dispatch worker bridge (real WASM)', () => {
  it('proves default OFF through exact dispatch (no WASM init)', async () => {
    const { outcome, counters } = await runBridgeOnce(makePreanalysisRequest(SMALL_INPUT), 'phase8b-off', {});
    expect(counters.bundleInitCount).toBe(0);
    expect(counters.realWasm).toBe(false);
    expect(counters.correctionCalls).toBe(0);
    expect(stableKey(outcome)).toBe(stableKey(runAdjustmentSession(makePreanalysisRequest(SMALL_INPUT))));
    evidence.workerDefaultOff = { initCalls: 0, deepEqualTypeScript: true };
  }, 180000);

  it('runs the small anchor sparsely with verification re-queries', async () => {
    const { outcome, counters } = await runBridgeOnce(makePreanalysisRequest(SMALL_INPUT), 'phase8b-anchor', {
      PHASE8B_ROUTE: '1',
      PHASE8B_WASM: '1',
    });
    expect(counters.realWasm).toBe(true);
    expect(counters.bundleInitCount).toBe(1);
    expect(counters.correctionCalls).toBeGreaterThan(0);
    expect(counters.correctionThrows).toBe(0);
    expect(counters.covarianceThrows).toBe(0);
    expect(counters.covarianceDamped).toBe(0);
    // Bounded verification re-queries run beside production queries.
    expect(counters.covarianceCalls).toBeGreaterThanOrEqual(counters.correctionCalls);
    const direct = runAdjustmentSession(makePreanalysisRequest(SMALL_INPUT));
    const comparison = comparePreanalysisContract(direct.result, outcome.result);
    expect(comparison.pass).toBe(true);
    evidence.workerAnchor = {
      correctionCalls: counters.correctionCalls,
      covarianceCalls: counters.covarianceCalls,
      contractPass: true,
      maxCoordDiff: comparison.maxCoordDiff,
      maxCovarianceDiff: comparison.maxCovarianceDiff,
    };
  }, 180000);

  it('falls back clean on the camp fixture through exact dispatch', async () => {
    const { outcome, counters } = await runBridgeOnce(makePreanalysisRequest(CAMP_INPUT), 'phase8b-camp', {
      PHASE8B_ROUTE: '1',
      PHASE8B_WASM: '1',
    });
    expect(counters.realWasm).toBe(true);
    expect(counters.covarianceThrows).toBe(0);
    expect(stableKey(outcome)).toBe(stableKey(runAdjustmentSession(makePreanalysisRequest(CAMP_INPUT))));
    evidence.workerCamp = { restartIdentical: true };
  }, 180000);

  it('falls back clean on WASM init failure (retry path)', async () => {
    const { outcome, counters } = await runBridgeOnce(makePreanalysisRequest(SMALL_INPUT), 'phase8b-initfail', {
      PHASE8B_ROUTE: '1',
      PHASE8B_WASM_FAIL: '1',
    });
    expect(counters.bundleInitCount).toBe(1);
    expect(counters.correctionCalls).toBe(0);
    expect(stableKey(outcome)).toBe(stableKey(runAdjustmentSession(makePreanalysisRequest(SMALL_INPUT))));
    evidence.workerInitFailure = { restartIdentical: true };
  }, 180000);

  it('interleaves runs, caches the bundle, and restarts after terminate', async () => {
    const env = { PHASE8B_ROUTE: '1', PHASE8B_WASM: '1' };
    await new Promise<void>((resolve, reject) => {
      const worker = new Worker(BRIDGE_PATH, { execArgv: ['--import', 'tsx'], env: { ...process.env, ...env } });
      const timer = setTimeout(() => {
        void worker.terminate();
        reject(new Error('interleave worker did not settle'));
      }, 240000);
      const outcomes = new Map<string, RunSessionOutcome>();
      const diagnostics = new Map<string, BridgeCounters>();
      const maybeDone = (): void => {
        if (outcomes.size === 3 && diagnostics.size === 3) {
          clearTimeout(timer);
          const small = stableKey(outcomes.get('phase8b-i1')!);
          const smallAgain = stableKey(outcomes.get('phase8b-i3')!);
          try {
            expect(smallAgain).toBe(small);
            const directSmall = runAdjustmentSession(makePreanalysisRequest(SMALL_INPUT));
            const comparison = comparePreanalysisContract(directSmall.result, outcomes.get('phase8b-i1')!.result);
            expect(comparison.pass).toBe(true);
            expect(stableKey(outcomes.get('phase8b-i2')!)).toBe(
              stableKey(runAdjustmentSession(makePreanalysisRequest(CAMP_INPUT))),
            );
            // One bundle init across three sequential sessions (cache proof).
            expect(diagnostics.get('phase8b-i3')!.bundleInitCount).toBe(1);
            evidence.workerInterleave = {
              bitIdenticalRepeat: true,
              bundleInitCount: diagnostics.get('phase8b-i3')!.bundleInitCount,
            };
          } catch (error) {
            reject(error);
            return;
          }
          void worker.terminate();
          resolve();
        }
      };
      worker.on('message', (message: unknown) => {
        const record = message as { type?: unknown; runId?: unknown };
        if (record?.type === 'phase8b-diagnostics' && typeof record.runId === 'string') {
          diagnostics.set(record.runId, (record as { diagnostics: BridgeCounters }).diagnostics);
          maybeDone();
          return;
        }
        if (record?.type === 'success' && typeof record.runId === 'string') {
          outcomes.set(record.runId, (record as { payload: RunSessionOutcome }).payload);
          maybeDone();
        }
      });
      worker.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      worker.postMessage({ type: 'run', runId: 'phase8b-i1', payload: makePreanalysisRequest(SMALL_INPUT) });
      const queueRest = (): void => {
        worker.postMessage({ type: 'run', runId: 'phase8b-i2', payload: makePreanalysisRequest(CAMP_INPUT) });
        worker.postMessage({ type: 'run', runId: 'phase8b-i3', payload: makePreanalysisRequest(SMALL_INPUT) });
      };
      setTimeout(queueRest, 1000);
    });
    // Terminate mid-run, then prove a fresh worker restarts clean.
    await new Promise<void>((resolve, reject) => {
      const worker = new Worker(BRIDGE_PATH, { execArgv: ['--import', 'tsx'], env: { ...process.env, ...env } });
      const timer = setTimeout(() => {
        void worker.terminate();
        reject(new Error('restart worker did not settle'));
      }, 180000);
      worker.on('message', (message: unknown) => {
        const record = message as { type?: unknown };
        if (record?.type === 'success') {
          clearTimeout(timer);
          void worker.terminate();
          evidence.workerRestart = { cleanAfterTerminate: true };
          resolve();
        }
      });
      worker.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      worker.postMessage({ type: 'run', runId: 'phase8b-kill', payload: makePreanalysisRequest(SMALL_INPUT) });
      setTimeout(() => void worker.terminate(), 50);
      setTimeout(() => {
        const worker2 = new Worker(BRIDGE_PATH, { execArgv: ['--import', 'tsx'], env: { ...process.env, ...env } });
        worker2.on('message', (message: unknown) => {
          const record = message as { type?: unknown };
          if (record?.type === 'success') {
            clearTimeout(timer);
            void worker2.terminate();
            evidence.workerRestart = { cleanAfterTerminate: true };
            resolve();
          }
        });
        worker2.once('error', (error) => {
          clearTimeout(timer);
          reject(error);
        });
        worker2.postMessage({ type: 'run', runId: 'phase8b-afterkill', payload: makePreanalysisRequest(SMALL_INPUT) });
      }, 500);
    });
  }, 300000);

  it('writes the deterministic release report', () => {
    fs.mkdirSync(REPORT_DIR, { recursive: true });
    const report = {
      phase: '8B',
      defaultRoute: 'typescript (kill switch OFF unless every gate passes)',
      wasmArtifact: 'cpp/build-wasm/webnet_core.js (+ .wasm)',
      verificationColumns: 16,
      gates: evidence,
      wasmAbsentSkipsRealBundle: wasmMissing.skip,
    };
    fs.writeFileSync(
      path.join(REPORT_DIR, 'preanalysis-release-report.json'),
      `${JSON.stringify(report, null, 2)}\n`,
    );
    const lines = [
      '# Phase 8B preanalysis release report (real-WASM, default-OFF)',
      '',
      '- Default route: TypeScript (kill switch OFF).',
      `- WASM artifact: cpp/build-wasm/webnet_core.js (+ .wasm)${wasmMissing.skip ? ' — ABSENT, real-bundle gates skipped' : ''}.`,
      '- Verification: bounded deterministic complete columns, hard k = 16 (no n^2 re-query, no full inverse/Qxx).',
      `- In-process default-OFF: ${JSON.stringify(evidence.defaultOffInProcess)}`,
      `- In-process small anchor (real bundle): ${JSON.stringify(evidence.smallAnchorRealWasm)}`,
      `- In-process camp cap fallback: ${JSON.stringify(evidence.campCapRealWasm)}`,
      `- In-process corrupt restart: ${JSON.stringify(evidence.corruptRestart)}`,
      `- In-process boundaries: ${JSON.stringify(evidence.boundaries)}`,
      `- Worker default-OFF: ${JSON.stringify(evidence.workerDefaultOff)}`,
      `- Worker anchor (native calls): ${JSON.stringify(evidence.workerAnchor)}`,
      `- Worker camp fallback: ${JSON.stringify(evidence.workerCamp)}`,
      `- Worker init-failure fallback: ${JSON.stringify(evidence.workerInitFailure)}`,
      `- Worker interleave/cache: ${JSON.stringify(evidence.workerInterleave)}`,
      `- Worker restart after terminate: ${JSON.stringify(evidence.workerRestart)}`,
      '',
      'Release posture: default stays OFF. Enabling requires every gate above to pass with the real bundle; any failure restarts the original request clean in TypeScript exactly once.',
      '',
    ];
    fs.writeFileSync(path.join(REPORT_DIR, 'preanalysis-release-report.md'), `${lines.join('\n')}\n`);
    expect(wasmMissing.skip).toBe(false);
  });
});
