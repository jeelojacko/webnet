/**
 * Phase 20K.2 Wave A — real boundary-cycle contract (agent tier, fast).
 *
 * Wave A1 RED (pre-fix `traceLoops` connected-component counting false-passes,
 * recorded honestly from the unfixed validator):
 *   bowtie  (deg-4 vertex, 2 tris sharing 1 vertex):  ok:true components:2 loops:1
 *   sharedv (2 quads sharing 1 vertex, tied):         ok:true components:2 loops:1
 *   slit    (self-touching 8-edge cycle, dup coords): ok:true components:1 loops:1
 *   tspike  (T-branch, boundary vertex degree 4):     ok:true components:2 loops:1
 *   xquads  (2 disjoint quads, cycles cross in plan): ok:true components:2 loops:2
 *   cw      (single clockwise triangle):              ok:true components:1 loops:1
 * Every row above now fails closed; the two valid rows (strip, annulus)
 * still pass with identical component counts.
 *
 * Notes: open-chain (degree-1) and odd-degree (degree-3) boundary vertices
 * are unrepresentable from incidence<=2 triangle input (boundary degrees are
 * always even: each face contributes 0/2 boundary edges at a manifold vertex,
 * 4+ at a pinch), so those classes are pinned at the graph level on
 * `traceBoundaryCycles`, which is also where repeated-edge input is covered
 * (the incidence map can never emit a duplicate boundary edge). The
 * non-adjacent face-overlap audit stays O(F^2) test-only evidence, never the
 * production path.
 */
import { describe, expect, it } from 'vitest';

import {
  traceBoundaryCycles,
  validateGradingMeshTopology,
} from '../src/engine/cad/grading/gradingTopology';

const stripPts = [0, 0, 0, 10, 0, 0, 10, 2, 0, 0, 2, 0];
const stripTris = [0, 1, 2, 0, 2, 3];

const ringPts = [0, 0, 0, 4, 0, 0, 4, 4, 0, 0, 4, 0, 1, 1, 0, 3, 1, 0, 3, 3, 0, 1, 3, 0];
const ringTris = [0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7];

describe('traceBoundaryCycles (graph level)', () => {
  it('traverses a valid 4-cycle edge-by-edge', () => {
    const t = traceBoundaryCycles([[0, 1], [1, 2], [2, 3], [3, 0]]);
    expect(t).toMatchObject({ components: 1, violations: [] });
    expect(t.cycles).toHaveLength(1);
    expect([...t.cycles[0]!].sort()).toEqual([0, 1, 2, 3]);
  });

  it('rejects an open chain (degree-1 ends)', () => {
    const t = traceBoundaryCycles([[0, 1], [1, 2]]);
    expect(t.components).toBe(1);
    expect(t.cycles).toHaveLength(0);
    expect(t.violations.join(';')).toMatch(/degree 1/);
  });

  it('rejects a degree-3 branch', () => {
    const t = traceBoundaryCycles([[0, 1], [0, 2], [0, 3]]);
    expect(t.cycles).toHaveLength(0);
    expect(t.violations.join(';')).toMatch(/degree 3/);
  });

  it('rejects a degree-4 figure-eight vertex', () => {
    const t = traceBoundaryCycles([[0, 1], [1, 2], [2, 0], [0, 3], [3, 4], [4, 0]]);
    expect(t.components).toBe(1);
    expect(t.cycles).toHaveLength(0);
    expect(t.violations.join(';')).toMatch(/degree 4/);
  });

  it('rejects a repeated edge (2-vertex non-cycle)', () => {
    const t = traceBoundaryCycles([[0, 1], [0, 1]]);
    expect(t.cycles).toHaveLength(0);
    expect(t.violations).not.toHaveLength(0);
  });

  it('counts disjoint components separately', () => {
    const t = traceBoundaryCycles([[0, 1], [1, 2], [2, 0], [3, 4], [4, 5], [5, 3]]);
    expect(t).toMatchObject({ components: 2, violations: [] });
    expect(t.cycles).toHaveLength(2);
  });
});

