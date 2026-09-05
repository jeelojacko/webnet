import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { LSAEngine } from '../../src/engine/adjust';
import { WasmSparseNormalEquationSolver } from '../../src/engine/wasm/wasmSparseNormalSolver';
import { loadWebNetWasm } from '../../src/engine/wasm/wasmModule';
import type { WebNetWasmFactory } from '../../src/engine/wasm/wasmTypes';

type Case = { id: string; fixture: string; profile: 'default' | 'industry-parity' };
const cases = JSON.parse(readFileSync('benchmarks/fixtures/adjustment-cases.json', 'utf8')) as Case[];
const imported = (await import(pathToFileURL(`${process.cwd()}/cpp/build-wasm/webnet_core.js`).href)) as { default: WebNetWasmFactory };
const module = await loadWebNetWasm(imported.default);
if (!module) throw new Error('WASM module failed to initialize.');
const sparseSolver = new WasmSparseNormalEquationSolver(module);
const industryLibrary = { __INDUSTRY_DEFAULT__: { code: '__INDUSTRY_DEFAULT__', desc: 'Benchmark default', edm_const: 0.001, edm_ppm: 1, hzPrecision_sec: 0.5, dirPrecision_sec: 0.5, azBearingPrecision_sec: 0.5, vaPrecision_sec: 0.5, instCentr_m: 0.0005, tgtCentr_m: 0, vertCentr_m: 0, elevDiff_const_m: 0, elevDiff_ppm: 0, gpsStd_xy: 0, levStd_mmPerKm: 0 } };
const solve = (input: string, profile: Case['profile'], sparse = false) => new LSAEngine({ input, maxIterations: 15, convergenceThreshold: 0.001, ...(profile === 'industry-parity' ? { instrumentLibrary: industryLibrary, parseOptions: { currentInstrument: '__INDUSTRY_DEFAULT__', directionSetMode: 'raw' as const, robustMode: 'none' as const, tsCorrelationEnabled: false, clusterDetectionEnabled: false, geometryDependentSigmaReference: 'initial' as const } } : {}), ...(sparse ? { sparseCorrectionSolver: sparseSolver } : {}) }).solve();
const measure = (run: () => void): number => { run(); return Math.min(...Array.from({ length: 3 }, () => { const start = performance.now(); run(); return performance.now() - start; })); };
console.log('| Case | Stations | Obs | Unknowns | Iterations | TS ms | Sparse WASM ms |');
console.log('|---|---:|---:|---:|---:|---:|---:|');
for (const benchmarkCase of cases) {
  const input = readFileSync(benchmarkCase.fixture, 'utf8');
  const reference = solve(input, benchmarkCase.profile);
  const sparse = solve(input, benchmarkCase.profile, true);
  if (sparse.iterations !== reference.iterations || sparse.dof !== reference.dof) throw new Error(`${benchmarkCase.id} sparse result diverged`);
  const tsMs = measure(() => { solve(input, benchmarkCase.profile); });
  const sparseMs = measure(() => { solve(input, benchmarkCase.profile, true); });
  console.log(`| ${benchmarkCase.id} | ${Object.keys(reference.stations).length} | ${reference.observations.length} | ${Math.max(0, reference.observations.length - reference.dof)} | ${reference.iterations} | ${tsMs.toFixed(2)} | ${sparseMs.toFixed(2)} |`);
}
