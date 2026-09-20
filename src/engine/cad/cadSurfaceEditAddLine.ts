import { TIN_EDGE_FREE } from './tin/tinTypes';
import { tinEdgeKey } from './tin/tinTopology';
import {
  ccwEditTri,
  editOrient,
  editStraddles,
  kindOfEditEdge,
  refreshEditEdges,
  sortedEditTriIds,
  EditHalt,
  type CadSurfaceEditMeshPoint,
  type EditMeshState,
  type EditTri,
} from './cadSurfaceEditMesh';

/**
 * Phase 18S add-line kernel (ENGINE ONLY): local deterministic
 * retriangulation of the crossed FREE region. The existing
 * constrained-segment recovery kernel operates on local-frame Delaunay build
 * state and could not be factored cheaply for post-build replay, so the
 * crossed cavity is walked exactly (orient2d, no epsilon) and each side is
 * ear-clipped with the new edge forced.
 */

const triEdges = (tri: EditTri): Array<readonly [number, number]> => [
  [tri[0], tri[1]],
  [tri[1], tri[2]],
  [tri[2], tri[0]],
];

/** Ear-clip a simple CCW-or-CW polygon (exact predicates, deterministic first-ear order). */
const earClip = (pts: CadSurfaceEditMeshPoint[], polygon: number[]): EditTri[] => {
  let area2 = 0;
  for (let i = 0; i < polygon.length; i += 1) {
    const a = pts[polygon[i]];
    const b = pts[polygon[(i + 1) % polygon.length]];
    area2 += (b.x - a.x) * (b.y + a.y);
  }
  const verts = area2 > 0 ? [...polygon].reverse() : [...polygon];
  const out: EditTri[] = [];
  let guard = 0;
  while (verts.length > 3) {
    guard += 1;
    if (guard > polygon.length * polygon.length + 10) throw new EditHalt('SURFACE_EDIT_NOT_APPLICABLE');
    let found = -1;
    for (let i = 0; i < verts.length; i += 1) {
      const a = verts[(i - 1 + verts.length) % verts.length];
      const b = verts[i];
      const c = verts[(i + 1) % verts.length];
      // CCW polygon: convex ears are left turns (orient2d negative — see mesh note).
      if (editOrient(pts, a, b, c) >= 0) continue;
      let blocked = false;
      for (const w of verts) {
        if (w === a || w === b || w === c) continue;
        if (editOrient(pts, a, b, w) <= 0 && editOrient(pts, b, c, w) <= 0 && editOrient(pts, c, a, w) <= 0) {
          blocked = true;
          break;
        }
      }
      if (!blocked) {
        found = i;
        break;
      }
    }
    if (found < 0) throw new EditHalt('SURFACE_EDIT_NOT_APPLICABLE');
    const a = verts[(found - 1 + verts.length) % verts.length];
    const b = verts[found];
    const c = verts[(found + 1) % verts.length];
    out.push([a, b, c]);
    verts.splice(found, 1);
  }
  out.push(ccwEditTri(pts, verts[0], verts[1], verts[2]));
  return out;
};

const withinBBox = (pts: CadSurfaceEditMeshPoint[], f: number, t: number, w: number): boolean =>
  w !== f &&
  w !== t &&
  pts[w].x >= Math.min(pts[f].x, pts[t].x) &&
  pts[w].x <= Math.max(pts[f].x, pts[t].x) &&
  pts[w].y >= Math.min(pts[f].y, pts[t].y) &&
  pts[w].y <= Math.max(pts[f].y, pts[t].y);

