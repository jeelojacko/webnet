/**
 * Phase 20C Wave-2A — group mesh merge + daylight assembly (pure).
 *
 * Trimmed member strip triangles plus gap-patch triangles merge into ONE
 * mesh: exact-XYZ dedupe, canonical face order, then the normal
 * `validateExplicitTinPayload` (fail GROUP_NON_MANIFOLD, never relaxed).
 * Daylight assembles to one continuous open path or one simple closed ring
 * (self-crossing rings fail GROUP_SELF_INTERSECTION). Areas/stats reuse the
 * 20B `gradingMesh` helpers.
 */
import { validateExplicitTinPayload } from '../cadImportedTin';
import { zeroDelta } from '../surfaces/volume/zero';
import { mesh3dArea, meshPlanArea, tieStats } from './gradingMesh';
import { validateGradingMeshTopology } from './gradingTopology';
import { lineSide, type SectorLine, type SectorPoint } from './gradingGroupSectors';

export interface MergePoint {
  x: number;
  y: number;
  z: number;
}

export interface MergeTriangle {
  a: MergePoint;
  b: MergePoint;
  c: MergePoint;
}

/** Barycentric Z of P on the plan projection of triangle t. */
const barycentricZ = (t: MergeTriangle, x: number, y: number): number => {
  const det = (t.b.x - t.a.x) * (t.c.y - t.a.y) - (t.c.x - t.a.x) * (t.b.y - t.a.y);
  if (Math.abs(det) <= zeroDelta(det, 0)) return (t.a.z + t.b.z + t.c.z) / 3;
  const l1 = ((x - t.a.x) * (t.c.y - t.a.y) - (y - t.a.y) * (t.c.x - t.a.x)) / det;
  const l2 = ((t.b.x - t.a.x) * (y - t.a.y) - (t.b.y - t.a.y) * (x - t.a.x)) / det;
  return t.a.z + l1 * (t.b.z - t.a.z) + l2 * (t.c.z - t.a.z);
};

/**
 * Exact linear XY clip of one triangle to a keep half-plane; Z of inserted
 * vertices interpolates barycentrically on the owning triangle (exact: the
 * triangle is planar). Zero-plan-area output is dropped.
 */
export const clipTriangleToHalfPlane = (
  t: MergeTriangle,
  line: SectorLine,
  keep: SectorPoint,
): MergeTriangle[] => {
  const keepSide = lineSide(line, keep.x, keep.y);
  const wantPositive = keepSide >= 0;
  const inside = (p: MergePoint): boolean => {
    const s = lineSide(line, p.x, p.y);
    return wantPositive ? s >= -zeroDelta(s, 0) : s <= zeroDelta(s, 0);
  };
  const cross = (a: MergePoint, b: MergePoint): MergePoint => {
    const sa = lineSide(line, a.x, a.y);
    const sb = lineSide(line, b.x, b.y);
    const tt = sa === sb ? 0 : sa / (sa - sb);
    const x = a.x + (b.x - a.x) * tt;
    const y = a.y + (b.y - a.y) * tt;
    return { x, y, z: barycentricZ(t, x, y) };
  };
  const verts = [t.a, t.b, t.c];
  const out: MergePoint[] = [];
  for (let i = 0; i < 3; i += 1) {
    const a = verts[i]!;
    const b = verts[(i + 1) % 3]!;
    const aIn = inside(a);
    const bIn = inside(b);
    if (aIn) out.push(a);
    if (aIn !== bIn) out.push(cross(a, b));
  }
  if (out.length < 3) return [];
  const result: MergeTriangle[] = [];
  for (let i = 1; i + 1 < out.length; i += 1) {
    const tri = { a: out[0]!, b: out[i]!, c: out[i + 1]! };
    const area2 = (tri.b.x - tri.a.x) * (tri.c.y - tri.a.y) - (tri.c.x - tri.a.x) * (tri.b.y - tri.a.y);
    if (Math.abs(area2) <= zeroDelta(area2, 0)) continue;
    result.push(tri);
  }
  return result;
};

export interface MergedGroupMesh {
  points: number[];
  triangles: number[];
}

/**
 * Merge triangles into ONE mesh: exact-XYZ dedupe, CCW plan winding,
 * canonical sorted face order. Empty input stays empty (all-tied groups).
 */
