import { orient2d } from 'robust-predicates';
import type { CadDisplayPrimitive } from '../../engine/cad/cadDisplayTypes';
import type { CadSurfaceCache } from '../../engine/cad/cadSurfaceCache';
import { TIN_EDGE_FREE, type TinEdgeKindCode } from '../../engine/cad/tin/tinTypes';
import type { CadCommand } from '../../engine/cad/cadTransactions.types';
import type { CadProject } from '../../engine/cad/cadTypes';
import { currentSurfaceEditMesh } from './useSurveyCadSurfaceEditSessions';

/*
 * Phase 18T point/elevation session helpers (pure mesh math, labels, and
 * overlay primitives — no React, no geometry writes). The session hook owns
 * the staged state; everything here is independently unit-friendly.
 */


export type SurfacePointEditSessionMode =
  | 'add-point'
  | 'delete-point'
  | 'move-point'
  | 'set-elevation'
  | 'raise-lower';

export const SURFACE_POINT_EDIT_STALE_MESSAGE =
  'Rebuild the surface before editing points (SURFACE_EDIT_STALE_REVISION) — re-pick against the fresh mesh.';

export type Xy = { x: number; y: number };

interface StagedAddPoint {
  kind: 'add-point';
  x: number;
  y: number;
  z: number;
  customZ: boolean;
  outline: Xy[];
}

interface StagedDeletePoint {
  kind: 'delete-point';
  vertexKey: string;
  label: string;
  ring: Xy[];
  blocked: string | null;
}

interface StagedMovePoint {
  kind: 'move-point';
  vertexKey: string;
  label: string;
  from: Xy;
  to: Xy | null;
  issue: string | null;
}

interface StagedSetElevation {
  kind: 'set-elevation';
  vertexKey: string;
  label: string;
  currentZ: number;
  baseZ: number | null;
  newZ: number | null;
}

interface StagedRaiseLower {
  kind: 'raise-lower-surface';
  deltaZ: number | null;
}

export type StagedPointEdit =
  | StagedAddPoint
  | StagedDeletePoint
  | StagedMovePoint
  | StagedSetElevation
  | StagedRaiseLower;

export interface SurfacePointEditSessionState {
  mode: SurfacePointEditSessionMode;
  surfaceId: string;
  surfaceName: string;
  staged: StagedPointEdit | null;
  /** First move-point vertex (second pick is the XY target, Z unchanged). */
  heldVertex: { key: string; label: string; x: number; y: number } | null;
  prompt: string;
}

export interface Deps {
  project: CadProject;
  cache: CadSurfaceCache;
  selectedSurfaceId: string | null;
  buildingSurfaceIds: ReadonlySet<string>;
  runCommand: (_command: CadCommand) => boolean;
  rebuildSurface: (_surfaceId: string) => string;
  notify: (_message: string) => void;
}

export const meshOf = (deps: Deps, surfaceId: string) =>
  currentSurfaceEditMesh(deps.project, deps.cache, surfaceId, deps.buildingSurfaceIds);

export const fmt = (value: number): string => value.toFixed(3);

const shortStation = (stationId: string): string =>
  /^[A-Za-z]/.test(stationId) ? stationId : `P${stationId}`;

/** 1-based E-number of each add-point edit id (display only, definition order). */
export const editNumbers = (edits: ReadonlyArray<{ id: string; kind: string }>): Map<string, number> => {
  const out = new Map<string, number>();
  let count = 0;
  for (const edit of edits) {
    if (edit.kind === 'add-point') {
      count += 1;
      out.set(edit.id, count);
    }
  }
  return out;
};

export const labelOfKey = (
  deps: Deps,
  key: string,
  numbers: Map<string, number>,
): string => {
  if (key.startsWith('source:')) {
    const entity = deps.project.entities.find((entry) => entry.id === key.slice('source:'.length));
    if (entity?.type === 'survey-point') return shortStation(entity.stationId);
    return 'unresolved';
  }
  if (key.startsWith('imported:')) {
    const index = Number(key.split(':').pop());
    return Number.isInteger(index) ? `V${index}` : 'unresolved';
  }
  if (key.startsWith('edit:')) {
    const id = key.split(':').pop() ?? '';
    const at = numbers.get(id);
    return at != null ? `E${at}` : 'unresolved';
  }
  return 'unresolved';
};

export const entityIdOfKey = (key: string): string => {
  if (key.startsWith('source:')) return key.slice('source:'.length);
  if (key.startsWith('imported:')) {
    const parts = key.split(':');
    return `${parts[1]}:v${parts[parts.length - 1]}`;
  }
  return key;
};

