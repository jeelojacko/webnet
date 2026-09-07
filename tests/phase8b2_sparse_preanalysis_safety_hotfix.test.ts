/**
 * Sparse preanalysis safety hotfix regressions (production modules only).
 *
 * (A) Eligibility inspects the effective project content: inline
 * `.AUTOADJUST`/`.ROBUST` directives smuggled through `projectIncludeFiles`
 * (`.INCLUDE`) or `projectRunFiles` reject even when the main input is
 * clean, while a clean include stays eligible.
 * (B) C1 tiny-covariance scaling: corruption far above the absolute floor
 * on tiny entries rejects (the old unit-scale allowance hid it), exact
 * agreement passes, and unit-scale relative tolerance behavior is kept.
 * (C,D) Immediate-verify covariance gate: verdicts land synchronously per
 * system, only compact verdicts are retained (no packed calls array, peak
 * retained packed systems stays <= 1), unpaired/over-cap calls never
 * delegate, and a route-level corrupted bundle still falls back atomic
 * with a restart-identical TypeScript rerun. Plus production source
 * guards for every touched/added production file.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { choleskyDecomposeWithDamping, solveSPDFromCholesky } from '../src/engine/matrixCholesky';
import {
  scaleNormalMatrix,
  scaleNormalRhs,
  unscaleNormalSolution,
} from '../src/engine/adjustNormalMatrixHelpers';
import { evaluateSentinelC1 } from '../src/engine/preanalysisSparseCovarianceSentinel';
import type {
  SparseSelectedCovarianceInput,
  SparseSelectedCovarianceResult,
} from '../src/engine/numericalBackend';
import { runAdjustmentSession, type RunSessionRequest } from '../src/engine/runSession';
import {
  clearPreanalysisSparseAutoRouteTestHooks,
  createPreanalysisCandidateState,
  derivePreanalysisSparseAutoRouteEligibility,
  isPreanalysisSparseCapError,
  PreanalysisGatedCovarianceCapture,
  runWithPreanalysisSparseAutoRoute,
  setPreanalysisSparseAutoRouteEnabled,
} from '../src/workers/preanalysisSparseAutoRoute';
import { createRunSessionRequest } from './helpers/runSessionRequest';

const readFixture = (file: string): string => fs.readFileSync(path.join(process.cwd(), file), 'utf-8');

const SMALL_INPUT = readFixture('tests/fixtures/preanalysis_cli.dat');

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

describe('hotfix (A) eligibility inspects effective project content', () => {
  it('rejects GPS covariance smuggled through an include file', () => {
    // Observation records persist past include-scope exit even though the
    // weighting directive itself is scoped: the bare main input carries no
    // hint, so only effective-content parsing catches it.
    setPreanalysisSparseAutoRouteEnabled(true);
    try {
      const request = makePreanalysisRequest(`${SMALL_INPUT}\n.INCLUDE gps.dat\n`);
      request.projectIncludeFiles = {
        'gps.dat': [
          '.GPS WEIGHT COVARIANCE',
          "G0 'test session",
          'G1 A-B 10.0 5.0 1.0',
          'G2 1e-06 2e-06 3e-06',
          'G3 4e-07 5e-07 6e-07',
          '',
        ].join('\n'),
      };
      const verdict = derivePreanalysisSparseAutoRouteEligibility(request);
      expect(verdict.eligible).toBe(false);
      expect(verdict.reasons.join(' ')).toMatch(/GPS covariance/);
    } finally {
      setPreanalysisSparseAutoRouteEnabled(false);
    }
  });

  it('rejects inline .AUTOADJUST smuggled through project run files', () => {
    setPreanalysisSparseAutoRouteEnabled(true);
    try {
      const request = makePreanalysisRequest(SMALL_INPUT);
      request.projectRunFiles = [
        { fileId: 'a', name: 'main.dat', order: 0, content: SMALL_INPUT },
        { fileId: 'b', name: 'extra.dat', order: 1, content: '.AUTOADJUST ON\n' },
      ];
      const verdict = derivePreanalysisSparseAutoRouteEligibility(request);
      expect(verdict.eligible).toBe(false);
      expect(verdict.reasons.join(' ')).toMatch(/auto-adjust/);
    } finally {
      setPreanalysisSparseAutoRouteEnabled(false);
    }
  });

  it('ignores include-scoped directives exactly like the solver', () => {
    // `.ROBUST` inside an `.INCLUDE` file is reverted at scope exit, so the
    // solve never sees it either: eligibility must agree (shared parser).
    setPreanalysisSparseAutoRouteEnabled(true);
    try {
      const request = makePreanalysisRequest(`${SMALL_INPUT}\n.INCLUDE robust.dat\n`);
      request.projectIncludeFiles = { 'robust.dat': '.ROBUST HUBER\n' };
      const verdict = derivePreanalysisSparseAutoRouteEligibility(request);
      expect(verdict.eligible).toBe(true);
    } finally {
      setPreanalysisSparseAutoRouteEnabled(false);
    }
  });

  it('rejects inline .AUTOADJUST in the main input', () => {
    setPreanalysisSparseAutoRouteEnabled(true);
    try {
      const request = makePreanalysisRequest(`${SMALL_INPUT}\n.AUTOADJUST ON\n`);
      const verdict = derivePreanalysisSparseAutoRouteEligibility(request);
      expect(verdict.eligible).toBe(false);
      expect(verdict.reasons.join(' ')).toMatch(/auto-adjust/);
    } finally {
      setPreanalysisSparseAutoRouteEnabled(false);
    }
  });

  it('stays eligible with a clean include file', () => {
    setPreanalysisSparseAutoRouteEnabled(true);
    try {
      const request = makePreanalysisRequest(`${SMALL_INPUT}\n.INCLUDE notes.dat\n`);
      request.projectIncludeFiles = { 'notes.dat': "' survey notes only\n" };
      const verdict = derivePreanalysisSparseAutoRouteEligibility(request);
      expect(verdict.eligible).toBe(true);
    } finally {
      setPreanalysisSparseAutoRouteEnabled(false);
    }
  });
});

describe('hotfix (B) C1 tiny-covariance floor scaling', () => {
  it('passes exact agreement on tiny entries', () => {
    const c1 = evaluateSentinelC1([1e-14, 2e-14], [1e-14, 2e-14]);
    expect(c1.pass).toBe(true);
  });

  it('rejects corruption far above the floor on tiny entries', () => {
    // diff 1e-9 on magnitude 1e-14: allowed is max(1e-12, 1e-6 * 1e-14).
    // The old unit-scale allowance (1e-6) would have passed this.
    const c1 = evaluateSentinelC1([1e-14 + 1e-9], [1e-14]);
    expect(c1.pass).toBe(false);
  });

  it('keeps unit-scale relative tolerance behavior', () => {
    expect(evaluateSentinelC1([1 + 5e-7], [1]).pass).toBe(true);
    expect(evaluateSentinelC1([1 + 5e-6], [1]).pass).toBe(false);
  });
});

const IDENTITY_PACKED_4 = (): SparseSelectedCovarianceInput => ({
  design: {
    rowOffsets: Int32Array.from([0, 1, 2, 3, 4]),
    columns: Int32Array.from([0, 1, 2, 3]),
    values: Float64Array.from([1, 1, 1, 1]),
  },
  weights: {
    rows: Int32Array.from([0, 1, 2, 3]),
    columns: Int32Array.from([0, 1, 2, 3]),
    values: Float64Array.from([1, 1, 1, 1]),
  },
  observationEquationCount: 4,
  parameterCount: 4,
  queryRows: Int32Array.from([0, 1, 2, 3]),
  queryColumns: Int32Array.from([0, 1, 2, 3]),
});

/** Exact dense selected-covariance delegate (N = I here, Q = I). */
const exactDelegate = (
  corruptFirst = false,
): { querySelected(_input: SparseSelectedCovarianceInput): SparseSelectedCovarianceResult } => ({
  querySelected: (input: SparseSelectedCovarianceInput): SparseSelectedCovarianceResult => {
    const n = input.parameterCount;
    const scaled = scaleNormalMatrix(
      Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))),
    );
    const factor = choleskyDecomposeWithDamping(scaled.scaled);
    expect(factor.damping).toBe(0);
    const columns = new Map<number, number[]>();
    for (const column of [...new Set(input.queryColumns)].sort((a, b) => a - b)) {
      const unit = Array.from({ length: n }, (_, row) => (row === column ? [1] : [0]));
      columns.set(
        column,
        unscaleNormalSolution(solveSPDFromCholesky(factor.factor, scaleNormalRhs(unit, scaled.scale)), scaled.scale).map(
          (row) => row[0] ?? Number.NaN,
        ),
      );
    }
    const covariance = Float64Array.from({ length: input.queryRows.length }, (_, k) => {
      const value = columns.get(input.queryColumns[k] ?? -1)?.[input.queryRows[k] ?? -1] ?? Number.NaN;
      if (corruptFirst && k === 0) return value * 4 + 1;
      return value;
    });
    return { covariance, normalNnz: n * n, factorNnz: n * n, damping: 0, dampingAttempts: 0 };
  },
});

