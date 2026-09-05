import { execFileSync, execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { performance } from 'node:perf_hooks';

import { LSAEngine } from '../../src/engine/adjust';
import type { InstrumentLibrary } from '../../src/types';

type Case = { id: string; fixture: string; profile: 'default' | 'industry-parity' };
type Measurement = Case & { stations: number; observations: number; unknowns: number; dof: number; iterations: number; success: boolean; timesMs: number[]; medianMs: number; minimumMs: number; p95Ms: number; rssBeforeMb: number; rssAfterMb: number };

const cases = JSON.parse(readFileSync('benchmarks/fixtures/adjustment-cases.json', 'utf8')) as Case[];
const quick = process.argv.includes('--quick');
const writeBaseline = process.argv.includes('--write-baseline');
const warmups = Number(process.env.BENCH_WARMUPS ?? (quick ? 1 : 2));
const runs = Number(process.env.BENCH_RUNS ?? (quick ? 3 : 7));
const industryLibrary: InstrumentLibrary = { __INDUSTRY_DEFAULT__: { code: '__INDUSTRY_DEFAULT__', desc: 'Benchmark default', edm_const: 0.001, edm_ppm: 1, hzPrecision_sec: 0.5, dirPrecision_sec: 0.5, azBearingPrecision_sec: 0.5, vaPrecision_sec: 0.5, instCentr_m: 0.0005, tgtCentr_m: 0, vertCentr_m: 0, elevDiff_const_m: 0, elevDiff_ppm: 0, gpsStd_xy: 0, levStd_mmPerKm: 0 } };

const solve = (input: string, profile: Case['profile']) => new LSAEngine({ input, maxIterations: 15, convergenceThreshold: 0.001, ...(profile === 'industry-parity' ? { instrumentLibrary: industryLibrary, parseOptions: { currentInstrument: '__INDUSTRY_DEFAULT__', directionSetMode: 'raw', robustMode: 'none', tsCorrelationEnabled: false, clusterDetectionEnabled: false, geometryDependentSigmaReference: 'initial' as const } } : {}) }).solve();
const percentile = (values: number[], p: number) => values[Math.min(values.length - 1, Math.ceil(values.length * p) - 1)] ?? 0;
const summary = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); return { timesMs: sorted, medianMs: percentile(sorted, 0.5), minimumMs: sorted[0] ?? 0, p95Ms: percentile(sorted, 0.95) }; };
const cpu = (() => { try { return execFileSync('sh', ['-c', "grep -m1 'model name' /proc/cpuinfo | cut -d: -f2-"], { encoding: 'utf8' }).trim() || os.cpus()[0]?.model; } catch { return os.cpus()[0]?.model; } })();

const measurements: Measurement[] = cases.map((benchmarkCase) => {
  const input = readFileSync(benchmarkCase.fixture, 'utf8');
  for (let i = 0; i < warmups; i += 1) solve(input, benchmarkCase.profile);
  const times: number[] = [];
  const rssBefore = process.memoryUsage().rss;
  let result = solve(input, benchmarkCase.profile);
  for (let i = 0; i < runs; i += 1) { const start = performance.now(); result = solve(input, benchmarkCase.profile); times.push(performance.now() - start); }
  const stats = summary(times);
  return { ...benchmarkCase, stations: Object.keys(result.stations).length, observations: result.observations.length, unknowns: result.dof != null ? Math.max(0, result.observations.length - result.dof) : 0, dof: result.dof, iterations: result.iterations, success: result.converged, ...stats, rssBeforeMb: rssBefore / 1024 / 1024, rssAfterMb: process.memoryUsage().rss / 1024 / 1024 };
});
const metadata = { generatedAt: new Date().toISOString(), node: process.version, platform: `${process.platform}-${process.arch}`, os: `${os.type()} ${os.release()}`, cpu, gitCommit: execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim(), warmups, runs, quick };
const output = { metadata, cases: measurements };
mkdirSync('benchmarks/baselines', { recursive: true });
writeFileSync('benchmarks/baselines/typescript-latest.json', `${JSON.stringify(output, null, 2)}\n`);
const markdown = [`# TypeScript adjustment baseline`, ``, `Generated: ${metadata.generatedAt} · Node ${metadata.node} · ${metadata.platform} · ${metadata.cpu}`, `Commit: ${metadata.gitCommit} · warmups: ${warmups} · measured runs: ${runs}`, ``, `| Case | Stations | Obs | Unknowns | DOF | Iterations | Median ms | p95 ms | RSS after MiB |`, `| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |`, ...measurements.map((m) => `| ${m.id} | ${m.stations} | ${m.observations} | ${m.unknowns} | ${m.dof} | ${m.iterations} | ${m.medianMs.toFixed(2)} | ${m.p95Ms.toFixed(2)} | ${m.rssAfterMb.toFixed(1)} |`), ``].join('\n');
writeFileSync('benchmarks/baselines/typescript-latest.md', markdown);
if (writeBaseline) { writeFileSync('benchmarks/baselines/typescript-baseline.json', `${JSON.stringify(output, null, 2)}\n`); writeFileSync('benchmarks/baselines/typescript-baseline.md', markdown); }
console.log(markdown);
console.log(`Wrote benchmarks/baselines/typescript-latest.json${writeBaseline ? ' and committed baseline files' : ''}.`);
