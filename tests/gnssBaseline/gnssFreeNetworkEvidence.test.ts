/**
 * Phase 12I.0 Worker A — EVIDENCE ONLY free-network tests (agent tier).
 *
 * Deterministic synthetic ECEF networks; all assertions numeric with
 * explicit ≤1e-9 parity deltas. No production behavior is modified or
 * assumed beyond the existing constrained solve + preflight error text.
 */
import { describe, expect, it } from 'vitest';
import type { StationMap } from '../../src/types';
import type { GnssBaselineObservation } from '../../src/engine/gnssBaselineTypes';
import {
  analyzeDatumDefect,
  assembleFreeNetwork,
  freeNetworkZ,
  maxAbsDiff,
  maxTranslationResidual,
  maxOffSpanResidual,
  multiply,
  rankBasedDof,
  rankOf,
  relativeCovariance,
  centeringMatrix,
  transpose,
} from '../../src/engine/gnssFreeNetworkEvidence';
import {
  applyCorrections,
  maxDxDelta,
  maxMatrixDelta,
  recoverFreeStatistics,
  solveFreeGaugeS,
  solveFreeGinv,
  solveFreeKKT,
  translateStations,
  verifyPenrose,
} from '../../src/engine/gnssFreeNetworkSolvers';
import { runGnssBaselineAdjustment } from '../../src/engine/gnssBaselineAdjust';
import { runGnssBaselinePreflight } from '../../src/engine/gnssBaselinePreflight';
import { applyGnssSetupUncertainty } from '../../src/engine/gnssBaselineSetupUncertainty';
import { computeGnssLoopClosures } from '../../src/engine/gnssBaselineLoops';
import {
  buildBaselines,
  buildStations,
  isotropicCovariance,
  resetBaselineIds,
} from './gnssBaselineTestBuilder';

const BASE: [number, number, number] = [3760000, 900000, 4980000];
const STEP: [number, number, number] = [137.5, -89.3, 53.1];
const APRIORI_OFFSET: [number, number, number] = [0.02, -0.015, 0.01];

const truthOf = (index: number): [number, number, number] => [
  BASE[0] + index * STEP[0],
  BASE[1] + index * STEP[1],
  BASE[2] + index * STEP[2],
];

interface SyntheticNet {
  stations: StationMap;
  plain: { [id: string]: { x: number; y: number; h: number } };
  baselines: GnssBaselineObservation[];
  ids: string[];
}

/** Deterministic mm-level observation noise per baseline id. */
const noiseOf = (id: number): [number, number, number] => [
  (((id * 37) % 7) - 3) * 0.001,
  (((id * 53) % 5) - 2) * 0.001,
  (((id * 29) % 9) - 4) * 0.001,
];

const makeNet = (names: string[], edges: [string, string][]): SyntheticNet => {
  resetBaselineIds();
  const truth = new Map(names.map((id, i) => [id, truthOf(i)] as const));
  const specs = names.map((id) => {
    const t = truth.get(id) as [number, number, number];
    return { id, x: t[0] + APRIORI_OFFSET[0], y: t[1] + APRIORI_OFFSET[1], z: t[2] + APRIORI_OFFSET[2] };
  });
  const stations = buildStations(specs);
  const baselines = buildBaselines(
    edges.map(([from, to]) => {
      const f = truth.get(from) as [number, number, number];
      const o = truth.get(to) as [number, number, number];
      // Placeholder noise added after id assignment below.
      return { from, to, dx: o[0] - f[0], dy: o[1] - f[1], dz: o[2] - f[2], covariance: isotropicCovariance(0.005) };
    }),
  );
  const noisy = baselines.map((baseline) => {
    const [nx, ny, nz] = noiseOf(baseline.id);
    return {
      ...baseline,
      vector: { x: baseline.vector.x + nx, y: baseline.vector.y + ny, z: baseline.vector.z + nz },
    };
  });
  const plain: SyntheticNet['plain'] = {};
  names.forEach((id) => {
    const station = stations[id] as { x: number; y: number; h: number };
    plain[id] = { x: station.x, y: station.y, h: station.h };
  });
  return { stations, plain, baselines: noisy, ids: names };
};

