/**
 * Phase 8A preanalysis sparse evidence (TEST/EVIDENCE ONLY, no routing).
 *
 * What is proven:
 * - The test spawns a Node worker_threads worker running
 *   `scripts/phase8aPreanalysisWorkerBridge.ts`, which installs only a
 *   browser `self` postMessage/onmessage shim and then imports the
 *   UNMODIFIED production module `src/workers/adjustmentWorker.ts`
 *   (including its lazy `import('../engine/runSession')` delegation).
 * - Worker-local runtime injection uses the exported test-only provider
 *   seam (`setAdjustmentWorkerRuntimeProvider`); the request protocol and
 *   `RunSessionRequest` shape are unchanged (no sparse fields), and the
 *   Phase 7C auto-route (`runWithSparseAutoRoute`) is never invoked — the
 *   production worker bypasses it whenever an injected runtime is present.
 *   The test additionally asserts the auto-route still reports preanalysis
 *   requests as ineligible.
 * - Each admitted preanalysis case runs the REAL WASM sparse bundle with
 *   legacy-all-pairs selected covariance through the actual worker, and the
 *   full preanalysis contract matches the direct TypeScript reference:
 *   success/converged, iterations=1, DOF, seuw=1, condition, exactly
 *   unchanged coordinates, station/relative covariance, ellipses,
 *   relativePrecision order/values, planning fields, absent standardized
 *   residual QC fields (chiSquare/statisticalSummary/residualDiagnostics/
 *   redundancy/localTest/MDB/stdResComponents) with raw residual/stdRes
 *   exactly equal.
 * - Sparse proof per case: bundle initialized from the real WASM asset,
 *   correction and selected-covariance calls equal the session solve count,
 *   row-product calls are zero (expected: preanalysis skips standardized
 *   residuals by construction), and every fallback counter is zero.
 *   Per-system dense-oracle summaries feed the S0-S3 strategy ladder.
 *
 * What is NOT proven / out of scope:
 * - No production routing is changed; the default worker runtime stays
 *   `undefined` (exact legacy TypeScript path).
 * - 3D, GPS-covariance, robust, and TS-correlation variants are recorded as
 *   experimental/ineligible direct-TypeScript evidence only (no worker run).
 * - Production defaults, tolerances, and baselines are untouched.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { describe, expect, it } from 'vitest';

import { parseInput } from '../src/engine/parseInputCore';
import {
  classifyPreanalysisSparseEvidence,
  comparePreanalysisContract,
  evaluatePreanalysisStrategies,
  type PreanalysisOracleSummary,
  type PreanalysisStrategyId,
} from '../src/engine/preanalysisSparseEvidence';
import {
  isAdjustmentWorkerResponseMessage,
  type AdjustmentWorkerRequestMessage,
  type AdjustmentWorkerResponseMessage,
} from '../src/engine/adjustmentWorkerProtocol';
import { runAdjustmentSession, type RunSessionOutcome } from '../src/engine/runSession';
import { deriveSparseAutoRouteEligibility } from '../src/workers/adjustmentSparseAutoRoute';
import { createRunSessionRequest } from './helpers/runSessionRequest';

const BRIDGE_PATH = path.join(process.cwd(), 'scripts/phase8aPreanalysisWorkerBridge.ts');
const REPORT_DIR = path.join(process.cwd(), 'reports/phase8a');

const readFixture = (file: string): string =>
  fs.readFileSync(path.join(process.cwd(), file), 'utf-8');

const GPS_2D_INPUT = [
  '.2D',
  'C A 0 0 0 ! ! !',
  'C B 100 0 0 ! ! !',
  'C P 60 40 0',
  'C Q 30 70 0',
  'G G1 A P ? ? 0.010 0.010',
  'G G1 B P ? ? 0.010 0.010',
  'G G1 A Q ? ? 0.010 0.010',
  'G G1 P Q ? ? 0.012 0.012',
  'G G1 A B 100.0 0.0 0.010 0.010',
].join('\n');

const SMALL_3D_INPUT = [
  '.3D',
  'C A 0 0 0 ! ! !',
  'C B 100 0 0 ! ! !',
  'C P 60 40 10',
  'D A-P ? 0.003',
  'D B-P ? 0.003',
  'A P-A-B ? 1.0',
].join('\n');

const GPS_COV_2D_INPUT = [
  '.2D',
  'C A 0 0 0 ! ! !',
  'C B 100 0 0 ! ! !',
  'C P 60 40 0',
  'G0 V1',
  'G1 A-P 60 40 0',
  'G2 0.0001 0.0001 0.0001',
  'G3 0 0 0',
  'G G1 B P ? ? 0.010 0.010',
].join('\n');

interface WorkerCase {
  id: string;
  file: string | null;
  input: string;
  /**
   * True when the S0-S3 ladder is expected to pass fully. The bounded camp
   * case has a ~1e51-conditioned planning normal matrix, so the dense
   * oracle cannot agree with any backend correction: S0 (final agreement)
   * passes while S1-S3 fail closed, recorded as unsupported-strategy
   * evidence with a future strategy/cap recommendation.
   */
  fullStrategyPass: boolean;
}

