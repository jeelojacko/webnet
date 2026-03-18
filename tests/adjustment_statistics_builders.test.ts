import { DEG_TO_RAD } from '../src/engine/angles';
import {
  buildObservationTypeSummary,
  buildResidualDiagnostics,
  buildStatisticalSummary,
} from '../src/engine/adjustmentStatisticsBuilders';
import { describe, expect, it } from 'vitest';
import type { Observation } from '../src/types';

describe('adjustmentStatisticsBuilders', () => {
  it('builds statistical summaries in group order with global dof scaling', () => {
    const summary = buildStatisticalSummary(
      new Map([
        ['Distances', { count: 2, sumSquares: 18 }],
        ['Angles', { count: 1, sumSquares: 4 }],
        ['Other', { count: 3, sumSquares: 3 }],
      ]),
      ['Angles', 'Directions', 'Distances'],
      3,
    );

    expect(summary?.byGroup.map((row) => row.label)).toEqual(['Angles', 'Distances', 'Other']);
    expect(summary?.byGroup[0].errorFactor).toBeCloseTo(2 * Math.sqrt(2), 10);
    expect(summary?.byGroup[1].errorFactor).toBeCloseTo(3 * Math.sqrt(2), 10);
    expect(summary?.totalCount).toBe(6);
    expect(summary?.totalSumSquares).toBe(25);
    expect(summary?.totalErrorFactorByCount).toBeCloseTo(Math.sqrt(25 / 6), 10);
    expect(summary?.totalErrorFactorByDof).toBeCloseTo(Math.sqrt(25 / 3), 10);
  });

  it('builds residual diagnostics with worst-observation and redundancy ranking', () => {
    const observations: Observation[] = [
      {
        id: 2,
        type: 'dist',
        subtype: 'ts',
        from: 'A',
        to: 'B',
        obs: 10,
        instCode: 'S9',
        stdDev: 1,
        residual: 0.1,
        stdRes: 2.5,
        redundancy: 0.15,
        localTest: { critical: 3, pass: true },
      },
      {
        id: 3,
        type: 'gps',
        from: 'A',
        to: 'C',
        obs: { dE: 0, dN: 0 },
        instCode: 'GPS',
        stdDev: 1,
        residual: { vE: 0.2, vN: 0.3 },
        stdRes: 4.1,
        redundancy: { rE: 0.05, rN: 0.25 },
        localTest: { critical: 3, pass: false },
        sourceLine: 42,
      },
      {
        id: 1,
        type: 'angle',
        at: 'C',
        from: 'A',
        to: 'B',
        obs: 0,
        instCode: 'S9',
        stdDev: 1,
        residual: 0.0001,
        stdRes: 4.1,
        redundancy: 0.3,
        localTest: { critical: 3, pass: false },
      },
    ] as Observation[];

    const diagnostics = buildResidualDiagnostics(observations, 3);

    expect(diagnostics?.observationCount).toBe(3);
    expect(diagnostics?.over2SigmaCount).toBe(3);
    expect(diagnostics?.over3SigmaCount).toBe(2);
    expect(diagnostics?.localFailCount).toBe(2);
    expect(diagnostics?.lowRedundancyCount).toBe(2);
    expect(diagnostics?.veryLowRedundancyCount).toBe(1);
    expect(diagnostics?.worst).toEqual({
      obsId: 3,
      type: 'gps',
      stations: 'A-C',
      sourceLine: 42,
      stdRes: 4.1,
      redundancy: 0.05,
      localPass: false,
    });
    expect(diagnostics?.byType.find((row) => row.type === 'gps')).toMatchObject({
      type: 'gps',
      localFailCount: 1,
      over3SigmaCount: 1,
      minRedundancy: 0.05,
    });
  });

  it('builds per-type residual summaries with angle and gps unit handling', () => {
    const observations: Observation[] = [
      {
        id: 1,
        type: 'angle',
        at: 'S1',
        from: 'S2',
        to: 'S3',
        obs: 0,
        instCode: 'S9',
        stdDev: 1,
        residual: DEG_TO_RAD / 3600,
        stdRes: 2,
      },
      {
        id: 2,
        type: 'dist',
        subtype: 'ts',
        from: 'S1',
        to: 'S2',
        obs: 100,
        instCode: 'S9',
        stdDev: 1,
        residual: 0.01,
        stdRes: 4.2,
      },
      {
        id: 3,
        type: 'gps',
        from: 'S1',
        to: 'S3',
        obs: { dE: 0, dN: 0 },
        instCode: 'GPS',
        stdDev: 1,
        residual: { vE: 3, vN: 4 },
        stdRes: 1.5,
      },
    ] as Observation[];

    const summary = buildObservationTypeSummary(observations);

    expect(summary?.angle).toMatchObject({
      count: 1,
      maxAbs: 1,
      rms: 1,
      unit: 'arcsec',
    });
    expect(summary?.dist).toMatchObject({
      count: 1,
      maxAbs: 0.01,
      over3: 1,
      unit: 'm',
    });
    expect(summary?.gps).toMatchObject({
      count: 1,
      maxAbs: 5,
      rms: 5,
      unit: 'm',
    });
  });
});
