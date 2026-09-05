/**
 * Phase 6 sparse-only large benchmark networks: pure generator/guard/estimate tests.
 * No WASM, no solves; production routing/math untouched.
 */
import { describe, expect, it } from 'vitest';

import {
  applyPhase6LargeVariant,
  buildPhase6LargeBenchmarkCases,
  estimatePhase6SparseStorage,
  generatePhase6Large3dInput,
  listPhase6LargeBenchmarkCases,
  phase6ChainTruth,
  phase6FarControlEasting,
  phase6HeightTruth,
  phase6LargeSizeSkipReason,
  PHASE6_SPARSE_LARGE_DEFAULT_MAX_UNKNOWN_COUNT,
} from '../src/engine/phase6BenchmarkNetworks';
import { generatePhase5BenchmarkInput } from '../src/engine/phase5BenchmarkNetworks';

describe('phase6 large benchmark cases', () => {
  it('lists large chain/GPS cases plus modest variant cases in full mode', () => {
    const cases = listPhase6LargeBenchmarkCases(false);
    expect(cases.map((c) => c.id)).toEqual([
      'chain-2d-256',
      'chain-2d-512',
      'chain-2d-1000',
      'gps-2d-128',
      'gps-2d-256',
      'gps-2d-cov-08',
      'chain-2d-robust-tscorr-16',
      'gps-3d-cov-08',
      'gps-3d-16',
      'gps-3d-32',
      'gps-3d-64',
      'gps-3d-128',
    ]);
  });

  it('keeps quick mode to three bounded cases', () => {
    const cases = listPhase6LargeBenchmarkCases(true);
    expect(cases.map((c) => c.id)).toEqual(['chain-2d-16', 'gps-2d-16', 'gps-3d-16']);
    expect(cases.every((c) => c.variant === 'plain' || c.dimension === '3d')).toBe(true);
  });

  it('generates deterministically from the shared Phase 5 generator', () => {
    const first = buildPhase6LargeBenchmarkCases(false);
    const second = buildPhase6LargeBenchmarkCases(false);
    expect(first.map((c) => c.input)).toEqual(second.map((c) => c.input));
    const chain256 = first.find((c) => c.id === 'chain-2d-256');
    expect(chain256?.stationCount).toBe(258);
    expect(chain256?.input).toContain('.2D');
    const controlLines = (chain256?.input ?? '').split('\n').filter((l) => l.startsWith('C '));
    expect(controlLines.length).toBe(258);
  });

  it('applies variant directives using existing parser syntax', () => {
    const base = generatePhase5BenchmarkInput({
      id: 'x',
      family: 'gps-2d',
      unknownCount: 4,
      seed: 1,
    });
    expect(applyPhase6LargeVariant(base, 'plain')).toBe(base);
    expect(applyPhase6LargeVariant(base, 'gps-covariance')).toContain('.GPS WEIGHT COVARIANCE');
    const robust = applyPhase6LargeVariant(base, 'robust-tscorr');
    expect(robust).toContain('.ROBUST HUBER 1.5');
    expect(robust).toContain('.TSCORR ON');
    const built = buildPhase6LargeBenchmarkCases(false);
    expect(built.find((c) => c.id === 'gps-2d-cov-08')?.input).toContain(
      '.GPS WEIGHT COVARIANCE',
    );
    expect(built.find((c) => c.id === 'chain-2d-robust-tscorr-16')?.input).toContain('.TSCORR ON');
  });

  it('builds a modest deterministic 3D/GPS correlated case', () => {
    const built = buildPhase6LargeBenchmarkCases(false);
    const threeD = built.find((c) => c.id === 'gps-3d-cov-08');
    expect(threeD?.dimension).toBe('3d');
    expect(threeD?.stationCount).toBe(10);
    expect(threeD?.input).toContain('.3D');
    expect(threeD?.input).toContain('.GPS WEIGHT COVARIANCE');
    expect(threeD?.input).toContain('V CTRLA-U1');
    expect(threeD?.input).toContain(' 0.010 0.010 0.35');
    expect(threeD?.input).toContain('C CTRLA 0.0000 0.0000 10.0000 ! ! !');
    expect(phase6HeightTruth(0)).toBe(10);
    expect(phase6HeightTruth(1)).toBeCloseTo(10 + 1.5 * Math.sin(0.45), 12);
    // Deterministic: same spec rebuilds byte-identical input.
    const spec = listPhase6LargeBenchmarkCases(false).find((c) => c.id === 'gps-3d-cov-08');
    expect(generatePhase6Large3dInput(spec!)).toBe(threeD?.input);
  });

  it('exposes chain truth matching the generator layout', () => {
    expect(phase6ChainTruth(0)).toEqual({
      e: 60,
      n: 25 * Math.sin(0.7) + 12 * Math.sin(0.23 + 1.1),
    });
    expect(phase6FarControlEasting(4)).toBe(300);
  });

  it('fails closed on the size guard', () => {
    const big = { id: 'chain-2d-1000', family: 'chain-2d', unknownCount: 1000, seed: 1 } as const;
    expect(
      phase6LargeSizeSkipReason(big, PHASE6_SPARSE_LARGE_DEFAULT_MAX_UNKNOWN_COUNT),
    ).toBeNull();
    expect(phase6LargeSizeSkipReason(big, 256)).toContain('SPARSE_LARGE_MAX_UNKNOWN_COUNT=256');
  });
});

describe('estimatePhase6SparseStorage', () => {
  it('contrasts dense P/N/Qxx estimates with sparse metadata', () => {
    const estimate = estimatePhase6SparseStorage({
      equationRows: 100,
      paramCount: 50,
      designNnz: 400,
      weightNnz: 100,
      normalNnz: 200,
      factorNnz: 300,
    });
    expect(estimate.densePBytes).toBe(100 * 100 * 8);
    expect(estimate.denseNBytes).toBe(50 * 50 * 8);
    expect(estimate.denseQxxBytes).toBe(50 * 50 * 8);
    expect(estimate.sparseDesignBytes).toBe(400 * 12);
    expect(estimate.sparseFactorBytes).toBe(300 * 8);
    expect(estimate.sparseTotalBytes).toBe(
      estimate.sparseDesignBytes +
        estimate.sparseWeightBytes +
        estimate.sparseNormalBytes +
        estimate.sparseFactorBytes,
    );
    expect(estimate.sparseTotalBytes).toBeLessThan(estimate.denseTotalBytes);
  });
});
