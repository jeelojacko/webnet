/**
 * Phase 7B.7 actual-worker corpus closure (test-only, no routing).
 *
 * - Derives admission automatically: every case classifies through legacy
 *   production eligibility AND the static geometry preflight; a case is
 *   admitted only when both clear and the TS reference converged.
 * - Runs EVERY admitted case through the ACTUAL adjustment worker with
 *   worker-local real WASM (existing `phase7bAdjustmentWorkerBridge` seam;
 *   no protocol/request changes) under legacy-all-pairs compatibility, and
 *   compares the FULL result contract (status/iterations/DOF/SEUW,
 *   coordinates/heights, residuals/stdRes/redundancy/MDB, station/relative
 *   covariance, relativePrecision order, condition metadata).
 * - Expands coverage beyond Phase 7B.6 with metric-doped weak-resection
 *   cases (angular-only hazard stabilized with `D` legs) plus deterministic
 *   start-coordinate and geometry-perturbation cases.
 * - Records divergence classification and false admits/rejects, and writes
 *   a deterministic machine-readable report under `reports/phase7b7/`.
 *
 * No production routing, UI, persistence, or tolerance changes.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { describe, expect, it } from 'vitest';

import { LSAEngine } from '../src/engine/adjust';
import {
  buildSolvePreparation,
  collectActiveObservationsForSolve,
} from '../src/engine/adjustmentPreprocessing';
import {
  isAdjustmentWorkerResponseMessage,
  type AdjustmentWorkerRequestMessage,
  type AdjustmentWorkerResponseMessage,
} from '../src/engine/adjustmentWorkerProtocol';
import { createExperimentalSparseRouteDiagnostics } from '../src/engine/experimentalSparseDiagnostics';
import { parseInput } from '../src/engine/parseInputCore';
import { generatePhase5BenchmarkInput } from '../src/engine/phase5BenchmarkNetworks';
import {
  classifyPhase7b6Verdict,
  summarizePhase7b6Corpus,
  type Phase7b6AdversarialCase,
} from '../src/engine/phase7b6AdversarialCorpus';
import {
  comparePhase7b7FullContract,
  PHASE7B7_COORD_TOLERANCE_M,
  PHASE7B7_RELATIVE_TOLERANCE,
  type Phase7b7ContractComparison,
} from '../src/engine/phase7b7FullContract';
import {
  addExtraDistanceLeg,
  dopeResectionWithDistances,
  shiftFreeStartCoords,
  stationDistanceM,
} from '../src/engine/phase7b7WorkerCorpus';
import { runAdjustmentSession } from '../src/engine/runSession';
import {
  evaluateSparseGeometryPreflight,
  type SparseGeometryPreflightInput,
} from '../src/engine/sparseGeometryPreflight';
import { createRunSessionRequest } from './helpers/runSessionRequest';

const BRIDGE_PATH = path.join(process.cwd(), 'scripts/phase7bAdjustmentWorkerBridge.ts');
const REPORT_DIR = path.join(process.cwd(), 'reports/phase7b7');

const readExample = (file: string): string =>
  fs.readFileSync(path.join(process.cwd(), 'public/examples', file), 'utf-8');

const TRIANGULATION = readExample('ts_triangulation_trilateration_2d.dat');
const RESECTION = readExample('industry_resection_pillars.dat');
const INDUSTRY_3D = readExample('industry_demo.dat');

const BASE = {
  maxUnknownCount: 128,
  runMode: 'adjustment' as const,
  wasmAvailable: true,
  workerAvailable: true,
  rankRisk: 'none' as const,
};

const generated = (id: string, family: 'chain-2d' | 'gps-2d', unknownCount: number, seed: number): string =>
  generatePhase5BenchmarkInput({ id, family, unknownCount, seed });

/** Deterministic 31-case closure corpus (15 admitted pass probes). */
const buildCorpus = (): Phase7b6AdversarialCase[] => {
  const chain04 = generated('chain-2d-04', 'chain-2d', 4, 1101);
  const chain16 = generated('chain-2d-16', 'chain-2d', 16, 1116);
  const chain32 = generated('chain-2d-32', 'chain-2d', 32, 1132);
  const gps08 = generated('gps-2d-08', 'gps-2d', 8, 2202);
  const gps16 = generated('gps-2d-16', 'gps-2d', 16, 2216);
  const gps64 = generated('gps-2d-64', 'gps-2d', 64, 2264);
  // The geometry-perturbation leg is derived from the converged chain-16
  // reference itself, so the extra observation is self-consistent.
  const chain16Solved = new LSAEngine({ input: chain16, maxIterations: 10 }).solve();
  const chainLeg = (from: string, to: string): number => {
    const a = chain16Solved.stations[from];
    const b = chain16Solved.stations[to];
    if (!a || !b) throw new Error(`chain-16 stations ${from}/${to} missing`);
    return stationDistanceM(a.x, a.y, b.x, b.y);
  };
  // Doped legs anchor free pillars to fixed controls with exact truth
  // distances (controls are fixed; pillar C records equal truth), plus
  // reconnaissance legs for the two instrument stations with relaxed
  // sigmas. Metric presence is what stabilizes the geometry for preflight.
  const doped2 = dopeResectionWithDistances(RESECTION, [
    { from: 'B0288050', to: 'A', distanceM: 18.7927, sigmaM: 0.01 },
    { from: 'R0725300', to: 'C', distanceM: 1.6192, sigmaM: 0.01 },
  ]);
  const doped4 = dopeResectionWithDistances(RESECTION, [
    { from: 'B0288050', to: 'A', distanceM: 18.7927, sigmaM: 0.01 },
    { from: 'B0524290', to: 'B', distanceM: 11.1413, sigmaM: 0.01 },
    { from: 'R0725300', to: 'C', distanceM: 1.6192, sigmaM: 0.01 },
    { from: 'L1025300', to: 'D', distanceM: 1.5724, sigmaM: 0.01 },
  ]);
  const eligible2d = (unknownCount: number) => ({
    ...BASE,
    dimension: '2d' as const,
    unknownCount,
    robustWeighting: false,
    tsCorrelation: false,
    gpsCovarianceWeighting: false,
  });
  return [
    { id: 'tri-strong', family: 'industry', source: 'ts_triangulation_trilateration_2d.dat', input: TRIANGULATION, maxIterations: 10, eligibility: eligible2d(8), expectation: 'pass' },
    { id: 'chain-04', family: 'generated-chain', source: 'chain-2d-04/1101', input: chain04, maxIterations: 10, eligibility: eligible2d(4), expectation: 'pass' },
    { id: 'chain-16', family: 'generated-chain', source: 'chain-2d-16/1116', input: chain16, maxIterations: 10, eligibility: eligible2d(16), expectation: 'pass' },
    { id: 'chain-32', family: 'generated-chain', source: 'chain-2d-32/1132', input: chain32, maxIterations: 10, eligibility: eligible2d(32), expectation: 'pass' },
    { id: 'gps-08', family: 'gps', source: 'gps-2d-08/2202', input: gps08, maxIterations: 10, eligibility: eligible2d(8), expectation: 'pass' },
    { id: 'gps-16', family: 'gps', source: 'gps-2d-16/2216', input: gps16, maxIterations: 10, eligibility: eligible2d(16), expectation: 'pass' },
    { id: 'gps-64', family: 'gps-large', source: 'gps-2d-64/2264', input: gps64, maxIterations: 10, eligibility: eligible2d(64), expectation: 'pass' },
    { id: 'chain-04-seed2', family: 'perturb-seed', source: 'chain-2d-04/9102', input: generated('chain-2d-04b', 'chain-2d', 4, 9102), maxIterations: 10, eligibility: eligible2d(4), expectation: 'pass' },
    { id: 'gps-08-seed2', family: 'perturb-seed', source: 'gps-2d-08/9202', input: generated('gps-2d-08b', 'gps-2d', 8, 9202), maxIterations: 10, eligibility: eligible2d(8), expectation: 'pass' },
    { id: 'tri-iter25', family: 'perturb-iterations', source: 'triangulation @ maxIterations 25', input: TRIANGULATION, maxIterations: 25, eligibility: eligible2d(8), expectation: 'pass' },
    { id: 'chain-16-extra-leg', family: 'perturb-geometry', source: 'chain-2d-16/1116 + D U1-U3', input: addExtraDistanceLeg(chain16, 'U1', 'U3', chainLeg('U1', 'U3'), 0.003), maxIterations: 10, eligibility: eligible2d(16), expectation: 'pass' },
    { id: 'tri-shifted-start', family: 'perturb-start', source: 'triangulation start +0.50/-0.25', input: shiftFreeStartCoords(TRIANGULATION, 0.5, -0.25), maxIterations: 10, eligibility: eligible2d(8), expectation: 'pass' },
    { id: 'chain-16-shifted-start', family: 'perturb-start', source: 'chain-2d-16/1116 start +2.00/+2.00', input: shiftFreeStartCoords(chain16, 2, 2), maxIterations: 10, eligibility: eligible2d(16), expectation: 'pass' },
    { id: 'resection-doped-2leg', family: 'metric-doped', source: 'resection + 2xD legs (insufficient dose)', input: doped2, maxIterations: 25, eligibility: eligible2d(8), expectation: 'reference-unconverged' },
    { id: 'resection-doped-4leg', family: 'metric-doped', source: 'resection + 4xD legs', input: doped4, maxIterations: 25, eligibility: eligible2d(8), expectation: 'pass' },
    { id: 'resection-weak', family: 'industry-weak', source: 'industry_resection_pillars.dat', input: RESECTION, maxIterations: 25, eligibility: eligible2d(8), expectation: 'diverge-flag' },
    { id: 'industry-3d', family: 'industry-3d', source: 'industry_demo.dat', input: INDUSTRY_3D, maxIterations: 10, eligibility: { ...BASE, dimension: '3d' as const, unknownCount: 8, robustWeighting: false, tsCorrelation: false, gpsCovarianceWeighting: false }, expectation: 'ineligible' },
    { id: 'robust-rejected', family: 'robust', source: 'triangulation + .ROBUST HUBER 1.5', input: `${TRIANGULATION}\n.ROBUST HUBER 1.5\n`, maxIterations: 10, eligibility: { ...eligible2d(8), robustWeighting: true }, expectation: 'ineligible' },
    { id: 'tscorr-rejected', family: 'correlation', source: 'triangulation + .TSCORR ON', input: `${TRIANGULATION}\n.TSCORR ON\n`, maxIterations: 10, eligibility: { ...eligible2d(8), tsCorrelation: true }, expectation: 'ineligible' },
    { id: 'gps-cov-rejected', family: 'gps-covariance', source: 'gps-2d-08 + .GPS WEIGHT COVARIANCE', input: `${gps08}\n.GPS WEIGHT COVARIANCE\n`, maxIterations: 10, eligibility: { ...eligible2d(8), gpsCovarianceWeighting: true }, expectation: 'ineligible' },
    { id: 'non-adjustment', family: 'runmode', source: 'triangulation @ preanalysis', input: TRIANGULATION, maxIterations: 10, eligibility: { ...eligible2d(8), runMode: 'preanalysis' as const }, expectation: 'ineligible' },
    { id: 'size-guard', family: 'size-guard', source: 'chain-2d-16 vs max 4', input: chain16, maxIterations: 10, eligibility: { ...eligible2d(16), maxUnknownCount: 4 }, expectation: 'ineligible' },
    { id: 'rank-suspect', family: 'rank-risk', source: 'triangulation rank suspect', input: TRIANGULATION, maxIterations: 10, eligibility: { ...eligible2d(8), rankRisk: 'suspect' as const }, expectation: 'ineligible' },
    { id: 'rank-deficient', family: 'rank-risk', source: 'triangulation rank deficient', input: TRIANGULATION, maxIterations: 10, eligibility: { ...eligible2d(8), rankRisk: 'deficient' as const }, expectation: 'ineligible' },
    { id: 'wasm-down', family: 'availability', source: 'triangulation WASM unavailable', input: TRIANGULATION, maxIterations: 10, eligibility: { ...eligible2d(8), wasmAvailable: false }, expectation: 'ineligible' },
    { id: 'worker-down', family: 'availability', source: 'triangulation worker unavailable', input: TRIANGULATION, maxIterations: 10, eligibility: { ...eligible2d(8), workerAvailable: false }, expectation: 'ineligible' },
    { id: 'resection-robust', family: 'industry-weak', source: 'resection + .ROBUST HUBER 1.5', input: `${RESECTION}\n.ROBUST HUBER 1.5\n`, maxIterations: 25, eligibility: { ...eligible2d(8), robustWeighting: true }, expectation: 'ineligible' },
    { id: 'tri-iter0', family: 'unconverged', source: 'triangulation @ maxIterations 0', input: TRIANGULATION, maxIterations: 0, eligibility: eligible2d(8), expectation: 'reference-unconverged' },
    { id: 'tri-iter1', family: 'unconverged', source: 'triangulation @ maxIterations 1', input: TRIANGULATION, maxIterations: 1, eligibility: eligible2d(8), expectation: 'reference-unconverged' },
    { id: 'chain16-iter1', family: 'unconverged', source: 'chain-2d-16 @ maxIterations 1', input: chain16, maxIterations: 1, eligibility: eligible2d(16), expectation: 'reference-unconverged' },
    { id: 'gps08-iter0', family: 'unconverged', source: 'gps-2d-08 @ maxIterations 0', input: gps08, maxIterations: 0, eligibility: eligible2d(8), expectation: 'reference-unconverged' },
  ];
};

