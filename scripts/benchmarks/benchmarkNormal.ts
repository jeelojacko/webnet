import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { solveNormalEquations } from '../../src/engine/adjustNormalEquationHelpers';
import { WasmDenseNormalEquationSolver } from '../../src/engine/wasm/wasmDenseNormalSolver';
import { loadWebNetWasm } from '../../src/engine/wasm/wasmModule';
import type { WebNetWasmFactory } from '../../src/engine/wasm/wasmTypes';

const sizes = [25, 50, 100, 200, 400, 800];
const runs = 5;
const system = (n: number): { normal: number[][]; rhs: number[][] } => ({
  normal: Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? n + 1 : 1))),
  rhs: Array.from({ length: n }, (_, i) => [1 + (i % 7) / 4]),
});
const measure = (solve: () => void): number => {
  for (let i = 0; i < 2; i += 1) solve();
  const values = Array.from({ length: runs }, () => {
    const start = performance.now();
    solve();
    return performance.now() - start;
  }).sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)] ?? 0;
};

const imported = (await import(pathToFileURL(`${process.cwd()}/cpp/build-wasm/webnet_core.js`).href)) as { default: WebNetWasmFactory };
const wasm = await loadWebNetWasm(imported.default);
if (!wasm) throw new Error('WASM module failed to initialize.');
const wasmSolver = new WasmDenseNormalEquationSolver(wasm);
console.log('| n | TypeScript median ms | WASM transfer-inclusive median ms |');
console.log('|---:|---:|---:|');
for (const n of sizes) {
  const { normal, rhs } = system(n);
  const ts = measure(() => { solveNormalEquations(normal, rhs, { log: () => undefined }); });
  const wasmMs = measure(() => { wasmSolver.solveCorrection(normal, rhs); });
  console.log(`| ${n} | ${ts.toFixed(3)} | ${wasmMs.toFixed(3)} |`);
}
const native = process.platform === 'win32' ? 'cpp/build/Release/webnet_dense_benchmark.exe' : 'cpp/build/webnet_dense_benchmark';
try {
  console.log('\nNative portable solver:');
  console.log(execFileSync(native, { encoding: 'utf8' }).trim());
} catch {
  console.log('\nNative benchmark unavailable; run npm run cpp:build first.');
}
