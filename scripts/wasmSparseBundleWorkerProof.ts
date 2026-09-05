/**
 * Test-only worker_threads proof for the experimental sparse bundle.
 *
 * Run: `node --import tsx scripts/wasmSparseBundleWorkerProof.ts [--iterations=25] [--seed=1]`
 *
 * Each iteration spawns a fresh worker that initializes the bundle exactly
 * once, runs one deterministically generated case through all three solvers
 * (correction, row products, selected covariance), and posts route
 * diagnostics plus heap/RSS observations back to the main thread. The main
 * thread prints a per-iteration table, re-runs the first seed to prove
 * determinism, and reports heap/RSS drift across iterations.
 */
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';

import { createExperimentalSparseNumericalBundle } from '../src/engine/wasm/experimentalSparseNumericalBundle';
import type { WebNetWasmFactory } from '../src/engine/wasm/wasmTypes';
import { buildSparseSolveInput } from '../src/engine/sparseEquationPacking';
import type { SparseMatrixRows } from '../src/engine/matrixTypes';
import {
  createExperimentalSparseRouteDiagnostics,
  recordRowProductsCall,
  recordSelectedCovarianceCall,
  recordSparseCorrectionCall,
} from '../src/engine/experimentalSparseDiagnostics';

type WorkerParams = {
  seed: number;
  paramCount: number;
  equationCount: number;
  wasmPath: string;
};

type WorkerProofResult = {
  seed: number;
  sparseCorrectionCalls: number;
  rowProductsCalls: number;
  selectedCovarianceCalls: number;
  fallbacks: number;
  correctionNorm: number;
  quad0: number;
  cov00: number;
  heapUsedMiB: number;
  rssMiB: number;
};

/** Deterministic PRNG so every seed reproduces its case exactly. */
const mulberry32 = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
};

const runWorkerProof = async (params: WorkerParams): Promise<WorkerProofResult> => {
  const wasmUrl = pathToFileURL(params.wasmPath).href;
  const imported = (await import(wasmUrl)) as { default: WebNetWasmFactory };
  const bundle = await createExperimentalSparseNumericalBundle(imported.default);
  const rand = mulberry32(params.seed);
  const { paramCount, equationCount } = params;
  const rows: SparseMatrixRows = Array.from({ length: equationCount }, (_, row) => {
    const entries = [{ index: row % paramCount, value: 1 + rand() }];
    if (paramCount > 1) {
      entries.push({ index: (row + 1) % paramCount, value: (rand() - 0.5) * 2 });
    }
    if (paramCount > 2 && row % 2 === 0) {
      entries.push({ index: (row + 2) % paramCount, value: (rand() - 0.5) * 2 });
    }
    entries.sort((a, b) => a.index - b.index);
    return entries;
  });
  const weights = Array.from({ length: equationCount }, (_, i) =>
    Array.from({ length: equationCount }, (_, j) => (i === j ? 0.5 + rand() * 2.5 : 0)),
  );
  const misclosures = Array.from({ length: equationCount }, () => [(rand() - 0.5) * 2]);
  const packed = buildSparseSolveInput(rows, weights, misclosures, paramCount);
  const diagnostics = createExperimentalSparseRouteDiagnostics();

  recordSparseCorrectionCall(diagnostics);
  const correction = bundle.sparseCorrectionSolver.solveFromEquations(packed);
  recordRowProductsCall(diagnostics);
  const products = bundle.sparseRowProductsSolver.queryRowProducts({
    design: packed.design,
    weights: packed.weights,
    observationEquationCount: equationCount,
    parameterCount: paramCount,
    queryRowOffsets: packed.design.rowOffsets,
    queryColumns: packed.design.columns,
    queryValues: packed.design.values,
    crossA: new Int32Array([0, 1 % equationCount]),
    crossB: new Int32Array([1 % equationCount, 0]),
  });
  recordSelectedCovarianceCall(diagnostics);
  const selected = bundle.sparseSelectedCovarianceSolver.querySelected({
    design: packed.design,
    weights: packed.weights,
    observationEquationCount: equationCount,
    parameterCount: paramCount,
    queryRows: new Int32Array([0, 0, 1 % paramCount]),
    queryColumns: new Int32Array([0, 1 % paramCount, 1 % paramCount]),
  });

  const correctionNorm = Math.hypot(...correction.correction.map((row) => row[0] ?? 0));
  const quad0 = products.quadratic[0] ?? Number.NaN;
  const cov00 = selected.covariance[0] ?? Number.NaN;
  if (![correctionNorm, quad0, cov00, products.cross[0] ?? 0].every(Number.isFinite)) {
    throw new Error(`Non-finite bundle result for seed ${params.seed}.`);
  }
  if (quad0 < -1e-9 || cov00 <= 0) {
    throw new Error(`Implausible bundle result for seed ${params.seed}: q0=${quad0}, cov00=${cov00}.`);
  }
  const memory = process.memoryUsage();
  return {
    seed: params.seed,
    sparseCorrectionCalls: diagnostics.sparseCorrectionCalls,
    rowProductsCalls: diagnostics.rowProductsCalls,
    selectedCovarianceCalls: diagnostics.selectedCovarianceCalls,
    fallbacks:
      diagnostics.sparseCorrectionFallbacks +
      diagnostics.rowProductsFallbacks +
      diagnostics.selectedCovarianceFallbacks,
    correctionNorm,
    quad0,
    cov00,
    heapUsedMiB: memory.heapUsed / 1048576,
    rssMiB: memory.rss / 1048576,
  };
};

