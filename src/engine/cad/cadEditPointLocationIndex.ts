/**
 * Phase 18V exact active-point location index (ENGINE ONLY).
 *
 * Maps the exact XY of every ACTIVE vertex (`${x},${y}` — Float64 → string
 * round-trips exactly, so no tolerance is ever involved) to its point index.
 * It replaces the O(points) coincidence scans in `applyMovePoint` and in the
 * add-point `findCoincident` gate, so a replay of N coincidence checks costs
 * O(points) once + O(1) each instead of O(N × points).
 *
 * LIFECYCLE: LAZY — built on the first coincidence check of a replay and then
 * maintained incrementally:
 *   - add-point    -> `insertEditPointLocation(state, v)`
 *   - delete-point -> `removeEditPointLocation(state, v)`
 *   - move-point / move-points -> `updateEditPointLocationVertex(state, v)`
 *     (invoked from `EditEdgeSpatialIndex.updateVertexEdges`, the shared
 *     post-commit coordinate seam both kernels already use).
 * `invalidateEditPointLocationIndex(state)` drops the map so the next check
 * rebuilds from current coordinates; `invalidateEditEdgeSpatialIndex` calls it
 * on the bulk failure fallback.
 *
 * Only ACTIVE vertices are present, and Z is irrelevant (the TIN is 2.5D).
 * The map is a pure accelerator: every answer is identical to a linear active
 * scan. The first (lowest) index wins on a duplicated position, matching the
 * scan's ascending order; duplicate active XY cannot arise from the kernels
 * (add/move/bulk all block exact coincidence) and only existence is consumed.
 */
import type { EditMeshState } from './cadSurfaceEditMesh';

const INDEXES = new WeakMap<EditMeshState, EditPointLocationIndex>();

/** Exact Float64 XY key (round-trips without loss, no tolerance). */
export const editPointLocationKey = (x: number, y: number): string => `${x},${y}`;

/** Exact active-point position map, keyed by `${x},${y}`. */
export class EditPointLocationIndex {
  private readonly byPosition = new Map<string, number>();
  private readonly byVertex = new Map<number, string>();

  constructor(state: EditMeshState) {
    for (let i = 0; i < state.pts.length; i += 1) {
      if (!state.active[i]) continue;
      const key = editPointLocationKey(state.pts[i].x, state.pts[i].y);
      if (this.byPosition.has(key)) continue;
      this.byPosition.set(key, i);
      this.byVertex.set(i, key);
    }
  }

  /** Active vertices with a distinct position. */
  get size(): number {
    return this.byPosition.size;
  }

  /** Index of an active vertex at exactly (x,y), or -1. */
  find(x: number, y: number): number {
    return this.byPosition.get(editPointLocationKey(x, y)) ?? -1;
  }

  /**
   * Record `vertex` at (x,y), dropping its previous position. Safe when the
   * previous position was already claimed by another moving vertex (the
   * mapping is then overwritten, not deleted) — bulk simultaneous moves.
   */
  rekey(vertex: number, x: number, y: number): void {
    const oldKey = this.byVertex.get(vertex);
    if (oldKey !== undefined && this.byPosition.get(oldKey) === vertex) {
      this.byPosition.delete(oldKey);
    }
    const key = editPointLocationKey(x, y);
    this.byPosition.set(key, vertex);
    this.byVertex.set(vertex, key);
  }

  /** Forget `vertex`'s recorded position (delete-point). */
  forget(vertex: number): void {
    const key = this.byVertex.get(vertex);
    if (key === undefined) return;
    if (this.byPosition.get(key) === vertex) this.byPosition.delete(key);
    this.byVertex.delete(vertex);
  }
}

/** Lazy ensure: rebuilds only when no map is attached to this state. */
export const ensureEditPointLocationIndex = (state: EditMeshState): EditPointLocationIndex => {
  const current = INDEXES.get(state);
  if (current) return current;
  const next = new EditPointLocationIndex(state);
  INDEXES.set(state, next);
  return next;
};

/** Drop the attached map so the next check rebuilds from current coordinates. */
export const invalidateEditPointLocationIndex = (state: EditMeshState): void => {
  INDEXES.delete(state);
};

/** Add-point maintenance (no-op when the map was never built — lazy). */
export const insertEditPointLocation = (state: EditMeshState, vertex: number): void => {
  const index = INDEXES.get(state);
  if (!index) return;
  index.rekey(vertex, state.pts[vertex].x, state.pts[vertex].y);
};

/** Delete-point maintenance (no-op when the map was never built). */
export const removeEditPointLocation = (state: EditMeshState, vertex: number): void => {
  INDEXES.get(state)?.forget(vertex);
};

/** Move maintenance (no-op when the map was never built). */
export const updateEditPointLocationVertex = (state: EditMeshState, vertex: number): void => {
  const index = INDEXES.get(state);
  if (!index) return;
  index.rekey(vertex, state.pts[vertex].x, state.pts[vertex].y);
};
