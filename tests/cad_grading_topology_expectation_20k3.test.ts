/**
 * Phase 20K.3 Wave A1 RED — extra-cycle + straight-group bypass (READ-ONLY).
 *
 * Pre-fix reproduction, zero src/ changes. Each `PRE-FIX:` comment freezes
 * the exact observed result on branch fix/phase20k3-surface-curve-authority-certificate
 * at 884b36e8. After the fix, the `ok:true` / `null` rows below must flip
 * (validator rejects undeclared cycles; straight groups run the seam gate;
 * certificates pin the declared loop budget instead of self-certifying).
 *
 * Authority gap under test:
 * - `validateGradingMeshTopology` only enforces `expectedBoundaryLoops` when
 *   the caller supplies it; otherwise ANY traversed cycle count passes.
 * - `buildGradingTopologyCertificate` defaults `expectedComponents` to the
 *   measured count (gradingTopologyCertificate.ts), so the product
 *   revalidation re-checks the mesh against its own observation (null-pass).
 * - `computeGradingGroupFromSnapshots` runs `validateMergedGroupTopology`
 *   only when `curved` (gradingGroupCompute.ts:746-753); straight-only
 *   groups keep the generic `validateGroupMesh` explicit-TIN check
 *   (gradingGroupMerge.ts:130 gate skipped).
 */
import { describe, expect, it } from 'vitest';

import { computeGradingGroupFromSnapshots } from '../src/engine/cad/grading/gradingGroupCompute';
import {
  mergeGroupTriangles,
  validateGroupMesh,
  validateMergedGroupTopology,
  type MergeTriangle,
} from '../src/engine/cad/grading/gradingGroupMerge';
import {
  buildGradingTopologyCertificateExact,
  gradingTopologyCertificateError,
  gradingTopologyCertificateProductError,
} from '../src/engine/cad/grading/gradingTopologyCertificate';
import { deriveGradingTopologyExpectation } from '../src/engine/cad/grading/gradingTopologyExpectation';
import { validateGradingMeshTopology } from '../src/engine/cad/grading/gradingTopology';
import type { ResolvedGradingSource } from '../src/engine/cad/grading/gradingTypes';

const stripPts = [0, 0, 0, 10, 0, 0, 10, 2, 0, 0, 2, 0];
const stripTris = [0, 1, 2, 0, 2, 3];

// Annular shell: outer 0..3, inner 4..7, 8-triangle band (1 component, 2 vertex-disjoint cycles).
const ringPts = [0, 0, 0, 4, 0, 0, 4, 4, 0, 0, 4, 0, 1, 1, 0, 3, 1, 0, 3, 3, 0, 1, 3, 0];
const ringTris = [0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7];

// Two disjoint quads: the second is offset +20/+20 (2 components, 2 cycles).
const tiedPts = [...stripPts, 20, 20, 0, 30, 20, 0, 30, 22, 0, 20, 22, 0];
const tiedTris = [...stripTris, 4, 5, 6, 4, 6, 7];

/** 6x6 plan grid with cells (1,1) and (3,3) punched: 1 component, 3 disjoint cycles. */
const gridWithTwoHoles = (): { points: number[]; triangles: number[] } => {
  const n = 6;
  const points: number[] = [];
  for (let y = 0; y < n; y += 1) for (let x = 0; x < n; x += 1) points.push(x, y, 0);
  const at = (x: number, y: number): number => y * n + x;
  const triangles: number[] = [];
  for (let y = 0; y < n - 1; y += 1) {
    for (let x = 0; x < n - 1; x += 1) {
      if ((x === 1 && y === 1) || (x === 3 && y === 3)) continue;
      const a = at(x, y);
      const b = at(x + 1, y);
      const c = at(x + 1, y + 1);
      const d = at(x, y + 1);
      triangles.push(a, b, c, a, c, d);
    }
  }
  return { points, triangles };
};

