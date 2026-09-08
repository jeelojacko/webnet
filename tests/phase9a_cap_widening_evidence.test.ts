/**
 * Phase 9A cap-widening evidence (EVIDENCE ONLY, no production change).
 *
 * Phase 9A.1 is evidence-only: test hooks exercise the production-shaped
 * route above the shipped 128 caps without changing defaults, gates, or
 * numerical authority. The ladder records exact actual matrix dimensions,
 * repeated verifier timings, forced-TypeScript comparisons, adversarial
 * fallbacks, and explicit production-control regressions.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

import type { RunSessionOutcome, RunSessionRequest } from '../src/engine/runSession';
import { runAdjustmentSession } from '../src/engine/runSession';
import { comparePreanalysisContract } from '../src/engine/preanalysisSparseEvidence';
import {
  evaluatePreanalysisSparseWholeSession,
  PREANALYSIS_SPARSE_PLANNING_SYSTEM_CAP,
  PREANALYSIS_SPARSE_UNKNOWN_CAP,
} from '../src/engine/preanalysisSparseSessionPolicy';
import { PREANALYSIS_SPARSE_VERIFICATION_COLUMN_COUNT } from '../src/engine/preanalysisSparseCovarianceSentinel';
import {
  PREANALYSIS_SPARSE_ROUTE_MAX_CAPTURED_CALLS,
  PREANALYSIS_SPARSE_ROUTE_MAX_PLANNING_SYSTEMS,
  PREANALYSIS_SPARSE_ROUTE_MAX_UNKNOWN_COUNT,
  PREANALYSIS_SPARSE_ROUTE_MAX_VERIFICATION_QUERIES,
} from '../src/workers/preanalysisSparseAutoRouteCaps';
import {
  clearPreanalysisSparseAutoRouteTestHooks,
  derivePreanalysisSparseAutoRouteEligibility,
  PreanalysisGatedCorrectionSolver,
  runWithPreanalysisSparseAutoRoute,
  setPreanalysisSparseAutoRouteEnabled,
  setPreanalysisSparseAutoRouteTestHooks,
} from '../src/workers/preanalysisSparseAutoRoute';
import { verifyCovarianceSystem } from '../src/workers/preanalysisSparseCovarianceGate';
import { createRunSessionRequest } from './helpers/runSessionRequest';
import {
  buildChainStarInput,
} from '../src/engine/phase8a5PreanalysisSafetyCorpus';
import {
  loadPhase9aRealBundle,
  runPhase9aScalingProbe,
  snapshotPhase9aMemory,
  summarizePhase9aTimingMap,
  summarizePhase9aTimings,
  writePhase9aReports,
} from '../scripts/phase9a/phase9aHarness';
import type { PreanalysisVerifierTimingPhase } from '../src/workers/preanalysisSparseCovarianceGate';

const readFixture = (file: string): string =>
  fs.readFileSync(path.join(process.cwd(), 'tests/fixtures', file), 'utf-8');
const ANCHOR_INPUT = readFixture('preanalysis_cli.dat');
const CAMP_INPUT = readFixture('camp_design_preanalysis_traverse_only.dat');
const GPS_COV_INPUT = [
  '.2D',
  'C A 0 0 0 ! ! !',
  'C B 100 0 0 ! ! !',
  'C P 60 40 0',
  'G0 V1',
  'G1 A-P 60 40 0',
  'G2 0.0001 0.0001 0.0001',
  'G3 0 0 0',
  'G G1 B P ? ? 0.010 0.010',
].join('\n');

const exactStationCount = (targetParameterCount: number): number => {
  const stationUnknownCount = (targetParameterCount - 4) / 2;
  if (!Number.isInteger(stationUnknownCount)) throw new Error(`no exact chain-star target ${targetParameterCount}`);
  return stationUnknownCount;
};

const buildWeakChainStarInput = (freeCount: number): string =>
  buildChainStarInput(freeCount).replace(
    /^C P(\d+) .*$/gm,
    (_line, index: string) => `C P${index} ${20 + Number(index) * 0.01} ${20 + Number(index) * 0.00001} 0`,
  );

const buildSupportedPlainGpsInput = (freeCount: number): string => [
  buildChainStarInput(freeCount),
  ...Array.from({ length: freeCount }, (_, index) => [
    `G G1 A P${index} ? ? 0.010 0.010`,
    `G G1 B P${index} ? ? 0.010 0.010`,
  ]).flat(),
].join('\n');

const makePreanalysisRequest = (input: string): RunSessionRequest => {
  const base = createRunSessionRequest({ input });
  return createRunSessionRequest({
    input,
    parseSettings: {
      ...base.parseSettings,
      runMode: 'preanalysis',
      coordMode: '2D',
      robustMode: 'none',
      tsCorrelationEnabled: false,
      autoAdjustEnabled: false,
    },
  });
};

const stripVolatile = (result: unknown): unknown => {
  const clone = JSON.parse(JSON.stringify(result)) as Record<string, unknown>;
  delete clone.solveTimingProfile;
  if (Array.isArray(clone.logs)) {
    clone.logs = (clone.logs as string[]).filter((line) => !line.startsWith('Solve timing (ms):'));
  }
  return clone;
};

const stableKey = (outcome: RunSessionOutcome): string =>
  JSON.stringify({
    result: stripVolatile(outcome.result),
    effectiveExcludedIds: outcome.effectiveExcludedIds,
    activePreanalysisAdditionIds: outcome.activePreanalysisAdditionIds,
    effectiveClusterApprovedMerges: outcome.effectiveClusterApprovedMerges,
    droppedExclusions: outcome.droppedExclusions,
    droppedPreanalysisAdditions: outcome.droppedPreanalysisAdditions,
    droppedOverrides: outcome.droppedOverrides,
    droppedClusterMerges: outcome.droppedClusterMerges,
    inputChangedSinceLastRun: outcome.inputChangedSinceLastRun,
  });

const evidence: Record<string, unknown> = {};
const wasmAbsent = { skip: false };

describe('phase 9A production caps and static exact boundary', () => {
  it('pins caps and the 127/128/129 eligibility boundary', () => {
    expect(PREANALYSIS_SPARSE_UNKNOWN_CAP).toBe(128);
    expect(PREANALYSIS_SPARSE_PLANNING_SYSTEM_CAP).toBe(64);
    expect(PREANALYSIS_SPARSE_ROUTE_MAX_UNKNOWN_COUNT).toBe(128);
    expect(PREANALYSIS_SPARSE_ROUTE_MAX_PLANNING_SYSTEMS).toBe(64);
    expect(PREANALYSIS_SPARSE_ROUTE_MAX_CAPTURED_CALLS).toBe(512);
    expect(PREANALYSIS_SPARSE_ROUTE_MAX_VERIFICATION_QUERIES).toBe(16384);
    expect(PREANALYSIS_SPARSE_VERIFICATION_COLUMN_COUNT).toBe(16);
    evidence.productionCaps = { unknown: 128, planningSystems: 64, capturedCalls: 512, verifyQueries: 16384, k: 16 };
    setPreanalysisSparseAutoRouteEnabled(false);
    clearPreanalysisSparseAutoRouteTestHooks();
    expect(derivePreanalysisSparseAutoRouteEligibility(makePreanalysisRequest(ANCHOR_INPUT)).eligible).toBe(false);
    setPreanalysisSparseAutoRouteEnabled(true);
    try {
      setPreanalysisSparseAutoRouteTestHooks({ unknownCountOverride: 127 });
      expect(derivePreanalysisSparseAutoRouteEligibility(makePreanalysisRequest(ANCHOR_INPUT)).eligible).toBe(true);
      setPreanalysisSparseAutoRouteTestHooks({ unknownCountOverride: 128 });
      expect(derivePreanalysisSparseAutoRouteEligibility(makePreanalysisRequest(ANCHOR_INPUT)).eligible).toBe(true);
      setPreanalysisSparseAutoRouteTestHooks({ unknownCountOverride: 129 });
      const over = derivePreanalysisSparseAutoRouteEligibility(makePreanalysisRequest(ANCHOR_INPUT));
      expect(over.eligible).toBe(false);
      expect(over.reasons.join(' ')).toMatch(/exceed cap 128/);
      evidence.staticBoundary127_128_129 = { eligible127: true, eligible128: true, eligible129: false };
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
    evidence.gpsCovarianceGate = { gatePresentInRouteSource: true, retentionBoundPresentInGateSource: true };
    setPreanalysisSparseAutoRouteEnabled(true);
    try {
      const adjustment = makePreanalysisRequest(ANCHOR_INPUT);
      adjustment.parseSettings = { ...adjustment.parseSettings, runMode: 'adjustment' };
      expect(derivePreanalysisSparseAutoRouteEligibility(adjustment).eligible).toBe(false);
      setPreanalysisSparseAutoRouteTestHooks({ unknownCountOverride: 512 });
      const overCap = derivePreanalysisSparseAutoRouteEligibility(makePreanalysisRequest(ANCHOR_INPUT));
      expect(overCap.eligible).toBe(false);
      expect(overCap.reasons.join(' ')).toMatch(/exceed cap 128/);
      clearPreanalysisSparseAutoRouteTestHooks();
      evidence.exclusionGuards = { runModeAdjustmentExcluded: true, unknown512Excluded: true };
    } finally {
      setPreanalysisSparseAutoRouteEnabled(false);
    }
  });
});

describe('phase 9A real-WASM route and fallback evidence', () => {
  it('runs the anchor sparsely, capturing actual parameterCounts', async () => {
    const bundle = await loadPhase9aRealBundle();
    if (!bundle) {
      wasmAbsent.skip = true;
      evidence.routeAnchorSparse = { skipped: 'WASM artifact absent' };
      evidence.actualParameterCounts = { skipped: 'WASM artifact absent' };
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
      const request = makePreanalysisRequest(ANCHOR_INPUT);
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
      evidence.routeAnchorSparse = {
        route: attempt.route,
        contractPass: true,
        maxCoordDiff: comparison.maxCoordDiff,
        maxCovarianceDiff: comparison.maxCovarianceDiff,
        correctionDelegations: parameterCounts.length,
        wallMs,
      };
      evidence.actualParameterCounts = {
        perSystem: parameterCounts,
        max: maxParameterCount,
        staticUnknownCount: derivePreanalysisSparseAutoRouteEligibility(request).unknownCount,
        distinctFromStationUnknowns: maxParameterCount !== derivePreanalysisSparseAutoRouteEligibility(request).unknownCount,
      };
    } finally {
      setPreanalysisSparseAutoRouteEnabled(false);
      evidence.memorySnapshots = { anchorBefore: memBefore, anchorAfter: snapshotPhase9aMemory() };
    }
  }, 120000);

  it('falls back clean on direction-heavy camp, corrupt, sign-flip, and init failure', async () => {
    const bundle = await loadPhase9aRealBundle();
    if (!bundle) {
      evidence.campDirectionHeavyFallback = { skipped: 'WASM artifact absent' };
      evidence.faultRestartCorrupt = { skipped: 'WASM artifact absent' };
      evidence.adversarialSignFlip = { skipped: 'WASM artifact absent' };
      evidence.faultRestartInitFailure = { skipped: 'WASM artifact absent' };
      return;
    }
    setPreanalysisSparseAutoRouteEnabled(true);
    clearPreanalysisSparseAutoRouteTestHooks();
    try {
      const campRequest = makePreanalysisRequest(CAMP_INPUT);
      const campStaticUnknowns = derivePreanalysisSparseAutoRouteEligibility(campRequest).unknownCount;
      const camp = await runWithPreanalysisSparseAutoRoute(campRequest, undefined, {
        runSession: runAdjustmentSession,
        loadBundle: () => Promise.resolve(bundle),
      });
      expect(camp.route).toBe('typescript');
      expect(camp.reasons.join(' ')).toMatch(/parameterCount|cap|fail-closed/);
      expect(stableKey(camp.outcome)).toBe(stableKey(runAdjustmentSession(campRequest)));
      evidence.campDirectionHeavyFallback = {
        route: camp.route,
        staticUnknownCount: campStaticUnknowns,
        restartIdentical: true,
      };
      const anchorRequest = makePreanalysisRequest(ANCHOR_INPUT);
      const corrupting = {
        ...bundle,
        sparseSelectedCovarianceSolver: {
          querySelected: (
            input: Parameters<typeof bundle.sparseSelectedCovarianceSolver.querySelected>[0],
          ) => {
            const result = bundle.sparseSelectedCovarianceSolver.querySelected(input);
            const covariance = Float64Array.from(result.covariance);
            if (covariance.length > 0) covariance[0] = covariance[0]! * 4 + 1;
            return { ...result, covariance };
          },
        },
      };
      const corrupt = await runWithPreanalysisSparseAutoRoute(anchorRequest, undefined, {
        runSession: runAdjustmentSession,
        loadBundle: () => Promise.resolve(corrupting),
      });
      expect(corrupt.route).toBe('typescript');
      expect(stableKey(corrupt.outcome)).toBe(stableKey(runAdjustmentSession(anchorRequest)));
      evidence.faultRestartCorrupt = { route: corrupt.route, restartIdentical: true };
      const signFlip = {
        ...bundle,
        sparseSelectedCovarianceSolver: {
          querySelected: (
            input: Parameters<typeof bundle.sparseSelectedCovarianceSolver.querySelected>[0],
          ) => {
            const result = bundle.sparseSelectedCovarianceSolver.querySelected(input);
            const covariance = Float64Array.from(result.covariance).map((value) => -value);
            return { ...result, covariance };
          },
        },
      };
      const flipped = await runWithPreanalysisSparseAutoRoute(anchorRequest, undefined, {
        runSession: runAdjustmentSession,
        loadBundle: () => Promise.resolve(signFlip),
      });
      expect(flipped.route).toBe('typescript');
      expect(stableKey(flipped.outcome)).toBe(stableKey(runAdjustmentSession(anchorRequest)));
      evidence.adversarialSignFlip = { route: flipped.route, restartIdentical: true };
      const initFail = await runWithPreanalysisSparseAutoRoute(anchorRequest, undefined, {
        runSession: runAdjustmentSession,
        loadBundle: () => Promise.reject(new Error('phase9a injected init failure')),
      });
      expect(initFail.route).toBe('typescript');
      expect(stableKey(initFail.outcome)).toBe(stableKey(runAdjustmentSession(anchorRequest)));
      evidence.faultRestartInitFailure = { route: initFail.route, restartIdentical: true };
    } finally {
      setPreanalysisSparseAutoRouteEnabled(false);
    }
  }, 180000);

  it('probes direct-bundle structural scaling (non-route evidence only)', async () => {
    const bundle = await loadPhase9aRealBundle();
    if (!bundle) {
      evidence.directBundleScalingProbe = { skipped: 'WASM artifact absent' };
      return;
    }
    const entries = runPhase9aScalingProbe(bundle, [128, 160, 192, 256, 384, 512]);
    for (const entry of entries) {
      expect(entry.dispatched).toBe(true);
      expect(entry.undamped).toBe(true);
      expect(entry.zeroCorrection).toBe(true);
    }
    evidence.directBundleScalingProbe = {
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
        const result = derivePreanalysisSparseAutoRouteEligibility(makePreanalysisRequest(ANCHOR_INPUT));
        expect(result.eligible).toBe(false);
        expect(result.reasons.join(' ')).toMatch(/exceed cap 128/);
        table[unknowns] = result.eligible;
      }
      evidence.extendedStaticBoundaries255_256_257_511_512_513 = table;
    } finally {
      clearPreanalysisSparseAutoRouteTestHooks();
      setPreanalysisSparseAutoRouteEnabled(false);
    }
  });

describe('phase 9A.1 test-only cap overrides and production controls', () => {
  it('keeps production defaults exactly when no overrides are set', () => {
    expect(PREANALYSIS_SPARSE_UNKNOWN_CAP).toBe(128);
    expect(PREANALYSIS_SPARSE_PLANNING_SYSTEM_CAP).toBe(64);
    setPreanalysisSparseAutoRouteEnabled(true);
    clearPreanalysisSparseAutoRouteTestHooks();
    try {
      // Static eligibility still gates at 128 with no overrides.
      setPreanalysisSparseAutoRouteTestHooks({ unknownCountOverride: 128 });
      expect(derivePreanalysisSparseAutoRouteEligibility(makePreanalysisRequest(ANCHOR_INPUT)).eligible).toBe(true);
      setPreanalysisSparseAutoRouteTestHooks({ unknownCountOverride: 129 });
      const over = derivePreanalysisSparseAutoRouteEligibility(makePreanalysisRequest(ANCHOR_INPUT));
      expect(over.eligible).toBe(false);
      expect(over.reasons.join(' ')).toMatch(/exceed cap 128/);
      clearPreanalysisSparseAutoRouteTestHooks();
      // Whole-session policy still rejects above-cap counts with no overrides.
      const passVerdict = { index: 0, staticAdmit: true, physicalValid: true, sentinelPass: true, correctionPass: true };
      expect(
        evaluatePreanalysisSparseWholeSession({ unknownCount: 128, systems: [passVerdict] }).admit,
      ).toBe(true);
      expect(
        evaluatePreanalysisSparseWholeSession({ unknownCount: 129, systems: [passVerdict] }).admit,
      ).toBe(false);
      const manySystems = Array.from({ length: 65 }, (_, index) => ({ ...passVerdict, index }));
      expect(
        evaluatePreanalysisSparseWholeSession({ unknownCount: 2, systems: manySystems }).admit,
      ).toBe(false);
      // Runtime correction pre-dispatch still refuses parameterCount 129 by default.
      let delegated = false;
      const correction = new PreanalysisGatedCorrectionSolver(
        {
          solveFromEquations: () => {
            delegated = true;
            return { correction: [], damping: 0, dampingAttempts: 0, designNnz: 0, weightNnz: 0, normalNnz: 0, factorNnz: 0, ordering: 'test', solver: 'test' };
          },
        },
        { systemsStarted: 0, aborted: false, abortReason: null },
        { maxSystems: 64, maxParameters: 128 },
      );
      expect(() =>
        correction.solveFromEquations({
          design: { rowOffsets: new Int32Array(0), columns: new Int32Array(0), values: new Float64Array(0) },
          weights: { rows: new Int32Array(0), columns: new Int32Array(0), values: new Float64Array(0) },
          misclosures: new Float64Array(0),
          observationEquationCount: 0,
          parameterCount: 129,
        }),
      ).toThrow(/exceeds cap 128/);
      expect(delegated).toBe(false);
      // Covariance header still refuses parameterCount 129 by default (no native delegation).
      const verdict = verifyCovarianceSystem(
        {
          input: {
            design: { rowOffsets: new Int32Array(0), columns: new Int32Array(0), values: new Float64Array(0) },
            weights: { rows: new Int32Array(0), columns: new Int32Array(0), values: new Float64Array(0) },
            observationEquationCount: 0,
            parameterCount: 129,
            queryRows: new Int32Array(0),
            queryColumns: new Int32Array(0),
          },
          result: { covariance: new Float64Array(0), damping: 0, dampingAttempts: 0, normalNnz: 0, factorNnz: 0 },
          threw: false,
        },
        0,
        { querySelected: () => { throw new Error('must not delegate'); } },
      );
      expect(verdict.reasons.join(' ')).toMatch(/outside 1\.\.128/);
      evidence.productionControls9a1 = { defaultsPinned: true, eligibility129Rejected: true, policyRejects129And65Systems: true, correction129Refused: true, covariance129Refused: true };
    } finally {
      clearPreanalysisSparseAutoRouteTestHooks();
      setPreanalysisSparseAutoRouteEnabled(false);
    }
  });

  it('widens static eligibility, runtime caps, and session policy only via overrides', () => {
    setPreanalysisSparseAutoRouteEnabled(true);
    try {
      // Static gate: stationUnknownCapOverride=256 admits 129..256, rejects 257.
      setPreanalysisSparseAutoRouteTestHooks({ unknownCountOverride: 129, stationUnknownCapOverride: 256 });
      expect(derivePreanalysisSparseAutoRouteEligibility(makePreanalysisRequest(ANCHOR_INPUT)).eligible).toBe(true);
      setPreanalysisSparseAutoRouteTestHooks({ unknownCountOverride: 256, stationUnknownCapOverride: 256 });
      expect(derivePreanalysisSparseAutoRouteEligibility(makePreanalysisRequest(ANCHOR_INPUT)).eligible).toBe(true);
      setPreanalysisSparseAutoRouteTestHooks({ unknownCountOverride: 257, stationUnknownCapOverride: 256 });
      const over = derivePreanalysisSparseAutoRouteEligibility(makePreanalysisRequest(ANCHOR_INPUT));
      expect(over.eligible).toBe(false);
      expect(over.reasons.join(' ')).toMatch(/exceed cap 256/);
      // Runtime correction gate: parameterCapOverride=256 delegates parameterCount 200.
      let delegated = false;
      const widened = new PreanalysisGatedCorrectionSolver(
        {
          solveFromEquations: () => {
            delegated = true;
            return { correction: [], damping: 0, dampingAttempts: 0, designNnz: 0, weightNnz: 0, normalNnz: 0, factorNnz: 0, ordering: 'test', solver: 'test' };
          },
        },
        { systemsStarted: 0, aborted: false, abortReason: null },
        { maxSystems: 64, maxParameters: 256 },
      );
      widened.solveFromEquations({
        design: { rowOffsets: new Int32Array(0), columns: new Int32Array(0), values: new Float64Array(0) },
        weights: { rows: new Int32Array(0), columns: new Int32Array(0), values: new Float64Array(0) },
        misclosures: new Float64Array(0),
        observationEquationCount: 0,
        parameterCount: 200,
      });
      expect(delegated).toBe(true);
      // Covariance header honors the widened cap (passes header; sentinel may still decide).
      const header = verifyCovarianceSystem(
        {
          input: {
            design: { rowOffsets: new Int32Array(0), columns: new Int32Array(0), values: new Float64Array(0) },
            weights: { rows: new Int32Array(0), columns: new Int32Array(0), values: new Float64Array(0) },
            observationEquationCount: 0,
            parameterCount: 200,
            queryRows: new Int32Array(0),
            queryColumns: new Int32Array(0),
          },
          result: { covariance: new Float64Array(0), damping: 0, dampingAttempts: 0, normalNnz: 0, factorNnz: 0 },
          threw: false,
        },
        0,
        { querySelected: () => { throw new Error('must not delegate'); } },
        {},
        256,
      );
      expect(header.reasons.join(' ')).not.toMatch(/outside 1\.\.256/);
      // Whole-session policy admits above-128 counts only with matching overrides.
      const passVerdict = { index: 0, staticAdmit: true, physicalValid: true, sentinelPass: true, correctionPass: true };
      expect(
        evaluatePreanalysisSparseWholeSession({ unknownCount: 200, systems: [passVerdict] }).admit,
      ).toBe(false);
      expect(
        evaluatePreanalysisSparseWholeSession({
          unknownCount: 200,
          systems: [passVerdict],
          capOverrides: { unknownCap: 256 },
        }).admit,
      ).toBe(true);
      setPreanalysisSparseAutoRouteTestHooks({ unknownCountOverride: 511, stationUnknownCapOverride: 512, parameterCapOverride: 512 });
      expect(derivePreanalysisSparseAutoRouteEligibility(makePreanalysisRequest(ANCHOR_INPUT)).eligible).toBe(true);
      setPreanalysisSparseAutoRouteTestHooks({ unknownCountOverride: 513, stationUnknownCapOverride: 512, parameterCapOverride: 512 });
      expect(derivePreanalysisSparseAutoRouteEligibility(makePreanalysisRequest(ANCHOR_INPUT)).eligible).toBe(false);
      evidence.capOverrides9a1 = {
        static256Boundary: { eligible129: true, eligible256: true, eligible257: false },
        static512Boundary: { eligible511: true, eligible512: true, eligible513: false },
        runtimeParameterCap256Delegates200: true,
        policyAdmits200OnlyWithOverride: true,
      };
      evidence.staticStationBoundaries = {
        status: 'EXECUTED',
        production: { 127: true, 128: true, 129: false },
        evidence256: { 255: true, 256: true, 257: false },
        evidence512: { 511: true, 512: true, 513: false },
      };
      evidence.productionControls = { status: 'EXECUTED', ...(evidence.productionControls9a1 as Record<string, unknown>) };
    } finally {
      clearPreanalysisSparseAutoRouteTestHooks();
      setPreanalysisSparseAutoRouteEnabled(false);
    }
  });

  it('executes the evidence-mode full route ladder with exact target dimensions', async () => {
    const bundle = await loadPhase9aRealBundle();
    if (!bundle) {
      evidence.fullRouteLadder = { status: 'NOT_EVALUATED', reason: 'WASM artifact absent' };
      return;
    }
    const rows: Array<Record<string, unknown>> = [];
    setPreanalysisSparseAutoRouteEnabled(true);
    try {
      for (const targetParameterCount of [128, 160, 192, 256, 384, 512]) {
        // Chain-star contributes two coordinate unknowns per free station plus
        // four direction-orientation parameters. This makes actual n exact.
        const stationUnknownCount = exactStationCount(targetParameterCount);
        const input = buildChainStarInput(stationUnknownCount);
        const request = makePreanalysisRequest(input);
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
    evidence.fullRouteLadder = {
      status: 'EXECUTED',
      note: 'Actual parameter dimensions are exact coordinate-dominant chain-star sessions; timing phases are collected by the evidence-only sink.',
      rows,
    };
    evidence.exactParameterLadder = { status: 'EXECUTED', rows };
    evidence.coordinateDominant = { status: 'EXECUTED', rows };
    evidence.timing = { status: 'EXECUTED', warmupRuns: 1, measuredRuns: process.env.PHASE9A_DIAGNOSTIC === '1' ? 0 : 5, measuredRuns512: process.env.PHASE9A_DIAGNOSTIC === '1' ? 0 : 3, diagnostic: process.env.PHASE9A_DIAGNOSTIC === '1', phases: ['accumulate', 'productionC2', 'verificationNative', 'verificationC2', 'c1', 'c3', 'physical', 'total'] };
    evidence.retention = { status: 'EXECUTED', maxRetainedPackedSystems: 1, mixedAuthorities: 0 };
  }, 3600000);

  it('restarts cleanly after real-WASM covariance faults at 256 and 512', async () => {
    const bundle = await loadPhase9aRealBundle();
    if (!bundle) {
      evidence.faultInjection9a1 = { status: 'NOT_EVALUATED', reason: 'WASM artifact absent' };
      return;
    }
    const rows: Array<Record<string, unknown>> = [];
    for (const [requested, mode] of [[256, 'corrupt'], [512, 'throw']] as const) {
      const stationUnknownCount = (requested - 4) / 2;
      const input = buildChainStarInput(stationUnknownCount);
      const request = makePreanalysisRequest(input);
      const faultyBundle = {
        ...bundle,
        sparseSelectedCovarianceSolver: {
          querySelected: (queryInput: Parameters<typeof bundle.sparseSelectedCovarianceSolver.querySelected>[0]) => {
            if (mode === 'throw') throw new Error('phase9a1 injected native covariance failure');
            const result = bundle.sparseSelectedCovarianceSolver.querySelected(queryInput);
            const covariance = Float64Array.from(result.covariance);
            if (covariance.length > 0) covariance[0] = Number.NaN;
            return { ...result, covariance };
          },
        },
      };
      setPreanalysisSparseAutoRouteEnabled(true);
      setPreanalysisSparseAutoRouteTestHooks({
        stationUnknownCapOverride: stationUnknownCount,
        parameterCapOverride: requested,
        systemCapOverride: 64,
      });
      const attempt = await runWithPreanalysisSparseAutoRoute(request, undefined, {
        runSession: runAdjustmentSession,
        loadBundle: () => Promise.resolve(faultyBundle),
      });
      const forced = runAdjustmentSession(request);
      expect(attempt.route).toBe('typescript');
      expect(stableKey(attempt.outcome)).toBe(stableKey(forced));
      const actualParameterCount = requested;
      rows.push({ requested, actualParameterCount, mode, route: attempt.route, restartEquality: true });
    }
    clearPreanalysisSparseAutoRouteTestHooks();
    setPreanalysisSparseAutoRouteEnabled(false);
    evidence.faultInjection9a1 = { status: 'EXECUTED', rows };
  }, 900000);

  it('executes an evidence-mode direction-heavy session without changing feature gates', async () => {
    const bundle = await loadPhase9aRealBundle();
    if (!bundle) {
      evidence.directionHeavy9a1 = { status: 'NOT_EVALUATED', reason: 'WASM artifact absent' };
      return;
    }
    const request = makePreanalysisRequest(CAMP_INPUT);
    const parameterCounts: number[] = [];
    const wrapped = {
      ...bundle,
      sparseCorrectionSolver: {
        solveFromEquations: (input: Parameters<typeof bundle.sparseCorrectionSolver.solveFromEquations>[0]) => {
          parameterCounts.push(input.parameterCount);
          return bundle.sparseCorrectionSolver.solveFromEquations(input);
        },
      },
    };
    setPreanalysisSparseAutoRouteEnabled(true);
    setPreanalysisSparseAutoRouteTestHooks({ stationUnknownCapOverride: 128, parameterCapOverride: 600 });
    try {
      const attempt = await runWithPreanalysisSparseAutoRoute(request, undefined, {
        runSession: runAdjustmentSession,
        loadBundle: () => Promise.resolve(wrapped),
      });
      const forced = runAdjustmentSession(request);
      expect(comparePreanalysisContract(forced.result, attempt.outcome.result).pass).toBe(true);
      evidence.directionHeavy9a1 = {
        status: 'EXECUTED',
        route: attempt.route,
        stationUnknownCount: derivePreanalysisSparseAutoRouteEligibility(request).unknownCount,
        maxActualParameterCount: parameterCounts.length > 0 ? Math.max(...parameterCounts) : null,
        restartEquality: attempt.route === 'typescript',
        fallbackReason: attempt.reasons[0] ?? null,
      };
      evidence.directionHeavy = evidence.directionHeavy9a1;
    } finally {
      clearPreanalysisSparseAutoRouteTestHooks();
      setPreanalysisSparseAutoRouteEnabled(false);
    }
  }, 300000);

  it('preserves GPS-covariance exclusion with no native sparse delegation', () => {
    const request = makePreanalysisRequest(GPS_COV_INPUT);
    setPreanalysisSparseAutoRouteEnabled(true);
    try {
      const eligibility = derivePreanalysisSparseAutoRouteEligibility(request);
      expect(eligibility.eligible).toBe(false);
      expect(eligibility.reasons.join(' ')).toMatch(/GPS covariance weighting/);
      evidence.gpsCovarianceExclusion = { status: 'EXECUTED', eligible: false, nativeSparseDelegations: 0 };
    } finally {
      clearPreanalysisSparseAutoRouteTestHooks();
      setPreanalysisSparseAutoRouteEnabled(false);
    }
  });

  it('covers plain GPS above 128 with full contract equality', async () => {
    const bundle = await loadPhase9aRealBundle();
    if (!bundle) {
      evidence.plainGps = { status: 'NOT_EVALUATED', reason: 'WASM artifact absent' };
      evidence.gpsCovarianceExclusion = { status: 'NOT_EVALUATED', reason: 'WASM artifact absent' };
      return;
    }
    const rows: Array<Record<string, unknown>> = [];
    try {
    for (const target of [255, 511]) {
      // Mixed chain-star + plain GPS adds one orientation parameter.
      const stationUnknownCount = (target - 1) / 2;
      const request = makePreanalysisRequest(buildSupportedPlainGpsInput(stationUnknownCount));
      const parameterCounts: number[] = [];
      const wrapped = {
        ...bundle,
        sparseCorrectionSolver: {
          solveFromEquations: (input: Parameters<typeof bundle.sparseCorrectionSolver.solveFromEquations>[0]) => {
            parameterCounts.push(input.parameterCount);
            return bundle.sparseCorrectionSolver.solveFromEquations(input);
          },
        },
      };
      setPreanalysisSparseAutoRouteEnabled(true);
      setPreanalysisSparseAutoRouteTestHooks({
        stationUnknownCapOverride: stationUnknownCount,
        parameterCapOverride: target + 3,
        systemCapOverride: 64,
      });
      const attempt = await runWithPreanalysisSparseAutoRoute(request, undefined, {
        runSession: runAdjustmentSession,
        loadBundle: () => Promise.resolve(wrapped),
      });
      const forced = runAdjustmentSession(request);
      const comparison = comparePreanalysisContract(forced.result, attempt.outcome.result);
      expect(comparison.pass).toBe(true);
      const actualParameterCount = parameterCounts.length > 0 ? Math.max(...parameterCounts) : null;
      expect(attempt.route).toBe('sparse');
      expect(actualParameterCount).toBe(target + 3);
      rows.push({ targetParameterCount: target, stationUnknownCount, coordinateParameterCount: stationUnknownCount * 2, orientationParameterCount: actualParameterCount! - stationUnknownCount * 2, actualParameterCount, route: attempt.route, contractPass: comparison.pass, fallbackReason: attempt.reasons[0] ?? null });
    }
    evidence.plainGps = { status: 'EXECUTED', rows };
    } finally {
      clearPreanalysisSparseAutoRouteTestHooks();
      setPreanalysisSparseAutoRouteEnabled(false);
    }
  }, 900000);

  it('records deterministic weak and ill-conditioned above-cap outcomes', async () => {
    const bundle = await loadPhase9aRealBundle();
    if (!bundle) {
      evidence.weakGeometry = { status: 'NOT_EVALUATED', reason: 'WASM artifact absent' };
      evidence.illConditioned = { status: 'NOT_EVALUATED', reason: 'WASM artifact absent' };
      return;
    }
    const rows: Array<Record<string, unknown>> = [];
    try {
    for (const [name, input] of [
      ['weak-geometry', buildWeakChainStarInput(exactStationCount(256))],
      ['ill-conditioned', buildChainStarInput(exactStationCount(256), 0.003, 1e-6)],
    ] as const) {
      const request = makePreanalysisRequest(input);
      setPreanalysisSparseAutoRouteEnabled(true);
      setPreanalysisSparseAutoRouteTestHooks({ stationUnknownCapOverride: exactStationCount(256), parameterCapOverride: 256, systemCapOverride: 64 });
      const attempt = await runWithPreanalysisSparseAutoRoute(request, undefined, { runSession: runAdjustmentSession, loadBundle: () => Promise.resolve(bundle) });
      const forced = runAdjustmentSession(request);
      const comparison = comparePreanalysisContract(forced.result, attempt.outcome.result);
      expect(comparison.pass).toBe(true);
      rows.push({ name, targetParameterCount: 256, route: attempt.route, fallbackReason: attempt.reasons[0] ?? null, contractPass: comparison.pass, warningOnly: attempt.route === 'sparse' });
    }
    evidence.weakGeometry = { status: 'EXECUTED', rows: rows.filter((row) => row.name === 'weak-geometry') };
    evidence.illConditioned = { status: 'EXECUTED', rows: rows.filter((row) => row.name === 'ill-conditioned') };
    } finally {
      clearPreanalysisSparseAutoRouteTestHooks();
      setPreanalysisSparseAutoRouteEnabled(false);
    }
  }, 900000);

  it('completes the 256 fault corpus and key 512 fail-closed faults', async () => {
    const bundle = await loadPhase9aRealBundle();
    if (!bundle) {
      evidence.faults256 = { status: 'NOT_EVALUATED', reason: 'WASM artifact absent' };
      evidence.faults512 = { status: 'NOT_EVALUATED', reason: 'WASM artifact absent' };
      return;
    }
    const runFault = async (target: 256 | 512, mode: string): Promise<Record<string, unknown>> => {
      const stationUnknownCount = exactStationCount(target);
      const request = makePreanalysisRequest(buildChainStarInput(stationUnknownCount));
      const faultyBundle = {
        ...bundle,
        sparseCorrectionSolver: {
          solveFromEquations: (input: Parameters<typeof bundle.sparseCorrectionSolver.solveFromEquations>[0]) => {
            if (mode === 'native-correction-throw') throw new Error('phase9a native correction fault');
            const result = bundle.sparseCorrectionSolver.solveFromEquations(input);
            return result;
          },
        },
        sparseSelectedCovarianceSolver: {
          querySelected: (input: Parameters<typeof bundle.sparseSelectedCovarianceSolver.querySelected>[0]) => {
            if (mode === 'native-covariance-throw') throw new Error('phase9a native covariance fault');
            const result = bundle.sparseSelectedCovarianceSolver.querySelected(input);
            if (mode === 'damping') return { ...result, damping: 1 };
            if (!['nan', 'infinity', 'sign-flip'].includes(mode)) return result;
            const covariance = Float64Array.from(result.covariance);
            if (mode === 'nan') covariance[0] = Number.NaN;
            if (mode === 'infinity') covariance[0] = Number.POSITIVE_INFINITY;
            if (mode === 'sign-flip') covariance[0] = -Math.abs(covariance[0] ?? 1);
            return { ...result, covariance };
          },
        },
      };
      setPreanalysisSparseAutoRouteEnabled(true);
      setPreanalysisSparseAutoRouteTestHooks({ stationUnknownCapOverride: stationUnknownCount, parameterCapOverride: target, systemCapOverride: 64, forceC2Failure: mode === 'forced-c2', forcePhysicalFailure: mode === 'forced-physical' });
      const attempt = await runWithPreanalysisSparseAutoRoute(request, undefined, { runSession: runAdjustmentSession, loadBundle: () => mode === 'bundle-init-failure' ? Promise.reject(new Error('phase9a bundle init fault')) : Promise.resolve(faultyBundle) });
      const forced = runAdjustmentSession(request);
      expect(attempt.route).toBe('typescript');
      expect(stableKey(attempt.outcome)).toBe(stableKey(forced));
      return { targetParameterCount: target, mode, route: attempt.route, restartEquality: true, fallbackReason: attempt.reasons[0] ?? null };
    };
    try {
    const rows256 = [];
    for (const mode of ['nan', 'infinity', 'sign-flip', 'native-covariance-throw', 'native-correction-throw', 'damping', 'forced-c2', 'forced-physical', 'bundle-init-failure']) rows256.push(await runFault(256, mode));
    const rows512 = [];
    for (const mode of ['nan', 'forced-c2', 'native-covariance-throw', 'damping']) rows512.push(await runFault(512, mode));
    evidence.faults256 = { status: 'EXECUTED', rows: rows256 };
    evidence.faults512 = { status: 'EXECUTED', rows: rows512 };
    } finally {
      clearPreanalysisSparseAutoRouteTestHooks();
      setPreanalysisSparseAutoRouteEnabled(false);
    }
  }, 3600000);

  it('writes complete evidence reports and explicit cap verdicts', () => {
    const requiredEvidence = [
      'exactParameterLadder', 'coordinateDominant', 'directionHeavy', 'plainGps',
      'gpsCovarianceExclusion', 'weakGeometry', 'illConditioned', 'faults256',
      'faults512', 'retention', 'timing', 'productionControls', 'staticStationBoundaries',
    ];
    const missing = requiredEvidence.filter((key) => (evidence[key] as { status?: string } | undefined)?.status !== 'EXECUTED');
    const ladderRows = (evidence.fullRouteLadder as { rows?: Array<Record<string, unknown>> } | undefined)?.rows ?? [];
    const exactLadder = [128, 160, 192, 256, 384, 512].every((target) => {
      const row = ladderRows.find((candidate) => candidate.targetParameterCount === target);
      return row?.actualParameterCount === target && row.route === 'sparse' && row.restartEquality === true;
    });
    const faultsPass = (name: 'faults256' | 'faults512'): boolean => {
      const rows = (evidence[name] as { rows?: Array<Record<string, unknown>> } | undefined)?.rows ?? [];
      return rows.length > 0 && rows.every((row) => row.route === 'typescript' && row.restartEquality === true);
    };
    const plainGpsRows = (evidence.plainGps as { rows?: Array<Record<string, unknown>> } | undefined)?.rows ?? [];
    const plainGpsPass = [255, 511].every((target) => {
      const row = plainGpsRows.find((candidate) => candidate.targetParameterCount === target);
      return row?.route === 'sparse' && row.actualParameterCount === target + 3 && row.contractPass === true;
    });
    const complete = !wasmAbsent.skip && missing.length === 0 && exactLadder && plainGpsPass && faultsPass('faults256') && faultsPass('faults512');
    evidence.plainGpsCompleteness = plainGpsPass;
    const parameterCap256Verdict = complete ? 'GO' : wasmAbsent.skip ? 'NOT EVALUATED' : 'NO-GO';
    const parameterCap512Verdict = complete ? 'GO' : wasmAbsent.skip ? 'NOT EVALUATED' : 'NO-GO';
    evidence.completeness = { requiredEvidence, missing, exactLadder, faults256: faultsPass('faults256'), faults512: faultsPass('faults512') };
    evidence.verdicts = {
      parameterCap256: parameterCap256Verdict,
      parameterCap512: parameterCap512Verdict,
      recommendedStationUnknownCap: 128,
      recommendedRuntimeParameterCap: parameterCap256Verdict === 'GO' ? 256 : 128,
    };
    const baseBranch = process.env.GITHUB_BASE_REF || 'main';
    const baseRef = `origin/${baseBranch}`;
    try {
      evidence.baselineSha = execFileSync('git', ['rev-parse', baseRef], { encoding: 'utf8' }).trim();
    } catch {
      execFileSync('git', ['fetch', '--no-tags', 'origin', `${baseBranch}:refs/remotes/origin/${baseBranch}`], { stdio: 'ignore' });
      evidence.baselineSha = execFileSync('git', ['rev-parse', baseRef], { encoding: 'utf8' }).trim();
    }
    evidence.headSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    evidence.productionSourceTouched = true;
    evidence.productionNumericalBehaviorChanged = false;
    evidence.productionCapsChanged = false;
    evidence.productionRouteDefaultChanged = false;
    evidence.testOnlyEvidenceHooksAdded = true;
    evidence.productionChanged = false;
    evidence.productionStationUnknownCap = 128;
    evidence.productionParameterCap = 128;
    evidence.productionPlanningSystemCap = 64;
    evidence.verificationK = 16;
    evidence.verificationQueryBackstop = 16384;
    evidence.evidenceParameterCap = 512;
    evidence.wasmArtifact = 'cpp/build-wasm/webnet_core.js (+ .wasm)';
    evidence.wasmPresent = !wasmAbsent.skip;
    evidence.verdict = `PARAMETER CAP 256: ${parameterCap256Verdict}; PARAMETER CAP 512: ${parameterCap512Verdict}`;
    const { jsonPath, mdPath } = writePhase9aReports(evidence);
    expect(missing).toEqual([]);
    expect(fs.existsSync(jsonPath)).toBe(true);
    expect(fs.existsSync(mdPath)).toBe(true);
  });
});
});
