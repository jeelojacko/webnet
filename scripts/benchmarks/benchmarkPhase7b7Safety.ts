/**
 * Phase 7B.7 safety-strategy benchmark (test-only, no routing).
 *
 * For each deterministic case size and each S0..S3 strategy, measures with
 * warmups + multiple runs: sparse-candidate end-to-end solve time, dense
 * oracle overhead over the strategy's required correction systems (S1:
 * first, S2: first two, S3: every iteration), strategy verdicts, and
 * memory. S0 runs the sparse candidate with preflight admission + final
 * agreement and no oracle. WASM module init is timed separately. One
 * actual-worker run per case records worker end-to-end time (skipped with
 * PHASE7B7_SKIP_WORKER=1).
 *
 * Usage: `npm run bench:phase7b7:safety [-- --quick]`
 * Outputs: reports/phase7b7/safety-benchmark-{quick,full}.{json,md}
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { Worker } from 'node:worker_threads';
import path from 'node:path';

import { LSAEngine } from '../../src/engine/adjust';
import {
  buildSolvePreparation,
  collectActiveObservationsForSolve,
} from '../../src/engine/adjustmentPreprocessing';
import { createExperimentalSparseRouteDiagnostics } from '../../src/engine/experimentalSparseDiagnostics';
import { parseInput } from '../../src/engine/parseInputCore';
import { measurePhase7b7FirstSystemOracle } from '../../src/engine/phase7b7FirstSystemOracle';
import {
  evaluatePhase7b7StrategyVerdict,
  type Phase7b7OracleSystemEvidence,
} from '../../src/engine/phase7b7StrategyVerdict';
import {
  listPhase7b7BenchmarkCases,
  phase7b7SizeSkipReason,
} from '../../src/engine/phase7b7BenchmarkCases';
import { evaluateSparseGeometryPreflight } from '../../src/engine/sparseGeometryPreflight';
import type { Phase7b7PreflightResult } from '../../src/engine/phase7b7StrategyVerdict';
import {
  renderPhase7b7ReportMarkdown,
  summarizePhase7b7Timings,
  type Phase7b7CaseReport,
  type Phase7b7Report,
} from '../../src/engine/phase7b7BenchmarkReport';
import {
  buildExperimentalSparseEngineOptions,
  createExperimentalSparseNumericalBundle,
} from '../../src/engine/wasm/experimentalSparseNumericalBundle';
import {
  PHASE7B7_STRATEGIES,
  type Phase7b7StrategyId,
} from '../../src/engine/phase7b7SafetyStrategies';
import {
  AllSystemsCaptureSolver,
  buildPhase7b7OracleEvidence,
} from '../../tests/helpers/phase7b7AllSystemsCapture';
import type { WebNetWasmFactory } from '../../src/engine/wasm/wasmTypes';
import {
  isAdjustmentWorkerResponseMessage,
  type AdjustmentWorkerRequestMessage,
} from '../../src/engine/adjustmentWorkerProtocol';
import { DEFAULT_CANADA_CRS_ID } from '../../src/engine/crsCatalog';
import {
  DEFAULT_QFIX_ANGULAR_SIGMA_SEC,
  DEFAULT_QFIX_LINEAR_SIGMA_M,
} from '../../src/engine/defaults';
import { DEFAULT_PLANNING_MAP_STATE } from '../../src/engine/planningMapState';
import type { RunSessionRequest } from '../../src/engine/runSession';
import type { InstrumentLibrary } from '../../src/types';

const quick = process.argv.includes('--quick');
const warmups = Number(process.env.BENCH_WARMUPS ?? (quick ? 1 : 2));
const runs = Number(process.env.BENCH_RUNS ?? (quick ? 3 : 5));
const maxUnknowns = Number(process.env.PHASE7B7_MAX_UNKNOWN_COUNT ?? 128);
const skipWorker = process.env.PHASE7B7_SKIP_WORKER === '1';
const BRIDGE_PATH = path.join(process.cwd(), 'scripts/phase7bAdjustmentWorkerBridge.ts');

const cpu = (() => {
  try {
    return os.cpus()[0]?.model ?? 'unknown';
  } catch {
    return 'unknown';
  }
})();

const gitCommit = (() => {
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
})();

/** Static preflight admission for one input (shared by every strategy). */
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

const memoryMb = (): { rssMb: number; heapUsedMb: number } => {
  const usage = process.memoryUsage();
  return { rssMb: usage.rss / 1048576, heapUsedMb: usage.heapUsed / 1048576 };
};

/** Script-local worker request builder (mirrors the test helper defaults).
 *
 * Kept local because the shared test helper pulls `industryParityCases`
 * (`?raw` .dat imports), which plain tsx cannot load outside vitest.
 */
