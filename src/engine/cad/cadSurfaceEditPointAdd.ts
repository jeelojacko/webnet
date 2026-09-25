import { orient2d } from 'robust-predicates';
import { TIN_EDGE_FREE } from './tin/tinTypes';
import { tinEdgeKey } from './tin/tinTopology';
import {
  appendEditPoint,
  ccwEditTri,
  EditHalt,
  editPointIdOf,
  indexEditTri,
  kindOfEditEdge,
  sortedEditTriIds,
  unindexEditTri,
  type EditMeshState,
  type EditTri,
} from './cadSurfaceEditMesh';

/**
 * Phase 18T add-point kernel (ENGINE ONLY): insert a surface-local point.
 *
 * Policy (§10-15): strictly-inside a retained triangle → split ABC into
 * ABP/BCP/CAP; exactly-on a FREE interior edge → 2 tris become 4. Fail
 * closed: outside domain/voids (POINT_OUTSIDE_DOMAIN), on exterior/void
 * boundary edges (POINT_ON_BOUNDARY), on source-constrained edges
 * (BLOCKED_CONSTRAINT — the constraint is never split), coincident XY with
 * any ACTIVE vertex incl. different Z (POINT_ALREADY_EXISTS — TIN is 2.5D).
 * Robust orient2d predicates; no survey tolerance (exact XY equality).
 */

/** Raw-coordinate orient (same library convention as editOrient: CCW < 0). */
const orientXy = (
  ax: number, ay: number, bx: number, by: number, cx: number, cy: number,
): number => orient2d(ax, ay, bx, by, cx, cy);

const pointOf = (state: EditMeshState, index: number): { x: number; y: number } =>
  state.pts[index] as { x: number; y: number };

/** Exact-XY coincidence with any ACTIVE vertex (2.5D — Z is irrelevant). */
const findCoincident = (state: EditMeshState, x: number, y: number): number => {
  for (let i = 0; i < state.pts.length; i += 1) {
    if (!state.active[i]) continue;
    const p = state.pts[i];
    if (p.x === x && p.y === y) return i;
  }
  return -1;
};

interface LocatedInside { where: 'inside'; tri: number; }
interface LocatedEdge { where: 'edge'; e1: number; e2: number; adj: number[]; }
type Located = LocatedInside | LocatedEdge;

/**
 * Locate (x,y): strictly-inside exactly one retained triangle, or exactly-on
 * one mesh edge. Triangles are math-CCW, so interior ⟺ all three edge
 * orients ≤ 0 (exact). Anything else (outside, void, hole) → miss.
 */
const locate = (state: EditMeshState, x: number, y: number): Located | null => {
  let edgeHit: { e1: number; e2: number } | null = null;
  for (const id of sortedEditTriIds(state)) {
    const tri = state.tris.get(id) as EditTri;
    const [a, b, c] = tri;
    const pa = pointOf(state, a);
    const pb = pointOf(state, b);
    const pc = pointOf(state, c);
    const o1 = orientXy(pa.x, pa.y, pb.x, pb.y, x, y);
    const o2 = orientXy(pb.x, pb.y, pc.x, pc.y, x, y);
    const o3 = orientXy(pc.x, pc.y, pa.x, pa.y, x, y);
    if (o1 <= 0 && o2 <= 0 && o3 <= 0) {
      const zeros = (o1 === 0 ? 1 : 0) + (o2 === 0 ? 1 : 0) + (o3 === 0 ? 1 : 0);
      if (zeros === 0) return { where: 'inside', tri: id };
      // On-vertex (zeros ≥ 2) is pre-empted by the coincidence scan for
      // active vertices; keep the first edge hit otherwise.
      if (zeros === 1 && !edgeHit) {
        const [e1, e2] = o1 === 0 ? [a, b] : o2 === 0 ? [b, c] : [c, a];
        edgeHit = { e1, e2 };
      }
    }
  }
  if (!edgeHit) return null;
  const key = tinEdgeKey(edgeHit.e1, edgeHit.e2);
  return { where: 'edge', e1: edgeHit.e1, e2: edgeHit.e2, adj: [...(state.edgeMap.get(key) ?? [])] };
};

/** Split interior triangle (a,b,c) around new vertex p (all CCW-enforced). */
const splitInside = (state: EditMeshState, id: number, tri: EditTri, p: number): void => {
  const [a, b, c] = tri;
  state.tris.delete(id);
  unindexEditTri(state, id, tri);
  for (const next of [ccwEditTri(state.pts, a, b, p), ccwEditTri(state.pts, b, c, p), ccwEditTri(state.pts, c, a, p)]) {
    const nid = state.nextTri++;
    state.tris.set(nid, next);
    indexEditTri(state, nid, next);
  }
};

/** Split one triangle (a,b,c) with p on edge (e1,e2) into two (CCW-enforced). */
const splitOnEdge = (state: EditMeshState, id: number, tri: EditTri, e1: number, e2: number, p: number): void => {
  const w = tri.find((v) => v !== e1 && v !== e2);
  if (w === undefined) throw new EditHalt('SURFACE_EDIT_NOT_APPLICABLE');
  state.tris.delete(id);
  unindexEditTri(state, id, tri);
  for (const next of [ccwEditTri(state.pts, e1, p, w), ccwEditTri(state.pts, p, e2, w)]) {
    const nid = state.nextTri++;
    state.tris.set(nid, next);
    indexEditTri(state, nid, next);
  }
};

/** Insert an edit-local point; throws EditHalt on any policy block. */
export const applyAddPoint = (
  state: EditMeshState,
  editId: string,
  x: number,
  y: number,
  z: number,
): number => {
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new EditHalt('SURFACE_EDIT_POINT_OUTSIDE_DOMAIN');
  if (!Number.isFinite(z)) throw new EditHalt('SURFACE_EDIT_ELEVATION_INVALID');
  if (findCoincident(state, x, y) >= 0) throw new EditHalt('SURFACE_EDIT_POINT_ALREADY_EXISTS');
  const id = editPointIdOf(state.surfaceId, editId);
  if (state.byId.has(id)) throw new EditHalt('SURFACE_EDIT_NOT_APPLICABLE');
  const found = locate(state, x, y);
  if (!found) throw new EditHalt('SURFACE_EDIT_POINT_OUTSIDE_DOMAIN');
  if (found.where === 'inside') {
    const p = appendEditPoint(state, { id, x, y, z });
    splitInside(state, found.tri, state.tris.get(found.tri) as EditTri, p);
    return p;
  }
  const key = tinEdgeKey(found.e1, found.e2);
  if (found.adj.length !== 2) throw new EditHalt('SURFACE_EDIT_POINT_ON_BOUNDARY');
  if (kindOfEditEdge(state, key) !== TIN_EDGE_FREE) throw new EditHalt('SURFACE_EDIT_BLOCKED_CONSTRAINT');
  const carriedUserLine = state.userLines.has(key);
  const p = appendEditPoint(state, { id, x, y, z });
  for (const triId of [...found.adj]) {
    const tri = state.tris.get(triId);
    if (!tri) throw new EditHalt('SURFACE_EDIT_NOT_APPLICABLE');
    splitOnEdge(state, triId, tri, found.e1, found.e2, p);
  }
  if (carriedUserLine) {
    state.userLines.delete(key);
    state.userLines.add(tinEdgeKey(found.e1, p));
    state.userLines.add(tinEdgeKey(p, found.e2));
  }
  return p;
};