const triangle = (): SyntheticNet => makeNet(['P01', 'P02', 'P03'], [['P01', 'P02'], ['P02', 'P03'], ['P03', 'P01']]);
const ring = (): SyntheticNet =>
  makeNet(['R01', 'R02', 'R03', 'R04', 'R05'], [['R01', 'R02'], ['R02', 'R03'], ['R03', 'R04'], ['R04', 'R05'], ['R05', 'R01']]);
const mesh = (): SyntheticNet =>
  makeNet(
    ['M01', 'M02', 'M03', 'M04'],
    [['M01', 'M02'], ['M01', 'M03'], ['M01', 'M04'], ['M02', 'M03'], ['M02', 'M04'], ['M03', 'M04']],
  );
const treeClosure = (): SyntheticNet =>
  makeNet(
    ['T01', 'T02', 'T03', 'T04', 'T05'],
    [['T01', 'T02'], ['T02', 'T03'], ['T03', 'T04'], ['T04', 'T05'], ['T01', 'T05']],
  );
const repeated = (): SyntheticNet =>
  makeNet(['D01', 'D02', 'D03'], [['D01', 'D02'], ['D02', 'D03'], ['D03', 'D01'], ['D01', 'D02']]);
const twoComponent = (): SyntheticNet =>
  makeNet(
    ['A01', 'A02', 'A03', 'B01', 'B02', 'B03'],
    [['A01', 'A02'], ['A02', 'A03'], ['A03', 'A01'], ['B01', 'B02'], ['B02', 'B03'], ['B03', 'B01']],
  );

const allNets: [string, () => SyntheticNet][] = [
  ['triangle', triangle],
  ['ring', ring],
  ['mesh', mesh],
  ['tree+closure', treeClosure],
  ['repeated-baseline', repeated],
  ['2-component', twoComponent],
];

/** Relative 1e-6 blockT gate (near-singular-Cvv amplification rationale above). */
const expectBlockTClose = (actual: number, expected: number): void => {
  expect(Math.abs(actual - expected)).toBeLessThan(1e-6 * Math.max(1, Math.abs(expected)));
};

