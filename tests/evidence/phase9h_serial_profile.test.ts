/**
 * Phase 9H serial profile (EVIDENCE ONLY, manual).
 *
 * Repeated warm-up + measured serial-session campaign on the exact camp
 * fixture proving the lazy-template refactor: actual solveEngine calls,
 * counted solves, inferred template-source solves, stage splits,
 * aggregated solveTimingProfile fields, and pure planning-function timings.
 * Timings are recorded only, never gated. No production changes.
 */
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { describe, expect, it, vi } from 'vitest';

import { buildPreanalysisPlanningDiagnostics } from '../../src/engine/preanalysisPlanning';
import {
  buildPreanalysisSyntheticSetTemplates,
  buildSyntheticPreanalysisInput,
} from '../../src/engine/preanalysisPlanning';
import { resolveAppliedPreanalysisActionState } from '../../src/engine/preanalysisPlanning';
import { buildPathPrioritySummary } from '../../src/engine/preanalysisPathPriority';
import {
  buildRecommendationEvaluation,
  resolveCandidateTemplates,
  sortRecommendationEvaluations,
} from '../../src/engine/preanalysisPlanningRecommendations';
import { buildThresholdPlan } from '../../src/engine/preanalysisPlanningThresholdPlan';
import { createPreanalysisSolveAuditCollector } from '../../src/engine/preanalysisPlanningSolveAudit';
import { runAdjustmentSession } from '../../src/engine/runSession';
import * as solveEngineModule from '../../src/engine/solveEngine';
import type { AdjustmentResult } from '../../src/types';
import { createRunSessionRequest } from '../helpers/runSessionRequest';

const CAMP_INPUT = fs.readFileSync(
  path.join(process.cwd(), 'tests/fixtures/camp_design_preanalysis_traverse_only.dat'),
  'utf-8',
);

const median = (values: number[]): number => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};
const min = (values: number[]): number => Math.min(...values);
const max = (values: number[]): number => Math.max(...values);
const sum = (values: number[]): number => values.reduce((total, value) => total + value, 0);

const timeMs = <T>(fn: () => T): { elapsedMs: number; value: T } => {
  const startedAt = performance.now();
  const value = fn();
  return { elapsedMs: performance.now() - startedAt, value };
};

