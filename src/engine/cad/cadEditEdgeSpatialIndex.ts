/**
 * Phase 18V dynamic edge spatial index (ENGINE ONLY) — architecture §9.
 *
 * Uniform hash grid over the UNIQUE ACTIVE mesh edges of an `EditMeshState`
 * (identity = canonical `edgeMap` key, so a shared interior edge gets exactly
 * one record and is never doubled). Cell size is derived deterministically
 * from the mesh bounds + unique edge count (target ~4 edges/cell, at most
 * 512 cells per axis); cell coordinates are bounds-relative integers, so
 * large projected coordinates (E≈2M / N≈7M) stay exact with no packing.
 *
 * CONTRACT: candidate discovery may return false POSITIVES, never false
 * NEGATIVES. A proper crossing implies overlapping axis-aligned bounding
 * boxes, and every edge is registered in every cell its bbox touches (edges
 * whose bbox spans too many cells are kept in a small `wide` list that every
 * query scans), so the sieve cannot drop a real candidate. The exact
 * `properlyCrosses` predicate stays the only crossing authority — no
 * tolerance, no skipping. Cell size affects performance only, never
 * correctness.
 *
 * LIFECYCLE: LAZY — built on the first Move Point validation in a replay.
 * Maintenance follows `edgeMap` refcount transitions (0→1 add, 1→2 and 2→1
 * no-op, 1→0 remove), never raw triangle callbacks, so a shared edge that
 * survives a 2→1 transition keeps its record. `refreshEditEdges` detaches
 * the hooks (full rebuild) and the next ensure rebuilds from that edgeMap.
 *
 * MOVE PROTOCOL: validate against the pre-move index + proposed geometry,
 * then `updateVertexEdges(v)` (remove + reinsert the union of incident
 * bboxes) on success. The same call also re-keys the exact active-point
 * location map (`cadEditPointLocationIndex.ts`) when one is attached, so both
 * the single-move and bulk-move commit paths maintain it. Failures leave
 * both structures untouched. Any OTHER kernel that writes `state.pts` XY
 * directly must call `updateVertexEdges(v)` per moved vertex at commit, or
 * `invalidateEditEdgeSpatialIndex(state)` to force a lazy rebuild — a stale
 * record is the only way this structure can produce a false negative.
 *
 * ponytail: one object record per unique edge (~2M edges ⇒ a few hundred MB
 * at the documented E≈2M ceiling). Upgrade to a struct-of-arrays layout
 * (Int32Array keys/slots + Float64Array bboxes) if worker memory pressure
 * ever shows up; the query contract does not change.
 */
import { tinEdgeKey } from './tin/tinTopology';
import type { EditEdgeTransitionHooks, EditMeshState } from './cadSurfaceEditMesh';
import {
  invalidateEditPointLocationIndex,
  updateEditPointLocationVertex,
} from './cadEditPointLocationIndex';

/** One unique active edge: canonical key + endpoints + XY bounding box. */
export interface EditEdgeSpatialRecord {
  edgeKey: string;
  u: number;
  v: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Average edges per occupied cell at build time (perf only, never correctness). */
const TARGET_EDGES_PER_CELL = 4;
/** Cells per axis cap (bounds the layout at any mesh size). */
const MAX_CELLS_PER_AXIS = 512;
/** An edge whose bbox touches more cells goes to the always-scanned wide list. */
const MAX_CELLS_PER_EDGE = 64;
/** A query whose bbox touches more cells falls back to a full record scan. */
const MAX_QUERY_CELLS = 4096;
/** Exact composite-key packing range (± this many cells keeps keys collision-free). */
const MAX_CELL_COORD = 1 << 19;
const CELL_OFFSET = 1 << 20;
const CELL_SPAN = 1 << 21;

const INDEXES = new WeakMap<EditMeshState, EditEdgeSpatialIndex>();

/** Canonical `min>max` key -> endpoint indices (format owned by tinEdgeKey). */
const parseEdgeKey = (key: string): [number, number] => {
  const at = key.indexOf('>');
  const u = Number(key.slice(0, at));
  const v = Number(key.slice(at + 1));
  if (!Number.isInteger(u) || !Number.isInteger(v) || u < 0 || v < 0) {
    throw new Error(`edit edge index: malformed canonical edge key "${key}"`);
  }
  return [u, v];
};

const cellKey = (cx: number, cy: number): number => (cx + CELL_OFFSET) * CELL_SPAN + (cy + CELL_OFFSET);

const overlaps = (
  rec: EditEdgeSpatialRecord,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): boolean => rec.minX <= maxX && rec.maxX >= minX && rec.minY <= maxY && rec.maxY >= minY;

interface EditEdgeSpatialLayout {
  cellSize: number;
  originX: number;
  originY: number;
}

/** Deterministic sizing from mesh bounds + edge count; viewport/randomness-free. */
const layoutOf = (state: EditMeshState): EditEdgeSpatialLayout => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let count = 0;
  for (const key of state.edgeMap.keys()) {
    const [u, v] = parseEdgeKey(key);
    const a = state.pts[u];
    const b = state.pts[v];
    if (a.x < minX) minX = a.x;
    if (b.x < minX) minX = b.x;
    if (a.x > maxX) maxX = a.x;
    if (b.x > maxX) maxX = b.x;
    if (a.y < minY) minY = a.y;
    if (b.y < minY) minY = b.y;
    if (a.y > maxY) maxY = a.y;
    if (b.y > maxY) maxY = b.y;
    count += 1;
  }
  if (count === 0 || !Number.isFinite(minX)) return { cellSize: 1, originX: 0, originY: 0 };
  const cells = Math.min(MAX_CELLS_PER_AXIS, Math.max(1, Math.round(Math.sqrt(count / TARGET_EDGES_PER_CELL))));
  const extent = Math.max(maxX - minX, maxY - minY);
  return { cellSize: extent > 0 ? extent / cells : 1, originX: minX, originY: minY };
};

