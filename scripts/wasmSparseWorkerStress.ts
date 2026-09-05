/**
 * Bounded Node worker_threads stress/proof for the experimental sparse bundle.
 *
 * Spawns exactly one worker; the worker initializes exactly one shared bundle
 * (correction + row products + selected covariance over one WASM module) and
 * repeatedly runs full selected-network solves over a deterministic generated
 * case (default: chain-2d-16 x 25 iterations). Reports timing, heap/RSS
 * before/after, route diagnostics, and the selected query budget. Test-only:
 * no production worker code is touched or changed.
 *
 * Usage: `npm run wasm:sparse:worker-stress [-- --quick]`
 */
import { isMainThread, parentPort, workerData, Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';

import { LSAEngine } from '../src/engine/adjust';
import type { AdjustmentResult } from '../src/typesAdjustmentResult';
import {
  buildExperimentalSparseEngineOptions,
  createExperimentalSparseNumericalBundle,
} from '../src/engine/wasm/experimentalSparseNumericalBundle';
import {
  createExperimentalSparseRouteDiagnostics,
  type ExperimentalSparseRouteDiagnostics,
} from '../src/engine/experimentalSparseDiagnostics';
import { generatePhase5BenchmarkInput } from '../src/engine/phase5BenchmarkNetworks';
import type { WebNetWasmFactory } from '../src/engine/wasm/wasmTypes';

interface StressRequest {
  input: string;
  caseId: string;
  iterations: number;
}

interface StressSummary {
  caseId: string;
  iterations: number;
  bundleFactoryCalls: number;
  referenceMs: number;
  timesMs: number[];
  medianMs: number;
  minMs: number;
  p95Ms: number;
  allSuccess: boolean;
  maxCoordDiffM: number;
  selectedQueryCount?: number;
  selectedParamCount?: number;
  relativePrecisionRows?: number;
  diagnostics: ExperimentalSparseRouteDiagnostics;
  heapBeforeMb: number;
  heapAfterMb: number;
  rssBeforeMb: number;
  rssAfterMb: number;
}

const percentile = (values: number[], p: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)] ?? 0;
};

const toMb = (bytes: number): number => bytes / 1024 / 1024;

const maxCoordDiff = (reference: AdjustmentResult, candidate: AdjustmentResult): number => {
  let max = 0;
  for (const [id, refStation] of Object.entries(reference.stations)) {
    const other = candidate.stations[id];
    if (!other) return Number.POSITIVE_INFINITY;
    max = Math.max(max, Math.abs(refStation.x - other.x), Math.abs(refStation.y - other.y));
  }
  return max;
};

