import { pathToFileURL } from 'node:url';
import { solveNormalEquations } from '../src/engine/adjustNormalEquationHelpers';
import { WasmDenseNormalEquationSolver } from '../src/engine/wasm/wasmDenseNormalSolver';
import { loadWebNetWasm } from '../src/engine/wasm/wasmModule';
import type { WebNetWasmFactory } from '../src/engine/wasm/wasmTypes';

const imported = (await import(pathToFileURL(`${process.cwd()}/cpp/build-wasm/webnet_core.js`).href)) as {
  default: WebNetWasmFactory;
};
const module = await loadWebNetWasm(imported.default);
if (!module) throw new Error('WASM module failed to initialize.');
const wasm = new WasmDenseNormalEquationSolver(module);
let seed = 0x12345678;
const random = (): number => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 0x100000000;
};
const solveTs = (normal: number[][], rhs: number[][]) => {
  const logs: string[] = [];
  const result = solveNormalEquations(normal, rhs, { log: (message) => logs.push(message) });
  const dampingLog = logs.find((message) => message.includes('diagonal damping')) ?? '';
  const match = dampingLog.match(/lambda=([^,]+), attempts=(\d+)/);
  return {
    correction: result.correction,
    damping: match ? Number(match[1]) : 0,
    attempts: match ? Number(match[2]) : 0,
  };
};

for (const dimension of [1, 2, 5, 10, 25, 50, 100]) {
  const lower = Array.from({ length: dimension }, (_, row) =>
    Array.from({ length: dimension }, (_, col) => (col <= row ? (col === row ? 1 + random() * 2 : random() - 0.5) : 0)),
  );
  const normal = Array.from({ length: dimension }, (_, row) =>
    Array.from({ length: dimension }, (_, col) =>
      Array.from({ length: dimension }, (_, k) => (lower[row]?.[k] ?? 0) * (lower[col]?.[k] ?? 0)).reduce((sum, value) => sum + value, 0),
    ),
  );
  const rhs = Array.from({ length: dimension }, () => [random() * 2 - 1]);
  const expected = solveTs(normal, rhs);
  const actual = wasm.solveCorrection(normal, rhs);
  const maxDifference = Math.max(...actual.correction.map((row, index) => Math.abs((row[0] ?? 0) - (expected.correction[index]?.[0] ?? 0))));
  if (maxDifference > 1e-12 || actual.damping !== expected.damping || actual.dampingAttempts !== expected.attempts) {
    throw new Error(`WASM parity failed at n=${dimension}: max=${maxDifference}, damping=${actual.damping}/${expected.damping}, attempts=${actual.dampingAttempts}/${expected.attempts}`);
  }
  console.log(`WASM parity n=${dimension}: max correction difference ${maxDifference}`);
}

const zero = [[0, 0], [0, 0]];
const zeroRhs = [[1], [2]];
const expectedZero = solveTs(zero, zeroRhs);
const actualZero = wasm.solveCorrection(zero, zeroRhs);
if (Math.abs(actualZero.damping - expectedZero.damping) > 1e-24 || actualZero.dampingAttempts !== expectedZero.attempts) {
  throw new Error(`WASM damping parity failed: ${actualZero.damping}/${expectedZero.damping}, ${actualZero.dampingAttempts}/${expectedZero.attempts}`);
}
console.log(`WASM damping parity: lambda=${actualZero.damping}, attempts=${actualZero.dampingAttempts}`);

let failureReported = false;
try {
  wasm.solveCorrection([[Number.NaN]], [[1]]);
} catch (error) {
  failureReported = String(error).includes('non-finite') || String(error).includes('finite');
}
if (!failureReported) throw new Error('WASM non-finite failure mapping was not reported.');
console.log('WASM dense differential parity passed for n=1,2,5,10,25,50,100.');
