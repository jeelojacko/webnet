/**
 * Phase 20K.1 Wave C1 — analytic internal chord-seam assembly tests.
 *
 * §17 hand oracle (R=100 arc, Distance g=-0.5 D=20, tol=8): exact tie,
 * extent, fan areas, shared-index topology, and digest. §18 analytic
 * equivalence (Distance/Elevation/Relative equivalents agree bitwise) plus
 * GAP + OVERLAP unit cases through the shared helper.
 */
import { describe, expect, it } from 'vitest';

import { computeGradingFromSnapshots } from '../src/workers/surfaceGradingCompute';
import { gradingSideNormal } from '../src/engine/cad/grading/gradingCourseFrame';
import {
  assembleSolvedGradingChain,
  digestSeamMesh,
  type ChordSeamChord,
} from '../src/engine/cad/grading/gradingChordSeam';
import { linearizeGradingArc } from '../src/engine/cad/grading/gradingCurve';
import { buildGradingStripMesh, mesh3dArea, meshPlanArea } from '../src/engine/cad/grading/gradingMesh';
import { solveAnalyticGradingChord } from '../src/engine/cad/grading/solveAnalyticGradingChord';
import { validateGradingMeshTopology } from '../src/engine/cad/grading/gradingTopology';
import type { GradingCriterion, GradingSide } from '../src/engine/cad/grading/gradingTypes';

const C = 0.9238795325112867; // cos(pi/8)
const S = 0.3826834323650898; // sin(pi/8)
const SIDE: GradingSide = 'right';
const DIST: GradingCriterion = { kind: 'distance', gradeRatio: -0.5, distance: 20 };
const ELEV: GradingCriterion = { kind: 'elevation', gradeRatio: -0.5, targetElevation: 0 };
const REL: GradingCriterion = { kind: 'relative-elevation', gradeRatio: -0.5, relativeElevation: -10 };
const SEARCH = 100;

/** Oracle arc source: R=100, C=(0,0), sweep -pi/4 -> +pi/4 CCW, Z=10. */
const oracleSource = () => {
  const a = -Math.PI / 4;
  const b = Math.PI / 4;
  return {
    startX: 100 * Math.cos(a),
    startY: 100 * Math.sin(a),
    endX: 100 * Math.cos(b),
    endY: 100 * Math.sin(b),
    startZ: 10,
    endZ: 10,
    length: 100 * (Math.PI / 2),
    reoriented: false,
    isArc: true as const,
    arc: { centerX: 0, centerY: 0, radius: 100, startAngle: a, endAngle: b, sweepCCW: true },
  };
};

/** Exact per-chord seam inputs over the oracle linearization. */
const oracleSeamChords = (criterion: GradingCriterion): ChordSeamChord[] => {
  const linearized = linearizeGradingArc(0, 0, 100, -Math.PI / 4, Math.PI / 4, true, 10, 10, 8)!;
  expect(linearized.subdivisions).toBe(2);
  return linearized.points.slice(0, -1).map((p0, k) => {
    const p1 = linearized.points[k + 1]!;
    const chordLen = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    const solved = solveAnalyticGradingChord({
      source: {
        startX: p0.x, startY: p0.y, endX: p1.x, endY: p1.y,
        startZ: p0.z, endZ: p1.z, length: chordLen, reoriented: false, isArc: false,
      },
      side: SIDE, criterion, maxSearchDistance: SEARCH,
    });
    expect(solved.ok).toBe(true);
    if (!solved.ok) throw new Error('oracle chord failed');
    const s = solved.solve;
    const t = { nx: (p1.x - p0.x) / chordLen, ny: (p1.y - p0.y) / chordLen };
    const n = gradingSideNormal(t.nx, t.ny, SIDE)!;
    return {
      t, n, gs: 0, criterion,
      source: [{ ...p0 }, { ...p1 }],
      daylight: [{ ...s.daylightPts[0]! }, { ...s.daylightPts[1]! }],
      nodeStations: [s.nodeStations[0]!, s.nodeStations[1]!],
      distances: [s.distances[0]!, s.distances[1]!],
    };
  });
};

