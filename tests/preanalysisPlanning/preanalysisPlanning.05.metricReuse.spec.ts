import { describe, expect, it } from 'vitest';

import {
  buildPreanalysisPlanningDiagnostics,
  buildPreanalysisSyntheticSetTemplates,
} from '../../src/engine/preanalysisPlanning';
import {
  buildRecommendationEvaluation,
  resolveCandidateTemplates,
  sortRecommendationEvaluations,
} from '../../src/engine/preanalysisPlanningRecommendations';
import {
  attachPreanalysisPathSummary,
  buildPreanalysisResultMetrics,
  createPreanalysisResultMetricsCache,
} from '../../src/engine/preanalysisResultMetrics';
import { buildPathPrioritySummary } from '../../src/engine/preanalysisPathPriority';
import { DEFAULT_PLANNING_MAP_STATE } from '../../src/engine/planningMapState';
import { buildChainResult, buildResult } from './preanalysisPlanningTestSupport';

const CHAIN_INPUT = ['DB B', 'DM A', 'DE', '', 'DB C', 'DM B', 'DE', '', 'DB D', 'DM C', 'DE'].join('\n');

describe('phase 9I preanalysis result metrics reuse', () => {
  it('builds exact station/relative/weak scalars plus the path summary', () => {
    const base = buildChainResult();
    const metrics = buildPreanalysisResultMetrics(base);
    expect(metrics.stationValues).toEqual([0.004, 0.008, 0.012]);
    expect(metrics.worstStationMajor).toBe(0.012);
    expect(metrics.medianStationMajor).toBe(0.008);
    expect(metrics.pairValues).toEqual([0.002, 0.009, 0.006]);
    expect(metrics.worstPairSigmaDist).toBe(0.009);
    expect(metrics.weakStations).toBe(2);
    expect(metrics.weakPairs).toBe(2);
    expect(metrics.pathSummary.stationOrder[0]).toBe('D');
  });

  it('reuses one metrics instance per result object within a planning invocation', () => {
    const metricsFor = createPreanalysisResultMetricsCache();
    const base = buildChainResult();
    expect(metricsFor(base)).toBe(metricsFor(base));
    const attached = attachPreanalysisPathSummary(base, buildPathPrioritySummary(base));
    expect(attached.worstStationMajor).toBe(0.012);
    expect(attached.pathSummary.stationOrder[0]).toBe('D');
  });

  it('scores identically with and without prebuilt metrics', () => {
    const base = buildChainResult();
    const alt = buildResult(0.006);
    const templates = buildPreanalysisSyntheticSetTemplates(
      CHAIN_INPUT,
      base,
      DEFAULT_PLANNING_MAP_STATE,
      [],
    );
    const template = resolveCandidateTemplates(templates, base, [])[0]!;
    const legacy = buildRecommendationEvaluation(
      template,
      base,
      alt,
      buildPathPrioritySummary(base),
    );
    const baseMetrics = buildPreanalysisResultMetrics(base);
    const reused = buildRecommendationEvaluation(
      template,
      base,
      alt,
      baseMetrics.pathSummary,
      undefined,
      baseMetrics,
      buildPreanalysisResultMetrics(alt),
    );
    expect(reused.row).toEqual(legacy.row);
    expect(reused.stationComparisons).toEqual(legacy.stationComparisons);
  });

  it('selects identical candidates with and without a reused base summary', () => {
    const base = buildChainResult();
    const templates = buildPreanalysisSyntheticSetTemplates(
      CHAIN_INPUT,
      base,
      DEFAULT_PLANNING_MAP_STATE,
      [],
    );
    const legacy = resolveCandidateTemplates(templates, base, []);
    const reused = resolveCandidateTemplates(
      templates,
      base,
      [],
      buildPreanalysisResultMetrics(base),
    );
    expect(reused.map((template) => template.id)).toEqual(
      legacy.map((template) => template.id),
    );
  });

  it('keeps exact 16-candidate score/order/result equality end to end', () => {
    const base = buildResult(0.01);
    for (let index = 0; index < 12; index += 1) {
      const occupy = `30${index}`;
      const target = `40${index}`;
      base.stations[occupy] = { x: 50 + index * 10, y: 0, h: 0, fixed: false };
      base.stations[target] = { x: 55 + index * 10, y: 5, h: 0, fixed: false };
      base.observations.push({
        id: 10 + index,
        type: 'direction',
        instCode: 'SX12',
        stdDev: 1,
        planned: true,
        sigmaSource: 'default',
        setId: `${occupy}-set`,
        sourceLine: 9 + index * 4,
        at: occupy,
        to: target,
      } as never);
    }
    const extraBlocks = Array.from({ length: 12 }, (_, index) =>
      [`DB 30${index}`, `DM 40${index}`, 'DE'].join('\n'),
    );
    const input = [
      'DB 105',
      'DM 104',
      'DE',
      '',
      'DB 109',
      'DM 114',
      'DE',
      '',
      ...extraBlocks,
    ].join('\n\n');
    const planningMap = {
      ...DEFAULT_PLANNING_MAP_STATE,
      scenarioFamilies: {
        existingSet: true,
        bracePoint: true,
        syntheticSetup: true,
        promotedSetup: true,
        crossTie: true,
      },
    };
    const solveScenario = (nextIds: string[]) => {
      if (nextIds.some((id) => id.startsWith('preanalysis-brace:'))) return buildResult(0.006);
      if (nextIds.some((id) => id.startsWith('preanalysis-promoted:'))) return buildResult(0.0065);
      if (nextIds.some((id) => id.startsWith('preanalysis-synthsetup:'))) return buildResult(0.007);
      return buildResult(0.0095);
    };
    const templates = buildPreanalysisSyntheticSetTemplates(input, base, planningMap, []);
    expect(templates.length).toBeGreaterThan(16);
    const candidates = resolveCandidateTemplates(templates, base, []);
    expect(candidates).toHaveLength(16);
    const baseMetrics = buildPreanalysisResultMetrics(base);
    const scoreAll = (useMetrics: boolean) =>
      candidates
        .map((template) => {
          const alt = solveScenario([template.id]);
          return buildRecommendationEvaluation(
            template,
            base,
            alt,
            baseMetrics.pathSummary,
            0.005,
            useMetrics ? baseMetrics : undefined,
            useMetrics ? buildPreanalysisResultMetrics(alt) : undefined,
          );
        })
        .sort(sortRecommendationEvaluations);
    const legacyOrder = scoreAll(false).map((evaluation) => evaluation.row);
    const reusedOrder = scoreAll(true).map((evaluation) => evaluation.row);
    expect(reusedOrder).toEqual(legacyOrder);

    const first = buildPreanalysisPlanningDiagnostics({
      base,
      input,
      planningMap,
      activeTemplateIds: [],
      targetThresholdMeters: 0.005,
      maxAddedSets: 5,
      solveScenario,
    });
    const second = buildPreanalysisPlanningDiagnostics({
      base,
      input,
      planningMap,
      activeTemplateIds: [],
      targetThresholdMeters: 0.005,
      maxAddedSets: 5,
      solveScenario,
    });
    expect(second.rows).toEqual(first.rows);
    expect(second.thresholdPlan).toEqual(first.thresholdPlan);
    expect(second.candidateTemplateCount).toBe(16);
  });
});
