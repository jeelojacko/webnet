import { describe, expect, it } from 'vitest';

import { solveEngine } from '../src/engine/solveEngine';
import {
  buildSuspectImpactRows,
  collectSuspectImpactCandidates,
  compareSuspectImpactRows,
  countLocalFailures,
  hasLocalFailure,
} from '../src/engine/suspectImpactShared';
import type { SuspectImpactRow } from '../src/typesAdjustmentResult';
import type {
  AdjustmentResult,
  Observation,
  ParseOptions,
} from '../src/types';

const MAX_ITERATIONS = 30;

/** Big distance blunder (FAIL) + small GPS blunder (keeps the exclusion imperfect). */
const FAIL_TO_PASS_INPUT = [
  '.2D', 'C A 0 0 0 ! !', 'C B 100 0 0 ! !', 'C P 50 40 0',
  'G GPS1 A P 50.0 40.0 0.01 0.01',
  'G GPS1 B P -50.0 40.0 0.01 0.01',
  'D A-P 64.0312423743285 0.01',
  'D A-P 74.031 0.01',
  'G GPS2 A P 50.02 40.0 0.01 0.01',
].join('\n');

/** Two mild blunders: base stays PASS, either exclusion stays PASS with a new p. */
const PASS_TO_PASS_INPUT = [
  '.2D', 'C A 0 0 0 ! !', 'C B 100 0 0 ! !', 'C P 50 40 0',
  'G GPS1 A P 50.0 40.0 0.01 0.01',
  'G GPS1 B P -50.0 40.0 0.01 0.01',
  'G GPS2 A P 50.0 40.0 0.01 0.01',
  'G GPS2 B P -50.0 40.0 0.01 0.01',
  'D A-P 64.0312423743285 0.01',
  'D B-P 64.0312423743285 0.01',
  'D A-P 64.0312423743285 0.01',
  'D B-P 64.0312423743285 0.01',
  'D A-P 64.0712423743285 0.01',
  'D B-P 64.0592423743285 0.01',
].join('\n');

const run2D = (input: string, extraParse: Partial<ParseOptions> = {}) =>
  solveEngine({
    input,
    maxIterations: MAX_ITERATIONS,
    parseOptions: { coordMode: '2D', units: 'm', ...extraParse },
  });

const buildRows = (input: string, extraParse: Partial<ParseOptions> = {}) => {
  const base = run2D(input, extraParse);
  const candidates = collectSuspectImpactCandidates(base);
  expect(candidates.length).toBeGreaterThan(0);
  const rows = buildSuspectImpactRows({
    base,
    candidates,
    baseExclusions: new Set(),
    analysisMode: 'auto',
    robustReSolve: false,
    solveAlt: (exclusions) =>
      solveEngine({
        input,
        maxIterations: MAX_ITERATIONS,
        excludeIds: exclusions,
        parseOptions: { coordMode: '2D', units: 'm', ...extraParse },
      }),
  });
  return { base, candidates, rows };
};

const failedBase = (): AdjustmentResult =>
  ({
    success: true,
    converged: true,
    iterations: 3,
    stations: {
      A: { x: 0, y: 0, h: 100, fixed: true, fixedX: true, fixedY: true },
      P: { x: 50, y: 40, h: 101, fixed: false },
    },
    observations: [
      { id: 11, type: 'dist', from: 'A', to: 'P', sigma: 0.01, stdRes: 4.1 },
      { id: 12, type: 'dist', from: 'A', to: 'P', sigma: 0.01, stdRes: 3.2 },
    ],
    logs: [],
    seuw: 3.5,
    dof: 2,
    chiSquare: {
      T: 24, dof: 2, p: 0.00001, pass95: false, alpha: 0.05,
      lower: 0, upper: 0, varianceFactor: 1, varianceFactorLower: 0, varianceFactorUpper: 0,
    },
  }) as unknown as AdjustmentResult;

