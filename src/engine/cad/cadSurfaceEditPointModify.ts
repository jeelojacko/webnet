import { orient2d } from 'robust-predicates';
import { TIN_EDGE_FREE } from './tin/tinTypes';
import { tinEdgeKey } from './tin/tinTopology';
import { earClip } from './cadSurfaceEditAddLine';
import { ensureEditEdgeSpatialIndex } from './cadEditEdgeSpatialIndex';
import {
  ensureEditPointLocationIndex,
  removeEditPointLocation,
} from './cadEditPointLocationIndex';
import {
  ccwEditTri,
  EditHalt,
  indexEditTri,
  kindOfEditEdge,
  unindexEditTri,
  type EditMeshState,
  type EditTri,
} from './cadSurfaceEditMesh';

/**
 * Phase 18T delete/move/elevation kernels (ENGINE ONLY).
 *
 * Delete-point (§17-21): only non-synthetic interior vertices — never
 * exterior/void boundary (edge with a single adjacent tri), never with an
 * incident source-constrained edge, only simple one-rings with ≥3 distinct
 * neighbors. The cavity is ear-clip retriangulated (boundary preserved, new
 * diagonals FREE) — never left as a hole.
 *
 * Move-point (§23-25): XY-only (Z unchanged), no retriangulation. Gates:
 * stable non-synthetic vertex, not on the boundary, no incident source
 * constraint, finite target, no coincidence, every incident triangle keeps
 * positive nonzero area/orientation (valid kernel), no proper crossings
 * with unrelated edges. User-added lines are non-source constraints, so
 * endpoint moves/deletes interact by stack order naturally (no special
 * casing here).
 *
 * Set-elevation (§26-27): absolute Z override, topology unchanged, allowed
 * on any addressable vertex incl. breakline endpoints. Raise/lower
 * (§28-29): deltaZ added to EVERY ACTIVE vertex at that replay position
 * (incl. synthetic), order-sensitive, no vertical-unit conversion.
 */

/** Edges (as [u,w] pairs) incident to v across its active one-ring. */
const incidentEdges = (state: EditMeshState, v: number): Array<[number, number]> => {
  const out: Array<[number, number]> = [];
  for (const id of state.vertTris.get(v) ?? []) {
    const tri = state.tris.get(id);
    if (!tri) continue;
    for (const [u, w] of [[tri[0], tri[1]], [tri[1], tri[2]], [tri[2], tri[0]]] as const) {
      if (u === v || w === v) out.push([u, w]);
    }
  }
  return out;
};

export const hasBoundaryEdge = (state: EditMeshState, v: number): boolean =>
  incidentEdges(state, v).some(([u, w]) => (state.edgeMap.get(tinEdgeKey(u, w)) ?? []).length < 2);

export const hasConstrainedEdge = (state: EditMeshState, v: number): boolean =>
  incidentEdges(state, v).some(([u, w]) => kindOfEditEdge(state, tinEdgeKey(u, w)) !== TIN_EDGE_FREE);

/** Distinct active neighbors of v (exact, no tolerance). */
const neighborsOf = (state: EditMeshState, v: number): number[] => {
  const set = new Set<number>();
  for (const [u, w] of incidentEdges(state, v)) {
    set.add(u === v ? w : u);
  }
  return [...set];
};

/**
 * Ordered one-ring polygon around v (follows the CCW successor map each
 * incident triangle contributes). Null when the ring is not simple.
 */
const orderedRing = (state: EditMeshState, v: number): number[] | null => {
  const next = new Map<number, number>();
  for (const id of state.vertTris.get(v) ?? []) {
    const tri = state.tris.get(id);
    if (!tri) continue;
    const at = tri.indexOf(v);
    if (at < 0) continue;
    const from = tri[(at + 1) % 3] as number;
    const to = tri[(at + 2) % 3] as number;
    if (next.has(from)) return null;
    next.set(from, to);
  }
  if (next.size < 3) return null;
  const start = [...next.keys()].sort((a, b) => a - b)[0] as number;
  const ring = [start];
  for (let guard = 0; guard < next.size; guard += 1) {
    const step = next.get(ring[ring.length - 1] as number);
    if (step === undefined) return null;
    if (step === start) return ring.length === next.size ? ring : null;
    if (ring.includes(step)) return null;
    ring.push(step);
  }
  return null;
};

/** Delete an interior vertex with cavity retriangulation; throws EditHalt. */
export const applyDeletePoint = (state: EditMeshState, v: number): void => {
  if (!state.active[v]) throw new EditHalt('SURFACE_EDIT_VERTEX_MISSING');
  if (hasBoundaryEdge(state, v)) throw new EditHalt('SURFACE_EDIT_DELETE_POINT_BOUNDARY');
  if (hasConstrainedEdge(state, v)) throw new EditHalt('SURFACE_EDIT_DELETE_POINT_CONSTRAINED');
  const ring = orderedRing(state, v);
  if (!ring || new Set(ring).size !== ring.length || ring.length < 3) {
    throw new EditHalt('SURFACE_EDIT_DELETE_POINT_CAVITY_INVALID');
  }
  for (const id of [...(state.vertTris.get(v) ?? [])]) {
    const tri = state.tris.get(id);
    if (!tri) continue;
    state.tris.delete(id);
    unindexEditTri(state, id, tri);
  }
  state.active[v] = false;
  removeEditPointLocation(state, v);
  for (const tri of earClip(state.pts, ring)) {
    const [a, b, c] = tri;
    if (a === v || b === v || c === v) throw new EditHalt('SURFACE_EDIT_DELETE_POINT_CAVITY_INVALID');
    const nid = state.nextTri++;
    const ccw = ccwEditTri(state.pts, a, b, c);
    state.tris.set(nid, ccw);
    indexEditTri(state, nid, ccw);
  }
};

