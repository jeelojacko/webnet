/**
 * Phase 12I.0 Worker B — Dataset A/B free-network commercial evidence.
 *
 * EVIDENCE ONLY: this file adds no production code and modifies no solver,
 * preflight, tolerance, R2B-routing, UI, or import behavior. When the local
 * TBC intake is absent every intake leg fails closed to SKIP (no fake data).
 *
 * Method (local minimal gauge + S-transform; used only if Worker A's
 * `src/engine/gnssFreeNetworkEvidence.ts` is absent — no blocking):
 * fix a temporary anchor with the production solver, S-transform the result
 * to the inner datum (translation-only defect), then rigidly translate the
 * datum reference to the constrained coordinate and compare.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  runGnssBaselineAdjustment,
} from '../../src/engine/gnssBaselineAdjust';
import { computeGnssLoopClosures } from '../../src/engine/gnssBaselineLoops';
import type { GnssSetupUncertainty } from '../../src/engine/gnssBaselineSetupUncertainty';
import type { GnssBaselineObservation } from '../../src/engine/gnssBaselineTypes';
import { parseGvx } from '../../src/engine/gnssGvxImport';
import { parseGvxSyntax } from '../../src/engine/gnssGvxSyntax';
import { groupMarksByName } from '../../scripts/gnss/tbcParityModel';
import type { StationMap } from '../../src/types';

// ---------------------------------------------------------------------------
// Read-only intake loader (copied pattern from
// scripts/gnss/gnssNativeArchitectureAudit.ts loadIntakeNetwork; original
// untouched). Adds only the GVX filename + SHA-256 pin for reporting.
// ---------------------------------------------------------------------------

interface IntakeNetwork {
  readonly stations: StationMap;
  readonly baselines: GnssBaselineObservation[];
  readonly vectors: number;
  readonly fixedName: string;
  readonly gvxFile: string;
  readonly gvxSha256: string;
}

const HOME = process.env['HOME'] ?? '~';
const INTAKE_A_DIR = join(HOME, 'Downloads/webnet-gnss-12e/tbc-intake/AdjustingtheNetwork');
const INTAKE_B_DIR = join(
  HOME,
  'Downloads/webnet-gnss-12e/tbc-intake/ProcessingGNSSBaselines/ProcessingGNSSBaselines',
);

const loadIntakeNetwork = (dir: string, fixedName: string): IntakeNetwork | null => {
  if (!existsSync(dir)) return null;
  const gvxFile = readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.gvx'))
    .sort()
    .find((f) => (fixedName === 'P041' ? true : f.toLowerCase().includes('b4adjustment')));
  if (!gvxFile) return null;
  const gvxText = readFileSync(join(dir, gvxFile), 'utf8');
  const parsed = parseGvx(gvxText, gvxFile);
  const syntax = parseGvxSyntax(gvxText, gvxFile);
  if (!parsed.network || !parsed.source || !syntax.document) return null;
  const groups = groupMarksByName(syntax.document.marks);
  if (groups.mismatch) return null;
  const stations: StationMap = {};
  [...groups.groups.values()].forEach((group) => {
    const fixed = group.name === fixedName;
    stations[group.name] = {
      x: group.x, y: group.y, h: group.z,
      fixed, fixedX: fixed, fixedY: fixed, fixedH: fixed,
    };
  });
  const pointToName = new Map<string, string>();
  [...groups.groups.values()].forEach((group) =>
    group.pointIds.forEach((id) => pointToName.set(id, group.name)),
  );
  const baselines: GnssBaselineObservation[] = parsed.network.baselines.map((b) => ({
    ...b,
    from: pointToName.get(b.from) ?? b.from,
    to: pointToName.get(b.to) ?? b.to,
    ellipsoid: 'WGS84',
  }));
  return {
    stations,
    baselines,
    vectors: baselines.length,
    fixedName,
    gvxFile,
    gvxSha256: createHash('sha256').update(gvxText, 'utf8').digest('hex'),
  };
};

const NET_A = loadIntakeNetwork(INTAKE_A_DIR, 'P041');
const NET_B = loadIntakeNetwork(INTAKE_B_DIR, 'P041');

// ---------------------------------------------------------------------------
// Local minimal gauge + S-transform helpers (translation-only datum defect).
// ---------------------------------------------------------------------------

const SETUP_WGS84 = 'WGS84';
const COORD_PARITY_M = 1e-6;
const STAT_PARITY = 1e-9;

const copyStations = (stations: StationMap): StationMap =>
  Object.fromEntries(Object.entries(stations).map(([id, s]) => [id, { ...s }]));

/** All stations free except `anchor`, held at its apriori coordinate. */
const freeWithAnchor = (apriori: StationMap, anchor: string): StationMap => {
  const stations = copyStations(apriori);
  Object.entries(stations).forEach(([id, station]) => {
    const held = id === anchor;
    station.fixed = held;
    station.fixedX = held;
    station.fixedY = held;
    station.fixedH = held;
  });
  return stations;
};