/** Lazy ensure: rebuilds when the state has no attached index (or a rebuild detached it). */
export const ensureEditEdgeSpatialIndex = (state: EditMeshState): EditEdgeSpatialIndex => {
  const current = INDEXES.get(state);
  if (current && state.edgeHooks === current) return current;
  const next = new EditEdgeSpatialIndex(state);
  INDEXES.set(state, next);
  state.edgeHooks = next;
  return next;
};

/**
 * Drop the attached index so the next move validation rebuilds from the
 * current edgeMap + coordinates. REQUIRED after any kernel that mutates
 * `state.pts` XY outside `applyMovePoint` (e.g. a bulk `move-points` commit)
 * or that rebuilds topology without going through
 * `indexEditTri`/`unindexEditTri`; the alternative is calling
 * `updateVertexEdges(v)` for each moved vertex immediately after the commit.
 * Also drops the exact active-point location map so it rebuilds in step.
 */
export const invalidateEditEdgeSpatialIndex = (state: EditMeshState): void => {
  state.edgeHooks = undefined;
  invalidateEditPointLocationIndex(state);
};

/**
 * Incremental uniform grid over the state's unique active edges.
 * Implements the `edgeMap` transition hooks (`added` / `removed`).
 */
export class EditEdgeSpatialIndex implements EditEdgeTransitionHooks {
  private readonly state: EditMeshState;
  readonly cellSize: number;
  readonly originX: number;
  readonly originY: number;
  private readonly cells = new Map<number, string[]>();
  private readonly records = new Map<string, EditEdgeSpatialRecord>();
  /** Edges whose bbox spans too many cells: correct but scanned by every query. */
  private readonly wide = new Set<string>();

  constructor(state: EditMeshState) {
    this.state = state;
    const layout = layoutOf(state);
    this.cellSize = layout.cellSize;
    this.originX = layout.originX;
    this.originY = layout.originY;
    for (const key of state.edgeMap.keys()) this.insertRecord(key);
  }

  /** Unique indexed edges (wide edges included). */
  get edgeCount(): number {
    return this.records.size;
  }

  /** Occupied cell buckets. */
  get cellCount(): number {
    return this.cells.size;
  }

  /** Wide-list size (normally 0). */
  get wideCount(): number {
    return this.wide.size;
  }

  /** 0→1 edgeMap transition: register a newly created unique edge. */
  added(key: string): void {
    this.insertRecord(key);
  }

  /** 1→0 edgeMap transition: forget a unique edge that no longer exists. */
  removed(key: string): void {
    this.removeRecord(key);
  }

  /**
   * Re-box every active edge incident to `v` from its current coordinates and
   * re-key the attached exact active-point location map for `v`. Call AFTER a
   * successful move mutated `state.pts[v]`; O(incident ring).
   */
  updateVertexEdges(v: number): void {
    const keys = this.incidentEdgeKeys(v);
    for (const key of keys) this.removeRecord(key);
    for (const key of keys) this.insertRecord(key);
    updateEditPointLocationVertex(this.state, v);
  }