describe('hotfix (C,D) immediate-verify covariance gate', () => {
  it('verifies immediately and retains compact verdicts only', () => {
    const state = createPreanalysisCandidateState();
    state.systemsStarted = 5;
    const gate = new PreanalysisGatedCovarianceCapture(
      exactDelegate(),
      state,
      { maxSystems: 64, maxParameters: 128 },
    );
    const first = gate.querySelected(IDENTITY_PACKED_4());
    expect(first.covariance[0]).toBeCloseTo(1, 12);
    // Verdict landed synchronously with the call (no post-run pass needed).
    expect(gate.verdicts.length).toBe(1);
    expect(gate.verdicts[0]?.reasons).toEqual([]);
    gate.querySelected(IDENTITY_PACKED_4());
    expect(gate.verdicts.length).toBe(2);
    expect(gate.verdicts.every((verdict) => verdict.reasons.length === 0)).toBe(true);
    // Only compact verdicts retained: no packed calls array, peak live
    // packed system count never exceeds one.
    expect('calls' in gate).toBe(false);
    expect(gate.maxRetainedPackedSystems).toBeLessThanOrEqual(1);
    expect(gate.truncated).toBe(false);
  });

  it('records corruption as verdict reasons without throwing', () => {
    const state = createPreanalysisCandidateState();
    state.systemsStarted = 5;
    const gate = new PreanalysisGatedCovarianceCapture(
      exactDelegate(true),
      state,
      { maxSystems: 64, maxParameters: 128 },
    );
    gate.querySelected(IDENTITY_PACKED_4());
    expect(gate.verdicts.length).toBe(1);
    expect(gate.verdicts[0]?.reasons.length).toBeGreaterThan(0);
    expect(gate.verdicts[0]?.reasons.join(' ')).toMatch(/C1/);
    expect(gate.maxRetainedPackedSystems).toBeLessThanOrEqual(1);
  });

  it('refuses unpaired covariance before delegating', () => {
    let delegated = 0;
    const state = createPreanalysisCandidateState();
    const gate = new PreanalysisGatedCovarianceCapture(
      {
        querySelected: (): SparseSelectedCovarianceResult => {
          delegated += 1;
          throw new Error('must not delegate unpaired covariance');
        },
      },
      state,
      { maxSystems: 64, maxParameters: 128 },
    );
    let thrown: unknown = null;
    try {
      gate.querySelected(IDENTITY_PACKED_4());
    } catch (error) {
      thrown = error;
    }
    expect(isPreanalysisSparseCapError(thrown)).toBe(true);
    expect(delegated).toBe(0);
    expect(gate.verdicts.length).toBe(0);
  });
});

