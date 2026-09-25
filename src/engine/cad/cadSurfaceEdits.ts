import type { CadSurfaceEdit } from './cadTypes';
import { TIN_EDGE_FREE, type TinAdjacency, type TinEdgeKindCode, type TinEdgeKinds } from './tin/tinTypes';
import { buildTinTopology, tinEdgeKey } from './tin/tinTopology';
import { applyAddLine } from './cadSurfaceEditAddLine';
import { applyAddPoint } from './cadSurfaceEditPointAdd';
import { applyDeletePoint, applyMovePoint, applyRaiseLower, applySetElevation } from './cadSurfaceEditPointModify';
import {
  ccwEditTri,
  EditHalt,
  editOrient,
  editStraddles,
  indexEditTri,
  kindOfEditEdge,
  refreshEditEdges,
  resolveEditVertex,
  thirdEditVert,
  type CadSurfaceEditMeshPoint,
  type EditMeshState,
  type EditTri,
  unindexEditTri,
} from './cadSurfaceEditMesh';

export type { CadSurfaceEditMeshPoint };

/**
 * Phase 18S TIN edit-stack applicator (ENGINE ONLY — no UI, no persistence).
 *
 * Sequential replay over a baseline mesh: later edits see earlier results.
 * Vertex keys resolve ONLY to stable identities (native `source:<entityId>`,
 * imported `imported:<surfaceId>:<vertexIndex>`, edit-created
 * `edit:<surfaceId>:<editId>`); synthetic boundary/Steiner vertices fail
 * closed and world-XY proximity matching is never attempted.
 *
 * Phase 18T point/elevation edits: the mesh state owns MUTABLE working
 * points (cloned — baseline sources are never mutated) and the result
 * carries the final compacted point array for bounds/stats/grid/adjacency.
 *
 * Add-line uses a local deterministic retriangulation of the crossed FREE
 * region (exact orient2d predicates + ear clipping): the existing
 * constrained-segment recovery kernel operates on local-frame Delaunay build
 * state and could not be factored cheaply for post-build replay.
 */

export type CadSurfaceEditStatus =
  | 'applied'
  | 'disabled'
  | 'broken-reference'
  | 'not-applicable'
  | 'blocked-constraint';

export type CadSurfaceEditReason =
  | 'SURFACE_EDIT_VERTEX_MISSING'
  | 'SURFACE_EDIT_EDGE_MISSING'
  | 'SURFACE_EDIT_NOT_APPLICABLE'
  | 'SURFACE_EDIT_BLOCKED_CONSTRAINT'
  | 'SURFACE_EDIT_SYNTHETIC_VERTEX'
  | 'SURFACE_EDIT_INTERMEDIATE_VERTEX'
  | 'SURFACE_EDIT_POINT_OUTSIDE_DOMAIN'
  | 'SURFACE_EDIT_POINT_ON_BOUNDARY'
  | 'SURFACE_EDIT_POINT_ALREADY_EXISTS'
  | 'SURFACE_EDIT_DELETE_POINT_CONSTRAINED'
  | 'SURFACE_EDIT_DELETE_POINT_BOUNDARY'
  | 'SURFACE_EDIT_DELETE_POINT_CAVITY_INVALID'
  | 'SURFACE_EDIT_MOVE_POINT_CONSTRAINED'
  | 'SURFACE_EDIT_MOVE_POINT_BOUNDARY'
  | 'SURFACE_EDIT_MOVE_POINT_INVALID_STAR'
  | 'SURFACE_EDIT_MOVE_POINT_INTERSECTION'
  | 'SURFACE_EDIT_ELEVATION_INVALID';

export interface CadSurfaceEditBaseline {
  /** Owning surface id (scopes `edit:<surfaceId>:<editId>` keys; absent = legacy stacks without point edits). */
  surfaceId?: string;
  points: CadSurfaceEditMeshPoint[];
  triangles: ReadonlyArray<readonly [number, number, number]>;
  edgeKinds: TinEdgeKinds[];
  /** Source-constraint kinds by canonical index edge key (indices align with points). */
  constrainedKindMap: ReadonlyMap<string, TinEdgeKindCode>;
}

