/**
 * Phase 10P evidence: native correction verification-boundary study.
 *
 * STUDY ONLY — zero production/routing/default/cap/eligibility/tolerance/
 * S3/C1-C3 changes; correction stays OFF outside this suite's tapped arms.
 * Manual evidence campaign (never runs in CI; registered in
 * scripts/testTiers.ts EVIDENCE_TESTS). Real WASM, deterministic inputs,
 * 1 warm-up + measured runs.
 *
 * Per case the suite captures every correction system behind the
 * default-OFF correction route (arm C) and records, per system:
 * - authoritative S3 verdict (verifySparseAutoRouteSystems),
 * - diagnostic S3 cost split (copy/P/N/factorize/solve/compare/condition),
 *   bit-identical to the production oracle rebuild,
 * - matrix-free residual candidate verdict + timing (shadow mode),
 * - S0–S5 strategy verdicts + scorecard.
 *
 * Plus: derivation test (matrix-free lhs/u vs dense N/u), fault injection
 * (>=20 forms), weak-mode/adversarial with weak-direction perturbations,
 * tolerance separation sweep, stale/wrong-system proofs, 2D cross-check
 * (read-only), benchmark shadow overhead + floor estimates, and a
 * NOT-RUN browser note (no three-arm harness).
 *
 * Writes raw machine output to artifacts/evidence/phase10p/ (gitignored).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

import { accumulateNormalEquationsFromSparseRows } from '../../src/engine/matrixSparse';
import { generatePhase5BenchmarkInput } from '../../src/engine/phase5BenchmarkNetworks';
import { generatePhase6Large3dInput } from '../../src/engine/phase6BenchmarkNetworks';
import {
  applyPackedWeights,
  classifyShadow,
  computeMatrixFreeResidual,
  evaluateCorrectionResidual,
  PHASE10P_STRATEGY_NAMES,
  type Phase10pStrategyName,
} from '../../src/engine/phase10pCorrectionResidual';
import { measureS3CostSplit } from '../../src/engine/phase10pS3CostSplit';
import {
  solvePhase7b7DenseSystem,
  unpackPhase7b7DesignRows,
  type Phase7b7CapturedSystem,
} from '../../src/engine/phase7b7DenseRebuild';
import { estimateSparseNormalCondition } from '../../src/engine/sparseNormalCondition';
import { solveNormalEquations } from '../../src/engine/adjustNormalEquationHelpers';
import { createExperimentalSparseNumericalBundle } from '../../src/engine/wasm/experimentalSparseNumericalBundle';
import type {
  SparseCorrectionSolveResult,
  SparseCorrectionSolver,
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
  type CapturedAutoRouteSystem,
} from '../../src/workers/adjustmentSparseAutoRoute';
import { createRunSessionRequest } from '../helpers/runSessionRequest';

const S3_TOL = 1e-9;

const sorted = (xs: number[]): number[] => [...xs].sort((a, b) => a - b);
const median = (xs: number[]): number => sorted(xs)[Math.floor(xs.length / 2)] ?? 0;

const loadFactory = async (): Promise<WebNetWasmFactory> => {
  const mod = (await import(
    pathToFileURL(`${process.cwd()}/cpp/build-wasm/webnet_core.js`).href
  )) as { default: WebNetWasmFactory };
  if (typeof mod.default !== 'function') throw new Error('WASM factory missing');
  return mod.default;
};

const toRequest = (input: string, coordMode: '3D' | '2D' = '3D') => {
  const base = createRunSessionRequest({ input });
  return { ...base, parseSettings: { ...base.parseSettings, coordMode, suspectImpactMode: 'off' as const } };
};

interface CaseSpec { id: string; unknownCount: number; seed: number }

const LADDER: CaseSpec[] = [
  { id: 'gps-3d-cov-08', unknownCount: 8, seed: 2308 },
  { id: 'gps-3d-32', unknownCount: 32, seed: 2332 },
  { id: 'gps-3d-64', unknownCount: 64, seed: 2364 },
  { id: 'gps-3d-85', unknownCount: 85, seed: 2385 },
  { id: 'gps-3d-128', unknownCount: 128, seed: 2381 },
  { id: 'gps-3d-128-altseed', unknownCount: 128, seed: 7777 },
];

const caseInput = (spec: CaseSpec): string =>
  generatePhase6Large3dInput({
    id: spec.id, family: 'gps-2d', unknownCount: spec.unknownCount,
    seed: spec.seed, variant: 'gps-covariance', dimension: '3d',
  });

// ---- 10M realistic 32-unknown variant filters (verbatim pattern) ----
const dropPrefixes = (input: string, prefixes: string[]): string =>
  input.split('\n').filter((line) => !prefixes.some((p) => line.startsWith(`${p} `))).join('\n');
const CHAIN_PAIRS_32 = 33;
const stripCrossLinks = (input: string, keepPrefixes: string[]): string => {
  const counters: Record<string, number> = {};
  return input.split('\n').filter((line) => {
    const prefix = line.split(' ')[0] ?? '';
    if (!keepPrefixes.includes(prefix) || !['D', 'B', 'V'].includes(prefix)) return true;
    counters[prefix] = (counters[prefix] ?? 0) + 1;
    return (counters[prefix] ?? 0) <= CHAIN_PAIRS_32;
  }).join('\n');
};
const keepCrossOnly = (input: string, keepPrefixes: string[]): string => {
  const counters: Record<string, number> = {};
  return input.split('\n').filter((line) => {
    const prefix = line.split(' ')[0] ?? '';
    if (!keepPrefixes.includes(prefix) || !['D', 'B', 'V'].includes(prefix)) return true;
    counters[prefix] = (counters[prefix] ?? 0) + 1;
    return (counters[prefix] ?? 0) > CHAIN_PAIRS_32;
  }).join('\n');
};
const uneven = (input: string): string => {
  const counters: Record<string, number> = {};
  return input.split('\n').filter((line) => {
    const prefix = line.split(' ')[0] ?? '';
    if (!['D', 'B', 'V'].includes(prefix)) return true;
    counters[prefix] = (counters[prefix] ?? 0) + 1;
    const idx = counters[prefix] ?? 0;
    if (idx <= CHAIN_PAIRS_32) return true;
    return (idx - CHAIN_PAIRS_32 - 1) % 2 === 0;
  }).join('\n');
};
const VARIANTS: { id: string; note: string; build: (_base: string) => string }[] = [
  { id: 'corpus-dist-heavy-32', note: 'distance+height only', build: (b) => dropPrefixes(b, ['B', 'G']) },
  { id: 'corpus-mixed-full-32', note: 'mixed D+B+V+G', build: (b) => b },
  { id: 'corpus-gps-dist-32', note: 'GPS+distance+height', build: (b) => dropPrefixes(b, ['B']) },
  { id: 'corpus-terrestrial-only-32', note: 'terrestrial D+B+V', build: (b) => dropPrefixes(b, ['G']) },
  { id: 'corpus-weak-chain-32', note: 'weak long chain', build: (b) => stripCrossLinks(dropPrefixes(b, ['G']), ['D', 'B', 'V']) },
  { id: 'corpus-low-redundancy-32', note: 'low redundancy D+V+GPS', build: (b) => stripCrossLinks(dropPrefixes(b, ['B']), ['D', 'V']) },
  { id: 'corpus-uneven-32', note: 'uneven connectivity', build: uneven },
  { id: 'corpus-compact-32', note: 'compact cross-links+GPS', build: (b) => keepCrossOnly(b, ['D', 'B', 'V']) },
];

const flatCorrection = (result: SparseCorrectionSolveResult, params: number): number[] =>
  Array.from({ length: params }, (_, p) => result.correction[p]?.[0] ?? Number.NaN);

const copySystem = (input: Phase7b7CapturedSystem): Phase7b7CapturedSystem => ({
  design: {
    rowOffsets: Int32Array.from(input.design.rowOffsets),
    columns: Int32Array.from(input.design.columns),
    values: Float64Array.from(input.design.values),
  },
  weights: {
    rows: Int32Array.from(input.weights.rows),
    columns: Int32Array.from(input.weights.columns),
    values: Float64Array.from(input.weights.values),
  },
  misclosures: Float64Array.from(input.misclosures),
  observationEquationCount: input.observationEquationCount,
  parameterCount: input.parameterCount,
});

/** Single-system S3 verdict (value/damping/condition gates; count gate needs a session). */
const s3Single = (system: Phase7b7CapturedSystem, result: SparseCorrectionSolveResult): boolean =>
  verifySparseAutoRouteSystems(
    [{ input: system, result, threw: false }], false, 1, result.conditionEstimate,
  ).accepted;

