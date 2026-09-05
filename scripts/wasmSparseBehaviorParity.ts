import { pathToFileURL } from 'node:url';
import { LSAEngine } from '../src/engine/adjust';
import { WasmSparseNormalEquationSolver } from '../src/engine/wasm/wasmSparseNormalSolver';
import { loadWebNetWasm } from '../src/engine/wasm/wasmModule';
import type { WebNetWasmFactory } from '../src/engine/wasm/wasmTypes';

const imported = (await import(pathToFileURL(`${process.cwd()}/cpp/build-wasm/webnet_core.js`).href)) as { default: WebNetWasmFactory };
const module = await loadWebNetWasm(imported.default);
if (!module) throw new Error('WASM module failed to initialize.');
const robustInput = ['.2D', 'C A 0 0 0 ! !', 'C B 100 0 0 ! !', 'C U 50 60 0', 'D A-U 78.102 0.003', 'D B-U 78.102 0.003', 'A U-A-B 78-30-00.0 1.0'].join('\n');
const options = { input: robustInput, maxIterations: 8, convergenceThreshold: 0.001, parseOptions: { robustMode: 'huber' as const } };
const reference = new LSAEngine(options).solve();
const sparse = new LSAEngine({ ...options, sparseCorrectionSolver: new WasmSparseNormalEquationSolver(module) }).solve();
if (reference.converged !== sparse.converged || reference.iterations !== sparse.iterations || reference.dof !== sparse.dof) {
  throw new Error(`Robust sparse parity mismatch: TS=${reference.converged}/${reference.iterations}/${reference.dof}, sparse=${sparse.converged}/${sparse.iterations}/${sparse.dof}`);
}
if (!sparse.robustDiagnostics || sparse.robustDiagnostics.iterations.length === 0) throw new Error('Sparse robust diagnostics were not retained.');
console.log(`WASM sparse robust parity passed: iterations=${sparse.iterations}, diagnostics=${sparse.robustDiagnostics.iterations.length}`);