const buildInstrumentLibrary = (): InstrumentLibrary => ({
  S9: {
    code: 'S9',
    desc: 'industry standard S9 0.5"',
    edm_const: 0.001,
    edm_ppm: 1,
    hzPrecision_sec: 0.5,
    dirPrecision_sec: 0.5,
    azBearingPrecision_sec: 0.5,
    vaPrecision_sec: 0.5,
    instCentr_m: 0.0015,
    tgtCentr_m: 0,
    vertCentr_m: 0,
    elevDiff_const_m: 0,
    elevDiff_ppm: 0,
    gpsStd_xy: 0,
    levStd_mmPerKm: 0,
  },
});

const buildWorkerRequest = (input: string): RunSessionRequest => ({
  input,
  lastRunInput: null,
  maxIterations: 10,
  convergenceLimit: 0.01,
  units: 'm',
  parseSettings: {
    solveProfile: 'industry-parity',
    coordMode: '2D',
    coordSystemMode: 'local',
    crsId: DEFAULT_CANADA_CRS_ID,
    localDatumScheme: 'average-scale',
    averageScaleFactor: 1,
    commonElevation: 0,
    averageGeoidHeight: 0,
    gnssVectorFrameDefault: 'gridNEU',
    gnssFrameConfirmed: false,
    verticalDeflectionNorthSec: 0,
    verticalDeflectionEastSec: 0,
    observationMode: { bearing: 'grid', distance: 'measured', angle: 'measured', direction: 'measured' },
    gridBearingMode: 'grid',
    gridDistanceMode: 'measured',
    gridAngleMode: 'measured',
    gridDirectionMode: 'measured',
    runMode: 'adjustment',
    preanalysisMode: false,
    preanalysisAccuracyThresholdMeters: 0.001,
    preanalysisMaxAddedSets: 5,
    clusterDetectionEnabled: false,
    autoSideshotEnabled: true,
    autoAdjustEnabled: false,
    autoAdjustMaxCycles: 3,
    autoAdjustMaxRemovalsPerCycle: 1,
    autoAdjustStdResThreshold: 4,
    suspectImpactMode: 'auto',
    order: 'EN',
    angleUnits: 'dms',
    angleStationOrder: 'atfromto',
    angleMode: 'auto',
    deltaMode: 'slope',
    mapMode: 'off',
    mapScaleFactor: 1,
    normalize: true,
    faceNormalizationMode: 'on',
    applyCurvatureRefraction: false,
    refractionCoefficient: 0.13,
    verticalReduction: 'none',
    levelWeight: undefined,
    levelLoopToleranceBaseMm: 0,
    levelLoopTolerancePerSqrtKmMm: 4,
    crsTransformEnabled: false,
    crsProjectionModel: 'legacy-equirectangular',
    crsLabel: '',
    crsGridScaleEnabled: false,
    crsGridScaleFactor: 1,
    crsConvergenceEnabled: false,
    crsConvergenceAngleRad: 0,
    geoidModelEnabled: false,
    geoidModelId: 'NGS-DEMO',
    geoidSourceFormat: 'builtin',
    geoidSourcePath: '',
    geoidInterpolation: 'bilinear',
    geoidHeightConversionEnabled: false,
    geoidOutputHeightDatum: 'orthometric',
    gpsLoopCheckEnabled: false,
    gpsAddHiHtEnabled: false,
    gpsAddHiHtHiM: 0,
    gpsAddHiHtHtM: 0,
    qFixLinearSigmaM: DEFAULT_QFIX_LINEAR_SIGMA_M,
    qFixAngularSigmaSec: DEFAULT_QFIX_ANGULAR_SIGMA_SEC,
    prismEnabled: false,
    prismOffset: 0,
    prismScope: 'global',
    descriptionReconcileMode: 'first',
    descriptionAppendDelimiter: ' | ',
    lonSign: 'west-negative',
    tsCorrelationEnabled: false,
    tsCorrelationRho: 0.25,
    tsCorrelationScope: 'set',
    robustMode: 'none',
    robustK: 1.5,
    parseCompatibilityMode: 'strict',
    parseModeMigrated: true,
  },
  projectInstruments: buildInstrumentLibrary(),
  selectedInstrument: 'S9',
  projectIncludeFiles: {},
  geoidSourceData: null,
  planningMap: DEFAULT_PLANNING_MAP_STATE,
  excludedIds: [],
  activePreanalysisAdditionIds: [],
  overrides: {},
  approvedClusterMerges: [],
});

