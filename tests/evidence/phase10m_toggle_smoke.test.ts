/**
 * Phase 10M evidence: default-ON production-toggle perf smoke (manual-only).
 *
 * TS-vs-native walls for gps-3d-32/64/128 through the REAL WASM bundle with
 * the route at its production default (NO kill-switch setter call anywhere
 * in this file). Observational only: asserts NOTHING about timing, only
 * that both arms succeed, the native arm routes `native-full-qxx` with
 * C1/C2/C3 accepted, and the classification note is recorded. Writes
 * machine output to `artifacts/evidence/phase10m-toggle/` (gitignored).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

import { buildPhase6LargeBenchmarkCases } from '../../src/engine/phase6BenchmarkNetworks';
import { createExperimentalSparseNumericalBundle } from '../../src/engine/wasm/experimentalSparseNumericalBundle';
import type { WebNetWasmFactory } from '../../src/engine/wasm/wasmTypes';
import { runAdjustmentSession } from '../../src/engine/runSession';
import {
  isNativeFullQxxRouteEnabled,
  runWithNativeFullQxxAutoRoute,
} from '../../src/workers/adjustmentNativeFullQxxAutoRoute';
import { createRunSessionRequest } from '../helpers/runSessionRequest';

const FIXTURE_IDS = ['gps-3d-32', 'gps-3d-64', 'gps-3d-128'];
const fixtures = buildPhase6LargeBenchmarkCases(false).filter(({ id }) =>
  FIXTURE_IDS.includes(id),
);
if (fixtures.length !== 3) throw new Error('Missing genuine 3D ladder fixtures.');
const RUNS = 5;

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;

const loadFactory = async (): Promise<WebNetWasmFactory> => {
  const mod = (await import(
    pathToFileURL(`${process.cwd()}/cpp/build-wasm/webnet_core.js`).href
  )) as { default: WebNetWasmFactory };
  if (typeof mod.default !== 'function') throw new Error('WASM factory missing');
  return mod.default;
};

describe('Phase 10M default-ON toggle perf smoke', () => {
  it('records TS-vs-native walls with the production default (no timing asserts)', async () => {
    expect(isNativeFullQxxRouteEnabled()).toBe(true);
    const factory = await loadFactory();
    const bundle = await createExperimentalSparseNumericalBundle(factory);
    const rows: Record<string, unknown>[] = [];
    const lines = [
      '# Phase 10M default-ON toggle perf smoke',
      '',
      'TS vs native walls with the production default (kill switch untouched).',
      'Observational only — no timing assertions. Expected classification per',
      'Phase 10M certification: 32 tiny regression ok, 64 parity, 128 clear win.',
      '',
      '| Fixture | TS median ms | Native median ms | Ratio | Route | C1/C2/C3 |',
      '|---|---:|---:|---:|---|---|',
    ];
    for (const fixture of fixtures) {
      const base = createRunSessionRequest({ input: fixture.input });
      const request = {
        ...base,
        parseSettings: { ...base.parseSettings, coordMode: '3D' as const, suspectImpactMode: 'off' as const },
      };
      runAdjustmentSession(request, undefined, undefined);
      const tsWalls: number[] = [];
      for (let i = 0; i < RUNS; i += 1) {
        const t = performance.now();
        const outcome = runAdjustmentSession(request, undefined, undefined);
        tsWalls.push(performance.now() - t);
        expect(outcome.result.success).toBe(true);
      }
      const deps = {
        runSession: runAdjustmentSession,
        loadBundle: async () => ({
          sparseCorrectionSolver: bundle.sparseCorrectionSolver,
          sparseRowProductsSolver: bundle.sparseRowProductsSolver,
          sparseSelectedCovarianceSolver: bundle.sparseSelectedCovarianceSolver,
        }),
      };
      await runWithNativeFullQxxAutoRoute(request, undefined, deps);
      const nativeWalls: number[] = [];
      let attempt = await runWithNativeFullQxxAutoRoute(request, undefined, deps);
      for (let i = 0; i < RUNS; i += 1) {
        const t = performance.now();
        attempt = await runWithNativeFullQxxAutoRoute(request, undefined, deps);
        nativeWalls.push(performance.now() - t);
      }
      expect(attempt.route).toBe('native-full-qxx');
      expect(attempt.verification?.accepted).toBe(true);
      const ts = median(tsWalls);
      const native = median(nativeWalls);
      const ratio = ts > 0 ? native / ts : Number.NaN;
      rows.push({ fixture: fixture.id, tsMedianMs: ts, nativeMedianMs: native, ratio, route: attempt.route });
      lines.push(`| ${fixture.id} | ${ts.toFixed(2)} | ${native.toFixed(2)} | ${ratio.toFixed(2)} | ${attempt.route} | accepted |`);
    }
    const dir = join(process.cwd(), 'artifacts/evidence/phase10m-toggle');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'phase10m-toggle-smoke.json'), `${JSON.stringify(rows, null, 1)}\n`);
    writeFileSync(join(dir, 'phase10m-toggle-smoke.md'), `${lines.join('\n')}\n`);
    expect(rows.length).toBe(3);
  }, 600000);
});