describe('validateGradingMeshTopology boundary cycles', () => {
  it('valid one-cycle open strip reports perimeter cycle + plan area', () => {
    const r = validateGradingMeshTopology(stripPts, stripTris, { expectedComponents: 1, expectedBoundaryLoops: 1 });
    expect(r).toMatchObject({ ok: true, components: 1, boundaryEdges: 4, loops: 1, boundaryComponents: 1, boundaryCycles: 1 });
    expect(r.cycles).toHaveLength(1);
    expect(r.cycles[0]!.vertexCount).toBe(4);
    expect(Math.abs(r.cycles[0]!.signedPlanArea)).toBe(20);
    expect(r.totalPlanArea).toBe(20);
  });

  it('valid two-cycle annular shell reports both cycles', () => {
    const r = validateGradingMeshTopology(ringPts, ringTris, { expectedComponents: 1, expectedBoundaryLoops: 2 });
    expect(r).toMatchObject({ ok: true, components: 1, boundaryCycles: 2, boundaryComponents: 2 });
    expect(r.cycles.map((c) => c.vertexCount).sort()).toEqual([4, 4]);
    expect(r.totalPlanArea).toBe(12);
  });

  it('figure-eight bowtie fails (was loops:1 ok:true)', () => {
    const r = validateGradingMeshTopology(
      [0, 0, 0, 1, 0, 0, 1, 1, 0, -1, 0, 0, -1, -1, 0], [0, 1, 2, 0, 3, 4],
      { expectedComponents: 2 },
    );
    expect(r.ok).toBe(false);
    expect(r.code).toContain('PINCH');
    expect(`${r.code}: ${r.detail}`).toMatch(/degree 4/);
  });

  it('two cycles sharing one vertex fail (was loops:1 ok:true)', () => {
    const r = validateGradingMeshTopology(
      [0, 0, 0, 4, 0, 0, 4, 4, 0, 0, 4, 0, 10, 0, 0, 10, 10, 0, 0, 10, 0],
      [0, 1, 2, 0, 2, 3, 0, 4, 5, 0, 5, 6],
      { expectedComponents: 2, tiedSplitStations: [4] },
    );
    expect(r.ok).toBe(false);
    expect(r.code).toContain('PINCH');
  });

  it('T-branch spike fails (was loops:1 ok:true)', () => {
    const r = validateGradingMeshTopology(
      [0, 0, 0, 2, 0, 0, 6, 0, 0, 6, 6, 0, 0, 6, 0, 2, -3, 0, 4, -3, 0, 4, 0, 0],
      [0, 1, 4, 1, 2, 3, 1, 3, 4, 1, 6, 7, 1, 5, 6],
      { expectedComponents: 2, tiedSplitStations: [5] },
    );
    expect(r.ok).toBe(false);
    expect(r.code).toContain('PINCH');
    expect(`${r.code}: ${r.detail}`).toMatch(/degree 4/);
  });

  it('self-touching slit cycle fails (was loops:1 ok:true)', () => {
    const r = validateGradingMeshTopology(
      [0, 0, 0, 2, 0, 0, 4, 0, 0, 4, 4, 0, 2, 4, 0, 2, 2, 0, 2, 4, 0, 0, 4, 0],
      [0, 1, 5, 1, 2, 3, 1, 3, 5, 3, 4, 5, 0, 5, 7, 7, 5, 6],
      { expectedComponents: 1 },
    );
    expect(r.ok).toBe(false);
    expect(r.code).toContain('PINCH');
    expect(`${r.code}: ${r.detail}`).toMatch(/self-cross/);
  });

  it('two geometrically crossing cycles fail (was loops:2 ok:true)', () => {
    const r = validateGradingMeshTopology(
      [0, 0, 0, 4, 0, 0, 4, 4, 0, 0, 4, 0, 2, -1, 0, 6, -1, 0, 6, 3, 0, 2, 3, 0],
      [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7],
      { expectedComponents: 2, tiedSplitStations: [4] },
    );
    expect(r.ok).toBe(false);
    expect(r.code).toContain('PINCH');
    expect(`${r.code}: ${r.detail}`).toMatch(/cycles 0\/1 cross/);
  });

  it('clockwise (negative-area) face fails (was ok:true)', () => {
    const r = validateGradingMeshTopology([0, 0, 0, 1, 0, 0, 0, 1, 0], [0, 2, 1], { expectedComponents: 1 });
    expect(r.ok).toBe(false);
    expect(r.code).toContain('NON_MANIFOLD');
    expect(r.detail).toMatch(/negative-area face 0/);
  });

  it('zero-area face still fails', () => {
    const r = validateGradingMeshTopology([0, 0, 0, 2, 0, 0, 1, 0, 0], [0, 1, 2], { expectedComponents: 1 });
    expect(r).toMatchObject({ ok: false });
    expect(r.code).toContain('NON_MANIFOLD');
  });

  it('duplicate face still fails', () => {
    const r = validateGradingMeshTopology(stripPts, [0, 1, 2, 0, 1, 2], { expectedComponents: 1 });
    expect(r.ok).toBe(false);
    expect(r.code).toContain('NON_MANIFOLD');
  });

  it('incidence >2 still fails', () => {
    const r = validateGradingMeshTopology(
      [0, 0, 0, 4, 0, 0, 1, 1, 0, 3, 1, 0, 2, 2, 0],
      [0, 1, 2, 0, 1, 3, 0, 1, 4],
      { expectedComponents: 1 },
    );
    expect(r.ok).toBe(false);
    expect(r.code).toContain('NON_MANIFOLD');
    expect(r.detail).toMatch(/shared by >2 faces/);
  });

  it('edge-adjacent fold still fails', () => {
    const r = validateGradingMeshTopology(
      [0, 0, 0, 4, 0, 0, 1, 1, 0, 3, 1, 0], [0, 1, 2, 0, 1, 3],
      { expectedComponents: 1 },
    );
    expect(r.ok).toBe(false);
    expect(`${r.code}: ${r.detail}`).toContain('overlapping-connected-faces');
  });

  it('expectedBoundaryLoops now counts valid cycles', () => {
    const r = validateGradingMeshTopology(stripPts, stripTris, { expectedComponents: 1, expectedBoundaryLoops: 2 });
    expect(r.ok).toBe(false);
    expect(r.code).toContain('PINCH');
    expect(r.detail).toMatch(/cycle count 1 != expected 2/);
  });

  it('deprecated loops stays the boundary-component count', () => {
    const r = validateGradingMeshTopology(ringPts, ringTris, { expectedComponents: 1 });
    expect(r.loops).toBe(r.boundaryComponents);
  });

  it('single-point touch at a tied station passes (CUT/FILL tied seam)', () => {
    // Two quads meeting at exactly (2,2) with distinct indices: valid cycles,
    // one geometric touch point. Tied-attributed -> benign measure-zero seam.
    const pts = [0, 0, 0, 2, 0, 0, 2, 2, 0, 0, 2, 0, 2, 2, 0, 4, 2, 0, 4, 4, 0, 2, 4, 0];
    const tris = [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7];
    const tied = { expectedComponents: 2, tiedSplitCoords: [2, 2, 0] };
    const r = validateGradingMeshTopology(pts, tris, tied);
    expect(r).toMatchObject({ ok: true, components: 2, boundaryCycles: 2 });
  });

  it('same single-point touch without ties still fails', () => {
    const pts = [0, 0, 0, 2, 0, 0, 2, 2, 0, 0, 2, 0, 2, 2, 0, 4, 2, 0, 4, 4, 0, 2, 4, 0];
    const tris = [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7];
    const r = validateGradingMeshTopology(pts, tris, { expectedComponents: 2 });
    expect(r.ok).toBe(false);
    expect(r.code).toContain('PINCH');
  });
});

