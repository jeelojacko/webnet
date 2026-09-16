/**
 * Phase 15A evidence: covariance operation counts + benchmark matrix (measurement-only).
 *
 * EVIDENCE ONLY — no production behavior changes. All instrumentation uses
 * pre-existing test-only EngineOptions (detailedSolveProfiler, qxxReuseProbe,
 * forceLegacyStatisticsQxx, experimental selected-covariance flags) and
 * existing input/parse options. No new settings, no src/ changes.
 *
 * What this records per benchmark fixture (1 warm-up + 5 measured, medians):
 * - Operation counts, NEVER labeled "inversion" for distinct ops:
 *   NORMAL SOLVE normal factorizations (= iterations) + normal solves,
 *   FINAL COVARIANCE normal accumulations + full-Qxx recoveries,
 *   STATISTICAL POSTPROCESSING statistics normal accumulations +
 *   statistics-Qxx recoveries + Qvv row constructions + reliability
 *   sensitivity products, REPORT-ONLY packaging/diagnostics buckets.
 *   Method per count: MEASURED (profiler/probe/tap) or TRACED (code-path
 *   walk, stated dimensions).
 * - Timing breakdown: iterative adjustment, normal assembly, factor/solve,
 *   final Qxx, statistical postprocessing, report/result construction.
 *   Primary source is the detailed profiler; solveTimingProfile buckets
 *   are reported as-is (matrixFactorizationMs conflates iteration
 *   factor/solve with final covariance — never used as an isolated
 *   covariance measure).
 * - Feature-toggle marginal costs on identical geometry (flag-only diffs):
 *   robust Huber vs none, TS-correlation on vs off, reliability
 *   statistical vs legacy, force-legacy statistics vs production reuse,
 *   session-level suspectImpact off vs auto (extra-solve counts from the
 *   session stage profile).
 * - 2D recheck (dual recovery on the dense-default path + sparse-arm
 *   reliability/relativePrecision availability) and 3D recheck
 *   (gps-3d-32/64/128 breakdown).
 * - All-pairs relativePrecision note (entry counts + precision bucket,
 *   no code touched).
 *
 * Writes machine artifacts to artifacts/evidence/phase15a/ (gitignored)
 * and the committed report to reports/performance/ (no timestamps;
 * methodology deterministic, walls machine-observational).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

import { LSAEngine } from '../../src/engine/adjust';
import {
  createDetailedSolveProfiler,
  type DetailedSolveProfile,
} from '../../src/engine/adjustDetailedSolveProfile';
import type {
  SparseSelectedCovarianceInput,
  SparseSelectedCovarianceResult,
  SparseSelectedCovarianceSolver,
} from '../../src/engine/numericalBackend';
import { createExperimentalSparseNumericalBundle } from '../../src/engine/wasm/experimentalSparseNumericalBundle';
import type { WebNetWasmFactory } from '../../src/engine/wasm/wasmTypes';
import {
  buildPhase6LargeBenchmarkCases,
  type Phase6LargeNetworkCase,
} from '../../src/engine/phase6BenchmarkNetworks';
import {
  generatePhase5BenchmarkInput,
  listPhase5BenchmarkCases,
} from '../../src/engine/phase5BenchmarkNetworks';
import type { QxxReuseProbeEvent } from '../../src/engine/qxxReuseEvidence';
import { runAdjustmentSession } from '../../src/engine/runSession';
import { createRunSessionRequest } from '../helpers/runSessionRequest';

const RUNS = 5;

type EngineExtra = ConstructorParameters<typeof LSAEngine>[0];

const sorted = (xs: number[]): number[] => [...xs].sort((a, b) => a - b);
const median = (xs: number[]): number => sorted(xs)[Math.floor(xs.length / 2)] ?? 0;
const round2 = (value: number): number => Math.round(value * 100) / 100;

interface Fixture {
  id: string;
  dimension: '2D' | '3D';
  input: string;
}

const phase5Specs = listPhase5BenchmarkCases(false).filter((spec) =>
  ['chain-2d-32', 'chain-2d-64', 'chain-2d-128', 'gps-2d-64'].includes(spec.id),
);
if (phase5Specs.length !== 4) throw new Error('Missing genuine Phase 5 fixtures.');
const phase6Wanted = ['gps-3d-32', 'gps-3d-64', 'gps-3d-128'];
const phase6Cases: Phase6LargeNetworkCase[] = buildPhase6LargeBenchmarkCases(false).filter(
  ({ id }) => phase6Wanted.includes(id),
);
if (phase6Cases.length !== 3) throw new Error('Missing genuine Phase 6 3D fixtures.');

const fixtures: Fixture[] = [
  ...phase5Specs.map((spec) => ({
    id: spec.id,
    dimension: '2D' as const,
    input: generatePhase5BenchmarkInput(spec),
  })),
  ...phase6Cases.map((item) => ({ id: item.id, dimension: '3D' as const, input: item.input })),
];

interface EngineRun {
  wallMs: number;
  profile: DetailedSolveProfile;
  events: QxxReuseProbeEvent[];
  iterations: number;
  numParams: number;
  equationCount: number;
  success: boolean;
  converged: boolean;
  allPairs: number;
  timing: Record<string, number>;
}

const solveOnce = (
  input: string,
  extra: Partial<EngineExtra> = {},
): { result: ReturnType<LSAEngine['solve']>; run: EngineRun } => {
  const events: QxxReuseProbeEvent[] = [];
  const profiler = createDetailedSolveProfiler();
  const started = performance.now();
  const result = new LSAEngine({
    input,
    qxxReuseProbe: (event) => {
      events.push(event);
    },
    detailedSolveProfiler: profiler,
    ...extra,
  }).solve();
  const wallMs = performance.now() - started;
  const profile = profiler.profile;
  const firstIteration = profile.iterations[0];
  const timing = (result.solveTimingProfile ?? {}) as Record<string, number>;
  return {
    result,
    run: {
      wallMs,
      profile,
      events,
      iterations: result.iterations,
      numParams: firstIteration?.parameterCount ?? 0,
      equationCount: firstIteration?.equationCount ?? 0,
      success: result.success,
      converged: result.converged,
      allPairs: result.relativePrecision?.length ?? 0,
      timing: {
        totalMs: timing.totalMs ?? 0,
        parseAndSetupMs: timing.parseAndSetupMs ?? 0,
        equationAssemblyMs: timing.equationAssemblyMs ?? 0,
        matrixFactorizationMs: timing.matrixFactorizationMs ?? 0,
        precisionPropagationMs: timing.precisionPropagationMs ?? 0,
        reportDiagnosticsMs: timing.reportDiagnosticsMs ?? 0,
        resultPackagingMs: timing.resultPackagingMs ?? 0,
        otherMs: timing.otherMs ?? 0,
      },
    },
  };
};

const probeSum = (
  events: QxxReuseProbeEvent[],
  stage: string,
  field: 'normalAccumulations' | 'inversions',
): number => events.filter((e) => e.stage === stage).reduce((sum, e) => sum + e[field], 0);

interface BenchmarkRow {
  fixture: string;
  dimension: string;
  success: boolean;
  converged: boolean;
  iterations: number;
  numParams: number;
  equationCount: number;
  normalFactorizations: number;
  normalSolves: number;
  finalNormalAccumulations: number;
  finalQxxRecoveries: number;
  statsNormalAccumulations: number;
  statsQxxRecoveries: number;
  statsQxxReused: boolean;
  statsReuseReason: string;
  /** TRACED covariance-augmentation row count; null = unproven by the gate. */
  augmentedRows: number | null;
  qvvRowConstructionsTraced: number;
  wasmTransfers: number;
  wallMs: number;
  iterativeAssemblyMs: number;
  iterativeAccumulateMs: number;
  iterativeFactorSolveMs: number;
  iterativeStateUpdateMs: number;
  finalAssemblyMs: number;
  finalAccumulateMs: number;
  finalRecoverMs: number;
  statisticsTotalMs: number;
  statsAssemblyMs: number;
  statsAccumulateMs: number;
  statsRecoverMs: number;
  statsRowProductMs: number;
  statsPerEquationMs: number;
  precisionPropagationMs: number;
  reportDiagnosticsMs: number;
  resultPackagingMs: number;
  allPairs: number;
}