const straight = (
  sx: number, sy: number, ex: number, ey: number, sz = 10, ez = 10,
): ResolvedGradingSource => ({
  startX: sx, startY: sy, endX: ex, endY: ey, startZ: sz, endZ: ez,
  length: Math.hypot(ex - sx, ey - sy), reoriented: false, isArc: false,
});

const DIST = (distance: number): { kind: 'distance'; gradeRatio: number; distance: number } => ({
  kind: 'distance', gradeRatio: -0.5, distance,
});

describe('20K.3(a) standalone extra cycle now fails closed', () => {
  it('an undeclared loop budget is a measured probe only; 1/1 rejects the 2nd cycle', () => {
    const probe = validateGradingMeshTopology(ringPts, ringTris, {});
    // Raw probe still measures the actual topology (no declaration => no
    // budget); probing is never authority.
    expect(probe).toMatchObject({ ok: true, components: 1, boundaryCycles: 2 });
    // The declared standalone-strip budget (1 component / 1 cycle) rejects
    // the extra cycle.
    const r = validateGradingMeshTopology(ringPts, ringTris, {
      expectedComponents: 1, expectedBoundaryLoops: 1,
    });
    expect(r.ok).toBe(false);
    expect(r.code).toContain('PINCH');
    expect(`${r.code}: ${r.detail}`).toContain('cycle count 2 != expected 1');
  });

  it('gtop2 certificate refuses the extra cycle against the declared budget', () => {
    const expectation = deriveGradingTopologyExpectation({
      scope: 'standalone', closed: false, positiveWidthRegions: 1, tiedSplitCoords: [],
    });
    expect(expectation.expectedFaceComponents).toBe(1);
    expect(expectation.expectedBoundaryCycles).toBe(1);
    expect(buildGradingTopologyCertificateExact({
      scope: 'standalone', points: ringPts, triangles: ringTris, expectation,
    })).toBeNull();
  });
});

describe('20K.3(b) doubly-punctured shell now fails closed', () => {
  it('1-component mesh with a 3rd hole cycle is rejected against the 1/1 budget', () => {
    const { points, triangles } = gridWithTwoHoles();
    const probe = validateGradingMeshTopology(points, triangles, {});
    expect(probe).toMatchObject({ ok: true, components: 1, boundaryCycles: 3 });
    expect(probe.boundaryEdges).toBe(28);
    const r = validateGradingMeshTopology(points, triangles, {
      expectedComponents: 1, expectedBoundaryLoops: 1,
    });
    expect(r.ok).toBe(false);
    expect(r.code).toContain('PINCH');
  });

  it('gtop2 certificate refuses the 3rd cycle against the declared budget', () => {
    const { points, triangles } = gridWithTwoHoles();
    const expectation = deriveGradingTopologyExpectation({
      scope: 'standalone', closed: false, positiveWidthRegions: 1, tiedSplitCoords: [],
    });
    expect(buildGradingTopologyCertificateExact({
      scope: 'standalone', points, triangles, expectation,
    })).toBeNull();
  });
});

