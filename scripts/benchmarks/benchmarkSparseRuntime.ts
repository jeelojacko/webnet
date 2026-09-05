/**
 * Phase 6 sparse runtime benchmark (developer tooling only).
 *
 * Measures wall-clock medians plus per-stage solveTimingProfile medians for
 * the authoritative TS route versus the experimental full sparse
 * selected-network route over the Phase 5 deterministic generated cases.
 * Production defaults and routing are untouched; sparse runs degrade to
 * safe skips when WASM is unavailable or the case exceeds the guard.
 *
 * Usage: `npm run bench:sparse-runtime [-- --quick] [-- --write-baseline]`
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

import { LSAEngine } from '../../src/engine/adjust';
import type { AdjustmentResult } from '../../src/typesAdjustmentResult';
import type { AdjustmentSolveTimingProfile } from '../../src/typesSolveTiming';
import {
  buildExperimentalSparseEngineOptions,
  createExperimentalSparseNumericalBundle,
} from '../../src/engine/wasm/experimentalSparseNumericalBundle';
import { createExperimentalSparseRouteDiagnostics } from '../../src/engine/experimentalSparseDiagnostics';
import {
  buildPhase5BenchmarkCases,
  PHASE5_BENCHMARK_DEFAULT_MAX_UNKNOWN_COUNT,
  phase5BenchmarkSizeSkipReason,
} from '../../src/engine/phase5BenchmarkNetworks';
import { compareSparseShadowResults } from '../../src/engine/phase6SparseShadowCompare';
import type { WebNetWasmFactory } from '../../src/engine/wasm/wasmTypes';

type StageKey =
  | 'parseAndSetupMs'
  | 'equationAssemblyMs'
  | 'matrixFactorizationMs'
  | 'precisionAndDiagnosticsMs'
  | 'precisionPropagationMs'
  | 'resultPackagingMs'
  | 'otherMs'
  | 'totalMs';

const STAGES: StageKey[] = [
  'parseAndSetupMs',
  'equationAssemblyMs',
  'matrixFactorizationMs',
  'precisionAndDiagnosticsMs',
  'precisionPropagationMs',
  'resultPackagingMs',
  'otherMs',
  'totalMs',
];

interface StageStats {
  medianMs: number;
  minMs: number;
  p95Ms: number;
}

interface RouteProfile {
  route: 'ts-reference' | 'sparse-selected-network';
  status: 'measured' | 'skipped';
  skipReason?: string;
  wall?: StageStats;
  stages?: Record<StageKey, StageStats>;
  iterations?: number;
  success?: boolean;
  maxCoordDiffM?: number;
  maxStdResDiff?: number;
  selectedQueryCount?: number;
  selectedParamCount?: number;
  relativePrecisionRows?: number;
  sparseFallbacks?: number;
  fallbackReasons?: string[];
}

interface CaseProfile {
  id: string;
  family: string;
  stations: number;
  unknowns: number;
  observations: number;
  dof: number;
  routes: RouteProfile[];
}

const quick = process.argv.includes('--quick');
const writeBaseline = process.argv.includes('--write-baseline');
const warmups = Number(process.env.BENCH_WARMUPS ?? (quick ? 1 : 2));
const runs = Number(process.env.BENCH_RUNS ?? (quick ? 3 : 5));
const maxParams = Number(process.env.SPARSE_FULL_MAX_PARAMS ?? 2000);
const maxUnknowns = Number(
  process.env.BENCH_MAX_UNKNOWN_COUNT ?? PHASE5_BENCHMARK_DEFAULT_MAX_UNKNOWN_COUNT,
);
const coordToleranceM = 1e-6;

const percentile = (values: number[], p: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)] ?? 0;
};

const summarize = (values: number[]): StageStats => ({
  medianMs: percentile(values, 0.5),
  minMs: Math.min(...values),
  p95Ms: percentile(values, 0.95),
});

const stageValue = (profile: AdjustmentSolveTimingProfile | undefined, stage: StageKey): number =>
  profile?.[stage] ?? 0;

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

const cases = buildPhase5BenchmarkCases(quick);

let bundle: Awaited<ReturnType<typeof createExperimentalSparseNumericalBundle>> | null = null;
let wasmSkipReason: string | null = null;
try {
  const imported = (await import(
    pathToFileURL(`${process.cwd()}/cpp/build-wasm/webnet_core.js`).href
  )) as { default: WebNetWasmFactory };
  bundle = await createExperimentalSparseNumericalBundle(imported.default);
} catch (error) {
  wasmSkipReason = error instanceof Error ? error.message : String(error);
}

const measurements: CaseProfile[] = cases.map((benchmarkCase) => {
  const sizeSkipReason = phase5BenchmarkSizeSkipReason(benchmarkCase, maxUnknowns);
  if (sizeSkipReason != null) {
    return {
      id: benchmarkCase.id,
      family: benchmarkCase.family,
      stations: benchmarkCase.stationCount,
      unknowns: benchmarkCase.unknownCount,
      observations: 0,
      dof: 0,
      routes: [
        { route: 'ts-reference', status: 'skipped', skipReason: sizeSkipReason },
        { route: 'sparse-selected-network', status: 'skipped', skipReason: sizeSkipReason },
      ],
    };
  }
  const reference = new LSAEngine({ input: benchmarkCase.input }).solve();
  const unknowns = Object.values(reference.stations).filter((station) => !station.fixed).length;
  const paramEstimate = unknowns * 2;
  const skipSparseReason =
    wasmSkipReason != null
      ? `WASM unavailable: ${wasmSkipReason.slice(0, 160)}`
      : paramEstimate > maxParams
        ? `guard: ~${paramEstimate} params exceed SPARSE_FULL_MAX_PARAMS=${maxParams}`
        : null;

  const measure = (
    route: RouteProfile['route'],
    sparse: boolean,
  ): RouteProfile => {
    if (sparse && skipSparseReason != null) {
      return { route, status: 'skipped', skipReason: skipSparseReason };
    }
    const diagnostics = createExperimentalSparseRouteDiagnostics();
    const solve = (): AdjustmentResult => {
      const options =
        sparse && bundle
          ? { input: benchmarkCase.input, ...buildExperimentalSparseEngineOptions(bundle, diagnostics, true) }
          : { input: benchmarkCase.input };
      return new LSAEngine(options).solve() as AdjustmentResult;
    };
    let candidate = solve();
    for (let i = 0; i < warmups; i += 1) candidate = solve();
    const walls: number[] = [];
    const stageSamples = new Map<StageKey, number[]>();
    for (const stage of STAGES) stageSamples.set(stage, []);
    for (let i = 0; i < runs; i += 1) {
      const start = performance.now();
      candidate = solve();
      walls.push(performance.now() - start);
      for (const stage of STAGES) {
        stageSamples.get(stage)?.push(stageValue(candidate.solveTimingProfile, stage));
      }
    }
    const stages = Object.fromEntries(
      STAGES.map((stage) => [stage, summarize(stageSamples.get(stage) ?? [0])]),
    ) as Record<StageKey, StageStats>;
    const comparison =
      route === 'ts-reference'
        ? undefined
        : compareSparseShadowResults(reference, candidate, coordToleranceM);
    const fallbacks =
      diagnostics.sparseCorrectionFallbacks +
      diagnostics.rowProductsFallbacks +
      diagnostics.selectedCovarianceFallbacks;
    const reasons = [
      ...diagnostics.sparseCorrectionFallbackReasons,
      ...diagnostics.rowProductsFallbackReasons,
      ...diagnostics.selectedCovarianceFallbackReasons,
    ];
    return {
      route,
      status: 'measured',
      wall: summarize(walls),
      stages,
      iterations: candidate.iterations,
      success: candidate.success,
      maxCoordDiffM: route === 'ts-reference' ? 0 : comparison?.maxCoordDiffM,
      maxStdResDiff: route === 'ts-reference' ? 0 : comparison?.maxStdResDiff,
      relativePrecisionRows: (candidate.relativePrecision ?? []).length,
      sparseFallbacks: sparse ? fallbacks : 0,
      fallbackReasons: sparse ? reasons : [],
    };
  };

  return {
    id: benchmarkCase.id,
    family: benchmarkCase.family,
    stations: Object.keys(reference.stations).length,
    unknowns,
    observations: reference.observations.length,
    dof: reference.dof,
    routes: [measure('ts-reference', false), measure('sparse-selected-network', true)],
  };
});

const divergent = measurements.flatMap((m) =>
  m.routes
    .filter((r) => r.status === 'measured' && (r.maxCoordDiffM ?? 0) > coordToleranceM)
    .map((r) => `${m.id}/${r.route} diff=${r.maxCoordDiffM?.toExponential(2)}`),
);
if (divergent.length > 0) {
  throw new Error(`Sparse runtime divergence beyond ${coordToleranceM} m: ${divergent.join('; ')}`);
}

const metadata = {
  generatedAt: new Date().toISOString(),
  node: process.version,
  platform: `${process.platform}-${process.arch}`,
  cpu,
  gitCommit,
  warmups,
  runs,
  quick,
  maxParams,
  maxUnknowns,
  coordToleranceM,
  note: 'Stage medians come from AdjustmentResult.solveTimingProfile; wall is outer LSAEngine.solve() time.',
};
const output = { metadata, cases: measurements };
mkdirSync('benchmarks/baselines', { recursive: true });
writeFileSync('benchmarks/baselines/sparse-runtime-latest.json', `${JSON.stringify(output, null, 2)}\n`);

const fmt = (value: number | undefined): string => (value == null ? '-' : value.toFixed(2));
const header =
  `| Case | Route | Wall med/p95 ms | Setup | Assembly | Factor | Prec+diag | PrecProp | Packaging | Other | Total | Iter | Coord diff | Fallbacks |`;
const divider = `| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |`;
const rows = measurements.flatMap((m) =>
  m.routes.map((r) => {
    if (r.status === 'skipped') {
      return `| ${m.id} | ${r.route} | skipped | - | - | - | - | - | - | - | - | - | - | ${r.skipReason ?? ''} |`;
    }
    const s = r.stages as Record<StageKey, StageStats>;
    return (
      `| ${m.id} | ${r.route} | ${fmt(r.wall?.medianMs)}/${fmt(r.wall?.p95Ms)} ` +
      `| ${fmt(s.parseAndSetupMs.medianMs)} | ${fmt(s.equationAssemblyMs.medianMs)} ` +
      `| ${fmt(s.matrixFactorizationMs.medianMs)} | ${fmt(s.precisionAndDiagnosticsMs.medianMs)} ` +
      `| ${fmt(s.precisionPropagationMs.medianMs)} | ${fmt(s.resultPackagingMs.medianMs)} ` +
      `| ${fmt(s.otherMs.medianMs)} | ${fmt(s.totalMs.medianMs)} | ${r.iterations} ` +
      `| ${(r.maxCoordDiffM ?? 0).toExponential(2)} | ${r.sparseFallbacks ?? 0} |`
    );
  }),
);
const markdown = [
  `# Phase 6 sparse runtime benchmark (stage breakdown)`,
  ``,
  `Generated: ${metadata.generatedAt} · Node ${metadata.node} · ${metadata.platform} · ${metadata.cpu}`,
  `Commit: ${metadata.gitCommit} · warmups: ${warmups} · measured runs: ${runs} · quick: ${quick}`,
  `Coord agreement tolerance: ${coordToleranceM} m vs TS reference. Selected-network mode omits legacy all-pairs relativePrecision by design.`,
  `Stage medians are from solveTimingProfile (ms); wall is outer solve() time (ms). No symbolic reuse or persistent workspace yet; measure first.`,
  ``,
  header,
  divider,
  ...rows,
  ``,
].join('\n');
writeFileSync('benchmarks/baselines/sparse-runtime-latest.md', markdown);
if (writeBaseline) {
  writeFileSync('benchmarks/baselines/sparse-runtime-baseline.json', `${JSON.stringify(output, null, 2)}\n`);
  writeFileSync('benchmarks/baselines/sparse-runtime-baseline.md', markdown);
}
console.log(markdown);
console.log(`Wrote benchmarks/baselines/sparse-runtime-latest.json${writeBaseline ? ' and baseline files' : ''}.`);