/** Base (pre-override) Z: native entity Z, imported vertex Z, or creating add-point Z. */
export const baseZOf = (
  deps: Deps,
  surfaceId: string,
  key: string,
): number | null => {
  const surface = (deps.project.surfaces ?? []).find((entry) => entry.id === surfaceId);
  if (!surface) return null;
  if (key.startsWith('source:')) {
    const entity = deps.project.entities.find((entry) => entry.id === key.slice('source:'.length));
    return entity?.type === 'survey-point' && typeof entity.z === 'number' ? entity.z : null;
  }
  if (key.startsWith('imported:')) {
    const index = Number(key.split(':').pop());
    const verts = surface.definition.sourceKind === 'native'
      ? undefined
      : surface.definition.importedTin?.vertices;
    return verts != null && Number.isInteger(index) ? (verts[index * 3 + 2] ?? null) : null;
  }
  if (key.startsWith('edit:')) {
    const id = key.slice(`edit:${surfaceId}:`.length);
    const creator = (surface.definition.edits ?? []).find((entry) => entry.id === id);
    return creator?.kind === 'add-point' ? creator.z : null;
  }
  return null;
};

/** Max edge kind over adjacent tris (slot order matches the picking helper). */
const kindOfMeshEdge = (
  triangles: ReadonlyArray<readonly [number, number, number]>,
  edgeKinds: ReadonlyArray<readonly [TinEdgeKindCode, TinEdgeKindCode, TinEdgeKindCode]> | undefined,
  u: number,
  v: number,
): TinEdgeKindCode => {
  if (!edgeKinds) return TIN_EDGE_FREE;
  let kind = TIN_EDGE_FREE;
  for (let i = 0; i < triangles.length; i += 1) {
    const tri = triangles[i];
    const edges = [[tri[1], tri[2]], [tri[2], tri[0]], [tri[0], tri[1]]] as const;
    for (let k = 0; k < 3; k += 1) {
      const [a, b] = edges[k];
      if ((a === u && b === v) || (a === v && b === u)) {
        const code = edgeKinds[i]?.[k] ?? TIN_EDGE_FREE;
        if (code > kind) kind = code;
      }
    }
  }
  return kind;
};

const adjacentCountOf = (
  triangles: ReadonlyArray<readonly [number, number, number]>,
  u: number,
  v: number,
): number => {
  let count = 0;
  for (const tri of triangles) {
    if (tri.includes(u) && tri.includes(v)) count += 1;
  }
  return count;
};

export interface VertexTopology {
  index: number;
  neighbors: number[];
  boundary: boolean;
  constrained: boolean;
}

export const topologyOf = (
  triangles: ReadonlyArray<readonly [number, number, number]>,
  edgeKinds: ReadonlyArray<readonly [TinEdgeKindCode, TinEdgeKindCode, TinEdgeKindCode]> | undefined,
  index: number,
): VertexTopology => {
  const neighbors = new Set<number>();
  let boundary = false;
  let constrained = false;
  for (const tri of triangles) {
    if (!tri.includes(index)) continue;
    for (const [a, b] of [[tri[0], tri[1]], [tri[1], tri[2]], [tri[2], tri[0]]] as const) {
      if (a !== index && b !== index) continue;
      const other = a === index ? b : a;
      neighbors.add(other);
      if (adjacentCountOf(triangles, a, b) < 2) boundary = true;
      if (kindOfMeshEdge(triangles, edgeKinds, a, b) !== TIN_EDGE_FREE) constrained = true;
    }
  }
  return { index, neighbors: [...neighbors], boundary, constrained };
};

/** Strict proper crossing (exact, no epsilon). */
const properlyCrosses = (
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number,
): boolean => {
  const o1 = orient2d(ax, ay, bx, by, cx, cy);
  const o2 = orient2d(ax, ay, bx, by, dx, dy);
  const o3 = orient2d(cx, cy, dx, dy, ax, ay);
  const o4 = orient2d(cx, cy, dx, dy, bx, by);
  return o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0 && (o1 > 0) !== (o2 > 0) && (o3 > 0) !== (o4 > 0);
};

export const linePrimitive = (
  id: string,
  layerId: string,
  a: Xy,
  b: Xy,
  stroke: string,
  dashed: boolean,
): CadDisplayPrimitive => ({
  id,
  kind: 'line',
  layerId,
  sourceEntityId: 'surface-edit-overlay',
  points: [{ x: a.x, y: a.y }, { x: b.x, y: b.y }],
  stroke,
  strokeWidth: 2,
  ...(dashed ? { strokeDasharray: '6 4' } : {}),
});

export const pointPrimitive = (id: string, layerId: string, at: Xy, stroke: string): CadDisplayPrimitive => ({
  id,
  kind: 'point',
  layerId,
  sourceEntityId: 'surface-edit-overlay',
  point: { x: at.x, y: at.y },
  radius: 5,
  stroke,
});

export const sessionPromptKey = (mode: SurfacePointEditSessionMode): string =>
  mode === 'add-point' ? 'SURFADDPOINT'
    : mode === 'delete-point' ? 'SURFDELETEPOINT'
      : mode === 'move-point' ? 'SURFMOVEPOINT'
        : mode === 'set-elevation' ? 'SURFSETELEV'
          : 'SURFRAISELOWER';

