/**
 * Phase 12E.3 — production GNSS endpoint setup-uncertainty tests.
 *
 * Synthetic fixtures only. Independent goldens: closed-form hand-computed
 * matrices at equator/lon0 and lat45/lon0, plus a from-scratch in-test
 * implementation (own Bowring seed/iterations, outer-product covariance
 * construction) for general lat/lon cross-checks.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runGnssBaselineAdjustment } from '../../src/engine/gnssBaselineAdjust';
import {
  buildGnssReportFromInput,
  renderGnssBaselineTextReport,
} from '../../src/engine/gnssBaselineReport';
import {
  applyGnssSetupUncertainty,
  checkGnssSetupReadiness,
  ecefToGeodeticLatLon,
  isGnssSetupActive,
  normalizeGnssSetupUncertainty,
  setupEndpointCovariance,
  type GnssSetupUncertainty,
} from '../../src/engine/gnssBaselineSetupUncertainty';
import {
  isGnssBaselineObservation,
  type GnssBaselineCovariance,
  type GnssBaselineObservation,
} from '../../src/engine/gnssBaselineTypes';
import { validateGnssBaselineNetwork } from '../../src/engine/gnssBaselineNetworkImport';
import { geodeticToEcef } from '../../src/engine/geodesyEcef';
import { WGS84_A, WGS84_E2 } from '../../src/engine/geodesyConstants';
import {
  buildBaselines,
  buildStations,
  isotropicCovariance,
  resetBaselineIds,
} from './gnssBaselineTestBuilder';

const ELLIPSOID = 'GRS80';
const CENTERING = 0.005;
const HEIGHT = 0.002;
const SC2 = CENTERING * CENTERING;
const SH2 = HEIGHT * HEIGHT;

const close = (actual: number, expected: number, tol: number): void => {
  expect(Math.abs(actual - expected)).toBeLessThan(tol);
};

const closeCov = (actual: GnssBaselineCovariance, expected: GnssBaselineCovariance, tol: number): void => {
  (Object.keys(expected) as (keyof GnssBaselineCovariance)[]).forEach((key) => {
    close(actual[key], expected[key], tol);
  });
};

/** Independent Bowring (different seed + iteration count than production). */
const independentGeodetic = (x: number, y: number, z: number): { lat: number; lon: number } => {
  const p = Math.hypot(x, y);
  const lon = Math.atan2(y, x);
  let lat = Math.atan2(z, p);
  for (let i = 0; i < 10; i += 1) {
    const sin = Math.sin(lat);
    const prime = WGS84_A / Math.sqrt(1 - WGS84_E2 * sin * sin);
    lat = Math.atan2(z + WGS84_E2 * prime * sin, p);
  }
  return { lat, lon };
};

/**
 * Independent endpoint covariance via outer products:
 * C = sc^2 (e e^T + n n^T) + sh^2 (u u^T), with ENU axis rows built
 * directly from sin/cos — structurally distinct from R^T D R.
 */
const independentEndpointCov = (
  x: number,
  y: number,
  z: number,
  sc: number,
  sh: number,
): GnssBaselineCovariance => {
  const { lat, lon } = independentGeodetic(x, y, z);
  const sLat = Math.sin(lat);
  const cLat = Math.cos(lat);
  const sLon = Math.sin(lon);
  const cLon = Math.cos(lon);
  const rows = [
    [-sLon, cLon, 0],
    [-sLat * cLon, -sLat * sLon, cLat],
    [cLat * cLon, cLat * sLon, sLat],
  ];
  const a = sc * sc;
  const b = sh * sh;
  const out = { xx: 0, xy: 0, xz: 0, yy: 0, yz: 0, zz: 0 };
  const pairs: [keyof GnssBaselineCovariance, number, number][] = [
    ['xx', 0, 0], ['yy', 1, 1], ['zz', 2, 2],
    ['xy', 0, 1], ['xz', 0, 2], ['yz', 1, 2],
  ];
  pairs.forEach(([key, i, j]) => {
    out[key] =
      a * ((rows[0]?.[i] ?? 0) * (rows[0]?.[j] ?? 0) + (rows[1]?.[i] ?? 0) * (rows[1]?.[j] ?? 0)) +
      b * (rows[2]?.[i] ?? 0) * (rows[2]?.[j] ?? 0);
  });
  return out;
};

