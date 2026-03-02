import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseInput } from '../src/engine/parse';
import type { AngleObservation, DistanceObservation, LevelObservation } from '../src/types';

const fixture = readFileSync('tests/fixtures/simple.dat', 'utf-8');

describe('parseInput', () => {
  const parsed = parseInput(fixture);

  it('parses stations and unknowns', () => {
    expect(Object.keys(parsed.stations)).toHaveLength(3);
    expect(parsed.unknowns).toEqual(['2000']);
  });

  it('parses instrument library', () => {
    expect(Object.keys(parsed.instrumentLibrary)).toHaveLength(3);
    expect(parsed.instrumentLibrary.TS1.desc).toBe('TS Geodetic 1mm+1ppm');
  });

  it('parses observations', () => {
    expect(parsed.observations.length).toBeGreaterThan(0);
    const types = parsed.observations.reduce<Record<string, number>>((acc, o) => {
      acc[o.type] = (acc[o.type] ?? 0) + 1;
      return acc;
    }, {});
    expect(types).toMatchObject({ dist: 3, angle: 3, gps: 2, lev: 2 });
    expect(types.dir ?? 0).toBe(0);
  });

  it('applies .LWEIGHT fallback and converts ft leveling lengths', () => {
    const levelOnly = parseInput(
      ['.UNITS FT', '.LWEIGHT 0.7', 'C A 0 0 0 *', 'C B 0 0 0', 'L LEV1 A B 1.0 328.084'].join(
        '\n',
      ),
    );
    const lev = levelOnly.observations.find((o) => o.type === 'lev') as LevelObservation;
    expect(lev).toBeDefined();
    expect(lev.lenKm).toBeCloseTo(0.1, 6); // 328.084 ft -> 0.1 km
    expect(lev.obs).toBeCloseTo(0.3048, 6); // 1 ft -> meters
    expect(lev.stdDev).toBeCloseTo(0.00007, 6); // 0.7 mm/km * 0.1 km
    expect(levelOnly.logs.some((l) => l.includes('.LWEIGHT applied'))).toBe(true);
  });

  it('parses bearings and zeniths', () => {
    const bearingFixture = readFileSync('tests/fixtures/bearing_vertical.dat', 'utf-8');
    const parsed = parseInput(bearingFixture);
    const types = parsed.observations.reduce<Record<string, number>>((acc, o) => {
      acc[o.type] = (acc[o.type] ?? 0) + 1;
      return acc;
    }, {});
    expect(types.bearing).toBe(1);
    expect(types.zenith).toBe(1);
    expect(types.dist).toBeGreaterThan(0);
  });

  it('parses traverse legs and direction sets', () => {
    const parsed = parseInput(readFileSync('tests/fixtures/traverse.dat', 'utf-8'));
    const types = parsed.observations.reduce<Record<string, number>>((acc, o) => {
      acc[o.type] = (acc[o.type] ?? 0) + 1;
      return acc;
    }, {});
    expect(types.angle).toBeGreaterThan(0);
    expect(types.dist).toBeGreaterThan(0);
    expect(parsed.logs.some((l) => l.includes('Traverse start'))).toBe(true);
  });

  it('auto-creates missing stations referenced by active observations', () => {
    const parsed = parseInput(
      readFileSync('tests/fixtures/triangulation_trilateration_2d.dat', 'utf-8'),
    );
    expect(parsed.stations['4']).toBeDefined();
    expect(parsed.stations['5']).toBeDefined();
    expect(parsed.stations['6']).toBeDefined();
    expect(parsed.logs.some((l) => l.includes('Auto-created station 4'))).toBe(true);
    expect(parsed.logs.some((l) => l.includes('Auto-created station 5'))).toBe(true);
    expect(parsed.logs.some((l) => l.includes('Auto-created station 6'))).toBe(true);
  });

  it('parses 2D M records with angle/dist sigmas and no vertical observation', () => {
    const parsed = parseInput(
      readFileSync('tests/fixtures/triangulation_trilateration_2d.dat', 'utf-8'),
    );
    const zenCount = parsed.observations.filter((o) => o.type === 'zenith').length;
    const levCount = parsed.observations.filter((o) => o.type === 'lev').length;
    expect(zenCount).toBe(0);
    expect(levCount).toBe(0);

    const mLine = parsed.observations.find(
      (o) =>
        o.type === 'angle' &&
        (o as AngleObservation).at === '3' &&
        (o as AngleObservation).from === '2' &&
        (o as AngleObservation).to === '6',
    );
    expect(mLine).toBeDefined();
    expect(mLine?.stdDev).toBeCloseTo((4.0 * (Math.PI / 180)) / 3600, 12);
  });

  it('supports .ORDER FROMATTO for A/M station triplets', () => {
    const parsed = parseInput(
      [
        '.2D',
        '.ORDER EN FROMATTO',
        'C A 0 0 0 !',
        'C B 0 100 0 !',
        'C P 100 0 0',
        'A B-A-P 090-00-00.0 1.0',
        'M B-A-P 090-00-00.0 100.0',
      ].join('\n'),
    );
    const ang = parsed.observations.find((o) => o.type === 'angle') as AngleObservation | undefined;
    expect(ang).toBeDefined();
    expect(ang?.at).toBe('A');
    expect(ang?.from).toBe('B');
    expect(ang?.to).toBe('P');
    const dist = parsed.observations.find((o) => o.type === 'dist') as
      | { from: string; to: string }
      | undefined;
    expect(dist?.from).toBe('A');
    expect(dist?.to).toBe('P');
    expect(parsed.parseState.angleStationOrder).toBe('fromatto');
  });

  it('supports .UNITS DD and .UNITS DMS for angle parsing', () => {
    const dd = parseInput(
      [
        '.2D',
        '.UNITS METERS DD',
        'C A 0 0 0 !',
        'C B 0 100 0 !',
        'C P 100 0 0',
        'A A-B-P 90.5 1.0',
      ].join('\n'),
    );
    const dms = parseInput(
      [
        '.2D',
        '.UNITS METERS DMS',
        'C A 0 0 0 !',
        'C B 0 100 0 !',
        'C P 100 0 0',
        'A A-B-P 090-30-00.0 1.0',
      ].join('\n'),
    );
    const ddAng = dd.observations.find((o) => o.type === 'angle') as AngleObservation | undefined;
    const dmsAng = dms.observations.find((o) => o.type === 'angle') as AngleObservation | undefined;
    expect(ddAng).toBeDefined();
    expect(dmsAng).toBeDefined();
    expect(ddAng?.obs ?? 0).toBeCloseTo((90.5 * Math.PI) / 180, 10);
    expect(dmsAng?.obs ?? 0).toBeCloseTo((90.5 * Math.PI) / 180, 10);
    expect(dd.parseState.angleUnits).toBe('dd');
    expect(dms.parseState.angleUnits).toBe('dms');
  });

  it('supports .AUTOADJUST and /AUTOADJUST command-style options', () => {
    const parsed = parseInput(
      [
        '.AUTOADJUST OFF',
        '/AUTOADJUST ON 3.5 6 2',
        '/AUTOADJUST ON THRESHOLD 4.25 CYCLES 5 MAXREMOVE 1',
        'C A 0 0 0 !',
        'C B 100 0 0',
        'D A B 100 0.01',
      ].join('\n'),
    );
    expect(parsed.parseState.autoAdjustEnabled).toBe(true);
    expect(parsed.parseState.autoAdjustStdResThreshold).toBeCloseTo(4.25, 10);
    expect(parsed.parseState.autoAdjustMaxCycles).toBe(5);
    expect(parsed.parseState.autoAdjustMaxRemovalsPerCycle).toBe(1);
    expect(parsed.logs.some((l) => l.includes('Auto-adjust set to ON'))).toBe(true);
  });

  it('parses planned observation placeholders when preanalysis mode is enabled', () => {
    const parsed = parseInput(
      [
        '.2D',
        'C A 0 0 0 ! !',
        'C B 100 0 0 ! !',
        'C P 60 40 0',
        'D A-P ? 0.01',
        'A P-A-B ? 1.0',
        'B A-P ? 2.0',
        'L LV A P ? 0.10 2.0',
      ].join('\n'),
      {},
      { preanalysisMode: true },
    );

    expect(parsed.parseState.preanalysisMode).toBe(true);
    expect(parsed.parseState.plannedObservationCount).toBe(4);
    expect(parsed.logs.some((l) => l.includes('Preanalysis parsing: mode=ON'))).toBe(true);
    expect(parsed.observations.every((obs) => obs.planned === true)).toBe(true);

    const dist = parsed.observations.find((obs) => obs.type === 'dist') as DistanceObservation | undefined;
    const angle = parsed.observations.find((obs) => obs.type === 'angle') as AngleObservation | undefined;
    expect(dist?.obs ?? Number.NaN).toBe(0);
    expect(angle?.obs ?? Number.NaN).toBe(0);
  });

  it('keeps CRS transforms disabled by default and parses .CRS state directives', () => {
    const base = parseInput(['.UNITS METERS DD', 'P ORG 40 105 0 ! !', 'P TGT 41 106 0'].join('\n'));
    expect(base.parseState.crsTransformEnabled).toBe(false);
    expect(base.parseState.crsProjectionModel).toBe('legacy-equirectangular');

    const enabled = parseInput(
      ['.UNITS METERS DD', '.CRS ON ENU Site-Grid', 'P ORG 40 105 0 ! !', 'P TGT 41 106 0'].join(
        '\n',
      ),
    );
    expect(enabled.parseState.crsTransformEnabled).toBe(true);
    expect(enabled.parseState.crsProjectionModel).toBe('local-enu');
    expect(enabled.parseState.crsLabel).toBe('Site-Grid');
    expect(enabled.logs.some((l) => l.includes('CRS transforms set to ON'))).toBe(true);

    const off = parseInput(
      ['.UNITS METERS DD', '.CRS ON ENU', '.CRS OFF', 'P ORG 40 105 0 ! !', 'P TGT 41 106 0'].join(
        '\n',
      ),
    );
    expect(off.parseState.crsTransformEnabled).toBe(false);
    expect(off.logs.some((l) => l.includes('CRS transforms set to OFF'))).toBe(true);
  });

  it('applies ENU projection only when CRS transforms are explicitly enabled', () => {
    const source = ['.UNITS METERS DD', 'P ORG 40 105 0 ! !', 'P TGT 41 106 0'].join('\n');
    const legacy = parseInput(source);
    const explicitLegacy = parseInput(['.CRS ON LEGACY', source].join('\n'));
    const enu = parseInput(['.CRS ON ENU', source].join('\n'));

    expect(explicitLegacy.stations.TGT.x).toBeCloseTo(legacy.stations.TGT.x, 8);
    expect(explicitLegacy.stations.TGT.y).toBeCloseTo(legacy.stations.TGT.y, 8);

    const deltaE = Math.abs((enu.stations.TGT.x ?? 0) - (legacy.stations.TGT.x ?? 0));
    const deltaN = Math.abs((enu.stations.TGT.y ?? 0) - (legacy.stations.TGT.y ?? 0));
    expect(deltaE).toBeGreaterThan(10);
    expect(deltaN).toBeGreaterThan(10);
  });

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
    const secToRad = (Math.PI / 180) / 3600;
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
    const dist = parsed.observations.find((o) => o.type === 'dist') as DistanceObservation | undefined;
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
    expect((parsed.parseState.rotationAngleRad ?? 0) * (180 / Math.PI)).toBeCloseTo(expectedDeg, 10);
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

  it('rejects mixed-face directions when normalize off', () => {
    const parsed = parseInput(
      readFileSync('tests/fixtures/direction_face_mixed.dat', 'utf-8'),
      {},
      { normalize: false },
    );
    expect(parsed.logs.some((l) => l.includes('Mixed face direction rejected'))).toBe(true);
    expect(parsed.directionRejectDiagnostics?.some((d) => d.reason === 'mixed-face')).toBe(true);
  });

  it('accepts paired face directions when normalized', () => {
    const parsed = parseInput(readFileSync('tests/fixtures/direction_face_balanced.dat', 'utf-8'));
    const dirCount = parsed.observations.filter((o) => o.type === 'direction').length;
    expect(dirCount).toBe(1);
    const dir = parsed.observations.find((o) => o.type === 'direction');
    expect(dir?.rawCount).toBe(2);
    expect(dir?.rawFace1Count).toBe(1);
    expect(dir?.rawFace2Count).toBe(1);
    if (dir?.type === 'direction') {
      expect(dir.rawMaxResidual).toBeDefined();
      expect(dir.facePairDelta).toBeDefined();
      expect(dir.face1Spread).toBeDefined();
      expect(dir.face2Spread).toBeDefined();
    }
    expect(parsed.logs.some((l) => l.includes('Direction set reduction'))).toBe(true);
    expect(parsed.logs.some((l) => l.includes('Mixed face'))).toBe(false);
  });

  it('keeps raw direction observations when directionSetMode is raw', () => {
    const parsed = parseInput(
      readFileSync('tests/fixtures/direction_face_balanced.dat', 'utf-8'),
      {},
      { normalize: true, directionSetMode: 'raw' },
    );
    const dirs = parsed.observations.filter((o) => o.type === 'direction');
    expect(dirs).toHaveLength(2);
    expect(parsed.logs.some((l) => l.includes('raw mode'))).toBe(true);
    expect(parsed.logs.some((l) => l.includes('Direction set reduction'))).toBe(false);
  });

  it('reduces direction sets by target (unpaired targets remain separate)', () => {
    const parsed = parseInput(readFileSync('tests/fixtures/direction_faceset.dat', 'utf-8'));
    const dirs = parsed.observations.filter((o) => o.type === 'direction');
    expect(dirs).toHaveLength(2);
    expect(parsed.logs.some((l) => l.includes('paired targets=0'))).toBe(true);
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

  it('parses .GPS CHECK toggle state with OFF-by-default behavior', () => {
    const base = parseInput(['C A 0 0 0 !', 'C B 100 0 0', 'G GPS1 A B 100 0 0.01'].join('\n'));
    expect(base.parseState.gpsLoopCheckEnabled ?? false).toBe(false);

    const parsed = parseInput(
      [
        '.GPS CHECK',
        '/GPS CHECK OFF',
        '.GPS CHECK ON',
        '.GPS CHECK nope',
        'C A 0 0 0 !',
        'C B 100 0 0',
        'G GPS1 A B 100 0 0.01',
      ].join('\n'),
    );
    expect(parsed.parseState.gpsLoopCheckEnabled ?? false).toBe(true);
    expect(parsed.logs.some((l) => l.includes('GPS loop check set to ON'))).toBe(true);
    expect(parsed.logs.some((l) => l.includes('GPS loop check set to OFF'))).toBe(true);
    expect(parsed.logs.some((l) => l.includes('invalid .GPS CHECK option'))).toBe(true);
  });

  it('does not auto-create GPS SIDESHOT target stations while NETWORK mode still does', () => {
    const network = parseInput(
      ['.GPS NETWORK', 'C OCC 0 0 0 !', 'G GPS1 OCC TARGET 10 20 0.01 0.02'].join('\n'),
    );
    const sideshot = parseInput(
      ['.GPS SIDESHOT', 'C OCC 0 0 0 !', 'G GPS1 OCC TARGET 10 20 0.01 0.02'].join('\n'),
    );
    expect(network.stations.TARGET).toBeDefined();
    expect(sideshot.stations.TARGET).toBeUndefined();
    expect(network.logs.some((l) => l.includes('Auto-created station TARGET'))).toBe(true);
    expect(sideshot.logs.some((l) => l.includes('Auto-created station TARGET'))).toBe(false);
  });

  it('parses phase-3 reduction directives', () => {
    const parsed = parseInput(
      [
        '.MAPMODE ANGLECALC',
        '.MAPSCALE 0.9996',
        '.CURVREF ON',
        '.REFRACTION 0.14',
        '.VRED CURVREF',
        'C A 0 0 0 !',
        'C B 100 0 0',
        'D A-B 100 0.01',
      ].join('\n'),
    );
    expect(parsed.parseState.mapMode).toBe('anglecalc');
    expect(parsed.parseState.mapScaleFactor).toBeCloseTo(0.9996, 8);
    expect(parsed.parseState.applyCurvatureRefraction).toBe(true);
    expect(parsed.parseState.refractionCoefficient).toBeCloseTo(0.14, 8);
    expect(parsed.parseState.verticalReduction).toBe('curvref');
  });

  it('parses TS correlation directives', () => {
    const parsed = parseInput(
      ['.TSCORR SETUP 0.35', 'C A 0 0 0 !', 'C B 100 0 0', 'D A-B 100 0.01'].join('\n'),
    );
    expect(parsed.parseState.tsCorrelationEnabled).toBe(true);
    expect(parsed.parseState.tsCorrelationScope).toBe('setup');
    expect(parsed.parseState.tsCorrelationRho).toBeCloseTo(0.35, 8);

    const off = parseInput(
      ['.TSCORR OFF', 'C A 0 0 0 !', 'C B 100 0 0', 'D A-B 100 0.01'].join('\n'),
    );
    expect(off.parseState.tsCorrelationEnabled).toBe(false);
  });

  it('parses robust directives', () => {
    const parsed = parseInput(
      ['.ROBUST HUBER 1.8', 'C A 0 0 0 !', 'C B 100 0 0', 'D A-B 100 0.01'].join('\n'),
    );
    expect(parsed.parseState.robustMode).toBe('huber');
    expect(parsed.parseState.robustK).toBeCloseTo(1.8, 8);

    const off = parseInput(
      ['.ROBUST OFF', 'C A 0 0 0 !', 'C B 100 0 0', 'D A-B 100 0.01'].join('\n'),
    );
    expect(off.parseState.robustMode).toBe('none');
  });

  it('parses sideshot with explicit azimuth token', () => {
    const parsed = parseInput(
      [
        'C OCC 0 0 0 !',
        'C BS 0 100 0 !',
        'TB OCC BS',
        'SS OCC SH AZ=090-00-00.0 10.0 90.0 5.0 0.002',
      ].join('\n'),
    );
    const ssDist = parsed.observations.find((o) => o.type === 'dist' && o.setId === 'SS');
    expect(ssDist).toBeDefined();
    expect(typeof ssDist?.calc).toBe('object');
    expect((ssDist?.calc as { azimuthObs?: number })?.azimuthObs).toBeDefined();
  });

  it('parses sideshot with setup horizontal angle token', () => {
    const parsed = parseInput(
      [
        'C OCC 0 0 0 !',
        'C BS 0 100 0 !',
        'TB OCC BS',
        'SS OCC SH HZ=090-00-00.0 10.0 90.0 5.0 0.002',
      ].join('\n'),
    );
    const ssDist = parsed.observations.find((o) => o.type === 'dist' && o.setId === 'SS');
    expect(ssDist).toBeDefined();
    expect(typeof ssDist?.calc).toBe('object');
    expect((ssDist?.calc as { hzObs?: number })?.hzObs).toBeDefined();
    expect((ssDist?.calc as { backsightId?: string })?.backsightId).toBe('BS');
  });

  it('applies explicit .ALIAS mappings to station and observation IDs', () => {
    const parsed = parseInput(
      ['.2D', '.ALIAS P1=A1 Q1=B1', 'C A1 0 0 0 !', 'C B1 100 0 0 !', 'D P1-Q1 100 0.01'].join(
        '\n',
      ),
    );
    const dist = parsed.observations.find((o) => o.type === 'dist');
    expect(dist).toBeDefined();
    expect(dist?.type).toBe('dist');
    if (dist?.type === 'dist') {
      expect(dist.from).toBe('A1');
      expect(dist.to).toBe('B1');
    }
    expect(parsed.stations.P1).toBeUndefined();
    expect(parsed.stations.Q1).toBeUndefined();
    expect(parsed.stations.A1).toBeDefined();
    expect(parsed.stations.B1).toBeDefined();
    expect(parsed.parseState.aliasExplicitCount).toBe(2);
    expect(parsed.parseState.aliasRuleCount).toBe(0);
    expect(parsed.parseState.aliasExplicitMappings?.map((m) => `${m.sourceId}->${m.canonicalId}`)).toEqual([
      'P1->A1',
      'Q1->B1',
    ]);
    expect(parsed.parseState.aliasTrace?.some((t) => t.context === 'observation' && t.sourceLine === 5)).toBe(
      true,
    );
    expect(parsed.logs.some((l) => l.includes('Alias canonicalization applied'))).toBe(true);
  });

  it('applies .ALIAS prefix/suffix/additive rules to canonical IDs', () => {
    const parsed = parseInput(
      [
        '.2D',
        '.ALIAS PREFIX RAW_ SURV_',
        '.ALIAS SUFFIX _OLD _NEW',
        '.ALIAS ADDITIVE 100',
        'C SURV_1_NEW 0 0 0 !',
        'C 105 100 0 0 !',
        'D RAW_1_OLD-5 100 0.01',
      ].join('\n'),
    );
    const dist = parsed.observations.find((o) => o.type === 'dist');
    expect(dist).toBeDefined();
    expect(dist?.type).toBe('dist');
    if (dist?.type === 'dist') {
      expect(dist.from).toBe('SURV_1_NEW');
      expect(dist.to).toBe('105');
    }
    expect(parsed.stations.RAW_1_OLD).toBeUndefined();
    expect(parsed.stations['5']).toBeUndefined();
    expect(parsed.stations.SURV_1_NEW).toBeDefined();
    expect(parsed.stations['105']).toBeDefined();
    expect(parsed.parseState.aliasExplicitCount).toBe(0);
    expect(parsed.parseState.aliasRuleCount).toBe(3);
    expect(parsed.parseState.aliasRuleSummaries?.map((r) => r.rule)).toEqual([
      'PREFIX RAW_ SURV_',
      'SUFFIX _OLD _NEW',
      'ADDITIVE 100',
    ]);
    expect(
      parsed.parseState.aliasTrace?.some(
        (t) => t.sourceLine === 7 && t.sourceId === 'RAW_1_OLD' && t.canonicalId === 'SURV_1_NEW',
      ),
    ).toBe(true);
    expect(
      parsed.parseState.aliasTrace?.some(
        (t) => t.sourceLine === 7 && t.sourceId === '5' && t.canonicalId === '105',
      ),
    ).toBe(true);
  });

  it('tracks mixed conventional/GNSS/leveling alias traceability across input sections', () => {
    const parsed = parseInput(readFileSync('tests/fixtures/alias_phase4_mixed.dat', 'utf-8'));
    expect(parsed.parseState.aliasExplicitCount).toBe(2);
    expect(parsed.parseState.aliasRuleCount).toBe(1);
    expect(parsed.parseState.aliasExplicitMappings?.map((m) => `${m.sourceId}->${m.canonicalId}`)).toEqual([
      'ROVER1->PT_100',
      'STA01->STA_1',
    ]);
    expect(parsed.parseState.aliasRuleSummaries?.map((r) => r.rule)).toEqual(['PREFIX TMP_ PT_']);

    expect(parsed.stations.PT_100).toBeDefined();
    expect(parsed.stations.TMP_100).toBeUndefined();
    expect(parsed.stations.ROVER1).toBeUndefined();
    expect(parsed.stations.STA01).toBeUndefined();

    const dist = parsed.observations.find((o) => o.type === 'dist');
    const angle = parsed.observations.find((o) => o.type === 'angle') as AngleObservation | undefined;
    const gps = parsed.observations.find((o) => o.type === 'gps');
    const lev = parsed.observations.find((o) => o.type === 'lev');
    expect(dist?.type).toBe('dist');
    if (dist?.type === 'dist') {
      expect(dist.from).toBe('CTRL_B');
      expect(dist.to).toBe('PT_100');
    }
    expect(angle?.to).toBe('PT_100');
    expect(gps?.type).toBe('gps');
    if (gps?.type === 'gps') {
      expect(gps.from).toBe('CTRL_A');
      expect(gps.to).toBe('PT_100');
    }
    expect(lev?.type).toBe('lev');
    if (lev?.type === 'lev') {
      expect(lev.from).toBe('STA_1');
      expect(lev.to).toBe('PT_100');
    }

    const trace = parsed.parseState.aliasTrace ?? [];
    expect(trace.some((t) => t.context === 'observation' && t.sourceLine === 10)).toBe(true);
    expect(trace.some((t) => t.context === 'observation' && t.sourceLine === 11)).toBe(true);
    expect(trace.some((t) => t.context === 'observation' && t.sourceLine === 12)).toBe(true);
    expect(trace.some((t) => t.context === 'observation' && t.sourceLine === 13)).toBe(true);
    expect(trace.some((t) => t.context === 'station' && t.sourceId === 'TMP_100')).toBe(true);
  });

  it('scans repeated station descriptions and reports consistent repeats', () => {
    const parsed = parseInput(
      [
        "C A 0 0 0 ! ! ! 'CONTROL POINT A",
        "E A 100.0 0.01 ! 'CONTROL POINT A",
        'D A-B 100.0 0.01',
      ].join('\n'),
    );
    const summary = parsed.parseState.descriptionScanSummary ?? [];
    expect(parsed.parseState.descriptionTrace).toHaveLength(2);
    expect(parsed.parseState.descriptionRepeatedStationCount).toBe(1);
    expect(parsed.parseState.descriptionConflictCount).toBe(0);
    expect(summary).toHaveLength(1);
    expect(summary[0]).toMatchObject({
      stationId: 'A',
      recordCount: 2,
      uniqueCount: 1,
      conflict: false,
      descriptions: ['CONTROL POINT A'],
    });
    expect(parsed.parseState.descriptionReconcileMode).toBe('first');
    expect(parsed.parseState.reconciledDescriptions?.A).toBe('CONTROL POINT A');
    expect(parsed.logs.some((line) => line.includes('Description scan:'))).toBe(true);
  });

  it('groups description scan rows by canonical station id and flags conflicts', () => {
    const parsed = parseInput(
      [
        '.ALIAS LEGACY_A=A',
        "C A 0 0 0 ! ! ! 'Alpha",
        "E A 100.0 0.01 ! 'ALPHA",
        "C LEGACY_A 0 0 0 ! ! ! 'Legacy Alpha",
        "E A 100.0 0.01 ! 'Beta",
      ].join('\n'),
    );
    const trace = parsed.parseState.descriptionTrace ?? [];
    const summary = parsed.parseState.descriptionScanSummary ?? [];
    expect(trace).toHaveLength(4);
    expect(trace.every((row) => row.stationId === 'A')).toBe(true);
    expect(parsed.parseState.descriptionRepeatedStationCount).toBe(1);
    expect(parsed.parseState.descriptionConflictCount).toBe(1);
    expect(summary).toHaveLength(1);
    expect(summary[0]).toMatchObject({
      stationId: 'A',
      recordCount: 4,
      uniqueCount: 3,
      conflict: true,
      descriptions: ['Alpha', 'Legacy Alpha', 'Beta'],
    });
    expect(parsed.parseState.reconciledDescriptions?.A).toBe('Alpha');
    expect(parsed.logs.some((line) => line.includes('Description conflict A'))).toBe(true);
  });

  it('supports .DESC and /DESC append reconciliation with custom delimiter', () => {
    const parsed = parseInput(
      [
        '.DESC FIRST',
        '/DESC APPEND ::',
        "C A 0 0 0 ! ! ! 'Alpha",
        "E A 100.0 0.01 ! 'ALPHA",
        "E A 100.0 0.01 ! 'Beta",
        "E A 100.0 0.01 ! 'Gamma",
      ].join('\n'),
    );
    expect(parsed.parseState.descriptionReconcileMode).toBe('append');
    expect(parsed.parseState.descriptionAppendDelimiter).toBe('::');
    expect(parsed.parseState.reconciledDescriptions?.A).toBe('Alpha::Beta::Gamma');
    expect(parsed.logs.some((line) => line.includes('Description reconciliation set to APPEND'))).toBe(
      true,
    );
  });
});
