/**
 * Phase 9D step 1: diagnostic-only solveScenario audit on the exact camp
 * fixture. No caching/optimization; asserts instrumentation integrity and
 * reports call/duplicate/stage counts plus template-source/main/total solves.
 * Also audits that planning consumers do not mutate AdjustmentResult inputs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';

import { buildPreanalysisPlanningDiagnostics } from '../../src/engine/preanalysisPlanning';
import {
  buildPreanalysisSyntheticSetTemplates,
  buildSyntheticPreanalysisInput,
} from '../../src/engine/preanalysisPlanning';
import { resolveAppliedPreanalysisActionState } from '../../src/engine/preanalysisPlanning';
import {
  createPreanalysisScenarioCacheDiagnostics,
  createPreanalysisSolveAuditCollector,
} from '../../src/engine/preanalysisPlanningSolveAudit';
import { DEFAULT_PLANNING_MAP_STATE } from '../../src/engine/planningMapState';
import { runAdjustmentSession } from '../../src/engine/runSession';
import { createRunSessionRequest } from '../helpers/runSessionRequest';
import type { AdjustmentResult } from '../../src/types';

const CAMP_INPUT = fs.readFileSync(
  path.join(process.cwd(), 'tests/fixtures/camp_design_preanalysis_traverse_only.dat'),
  'utf-8',
);

const snapshotResult = (result: AdjustmentResult): string =>
  JSON.stringify({
    stations: result.stations,
    observations: result.observations,
    stationCovariances: result.stationCovariances,
    relativeCovariances: result.relativeCovariances,
    weakGeometryDiagnostics: result.weakGeometryDiagnostics,
  });

describe('phase 9D step 1: preanalysis solve audit (camp fixture, diagnostic-only)', () => {
  it('audits planning scenario solves without changing behavior', () => {
    let templateSourceSolves = 1;
    let mainSolves = 1;
    let planningSolves = 0;

    const baseRequest = createRunSessionRequest({
      input: CAMP_INPUT,
      parseSettings: {
        ...createRunSessionRequest().parseSettings,
        runMode: 'preanalysis',
        preanalysisMode: true,
        coordMode: '2D',
      },
    });
    const base = runAdjustmentSession(baseRequest).result;
    const sessionTemplates = buildPreanalysisSyntheticSetTemplates(
      CAMP_INPUT,
      base,
      DEFAULT_PLANNING_MAP_STATE,
      [],
    );
    expect(sessionTemplates.length).toBeGreaterThan(0);
    const baseBefore = snapshotResult(base);

    const audit = createPreanalysisSolveAuditCollector();
    const solveScenario = (nextIds: string[]): AdjustmentResult => {
      planningSolves += 1;
      const normalized = resolveAppliedPreanalysisActionState(
        sessionTemplates,
        nextIds,
      ).normalizedScenarioIds;
      const solveInput = buildSyntheticPreanalysisInput(CAMP_INPUT, normalized, sessionTemplates);
      const scenarioRequest = createRunSessionRequest({
        ...baseRequest,
        input: solveInput,
        parseSettings: {
          ...baseRequest.parseSettings,
          runMode: 'adjustment',
          preanalysisMode: false,
        },
      });
      return runAdjustmentSession(scenarioRequest).result;
    };

    const diagnostics = buildPreanalysisPlanningDiagnostics({
      base,
      input: CAMP_INPUT,
      planningMap: DEFAULT_PLANNING_MAP_STATE,
      activeTemplateIds: [],
      targetThresholdMeters: baseRequest.parseSettings.preanalysisAccuracyThresholdMeters,
      maxAddedSets: 5,
      solveScenario,
      solveAudit: audit,
      scenarioCacheEnabled: false,
    });
    expect(diagnostics.enabled).toBe(true);

    // Planning consumers must not mutate the base AdjustmentResult.
    expect(snapshotResult(base)).toBe(baseBefore);

    const summary = audit.summary();
    const report = {
      templateSourceSolves,
      mainSolves,
      planningSolves,
      grandTotalSolves: templateSourceSolves + mainSolves + planningSolves,
      totalCalls: summary.totalCalls,
      uniqueRawKeys: summary.uniqueRawKeys,
      uniqueNormalizedKeys: summary.uniqueNormalizedKeys,
      rawDuplicateCalls: summary.rawDuplicateCalls,
      normalizedDuplicateCalls: summary.normalizedDuplicateCalls,
      recommendation: summary.recommendation,
      threshold: summary.threshold,
      candidateTemplateCount: diagnostics.candidateTemplateCount,
      thresholdSteps: diagnostics.thresholdPlan.steps.length,
      baseWorstStationMajor: diagnostics.baseWorstStationMajor,
      targetThresholdMeters: baseRequest.parseSettings.preanalysisAccuracyThresholdMeters,
    };
    console.log(`[phase9d-solve-audit] ${JSON.stringify(report)}`);

    // Instrumentation integrity: one audit entry per planning solve, keys sane.
    expect(summary.totalCalls).toBe(planningSolves);
    expect(summary.entries.length).toBe(planningSolves);
    summary.entries.forEach((entry) => {
      expect(entry.rawIds.length).toBeGreaterThan(0);
      expect(entry.normalizedIds.length).toBeGreaterThan(0);
      expect(entry.wallMs).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(entry.callIndex)).toBe(true);
      const recomputed = resolveAppliedPreanalysisActionState(
        sessionTemplates,
        entry.rawIds,
      ).normalizedScenarioIds;
      expect(entry.normalizedIds).toEqual(recomputed);
    });

    // Stage split integrity: recommendation + threshold covers every call.
    expect(summary.recommendation.calls + summary.threshold.calls).toBe(summary.totalCalls);
    expect(summary.recommendation.calls).toBeGreaterThan(0);

    // Duplicate-status self-consistency.
    const rawKeys = summary.entries.map((entry) => entry.rawKey);
    const normalizedKeys = summary.entries.map((entry) => entry.normalizedKey);
    expect(summary.uniqueRawKeys).toBe(new Set(rawKeys).size);
    expect(summary.uniqueNormalizedKeys).toBe(new Set(normalizedKeys).size);
    expect(summary.rawDuplicateCalls).toBe(rawKeys.length - new Set(rawKeys).size);
    expect(summary.normalizedDuplicateCalls).toBe(
      normalizedKeys.length - new Set(normalizedKeys).size,
    );

    const oracleDiagnostics = buildPreanalysisPlanningDiagnostics({
      base,
      input: CAMP_INPUT,
      planningMap: DEFAULT_PLANNING_MAP_STATE,
      activeTemplateIds: [],
      targetThresholdMeters: 0,
      maxAddedSets: 1,
      solveScenario,
      scenarioCacheEnabled: false,
    });
    const cacheDiagnostics = createPreanalysisScenarioCacheDiagnostics();
    const cachedPlanningCalls = { count: 0 };
    const cachedDiagnostics = buildPreanalysisPlanningDiagnostics({
      base,
      input: CAMP_INPUT,
      planningMap: DEFAULT_PLANNING_MAP_STATE,
      activeTemplateIds: [],
      targetThresholdMeters: 0,
      maxAddedSets: 1,
      solveScenario: (nextIds) => {
        cachedPlanningCalls.count += 1;
        return solveScenario(nextIds);
      },
      scenarioCacheDiagnostics: cacheDiagnostics,
    });
    expect(cachedDiagnostics).toEqual(oracleDiagnostics);
    expect(cachedDiagnostics.thresholdPlan.steps.length).toBeGreaterThan(0);
    expect(cacheDiagnostics.requests).toBeGreaterThan(cacheDiagnostics.cacheHits);
    expect(cacheDiagnostics.cacheHits).toBeGreaterThan(0);
    expect(cachedPlanningCalls.count).toBe(
      cacheDiagnostics.requests - cacheDiagnostics.cacheHits,
    );
    expect(cacheDiagnostics.peakEntries).toBeGreaterThan(0);

    const failingCache = createPreanalysisScenarioCacheDiagnostics();
    const failingDiagnostics = buildPreanalysisPlanningDiagnostics({
      base,
      input: CAMP_INPUT,
      planningMap: DEFAULT_PLANNING_MAP_STATE,
      activeTemplateIds: [],
      targetThresholdMeters: 0,
      maxAddedSets: 1,
      solveScenario: () => {
        throw new Error('synthetic scenario failure');
      },
      scenarioCacheDiagnostics: failingCache,
    });
    expect(failingDiagnostics.rows.every((row) => row.status === 'failed')).toBe(true);
    expect(failingCache.cacheHits).toBe(0);
    expect(failingCache.requests).toBe(failingCache.normalizedKeys.length * 2);

    const timings: Array<{ wallMs: number; profile: NonNullable<ReturnType<typeof runAdjustmentSession>['profile']> }> = [];
    for (let index = 0; index < 4; index += 1) {
      const startedAt = performance.now();
      const outcome = runAdjustmentSession(baseRequest);
      timings.push({ wallMs: performance.now() - startedAt, profile: outcome.profile });
    }
    const measured = timings.slice(1);
    const median = (values: number[]): number => {
      const sorted = [...values].sort((left, right) => left - right);
      return sorted[Math.floor(sorted.length / 2)] ?? 0;
    };
    const stageMedian = (stageId: string): number =>
      median(measured.map(({ profile }) => profile.stages.find((stage) => stage.id === stageId)?.durationMs ?? 0));
    console.log(`[phase9d-timing] ${JSON.stringify({
      warmupRuns: 1,
      measuredRuns: 3,
      totalSessionMedianMs: median(measured.map(({ wallMs }) => wallMs)),
      templateSourceMedianMs: stageMedian('preanalysis-template-source'),
      mainMedianMs: stageMedian('main-solve'),
      recommendationAndThresholdMedianMs: stageMedian('preanalysis-impact'),
      solveInvocationCounts: measured.map(({ profile }) => profile.solveInvocationCount),
      cacheScenarioRequests: cacheDiagnostics.requests,
      cacheUnderlyingSolves: cachedPlanningCalls.count,
      cacheHits: cacheDiagnostics.cacheHits,
      cachePeakEntries: cacheDiagnostics.peakEntries,
    })}`);
  }, 120000);
});