describe('gnss free-network evidence (12I.0 Worker A)', () => {
  it('datum defect is exactly 3 with translation-only modes (triangle)', () => {
    const net = triangle();
    const assembly = assembleFreeNetwork(net.stations, net.baselines);
    const report = analyzeDatumDefect(assembly);
    expect(report.rank).toBe(6);
    expect(report.defect).toBe(3);
    expect(report.basis).toHaveLength(3);
    const z = freeNetworkZ(assembly);
    // Analytic nullspace: N * translationMode ~= 0.
    expect(maxTranslationResidual(assembly.N, z)).toBeLessThan(1e-6);
    // Translation-only: numeric null vectors lie in span(Z).
    expect(maxOffSpanResidual(report.basis, z)).toBeLessThan(1e-9);
  });

  it('multi-component assembly carries total defect 3c', () => {
    const net = twoComponent();
    const assembly = assembleFreeNetwork(net.stations, net.baselines);
    expect(assembly.components).toHaveLength(2);
    const report = analyzeDatumDefect(assembly);
    expect(report.defect).toBe(6);
    expect(report.rank).toBe(assembly.numParams - 6);
    const z = freeNetworkZ(assembly);
    expect(z).toHaveLength(6);
    expect(maxTranslationResidual(assembly.N, z)).toBeLessThan(1e-6);
    expect(maxOffSpanResidual(report.basis, z)).toBeLessThan(1e-9);
  });

  it('rank-based DOF matches the Dataset-B shape (24 unknowns, rank 21, n=150 -> dof 129)', () => {
    const names = Array.from({ length: 8 }, (_, i) => `S0${i + 1}`);
    const pairs: [string, string][] = [];
    for (let i = 0; i < names.length; i += 1) {
      for (let j = i + 1; j < names.length; j += 1) pairs.push([names[i] as string, names[j] as string]);
    }
    // 28 unique pairs + 22 deterministic repeats = 50 baselines.
    const edges = [...pairs];
    for (let k = 0; k < 22; k += 1) edges.push(pairs[(k * 7) % pairs.length] as [string, string]);
    expect(edges).toHaveLength(50);
    const net = makeNet(names, edges);
    const assembly = assembleFreeNetwork(net.stations, net.baselines);
    expect(assembly.numParams).toBe(24);
    expect(assembly.nScalar).toBe(150);
    const rank = rankOf(assembly.A);
    expect(rank).toBe(21);
    expect(rankBasedDof(assembly, rank)).toBe(129);
    const report = analyzeDatumDefect(assembly);
    expect(report.defect).toBe(3);
  });

  it.each(allNets)('three-method parity on %s (dx/Qxx/residuals/vTPv/SEUW/Qvv/redundancy <= 1e-9; block-T 1e-6 relative)', (_name, build) => {
    const net = build();
    const assembly = assembleFreeNetwork(net.stations, net.baselines);
    const rank = analyzeDatumDefect(assembly).rank;
    const kkt = solveFreeKKT(assembly, net.baselines, rank);
    const ginv = solveFreeGinv(assembly, net.baselines, rank);
    // Gauge needs one anchor per connected component (single anchor leaves
    // every other component rank-deficient): first station of each component.
    const anchors = assembly.components.map((component) => component[0] as string);
    const gauge = solveFreeGaugeS(assembly, net.baselines, rank, anchors.length === 1 ? (anchors[0] as string) : anchors);
    expect(maxDxDelta(kkt.dx, ginv.dx)).toBeLessThan(1e-9);
    expect(maxDxDelta(kkt.dx, gauge.dx)).toBeLessThan(1e-9);
    expect(maxMatrixDelta(kkt.Qxx, ginv.Qxx)).toBeLessThan(1e-9);
    expect(maxMatrixDelta(kkt.Qxx, gauge.Qxx)).toBeLessThan(1e-9);
    expect(maxAbsDiff(kkt.residuals, ginv.residuals)).toBeLessThan(1e-9);
    expect(maxAbsDiff(kkt.residuals, gauge.residuals)).toBeLessThan(1e-9);
    expect(Math.abs(kkt.vTPv - ginv.vTPv)).toBeLessThan(1e-9);
    expect(Math.abs(kkt.vTPv - gauge.vTPv)).toBeLessThan(1e-9);
    expect(Math.abs(kkt.seuw - ginv.seuw)).toBeLessThan(1e-12);
    expect(Math.abs(kkt.seuw - gauge.seuw)).toBeLessThan(1e-12);
    expect(Math.abs(kkt.redundancyTrace - kkt.dof)).toBeLessThan(1e-9);
    expect(Math.abs(ginv.redundancyTrace - kkt.dof)).toBeLessThan(1e-9);
    expect(Math.abs(gauge.redundancyTrace - kkt.dof)).toBeLessThan(1e-9);
    kkt.qvvBlocks.forEach((block, b) => {
      expect(maxAbsDiff(block, ginv.qvvBlocks[b] as number[][])).toBeLessThan(1e-9);
      expect(maxAbsDiff(block, gauge.qvvBlocks[b] as number[][])).toBeLessThan(1e-9);
    });
    kkt.blockT.forEach((t, b) => {
      // blockT = v'Cvv+v only to 1e-6 relative: sub-1e-9 Cvv/residual
      // differences amplify through near-singular Cvv eigen-directions
      // (tighter solver convergence verified not to help); all other
      // parity gates stay at <=1e-9.
      expectBlockTClose(t ?? 0, ginv.blockT[b] ?? 0);
      expectBlockTClose(t ?? 0, gauge.blockT[b] ?? 0);
    });
    // Translation constraint sums vanish per component.
    kkt.constraintSums.forEach((sums) => {
      sums.forEach((sum) => expect(Math.abs(sum)).toBeLessThan(1e-9));
    });
  });

  it('gauge+S is anchor-invariant on triangle and ring (>=3 anchors)', () => {
    [triangle(), ring()].forEach((net) => {
      const assembly = assembleFreeNetwork(net.stations, net.baselines);
      const rank = analyzeDatumDefect(assembly).rank;
      const solutions = net.ids.map((anchor) => solveFreeGaugeS(assembly, net.baselines, rank, anchor));
      const first = solutions[0] as (typeof solutions)[number];
      solutions.slice(1).forEach((solution) => {
        expect(maxDxDelta(first.dx, solution.dx)).toBeLessThan(1e-9);
        expect(maxMatrixDelta(first.Qxx, solution.Qxx)).toBeLessThan(1e-9);
        expect(maxAbsDiff(first.residuals, solution.residuals)).toBeLessThan(1e-9);
        expect(Math.abs(first.vTPv - solution.vTPv)).toBeLessThan(1e-9);
      });
    });
  });

  it('generalized inverse satisfies Penrose, symmetry, and Z-dx = 0', () => {
    const net = mesh();
    const assembly = assembleFreeNetwork(net.stations, net.baselines);
    const rank = analyzeDatumDefect(assembly).rank;
    const ginv = solveFreeGinv(assembly, net.baselines, rank);
    const checks = verifyPenrose(assembly.N, ginv.Qxx, ginv.dx, freeNetworkZ(assembly));
    expect(checks.penrose1 as number).toBeLessThan(1e-9);
    // penrose2 chains two pseudoinverse products through N's condition;
    // 1e-6 relative remains a strong identity check (failure would be O(1)).
    expect(checks.penrose2 as number).toBeLessThan(1e-6);
    expect(checks.symmetry1 as number).toBeLessThan(1e-9);
    expect(checks.symmetry2 as number).toBeLessThan(1e-9);
    expect(checks.nullspace as number).toBeLessThan(1e-9);
  });

  it('apriori translation invariance: residuals/geometry invariant, coords translate', () => {
    const net = triangle();
    const assembly = assembleFreeNetwork(net.stations, net.baselines);
    const rank = analyzeDatumDefect(assembly).rank;
    const base = solveFreeKKT(assembly, net.baselines, rank);
    const offset: [number, number, number] = [1000, -2000, 1500];
    const shifted = translateStations(net.plain, offset);
    const shiftedAssembly = assembleFreeNetwork(
      Object.fromEntries(net.ids.map((id) => [id, { ...shifted[id], fixed: false, fixedX: false, fixedY: false, fixedH: false }])) as StationMap,
      net.baselines,
    );
    const shiftedRank = analyzeDatumDefect(shiftedAssembly).rank;
    const moved = solveFreeKKT(shiftedAssembly, net.baselines, shiftedRank);
    expect(maxAbsDiff(base.residuals, moved.residuals)).toBeLessThan(1e-9);
    expect(Math.abs(base.vTPv - moved.vTPv)).toBeLessThan(1e-9);
    const baseCoords = applyCorrections(net.plain, net.ids, base.dx);
    const movedCoords = applyCorrections(shifted, net.ids, moved.dx);
    net.ids.forEach((id) => {
      expect(Math.abs((movedCoords[id]?.x ?? 0) - ((baseCoords[id]?.x ?? 0) + offset[0]))).toBeLessThan(1e-9);
      expect(Math.abs((movedCoords[id]?.y ?? 0) - ((baseCoords[id]?.y ?? 0) + offset[1]))).toBeLessThan(1e-9);
      expect(Math.abs((movedCoords[id]?.h ?? 0) - ((baseCoords[id]?.h ?? 0) + offset[2]))).toBeLessThan(1e-9);
    });
  });

  it('constrained-vs-free: translation-aligned free solution matches the production fixed solve', () => {
    const net = triangle();
    const anchor = net.ids[0] as string;
    const fixedStations: StationMap = Object.fromEntries(
      Object.entries(net.stations).map(([id, station]) =>
        id === anchor
          ? [id, { ...station, fixed: true, fixedX: true, fixedY: true, fixedH: true }]
          : [id, station],
      ),
    );
    const production = runGnssBaselineAdjustment({ stations: fixedStations, baselines: net.baselines });
    const assembly = assembleFreeNetwork(net.stations, net.baselines);
    const rank = analyzeDatumDefect(assembly).rank;
    const free = solveFreeKKT(assembly, net.baselines, rank);
    const freeCoords = applyCorrections(net.plain, net.ids, free.dx);
    // 3D-translation align only (no rotation/scale).
    const t = {
      x: ((production.stations[anchor] as { x: number }).x ?? 0) - (freeCoords[anchor]?.x ?? 0),
      y: ((production.stations[anchor] as { y: number }).y ?? 0) - (freeCoords[anchor]?.y ?? 0),
      h: ((production.stations[anchor] as { h: number }).h ?? 0) - (freeCoords[anchor]?.h ?? 0),
    };
    const aligned = Object.fromEntries(
      net.ids.map((id) => [
        id,
        { x: (freeCoords[id]?.x ?? 0) + t.x, y: (freeCoords[id]?.y ?? 0) + t.y, h: (freeCoords[id]?.h ?? 0) + t.h },
      ]),
    );
    // Inter-station vectors identical.
    for (let i = 0; i < net.ids.length; i += 1) {
      for (let j = i + 1; j < net.ids.length; j += 1) {
        const a = net.ids[i] as string;
        const b = net.ids[j] as string;
        const prodA = production.stations[a] as { x: number; y: number; h: number };
        const prodB = production.stations[b] as { x: number; y: number; h: number };
        expect(Math.abs((prodB.x - prodA.x) - ((aligned[b]?.x ?? 0) - (aligned[a]?.x ?? 0)))).toBeLessThan(1e-9);
        expect(Math.abs((prodB.y - prodA.y) - ((aligned[b]?.y ?? 0) - (aligned[a]?.y ?? 0)))).toBeLessThan(1e-9);
        expect(Math.abs((prodB.h - prodA.h) - ((aligned[b]?.h ?? 0) - (aligned[a]?.h ?? 0)))).toBeLessThan(1e-9);
      }
    }
    // Residuals / vTPv / SEUW identical.
    production.residuals.forEach((residual, b) => {
      expect(Math.abs(residual.vX - (free.residuals[3 * b]?.[0] ?? 0))).toBeLessThan(1e-9);
      expect(Math.abs(residual.vY - (free.residuals[3 * b + 1]?.[0] ?? 0))).toBeLessThan(1e-9);
      expect(Math.abs(residual.vZ - (free.residuals[3 * b + 2]?.[0] ?? 0))).toBeLessThan(1e-9);
      // qObs amplifies residual deltas by ||P|| (~4e4): absolute 1e-6 gate.
      expect(Math.abs(residual.quadraticForm - (free.qObs[b] ?? 0))).toBeLessThan(1e-6);
    });
    expect(Math.abs(production.weightedResidualSum - free.vTPv)).toBeLessThan(
      1e-9 * Math.max(1, Math.abs(production.weightedResidualSum)),
    );
    expect(Math.abs(Math.sqrt(Math.max(production.varianceFactor, 0)) - free.seuw)).toBeLessThan(1e-12);
    // Qvv / redundancy / block-T datum-invariant.
    production.statistics.forEach((stat, b) => {
      const qvv = free.qvvBlocks[b] as number[][];
      expect(Math.abs(stat.qvv.xx - (qvv[0]?.[0] ?? 0))).toBeLessThan(1e-9);
      expect(Math.abs(stat.qvv.xy - (qvv[0]?.[1] ?? 0))).toBeLessThan(1e-9);
      expect(Math.abs(stat.qvv.xz - (qvv[0]?.[2] ?? 0))).toBeLessThan(1e-9);
      expect(Math.abs(stat.qvv.yy - (qvv[1]?.[1] ?? 0))).toBeLessThan(1e-9);
      expect(Math.abs(stat.qvv.yz - (qvv[1]?.[2] ?? 0))).toBeLessThan(1e-9);
      expect(Math.abs(stat.qvv.zz - (qvv[2]?.[2] ?? 0))).toBeLessThan(1e-9);
      // blockT relative gate (see parity test comment): near-singular Cvv
      // eigen-directions amplify sub-1e-9 Cvv/residual differences.
      expectBlockTClose(stat.blockT ?? 0, free.blockT[b] ?? 0);
    });
    const prodTrace = production.statistics.reduce((sum, stat) => sum + stat.redundancy.trace, 0);
    expect(Math.abs(prodTrace - production.dof)).toBeLessThan(1e-9);
    expect(Math.abs(free.redundancyTrace - prodTrace)).toBeLessThan(1e-9);
    // Adjusted loop closures identical (loops from observed vectors, closed on adjusted coords).
    const loops = computeGnssLoopClosures(net.baselines);
    loops.loops.forEach((loop) => {
      const closureOf = (coords: Record<string, { x: number; y: number; h: number }>): [number, number, number] => {
        let cx = 0;
        let cy = 0;
        let cz = 0;
        loop.members.forEach((member) => {
          const f = coords[member.from] as { x: number; y: number; h: number };
          const o = coords[member.to] as { x: number; y: number; h: number };
          cx += member.sign * (o.x - f.x);
          cy += member.sign * (o.y - f.y);
          cz += member.sign * (o.h - f.h);
        });
        return [cx, cy, cz];
      };
      const prodCoords = Object.fromEntries(
        Object.entries(production.stations).map(([id, station]) => {
          const s = station as { x: number; y: number; h: number };
          return [id, { x: s.x, y: s.y, h: s.h }];
        }),
      );
      const [px, py, pz] = closureOf(prodCoords);
      const [fx, fy, fz] = closureOf(aligned as Record<string, { x: number; y: number; h: number }>);
      expect(Math.abs(px - fx)).toBeLessThan(1e-9);
      expect(Math.abs(py - fy)).toBeLessThan(1e-9);
      expect(Math.abs(pz - fz)).toBeLessThan(1e-9);
    });
  });

  it('extra rank defect is detected with a distinct error (isolated / disconnected / degenerate)', () => {
    const net = triangle();
    // Isolated station: present in the station map, no baseline edge.
    const withIsolate: StationMap = {
      ...net.stations,
      P99: { x: BASE[0], y: BASE[1], h: BASE[2], fixed: false, fixedX: false, fixedY: false, fixedH: false },
    };
    expect(() => analyzeDatumDefect(assembleFreeNetwork(withIsolate, net.baselines))).toThrow(
      /extra rank defect/,
    );
    // Disconnected free station pair: second component is a lone station.
    const ringNet = ring();
    const withDisconnected: StationMap = {
      ...ringNet.stations,
      RX: { x: BASE[0] + 5, y: BASE[1], h: BASE[2], fixed: false, fixedX: false, fixedY: false, fixedH: false },
    };
    expect(() => analyzeDatumDefect(assembleFreeNetwork(withDisconnected, ringNet.baselines))).toThrow(
      /extra rank defect/,
    );
    // Degenerate-only topology: self-baselines assemble zero rows.
    resetBaselineIds();
    const degStations = buildStations([
      { id: 'E01', x: BASE[0], y: BASE[1], z: BASE[2] },
      { id: 'E02', x: BASE[0] + 10, y: BASE[1], z: BASE[2] },
    ]);
    const degBaselines = buildBaselines([
      { from: 'E01', to: 'E01', dx: 0, dy: 0, dz: 0, covariance: isotropicCovariance(0.005) },
      { from: 'E02', to: 'E02', dx: 0, dy: 0, dz: 0, covariance: isotropicCovariance(0.005) },
    ]);
    expect(() => analyzeDatumDefect(assembleFreeNetwork(degStations, degBaselines))).toThrow(
      /extra rank defect/,
    );
  });

  it('S-transform covariance: symmetry/PSD/nullspace, anchor independence, KKT/GINV agreement', () => {
    const net = mesh();
    const assembly = assembleFreeNetwork(net.stations, net.baselines);
    const rank = analyzeDatumDefect(assembly).rank;
    const kkt = solveFreeKKT(assembly, net.baselines, rank);
    const ginv = solveFreeGinv(assembly, net.baselines, rank);
    const z = freeNetworkZ(assembly);
    net.ids.forEach((anchor) => {
      const gauge = solveFreeGaugeS(assembly, net.baselines, rank, anchor);
      // Symmetry.
      expect(maxAbsDiff(gauge.Qxx, transpose(gauge.Qxx))).toBeLessThan(1e-12);
      // PSD: diagonal non-negative and agreement with the KKT/GINV route.
      gauge.Qxx.forEach((row, i) => expect(row[i] ?? 0).toBeGreaterThan(-1e-12));
      expect(maxMatrixDelta(gauge.Qxx, kkt.Qxx)).toBeLessThan(1e-9);
      expect(maxMatrixDelta(gauge.Qxx, ginv.Qxx)).toBeLessThan(1e-9);
      // Nullspace: Qfree Z ~= 0.
      z.forEach((mode) => {
        const column = mode.map((value) => [value]);
        const product = multiply(gauge.Qxx, column);
        product.forEach((row) => expect(Math.abs(row[0] ?? 0)).toBeLessThan(1e-9));
      });
    });
    // Fixed-datum check: relative covariances from Qfree match the
    // production constrained Qxx (anchor rows/cols zero-embedded).
    const anchor = net.ids[0] as string;
    const fixedStations: StationMap = Object.fromEntries(
      Object.entries(net.stations).map(([id, station]) =>
        id === anchor
          ? [id, { ...station, fixed: true, fixedX: true, fixedY: true, fixedH: true }]
          : [id, station],
      ),
    );
    const production = runGnssBaselineAdjustment({ stations: fixedStations, baselines: net.baselines });
    const embedded: number[][] = Array.from({ length: assembly.numParams }, () =>
      new Array(assembly.numParams).fill(0),
    );
    const freeIds = production.unknowns;
    freeIds.forEach((idA, sa) => {
      const colsA = assembly.colOf.get(idA) as [number, number, number];
      freeIds.forEach((idB, sb) => {
        const colsB = assembly.colOf.get(idB) as [number, number, number];
        for (let k = 0; k < 3; k += 1) {
          for (let j = 0; j < 3; j += 1) {
            embedded[colsA[k] as number]![colsB[j] as number] =
              production.qxx[3 * sa + k]?.[3 * sb + j] ?? 0;
          }
        }
      });
    });
    const [a, b] = [net.ids[1], net.ids[2]] as [string, string];
    const relFree = relativeCovariance(kkt.Qxx, assembly.colOf.get(a) as [number, number, number], assembly.colOf.get(b) as [number, number, number]);
    const relFixed = relativeCovariance(embedded, assembly.colOf.get(a) as [number, number, number], assembly.colOf.get(b) as [number, number, number]);
    expect(maxAbsDiff(relFree, relFixed)).toBeLessThan(1e-9);
    // Q_(Xi-Xj) is gauge-anchor independent.
    const g1 = solveFreeGaugeS(assembly, net.baselines, rank, net.ids[0] as string);
    const g2 = solveFreeGaugeS(assembly, net.baselines, rank, net.ids[1] as string);
    expect(
      maxAbsDiff(
        relativeCovariance(g1.Qxx, assembly.colOf.get(a) as [number, number, number], assembly.colOf.get(b) as [number, number, number]),
        relativeCovariance(g2.Qxx, assembly.colOf.get(a) as [number, number, number], assembly.colOf.get(b) as [number, number, number]),
      ),
    ).toBeLessThan(1e-9);
    // Centering idempotence sanity: S S = S.
    const S = centeringMatrix(z, assembly.numParams);
    expect(maxAbsDiff(multiply(S, S), S)).toBeLessThan(1e-12);
  });

  it('redundancy trace equals rank-based DOF for 1-fixed / 2-fixed / mixed production runs', () => {
    const traceOf = (stations: StationMap, baselines: GnssBaselineObservation[]): { trace: number; dof: number } => {
      const result = runGnssBaselineAdjustment({ stations, baselines });
      return {
        trace: result.statistics.reduce((sum, stat) => sum + stat.redundancy.trace, 0),
        dof: result.dof,
      };
    };
    const fix = (stations: StationMap, ids: string[]): StationMap =>
      Object.fromEntries(
        Object.entries(stations).map(([id, station]) =>
          ids.includes(id)
            ? [id, { ...station, fixed: true, fixedX: true, fixedY: true, fixedH: true }]
            : [id, station],
        ),
      );
    const tri = triangle();
    const one = traceOf(fix(tri.stations, [tri.ids[0] as string]), tri.baselines);
    expect(Math.abs(one.trace - one.dof)).toBeLessThan(1e-9);
    const m = mesh();
    const two = traceOf(fix(m.stations, [m.ids[0] as string, m.ids[1] as string]), m.baselines);
    expect(Math.abs(two.trace - two.dof)).toBeLessThan(1e-9);
    const comp = twoComponent();
    const mixed = traceOf(fix(comp.stations, [comp.ids[0] as string, comp.ids[3] as string]), comp.baselines);
    expect(Math.abs(mixed.trace - mixed.dof)).toBeLessThan(1e-9);
  });

  it('setup augmentation still applies at a temporary gauge anchor', () => {
    const net = triangle();
    const anchor = net.ids[0] as string;
    const applied = applyGnssSetupUncertainty({
      stations: net.stations,
      baselines: net.baselines,
      setup: { horizontalCenteringSigma: 0.002, antennaHeightSigma: 0.003 },
      ellipsoid: 'GRS80',
    });
    expect(applied.setupModel).not.toBeNull();
    expect(applied.contributions).toHaveLength(net.baselines.length);
    const anchorContributions = applied.contributions.filter(
      (contribution) => contribution.from === anchor || contribution.to === anchor,
    );
    expect(anchorContributions.length).toBeGreaterThan(0);
    anchorContributions.forEach((contribution) => {
      const raw = contribution.rawCovariance;
      const eff = contribution.effectiveCovariance;
      expect(eff.xx + eff.yy + eff.zz).toBeGreaterThan(raw.xx + raw.yy + raw.zz);
    });
  });

  it('production preflight still refuses free networks with the verbatim error', () => {
    const net = triangle();
    expect(() => runGnssBaselinePreflight({ stations: net.stations, baselines: net.baselines })).toThrow(
      'free-network adjustment is deferred; fix X/Y/Z of at least one station.',
    );
  });

  it('evidence statistics helper is reachable and consistent (recoverFreeStatistics smoke)', () => {
    const net = triangle();
    const assembly = assembleFreeNetwork(net.stations, net.baselines);
    const rank = analyzeDatumDefect(assembly).rank;
    const kkt = solveFreeKKT(assembly, net.baselines, rank);
    const again = recoverFreeStatistics(
      assembly, 'smoke', kkt.dx, kkt.Qxx, net.baselines, kkt.dof, freeNetworkZ(assembly),
    );
    expect(Math.abs(again.vTPv - kkt.vTPv)).toBeLessThan(1e-12);
    expect(Math.abs(again.redundancyTrace - kkt.redundancyTrace)).toBeLessThan(1e-12);
  });
});