const trace = (cov: GnssBaselineCovariance): number => cov.xx + cov.yy + cov.zz;

/** Equatorial station: exactly (a, 0, 0) -> lat 0, lon 0. */
const EQUATOR = { x: WGS84_A, y: 0, z: 0 };

describe('gnss endpoint setup uncertainty: zero backward compatibility', () => {
  it('absent setup returns the input observations untouched (bit-identical solve)', () => {
    resetBaselineIds();
    const stations = buildStations([
      { id: 'A', ...EQUATOR, fixed: true },
      { id: 'B', x: EQUATOR.x + 100, y: 50, z: 10 },
      { id: 'C', x: EQUATOR.x + 50, y: 150, z: -5 },
    ]);
    const baselines = buildBaselines(
      [
        { from: 'A', to: 'B', dx: 100, dy: 50, dz: 10 },
        { from: 'B', to: 'C', dx: -50, dy: 100, dz: -15 },
        { from: 'A', to: 'C', dx: 50.001, dy: 150.002, dz: -4.999 },
      ],
      { ellipsoid: ELLIPSOID },
    );
    const before = runGnssBaselineAdjustment({ stations, baselines });
    const after = runGnssBaselineAdjustment({ stations, baselines, setupUncertainty: undefined });
    const explicit = runGnssBaselineAdjustment({
      stations,
      baselines,
      setupUncertainty: { horizontalCenteringSigma: 0, antennaHeightSigma: 0 },
    });
    for (const result of [after, explicit]) {
      expect(result.setupModel).toBeUndefined();
      expect(result.setupContributions).toBeUndefined();
      Object.keys(before.stations).forEach((id) => {
        expect(result.stations[id]?.x).toBe(before.stations[id]?.x);
        expect(result.stations[id]?.y).toBe(before.stations[id]?.y);
        expect(result.stations[id]?.h).toBe(before.stations[id]?.h);
      });
      expect(result.varianceFactor).toBe(before.varianceFactor);
      expect(result.weightedResidualSum).toBe(before.weightedResidualSum);
      expect(result.dof).toBe(before.dof);
    }
    // Effective covariance bitwise-equals raw when inactive.
    const applied = applyGnssSetupUncertainty({
      stations,
      baselines,
      setup: { horizontalCenteringSigma: 0, antennaHeightSigma: 0 },
      ellipsoid: ELLIPSOID,
    });
    expect(applied.baselines).toBe(baselines);
    expect(applied.setupModel).toBeNull();
  });
});

