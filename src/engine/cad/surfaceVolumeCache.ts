import type { CadVolumeResult } from './cadTypes';

/**
 * Phase 18I derived volume cache.
 *
 * Scoped service (one per document/session — never a global singleton).
 * Keyed `scopeId::volumeId@volumeRevision`; stores CadVolumeResult only,
 * never in React state, never in history.
 *
 * Bounded: current + ≤1 stale previous result per volume, evicted by
 * EXPLICIT insertion-order keeper list (oldest set first) — never by
 * lexicographic key sort (the contour `boundSurface` recency bug is not
 * repeated: a stale revision with a "smaller" key must not survive over a
 * newer one). Session-only: invalidate on volume delete or drawing switch.
 */

export interface CadSurfaceVolumeCache {
  get: (_volumeId: string, _revision: string) => CadVolumeResult | undefined;
  set: (_volumeId: string, _result: CadVolumeResult) => void;
  invalidate: (_volumeId: string) => void;
  clear: () => void;
  /** All retained results for a volume (oldest first, current last). */
  retained: (_volumeId: string) => CadVolumeResult[];
}

export const createCadSurfaceVolumeCache = (scopeId: string): CadSurfaceVolumeCache => {
  const store = new Map<string, CadVolumeResult>();
  /** volumeId -> revision insertion order (oldest first); the keeper list. */
  const keepers = new Map<string, string[]>();
  const keyOf = (volumeId: string, revision: string): string => `${scopeId}::${volumeId}@${revision}`;
  const prefixOf = (volumeId: string): string => `${scopeId}::${volumeId}@`;

  return {
    get: (volumeId, revision) => store.get(keyOf(volumeId, revision)),
    set: (volumeId, result) => {
      store.set(keyOf(volumeId, result.revision), result);
      const list = (keepers.get(volumeId) ?? []).filter((entry) => entry !== result.revision);
      list.push(result.revision);
      // Explicit keeper eviction: drop the oldest stale until ≤2 remain.
      while (list.length > 2) {
        const evicted = list.shift();
        if (evicted != null) store.delete(keyOf(volumeId, evicted));
      }
      keepers.set(volumeId, list);
    },
    invalidate: (volumeId) => {
      const prefix = prefixOf(volumeId);
      for (const key of [...store.keys()]) {
        if (key.startsWith(prefix)) store.delete(key);
      }
      keepers.delete(volumeId);
    },
    clear: () => {
      store.clear();
      keepers.clear();
    },
    retained: (volumeId) =>
      (keepers.get(volumeId) ?? [])
        .map((revision) => store.get(keyOf(volumeId, revision)))
        .filter((result): result is CadVolumeResult => result != null),
  };
};
