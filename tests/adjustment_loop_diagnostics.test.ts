import { describe, expect, it } from 'vitest';

import {
  buildGpsLoopDiagnostics,
  buildLevelingLoopDiagnostics,
} from '../src/engine/adjustmentLoopDiagnostics';
import type { GpsObservation, LevelObservation } from '../src/types';

describe('adjustmentLoopDiagnostics', () => {
  it('builds GPS loop rankings with closure tolerance checks', () => {
    const gpsObservations = [
      { id: 1, type: 'gps', from: 'A', to: 'B', sourceLine: 10 },
      { id: 2, type: 'gps', from: 'A', to: 'C', sourceLine: 11 },
      { id: 3, type: 'gps', from: 'B', to: 'C', sourceLine: 12 },
    ] as GpsObservation[];
    const vectorById = new Map<number, { dE: number; dN: number }>([
      [1, { dE: 10, dN: 0 }],
      [2, { dE: 10, dN: 10 }],
      [3, { dE: 0, dN: 10.05 }],
    ]);

    const diagnostics = buildGpsLoopDiagnostics({
      gpsObservations,
      observedVector: (obs) => vectorById.get(obs.id)!,
      baseToleranceM: 0.02,
      ppmTolerance: 50,
      eps: 1e-10,
    });

    expect(diagnostics).toMatchObject({
      enabled: true,
      vectorCount: 3,
      loopCount: 1,
      passCount: 0,
      warnCount: 1,
      thresholds: {
        baseToleranceM: 0.02,
        ppmTolerance: 50,
      },
    });
    expect(diagnostics.loops[0]).toMatchObject({
      rank: 1,
      key: 'GL-1-B',
      pass: false,
      sourceLines: [10, 11, 12],
    });
    expect(diagnostics.loops[0].stationPath.join('->')).toBe('B->A->C->B');
    expect(diagnostics.loops[0].closureMag).toBeCloseTo(0.05, 8);
    expect(diagnostics.loops[0].toleranceM).toBeLessThan(diagnostics.loops[0].closureMag);
    expect(diagnostics.loops[0].linearPpm).toBeGreaterThan(diagnostics.thresholds.ppmTolerance);
  });

  it('builds differential leveling loop and suspect-segment rankings', () => {
    const levelingObservations = [
      { id: 1, type: 'lev', from: 'A', to: 'B', obs: 0.005, lenKm: 1.0, sourceLine: 20 },
      { id: 2, type: 'lev', from: 'A', to: 'C', obs: 0.02, lenKm: 1.0, sourceLine: 21 },
      { id: 3, type: 'lev', from: 'B', to: 'C', obs: 0.005, lenKm: 1.0, sourceLine: 22 },
    ] as LevelObservation[];

    const diagnostics = buildLevelingLoopDiagnostics({
      levelingObservations,
      baseMm: 0,
      perSqrtKmMm: 4,
      eps: 1e-10,
    });

    expect(diagnostics).toMatchObject({
      enabled: true,
      observationCount: 3,
      loopCount: 1,
      passCount: 0,
      warnCount: 1,
      worstLoopKey: 'LL-1-B',
      thresholds: {
        baseMm: 0,
        perSqrtKmMm: 4,
      },
    });
    expect(diagnostics.loops[0]).toMatchObject({
      rank: 1,
      key: 'LL-1-B',
      pass: false,
      sourceLines: [20, 21, 22],
    });
    expect(diagnostics.loops[0].stationPath.join('->')).toBe('B->A->C->B');
    expect(diagnostics.loops[0].absClosure).toBeCloseTo(0.01, 8);
    expect(diagnostics.loops[0].toleranceMm).toBeCloseTo(6.9282032303, 6);
    expect(diagnostics.suspectSegments[0]).toMatchObject({
      rank: 1,
      sourceLine: 21,
      worstLoopKey: 'LL-1-B',
    });
    expect(diagnostics.suspectSegments).toHaveLength(3);
    expect(diagnostics.suspectSegments[0].suspectScore).toBeGreaterThan(0);
  });
});
