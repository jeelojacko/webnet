import { describe, expect, it, vi } from 'vitest';

import {
  applyAdjustmentCorrections,
  solveAdjustmentIteration,
} from '../src/engine/adjustmentIteration';
import type { StationMap } from '../src/types';

describe('adjustmentIteration', () => {
  it('solves a classical iteration step and reports objective metrics', () => {
    const recordConditionEstimate = vi.fn();
    const result = solveAdjustmentIteration(
      {
        robustMode: 'none',
        solveNormalEquations: () => ({
          correction: [[2]],
          qxx: [[0.25]],
        }),
        estimateCondition: () => 5,
        recordConditionEstimate,
        captureRobustWeightBase: () => ({ diagonal: [], correlatedPairs: [] }),
        applyRobustWeightFactors: () => undefined,
        computeRobustWeightSummary: () => ({
          factors: [],
          downweightedRows: 0,
          minWeight: 1,
          maxNorm: 0,
          meanWeight: 1,
          topRows: [],
        }),
        maxRobustWeightDelta: () => 0,
        recordRobustDiagnostics: () => undefined,
        weightedQuadratic: (P, v) => P[0][0] * v[0][0] * v[0][0],
      },
      [[1]],
      [[2]],
      [[4]],
      [null],
      1,
    );

    expect(recordConditionEstimate).toHaveBeenCalledWith(5);
    expect(result.correction).toEqual([[2]]);
    expect(result.qxx).toEqual([[0.25]]);
    expect(result.sumBefore).toBe(16);
    expect(result.sumAfter).toBe(0);
    expect(result.maxBefore).toBe(2);
    expect(result.maxAfter).toBe(0);
  });

  it('applies station and direction corrections with wrapped orientations', () => {
    const stations: StationMap = {
      P1: {
        x: 10,
        y: 20,
        h: 30,
        fixed: false,
        fixedX: false,
        fixedY: false,
        fixedH: false,
      },
    };
    const directionOrientations = { SET1: 2 * Math.PI - 0.1 };

    const maxCorrection = applyAdjustmentCorrections(
      stations,
      { P1: { x: 0, y: 1, h: 2 } },
      false,
      directionOrientations,
      { SET1: 3 },
      [[1.5], [-2], [0.25], [0.2]],
    );

    expect(stations.P1.x).toBe(11.5);
    expect(stations.P1.y).toBe(18);
    expect(stations.P1.h).toBe(30.25);
    expect(directionOrientations.SET1).toBeCloseTo(0.1, 10);
    expect(maxCorrection).toBe(2);
  });

  it('skips repeated condition estimation after the first outer iteration', () => {
    const recordConditionEstimate = vi.fn();

    solveAdjustmentIteration(
      {
        robustMode: 'none',
        solveNormalEquations: () => ({
          correction: [[0]],
          qxx: [[1]],
        }),
        estimateCondition: () => 9,
        recordConditionEstimate,
        captureRobustWeightBase: () => ({ diagonal: [], correlatedPairs: [] }),
        applyRobustWeightFactors: () => undefined,
        computeRobustWeightSummary: () => ({
          factors: [],
          downweightedRows: 0,
          minWeight: 1,
          maxNorm: 0,
          meanWeight: 1,
          topRows: [],
        }),
        maxRobustWeightDelta: () => 0,
        recordRobustDiagnostics: () => undefined,
        weightedQuadratic: () => 0,
      },
      [[1]],
      [[0]],
      [[1]],
      [null],
      2,
    );

    expect(recordConditionEstimate).not.toHaveBeenCalled();
  });
});
