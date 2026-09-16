import { describe, expect, it } from 'vitest';

import { solveEngine } from '../src/engine/solveEngine';
import {
  buildCouplingGroupRows,
  computeExternalInfluences,
  EXTERNAL_REASON_FREE_NETWORK,
  EXTERNAL_REASON_SPARSE_ROUTE,
  EXTERNAL_REASON_UNTESTABLE,
  isFreeNetworkDatum,
} from '../src/engine/adjustExternalReliability';
import type { ExternalInfluence } from '../src/engine/adjustExternalReliability';
import { statisticalMdb } from '../src/engine/reliabilityPolicy';
import { primaryExternalOf } from '../src/engine/reliabilityDisplay';
import type { Observation } from '../src/types';

type Available = Extract<ExternalInfluence, { available: true }>;

/** Exact 3-4-5 geometry: sqrt(50^2+40^2) and the exact subtended angle (DMS). */
const DIST_EXACT = '64.0312423743285';
const ANGLE_EXACT = '102-40-49.380570552';

/** Exact 2D network (zero residuals) with small sigmas: the linear regime. */
const EXACT_2D = [
  '.2D',
  'C A 0 0 0 ! !',
  'C B 100 0 0 ! !',
  'C P 50 40 0',
  `D A-P ${DIST_EXACT} 0.00001`,
  `D B-P ${DIST_EXACT} 0.00001`,
  `A P-A-B ${ANGLE_EXACT} 0.001`,
].join('\n');

/** Realistic-sigma network with an outlier (legacy default-mode checks). */
const OUTLIER_INPUT = [
  '.2D',
  'C A 0 0 0 ! !',
  'C B 100 0 0 ! !',
  'C P 50 40 0',
  'D A-P 64.031 0.01',
  'D B-P 64.031 0.01',
  'A P-A-B 102-40-00.0 1.0',
  'D A-P 64.071 0.01',
].join('\n');

/** Exact direction set (az = atan2(dx,dy) from north, DMS). */
const EXACT_DIR = [
  '.2D',
  'C A 0 0 0 ! !',
  'C B 100 0 0 ! !',
  'C P 50 40 0',
  `D A-P ${DIST_EXACT} 0.00001`,
  `D B-P ${DIST_EXACT} 0.00001`,
  'DB P',
  'DN A 231-20-24.690285276 0.001',
  'DN B 128-39-35.309714724 0.001',
  'DE',
].join('\n');

/** Exact 2D GPS network with small sigmas. */
const EXACT_GPS = [
  '.2D',
  'C A 0 0 0 ! !',
  'C B 100 0 0 ! !',
  'C P 50 40 0',
  'G GPS1 A P 50.0 40.0 0.00001 0.00001',
  'G GPS1 B P -50.0 40.0 0.00001 0.00001',
  `D A-P ${DIST_EXACT} 0.00001`,
].join('\n');

/** B as a weighted (non-fixed) control: it must move under a blunder. */
const WEIGHTED_CONTROL = [
  '.2D',
  'C A 0 0 0 ! !',
  'C B 100 0 0.00001 0.00001',
  'C P 50 40 0',
  `D A-P ${DIST_EXACT} 0.00001`,
  `D B-P ${DIST_EXACT} 0.00001`,
  `A P-A-B ${ANGLE_EXACT} 0.001`,
].join('\n');

const DIST_3D = ['D A-P 64.0390505863415 0.00001', 'D B-P 64.0390505863415 0.00001', 'D A-Q 78.1280999384984 0.00001', 'D B-Q 64.0624695121879 0.00001', 'D P-Q 14.1774468787578 0.00001'];
const HEAD_3D = ['.3D', 'C A 0 0 100 ! ! !', 'C B 100 0 100 ! ! !', 'C P 50 40 101', 'C Q 60 50 102', ...DIST_3D];

/**
 * Fully-linear leveling network (leveling + coordinate constraints only):
 * the solver converges in 2 iterations, so +MDB/-MDB opposition is exact.
 */
const EXACT_LEV_LINEAR = [
  '.3D',
  'C A 0 0 100 ! ! !',
  'C B 100 0 100 ! ! !',
  'C P 50 40 101 0.0000001 0.0000001',
  'C Q 60 50 102 0.0000001 0.0000001',
  '.DELTA ON',
  'V A-P 1.0 0.001',
  'V B-P 1.0 0.001',
  'V A-Q 2.0 0.001',
  'V P-Q 1.0 0.001',
].join('\n');

/**
 * Single-free-station zenith fixture. Small uniform sigmas keep the
 * perturb-by-MDB step deep in the linear regime; the approximate pass-1
 * zeniths are replaced by exact modeled values below.
 */
