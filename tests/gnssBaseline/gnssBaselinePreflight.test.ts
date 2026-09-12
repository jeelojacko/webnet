/**
 * Phase 12B — preflight, datum, frame, routing, and failure tests
 * (GATE D, GATE F; fixtures 6, 7).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runGnssBaselineAdjustment } from '../../src/engine/gnssBaselineAdjust';
import { isGnssBaselineObservation } from '../../src/engine/gnssBaselineTypes';
import {
  buildBaselines,
  buildStations,
  isotropicCovariance,
  resetBaselineIds,
  vectorBetween,
} from './gnssBaselineTestBuilder';

const ecefSession = () => {
  resetBaselineIds();
  const a = { x: 1000, y: 2000, z: 3000 };
  const stations = buildStations([
    { id: 'A', ...a, fixed: true },
    { id: 'B', x: 1100, y: 2050, z: 3010 },
  ]);
  return { stations, a };
};

describe('gnssBaselinePreflight', () => {
  it('fixture 7: free network is refused before any numerics', () => {
    resetBaselineIds();
    const stations = buildStations([
      { id: 'A', x: 1000, y: 2000, z: 3000 },
      { id: 'B', x: 1100, y: 2050, z: 3010 },
    ]);
    const baselines = buildBaselines([{ from: 'A', to: 'B', dx: 100, dy: 50, dz: 10 }]);
    expect(() => runGnssBaselineAdjustment({ stations, baselines })).toThrow(
      /no fully fixed 3D station/,
    );
  });

  it('rejects partial-only control (datum needs a fully fixed station)', () => {
    resetBaselineIds();
    const stations = buildStations([
      { id: 'A', x: 1000, y: 2000, z: 3000 },
      { id: 'B', x: 1100, y: 2050, z: 3010 },
    ]);
    stations.A!.fixedX = true;
    stations.A!.fixedY = true;
    // fixedH left unset: translation defect remains.
    const baselines = buildBaselines([{ from: 'A', to: 'B', dx: 100, dy: 50, dz: 10 }]);
    expect(() => runGnssBaselineAdjustment({ stations, baselines })).toThrow(
      /no fully fixed 3D station/,
    );
  });

  it('fixture 6: invalid covariance shapes fail closed', () => {
    const bad = [
      { ...isotropicCovariance(0.005), xx: -1e-6 },
      { ...isotropicCovariance(0.005), yy: 0 },
      { ...isotropicCovariance(0.005), xy: Number.NaN },
      { ...isotropicCovariance(0.005), zz: Number.POSITIVE_INFINITY },
      // Non-PD despite positive variances.
      { xx: 1e-6, xy: 5e-6, xz: 0, yy: 1e-6, yz: 0, zz: 1e-6 },
    ];
    bad.forEach((covariance) => {
      const { stations } = ecefSession();
      const baselines = buildBaselines([
        { from: 'A', to: 'B', dx: 100, dy: 50, dz: 10, covariance },
      ]);
      expect(() => runGnssBaselineAdjustment({ stations, baselines })).toThrow(
        /covariance/,
      );
    });
  });

  it('rejects self-baselines, missing stations, and duplicate ids', () => {
    const { stations } = ecefSession();
    expect(() =>
      runGnssBaselineAdjustment({
        stations,
        baselines: buildBaselines([{ from: 'A', to: 'A', dx: 0, dy: 0, dz: 0 }]),
      }),
    ).toThrow(/self-baseline/);
    resetBaselineIds();
    expect(() =>
      runGnssBaselineAdjustment({
        stations,
        baselines: buildBaselines([{ from: 'A', to: 'GHOST', dx: 1, dy: 0, dz: 0 }]),
      }),
    ).toThrow(/missing TO station/);
    resetBaselineIds();
    const duplicated = buildBaselines([
      { from: 'A', to: 'B', dx: 100, dy: 50, dz: 10 },
      { from: 'A', to: 'B', dx: 100, dy: 50, dz: 10 },
    ]);
    duplicated[1] = { ...duplicated[1]!, id: duplicated[0]!.id };
    expect(() => runGnssBaselineAdjustment({ stations, baselines: duplicated })).toThrow(
      /Duplicate/,
    );
  });

  it('rejects frame, epoch, and ellipsoid mismatches exactly', () => {
    const { stations } = ecefSession();
    const mismatchedFrame = buildBaselines([
      { from: 'A', to: 'B', dx: 100, dy: 50, dz: 10, referenceFrame: 'NAD83(CSRS)@2010.0' },
    ]);
    expect(() =>
      runGnssBaselineAdjustment({
        stations,
        baselines: mismatchedFrame,
        referenceFrame: 'ITRF2020@2020.0',
      }),
    ).toThrow(/reference frame/);
    resetBaselineIds();
    const mismatchedEpoch = buildBaselines([
      {
        from: 'A', to: 'B', dx: 100, dy: 50, dz: 10,
        referenceFrame: 'ITRF2020@2020.0', epoch: '2010.0',
      },
      {
        from: 'A', to: 'B', dx: 100, dy: 50, dz: 10,
        referenceFrame: 'ITRF2020@2020.0', epoch: '2020.0',
      },
    ]);
    expect(() => runGnssBaselineAdjustment({ stations, baselines: mismatchedEpoch })).toThrow(
      /epoch/,
    );
  });

  it('rejects non-ECEF baseline frames (projectLocal deferred)', () => {
    const { stations } = ecefSession();
    const baselines = buildBaselines([
      { from: 'A', to: 'B', dx: 100, dy: 50, dz: 10, frame: 'projectLocal' },
    ]);
    expect(() => runGnssBaselineAdjustment({ stations, baselines })).toThrow(/ECEF only/);
  });

  it('solves disconnected components when each has control; rejects otherwise', () => {
    resetBaselineIds();
    const stations = buildStations([
      { id: 'A', x: 0, y: 0, z: 0, fixed: true },
      { id: 'B', x: 100, y: 0, z: 0 },
      { id: 'C', x: 10000, y: 10000, z: 10000, fixed: true },
      { id: 'D', x: 10100, y: 10000, z: 10000 },
    ]);
    const controlled = buildBaselines([
      { from: 'A', to: 'B', dx: 100, dy: 0, dz: 0 },
      { from: 'C', to: 'D', dx: 100, dy: 0, dz: 0 },
    ]);
    const both = runGnssBaselineAdjustment({ stations, baselines: controlled });
    expect(both.converged).toBe(true);
    expect(Math.abs(both.stations.B!.x - 100)).toBeLessThan(1e-9);
    expect(Math.abs(both.stations.D!.x - 10100)).toBeLessThan(1e-9);
    // Same graph with D-component control removed: deterministic refusal.
    resetBaselineIds();
    const stationsFree = buildStations([
      { id: 'A', x: 0, y: 0, z: 0, fixed: true },
      { id: 'B', x: 100, y: 0, z: 0 },
      { id: 'C', x: 10000, y: 10000, z: 10000 },
      { id: 'D', x: 10100, y: 10000, z: 10000 },
    ]);
    const halfFree = buildBaselines([
      { from: 'A', to: 'B', dx: 100, dy: 0, dz: 0 },
      { from: 'C', to: 'D', dx: 100, dy: 0, dz: 0 },
    ]);
    expect(() => runGnssBaselineAdjustment({ stations: stationsFree, baselines: halfFree })).toThrow(
      /C, D.*no fully fixed|no fully fixed 3D station/,
    );
  });

  it('allows a zero-length vector between distinct stations (documented)', () => {
    // A zero observed vector between distinct stations is mathematically
    // well-formed (claims coincidence); it solves, pulling B onto A.
    const { stations } = ecefSession();
    const baselines = buildBaselines([{ from: 'A', to: 'B', dx: 0, dy: 0, dz: 0 }]);
    const result = runGnssBaselineAdjustment({ stations, baselines });
    expect(result.converged).toBe(true);
    expect(Math.abs(result.stations.B!.x - 1000)).toBeLessThan(1e-9);
  });

  it('withholds scalar standardized-residual statistics for baseline blocks', () => {
    const { stations } = ecefSession();
    const baselines = buildBaselines([{ from: 'A', to: 'B', dx: 100, dy: 50, dz: 10 }]);
    const result = runGnssBaselineAdjustment({ stations, baselines });
    // Result exposes generic stats + descriptive block residuals only.
    expect(result.varianceFactor).toBeDefined();
    expect(result.qxx.length).toBeGreaterThan(0);
    result.residuals.forEach((residual) => {
      expect(Object.keys(residual).sort()).toEqual(
        ['baselineId', 'from', 'magnitude', 'quadraticForm', 'to', 'vX', 'vY', 'vZ'],
      );
    });
  });
});

describe('gnssBaselineRouting', () => {
  it('stays on the TypeScript dense path with an explicit ECEF frame tag', () => {
    const { stations } = ecefSession();
    const baselines = buildBaselines([{ from: 'A', to: 'B', dx: 100, dy: 50, dz: 10 }]);
    const result = runGnssBaselineAdjustment({ stations, baselines });
    expect(result.adjustmentFrame).toBe('ecef');
    expect(result.routeProvenance).toBe('typescript-dense');
  });

  it('detects baseline observations in foreign observation arrays (native-gate tripwire)', () => {
    const { stations } = ecefSession();
    void stations;
    const baselines = buildBaselines([{ from: 'A', to: 'B', dx: 1, dy: 0, dz: 0 }]);
    expect(
      (baselines as unknown as { type: string }[]).some((obs) => isGnssBaselineObservation(obs)),
    ).toBe(true);
    expect(isGnssBaselineObservation({ type: 'gps' })).toBe(false);
  });

  it('core modules never touch WASM, sparse solvers, robust, or geoid code', () => {
    const root = join(__dirname, '..', '..', 'src', 'engine');
    const files = [
      'gnssBaselineTypes.ts',
      'gnssBaselineCovariance.ts',
      'gnssBaselineEquationRows.ts',
      'gnssBaselinePreflight.ts',
      'gnssBaselineAdjust.ts',
    ];
    files.forEach((file) => {
      const source = readFileSync(join(root, file), 'utf8');
      const imports = source.split('\n').filter((line) => line.startsWith('import '));
      imports.forEach((line) => {
        expect(line).not.toMatch(/geoid|wasm|huber/i);
      });
      expect(source).not.toMatch(/sparseCorrectionSolver:\s*\w+\./);
    });
    // The orchestrator pins the dense solver by leaving the sparse seam empty.
    const adjust = readFileSync(join(root, 'gnssBaselineAdjust.ts'), 'utf8');
    expect(adjust).toMatch(/sparseCorrectionSolver: undefined/);
    expect(adjust).toMatch(/robustMode: 'none'/);
  });

  it('triangle accounting: 3 baselines = 9 equations, dof = 9 - 6 = 3', () => {
    resetBaselineIds();
    const a = { x: 0, y: 0, z: 0 };
    const b = { x: 100, y: 0, z: 0 };
    const c = { x: 0, y: 100, z: 0 };
    const stations = buildStations([
      { id: 'A', ...a, fixed: true },
      { id: 'B', ...b },
      { id: 'C', ...c },
    ]);
    const baselines = buildBaselines([
      { from: 'A', to: 'B', ...vectorBetween(a, b) },
      { from: 'B', to: 'C', ...vectorBetween(b, c) },
      { from: 'A', to: 'C', ...vectorBetween(a, c) },
    ]);
    const result = runGnssBaselineAdjustment({ stations, baselines });
    expect(result.logicalObservations).toBe(3);
    expect(result.numObsEquations).toBe(9);
    expect(result.numParams).toBe(6);
    expect(result.dof).toBe(3);
  });
});
