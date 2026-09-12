/**
 * Phase 10O evidence: native factorization lifecycle study.
 *
 * STUDY ONLY — diagnostic instrumentation, no production/routing/default/
 * cap/eligibility/tolerance/S3/C1-C3 changes. Manual evidence campaign
 * (never runs in CI; registered in scripts/testTiers.ts EVIDENCE_TESTS).
 * Real WASM, deterministic generator inputs, 1 warm-up + 5 measured runs.
 *
 * Per case (10-case <=384-param corpus) the suite captures, behind the
 * default-OFF correction route (arm C):
 * - deterministic fingerprints (FNV-1a pattern + values hashes) of every
 *   correction-iteration packed system and the final covariance system,
 * - L0-L4 reuse classification of iter i->i+1 and last-correction->final,
 * - symbolic-vs-numeric split via selected-covariance phase timings run
 *   diagnostically on the SAME captured correction systems (small diagonal
 *   query set; never production), plus inline timings of the final system,
 * - kernel wrapper walls (correction + covariance), S3 re-verify wall,
 * - full parity (A vs C < 1e-6), S3 + C1/C2/C3 accepted, zero damping,
 *   zero fallbacks, no truncation.
 *
 * Plus fixed-system CURRENT benchmarks (correction+covariance calls) at
 * 96/192/255/384 params and a compact 384-param A/B/C wall campaign.
 * No factor-handle prototype exists (built only if the audit showed
 * material potential); memory §12 is estimated from reported nnz metadata.
 *
 * Writes raw machine output to artifacts/evidence/phase10o/ (gitignored).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

import { generatePhase6Large3dInput } from '../../src/engine/phase6BenchmarkNetworks';
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
  SparseAutoRouteCaptureSolver,
  verifySparseAutoRouteSystems,
} from '../../src/workers/adjustmentSparseAutoRoute';
import { NativeFullQxxCaptureSolver } from '../../src/workers/adjustmentNativeFullQxxAutoRoute';
import { createRunSessionRequest } from '../helpers/runSessionRequest';

const MEASURED_RUNS = 5;
const PARITY_TOL = 1e-6;
/** Quantization step for values-hash floats (design/weight/misclosure). */
const FP_QUANT = 1e-12;

const sorted = (xs: number[]): number[] => [...xs].sort((a, b) => a - b);
const median = (xs: number[]): number => sorted(xs)[Math.floor(xs.length / 2)] ?? 0;
const quantile = (xs: number[], q: number): number => {
  const s = sorted(xs);
  return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))] ?? 0;
};
const stats = (xs: number[]) => ({ p25: quantile(xs, 0.25), median: median(xs), p75: quantile(xs, 0.75), raw: [...xs] });

/** FNV-1a 32-bit over UTF-8 string chunks; hex output. */
const fnv1a = (chunks: string[]): string => {
  let hash = 0x811c9dc5;
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i += 1) {
      hash ^= chunk.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    hash ^= 0xff;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
};

const i32 = (a: ArrayLike<number>): string => Array.from(a, (v) => `${v | 0}`).join(',');
const f64q = (a: ArrayLike<number>): string =>
  Array.from(a, (v) => `${Math.round(v / FP_QUANT)}`).join(',');

interface FingerprintInput {
  parameterCount: number;
  observationEquationCount: number;
  rowOffsets: ArrayLike<number>;
  columns: ArrayLike<number>;
  values: ArrayLike<number>;
  weightRows: ArrayLike<number>;
  weightColumns: ArrayLike<number>;
  weightValues: ArrayLike<number>;
  misclosures: ArrayLike<number> | null;
}

interface Fingerprint { pattern: string; nValues: string; values: string; full: string }

const fingerprint = (s: FingerprintInput): Fingerprint => {
  const patternChunks = [
    `n=${s.parameterCount}`,
    `m=${s.observationEquationCount}`,
    `ro=${i32(s.rowOffsets)}`,
    `co=${i32(s.columns)}`,
    `wr=${i32(s.weightRows)}`,
    `wc=${i32(s.weightColumns)}`,
  ];
  // N-only hash: excludes misclosures so correction-vs-final systems are
  // comparable (RHS is unused in N accumulation). L3 (N same, RHS differs)
  // and L4 (bit-identical) are genuinely reachable on this hash.
  const nValueChunks = [...patternChunks, `dv=${f64q(s.values)}`, `wv=${f64q(s.weightValues)}`];
  const valueChunks = s.misclosures ? [...nValueChunks, `b=${f64q(s.misclosures)}`] : nValueChunks;
  return {
    pattern: fnv1a(patternChunks),
    nValues: fnv1a(nValueChunks),
    values: fnv1a(valueChunks),
    full: fnv1a([...valueChunks, s.misclosures ? 'rhs' : 'norhs']),
  };
};