const runOneIteration = (params: WorkerParams, timeoutMs: number): Promise<WorkerProofResult> =>
  new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), { workerData: params });
    const timer = setTimeout(() => {
      void worker.terminate();
      reject(new Error(`Worker timed out for seed ${params.seed}.`));
    }, timeoutMs);
    worker.once('message', (result: WorkerProofResult) => {
      clearTimeout(timer);
      void worker.terminate();
      resolve(result);
    });
    worker.once('error', (error) => {
      clearTimeout(timer);
      void worker.terminate();
      reject(error);
    });
    worker.once('exit', (code) => {
      if (code !== 0) {
        clearTimeout(timer);
        reject(new Error(`Worker exited with code ${code} for seed ${params.seed}.`));
      }
    });
  });

const parseFlag = (name: string, fallback: number): number => {
  const raw = process.argv.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
  const value = raw == null ? fallback : Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`Expected a positive integer for ${name}.`);
  return value;
};

if (!isMainThread) {
  const result = await runWorkerProof(workerData as WorkerParams);
  parentPort?.postMessage(result);
} else {
  const iterations = parseFlag('--iterations', 25);
  const seed = parseFlag('--seed', 1);
  const wasmPath = `${process.cwd()}/cpp/build-wasm/webnet_core.js`;
  const results: WorkerProofResult[] = [];
  for (let i = 0; i < iterations; i += 1) {
    const result = await runOneIteration(
      { seed: seed + i, paramCount: 12, equationCount: 30, wasmPath },
      60000,
    );
    if (
      result.sparseCorrectionCalls !== 1 ||
      result.rowProductsCalls !== 1 ||
      result.selectedCovarianceCalls !== 1 ||
      result.fallbacks !== 0
    ) {
      throw new Error(`Unexpected route diagnostics on iteration ${i}: ${JSON.stringify(result)}.`);
    }
    results.push(result);
  }
  const repeat = await runOneIteration({ seed, paramCount: 12, equationCount: 30, wasmPath }, 60000);
  const first = results[0];
  if (
    !first ||
    repeat.correctionNorm !== first.correctionNorm ||
    repeat.quad0 !== first.quad0 ||
    repeat.cov00 !== first.cov00
  ) {
    throw new Error('Bundle proof is not deterministic across repeated seeds.');
  }
  console.log('iter seed heapMiB rssMiB correctionNorm quad0 cov00');
  results.forEach((result, i) => {
    console.log(
      `${i} ${result.seed} ${result.heapUsedMiB.toFixed(1)} ${result.rssMiB.toFixed(1)} ` +
        `${result.correctionNorm.toExponential(6)} ${result.quad0.toExponential(6)} ${result.cov00.toExponential(6)}`,
    );
  });
  const last = results[results.length - 1];
  if (first && last) {
    console.log(
      `drift heap=${(last.heapUsedMiB - first.heapUsedMiB).toFixed(1)}MiB ` +
        `rss=${(last.rssMiB - first.rssMiB).toFixed(1)}MiB over ${iterations} fresh workers; ` +
        `repeat-seed deterministic.`,
    );
  }
  console.log('WASM sparse bundle worker proof passed.');
}
