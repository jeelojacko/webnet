import { describe, expect, it } from 'vitest';
import type { Observation } from '../src/types';
import {
  getIndustryObservationResidualSortMagnitude,
  getIndustryObservationStdErrorSortMagnitude,
  sortIndustryListingObservations,
} from '../src/engine/industryListing';

const makeDistObs = (seed: {
  id: number;
  from: string;
  to: string;
  sourceLine: number;
  residual?: number;
  stdDev: number;
  weightingStdDev?: number;
  stdRes?: number;
}): Observation =>
  ({
    id: seed.id,
    type: 'dist',
    instCode: 'S9',
    from: seed.from,
    to: seed.to,
    obs: 100,
    sourceLine: seed.sourceLine,
    residual: seed.residual,
    stdDev: seed.stdDev,
    weightingStdDev: seed.weightingStdDev,
    stdRes: seed.stdRes,
  }) as unknown as Observation;

const makeAngleObs = (seed: {
  id: number;
  at: string;
  from: string;
  to: string;
  sourceLine: number;
  residual?: number;
  stdDev: number;
  weightingStdDev?: number;
  stdRes?: number;
}): Observation =>
  ({
    id: seed.id,
    type: 'angle',
    instCode: 'S9',
    at: seed.at,
    from: seed.from,
    to: seed.to,
    obs: 0,
    sourceLine: seed.sourceLine,
    residual: seed.residual,
    stdDev: seed.stdDev,
    weightingStdDev: seed.weightingStdDev,
    stdRes: seed.stdRes,
  }) as unknown as Observation;

const makeGpsObs = (seed: {
  id: number;
  from: string;
  to: string;
  sourceLine: number;
  residual?: { vE?: number; vN?: number; vU?: number };
  stdDev?: number;
  stdDevE?: number;
  stdDevN?: number;
  stdDevU?: number;
  weightingStdDev?: number;
  weightingStdDevE?: number;
  weightingStdDevN?: number;
  stdRes?: number;
}): Observation =>
  ({
    id: seed.id,
    type: 'gps',
    instCode: 'S9',
    from: seed.from,
    to: seed.to,
    obs: { dE: 0, dN: 0, dU: 0 },
    sourceLine: seed.sourceLine,
    residual: seed.residual,
    stdDev: seed.stdDev ?? 1,
    stdDevE: seed.stdDevE,
    stdDevN: seed.stdDevN,
    stdDevU: seed.stdDevU,
    weightingStdDev: seed.weightingStdDev,
    weightingStdDevE: seed.weightingStdDevE,
    weightingStdDevN: seed.weightingStdDevN,
    stdRes: seed.stdRes,
  }) as unknown as Observation;

describe('industry listing sort modes', () => {
  it('sorts residual descending by displayed value using family-aware scalarization', () => {
    const tenArcSecInRad = ((10 / 3600) * Math.PI) / 180;
    const observations: Observation[] = [
      makeDistObs({
        id: 1,
        from: 'A',
        to: 'P',
        sourceLine: 10,
        residual: -0.002,
        stdDev: 0.001,
        stdRes: 0.5,
      }),
      makeGpsObs({
        id: 2,
        from: 'B',
        to: 'P',
        sourceLine: 11,
        residual: { vE: 0.003, vN: 0.004 },
        stdRes: 0.5,
      }),
      makeAngleObs({
        id: 3,
        at: 'P',
        from: 'A',
        to: 'B',
        sourceLine: 12,
        residual: tenArcSecInRad,
        stdDev: tenArcSecInRad,
        stdRes: 0.5,
      }),
    ];

    expect(getIndustryObservationResidualSortMagnitude(observations[2])).toBeCloseTo(-10, 6);
    expect(getIndustryObservationResidualSortMagnitude(observations[0])).toBeCloseTo(0.002, 8);
    const sorted = sortIndustryListingObservations(observations, 'residual');
    expect(sorted.map((row) => row.id)).toEqual([2, 1, 3]);
  });

  it('sorts by weighted standard error with deterministic station tie-breaks', () => {
    const observations: Observation[] = [
      makeDistObs({
        id: 11,
        from: 'B',
        to: 'P',
        sourceLine: 22,
        stdDev: 0.005,
        weightingStdDev: 0.01,
        stdRes: 0.5,
      }),
      makeDistObs({
        id: 12,
        from: 'A',
        to: 'P',
        sourceLine: 20,
        stdDev: 0.02,
        weightingStdDev: 0.01,
        stdRes: 0.5,
      }),
      makeDistObs({
        id: 13,
        from: 'C',
        to: 'P',
        sourceLine: 24,
        stdDev: 0.015,
        stdRes: 0.5,
      }),
    ];

    expect(getIndustryObservationStdErrorSortMagnitude(observations[0])).toBeCloseTo(0.01);
    expect(getIndustryObservationStdErrorSortMagnitude(observations[2])).toBeCloseTo(0.015);
    const sorted = sortIndustryListingObservations(observations, 'stdError');
    expect(sorted.map((row) => row.id)).toEqual([13, 12, 11]);
  });

  it('sorts standardized residual by absolute value with deterministic ties', () => {
    const observations: Observation[] = [
      makeDistObs({
        id: 31,
        from: 'B',
        to: 'P',
        sourceLine: 101,
        stdDev: 0.01,
        stdRes: 2,
      }),
      makeDistObs({
        id: 32,
        from: 'A',
        to: 'P',
        sourceLine: 100,
        stdDev: 0.01,
        stdRes: 2,
      }),
      makeDistObs({
        id: 33,
        from: 'C',
        to: 'P',
        sourceLine: 99,
        stdDev: 0.01,
        stdRes: 1.5,
      }),
    ];

    const sorted = sortIndustryListingObservations(observations, 'stdResidual');
    expect(sorted.map((row) => row.id)).toEqual([32, 31, 33]);
  });
});
