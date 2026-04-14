import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseInput } from '../src/engine/parse';
import { INDUSTRY_PARITY_CASES } from '../src/industryParityCases';
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

  it('parses quoted instrument descriptions without shifting numeric fields', () => {
    const parsed = parseInput('I S9 "industry standard S9 0.5" 0.001 1 0.5 0.5 0.00075 0');
    const s9 = parsed.instrumentLibrary.S9;
    expect(s9).toBeDefined();
    expect(s9.desc).toBe('industry standard S9 0.5');
    expect(s9.edm_const).toBeCloseTo(0.001, 12);
    expect(s9.edm_ppm).toBeCloseTo(1, 12);
    expect(s9.hzPrecision_sec).toBeCloseTo(0.5, 12);
    expect(s9.vaPrecision_sec).toBeCloseTo(0.5, 12);
    expect(s9.dirPrecision_sec).toBeCloseTo(0.5, 12);
    expect(s9.azBearingPrecision_sec).toBeCloseTo(0.5, 12);
    expect(s9.instCentr_m).toBeCloseTo(0.00075, 12);
    expect(s9.tgtCentr_m).toBeCloseTo(0, 12);
  });

  it('upgrades auto-created bearing endpoints to the later explicit grid coordinate class', () => {
    const parsed = parseInput(
      ['B GPS5-GPS2 323-9-42.23 6.74', 'C GPS2 100 200 10', 'C GPS5 300 400 20'].join('\n'),
      {},
      {
        coordMode: '3D',
        coordSystemMode: 'grid',
        crsId: 'CA_NAD83_CSRS_NB_STEREO_DOUBLE',
        order: 'NE',
      },
    );

    expect(parsed.stations.GPS2.coordInputClass).toBe('grid');
    expect(parsed.stations.GPS5.coordInputClass).toBe('grid');
    expect(parsed.stations.GPS2.x).toBeCloseTo(200, 12);
    expect(parsed.stations.GPS2.y).toBeCloseTo(100, 12);
    expect(parsed.stations.GPS5.x).toBeCloseTo(400, 12);
    expect(parsed.stations.GPS5.y).toBeCloseTo(300, 12);
    expect(
      parsed.logs.some(
        (line) =>
          line.includes('station GPS2 has mixed coordinate classes') ||
          line.includes('station GPS5 has mixed coordinate classes'),
      ),
    ).toBe(false);
  });

  it('applies .INST instrument selection to subsequent direction-set observations', () => {
    const parsed = parseInput(
      [
        'I TRAV_DEFAULT "Traverse Default" 0.001 1.5 1.414 1 0.00075 0.00075 0 1.5 1 1.414 0.0005 0.01524 0',
        'I SX12 "SX12" 0.003 1.5 0.950079 6.064437 0.0015 0.0015 0 0 0.671807 1.414 0.0005 0.01524 0',
        'I S9 "S9" 0.003 2 1.2357 3.28473 0.0015 0.0015 0 0 0.87377 0.707107 0.0005 0.01524 0',
        '.INST SX12',
        'DB 100',
        'DM 101 0-0-0 25.0000 90-00-00',
        'DE',
        '.INST S9',
        'DB 200',
        'DM 201 0-0-0 30.0000 90-00-00',
        'DE',
      ].join('\n'),
    );

    const distanceObs = parsed.observations.filter(
      (observation): observation is DistanceObservation => observation.type === 'dist',
    );
    const zenithObs = parsed.observations.filter((observation) => observation.type === 'zenith');

    expect(distanceObs.map((observation) => observation.instCode)).toEqual(['SX12', 'S9']);
    expect(zenithObs.map((observation) => observation.instCode)).toEqual(['SX12', 'S9']);
    expect(parsed.logs.filter((entry) => entry.includes('Current instrument set to'))).toEqual([
      'Current instrument set to SX12',
      'Current instrument set to S9',
    ]);
  });

  it('keeps DM sigma tokens aligned by measurement slot when defaults and explicit values are mixed', () => {
    const parsed = parseInput(
      [
        'I TS1 "Traverse Test" 0.001 2 1.5 7.5 0.00075 0.00075 0 0',
        '.INST TS1',
        'C 104 0 0 0 ! ! !',
        'C PEAT 10 10 10',
        'DB 104',
        'DM PEAT 301-35-57.6 30.1874 92-29-12.58 & & 30',
        'DE',
      ].join('\n'),
    );

    const direction = parsed.observations.find((observation) => observation.type === 'direction');
    const distance = parsed.observations.find(
      (observation): observation is DistanceObservation => observation.type === 'dist',
    );
    const zenith = parsed.observations.find((observation) => observation.type === 'zenith');

    expect(direction?.sigmaSource).toBe('default');
    expect(direction?.stdDev).toBeCloseTo((1.5 * Math.PI) / (180 * 3600), 12);

    expect(distance?.sigmaSource).toBe('default');
    expect(distance?.stdDev).toBeCloseTo(0.001 + 2e-6 * 30.1874, 12);

    expect(zenith?.sigmaSource).toBe('explicit');
    expect(zenith?.stdDev).toBeCloseTo((30 * Math.PI) / (180 * 3600), 12);
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
    expect(lev.stdDev).toBeCloseTo(0.000221359, 6); // 0.7 mm/km * sqrt(0.1 km)
    expect(levelOnly.logs.some((l) => l.includes('.LWEIGHT applied'))).toBe(true);
  });

  it('applies .LWEIGHT fallback to non-L delta-mode leveling paths when sigma is omitted', () => {
    const parsed = parseInput(
      [
        '.DELTA ON',
        '.LWEIGHT 1.0',
        'C A 0 0 0 ! ! !',
        'C B 100 0 0',
        'C C 200 0 0',
        'DV A-B 100 0.25',
        'M A-B-C 090-00-00 100 0.10',
      ].join('\n'),
    );
    const dvLev = parsed.observations.find(
      (o) => o.type === 'lev' && o.from === 'A' && o.to === 'B',
    ) as LevelObservation | undefined;
    const mLev = parsed.observations.find(
      (o) => o.type === 'lev' && o.from === 'A' && o.to === 'C',
    ) as LevelObservation | undefined;
    expect(dvLev).toBeDefined();
    expect(mLev).toBeDefined();
    expect(dvLev?.stdDev ?? Number.NaN).toBeCloseTo(0.0001, 10); // 1.0 mm/km over 0.1 km
    expect(mLev?.stdDev ?? Number.NaN).toBeCloseTo(0.0001, 10); // 1.0 mm/km over 0.1 km
    expect(parsed.logs.some((line) => line.includes('.LWEIGHT fallback applied for DV'))).toBe(
      true,
    );
    expect(parsed.logs.some((line) => line.includes('.LWEIGHT fallback applied for M'))).toBe(true);
  });

  it('treats per-component * control markers as free and clears weighted constraints', () => {
    const parsed = parseInput(
      [
        '.3D',
        'C A 1000 2000 50 0.010 0.020 0.030 ! *',
        'C B 1005 2005 55 0.030 0.040 0.050 * !',
      ].join('\n'),
    );
    const a = parsed.stations.A;
    const b = parsed.stations.B;

    expect(a.fixedX).toBe(true);
    expect(a.fixedY ?? false).toBe(false);
    expect(a.constraintX).toBeUndefined();
    expect(a.sx).toBeUndefined();
    expect(a.constraintY).toBeUndefined();
    expect(a.sy).toBeUndefined();
    expect(a.constraintH).toBeCloseTo(a.h, 10);
    expect(a.sh).toBeCloseTo(0.03, 10);
    expect(a.constraintModeX).toBe('fixed');
    expect(a.constraintModeY).toBe('free');
    expect(a.constraintModeH).toBe('weighted');

    expect(b.fixedY).toBe(true);
    expect(b.fixedX ?? false).toBe(false);
    expect(b.constraintY).toBeUndefined();
    expect(b.sy).toBeUndefined();
    expect(b.constraintX).toBeUndefined();
    expect(b.sx).toBeUndefined();
    expect(b.constraintH).toBeCloseTo(b.h, 10);
    expect(b.sh).toBeCloseTo(0.05, 10);
    expect(b.constraintModeY).toBe('fixed');
    expect(b.constraintModeX).toBe('free');
    expect(b.constraintModeH).toBe('weighted');

    expect(
      parsed.logs.some((line) => line.includes('Free-marker control components at line 2')),
    ).toBe(true);
  });

  it('uses free markers to release prior fixed or weighted control components on later records', () => {
    const parsed = parseInput(
      [
        '.2D',
        'C A 1000 2000 0.010 0.020 ! !',
        'C A 1000 2000 0.010 0.020 * *',
      ].join('\n'),
    );
    const a = parsed.stations.A;

    expect(a.fixed).toBe(false);
    expect(a.fixedX ?? false).toBe(false);
    expect(a.fixedY ?? false).toBe(false);
    expect(a.constraintX).toBeUndefined();
    expect(a.constraintY).toBeUndefined();
    expect(a.sx).toBeUndefined();
    expect(a.sy).toBeUndefined();
    expect(a.constraintModeX).toBe('free');
    expect(a.constraintModeY).toBe('free');
  });

  it('expands packed control fixity markers across components', () => {
    const parsed = parseInput(['.3D', 'C A 1000 2000 50 0.010 0.020 0.030 !!*'].join('\n'));
    const a = parsed.stations.A;

    expect(a.fixedX).toBe(true);
    expect(a.fixedY).toBe(true);
    expect(a.fixedH ?? false).toBe(false);
    expect(a.constraintModeX).toBe('fixed');
    expect(a.constraintModeY).toBe('fixed');
    expect(a.constraintModeH).toBe('free');
  });

  it('parses configurable level-loop tolerance settings', () => {
    const parsed = parseInput(['.LEVELTOL BASE 1.5 K 6.0', 'C A 0 0 0 ! ! !'].join('\n'));
    expect(parsed.parseState.levelLoopToleranceBaseMm).toBeCloseTo(1.5, 8);
    expect(parsed.parseState.levelLoopTolerancePerSqrtKmMm).toBeCloseTo(6.0, 8);
    expect(parsed.logs.some((l) => l.includes('Level-loop tolerance set'))).toBe(true);
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

  it('keeps traverse startup direction-set observations on one global ID stream and active set IDs', () => {
    const startup = INDUSTRY_PARITY_CASES.traverse.startupDefaults!;
    const parsed = parseInput(startup.input, {}, startup.parseSettingsPatch);
    const observationIds = parsed.observations.map((observation) => observation.id);
    const uniqueObservationIds = new Set(observationIds);

    expect(uniqueObservationIds.size).toBe(observationIds.length);

    const setScopedDistance = parsed.observations.find(
      (observation) =>
        observation.type === 'dist' &&
        observation.setId != null &&
        observation.setId !== 'DM' &&
        'from' in observation &&
        observation.from === '100' &&
        observation.to === 'PEAT',
    );
    expect(setScopedDistance).toBeDefined();
    expect(setScopedDistance?.setId).toBe('100#1');
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

  it('keeps D-record token roles stable so numeric measurements do not become station ids', () => {
    const parsed = parseInput(
      [
        'I TS1 "Demo" 0.001 1 1.0 1.0 0 0',
        'C 1000 0 0 0 ! ! !',
        'C 2000 10 0 0',
        'D TS1 SET1 1000 2000 123.456 0.01',
      ].join('\n'),
    );
    const dist = parsed.observations.find((obs) => obs.type === 'dist') as
      | DistanceObservation
      | undefined;
    expect(dist).toBeDefined();
    expect(dist?.from).toBe('1000');
    expect(dist?.to).toBe('2000');
    expect(parsed.stations['123.456']).toBeUndefined();
    expect(parsed.parseState.ambiguousCount).toBe(0);
  });

  it('applies strict-vs-legacy numeric-token station handling with coded diagnostics', () => {
    const source = [
      'I TS1 "Demo" 0.001 1 1.0 1.0 0 0',
      'C A 0 0 0 ! ! !',
      'C B 10 0 0',
      'D TS1 100.500 B 12.300 0.01',
    ].join('\n');
    const legacy = parseInput(source, {}, { parseCompatibilityMode: 'legacy' });
    const strict = parseInput(source, {}, { parseCompatibilityMode: 'strict' });
    expect(legacy.observations.filter((obs) => obs.type === 'dist')).toHaveLength(1);
    expect(legacy.parseState.strictRejectCount).toBe(0);
    expect(
      legacy.parseState.parseCompatibilityDiagnostics?.some(
        (diag) => diag.code === 'NUMERIC_STATION_TOKEN_REJECTED',
      ),
    ).toBe(true);
    expect(strict.observations.filter((obs) => obs.type === 'dist')).toHaveLength(0);
    expect(strict.parseState.strictRejectCount).toBeGreaterThan(0);
    expect(
      strict.parseState.parseCompatibilityDiagnostics?.some(
        (diag) => diag.code === 'NUMERIC_STATION_TOKEN_REJECTED' && diag.severity === 'error',
      ),
    ).toBe(true);
    expect(strict.parseState.rewriteSuggestionCount).toBeGreaterThan(0);
  });

  it('applies strict-vs-legacy unknown-inline handling without legacy policy overrides', () => {
    const source = ['.ZZZZ', 'C A 0 0 0 ! !'].join('\n');
    const legacy = parseInput(source, {}, { parseCompatibilityMode: 'legacy' });
    const strict = parseInput(source, {}, { parseCompatibilityMode: 'strict' });

    expect(legacy.parseState.strictRejectCount).toBe(0);
    expect(
      legacy.parseState.parseCompatibilityDiagnostics?.some(
        (diag) => diag.code === 'STRICT_REJECTED' && diag.severity === 'warning',
      ),
    ).toBe(true);
    expect(legacy.logs.some((line) => line.includes('unknown inline option ".ZZZZ"'))).toBe(true);

    expect(strict.parseState.strictRejectCount).toBeGreaterThan(0);
    expect(
      strict.parseState.parseCompatibilityDiagnostics?.some(
        (diag) =>
          diag.code === 'STRICT_REJECTED' &&
          diag.severity === 'error' &&
          diag.message.includes('unknown inline option ".ZZZZ"'),
      ),
    ).toBe(true);
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

  it('reduces 2D slope M distances to horizontal when a zenith is provided', () => {
    const parsed = parseInput(
      [
        '.2D',
        '.DELTA OFF',
        'C 1 0 0 !',
        'C 1000 0 10 !',
        'C 2 20 0',
        'M 1-1000-2 286-51-24.7 22.2574 089-57-23.8',
      ].join('\n'),
    );
    const distObs = parsed.observations.find(
      (o) => o.type === 'dist' && 'from' in o && o.from === '1' && o.to === '2',
    );
    expect(distObs).toBeDefined();
    expect(distObs?.obs).toBeCloseTo(
      22.2574 * Math.sin((89 + 57 / 60 + 23.8 / 3600) * (Math.PI / 180)),
      9,
    );
    expect(parsed.observations.some((o) => o.type === 'zenith')).toBe(false);
  });

  it('accepts hyphenated from-to vertical records in the same way as split tokens', () => {
    const parsed = parseInput(
      [
        '.3D',
        '.DELTA OFF',
        'C 2 0 0 0 ! ! !',
        'C 2000 10 0 0',
        'V 2-2000 279-34-03.2 1.6920/0.0000',
      ].join('\n'),
    );
    const vertical = parsed.observations.find(
      (obs) => obs.type === 'zenith' && 'from' in obs && obs.from === '2' && obs.to === '2000',
    );
    expect(vertical).toBeDefined();
    expect(vertical?.obs ?? Number.NaN).toBeCloseTo(
      ((279 + 34 / 60 + 3.2 / 3600) * Math.PI) / 180,
      12,
    );
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

  it('expands .INCLUDE content from include bundle files and tracks source file traceability', () => {
    const parsed = parseInput(
      ['.UNITS M', '.INCLUDE child/network1.dat', 'C A 0 0 0 ! !', 'C B 10 0 0', 'D A-B 10'].join(
        '\n',
      ),
      {},
      {
        sourceFile: 'main/project.dat',
        includeFiles: {
          'main/child/network1.dat': 'C X 0 10 0 ! !\nC Y 10 10 0\nD X-Y 10',
        },
      },
    );
    expect(parsed.parseState.includeTrace?.length).toBe(1);
    expect(parsed.parseState.includeTrace?.[0].parentSourceFile).toBe('main/project.dat');
    expect(parsed.parseState.includeTrace?.[0].sourceFile).toBe('main/child/network1.dat');
    const fromInclude = parsed.observations.find(
      (obs) => 'from' in obs && 'to' in obs && obs.from === 'X' && obs.to === 'Y',
    );
    expect(fromInclude?.sourceFile).toBe('main/child/network1.dat');
  });

  it('restores parent parse-state after include scope exits', () => {
    const parsed = parseInput(
      ['.UNITS FT', '.INCLUDE child/set.dat', 'C A 0 0 0 ! !', 'C B 10 0 0', 'D A-B 10'].join('\n'),
      {},
      {
        sourceFile: 'main/project.dat',
        includeFiles: {
          'main/child/set.dat': '.UNITS M\nC X 0 10 0 ! !\nC Y 10 10 0\nD X-Y 10',
        },
      },
    );
    const includeDist = parsed.observations.find(
      (obs) => 'from' in obs && 'to' in obs && obs.from === 'X' && obs.to === 'Y',
    );
    const parentDist = parsed.observations.find(
      (obs) => 'from' in obs && 'to' in obs && obs.from === 'A' && obs.to === 'B',
    );
    expect(includeDist?.obs).toBeCloseTo(10, 8);
    expect(parentDist?.obs).toBeCloseTo(10 / 3.280839895, 8);
    expect(parsed.parseState.units).toBe('ft');
  });

  it('captures include errors for missing include files', () => {
    const parsed = parseInput(
      ['.INCLUDE field/does-not-exist.dat', 'C A 0 0 0 ! !'].join('\n'),
      {},
      { sourceFile: 'main/project.dat', includeFiles: {} },
    );
    expect(parsed.parseState.includeErrors?.length).toBe(1);
    expect(parsed.parseState.includeErrors?.[0].code).toBe('include-not-found');
    expect(parsed.parseState.includeErrors?.[0].sourceFile).toBe('main/project.dat');
    expect(parsed.parseState.includeErrors?.[0].line).toBe(1);
  });

  it('resolves nested include relative paths in bundle mode and preserves include order', () => {
    const parsed = parseInput(
      ['.INCLUDE section/first.dat', '.INCLUDE section/second.dat', 'C ROOT 0 0 0 ! !'].join('\n'),
      {},
      {
        sourceFile: 'main/project.dat',
        includeFiles: {
          'main/section/first.dat':
            'C F1 0 10 0 ! !\n.INCLUDE ../shared/grand.dat\nC F2 10 10 0\nD F1-F2 10',
          'main/shared/grand.dat': 'C G1 0 20 0 ! !\nC G2 10 20 0\nD G1-G2 10',
          'main/section/second.dat': 'C S1 0 30 0 ! !\nC S2 10 30 0\nD S1-S2 10',
        },
      },
    );

    expect(parsed.parseState.includeErrors).toEqual([]);
    expect(parsed.parseState.includeTrace).toEqual([
      {
        parentSourceFile: 'main/project.dat',
        sourceFile: 'main/section/first.dat',
        line: 1,
      },
      {
        parentSourceFile: 'main/section/first.dat',
        sourceFile: 'main/shared/grand.dat',
        line: 2,
      },
      {
        parentSourceFile: 'main/project.dat',
        sourceFile: 'main/section/second.dat',
        line: 2,
      },
    ]);

    const findDistIndex = (from: string, to: string): number =>
      parsed.observations.findIndex(
        (obs) =>
          obs.type === 'dist' && 'from' in obs && 'to' in obs && obs.from === from && obs.to === to,
      );
    const nestedDistIndex = findDistIndex('G1', 'G2');
    const firstDistIndex = findDistIndex('F1', 'F2');
    const secondDistIndex = findDistIndex('S1', 'S2');
    expect(nestedDistIndex).toBeGreaterThan(-1);
    expect(firstDistIndex).toBeGreaterThan(-1);
    expect(secondDistIndex).toBeGreaterThan(-1);
    expect(nestedDistIndex).toBeLessThan(firstDistIndex);
    expect(firstDistIndex).toBeLessThan(secondDistIndex);
  });

  it('captures include cycle errors with exact source file and line diagnostics', () => {
    const parsed = parseInput(
      ['.INCLUDE a.dat', 'C ROOT 0 0 0 ! !'].join('\n'),
      {},
      {
        sourceFile: 'main/project.dat',
        includeFiles: {
          'main/a.dat': '.INCLUDE b.dat\nC A 0 10 0 ! !',
          'main/b.dat': '.INCLUDE a.dat\nC B 10 10 0',
        },
      },
    );

    expect(parsed.parseState.includeErrors?.length).toBe(1);
    expect(parsed.parseState.includeErrors?.[0].code).toBe('include-cycle');
    expect(parsed.parseState.includeErrors?.[0].sourceFile).toBe('main/b.dat');
    expect(parsed.parseState.includeErrors?.[0].line).toBe(1);
    expect(parsed.parseState.includeErrors?.[0].includePath).toBe('a.dat');
    expect(parsed.parseState.includeErrors?.[0].stack).toEqual([
      'main/project.dat',
      'main/a.dat',
      'main/b.dat',
      'main/a.dat',
    ]);
  });

  it('captures include depth-exceeded errors with exact source file and line diagnostics', () => {
    const parsed = parseInput(
      ['.INCLUDE a.dat', 'C ROOT 0 0 0 ! !'].join('\n'),
      {},
      {
        sourceFile: 'main/project.dat',
        includeMaxDepth: 2,
        includeFiles: {
          'main/a.dat': '.INCLUDE b.dat\nC A 0 10 0 ! !',
          'main/b.dat': 'C B 10 10 0',
        },
      },
    );

    expect(parsed.parseState.includeErrors?.length).toBe(1);
    expect(parsed.parseState.includeErrors?.[0].code).toBe('include-depth-exceeded');
    expect(parsed.parseState.includeErrors?.[0].sourceFile).toBe('main/a.dat');
    expect(parsed.parseState.includeErrors?.[0].line).toBe(1);
    expect(parsed.parseState.includeErrors?.[0].includePath).toBe('b.dat');
    expect(parsed.parseState.includeErrors?.[0].message).toContain('limit=2');
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

    const dist = parsed.observations.find((obs) => obs.type === 'dist') as
      | DistanceObservation
      | undefined;
    const angle = parsed.observations.find((obs) => obs.type === 'angle') as
      | AngleObservation
      | undefined;
    expect(dist?.obs ?? Number.NaN).toBe(0);
    expect(angle?.obs ?? Number.NaN).toBe(0);
  });

  it('treats missing D and A observation values as planned rows in preanalysis mode', () => {
    const parsed = parseInput(
      [
        '.2D',
        'C 1 51002 101009 ! !',
        'C 2 51005 101343',
        'C 3 51328 101291',
        'C 4 51416 101073',
        'D 1-2',
        'D 2-3',
        'D 3-4',
        'D 4-1',
        'D 1-3',
        'A 2-1-3',
        'A 3-2-4',
        'A 4-3-1',
        'A 1-4-2',
        'A 1-4-3',
        'B 1-2 ? !',
      ].join('\n'),
      {},
      { preanalysisMode: true, coordMode: '2D' },
    );

    expect(parsed.parseState.preanalysisMode).toBe(true);
    expect(parsed.parseState.plannedObservationCount).toBe(11);
    expect(parsed.observations.filter((obs) => obs.type === 'dist')).toHaveLength(5);
    expect(parsed.observations.filter((obs) => obs.type === 'angle')).toHaveLength(5);
    expect(parsed.observations.filter((obs) => obs.type === 'bearing')).toHaveLength(1);
    expect(parsed.observations.every((obs) => obs.planned === true)).toBe(true);
  });

  it('keeps CRS transforms disabled by default and parses .CRS state directives', () => {
    const base = parseInput(
      ['.UNITS METERS DD', 'P ORG 40 105 0 ! !', 'P TGT 41 106 0'].join('\n'),
    );
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

  it('parses .SCALE and grid/measured observation mode directives', () => {
    const parsed = parseInput(
      [
        '.2D',
        '.SCALE 0.99995000',
        '.GRID BEARING DISTANCE=ELLIPSOIDAL ANGLE DIRECTION',
        '.MEASURED DIRECTION',
        'C A 0 0 0 ! !',
        'C B 100 0 0 ! !',
        'C C 100 100 0',
        'B A-B 090.000000 1.0',
        'D A-C 141.421356 0.01',
        'A B-A-C 090.000000 1.0',
      ].join('\n'),
    );
    expect(parsed.parseState.averageScaleFactor).toBeCloseTo(0.99995, 10);
    expect(parsed.parseState.scaleOverrideActive).toBe(true);
    expect(parsed.parseState.gridBearingMode).toBe('grid');
    expect(parsed.parseState.gridDistanceMode).toBe('ellipsoidal');
    expect(parsed.parseState.gridAngleMode).toBe('grid');
    expect(parsed.parseState.gridDirectionMode).toBe('measured');
    expect(parsed.parseState.reductionContext).toEqual({
      inputSpaceDefault: 'grid',
      distanceKind: 'ellipsoidal',
      bearingKind: 'grid',
      explicitOverrideActive: true,
    });
    expect(parsed.parseState.observationMode).toEqual({
      bearing: 'grid',
      distance: 'ellipsoidal',
      angle: 'grid',
      direction: 'measured',
    });

    const bearing = parsed.observations.find((o) => o.type === 'bearing');
    const dist = parsed.observations.find((o) => o.type === 'dist');
    const angle = parsed.observations.find((o) => o.type === 'angle');
    expect(bearing?.gridObsMode).toBe('grid');
    expect(dist?.gridObsMode).toBe('grid');
    expect(dist?.gridDistanceMode).toBe('ellipsoidal');
    expect(dist?.inputSpace).toBe('grid');
    expect(dist?.distanceKind).toBe('ellipsoidal');
    expect(angle?.gridObsMode).toBe('grid');
  });

  it('supports .GRID OFF reset semantics for observation mode defaults', () => {
    const parsed = parseInput(
      [
        '.GRID BEARING DISTANCE=ELLIPSOIDAL ANGLE DIRECTION',
        '.GRID OFF',
        'C A 0 0 0 ! !',
        'C B 10 0 0',
        'D A-B 10 0.01',
      ].join('\n'),
    );
    expect(parsed.parseState.gridBearingMode).toBe('grid');
    expect(parsed.parseState.gridDistanceMode).toBe('measured');
    expect(parsed.parseState.gridAngleMode).toBe('measured');
    expect(parsed.parseState.gridDirectionMode).toBe('measured');
    expect(parsed.parseState.observationMode).toEqual({
      bearing: 'grid',
      distance: 'measured',
      angle: 'measured',
      direction: 'measured',
    });
    expect(parsed.logs.some((line) => line.includes('mode reset to defaults'))).toBe(true);
  });

  it('tracks directive ranges and no-effect warnings for trailing directives', () => {
    const parsed = parseInput(
      ['.2D', '.GRID', 'C A 0 0 0 ! !', 'C B 10 0 0', 'D A-B 10 0.01', '.MEASURED'].join('\n'),
    );
    const dist = parsed.observations.find((obs) => obs.type === 'dist');
    expect(dist?.gridDistanceMode).toBe('grid');
    expect(parsed.parseState.gridDistanceMode).toBe('measured');
    expect(parsed.parseState.directiveTransitions?.length).toBe(2);
    expect(parsed.parseState.directiveTransitions?.[0].obsCountInRange).toBe(1);
    expect(parsed.parseState.directiveTransitions?.[1].obsCountInRange).toBe(0);
    expect(parsed.parseState.directiveNoEffectWarnings).toEqual([
      {
        line: 6,
        directive: '.MEASURED',
        reason: 'noSubsequentObservations',
      },
    ]);
    expect(parsed.parseState.parsedUsageSummary?.distance.grid).toBe(1);
    expect(parsed.parseState.parsedUsageSummary?.total).toBe(1);
  });

  it('warns when directives are followed by non-observation records only', () => {
    const parsed = parseInput(
      [
        '.2D',
        '.GRID',
        'C A 0 0 0 ! !',
        'C B 10 0 0',
        'D A-B 10 0.01',
        '.MEASURED',
        'C C 20 0 0',
      ].join('\n'),
    );
    const warning = parsed.parseState.directiveNoEffectWarnings?.[0];
    expect(warning).toBeDefined();
    expect(warning?.reason).toBe('noSubsequentObsRecords');
  });

  it('supports .CRS MODE/ID and .CRS GRID <id> aliases for coordinate-system selection', () => {
    const viaModeId = parseInput(
      ['.CRS MODE GRID', '.CRS ID CA_NAD83_CSRS_UTM_19N', 'C A 0 0 0 ! !'].join('\n'),
    );
    expect(viaModeId.parseState.coordSystemMode).toBe('grid');
    expect(viaModeId.parseState.crsId).toBe('CA_NAD83_CSRS_UTM_19N');

    const viaGridAlias = parseInput(
      ['.CRS LOCAL', '.CRS GRID CA_NAD83_CSRS_UTM_20N', 'C A 0 0 0 ! !'].join('\n'),
    );
    expect(viaGridAlias.parseState.coordSystemMode).toBe('grid');
    expect(viaGridAlias.parseState.crsId).toBe('CA_NAD83_CSRS_UTM_20N');
    expect(viaGridAlias.logs.some((l) => l.includes('Coordinate system mode set to GRID'))).toBe(
      true,
    );

    const viaEpsgAlias = parseInput(['.CRS GRID EPSG:2953', 'C A 0 0 0 ! !'].join('\n'));
    expect(viaEpsgAlias.parseState.coordSystemMode).toBe('grid');
    expect(viaEpsgAlias.parseState.crsId).toBe('CA_NAD83_CSRS_NB_STEREO_DOUBLE');
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

  it('parses sideshot station-token shorthand SS at-from-to with setup-angle default and HI/HT', () => {
    const parsed = parseInput(
      [
        'C OCC 0 0 0 !',
        'C BS 0 100 0 !',
        'TB OCC BS',
        'SS OCC-BS-SH 090-00-00.0 10.0 90.0 1.7000/1.5720',
      ].join('\n'),
    );
    const ssDist = parsed.observations.find((o) => o.type === 'dist' && o.setId === 'SS');
    const ssZen = parsed.observations.find(
      (o) => o.type === 'zenith' && o.from === 'OCC' && o.to === 'SH',
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

  it('parses sideshot station-token shorthand SS at-to with azimuth default', () => {
    const parsed = parseInput(['C OCC 0 0 0 !', 'SS OCC-SH 090-00-00.0 10.0 90.0'].join('\n'));
    const ssDist = parsed.observations.find((o) => o.type === 'dist' && o.setId === 'SS');
    expect(ssDist?.type).toBe('dist');
    if (ssDist?.type === 'dist') {
      const calc = ssDist.calc as { azimuthObs?: number; hzObs?: number };
      expect(calc.azimuthObs).toBeDefined();
      expect(calc.hzObs).toBeUndefined();
    }
  });

  it('parses GS coordinate shots honoring .ORDER coordinate and sigma mapping', () => {
    const parsed = parseInput(
      ['.ORDER NE', 'C OCC 0 0 0 ! !', 'GS RTK1 200.0 100.0 0.020 0.030 FROM=OCC'].join('\n'),
    );
    const shots = parsed.parseState.gpsTopoShots ?? [];
    expect(shots).toHaveLength(1);
    expect(shots[0].pointId).toBe('RTK1');
    expect(shots[0].east).toBeCloseTo(100, 8);
    expect(shots[0].north).toBeCloseTo(200, 8);
    expect(shots[0].sigmaE).toBeCloseTo(0.03, 8);
    expect(shots[0].sigmaN).toBeCloseTo(0.02, 8);
    expect(shots[0].fromId).toBe('OCC');
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
    expect(
      parsed.parseState.aliasExplicitMappings?.map((m) => `${m.sourceId}->${m.canonicalId}`),
    ).toEqual(['P1->A1', 'Q1->B1']);
    expect(
      parsed.parseState.aliasTrace?.some((t) => t.context === 'observation' && t.sourceLine === 5),
    ).toBe(true);
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
    expect(
      parsed.parseState.aliasExplicitMappings?.map((m) => `${m.sourceId}->${m.canonicalId}`),
    ).toEqual(['ROVER1->PT_100', 'STA01->STA_1']);
    expect(parsed.parseState.aliasRuleSummaries?.map((r) => r.rule)).toEqual(['PREFIX TMP_ PT_']);

    expect(parsed.stations.PT_100).toBeDefined();
    expect(parsed.stations.TMP_100).toBeUndefined();
    expect(parsed.stations.ROVER1).toBeUndefined();
    expect(parsed.stations.STA01).toBeUndefined();

    const dist = parsed.observations.find((o) => o.type === 'dist');
    const angle = parsed.observations.find((o) => o.type === 'angle') as
      | AngleObservation
      | undefined;
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
    expect(
      parsed.logs.some((line) => line.includes('Description reconciliation set to APPEND')),
    ).toBe(true);
  });
});
