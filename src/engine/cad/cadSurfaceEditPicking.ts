import { TIN_EDGE_FREE, type TinEdgeKindCode, type TinEdgeKinds } from './tin/tinTypes';

/**
 * Phase 18S TIN edit picking helpers (ENGINE ONLY — pure, no UI, no cache).
 *
 * Mesh in, result out. Triangle indices never leak: callers receive stable
 * vertex refs (`source:<entityId>` / `imported:<surfaceId>:<index>`) and
 * world coordinates only. Synthetic boundary/Steiner vertices are NOT
 * addressable — picking one answers `{ blocked: 'synthetic' }`, never a ref.
 */

export interface SurfaceEditMeshPoint {
  entityId: string;
  x: number;
  y: number;
  z: number;
}

export interface SurfaceEditPickInput {
  surfaceId: string;
  /** 'imported-tin' resolves `<surfaceId>:v<n>` ids to imported refs. */
  sourceKind: 'native' | 'imported-tin';
  revision: string;
  points: readonly SurfaceEditMeshPoint[];
  triangles: ReadonlyArray<readonly [number, number, number]>;
  /** Aligned with triangles (absent = all FREE). */
  edgeKinds?: readonly TinEdgeKinds[];
  worldPoint: { x: number; y: number };
  /** World-unit snap radius (same derivation as CAD snapping). */
  tolerance: number;
}

export interface SurfaceEditVertexRef {
  key: string;
}

export interface SurfaceEditVertexPick {
  surfaceId: string;
  revision: string;
  vertexRef: SurfaceEditVertexRef;
  worldPoint: { x: number; y: number };
}

export interface SurfaceEditEdgePick {
  surfaceId: string;
  revision: string;
  edge: { a: SurfaceEditVertexRef; b: SurfaceEditVertexRef };
  edgeKind: TinEdgeKindCode;
  adjacentCount: number;
  worldPoint: { x: number; y: number };
}

export interface SurfaceEditPickBlocked {
  blocked: 'synthetic';
  reason: string;
}

export const isSurfaceEditSyntheticId = (id: string): boolean =>
  id.startsWith('boundary:') || id.startsWith('steiner:');

/** Inverse of resolveEditVertex: mesh point id -> stable vertex ref, or null when synthetic. */
export const surfaceEditRefOfPointId = (
  sourceKind: 'native' | 'imported-tin',
  surfaceId: string,
  pointId: string,
): SurfaceEditVertexRef | null => {
  if (isSurfaceEditSyntheticId(pointId)) return null;
  if (sourceKind === 'imported-tin') {
    const match = /^(.*):v(\d+)$/.exec(pointId);
    if (match) return { key: `imported:${match[1]}:${match[2]}` };
  }
  return { key: `source:${pointId}` };
};

/**
 * World-unit pick radius, same derivation as CAD snapping
 * (useSurveyCadSnapping FALLBACK_TOLERANCE_RATIO = 1% of the drawing
 * extent, floored at 0.5 m). Centralized here so edit sessions and tests
 * share one number instead of drifting apart.
 */
export const surfaceEditPickTolerance = (
  bounds: { minX: number; minY: number; maxX: number; maxY: number } | null,
): number => {
  if (!bounds) return 1;
  return Math.max(Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) * 0.01, 0.5);
};

const dist2 = (ax: number, ay: number, bx: number, by: number): number => {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
};

/** Nearest vertex within tolerance (index + squared distance), or null. */
const nearestVertex = (
  points: readonly SurfaceEditMeshPoint[],
  worldPoint: { x: number; y: number },
  tolerance: number,
): { index: number; d2: number } | null => {
  const tol2 = tolerance * tolerance;
  let best: { index: number; d2: number } | null = null;
  for (let i = 0; i < points.length; i += 1) {
    const d2 = dist2(points[i].x, points[i].y, worldPoint.x, worldPoint.y);
    if (d2 <= tol2 && (!best || d2 < best.d2)) best = { index: i, d2 };
  }
  return best;
};

/** Squared distance from a world point to segment (a,b). */
const segmentDist2 = (
  ax: number,
  ay: number,
  bx: number,
  by: number,
  px: number,
  py: number,
): number => {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return dist2(ax, ay, px, py);
  const t = Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / len2));
  return dist2(ax + t * dx, ay + t * dy, px, py);
};

