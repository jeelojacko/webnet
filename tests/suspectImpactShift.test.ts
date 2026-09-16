import { describe, expect, it } from 'vitest';

import {
  buildSuspectImpactRows,
  collectSuspectImpactCandidates,
  computeShiftDetail,
  isFreeNetworkShiftUnavailable,
} from '../src/engine/suspectImpactShared';
import type { AdjustmentResult } from '../src/types';

const station = (x: number, y: number, h: number, fixed = false) => ({
  x,
  y,
  h,
  fixed,
  ...(fixed ? { fixedX: true, fixedY: true, fixedH: true } : {}),
});

const fakeResult = (overrides: {
  stations?: Record<string, { x: number; y: number; h: number; fixed?: boolean }>;
  stdRes?: number;
  seuw?: number;
  dof?: number;
  chiPass?: boolean | null;
}): AdjustmentResult =>
  ({
    success: true,
    converged: true,
    iterations: 3,
    stations: overrides.stations ?? {
      A: station(0, 0, 100, true),
      P: station(50, 40, 101),
    },
    observations: [
      {
        id: 1,
        type: 'dist',
        from: 'A',
        to: 'P',
        sigma: 0.01,
        stdRes: overrides.stdRes ?? 5.2,
      },
    ],
    logs: [],
    seuw: overrides.seuw ?? 2.5,
    dof: overrides.dof ?? 2,
    ...(overrides.chiPass == null
      ? {}
      : {
        chiSquare: {
          T: 20,
          dof: 2,
          p: 0.001,
          pass95: overrides.chiPass,
          alpha: 0.05,
          lower: 0,
          upper: 0,
          varianceFactor: 1,
          varianceFactorLower: 0,
          varianceFactorUpper: 0,
        },
      }),
  }) as unknown as AdjustmentResult;

describe('suspectImpactShift', () => {
  it('computes exact dE/dN/dH/horiz/vert/3D for the most-affected station', () => {
    const base = fakeResult({});
    const alt = fakeResult({
      stations: {
        A: station(0, 0, 100, true),
        P: station(50.003, 40.004, 101.012),
      },
    });
    const { most, top } = computeShiftDetail(base, alt);
    expect(most?.id).toBe('P');
    expect(most?.dE).toBeCloseTo(0.003, 9);
    expect(most?.dN).toBeCloseTo(0.004, 9);
    expect(most?.dH).toBeCloseTo(0.012, 9);
    expect(most?.horiz).toBeCloseTo(0.005, 9);
    expect(most?.vert).toBeCloseTo(0.012, 9);
    expect(most?.mag3d).toBeCloseTo(Math.hypot(0.005, 0.012), 9);
    expect(top).toHaveLength(1);
  });

  it('gives fixed stations exactly 0 by excluding them', () => {
    const base = fakeResult({});
    const alt = fakeResult({
      stations: {
        A: station(5, 5, 105, true),
        P: station(50, 40, 101),
      },
    });
    const { most, top } = computeShiftDetail(base, alt);
    expect(top.find((row) => row.id === 'A')).toBeUndefined();
    expect(most?.id).toBe('P');
    expect(most?.mag3d).toBe(0);
  });

  it('breaks most-affected ties deterministically by station id', () => {
    const base = fakeResult({
      stations: {
        A: station(0, 0, 100, true),
        P: station(50, 40, 101),
        Q: station(60, 50, 102),
      },
    });
    const alt = fakeResult({
      stations: {
        A: station(0, 0, 100, true),
        P: station(50.003, 40.004, 101),
        Q: station(60.004, 50.003, 102),
      },
    });
    const first = computeShiftDetail(base, alt);
    expect(first.most?.id).toBe('P');
    const swapped = computeShiftDetail(alt, base);
    expect(swapped.most?.id).toBe('P');
  });

  it('caps the top list at 5 stations ordered by mag3d desc then id asc', () => {
    const stations: Record<string, { x: number; y: number; h: number; fixed?: boolean }> = {
      A: station(0, 0, 100, true),
    };
    const altStations: Record<string, { x: number; y: number; h: number; fixed?: boolean }> = {
      A: station(0, 0, 100, true),
    };
    for (let i = 0; i < 7; i += 1) {
      const id = `S${i}`;
      stations[id] = station(i, i, 100 + i);
      altStations[id] = station(i + (i + 1) * 0.001, i, 100 + i);
    }
    const { top } = computeShiftDetail(fakeResult({ stations }), fakeResult({ stations: altStations }));
    expect(top).toHaveLength(5);
    expect(top.map((row) => row.id)).toEqual(['S6', 'S5', 'S4', 'S3', 'S2']);
  });

  it('marks shifts unavailable on a free-network datum but keeps statistics', () => {
    const base = fakeResult({
      stations: {
        P: station(50, 40, 101),
        Q: station(60, 50, 102),
      },
      chiPass: false,
    });
    expect(isFreeNetworkShiftUnavailable(base)).toBe(true);
    const rows = buildSuspectImpactRows({
      base,
      candidates: collectSuspectImpactCandidates(base),
      baseExclusions: new Set(),
      analysisMode: 'auto',
      robustReSolve: false,
      solveAlt: () =>
        fakeResult({
          stations: {
            P: station(50.01, 40.01, 101.01),
            Q: station(60.01, 50.01, 102.01),
          },
          stdRes: 0.2,
          seuw: 1.0,
          dof: 1,
          chiPass: true,
        }),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.shiftStatus).toBe('free-network-unavailable');
    expect(rows[0]?.mostAffectedStation).toBeNull();
    expect(rows[0]?.topAffectedStations).toEqual([]);
    expect(rows[0]?.status).toBe('ok');
    expect(rows[0]?.altSeuw).toBe(1);
    expect(rows[0]?.chiDelta).toBe('improved');
  });

  it('keeps shifts available on an anchored datum', () => {
    const base = fakeResult({ chiPass: true });
    expect(isFreeNetworkShiftUnavailable(base)).toBe(false);
  });
});
