import { describe, expect, it } from 'vitest';
import {
  LSAEngine,
  readFileSync,
} from './adjustTestSupport';

describe('LSAEngine', () => {
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
    expect(gps?.componentResidualStdErr?.sE).toBeDefined();
    expect(gps?.componentResidualStdErr?.sN).toBeDefined();
    expect(gps?.localTestComponents).toBeDefined();
    expect(gps?.stdResComponents?.tE).toBeDefined();
    expect(gps?.stdResComponents?.tN).toBeDefined();
    expect(result.dof).toBeGreaterThanOrEqual(0);
  });

  it('models covariance GNSS vectors in the local topocentric frame for the GNSS parity fixture', () => {
    const input = readFileSync('tests/fixtures/industry_case_gnss_input.txt', 'utf-8');
    const result = new LSAEngine({
      input,
      maxIterations: 15,
      convergenceThreshold: 0.01,
      parseOptions: {
        coordMode: '3D',
        coordSystemMode: 'grid',
        crsId: 'CA_NAD83_CSRS_NB_STEREO_DOUBLE',
        order: 'NE',
        deltaMode: 'slope',
        angleStationOrder: 'atfromto',
        lonSign: 'west-positive',
        applyCurvatureRefraction: true,
        verticalReduction: 'curvref',
        refractionCoefficient: 0.07,
        verticalDeflectionNorthSec: -2.91,
        verticalDeflectionEastSec: -1.46,
      },
    }).solve();

    expect(Math.abs((result.stations.GPS1?.y ?? 0) - 7438438.7334)).toBeLessThan(0.005);
    expect(Math.abs((result.stations.GPS1?.x ?? 0) - 2488810.2370)).toBeLessThan(0.005);
    expect(Math.abs((result.stations.GPS2?.y ?? 0) - 7438481.0552)).toBeLessThan(0.005);
    expect(Math.abs((result.stations.GPS2?.x ?? 0) - 2489236.2880)).toBeLessThan(0.005);
    expect(result.statisticalSummary?.totalCount).toBe(45);

    const gpsSummary = result.statisticalSummary?.byGroup.find((row) => row.label === 'GPS');
    expect(gpsSummary?.count).toBe(45);
    expect(gpsSummary?.sumSquares ?? Number.NaN).toBeGreaterThan(40);
    expect(gpsSummary?.errorFactor ?? Number.NaN).toBeGreaterThan(1);

    const firstVector = result.observations.find(
      (obs) => obs.type === 'gps' && obs.from === 'FRDN' && obs.to === 'GPS4',
    );
    expect(firstVector?.type).toBe('gps');
    if (firstVector?.type === 'gps') {
      expect(firstVector.calc?.dN ?? 0).toBeCloseTo(1109.0403, 2);
      expect(firstVector.calc?.dE ?? 0).toBeCloseTo(1210.2363, 2);
      expect(firstVector.calc?.dU ?? 0).toBeCloseTo(-35.5106, 1);
    }
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

});
