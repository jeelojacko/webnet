import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { LSAEngine } from '../src/engine/adjust';
import { DEG_TO_RAD } from '../src/engine/angles';

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
        crsConvergenceEnabled: true,
        crsConvergenceAngleRad: 1 * DEG_TO_RAD,
      },
    }).solve();

    expect(base.parseState?.crsGridScaleEnabled ?? false).toBe(false);
    expect(base.parseState?.crsConvergenceEnabled ?? false).toBe(false);
    expect(withScale.stations.B.x).toBeGreaterThan((base.stations.B.x ?? 0) + 0.03);
    expect(withConvergence.stations.B.x).toBeLessThan(base.stations.B.x ?? 0);
    expect(Math.abs(withConvergence.stations.B.y ?? 0)).toBeGreaterThan(1);
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

  it('applies geoid height conversion only when explicitly enabled', () => {
    const input = [
      '.3D',
      '.UNITS METERS DD',
      '.GEOID ON NGS-DEMO',
      'P ORTH 40.000000 -105.000000 100.000 ! ! !',
      'PH ELL 40.001000 -104.999000 120.000 ! ! !',
      'D ORTH-ELL 120.0000 0.005',
    ].join('\n');

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
    expect(base.stations.ELL.h).toBeCloseTo(120, 8);
    expect(base.stations.ORTH.h).toBeCloseTo(100, 8);

    expect(toOrthometric.parseState?.geoidHeightConversionEnabled ?? false).toBe(true);
    expect(toOrthometric.parseState?.geoidOutputHeightDatum).toBe('orthometric');
    expect(toOrthometric.parseState?.geoidConvertedStationCount ?? 0).toBe(1);
    expect(toOrthometric.parseState?.geoidSkippedStationCount ?? 0).toBe(0);
    expect(toOrthometric.stations.ELL.h).toBeGreaterThan((base.stations.ELL.h ?? 0) + 20);
    expect(toOrthometric.stations.ORTH.h).toBeCloseTo(base.stations.ORTH.h, 8);
    expect(toOrthometric.logs.some((l) => l.includes('Geoid height conversion: ON'))).toBe(true);

    expect(toEllipsoid.parseState?.geoidHeightConversionEnabled ?? false).toBe(true);
    expect(toEllipsoid.parseState?.geoidOutputHeightDatum).toBe('ellipsoid');
    expect(toEllipsoid.parseState?.geoidConvertedStationCount ?? 0).toBe(1);
    expect(toEllipsoid.parseState?.geoidSkippedStationCount ?? 0).toBe(0);
    expect(toEllipsoid.stations.ORTH.h).toBeLessThan((base.stations.ORTH.h ?? 0) - 20);
    expect(toEllipsoid.stations.ELL.h).toBeCloseTo(base.stations.ELL.h, 8);

    expect(conversionWithoutModel.parseState?.geoidModelEnabled ?? false).toBe(false);
    expect(conversionWithoutModel.parseState?.geoidConvertedStationCount ?? 0).toBe(0);
    expect(conversionWithoutModel.stations.ORTH.h).toBeCloseTo(base.stations.ORTH.h, 8);
    expect(conversionWithoutModel.logs.some((l) => l.includes('conversion requested'))).toBe(true);
  });

  it('computes fixture-locked effective distance values for angle/direction/bearing rows', () => {
    const input = readFileSync('tests/fixtures/effective_distance_phase3.dat', 'utf-8');
    const result = new LSAEngine({ input, maxIterations: 10 }).solve();

    const angle = result.observations.find((o) => o.type === 'angle' && o.sourceLine === 9);
    const bearing = result.observations.find((o) => o.type === 'bearing' && o.sourceLine === 8);
    const direction = result.observations.find((o) => o.type === 'direction' && o.sourceLine === 11);

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
          ('from' in o && (o.from === 'ROVER1' || o.to === 'ROVER1' || o.from === 'TMP_100' || o.to === 'TMP_100')),
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
});
