/**
 * Phase 15C evidence: default-session (auto) native full-Qxx benchmark, Model A (real WASM).
 *
 * EVIDENCE ONLY — measurement, no production changes, no copy optimization
 * (§30). Compares admitted AUTO sessions against forced clean-TypeScript
 * (route bypass) and suspectImpact-OFF native (single-solve overhead
 * baseline) on the representative large 3D ladder (gps-3d-64 ~192 params,
 * gps-3d-128 ~384 params, committed generator seeds + gps-covariance
 * variant) and on scaled-up Phase 15C exact-truth networks at matching
 * param counts (seeded 1/3-sigma micro-noise; deterministic).
 *
 * Achievable shapes (§23, verified empirically — NOT assumed):
 * - 0-candidate: only the tiny helper network (posterior-scaled stdRes is
 *   ~N(0,1), so max-of-~450 can never stay under the |StdRes| >= 2 gate at
 *   scale; holds across noise fracs 0..1 and generator seeds 7/42/100/
 *   2364/2381 — every large clean network yields the capped 3).
 * - 1-candidate: helper network + scaled-192 (single GPS +0.5 m bias;
 *   scaled-384 yields 2 — the bias inflates SEUW less at 384 params so the
 *   natural tail survives; reported as the B' 2-candidate variant).
 * - 3-candidate: everywhere (generator clean output is naturally 3).
 *
 * Protocol per matrix row: 2 untimed WASM/JIT warm-ups, then medians of 5
 * timed runs (total session wall, route, captured systems count).
 * Verification cost is broken out where measurable via a diagnostic-only
 * createNativeFullQxxVerificationTiming collector (production call sites
 * pass nothing; collector on/off bit-identity proven in Phase 10K).
 * Perf verdicts use hard asserts (fail on >5% regression) on all certified
 * LARGE shapes; only the tiny H0 timer-floor comparison stays soft. Correctness
 * (route, acceptance, systems == rows+1, success) uses hard asserts.
 */
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

import { runAdjustmentSession } from '../../src/engine/runSession';
import type { RunSessionRequest } from '../../src/engine/runSessionTypes';
import type { SparseSelectedCovarianceSolver } from '../../src/engine/numericalBackend';
import {
  applyPhase6LargeVariant,
  generatePhase6Large3dInput,
} from '../../src/engine/phase6BenchmarkNetworks';
import { createExperimentalSparseNumericalBundle } from '../../src/engine/wasm/experimentalSparseNumericalBundle';
import type { WebNetWasmFactory } from '../../src/engine/wasm/wasmTypes';
import type { AdjustmentResult } from '../../src/typesAdjustmentResult';
import {
  createNativeFullQxxVerificationTiming,
  NativeFullQxxCaptureSolver,
  runWithNativeFullQxxAutoRoute,
  setNativeFullQxxRouteEnabled,
  type NativeFullQxxVerificationTiming,
} from '../../src/workers/adjustmentNativeFullQxxAutoRoute';
import { createRunSessionRequest } from '../helpers/runSessionRequest';
import {
  buildMinimal3dInput,
  buildScaledExact3dInput,
} from '../helpers/phase15cSessionNetworks';

const WARMUP = 2;
const TIMED = 5;

let bundle: { sparseSelectedCovarianceSolver: SparseSelectedCovarianceSolver } | null = null;
const loadBundle = async () => {
  if (bundle) return bundle as never;
  const mod = (await import(
    pathToFileURL(`${process.cwd()}/cpp/build-wasm/webnet_core.js`).href
  )) as { default: WebNetWasmFactory };
  const real = await createExperimentalSparseNumericalBundle(mod.default);
  bundle = { sparseSelectedCovarianceSolver: real.sparseSelectedCovarianceSolver };
  return bundle as never;
};

