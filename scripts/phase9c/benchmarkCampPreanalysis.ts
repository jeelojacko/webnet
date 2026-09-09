import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import type { SparseSelectedCovarianceInput, SparseSelectedCovarianceResult } from '../../src/engine/numericalBackend';
import { createExperimentalSparseNumericalBundle } from '../../src/engine/wasm/experimentalSparseNumericalBundle';
import type { WebNetWasmFactory } from '../../src/engine/wasm/wasmTypes';
import { runAdjustmentSession, type RunSessionOutcome, type RunSessionRequest } from '../../src/engine/runSession';
import { DEFAULT_CANADA_CRS_ID } from '../../src/engine/crsCatalog';
import { DEFAULT_QFIX_ANGULAR_SIGMA_SEC, DEFAULT_QFIX_LINEAR_SIGMA_M, DEFAULT_S9_INSTRUMENT_CENTERING_HORIZ_M } from '../../src/engine/defaults';
import { DEFAULT_PLANNING_MAP_STATE } from '../../src/engine/planningMapState';
import type { RunSessionParseSettings } from '../../src/engine/runSessionTypes';
import { createExperimentalSparseRouteDiagnostics } from '../../src/engine/experimentalSparseDiagnostics';
import {
  clearPreanalysisSparseAutoRouteTestHooks,
  PreanalysisGatedCorrectionSolver,
  PreanalysisGatedCovarianceCapture,
  derivePreanalysisSparseAutoRouteEligibility,
  runWithPreanalysisSparseAutoRoute,
  setPreanalysisSparseAutoRouteEnabled,
  setPreanalysisSparseAutoRouteTestHooks,
} from '../../src/workers/preanalysisSparseAutoRoute';
import type { PreanalysisVerifierTimingSink } from '../../src/workers/preanalysisSparseCovarianceGate';
import { createPreanalysisCandidateState } from '../../src/workers/preanalysisSparseAutoRouteCaps';
import { accumulatePackedNormal, evaluateSentinelC1, evaluateSentinelC2, probeSelectedCovariance } from '../../src/engine/preanalysisSparseCovarianceSentinel';

