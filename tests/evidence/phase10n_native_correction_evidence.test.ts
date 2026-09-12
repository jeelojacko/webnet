/**
 * Phase 10N evidence: native 3D correction end-to-end wall campaign.
 *
 * Manual evidence campaign (never runs in CI; registered in
 * scripts/testTiers.ts EVIDENCE_TESTS). Real WASM, deterministic inputs,
 * fresh bundle init + warm-up per arm, 1 warm-up + 5 measured runs.
 *
 * Three arms per case: A pure-TS, B Phase 10M (correction OFF), C
 * experimental (correction ON). Reports A/B/C walls (median/p25/p75),
 * stage decomposition (correction/covariance kernel wrapper totals, S3
 * verify wall, C1/C2/C3 diagnostic re-run wall), S3 oracle tax, and the
 * A/B/C verdict (CLEAR WIN <=0.90, PARITY 0.90-1.10, REGRESSION >=1.10
 * on the C/B median ratio) with absolute ms.
 *
 * Full parity per case = result max abs diff < 1e-6 plus both route
 * verifications accepted with empty reasons, zero damping, zero
 * fallbacks, no truncation.
 *
 * Writes raw machine output to artifacts/evidence/phase10n/ (gitignored).
 * No production routing/math/tolerance/protocol changes.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

import { buildPhase6LargeBenchmarkCases, generatePhase6Large3dInput } from '../../src/engine/phase6BenchmarkNetworks';
import { createExperimentalSparseNumericalBundle } from '../../src/engine/wasm/experimentalSparseNumericalBundle';
import type {
  SparseCorrectionSolveInput,
  SparseCorrectionSolveResult,
  SparseCorrectionSolver,
  SparseSelectedCovarianceInput,
  SparseSelectedCovarianceResult,
  SparseSelectedCovarianceSolver,
} from '../../src/engine/numericalBackend';
import type { WebNetWasmFactory } from '../../src/engine/wasm/wasmTypes';
import { runAdjustmentSession } from '../../src/engine/runSession';
import {
  deriveNativeFullQxxEligibility,
  runWithNativeFullQxxAutoRoute,
  setNative3dCorrectionRouteEnabled,
  setNativeFullQxxRouteEnabled,
} from '../../src/workers/adjustmentNativeFullQxxAutoRoute';
import {
  NativeFullQxxCaptureSolver,
  finalizeNativeFullQxxVerification,
} from '../../src/workers/adjustmentNativeFullQxxAutoRoute';
import {
  SparseAutoRouteCaptureSolver,
  verifySparseAutoRouteSystems,
} from '../../src/workers/adjustmentSparseAutoRoute';
import { createRunSessionRequest } from '../helpers/runSessionRequest';

const MEASURED_RUNS = 5;
const PARITY_TOL = 1e-6;

const sorted = (xs: number[]): number[] => [...xs].sort((a, b) => a - b);
const median = (xs: number[]): number => sorted(xs)[Math.floor(xs.length / 2)] ?? 0;
const quantile = (xs: number[], q: number): number => {
  const s = sorted(xs);
  return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))] ?? 0;
};
const stats = (xs: number[]) => ({ p25: quantile(xs, 0.25), median: median(xs), p75: quantile(xs, 0.75), raw: [...xs] });

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
  return rounded(stable);
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
  JSON.stringify(comparable(a)) === JSON.stringify(comparable(b)) ? 0 : maxDiff(comparable(a), comparable(b));

const loadFactory = async (): Promise<WebNetWasmFactory> => {
  const mod = (await import(
    pathToFileURL(`${process.cwd()}/cpp/build-wasm/webnet_core.js`).href
  )) as { default: WebNetWasmFactory };
  if (typeof mod.default !== 'function') throw new Error('WASM factory missing');
  return mod.default;
};

interface CorrectionTap { wrapperMs: number[]; damping: number[]; attempts: number[]; condition: (number | undefined)[] }
interface CovarianceTap { wrapperMs: number[]; attempts: number[] }

const tappedCorrection = (delegate: SparseCorrectionSolver, tap: CorrectionTap): SparseCorrectionSolver => ({
  solveFromEquations(input: SparseCorrectionSolveInput): SparseCorrectionSolveResult {
    const t = performance.now();
    const r = delegate.solveFromEquations(input);
    tap.wrapperMs.push(performance.now() - t);
    tap.damping.push(r.damping);
    tap.attempts.push(r.dampingAttempts);
    tap.condition.push(r.conditionEstimate);
    return r;
  },
});

const tappedCovariance = (delegate: SparseSelectedCovarianceSolver, tap: CovarianceTap): SparseSelectedCovarianceSolver => ({
  querySelected(input: SparseSelectedCovarianceInput): SparseSelectedCovarianceResult {
    const t = performance.now();
    const r = delegate.querySelected(input);
    tap.wrapperMs.push(performance.now() - t);
    tap.attempts.push(r.dampingAttempts);
    return r;
  },
});

const toRequest = (input: string) => {
  const base = createRunSessionRequest({ input });
  return { ...base, parseSettings: { ...base.parseSettings, coordMode: '3D' as const, suspectImpactMode: 'off' as const } };
};

const verdictOf = (ratio: number): string =>
  ratio <= 0.9 ? 'CLEAR WIN' : ratio >= 1.1 ? 'REGRESSION' : 'PARITY';

describe('Phase 10N native correction evidence campaign', () => {
  it('A/B/C walls + stage decomposition + S3 tax + verdict', async () => {
    setNativeFullQxxRouteEnabled(true);
    setNative3dCorrectionRouteEnabled(false);
    try {
      await runCampaign();
    } finally {
      setNativeFullQxxRouteEnabled(true);
      setNative3dCorrectionRouteEnabled(false);
    }
  }, 1200000);
});

const runCampaign = async (): Promise<void> => {
  const factory = await loadFactory();
  const bundle = await createExperimentalSparseNumericalBundle(factory);
  const benchmark = buildPhase6LargeBenchmarkCases(false);
  const fixtureInput = (id: string): string => {
    const found = benchmark.find((item) => item.id === id);
    if (!found) throw new Error(`Missing genuine 3D fixture ${id}.`);
    return found.input;
  };
  const realistic384 = generatePhase6Large3dInput({
    id: 'gps-3d-128-alt',
    family: 'gps-2d',
    unknownCount: 128,
    seed: 7777,
    variant: 'gps-covariance',
    dimension: '3d',
  });
  const corpus = [
    { id: 'gps-3d-32', input: fixtureInput('gps-3d-32'), cohort: 'ladder' },
    { id: 'gps-3d-64', input: fixtureInput('gps-3d-64'), cohort: 'ladder' },
    { id: 'gps-3d-128', input: fixtureInput('gps-3d-128'), cohort: 'ladder (~384 params)' },
    { id: 'gps-3d-128-altseed', input: realistic384, cohort: 'realistic alternate geometry (~384 params)' },
  ];
  const rows: Record<string, unknown>[] = [];

  for (const { id, input, cohort } of corpus) {
    const request = toRequest(input);
    const eligibility = deriveNativeFullQxxEligibility(request);
    expect(eligibility.eligible, `${id} must be route-eligible`).toBe(true);
    const numParams = eligibility.numParams;

    // Arm A: pure TypeScript.
    runAdjustmentSession(request, undefined, undefined);
    const aWalls: number[] = [];
    let armA!: ReturnType<typeof runAdjustmentSession>;
    for (let i = 0; i < MEASURED_RUNS; i += 1) {
      const t = performance.now();
      armA = runAdjustmentSession(request, undefined, undefined);
      aWalls.push(performance.now() - t);
    }
    expect(armA.result.success, `${id} arm A must succeed`).toBe(true);
    expect(armA.result.converged, `${id} arm A must converge`).toBe(true);

    // Arm B: Phase 10M (correction OFF), tapped covariance kernel.
    setNative3dCorrectionRouteEnabled(false);
    const bCovTap: CovarianceTap = { wrapperMs: [], attempts: [] };
    const loadB = async () => ({
      sparseCorrectionSolver: bundle.sparseCorrectionSolver,
      sparseRowProductsSolver: bundle.sparseRowProductsSolver,
      sparseSelectedCovarianceSolver: tappedCovariance(bundle.sparseSelectedCovarianceSolver, bCovTap),
    });
    await runWithNativeFullQxxAutoRoute(request, undefined, { runSession: runAdjustmentSession, loadBundle: loadB });
    const bWalls: number[] = [];
    let armB!: Awaited<ReturnType<typeof runWithNativeFullQxxAutoRoute>>;
    for (let i = 0; i < MEASURED_RUNS; i += 1) {
      const t = performance.now();
      armB = await runWithNativeFullQxxAutoRoute(request, undefined, { runSession: runAdjustmentSession, loadBundle: loadB });
      bWalls.push(performance.now() - t);
    }
    expect(armB.route, `${id} arm B must take native route`).toBe('native-full-qxx');
    expect(armB.verification?.accepted, `${id} arm B C1/C2/C3 must accept`).toBe(true);
    expect(armB.correctionVerification, `${id} arm B must not run correction proof`).toBeUndefined();

    // Arm C: experimental (correction ON), tapped kernels.
    setNative3dCorrectionRouteEnabled(true);
    const cCorrTap: CorrectionTap = { wrapperMs: [], damping: [], attempts: [], condition: [] };
    const cCovTap: CovarianceTap = { wrapperMs: [], attempts: [] };
    const loadC = async () => ({
      sparseCorrectionSolver: tappedCorrection(bundle.sparseCorrectionSolver, cCorrTap),
      sparseRowProductsSolver: bundle.sparseRowProductsSolver,
      sparseSelectedCovarianceSolver: tappedCovariance(bundle.sparseSelectedCovarianceSolver, cCovTap),
    });
    await runWithNativeFullQxxAutoRoute(request, undefined, { runSession: runAdjustmentSession, loadBundle: loadC });
    const cWalls: number[] = [];
    let armC!: Awaited<ReturnType<typeof runWithNativeFullQxxAutoRoute>>;
    for (let i = 0; i < MEASURED_RUNS; i += 1) {
      const t = performance.now();
      armC = await runWithNativeFullQxxAutoRoute(request, undefined, { runSession: runAdjustmentSession, loadBundle: loadC });
      cWalls.push(performance.now() - t);
    }
    expect(armC.route, `${id} arm C must take native route`).toBe('native-full-qxx');
    expect(armC.reasons, `${id} arm C reasons empty`).toEqual([]);
    expect(armC.verification?.accepted, `${id} arm C C1/C2/C3 must accept`).toBe(true);
    expect(armC.correctionVerification?.accepted, `${id} arm C S3 must accept`).toBe(true);
    expect(armC.nativeCorrectionCalls, `${id} arm C correction calls == iterations`).toBe(armC.outcome.result.iterations);

    // Parity + proof evidence.
    const diffB = resultDiff(armA.result, armB.outcome.result);
    const diffC = resultDiff(armA.result, armC.outcome.result);
    expect(diffB, `${id} A/B parity`).toBeLessThan(PARITY_TOL);
    expect(diffC, `${id} A/C parity`).toBeLessThan(PARITY_TOL);
    expect(armC.outcome.result.iterations, `${id} iteration counts match`).toBe(armA.result.iterations);
    expect(Math.max(0, ...cCorrTap.attempts), `${id} no correction damping`).toBe(0);
    expect(Math.max(0, ...cCovTap.attempts), `${id} no covariance damping`).toBe(0);

    // Diagnostic stage run: one extra instrumented C solve; time the S3
    // and C1/C2/C3 verification walls directly over the captures. The
    // production route uses the cached inline finalizer (µs-scale); the
    // diagnostic re-runs bound the oracle scale honestly.
    const { createExperimentalSparseRouteDiagnostics } = await import('../../src/engine/experimentalSparseDiagnostics');
    const diagCorr = new SparseAutoRouteCaptureSolver(bundle.sparseCorrectionSolver);
    const diagCov = new NativeFullQxxCaptureSolver(bundle.sparseSelectedCovarianceSolver);
    const diagOutcome = runAdjustmentSession(request, undefined, {
      sparseCorrectionSolver: diagCorr,
      sparseSelectedCovarianceSolver: diagCov,
      experimentalSparseDiagnostics: createExperimentalSparseRouteDiagnostics(),
      experimentalSelectedCovarianceMode: false,
      allowVerifiedNativeDenseQxxReuse: true,
    });
    expect(diagOutcome.result.success, `${id} diagnostic solve must succeed`).toBe(true);
    const s3Walls: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      const t = performance.now();
      verifySparseAutoRouteSystems(diagCorr.systems, diagCorr.truncated, diagOutcome.result.iterations, diagOutcome.result.condition?.estimate);
      s3Walls.push(performance.now() - t);
    }
    const c123Walls: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      const t = performance.now();
      finalizeNativeFullQxxVerification(diagCov.systems, diagCov.getInlineVerifications(), diagCov.truncated, numParams);
      c123Walls.push(performance.now() - t);
    }

    const a = stats(aWalls);
    const b = stats(bWalls);
    const c = stats(cWalls);
    const perRunCorrKernel = cCorrTap.wrapperMs.length > 0
      ? cCorrTap.wrapperMs.reduce((s, v) => s + v, 0) / MEASURED_RUNS : 0;
    const perRunCovKernel = cCovTap.wrapperMs.length > 0
      ? cCovTap.wrapperMs.reduce((s, v) => s + v, 0) / MEASURED_RUNS : 0;
    const s3 = stats(s3Walls);
    const c123 = stats(c123Walls);
    const ratioCB = c.median / b.median;
    const ratioCA = c.median / a.median;
    rows.push({
      id, cohort, numParams, iterations: armC.outcome.result.iterations,
      armAWallMs: a, armBWallMs: b, armCWallMs: c,
      ratioExperimentalOver10M: ratioCB, ratioExperimentalOverTs: ratioCA,
      verdictVs10M: verdictOf(ratioCB), verdictVsTs: verdictOf(ratioCA),
      absoluteDeltaCvsBMs: c.median - b.median, absoluteDeltaCvsAMs: c.median - a.median,
      stageDecompositionMs: {
        correctionKernelWrapperPerRun: perRunCorrKernel,
        covarianceKernelWrapperPerRun: perRunCovKernel,
        s3VerifyMedian: s3.median,
        c123DiagnosticRerunMedian: c123.median,
        note: 'kernel wrappers measured inline across measured C runs; S3/C1C2C3 timed as diagnostic re-runs over one instrumented capture (production C1/C2/C3 uses the cached inline finalizer)',
      },
      s3OracleTaxMs: s3.median,
      correctionProof: {
        nativeCorrectionCalls: armC.nativeCorrectionCalls,
        oracledSystems: armC.correctionVerification?.oracledSystemCount ?? null,
        maxCorrectionDiff: armC.correctionVerification?.maxCorrectionDiff ?? null,
        maxC1Diff: armC.verification?.maxC1Diff ?? null,
        maxC2Residual: armC.verification?.maxC2Residual ?? null,
        nativeConditionFirst: cCorrTap.condition[0] ?? null,
        resultCondition: armC.outcome.result.condition?.estimate ?? null,
      },
      resultMaxAbsDiffB: diffB, resultMaxAbsDiffC: diffC,
      parity: diffB < PARITY_TOL && diffC < PARITY_TOL ? 'pass' : 'FAIL',
    });
    setNative3dCorrectionRouteEnabled(false);
  }

  const machineDir = join(process.cwd(), 'artifacts/evidence/phase10n');
  mkdirSync(machineDir, { recursive: true });
  const payload = {
    environment: { node: process.version, platform: process.platform, arch: process.arch },
    methodology: {
      measuredRuns: MEASURED_RUNS, warmupPerArm: 1, parityTol: PARITY_TOL,
      arms: 'A pure-TS, B 10M (correction OFF), C experimental (correction ON)',
      classes: '<=0.90 CLEAR WIN, 0.90-1.10 PARITY, >=1.10 REGRESSION (C/B median)',
    },
    cases: rows,
  };
  writeFileSync(join(machineDir, 'phase10n-evidence.json'), `${JSON.stringify(payload, null, 1)}\n`);
  expect(rows.length).toBe(corpus.length);
};
