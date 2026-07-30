import { describe, expect, it } from 'vitest';
import {
  readFileSync,
  parseInput,
} from './parseTestSupport';
import type {
  DistanceObservation,
} from './parseTestSupport';

describe('parseInput', () => {
  it('parses optional CRS scale/convergence directives with explicit OFF support', () => {
    const enabled = parseInput(
      [
        '.UNITS METERS DD',
        '.CRS SCALE 0.99960000',
        '.CRS CONVERGENCE 0.750000',
        'C A 0 0 0 ! !',
        'C B 100 0 0',
      ].join('\n'),
    );
    expect(enabled.parseState.crsGridScaleEnabled).toBe(true);
    expect(enabled.parseState.crsGridScaleFactor).toBeCloseTo(0.9996, 10);
    expect(enabled.parseState.crsConvergenceEnabled).toBe(true);
    expect(enabled.parseState.crsConvergenceAngleRad ?? 0).toBeCloseTo((0.75 * Math.PI) / 180, 10);
    expect(enabled.logs.some((l) => l.includes('CRS grid-ground scale set to ON'))).toBe(true);
    expect(enabled.logs.some((l) => l.includes('CRS convergence set to ON'))).toBe(true);

    const disabled = parseInput(
      [
        '.UNITS METERS DD',
        '.CRS SCALE ON 0.99960000',
        '.CRS CONVERGENCE ON 0.750000',
        '.CRS SCALE OFF',
        '.CRS CONVERGENCE OFF',
        'C A 0 0 0 ! !',
        'C B 100 0 0',
      ].join('\n'),
    );
    expect(disabled.parseState.crsGridScaleEnabled).toBe(false);
    expect(disabled.parseState.crsConvergenceEnabled).toBe(false);
  });

  it('keeps geoid model/height conversion disabled by default and parses .GEOID directives', () => {
    const base = parseInput(['.UNITS METERS DD', 'C A 0 0 0 ! !', 'C B 100 0 0'].join('\n'));
    expect(base.parseState.geoidModelEnabled).toBe(false);
    expect(base.parseState.geoidHeightConversionEnabled).toBe(false);
    expect(base.parseState.geoidOutputHeightDatum).toBe('orthometric');

    const enabled = parseInput(
      [
        '.UNITS METERS DD',
        '.GEOID ON NGS-DEMO',
        '.GEOID INTERP NEAREST',
        '.GEOID HEIGHT ON ELLIPSOID',
        'C A 0 0 0 ! !',
        'C B 100 0 0',
      ].join('\n'),
    );
    expect(enabled.parseState.geoidModelEnabled).toBe(true);
    expect(enabled.parseState.geoidModelId).toBe('NGS-DEMO');
    expect(enabled.parseState.geoidInterpolation).toBe('nearest');
    expect(enabled.parseState.geoidHeightConversionEnabled).toBe(true);
    expect(enabled.parseState.geoidOutputHeightDatum).toBe('ellipsoid');
    expect(enabled.logs.some((l) => l.includes('Geoid/grid model set to ON'))).toBe(true);
    expect(enabled.logs.some((l) => l.includes('Geoid height conversion set to ON'))).toBe(true);

    const off = parseInput(
      [
        '.UNITS METERS DD',
        '.GEOID ON NRC-DEMO',
        '.GEOID INTERP BILINEAR',
        '.GEOID HEIGHT ORTHOMETRIC',
        '.GEOID HEIGHT OFF',
        '.GEOID OFF',
        'C A 0 0 0 ! !',
        'C B 100 0 0',
      ].join('\n'),
    );
    expect(off.parseState.geoidModelEnabled).toBe(false);
    expect(off.parseState.geoidHeightConversionEnabled).toBe(false);
    expect(off.parseState.geoidOutputHeightDatum).toBe('orthometric');
  });

  it('supports .AUTOSIDESHOT and /AUTOSIDESHOT toggles', () => {
    const parsed = parseInput(
      [
        '.AUTOSIDESHOT OFF',
        '/AUTOSIDESHOT ON',
        'C A 0 0 0 !',
        'C B 100 0 0 !',
        'M A-B-P 090-00-00.0 100.000',
      ].join('\n'),
    );
    expect(parsed.parseState.autoSideshotEnabled).toBe(true);
    expect(parsed.logs.some((l) => l.includes('Auto-sideshot detection set to OFF'))).toBe(true);
    expect(parsed.logs.some((l) => l.includes('Auto-sideshot detection set to ON'))).toBe(true);
  });

  it('supports .QFIX and /QFIX overrides for fixed angular/linear sigma constants', () => {
    const secToRad = Math.PI / 180 / 3600;
    const parsed = parseInput(
      [
        '.UNITS FEET DMS',
        '.QFIX LINEAR 0.005 ANGULAR 2.5',
        '/QFIX 0.01 3.0',
        'C A 0 0 0 ! !',
        'C B 100 0 0 ! !',
        'D A-B 100 !',
        'B A-B 090-00-00.0 !',
      ].join('\n'),
    );
    const dist = parsed.observations.find((o) => o.type === 'dist') as
      | DistanceObservation
      | undefined;
    const bearing = parsed.observations.find((o) => o.type === 'bearing');
    expect(dist).toBeDefined();
    expect(bearing).toBeDefined();
    expect(parsed.parseState.qFixLinearSigmaM ?? 0).toBeCloseTo(0.01 / 3.280839895, 12);
    expect(parsed.parseState.qFixAngularSigmaSec ?? 0).toBeCloseTo(3.0, 12);
    expect(dist?.stdDev ?? 0).toBeCloseTo(0.01 / 3.280839895, 12);
    expect(bearing?.stdDev ?? 0).toBeCloseTo(3.0 * secToRad, 12);
    expect(parsed.logs.some((l) => l.includes('QFIX set'))).toBe(true);
  });

  it('parses .LOSTSTATIONS and persists lost-station metadata flags', () => {
    const parsed = parseInput(
      [
        '.LOSTSTATIONS P1 P2',
        'C P1 0 0 0 ! !',
        'C P2 100 0 0',
        'C P3 50 50 0',
        '.LOSTSTATIONS -P2 P4',
        'D P1-P3 70.7107 0.01',
      ].join('\n'),
    );
    expect(parsed.stations.P1?.lost).toBe(true);
    expect(parsed.stations.P2?.lost ?? false).toBe(false);
    expect(parsed.stations.P3?.lost ?? false).toBe(false);
    expect(parsed.parseState.lostStationIds).toEqual(['P1', 'P4']);
    expect(parsed.logs.some((l) => l.includes('Lost stations updated'))).toBe(true);
  });

  it('parses .PRISM state with scope and unit-safe conversion', () => {
    const parsed = parseInput(
      [
        '.UNITS FEET DMS',
        '.PRISM GLOBAL 0.5',
        '.PRISM SET ON 1.0',
        '.PRISM OFF',
        '.PRISM ON 2.0',
        'C A 0 0 0 !',
        'C B 100 0 0 !',
        'D A-B 100 0.01',
      ].join('\n'),
    );
    expect(parsed.parseState.prismEnabled).toBe(true);
    expect(parsed.parseState.prismScope).toBe('global');
    expect(parsed.parseState.prismOffset ?? 0).toBeCloseTo(2 / 3.280839895, 10);
    const dist = parsed.observations.find((o) => o.type === 'dist') as DistanceObservation;
    expect(dist.prismCorrectionM ?? 0).toBeCloseTo(2 / 3.280839895, 10);
    expect(dist.prismScope).toBe('global');
    expect(parsed.logs.some((l) => l.includes('Prism correction set to ON'))).toBe(true);
    expect(parsed.logs.some((l) => l.includes('Prism correction set to OFF'))).toBe(true);
  });

  it('parses cumulative .ROTATION state with DD/DMS compatibility and wrap normalization', () => {
    const parsed = parseInput(
      [
        '.UNITS METERS DD',
        '.ROTATION 10',
        '.ROTATION 370',
        '.ROTATION -45',
        '.UNITS METERS DMS',
        '.ROTATION 0-30-00',
      ].join('\n'),
    );
    const expectedDeg = 335.5;
    expect((parsed.parseState.rotationAngleRad ?? 0) * (180 / Math.PI)).toBeCloseTo(
      expectedDeg,
      10,
    );
    expect(parsed.logs.some((l) => l.includes('Plan rotation updated'))).toBe(true);
  });

  it('applies .ROTATION to azimuth-bearing style observations (B/BM/DIR/SS AZ)', () => {
    const parsed = parseInput(
      [
        '.2D',
        '.AMODE DIR',
        '.ROTATION 10',
        'C A 0 0 0 ! !',
        'C B 100 0 0 ! !',
        'C C 100 100 0 ! !',
        'A A-B-C 090-00-00.0 1.0',
        'B A-B 090-00-00.0 1.0',
        'BM A B 090-00-00.0 100.0 0.0 1.0 0.003 5.0',
        'SS A SH AZ=090-00-00.0 10.0',
      ].join('\n'),
    );
    const expectRotDeg = 100;
    const toDeg = (rad: number) => (rad * 180) / Math.PI;

    const dir = parsed.observations.find((o) => o.type === 'dir');
    expect(dir).toBeDefined();
    expect(toDeg((dir as { obs: number }).obs)).toBeCloseTo(expectRotDeg, 8);

    const bearings = parsed.observations.filter((o) => o.type === 'bearing');
    expect(bearings.length).toBeGreaterThanOrEqual(2);
    bearings.forEach((obs) => {
      expect(toDeg((obs as { obs: number }).obs)).toBeCloseTo(expectRotDeg, 8);
    });

    const ssDist = parsed.observations.find((o) => o.type === 'dist' && o.setId === 'SS');
    expect(ssDist).toBeDefined();
    const ssCalc = ssDist?.calc as { azimuthObs?: number } | undefined;
    expect(ssCalc?.azimuthObs).toBeDefined();
    expect(toDeg(ssCalc?.azimuthObs ?? 0)).toBeCloseTo(expectRotDeg, 8);
  });

  it('logs traverse closure', () => {
    const parsed = parseInput(readFileSync('tests/fixtures/traverse_closure.dat', 'utf-8'));
    expect(parsed.logs.some((l) => l.includes('Traverse end'))).toBe(true);
  });

  it('normalizes known-face direction data into one logical set when mode is on', () => {
    const parsed = parseInput(
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
      { faceNormalizationMode: 'on', parseCompatibilityMode: 'strict' },
    );
    const dirs = parsed.observations.filter((o) => o.type === 'direction');
    expect(dirs).toHaveLength(1);
    expect(dirs[0]?.setId).toBe('O#1');
    expect(parsed.directionRejectDiagnostics?.length ?? 0).toBe(0);
    expect(parsed.parseState.directionSetTreatmentDiagnostics?.[0]?.treatmentDecision).toBe(
      'normalized',
    );
    expect(parsed.parseState.directionSetTreatmentDiagnostics?.[0]?.faceSource).toBe('zenith');
  });

  it('honors explicit DN/DM face hints so pre-normalized imported angles do not strict-reject', () => {
    const parsed = parseInput(
      [
        'I TS1 TS-1 0 0 1 0 1',
        'C 5 0 0 0 *',
        'C 3 -10 -10 0',
        'C 6 30 -10 0',
        'DB 5 3',
        'DM 3 268-15-55.2 15.5837 F1',
        'DM 3 268-16-03.2 15.5845 F1',
        'DM 6 097-26-16.8 33.6071 F1',
        'DM 6 097-26-17.1 33.6069 F1',
        'DE',
      ].join('\n'),
      {},
      { faceNormalizationMode: 'on', parseCompatibilityMode: 'strict' },
    );
    const dirs = parsed.observations.filter((o) => o.type === 'direction');
    expect(dirs).toHaveLength(2);
    expect(parsed.directionRejectDiagnostics?.length ?? 0).toBe(0);
    expect(parsed.parseState.directionSetTreatmentDiagnostics?.[0]?.faceSource).toBe('metadata');
    expect(parsed.parseState.directionSetTreatmentDiagnostics?.[0]?.policyOutcome).toBe('accepted');
  });

  it('keeps known-face split sets when normalization mode is off', () => {
    const parsed = parseInput(
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
      { faceNormalizationMode: 'off', parseCompatibilityMode: 'strict' },
    );
    const dirs = parsed.observations.filter((o) => o.type === 'direction');
    expect(dirs).toHaveLength(2);
    const setIds = dirs.map((o) => o.setId).sort();
    expect(setIds).toEqual(['O#1:F1', 'O#1:F2']);
    expect(parsed.directionRejectDiagnostics?.length ?? 0).toBe(0);
    expect(parsed.parseState.directionSetTreatmentDiagnostics?.[0]?.treatmentDecision).toBe(
      'split',
    );
  });

  it('rejects unresolved mixed-face sets in strict mode', () => {
    const parsed = parseInput(
      readFileSync('tests/fixtures/direction_face_mixed.dat', 'utf-8'),
      {},
      { faceNormalizationMode: 'on', parseCompatibilityMode: 'strict' },
    );
    expect(parsed.observations.some((o) => o.type === 'direction')).toBe(false);
    expect(
      parsed.directionRejectDiagnostics?.some((d) => d.reason === 'unresolved-mixed-face'),
    ).toBe(true);
    const diag = parsed.parseState.directionSetTreatmentDiagnostics?.[0];
    expect(diag?.policyOutcome).toBe('strict-reject');
    expect(diag?.treatmentDecision).toBe('unresolved');
  });

  it('uses deterministic legacy fallback for unresolved mixed-face sets', () => {
    const parsed = parseInput(
      readFileSync('tests/fixtures/direction_face_mixed.dat', 'utf-8'),
      {},
      { faceNormalizationMode: 'on', parseCompatibilityMode: 'legacy' },
    );
    const dirs = parsed.observations.filter((o) => o.type === 'direction');
    expect(dirs).toHaveLength(2);
    expect(parsed.logs.some((l) => l.includes('legacy fallback applied'))).toBe(true);
    const diag = parsed.parseState.directionSetTreatmentDiagnostics?.[0];
    expect(diag?.policyOutcome).toBe('legacy-fallback');
    expect(diag?.treatmentDecision).toBe('split');
  });

});