describe('hotfix route-level corrupted bundle still falls back atomic', () => {
  it('falls back atomic on corrupted covariance through the immediate path', async () => {
    setPreanalysisSparseAutoRouteEnabled(true);
    clearPreanalysisSparseAutoRouteTestHooks();
    try {
      const request = makePreanalysisRequest(SMALL_INPUT);
      const attempt = await runWithPreanalysisSparseAutoRoute(request, undefined, {
        runSession: runAdjustmentSession,
        loadBundle: () =>
          Promise.resolve({
            sparseCorrectionSolver: exactCorrectionSolver(),
            sparseRowProductsSolver: {
              queryRowProducts: () => {
                throw new Error('fake row products unavailable (fail-closed)');
              },
            },
            sparseSelectedCovarianceSolver: exactDelegate(true),
          } as unknown as import('../src/workers/adjustmentSparseAutoRoute').SparseAutoRouteBundle),
      });
      expect(attempt.route).toBe('typescript');
      expect(attempt.reasons.length).toBeGreaterThan(0);
      const direct = runAdjustmentSession(request);
      expect(JSON.stringify(stripVolatile(attempt.outcome.result))).toBe(
        JSON.stringify(stripVolatile(direct.result)),
      );
    } finally {
      clearPreanalysisSparseAutoRouteTestHooks();
      setPreanalysisSparseAutoRouteEnabled(false);
    }
  });
});