/**
 * Reuse levels: L0 dims differ; L1 pattern differs; L2 pattern same,
 * values differ (symbolic reusable); L3 N values same, RHS differs
 * (solve-only reuse); L4 bit-identical (full reuse).
 */
const classify = (
  a: { pattern: string; values: string; full: string },
  b: { pattern: string; values: string; full: string },
  dimsEqual: boolean,
): string => {
  if (!dimsEqual) return 'L0';
  if (a.pattern !== b.pattern) return 'L1';
  if (a.values !== b.values) return 'L2';
  if (a.full !== b.full) return 'L3';
  return 'L4';
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

interface KernelTap { wrapperMs: number[]; damping: number[]; attempts: number[] }

const tappedCorrection = (delegate: SparseCorrectionSolver, tap: KernelTap): SparseCorrectionSolver => ({
  solveFromEquations(input: SparseCorrectionSolveInput): SparseCorrectionSolveResult {
    const t = performance.now();
    const r = delegate.solveFromEquations(input);
    tap.wrapperMs.push(performance.now() - t);
    tap.damping.push(r.damping);
    tap.attempts.push(r.dampingAttempts);
    return r;
  },
});

const tappedCovariance = (delegate: SparseSelectedCovarianceSolver, tap: KernelTap): SparseSelectedCovarianceSolver => ({
  querySelected(input: SparseSelectedCovarianceInput): SparseSelectedCovarianceResult {
    const t = performance.now();
    const r = delegate.querySelected(input);
    tap.wrapperMs.push(performance.now() - t);
    tap.damping.push(r.damping);
    tap.attempts.push(r.dampingAttempts);
    return r;
  },
});

const toRequest = (input: string) => {
  const base = createRunSessionRequest({ input });
  return { ...base, parseSettings: { ...base.parseSettings, coordMode: '3D' as const, suspectImpactMode: 'off' as const } };
};

interface CaseSpec { id: string; unknownCount: number; seed: number }

const CORPUS: CaseSpec[] = [
  { id: 'gps-3d-cov-08', unknownCount: 8, seed: 2308 },
  { id: 'gps-3d-16', unknownCount: 16, seed: 2316 },
  { id: 'gps-3d-32', unknownCount: 32, seed: 2332 },
  { id: 'gps-3d-48', unknownCount: 48, seed: 2348 },
  { id: 'gps-3d-64', unknownCount: 64, seed: 2364 },
  { id: 'gps-3d-85', unknownCount: 85, seed: 2385 },
  { id: 'gps-3d-96', unknownCount: 96, seed: 2396 },
  { id: 'gps-3d-112', unknownCount: 112, seed: 2412 },
  { id: 'gps-3d-128', unknownCount: 128, seed: 2381 },
  { id: 'gps-3d-128-altseed', unknownCount: 128, seed: 7777 },
];

const caseInput = (spec: CaseSpec): string =>
  generatePhase6Large3dInput({
    id: spec.id,
    family: 'gps-2d',
    unknownCount: spec.unknownCount,
    seed: spec.seed,
    variant: 'gps-covariance',
    dimension: '3d',
  });

describe('Phase 10O factorization lifecycle evidence campaign', () => {
  it('fingerprints + reuse classification + symbolic split + benchmarks + corpus', async () => {
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
  const caseRows: Record<string, unknown>[] = [];
  const levelCounts: Record<string, number> = { L0: 0, L1: 0, L2: 0, L3: 0, L4: 0 };
  const lastToFinalCounts: Record<string, number> = { L0: 0, L1: 0, L2: 0, L3: 0, L4: 0 };
  const optionBCounts: Record<string, number> = { A: 0, B: 0, C: 0, D: 0 };

  for (const spec of CORPUS) {
    const input = caseInput(spec);
    const request = toRequest(input);
    const eligibility = deriveNativeFullQxxEligibility(request);
    expect(eligibility.eligible, `${spec.id} must be route-eligible`).toBe(true);
    const numParams = eligibility.numParams;

    // Arm A: pure TypeScript reference.
    const armA = runAdjustmentSession(request, undefined, undefined);
    expect(armA.result.success, `${spec.id} arm A must succeed`).toBe(true);
    expect(armA.result.converged, `${spec.id} arm A must converge`).toBe(true);

    // Arm C: correction ON with capture + kernel taps. Each route call
    // gets fresh captures (warm-up state must not pollute fingerprints).
    setNative3dCorrectionRouteEnabled(true);
    const makeLoadC = (
      corrCapture: SparseAutoRouteCaptureSolver,
      covCapture: NativeFullQxxCaptureSolver,
      corrTap: KernelTap,
      covTap: KernelTap,
    ) => async () => ({
      sparseCorrectionSolver: tappedCorrection(corrCapture, corrTap),
      sparseRowProductsSolver: bundle.sparseRowProductsSolver,
      sparseSelectedCovarianceSolver: tappedCovariance(covCapture, covTap),
    });
    const corrTap: KernelTap = { wrapperMs: [], damping: [], attempts: [] };
    const covTap: KernelTap = { wrapperMs: [], damping: [], attempts: [] };
    const throwawayCorr: KernelTap = { wrapperMs: [], damping: [], attempts: [] };
    const throwawayCov: KernelTap = { wrapperMs: [], damping: [], attempts: [] };
    await runWithNativeFullQxxAutoRoute(request, undefined, {
      runSession: runAdjustmentSession,
      loadBundle: makeLoadC(
        new SparseAutoRouteCaptureSolver(bundle.sparseCorrectionSolver),
        new NativeFullQxxCaptureSolver(bundle.sparseSelectedCovarianceSolver),
        throwawayCorr,
        throwawayCov,
      ),
    });
    const corrCapture = new SparseAutoRouteCaptureSolver(bundle.sparseCorrectionSolver);
    const covCapture = new NativeFullQxxCaptureSolver(bundle.sparseSelectedCovarianceSolver);
    const loadC = makeLoadC(corrCapture, covCapture, corrTap, covTap);
    const t0 = performance.now();
    const armC = await runWithNativeFullQxxAutoRoute(request, undefined, { runSession: runAdjustmentSession, loadBundle: loadC });
    const cWall = performance.now() - t0;
    expect(armC.route, `${spec.id} arm C must take native route`).toBe('native-full-qxx');
    expect(armC.reasons, `${spec.id} arm C reasons empty`).toEqual([]);
    expect(armC.verification?.accepted, `${spec.id} arm C C1/C2/C3 must accept`).toBe(true);
    expect(armC.correctionVerification?.accepted, `${spec.id} arm C S3 must accept`).toBe(true);
    expect(armC.nativeCorrectionCalls, `${spec.id} correction calls == iterations`).toBe(armC.outcome.result.iterations);
    expect(corrCapture.truncated, `${spec.id} no correction truncation`).toBe(false);
    expect(covCapture.truncated, `${spec.id} no covariance truncation`).toBe(false);
    expect(Math.max(0, ...corrTap.attempts), `${spec.id} no correction damping`).toBe(0);
    expect(Math.max(0, ...covTap.attempts), `${spec.id} no covariance damping`).toBe(0);
    const diffC = resultDiff(armA.result, armC.outcome.result);
    expect(diffC, `${spec.id} A/C parity`).toBeLessThan(PARITY_TOL);

    // Fingerprints per correction iteration + final covariance system.
    const corrPrints = corrCapture.systems.map((s) =>
      fingerprint({
        parameterCount: s.input.parameterCount,
        observationEquationCount: s.input.observationEquationCount,
        rowOffsets: s.input.design.rowOffsets,
        columns: s.input.design.columns,
        values: s.input.design.values,
        weightRows: s.input.weights.rows,
        weightColumns: s.input.weights.columns,
        weightValues: s.input.weights.values,
        misclosures: s.input.misclosures,
      }),
    );
    expect(corrCapture.systems.length, `${spec.id} capture count == iterations`).toBe(armC.outcome.result.iterations);
    const finalCov = covCapture.systems[covCapture.systems.length - 1];
    if (!finalCov) throw new Error(`${spec.id} final covariance system missing`);
    const finalPrint = fingerprint({
      parameterCount: finalCov.parameterCount,
      observationEquationCount: finalCov.observationEquationCount,
      rowOffsets: finalCov.design.rowOffsets,
      columns: finalCov.design.columns,
      values: finalCov.design.values,
      weightRows: finalCov.weights.rows,
      weightColumns: finalCov.weights.columns,
      weightValues: finalCov.weights.values,
      misclosures: null,
    });

    // Iter i -> i+1 classification (RHS-inclusive: L4 means bit-identical
    // incl. misclosures). Also record N-only agreement to detect genuine
    // RHS-only diffs (same N, changed RHS).
    const iterPairs: string[] = [];
    let rhsOnlyPairs = 0;
    for (let i = 0; i + 1 < corrPrints.length; i += 1) {
      const a = corrPrints[i];
      const b = corrPrints[i + 1];
      if (!a || !b) continue;
      const dimsEqual =
        corrCapture.systems[i]?.input.parameterCount === corrCapture.systems[i + 1]?.input.parameterCount &&
        corrCapture.systems[i]?.input.observationEquationCount === corrCapture.systems[i + 1]?.input.observationEquationCount;
      const level = classify(a, b, dimsEqual);
      iterPairs.push(level);
      levelCounts[level] = (levelCounts[level] ?? 0) + 1;
      if (dimsEqual && a.nValues === b.nValues && a.values !== b.values) rhsOnlyPairs += 1;
    }
    // Last-correction -> final-cov on the N-only hash (values + full both
    // N-derived; the rhs/norhs tag in full makes L3 genuinely reachable:
    // identical N yields L3, bit-identical packed systems would yield L4).
    const last = corrPrints[corrPrints.length - 1];
    const lastNOnly = last ? { pattern: last.pattern, values: last.nValues, full: last.full } : null;
    const finalNOnly = { pattern: finalPrint.pattern, values: finalPrint.nValues, full: finalPrint.full };
    const lastDimsEqual =
      corrCapture.systems[corrCapture.systems.length - 1]?.input.parameterCount === finalCov.parameterCount &&
      corrCapture.systems[corrCapture.systems.length - 1]?.input.observationEquationCount === finalCov.observationEquationCount;
    const lastToFinal = lastNOnly ? classify(lastNOnly, finalNOnly, lastDimsEqual) : 'L0';
    lastToFinalCounts[lastToFinal] = (lastToFinalCounts[lastToFinal] ?? 0) + 1;
    // Option-B outcomes: A=L4 full reuse, B=L3 solve-only, C=L2 symbolic-only, D=L0/L1 nothing.
    const optionB = lastToFinal === 'L4' ? 'A' : lastToFinal === 'L3' ? 'B' : lastToFinal === 'L2' ? 'C' : 'D';
    optionBCounts[optionB] = (optionBCounts[optionB] ?? 0) + 1;

    // Symbolic-vs-numeric proxy: run the selected-covariance entry point
    // diagnostically on each captured correction system with a small
    // diagonal query set; report native analyze/factorize/solve split for
    // that exact system. Never production.
    const proxySplits: Record<string, unknown>[] = [];
    for (let i = 0; i < corrCapture.systems.length; i += 1) {
      const s = corrCapture.systems[i];
      if (!s) continue;
      const n = s.input.parameterCount;
      const k = Math.min(16, n);
      const queryRows = new Int32Array(k);
      const queryColumns = new Int32Array(k);
      for (let q = 0; q < k; q += 1) {
        queryRows[q] = q;
        queryColumns[q] = q;
      }
      const r = bundle.sparseSelectedCovarianceSolver.querySelected({
        design: s.input.design,
        weights: s.input.weights,
        observationEquationCount: s.input.observationEquationCount,
        parameterCount: n,
        queryRows,
        queryColumns,
      });
      proxySplits.push({
        iteration: i,
        analyzeMs: r.timings?.analyzeMs ?? null,
        factorizeMs: r.timings?.factorizeMs ?? null,
        solveMs: r.timings?.solveMs ?? null,
        assemblyMs: r.timings?.assemblyMs ?? null,
        equilibrationMs: r.timings?.equilibrationMs ?? null,
        normalNnz: r.normalNnz,
        factorNnz: r.factorNnz,
        timingsPresent: r.timings !== undefined,
      });
    }
    const finalTimings = finalCov.result.timings;

    // S3 re-verify wall (diagnostic re-run over the capture).
    const s3Walls: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      const t = performance.now();
      verifySparseAutoRouteSystems(
        corrCapture.systems,
        corrCapture.truncated,
        armC.outcome.result.iterations,
        armC.outcome.result.condition?.estimate,
      );
      s3Walls.push(performance.now() - t);
    }

    caseRows.push({
      id: spec.id,
      numParams: eligibility.numParams,
      iterations: armC.outcome.result.iterations,
      eqCounts: corrCapture.systems.map((s) => s.input.observationEquationCount),
      finalEqCount: finalCov.observationEquationCount,
      iterFingerprints: corrPrints.map((p, i) => ({ iteration: i, pattern: p.pattern, nValues: p.nValues, values: p.values })),
      finalFingerprint: { pattern: finalPrint.pattern, nValues: finalPrint.nValues, values: finalPrint.values },
      iterPairs,
      rhsOnlyPairs,
      lastToFinal,
      optionB,
      proxySplits,
      finalTimings: finalTimings ?? null,
      finalNnz: { normalNnz: finalCov.result.normalNnz, factorNnz: finalCov.result.factorNnz },
      corrKernelWrapperMs: [...corrTap.wrapperMs],
      covKernelWrapperMs: [...covTap.wrapperMs],
      endToEndWallMs: cWall,
      s3ReverifyMs: stats(s3Walls),
      maxAbsDiffC: diffC,
      nativeCorrectionCalls: armC.nativeCorrectionCalls,
      maxC1Diff: armC.verification?.maxC1Diff ?? null,
      maxC2Residual: armC.verification?.maxC2Residual ?? null,
      maxCorrectionDiff: armC.correctionVerification?.maxCorrectionDiff ?? null,
    });
    void numParams;
    setNative3dCorrectionRouteEnabled(false);
  }

  // Fixed-system CURRENT benchmarks at 96/192/255/384 params.
  const benchSizes = [CORPUS[2], CORPUS[4], CORPUS[5], CORPUS[8]];
  const benchRows: Record<string, unknown>[] = [];
  for (const spec of benchSizes as CaseSpec[]) {
    const input = caseInput(spec);
    const request = toRequest(input);
    const eligibility = deriveNativeFullQxxEligibility(request);
    setNative3dCorrectionRouteEnabled(true);
    const corrTap: KernelTap = { wrapperMs: [], damping: [], attempts: [] };
    const covTap: KernelTap = { wrapperMs: [], damping: [], attempts: [] };
    const throwTap = (): KernelTap => ({ wrapperMs: [], damping: [], attempts: [] });
    const warmLoad = async () => ({
      sparseCorrectionSolver: tappedCorrection(bundle.sparseCorrectionSolver, throwTap()),
      sparseRowProductsSolver: bundle.sparseRowProductsSolver,
      sparseSelectedCovarianceSolver: tappedCovariance(bundle.sparseSelectedCovarianceSolver, throwTap()),
    });
    const loadC = async () => ({
      sparseCorrectionSolver: tappedCorrection(bundle.sparseCorrectionSolver, corrTap),
      sparseRowProductsSolver: bundle.sparseRowProductsSolver,
      sparseSelectedCovarianceSolver: tappedCovariance(bundle.sparseSelectedCovarianceSolver, covTap),
    });
    await runWithNativeFullQxxAutoRoute(request, undefined, { runSession: runAdjustmentSession, loadBundle: warmLoad });
    const walls: number[] = [];
    for (let i = 0; i < MEASURED_RUNS; i += 1) {
      const t = performance.now();
      await runWithNativeFullQxxAutoRoute(request, undefined, { runSession: runAdjustmentSession, loadBundle: loadC });
      walls.push(performance.now() - t);
    }
    const perRunCorr = corrTap.wrapperMs.reduce((s, v) => s + v, 0) / MEASURED_RUNS;
    const perRunCov = covTap.wrapperMs.reduce((s, v) => s + v, 0) / MEASURED_RUNS;
    benchRows.push({
      id: spec.id,
      numParams: eligibility.numParams,
      endToEndWallMs: stats(walls),
      correctionKernelPerRunMs: perRunCorr,
      covarianceKernelPerRunMs: perRunCov,
    });
    setNative3dCorrectionRouteEnabled(false);
  }

  // Compact 384-param A/B/C wall campaign (gps-3d-128).
  const ref384 = caseInput(CORPUS[8] as CaseSpec);
  const refRequest = toRequest(ref384);
  runAdjustmentSession(refRequest, undefined, undefined);
  const aWalls: number[] = [];
  for (let i = 0; i < MEASURED_RUNS; i += 1) {
    const t = performance.now();
    runAdjustmentSession(refRequest, undefined, undefined);
    aWalls.push(performance.now() - t);
  }
  setNative3dCorrectionRouteEnabled(false);
  const loadB = async () => ({
    sparseCorrectionSolver: bundle.sparseCorrectionSolver,
    sparseRowProductsSolver: bundle.sparseRowProductsSolver,
    sparseSelectedCovarianceSolver: bundle.sparseSelectedCovarianceSolver,
  });
  await runWithNativeFullQxxAutoRoute(refRequest, undefined, { runSession: runAdjustmentSession, loadBundle: loadB });
  const bWalls: number[] = [];
  for (let i = 0; i < MEASURED_RUNS; i += 1) {
    const t = performance.now();
    await runWithNativeFullQxxAutoRoute(refRequest, undefined, { runSession: runAdjustmentSession, loadBundle: loadB });
    bWalls.push(performance.now() - t);
  }
  setNative3dCorrectionRouteEnabled(true);
  const loadC384 = async () => ({
    sparseCorrectionSolver: bundle.sparseCorrectionSolver,
    sparseRowProductsSolver: bundle.sparseRowProductsSolver,
    sparseSelectedCovarianceSolver: bundle.sparseSelectedCovarianceSolver,
  });
  await runWithNativeFullQxxAutoRoute(refRequest, undefined, { runSession: runAdjustmentSession, loadBundle: loadC384 });
  const cWalls: number[] = [];
  for (let i = 0; i < MEASURED_RUNS; i += 1) {
    const t = performance.now();
    await runWithNativeFullQxxAutoRoute(refRequest, undefined, { runSession: runAdjustmentSession, loadBundle: loadC384 });
    cWalls.push(performance.now() - t);
  }
  setNative3dCorrectionRouteEnabled(false);
  const a = stats(aWalls);
  const b = stats(bWalls);
  const c = stats(cWalls);

  const machineDir = join(process.cwd(), 'artifacts/evidence/phase10o');
  mkdirSync(machineDir, { recursive: true });
  const payload = {
    environment: { node: process.version, platform: process.platform, arch: process.arch },
    methodology: {
      measuredRuns: MEASURED_RUNS,
      warmupPerArm: 1,
      parityTol: PARITY_TOL,
      fingerprint: 'FNV-1a over param/eq counts + rowOffsets/columns/weight-structure (pattern) + quantized (1e-12) design/weight values (nValues, N-only) + misclosures where present (values) + rhs/norhs tag (full)',
      reuseLevels: 'L0 dims-differ, L1 pattern-differs, L2 pattern-same/values-differ, L3 N-same/RHS-differs, L4 bit-identical',
      timingProxy: 'selected-covariance native phase timings run diagnostically on captured correction systems (<=16 diagonal queries); correction ABI exposes no timings',
    },
    cases: caseRows,
    iterPairLevelCounts: levelCounts,
    lastToFinalLevelCounts: lastToFinalCounts,
    optionBOutcomeCounts: optionBCounts,
    fixedSystemBenchmarks: benchRows,
    abc384: {
      armAWallMs: a,
      armBWallMs: b,
      armCWallMs: c,
      ratioCOverB: c.median / b.median,
      ratioCOverA: c.median / a.median,
    },
  };
  writeFileSync(join(machineDir, 'phase10o-evidence.json'), `${JSON.stringify(payload, null, 1)}\n`);
  expect(caseRows.length).toBe(CORPUS.length);
};
