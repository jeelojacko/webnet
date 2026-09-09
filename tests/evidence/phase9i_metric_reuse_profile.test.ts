/**
 * Phase 9I metric/path-summary reuse profile (EVIDENCE ONLY, manual).
 *
 * Before/after comparison of alt path-summary construction during
 * preanalysis recommendation scoring on the exact camp fixture.
 *
 * The before arm is an explicit legacy oracle replicating the pre-9I
 * implementation (scalar station/pair metrics plus one alt path summary
 * in the evaluation body and a second alt path summary inside
 * candidateScore: two alt builds per candidate). The after arm uses the
 * current metrics-reuse production path (one cached metrics build per
 * alt). Base summaries/metrics are built before the counters reset in
 * both arms, so the helper counts compare per-candidate alt work only
 * (2N legacy vs N reused). Wall times are recorded only, never gated.
 * Result equality is asserted exactly (reused rows vs legacy oracle).
 */
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { describe, expect, it, vi } from 'vitest';

import type { AdjustmentResult } from '../../src/types';
import type { PathPrioritySummary } from '../../src/engine/preanalysisPathPriority';
import type { PreanalysisSyntheticSetTemplate } from '../../src/engine/preanalysisPlanningShared';

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
// Scalar helpers for the legacy oracle (pre-9I evaluation computed these
// directly instead of threading PreanalysisResultMetrics).
const {
  medianOf,
  relativeMetrics,
  stationMajors,
  weakPairCount,
  weakStationCount,
} = await import('../../src/engine/preanalysisPlanningShared');
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

const deltaMetric = (next?: number, current?: number): number => {
  const nextValue = Number.isFinite(next) ? (next as number) : undefined;
  const currentValue = Number.isFinite(current) ? (current as number) : undefined;
  if (nextValue != null && currentValue != null) return nextValue - currentValue;
  if (nextValue != null && currentValue == null) return nextValue;
  if (nextValue == null && currentValue != null) return Number.POSITIVE_INFINITY;
  return 0;
};

/** Pre-9I scoring: scalar metrics plus a fresh alt path summary. */
const legacyCandidateScore = (
  base: AdjustmentResult,
  alt: AdjustmentResult,
  pathSummary: PathPrioritySummary,
): number => {
  const baseWorstStation = stationMajors(base);
  const altWorstStation = stationMajors(alt);
  const baseWorstStationMajor =
    baseWorstStation.length > 0 ? Math.max(...baseWorstStation) : undefined;
  const altWorstStationMajor =
    altWorstStation.length > 0 ? Math.max(...altWorstStation) : undefined;
  const baseMedianStationMajor = medianOf(baseWorstStation);
  const altMedianStationMajor = medianOf(altWorstStation);
  const baseWorstPair = relativeMetrics(base);
  const altWorstPair = relativeMetrics(alt);
  const baseWorstPairSigmaDist = baseWorstPair.length > 0 ? Math.max(...baseWorstPair) : undefined;
  const altWorstPairSigmaDist = altWorstPair.length > 0 ? Math.max(...altWorstPair) : undefined;
  const deltaWorstStationMajor =
    altWorstStationMajor != null && baseWorstStationMajor != null
      ? altWorstStationMajor - baseWorstStationMajor
      : 0;
  const deltaMedianStationMajor =
    altMedianStationMajor != null && baseMedianStationMajor != null
      ? altMedianStationMajor - baseMedianStationMajor
      : 0;
  const deltaWorstPairSigmaDist =
    altWorstPairSigmaDist != null && baseWorstPairSigmaDist != null
      ? altWorstPairSigmaDist - baseWorstPairSigmaDist
      : 0;
  const basePrimary = pathSummary.stationDiagnostics.get(pathSummary.stationOrder[0] ?? '');
  const altPrimarySummary = buildPathPrioritySummary(alt);
  const altPrimary = altPrimarySummary.stationDiagnostics.get(pathSummary.stationOrder[0] ?? '');
  return (
    -deltaWorstStationMajor * 100000 -
    -((altPrimary?.pathWorstEdgeMetric ?? 0) - (basePrimary?.pathWorstEdgeMetric ?? 0)) * 10000 -
    -((altPrimary?.pathTotalMetric ?? 0) - (basePrimary?.pathTotalMetric ?? 0)) * 1000 -
    -deltaMedianStationMajor * 100 -
    -deltaWorstPairSigmaDist * 25 -
    (weakStationCount(base) - weakStationCount(alt)) * 5 -
    (weakPairCount(base) - weakPairCount(alt)) * 4
  );
};

/**
 * Pre-9I recommendation evaluation oracle: scalar station/pair metrics,
 * one alt path summary for the row/station comparisons, and a second alt
 * path summary inside scoring. Two alt builds per candidate.
 */
