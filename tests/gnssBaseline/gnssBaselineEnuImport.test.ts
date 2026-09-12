/**
 * Phase 12C — shared-ENU import tests (GATE D).
 *
 * An ECEF-direct network and the same network expressed in ENU must
 * canonicalize to the same observations and adjust identically.
 * Covariance rotation is checked against an independently coded
 * C_ecef = R^T * C_enu * R (not the production function).
 */
import { describe, expect, it } from 'vitest';
import { runGnssBaselineAdjustment } from '../../src/engine/gnssBaselineAdjust';
import { buildEnuRotation, rotateEnuCovarianceToEcef } from '../../src/engine/gnssBaselineRotation';
import { parseGnssBaselineText } from '../../src/engine/gnssBaselineNetworkImport';
import type { GnssBaselineCovariance } from '../../src/engine/gnssBaselineTypes';

const FRAME_ID = 'ITRF2020@2020.0';
const LAT = 46.123;
const LON = -67.456;

const ecefText = (): string =>
  `FRAME ECEF ${FRAME_ID} EPOCH 2020.0 ELLIPSOID GRS80\nUNITS M\n` +
  'GX A 1000000 2000000 3000000 FIXED\n' +
  'GX B 1000111.222 1999995.5 3000001.25\n' +
  'GX C 999950 2000100.75 2999998\n' +
  'BL A B 111.222 -4.5 1.25 SESSION S1\n' +
  'COV 0.000004 0.000001 0.0000002 0.000009 -0.0000003 0.000016\n' +
  'BL A C -50 100.75 -2 SESSION S1\n' +
  'COV 0.000009 0 0 0.000004 0.0000005 0.000025\n';

// Independent reference rotation (separately written matrix multiply).
const referenceEnu = (latDeg: number, lonDeg: number, x: number, y: number, z: number): [number, number, number] => {
  const phi = (latDeg * Math.PI) / 180;
  const lambda = (lonDeg * Math.PI) / 180;
  const r: number[][] = [
    [-Math.sin(lambda), Math.cos(lambda), 0],
    [-Math.sin(phi) * Math.cos(lambda), -Math.sin(phi) * Math.sin(lambda), Math.cos(phi)],
    [Math.cos(phi) * Math.cos(lambda), Math.cos(phi) * Math.sin(lambda), Math.sin(phi)],
  ];
  return [
    r[0]![0]! * x + r[0]![1]! * y + r[0]![2]! * z,
    r[1]![0]! * x + r[1]![1]! * y + r[1]![2]! * z,
    r[2]![0]! * x + r[2]![1]! * y + r[2]![2]! * z,
  ];
};

const referenceCovToEnu = (latDeg: number, lonDeg: number, cov: GnssBaselineCovariance): GnssBaselineCovariance => {
  const phi = (latDeg * Math.PI) / 180;
  const lambda = (lonDeg * Math.PI) / 180;
  const r: number[][] = [
    [-Math.sin(lambda), Math.cos(lambda), 0],
    [-Math.sin(phi) * Math.cos(lambda), -Math.sin(phi) * Math.sin(lambda), Math.cos(phi)],
    [Math.cos(phi) * Math.cos(lambda), Math.cos(phi) * Math.sin(lambda), Math.sin(phi)],
  ];
  const c = [[cov.xx, cov.xy, cov.xz], [cov.xy, cov.yy, cov.yz], [cov.xz, cov.yz, cov.zz]];
  const rc = r.map((row) => c[0]!.map((_, j) => row[0]! * c[0]![j]! + row[1]! * c[1]![j]! + row[2]! * c[2]![j]!));
  const out = rc.map((row) =>
    [0, 1, 2].map((j) => row[0]! * r[j]![0]! + row[1]! * r[j]![1]! + row[2]! * r[j]![2]!),
  );
  return { xx: out[0]![0]!, xy: out[0]![1]!, xz: out[0]![2]!, yy: out[1]![1]!, yz: out[1]![2]!, zz: out[2]![2]! };
};

const toEnuText = (): string => {
  const ecef = parseGnssBaselineText(ecefText()).network!;
  const lines = [
    `FRAME ENU ${FRAME_ID} EPOCH 2020.0 ELLIPSOID GRS80 ORIGIN_LAT ${LAT} ORIGIN_LON ${LON}`,
    'UNITS M',
    'GX A 1000000 2000000 3000000 FIXED',
    'GX B 1000111.222 1999995.5 3000001.25',
    'GX C 999950 2000100.75 2999998',
  ];
  ecef.baselines.forEach((baseline) => {
    const [e, n, u] = referenceEnu(LAT, LON, baseline.vector.x, baseline.vector.y, baseline.vector.z);
    const enuCov = referenceCovToEnu(LAT, LON, baseline.covariance);
    lines.push(`BL ${baseline.from} ${baseline.to} ${e} ${n} ${u} SESSION S1`);
    lines.push(`COV ${enuCov.xx} ${enuCov.xy} ${enuCov.xz} ${enuCov.yy} ${enuCov.yz} ${enuCov.zz}`);
  });
  return `${lines.join('\n')}\n`;
};