export interface CadSurfaceEditEntryResult {
  editId: string;
  status: CadSurfaceEditStatus;
  reason?: CadSurfaceEditReason;
}

export interface CadSurfaceEditApplySuccess {
  /** Final compacted points (inactive/deleted vertices removed, remapped). */
  points: CadSurfaceEditMeshPoint[];
  triangles: Array<[number, number, number]>;
  edgeKinds: TinEdgeKinds[];
  adjacency: TinAdjacency[];
  results: CadSurfaceEditEntryResult[];
}

export const editStatusOfReason = (reason: CadSurfaceEditReason): CadSurfaceEditStatus => {
  if (reason === 'SURFACE_EDIT_BLOCKED_CONSTRAINT' || reason.endsWith('_CONSTRAINED')) {
    return 'blocked-constraint';
  }
  if (reason === 'SURFACE_EDIT_VERTEX_MISSING' || reason === 'SURFACE_EDIT_SYNTHETIC_VERTEX') {
    return 'broken-reference';
  }
  return 'not-applicable';
};

/** Thrown on the first ENABLED failing edit (disabled edits never block). */
export class CadSurfaceEditFailure extends Error {
  readonly editId: string;
  readonly editIndex: number;
  readonly reason: CadSurfaceEditReason;
  readonly status: CadSurfaceEditStatus;
  constructor(editId: string, editIndex: number, reason: CadSurfaceEditReason) {
    super(`${reason}:${editId}`);
    this.name = 'CadSurfaceEditFailure';
    this.editId = editId;
    this.editIndex = editIndex;
    this.reason = reason;
    this.status = editStatusOfReason(reason);
  }
}

/** Proper crossing of open segment (p,q) with a source-constrained edge it shares no endpoint with. */
const crossesSourceConstraint = (
  pts: CadSurfaceEditMeshPoint[],
  source: ReadonlyMap<string, TinEdgeKindCode>,
  p: number,
  q: number,
): boolean => {
  const keys = [...source.keys()].sort();
  for (const key of keys) {
    if ((source.get(key) ?? TIN_EDGE_FREE) === TIN_EDGE_FREE) continue;
    const [u, v] = key.split('>').map(Number) as [number, number];
    if (u === p || u === q || v === p || v === q) continue;
    if (
      editStraddles(editOrient(pts, p, q, u), editOrient(pts, p, q, v)) &&
      editStraddles(editOrient(pts, u, v, p), editOrient(pts, u, v, q))
    ) {
      return true;
    }
  }
  return false;
};

const applySwap = (state: EditMeshState, source: ReadonlyMap<string, TinEdgeKindCode>, a: number, b: number): void => {
  if (a === b) throw new EditHalt('SURFACE_EDIT_NOT_APPLICABLE');
  const key = tinEdgeKey(a, b);
  const adj = [...(state.edgeMap.get(key) ?? [])].sort((x, y) => x - y);
  if (adj.length === 0) throw new EditHalt('SURFACE_EDIT_EDGE_MISSING');
  if (adj.length !== 2) throw new EditHalt('SURFACE_EDIT_NOT_APPLICABLE');
  if (kindOfEditEdge(state, key) !== TIN_EDGE_FREE) throw new EditHalt('SURFACE_EDIT_BLOCKED_CONSTRAINT');
  const t1 = state.tris.get(adj[0]) as EditTri;
  const t2 = state.tris.get(adj[1]) as EditTri;
  const p = thirdEditVert(t1, a, b);
  const q = thirdEditVert(t2, a, b);
  if (p === undefined || q === undefined || new Set([a, b, p, q]).size !== 4) {
    throw new EditHalt('SURFACE_EDIT_NOT_APPLICABLE');
  }
  // Strictly convex quad: a,b on opposite sides of the new diagonal (exact, no epsilon).
  if (!editStraddles(editOrient(state.pts, p, q, a), editOrient(state.pts, p, q, b))) {
    throw new EditHalt('SURFACE_EDIT_NOT_APPLICABLE');
  }
  const nk = tinEdgeKey(p, q);
  if ((source.get(nk) ?? TIN_EDGE_FREE) !== TIN_EDGE_FREE || crossesSourceConstraint(state.pts, source, p, q)) {
    throw new EditHalt('SURFACE_EDIT_BLOCKED_CONSTRAINT');
  }
  state.tris.delete(adj[0]);
  state.tris.delete(adj[1]);
  unindexEditTri(state, adj[0], t1);
  unindexEditTri(state, adj[1], t2);
  const n1 = ccwEditTri(state.pts, p, q, a);
  const n2 = ccwEditTri(state.pts, p, q, b);
  const id1 = state.nextTri++;
  const id2 = state.nextTri++;
  state.tris.set(id1, n1);
  state.tris.set(id2, n2);
  indexEditTri(state, id1, n1);
  indexEditTri(state, id2, n2);
};