/** One actual-worker run through the production bridge; resolves with wall ms. */
const timeActualWorker = (input: string, timeoutMs = 120000): Promise<number> =>
  new Promise((resolve, reject) => {
    const request: AdjustmentWorkerRequestMessage = {
      type: 'run',
      runId: `phase7b7-${Date.now()}`,
      payload: buildWorkerRequest(input),
    };
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
      reject(new Error(`worker did not settle within ${timeoutMs} ms`));
    }, timeoutMs);
    worker.on('message', (message: unknown) => {
      if ((message as { type?: unknown })?.type === 'test-diagnostics') return;
      if (!isAdjustmentWorkerResponseMessage(message)) {
        clearTimeout(timer);
        void worker.terminate();
        reject(new Error('worker emitted a message outside the protocol guard'));
        return;
      }
      if (message.type === 'success' || message.type === 'failure') {
        clearTimeout(timer);
        const elapsed = performance.now() - start;
        void worker.terminate();
        if (message.type === 'failure') reject(new Error(message.error));
        else resolve(elapsed);
      }
    });
    worker.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    worker.postMessage(request);
  });

// Module init is measured separately from per-case timings.
const initSamples: number[] = [];
let bundle: Awaited<ReturnType<typeof createExperimentalSparseNumericalBundle>> | null = null;
let wasmSkipReason: string | null = null;
for (let i = 0; i < 3; i += 1) {
  const start = performance.now();
  try {
    const imported = (await import(
      pathToFileURL(`${process.cwd()}/cpp/build-wasm/webnet_core.js`).href
    )) as unknown as { default: WebNetWasmFactory };
    bundle = await createExperimentalSparseNumericalBundle(imported.default);
    initSamples.push(performance.now() - start);
  } catch (error) {
    wasmSkipReason = error instanceof Error ? error.message : String(error);
    break;
  }
}
if (wasmSkipReason) {
  console.log(`[phase7b7] WASM unavailable, sparse strategies will skip: ${wasmSkipReason.slice(0, 160)}`);
}

const cases = listPhase7b7BenchmarkCases(quick);
const rows: Phase7b7CaseReport[] = [];
const workerEndToEnd: Array<{ caseId: string; unknowns: number; ms: number | null; note: string }> = [];

