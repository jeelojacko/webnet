import { orient2d } from 'robust-predicates';
import { tinEdgeKey } from './tin/tinTopology';
import type { CadSurfaceVertexRef } from './cadTypes';
import {
  EditHalt,
  resolveEditVertex,
  type EditMeshState,
} from './cadSurfaceEditMesh';
import { hasBoundaryEdge, hasConstrainedEdge, properlyCrosses } from './cadSurfaceEditPointModify';
import { ensureEditEdgeSpatialIndex, invalidateEditEdgeSpatialIndex } from './cadEditEdgeSpatialIndex';

/**
 * Phase 18V bulk/region edit kernels (ENGINE ONLY).
 *
 * Crossing candidate discovery uses the dynamic edge spatial index (§9):
 * old-index candidates per proposed moved-edge bbox plus a temporary local
 * proposed-moved-edge set for moved-vs-moved final-state crossings (§30 —
 * the old index is pre-move geometry and must never be relied on alone).
 * The exact `properlyCrosses` predicate (shared with the single-move
 * kernel) stays the sole crossing authority, so PASS/BLOCK answers are
 * identical to brute-force discovery.
 */

/** Canonicalize refs: lexicographic key order, dedupe. Empty ⇒ reject (no edit, no undo entry). */
export const canonicalizeBulkVertexRefs = (refs: CadSurfaceVertexRef[]): CadSurfaceVertexRef[] => {
  const keys = [...new Set(refs.map((ref) => ref.key))].sort();
  if (keys.length === 0) throw new EditHalt('SURFACE_EDIT_NOT_APPLICABLE');
  return keys.map((key) => ({ key }));
};

/** Resolve canonical refs; throws VERTEX_MISSING/SYNTHETIC fail-closed. */
const resolveBulk = (state: EditMeshState, refs: CadSurfaceVertexRef[]): number[] =>
  canonicalizeBulkVertexRefs(refs).map((ref) => resolveEditVertex(state, ref.key));

/** Absolute Z override over listed refs ONLY; topology unchanged. */
export const applySetElevationsMany = (
  state: EditMeshState,
  refs: CadSurfaceVertexRef[],
  z: number,
): void => {
  if (!Number.isFinite(z)) throw new EditHalt('SURFACE_EDIT_ELEVATION_INVALID');
  const indices = resolveBulk(state, refs);
  for (const v of indices) {
    if (!state.active[v]) throw new EditHalt('SURFACE_EDIT_VERTEX_MISSING');
  }
  for (const v of indices) state.pts[v].z = z;
};

/** deltaZ added to the listed refs ONLY (unlike whole-surface raise-lower). */
export const applyRaiseLowerPoints = (
  state: EditMeshState,
  refs: CadSurfaceVertexRef[],
  deltaZ: number,
): void => {
  if (!Number.isFinite(deltaZ)) throw new EditHalt('SURFACE_EDIT_ELEVATION_INVALID');
  const indices = resolveBulk(state, refs);
  for (const v of indices) {
    if (!state.active[v]) throw new EditHalt('SURFACE_EDIT_VERTEX_MISSING');
  }
  for (const v of indices) state.pts[v].z += deltaZ;
};

interface Xy {
  x: number;
  y: number;
}

/**
 * Simultaneous bulk move: translate every listed ref by (deltaX, deltaY).
 * Validation reads proposed-for-selected / current-for-unselected with NO
 * state mutation; on success all XY commit atomically. Any failure throws
 * EditHalt with state bit-identical.
 */
