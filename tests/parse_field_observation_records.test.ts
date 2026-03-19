import { describe, expect, it } from 'vitest';

import { parseInput } from '../src/engine/parse';

describe('parse field/GNSS/leveling record families', () => {
  it('parses SS shorthand with setup-angle default and propagated HI/HT', () => {
    const parsed = parseInput(
      [
        'C OCC 0 0 0 !',
        'C BS 0 100 0 !',
        'TB OCC BS',
        'SS OCC-BS-SH 090-00-00.0 10.0 90.0 1.7000/1.5720',
      ].join('\n'),
    );

    const ssDist = parsed.observations.find((obs) => obs.type === 'dist' && obs.setId === 'SS');
    const ssZen = parsed.observations.find(
      (obs) => obs.type === 'zenith' && obs.from === 'OCC' && obs.to === 'SH',
    );

    expect(ssDist?.type).toBe('dist');
    if (ssDist?.type === 'dist') {
      expect(ssDist.from).toBe('OCC');
      expect(ssDist.to).toBe('SH');
      expect((ssDist.calc as { hzObs?: number })?.hzObs).toBeDefined();
      expect((ssDist.calc as { backsightId?: string })?.backsightId).toBe('BS');
      expect(ssDist.hi).toBeCloseTo(1.7, 8);
      expect(ssDist.ht).toBeCloseTo(1.572, 8);
    }

    expect(ssZen?.type).toBe('zenith');
    if (ssZen?.type === 'zenith') {
      expect(ssZen.hi).toBeCloseTo(1.7, 8);
      expect(ssZen.ht).toBeCloseTo(1.572, 8);
    }
  });

  it('parses GS coordinate shots honoring ORDER coordinate and sigma mapping', () => {
    const parsed = parseInput(
      ['.ORDER NE', 'C OCC 0 0 0 ! !', 'GS RTK1 200.0 100.0 0.020 0.030 FROM=OCC'].join('\n'),
    );

    const shots = parsed.parseState.gpsTopoShots ?? [];
    expect(shots).toHaveLength(1);
    expect(shots[0]).toMatchObject({
      pointId: 'RTK1',
      fromId: 'OCC',
    });
    expect(shots[0].east).toBeCloseTo(100, 8);
    expect(shots[0].north).toBeCloseTo(200, 8);
    expect(shots[0].sigmaE).toBeCloseTo(0.03, 8);
    expect(shots[0].sigmaN).toBeCloseTo(0.02, 8);
  });

  it('parses G vectors and attaches a following G4 rover offset', () => {
    const parsed = parseInput(
      [
        '.2D',
        'I GPS1 GNSS 0 0 0 0 0 0 0.002',
        'C A 0 0 0 ! !',
        'C B 12 0 0',
        'G GPS1 A B 10.0000 0.0000 0.0050 0.0060 0.25',
        'G4 90.0000 2.0000 90.0000',
      ].join('\n'),
    );

    const gps = parsed.observations.find((obs) => obs.type === 'gps');
    expect(gps?.type).toBe('gps');
    if (gps?.type === 'gps') {
      expect(gps.from).toBe('A');
      expect(gps.to).toBe('B');
      expect(gps.stdDevE).toBeCloseTo(Math.sqrt(0.005 * 0.005 + 0.002 * 0.002), 8);
      expect(gps.stdDevN).toBeCloseTo(Math.sqrt(0.006 * 0.006 + 0.002 * 0.002), 8);
      expect(gps.corrEN).toBeCloseTo(0.25, 8);
      expect(gps.gpsOffsetSourceLine).toBe(6);
      expect(gps.gpsOffsetDistanceM ?? 0).toBeCloseTo(2, 10);
      expect(gps.gpsOffsetDeltaE ?? 0).toBeCloseTo(2, 10);
      expect(gps.gpsOffsetDeltaN ?? 0).toBeCloseTo(0, 10);
      expect(gps.gpsOffsetDeltaH ?? 0).toBeCloseTo(0, 10);
    }
    expect(parsed.parseState.gpsOffsetObservationCount ?? 0).toBe(1);
  });

  it('parses explicit L records with fixed sigma tokens', () => {
    const parsed = parseInput(['C A 0 0 0 !', 'C B 0 0 0', 'L LVL A B 1.0 0.1 !'].join('\n'));

    const lev = parsed.observations.find((obs) => obs.type === 'lev');
    expect(lev?.type).toBe('lev');
    if (lev?.type === 'lev') {
      expect(lev.instCode).toBe('LVL');
      expect(lev.from).toBe('A');
      expect(lev.to).toBe('B');
      expect(lev.obs).toBeCloseTo(1, 8);
      expect(lev.lenKm).toBeCloseTo(0.1, 8);
      expect(lev.stdDev).toBeCloseTo(1e-7, 12);
      expect(lev.sigmaSource).toBe('fixed');
    }
  });
});