describe('suspectImpactQc', () => {
  it('marks a FAIL->PASS exclusion improved with before/after chi absolutes', () => {
    const { base, rows } = buildRows(FAIL_TO_PASS_INPUT);
    expect(base.chiSquare?.pass95).toBe(false);
    const improved = rows.find((row) => row.chiDelta === 'improved');
    expect(improved).toBeDefined();
    expect(improved?.status).toBe('ok');
    expect(improved?.failureReason).toBe('none');
    expect(improved?.baseChi?.pass).toBe(false);
    expect(improved?.altChi?.pass).toBe(true);
    expect(improved?.baseChi?.T).toBe(base.chiSquare?.T);
    expect(improved?.altChi?.dof).toBe(base.dof - 1);
  });

  it('marks a PASS->PASS exclusion unchanged while the p-value moves', () => {
    const { base, rows } = buildRows(PASS_TO_PASS_INPUT);
    expect(base.chiSquare?.pass95).toBe(true);
    const unchanged = rows.filter((row) => row.status === 'ok' && row.chiDelta === 'unchanged');
    expect(unchanged.length).toBeGreaterThan(0);
    expect(
      unchanged.some(
        (row) => row.altChi != null && row.baseChi != null && row.altChi.p !== row.baseChi.p,
      ),
    ).toBe(true);
  });

  it('tracks local-fail count decrease and never counts unavailable tests', () => {
    const policy = { localTestPolicy: { mode: 'baarda-w', alpha: 0.05, correction: 'none' } as const };
    const { rows } = buildRows(FAIL_TO_PASS_INPUT, policy);
    const decreased = rows.find(
      (row) =>
        row.status === 'ok' &&
        (row.baseLocalFails ?? 0) > 0 &&
        (row.altLocalFails ?? Number.MAX_SAFE_INTEGER) < (row.baseLocalFails ?? 0),
    );
    expect(decreased).toBeDefined();
    const unavailable = {
      id: 99, type: 'dist', from: 'A', to: 'B', sigma: 0.01, stdRes: 0.4,
      localTest: { critical: 3.29, pass: null },
    } as unknown as Observation;
    const missing = { id: 100, type: 'dist', from: 'A', to: 'B', sigma: 0.01, stdRes: 3.9 } as unknown as Observation;
    expect(hasLocalFailure(unavailable)).toBe(false);
    expect(hasLocalFailure(missing)).toBe(false);
    expect(countLocalFailures({ observations: [unavailable, missing] } as AdjustmentResult)).toBe(0);
  });

  it('marks a singular alternate failed with reason instead of scoring it', () => {
    const base = failedBase();
    const candidates = collectSuspectImpactCandidates(base);
    expect(candidates.map((obs) => obs.id)).toEqual([11, 12]);
    const realAlt = run2D(FAIL_TO_PASS_INPUT);
    const rows = buildSuspectImpactRows({
      base,
      candidates,
      baseExclusions: new Set(),
      analysisMode: 'auto',
      robustReSolve: false,
      solveAlt: (exclusions) => {
        if (exclusions.has(11)) {
          return {
            ...realAlt,
            success: false,
            converged: false,
            seuw: 0,
            dof: 0,
            chiSquare: undefined,
            logs: [...realAlt.logs, 'Normal equation solve failed (singular or otherwise unstable).'],
          };
        }
        return {
          ...realAlt,
          success: false,
          converged: false,
          seuw: 0,
          dof: 0,
          chiSquare: undefined,
          logs: [...realAlt.logs, 'Error: Redundancy < 0. Under-determined.'],
        };
      },
    });
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.status === 'failed')).toBe(true);
    expect(rows.find((row) => row.obsId === 11)?.failureReason).toBe('singular');
    expect(rows.find((row) => row.obsId === 12)?.failureReason).toBe('insufficient-observations');
    expect(rows.every((row) => row.chiDelta === '-')).toBe(true);
  });

  it('never ranks an aborted-but-returned alt solve above an ok row', () => {
    const base = failedBase();
    const candidates = collectSuspectImpactCandidates(base);
    const okAlt = {
      ...run2D(FAIL_TO_PASS_INPUT),
      success: true,
      converged: true,
      seuw: 1.2,
      dof: 1,
    };
    const abortedAlt = {
      ...run2D(FAIL_TO_PASS_INPUT),
      success: false,
      converged: false,
      seuw: 0,
      dof: 0,
      chiSquare: undefined,
      logs: ['Normal equation solve failed (singular or otherwise unstable).'],
    };
    const rows = buildSuspectImpactRows({
      base,
      candidates,
      baseExclusions: new Set(),
      analysisMode: 'auto',
      robustReSolve: false,
      solveAlt: (exclusions) => (exclusions.has(11) ? abortedAlt : okAlt),
    });
    // Under the old score (-deltaSeuw rewards a zero-SEUW abort) the aborted
    // row for obs 11 would have ranked first; it must now sort last.
    expect(rows[0]?.obsId).toBe(12);
    expect(rows[0]?.status).toBe('ok');
    expect(rows[1]?.obsId).toBe(11);
    expect(rows[1]?.status).toBe('failed');
    expect(rows[1]?.failureReason).toBe('singular');
  });

  it('carries SEUW absolutes with no better-label field and never ranks on SEUW alone', () => {
    const { rows } = buildRows(FAIL_TO_PASS_INPUT);
    const row = rows.find((entry) => entry.status === 'ok');
    expect(row).toBeDefined();
    expect(row?.baseSeuw).toBeDefined();
    expect(row?.altSeuw).toBeDefined();
    for (const key of ['verdict', 'assessment', 'better', 'improvement', 'improvedLabel']) {
      expect(row != null && key in row).toBe(false);
    }
    const bigSeuwDrop: SuspectImpactRow = {
      obsId: 1, type: 'dist', stations: 'A-P', baseLocalFail: false,
      baseStdRes: 2.0, chiDelta: 'unchanged', baseLocalFails: 0, altLocalFails: 0,
      mostAffectedStation: null, status: 'ok',
    };
    const smallSeuwDrop: SuspectImpactRow = {
      ...bigSeuwDrop, obsId: 2, baseStdRes: 3.0,
    };
    // Same chi/local/shift standing: the larger base |StdRes| wins no matter
    // how much SEUW the other row drops (deltaSeuw plays no part).
    expect(compareSuspectImpactRows(smallSeuwDrop, bigSeuwDrop)).toBeLessThan(0);
  });
});
