import type { CadDisplayPrimitive } from '../../engine/cad/cadDisplayTypes';
import type { CachedSurfaceMesh } from '../../engine/cad/cadSurfaceCache';
import type { CadSurfaceEdit } from '../../engine/cad/cadTypes';
import { replaySurfaceEdits } from '../../engine/cad/cadSurfaces';
import type { SurfaceVertexRef, Xy } from './surfaceBulkSelectionUtils';
import { surfaceBulkModeLabel, type SurfaceBulkEditMode } from './surfaceBulkSelectionUtils';

/*
 * Phase 18V bulk-edit session helpers (pure — no React, no persistence).
 *
 * The move preview validates the PROPOSED final coordinates through the
 * engine's own replay (`replaySurfaceEdits` on a private clone of the
 * current final mesh) so the reported blocking class is authoritative and
 * the current cache is never mutated. Z sessions need no geometry
 * validation: refs resolve against the fresh mesh at commit.
 */

export interface SurfaceBulkSelectSession {
  kind: 'select';
  mode: 'window' | 'polygon';
  surfaceId: string;
  surfaceName: string;
  revision: string;
  points: Xy[];
  /** Live preview refs computed against the current final mesh. */
  previewRefs: SurfaceVertexRef[];
  issue: string | null;
  prompt: string;
}

export interface SurfaceBulkValueSessionBase {
  surfaceId: string;
  surfaceName: string;
  revision: string;
  refs: SurfaceVertexRef[];
  value: number | null;
  prompt: string;
}

export type SurfaceBulkValueSession =
  | (SurfaceBulkValueSessionBase & { kind: 'set-elevation' })
  | (SurfaceBulkValueSessionBase & { kind: 'raise-lower' });

export interface SurfaceBulkMoveSession {
  kind: 'move';
  surfaceId: string;
  surfaceName: string;
  revision: string;
  refs: SurfaceVertexRef[];
  base: Xy | null;
  dest: Xy | null;
  delta: { dx: number; dy: number } | null;
  /** Proposed final positions (same order as refs) for the ghost preview. */
  proposed: Xy[] | null;
  issue: string | null;
  prompt: string;
}

export type SurfaceBulkSessionState =
  | SurfaceBulkSelectSession
  | SurfaceBulkValueSession
  | SurfaceBulkMoveSession;

/** Commands the bulk-edit hook owns (SURFSETELEVMULTI / SURFRAISELOWERSELECTED / SURFMOVEPOINTS). */
export type SurfaceBulkCommandSession = SurfaceBulkValueSession | SurfaceBulkMoveSession;

export const fmt = (value: number): string => value.toFixed(3);

/** Stable mesh id for a ref key (inverse of surfaceEditRefOfPointId). */
export const entityIdOfRefKey = (key: string): string => {
  if (key.startsWith('source:')) return key.slice('source:'.length);
  if (key.startsWith('imported:')) {
    const parts = key.split(':');
    return `${parts.slice(1, -1).join(':')}:v${parts[parts.length - 1]}`;
  }
  return key;
};

/** Mesh point for each ref in order; missing refs yield null (caller blocks). */
export const pointsOfRefs = (
  mesh: CachedSurfaceMesh,
  refs: ReadonlyArray<SurfaceVertexRef>,
): Array<Xy | null> => {
  const byId = new Map(mesh.points.map((point) => [point.entityId, point]));
  return refs.map((ref) => {
    const point = byId.get(entityIdOfRefKey(ref.key));
    return point ? { x: point.x, y: point.y } : null;
  });
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
  sourceEntityId: 'surface-bulk-overlay',
  points: [{ x: a.x, y: a.y }, { x: b.x, y: b.y }],
  stroke,
  strokeWidth: 2,
  ...(dashed ? { strokeDasharray: '6 4' } : {}),
});

export const pointPrimitive = (id: string, layerId: string, at: Xy, stroke: string): CadDisplayPrimitive => ({
  id,
  kind: 'point',
  layerId,
  sourceEntityId: 'surface-bulk-overlay',
  point: { x: at.x, y: at.y },
  radius: 4,
  stroke,
});

