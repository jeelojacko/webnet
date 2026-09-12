/**
 * Phase 12B — raw equation-assembly tests (GATE A).
 *
 * Inspects assembled rows directly: exact [-I +I] Jacobian entries,
 * observed-minus-computed misclosures, fixed-endpoint constant handling,
 * and the full 3x3 structured weight block including off-diagonals.
 */
import { describe, expect, it } from 'vitest';
import type { Observation } from '../../src/types';
import { assembleAdjustmentEquations } from '../../src/engine/adjustmentEquationAssembly';
import type { AdjustmentEquationAssemblyDependencies } from '../../src/engine/adjustmentEquationAssemblyTypes';
import { buildSolveParameterIndex } from '../../src/engine/adjustmentPreprocessing';
import {
  buildBaselines,
  buildStations,
  isotropicCovariance,
  resetBaselineIds,
} from './gnssBaselineTestBuilder';

const assemblyDeps = (
  stations: ReturnType<typeof buildStations>,
  unknowns: string[],
): AdjustmentEquationAssemblyDependencies => {
  const { paramIndex } = buildSolveParameterIndex(stations, unknowns, false);
  const unreachable = (name: string): never => {
    throw new Error(`unexpected helper '${name}'`);
  };
  return {
    stations,
    paramIndex,
    is2D: false,
    debug: false,
    directionOrientations: {},
    dirParamMap: {},
    effectiveStdDev: () => unreachable('effectiveStdDev'),
    correctedDistanceModel: () => unreachable('correctedDistanceModel'),
    getObservedHorizontalDistanceIn2D: () => unreachable('getObservedHorizontalDistanceIn2D'),
    getAzimuth: () => unreachable('getAzimuth'),
    measuredAngleCorrection: () => unreachable('measuredAngleCorrection'),
    modeledAzimuth: () => unreachable('modeledAzimuth'),
    wrapToPi: () => unreachable('wrapToPi'),
    gpsObservedVector: () => unreachable('gpsObservedVector'),
    gpsModeledVector: () => unreachable('gpsModeledVector'),
    gpsModeledVectorDerivatives: () => unreachable('gpsModeledVectorDerivatives'),
    gpsWeight: () => unreachable('gpsWeight'),
    getModeledZenith: () => unreachable('getModeledZenith'),
    curvatureRefractionAngle: () => unreachable('curvatureRefractionAngle'),
    applyTsCorrelationToWeightMatrix: () => {},
    logObsDebug: undefined,
  };
};

