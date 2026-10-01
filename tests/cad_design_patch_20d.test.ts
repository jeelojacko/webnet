/**
 * Phase 20D Wave-1B — Design Patch pure build oracles.
 *
 * Hand-built flat pad + synthetic 140x140 annulus pin the exact merge
 * arithmetic (10000 interior + 9600 shell = 19600 plan). Every failure path
 * (non-flat interior, ring/mesh mismatch, concave hull leak) is asserted by
 * its named block code. Curved sources pin that the ring reuses the same
 * `linearizeGradingArc` discretization and disclose `CURVE_APPROXIMATED`.
 */
import { describe, expect, it } from 'vitest';
import { computeGradingGroupFromSnapshots } from '../src/engine/cad/grading/gradingGroupCompute';
import { resolveCadFeatureLine } from '../src/engine/cad/cadFeatureLines';
import { resolveGradingSourceCourse, toGradingCourseLikes } from '../src/engine/cad/grading/gradingCourseFrame';
import { linearizeGradingArc } from '../src/engine/cad/grading/gradingCurve';
import type { CadFeatureLineEntity } from '../src/engine/cad/cadTypes';
import type { CadGradingGroup } from '../src/engine/cad/grading/gradingGroupTypes';
import type { GradingMesh, ResolvedGradingSource } from '../src/engine/cad/grading/gradingTypes';
import type { GradingTargetMeshSnapshot } from '../src/engine/cad/grading/gradingComputeTypes';
import {
  buildPadInterior,
  checkFlatRing,
  deriveSourceRing,
  makeDesignPatchProvenance,
  mergePadWithGrading,
  validateSourceRing,
  verifyRingAgainstMesh,
} from '../src/engine/cad/grading/designPatchBuild';

const planArea = (points: readonly number[], triangles: readonly number[]): number => {
  let sum = 0;
  for (let i = 0; i + 2 < triangles.length; i += 3) {
    const a = triangles[i]! * 3;
    const b = triangles[i + 1]! * 3;
    const c = triangles[i + 2]! * 3;
    sum += (points[b]! - points[a]!) * (points[c + 1]! - points[a + 1]!) -
      (points[c]! - points[a]!) * (points[b + 1]! - points[a + 1]!);
  }
  return Math.abs(sum) / 2;
};