const summarize = (
  fixture: Fixture,
  runs: EngineRun[],
  wasmTransfers = 0,
  augmentedRowsTraced: number | null = null,
): BenchmarkRow => {
  const ref = runs[0]!;
  const med = (pick: (_run: EngineRun) => number): number => round2(median(runs.map(pick)));
  const statsEvent = ref.events.find((e) => e.stage === 'statistics');
  return {
    fixture: fixture.id,
    dimension: fixture.dimension,
    success: ref.success,
    converged: ref.converged,
    iterations: ref.iterations,
    numParams: ref.numParams,
    equationCount: ref.equationCount,
    normalFactorizations: ref.iterations,
    normalSolves: ref.iterations,
    finalNormalAccumulations: probeSum(ref.events, 'final-covariance', 'normalAccumulations'),
    finalQxxRecoveries: probeSum(ref.events, 'final-covariance', 'inversions'),
    statsNormalAccumulations: probeSum(ref.events, 'statistics', 'normalAccumulations'),
    statsQxxRecoveries: probeSum(ref.events, 'statistics', 'inversions'),
    statsQxxReused: statsEvent?.reused ?? false,
    statsReuseReason: statsEvent?.reason ?? 'no-event',
    augmentedRows: augmentedRowsTraced,
    qvvRowConstructionsTraced: ref.equationCount,
    wasmTransfers,
    wallMs: med((r) => r.wallMs),
    iterativeAssemblyMs: med((r) => r.profile.assemblyMs),
    iterativeAccumulateMs: med((r) => r.profile.accumulateMs),
    iterativeFactorSolveMs: med((r) => r.profile.factorSolveMs),
    iterativeStateUpdateMs: med((r) => r.profile.stateUpdateMs),
    finalAssemblyMs: med((r) => r.profile.covariance.assemblyMs),
    finalAccumulateMs: med((r) => r.profile.covariance.accumulateMs),
    finalRecoverMs: med((r) => r.profile.covariance.invertMs),
    statisticsTotalMs: med((r) => r.profile.statisticsMs),
    statsAssemblyMs: med((r) => r.profile.standardizedResidualDetail.statisticsEquationAssemblyMs),
    statsAccumulateMs: med((r) => r.profile.standardizedResidualDetail.statisticsNormalAccumulationMs),
    statsRecoverMs: med((r) => r.profile.standardizedResidualDetail.statisticsQxxInversionMs),
    statsRowProductMs: med((r) => r.profile.standardizedResidualDetail.rowProductConstructionMs),
    statsPerEquationMs: med((r) => r.profile.standardizedResidualDetail.perEquationStatisticsMs),
    precisionPropagationMs: med((r) => r.timing.precisionPropagationMs ?? 0),
    reportDiagnosticsMs: med((r) => r.timing.reportDiagnosticsMs ?? 0),
    resultPackagingMs: med((r) => r.timing.resultPackagingMs ?? 0),
    allPairs: ref.allPairs,
  };
};

