import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { LSAEngine } from '../src/engine/adjust';
import { WasmDenseNormalEquationSolver } from '../src/engine/wasm/wasmDenseNormalSolver';
import { loadWebNetWasm } from '../src/engine/wasm/wasmModule';
import type { WebNetWasmFactory } from '../src/engine/wasm/wasmTypes';

const imported = (await import(pathToFileURL(`${process.cwd()}/cpp/build-wasm/webnet_core.js`).href)) as { default: WebNetWasmFactory };
const module = await loadWebNetWasm(imported.default);
if (!module) throw new Error('WASM module failed to initialize.');
const input = readFileSync('tests/fixtures/industry_standard_reference_case.dat', 'utf8');
const options = { input, maxIterations: 15, convergenceThreshold: 0.001 };
const typescript = new LSAEngine(options).solve();
const wasm = new LSAEngine({ ...options, normalEquationSolver: new WasmDenseNormalEquationSolver(module) }).solve();
if (!typescript.converged || !wasm.converged || typescript.iterations !== wasm.iterations || typescript.dof !== wasm.dof) {
  throw new Error(`Adjustment convergence mismatch: TS=${typescript.converged}/${typescript.iterations}/${typescript.dof}, WASM=${wasm.converged}/${wasm.iterations}/${wasm.dof}`);
}
const coordinateDifference = Math.max(...Object.keys(typescript.stations).map((id) => {
  const a = typescript.stations[id];
  const b = wasm.stations[id];
  return Math.max(Math.abs((a?.easting ?? 0) - (b?.easting ?? 0)), Math.abs((a?.northing ?? 0) - (b?.northing ?? 0)), Math.abs((a?.elevation ?? 0) - (b?.elevation ?? 0)));
}));
if (coordinateDifference > 1e-10) throw new Error(`Adjustment coordinate mismatch: ${coordinateDifference}`);
console.log(`WASM full-adjustment parity passed: iterations=${wasm.iterations}, dof=${wasm.dof}, max coordinate difference=${coordinateDifference}`);
