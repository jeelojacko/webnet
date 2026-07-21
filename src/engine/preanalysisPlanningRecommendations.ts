import { buildPathPrioritySummary, type PathPrioritySummary } from './preanalysisPathPriority';
import type {
  AdjustmentResult,
  PreanalysisImpactDiagnostics,
  PreanalysisThresholdPlan,
  StationId,
} from '../types';
import {
  buildPairKey,
  MAX_RECOMMENDATION_SOLVE_CANDIDATES,
  medianOf,
  recommendationKindTieWeight,
  relativeMetrics,
  resolveAppliedPreanalysisActionState,
  stationMajors,
  templateCorridorPairs,
  templateEffectiveTemplateIds,
  weakPairCount,
  weakStationCount,
  type PreanalysisSyntheticSetTemplate,
} from './preanalysisPlanningShared';

export type RecommendationEvaluation = {
  row: PreanalysisImpactDiagnostics['rows'][number];
  stationComparisons: Array<{
    stationId: StationId;
    deltaMajor: number;
    deltaPathWorst: number;
    deltaPathTotal: number;
  }>;
};

const deltaMetric = (next?: number, current?: number): number => {
  const nextValue = Number.isFinite(next) ? (next as number) : undefined;
  const currentValue = Number.isFinite(current) ? (current as number) : undefined;
  if (nextValue != null && currentValue != null) return nextValue - currentValue;
  if (nextValue != null && currentValue == null) return nextValue;
  if (nextValue == null && currentValue != null) return Number.POSITIVE_INFINITY;
  return 0;
};