/** Connect two existing vertices across FREE triangles; the new edge is forced into the mesh. */
export const applyAddLine = (state: EditMeshState, f: number, t: number): void => {
  if (f === t) throw new EditHalt('SURFACE_EDIT_NOT_APPLICABLE');
  if ((state.edgeMap.get(tinEdgeKey(f, t)) ?? []).length > 0) {
    throw new EditHalt('SURFACE_EDIT_NOT_APPLICABLE');
  }
  const pts = state.pts;
  for (let w = 0; w < pts.length; w += 1) {
    if (w === f || w === t) continue;
    if (editOrient(pts, f, t, w) === 0 && withinBBox(pts, f, t, w)) {
      throw new EditHalt('SURFACE_EDIT_INTERMEDIATE_VERTEX');
    }
  }
  // Walk the crossed FREE region: entry at vertex f, then edge-interior to
  // edge-interior crossings (no vertex can lie on the open segment).
  const ids = sortedEditTriIds(state);
  let start = -1;
  for (const id of ids) {
    const tri = state.tris.get(id) as EditTri;
    const at = tri.indexOf(f);
    if (at < 0 || tri.includes(t)) continue;
    const nxt = tri[(at + 1) % 3];
    const prv = tri[(at + 2) % 3];
    // Interior cone at f: left of f->nxt, right of f->prv (orient2d negative = CCW).
    if (editOrient(pts, f, nxt, t) < 0 && editOrient(pts, f, prv, t) > 0) {
      start = id;
      break;
    }
    if (editOrient(pts, f, nxt, t) === 0 || editOrient(pts, f, prv, t) === 0) {
      throw new EditHalt('SURFACE_EDIT_NOT_APPLICABLE');
    }
  }
  if (start < 0) throw new EditHalt('SURFACE_EDIT_NOT_APPLICABLE');
  const crossed: number[] = [];
  let cur = start;
  let entryKey: string | null = null;
  for (let guard = 0; guard <= ids.length; guard += 1) {
    const tri = state.tris.get(cur) as EditTri;
    if (tri.includes(t)) {
      crossed.push(cur);
      break;
    }
    let exit: { key: string; to: number } | null = null;
    for (const [u, v] of triEdges(tri)) {
      const key = tinEdgeKey(u, v);
      if (key === entryKey || u === f || v === f || u === t || v === t) continue;
      if (
        editStraddles(editOrient(pts, f, t, u), editOrient(pts, f, t, v)) &&
        editStraddles(editOrient(pts, u, v, f), editOrient(pts, u, v, t))
      ) {
        if (exit) throw new EditHalt('SURFACE_EDIT_NOT_APPLICABLE');
        exit = { key, to: -1 };
      }
    }
    if (!exit) throw new EditHalt('SURFACE_EDIT_NOT_APPLICABLE');
    if (kindOfEditEdge(state, exit.key) !== TIN_EDGE_FREE) {
      throw new EditHalt('SURFACE_EDIT_BLOCKED_CONSTRAINT');
    }
    const nb = (state.edgeMap.get(exit.key) ?? []).filter((id) => id !== cur);
    if (nb.length !== 1) throw new EditHalt('SURFACE_EDIT_NOT_APPLICABLE');
    exit.to = nb[0];
    crossed.push(cur);
    entryKey = exit.key;
    cur = exit.to;
    if (guard === ids.length) throw new EditHalt('SURFACE_EDIT_NOT_APPLICABLE');
  }
  // Cavity boundary: edges used exactly once; both endpoints lie on it.
  const counts = new Map<string, { n: number; u: number; v: number }>();
  for (const id of crossed) {
    for (const [u, v] of triEdges(state.tris.get(id) as EditTri)) {
      const key = tinEdgeKey(u, v);
      const at = counts.get(key);
      if (at) at.n += 1;
      else counts.set(key, { n: 1, u, v });
    }
  }
  const neighbours = new Map<number, number[]>();
  for (const { n, u, v } of [...counts.values()]) {
    if (n !== 1) continue;
    neighbours.set(u, [...(neighbours.get(u) ?? []), v]);
    neighbours.set(v, [...(neighbours.get(v) ?? []), u]);
  }
  const loop: number[] = [f];
  let prev = -1;
  let at = f;
  for (let guard = 0; guard <= neighbours.size; guard += 1) {
    const next = (neighbours.get(at) ?? []).filter((w) => w !== prev).sort((x, y) => x - y);
    if (next.length === 0) throw new EditHalt('SURFACE_EDIT_NOT_APPLICABLE');
    const step = at === f ? next[0] : next.length === 1 ? next[0] : -1;
    if (step == null || step < 0) throw new EditHalt('SURFACE_EDIT_NOT_APPLICABLE');
    if (step === f) break;
    loop.push(step);
    prev = at;
    at = step;
    if (guard === neighbours.size) throw new EditHalt('SURFACE_EDIT_NOT_APPLICABLE');
  }
  if (loop[loop.length - 1] === f || !loop.includes(t)) throw new EditHalt('SURFACE_EDIT_NOT_APPLICABLE');
  const cut = loop.indexOf(t);
  const chainA = loop.slice(0, cut + 1);
  const chainB = [...loop.slice(cut), f];
  for (const id of crossed) state.tris.delete(id);
  for (const poly of [chainA, chainB]) {
    if (poly.length < 2) throw new EditHalt('SURFACE_EDIT_NOT_APPLICABLE');
    if (poly.length === 2) continue;
    for (const tri of earClip(pts, poly)) state.tris.set(state.nextTri++, tri);
  }
  refreshEditEdges(state);
};
