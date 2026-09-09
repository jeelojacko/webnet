import { buildPathPrioritySummary, type PathPrioritySummary } from './preanalysisPathPriority';
import type { AdjustmentResult } from '../types';
import {
  medianOf,
  relativeMetrics,
  stationMajors,
  weakPairCount,
  weakStationCount,
} from './preanalysisPlanningShared';

/**
 * Phase 9I: exact per-result planning scalars plus the (expensive) path
 * summary, built once and shared by scoring, evaluation, candidate
 * selection, and threshold planning instead of being recomputed per
 * candidate. Pure: values are snapshots, no mutation of the result.
 */
export type PreanalysisResultMetrics = {
  stationValues: number[];
  worstStationMajor: number | undefined;
  medianStationMajor: number | undefined;
  pairValues: number[];
  worstPairSigmaDist: number | undefined;
  weakStations: number;
  weakPairs: number;
  pathSummary: PathPrioritySummary;
};

const scalarsOf = (result: AdjustmentResult): Omit<PreanalysisResultMetrics, 'pathSummary'> => {
  const stationValues = stationMajors(result);
  const pairValues = relativeMetrics(result);
  return {
    stationValues,
    worstStationMajor: stationValues.length > 0 ? Math.max(...stationValues) : undefined,
    medianStationMajor: medianOf(stationValues),
    pairValues,
    worstPairSigmaDist: pairValues.length > 0 ? Math.max(...pairValues) : undefined,
    weakStations: weakStationCount(result),
    weakPairs: weakPairCount(result),
  };
};

export const buildPreanalysisResultMetrics = (
  result: AdjustmentResult,
): PreanalysisResultMetrics => ({
  ...scalarsOf(result),
  pathSummary: buildPathPrioritySummary(result),
});

/** Attach an already-built path summary without rebuilding it. */
export const attachPreanalysisPathSummary = (
  result: AdjustmentResult,
  pathSummary: PathPrioritySummary,
): PreanalysisResultMetrics => ({
  ...scalarsOf(result),
  pathSummary,
});

/**
 * Per-planning-invocation identity reuse: the same result object maps to
 * one metrics instance (including its path summary). Create one cache per
 * planning invocation and thread it through candidates/steps.
 */
export const createPreanalysisResultMetricsCache = (): ((
  _result: AdjustmentResult,
) => PreanalysisResultMetrics) => {
  const cache = new WeakMap<object, PreanalysisResultMetrics>();
  return (result: AdjustmentResult): PreanalysisResultMetrics => {
    const cached = cache.get(result);
    if (cached) return cached;
    const built = buildPreanalysisResultMetrics(result);
    cache.set(result, built);
    return built;
  };
};

export type PreanalysisResultMetricsResolver = ReturnType<
  typeof createPreanalysisResultMetricsCache
>;
