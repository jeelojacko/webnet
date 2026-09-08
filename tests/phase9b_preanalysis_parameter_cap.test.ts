/**
 * Phase 9B production runtime parameter cap 256 (fast, fake-bundle, agent tier).
 *
 * Pins the split Phase 9B caps without running WASM:
 * station unknowns 128 / runtime parameters 256 / planning systems 64 /
 * verification k=16 / backstop 16384 / captured 512.
 * Station boundary stays 127/128/129; runtime boundary is 255/256/257
 * through the correction pre-dispatch gate, the covariance header gate,
 * and the bounded-verification sentinel (256-column build passes, 257
 * fails). No C++/UI/protocol/persistence changes.
 */
import { describe, expect, it } from 'vitest';

import type {
  SparseCorrectionSolveInput,
  SparseCorrectionSolveResult,
  SparseSelectedCovarianceResult,
} from '../src/engine/numericalBackend';
import {
  evaluatePreanalysisSparseWholeSession,
  PREANALYSIS_SPARSE_PARAMETER_CAP,
  PREANALYSIS_SPARSE_PLANNING_SYSTEM_CAP,
  PREANALYSIS_SPARSE_STATION_UNKNOWN_CAP,
} from '../src/engine/preanalysisSparseSessionPolicy';
import {
  buildBoundedVerificationQueries,
  PREANALYSIS_SPARSE_SENTINEL_MAX_PARAMETERS,
  PREANALYSIS_SPARSE_SENTINEL_MAX_UNKNOWN_COUNT,
  PREANALYSIS_SPARSE_VERIFICATION_COLUMN_COUNT,
} from '../src/engine/preanalysisSparseCovarianceSentinel';
import {
  clearPreanalysisSparseAutoRouteTestHooks,
  createPreanalysisCandidateState,
  derivePreanalysisSparseAutoRouteEligibility,
  isPreanalysisSparseCapError,
  PREANALYSIS_SPARSE_ROUTE_MAX_PARAMETERS,
  PREANALYSIS_SPARSE_ROUTE_MAX_STATION_UNKNOWNS,
  PreanalysisGatedCorrectionSolver,
  PreanalysisGatedCovarianceCapture,
  setPreanalysisSparseAutoRouteEnabled,
  setPreanalysisSparseAutoRouteTestHooks,
} from '../src/workers/preanalysisSparseAutoRoute';
import {
  PREANALYSIS_SPARSE_ROUTE_MAX_CAPTURED_CALLS,
  PREANALYSIS_SPARSE_ROUTE_MAX_PLANNING_SYSTEMS,
  PREANALYSIS_SPARSE_ROUTE_MAX_VERIFICATION_QUERIES,
} from '../src/workers/preanalysisSparseAutoRouteCaps';
import { verifyCovarianceSystem } from '../src/workers/preanalysisSparseCovarianceGate';
import { createRunSessionRequest } from './helpers/runSessionRequest';
import fs from 'node:fs';
import path from 'node:path';

const SMALL_INPUT = fs.readFileSync(
  path.join(process.cwd(), 'tests/fixtures/preanalysis_cli.dat'),
  'utf-8',
);

