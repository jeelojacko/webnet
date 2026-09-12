/**
 * Phase 12C — Phase 12B fixtures 1, 2, 4, 5, 6, 7, 8 through the file
 * boundary, plus TS-dense-only routing proof for imported networks.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runGnssBaselineAdjustment } from '../../src/engine/gnssBaselineAdjust';
import { isGnssBaselineObservation } from '../../src/engine/gnssBaselineTypes';
import {
  parseGnssBaselineText,
  validateGnssBaselineNetwork,
} from '../../src/engine/gnssBaselineNetworkImport';
import { runGoldenBaselineAdjustment } from './gnssBaselineGolden';

const HEADER = 'FRAME ECEF ITRF2020@2020.0 EPOCH 2020.0 ELLIPSOID GRS80\nUNITS M';
const ISO = 'COV 0.000025 0 0 0.000025 0 0.000025';

const expectGoldenParity = (text: string): void => {
  const { network, diagnostics } = parseGnssBaselineText(text);
  expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  expect(network).not.toBeNull();
  expect(validateGnssBaselineNetwork(network!)).toEqual([]);
  const result = runGnssBaselineAdjustment({
    stations: network!.stations, baselines: network!.baselines,
  });
  const golden = runGoldenBaselineAdjustment(network!.stations, network!.baselines);
  Object.keys(golden.coordinates).forEach((id) => {
    const solved = result.stations[id]!;
    const expected = golden.coordinates[id]!;
    expect(Math.abs(solved.x - expected.x)).toBeLessThan(1e-9);
    expect(Math.abs(solved.y - expected.y)).toBeLessThan(1e-9);
    expect(Math.abs(solved.h - expected.z)).toBeLessThan(1e-9);
  });
  expect(Math.abs(result.varianceFactor - golden.varianceFactor)).toBeLessThan(1e-9);
};

describe('gnss 12B fixtures through the file boundary', () => {
  it('fixture 1: exact shift', () => {
    const text =
      `${HEADER}\nGX A 3771793 140253 5124304 FIXED\nGX B 3773027.567 140018.375 5124649.375\n` +
      'BL A B 1234.567 -234.125 345.875\n' +
      `${ISO}\n`;
    expectGoldenParity(text);
    const { network } = parseGnssBaselineText(text);
    const result = runGnssBaselineAdjustment({
      stations: network!.stations, baselines: network!.baselines,
    });
    expect(Math.abs(result.stations['B']!.x - 3773027.567)).toBeLessThan(1e-9);
    expect(result.residuals[0]!.magnitude).toBeLessThan(1e-9);
  });

  it('fixture 2: redundant triangle', () => {
    const text =
      `${HEADER}\nGX A 1000 2000 3000 FIXED\nGX B 1100 2050 3010\nGX C 1050 2150 2995\n` +
      'BL A B 100 50 10\n' + `${ISO}\n` +
      'BL B C -50 100 -15\n' + `${ISO}\n` +
      'BL A C 50 150 -5\n' + `${ISO}\n`;
    expectGoldenParity(text);
  });

  it('fixture 4: correlated covariance weights correctly', () => {
    const text =
      `${HEADER}\nGX A 1000 2000 3000 FIXED\nGX B 1100 2050 3010\nGX C 1050 2150 2995\n` +
      'BL A B 100.003 50 10\n' + `${ISO}\n` +
      'BL B C -50 99.996 -14.998\n' + `${ISO}\n` +
      'BL A C 50.001 150.001 -4.999\n' +
      'COV 0.000009 0.000004 0.000001 0.000009 -0.000002 0.000009\n';
    const { network } = parseGnssBaselineText(text);
    expect(network).not.toBeNull();
    expectGoldenParity(text);
    // Correlation must observably move the solution vs diagonal-only.
    const diagonalized = text.replace(
      'COV 0.000009 0.000004 0.000001 0.000009 -0.000002 0.000009',
      'COV 0.000009 0 0 0.000009 0 0.000009',
    );
    const full = runGnssBaselineAdjustment({
      stations: network!.stations, baselines: network!.baselines,
    });
    const diag = parseGnssBaselineText(diagonalized).network!;
    const diagResult = runGnssBaselineAdjustment({ stations: diag.stations, baselines: diag.baselines });
    const shift = Math.hypot(
      full.stations['B']!.x - diagResult.stations['B']!.x,
      full.stations['B']!.y - diagResult.stations['B']!.y,
      full.stations['B']!.h - diagResult.stations['B']!.h,
    );
    expect(shift).toBeGreaterThan(1e-6);
  });

  it('fixture 5: reversal equivalence through text', () => {
    const cov = 'COV 0.000004 0.000001 0 0.000009 0.000001 0.000016';
    const forward =
      `${HEADER}\nGX A 2000 3000 4000 FIXED\nGX B 2150 3075 4025\nGX C 2080 3180 3990\n` +
      `BL A B 150 75 25\n${cov}\nBL B C -70 105 -35\n${cov}\nBL A C 80 180 -10\n${cov}\n`;
    const reversed =
      `${HEADER}\nGX A 2000 3000 4000 FIXED\nGX B 2150 3075 4025\nGX C 2080 3180 3990\n` +
      `BL B A -150 -75 -25\n${cov}\nBL C B 70 -105 35\n${cov}\nBL C A -80 -180 10\n${cov}\n`;
    const fwd = parseGnssBaselineText(forward).network!;
    const rev = parseGnssBaselineText(reversed).network!;
    const fwdResult = runGnssBaselineAdjustment({ stations: fwd.stations, baselines: fwd.baselines });
    const revResult = runGnssBaselineAdjustment({ stations: rev.stations, baselines: rev.baselines });
    for (const id of ['B', 'C']) {
      expect(Math.abs(fwdResult.stations[id]!.x - revResult.stations[id]!.x)).toBeLessThan(1e-9);
      expect(Math.abs(fwdResult.stations[id]!.y - revResult.stations[id]!.y)).toBeLessThan(1e-9);
      expect(Math.abs(fwdResult.stations[id]!.h - revResult.stations[id]!.h)).toBeLessThan(1e-9);
    }
    expect(Math.abs(fwdResult.varianceFactor - revResult.varianceFactor)).toBeLessThan(1e-12);
  });

  it('fixture 6: bad covariance refused at the boundary', () => {
    const text =
      `${HEADER}\nGX A 1000 2000 3000 FIXED\nGX B 1100 2050 3010\n` +
      'BL A B 100 50 10\nCOV 0.000001 0.000005 0 0.000001 0 0.000001\n';
    const result = parseGnssBaselineText(text);
    expect(result.network).toBeNull();
    expect(result.diagnostics.some((d) => d.code === 'GNSS_BAD_COVARIANCE')).toBe(true);
  });

  it('fixture 7: free network refused (parse ok, validation fails, solve throws)', () => {
    const text =
      `${HEADER}\nGX A 1000 2000 3000\nGX B 1100 2050 3010\n` +
      `BL A B 100 50 10\n${ISO}\n`;
    const { network, diagnostics } = parseGnssBaselineText(text);
    expect(network).not.toBeNull();
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const validation = validateGnssBaselineNetwork(network!);
    expect(validation.some((d) => d.code === 'GNSS_UNCONTROLLED_COMPONENT')).toBe(true);
    expect(() => runGnssBaselineAdjustment({
      stations: network!.stations, baselines: network!.baselines,
    })).toThrow(/no fully fixed 3D station/);
  });

  it('fixture 8: repeated baselines with golden parity', () => {
    const text =
      `${HEADER}\nGX A 5000 6000 7000 FIXED\nGX B 5100 6050 7010\n` +
      'BL A B 100 50 10 SOLUTION run1\nCOV 0.000004 0 0 0.000004 0 0.000004\n' +
      'BL A B 100.004 50.002 10.001 SOLUTION run2\nCOV 0.000016 0 0 0.000016 0 0.000016\n';
    expectGoldenParity(text);
    const { network } = parseGnssBaselineText(text);
    const result = runGnssBaselineAdjustment({
      stations: network!.stations, baselines: network!.baselines,
    });
    expect(result.stations['B']!.x - 5000).toBeCloseTo(100.0008, 9);
  });
});

describe('gnss imported-network routing', () => {
  it('imported baselines trip the native/sparse exclusion gates', () => {
    const { network } = parseGnssBaselineText(
      `${HEADER}\nGX A 0 0 0 FIXED\nGX B 100 0 0\nBL A B 100 0 0\n${ISO}\n`,
    );
    expect(network).not.toBeNull();
    expect(network!.baselines.some((obs) => isGnssBaselineObservation(obs))).toBe(true);
    // The 12B tripwires key off this guard; imported observations must match.
    expect(isGnssBaselineObservation({ type: 'gps' })).toBe(false);
  });

  it('import path solves TS-dense only: no WASM loads, frame tagged ecef', () => {
    const { network } = parseGnssBaselineText(
      `${HEADER}\nGX A 0 0 0 FIXED\nGX B 100 50 10\nBL A B 100 50 10\n${ISO}\n`,
    );
    const result = runGnssBaselineAdjustment({
      stations: network!.stations, baselines: network!.baselines,
    });
    expect(result.adjustmentFrame).toBe('ecef');
    expect(result.routeProvenance).toBe('typescript-dense');
  });

  it('new import modules never touch WASM, sparse solvers, robust, or geoid code', () => {
    const root = join(__dirname, '..', '..', 'src', 'engine');
    for (const file of ['gnssBaselineRotation.ts', 'gnssBaselineNetworkImport.ts', 'gnssBaselineCsvImport.ts']) {
      const source = readFileSync(join(root, file), 'utf8');
      const imports = source.split('\n').filter((line) => line.startsWith('import '));
      imports.forEach((line) => {
        expect(line).not.toMatch(/geoid|wasm|huber/i);
      });
      expect(source).not.toMatch(/sparseCorrectionSolver|robustMode|Worker|WebAssembly/);
    }
  });
});
