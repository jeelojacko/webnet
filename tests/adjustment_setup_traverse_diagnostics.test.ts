import { describe, expect, it } from 'vitest';

import {
  buildSetupDiagnostics,
  buildTraverseDiagnostics,
} from '../src/engine/adjustmentSetupTraverseDiagnostics';
import type { Observation } from '../src/types';

describe('adjustmentSetupTraverseDiagnostics', () => {
  it('builds setup summaries with counts, orientation averages, and worst observation traceability', () => {
    const activeObservations = [
      { type: 'direction', at: 'O', to: 'A', setId: 'S1', stdRes: -1.5, sourceLine: 10 },
      { type: 'dist', from: 'O', to: 'A', obs: 100, setId: 'TE', stdRes: 2.5, sourceLine: 11 },
      { type: 'lev', from: 'O', to: 'A', stdRes: 1.2, sourceLine: 12, localTest: { pass: false } },
      {
        type: 'gps',
        from: 'G',
        to: 'H',
        stdRes: 0.8,
        sourceLine: 13,
        localTestComponents: { passE: false, passN: true },
      },
    ] as Observation[];

    const diagnostics = buildSetupDiagnostics({
      activeObservations,
      directionSetDiagnostics: [
        {
          occupy: 'O',
          residualRmsArcSec: 3,
          orientationSeArcSec: 1.5,
        },
      ] as any,
    });

    expect(diagnostics).toBeDefined();
    expect(diagnostics).toHaveLength(2);
    expect(diagnostics?.[0]).toMatchObject({
      station: 'G',
      gpsObsCount: 1,
      localFailCount: 1,
    });
    expect(diagnostics?.[1]).toMatchObject({
      station: 'O',
      directionSetCount: 1,
      directionObsCount: 1,
      distanceObsCount: 1,
      levelingObsCount: 1,
      traverseDistance: 100,
      stdResCount: 3,
      maxStdRes: 2.5,
      localFailCount: 1,
      worstObsType: 'dist',
      worstObsStations: 'O-A',
      worstObsLine: 11,
    });
    expect(diagnostics?.[1].orientationRmsArcSec).toBeCloseTo(3, 8);
    expect(diagnostics?.[1].orientationSeArcSec).toBeCloseTo(1.5, 8);
    expect(diagnostics?.[1].rmsStdRes).toBeCloseTo(Math.sqrt((1.5 ** 2 + 2.5 ** 2 + 1.2 ** 2) / 3), 8);
  });

  it('builds traverse diagnostics with ranked loop severity and fallback no-geometry summaries', () => {
    const thresholds = {
      minClosureRatio: 1500,
      maxLinearPpm: 800,
      maxAngularArcSec: 10,
      maxVerticalMisclosure: 0.01,
    };

    const diagnostics = buildTraverseDiagnostics({
      closureVectors: [{ from: 'O', to: 'A', dE: 0.03, dN: 0.04 }],
      loopVectors: { 'O->A': { dE: 0.03, dN: 0.04 } },
      loopAngleArcSec: new Map([['O->A', 12]]),
      loopVerticalMisclosure: new Map([['O->A', 0.02]]),
      totalTraverseDistance: 100,
      thresholds,
      setupDiagnostics: [{ station: 'O', traverseDistance: 100 }] as any,
      hasClosureObs: true,
    });

    expect(diagnostics).toBeDefined();
    expect(diagnostics).toMatchObject({
      closureCount: 1,
      misclosureE: 0.03,
      misclosureN: 0.04,
      totalTraverseDistance: 100,
      closureRatio: 2000,
      linearPpm: 500,
      angularMisclosureArcSec: 12,
      verticalMisclosure: 0.02,
    });
    expect(diagnostics?.passes).toMatchObject({
      ratio: true,
      linearPpm: true,
      angular: false,
      vertical: false,
      overall: false,
    });
    const loops = diagnostics?.loops ?? [];
    expect(loops).toHaveLength(1);
    expect(loops[0]).toMatchObject({
      key: 'O->A',
      traverseDistance: 100,
      closureRatio: 2000,
      linearPpm: 500,
      angularMisclosureArcSec: 12,
      verticalMisclosure: 0.02,
      pass: false,
    });
    expect((loops[0]?.severity ?? 0) > 0).toBe(true);

    const noGeometry = buildTraverseDiagnostics({
      closureVectors: [],
      loopVectors: {},
      loopAngleArcSec: new Map([['O->A', 4]]),
      loopVerticalMisclosure: new Map(),
      totalTraverseDistance: 80,
      thresholds,
      setupDiagnostics: undefined,
      hasClosureObs: true,
    });

    expect(noGeometry).toMatchObject({
      closureCount: 0,
      misclosureMag: 0,
      totalTraverseDistance: 80,
      angularMisclosureArcSec: 4,
    });
    expect(noGeometry?.passes).toMatchObject({
      ratio: false,
      linearPpm: false,
      angular: true,
      vertical: true,
      overall: false,
    });
    expect(noGeometry?.loops).toEqual([]);
  });
});
