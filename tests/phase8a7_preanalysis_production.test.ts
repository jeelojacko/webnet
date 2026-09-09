/**
 * Phase 8A.7 production preanalysis hook tests (production modules only).
 *
 * Proves: default-disabled short-circuits to TypeScript with no WASM init
 * and deep-equal results; enabled accepted/rejected/fallback/restart paths;
 * direction-heavy preflight holdback, generic parameter cap, all-systems count,
 * init-failure retry, and adjustment-route regression. Uses test-only fake
 * sparse bundles (dense TS math, no WASM) plus test hooks for exact
 * 127/128/129 station and 63/64/65 system boundaries plus the Phase 9B
 * 255/256/257 runtime parameter boundary. No phase8a6/test/script imports in
 * production modules (asserted); phase8a6 tests stay green separately.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { choleskyDecomposeWithDamping, solveSPDFromCholesky } from '../src/engine/matrixCholesky';
import { scaleNormalMatrix, scaleNormalRhs, unscaleNormalSolution } from '../src/engine/adjustNormalMatrixHelpers';
import type {
  SparseCorrectionSolver,
  SparseCorrectionSolveInput,
  SparseCorrectionSolveResult,
  SparseRowProductsSolver,
  SparseSelectedCovarianceInput,
  SparseSelectedCovarianceResult,
} from '../src/engine/numericalBackend';
import { runAdjustmentSession, type RunSessionOutcome, type RunSessionRequest } from '../src/engine/runSession';
import { comparePreanalysisContract } from '../src/engine/preanalysisSparseEvidence';
import { deriveSparseAutoRouteEligibility } from '../src/workers/adjustmentSparseAutoRoute';
import {
  clearPreanalysisSparseAutoRouteTestHooks,
  createPreanalysisCandidateState,
  derivePreanalysisSparseAutoRouteEligibility,
  isPreanalysisSparseAutoRouteEnabled,
  isPreanalysisSparseCapError,
  PREANALYSIS_SPARSE_ROUTE_MAX_PARAMETERS,
  PREANALYSIS_SPARSE_ROUTE_MAX_PLANNING_SYSTEMS,
  PREANALYSIS_SPARSE_ROUTE_MAX_STATION_UNKNOWNS,
  PreanalysisGatedCorrectionSolver,
  PreanalysisGatedCovarianceCapture,
  PreanalysisSparseCapError,
  runWithPreanalysisSparseAutoRoute,
  setPreanalysisSparseAutoRouteEnabled,
  setPreanalysisSparseAutoRouteTestHooks,
} from '../src/workers/preanalysisSparseAutoRoute';
import { createRunSessionRequest } from './helpers/runSessionRequest';

const REPORT_DIR = path.join(process.cwd(), 'reports/phase8a7');

const readFixture = (file: string): string => fs.readFileSync(path.join(process.cwd(), file), 'utf-8');

const SMALL_INPUT = readFixture('tests/fixtures/preanalysis_cli.dat');
const CAMP_INPUT = readFixture('tests/fixtures/camp_design_preanalysis_traverse_only.dat');

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

const accumulateNormalAndRhs = (input: SparseCorrectionSolveInput): { normal: number[][]; rhs: number[][] } => {
  const n = input.parameterCount;
  const m = input.observationEquationCount;
  const normal: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  const rhs: number[][] = Array.from({ length: n }, () => [0]);
  const readRow = (row: number): Array<{ index: number; value: number }> => {
    const start = input.design.rowOffsets[row] ?? 0;
    const end = input.design.rowOffsets[row + 1] ?? start;
    const entries: Array<{ index: number; value: number }> = [];
    for (let k = start; k < end; k += 1) {
      entries.push({ index: input.design.columns[k] ?? -1, value: input.design.values[k] ?? Number.NaN });
    }
    return entries;
  };
  for (let k = 0; k < input.weights.rows.length; k += 1) {
    const r = input.weights.rows[k] ?? -1;
    const c = input.weights.columns[k] ?? -1;
    const w = input.weights.values[k] ?? Number.NaN;
    if (w === 0) continue;
    const rowR = readRow(r);
    const lr = input.misclosures[r] ?? 0;
    if (r === c) {
      for (const a of rowR) {
        rhs[a.index]![0]! += a.value * w * lr;
        for (const b of rowR) normal[a.index]![b.index]! += a.value * w * b.value;
      }
    } else {
      const rowC = readRow(c);
      const lc = input.misclosures[c] ?? 0;
      for (const a of rowR) {
        rhs[a.index]![0]! += a.value * w * lc;
        for (const b of rowC) {
          const contribution = a.value * w * b.value;
          normal[a.index]![b.index]! += contribution;
          normal[b.index]![a.index]! += contribution;
        }
      }
      for (const b of rowC) rhs[b.index]![0]! += b.value * w * lr;
    }
  }
  void m;
  return { normal, rhs };
};

interface FakeBundle {
  sparseCorrectionSolver: { solveFromEquations(_input: SparseCorrectionSolveInput): SparseCorrectionSolveResult };
  sparseRowProductsSolver: SparseRowProductsSolver;
  sparseSelectedCovarianceSolver: {
    querySelected(_input: SparseSelectedCovarianceInput): SparseSelectedCovarianceResult;
  };
}

const buildFakeBundle = (options?: { damping?: number; corruptCovariance?: boolean }): FakeBundle => ({
  sparseCorrectionSolver: {
    solveFromEquations: (input: SparseCorrectionSolveInput): SparseCorrectionSolveResult => {
      const { normal, rhs } = accumulateNormalAndRhs(input);
      const scaled = scaleNormalMatrix(normal);
      const factorization = choleskyDecomposeWithDamping(scaled.scaled);
      const solved = solveSPDFromCholesky(factorization.factor, scaleNormalRhs(rhs, scaled.scale));
      const unscaled = unscaleNormalSolution(solved, scaled.scale);
      return {
        correction: unscaled,
        damping: options?.damping ?? 0,
        dampingAttempts: 0,
        designNnz: input.design.values.length,
        weightNnz: input.weights.values.length,
        normalNnz: input.parameterCount * input.parameterCount,
        factorNnz: input.parameterCount * input.parameterCount,
        ordering: 'fake-dense',
        solver: 'fake-dense',
      };
    },
  },
  sparseRowProductsSolver: {
    queryRowProducts: () => {
      throw new Error('fake row products unavailable (fail-closed)');
    },
  },
  sparseSelectedCovarianceSolver: {
    querySelected: (input: SparseSelectedCovarianceInput): SparseSelectedCovarianceResult => {
      const n = input.parameterCount;
      const normal: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
      const readRow = (row: number): Array<{ index: number; value: number }> => {
        const start = input.design.rowOffsets[row] ?? 0;
        const end = input.design.rowOffsets[row + 1] ?? start;
        const entries: Array<{ index: number; value: number }> = [];
        for (let k = start; k < end; k += 1) {
          entries.push({ index: input.design.columns[k] ?? -1, value: input.design.values[k] ?? Number.NaN });
        }
        return entries;
      };
      for (let k = 0; k < input.weights.rows.length; k += 1) {
        const r = input.weights.rows[k] ?? -1;
        const c = input.weights.columns[k] ?? -1;
        const w = input.weights.values[k] ?? Number.NaN;
        if (w === 0) continue;
        const rowR = readRow(r);
        if (r === c) {
          for (const a of rowR) for (const b of rowR) normal[a.index]![b.index]! += a.value * w * b.value;
        } else {
          const rowC = readRow(c);
          for (const a of rowR) for (const b of rowC) {
            const contribution = a.value * w * b.value;
            normal[a.index]![b.index]! += contribution;
            normal[b.index]![a.index]! += contribution;
          }
        }
      }
      const scaled = scaleNormalMatrix(normal);
      const factorization = choleskyDecomposeWithDamping(scaled.scaled);
      const needed = [...new Set(input.queryColumns)].sort((a, b) => a - b);
      const columns = new Map<number, number[]>();
      for (const column of needed) {
        const unit = Array.from({ length: n }, (_, row) => (row === column ? [1] : [0]));
        const solved = solveSPDFromCholesky(factorization.factor, scaleNormalRhs(unit, scaled.scale));
        columns.set(column, unscaleNormalSolution(solved, scaled.scale).map((row) => row[0] ?? Number.NaN));
      }
      const covariance = Float64Array.from({ length: input.queryRows.length }, (_, k) => {
        const value = columns.get(input.queryColumns[k] ?? -1)?.[input.queryRows[k] ?? -1] ?? Number.NaN;
        if (options?.corruptCovariance && k === 0) return value * 4 + 1;
        return value;
      });
      return {
        covariance,
        normalNnz: n * n,
        factorNnz: n * n,
        damping: options?.damping ?? 0,
        dampingAttempts: 0,
      };
    },
  },
});

const fakeLoader = (options?: { damping?: number; corruptCovariance?: boolean }) => () =>
  Promise.resolve(buildFakeBundle(options) as unknown as import('../src/workers/adjustmentSparseAutoRoute').SparseAutoRouteBundle);

const stripVolatileResult = (result: unknown): unknown => {
  const clone = JSON.parse(JSON.stringify(result)) as Record<string, unknown>;
  delete clone.solveTimingProfile;
  if (Array.isArray(clone.logs)) {
    clone.logs = (clone.logs as string[]).filter((line) => !line.startsWith('Solve timing (ms):'));
  }
  return clone;
};

const stableOutcomeKey = (outcome: RunSessionOutcome): string =>
  JSON.stringify({
    result: stripVolatileResult(outcome.result),
    effectiveExcludedIds: outcome.effectiveExcludedIds,
    activePreanalysisAdditionIds: outcome.activePreanalysisAdditionIds,
    effectiveClusterApprovedMerges: outcome.effectiveClusterApprovedMerges,
    droppedExclusions: outcome.droppedExclusions,
    droppedPreanalysisAdditions: outcome.droppedPreanalysisAdditions,
    droppedOverrides: outcome.droppedOverrides,
    droppedClusterMerges: outcome.droppedClusterMerges,
    inputChangedSinceLastRun: outcome.inputChangedSinceLastRun,
  });

const expectRestartIdentical = (candidate: RunSessionOutcome, reference: RunSessionOutcome): void => {
  expect(stableOutcomeKey(candidate)).toBe(stableOutcomeKey(reference));
};

describe('phase 8A.7 preanalysis production hook', () => {
  it('is default-disabled with no WASM init and deep-equal TypeScript results', async () => {
    setPreanalysisSparseAutoRouteEnabled(false);
    clearPreanalysisSparseAutoRouteTestHooks();
    expect(isPreanalysisSparseAutoRouteEnabled()).toBe(false);
    const request = makePreanalysisRequest(SMALL_INPUT);
    let bundleInitCalls = 0;
    const attempt = await runWithPreanalysisSparseAutoRoute(request, undefined, {
      runSession: runAdjustmentSession,
      loadBundle: () => {
        bundleInitCalls += 1;
        throw new Error('WASM init must not run while disabled');
      },
    });
    expect(bundleInitCalls).toBe(0);
    expect(attempt.route).toBe('typescript');
    expect(attempt.reasons.join(' ')).toMatch(/disabled by kill switch/);
    const direct = runAdjustmentSession(request);
    expectRestartIdentical(attempt.outcome, direct);
  });

  it('accepts an eligible session when enabled with a correct bundle', async () => {
    setPreanalysisSparseAutoRouteEnabled(true);
    clearPreanalysisSparseAutoRouteTestHooks();
    try {
      const request = makePreanalysisRequest(SMALL_INPUT);
      const eligibility = derivePreanalysisSparseAutoRouteEligibility(request);
      expect(eligibility.eligible).toBe(true);
      const attempt = await runWithPreanalysisSparseAutoRoute(request, undefined, {
        runSession: runAdjustmentSession,
        loadBundle: fakeLoader(),
      });
      expect(attempt.route).toBe('sparse');
      expect(attempt.reasons).toEqual([]);
      const direct = runAdjustmentSession(request);
      const comparison = comparePreanalysisContract(direct.result, attempt.outcome.result);
      expect(comparison.pass, comparison.reasons.join('; ')).toBe(true);
    } finally {
      setPreanalysisSparseAutoRouteEnabled(false);
      clearPreanalysisSparseAutoRouteTestHooks();
    }
  });

  it('rejects ineligible modes statically with no WASM init', async () => {
    setPreanalysisSparseAutoRouteEnabled(true);
    clearPreanalysisSparseAutoRouteTestHooks();
    try {
      const invalid = createRunSessionRequest({ input: SMALL_INPUT });
      const request3d = createRunSessionRequest({
        input: SMALL_INPUT,
        parseSettings: { ...invalid.parseSettings, runMode: 'preanalysis', coordMode: '3D' },
      });
      let calls = 0;
      const attempt = await runWithPreanalysisSparseAutoRoute(request3d, undefined, {
        runSession: runAdjustmentSession,
        loadBundle: () => {
          calls += 1;
          return fakeLoader()();
        },
      });
      expect(attempt.route).toBe('typescript');
      expect(calls).toBe(0);
      const robust = makePreanalysisRequest(SMALL_INPUT);
      robust.parseSettings = { ...robust.parseSettings, robustMode: 'huber' };
      // UI-only robust is normalized to none by the effective preanalysis
      // parse (exactly what the solver runs), so it no longer rejects;
      // a content-level .ROBUST directive still rejects fail-closed.
      expect(derivePreanalysisSparseAutoRouteEligibility(robust).eligible).toBe(true);
      const robustContent = makePreanalysisRequest(`${SMALL_INPUT}\n.ROBUST HUBER\n`);
      expect(derivePreanalysisSparseAutoRouteEligibility(robustContent).eligible).toBe(false);
    } finally {
      setPreanalysisSparseAutoRouteEnabled(false);
      clearPreanalysisSparseAutoRouteTestHooks();
    }
  });

  it('falls back atomic on corrupted covariance with restart-identical TypeScript rerun', async () => {
    setPreanalysisSparseAutoRouteEnabled(true);
    clearPreanalysisSparseAutoRouteTestHooks();
    try {
      const request = makePreanalysisRequest(SMALL_INPUT);
      const attempt = await runWithPreanalysisSparseAutoRoute(request, undefined, {
        runSession: runAdjustmentSession,
        loadBundle: fakeLoader({ corruptCovariance: true }),
      });
      expect(attempt.route).toBe('typescript');
      expect(attempt.reasons.length).toBeGreaterThan(0);
      const direct = runAdjustmentSession(request);
      expectRestartIdentical(attempt.outcome, direct);
    } finally {
      setPreanalysisSparseAutoRouteEnabled(false);
      clearPreanalysisSparseAutoRouteTestHooks();
    }
  });

  it('falls back atomic on damped native factors', async () => {
    setPreanalysisSparseAutoRouteEnabled(true);
    clearPreanalysisSparseAutoRouteTestHooks();
    try {
      const request = makePreanalysisRequest(SMALL_INPUT);
      const attempt = await runWithPreanalysisSparseAutoRoute(request, undefined, {
        runSession: runAdjustmentSession,
        loadBundle: fakeLoader({ damping: 1e-8 }),
      });
      expect(attempt.route).toBe('typescript');
      const direct = runAdjustmentSession(request);
      expectRestartIdentical(attempt.outcome, direct);
    } finally {
      setPreanalysisSparseAutoRouteEnabled(false);
      clearPreanalysisSparseAutoRouteTestHooks();
    }
  });

  it('camp fixture holds back before the Phase 9B runtime cap 256 sparse attempt', async () => {
    setPreanalysisSparseAutoRouteEnabled(true);
    clearPreanalysisSparseAutoRouteTestHooks();
    try {
      const request = makePreanalysisRequest(CAMP_INPUT);
      const eligibility = derivePreanalysisSparseAutoRouteEligibility(request);
      // The cheap solve-preparation preflight recognizes the camp's
      // direction-heavy shape before WASM initialization.
      expect(eligibility.unknownCount).toBe(46);
      expect(eligibility.preflight?.orientationParameterCount).toBe(84);
      expect(eligibility.preflight?.admitted).toBe(false);
      let bundleLoads = 0;
      const attempt = await runWithPreanalysisSparseAutoRoute(request, undefined, {
        runSession: runAdjustmentSession,
        loadBundle: async () => {
          bundleLoads += 1;
          throw new Error('preflight should avoid bundle loading');
        },
      });
      expect(attempt.route).toBe('typescript');
      expect(attempt.sparseAttempted).toBe(false);
      expect(attempt.bundleLoaded).toBe(false);
      expect(bundleLoads).toBe(0);
      expect(attempt.reasons.join(' ')).toMatch(/direction-heavy preflight holdback/);
      const direct = runAdjustmentSession(request);
      expectRestartIdentical(attempt.outcome, direct);
    } finally {
      setPreanalysisSparseAutoRouteEnabled(false);
      clearPreanalysisSparseAutoRouteTestHooks();
    }
  }, 120000);

  it('exercises exact unknown boundaries 127/128/129 via test hooks', () => {
    setPreanalysisSparseAutoRouteEnabled(true);
    try {
      const request = makePreanalysisRequest(SMALL_INPUT);
      const outcomes: Array<{ unknowns: number; eligible: boolean }> = [];
      for (const unknowns of [127, 128, 129]) {
        setPreanalysisSparseAutoRouteTestHooks({ unknownCountOverride: unknowns });
        const eligibility = derivePreanalysisSparseAutoRouteEligibility(request);
        outcomes.push({ unknowns, eligible: eligibility.eligible });
      }
      expect(outcomes).toEqual([
        { unknowns: 127, eligible: true },
        { unknowns: 128, eligible: true },
        { unknowns: 129, eligible: false },
      ]);
    } finally {
      clearPreanalysisSparseAutoRouteTestHooks();
      setPreanalysisSparseAutoRouteEnabled(false);
    }
  });

  it('stops native delegation at the 64-system gate (63/64/65 exact)', () => {
    // Direct pre-dispatch proof: the 65th correction entry throws typed
    // fail-closed BEFORE delegating, so over-cap systems never execute.
    const buildGateInput = (parameterCount: number): SparseCorrectionSolveInput => ({
      design: {
        rowOffsets: Int32Array.from({ length: 5 }, (_, k) => k),
        columns: Int32Array.from([0, 1, 2, 3]),
        values: Float64Array.from([1, 1, 1, 1]),
      },
      weights: {
        rows: Int32Array.from([0, 1, 2, 3]),
        columns: Int32Array.from([0, 1, 2, 3]),
        values: Float64Array.from([1, 1, 1, 1]),
      },
      misclosures: Float64Array.from([0, 0, 0, 0]),
      observationEquationCount: 4,
      parameterCount,
    });
    const caps = {
      maxSystems: PREANALYSIS_SPARSE_ROUTE_MAX_PLANNING_SYSTEMS,
      maxParameters: PREANALYSIS_SPARSE_ROUTE_MAX_PARAMETERS,
    };
    for (const total of [63, 64]) {
      let delegated = 0;
      const state = createPreanalysisCandidateState();
      const gate = new PreanalysisGatedCorrectionSolver(
        {
          solveFromEquations: (input: SparseCorrectionSolveInput): SparseCorrectionSolveResult => {
            delegated += 1;
            return {
              correction: Array.from({ length: input.parameterCount }, () => [0]),
              damping: 0,
              dampingAttempts: 0,
              designNnz: 4,
              weightNnz: 4,
              normalNnz: 16,
              factorNnz: 16,
              ordering: 'test',
              solver: 'test',
            };
          },
        },
        state,
        caps,
      );
      for (let k = 0; k < total; k += 1) gate.solveFromEquations(buildGateInput(4));
      expect(delegated).toBe(total);
      expect(state.aborted).toBe(false);
      expect(state.systemsStarted).toBe(total);
    }
    // 65th system: typed abort before delegation, delegate stays at 64.
    {
      let delegated = 0;
      const state = createPreanalysisCandidateState();
      const gate = new PreanalysisGatedCorrectionSolver(
        {
          solveFromEquations: (input: SparseCorrectionSolveInput): SparseCorrectionSolveResult => {
            delegated += 1;
            return {
              correction: Array.from({ length: input.parameterCount }, () => [0]),
              damping: 0,
              dampingAttempts: 0,
              designNnz: 4,
              weightNnz: 4,
              normalNnz: 16,
              factorNnz: 16,
              ordering: 'test',
              solver: 'test',
            };
          },
        },
        state,
        caps,
      );
      for (let k = 0; k < 64; k += 1) gate.solveFromEquations(buildGateInput(4));
      expect(delegated).toBe(64);
      expect(state.aborted).toBe(false);
      let thrown: unknown = null;
      try {
        gate.solveFromEquations(buildGateInput(4));
      } catch (error) {
        thrown = error;
      }
      expect(isPreanalysisSparseCapError(thrown)).toBe(true);
      expect(delegated).toBe(64);
      expect(state.aborted).toBe(true);
      expect(state.systemsStarted).toBe(64);
      expect(state.abortReason ?? '').toMatch(/exceed cap 64.*not delegated/);
    }
  });

  it('rejects parameterCount 257 before delegation (255/256 delegate)', () => {
    const caps = {
      maxSystems: PREANALYSIS_SPARSE_ROUTE_MAX_PLANNING_SYSTEMS,
      maxParameters: PREANALYSIS_SPARSE_ROUTE_MAX_PARAMETERS,
    };
    const buildSizedInput = (parameterCount: number): SparseCorrectionSolveInput => ({
      design: {
        rowOffsets: Int32Array.from({ length: parameterCount + 1 }, (_, k) => k),
        columns: Int32Array.from({ length: parameterCount }, (_, k) => k),
        values: Float64Array.from({ length: parameterCount }, () => 1),
      },
      weights: {
        rows: Int32Array.from({ length: parameterCount }, (_, k) => k),
        columns: Int32Array.from({ length: parameterCount }, (_, k) => k),
        values: Float64Array.from({ length: parameterCount }, () => 1),
      },
      misclosures: Float64Array.from({ length: parameterCount }, () => 0),
      observationEquationCount: parameterCount,
      parameterCount,
    });
    for (const n of [255, 256]) {
      let delegated = 0;
      const state = createPreanalysisCandidateState();
      const gate = new PreanalysisGatedCorrectionSolver(
        {
          solveFromEquations: (input: SparseCorrectionSolveInput): SparseCorrectionSolveResult => {
            delegated += 1;
            return {
              correction: Array.from({ length: input.parameterCount }, () => [0]),
              damping: 0,
              dampingAttempts: 0,
              designNnz: n,
              weightNnz: n,
              normalNnz: n,
              factorNnz: n,
              ordering: 'test',
              solver: 'test',
            };
          },
        },
        state,
        caps,
      );
      gate.solveFromEquations(buildSizedInput(n));
      expect(delegated).toBe(1);
      expect(state.aborted).toBe(false);
    }
    // 257: typed abort before delegation, delegate never runs.
    {
      let delegated = 0;
      const state = createPreanalysisCandidateState();
      const gate = new PreanalysisGatedCorrectionSolver(
        {
          solveFromEquations: (): SparseCorrectionSolveResult => {
            delegated += 1;
            throw new Error('must not delegate parameterCount 257');
          },
        },
        state,
        caps,
      );
      let thrown: unknown = null;
      try {
        gate.solveFromEquations(buildSizedInput(257));
      } catch (error) {
        thrown = error;
      }
      expect(isPreanalysisSparseCapError(thrown)).toBe(true);
      expect(delegated).toBe(0);
      expect(state.aborted).toBe(true);
      expect(state.abortReason ?? '').toMatch(/parameterCount 257 exceeds cap 256.*not delegated/);
      // Covariance side mirrors it: unpaired and over-cap queries never delegate.
      let covDelegated = 0;
      const covGate = new PreanalysisGatedCovarianceCapture(
        {
          querySelected: (): SparseSelectedCovarianceResult => {
            covDelegated += 1;
            throw new Error('must not delegate unpaired/over-cap covariance');
          },
        },
        state,
        caps,
      );
      // State is aborted: covariance refuses before delegating.
      let covThrown: unknown = null;
      try {
        covGate.querySelected({
          design: buildSizedInput(4).design,
          weights: buildSizedInput(4).weights,
          observationEquationCount: 4,
          parameterCount: 4,
          queryRows: Int32Array.from([0]),
          queryColumns: Int32Array.from([0]),
        });
      } catch (error) {
        covThrown = error;
      }
      expect(isPreanalysisSparseCapError(covThrown)).toBe(true);
      expect(covDelegated).toBe(0);
    }
    // Fresh state: covariance without a paired correction entry never delegates.
    {
      let covDelegated = 0;
      const fresh = createPreanalysisCandidateState();
      const covGate = new PreanalysisGatedCovarianceCapture(
        {
          querySelected: (): SparseSelectedCovarianceResult => {
            covDelegated += 1;
            throw new Error('must not delegate unpaired covariance');
          },
        },
        fresh,
        caps,
      );
      let thrown: unknown = null;
      try {
        covGate.querySelected({
          design: buildSizedInput(4).design,
          weights: buildSizedInput(4).weights,
          observationEquationCount: 4,
          parameterCount: 4,
          queryRows: Int32Array.from([0]),
          queryColumns: Int32Array.from([0]),
        });
      } catch (error) {
        thrown = error;
      }
      expect(isPreanalysisSparseCapError(thrown)).toBe(true);
      expect((thrown as PreanalysisSparseCapError).routeReason).toMatch(/without paired correction entry/);
      expect(covDelegated).toBe(0);
    }
  });

  it('aborts a live session pre-dispatch via a lowered system cap', async () => {
    setPreanalysisSparseAutoRouteEnabled(true);
    try {
      // SMALL runs ~15 planning solves; a test-only cap of 3 forces the
      // typed abort at the 4th correction entry. The 4th system must never
      // execute natively: the counting delegate sees exactly 3 corrections.
      let correctionDelegations = 0;
      const countingCorrection: SparseCorrectionSolver = {
        solveFromEquations: (input: SparseCorrectionSolveInput): SparseCorrectionSolveResult => {
          correctionDelegations += 1;
          const dense = buildFakeBundle().sparseCorrectionSolver;
          return dense.solveFromEquations(input);
        },
      };
      const request = makePreanalysisRequest(SMALL_INPUT);
      setPreanalysisSparseAutoRouteTestHooks({ systemCapOverride: 3 });
      const attempt = await runWithPreanalysisSparseAutoRoute(request, undefined, {
        runSession: runAdjustmentSession,
        loadBundle: () =>
          Promise.resolve({
            ...buildFakeBundle(),
            sparseCorrectionSolver: countingCorrection,
          } as unknown as import('../src/workers/adjustmentSparseAutoRoute').SparseAutoRouteBundle),
      });
      expect(attempt.route).toBe('typescript');
      expect(correctionDelegations).toBe(3);
      expect(attempt.reasons.join(' ')).toMatch(/planning systems 4 exceed cap 3.*not delegated/);
      expectRestartIdentical(attempt.outcome, runAdjustmentSession(request));
    } finally {
      clearPreanalysisSparseAutoRouteTestHooks();
      setPreanalysisSparseAutoRouteEnabled(false);
    }
  });

  it('falls back atomic on forced C2 verification failure (test hook)', async () => {
    setPreanalysisSparseAutoRouteEnabled(true);
    try {
      const request = makePreanalysisRequest(SMALL_INPUT);
      setPreanalysisSparseAutoRouteTestHooks({ forceC2Failure: true });
      const attempt = await runWithPreanalysisSparseAutoRoute(request, undefined, {
        runSession: runAdjustmentSession,
        loadBundle: fakeLoader(),
      });
      expect(attempt.route).toBe('typescript');
      expect(attempt.reasons.join(' ')).toMatch(/forced C2 failure/);
      expectRestartIdentical(attempt.outcome, runAdjustmentSession(request));
    } finally {
      clearPreanalysisSparseAutoRouteTestHooks();
      setPreanalysisSparseAutoRouteEnabled(false);
    }
  });

  it('falls back atomic on forced physical failure (test hook)', async () => {
    setPreanalysisSparseAutoRouteEnabled(true);
    try {
      const request = makePreanalysisRequest(SMALL_INPUT);
      setPreanalysisSparseAutoRouteTestHooks({ forcePhysicalFailure: true });
      const attempt = await runWithPreanalysisSparseAutoRoute(request, undefined, {
        runSession: runAdjustmentSession,
        loadBundle: fakeLoader(),
      });
      expect(attempt.route).toBe('typescript');
      expect(attempt.reasons.join(' ')).toMatch(/forced physical failure/);
      expectRestartIdentical(attempt.outcome, runAdjustmentSession(request));
    } finally {
      clearPreanalysisSparseAutoRouteTestHooks();
      setPreanalysisSparseAutoRouteEnabled(false);
    }
  });

  it('retries cleanly after WASM init failure', async () => {
    setPreanalysisSparseAutoRouteEnabled(true);
    clearPreanalysisSparseAutoRouteTestHooks();
    try {
      const request = makePreanalysisRequest(SMALL_INPUT);
      let calls = 0;
      const failed = await runWithPreanalysisSparseAutoRoute(request, undefined, {
        runSession: runAdjustmentSession,
        loadBundle: () => {
          calls += 1;
          return Promise.reject(new Error('boom-init'));
        },
      });
      expect(failed.route).toBe('typescript');
      expect(calls).toBe(1);
      expectRestartIdentical(failed.outcome, runAdjustmentSession(request));
      const retried = await runWithPreanalysisSparseAutoRoute(request, undefined, {
        runSession: runAdjustmentSession,
        loadBundle: fakeLoader(),
      });
      expect(retried.route).toBe('sparse');
    } finally {
      setPreanalysisSparseAutoRouteEnabled(false);
      clearPreanalysisSparseAutoRouteTestHooks();
    }
  });

  it('leaves the adjustment route behavior unchanged (adjustment regression)', () => {
    const adjustment = createRunSessionRequest({ input: SMALL_INPUT });
    const verdict = deriveSparseAutoRouteEligibility(adjustment);
    expect(verdict.eligible).toBe(false);
    const preanalysis = makePreanalysisRequest(SMALL_INPUT);
    expect(deriveSparseAutoRouteEligibility(preanalysis).eligible).toBe(false);
    setPreanalysisSparseAutoRouteEnabled(true);
    try {
      expect(derivePreanalysisSparseAutoRouteEligibility(adjustment).eligible).toBe(false);
    } finally {
      setPreanalysisSparseAutoRouteEnabled(false);
    }
  });

  it('writes phase 8A.7 production-hook reports and audit', async () => {
    setPreanalysisSparseAutoRouteEnabled(false);
    clearPreanalysisSparseAutoRouteTestHooks();
    const request = makePreanalysisRequest(SMALL_INPUT);
    let disabledInitCalls = 0;
    const disabled = await runWithPreanalysisSparseAutoRoute(request, undefined, {
      runSession: runAdjustmentSession,
      loadBundle: () => {
        disabledInitCalls += 1;
        throw new Error('must not init while disabled');
      },
    });
    const direct = runAdjustmentSession(request);
    setPreanalysisSparseAutoRouteEnabled(true);
    clearPreanalysisSparseAutoRouteTestHooks();
    const enabled = await runWithPreanalysisSparseAutoRoute(request, undefined, {
      runSession: runAdjustmentSession,
      loadBundle: fakeLoader(),
    });
    setPreanalysisSparseAutoRouteEnabled(false);
    clearPreanalysisSparseAutoRouteTestHooks();
    const productionSources = [
      'src/workers/preanalysisSparseAutoRoute.ts',
      'src/engine/preanalysisSparseCovarianceSentinel.ts',
      'src/engine/preanalysisSparseSessionPolicy.ts',
      'src/workers/adjustmentWorker.ts',
    ];
    const forbidden = ['phase8a6', 'tests/', 'scripts/'];
    const violations = productionSources.flatMap((file) => {
      const text = fs.readFileSync(path.join(process.cwd(), file), 'utf-8');
      return forbidden.filter((token) => text.includes(token)).map((token) => `${file} contains ${token}`);
    }).filter((violation) => !violation.includes('Phase 8A.6 evidence math'));
    fs.mkdirSync(REPORT_DIR, { recursive: true });
    const enabledComparison = comparePreanalysisContract(direct.result, enabled.outcome.result);
    const hook = {
      phase: '8A.7',
      defaultEnabled: isPreanalysisSparseAutoRouteEnabled(),
      disabledNoWasmInit: disabledInitCalls === 0,
      disabledRoute: disabled.route,
      disabledDeepEqual: stableOutcomeKey(disabled.outcome) === stableOutcomeKey(direct),
      enabledRoute: enabled.route,
      enabledDeepEqual: enabledComparison.pass,
      enabledContractReasons: enabledComparison.reasons.slice(0, 5),
      caps: {
        unknownCap: PREANALYSIS_SPARSE_ROUTE_MAX_STATION_UNKNOWNS,
        planningSystemCap: PREANALYSIS_SPARSE_ROUTE_MAX_PLANNING_SYSTEMS,
        runtimeParameterCap: PREANALYSIS_SPARSE_ROUTE_MAX_PARAMETERS,
      },
      preDispatchEnforcement: true,
      noForbiddenImports: violations,
      adjustmentRegression: deriveSparseAutoRouteEligibility(createRunSessionRequest({ input: SMALL_INPUT })).eligible === false,
    };
    expect(hook.disabledNoWasmInit).toBe(true);
    expect(hook.disabledRoute).toBe('typescript');
    expect(hook.disabledDeepEqual).toBe(true);
    expect(hook.noForbiddenImports).toEqual([]);
    fs.writeFileSync(path.join(REPORT_DIR, 'preanalysis-production-hook.json'), `${JSON.stringify(hook, null, 2)}\n`);
    fs.writeFileSync(
      path.join(REPORT_DIR, 'preanalysis-production-hook.md'),
      [
        '# Phase 8A.7 preanalysis production hook (default-disabled)',
        '',
        `- default enabled: ${hook.defaultEnabled}`,
        `- disabled route: ${hook.disabledRoute} (WASM inits: ${disabledInitCalls})`,
        `- disabled deep-equal TypeScript: ${hook.disabledDeepEqual}`,
        `- enabled route (fake correct bundle): ${hook.enabledRoute} (deep-equal: ${hook.enabledDeepEqual})`,
        `- caps: unknowns<=${hook.caps.unknownCap}, systems<=${hook.caps.planningSystemCap}, runtime parameters<=${hook.caps.runtimeParameterCap}` + ' (Phase 9B: station 128 / runtime 256)',
        `- forbidden-import violations: ${violations.length === 0 ? 'none' : violations.join('; ')}`,
        `- adjustment regression (adjustment input still ineligible for adjustment auto-route here): ${hook.adjustmentRegression}`,
        '',
        'Whole-session atomicity: any damping/fallback/C1/C2/C3/physical/cap failure restarts the original immutable request clean in TypeScript exactly once. Condition is warn-only; correction carries no authority.',
        'Pre-dispatch enforcement: gated correction/covariance wrappers throw typed fail-closed errors before delegating past 64 systems or 256 runtime parameters (over-cap systems never execute natively); covariance must pair with a started correction system.',
        '',
      ].join('\n'),
    );
  });

});