describe('gnss endpoint setup uncertainty: analytic endpoint rotations', () => {
  it('equator/lon0 closed forms: centering-only, height-only, combined', () => {
    const setup = normalizeGnssSetupUncertainty(undefined);
    expect(setup.horizontalCenteringSigma).toBe(0);
    expect(isGnssSetupActive(setup)).toBe(false);
    // At lat=0/lon=0: E=Y, N=Z, U=X, so centering lands on yy/zz and
    // height lands on xx. Hand-computed, no trig in the expectation.
    closeCov(
      setupEndpointCovariance(EQUATOR.x, EQUATOR.y, EQUATOR.z, { horizontalCenteringSigma: CENTERING, antennaHeightSigma: 0 }, 'eq-c'),
      { xx: 0, xy: 0, xz: 0, yy: SC2, yz: 0, zz: SC2 },
      1e-30,
    );
    closeCov(
      setupEndpointCovariance(EQUATOR.x, EQUATOR.y, EQUATOR.z, { horizontalCenteringSigma: 0, antennaHeightSigma: HEIGHT }, 'eq-h'),
      { xx: SH2, xy: 0, xz: 0, yy: 0, yz: 0, zz: 0 },
      1e-30,
    );
    closeCov(
      setupEndpointCovariance(EQUATOR.x, EQUATOR.y, EQUATOR.z, { horizontalCenteringSigma: CENTERING, antennaHeightSigma: HEIGHT }, 'eq-ch'),
      { xx: SH2, xy: 0, xz: 0, yy: SC2, yz: 0, zz: SC2 },
      1e-30,
    );
  });

  it('lat45/lon0 height-only hand golden: Up=(c,0,s) so C=sh^2 u u^T', () => {
    const p = geodeticToEcef(45, 0, 0);
    const half = SH2 / 2;
    closeCov(
      setupEndpointCovariance(p.x, p.y, p.z, { horizontalCenteringSigma: 0, antennaHeightSigma: HEIGHT }, 'mid-h'),
      { xx: half, xy: 0, xz: half, yy: 0, yz: 0, zz: half },
      1e-15,
    );
  });

  it('independent cross-check at mid-lat, high-lat, and nonzero lon', () => {
    const cases: [number, number][] = [
      [45, 10],
      [80, -100],
      [-33.9, 151.2],
      [0, 90],
      [19.6, -155.5],
    ];
    const combos: GnssSetupUncertainty[] = [
      { horizontalCenteringSigma: CENTERING, antennaHeightSigma: 0 },
      { horizontalCenteringSigma: 0, antennaHeightSigma: HEIGHT },
      { horizontalCenteringSigma: CENTERING, antennaHeightSigma: HEIGHT },
    ];
    cases.forEach(([lat, lon]) => {
      const p = geodeticToEcef(lat, lon, 100);
      combos.forEach((combo) => {
        const normalized = normalizeGnssSetupUncertainty(combo);
        const actual = setupEndpointCovariance(p.x, p.y, p.z, normalized, `case ${lat}/${lon}`);
        const expected = independentEndpointCov(
          p.x, p.y, p.z,
          normalized.horizontalCenteringSigma,
          normalized.antennaHeightSigma,
        );
        closeCov(actual, expected, 1e-18);
      });
    });
  });

  it('geodetic orientation agrees with the independent implementation', () => {
    const p = geodeticToEcef(48.85, 2.35, 150);
    const actual = ecefToGeodeticLatLon(p.x, p.y, p.z, 'paris');
    const expected = independentGeodetic(p.x, p.y, p.z);
    close(actual.lat, expected.lat, 1e-12);
    close(actual.lon, expected.lon, 1e-12);
  });
});

