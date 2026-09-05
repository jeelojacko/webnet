/**
 * Phase 6 sparse-only large benchmark (test-only).
 *
 * Runs actual LSAEngine.solve with only the injected full sparse
 * selected-network bundle: no dense TS reference, no dense Qxx/all-pairs.
 * Cases are deterministic generated survey networks (chain 256/512/1000,
 * GPS 128/256, plus modest GPS-covariance and robust/TS-correlation
 * variants). Validity is generated-truth agreement, solve invariants, and
 * repeat determinism. Stops safely on the size guard, the wall-clock budget,
 * or the RSS cap before OOM.
 *
 * Usage: `npm run bench:adjust:sparse-large [-- --quick] [-- --write-baseline]`
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
import {
  buildPhase6LargeBenchmarkCases,
  estimatePhase6SparseStorage,
  phase6LargeSizeSkipReason,
  phase6TruthDiffs,
  PHASE6_SPARSE_LARGE_DEFAULT_MAX_RSS_MB,
  PHASE6_SPARSE_LARGE_DEFAULT_MAX_TOTAL_MS,
  PHASE6_SPARSE_LARGE_DEFAULT_MAX_UNKNOWN_COUNT,
  type Phase6SparseStorageEstimate,
} from '../../src/engine/phase6BenchmarkNetworks';
import type {
  SparseCorrectionSolveInput,
  SparseCorrectionSolveResult,
  SparseCorrectionSolver,
} from '../../src/engine/numericalBackend';
import type { WebNetWasmFactory } from '../../src/engine/wasm/wasmTypes';

interface CaseMeasurement {
  id: string;
  family: string;
  variant: string;
  stations: number;
  unknowns: number;
  observations: number;
  dof: number;
  success?: boolean;
  converged?: boolean;
  status: 'measured' | 'skipped';
  skipReason?: string;
  medianMs?: number;
  iterations?: number;
  equationRows?: number;
  paramCount?: number;
  factorOrdering?: string;
  factorSolver?: string;
  designNnz?: number;
  weightNnz?: number;
  normalNnz?: number;
  factorNnz?: number;
  storage?: Phase6SparseStorageEstimate;
  selectedQueryCount?: number;
  selectedParamCount?: number;
  relativePrecisionRows?: number;
  truthHorizontalMaxM?: number;
  truthHeightMaxM?: number;
  repeatMaxDiffM?: number;
  rssBeforeMb?: number;
  rssAfterMb?: number;
  heapAfterMb?: number;
  damping?: number;
  dampingAttempts?: number;
  diagnostics?: ExperimentalSparseRouteDiagnostics;
}

const quick = process.argv.includes('--quick');
const writeBaseline = process.argv.includes('--write-baseline');
const warmups = Number(process.env.BENCH_WARMUPS ?? (quick ? 0 : 1));
const runs = Number(process.env.BENCH_RUNS ?? (quick ? 2 : 3));
const maxUnknowns = Number(
  process.env.SPARSE_LARGE_MAX_UNKNOWN_COUNT ?? PHASE6_SPARSE_LARGE_DEFAULT_MAX_UNKNOWN_COUNT,
);
const maxTotalMs = Number(
  process.env.SPARSE_LARGE_MAX_TOTAL_MS ?? PHASE6_SPARSE_LARGE_DEFAULT_MAX_TOTAL_MS,
);
const maxRssMb = Number(
  process.env.SPARSE_LARGE_MAX_RSS_MB ?? PHASE6_SPARSE_LARGE_DEFAULT_MAX_RSS_MB,
);
const truthToleranceM = 0.1;
const repeatToleranceM = 1e-12;
const maxIterations = 100;

const percentile = (values: number[], p: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)] ?? 0;
};

/** Recording decorator over the bundle correction solver (test-only). */
const createRecordingSolver = (inner: SparseCorrectionSolver): {
  solver: SparseCorrectionSolver;
  last: () => { input: SparseCorrectionSolveInput; result: SparseCorrectionSolveResult } | null;
} => {
  let last: { input: SparseCorrectionSolveInput; result: SparseCorrectionSolveResult } | null =
    null;
  return {
    solver: {
      solveFromEquations: (input: SparseCorrectionSolveInput): SparseCorrectionSolveResult => {
        const result = inner.solveFromEquations(input);
        last = { input, result };
        return result;
      },
    },
    last: () => last,
  };
};