/** Kind of mesh edge (u,v): max over adjacent triangles (matches the applicator merge). */
const kindOfMeshEdge = (
  triangles: ReadonlyArray<readonly [number, number, number]>,
  edgeKinds: readonly TinEdgeKinds[] | undefined,
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

/** Adjacent-triangle count for mesh edge (u,v). */
const adjacentCountOf = (
  triangles: ReadonlyArray<readonly [number, number, number]>,
  u: number,
  v: number,
): number => {
  let count = 0;
  for (const tri of triangles) {
    const set = new Set(tri);
    if (set.has(u) && set.has(v)) count += 1;
  }
  return count;
};

/** Nearest unique edge key within tolerance, or null. */
const nearestEdge = (
  points: readonly SurfaceEditMeshPoint[],
  triangles: ReadonlyArray<readonly [number, number, number]>,
  worldPoint: { x: number; y: number },
  tolerance: number,
): { u: number; v: number; d2: number } | null => {
  const tol2 = tolerance * tolerance;
  const seen = new Set<string>();
  let best: { u: number; v: number; d2: number } | null = null;
  for (const tri of triangles) {
    for (const [a, b] of [[tri[0], tri[1]], [tri[1], tri[2]], [tri[2], tri[0]]] as const) {
      const key = `${Math.min(a, b)}>${Math.max(a, b)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const d2 = segmentDist2(
        points[a].x, points[a].y, points[b].x, points[b].y, worldPoint.x, worldPoint.y,
      );
      if (d2 <= tol2 && (!best || d2 < best.d2)) best = { u: a, v: b, d2 };
    }
  }
  return best;
};

/** Nearest mesh vertex as a stable ref; synthetic vertices block (never a ref). */
export const pickSurfaceVertex = (
  input: SurfaceEditPickInput,
): SurfaceEditVertexPick | SurfaceEditPickBlocked | null => {
  const hit = nearestVertex(input.points, input.worldPoint, input.tolerance);
  if (!hit) return null;
  const point = input.points[hit.index];
  if (isSurfaceEditSyntheticId(point.entityId)) {
    return { blocked: 'synthetic', reason: 'Boundary/Steiner vertices cannot be edited — pick a survey point.' };
  }
  return {
    surfaceId: input.surfaceId,
    revision: input.revision,
    vertexRef: surfaceEditRefOfPointId(input.sourceKind, input.surfaceId, point.entityId) ?? {
      key: `source:${point.entityId}`,
    },
    worldPoint: { x: point.x, y: point.y },
  };
};

/** Nearest mesh edge as canonical stable refs; synthetic endpoints block (never a ref). */
export const pickSurfaceEdge = (
  input: SurfaceEditPickInput,
): SurfaceEditEdgePick | SurfaceEditPickBlocked | null => {
  const hit = nearestEdge(input.points, input.triangles, input.worldPoint, input.tolerance);
  if (!hit) return null;
  const idU = input.points[hit.u].entityId;
  const idV = input.points[hit.v].entityId;
  if (isSurfaceEditSyntheticId(idU) || isSurfaceEditSyntheticId(idV)) {
    return { blocked: 'synthetic', reason: 'Boundary/Steiner edges cannot be edited — pick a survey-point edge.' };
  }
  const refU = surfaceEditRefOfPointId(input.sourceKind, input.surfaceId, idU) ?? { key: `source:${idU}` };
  const refV = surfaceEditRefOfPointId(input.sourceKind, input.surfaceId, idV) ?? { key: `source:${idV}` };
  // Canonical sorted-key order (matches the engine edit identity).
  const [a, b] = refU.key <= refV.key ? [refU, refV] : [refV, refU];
  return {
    surfaceId: input.surfaceId,
    revision: input.revision,
    edge: { a, b },
    edgeKind: kindOfMeshEdge(input.triangles, input.edgeKinds, hit.u, hit.v),
    adjacentCount: adjacentCountOf(input.triangles, hit.u, hit.v),
    worldPoint: { x: input.worldPoint.x, y: input.worldPoint.y },
  };
};
