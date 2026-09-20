import { orient2d } from 'robust-predicates';
import { TIN_EDGE_FREE, type TinEdgeKindCode } from './tin/tinTypes';
import { tinEdgeKey } from './tin/tinTopology';
import type { CadSurfaceEditReason } from './cadSurfaceEdits';

/**
 * Phase 18S edit-mesh kernel (ENGINE ONLY). Mutable triangle table +
 * canonical edge map shared by the swap/delete applicator
 * (cadSurfaceEdits.ts) and the add-line retriangulation
 * (cadSurfaceEditAddLine.ts). Coordinates never change — only connectivity.
 */

export interface CadSurfaceEditMeshPoint {
  id: string;
  x: number;
  y: number;
  z: number;
}

export type EditTri = [number, number, number];

export interface EditMeshState {
  pts: CadSurfaceEditMeshPoint[];
  byId: Map<string, number>;
  tris: Map<number, EditTri>;
  nextTri: number;
  edgeMap: Map<string, number[]>;
  edgeKind: Map<string, TinEdgeKindCode>;
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
 * imported `imported:<surfaceId>:<vertexIndex>`). Synthetic boundary/Steiner
 * vertices fail closed; world-XY proximity matching is never attempted.
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
  } else {
    throw new EditHalt('SURFACE_EDIT_VERTEX_MISSING');
  }
  if (isEditSyntheticId(id)) throw new EditHalt('SURFACE_EDIT_SYNTHETIC_VERTEX');
  const index = state.byId.get(id);
  if (index === undefined) throw new EditHalt('SURFACE_EDIT_VERTEX_MISSING');
  return index;
};

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

export const sortedEditTriIds = (state: EditMeshState): number[] => [...state.tris.keys()].sort((x, y) => x - y);

/** Rebuild the canonical edge map from the active table (deterministic tri-id order). */
export const refreshEditEdges = (state: EditMeshState): void => {
  const map = new Map<string, number[]>();
  for (const id of sortedEditTriIds(state)) {
    const tri = state.tris.get(id) as EditTri;
    for (const [u, v] of [[tri[0], tri[1]], [tri[1], tri[2]], [tri[2], tri[0]]] as const) {
      const key = tinEdgeKey(u, v);
      const list = map.get(key);
      if (list) list.push(id);
      else map.set(key, [id]);
    }
  }
  state.edgeMap = map;
  for (const key of [...state.edgeKind.keys()]) {
    if (!map.has(key)) state.edgeKind.delete(key);
  }
  for (const key of map.keys()) {
    if (!state.edgeKind.has(key)) state.edgeKind.set(key, TIN_EDGE_FREE);
  }
};

export const kindOfEditEdge = (state: EditMeshState, key: string): TinEdgeKindCode =>
  state.edgeKind.get(key) ?? TIN_EDGE_FREE;