const pickTempAnchor = (net: IntakeNetwork): string => {
  const names = Object.keys(net.stations).sort();
  const anchor = names.find((name) => name !== net.fixedName);
  if (!anchor) throw new Error('Intake network has no non-datum station for the temp anchor.');
  return anchor;
};

interface LegInput {
  readonly stations: StationMap;
  readonly baselines: GnssBaselineObservation[];
  readonly setup?: GnssSetupUncertainty;
}

const runLeg = (leg: LegInput) =>
  runGnssBaselineAdjustment({
    stations: leg.stations,
    baselines: leg.baselines,
    ...(leg.setup ? { setupUncertainty: leg.setup, ellipsoid: SETUP_WGS84 } : {}),
  });

type AdjustStations = ReturnType<typeof runLeg> extends { stations: infer S } ? S : never;

/** S-transform to the inner datum: remove the per-component mean shift. */
const toInnerDatum = (
  adjusted: AdjustStations,
  apriori: StationMap,
): StationMap => {
  const names = Object.keys(apriori).sort();
  let mx = 0;
  let my = 0;
  let mh = 0;
  names.forEach((name) => {
    mx += (adjusted[name]?.x ?? 0) - (apriori[name]?.x ?? 0);
    my += (adjusted[name]?.y ?? 0) - (apriori[name]?.y ?? 0);
    mh += (adjusted[name]?.h ?? 0) - (apriori[name]?.h ?? 0);
  });
  mx /= names.length;
  my /= names.length;
  mh /= names.length;
  const out: StationMap = {};
  names.forEach((name) => {
    const station = adjusted[name];
    if (!station) return;
    out[name] = { ...station, x: station.x - mx, y: station.y - my, h: station.h - mh };
  });
  return out;
};

/** Rigid translation so `refName` lands on `target`. */
const translateDatumTo = (
  inner: StationMap,
  refName: string,
  target: { x: number; y: number; h: number },
): StationMap => {
  const ref = inner[refName];
  if (!ref) throw new Error(`Datum reference ${refName} missing from free solution.`);
  const dx = target.x - ref.x;
  const dy = target.y - ref.y;
  const dh = target.h - ref.h;
  return Object.fromEntries(
    Object.entries(inner).map(([id, station]) => [
      id,
      { ...station, x: station.x + dx, y: station.y + dy, h: station.h + dh },
    ]),
  );
};

const maxCoordDeltaM = (a: StationMap, b: StationMap): number => {
  let max = 0;
  Object.keys(a).forEach((name) => {
    const sa = a[name];
    const sb = b[name];
    if (!sa || !sb) return;
    max = Math.max(max, Math.abs(sa.x - sb.x), Math.abs(sa.y - sb.y), Math.abs(sa.h - sb.h));
  });
  return max;
};

const scaledDiff = (a: number, b: number): number =>
  Math.abs(a - b) / Math.max(1, Math.abs(a), Math.abs(b));

const SETUP_CASES: { name: string; setup?: GnssSetupUncertainty; expectedSeuw: number }[] = [
  { name: 'A0', setup: undefined, expectedSeuw: 2.100053 },
  { name: 'AC', setup: { horizontalCenteringSigma: 0.005, antennaHeightSigma: 0 }, expectedSeuw: 1.297104 },
  { name: 'AH', setup: { horizontalCenteringSigma: 0, antennaHeightSigma: 0.002 }, expectedSeuw: 1.988831 },
  { name: 'A', setup: { horizontalCenteringSigma: 0.005, antennaHeightSigma: 0.002 }, expectedSeuw: 1.102511 },
];

