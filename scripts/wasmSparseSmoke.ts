import { pathToFileURL } from 'node:url';
import { WasmSparseNormalEquationSolver } from '../src/engine/wasm/wasmSparseNormalSolver';
import { buildSparseSolveInput } from '../src/engine/sparseEquationPacking';
import { loadWebNetWasm } from '../src/engine/wasm/wasmModule';
import type { WebNetWasmFactory } from '../src/engine/wasm/wasmTypes';

const imported = (await import(pathToFileURL(`${process.cwd()}/cpp/build-wasm/webnet_core.js`).href)) as { default: WebNetWasmFactory };
const module = await loadWebNetWasm(imported.default);
if (!module) throw new Error('WASM module failed to initialize.');
const solver = new WasmSparseNormalEquationSolver(module);
const result = solver.solveFromEquations(buildSparseSolveInput(
  [[{ index: 0, value: 1 }, { index: 1, value: 2 }], [{ index: 0, value: 3 }, { index: 1, value: 4 }]],
  [[2, 0.5], [0.5, 3]],
  [[5], [11]],
  2,
));
const values = result.correction.map((row) => row[0]);
if (Math.abs((values[0] ?? 0) - 1) > 1e-12 || Math.abs((values[1] ?? 0) - 2) > 1e-12) {
  throw new Error(`Unexpected sparse WASM correction: ${values.join(', ')}`);
}
console.log(`WASM sparse solver smoke passed: correction=[${values.join(', ')}], N nnz=${result.normalNnz}, factor nnz=${result.factorNnz}`);
