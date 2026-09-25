import type { CadAnalysisMetric } from './cadAnalysisTypes';
import type { ElevationAnalysisResult } from './surfaceAnalysis/elevationBands';
import type { SlopeAnalysisResult } from './surfaceAnalysis/slopeBands';
import type { DepthBandResult } from './surfaceAnalysis/depthBands';

/**
 * Phase 18U derived analysis-result cache.
 *
 * Scoped service (one per document/session — never a global singleton).
 * Keyed `scopeId::analysisId@geometryRevision`; stores session-only
 * analysis results (band quantities + display regions), never in React
 * state, never in history, never persisted.
 *
 * Bounded: current + ≤1 stale previous result per analysis, evicted by an
 * EXPLICIT insertion-order keeper list (oldest set first) — never by
 * lexicographic key sort. Stale entries exist only so the manager can show
 * retained quantities with a STALE label; renderers must only use the
 * CURRENT revision (see cadAnalysisView).
 */

export type CachedAnalysisEngineResult =
  | { kind: 'elevation'; result: ElevationAnalysisResult }
  | { kind: 'slope'; result: SlopeAnalysisResult }
  | { kind: 'depth'; result: DepthBandResult };

export interface CachedAnalysisResult {
  analysisId: string;
  /** `arev1:` geometry revision the result was computed for. */
  revision: string;
  metric: CadAnalysisMetric;
  /** True when the run measured a zero-measure domain (derives NO_DATA). */
  empty: boolean;
  result: CachedAnalysisEngineResult;
}

/** Zero-measure domain per metric (the 18I NO_OVERLAP analogue). */
export const isAnalysisEngineResultEmpty = (result: CachedAnalysisEngineResult): boolean => {
  if (result.kind === 'elevation') return !(result.result.totals.surfacePlanArea > 0);
  if (result.kind === 'slope') return !(result.result.totals.surfacePlanArea > 0);
  return !(result.result.totals.overlapArea > 0);
};

export interface SurfaceAnalysisCache {
  get: (_analysisId: string, _revision: string) => CachedAnalysisResult | undefined;
  set: (_result: CachedAnalysisResult) => void;
  invalidate: (_analysisId: string) => void;
  clear: () => void;
  /** All retained results for an analysis (oldest first, current last). */
  retained: (_analysisId: string) => CachedAnalysisResult[];
}

export const createSurfaceAnalysisCache = (scopeId: string): SurfaceAnalysisCache => {
  const store = new Map<string, CachedAnalysisResult>();
  /** analysisId -> revision insertion order (oldest first); the keeper list. */
  const keepers = new Map<string, string[]>();
  const keyOf = (analysisId: string, revision: string): string =>
    `${scopeId}::${analysisId}@${revision}`;
  const prefixOf = (analysisId: string): string => `${scopeId}::${analysisId}@`;

  return {
    get: (analysisId, revision) => store.get(keyOf(analysisId, revision)),
    set: (result) => {
      store.set(keyOf(result.analysisId, result.revision), result);
      const list = (keepers.get(result.analysisId) ?? []).filter(
        (entry) => entry !== result.revision,
      );
      list.push(result.revision);
      // Explicit keeper eviction: drop the oldest stale until ≤2 remain.
      while (list.length > 2) {
        const evicted = list.shift();
        if (evicted != null) store.delete(keyOf(result.analysisId, evicted));
      }
      keepers.set(result.analysisId, list);
    },
    invalidate: (analysisId) => {
      const prefix = prefixOf(analysisId);
      for (const key of [...store.keys()]) {
        if (key.startsWith(prefix)) store.delete(key);
      }
      keepers.delete(analysisId);
    },
    clear: () => {
      store.clear();
      keepers.clear();
    },
    retained: (analysisId) =>
      (keepers.get(analysisId) ?? [])
        .map((revision) => store.get(keyOf(analysisId, revision)))
        .filter((result): result is CachedAnalysisResult => result != null),
  };
};