const makePreanalysisRequest = (input: string) => {
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

const okCorrection = (n: number) => ({
  solveFromEquations: (input: SparseCorrectionSolveInput): SparseCorrectionSolveResult => ({
    correction: Array.from({ length: input.parameterCount }, () => [0]),
    damping: 0,
    dampingAttempts: 0,
    designNnz: n,
    weightNnz: n,
    normalNnz: n,
    factorNnz: n,
    ordering: 'test',
    solver: 'test',
  }),
});

describe('phase 9B production runtime parameter cap', () => {
  it('pins the split authoritative caps', () => {
    expect(PREANALYSIS_SPARSE_STATION_UNKNOWN_CAP).toBe(128);
    expect(PREANALYSIS_SPARSE_PARAMETER_CAP).toBe(256);
    expect(PREANALYSIS_SPARSE_PLANNING_SYSTEM_CAP).toBe(64);
    expect(PREANALYSIS_SPARSE_ROUTE_MAX_STATION_UNKNOWNS).toBe(128);
    expect(PREANALYSIS_SPARSE_ROUTE_MAX_PARAMETERS).toBe(256);
    expect(PREANALYSIS_SPARSE_ROUTE_MAX_PLANNING_SYSTEMS).toBe(64);
    expect(PREANALYSIS_SPARSE_ROUTE_MAX_CAPTURED_CALLS).toBe(512);
    expect(PREANALYSIS_SPARSE_ROUTE_MAX_VERIFICATION_QUERIES).toBe(16384);
    expect(PREANALYSIS_SPARSE_VERIFICATION_COLUMN_COUNT).toBe(16);
    // Historical sentinel station bound kept for 9A references; runtime uses 256.
    expect(PREANALYSIS_SPARSE_SENTINEL_MAX_UNKNOWN_COUNT).toBe(128);
    expect(PREANALYSIS_SPARSE_SENTINEL_MAX_PARAMETERS).toBe(256);
  });

  it('keeps the station eligibility boundary at 127/128/129', () => {
    setPreanalysisSparseAutoRouteEnabled(true);
    try {
      const request = makePreanalysisRequest(SMALL_INPUT);
      const outcomes: Array<{ unknowns: number; eligible: boolean }> = [];
      for (const unknowns of [127, 128, 129]) {
        setPreanalysisSparseAutoRouteTestHooks({ unknownCountOverride: unknowns });
        outcomes.push({
          unknowns,
          eligible: derivePreanalysisSparseAutoRouteEligibility(request).eligible,
        });
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

  it('delegates 255/256 and aborts 257 before native execution', () => {
    const caps = {
      maxSystems: PREANALYSIS_SPARSE_ROUTE_MAX_PLANNING_SYSTEMS,
      maxParameters: PREANALYSIS_SPARSE_ROUTE_MAX_PARAMETERS,
    };
    for (const n of [255, 256]) {
      let delegated = 0;
      const state = createPreanalysisCandidateState();
      const gate = new PreanalysisGatedCorrectionSolver(
        {
          solveFromEquations: (input: SparseCorrectionSolveInput): SparseCorrectionSolveResult => {
            delegated += 1;
            return okCorrection(n).solveFromEquations(input);
          },
        },
        state,
        caps,
      );
      gate.solveFromEquations(buildSizedInput(n));
      expect(delegated).toBe(1);
      expect(state.aborted).toBe(false);
    }
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
  });

  it('refuses over-cap covariance at the header gate without delegating', () => {
    const caps = {
      maxSystems: PREANALYSIS_SPARSE_ROUTE_MAX_PLANNING_SYSTEMS,
      maxParameters: PREANALYSIS_SPARSE_ROUTE_MAX_PARAMETERS,
    };
    const state = createPreanalysisCandidateState();
    state.systemsStarted = 1;
    let delegated = 0;
    const gate = new PreanalysisGatedCovarianceCapture(
      {
        querySelected: (): SparseSelectedCovarianceResult => {
          delegated += 1;
          throw new Error('must not delegate parameterCount 257 covariance');
        },
      },
      state,
      caps,
    );
    const sized = buildSizedInput(257);
    const verdict = verifyCovarianceSystem(
      {
        input: {
          design: sized.design,
          weights: sized.weights,
          observationEquationCount: sized.observationEquationCount,
          parameterCount: 257,
          queryRows: Int32Array.from([0]),
          queryColumns: Int32Array.from([0]),
        },
        result: {
          covariance: Float64Array.from([1]),
          normalNnz: 1,
          factorNnz: 1,
          damping: 0,
          dampingAttempts: 0,
        },
        threw: false,
      },
      0,
      {
        querySelected: (): SparseSelectedCovarianceResult => {
          delegated += 1;
          throw new Error('must not delegate during verify');
        },
      },
      {},
      caps.maxParameters,
    );
    expect(verdict.reasons.join(' ')).toMatch(/parameterCount 257 outside 1\.\.256/);
    expect(delegated).toBe(0);
    expect(gate.verdicts.length).toBe(0);
  });

  it('builds bounded verification at 256 and fails closed at 257', () => {
    const built = buildBoundedVerificationQueries(
      256,
      PREANALYSIS_SPARSE_VERIFICATION_COLUMN_COUNT,
      PREANALYSIS_SPARSE_SENTINEL_MAX_PARAMETERS,
    );
    expect(built.verifiedColumns.length).toBe(16);
    expect(built.rows.length).toBe(16 * 256);
    expect(built.rows.length).toBeLessThanOrEqual(
      PREANALYSIS_SPARSE_ROUTE_MAX_VERIFICATION_QUERIES,
    );
    expect(() =>
      buildBoundedVerificationQueries(
        257,
        PREANALYSIS_SPARSE_VERIFICATION_COLUMN_COUNT,
        PREANALYSIS_SPARSE_SENTINEL_MAX_PARAMETERS,
      ),
    ).toThrow();
  });

  it('keeps static whole-session policy at station 128', () => {
    const pass = {
      index: 0,
      staticAdmit: true,
      physicalValid: true,
      sentinelPass: true,
      correctionPass: true,
    };
    expect(
      evaluatePreanalysisSparseWholeSession({ unknownCount: 128, systems: [pass] }).admit,
    ).toBe(true);
    expect(
      evaluatePreanalysisSparseWholeSession({ unknownCount: 129, systems: [pass] }).admit,
    ).toBe(false);
  });
});
