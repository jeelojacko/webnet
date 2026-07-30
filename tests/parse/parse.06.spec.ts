import { describe, expect, it } from 'vitest';
import {
  readFileSync,
  parseInput,
} from './parseTestSupport';

describe('parseInput', () => {
  it('applies auto mode semantics: reliable faces normalize; unresolved follows compatibility mode', () => {
    const reliable = parseInput(
      [
        'I TS1 TS-1 0 0 1 0 1',
        'C O 0 0 0 *',
        'C B 0 100 0',
        'C P 100 0 0',
        'DB O B',
        'DM P 090.0000 100.0 090.0000 1.0 0.002',
        'DM P 270.0000 100.0 270.0000 1.0 0.002',
        'DE',
      ].join('\n'),
      {},
      { faceNormalizationMode: 'auto', parseCompatibilityMode: 'strict' },
    );
    expect(reliable.observations.filter((o) => o.type === 'direction')).toHaveLength(1);
    expect(reliable.parseState.directionSetTreatmentDiagnostics?.[0]?.treatmentDecision).toBe(
      'normalized',
    );

    const unresolvedStrict = parseInput(
      readFileSync('tests/fixtures/direction_face_mixed.dat', 'utf-8'),
      {},
      { faceNormalizationMode: 'auto', parseCompatibilityMode: 'strict' },
    );
    expect(unresolvedStrict.observations.some((o) => o.type === 'direction')).toBe(false);
    expect(
      unresolvedStrict.parseState.directionSetTreatmentDiagnostics?.[0]?.policyOutcome,
    ).toBe('strict-reject');

    const unresolvedLegacy = parseInput(
      readFileSync('tests/fixtures/direction_face_mixed.dat', 'utf-8'),
      {},
      { faceNormalizationMode: 'auto', parseCompatibilityMode: 'legacy' },
    );
    expect(unresolvedLegacy.observations.filter((o) => o.type === 'direction')).toHaveLength(2);
    expect(
      unresolvedLegacy.parseState.directionSetTreatmentDiagnostics?.[0]?.policyOutcome,
    ).toBe('legacy-fallback');
  });

  it('keeps raw direction observations when directionSetMode is raw', () => {
    const parsed = parseInput(
      readFileSync('tests/fixtures/direction_face_balanced.dat', 'utf-8'),
      {},
      { faceNormalizationMode: 'off', directionSetMode: 'raw' },
    );
    const dirs = parsed.observations.filter((o) => o.type === 'direction');
    expect(dirs).toHaveLength(2);
    expect(parsed.logs.some((l) => l.includes('raw rows'))).toBe(true);
  });

  it('reduces direction sets by target (unpaired targets remain separate)', () => {
    const parsed = parseInput(readFileSync('tests/fixtures/direction_faceset.dat', 'utf-8'));
    const dirs = parsed.observations.filter((o) => o.type === 'direction');
    expect(dirs).toHaveLength(2);
    expect(parsed.logs.some((l) => l.includes('pairedTargets=0'))).toBe(true);
  });

  it('rejects invalid sideshot occupy/backsight', () => {
    const parsed = parseInput(readFileSync('tests/fixtures/sideshot_invalid.dat', 'utf-8'));
    expect(parsed.observations.some((o) => o.setId === 'SS')).toBe(false);
    expect(parsed.logs.some((l) => l.includes('Invalid sideshot occupy/backsight'))).toBe(true);
  });

  it('parses DV slope mode into dist + zenith', () => {
    const parsed = parseInput(
      readFileSync('tests/fixtures/dv_slope.dat', 'utf-8'),
      {},
      { deltaMode: 'slope' },
    );
    const zen = parsed.observations.find((o) => o.type === 'zenith');
    const dist = parsed.observations.find((o) => o.type === 'dist');
    expect(zen).toBeDefined();
    expect(dist).toBeDefined();
  });

  it('parses BM with zenith in slope mode', () => {
    const parsed = parseInput(
      readFileSync('tests/fixtures/bm_slope.dat', 'utf-8'),
      {},
      { deltaMode: 'slope' },
    );
    const zen = parsed.observations.find((o) => o.type === 'zenith');
    expect(zen).toBeDefined();
  });

  it('parses GNSS component sigmas and correlation', () => {
    const parsed = parseInput(
      [
        'I GPS1 GNSS 0 0 0 0 0 0 0.002',
        'C A 0 0 0 !',
        'C B 100 0 0',
        'G GPS1 A B 100 0 0.010 0.020 0.3',
      ].join('\n'),
    );
    const g = parsed.observations.find((o) => o.type === 'gps');
    expect(g).toBeDefined();
    expect(g?.stdDevE).toBeCloseTo(Math.sqrt(0.01 * 0.01 + 0.002 * 0.002), 8);
    expect(g?.stdDevN).toBeCloseTo(Math.sqrt(0.02 * 0.02 + 0.002 * 0.002), 8);
    expect(g?.corrEN).toBeCloseTo(0.3, 8);
  });

  it('parses GNSS fixed sigma tokens', () => {
    const parsed = parseInput(
      ['.2D', 'C A 0 0 0 ! !', 'C B 100 0 0', 'G GPS1 A B 10 20 ! !'].join('\n'),
    );
    const g = parsed.observations.find((o) => o.type === 'gps');
    expect(g?.type).toBe('gps');
    if (g?.type === 'gps') {
      expect(g.from).toBe('A');
      expect(g.to).toBe('B');
      expect(g.stdDevE).toBeCloseTo(1e-7, 12);
      expect(g.stdDevN).toBeCloseTo(1e-7, 12);
      expect(g.sigmaSource).toBe('fixed');
    }
  });

  it('preserves per-component GNSS sigma-source traceability when weighting sources differ', () => {
    const parsed = parseInput(
      ['.2D', 'C A 0 0 0 ! !', 'C B 100 0 0', 'G GPS1 A B 10 20 ! *'].join('\n'),
    );
    const g = parsed.observations.find((o) => o.type === 'gps');
    expect(g?.type).toBe('gps');
    if (g?.type === 'gps') {
      expect(g.sigmaSource).toBe('fixed');
      expect(g.sigmaSourceE).toBe('fixed');
      expect(g.sigmaSourceN).toBe('float');
    }
  });

  it('parses .GPS NETWORK/.GPS SIDESHOT mode state and tags G observations', () => {
    const base = parseInput(
      ['I GPS1 GNSS 0 0 0 0 0 0 0.002', 'C A 0 0 0 !', 'C B 100 0 0', 'G GPS1 A B 100 0 0.01'].join(
        '\n',
      ),
    );
    const baseGps = base.observations.find((o) => o.type === 'gps');
    expect(base.parseState.gpsVectorMode).toBe('network');
    expect(baseGps?.type).toBe('gps');
    if (baseGps?.type === 'gps') expect(baseGps.gpsMode).toBe('network');

    const parsed = parseInput(
      [
        '.GPS SIDESHOT',
        '/GPS NETWORK',
        '.GPS SS',
        'I GPS1 GNSS 0 0 0 0 0 0 0.002',
        'C A 0 0 0 !',
        'C B 100 0 0',
        'G GPS1 A B 100 0 0.01',
      ].join('\n'),
    );
    const gps = parsed.observations.find((o) => o.type === 'gps');
    expect(parsed.parseState.gpsVectorMode).toBe('sideshot');
    expect(gps?.type).toBe('gps');
    if (gps?.type === 'gps') expect(gps.gpsMode).toBe('sideshot');
    expect(parsed.logs.some((l) => l.includes('GPS vector mode set to SIDESHOT'))).toBe(true);
    expect(parsed.logs.some((l) => l.includes('GPS vector mode set to NETWORK'))).toBe(true);
  });

  it('parses .GPS FRAME/.GPS CONFIRM and tags GNSS frame metadata on vectors', () => {
    const parsed = parseInput(
      [
        '.GPS FRAME UNKNOWN',
        '.GPS CONFIRM OFF',
        '.GPS FRAME ENULOCAL ON',
        'C A 0 0 0 !',
        'C B 100 0 0',
        'G GPS1 A B 100 0 0.01',
      ].join('\n'),
    );
    const gps = parsed.observations.find((o) => o.type === 'gps');
    expect(parsed.parseState.gnssVectorFrameDefault).toBe('enuLocal');
    expect(parsed.parseState.gnssFrameConfirmed).toBe(true);
    expect(gps?.type).toBe('gps');
    if (gps?.type === 'gps') {
      expect(gps.gnssVectorFrame).toBe('enuLocal');
      expect(gps.gnssFrameConfirmed).toBe(true);
    }
    expect(parsed.logs.some((l) => l.includes('GPS vector frame default set to enuLocal'))).toBe(
      true,
    );
  });

  it('parses GPS vertical deflection state from .GPS VDEF', () => {
    const parsed = parseInput(
      [
        '.GPS VDEF N -2.910 E -1.460',
        'C A 0 0 0 !',
        'C B 100 0 0',
        'G GPS1 A B 100 0 0.01',
      ].join('\n'),
    );

    expect(parsed.parseState.verticalDeflectionNorthSec ?? 0).toBeCloseTo(-2.91, 10);
    expect(parsed.parseState.verticalDeflectionEastSec ?? 0).toBeCloseTo(-1.46, 10);
    expect(parsed.logs.some((line) => line.includes('GPS vertical deflection set to N=-2.910"'))).toBe(
      true,
    );
  });

  it('parses G0/G1/G2/G3 GNSS covariance-vector blocks with inline GPS factors', () => {
    const parsed = parseInput(
      [
        '.GPS WEIGHT COVARIANCE',
        '.GPS FACTOR 2.6 VERT 2',
        'C A 500000 0 100 ! ! !',
        'C B 500100 100 90',
        "G0 'session_a.asc",
        'G1 A-B 57.559600 280.508300 184.546200',
        'G2 1.8006862774E-06 8.9217319328E-06 9.4458864623E-06',
        'G3 -3.5520472466E-06 3.5240054785E-06 -8.6638065113E-06',
      ].join('\n'),
    );

    const gps = parsed.observations.find((obs) => obs.type === 'gps');
    expect(gps?.type).toBe('gps');
    if (gps?.type === 'gps') {
      expect(gps.gpsWeightingMode).toBe('covariance');
      expect(gps.gnssVectorFrame).toBe('ecefDelta');
      expect(gps.gpsVectorLabel).toBe('session_a.asc');
      expect(gps.gpsVectorHorizontalFactor ?? 0).toBeCloseTo(2.6, 10);
      expect(gps.gpsVectorVerticalFactor ?? 0).toBeCloseTo(2, 10);
      expect(gps.obs.dE).toBeCloseTo(57.5596, 10);
      expect(gps.obs.dN).toBeCloseTo(280.5083, 10);
      expect(gps.obs.dU ?? 0).toBeCloseTo(184.5462, 10);
      expect(gps.gpsCovariance3d?.cXX ?? 0).toBeCloseTo(1.8006862774e-6 * 2.6 * 2.6, 16);
      expect(gps.gpsCovariance3d?.cYY ?? 0).toBeCloseTo(8.9217319328e-6 * 2.6 * 2.6, 16);
      expect(gps.gpsCovariance3d?.cZZ ?? 0).toBeCloseTo(9.4458864623e-6 * 2 * 2, 16);
      expect(gps.gpsCovariance3d?.cXY ?? 0).toBeCloseTo(-3.5520472466e-6 * 2.6 * 2.6, 16);
      expect(gps.gpsCovariance3d?.cXZ ?? 0).toBeCloseTo(3.5240054785e-6 * 2.6 * 2, 16);
      expect(gps.gpsCovariance3d?.cYZ ?? 0).toBeCloseTo(-8.6638065113e-6 * 2.6 * 2, 16);
      expect(gps.sourceLine).toBe(6);
    }
    expect(parsed.parseState.gpsWeightingMode).toBe('covariance');
    expect(parsed.parseState.gpsVectorFactorHorizontal ?? 0).toBeCloseTo(2.6, 10);
    expect(parsed.parseState.gpsVectorFactorVertical ?? 0).toBeCloseTo(2, 10);
  });

  it('parses .GPS AddHiHt state with defaults and tags G observations', () => {
    const base = parseInput(['C A 0 0 0 !', 'C B 100 0 0', 'G GPS1 A B 100 0 0.01'].join('\n'));
    const baseGps = base.observations.find((o) => o.type === 'gps');
    expect(base.parseState.gpsAddHiHtEnabled ?? false).toBe(false);
    if (baseGps?.type === 'gps') {
      expect(baseGps.gpsAntennaHiM).toBeUndefined();
      expect(baseGps.gpsAntennaHtM).toBeUndefined();
    }

    const parsed = parseInput(
      [
        '.UNITS FT',
        '.GPS AddHiHt 5.25 6.75',
        '/GPS AddHiHt ON 7.00 8.00',
        'C A 0 0 0 !',
        'C B 100 0 0',
        'G GPS1 A B 100 0 0.01',
      ].join('\n'),
    );
    const gps = parsed.observations.find((o) => o.type === 'gps');
    expect(parsed.parseState.gpsAddHiHtEnabled ?? false).toBe(true);
    expect(parsed.parseState.gpsAddHiHtHiM ?? 0).toBeCloseTo(7 / 3.280839895, 10);
    expect(parsed.parseState.gpsAddHiHtHtM ?? 0).toBeCloseTo(8 / 3.280839895, 10);
    expect(gps?.type).toBe('gps');
    if (gps?.type === 'gps') {
      expect(gps.gpsAntennaHiM ?? 0).toBeCloseTo(7 / 3.280839895, 10);
      expect(gps.gpsAntennaHtM ?? 0).toBeCloseTo(8 / 3.280839895, 10);
    }
    expect(parsed.logs.some((l) => l.includes('GPS AddHiHt set to ON'))).toBe(true);
  });

  it('validates .GPS AddHiHt tokens and supports OFF toggle', () => {
    const parsed = parseInput(
      [
        '.GPS AddHiHt OFF',
        '.GPS AddHiHt nope',
        '.GPS AddHiHt ON 1.0 bad',
        '.GPS AddHiHt 2.0 3.0',
        '.GPS AddHiHt OFF',
        'C A 0 0 0 !',
        'C B 100 0 0',
        'G GPS1 A B 100 0 0.01',
      ].join('\n'),
    );
    const gps = parsed.observations.find((o) => o.type === 'gps');
    expect(parsed.parseState.gpsAddHiHtEnabled ?? false).toBe(false);
    expect(gps?.type).toBe('gps');
    if (gps?.type === 'gps') {
      expect(gps.gpsAntennaHiM).toBeUndefined();
      expect(gps.gpsAntennaHtM).toBeUndefined();
    }
    expect(parsed.logs.some((l) => l.includes('invalid .GPS AddHiHt option'))).toBe(true);
    expect(parsed.logs.some((l) => l.includes('invalid .GPS AddHiHt HT value'))).toBe(true);
    expect(parsed.logs.some((l) => l.includes('GPS AddHiHt set to OFF'))).toBe(true);
  });

  it('parses GPS rover offset (G4) records onto the preceding G vector', () => {
    const parsed = parseInput(
      [
        '.2D',
        'C A 0 0 0 ! !',
        'C B 12 0 0',
        'G GPS1 A B 10.0000 0.0000 0.0050 0.0050',
        'G4 90.0000 2.0000 90.0000',
      ].join('\n'),
    );
    const gps = parsed.observations.find((o) => o.type === 'gps');
    expect(gps?.type).toBe('gps');
    if (gps?.type === 'gps') {
      expect(gps.gpsOffsetSourceLine).toBe(5);
      expect(gps.gpsOffsetDistanceM ?? 0).toBeCloseTo(2, 10);
      expect(gps.gpsOffsetDeltaE ?? 0).toBeCloseTo(2, 10);
      expect(gps.gpsOffsetDeltaN ?? 0).toBeCloseTo(0, 10);
      expect(gps.gpsOffsetDeltaH ?? 0).toBeCloseTo(0, 10);
    }
    expect(parsed.parseState.gpsOffsetObservationCount ?? 0).toBe(1);
    expect(parsed.logs.some((line) => line.includes('GPS rover offset attached to A-B'))).toBe(
      true,
    );
  });

  it('warns when GPS rover offset (G4) has no preceding G vector', () => {
    const parsed = parseInput(['.2D', 'C A 0 0 0 ! !', 'G4 90.0000 2.0000 90.0000'].join('\n'));
    expect(parsed.parseState.gpsOffsetObservationCount ?? 0).toBe(0);
    expect(parsed.logs.some((line) => line.includes('has no preceding G vector'))).toBe(true);
  });

  it('parses fixed leveling sigma tokens', () => {
    const parsed = parseInput(['C A 0 0 0 !', 'C B 0 0 0', 'L LVL A B 1.0 0.1 !'].join('\n'));
    const lev = parsed.observations.find((o) => o.type === 'lev');
    expect(lev?.type).toBe('lev');
    if (lev?.type === 'lev') {
      expect(lev.stdDev).toBeCloseTo(1e-7, 12);
      expect(lev.sigmaSource).toBe('fixed');
    }
  });

});
