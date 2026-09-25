import { orient2d } from 'robust-predicates';
import { TIN_EDGE_FREE, type TinEdgeKindCode } from './tin/tinTypes';
import { tinEdgeKey } from './tin/tinTopology';
import type { CadSurfaceEditReason } from './cadSurfaceEdits';

/**
 * Phase 18S edit-mesh kernel (ENGINE ONLY). Mutable triangle table +
 * canonical edge map shared by the swap/delete applicator
 * (cadSurfaceEdits.ts) and the add-line retriangulation
 * (cadSurfaceEditAddLine.ts). Phase 18T: the state also owns MUTABLE
 * points (cloned from the baseline — the baseline source objects and any
 * ImportedTinPayload are never mutated) plus an active flag per vertex
 * and a vertex->active-triangle-ids index.
 */

export interface CadSurfaceEditMeshPoint {
  id: string;
  x: number;
  y: number;
  z: number;
}

export type EditTri = [number, number, number];

export interface EditMeshState {
  /** Owning surface id (scopes `edit:<surfaceId>:<editId>` keys). */
  surfaceId: string;
  /** Mutable working copy (cloned from the baseline at replay start). */
  pts: CadSurfaceEditMeshPoint[];
  /** Parallel to pts: false = edit-deleted (compacted away at the end). */
  active: boolean[];
  byId: Map<string, number>;
  tris: Map<number, EditTri>;
  nextTri: number;
  edgeMap: Map<string, number[]>;
  edgeKind: Map<string, TinEdgeKindCode>;
  /** Vertex -> ids of ACTIVE triangles using it (indexEditTri-maintained). */
  vertTris: Map<number, Set<number>>;
  /** Index-keyed user-added line edges (FREE, non-source; split-carryover). */
  userLines: Set<string>;
}

/** Internal halt carrying the failure reason; the applicator maps it to CadSurfaceEditFailure. */
export class EditHalt {
  readonly reason: CadSurfaceEditReason;
  constructor(reason: CadSurfaceEditReason) {
    this.reason = reason;
  }
}

export const editOrient = (pts: CadSurfaceEditMeshPoint[], a: number, b: number, c: number): number =>
  orient2d(pts[a].x, pts[a].y, pts[b].x, pts[b].y, pts[c].x, pts[c].y);

/** Strict straddle (exact, no epsilon): o1 and o2 are nonzero with opposite signs. */
export const editStraddles = (o1: number, o2: number): boolean =>
  o1 !== 0 && o2 !== 0 && (o1 > 0) !== (o2 > 0);

export const isEditSyntheticId = (id: string): boolean =>
  id.startsWith('boundary:') || id.startsWith('steiner:');

/**
 * Resolve a vertex key ONLY to stable identities (native `source:<entityId>`,
 * imported `imported:<surfaceId>:<vertexIndex>`, edit-created
 * `edit:<surfaceId>:<editId>` — same resolver, no second resolver).
 * Synthetic boundary/Steiner vertices fail closed; world-XY proximity
 * matching is never attempted. Resolving a deleted (inactive) vertex
 * reports VERTEX_MISSING — it no longer exists in the mesh.
 */
export const resolveEditVertex = (state: EditMeshState, key: string): number => {
  if (key.startsWith('boundary:') || key.startsWith('steiner:')) {
    throw new EditHalt('SURFACE_EDIT_SYNTHETIC_VERTEX');
  }
  let id: string;
  if (key.startsWith('source:')) {
    id = key.slice('source:'.length);
  } else if (key.startsWith('imported:')) {
    const parts = key.split(':');
    const at = Number(parts[parts.length - 1]);
    if (!Number.isInteger(at) || at < 0) throw new EditHalt('SURFACE_EDIT_VERTEX_MISSING');
    id = `${parts.slice(1, -1).join(':')}:v${at}`;
  } else if (key.startsWith('edit:')) {
    if (!key.startsWith(`edit:${state.surfaceId}:`)) {
      throw new EditHalt('SURFACE_EDIT_VERTEX_MISSING');
    }
    id = key;
  } else {
    throw new EditHalt('SURFACE_EDIT_VERTEX_MISSING');
  }
  if (isEditSyntheticId(id)) throw new EditHalt('SURFACE_EDIT_SYNTHETIC_VERTEX');
  const index = state.byId.get(id);
  if (index === undefined || !state.active[index]) throw new EditHalt('SURFACE_EDIT_VERTEX_MISSING');
  return index;
};