const exactCorrectionSolver = (): {
  solveFromEquations(_input: {
    parameterCount: number;
    design: { rowOffsets: Int32Array; columns: Int32Array; values: Float64Array };
    weights: { rows: Int32Array; columns: Int32Array; values: Float64Array };
    misclosures: Float64Array;
    observationEquationCount: number;
  }): {
    correction: number[][];
    damping: number;
    dampingAttempts: number;
    designNnz: number;
    weightNnz: number;
    normalNnz: number;
    factorNnz: number;
    ordering: string;
    solver: string;
  };
} => ({
  solveFromEquations: (input) => {
    const n = input.parameterCount;
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
    const scaled = scaleNormalMatrix(normal);
    const factor = choleskyDecomposeWithDamping(scaled.scaled);
    const solved = solveSPDFromCholesky(factor.factor, scaleNormalRhs(rhs, scaled.scale));
    return {
      correction: unscaleNormalSolution(solved, scaled.scale),
      damping: 0,
      dampingAttempts: 0,
      designNnz: input.design.values.length,
      weightNnz: input.weights.values.length,
      normalNnz: n * n,
      factorNnz: n * n,
      ordering: 'hotfix-fake-dense',
      solver: 'hotfix-fake-dense',
    };
  },
});

const stripVolatile = (result: unknown): unknown => {
  const clone = JSON.parse(JSON.stringify(result)) as Record<string, unknown>;
  delete clone.solveTimingProfile;
  if (Array.isArray(clone.logs)) {
    clone.logs = (clone.logs as string[]).filter((line) => !line.startsWith('Solve timing (ms):'));
  }
  return clone;
};

describe('hotfix production source guards', () => {
  it('keeps evidence/test/script imports out of touched production files', () => {
    const files = [
      'src/workers/preanalysisSparseAutoRoute.ts',
      'src/workers/preanalysisSparseCovarianceGate.ts',
      'src/workers/preanalysisSparseAutoRouteCaps.ts',
      'src/engine/effectiveProjectParse.ts',
      'src/engine/preanalysisSparseCovarianceSentinel.ts',
      'src/engine/preanalysisSparseSessionPolicy.ts',
      'src/workers/adjustmentWorker.ts',
    ];
    const forbidden = ['phase8a6', 'tests/', 'scripts/'];
    const violations = files.flatMap((file) => {
      const text = fs.readFileSync(path.join(process.cwd(), file), 'utf-8');
      return forbidden
        .filter((token) => text.includes(token))
        .map((token) => `${file} contains ${token}`);
    });
    expect(violations).toEqual([]);
  });
});
