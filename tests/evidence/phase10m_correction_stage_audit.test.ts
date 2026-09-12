/**
 * Phase 10M evidence: correction-solve stage audit (measurement-only).
 *
 * Manual evidence campaign (never runs in CI). Per representative 3D size on
 * the genuine corpus ladder (gps-3d-cov-08/32/64/128 = 24/96/192/384 params;
 * no genuine 64/128/256-param fixtures exist, so actual param counts are
 * reported), records with 1 warm-up + 3 measured runs and NO timing asserts:
 *
 * - Arm A (engine): LSAEngine + DetailedSolveProfiler -> per-iteration
 *   correction assembly/accumulate/factorSolve sums, covariance invertMs,
 *   statisticsMs + statisticsDetail/standardizedResidualDetail.
 * - Arm B (session): runAdjustmentSession solveTimingProfile buckets ->
 *   parse/setup, assembly, factorization, precision/diag, report, packaging.
 * - Arm C (native route): real WASM bundle + NativeFullQxxCaptureSolver with
 *   diagnostic timing collector -> native covariance phase sum, wrapper wall,
 *   verification buckets, route wall, TS/native parity (<1e-6 correctness).
 *
 * Writes machine artifacts to artifacts/evidence/phase10m/ (gitignored).
 * No production routing/math/tolerance changes.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

import { LSAEngine } from '../../src/engine/adjust';
import {
  createDetailedSolveProfiler,
  type DetailedSolveProfile,
} from '../../src/engine/adjustDetailedSolveProfile';
import { buildPhase6LargeBenchmarkCases } from '../../src/engine/phase6BenchmarkNetworks';
import { runAdjustmentSession } from '../../src/engine/runSession';
import { createExperimentalSparseNumericalBundle } from '../../src/engine/wasm/experimentalSparseNumericalBundle';
import type { WebNetWasmFactory } from '../../src/engine/wasm/wasmTypes';
import {
  createNativeFullQxxVerificationTiming,
  NativeFullQxxCaptureSolver,
  runWithNativeFullQxxAutoRoute,
  setNativeFullQxxRouteEnabled,
  type NativeFullQxxVerificationTiming,
} from '../../src/workers/adjustmentNativeFullQxxAutoRoute';
import { createRunSessionRequest } from '../helpers/runSessionRequest';

const ROUTE_IDS = ['gps-3d-cov-08', 'gps-3d-32', 'gps-3d-64', 'gps-3d-128'];
const fixtures = buildPhase6LargeBenchmarkCases(false).filter(({ id }) =>
  ROUTE_IDS.includes(id),
);
if (fixtures.length !== 4) throw new Error('Missing genuine 3D fixtures.');

const RUNS = 3;

const sorted = (xs: number[]): number[] => [...xs].sort((a, b) => a - b);
const median = (xs: number[]): number => sorted(xs)[Math.floor(xs.length / 2)] ?? 0;

const loadFactory = async (): Promise<WebNetWasmFactory> => {
  const mod = (await import(
    pathToFileURL(`${process.cwd()}/cpp/build-wasm/webnet_core.js`).href
  )) as { default: WebNetWasmFactory };
  if (typeof mod.default !== 'function') throw new Error('WASM factory missing');
  return mod.default;
};

interface StageRow {
  fixture: string;
  numParams: number;
  equationCount: number;
  iterationCount: number;
  tsWallMs: number;
  correctionAssemblyMs: number;
  correctionAccumulateMs: number;
  correctionFactorSolveMs: number;
  correctionTotalMs: number;
  covarianceAssemblyMs: number;
  covarianceAccumulateMs: number;
  covarianceInvertMs: number;
  covarianceTotalMs: number;
  statisticsMs: number;
  precisionPropagationMs: number;
  sessionPrecisionAndDiagMs: number;
  sessionReportMs: number;
  sessionTotalMs: number;
  nativeCovariancePhaseMs: number;
  nativeWrapperMs: number;
  verificationTotalMs: number;
  verifyC1Ms: number;
  verifyC2Ms: number;
  verifyC3Ms: number;
  verifyScaffoldingMs: number;
  nativeRouteWallMs: number;
  parityMaxDiff: number;
}

const summarizeProfile = (profile: DetailedSolveProfile) => ({
  correctionAssemblyMs: profile.assemblyMs,
  correctionAccumulateMs: profile.accumulateMs,
  correctionFactorSolveMs: profile.factorSolveMs,
  covarianceAssemblyMs: profile.covariance.assemblyMs,
  covarianceAccumulateMs: profile.covariance.accumulateMs,
  covarianceInvertMs: profile.covariance.invertMs,
  statisticsMs: profile.statisticsMs,
  precisionPropagationMs: profile.statisticsDetail.precisionPropagationMs,
  iterationCount: profile.iterationCount,
  equationCount: profile.iterations[0]?.equationCount ?? 0,
  numParams: profile.iterations[0]?.parameterCount ?? 0,
});

describe('Phase 10M correction-solve stage audit', () => {
  it('measures per-stage timings across the 24/96/192/384-param ladder', async () => {
    const factory = await loadFactory();
    const bundle = await createExperimentalSparseNumericalBundle(factory);
    const rows: StageRow[] = [];
    setNativeFullQxxRouteEnabled(true);
    try {
      for (const fixture of fixtures) {
        // Arm A: engine-level profiler (correction vs covariance vs statistics).
        const walls: number[] = [];
        const profiles: ReturnType<typeof summarizeProfile>[] = [];
        for (let i = 0; i < RUNS + 1; i += 1) {
          const profiler = createDetailedSolveProfiler();
          const t = performance.now();
          const result = new LSAEngine({ input: fixture.input, detailedSolveProfiler: profiler }).solve();
          const wall = performance.now() - t;
          if (i === 0) continue;
          expect(result.success).toBe(true);
          walls.push(wall);
          profiles.push(summarizeProfile(profiler.profile));
        }
        const prof = profiles[Math.floor(profiles.length / 2)] ?? profiles[0];
        if (!prof) throw new Error(`No profile for ${fixture.id}`);

        // Arm B: session-level buckets (stats/report split).
        const base = createRunSessionRequest({ input: fixture.input });
        const request = {
          ...base,
          parseSettings: { ...base.parseSettings, coordMode: '3D' as const, suspectImpactMode: 'off' as const },
        };
        runAdjustmentSession(request, undefined, undefined);
        const buckets: Record<string, number>[] = [];
        let sessionTotal = 0;
        for (let i = 0; i < RUNS + 1; i += 1) {
          const outcome = runAdjustmentSession(request, undefined, undefined);
          if (i === 0) continue;
          const profile = (outcome.result as unknown as { solveTimingProfile: Record<string, number> }).solveTimingProfile;
          buckets.push(profile);
          sessionTotal = profile.totalMs;
        }
        const bucket = (name: string): number =>
          median(buckets.map((b) => b[name] ?? 0));

        // Arm C: native route with diagnostic collector.
        const nativePhase: number[] = [];
        const wrapper: number[] = [];
        const verifyTotals: number[] = [];
        const verifyC1: number[] = [];
        const verifyC2: number[] = [];
        const verifyC3: number[] = [];
        const verifyScaf: number[] = [];
        const routeWalls: number[] = [];
        let parityMaxDiff = 0;
        for (let i = 0; i < RUNS + 1; i += 1) {
          const timing = createNativeFullQxxVerificationTiming();
          const calls: { phaseMs: number; wrapMs: number }[] = [];
          const tapped = {
            querySelected: (input: Parameters<typeof bundle.sparseSelectedCovarianceSolver.querySelected>[0]) => {
              const t0 = performance.now();
              const result = bundle.sparseSelectedCovarianceSolver.querySelected(input);
              const wrap = performance.now() - t0;
              const phase = result.timings
                ? result.timings.assemblyMs + result.timings.equilibrationMs +
                  result.timings.analyzeMs + result.timings.factorizeMs + result.timings.solveMs
                : 0;
              calls.push({ phaseMs: phase, wrapMs: wrap });
              return result;
            },
          };
          const capture = new NativeFullQxxCaptureSolver(tapped, timing);
          const t0 = performance.now();
          const attempt = await runWithNativeFullQxxAutoRoute(request, undefined, {
            runSession: runAdjustmentSession,
            loadBundle: async () => ({
              sparseCorrectionSolver: bundle.sparseCorrectionSolver,
              sparseRowProductsSolver: bundle.sparseRowProductsSolver,
              sparseSelectedCovarianceSolver: capture,
            }),
          });
          const wall = performance.now() - t0;
          if (i === 0) continue;
          expect(attempt.route).toBe('native-full-qxx');
          const phaseSum = calls.reduce((s, c) => s + c.phaseMs, 0);
          const wrapSum = calls.reduce((s, c) => s + c.wrapMs, 0);
          nativePhase.push(phaseSum);
          wrapper.push(wrapSum - phaseSum);
          const v: NativeFullQxxVerificationTiming = timing;
          verifyTotals.push(
            v.oracleBuildMs + v.queryBuildMs + v.oracleProbeMs + v.finiteScanConvertMs +
            v.nativeIndexMs + v.c1Ms + v.c2Ms + v.c3PhysicalMs + v.otherMs,
          );
          verifyC1.push(v.c1Ms);
          verifyC2.push(v.c2Ms);
          verifyC3.push(v.c3PhysicalMs);
          verifyScaf.push(v.finiteScanConvertMs + v.queryBuildMs + v.oracleProbeMs + v.nativeIndexMs + v.oracleBuildMs);
          routeWalls.push(wall);
          // Parity: native route vs clean TS session result coordinates.
          const tsOutcome = runAdjustmentSession(request, undefined, undefined);
          const coords = (r: typeof tsOutcome.result): number[] =>
            Object.values(r.stations).flatMap((s) => [s.x, s.y, s.h ?? 0]);
          const a = coords(tsOutcome.result);
          const b = coords(attempt.outcome.result);
          parityMaxDiff = Math.max(0, ...a.map((v, k) => Math.abs(v - (b[k] ?? Number.NaN))));
        }
        expect(parityMaxDiff).toBeLessThan(1e-6);

        const correctionTotal = prof.correctionAssemblyMs + prof.correctionAccumulateMs + prof.correctionFactorSolveMs;
        const covarianceTotal = prof.covarianceAssemblyMs + prof.covarianceAccumulateMs + prof.covarianceInvertMs;
        rows.push({
          fixture: fixture.id,
          numParams: prof.numParams,
          equationCount: prof.equationCount,
          iterationCount: prof.iterationCount,
          tsWallMs: median(walls),
          correctionAssemblyMs: prof.correctionAssemblyMs,
          correctionAccumulateMs: prof.correctionAccumulateMs,
          correctionFactorSolveMs: prof.correctionFactorSolveMs,
          correctionTotalMs: correctionTotal,
          covarianceAssemblyMs: prof.covarianceAssemblyMs,
          covarianceAccumulateMs: prof.covarianceAccumulateMs,
          covarianceInvertMs: prof.covarianceInvertMs,
          covarianceTotalMs: covarianceTotal,
          statisticsMs: prof.statisticsMs,
          precisionPropagationMs: prof.precisionPropagationMs,
          sessionPrecisionAndDiagMs: bucket('precisionAndDiagnosticsMs'),
          sessionReportMs: bucket('reportDiagnosticsMs'),
          sessionTotalMs: sessionTotal,
          nativeCovariancePhaseMs: median(nativePhase),
          nativeWrapperMs: median(wrapper),
          verificationTotalMs: median(verifyTotals),
          verifyC1Ms: median(verifyC1),
          verifyC2Ms: median(verifyC2),
          verifyC3Ms: median(verifyC3),
          verifyScaffoldingMs: median(verifyScaf),
          nativeRouteWallMs: median(routeWalls),
          parityMaxDiff,
        });
      }
    } finally {
      setNativeFullQxxRouteEnabled(false);
    }

    const dir = join(process.cwd(), 'artifacts/evidence/phase10m');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'stage_profile.json'), JSON.stringify({ rows }, null, 2));
    for (const r of rows) {
      // eslint-disable-next-line no-console
      console.log(
        `10M ${r.fixture} p=${r.numParams} eq=${r.equationCount} iters=${r.iterationCount} ` +
        `tsWall=${r.tsWallMs.toFixed(1)} correction=${r.correctionTotalMs.toFixed(1)} ` +
        `(asm=${r.correctionAssemblyMs.toFixed(1)}/acc=${r.correctionAccumulateMs.toFixed(1)}/fac=${r.correctionFactorSolveMs.toFixed(1)}) ` +
        `cov=${r.covarianceTotalMs.toFixed(1)} (inv=${r.covarianceInvertMs.toFixed(1)}) ` +
        `stats=${r.statisticsMs.toFixed(1)} report=${r.sessionReportMs.toFixed(1)} ` +
        `nativeCov=${r.nativeCovariancePhaseMs.toFixed(2)} verify=${r.verificationTotalMs.toFixed(1)} ` +
        `routeWall=${r.nativeRouteWallMs.toFixed(1)} parity=${r.parityMaxDiff.toExponential(1)}`,
      );
    }
  }, 900000);
});