describe('phase 9H serial profile (camp fixture, evidence-only)', () => {
  it('profiles warm-up + measured serial sessions without gating', () => {
    const baseRequest = createRunSessionRequest({
      input: CAMP_INPUT,
      parseSettings: {
        ...createRunSessionRequest().parseSettings,
        runMode: 'preanalysis',
        preanalysisMode: true,
        coordMode: '2D',
      },
    });

    const runs: Array<{
      wallMs: number;
      actualSolveCalls: number;
      countedSolves: number;
      stages: Array<{ id: string; durationMs: number; solveCount: number }>;
      solveTimingProfile: AdjustmentResult['solveTimingProfile'];
      thresholdSteps: number;
      recommendationRows: number;
      candidateTemplateCount: number;
    }> = [];
    for (let index = 0; index < 4; index += 1) {
      const spy = vi.spyOn(solveEngineModule, 'solveEngine');
      const startedAt = performance.now();
      let outcome: ReturnType<typeof runAdjustmentSession>;
      let actualSolveCalls = 0;
      try {
        outcome = runAdjustmentSession(baseRequest);
        actualSolveCalls = spy.mock.calls.length;
      } finally {
        spy.mockRestore();
      }
      const wallMs = performance.now() - startedAt;
      runs.push({
        wallMs,
        actualSolveCalls,
        countedSolves: outcome.profile.solveInvocationCount,
        stages: outcome.profile.stages.map((stage) => ({ ...stage })),
        solveTimingProfile: outcome.result.solveTimingProfile,
        thresholdSteps:
          outcome.result.preanalysisImpactDiagnostics?.thresholdPlan.steps.length ?? 0,
        recommendationRows: outcome.result.preanalysisImpactDiagnostics?.rows.length ?? 0,
        candidateTemplateCount:
          outcome.result.preanalysisImpactDiagnostics?.candidateTemplateCount ?? 0,
      });
    }
    expect(runs).toHaveLength(4);

    const measured = runs.slice(1);
    const stageValues = (stageId: string): number[] =>
      measured.map(
        (run) => run.stages.find((stage) => stage.id === stageId)?.durationMs ?? 0,
      );
    const stageSolveCount = (stageId: string): number[] =>
      measured.map(
        (run) => run.stages.find((stage) => stage.id === stageId)?.solveCount ?? 0,
      );
    const timingField = (
      field: keyof NonNullable<AdjustmentResult['solveTimingProfile']>,
    ): number[] => measured.map((run) => run.solveTimingProfile?.[field] ?? 0);

    // Recommendation/threshold solve split via one audit-collector rebuild on
    // the last measured base (structural count, independent of solve plumbing).
    const auditBase = runAdjustmentSession(baseRequest).result;
    const auditTemplates = buildPreanalysisSyntheticSetTemplates(
      CAMP_INPUT,
      auditBase,
      baseRequest.planningMap,
      [],
    );
    const audit = createPreanalysisSolveAuditCollector();
    const auditSolveScenario = (nextIds: string[]): AdjustmentResult => {
      const normalized = resolveAppliedPreanalysisActionState(auditTemplates, nextIds)
        .normalizedScenarioIds;
      const solveInput = buildSyntheticPreanalysisInput(CAMP_INPUT, normalized, auditTemplates);
      return runAdjustmentSession(
        createRunSessionRequest({
          ...baseRequest,
          input: solveInput,
          parseSettings: {
            ...baseRequest.parseSettings,
            runMode: 'adjustment',
            preanalysisMode: false,
          },
        }),
      ).result;
    };
    buildPreanalysisPlanningDiagnostics({
      base: auditBase,
      input: CAMP_INPUT,
      planningMap: baseRequest.planningMap,
      activeTemplateIds: [],
      targetThresholdMeters: baseRequest.parseSettings.preanalysisAccuracyThresholdMeters,
      maxAddedSets: baseRequest.parseSettings.preanalysisMaxAddedSets,
      solveScenario: auditSolveScenario,
      solveAudit: audit,
      scenarioCacheEnabled: false,
    });
    const auditSummary = audit.summary();

    // Pure planning-function timings on the last measured base (no solves).
    const pureTemplates = timeMs(() =>
      buildPreanalysisSyntheticSetTemplates(
        CAMP_INPUT,
        auditBase,
        baseRequest.planningMap,
        [],
      ),
    );
    const pureCandidates = timeMs(() =>
      resolveCandidateTemplates(pureTemplates.value, auditBase, []),
    );
    const purePathSummary = timeMs(() => buildPathPrioritySummary(auditBase));
    const pureEvaluations = timeMs(() =>
      pureCandidates.value.map((template) =>
        buildRecommendationEvaluation(
          template,
          auditBase,
          auditBase,
          purePathSummary.value,
          baseRequest.parseSettings.preanalysisAccuracyThresholdMeters,
        ),
      ),
    );
    const pureSort = timeMs(() =>
      [...pureEvaluations.value].sort(sortRecommendationEvaluations),
    );
    const purePreviews = timeMs(() =>
      pureTemplates.value.map((template) => ({
        id: template.id,
        previewPoints: template.previewPoints.map((point) => ({ ...point, active: false })),
        previewSegments: template.previewSegments.map((segment) => ({
          ...segment,
          active: false,
        })),
      })),
    );
    const pureThresholdPlan = timeMs(() =>
      buildThresholdPlan(
        pureTemplates.value,
        auditBase,
        [],
        baseRequest.parseSettings.preanalysisAccuracyThresholdMeters,
        baseRequest.parseSettings.preanalysisMaxAddedSets,
        () => auditBase,
      ),
    );

    console.log(
      `[phase9h-profile] ${JSON.stringify({
        warmupRuns: 1,
        measuredRuns: 3,
        wallMs: {
          min: min(measured.map((run) => run.wallMs)),
          median: median(measured.map((run) => run.wallMs)),
          max: max(measured.map((run) => run.wallMs)),
        },
        stageMsMedian: {
          mainSolve: median(stageValues('main-solve')),
          preanalysisImpact: median(stageValues('preanalysis-impact')),
        },
        actualSolveCalls: measured.map((run) => run.actualSolveCalls),
        countedSolves: measured.map((run) => run.countedSolves),
        inferredTemplateSourceSolves: measured.map(
          (run) => run.actualSolveCalls - run.countedSolves,
        ),
        mainSolveCounts: stageSolveCount('main-solve'),
        preanalysisImpactCounts: stageSolveCount('preanalysis-impact'),
        recommendationCalls: auditSummary.recommendation.calls,
        thresholdCalls: auditSummary.threshold.calls,
        thresholdSteps: measured.map((run) => run.thresholdSteps),
        recommendationRows: measured.map((run) => run.recommendationRows),
        candidateTemplateCounts: measured.map((run) => run.candidateTemplateCount),
        solveTimingProfileMs: {
          total: {
            sum: sum(timingField('totalMs')),
            median: median(timingField('totalMs')),
          },
          parseAndSetup: {
            sum: sum(timingField('parseAndSetupMs')),
            median: median(timingField('parseAndSetupMs')),
          },
          equationAssembly: {
            sum: sum(timingField('equationAssemblyMs')),
            median: median(timingField('equationAssemblyMs')),
          },
          matrixFactorization: {
            sum: sum(timingField('matrixFactorizationMs')),
            median: median(timingField('matrixFactorizationMs')),
          },
          precisionAndDiagnostics: {
            sum: sum(timingField('precisionAndDiagnosticsMs')),
            median: median(timingField('precisionAndDiagnosticsMs')),
          },
          resultPackaging: {
            sum: sum(timingField('resultPackagingMs')),
            median: median(timingField('resultPackagingMs')),
          },
        },
        purePlanningMs: {
          templateConstruction: pureTemplates.elapsedMs,
          resolveCandidateTemplates: pureCandidates.elapsedMs,
          buildPathPrioritySummary: purePathSummary.elapsedMs,
          buildRecommendationEvaluationTotal: pureEvaluations.elapsedMs,
          sorting: pureSort.elapsedMs,
          previewConstruction: purePreviews.elapsedMs,
          buildThresholdPlan: pureThresholdPlan.elapsedMs,
        },
      })}`,
    );
  }, 300000);
});
