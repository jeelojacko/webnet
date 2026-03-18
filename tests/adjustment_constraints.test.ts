import { describe, expect, it } from 'vitest';

import {
  applyCoordinateConstraintCorrelationWeights,
  buildCoordinateConstraints,
  coordinateConstraintWeightedSum,
  summarizeCoordinateConstraints,
} from '../src/engine/adjustmentConstraints';
import type { StationMap } from '../src/types';

describe('adjustmentConstraints', () => {
  it('builds correlated XY constraints and applies covariance weights', () => {
    const stations: StationMap = {
      P1: {
        x: 100.0,
        y: 200.0,
        h: 0,
        fixed: false,
        fixedX: false,
        fixedY: false,
        fixedH: true,
        sx: 0.1,
        sy: 0.2,
        constraintX: 99.8,
        constraintY: 200.1,
        constraintCorrXY: 0.5,
      },
    };
    const constraints = buildCoordinateConstraints(stations, { P1: { x: 0, y: 1 } }, false);

    expect(constraints).toHaveLength(2);
    expect(summarizeCoordinateConstraints(constraints)).toMatchObject({
      count: 2,
      x: 1,
      y: 1,
      h: 0,
      xyCorrelated: 1,
    });

    const P = [
      [0, 0],
      [0, 0],
    ];
    applyCoordinateConstraintCorrelationWeights(P, [
      { row: 0, constraint: constraints[0] },
      { row: 1, constraint: constraints[1] },
    ]);

    expect(P[0][0]).toBeCloseTo(133.3333333333, 8);
    expect(P[1][1]).toBeCloseTo(33.3333333333, 8);
    expect(P[0][1]).toBeCloseTo(-33.3333333333, 8);
    expect(P[1][0]).toBeCloseTo(-33.3333333333, 8);
    expect(coordinateConstraintWeightedSum(stations, constraints)).toBeCloseTo(7, 8);
  });
});
