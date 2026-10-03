/**
 * Phase 9K planning solve instrumentation (EVIDENCE ONLY, manual).
 *
 * Session-level solve census plus cached-vs-uncached equivalence for the
 * run-local scenario memo inside buildPreanalysisPlanningDiagnostics.
 * Timings are recorded only, never gated. No production changes.
 */
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { describe, expect, it, vi } from 'vitest';

import {
  buildPreanalysisPlanningDiagnostics,
  buildPreanalysisSyntheticSetTemplates,
  buildSyntheticPreanalysisInput,
  resolveAppliedPreanalysisActionState,
} from '../../src/engine/preanalysisPlanning';
import {
  createPreanalysisScenarioCacheDiagnostics,
  createPreanalysisSolveAuditCollector,
} from '../../src/engine/preanalysisPlanningSolveAudit';
import { runAdjustmentSession } from '../../src/engine/runSession';
import * as solveEngineModule from '../../src/engine/solveEngine';
import type { AdjustmentResult } from '../../src/types';
import { createRunSessionRequest } from '../helpers/runSessionRequest';

const CAMP_INPUT = fs.readFileSync(
  path.join(process.cwd(), 'tests/fixtures/camp_design_preanalysis_traverse_only.dat'),
  'utf-8',
);

const baseRequest = () =>
  createRunSessionRequest({
    input: CAMP_INPUT,
    parseSettings: {
      ...createRunSessionRequest().parseSettings,
      runMode: 'preanalysis',
      preanalysisMode: true,
      coordMode: '2D',
    },
  });

