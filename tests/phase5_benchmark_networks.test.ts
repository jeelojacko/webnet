import { describe, expect, it } from 'vitest';

import { LSAEngine } from '../src/engine/adjust';
import {
  buildPhase5BenchmarkCases,
  decimalDegreesToBearingDms,
  generatePhase5BenchmarkInput,
  listPhase5BenchmarkCases,
} from '../src/engine/phase5BenchmarkNetworks';

describe('phase 5 benchmark network generator', () => {
  it('lists two quick cases and six full cases', () => {
    expect(listPhase5BenchmarkCases(true).map((spec) => spec.id)).toEqual([
      'chain-2d-04',
      'gps-2d-08',
    ]);
    expect(listPhase5BenchmarkCases(false)).toHaveLength(6);
  });

  it('regenerates byte-identical inputs for the same spec', () => {
    const spec = { id: 'chain-2d-08', family: 'chain-2d' as const, unknownCount: 8, seed: 1108 };
    expect(generatePhase5BenchmarkInput(spec)).toBe(generatePhase5BenchmarkInput(spec));
    expect(buildPhase5BenchmarkCases(false).map((c) => c.input)).toEqual(
      buildPhase5BenchmarkCases(false).map((c) => c.input),
    );
  });

  it('produces distinct inputs for distinct seeds', () => {
    const base = { id: 'chain-2d-04', family: 'chain-2d' as const, unknownCount: 4 };
    expect(generatePhase5BenchmarkInput({ ...base, seed: 1 })).not.toBe(
      generatePhase5BenchmarkInput({ ...base, seed: 2 }),
    );
  });

  it('formats bearings as DDD-MM-SS.s within compass range', () => {
    expect(decimalDegreesToBearingDms(0)).toBe('000-00-00.0');
    expect(decimalDegreesToBearingDms(65.172)).toMatch(/^0?65-10-.*$/);
    expect(decimalDegreesToBearingDms(360)).toBe('000-00-00.0');
    expect(decimalDegreesToBearingDms(-90)).toBe('270-00-00.0');
  });

  it('keeps GPS vectors in the gps family only', () => {
    const chain = generatePhase5BenchmarkInput({
      id: 'chain-2d-04',
      family: 'chain-2d',
      unknownCount: 4,
      seed: 1101,
    });
    const gps = generatePhase5BenchmarkInput({
      id: 'gps-2d-08',
      family: 'gps-2d',
      unknownCount: 8,
      seed: 2202,
    });
    expect(chain).not.toContain('\nG ');
    expect(gps.split('\n').filter((line) => line.startsWith('G GPS1'))).toHaveLength(8);
  });

  it('solves every listed case to convergence', () => {
    for (const benchmarkCase of buildPhase5BenchmarkCases(false)) {
      const result = new LSAEngine({ input: benchmarkCase.input }).solve();
      expect(result.success).toBe(true);
      expect(result.converged).toBe(true);
      expect(Object.keys(result.stations)).toHaveLength(benchmarkCase.stationCount);
      expect(result.observations.length).toBeGreaterThan(0);
      const types = new Set(result.observations.map((obs) => obs.type));
      expect(types.has('dist')).toBe(true);
      expect(types.has('bearing')).toBe(true);
    }
  });

  it('solves deterministically from the same input', () => {
    const input = generatePhase5BenchmarkInput({
      id: 'gps-2d-08',
      family: 'gps-2d',
      unknownCount: 8,
      seed: 2202,
    });
    const first = new LSAEngine({ input }).solve();
    const second = new LSAEngine({ input }).solve();
    for (const [id, station] of Object.entries(first.stations)) {
      expect(second.stations[id]?.x).toBe(station.x);
      expect(second.stations[id]?.y).toBe(station.y);
    }
  });
});
