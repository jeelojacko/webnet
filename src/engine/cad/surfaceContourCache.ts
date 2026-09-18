import type { CadSurfaceContourSet } from './surfaceContours/contourTypes';

/**
 * Phase 18H derived contour cache.
 *
 * Scoped service (one per document/session — never a global singleton).
 * Keyed `scopeId::surfaceId@surfaceRevision@contourGeometryRevision`;
 * stores contour sets only, never in React state, never in history.
 * Bounded: current + ≤1 stale previous set per surface (mirrors the TIN
 * storeMeshBounded policy). Session-only: invalidate on surface delete or
 * drawing switch (clear).
 */

export interface CachedContourSet {
  set: CadSurfaceContourSet;
}

export interface CadSurfaceContourCache {
  get: (_surfaceId: string, _surfaceRevision: string, _geometryRevision: string) => CadSurfaceContourSet | undefined;
  set: (_surfaceId: string, _set: CadSurfaceContourSet) => void;
  invalidate: (_surfaceId: string) => void;
  clear: () => void;
  /** All retained sets for a surface (current + ≤1 stale), newest last. */
  retained: (_surfaceId: string) => CadSurfaceContourSet[];
}

export const createCadSurfaceContourCache = (scopeId: string): CadSurfaceContourCache => {
  const store = new Map<string, CadSurfaceContourSet>();
  const keyOf = (surfaceId: string, surfaceRevision: string, geometryRevision: string): string =>
    `${scopeId}::${surfaceId}@${surfaceRevision}@${geometryRevision}`;
  const prefixOf = (surfaceId: string): string => `${scopeId}::${surfaceId}@`;

  const boundSurface = (surfaceId: string): void => {
    const prefix = prefixOf(surfaceId);
    const keys = [...store.keys()].filter((key) => key.startsWith(prefix)).sort();
    while (keys.length > 2) {
      const oldest = keys.shift();
      if (oldest) store.delete(oldest);
    }
  };

  return {
    get: (surfaceId, surfaceRevision, geometryRevision) =>
      store.get(keyOf(surfaceId, surfaceRevision, geometryRevision)),
    set: (surfaceId, set) => {
      store.set(keyOf(surfaceId, set.surfaceRevision, set.styleRevision), set);
      boundSurface(surfaceId);
    },
    invalidate: (surfaceId) => {
      const prefix = prefixOf(surfaceId);
      for (const key of [...store.keys()]) {
        if (key.startsWith(prefix)) store.delete(key);
      }
    },
    clear: () => {
      store.clear();
    },
    retained: (surfaceId) => {
      const prefix = prefixOf(surfaceId);
      return [...store.entries()]
        .filter(([key]) => key.startsWith(prefix))
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([, set]) => set);
    },
  };
};