describe('gnssBaselineEquationAssembly', () => {
  it('assembles exact [-I +I] rows with observed-minus-computed misclosure', () => {
    resetBaselineIds();
    // A unknown at origin, B unknown at (100, 0, 0); observed (100.01, 0.02, -0.01).
    const stations = buildStations([
      { id: 'A', x: 0, y: 0, z: 0 },
      { id: 'B', x: 100, y: 0, z: 0 },
    ]);
    const baselines = buildBaselines([
      { from: 'A', to: 'B', dx: 100.01, dy: 0.02, dz: -0.01 },
    ]);
    const deps = assemblyDeps(stations, ['A', 'B']);
    const result = assembleAdjustmentEquations(
      deps,
      baselines as unknown as Observation[],
      [],
      3,
      6,
      1,
    );
    expect(result.A).toEqual([
      [-1, 0, 0, 1, 0, 0],
      [0, -1, 0, 0, 1, 0],
      [0, 0, -1, 0, 0, 1],
    ]);
    const misclosure = result.L.map((row) => row[0]);
    expect(misclosure[0]).toBeCloseTo(0.01, 12);
    expect(misclosure[1]).toBeCloseTo(0.02, 12);
    expect(misclosure[2]).toBeCloseTo(-0.01, 12);
    expect(result.rowInfo.map((info) => info?.component)).toEqual(['X', 'Y', 'Z']);
  });

  it('moves fixed-endpoint coordinates into the misclosure constant', () => {
    resetBaselineIds();
    // A fixed at (10, 20, 30); B unknown at (110, 20, 30).
    // Observed (100.005, 0, 0): misclosure carries the fixed anchor.
    const stations = buildStations([
      { id: 'A', x: 10, y: 20, z: 30, fixed: true },
      { id: 'B', x: 110, y: 20, z: 30 },
    ]);
    const baselines = buildBaselines([
      { from: 'A', to: 'B', dx: 100.005, dy: 0, dz: 0 },
    ]);
    const deps = assemblyDeps(stations, ['B']);
    const result = assembleAdjustmentEquations(
      deps,
      baselines as unknown as Observation[],
      [],
      3,
      3,
      1,
    );
    // Only B columns exist; A coefficients are absent (no columns), and the
    // fixed anchor (100) sits inside L via b_calc = B - A.
    expect(result.A).toEqual([
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]);
    const fixedMisclosure = result.L.map((row) => row[0]);
    expect(fixedMisclosure[0]).toBeCloseTo(0.005, 12);
    expect(fixedMisclosure[1]).toBeCloseTo(0, 12);
    expect(fixedMisclosure[2]).toBeCloseTo(0, 12);
  });

  it('writes the full correlated 3x3 weight block (off-diagonals survive)', () => {
    resetBaselineIds();
    const covariance = {
      xx: 4e-6, xy: 1e-6, xz: -5e-7, yy: 9e-6, yz: 2e-6, zz: 16e-6,
    };
    const stations = buildStations([
      { id: 'A', x: 0, y: 0, z: 0 },
      { id: 'B', x: 50, y: 10, z: -5 },
    ]);
    const baselines = buildBaselines([
      { from: 'A', to: 'B', dx: 50, dy: 10, dz: -5, covariance },
    ]);
    const deps = assemblyDeps(stations, ['A', 'B']);
    const result = assembleAdjustmentEquations(
      deps,
      baselines as unknown as Observation[],
      [],
      3,
      6,
      1,
      { weightRepresentation: 'sparse' },
    );
    expect(result.structuredWeights).toBeDefined();
    const weights = result.structuredWeights!;
    expect(weights.size).toBe(3);
    // Independent inverse of the same covariance (direct formula).
    const det =
      covariance.xx * (covariance.yy * covariance.zz - covariance.yz * covariance.yz) -
      covariance.xy * (covariance.xy * covariance.zz - covariance.yz * covariance.xz) +
      covariance.xz * (covariance.xy * covariance.yz - covariance.yy * covariance.xz);
    const expected = {
      pxx: (covariance.yy * covariance.zz - covariance.yz * covariance.yz) / det,
      pyy: (covariance.xx * covariance.zz - covariance.xz * covariance.xz) / det,
      pzz: (covariance.xx * covariance.yy - covariance.xy * covariance.xy) / det,
      pxy: (covariance.xz * covariance.yz - covariance.xy * covariance.zz) / det,
      pxz: (covariance.xy * covariance.yz - covariance.xz * covariance.yy) / det,
      pyz: (covariance.xy * covariance.xz - covariance.xx * covariance.yz) / det,
    };
    expect(weights.diagonal[0]).toBeCloseTo(expected.pxx, 6);
    expect(weights.diagonal[1]).toBeCloseTo(expected.pyy, 6);
    expect(weights.diagonal[2]).toBeCloseTo(expected.pzz, 6);
    const off = new Map<string, number>();
    for (let i = 0; i < weights.offRows.length; i += 1) {
      off.set(`${weights.offRows[i]},${weights.offColumns[i]}`, weights.offValues[i]!);
    }
    expect(off.get('0,1')).toBeCloseTo(expected.pxy, 6);
    expect(off.get('0,2')).toBeCloseTo(expected.pxz, 6);
    expect(off.get('1,2')).toBeCloseTo(expected.pyz, 6);
  });

  it('keeps an isotropic block diagonal and independent between baselines', () => {
    resetBaselineIds();
    const stations = buildStations([
      { id: 'A', x: 0, y: 0, z: 0, fixed: true },
      { id: 'B', x: 100, y: 0, z: 0 },
      { id: 'C', x: 0, y: 100, z: 0 },
    ]);
    const baselines = buildBaselines([
      { from: 'A', to: 'B', dx: 100, dy: 0, dz: 0, covariance: isotropicCovariance(0.01) },
      { from: 'A', to: 'C', dx: 0, dy: 100, dz: 0, covariance: isotropicCovariance(0.02) },
    ]);
    const deps = assemblyDeps(stations, ['B', 'C']);
    const result = assembleAdjustmentEquations(
      deps,
      baselines as unknown as Observation[],
      [],
      6,
      6,
      1,
    );
    const P = result.P!;
    // Block-diagonal: no coupling between baseline 1 rows (0-2) and
    // baseline 2 rows (3-5); isotropic diagonal weights 1/sigma^2.
    for (let row = 0; row < 6; row += 1) {
      for (let column = 0; column < 6; column += 1) {
        const sameBlock = Math.floor(row / 3) === Math.floor(column / 3);
        if (row === column) {
          expect(P[row]![column]).toBeCloseTo(row < 3 ? 10000 : 2500, 9);
        } else {
          expect(P[row]![column]).toBe(0);
        }
        if (!sameBlock) expect(P[row]![column]).toBe(0);
      }
    }
  });
});