const maxCoordDiff = (a: AdjustmentResult, b: AdjustmentResult): number => {
  let max = 0;
  for (const [id, stationA] of Object.entries(a.stations)) {
    const stationB = b.stations[id];
    if (!stationB) return Number.POSITIVE_INFINITY;
    if (!Number.isFinite(stationB.x) || !Number.isFinite(stationB.y)) {
      return Number.POSITIVE_INFINITY;
    }
    max = Math.max(max, Math.abs(stationA.x - stationB.x), Math.abs(stationA.y - stationB.y));
  }
  return max;
};

const truthMaxDiff = (
  candidate: AdjustmentResult,
  benchmarkCase: { unknownCount: number; dimension: '2d' | '3d' },
): { horizontalM: number; heightM: number } =>
  phase6TruthDiffs(candidate.stations, benchmarkCase);

const mb = (bytes: number): number => bytes / 1048576;

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

const cases = buildPhase6LargeBenchmarkCases(quick);
const startedAt = performance.now();

let bundle: Awaited<ReturnType<typeof createExperimentalSparseNumericalBundle>> | null = null;
let wasmError: string | null = null;
try {
  const imported = (await import(
    pathToFileURL(`${process.cwd()}/cpp/build-wasm/webnet_core.js`).href
  )) as { default: WebNetWasmFactory };
  bundle = await createExperimentalSparseNumericalBundle(imported.default);
} catch (error) {
  wasmError = error instanceof Error ? error.message : String(error);
}

const measurements: CaseMeasurement[] = [];
let stoppedEarlyReason: string | null = null;

