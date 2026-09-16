import { describe, expect, it } from 'vitest';
import { buildSystematicDiagnostics } from '../src/engine/systematicPatternDiagnostics';
import type { Observation } from '../src/types';

let nextId = 1;

const distObs = (from: string, to: string, lenM: number, residual: number): Observation =>
  ({
    id: nextId++,
    type: 'dist',
    subtype: 'ts',
    instCode: 'T1',
    from,
    to,
    obs: lenM,
    stdDev: 0.005,
    residual,
    stdRes: residual / 0.005,
  }) as unknown as Observation;

const dirObs = (at: string, to: string, setId: string, residual: number): Observation =>
  ({
    id: nextId++,
    type: 'direction',
    instCode: 'T1',
    setId,
    at,
    to,
    obs: 0.5,
    stdDev: 0.00002,
    residual,
    stdRes: residual / 0.00002,
  }) as unknown as Observation;

const levObs = (
  from: string,
  to: string,
  residual: number,
  lenKm: number,
  sourceLine?: number,
): Observation =>
  ({
    id: nextId++,
    type: 'lev',
    instCode: 'L1',
    from,
    to,
    obs: 1.0,
    lenKm,
    stdDev: 0.002,
    residual,
    stdRes: residual / 0.002,
    ...(sourceLine != null ? { sourceLine } : {}),
  }) as unknown as Observation;

const gpsObs = (from: string, to: string, vE: number, vN: number, vU?: number): Observation =>
  ({
    id: nextId++,
    type: 'gps',
    instCode: 'G1',
    from,
    to,
    obs: { dE: 10, dN: 10, ...(vU != null ? { dU: 1 } : {}) },
    stdDev: 0.01,
    residual: { vE, vN, ...(vU != null ? { vU } : {}) },
    stdRes: 1.0,
  }) as unknown as Observation;

const zenObs = (from: string, to: string, residual: number, effDist?: number): Observation =>
  ({
    id: nextId++,
    type: 'zenith',
    instCode: 'T1',
    from,
    to,
    obs: 1.57,
    stdDev: 0.00002,
    residual,
    stdRes: residual / 0.00002,
    ...(effDist != null ? { effectiveDistance: effDist } : {}),
  }) as unknown as Observation;

/** Independent OLS (textbook normal equations), not the engine helper. */
const manualSlope = (xs: number[], ys: number[]): { slope: number; intercept: number } => {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i += 1) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) * (xs[i] - mx);
  }
  const slope = num / den;
  return { slope, intercept: my - slope * mx };
};

const FORBIDDEN = /refraction|collimation|scale error|rod error|significan|p-value|pValue/i;