const applyDelete = (state: EditMeshState, a: number, b: number): void => {
  if (a === b) throw new EditHalt('SURFACE_EDIT_NOT_APPLICABLE');
  const key = tinEdgeKey(a, b);
  const adj = state.edgeMap.get(key) ?? [];
  // A vanished edge (sequential delete) fails closed, never silently passes.
  if (adj.length === 0 || adj.length > 2) throw new EditHalt('SURFACE_EDIT_NOT_APPLICABLE');
  if (kindOfEditEdge(state, key) !== TIN_EDGE_FREE) throw new EditHalt('SURFACE_EDIT_BLOCKED_CONSTRAINT');
  // Boundary edge (1 adjacent): exterior retreats. Interior (2 adjacent):
  // both removed (hole). The opposite diagonal is never inserted.
  for (const id of [...adj]) {
    const tri = state.tris.get(id);
    state.tris.delete(id);
    if (tri) unindexEditTri(state, id, tri);
  }
};

/**
 * Sequentially apply an ordered edit stack to a baseline mesh. Returns the
 * compacted, canonically sorted mesh (final point array included) +
 * per-edit results. Throws CadSurfaceEditFailure on the first ENABLED
 * failing edit (disabled edits record 'disabled' and skip geometry).
 *
 * Final compaction (§9): inactive (edit-deleted) vertices are removed, as
 * are edit-added vertices no retained triangle references; surviving
 * baseline vertices are always kept (even isolated — the pre-18T mesh
 * never dropped unused sources). Triangle indices and the constraint map
 * are remapped to the compacted array.
 */