describe('gnss endpoint setup uncertainty: endpoint sum and symmetry', () => {
  it('C_eff = C_raw + C_from + C_to; reversal is invariant; fixed endpoints augmented', () => {
    resetBaselineIds();
    const mid = geodeticToEcef(45, 10, 100);
    const stations = buildStations([
      { id: 'A', ...EQUATOR, fixed: true },
      { id: 'B', ...mid },
    ]);
    const raw = { xx: 9e-6, xy: 4e-6, xz: 1e-6, yy: 9e-6, yz: -2e-6, zz: 9e-6 };
    const setup: GnssSetupUncertainty = { horizontalCenteringSigma: CENTERING, antennaHeightSigma: HEIGHT };
    const fwd = buildBaselines(
      [{ from: 'A', to: 'B', dx: 1, dy: 2, dz: 3, covariance: { ...raw } }],
      { ellipsoid: ELLIPSOID },
    );
    const applied = applyGnssSetupUncertainty({ stations, baselines: fwd, setup, ellipsoid: ELLIPSOID });
    expect(applied.setupModel).not.toBeNull();
    const contribution = applied.contributions[0]!;
    const expectedFrom = independentEndpointCov(EQUATOR.x, EQUATOR.y, EQUATOR.z, CENTERING, HEIGHT);
    const expectedTo = independentEndpointCov(mid.x, mid.y, mid.z, CENTERING, HEIGHT);
    closeCov(contribution.setupCovariance, {
      xx: expectedFrom.xx + expectedTo.xx,
      xy: expectedFrom.xy + expectedTo.xy,
      xz: expectedFrom.xz + expectedTo.xz,
      yy: expectedFrom.yy + expectedTo.yy,
      yz: expectedFrom.yz + expectedTo.yz,
      zz: expectedFrom.zz + expectedTo.zz,
    }, 1e-18);
    const augmented = applied.baselines[0]!;
    closeCov(augmented.covariance, {
      xx: raw.xx + contribution.setupCovariance.xx,
      xy: raw.xy + contribution.setupCovariance.xy,
      xz: raw.xz + contribution.setupCovariance.xz,
      yy: raw.yy + contribution.setupCovariance.yy,
      yz: raw.yz + contribution.setupCovariance.yz,
      zz: raw.zz + contribution.setupCovariance.zz,
    }, 1e-18);
    // Raw provenance preserved on the observation (exact field equality).
    (Object.keys(raw) as (keyof GnssBaselineCovariance)[]).forEach((key) => {
      expect(augmented.rawCovariance![key]).toBe(raw[key]);
    });
    // The FIXED from-endpoint still contributes (nonzero setup block).
    expect(trace(expectedFrom)).toBeGreaterThan(0);

    // Reversal: B->A with negated vector yields the same C_eff.
    resetBaselineIds();
    const rev = buildBaselines(
      [{ from: 'B', to: 'A', dx: -1, dy: -2, dz: -3, covariance: { ...raw } }],
      { ellipsoid: ELLIPSOID },
    );
    const revApplied = applyGnssSetupUncertainty({ stations, baselines: rev, setup, ellipsoid: ELLIPSOID });
    closeCov(revApplied.baselines[0]!.covariance, augmented.covariance, 1e-18);
  });

  it('trace invariance: 2sc^2+sh^2 per endpoint, summed over both', () => {
    resetBaselineIds();
    const mid = geodeticToEcef(-33.9, 151.2, 50);
    const stations = buildStations([
      { id: 'A', ...EQUATOR, fixed: true },
      { id: 'B', ...mid },
    ]);
    const baselines = buildBaselines(
      [{ from: 'A', to: 'B', dx: 1, dy: 2, dz: 3 }],
      { ellipsoid: ELLIPSOID },
    );
    const applied = applyGnssSetupUncertainty({
      stations,
      baselines,
      setup: { horizontalCenteringSigma: CENTERING, antennaHeightSigma: HEIGHT },
      ellipsoid: ELLIPSOID,
    });
    const contribution = applied.contributions[0]!;
    close(trace(contribution.setupCovariance), 2 * (2 * SC2 + SH2), 1e-18);
    close(
      trace(applied.baselines[0]!.covariance),
      trace(baselines[0]!.covariance) + 2 * (2 * SC2 + SH2),
      1e-18,
    );
  });
});

