/**
 * Phase 20I — surface×analytic GAP/OVERLAP mesh prototypes (evidence only).
 *
 * The study core fans real joint endpoints (Qs from the existing chord
 * solve, Qa from the existing terminal-line origin) into two triangles and
 * merges them under the normal explicit-TIN validator — never relaxed.
 * These tests prove plane memberships, the shared V→tie edge, boundary
 * dispositions, tiling-once, and deterministic repeats, plus the open
 * two-course group prototype with honest metrics.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { buildTargetQuery } from '../src/engine/cad/grading/gradingTargetIndex';
import { solveGradingChord } from '../src/engine/cad/grading/solveAnalyticGradingChord';
import type { GradingTargetMeshSnapshot } from '../src/engine/cad/grading/gradingComputeTypes';
import type {
  GradingCriterion,
  ResolvedGradingSource,
} from '../src/engine/cad/grading/gradingTypes';
import { resolveSurfaceAnalyticCorner } from '../scripts/phase20iSurfaceAnalyticCornerCore';

const FIXED = (g: number): GradingCriterion => ({ kind: 'fixed', gradeRatio: g });
const REL = (g: number, dz: number): GradingCriterion => ({ kind: 'relative-elevation', gradeRatio: g, relativeElevation: dz });

const M = (sx: number, sy: number, sz: number, ex: number, ey: number, ez: number): ResolvedGradingSource => ({
  startX: sx, startY: sy, endX: ex, endY: ey, startZ: sz, endZ: ez,
  length: Math.hypot(ex - sx, ey - sy), reoriented: false, isArc: false,
});

const flatTin = (z: number, half = 200): GradingTargetMeshSnapshot => {
  const a = (10 * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const pts: Array<[number, number]> = [[-half, -half], [half, -half], [half, half], [-half, half]];
  return {
    points: pts.flatMap(([x, y]) => [x * c - y * s, x * s + y * c, z]),
    triangles: [0, 1, 2, 0, 2, 3],
  };
};

const T90 = flatTin(90);
const digest = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);

type Pt = [number, number, number];
const ptAt = (points: number[], i: number): Pt => [points[i * 3]!, points[i * 3 + 1]!, points[i * 3 + 2]!];
const hasVertex = (points: number[], want: Pt): boolean => {
  for (let i = 0; i + 2 < points.length; i += 3) {
    if (points[i] === want[0] && points[i + 1] === want[1] && points[i + 2] === want[2]) return true;
  }
  return false;
};
/** Surface plane z=100+0.5y; analytic plane z=100-0.25x (primary §18). */
const onSurfacePlane = (p: Pt): boolean => Math.abs(p[2] - (100 + 0.5 * p[1])) < 1e-9;
const onAnalyticPlane = (p: Pt): boolean => Math.abs(p[2] - (100 - 0.25 * p[0])) < 1e-9;

describe('phase20i GAP mesh prototype', () => {
  const got = resolveSurfaceAnalyticCorner({
    vx: 0, vy: 0, vz: 100,
    surfaceMember: M(-60, 0, 100, 0, 0, 100), surfaceIncoming: true,
    analyticMember: M(0, 0, 100, 0, 60, 100), analyticIncoming: false,
    side: 'right', surfaceCriterion: FIXED(-0.5), analyticCriterion: REL(-0.25, -10),
    maxSearchDistance: 100, target: T90, buildMesh: true,
  });

  it('merges two fan triangles under a valid mesh', () => {
    expect(got.outcome).toBe('EXACT_COMMON_TIE');
    expect(got.mesh?.valid).toBe(true);
    expect(got.mesh!.triangles.length / 3).toBe(2);
    expect(got.mesh!.points.length / 3).toBe(4);
  });

  it('shares the V→tie edge on both planes with correct boundaries', () => {
    const mesh = got.mesh!;
    const V: Pt = [0, 0, 100];
    const tie: Pt = [40, -20, 90];
    const Qs: Pt = [0, -20, 90];
    const Qa: Pt = [40, 0, 90];
    for (const v of [V, tie, Qs, Qa]) expect(hasVertex(mesh.points, v)).toBe(true);
    // Shared edge endpoints live on BOTH grading planes (no wall/bridge).
    expect(onSurfacePlane(V) && onAnalyticPlane(V)).toBe(true);
    expect(onSurfacePlane(tie) && onAnalyticPlane(tie)).toBe(true);
    // Qs→tie rides the surface termination (plane + flat target z=90).
    expect(onSurfacePlane(Qs)).toBe(true);
    expect(Qs[2]).toBe(90);
    // tie→Qa rides the analytic terminal line x=40, z=90.
    expect(Qa[0]).toBe(40);
    expect(Qa[2]).toBe(90);
    expect(onAnalyticPlane(Qa)).toBe(true);
  });

  it('is CCW, finite, duplicate-free, and deterministic', () => {
    const mesh = got.mesh!;
    expect(mesh.points.every((v) => Number.isFinite(v))).toBe(true);
    const faces: string[] = [];
    for (let f = 0; f + 2 < mesh.triangles.length; f += 3) {
      const [ax, ay] = ptAt(mesh.points, mesh.triangles[f]!);
      const [bx, by] = ptAt(mesh.points, mesh.triangles[f + 1]!);
      const [cx, cy] = ptAt(mesh.points, mesh.triangles[f + 2]!);
      const area2 = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
      expect(area2).toBeGreaterThan(0);
      faces.push([mesh.triangles[f], mesh.triangles[f + 1], mesh.triangles[f + 2]].join('|'));
    }
    // Tiled once: no duplicate faces, no zero-area output.
    expect(new Set(faces).size).toBe(faces.length);
    const again = resolveSurfaceAnalyticCorner({
      vx: 0, vy: 0, vz: 100,
      surfaceMember: M(-60, 0, 100, 0, 0, 100), surfaceIncoming: true,
      analyticMember: M(0, 0, 100, 0, 60, 100), analyticIncoming: false,
      side: 'right', surfaceCriterion: FIXED(-0.5), analyticCriterion: REL(-0.25, -10),
      maxSearchDistance: 100, target: T90, buildMesh: true,
    });
    expect(digest(again.mesh)).toBe(digest(got.mesh));
  });
});

