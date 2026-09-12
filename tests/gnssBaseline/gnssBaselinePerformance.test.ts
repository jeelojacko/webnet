/**
 * Phase 12B — diagnostic scaling record for TS-dense baseline networks.
 *
 * Record-only (no time gates; machines differ): builds 10/50/100-station
 * chain networks with realistic sparse connectivity, asserts correctness,
 * and logs wall time to expose accidental O(B^2) construction overhead.
 */
import { describe, expect, it } from 'vitest';
import { runGnssBaselineAdjustment } from '../../src/engine/gnssBaselineAdjust';
import {
  buildBaselines,
  buildStations,
  isotropicCovariance,
  resetBaselineIds,
} from './gnssBaselineTestBuilder';

const buildChain = (stationCount: number) => {
  const stations = buildStations(
    Array.from({ length: stationCount }, (_, index) => ({
      id: `S${index}`,
      x: 1000 + 137.5 * index,
      y: 2000 + 61.25 * index,
      z: 3000 - 12.5 * index,
      fixed: index === 0,
    })),
  );
  const baselines = buildBaselines(
    Array.from({ length: stationCount - 1 }, (_, index) => ({
      from: `S${index}`,
      to: `S${index + 1}`,
      dx: 137.5,
      dy: 61.25,
      dz: -12.5,
      covariance: isotropicCovariance(0.005),
    })),
  );
  return { stations, baselines };
};

describe('gnssBaselinePerformance', () => {
  it.each([10, 50, 100])('diagnostic: %i-station chain solves correctly', (stationCount) => {
    resetBaselineIds();
    const { stations, baselines } = buildChain(stationCount);
    const startedAt = Date.now();
    const result = runGnssBaselineAdjustment({ stations, baselines });
    const elapsedMs = Date.now() - startedAt;
    expect(result.converged).toBe(true);
    expect(result.numParams).toBe(3 * (stationCount - 1));
    expect(result.numObsEquations).toBe(3 * (stationCount - 1));
    expect(result.dof).toBe(0);
    // Closing geometry: chain vectors are exact, residuals ~0.
    result.residuals.forEach((residual) => {
      expect(residual.magnitude).toBeLessThan(1e-6);
    });
    // eslint-disable-next-line no-console
    console.log(
      `gnssBaseline chain stationCount=${stationCount} ` +
        `params=${result.numParams} equations=${result.numObsEquations} ` +
        `elapsedMs=${elapsedMs} iterations=${result.iterations}`,
    );
  });
});