export const applyCadSurfaceEdits = (
  baseline: CadSurfaceEditBaseline,
  edits: CadSurfaceEdit[],
): CadSurfaceEditApplySuccess => {
  const state: EditMeshState = {
    surfaceId: baseline.surfaceId ?? '',
    pts: baseline.points.map((p) => ({ ...p })),
    active: baseline.points.map(() => true),
    byId: new Map(baseline.points.map((p, index) => [p.id, index])),
    tris: new Map(baseline.triangles.map((t, index) => [index, [t[0], t[1], t[2]]])),
    nextTri: baseline.triangles.length,
    edgeMap: new Map(),
    edgeKind: new Map(),
    vertTris: new Map(),
    userLines: new Set(),
  };
  baseline.triangles.forEach((tri, index) => {
    const kinds = baseline.edgeKinds[index] ?? [TIN_EDGE_FREE, TIN_EDGE_FREE, TIN_EDGE_FREE];
    const edges = [
      [tri[1], tri[2]],
      [tri[2], tri[0]],
      [tri[0], tri[1]],
    ] as const;
    edges.forEach(([u, v], k) => {
      const key = tinEdgeKey(u, v);
      const prior = state.edgeKind.get(key) ?? TIN_EDGE_FREE;
      if (kinds[k] > prior) state.edgeKind.set(key, kinds[k]);
    });
  });
  refreshEditEdges(state);
  const results: CadSurfaceEditEntryResult[] = [];
  for (let index = 0; index < edits.length; index += 1) {
    const edit = edits[index];
    if (edit.enabled === false) {
      results.push({ editId: edit.id, status: 'disabled' });
      continue;
    }
    try {
      switch (edit.kind) {
        case 'swap-edge':
          applySwap(
            state,
            baseline.constrainedKindMap,
            resolveEditVertex(state, edit.edge.a.key),
            resolveEditVertex(state, edit.edge.b.key),
          );
          break;
        case 'add-line':
          applyAddLine(state, resolveEditVertex(state, edit.from.key), resolveEditVertex(state, edit.to.key));
          break;
        case 'delete-line':
          applyDelete(state, resolveEditVertex(state, edit.edge.a.key), resolveEditVertex(state, edit.edge.b.key));
          break;
        case 'add-point':
          applyAddPoint(state, edit.id, edit.x, edit.y, edit.z);
          break;
        case 'delete-point':
          applyDeletePoint(state, resolveEditVertex(state, edit.vertex.key));
          break;
        case 'move-point':
          applyMovePoint(state, resolveEditVertex(state, edit.vertex.key), edit.x, edit.y);
          break;
        case 'set-elevation':
          applySetElevation(state, resolveEditVertex(state, edit.vertex.key), edit.z);
          break;
        case 'raise-lower-surface':
          applyRaiseLower(state, edit.deltaZ);
          break;
      }
      results.push({ editId: edit.id, status: 'applied' });
    } catch (error) {
      if (error instanceof EditHalt) throw new CadSurfaceEditFailure(edit.id, index, error.reason);
      throw error;
    }
  }
  return compactEditResult(state, baseline, results);
};

/**
 * Final compaction: drop inactive vertices and unreferenced edit-added
 * vertices, remap triangle indices + the source-constraint map, then
 * rebuild canonical topology over the compacted mesh.
 */
const compactEditResult = (
  state: EditMeshState,
  baseline: CadSurfaceEditBaseline,
  results: CadSurfaceEditEntryResult[],
): CadSurfaceEditApplySuccess => {
  const referenced = new Set<number>();
  for (const tri of state.tris.values()) {
    for (const v of tri) referenced.add(v);
  }
  const baselineCount = baseline.points.length;
  const remap = new Map<number, number>();
  const points: CadSurfaceEditMeshPoint[] = [];
  for (let i = 0; i < state.pts.length; i += 1) {
    // Baseline vertices survive whenever active (even isolated — the
    // pre-18T mesh never dropped unused sources); edit-added vertices
    // survive only while a retained triangle references them.
    const keep = state.active[i] && (i < baselineCount || referenced.has(i));
    if (keep) {
      remap.set(i, points.length);
      const p = state.pts[i];
      points.push({ id: p.id, x: p.x, y: p.y, z: p.z });
    }
  }
  const triangles = [...state.tris.values()]
    .map((t): [number, number, number] => [remap.get(t[0]) as number, remap.get(t[1]) as number, remap.get(t[2]) as number])
    .sort((x, y) => (x[0] !== y[0] ? x[0] - y[0] : x[1] !== y[1] ? x[1] - y[1] : x[2] - y[2]));
  const constrained = new Map<string, TinEdgeKindCode>();
  for (const key of [...baseline.constrainedKindMap.keys()].sort()) {
    const code = baseline.constrainedKindMap.get(key) ?? TIN_EDGE_FREE;
    if (code === TIN_EDGE_FREE) continue;
    const [u, v] = key.split('>').map(Number) as [number, number];
    const nu = remap.get(u);
    const nv = remap.get(v);
    if (nu === undefined || nv === undefined) continue;
    constrained.set(tinEdgeKey(nu, nv), code);
  }
  const topology = buildTinTopology(triangles.map(([a, b, c]) => ({ a, b, c })), constrained);
  return { points, triangles, edgeKinds: topology.edgeKinds, adjacency: topology.adjacency, results };
};