const WORKER_CASES: WorkerCase[] = [
  { id: 'p-small-2d', file: 'tests/fixtures/preanalysis_cli.dat', input: '', fullStrategyPass: true },
  { id: 'p-plan-2d', file: 'public/examples/preanalysis_network_plan.dat', input: '', fullStrategyPass: true },
  { id: 'p-gps-2d', file: null, input: GPS_2D_INPUT, fullStrategyPass: true },
  { id: 'p-camp-bounded', file: 'tests/fixtures/camp_design_preanalysis_traverse_only.dat', input: '', fullStrategyPass: false },
];

interface DiagnosticsSnapshot {
  sparseCorrectionCalls: number;
  sparseCorrectionFallbacks: number;
  rowProductsCalls: number;
  rowProductsFallbacks: number;
  selectedCovarianceCalls: number;
  selectedCovarianceFallbacks: number;
  bundleInitialized: boolean;
  capturedSystemCount: number;
  truncated: boolean;
  oracles: PreanalysisOracleSummary[];
}

const makePreanalysisRequest = (input: string, extra: Record<string, unknown> = {}) => {
  const base = createRunSessionRequest({ input });
  return createRunSessionRequest({
    input,
    parseSettings: { ...base.parseSettings, runMode: 'preanalysis', coordMode: '2D', ...extra },
  });
};

/** Sends one RunRequestMessage to the actual worker and collects until settled. */
const runActualWorker = (
  request: AdjustmentWorkerRequestMessage,
  timeoutMs = 240000,
): Promise<{ messages: AdjustmentWorkerResponseMessage[]; diagnostics: DiagnosticsSnapshot }> =>
  new Promise((resolve, reject) => {
    const messages: AdjustmentWorkerResponseMessage[] = [];
    let diagnostics: DiagnosticsSnapshot | null = null;
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
        diagnostics = (record as { diagnostics: DiagnosticsSnapshot }).diagnostics;
        if (messages.some((m) => m.type === 'success' || m.type === 'failure')) {
          clearTimeout(timer);
          void worker.terminate();
          resolve({ messages, diagnostics: diagnostics as DiagnosticsSnapshot });
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
          else resolve({ messages, diagnostics: diagnostics as DiagnosticsSnapshot });
        }
      }
    });
    worker.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    worker.postMessage(request);
  });

