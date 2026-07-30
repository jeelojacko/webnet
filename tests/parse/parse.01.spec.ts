import { describe, expect, it } from 'vitest';
import {
  readFileSync,
  parseInput,
  INDUSTRY_PARITY_CASES,
  parsed,
} from './parseTestSupport';
import type {
  DistanceObservation,
  LevelObservation,
} from './parseTestSupport';

describe('parseInput', () => {
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

});
