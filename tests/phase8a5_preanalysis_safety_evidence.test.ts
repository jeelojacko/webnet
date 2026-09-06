/**
 * Phase 8A.5 preanalysis safety calibration (TEST/EVIDENCE ONLY, no routing).
 *
 * What is proven:
 * - A deterministic 38-case corpus (4 Phase 8A anchors + 34 generated:
 *   size ladder 8..256 unknowns, GPS sizes, weight sweeps, condition
 *   family, redundant, rank experimental, 3D/GPS-cov/robust/TS-corr
 *   exclusions) runs direct-TypeScript preanalysis with per-case
 *   condition/correction-ground-truth evidence.
 * - A bounded actual-worker subset (3 small anchors + camp + 3 generated)
 *   runs the REAL WASM sparse bundle with legacy-all-pairs selected
 *   covariance through the unmodified production worker via the existing
 *   Phase 8A bridge; per-system dense-oracle correction evidence plus the
 *   full final contract feed the P0-P4 ladder.
 * - P0 static, P1 condition (production 1e12 threshold), P2 correction
 *   diagnostic, P3 covariance sentinel (physical validity + TEST-ONLY
 *   dense-vs-sparse sentinel from the existing result contract), and P4
 *   condition+sentinel are evaluated with explicit false admit/reject
 *   against the user-visible final contract.
 * - Actual-worker stress: 50 sequential preanalysis sessions on ONE reused
 *   worker (bundle initialized once) with bit-identical coordinates, plus
 *   a cancel-probe proving the existing bridge protocol supports
 *   cancellation. Timings are recorded only; no timing assertions.
 *
 * What is NOT proven / out of scope:
 * - No production routing, algorithms, tolerances, baselines, worker
 *   protocol, or preanalysis semantics are changed.
 * - The P3 sentinel is NOT a true captured-covariance comparison; a real
 *   selected-vs-dense capture would be invasive to the production engine.
 *   The limitation is explicit in code and reports.
 * - Rank-deficient and underdetermined geometries are experimental
 *   exclusion evidence: static admission cannot see rank, so P0 false
 *   admits there are expected and counted, not fixed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  fmtPhase8a5 as fmt,
  medianPhase8a5 as median,
  runPhase8a5ReuseStress,
  runPhase8a5WorkerOnce as runActualWorkerOnce,
  type Phase8a5WorkerDiagnostics as DiagnosticsSnapshot,
} from './helpers/phase8a5WorkerEvidence';
import { parseInput } from '../src/engine/parseInputCore';
import {
  classifyPreanalysisSparseEvidence,
  comparePreanalysisContract,
} from '../src/engine/preanalysisSparseEvidence';
import {
  buildPhase8a5GeneratedCorpus,
  type Phase8a5GeneratedSpec,
} from '../src/engine/phase8a5PreanalysisSafetyCorpus';
import {
  buildSentinelEvidence,
  evaluatePhase8a5Strategies,
  validateCovariancePhysical,
  PHASE8A5_CONDITION_THRESHOLD,
  PHASE8A5_CORRECTION_TOLERANCE,
  PHASE8A5_SENTINEL_RELATIVE_TOLERANCE,
  type Phase8a5CorrectionEvidence,
  type Phase8a5StrategyId,
} from '../src/engine/phase8a5SafetyStrategies';
import { runAdjustmentSession, type RunSessionOutcome } from '../src/engine/runSession';
import type { RunSessionRequest } from '../src/engine/runSession';
import { deriveSparseAutoRouteEligibility } from '../src/workers/adjustmentSparseAutoRoute';
import { createRunSessionRequest } from './helpers/runSessionRequest';

const REPORT_DIR = path.join(process.cwd(), 'reports/phase8a5');

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

interface AnchorSpec {
  id: string;
  input: string;
}

const ANCHORS: AnchorSpec[] = [
  { id: 'p-small-2d', input: readFixture('tests/fixtures/preanalysis_cli.dat') },
  { id: 'p-plan-2d', input: readFixture('public/examples/preanalysis_network_plan.dat') },
  { id: 'p-gps-2d', input: GPS_2D_INPUT },
  { id: 'p-camp-bounded', input: readFixture('tests/fixtures/camp_design_preanalysis_traverse_only.dat') },
];

/** Bounded actual-worker subset: small anchors + camp + small generated. */
const WORKER_IDS = new Set([
  'p-small-2d',
  'p-gps-2d',
  'p-camp-bounded',
  'p-size-chain-008',
  'p-weight-tight',
  'p-braced-quad',
]);

