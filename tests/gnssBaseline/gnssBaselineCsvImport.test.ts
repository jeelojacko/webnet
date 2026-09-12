/**
 * Phase 12C — generic delimited importer tests: header aliases, both
 * stochastic forms, native parity, control CSV, and mapping failures.
 */
import { describe, expect, it } from 'vitest';
import { runGnssBaselineAdjustment } from '../../src/engine/gnssBaselineAdjust';
import {
  importGnssBaselineDelimited,
  importGnssControlCsv,
} from '../../src/engine/gnssBaselineCsvImport';
import { parseGnssBaselineText } from '../../src/engine/gnssBaselineNetworkImport';

const CONTROL_CSV =
  'id,X,Y,Z,fixed\n' +
  'A,1000000,2000000,3000000,FIXED\n' +
  'B,1000100,2000000,3000000,FREE\n' +
  'C,1000000,2000100,3000000,FREE\n';

const controlStations = (): ReturnType<typeof importGnssControlCsv> =>
  importGnssControlCsv(CONTROL_CSV, { units: 'M' });

const COV_CSV =
  'From,To Point,dX,Delta Y,dz,cxx,cxy,cxz,cyy,cyz,czz,Session\n' +
  'A,B,100,0,0,0.000004,0.000001,0.0000002,0.000009,-0.0000003,0.000016,2026-101\n' +
  'B,C,-100,100,0,0.000004,0,0,0.000004,0,0.000004,2026-101\n' +
  'A,C,0,100,0,0.000004,0,0,0.000004,0,0.000004,2026-101\n';

const SIGCORR_CSV =
  'frompoint,topoint,DX,DY,DZ,sx,sy,sz,rho_xy,rho_xz,rho_yz\n' +
  'A,B,100,0,0,0.002,0.003,0.004,0.16666666666666666,0.025,-0.025\n' +
  'B,C,-100,100,0,0.002,0.002,0.002,0,0,0\n' +
  'A,C,0,100,0,0.002,0.002,0.002,0,0,0\n';

const NATIVE_EQUIVALENT =
  'FRAME ECEF ITRF2020@2020.0 EPOCH 2020.0 ELLIPSOID GRS80\nUNITS M\n' +
  'GX A 1000000 2000000 3000000 FIXED\n' +
  'GX B 1000100 2000000 3000000\n' +
  'GX C 1000000 2000100 3000000\n' +
  'BL A B 100 0 0 SESSION 2026-101\n' +
  'COV 0.000004 0.000001 0.0000002 0.000009 -0.0000003 0.000016\n' +
  'BL B C -100 100 0 SESSION 2026-101\n' +
  'COV 0.000004 0 0 0.000004 0 0.000004\n' +
  'BL A C 0 100 0 SESSION 2026-101\n' +
  'COV 0.000004 0 0 0.000004 0 0.000004\n';

const csvOptions = {
  units: 'M',
  vectorFrame: 'ecef',
  referenceFrame: 'ITRF2020@2020.0',
  epoch: '2020.0',
  ellipsoid: 'GRS80',
} as const;

