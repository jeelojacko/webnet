import {
  SUSPECT_IMPACT_AUTO_SKIP_MAIN_SOLVE_MS,
  SUSPECT_IMPACT_MAX_CANDIDATES,
  buildSuspectImpactRows,
  collectSuspectImpactCandidates,
  hasLocalFailure,
  maxAbsStdRes,
  observationStationsLabel,
  rankedSuspects,
  resolveSuspectImpactSkipReason,
} from './suspectImpactShared';
import type {
  RunSessionParseSettings,
  SolveInvocationMeta,
} from './runSessionTypes';
import type { SuspectImpactAnalysisMode } from '../typesAdjustmentResult';
import type {
  AdjustmentResult,
  ClusterApprovedMerge,
  Observation,
  ObservationOverride,
} from '../types';

// Re-exported for existing callers (runSessionSolver, tests).
export {
  collectSuspectImpactCandidates,
  rankedSuspects,
  observationStationsLabel,
  hasLocalFailure,
  maxAbsStdRes,
  resolveSuspectImpactSkipReason,
  SUSPECT_IMPACT_MAX_CANDIDATES as IMPACT_MAX_CANDIDATES,
  SUSPECT_IMPACT_AUTO_SKIP_MAIN_SOLVE_MS,
};

export interface SuspectImpactBuildSettings {
  analysisMode?: SuspectImpactAnalysisMode;
  robustReSolve?: boolean;
}

export const buildSuspectImpactDiagnostics = (
  base: AdjustmentResult,
  candidates: Observation[],
  baseExclusions: Set<number>,
  overrideValues: Record<number, ObservationOverride>,
  approvedClusterMerges: ClusterApprovedMerge[],
  solveCore: (
    _excludeSet: Set<number>,
    _parseOverride?: Partial<RunSessionParseSettings>,
    _overrideValues?: Record<number, ObservationOverride>,
    _approvedClusterMerges?: ClusterApprovedMerge[],
    _meta?: SolveInvocationMeta,
  ) => AdjustmentResult,
  settings: SuspectImpactBuildSettings = {},
): NonNullable<AdjustmentResult['suspectImpactDiagnostics']> =>
  buildSuspectImpactRows({
    base,
    candidates,
    baseExclusions,
    analysisMode: settings.analysisMode ?? 'auto',
    robustReSolve: settings.robustReSolve ?? false,
    solveAlt: (altExclusions, meta) =>
      solveCore(altExclusions, undefined, overrideValues, approvedClusterMerges, {
        stageId: 'suspect-impact',
        stageLabel: `Impact ${meta.index + 1}/${meta.total}`,
        solveTotalHint: 1 + meta.total,
      }),
  });