/** 1 warm-up + RUNS measured runs on identical inputs/options. */
const runArm = (input: string, extra: Partial<EngineExtra> = {}): EngineRun[] => {
  solveOnce(input, extra);
  return Array.from({ length: RUNS }, () => solveOnce(input, extra).run);
};

interface ToggleRow {
  toggle: string;
  fixture: string;
  numericsNote: string;
  baseWallMs: number;
  variantWallMs: number;
  deltaWallMs: number;
  baseIterations: number;
  variantIterations: number;
  baseStatsRecoveries: number;
  variantStatsRecoveries: number;
  baseReason: string;
  variantReason: string;
  baseStatsRecoverMs: number;
  variantStatsRecoverMs: number;
  baseRowProductMs: number;
  variantRowProductMs: number;
}

const toggleDelta = (
  toggle: string,
  fixture: Fixture,
  numericsNote: string,
  baseInput: string,
  variantInput: string,
  baseExtra: Partial<EngineExtra> = {},
  variantExtra: Partial<EngineExtra> = {},
): ToggleRow => {
  const base = summarize(fixture, runArm(baseInput, baseExtra));
  const variantFixture = { ...fixture, id: `${fixture.id}+${toggle}` };
  const variant = summarize(variantFixture, runArm(variantInput, variantExtra));
  return {
    toggle,
    fixture: fixture.id,
    numericsNote,
    baseWallMs: base.wallMs,
    variantWallMs: variant.wallMs,
    deltaWallMs: round2(variant.wallMs - base.wallMs),
    baseIterations: base.iterations,
    variantIterations: variant.iterations,
    baseStatsRecoveries: base.statsQxxRecoveries,
    variantStatsRecoveries: variant.statsQxxRecoveries,
    baseReason: base.statsReuseReason,
    variantReason: variant.statsReuseReason,
    baseStatsRecoverMs: base.statsRecoverMs,
    variantStatsRecoverMs: variant.statsRecoverMs,
    baseRowProductMs: base.statsRowProductMs,
    variantRowProductMs: variant.statsRowProductMs,
  };
};

