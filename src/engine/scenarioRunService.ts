import { LSAEngine } from './adjust';
import {
  getCachedParsedModel,
  getScenarioRunServiceStats,
  recordScenarioSolve,
  resetScenarioRunServiceCache,
} from './scenarioParsedModelCache';
import type {
  ScenarioComparisonRequest,
  ScenarioComparisonResult,
  ScenarioRunRequest,
} from './scenarioRunModels';
import type { AdjustmentResult } from '../types';

export const runAdjustmentScenario = (request: ScenarioRunRequest): AdjustmentResult => {
  recordScenarioSolve();
  const engine = new LSAEngine({
    input: request.input,
    maxIterations: request.maxIterations,
    convergenceThreshold: request.convergenceThreshold,
    instrumentLibrary: request.instrumentLibrary,
    excludeIds: request.excludeIds,
    overrides: request.overrides,
    parseOptions: request.parseOptions,
    geoidSourceData: request.geoidSourceData,
    parsedResult: getCachedParsedModel(request),
  });
  return engine.solve();
};

export const runComparedAdjustmentScenarios = <TLabel = string>(
  scenarios: ScenarioComparisonRequest<TLabel>[],
): ScenarioComparisonResult<TLabel>[] =>
  scenarios.map((scenario) => ({
    label: scenario.label,
    request: scenario.request,
    result: runAdjustmentScenario(scenario.request),
  }));

export { getScenarioRunServiceStats, resetScenarioRunServiceCache };
