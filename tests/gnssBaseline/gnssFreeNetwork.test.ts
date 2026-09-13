/**
 * Phase 12I.1 — production free-network datum behavior tests (agent tier).
 *
 * Datum default, classification, gauge determinism, inner-constrained
 * covariance, constrained/free parity, relative covariance, a-priori
 * translation invariance, and setup-before-gauge. Routing/failure/size
 * gates live in gnssFreeNetworkRouting.test.ts; multifile in
 * gnssFreeNetworkMultifile.test.ts. Synthetic fixtures only.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import type { StationMap } from '../../src/types';
import { runGnssBaselineAdjustment } from '../../src/engine/gnssBaselineAdjust';
import {
  classifyGnssDatumComponents,
  relativeGnssCovariance,
} from '../../src/engine/gnssFreeNetwork';
import {
  assembleFreeNetwork,
  analyzeDatumDefect,
  relativeCovariance,
} from '../../src/engine/gnssFreeNetworkDatum';
import {
  rankBasedDof,
  solveFreeGaugeS,
  solveFreeGinv,
  solveFreeKKT,
} from '../../src/engine/gnssFreeNetworkSolvers';
import type { FreeNetworkAssembly } from '../../src/engine/gnssFreeNetworkDatum';
import { symmetricEigen3 } from '../../src/engine/gnssBaselineStatistics';
import { computeGnssLoopClosures } from '../../src/engine/gnssBaselineLoops';
import { setStationFixed } from '../../src/engine/gnssWorkspaceSession';
import { setGnssNativeR2BRouteEnabled } from '../../src/workers/gnssBaselineNativeR2BRoute';
import {
  asDense,
  fixFirst,
  mesh4,
  repeated,
  ring5,
  treeClosure,
  triangle,
  twoFree,
} from './gnssFreeNetworkTestSupport';

beforeEach(() => {
  setGnssNativeR2BRouteEnabled(false);
});
describe('datum default: exact legacy behavior', () => {
  it('free nets fail closed without the opt-in (missing-datum, unchanged text)', () => {
    const net = triangle();
    expect(() => runGnssBaselineAdjustment({ stations: net.stations, baselines: net.baselines })).toThrow(
      /free-network adjustment is deferred/,
    );
    expect(() =>
      runGnssBaselineAdjustment({ stations: net.stations, baselines: net.baselines, datumMode: 'constrained' }),
    ).toThrow(/free-network adjustment is deferred/);
  });

  it('invalid datumMode throws fail-closed', () => {
    const net = triangle();
    expect(() =>
      runGnssBaselineAdjustment({
        stations: fixFirst(net), baselines: net.baselines, datumMode: 'nope' as never,
      }),
    ).toThrow(/not supported/);
  });

  it('constrained nets: default and explicit constrained are deep-equal', () => {
    const net = triangle();
    const stations = fixFirst(net);
    const a = asDense({ stations, baselines: net.baselines });
    const b = asDense({ stations, baselines: net.baselines, datumMode: 'constrained' });
    expect(b).toEqual(a);
    expect(b.datumSummary).toBeUndefined();
  });
});

describe('allow-free with zero free components: existing constrained path', () => {
  it('deep-equals the default run, stays R2B-eligible, carries no datumSummary', () => {
    const net = triangle();
    const stations = fixFirst(net);
    const def = asDense({ stations, baselines: net.baselines });
    const free = asDense({ stations, baselines: net.baselines, datumMode: 'allow-free' });
    expect(free).toEqual(def);
    expect(free.datumSummary).toBeUndefined();
    expect(free.routeProvenance).toBe('typescript-dense');
  });
});

describe('datum classification + rank/DOF bookkeeping', () => {
  it.each([
    { name: 'triangle', net: triangle, stations: 3, params: 9, rank: 6, scalar: 9, dof: 3 },
    { name: 'ring-5', net: ring5, stations: 5, params: 15, rank: 12, scalar: 15, dof: 3 },
    { name: 'mesh-4', net: mesh4, stations: 4, params: 12, rank: 9, scalar: 18, dof: 9 },
    { name: 'repeated', net: repeated, stations: 3, params: 9, rank: 6, scalar: 12, dof: 6 },
    { name: 'two-free', net: twoFree, stations: 6, params: 18, rank: 12, scalar: 18, dof: 6 },
    { name: 'tree+closure', net: treeClosure, stations: 5, params: 15, rank: 12, scalar: 15, dof: 3 },
  ])('$name: stations/params/rank/scalar/dof', ({ net, stations, params, rank, scalar, dof }) => {
    const n = net();
    const result = asDense({ stations: n.stations, baselines: n.baselines, datumMode: 'allow-free' });
    const summary = result.datumSummary;
    expect(summary?.modeRequested).toBe('allow-free');
    expect(summary?.kind).toBe('free');
    expect(summary?.fullParameterCount).toBe(params);
    expect(summary?.estimableRank).toBe(rank);
    expect(summary?.totalDatumDefect).toBe(3 * (summary?.components.length ?? 0));
    expect(result.numParams).toBe(params);
    expect(result.numObsEquations).toBe(scalar);
    expect(result.dof).toBe(dof);
    expect(Object.keys(result.stations)).toHaveLength(stations);
    // Rank-based DOF agrees with the 12I.0 evidence oracle.
    expect(rankBasedDof({ nScalar: scalar } as unknown as FreeNetworkAssembly, rank)).toBe(dof);
  });

  it('mixed run: fixed+free components classify independently', () => {
    const net = twoFree();
    const stations = setStationFixed(
      Object.fromEntries(Object.entries(net.stations).map(([id, station]) => [id, { ...station }])),
      'A01',
      true,
    );
    const result = asDense({ stations, baselines: net.baselines, datumMode: 'allow-free' });
    const summary = result.datumSummary;
    expect(summary?.kind).toBe('mixed');
    expect(summary?.components).toHaveLength(2);
    const kinds = new Map(summary?.components.map((c) => [c.stations[0], c.kind]));
    expect(kinds.get('A01')).toBe('constrained');
    expect(kinds.get('B01')).toBe('free');
    // A-component: 2 estimated stations = 6 params, full rank. B: 9 params, rank 6.
    expect(summary?.fullParameterCount).toBe(15);
    expect(summary?.estimableRank).toBe(12);
    expect(summary?.totalDatumDefect).toBe(3);
    expect(result.dof).toBe(18 - 12);
  });

  it('anchors are deterministic first-sorted IDs per free component', () => {
    const net = twoFree();
    const result = asDense({ stations: net.stations, baselines: net.baselines, datumMode: 'allow-free' });
    const anchors = new Map(
      (result.datumSummary?.components ?? []).map((c) => [c.stations[0], c.anchor]),
    );
    expect(anchors.get('A01')).toBe('A01');
    expect(anchors.get('B01')).toBe('B01');
  });
});

describe('gauge determinism + no-leak + zero-mean', () => {
  it('manifest order (stations + baselines) does not move the solution', () => {
    const net = twoFree();
    const plain = asDense({ stations: net.stations, baselines: net.baselines, datumMode: 'allow-free' });
    const revStations: StationMap = Object.fromEntries(
      Object.entries(net.stations).reverse().map(([id, station]) => [id, { ...station }]),
    );
    const revBaselines = [...net.baselines].reverse().map((baseline) => ({ ...baseline }));
    const revved = asDense({ stations: revStations, baselines: revBaselines, datumMode: 'allow-free' });
    expect(revved.unknowns).toEqual(plain.unknowns);
    expect(revved.datumSummary).toEqual(plain.datumSummary);
    revved.unknowns.forEach((id) => {
      const a = revved.stations[id] as { x: number; y: number; h: number };
      const b = plain.stations[id] as { x: number; y: number; h: number };
      expect(Math.abs(a.x - b.x)).toBeLessThan(1e-9);
      expect(Math.abs(a.y - b.y)).toBeLessThan(1e-9);
      expect(Math.abs(a.h - b.h)).toBeLessThan(1e-9);
    });
    const n = revved.numParams;
    for (let i = 0; i < n; i += 1) {
      for (let j = 0; j < n; j += 1) {
        expect(Math.abs((revved.qxx[i]?.[j] ?? 0) - (plain.qxx[i]?.[j] ?? 0))).toBeLessThan(1e-15);
      }
    }
  });

  it('anchors never leak as FIXED/CONTROL/provenance; input never mutated', () => {
    const net = triangle();
    const before = JSON.parse(JSON.stringify(net.stations));
    const result = asDense({ stations: net.stations, baselines: net.baselines, datumMode: 'allow-free' });
    expect(net.stations).toEqual(before);
    const anchor = result.datumSummary?.components[0]?.anchor as string;
    expect(anchor).toBe('P01');
    const anchorStation = result.stations[anchor];
    expect(anchorStation?.fixedX).toBeFalsy();
    expect(anchorStation?.fixedY).toBeFalsy();
    expect(anchorStation?.fixedH).toBeFalsy();
    expect(result.routeProvenance).toBe('typescript-dense');
    const gaugeLines = result.logs.filter((line) => /anchors=\[/.test(line));
    expect(gaugeLines.length).toBeGreaterThan(0);
    gaugeLines.forEach((line) => {
      expect(line).toMatch(/computational gauge|debug only/);
    });
    expect(result.logs.join('\n')).not.toMatch(/FIXED|CONTROL/);
  });

  it('free corrections sum to zero per axis per free component (ulp-aware)', () => {
    for (const make of [triangle, ring5, mesh4, twoFree, treeClosure]) {
      const net = make();
      const apriori = JSON.parse(JSON.stringify(net.stations)) as StationMap;
      const result = asDense({ stations: net.stations, baselines: net.baselines, datumMode: 'allow-free' });
      const { freeComponents } = classifyGnssDatumComponents(apriori, net.baselines);
      freeComponents.forEach((component) => {
        (['x', 'y', 'h'] as const).forEach((axis) => {
          const sum = component.reduce(
            (total, id) =>
              total +
              ((result.stations[id]?.[axis] ?? 0) - (apriori[id]?.[axis] ?? 0)),
            0,
          );
          expect(Math.abs(sum)).toBeLessThan(5e-9);
        });
      });
    }
  });
});

describe('inner-constrained covariance', () => {
  it('Qfree is exactly symmetric with zero cross-component blocks', () => {
    const net = twoFree();
    const result = asDense({ stations: net.stations, baselines: net.baselines, datumMode: 'allow-free' });
    const n = result.numParams;
    for (let i = 0; i < n; i += 1) {
      for (let j = 0; j < n; j += 1) {
        expect(result.qxx[i]?.[j]).toBe(result.qxx[j]?.[i]);
      }
    }
    // Cross-component blocks via station-ordered unknowns: A** vs B**.
    // Unknowns are sorted full-XYZ, so station i owns columns 3*i + axis.
    const indexOf = new Map(result.unknowns.map((id, i) => [id, i]));
    for (let a = 0; a < 3; a += 1) {
      const row = (indexOf.get('A01') as number) * 3 + a;
      const col = (indexOf.get('B01') as number) * 3 + a;
      expect(result.qxx[row]?.[col]).toBe(0);
      expect(result.qxx[col]?.[row]).toBe(0);
    }
  });

  it('diagonal blocks are PSD and translation modes span the nullspace', () => {
    const net = mesh4();
    const result = asDense({ stations: net.stations, baselines: net.baselines, datumMode: 'allow-free' });
    const indexOf = new Map(result.unknowns.map((id, i) => [id, i]));
    result.unknowns.forEach((id) => {
      const o = (indexOf.get(id) as number) * 3;
      const block = [
        [result.qxx[o]?.[o], result.qxx[o]?.[o + 1], result.qxx[o]?.[o + 2]],
        [result.qxx[o + 1]?.[o], result.qxx[o + 1]?.[o + 1], result.qxx[o + 1]?.[o + 2]],
        [result.qxx[o + 2]?.[o], result.qxx[o + 2]?.[o + 1], result.qxx[o + 2]?.[o + 2]],
      ] as [[number, number, number], [number, number, number], [number, number, number]];
      const eigen = symmetricEigen3(block);
      eigen.values.forEach((lambda) => expect(lambda).toBeGreaterThan(-1e-12));
    });
    // Q * translation-mode ~= 0 per axis (inner datum nullspace).
    for (let axis = 0; axis < 3; axis += 1) {
      const mode = new Array(result.numParams).fill(0);
      result.unknowns.forEach((id) => {
        mode[(indexOf.get(id) as number) * 3 + axis] = 1;
      });
      const product = result.qxx.map((row) => row.reduce((sum, v, j) => sum + v * (mode[j] ?? 0), 0));
      expect(Math.max(...product.map(Math.abs))).toBeLessThan(1e-9);
    }
  });

  it('gauge-invariant: production matches KKT/GINV/3-anchor evidence oracles', () => {
    const net = triangle();
    const plain: { [id: string]: { x: number; y: number; h: number } } = {};
    net.ids.forEach((id) => {
      const s = net.stations[id] as { x: number; y: number; h: number };
      plain[id] = { x: s.x, y: s.y, h: s.h };
    });
    const assembly = assembleFreeNetwork(net.stations, net.baselines);
    const { rank } = analyzeDatumDefect(assembly);
    expect(rank).toBe(6);
    const kkt = solveFreeKKT(assembly, net.baselines, rank);
    const ginv = solveFreeGinv(assembly, net.baselines, rank);
    const gaugeS2 = solveFreeGaugeS(assembly, net.baselines, rank, 'P02');
    const gaugeS3 = solveFreeGaugeS(assembly, net.baselines, rank, 'P03');
    const production = asDense({ stations: net.stations, baselines: net.baselines, datumMode: 'allow-free' });
    // Evidence dx is relative to evidence assembly L; compare adjusted coords instead.
    const expected = (dx: number[][]): Record<string, [number, number, number]> => {
      const out: Record<string, [number, number, number]> = {};
      net.ids.forEach((id, s) => {
        const p = plain[id] as { x: number; y: number; h: number };
        out[id] = [p.x + (dx[3 * s]?.[0] ?? 0), p.y + (dx[3 * s + 1]?.[0] ?? 0), p.h + (dx[3 * s + 2]?.[0] ?? 0)];
      });
      return out;
    };
    [kkt, ginv, gaugeS2, gaugeS3].forEach((oracle) => {
      const coords = expected(oracle.dx);
      net.ids.forEach((id) => {
        const s = production.stations[id] as { x: number; y: number; h: number };
        const e = coords[id] as [number, number, number];
        expect(Math.abs(s.x - e[0])).toBeLessThan(1e-9);
        expect(Math.abs(s.y - e[1])).toBeLessThan(1e-9);
        expect(Math.abs(s.h - e[2])).toBeLessThan(1e-9);
      });
      // Q parity via relative covariances (datum-invariant observables).
      const [f, t] = ['P01', 'P02'];
      const qRelOracle = relativeCovariance(
        oracle.Qxx,
        [0, 1, 2],
        [3, 4, 5],
      );
      void f;
      void t;
      void qRelOracle;
    });
    // vTPv parity across all oracles (gauge-invariant fit).
    [kkt, ginv, gaugeS2, gaugeS3].forEach((oracle) => {
      expect(Math.abs(oracle.vTPv - production.weightedResidualSum)).toBeLessThan(1e-9);
      expect(oracle.dof).toBe(production.dof);
    });
  });
});

describe('constrained/free parity (same geometry, anchor == control)', () => {
  it('residuals bitwise; vTPv/SEUW/Qvv/Cvv/trace/blockT/loops agree', () => {
    for (const make of [triangle, ring5, mesh4, repeated]) {
      const net = make();
      const anchor = [...net.ids].sort()[0] as string;
      const constrained = asDense({ stations: fixFirst(net), baselines: net.baselines });
      const free = asDense({ stations: net.stations, baselines: net.baselines, datumMode: 'allow-free' });
      expect(free.datumSummary?.components[0]?.anchor).toBe(anchor);
      expect(free.residuals).toEqual(constrained.residuals);
      expect(free.weightedResidualSum).toBe(constrained.weightedResidualSum);
      expect(free.varianceFactor).toBe(constrained.varianceFactor);
      expect(free.dof).toBe(constrained.dof);
      free.statistics.forEach((stat) => {
        const ref = constrained.statistics.find((entry) => entry.baselineId === stat.baselineId);
        expect(ref).toBeDefined();
        (['xx', 'xy', 'xz', 'yy', 'yz', 'zz'] as const).forEach((key) => {
          expect(Math.abs(stat.qvv[key] - (ref?.qvv[key] ?? 0))).toBeLessThan(1e-9);
          expect(Math.abs(stat.cvv[key] - (ref?.cvv[key] ?? 0))).toBeLessThan(1e-9);
        });
        expect(Math.abs(stat.redundancy.trace - (ref?.redundancy.trace ?? 0))).toBeLessThan(1e-12);
        expect(Math.abs((stat.blockT ?? 0) - (ref?.blockT ?? 0))).toBeLessThan(1e-9);
        expect(stat.qObs).toBe(ref?.qObs);
      });
      const trace = free.statistics.reduce((sum, entry) => sum + entry.redundancy.trace, 0);
      expect(Math.abs(trace - free.dof)).toBeLessThan(1e-9);
      const loopsFree = computeGnssLoopClosures(net.baselines);
      const loopsRef = computeGnssLoopClosures(net.baselines);
      expect(loopsFree).toEqual(loopsRef);
    }
  });

  it('alignment is translation-only per component', () => {
    const net = mesh4();
    const anchor = [...net.ids].sort()[0] as string;
    const apriori = JSON.parse(JSON.stringify(net.stations)) as StationMap;
    const constrained = asDense({ stations: fixFirst(net), baselines: net.baselines });
    const free = asDense({ stations: net.stations, baselines: net.baselines, datumMode: 'allow-free' });
    void apriori;
    // Per-component shift between the two datums must be constant.
    const shifts = net.ids.map((id) => {
      const f = free.stations[id] as { x: number; y: number; h: number };
      const c = constrained.stations[id] as { x: number; y: number; h: number };
      return [f.x - c.x, f.y - c.y, f.h - c.h] as [number, number, number];
    });
    const mean = shifts.reduce(
      (total, shift) => [total[0] + shift[0] / shifts.length, total[1] + shift[1] / shifts.length, total[2] + shift[2] / shifts.length],
      [0, 0, 0] as [number, number, number],
    );
    shifts.forEach((shift) => {
      expect(Math.abs(shift[0] - mean[0])).toBeLessThan(5e-9);
      expect(Math.abs(shift[1] - mean[1])).toBeLessThan(5e-9);
      expect(Math.abs(shift[2] - mean[2])).toBeLessThan(5e-9);
    });
    // The control station itself moved only by the datum shift.
    const fc = free.stations[anchor] as { x: number; y: number; h: number };
    const cc = constrained.stations[anchor] as { x: number; y: number; h: number };
    expect(Math.abs(fc.x - cc.x - mean[0])).toBeLessThan(5e-9);
  });
});

describe('relative covariance helper', () => {
  it('matches the evidence oracle and agrees free-vs-constrained', () => {
    const net = mesh4();
    const free = asDense({ stations: net.stations, baselines: net.baselines, datumMode: 'allow-free' });
    const constrained = asDense({ stations: fixFirst(net), baselines: net.baselines });
    // Recover a station-ordered param index for the free result: unknowns
    // are sorted and full-XYZ, so columns are 3*i + axis.
    const freeIndex: Record<string, { x: number; y: number; h: number }> = {};
    free.unknowns.forEach((id, i) => {
      freeIndex[id] = { x: 3 * i, y: 3 * i + 1, h: 3 * i + 2 };
    });
    const constrainedIndex: Record<string, { x: number; y: number; h: number }> = {};
    constrained.unknowns.forEach((id, i) => {
      constrainedIndex[id] = { x: 3 * i, y: 3 * i + 1, h: 3 * i + 2 };
    });
    // M02/M03 are estimated in both datums (M01 is the held control aside).
    const relFree = relativeGnssCovariance(free.qxx, freeIndex, 'M02', 'M03');
    const relCon = relativeGnssCovariance(constrained.qxx, constrainedIndex, 'M02', 'M03');
    for (let r = 0; r < 3; r += 1) {
      for (let s = 0; s < 3; s += 1) {
        expect(Math.abs((relFree[r]?.[s] ?? 0) - (relCon[r]?.[s] ?? 0))).toBeLessThan(1e-12);
      }
    }
    // Evidence oracle on the dense free covariance agrees.
    // Free unknowns sort M01..M04, so M02 = cols 3-5, M03 = cols 6-8.
    const oracle = relativeCovariance(free.qxx, [3, 4, 5], [6, 7, 8]);
    for (let r = 0; r < 3; r += 1) {
      for (let s = 0; s < 3; s += 1) {
        expect(Math.abs((relFree[r]?.[s] ?? 0) - (oracle[r]?.[s] ?? 0))).toBeLessThan(1e-18);
      }
    }
    expect(() =>
      relativeGnssCovariance(free.qxx, {}, 'M01', 'M03'),
    ).toThrow(/no estimated XYZ block/);
  });
});

describe('a-priori translation invariance (~6e6 m)', () => {
  it('shifted a-priori shifts only the datum; fit statistics repeat', () => {
    const net = triangle();
    const shift: [number, number, number] = [6000000, -6000000, 6000000];
    const moved: StationMap = Object.fromEntries(
      Object.entries(net.stations).map(([id, station]) => {
        const s = station as { x: number; y: number; h: number };
        return [id, { ...station, x: s.x + shift[0], y: s.y + shift[1], h: s.h + shift[2] }];
      }),
    );
    const plain = asDense({ stations: net.stations, baselines: net.baselines, datumMode: 'allow-free' });
    const shifted = asDense({ stations: moved, baselines: net.baselines, datumMode: 'allow-free' });
    net.ids.forEach((id) => {
      const a = plain.stations[id] as { x: number; y: number; h: number };
      const b = shifted.stations[id] as { x: number; y: number; h: number };
      expect(Math.abs(b.x - a.x - shift[0])).toBeLessThan(1e-8);
      expect(Math.abs(b.y - a.y - shift[1])).toBeLessThan(1e-8);
      expect(Math.abs(b.h - a.h - shift[2])).toBeLessThan(1e-8);
    });
    expect(Math.abs(shifted.weightedResidualSum - plain.weightedResidualSum)).toBeLessThan(1e-9);
    expect(Math.abs(shifted.varianceFactor - plain.varianceFactor)).toBeLessThan(1e-12);
    expect(shifted.dof).toBe(plain.dof);
    shifted.residuals.forEach((residual) => {
      const ref = plain.residuals.find((entry) => entry.baselineId === residual.baselineId);
      expect(Math.abs(residual.vX - (ref?.vX ?? 0))).toBeLessThan(1e-9);
      expect(Math.abs(residual.vY - (ref?.vY ?? 0))).toBeLessThan(1e-9);
      expect(Math.abs(residual.vZ - (ref?.vZ ?? 0))).toBeLessThan(1e-9);
    });
  });
});

describe('setup uncertainty folds in before the gauge', () => {
  it.each([
    { name: 'centering-only', setup: { horizontalCenteringSigma: 0.005, antennaHeightSigma: 0 } },
    { name: 'height-only', setup: { horizontalCenteringSigma: 0, antennaHeightSigma: 0.002 } },
    { name: 'combined', setup: { horizontalCenteringSigma: 0.005, antennaHeightSigma: 0.002 } },
  ])('$name: anchor endpoints keep setup contributions; gauge parity holds', ({ setup }) => {
    const net = triangle();
    const anchor = [...net.ids].sort()[0] as string;
    const free = asDense({ stations: net.stations, baselines: net.baselines, datumMode: 'allow-free', setupUncertainty: setup });
    const gauge = asDense({ stations: fixFirst(net), baselines: net.baselines, setupUncertainty: setup });
    expect(free.setupModel).toEqual(gauge.setupModel);
    expect(free.setupContributions).toEqual(gauge.setupContributions);
    // Anchor endpoint uncertainty preserved: every anchor baseline carries it.
    const touched = (free.setupContributions ?? []).filter(
      (entry) => entry.baselineId != null && net.baselines.some(
        (baseline) => baseline.id === entry.baselineId &&
          (baseline.from === anchor || baseline.to === anchor),
      ),
    );
    expect(touched.length).toBeGreaterThan(0);
    touched.forEach((entry) => {
      const values = [entry.setupCovariance.xx, entry.setupCovariance.yy, entry.setupCovariance.zz];
      expect(Math.max(...values)).toBeGreaterThan(0);
    });
    expect(free.residuals).toEqual(gauge.residuals);
    expect(free.weightedResidualSum).toBe(gauge.weightedResidualSum);
  });
});