describe('gnss endpoint setup uncertainty: validation and fail-closed gates', () => {
  it('rejects NaN/Infinity/negative sigmas pre-solve', () => {
    const bad: unknown[] = [
      { horizontalCenteringSigma: Number.NaN, antennaHeightSigma: 0 },
      { horizontalCenteringSigma: 0, antennaHeightSigma: Number.POSITIVE_INFINITY },
      { horizontalCenteringSigma: -0.001, antennaHeightSigma: 0 },
      { horizontalCenteringSigma: 0, antennaHeightSigma: -1 },
      { horizontalCenteringSigma: Number.NaN, antennaHeightSigma: Number.NaN },
    ];
    bad.forEach((setup) => {
      expect(() => normalizeGnssSetupUncertainty(setup as GnssSetupUncertainty)).toThrow(/finite number >= 0/);
    });
    resetBaselineIds();
    const stations = buildStations([
      { id: 'A', ...EQUATOR, fixed: true },
      { id: 'B', x: EQUATOR.x + 100, y: 0, z: 0 },
    ]);
    const baselines = buildBaselines([{ from: 'A', to: 'B', dx: 100, dy: 0, dz: 0 }], { ellipsoid: ELLIPSOID });
    bad.forEach((setup) => {
      expect(() => runGnssBaselineAdjustment({
        stations,
        baselines,
        setupUncertainty: setup as GnssSetupUncertainty,
      })).toThrow(/finite number >= 0/);
    });
  });

  it('nonzero setup with missing or unknown ellipsoid fails closed; zero setup adds no requirement', () => {
    resetBaselineIds();
    const stations = buildStations([
      { id: 'A', ...EQUATOR, fixed: true },
      { id: 'B', x: EQUATOR.x + 100, y: 0, z: 0 },
    ]);
    const noEllipsoid = buildBaselines(
      [{ from: 'A', to: 'B', dx: 100, dy: 0, dz: 0, ellipsoid: undefined }],
    );
    noEllipsoid[0] = { ...noEllipsoid[0]!, ellipsoid: undefined };
    const setup: GnssSetupUncertainty = { horizontalCenteringSigma: CENTERING, antennaHeightSigma: 0 };
    // Zero setup solves fine with no ellipsoid anywhere.
    expect(() => runGnssBaselineAdjustment({ stations, baselines: noEllipsoid })).not.toThrow();
    // Nonzero setup without any ellipsoid fails closed.
    expect(() => runGnssBaselineAdjustment({ stations, baselines: noEllipsoid, setupUncertainty: setup }))
      .toThrow(/requires a declared ellipsoid/);
    // Unknown ellipsoid tag fails closed.
    const exotic = buildBaselines(
      [{ from: 'A', to: 'B', dx: 100, dy: 0, dz: 0 }],
      { ellipsoid: 'MARS2000' },
    );
    expect(() => runGnssBaselineAdjustment({ stations, baselines: exotic, setupUncertainty: setup }))
      .toThrow(/unrecognized ellipsoid/);
    // Session-level WGS84 satisfies the gate.
    const sessionOk = runGnssBaselineAdjustment({
      stations,
      baselines: noEllipsoid,
      ellipsoid: 'WGS84',
      setupUncertainty: setup,
    });
    expect(sessionOk.setupModel?.ellipsoid).toBe('WGS84');
  });

  it('import-stage data-check reports setup problems without solving', () => {
    resetBaselineIds();
    const stations = buildStations([
      { id: 'A', ...EQUATOR, fixed: true },
      { id: 'B', x: EQUATOR.x + 100, y: 0, z: 0 },
    ]);
    const baselines = buildBaselines(
      [{ from: 'A', to: 'B', dx: 100, dy: 0, dz: 0 }],
      { ellipsoid: ELLIPSOID },
    );
    const network = {
      stations,
      baselines,
      frame: { vectorFrame: 'ecef' as const, referenceFrame: 'ITRF2020@2020.0', ellipsoid: ELLIPSOID },
      inputUnits: 'm' as const,
      provenance: [],
    };
    expect(validateGnssBaselineNetwork(network)).toEqual([]);
    expect(validateGnssBaselineNetwork(network, undefined)).toEqual([]);
    expect(validateGnssBaselineNetwork(network, { horizontalCenteringSigma: 0, antennaHeightSigma: 0 })).toEqual([]);
    const badSigma = validateGnssBaselineNetwork(network, { horizontalCenteringSigma: Number.NaN });
    expect(badSigma.some((d) => d.code === 'GNSS_BAD_SETUP_SIGMA')).toBe(true);
    const noEllipsoidNetwork = {
      ...network,
      frame: { vectorFrame: 'ecef' as const, referenceFrame: 'ITRF2020@2020.0' },
      baselines: baselines.map((b) => ({ ...b, ellipsoid: undefined })),
    };
    const missing = validateGnssBaselineNetwork(noEllipsoidNetwork, { horizontalCenteringSigma: CENTERING });
    expect(missing.some((d) => d.code === 'GNSS_SETUP_MISSING_ELLIPSOID')).toBe(true);
    // Non-throwing readiness probe mirrors the same gates.
    expect(checkGnssSetupReadiness({ stations, baselines, setup: undefined, ellipsoid: ELLIPSOID })).toEqual([]);
    expect(
      checkGnssSetupReadiness({ stations, baselines, setup: { horizontalCenteringSigma: -1 }, ellipsoid: ELLIPSOID })[0]?.code,
    ).toBe('GNSS_BAD_SETUP_SIGMA');
  });
});

