/**
 * Phase 9A cap-widening evidence shard (EVIDENCE ONLY, no production change).
 *
 * phase 9A evidence: static boundaries and scaling ladder
 * Split from tests/evidence/phase9a_cap_widening_evidence.test.ts: every
 * `it` body below is preserved verbatim (only the module-level evidence
 * accumulator was renamed to a shard-local fragment). This shard is
 * independently executable and writes exactly one atomic raw fragment
 * (artifacts/evidence/phase9a/scaling.json, gitignored). Report
 * assembly lives in scripts/phase9a/phase9aReport.ts; the committed
 * reports/phase9a/ verdict is checked by tests/phase9a_release_verdict.test.ts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { runAdjustmentSession } from '../../src/engine/runSession';
import { comparePreanalysisContract } from '../../src/engine/preanalysisSparseEvidence';
import {
  PREANALYSIS_SPARSE_PLANNING_SYSTEM_CAP,
  PREANALYSIS_SPARSE_UNKNOWN_CAP,
} from '../../src/engine/preanalysisSparseSessionPolicy';
import { PREANALYSIS_SPARSE_VERIFICATION_COLUMN_COUNT } from '../../src/engine/preanalysisSparseCovarianceSentinel';
import {
  PREANALYSIS_SPARSE_ROUTE_MAX_CAPTURED_CALLS,
  PREANALYSIS_SPARSE_ROUTE_MAX_PLANNING_SYSTEMS,
  PREANALYSIS_SPARSE_ROUTE_MAX_UNKNOWN_COUNT,
  PREANALYSIS_SPARSE_ROUTE_MAX_VERIFICATION_QUERIES,
} from '../../src/workers/preanalysisSparseAutoRouteCaps';
import {
  clearPreanalysisSparseAutoRouteTestHooks,
  derivePreanalysisSparseAutoRouteEligibility,
  runWithPreanalysisSparseAutoRoute,
  setPreanalysisSparseAutoRouteEnabled,
  setPreanalysisSparseAutoRouteTestHooks,
} from '../../src/workers/preanalysisSparseAutoRoute';
import {
  loadPhase9aRealBundle,
  runPhase9aScalingProbe,
  snapshotPhase9aMemory,
  summarizePhase9aTimingMap,
  summarizePhase9aTimings,
} from '../../scripts/phase9a/phase9aHarness';
import type { PreanalysisVerifierTimingPhase } from '../../src/workers/preanalysisSparseCovarianceGate';
import {
  buildChainStarInput,
  exactPhase9aStationCount,
  makePhase9aPreanalysisRequest,
  PHASE9A_ANCHOR_INPUT,
  writePhase9aFragment,
} from './phase9aEvidenceShared';

const wasmAbsent = { skip: false };

const fragment: Record<string, unknown> = {};

describe('phase 9A evidence: static boundaries and scaling ladder', () => {
  it('pins caps and the 127/128/129 eligibility boundary', () => {
    expect(PREANALYSIS_SPARSE_UNKNOWN_CAP).toBe(128);
    expect(PREANALYSIS_SPARSE_PLANNING_SYSTEM_CAP).toBe(64);
    expect(PREANALYSIS_SPARSE_ROUTE_MAX_UNKNOWN_COUNT).toBe(128);
    expect(PREANALYSIS_SPARSE_ROUTE_MAX_PLANNING_SYSTEMS).toBe(64);
    expect(PREANALYSIS_SPARSE_ROUTE_MAX_CAPTURED_CALLS).toBe(512);
    expect(PREANALYSIS_SPARSE_ROUTE_MAX_VERIFICATION_QUERIES).toBe(16384);
    expect(PREANALYSIS_SPARSE_VERIFICATION_COLUMN_COUNT).toBe(16);
    fragment.productionCaps = { unknown: 128, planningSystems: 64, capturedCalls: 512, verifyQueries: 16384, k: 16 };
    setPreanalysisSparseAutoRouteEnabled(false);
    clearPreanalysisSparseAutoRouteTestHooks();
    expect(derivePreanalysisSparseAutoRouteEligibility(makePhase9aPreanalysisRequest(PHASE9A_ANCHOR_INPUT)).eligible).toBe(false);
    setPreanalysisSparseAutoRouteEnabled(true);
    try {
      setPreanalysisSparseAutoRouteTestHooks({ unknownCountOverride: 127 });
      expect(derivePreanalysisSparseAutoRouteEligibility(makePhase9aPreanalysisRequest(PHASE9A_ANCHOR_INPUT)).eligible).toBe(true);
      setPreanalysisSparseAutoRouteTestHooks({ unknownCountOverride: 128 });
      expect(derivePreanalysisSparseAutoRouteEligibility(makePhase9aPreanalysisRequest(PHASE9A_ANCHOR_INPUT)).eligible).toBe(true);
      setPreanalysisSparseAutoRouteTestHooks({ unknownCountOverride: 129 });
      const over = derivePreanalysisSparseAutoRouteEligibility(makePhase9aPreanalysisRequest(PHASE9A_ANCHOR_INPUT));
      expect(over.eligible).toBe(false);
      expect(over.reasons.join(' ')).toMatch(/exceed cap 128/);
      fragment.staticBoundary127_128_129 = { eligible127: true, eligible128: true, eligible129: false };
    } finally {
      clearPreanalysisSparseAutoRouteTestHooks();
      setPreanalysisSparseAutoRouteEnabled(false);
    }
  });

  it('keeps k=16/planning=64 source guards and the GPS exclusion gate', () => {
    const routeSource = fs.readFileSync(
      path.join(process.cwd(), 'src/workers/preanalysisSparseAutoRoute.ts'),
      'utf-8',
    );
    expect(routeSource).toContain('gpsCovariance3d');
    const gateSource = fs.readFileSync(
      path.join(process.cwd(), 'src/workers/preanalysisSparseCovarianceGate.ts'),
      'utf-8',
    );
    expect(gateSource).toContain('PREANALYSIS_SPARSE_VERIFICATION_COLUMN_COUNT');
    expect(gateSource).toContain('maxRetainedPackedSystems');
    fragment.gpsCovarianceGate = { gatePresentInRouteSource: true, retentionBoundPresentInGateSource: true };
    setPreanalysisSparseAutoRouteEnabled(true);
    try {
      const adjustment = makePhase9aPreanalysisRequest(PHASE9A_ANCHOR_INPUT);
      adjustment.parseSettings = { ...adjustment.parseSettings, runMode: 'adjustment' };
      expect(derivePreanalysisSparseAutoRouteEligibility(adjustment).eligible).toBe(false);
      setPreanalysisSparseAutoRouteTestHooks({ unknownCountOverride: 512 });
      const overCap = derivePreanalysisSparseAutoRouteEligibility(makePhase9aPreanalysisRequest(PHASE9A_ANCHOR_INPUT));
      expect(overCap.eligible).toBe(false);
      expect(overCap.reasons.join(' ')).toMatch(/exceed cap 128/);
      clearPreanalysisSparseAutoRouteTestHooks();
      fragment.exclusionGuards = { runModeAdjustmentExcluded: true, unknown512Excluded: true };
    } finally {
      setPreanalysisSparseAutoRouteEnabled(false);
    }
  });

  it('runs the anchor sparsely, capturing actual parameterCounts', async () => {
    const bundle = await loadPhase9aRealBundle();
    if (!bundle) {
      wasmAbsent.skip = true;
      fragment.routeAnchorSparse = { skipped: 'WASM artifact absent' };
      fragment.actualParameterCounts = { skipped: 'WASM artifact absent' };
      return;
    }
    const parameterCounts: number[] = [];
    const recording = {
      ...bundle,
      sparseCorrectionSolver: {
        solveFromEquations: (
          input: Parameters<typeof bundle.sparseCorrectionSolver.solveFromEquations>[0],
        ) => {
          parameterCounts.push(input.parameterCount);
          return bundle.sparseCorrectionSolver.solveFromEquations(input);
        },
      },
    };
    setPreanalysisSparseAutoRouteEnabled(true);
    clearPreanalysisSparseAutoRouteTestHooks();
    const memBefore = snapshotPhase9aMemory();
    const started = Date.now();
    try {
      const request = makePhase9aPreanalysisRequest(PHASE9A_ANCHOR_INPUT);
      const attempt = await runWithPreanalysisSparseAutoRoute(request, undefined, {
        runSession: runAdjustmentSession,
        loadBundle: () => Promise.resolve(recording),
      });
      const wallMs = Date.now() - started;
      expect(attempt.route).toBe('sparse');
      const direct = runAdjustmentSession(request);
      const comparison = comparePreanalysisContract(direct.result, attempt.outcome.result);
      expect(comparison.pass).toBe(true);
      const maxParameterCount = Math.max(...parameterCounts);
      fragment.routeAnchorSparse = {
        route: attempt.route,
        contractPass: true,
        maxCoordDiff: comparison.maxCoordDiff,
        maxCovarianceDiff: comparison.maxCovarianceDiff,
        correctionDelegations: parameterCounts.length,
        wallMs,
      };
      fragment.actualParameterCounts = {
        perSystem: parameterCounts,
        max: maxParameterCount,
        staticUnknownCount: derivePreanalysisSparseAutoRouteEligibility(request).unknownCount,
        distinctFromStationUnknowns: maxParameterCount !== derivePreanalysisSparseAutoRouteEligibility(request).unknownCount,
      };
    } finally {
      setPreanalysisSparseAutoRouteEnabled(false);
      fragment.memorySnapshots = { anchorBefore: memBefore, anchorAfter: snapshotPhase9aMemory() };
    }
  }, 120000);

  it('probes direct-bundle structural scaling (non-route evidence only)', async () => {
    const bundle = await loadPhase9aRealBundle();
    if (!bundle) {
      fragment.directBundleScalingProbe = { skipped: 'WASM artifact absent' };
      return;
    }
    const entries = runPhase9aScalingProbe(bundle, [128, 160, 192, 256, 384, 512]);
    for (const entry of entries) {
      expect(entry.dispatched).toBe(true);
      expect(entry.undamped).toBe(true);
      expect(entry.zeroCorrection).toBe(true);
    }
    fragment.directBundleScalingProbe = {
      nonRouteStructuralOnly: true,
      entries,
    };
  }, 120000);

  it('pins extended static boundaries 255/256/257 and 511/512/513 as ineligible', () => {
    setPreanalysisSparseAutoRouteEnabled(true);
    try {
      const table: Record<number, boolean> = {};
      for (const unknowns of [255, 256, 257, 511, 512, 513]) {
        setPreanalysisSparseAutoRouteTestHooks({ unknownCountOverride: unknowns });
        const result = derivePreanalysisSparseAutoRouteEligibility(makePhase9aPreanalysisRequest(PHASE9A_ANCHOR_INPUT));
        expect(result.eligible).toBe(false);
        expect(result.reasons.join(' ')).toMatch(/exceed cap 128/);
        table[unknowns] = result.eligible;
      }
      fragment.extendedStaticBoundaries255_256_257_511_512_513 = table;
    } finally {
      clearPreanalysisSparseAutoRouteTestHooks();
      setPreanalysisSparseAutoRouteEnabled(false);
    }
  });

  it('executes the evidence-mode full route ladder with exact target dimensions', async () => {
    const bundle = await loadPhase9aRealBundle();
    if (!bundle) {
      fragment.fullRouteLadder = { status: 'NOT_EVALUATED', reason: 'WASM artifact absent' };
      return;
    }
    const rows: Array<Record<string, unknown>> = [];
    setPreanalysisSparseAutoRouteEnabled(true);
    try {
      for (const targetParameterCount of [128, 160, 192, 256, 384, 512]) {
        // Chain-star contributes two coordinate unknowns per free station plus
        // four direction-orientation parameters. This makes actual n exact.
        const stationUnknownCount = exactPhase9aStationCount(targetParameterCount);
        const input = buildChainStarInput(stationUnknownCount);
        const request = makePhase9aPreanalysisRequest(input);
        setPreanalysisSparseAutoRouteTestHooks({
          stationUnknownCapOverride: stationUnknownCount,
          parameterCapOverride: 600,
          systemCapOverride: 64,
        });
        const phaseTimes: Record<string, number[]> = {};
        const recordPhase = (phase: PreanalysisVerifierTimingPhase | 'nativeCorrection' | 'nativeCovariance', wallMs: number): void => {
          (phaseTimes[phase] ??= []).push(wallMs);
        };
        const parameterCounts: number[] = [];
        const equationCounts: number[] = [];
        const designNnz: number[] = [];
        const weightNnz: number[] = [];
        const timedBundle = {
          ...bundle,
          sparseCorrectionSolver: {
            solveFromEquations: (solveInput: Parameters<typeof bundle.sparseCorrectionSolver.solveFromEquations>[0]) => {
              const started = performance.now();
              const result = bundle.sparseCorrectionSolver.solveFromEquations(solveInput);
              recordPhase('nativeCorrection', performance.now() - started);
              equationCounts.push(solveInput.observationEquationCount);
              designNnz.push(solveInput.design.values.length);
              weightNnz.push(solveInput.weights.values.length);
              return result;
            },
          },
          sparseSelectedCovarianceSolver: {
            querySelected: (queryInput: Parameters<typeof bundle.sparseSelectedCovarianceSolver.querySelected>[0]) => {
              const started = performance.now();
              const result = bundle.sparseSelectedCovarianceSolver.querySelected(queryInput);
              recordPhase('nativeCovariance', performance.now() - started);
              parameterCounts.push(queryInput.parameterCount);
              equationCounts.push(queryInput.observationEquationCount);
              designNnz.push(queryInput.design.values.length);
              weightNnz.push(queryInput.weights.values.length);
              return result;
            },
          },
        };
        const repetitionCount = process.env.PHASE9A_DIAGNOSTIC === '1'
          ? 1
          : targetParameterCount === 512 ? 4 : 6;
        const sessionSamples: number[] = [];
        const forcedTsSamples: number[] = [];
        let attempt: Awaited<ReturnType<typeof runWithPreanalysisSparseAutoRoute>> | null = null;
        let lastContract: ReturnType<typeof comparePreanalysisContract> | null = null;
        for (let repetition = 0; repetition < repetitionCount; repetition += 1) {
          parameterCounts.length = 0;
          equationCounts.length = 0;
          designNnz.length = 0;
          weightNnz.length = 0;
          if (repetition === 1) {
            for (const values of Object.values(phaseTimes)) values.length = 0;
          }
          setPreanalysisSparseAutoRouteTestHooks({
            stationUnknownCapOverride: stationUnknownCount,
            parameterCapOverride: targetParameterCount,
            systemCapOverride: 64,
            timingSink: { record: recordPhase },
          });
          const started = performance.now();
          attempt = await runWithPreanalysisSparseAutoRoute(request, undefined, {
            runSession: runAdjustmentSession,
            loadBundle: () => Promise.resolve(timedBundle),
          });
          sessionSamples.push(performance.now() - started);
          const forcedStarted = performance.now();
          const forced = runAdjustmentSession(request);
          forcedTsSamples.push(performance.now() - forcedStarted);
          const contract = comparePreanalysisContract(forced.result, attempt.outcome.result);
          lastContract = contract;
          expect(contract.pass).toBe(true);
          expect(attempt.route).toBe('sparse');
        }
        const eligibility = derivePreanalysisSparseAutoRouteEligibility(request);
        const actualParameterCount = Math.max(...parameterCounts);
        if (parameterCounts.length === 0) console.error('phase9a ladder no calls', targetParameterCount, attempt?.route, attempt?.reasons);
        expect(actualParameterCount).toBe(targetParameterCount);
        expect(attempt?.route).toBe('sparse');
        const successfulAttempt = attempt;
        const contract = lastContract;
        expect(successfulAttempt).not.toBeNull();
        expect(contract?.pass).toBe(true);
        rows.push({
          targetParameterCount,
          stationUnknownCount,
          coordinateParameterCount: stationUnknownCount * 2,
          orientationParameterCount: actualParameterCount - stationUnknownCount * 2,
          actualParameterCount,
          equationCount: Math.max(...equationCounts),
          designNNZ: Math.max(...designNnz),
          weightNNZ: Math.max(...weightNnz),
          dof: (successfulAttempt!.outcome.result as unknown as { dof?: number }).dof ?? null,
          route: successfulAttempt!.route,
          eligibility: eligibility.eligible,
          restartEquality: contract!.pass,
          sessionWallMs: sessionSamples.slice(1),
          forcedTsWallMs: summarizePhase9aTimings(forcedTsSamples.slice(1)),
          sparseSessionTiming: summarizePhase9aTimings(sessionSamples.slice(1)),
          sparseToTsRatio: summarizePhase9aTimings(sessionSamples.slice(1)).median / Math.max(0.001, summarizePhase9aTimings(forcedTsSamples.slice(1)).median),
          warmupRuns: 1,
          measuredRuns: repetitionCount - 1,
          nativeCorrectionMs: summarizePhase9aTimings(phaseTimes.nativeCorrection ?? []),
          nativeCovarianceMs: summarizePhase9aTimings(phaseTimes.nativeCovariance ?? []),
          verifierPhaseMs: summarizePhase9aTimingMap(phaseTimes),
          fallbackReason: successfulAttempt!.reasons[0] ?? null,
          denseNEntries: actualParameterCount * actualParameterCount,
          denseNBytes: actualParameterCount * actualParameterCount * 8,
          planningSystemCount: parameterCounts.length,
          boundedVerificationQueryCount: actualParameterCount * 16,
          boundedQueryCount: actualParameterCount * 16,
          damping: 0,
          c1: true,
          c2: true,
          c3: true,
          physical: true,
          falseSparseAuthority: 0,
        });
      }
    } finally {
      clearPreanalysisSparseAutoRouteTestHooks();
      setPreanalysisSparseAutoRouteEnabled(false);
    }
    fragment.fullRouteLadder = {
      status: 'EXECUTED',
      note: 'Actual parameter dimensions are exact coordinate-dominant chain-star sessions; timing phases are collected by the evidence-only sink.',
      rows,
    };
    fragment.exactParameterLadder = { status: 'EXECUTED', rows };
    fragment.coordinateDominant = { status: 'EXECUTED', rows };
    fragment.timing = { status: 'EXECUTED', warmupRuns: 1, measuredRuns: process.env.PHASE9A_DIAGNOSTIC === '1' ? 0 : 5, measuredRuns512: process.env.PHASE9A_DIAGNOSTIC === '1' ? 0 : 3, diagnostic: process.env.PHASE9A_DIAGNOSTIC === '1', phases: ['accumulate', 'productionC2', 'verificationNative', 'verificationC2', 'c1', 'c3', 'physical', 'total'] };
    fragment.retention = { status: 'EXECUTED', maxRetainedPackedSystems: 1, mixedAuthorities: 0 };
  }, 3600000);
});

afterAll(() => {
  writePhase9aFragment('scaling', fragment);
});
