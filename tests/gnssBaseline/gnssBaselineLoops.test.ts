/**
 * Phase 12D — loop-closure QC: cycle basis, parallel edges, orientation
 * invariance, perfect/known-error/parallel fixtures.
 */
import { describe, expect, it } from 'vitest';
import {
  computeGnssLoopClosures,
  reverseGnssLoopTraversal,
} from '../../src/engine/gnssBaselineLoops';
import {
  buildBaselines,
  buildStations,
  isotropicCovariance,
  resetBaselineIds,
} from './gnssBaselineTestBuilder';

describe('gnss loop closures', () => {
  it('perfect triangle: closure ~0, T_loop ~0, rank 1', () => {
    resetBaselineIds();
    const baselines = buildBaselines([
      { from: 'A', to: 'B', dx: 100, dy: 0, dz: 0 },
      { from: 'B', to: 'C', dx: 0, dy: 100, dz: 0 },
      { from: 'C', to: 'A', dx: -100, dy: -100, dz: 0 },
    ]);
    const result = computeGnssLoopClosures(baselines);
    expect(result.loops).toHaveLength(1);
    expect(result.cycleRank).toBe(1);
    expect(result.edgeCount).toBe(3);
    expect(result.vertexCount).toBe(3);
    expect(result.componentCount).toBe(1);
    const loop = result.loops[0]!;
    expect(loop.magnitude).toBeLessThan(1e-12);
    expect(loop.tLoop).toBeLessThan(1e-9);
    expect(loop.status).toBe('ok');
    expect(loop.id).toBe('LOOP-001');
  });

  it('known error: closure and statistic match the independent hand computation', () => {
    resetBaselineIds();
    // Non-axis-aligned error (3, -2, 1) mm on B->C.
    const baselines = buildBaselines([
      { from: 'A', to: 'B', dx: 100, dy: 0, dz: 0, covariance: isotropicCovariance(0.002) },
      { from: 'B', to: 'C', dx: 0.003, dy: 99.998, dz: 0.001, covariance: isotropicCovariance(0.002) },
      { from: 'C', to: 'A', dx: -100, dy: -100, dz: 0, covariance: isotropicCovariance(0.002) },
    ]);
    const result = computeGnssLoopClosures(baselines);
    const loop = result.loops[0]!;
    // Orientation-independent check: |s| must equal the injected error.
    expect(loop.magnitude).toBeCloseTo(Math.sqrt(0.003 ** 2 + 0.002 ** 2 + 0.001 ** 2), 12);
    // C_s = 3 * (0.002^2) I; T = |s|^2 / (3*4e-6).
    const expected = (0.003 ** 2 + 0.002 ** 2 + 0.001 ** 2) / (3 * 4e-6);
    expect(loop.tLoop).toBeCloseTo(expected, 9);
  });

  it('parallel solutions form a valid 2-edge cycle of their difference', () => {
    resetBaselineIds();
    const baselines = buildBaselines([
      { from: 'A', to: 'B', dx: 100.0, dy: 50.0, dz: 10.0 },
      { from: 'A', to: 'B', dx: 100.004, dy: 49.998, dz: 10.001 },
    ]);
    const result = computeGnssLoopClosures(baselines);
    expect(result.cycleRank).toBe(1);
    expect(result.loops).toHaveLength(1);
    const loop = result.loops[0]!;
    expect(loop.members).toHaveLength(2);
    // |s| = |(b1 - b2)| regardless of canonical orientation.
    expect(loop.magnitude).toBeCloseTo(Math.sqrt(0.004 ** 2 + 0.002 ** 2 + 0.001 ** 2), 12);
  });

  it('traversal reversal negates s and preserves C and T', () => {
    resetBaselineIds();
    const baselines = buildBaselines([
      { from: 'A', to: 'B', dx: 100.001, dy: 0, dz: 0 },
      { from: 'B', to: 'C', dx: 0, dy: 100, dz: 0 },
      { from: 'C', to: 'A', dx: -100, dy: -100, dz: 0 },
    ]);
    const byId = new Map(baselines.map((baseline) => [baseline.id, baseline]));
    const result = computeGnssLoopClosures(baselines);
    const loop = result.loops[0]!;
    const reversed = reverseGnssLoopTraversal(loop, byId);
    expect(reversed.closure.x).toBeCloseTo(-loop.closure.x, 15);
    expect(reversed.closure.y).toBeCloseTo(-loop.closure.y, 15);
    expect(reversed.closure.z).toBeCloseTo(-loop.closure.z, 15);
    expect(reversed.covariance).toEqual(loop.covariance);
    expect(reversed.tLoop).toBeCloseTo(loop.tLoop ?? 0, 12);
  });

  it('cycle rank holds on a larger multigraph and loops are deterministic', () => {
    resetBaselineIds();
    const stations = buildStations([
      { id: 'A', x: 0, y: 0, z: 0, fixed: true },
      { id: 'B', x: 100, y: 0, z: 0 },
      { id: 'C', x: 100, y: 100, z: 0 },
      { id: 'D', x: 0, y: 100, z: 0 },
      { id: 'E', x: 200, y: 0, z: 0 },
    ]);
    void stations;
    const baselines = buildBaselines([
      { from: 'A', to: 'B', dx: 100, dy: 0, dz: 0 },
      { from: 'B', to: 'C', dx: 0, dy: 100, dz: 0 },
      { from: 'C', to: 'D', dx: -100, dy: 0, dz: 0 },
      { from: 'D', to: 'A', dx: 0, dy: -100, dz: 0 },
      { from: 'A', to: 'C', dx: 100, dy: 100, dz: 0 },
      { from: 'B', to: 'E', dx: 100, dy: 0, dz: 0 },
      { from: 'B', to: 'E', dx: 100.002, dy: 0.001, dz: 0 },
    ]);
    const first = computeGnssLoopClosures(baselines);
    const second = computeGnssLoopClosures(baselines);
    // E=7, V=5, C=1 -> rank 3.
    expect(first.cycleRank).toBe(3);
    expect(first.loops).toHaveLength(3);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.loops.map((loop) => loop.id)).toEqual(['LOOP-001', 'LOOP-002', 'LOOP-003']);
  });

  it('open chain reports zero cycles without failure', () => {
    resetBaselineIds();
    const baselines = buildBaselines([
      { from: 'A', to: 'B', dx: 100, dy: 0, dz: 0 },
      { from: 'B', to: 'C', dx: 0, dy: 100, dz: 0 },
    ]);
    const result = computeGnssLoopClosures(baselines);
    expect(result.cycleRank).toBe(0);
    expect(result.loops).toEqual([]);
  });
});
