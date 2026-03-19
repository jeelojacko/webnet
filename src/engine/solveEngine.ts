import {
  getScenarioRunServiceStats,
  resetScenarioRunServiceCache,
  runAdjustmentScenario,
  runComparedAdjustmentScenarios,
} from './scenarioRunService';
import type { ScenarioRunRequest } from './scenarioRunModels';
import type {
  AdjustmentResult,
  ClusterApprovedMerge,
} from '../types';

export type SolveEngineRequest = ScenarioRunRequest;

export const solveEngine = (request: SolveEngineRequest): AdjustmentResult => {
  return runAdjustmentScenario(request);
};

export {
  getScenarioRunServiceStats,
  resetScenarioRunServiceCache,
  runComparedAdjustmentScenarios,
};

export const normalizeClusterApprovedMerges = (
  merges: ClusterApprovedMerge[],
): ClusterApprovedMerge[] => {
  const byAlias = new Map<string, string>();
  merges
    .map((merge) => ({
      aliasId: String(merge.aliasId ?? '').trim(),
      canonicalId: String(merge.canonicalId ?? '').trim(),
    }))
    .filter((merge) => merge.aliasId && merge.canonicalId && merge.aliasId !== merge.canonicalId)
    .sort(
      (a, b) =>
        a.aliasId.localeCompare(b.aliasId, undefined, { numeric: true }) ||
        a.canonicalId.localeCompare(b.canonicalId, undefined, { numeric: true }),
    )
    .forEach((merge) => {
      const prior = byAlias.get(merge.aliasId);
      if (!prior) {
        byAlias.set(merge.aliasId, merge.canonicalId);
        return;
      }
      if (merge.canonicalId.localeCompare(prior, undefined, { numeric: true }) < 0) {
        byAlias.set(merge.aliasId, merge.canonicalId);
      }
    });
  return [...byAlias.entries()]
    .map(([aliasId, canonicalId]) => ({ aliasId, canonicalId }))
    .sort(
      (a, b) =>
        a.canonicalId.localeCompare(b.canonicalId, undefined, { numeric: true }) ||
        a.aliasId.localeCompare(b.aliasId, undefined, { numeric: true }),
    );
};