export const mergeGroupTriangles = (tris: MergeTriangle[]): MergedGroupMesh => {
  const indexByKey = new Map<string, number>();
  const points: number[] = [];
  const add = (p: MergePoint): number => {
    const key = `${p.x}|${p.y}|${p.z}`;
    const existing = indexByKey.get(key);
    if (existing !== undefined) return existing;
    const index = points.length / 3;
    points.push(p.x, p.y, p.z);
    indexByKey.set(key, index);
    return index;
  };
  const faces: Array<[number, number, number]> = [];
  const seen = new Set<string>();
  for (const t of tris) {
    const area2 = (t.b.x - t.a.x) * (t.c.y - t.a.y) - (t.c.x - t.a.x) * (t.b.y - t.a.y);
    if (Math.abs(area2) <= zeroDelta(area2, 0)) continue;
    const ids = area2 > 0 ? [add(t.a), add(t.b), add(t.c)] : [add(t.a), add(t.c), add(t.b)];
    const key = ids.join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    faces.push(ids as [number, number, number]);
  }
  faces.sort((p, q) => p[0] - q[0] || p[1] - q[1] || p[2] - q[2]);
  return { points, triangles: faces.flat() };
};

/**
 * Phase 20K.1 Wave B2 — fail-closed seam gate over the merged group mesh.
 * Null when the shared-index topology holds (empty meshes pass: all-tied
 * groups carry no mesh); otherwise a stable `CODE: detail` string for the
 * existing GROUP_NON_MANIFOLD failure. Each `tiedCoords` entry is a real
 * tied-station coordinate (flat XYZ): an empty final member strip
 * (fully tied source polyline) or an OVERLAP-trimmed joint tie point,
 * whose exact miter-seam clip leaves two pieces touching at seam vertices
 * by construction. Every extra edge-component must touch one — no
 * count-only budget (reviewer fix: unattributed extras fail closed).
 */
export interface MergedGroupTopologyExpectation {
  expectedComponents?: number;
  expectedBoundaryLoops?: number;
}

export const validateMergedGroupTopology = (
  mesh: MergedGroupMesh,
  tiedCoords: readonly number[] = [],
  expected: MergedGroupTopologyExpectation = {},
): string | null => {
  if (mesh.triangles.length === 0) return null;
  const topo = validateGradingMeshTopology(mesh.points, mesh.triangles, {
    scope: 'group',
    tiedSplitCoords: [...tiedCoords],
    ...(expected.expectedComponents !== undefined
      ? { expectedComponents: expected.expectedComponents }
      : {}),
    ...(expected.expectedBoundaryLoops !== undefined
      ? { expectedBoundaryLoops: expected.expectedBoundaryLoops }
      : {}),
  });
  if (topo.ok) return null;
  return `${topo.code}: ${topo.detail ?? ''}`;
};

/** Run the normal explicit-TIN validator; null when the mesh is acceptable. */
export const validateGroupMesh = (mesh: MergedGroupMesh): string | null => {
  if (mesh.triangles.length === 0) return null;
  return validateExplicitTinPayload({
    vertices: mesh.points,
    faces: mesh.triangles,
    provenance: { format: 'explicit', fileName: 'group', surfaceName: 'group' } as never,
  });
};

const pointsEqual = (a: MergePoint, b: MergePoint): boolean =>
  Math.abs(a.x - b.x) <= zeroDelta(a.x, b.x) &&
  Math.abs(a.y - b.y) <= zeroDelta(a.y, b.y) &&
  Math.abs(a.z - b.z) <= zeroDelta(a.z, b.z);

/** Concatenate daylight runs, dropping zeroDelta-duplicate joints. */
export const joinDaylightRuns = (runs: MergePoint[][]): MergePoint[] => {
  const out: MergePoint[] = [];
  for (const run of runs) {
    for (const p of run) {
      const prev = out[out.length - 1];
      if (!prev || !pointsEqual(prev, p)) out.push(p);
    }
  }
  return out;
};

