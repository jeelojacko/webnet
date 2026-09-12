/**
 * Phase 12E0 — synthetic 3-station / 3-baseline GVX<->BL exact parity.
 *
 * One ORIGINAL triangle fixture (realistic ECEF magnitudes, closed
 * loop, full covariances) is expressed both as GVX 1.0 and as native BL
 * text. Canonical vectors/covariances must match exactly, and the
 * TEST-ONLY adjustment (one a-priori station per component fixed as an
 * artificial datum, solely to exercise parser->solver) must agree on
 * adjusted coordinates, residuals, Qxx, variance factor, per-baseline
 * statistics, and loop closures with zero diff.
 */
import { describe, expect, it } from 'vitest';
import { parseGnssBaselineText } from '../../src/engine/gnssBaselineNetworkImport';
import { importGnssBaselineGvx } from '../../src/engine/gnssGvxImport';
import { runGnssBaselineAdjustment } from '../../src/engine/gnssBaselineAdjust';
import { computeGnssLoopClosures } from '../../src/engine/gnssBaselineLoops';
import type { StationMap } from '../../src/types';
import { buildGvx } from './gvxImport.test';

const REF = 'SYNTHETIC-ECEF-TEST';
const EPOCH = '2010.0000';

// Original synthetic triangle: closed loop AB + BC = AC, mm-level sigmas.
const A = { x: 3779000.0, y: 150000.0, z: 5121000.0 };
const AB = { dx: 1234.567, dy: -234.125, dz: 345.875 };
const BC = { dx: -567.25, dy: 890.5, dz: -123.75 };
const AC = { dx: AB.dx + BC.dx, dy: AB.dy + BC.dy, dz: AB.dz + BC.dz };

const B_APRIORI = { x: A.x + AB.dx + 0.01, y: A.y + AB.dy - 0.02, z: A.z + AB.dz + 0.015 };
const C_APRIORI = { x: A.x + AC.dx - 0.012, y: A.y + AC.dy + 0.018, z: A.z + AC.dz - 0.009 };

interface Stochastic {
  sdx: number;
  sdy: number;
  sdz: number;
  pxy: number;
  pxz: number;
  pyz: number;
}

const STOCH: Record<string, Stochastic> = {
  V1: { sdx: 0.002, sdy: 0.003, sdz: 0.004, pxy: 0.5, pxz: -0.25, pyz: 0.125 },
  V2: { sdx: 0.003, sdy: 0.0025, sdz: 0.005, pxy: -0.4, pxz: 0.3, pyz: -0.2 },
  V3: { sdx: 0.004, sdy: 0.004, sdz: 0.003, pxy: 0.2, pxz: 0.1, pyz: -0.35 },
};

const covOf = (s: Stochastic) => ({
  xx: s.sdx * s.sdx,
  xy: s.pxy * s.sdx * s.sdy,
  xz: s.pxz * s.sdx * s.sdz,
  yy: s.sdy * s.sdy,
  yz: s.pyz * s.sdy * s.sdz,
  zz: s.sdz * s.sdz,
});

const gvxText = (): string =>
  buildGvx(
    [
      { id: 'A', name: 'STA-A', ...A },
      { id: 'B', name: 'STA-B', ...B_APRIORI },
      { id: 'C', name: 'STA-C', ...C_APRIORI },
    ],
    [
      { id: 'V1', from: 'A', to: 'B', ...AB, ...STOCH['V1']! },
      { id: 'V2', from: 'B', to: 'C', ...BC, ...STOCH['V2']! },
      { id: 'V3', from: 'A', to: 'C', ...AC, ...STOCH['V3']! },
    ],
    { refName: REF },
  );

