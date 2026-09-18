import { computeCadSurfaceSourceRevision } from './cadSurfaces';
import type { CadSurfaceBuildResult, CadSurfaceGrid } from './cadSurfaces';
import type { TinAdjacency, TinEdgeKinds } from './tin/tinTypes';
import type { CadProject } from './cadTypes';

/**
 * Phase 18F derived surface-mesh cache.
 *
 * Scoped service (one per document/session — never a global mutable
 * singleton, so two CadProject objects stay independent). Stores mesh
 * results only, keyed by surface id + content revision; never in React
 * state, never in history. The apply helpers enforce latest-wins: a result
 * whose revision != the surface's current content revision is discarded and
 * can never mark the surface CURRENT. Applying results never dirties the
 * drawing — always call outside runCadCommand/history.
 */

export interface CachedSurfaceMesh {
  revision: string;
  points: CadSurfaceBuildResult['points'];
  triangles: CadSurfaceBuildResult['triangles'];
  stats: CadSurfaceBuildResult['stats'];
  /** Query index over retained triangles (session-only, never persisted). */
  grid: CadSurfaceGrid;
  /** Derived topology seam for 18H (session-only, never persisted). */
  adjacency: TinAdjacency[];
  edgeKinds: TinEdgeKinds[];
}

export interface CadSurfaceCache {
  get: (_surfaceId: string, _revision: string) => CachedSurfaceMesh | undefined;
  set: (_surfaceId: string, _revision: string, _mesh: CachedSurfaceMesh) => void;
  invalidate: (_surfaceId: string) => void;
  clear: () => void;
}

export const createCadSurfaceCache = (scopeId: string): CadSurfaceCache => {
  const store = new Map<string, CachedSurfaceMesh>();
  const keyOf = (surfaceId: string, revision: string): string =>
    `${scopeId}::${surfaceId}@${revision}`;
  return {
    get: (surfaceId, revision) => store.get(keyOf(surfaceId, revision)),
    set: (surfaceId, revision, mesh) => {
      store.set(keyOf(surfaceId, revision), mesh);
    },
    invalidate: (surfaceId) => {
      const prefix = `${scopeId}::${surfaceId}@`;
      for (const key of [...store.keys()]) {
        if (key.startsWith(prefix)) store.delete(key);
      }
    },
    clear: () => {
      store.clear();
    },
  };
};

const findSurface = (project: CadProject, surfaceId: string) =>
  (project.surfaces ?? []).find((entry) => entry.id === surfaceId);

/**
 * Apply a worker build success. Stale results (revision != current content
 * revision) are discarded: project returned unchanged, nothing cached. A
 * matching `ok` result caches the mesh and records the revision (the
 * surface derives CURRENT); non-ok outcomes write nothing — the status
 * derives FAILED/INSUFFICIENT_DATA from the definition itself.
 */
export const applySurfaceBuildSuccess = (
  project: CadProject,
  cache: CadSurfaceCache,
  surfaceId: string,
  revision: string,
  result: Pick<CadSurfaceBuildResult, 'outcome' | 'points' | 'triangles' | 'stats' | 'grid' | 'adjacency' | 'edgeKinds'>,
): CadProject => {
  const surface = findSurface(project, surfaceId);
  if (!surface) return project;
  if (computeCadSurfaceSourceRevision(project, surface) !== revision) return project;
  if (result.outcome !== 'ok') return project;
  cache.set(surfaceId, revision, {
    revision,
    points: result.points.map((point) => ({ ...point })),
    triangles: result.triangles.map((tri) => [tri[0], tri[1], tri[2]] as [number, number, number]),
    stats: { ...result.stats },
    grid: {
      minX: result.grid.minX,
      minY: result.grid.minY,
      cellSize: result.grid.cellSize,
      cells: new Map([...result.grid.cells].map(([key, list]) => [key, [...list]] as [string, number[]])),
    },
    adjacency: result.adjacency.map((row) => [row[0], row[1], row[2]] as TinAdjacency),
    edgeKinds: result.edgeKinds.map((row) => [row[0], row[1], row[2]] as TinEdgeKinds),
  });
  return {
    ...project,
    surfaces: (project.surfaces ?? []).map((entry) =>
      entry.id === surfaceId
        ? { ...entry, cachedRevision: revision, buildDiagnostic: undefined }
        : entry,
    ),
  };
};

/**
 * Apply a worker transport failure: records the diagnostic without touching
 * the cached revision (status keeps deriving NEEDS_REBUILD, never CURRENT).
 * Stale failures (revision != current) are discarded.
 */
export const applySurfaceBuildFailure = (
  project: CadProject,
  surfaceId: string,
  revision: string,
  error: string,
): CadProject => {
  const surface = findSurface(project, surfaceId);
  if (!surface) return project;
  if (computeCadSurfaceSourceRevision(project, surface) !== revision) return project;
  return {
    ...project,
    surfaces: (project.surfaces ?? []).map((entry) =>
      entry.id === surfaceId ? { ...entry, buildDiagnostic: error } : entry,
    ),
  };
};