const segmentsCross = (a: MergePoint, b: MergePoint, c: MergePoint, d: MergePoint): boolean => {
  const orient = (p: MergePoint, q: MergePoint, r: MergePoint): number => {
    const v = (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
    if (Math.abs(v) <= zeroDelta(v, 0)) return 0;
    return v > 0 ? 1 : -1;
  };
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  return o1 !== o2 && o3 !== o4;
};

/**
 * Closed-ring simplicity: no non-adjacent plan crossings (bow-ties fail,
 * never snap-healed). The closing edge is checked like any other.
 */
export const ringIsSimple = (ring: MergePoint[]): boolean => {
  const n = ring.length;
  if (n < 3) return false;
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const adjacent = j === i + 1 || (i === 0 && j === n - 1);
      if (adjacent) continue;
      if (segmentsCross(ring[i]!, ring[(i + 1) % n]!, ring[j]!, ring[(j + 1) % n]!)) return false;
    }
  }
  return true;
};

export interface GroupMeshStats {
  planArea: number;
  area3d: number;
  min: number;
  max: number;
  mean: number;
}

/** Plan/3D areas plus tie-distance stats over the merged mesh. */
export const groupMeshStats = (mesh: MergedGroupMesh, distances: number[]): GroupMeshStats => {
  const stats = tieStats(distances);
  if (mesh.triangles.length === 0) return { planArea: 0, area3d: 0, min: stats.min, max: stats.max, mean: stats.mean };
  return {
    planArea: meshPlanArea(mesh.points, mesh.triangles),
    area3d: mesh3dArea(mesh.points, mesh.triangles),
    min: stats.min,
    max: stats.max,
    mean: stats.mean,
  };
};

/**
 * Phase 20K.3 Wave B — shared analytic miter seam.
 *
 * The analytic OVERLAP trim clips each member strip against the corner
 * miter line independently, so the two sides discretize the SAME seam with
 * different stations: the merged mesh carries the seam twice (boundary
 * vertex degree 4, PINCH) even though both chains approximate one straight
 * segment with no double-cover (20C oracles bless areas). Sharing fixes the
 * indices, not the geometry: every vertex of either mesh lying on the
 * miter line joins one union set, and every on-line edge of either mesh is
 * split at the union points strictly inside its span (same point objects,
 * so exact-XYZ dedupe yields shared edges and the seam turns interior).
 * Splits are collinear sub-triangles of their parent — plan/3D areas,
 * ties, and corner provenance are untouched. Deterministic: union sorted
 * by line parameter, near-duplicate stations collapsed.
 */
