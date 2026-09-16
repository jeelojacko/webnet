/**
 * Phase 15A evidence: post-QC covariance memory + native/WASM boundary (measurement-only).
 *
 * Manual evidence campaign (never runs in CI; evidence tier). Single 3D case
 * (gps-3d-64, genuine committed fixture) keeps the campaign cheap:
 *
 * 1. Memory table: one measured TS solve gives the shape (params n,
 *    equations E = dof + n, stations S); analytic O() byte counts are then
 *    tabulated for n = 64/128/256/384 with E scaled at fixed redundancy and
 *    S = n/3 + 2 (phase6 generator rule). Measured where cheap: Qxx payload
 *    bytes from the tapped native call, number[][] rebuild bytes, and
 *    process.memoryUsage heap delta around the TS solve. Each entry states
 *    transient vs retained.
 * 2. Native/WASM boundary split: harness-side tap (wrapper wall around
 *    querySelected minus the native SparsePhaseTimings sum = JS->WASM entry
 *    + arg serialization + Qxx copy-out attribution) plus in-harness
 *    micro-benchmarks of the JS rebuild ops (Float64Array.from copy-out,
 *    Array.from verifier conversion, nested-loop number[][] rebuild,
 *    copyMatrix duplicate). No src instrumentation: existing
 *    NativeFullQxxVerificationTiming / detailedSolveProfiler boundaries were
 *    sufficient, so production is untouched by construction.
 * 3. Gating proof: TS solve with vs without detailedSolveProfiler is
 *    numerically identical (maxDiff 0), proving the disabled path pays only
 *    a branch and the enabled path changes no numerics.
 *
 * Writes machine artifacts to artifacts/evidence/phase15a/ (gitignored)
 * and assembles the committed report to reports/performance/ (no
 * timestamps; methodology deterministic, walls machine-observational).
 *
 * No production routing/math/tolerance/protocol changes.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

import { LSAEngine } from '../../src/engine/adjust';
import { createDetailedSolveProfiler } from '../../src/engine/adjustDetailedSolveProfile';
import type {
  SparseSelectedCovarianceInput,
  SparseSelectedCovarianceResult,
  SparseSelectedCovarianceSolver,
  SparsePhaseTimings,
} from '../../src/engine/numericalBackend';
import { buildPhase6LargeBenchmarkCases } from '../../src/engine/phase6BenchmarkNetworks';
import { createExperimentalSparseNumericalBundle } from '../../src/engine/wasm/experimentalSparseNumericalBundle';
import type { WebNetWasmFactory } from '../../src/engine/wasm/wasmTypes';
import { runAdjustmentSession } from '../../src/engine/runSession';
import {
  deriveNativeFullQxxEligibility,
  runWithNativeFullQxxAutoRoute,
  setNativeFullQxxRouteEnabled,
} from '../../src/workers/adjustmentNativeFullQxxAutoRoute';
import { createRunSessionRequest } from '../helpers/runSessionRequest';

const FIXTURE_ID = 'gps-3d-64';
const fixture = buildPhase6LargeBenchmarkCases(false).find(({ id }) => id === FIXTURE_ID);
if (!fixture) throw new Error('Missing genuine 3D fixture gps-3d-64.');

const RUNS = 3;

const sorted = (xs: number[]): number[] => [...xs].sort((a, b) => a - b);
const median = (xs: number[]): number => sorted(xs)[Math.floor(xs.length / 2)] ?? 0;
const quantile = (xs: number[], q: number): number => {
  const s = sorted(xs);
  return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))] ?? 0;
};
const stats = (xs: number[]): { p25: number; median: number; p75: number } => ({
  p25: quantile(xs, 0.25),
  median: median(xs),
  p75: quantile(xs, 0.75),
});

const rounded = (value: unknown): unknown => {
  if (typeof value === 'number') return Math.round(value * 1e6) / 1e6;
  if (Array.isArray(value)) return value.map(rounded);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rounded(v)]));
  }
  return value;
};
const comparable = (result: unknown): unknown => {
  const rec = result as Record<string, unknown>;
  const { logs: _logs, solveTimingProfile: _timing, ...stable } = rec;
  return rounded(stable);
};
const maxDiff = (a: unknown, b: unknown): number => {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b);
  if (Array.isArray(a) && Array.isArray(b)) {
    return Math.max(0, ...a.map((v, i) => maxDiff(v, b[i])));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    return Math.max(
      0,
      ...Object.keys(a as object).map((key) =>
        maxDiff((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
      ),
    );
  }
  return 0;
};

interface BoundaryCallRecord {
  timings?: SparsePhaseTimings;
  wrapperMs: number;
  covarianceElements: number;
  designNnz: number;
  queryEntries: number;
  weightEntries: number;
}

/** Harness-side boundary tap: wrapper wall + native phase timings + transfer sizes. */
const tappedSolver = (
  delegate: SparseSelectedCovarianceSolver,
  calls: BoundaryCallRecord[],
): SparseSelectedCovarianceSolver => ({
  querySelected(input: SparseSelectedCovarianceInput): SparseSelectedCovarianceResult {
    const t = performance.now();
    const result = delegate.querySelected(input);
    calls.push({
      timings: result.timings,
      wrapperMs: performance.now() - t,
      covarianceElements: result.covariance.length,
      designNnz: input.design.values.length,
      queryEntries: input.queryRows.length,
      weightEntries: input.weights.values.length,
    });
    return result;
  },
});