const HEAD_ZEN_1P = [
  '.3D',
  'C A 0 0 100 ! ! !',
  'C B 100 0 100 ! ! !',
  'C P 50 40 101',
  'D A-P 64.0390505863415 0.000002',
  'D B-P 64.0390505863415 0.000002',
];

/** Exact 3D leveling network (V records are level differences under .DELTA ON). */
const EXACT_LEV_3D = [...HEAD_3D, '.DELTA ON', 'V A-P 1.0 0.00001', 'V B-P 1.0 0.00001', 'V A-Q 2.0 0.00001'].join('\n');

const run2D = (
  input: string,
  overrides?: Record<number, { obs: number } | { obs: { dE: number; dN: number } }>,
  extraParse: Record<string, unknown> = {},
) =>
  solveEngine({
    input,
    maxIterations: 30,
    ...(overrides ? { overrides } : {}),
    parseOptions: {
      coordMode: '2D',
      units: 'm',
      reliabilityPolicy: { model: 'statistical' },
      ...extraParse,
    },
  });

const run3D = (input: string, overrides?: Record<number, { obs: number }>) =>
  solveEngine({
    input,
    maxIterations: 30,
    ...(overrides ? { overrides } : {}),
    parseOptions: { coordMode: '3D', units: 'm', reliabilityPolicy: { model: 'statistical' } },
  });

/** Tight convergence for small-signal 3D proofs (zenith/leveling symmetry). */
const runTight3D = (input: string, overrides?: Record<number, { obs: number }>) =>
  solveEngine({
    input,
    maxIterations: 60,
    convergenceThreshold: 1e-12,
    ...(overrides ? { overrides } : {}),
    parseOptions: { coordMode: '3D', units: 'm', reliabilityPolicy: { model: 'statistical' } },
  });

const available = (obs: Observation): Available => {
  const ext = obs.reliability?.external;
  expect(ext?.available).toBe(true);
  return ext as Available;
};

const shiftOf = (ext: Available, stationId: string): { dE: number; dN: number; dH: number } => {
  const entry = ext.vectorMm.find((s) => s.stationId === stationId);
  expect(entry).toBeDefined();
  return { dE: entry?.dE ?? 0, dN: entry?.dN ?? 0, dH: entry?.dH ?? 0 };
};

/**
 * Brute-force +MDB perturbation of one scalar observation, returned as the
 * per-station coordinate shift in mm. Angular overrides take degrees.
 */
const bruteForceShift = (
  input: string,
  base: ReturnType<typeof run2D>,
  obsId: number,
  run: (_inp: string, _over?: Record<number, { obs: number }>) => ReturnType<typeof run2D>,
): Map<string, { dE: number; dN: number; dH: number }> => {
  const obs = base.observations.find((o) => o.id === obsId);
  expect(obs).toBeDefined();
  const mdb = (obs?.reliability as unknown as { mdbStatistical: number }).mdbStatistical;
  expect(Number.isFinite(mdb)).toBe(true);
  const raw = (obs as unknown as { obs: number }).obs;
  const angular =
    obs?.type === 'angle' || obs?.type === 'direction' || obs?.type === 'zenith' || obs?.type === 'dir';
  const perturbed = angular ? ((raw + mdb) * 180) / Math.PI : raw + mdb;
  const pert = run(input, { [obsId]: { obs: perturbed } });
  expect(pert.success).toBe(true);
  const shifts = new Map<string, { dE: number; dN: number; dH: number }>();
  for (const [id, station] of Object.entries(pert.stations)) {
    const baseStation = base.stations[id];
    if (!baseStation) continue;
    shifts.set(id, {
      dE: (station.x - baseStation.x) * 1000,
      dN: (station.y - baseStation.y) * 1000,
      dH: (station.h - baseStation.h) * 1000,
    });
  }
  return shifts;
};

/** Vector relative error with an absolute noise floor (iterative-solve noise). */
const vectorRelErr = (
  a: { dE: number; dN: number; dH: number },
  b: { dE: number; dN: number; dH: number },
  floor = 1e-9,
): number => {
  const diff = Math.hypot(a.dE - b.dE, a.dN - b.dN, a.dH - b.dH);
  return diff / Math.max(Math.hypot(b.dE, b.dN, b.dH), floor);
};

