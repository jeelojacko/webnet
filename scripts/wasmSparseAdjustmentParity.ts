import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { LSAEngine } from '../src/engine/adjust';
import { WasmSparseNormalEquationSolver } from '../src/engine/wasm/wasmSparseNormalSolver';
import { loadWebNetWasm } from '../src/engine/wasm/wasmModule';
import type { WebNetWasmFactory } from '../src/engine/wasm/wasmTypes';

const imported = (await import(pathToFileURL(`${process.cwd()}/cpp/build-wasm/webnet_core.js`).href)) as { default: WebNetWasmFactory };
const module = await loadWebNetWasm(imported.default);
if (!module) throw new Error('WASM module failed to initialize.');
const fixtures = ['industry_standard_reference_case.dat', 'gps_network_sideshot_phase3.dat', 'gps_offset_phase3.dat'];
for (const fixture of fixtures) {
  const input = readFileSync(`tests/fixtures/${fixture}`, 'utf8');
  const options = { input, maxIterations: 15, convergenceThreshold: 0.001 };
  const reference = new LSAEngine(options).solve();
  const sparse = new LSAEngine({ ...options, sparseCorrectionSolver: new WasmSparseNormalEquationSolver(module) }).solve();
  if (reference.converged !== sparse.converged || reference.iterations !== sparse.iterations || reference.dof !== sparse.dof) {
    throw new Error(`${fixture} sparse adjustment convergence mismatch: TS=${reference.converged}/${reference.iterations}/${reference.dof}, sparse=${sparse.converged}/${sparse.iterations}/${sparse.dof}`);
  }
  const coordinateDifference = Math.max(...Object.keys(reference.stations).map((id) => {
    const a = reference.stations[id];
    const b = sparse.stations[id];
    return Math.max(Math.abs((a?.x ?? 0) - (b?.x ?? 0)), Math.abs((a?.y ?? 0) - (b?.y ?? 0)), Math.abs((a?.h ?? 0) - (b?.h ?? 0)));
  }));
  if (coordinateDifference > 1e-8) throw new Error(`${fixture} sparse adjustment coordinate mismatch: ${coordinateDifference}`);
  console.log(`WASM sparse parity ${fixture}: iterations=${sparse.iterations}, dof=${sparse.dof}, max coordinate difference=${coordinateDifference}`);
}
