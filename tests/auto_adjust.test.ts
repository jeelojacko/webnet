import { describe, expect, it } from 'vitest';
import type { AdjustmentResult, Observation } from '../src/types';
import { pickAutoAdjustRemovals, runAutoAdjustCycles } from '../src/engine/autoAdjust';

const makeDistObs = (
  id: number,
  stdRes: number,
  opts?: { localPass?: boolean; redundancy?: number; sourceLine?: number },
): Observation => ({
  id,
  type: 'dist',
  subtype: 'ts',
  from: 'P1',
  to: 'P2',
  obs: 100,
  instCode: 'S9',
  stdDev: 0.005,
  calc: 100,
  residual: 0,
  stdRes,
  redundancy: opts?.redundancy ?? 0.3,
  localTest: { critical: 2, pass: opts?.localPass ?? true },
  sourceLine: opts?.sourceLine,
});

const makeResult = (observations: Observation[]): AdjustmentResult => ({
  success: true,
  converged: true,
  iterations: 2,
  stations: {},
  observations,
  logs: [],
  seuw: 1,
  dof: 10,
});

describe('autoAdjust utilities', () => {
  it('prioritizes local-test failures and respects redundancy guard', () => {
    const result = makeResult([
      makeDistObs(10, 2.1, { localPass: false, redundancy: 0.2, sourceLine: 10 }),
      makeDistObs(11, 5.2, { localPass: true, redundancy: 0.25, sourceLine: 11 }),
      makeDistObs(12, 4.5, { localPass: true, redundancy: 0.01, sourceLine: 12 }),
    ]);

    const removals = pickAutoAdjustRemovals(result, new Set(), {
      enabled: true,
      stdResThreshold: 3,
      maxCycles: 3,
      maxRemovalsPerCycle: 2,
      minRedundancy: 0.05,
    });

    expect(removals.map((r) => r.obsId)).toEqual([10, 11]);
    expect(removals[0].reason).toBe('local-test');
    expect(removals[1].reason).toBe('std-res');
  });

  it('runs multiple cycles until no candidates remain', () => {
    const solve = (exclude: Set<number>): AdjustmentResult => {
      if (!exclude.has(1)) {
        return makeResult([makeDistObs(1, 4.2, { redundancy: 0.3, sourceLine: 100 })]);
      }
      if (!exclude.has(2)) {
        return makeResult([makeDistObs(2, 3.9, { redundancy: 0.3, sourceLine: 200 })]);
      }
      return makeResult([makeDistObs(3, 1.2, { redundancy: 0.3, sourceLine: 300 })]);
    };

    const summary = runAutoAdjustCycles(
      new Set([99]),
      {
        enabled: true,
        stdResThreshold: 3,
        maxCycles: 5,
        maxRemovalsPerCycle: 1,
      },
      solve,
    );

    expect(summary.removedObsIds).toEqual([1, 2]);
    expect(summary.stopReason).toBe('no-candidates');
    expect(summary.finalExcludedIds.has(99)).toBe(true);
    expect(summary.finalExcludedIds.has(1)).toBe(true);
    expect(summary.finalExcludedIds.has(2)).toBe(true);
    expect(summary.cycles.length).toBe(3);
    expect(summary.cycles[0].removals).toHaveLength(1);
    expect(summary.cycles[2].removals).toHaveLength(0);
  });
});
