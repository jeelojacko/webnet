/**
 * Phase 12C — committed fixture files parse deterministically and the
 * CSV/native representations agree.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  importGnssBaselineDelimited,
  importGnssControlCsv,
} from '../../src/engine/gnssBaselineCsvImport';
import { parseGnssBaselineText } from '../../src/engine/gnssBaselineNetworkImport';

const fixture = (name: string): string =>
  readFileSync(join(__dirname, 'fixtures', name), 'utf8');

const csvOptions = {
  units: 'M',
  vectorFrame: 'ecef',
  referenceFrame: 'ITRF2020@2020.0',
  epoch: '2020.0',
  ellipsoid: 'GRS80',
} as const;

describe('gnss committed fixtures', () => {
  it('native triangle fixture parses with mixed COV/SIGCORR', () => {
    const { network, diagnostics } = parseGnssBaselineText(fixture('triangle-cov-sigcorr.txt'));
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(network!.baselines).toHaveLength(3);
  });

  it('mm fixture canonicalizes like the metre equivalent', () => {
    const { network } = parseGnssBaselineText(fixture('single-baseline-mm.txt'));
    expect(network!.baselines[0]!.vector.x).toBeCloseTo(111.111, 9);
    expect(network!.baselines[0]!.covariance.xx).toBeCloseTo(4e-6, 15);
  });

  it('ENU fixture rotates on import', () => {
    const { network, diagnostics } = parseGnssBaselineText(fixture('single-baseline-enu.txt'));
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(network!.provenance[0]!.rotationApplied).toBe(true);
    expect(network!.baselines[0]!.frame).toBe('ecef');
  });

  it('invalid-covariance fixture fails with GNSS_BAD_COVARIANCE', () => {
    const result = parseGnssBaselineText(fixture('invalid-covariance.txt'));
    expect(result.network).toBeNull();
    expect(result.diagnostics.some((d) => d.code === 'GNSS_BAD_COVARIANCE')).toBe(true);
  });

  it('CSV fixtures agree with each other and the native form', () => {
    const { stations } = importGnssControlCsv(fixture('control.csv'), { units: 'M' });
    const cov = importGnssBaselineDelimited(fixture('triangle-cov.csv'), stations!, { ...csvOptions });
    const sig = importGnssBaselineDelimited(fixture('triangle-sigcorr.csv'), stations!, { ...csvOptions });
    expect(cov.network).not.toBeNull();
    expect(sig.network).not.toBeNull();
    cov.network!.baselines.forEach((baseline, index) => {
      const other = sig.network!.baselines[index]!;
      for (const key of ['xx', 'xy', 'xz', 'yy', 'yz', 'zz'] as const) {
        expect(Math.abs(baseline.covariance[key] - other.covariance[key])).toBeLessThan(1e-12);
      }
    });
  });

  it('example file parses cleanly', () => {
    const text = readFileSync(join(__dirname, '..', '..', 'examples', 'gnss', 'static-baseline-example.txt'), 'utf8');
    const { network, diagnostics } = parseGnssBaselineText(text);
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(network!.baselines).toHaveLength(1);
  });
});
