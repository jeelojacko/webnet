import { describe, expect, it, vi } from 'vitest';

import { assembleAdjustmentEquations } from '../src/engine/adjustmentEquationAssembly';
import type { DistanceObservation, StationMap } from '../src/types';

describe('adjustmentEquationAssembly', () => {
  it('assembles solve matrices for observation and weighted-control rows', () => {
    const stations: StationMap = {
      A: {
        x: 0,
        y: 0,
        h: 0,
        fixed: true,
        fixedX: true,
        fixedY: true,
        fixedH: true,
      },
      B: {
        x: 10,
        y: 0,
        h: 0,
        fixed: false,
        fixedX: false,
        fixedY: false,
        fixedH: true,
      },
    };
    const observation: DistanceObservation = {
      id: 1,
      type: 'dist',
      subtype: 'ts',
      from: 'A',
      to: 'B',
      obs: 12,
      mode: 'horiz',
      instCode: 'S9',
      stdDev: 0.5,
    };
    const applyTsCorrelationToWeightMatrix = vi.fn();

    const result = assembleAdjustmentEquations(
      {
        stations,
        paramIndex: { B: { x: 0, y: 1 } },
        is2D: false,
        debug: false,
        directionOrientations: {},
        dirParamMap: {},
        effectiveStdDev: () => 0.5,
        correctedDistanceModel: (_obs, calcDistRaw) => ({
          calcDistance: calcDistRaw,
          mapScale: 1,
          prismCorrection: 0,
        }),
        getObservedHorizontalDistanceIn2D: () => ({
          observedDistance: 12,
          sigmaDistance: 0.5,
          usedZenith: false,
        }),
        getAzimuth: () => ({ az: 0, dist: 10 }),
        measuredAngleCorrection: () => 0,
        modeledAzimuth: (rawAz) => rawAz,
        wrapToPi: (value) => value,
        gpsObservedVector: () => ({ dE: 0, dN: 0, scale: 1 }),
        gpsWeight: () => ({ wEE: 1, wNN: 1, wEN: 0 }),
        getModeledZenith: () => ({
          z: 0,
          dist: 1,
          horiz: 1,
          dh: 0,
          crCorr: 0,
          horizontalScale: 1,
        }),
        curvatureRefractionAngle: () => 0,
        applyTsCorrelationToWeightMatrix,
      },
      [observation],
      [
        {
          stationId: 'B',
          component: 'x',
          index: 0,
          target: 11,
          sigma: 0.25,
        },
      ],
      2,
      2,
    );

    expect(result.L[0][0]).toBe(2);
    expect(result.A[0][0]).toBe(1);
    expect(result.A[0][1]).toBe(0);
    expect(result.P[0][0]).toBe(4);

    expect(result.L[1][0]).toBe(1);
    expect(result.A[1][0]).toBe(1);
    expect(result.P[1][1]).toBe(16);
    expect(result.rowInfo).toEqual([{ obs: observation }, null]);
    expect(applyTsCorrelationToWeightMatrix).toHaveBeenCalledTimes(1);
  });
});
