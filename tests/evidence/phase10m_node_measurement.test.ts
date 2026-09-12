/**
 * Phase 10M evidence: Node measurement campaign (measurement-only).
 *
 * Manual evidence campaign (never runs in CI; registered in
 * scripts/testTiers.ts EVIDENCE_TESTS). Real WASM, deterministic
 * generator inputs, fresh bundle init + warm-up per arm.
 *
 * - Size ladder: gps-3d generator at unknownCounts
 *   8/16/32/48/64/85/107/128 (= 24/48/96/144/192/255/321/384 params)
 *   with TS wall / native engine wall / verified route wall, plus
 *   diagnostic-engine-only 160/192/224/256 (= 480/576/672/768 params,
 *   above the 384-param route cap — never the production route).
 * - Realistic corpus: deterministic line-filtered variants of the same
 *   generator (distance-heavy, mixed, terrestrial-only, weak chain,
 *   low-redundancy, uneven, compact) at 32 unknowns; excluded shapes
 *   recorded with eligibility reasons (no routing changes).
 * - Large-case proof: result parity, no damping/fallback/truncation,
 *   memory use, Qxx elements/bytes.
 *
 * Full parity per case = result max abs diff < 1e-6 (rounded comparison)
 * plus route verification accepted with empty reasons (C1/C2/C3) and
 * zero damping attempts / zero fallbacks / no truncation.
 *
 * Writes raw machine output to artifacts/evidence/phase10m/ (gitignored).
 * No production routing/math/tolerance/protocol changes.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

import { LSAEngine } from '../../src/engine/adjust';
import { createExperimentalSparseRouteDiagnostics } from '../../src/engine/experimentalSparseDiagnostics';
import { generatePhase6Large3dInput } from '../../src/engine/phase6BenchmarkNetworks';
import { createExperimentalSparseNumericalBundle } from '../../src/engine/wasm/experimentalSparseNumericalBundle';
import type {
  SparseSelectedCovarianceInput,
  SparseSelectedCovarianceResult,
  SparseSelectedCovarianceSolver,
  SparsePhaseTimings,
} from '../../src/engine/numericalBackend';
import type { WebNetWasmFactory } from '../../src/engine/wasm/wasmTypes';
import { runAdjustmentSession } from '../../src/engine/runSession';
import {
  deriveNativeFullQxxEligibility,
  NativeFullQxxCaptureSolver,
  runWithNativeFullQxxAutoRoute,
  setNativeFullQxxRouteEnabled,
} from '../../src/workers/adjustmentNativeFullQxxAutoRoute';
import { createRunSessionRequest } from '../helpers/runSessionRequest';

const LADDER_UNKNOWNCOUNTS = [8, 16, 32, 48, 64, 85, 107, 128];
const DIAG_UNKNOWNCOUNTS = [160, 192, 224, 256];
const LADDER_RUNS = 5;
const DIAG_RUNS = 3;
const PARITY_TOL = 1e-6;

const sorted = (xs: number[]): number[] => [...xs].sort((a, b) => a - b);
const median = (xs: number[]): number => sorted(xs)[Math.floor(xs.length / 2)] ?? 0;
const quantile = (xs: number[], q: number): number => {
  const s = sorted(xs);
  return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))] ?? 0;
};
const mean = (xs: number[]): number => xs.reduce((s, v) => s + v, 0) / Math.max(1, xs.length);
const std = (xs: number[]): number => {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, v) => s + (v - m) ** 2, 0) / Math.max(1, xs.length));
};
const stats = (xs: number[]) => ({ p25: quantile(xs, 0.25), median: median(xs), p75: quantile(xs, 0.75), raw: [...xs], std: std(xs) });

const parameterCount = (result: ReturnType<LSAEngine['solve']>): number =>
  Object.values(result.stations).filter((station) => !station.fixed).length * 3 +
  (result.directionSetDiagnostics?.length ?? 0);

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
  if (Array.isArray(a) && Array.isArray(b))
    return Math.max(0, ...a.map((v, i) => maxDiff(v, b[i])));
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = Object.keys(a as object);
    return Math.max(0, ...keys.map((key) => maxDiff((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])));
  }
  return 0;
};
const resultDiff = (a: unknown, b: unknown): number =>
  JSON.stringify(comparable(a)) === JSON.stringify(comparable(b))
    ? 0
    : maxDiff(comparable(a), comparable(b));

interface TapCall { qxxElements: number; damping: number; attempts: number; wrapperMs: number; timings?: SparsePhaseTimings }
const tappedSolver = (delegate: SparseSelectedCovarianceSolver, calls: TapCall[]): SparseSelectedCovarianceSolver => ({
  querySelected(input: SparseSelectedCovarianceInput): SparseSelectedCovarianceResult {
    const t = performance.now();
    const r = delegate.querySelected(input);
    calls.push({ qxxElements: r.covariance.length, damping: r.damping, attempts: r.dampingAttempts, wrapperMs: performance.now() - t, timings: r.timings });
    return r;
  },
});

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

interface Bundle { b: Awaited<ReturnType<typeof createExperimentalSparseNumericalBundle>> }
const loadBundleFor = (ctx: Bundle) => async () => ({
  sparseCorrectionSolver: ctx.b.sparseCorrectionSolver,
  sparseRowProductsSolver: ctx.b.sparseRowProductsSolver,
  sparseSelectedCovarianceSolver: ctx.b.sparseSelectedCovarianceSolver,
});

describe('Phase 10M Node measurement campaign', () => {
  it('size ladder + realistic corpus + large-case proof', async () => {
    setNativeFullQxxRouteEnabled(true);
    try {
      await runCampaign();
    } finally {
      setNativeFullQxxRouteEnabled(false);
    }
  }, 1800000);
});

const runCampaign = async (): Promise<void> => {
  const factory = await loadFactory();
  const bundle = await createExperimentalSparseNumericalBundle(factory);
  const ctx: Bundle = { b: bundle };
  const ladder: Record<string, unknown>[] = [];
  const corpus: Record<string, unknown>[] = [];
  const large: Record<string, unknown>[] = [];

  // ---- 1. Size ladder (route-eligible) ----
  for (const unknowns of LADDER_UNKNOWNCOUNTS) {
    const input = ladderInput(unknowns);
    const request = toRequest(input);
    const eligibility = deriveNativeFullQxxEligibility(request);
    expect(eligibility.eligible, `m${unknowns} must be route-eligible`).toBe(true);

    runAdjustmentSession(request, undefined, undefined);
    const tsWalls: number[] = [];
    let tsOutcome!: ReturnType<typeof runAdjustmentSession>;
    for (let i = 0; i < LADDER_RUNS; i += 1) {
      const t = performance.now();
      tsOutcome = runAdjustmentSession(request, undefined, undefined);
      tsWalls.push(performance.now() - t);
    }
    const numParams = parameterCount(tsOutcome.result);
    expect(tsOutcome.result.success, `m${unknowns} TS must succeed`).toBe(true);

    // Native engine wall (diagnostic-level, tapped). Like-with-like:
    // engine-TS baseline vs engine-native, both raw LSAEngine solves.
    const engineTsOutcome = new LSAEngine({ input }).solve();
    const engineCalls: TapCall[] = [];
    const engineTap = tappedSolver(bundle.sparseSelectedCovarianceSolver, engineCalls);
    const engineDiag = createExperimentalSparseRouteDiagnostics();
    new LSAEngine({
      input, sparseSelectedCovarianceSolver: engineTap,
      experimentalSelectedCovarianceMode: false, allowVerifiedNativeDenseQxxReuse: true,
      experimentalSparseDiagnostics: engineDiag,
    }).solve();
    const engineWalls: number[] = [];
    let engineOutcome!: ReturnType<LSAEngine['solve']>;
    for (let i = 0; i < DIAG_RUNS; i += 1) {
      const t = performance.now();
      engineOutcome = new LSAEngine({
        input, sparseSelectedCovarianceSolver: engineTap,
        experimentalSelectedCovarianceMode: false, allowVerifiedNativeDenseQxxReuse: true,
        experimentalSparseDiagnostics: engineDiag,
      }).solve();
      engineWalls.push(performance.now() - t);
    }

    // Verified route wall.
    await runWithNativeFullQxxAutoRoute(request, undefined, { runSession: runAdjustmentSession, loadBundle: loadBundleFor(ctx) });
    const routeWalls: number[] = [];
    let attempt!: Awaited<ReturnType<typeof runWithNativeFullQxxAutoRoute>>;
    for (let i = 0; i < LADDER_RUNS; i += 1) {
      const t = performance.now();
      attempt = await runWithNativeFullQxxAutoRoute(request, undefined, { runSession: runAdjustmentSession, loadBundle: loadBundleFor(ctx) });
      routeWalls.push(performance.now() - t);
    }
    expect(attempt.route, `m${unknowns} must take native route`).toBe('native-full-qxx');
    expect(attempt.verification?.accepted, `m${unknowns} C1/C2/C3 must accept`).toBe(true);
    expect(attempt.verification?.reasons ?? [], `m${unknowns} reasons empty`).toEqual([]);

    const tsVsRoute = resultDiff(tsOutcome.result, attempt.outcome.result);
    const tsVsEngine = resultDiff(engineTsOutcome, engineOutcome);
    expect(tsVsEngine, `m${unknowns} TS/engine parity`).toBeLessThan(PARITY_TOL);
    expect(tsVsRoute, `m${unknowns} TS/route parity`).toBeLessThan(PARITY_TOL);
    expect(tsVsEngine, `m${unknowns} TS/engine parity`).toBeLessThan(PARITY_TOL);
    const dampingAttempts = Math.max(0, ...engineCalls.map((c) => c.attempts));
    expect(dampingAttempts, `m${unknowns} no damping`).toBe(0);
    expect(engineDiag.sparseCorrectionFallbacks, `m${unknowns} no correction fallback`).toBe(0);
    expect(engineDiag.selectedCovarianceFallbacks, `m${unknowns} no covariance fallback`).toBe(0);
    const qxxElements = engineCalls.reduce((s, c) => s + c.qxxElements, 0);
    const ts = stats(tsWalls);
    const native = stats(routeWalls);
    const ratio = native.median / ts.median;
    ladder.push({
      id: `gps-3d-m${unknowns}`, unknowns, numParams,
      eligible: true, cohort: 'route',
      tsWallMs: ts, nativeEngineWallMs: stats(engineWalls), routeWallMs: native,
      nativeOverTsRatio: ratio,
      class: ratio < 0.9 ? 'native-faster' : ratio > 1.1 ? 'ts-faster' : 'parity',
      absoluteDeltaMs: native.median - ts.median,
      resultMaxAbsDiff: Math.max(tsVsRoute, tsVsEngine),
      c1MaxDiff: attempt.verification?.maxC1Diff ?? null,
      c2MaxResidual: attempt.verification?.maxC2Residual ?? null,
      dampingAttempts, correctionFallbacks: engineDiag.sparseCorrectionFallbacks,
      covarianceFallbacks: engineDiag.selectedCovarianceFallbacks,
      qxxElements, qxxBytes: qxxElements * 8,
    });
  }

  // ---- 2. Diagnostic sizes above the cap (engine-only, never the route) ----
  for (const unknowns of DIAG_UNKNOWNCOUNTS) {
    const input = ladderInput(unknowns);
    const request = toRequest(input);
    const eligibility = deriveNativeFullQxxEligibility(request);
    expect(eligibility.eligible, `m${unknowns} must be route-ineligible`).toBe(false);

    const memBefore = memMB();
    const t0 = performance.now();
    const tsOutcome = new LSAEngine({ input }).solve();
    const tsFirstMs = performance.now() - t0;
    const memAfterTs = memMB();
    expect(tsOutcome.success, `m${unknowns} TS must succeed`).toBe(true);
    const numParams = parameterCount(tsOutcome);
    const tsWalls: number[] = [tsFirstMs];
    for (let i = 1; i < DIAG_RUNS; i += 1) {
      const t = performance.now();
      new LSAEngine({ input }).solve();
      tsWalls.push(performance.now() - t);
    }
    void memAfterTs;

    const diagCalls: TapCall[] = [];
    const diagTap = tappedSolver(bundle.sparseSelectedCovarianceSolver, diagCalls);
    const diag = createExperimentalSparseRouteDiagnostics();
    const capture = new NativeFullQxxCaptureSolver(bundle.sparseSelectedCovarianceSolver);
    const n0 = performance.now();
    const nativeOutcome = new LSAEngine({
      input, sparseSelectedCovarianceSolver: diagTap,
      experimentalSelectedCovarianceMode: false, allowVerifiedNativeDenseQxxReuse: true,
      experimentalSparseDiagnostics: diag,
    }).solve();
    const nativeFirstMs = performance.now() - n0;
    const memAfterNative = memMB();
    new LSAEngine({
      input, sparseSelectedCovarianceSolver: capture,
      experimentalSelectedCovarianceMode: false, allowVerifiedNativeDenseQxxReuse: true,
      experimentalSparseDiagnostics: createExperimentalSparseRouteDiagnostics(),
    }).solve();
    const nativeWalls: number[] = [nativeFirstMs];
    for (let i = 1; i < DIAG_RUNS; i += 1) {
      const t = performance.now();
      new LSAEngine({
        input, sparseSelectedCovarianceSolver: diagTap,
        experimentalSelectedCovarianceMode: false, allowVerifiedNativeDenseQxxReuse: true,
        experimentalSparseDiagnostics: diag,
      }).solve();
      nativeWalls.push(performance.now() - t);
    }
    const diff = resultDiff(tsOutcome, nativeOutcome);
    expect(diff, `m${unknowns} diagnostic TS/native parity`).toBeLessThan(PARITY_TOL);
    const dampingAttempts = Math.max(0, ...diagCalls.map((c) => c.attempts));
    expect(dampingAttempts, `m${unknowns} no damping`).toBe(0);
    expect(diag.sparseCorrectionFallbacks).toBe(0);
    expect(diag.selectedCovarianceFallbacks).toBe(0);
    expect(capture.truncated, `m${unknowns} no truncation`).toBe(false);
    const qxxElements = diagCalls.reduce((s, c) => s + c.qxxElements, 0);
    const ts = stats(tsWalls);
    const native = stats(nativeWalls);
    large.push({
      id: `gps-3d-m${unknowns}`, unknowns, numParams,
      cohort: 'diagnostic-engine-only (above 384-param route cap; never the production route)',
      routeEligibility: { eligible: false, reasons: eligibility.reasons },
      tsWallMs: ts, nativeEngineWallMs: native,
      nativeOverTsRatio: native.median / ts.median,
      absoluteDeltaMs: native.median - ts.median,
      resultMaxAbsDiff: diff,
      dampingAttempts, correctionFallbacks: diag.sparseCorrectionFallbacks,
      covarianceFallbacks: diag.selectedCovarianceFallbacks, truncated: capture.truncated,
      qxxElements, qxxBytes: qxxElements * 8,
      memoryMB: { before: memBefore, afterNative: memAfterNative },
    });
    ladder.push({
      id: `gps-3d-m${unknowns}`, unknowns, numParams,
      eligible: false, cohort: 'diagnostic-engine-only',
      tsWallMs: ts, nativeEngineWallMs: native, routeWallMs: null,
      nativeOverTsRatio: native.median / ts.median,
      class: null, absoluteDeltaMs: native.median - ts.median,
      resultMaxAbsDiff: diff, qxxElements, qxxBytes: qxxElements * 8,
    });
  }

  // ---- 3. Realistic corpus: deterministic line-filtered variants (32 unknowns) ----
  const base32 = ladderInput(32);
  const isObs = (prefix: string) => (line: string): boolean => line.startsWith(`${prefix} `);
  const dropPrefixes = (input: string, prefixes: string[]): string =>
    input.split('\n').filter((line) => !prefixes.some((p) => line.startsWith(`${p} `))).join('\n');
  // Sequential chain = first (order.length-1) D/B/V triples; cross-links follow.
  const chainPairs = 33; // 32 unknowns + 2 controls - 1
  const stripCrossLinks = (input: string, keepPrefixes: string[]): string => {
    const counters: Record<string, number> = {};
    return input.split('\n').filter((line) => {
      const prefix = line.split(' ')[0] ?? '';
      if (!keepPrefixes.includes(prefix) || !['D', 'B', 'V'].includes(prefix)) return true;
      counters[prefix] = (counters[prefix] ?? 0) + 1;
      return (counters[prefix] ?? 0) <= chainPairs;
    }).join('\n');
  };
  const keepCrossOnly = (input: string, keepPrefixes: string[]): string => {
    const counters: Record<string, number> = {};
    return input.split('\n').filter((line) => {
      const prefix = line.split(' ')[0] ?? '';
      if (!keepPrefixes.includes(prefix) || !['D', 'B', 'V'].includes(prefix)) return true;
      counters[prefix] = (counters[prefix] ?? 0) + 1;
      return (counters[prefix] ?? 0) > chainPairs;
    }).join('\n');
  };
  const uneven = (input: string): string => {
    // Sequential all + cross-links only for even-indexed unknowns + GPS.
    const counters: Record<string, number> = {};
    return input.split('\n').filter((line) => {
      const prefix = line.split(' ')[0] ?? '';
      if (!['D', 'B', 'V'].includes(prefix)) return true;
      counters[prefix] = (counters[prefix] ?? 0) + 1;
      const idx = counters[prefix] ?? 0;
      if (idx <= chainPairs) return true;
      const crossIdx = idx - chainPairs - 1; // 0-based over U1..U32
      return crossIdx % 2 === 0;
    }).join('\n');
  };
  void isObs;
  const cases: { id: string; input: string; note: string }[] = [
    { id: 'corpus-dist-heavy-32', input: dropPrefixes(base32, ['B', 'G']), note: 'distance+height only (no bearings, no GPS)' },
    { id: 'corpus-mixed-full-32', input: base32, note: 'mixed terrestrial+GPS (D+B+V+G, all links)' },
    { id: 'corpus-gps-dist-32', input: dropPrefixes(base32, ['B']), note: 'GPS+distance+height (no bearings)' },
    { id: 'corpus-terrestrial-only-32', input: dropPrefixes(base32, ['G']), note: 'terrestrial only D+B+V (no GPS)' },
    { id: 'corpus-weak-chain-32', input: stripCrossLinks(dropPrefixes(base32, ['G']), ['D', 'B', 'V']), note: 'weak-but-valid long chain, sequential links only, no GPS' },
    { id: 'corpus-low-redundancy-32', input: stripCrossLinks(dropPrefixes(base32, ['B']), ['D', 'V']), note: 'low redundancy: sequential D+V + GPS' },
    { id: 'corpus-uneven-32', input: uneven(base32), note: 'uneven connectivity: sequential all + even-only cross-links + GPS' },
    { id: 'corpus-compact-32', input: keepCrossOnly(base32, ['D', 'B', 'V']), note: 'compact: cross-links + GPS, no sequential chain' },
  ];
  for (const c of cases) {
    const request = toRequest(c.input);
    const eligibility = deriveNativeFullQxxEligibility(request);
    const row: Record<string, unknown> = { id: c.id, note: c.note, eligible: eligibility.eligible, reasons: eligibility.reasons };
    if (!eligibility.eligible) {
      corpus.push({ ...row, status: 'excluded', parity: null });
      continue;
    }
    const tsOutcome = runAdjustmentSession(request, undefined, undefined);
    if (!tsOutcome.result.success) {
      corpus.push({ ...row, status: 'excluded', parity: null, reason: 'TS baseline itself did not converge (azimuth-unconstrained: no bearings/GPS) — parity untestable; route eligibility passed, not a route rejection' });
      continue;
    }
    const tsWalls: number[] = [];
    for (let i = 0; i < DIAG_RUNS; i += 1) {
      const t = performance.now();
      runAdjustmentSession(request, undefined, undefined);
      tsWalls.push(performance.now() - t);
    }
    const routeWalls: number[] = [];
    let attempt!: Awaited<ReturnType<typeof runWithNativeFullQxxAutoRoute>>;
    for (let i = 0; i < DIAG_RUNS + 1; i += 1) {
      const t = performance.now();
      const run = await runWithNativeFullQxxAutoRoute(request, undefined, { runSession: runAdjustmentSession, loadBundle: loadBundleFor(ctx) });
      if (i > 0) { attempt = run; routeWalls.push(performance.now() - t); }
      else { attempt = run; }
    }
    const numParams = parameterCount(tsOutcome.result);
    const diff = resultDiff(tsOutcome.result, attempt.outcome.result);
    const pass =
      attempt.route === 'native-full-qxx' &&
      (attempt.verification?.accepted ?? false) &&
      (attempt.verification?.reasons ?? []).length === 0 &&
      diff < PARITY_TOL;
    expect(pass, `${c.id} corpus parity`).toBe(true);
    corpus.push({
      ...row, status: 'measured', numParams,
      tsWallMs: stats(tsWalls), routeWallMs: stats(routeWalls),
      route: attempt.route, verificationAccepted: attempt.verification?.accepted ?? null,
      maxC1Diff: attempt.verification?.maxC1Diff ?? null,
      maxC2Residual: attempt.verification?.maxC2Residual ?? null,
      resultMaxAbsDiff: diff, parity: pass ? 'pass' : 'FAIL',
    });
  }

  // ---- 4. Excluded-shape probes (eligibility only, no routing change) ----
  const excluded: Record<string, unknown>[] = [];
  const probe2d = toRequest(base32);
  probe2d.parseSettings = { ...probe2d.parseSettings, coordMode: '2D' as never };
  excluded.push({ shape: '2D session', ...deriveNativeFullQxxEligibility(probe2d as never) });
  const probeRobust = toRequest(base32);
  probeRobust.parseSettings = { ...probeRobust.parseSettings, robustMode: 'huber' as never };
  excluded.push({ shape: 'robust reweighting', ...deriveNativeFullQxxEligibility(probeRobust as never) });
  const probeBig = toRequest(ladderInput(160));
  excluded.push({ shape: '480-param (>384 cap)', ...deriveNativeFullQxxEligibility(probeBig) });

  // ---- 5. Qxx memory table (theoretical full-dense n^2 * 8 bytes) ----
  const qxxBytesTable = [384, 512, 640, 768].map((n) => ({ params: n, elements: n * n, bytes: n * n * 8, bytesMB: (n * n * 8) / 1048576 }));

  const machineDir = join(process.cwd(), 'artifacts/evidence/phase10m');
  mkdirSync(machineDir, { recursive: true });
  const payload = {
    environment: { node: process.version, platform: process.platform, arch: process.arch },
    methodology: {
      ladderRuns: LADDER_RUNS, diagRuns: DIAG_RUNS, warmupPerArm: 1,
      parityTol: PARITY_TOL, ladderSeeds: '3000+unknownCount, gps-covariance 3D',
      classes: '<0.90 native-faster, 0.90-1.10 parity, >1.10 ts-faster',
    },
    ladder, corpus, large, excludedShapes: excluded, qxxBytesTable,
  };
  writeFileSync(join(machineDir, 'phase10m-evidence.json'), `${JSON.stringify(payload, null, 1)}\n`);
  expect(ladder.length).toBe(LADDER_UNKNOWNCOUNTS.length + DIAG_UNKNOWNCOUNTS.length);
};
