/**
 * Phase 11A evidence: native 3D full-Qxx cohort widening certification.
 *
 * EVIDENCE ONLY (manual, never CI; registered in scripts/testTiers.ts).
 * Phase 11A-production widened the production constant
 * NATIVE_FULL_QXX_MAX_PARAMS 384 -> 768 (cap-only change); correction
 * stays OFF, and every production call site omits the diagnostic
 * `maxParams` seam (so all ordinary requests above 768 still route to
 * clean TypeScript). The pre-widening evidence (diagnostic maxParams=768
 * above a 384 production cap) is preserved in
 * reports/performance/phase11a-3d-cohort-widening.md; this file now
 * exercises the true default production route through the cap.
 *
 * Coverage (all 10M ON at 768, correction OFF throughout):
 * 1. Production cap proof: default admits to 768, rejects >768
 *    (TS-routed), diagnostic seam intact above the cap, correction OFF.
 * 2. Widening ladder (nearest-achievable 3D coord-only unknowns, actual n
 *    disclosed): 128u=384, 144u=432, 160u=480, 171u=513, 192u=576,
 *    213u=639, 235u=705, 256u=768. Arm A = pure TS, arm B = default
 *    production route. Full-result
 *    parity < 1e-6, C1/C2/C3 accepted with empty reasons, no damping /
 *    fallbacks / truncation. Records TS/native medians, ratio, absolute
 *    saving, Qxx bytes, verify maxC1/C2, per-part timing, heap/RSS.
 * 3. Boundary disclosure: 170u=510, 214u=642, 255u=765 (exact 511/512,
 *    640/641, 767/769 unreachable coord-only: 3*unknowns + CTRLA/B fixed).
 * 4. Multi-family breadth: 8 realistic variants at 128u
 *    + 4-variant subset at 213u (both production route), honest exclusions.
 * 5. Repeated-run pressure: 25x @384 + 10x @513 + 10x @639 (heap growth).
 * 6. Fallback matrix via production routing @639 (+ unit-level finalizer
 *    rejects): init-fail / throw / kill-switch / non-converge / non-finite
 *    / damped solver / NaN solver / truncation / malformed / count-mismatch
 *    all land clean TS with no native escape.
 * 7. <=768 production regression: 32u + 128u parity, constant intact.
 *
 * Writes raw machine output to artifacts/evidence/phase11a/ (gitignored)
 * plus browser fixtures to artifacts/evidence/phase11a-browser/.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

import { LSAEngine } from '../../src/engine/adjust';
import { createExperimentalSparseRouteDiagnostics } from '../../src/engine/experimentalSparseDiagnostics';
import { generatePhase6Large3dInput } from '../../src/engine/phase6BenchmarkNetworks';
import { createExperimentalSparseNumericalBundle } from '../../src/engine/wasm/experimentalSparseNumericalBundle';
import type { WebNetWasmFactory } from '../../src/engine/wasm/wasmTypes';
import type {
  SparseSelectedCovarianceInput,
  SparseSelectedCovarianceResult,
  SparseSelectedCovarianceSolver,
} from '../../src/engine/numericalBackend';
import { runAdjustmentSession } from '../../src/engine/runSession';
import {
  createNativeFullQxxVerificationTiming,
  deriveNativeFullQxxEligibility,
  finalizeNativeFullQxxVerification,
  isNative3dCorrectionRouteEnabled,
  NATIVE_FULL_QXX_MAX_PARAMS,
  NativeFullQxxCaptureSolver,
  runWithNativeFullQxxAutoRoute,
  setNativeFullQxxRouteEnabled,
  verifyNativeFullQxxSystems,
} from '../../src/workers/adjustmentNativeFullQxxAutoRoute';
import { createRunSessionRequest } from '../helpers/runSessionRequest';

const DIAG_MAX = 768;
const PARITY_TOL = 1e-6;
const LADDER_RUNS = 3;
const LADDER = [128, 144, 160, 171, 192, 213, 235, 256];
const BOUNDARIES = [170, 214, 255];

const sorted = (xs: number[]): number[] => [...xs].sort((a, b) => a - b);
const median = (xs: number[]): number => sorted(xs)[Math.floor(xs.length / 2)] ?? 0;
const quantile = (xs: number[], q: number): number => {
  const s = sorted(xs);
  return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))] ?? 0;
};
const stats = (xs: number[]) => ({ p25: quantile(xs, 0.25), median: median(xs), p75: quantile(xs, 0.75), raw: [...xs] });

const loadFactory = async (): Promise<WebNetWasmFactory> => {
  const mod = (await import(
    pathToFileURL(`${process.cwd()}/cpp/build-wasm/webnet_core.js`).href
  )) as { default: WebNetWasmFactory };
  if (typeof mod.default !== 'function') throw new Error('WASM factory missing');
  return mod.default;
};

const rounded = (value: unknown): unknown => {
  if (typeof value === 'number') return Math.round(value * 1e6) / 1e6;
  if (Array.isArray(value)) return value.map(rounded);
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rounded(v)]));
  return value;
};
const comparable = (result: unknown): unknown => {
  const rec = result as Record<string, unknown>;
  const { logs: _logs, solveTimingProfile: _timing, ...stable } = rec;
  const cleanLogs = Array.isArray(rec.logs)
    ? (rec.logs as string[]).filter((line) => !line.startsWith('Solve timing (ms):'))
    : [];
  return rounded({ ...stable, logs: cleanLogs });
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
const resultDiff = (a: unknown, b: unknown): number =>
  JSON.stringify(comparable(a)) === JSON.stringify(comparable(b)) ? 0 : maxDiff(comparable(a), comparable(b));

const ladderInput = (unknowns: number): string =>
  generatePhase6Large3dInput({ id: `gps-3d-m${unknowns}`, family: 'gps-2d', unknownCount: unknowns, seed: 3000 + unknowns, variant: 'gps-covariance', dimension: '3d' });

const toRequest = (input: string) => {
  const base = createRunSessionRequest({ input });
  return { ...base, parseSettings: { ...base.parseSettings, coordMode: '3D' as const, suspectImpactMode: 'off' as const } };
};

const memMB = (): { heapMB: number; rssMB: number } => {
  const m = process.memoryUsage();
  return { heapMB: m.heapUsed / 1048576, rssMB: m.rss / 1048576 };
};

const dropPrefixes = (input: string, prefixes: string[]): string =>
  input.split('\n').filter((line) => !prefixes.some((p) => line.startsWith(`${p} `))).join('\n');
const stripCrossLinks = (input: string, keepPrefixes: string[], chainPairs: number): string => {
  const counters: Record<string, number> = {};
  return input.split('\n').filter((line) => {
    const prefix = line.split(' ')[0] ?? '';
    if (!keepPrefixes.includes(prefix) || !['D', 'B', 'V'].includes(prefix)) return true;
    counters[prefix] = (counters[prefix] ?? 0) + 1;
    return (counters[prefix] ?? 0) <= chainPairs;
  }).join('\n');
};
const keepCrossOnly = (input: string, keepPrefixes: string[], chainPairs: number): string => {
  const counters: Record<string, number> = {};
  return input.split('\n').filter((line) => {
    const prefix = line.split(' ')[0] ?? '';
    if (!keepPrefixes.includes(prefix) || !['D', 'B', 'V'].includes(prefix)) return true;
    counters[prefix] = (counters[prefix] ?? 0) + 1;
    return (counters[prefix] ?? 0) > chainPairs;
  }).join('\n');
};

interface Shared { bundle: Awaited<ReturnType<typeof createExperimentalSparseNumericalBundle>> | null }
const shared: Shared = { bundle: null };
const loadBundleFor = () => async () => {
  if (!shared.bundle) throw new Error('WASM bundle not loaded');
  return {
    sparseCorrectionSolver: shared.bundle.sparseCorrectionSolver,
    sparseRowProductsSolver: shared.bundle.sparseRowProductsSolver,
    sparseSelectedCovarianceSolver: shared.bundle.sparseSelectedCovarianceSolver,
  };
};
const ensureBundle = async (): Promise<void> => {
  if (shared.bundle) return;
  shared.bundle = await createExperimentalSparseNumericalBundle(await loadFactory());
};

const machine: Record<string, unknown[]> = { ladder: [], boundaries: [], corpus: [], repeated: [], fallback: [], regression: [] };
let browserFixtures: { id: string; inputLength: number; request: unknown }[] = [];

describe('Phase 11A cohort widening', () => {
  it('production cap 768: default admits to cap, diagnostic seam intact, correction OFF', async () => {
    // Phase 11A-production: cap widened 384 -> 768 (cap-only change).
    // The diagnostic seam (explicit maxParams) is retained for future
    // evidence studies above the production cap; production call sites
    // omit it.
    expect(NATIVE_FULL_QXX_MAX_PARAMS, 'production cap widened to 768').toBe(768);
    expect(isNative3dCorrectionRouteEnabled(), 'correction stays OFF').toBe(false);
    const big = toRequest(ladderInput(160)); // 480 params
    const def = deriveNativeFullQxxEligibility(big);
    expect(def.eligible, 'default must admit 480 params').toBe(true);
    expect(def.numParams).toBe(480);
    const diag = deriveNativeFullQxxEligibility(big, DIAG_MAX);
    expect(diag.eligible, 'diagnostic 768 still admits 480 params').toBe(true);
    // Seam still functions above the production cap (evidence-only): an
    // explicit wider diagnostic value admits what the default rejects.
    const over = toRequest(ladderInput(300)); // 900 params
    const overDef = deriveNativeFullQxxEligibility(over);
    expect(overDef.eligible, 'default must reject 900 params').toBe(false);
    expect(overDef.reasons.join(' ')).toMatch(/exceeds native full-Qxx cap 768/);
    expect(deriveNativeFullQxxEligibility(over, 1024).eligible, 'diagnostic 1024 admits 900').toBe(true);
    // Ordinary request above the cap still routes clean TS (no bundle load).
    let bundleTouched = false;
    const seen: unknown[] = [];
    const attempt = await runWithNativeFullQxxAutoRoute(over, undefined, {
      runSession: (request, onProgress, runtime) => {
        seen.push(runtime === undefined ? 'clean-ts' : 'native');
        return runAdjustmentSession(request, onProgress, runtime);
      },
      loadBundle: async () => {
        bundleTouched = true;
        throw new Error('must not load bundle on the default-rejected path');
      },
    });
    expect(attempt.route).toBe('typescript');
    expect(bundleTouched).toBe(false);
    expect(seen).toEqual(['clean-ts']);
    expect(attempt.outcome.result.success).toBe(true);
    machine.fallback.push({ case: 'default-routing-proof>768', route: attempt.route, numParams: overDef.numParams });
  });

  it('widening ladder 384..768: verified route parity + cost', async () => {
    setNativeFullQxxRouteEnabled(true);
    try {
      await ensureBundle();
      for (const unknowns of LADDER) {
        const input = ladderInput(unknowns);
        const request = toRequest(input);
        const def = deriveNativeFullQxxEligibility(request);
        // Phase 11A-production: the whole 384..768 ladder is default-eligible.
        expect(def.eligible, `m${unknowns} default eligibility`).toBe(true);
        const diagElig = def;
        expect(diagElig.eligible, `m${unknowns} production eligibility`).toBe(true);
        const numParams = diagElig.numParams ?? -1;

        const memBefore = memMB();
        runAdjustmentSession(request, undefined, undefined);
        const tsWalls: number[] = [];
        let tsOutcome!: ReturnType<typeof runAdjustmentSession>;
        for (let i = 0; i < LADDER_RUNS + 1; i += 1) {
          const t = performance.now();
          const run = runAdjustmentSession(request, undefined, undefined);
          if (i > 0) { tsOutcome = run; tsWalls.push(performance.now() - t); }
        }
        expect(tsOutcome.result.success, `m${unknowns} TS must succeed`).toBe(true);

        await runWithNativeFullQxxAutoRoute(request, undefined, { runSession: runAdjustmentSession, loadBundle: loadBundleFor() });
        const routeWalls: number[] = [];
        let attempt!: Awaited<ReturnType<typeof runWithNativeFullQxxAutoRoute>>;
        for (let i = 0; i < LADDER_RUNS; i += 1) {
          const t = performance.now();
          attempt = await runWithNativeFullQxxAutoRoute(request, undefined, { runSession: runAdjustmentSession, loadBundle: loadBundleFor() });
          routeWalls.push(performance.now() - t);
        }
        expect(attempt.route, `m${unknowns} must take native route`).toBe('native-full-qxx');
        expect(attempt.verification?.accepted, `m${unknowns} C1/C2/C3 accept`).toBe(true);
        expect(attempt.verification?.reasons ?? [], `m${unknowns} reasons empty`).toEqual([]);
        const diff = resultDiff(tsOutcome.result, attempt.outcome.result);
        expect(diff, `m${unknowns} TS/route parity`).toBeLessThan(PARITY_TOL);

        // Per-part verify timing + capture metadata via one engine-level run.
        const timing = createNativeFullQxxVerificationTiming();
        const diag = createExperimentalSparseRouteDiagnostics();
        const capture = new NativeFullQxxCaptureSolver(shared.bundle!.sparseSelectedCovarianceSolver, timing, DIAG_MAX);
        new LSAEngine({
          input, sparseSelectedCovarianceSolver: capture,
          experimentalSelectedCovarianceMode: false, allowVerifiedNativeDenseQxxReuse: true,
          experimentalSparseDiagnostics: diag,
        }).solve();
        expect(capture.truncated, `m${unknowns} no truncation`).toBe(false);
        expect(diag.selectedCovarianceFallbacks, `m${unknowns} no covariance fallback`).toBe(0);
        const memAfter = memMB();
        const ts = stats(tsWalls);
        const native = stats(routeWalls);
        const ratio = native.median / ts.median;
        machine.ladder.push({
          unknowns, numParams, cohort: 'production-route',
          tsWallMs: ts, routeWallMs: native, nativeOverTsRatio: ratio,
          class: ratio < 0.9 ? 'native-faster' : ratio > 1.1 ? 'ts-faster' : 'parity',
          absoluteDeltaMs: native.median - ts.median, resultMaxAbsDiff: diff,
          qxxElements: numParams * numParams, qxxBytes: numParams * numParams * 8,
          qxxMB: (numParams * numParams * 8) / 1048576,
          c1MaxDiff: attempt.verification?.maxC1Diff ?? null,
          c2MaxResidual: attempt.verification?.maxC2Residual ?? null,
          verifiedColumns: attempt.verification?.verifiedColumns.length ?? null,
          verifyTimingMs: {
            captureCopy: timing.captureCopyMs, oracleBuild: timing.oracleBuildMs,
            queryBuild: timing.queryBuildMs, oracleProbe: timing.oracleProbeMs,
            nativeIndex: timing.nativeIndexMs, c1: timing.c1Ms, c2: timing.c2Ms,
            c3Physical: timing.c3PhysicalMs, other: timing.otherMs,
          },
          memoryMB: { before: memBefore, after: memAfter },
        });
        if ([128, 171, 213, 256].includes(unknowns)) {
          browserFixtures.push({ id: `gps-3d-m${unknowns}`, inputLength: input.length, request: toRequest(input) });
        }
      }
    } finally {
      setNativeFullQxxRouteEnabled(true);
    }
  }, 2400000);

  it('boundaries: nearest-achievable disclosure + single-run proof', async () => {
    setNativeFullQxxRouteEnabled(true);
    try {
      await ensureBundle();
      for (const unknowns of BOUNDARIES) {
        const input = ladderInput(unknowns);
        const request = toRequest(input);
        const diagElig = deriveNativeFullQxxEligibility(request);
        expect(diagElig.eligible, `m${unknowns} production eligibility`).toBe(true);
        const numParams = diagElig.numParams ?? -1;
        const tsOutcome = runAdjustmentSession(request, undefined, undefined);
        expect(tsOutcome.result.success, `m${unknowns} TS must succeed`).toBe(true);
        const attempt = await runWithNativeFullQxxAutoRoute(request, undefined, { runSession: runAdjustmentSession, loadBundle: loadBundleFor() });
        expect(attempt.route, `m${unknowns} native route`).toBe('native-full-qxx');
        expect(attempt.verification?.accepted, `m${unknowns} C1/C2/C3 accept`).toBe(true);
        const diff = resultDiff(tsOutcome.result, attempt.outcome.result);
        expect(diff, `m${unknowns} parity`).toBeLessThan(PARITY_TOL);
        machine.boundaries.push({ unknowns, numParams, note: 'nearest-achievable coord-only; exact odds unreachable', resultMaxAbsDiff: diff, accepted: true });
      }
      machine.boundaries.push({ note: '383/384/385: 384 exact at 128u (ladder); 383/385 unreachable coord-only (3*unknowns)' });
      machine.boundaries.push({ note: '511/512/513: nearest 510 (170u) + 513 (171u); 639/640/641: nearest 639 (213u) + 642 (214u); 767/768/769: nearest 765 (255u) + 768 (256u)' });
    } finally {
      setNativeFullQxxRouteEnabled(true);
    }
  }, 1200000);

  it('multi-family breadth at 128u + 213u (production route)', async () => {
    setNativeFullQxxRouteEnabled(true);
    try {
      await ensureBundle();
      const build = (unknowns: number): { id: string; input: string; note: string }[] => {
        const base = ladderInput(unknowns);
        const chainPairs = unknowns + 1;
        return [
          { id: `dist-heavy-${unknowns}`, input: dropPrefixes(base, ['B', 'G']), note: 'distance+height only' },
          { id: `mixed-full-${unknowns}`, input: base, note: 'mixed terrestrial+GPS' },
          { id: `gps-dist-${unknowns}`, input: dropPrefixes(base, ['B']), note: 'GPS+distance+height' },
          { id: `terrestrial-only-${unknowns}`, input: dropPrefixes(base, ['G']), note: 'terrestrial D+B+V' },
          { id: `weak-chain-${unknowns}`, input: stripCrossLinks(dropPrefixes(base, ['G']), ['D', 'B', 'V'], chainPairs), note: 'sequential chain, no GPS' },
          { id: `low-redundancy-${unknowns}`, input: stripCrossLinks(dropPrefixes(base, ['B']), ['D', 'V'], chainPairs), note: 'sequential D+V + GPS' },
          { id: `uneven-${unknowns}`, input: keepCrossOnly(base, ['D', 'B', 'V'], 0), note: 'cross-links + GPS (connectivity variant)' },
          { id: `compact-${unknowns}`, input: keepCrossOnly(base, ['D', 'B', 'V'], chainPairs), note: 'cross-links + GPS, no sequential' },
        ];
      };
      // Phase 11A-production: both cohorts run the default production route.
      for (const [unknowns, subset] of [[128, 8], [213, 4]] as const) {
        for (const c of build(unknowns).slice(0, subset)) {
          const request = toRequest(c.input);
          const elig = deriveNativeFullQxxEligibility(request);
          const row: Record<string, unknown> = { id: c.id, note: c.note, eligible: elig.eligible, numParams: elig.numParams, cohort: 'production-route' };
          if (!elig.eligible) { machine.corpus.push({ ...row, status: 'excluded', parity: null, reasons: elig.reasons }); continue; }
          const tsOutcome = runAdjustmentSession(request, undefined, undefined);
          if (!tsOutcome.result.success) {
            machine.corpus.push({ ...row, status: 'excluded', parity: null, reason: 'TS baseline itself did not converge (azimuth-unconstrained) — parity untestable, not a route rejection' });
            continue;
          }
          const tsWalls: number[] = [];
          for (let i = 0; i < LADDER_RUNS; i += 1) {
            const t = performance.now();
            runAdjustmentSession(request, undefined, undefined);
            tsWalls.push(performance.now() - t);
          }
          const routeWalls: number[] = [];
          let attempt!: Awaited<ReturnType<typeof runWithNativeFullQxxAutoRoute>>;
          for (let i = 0; i < LADDER_RUNS; i += 1) {
            const t = performance.now();
            attempt = await runWithNativeFullQxxAutoRoute(request, undefined, { runSession: runAdjustmentSession, loadBundle: loadBundleFor() });
            routeWalls.push(performance.now() - t);
          }
          if (attempt.route !== 'native-full-qxx') {
            // Fail-closed fallback on weak geometry (e.g. solver damping on
            // azimuth-unconstrained distance-only nets): honest exclusion
            // with reason, never a silent pass. TS baseline converged, so
            // this is a route verification gate, not a parity violation.
            machine.corpus.push({ ...row, status: 'excluded', parity: null, reason: `native route fell back fail-closed: ${attempt.reasons.join('; ').slice(0, 300)}` });
            continue;
          }
          const diff = resultDiff(tsOutcome.result, attempt.outcome.result);
          const pass = (attempt.verification?.accepted ?? false) && diff < PARITY_TOL;
          expect(pass, `${c.id} corpus parity`).toBe(true);
          const ts = stats(tsWalls);
          const native = stats(routeWalls);
          machine.corpus.push({ ...row, status: 'measured', tsWallMs: ts, routeWallMs: native, nativeOverTsRatio: native.median / ts.median, resultMaxAbsDiff: diff, parity: 'pass' });
        }
      }
      const measured = (machine.corpus as Record<string, unknown>[]).filter((r) => r.status === 'measured');
      expect((machine.corpus as Record<string, unknown>[]).some((r) => r.id === `mixed-full-${128}` && r.status === 'measured'), 'mixed-full-128 must measure').toBe(true);
      expect(measured.length, 'at least mixed + gps-dist measured').toBeGreaterThanOrEqual(2);
    } finally {
      setNativeFullQxxRouteEnabled(true);
    }
  }, 1800000);

  it('repeated-run pressure: heap stability', async () => {
    setNativeFullQxxRouteEnabled(true);
    try {
      await ensureBundle();
      for (const [unknowns, runs] of [[128, 25], [171, 10], [213, 10]] as const) {
        const request = toRequest(ladderInput(unknowns));
        const heapBefore = memMB();
        const walls: number[] = [];
        for (let i = 0; i < runs; i += 1) {
          const t = performance.now();
          const attempt = await runWithNativeFullQxxAutoRoute(request, undefined, { runSession: runAdjustmentSession, loadBundle: loadBundleFor() });
          walls.push(performance.now() - t);
          expect(attempt.route, `m${unknowns} run ${i} native`).toBe('native-full-qxx');
          expect(attempt.verification?.accepted, `m${unknowns} run ${i} accepted`).toBe(true);
        }
        if (globalThis.gc) globalThis.gc();
        const heapAfter = memMB();
        machine.repeated.push({
          unknowns, numParams: unknowns * 3, runs, cohort: 'production-route',
          wallMs: stats(walls), heapBefore, heapAfter,
          heapGrowthMB: heapAfter.heapMB - heapBefore.heapMB,
          leak: heapAfter.heapMB - heapBefore.heapMB > 200 ? 'YES' : 'NO',
        });
      }
    } finally {
      setNativeFullQxxRouteEnabled(true);
    }
  }, 1800000);

  it('fallback matrix via production routing @639', async () => {
    setNativeFullQxxRouteEnabled(true);
    try {
      await ensureBundle();
      const request = toRequest(ladderInput(213)); // 639 params
      expect(deriveNativeFullQxxEligibility(request).eligible).toBe(true);
      const ok = { runSession: runAdjustmentSession, loadBundle: loadBundleFor() };
      const cleanTs = async (label: string, attempt: Awaited<ReturnType<typeof runWithNativeFullQxxAutoRoute>>, pattern: RegExp): Promise<void> => {
        expect(attempt.route, `${label} clean TS`).toBe('typescript');
        expect(attempt.outcome.result.success, `${label} TS outcome succeeds`).toBe(true);
        expect(attempt.reasons.join(' '), `${label} reason`).toMatch(pattern);
        machine.fallback.push({ case: label, route: attempt.route, reason: attempt.reasons.join('; ').slice(0, 200) });
      };
      await cleanTs('init-fail', await runWithNativeFullQxxAutoRoute(request, undefined, {
        runSession: runAdjustmentSession,
        loadBundle: async () => { throw new Error('synthetic bundle init failure'); },
      }), /init failed/);
      await cleanTs('run-throw', await runWithNativeFullQxxAutoRoute(request, undefined, {
        runSession: ((req, onProgress, runtime) => {
          if (runtime !== undefined) throw new Error('synthetic native throw');
          return runAdjustmentSession(req, onProgress, runtime);
        }) as typeof runAdjustmentSession,
        loadBundle: loadBundleFor(),
      }), /threw/);
      setNativeFullQxxRouteEnabled(false);
      try {
        await cleanTs('kill-switch', await runWithNativeFullQxxAutoRoute(request, undefined, ok), /kill switch/);
      } finally {
        setNativeFullQxxRouteEnabled(true);
      }
      const doctor = (mutate: (_outcome: ReturnType<typeof runAdjustmentSession>) => ReturnType<typeof runAdjustmentSession>, label: string, pattern: RegExp) =>
        runWithNativeFullQxxAutoRoute(request, undefined, {
          runSession: ((req, onProgress, runtime) => {
            const outcome = runAdjustmentSession(req, onProgress, runtime);
            return runtime === undefined ? outcome : mutate(outcome);
          }) as typeof runAdjustmentSession,
          loadBundle: loadBundleFor(),
        }).then((attempt) => cleanTs(label, attempt, pattern));
      await doctor((o) => ({ ...o, result: { ...o.result, success: true, converged: false } }), 'non-converge', /not converged/);
      await doctor((o) => {
        const names = Object.keys(o.result.stations);
        const first = names[0]!;
        return { ...o, result: { ...o.result, stations: { ...o.result.stations, [first]: { ...o.result.stations[first]!, x: Number.NaN } } } };
      }, 'non-finite', /finite/);
      const wrapSolver = (mutate: (_r: SparseSelectedCovarianceResult) => SparseSelectedCovarianceResult): (() => Promise<{ sparseCorrectionSolver: never; sparseRowProductsSolver: never; sparseSelectedCovarianceSolver: SparseSelectedCovarianceSolver }>) => async () => {
        const real = await loadBundleFor()();
        const delegate = real.sparseSelectedCovarianceSolver;
        return {
          sparseCorrectionSolver: real.sparseCorrectionSolver as never,
          sparseRowProductsSolver: real.sparseRowProductsSolver as never,
          sparseSelectedCovarianceSolver: {
            querySelected(input: SparseSelectedCovarianceInput): SparseSelectedCovarianceResult {
              return mutate(delegate.querySelected(input));
            },
          },
        };
      };
      await cleanTs('damped-solver', await runWithNativeFullQxxAutoRoute(request, undefined, {
        runSession: runAdjustmentSession, loadBundle: wrapSolver((r) => ({ ...r, damping: 1 })),
      }), /damping|fallback/);
      await cleanTs('nonfinite-solver', await runWithNativeFullQxxAutoRoute(request, undefined, {
        runSession: runAdjustmentSession,
        loadBundle: wrapSolver((r) => ({ ...r, covariance: Float64Array.from(r.covariance, (v, i) => (i === 0 ? Number.NaN : v)) })),
      }), /non-finite|fallback/);
      // Unit-level finalizer rejects (fail-closed aggregation, no escape).
      const good = await (async () => {
        const capture = new NativeFullQxxCaptureSolver(shared.bundle!.sparseSelectedCovarianceSolver, undefined, DIAG_MAX);
        new LSAEngine({
          input: ladderInput(32), sparseSelectedCovarianceSolver: capture,
          experimentalSelectedCovarianceMode: false, allowVerifiedNativeDenseQxxReuse: true,
          experimentalSparseDiagnostics: createExperimentalSparseRouteDiagnostics(),
        }).solve();
        return { systems: [...capture.systems], inline: [...capture.getInlineVerifications()] };
      })();
      expect(good.systems.length).toBeGreaterThan(0);
      const rejects: [string, Parameters<typeof finalizeNativeFullQxxVerification>][] = [
        ['truncation', [good.systems, good.inline, true, 96, undefined, DIAG_MAX]],
        ['count-mismatch', [good.systems, [], false, 96, undefined, DIAG_MAX]],
        ['malformed', [[...good.systems], [{ accepted: true, reasons: [], oracledSystemCount: 1, maxC1Diff: Number.NaN, maxC2Residual: 0, verifiedColumns: [] }], false, 96, undefined, DIAG_MAX]],
      ];
      for (const [label, args] of rejects) {
        const v = finalizeNativeFullQxxVerification(...args);
        expect(v.accepted, `finalizer ${label} rejects`).toBe(false);
        machine.fallback.push({ case: `finalizer-${label}`, route: 'typescript-equivalent', reason: v.reasons.join('; ').slice(0, 200) });
      }
      const empty = verifyNativeFullQxxSystems([], false, null, undefined, DIAG_MAX);
      expect(empty.accepted, 'empty capture rejects').toBe(false);
      machine.fallback.push({ case: 'verifier-empty', route: 'typescript-equivalent', reason: empty.reasons.join('; ').slice(0, 200) });
    } finally {
      setNativeFullQxxRouteEnabled(true);
    }
  }, 1200000);

  it('<=768 production regression: parity, constant intact', async () => {
    setNativeFullQxxRouteEnabled(true);
    try {
      await ensureBundle();
      // Phase 11A-production: cap widened 384 -> 768; the <=384 cohort
      // keeps its exact path/verification/results (only 385..768 newly reachable).
      expect(NATIVE_FULL_QXX_MAX_PARAMS).toBe(768);
      expect(isNative3dCorrectionRouteEnabled()).toBe(false);
      for (const unknowns of [32, 128]) {
        const request = toRequest(ladderInput(unknowns));
        expect(deriveNativeFullQxxEligibility(request).eligible, `m${unknowns} eligible`).toBe(true);
        const tsOutcome = runAdjustmentSession(request, undefined, undefined);
        const attempt = await runWithNativeFullQxxAutoRoute(request, undefined, { runSession: runAdjustmentSession, loadBundle: loadBundleFor() });
        expect(attempt.route, `m${unknowns} native route`).toBe('native-full-qxx');
        expect(attempt.verification?.accepted).toBe(true);
        const diff = resultDiff(tsOutcome.result, attempt.outcome.result);
        expect(diff, `m${unknowns} parity`).toBeLessThan(PARITY_TOL);
        machine.regression.push({ unknowns, numParams: unknowns * 3, route: attempt.route, resultMaxAbsDiff: diff, verdict: 'unregressed' });
      }
    } finally {
      setNativeFullQxxRouteEnabled(true);
    }
  }, 600000);

  it('writes machine evidence + browser fixtures', async () => {
    const dir = join(process.cwd(), 'artifacts/evidence/phase11a');
    mkdirSync(dir, { recursive: true });
    const payload = {
      environment: { node: process.version, platform: process.platform, arch: process.arch },
      production: { cap: NATIVE_FULL_QXX_MAX_PARAMS, correctionEnabled: isNative3dCorrectionRouteEnabled() },
      methodology: {
        armA: 'pure TypeScript runAdjustmentSession', armB: 'default production route (cap 768)',
        runsPerArm: LADDER_RUNS, parityTol: PARITY_TOL, seeds: '3000+unknownCount, gps-covariance 3D',
        corrections: 'OFF', classes: '<0.90 native-faster, 0.90-1.10 parity, >1.10 ts-faster',
      },
      ...machine,
    };
    writeFileSync(join(dir, 'phase11a-evidence.json'), `${JSON.stringify(payload, null, 1)}\n`);
    const bdir = join(process.cwd(), 'artifacts/evidence/phase11a-browser');
    mkdirSync(bdir, { recursive: true });
    writeFileSync(join(bdir, 'requests.json'), `${JSON.stringify(browserFixtures, null, 1)}\n`);
    expect(browserFixtures.length).toBe(4);
  });
});
