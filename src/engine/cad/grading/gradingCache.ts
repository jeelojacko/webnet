import type { CadGradingResult } from './gradingTypes';

/**
 * Phase 20B derived grading-result cache.
 *
 * Scoped service (one per document/session — never a global mutable
 * singleton). Keyed `scopeId::gradingId@grev`; stores CadGradingResult
 * only, never in React state, never in history, never persisted.
 *
 * Bounded: current + ≤1 stale previous result per grading, evicted by
 * EXPLICIT insertion-order keeper list (oldest set first) — same
 * convention as the 18I volume cache. Invalidate on grading delete,
 * definition change, or drawing switch.
 */

export interface CadGradingCache {
  get: (_gradingId: string, _revision: string) => CadGradingResult | undefined;
  set: (_gradingId: string, _result: CadGradingResult) => void;
  invalidate: (_gradingId: string) => void;
  clear: () => void;
  /** All retained results for a grading (oldest first, current last). */
  retained: (_gradingId: string) => CadGradingResult[];
}

export const createCadGradingCache = (scopeId: string): CadGradingCache => {
  const store = new Map<string, CadGradingResult>();
  /** gradingId -> revision insertion order (oldest first); the keeper list. */
  const keepers = new Map<string, string[]>();
  const keyOf = (gradingId: string, revision: string): string =>
    `${scopeId}::${gradingId}@${revision}`;
  const prefixOf = (gradingId: string): string => `${scopeId}::${gradingId}@`;

  return {
    get: (gradingId, revision) => store.get(keyOf(gradingId, revision)),
    set: (gradingId, result) => {
      store.set(keyOf(gradingId, result.revision), result);
      const list = (keepers.get(gradingId) ?? []).filter((entry) => entry !== result.revision);
      list.push(result.revision);
      // Explicit keeper eviction: drop the oldest stale until ≤2 remain.
      while (list.length > 2) {
        const oldest = list.shift();
        if (oldest !== undefined) store.delete(keyOf(gradingId, oldest));
      }
      keepers.set(gradingId, list);
    },
    invalidate: (gradingId) => {
      const prefix = prefixOf(gradingId);
      for (const key of [...store.keys()]) {
        if (key.startsWith(prefix)) store.delete(key);
      }
      keepers.delete(gradingId);
    },
    clear: () => {
      store.clear();
      keepers.clear();
    },
    retained: (gradingId) => {
      const list = keepers.get(gradingId) ?? [];
      const out: CadGradingResult[] = [];
      for (const revision of list) {
        const result = store.get(keyOf(gradingId, revision));
        if (result) out.push(result);
      }
      return out;
    },
  };
};