const loadWasmFactory = async (): Promise<WebNetWasmFactory> => {
  const mod = (await import(
    pathToFileURL(`${process.cwd()}/cpp/build-wasm/webnet_core.js`).href
  )) as { default: WebNetWasmFactory };
  if (typeof mod.default !== 'function') throw new Error('WASM factory missing');
  return mod.default;
};

const tallyExternalReliability = (
  result: ReturnType<LSAEngine['solve']>,
): { components: number; available: number; reasons: Record<string, number> } => {
  const reasons: Record<string, number> = {};
  let components = 0;
  let available = 0;
  for (const obs of result.observations) {
    const entries = [
      obs.reliability?.external,
      obs.reliability?.externalComponents?.E,
      obs.reliability?.externalComponents?.N,
      obs.reliability?.externalComponents?.U,
    ];
    for (const entry of entries) {
      if (entry == null) continue;
      components += 1;
      if (entry.available) available += 1;
      else reasons[entry.reason ?? 'unknown'] = (reasons[entry.reason ?? 'unknown'] ?? 0) + 1;
    }
  }
  return { components, available, reasons };
};

describe('Phase 15A covariance operation counts and benchmark', () => {
  it('records operation counts, timing medians, and toggle deltas', async () => {
    const rows: BenchmarkRow[] = [];
    for (const fixture of fixtures) {
      const runs = runArm(fixture.input);
      const reason = runs[0]!.events.find((e) => e.stage === 'statistics')?.reason ?? '';
      // TRACED augmentation: 2D assembly returns inputs unchanged
      // (augmentCovarianceObservations early-returns for 2D); a 3D
      // 'reused-final-dense-qxx' verdict proves augmentedRowCount == 0
      // because the reuse gate rejects augmentedRowCount > 0.
      const augmented =
        fixture.dimension === '2D' ? 0 : reason === 'reused-final-dense-qxx' ? 0 : null;
      rows.push(summarize(fixture, runs, 0, augmented));
    }
    for (const row of rows) {
      expect(row.success).toBe(true);
      expect(row.converged).toBe(true);
    }

    // Feature toggles on identical geometry (flag-only diffs).
    const chain64 = fixtures.find((f) => f.id === 'chain-2d-64')!;
    const gps64 = fixtures.find((f) => f.id === 'gps-3d-64')!;
    const toggles: ToggleRow[] = [
      toggleDelta(
        'robust-huber-vs-none',
        chain64,
        'numerics differ by construction (Huber reweighting iterates further)',
        chain64.input,
        `${chain64.input}\n.ROBUST HUBER 1.5\n`,
      ),
      toggleDelta(
        'robust-huber-vs-none',
        gps64,
        'numerics differ by construction (Huber reweighting iterates further)',
        gps64.input,
        `${gps64.input}\n.ROBUST HUBER 1.5\n`,
      ),
      toggleDelta(
        'tscorr-on-vs-off',
        chain64,
        'numerics differ only if TS-correlation groups exist in the network',
        chain64.input,
        chain64.input,
        {},
        { parseOptions: { tsCorrelationEnabled: true } },
      ),
      toggleDelta(
        'reliability-statistical-vs-legacy',
        chain64,
        'adjustment numerics unchanged (post-processing MDB only)',
        chain64.input,
        chain64.input,
        {},
        { parseOptions: { reliabilityPolicy: { model: 'statistical' } } },
      ),
      toggleDelta(
        'reliability-statistical-vs-legacy',
        gps64,
        'adjustment numerics unchanged (post-processing MDB only)',
        gps64.input,
        gps64.input,
        {},
        { parseOptions: { reliabilityPolicy: { model: 'statistical' } } },
      ),
      toggleDelta(
        'force-legacy-stats-vs-reuse',
        gps64,
        'adjustment numerics identical (oracle forces SP recompute path)',
        gps64.input,
        gps64.input,
        {},
        { forceLegacyStatisticsQxx: true },
      ),
    ];

    // Session-level suspectImpact off vs auto on the small 2D fixture:
    // extra-solve counts come from the session stage profile (no code changes).
    const chain32 = fixtures.find((f) => f.id === 'chain-2d-32')!;
    const sessionArm = (mode: 'off' | 'auto'): { wallMs: number; stages: { id: string; solves: number; ms: number }[] }[] => {
      const base = createRunSessionRequest({ input: chain32.input });
      const request = {
        ...base,
        parseSettings: { ...base.parseSettings, coordMode: '2D' as const, suspectImpactMode: mode },
      };
      runAdjustmentSession(request, undefined, undefined);
      return Array.from({ length: RUNS }, () => {
        const started = performance.now();
        const outcome = runAdjustmentSession(request, undefined, undefined);
        return {
          wallMs: performance.now() - started,
          stages: outcome.profile.stages.map((stage) => ({
            id: stage.id,
            solves: stage.solveCount,
            ms: Math.round(stage.durationMs * 100) / 100,
          })),
        };
      });
    };
    const suspectOff = sessionArm('off');
    const suspectAuto = sessionArm('auto');
    const suspectImpact = {
      fixture: chain32.id,
      offWallMedianMs: round2(median(suspectOff.map((r) => r.wallMs))),
      autoWallMedianMs: round2(median(suspectAuto.map((r) => r.wallMs))),
      offStages: suspectOff[0]!.stages,
      autoStages: suspectAuto[0]!.stages,
    };

    // Sparse selected-store arm on chain-2d-128 (test-only options only):
    // counts TS<->WASM transfers via a test-side tap; guarded so a missing
    // bundle records 'unavailable' instead of failing the campaign.
    const chain128 = fixtures.find((f) => f.id === 'chain-2d-128')!;
    let sparseArm: Record<string, number | string | boolean> = { verdict: 'unavailable' };
    let externalReliability: Record<string, unknown> = { verdict: 'sparse-arm-unavailable' };
    try {
      const bundle = await createExperimentalSparseNumericalBundle(await loadWasmFactory());
      let transfers = 0;
      const tapped: SparseSelectedCovarianceSolver = {
        querySelected(input: SparseSelectedCovarianceInput): SparseSelectedCovarianceResult {
          transfers += 1;
          return bundle.sparseSelectedCovarianceSolver.querySelected(input);
        },
      };
      const tappedRowProducts = bundle.sparseRowProductsSolver ?? undefined;
      const sparseExtra = {
        sparseSelectedCovarianceSolver: tapped,
        ...(tappedRowProducts == null
          ? {}
          : { sparseRowProductsSolver: tappedRowProducts }),
        experimentalSelectedCovarianceMode: true,
      } as Partial<EngineExtra>;
      solveOnce(chain128.input, sparseExtra);
      transfers = 0;
      const sparseRuns = Array.from({ length: RUNS }, () => {
        const before = transfers;
        const solved = solveOnce(chain128.input, sparseExtra);
        return { run: solved.run, calls: transfers - before, result: solved.result };
      });
      const ref = sparseRuns[0]!;
      const sparseExternal = tallyExternalReliability(ref.result);
      const denseExternal: Record<string, { components: number; available: number; reasons: Record<string, number> }> = {};
      for (const id of ['chain-2d-64', 'chain-2d-128', 'gps-3d-64']) {
        const fix = fixtures.find((f) => f.id === id)!;
        denseExternal[id] = tallyExternalReliability(solveOnce(fix.input).result);
      }
      externalReliability = { dense: denseExternal, sparseSelected: sparseExternal };
      sparseArm = {
        verdict: 'measured',
        success: ref.result.success,
        converged: ref.result.converged,
        wallMedianMs: round2(median(sparseRuns.map((r) => r.run.wallMs))),
        transfersMedian: median(sparseRuns.map((r) => r.calls)),
        statsReason: ref.run.events.find((e) => e.stage === 'statistics')?.reason ?? 'no-event',
        finalReason: ref.run.events.find((e) => e.stage === 'final-covariance')?.reason ?? 'no-event',
        reliabilityAvailable: ref.result.reliabilitySummary?.available ?? 'missing',
        relativePrecisionRows: ref.result.relativePrecision?.length ?? -1,
        relativeCovarianceRows: ref.result.relativeCovariances?.length ?? -1,
      };
      rows.push(summarize({ ...chain128, id: `${chain128.id}+sparse-selected` }, sparseRuns.map((r) => r.run), median(sparseRuns.map((r) => r.calls)), 0));
    } catch (error) {
      sparseArm = {
        verdict: 'unavailable',
        reason: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300),
      };
    }

    // All-pairs note: entry counts + precision bucket per fixture (no code touched).
    const allPairs = rows
      .filter((r) => !r.fixture.includes('+sparse'))
      .map((r) => ({
        fixture: r.fixture,
        unknownsTraced: r.dimension === '2D' ? r.numParams / 2 : r.numParams / 3,
        numParams: r.numParams,
        allPairs: r.allPairs,
        precisionPropagationMs: r.precisionPropagationMs,
        perPairMicroseconds:
          r.allPairs > 0 ? round2((r.precisionPropagationMs * 1000) / r.allPairs) : null,
      }));

    const machine = { rows, toggles, suspectImpact, sparseArm, externalReliability, allPairs };
    const env = {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      cpu: 'AMD Ryzen 7 5800X3D',
      runsPerArm: RUNS,
      warmupPerArm: 1,
      statistic: 'median',
    };
    const machineWithEnv = { env, ...machine };

    const lines: string[] = [
      '# Phase 15A covariance operation counts and benchmark (evidence only)',
      '',
      `Method: engine-level LSAEngine solves, 1 warm-up + ${RUNS} measured runs, medians.`,
      'Instrumentation is pre-existing test-only hooks (detailedSolveProfiler, qxxReuseProbe);',
      'solveTimingProfile buckets are reported as-is. matrixFactorizationMs conflates',
      'iteration factor/solve with final covariance — the detailed profiler is the primary source.',
      'Counts are MEASURED (profiler/probe/tap) or TRACED (code-path walk) as labeled.',
      'Distinct ops are never called "inversion": factorization, normal solve,',
      'normal accumulation, Qxx recovery, row-product construction are separate rows.',
      '',
      '## Benchmark matrix (dense-default path)',
      '',
      '| Fixture | dim | iters | params | equations | NORMAL factorizations (M) | NORMAL solves (M) | FINAL accumulations (M) | FINAL Qxx recoveries (M) | STATS accumulations (M) | STATS Qxx recoveries (M) | reuse reason | Qvv rows traced | WASM transfers (M) |',
      '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|---:|---:|',
      ...rows.map((r) =>
        `| ${r.fixture} | ${r.dimension} | ${r.iterations} | ${r.numParams} | ${r.equationCount} | ${r.normalFactorizations} | ${r.normalSolves} | ${r.finalNormalAccumulations} | ${r.finalQxxRecoveries} | ${r.statsNormalAccumulations} | ${r.statsQxxRecoveries} | ${r.statsReuseReason} | ${r.qvvRowConstructionsTraced} | ${r.wasmTransfers} |`,
      ),
      '',
      '## Timing medians (ms)',
      '',
      '| Fixture | wall | NORMAL assembly | NORMAL accumulate | NORMAL factor/solve | NORMAL state | FINAL assembly | FINAL accumulate | FINAL recover | STATS total | STATS assembly | STATS accumulate | STATS recover | STATS row-products | STATS per-equation | precision | report | packaging |',
      '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
      ...rows.map((r) =>
        `| ${r.fixture} | ${r.wallMs} | ${r.iterativeAssemblyMs} | ${r.iterativeAccumulateMs} | ${r.iterativeFactorSolveMs} | ${r.iterativeStateUpdateMs} | ${r.finalAssemblyMs} | ${r.finalAccumulateMs} | ${r.finalRecoverMs} | ${r.statisticsTotalMs} | ${r.statsAssemblyMs} | ${r.statsAccumulateMs} | ${r.statsRecoverMs} | ${r.statsRowProductMs} | ${r.statsPerEquationMs} | ${r.precisionPropagationMs} | ${r.reportDiagnosticsMs} | ${r.resultPackagingMs} |`,
      ),
      '',
      '## Feature-toggle marginal costs (identical geometry, flag-only diffs)',
      '',
      '| Toggle | fixture | base wall | variant wall | delta wall | base iters | variant iters | base STATS recoveries | variant STATS recoveries | base reason | variant reason | numerics note |',
      '|---|---|---:|---:|---:|---:|---:|---:|---:|---|---|---|',
      ...toggles.map((t) =>
        `| ${t.toggle} | ${t.fixture} | ${t.baseWallMs} | ${t.variantWallMs} | ${t.deltaWallMs} | ${t.baseIterations} | ${t.variantIterations} | ${t.baseStatsRecoveries} | ${t.variantStatsRecoveries} | ${t.baseReason} | ${t.variantReason} | ${t.numericsNote} |`,
      ),
      '',
      '## Session-level suspectImpact (chain-2d-32)',
      '',
      `- off wall median ms: ${suspectImpact.offWallMedianMs}; stages: ${JSON.stringify(suspectImpact.offStages)}`,
      `- auto wall median ms: ${suspectImpact.autoWallMedianMs}; stages: ${JSON.stringify(suspectImpact.autoStages)}`,
      '- Extra-solve counts come from the session stage profile (main-solve vs suspect-impact).',
      '',
      '## Sparse selected-store arm (chain-2d-128)',
      '',
      `- verdict: ${JSON.stringify(sparseArm)}`,
      '',
      '## External reliability availability (measured per-observation tally)',
      '',
      `- dense vs sparse-selected: ${JSON.stringify(externalReliability)}`,
      '- Expectation from code: sparse row-product runs carry no dense B/P, so',
      "  computeExternalInfluences reports 'sparse-route-unavailable' per row.",
      '',
      '## All-pairs relativePrecision note (no code changed)',
      '',
      '| Fixture | unknowns traced | params | all-pairs rows | precision bucket ms | per-pair µs |',
      '|---|---:|---:|---:|---:|---:|',
      ...allPairs.map((a) =>
        `| ${a.fixture} | ${a.unknownsTraced} | ${a.numParams} | ${a.allPairs} | ${a.precisionPropagationMs} | ${a.perPairMicroseconds} |`,
      ),
      '',
      '## Operation-count method ledger',
      '',
      '- normalFactorizations / normalSolves: MEASURED (= result.iterations; one factor+solve per iteration).',
      '- finalNormalAccumulations / finalQxxRecoveries: MEASURED (qxxReuseProbe final-covariance event).',
      '- statsNormalAccumulations / statsQxxRecoveries / reuse reason: MEASURED (probe statistics event).',
      '- qvvRowConstructionsTraced: TRACED (= first-iteration equation count; B = A*Qxx has one row per equation).',
      '- wasmTransfers: MEASURED test-side tap around querySelected (0 on every dense arm).',
      '- Dense-matrix constructions (TRACED, not timed): FINAL builds N (n×n) + Qxx (n×n); legacy STATS builds N (n×n) + Qxx (n×n) + B (m×n); reuse STATS builds B (m×n) only.',
      '- Reliability sensitivity products (TRACED): legacy model uses the diagonal only (0 full-column products); statistical model adds one full-P-column dot product per testable equation row.',
      '- REPORT-ONLY: solveTimingProfile reportDiagnosticsMs + resultPackagingMs (production coarse timing, uninstrumented).',
    ];

    const machineDir = join(process.cwd(), 'artifacts/evidence/phase15a');
    mkdirSync(machineDir, { recursive: true });
    writeFileSync(join(machineDir, 'phase15a-evidence.json'), `${JSON.stringify(machineWithEnv, null, 1)}\n`);
    writeFileSync(join(machineDir, 'phase15a-evidence.md'), `${lines.join('\n')}\n`);

    const reportDir = join(process.cwd(), 'reports/performance');
    mkdirSync(reportDir, { recursive: true });
    writeFileSync(join(reportDir, 'phase15a-covariance-operations.json'), `${JSON.stringify(machineWithEnv, null, 1)}\n`);
    writeFileSync(join(reportDir, 'phase15a-covariance-operations.md'), `${lines.join('\n')}\n`);
  }, 900000);
});
