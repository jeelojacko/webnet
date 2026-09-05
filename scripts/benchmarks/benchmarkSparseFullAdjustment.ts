/**
 * Phase 5 realistic deterministic full-adjustment benchmark.
 *
 * Compares four routes over generated survey-like 2D networks (plus a modest
 * GPS-augmented family): TS reference, sparse correction-only, the full
 * sparse bundle, and the full bundle in selected-network covariance mode
 * (plan-only Qxx queries; legacy all-pairs relativePrecision omitted). All sparse
 * solvers come from one shared experimental bundle; production defaults are
 * untouched. Sparse routes degrade to safe skips when WASM is unavailable or
 * the case exceeds the dense/all-pairs guard.
 *
 * Usage: `npm run bench:adjust:sparse-full [-- --quick] [-- --write-baseline]`
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

import { LSAEngine } from '../../src/engine/adjust';
import type { AdjustmentResult } from '../../src/typesAdjustmentResult';
import {
  buildExperimentalSparseEngineOptions,
  createExperimentalSparseNumericalBundle,
} from '../../src/engine/wasm/experimentalSparseNumericalBundle';
import {
  createExperimentalSparseRouteDiagnostics,
  type ExperimentalSparseRouteDiagnostics,
} from '../../src/engine/experimentalSparseDiagnostics';
import { buildPhase5BenchmarkCases } from '../../src/engine/phase5BenchmarkNetworks';
import type { WebNetWasmFactory } from '../../src/engine/wasm/wasmTypes';

type RouteId = 'ts-reference' | 'sparse-correction-only' | 'sparse-full-bundle' | 'sparse-full-selected-network';

interface RouteMeasurement {
  route: RouteId;
  status: 'measured' | 'skipped';
  skipReason?: string;
  medianMs?: number;
  minMs?: number;
  p95Ms?: number;
  iterations?: number;
  success?: boolean;
  maxCoordDiffM?: number;
  diagnostics?: ExperimentalSparseRouteDiagnostics;
  /** Selected-network route only: plan queries issued (<< n^2 expected). */
  selectedQueryCount?: number;
  /** Selected-network route only: parameter count n. */
  selectedParamCount?: number;
  /** Legacy all-pairs relativePrecision rows (expected 0 in selected mode). */
  relativePrecisionRows?: number;
}

interface CaseMeasurement {
  id: string;
  family: string;
  stations: number;
  unknowns: number;
  observations: number;
  dof: number;
  routes: RouteMeasurement[];
}

const quick = process.argv.includes('--quick');
const writeBaseline = process.argv.includes('--write-baseline');
const warmups = Number(process.env.BENCH_WARMUPS ?? (quick ? 1 : 2));
const runs = Number(process.env.BENCH_RUNS ?? (quick ? 3 : 5));
const maxParams = Number(process.env.SPARSE_FULL_MAX_PARAMS ?? 2000);
const coordToleranceM = 1e-6;

const percentile = (values: number[], p: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)] ?? 0;
};

/**
 * Reads the selected-network covariance store off the engine (set on the
 * solve context, not the result). Returns undefined counts when the store is
 * unavailable (e.g. dense fallback); callers then report n/a.
 */
const readSelectedNetworkStats = (
  engine: LSAEngine | null,
  candidate: AdjustmentResult,
): Partial<RouteMeasurement> => {
  const store = (engine as unknown as Record<string, unknown> | null)?.[
    'experimentalSelectedCovarianceStore'
  ] as { queryCount?: unknown; parameterCount?: unknown } | undefined;
  const queryCount = typeof store?.queryCount === 'number' ? store.queryCount : undefined;
  const paramCount = typeof store?.parameterCount === 'number' ? store.parameterCount : undefined;
  return {
    selectedQueryCount: queryCount,
    selectedParamCount: paramCount,
    relativePrecisionRows: (candidate.relativePrecision ?? []).length,
  };
};

const maxCoordDiff = (reference: AdjustmentResult, candidate: AdjustmentResult): number => {
  let max = 0;
  for (const [id, refStation] of Object.entries(reference.stations)) {
    const other = candidate.stations[id];
    if (!other) return Number.POSITIVE_INFINITY;
    max = Math.max(max, Math.abs(refStation.x - other.x), Math.abs(refStation.y - other.y));
  }
  return max;
};

