import type { CadSurfaceSectionResult } from './cadSectionTypes';

/**
 * Phase 18K derived section cache.
 *
 * Scoped service (one per document/session). Keyed
 * `scopeId::lineId@surfaceId@revision` and stores one
 * CadSurfaceSectionResult per sample-line x source. Never React state,
 * never history, never persisted.
 *
 * Bounded: current + <=1 stale previous result per line x source, evicted by
 * an EXPLICIT insertion-order keeper list (never lexicographic key sort).
 * Stale results are rejected on apply (revision must still match the line's
 * current content revision, re-derived by the caller).
 */

export interface CadSectionCache {
  get: (
    _lineId: string,
    _surfaceId: string,
    _revision: string,
  ) => CadSurfaceSectionResult | undefined;
  set: (_lineId: string, _surfaceId: string, _result: CadSurfaceSectionResult) => void;
  /** Drop every cached revision for one sample line (all sources). */
  invalidateLine: (_lineId: string) => void;
  /** Drop every cached revision sourced from one surface (remove-source only). */
  invalidateSource: (_surfaceId: string) => void;
  clear: () => void;
  retained: (_lineId: string, _surfaceId: string) => CadSurfaceSectionResult[];
}

const pairKey = (lineId: string, surfaceId: string): string => `${lineId}\u0000${surfaceId}`;

export const createCadSectionCache = (scopeId: string): CadSectionCache => {
  const store = new Map<string, CadSurfaceSectionResult>();
  /** lineId\0surfaceId -> revision insertion order (oldest first). */
  const keepers = new Map<string, string[]>();
  const keyOf = (lineId: string, surfaceId: string, revision: string): string =>
    `${scopeId}::${lineId}@${surfaceId}@${revision}`;

  return {
    get: (lineId, surfaceId, revision) => store.get(keyOf(lineId, surfaceId, revision)),
    set: (lineId, surfaceId, result) => {
      store.set(keyOf(lineId, surfaceId, result.revision), result);
      const pair = pairKey(lineId, surfaceId);
      const list = (keepers.get(pair) ?? []).filter((entry) => entry !== result.revision);
      list.push(result.revision);
      while (list.length > 2) {
        const evicted = list.shift();
        if (evicted != null) store.delete(keyOf(lineId, surfaceId, evicted));
      }
      keepers.set(pair, list);
    },
    invalidateLine: (lineId) => {
      const prefix = `${scopeId}::${lineId}@`;
      for (const key of [...store.keys()]) {
        if (key.startsWith(prefix)) store.delete(key);
      }
      for (const pair of [...keepers.keys()]) {
        if (pair.startsWith(`${lineId}\u0000`)) keepers.delete(pair);
      }
    },
    invalidateSource: (surfaceId) => {
      const needle = `@${surfaceId}@`;
      for (const key of [...store.keys()]) {
        if (key.includes(needle)) store.delete(key);
      }
      for (const pair of [...keepers.keys()]) {
        if (pair.endsWith(`\u0000${surfaceId}`)) keepers.delete(pair);
      }
    },
    clear: () => {
      store.clear();
      keepers.clear();
    },
    retained: (lineId, surfaceId) =>
      (keepers.get(pairKey(lineId, surfaceId)) ?? [])
        .map((revision) => store.get(keyOf(lineId, surfaceId, revision)))
        .filter((result): result is CadSurfaceSectionResult => result != null),
  };
};

export interface SectionCacheApply {
  /** Current content revision of the line x source (re-derived by the caller). */
  currentRevision: string;
  result: CadSurfaceSectionResult;
}

/**
 * Apply an extraction success. Stale results (revision != current content
 * revision) are discarded: cache untouched, false returned.
 */
export const applySectionExtractionSuccess = (
  cache: CadSectionCache,
  lineId: string,
  surfaceId: string,
  apply: SectionCacheApply,
): boolean => {
  if (apply.result.revision !== apply.currentRevision) return false;
  cache.set(lineId, surfaceId, apply.result);
  return true;
};

/** Apply an extraction failure: records nothing (status derives FAILED from
 * the caller's diagnostic). Always returns false for a uniform call shape. */
export const applySectionExtractionFailure = (): boolean => false;