for (const benchmarkCase of cases) {
  const sizeSkip = phase7b7SizeSkipReason(benchmarkCase, maxUnknowns);
  if (sizeSkip) {
    for (const strategy of PHASE7B7_STRATEGIES) {
      rows.push({
        caseId: benchmarkCase.id,
        unknowns: benchmarkCase.unknownCount,
        strategy: strategy.id,
        accepted: false,
        handshakeReasons: [],
        endToEnd: summarizePhase7b7Timings([]),
        oracle: null,
        oracleSystems: 0,
        worstOracleSystem: null,
        maxOracleDiff: null,
        maxCoordDiffM: null,
        sparseFallbacks: 0,
        rssMb: 0,
        heapUsedMb: 0,
        skipReason: sizeSkip,
      });
    }
    continue;
  }
  const reference = new LSAEngine({ input: benchmarkCase.input }).solve();
  if (!reference.success || !reference.converged) {
    throw new Error(`Phase 7B.7 reference failed to converge for ${benchmarkCase.id}.`);
  }

  // Actual-worker end-to-end: one timed run per case through the real bridge.
  if (!skipWorker && bundle) {
    try {
      const ms = await timeActualWorker(benchmarkCase.input);
      workerEndToEnd.push({ caseId: benchmarkCase.id, unknowns: benchmarkCase.unknownCount, ms, note: 'actual-worker sparse run' });
    } catch (error) {
      workerEndToEnd.push({
        caseId: benchmarkCase.id,
        unknowns: benchmarkCase.unknownCount,
        ms: null,
        note: error instanceof Error ? error.message.slice(0, 160) : String(error),
      });
    }
  }

  const preflight = buildPreflight(benchmarkCase.input);

  for (const strategy of PHASE7B7_STRATEGIES) {
    const strategyId: Phase7b7StrategyId = strategy.id;
    if (!bundle) {
      rows.push({
        caseId: benchmarkCase.id,
        unknowns: benchmarkCase.unknownCount,
        strategy: strategyId,
        accepted: false,
        handshakeReasons: [],
        endToEnd: summarizePhase7b7Timings([]),
        oracle: null,
        oracleSystems: 0,
        worstOracleSystem: null,
        maxOracleDiff: null,
        maxCoordDiffM: null,
        sparseFallbacks: 0,
        rssMb: 0,
        heapUsedMb: 0,
        skipReason: `WASM unavailable: ${(wasmSkipReason ?? 'unknown').slice(0, 120)}`,
      });
      continue;
    }
    const solveCandidate = (): {
      elapsed: number;
      capture: AllSystemsCaptureSolver;
      fallbacks: number;
      result: ReturnType<LSAEngine['solve']>;
    } => {
      const diagnostics = createExperimentalSparseRouteDiagnostics();
      const capture = new AllSystemsCaptureSolver(bundle.sparseCorrectionSolver);
      const options = buildExperimentalSparseEngineOptions(
        { ...bundle, sparseCorrectionSolver: capture },
        diagnostics,
        true,
      );
      const start = performance.now();
      const result = new LSAEngine({ input: benchmarkCase.input, ...options }).solve();
      return {
        elapsed: performance.now() - start,
        capture,
        fallbacks:
          diagnostics.sparseCorrectionFallbacks +
          diagnostics.rowProductsFallbacks +
          diagnostics.selectedCovarianceFallbacks,
        result,
      };
    };
    for (let i = 0; i < warmups; i += 1) solveCandidate();
    const endToEndSamples: number[] = [];
    let last = solveCandidate();
    endToEndSamples.push(last.elapsed);
    for (let i = 1; i < runs; i += 1) {
      last = solveCandidate();
      endToEndSamples.push(last.elapsed);
    }
    const requiredPrefix =
      strategy.oracleSystemCount === 'all'
        ? last.capture.systems.length
        : Math.min(strategy.oracleSystemCount, last.capture.systems.length);

    // Oracle overhead: timed dense rebuilds + condition estimates over the
    // strategy's required correction-system prefix.
    let oracleSamples: number[] | null = null;
    if (requiredPrefix > 0) {
      oracleSamples = [];
      for (let i = 0; i < runs; i += 1) {
        let total = 0;
        for (let s = 0; s < requiredPrefix; s += 1) {
          const system = last.capture.systems[s];
          if (!system) continue;
          const measured = measurePhase7b7FirstSystemOracle(system.input, system.result?.conditionEstimate);
          total += measured.rebuildMs + measured.conditionMs;
        }
        oracleSamples.push(total);
      }
    }
    const evidence: Phase7b7OracleSystemEvidence[] = buildPhase7b7OracleEvidence(last.capture.systems);
    const verdict = evaluatePhase7b7StrategyVerdict({
      strategy: strategyId,
      reference,
      candidate: last.result,
      systems: evidence,
      captureTruncated: last.capture.truncated,
      preflight,
    });
    const mem = memoryMb();
    rows.push({
      caseId: benchmarkCase.id,
      unknowns: benchmarkCase.unknownCount,
      strategy: strategyId,
      accepted: verdict.accepted,
      handshakeReasons: verdict.reasons,
      endToEnd: summarizePhase7b7Timings(endToEndSamples),
      oracle: oracleSamples ? summarizePhase7b7Timings(oracleSamples) : null,
      oracleSystems: verdict.oracledSystemCount,
      worstOracleSystem: verdict.worstSystemIndex,
      maxOracleDiff: verdict.oracledSystemCount > 0 ? verdict.maxCorrectionDiff : null,
      maxCoordDiffM: verdict.maxCoordDiffM,
      sparseFallbacks: last.fallbacks,
      rssMb: mem.rssMb,
      heapUsedMb: mem.heapUsedMb,
    });
  }
}

const report: Phase7b7Report = {
  generatedAt: new Date().toISOString(),
  node: process.version,
  platform: `${process.platform}-${process.arch}`,
  cpu,
  gitCommit,
  warmups,
  quick,
  moduleInit: summarizePhase7b7Timings(initSamples),
  rows,
};

mkdirSync('reports/phase7b7', { recursive: true });
const suffix = quick ? 'quick' : 'full';
const payload = { ...report, workerEndToEnd };
writeFileSync(`reports/phase7b7/safety-benchmark-${suffix}.json`, `${JSON.stringify(payload, null, 2)}\n`);
let markdown = renderPhase7b7ReportMarkdown(report);
if (workerEndToEnd.length > 0) {
  markdown += `## Actual-worker end-to-end (one timed run per case)\n\n`;
  markdown += `| Case | Unknowns | Worker ms | Note |\n| --- | --- | --- | --- |\n`;
  for (const entry of workerEndToEnd) {
    markdown += `| ${entry.caseId} | ${entry.unknowns} | ${entry.ms == null ? '-' : entry.ms.toFixed(2)} | ${entry.note} |\n`;
  }
  markdown += `\n`;
}
writeFileSync(`reports/phase7b7/safety-benchmark-${suffix}.md`, markdown);
console.log(markdown);
console.log(`Wrote reports/phase7b7/safety-benchmark-${suffix}.json/.md.`);