  /**
   * Candidate edges whose bbox overlaps the query rectangle, in deterministic
   * order (wide first, then cell order). Superset of every real crossing —
   * the caller MUST run the exact predicate.
   */
  queryCandidates(minX: number, minY: number, maxX: number, maxY: number): EditEdgeSpatialRecord[] {
    if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
      // Fail-closed: an unusable query rectangle returns everything.
      return [...this.records.values()];
    }
    const out: EditEdgeSpatialRecord[] = [];
    const seen = new Set<string>();
    const collect = (rec: EditEdgeSpatialRecord | undefined): void => {
      if (!rec || seen.has(rec.edgeKey)) return;
      seen.add(rec.edgeKey);
      if (overlaps(rec, minX, minY, maxX, maxY)) out.push(rec);
    };
    for (const key of this.wide) collect(this.records.get(key));
    const cx0 = this.cellX(minX);
    const cx1 = this.cellX(maxX);
    const cy0 = this.cellY(minY);
    const cy1 = this.cellY(maxY);
    const span = (cx1 - cx0 + 1) * (cy1 - cy0 + 1);
    if (!Number.isFinite(span) || span > MAX_QUERY_CELLS || this.coordsOutOfRange(cx0, cy0, cx1, cy1)) {
      for (const rec of this.records.values()) collect(rec);
      return out;
    }
    for (let cx = cx0; cx <= cx1; cx += 1) {
      for (let cy = cy0; cy <= cy1; cy += 1) {
        const bucket = this.cells.get(cellKey(cx, cy));
        if (!bucket) continue;
        for (const key of bucket) collect(this.records.get(key));
      }
    }
    return out;
  }

  /** Distinct canonical keys of the active edges incident to `v`. */
  private incidentEdgeKeys(v: number): string[] {
    const keys = new Set<string>();
    for (const id of this.state.vertTris.get(v) ?? []) {
      const tri = this.state.tris.get(id);
      if (!tri) continue;
      for (const [a, b] of [
        [tri[0], tri[1]],
        [tri[1], tri[2]],
        [tri[2], tri[0]],
      ] as const) {
        if (a === v || b === v) keys.add(tinEdgeKey(a, b));
      }
    }
    return [...keys];
  }

  private cellX(x: number): number {
    return Math.floor((x - this.originX) / this.cellSize);
  }

  private cellY(y: number): number {
    return Math.floor((y - this.originY) / this.cellSize);
  }

  private coordsOutOfRange(cx0: number, cy0: number, cx1: number, cy1: number): boolean {
    return (
      Math.abs(cx0) > MAX_CELL_COORD ||
      Math.abs(cx1) > MAX_CELL_COORD ||
      Math.abs(cy0) > MAX_CELL_COORD ||
      Math.abs(cy1) > MAX_CELL_COORD
    );
  }

  private insertRecord(key: string): void {
    if (this.records.has(key)) return;
    const [u, v] = parseEdgeKey(key);
    const a = this.state.pts[u];
    const b = this.state.pts[v];
    const rec: EditEdgeSpatialRecord = {
      edgeKey: key,
      u,
      v,
      minX: Math.min(a.x, b.x),
      minY: Math.min(a.y, b.y),
      maxX: Math.max(a.x, b.x),
      maxY: Math.max(a.y, b.y),
    };
    this.records.set(key, rec);
    const cx0 = this.cellX(rec.minX);
    const cx1 = this.cellX(rec.maxX);
    const cy0 = this.cellY(rec.minY);
    const cy1 = this.cellY(rec.maxY);
    const span = (cx1 - cx0 + 1) * (cy1 - cy0 + 1);
    if (!Number.isFinite(span) || span > MAX_CELLS_PER_EDGE || this.coordsOutOfRange(cx0, cy0, cx1, cy1)) {
      this.wide.add(key);
      return;
    }
    for (let cx = cx0; cx <= cx1; cx += 1) {
      for (let cy = cy0; cy <= cy1; cy += 1) {
        const k = cellKey(cx, cy);
        const bucket = this.cells.get(k);
        if (bucket) bucket.push(key);
        else this.cells.set(k, [key]);
      }
    }
  }

  private removeRecord(key: string): void {
    const rec = this.records.get(key);
    if (!rec) return;
    this.records.delete(key);
    if (this.wide.delete(key)) return;
    const cx0 = this.cellX(rec.minX);
    const cx1 = this.cellX(rec.maxX);
    const cy0 = this.cellY(rec.minY);
    const cy1 = this.cellY(rec.maxY);
    const span = (cx1 - cx0 + 1) * (cy1 - cy0 + 1);
    if (!Number.isFinite(span) || span > MAX_CELLS_PER_EDGE || this.coordsOutOfRange(cx0, cy0, cx1, cy1)) return;
    for (let cx = cx0; cx <= cx1; cx += 1) {
      for (let cy = cy0; cy <= cy1; cy += 1) {
        const k = cellKey(cx, cy);
        const bucket = this.cells.get(k);
        if (!bucket) continue;
        const at = bucket.indexOf(key);
        if (at >= 0) bucket.splice(at, 1);
        if (bucket.length === 0) this.cells.delete(k);
      }
    }
  }
}
