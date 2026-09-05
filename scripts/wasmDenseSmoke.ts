import { pathToFileURL } from 'node:url';
import { WasmDenseNormalEquationSolver } from '../src/engine/wasm/wasmDenseNormalSolver';
import { loadWebNetWasm } from '../src/engine/wasm/wasmModule';
import type { WebNetWasmFactory } from '../src/engine/wasm/wasmTypes';

const modulePath = pathToFileURL(`${process.cwd()}/cpp/build-wasm/webnet_core.js`).href;
const imported = (await import(modulePath)) as { default: WebNetWasmFactory };
const wasm = await loadWebNetWasm(imported.default);
if (!wasm) throw new Error('WASM module failed to initialize.');

const result = new WasmDenseNormalEquationSolver(wasm).solveCorrection(
  [[4, 1], [1, 3]],
  [[1], [2]],
);
const values = result.correction.map((row) => row[0]);
if (Math.abs((values[0] ?? 0) - 1 / 11) > 1e-12 || Math.abs((values[1] ?? 0) - 7 / 11) > 1e-12) {
  throw new Error(`Unexpected WASM correction: ${values.join(', ')}`);
}
console.log(`WASM dense solver smoke passed: x=[${values.join(', ')}] damping=${result.damping} attempts=${result.dampingAttempts}`);