const summarizeDiagnostics = (diagnostics: ExperimentalSparseRouteDiagnostics): string => {
  const parts = [
    `corr ${diagnostics.sparseCorrectionCalls}/${diagnostics.sparseCorrectionFallbacks}`,
    `rowp ${diagnostics.rowProductsCalls}/${diagnostics.rowProductsFallbacks}`,
    `selcov ${diagnostics.selectedCovarianceCalls}/${diagnostics.selectedCovarianceFallbacks}`,
  ];
  return parts.join(' ');
};

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

const measurements: CaseMeasurement[] = cases.map((benchmarkCase) => {
  const reference = new LSAEngine({ input: benchmarkCase.input }).solve();
  const unknowns = Object.values(reference.stations).filter((station) => !station.fixed).length;
  const paramEstimate = unknowns * 2;
  const skipSparseReason =
    wasmSkipReason != null
      ? `WASM unavailable: ${wasmSkipReason.slice(0, 160)}`
      : paramEstimate > maxParams
        ? `dense/all-pairs guard: ~${paramEstimate} params exceed SPARSE_FULL_MAX_PARAMS=${maxParams}`
        : null;

  const measureRoute = (
    route: RouteId,
    buildOptions: (_diagnostics: ExperimentalSparseRouteDiagnostics) => Record<string, unknown>,
  ): RouteMeasurement => {
    if (route !== 'ts-reference' && skipSparseReason != null) {
      return { route, status: 'skipped', skipReason: skipSparseReason };
    }
    const diagnostics = createExperimentalSparseRouteDiagnostics();
    let lastEngine: LSAEngine | null = null;
    const solve = (): AdjustmentResult => {
      lastEngine = new LSAEngine({ input: benchmarkCase.input, ...buildOptions(diagnostics) });
      return lastEngine.solve() as AdjustmentResult;
    };
    let candidate = solve();
    for (let i = 0; i < warmups; i += 1) candidate = solve();
    const times: number[] = [];
    for (let i = 0; i < runs; i += 1) {
      const start = performance.now();
      candidate = solve();
      times.push(performance.now() - start);
    }
    return {
      route,
      status: 'measured',
      medianMs: percentile(times, 0.5),
      minMs: Math.min(...times),
      p95Ms: percentile(times, 0.95),
      iterations: candidate.iterations,
      success: candidate.success,
      maxCoordDiffM: route === 'ts-reference' ? 0 : maxCoordDiff(reference, candidate),
      diagnostics,
      ...(route === 'sparse-full-selected-network'
        ? readSelectedNetworkStats(lastEngine, candidate)
        : {}),
    };
  };

  return {
    id: benchmarkCase.id,
    family: benchmarkCase.family,
    stations: Object.keys(reference.stations).length,
    unknowns,
    observations: reference.observations.length,
    dof: reference.dof,
    routes: [
      measureRoute('ts-reference', () => ({})),
      measureRoute('sparse-correction-only', (diagnostics) => ({
        sparseCorrectionSolver: bundle?.sparseCorrectionSolver,
        experimentalSparseDiagnostics: diagnostics,
      })),
      measureRoute('sparse-full-bundle', (diagnostics) =>
        bundle ? { ...buildExperimentalSparseEngineOptions(bundle, diagnostics) } : {},
      ),
      measureRoute('sparse-full-selected-network', (diagnostics) =>
        bundle ? { ...buildExperimentalSparseEngineOptions(bundle, diagnostics, true) } : {},
      ),
    ],
  };
});

const divergent = measurements.flatMap((m) =>
  m.routes
    .filter((r) => r.status === 'measured' && (r.maxCoordDiffM ?? 0) > coordToleranceM)
    .map((r) => `${m.id}/${r.route} diff=${r.maxCoordDiffM?.toExponential(2)}`),
);
if (divergent.length > 0) {
  throw new Error(`Sparse full-adjustment divergence beyond ${coordToleranceM} m: ${divergent.join('; ')}`);
}