const blText = (): string => {
  const lines = [`FRAME ECEF ${REF} EPOCH ${EPOCH}`, 'UNITS M'];
  for (const [id, p] of [['A', A], ['B', B_APRIORI], ['C', C_APRIORI]] as const) {
    lines.push(`GX ${id} ${p.x} ${p.y} ${p.z} FREE`);
  }
  const vectors = [
    { id: 'V1', from: 'A', to: 'B', ...AB },
    { id: 'V2', from: 'B', to: 'C', ...BC },
    { id: 'V3', from: 'A', to: 'C', ...AC },
  ];
  vectors.forEach((v) => {
    const cov = covOf(STOCH[v.id]!);
    lines.push(`BL ${v.from} ${v.to} ${v.dx} ${v.dy} ${v.dz} ID ${v.id}`);
    lines.push(`COV ${cov.xx} ${cov.xy} ${cov.xz} ${cov.yy} ${cov.yz} ${cov.zz}`);
  });
  return `${lines.join('\n')}\n`;
};

/** TEST-ONLY artificial datum: fix one a-priori station per component. */
const withArtificialDatum = (stations: StationMap): StationMap => {
  const fixed: StationMap = {};
  Object.entries(stations).forEach(([id, station]) => {
    const isDatum = id === 'A';
    fixed[id] = {
      ...station!,
      fixed: isDatum,
      fixedX: isDatum,
      fixedY: isDatum,
      fixedH: isDatum,
    };
  });
  return fixed;
};

describe('gvx<->bl parity', () => {
  it('canonical vectors, covariances, and stations match exactly', () => {
    const gvx = importGnssBaselineGvx(gvxText(), 'parity.gvx');
    const native = parseGnssBaselineText(blText(), 'parity.txt');
    expect(gvx.network).not.toBeNull();
    expect(native.network).not.toBeNull();
    const g = gvx.network!;
    const n = native.network!;
    expect(g.frame).toEqual(n.frame);
    expect(Object.keys(g.stations).sort()).toEqual(Object.keys(n.stations).sort());
    for (const id of Object.keys(n.stations)) {
      expect(g.stations[id]?.x).toBe(n.stations[id]?.x);
      expect(g.stations[id]?.y).toBe(n.stations[id]?.y);
      expect(g.stations[id]?.h).toBe(n.stations[id]?.h);
    }
    expect(g.baselines).toHaveLength(n.baselines.length);
    g.baselines.forEach((baseline, index) => {
      const expected = n.baselines[index]!;
      expect(baseline.from).toBe(expected.from);
      expect(baseline.to).toBe(expected.to);
      expect(baseline.vector).toEqual(expected.vector);
      expect(baseline.covariance).toEqual(expected.covariance);
    });
  });

  it('adjustment parity is exact (coords, residuals, Qxx, variance factor, statistics, loops)', () => {
    const gvx = importGnssBaselineGvx(gvxText(), 'parity.gvx');
    const native = parseGnssBaselineText(blText(), 'parity.txt');
    const gResult = runGnssBaselineAdjustment({
      stations: withArtificialDatum(gvx.network!.stations),
      baselines: gvx.network!.baselines,
    });
    const nResult = runGnssBaselineAdjustment({
      stations: withArtificialDatum(native.network!.stations),
      baselines: native.network!.baselines,
    });
    expect(gResult.converged).toBe(true);
    expect(nResult.converged).toBe(true);
    expect(gResult.unknowns).toEqual(nResult.unknowns);
    expect(gResult.dof).toBe(nResult.dof);
    for (const id of gResult.unknowns) {
      expect(gResult.stations[id]?.x).toBe(nResult.stations[id]?.x);
      expect(gResult.stations[id]?.y).toBe(nResult.stations[id]?.y);
      expect(gResult.stations[id]?.h).toBe(nResult.stations[id]?.h);
    }
    expect(gResult.residuals).toEqual(nResult.residuals);
    expect(gResult.qxx).toEqual(nResult.qxx);
    expect(gResult.weightedResidualSum).toBe(nResult.weightedResidualSum);
    expect(gResult.varianceFactor).toBe(nResult.varianceFactor);
    expect(gResult.statistics).toEqual(nResult.statistics);
    const gLoops = computeGnssLoopClosures(gvx.network!.baselines);
    const nLoops = computeGnssLoopClosures(native.network!.baselines);
    expect(gLoops).toEqual(nLoops);
    expect(gLoops.loops).toHaveLength(1);
    expect(gLoops.cycleRank).toBe(1);
  });
});