describe('gnss endpoint setup uncertainty: local-Up behavior', () => {
  it('diverges from naive ECEF-Z augmentation on a non-equatorial fixture', () => {
    resetBaselineIds();
    const mid = geodeticToEcef(45, 10, 100);
    const stations = buildStations([
      { id: 'A', ...EQUATOR, fixed: true },
      { id: 'B', ...mid },
    ]);
    const raw = isotropicCovariance(0.005);
    const baselines = buildBaselines(
      [{ from: 'A', to: 'B', dx: 1, dy: 2, dz: 3, covariance: { ...raw } }],
      { ellipsoid: ELLIPSOID },
    );
    const applied = applyGnssSetupUncertainty({
      stations,
      baselines,
      setup: { horizontalCenteringSigma: 0, antennaHeightSigma: HEIGHT },
      ellipsoid: ELLIPSOID,
    });
    const naive = {
      xx: raw.xx, xy: raw.xy, xz: raw.xz,
      yy: raw.yy, yz: raw.yz, zz: raw.zz + 2 * SH2,
    };
    const effective = applied.baselines[0]!.covariance;
    // At lat45 the Up axis leans far off ECEF-Z: xx must carry setup
    // variance the naive model leaves at zero.
    expect(Math.abs(effective.xx - naive.xx)).toBeGreaterThan(1e-6);
    expect(Math.abs(effective.zz - naive.zz)).toBeGreaterThan(1e-6);
    expect(Math.abs(effective.xz - naive.xz)).toBeGreaterThan(1e-6);
  });

  it('metre-scale a-priori perturbations barely move C_eff', () => {
    resetBaselineIds();
    const mid = geodeticToEcef(45, 10, 100);
    const stations = buildStations([
      { id: 'A', ...EQUATOR, fixed: true },
      { id: 'B', ...mid },
    ]);
    const spec = [{ from: 'A', to: 'B', dx: 1, dy: 2, dz: 3 }];
    const setup: GnssSetupUncertainty = { horizontalCenteringSigma: CENTERING, antennaHeightSigma: HEIGHT };
    const base = applyGnssSetupUncertainty({
      stations,
      baselines: buildBaselines(spec, { ellipsoid: ELLIPSOID }),
      setup,
      ellipsoid: ELLIPSOID,
    }).baselines[0]!.covariance;
    resetBaselineIds();
    const shifted = buildStations([
      { id: 'A', x: EQUATOR.x + 2, y: -1, z: 1.5, fixed: true },
      { id: 'B', x: mid.x - 2, y: mid.y + 1, z: mid.z + 1 },
    ]);
    const moved = applyGnssSetupUncertainty({
      stations: shifted,
      baselines: buildBaselines(spec, { ellipsoid: ELLIPSOID }),
      setup,
      ellipsoid: ELLIPSOID,
    }).baselines[0]!.covariance;
    (Object.keys(base) as (keyof GnssBaselineCovariance)[]).forEach((key) => {
      expect(Math.abs(moved[key] - base[key])).toBeLessThan(1e-9);
    });
  });
});