/**
 * Wave A1 RED replay. The pre-fix `traceLoops` validator accepted on the
 * boundary-graph component count alone: `ok = components === expectedComponents`
 * (plus an optional `expectedBoundaryLoops` check against that same component
 * count). No cycle traversal, vertex degree, or geometric predicate existed.
 * `loops` below is the deprecated field that still reports that old component
 * count; each defect row was a false pass (`ok:true`) with the count shown.
 * The replay asserts the fixed validator now rejects every defect row and
 * still accepts the two valid rows.
 */
describe('Wave A1 RED replay (pre-fix component-count acceptance)', () => {
  const replay = (
    points: number[],
    triangles: number[],
    expectedComponents: number,
    expectedBoundaryLoops?: number,
  ): { ok: boolean; components: number; loops: number } => {
    const r = validateGradingMeshTopology(points, triangles, { expectedComponents, expectedBoundaryLoops });
    // Pre-fix acceptance reconstructed from the two fields the old code read.
    const preFixOk =
      r.components === expectedComponents &&
      (expectedBoundaryLoops === undefined || r.loops === expectedBoundaryLoops);
    return { ok: preFixOk, components: r.components, loops: r.loops };
  };

  it('bowtie: one boundary component mislabeled one loop was accepted', () => {
    const r = validateGradingMeshTopology(
      [0, 0, 0, 1, 0, 0, 1, 1, 0, -1, 0, 0, -1, -1, 0], [0, 1, 2, 0, 3, 4],
      { expectedComponents: 2 },
    );
    expect(r.ok).toBe(false);
    expect(r.loops).toBe(1);
    expect(replay([0, 0, 0, 1, 0, 0, 1, 1, 0, -1, 0, 0, -1, -1, 0], [0, 1, 2, 0, 3, 4], 2).ok).toBe(true);
  });

  it('degree-4 shared vertex: one boundary component mislabeled one loop was accepted', () => {
    const pts = [0, 0, 0, 4, 0, 0, 4, 4, 0, 0, 4, 0, 10, 0, 0, 10, 10, 0, 0, 10, 0];
    const tris = [0, 1, 2, 0, 2, 3, 0, 4, 5, 0, 5, 6];
    const r = validateGradingMeshTopology(pts, tris, { expectedComponents: 2, tiedSplitStations: [4] });
    expect(r.ok).toBe(false);
    expect(r.loops).toBe(1);
    expect(replay(pts, tris, 2).ok).toBe(true);
  });

  it('slit self-touch: one boundary component mislabeled one loop was accepted', () => {
    const pts = [0, 0, 0, 2, 0, 0, 4, 0, 0, 4, 4, 0, 2, 4, 0, 2, 2, 0, 2, 4, 0, 0, 4, 0];
    const tris = [0, 1, 5, 1, 2, 3, 1, 3, 5, 3, 4, 5, 0, 5, 7, 7, 5, 6];
    const r = validateGradingMeshTopology(pts, tris, { expectedComponents: 1 });
    expect(r.ok).toBe(false);
    expect(r.loops).toBe(1);
    expect(replay(pts, tris, 1).ok).toBe(true);
  });

  it('T-branch spike: one boundary component mislabeled one loop was accepted', () => {
    const pts = [0, 0, 0, 2, 0, 0, 6, 0, 0, 6, 6, 0, 0, 6, 0, 2, -3, 0, 4, -3, 0, 4, 0, 0];
    const tris = [0, 1, 4, 1, 2, 3, 1, 3, 4, 1, 6, 7, 1, 5, 6];
    const r = validateGradingMeshTopology(pts, tris, { expectedComponents: 2, tiedSplitStations: [5] });
    expect(r.ok).toBe(false);
    expect(r.loops).toBe(1);
    expect(replay(pts, tris, 2).ok).toBe(true);
  });

  it('crossing cycles: two components/two loops was accepted', () => {
    const pts = [0, 0, 0, 4, 0, 0, 4, 4, 0, 0, 4, 0, 2, -1, 0, 6, -1, 0, 6, 3, 0, 2, 3, 0];
    const tris = [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7];
    const r = validateGradingMeshTopology(pts, tris, { expectedComponents: 2, tiedSplitStations: [4] });
    expect(r.ok).toBe(false);
    expect(r.loops).toBe(2);
    expect(replay(pts, tris, 2).ok).toBe(true);
  });

  it('valid strip/annulus still accepted (pre-fix counts unchanged)', () => {
    expect(replay(stripPts, stripTris, 1, 1)).toEqual({ ok: true, components: 1, loops: 1 });
    expect(replay(ringPts, ringTris, 1, 2)).toEqual({ ok: true, components: 1, loops: 2 });
  });
});

