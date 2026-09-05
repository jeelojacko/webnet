import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { accumulateNormalEquationsFromSparseRows } from '../../src/engine/matrix';
import { solveNormalEquations } from '../../src/engine/adjustNormalEquationHelpers';
import { WasmDenseNormalEquationSolver } from '../../src/engine/wasm/wasmDenseNormalSolver';
import { WasmSparseNormalEquationSolver } from '../../src/engine/wasm/wasmSparseNormalSolver';
import { buildSparseSolveInput } from '../../src/engine/sparseEquationPacking';
import { loadWebNetWasm } from '../../src/engine/wasm/wasmModule';
import type { WebNetWasmFactory } from '../../src/engine/wasm/wasmTypes';
import type { SparseMatrixRows } from '../../src/engine/matrix';

const sizes = [100, 250, 500, 1000, 2500, 5000];
const makeNetwork = (parameters: number): { rows: SparseMatrixRows; misclosures: number[][]; weights: number[][] } => {
  const equations = parameters * 2;
  const rows: SparseMatrixRows = [];
  for (let row = 0; row < equations; row += 1) {
    const first = row % parameters;
    const entries = [{ index: first, value: 1 }];
    if (row % 2 === 0) entries.push({ index: (first + 1) % parameters, value: 0.25 });
    if (row % 3 === 0) entries.push({ index: (first + 7) % parameters, value: -0.125 });
    rows.push(entries.sort((a, b) => a.index - b.index));
  }
  return { rows, misclosures: Array.from({ length: equations }, (_, row) => [1 + (row % 7) / 4]), weights: Array.from({ length: equations }, (_, row) => { const weight: number[] = []; weight[row] = 1; return weight; }) };
};
const median = (values: number[]): number => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;
const measure = (run: () => void): number => {
  run();
  return median(Array.from({ length: 3 }, () => { const start = performance.now(); run(); return performance.now() - start; }));
};

const imported = (await import(pathToFileURL(`${process.cwd()}/cpp/build-wasm/webnet_core.js`).href)) as { default: WebNetWasmFactory };
const module = await loadWebNetWasm(imported.default);
if (!module) throw new Error('WASM module failed to initialize.');
const sparseSolver = new WasmSparseNormalEquationSolver(module);
const denseSolver = new WasmDenseNormalEquationSolver(module);
console.log('| Params | Eq rows | A NNZ | P NNZ | N NNZ | N density | Factor NNZ | Dense N MiB | Sparse N est MiB | TS dense ms | WASM dense ms | WASM sparse ms |');
console.log('|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
for (const parameters of sizes) {
  const network = makeNetwork(parameters);
  const sparseInput = buildSparseSolveInput(network.rows, network.weights, network.misclosures, parameters);
  let ts = 'skipped';
  let dense = 'skipped';
  if (parameters <= 250) {
    const normal = accumulateNormalEquationsFromSparseRows(network.rows, network.misclosures, network.weights, parameters);
    ts = measure(() => { solveNormalEquations(normal.normal, normal.rhs, { log: () => undefined }); }).toFixed(3);
    dense = measure(() => { denseSolver.solveCorrection(normal.normal, normal.rhs); }).toFixed(3);
  }
  let sparseResult = sparseSolver.solveFromEquations(sparseInput);
  const sparseMs = measure(() => { sparseResult = sparseSolver.solveFromEquations(sparseInput); });
  const density = (100 * sparseResult.normalNnz) / (parameters * parameters);
  const denseBytes = (parameters * parameters * Float64Array.BYTES_PER_ELEMENT) / (1024 * 1024);
  const sparseEstimate = (sparseResult.normalNnz * (Float64Array.BYTES_PER_ELEMENT + Int32Array.BYTES_PER_ELEMENT * 2)) / (1024 * 1024);
  console.log(`| ${parameters} | ${sparseInput.observationEquationCount} | ${sparseInput.design.values.length} | ${sparseInput.weights.values.length} | ${sparseResult.normalNnz} | ${density.toFixed(3)}% | ${sparseResult.factorNnz} | ${denseBytes.toFixed(2)} | ${sparseEstimate.toFixed(2)} | ${ts} | ${dense} | ${sparseMs.toFixed(3)} |`);
}
try {
  console.log('\nNative sparse benchmark:');
  console.log(execFileSync('cpp/build/webnet_sparse_benchmark', { encoding: 'utf8' }).trim());
} catch {
  console.log('\nNative sparse benchmark unavailable; run npm run cpp:build first.');
}