export const applyMovePointsVertices = (
  state: EditMeshState,
  refs: CadSurfaceVertexRef[],
  deltaX: number,
  deltaY: number,
): void => {
  if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) {
    throw new EditHalt('SURFACE_EDIT_MOVE_POINT_INVALID_STAR');
  }
  const indices = resolveBulk(state, refs);
  const selected = new Set(indices);
  for (const v of indices) {
    if (!state.active[v]) throw new EditHalt('SURFACE_EDIT_VERTEX_MISSING');
    if (hasBoundaryEdge(state, v)) throw new EditHalt('SURFACE_EDIT_MOVE_POINT_BOUNDARY');
    if (hasConstrainedEdge(state, v)) throw new EditHalt('SURFACE_EDIT_MOVE_POINT_CONSTRAINED');
  }
  for (const v of indices) {
    if ((state.vertTris.get(v) ?? new Set()).size === 0) {
      throw new EditHalt('SURFACE_EDIT_MOVE_POINT_INVALID_STAR');
    }
  }
  // Proposed map first (read-only from here until commit).
  const proposed = new Map<number, Xy>();
  for (const v of indices) {
    const p = state.pts[v];
    const nx = p.x + deltaX;
    const ny = p.y + deltaY;
    if (!Number.isFinite(nx) || !Number.isFinite(ny)) {
      throw new EditHalt('SURFACE_EDIT_MOVE_POINT_INVALID_STAR');
    }
    proposed.set(v, { x: nx, y: ny });
  }
  const at = (i: number): Xy => proposed.get(i) ?? state.pts[i];
  // No coincidence (exact ===, single pass): key every proposed final
  // position first — `x+','+y` is an exact Float64 round-trip, so string
  // keys keep bit-identical answers with no tolerance — then sweep all
  // points once. A duplicate proposed key, or a proposed key hitting an
  // active unselected occupant, blocks. O(points + selected).
  const posKey = (x: number, y: number): string => `${x},${y}`;
  const seenFinals = new Set<string>();
  for (const [, q] of proposed) {
    const key = posKey(q.x, q.y);
    if (seenFinals.has(key)) throw new EditHalt('SURFACE_EDIT_MOVE_POINT_INVALID_STAR');
    seenFinals.add(key);
  }
  for (let i = 0; i < state.pts.length; i += 1) {
    if (!state.active[i] || selected.has(i)) continue;
    if (seenFinals.has(posKey(state.pts[i].x, state.pts[i].y))) {
      throw new EditHalt('SURFACE_EDIT_MOVE_POINT_INVALID_STAR');
    }
  }
  // One-ring orientation: every triangle incident to ≥1 selected vertex,
  // with proposed coordinates substituted, keeps strict positive plan area.
  const incident = new Set<number>();
  for (const v of indices) {
    for (const id of state.vertTris.get(v) ?? []) incident.add(id);
  }
  for (const id of [...incident].sort((a, b) => a - b)) {
    const tri = state.tris.get(id);
    if (!tri) continue;
    const [p, q, r] = [at(tri[0]), at(tri[1]), at(tri[2])];
    if (orient2d(p.x, p.y, q.x, q.y, r.x, r.y) >= 0) {
      throw new EditHalt('SURFACE_EDIT_MOVE_POINT_INVALID_STAR');
    }
  }
  // Frontier/moved-edge proper-crossing scan via the spatial index (§9).
  // The index holds PRE-move geometry: each proposed moved edge queries
  // its proposed bbox for candidates (a guaranteed superset — every real
  // crossing overlaps bboxes), and moved-vs-moved final-state pairs are
  // ALSO tested against the temporary local proposed set (§30 — never rely
  // on the old index alone). properlyCrosses decides every pair.
  const candidateIndex = ensureEditEdgeSpatialIndex(state);
  const movedKeys = new Set<string>();
  for (const [, tri] of state.tris) {
    for (const [u, w] of [[tri[0], tri[1]], [tri[1], tri[2]], [tri[2], tri[0]]] as const) {
      if (selected.has(u) || selected.has(w)) movedKeys.add(tinEdgeKey(u, w));
    }
  }
  const moved = [...movedKeys].sort().map((key) => {
    const [u, v] = key.split('>').map(Number) as [number, number];
    return { u, v, pu: at(u), pv: at(v) };
  });
  const sharesEndpoint = (aU: number, aV: number, bU: number, bV: number): boolean =>
    aU === bU || aU === bV || aV === bU || aV === bV;
  const testPair = (
    ax: number, ay: number, bx: number, by: number,
    cx: number, cy: number, dx: number, dy: number,
  ): void => {
    if (properlyCrosses(ax, ay, bx, by, cx, cy, dx, dy)) {
      throw new EditHalt('SURFACE_EDIT_MOVE_POINT_INTERSECTION');
    }
  };
  for (const m of moved) {
    // (a) Old-index candidates under the PROPOSED bbox (endpoints read
    // proposed-for-selected / current-for-unselected).
    const minX = Math.min(m.pu.x, m.pv.x);
    const maxX = Math.max(m.pu.x, m.pv.x);
    const minY = Math.min(m.pu.y, m.pv.y);
    const maxY = Math.max(m.pu.y, m.pv.y);
    for (const rec of candidateIndex.queryCandidates(minX, minY, maxX, maxY)) {
      if (sharesEndpoint(m.u, m.v, rec.u, rec.v)) continue;
      const c1 = at(rec.u);
      const c2 = at(rec.v);
      testPair(m.pu.x, m.pu.y, m.pv.x, m.pv.y, c1.x, c1.y, c2.x, c2.y);
    }
    // (b) Local proposed moved-edge set: final-state moved-vs-moved.
    for (const n of moved) {
      if (n === m || sharesEndpoint(m.u, m.v, n.u, n.v)) continue;
      testPair(m.pu.x, m.pu.y, m.pv.x, m.pv.y, n.pu.x, n.pu.y, n.pv.x, n.pv.y);
    }
  }
  // Atomic commit (validation already passed; cannot fail from here), then
  // the §28 atomic union update: re-box every moved vertex's incident
  // edges so later moves in a mixed stack validate against fresh bboxes.
  // On ANY failure above the index is untouched (still pre-move exact).
  for (const [v, q] of [...proposed.entries()].sort((a, b) => a[0] - b[0])) {
    state.pts[v].x = q.x;
    state.pts[v].y = q.y;
  }
  try {
    for (const v of indices) candidateIndex.updateVertexEdges(v);
  } catch {
    invalidateEditEdgeSpatialIndex(state);
  }
};