const fixturePath = path.resolve('tests/fixtures/camp_design_preanalysis_traverse_only.dat');
const input = fs.readFileSync(fixturePath, 'utf8');
const makeRequest = (overrides: Partial<RunSessionRequest> = {}): RunSessionRequest => {
  const parseSettings: RunSessionParseSettings = {
    solveProfile: 'industry-parity', coordMode: '2D', coordSystemMode: 'local', crsId: DEFAULT_CANADA_CRS_ID,
    localDatumScheme: 'average-scale', averageScaleFactor: 1, commonElevation: 0, averageGeoidHeight: 0,
    gnssVectorFrameDefault: 'gridNEU', gnssFrameConfirmed: false, verticalDeflectionNorthSec: 0, verticalDeflectionEastSec: 0,
    observationMode: { bearing: 'grid', distance: 'measured', angle: 'measured', direction: 'measured' },
    gridBearingMode: 'grid', gridDistanceMode: 'measured', gridAngleMode: 'measured', gridDirectionMode: 'measured',
    runMode: 'preanalysis', preanalysisMode: true, preanalysisAccuracyThresholdMeters: 0.001, preanalysisMaxAddedSets: 5,
    clusterDetectionEnabled: false, autoSideshotEnabled: true, autoAdjustEnabled: false, autoAdjustMaxCycles: 3,
    autoAdjustMaxRemovalsPerCycle: 1, autoAdjustStdResThreshold: 4, suspectImpactMode: 'auto', order: 'EN', angleUnits: 'dms',
    angleStationOrder: 'atfromto', angleMode: 'auto', deltaMode: 'slope', mapMode: 'off', mapScaleFactor: 1, normalize: true,
    faceNormalizationMode: 'on', applyCurvatureRefraction: false, refractionCoefficient: 0.13, verticalReduction: 'none',
    levelWeight: undefined, levelLoopToleranceBaseMm: 0, levelLoopTolerancePerSqrtKmMm: 4, crsTransformEnabled: false,
    crsProjectionModel: 'legacy-equirectangular', crsLabel: '', crsGridScaleEnabled: false, crsGridScaleFactor: 1,
    crsConvergenceEnabled: false, crsConvergenceAngleRad: 0, geoidModelEnabled: false, geoidModelId: 'NGS-DEMO',
    geoidSourceFormat: 'builtin', geoidSourcePath: '', geoidInterpolation: 'bilinear', geoidHeightConversionEnabled: false,
    geoidOutputHeightDatum: 'orthometric', gpsLoopCheckEnabled: false, gpsAddHiHtEnabled: false, gpsAddHiHtHiM: 0,
    gpsAddHiHtHtM: 0, qFixLinearSigmaM: DEFAULT_QFIX_LINEAR_SIGMA_M, qFixAngularSigmaSec: DEFAULT_QFIX_ANGULAR_SIGMA_SEC,
    prismEnabled: false, prismOffset: 0, prismScope: 'global', descriptionReconcileMode: 'first', descriptionAppendDelimiter: ' | ',
    lonSign: 'west-negative', tsCorrelationEnabled: false, tsCorrelationRho: 0.25, tsCorrelationScope: 'set', robustMode: 'none',
    robustK: 1.5, parseCompatibilityMode: 'strict', parseModeMigrated: true,
  };
  return {
    input, lastRunInput: null, maxIterations: 10, convergenceLimit: 0.01, units: 'm', parseSettings,
    projectInstruments: { S9: { code: 'S9', desc: 'industry standard S9 0.5"', edm_const: 0.001, edm_ppm: 1, hzPrecision_sec: 0.5, dirPrecision_sec: 0.5, azBearingPrecision_sec: 0.5, vaPrecision_sec: 0.5, instCentr_m: DEFAULT_S9_INSTRUMENT_CENTERING_HORIZ_M, tgtCentr_m: 0, vertCentr_m: 0, elevDiff_const_m: 0, elevDiff_ppm: 0, gpsStd_xy: 0, levStd_mmPerKm: 0 } },
    selectedInstrument: 'S9', projectIncludeFiles: {}, geoidSourceData: null, planningMap: DEFAULT_PLANNING_MAP_STATE,
    excludedIds: [], activePreanalysisAdditionIds: [], overrides: {}, approvedClusterMerges: [], ...overrides,
  };
};
const request = makeRequest();

type Phase = 'accumulate' | 'productionC2' | 'verificationNative' | 'verificationC2' | 'c1' | 'c3' | 'physical' | 'total';
type Timings = Partial<Record<Phase, number>>;
interface Counts { correction: number; covariance: number; covarianceDamped: number; correctionMs: number; covarianceMs: number; }
interface Captured { input: SparseSelectedCovarianceInput; result: SparseSelectedCovarianceResult; }

const makeSink = (timings: Timings): PreanalysisVerifierTimingSink => ({
  record(phase: Phase, ms: number) { timings[phase] = (timings[phase] ?? 0) + ms; },
});
const loadFactory = async (): Promise<WebNetWasmFactory> => {
  const mod = (await import(pathToFileURL(path.resolve('cpp/build-wasm/webnet_core.js')).href)) as unknown as { default: WebNetWasmFactory };
  return mod.default;
};
const pathToFileURL = (file: string): URL => new URL(`file://${file}`);

const runTs = (): { outcome: RunSessionOutcome; wallMs: number } => {
  const started = performance.now();
  const outcome = runAdjustmentSession(request);
  return { outcome, wallMs: performance.now() - started };
};

