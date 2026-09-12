/**
 * Phase 12C — native BL text import tests: syntax, stochastic forms,
 * units, metadata, diagnostics, determinism, and end-to-end adjustment.
 */
import { describe, expect, it } from 'vitest';
import { runGnssBaselineAdjustment } from '../../src/engine/gnssBaselineAdjust';
import {
  parseGnssBaselineText,
  serializeGnssBaselineNetwork,
  validateGnssBaselineNetwork,
} from '../../src/engine/gnssBaselineNetworkImport';
import { runGoldenBaselineAdjustment } from './gnssBaselineGolden';

const HEADER = 'FRAME ECEF ITRF2020@2020.0 EPOCH 2020.0 ELLIPSOID GRS80\nUNITS M';

const triangleText = (): string =>
  `${HEADER}\n` +
  'GX A 1000000 2000000 3000000 FIXED\n' +
  'GX B 1000100 2000000 3000000\n' +
  'GX C 1000000 2000100 3000000\n' +
  'BL A B 100 0 0 ID BL001 SESSION 2026-101 SOL FIXED\n' +
  'COV 0.000004 0.000001 0.0000002 0.000009 -0.0000003 0.000016\n' +
  'BL B C -100 100 0 ID BL002 SESSION 2026-101\n' +
  'COV 0.000004 0 0 0.000004 0 0.000004\n' +
  'BL A C 0 100 0 ID BL003\n' +
  'SIGCORR 0.002 0.003 0.004 0.5 0.25 -0.125\n';