/** O(F^2) non-adjacent overlap audit: TEST-ONLY evidence, never production. */
const auditNonAdjacentOverlap = (points: number[], triangles: number[]): string[] => {
  const hits: string[] = [];
  const triXY = (f: number): Array<[number, number]> =>
    [0, 1, 2].map((k) => {
      const v = triangles[f * 3 + k]!;
      return [points[v * 3]!, points[v * 3 + 1]!] as [number, number];
    });
  const orient = (a: [number, number], b: [number, number], c: [number, number]): number =>
    Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]));
  const properCross = (a: [number, number], b: [number, number], c: [number, number], d: [number, number]): boolean =>
    orient(a, b, c) * orient(a, b, d) < 0 && orient(c, d, a) * orient(c, d, b) < 0;
  const inTri = (p: [number, number], t: Array<[number, number]>): boolean => {
    const s = [orient(t[0]!, t[1]!, p), orient(t[1]!, t[2]!, p), orient(t[2]!, t[0]!, p)];
    return (s[0]! >= 0 && s[1]! >= 0 && s[2]! >= 0) || (s[0]! <= 0 && s[1]! <= 0 && s[2]! <= 0);
  };
  const shareEdge = (f: number, g: number): boolean => {
    const vf = [triangles[f * 3]!, triangles[f * 3 + 1]!, triangles[f * 3 + 2]!];
    const vg = [triangles[g * 3]!, triangles[g * 3 + 1]!, triangles[g * 3 + 2]!];
    return vf.filter((v) => vg.includes(v)).length >= 2;
  };
  const n = triangles.length / 3;
  for (let f = 0; f < n; f += 1) {
    for (let g = f + 1; g < n; g += 1) {
      if (shareEdge(f, g)) continue;
      const tf = triXY(f);
      const tg = triXY(g);
      let overlap = tf.some((p) => inTri(p, tg)) || tg.some((p) => inTri(p, tf));
      for (let e = 0; e < 3 && !overlap; e += 1) {
        for (let k = 0; k < 3 && !overlap; k += 1) {
          overlap = properCross(tf[e]!, tf[(e + 1) % 3]!, tg[k]!, tg[(k + 1) % 3]!);
        }
      }
      if (overlap) hits.push(`faces ${f}/${g} overlap without sharing an edge`);
    }
  }
  return hits;
};