/** Constrained-vs-free parity for one commercial leg (datum-invariant stats). */
const expectFreeParity = (
  constrained: ReturnType<typeof runLeg>,
  freeGauge: ReturnType<typeof runLeg>,
  apriori: StationMap,
  baselines: GnssBaselineObservation[],
  datumRef: string,
  label: string,
): void => {
  const inner = toInnerDatum(freeGauge.stations, apriori);
  const refTarget = constrained.stations[datumRef];
  if (!refTarget) throw new Error(`${label}: datum reference ${datumRef} missing.`);
  const aligned = translateDatumTo(inner, datumRef, refTarget);
  const coordDelta = maxCoordDeltaM(aligned, constrained.stations);
  expect(coordDelta, `${label}: coords after translation`).toBeLessThan(COORD_PARITY_M);
  expect(constrained.dof, `${label}: dof`).toBe(freeGauge.dof);
  expect(
    Math.abs(constrained.weightedResidualSum - freeGauge.weightedResidualSum)
      / Math.max(1, Math.abs(constrained.weightedResidualSum)),
    `${label}: vTPv`,
  ).toBeLessThan(STAT_PARITY);
  const seuwC = Math.sqrt(constrained.varianceFactor);
  const seuwF = Math.sqrt(freeGauge.varianceFactor);
  expect(Math.abs(seuwC - seuwF), `${label}: seuw`).toBeLessThan(STAT_PARITY);
  expect(constrained.residuals.length, `${label}: residual count`).toBe(freeGauge.residuals.length);
  constrained.residuals.forEach((residual, index) => {
    const other = freeGauge.residuals[index];
    if (!other) throw new Error(`${label}: residual ${index} missing from free run.`);
    expect(residual.baselineId).toBe(other.baselineId);
    expect(Math.abs(residual.vX - other.vX), `${label}: vX ${residual.baselineId}`).toBeLessThan(1e-9);
    expect(Math.abs(residual.vY - other.vY), `${label}: vY ${residual.baselineId}`).toBeLessThan(1e-9);
    expect(Math.abs(residual.vZ - other.vZ), `${label}: vZ ${residual.baselineId}`).toBeLessThan(1e-9);
  });
  expect(constrained.statistics.length, `${label}: statistics count`).toBe(freeGauge.statistics.length);
  constrained.statistics.forEach((stat, index) => {
    const other = freeGauge.statistics[index];
    if (!other) throw new Error(`${label}: statistics ${index} missing from free run.`);
    (['xx', 'xy', 'xz', 'yy', 'yz', 'zz'] as const).forEach((key) => {
      expect(scaledDiff(stat.qvv[key], other.qvv[key]), `${label}: qvv.${key} ${stat.baselineId}`).toBeLessThan(STAT_PARITY);
      expect(scaledDiff(stat.cvv[key], other.cvv[key]), `${label}: cvv.${key} ${stat.baselineId}`).toBeLessThan(STAT_PARITY);
    });
    expect(scaledDiff(stat.redundancy.trace, other.redundancy.trace), `${label}: redundancy ${stat.baselineId}`).toBeLessThan(STAT_PARITY);
    if (stat.blockT !== undefined || other.blockT !== undefined) {
      // blockT = v'Cvv+v via eigendecomposition: sub-1e-9 Cvv/residual
      // differences amplify through near-singular Cvv eigen-directions
      // (observed max relative delta ~4e-7 on commercial legs), so the
      // blockT gate is relative 1e-6; absolute 1e-9 for ~zero blocks.
      const a = stat.blockT ?? 0;
      const b = other.blockT ?? 0;
      const denom = Math.max(Math.abs(a), Math.abs(b));
      if (denom > 1e-9) {
        expect(Math.abs(a - b) / denom, `${label}: blockT ${stat.baselineId}`).toBeLessThan(1e-6);
      } else {
        expect(Math.abs(a - b), `${label}: blockT ${stat.baselineId}`).toBeLessThan(1e-9);
      }
    }
  });
  // Setup orientation comes from apriori coords before the solve, so the
  // free datum must not change it: contributions are bit-identical.
  expect(freeGauge.setupContributions).toEqual(constrained.setupContributions);
  // Loop QC is datum-invariant: recompute every loop closure from each
  // leg's adjusted coordinates (signed edge differences cancel any datum
  // translation). Both legs fit the same observations, so the adjusted
  // closures must agree — this is the non-vacuous check.
  const loopsC = computeGnssLoopClosures(baselines);
  const closeOnStations = (members: readonly { from: string; to: string; sign: 1 | -1 }[], coords: StationMap): [number, number, number] => {
    let x = 0;
    let y = 0;
    let h = 0;
    members.forEach((member) => {
      const from = coords[member.from];
      const to = coords[member.to];
      if (!from || !to) throw new Error(`${label}: loop member station missing.`);
      x += member.sign * (to.x - from.x);
      y += member.sign * (to.y - from.y);
      h += member.sign * (to.h - from.h);
    });
    return [x, y, h];
  };
  loopsC.loops.forEach((loop) => {
    const closureC = closeOnStations(loop.members, constrained.stations);
    const closureF = closeOnStations(loop.members, aligned);
    const delta = Math.max(
      Math.abs(closureC[0] - closureF[0]),
      Math.abs(closureC[1] - closureF[1]),
      Math.abs(closureC[2] - closureF[2]),
    );
    expect(delta, `${label}: adjusted loop closure ${loop.id}`).toBeLessThan(COORD_PARITY_M);
  });
  expect(loopsC.cycleRank, `${label}: cycle rank`).toBeGreaterThan(0);
};

