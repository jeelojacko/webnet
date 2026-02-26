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
});
