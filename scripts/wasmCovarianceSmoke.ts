import { pathToFileURL } from 'node:url';
import { buildSparseSolveInput } from '../src/engine/sparseEquationPacking';
import { WasmSparseSelectedCovariance } from '../src/engine/wasm/wasmSparseCovariance';
import { WasmSparseRowProducts } from '../src/engine/wasm/wasmSparseRowProducts';
import { loadWebNetWasm } from '../src/engine/wasm/wasmModule';
import type { WebNetWasmFactory } from '../src/engine/wasm/wasmTypes';

const imported = (await import(pathToFileURL(`${process.cwd()}/cpp/build-wasm/webnet_core.js`).href)) as { default: WebNetWasmFactory };
const module = await loadWebNetWasm(imported.default);
if (!module) throw new Error('WASM module failed to initialize.');
const packed = buildSparseSolveInput(
  [[{ index: 0, value: 1 }, { index: 1, value: 2 }], [{ index: 0, value: 3 }, { index: 1, value: 4 }]],
  [[2, 0.5], [0.5, 3]], [[5], [11]], 2,
);
const covariance = new WasmSparseSelectedCovariance(module).querySelected({
  ...packed,
  queryRows: new Int32Array([0, 0, 1, 1]),
  queryColumns: new Int32Array([0, 1, 0, 1]),
});
const products = new WasmSparseRowProducts(module).queryRowProducts({
  ...packed,
  queryRowOffsets: packed.design.rowOffsets,
  queryColumns: packed.design.columns,
  queryValues: packed.design.values,
  crossA: new Int32Array([0, 1]),
  crossB: new Int32Array([1, 0]),
});
if (Math.abs((covariance.covariance[0] ?? 0) - 2.7826086956522) > 1e-10 || !Number.isFinite(products.quadratic[0])) {
  throw new Error('Unexpected WASM covariance/row-product result.');
}
console.log(`WASM covariance smoke passed: Qxx00=${covariance.covariance[0]}, q0=${products.quadratic[0]}, cross=${products.cross[0]}`);