interface CaseEvidence {
  id: string;
  kind: string;
  eligible: boolean;
  unknownCount: number | null;
  dof: number;
  seuw: number;
  iterations: number;
  solves: number;
  templateSourceSolves: number;
  stationCovarianceBlocks: number;
  relativePrecisionRows: number;
  correctionCalls: number;
  selectedCovarianceCalls: number;
  rowProductsCalls: number;
  fallbacks: number;
  contractPass: boolean;
  maxCoordDiff: number;
  maxCovarianceDiff: number;
  maxCovarianceRelativeDiff: number;
  maxRelativeCovarianceDiff: number;
  maxRelativeCovarianceRelativeDiff: number;
  maxRelativePrecisionDiff: number;
  maxRelativePrecisionRelativeDiff: number;
  strategies: Record<PreanalysisStrategyId, { pass: boolean; reasons: string[] }>;
}

const fmt = (value: number): string => {
  if (value === 0) return '0.00e+0';
  if (!Number.isFinite(value)) return String(value);
  return value.toExponential(2);
};

describe('phase 8A preanalysis sparse evidence', () => {
  it(
    'runs admitted preanalysis cases through the actual worker with real WASM sparse + legacy-all-pairs selected covariance',
    async () => {
      const evidence: CaseEvidence[] = [];
      for (const workerCase of WORKER_CASES) {
        const input = workerCase.file ? readFixture(workerCase.file) : workerCase.input;
        const request = makePreanalysisRequest(input);
        const eligibility = classifyPreanalysisSparseEvidence(input, {
          coordMode: '2D',
          robustMode: 'none',
          tsCorrelationEnabled: false,
        });
        expect(eligibility.eligible, `${workerCase.id}: ${eligibility.reasons.join('; ')}`).toBe(true);

        // Production auto-route must keep rejecting preanalysis (rejection proof, not routing).
        const autoRoute = deriveSparseAutoRouteEligibility(request);
        expect(autoRoute.eligible).toBe(false);
        expect(autoRoute.reasons.some((r) => r.includes('preanalysis') || r.includes('runMode'))).toBe(true);

        const reference = runAdjustmentSession(request);
        expect(reference.result.success).toBe(true);

        const requestMessage: AdjustmentWorkerRequestMessage = {
          type: 'run',
          runId: `phase8a-${workerCase.id}`,
          payload: request,
        };
        expect(requestMessage.payload).not.toHaveProperty('sparseCorrectionSolver');
        expect(requestMessage.payload).not.toHaveProperty('experimentalSparseDiagnostics');
        expect(requestMessage.payload).not.toHaveProperty('runtime');

        const { messages, diagnostics } = await runActualWorker(requestMessage);
        const success = messages[messages.length - 1];
        expect(success?.type).toBe('success');
        if (success?.type !== 'success') continue;
        const outcome = success.payload as RunSessionOutcome;
        expect(outcome.result.success).toBe(true);

        // Sparse proof: real WASM bundle, one correction and selected
        // covariance per counted preanalysis solve. Empty-active sessions no
        // longer perform an uncounted template-source solve; zero row products
        // remain expected because preanalysis skips standardized residuals.
        const expectedSparseSolves = outcome.profile.solveInvocationCount;
        expect(diagnostics.bundleInitialized).toBe(true);
        expect(diagnostics.sparseCorrectionCalls).toBe(expectedSparseSolves);
        expect(diagnostics.selectedCovarianceCalls).toBe(expectedSparseSolves);
        expect(diagnostics.rowProductsCalls).toBe(0);
        expect(diagnostics.rowProductsFallbacks).toBe(0);
        expect(diagnostics.sparseCorrectionFallbacks).toBe(0);
        expect(diagnostics.selectedCovarianceFallbacks).toBe(0);
        expect(diagnostics.truncated).toBe(false);
        expect(diagnostics.capturedSystemCount).toBe(expectedSparseSolves);

        const comparison = comparePreanalysisContract(reference.result, outcome.result);
        expect(comparison.pass, `${workerCase.id}: ${comparison.reasons.join('; ')}`).toBe(true);

        // Coordinates exactly unchanged from the parsed approximate geometry.
        const parsed = parseInput(input, {}, { coordMode: '2D' });
        for (const [id, station] of Object.entries(parsed.stations)) {
          const workerStation = outcome.result.stations[id];
          expect(workerStation, `${workerCase.id} station ${id} present`).toBeDefined();
          expect(workerStation?.x).toBe(station.x);
          expect(workerStation?.y).toBe(station.y);
          expect(workerStation?.h).toBe(station.h);
        }

        const strategies = evaluatePreanalysisStrategies({
          contractPass: comparison.pass,
          contractReasons: comparison.reasons,
          solveCount: expectedSparseSolves,
          capturedSystemCount: diagnostics.capturedSystemCount,
          truncated: diagnostics.truncated,
          oracles: diagnostics.oracles,
        });
        if (workerCase.fullStrategyPass) {
          for (const strategy of strategies) {
            expect(strategy.pass, `${workerCase.id} ${strategy.id}: ${strategy.reasons.join('; ')}`).toBe(true);
          }
        } else {
          // Unsupported-strategy evidence: S0 must still pass (the discarded
          // correction cannot move the preanalysis result); S1-S3 must fail
          // closed on correction disagreement, never on missing evidence.
          const byId = Object.fromEntries(strategies.map((s) => [s.id, s]));
          expect(byId.S0?.pass, `${workerCase.id} S0: ${byId.S0?.reasons.join('; ')}`).toBe(true);
          for (const id of ['S1', 'S2', 'S3'] as const) {
            expect(byId[id]?.pass, `${workerCase.id} ${id} expected to fail closed`).toBe(false);
            expect(
              byId[id]?.reasons.some((r) => r.includes('correction diff')),
              `${workerCase.id} ${id} should cite correction disagreement`,
            ).toBe(true);
          }
        }

        evidence.push({
          id: workerCase.id,
          kind: eligibility.kind,
          eligible: eligibility.eligible,
          unknownCount: eligibility.unknownCount,
          dof: outcome.result.dof,
          seuw: outcome.result.seuw,
          iterations: outcome.result.iterations,
          solves: outcome.profile.solveInvocationCount,
          templateSourceSolves: 0,
          stationCovarianceBlocks: outcome.result.stationCovariances?.length ?? 0,
          relativePrecisionRows: outcome.result.relativePrecision?.length ?? 0,
          correctionCalls: diagnostics.sparseCorrectionCalls,
          selectedCovarianceCalls: diagnostics.selectedCovarianceCalls,
          rowProductsCalls: diagnostics.rowProductsCalls,
          fallbacks:
            diagnostics.sparseCorrectionFallbacks +
            diagnostics.rowProductsFallbacks +
            diagnostics.selectedCovarianceFallbacks,
          contractPass: comparison.pass,
          maxCoordDiff: comparison.maxCoordDiff,
          maxCovarianceDiff: comparison.maxCovarianceDiff,
          maxCovarianceRelativeDiff: comparison.maxCovarianceRelativeDiff,
          maxRelativeCovarianceDiff: comparison.maxRelativeCovarianceDiff,
          maxRelativeCovarianceRelativeDiff: comparison.maxRelativeCovarianceRelativeDiff,
          maxRelativePrecisionDiff: comparison.maxRelativePrecisionDiff,
          maxRelativePrecisionRelativeDiff: comparison.maxRelativePrecisionRelativeDiff,
          strategies: Object.fromEntries(
            strategies.map((s) => [s.id, { pass: s.pass, reasons: s.reasons }]),
          ) as CaseEvidence['strategies'],
        });
      }

      // Deterministic repeat of the smallest case through the same protocol.
      const repeatInput = readFixture('tests/fixtures/preanalysis_cli.dat');
      const repeatFirst = await runActualWorker({
        type: 'run',
        runId: 'phase8a-repeat-a',
        payload: makePreanalysisRequest(repeatInput),
      });
      const repeatSecond = await runActualWorker({
        type: 'run',
        runId: 'phase8a-repeat-b',
        payload: makePreanalysisRequest(repeatInput),
      });
      const firstSuccess = repeatFirst.messages[repeatFirst.messages.length - 1];
      const secondSuccess = repeatSecond.messages[repeatSecond.messages.length - 1];
      expect(firstSuccess?.type).toBe('success');
      expect(secondSuccess?.type).toBe('success');
      if (firstSuccess?.type === 'success' && secondSuccess?.type === 'success') {
        for (const [id, station] of Object.entries(firstSuccess.payload.result.stations)) {
          expect(secondSuccess.payload.result.stations[id]?.x).toBe(station.x);
          expect(secondSuccess.payload.result.stations[id]?.y).toBe(station.y);
        }
      }

      const report = {
        phase: '8A',
        scope: 'TEST/EVIDENCE ONLY — no production routing, defaults, tolerances, or baselines changed',
        worker: 'actual production adjustmentWorker with test-only worker-local runtime (real WASM bundle, legacy-all-pairs selected covariance); auto-route never invoked and asserted ineligible for preanalysis',
        templateSourceNote: 'empty-active preanalysis sessions derive templates from the counted main solve; no uncounted template-source solve is performed; every solve contributes exactly one correction and one selected covariance',
        rowProductsNote: 'rowProductsCalls=0 expected for every case: preanalysis skips standardized residuals by construction',
        autoRouteRejectsPreanalysis: true,
        cases: evidence,
        strategyNote: 'S0 static+final agreement; S1 first-system oracle; S2 first-two-systems; S3 every captured system with captured count equal to session solve count',
        unsupportedStrategyEvidence:
          'p-camp-bounded (bounded traverse-only camp design, 48 stations, dof 365) passes S0 fully but S1-S3 fail closed: its planning normal matrix conditions at ~1e51, so the dense rebuild oracle disagrees with every backend correction (diffs 60-242, undamped, finite condition evidence on both sides). The discarded correction cannot move the preanalysis result, so the final contract still agrees exactly.',
        recommendation:
          'Preanalysis sessions stay single-iteration-per-solve, so S3 every-iteration coverage is cheap to keep honest where the planning geometry is well-conditioned; any future production strategy must gate on the recorded condition estimate (fail closed above a calibrated threshold) and cap admitted session solve counts (template + impact scenarios) alongside the existing unknown-count cap before claiming S1-S3. S0 (static admission + final agreement) is supportable for ill-conditioned planning geometries since the correction is discarded.',
      };
      fs.mkdirSync(REPORT_DIR, { recursive: true });
      fs.writeFileSync(
        path.join(REPORT_DIR, 'preanalysis-sparse-evidence.json'),
        `${JSON.stringify(report, null, 2)}\n`,
      );
      const lines = [
        '# Phase 8A preanalysis sparse evidence (test-only, no routing)',
        '',
        `- cases=${evidence.length} contractPass=${evidence.filter((c) => c.contractPass).length} autoRouteRejectsPreanalysis=true`,
        '- rowProductsCalls=0 expected for every case (preanalysis skips standardized residuals by construction).',
        '',
        '| id | dof | seuw | iter | solves | stnCov | relPrec | corrCalls | selCovCalls | rowProd | fallbacks | maxCoord | maxCovAbs | maxCovRel | maxRelCovAbs | maxRelCovRel | maxRelPrecAbs | maxRelPrecRel | S0 | S1 | S2 | S3 |',
        '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
      ];
      for (const row of evidence) {
        lines.push(
          `| ${row.id} | ${row.dof} | ${row.seuw} | ${row.iterations} | ${row.solves} | ${row.stationCovarianceBlocks} | ${row.relativePrecisionRows} | ${row.correctionCalls} | ${row.selectedCovarianceCalls} | ${row.rowProductsCalls} | ${row.fallbacks} | ${fmt(row.maxCoordDiff)} | ${fmt(row.maxCovarianceDiff)} | ${fmt(row.maxCovarianceRelativeDiff)} | ${fmt(row.maxRelativeCovarianceDiff)} | ${fmt(row.maxRelativeCovarianceRelativeDiff)} | ${fmt(row.maxRelativePrecisionDiff)} | ${fmt(row.maxRelativePrecisionRelativeDiff)} | ${row.strategies.S0.pass ? 'pass' : 'FAIL'} | ${row.strategies.S1.pass ? 'pass' : 'FAIL'} | ${row.strategies.S2.pass ? 'pass' : 'FAIL'} | ${row.strategies.S3.pass ? 'pass' : 'FAIL'} |`,
        );
      }
      lines.push('', '## Recommendation', '', report.recommendation, '');
      fs.writeFileSync(path.join(REPORT_DIR, 'preanalysis-sparse-evidence.md'), `${lines.join('\n')}`);

      expect(evidence.length).toBe(WORKER_CASES.length);
      expect(evidence.every((row) => row.contractPass)).toBe(true);
    },
    600000,
  );

  it('records experimental and ineligible preanalysis variants as direct-TypeScript evidence only', () => {
    const rows: { id: string; kind: string; reasons: string[]; detail: string }[] = [];
    const cases: { id: string; input: string; coordMode: '2D' | '3D'; extra: Record<string, unknown> }[] = [
      { id: 'e-small-3d', input: SMALL_3D_INPUT, coordMode: '3D', extra: {} },
      { id: 'e-gps-covariance-2d', input: GPS_COV_2D_INPUT, coordMode: '2D', extra: {} },
      { id: 'x-robust-2d', input: GPS_2D_INPUT, coordMode: '2D', extra: { robustMode: 'huber' } },
      { id: 'x-ts-correlation-2d', input: GPS_2D_INPUT, coordMode: '2D', extra: { tsCorrelationEnabled: true } },
    ];
    for (const variant of cases) {
      const eligibility = classifyPreanalysisSparseEvidence(variant.input, {
        coordMode: variant.coordMode,
        robustMode: String(variant.extra.robustMode ?? 'none'),
        tsCorrelationEnabled: variant.extra.tsCorrelationEnabled === true,
      });
      expect(eligibility.eligible).toBe(false);
      const base = createRunSessionRequest({ input: variant.input });
      const request = createRunSessionRequest({
        input: variant.input,
        parseSettings: {
          ...base.parseSettings,
          runMode: 'preanalysis',
          coordMode: variant.coordMode,
          ...variant.extra,
        },
      });
      const outcome = runAdjustmentSession(request);
      expect(outcome.result.success).toBe(true);
      expect(outcome.result.iterations).toBe(1);
      expect(outcome.result.seuw).toBe(1);
      const autoRoute = deriveSparseAutoRouteEligibility(request);
      rows.push({
        id: variant.id,
        kind: eligibility.kind,
        reasons: [...eligibility.reasons, ...(autoRoute.eligible ? ['UNEXPECTED: auto-route eligible'] : [])],
        detail: `iter=${outcome.result.iterations} dof=${outcome.result.dof} seuw=${outcome.result.seuw} solves=${outcome.profile.solveInvocationCount} autoRouteEligible=${autoRoute.eligible}`,
      });
      if (variant.id === 'x-robust-2d') {
        expect(outcome.result.parseState?.robustMode).toBe('none');
      }
    }
    expect(rows.map((r) => r.id)).toEqual(['e-small-3d', 'e-gps-covariance-2d', 'x-robust-2d', 'x-ts-correlation-2d']);
    expect(rows.every((r) => !r.reasons.some((reason) => reason.includes('UNEXPECTED')))).toBe(true);
    fs.mkdirSync(REPORT_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(REPORT_DIR, 'preanalysis-sparse-evidence-experimental.json'),
      `${JSON.stringify({ scope: 'TEST/EVIDENCE ONLY — direct TypeScript, no worker run', rows }, null, 2)}\n`,
    );
  });
});