if (!isMainThread) {
  const request = workerData as StressRequest;
  const memBefore = process.memoryUsage();
  let factoryCalls = 0;
  const imported = (await import(
    pathToFileURL(`${process.cwd()}/cpp/build-wasm/webnet_core.js`).href
  )) as { default: WebNetWasmFactory };
  const factory: WebNetWasmFactory = () => {
    factoryCalls += 1;
    return imported.default();
  };
  const bundle = await createExperimentalSparseNumericalBundle(factory);
  const refStart = performance.now();
  const reference = new LSAEngine({ input: request.input }).solve() as AdjustmentResult;
  const referenceMs = performance.now() - refStart;
  const diagnostics = createExperimentalSparseRouteDiagnostics();
  const timesMs: number[] = [];
  let allSuccess = reference.success;
  let maxDiff = 0;
  let lastEngine: LSAEngine | null = null;
  let candidate = reference;
  for (let i = 0; i < request.iterations; i += 1) {
    const start = performance.now();
    lastEngine = new LSAEngine({
      input: request.input,
      ...buildExperimentalSparseEngineOptions(bundle, diagnostics, true),
    });
    candidate = lastEngine.solve() as AdjustmentResult;
    timesMs.push(performance.now() - start);
    allSuccess = allSuccess && candidate.success;
    maxDiff = Math.max(maxDiff, maxCoordDiff(reference, candidate));
  }
  const store = (lastEngine as unknown as Record<string, unknown> | null)?.[
    'experimentalSelectedCovarianceStore'
  ] as { queryCount?: unknown; parameterCount?: unknown } | undefined;
  const memAfter = process.memoryUsage();
  const summary: StressSummary = {
    caseId: request.caseId,
    iterations: request.iterations,
    bundleFactoryCalls: factoryCalls,
    referenceMs,
    timesMs,
    medianMs: percentile(timesMs, 0.5),
    minMs: Math.min(...timesMs),
    p95Ms: percentile(timesMs, 0.95),
    allSuccess,
    maxCoordDiffM: maxDiff,
    selectedQueryCount: typeof store?.queryCount === 'number' ? store.queryCount : undefined,
    selectedParamCount: typeof store?.parameterCount === 'number' ? store.parameterCount : undefined,
    relativePrecisionRows: (candidate.relativePrecision ?? []).length,
    diagnostics,
    heapBeforeMb: toMb(memBefore.heapUsed),
    heapAfterMb: toMb(memAfter.heapUsed),
    rssBeforeMb: toMb(memBefore.rss),
    rssAfterMb: toMb(memAfter.rss),
  };
  parentPort?.postMessage(summary);
} else {
  const quick = process.argv.includes('--quick');
  const caseId = quick ? 'chain-2d-04' : 'chain-2d-16';
  const unknownCount = quick ? 4 : 16;
  const iterations = quick ? 5 : 25;
  const seed = quick ? 1101 : 1116;
  const input = generatePhase5BenchmarkInput({
    id: caseId,
    family: 'chain-2d',
    unknownCount,
    seed,
  });
  const worker = new Worker(fileURLToPath(import.meta.url), {
    workerData: { input, caseId, iterations } satisfies StressRequest,
    execArgv: [...process.execArgv],
  });
  const failures: string[] = [];
  worker.on('message', (summary: StressSummary) => {
    const d = summary.diagnostics;
    const dense =
      summary.selectedParamCount != null ? summary.selectedParamCount * summary.selectedParamCount : null;
    const ratio =
      summary.selectedQueryCount != null && dense ? summary.selectedQueryCount / dense : null;
    if (summary.bundleFactoryCalls !== 1) {
      failures.push(`expected exactly 1 bundle module load, saw ${summary.bundleFactoryCalls}`);
    }
    if (!summary.allSuccess) failures.push('not all worker solves succeeded');
    if (summary.maxCoordDiffM > 1e-6) {
      failures.push(`coord diff ${summary.maxCoordDiffM.toExponential(2)} exceeds 1e-6 m`);
    }
    if (summary.selectedQueryCount != null && dense != null && !(summary.selectedQueryCount * 2 < dense)) {
      failures.push(`selected queries ${summary.selectedQueryCount} not << n^2=${dense}`);
    }
    const lines = [
      `# Sparse worker stress (1 worker, 1 shared bundle)`,
      ``,
      `Case: ${summary.caseId} · iterations: ${summary.iterations} · bundle module loads: ${summary.bundleFactoryCalls}`,
      `TS reference solve: ${summary.referenceMs.toFixed(2)} ms · selected full-bundle median/min/p95: ${summary.medianMs.toFixed(2)}/${summary.minMs.toFixed(2)}/${summary.p95Ms.toFixed(2)} ms`,
      `All success: ${summary.allSuccess} · max coord diff vs TS: ${summary.maxCoordDiffM.toExponential(2)} m`,
      `Selected queries/n²: ${summary.selectedQueryCount ?? 'n/a'}/${dense ?? 'n/a'}${ratio != null ? ` (${ratio.toFixed(2)})` : ''} · legacy relativePrecision rows: ${summary.relativePrecisionRows ?? 'n/a'} (0 expected)`,
      `Route diagnostics: corr ${d.sparseCorrectionCalls}/${d.sparseCorrectionFallbacks} · rowp ${d.rowProductsCalls}/${d.rowProductsFallbacks} · selcov ${d.selectedCovarianceCalls}/${d.selectedCovarianceFallbacks}`,
      `Heap: ${summary.heapBeforeMb.toFixed(1)} → ${summary.heapAfterMb.toFixed(1)} MiB (Δ ${(summary.heapAfterMb - summary.heapBeforeMb).toFixed(1)}) · RSS: ${summary.rssBeforeMb.toFixed(1)} → ${summary.rssAfterMb.toFixed(1)} MiB (Δ ${(summary.rssAfterMb - summary.rssBeforeMb).toFixed(1)})`,
      ...(d.sparseCorrectionFallbackReasons.length +
        d.rowProductsFallbackReasons.length +
        d.selectedCovarianceFallbackReasons.length >
      0
        ? [
            `Fallback reasons: ${[...d.sparseCorrectionFallbackReasons, ...d.rowProductsFallbackReasons, ...d.selectedCovarianceFallbackReasons].join(' | ').slice(0, 500)}`,
          ]
        : [`No sparse fallbacks recorded.`]),
      ...(failures.length > 0 ? [``, `FAILURES: ${failures.join('; ')}`] : [`Result: PASS`]),
      ``,
    ];
    console.log(lines.join('\n'));
    process.exit(failures.length > 0 ? 1 : 0);
  });
  worker.on('error', (error) => {
    console.error(`Worker error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
  worker.on('exit', (code) => {
    if (code !== 0) {
      console.error(`Worker exited with code ${code} before reporting.`);
      process.exit(code);
    }
  });
}
