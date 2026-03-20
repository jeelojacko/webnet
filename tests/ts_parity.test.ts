import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { LSAEngine } from '../src/engine/adjust';
import { parseInput } from '../src/engine/parse';

const solveStarParity = (input: string) =>
  new LSAEngine({
    input,
    maxIterations: 10,
    instrumentLibrary: {
      __INDUSTRY_DEFAULT__: {
        code: '__INDUSTRY_DEFAULT__',
        desc: 'Industry Standard default instrument',
        edm_const: 0.001,
        edm_ppm: 1,
        hzPrecision_sec: 0.5,
        dirPrecision_sec: 0.5,
        azBearingPrecision_sec: 0.5,
        vaPrecision_sec: 0.5,
        instCentr_m: 0.0005,
        tgtCentr_m: 0,
        vertCentr_m: 0,
        elevDiff_const_m: 0,
        elevDiff_ppm: 0,
        gpsStd_xy: 0,
        levStd_mmPerKm: 0,
      },
    },
    parseOptions: {
      currentInstrument: '__INDUSTRY_DEFAULT__',
      directionSetMode: 'raw',
      robustMode: 'none',
      tsCorrelationEnabled: false,
      geometryDependentSigmaReference: 'initial',
    },
  }).solve();

const stationLabel = (obs: { type: string; at?: string; from?: string; to?: string }): string => {
  if (obs.type === 'angle' && obs.at && obs.from && obs.to)
    return `${obs.at}-${obs.from}-${obs.to}`;
  if (obs.at && obs.to) return `${obs.at}-${obs.to}`;
  if (obs.from && obs.to) return `${obs.from}-${obs.to}`;
  return '-';
};