const candidateScore = (base: AdjustmentResult, alt: AdjustmentResult, pathSummary: PathPrioritySummary): number => {
  const baseWorstStation = stationMajors(base);
  const altWorstStation = stationMajors(alt);
  const baseWorstStationMajor =
    baseWorstStation.length > 0 ? Math.max(...baseWorstStation) : undefined;
  const altWorstStationMajor = altWorstStation.length > 0 ? Math.max(...altWorstStation) : undefined;
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

export const buildRecommendationEvaluation = (
  template: PreanalysisSyntheticSetTemplate,
  base: AdjustmentResult,
  alt: AdjustmentResult,
  basePathSummary: PathPrioritySummary,
  targetThresholdMeters?: number,
): RecommendationEvaluation => {
  const baseStationValues = stationMajors(base);
  const altStationValues = stationMajors(alt);
  const baseWorstStationMajor =
    baseStationValues.length > 0 ? Math.max(...baseStationValues) : undefined;
  const altWorstStationMajor = altStationValues.length > 0 ? Math.max(...altStationValues) : undefined;
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
  const row: PreanalysisImpactDiagnostics['rows'][number] = {
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
    previewPoints: template.previewPoints.map((point) => ({
      ...point,
      active: false,
    })),
    previewSegments: template.previewSegments.map((segment) => ({
      ...segment,
      active: false,
    })),
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
      altPrimaryDiagnostics?.pathTotalMetric != null &&
      primaryDiagnostics?.pathTotalMetric != null
        ? altPrimaryDiagnostics.pathTotalMetric - primaryDiagnostics.pathTotalMetric
        : undefined,
    deltaWeakStationCount: weakStationCount(alt) - weakStationCount(base),
    deltaWeakPairCount: weakPairCount(alt) - weakPairCount(base),
    score: candidateScore(base, alt, basePathSummary),
    actionMode: template.actionMode,
    rationale: template.rationale,
    thresholdReached:
      targetThresholdMeters != null &&
      altWorstStationMajor != null &&
      altWorstStationMajor <= targetThresholdMeters,
    status: 'ok',
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

const compareImprovementDelta = (left: number, right: number): number => {
  if (left !== right) return left - right;
  return 0;
};

export const sortRecommendationEvaluations = (
  left: RecommendationEvaluation,
  right: RecommendationEvaluation,
): number => {
  if (left.row.status !== right.row.status) return left.row.status === 'ok' ? -1 : 1;
  if (left.row.thresholdReached !== right.row.thresholdReached) return left.row.thresholdReached ? -1 : 1;
  const maxLength = Math.max(left.stationComparisons.length, right.stationComparisons.length);
  for (let index = 0; index < maxLength; index += 1) {
    const leftStation = left.stationComparisons[index];
    const rightStation = right.stationComparisons[index];
    if (!leftStation || !rightStation) break;
    const majorDelta = compareImprovementDelta(leftStation.deltaMajor, rightStation.deltaMajor);
    if (majorDelta !== 0) return majorDelta;
    const worstDelta = compareImprovementDelta(leftStation.deltaPathWorst, rightStation.deltaPathWorst);
    if (worstDelta !== 0) return worstDelta;
    const totalDelta = compareImprovementDelta(leftStation.deltaPathTotal, rightStation.deltaPathTotal);
    if (totalDelta !== 0) return totalDelta;
  }
  const rightScore = right.row.score ?? Number.NEGATIVE_INFINITY;
  const leftScore = left.row.score ?? Number.NEGATIVE_INFINITY;
  if (rightScore !== leftScore) return rightScore - leftScore;
  const kindDelta =
    recommendationKindTieWeight(left.row.scenarioKind) -
    recommendationKindTieWeight(right.row.scenarioKind);
  if (kindDelta !== 0) return kindDelta;
  return (
    left.row.occupyStationId.localeCompare(right.row.occupyStationId, undefined, { numeric: true }) ||
    left.row.templateLabel.localeCompare(right.row.templateLabel, undefined, { numeric: true })
  );
};

export const resolveCandidateTemplates = (
  templates: PreanalysisSyntheticSetTemplate[],
  base: AdjustmentResult,
  activeTemplateIds: string[],
): PreanalysisSyntheticSetTemplate[] => {
  const actionState = resolveAppliedPreanalysisActionState(templates, activeTemplateIds);
  const pathSummary = buildPathPrioritySummary(base);
  const remainingTemplates = templates.filter((template) => {
    if (actionState.activeScenarioIds.has(template.id)) return false;
    if (
      templateEffectiveTemplateIds(template).some((id) =>
        actionState.effectiveActiveTemplateIds.has(id),
      )
    ) {
      return false;
    }
    if (template.sourceLines.some((line) => actionState.removedSourceLines.has(line))) return false;
    return true;
  });
  const prioritizeRows = remainingTemplates;
  const priorityForTemplate = (template: PreanalysisSyntheticSetTemplate): number => {
    const prioritizedStationHits = template.affectedStations.filter((stationId) =>
      pathSummary.prioritizedStations.has(stationId),
    ).length;
    const prioritizedPairHits = template.affectedPairs.filter((pair) =>
      pathSummary.prioritizedPairKeys.has(buildPairKey(pair.from, pair.to)),
    ).length;
    const prioritizedCorridorHits = templateCorridorPairs(template).filter((pair) =>
      pathSummary.prioritizedPairKeys.has(buildPairKey(pair.from, pair.to)),
    ).length;
    const touchesPrimaryTarget =
      pathSummary.stationOrder[0] != null &&
      template.affectedStations.includes(pathSummary.stationOrder[0])
        ? 1
        : 0;
    const touchesBottleneck =
      pathSummary.stationDiagnostics.get(pathSummary.stationOrder[0] ?? '')?.pathWorstEdgePair != null &&
      templateCorridorPairs(template).some(
        (pair) =>
          buildPairKey(pair.from, pair.to) ===
          buildPairKey(
            pathSummary.stationDiagnostics.get(pathSummary.stationOrder[0] ?? '')!.pathWorstEdgePair!.from,
            pathSummary.stationDiagnostics.get(pathSummary.stationOrder[0] ?? '')!.pathWorstEdgePair!.to,
          ),
      )
        ? 1
        : 0;
    return (
      touchesPrimaryTarget * 500 +
      touchesBottleneck * 400 +
      prioritizedCorridorHits * 140 +
      prioritizedPairHits * 20 +
      prioritizedStationHits * 90 +
      Math.min(template.addedObservationCount, 8) * 4
    );
  };
  const sortedCandidates = [...prioritizeRows].sort((left, right) => {
    const priorityDelta = priorityForTemplate(right) - priorityForTemplate(left);
    if (priorityDelta !== 0) return priorityDelta;
    return (
      left.occupyStationId.localeCompare(right.occupyStationId, undefined, { numeric: true }) ||
      left.templateLabel.localeCompare(right.templateLabel, undefined, { numeric: true })
    );
  });
  const selected: PreanalysisSyntheticSetTemplate[] = [];
  const selectedIds = new Set<string>();
  const pushTemplate = (template: PreanalysisSyntheticSetTemplate): void => {
    if (selected.length >= MAX_RECOMMENDATION_SOLVE_CANDIDATES) return;
    if (selectedIds.has(template.id)) return;
    selected.push(template);
    selectedIds.add(template.id);
  };

  sortedCandidates.forEach(pushTemplate);
  return selected;
};
