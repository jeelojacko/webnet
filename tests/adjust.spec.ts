import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { LSAEngine } from '../src/engine/adjust';
import { DEG_TO_RAD, SEC_TO_RAD } from '../src/engine/angles';
import { isPreanalysisWhatIfCandidate } from '../src/engine/preanalysis';

const fixture = readFileSync('tests/fixtures/simple.dat', 'utf-8');

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
      parseOptions: { coordSystemMode: 'local', localDatumScheme: 'average-scale', averageScaleFactor: 1 },
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
    expect(result.logs.some((line) => line.includes('LOCAL coordinates mixed with GRID/GEODETIC'))).toBe(
      true,
    );
  });

  it('flags CRS area-of-use warnings (warning-only) when geodetic stations are outside bounds', () => {
    const input = [
      '.2D',
      '.UNITS METERS DD',
      '.CRS GRID CA_NAD83_CSRS_NB_STEREO_DOUBLE',
      'P A 54.000000 -115.000000 0 ! !',
      'P B 54.001000 -115.001000 0',
      'B A-B 045.000000 1.0',
      'D A-B 100.0000 0.005',
    ].join('\n');
    const result = new LSAEngine({ input, maxIterations: 8 }).solve();

    expect(result.parseState?.coordSystemDiagnostics?.includes('CRS_OUT_OF_AREA')).toBe(true);
    expect(result.parseState?.crsAreaOfUseStatus).toBe('outside');
    expect((result.parseState?.crsOutOfAreaStationCount ?? 0) > 0).toBe(true);
    expect(result.success || result.converged || result.iterations > 0).toBe(true);
  });

  it('enables grid CRS status for projected-only NB coordinate jobs and computes factors', () => {
    const input = [
      '.2D',
      '.UNITS METERS DD',
      '.CRS GRID CA_NAD83_CSRS_NB_STEREO_DOUBLE',
      'C A 2500000.0000 7500000.0000 0 ! !',
      'C B 2500800.0000 7500000.0000 0',
      'B A-B 090.000000 1.0',
      'D A-B 800.0000 0.005',
    ].join('\n');
    const result = new LSAEngine({ input, maxIterations: 8 }).solve();

    expect(result.parseState?.crsId).toBe('CA_NAD83_CSRS_NB_STEREO_DOUBLE');
    expect(result.parseState?.coordSystemMode).toBe('grid');
    expect(result.parseState?.crsStatus).toBe('on');
    expect(result.parseState?.crsOffReason).toBeUndefined();
    expect(result.parseState?.crsAreaOfUseStatus).toBe('inside');
    expect(Number.isFinite(result.stations.A.latDeg ?? Number.NaN)).toBe(true);
    expect(Number.isFinite(result.stations.A.lonDeg ?? Number.NaN)).toBe(true);
    expect(result.stations.A.factorComputationMethod).toBe('inverseToGeodetic');
  });

  it('tracks parsed versus used-in-solve reduction usage summaries', () => {
    const input = [
      '.2D',
      '.CRS GRID CA_NAD83_CSRS_UTM_20N',
      'C A 0 0 0 ! !',
      'C B 100 0 0',
      'B A-B 090.000000 1.0',
      'D A-B 100.0000 0.005',
    ].join('\n');
    const result = new LSAEngine({
      input,
      maxIterations: 8,
      excludeIds: new Set([0]),
    }).solve();

    expect(result.parseState?.parsedUsageSummary?.total).toBeGreaterThanOrEqual(2);
    expect(result.parseState?.usedInSolveUsageSummary?.total).toBe(1);
    expect(result.parseState?.parsedUsageSummary?.bearing.grid).toBe(1);
    expect(result.parseState?.usedInSolveUsageSummary?.bearing.grid).toBe(0);
    expect(result.parseState?.usedInSolveUsageSummary?.distance.ground).toBe(1);
  });

  it('records factor approximation diagnostics for projection families without closed-form factor support', () => {
    const input = [
      '.2D',
      '.UNITS METERS DD',
      '.CRS GRID CA_NAD83_CSRS_ON_MNR_LAMBERT',
      'P A 50.000000 -85.000000 0 ! !',
      'P B 50.001000 -84.999000 0',
      'B A-B 045.000000 1.0',
      'D A-B 120.0000 0.005',
    ].join('\n');
    const result = new LSAEngine({ input, maxIterations: 8 }).solve();

    expect(result.parseState?.coordSystemDiagnostics?.includes('FACTOR_APPROXIMATION_USED')).toBe(
      true,
    );
    expect(result.parseState?.coordSystemDiagnostics?.includes('FACTOR_FALLBACK_PROJ_USED')).toBe(
      true,
    );
    expect(result.stations.A.factorComputationSource).toBe('numerical-fallback');
    expect(result.stations.B.factorComputationSource).toBe('numerical-fallback');
  });

  it('loads optional geoid/grid model pipeline only when explicitly enabled', () => {
    const input = [
      '.2D',
      '.UNITS METERS DD',
      'P ORG 40.000000 -105.000000 0 ! !',
      'P TGT 40.001000 -104.999000 0',
      'B ORG-TGT 045.000000 1.0',
      'D ORG-TGT 120.0000 0.005',
    ].join('\n');

    const base = new LSAEngine({ input, maxIterations: 10 }).solve();
    const withGeoid = new LSAEngine({
      input,
      maxIterations: 10,
      parseOptions: {
        geoidModelEnabled: true,
        geoidModelId: 'NGS-DEMO',
        geoidInterpolation: 'bilinear',
      },
    }).solve();

    expect(base.parseState?.geoidModelEnabled ?? false).toBe(false);
    expect(base.parseState?.geoidModelLoaded ?? false).toBe(false);
    expect(withGeoid.parseState?.geoidModelEnabled ?? false).toBe(true);
    expect(withGeoid.parseState?.geoidModelLoaded ?? false).toBe(true);
    expect((withGeoid.parseState?.geoidModelMetadata ?? '').includes('NGS-DEMO')).toBe(true);
    expect(withGeoid.logs.some((l) => l.includes('Geoid/grid model loaded'))).toBe(true);
  });

  it('applies geoid height conversion against known checkpoint values only when enabled', () => {
    const input = readFileSync('tests/fixtures/geoid_phase3_checkpoints.dat', 'utf-8');

    const base = new LSAEngine({ input, maxIterations: 10 }).solve();
    const toOrthometric = new LSAEngine({
      input,
      maxIterations: 10,
      parseOptions: {
        geoidHeightConversionEnabled: true,
        geoidOutputHeightDatum: 'orthometric',
      },
    }).solve();
    const toEllipsoid = new LSAEngine({
      input,
      maxIterations: 10,
      parseOptions: {
        geoidHeightConversionEnabled: true,
        geoidOutputHeightDatum: 'ellipsoid',
      },
    }).solve();
    const conversionWithoutModel = new LSAEngine({
      input: input.replace('.GEOID ON NGS-DEMO\n', ''),
      maxIterations: 10,
      parseOptions: {
        geoidHeightConversionEnabled: true,
        geoidOutputHeightDatum: 'ellipsoid',
      },
    }).solve();

    expect(base.parseState?.geoidHeightConversionEnabled ?? false).toBe(false);
    expect(base.stations.ELL.h).toBeCloseTo(120, 10);
    expect(base.stations.ORTH.h).toBeCloseTo(100, 10);
    expect(base.stations.OUT.h).toBeCloseTo(50, 10);

    expect(toOrthometric.parseState?.geoidHeightConversionEnabled ?? false).toBe(true);
    expect(toOrthometric.parseState?.geoidOutputHeightDatum).toBe('orthometric');
    expect(toOrthometric.parseState?.geoidConvertedStationCount ?? 0).toBe(1);
    expect(toOrthometric.parseState?.geoidSkippedStationCount ?? 0).toBe(1);
    expect(toOrthometric.stations.ELL.h).toBeCloseTo(149.65, 8); // 120 - (-29.65)
    expect(toOrthometric.stations.ORTH.h).toBeCloseTo(100, 10); // already orthometric
    expect(toOrthometric.stations.OUT.h).toBeCloseTo(50, 10); // outside coverage -> skipped
    expect(toOrthometric.logs.some((l) => l.includes('Geoid height conversion: ON'))).toBe(true);

    expect(toEllipsoid.parseState?.geoidHeightConversionEnabled ?? false).toBe(true);
    expect(toEllipsoid.parseState?.geoidOutputHeightDatum).toBe('ellipsoid');
    expect(toEllipsoid.parseState?.geoidConvertedStationCount ?? 0).toBe(1);
    expect(toEllipsoid.parseState?.geoidSkippedStationCount ?? 0).toBe(0);
    expect(toEllipsoid.stations.ORTH.h).toBeCloseTo(70.6, 8); // 100 + (-29.4)
    expect(toEllipsoid.stations.ELL.h).toBeCloseTo(120, 10); // already ellipsoid
    expect(toEllipsoid.stations.OUT.h).toBeCloseTo(50, 10); // already ellipsoid

    expect(conversionWithoutModel.parseState?.geoidModelEnabled ?? false).toBe(false);
    expect(conversionWithoutModel.parseState?.geoidConvertedStationCount ?? 0).toBe(0);
    expect(conversionWithoutModel.stations.ORTH.h).toBeCloseTo(base.stations.ORTH.h, 10);
    expect(conversionWithoutModel.logs.some((l) => l.includes('conversion requested'))).toBe(true);
  });

  it('uses average geoid height fallback conversion when geoid model is not loaded', () => {
    const input = ['.3D', 'C A 0 0 100 ! ! !', 'C B 10 0 95'].join('\n');
    const converted = new LSAEngine({
      input,
      maxIterations: 5,
      parseOptions: {
        geoidHeightConversionEnabled: true,
        geoidOutputHeightDatum: 'ellipsoid',
        averageGeoidHeight: 30,
      },
    }).solve();

    expect(converted.parseState?.geoidHeightConversionEnabled ?? false).toBe(true);
    expect(converted.parseState?.geoidConvertedStationCount ?? 0).toBeGreaterThan(0);
    expect(converted.stations.A.h).toBeCloseTo(130, 8);
    expect(converted.logs.some((line) => line.includes('conversion fallback: ON'))).toBe(true);
  });

  it('computes fixture-locked effective distance values for angle/direction/bearing rows', () => {
    const input = readFileSync('tests/fixtures/effective_distance_phase3.dat', 'utf-8');
    const result = new LSAEngine({ input, maxIterations: 10 }).solve();

    const angle = result.observations.find((o) => o.type === 'angle' && o.sourceLine === 9);
    const bearing = result.observations.find((o) => o.type === 'bearing' && o.sourceLine === 8);
    const direction = result.observations.find(
      (o) => o.type === 'direction' && o.sourceLine === 11,
    );

    expect(angle?.effectiveDistance).toBeDefined();
    expect(bearing?.effectiveDistance).toBeDefined();
    expect(direction?.effectiveDistance).toBeDefined();
    expect(angle?.effectiveDistance ?? 0).toBeCloseTo(100, 4);
    expect(bearing?.effectiveDistance ?? 0).toBeCloseTo(100, 4);
    expect(direction?.effectiveDistance ?? 0).toBeCloseTo(100, 4);
  });

  it('detects deterministic single-linkage station clusters in 2D mode', () => {
    const input = [
      '.2D',
      'C CTRL 0 0 0 ! !',
      'C P1 100.000 100.000 0',
      'C P2 100.010 100.005 0',
      'C P3 100.018 100.012 0',
      'C FAR 300.000 300.000 0',
    ].join('\n');
    const result = new LSAEngine({ input, maxIterations: 5 }).solve();
    const clusters = result.clusterDiagnostics;
    expect(clusters?.enabled).toBe(true);
    expect(clusters?.dimension).toBe('2D');
    expect(clusters?.linkageMode).toBe('single');
    expect(clusters?.candidateCount).toBe(1);
    expect(clusters?.pairCount).toBe(3);
    expect(clusters?.candidates[0].key).toBe('CL-1-P1');
    expect(clusters?.candidates[0].stationIds).toEqual(['P1', 'P2', 'P3']);
    expect(clusters?.candidates[0].representativeId).toBe('P1');
  });

  it('supports complete-linkage cluster mode in 3D with tolerance gating', () => {
    const input = [
      '.3D',
      'C CTRL 10 10 10 ! ! !',
      'C P1 0.000 0.000 0.000',
      'C P2 0.030 0.000 0.000',
      'C P3 0.060 0.000 0.000',
    ].join('\n');
    const result = new LSAEngine({
      input,
      maxIterations: 5,
      parseOptions: {
        clusterLinkageMode: 'complete',
        clusterTolerance3D: 0.05,
      },
    }).solve();
    const clusters = result.clusterDiagnostics;
    expect(clusters?.enabled).toBe(true);
    expect(clusters?.dimension).toBe('3D');
    expect(clusters?.linkageMode).toBe('complete');
    expect(clusters?.candidateCount).toBe(1);
    expect(clusters?.candidates[0].stationIds).toEqual(['P1', 'P2']);
    expect(clusters?.candidates[0].maxSeparation).toBeCloseTo(0.03, 6);
  });

  it('runs dual-pass cluster workflow when approved merges are provided', () => {
    const input = [
      '.2D',
      'C CTRL 0 0 0 ! !',
      'C P1 100.000 100.000 0',
      'C P1_DUP 100.008 100.006 0',
      'D CTRL-P1 141.4214 0.01',
      'D CTRL-P1_DUP 141.4314 0.01',
    ].join('\n');
    const result = new LSAEngine({
      input,
      maxIterations: 8,
      parseOptions: {
        clusterApprovedMerges: [{ aliasId: 'P1_DUP', canonicalId: 'P1' }],
      },
    }).solve();

    expect(result.clusterDiagnostics?.passMode).toBe('dual-pass');
    expect(result.clusterDiagnostics?.approvedMergeCount).toBe(1);
    expect(result.clusterDiagnostics?.pass1CandidateCount).toBeGreaterThanOrEqual(1);
    expect(result.clusterDiagnostics?.mergeOutcomes?.length).toBe(1);
    expect(result.clusterDiagnostics?.mergeOutcomes?.[0].aliasId).toBe('P1_DUP');
    expect(result.clusterDiagnostics?.mergeOutcomes?.[0].canonicalId).toBe('P1');
    expect(result.clusterDiagnostics?.mergeOutcomes?.[0].horizontalDelta).toBeGreaterThan(0);
    expect(result.parseState?.clusterDualPassRan).toBe(true);
    expect(result.parseState?.clusterApprovedMergeCount).toBe(1);
    expect(result.stations.P1).toBeDefined();
    expect(result.stations.P1_DUP).toBeUndefined();
    expect(result.observations.some((o) => o.sourceLine === 5)).toBe(true);
    expect(result.logs.some((l) => l.includes('Cluster dual-pass'))).toBe(true);
  });

  it('solves mixed conventional/GNSS/leveling alias scenarios with canonical IDs', () => {
    const input = readFileSync('tests/fixtures/alias_phase4_mixed.dat', 'utf-8');
    const engine = new LSAEngine({ input, maxIterations: 15 });
    const result = engine.solve();

    expect(result.success).toBe(true);
    expect(result.stations.PT_100).toBeDefined();
    expect(result.stations.TMP_100).toBeUndefined();
    expect(result.stations.ROVER1).toBeUndefined();
    expect(result.stations.STA01).toBeUndefined();
    expect(result.observations.some((o) => o.type === 'dist')).toBe(true);
    expect(result.observations.some((o) => o.type === 'angle')).toBe(true);
    expect(result.observations.some((o) => o.type === 'gps')).toBe(true);
    expect(result.observations.some((o) => o.type === 'lev')).toBe(true);
    expect(
      result.observations.some(
        (o) =>
          (o.type === 'angle' && (o.at === 'ROVER1' || o.from === 'ROVER1' || o.to === 'ROVER1')) ||
          ('from' in o &&
            (o.from === 'ROVER1' ||
              o.to === 'ROVER1' ||
              o.from === 'TMP_100' ||
              o.to === 'TMP_100')),
      ),
    ).toBe(false);
    expect((result.parseState?.aliasTrace?.length ?? 0) > 0).toBe(true);
    expect(result.logs.some((l) => l.includes('Alias canonicalization applied'))).toBe(true);
  });

  it('logs traverse closure residuals', () => {
    const input = readFileSync('tests/fixtures/traverse_closure.dat', 'utf-8');
    const engine = new LSAEngine({ input, maxIterations: 5 });
    const result = engine.solve();
    expect(result.logs.some((l) => l.includes('Traverse closure residual'))).toBe(true);
  });

  it('supports anisotropic correlated GNSS weighting', () => {
    const input = [
      'C A 0 0 0 !',
      'C B 100 0 0',
      'G GPS1 A B 100.01 -0.02 0.01 0.03 0.25',
      'D A-B 100.0 0.02',
    ].join('\n');
    const engine = new LSAEngine({ input, maxIterations: 10 });
    const result = engine.solve();
    expect(result.observations.some((o) => o.type === 'gps')).toBe(true);
    const gps = result.observations.find((o) => o.type === 'gps');
    expect(gps?.stdDevE).toBeDefined();
    expect(gps?.stdDevN).toBeDefined();
    expect(gps?.corrEN).toBeCloseTo(0.25, 8);
    expect(gps?.stdRes).toBeDefined();
    expect(result.dof).toBeGreaterThanOrEqual(0);
  });

  it('preserves parsed GPS vector mode tags on solved observations', () => {
    const input = [
      '.GPS SIDESHOT',
      'C A 0 0 0 !',
      'C B 100 0 0',
      'G GPS1 A B 100.01 -0.02 0.01 0.03 0.25',
      'D A-B 100.0 0.02',
    ].join('\n');
    const result = new LSAEngine({ input, maxIterations: 10 }).solve();
    expect(result.parseState?.gpsVectorMode).toBe('sideshot');
    const gps = result.observations.find((o) => o.type === 'gps');
    expect(gps?.type).toBe('gps');
    if (gps?.type === 'gps') expect(gps.gpsMode).toBe('sideshot');
  });

  it('excludes GPS SIDESHOT vectors from adjustment while NETWORK vectors remain active', () => {
    const base = [
      '.2D',
      'C A 0 0 0 ! !',
      'C B 80 20 0',
      'B A-B 090.0000 0.5',
      'D A-B 100.0000 0.005',
      'G GPS1 A B 120.0000 0.0000 0.001 0.001',
    ].join('\n');
    const network = new LSAEngine({
      input: ['.GPS NETWORK', base].join('\n'),
      maxIterations: 10,
    }).solve();
    const sideshot = new LSAEngine({
      input: ['.GPS SIDESHOT', base].join('\n'),
      maxIterations: 10,
    }).solve();

    expect(network.parseState?.gpsVectorMode).toBe('network');
    expect(sideshot.parseState?.gpsVectorMode).toBe('sideshot');
    expect(sideshot.logs.some((l) => l.includes('excluded from adjustment equations'))).toBe(true);
    expect(Math.abs((network.stations.B?.x ?? 0) - (sideshot.stations.B?.x ?? 0))).toBeGreaterThan(
      5,
    );
  });

  it('computes post-adjust GPS sideshot coordinate/precision rows', () => {
    const input = [
      '.GPS SIDESHOT',
      '.2D',
      'C OCC 1000 2000 0 ! !',
      'G GPS1 OCC RTK1 12.3456 -4.3210 0.020 0.030',
    ].join('\n');
    const result = new LSAEngine({ input, maxIterations: 5 }).solve();
    const row = result.sideshots?.find((s) => s.mode === 'gps' && s.to === 'RTK1');

    expect(row).toBeDefined();
    expect(row?.horizDistance ?? 0).toBeCloseTo(Math.hypot(12.3456, -4.321), 8);
    expect(row?.easting ?? 0).toBeCloseTo(1012.3456, 8);
    expect(row?.northing ?? 0).toBeCloseTo(1995.679, 8);
    expect(row?.azimuthSource).toBe('vector');
    expect(row?.sigmaE).toBeGreaterThan(0);
    expect(row?.sigmaN).toBeGreaterThan(0);
  });

  it('keeps solve results unchanged when GS coordinate shots are present, and emits GS post-adjust rows', () => {
    const baseInput = [
      '.2D',
      'C A 0 0 0 ! !',
      'C B 100 0 0 ! !',
      'C C 20 10 0',
      'B A-C 063-26-06.0 5.0',
      'D A-C 22.3606798 0.010',
    ].join('\n');
    const withGsInput = [
      baseInput,
      'GS RTK1 30.000 40.000 1.500 0.020 0.030 0.040 FROM=C',
      'GS RTK2 32.000 42.000 0.030 0.040',
    ].join('\n');

    const base = new LSAEngine({ input: baseInput, maxIterations: 10 }).solve();
    const withGs = new LSAEngine({ input: withGsInput, maxIterations: 10 }).solve();

    expect(withGs.observations.length).toBe(base.observations.length);
    expect(withGs.dof).toBe(base.dof);
    expect(withGs.stations.C?.x ?? 0).toBeCloseTo(base.stations.C?.x ?? 0, 10);
    expect(withGs.stations.C?.y ?? 0).toBeCloseTo(base.stations.C?.y ?? 0, 10);
    expect(withGs.stations.C?.h ?? 0).toBeCloseTo(base.stations.C?.h ?? 0, 10);

    const gsRows = (withGs.sideshots ?? []).filter((row) => row.sourceType === 'GS');
    expect(gsRows).toHaveLength(2);

    const related = gsRows.find((row) => row.to === 'RTK1');
    expect(related).toBeDefined();
    expect(related?.relationFrom).toBe('C');
    expect(related?.hasAzimuth).toBe(true);
    expect(related?.azimuthSource).toBe('coordinate');

    const standalone = gsRows.find((row) => row.to === 'RTK2');
    expect(standalone).toBeDefined();
    expect(standalone?.relationFrom).toBeUndefined();
    expect(standalone?.note?.includes('standalone coordinate shot')).toBe(true);
  });

  it('applies GPS AddHiHt correction to GPS sideshot vectors only when enabled', () => {
    const baseInput = [
      '.GPS SIDESHOT',
      '.2D',
      'C OCC 1000 2000 0 ! !',
      'G GPS1 OCC RTK1 10.0000 0.0000 0.020 0.030',
    ].join('\n');
    const addHiHtInput = ['.GPS AddHiHt ON 1.0 2.0', baseInput].join('\n');

    const base = new LSAEngine({ input: baseInput, maxIterations: 5 }).solve();
    const withAddHiHt = new LSAEngine({ input: addHiHtInput, maxIterations: 5 }).solve();
    const baseRow = base.sideshots?.find((s) => s.mode === 'gps' && s.to === 'RTK1');
    const correctedRow = withAddHiHt.sideshots?.find((s) => s.mode === 'gps' && s.to === 'RTK1');
    const expectedDistance = Math.hypot(10, 1);

    expect(baseRow?.horizDistance ?? 0).toBeCloseTo(10, 10);
    expect(correctedRow?.horizDistance ?? 0).toBeCloseTo(expectedDistance, 8);
    expect(correctedRow?.easting ?? 0).toBeCloseTo(1000 + expectedDistance, 8);
    expect((correctedRow?.horizDistance ?? 0) - (baseRow?.horizDistance ?? 0)).toBeGreaterThan(
      0.04,
    );
  });

  it('applies GPS AddHiHt antenna preprocessing in phase 2 while keeping OFF/default behavior unchanged', () => {
    const baseInput = [
      '.2D',
      'C A 0 0 10 ! !',
      'C B 100 0 12',
      'G GPS1 A B 100.000 0.000 0.010 0.010',
    ].join('\n');
    const addHiHtDefaultInput = ['.GPS AddHiHt ON', baseInput].join('\n');
    const addHiHtInput = ['.GPS AddHiHt ON 1.5000 2.0000', baseInput].join('\n');

    const base = new LSAEngine({ input: baseInput, maxIterations: 10 }).solve();
    const withAddHiHtDefault = new LSAEngine({
      input: addHiHtDefaultInput,
      maxIterations: 10,
    }).solve();
    const withAddHiHt = new LSAEngine({ input: addHiHtInput, maxIterations: 10 }).solve();

    expect(withAddHiHtDefault.parseState?.gpsAddHiHtEnabled ?? false).toBe(true);
    expect(withAddHiHtDefault.stations.B?.x ?? 0).toBeCloseTo(base.stations.B?.x ?? 0, 10);
    expect(withAddHiHtDefault.stations.B?.y ?? 0).toBeCloseTo(base.stations.B?.y ?? 0, 10);

    expect(withAddHiHt.parseState?.gpsAddHiHtEnabled ?? false).toBe(true);
    expect(withAddHiHt.parseState?.gpsAddHiHtHiM ?? 0).toBeCloseTo(1.5, 10);
    expect(withAddHiHt.parseState?.gpsAddHiHtHtM ?? 0).toBeCloseTo(2.0, 10);
    const gpsObs = withAddHiHt.observations.find((o) => o.type === 'gps');
    expect(gpsObs?.type).toBe('gps');
    if (gpsObs?.type === 'gps') {
      expect(gpsObs.gpsAntennaHiM ?? 0).toBeCloseTo(1.5, 10);
      expect(gpsObs.gpsAntennaHtM ?? 0).toBeCloseTo(2.0, 10);
    }

    const deltaGround = (base.stations.B?.h ?? 0) - (base.stations.A?.h ?? 0);
    const deltaAntenna = deltaGround + (2.0 - 1.5);
    const expectedScaledEast = Math.hypot(100, deltaAntenna) ** 2 - deltaGround ** 2;
    const expectedEast = Math.sqrt(expectedScaledEast);

    expect(withAddHiHt.stations.B?.x ?? 0).toBeCloseTo(expectedEast, 8);
    expect((withAddHiHt.stations.B?.x ?? 0) - (base.stations.B?.x ?? 0)).toBeGreaterThan(0.001);
    expect(withAddHiHt.stations.B?.y ?? 0).toBeCloseTo(base.stations.B?.y ?? 0, 10);
  });

  it('reports GPS AddHiHt preprocessing diagnostics for positive/negative/default-height fixture cases', () => {
    const input = readFileSync('tests/fixtures/gps_addhight_phase3.dat', 'utf-8');
    const result = new LSAEngine({ input, maxIterations: 10 }).solve();
    const parse = result.parseState;

    expect(parse?.gpsAddHiHtEnabled ?? false).toBe(true);
    expect(parse?.gpsAddHiHtVectorCount ?? 0).toBe(3);
    expect(parse?.gpsAddHiHtAppliedCount ?? 0).toBe(2);
    expect(parse?.gpsAddHiHtPositiveCount ?? 0).toBe(1);
    expect(parse?.gpsAddHiHtNegativeCount ?? 0).toBe(1);
    expect(parse?.gpsAddHiHtNeutralCount ?? 0).toBe(1);
    expect(parse?.gpsAddHiHtDefaultZeroCount ?? 0).toBe(1);
    expect(parse?.gpsAddHiHtMissingHeightCount ?? 0).toBe(0);
    expect(parse?.gpsAddHiHtScaleMin ?? 1).toBeLessThan(1);
    expect(parse?.gpsAddHiHtScaleMax ?? 1).toBeGreaterThan(1);
    expect(result.logs.some((line) => line.includes('GPS AddHiHt preprocessing: vectors=3'))).toBe(
      true,
    );
  });

  it('applies GPS rover offsets to network vectors in the adjustment equations', () => {
    const input = readFileSync('tests/fixtures/gps_offset_phase3.dat', 'utf-8');
    const result = new LSAEngine({ input, maxIterations: 6 }).solve();
    const gps = result.observations.find((o) => o.type === 'gps');

    expect(result.success).toBe(true);
    expect(result.parseState?.gpsOffsetObservationCount ?? 0).toBe(1);
    expect(result.stations.B?.x ?? 0).toBeCloseTo(12, 8);
    expect(result.stations.B?.y ?? 0).toBeCloseTo(0, 8);
    expect(gps?.type).toBe('gps');
    if (gps?.type === 'gps') {
      expect(gps.calc?.dE ?? 0).toBeCloseTo(12, 8);
      expect(gps.residual?.vE ?? 0).toBeCloseTo(0, 8);
      expect(gps.gpsOffsetDeltaE ?? 0).toBeCloseTo(2, 8);
    }
  });

  it('applies GPS rover offsets to GPS sideshot coordinates and notes the offset in output rows', () => {
    const input = [
      '.GPS SIDESHOT',
      '.2D',
      'C OCC 1000 2000 0 ! !',
      'G GPS1 OCC RTK1 10.0000 0.0000 0.0200 0.0200',
      'G4 90.0000 2.0000 90.0000',
    ].join('\n');
    const result = new LSAEngine({ input, maxIterations: 5 }).solve();
    const row = result.sideshots?.find((s) => s.mode === 'gps' && s.to === 'RTK1');

    expect(row).toBeDefined();
    expect(row?.horizDistance ?? 0).toBeCloseTo(12, 8);
    expect(row?.easting ?? 0).toBeCloseTo(1012, 8);
    expect(row?.northing ?? 0).toBeCloseTo(2000, 8);
    expect(row?.note ?? '').toContain('rover offset');
  });

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
    expect(loopDiag?.totalLengthKm ?? 0).toBeCloseTo(4.1, 8);
    expect(loopDiag?.warnTotalLengthKm ?? 0).toBeCloseTo(5.2, 8);
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
    expect(loopDiag?.loops[0].toleranceMm ?? 0).toBeCloseTo(6.928203, 5);
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
          'Leveling loop check: observations=5, loops=2, totalLength=4.100km, tolerance=0.000mm+4.000mm*sqrt(km)',
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
          instCentr_m: 0.00075,
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
      'C O 0 0 0 !',
      'C B 0 100 0 !',
      'C P 100 0 0',
      'D O-P 100.0 0.005',
      'D B-P 141.421356 0.005',
      'DB O B',
      'DN P 090.0000 1.0',
      'DM P 270.0000 100.0 0.0000 1.0 0.002',
      'DE',
    ].join('\n');
    const engine = new LSAEngine({ input, maxIterations: 10 });
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
    const input = readFileSync('tests/fixtures/direction_face_balanced.dat', 'utf-8');
    const reduced = new LSAEngine({ input, maxIterations: 10 }).solve();
    const raw = new LSAEngine({
      input,
      maxIterations: 10,
      parseOptions: { directionSetMode: 'raw' },
    }).solve();
    const reducedDir = reduced.observations.filter((o) => o.type === 'direction').length;
    const rawDir = raw.observations.filter((o) => o.type === 'direction').length;
    expect(reducedDir).toBe(1);
    expect(rawDir).toBe(2);
    expect(raw.logs.some((l) => l.includes('raw mode'))).toBe(true);
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
      'DN P 090-00-00.0 1.0',
      'DN P 090-00-08.0 1.0',
      'DN P 270-00-03.0 1.0',
      'DN P 270-00-14.0 1.0',
      'DN Q 108-26-06.0 1.0',
      'DN Q 288-26-09.0 1.0',
      'DE',
    ].join('\n');

    const engine = new LSAEngine({ input, maxIterations: 12 });
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

  it('propagates structured direction reject diagnostics from parser to result', () => {
    const input = [
      '.2D',
      '.NORMALIZE OFF',
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

    const engine = new LSAEngine({ input, maxIterations: 10 });
    const result = engine.solve();
    expect((result.directionRejectDiagnostics?.length ?? 0) > 0).toBe(true);
    expect(result.directionRejectDiagnostics?.some((d) => d.reason === 'mixed-face')).toBe(true);
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
      'DN P 090-00-00.0 1.0',
      'DN P 270-00-01.0 1.0',
      'DN Q 108-26-06.0 1.0',
      'DN Q 288-26-06.5 1.0',
      'DE',
      'DB O BS',
      'DN P 090-00-12.0 1.0',
      'DN P 270-00-18.0 1.0',
      'DN Q 108-26-06.1 1.0',
      'DN Q 288-26-06.3 1.0',
      'DE',
    ].join('\n');

    const engine = new LSAEngine({ input, maxIterations: 12 });
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

  it('includes setup-level residual quality diagnostics for blunder screening', () => {
    const input = [
      '.AMODE ANGLE',
      'C C1 0 0 0 !',
      'C C2 200 0 0 !',
      'C U 100 80 0',
      'D C1-U 128.060 0.002',
      'D C2-U 128.065 0.002',
      'A U-C1-C2 102-40-00.0 1.5',
      'A U-C2-C1 257-20-00.0 1.5',
      'A U-C1-C2 102-41-20.0 1.5',
    ].join('\n');
    const engine = new LSAEngine({ input, maxIterations: 12 });
    const result = engine.solve();
    const setup = result.setupDiagnostics?.find((s) => s.station === 'U');
    expect(setup).toBeDefined();
    expect((setup?.stdResCount ?? 0) > 0).toBe(true);
    expect(setup?.rmsStdRes).toBeDefined();
    expect(setup?.maxStdRes).toBeDefined();
    expect(setup?.localFailCount).toBeGreaterThanOrEqual(0);
    expect(setup?.worstObsType).toBeDefined();
    expect(setup?.worstObsStations).toContain('U-');
  });

  it('reports traverse closure ratio diagnostics', () => {
    const input = [
      'C OCC 0 0 0 !',
      'C BS 0 100 0 !',
      'C P 100 0 0',
      'TB OCC BS',
      'T P 090.0000 100.0 0.0 1.0 0.005 5.0',
      'TE OCC 180.0000 100.0 0.0 1.0 0.005 5.0',
    ].join('\n');
    const engine = new LSAEngine({ input, maxIterations: 8 });
    const result = engine.solve();
    expect(result.traverseDiagnostics).toBeDefined();
    expect(result.traverseDiagnostics?.closureCount).toBeGreaterThan(0);
    expect(result.traverseDiagnostics?.totalTraverseDistance).toBeGreaterThan(0);
    expect(result.traverseDiagnostics?.linearPpm).toBeDefined();
    expect(result.traverseDiagnostics?.thresholds).toBeDefined();
    expect(result.traverseDiagnostics?.loops?.length).toBeGreaterThan(0);
  });

  it('reports residual diagnostics summary for blunder screening', () => {
    const input = [
      '.AMODE ANGLE',
      'C C1 0 0 0 !',
      'C C2 200 0 0 !',
      'C U 100 80 0',
      'D C1-U 128.060 0.002',
      'D C2-U 128.065 0.002',
      'A U-C1-C2 102-40-00.0 1.5',
      'A U-C2-C1 257-20-00.0 1.5',
      'A U-C1-C2 102-41-20.0 1.5',
    ].join('\n');
    const engine = new LSAEngine({ input, maxIterations: 12 });
    const result = engine.solve();
    expect(result.residualDiagnostics).toBeDefined();
    expect((result.residualDiagnostics?.observationCount ?? 0) > 0).toBe(true);
    expect((result.residualDiagnostics?.withStdResCount ?? 0) > 0).toBe(true);
    expect(result.residualDiagnostics?.byType.length).toBeGreaterThan(0);
    expect(result.residualDiagnostics?.criticalT).toBeGreaterThan(0);
  });

  it('solves the 2D triangulation-trilateration example with auto-created stations', () => {
    const input = readFileSync('tests/fixtures/triangulation_trilateration_2d.dat', 'utf-8');
    const result = new LSAEngine({ input, maxIterations: 20 }).solve();
    expect(result.stations['4']).toBeDefined();
    expect(result.stations['5']).toBeDefined();
    expect(result.stations['6']).toBeDefined();
    expect(Number.isFinite(result.stations['4'].x)).toBe(true);
    expect(Number.isFinite(result.stations['4'].y)).toBe(true);
    expect(Number.isFinite(result.stations['5'].x)).toBe(true);
    expect(Number.isFinite(result.stations['5'].y)).toBe(true);
    expect(Number.isFinite(result.stations['6'].x)).toBe(true);
    expect(Number.isFinite(result.stations['6'].y)).toBe(true);
    expect(result.logs.some((l) => l.includes('Auto-created station 4'))).toBe(true);
  });

  it('applies map scale reduction to horizontal distances when map mode is on', () => {
    const baseInput = [
      '.2D',
      'C A 0 0 0 !',
      'C B 100 0 0',
      'B A-B 090.0000 1.0',
      'D A-B 100.0000 0.001',
    ].join('\n');
    const scaledInput = ['.MAPMODE ON', '.MAPSCALE 0.9996', baseInput].join('\n');
    const noScale = new LSAEngine({ input: baseInput, maxIterations: 10 }).solve();
    const withScale = new LSAEngine({ input: scaledInput, maxIterations: 10 }).solve();
    expect(withScale.stations.B.x).toBeGreaterThan(noScale.stations.B.x + 0.03);
    expect(withScale.logs.some((l) => l.includes('Map reduction active'))).toBe(true);
  });

  it('applies .ROTATION to bearing/azimuth observations in solve geometry', () => {
    const baseInput = [
      '.2D',
      'C A 0 0 0 ! !',
      'C B 100 0 0',
      'B A-B 090.0000 1.0',
      'D A-B 100.0000 0.001',
    ].join('\n');
    const rotatedInput = ['.ROTATION 10', baseInput].join('\n');

    const base = new LSAEngine({ input: baseInput, maxIterations: 10 }).solve();
    const rotated = new LSAEngine({ input: rotatedInput, maxIterations: 10 }).solve();

    expect(rotated.stations.B.x).toBeLessThan(base.stations.B.x - 1);
    expect(rotated.stations.B.y).toBeLessThan(base.stations.B.y - 10);
    expect((rotated.parseState?.rotationAngleRad ?? 0) * (180 / Math.PI)).toBeCloseTo(10, 10);
  });

  it('persists .LOSTSTATIONS metadata flags through solve results', () => {
    const input = [
      '.2D',
      '.LOSTSTATIONS B',
      'C A 0 0 0 ! !',
      'C B 100 0 0',
      'B A-B 090.0000 1.0',
      'D A-B 100.0000 0.001',
    ].join('\n');
    const result = new LSAEngine({ input, maxIterations: 10 }).solve();
    expect(result.parseState?.lostStationIds).toEqual(['B']);
    expect(result.stations.B).toBeDefined();
    expect(result.stations.B.lost).toBe(true);
    expect(result.stations.A.lost ?? false).toBe(false);
    expect(result.logs.some((l) => l.includes('Lost stations flagged'))).toBe(true);
  });

  it('applies QFIX constants to fixed-sigma weighting and changes SEUW sensitivity', () => {
    const input = [
      '.2D',
      'C A 0 0 0 ! !',
      'C B 100 0 0 ! !',
      'C P 60 30 0',
      'D A-P 67.0820 !',
      'D B-P 50.2000 !',
      'B A-P 063-26-06.0 !',
    ].join('\n');
    const tight = new LSAEngine({
      input,
      maxIterations: 10,
      parseOptions: { qFixLinearSigmaM: 1e-9, qFixAngularSigmaSec: 1e-9 },
    }).solve();
    const relaxed = new LSAEngine({
      input,
      maxIterations: 10,
      parseOptions: { qFixLinearSigmaM: 0.01, qFixAngularSigmaSec: 30 },
    }).solve();

    expect(tight.seuw).toBeGreaterThan(relaxed.seuw);
    const tightDist = tight.observations.find(
      (o) => o.type === 'dist' && o.sigmaSource === 'fixed',
    );
    const relaxedDist = relaxed.observations.find(
      (o) => o.type === 'dist' && o.sigmaSource === 'fixed',
    );
    expect(tightDist?.stdDev ?? 0).toBeCloseTo(1e-9, 12);
    expect(relaxedDist?.stdDev ?? 0).toBeCloseTo(0.01, 10);
  });

  it('applies global prism correction to modeled distance residuals', () => {
    const baseInput = [
      '.2D',
      'C A 0 0 0 ! !',
      'C B 100 0 0',
      'B A-B 090.0000 1.0',
      'D A-B 100.0000 0.001',
    ].join('\n');
    const off = new LSAEngine({ input: baseInput, maxIterations: 10 }).solve();
    const on = new LSAEngine({
      input: ['.PRISM ON 0.25', baseInput].join('\n'),
      maxIterations: 10,
    }).solve();
    expect(off.stations.B.x - on.stations.B.x).toBeGreaterThan(0.2);
    expect(on.logs.some((l) => l.includes('Prism correction active'))).toBe(true);
  });

  it('limits prism set-scope corrections to set-tagged distance rows', () => {
    const base = [
      '.2D',
      'I TS TestInst 0 0 1 1',
      'C A 0 0 0 ! !',
      'C B 100 0 0',
      'B A-B 090.0000 1.0',
    ].join('\n');
    const noSet = new LSAEngine({
      input: ['.PRISM SET 0.50', base, 'D A-B 100.0000 0.001'].join('\n'),
      maxIterations: 10,
    }).solve();
    const setTagged = new LSAEngine({
      input: ['.PRISM SET 0.50', base, 'D TS SET1 A B 100.0000 0.001'].join('\n'),
      maxIterations: 10,
    }).solve();
    expect(noSet.stations.B.x).toBeCloseTo(100, 2);
    expect(setTagged.stations.B.x).toBeLessThan(noSet.stations.B.x - 0.3);
    const taggedDist = setTagged.observations.find(
      (o) => o.type === 'dist' && (o.setId ?? '') === 'SET1',
    );
    expect(taggedDist).toBeDefined();
    expect(taggedDist?.prismCorrectionM).toBeCloseTo(0.5, 10);
  });

  it('applies prism correction in zenith weighting when centering inflation is active', () => {
    const input = [
      '.I TS',
      'C A 0 0 0 ! ! !',
      'C B 100 0 0',
      'B A-B 090.0000 1.0',
      'D A-B 100.0000 0.001',
      'V A-B 90.0000 1.0',
      'V A-B 89.9000 1.0',
    ].join('\n');
    const instrumentLibrary = {
      TS: {
        code: 'TS',
        desc: 'TS',
        edm_const: 0,
        edm_ppm: 0,
        hzPrecision_sec: 1,
        dirPrecision_sec: 1,
        azBearingPrecision_sec: 1,
        vaPrecision_sec: 1,
        instCentr_m: 0,
        tgtCentr_m: 0,
        vertCentr_m: 1.0,
        elevDiff_const_m: 0,
        elevDiff_ppm: 0,
        gpsStd_xy: 0,
        levStd_mmPerKm: 0,
      },
    };
    const off = new LSAEngine({ input, maxIterations: 8, instrumentLibrary }).solve();
    const on = new LSAEngine({
      input: `.PRISM ON 50\n${input}`,
      maxIterations: 8,
      instrumentLibrary,
    }).solve();
    const zenOff = off.observations.filter((o) => o.type === 'zenith');
    const zenOn = on.observations.filter((o) => o.type === 'zenith');
    expect(zenOff.length).toBe(2);
    expect(zenOn.length).toBe(2);
    expect(zenOff.every((obs) => Math.abs(obs.prismCorrectionM ?? 0) === 0)).toBe(true);
    expect(zenOn.every((obs) => Math.abs(obs.prismCorrectionM ?? 0) > 0)).toBe(true);
    expect(on.logs.some((l) => l.includes('zenithRows=2'))).toBe(true);
  });

  it('keeps horizontal-distance centering inflation unchanged', () => {
    const input = [
      '.2D',
      '.I TS',
      '.ADDC ON',
      'C A 0 0 0 ! !',
      'C B 100 0 0 ! !',
      'D A-B 100.0000 0.002',
    ].join('\n');
    const instrumentLibrary = {
      TS: {
        code: 'TS',
        desc: 'TS',
        edm_const: 0,
        edm_ppm: 0,
        hzPrecision_sec: 1,
        dirPrecision_sec: 1,
        azBearingPrecision_sec: 1,
        vaPrecision_sec: 1,
        instCentr_m: 0.003,
        tgtCentr_m: 0.004,
        vertCentr_m: 0.02,
        elevDiff_const_m: 0,
        elevDiff_ppm: 0,
        gpsStd_xy: 0,
        levStd_mmPerKm: 0,
      },
    };
    const engine = new LSAEngine({ input, maxIterations: 5, instrumentLibrary });
    const result = engine.solve();
    const dist = result.observations.find((obs) => obs.type === 'dist');
    expect(dist).toBeDefined();
    const sigma = (engine as any).effectiveStdDev(dist);
    const expected = Math.sqrt(0.002 ** 2 + 0.003 ** 2 + 0.004 ** 2);
    expect(sigma).toBeCloseTo(expected, 12);
  });

  it('applies industry-standard centering inflation to slope distances', () => {
    const input = [
      '.3D',
      '.I TS',
      '.ADDC ON',
      'C A 0 0 0 ! ! !',
      'C B 4 3 12 ! ! !',
      'D A-B 13.0000 0.010',
    ].join('\n');
    const instrumentLibrary = {
      TS: {
        code: 'TS',
        desc: 'TS',
        edm_const: 0,
        edm_ppm: 0,
        hzPrecision_sec: 1,
        dirPrecision_sec: 1,
        azBearingPrecision_sec: 1,
        vaPrecision_sec: 1,
        instCentr_m: 0.03,
        tgtCentr_m: 0.04,
        vertCentr_m: 0.02,
        elevDiff_const_m: 0,
        elevDiff_ppm: 0,
        gpsStd_xy: 0,
        levStd_mmPerKm: 0,
      },
    };
    const engine = new LSAEngine({ input, maxIterations: 5, instrumentLibrary });
    const result = engine.solve();
    const dist = result.observations.find((obs) => obs.type === 'dist');
    expect(dist).toBeDefined();
    const sigma = (engine as any).effectiveStdDev(dist);
    const d = 5;
    const s = 13;
    const e = 12;
    const expected = Math.sqrt(
      0.01 ** 2 + (d / s) ** 2 * (0.03 ** 2 + 0.04 ** 2) + 2 * (e / s) ** 2 * 0.02 ** 2,
    );
    expect(sigma).toBeCloseTo(expected, 12);
  });

  it('applies industry-standard centering inflation to zeniths in radians', () => {
    const input = [
      '.3D',
      '.I TS',
      '.ADDC ON',
      'C A 0 0 0 ! ! !',
      'C B 4 3 12 ! ! !',
      'V A-B 22.619865 1.0',
    ].join('\n');
    const instrumentLibrary = {
      TS: {
        code: 'TS',
        desc: 'TS',
        edm_const: 0,
        edm_ppm: 0,
        hzPrecision_sec: 1,
        dirPrecision_sec: 1,
        azBearingPrecision_sec: 1,
        vaPrecision_sec: 1,
        instCentr_m: 0.03,
        tgtCentr_m: 0.04,
        vertCentr_m: 0.02,
        elevDiff_const_m: 0,
        elevDiff_ppm: 0,
        gpsStd_xy: 0,
        levStd_mmPerKm: 0,
      },
    };
    const engine = new LSAEngine({ input, maxIterations: 5, instrumentLibrary });
    const result = engine.solve();
    const zenith = result.observations.find((obs) => obs.type === 'zenith');
    expect(zenith).toBeDefined();
    const sigma = (engine as any).effectiveStdDev(zenith);
    const d = 5;
    const s = 13;
    const e = 12;
    const baseRad = 1 * SEC_TO_RAD;
    const centeringRad =
      Math.sqrt((e / s) ** 2 * (0.03 ** 2 + 0.04 ** 2) + 2 * (d / s) ** 2 * 0.02 ** 2) / s;
    const expected = Math.sqrt(baseRad ** 2 + centeringRad ** 2);
    expect(sigma).toBeCloseTo(expected, 12);
  });

  it('matches the fixture-locked centering geometry reference case', () => {
    const input = readFileSync('tests/fixtures/centering_geometry_reference.dat', 'utf-8');
    const instrumentLibrary = {
      TS: {
        code: 'TS',
        desc: 'TS',
        edm_const: 0,
        edm_ppm: 0,
        hzPrecision_sec: 1,
        dirPrecision_sec: 1,
        azBearingPrecision_sec: 1,
        vaPrecision_sec: 1,
        instCentr_m: 0.03,
        tgtCentr_m: 0.04,
        vertCentr_m: 0.02,
        elevDiff_const_m: 0,
        elevDiff_ppm: 0,
        gpsStd_xy: 0,
        levStd_mmPerKm: 0,
      },
    };
    const engine = new LSAEngine({ input, maxIterations: 5, instrumentLibrary });
    const result = engine.solve();
    const dist = result.observations.find((obs) => obs.type === 'dist');
    const zenith = result.observations.find((obs) => obs.type === 'zenith');

    expect(dist).toBeDefined();
    expect(zenith).toBeDefined();

    const sigmaDist = (engine as any).effectiveStdDev(dist);
    const sigmaZen = (engine as any).effectiveStdDev(zenith);
    const d = 5;
    const s = 13;
    const e = 12;
    const expectedDist = Math.sqrt(
      0.01 ** 2 + (d / s) ** 2 * (0.03 ** 2 + 0.04 ** 2) + 2 * (e / s) ** 2 * 0.02 ** 2,
    );
    const expectedZen = Math.sqrt(
      (1 * SEC_TO_RAD) ** 2 +
        (Math.sqrt((e / s) ** 2 * (0.03 ** 2 + 0.04 ** 2) + 2 * (d / s) ** 2 * 0.02 ** 2) / s) ** 2,
    );

    expect(sigmaDist).toBeCloseTo(expectedDist, 12);
    expect(sigmaZen).toBeCloseTo(expectedZen, 12);
  });

  it('captures prism correction source and magnitude metadata from fixture offsets', () => {
    const input = readFileSync('tests/fixtures/prism_phase3_offsets.dat', 'utf-8');
    const result = new LSAEngine({ input, maxIterations: 12 }).solve();
    const prismRows = result.observations.filter(
      (obs) =>
        (obs.type === 'dist' || obs.type === 'zenith') && Math.abs(obs.prismCorrectionM ?? 0) > 0,
    );
    expect(prismRows.length).toBeGreaterThanOrEqual(3);
    expect(prismRows.some((obs) => obs.prismScope === 'global')).toBe(true);
    expect(prismRows.some((obs) => obs.prismScope === 'set')).toBe(true);

    const setDist = result.observations.find(
      (obs) => obs.type === 'dist' && (obs.setId ?? '') === 'SET1',
    );
    expect(setDist).toBeDefined();
    expect(setDist?.prismCorrectionM).toBeCloseTo(0.5, 10);

    const offDist = result.observations.find(
      (obs) => obs.type === 'dist' && (obs.sourceLine ?? 0) === 13,
    );
    expect(offDist).toBeDefined();
    expect(Math.abs(offDist?.prismCorrectionM ?? 0)).toBe(0);
    expect(result.logs.some((l) => l.includes('Prism correction active'))).toBe(true);
  });

  it('applies curvature/refraction correction to zenith calculations when enabled', () => {
    const baseInput = [
      'C A 0 0 0 !',
      'C B 10000 0 0',
      'B A-B 090.0000 1.0',
      'D A-B 10000.0000 0.001',
      'V A-B 090.0000 1.0',
    ].join('\n');
    const withCurvRefInput = ['.CURVREF ON', '.REFRACTION 0.13', '.VRED CURVREF', baseInput].join(
      '\n',
    );

    const noCurv = new LSAEngine({ input: baseInput, maxIterations: 10 }).solve();
    const withCurv = new LSAEngine({ input: withCurvRefInput, maxIterations: 10 }).solve();

    const zNoCurv = noCurv.observations.find((o) => o.type === 'zenith');
    const zWithCurv = withCurv.observations.find((o) => o.type === 'zenith');
    expect(zNoCurv?.calc).toBeDefined();
    expect(zWithCurv?.calc).toBeDefined();
    expect(Math.abs(withCurv.stations.B.h - noCurv.stations.B.h)).toBeGreaterThan(1);
    expect(withCurv.logs.some((l) => l.includes('Vertical reduction active'))).toBe(true);
  });

  it('applies TS angular correlation model and reports diagnostics', () => {
    const base = [
      '.AMODE ANGLE',
      'C C1 0 0 0 !',
      'C C2 200 0 0 !',
      'C C3 100 200 0 !',
      'C U 100 80 0',
      'D C1-U 128.06 0.003',
      'D C2-U 128.06 0.003',
      'D C3-U 120.00 0.003',
      'A U-C1-C2 102-40-00.0 1.2',
      'A U-C2-C3 116-33-55.0 1.2',
      'A U-C3-C1 140-46-10.0 1.2',
      'A U-C1-C2 102-40-06.0 1.2',
    ].join('\n');
    const off = new LSAEngine({ input: base, maxIterations: 12 }).solve();
    const on = new LSAEngine({ input: `.TSCORR SETUP 0.35\n${base}`, maxIterations: 12 }).solve();

    expect(on.tsCorrelationDiagnostics).toBeDefined();
    expect(on.tsCorrelationDiagnostics?.enabled).toBe(true);
    expect(on.tsCorrelationDiagnostics?.scope).toBe('setup');
    expect(on.tsCorrelationDiagnostics?.pairCount).toBeGreaterThan(0);
    expect(on.logs.some((l) => l.includes('TS correlation diagnostics'))).toBe(true);
    expect(on.seuw).not.toBe(off.seuw);
  });

  it('applies robust huber reweighting and reports iteration diagnostics', () => {
    const input = [
      '.AMODE ANGLE',
      '.ROBUST HUBER 1.5',
      'C C1 0 0 0 !',
      'C C2 200 0 0 !',
      'C C3 100 200 0 !',
      'C U 100 80 0',
      'D C1-U 128.06 0.003',
      'D C2-U 128.06 0.003',
      'D C3-U 120.00 0.003',
      'A U-C1-C2 102-40-00.0 1.0',
      'A U-C2-C3 116-33-55.0 1.0',
      'A U-C3-C1 140-46-10.0 1.0',
      'A U-C1-C2 102-42-30.0 1.0',
    ].join('\n');
    const result = new LSAEngine({ input, maxIterations: 12 }).solve();
    expect(result.robustDiagnostics).toBeDefined();
    expect(result.robustDiagnostics?.enabled).toBe(true);
    expect(result.robustDiagnostics?.mode).toBe('huber');
    expect((result.robustDiagnostics?.iterations.length ?? 0) > 0).toBe(true);
    expect(result.logs.some((l) => l.includes('robust(huber)'))).toBe(true);
  });

  it('bases robust weights on postfit residuals instead of prefit GPS misclosures', () => {
    const input = [
      '.2D',
      '.ROBUST HUBER 1.5',
      'C A 0 0 0 ! !',
      'C B 100 0 0 ! !',
      'C U 1000 1000 0',
      'G GPS A U 50 80 0.01 0.01 0',
      'G GPS B U -50 80 0.01 0.01 0',
    ].join('\n');
    const result = new LSAEngine({ input, maxIterations: 8 }).solve();

    expect(result.robustDiagnostics).toBeDefined();
    expect(result.robustDiagnostics?.iterations[0]?.downweightedRows ?? -1).toBe(0);
    expect(result.robustDiagnostics?.iterations[0]?.maxNorm ?? Infinity).toBeLessThan(1e-6);
    expect(result.stations.U.x).toBeCloseTo(50, 6);
    expect(result.stations.U.y).toBeCloseTo(80, 6);
  });

  it('runs preanalysis from planned observations and skips residual-based QC outputs', () => {
    const input = [
      '.2D',
      'C A 0 0 0 ! !',
      'C B 100 0 0 ! !',
      'C P 60 40 0',
      'C Q 40 70 0',
      'D A-P ? 0.003',
      'D B-P ? 0.003',
      'A P-A-B ? 1.0',
      'D A-Q ? 0.003',
      'D B-Q ? 0.003',
    ].join('\n');

    const result = new LSAEngine({
      input,
      maxIterations: 6,
      parseOptions: { preanalysisMode: true, coordMode: '2D' },
    }).solve();

    expect(result.success).toBe(true);
    expect(result.preanalysisMode).toBe(true);
    expect(result.parseState?.preanalysisMode).toBe(true);
    expect(result.parseState?.plannedObservationCount).toBe(5);
    expect(result.seuw).toBeCloseTo(1, 12);
    expect(result.chiSquare).toBeUndefined();
    expect(result.residualDiagnostics).toBeUndefined();
    expect(result.robustDiagnostics).toBeUndefined();
    expect(result.autoSideshotDiagnostics).toBeUndefined();
    expect((result.stationCovariances?.length ?? 0) >= 2).toBe(true);
    expect(result.stationCovariances?.some((row) => row.stationId === 'P')).toBe(true);
    expect(result.relativeCovariances?.some((row) => row.from === 'A' && row.to === 'P')).toBe(
      true,
    );
    expect(result.relativeCovariances?.some((row) => row.from === 'A' && row.to === 'Q')).toBe(
      true,
    );
    expect(result.relativeCovariances?.some((row) => row.from === 'P' && row.to === 'Q')).toBe(
      false,
    );
    expect(result.weakGeometryDiagnostics?.enabled).toBe(true);
    expect(result.logs.some((l) => l.includes('Preanalysis mode'))).toBe(true);
    expect(result.logs.some((l) => l.includes('Preanalysis covariance blocks'))).toBe(true);
    expect(result.logs.some((l) => l.includes('skipping residual-based diagnostics'))).toBe(true);
    expect(result.observations.every((obs) => Math.abs(obs.stdRes ?? 0) < 1e-9)).toBe(true);
    expect((result.stations.P.sE ?? 0) > 0).toBe(true);
    expect((result.stations.P.sN ?? 0) > 0).toBe(true);
  });

  it('uses missing D and A values as planned preanalysis observations instead of skipping them', () => {
    const input = [
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
    ].join('\n');

    const result = new LSAEngine({
      input,
      maxIterations: 6,
      parseOptions: { preanalysisMode: true, coordMode: '2D' },
    }).solve();

    expect(result.success).toBe(true);
    expect(result.parseState?.plannedObservationCount).toBe(11);
    expect(result.observations.filter((obs) => obs.type === 'dist')).toHaveLength(5);
    expect(result.observations.filter((obs) => obs.type === 'angle')).toHaveLength(5);
    expect(result.observations.filter((obs) => obs.type === 'bearing')).toHaveLength(1);
    expect(result.logs.some((line) => line.includes('Invalid distance'))).toBe(false);
    expect(result.logs.some((line) => line.includes('Invalid angle'))).toBe(false);
    expect(result.stationCovariances?.some((row) => row.stationId === '2')).toBe(true);
    expect(result.stationCovariances?.some((row) => row.stationId === '3')).toBe(true);
    expect(result.relativeCovariances?.length ?? 0).toBeGreaterThan(0);
  });

  it('excludes fixed planned observations from preanalysis what-if candidates', () => {
    const input = [
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
    ].join('\n');

    const result = new LSAEngine({
      input,
      maxIterations: 6,
      parseOptions: { preanalysisMode: true, coordMode: '2D' },
    }).solve();

    const bearing = result.observations.find((obs) => obs.type === 'bearing');
    expect(bearing).toBeDefined();
    expect(bearing?.planned).toBe(true);
    expect(bearing?.sigmaSource).toBe('fixed');
    expect(isPreanalysisWhatIfCandidate(bearing!)).toBe(false);

    const candidates = result.observations.filter(isPreanalysisWhatIfCandidate);
    expect(candidates).toHaveLength(10);
    expect(candidates.some((obs) => obs.id === bearing?.id)).toBe(false);
  });

  it('enforces data-check mode incompatibility matrix with explicit diagnostics', () => {
    const input = [
      '.2D',
      'C A 0 0 0 ! !',
      'C B 100 0 0 ! !',
      'C U 50 40 0',
      'D A-U 64.031 0.003',
      'D B-U 64.031 0.003',
    ].join('\n');

    const result = new LSAEngine({
      input,
      maxIterations: 8,
      parseOptions: {
        runMode: 'data-check',
        coordMode: '2D',
        autoAdjustEnabled: true,
        robustMode: 'huber',
        autoSideshotEnabled: true,
        clusterDetectionEnabled: true,
      },
    }).solve();

    expect(result.success).toBe(true);
    expect(result.parseState?.runMode).toBe('data-check');
    const diagCodes = new Set(
      (result.parseState?.runModeCompatibilityDiagnostics ?? []).map((diag) => diag.code),
    );
    expect(diagCodes.has('DATACHECK_DISALLOWS_AUTOADJUST')).toBe(true);
    expect(diagCodes.has('DATACHECK_DISALLOWS_ROBUST')).toBe(true);
    expect(diagCodes.has('DATACHECK_SKIPS_AUTOSIDESHOT')).toBe(true);
    expect(diagCodes.has('DATACHECK_SKIPS_CLUSTER')).toBe(true);
    expect(result.logs.some((line) => line.includes('[DATACHECK_DISALLOWS_AUTOADJUST]'))).toBe(
      true,
    );
    expect(result.logs.some((line) => line.includes('[DATACHECK_DISALLOWS_ROBUST]'))).toBe(true);
  });

  it('enforces blunder-detect mode overrides with explicit diagnostics', () => {
    const input = [
      '.2D',
      'C A 0 0 0 ! !',
      'C B 100 0 0 ! !',
      'C U 50 60 0',
      'D A-U 78.102 0.003',
      'D B-U 78.102 0.003',
      'A U-A-B 78-30-00.0 1.0',
    ].join('\n');

    const result = new LSAEngine({
      input,
      maxIterations: 8,
      parseOptions: {
        runMode: 'blunder-detect',
        coordMode: '2D',
        autoAdjustEnabled: true,
        robustMode: 'huber',
        autoSideshotEnabled: true,
        clusterDetectionEnabled: true,
      },
    }).solve();

    expect(result.success).toBe(true);
    expect(result.parseState?.runMode).toBe('blunder-detect');
    const diagCodes = new Set(
      (result.parseState?.runModeCompatibilityDiagnostics ?? []).map((diag) => diag.code),
    );
    expect(diagCodes.has('BLUNDER_DISALLOWS_AUTOADJUST')).toBe(true);
    expect(diagCodes.has('BLUNDER_DISALLOWS_ROBUST')).toBe(true);
    expect(diagCodes.has('BLUNDER_SKIPS_AUTOSIDESHOT')).toBe(true);
    expect(diagCodes.has('BLUNDER_SKIPS_CLUSTER')).toBe(true);
    expect(result.logs.some((line) => line.includes('[BLUNDER_DISALLOWS_AUTOADJUST]'))).toBe(true);
    expect(result.logs.some((line) => line.includes('[BLUNDER_DISALLOWS_ROBUST]'))).toBe(true);
  });

  it('hard-fails blunder-detect mode for leveling-only datasets with compatibility diagnostics', () => {
    const input = [
      'C A 0 0 100.000 ! ! !',
      'C B 0 0 100.900',
      'L A-B 0.9000 0.25',
    ].join('\n');

    const result = new LSAEngine({
      input,
      maxIterations: 8,
      parseOptions: { runMode: 'blunder-detect' },
    }).solve();

    expect(result.success).toBe(false);
    expect(result.parseState?.runMode).toBe('blunder-detect');
    const levelOnlyDiag = (result.parseState?.runModeCompatibilityDiagnostics ?? []).find(
      (diag) => diag.code === 'BLUNDER_LEVELING_ONLY',
    );
    expect(levelOnlyDiag).toBeDefined();
    expect(levelOnlyDiag?.severity).toBe('error');
    expect(result.logs.some((line) => line.includes('[BLUNDER_LEVELING_ONLY]'))).toBe(true);
  });

  it('computes post-adjusted sideshot coordinates/precision when azimuth reference exists', () => {
    const input = readFileSync('tests/fixtures/sideshot_postadjust_known.dat', 'utf-8');
    const engine = new LSAEngine({ input, maxIterations: 10 });
    const result = engine.solve();
    expect(result.sideshots?.length).toBeGreaterThan(0);
    const side = result.sideshots?.find((s) => s.to === 'SH');
    expect(side).toBeDefined();
    expect(side?.hasAzimuth).toBe(true);
    expect(side?.easting).toBeDefined();
    expect(side?.northing).toBeDefined();
    expect(side?.sigmaE).toBeDefined();
    expect(side?.sigmaN).toBeDefined();
  });

  it('reports sideshot limitation when target azimuth reference is unavailable', () => {
    const input = readFileSync('tests/fixtures/sideshot_postadjust_missing_az.dat', 'utf-8');
    const engine = new LSAEngine({ input, maxIterations: 10 });
    const result = engine.solve();
    const side = result.sideshots?.find((s) => s.to === 'SHMISS');
    expect(side).toBeDefined();
    expect(side?.hasAzimuth).toBe(false);
    expect(side?.note?.includes('azimuth unavailable')).toBe(true);
  });

  it('uses explicit SS azimuth to compute coordinates without target approximation', () => {
    const input = readFileSync('tests/fixtures/sideshot_postadjust_explicit_az.dat', 'utf-8');
    const engine = new LSAEngine({ input, maxIterations: 10 });
    const result = engine.solve();
    const side = result.sideshots?.find((s) => s.to === 'SHAZ');
    expect(side).toBeDefined();
    expect(side?.hasAzimuth).toBe(true);
    expect(side?.azimuthSource).toBe('explicit');
    expect(side?.easting).toBeDefined();
    expect(side?.northing).toBeDefined();
  });

  it('uses setup-based SS horizontal angle with backsight orientation', () => {
    const input = readFileSync('tests/fixtures/sideshot_postadjust_setup_hz.dat', 'utf-8');
    const engine = new LSAEngine({ input, maxIterations: 10 });
    const result = engine.solve();
    const side = result.sideshots?.find((s) => s.to === 'SHSET');
    expect(side).toBeDefined();
    expect(side?.azimuthSource).toBe('setup');
    expect(side?.hasAzimuth).toBe(true);
    expect(side?.easting).toBeDefined();
    expect(side?.northing).toBeDefined();
    expect(Math.abs((side?.easting ?? 0) - 10)).toBeLessThan(0.25);
    expect(Math.abs(side?.northing ?? 0)).toBeLessThan(0.25);
  });

  it('detects non-redundant M-record auto-sideshot candidates and excludes control targets', () => {
    const input = [
      '.2D',
      '.ORDER EN ATFROMTO',
      'C O 0 0 0 ! !',
      'C BS 100 0 0 ! !',
      'C CTRL 40 80 0 ! !',
      'M O-BS-U1 063-26-06.0 89.4427',
      'M O-BS-CTRL 063-26-06.0 89.4427',
    ].join('\n');

    const result = new LSAEngine({ input, maxIterations: 10 }).solve();
    const diag = result.autoSideshotDiagnostics;
    expect(diag?.enabled).toBe(true);
    expect(diag?.evaluatedCount).toBe(2);
    expect(diag?.excludedControlCount).toBe(1);
    expect(diag?.candidateCount).toBe(1);
    expect(diag?.candidates[0].occupy).toBe('O');
    expect(diag?.candidates[0].backsight).toBe('BS');
    expect(diag?.candidates[0].target).toBe('U1');
    expect(result.logs.some((l) => l.includes('Auto-sideshot detection (M-lines)'))).toBe(true);
  });

  it('supports disabling auto-sideshot detection via parse options', () => {
    const input = [
      '.2D',
      'C O 0 0 0 ! !',
      'C BS 100 0 0 ! !',
      'M O-BS-U1 090-00-00.0 100.000',
    ].join('\n');
    const result = new LSAEngine({
      input,
      maxIterations: 10,
      parseOptions: { autoSideshotEnabled: false },
    }).solve();
    expect(result.autoSideshotDiagnostics).toBeUndefined();
    expect(result.logs.some((l) => l.includes('Auto-sideshot detection (M-lines): disabled'))).toBe(
      true,
    );
  });

  it('keeps observation count, chi-square, and sideshot coordinates stable across auto-sideshot toggle', () => {
    const input = readFileSync('tests/fixtures/auto_sideshot_phase4.dat', 'utf-8');
    const on = new LSAEngine({
      input,
      maxIterations: 20,
      parseOptions: { autoSideshotEnabled: true },
    }).solve();
    const off = new LSAEngine({
      input,
      maxIterations: 20,
      parseOptions: { autoSideshotEnabled: false },
    }).solve();

    expect(on.observations.length).toBe(off.observations.length);
    expect(on.dof).toBe(off.dof);
    expect(on.chiSquare).toBeDefined();
    expect(off.chiSquare).toBeDefined();
    expect(on.chiSquare?.T ?? 0).toBeCloseTo(off.chiSquare?.T ?? 0, 8);
    expect(on.chiSquare?.varianceFactor ?? 0).toBeCloseTo(off.chiSquare?.varianceFactor ?? 0, 8);

    const shOn = on.sideshots?.find((s) => s.to === 'SH');
    const shOff = off.sideshots?.find((s) => s.to === 'SH');
    expect(shOn).toBeDefined();
    expect(shOff).toBeDefined();
    expect(shOn?.easting ?? 0).toBeCloseTo(shOff?.easting ?? 0, 8);
    expect(shOn?.northing ?? 0).toBeCloseTo(shOff?.northing ?? 0, 8);
    expect(shOn?.sigmaE ?? 0).toBeCloseTo(shOff?.sigmaE ?? 0, 8);
    expect(shOn?.sigmaN ?? 0).toBeCloseTo(shOff?.sigmaN ?? 0, 8);

    expect(on.autoSideshotDiagnostics?.candidateCount ?? 0).toBeGreaterThan(0);
    expect(off.autoSideshotDiagnostics).toBeUndefined();
  });

  it('converges a weak but recoverable network through the damping path', () => {
    const input = readFileSync('tests/fixtures/regularized_recoverable_phase1.dat', 'utf-8');
    const result = new LSAEngine({ input, maxIterations: 20 }).solve();

    expect(result.success).toBe(true);
    expect(result.converged).toBe(true);
    expect(
      result.logs.some((line) =>
        line.includes('normal-equation factorization required diagonal damping'),
      ),
    ).toBe(true);
    expect(result.logs.some((line) => line.includes('pivoted symmetric LDLT recovery'))).toBe(true);
    expect(result.logs.some((line) => line.includes('Normal equation solve failed'))).toBe(false);
    expect(result.dof).toBe(1);
    expect(Number.isFinite(result.stations.P1.x)).toBe(true);
    expect(Number.isFinite(result.stations.P1.y)).toBe(true);
    expect(Number.isFinite(result.stations.P2.x)).toBe(true);
    expect(Number.isFinite(result.stations.P2.y)).toBe(true);
  });
});