const toPreflightInput = (candidate: Phase7b6AdversarialCase): SparseGeometryPreflightInput => {
  const parsed = parseInput(candidate.input);
  const is2D = (parsed.parseState?.coordMode ?? '2D') === '2D';
  const active = collectActiveObservationsForSolve(parsed.observations, undefined, is2D);
  const prep = buildSolvePreparation(parsed.stations, parsed.unknowns, active, is2D);
  return {
    stations: parsed.stations,
    observations: parsed.observations,
    unknowns: parsed.unknowns,
    is2D,
    numParams: prep.numParams,
    numObsEquations: prep.numObsEquations,
    directionSetIds: prep.directionSetIds,
  };
};

interface WorkerDiagnostics {
  sparseCorrectionCalls: number;
  sparseCorrectionFallbacks: number;
  rowProductsCalls: number;
  rowProductsFallbacks: number;
  selectedCovarianceCalls: number;
  selectedCovarianceFallbacks: number;
  bundleInitialized: boolean;
}

/** One RunRequestMessage through the actual worker; resolves on settle. */
const runActualWorker = (
  request: AdjustmentWorkerRequestMessage,
  timeoutMs = 120000,
): Promise<{ messages: AdjustmentWorkerResponseMessage[]; diagnostics: WorkerDiagnostics }> =>
  new Promise((resolve, reject) => {
    const messages: AdjustmentWorkerResponseMessage[] = [];
    let diagnostics: WorkerDiagnostics | null = null;
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
      const record = message as { type?: unknown };
      if (record?.type === 'test-diagnostics') {
        diagnostics = (record as { diagnostics: WorkerDiagnostics }).diagnostics;
        if (messages.some((m) => m.type === 'success' || m.type === 'failure')) {
          clearTimeout(timer);
          void worker.terminate();
          resolve({ messages, diagnostics: diagnostics as WorkerDiagnostics });
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
          else resolve({ messages, diagnostics: diagnostics as WorkerDiagnostics });
        }
      }
    });
    worker.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    worker.postMessage(request);
  });

