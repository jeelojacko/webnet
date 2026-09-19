import type { CadSurfaceProfileResult } from './profiles/profileExtraction';

/**
 * Phase 18J derived profile cache.
 *
 * Scoped service (one per document/session — never a global singleton).
 * Keyed `scopeId::profileId@revision`; stores CadSurfaceProfileResult only,
 * never in React state, never in history.
 *
 * Bounded: current + ≤1 stale previous result per profile, evicted by
 * EXPLICIT insertion-order keeper list (oldest set first) — never by
 * lexicographic key sort. Session-only: invalidate on profile delete or
 * drawing switch. Stale results are rejected on apply (revision must still
 * match the profile's current content revision, re-derived by the caller).
 */

export interface CadProfileCache {
  get: (_profileId: string, _revision: string) => CadSurfaceProfileResult | undefined;
  set: (_profileId: string, _result: CadSurfaceProfileResult) => void;
  invalidate: (_profileId: string) => void;
  clear: () => void;
  /** All retained results for a profile (oldest first, current last). */
  retained: (_profileId: string) => CadSurfaceProfileResult[];
}

export const createCadProfileCache = (scopeId: string): CadProfileCache => {
  const store = new Map<string, CadSurfaceProfileResult>();
  /** profileId -> revision insertion order (oldest first); the keeper list. */
  const keepers = new Map<string, string[]>();
  const keyOf = (profileId: string, revision: string): string =>
    `${scopeId}::${profileId}@${revision}`;
  const prefixOf = (profileId: string): string => `${scopeId}::${profileId}@`;

  return {
    get: (profileId, revision) => store.get(keyOf(profileId, revision)),
    set: (profileId, result) => {
      store.set(keyOf(profileId, result.revision), result);
      const list = (keepers.get(profileId) ?? []).filter((entry) => entry !== result.revision);
      list.push(result.revision);
      // Explicit keeper eviction: drop the oldest stale until ≤2 remain.
      while (list.length > 2) {
        const evicted = list.shift();
        if (evicted != null) store.delete(keyOf(profileId, evicted));
      }
      keepers.set(profileId, list);
    },
    invalidate: (profileId) => {
      const prefix = prefixOf(profileId);
      for (const key of [...store.keys()]) {
        if (key.startsWith(prefix)) store.delete(key);
      }
      keepers.delete(profileId);
    },
    clear: () => {
      store.clear();
      keepers.clear();
    },
    retained: (profileId) =>
      (keepers.get(profileId) ?? [])
        .map((revision) => store.get(keyOf(profileId, revision)))
        .filter((result): result is CadSurfaceProfileResult => result != null),
  };
};

export interface ProfileCacheApply {
  /** Current content revision of the profile (re-derived by the caller). */
  currentRevision: string;
  result: CadSurfaceProfileResult;
}

/**
 * Apply an extraction success. Stale results (revision != current content
 * revision) are discarded: cache untouched, false returned. Matching
 * results are cached, true returned.
 */
export const applyProfileExtractionSuccess = (
  cache: CadProfileCache,
  profileId: string,
  apply: ProfileCacheApply,
): boolean => {
  if (apply.result.revision !== apply.currentRevision) return false;
  cache.set(profileId, apply.result);
  return true;
};

/**
 * Apply an extraction failure: records nothing (status derives FAILED from
 * the caller's diagnostic, never from the cache). Always returns false so
 * call sites read uniformly with the success path.
 */
export const applyProfileExtractionFailure = (
  _cache: CadProfileCache,
  _profileId: string,
  _revision: string,
): boolean => false;