const solveLeg = (net: IntakeNetwork, setup?: GnssSetupUncertainty, anchor?: string) =>
  runLeg({
    stations: anchor ? freeWithAnchor(net.stations, anchor) : copyStations(net.stations),
    baselines: net.baselines,
    ...(setup ? { setup } : {}),
  });

// ---------------------------------------------------------------------------
// Dataset B — ProcessingGNSSBaselines, P041 fixed (constrained pin DOF 129).
// ---------------------------------------------------------------------------

describe.skipIf(!NET_B)('12I.0B dataset B free-network commercial evidence', () => {
  const net = NET_B as IntakeNetwork;
  // Lazy: describe bodies evaluate at collection even when skipIf skips
  // (CI has no vendor intake, so NET_B is null there).
  const anchor = (): string => pickTempAnchor(net);

  it('intake pin: 50 vectors, pre-adjustment GVX', () => {
    expect(net.vectors).toBe(50);
    expect(net.gvxFile).toMatch(/b4adjustment/i);
    console.log(`Dataset B intake: ${net.gvxFile} sha256=${net.gvxSha256} vectors=${net.vectors}`);
  });

  it('constrained P041-fixed production pin: DOF 129, SEUW ~1.965038', () => {
    const constrained = solveLeg(net);
    expect(constrained.dof).toBe(129);
    expect(Math.abs(Math.sqrt(constrained.varianceFactor) - 1.965038)).toBeLessThan(0.001);
    expect(constrained.converged).toBe(true);
  });

  it('free candidate parity after translation (coords <=1e-6, stats <=1e-9)', () => {
    const constrained = solveLeg(net);
    const freeGauge = solveLeg(net, undefined, anchor());
    expectFreeParity(constrained, freeGauge, net.stations, net.baselines, net.fixedName, 'dataset-B');
    console.log(
      `Dataset B free parity: seuw=${Math.sqrt(constrained.varianceFactor).toFixed(6)} ` +
        `dof=${constrained.dof} anchor=${anchor()}`,
    );
  });
});

// ---------------------------------------------------------------------------
// Dataset A — AdjustingtheNetwork, A0/AC/AH/A setup legs (pin DOF 228).
// ---------------------------------------------------------------------------

describe.skipIf(!NET_A)('12I.0B dataset A free-network commercial evidence', () => {
  const net = NET_A as IntakeNetwork;
  // Lazy: see Dataset B block — collection runs even under skipIf.
  const anchor = (): string => pickTempAnchor(net);

  it('intake pin: 91 vectors', () => {
    expect(net.vectors).toBe(91);
    console.log(`Dataset A intake: ${net.gvxFile} sha256=${net.gvxSha256} vectors=${net.vectors}`);
  });

  SETUP_CASES.forEach(({ name, setup, expectedSeuw }) => {
    it(`constrained ${name}: DOF 228, SEUW ~${expectedSeuw}`, () => {
      const constrained = solveLeg(net, setup);
      expect(constrained.dof).toBe(228);
      expect(Math.abs(Math.sqrt(constrained.varianceFactor) - expectedSeuw)).toBeLessThan(0.001);
    });

    it(`free candidate ${name}: parity after translation`, () => {
      const constrained = solveLeg(net, setup);
      const freeGauge = solveLeg(net, setup, anchor());
      expectFreeParity(constrained, freeGauge, net.stations, net.baselines, net.fixedName, `dataset-A-${name}`);
    });
  });
});

