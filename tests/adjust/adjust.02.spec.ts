import { describe, expect, it } from 'vitest';
import {
  LSAEngine,
  readFileSync,
} from './adjustTestSupport';

describe('LSAEngine', () => {
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

  it('does not let derived grid inverse lat-lon block projected jobs with auto-created stations', () => {
    const input = [
      '.2D',
      '.UNITS METERS DD',
      '.CRS GRID CA_NAD83_CSRS_NB_STEREO_DOUBLE',
      'C A 2500000.0000 7500000.0000 0 ! !',
      'B A-B 090.000000 !',
      'D A-B 800.0000 0.005',
    ].join('\n');
    const result = new LSAEngine({ input, maxIterations: 8 }).solve();

    expect(result.logs.some((line) => line.includes('Grid mode input class check failed'))).toBe(
      false,
    );
    expect(result.success || result.converged || result.iterations > 0).toBe(true);
    expect(result.stations.B.coordInputClass).toBe('unknown');
    expect(Number.isFinite(result.stations.B.latDeg ?? Number.NaN)).toBe(true);
    expect(Number.isFinite(result.stations.B.lonDeg ?? Number.NaN)).toBe(true);
    expect(Math.abs((result.stations.B.lonDeg ?? 0) - (result.stations.A.lonDeg ?? 0))).toBeGreaterThan(
      0.001,
    );
    expect((result.stations.B.gridScaleFactor ?? 0)).toBeGreaterThan(0.99);
    expect((result.stations.B.gridScaleFactor ?? 0)).toBeLessThan(1.01);
  });

  it('bootstraps unknown direction-set setups from known targets and forward-seeds connected targets', () => {
    const input = [
      '.2D',
      'C A 0 0 0 ! !',
      'C B 100 0 0 ! !',
      'DB S',
      'DM A 0-0-0 70.710678 90-00-00',
      'DM B 90-0-0 70.710678 90-00-00',
      'DM P 135-0-0 100.000000 90-00-00',
      'DE',
    ].join('\n');
    const result = new LSAEngine({ input, maxIterations: 8 }).solve();

    expect(result.logs.some((line) => line.includes('Approximate traverse bootstrap'))).toBe(true);
    expect(result.success || result.converged || result.iterations > 0).toBe(true);
    expect(result.stations.S.bootstrapApprox).toBe(true);
    expect(result.stations.P.bootstrapApprox).toBe(true);
    expect(result.stations.S.x).toBeCloseTo(50, 3);
    expect(result.stations.S.y).toBeCloseTo(-50, 3);
    expect(result.stations.P.x).toBeCloseTo(150, 3);
    expect(result.stations.P.y).toBeCloseTo(-50, 3);
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

});