/** Strict proper crossing (exact, no epsilon): nonzero opposite signs both ways. */
export const properlyCrosses = (
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number,
): boolean => {
  const o1 = orient2d(ax, ay, bx, by, cx, cy);
  const o2 = orient2d(ax, ay, bx, by, dx, dy);
  const o3 = orient2d(cx, cy, dx, dy, ax, ay);
  const o4 = orient2d(cx, cy, dx, dy, bx, by);
  return o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0 && (o1 > 0) !== (o2 > 0) && (o3 > 0) !== (o4 > 0);
};

/** Move a vertex in XY (Z unchanged); throws EditHalt. No retriangulation. */
export const applyMovePoint = (state: EditMeshState, v: number, x: number, y: number): void => {
  if (!state.active[v]) throw new EditHalt('SURFACE_EDIT_VERTEX_MISSING');
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new EditHalt('SURFACE_EDIT_MOVE_POINT_INVALID_STAR');
  if (hasBoundaryEdge(state, v)) throw new EditHalt('SURFACE_EDIT_MOVE_POINT_BOUNDARY');
  if (hasConstrainedEdge(state, v)) throw new EditHalt('SURFACE_EDIT_MOVE_POINT_CONSTRAINED');
  // Phase 18V: exact active-point location map (O(1)) replaces the
  // O(points) coincidence scan — same block answer, no tolerance.
  const coincident = ensureEditPointLocationIndex(state).find(x, y);
  if (coincident >= 0 && coincident !== v) {
    throw new EditHalt('SURFACE_EDIT_MOVE_POINT_INVALID_STAR');
  }
  const ring = state.vertTris.get(v);
  if (!ring || ring.size === 0) throw new EditHalt('SURFACE_EDIT_MOVE_POINT_INVALID_STAR');
  const vertex = state.pts[v];
  const oldX = vertex.x;
  const oldY = vertex.y;
  // Phase 18V: build/attach the spatial index BEFORE any coordinate
  // mutation, so a failed (reverted) move never leaves stale bboxes behind.
  const candidateIndex = ensureEditEdgeSpatialIndex(state);
  vertex.x = x;
  vertex.y = y;
  try {
    // Valid kernel: every incident triangle keeps positive nonzero area.
    // The target substitutes v AT ITS OWN position (a swap, not a cyclic
    // rotation, flips the orient sign — position matters).
    for (const id of ring) {
      const tri = state.tris.get(id) as EditTri;
      const at = tri.indexOf(v);
      if (at < 0) throw new EditHalt('SURFACE_EDIT_MOVE_POINT_INVALID_STAR');
      const sub = tri.map((w) => (w === v ? { x, y } : state.pts[w]));
      if (orient2d(sub[0].x, sub[0].y, sub[1].x, sub[1].y, sub[2].x, sub[2].y) >= 0) {
        throw new EditHalt('SURFACE_EDIT_MOVE_POINT_INVALID_STAR');
      }
    }
    // No proper crossings between moved edges and unrelated mesh edges.
    // Only edges touching v are skipped (they move with it); shared
    // endpoints elsewhere yield a zero orient, never a proper crossing.
    //
    // Phase 18V: candidate discovery only. The dynamic edge spatial index
    // replaces the global per-triangle scan with a segment-bbox query (a
    // guaranteed superset); properlyCrosses remains the exact authority and
    // the skip rule is byte-for-byte the legacy one. The index is built
    // lazily on the first move of a replay and updated after success.
    for (const w of neighborsOf(state, v)) {
      const pw = state.pts[w];
      const minX = Math.min(x, pw.x);
      const maxX = Math.max(x, pw.x);
      const minY = Math.min(y, pw.y);
      const maxY = Math.max(y, pw.y);
      for (const rec of candidateIndex.queryCandidates(minX, minY, maxX, maxY)) {
        if (rec.u === v || rec.v === v) continue;
        const p1 = state.pts[rec.u];
        const p2 = state.pts[rec.v];
        if (properlyCrosses(x, y, pw.x, pw.y, p1.x, p1.y, p2.x, p2.y)) {
          throw new EditHalt('SURFACE_EDIT_MOVE_POINT_INTERSECTION');
        }
      }
    }
    // Success: re-box every incident edge from the moved coordinates.
    candidateIndex.updateVertexEdges(v);
  } catch (error) {
    vertex.x = oldX;
    vertex.y = oldY;
    throw error;
  }
};

/** Absolute Z override (topology unchanged); throws EditHalt. */
export const applySetElevation = (state: EditMeshState, v: number, z: number): void => {
  if (!state.active[v]) throw new EditHalt('SURFACE_EDIT_VERTEX_MISSING');
  if (!Number.isFinite(z)) throw new EditHalt('SURFACE_EDIT_ELEVATION_INVALID');
  state.pts[v].z = z;
};

/** Add deltaZ to EVERY ACTIVE vertex (incl. synthetic); throws EditHalt. */
export const applyRaiseLower = (state: EditMeshState, deltaZ: number): void => {
  if (!Number.isFinite(deltaZ)) throw new EditHalt('SURFACE_EDIT_ELEVATION_INVALID');
  for (let i = 0; i < state.pts.length; i += 1) {
    if (state.active[i]) state.pts[i].z += deltaZ;
  }
};
