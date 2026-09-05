import { describe, expect, it } from 'vitest';

import { LSAEngine } from '../src/engine/adjust';
import { generatePhase5BenchmarkInput } from '../src/engine/phase5BenchmarkNetworks';
import {
  compareSparseShadowResults,
  formatSparseShadowSummaryLine,
} from '../src/engine/phase6SparseShadowCompare';

const solve = (input: string) => new LSAEngine({ input }).solve();

describe('phase 6 sparse shadow comparison helper', () => {
  it('passes with zero maxima for identical results', () => {
    const input = generatePhase5BenchmarkInput({
      id: 'chain-2d-04',
      family: 'chain-2d',
      unknownCount: 4,
      seed: 1101,
    });
    const reference = solve(input);
    const comparison = compareSparseShadowResults(reference, reference, 1e-6);
    expect(comparison.pass).toBe(true);
    expect(comparison.maxCoordDiffM).toBe(0);
    expect(comparison.maxHeightDiffM).toBe(0);
    expect(comparison.maxResidualDiff).toBe(0);
    expect(comparison.maxStdResDiff).toBe(0);
    expect(comparison.seuwDiff).toBe(0);
    expect(comparison.iterationsMatch).toBe(true);
    expect(formatSparseShadowSummaryLine(comparison)).toContain('pass=true');
  });

  it('detects coordinate and iteration mismatches deterministically', () => {
    const input = generatePhase5BenchmarkInput({
      id: 'chain-2d-04',
      family: 'chain-2d',
      unknownCount: 4,
      seed: 1101,
    });
    const reference = solve(input);
    const shifted = solve(input);
    const firstId = Object.keys(shifted.stations).sort()[0] ?? '';
    if (firstId) shifted.stations[firstId].x += 0.01;
    shifted.iterations += 1;
    const comparison = compareSparseShadowResults(reference, shifted, 1e-6);
    expect(comparison.pass).toBe(false);
    expect(comparison.maxCoordDiffM).toBeCloseTo(0.01, 9);
    expect(comparison.worstStationId).toBe(firstId);
    expect(comparison.iterationsMatch).toBe(false);
    expect(comparison.passReasons.join(';')).toContain('iteration-count mismatch');
  });

  it('exposes solve timing stages for runtime breakdown reporting', () => {
    const input = generatePhase5BenchmarkInput({
      id: 'gps-2d-08',
      family: 'gps-2d',
      unknownCount: 8,
      seed: 2202,
    });
    const result = solve(input);
    const timing = result.solveTimingProfile;
    expect(timing).toBeDefined();
    for (const stage of [
      'parseAndSetupMs',
      'equationAssemblyMs',
      'matrixFactorizationMs',
      'precisionAndDiagnosticsMs',
      'precisionPropagationMs',
      'resultPackagingMs',
      'otherMs',
      'totalMs',
    ] as const) {
      expect(typeof timing?.[stage]).toBe('number');
    }
  });
});