interface StrategyVerdicts { name: Phase10pStrategyName; pass: boolean; costMs: number }

const judgeStrategies = (
  system: Phase7b7CapturedSystem,
  result: SparseCorrectionSolveResult,
  firstCondition: number | undefined,
  candidateTol: number,
): StrategyVerdicts[] => {
  const dx = flatCorrection(result, system.parameterCount);
  const out: StrategyVerdicts[] = [];
  const timed = <T,>(fn: () => T): { value: T; ms: number } => {
    const t = performance.now();
    const value = fn();
    return { value, ms: performance.now() - t };
  };
  // S0 legacy S3 (reference).
  const s0 = timed(() => s3Single(system, result));
  out.push({ name: 'S0-legacy-S3', pass: s0.value, costMs: s0.ms });
  // S1 residual-only.
  const s1 = timed(() => evaluateCorrectionResidual(system,
    { correction: dx, damping: result.damping, conditionEstimate: result.conditionEstimate },
    { tolerance: candidateTol, requireUndamped: false, requireFiniteCondition: false }).pass);
  out.push({ name: 'S1-residual-only', pass: s1.value, costMs: s1.ms });
  // S2 residual + first-system condition (cached per session).
  const s2 = timed(() => {
    if (firstCondition == null || !Number.isFinite(firstCondition)) return false;
    return evaluateCorrectionResidual(system,
      { correction: dx, damping: 0, conditionEstimate: firstCondition },
      { tolerance: candidateTol, requireUndamped: false, requireFiniteCondition: true }).pass;
  });
  out.push({ name: 'S2-residual-plus-first-condition', pass: s2.value, costMs: s2.ms });
  // S3 residual + metadata + per-system condition (native report, no recompute).
  const s3 = timed(() => evaluateCorrectionResidual(system,
    { correction: dx, damping: result.damping, conditionEstimate: result.conditionEstimate },
    { tolerance: candidateTol, requireUndamped: true, requireFiniteCondition: true }).pass);
  out.push({ name: 'S3-residual-plus-metadata', pass: s3.value, costMs: s3.ms });
  // S4 residual + metadata + first-system condition only.
  const s4 = timed(() => {
    if (firstCondition == null || !Number.isFinite(firstCondition)) return false;
    return evaluateCorrectionResidual(system,
      { correction: dx, damping: result.damping, conditionEstimate: firstCondition },
      { tolerance: candidateTol, requireUndamped: true, requireFiniteCondition: true }).pass;
  });
  out.push({ name: 'S4-residual-sampled-condition', pass: s4.value, costMs: s4.ms });
  return out;
};