describe('gnss endpoint setup uncertainty: full-solve synthetic parity', () => {
  const triangle = (): { stations: ReturnType<typeof buildStations>; specs: { from: string; to: string; dx: number; dy: number; dz: number }[] } => {
    resetBaselineIds();
    const b = geodeticToEcef(45, 10, 100);
    const c = geodeticToEcef(45.001, 10.001, 110);
    const stations = buildStations([
      { id: 'A', ...EQUATOR, fixed: true },
      { id: 'B', ...b },
      { id: 'C', ...c },
    ]);
    return {
      stations,
      specs: [
        { from: 'A', to: 'B', dx: b.x - EQUATOR.x + 0.003, dy: b.y - EQUATOR.y - 0.002, dz: b.z - EQUATOR.z + 0.004 },
        { from: 'B', to: 'C', dx: c.x - b.x - 0.004, dy: c.y - b.y + 0.001, dz: c.z - b.z - 0.002 },
        { from: 'A', to: 'C', dx: c.x - EQUATOR.x + 0.001, dy: c.y - EQUATOR.y + 0.002, dz: c.z - EQUATOR.z - 0.001 },
      ],
    };
  };

  it('AC/AH/A-style combos solve, shift SEUW in the expected direction, stay sub-mm', () => {
    const combos: { name: string; setup: GnssSetupUncertainty }[] = [
      { name: 'M0', setup: {} },
      { name: 'MC', setup: { horizontalCenteringSigma: CENTERING, antennaHeightSigma: 0 } },
      { name: 'MH', setup: { horizontalCenteringSigma: 0, antennaHeightSigma: HEIGHT } },
      { name: 'MCH', setup: { horizontalCenteringSigma: CENTERING, antennaHeightSigma: HEIGHT } },
    ];
    const results = combos.map(({ name, setup }) => {
      const { stations, specs } = triangle();
      const baselines = buildBaselines(specs, { ellipsoid: ELLIPSOID });
      const result = runGnssBaselineAdjustment({ stations, baselines, setupUncertainty: setup });
      expect(result.converged).toBe(true);
      expect(result.dof).toBe(3);
      return { name, seuw: Math.sqrt(Math.max(result.varianceFactor, 0)), result };
    });
    const byName = new Map(results.map((r) => [r.name, r]));
    const seuw = (name: string): number => byName.get(name)!.seuw;
    // Setup inflation down-weights every block: same misclosures on a
    // looser stochastic model => smaller SEUW, monotone in added variance.
    expect(seuw('MCH')).toBeLessThan(seuw('MC'));
    expect(seuw('MCH')).toBeLessThan(seuw('MH'));
    expect(seuw('MC')).toBeLessThan(seuw('M0'));
    expect(seuw('MH')).toBeLessThan(seuw('M0'));
    // Coordinates stay sub-mm vs the raw run (stochastic reweight only).
    (['MC', 'MH', 'MCH'] as const).forEach((name) => {
      const moved = byName.get(name)!.result;
      const raw = byName.get('M0')!.result;
      (['B', 'C'] as const).forEach((id) => {
        expect(Math.abs(moved.stations[id]!.x - raw.stations[id]!.x)).toBeLessThan(1e-3);
        expect(Math.abs(moved.stations[id]!.y - raw.stations[id]!.y)).toBeLessThan(1e-3);
        expect(Math.abs(moved.stations[id]!.h - raw.stations[id]!.h)).toBeLessThan(1e-3);
      });
    });
  });

  it('report carries the setup model with raw/setup/effective exposure', () => {
    const { stations, specs } = triangle();
    const baselines = buildBaselines(specs, { ellipsoid: ELLIPSOID });
    const { report } = buildGnssReportFromInput({
      stations,
      baselines,
      ellipsoid: ELLIPSOID,
      setupUncertainty: { horizontalCenteringSigma: CENTERING, antennaHeightSigma: HEIGHT },
    });
    expect(report.setupModel?.horizontalCenteringSigma).toBe(CENTERING);
    expect(report.setupModel?.antennaHeightSigma).toBe(HEIGHT);
    expect(report.setupModel?.orientation).toBe('independent-endpoint-local-ENU');
    expect(report.baselines).toHaveLength(3);
    report.baselines.forEach((entry) => {
      expect(entry.rawCovariance).toBeDefined();
      expect(entry.setupCovariance).toBeDefined();
      expect(trace(entry.setupCovariance!)).toBeGreaterThan(0);
    });
    const text = renderGnssBaselineTextReport(report);
    expect(text).toContain('setup model: independent endpoint local ENU');
    // Inactive setup leaves the report untouched (no model, no per-line fields).
    const { stations: s2, specs: sp2 } = triangle();
    const plain = buildGnssReportFromInput({
      stations: s2,
      baselines: buildBaselines(sp2, { ellipsoid: ELLIPSOID }),
    });
    expect(plain.report.setupModel).toBeUndefined();
    plain.report.baselines.forEach((entry) => {
      expect(entry.rawCovariance).toBeUndefined();
      expect(entry.setupCovariance).toBeUndefined();
    });
  });
});