describe('phase20k1 analytic internal chord seam (§17 hand oracle)', () => {
  it('resolves the GAP tie, extent, fan areas, and shared-index topology', () => {
    const chords = oracleSeamChords(DIST);
    // Authoritative station + chord frames.
    const v = chords[0]!.source[1]!;
    expect(v).toEqual({ x: 100, y: 0, z: 10 });
    expect(chords[0]!.n).toEqual({ nx: C, ny: -S });
    expect(chords[1]!.n).toEqual({ nx: C, ny: S });
    expect(chords[0]!.daylight[1]).toEqual({ x: 118.47759065022574, y: -7.653668647301796, z: 0 });
    expect(chords[1]!.daylight[0]).toEqual({ x: 118.47759065022574, y: 7.653668647301796, z: 0 });

    const assembled = assembleSolvedGradingChain(chords, SEARCH, SIDE);
    expect(assembled.ok).toBe(true);
    if (!assembled.ok) return;
    const { ties, sourcePts, daylightPts } = assembled.value;
    expect(ties).toHaveLength(1);
    const seam = ties[0]!;
    expect(seam.kind).toBe('GAP');
    // Independent closed-form: tie on y=0 along the incoming limit line.
    const u = (20 * S) / C;
    const xt = 100 + 20 * C + u * S;
    expect(seam.tie.x).toBeCloseTo(xt, 12);
    expect(seam.tie).toEqual({ x: 121.64784400584789, y: -8.881784197001252e-16, z: 0 });
    expect(seam.extent).toBe(21.647844005847887);
    // V thrice in the source run (one shared index), T created once.
    expect(sourcePts.filter((p) => p.x === 100 && p.y === 0)).toHaveLength(3);
    expect(daylightPts.filter((p) => p.x === seam.tie.x)).toHaveLength(1);

    // Fan areas: independent (20·S·extent plan) + frozen full-precision.
    const qIn = chords[0]!.daylight[1]!;
    const qOut = chords[1]!.daylight[0]!;
    const fan = [
      { a: v, b: qIn, c: seam.tie },
      { a: v, b: seam.tie, c: qOut },
    ];
    const merged = { points: [] as number[], triangles: [] as number[] };
    const index = new Map<string, number>();
    const add = (p: { x: number; y: number; z: number }): number => {
      const key = `${p.x}|${p.y}|${p.z}`;
      const hit = index.get(key);
      if (hit !== undefined) return hit;
      const id = merged.points.length / 3;
      merged.points.push(p.x, p.y, p.z);
      index.set(key, id);
      return id;
    };
    for (const t of fan) merged.triangles.push(add(t.a), add(t.b), add(t.c));
    expect(meshPlanArea(merged.points, merged.triangles)).toBeCloseTo(20 * S * seam.extent, 9);
    // Frozen solver actuals: real chord-frame floats sit ±1 ulp off the
    // idealized sin/cos hand values (tie.x …889 vs …887, fan …810 vs …798).
    expect(meshPlanArea(merged.points, merged.triangles)).toBe(165.6854249492381);
    expect(mesh3dArea(merged.points, merged.triangles)).toBe(185.24193653371802);

    // Full strip mesh: one component, one continuous boundary, digest.
    const mesh = buildGradingStripMesh(sourcePts, daylightPts);
    expect(mesh.ok).toBe(true);
    if (!mesh.ok) return;
    const topo = validateGradingMeshTopology(mesh.points, mesh.triangles, { scope: 'arc' });
    expect(topo.ok).toBe(true);
    expect(topo.components).toBe(1);
    expect(topo.loops).toBe(1);
    expect(digestSeamMesh(mesh.points, mesh.triangles)).toBe('5701eca8');
  });

  it('solves the oracle end-to-end through the arc path', () => {
    const out = computeGradingFromSnapshots({
      gradingId: 'oracle', revision: 'r', source: oracleSource(),
      side: SIDE, criterion: DIST, maxSearchDistance: SEARCH, curveChordTolerance: 8,
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result.diagnostics).toEqual([]);
    const topo = validateGradingMeshTopology(out.result.gradingMesh.points, out.result.gradingMesh.triangles, { scope: 'arc' });
    expect(topo.ok).toBe(true);
    expect(topo.components).toBe(1);
    expect(digestSeamMesh(out.result.gradingMesh.points, out.result.gradingMesh.triangles)).toBe('5701eca8');
  });
});

describe('phase20k1 analytic seam equivalence (§18)', () => {
  it('Distance/Elevation/Relative equivalents agree bitwise', () => {
    const runs = [DIST, ELEV, REL].map((criterion) => {
      const out = computeGradingFromSnapshots({
        gradingId: 'equiv', revision: 'r', source: oracleSource(),
        side: SIDE, criterion, maxSearchDistance: SEARCH, curveChordTolerance: 8,
      });
      expect(out.ok).toBe(true);
      if (!out.ok) throw new Error('equiv run failed');
      return out.result;
    });
    for (const run of runs.slice(1)) {
      expect(run.gradingMesh.points).toEqual(runs[0]!.gradingMesh.points);
      expect(run.gradingMesh.triangles).toEqual(runs[0]!.gradingMesh.triangles);
      expect(run.daylightPoints).toEqual(runs[0]!.daylightPoints);
      expect(run.gradingPlanArea).toBe(runs[0]!.gradingPlanArea);
      expect(run.grading3dArea).toBe(runs[0]!.grading3dArea);
      expect(digestSeamMesh(run.gradingMesh.points, run.gradingMesh.triangles))
        .toBe(digestSeamMesh(runs[0]!.gradingMesh.points, runs[0]!.gradingMesh.triangles));
    }
  });

  it('clips an OVERLAP seam to the miter line exactly once', () => {
    // Inside turn: (0,0)->(10,0)->(10,-10), right side, D=5, flat Z=7.
    const mk = (
      p0: { x: number; y: number; z: number },
      p1: { x: number; y: number; z: number },
    ): ChordSeamChord => {
      const len = Math.hypot(p1.x - p0.x, p1.y - p0.y);
      const t = { nx: (p1.x - p0.x) / len, ny: (p1.y - p0.y) / len };
      const n = gradingSideNormal(t.nx, t.ny, SIDE)!;
      const criterion: GradingCriterion = { kind: 'distance', gradeRatio: 0, distance: 5 };
      const daylight = (p: { x: number; y: number; z: number }) => ({
        x: p.x + n.nx * 5, y: p.y + n.ny * 5, z: p.z,
      });
      return {
        t, n, gs: 0, criterion,
        source: [{ ...p0 }, { ...p1 }],
        daylight: [daylight(p0), daylight(p1)],
        nodeStations: [0, len],
        distances: [5, 5],
      };
    };
    const v = { x: 10, y: 0, z: 7 };
    const chords = [
      mk({ x: 0, y: 0, z: 7 }, v),
      mk(v, { x: 10, y: -10, z: 7 }),
    ];
    const assembled = assembleSolvedGradingChain(chords, SEARCH, SIDE);
    expect(assembled.ok).toBe(true);
    if (!assembled.ok) return;
    const [seam] = assembled.value.ties;
    expect(seam!.kind).toBe('OVERLAP');
    expect(seam!.tie).toEqual({ x: 5, y: -5, z: 7 });
    expect(seam!.extent).toBe(Math.SQRT2 * 5);
    // Both daylight edges cross the miter exactly at the tie: no double-cover.
    const mesh = buildGradingStripMesh(assembled.value.sourcePts, assembled.value.daylightPts);
    expect(mesh.ok).toBe(true);
    if (!mesh.ok) return;
    expect(meshPlanArea(mesh.points, mesh.triangles)).toBe(75);
    expect(mesh3dArea(mesh.points, mesh.triangles)).toBe(75);
    const topo = validateGradingMeshTopology(mesh.points, mesh.triangles, { scope: 'arc' });
    expect(topo.ok).toBe(true);
    expect(topo.components).toBe(1);
    expect(topo.loops).toBe(1);
  });
});