// Selected-network route: plan queries must be a strict fraction of n^2
// (legacy all-pairs relativePrecision is omitted by design, so validity is
// success + coordinate agreement, already asserted above). Where the store
// is unavailable (dense fallback) the route reports n/a and is skipped here.
const selectedViolations = measurements.flatMap((m) =>
  m.routes.flatMap((r) => {
    if (r.route !== 'sparse-full-selected-network' || r.status !== 'measured') return [];
    if (r.success !== true) return [`${m.id}: selected-network solve did not succeed`];
    const { selectedQueryCount: queries, selectedParamCount: params } = r;
    if (queries == null || params == null) return [];
    const dense = params * params;
    return queries < dense && queries * 2 < dense
      ? []
      : [`${m.id}: selected queries ${queries} not << n^2=${dense}`];
  }),
);
if (selectedViolations.length > 0) {
  throw new Error(`Selected-network query budget violated: ${selectedViolations.join('; ')}`);
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
  coordToleranceM,
};
const output = { metadata, cases: measurements };
mkdirSync('benchmarks/baselines', { recursive: true });
writeFileSync('benchmarks/baselines/sparse-full-latest.json', `${JSON.stringify(output, null, 2)}\n`);

const header = `| Case | Stations | Unknowns | Obs | DOF | Route | Median ms | p95 ms | Iter | Max coord diff m | Sel queries/n² | Sparse calls/fallbacks |`;
const divider = `| --- | ---: | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | --- |`;
const selectedCell = (r: RouteMeasurement): string => {
  if (r.route !== 'sparse-full-selected-network') return '-';
  if (r.status !== 'measured') return 'skipped';
  if (r.selectedQueryCount == null || r.selectedParamCount == null) return 'n/a (dense fallback)';
  const dense = r.selectedParamCount * r.selectedParamCount;
  return `${r.selectedQueryCount}/${dense} (${(r.selectedQueryCount / dense).toFixed(2)})`;
};
const rows = measurements.flatMap((m) =>
  m.routes.map((r) =>
    r.status === 'skipped'
      ? `| ${m.id} | ${m.stations} | ${m.unknowns} | ${m.observations} | ${m.dof} | ${r.route} | skipped | skipped | - | - | - | ${r.skipReason ?? ''} |`
      : `| ${m.id} | ${m.stations} | ${m.unknowns} | ${m.observations} | ${m.dof} | ${r.route} | ${r.medianMs?.toFixed(2)} | ${r.p95Ms?.toFixed(2)} | ${r.iterations} | ${(r.maxCoordDiffM ?? 0).toExponential(2)} | ${selectedCell(r)} | ${summarizeDiagnostics(r.diagnostics ?? createExperimentalSparseRouteDiagnostics())} |`,
  ),
);
const fallbackDetails = measurements.flatMap((m) =>
  m.routes.flatMap((r) => {
    const reasons = [
      ...(r.diagnostics?.sparseCorrectionFallbackReasons ?? []).map((reason) => `correction: ${reason}`),
      ...(r.diagnostics?.rowProductsFallbackReasons ?? []).map((reason) => `row-products: ${reason}`),
      ...(r.diagnostics?.selectedCovarianceFallbackReasons ?? []).map((reason) => `selected-covariance: ${reason}`),
    ];
    return reasons.length > 0 ? [`${m.id}/${r.route} fallbacks:`, ...reasons.map((reason) => `- ${reason}`)] : [];
  }),
);
const markdown = [
  `# Phase 5 sparse full-adjustment benchmark`,
  ``,
  `Generated: ${metadata.generatedAt} · Node ${metadata.node} · ${metadata.platform} · ${metadata.cpu}`,
  `Commit: ${metadata.gitCommit} · warmups: ${warmups} · measured runs: ${runs} · quick: ${quick}`,
  `Coord agreement tolerance: ${coordToleranceM} m (max |dx|,|dy| vs TS reference).`,
  `Selected-network mode omits legacy all-pairs relativePrecision by design (0 rows expected);`,
  `its validity is success + coordinate agreement, and plan queries must be < n²/2.`,
  ``,
  header,
  divider,
  ...rows,
  ``,
  ...(fallbackDetails.length > 0 ? [`## Fallback reasons`, ``, ...fallbackDetails, ``] : [`No sparse fallbacks recorded.`, ``]),
].join('\n');
writeFileSync('benchmarks/baselines/sparse-full-latest.md', markdown);
if (writeBaseline) {
  writeFileSync('benchmarks/baselines/sparse-full-baseline.json', `${JSON.stringify(output, null, 2)}\n`);
  writeFileSync('benchmarks/baselines/sparse-full-baseline.md', markdown);
}
console.log(markdown);
console.log(`Wrote benchmarks/baselines/sparse-full-latest.json${writeBaseline ? ' and baseline files' : ''}.`);