const runRoute = async (cap: number, factory: WebNetWasmFactory): Promise<{ outcome: RunSessionOutcome; wallMs: number; route: string; reasons: string[]; counts: Counts; timings: Timings }> => {
  const counts: Counts = { correction: 0, covariance: 0, covarianceDamped: 0, correctionMs: 0, covarianceMs: 0 };
  const timings: Timings = {};
  const real = await createExperimentalSparseNumericalBundle(factory);
  setPreanalysisSparseAutoRouteEnabled(true);
  setPreanalysisSparseAutoRouteTestHooks({ parameterCapOverride: cap, timingSink: makeSink(timings) });
  const bundle = {
    sparseCorrectionSolver: { solveFromEquations: (x: any) => { counts.correction++; const started = performance.now(); try { return real.sparseCorrectionSolver.solveFromEquations(x); } finally { counts.correctionMs += performance.now() - started; } } },
    sparseRowProductsSolver: real.sparseRowProductsSolver,
    sparseSelectedCovarianceSolver: { querySelected: (x: SparseSelectedCovarianceInput) => { counts.covariance++; const started = performance.now(); try { return real.sparseSelectedCovarianceSolver.querySelected(x); } finally { counts.covarianceMs += performance.now() - started; } } },

  };
  const { setSparseAutoRouteBundleLoader } = await import('../../src/workers/adjustmentSparseAutoRoute');
  setSparseAutoRouteBundleLoader(() => Promise.resolve(bundle));
  const started = performance.now();
  const attempt = await runWithPreanalysisSparseAutoRoute(request, undefined, { runSession: runAdjustmentSession });
  const wallMs = performance.now() - started;
  setPreanalysisSparseAutoRouteEnabled(false); clearPreanalysisSparseAutoRouteTestHooks(); setSparseAutoRouteBundleLoader(undefined);
  return { outcome: attempt.outcome, wallMs, route: attempt.route, reasons: attempt.reasons, counts, timings };
};

const runCandidate = async (cap: number, factory: WebNetWasmFactory): Promise<{ wallMs: number; sparseAttemptMs: number; fallback: boolean; outcome: RunSessionOutcome; verdicts: any[]; captured: Captured[]; counts: Counts; timings: Timings }> => {
  const real = await createExperimentalSparseNumericalBundle(factory);
  const counts: Counts = { correction: 0, covariance: 0, covarianceDamped: 0, correctionMs: 0, covarianceMs: 0 };
  const timings: Timings = {};
  const captured: Captured[] = [];
  const correction = { solveFromEquations: (x: any) => { counts.correction++; const started = performance.now(); try { return real.sparseCorrectionSolver.solveFromEquations(x); } finally { counts.correctionMs += performance.now() - started; } } };
  const covariance = { querySelected: (x: SparseSelectedCovarianceInput) => { counts.covariance++; const started = performance.now(); try { const result = real.sparseSelectedCovarianceSolver.querySelected(x); if (result.damping !== 0) counts.covarianceDamped++; captured.push({ input: x, result }); return result; } finally { counts.covarianceMs += performance.now() - started; } } };
  const state = createPreanalysisCandidateState();
  const gatedCorrection = new PreanalysisGatedCorrectionSolver(correction, state, { maxSystems: 64, maxParameters: cap });
  const gatedCovariance = new PreanalysisGatedCovarianceCapture(covariance, state, { maxSystems: 64, maxParameters: cap });
  gatedCovariance.setTimingSink(makeSink(timings));
  const runtime = { sparseCorrectionSolver: gatedCorrection, sparseRowProductsSolver: real.sparseRowProductsSolver, sparseSelectedCovarianceSolver: gatedCovariance, experimentalSparseDiagnostics: createExperimentalSparseRouteDiagnostics(), experimentalSelectedCovarianceMode: true, experimentalSelectedCovarianceLegacyAllPairs: true };
  const started = performance.now();
  let outcome: RunSessionOutcome;
  let fallback = false;
  let sparseAttemptMs = 0;
  try {
    outcome = runAdjustmentSession(request, undefined, runtime);
    sparseAttemptMs = performance.now() - started;
  } catch {
    fallback = true;
    sparseAttemptMs = performance.now() - started;
    outcome = runTs().outcome;
  }
  return { wallMs: performance.now() - started, sparseAttemptMs, fallback, outcome, verdicts: gatedCovariance.verdicts, captured, counts, timings };
};