describe('phase 9K planning solve instrumentation (camp fixture, evidence-only)', () => {
  it('censuses session solves and proves cached/uncached diagnostics equivalence', () => {
    const request = baseRequest();

    // 1. Session-level census: actual solveEngine calls vs counted invocations.
    const spy = vi.spyOn(solveEngineModule, 'solveEngine');
    const sessionStartedAt = performance.now();
    const progressEvents: Array<{ stageId: string; solveIndex: number }> = [];
    const outcome = runAdjustmentSession(request, (event) => {
      progressEvents.push({ stageId: event.stageId, solveIndex: event.solveIndex });
    });
    const sessionWallMs = performance.now() - sessionStartedAt;
    const actualSolveCalls = spy.mock.calls.length;
    spy.mockRestore();
    const countedSolves = outcome.profile.solveInvocationCount;
    const result = outcome.result;
    const diagnostics = result.preanalysisImpactDiagnostics;
    expect(diagnostics?.enabled).toBe(true);

    // 2. Structural rebuild on the session base: audit + cache diagnostics,
    // production (cached) path first.
    const audit = createPreanalysisSolveAuditCollector();
    const cacheDiagnostics = createPreanalysisScenarioCacheDiagnostics();
    const templates = buildPreanalysisSyntheticSetTemplates(
      CAMP_INPUT,
      result,
      request.planningMap,
      [],
    );
    const makeCountingScenario = (counter: { count: number }) => (nextIds: string[]): AdjustmentResult => {
      counter.count += 1;
      const normalized = resolveAppliedPreanalysisActionState(templates, nextIds)
        .normalizedScenarioIds;
      const solveInput = buildSyntheticPreanalysisInput(CAMP_INPUT, normalized, templates);
      return runAdjustmentSession(
        createRunSessionRequest({
          ...request,
          input: solveInput,
          parseSettings: {
            ...request.parseSettings,
            runMode: 'adjustment',
            preanalysisMode: false,
          },
        }),
      ).result;
    };
    const cachedCounter = { count: 0 };
    const auditSolveScenario = makeCountingScenario(cachedCounter);
    const cachedStartedAt = performance.now();
    const cachedDiagnostics = buildPreanalysisPlanningDiagnostics({
      base: result,
      input: CAMP_INPUT,
      planningMap: request.planningMap,
      activeTemplateIds: [],
      targetThresholdMeters: request.parseSettings.preanalysisAccuracyThresholdMeters,
      maxAddedSets: request.parseSettings.preanalysisMaxAddedSets,
      solveScenario: auditSolveScenario,
      solveAudit: audit,
      scenarioCacheDiagnostics: cacheDiagnostics,
    });
    const cachedWallMs = performance.now() - cachedStartedAt;
    const auditSummary = audit.summary();

    // 3. Oracle rebuild with the memo disabled: outputs must be deep-equal.
    const uncachedCounter = { count: 0 };
    const uncachedStartedAt = performance.now();
    const uncachedDiagnostics = buildPreanalysisPlanningDiagnostics({
      base: result,
      input: CAMP_INPUT,
      planningMap: request.planningMap,
      activeTemplateIds: [],
      targetThresholdMeters: request.parseSettings.preanalysisAccuracyThresholdMeters,
      maxAddedSets: request.parseSettings.preanalysisMaxAddedSets,
      solveScenario: makeCountingScenario(uncachedCounter),
      scenarioCacheEnabled: false,
    });
    const uncachedWallMs = performance.now() - uncachedStartedAt;
    // Memo equivalence: identical diagnostics with or without the cache.
    expect(JSON.parse(JSON.stringify(cachedDiagnostics))).toEqual(
      JSON.parse(JSON.stringify(uncachedDiagnostics)),
    );
    // Run-to-run determinism: identical inputs reproduce the final result.
    const rerun = runAdjustmentSession(request);
    expect(JSON.parse(JSON.stringify(rerun.result.preanalysisImpactDiagnostics))).toEqual(
      JSON.parse(JSON.stringify(diagnostics)),
    );

    // 4. Tight-threshold rebuild forces the greedy loop (the indeterminate
    // count path): exercises threshold duplicates and memo value.
    const tightAudit = createPreanalysisSolveAuditCollector();
    const tightCache = createPreanalysisScenarioCacheDiagnostics();
    const tightCounter = { count: 0 };
    const tightDiagnostics = buildPreanalysisPlanningDiagnostics({
      base: result,
      input: CAMP_INPUT,
      planningMap: request.planningMap,
      activeTemplateIds: [],
      targetThresholdMeters: 1e-9,
      maxAddedSets: request.parseSettings.preanalysisMaxAddedSets,
      solveScenario: makeCountingScenario(tightCounter),
      solveAudit: tightAudit,
      scenarioCacheDiagnostics: tightCache,
    });
    const tightUncachedCounter = { count: 0 };
    const tightUncached = buildPreanalysisPlanningDiagnostics({
      base: result,
      input: CAMP_INPUT,
      planningMap: request.planningMap,
      activeTemplateIds: [],
      targetThresholdMeters: 1e-9,
      maxAddedSets: request.parseSettings.preanalysisMaxAddedSets,
      solveScenario: makeCountingScenario(tightUncachedCounter),
      scenarioCacheEnabled: false,
    });
    expect(JSON.parse(JSON.stringify(tightDiagnostics))).toEqual(
      JSON.parse(JSON.stringify(tightUncached)),
    );
    const tightSummary = tightAudit.summary();

    console.log(
      `[phase9k-planning] ${JSON.stringify({
        session: {
          wallMs: sessionWallMs,
          actualSolveEngineCalls: actualSolveCalls,
          countedSolveInvocations: countedSolves,
          stages: outcome.profile.stages.map((stage) => ({
            id: stage.id,
            solveCount: stage.solveCount,
            durationMs: stage.durationMs,
          })),
          planningProgressEvents: progressEvents.filter(
            (event) => event.stageId === 'preanalysis-impact',
          ).length,
          thresholdSteps: diagnostics?.thresholdPlan.steps.length ?? 0,
          recommendationRows: diagnostics?.rows.length ?? 0,
          candidateTemplateCount: diagnostics?.candidateTemplateCount ?? 0,
        },
        structural: {
          recommendationCalls: auditSummary.recommendation.calls,
          thresholdCalls: auditSummary.threshold.calls,
          uniqueNormalizedKeys: auditSummary.uniqueNormalizedKeys,
          normalizedDuplicateCalls: auditSummary.normalizedDuplicateCalls,
          thresholdDuplicates: auditSummary.threshold.normalizedDuplicateCalls,
          recommendationDuplicates: auditSummary.recommendation.normalizedDuplicateCalls,
        },
        memo: {
          requests: cacheDiagnostics.requests,
          cacheHits: cacheDiagnostics.cacheHits,
          peakEntries: cacheDiagnostics.peakEntries,
          cachedSolveCalls: cachedCounter.count,
          uncachedSolveCalls: uncachedCounter.count,
          avoidedRecomputes: uncachedCounter.count - cachedCounter.count,
          cachedWallMs,
          uncachedWallMs,
          perSolveMs:
            audit.entries.length > 0
              ? audit.entries.reduce((total, entry) => total + entry.wallMs, 0) /
                audit.entries.length
              : 0,
        },
        tightThreshold: {
          thresholdSteps: tightDiagnostics.thresholdPlan.steps.length,
          recommendationCalls: tightSummary.recommendation.calls,
          thresholdCalls: tightSummary.threshold.calls,
          uniqueNormalizedKeys: tightSummary.uniqueNormalizedKeys,
          normalizedDuplicateCalls: tightSummary.normalizedDuplicateCalls,
          cacheRequests: tightCache.requests,
          cacheHits: tightCache.cacheHits,
          cachedSolveCalls: tightCounter.count,
          uncachedSolveCalls: tightUncachedCounter.count,
          avoidedRecomputes: tightUncachedCounter.count - tightCounter.count,
        },
      })}`,
    );
  }, 300000);
});
