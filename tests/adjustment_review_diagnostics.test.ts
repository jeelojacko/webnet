import { describe, expect, it } from 'vitest';

import {
  buildAutoSideshotDiagnostics,
  buildClusterDiagnostics,
} from '../src/engine/adjustmentReviewDiagnostics';
import type { Observation, StationMap } from '../src/types';

describe('adjustmentReviewDiagnostics', () => {
  it('builds auto-sideshot candidates and excludes fixed control targets', () => {
    const observations = [
      {
        id: 1,
        type: 'angle',
        at: 'O',
        from: 'BS',
        to: 'U1',
        sourceLine: 10,
        stdRes: 2.5,
      },
      {
        id: 2,
        type: 'dist',
        from: 'O',
        to: 'U1',
        subtype: 'ts',
        sourceLine: 10,
        stdRes: 1.2,
      },
      {
        id: 3,
        type: 'angle',
        at: 'O',
        from: 'BS',
        to: 'CTRL',
        sourceLine: 11,
        stdRes: 0.4,
      },
      {
        id: 4,
        type: 'dist',
        from: 'O',
        to: 'CTRL',
        subtype: 'ts',
        sourceLine: 11,
        stdRes: 0.3,
      },
    ] as Observation[];
    const stations = {
      U1: { id: 'U1', x: 0, y: 0, h: 0, fixed: false },
      CTRL: { id: 'CTRL', x: 10, y: 10, h: 0, fixed: true },
    } as StationMap;
    const redundancyById = new Map<number, number>([
      [1, 0.05],
      [2, 0.02],
      [3, 0.01],
      [4, 0.01],
    ]);

    const diagnostics = buildAutoSideshotDiagnostics({
      observations,
      stations,
      redundancyScalar: (obs) => redundancyById.get(obs.id),
      threshold: 0.1,
    });

    expect(diagnostics).toMatchObject({
      enabled: true,
      threshold: 0.1,
      evaluatedCount: 2,
      excludedControlCount: 1,
      candidateCount: 1,
    });
    expect(diagnostics.candidates[0]).toMatchObject({
      sourceLine: 10,
      occupy: 'O',
      backsight: 'BS',
      target: 'U1',
      angleObsId: 1,
      distObsId: 2,
      angleRedundancy: 0.05,
      distRedundancy: 0.02,
      minRedundancy: 0.02,
      maxAbsStdRes: 2.5,
    });
  });

  it('builds deterministic single-linkage cluster candidates', () => {
    const stations = {
      P1: { id: 'P1', x: 100, y: 100, h: 0, fixed: false },
      P2: { id: 'P2', x: 100.01, y: 100.005, h: 0, fixed: false },
      P3: { id: 'P3', x: 100.018, y: 100.012, h: 0, fixed: false },
      FAR: { id: 'FAR', x: 300, y: 300, h: 0, fixed: false },
    } as StationMap;

    const diagnostics = buildClusterDiagnostics({
      stations,
      unknowns: ['P1', 'P2', 'P3', 'FAR'],
      enabled: true,
      linkageMode: 'single',
      dimension: '2D',
      tolerance: 0.03,
      passMode: 'single-pass',
    });

    expect(diagnostics).toMatchObject({
      enabled: true,
      linkageMode: 'single',
      dimension: '2D',
      tolerance: 0.03,
      pairCount: 3,
      candidateCount: 1,
    });
    expect(diagnostics.candidates[0]).toMatchObject({
      key: 'CL-1-P1',
      representativeId: 'P1',
      stationIds: ['P1', 'P2', 'P3'],
      memberCount: 3,
      hasFixed: false,
      hasUnknown: true,
    });
    expect(diagnostics.candidates[0].pairs).toHaveLength(3);
    expect(diagnostics.candidates[0].maxSeparation).toBeGreaterThan(0);
  });

  it('returns an empty disabled cluster payload when detection is off', () => {
    const diagnostics = buildClusterDiagnostics({
      stations: {
        P1: { id: 'P1', x: 0, y: 0, h: 0, fixed: false },
        P2: { id: 'P2', x: 0.01, y: 0, h: 0, fixed: false },
      } as StationMap,
      unknowns: ['P1', 'P2'],
      enabled: false,
      linkageMode: 'complete',
      dimension: '3D',
      tolerance: 0.05,
      passMode: 'dual-pass',
    });

    expect(diagnostics).toEqual({
      enabled: false,
      passMode: 'dual-pass',
      linkageMode: 'complete',
      dimension: '3D',
      tolerance: 0.05,
      pairCount: 0,
      candidateCount: 0,
      candidates: [],
    });
  });
});