describe('systematic pattern diagnostics (descriptive only)', () => {
  it('recovers injected distance slope sign and magnitude', () => {
    nextId = 1;
    const lens = [100, 200, 300, 400, 500, 600];
    const obs = lens.map((L, i) => distObs('A', `T${i}`, L, 0.005 + 0.00002 * L));
    const diag = buildSystematicDiagnostics(obs, {})!;
    expect(diag.available).toBe(true);
    const t = diag.distanceTrend;
    expect(t.status).toBe('descriptive');
    expect(t.identifiable).toBe(true);
    const expected = manualSlope(
      lens.map((L) => L / 1000),
      lens.map((L) => (0.005 + 0.00002 * L) * 1000),
    );
    expect(t.slopeMmPerKm).toBeCloseTo(expected.slope, 6);
    expect(t.interceptMm).toBeCloseTo(expected.intercept, 6);
    expect(t.slopeMmPerKm).toBeCloseTo(20, 6);
    expect(t.interceptMm).toBeCloseTo(5, 6);
  });

  it('null distance pattern stays near zero', () => {
    nextId = 100;
    const lens = [100, 200, 300, 400, 500, 600];
    const res = [0.001, -0.002, 0.0015, -0.001, 0.0005, -0.0012];
    const diag = buildSystematicDiagnostics(
      lens.map((L, i) => distObs('A', `T${i}`, L, res[i])),
      {},
    )!;
    expect(diag.distanceTrend.status).toBe('descriptive');
    expect(Math.abs(diag.distanceTrend.slopeMmPerKm ?? 99)).toBeLessThan(5);
  });

  it('constant distance bias responds in mean/intercept with ~zero slope', () => {
    nextId = 200;
    const lens = [100, 200, 300, 400, 500, 600];
    const diag = buildSystematicDiagnostics(
      lens.map((L, i) => distObs('A', `T${i}`, L, 0.01)),
      {},
    )!;
    expect(diag.distanceTrend.slopeMmPerKm).toBeCloseTo(0, 9);
    expect(diag.distanceTrend.interceptMm).toBeCloseTo(10, 9);
    const fam = diag.setupFamilies.find((f) => f.family === 'distance');
    expect(fam?.meanResidual).toBeCloseTo(0.01, 9);
  });

  it('gates distance trend on count and span', () => {
    nextId = 300;
    const few = buildSystematicDiagnostics(
      [100, 200, 300].map((L, i) => distObs('A', `T${i}`, L, 0.001)),
      {},
    )!;
    expect(few.distanceTrend.status).toBe('insufficient-data');
    expect(few.distanceTrend.identifiable).toBe(false);
    const narrow = buildSystematicDiagnostics(
      [100, 100.5, 101, 101.5, 102].map((L, i) => distObs('A', `T${i}`, L, 0.001 * (i + 1))),
      {},
    )!;
    expect(narrow.distanceTrend.status).toBe('insufficient-data');
    expect(narrow.distanceTrend.reason).toMatch(/range too narrow/);
  });

  it('summarizes face balance and largest pair delta', () => {
    nextId = 400;
    const diag = buildSystematicDiagnostics([dirObs('S1', 'T1', 'SET1', 0.00001)], {
      directionTargetDiagnostics: [
        {
          setId: 'SET1', occupy: 'S1', target: 'T1', rawCount: 4, face1Count: 2, face2Count: 2,
          faceBalanced: true, facePairDeltaArcSec: 1.5, residualArcSec: 2,
          reducedSigmaArcSec: 1, suspectScore: 1,
        },
        {
          setId: 'SET1', occupy: 'S1', target: 'T2', rawCount: 3, face1Count: 3, face2Count: 0,
          faceBalanced: false, facePairDeltaArcSec: 9.25, residualArcSec: 3,
          reducedSigmaArcSec: 1, suspectScore: 2,
        },
      ],
    })!;
    expect(diag.directionFaceBalance.status).toBe('descriptive');
    expect(diag.directionFaceBalance.balancedSets).toBe(1);
    expect(diag.directionFaceBalance.unbalancedSets).toBe(1);
    expect(diag.directionFaceBalance.largestFacePairDeltaArcSec).toBeCloseTo(9.25, 9);
    expect(diag.directionFaceBalance.largestFacePairTarget).toBe('T2');
  });

  it('reports face balance insufficient with no targets', () => {
    nextId = 500;
    const diag = buildSystematicDiagnostics([dirObs('S1', 'T1', 'SET1', 0.00001)], {})!;
    expect(diag.directionFaceBalance.status).toBe('insufficient-data');
  });

  it('describes repeated-target same-sign without p-values', () => {
    nextId = 600;
    const obs = [
      dirObs('S1', 'T1', 'SET1', 0.00003),
      dirObs('S1', 'T1', 'SET2', 0.00004),
      dirObs('S1', 'T1', 'SET3', 0.00002),
      dirObs('S1', 'T9', 'SET1', 0.00001),
    ];
    const diag = buildSystematicDiagnostics(obs, {})!;
    const row = diag.directionRepeatSameSign.find((r) => r.target === 'T1')!;
    expect(row.status).toBe('descriptive');
    expect(row.setCount).toBe(3);
    expect(row.sameSignCount).toBe(3);
    expect(row.dominantSign).toBe('pos');
    const single = diag.directionRepeatSameSign.find((r) => r.target === 'T9')!;
    expect(single.status).toBe('insufficient-data');
    expect(JSON.stringify(diag.directionRepeatSameSign)).not.toMatch(/p-?value/i);
  });

  it('recovers zenith slope sign and gates null', () => {
    nextId = 700;
    const dists = [100, 200, 300, 400, 500, 600];
    const diag = buildSystematicDiagnostics(
      dists.map((D, i) => zenObs('A', `T${i}`, 0.00001 + 0.0000001 * D, D)),
      {},
    )!;
    expect(diag.zenithPatterns.status).toBe('descriptive');
    expect((diag.zenithPatterns.slopeVsDistanceArcSecPerKm ?? 0)).toBeGreaterThan(0);
    const thin = buildSystematicDiagnostics([zenObs('A', 'T1', 0.00001)], {})!;
    expect(thin.zenithPatterns.status).toBe('insufficient-data');
  });

  it('recovers leveling drift and gates sequence problems', () => {
    nextId = 800;
    const obs = [0, 1, 2, 3, 4, 5].map((i) =>
      levObs('A', `T${i}`, 0.002 + 0.001 * (i + 1) * 0.2, 0.2, 10 + i),
    );
    const diag = buildSystematicDiagnostics(obs, {})!;
    expect(diag.levelingPatterns.status).toBe('descriptive');
    expect(diag.levelingPatterns.orderedBy).toBe('input-sequence');
    expect(diag.levelingPatterns.cumulativeKm).toBeCloseTo(1.2, 9);
    expect(diag.levelingPatterns.driftMmPerKm).not.toBeNull();
    const noSeq = buildSystematicDiagnostics(
      [0, 1, 2].map((i) => levObs('A', `T${i}`, 0.001, 0.2)),
      {},
    )!;
    expect(noSeq.levelingPatterns.status).toBe('unavailable');
    expect(noSeq.levelingPatterns.reason).toMatch(/input sequence/);
    const thin = buildSystematicDiagnostics(
      [0, 1, 2].map((i) => levObs('A', `T${i}`, 0.001, 0.2, 10 + i)),
      {},
    )!;
    expect(thin.levelingPatterns.status).toBe('insufficient-data');
  });

  it('summarizes GNSS signed means per component', () => {
    nextId = 900;
    const diag = buildSystematicDiagnostics(
      [gpsObs('A', 'B', 0.004, -0.002, 0.006), gpsObs('B', 'C', 0.006, -0.004, 0.008)],
      {},
    )!;
    expect(diag.gnssPatterns.status).toBe('descriptive');
    expect(diag.gnssPatterns.meanEMm).toBeCloseTo(5, 9);
    expect(diag.gnssPatterns.meanNMm).toBeCloseTo(-3, 9);
    expect(diag.gnssPatterns.meanUMm).toBeCloseTo(7, 9);
    const thin = buildSystematicDiagnostics([gpsObs('A', 'B', 0.004, -0.002)], {})!;
    expect(thin.gnssPatterns.status).toBe('insufficient-data');
  });

  it('withholds family means below minimum count', () => {
    nextId = 1000;
    const diag = buildSystematicDiagnostics([distObs('A', 'T1', 100, 0.003)], {})!;
    const fam = diag.setupFamilies.find((f) => f.family === 'distance')!;
    expect(fam.count).toBe(1);
    expect(fam.meanResidual).toBeNull();
  });

  it('is unavailable in preanalysis and data-check modes', () => {
    nextId = 1100;
    const obs = [distObs('A', 'T1', 100, 0.001), distObs('A', 'T2', 200, 0.002)];
    const pre = buildSystematicDiagnostics(obs, { isPreanalysis: true })!;
    expect(pre.available).toBe(false);
    expect(pre.unavailableReason).toMatch(/preanalysis/);
    const dc = buildSystematicDiagnostics(obs, { isDataCheck: true })!;
    expect(dc.available).toBe(false);
    expect(dc.unavailableReason).toMatch(/data-check/);
  });

  it('adds descriptive robust note without formal tests', () => {
    nextId = 1200;
    const diag = buildSystematicDiagnostics([distObs('A', 'T1', 100, 0.001)], {
      isRobust: true,
      robustMode: 'huber',
    })!;
    expect(diag.available).toBe(true);
    expect(diag.robustNote).toMatch(/huber/);
    expect(diag.warnings.some((w) => w.match(/robust/i))).toBe(true);
  });

  it('notes correlated and free-network conditions', () => {
    nextId = 1300;
    const diag = buildSystematicDiagnostics([distObs('A', 'T1', 100, 0.001)], {
      tsCorrelated: true,
      freeNetwork: true,
    })!;
    expect(diag.warnings.some((w) => w.match(/correlated where applicable/))).toBe(true);
    expect(diag.freeNetworkNote).toMatch(/free-network/);
  });

  it('uses descriptive wording only, never causal or formal claims', () => {
    nextId = 1400;
    const obs = [
      ...[100, 200, 300, 400, 500, 600].map((L, i) => distObs('A', `T${i}`, L, 0.005)),
      dirObs('S1', 'T1', 'SET1', 0.00002),
      levObs('A', 'B', 0.001, 0.5, 3),
      gpsObs('A', 'B', 0.001, 0.001),
      zenObs('A', 'T1', 0.00001, 150),
    ];
    const diag = buildSystematicDiagnostics(obs, { freeNetwork: true })!;
    expect(JSON.stringify(diag)).not.toMatch(FORBIDDEN);
  });

  it('orders families and sign runs deterministically', () => {
    nextId = 1500;
    const obs = [
      dirObs('S2', 'T1', 'SETB', 0.00001),
      dirObs('S1', 'T1', 'SETA', -0.00001),
      distObs('S1', 'T1', 100, 0.001),
    ];
    const a = JSON.stringify(buildSystematicDiagnostics(obs, {}));
    const b = JSON.stringify(
      buildSystematicDiagnostics([...obs].reverse(), {}),
    );
    expect(a).toBe(b);
  });
});