interface Phase7b7CaseRow {
  id: string;
  family: string;
  expectation: string;
  eligible: boolean;
  eligibilityReasons: string[];
  preflightEligible: boolean;
  preflightReasons: string[];
  referenceSuccess: boolean;
  referenceConverged: boolean;
  referenceIterations: number;
  admitted: boolean;
  falseAdmit: boolean;
  falseReject: boolean;
  workerRun: boolean;
  workerConverged: boolean | null;
  workerIterations: number | null;
  contractPass: boolean | null;
  divergence: string | null;
  contractReasons: string[];
  conditionNote: string | null;
  maxima: Record<string, string> | null;
  sparseCorrectionCalls: number | null;
  sparseCorrectionFallbacks: number | null;
}

const formatMaxima = (comparison: Phase7b7ContractComparison): Record<string, string> => ({
  maxCoordDiffM: comparison.maxCoordDiffM.toExponential(2),
  maxHeightDiffM: comparison.maxHeightDiffM.toExponential(2),
  maxResidualDiff: Number.isFinite(comparison.maxResidualDiff)
    ? comparison.maxResidualDiff.toExponential(2)
    : 'mismatch',
  maxStdResDiff: Number.isFinite(comparison.maxStdResDiff)
    ? comparison.maxStdResDiff.toExponential(2)
    : 'mismatch',
  maxRedundancyDiff: Number.isFinite(comparison.maxRedundancyDiff)
    ? comparison.maxRedundancyDiff.toExponential(2)
    : 'mismatch',
  maxMdbDiff: Number.isFinite(comparison.maxMdbDiff)
    ? comparison.maxMdbDiff.toExponential(2)
    : 'mismatch',
  maxStationCovDiff: Number.isFinite(comparison.maxStationCovDiff)
    ? comparison.maxStationCovDiff.toExponential(2)
    : 'mismatch',
  maxRelativeCovDiff: Number.isFinite(comparison.maxRelativeCovDiff)
    ? comparison.maxRelativeCovDiff.toExponential(2)
    : 'mismatch',
  maxRelPrecDiff: Number.isFinite(comparison.maxRelPrecDiff)
    ? comparison.maxRelPrecDiff.toExponential(2)
    : 'mismatch',
  seuwDiff: comparison.seuwDiff.toExponential(2),
});