const stats = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); return { min: sorted[0], median: sorted[Math.floor(sorted.length / 2)], max: sorted.at(-1) }; };
const summarizeCapture = (run: Awaited<ReturnType<typeof runCandidate>>) => {
  const params = run.captured.map((c) => c.input.parameterCount);
  const first = run.verdicts.find((v: any) => v.reasons.length > 0);
  const productionCalls = run.captured.filter((_call, captureIndex) => captureIndex % 2 === 0);
  if (!first) return { parameterStats: stats(params), planningSystemCount: run.verdicts.length, parameterSequence: productionCalls.map((c) => c.input.parameterCount), firstFailure: null };
  const productionCall = productionCalls[first.index];
  if (!productionCall) throw new Error(`missing production covariance capture for system ${first.index + 1}`);
  const productionCaptureIndex = run.captured.indexOf(productionCall);
  const call = run.captured[productionCaptureIndex + 1] ?? productionCall;
  const normal = accumulatePackedNormal({ ...call.input, design: call.input.design, weights: call.input.weights }, call.input.parameterCount);
  const native = Array.from(call.result.covariance);
  const c2Native = evaluateSentinelC2(normal, call.input.queryRows, call.input.queryColumns, native, 1e-6, call.input.parameterCount);
  const ts = probeSelectedCovariance(normal, call.input.queryRows, call.input.queryColumns, call.input.parameterCount);
  const c1 = evaluateSentinelC1(native, ts.values);
  const c2Ts = evaluateSentinelC2(normal, call.input.queryRows, call.input.queryColumns, ts.values, 1e-6, call.input.parameterCount);
  const symmetry = normal.reduce((m, row, i) => Math.max(m, ...row.map((v, j) => Math.abs(v - (normal[j]?.[i] ?? 0)))), 0);
  const norm = Math.max(...normal.map((row) => row.reduce((s, v) => s + Math.abs(v), 0)));
  const xNorm = Math.max(...ts.values.map(Math.abs));
  const residual = c2Native.maxResidual;
  const scaledResidual = Number.isFinite(residual) ? residual / (norm * xNorm + 1) : null;
  return { parameterStats: stats(productionCalls.map((c) => c.input.parameterCount)), planningSystemCount: run.verdicts.length, parameterSequence: productionCalls.map((c) => c.input.parameterCount), firstFailure: { systemIndex: first.index, parameterCount: first.parameterCount, equationCount: call.input.observationEquationCount, queryCount: call.input.queryRows.length, productionQueryCount: productionCall.input.queryRows.length, damping: call.result.damping, reasons: first.reasons, nativeResidual: c2Native, tsResidual: c2Ts, c1, nativeSelected: native.slice(0, 8), tsSelected: ts.values.slice(0, 8), normal: { dimension: normal.length, symmetryMax: symmetry, infNorm: norm, xInfNorm: xNorm, scaledResidual } } };
};

const main = async (): Promise<void> => {
  const factory = await loadFactory();
  const preflight: number[] = [];
  for (let i = 0; i < 4; i++) {
    const started = performance.now();
    derivePreanalysisSparseAutoRouteEligibility(request);
    if (i > 0) preflight.push(performance.now() - started);
  }
  const forced: number[] = []; const cap128: number[] = []; const cap256: number[] = [];
  let route128: any; let route256: any; let candidate256: any;
  for (let i = 0; i < 4; i++) { const r = runTs(); if (i > 0) forced.push(r.wallMs); }
  for (let i = 0; i < 4; i++) { route128 = await runRoute(128, factory); if (i > 0) cap128.push(route128.wallMs); }
  for (let i = 0; i < 4; i++) { route256 = await runRoute(256, factory); if (i > 0) cap256.push(route256.wallMs); }
  const candidate128 = await runCandidate(128, factory);
  const candidate256Run = await runCandidate(256, factory); candidate256 = summarizeCapture(candidate256Run);
  const ts = runTs();
  console.log(JSON.stringify({ fixture: fixturePath, stationUnknowns: 46, coordinateParameters: 92, orientationParameters: 84, preflightMs: stats(preflight), forcedTS: stats(forced), cap128: { wall: stats(cap128), last: route128, sparseAttempt: { wallMs: candidate128.sparseAttemptMs, totalWithRestartMs: candidate128.wallMs, fallback: candidate128.fallback, counts: candidate128.counts, timings: candidate128.timings } }, cap256: { wall: stats(cap256), last: route256, sparseAttempt: { wallMs: candidate256Run.sparseAttemptMs, fallback: candidate256Run.fallback, counts: candidate256Run.counts, timings: candidate256Run.timings } }, candidate256, tsProfile: ts.outcome.result.solveTimingProfile, condition: ts.outcome.result.condition, resultLogs: ts.outcome.result.logs.filter((x) => /C[123]|parameter|fallback/i.test(x)).slice(-30) }, null, 2));
};
await main();