/** Selected refs as highlight markers (work for both select + bulk previews). */
export const selectedPointPrimitives = (
  layerId: string,
  mesh: CachedSurfaceMesh,
  refs: ReadonlyArray<SurfaceVertexRef>,
  stroke: string,
  idPrefix = 'surface-bulk-selected',
): CadDisplayPrimitive[] =>
  pointsOfRefs(mesh, refs).flatMap((point, index) =>
    point ? [pointPrimitive(`${idPrefix}-${index}`, layerId, point, stroke)] : [],
  );

/** Closed polygon outline (+ live vertex chain) for the polygon selection preview. */
export const polygonPrimitives = (layerId: string, points: ReadonlyArray<Xy>): CadDisplayPrimitive[] => {
  const out: CadDisplayPrimitive[] = [];
  for (let i = 0; i + 1 < points.length; i += 1) {
    out.push(linePrimitive(`surface-bulk-poly-${i}`, layerId, points[i], points[i + 1], '#38bdf8', false));
  }
  if (points.length >= 3) {
    out.push(linePrimitive('surface-bulk-poly-close', layerId, points[points.length - 1], points[0], '#38bdf8', true));
  }
  return out;
};

/** Opposite-corner rectangle preview for the window selection. */
export const windowPrimitives = (layerId: string, points: ReadonlyArray<Xy>): CadDisplayPrimitive[] => {
  if (points.length < 2) return [];
  const a = points[0];
  const b = points[points.length - 1];
  const corners: Xy[] = [{ x: a.x, y: a.y }, { x: b.x, y: a.y }, { x: b.x, y: b.y }, { x: a.x, y: b.y }];
  return corners.map((corner, index) =>
    linePrimitive(`surface-bulk-window-${index}`, layerId, corner, corners[(index + 1) % corners.length], '#38bdf8', true),
  );
};

const baselineOf = (mesh: CachedSurfaceMesh) => ({
  points: mesh.points.map((point) => ({ entityId: point.entityId, x: point.x, y: point.y, z: point.z })),
  triangles: mesh.triangles,
  adjacency: mesh.adjacency,
  edgeKinds: mesh.edgeKinds,
  // constrainedKindMap is only consulted by topology edits (swap/add-line);
  // the move kernel reads per-triangle edgeKinds, which the mesh carries.
  constrained: new Map<string, never>(),
});

export interface MoveProposal {
  proposed: Xy[] | null;
  reason: string | null;
}

/**
 * Read-only proposal: run the engine's simultaneous-move kernel over a
 * private clone of the current FINAL mesh and return the proposed positions
 * (refs order) or the authoritative blocking class.
 */
export const validateMoveProposal = (
  surfaceId: string,
  mesh: CachedSurfaceMesh,
  refs: ReadonlyArray<SurfaceVertexRef>,
  deltaX: number,
  deltaY: number,
): MoveProposal => {
  const proposal: CadSurfaceEdit = {
    id: 'surface-bulk-move-proposal',
    kind: 'move-points',
    vertices: refs.map((ref) => ({ key: ref.key })),
    deltaX,
    deltaY,
  };
  const replayed = replaySurfaceEdits([proposal], baselineOf(mesh), surfaceId);
  if ('failure' in replayed) return { proposed: null, reason: replayed.failure.reason };
  const byId = new Map(replayed.points.map((point) => [point.entityId, point]));
  const proposed: Xy[] = [];
  for (const ref of refs) {
    const point = byId.get(entityIdOfRefKey(ref.key));
    if (!point) return { proposed: null, reason: 'SURFACE_EDIT_VERTEX_MISSING' };
    proposed.push({ x: point.x, y: point.y });
  }
  return { proposed, reason: null };
};

export const bulkValuePrompt = (
  mode: SurfaceBulkEditMode,
  surfaceName: string,
  count: number,
): string => {
  const label = surfaceBulkModeLabel(mode);
  return mode === 'set-elevation'
    ? `${label} on “${surfaceName}” (${count} vertices, Surface-only): type the target Z, Enter commits, Esc ends.`
    : `${label} on “${surfaceName}” (${count} vertices, Surface-only): type the ΔZ, Enter commits, Esc ends.`;
};

export const movePrompt = (surfaceName: string, count: number, base: Xy | null): string =>
  base == null
    ? `Move Selected Points on “${surfaceName}” (${count} vertices, Surface-only, Z unchanged): pick the base point.`
    : `Move Selected Points on “${surfaceName}” (${count} vertices): base (${fmt(base.x)}, ${fmt(base.y)}) held — pick the destination.`;
