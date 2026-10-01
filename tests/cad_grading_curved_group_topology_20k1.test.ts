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
});

/**
 * Phase 20K.1 Wave B2 — fail-closed gate over the production engine.
 * E/F/G VERTEX_PINCH shapes fail the revision (existing GROUP_NON_MANIFOLD
 * code + PINCH detail), never CURRENT; valid A-D/straights stay CURRENT;
 * fully-tied courses keep the existing ALREADY_TIED ok path.
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

  it('E closed all-Distance fails FAILED, never CURRENT', () => {
    const square = roundedSquareMembers(10);
    const out = computeGradingGroupFromSnapshots({
      groupId: 'e', revision: 'r', members: square.map((m) => m.source),
      side: 'right', criterion: DIST(-0.5, 20),
      memberCriteria: [DIST(-0.5, 20), DIST(-0.5, 20), DIST(-0.5, 20), DIST(-0.5, 20)],
      maxSearchDistance: 100, curveChordTolerance: 0.1, closed: true,
    });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.code).toBe('GROUP_NON_MANIFOLD');
    expect(out.detail).toContain('GRADING_GROUP_ARC_SEAM_PINCH');
  });

  it('F mixed-analytic fails FAILED, never CURRENT', () => {
    const square = roundedSquareMembers(10);
    const out = computeGradingGroupFromSnapshots({
      groupId: 'f', revision: 'r', members: square.map((m) => m.source),
      side: 'right', criterion: DIST(-0.5, 20),
      memberCriteria: [DIST(-0.5, 20), ELEV(-0.5, 0), REL(-0.5, -10), DIST(-0.5, 20)],
      maxSearchDistance: 100, curveChordTolerance: 0.1, closed: true,
    });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.code).toBe('GROUP_NON_MANIFOLD');
    expect(out.detail).toContain('GRADING_GROUP_ARC_SEAM_PINCH');
  });

  it('G one-arc hybrid fails FAILED, never CURRENT', () => {
    const arc0 = roundedSquareMembers(10)[0]!.source;
    const out = computeGradingGroupFromSnapshots({
      groupId: 'g', revision: 'r',
      members: [arc0, straight(100, 0, 10, 100, 100, 10)],
      side: 'right', criterion: FIXED(-0.5),
      memberCriteria: [FIXED(-0.5), DIST(-0.5, 20)],
      maxSearchDistance: 100, curveChordTolerance: 0.1, closed: false,
      target: flatTin(0),
    });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.code).toBe('GROUP_NON_MANIFOLD');
    expect(out.detail).toContain('GRADING_GROUP_ARC_SEAM_PINCH');
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
