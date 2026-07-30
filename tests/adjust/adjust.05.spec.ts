import { describe, expect, it } from 'vitest';
import {
  LSAEngine,
  readFileSync,
} from './adjustTestSupport';

describe('LSAEngine', () => {
  it(
    'keeps combined-case leveling weights active when project levelWeight is set and S9 is the selected instrument',
    () => {
    const input = readFileSync('tests/fixtures/industry_case_combined_input.txt', 'utf-8')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .trim();
    const instrumentLibrary = {
      TRAV_DEFAULT: {
        code: 'TRAV_DEFAULT',
        desc: 'industry parity traverse project default',
        edm_const: 0.001,
        edm_ppm: 1.5,
        hzPrecision_sec: 1.414,
        dirPrecision_sec: 1.0,
        azBearingPrecision_sec: 1.414,
        vaPrecision_sec: 1.0,
        instCentr_m: 0.00075,
        tgtCentr_m: 0.00075,
        vertCentr_m: 0.0005,
        elevDiff_const_m: 0.01524,
        elevDiff_ppm: 0,
        gpsStd_xy: 0,
        levStd_mmPerKm: 1.5,
      },
      S9: {
        code: 'S9',
        desc: 'corrections from isopropyl',
        edm_const: 0.003,
        edm_ppm: 2.0,
        hzPrecision_sec: 1.2357,
        dirPrecision_sec: 0.87377,
        azBearingPrecision_sec: 0.707107,
        vaPrecision_sec: 3.28473,
        instCentr_m: 0.0015,
        tgtCentr_m: 0.0015,
        vertCentr_m: 0.0005,
        elevDiff_const_m: 0.01524,
        elevDiff_ppm: 0,
        gpsStd_xy: 0,
        levStd_mmPerKm: 0,
      },
      SX12: {
        code: 'SX12',
        desc: 'n/a',
        edm_const: 0.003,
        edm_ppm: 1.5,
        hzPrecision_sec: 0.950079,
        dirPrecision_sec: 0.671807,
        azBearingPrecision_sec: 1.414,
        vaPrecision_sec: 6.064437,
        instCentr_m: 0.0015,
        tgtCentr_m: 0.0015,
        vertCentr_m: 0.0005,
        elevDiff_const_m: 0.01524,
        elevDiff_ppm: 0,
        gpsStd_xy: 0,
        levStd_mmPerKm: 0,
      },
      TS11: {
        code: 'TS11',
        desc: 'n/a',
        edm_const: 0.002,
        edm_ppm: 1.5,
        hzPrecision_sec: 1.84146,
        dirPrecision_sec: 1.302108,
        azBearingPrecision_sec: 4.0,
        vaPrecision_sec: 4.41756,
        instCentr_m: 0.0015,
        tgtCentr_m: 0.0015,
        vertCentr_m: 0.0005,
        elevDiff_const_m: 0.01524,
        elevDiff_ppm: 0,
        gpsStd_xy: 0,
        levStd_mmPerKm: 0,
      },
    };

    const result = new LSAEngine({
      input,
      maxIterations: 10,
      convergenceThreshold: 0.01,
      instrumentLibrary,
      parseOptions: {
        currentInstrument: 'S9',
        projectDefaultInstrument: 'S9',
        coordSystemMode: 'grid',
        crsId: 'CA_NAD83_CSRS_NB_STEREO_DOUBLE',
        coordMode: '3D',
        order: 'NE',
        deltaMode: 'slope',
        angleStationOrder: 'atfromto',
        lonSign: 'west-positive',
        levelWeight: 1.5,
        applyCurvatureRefraction: true,
        verticalReduction: 'curvref',
        refractionCoefficient: 0.07,
        verticalDeflectionNorthSec: -2.91,
        verticalDeflectionEastSec: -1.46,
      },
    }).solve();

    expect(result.success).toBe(true);
    expect(result.converged).toBe(true);
    expect(result.seuw).toBeLessThan(2);

    const levelRows = result.observations.filter((obs) => obs.type === 'lev');
    expect(levelRows).toHaveLength(60);
    expect(levelRows.every((obs) => (obs.weightingStdDev ?? 0) > 0)).toBe(true);
    const levelSumSquares = levelRows.reduce((sum, obs) => sum + ((obs.stdRes ?? 0) ** 2), 0);
    expect(levelSumSquares).toBeGreaterThan(1);
    expect(levelSumSquares).toBeLessThan(100);
    },
    15000,
  );

  it('solves M ATFROMTO turned-angle + horizontal-distance shots at measured ranges', () => {
    const input = [
      '.UNITS Meters DMS',
      '.ORDER NE ATFROMTO',
      '.2D',
      'C 1 1000.000 1000.000 ! !',
      'C 2 1003.281021 1000.000000 ! !',
      'C 22 1007.032000 1000.000000 ! !',
      'M 1-2-7 234-32-32 6.629437053',
      'M 1-2-8 236-36-56 6.495431347',
      'M 2-22-19 285-01-45 6.71548833',
      'M 2-22-20 286-35-04 6.504976068',
      'M 2-22-807 336-43-55 2.701451332',
      'M 2-22-808 336-42-20 2.70045941',
    ].join('\n');

    const result = new LSAEngine({ input, maxIterations: 20 }).solve();
    const p1 = result.stations['1'];
    const p2 = result.stations['2'];

    const distTo = (from: { x: number; y: number }, toId: string): number => {
      const to = result.stations[toId];
      return Math.hypot(to.x - from.x, to.y - from.y);
    };

    expect(distTo(p1, '7')).toBeCloseTo(6.629437053, 6);
    expect(distTo(p1, '8')).toBeCloseTo(6.495431347, 6);
    expect(distTo(p2, '19')).toBeCloseTo(6.71548833, 6);
    expect(distTo(p2, '20')).toBeCloseTo(6.504976068, 6);
    expect(distTo(p2, '807')).toBeCloseTo(2.701451332, 6);
    expect(distTo(p2, '808')).toBeCloseTo(2.70045941, 6);

    const maxDistResidual = result.observations
      .filter((o) => o.type === 'dist')
      .reduce((max, o) => {
        const residual = typeof o.residual === 'number' ? Math.abs(o.residual) : 0;
        return Math.max(max, residual);
      }, 0);
    expect(maxDistResidual).toBeLessThan(1e-6);
  });

  it('reports direction reduction diagnostics for face-paired sets', () => {
    const input = [
      '.NORMALIZE ON',
      'C O 0 0 0 !',
      'C B 0 100 0 !',
      'C P 100 0 0',
      'D O-P 100.0 0.005',
      'D B-P 141.421356 0.005',
      'DB O B',
      'DM P 090.0000 100.0 090.0000 1.0 0.002',
      'DM P 270.0000 100.0 270.0000 1.0 0.002',
      'DE',
    ].join('\n');
    const engine = new LSAEngine({
      input,
      maxIterations: 10,
      parseOptions: { parseCompatibilityMode: 'strict', faceNormalizationMode: 'on' },
    });
    const result = engine.solve();
    expect(result.directionSetDiagnostics?.length).toBeGreaterThan(0);
    const first = result.directionSetDiagnostics?.[0];
    expect(first?.rawCount).toBe(2);
    expect(first?.reducedCount).toBe(1);
    expect(first?.pairedTargets).toBe(1);
    expect(first?.meanFacePairDeltaArcSec).toBeDefined();
    expect(first?.maxRawMaxResidualArcSec).toBeDefined();
    expect(result.setupDiagnostics?.some((s) => s.station === 'O')).toBe(true);
  });

  it('supports raw direction-set solving mode without target reduction', () => {
    const input = [
      '.NORMALIZE ON',
      'C O 0 0 0 !',
      'C B 0 100 0 !',
      'C P 100 0 0',
      'D O-P 100.0 0.005',
      'D B-P 141.421356 0.005',
      'DB O B',
      'DM P 090.0000 100.0 090.0000 1.0 0.002',
      'DM P 270.0000 100.0 270.0000 1.0 0.002',
      'DE',
    ].join('\n');
    const reduced = new LSAEngine({
      input,
      maxIterations: 10,
      parseOptions: { parseCompatibilityMode: 'strict', faceNormalizationMode: 'on' },
    }).solve();
    const raw = new LSAEngine({
      input,
      maxIterations: 10,
      parseOptions: {
        directionSetMode: 'raw',
        parseCompatibilityMode: 'strict',
        faceNormalizationMode: 'on',
      },
    }).solve();
    const reducedDir = reduced.observations.filter((o) => o.type === 'direction').length;
    const rawDir = raw.observations.filter((o) => o.type === 'direction').length;
    expect(reducedDir).toBe(1);
    expect(rawDir).toBe(2);
    expect(raw.logs.some((l) => l.includes('raw rows'))).toBe(true);
  });

  it('reports direction-target repeatability diagnostics and suspect ranking', () => {
    const input = [
      '.2D',
      'C O 0 0 0 !',
      'C BS 0 100 0 !',
      'C P 100 0 0',
      'C Q 120 40 0',
      'D O-P 100.000 0.003',
      'D O-Q 126.491 0.003',
      'D BS-P 141.421 0.003',
      'D BS-Q 134.164 0.003',
      'DB O BS',
      'DM P 090-00-00.0 100.000 090-00-00.0 1.0 0.003',
      'DM P 090-00-08.0 100.000 090-00-00.0 1.0 0.003',
      'DM P 270-00-03.0 100.000 270-00-00.0 1.0 0.003',
      'DM P 270-00-14.0 100.000 270-00-00.0 1.0 0.003',
      'DM Q 108-26-06.0 126.491 090-00-00.0 1.0 0.003',
      'DM Q 288-26-09.0 126.491 270-00-00.0 1.0 0.003',
      'DE',
    ].join('\n');

    const engine = new LSAEngine({
      input,
      maxIterations: 12,
      parseOptions: { parseCompatibilityMode: 'strict', faceNormalizationMode: 'on' },
    });
    const result = engine.solve();
    const rows = result.directionTargetDiagnostics ?? [];
    expect(rows.length).toBeGreaterThanOrEqual(2);

    const pRow = rows.find((r) => r.target === 'P');
    const qRow = rows.find((r) => r.target === 'Q');
    expect(pRow).toBeDefined();
    expect(qRow).toBeDefined();
    expect(pRow?.rawCount).toBe(4);
    expect(pRow?.face1Count).toBe(2);
    expect(pRow?.face2Count).toBe(2);
    expect((pRow?.rawSpreadArcSec ?? 0) > (qRow?.rawSpreadArcSec ?? 0)).toBe(true);
    expect(pRow?.rawMaxResidualArcSec).toBeDefined();
    expect(pRow?.facePairDeltaArcSec).toBeDefined();
    expect(pRow?.face1SpreadArcSec).toBeDefined();
    expect(pRow?.face2SpreadArcSec).toBeDefined();
    expect((pRow?.suspectScore ?? 0) >= (qRow?.suspectScore ?? 0)).toBe(true);
  });

  it('propagates structured unresolved mixed-face reject diagnostics from parser to result', () => {
    const input = [
      '.2D',
      'C O 0 0 0 !',
      'C B 0 100 0 !',
      'C P 100 0 0',
      'D O-P 100.000 0.003',
      'D B-P 141.421 0.003',
      'DB O B',
      'DN P 090-00-00.0 1.0',
      'DM P 270-00-00.0 100.0 0.0 1.0 0.003',
      'DE',
    ].join('\n');

    const engine = new LSAEngine({
      input,
      maxIterations: 10,
      parseOptions: { parseCompatibilityMode: 'strict', faceNormalizationMode: 'on' },
    });
    const result = engine.solve();
    expect((result.directionRejectDiagnostics?.length ?? 0) > 0).toBe(true);
    expect(
      result.directionRejectDiagnostics?.some((d) => d.reason === 'unresolved-mixed-face'),
    ).toBe(true);
    expect(
      result.directionRejectDiagnostics?.some((d) => d.policyOutcome === 'strict-reject'),
    ).toBe(true);
  });

  it('aggregates multi-set direction repeatability trends by occupy-target', () => {
    const input = [
      '.2D',
      'C O 0 0 0 !',
      'C BS 0 100 0 !',
      'C P 100 0 0',
      'C Q 120 40 0',
      'D O-P 100.000 0.003',
      'D O-Q 126.491 0.003',
      'D BS-P 141.421 0.003',
      'D BS-Q 134.164 0.003',
      'DB O BS',
      'DM P 090-00-00.0 100.000 090-00-00.0 1.0 0.003',
      'DM P 270-00-01.0 100.000 270-00-00.0 1.0 0.003',
      'DM Q 108-26-06.0 126.491 090-00-00.0 1.0 0.003',
      'DM Q 288-26-06.5 126.491 270-00-00.0 1.0 0.003',
      'DE',
      'DB O BS',
      'DM P 090-00-12.0 100.000 090-00-00.0 1.0 0.003',
      'DM P 270-00-18.0 100.000 270-00-00.0 1.0 0.003',
      'DM Q 108-26-06.1 126.491 090-00-00.0 1.0 0.003',
      'DM Q 288-26-06.3 126.491 270-00-00.0 1.0 0.003',
      'DE',
    ].join('\n');

    const engine = new LSAEngine({
      input,
      maxIterations: 12,
      parseOptions: { parseCompatibilityMode: 'strict', faceNormalizationMode: 'on' },
    });
    const result = engine.solve();
    const rows = result.directionRepeatabilityDiagnostics ?? [];
    expect(rows.length).toBeGreaterThanOrEqual(2);

    const pTrend = rows.find((r) => r.occupy === 'O' && r.target === 'P');
    const qTrend = rows.find((r) => r.occupy === 'O' && r.target === 'Q');
    expect(pTrend).toBeDefined();
    expect(qTrend).toBeDefined();
    expect(pTrend?.setCount).toBe(2);
    expect(qTrend?.setCount).toBe(2);
    expect((pTrend?.maxRawSpreadArcSec ?? 0) >= (qTrend?.maxRawSpreadArcSec ?? 0)).toBe(true);
    expect((pTrend?.suspectScore ?? 0) >= (qTrend?.suspectScore ?? 0)).toBe(true);
  });

});
