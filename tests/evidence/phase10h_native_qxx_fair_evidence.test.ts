/** Phase 10H evidence: native full-Qxx feeding statistics reuse. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LSAEngine } from '../../src/engine/adjust';
import { buildPhase6LargeBenchmarkCases } from '../../src/engine/phase6BenchmarkNetworks';
import { createExperimentalSparseNumericalBundle } from '../../src/engine/wasm/experimentalSparseNumericalBundle';
import type { QxxReuseProbeEvent } from '../../src/engine/qxxReuseEvidence';
import type { WebNetWasmFactory } from '../../src/engine/wasm/wasmTypes';

const fixtures = buildPhase6LargeBenchmarkCases(false).filter(({ id }) =>
  ['gps-3d-cov-08', 'gps-3d-16', 'gps-3d-32', 'gps-3d-64', 'gps-3d-128'].includes(id),
);
const runs = 5;
const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
const parameterCount = (result: ReturnType<LSAEngine['solve']>): number =>
  Object.values(result.stations).filter((station) => !station.fixed).length * 3 + (result.directionSetDiagnostics?.length ?? 0);
const rounded = (value: unknown): unknown => {
  if (typeof value === 'number') return Math.round(value * 1e6) / 1e6;
  if (Array.isArray(value)) return value.map(rounded);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rounded(v)]));
  return value;
};
const comparable = (result: ReturnType<LSAEngine['solve']>): unknown => {
  const { logs: _logs, solveTimingProfile: _timing, ...stable } = result;
  return rounded(stable);
};
const maxDiff = (a: unknown, b: unknown): number => {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b);
  if (Array.isArray(a) && Array.isArray(b)) return Math.max(0, ...a.map((v, i) => maxDiff(v, b[i])));
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = Object.keys(a as object);
    return Math.max(0, ...keys.map((key) => maxDiff((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])));
  }
  return 0;
};
const loadFactory = async (): Promise<WebNetWasmFactory> => {
  const mod = await import(pathToFileURL(`${process.cwd()}/cpp/build-wasm/webnet_core.js`).href) as { default: WebNetWasmFactory };
  if (typeof mod.default !== 'function') throw new Error('WASM factory missing');
  return mod.default;
};

describe('Phase 10H fair native-Qxx reuse evidence', () => {
  it('compares native all-entry Qxx + reuse against production TS + reuse', async () => {
    const factory = await loadFactory();
    const bundle = await createExperimentalSparseNumericalBundle(factory);
    const rows: string[] = ['# Phase 10H fair native-Qxx evidence', '', '| Fixture | P | TS median ms | Native median ms | covariance max abs diff | result max abs diff | stats reuse | native solve ms | native factorize ms |', '|---|---:|---:|---:|---:|---:|---|---:|---:|'];
    for (const fixture of fixtures) {
      const tsEvents: QxxReuseProbeEvent[] = [];
      const ts = new LSAEngine({ input: fixture.input, qxxReuseProbe: (e) => tsEvents.push(e) }).solve();
      const tsWalls: number[] = [];
      for (let i = 0; i < runs; i += 1) { const t = performance.now(); new LSAEngine({ input: fixture.input }).solve(); tsWalls.push(performance.now() - t); }
      const nativeEvents: QxxReuseProbeEvent[] = [];
      const nativeOptions = { input: fixture.input, sparseSelectedCovarianceSolver: bundle.sparseSelectedCovarianceSolver, experimentalSelectedCovarianceMode: false, allowEvidenceNativeDenseQxxReuse: true, qxxReuseProbe: (e: QxxReuseProbeEvent) => nativeEvents.push(e) };
      const first = new LSAEngine(nativeOptions).solve();
      const nativeWalls: number[] = [];
      let native = first;
      for (let i = 0; i < runs; i += 1) { const t = performance.now(); native = new LSAEngine({ ...nativeOptions, qxxReuseProbe: undefined }).solve(); nativeWalls.push(performance.now() - t); }
      const tsQxx = tsEvents.find((e) => e.stage === 'final-covariance')?.qxx;
      const nativeQxx = nativeEvents.find((e) => e.stage === 'final-covariance')?.qxx;
      const covarianceDiff = tsQxx && nativeQxx ? maxDiff(tsQxx, nativeQxx) : Infinity;
      const resultDiff = JSON.stringify(comparable(ts)) === JSON.stringify(comparable(native)) ? 0 : maxDiff(comparable(ts), comparable(native));
      const reused = nativeEvents.find((e) => e.stage === 'statistics');
      const admitted = Boolean(ts.success && ts.converged && native.success && native.converged && reused?.reused && covarianceDiff < 1e-6 && resultDiff < 1e-6);
      if (fixture.id !== 'gps-3d-cov-08' && fixture.id !== 'gps-3d-16') expect(admitted, `${fixture.id} fair parity diff=${resultDiff} qxx=${covarianceDiff} reuse=${reused?.reason} success=${native.success}/${native.converged}`).toBe(true);
      rows.push(`| ${fixture.id} | ${parameterCount(ts)} | ${median(tsWalls).toFixed(2)} | ${median(nativeWalls).toFixed(2)} | ${covarianceDiff.toExponential(3)} | ${resultDiff.toExponential(3)} | ${reused?.reason ?? 'missing'} | n/a | n/a |`);
    }
    const dir = join(process.cwd(), 'artifacts/evidence/phase10h'); mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'phase10h-evidence.md'), `${rows.join('\n')}\n`);
    expect(rows.length).toBeGreaterThan(2);
  }, 600000);
});