// ---------------------------------------------------------------------------
// R2B analysis (§§25-28, assertions only — no R2B production code touched).
//
// Options: A = diag-only Phase12D stats (status quo); B = observed-edge Qij
// extension; C = full-dense Qxx fallback; D = on-demand augmentation of the
// missing row-mean blocks; E = inner-datum reformulation of the statistics.
// RECOMMENDATION: B for blunder ranking now + D/C fallback when a full
// inner-constrained covariance is required. A is INSUFFICIENT in general
// (proven by the missing-block counterexample below). No Phase12D covariance
// transform is needed (gauge-invariance proven by the annihilation tests).
// ---------------------------------------------------------------------------

/** S = I - G(G'G)^-1 G' for pure-translation G (equal-weight inner datum). */
const buildTranslationS = (stationNames: readonly string[]): number[][] => {
  const m = stationNames.length;
  const n = m * 3;
  return Array.from({ length: n }, (_, row) =>
    Array.from({ length: n }, (_, column) => {
      const base = row === column ? 1 : 0;
      return row % 3 === column % 3 ? base - 1 / m : base;
    }),
  );
};

const matMul = (a: number[][], b: number[][]): number[][] =>
  a.map((row) => b[0]!.map((_, column) => row.reduce((sum, value, k) => sum + value * (b[k]?.[column] ?? 0), 0)));

const transpose = (a: number[][]): number[][] =>
  a[0]!.map((_, column) => a.map((row) => row[column] ?? 0));

/** Embed a gauge-run qxx (free-station blocks) into full station space. */
const embedQxxFull = (
  qxx: number[][],
  unknowns: readonly string[],
  stationNames: readonly string[],
): number[][] => {
  const n = stationNames.length * 3;
  const full = Array.from({ length: n }, () => Array.from({ length: n }, () => 0));
  const colOf = (station: string, component: number): number | null => {
    const block = unknowns.indexOf(station);
    return block < 0 ? null : block * 3 + component;
  };
  stationNames.forEach((rowStation, rowBlock) => {
    stationNames.forEach((colStation, colBlock) => {
      for (let component = 0; component < 3; component += 1) {
        for (let other = 0; other < 3; other += 1) {
          const row = colOf(rowStation, component);
          const column = colOf(colStation, other);
          full[rowBlock * 3 + component]![colBlock * 3 + other] =
            row === null || column === null ? 0 : (qxx[row]?.[column] ?? 0);
        }
      }
    });
  });
  return full;
};

/** A_i Q A_i' for baseline endpoints in full station space ([-I +I] rows). */
const baselineQuad = (
  q: number[][],
  stationNames: readonly string[],
  from: string,
  to: string,
): number[][] => {
  const n = stationNames.length * 3;
  const a = Array.from({ length: 3 }, () => Array.from({ length: n }, () => 0));
  const fromBlock = stationNames.indexOf(from);
  const toBlock = stationNames.indexOf(to);
  for (let component = 0; component < 3; component += 1) {
    if (fromBlock >= 0) a[component]![fromBlock * 3 + component] = -1;
    if (toBlock >= 0) a[component]![toBlock * 3 + component] = 1;
  }
  return matMul(matMul(a, q), transpose(a));
};

const maxAbsDiff = (a: number[][], b: number[][]): number => {
  let max = 0;
  a.forEach((row, i) => row.forEach((value, j) => {
    max = Math.max(max, Math.abs(value - (b[i]?.[j] ?? 0)));
  }));
  return max;
};

const BASE_ECEF = { x: -1280000, y: -4720000, h: 4080000 };

