/** Phase 20K.1 Wave B1 — topology validator contracts (6 cases, no gate). */
import { describe, expect, it } from 'vitest';
import { computeGradingGroupFromSnapshots } from '../src/engine/cad/grading/gradingGroupCompute';
import { validateGradingMeshTopology } from '../src/engine/cad/grading/gradingTopology';
import type { GradingCriterion, ResolvedGradingSource } from '../src/engine/cad/grading/gradingTypes';
import { computeGradingFromSnapshots } from '../src/workers/surfaceGradingCompute';
import {
  DIST,
  ELEV,
  FIXED,
  REL,
  flatTin,
  roundedSquareMembers,
} from '../scripts/phase20kHybridArcPairGroups';

// Quad strip (open): verts 0..3, two triangles.
const stripPts = [0, 0, 0, 10, 0, 0, 10, 2, 0, 0, 2, 0];
const stripTris = [0, 1, 2, 0, 2, 3];

// Annular shell: outer 0..3, inner 4..7, band of 8 triangles, 2 loops.
const ringPts = [0, 0, 0, 4, 0, 0, 4, 4, 0, 0, 4, 0, 1, 1, 0, 3, 1, 0, 3, 3, 0, 1, 3, 0];
const ringTris = [0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7];

describe('validateGradingMeshTopology', () => {
  it('valid open strip ok', () => {
    const r = validateGradingMeshTopology(stripPts, stripTris, { expectedComponents: 1, expectedBoundaryLoops: 1 });
    expect(r).toMatchObject({ ok: true, components: 1, loops: 1 });
  });
  it('valid annular shell ok', () => {
    const r = validateGradingMeshTopology(ringPts, ringTris, { expectedComponents: 1, expectedBoundaryLoops: 2 });
    expect(r).toMatchObject({ ok: true, components: 1, loops: 2 });
  });
  it('vertex pinch fails PINCH', () => {
    // Two quads sharing only vertex 0 (bowtie at a point).
    const pts = [0, 0, 0, 1, 0, 0, 1, 1, 0, -1, 0, 0, -1, -1, 0];
    const tris = [0, 1, 2, 0, 3, 4];
    const r = validateGradingMeshTopology(pts, tris, { expectedComponents: 1 });
    expect(r.ok).toBe(false);
    expect(r.code).toContain('PINCH');
  });
  it('duplicate face fails', () => {
    const r = validateGradingMeshTopology(stripPts, [0, 1, 2, 0, 1, 2], { expectedComponents: 1 });
    expect(r.ok).toBe(false);
    expect(r.code).toContain('NON_MANIFOLD');
  });
  it('two unexplained components fail NON_MANIFOLD', () => {
    const pts = [...stripPts, 20, 20, 0, 30, 20, 0, 30, 22, 0, 20, 22, 0];
    const tris = [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7];
    const r = validateGradingMeshTopology(pts, tris, { expectedComponents: 1 });
    expect(r).toMatchObject({ ok: false, components: 2 });
    expect(r.code).toContain('NON_MANIFOLD');
  });
  it('legitimate tied split ok', () => {
    const pts = [...stripPts, 20, 20, 0, 30, 20, 0, 30, 22, 0, 20, 22, 0];
    const tris = [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7];
    const r = validateGradingMeshTopology(pts, tris, { expectedComponents: 1, tiedSplitStations: [4] });
    expect(r.ok).toBe(true);
  });
  it('overlapping edge-adjacent pair fails', () => {
    // Two CCW triangles sharing edge 0-1 with both opposite verts (2, 3)
    // on the same plan side: interior double-cover, not a valid strip.
    const pts = [0, 0, 0, 4, 0, 0, 1, 1, 0, 3, 1, 0];
    const r = validateGradingMeshTopology(pts, [0, 1, 2, 0, 1, 3], { expectedComponents: 1 });
    expect(r.ok).toBe(false);
    expect(`${r.code}: ${r.detail}`).toContain('overlapping-connected-faces');
  });
  it('healthy GAP fan still passes', () => {
    // Three-face fan: adjacent pairs share an edge with opposite verts
    // on opposite sides.
    const pts = [1, 1, 0, 0, 0, 0, 4, 0, 0, 4, 4, 0, 0, 4, 0];
    const r = validateGradingMeshTopology(pts, [0, 1, 2, 0, 2, 3, 0, 3, 4], { expectedComponents: 1 });
    expect(r).toMatchObject({ ok: true, components: 1 });
  });
  it('unattributed extra component fails closed', () => {
    // Two triangles 10 units apart; station [0] touches only the first.
    const pts = [...stripPts, 20, 20, 0, 30, 20, 0, 30, 22, 0, 20, 22, 0];
    const tris = [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7];
    const r = validateGradingMeshTopology(pts, tris, { expectedComponents: 1, tiedSplitStations: [0] });
    expect(r).toMatchObject({ ok: false, components: 2 });
    expect(r.code).toContain('NON_MANIFOLD');
  });
  it('tied coordinates attribute a genuine split', () => {
    const pts = [...stripPts, 20, 20, 0, 30, 20, 0, 30, 22, 0, 20, 22, 0];
    const tris = [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7];
    const r = validateGradingMeshTopology(pts, tris, { expectedComponents: 1, tiedSplitCoords: [20, 20, 0] });
    expect(r.ok).toBe(true);
  });
  it('ragged buffer fails before the empty-mesh pass', () => {
    const r = validateGradingMeshTopology([], [0, 1], {});
    expect(r.ok).toBe(false);
    expect(r.code).toContain('NON_MANIFOLD');
  });
});

