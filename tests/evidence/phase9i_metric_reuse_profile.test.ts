/**
 * Phase 9I metric/path-summary reuse profile (EVIDENCE ONLY, manual).
 *
 * Before/after comparison of path-summary construction during preanalysis
 * recommendation scoring on the exact camp fixture: the legacy calling
 * convention (one current-step summary per candidate plus one alt summary
 * each in evaluation and scoring) versus the reused
 * PreanalysisResultMetrics path (one base metrics build per planning
 * invocation, one metrics build per alt). Helper counts and wall times are
 * recorded only, never gated. Result equality is asserted exactly.
 */
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { describe, expect, it, vi } from 'vitest';

import type { AdjustmentResult } from '../../src/types';

vi.mock('../../src/engine/preanalysisPathPriority', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../src/engine/preanalysisPathPriority')>();
  return {
    ...actual,
    buildPathPrioritySummary: (result: AdjustmentResult) => {
      const counter = globalThis as { __phase9iSummaryBuilds?: number };
      counter.__phase9iSummaryBuilds = (counter.__phase9iSummaryBuilds ?? 0) + 1;
      return actual.buildPathPrioritySummary(result);
    },
  };
});

const {
  buildPreanalysisPlanningDiagnostics,
  buildPreanalysisSyntheticSetTemplates,
} = await import('../../src/engine/preanalysisPlanning');
const { resolveCandidateTemplates, buildRecommendationEvaluation, sortRecommendationEvaluations } = await import(
  '../../src/engine/preanalysisPlanningRecommendations'
);
const { createPreanalysisResultMetricsCache } = await import(
  '../../src/engine/preanalysisResultMetrics'
);
const { buildPathPrioritySummary } = await import(
  '../../src/engine/preanalysisPathPriority'
);
const { resolveAppliedPreanalysisActionState } = await import(
  '../../src/engine/preanalysisPlanningShared'
);
const { runAdjustmentSession } = await import('../../src/engine/runSession');
const { createRunSessionRequest } = await import('../helpers/runSessionRequest');

const CAMP_INPUT = fs.readFileSync(
  path.join(process.cwd(), 'tests/fixtures/camp_design_preanalysis_traverse_only.dat'),
  'utf-8',
);

const summaryBuilds = (): number =>
  (globalThis as { __phase9iSummaryBuilds?: number }).__phase9iSummaryBuilds ?? 0;
const resetSummaryBuilds = (): void => {
  (globalThis as { __phase9iSummaryBuilds?: number }).__phase9iSummaryBuilds = 0;
};

describe('phase 9I metric reuse profile (camp fixture, evidence-only)', () => {
  it('profiles legacy vs reused path-summary construction without gating', () => {
    const baseRequest = createRunSessionRequest({
      input: CAMP_INPUT,
      parseSettings: {
        ...createRunSessionRequest().parseSettings,
        runMode: 'preanalysis',
        preanalysisMode: true,
        coordMode: '2D',
      },
    });
    const targetThresholdMeters =
      baseRequest.parseSettings.preanalysisAccuracyThresholdMeters;
    const base = runAdjustmentSession(baseRequest).result;
    const templates = buildPreanalysisSyntheticSetTemplates(
      CAMP_INPUT,
      base,
      baseRequest.planningMap,
      [],
    );
    const candidates = resolveCandidateTemplates(templates, base, []);
    expect(candidates.length).toBeGreaterThan(0);

    const solveMemo = new Map<string, AdjustmentResult>();
    const solveAlt = (nextIds: string[]): AdjustmentResult => {
      const normalized = resolveAppliedPreanalysisActionState(templates, nextIds)
        .normalizedScenarioIds;
      const key = JSON.stringify(normalized);
      const cached = solveMemo.get(key);
      if (cached) return cached;
      const solveInput = `${CAMP_INPUT.trimEnd()}\n\n${normalized
        .map((id, index) => {
          const template = templates.find((entry) => entry.id === id);
          return `# WEBNET_PREANALYSIS_ADDED_SET ${id} ${index + 1}\n${template?.blockText ?? ''}`;
        })
        .join('\n\n')}\n`;
      const alt = runAdjustmentSession(
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
      solveMemo.set(key, alt);
      return alt;
    };
    const alts = candidates.map((template) => solveAlt([template.id]));

    // Before: legacy convention — one current-step summary per candidate
    // plus unshared alt summaries inside evaluation and scoring.
    resetSummaryBuilds();
    const beforeStartedAt = performance.now();
    const beforeEvaluations = candidates.map((template, index) =>
      buildRecommendationEvaluation(
        template,
        base,
        alts[index]!,
        buildPathPrioritySummary(base),
        targetThresholdMeters,
      ),
    );
    const beforeRows = beforeEvaluations.map((evaluation) => evaluation.row);
    const beforeMs = performance.now() - beforeStartedAt;
    const beforeSummaries = summaryBuilds();

    // After: reused metrics — one base build, one build per alt.
    const metricsFor = createPreanalysisResultMetricsCache();
    const baseMetrics = metricsFor(base);
    resetSummaryBuilds();
    const afterStartedAt = performance.now();
    const afterRows = candidates.map((template, index) =>
      buildRecommendationEvaluation(
        template,
        base,
        alts[index]!,
        baseMetrics.pathSummary,
        targetThresholdMeters,
        baseMetrics,
        metricsFor(alts[index]!),
      ).row,
    );
    const afterMs = performance.now() - afterStartedAt;
    const afterSummaries = summaryBuilds();

    expect(afterRows).toEqual(beforeRows);

    // End-to-end equality through the reused production path.
    resetSummaryBuilds();
    const fullStartedAt = performance.now();
    const full = buildPreanalysisPlanningDiagnostics({
      base,
      input: CAMP_INPUT,
      planningMap: baseRequest.planningMap,
      activeTemplateIds: [],
      targetThresholdMeters,
      maxAddedSets: baseRequest.parseSettings.preanalysisMaxAddedSets,
      solveScenario: solveAlt,
    });
    const fullMs = performance.now() - fullStartedAt;
    const fullSummaries = summaryBuilds();
    expect(full.rows.map((row) => row.scenarioId)).toEqual(
      [...beforeEvaluations]
        .sort(sortRecommendationEvaluations)
        .slice(0, 5)
        .map((evaluation) => evaluation.row.scenarioId),
    );

    console.log(
      `[phase9i-profile] ${JSON.stringify({
        candidateCount: candidates.length,
        thresholdSteps: full.thresholdPlan.steps.length,
        pathSummaryBuilds: { before: beforeSummaries, after: afterSummaries, fullRun: fullSummaries },
        wallMs: { before: beforeMs, after: afterMs, fullRun: fullMs },
        distinctAltSolves: solveMemo.size,
        rowsEqual: true,
      })}`,
    );
  }, 300000);
});