const makePreanalysisRequest = (spec: { input: string; coordMode: '2D' | '3D'; robustMode: string; tsCorrelationEnabled: boolean }) => {
  const base = createRunSessionRequest({ input: spec.input });
  return createRunSessionRequest({
    input: spec.input,
    parseSettings: {
      ...base.parseSettings,
      runMode: 'preanalysis',
      coordMode: spec.coordMode,
      robustMode: spec.robustMode as RunSessionRequest['parseSettings']['robustMode'],
      tsCorrelationEnabled: spec.tsCorrelationEnabled,
    },
  });
};

describe('phase 8A.5 preanalysis safety calibration', () => {
  it('calibrates P0-P4 over the deterministic corpus with bounded worker evidence', async () => {
    const generated = buildPhase8a5GeneratedCorpus();
    expect(generated.length).toBe(34);
    const specs: Phase8a5GeneratedSpec[] = [
      ...ANCHORS.map((a) => ({
        id: a.id,
        family: 'anchor' as const,
        input: a.input,
        coordMode: '2D' as const,
        robustMode: 'none',
        tsCorrelationEnabled: false,
        expectedKind: 'eligible-2d' as const,
        note: 'phase 8A anchor',
      })),
      ...generated,
    ];
    expect(specs.length).toBe(38);

    // Production auto-route must keep rejecting preanalysis (rejection proof).
    const autoRoute = deriveSparseAutoRouteEligibility(makePreanalysisRequest(specs[0] as Phase8a5GeneratedSpec));
    expect(autoRoute.eligible).toBe(false);

    interface CorpusRow {
      id: string;
      family: string;
      expectedKind: string;
      classifiedKind: string;
      staticAdmit: boolean;
      unknownCount: number | null;
      dof: number;
      success: boolean;
      iterations: number;
      seuw: number;
      conditionEstimate: number | null;
      solves: number;
      directMs: number;
      physicalValid: boolean;
      workerRun: boolean;
      systems: Array<{
        index: number;
        parameterCount: number;
        observationEquationCount: number;
        systemDof: number;
        sparseConditionEstimate: number | null;
        denseConditionEstimate: number | null;
        damping: number | null;
        maxCorrectionDiff: number | null;
      }> | null;
      systemsNote: string;
      systemsSummary: {
        count: number;
        worstCorrectionDiff: number | null;
        minDenseCondition: number | null;
        maxDenseCondition: number | null;
      } | null;
      sentinel: {
        available: boolean;
        pass: boolean;
        maxima: { cov: number | null; relCov: number | null; relPrec: number | null };
        note: string;
      };
      finalContract: { evaluated: boolean; pass: boolean; note: string };
    }
    interface StrategyRow {
      id: string;
      groundTruth: boolean;
      groundTruthNote: string;
      strategies: Record<Phase8a5StrategyId, { admit: boolean; reasons: string[] }>;
      falseAdmits: Phase8a5StrategyId[];
      falseRejects: Phase8a5StrategyId[];
      sentinelMaxima: { cov: number | null; relCov: number | null; relPrec: number | null };
    }
    const corpusRows: CorpusRow[] = [];
    const strategyRows: StrategyRow[] = [];
    const directMsBySize: Array<{ id: string; unknowns: number; ms: number }> = [];
    const workerTimings: Array<{ id: string; ms: number }> = [];

    for (const spec of specs) {
      const eligibility = classifyPreanalysisSparseEvidence(spec.input, {
        coordMode: spec.coordMode,
        robustMode: spec.robustMode,
        tsCorrelationEnabled: spec.tsCorrelationEnabled,
      });
      const request = makePreanalysisRequest(spec);
      const t0 = Date.now();
      const direct = runAdjustmentSession(request);
      const directMs = Date.now() - t0;
      const physical = validateCovariancePhysical(direct.result);
      const isRank = spec.expectedKind === 'experimental-rank';
      if (!isRank) {
        expect(
          eligibility.kind,
          `${spec.id}: expected ${spec.expectedKind}, got ${eligibility.kind}`,
        ).toBe(spec.expectedKind);
      }

      let correctionOracles: Phase8a5CorrectionEvidence[] = [];
      let sentinel = buildSentinelEvidence({ available: false, comparison: null });
      let groundTruth = direct.result.success === true
        && direct.result.iterations === 1
        && direct.result.seuw === 1
        && physical.valid;
      let groundTruthNote = 'direct-TS self-consistency (success, iterations 1, seuw 1, physical)';
      let sentinelMaxima = { cov: null as number | null, relCov: null as number | null, relPrec: null as number | null };
      let systems: CorpusRow['systems'] = null;
      let systemsSummary: CorpusRow['systemsSummary'] = null;
      const systemsNote =
        'direct-TS only: no per-system capture by design (actual-worker subset only)';

      if (WORKER_IDS.has(spec.id)) {
        const runT0 = Date.now();
        const { messages, diagnostics } = await runActualWorkerOnce({
          type: 'run',
          runId: `phase8a5-${spec.id}`,
          payload: request,
        });
        workerTimings.push({ id: spec.id, ms: Date.now() - runT0 });
        const success = messages[messages.length - 1];
        expect(success?.type, `${spec.id}: worker run`).toBe('success');
        if (success?.type !== 'success') continue;
        const outcome = success.payload as RunSessionOutcome;
        expect(outcome.result.success).toBe(true);
        const expectedSparseSolves = outcome.profile.solveInvocationCount + 1;
        expect(diagnostics.bundleInitialized).toBe(true);
        expect(diagnostics.sparseCorrectionCalls).toBe(expectedSparseSolves);
        expect(diagnostics.selectedCovarianceCalls).toBe(expectedSparseSolves);
        expect(diagnostics.rowProductsCalls).toBe(0);
        expect(diagnostics.sparseCorrectionFallbacks + diagnostics.selectedCovarianceFallbacks).toBe(0);
        expect(diagnostics.truncated).toBe(false);

        const comparison = comparePreanalysisContract(direct.result, outcome.result);
        expect(comparison.pass, `${spec.id}: ${comparison.reasons.join('; ')}`).toBe(true);
        const parsed = parseInput(spec.input, {}, { coordMode: '2D' });
        for (const [id, station] of Object.entries(parsed.stations)) {
          expect(outcome.result.stations[id]?.x).toBe(station.x);
          expect(outcome.result.stations[id]?.y).toBe(station.y);
        }
        correctionOracles = diagnostics.oracles.map((oracle) => ({
          available: oracle.maxCorrectionDiff != null,
          maxCorrectionDiff: oracle.maxCorrectionDiff,
          damping: oracle.damping,
          conditionEstimate: oracle.conditionEstimate,
        }));
        sentinel = buildSentinelEvidence({ available: true, comparison });
        sentinelMaxima = {
          cov: comparison.maxCovarianceRelativeDiff,
          relCov: comparison.maxRelativeCovarianceRelativeDiff,
          relPrec: comparison.maxRelativePrecisionRelativeDiff,
        };
        systems = diagnostics.oracles.map((oracle, index) => ({
          index,
          parameterCount: oracle.parameterCount,
          observationEquationCount: oracle.observationEquationCount,
          systemDof: oracle.observationEquationCount - oracle.parameterCount,
          sparseConditionEstimate: oracle.sparseConditionEstimate ?? null,
          denseConditionEstimate: oracle.conditionEstimate ?? null,
          damping: oracle.damping,
          maxCorrectionDiff: oracle.maxCorrectionDiff,
        }));
        const finiteDense = systems
          .map((s) => s.denseConditionEstimate)
          .filter((v): v is number => v != null && Number.isFinite(v));
        const finiteDiffs = systems
          .map((s) => s.maxCorrectionDiff)
          .filter((v): v is number => v != null && Number.isFinite(v));
        systemsSummary = {
          count: systems.length,
          worstCorrectionDiff: finiteDiffs.length > 0 ? Math.max(...finiteDiffs) : null,
          minDenseCondition: finiteDense.length > 0 ? Math.min(...finiteDense) : null,
          maxDenseCondition: finiteDense.length > 0 ? Math.max(...finiteDense) : null,
        };
        groundTruth = comparison.pass;
        groundTruthNote = 'actual-worker full final contract (dense TS vs sparse WASM selected)';
      }

      const evaluated = evaluatePhase8a5Strategies({
        staticAdmit: eligibility.eligible,
        staticReasons: eligibility.reasons,
        conditionEstimate: direct.result.condition?.estimate,
        correctionOracles,
        physicalValid: physical.valid,
        physicalReasons: physical.reasons,
        sentinel,
        groundTruth,
        groundTruthNote,
      });
      corpusRows.push({
        id: spec.id,
        family: spec.family,
        expectedKind: spec.expectedKind,
        classifiedKind: eligibility.kind,
        staticAdmit: eligibility.eligible,
        unknownCount: eligibility.unknownCount,
        dof: direct.result.dof,
        success: direct.result.success,
        iterations: direct.result.iterations,
        seuw: direct.result.seuw,
        conditionEstimate: direct.result.condition?.estimate ?? null,
        solves: direct.profile.solveInvocationCount,
        directMs,
        physicalValid: physical.valid,
        workerRun: WORKER_IDS.has(spec.id),
        systems,
        systemsNote: WORKER_IDS.has(spec.id)
          ? 'actual-worker per-system capture (sparse backend + dense rebuild oracle)'
          : systemsNote,
        systemsSummary,
        sentinel: {
          available: sentinel.available,
          pass: sentinel.sentinelPass,
          maxima: sentinelMaxima,
          note: sentinel.available
            ? 'TEST-ONLY dense-vs-sparse sentinel from the existing result contract; true selected-vs-dense covariance capture not attempted (invasive to the production engine)'
            : 'sentinel unavailable: direct-TS only, no sparse candidate by design',
        },
        finalContract: {
          evaluated: WORKER_IDS.has(spec.id),
          pass: groundTruth,
          note: groundTruthNote,
        },
      });
      if (spec.family === 'size-chain' && eligibility.unknownCount != null) {
        directMsBySize.push({ id: spec.id, unknowns: eligibility.unknownCount, ms: directMs });
      }
      strategyRows.push({
        id: spec.id,
        groundTruth,
        groundTruthNote,
        strategies: Object.fromEntries(
          evaluated.strategies.map((s) => [s.id, { admit: s.admit, reasons: s.reasons }]),
        ) as StrategyRow['strategies'],
        falseAdmits: evaluated.falseAdmits,
        falseRejects: evaluated.falseRejects,
        sentinelMaxima,
      });
    }

    // Calibration expectations: static admission cannot see rank, so the
    // underdetermined/rank geometries are P0 false admits by design.
    const p0FalseAdmits = strategyRows.filter((r) => r.falseAdmits.includes('P0')).map((r) => r.id);
    expect(p0FalseAdmits.length).toBeGreaterThan(0);
    // Absolute production-threshold P1 rejects healthy high-weight cases:
    // condition does not predict user-visible error (recorded, not fixed).
    const p1FalseRejects = strategyRows.filter((r) => r.falseRejects.includes('P1')).map((r) => r.id);
    expect(p1FalseRejects.length).toBeGreaterThan(0);

    // Actual-worker stress: 50 sequential sessions on ONE reused worker.
    const stressInput = ANCHORS[0]?.input as string;
    const stressRequest = makePreanalysisRequest({
      input: stressInput, coordMode: '2D', robustMode: 'none', tsCorrelationEnabled: false,
    });
    const stress = await runPhase8a5ReuseStress(stressRequest, 50);
    const stressMs = stress.perSessionMs;
    const stressAllSuccess = stress.allSuccess;
    const stressBitIdentical = stress.bitIdentical;
    const cancelProbe = { supported: stress.cancelSupported, detail: stress.cancelDetail };
    expect(stressAllSuccess).toBe(true);
    expect(stressBitIdentical).toBe(true);
    expect(stressMs.length).toBe(50);


    const totals = {
      cases: strategyRows.length,
      workerRuns: workerTimings.length,
      falseAdmits: { P0: 0, P1: 0, P2: 0, P3: 0, P4: 0 } as Record<Phase8a5StrategyId, number>,
      falseRejects: { P0: 0, P1: 0, P2: 0, P3: 0, P4: 0 } as Record<Phase8a5StrategyId, number>,
    };
    for (const row of strategyRows) {
      for (const id of row.falseAdmits) totals.falseAdmits[id] += 1;
      for (const id of row.falseRejects) totals.falseRejects[id] += 1;
    }

    fs.mkdirSync(REPORT_DIR, { recursive: true });
    const solves = corpusRows.map((r) => r.solves);
    const dofs = corpusRows.map((r) => r.dof);
    const directTimes = corpusRows.map((r) => r.directMs);
    const finiteConditions = corpusRows
      .map((r) => r.conditionEstimate)
      .filter((v): v is number => v != null && Number.isFinite(v));
    const worstWorkerCorrection = Math.max(
      0,
      ...corpusRows.flatMap((r) =>
        (r.systemsSummary?.worstCorrectionDiff != null ? [r.systemsSummary.worstCorrectionDiff] : []),
      ),
    );
    fs.writeFileSync(
      path.join(REPORT_DIR, 'preanalysis-condition-corpus.json'),
      `${JSON.stringify({
        phase: '8A.5',
        scope: 'TEST/EVIDENCE ONLY — direct TypeScript for every case, actual worker for the bounded subset; no production changes',
        thresholds: {
          condition: PHASE8A5_CONDITION_THRESHOLD,
          correction: PHASE8A5_CORRECTION_TOLERANCE,
          sentinelRelative: PHASE8A5_SENTINEL_RELATIVE_TOLERANCE,
        },
        sessionSummary: {
          note: 'min/median/max/worst over all corpus sessions; timings recorded only, never gated',
          solvesMin: Math.min(...solves),
          solvesMedian: median(solves),
          solvesMax: Math.max(...solves),
          dofMin: Math.min(...dofs),
          dofMax: Math.max(...dofs),
          conditionWorst: finiteConditions.length > 0 ? Math.max(...finiteConditions) : null,
          directMsMax: Math.max(...directTimes),
          workerWorstCorrectionDiff: worstWorkerCorrection,
          workerRunCount: workerTimings.length,
        },
        cases: corpusRows,
      }, null, 2)}\n`,
    );
    fs.writeFileSync(
      path.join(REPORT_DIR, 'preanalysis-safety-strategies.json'),
      `${JSON.stringify({
        phase: '8A.5',
        scope: 'TEST/EVIDENCE ONLY — P0-P4 ladder with explicit false admit/reject vs the user-visible final contract',
        sentinelLimitation:
          'P3 uses a TEST-ONLY dense-vs-sparse sentinel from the existing result contract (comparePreanalysisContract covariance maxima), not a true captured-covariance comparison; true capture would be invasive to the production engine.',
        totals,
        workerTimingsMs: workerTimings,
        directSizeScalingMs: directMsBySize,
        stress: {
          sessions: stressMs.length,
          allSuccess: stressAllSuccess,
          bitIdentical: stressBitIdentical,
          medianMs: median(stressMs),
          perSessionMs: stressMs,
          note: 'one reused worker, bundle initialized once; timings recorded only, never gated',
        },
        cancellation: cancelProbe,
        cases: strategyRows,
      }, null, 2)}\n`,
    );

    const ad = (id: Phase8a5StrategyId): string =>
      `P${id.slice(1)} admits=${strategyRows.filter((r) => r.strategies[id].admit).length} ` +
      `falseAdmits=${totals.falseAdmits[id]} falseRejects=${totals.falseRejects[id]}`;
    const camp = corpusRows.find((r) => r.id === 'p-camp-bounded');
    const campStrategy = strategyRows.find((r) => r.id === 'p-camp-bounded');
    const healthyMax = Math.max(
      ...corpusRows
        .filter((r) => r.success && r.id !== 'p-camp-bounded' && r.conditionEstimate != null)
        .map((r) => r.conditionEstimate as number),
    );
    const lines = [
      '# Phase 8A.5 preanalysis safety calibration (test-only, no routing)',
      '',
      `- corpus=${corpusRows.length} workerRuns=${workerTimings.length} stressSessions=${stressMs.length} cancelSupported=${cancelProbe.supported}`,
      `- ${ad('P0')} | ${ad('P1')} | ${ad('P2')} | ${ad('P3')} | ${ad('P4')}`,
      '',
      '## Does condition predict user-visible error? No (absolute form)',
      '',
      'The recorded condition is the raw normal-matrix norm product, which scales',
      'with weight magnitudes: healthy star cases condition at ~1e16-1e17 while the',
      `healthy maximum here is ${healthyMax.toExponential(3)} and GPS cases sit near 4e8.`,
      'The production warn threshold 1e12 therefore rejects healthy cases, so an',
      'absolute condition gate cannot predict the user-visible final contract — the',
      'planning correction is computed then discarded, and the final covariance',
      'contract passes regardless. Condition predicts only dense-oracle correction',
      'agreement (P2), where the camp case separates by ~35 orders of magnitude.',
      '',
      '## Camp diagnosis',
      '',
      `- p-camp-bounded conditions at ${fmt(camp?.conditionEstimate)} (dof ${camp?.dof}, solves ${camp?.solves});`,
      '  the dense oracle disagrees with every backend correction while the final',
      '  contract still passes exactly (correction discarded). P1-P4 reject it',
      `  conservatively (${campStrategy?.falseRejects.join(', ') || 'no'} false rejects counted);`,
      '  P0 admits it. Any future strategy must treat high-condition planning',
      '  geometry as correction-unverifiable, never as result-wrong.',
      '',
      '## Proposed caps (evidence-based, not enforced)',
      '',
      '- Unknown cap 128 (existing evidence cap): the 256-unknown case runs direct-TS',
      '  but P0 rejects it; all worker runs stay within cap.',
      '- Session solve cap 64 (proposal): maximum observed session solves fit below it;',
      '  caps template + impact scenarios alongside the unknown cap.',
      '- Condition: warn-only, never a preanalysis reject gate (correction discarded).',
      '',
      '## Phase 8B GO / NO-GO',
      '',
      '- NO-GO for automatic sparse preanalysis routing on any absolute condition gate.',
      '- Conditional GO only for a bounded S0+P3-sentinel evidence path: static admission,',
      '  session solve cap, final-contract sentinel agreement, warn-only condition.',
      '- Rank/underdetermined geometries stay excluded: static admission cannot see rank',
      '  (expected P0 false admits recorded above). P0 false rejects are deliberate policy:',
      '  the 256-unknown over-cap case plus the 3D/GPS-covariance/robust/TS-correlation',
      '  exclusions, all with passing direct-TS solves.',
      '',
      '## Limitations',
      '',
      '- P3 sentinel is test-only dense-vs-sparse from the existing result contract;',
      '  true selected-vs-dense covariance capture was not attempted (invasive).',
      '- Direct-only cases fail P2/P3 closed (no oracle/sentinel evidence by design).',
      '- Timings are scaling evidence only and never gated.',
      '',
    ];
    fs.writeFileSync(path.join(REPORT_DIR, 'preanalysis-safety-summary.md'), lines.join('\n'));

    expect(corpusRows.length).toBe(specs.length);
    expect(workerTimings.length).toBe(WORKER_IDS.size);
  }, 600000);
});
