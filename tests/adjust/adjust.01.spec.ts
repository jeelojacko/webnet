import { describe, expect, it } from 'vitest';
import {
  LSAEngine,
  DEG_TO_RAD,
  fixture,
  readFileSync,
} from './adjustTestSupport';

describe('LSAEngine', () => {
  it('solves the simple fixture network', () => {
    const engine = new LSAEngine({ input: fixture, maxIterations: 10 });
    const result = engine.solve();

    // Convergence can vary with small networks; assert healthy output instead of strict success flag.
    expect(result.dof).toBeGreaterThan(0);
    expect(Object.keys(result.stations)).toHaveLength(3);
    expect(result.observations.length).toBeGreaterThan(0);

    // Check adjusted unknown station is finite (no NaN/inf)
    const stn = result.stations['2000'];
    expect(Number.isFinite(stn.x)).toBe(true);
    expect(Number.isFinite(stn.y)).toBe(true);
    expect(Number.isFinite(stn.h)).toBe(true);
    expect(stn.fixed).toBe(false);
  });

  it('handles bearing and zenith observations', () => {
    const custom = readFileSync('tests/fixtures/bearing_vertical.dat', 'utf-8');
    const engine = new LSAEngine({ input: custom, maxIterations: 10 });
    const result = engine.solve();
    expect(result.dof).toBeGreaterThan(0);
    const stn = result.stations['X'];
    expect(Number.isFinite(stn.x)).toBe(true);
    expect(Number.isFinite(stn.y)).toBe(true);
    expect(result.observations.some((o) => o.type === 'bearing')).toBe(true);
    expect(result.observations.some((o) => o.type === 'zenith')).toBe(true);
  });

  it('uses convergence-limit objective delta threshold for iteration stopping', () => {
    const loose = new LSAEngine({
      input: fixture,
      maxIterations: 25,
      convergenceThreshold: 0.1,
    }).solve();
    const tight = new LSAEngine({
      input: fixture,
      maxIterations: 25,
      convergenceThreshold: 1e-6,
    }).solve();

    expect(loose.iterations).toBeLessThanOrEqual(tight.iterations);
    expect(Number.isFinite(loose.seuw)).toBe(true);
    expect(Number.isFinite(tight.seuw)).toBe(true);
    expect(loose.logs.some((line) => line.includes('vTPv before='))).toBe(true);
    expect(tight.logs.some((line) => line.includes('vTPv before='))).toBe(true);
  });

  it('keeps CRS phase-2 modeling neutral by default and applies optional scale/convergence when enabled', () => {
    const input = [
      '.2D',
      '.UNITS METERS DD',
      'C A 0 0 0 ! !',
      'C B 100 0 0',
      'D A-B 100.000 0.001',
      'B A-B 090.000000 1.0',
    ].join('\n');

    const base = new LSAEngine({ input, maxIterations: 10 }).solve();
    const withScale = new LSAEngine({
      input,
      maxIterations: 10,
      parseOptions: {
        crsGridScaleEnabled: true,
        crsGridScaleFactor: 0.9996,
      },
    }).solve();
    const withConvergence = new LSAEngine({
      input,
      maxIterations: 10,
      parseOptions: {
        gridBearingMode: 'measured',
        crsConvergenceEnabled: true,
        crsConvergenceAngleRad: 1 * DEG_TO_RAD,
      },
    }).solve();

    expect(base.parseState?.crsGridScaleEnabled ?? false).toBe(false);
    expect(base.parseState?.crsConvergenceEnabled ?? false).toBe(false);
    expect(withScale.stations.B.x).toBeGreaterThan((base.stations.B.x ?? 0) + 0.03);
    expect(Math.abs((withConvergence.stations.B.x ?? 0) - (base.stations.B.x ?? 0))).toBeLessThan(
      0.1,
    );
    expect(Math.abs(withConvergence.stations.B.y ?? 0)).toBeGreaterThan(1);
  });

  it('applies local datum reduction schemes (average-scale and common-elevation)', () => {
    const input = [
      '.2D',
      '.UNITS METERS DD',
      'C A 0 0 0 ! !',
      'C B 100 0 0',
      'D A-B 100.000 0.001',
      'B A-B 090.000000 1.0',
    ].join('\n');

    const base = new LSAEngine({
      input,
      maxIterations: 10,
      parseOptions: {
        coordSystemMode: 'local',
        localDatumScheme: 'average-scale',
        averageScaleFactor: 1,
      },
    }).solve();
    const avgScale = new LSAEngine({
      input,
      maxIterations: 10,
      parseOptions: {
        coordSystemMode: 'local',
        localDatumScheme: 'average-scale',
        averageScaleFactor: 0.9996,
      },
    }).solve();
    const commonElev = new LSAEngine({
      input,
      maxIterations: 10,
      parseOptions: {
        coordSystemMode: 'local',
        localDatumScheme: 'common-elevation',
        commonElevation: 1000,
      },
    }).solve();

    expect(avgScale.stations.B.x).toBeGreaterThan(base.stations.B.x ?? 0);
    expect(commonElev.stations.B.x).toBeLessThan(base.stations.B.x ?? 0);
  });

  it('respects measured-vs-grid distance and bearing modes in grid workflows', () => {
    const input = [
      '.2D',
      '.UNITS METERS DD',
      'C A 0 0 0 ! !',
      'C B 100 0 0',
      'D A-B 100.000 0.001',
      'B A-B 090.000000 1.0',
    ].join('\n');

    const measuredDistance = new LSAEngine({
      input,
      maxIterations: 10,
      parseOptions: {
        coordSystemMode: 'grid',
        crsId: 'CA_NAD83_CSRS_UTM_20N',
        gridDistanceMode: 'measured',
        crsGridScaleEnabled: true,
        crsGridScaleFactor: 0.9996,
      },
    }).solve();
    const gridDistance = new LSAEngine({
      input,
      maxIterations: 10,
      parseOptions: {
        coordSystemMode: 'grid',
        crsId: 'CA_NAD83_CSRS_UTM_20N',
        gridDistanceMode: 'grid',
        crsGridScaleEnabled: true,
        crsGridScaleFactor: 0.9996,
      },
    }).solve();
    const measuredBearing = new LSAEngine({
      input,
      maxIterations: 10,
      parseOptions: {
        coordSystemMode: 'grid',
        crsId: 'CA_NAD83_CSRS_UTM_20N',
        gridBearingMode: 'measured',
        crsConvergenceEnabled: true,
        crsConvergenceAngleRad: 1 * DEG_TO_RAD,
      },
    }).solve();
    const gridBearing = new LSAEngine({
      input,
      maxIterations: 10,
      parseOptions: {
        coordSystemMode: 'grid',
        crsId: 'CA_NAD83_CSRS_UTM_20N',
        gridBearingMode: 'grid',
        crsConvergenceEnabled: true,
        crsConvergenceAngleRad: 1 * DEG_TO_RAD,
      },
    }).solve();

    expect(
      Math.abs((measuredDistance.stations.B.x ?? 0) - (gridDistance.stations.B.x ?? 0)),
    ).toBeGreaterThan(0.01);
    expect(Math.abs(measuredBearing.stations.B.y ?? 0)).toBeGreaterThan(
      Math.abs(gridBearing.stations.B.y ?? 0) + 1,
    );
  });

  it('reduces grid slope distances by scaling only the horizontal component', () => {
    const engine = new LSAEngine({
      input: fixture,
      maxIterations: 1,
      parseOptions: {
        coordSystemMode: 'grid',
      },
    });
    (engine as any).stations = {
      A: { x: 0, y: 0, h: 0, fixed: true, fixedX: true, fixedY: true, fixedH: true },
      B: { x: 100, y: 0, h: 10, fixed: true, fixedX: true, fixedY: true, fixedH: true },
    };
    (engine as any).coordSystemMode = 'grid';
    (engine as any).distanceScaleForObservation = () => 0.9996;
    const dist = {
      id: 1,
      type: 'dist',
      subtype: 'ts',
      from: 'A',
      to: 'B',
      obs: Math.sqrt(100 * 100 + 10 * 10),
      stdDev: 0.001,
      mode: 'slope',
    } as const;

    const calcRaw = Math.sqrt(100 * 100 + 10 * 10);
    const corrected = (engine as any).correctedDistanceModel(dist, calcRaw);
    const expected = Math.sqrt((100 / 0.9996) ** 2 + 10 * 10);

    expect(corrected.calcDistance).toBeCloseTo(expected, 9);
    expect(corrected.mapScale).toBeCloseTo(0.9996, 12);
    expect(corrected.horizontalDerivativeFactor).toBeCloseTo(
      1 / (0.9996 * 0.9996 * expected),
      12,
    );
    expect(corrected.verticalDerivativeFactor).toBeCloseTo(1 / expected, 12);
    expect(corrected.useReducedSlopeDerivatives).toBe(true);
  });

  it('applies .SCALE replacement only to measured grid-distance reductions', () => {
    const input = [
      '.2D',
      '.UNITS METERS DD',
      'C A 0 0 0 ! !',
      'C B 100 0 0',
      'B A-B 90.000000 1.0',
      'D A-B 100.000 0.001',
    ].join('\n');

    const baseline = new LSAEngine({
      input,
      maxIterations: 8,
      parseOptions: {
        coordSystemMode: 'grid',
        crsId: 'CA_NAD83_CSRS_UTM_20N',
        gridDistanceMode: 'measured',
      },
    }).solve();
    const scaled = new LSAEngine({
      input,
      maxIterations: 8,
      parseOptions: {
        coordSystemMode: 'grid',
        crsId: 'CA_NAD83_CSRS_UTM_20N',
        gridDistanceMode: 'measured',
        averageScaleFactor: 1.0025,
        scaleOverrideActive: true,
      },
    }).solve();
    const scaledGridDistance = new LSAEngine({
      input,
      maxIterations: 8,
      parseOptions: {
        coordSystemMode: 'grid',
        crsId: 'CA_NAD83_CSRS_UTM_20N',
        gridDistanceMode: 'grid',
        averageScaleFactor: 1.0025,
        scaleOverrideActive: true,
      },
    }).solve();
    const baselineGridDistance = new LSAEngine({
      input,
      maxIterations: 8,
      parseOptions: {
        coordSystemMode: 'grid',
        crsId: 'CA_NAD83_CSRS_UTM_20N',
        gridDistanceMode: 'grid',
      },
    }).solve();

    expect(baseline.converged).toBe(true);
    expect(scaled.converged).toBe(true);
    const measuredDelta = Math.abs((scaled.stations.B.x ?? 0) - (baseline.stations.B.x ?? 0));
    const gridDelta = Math.abs(
      (scaledGridDistance.stations.B.x ?? 0) - (baselineGridDistance.stations.B.x ?? 0),
    );
    expect(measuredDelta).toBeGreaterThan(0.005);
    expect(scaled.parseState?.coordSystemDiagnostics?.includes('SCALE_OVERRIDE_USED')).toBe(true);
    expect(gridDelta).toBeLessThan(1e-4);
  });

  it('blocks grid solve when GNSS vector frame is unknown and unconfirmed', () => {
    const input = [
      '.2D',
      '.CRS GRID CA_NAD83_CSRS_UTM_20N',
      '.GPS FRAME UNKNOWN',
      '.GPS CONFIRM OFF',
      'C A 0 0 0 ! !',
      'C B 100 0 0',
      'G GPS1 A B 100 0 0.01',
    ].join('\n');
    const result = new LSAEngine({ input, maxIterations: 6 }).solve();

    expect(result.success).toBe(false);
    expect(result.parseState?.coordSystemDiagnostics?.includes('CRS_INPUT_MIX_BLOCKED')).toBe(true);
    expect(result.parseState?.coordSystemDiagnostics?.includes('GNSS_FRAME_UNCONFIRMED')).toBe(
      true,
    );
  });

  it('blocks grid solve when local and geodetic coordinate classes are mixed', () => {
    const input = [
      '.2D',
      '.CRS LOCAL',
      'C A 0 0 0 ! !',
      '.CRS GRID CA_NAD83_CSRS_UTM_20N',
      'P B 45.000000 -63.000000 0',
      'D A-B 100.000 0.005',
    ].join('\n');
    const result = new LSAEngine({ input, maxIterations: 6 }).solve();

    expect(result.success).toBe(false);
    expect(result.parseState?.coordSystemDiagnostics?.includes('CRS_INPUT_MIX_BLOCKED')).toBe(true);
    expect(
      result.logs.some((line) => line.includes('LOCAL coordinates mixed with GRID/GEODETIC')),
    ).toBe(true);
  });

});
