import { describe, expect, it } from 'vitest';
import {
  LSAEngine,
  readFileSync,
} from './adjustTestSupport';

describe('LSAEngine', () => {
  it('computes GPS loop-candidate closure diagnostics when GPS loop check is enabled', () => {
    const input = readFileSync('tests/fixtures/gps_loop_phase1.dat', 'utf-8');
    const result = new LSAEngine({ input, maxIterations: 10 }).solve();
    const loopDiag = result.gpsLoopDiagnostics;

    expect(result.parseState?.gpsLoopCheckEnabled ?? false).toBe(true);
    expect(loopDiag?.enabled ?? false).toBe(true);
    expect(loopDiag?.vectorCount ?? 0).toBe(3);
    expect(loopDiag?.loopCount ?? 0).toBe(1);
    expect(loopDiag?.passCount ?? 0).toBe(1);
    expect(loopDiag?.warnCount ?? 0).toBe(0);
    expect(loopDiag?.thresholds.baseToleranceM ?? 0).toBeCloseTo(0.02, 8);
    expect(loopDiag?.thresholds.ppmTolerance ?? 0).toBe(50);
    expect(loopDiag?.loops[0].stationPath.join('->') ?? '').toContain('A');
    expect(loopDiag?.loops[0].stationPath.join('->') ?? '').toContain('C');
    expect(loopDiag?.loops[0].rank ?? 0).toBe(1);
    expect(loopDiag?.loops[0].pass ?? false).toBe(true);
    expect(loopDiag?.loops[0].severity ?? 0).toBeLessThan(1);
    expect(loopDiag?.loops[0].closureMag ?? 0).toBeGreaterThan(0.02);
    expect(loopDiag?.loops[0].closureMag ?? 0).toBeLessThan(0.03);
    expect(loopDiag?.loops[0].toleranceM ?? 0).toBeGreaterThan(loopDiag?.loops[0].closureMag ?? 0);
    expect(result.logs.some((line) => line.includes('GPS loop check: vectors=3, loops=1'))).toBe(
      true,
    );
  });

  it('applies GPS loop tolerances and severity ranking for mixed pass/warn loops', () => {
    const input = readFileSync('tests/fixtures/gps_loop_phase2.dat', 'utf-8');
    const result = new LSAEngine({ input, maxIterations: 10 }).solve();
    const loopDiag = result.gpsLoopDiagnostics;

    expect(loopDiag?.enabled ?? false).toBe(true);
    expect(loopDiag?.vectorCount ?? 0).toBe(5);
    expect(loopDiag?.loopCount ?? 0).toBe(2);
    expect(loopDiag?.passCount ?? 0).toBe(1);
    expect(loopDiag?.warnCount ?? 0).toBe(1);
    expect(loopDiag?.loops[0].rank ?? 0).toBe(1);
    expect(loopDiag?.loops[1].rank ?? 0).toBe(2);
    expect(loopDiag?.loops[0].pass ?? true).toBe(false);
    expect(loopDiag?.loops[1].pass ?? false).toBe(true);
    expect(loopDiag?.loops[0].severity ?? 0).toBeGreaterThan(loopDiag?.loops[1].severity ?? 0);
    expect(loopDiag?.loops[0].toleranceM ?? 0).toBeGreaterThan(0);
    expect(loopDiag?.loops[0].linearPpm ?? 0).toBeGreaterThan(
      loopDiag?.thresholds.ppmTolerance ?? 0,
    );
    expect(loopDiag?.loops[1].linearPpm ?? 0).toBeLessThan(loopDiag?.loops[0].linearPpm ?? 0);
    expect(loopDiag?.loops[0].closureMag ?? 0).toBeGreaterThan(loopDiag?.loops[0].toleranceM ?? 0);
    expect(loopDiag?.loops[1].closureMag ?? 0).toBeLessThan(loopDiag?.loops[1].toleranceM ?? 0);
    expect(
      result.logs.some((line) =>
        line.includes('GPS loop check: vectors=5, loops=2, pass=1, warn=1'),
      ),
    ).toBe(true);
  });

  it('keeps GPS loop diagnostics disabled by default when not requested', () => {
    const input = readFileSync('tests/fixtures/gps_loop_phase1.dat', 'utf-8').replace(
      '.GPS CHECK ON\n',
      '',
    );
    const result = new LSAEngine({ input, maxIterations: 10 }).solve();
    expect(result.parseState?.gpsLoopCheckEnabled ?? false).toBe(false);
    expect(result.gpsLoopDiagnostics).toBeUndefined();
    expect(result.logs.some((line) => line.includes('GPS loop check:'))).toBe(false);
  });

  it('classifies known pass loop datasets as PASS within tolerance', () => {
    const input = readFileSync('tests/fixtures/gps_loop_phase3_pass.dat', 'utf-8');
    const result = new LSAEngine({ input, maxIterations: 10 }).solve();
    const loopDiag = result.gpsLoopDiagnostics;

    expect(loopDiag?.enabled ?? false).toBe(true);
    expect(loopDiag?.loopCount ?? 0).toBe(1);
    expect(loopDiag?.passCount ?? 0).toBe(1);
    expect(loopDiag?.warnCount ?? 0).toBe(0);
    expect(loopDiag?.loops[0].pass ?? false).toBe(true);
    expect(loopDiag?.loops[0].closureMag ?? 0).toBeLessThan(loopDiag?.loops[0].toleranceM ?? 0);
  });

  it('classifies known fail loop datasets as WARN when closure exceeds tolerance', () => {
    const input = readFileSync('tests/fixtures/gps_loop_phase3_fail.dat', 'utf-8');
    const result = new LSAEngine({ input, maxIterations: 10 }).solve();
    const loopDiag = result.gpsLoopDiagnostics;

    expect(loopDiag?.enabled ?? false).toBe(true);
    expect(loopDiag?.loopCount ?? 0).toBe(1);
    expect(loopDiag?.passCount ?? 0).toBe(0);
    expect(loopDiag?.warnCount ?? 0).toBe(1);
    expect(loopDiag?.loops[0].pass ?? true).toBe(false);
    expect(loopDiag?.loops[0].closureMag ?? 0).toBeGreaterThan(loopDiag?.loops[0].toleranceM ?? 0);
  });

  it('computes dedicated differential leveling loop diagnostics with ranked loop closures', () => {
    const input = readFileSync('tests/fixtures/level_loop_phase1.dat', 'utf-8');
    const result = new LSAEngine({ input, maxIterations: 10 }).solve();
    const loopDiag = result.levelingLoopDiagnostics;

    expect(result.success).toBe(true);
    expect(loopDiag?.enabled ?? false).toBe(true);
    expect(loopDiag?.observationCount ?? 0).toBe(5);
    expect(loopDiag?.loopCount ?? 0).toBe(2);
    expect(loopDiag?.passCount ?? 0).toBe(0);
    expect(loopDiag?.warnCount ?? 0).toBe(2);
    expect(loopDiag?.totalLengthKm ?? 0).toBeCloseTo(0.0041, 8);
    expect(loopDiag?.warnTotalLengthKm ?? 0).toBeCloseTo(0.0052, 8);
    expect(loopDiag?.thresholds.baseMm ?? 0).toBeCloseTo(0, 8);
    expect(loopDiag?.thresholds.perSqrtKmMm ?? 0).toBeCloseTo(4, 8);
    expect(loopDiag?.loops[0].rank ?? 0).toBe(1);
    expect(loopDiag?.loops[1].rank ?? 0).toBe(2);
    expect(loopDiag?.loops[0].stationPath.join('->') ?? '').toContain('A');
    expect(loopDiag?.loops[0].stationPath.join('->') ?? '').toContain('D');
    expect(loopDiag?.loops[0].sourceLines ?? []).toContain(14);
    expect(loopDiag?.loops[0].sourceLines ?? []).toContain(16);
    expect(loopDiag?.loops[0].absClosure ?? 0).toBeCloseTo(0.02, 8);
    expect(loopDiag?.loops[1].absClosure ?? 0).toBeCloseTo(0.01, 8);
    expect(loopDiag?.loops[0].toleranceMm ?? 0).toBeCloseTo(0.219089, 5);
    expect(loopDiag?.loops[0].pass ?? true).toBe(false);
    expect(loopDiag?.loops[1].pass ?? false).toBe(false);
    expect(loopDiag?.loops[0].segments.length ?? 0).toBeGreaterThan(0);
    expect(loopDiag?.suspectSegments[0].sourceLine).toBe(14);
    expect(loopDiag?.suspectSegments[0].warnLoopCount ?? 0).toBeGreaterThan(0);
    expect(loopDiag?.suspectSegments[0].suspectScore ?? 0).toBeGreaterThan(0);
    expect(loopDiag?.loops[0].closurePerSqrtKmMm ?? 0).toBeGreaterThan(
      loopDiag?.loops[1].closurePerSqrtKmMm ?? 0,
    );
    expect(
      result.logs.some((line) =>
        line.includes(
          'Leveling loop check: observations=5, loops=2, totalLength=0.004km, tolerance=0.000mm+4.000mm*sqrt(km)',
        ),
      ),
    ).toBe(true);
  });

  it('applies correlated XY control constraints when control covariance includes EN correlation', () => {
    const diagonalInput = [
      '.2D',
      'C A 0 0 0 ! !',
      'C P 0 0 3.0 1.0 0.0',
      'G GPS A P 10 4 1 2 0',
    ].join('\n');
    const correlatedInput = [
      '.2D',
      'C A 0 0 0 ! !',
      'C P 0 0 3.0 1.0 -0.8',
      'G GPS A P 10 4 1 2 0',
    ].join('\n');

    const diagonal = new LSAEngine({ input: diagonalInput, maxIterations: 6 }).solve();
    const correlated = new LSAEngine({ input: correlatedInput, maxIterations: 6 }).solve();

    expect(diagonal.success).toBe(true);
    expect(correlated.success).toBe(true);
    expect(diagonal.controlConstraints?.xyCorrelated ?? 0).toBe(0);
    expect(correlated.controlConstraints?.xyCorrelated).toBe(1);
    expect(correlated.logs.some((line) => line.includes('corrXY=1'))).toBe(true);
    expect(correlated.stations.P.x).not.toBeCloseTo(diagonal.stations.P.x, 3);
    expect(correlated.stations.P.y).not.toBeCloseTo(diagonal.stations.P.y, 3);
    expect(correlated.stations.P.x).toBeCloseTo(8.6528, 2);
    expect(correlated.stations.P.y).toBeCloseTo(-1.788, 2);
  });

  it('handles mixed GPS NETWORK + GPS SIDESHOT vectors with dedicated post-adjust sideshot output', () => {
    const input = readFileSync('tests/fixtures/gps_network_sideshot_phase3.dat', 'utf-8');
    const result = new LSAEngine({ input, maxIterations: 10 }).solve();

    const gpsNetworkObs = result.observations.find(
      (o) => o.type === 'gps' && o.gpsMode === 'network',
    );
    const gpsSideshotObs = result.observations.find(
      (o) => o.type === 'gps' && o.gpsMode === 'sideshot',
    );
    const gpsSideshotRow = result.sideshots?.find((row) => row.mode === 'gps' && row.to === 'RTK1');

    expect(result.success).toBe(true);
    expect(gpsNetworkObs).toBeDefined();
    expect(gpsSideshotObs).toBeDefined();
    expect(
      result.logs.some((l) =>
        l.includes('GPS sideshot vectors excluded from adjustment equations: 1'),
      ),
    ).toBe(true);
    expect(gpsSideshotRow).toBeDefined();
    expect(gpsSideshotRow?.azimuthSource).toBe('vector');
    expect(gpsSideshotRow?.easting ?? 0).toBeCloseTo(1004.25, 8);
    expect(gpsSideshotRow?.northing ?? 0).toBeCloseTo(1996.25, 8);
    expect(gpsSideshotRow?.sigmaE).toBeGreaterThan(0);
    expect(gpsSideshotRow?.sigmaN).toBeGreaterThan(0);
  });

  it('uses provided default instrument precision for records without explicit instrument codes', () => {
    const input = ['.2D', 'C A 0 0 0 ! !', 'C B 10 0 0', 'D A-B 10.0'].join('\n');
    const fallbackRun = new LSAEngine({ input, maxIterations: 6 }).solve();
    const fallbackDist = fallbackRun.observations.find((o) => o.type === 'dist');
    expect(fallbackDist?.stdDev).toBeCloseTo(0, 8);

    const starDefaultRun = new LSAEngine({
      input,
      maxIterations: 6,
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
      parseOptions: { currentInstrument: '__INDUSTRY_DEFAULT__' },
    }).solve();
    const starDist = starDefaultRun.observations.find((o) => o.type === 'dist');
    expect(starDist?.stdDev).toBeCloseTo(0.00101, 8);
  });

  it('keeps non-zero point precision when DOF is zero (a-priori scaling)', () => {
    const input = [
      '.2D',
      '.ORDER EN ATFROMTO',
      'C 1 1000.000 1000.000 ! !',
      'C 2 1003.281021 1000.000 ! !',
      'M 1-2-7 234-32-32 6.629437053',
    ].join('\n');
    const result = new LSAEngine({ input, maxIterations: 10 }).solve();
    expect(result.dof).toBe(0);
    expect(result.stations['7']).toBeDefined();
    expect((result.stations['7'].sE ?? 0) > 0).toBe(true);
    expect((result.stations['7'].sN ?? 0) > 0).toBe(true);
    expect(
      result.logs.some((l) => l.includes('DOF <= 0: using a-priori variance factor 1.0')),
    ).toBe(true);
  });

  it('does not inflate differential-level weighting sigma with vertical centering', () => {
    const input = [
      'C A 0 0 100 ! ! !',
      'C B 0 0 100',
      'L A-B 0.9000 250',
      'L A-B 0.8990 250',
    ].join('\n');
    const instrumentLibrary = {
      LEV: {
        code: 'LEV',
        desc: 'level',
        edm_const: 0,
        edm_ppm: 0,
        hzPrecision_sec: 0,
        dirPrecision_sec: 0,
        azBearingPrecision_sec: 0,
        vaPrecision_sec: 0,
        instCentr_m: 0,
        tgtCentr_m: 0,
        vertCentr_m: 0.01,
        elevDiff_const_m: 0,
        elevDiff_ppm: 0,
        gpsStd_xy: 0,
        levStd_mmPerKm: 1.5,
      },
    };
    const result = new LSAEngine({
      input,
      maxIterations: 8,
      instrumentLibrary,
      parseOptions: {
        currentInstrument: 'LEV',
        projectDefaultInstrument: 'LEV',
      },
    }).solve();
    const lev = result.observations.find((obs) => obs.type === 'lev');
    expect(lev?.type).toBe('lev');
    if (lev?.type === 'lev') {
      expect(lev.stdDev).toBeCloseTo(0.00075, 10);
      expect(lev.weightingStdDev).toBeCloseTo(0.00075, 10);
    }
  });

});
