import { buildPathPrioritySummary } from './preanalysisPathPriority';
import {
  wrapPreanalysisSolveScenario,
  type PreanalysisSolveAuditStage,
} from './preanalysisPlanningSolveAudit';
import type {
  AdjustmentResult,
  PreanalysisBracePreviewPoint,
  PreanalysisImpactDiagnostics,
} from '../types';
import {
  MAX_RECOMMENDATIONS,
  medianOf,
  relativeMetrics,
  resolveAppliedPreanalysisActionState,
  stationMajors,
  templateEffectiveTemplateIds,
  weakPairCount,
  weakStationCount,
  type BuildPreanalysisPlanningDiagnosticsArgs,
  type PreanalysisSyntheticSetTemplate,
} from './preanalysisPlanningShared';
import { buildPreanalysisSyntheticSetTemplates } from './preanalysisPlanningTemplates';
import {
  buildRecommendationEvaluation,
  resolveCandidateTemplates,
  sortRecommendationEvaluations,
  type RecommendationEvaluation,
} from './preanalysisPlanningRecommendations';
import { buildThresholdPlan } from './preanalysisPlanningThresholdPlan';

export const buildPreanalysisPlanningDiagnostics = ({
  base,
  input,
  planningMap,
  activeTemplateIds,
  targetThresholdMeters,
  maxAddedSets,
  solveScenario,
  solveAudit,
  scenarioCacheDiagnostics,
  scenarioCacheEnabled = true,
}: BuildPreanalysisPlanningDiagnosticsArgs): PreanalysisImpactDiagnostics => {
  const templates = buildPreanalysisSyntheticSetTemplates(
    input,
    base,
    planningMap,
    activeTemplateIds,
  );
  const actionState = resolveAppliedPreanalysisActionState(templates, activeTemplateIds);
  const activeTemplateIdSet = actionState.activeScenarioIds;
  const candidateTemplates = resolveCandidateTemplates(templates, base, activeTemplateIds);
  const remainingFeasibleScenarioCount = Math.max(
    0,
    templates.filter((template) => !activeTemplateIdSet.has(template.id)).length,
  );
  const basePathSummary = buildPathPrioritySummary(base);
  const scenarioCache = new Map<string, AdjustmentResult>();
  const solveScenarioCached = (
    stage: PreanalysisSolveAuditStage,
    requestedIds: string[],
  ): AdjustmentResult => {
    const normalizedIds = resolveAppliedPreanalysisActionState(templates, requestedIds).normalizedScenarioIds;
    const key = JSON.stringify(normalizedIds);
    const cached = scenarioCacheEnabled ? scenarioCache.get(key) : undefined;
    if (cached != null) {
      scenarioCacheDiagnostics?.recordRequest(normalizedIds, true, scenarioCache.size);
      return cached;
    }
    scenarioCacheDiagnostics?.recordRequest(normalizedIds, false, scenarioCache.size);
    const auditedSolve = solveAudit
      ? wrapPreanalysisSolveScenario(stage, solveScenario, () => templates, solveAudit)
      : solveScenario;
    const result = auditedSolve(requestedIds);
    if (scenarioCacheEnabled) scenarioCache.set(key, result);
    return result;
  };
  const recommendationRows = candidateTemplates
    .map((template) => {
      try {
        const alt = solveScenarioCached('recommendation', [...activeTemplateIds, template.id]);
        return buildRecommendationEvaluation(
          template,
          base,
          alt,
          basePathSummary,
          targetThresholdMeters,
        );
      } catch {
        return {
          row: {
            scenarioId: template.id,
            scenarioKind: template.scenarioKind,
            occupyStationId: template.occupyStationId,
            setupStationIds: [...template.setupStationIds],
            primaryTargetStationId: basePathSummary.stationOrder[0],
            anchorStationId:
              basePathSummary.stationDiagnostics.get(basePathSummary.stationOrder[0] ?? '')?.anchorStationId,
            anchorPathStationIds: [
              ...(basePathSummary.stationDiagnostics.get(basePathSummary.stationOrder[0] ?? '')?.anchorPathStationIds ??
                []),
            ],
            anchorPathPairRefs: (
              basePathSummary.stationDiagnostics.get(basePathSummary.stationOrder[0] ?? '')?.anchorPathPairRefs ?? []
            ).map((pair) => ({ ...pair })),
            bottleneckPair:
              basePathSummary.stationDiagnostics.get(basePathSummary.stationOrder[0] ?? '')?.pathWorstEdgePair !=
              null
                ? {
                    ...basePathSummary.stationDiagnostics.get(basePathSummary.stationOrder[0] ?? '')!
                      .pathWorstEdgePair!,
                  }
                : undefined,
            templateLabel: template.templateLabel,
            affectedStations: [...template.affectedStations],
            affectedPairs: template.affectedPairs.map((pair) => ({ ...pair })),
            sourceLines: [...template.sourceLines],
            addedObservationCount: template.addedObservationCount,
            previewPoints: template.previewPoints.map((point) => ({ ...point, active: false })),
            previewSegments: template.previewSegments.map((segment) => ({
              ...segment,
              active: false,
            })),
            score: undefined,
            actionMode: template.actionMode,
            rationale: template.rationale,
            thresholdReached: false,
            status: 'failed' as const,
          },
          stationComparisons: [],
        } satisfies RecommendationEvaluation;
      }
    })
    .sort(sortRecommendationEvaluations)
    .map((evaluation) => evaluation.row)
    .slice(0, MAX_RECOMMENDATIONS);
  const thresholdPlan = buildThresholdPlan(
    templates,
    base,
    activeTemplateIds,
    targetThresholdMeters,
    maxAddedSets,
    (nextIds) => solveScenarioCached('threshold', nextIds),
  );
  const baseStationValues = stationMajors(base);
  const baseRelativeValues = relativeMetrics(base);
  const bracePreviewPoints: PreanalysisBracePreviewPoint[] = templates
    .filter(
      (
        template,
      ): template is PreanalysisSyntheticSetTemplate & {
        bracePreviewPoint: NonNullable<PreanalysisSyntheticSetTemplate['bracePreviewPoint']>;
      } => template.scenarioKind === 'brace-point' && template.bracePreviewPoint != null,
    )
    .map((template) => ({
      scenarioId: template.id,
      stationId: template.bracePreviewPoint.stationId,
      x: template.bracePreviewPoint.x,
      y: template.bracePreviewPoint.y,
      h: template.bracePreviewPoint.h,
      active: templateEffectiveTemplateIds(template).some((id) =>
        actionState.effectiveActiveTemplateIds.has(id),
      ),
      templateLabel: template.templateLabel,
    }))
    .sort(
      (left, right) =>
        Number(right.active) - Number(left.active) ||
        left.stationId.localeCompare(right.stationId, undefined, { numeric: true }),
    );
  const scenarioPreviewPoints = templates
    .flatMap((template) =>
      template.previewPoints
        .filter((point) => point.role !== 'anchor')
        .map((point) => ({
          ...point,
          active: templateEffectiveTemplateIds(template).some((id) =>
            actionState.effectiveActiveTemplateIds.has(id),
          ),
        })),
    )
    .sort((left, right) =>
      Number(right.active) - Number(left.active) ||
      left.stationId.localeCompare(right.stationId, undefined, { numeric: true }),
    );
  const scenarioPreviewSegments = templates.flatMap((template) =>
    template.previewSegments.map((segment) => ({
      ...segment,
      active: templateEffectiveTemplateIds(template).some((id) =>
        actionState.effectiveActiveTemplateIds.has(id),
      ),
    })),
  );
  return {
    enabled: true,
    activeSyntheticAdditionCount: actionState.normalizedScenarioIds.length,
    candidateTemplateCount: candidateTemplates.length,
    remainingFeasibleScenarioCount,
    baseWorstStationMajor:
      baseStationValues.length > 0 ? Math.max(...baseStationValues) : undefined,
    baseMedianStationMajor: medianOf(baseStationValues),
    baseWorstPairSigmaDist:
      baseRelativeValues.length > 0 ? Math.max(...baseRelativeValues) : undefined,
    baseWeakStationCount: weakStationCount(base),
    baseWeakPairCount: weakPairCount(base),
    targetThresholdMeters,
    rows: recommendationRows,
    bracePreviewPoints,
    scenarioPreviewPoints,
    scenarioPreviewSegments,
    thresholdPlan,
  };
};