const median = (xs: number[]): number => {
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

const requestFor = (
  input: string,
  suspectImpactMode: 'off' | 'auto',
): RunSessionRequest => {
  const base = createRunSessionRequest({ input });
  return {
    ...base,
    parseSettings: { ...base.parseSettings, coordMode: '3D' as const, suspectImpactMode },
  };
};

const generatorInput = (id: string, unknownCount: number, seed: number): string => {
  const raw = generatePhase6Large3dInput({
    id,
    family: 'gps-2d',
    unknownCount,
    seed,
    variant: 'gps-covariance',
    dimension: '3d',
  });
  return applyPhase6LargeVariant(raw, 'gps-covariance');
};

interface MatrixRow {
  label: string;
  input: string;
  mode: 'auto' | 'off' | 'forced-ts';
  expectedRows: number;
}

const INPUTS = {
  h0: buildMinimal3dInput(),
  h1: buildMinimal3dInput({ gpsEErr: 0.5 }),
  s192b: buildScaledExact3dInput(64, { gpsErrStations: [1] }),
  s192c: buildScaledExact3dInput(64, { gpsErrStations: [1, 2, 3] }),
  s384b: buildScaledExact3dInput(128, { gpsErrStations: [1] }),
  s384c: buildScaledExact3dInput(128, { gpsErrStations: [1, 2, 3] }),
  g192: generatorInput('gps-3d-64', 64, 2364),
  g384: generatorInput('gps-3d-128', 128, 2381),
};

const MATRIX: MatrixRow[] = [
  { label: 'H0/A AUTO-0', input: INPUTS.h0, mode: 'auto', expectedRows: 0 },
  { label: 'H0/D forced-TS', input: INPUTS.h0, mode: 'forced-ts', expectedRows: 0 },
  { label: 'H0/E OFF-native', input: INPUTS.h0, mode: 'off', expectedRows: 0 },
  { label: 'H1/B AUTO-1', input: INPUTS.h1, mode: 'auto', expectedRows: 1 },
  { label: 'S192/B AUTO-1', input: INPUTS.s192b, mode: 'auto', expectedRows: 1 },
  { label: 'S192/C AUTO-3', input: INPUTS.s192c, mode: 'auto', expectedRows: 3 },
  { label: 'S192/D forced-TS', input: INPUTS.s192c, mode: 'forced-ts', expectedRows: 3 },
  { label: 'S192/E OFF-native', input: INPUTS.s192c, mode: 'off', expectedRows: 0 },
  { label: 'G192/C AUTO-3', input: INPUTS.g192, mode: 'auto', expectedRows: 3 },
  { label: 'G192/D forced-TS', input: INPUTS.g192, mode: 'forced-ts', expectedRows: 3 },
  { label: 'G192/E OFF-native', input: INPUTS.g192, mode: 'off', expectedRows: 0 },
  // S384/B' yields 2 candidates (documented §23 deviation, not 1).
  { label: "S384/B' AUTO-2", input: INPUTS.s384b, mode: 'auto', expectedRows: 2 },
  { label: 'S384/C AUTO-3', input: INPUTS.s384c, mode: 'auto', expectedRows: 3 },
  { label: 'S384/D forced-TS', input: INPUTS.s384c, mode: 'forced-ts', expectedRows: 3 },
  { label: 'S384/E OFF-native', input: INPUTS.s384c, mode: 'off', expectedRows: 0 },
  { label: 'G384/C AUTO-3', input: INPUTS.g384, mode: 'auto', expectedRows: 3 },
  { label: 'G384/D forced-TS', input: INPUTS.g384, mode: 'forced-ts', expectedRows: 3 },
  { label: 'G384/E OFF-native', input: INPUTS.g384, mode: 'off', expectedRows: 0 },
];

const canonicalRows = (result: AdjustmentResult): string =>
  JSON.stringify(
    (result.suspectImpactDiagnostics ?? []).map((row) => {
      const { elapsedMs: _dropped, ...stable } = row;
      return stable;
    }),
  );

describe('Phase 15C default-session benchmark (real WASM)', () => {
  it('matrix: median session walls per fixture x case', async () => {
    setNativeFullQxxRouteEnabled(true);
    const walls = new Map<string, number>();
    for (const row of MATRIX) {
      const request = requestFor(row.input, row.mode === 'forced-ts' ? 'auto' : row.mode);
      const runOnce = async (): Promise<{ wallMs: number; route: string; systems: number; rows: number }> => {
        const t = performance.now();
        if (row.mode === 'forced-ts') {
          const outcome = runAdjustmentSession(request, undefined, undefined);
          return {
            wallMs: performance.now() - t,
            route: 'typescript',
            systems: 0,
            rows: outcome.result.suspectImpactDiagnostics?.length ?? -1,
          };
        }
        const attempt = await runWithNativeFullQxxAutoRoute(request, undefined, {
          runSession: runAdjustmentSession,
          loadBundle,
        });
        expect(attempt.outcome.result.success, `${row.label}: session must succeed`).toBe(true);
        expect(attempt.route, `${row.label}: must take the native route`).toBe('native-full-qxx');
        expect(attempt.verification?.accepted, `${row.label}: C1/C2/C3 must accept`).toBe(true);
        const rows = attempt.outcome.result.suspectImpactDiagnostics?.length ?? 0;
        expect(rows, `${row.label}: candidate rows`).toBe(row.expectedRows);
        const systems = attempt.verification?.oracledSystemCount ?? -1;
        expect(systems, `${row.label}: captured systems == rows+1`).toBe(rows + 1);
        return { wallMs: performance.now() - t, route: attempt.route, systems, rows };
      };
      for (let i = 0; i < WARMUP; i += 1) await runOnce();
      const timed: number[] = [];
      let last = { route: '', systems: 0, rows: 0 };
      for (let i = 0; i < TIMED; i += 1) {
        const r = await runOnce();
        timed.push(r.wallMs);
        last = r;
      }
      const med = median(timed);
      walls.set(row.label, med);
      console.log(
        `15C bench ${row.label}: median ${med.toFixed(1)}ms ` +
          `(runs ${timed.map((w) => w.toFixed(0)).join('/')}) route=${last.route} systems=${last.systems} rows=${last.rows}`,
      );
    }
    const verdict = (label: string, a: string, b: string, context: string, hard = true): void => {
      const medA = walls.get(a) ?? NaN;
      const medB = walls.get(b) ?? NaN;
      const ratioAB = medA / medB;
      const pct = ((ratioAB - 1) * 100).toFixed(1);
      // Timer-significance floor: sub-millisecond deltas on toy-scale
      // sessions are quantization, not regressions — report, don't fail.
      // The 1ms floor reflects performance.now() quantization plus JIT/GC
      // jitter, which dominates walls under ~10ms; deltas below it carry
      // no regression signal at any ratio. Only the tiny H0 helper net
      // lives down here; every certified LARGE shape (S192/G192/S384/G384)
      // has walls far above the floor, so its ≤1.05 check is a HARD expect.
      if (Math.abs(medA - medB) < 1) {
        console.log(
          `15C verdict ${label}: INCONCLUSIVE (Δ ${Math.abs(medA - medB).toFixed(2)}ms < 1ms floor; ` +
            `ratio ${ratioAB.toFixed(3)}, medians ${medA.toFixed(1)} vs ${medB.toFixed(1)}ms — ${context})`,
        );
        return;
      }
      const go = ratioAB <= 1.05;
      console.log(`15C verdict ${label}: ${go ? 'GO' : 'NO-GO'} (ratio ${ratioAB.toFixed(3)}, ${pct}% ${context})`);
      if (hard) {
        expect(go, `${label}: >5% regression (${pct}%; ${context})`).toBe(true);
      } else {
        expect.soft(go, `${label}: >5% regression (${pct}%; ${context})`).toBe(true);
      }
    };
    const ratio = (a: string, b: string): number => (walls.get(a) ?? NaN) / (walls.get(b) ?? NaN);
    // §24: zero-candidate AUTO ~= OFF-native (both single-solve; delta = suspect screening + verification).
    // Tiny H0 helper net: timer-floor case, stays soft (see 1ms floor above).
    verdict('H0/A-vs-E', 'H0/A AUTO-0', 'H0/E OFF-native', 'AUTO-0 vs OFF-native', false);
    // §24: multi-solve total session vs forced-TS.
    verdict('S192/C-vs-D', 'S192/C AUTO-3', 'S192/D forced-TS', 'AUTO-3 vs forced-TS @192');
    verdict('G192/C-vs-D', 'G192/C AUTO-3', 'G192/D forced-TS', 'AUTO-3 vs forced-TS @192 generator');
    verdict('S384/C-vs-D', 'S384/C AUTO-3', 'S384/D forced-TS', 'AUTO-3 vs forced-TS @384');
    verdict('G384/C-vs-D', 'G384/C AUTO-3', 'G384/D forced-TS', 'AUTO-3 vs forced-TS @384 generator');
    verdict('S192/B-vs-D', 'S192/B AUTO-1', 'S192/D forced-TS', 'AUTO-1 vs forced-TS-3 @192');
    console.log(
      `15C overhead OFF-vs-TS: S192 ${(ratio('S192/E OFF-native', 'S192/D forced-TS') * 100).toFixed(1)}%, ` +
        `G192 ${(ratio('G192/E OFF-native', 'G192/D forced-TS') * 100).toFixed(1)}%, ` +
        `S384 ${(ratio('S384/E OFF-native', 'S384/D forced-TS') * 100).toFixed(1)}%, ` +
        `G384 ${(ratio('G384/E OFF-native', 'G384/D forced-TS') * 100).toFixed(1)}% ` +
        `(single-solve native as % of 4-solve TS session)`,
    );
  }, 900000);

  it('verification breakdown + memory/capture report', async () => {
    setNativeFullQxxRouteEnabled(true);
    const mod = (await import(
      pathToFileURL(`${process.cwd()}/cpp/build-wasm/webnet_core.js`).href
    )) as { default: WebNetWasmFactory };
    const real = await createExperimentalSparseNumericalBundle(mod.default);
    const promotion: Record<string, { input: string; mode: 'auto' | 'off'; systems: number }> = {
      'S192-1': { input: INPUTS.s192b, mode: 'auto', systems: 2 },
      'S192-3': { input: INPUTS.s192c, mode: 'auto', systems: 4 },
      'S384-3': { input: INPUTS.s384c, mode: 'auto', systems: 4 },
    };
    for (const [label, cfg] of Object.entries(promotion)) {
      const request = requestFor(cfg.input, cfg.mode);
      const buckets: NativeFullQxxVerificationTiming[] = [];
      const walls: number[] = [];
      let peakBytes = 0;
      let systemCount = 0;
      for (let i = 0; i < WARMUP + TIMED; i += 1) {
        const timing = createNativeFullQxxVerificationTiming();
        const before = { ...timing };
        const capture = new NativeFullQxxCaptureSolver(real.sparseSelectedCovarianceSolver, timing);
        const deps = {
          runSession: runAdjustmentSession,
          loadBundle: async () => ({
            sparseCorrectionSolver: real.sparseCorrectionSolver,
            sparseRowProductsSolver: real.sparseRowProductsSolver,
            sparseSelectedCovarianceSolver: capture,
          }),
        };
        const t = performance.now();
        const attempt = await runWithNativeFullQxxAutoRoute(request, undefined, deps);
        const wall = performance.now() - t;
        expect(attempt.route, `${label}: native route`).toBe('native-full-qxx');
        expect(attempt.verification?.accepted, `${label}: accepted`).toBe(true);
        expect(attempt.verification?.oracledSystemCount, `${label}: systems`).toBe(cfg.systems);
        // Captures released: no captured buffer reachable from the attempt.
        const buffers = new Set<ArrayBuffer>();
        for (const s of capture.systems) {
          for (const view of [
            s.design.rowOffsets, s.design.columns, s.design.values,
            s.weights.rows, s.weights.columns, s.weights.values,
            s.queryRows, s.queryColumns, s.result.covariance,
          ] as ArrayLike<unknown>[]) {
            const buf = (view as { buffer?: ArrayBuffer }).buffer;
            if (buf) buffers.add(buf);
          }
        }
        const leaked: string[] = [];
        const seen = new Set<object>();
        const walk = (value: unknown, path: string): void => {
          if (!value || typeof value !== 'object' || seen.has(value) || path.length > 400) return;
          seen.add(value);
          if (value instanceof ArrayBuffer) {
            if (buffers.has(value)) leaked.push(path);
            return;
          }
          if (ArrayBuffer.isView(value)) {
            if (buffers.has((value as { buffer: ArrayBuffer }).buffer)) leaked.push(path);
            return;
          }
          if (Array.isArray(value)) {
            value.forEach((item, index) => walk(item, `${path}[${index}]`));
            return;
          }
          for (const [key, item] of Object.entries(value)) {
            if (key === 'systems' || key === 'capture') leaked.push(`${path}.${key}`);
            walk(item, `${path}.${key}`);
          }
        };
        walk({ outcome: attempt.outcome, verification: attempt.verification }, 'attempt');
        expect(leaked, `${label}: captured buffers must not be retained post-session`).toEqual([]);
        const bytes = capture.systems.reduce((sum, s) => sum
          + s.design.rowOffsets.byteLength + s.design.columns.byteLength + s.design.values.byteLength
          + s.weights.rows.byteLength + s.weights.columns.byteLength + s.weights.values.byteLength
          + s.queryRows.byteLength + s.queryColumns.byteLength + s.result.covariance.byteLength, 0);
        if (i >= WARMUP) {
          const delta = createNativeFullQxxVerificationTiming();
          for (const key of Object.keys(delta) as (keyof NativeFullQxxVerificationTiming)[]) {
            delta[key] = timing[key] - before[key];
          }
          buckets.push(delta);
          walls.push(wall);
        }
        peakBytes = bytes;
        systemCount = capture.systems.length;
      }
      const medBucket = createNativeFullQxxVerificationTiming();
      for (const key of Object.keys(medBucket) as (keyof NativeFullQxxVerificationTiming)[]) {
        medBucket[key] = median(buckets.map((b) => b[key]));
      }
      console.log(
        `15C verify ${label}: session ${median(walls).toFixed(1)}ms, ` +
          `copy ${medBucket.captureCopyMs.toFixed(2)}ms, ` +
          `oracleBuild ${medBucket.oracleBuildMs.toFixed(2)}ms, ` +
          `c1 ${medBucket.c1Ms.toFixed(2)}ms, c2 ${medBucket.c2Ms.toFixed(2)}ms, ` +
          `c3 ${medBucket.c3PhysicalMs.toFixed(2)}ms, ` +
          `scaffold ${medBucket.finiteScanConvertMs.toFixed(2)}/${medBucket.queryBuildMs.toFixed(2)}/` +
          `${medBucket.oracleProbeMs.toFixed(2)}/${medBucket.nativeIndexMs.toFixed(2)}ms ` +
          `(finiteScan/queryBuild/oracleProbe/nativeIndex), ` +
          `systems=${medBucket.systemsVerified} factorizations=${medBucket.factorizations} solves=${medBucket.solves}`,
      );
      console.log(
        `15C memory ${label}: ${systemCount} systems, peak theoretical ${(peakBytes / 1048576).toFixed(2)} MiB ` +
          `(packed + Qxx bytes), ${(peakBytes / systemCount / 1024).toFixed(1)} KiB/system, released post-session`,
      );
    }
  }, 900000);

  it('determinism replay + progress audit', async () => {
    setNativeFullQxxRouteEnabled(true);
    const request = requestFor(INPUTS.s192b, 'auto');
    const runReplay = async (): Promise<{ order: string; rows: string; route: string }> => {
      const attempt = await runWithNativeFullQxxAutoRoute(request, undefined, {
        runSession: runAdjustmentSession,
        loadBundle,
      });
      expect(attempt.route).toBe('native-full-qxx');
      const order = (attempt.outcome.result.suspectImpactDiagnostics ?? []).map((r) => r.obsId).join(',');
      return { order, rows: canonicalRows(attempt.outcome.result), route: attempt.route };
    };
    const replays = [await runReplay(), await runReplay(), await runReplay()];
    expect(replays[1]?.order, 'candidate order run2 == run1').toBe(replays[0]?.order);
    expect(replays[2]?.order, 'candidate order run3 == run1').toBe(replays[0]?.order);
    expect(replays[1]?.rows, 'LOO rows run2 == run1').toBe(replays[0]?.rows);
    expect(replays[2]?.rows, 'LOO rows run3 == run1').toBe(replays[0]?.rows);
    expect(replays[1]?.route, 'route run2 == run1').toBe(replays[0]?.route);
    expect(replays[2]?.route, 'route run3 == run1').toBe(replays[0]?.route);
    console.log(`15C determinism: 3x admitted AUTO-1 identical (order ${replays[0]?.order}, route ${replays[0]?.route})`);

    const progressRequest = requestFor(INPUTS.s192c, 'auto');
    const collectProgress = async (): Promise<string[]> => {
      const events: string[] = [];
      await runWithNativeFullQxxAutoRoute(
        progressRequest,
        (event) => {
          events.push(`${event.phase}:${event.stageId}:${event.solveIndex}/${event.solveTotalHint}`);
        },
        { runSession: runAdjustmentSession, loadBundle },
      );
      return events;
    };
    const first = await collectProgress();
    const second = await collectProgress();
    expect(second, 'progress sequence deterministic across runs').toEqual(first);
    const finalizing = first.filter((e) => e.startsWith('finalizing:'));
    expect(finalizing.length, 'exactly one finalizing event').toBe(1);
    expect(first[first.length - 1]?.startsWith('finalizing:'), 'finalizing is the last event').toBe(true);
    console.log(`15C progress: ${first.length} events deterministic, 1 finalizing last: [${first.join(' | ')}]`);
  }, 900000);

  it('14F.1 stale-run check: existing latestRunId suites pass untouched', () => {
    // Runs the committed suites in a child process — reported here, never reimplemented.
    let output = '';
    try {
      output = execFileSync(
        'npx',
        ['vitest', 'run', 'tests/adjustment_runner.test.tsx', 'tests/adjustment_runner_race.test.tsx'],
        { encoding: 'utf8', timeout: 300000, stdio: ['ignore', 'pipe', 'pipe'] },
      );
    } catch (error) {
      const detail = error as { stdout?: string; stderr?: string; message?: string };
      console.log(`15C 14F.1 child output:\n${detail.stdout ?? ''}\n${detail.stderr ?? ''}`);
      throw new Error(`14F.1 latestRunId suites failed: ${detail.message ?? String(error)}`);
    }
    const tail = output.trim().split('\n').slice(-6).join('\n');
    console.log(`15C 14F.1 latestRunId suites PASS untouched:\n${tail}`);
    expect(output).toContain('Test Files  2 passed');
  }, 600000);
});
