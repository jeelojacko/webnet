/**
 * Phase 20C Wave-1B — derived grading-GROUP result cache.
 *
 * Session-only, scoped to one drawing/session (never a global mutable
 * singleton). Keyed `drawingId|groupId@ggrev`; stores CadGradingGroupResult
 * only, never React state, never history, never persisted.
 *
 * Bounded: current + <=1 stale previous result per group, evicted by an
 * EXPLICIT insertion-order keeper list (oldest first) — same convention as
 * the 20B grading cache. Invalidate on group delete, definition change, or
 * drawing switch. No worker imports: this module is pure storage.
 */
import type { CadGradingGroupResult } from './gradingGroupTypes';

export interface CadGradingGroupCache {
  get: (_groupId: string, _revision: string) => CadGradingGroupResult | undefined;
  set: (_groupId: string, _result: CadGradingGroupResult) => void;
  invalidate: (_groupId: string) => void;
  clear: () => void;
  /** All retained results for a group (oldest first, current last). */
  retained: (_groupId: string) => CadGradingGroupResult[];
}

export const createCadGradingGroupCache = (drawingId: string): CadGradingGroupCache => {
  const store = new Map<string, CadGradingGroupResult>();
  /** groupId -> revision insertion order (oldest first); the keeper list. */
  const keepers = new Map<string, string[]>();
  const keyOf = (groupId: string, revision: string): string =>
    `${drawingId}|${groupId}@${revision}`;
  const prefixOf = (groupId: string): string => `${drawingId}|${groupId}@`;

  return {
    get: (groupId, revision) => store.get(keyOf(groupId, revision)),
    set: (groupId, result) => {
      store.set(keyOf(groupId, result.revision), result);
      const list = (keepers.get(groupId) ?? []).filter((entry) => entry !== result.revision);
      list.push(result.revision);
      // Explicit keeper eviction: drop the oldest stale until <=2 remain.
      while (list.length > 2) {
        const oldest = list.shift();
        if (oldest !== undefined) store.delete(keyOf(groupId, oldest));
      }
      keepers.set(groupId, list);
    },
    invalidate: (groupId) => {
      const prefix = prefixOf(groupId);
      for (const key of [...store.keys()]) {
        if (key.startsWith(prefix)) store.delete(key);
      }
      keepers.delete(groupId);
    },
    clear: () => {
      store.clear();
      keepers.clear();
    },
    retained: (groupId) => {
      const list = keepers.get(groupId) ?? [];
      const out: CadGradingGroupResult[] = [];
      for (const revision of list) {
        const result = store.get(keyOf(groupId, revision));
        if (result) out.push(result);
      }
      return out;
    },
  };
};