describe('non-adjacent overlap (test-only evidence)', () => {
  it('flags plan double-cover the production path intentionally ignores', () => {
    // Small quad strictly inside a big quad (different Z): boundaries never
    // touch, so the O(B^2) boundary check passes, but plan area double-covers.
    const pts = [0, 0, 0, 10, 0, 0, 10, 10, 0, 0, 10, 0, 2, 2, 1, 4, 2, 1, 4, 4, 1, 2, 4, 1];
    const tris = [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7];
    const r = validateGradingMeshTopology(pts, tris, { expectedComponents: 2, tiedSplitStations: [4] });
    expect(r.ok).toBe(true);
    expect(auditNonAdjacentOverlap(pts, tris).length).toBeGreaterThan(0);
  });

  it('coincident-boundary stacking now fails closed in production', () => {
    // Two identical-plan quads at different Z: inter-cycle overlap rejects.
    const pts = [...stripPts, 0, 0, 1, 10, 0, 1, 10, 2, 1, 0, 2, 1];
    const tris = [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7];
    const r = validateGradingMeshTopology(pts, tris, { expectedComponents: 2, tiedSplitStations: [4] });
    expect(r.ok).toBe(false);
    expect(r.code).toContain('PINCH');
  });

  it('clean strip has no non-adjacent overlap', () => {
    expect(auditNonAdjacentOverlap(stripPts, stripTris)).toEqual([]);
  });
});