/** Stable mesh id for an edit-created point (derived from the EDIT id). */
export const editPointIdOf = (surfaceId: string, editId: string): string =>
  `edit:${surfaceId}:${editId}`;

export const thirdEditVert = (tri: EditTri, a: number, b: number): number | undefined => {
  for (const v of tri) if (v !== a && v !== b) return v;
  return undefined;
};

/** Enforce math-CCW winding (exact); degenerate input fails closed. */
export const ccwEditTri = (pts: CadSurfaceEditMeshPoint[], a: number, b: number, c: number): EditTri => {
  // NOTE: robust-predicates orient2d is positive for math-CLOCKWISE triples
  // (opposite of Shewchuk; see tinPredicates.ccwSign which negates it).
  const o = editOrient(pts, a, b, c);
  if (o === 0) throw new EditHalt('SURFACE_EDIT_NOT_APPLICABLE');
  return o < 0 ? [a, b, c] : [a, c, b];
};

export const sortedEditTriIds = (state: EditMeshState): number[] =>
  // Insertion order is already ascending: the table starts as 0..N-1 and
  // every insert uses monotonic nextTri++ (ids are never reused), so no
  // sort is needed. Kept as a helper so callers read in deterministic order.
  [...state.tris.keys()];

/** Rebuild the canonical edge map + vertex->triangle index from the active table (deterministic tri-id order). */
export const refreshEditEdges = (state: EditMeshState): void => {
  const map = new Map<string, number[]>();
  const vert = new Map<number, Set<number>>();
  for (const id of sortedEditTriIds(state)) {
    const tri = state.tris.get(id) as EditTri;
    for (const [u, v] of [[tri[0], tri[1]], [tri[1], tri[2]], [tri[2], tri[0]]] as const) {
      const key = tinEdgeKey(u, v);
      const list = map.get(key);
      if (list) list.push(id);
      else map.set(key, [id]);
    }
    for (const w of tri) {
      const set = vert.get(w);
      if (set) set.add(id);
      else vert.set(w, new Set([id]));
    }
  }
  state.edgeMap = map;
  state.vertTris = vert;
  for (const key of [...state.edgeKind.keys()]) {
    if (!map.has(key)) state.edgeKind.delete(key);
  }
  for (const key of map.keys()) {
    if (!state.edgeKind.has(key)) state.edgeKind.set(key, TIN_EDGE_FREE);
  }
};

export const kindOfEditEdge = (state: EditMeshState, key: string): TinEdgeKindCode =>
  state.edgeKind.get(key) ?? TIN_EDGE_FREE;

const triEdgeKeys = (tri: EditTri): [string, string, string] => [
  tinEdgeKey(tri[0], tri[1]),
  tinEdgeKey(tri[1], tri[2]),
  tinEdgeKey(tri[2], tri[0]),
];

/**
 * Incremental edge-map maintenance. New triangle ids are monotonic
 * (nextTri++), so appending keeps every adjacency list in ascending order —
 * identical to a full rebuild + sort, without the O(triangles) rescan.
 * Also maintains the vertex->active-triangle-ids index.
 */
export const indexEditTri = (state: EditMeshState, id: number, tri: EditTri): void => {
  for (const key of triEdgeKeys(tri)) {
    const list = state.edgeMap.get(key);
    if (list) list.push(id);
    else state.edgeMap.set(key, [id]);
    if (!state.edgeKind.has(key)) state.edgeKind.set(key, TIN_EDGE_FREE);
  }
  for (const v of tri) {
    const set = state.vertTris.get(v);
    if (set) set.add(id);
    else state.vertTris.set(v, new Set([id]));
  }
};

/** Remove one triangle's edges; drop map/kind entries with no remaining triangle. */
export const unindexEditTri = (state: EditMeshState, id: number, tri: EditTri): void => {
  for (const key of triEdgeKeys(tri)) {
    const list = state.edgeMap.get(key);
    if (!list) continue;
    const at = list.indexOf(id);
    if (at >= 0) list.splice(at, 1);
    if (list.length === 0) {
      state.edgeMap.delete(key);
      state.edgeKind.delete(key);
    }
  }
  for (const v of tri) {
    const set = state.vertTris.get(v);
    if (set) {
      set.delete(id);
      if (set.size === 0) state.vertTris.delete(v);
    }
  }
};

/** Append a new ACTIVE point; returns its index. Never mutates the baseline. */
export const appendEditPoint = (state: EditMeshState, point: CadSurfaceEditMeshPoint): number => {
  const at = state.pts.length;
  state.pts.push({ ...point });
  state.active.push(true);
  state.byId.set(point.id, at);
  return at;
};