for (const benchmarkCase of cases) {
  const base = {
    id: benchmarkCase.id,
    family: benchmarkCase.family,
    variant: benchmarkCase.variant,
    stations: benchmarkCase.stationCount,
    unknowns: benchmarkCase.unknownCount,
    observations: 0,
    dof: 0,
  };
  const sizeSkip = phase6LargeSizeSkipReason(benchmarkCase, maxUnknowns);
  if (sizeSkip != null) {
    measurements.push({ ...base, status: 'skipped', skipReason: sizeSkip });
    continue;
  }
  if (wasmError != null || bundle == null) {
    measurements.push({
      ...base,
      status: 'skipped',
      skipReason: `WASM unavailable: ${(wasmError ?? 'unknown').slice(0, 160)}`,
    });
    continue;
  }
  if (performance.now() - startedAt > maxTotalMs) {
    stoppedEarlyReason = `wall-clock budget SPARSE_LARGE_MAX_TOTAL_MS=${maxTotalMs} exceeded`;
    measurements.push({ ...base, status: 'skipped', skipReason: stoppedEarlyReason });
    continue;
  }
  const rssBeforeMb = mb(process.memoryUsage().rss);
  if (rssBeforeMb > maxRssMb) {
    stoppedEarlyReason = `RSS cap SPARSE_LARGE_MAX_RSS_MB=${maxRssMb} exceeded (${rssBeforeMb.toFixed(0)} MiB)`;
    measurements.push({ ...base, status: 'skipped', skipReason: stoppedEarlyReason });
    break;
  }

  const diagnostics = createExperimentalSparseRouteDiagnostics();
  const recording = createRecordingSolver(bundle.sparseCorrectionSolver);
  const activeBundle = { ...bundle, sparseCorrectionSolver: recording.solver };
  let lastEngine: LSAEngine | null = null;
  const solve = (): AdjustmentResult => {
    lastEngine = new LSAEngine({
      input: benchmarkCase.input,
      ...buildExperimentalSparseEngineOptions(activeBundle, diagnostics, true),
    });
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
  const repeat = solve();
  const recorded = recording.last();
  const store = (lastEngine as unknown as Record<string, unknown> | null)?.[
    'experimentalSelectedCovarianceStore'
  ] as { queryCount?: unknown; parameterCount?: unknown } | undefined;
  const memAfter = process.memoryUsage();
  const truth = truthMaxDiff(candidate, benchmarkCase);
  measurements.push({
    ...base,
    status: 'measured',
    observations: candidate.observations.length,
    dof: candidate.dof,
    success: candidate.success,
    converged: candidate.converged,
    medianMs: percentile(times, 0.5),
    iterations: candidate.iterations,
    equationRows: recorded?.input.observationEquationCount,
    paramCount: recorded?.input.parameterCount,
    factorOrdering: recorded?.result.ordering,
    factorSolver: recorded?.result.solver,
    designNnz: recorded?.result.designNnz,
    weightNnz: recorded?.result.weightNnz,
    normalNnz: recorded?.result.normalNnz,
    factorNnz: recorded?.result.factorNnz,
    storage:
      recorded != null
        ? estimatePhase6SparseStorage({
            equationRows: recorded.input.observationEquationCount,
            paramCount: recorded.input.parameterCount,
            designNnz: recorded.result.designNnz,
            weightNnz: recorded.result.weightNnz,
            normalNnz: recorded.result.normalNnz,
            factorNnz: recorded.result.factorNnz,
          })
        : undefined,
    selectedQueryCount: typeof store?.queryCount === 'number' ? store.queryCount : undefined,
    selectedParamCount: typeof store?.parameterCount === 'number' ? store.parameterCount : undefined,
    relativePrecisionRows: (candidate.relativePrecision ?? []).length,
    truthHorizontalMaxM: truth.horizontalM,
    truthHeightMaxM: truth.heightM,
    repeatMaxDiffM: maxCoordDiff(candidate, repeat),
    rssBeforeMb,
    rssAfterMb: mb(memAfter.rss),
    heapAfterMb: mb(memAfter.heapUsed),
    damping: recorded?.result.damping,
    dampingAttempts: recorded?.result.dampingAttempts,
    diagnostics,
  });
}

// Fail-closed checks: success/invariants/truth/determinism/no dense all-pairs.
const violations: string[] = [];
for (const m of measurements) {
  if (m.status !== 'measured') continue;
  const found = cases.find((c) => c.id === m.id);
  if (found == null) {
    violations.push(`${m.id}: case spec missing`);
    continue;
  }
  if (m.success !== true || m.converged !== true) {
    violations.push(`${m.id}: sparse solve did not converge successfully`);
  }
  if (m.stations !== found.stationCount || m.observations <= 0 || m.dof < 0) {
    violations.push(`${m.id}: invalid station/observation/DOF invariants`);
  }
  if ((m.iterations ?? maxIterations + 1) > maxIterations) {
    violations.push(`${m.id}: iterations ${m.iterations} exceed ${maxIterations}`);
  }
  if ((m.truthHorizontalMaxM ?? Number.POSITIVE_INFINITY) > truthToleranceM) {
    violations.push(`${m.id}: horizontal truth diff ${m.truthHorizontalMaxM?.toExponential(2)} exceeds ${truthToleranceM} m`);
  }
  if ((m.truthHeightMaxM ?? Number.POSITIVE_INFINITY) > truthToleranceM) {
    violations.push(`${m.id}: height truth diff ${m.truthHeightMaxM?.toExponential(2)} exceeds ${truthToleranceM} m`);
  }
  if (
    !Number.isFinite(m.repeatMaxDiffM) ||
    (m.repeatMaxDiffM ?? Number.POSITIVE_INFINITY) > repeatToleranceM
  ) {
    violations.push(`${m.id}: invalid repeat diff ${m.repeatMaxDiffM} m`);
  }
  if ((m.relativePrecisionRows ?? 1) !== 0) {
    violations.push(`${m.id}: expected 0 all-pairs relativePrecision rows, got ${m.relativePrecisionRows}`);
  }
  if (m.selectedQueryCount == null || m.selectedParamCount == null) {
    violations.push(`${m.id}: selected-network store unavailable (dense fallback?)`);
  } else {
    const dense = m.selectedParamCount * m.selectedParamCount;
    if (!(m.selectedQueryCount < dense && m.selectedQueryCount * 2 < dense)) {
      violations.push(`${m.id}: selected queries ${m.selectedQueryCount} not << n^2=${dense}`);
    }
  }
  const fallbackTotal =
    (m.diagnostics?.sparseCorrectionFallbacks ?? 0) +
    (m.diagnostics?.rowProductsFallbacks ?? 0) +
    (m.diagnostics?.selectedCovarianceFallbacks ?? 0);
  if (fallbackTotal > 0) {
    violations.push(`${m.id}: ${fallbackTotal} sparse fallbacks recorded`);
  }
}
if (violations.length > 0) {
  throw new Error(`Sparse-large benchmark checks failed: ${violations.join('; ')}`);
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
  maxUnknowns,
  maxTotalMs,
  maxRssMb,
  truthToleranceM,
  repeatToleranceM,
  stoppedEarlyReason,
};
const output = { metadata, cases: measurements };
mkdirSync('benchmarks/baselines', { recursive: true });
writeFileSync('benchmarks/baselines/sparse-large-latest.json', `${JSON.stringify(output, null, 2)}\n`);

const fmtMb = (bytes: number): string => mb(bytes).toFixed(2);
const header = `| Case | Unknowns | Eq rows | Params | Median ms | Iter | Horiz max m | Height max m | Repeat max m | Sel q/n² | relPrec | Dense P/N/Qxx MB | Sparse total KB | Factor nnz | RSS Δ MB | Diag |`;
const divider = `| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |`;
const rows = measurements.map((m) => {
  if (m.status === 'skipped') {
    return `| ${m.id} | ${m.unknowns} | skipped | skipped | skipped | - | - | - | - | - | - | - | - | - | ${m.skipReason ?? ''} |`;
  }
  const dense = m.storage
    ? `${fmtMb(m.storage.densePBytes)}/${fmtMb(m.storage.denseNBytes)}/${fmtMb(m.storage.denseQxxBytes)}`
    : 'n/a';
  const sparseKb =
    m.storage != null ? (m.storage.sparseTotalBytes / 1024).toFixed(1) : 'n/a';
  const sel =
    m.selectedQueryCount != null && m.selectedParamCount != null
      ? `${m.selectedQueryCount}/${m.selectedParamCount * m.selectedParamCount}`
      : 'n/a';
  const diag = m.diagnostics
    ? `corr ${m.diagnostics.sparseCorrectionCalls}/${m.diagnostics.sparseCorrectionFallbacks} rowp ${m.diagnostics.rowProductsCalls}/${m.diagnostics.rowProductsFallbacks} selcov ${m.diagnostics.selectedCovarianceCalls}/${m.diagnostics.selectedCovarianceFallbacks}`
    : '-';
  return `| ${m.id} | ${m.unknowns} | ${m.equationRows} | ${m.paramCount} | ${m.medianMs?.toFixed(1)} | ${m.iterations} | ${(m.truthHorizontalMaxM ?? 0).toExponential(2)} | ${(m.truthHeightMaxM ?? 0).toExponential(2)} | ${(m.repeatMaxDiffM ?? 0).toExponential(2)} | ${sel} | ${m.relativePrecisionRows} | ${dense} | ${sparseKb} | ${m.factorNnz} | ${((m.rssAfterMb ?? 0) - (m.rssBeforeMb ?? 0)).toFixed(1)} | ${diag} |`;
});
const markdown = [
  `# Phase 6 sparse-only large benchmark`,
  ``,
  `Generated: ${metadata.generatedAt} · Node ${metadata.node} · ${metadata.platform} · ${metadata.cpu}`,
  `Commit: ${metadata.gitCommit} · warmups: ${warmups} · measured runs: ${runs} · quick: ${quick}`,
  `Route: injected full sparse selected-network bundle only (no dense TS reference, no dense Qxx/all-pairs).`,
  `Guards: max unknowns ${maxUnknowns}, wall-clock budget ${maxTotalMs} ms, RSS cap ${maxRssMb} MiB.`,
  stoppedEarlyReason != null ? `Stopped early: ${stoppedEarlyReason}.` : `All cases attempted within guards.`,
  `Checks: generated-truth <= ${truthToleranceM} m, repeat determinism <= ${repeatToleranceM} m,`,
  `0 all-pairs relativePrecision rows, selected queries << n^2, zero sparse fallbacks.`,
  ``,
  header,
  divider,
  ...rows,
  ``,
  `No dense P/N/Qxx was allocated on this route; dense columns are estimates (8 bytes/entry).`,
  ``,
].join('\n');
writeFileSync('benchmarks/baselines/sparse-large-latest.md', markdown);
if (writeBaseline) {
  writeFileSync('benchmarks/baselines/sparse-large-baseline.json', `${JSON.stringify(output, null, 2)}\n`);
  writeFileSync('benchmarks/baselines/sparse-large-baseline.md', markdown);
}
console.log(markdown);
console.log(`Wrote benchmarks/baselines/sparse-large-latest.json${writeBaseline ? ' and baseline files' : ''}.`);