const writeReport = (rows: Phase7b7CaseRow[]): void => {
  const admitted = rows.filter((row) => row.admitted);
  const workerRuns = rows.filter((row) => row.workerRun);
  const report = {
    phase: '7B.7',
    scope: 'actual-worker corpus closure (test-only, no routing)',
    tolerances: {
      coordToleranceM: PHASE7B7_COORD_TOLERANCE_M,
      relativeTolerance: PHASE7B7_RELATIVE_TOLERANCE,
    },
    summary: {
      total: rows.length,
      admitted: admitted.length,
      workerRuns: workerRuns.length,
      contractPass: workerRuns.filter((row) => row.contractPass === true).length,
      diverged: workerRuns.filter((row) => row.divergence === 'diverged').length,
      mismatched: workerRuns.filter((row) => row.divergence === 'mismatch').length,
      conditionArtifactNoted: workerRuns.filter((row) => row.conditionNote != null).length,
      falseAdmits: rows.filter((row) => row.falseAdmit).length,
      falseRejects: rows.filter((row) => row.falseReject).length,
    },
    cases: rows,
  };
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(REPORT_DIR, 'phase7b7-worker-corpus.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  const lines = [
    '# Phase 7B.7 actual-worker corpus report (test-only, no routing)',
    '',
    `- total=${report.summary.total} admitted=${report.summary.admitted} workerRuns=${report.summary.workerRuns}`,
    `- contractPass=${report.summary.contractPass} diverged=${report.summary.diverged} mismatched=${report.summary.mismatched}`,
    `- falseAdmits=${report.summary.falseAdmits} falseRejects=${report.summary.falseRejects}`,
    `- tolerances: coord=${PHASE7B7_COORD_TOLERANCE_M} m, relative=${PHASE7B7_RELATIVE_TOLERANCE}`,
    '',
    '| id | admitted | worker | contract | divergence | coord | height | seuw |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const row of rows) {
    const maxima = row.maxima;
    lines.push(
      `| ${row.id} | ${row.admitted} | ${row.workerRun} | ${row.contractPass ?? '-'} | ` +
        `${row.divergence ?? '-'} | ${maxima?.maxCoordDiffM ?? '-'} | ` +
        `${maxima?.maxHeightDiffM ?? '-'} | ${maxima?.seuwDiff ?? '-'} |`,
    );
  }
  lines.push('');
  fs.writeFileSync(path.join(REPORT_DIR, 'phase7b7-worker-corpus.md'), `${lines.join('\n')}`);
};