describe('20K.3(c) straight-only group runs the seam gate (GREEN)', () => {
  const quad = (ox: number, oy: number): MergeTriangle[] => [
    { a: { x: ox, y: oy, z: 0 }, b: { x: ox + 10, y: oy, z: 0 }, c: { x: ox + 10, y: oy + 2, z: 0 } },
    { a: { x: ox, y: oy, z: 0 }, b: { x: ox + 10, y: oy + 2, z: 0 }, c: { x: ox, y: oy + 2, z: 0 } },
  ];

  it('a grading-violating merged mesh fails the seam gate even without curves', () => {
    const merged = mergeGroupTriangles([...quad(0, 0), ...quad(20, 20)]);
    // The generic explicit-TIN check still passes (two clean quads are a fine
    // TIN); the grading seam gate is the one that rejects the 2-component shell.
    expect(validateGroupMesh(merged)).toBeNull();
    const gradingError = validateMergedGroupTopology(merged, []);
    expect(gradingError).not.toBeNull();
    expect(gradingError).toContain('GRADING_GROUP_ARC_SEAM_NON_MANIFOLD');
    expect(validateGradingMeshTopology(merged.points, merged.triangles, {}).ok).toBe(false);
  });

  it('straight-only closed square certifies the declared 1/2 annulus via gtop2', () => {
    const out = computeGradingGroupFromSnapshots({
      groupId: 'red-c', revision: 'ggrev1:red',
      members: [
        straight(0, 0, 100, 0), straight(100, 0, 100, 100),
        straight(100, 100, 0, 100), straight(0, 100, 0, 0),
      ],
      side: 'right', criterion: DIST(20),
      maxSearchDistance: 50, curveChordTolerance: 0.05, closed: true,
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result.corners.map((c) => c.classification)).toEqual(['GAP', 'GAP', 'GAP', 'GAP']);
    expect(out.result.gradingPlanArea).toBeCloseTo(9600, 6);
    // The straight-only path now runs the same seam gate as curved groups;
    // the closed pad band is certified against the explicit 1-component /
    // 2-cycle annulus declaration (outer + inner ring).
    const cert = out.result.topologyCertificate;
    expect(cert).toBeDefined();
    expect(cert).toMatchObject({
      version: 'gtop2', scope: 'group', components: 1, boundaryCycles: 2,
      expectedComponents: 1, expectedBoundaryCycles: 2,
    });
    expect(
      gradingTopologyCertificateError(cert, 'group', {
        points: out.result.gradingMesh.points, triangles: out.result.gradingMesh.triangles,
      }),
    ).toBeNull();
    expect(
      gradingTopologyCertificateProductError(cert, 'group', {
        points: out.result.gradingMesh.points, triangles: out.result.gradingMesh.triangles,
      }, {
        sourceBoundaryPoints: out.result.sourceBoundaryPoints,
        gradingBoundaryPoints: out.result.daylightPoints,
      }),
    ).toBeNull();
  });
});

describe('20K.3(d) valid controls still pass', () => {
  it('1-cycle strip ok', () => {
    const r = validateGradingMeshTopology(stripPts, stripTris, {
      expectedComponents: 1, expectedBoundaryLoops: 1,
    });
    expect(r).toMatchObject({ ok: true, components: 1, boundaryCycles: 1 });
  });

  it('2-cycle annulus ok', () => {
    const r = validateGradingMeshTopology(ringPts, ringTris, {
      expectedComponents: 1, expectedBoundaryLoops: 2,
    });
    expect(r).toMatchObject({ ok: true, components: 1, boundaryCycles: 2 });
  });

  it('tied split ok', () => {
    const r = validateGradingMeshTopology(tiedPts, tiedTris, {
      expectedComponents: 1, tiedSplitCoords: [20, 20, 0],
    });
    expect(r).toMatchObject({ ok: true, components: 2, boundaryCycles: 2 });
  });

  it('legacy straight GAP group ok', () => {
    const out = computeGradingGroupFromSnapshots({
      groupId: 'red-gap', revision: 'ggrev1:red',
      members: [straight(0, 0, 100, 0), straight(100, 0, 100, 100)],
      side: 'right', criterion: DIST(20),
      maxSearchDistance: 50, curveChordTolerance: 0.05, closed: false,
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result.corners.map((c) => c.classification)).toEqual(['GAP']);
  });

  it('legacy straight OVERLAP group ok', () => {
    const out = computeGradingGroupFromSnapshots({
      groupId: 'red-overlap', revision: 'ggrev1:red',
      members: [
        straight(0, 0, 100, 0), straight(100, 0, 100, 100),
        straight(100, 100, 0, 100), straight(0, 100, 0, 0),
      ],
      side: 'left', criterion: DIST(20),
      maxSearchDistance: 50, curveChordTolerance: 0.05, closed: true,
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result.corners.map((c) => c.classification)).toEqual(
      ['OVERLAP', 'OVERLAP', 'OVERLAP', 'OVERLAP'],
    );
  });
});