describe('fixed stations carry exactly zero influence (A)', () => {
  it('excludes fixed stations from every influence vector', () => {
    const result = run2D(OUTLIER_INPUT);
    expect(result.success).toBe(true);
    let checked = 0;
    for (const obs of result.observations) {
      const ext = obs.reliability?.external;
      if (ext?.available !== true) continue;
      checked += 1;
      const ids = ext.vectorMm.map((s) => s.stationId);
      expect(ids).not.toContain('A');
      expect(ids).not.toContain('B');
      expect(ids).toContain('P');
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe('distance brute-force agreement incl. sign (B)', () => {
  for (const obsId of [0, 1]) {
    it(`matches perturb-by-+MDB re-solve to 1e-6 for dist obs ${obsId}`, () => {
      const base = run2D(EXACT_2D);
      expect(base.seuw).toBeLessThan(1e-6);
      const obs = base.observations.find((o) => o.id === obsId);
      expect(obs?.type).toBe('dist');
      const ext = available(obs as Observation);
      const shifts = bruteForceShift(EXACT_2D, base, obsId, run2D);
      const analytic = shiftOf(ext, 'P');
      const brute = shifts.get('P');
      expect(brute).toBeDefined();
      expect(vectorRelErr(brute as { dE: number; dN: number; dH: number }, analytic)).toBeLessThan(1e-6);
      // Sign of the dominant component must agree (not just the magnitude).
      const dom = Math.abs(analytic.dE) >= Math.abs(analytic.dN) ? 'dE' : 'dN';
      expect(Math.sign((brute as Record<string, number>)[dom])).toBe(Math.sign(analytic[dom]));
    });
  }
});

describe('angle brute-force agreement incl. sign (C)', () => {
  it('matches perturb-by-+MDB re-solve to 1e-6 for the angle obs', () => {
    const base = run2D(EXACT_2D);
    const obs = base.observations.find((o) => o.type === 'angle');
    expect(obs).toBeDefined();
    const ext = available(obs as Observation);
    const shifts = bruteForceShift(EXACT_2D, base, obs?.id as number, run2D);
    const analytic = shiftOf(ext, 'P');
    const brute = shifts.get('P');
    expect(brute).toBeDefined();
    expect(vectorRelErr(brute as { dE: number; dN: number; dH: number }, analytic)).toBeLessThan(1e-6);
    const dom = Math.abs(analytic.dE) >= Math.abs(analytic.dN) ? 'dE' : 'dN';
    expect(Math.sign((brute as Record<string, number>)[dom])).toBe(Math.sign(analytic[dom]));
  });
});

describe('leveling brute-force agreement (D)', () => {
  it('propagates a leveling MDB almost entirely into height', () => {
    const base = run3D(EXACT_LEV_3D);
    expect(base.seuw).toBeLessThan(1e-6);
    const obs = base.observations.find((o) => o.type === 'lev');
    expect(obs).toBeDefined();
    const ext = available(obs as Observation);
    const analytic = shiftOf(ext, 'P');
    expect(Math.abs(analytic.dH)).toBeGreaterThan(10 * Math.hypot(analytic.dE, analytic.dN));
    const shifts = bruteForceShift(EXACT_LEV_3D, base, obs?.id as number, run3D as never);
    const brute = shifts.get('P');
    expect(brute).toBeDefined();
    expect(vectorRelErr(brute as { dE: number; dN: number; dH: number }, analytic)).toBeLessThan(1e-6);
    expect(Math.sign((brute as { dH: number }).dH)).toBe(Math.sign(analytic.dH));
  });
});

describe('zenith on a bootstrapped-exact 3D fixture (E)', () => {
  const exactZenithInput = (): string => {
    const approx = [...HEAD_ZEN_1P, 'V A-P 89.1 0.001', 'V B-P 89.1 0.001'].join('\n');
    const pass1 = runTight3D(approx);
    expect(pass1.success).toBe(true);
    const lines = [...HEAD_ZEN_1P];
    for (const z of pass1.observations.filter((o) => o.type === 'zenith')) {
      const calc = z.calc as number;
      expect(Number.isFinite(calc)).toBe(true);
      const ends = z as unknown as { from: string; to: string };
      lines.push(`V ${ends.from}-${ends.to} ${((calc * 180) / Math.PI).toPrecision(13)} 0.001`);
    }
    return lines.join('\n');
  };

  it('matches perturb-by-+MDB re-solve on the affected station to 1e-6', () => {
    const input = exactZenithInput();
    const base = runTight3D(input);
    expect(base.success).toBe(true);
    expect(base.seuw).toBeLessThan(1e-6);
    const obs = base.observations.find((o) => o.type === 'zenith');
    expect(obs).toBeDefined();
    const ext = available(obs as Observation);
    expect(ext.primaryKind).toBe('3d');
    expect(ext.max3dMm).toBeDefined();
    const affected = ext.affectedStation as string;
    const analytic = shiftOf(ext, affected);
    const shifts = bruteForceShift(input, base, obs?.id as number, runTight3D);
    const brute = shifts.get(affected);
    expect(brute).toBeDefined();
    expect(vectorRelErr(brute as { dE: number; dN: number; dH: number }, analytic)).toBeLessThan(1e-6);
    // Far-field stations agree to the iterative-solve noise floor (~1e-9 m).
    for (const entry of ext.vectorMm) {
      const b = shifts.get(entry.stationId);
      expect(b).toBeDefined();
      for (const [key, value] of Object.entries({ dE: entry.dE, dN: entry.dN, dH: entry.dH ?? 0 })) {
        expect(Math.abs((b as Record<string, number>)[key] - (value as number))).toBeLessThan(1e-6);
      }
    }
  });
});

describe('+MDB vs -MDB symmetry (F)', () => {
  it('produces opposite signed vectors on the linear leveling fixture', () => {
    const base = runTight3D(EXACT_LEV_LINEAR);
    expect(base.success).toBe(true);
    const obs = base.observations.find((o) => o.type === 'lev');
    expect(obs).toBeDefined();
    const mdb = (obs?.reliability as unknown as { mdbStatistical: number }).mdbStatistical;
    const raw = (obs as unknown as { obs: number }).obs;
    const plus = runTight3D(EXACT_LEV_LINEAR, { [obs?.id as number]: { obs: raw + mdb } });
    const minus = runTight3D(EXACT_LEV_LINEAR, { [obs?.id as number]: { obs: raw - mdb } });
    expect(plus.success).toBe(true);
    expect(minus.success).toBe(true);
    for (const [id, plusStation] of Object.entries(plus.stations)) {
      const baseStation = base.stations[id];
      const minusStation = minus.stations[id];
      if (plusStation.fixed || !baseStation || !minusStation) continue;
      for (const component of ['x', 'y', 'h'] as const) {
        const vp = (plusStation[component] - baseStation[component]) * 1000;
        const vm = (minusStation[component] - baseStation[component]) * 1000;
        const denom = Math.max(Math.abs(vp), 1e-12);
        expect(Math.abs(vp + vm) / denom).toBeLessThan(1e-9);
      }
    }
  });
});

describe('magnitude definitions (G)', () => {
  it('reports horizontal == sqrt(dE^2+dN^2) and max-component consistently in 2D', () => {
    const result = run2D(EXACT_2D);
    const obs = result.observations[0];
    const ext = available(obs);
    const affected = shiftOf(ext, ext.affectedStation as string);
    expect(ext.primaryKind).toBe('horizontal');
    expect(ext.primaryMm).toBe(ext.maxHorizontalMm);
    expect(ext.maxHorizontalMm).toBeCloseTo(Math.hypot(affected.dE, affected.dN), 12);
    const maxAbs = Math.max(
      ...ext.vectorMm.flatMap((s) => [Math.abs(s.dE), Math.abs(s.dN)]),
    );
    expect(ext.maxComponentMm).toBeCloseTo(maxAbs, 12);
    expect(ext.max3dMm).toBeUndefined();
    expect(ext.maxVerticalMm).toBeUndefined();
  });

  it('reports 3D magnitude and vertical consistently on the leveling fixture', () => {
    const result = run3D(EXACT_LEV_3D);
    const obs = result.observations.find((o) => o.type === 'lev');
    const ext = available(obs as Observation);
    const affected = shiftOf(ext, ext.affectedStation as string);
    expect(ext.primaryKind).toBe('3d');
    expect(ext.primaryMm).toBe(ext.max3dMm);
    expect(ext.max3dMm).toBeCloseTo(Math.hypot(affected.dE, affected.dN, affected.dH), 9);
    const maxAbsH = Math.max(...ext.vectorMm.map((s) => Math.abs(s.dH ?? 0)));
    expect(ext.maxVerticalMm).toBeCloseTo(maxAbsH, 9);
  });
});

describe('TS correlation uses the true P column (H)', () => {
  it('matches the correlated re-solve to 1e-6 for a direction in the set', () => {
    const extra = { tsCorrelationEnabled: true, tsCorrelationRho: 0.5, tsCorrelationScope: 'set' };
    const base = run2D(EXACT_DIR, undefined, extra);
    expect(base.seuw).toBeLessThan(1e-6);
    const obs = base.observations.find((o) => o.type === 'direction');
    expect(obs).toBeDefined();
    const ext = available(obs as Observation);
    const runCorr = (inp: string, over?: Record<number, { obs: number }>) => run2D(inp, over, extra);
    const shifts = bruteForceShift(EXACT_DIR, base, obs?.id as number, runCorr);
    const analytic = shiftOf(ext, 'P');
    const brute = shifts.get('P');
    expect(brute).toBeDefined();
    // The re-solve uses the full correlated P: agreement proves the true
    // P column (a diagonal-naive evaluation would disagree with it).
    expect(vectorRelErr(brute as { dE: number; dN: number; dH: number }, analytic)).toBeLessThan(1e-6);
  });

  it('differs from the uncorrelated evaluation', () => {
    const extra = { tsCorrelationEnabled: true, tsCorrelationRho: 0.5, tsCorrelationScope: 'set' };
    const corr = run2D(EXACT_DIR, undefined, extra);
    const plain = run2D(EXACT_DIR);
    const corrExt = available(corr.observations.find((o) => o.type === 'direction') as Observation);
    const plainExt = available(plain.observations.find((o) => o.type === 'direction') as Observation);
    expect(corrExt.primaryMm).not.toBe(plainExt.primaryMm);
  });
});

describe('weighted controls move with the solve (I)', () => {
  it('shows nonzero control-station influence matching the re-solve', () => {
    const base = run2D(WEIGHTED_CONTROL);
    expect(base.stations.B.constraintX).toBeDefined();
    const obs = base.observations[0];
    const ext = available(obs);
    const analyticB = shiftOf(ext, 'B');
    expect(Math.hypot(analyticB.dE, analyticB.dN)).toBeGreaterThan(0);
    const shifts = bruteForceShift(WEIGHTED_CONTROL, base, obs.id, run2D);
    const bruteB = shifts.get('B');
    expect(bruteB).toBeDefined();
    expect(vectorRelErr(bruteB as { dE: number; dN: number; dH: number }, analyticB)).toBeLessThan(1e-6);
    expect(ext.vectorMm.map((s) => s.stationId)).not.toContain('A');
  });
});

describe('GPS components use the coupled 2x2 block (J)', () => {
  it('matches the re-solve per component to 1e-6', () => {
    const base = run2D(EXACT_GPS);
    expect(base.seuw).toBeLessThan(1e-6);
    const gps = base.observations.find((o) => o.type === 'gps');
    expect(gps).toBeDefined();
    const comps = gps?.reliability?.externalComponents;
    expect(comps?.E?.available).toBe(true);
    expect(comps?.N?.available).toBe(true);
    // Perturb dE by the E-component statistical MDB, holding dN fixed.
    const statComps = gps?.reliability?.mdbStatisticalComponents as { mE: number; mN: number };
    const raw = (gps as unknown as { obs: { dE: number; dN: number } }).obs;
    const pert = run2D(EXACT_GPS, {
      [gps?.id as number]: { obs: { dE: raw.dE + statComps.mE, dN: raw.dN } },
    });
    const analytic = shiftOf(comps?.E as Available, 'P');
    const brute = {
      dE: (pert.stations.P.x - base.stations.P.x) * 1000,
      dN: (pert.stations.P.y - base.stations.P.y) * 1000,
      dH: 0,
    };
    expect(vectorRelErr(brute, analytic)).toBeLessThan(1e-6);
    expect(Math.sign(brute.dE)).toBe(Math.sign(analytic.dE));
  });
});

describe('realistic-sigma nonlinear re-solve (M)', () => {
  // NOTE on tolerance: the fixtures above use exact-geometry, tiny-sigma
  // networks so perturb-by-MDB re-solves stay in the linear regime
  // (agreement 1e-6). Here the sigmas are realistic (10 mm / 1 arcsec),
  // the network carries a 40 mm outlier, and the MDB step itself is
  // ~50 mm on a 64 m line: the re-solve samples second-order curvature
  // plus iterative-solve noise. Agreement at 1e-3 relative (~0.1%) is the
  // documented curvature-regime check; it still verifies sign, magnitude,
  // and the full-P-column coupling.
  it('matches perturb-by-+MDB re-solves to 1e-3 with realistic sigmas', () => {
    const base = run2D(OUTLIER_INPUT);
    expect(base.success).toBe(true);
    for (const obs of base.observations) {
      if (obs.type !== 'dist') continue;
      const ext = available(obs);
      const mdb = (obs.reliability as unknown as { mdbStatistical: number }).mdbStatistical;
      expect(Number.isFinite(mdb)).toBe(true);
      const raw = (obs as unknown as { obs: number }).obs;
      const pert = run2D(OUTLIER_INPUT, { [obs.id]: { obs: raw + mdb } });
      expect(pert.success).toBe(true);
      const analytic = shiftOf(ext, 'P');
      const brute = {
        dE: (pert.stations.P.x - base.stations.P.x) * 1000,
        dN: (pert.stations.P.y - base.stations.P.y) * 1000,
        dH: 0,
      };
      expect(vectorRelErr(brute, analytic)).toBeLessThan(1e-3);
      const dom = Math.abs(analytic.dE) >= Math.abs(analytic.dN) ? 'dE' : 'dN';
      expect(Math.sign((brute as Record<string, number>)[dom])).toBe(Math.sign(analytic[dom]));
    }
  });
});

/** 3D GPS covariance fixture: two fixed controls, one free point, redundant distances. */
const GPS_3D_INPUT = [
  '.3D',
  'C A 0 0 100 ! ! !',
  'C B 100 0 100 ! ! !',
  'C P 50 40 101',
  '.GPS WEIGHT COVARIANCE',
  "G0 'probe",
  'G1 A-P 50.0 40.0 1.0',
  'G2 0.0001 0.0001 0.0001',
  'G3 0.0 0.0 0.0',
  'G1 B-P -50.0 40.0 1.0',
  'G2 0.0001 0.0001 0.0001',
  'G3 0.0 0.0 0.0',
  'D A-P 64.0390505863415 0.01',
  'D B-P 64.0390505863415 0.01',
].join('\n');

describe('3D GPS U component and max-component aggregation (N)', () => {
  it('exposes E/N/U statistical MDBs with a min-finite aggregate', () => {
    const result = solveEngine({
      input: GPS_3D_INPUT,
      maxIterations: 30,
      parseOptions: { coordMode: '3D', units: 'm', reliabilityPolicy: { model: 'statistical' } },
    });
    expect(result.success).toBe(true);
    const gps = result.observations.find((o) => o.type === 'gps');
    expect(gps).toBeDefined();
    const statComps = gps?.reliability?.mdbStatisticalComponents;
    expect(statComps?.mE).toBeDefined();
    expect(statComps?.mN).toBeDefined();
    expect(statComps?.mU).toBeDefined();
    expect(Number.isFinite(statComps?.mE)).toBe(true);
    expect(Number.isFinite(statComps?.mN)).toBe(true);
    expect(Number.isFinite(statComps?.mU)).toBe(true);
    const finite = [statComps?.mE, statComps?.mN, statComps?.mU].filter(
      (value): value is number => Number.isFinite(value),
    );
    expect(gps?.reliability?.mdbStatistical).toBe(Math.min(...finite));
  });

  it('aggregates external influence by max component and matches the E re-solve', () => {
    const run3DStat = (inp: string, over?: Record<number, { obs: { dE: number; dN: number } }>) =>
      solveEngine({
        input: inp,
        maxIterations: 30,
        ...(over ? { overrides: over } : {}),
        parseOptions: { coordMode: '3D', units: 'm', reliabilityPolicy: { model: 'statistical' } },
      });
    const base = run3DStat(GPS_3D_INPUT);
    expect(base.success).toBe(true);
    const gps = base.observations.find((o) => o.type === 'gps');
    const comps = gps?.reliability?.externalComponents;
    expect(comps?.E?.available).toBe(true);
    expect(comps?.N?.available).toBe(true);
    expect(comps?.U?.available).toBe(true);
    // Max-component aggregation: the observation-level influence is the
    // strongest per-component effect, not a joint vector influence.
    const primaries = [comps?.E, comps?.N, comps?.U]
      .filter((entry): entry is Available => entry?.available === true)
      .map((entry) => entry.primaryMm);
    expect(primaryExternalOf(gps as Observation)?.available).toBe(true);
    expect((primaryExternalOf(gps as Observation) as Available).primaryMm).toBe(
      Math.max(...primaries),
    );
    // Perturb dE by the E-component statistical MDB (curvature-regime
    // tolerance per the note in (M)).
    const statComps = gps?.reliability?.mdbStatisticalComponents as { mE: number };
    const raw = (gps as unknown as { obs: { dE: number; dN: number } }).obs;
    const pert = run3DStat(GPS_3D_INPUT, {
      [gps?.id as number]: { obs: { dE: raw.dE + statComps.mE, dN: raw.dN } },
    });
    expect(pert.success).toBe(true);
    const analytic = shiftOf(comps?.E as Available, 'P');
    const brute = {
      dE: (pert.stations.P.x - base.stations.P.x) * 1000,
      dN: (pert.stations.P.y - base.stations.P.y) * 1000,
      dH: (pert.stations.P.h - base.stations.P.h) * 1000,
    };
    expect(vectorRelErr(brute, analytic)).toBeLessThan(1e-3);
  });
});

describe('invalid statistical policy stays statistical (O)', () => {
  it('reports untestable external with no legacy fallback or linear equivalent', () => {
    const result = run2D(OUTLIER_INPUT, undefined, {
      reliabilityPolicy: { model: 'statistical', power: 0.4 },
    });
    expect(result.success).toBe(true);
    expect(result.reliabilitySummary?.model).toBe('statistical');
    expect(result.reliabilitySummary?.available).toBe(false);
    expect(result.reliabilitySummary?.reason).toMatch(/power/);
    let checked = 0;
    const check = (ext: ExternalInfluence | undefined): void => {
      if (!ext) return;
      checked += 1;
      expect(ext.available).toBe(false);
      if (!ext.available) expect(ext.reason).toBe(EXTERNAL_REASON_UNTESTABLE);
    };
    for (const obs of result.observations) {
      const rel = obs.reliability;
      if (!rel) continue;
      // No legacy model mixing: provenance stays statistical, no
      // statistical MDB or linear equivalent is exposed, and no external
      // influence is propagated or legacy-labeled.
      expect(rel.method).not.toBe('legacy-3.29');
      expect(rel.mdbStatistical).toBeUndefined();
      expect(rel.mdbLinearMm).toBeUndefined();
      check(rel.external);
      for (const comp of Object.values(rel.externalComponents ?? {})) check(comp);
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe('worst-station argmax stability (P)', () => {
  // Mirrored shifts (exact-magnitude tie, opposite signs, as in leveling
  // between adjacent benchmarks): the first station wins deterministically
  // instead of flipping on last-ulp solver noise across routes.
  const tieArgs = (s2h: number): Parameters<typeof computeExternalInfluences>[0] => ({
    is2D: false,
    B: [[0, 0, 1, 0, 0, s2h]],
    P: [[2]],
    equationCount: 1,
    paramColumns: [
      { stationId: 'S1', e: 0, n: 1, h: 2 },
      { stationId: 'S2', e: 3, n: 4, h: 5 },
    ],
    rows: [{ row: 0, mdbNative: 0.001, mdbModel: 'statistical', groupRows: [0] }],
    freeNetwork: false,
    robustApproximate: false,
  });

  it('keeps the first station on an exact-magnitude tie', () => {
    const out = computeExternalInfluences(tieArgs(-1));
    const ext = out.get(0);
    expect(ext?.available).toBe(true);
    if (ext?.available === true) {
      expect(ext.affectedStation).toBe('S1');
      expect(ext.dHmm).toBeCloseTo(2, 12);
      expect(ext.max3dMm).toBeCloseTo(2, 12);
    }
  });

  it('yields to a decisive lead beyond solver-noise scale', () => {
    const out = computeExternalInfluences(tieArgs(-3));
    const ext = out.get(0);
    expect(ext?.available).toBe(true);
    if (ext?.available === true) {
      expect(ext.affectedStation).toBe('S2');
      expect(ext.dHmm).toBeCloseTo(-6, 12);
    }
  });
});

describe('free-network and route gates (K)', () => {
  it('flags a datum with no fixed components and no constraints as free', () => {
    expect(isFreeNetworkDatum({ stations: { P: {}, Q: {} }, constraintCount: 0 })).toBe(true);
    expect(
      isFreeNetworkDatum({ stations: { A: { fixedX: true }, P: {} }, constraintCount: 0 }),
    ).toBe(false);
    expect(isFreeNetworkDatum({ stations: { P: {} }, constraintCount: 2 })).toBe(false);
  });

  it('reports free-network-datum for every row when the datum is free', () => {
    const out = computeExternalInfluences({
      is2D: true,
      B: [[1, 0]],
      P: [[1]],
      equationCount: 1,
      paramColumns: [{ stationId: 'P', e: 0, n: 1 }],
      rows: [{ row: 0, mdbNative: 0.05, mdbModel: 'statistical', groupRows: [0] }],
      freeNetwork: true,
      robustApproximate: false,
    });
    expect(out.get(0)).toEqual({ available: false, reason: EXTERNAL_REASON_FREE_NETWORK });
  });

  it('fails closed without dense rows and without an MDB to propagate', () => {
    const noRows = computeExternalInfluences({
      is2D: true,
      B: [],
      P: undefined,
      equationCount: 1,
      paramColumns: [{ stationId: 'P', e: 0, n: 1 }],
      rows: [{ row: 0, mdbNative: 0.05, mdbModel: 'statistical', groupRows: [0] }],
      freeNetwork: false,
      robustApproximate: false,
    });
    expect(noRows.get(0)).toEqual({ available: false, reason: EXTERNAL_REASON_SPARSE_ROUTE });
    const noMdb = computeExternalInfluences({
      is2D: true,
      B: [[1, 0]],
      P: [[1]],
      equationCount: 1,
      paramColumns: [{ stationId: 'P', e: 0, n: 1 }],
      rows: [{ row: 0, mdbNative: Number.POSITIVE_INFINITY, mdbModel: 'statistical', groupRows: [0] }],
      freeNetwork: false,
      robustApproximate: false,
    });
    expect(noMdb.get(0)).toEqual({ available: false, reason: EXTERNAL_REASON_UNTESTABLE });
    // Internal MDB stays finite on representative values (datum gate is external-only).
    expect(Number.isFinite(statisticalMdb(1e-4, 0.5, 4.132))).toBe(true);
  });

  it('groups coupled rows by GPS block and TS key, singletons otherwise', () => {
    const groups = buildCouplingGroupRows(
      [
        { obsId: 1, component: 'E' },
        { obsId: 1, component: 'N' },
        { obsId: 2 },
        { obsId: 3 },
        null,
      ],
      (obsId) => (obsId === 2 || obsId === 3 ? 'set:TS' : null),
    );
    expect(groups.get(0)).toEqual([0, 1]);
    expect(groups.get(2)).toEqual([2, 3]);
    expect(groups.get(4)).toEqual([4]);
  });
});

describe('legacy default mode and preanalysis restriction', () => {
  it('propagates the legacy MDB when statistical mode is off', () => {
    const result = solveEngine({
      input: OUTLIER_INPUT,
      maxIterations: 8,
      parseOptions: { coordMode: '2D', units: 'm' },
    });
    const obs = result.observations[0];
    const ext = available(obs);
    expect((ext as Available).mdbModel).toBe('legacy-3.29');
    expect(ext.mdbUsed).toBe(obs.reliability?.mdb);
  });

  it('leaves per-observation external absent on the preanalysis path', () => {
    const result = solveEngine({
      input: OUTLIER_INPUT,
      maxIterations: 8,
      parseOptions: {
        coordMode: '2D',
        units: 'm',
        runMode: 'preanalysis',
        reliabilityPolicy: { model: 'statistical' },
      },
    });
    expect(result.preanalysisMode).toBe(true);
    expect(
      result.observations.every(
        (o) => o.reliability?.external === undefined && o.reliability?.externalComponents === undefined,
      ),
    ).toBe(true);
  });
});

describe('performance smoke (L)', () => {
  it('computes external influence for ~1k equations in under 2 s with no re-solves', () => {
    const lines = ['.2D', 'C A 0 0 0 ! !', 'C B 1000 0 0 ! !'];
    const pts: { id: string; x: number; y: number }[] = [];
    for (let i = 0; i < 100; i += 1) {
      const id = `P${i}`;
      const x = 100 + i * 8;
      const y = 150 + (i % 7) * 3;
      pts.push({ id, x, y });
      lines.push(`C ${id} ${x} ${y} 0`);
    }
    const seen = new Set<string>();
    const link = (a: string, ax: number, ay: number, b: string, bx: number, by: number): void => {
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      if (seen.has(key)) return;
      seen.add(key);
      lines.push(`D ${a}-${b} ${Math.hypot(ax - bx, ay - by).toPrecision(12)} 0.01`);
    };
    pts.forEach((p, i) => {
      link('A', 0, 0, p.id, p.x, p.y);
      link('B', 1000, 0, p.id, p.x, p.y);
      for (let k = 1; k <= 8; k += 1) {
        if (i - k >= 0) link(pts[i - k].id, pts[i - k].x, pts[i - k].y, p.id, p.x, p.y);
        if (i + k < pts.length) link(p.id, p.x, p.y, pts[i + k].id, pts[i + k].x, pts[i + k].y);
      }
    });
    const input = lines.join('\n');
    // computeExternalInfluences is a pure O(n.u) pass over the dense B rows:
    // the engine calls the solver exactly once (no per-observation re-solve).
    const startedAt = Date.now();
    const result = solveEngine({
      input,
      maxIterations: 8,
      parseOptions: { coordMode: '2D', units: 'm', reliabilityPolicy: { model: 'statistical' } },
    });
    const elapsedMs = Date.now() - startedAt;
    expect(result.success).toBe(true);
    expect(result.observations.length).toBeGreaterThan(900);
    for (const obs of result.observations) {
      expect(obs.reliability?.external?.available).toBe(true);
    }
    expect(elapsedMs).toBeLessThan(2000);
  });
});