describe('phase 7B.7 actual-worker corpus closure', () => {
  it('derives admission automatically with zero false admits and zero false rejects', () => {
    const corpus = buildCorpus();
    expect(corpus.length).toBe(31);
    expect(new Set(corpus.map((candidate) => candidate.id)).size).toBe(corpus.length);
    const verdicts = corpus.map((candidate) => {
      const reference = new LSAEngine({
        input: candidate.input,
        maxIterations: candidate.maxIterations,
      }).solve();
      const preflight = evaluateSparseGeometryPreflight(toPreflightInput(candidate));
      return {
        candidate,
        verdict: classifyPhase7b6Verdict(
          candidate,
          {
            success: reference.success,
            converged: reference.converged,
            iterations: reference.iterations ?? 0,
          },
          preflight.eligible,
        ),
        preflight,
        reference,
      };
    });
    const summary = summarizePhase7b6Corpus(verdicts.map((entry) => entry.verdict));
    console.log(`[phase7b7-corpus] ${JSON.stringify(summary)}`);
    expect(summary.total).toBe(31);
    expect(summary.passExpected).toBe(14);
    expect(summary.divergeExpected).toBe(1);
    expect(summary.ineligibleExpected).toBe(11);
    expect(summary.unconvergedExpected).toBe(5);
    expect(summary.falseAdmits).toBe(0);
    expect(summary.falseRejects).toBe(0);
    // Weak resection stays held by the static preflight despite doping-free eligibility.
    const weak = verdicts.find((entry) => entry.candidate.id === 'resection-weak');
    expect(weak?.reference.success && weak?.reference.converged).toBe(true);
    expect(weak?.preflight.eligible).toBe(false);
    expect(weak?.verdict.falseAdmit).toBe(false);
    // Metric doping dose-response: 2 legs clear the preflight but leave the
    // TS reference unconverged (held automatically, no false admit), while
    // 4 legs clear both gates and are admitted.
    const doped2 = verdicts.find((entry) => entry.candidate.id === 'resection-doped-2leg');
    expect(doped2?.preflight.eligible, 'doped-2leg preflight clears').toBe(true);
    expect(doped2?.reference.success && doped2?.reference.converged, 'doped-2leg reference unconverged').toBe(false);
    expect(doped2?.verdict.sparseDisposition, 'doped-2leg held').toMatch(/reference-unconverged/);
    expect(doped2?.verdict.falseAdmit, 'doped-2leg no false admit').toBe(false);
    const doped4 = verdicts.find((entry) => entry.candidate.id === 'resection-doped-4leg');
    expect(doped4?.reference.success && doped4?.reference.converged, 'doped-4leg reference green').toBe(true);
    expect(doped4?.preflight.eligible, 'doped-4leg preflight clears').toBe(true);
    expect(doped4?.verdict.sparseDisposition, 'doped-4leg admitted').toBe('sparse-worker-run');
    // Start/geometry perturbations stay admitted pass probes.
    for (const id of ['tri-shifted-start', 'chain-16-shifted-start', 'chain-16-extra-leg']) {
      const perturbed = verdicts.find((entry) => entry.candidate.id === id);
      expect(perturbed?.reference.success && perturbed?.reference.converged, `${id} reference green`).toBe(true);
      expect(perturbed?.preflight.eligible, `${id} preflight clears`).toBe(true);
    }
    const admitted = verdicts.filter(
      (entry) => entry.verdict.sparseDisposition === 'sparse-worker-run' && entry.preflight.eligible,
    );
    expect(admitted.length).toBe(14);
    expect(admitted.every((entry) => entry.candidate.expectation === 'pass')).toBe(true);
  });

  it('runs every admitted case through the actual worker and checks the full contract', async () => {
    const corpus = buildCorpus();
    const admitted = corpus.filter((candidate) => {
      const reference = new LSAEngine({
        input: candidate.input,
        maxIterations: candidate.maxIterations,
      }).solve();
      const preflight = evaluateSparseGeometryPreflight(toPreflightInput(candidate));
      const verdict = classifyPhase7b6Verdict(
        candidate,
        {
          success: reference.success,
          converged: reference.converged,
          iterations: reference.iterations ?? 0,
        },
        preflight.eligible,
      );
      return verdict.sparseDisposition === 'sparse-worker-run' && preflight.eligible;
    });
    // No hand-picked subset: every admitted case runs.
    expect(admitted.length).toBe(14);
    const rows: Phase7b7CaseRow[] = [];
    // Non-admitted cases still land in the report with their held reasons.
    for (const candidate of corpus.filter((item) => !admitted.includes(item))) {
      const reference = new LSAEngine({
        input: candidate.input,
        maxIterations: candidate.maxIterations,
      }).solve();
      const preflight = evaluateSparseGeometryPreflight(toPreflightInput(candidate));
      const verdict = classifyPhase7b6Verdict(
        candidate,
        {
          success: reference.success,
          converged: reference.converged,
          iterations: reference.iterations ?? 0,
        },
        preflight.eligible,
      );
      rows.push({
        id: candidate.id,
        family: candidate.family,
        expectation: candidate.expectation,
        eligible: verdict.eligible,
        eligibilityReasons: verdict.reasons,
        preflightEligible: preflight.eligible,
        preflightReasons: preflight.reasons,
        referenceSuccess: reference.success,
        referenceConverged: reference.converged,
        referenceIterations: reference.iterations ?? 0,
        admitted: false,
        falseAdmit: verdict.falseAdmit,
        falseReject: verdict.falseReject,
        workerRun: false,
        workerConverged: null,
        workerIterations: null,
        contractPass: null,
        divergence: null,
        contractReasons: [],
        conditionNote: null,
        maxima: null,
        sparseCorrectionCalls: null,
        sparseCorrectionFallbacks: null,
      });
    }
    for (const candidate of admitted) {
      const reference = new LSAEngine({
        input: candidate.input,
        maxIterations: candidate.maxIterations,
      }).solve();
      const preflight = evaluateSparseGeometryPreflight(toPreflightInput(candidate));
      const verdict = classifyPhase7b6Verdict(
        candidate,
        {
          success: reference.success,
          converged: reference.converged,
          iterations: reference.iterations ?? 0,
        },
        preflight.eligible,
      );
      // Uniform session-profile headroom (25): the cap never alters a
      // converged trajectory, and reference + worker share the identical
      // payload, so iteration-exact agreement still holds. Triangulation
      // needs ~17 session iterations where raw LSAEngine needs fewer.
      const payload = createRunSessionRequest({ input: candidate.input, maxIterations: 25 });
      const sessionReference = runAdjustmentSession(payload).result;
      expect(sessionReference.success, `${candidate.id} session reference success`).toBe(true);
      expect(sessionReference.converged, `${candidate.id} session reference converged`).toBe(true);
      const { messages, diagnostics } = await runActualWorker({
        type: 'run',
        runId: `phase7b7-corpus-${candidate.id}`,
        payload,
      });
      const success = messages[messages.length - 1];
      expect(success?.type, `${candidate.id} worker success message`).toBe('success');
      if (success?.type !== 'success') continue;
      const workerResult = success.payload.result;
      expect(diagnostics.bundleInitialized, `${candidate.id} real WASM bundle`).toBe(true);
      expect(diagnostics.sparseCorrectionCalls, `${candidate.id} sparse corrections ran`).toBeGreaterThan(0);
      expect(diagnostics.sparseCorrectionFallbacks, `${candidate.id} zero correction fallbacks`).toBe(0);
      const comparison = comparePhase7b7FullContract(sessionReference, workerResult);
      console.log(
        `[phase7b7-corpus] ${candidate.id} pass=${comparison.pass} divergence=${comparison.divergence} ` +
          `coord=${comparison.maxCoordDiffM.toExponential(2)} height=${comparison.maxHeightDiffM.toExponential(2)} ` +
          `seuw=${comparison.seuwDiff.toExponential(2)} iters=${sessionReference.iterations}/${workerResult.iterations} ` +
          `reasons=${comparison.reasons.join('; ') || 'none'}`,
      );
      expect(comparison.pass, `${candidate.id} full contract: ${comparison.reasons.join('; ')}`).toBe(true);
      expect(comparison.divergence, `${candidate.id} agreement class`).toBe('agree');
      // Phase 7C parity: the sparse route records result.condition on
      // iteration 1 (native estimate preferred, packed fallback), so the
      // former sparse-path artifact note is gone and the full contract
      // already gated estimate/threshold/flag agreement above.
      expect(comparison.conditionNote, `${candidate.id} no condition artifact`).toBeNull();
      expect(
        Number.isFinite(workerResult.condition?.estimate ?? NaN),
        `${candidate.id} worker condition recorded`,
      ).toBe(true);
      rows.push({
        id: candidate.id,
        family: candidate.family,
        expectation: candidate.expectation,
        eligible: verdict.eligible,
        eligibilityReasons: verdict.reasons,
        preflightEligible: preflight.eligible,
        preflightReasons: preflight.reasons,
        referenceSuccess: reference.success,
        referenceConverged: reference.converged,
        referenceIterations: reference.iterations ?? 0,
        admitted: true,
        falseAdmit: verdict.falseAdmit,
        falseReject: verdict.falseReject,
        workerRun: true,
        workerConverged: workerResult.converged,
        workerIterations: workerResult.iterations,
        contractPass: comparison.pass,
        divergence: comparison.divergence,
        contractReasons: comparison.reasons,
        conditionNote: comparison.conditionNote,
        maxima: formatMaxima(comparison),
        sparseCorrectionCalls: diagnostics.sparseCorrectionCalls,
        sparseCorrectionFallbacks: diagnostics.sparseCorrectionFallbacks,
      });
    }
    rows.sort((a, b) => (a.id < b.id ? -1 : 1));
    writeReport(rows);
    expect(rows.filter((row) => row.falseAdmit || row.falseReject).map((row) => row.id)).toEqual([]);
    expect(rows.filter((row) => row.workerRun && row.divergence !== 'agree').map((row) => row.id)).toEqual([]);
    expect(
      rows.filter((row) => row.workerRun && row.conditionNote != null).map((row) => row.id),
    ).toEqual([]);
  }, 1800000);

  it('proves clean-run restart: injected sparse failure falls back, clean TS rerun matches', () => {
    const cleanReference = new LSAEngine({ input: TRIANGULATION }).solve();
    expect(cleanReference.success).toBe(true);
    const diagnostics = createExperimentalSparseRouteDiagnostics();
    const degraded = new LSAEngine({
      input: TRIANGULATION,
      sparseCorrectionSolver: {
        solveFromEquations: (): never => {
          throw new Error('injected phase7b7 sparse failure');
        },
      },
      experimentalSparseDiagnostics: diagnostics,
    }).solve();
    expect(degraded.success).toBe(true);
    expect(diagnostics.sparseCorrectionCalls).toBeGreaterThan(0);
    expect(diagnostics.sparseCorrectionFallbacks).toBeGreaterThan(0);
    const restart = new LSAEngine({ input: TRIANGULATION }).solve();
    for (const [id, station] of Object.entries(cleanReference.stations)) {
      const other = restart.stations[id];
      expect(other, `station ${id} restarts identically`).toBeDefined();
      expect(other?.x).toBe(station.x);
      expect(other?.y).toBe(station.y);
      expect(other?.h).toBe(station.h);
    }
  });
});
