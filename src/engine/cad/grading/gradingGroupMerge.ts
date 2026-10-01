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
export const validateMergedGroupTopology = (
  mesh: MergedGroupMesh,
  tiedCoords: readonly number[] = [],
): string | null => {
  if (mesh.triangles.length === 0) return null;
  const topo = validateGradingMeshTopology(mesh.points, mesh.triangles, {
    scope: 'group',
    tiedSplitCoords: [...tiedCoords],
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