describe('gnss delimited importer', () => {
  it('imports control stations from CSV', () => {
    const { stations, diagnostics } = controlStations();
    expect(diagnostics).toEqual([]);
    expect(stations).not.toBeNull();
    expect(stations!['A']!.fixedX).toBe(true);
    expect(stations!['B']!.fixedX).toBe(false);
    expect(stations!['B']!.x).toBe(1000100);
  });

  it('imports covariance CSV with header aliases', () => {
    const { stations } = controlStations();
    const result = importGnssBaselineDelimited(COV_CSV, stations!, { ...csvOptions });
    expect(result.diagnostics).toEqual([]);
    expect(result.network).not.toBeNull();
    expect(result.network!.baselines).toHaveLength(3);
    expect(result.network!.baselines[0]!.covariance.xy).toBeCloseTo(0.000001, 15);
    expect(result.network!.baselines[0]!.sessionId).toBe('2026-101');
  });

  it('imports sigma/correlation CSV to equivalent covariance', () => {
    const { stations } = controlStations();
    const covResult = importGnssBaselineDelimited(COV_CSV, stations!, { ...csvOptions });
    const sigResult = importGnssBaselineDelimited(SIGCORR_CSV, stations!, { ...csvOptions });
    expect(sigResult.network).not.toBeNull();
    // Row 1 sigcorr encodes the row 1 covariance: sx=2mm sy=3mm sz=4mm.
    const expected = covResult.network!.baselines[0]!.covariance;
    const actual = sigResult.network!.baselines[0]!.covariance;
    for (const key of ['xx', 'xy', 'xz', 'yy', 'yz', 'zz'] as const) {
      expect(Math.abs(actual[key] - expected[key])).toBeLessThan(1e-12);
    }
  });

  it('reaches native/CSV parity: identical canonical networks and solutions', () => {
    const { stations } = controlStations();
    const csv = importGnssBaselineDelimited(COV_CSV, stations!, { ...csvOptions }).network!;
    const native = parseGnssBaselineText(NATIVE_EQUIVALENT).network!;
    expect(csv.baselines).toHaveLength(native.baselines.length);
    csv.baselines.forEach((baseline, index) => {
      const expected = native.baselines[index]!;
      for (const key of ['x', 'y', 'z'] as const) {
        expect(Math.abs(baseline.vector[key] - expected.vector[key])).toBeLessThan(1e-12);
      }
      for (const key of ['xx', 'xy', 'xz', 'yy', 'yz', 'zz'] as const) {
        expect(Math.abs(baseline.covariance[key] - expected.covariance[key])).toBeLessThan(1e-18);
      }
    });
    const csvAdjust = runGnssBaselineAdjustment({ stations: csv.stations, baselines: csv.baselines });
    const nativeAdjust = runGnssBaselineAdjustment({ stations: native.stations, baselines: native.baselines });
    expect(Math.abs(csvAdjust.varianceFactor - nativeAdjust.varianceFactor)).toBeLessThan(1e-15);
    expect(Math.abs(csvAdjust.stations['B']!.x - nativeAdjust.stations['B']!.x)).toBeLessThan(1e-12);
  });

  it('sniffs semicolon/tab delimiters and handles quotes', () => {
    const { stations } = controlStations();
    const semicolon =
      'from;to;dx;dy;dz;cxx;cxy;cxz;cyy;cyz;czz\n' + 'A;B;100;0;0;0.000004;0;0;0.000004;0;0.000004\n';
    const semi = importGnssBaselineDelimited(semicolon, stations!, { ...csvOptions });
    expect(semi.network).not.toBeNull();
    expect(semi.network!.baselines).toHaveLength(1);
    const quoted =
      'from,to,dx,dy,dz,cxx,cxy,cxz,cyy,cyz,czz\n' + '"A","B","100","0","0","0.000004","0","0","0.000004","0","0.000004"\n';
    const quotedResult = importGnssBaselineDelimited(quoted, stations!, { ...csvOptions });
    expect(quotedResult.network).not.toBeNull();
  });

  it('fails closed on missing/ambiguous headers and bad rows', () => {
    const { stations } = controlStations();
    const noVector = 'from,to,cxx,cxy,cxz,cyy,cyz,czz\nA,B,1,0,0,1,0,1\n';
    expect(
      importGnssBaselineDelimited(noVector, stations!, { ...csvOptions }).diagnostics[0]!.code,
    ).toBe('GNSS_CSV_MISSING_HEADERS');
    const noStochastic = 'from,to,dx,dy,dz\nA,B,1,0,0\n';
    expect(
      importGnssBaselineDelimited(noStochastic, stations!, { ...csvOptions }).diagnostics[0]!.code,
    ).toBe('GNSS_CSV_MISSING_HEADERS');
    const ambiguous = 'from,From Point,to,dx,dy,dz,cxx,cxy,cxz,cyy,cyz,czz\nA,A,B,1,0,0,1,0,0,1,0,1\n';
    expect(
      importGnssBaselineDelimited(ambiguous, stations!, { ...csvOptions }).diagnostics[0]!.code,
    ).toBe('GNSS_AMBIGUOUS_CSV_MAPPING');
    const badNumber = 'from,to,dx,dy,dz,cxx,cxy,cxz,cyy,cyz,czz\nA,B,12abc,0,0,1,0,0,1,0,1\n';
    expect(
      importGnssBaselineDelimited(badNumber, stations!, { ...csvOptions }).diagnostics[0]!.code,
    ).toBe('GNSS_MALFORMED_NUMERIC');
    const frameMismatch =
      'from,to,dx,dy,dz,cxx,cxy,cxz,cyy,cyz,czz,frame\nA,B,1,0,0,1,0,0,1,0,1,OTHER-FRAME\n';
    expect(
      importGnssBaselineDelimited(frameMismatch, stations!, { ...csvOptions }).diagnostics[0]!.code,
    ).toBe('GNSS_FRAME_MISMATCH');
  });

  it('requires frame metadata and ENU origin from options, never filenames', () => {
    const { stations } = controlStations();
    const noFrame = importGnssBaselineDelimited(COV_CSV, stations!, {
      ...csvOptions, referenceFrame: '',
    });
    expect(noFrame.network).toBeNull();
    expect(noFrame.diagnostics[0]!.code).toBe('GNSS_MISSING_FRAME');
    const enuNoOrigin = importGnssBaselineDelimited(COV_CSV, stations!, {
      ...csvOptions, vectorFrame: 'enu',
    });
    expect(enuNoOrigin.network).toBeNull();
    expect(enuNoOrigin.diagnostics[0]!.code).toBe('GNSS_ENU_ORIGIN_MISSING');
  });
});
