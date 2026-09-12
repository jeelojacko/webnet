/**
 * Phase 10I evidence: real-WASM native full-Qxx route campaign.
 *
 * Evidence-only manual campaign (never runs in CI). Uses the genuine 3D
 * ladder gps-3d-32/64/128 through the REAL WASM sparse bundle on the
 * worker-only automatic route vs forced TypeScript, 1 warm-up + 5 measured
 * runs per arm. Collects verifier C1/C2 maxima, native phase-timing
 * metadata, solver call counts, statistics-reuse reasons, and 1e-6 parity,
 * plus an explicit fallback/semantic matrix (2D/preanalysis/robust/
 * kill-switch/corrupted-native/damped-native).
 *
 * No timing assertions: walls are observational only. Writes machine
 * artifacts to `artifacts/evidence/phase10i/` (gitignored) and the
 * committed decision report to `reports/phase10i/`.
 *
 * No production routing changes.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

import { LSAEngine } from '../../src/engine/adjust';
import { buildPhase6LargeBenchmarkCases } from '../../src/engine/phase6BenchmarkNetworks';
import { createExperimentalSparseNumericalBundle } from '../../src/engine/wasm/experimentalSparseNumericalBundle';
import type {
  SparseSelectedCovarianceInput,
  SparseSelectedCovarianceResult,
  SparseSelectedCovarianceSolver,
  SparsePhaseTimings,
} from '../../src/engine/numericalBackend';
import type { QxxReuseProbeEvent } from '../../src/engine/qxxReuseEvidence';
import type { WebNetWasmFactory } from '../../src/engine/wasm/wasmTypes';
import { runAdjustmentSession } from '../../src/engine/runSession';
import type { RunSessionRequest } from '../../src/engine/runSessionTypes';
import {
  runWithNativeFullQxxAutoRoute,
  setNativeFullQxxRouteEnabled,
  type NativeFullQxxVerification,
} from '../../src/workers/adjustmentNativeFullQxxAutoRoute';
import { createRunSessionRequest } from '../helpers/runSessionRequest';

const FIXTURE_IDS = ['gps-3d-32', 'gps-3d-64', 'gps-3d-128'];
const fixtures = buildPhase6LargeBenchmarkCases(false).filter(({ id }) =>
  FIXTURE_IDS.includes(id),
);
if (fixtures.length !== 3) throw new Error('Missing genuine 3D ladder fixtures.');
const RUNS = 5;

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
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

/** Test-side tap: counts native calls and captures per-call phase timings. */
const tappedSolver = (
  delegate: SparseSelectedCovarianceSolver,
  calls: { count: number },
  timings: (SparsePhaseTimings | undefined)[],
  mutate?: (_result: SparseSelectedCovarianceResult) => void,
): SparseSelectedCovarianceSolver => ({
  querySelected(input: SparseSelectedCovarianceInput): SparseSelectedCovarianceResult {
    calls.count += 1;
    const result = delegate.querySelected(input);
    timings.push(result.timings);
    if (mutate) mutate(result);
    return result;
  },
});

