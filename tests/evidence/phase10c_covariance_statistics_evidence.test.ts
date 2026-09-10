/**
 * Phase 10C evidence: dense covariance + statistics cost breakdown.
 *
 * Evidence-only manual campaign (never runs in CI). Uses the genuine 3D
 * corpus (industry_demo + gps-3d-cov-08/16/32/64/128) on the unmodified
 * dense TypeScript path. Records, per fixture:
 *
 * - uninstrumented production-path walls (1 warm-up + 3 measured, median)
 * - profiled runs (1 warm-up + 3 measured, median) with the opt-in
 *   detailed profiler: per-iteration stages, final-covariance
 *   assembly/accumulate/invert + call counts, statistics splits
 *   (residuals / standardized residuals / precision propagation /
 *   diagnostics) + calls, and standardized-residual sub-stages + calls
 * - precision-propagation counts: unknowns, station covariance rows,
 *   all-pairs relativePrecision rows vs n*(n-1)/2, connected/requested
 *   relativeCovariance rows, Qxx dimension
 * - explicit call-graph/contract notes (static, citing source files)
 *
 * An independent real-WASM injected-correction smoke probe runs only when
 * the cpp/build-wasm artifact is present; it never alters production
 * routing and its numeric output is NOT claimed as Qxx equivalence. Qxx
 * equivalence/reuse and A/B/C demand modes are explicitly NOT implemented
 * or measured here. industry_demo is recorded as inadmissible (weak-case
 * observation), never as a parity anchor.
 *
 * No production formulas, tolerances, or public result changes.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

import { LSAEngine } from '../../src/engine/adjust';
import {
  createDetailedSolveProfiler,
  type DetailedSolveProfile,
} from '../../src/engine/adjustDetailedSolveProfile';
import { buildPhase6LargeBenchmarkCases } from '../../src/engine/phase6BenchmarkNetworks';
import type { WebNetWasmFactory } from '../../src/engine/wasm/wasmTypes';
import type { EngineOptions } from '../../src/engine/adjustTypes';

const MEASURED_RUNS = 3;

const industryDemo = readFileSync(join(process.cwd(), 'public/examples/industry_demo.dat'), 'utf8');
const generated = buildPhase6LargeBenchmarkCases(false).filter((item) =>
  ['gps-3d-cov-08', 'gps-3d-16', 'gps-3d-32', 'gps-3d-64', 'gps-3d-128'].includes(item.id),
);
const cases = [
  { id: 'industry_demo-3d-terrestrial', input: industryDemo },
  ...generated.map((item) => ({ id: item.id, input: item.input })),
];

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

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

interface CaseEvidence {
  fixture: string;
  dimension: '3D';
  admissible: boolean;
  inadmissibilityReason: string | null;
  success: boolean;
  converged: boolean;
  iterations: number;
  totalParameters: number;
  scalarEquations: number;
  unknownStations: number;
  tsWallMedianMs: number;
  tsProfiledWallMedianMs: number;
  stageMediansMs: {
    assembly: number;
    accumulate: number;
    factorSolve: number;
    stateUpdate: number;
    covarianceAssembly: number;
    covarianceAccumulate: number;
    covarianceInvert: number;
    statistics: number;
  };
  covarianceCalls: number;
  totalAssemblies: number;
  statisticsDetailMs: {
    residuals: number;
    standardizedResiduals: number;
    precisionPropagation: number;
    diagnostics: number;
    calls: number;
  };
  standardizedResidualDetailMs: {
    statisticsEquationAssembly: number;
    robustWeightPreparation: number;
    statisticsNormalAccumulation: number;
    statisticsQxxInversion: number;
    rowProductConstruction: number;
    perEquationStatistics: number;
    gpsCrossProductTransform: number;
    summaryConstruction: number;
    calls: number;
  };
  precisionPropagation: {
    unknowns: number;
    stationCovarianceRows: number;
    allPairsRows: number;
    expectedAllPairsRows: number;
    allPairsMatchExpected: boolean;
    connectedRequestedRows: number;
    qxxDimension: number | null;
  };
  covariancePlusStatisticsMs: number;
  covariancePlusStatisticsFractionOfWall: number;
  wasmProbe: {
    artifactAvailable: boolean;
    ran: boolean;
    reason: string;
    sparseCorrectionFallbacks: number | null;
    countsMatchDense: boolean | null;
  };
}

const CALL_GRAPH_NOTES = [
  'LSAEngine.solve (src/engine/adjustSolveWorkflow.ts) iterates correction loop then runs post-solve statistics on the converged state.',
  'Per nonlinear iteration: assembleAdjustmentEquations (src/engine/adjustmentEquationAssembly.ts) -> accumulateNormalEquationsFromSparseRows (src/engine/matrix.ts) -> dense factor/solve -> state update; instrumented per-iteration by DetailedSolveProfiler.recordIteration.',
  'Final covariance: recoverFinalNormalCovariance (src/engine/adjustCovarianceRecovery.ts) reassembles the full equation system at converged geometry (duplicate of last loop assembly by design), accumulates the normal matrix, and inverts via invertNormalMatrixForStats; instrumented as covariance assembly/accumulate/invert with call counts.',
  'Standardized residuals: computeStandardizedResidualStatistics (src/engine/adjustStatisticsStandardizedResiduals.ts) reassembles statistics equations, accumulates a statistics normal system, inverts a statistics Qxx, builds row products (tryQueryStandardizedResidualRowProducts, src/engine/adjustStatisticsRowProducts.ts), then per-equation stats with GPS cross-product transforms; instrumented as 8 sub-stages with call counts.',
  'Precision propagation: propagateAdjustmentPrecision (src/engine/adjustStatisticsPrecision.ts) reads dense Qxx entries and computes station blocks plus the legacy all-pairs relativePrecision loop (n*(n-1)/2 rows) over identical dense formulas, plus connected/requested relativeCovariance rows; timed as statisticsDetail.precisionPropagationMs.',
  'Public contract: dense Qxx, stationCovariances, relativePrecision (all-pairs), relativeCovariances, and statistical rows are unchanged by this campaign; the profiler lives outside AdjustmentResult behind test-only EngineOptions.',
];

const CONTRACT_NOTES = [
  'Qxx equivalence between dense and any selected/sparse covariance route is NOT measured here; no selected-covariance solver is injected on the headline path.',
  'Qxx reuse across the final-covariance inversion and the statistics Qxx inversion is NOT implemented or measured; the profile records two separate inversion stages.',
  'Covariance demand modes A (dense all-entry), B (legacy all-pairs compat), C (selected-network) are NOT implemented or measured in this campaign; all-pairs counts below describe the dense legacy contract only.',
  'Real-WASM injected-correction probe (when the artifact exists) exercises the test-only sparseCorrectionSolver seam for one solve per fixture and compares row counts only; it does not claim numeric Qxx/statistics equivalence and does not alter production routing (3D stays ineligible for production sparse dispatch).',
];

describe('Phase 10C covariance and statistics evidence', () => {
  it('profiles dense covariance/statistics stages and writes structured evidence artifacts', async () => {
    const wasmFactory = await loadWasmFactory();
    let sparseCorrectionSolver: EngineOptions['sparseCorrectionSolver'] = undefined;
    if (wasmFactory != null) {
      const { createExperimentalSparseNumericalBundle } = await import(
        '../../src/engine/wasm/experimentalSparseNumericalBundle'
      );
      sparseCorrectionSolver = (await createExperimentalSparseNumericalBundle(wasmFactory))
        .sparseCorrectionSolver;
    }
    const caseEvidence: CaseEvidence[] = [];

    for (const { id, input } of cases) {
      new LSAEngine({ input }).solve();
      const plainWalls: number[] = [];
      for (let run = 0; run < MEASURED_RUNS; run += 1) {
        const started = performance.now();
        new LSAEngine({ input }).solve();
        plainWalls.push(performance.now() - started);
      }
      const tsWall = median(plainWalls);

      const walls: number[] = [];
      const profiles: DetailedSolveProfile[] = [];
      let reference: ReturnType<LSAEngine['solve']> | null = null;
      // Profiled warm-up (discarded) + measured runs.
      new LSAEngine({ input, detailedSolveProfiler: createDetailedSolveProfiler() }).solve();
      for (let run = 0; run < MEASURED_RUNS; run += 1) {
        const profiler = createDetailedSolveProfiler();
        const started = performance.now();
        const result = new LSAEngine({ input, detailedSolveProfiler: profiler }).solve();
        walls.push(performance.now() - started);
        profiles.push(profiler.profile);
        if (run === 0) reference = result;
      }
      const ref = reference!;
      const profile = (field: (_p: DetailedSolveProfile) => number): number =>
        median(profiles.map(field));
      const stageMediansMs = {
        assembly: profile((p) => p.assemblyMs),
        accumulate: profile((p) => p.accumulateMs),
        factorSolve: profile((p) => p.factorSolveMs),
        stateUpdate: profile((p) => p.stateUpdateMs),
        covarianceAssembly: profile((p) => p.covariance.assemblyMs),
        covarianceAccumulate: profile((p) => p.covariance.accumulateMs),
        covarianceInvert: profile((p) => p.covariance.invertMs),
        statistics: profile((p) => p.statisticsMs),
      };
      const covarianceCalls = profiles[0]?.covariance.calls ?? 0;
      const statisticsDetailMs = {
        residuals: profile((p) => p.statisticsDetail.residualsMs),
        standardizedResiduals: profile((p) => p.statisticsDetail.standardizedResidualsMs),
        precisionPropagation: profile((p) => p.statisticsDetail.precisionPropagationMs),
        diagnostics: profile((p) => p.statisticsDetail.diagnosticsMs),
        calls: profiles[0]?.statisticsDetail.calls ?? 0,
      };
      const standardizedResidualDetailMs = {
        statisticsEquationAssembly: profile((p) => p.standardizedResidualDetail.statisticsEquationAssemblyMs),
        robustWeightPreparation: profile((p) => p.standardizedResidualDetail.robustWeightPreparationMs),
        statisticsNormalAccumulation: profile((p) => p.standardizedResidualDetail.statisticsNormalAccumulationMs),
        statisticsQxxInversion: profile((p) => p.standardizedResidualDetail.statisticsQxxInversionMs),
        rowProductConstruction: profile((p) => p.standardizedResidualDetail.rowProductConstructionMs),
        perEquationStatistics: profile((p) => p.standardizedResidualDetail.perEquationStatisticsMs),
        gpsCrossProductTransform: profile((p) => p.standardizedResidualDetail.gpsCrossProductTransformMs),
        summaryConstruction: profile((p) => p.standardizedResidualDetail.summaryConstructionMs),
        calls: profiles[0]?.standardizedResidualDetail.calls ?? 0,
      };

      const totalParameters =
        (Object.keys(ref.stations).length -
          Object.values(ref.stations).filter((s) => s.fixed).length) *
          3 +
        (ref.directionSetDiagnostics?.length ?? 0);
      const scalarEquations = ref.observations.reduce(
        (count, obs) => count + (obs.type === 'gps' ? 3 : 1),
        0,
      );
      const unknowns = Object.values(ref.stations).filter((s) => !s.fixed).length;
      const allPairsRows = ref.relativePrecision?.length ?? 0;
      const expectedAllPairsRows = (unknowns * (unknowns - 1)) / 2;

      // industry_demo is a weak-case observation, never a scaling anchor.
      const admissible =
        id !== 'industry_demo-3d-terrestrial' && ref.success && ref.converged;
      const inadmissibilityReason = admissible
        ? null
        : id === 'industry_demo-3d-terrestrial'
          ? `weak-case observation excluded by policy: success=${ref.success} converged=${ref.converged}`
          : `non-converged reference: success=${ref.success} converged=${ref.converged}`;

      // Independent WASM probe: one injected solve, counts only.
      let wasmProbe: CaseEvidence['wasmProbe'] = {
        artifactAvailable: sparseCorrectionSolver != null,
        ran: false,
        reason:
          sparseCorrectionSolver == null
            ? 'real-WASM artifact unavailable; probe not run, headline dense evidence unaffected'
            : 'not run',
        sparseCorrectionFallbacks: null,
        countsMatchDense: null,
      };
      if (sparseCorrectionSolver != null) {
        const { createExperimentalSparseRouteDiagnostics } = await import(
          '../../src/engine/experimentalSparseDiagnostics'
        );
        const diagnostics = createExperimentalSparseRouteDiagnostics();
        const candidate = new LSAEngine({
          input,
          sparseCorrectionSolver,
          experimentalSparseDiagnostics: diagnostics,
        }).solve();
        wasmProbe = {
          artifactAvailable: true,
          ran: true,
          reason: 'independent test-only injected-correction solve; counts compared, no numeric Qxx claim',
          sparseCorrectionFallbacks: diagnostics.sparseCorrectionFallbacks,
          countsMatchDense:
            (candidate.stationCovariances?.length ?? -1) ===
              (ref.stationCovariances?.length ?? -2) &&
            (candidate.relativePrecision?.length ?? -1) === allPairsRows &&
            (candidate.relativeCovariances?.length ?? -1) ===
              (ref.relativeCovariances?.length ?? -2),
        };
      }

      const covariancePlusStatisticsMs =
        stageMediansMs.covarianceAssembly +
        stageMediansMs.covarianceAccumulate +
        stageMediansMs.covarianceInvert +
        stageMediansMs.statistics;
      caseEvidence.push({
        fixture: id,
        dimension: '3D',
        admissible,
        inadmissibilityReason,
        success: ref.success,
        converged: ref.converged,
        iterations: ref.iterations,
        totalParameters,
        scalarEquations,
        unknownStations: unknowns,
        tsWallMedianMs: tsWall,
        tsProfiledWallMedianMs: median(walls),
        stageMediansMs,
        covarianceCalls,
        totalAssemblies: ref.iterations + covarianceCalls,
        statisticsDetailMs,
        standardizedResidualDetailMs,
        precisionPropagation: {
          unknowns,
          stationCovarianceRows: ref.stationCovariances?.length ?? 0,
          allPairsRows,
          expectedAllPairsRows,
          allPairsMatchExpected: allPairsRows === expectedAllPairsRows,
          connectedRequestedRows: ref.relativeCovariances?.length ?? 0,
          qxxDimension: totalParameters > 0 ? totalParameters : null,
        },
        covariancePlusStatisticsMs,
        covariancePlusStatisticsFractionOfWall:
          tsWall > 0 ? covariancePlusStatisticsMs / tsWall : 0,
        wasmProbe,
      });
    }

    const outputDir = join(process.cwd(), 'artifacts/evidence/phase10c');
    mkdirSync(outputDir, { recursive: true });
    const payload = {
      status: 'complete',
      method: '1 warm-up + 3 measured uninstrumented runs; 1 warm-up + 3 measured profiled runs; medians reported',
      modesNotMeasured: ['Qxx equivalence', 'Qxx reuse', 'demand mode A', 'demand mode B', 'demand mode C'],
      callGraph: CALL_GRAPH_NOTES,
      contracts: CONTRACT_NOTES,
      cases: caseEvidence,
    };
    writeFileSync(join(outputDir, 'phase10c-evidence.json'), `${JSON.stringify(payload, null, 2)}\n`);
    const markdown = [
      '# Phase 10C covariance and statistics evidence',
      '',
      'Evidence-only dense TypeScript campaign on the genuine 3D corpus. Timings: Node process, 1 warm-up + 3 measured uninstrumented runs and 1 warm-up + 3 measured profiled runs; medians reported. industry_demo is inadmissible (weak-case observation). Qxx equivalence/reuse and A/B/C demand modes are NOT implemented or measured.',
      '',
      '| Fixture | params | rows | iters | TS wall ms | cov+stats ms | cov calls | stats calls | stdres calls | all-pairs rows | all-pairs expected |',
      '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
      ...caseEvidence.map(
        (c) =>
          `| ${c.fixture} | ${c.totalParameters} | ${c.scalarEquations} | ${c.iterations} | ${c.tsWallMedianMs.toFixed(2)} | ${c.covariancePlusStatisticsMs.toFixed(2)} | ${c.covarianceCalls} | ${c.statisticsDetailMs.calls} | ${c.standardizedResidualDetailMs.calls} | ${c.precisionPropagation.allPairsRows} | ${c.precisionPropagation.expectedAllPairsRows} |`,
      ),
      '',
      '## Profiler stages (medians, ms)',
      '',
      '| Fixture | assembly | accumulate | factor/solve | state upd | cov assembly | cov accumulate | cov invert | statistics | precision propagation | row products | stats Qxx invert |',
      '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
      ...caseEvidence.map(
        (c) =>
          `| ${c.fixture} | ${c.stageMediansMs.assembly.toFixed(2)} | ${c.stageMediansMs.accumulate.toFixed(2)} | ${c.stageMediansMs.factorSolve.toFixed(2)} | ${c.stageMediansMs.stateUpdate.toFixed(2)} | ${c.stageMediansMs.covarianceAssembly.toFixed(2)} | ${c.stageMediansMs.covarianceAccumulate.toFixed(2)} | ${c.stageMediansMs.covarianceInvert.toFixed(2)} | ${c.stageMediansMs.statistics.toFixed(2)} | ${c.statisticsDetailMs.precisionPropagation.toFixed(2)} | ${c.standardizedResidualDetailMs.rowProductConstruction.toFixed(2)} | ${c.standardizedResidualDetailMs.statisticsQxxInversion.toFixed(2)} |`,
      ),
      '',
      '## Call graph',
      '',
      ...CALL_GRAPH_NOTES.map((note) => `- ${note}`),
      '',
      '## Contracts and non-claims',
      '',
      ...CONTRACT_NOTES.map((note) => `- ${note}`),
      '',
      '## Recommendation',
      '',
      'MORE EVIDENCE REQUIRED: this campaign quantifies the dense covariance + statistics tail and its all-pairs counts, but measures no selected/sparse alternative, no Qxx equivalence, and no reuse. Do not route covariance or statistics off the dense path until a follow-up campaign measures those modes.',
    ].join('\n');
    writeFileSync(join(outputDir, 'phase10c-evidence.md'), `${markdown}\n`);

    for (const c of caseEvidence) {
      if (!c.admissible) {
        expect(c.inadmissibilityReason).toContain('weak-case observation');
        continue;
      }
      expect(c.success && c.converged, `${c.fixture} reference solves`).toBe(true);
      expect(c.covarianceCalls, `${c.fixture} single final-covariance recovery`).toBe(1);
      expect(
        c.precisionPropagation.allPairsMatchExpected,
        `${c.fixture} dense all-pairs count`,
      ).toBe(true);
      expect(
        c.precisionPropagation.stationCovarianceRows,
        `${c.fixture} station rows cover unknowns`,
      ).toBe(c.precisionPropagation.unknowns);
    }
    expect(caseEvidence.filter((c) => c.admissible).map((c) => c.fixture)).toEqual([
      'gps-3d-cov-08',
      'gps-3d-16',
      'gps-3d-32',
      'gps-3d-64',
      'gps-3d-128',
    ]);
  }, 600000);
});
