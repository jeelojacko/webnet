import type { AdjustmentResult, PreanalysisThresholdPlan } from '../types';
import { stationMajors, type PreanalysisSyntheticSetTemplate } from './preanalysisPlanningShared';
import {
  buildRecommendationEvaluation,
  resolveCandidateTemplates,
  sortRecommendationEvaluations,
  type RecommendationEvaluation,
} from './preanalysisPlanningRecommendations';
import { buildPathPrioritySummary } from './preanalysisPathPriority';

export const buildThresholdPlan = (
  templates: PreanalysisSyntheticSetTemplate[],
  base: AdjustmentResult,
  activeTemplateIds: string[],
  targetThresholdMeters: number | undefined,
  maxAddedSets: number,
  solveScenario: (_activeTemplateIds: string[]) => AdjustmentResult,
): PreanalysisThresholdPlan => {
  const baseWorstStationMajor = (() => {
    const values = stationMajors(base);
    return values.length > 0 ? Math.max(...values) : undefined;
  })();
  if (targetThresholdMeters == null) {
    return {
      targetThresholdMeters,
      thresholdReached: false,
      appliedStepCount: 0,
      finalWorstStationMajor: baseWorstStationMajor,
      remainingFeasibleScenarioCount: Math.max(0, templates.length - activeTemplateIds.length),
      unmetReason: undefined,
      steps: [],
    };
  }
  if (baseWorstStationMajor != null && baseWorstStationMajor <= targetThresholdMeters) {
    return {
      targetThresholdMeters,
      thresholdReached: true,
      appliedStepCount: 0,
      finalWorstStationMajor: baseWorstStationMajor,
      remainingFeasibleScenarioCount: Math.max(0, templates.length - activeTemplateIds.length),
      steps: [],
    };
  }

  const steps: PreanalysisThresholdPlan['steps'] = [];
  let currentResult = base;
  let currentActiveIds = [...activeTemplateIds];
  let unmetReason: string | undefined;
  let reached = false;

  for (let stepIndex = 0; stepIndex < Math.max(0, maxAddedSets); stepIndex += 1) {
    const rows = resolveCandidateTemplates(templates, currentResult, currentActiveIds)
      .filter((template) => template.actionMode === 'applyable-addition')
      .map((template) => {
        try {
          const nextIds = [...currentActiveIds, template.id];
          const alt = solveScenario(nextIds);
          return {
            evaluation: buildRecommendationEvaluation(
              template,
              currentResult,
              alt,
              buildPathPrioritySummary(currentResult),
              targetThresholdMeters,
            ),
            alt,
          };
        } catch {
          return null;
        }
      })
      .filter(
        (entry): entry is { evaluation: RecommendationEvaluation; alt: AdjustmentResult } =>
          entry != null,
      )
      .sort((left, right) => sortRecommendationEvaluations(left.evaluation, right.evaluation));
    const best = rows[0];
    if (!best) {
      unmetReason =
        resolveCandidateTemplates(templates, currentResult, currentActiveIds).some(
          (template) => template.actionMode === 'applyable-transform',
        )
          ? 'Additive scenarios are exhausted; only one-click transform scenarios remain outside threshold planning.'
          : currentActiveIds.length > 0
            ? 'All usable existing setup-set templates are already active.'
            : 'No usable existing setup-set templates were available for threshold planning.';
      break;
    }
    currentActiveIds = [...currentActiveIds, best.evaluation.row.scenarioId];
    currentResult = best.alt;
    const currentWorstValues = stationMajors(currentResult);
    const projectedWorstStationMajor =
      currentWorstValues.length > 0 ? Math.max(...currentWorstValues) : undefined;
    const thresholdReached =
      projectedWorstStationMajor != null && projectedWorstStationMajor <= targetThresholdMeters;
    steps.push({
      rank: stepIndex + 1,
      scenarioId: best.evaluation.row.scenarioId,
      scenarioKind: best.evaluation.row.scenarioKind,
      occupyStationId: best.evaluation.row.occupyStationId,
      setupStationIds: [...best.evaluation.row.setupStationIds],
      templateLabel: best.evaluation.row.templateLabel,
      addedObservationCount: best.evaluation.row.addedObservationCount,
      projectedWorstStationMajor,
      thresholdReached,
    });
    if (thresholdReached) {
      reached = true;
      break;
    }
  }

  const finalWorstValues = stationMajors(currentResult);
  const finalWorstStationMajor =
    finalWorstValues.length > 0 ? Math.max(...finalWorstValues) : baseWorstStationMajor;
  if (!reached && unmetReason == null) {
    unmetReason =
      steps.length >= Math.max(0, maxAddedSets)
        ? 'Threshold not reached before hitting the max added sets limit.'
        : 'Threshold not reached with available added-set trials.';
  }
  return {
    targetThresholdMeters,
    thresholdReached: reached,
    appliedStepCount: steps.length,
    finalWorstStationMajor,
    remainingFeasibleScenarioCount: Math.max(0, templates.length - currentActiveIds.length),
    unmetReason,
    steps,
  };
};
