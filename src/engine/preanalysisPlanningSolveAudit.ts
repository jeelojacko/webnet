/**
 * Phase 9D (step 1 only): diagnostic-only solveScenario audit instrumentation.
 *
 * Records per solveScenario call: raw IDs, canonical normalized scenario IDs
 * (via resolveAppliedPreanalysisActionState semantics), duplicate status,
 * stage (recommendation vs threshold), and wall time.
 *
 * Optional/test-only: when no collector is supplied, planning behavior is
 * unchanged. No caching, no optimization, no solveEngine/math/routing changes.
 */
import type { AdjustmentResult } from '../types';
import {
  resolveAppliedPreanalysisActionState,
  type PreanalysisSyntheticSetTemplate,
} from './preanalysisPlanningShared';

export type PreanalysisSolveAuditStage = 'recommendation' | 'threshold';

export interface PreanalysisSolveAuditEntry {
  callIndex: number;
  stage: PreanalysisSolveAuditStage;
  rawIds: string[];
  normalizedIds: string[];
  rawKey: string;
  normalizedKey: string;
  rawDuplicate: boolean;
  normalizedDuplicate: boolean;
  wallMs: number;
}

export interface PreanalysisSolveAuditStageSummary {
  calls: number;
  uniqueRawKeys: number;
  uniqueNormalizedKeys: number;
  normalizedDuplicateCalls: number;
}

export interface PreanalysisSolveAuditSummary {
  totalCalls: number;
  uniqueRawKeys: number;
  uniqueNormalizedKeys: number;
  rawDuplicateCalls: number;
  normalizedDuplicateCalls: number;
  recommendation: PreanalysisSolveAuditStageSummary;
  threshold: PreanalysisSolveAuditStageSummary;
  entries: PreanalysisSolveAuditEntry[];
}

export interface PreanalysisSolveAuditCollector {
  readonly entries: PreanalysisSolveAuditEntry[];
  record: (
    _stage: PreanalysisSolveAuditStage,
    _rawIds: string[],
    _normalizedIds: string[],
    _wallMs: number,
  ) => void;
  summary: () => PreanalysisSolveAuditSummary;
}

export interface PreanalysisScenarioCacheDiagnostics {
  requests: number;
  cacheHits: number;
  peakEntries: number;
  normalizedKeys: string[];
  recordRequest: (_normalizedIds: string[], _cacheHit: boolean, _entryCount: number) => void;
}

const keyOf = (ids: string[]): string => [...ids].join('\u0001');

export const createPreanalysisScenarioCacheDiagnostics = (): PreanalysisScenarioCacheDiagnostics => {
  const normalizedKeys = new Set<string>();
  const diagnostics: PreanalysisScenarioCacheDiagnostics = {
    requests: 0,
    cacheHits: 0,
    peakEntries: 0,
    normalizedKeys: [],
    recordRequest: (ids, cacheHit, entryCount) => {
      normalizedKeys.add(keyOf(ids));
      diagnostics.requests += 1;
      if (cacheHit) diagnostics.cacheHits += 1;
      diagnostics.peakEntries = Math.max(diagnostics.peakEntries, entryCount);
      diagnostics.normalizedKeys = [...normalizedKeys];
    },
  };
  return diagnostics;
};

const summarizeStage = (
  entries: PreanalysisSolveAuditEntry[],
  stage: PreanalysisSolveAuditStage,
): PreanalysisSolveAuditStageSummary => {
  const scoped = entries.filter((entry) => entry.stage === stage);
  return {
    calls: scoped.length,
    uniqueRawKeys: new Set(scoped.map((entry) => entry.rawKey)).size,
    uniqueNormalizedKeys: new Set(scoped.map((entry) => entry.normalizedKey)).size,
    normalizedDuplicateCalls: scoped.filter((entry) => entry.normalizedDuplicate).length,
  };
};

export const createPreanalysisSolveAuditCollector = (): PreanalysisSolveAuditCollector => {
  const entries: PreanalysisSolveAuditEntry[] = [];
  const seenRawKeys = new Set<string>();
  const seenNormalizedKeys = new Set<string>();
  return {
    entries,
    record: (stage, rawIds, normalizedIds, wallMs) => {
      const rawKey = keyOf(rawIds);
      const normalizedKey = keyOf(normalizedIds);
      const rawDuplicate = seenRawKeys.has(rawKey);
      const normalizedDuplicate = seenNormalizedKeys.has(normalizedKey);
      seenRawKeys.add(rawKey);
      seenNormalizedKeys.add(normalizedKey);
      entries.push({
        callIndex: entries.length + 1,
        stage,
        rawIds: [...rawIds],
        normalizedIds: [...normalizedIds],
        rawKey,
        normalizedKey,
        rawDuplicate,
        normalizedDuplicate,
        wallMs,
      });
    },
    summary: () => ({
      totalCalls: entries.length,
      uniqueRawKeys: new Set(entries.map((entry) => entry.rawKey)).size,
      uniqueNormalizedKeys: new Set(entries.map((entry) => entry.normalizedKey)).size,
      rawDuplicateCalls: entries.filter((entry) => entry.rawDuplicate).length,
      normalizedDuplicateCalls: entries.filter((entry) => entry.normalizedDuplicate).length,
      recommendation: summarizeStage(entries, 'recommendation'),
      threshold: summarizeStage(entries, 'threshold'),
      entries: entries.map((entry) => ({ ...entry })),
    }),
  };
};

/**
 * Wraps a solveScenario callback with audit recording. The wrapped function
 * delegates exactly (including throwing), adding only timing + canonical
 * normalization bookkeeping around the call.
 */
export const wrapPreanalysisSolveScenario = (
  stage: PreanalysisSolveAuditStage,
  solveScenario: (_activeTemplateIds: string[]) => AdjustmentResult,
  getTemplates: () => PreanalysisSyntheticSetTemplate[],
  collector: PreanalysisSolveAuditCollector,
): ((_activeTemplateIds: string[]) => AdjustmentResult) => {
  if (typeof solveScenario !== 'function') return solveScenario;
  return (activeTemplateIds: string[]) => {
    const rawIds = [...activeTemplateIds];
    const normalizedIds = resolveAppliedPreanalysisActionState(
      getTemplates(),
      rawIds,
    ).normalizedScenarioIds;
    const startedAt = Date.now();
    try {
      return solveScenario(rawIds);
    } finally {
      collector.record(stage, rawIds, [...normalizedIds], Date.now() - startedAt);
    }
  };
};
