/**
 * Phase 7B.7 safety-strategy benchmark tests (test-only, no routing).
 *
 * Proves the exact strategy semantics — S0 static-preflight+sparse, S1
 * first-system oracle, S2 first two systems, S3 every correction
 * iteration — with pure verdict unit tests plus a live WASM-gated proof
 * that a strong chain clears S0..S3 while the weak resection is held at
 * preflight. Also covers timing stats/report determinism, one
 * actual-worker end-to-end timing, and clean restart after an injected
 * sparse failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { describe, expect, it } from 'vitest';

import { LSAEngine } from '../src/engine/adjust';
import {
  buildSolvePreparation,
  collectActiveObservationsForSolve,
} from '../src/engine/adjustmentPreprocessing';
import { createExperimentalSparseRouteDiagnostics } from '../src/engine/experimentalSparseDiagnostics';
import { parseInput } from '../src/engine/parseInputCore';
import { PHASE7B6_CORRECTION_TOLERANCE } from '../src/engine/phase7b6CorrectionHandshake';
import {
  listPhase7b7BenchmarkCases,
  phase7b7SizeSkipReason,
  PHASE7B7_BENCHMARK_SIZES,
} from '../src/engine/phase7b7BenchmarkCases';
import {
  renderPhase7b7ReportMarkdown,
  summarizePhase7b7Timings,
  type Phase7b7Report,
} from '../src/engine/phase7b7BenchmarkReport';
import {
  PHASE7B7_RECOMMENDED_MAX_UNKNOWN_COUNT,
  PHASE7B7_RECOMMENDED_STRATEGY,
  PHASE7B7_STRATEGIES,
  phase7b7StrategyById,
} from '../src/engine/phase7b7SafetyStrategies';
import {
  evaluatePhase7b7StrategyVerdict,
  type Phase7b7OracleSystemEvidence,
  type Phase7b7PreflightResult,
} from '../src/engine/phase7b7StrategyVerdict';
import { evaluateSparseGeometryPreflight } from '../src/engine/sparseGeometryPreflight';
import { SPARSE_CONDITION_THRESHOLD } from '../src/engine/sparseNormalCondition';
import { createExperimentalSparseNumericalBundle } from '../src/engine/wasm/experimentalSparseNumericalBundle';
import type { WebNetWasmFactory } from '../src/engine/wasm/wasmTypes';
import {
  isAdjustmentWorkerResponseMessage,
  type AdjustmentWorkerRequestMessage,
  type AdjustmentWorkerResponseMessage,
} from '../src/engine/adjustmentWorkerProtocol';
import { runPhase7b7LiveStrategy, verdictForPhase7b7Run } from './helpers/phase7b7AllSystemsCapture';
import { createRunSessionRequest } from './helpers/runSessionRequest';

const BRIDGE_PATH = path.join(process.cwd(), 'scripts/phase7bAdjustmentWorkerBridge.ts');

const readExample = (file: string): string =>
  fs.readFileSync(path.join(process.cwd(), 'public/examples', file), 'utf-8');

const RESECTION = readExample('industry_resection_pillars.dat');

const loadWasmFactory = async (): Promise<WebNetWasmFactory | null> => {
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

const buildPreflight = (input: string): Phase7b7PreflightResult => {
  const parsed = parseInput(input);
  const is2D = (parsed.parseState?.coordMode ?? '2D') === '2D';
  const active = collectActiveObservationsForSolve(parsed.observations, undefined, is2D);
  const prep = buildSolvePreparation(parsed.stations, parsed.unknowns, active, is2D);
  const verdict = evaluateSparseGeometryPreflight({
    stations: parsed.stations,
    observations: parsed.observations,
    unknowns: parsed.unknowns,
    is2D,
    numParams: prep.numParams,
    numObsEquations: prep.numObsEquations,
    directionSetIds: prep.directionSetIds,
  });
  return { eligible: verdict.eligible, reasons: verdict.reasons };
};

const cleanSystem = (
  overrides: Partial<Phase7b7OracleSystemEvidence> = {},
): Phase7b7OracleSystemEvidence => ({
  parameterCount: 3,
  denseCorrection: [0.1, -0.2, 0.05],
  sparseCorrection: [0.1, -0.2, 0.05],
  sparseDamping: 0,
  conditionEstimate: 1e6,
  conditionSource: 'native-sparse',
  ...overrides,
});

describe('phase 7B.7 safety strategies', () => {
  it('defines exactly S0..S3 with the required oracle coverage', () => {
    expect(PHASE7B7_STRATEGIES.map((strategy) => strategy.id)).toEqual(['S0', 'S1', 'S2', 'S3']);
    expect(PHASE7B7_STRATEGIES.map((strategy) => strategy.label)).toEqual([
      'static-preflight+sparse',
      'first-system-oracle',
      'first-two-systems',
      'every-iteration',
    ]);
    for (const strategy of PHASE7B7_STRATEGIES) {
      expect(strategy.runsSparseCandidate).toBe(true);
      expect(strategy.requiresPreflight).toBe(true);
      expect(strategy.requiresFinalAgreement).toBe(true);
    }
    expect(phase7b7StrategyById('S0').oracleSystemCount).toBe(0);
    expect(phase7b7StrategyById('S1').oracleSystemCount).toBe(1);
    expect(phase7b7StrategyById('S2').oracleSystemCount).toBe(2);
    expect(phase7b7StrategyById('S3').oracleSystemCount).toBe('all');
    expect(phase7b7StrategyById('S0').requiresConditionEvidence).toBe(false);
    expect(phase7b7StrategyById('S1').requiresConditionEvidence).toBe(true);
    expect(() => phase7b7StrategyById('S9' as never)).toThrow(/Unknown Phase 7B\.7 strategy/);
  });

  it('keeps the conservative cap/policy (S3, at most 128 unknowns)', () => {
    expect(PHASE7B7_RECOMMENDED_STRATEGY).toBe('S3');
    expect(PHASE7B7_RECOMMENDED_MAX_UNKNOWN_COUNT).toBeLessThanOrEqual(128);
    expect(PHASE7B7_RECOMMENDED_MAX_UNKNOWN_COUNT).toBeGreaterThanOrEqual(16);
  });
});

describe('phase 7B.7 strategy verdict gates', () => {
  const chain8 = listPhase7b7BenchmarkCases(true)[0];
  if (!chain8) throw new Error('missing chain-2d-08 benchmark case');
  const CHAIN8 = chain8.input;
  const reference = new LSAEngine({ input: CHAIN8 }).solve();
  const candidate = new LSAEngine({ input: CHAIN8 }).solve();
  const preflight = buildPreflight(CHAIN8);
  expect(preflight.eligible).toBe(true);

  it('S0 accepts on preflight + final agreement with no oracle', () => {
    const verdict = evaluatePhase7b7StrategyVerdict({
      strategy: 'S0',
      reference,
      candidate,
      systems: [],
      captureTruncated: false,
      preflight,
    });
    expect(verdict.accepted).toBe(true);
    expect(verdict.oracledSystemCount).toBe(0);
  });

  it('every level rejects when preflight is ineligible', () => {
    const weak = buildPreflight(RESECTION);
    expect(weak.eligible).toBe(false);
    for (const strategy of ['S0', 'S1', 'S2', 'S3'] as const) {
      const verdict = evaluatePhase7b7StrategyVerdict({
        strategy,
        reference,
        candidate,
        systems: strategy === 'S0' ? [] : [cleanSystem(), cleanSystem()],
        captureTruncated: false,
        preflight: weak,
      });
      expect(verdict.accepted, `${strategy} holds the resection`).toBe(false);
      expect(verdict.reasons.join(' ')).toMatch(/preflight/);
    }
  });

  it('S1 gates the first system: missing evidence, damping, and condition reject', () => {
    const base = {
      strategy: 'S1' as const,
      reference,
      candidate,
      captureTruncated: false,
      preflight,
    };
    expect(
      evaluatePhase7b7StrategyVerdict({ ...base, systems: [] }).accepted,
    ).toBe(false);
    expect(
      evaluatePhase7b7StrategyVerdict({ ...base, systems: [cleanSystem()] }).accepted,
    ).toBe(true);
    expect(
      evaluatePhase7b7StrategyVerdict({
        ...base,
        systems: [cleanSystem({ sparseDamping: 1e-8 })],
      }).reasons.join(' '),
    ).toMatch(/damping/);
    const { conditionEstimate: _dropped, conditionSource: _droppedSource, ...bare } =
      cleanSystem();
    void _dropped;
    void _droppedSource;
    expect(
      evaluatePhase7b7StrategyVerdict({ ...base, systems: [bare] }).reasons.join(' '),
    ).toMatch(/no finite condition estimate/);
    // Production-level condition excess warns exactly like production.
    expect(1.9e50).toBeGreaterThan(SPARSE_CONDITION_THRESHOLD);
    const excess = evaluatePhase7b7StrategyVerdict({
      ...base,
      systems: [cleanSystem({ conditionEstimate: 1.9e50 })],
    });
    expect(excess.accepted).toBe(true);
    expect(excess.warnings.join(' ')).toMatch(/ill-conditioned/);
    // Correction disagreement above tolerance rejects on iteration 1.
    const diverged = evaluatePhase7b7StrategyVerdict({
      ...base,
      systems: [cleanSystem({ sparseCorrection: [0.1, -0.2, 0.05 + 1e-6] })],
    });
    expect(diverged.accepted).toBe(false);
    expect(diverged.worstSystemIndex).toBe(0);
    expect(diverged.worstParamIndex).toBe(2);
  });

  it('S2 requires two agreeing systems and pins blame on iteration 2', () => {
    const base = {
      strategy: 'S2' as const,
      reference,
      candidate,
      captureTruncated: false,
      preflight,
    };
    expect(
      evaluatePhase7b7StrategyVerdict({ ...base, systems: [cleanSystem()] }).reasons.join(' '),
    ).toMatch(/only 1 system\(s\) captured, 2 required/);
    expect(
      evaluatePhase7b7StrategyVerdict({ ...base, systems: [cleanSystem(), cleanSystem()] }).accepted,
    ).toBe(true);
    const secondBad = evaluatePhase7b7StrategyVerdict({
      ...base,
      systems: [cleanSystem(), cleanSystem({ sparseCorrection: [9.9, -0.2, 0.05] })],
    });
    expect(secondBad.accepted).toBe(false);
    expect(secondBad.worstSystemIndex).toBe(1);
  });

  it('S3 requires captured count to equal the iteration count', () => {
    const twoIters = { ...candidate, iterations: 2 };
    const twoIterRef = { ...reference, iterations: 2 };
    const base = {
      strategy: 'S3' as const,
      reference: twoIterRef,
      candidate: twoIters,
      captureTruncated: false,
      preflight,
    };
    const full = evaluatePhase7b7StrategyVerdict({
      ...base,
      systems: [cleanSystem(), cleanSystem()],
    });
    expect(full.accepted).toBe(true);
    expect(full.oracledSystemCount).toBe(2);
    const short = evaluatePhase7b7StrategyVerdict({
      ...base,
      systems: [cleanSystem()],
    });
    expect(short.accepted).toBe(false);
    expect(short.reasons.join(' ')).toMatch(/captured 1 systems != 2 iterations/);
    const truncated = evaluatePhase7b7StrategyVerdict({
      ...base,
      systems: [cleanSystem(), cleanSystem()],
      captureTruncated: true,
    });
    expect(truncated.accepted).toBe(false);
    expect(truncated.reasons.join(' ')).toMatch(/capture truncated/);
  });

  it('still screens final-result divergence at every level', () => {
    const firstId = Object.keys(reference.stations).sort()[0] as string;
    const stations = { ...candidate.stations };
    const station = stations[firstId];
    if (!station) throw new Error('missing station');
    stations[firstId] = { ...station, x: station.x + 1.1e25 };
    const diverged = { ...candidate, stations };
    for (const strategy of ['S0', 'S1', 'S2', 'S3'] as const) {
      const verdict = evaluatePhase7b7StrategyVerdict({
        strategy,
        reference,
        candidate: diverged,
        systems: strategy === 'S0' ? [] : [cleanSystem(), cleanSystem()],
        captureTruncated: false,
        preflight,
      });
      expect(verdict.accepted, `${strategy} screens divergence`).toBe(false);
      expect(verdict.reasons.join(' ')).toMatch(/coordinate agreement/);
    }
  });
});

describe('phase 7B.7 benchmark cases', () => {
  it('covers the representative sizes deterministically', () => {
    expect([...PHASE7B7_BENCHMARK_SIZES]).toEqual([8, 16, 25, 50, 64, 96, 128]);
    const first = listPhase7b7BenchmarkCases(false);
    const second = listPhase7b7BenchmarkCases(false);
    expect(first.map((entry) => entry.unknownCount)).toEqual([8, 16, 25, 50, 64, 96, 128]);
    expect(first.map((entry) => entry.id)).toEqual(second.map((entry) => entry.id));
    for (let index = 0; index < first.length; index += 1) {
      expect(second[index]?.input).toBe(first[index]?.input);
      expect(second[index]?.seed).toBe(first[index]?.seed);
    }
    const quick = listPhase7b7BenchmarkCases(true);
    expect(quick.map((entry) => entry.unknownCount)).toEqual([8, 16]);
  });

  it('guards oversized candidates fail-closed', () => {
    const full = listPhase7b7BenchmarkCases(false);
    const large = full.find((entry) => entry.unknownCount === 128);
    expect(large).toBeDefined();
    if (!large) return;
    expect(phase7b7SizeSkipReason(large, 128)).toBeNull();
    expect(phase7b7SizeSkipReason(large, 64)).toMatch(/size guard/);
  });
});

describe('phase 7B.7 stats and report builders', () => {
  it('summarizes median/min/p95/max deterministically', () => {
    const stats = summarizePhase7b7Timings([4, 1, 3, 2, 5]);
    expect(stats).toEqual({ medianMs: 3, minMs: 1, p95Ms: 5, maxMs: 5, runs: 5 });
    expect(summarizePhase7b7Timings([])).toEqual({ medianMs: 0, minMs: 0, p95Ms: 0, maxMs: 0, runs: 0 });
    expect(summarizePhase7b7Timings([7, 7, 7])).toEqual({ medianMs: 7, minMs: 7, p95Ms: 7, maxMs: 7, runs: 3 });
  });

  it('renders rows in size-then-strategy order, byte-stable on rerun', () => {
    const report: Phase7b7Report = {
      generatedAt: '2026-09-05T00:00:00.000Z',
      node: 'test',
      platform: 'test',
      cpu: 'test',
      gitCommit: 'test',
      warmups: 1,
      quick: true,
      moduleInit: summarizePhase7b7Timings([10, 12]),
      rows: [
        {
          caseId: 'chain-2d-16', unknowns: 16, strategy: 'S3', accepted: true, handshakeReasons: [],
          endToEnd: summarizePhase7b7Timings([5]), oracle: summarizePhase7b7Timings([1, 2]),
          oracleSystems: 4, worstOracleSystem: 0, maxOracleDiff: 1e-15,
          maxCoordDiffM: 2e-15, sparseFallbacks: 0, rssMb: 100, heapUsedMb: 30,
        },
        {
          caseId: 'chain-2d-08', unknowns: 8, strategy: 'S0', accepted: true, handshakeReasons: [],
          endToEnd: summarizePhase7b7Timings([3]), oracle: null,
          oracleSystems: 0, worstOracleSystem: null, maxOracleDiff: null,
          maxCoordDiffM: 0, sparseFallbacks: 0, rssMb: 99, heapUsedMb: 29,
        },
      ],
    };
    const first = renderPhase7b7ReportMarkdown(report);
    const second = renderPhase7b7ReportMarkdown(report);
    expect(second).toBe(first);
    expect(first.indexOf('chain-2d-08')).toBeLessThan(first.indexOf('chain-2d-16'));
    expect(first).toMatch(/Oracle systems/);
  });
});

describe('phase 7B.7 live oracle and strategy verdicts', () => {
  it('strong chain captures every iteration and clears S0..S3; resection held at preflight', async () => {
    const factory = await loadWasmFactory();
    if (!factory) {
      console.log('[phase7b7] WASM artifact unavailable; skipping live oracle');
      return;
    }
    const bundle = await createExperimentalSparseNumericalBundle(factory);
    const chain8 = listPhase7b7BenchmarkCases(true)[0];
    expect(chain8).toBeDefined();
    if (!chain8) return;

    const run = runPhase7b7LiveStrategy({
      input: chain8.input,
      maxIterations: 10,
      sparseSolver: bundle.sparseCorrectionSolver,
    });
    expect(run.recorder.truncated).toBe(false);
    // One sparse call per correction iteration: "every iteration" is exact.
    expect(run.recorder.systems.length).toBeGreaterThanOrEqual(2);
    expect(run.recorder.systems.length).toBe(run.candidate.iterations);
    expect(run.evidence.length).toBe(run.recorder.systems.length);

    const preflight = buildPreflight(chain8.input);
    expect(preflight.eligible).toBe(true);
    for (const strategy of ['S0', 'S1', 'S2', 'S3'] as const) {
      const verdict = verdictForPhase7b7Run(run, strategy, preflight);
      expect(verdict.accepted, `${strategy} clears the strong chain`).toBe(true);
    }
    const s3 = verdictForPhase7b7Run(run, 'S3', preflight);
    expect(s3.oracledSystemCount).toBe(run.recorder.systems.length);
    expect(s3.maxCorrectionDiff).toBeLessThanOrEqual(PHASE7B6_CORRECTION_TOLERANCE);

    // The weak resection is held at preflight under every level.
    const weak = buildPreflight(RESECTION);
    expect(weak.eligible).toBe(false);
    for (const strategy of ['S0', 'S1', 'S2', 'S3'] as const) {
      const verdict = verdictForPhase7b7Run(run, strategy, weak);
      expect(verdict.accepted, `${strategy} holds the resection`).toBe(false);
      expect(verdict.reasons.join(' ')).toMatch(/preflight/);
    }

    // Oracle overhead is measured, not assumed.
    const rebuildStart = performance.now();
    const rerun = runPhase7b7LiveStrategy({
      input: chain8.input,
      maxIterations: 10,
      sparseSolver: bundle.sparseCorrectionSolver,
    });
    const rebuildMs = performance.now() - rebuildStart;
    expect(Number.isFinite(rebuildMs) && rebuildMs >= 0).toBe(true);
    expect(verdictForPhase7b7Run(rerun, 'S3', preflight).accepted).toBe(true);
  }, 180000);

  it('records one actual-worker end-to-end timing with zero fallbacks', async () => {
    const factory = await loadWasmFactory();
    if (!factory) {
      console.log('[phase7b7] WASM artifact unavailable; skipping actual-worker timing');
      return;
    }
    const chain8 = listPhase7b7BenchmarkCases(true)[0];
    if (!chain8) return;
    const request: AdjustmentWorkerRequestMessage = {
      type: 'run',
      runId: 'phase7b7-worker-timing',
      payload: createRunSessionRequest({ input: chain8.input }),
    };
    const outcome = await new Promise<{
      messages: AdjustmentWorkerResponseMessage[];
      diagnostics: { sparseCorrectionFallbacks: number };
      ms: number;
    }>((resolve, reject) => {
      const messages: AdjustmentWorkerResponseMessage[] = [];
      let diagnostics: { sparseCorrectionFallbacks: number } | null = null;
      let worker: Worker;
      try {
        worker = new Worker(BRIDGE_PATH, { execArgv: ['--import', 'tsx'] });
      } catch (error) {
        reject(error);
        return;
      }
      const start = performance.now();
      const timer = setTimeout(() => {
        void worker.terminate();
        reject(new Error('worker did not settle within 120000 ms'));
      }, 120000);
      worker.on('message', (message: unknown) => {
        const record = message as { type?: unknown };
        if (record?.type === 'test-diagnostics') {
          diagnostics = (record as { diagnostics: { sparseCorrectionFallbacks: number } }).diagnostics;
          // The bridge posts success BEFORE diagnostics, so a stored
          // success may already be waiting for this snapshot.
          const settled = messages[messages.length - 1];
          if (settled?.type === 'success') {
            clearTimeout(timer);
            const ms = performance.now() - start;
            void worker.terminate();
            resolve({ messages, diagnostics, ms });
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
          if (message.type === 'failure') {
            clearTimeout(timer);
            void worker.terminate();
            reject(new Error(message.error));
            return;
          }
          // Success may arrive before the trailing diagnostics snapshot;
          // resolve now only when diagnostics already landed.
          if (diagnostics) {
            clearTimeout(timer);
            const ms = performance.now() - start;
            void worker.terminate();
            resolve({ messages, diagnostics, ms });
          }
        }
      });
      worker.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      worker.postMessage(request);
    });
    const success = outcome.messages[outcome.messages.length - 1];
    expect(success?.type).toBe('success');
    if (success?.type !== 'success') return;
    expect(success.payload.result.success).toBe(true);
    expect(outcome.diagnostics.sparseCorrectionFallbacks).toBe(0);
    expect(Number.isFinite(outcome.ms) && outcome.ms > 0).toBe(true);
    console.log(`[phase7b7] actual-worker chain-2d-08 end-to-end ${outcome.ms.toFixed(2)} ms`);
  }, 150000);

  it('proves exact legacy precision survives an injected sparse failure with clean restart', () => {
    const chain8 = listPhase7b7BenchmarkCases(true)[0];
    if (!chain8) return;
    const cleanReference = new LSAEngine({ input: chain8.input }).solve();
    expect(cleanReference.success).toBe(true);
    const diagnostics = createExperimentalSparseRouteDiagnostics();
    const degraded = new LSAEngine({
      input: chain8.input,
      sparseCorrectionSolver: {
        solveFromEquations: (): never => {
          throw new Error('injected phase7b7 sparse failure');
        },
      },
      experimentalSparseDiagnostics: diagnostics,
    }).solve();
    expect(degraded.success).toBe(true);
    expect(diagnostics.sparseCorrectionFallbacks).toBeGreaterThan(0);
    const restart = new LSAEngine({ input: chain8.input }).solve();
    for (const [id, station] of Object.entries(cleanReference.stations)) {
      const other = restart.stations[id];
      expect(other, `station ${id} restarts identically`).toBeDefined();
      expect(other?.x).toBe(station.x);
      expect(other?.y).toBe(station.y);
    }
  });
});