/**
 * Phase 20K.1 Wave B2 — fail-closed gate over the production engine.
 * G keeps failing the revision (existing GROUP_NON_MANIFOLD code + PINCH
 * detail), never CURRENT; valid A-D/straights stay CURRENT; fully-tied
 * courses keep the existing ALREADY_TIED ok path. Wave C1 cured E/F (same
 * gate now passes: 1 component, 2 loops), asserted CURRENT above.
 */
describe('20K.1 Wave B2 fail-closed topology gate', () => {
  const straight = (
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
  ): ResolvedGradingSource => ({
    startX: ax, startY: ay, endX: bx, endY: by, startZ: az, endZ: bz,
    length: Math.hypot(bx - ax, by - ay), reoriented: false, isArc: false,
  });

  const standalone = (source: ResolvedGradingSource, criterion: GradingCriterion, target?: boolean) =>
    computeGradingFromSnapshots({
      gradingId: 'g', revision: 'r', source, side: 'right',
      criterion, maxSearchDistance: 100, curveChordTolerance: 0.1,
      ...(target === true ? { target: flatTin(0) } : {}),
    });

  // 20K.1 Wave C1: analytic internal chord seams assemble (exact V,
  // analytic GAP ties) and joint vertices canonicalize, so E/F tile ONE
  // valid closed strip (1 component, 2 boundary loops, zero coincident
  // sets). Old->new: GROUP_NON_MANIFOLD/PINCH-8 FAILED -> CURRENT.
  const expectCuredClosedSquare = (out: unknown): void => {
    expect(out).toMatchObject({ ok: true });
    if (typeof out !== 'object' || out === null || !('result' in out)) throw new Error('expected ok result');
    const result = (out as { result: { gradingMesh: { points: number[]; triangles: number[] }; corners: Array<{ tiePointXyz: unknown }>; gradingPlanArea: number } }).result;
    const topo = validateGradingMeshTopology(result.gradingMesh.points, result.gradingMesh.triangles, { scope: 'group' });
    expect(topo).toMatchObject({ ok: true, components: 1, loops: 2 });
    expect(result.corners).toHaveLength(4);
    expect(result.gradingPlanArea).toBe(9452.12482633509);
  };

  it('E closed all-Distance now CURRENT via the C1 seam', () => {
    const square = roundedSquareMembers(10);
    const out = computeGradingGroupFromSnapshots({
      groupId: 'e', revision: 'r', members: square.map((m) => m.source),
      side: 'right', criterion: DIST(-0.5, 20),
      memberCriteria: [DIST(-0.5, 20), DIST(-0.5, 20), DIST(-0.5, 20), DIST(-0.5, 20)],
      maxSearchDistance: 100, curveChordTolerance: 0.1, closed: true,
    });
    expectCuredClosedSquare(out);
  });

  it('F mixed-analytic now CURRENT via the C1 seam', () => {
    const square = roundedSquareMembers(10);
    const out = computeGradingGroupFromSnapshots({
      groupId: 'f', revision: 'r', members: square.map((m) => m.source),
      side: 'right', criterion: DIST(-0.5, 20),
      memberCriteria: [DIST(-0.5, 20), ELEV(-0.5, 0), REL(-0.5, -10), DIST(-0.5, 20)],
      maxSearchDistance: 100, curveChordTolerance: 0.1, closed: true,
    });
    expectCuredClosedSquare(out);
  });

  it('G one-arc hybrid now CURRENT via the C2 seam (was B2-gated)', () => {
    const arc0 = roundedSquareMembers(10)[0]!.source;
    const out = computeGradingGroupFromSnapshots({
      groupId: 'g', revision: 'r',
      members: [arc0, straight(100, 0, 10, 100, 100, 10)],
      side: 'right', criterion: FIXED(-0.5),
      memberCriteria: [FIXED(-0.5), DIST(-0.5, 20)],
      maxSearchDistance: 100, curveChordTolerance: 0.1, closed: false,
      target: flatTin(0),
    });
    // 20K.1 Wave C2 old→new: the curved Surface member's internal seams
    // assemble (7 GAP ties), and the hybrid joint's exact GAP tie shares
    // indices with both strips — one edge-component, B2 gate passes.
    // Before: GROUP_NON_MANIFOLD + GRADING_GROUP_ARC_SEAM_PINCH (ec=2).
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result.gradingMesh.points.length / 3).toBe(43);
    expect(out.result.gradingMesh.triangles.length / 3).toBe(41);
    expect(out.result.gradingPlanArea).toBeCloseTo(4418.559246850815, 9);
    expect(out.result.corners).toHaveLength(1);
    expect(out.result.corners[0]!.classification).toBe('GAP');
    const tieG = out.result.corners[0]!.tiePointXyz!;
    expect(tieG[0]).toBe(120);
    expect(tieG[2]).toBe(0);
  });

  it('valid A-D curved standalones stay CURRENT', () => {
    const arc0 = roundedSquareMembers(10)[0]!.source;
    const cases: Array<[GradingCriterion, boolean]> = [
      [DIST(-0.5, 20), false],
      [ELEV(-0.5, 0), false],
      [REL(-0.5, -10), false],
      [FIXED(-0.5), true],
    ];
    for (const [criterion, needsTarget] of cases) {
      const out = standalone(arc0, criterion, needsTarget);
      expect(out.ok, JSON.stringify(criterion)).toBe(true);
    }
  });

  it('straight controls stay CURRENT', () => {
    const out = standalone(straight(0, 0, 10, 100, 0, 10), FIXED(-0.5), true);
    expect(out.ok).toBe(true);
    const group = computeGradingGroupFromSnapshots({
      groupId: 'i', revision: 'r',
      members: [
        straight(0, 0, 10, 100, 0, 10), straight(100, 0, 10, 100, 100, 10),
        straight(100, 100, 10, 0, 100, 10), straight(0, 100, 10, 0, 0, 10),
      ],
      side: 'right', criterion: FIXED(-0.5),
      memberCriteria: [FIXED(-0.5), FIXED(-0.5), FIXED(-0.5), FIXED(-0.5)],
      maxSearchDistance: 100, curveChordTolerance: 0.1, closed: true,
      target: flatTin(0),
    });
    expect(group.ok).toBe(true);
  });

  it('fully tied standalone keeps the ALREADY_TIED ok path', () => {
    const out = standalone(straight(0, 0, 10, 100, 0, 10), ELEV(-0.5, 10));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result.gradingMesh.triangles).toHaveLength(0);
    expect(out.result.diagnostics.map((d) => d.code)).toContain('ALREADY_TIED');
  });

  it('single-member all-tied group stays ok with an empty mesh', () => {
    const out = computeGradingGroupFromSnapshots({
      groupId: 't', revision: 'r', members: [straight(0, 0, 10, 100, 0, 10)],
      side: 'right', criterion: ELEV(-0.5, 10),
      maxSearchDistance: 50, curveChordTolerance: 0.05, closed: false,
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result.gradingMesh.triangles).toHaveLength(0);
  });
});