describe('gnss native text import', () => {
  it('parses a deterministic canonical network (GATE A)', () => {
    const first = parseGnssBaselineText(triangleText());
    const second = parseGnssBaselineText(triangleText());
    expect(first.network).not.toBeNull();
    expect(first.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(second.network).not.toBeNull();
    expect(JSON.stringify(first.network)).toBe(JSON.stringify(second.network));
    const network = first.network!;
    expect(network.baselines).toHaveLength(3);
    expect(network.frame.vectorFrame).toBe('ecef');
    expect(network.frame.referenceFrame).toBe('ITRF2020@2020.0');
    expect(network.baselines[0]!.vector).toEqual({ x: 100, y: 0, z: 0 });
    expect(network.baselines[0]!.covariance).toEqual({
      xx: 0.000004, xy: 0.000001, xz: 0.0000002, yy: 0.000009, yz: -0.0000003, zz: 0.000016,
    });
    expect(network.baselines[0]!.frame).toBe('ecef');
    expect(network.baselines[0]!.sessionId).toBe('2026-101');
    expect(network.baselines[0]!.solutionId).toBe('FIXED');
    expect(network.provenance[0]).toMatchObject({
      baselineId: 1, baselineCode: 'BL001', stochasticForm: 'COV', rotationApplied: false,
    });
  });

  it('converts SIGCORR to covariance independently (GATE B)', () => {
    const { network } = parseGnssBaselineText(triangleText());
    const sigcorr = network!.baselines[2]!.covariance;
    // Independent hand computation: sx=0.002 sy=0.003 sz=0.004
    // rxy=0.5 rxz=0.25 ryz=-0.125.
    expect(sigcorr.xx).toBeCloseTo(4e-6, 18);
    expect(sigcorr.yy).toBeCloseTo(9e-6, 18);
    expect(sigcorr.zz).toBeCloseTo(16e-6, 18);
    expect(sigcorr.xy).toBeCloseTo(0.5 * 0.002 * 0.003, 18);
    expect(sigcorr.xz).toBeCloseTo(0.25 * 0.002 * 0.004, 18);
    expect(sigcorr.yz).toBeCloseTo(-0.125 * 0.003 * 0.004, 18);
  });

  it('rejects invalid sigma/correlation without clamping', () => {
    const badRho =
      `${HEADER}\nGX A 0 0 0 FIXED\nGX B 1 0 0\nBL A B 1 0 0\nSIGCORR 0.002 0.003 0.004 1.5 0 0\n`;
    const rhoResult = parseGnssBaselineText(badRho);
    expect(rhoResult.network).toBeNull();
    expect(rhoResult.diagnostics.some((d) => d.code === 'GNSS_BAD_SIGCORR')).toBe(true);
    const zeroSigma =
      `${HEADER}\nGX A 0 0 0 FIXED\nGX B 1 0 0\nBL A B 1 0 0\nSIGCORR 0 0.003 0.004 0 0 0\n`;
    const sigmaResult = parseGnssBaselineText(zeroSigma);
    expect(sigmaResult.network).toBeNull();
    expect(sigmaResult.diagnostics.some((d) => d.code === 'GNSS_BAD_SIGCORR')).toBe(true);
  });

  it('normalizes mm files to identical canonical observations (GATE C)', () => {
    const metres =
      `${HEADER}\nGX A 1000000 2000000 3000000 FIXED\nGX B 1000111.111 1999995.5 3000001.25\n` +
      'BL A B 111.111 -4.5 1.25\nCOV 0.000004 0.000001 0 0.000009 0 0.000016\n';
    const millimetres =
      'FRAME ECEF ITRF2020@2020.0 EPOCH 2020.0 ELLIPSOID GRS80\nUNITS MM\n' +
      'GX A 1000000000 2000000000 3000000000 FIXED\nGX B 1000111111 1999995500 3000001250\n' +
      'BL A B 111111 -4500 1250\nCOV 4 1 0 9 0 16\n';
    const mResult = parseGnssBaselineText(metres);
    const mmResult = parseGnssBaselineText(millimetres);
    expect(mResult.network).not.toBeNull();
    expect(mmResult.network).not.toBeNull();
    const mObs = mResult.network!.baselines[0]!;
    const mmObs = mmResult.network!.baselines[0]!;
    for (const key of ['x', 'y', 'z'] as const) {
      expect(Math.abs(mObs.vector[key] - mmObs.vector[key])).toBeLessThan(1e-9);
    }
    for (const key of ['xx', 'xy', 'xz', 'yy', 'yz', 'zz'] as const) {
      expect(Math.abs(mObs.covariance[key] - mmObs.covariance[key])).toBeLessThan(1e-15);
    }
    const mAdjust = runGnssBaselineAdjustment({
      stations: mResult.network!.stations, baselines: mResult.network!.baselines,
    });
    const mmAdjust = runGnssBaselineAdjustment({
      stations: mmResult.network!.stations, baselines: mmResult.network!.baselines,
    });
    expect(Math.abs(mAdjust.stations['B']!.x - mmAdjust.stations['B']!.x)).toBeLessThan(1e-9);
    expect(Math.abs(mAdjust.varianceFactor - mmAdjust.varianceFactor)).toBeLessThan(1e-12);
  });

  it('supports cm units with squared covariance scaling', () => {
    const cm =
      'FRAME ECEF ITRF2020@2020.0 EPOCH 2020.0 ELLIPSOID GRS80\nUNITS CM\n' +
      'GX A 100000000 200000000 300000000 FIXED\nGX B 100001000 200000000 300000000\n' +
      'BL A B 1000 0 0\nCOV 0.04 0 0 0.04 0 0.04\n';
    const { network, diagnostics } = parseGnssBaselineText(cm);
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(network!.baselines[0]!.vector.x).toBeCloseTo(10, 12);
    expect(network!.baselines[0]!.covariance.xx).toBeCloseTo(0.000004, 15);
  });

  it('end-to-end file -> canonical -> adjustment matches the independent golden (GATE F)', () => {
    const { network, diagnostics } = parseGnssBaselineText(triangleText());
    expect(network).not.toBeNull();
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(validateGnssBaselineNetwork(network!)).toEqual([]);
    const result = runGnssBaselineAdjustment({
      stations: network!.stations, baselines: network!.baselines,
    });
    const golden = runGoldenBaselineAdjustment(network!.stations, network!.baselines);
    let coordDiff = 0;
    Object.keys(golden.coordinates).forEach((id) => {
      const solved = result.stations[id]!;
      const expected = golden.coordinates[id]!;
      coordDiff = Math.max(
        coordDiff,
        Math.abs(solved.x - expected.x), Math.abs(solved.y - expected.y), Math.abs(solved.h - expected.z),
      );
    });
    expect(coordDiff).toBeLessThan(1e-9);
    expect(Math.abs(result.varianceFactor - golden.varianceFactor)).toBeLessThan(1e-12);
    result.residuals.forEach((residual) => {
      const expected = golden.residuals.find((r) => r.baselineId === residual.baselineId)!;
      expect(Math.abs(residual.vX - expected.vX)).toBeLessThan(1e-9);
      expect(Math.abs(residual.vY - expected.vY)).toBeLessThan(1e-9);
      expect(Math.abs(residual.vZ - expected.vZ)).toBeLessThan(1e-9);
    });
  });

  it('preserves repeated A->B solutions as independent observations', () => {
    const text =
      `${HEADER}\nGX A 0 0 0 FIXED\nGX B 100 0 0\n` +
      'BL A B 100 0 0 ID S1\nCOV 0.000004 0 0 0.000004 0 0.000004\n' +
      'BL A B 100.003 0.001 0 ID S2\nCOV 0.000004 0 0 0.000004 0 0.000004\n';
    const { network, diagnostics } = parseGnssBaselineText(text);
    expect(network).not.toBeNull();
    expect(network!.baselines).toHaveLength(2);
    expect(diagnostics.some((d) => d.code === 'GNSS_REPEATED_BASELINE')).toBe(true);
    const result = runGnssBaselineAdjustment({
      stations: network!.stations, baselines: network!.baselines,
    });
    expect(result.logicalObservations).toBe(2);
    expect(result.residuals).toHaveLength(2);
  });

  it('is order-deterministic: reordered rows give the same solution', () => {
    const base =
      `${HEADER}\nGX A 1000000 2000000 3000000 FIXED\nGX B 1000100 2000000 3000000\nGX C 1000000 2000100 3000000\n`;
    const orderA =
      base + 'BL A B 100 0.001 0\nCOV 0.000004 0 0 0.000004 0 0.000004\nBL A C 0.002 100 0\nCOV 0.000004 0 0 0.000004 0 0.000004\n';
    const orderB =
      base + 'BL A C 0.002 100 0\nCOV 0.000004 0 0 0.000004 0 0.000004\nBL A B 100 0.001 0\nCOV 0.000004 0 0 0.000004 0 0.000004\n';
    const a = parseGnssBaselineText(orderA).network!;
    const b = parseGnssBaselineText(orderB).network!;
    const resultA = runGnssBaselineAdjustment({ stations: a.stations, baselines: a.baselines });
    const resultB = runGnssBaselineAdjustment({ stations: b.stations, baselines: b.baselines });
    for (const id of ['B', 'C']) {
      expect(Math.abs(resultA.stations[id]!.x - resultB.stations[id]!.x)).toBeLessThan(1e-9);
      expect(Math.abs(resultA.stations[id]!.y - resultB.stations[id]!.y)).toBeLessThan(1e-9);
      expect(Math.abs(resultA.stations[id]!.h - resultB.stations[id]!.h)).toBeLessThan(1e-9);
    }
  });

  it('round-trips canonical -> text -> canonical', () => {
    const { network } = parseGnssBaselineText(triangleText());
    const serialized = serializeGnssBaselineNetwork(network!);
    const reparsed = parseGnssBaselineText(serialized);
    expect(reparsed.network).not.toBeNull();
    expect(reparsed.network!.baselines).toHaveLength(3);
    reparsed.network!.baselines.forEach((baseline, index) => {
      const original = network!.baselines[index]!;
      expect(Math.abs(baseline.vector.x - original.vector.x)).toBeLessThan(1e-9);
      expect(Math.abs(baseline.covariance.xx - original.covariance.xx)).toBeLessThan(1e-18);
      expect(baseline.from).toBe(original.from);
      expect(baseline.to).toBe(original.to);
    });
    expect(reparsed.network!.frame.referenceFrame).toBe('ITRF2020@2020.0');
  });

  it('handles comments, blank lines, extra spaces, and CRLF', () => {
    const text =
      '# leading comment\r\n' +
      '\r\n' +
      `${HEADER}  \r\n` +
      '   GX   A   0 0 0   FIXED  \r\n' +
      '# station comment\n' +
      'GX B 100 0 0\n' +
      '\n' +
      '  BL   A   B   100   0   0  \n' +
      'COV  0.000004  0  0  0.000004  0  0.000004\n';
    const { network, diagnostics } = parseGnssBaselineText(text);
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(network!.baselines).toHaveLength(1);
    expect(network!.baselines[0]!.vector.x).toBe(100);
  });

  it('uses strict numerics: rejects 12abc, NaN, Infinity, empty, commas', () => {
    for (const bad of ['12abc', 'NaN', 'Infinity', '', '1,000.5', '0x10']) {
      const text = `${HEADER}\nGX A 0 0 0 FIXED\nGX B 100 0 0\nBL A B ${bad} 0 0\nCOV 0.000004 0 0 0.000004 0 0.000004\n`;
      const result = parseGnssBaselineText(text);
      expect(result.network, `expected rejection of '${bad}'`).toBeNull();
      expect(result.diagnostics.some((d) => d.severity === 'error')).toBe(true);
    }
  });

  it('fails COV association deterministically (orphan, duplicate, missing)', () => {
    const orphan = `${HEADER}\nGX A 0 0 0 FIXED\nGX B 1 0 0\nCOV 1 0 0 1 0 1\n`;
    expect(parseGnssBaselineText(orphan).diagnostics.some((d) => d.code === 'GNSS_ORPHAN_COVARIANCE')).toBe(true);
    const duplicate =
      `${HEADER}\nGX A 0 0 0 FIXED\nGX B 1 0 0\nBL A B 1 0 0\nCOV 0.000004 0 0 0.000004 0 0.000004\nCOV 0.000004 0 0 0.000004 0 0.000004\n`;
    const dupResult = parseGnssBaselineText(duplicate);
    expect(dupResult.network).toBeNull();
    expect(dupResult.diagnostics.some((d) => d.code === 'GNSS_ORPHAN_COVARIANCE' || d.code === 'GNSS_MISSING_COVARIANCE')).toBe(true);
    const missing = `${HEADER}\nGX A 0 0 0 FIXED\nGX B 1 0 0\nBL A B 1 0 0\n`;
    expect(parseGnssBaselineText(missing).diagnostics.some((d) => d.code === 'GNSS_MISSING_COVARIANCE')).toBe(true);
  });

  it('rejects mixed legacy records and unknown codes without silent drops', () => {
    const mixed = `${HEADER}\nGX A 0 0 0 FIXED\nGX B 1 0 0\nG A B 1 2\nBL A B 1 0 0\nCOV 0.000004 0 0 0.000004 0 0.000004\n`;
    const mixedResult = parseGnssBaselineText(mixed);
    expect(mixedResult.network).toBeNull();
    expect(mixedResult.diagnostics.some((d) => d.code === 'GNSS_MIXED_MODE')).toBe(true);
    const unknown = `${HEADER}\nGX A 0 0 0 FIXED\nGX B 1 0 0\nZZZ whatever\n`;
    expect(parseGnssBaselineText(unknown).diagnostics.some((d) => d.code === 'GNSS_UNKNOWN_RECORD')).toBe(true);
  });

  it('reports structural problems with stable codes and line numbers', () => {
    const cases: [string, string][] = [
      ['GX A 0 0 0 FIXED\nGX B 1 0 0\nBL A B 1 0 0\nCOV 0.000004 0 0 0.000004 0 0.000004\n', 'GNSS_MISSING_FRAME'],
      [`FRAME ECEF F EPOCH 2020.0 ELLIPSOID GRS80\nGX A 0 0 0 FIXED\nGX B 1 0 0\nBL A B 1 0 0\nCOV 0.000004 0 0 0.000004 0 0.000004\n`, 'GNSS_MISSING_UNITS'],
      [`FRAME ECEF F EPOCH 2020.0 ELLIPSOID GRS80\nUNITS FT\nGX A 0 0 0 FIXED\nGX B 1 0 0\nBL A B 1 0 0\nCOV 1 0 0 1 0 1\n`, 'GNSS_UNSUPPORTED_UNITS'],
      [`FRAME ECEF F EPOCH 2020.0 ELLIPSOID GRS80\nUNITS M\nGX A 0 0 0 FIXED\nBL A A 1 0 0\nCOV 0.000004 0 0 0.000004 0 0.000004\n`, 'GNSS_SELF_BASELINE'],
      [`FRAME ECEF F EPOCH 2020.0 ELLIPSOID GRS80\nUNITS M\nGX A 0 0 0 FIXED\nBL A Q 1 0 0\nCOV 0.000004 0 0 0.000004 0 0.000004\n`, 'GNSS_UNKNOWN_STATION'],
      [`FRAME ECEF F EPOCH 2020.0 ELLIPSOID GRS80\nUNITS M\nGX A 0 0 0 FIXED\nGX B 1 0 0\nBL A B 1 0 0 ID X\nCOV 0.000004 0 0 0.000004 0 0.000004\nBL A B 1 0 0 ID X\nCOV 0.000004 0 0 0.000004 0 0.000004\n`, 'GNSS_DUPLICATE_ID'],
      [`FRAME ECEF F EPOCH 2020.0 ELLIPSOID GRS80\nUNITS M\nGX A 0 0 0 FIXED\nGX B 1 0 0\nBL A B 1 0 0\nCOV 1 2 0 1 0 1\n`, 'GNSS_BAD_COVARIANCE'],
    ];
    cases.forEach(([body, code]) => {
      const result = parseGnssBaselineText(body);
      expect(result.network, `expected failure with ${code}`).toBeNull();
      expect(result.diagnostics.some((d) => d.code === code), `missing code ${code}`).toBe(true);
    });
    const selfLine = parseGnssBaselineText(cases[3]![0]);
    expect(selfLine.diagnostics.find((d) => d.code === 'GNSS_SELF_BASELINE')!.line).toBe(4);
  });

  it('datum failures surface in validation without solving', () => {
    const free =
      'FRAME ECEF ITRF2020@2020.0 EPOCH 2020.0 ELLIPSOID GRS80\nUNITS M\n' +
      'GX A 0 0 0\nGX B 100 0 0\nBL A B 100 0 0\nCOV 0.000004 0 0 0.000004 0 0.000004\n';
    const { network } = parseGnssBaselineText(free);
    expect(network).not.toBeNull();
    const validation = validateGnssBaselineNetwork(network!);
    expect(validation.some((d) => d.code === 'GNSS_UNCONTROLLED_COMPONENT')).toBe(true);
    expect(() => runGnssBaselineAdjustment({ stations: network!.stations, baselines: network!.baselines })).toThrow();
  });

  it('warns on zero-length vectors between distinct stations but accepts them', () => {
    const text = `${HEADER}\nGX A 0 0 0 FIXED\nGX B 100 0 0\nBL A B 0 0 0\nCOV 0.000004 0 0 0.000004 0 0.000004\n`;
    const { network, diagnostics } = parseGnssBaselineText(text);
    expect(network).not.toBeNull();
    expect(diagnostics.some((d) => d.code === 'GNSS_ZERO_LENGTH' && d.severity === 'warning')).toBe(true);
  });
});
