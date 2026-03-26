import { describe, expect, it } from 'vitest';

import { buildSolvePreparation } from '../src/engine/adjustmentPreprocessing';
import type { DistanceObservation, DirectionObservation, StationMap } from '../src/types';

describe('adjustmentPreprocessing', () => {
  it('builds parameter metadata, weighted constraints, and auto-held heights', () => {
    const stations: StationMap = {
      CTRL: {
        x: 0,
        y: 0,
        h: 0,
        fixed: true,
        fixedX: true,
        fixedY: true,
        fixedH: true,
      },
      P1: {
        x: 10,
        y: 5,
        h: 2,
        fixed: false,
        fixedX: false,
        fixedY: false,
        fixedH: false,
        sx: 0.02,
        sy: 0.03,
        constraintX: 10.1,
        constraintY: 4.9,
      },
      P2: {
        x: 25,
        y: -3,
        h: 4,
        fixed: false,
        fixedX: false,
        fixedY: false,
        fixedH: false,
      },
    };
    const activeObservations: Array<DistanceObservation | DirectionObservation> = [
      {
        id: 1,
        type: 'dist',
        subtype: 'ts',
        from: 'CTRL',
        to: 'P1',
        obs: 11.3,
        mode: 'slope',
        instCode: 'S9',
        stdDev: 0.01,
      },
      {
        id: 2,
        type: 'direction',
        at: 'P1',
        to: 'CTRL',
        setId: 'SET-1',
        obs: 0.5,
        instCode: 'S9',
        stdDev: 0.0001,
      },
    ];

    const result = buildSolvePreparation(stations, ['P1', 'P2'], activeObservations, false);

    expect(result.directionSetIds).toEqual(['SET-1']);
    expect(result.autoDroppedHeights).toEqual(['P2']);
    expect(stations.P2.fixedX).toBe(true);
    expect(stations.P2.fixedY).toBe(true);
    expect(stations.P2.fixedH).toBe(true);
    expect(result.stationParamCount).toBe(3);
    expect(result.paramIndex).toEqual({
      P1: { x: 0, y: 1, h: 2 },
    });
    expect(result.constraints).toHaveLength(2);
    expect(result.controlConstraints).toMatchObject({
      count: 2,
      x: 1,
      y: 1,
      h: 0,
      xyCorrelated: 0,
    });
    expect(result.numParams).toBe(4);
    expect(result.numObsEquations).toBe(4);
    expect(result.dirParamMap).toEqual({ 'SET-1': 3 });
  });
});