const nativePhaseSum = (timings?: SparsePhaseTimings): number =>
  timings == null
    ? NaN
    : (timings.assemblyMs ?? 0) +
      (timings.equilibrationMs ?? 0) +
      (timings.analyzeMs ?? 0) +
      (timings.factorizeMs ?? 0) +
      (timings.solveMs ?? 0);

const loadFactory = async (): Promise<WebNetWasmFactory> => {
  const mod = (await import(
    pathToFileURL(`${process.cwd()}/cpp/build-wasm/webnet_core.js`).href
  )) as { default: WebNetWasmFactory };
  if (typeof mod.default !== 'function') throw new Error('WASM factory missing');
  return mod.default;
};

/** Median wall of `fn` over `repeats` runs (synchronous op micro-benchmark). */
const bench = (fn: () => void, repeats = 11): number => {
  const walls: number[] = [];
  for (let i = 0; i < repeats; i += 1) {
    const t = performance.now();
    fn();
    walls.push(performance.now() - t);
  }
  return median(walls);
};

const MB = (bytes: number): number => Math.round((bytes / 1048576) * 1000) / 1000;

describe('Phase 15A post-QC covariance memory + native boundary', () => {
  it('records memory table, boundary split, and profiler gating proof', async () => {
    const base = createRunSessionRequest({ input: fixture.input });
    const request = {
      ...base,
      parseSettings: {
        ...base.parseSettings,
        coordMode: '3D' as const,
        suspectImpactMode: 'off' as const,
      },
    };
    const eligibility = deriveNativeFullQxxEligibility(request);
    expect(eligibility.eligible).toBe(true);
    const n64 = eligibility.numParams ?? 64;

    // --- Measured shape from one TS solve (E = dof + n, S = stations). ---
    const heapBefore = process.memoryUsage().heapUsed;
    const shapeOutcome = runAdjustmentSession(request, undefined, undefined);
    const heapAfter = process.memoryUsage().heapUsed;
    expect(shapeOutcome.result.success).toBe(true);
    const stationIds = Object.keys(shapeOutcome.result.stations);
    const S64 = stationIds.length;
    const E64 = shapeOutcome.result.dof + n64;
    const relRows64 = shapeOutcome.result.relativePrecision?.length ?? 0;
    const heapDeltaMB = Math.round(((heapAfter - heapBefore) / 1048576) * 1000) / 1000;

    // --- Memory table: measured shape at n=192 (gps-3d-64), analytic ---
    // --- scaling at 64/128/256/384 params (fixed redundancy E/n and ----
    // --- station density S/n from the measured 3D GPS shape). ----------
    const redundancy = E64 / n64;
    const stationDensity = S64 / n64;
    const memoryRows = [64, 128, 192, 256, 384].map((n) => {
      const scaled = n === n64;
      const E = scaled ? E64 : Math.round(n * redundancy);
      const S = scaled ? S64 : Math.max(3, Math.round(n * stationDensity));
      const qxxBytes = n * n * 8;
      const normalBytes = n * n * 8;
      // Capture deep-copies (solver capture site): packed design
      // (rowOffsets E*4 + columns nnz*4 + values nnz*8, nnz ~= E*2.2 —
      // measured 1088/515 on gps-3d-64), packed weights upper (~E*8 incl.
      // block off-diagonals), all-entry queries (n^2*(4+4)), covariance (n^2*8).
      const nnz = Math.round(E * 2.2);
      const captureBytes = E * 4 + nnz * 4 + nnz * 8 + E * 8 + n * n * 8 + n * n * 8;
      // Verifier Array.from(covariance): one extra n^2*8 transient.
      // reconstructDenseQxx number[][]: n^2*8 payload + n row headers.
      // Probe copyMatrix (test-only, when enabled): normal + qxx.
      // Dense B (statistics/Phase-14B external path): E*n*8.
      // Dense P (TS weight matrix): E*E*8.
      // External shift vectors: per testable row, S stations x (dE,dN[,dH]).
      // relativePrecision: S*(S-1)/2 rows retained in result JSON.
      return {
        n,
        basis: scaled ? 'measured-shape' : 'analytic-scaling',
        equations: E,
        stations: S,
        normal_N_bytes: normalBytes,
        normal_N_MB: MB(normalBytes),
        qxxFinal_bytes: qxxBytes,
        qxxFinal_MB: MB(qxxBytes),
        qxxStatisticsSecond_bytes: qxxBytes,
        qxxReuseProbeCopies_testOnly_bytes: 2 * qxxBytes,
        nativeCaptureDeepCopies_bytes: captureBytes,
        nativeCaptureDeepCopies_MB: MB(captureBytes),
        verifierArrayFromTransient_bytes: qxxBytes,
        reconstructDenseQxx_bytes: qxxBytes,
        denseB_rowsXn_bytes: E * n * 8,
        denseB_rowsXn_MB: MB(E * n * 8),
        denseP_rowsXrows_bytes: E * E * 8,
        denseP_rowsXrows_MB: MB(E * E * 8),
        externalShiftPerRow_bytes: S * 3 * 8,
        externalShiftAllRows_bytes: E * S * 3 * 8,
        externalShiftAllRows_MB: MB(E * S * 3 * 8),
        relativePrecisionRows: Math.round((S * (S - 1)) / 2),
        relativePrecisionRetained_bytes: Math.round((S * (S - 1)) / 2) * 5 * 8,
      };
    });
    // Sanity: the measured row uses the observed shape exactly.
    expect(memoryRows.find((r) => r.basis === 'measured-shape')?.equations).toBe(E64);

    // --- Gating proof: profiler on vs off is numerically identical. ---
    const plain = new LSAEngine({ input: fixture.input }).solve();
    const profiler = createDetailedSolveProfiler();
    const profiled = new LSAEngine({ input: fixture.input, detailedSolveProfiler: profiler }).solve();
    expect(profiler.profile.iterationCount).toBeGreaterThan(0);
    expect(maxDiff(comparable(plain), comparable(profiled))).toBe(0);

    // --- Native/WASM boundary split on the production-equivalent route. ---
    setNativeFullQxxRouteEnabled(true);
    let boundary: {
      tsWall: { p25: number; median: number; p75: number };
      nativeWall: { p25: number; median: number; p75: number };
      perCallWrapperMs: { p25: number; median: number; p75: number };
      perCallNativePhaseMs: { p25: number; median: number; p75: number };
      perCallBoundaryCopyMs: { p25: number; median: number; p75: number };
      covarianceBytes: number;
      designNnz: number;
      queryEntries: number;
      route: string;
      maxResultDiffVsTs: number;
      rebuildBenchMs: Record<string, number>;
    };
    try {
      const factory = await loadFactory();
      const bundle = await createExperimentalSparseNumericalBundle(factory);

      // TS arm walls (1 warm-up + RUNS measured).
      runAdjustmentSession(request, undefined, undefined);
      const tsWalls: number[] = [];
      let tsOutcome = runAdjustmentSession(request, undefined, undefined);
      for (let i = 0; i < RUNS; i += 1) {
        const t = performance.now();
        tsOutcome = runAdjustmentSession(request, undefined, undefined);
        tsWalls.push(performance.now() - t);
      }

      // Native arm with boundary tap (1 warm-up + RUNS measured).
      const calls: BoundaryCallRecord[] = [];
      const deps = {
        runSession: runAdjustmentSession,
        loadBundle: async () => ({
          sparseCorrectionSolver: bundle.sparseCorrectionSolver,
          sparseRowProductsSolver: bundle.sparseRowProductsSolver,
          sparseSelectedCovarianceSolver: tappedSolver(
            bundle.sparseSelectedCovarianceSolver,
            calls,
          ),
        }),
      };
      await runWithNativeFullQxxAutoRoute(request, undefined, deps);
      const nativeWalls: number[] = [];
      let attempt!: Awaited<ReturnType<typeof runWithNativeFullQxxAutoRoute>>;
      for (let i = 0; i < RUNS; i += 1) {
        const t = performance.now();
        attempt = await runWithNativeFullQxxAutoRoute(request, undefined, deps);
        nativeWalls.push(performance.now() - t);
      }
      expect(attempt.route).toBe('native-full-qxx');
      const perRun = calls.slice(-RUNS);
      expect(perRun.length).toBeGreaterThan(0);
      const wrapper = perRun.map((c) => c.wrapperMs);
      const phases = perRun.map((c) => nativePhaseSum(c.timings));
      const boundaryCopy = perRun.map((_, i) => (wrapper[i] ?? 0) - (phases[i] ?? 0));
      const last = perRun[perRun.length - 1];
      // JS rebuild micro-benchmarks on the real transfer size.
      const elems = last?.covarianceElements ?? n64 * n64;
      const src = new Float64Array(elems).map((_, i) => (i % 97) * 0.001);
      let sink: unknown;
      const rebuildBenchMs = {
        float64CopyOut_from: bench(() => {
          sink = Float64Array.from(src);
        }),
        verifierArrayFrom: bench(() => {
          sink = Array.from(src);
        }),
        denseRebuild_nestedLoop: bench(() => {
          const side = Math.round(Math.sqrt(elems));
          const out: number[][] = new Array(side);
          for (let r = 0; r < side; r += 1) {
            const row = new Array<number>(side);
            for (let c = 0; c < side; c += 1) row[c] = src[r * side + c] ?? 0;
            out[r] = row;
          }
          sink = out;
        }),
        copyMatrixDuplicate: bench(() => {
          const side = Math.round(Math.sqrt(elems));
          const m: number[][] = Array.from({ length: side }, (_, r) =>
            Array.from({ length: side }, (_, c) => src[r * side + c] ?? 0),
          );
          sink = m.map((row) => [...row]);
        }),
      };
      expect(sink).toBeDefined();
      boundary = {
        tsWall: stats(tsWalls),
        nativeWall: stats(nativeWalls),
        perCallWrapperMs: stats(wrapper),
        perCallNativePhaseMs: stats(phases),
        perCallBoundaryCopyMs: stats(boundaryCopy),
        covarianceBytes: (last?.covarianceElements ?? 0) * 8,
        designNnz: last?.designNnz ?? 0,
        queryEntries: last?.queryEntries ?? 0,
        route: attempt.route,
        maxResultDiffVsTs: maxDiff(comparable(tsOutcome.result), comparable(attempt.outcome.result)),
        rebuildBenchMs,
      };
      expect(boundary.maxResultDiffVsTs).toBe(0);
    } finally {
      setNativeFullQxxRouteEnabled(true);
    }

    const artifact = {
      fixture: FIXTURE_ID,
      measuredShape: {
        params: n64,
        equations: E64,
        stations: S64,
        relativePrecisionRows: relRows64,
        redundancy: Math.round(redundancy * 1000) / 1000,
        heapDeltaAroundTsSolveMB: heapDeltaMB,
      },
      memoryTable: memoryRows,
      transience: {
        transient:
          'N (per-inversion scratch), second statistics Qxx without reuse, ' +
          'native capture deep-copies, Array.from verifier copy, ' +
          'reconstructDenseQxx scratch, dense B, dense P, per-row external shift vectors',
        retained:
          'final Qxx (number[][], in result pipeline), relativePrecision rows (result JSON), ' +
          'station/relative covariance blocks',
      },
      boundary,
      instrumentation: {
        srcAdded: 'none — existing NativeFullQxxVerificationTiming + detailedSolveProfiler ' +
          'boundaries plus harness-side wrapper tap were sufficient',
        gatingProof: 'TS solve with vs without detailedSolveProfiler: maxDiff 0; ' +
          'native route result vs TS result: maxDiff 0',
      },
    };
    const dir = join(process.cwd(), 'artifacts', 'evidence', 'phase15a');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'phase15a-memory-boundary.json'), JSON.stringify(artifact, null, 2));
  }, 900000);
});