describe('gnss endpoint setup uncertainty: routing tripwires', () => {
  it('setup-augmented networks stay TS-dense: guard still trips, WASM never loads', () => {
    resetBaselineIds();
    const stations = buildStations([
      { id: 'A', ...EQUATOR, fixed: true },
      { id: 'B', x: EQUATOR.x + 100, y: 50, z: 10 },
    ]);
    const baselines = buildBaselines(
      [{ from: 'A', to: 'B', dx: 100, dy: 50, dz: 10 }],
      { ellipsoid: ELLIPSOID },
    );
    const result = runGnssBaselineAdjustment({
      stations,
      baselines,
      setupUncertainty: { horizontalCenteringSigma: CENTERING, antennaHeightSigma: HEIGHT },
    });
    expect(result.adjustmentFrame).toBe('ecef');
    expect(result.routeProvenance).toBe('typescript-dense');
    // Augmented observations keep the gnssBaseline discriminator, so the
    // existing native/sparse exclusion gates (keyed off
    // isGnssBaselineObservation) still refuse every route.
    const observations: GnssBaselineObservation[] = result.setupContributions!.map((c) => ({
      type: 'gnssBaseline' as const,
      id: c.baselineId,
      from: c.from,
      to: c.to,
      vector: { x: 0, y: 0, z: 0 },
      covariance: c.effectiveCovariance,
      frame: 'ecef' as const,
    }));
    expect(observations.some((obs) => isGnssBaselineObservation(obs))).toBe(true);
    expect(isGnssBaselineObservation({ type: 'gps' })).toBe(false);
  });

  it('setup module never touches WASM, sparse solvers, robust, or geoid code', () => {
    const source = readFileSync(
      join(__dirname, '..', '..', 'src', 'engine', 'gnssBaselineSetupUncertainty.ts'),
      'utf8',
    );
    const imports = source.split('\n').filter((line) => line.startsWith('import '));
    imports.forEach((line) => {
      expect(line).not.toMatch(/geoid|wasm|huber/i);
    });
    expect(source).not.toMatch(/sparseCorrectionSolver|robustMode|Worker|WebAssembly/);
  });
});

describe('gnss endpoint setup uncertainty: performance smoke (timings recorded, no gate)', () => {
  it('50/100/1000/10000 endpoints complete; timings logged without assertion', () => {
    const sizes = [50, 100, 1000, 10000];
    const setup: GnssSetupUncertainty = { horizontalCenteringSigma: CENTERING, antennaHeightSigma: HEIGHT };
    const timings: string[] = [];
    sizes.forEach((size) => {
      resetBaselineIds();
      const specs: { id: string; x: number; y: number; z: number; fixed?: boolean }[] = [];
      const blSpecs: { from: string; to: string; dx: number; dy: number; dz: number }[] = [];
      for (let i = 0; i < size; i += 1) {
        const p = geodeticToEcef(20 + (i % 50), -100 + (i % 80), 100 + (i % 30));
        const id = `S${i}`;
        specs.push({ id, ...p, fixed: i === 0 ? true : undefined });
        if (i > 0) blSpecs.push({ from: `S${i - 1}`, to: id, dx: 10, dy: 5, dz: 2 });
      }
      const stations = buildStations(specs);
      const baselines = buildBaselines(blSpecs, { ellipsoid: ELLIPSOID });
      const start = performance.now();
      const applied = applyGnssSetupUncertainty({ stations, baselines, setup, ellipsoid: ELLIPSOID });
      const elapsed = performance.now() - start;
      expect(applied.contributions).toHaveLength(size - 1);
      timings.push(`${size} endpoints: ${elapsed.toFixed(1)} ms`);
    });
    // Recorded for the production report; deliberately not gated.
    console.info(`[gnss-setup-perf] ${timings.join(' | ')}`);
  });
});