describe('gnss ENU shared-origin import', () => {
  it('canonicalizes ENU input to the ECEF-direct equivalent (GATE D)', () => {
    const ecef = parseGnssBaselineText(ecefText()).network!;
    const enuParsed = parseGnssBaselineText(toEnuText());
    expect(enuParsed.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const enu = enuParsed.network!;
    expect(enu.provenance.every((trace) => trace.rotationApplied)).toBe(true);
    expect(enu.provenance.every((trace) => trace.inputFrame === 'enu')).toBe(true);
    let vectorDiff = 0;
    let covDiff = 0;
    enu.baselines.forEach((baseline, index) => {
      const expected = ecef.baselines[index]!;
      vectorDiff = Math.max(
        vectorDiff,
        Math.abs(baseline.vector.x - expected.vector.x),
        Math.abs(baseline.vector.y - expected.vector.y),
        Math.abs(baseline.vector.z - expected.vector.z),
      );
      for (const key of ['xx', 'xy', 'xz', 'yy', 'yz', 'zz'] as const) {
        covDiff = Math.max(covDiff, Math.abs(baseline.covariance[key] - expected.covariance[key]));
      }
    });
    expect(vectorDiff).toBeLessThan(1e-9);
    expect(covDiff).toBeLessThan(1e-15);
  });

  it('preserves symmetry, SPD, trace, and determinant under covariance rotation', () => {
    const rotation = buildEnuRotation(LAT, LON);
    const anisotropic: GnssBaselineCovariance = {
      xx: 4e-6, xy: 1e-6, xz: 2e-7, yy: 9e-6, yz: -3e-7, zz: 16e-6,
    };
    const rotated = rotateEnuCovarianceToEcef(rotation, anisotropic);
    const traceIn = anisotropic.xx + anisotropic.yy + anisotropic.zz;
    const traceOut = rotated.xx + rotated.yy + rotated.zz;
    expect(Math.abs(traceIn - traceOut)).toBeLessThan(1e-21);
    const det = (c: GnssBaselineCovariance): number =>
      c.xx * (c.yy * c.zz - c.yz * c.yz) -
      c.xy * (c.xy * c.zz - c.yz * c.xz) +
      c.xz * (c.xy * c.yz - c.yy * c.xz);
    expect(Math.abs(det(rotated) - det(anisotropic)) / det(anisotropic)).toBeLessThan(1e-12);
    // SPD: leading principal minors positive.
    expect(rotated.xx).toBeGreaterThan(0);
    expect(rotated.xx * rotated.yy - rotated.xy * rotated.xy).toBeGreaterThan(0);
    expect(det(rotated)).toBeGreaterThan(0);
  });

  it('ENU-imported and ECEF-imported networks adjust identically', () => {
    const ecef = parseGnssBaselineText(ecefText()).network!;
    const enu = parseGnssBaselineText(toEnuText()).network!;
    const resultEcef = runGnssBaselineAdjustment({ stations: ecef.stations, baselines: ecef.baselines });
    const resultEnu = runGnssBaselineAdjustment({ stations: enu.stations, baselines: enu.baselines });
    for (const id of ['B', 'C']) {
      expect(Math.abs(resultEcef.stations[id]!.x - resultEnu.stations[id]!.x)).toBeLessThan(1e-9);
      expect(Math.abs(resultEcef.stations[id]!.y - resultEnu.stations[id]!.y)).toBeLessThan(1e-9);
      expect(Math.abs(resultEcef.stations[id]!.h - resultEnu.stations[id]!.h)).toBeLessThan(1e-9);
    }
    expect(Math.abs(resultEcef.varianceFactor - resultEnu.varianceFactor)).toBeLessThan(1e-12);
  });

  it('rejects ENU frames without an origin', () => {
    const text =
      `FRAME ENU ${FRAME_ID} EPOCH 2020.0 ELLIPSOID GRS80\nUNITS M\n` +
      'GX A 0 0 0 FIXED\nGX B 1 0 0\nBL A B 1 0 0\nCOV 1 0 0 1 0 1\n';
    const result = parseGnssBaselineText(text);
    expect(result.network).toBeNull();
    expect(result.diagnostics.some((d) => d.code === 'GNSS_BAD_FRAME')).toBe(true);
  });
});