/** Minimal 4-station ring; pair A-C is never directly observed. */
const buildRing4 = (fixed: string | null) => {
  const offsets: Record<string, [number, number, number]> = {
    A: [0, 0, 0],
    B: [120, 40, -25],
    C: [200, 150, 30],
    D: [60, 170, -10],
  };
  const stations: StationMap = {};
  Object.entries(offsets).forEach(([id, [dx, dy, dz]]) => {
    const held = id === fixed;
    stations[id] = {
      x: BASE_ECEF.x + dx, y: BASE_ECEF.y + dy, h: BASE_ECEF.h + dz,
      fixed: held, fixedX: held, fixedY: held, fixedH: held,
    };
  });
  const iso = { xx: 25e-6, xy: 0, xz: 0, yy: 25e-6, yz: 0, zz: 25e-6 };
  const pairs: [string, string][] = [['A', 'B'], ['B', 'C'], ['C', 'D'], ['D', 'A']];
  const baselines: GnssBaselineObservation[] = pairs.map(([from, to], index) => {
    const f = stations[from]!;
    const t = stations[to]!;
    return {
      type: 'gnssBaseline' as const,
      id: index + 1,
      from,
      to,
      vector: { x: t.x - f.x, y: t.y - f.y, z: t.h - f.h },
      covariance: { ...iso },
      frame: 'ecef' as const,
    };
  });
  return { stations, baselines };
};

describe('12I.0B R2B gauge analysis (options A-E, assertions only)', () => {
  it('OPTION-PROOF gauge rows annihilate translation: A_i Q_gauge A_i == A_i Q_free A_i (synthetic ring)', () => {
    const names = ['A', 'B', 'C', 'D'];
    const { stations, baselines } = buildRing4('D');
    const gauge = runGnssBaselineAdjustment({ stations, baselines });
    if (!('qxx' in gauge)) throw new Error('Expected dense qxx.');
    const qGauge = embedQxxFull(gauge.qxx, gauge.unknowns, names);
    const s = buildTranslationS(names);
    const qFree = matMul(matMul(s, qGauge), transpose(s));
    baselines.forEach((baseline) => {
      const viaGauge = baselineQuad(qGauge, names, baseline.from, baseline.to);
      const viaFree = baselineQuad(qFree, names, baseline.from, baseline.to);
      const scale = Math.max(1, maxAbsDiff(viaGauge, viaGauge.map((row) => row.map(() => 0))));
      expect(maxAbsDiff(viaGauge, viaFree) / scale).toBeLessThan(STAT_PARITY);
    });
  });

  it('OPTION-PROOF inner-block formula Qfree_ii = Qg_ii - rowMean - colMean + grandMean (synthetic)', () => {
    const names = ['A', 'B', 'C', 'D'];
    const { stations, baselines } = buildRing4('D');
    const gauge = runGnssBaselineAdjustment({ stations, baselines });
    if (!('qxx' in gauge)) throw new Error('Expected dense qxx.');
    const qGauge = embedQxxFull(gauge.qxx, gauge.unknowns, names);
    const s = buildTranslationS(names);
    const qFree = matMul(matMul(s, qGauge), transpose(s));
    const block = (q: number[][], station: string): number[][] => {
      const base = names.indexOf(station) * 3;
      return [0, 1, 2].map((r) => [0, 1, 2].map((c) => q[base + r]?.[base + c] ?? 0));
    };
    const blockAt = (q: number[][], rowStation: string, colStation: string): number[][] => {
      const rowBase = names.indexOf(rowStation) * 3;
      const colBase = names.indexOf(colStation) * 3;
      return [0, 1, 2].map((r) => [0, 1, 2].map((c) => q[rowBase + r]?.[colBase + c] ?? 0));
    };
    const addScaled = (a: number[][], b: number[][], sign: number): number[][] =>
      a.map((row, i) => row.map((value, j) => value + sign * (b[i]?.[j] ?? 0)));
    const meanOver = (pick: (_station: string) => number[][]): number[][] => {
      const acc = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
      names.forEach((other) => {
        const term = pick(other);
        for (let r = 0; r < 3; r += 1) {
          for (let c = 0; c < 3; c += 1) acc[r]![c]! += (term[r]?.[c] ?? 0) / names.length;
        }
      });
      return acc;
    };
    names.forEach((station) => {
      const rowMean = meanOver((other) => blockAt(qGauge, station, other));
      const colMean = meanOver((other) => blockAt(qGauge, other, station));
      let grandMean = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
      names.forEach((rowOther) => {
        const rowPart = meanOver((_colOther) => blockAt(qGauge, rowOther, _colOther));
        grandMean = addScaled(grandMean, rowPart, 1 / names.length);
      });
      const formula = addScaled(addScaled(block(qGauge, station), rowMean, -1), grandMean, 1);
      const formulaDone = addScaled(formula, colMean, -1);
      const scale = Math.max(1, maxAbsDiff(block(qFree, station), [[0, 0, 0], [0, 0, 0], [0, 0, 0]]));
      expect(maxAbsDiff(block(qFree, station), formulaDone) / scale).toBeLessThan(1e-6);
    });
  });

  it('OPTION-VERDICT-A-INSUFFICIENT selected plan (diag + observed-edge) misses unobserved-pair row-mean blocks', () => {
    // 4-station ring: A observes B and D only. The inner-constrained rowMean
    // for A needs Q blocks against EVERY station {B, C, D}; A-C was never
    // observed, so the selected plan cannot supply it.
    const observedNeighbors: Record<string, Set<string>> = {
      A: new Set(['B', 'D']),
      B: new Set(['A', 'C']),
      C: new Set(['B', 'D']),
      D: new Set(['C', 'A']),
    };
    const all = ['A', 'B', 'C', 'D'];
    const plannedPairsFor = (station: string): Set<string> =>
      new Set([station, ...(observedNeighbors[station] ?? [])]);
    const missing = all.filter(
      (station) => station !== 'A' && !plannedPairsFor('A').has(station),
    );
    expect(missing).toEqual(['C']);
    // Numeric insufficiency: zero-filling the missing A-C block changes the
    // rowMean, so diag+observed-edge reconstruction is provably lossy.
    const names = all;
    const { stations, baselines } = buildRing4('D');
    const gauge = runGnssBaselineAdjustment({ stations, baselines });
    if (!('qxx' in gauge)) throw new Error('Expected dense qxx.');
    const qGauge = embedQxxFull(gauge.qxx, gauge.unknowns, names);
    const rowMeanFull = [0, 1, 2].map((r) =>
      [0, 1, 2].map((c) => names.reduce((sum, other) => {
        const base = names.indexOf(other) * 3;
        return sum + (qGauge[names.indexOf('A') * 3 + r]?.[base + c] ?? 0);
      }, 0) / names.length),
    );
    const rowMeanSelected = [0, 1, 2].map((r) =>
      [0, 1, 2].map((c) => [...plannedPairsFor('A')].reduce((sum, other) => {
        const base = names.indexOf(other) * 3;
        return sum + (qGauge[names.indexOf('A') * 3 + r]?.[base + c] ?? 0);
      }, 0) / names.length),
    );
    expect(maxAbsDiff(rowMeanFull, rowMeanSelected)).toBeGreaterThan(1e-12);
  });
});