/** Winding-agnostic containing-triangle outline for the add-point preview. */
export const containingOutline = (
  points: readonly { x: number; y: number }[],
  triangles: ReadonlyArray<readonly [number, number, number]>,
  at: Xy,
): Xy[] | null => {
  for (const tri of triangles) {
    const [a, b, c] = [points[tri[0]], points[tri[1]], points[tri[2]]];
    const o1 = orient2d(a.x, a.y, b.x, b.y, at.x, at.y);
    const o2 = orient2d(b.x, b.y, c.x, c.y, at.x, at.y);
    const o3 = orient2d(c.x, c.y, a.x, a.y, at.x, at.y);
    if ((o1 >= 0 && o2 >= 0 && o3 >= 0) || (o1 <= 0 && o2 <= 0 && o3 <= 0)) {
      return [{ x: a.x, y: a.y }, { x: b.x, y: b.y }, { x: c.x, y: c.y }];
    }
  }
  return null;
};

/**
 * Stage the move target with the compatibility check (XY-only, Z
 * unchanged). Out-of-policy targets explain Delete+Add instead — the move
 * is never clamped.
 */
export const stageMoveTarget = (
  deps: Deps,
  session: SurfacePointEditSessionState,
  setSession: (_next: SurfacePointEditSessionState) => void,
  points: readonly { x: number; y: number }[],
  triangles: ReadonlyArray<readonly [number, number, number]>,
  edgeKinds: ReadonlyArray<readonly [TinEdgeKindCode, TinEdgeKindCode, TinEdgeKindCode]> | undefined,
  index: number,
  target: Xy,
): void => {
  const name = `“${session.surfaceName}”`;
  const staged = session.staged;
  if (!staged || staged.kind !== 'move-point') return;
  const fail = (issue: string): void => {
    setSession({ ...session, staged: { ...staged, to: target, issue }, prompt: issue });
    deps.notify(issue);
  };
  if (!Number.isFinite(target.x) || !Number.isFinite(target.y)) {
    fail(`SURFMOVEPOINT on ${name} rejected (SURFACE_EDIT_MOVE_POINT_INVALID_STAR) — target is not finite; Delete + Add the point instead (Surface-only).`);
    return;
  }
  const topo = topologyOf(triangles, edgeKinds, index);
  if (topo.boundary) {
    fail(`SURFMOVEPOINT on ${name} blocked (SURFACE_EDIT_MOVE_POINT_BOUNDARY) — ${staged.label} is on the boundary; Delete + Add the point instead (Surface-only).`);
    return;
  }
  if (topo.constrained) {
    fail(`SURFMOVEPOINT on ${name} blocked (SURFACE_EDIT_MOVE_POINT_CONSTRAINED) — ${staged.label} touches a constrained edge; Delete + Add the point instead (Surface-only).`);
    return;
  }
  if (points.some((point, other) => other !== index && point.x === target.x && point.y === target.y)) {
    fail(`SURFMOVEPOINT on ${name} rejected (SURFACE_EDIT_MOVE_POINT_INVALID_STAR) — target coincides with another vertex; Delete + Add the point instead (Surface-only).`);
    return;
  }
  for (const tri of triangles) {
    if (!tri.includes(index)) continue;
    const sub = tri.map((w) => (w === index ? target : points[w]));
    const before = orient2d(points[tri[0]].x, points[tri[0]].y, points[tri[1]].x, points[tri[1]].y, points[tri[2]].x, points[tri[2]].y);
    const after = orient2d(sub[0].x, sub[0].y, sub[1].x, sub[1].y, sub[2].x, sub[2].y);
    if (after === 0 || (after > 0) !== (before > 0)) {
      fail(`SURFMOVEPOINT on ${name} rejected (SURFACE_EDIT_MOVE_POINT_INVALID_STAR) — the target collapses or flips a triangle; Delete + Add the point instead (Surface-only).`);
      return;
    }
  }
  for (const other of topo.neighbors) {
    const pw = points[other];
    for (const tri of triangles) {
      for (const [u1, u2] of [[tri[0], tri[1]], [tri[1], tri[2]], [tri[2], tri[0]]] as const) {
        if (u1 === index || u2 === index) continue;
        const p1 = points[u1];
        const p2 = points[u2];
        if (properlyCrosses(target.x, target.y, pw.x, pw.y, p1.x, p1.y, p2.x, p2.y)) {
          fail(`SURFMOVEPOINT on ${name} rejected (SURFACE_EDIT_MOVE_POINT_INTERSECTION) — the target crosses an unrelated edge; Delete + Add the point instead (Surface-only).`);
          return;
        }
      }
    }
  }
  setSession({
    ...session,
    staged: { ...staged, to: target, issue: null },
    prompt: `Move staged on ${name} (Surface-only, Z unchanged): ${staged.label} → (${target.x.toFixed(3)}, ${target.y.toFixed(3)}) — Enter commits, pick again to restage, Esc ends.`,
  });
};