const legacyBuildRecommendationEvaluation = (
  template: PreanalysisSyntheticSetTemplate,
  base: AdjustmentResult,
  alt: AdjustmentResult,
  basePathSummary: PathPrioritySummary,
  targetThresholdMeters?: number,
) => {
  const baseStationValues = stationMajors(base);
  const altStationValues = stationMajors(alt);
  const baseWorstStationMajor =
    baseStationValues.length > 0 ? Math.max(...baseStationValues) : undefined;
  const altWorstStationMajor =
    altStationValues.length > 0 ? Math.max(...altStationValues) : undefined;
  const baseMedianStationMajor = medianOf(baseStationValues);
  const altMedianStationMajor = medianOf(altStationValues);
  const basePairValues = relativeMetrics(base);
  const altPairValues = relativeMetrics(alt);
  const altPathSummary = buildPathPrioritySummary(alt);
  const baseWorstPairSigmaDist =
    basePairValues.length > 0 ? Math.max(...basePairValues) : undefined;
  const altWorstPairSigmaDist = altPairValues.length > 0 ? Math.max(...altPairValues) : undefined;
  const primaryTargetStationId = basePathSummary.stationOrder[0];
  const primaryDiagnostics =
    primaryTargetStationId != null
      ? basePathSummary.stationDiagnostics.get(primaryTargetStationId)
      : undefined;
  const altPrimaryDiagnostics =
    primaryTargetStationId != null
      ? altPathSummary.stationDiagnostics.get(primaryTargetStationId)
      : undefined;
  const row = {
    scenarioId: template.id,
    scenarioKind: template.scenarioKind,
    occupyStationId: template.occupyStationId,
    setupStationIds: [...template.setupStationIds],
    primaryTargetStationId,
    anchorStationId: primaryDiagnostics?.anchorStationId,
    anchorPathStationIds: [...(primaryDiagnostics?.anchorPathStationIds ?? [])],
    anchorPathPairRefs: (primaryDiagnostics?.anchorPathPairRefs ?? []).map((pair) => ({ ...pair })),
    bottleneckPair: primaryDiagnostics?.pathWorstEdgePair
      ? { ...primaryDiagnostics.pathWorstEdgePair }
      : undefined,
    templateLabel: template.templateLabel,
    affectedStations: [...template.affectedStations],
    affectedPairs: template.affectedPairs.map((pair) => ({ ...pair })),
    sourceLines: [...template.sourceLines],
    addedObservationCount: template.addedObservationCount,
    previewPoints: template.previewPoints.map((point) => ({ ...point, active: false })),
    previewSegments: template.previewSegments.map((segment) => ({ ...segment, active: false })),
    deltaWorstStationMajor:
      altWorstStationMajor != null && baseWorstStationMajor != null
        ? altWorstStationMajor - baseWorstStationMajor
        : undefined,
    deltaMedianStationMajor:
      altMedianStationMajor != null && baseMedianStationMajor != null
        ? altMedianStationMajor - baseMedianStationMajor
        : undefined,
    deltaWorstPairSigmaDist:
      altWorstPairSigmaDist != null && baseWorstPairSigmaDist != null
        ? altWorstPairSigmaDist - baseWorstPairSigmaDist
        : undefined,
    deltaPathWorstEdge:
      altPrimaryDiagnostics?.pathWorstEdgeMetric != null &&
      primaryDiagnostics?.pathWorstEdgeMetric != null
        ? altPrimaryDiagnostics.pathWorstEdgeMetric - primaryDiagnostics.pathWorstEdgeMetric
        : undefined,
    deltaPathTotalMetric:
      altPrimaryDiagnostics?.pathTotalMetric != null && primaryDiagnostics?.pathTotalMetric != null
        ? altPrimaryDiagnostics.pathTotalMetric - primaryDiagnostics.pathTotalMetric
        : undefined,
    deltaWeakStationCount: weakStationCount(alt) - weakStationCount(base),
    deltaWeakPairCount: weakPairCount(alt) - weakPairCount(base),
    score: legacyCandidateScore(base, alt, basePathSummary),
    actionMode: template.actionMode,
    rationale: template.rationale,
    thresholdReached:
      targetThresholdMeters != null &&
      altWorstStationMajor != null &&
      altWorstStationMajor <= targetThresholdMeters,
    status: 'ok' as const,
  };
  return {
    row,
    stationComparisons: basePathSummary.stationOrder.map((stationId) => {
      const baseStation = basePathSummary.stationDiagnostics.get(stationId);
      const altStation = altPathSummary.stationDiagnostics.get(stationId);
      return {
        stationId,
        deltaMajor: deltaMetric(altStation?.stationMajor, baseStation?.stationMajor),
        deltaPathWorst: deltaMetric(
          altStation?.pathWorstEdgeMetric,
          baseStation?.pathWorstEdgeMetric,
        ),
        deltaPathTotal: deltaMetric(altStation?.pathTotalMetric, baseStation?.pathTotalMetric),
      };
    }),
  };
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

    // Before (legacy oracle): scalar metrics plus two alt path summaries
    // per candidate (one in evaluation, one in scoring). The base summary
    // is built once up front and excluded from the counts, matching the
    // after arm so both counts compare per-candidate alt work only.
    const legacyBaseSummary = buildPathPrioritySummary(base);
    resetSummaryBuilds();
    const beforeStartedAt = performance.now();
    const beforeEvaluations = candidates.map((template, index) =>
      legacyBuildRecommendationEvaluation(
        template,
        base,
        alts[index]!,
        legacyBaseSummary,
        targetThresholdMeters,
      ),
    );
    const beforeRows = beforeEvaluations.map((evaluation) => evaluation.row);
    const beforeMs = performance.now() - beforeStartedAt;
    const beforeSummaries = summaryBuilds();

    // After (reused metrics): base metrics built once up front and
    // excluded from the counts like the legacy base summary above; the
    // timed loop builds one cached metrics object (one path summary)
    // per alt. Reused rows must equal the legacy oracle rows exactly.
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