describe.skipIf(!NET_B)('12I.0B R2B gauge annihilation on Dataset B', () => {
  it('A_i Q_gauge A_i == A_i Q_free A_i (<=1e-9) for every observed vector', () => {
    const net = NET_B as IntakeNetwork;
    const names = Object.keys(net.stations).sort();
    const constrained = solveLeg(net);
    if (!('qxx' in constrained)) throw new Error('Expected dense qxx.');
    const qGauge = embedQxxFull(constrained.qxx, constrained.unknowns, names);
    const s = buildTranslationS(names);
    const qFree = matMul(matMul(s, qGauge), transpose(s));
    let maxDelta = 0;
    net.baselines.forEach((baseline) => {
      const viaGauge = baselineQuad(qGauge, names, baseline.from, baseline.to);
      const viaFree = baselineQuad(qFree, names, baseline.from, baseline.to);
      const scale = Math.max(1, maxAbsDiff(viaGauge, viaGauge.map((row) => row.map(() => 0))));
      const delta = maxAbsDiff(viaGauge, viaFree) / scale;
      maxDelta = Math.max(maxDelta, delta);
      expect(delta).toBeLessThan(STAT_PARITY);
    });
    console.log(`Dataset B R2B gauge-Qvv equality max delta: ${maxDelta.toExponential(3)}`);
  });
});