describe('phase20i OVERLAP mesh prototype', () => {
  // Right-turn reflex: incoming west→V, outgoing V→south, side right.
  const got = resolveSurfaceAnalyticCorner({
    vx: 0, vy: 0, vz: 100,
    surfaceMember: M(-60, 0, 100, 0, 0, 100), surfaceIncoming: true,
    analyticMember: M(0, 0, 100, 0, -60, 100), analyticIncoming: false,
    side: 'right', surfaceCriterion: FIXED(-0.5), analyticCriterion: REL(-0.25, -10),
    maxSearchDistance: 100, target: T90, buildMesh: true,
  });

  it('clips both strips to the V→tie seam with an exact overlap tie', () => {
    expect(got.turn).toBe('OVERLAP');
    expect(got.outcome).toBe('EXACT_COMMON_TIE');
    const tie = got.analyticTie!;
    expect([tie.x, tie.y, tie.z]).toEqual([-40, -20, 90]);
    expect(got.mesh?.valid).toBe(true);
  });

  it('tiles the overlap once with no gap, duplicate, or inversion', () => {
    const mesh = got.mesh!;
    expect(mesh.points.length / 3).toBeGreaterThan(4);
    expect(mesh.points.every((v) => Number.isFinite(v))).toBe(true);
    const faces: string[] = [];
    for (let f = 0; f + 2 < mesh.triangles.length; f += 3) {
      const [ax, ay] = ptAt(mesh.points, mesh.triangles[f]!);
      const [bx, by] = ptAt(mesh.points, mesh.triangles[f + 1]!);
      const [cx, cy] = ptAt(mesh.points, mesh.triangles[f + 2]!);
      expect((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)).toBeGreaterThan(0);
      faces.push([mesh.triangles[f], mesh.triangles[f + 1], mesh.triangles[f + 2]].join('|'));
    }
    expect(new Set(faces).size).toBe(faces.length);
    // Joint vertices survive the clip: V and the tie are still mesh nodes.
    expect(hasVertex(mesh.points, [0, 0, 100])).toBe(true);
    expect(hasVertex(mesh.points, [-40, -20, 90])).toBe(true);
  });
});

describe('phase20i open two-course group prototype', () => {
  it('merges real strips + corner mesh with honest surface-only target counts', () => {
    const query = buildTargetQuery(T90)!;
    const sOut = solveGradingChord({
      source: { ...M(-60, 0, 100, 0, 0, 100) }, side: 'right',
      criterion: FIXED(-0.5), maxSearchDistance: 100, target: T90, query,
    });
    const aOut = solveGradingChord({
      source: { ...M(0, 0, 100, 0, 60, 100) }, side: 'right',
      criterion: REL(-0.25, -10), maxSearchDistance: 100, target: T90, query,
    });
    expect(sOut.ok && aOut.ok).toBe(true);
    if (!sOut.ok || !aOut.ok) return;
    // Target counts are surface-only: the analytic chord never queries.
    expect(sOut.solve.candidateTriangleCount).toBeGreaterThan(0);
    expect(aOut.solve.candidateTriangleCount).toBe(0);
    expect(aOut.solve.intersectionSegmentCount).toBe(0);
    const corner = resolveSurfaceAnalyticCorner({
      vx: 0, vy: 0, vz: 100,
      surfaceMember: M(-60, 0, 100, 0, 0, 100), surfaceIncoming: true,
      analyticMember: M(0, 0, 100, 0, 60, 100), analyticIncoming: false,
      side: 'right', surfaceCriterion: FIXED(-0.5), analyticCriterion: REL(-0.25, -10),
      maxSearchDistance: 100, target: T90, buildMesh: true,
    });
    expect(corner.outcome).toBe('EXACT_COMMON_TIE');
    expect(corner.mesh?.valid).toBe(true);
    // Honest metrics: the corner fan carries the exact tie and joint ends.
    expect(corner.mesh!.planArea).toBeCloseTo(800, 9);
    expect(digest(corner.mesh)).toBe(digest(resolveSurfaceAnalyticCorner({
      vx: 0, vy: 0, vz: 100,
      surfaceMember: M(-60, 0, 100, 0, 0, 100), surfaceIncoming: true,
      analyticMember: M(0, 0, 100, 0, 60, 100), analyticIncoming: false,
      side: 'right', surfaceCriterion: FIXED(-0.5), analyticCriterion: REL(-0.25, -10),
      maxSearchDistance: 100, target: T90, buildMesh: true,
    }).mesh));
  });
});