export const shareMiterSeam = (
  inTris: MergeTriangle[],
  outTris: MergeTriangle[],
  line: SectorLine,
): { inTris: MergeTriangle[]; outTris: MergeTriangle[] } => {
  const spanTol = (x: number, y: number): number =>
    8 * Number.EPSILON * Math.max(1, Math.abs(x), Math.abs(y), Math.abs(line.vx), Math.abs(line.vy));
  const param = (p: MergePoint): number => (p.x - line.vx) * line.mx + (p.y - line.vy) * line.my;
  const dist = (p: MergePoint): number =>
    Math.abs((p.x - line.vx) * line.my - (p.y - line.vy) * line.mx);
  const onLine = (p: MergePoint): boolean => dist(p) <= spanTol(p.x, p.y);
  // Union of both meshes' on-line vertices, sorted by parameter.
  const keyOf = (p: MergePoint): string => `${p.x}|${p.y}|${p.z}`;
  const seen = new Map<string, MergePoint>();
  for (const tris of [inTris, outTris]) {
    for (const t of tris) {
      for (const p of [t.a, t.b, t.c]) {
        if (onLine(p) && !seen.has(keyOf(p))) seen.set(keyOf(p), p);
      }
    }
  }
  const ranked = [...seen.values()].sort((a, b) => param(a) - param(b) || (keyOf(a) < keyOf(b) ? -1 : 1));
  // Collapse ulp-twin stations: the two independent trims recompute the
  // same geometric station through different triangles, so twins land
  // ~1e-16 apart. Kept distinct they mis-sort (rounding noise) and the
  // fan zigzags into a fold; collapsed, both meshes share one object and
  // the seam edge is bit-identical. Genuine stations sit >> tolerance
  // apart (linearization spacing), so only twins merge.
  const union: MergePoint[] = [];
  for (const p of ranked) {
    const prev = union[union.length - 1];
    if (
      prev !== undefined &&
      Math.hypot(p.x - prev.x, p.y - prev.y) <=
        spanTol(p.x, p.y) + spanTol(prev.x, prev.y)
    ) {
      continue;
    }
    union.push(p);
  }
  if (union.length < 2) return { inTris, outTris };
  // Snap every on-line mesh vertex to its kept union representative, so
  // ulp-twins collapse to ONE shared object in both meshes (collapsing
  // the union list alone would leave each mesh holding its own twin).
  const snap = (p: MergePoint): MergePoint => {
    if (!onLine(p)) return p;
    let best: MergePoint | null = null;
    let bestDist = Infinity;
    for (const k of union) {
      const d = Math.hypot(p.x - k.x, p.y - k.y);
      if (d < bestDist) {
        bestDist = d;
        best = k;
      }
    }
    if (best !== null && bestDist <= spanTol(p.x, p.y) + spanTol(best.x, best.y)) return best;
    return p;
  };
  const snapped = (tris: MergeTriangle[]): MergeTriangle[] =>
    tris.map((t) => ({ a: snap(t.a), b: snap(t.b), c: snap(t.c) }));
  const inSnapped = snapped(inTris);
  const outSnapped = snapped(outTris);
  const between = (u: MergePoint, v: MergePoint): MergePoint[] => {
    const tu = param(u);
    const tv = param(v);
    const lo = Math.min(tu, tv);
    const hi = Math.max(tu, tv);
    const out: MergePoint[] = [];
    for (const q of union) {
      const tq = param(q);
      if (tq <= lo || tq >= hi) continue;
      if (keyOf(q) === keyOf(u) || keyOf(q) === keyOf(v)) continue;
      // Must sit on the segment, past rounding, and clear of the endpoints.
      if (dist(q) > spanTol(q.x, q.y) + spanTol(u.x, u.y) + spanTol(v.x, v.y)) continue;
      const du = Math.hypot(q.x - u.x, q.y - u.y);
      const dv = Math.hypot(q.x - v.x, q.y - v.y);
      if (du <= spanTol(q.x, q.y) + spanTol(u.x, u.y)) continue;
      if (dv <= spanTol(q.x, q.y) + spanTol(v.x, v.y)) continue;
      out.push(q);
    }
    out.sort((a, b) => (tv >= tu ? param(a) - param(b) : param(b) - param(a)));
    return out;
  };
  const share = (tris: MergeTriangle[]): MergeTriangle[] => {
    // Edge -> adjacent triangle indices (object identity; shared vertices
    // across the two meshes are distinct objects pre-merge — each mesh is
    // split at the union set independently, using the same point objects).
    const edgeKey = (p: MergePoint, q: MergePoint): string => {
      const kp = keyOf(p);
      const kq = keyOf(q);
      return kp < kq ? `${kp}~${kq}` : `${kq}~${kp}`;
    };
    const owners = new Map<string, number[]>();
    const edgeEnds = new Map<string, [MergePoint, MergePoint]>();
    tris.forEach((t, i) => {
      const edges: Array<[MergePoint, MergePoint]> = [[t.a, t.b], [t.b, t.c], [t.c, t.a]];
      for (const [p, q] of edges) {
        const key = edgeKey(p, q);
        const list = owners.get(key);
        if (list) list.push(i);
        else {
          owners.set(key, [i]);
          edgeEnds.set(key, [p, q]);
        }
      }
    });
    const splitAt = new Map<string, MergePoint[]>();
    for (const [key, [p, q]] of edgeEnds) {
      if (!onLine(p) || !onLine(q)) continue;
      const mid = between(p, q);
      if (mid.length > 0) splitAt.set(key, mid);
    }
    if (splitAt.size === 0) return tris;
    const result: MergeTriangle[] = [];
    tris.forEach((t) => {
      // A triangle with two on-line edges would have all three vertices
      // on the line (degenerate, already filtered), so at most one edge
      // per triangle splits.
      const edges: Array<[MergePoint, MergePoint, MergePoint]> = [
        [t.a, t.b, t.c], [t.b, t.c, t.a], [t.c, t.a, t.b],
      ];
      for (const [p, q, r] of edges) {
        const mid = splitAt.get(edgeKey(p, q));
        if (mid && mid.length > 0) {
          // Fan (p, q-chain, r) preserves the parent winding exactly.
          let prev = p;
          for (const s of mid) {
            result.push({ a: prev, b: s, c: r });
            prev = s;
          }
          result.push({ a: prev, b: q, c: r });
          return;
        }
      }
      result.push(t);
    });
    return result;
  };
  return { inTris: share(inSnapped), outTris: share(outSnapped) };
};