describe('Phase 10P correction verification evidence campaign', () => {
  it('s3-split + residual shadow + faults + strategies + corpus + floor', async () => {
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
  const dir = join(process.cwd(), 'artifacts', 'evidence', 'phase10p');
  mkdirSync(dir, { recursive: true });

  const caseRows: Record<string, unknown>[] = [];
  const splitAt384: Record<string, unknown>[] = [];
  const validRelative: number[] = [];
  const faultRelative: { form: string; relative: number; s3: boolean; s1: boolean }[] = [];
  const shadowCounts: Record<string, number> = {
    'both-pass': 0, 's3-fail-candidate-pass': 0, 's3-pass-candidate-fail': 0, 'both-fail': 0,
  };
  const shadowGatedCounts: Record<string, number> = {
    'both-pass': 0, 's3-fail-candidate-pass': 0, 's3-pass-candidate-fail': 0, 'both-fail': 0,
  };
  const shadowNativeGatedCounts: Record<string, number> = {
    'both-pass': 0, 's3-fail-candidate-pass': 0, 's3-pass-candidate-fail': 0, 'both-fail': 0,
  };
  const nativeConditions: { id: string; index: number; native: unknown; packed: unknown }[] = [];
  const falseAcceptsUngated: Record<string, unknown>[] = [];
  const falseAcceptsGated: Record<string, unknown>[] = [];
  const strategyCosts: Record<string, number[]> = Object.fromEntries(PHASE10P_STRATEGY_NAMES.map((n) => [n, []]));
  const strategyValidPass: Record<string, number> = Object.fromEntries(PHASE10P_STRATEGY_NAMES.map((n) => [n, 0]));
  const strategyValidTotal: Record<string, number> = Object.fromEntries(PHASE10P_STRATEGY_NAMES.map((n) => [n, 0]));
  let firstSystemForDerivation: { system: Phase7b7CapturedSystem; dx: number[] } | null = null;
  let weakChainSystem: { system: Phase7b7CapturedSystem; dx: number[] } | null = null;
  const staleRows: Record<string, unknown>[] = [];
  let prevCaseFirst: { system: Phase7b7CapturedSystem; dx: number[] } | null = null;

  const captureFor = async (input: string): Promise<{
    systems: CapturedAutoRouteSystem[]; iterations: number; wallMs: number;
  }> => {
    const request = toRequest(input);
    setNative3dCorrectionRouteEnabled(true);
    const capture = new SparseAutoRouteCaptureSolver(bundle.sparseCorrectionSolver);
    const covCapture = new (await import('../../src/workers/adjustmentNativeFullQxxAutoRoute')).NativeFullQxxCaptureSolver(
      bundle.sparseSelectedCovarianceSolver,
    );
    const load = async (): Promise<{
      sparseCorrectionSolver: SparseCorrectionSolver;
      sparseRowProductsSolver: typeof bundle.sparseRowProductsSolver;
      sparseSelectedCovarianceSolver: SparseSelectedCovarianceSolver;
    }> => ({
      sparseCorrectionSolver: capture,
      sparseRowProductsSolver: bundle.sparseRowProductsSolver,
      sparseSelectedCovarianceSolver: covCapture,
    });
    runAdjustmentSession(request, undefined, undefined); // warm-up
    const t = performance.now();
    const outcome = await runWithNativeFullQxxAutoRoute(request, undefined, { runSession: runAdjustmentSession, loadBundle: load });
    const wallMs = performance.now() - t;
    setNative3dCorrectionRouteEnabled(false);
    return { systems: [...capture.systems], iterations: outcome.outcome.result.iterations, wallMs };
  };

  const allCases: { id: string; input: string; cohort: string; note: string }[] = [
    ...LADDER.map((spec) => ({ id: spec.id, input: caseInput(spec), cohort: 'ladder', note: `${spec.unknownCount} unknowns` })),
    ...VARIANTS.map((v) => {
      const base = caseInput({ id: 'gps-3d-32', unknownCount: 32, seed: 2332 });
      return { id: v.id, input: v.build(base), cohort: 'realistic-32', note: v.note };
    }),
  ];

  for (const { id, input, cohort, note } of allCases) {
    const request = toRequest(input);
    const eligibility = deriveNativeFullQxxEligibility(request);
    // Arm A: pure TypeScript reference.
    const armA = runAdjustmentSession(request, undefined, undefined);
    expect(armA.result.success, `${id} arm A success`).toBe(true);
    expect(armA.result.converged, `${id} arm A converged`).toBe(true);
    if (!eligibility.eligible || eligibility.numParams == null) {
      caseRows.push({ id, cohort, note, eligible: false, reasons: eligibility.reasons, status: 'excluded' });
      continue;
    }
    const numParams: number = eligibility.numParams;
    const { systems, iterations, wallMs } = await captureFor(input);
    expect(systems.length, `${id} capture count == iterations`).toBe(iterations);
    // Authoritative S3 verdict uses the route's own recorded condition.
    // S3 REJECTION is study data, not a failure: rejected cohorts must show
    // zero unexplained candidate false-accepts and are recorded as such.
    const s3 = systems.length > 0 && systems[0]?.result
      ? verifySparseAutoRouteSystems(systems, false, iterations, systems[0]?.result?.conditionEstimate)
      : { accepted: false, reasons: ['no captured systems'], warnings: [], oracledSystemCount: 0, maxCorrectionDiff: Number.NaN };

    const firstCondition = systems[0]?.result?.conditionEstimate;
    let s3TotalMs = 0;
    let candidateTotalMs = 0;
    const perSystem: Record<string, unknown>[] = [];
    systems.forEach((sys, index) => {
      const result = sys.result;
      if (!result || sys.threw) throw new Error(`${id} system ${index} missing result`);
      const dx = flatCorrection(result, sys.input.parameterCount);
      // S3 cost split (timed) + candidate (timed) + strategies.
      const splitT = performance.now();
      const split = measureS3CostSplit(sys.input, dx);
      const splitMs = performance.now() - splitT;
      expect(split.bitIdenticalOracle, `${id}[${index}] split bit-identical`).toBe(true);
      expect(split.phases.attributionPct, `${id}[${index}] attribution >=95`).toBeGreaterThanOrEqual(95);
      const candT = performance.now();
      const candidate = evaluateCorrectionResidual(sys.input,
        { correction: dx, damping: result.damping, conditionEstimate: result.conditionEstimate },
        { tolerance: S3_TOL });
      const candMs = performance.now() - candT;
      s3TotalMs += splitMs;
      candidateTotalMs += candMs;
      const singleS3 = s3Single(sys.input, result);
      const shadow = classifyShadow(singleS3, candidate.pass);
      shadowCounts[shadow] = (shadowCounts[shadow] ?? 0) + 1;
      // Condition-gated candidate (§12): fail closed to S3 whenever the
      // independent TS-packed estimate exceeds the production threshold.
      // This is STRICTER than S3 (warn-only) — safe direction; rejects here
      // mean "fall back to S3", never "accept".
      const gateEstimate = split.conditionEstimate;
      const gatedPass = candidate.pass && gateEstimate != null && gateEstimate <= 1e12;
      const gatedShadow = classifyShadow(singleS3, gatedPass);
      // Native-first gate (§12): the S3-effective estimate prefers the native
      // backend report and falls back to TS-packed only when non-finite.
      const nativeFirst = result.conditionEstimate != null && Number.isFinite(result.conditionEstimate)
        ? result.conditionEstimate : gateEstimate;
      const nativeGatedPass = candidate.pass && nativeFirst != null && nativeFirst <= 1e12;
      const nativeGatedShadow = classifyShadow(singleS3, nativeGatedPass);
      shadowNativeGatedCounts[nativeGatedShadow] = (shadowNativeGatedCounts[nativeGatedShadow] ?? 0) + 1;
      shadowGatedCounts[gatedShadow] = (shadowGatedCounts[gatedShadow] ?? 0) + 1;
      if (gatedShadow === 's3-fail-candidate-pass') {
        falseAcceptsGated.push({
          id, index, params: sys.input.parameterCount,
          maxCorrectionDiff: split.maxCorrectionDiff,
          relativeResidual: candidate.metrics.relativeResidual,
          conditionEstimate: gateEstimate, damping: split.damping,
        });
      }
      if (shadow === 's3-fail-candidate-pass') {
        // Headline study datum (NOT an assertion failure): on weak geometry
        // a wildly wrong correction can still have a tiny residual, because
        // N is near-singular along the weak direction. Recorded with the
        // correction diff + condition that prove the mechanism.
        falseAcceptsUngated.push({
          id, index, params: sys.input.parameterCount,
          maxCorrectionDiff: split.maxCorrectionDiff,
          relativeResidual: candidate.metrics.relativeResidual,
          conditionEstimate: gateEstimate, damping: split.damping,
          gatedShadow,
        });
      }
      if (s3.accepted) {
        expect(shadow, `${id}[${index}] shadow both-pass`).toBe('both-pass');
        validRelative.push(candidate.metrics.relativeResidual);
      }
      const strategies = judgeStrategies(sys.input, result, firstCondition, S3_TOL);
      if (index === 0) strategies.push({ name: 'S5-first-full-rest-cheap', pass: s3Single(sys.input, result), costMs: splitMs });
      else {
        const s4 = strategies.find((s) => s.name === 'S4-residual-sampled-condition');
        strategies.push({ name: 'S5-first-full-rest-cheap', pass: s4?.pass ?? false, costMs: s4?.costMs ?? 0 });
      }
      for (const st of strategies) {
        strategyCosts[st.name]?.push(st.costMs);
        if (s3.accepted) {
          strategyValidTotal[st.name] = (strategyValidTotal[st.name] ?? 0) + 1;
          if (st.pass) strategyValidPass[st.name] = (strategyValidPass[st.name] ?? 0) + 1;
        }
      }
      nativeConditions.push({ id, index, native: result.conditionEstimate ?? null, packed: split.conditionEstimate ?? null });
      perSystem.push({
        index, params: sys.input.parameterCount, equations: sys.input.observationEquationCount,
        s3SplitMs: splitMs, phases: split.phases, maxCorrectionDiff: split.maxCorrectionDiff,
        damping: split.damping, conditionEstimate: split.conditionEstimate,
        nativeConditionEstimate: result.conditionEstimate ?? null,
        candidateMs: candMs, relativeResidual: candidate.metrics.relativeResidual,
        shadow, gatedShadow,
        strategies: strategies.map((s) => ({ name: s.name, pass: s.pass, costMs: s.costMs })),
      });
      if (numParams === 384) {
        splitAt384.push({
          id, index, params: numParams,
          copyMs: split.phases.copyMs, densePBuildMs: split.phases.densePBuildMs,
          accumulateMs: split.phases.accumulateMs, factorizeMs: split.phases.factorizeMs,
          solveMs: split.phases.solveMs, compareMs: split.phases.compareMs,
          conditionMs: split.phases.conditionMs, aggregateMs: split.phases.aggregateMs,
          totalMs: split.phases.totalMs, attributionPct: split.phases.attributionPct,
        });
      }
    });
    // Stale/wrong-system proofs (§23): prev-iter system + current dx; same-N
    // diff-RHS only where a second iteration exists.
    if (systems.length >= 2) {
      const prev = systems[systems.length - 2];
      const cur = systems[systems.length - 1];
      if (prev?.result && cur?.result) {
        const curDx = flatCorrection(cur.result, cur.input.parameterCount);
        const staleS3 = verifySparseAutoRouteSystems(
          [{ input: prev.input, result: cur.result, threw: false }], false, 1, cur.result.conditionEstimate,
        ).accepted;
        const staleCand = evaluateCorrectionResidual(prev.input,
          { correction: curDx, damping: cur.result.damping, conditionEstimate: cur.result.conditionEstimate },
          { tolerance: S3_TOL });
        staleRows.push({ id, kind: 'prev-iter-system-with-current-dx', s3Accepted: staleS3, candidatePass: staleCand.pass });
      }
    }
    if (prevCaseFirst && systems[0]?.result && prevCaseFirst.system.parameterCount === systems[0].input.parameterCount) {
      const dx = flatCorrection(systems[0].result, systems[0].input.parameterCount);
      const crossS3 = verifySparseAutoRouteSystems(
        [{ input: prevCaseFirst.system, result: systems[0].result, threw: false }], false, 1,
        systems[0].result.conditionEstimate,
      ).accepted;
      const crossCand = evaluateCorrectionResidual(prevCaseFirst.system,
        { correction: dx, damping: systems[0].result.damping, conditionEstimate: systems[0].result.conditionEstimate },
        { tolerance: S3_TOL });
      staleRows.push({ id, kind: 'same-dims-diff-network-system', s3Accepted: crossS3, candidatePass: crossCand.pass });
    }
    if (systems[0]?.result) {
      prevCaseFirst = {
        system: copySystem(systems[0].input),
        dx: flatCorrection(systems[0].result, systems[0].input.parameterCount),
      };
      // Derivation/fault base: first ACCEPTED first-system (dense dx is the
      // valid reference, so native-backend quirks cannot pollute the study).
      if (!firstSystemForDerivation && s3.accepted) {
        const denseDx = solvePhase7b7DenseSystem(systems[0].input);
        firstSystemForDerivation = { system: copySystem(systems[0].input), dx: denseDx };
      }
      if (id === 'corpus-weak-chain-32') {
        // Valid weak-geometry reference is the dense oracle solve itself,
        // independent of whether S3 accepted the native backend's attempt.
        const denseDx = solvePhase7b7DenseSystem(systems[0].input);
        weakChainSystem = { system: copySystem(systems[0].input), dx: denseDx };
      }
    }
    // S3 re-verify wall (authoritative path) for the overhead floor.
    const reT = performance.now();
    verifySparseAutoRouteSystems(systems, false, iterations, systems[0]?.result?.conditionEstimate);
    const s3VerifyMs = performance.now() - reT;
    caseRows.push({
      id, cohort, note, eligible: true, numParams, iterations,
      status: s3.accepted ? 'measured' : 's3-rejected',
      s3Reasons: s3.reasons,
      armCWallMs: wallMs, s3VerifyMs, s3SplitTotalMs: s3TotalMs, candidateTotalMs,
      perSystem,
    });
  }

  // ---- §3 derivation test: matrix-free lhs/u vs dense N/u ----
  if (!firstSystemForDerivation) throw new Error('No derivation system captured.');
  {
    const { system, dx } = firstSystemForDerivation;
    const rows = unpackPhase7b7DesignRows(system.design);
    const m = system.observationEquationCount;
    const denseP: number[][] = Array.from({ length: m }, () => new Array<number>(m).fill(0));
    for (let k = 0; k < system.weights.values.length; k += 1) {
      const r = system.weights.rows[k] ?? 0;
      const c = system.weights.columns[k] ?? 0;
      const v = system.weights.values[k] ?? 0;
      (denseP[r] as number[])[c] = v;
      (denseP[c] as number[])[r] = v;
    }
    const w = Array.from(system.misclosures, (value) => [value]);
    const { normal: N, rhs: u } = accumulateNormalEquationsFromSparseRows(rows, w, denseP, system.parameterCount);
    const { residual } = computeMatrixFreeResidual(system, dx);
    // Recompute lhs/u elementwise for the comparison.
    const { multiplyPackedDesign, multiplyPackedDesignTranspose } = await import('../../src/engine/phase10pCorrectionResidual');
    const tt = new Array<number>(m).fill(0);
    multiplyPackedDesign(system, dx, tt);
    const z = new Array<number>(m).fill(0);
    applyPackedWeights(system, tt, z);
    const lhs = new Array<number>(system.parameterCount).fill(0);
    multiplyPackedDesignTranspose(system, z, lhs);
    const y = new Array<number>(m).fill(0);
    applyPackedWeights(system, system.misclosures, y);
    const uu = new Array<number>(system.parameterCount).fill(0);
    multiplyPackedDesignTranspose(system, y, uu);
    let worstLhs = 0;
    let worstU = 0;
    for (let a = 0; a < system.parameterCount; a += 1) {
      let ndx = 0;
      for (let b = 0; b < system.parameterCount; b += 1) ndx += (N[a]?.[b] ?? 0) * (dx[b] ?? 0);
      const denom = Math.max(1, Math.abs(ndx));
      worstLhs = Math.max(worstLhs, Math.abs(lhs[a]! - ndx) / denom);
      const udenom = Math.max(1, Math.abs(u[a]?.[0] ?? 0));
      worstU = Math.max(worstU, Math.abs(uu[a]! - (u[a]?.[0] ?? 0)) / udenom);
    }
    expect(worstLhs, 'matrix-free lhs matches N·dx').toBeLessThan(1e-9);
    expect(worstU, 'matrix-free u matches dense rhs').toBeLessThan(1e-9);
    expect(residual.length, 'residual length').toBe(system.parameterCount);
  }

  // ---- §9 fault injection (>=20 forms) on a 96-param first system ----
  const faultBase = firstSystemForDerivation;
  if (faultBase) {
    const denseDx = solvePhase7b7DenseSystem(faultBase.system);
    const forms: { name: string; dx: number[]; system: Phase7b7CapturedSystem; damping: number; condition: number | undefined }[] = [];
    const dxOf = (mutate: (_dx: number[]) => void): number[] => {
      const dx = [...denseDx];
      mutate(dx);
      return dx;
    };
    const sysOf = (mutate: (_s: Phase7b7CapturedSystem) => void): Phase7b7CapturedSystem => {
      const s = copySystem(faultBase.system);
      mutate(s);
      return s;
    };
    const okCond = estimateSafeCondition(faultBase.system);
    for (const mag of [1e-12, 1e-10, 1e-9, 1e-8, 1e-6]) {
      forms.push({ name: `dx-bias-${mag}`, dx: dxOf((d) => { d[0] = (d[0] ?? 0) + mag; }), system: copySystem(faultBase.system), damping: 0, condition: okCond });
    }
    forms.push({ name: 'dx-sign-flip', dx: dxOf((d) => { d[1] = -(d[1] ?? 0); }), system: copySystem(faultBase.system), damping: 0, condition: okCond });
    forms.push({ name: 'dx-zero-param', dx: dxOf((d) => { d[2] = 0; }), system: copySystem(faultBase.system), damping: 0, condition: okCond });
    forms.push({
      name: 'dx-swap-params', dx: dxOf((d) => { const a = d[3] ?? 0; d[3] = d[4] ?? 0; d[4] = a; }),
      system: copySystem(faultBase.system), damping: 0, condition: okCond,
    });
    forms.push({ name: 'dx-scale-1.001', dx: denseDx.map((v) => v * 1.001), system: copySystem(faultBase.system), damping: 0, condition: okCond });
    forms.push({ name: 'dx-NaN', dx: dxOf((d) => { d[0] = Number.NaN; }), system: copySystem(faultBase.system), damping: 0, condition: okCond });
    forms.push({ name: 'dx-plusInf', dx: dxOf((d) => { d[0] = Number.POSITIVE_INFINITY; }), system: copySystem(faultBase.system), damping: 0, condition: okCond });
    forms.push({
      name: 'weight-zero-diag', dx: [...denseDx],
      system: sysOf((s) => { const i = s.weights.values.findIndex((v) => v !== 0); if (i >= 0) s.weights.values[i] = 0; }),
      damping: 0, condition: okCond,
    });
    forms.push({
      name: 'weight-sign-flip', dx: [...denseDx],
      system: sysOf((s) => { const i = s.weights.values.findIndex((v) => v !== 0); if (i >= 0) s.weights.values[i] = -(s.weights.values[i] ?? 0); }),
      damping: 0, condition: okCond,
    });
    forms.push({
      name: 'truncate-last-equation', dx: [...denseDx],
      system: sysOf((s) => {
        s.observationEquationCount -= 1;
        s.misclosures = s.misclosures.slice(0, s.observationEquationCount);
      }),
      damping: 0, condition: okCond,
    });
    forms.push({
      name: 'same-N-diff-RHS', dx: [...denseDx],
      system: sysOf((s) => { s.misclosures[0] = (s.misclosures[0] ?? 0) + 1e-3; }),
      damping: 0, condition: okCond,
    });
    forms.push({
      name: 'reorder-misclosures', dx: [...denseDx],
      system: sysOf((s) => {
        const a = s.misclosures[0] ?? 0;
        s.misclosures[0] = s.misclosures[1] ?? 0;
        s.misclosures[1] = a;
      }),
      damping: 0, condition: okCond,
    });
    forms.push({
      name: 'weight-scale-2x', dx: [...denseDx],
      system: sysOf((s) => { for (let i = 0; i < s.weights.values.length; i += 1) s.weights.values[i] = (s.weights.values[i] ?? 0) * 2; }),
      damping: 0, condition: okCond,
    });
    forms.push({ name: 'damping-1e-3-reported', dx: [...denseDx], system: copySystem(faultBase.system), damping: 1e-3, condition: okCond });
    forms.push({ name: 'condition-Inf-reported', dx: [...denseDx], system: copySystem(faultBase.system), damping: 0, condition: Number.POSITIVE_INFINITY });
    forms.push({ name: 'condition-missing', dx: [...denseDx], system: copySystem(faultBase.system), damping: 0, condition: undefined });
    expect(forms.length, 'fault forms >= 20').toBeGreaterThanOrEqual(20);
    for (const form of forms) {
      const fake: SparseCorrectionSolveResult = {
        correction: form.dx.map((v) => [v]),
        damping: form.damping,
        dampingAttempts: form.damping === 0 ? 0 : 1,
        conditionEstimate: form.condition,
        designNnz: 0, weightNnz: 0, normalNnz: 0, factorNnz: 0,
        ordering: 'phase10p-fault', solver: 'phase10p-fault',
      };
      let s3: boolean;
      try {
        s3 = s3Single(form.system, fake);
      } catch {
        s3 = false;
      }
      const cand = evaluateCorrectionResidual(form.system,
        { correction: form.dx, damping: form.damping, conditionEstimate: form.condition }, { tolerance: S3_TOL });
      const candNoMeta = evaluateCorrectionResidual(form.system,
        { correction: form.dx, damping: form.damping, conditionEstimate: form.condition },
        { tolerance: S3_TOL, requireUndamped: false, requireFiniteCondition: false });
      faultRelative.push({ form: form.name, relative: cand.metrics.relativeResidual, s3, s1: candNoMeta.pass });
      // Every fault S3 rejects must also be rejected by the metadata-bearing
      // candidate; S1 (residual-only) is EXPECTED to miss metadata faults.
      if (!s3) expect(cand.pass, `fault ${form.name}: candidate must agree with S3 reject`).toBe(false);
    }
  }

  // ---- §10 weak-mode/adversarial: weak-direction-aligned perturbations ----
  const weakRows: Record<string, unknown>[] = [];
  if (weakChainSystem) {
    const { system, dx } = weakChainSystem;
    const rows = unpackPhase7b7DesignRows(system.design);
    const m = system.observationEquationCount;
    const denseP: number[][] = Array.from({ length: m }, () => new Array<number>(m).fill(0));
    for (let k = 0; k < system.weights.values.length; k += 1) {
      const r = system.weights.rows[k] ?? 0;
      const c = system.weights.columns[k] ?? 0;
      const v = system.weights.values[k] ?? 0;
      (denseP[r] as number[])[c] = v;
      (denseP[c] as number[])[r] = v;
    }
    const w = Array.from(system.misclosures, (value) => [value]);
    const { normal: N, rhs: u } = accumulateNormalEquationsFromSparseRows(rows, w, denseP, system.parameterCount);
    const solved = solveNormalEquations(N, u, { log: () => undefined, recoverCovariance: true });
    const qxx = solved.qxx ?? [];
    let weakParam = 0;
    let weakVar = -1;
    for (let a = 0; a < system.parameterCount; a += 1) {
      const v = qxx[a]?.[a] ?? 0;
      if (v > weakVar) { weakVar = v; weakParam = a; }
    }
    for (const mag of [1e-12, 1e-10, 1e-9, 1e-8, 1e-6]) {
      const perturbed = [...dx];
      perturbed[weakParam] = (perturbed[weakParam] ?? 0) + mag;
      const s3 = s3Single(system, {
        correction: perturbed.map((v) => [v]), damping: 0, dampingAttempts: 0, conditionEstimate: okCondFor(system),
        designNnz: 0, weightNnz: 0, normalNnz: 0, factorNnz: 0,
        ordering: 'phase10p-weak', solver: 'phase10p-weak',
      });
      const cand = evaluateCorrectionResidual(system,
        { correction: perturbed, damping: 0, conditionEstimate: okCondFor(system) }, { tolerance: S3_TOL });
      // No agreement assertion here: weak-direction blindness is the study's
      // headline datum — S3 rejects (direct correction diff) while the
      // residual stays quiet (near-null N direction). Recorded, not asserted.
      weakRows.push({ weakParam, weakVariance: weakVar, magnitude: mag, s3Accepted: s3, candidatePass: cand.pass, relative: cand.metrics.relativeResidual });
    }
    // Valid weak-geometry solve must pass both.
    const validCand = evaluateCorrectionResidual(system,
      { correction: dx, damping: 0, conditionEstimate: okCondFor(system) }, { tolerance: S3_TOL });
    weakRows.push({ kind: 'valid-weak-solve', candidatePass: validCand.pass, relative: validCand.metrics.relativeResidual });
    expect(validCand.pass, 'valid weak solve passes candidate').toBe(true);
  }

  // ---- §17 2D cross-check (read-only; no Phase7 behavior change) ----
  const twoD: Record<string, unknown> = { status: 'not-run' };
  try {
    const input2d = generatePhase5BenchmarkInput({ id: 'chain-2d-16', family: 'chain-2d', unknownCount: 16, seed: 1116 });
    const request2d = toRequest(input2d, '2D');
    const capture2d = new SparseAutoRouteCaptureSolver(bundle.sparseCorrectionSolver);
    const outcome2d = runAdjustmentSession(request2d, undefined, {
      sparseCorrectionSolver: capture2d,
    });
    const per2d = capture2d.systems.map((sys, index) => {
      const result = sys.result;
      if (!result || sys.threw) return { index, status: 'no-result' };
      const dx = flatCorrection(result, sys.input.parameterCount);
      const cand = evaluateCorrectionResidual(sys.input,
        { correction: dx, damping: result.damping, conditionEstimate: result.conditionEstimate }, { tolerance: S3_TOL });
      return { index, status: 'measured', candidatePass: cand.pass, relative: cand.metrics.relativeResidual, candidateMs: cand.timing.totalMs };
    });
    Object.assign(twoD, {
      status: 'measured', success: outcome2d.result.success, converged: outcome2d.result.converged,
      captured: capture2d.systems.length, iterations: outcome2d.result.iterations, perSystem: per2d,
    });
  } catch (error) {
    Object.assign(twoD, { status: 'error', detail: error instanceof Error ? error.message : String(error) });
  }

  // ---- §11 tolerance sweep: VALID vs FAULT separation ----
  const validSorted = sorted(validRelative.filter((v) => Number.isFinite(v)));
  const faultSorted = sorted(faultRelative.map((f) => f.relative).filter((v) => Number.isFinite(v)));
  const maxValid = validSorted[validSorted.length - 1] ?? Number.NaN;
  const minFault = faultSorted[0] ?? Number.NaN;
  const sweep: Record<string, unknown>[] = [];
  for (const tol of [1e-12, 1e-11, 1e-10, 1e-9, 1e-8, 1e-7, 1e-6]) {
    const validRejects = validSorted.filter((v) => v > tol).length;
    const faultMisses = faultRelative.filter((f) => !(f.relative > tol)).length;
    sweep.push({ tolerance: tol, validRejects, validTotal: validSorted.length, faultMisses, faultTotal: faultRelative.length });
  }

  const strategyScorecard = PHASE10P_STRATEGY_NAMES.map((name) => {
    const costs = sorted(strategyCosts[name] ?? []);
    return {
      name,
      validPass: strategyValidPass[name] ?? 0,
      validTotal: strategyValidTotal[name] ?? 0,
      medianCostMs: costs.length > 0 ? median(costs) : null,
      p95CostMs: costs.length > 0 ? costs[Math.min(costs.length - 1, Math.floor(0.95 * (costs.length - 1)))] : null,
    };
  });

  const report = {
    study: 'phase10p-correction-verification',
    productionUnchanged: true,
    correctionDefaultOff: true,
    shadowCounts,
    shadowGatedCounts,
    shadowNativeGatedCounts,
    nativeConditions,
    falseAcceptsUngated,
    falseAcceptsGated,
    splitAt384,
    staleRows,
    faultRelative,
    weakRows,
    toleranceSeparation: { maxValidRelative: maxValid, minFaultRelative: minFault, sweep },
    strategyScorecard,
    twoDimensionalCrossCheck: twoD,
    cases: caseRows,
  };
  writeFileSync(join(dir, 'phase10p-correction-verification.json'), JSON.stringify(report, null, 2));
};

const estimateSafeCondition = (system: Phase7b7CapturedSystem): number | undefined => {
  try {
    const estimate = estimateSparseNormalCondition(system.design, system.weights, system.parameterCount);
    return Number.isFinite(estimate) ? estimate : undefined;
  } catch {
    return undefined;
  }
};

const okCondFor = (system: Phase7b7CapturedSystem): number | undefined => estimateSafeCondition(system);