describe('TS parity harness (phase 1)', () => {
  it('keeps baseline TS-only network outputs stable', () => {
    const input = readFileSync('tests/fixtures/ts_phase1_baseline.dat', 'utf-8');
    const engine = new LSAEngine({ input, maxIterations: 15 });
    const result = engine.solve();

    expect(result.dof).toBeGreaterThan(0);
    expect(result.chiSquare).toBeDefined();
    expect(result.typeSummary?.dist?.count ?? 0).toBe(3);
    expect(result.typeSummary?.angle?.count ?? 0).toBe(3);
    expect(result.typeSummary?.dir?.count ?? 0).toBe(0);

    const st = result.stations['2000'];
    expect(st).toBeDefined();
    expect(Number.isFinite(st.x)).toBe(true);
    expect(Number.isFinite(st.y)).toBe(true);
    expect(result.observations.every((o) => o.sourceLine != null)).toBe(true);
  });

  it('supports explicit A-record mode forcing (ANGLE vs DIR)', () => {
    const common = ['C A 0 0 0 !', 'C B 100 0 0', 'C X 50 50 0'];
    const angleInput = ['.AMODE ANGLE', ...common, 'A X-A-B 135.0000 1.0'].join('\n');
    const dirInput = ['.AMODE DIR', ...common, 'A X-A-B 135.0000 1.0'].join('\n');

    const angleParsed = parseInput(angleInput);
    const dirParsed = parseInput(dirInput);

    expect(angleParsed.observations.some((o) => o.type === 'angle')).toBe(true);
    expect(angleParsed.observations.some((o) => o.type === 'dir')).toBe(false);
    expect(dirParsed.observations.some((o) => o.type === 'dir')).toBe(true);
    expect(dirParsed.observations.some((o) => o.type === 'angle')).toBe(false);
  });

  it('matches industry-style parity metrics with raw directions and default instrument fallback', () => {
    const input = readFileSync('tests/fixtures/industry_parity_phase2.dat', 'utf-8');
    const result = solveStarParity(input);

    expect(result.converged).toBe(true);
    expect(result.iterations).toBe(5);
    expect(result.dof).toBe(165);
    expect(result.typeSummary?.direction?.count ?? 0).toBe(18);
    expect(result.seuw).toBeCloseTo(1.1276, 3);
    expect(result.statisticalSummary?.totalCount ?? 0).toBe(196);
    expect(result.statisticalSummary?.totalErrorFactorByDof ?? 0).toBeCloseTo(1.1276, 3);

    const byGroup = new Map(
      (result.statisticalSummary?.byGroup ?? []).map((row) => [row.label, row]),
    );
    expect(byGroup.get('Angles')?.count ?? 0).toBe(72);
    expect(byGroup.get('Directions')?.count ?? 0).toBe(18);
    expect(byGroup.get('Distances')?.count ?? 0).toBe(106);
    expect(byGroup.get('Angles')?.errorFactor ?? 0).toBeCloseTo(1.274, 2);
    expect(byGroup.get('Directions')?.errorFactor ?? 0).toBeCloseTo(1.364, 3);
    expect(byGroup.get('Distances')?.errorFactor ?? 0).toBeCloseTo(0.968, 3);

    const p1000 = result.stations['1000'];
    const p1 = result.stations['1'];
    const p9 = result.stations['9'];
    expect(p1000.x).toBeCloseTo(0.9956, 4);
    expect(p1000.y).toBeCloseTo(2.0620, 4);
    expect(p1.x).toBeCloseTo(2.3563, 4);
    expect(p1.y).toBeCloseTo(-2.4643, 4);
    expect(p9.x).toBeCloseTo(101.4486, 4);
    expect(p9.y).toBeCloseTo(-1.4043, 4);
  });

  it('tracks industry benchmark signatures for coords, SEUW, and top residual behavior', () => {
    const input = readFileSync('tests/fixtures/industry_parity_phase2.dat', 'utf-8');
    const expected = JSON.parse(
      readFileSync('tests/fixtures/industry_parity_phase2_expected.json', 'utf-8'),
    ) as {
      summary: {
        iterations: number;
        dof: number;
        seuw: number;
        seuwTolerance: number;
        chiPass95: boolean;
      };
      coordinates: Record<string, { northing: number; easting: number; tol: number }>;
      residualSignatures: {
        maxAngle: { stations: string; stdRes: number; tol: number };
        maxDirection: { stations: string; stdRes: number; tol: number };
      };
    };

    const result = solveStarParity(input);

    expect(result.iterations).toBe(expected.summary.iterations);
    expect(result.dof).toBe(expected.summary.dof);
    expect(result.seuw).toBeCloseTo(expected.summary.seuw, 2);
    expect(Math.abs(result.seuw - expected.summary.seuw)).toBeLessThanOrEqual(
      expected.summary.seuwTolerance,
    );
    expect(result.chiSquare?.pass95).toBe(expected.summary.chiPass95);

    Object.entries(expected.coordinates).forEach(([id, coord]) => {
      const st = result.stations[id];
      expect(st).toBeDefined();
      expect(st.y).toBeCloseTo(coord.northing, 3);
      expect(st.x).toBeCloseTo(coord.easting, 3);
      expect(Math.abs(st.y - coord.northing)).toBeLessThanOrEqual(coord.tol);
      expect(Math.abs(st.x - coord.easting)).toBeLessThanOrEqual(coord.tol);
    });

    const maxAngle = [...result.observations]
      .filter((o) => o.type === 'angle' && Number.isFinite(o.stdRes))
      .sort((a, b) => Math.abs(b.stdRes ?? 0) - Math.abs(a.stdRes ?? 0))[0];
    expect(maxAngle).toBeDefined();
    expect(stationLabel(maxAngle)).toBe(expected.residualSignatures.maxAngle.stations);
    expect(
      Math.abs(Math.abs(maxAngle.stdRes ?? 0) - expected.residualSignatures.maxAngle.stdRes),
    ).toBeLessThanOrEqual(expected.residualSignatures.maxAngle.tol);

    const maxDirection = [...result.observations]
      .filter((o) => o.type === 'direction' && Number.isFinite(o.stdRes))
      .sort((a, b) => Math.abs(b.stdRes ?? 0) - Math.abs(a.stdRes ?? 0))[0];
    expect(maxDirection).toBeDefined();
    expect(stationLabel(maxDirection)).toBe(expected.residualSignatures.maxDirection.stations);
    expect(
      Math.abs(
        Math.abs(maxDirection.stdRes ?? 0) - expected.residualSignatures.maxDirection.stdRes,
      ),
    ).toBeLessThanOrEqual(expected.residualSignatures.maxDirection.tol);
  });
});