const rounded = (value: unknown): unknown => {
  if (typeof value === 'number') return Math.round(value * 1e6) / 1e6;
  if (Array.isArray(value)) return value.map(rounded);
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rounded(v)]));
  return value;
};
const comparable = (outcome: ReturnType<typeof runAdjustmentSession>): unknown => {
  // solveTimingProfile carries wall-clock timings; logs carry volatile lines.
  const { logs: _logs, solveTimingProfile: _timing, ...stable } =
    outcome.result as unknown as Record<string, unknown>;
  const cleanLogs = Array.isArray((outcome.result as { logs?: unknown }).logs)
    ? ((outcome.result as { logs: string[] }).logs.filter(
        (line) => !line.startsWith('Solve timing (ms):'),
      ) as unknown)
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
const maxMatrixDiff = (a: number[][] | undefined, b: number[][] | undefined): number => {
  if (!a || !b || a.length !== b.length) return Number.POSITIVE_INFINITY;
  let worst = 0;
  for (let i = 0; i < a.length; i += 1)
    for (let j = 0; j < (a[i]?.length ?? 0); j += 1)
      worst = Math.max(worst, Math.abs((a[i]?.[j] ?? 0) - (b[i]?.[j] ?? 0)));
  return worst;
};

describe('Phase 10I real-WASM native route evidence', () => {
  it('compares automatic native full-Qxx against forced TS with verifier metadata', async () => {
    // The route ships enabled by default (Phase 10M production batch);
    // the campaign explicitly enables it and restores the default after.
    setNativeFullQxxRouteEnabled(true);
    try {
      await runCampaign();
    } finally {
      setNativeFullQxxRouteEnabled(true);
    }
  }, 600000);
});

const runCampaign = async (): Promise<void> => {
    const factory = await loadFactory();
    const bundle = await createExperimentalSparseNumericalBundle(factory);
    const report: string[] = [
      '# Phase 10I real-WASM native full-Qxx route evidence',
      '',
      'Automatic worker-only route (final covariance only, verified provenance, C1/C2/C3) vs forced TypeScript, 1 warm-up + 5 measured runs.',
      '',
      '| Fixture | P | TS median ms | Native median ms | result max abs diff | Qxx max abs diff | stats reuse | C1 max diff | C2 max residual | verified cols | native calls |',
      '|---|---:|---:|---:|---:|---:|---|---:|---:|---:|---:|',
    ];
    const machine: Record<string, unknown>[] = [];
    for (const fixture of fixtures) {
      const base = createRunSessionRequest({ input: fixture.input });
      const request = {
        ...base,
        parseSettings: { ...base.parseSettings, coordMode: '3D' as const, suspectImpactMode: 'off' as const },
      };
      // TS arm: direct session, no runtime, never near the route.
      runAdjustmentSession(request, undefined, undefined);
      const tsWalls: number[] = [];
      let tsOutcome = runAdjustmentSession(request, undefined, undefined);
      for (let i = 0; i < RUNS; i += 1) {
        const t = performance.now();
        tsOutcome = runAdjustmentSession(request, undefined, undefined);
        tsWalls.push(performance.now() - t);
      }
      // Native arm: automatic route over the real bundle with a tap.
      const calls = { count: 0 };
      const timings: (SparsePhaseTimings | undefined)[] = [];
      const solver = tappedSolver(bundle.sparseSelectedCovarianceSolver, calls, timings);
      const deps = {
        runSession: runAdjustmentSession,
        loadBundle: async () => ({
          sparseCorrectionSolver: bundle.sparseCorrectionSolver,
          sparseRowProductsSolver: bundle.sparseRowProductsSolver,
          sparseSelectedCovarianceSolver: solver,
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
      const verification: NativeFullQxxVerification | undefined = attempt.verification;
      // LSAEngine-level instrumented pair: reuse reason + direct Qxx diff.
      const tsEvents: QxxReuseProbeEvent[] = [];
      new LSAEngine({ input: fixture.input, qxxReuseProbe: (e) => tsEvents.push(e) }).solve();
      const nativeEvents: QxxReuseProbeEvent[] = [];
      new LSAEngine({
        input: fixture.input,
        sparseSelectedCovarianceSolver: bundle.sparseSelectedCovarianceSolver,
        experimentalSelectedCovarianceMode: false,
        allowVerifiedNativeDenseQxxReuse: true,
        qxxReuseProbe: (e) => nativeEvents.push(e),
      }).solve();
      const tsQxx = tsEvents.find((e) => e.stage === 'final-covariance')?.qxx;
      const nativeQxx = nativeEvents.find((e) => e.stage === 'final-covariance')?.qxx;
      const qxxDiff = maxMatrixDiff(tsQxx, nativeQxx);
      const resultDiff =
        JSON.stringify(comparable(tsOutcome)) === JSON.stringify(comparable(attempt.outcome))
          ? 0
          : maxDiff(comparable(tsOutcome), comparable(attempt.outcome));
      const reuseReason = nativeEvents.find((e) => e.stage === 'statistics')?.reason ?? 'missing';
      const p = parameterCount(tsOutcome.result as ReturnType<LSAEngine['solve']>);
      const admitted = Boolean(
        tsOutcome.result.success &&
          attempt.outcome.result.success &&
          attempt.route === 'native-full-qxx' &&
          verification?.accepted === true &&
          resultDiff < 1e-6 &&
          qxxDiff < 1e-6 &&
          reuseReason === 'reused-final-dense-qxx',
      );
      expect(
        admitted,
        `${fixture.id} route=${attempt.route} verified=${verification?.accepted} resultDiff=${resultDiff} qxxDiff=${qxxDiff} reuse=${reuseReason}`,
      ).toBe(true);
      const timingCols = timings.filter((t): t is SparsePhaseTimings => t != null);
      const phaseMedian = (pick: (_t: SparsePhaseTimings) => number): number =>
        timingCols.length > 0 ? median(timingCols.map(pick)) : Number.NaN;
      report.push(
        `| ${fixture.id} | ${p} | ${median(tsWalls).toFixed(2)} | ${median(nativeWalls).toFixed(2)} | ${resultDiff.toExponential(3)} | ${qxxDiff.toExponential(3)} | ${reuseReason} | ${(verification?.maxC1Diff ?? NaN).toExponential(3)} | ${(verification?.maxC2Residual ?? NaN).toExponential(3)} | ${verification?.verifiedColumns.length ?? 0} | ${calls.count} |`,
      );
      machine.push({
        fixture: fixture.id,
        params: p,
        tsWallMedianMs: median(tsWalls),
        nativeWallMedianMs: median(nativeWalls),
        resultMaxAbsDiff: resultDiff,
        qxxMaxAbsDiff: qxxDiff,
        statisticsReuseReason: reuseReason,
        c1MaxDiff: verification?.maxC1Diff ?? null,
        c2MaxResidual: verification?.maxC2Residual ?? null,
        verifiedColumns: verification?.verifiedColumns ?? [],
        oracledSystems: verification?.oracledSystemCount ?? 0,
        nativeCalls: calls.count,
        nativePhaseMedianMs: {
          assembly: phaseMedian((t) => t.assemblyMs),
          equilibration: phaseMedian((t) => t.equilibrationMs),
          analyze: phaseMedian((t) => t.analyzeMs),
          factorize: phaseMedian((t) => t.factorizeMs),
          solve: phaseMedian((t) => t.solveMs),
        },
      });
    }

    // Explicit fallback/semantic matrix (fast shapes on gps-3d-32 + real-backend fault injection).
    const small = fixtures[0]!;
    const smallBase = createRunSessionRequest({ input: small.input });
    const req3d: RunSessionRequest = {
      ...smallBase,
      parseSettings: { ...smallBase.parseSettings, coordMode: '3D', suspectImpactMode: 'off' },
    };
    const matrix: string[][] = [];
    const runRoute = (
      label: string,
      mutateRequest: (_r: RunSessionRequest) => RunSessionRequest,
      mutateSolver?: (_r: SparseSelectedCovarianceResult) => void,
    ) =>
      runWithNativeFullQxxAutoRoute(mutateRequest(req3d), undefined, {
        runSession: runAdjustmentSession,
        loadBundle: async () => ({
          sparseCorrectionSolver: bundle.sparseCorrectionSolver,
          sparseRowProductsSolver: bundle.sparseRowProductsSolver,
          sparseSelectedCovarianceSolver:
            mutateSolver == null
              ? bundle.sparseSelectedCovarianceSolver
              : tappedSolver(bundle.sparseSelectedCovarianceSolver, { count: 0 }, [], mutateSolver),
        }),
      }).then((attempt) => {
        matrix.push([
          label,
          attempt.route,
          attempt.outcome.result.success ? 'TS-success' : 'TS-FAIL',
          attempt.reasons[0]?.slice(0, 120) ?? '',
        ]);
        return attempt;
      });
    await runRoute('2D preserved', (r) => ({
      ...r,
      parseSettings: { ...r.parseSettings, coordMode: '2D' as const },
    }));
    await runRoute('preanalysis preserved', (r) => ({
      ...r,
      parseSettings: { ...r.parseSettings, runMode: 'preanalysis' as const, preanalysisMode: true },
    }));
    await runRoute('robust fail-closed', (r) => ({
      ...r,
      parseSettings: { ...r.parseSettings, robustMode: 'huber' as const },
    }));
    setNativeFullQxxRouteEnabled(false);
    try {
      await runRoute('kill-switch fail-closed', (r) => r);
    } finally {
      setNativeFullQxxRouteEnabled(true);
    }
    const corrupt = await runRoute(
      'corrupted native fail-closed (real backend)',
      (r) => r,
      (result) => {
        result.covariance[0] = (result.covariance[0] ?? 0) + 1;
      },
    );
    expect(corrupt.route).toBe('typescript');
    const damped = await runRoute(
      'damped native fail-closed (real backend)',
      (r) => r,
      (result) => {
        (result as { damping: number }).damping = 1e-9;
      },
    );
    expect(damped.route).toBe('typescript');
    for (const row of matrix) {
      expect(row[1], `${row[0]} must fall back to typescript`).toBe('typescript');
      expect(row[2], `${row[0]} TS rerun must succeed`).toBe('TS-success');
    }
    report.push('', '## Fallback / semantic matrix (gps-3d-32)', '', '| Case | route | TS rerun | first reason |', '|---|---|---|---|');
    for (const row of matrix) report.push(`| ${row[0]} | ${row[1]} | ${row[2]} | ${row[3]} |`);

    const dir = join(process.cwd(), 'artifacts/evidence/phase10i');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'phase10i-evidence.json'), `${JSON.stringify(machine, null, 1)}\n`);
    writeFileSync(join(dir, 'phase10i-evidence.md'), `${report.join('\n')}\n`);
    expect(report.length).toBeGreaterThan(10);
};