const pointInPolygon = (x: number, y: number, ring: readonly number[]): boolean => {
  const n = ring.length / 3;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i, i += 1) {
    const xi = ring[i * 3]!;
    const yi = ring[i * 3 + 1]!;
    const xj = ring[j * 3]!;
    const yj = ring[j * 3 + 1]!;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

const squareLine = (id: string, a: string, b: string): CadFeatureLineEntity => ({
  id,
  type: 'feature-line',
  layerId: 'general',
  visible: true,
  locked: false,
  closed: true,
  vertices: [
    { id: 'A', x: 0, y: 0, z: 10 },
    { id: 'B', x: 100, y: 0, z: 10 },
    { id: 'C', x: 100, y: 100, z: 10 },
    { id: 'D', x: 0, y: 100, z: 10 },
  ],
  segmentGeometry: [{ kind: 'line' }, { kind: 'line' }, { kind: 'line' }, { kind: 'line' }],
  name: a,
  description: b,
});

const squareGroup = (): CadGradingGroup => ({
  id: 'g-square',
  name: 'Pad',
  sourceFeatureLineId: 'fl-square',
  sourceCourses: [
    { vertexAId: 'A', vertexBId: 'B' },
    { vertexAId: 'B', vertexBId: 'C' },
    { vertexAId: 'C', vertexBId: 'D' },
    { vertexAId: 'D', vertexBId: 'A' },
  ],
  targetSurfaceId: 'eg',
  side: 'right',
  criterion: { kind: 'fixed', gradeRatio: -0.5 },
  maxSearchDistance: 50,
  curveChordTolerance: 0.05,
  cornerMode: 'miter',
  closed: true,
});

/** Mitered 140x140 shell around the 100x100 source ring (inner z=10, outer z=0). */
const squareAnnulus = (): GradingMesh => {
  const inner = [[0, 0, 10], [100, 0, 10], [100, 100, 10], [0, 100, 10]];
  const outer = [[-20, -20, 0], [120, -20, 0], [120, 120, 0], [-20, 120, 0]];
  const points = [...inner.flat(), ...outer.flat()];
  const triangles: number[] = [];
  for (let i = 0; i < 4; i += 1) {
    const next = (i + 1) % 4;
    triangles.push(4 + i, 4 + next, next, 4 + i, next, i);
  }
  return { points, triangles };
};

const expectRing = (out: ReturnType<typeof deriveSourceRing>): number[] => {
  if (!out.ok) throw new Error(`expected ring, got ${out.code} ${out.detail}`);
  return out.ring;
};

describe('(a) flat 100x100 pad merges with the 140x140 shell', () => {
  const ring = expectRing(deriveSourceRing(
    squareGroup(), squareLine('fl-square', 'Square', 'flat pad'), 0.05,
  ));

  it('derives the canonical closed source ring at the shared Z', () => {
    expect(ring).toEqual([0, 0, 10, 100, 0, 10, 100, 100, 10, 0, 100, 10]);
    expect(validateSourceRing(ring)).toEqual({ ok: true });
    expect(checkFlatRing(ring)).toEqual({ ok: true, padZ: 10 });
  });

  it('ear-clips a 10000 m² interior with CCW faces', () => {
    const pad = buildPadInterior(ring, 10);
    if (!pad.ok) throw new Error(`expected pad, got ${pad.code}`);
    expect(pad.padTriangles).toHaveLength(6);
    expect(planArea(pad.padPoints, pad.padTriangles)).toBeCloseTo(10000, 9);
    for (const p of pad.padPoints.filter((_, i) => i % 3 === 2)) expect(p).toBe(10);
  });

  it('shares every ring edge with the grading shell exactly', () => {
    expect(verifyRingAgainstMesh(ring, squareAnnulus())).toEqual({ ok: true });
  });

  it('merges to the 19600 m² pad+shell with a valid payload', () => {
    const pad = buildPadInterior(ring, 10);
    if (!pad.ok) throw new Error('expected pad');
    const merged = mergePadWithGrading(pad.padPoints, pad.padTriangles, squareAnnulus());
    if (!merged.ok) throw new Error(`expected merge, got ${merged.code} ${merged.detail}`);
    expect(planArea(merged.points, merged.triangles)).toBeCloseTo(19600, 9);
    const zs = new Set(merged.points.filter((_, i) => i % 3 === 2));
    expect([...zs].sort((x, y) => x - y)).toEqual([0, 10]);
    for (let i = 0; i + 2 < merged.triangles.length; i += 3) {
      const cx = (merged.points[merged.triangles[i]! * 3]! + merged.points[merged.triangles[i + 1]! * 3]! + merged.points[merged.triangles[i + 2]! * 3]!) / 3;
      const cy = (merged.points[merged.triangles[i]! * 3 + 1]! + merged.points[merged.triangles[i + 1]! * 3 + 1]! + merged.points[merged.triangles[i + 2]! * 3 + 1]!) / 3;
      if (cx > 0 && cx < 100 && cy > 0 && cy < 100) {
        for (const index of [merged.triangles[i]!, merged.triangles[i + 1]!, merged.triangles[i + 2]!]) {
          expect(merged.points[index * 3 + 2]).toBe(10);
        }
      }
    }
  });

  it('builds the exact design-patch provenance shape', () => {
    expect(makeDesignPatchProvenance({
      groupId: 'g-square', groupName: 'Pad', groupRevision: 'ggrev1:x',
      sourceFeatureLineId: 'fl-square', sourceCourseRefs: ['A>B', 'B>C', 'C>D', 'D>A'],
      targetSurfaceId: 'eg', targetSurfaceRevision: 'egrev1:y', accuracy: 'EXACT',
    })).toEqual({
      kind: 'webnet-grading-design-patch',
      groupId: 'g-square', groupName: 'Pad', groupRevision: 'ggrev1:x',
      sourceFeatureLineId: 'fl-square', sourceCourseRefs: ['A>B', 'B>C', 'C>D', 'D>A'],
      targetSurfaceId: 'eg', targetSurfaceRevision: 'egrev1:y',
      accuracy: 'EXACT', cornerMode: 'miter', includesInterior: true, interiorPolicy: 'flat-source',
    });
  });
});

describe('(b) concave L pad keeps the notch (no convex-hull leak)', () => {
  const lRing = [0, 0, 10, 60, 0, 10, 60, 40, 10, 30, 40, 10, 30, 80, 10, 0, 80, 10];

  it('triangulates exactly the 3600 m² L polygon', () => {
    expect(validateSourceRing(lRing)).toEqual({ ok: true });
    const pad = buildPadInterior(lRing, 10);
    if (!pad.ok) throw new Error(`expected pad, got ${pad.code}`);
    expect(pad.padTriangles).toHaveLength((lRing.length / 3 - 2) * 3);
    expect(planArea(pad.padPoints, pad.padTriangles)).toBeCloseTo(3600, 9);
    for (let i = 0; i + 2 < pad.padTriangles.length; i += 3) {
      const cx = (pad.padPoints[pad.padTriangles[i]! * 3]! + pad.padPoints[pad.padTriangles[i + 1]! * 3]! + pad.padPoints[pad.padTriangles[i + 2]! * 3]!) / 3;
      const cy = (pad.padPoints[pad.padTriangles[i]! * 3 + 1]! + pad.padPoints[pad.padTriangles[i + 1]! * 3 + 1]! + pad.padPoints[pad.padTriangles[i + 2]! * 3 + 1]!) / 3;
      expect(pointInPolygon(cx, cy, lRing)).toBe(true);
    }
  });
});

describe('(c) fail-closed gates', () => {
  const square = [0, 0, 10, 100, 0, 10, 100, 100, 10, 0, 100, 10];

  it('blocks a non-flat interior with a named code', () => {
    const out = checkFlatRing([0, 0, 10, 100, 0, 10, 100, 100, 11, 0, 100, 10]);
    expect(out).toEqual({ ok: false, code: 'DESIGN_PATCH_NON_FLAT_INTERIOR_UNDEFINED', detail: 'vertex 2 Z differs' });
  });

  it('blocks duplicate XY and self-crossing rings', () => {
    expect(validateSourceRing([0, 0, 10, 50, 0, 10, 50, 0, 10, 100, 100, 10]))
      .toMatchObject({ ok: false, code: 'DESIGN_PATCH_NON_SIMPLE_RING' });
    const bowtie = [0, 0, 10, 100, 100, 10, 100, 0, 10, 0, 100, 10];
    expect(validateSourceRing(bowtie)).toMatchObject({ ok: false, code: 'DESIGN_PATCH_NON_SIMPLE_RING' });
    // Explicit closing vertex repeats the first: the ring is implicitly closed.
    expect(validateSourceRing([0, 0, 10, 100, 0, 10, 100, 100, 10, 0, 100, 10, 0, 0, 10]))
      .toMatchObject({ ok: false, code: 'DESIGN_PATCH_NON_SIMPLE_RING' });
  });

  it('blocks a ring vertex that does not exist in the grading mesh', () => {
    const mesh = squareAnnulus();
    mesh.points[0] = 0.0000001;
    expect(verifyRingAgainstMesh(square, mesh)).toMatchObject({
      ok: false, code: 'DESIGN_PATCH_RING_MESH_MISMATCH',
    });
  });

  it('blocks a shell that does not share a source edge exactly once', () => {
    const mesh = squareAnnulus();
    // Drop the bottom shell triangle -> the A->B ring edge is no longer shared.
    mesh.triangles = mesh.triangles.slice(3);
    const pad = buildPadInterior(square, 10);
    if (!pad.ok) throw new Error('expected pad');
    expect(mergePadWithGrading(pad.padPoints, pad.padTriangles, mesh)).toMatchObject({
      ok: false, code: 'DESIGN_PATCH_MERGE_FAILED',
    });
  });

  it('blocks a non-closed group', () => {
    const group = squareGroup();
    group.closed = false;
    expect(deriveSourceRing(group, squareLine('fl-square', 'x', 'y'), 0.05)).toMatchObject({
      ok: false, code: 'DESIGN_PATCH_SOURCE_UNRESOLVED',
    });
  });
});

describe('(d) curved source reuses the group linearizer', () => {
  const curvedEntity: CadFeatureLineEntity = {
    id: 'fl-curved',
    type: 'feature-line',
    layerId: 'general',
    visible: true,
    locked: false,
    closed: true,
    vertices: [
      { id: 'A', x: 0, y: 0, z: 10 },
      { id: 'B', x: 100, y: 0, z: 10 },
      { id: 'C', x: 100, y: 100, z: 10 },
      { id: 'D', x: 0, y: 100, z: 10 },
    ],
    segmentGeometry: [{ kind: 'arc', bulge: 0.5 }, { kind: 'line' }, { kind: 'line' }, { kind: 'line' }],
  };
  const curvedGroup: CadGradingGroup = {
    ...squareGroup(),
    id: 'g-curved',
    sourceFeatureLineId: 'fl-curved',
  };

  it('emits the exact linearizeGradingArc chord samples', () => {
    const resolved = resolveCadFeatureLine(curvedEntity)!;
    const member = resolveGradingSourceCourse(toGradingCourseLikes(resolved.courses), 'A', 'B') as ResolvedGradingSource;
    const linearized = linearizeGradingArc(
      member.arc!.centerX, member.arc!.centerY, member.arc!.radius,
      member.arc!.startAngle, member.arc!.endAngle, member.arc!.sweepCCW,
      member.startZ, member.endZ, 0.01,
    )!;
    expect(linearized.subdivisions).toBeGreaterThan(1);
    const expected = [
      ...linearized.points.slice(0, linearized.subdivisions).flatMap((p) => [p.x, p.y, p.z]),
      100, 0, 10, 100, 100, 10, 0, 100, 10,
    ];
    const out = deriveSourceRing(curvedGroup, curvedEntity, 0.01);
    expect(out).toEqual({ ok: true, ring: expected });
  });
});

describe('(e) accuracy disclosure matches the group result', () => {
  const arcSource = (cx: number, cy: number, r: number, a0: number, a1: number): ResolvedGradingSource => ({
    startX: cx + r * Math.cos(a0), startY: cy + r * Math.sin(a0),
    endX: cx + r * Math.cos(a1), endY: cy + r * Math.sin(a1),
    startZ: 1010, endZ: 1010, length: r * Math.abs(a1 - a0), reoriented: false, isArc: true,
    arc: { centerX: cx, centerY: cy, radius: r, startAngle: a0, endAngle: a1, sweepCCW: a1 > a0 },
  });
  const target = (): GradingTargetMeshSnapshot => {
    const xs: number[] = [];
    const ys: number[] = [];
    for (let v = -60; v <= 110; v += 10) xs.push(v);
    for (let v = -60; v <= 190; v += 10) ys.push(v);
    const points: number[] = [];
    for (const y of ys) for (const x of xs) points.push(x, y, 1000);
    const triangles: number[] = [];
    const idx = (ix: number, iy: number): number => iy * xs.length + ix;
    for (let ix = 0; ix + 1 < xs.length; ix += 1) {
      for (let iy = 0; iy + 1 < ys.length; iy += 1) {
        const a = idx(ix, iy);
        const b = idx(ix + 1, iy);
        const c = idx(ix + 1, iy + 1);
        const d = idx(ix, iy + 1);
        triangles.push(a, b, c, a, c, d);
      }
    }
    return { points, triangles };
  };

  it('fails a curved joint at the seam gate yet carries CURVE_APPROXIMATED into provenance', () => {
    const ex = 50 * Math.cos(Math.PI / 2);
    const ey = 50 * Math.sin(Math.PI / 2);
    const result = computeGradingGroupFromSnapshots({
      groupId: 'g-curve', revision: 'ggrev1:t',
      members: [
        arcSource(0, 0, 50, 0, Math.PI / 2),
        {
          startX: ex, startY: ey, endX: ex, endY: 150, startZ: 1010, endZ: 1010,
          length: 150 - ey, reoriented: false, isArc: false,
        },
      ],
      side: 'left', criterion: { kind: 'fixed', gradeRatio: -0.5 },
      maxSearchDistance: 50, curveChordTolerance: 0.05, closed: false, target: target(),
    });
    // 20K.1 Wave C2 old→new: the curved Surface member's internal seams
    // assemble and the GAP corner tie shares indices — one edge-component,
    // B2 gate passes, revision CURRENT. Before: GROUP_NON_MANIFOLD +
    // GRADING_GROUP_ARC_SEAM_PINCH (ec=3).
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.gradingMesh.points.length / 3).toBe(80);
    expect(result.result.gradingMesh.triangles.length / 3).toBe(78);
    expect(result.result.gradingPlanArea).toBeCloseTo(3656.32023028, 8);
    expect(result.result.accuracy).toBe('CURVE_APPROXIMATED');
    // Accuracy disclosure stays a pure provenance passthrough.
    expect(makeDesignPatchProvenance({
      groupId: 'g-curve', groupName: 'Curve', groupRevision: 'ggrev1:t',
      sourceFeatureLineId: 'fl-curve', sourceCourseRefs: ['A>B'],
      targetSurfaceId: 'eg', targetSurfaceRevision: 'egrev1:t', accuracy: 'CURVE_APPROXIMATED',
    }).accuracy).toBe('CURVE_APPROXIMATED');
  });
});
