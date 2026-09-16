import {
  buildPreanalysisPlanningDiagnostics,
} from './preanalysisPlanning';
import { createRunProfileBuilders } from './runProfileBuilders';
import type { ParseSettings, SolveProfile } from '../appStateTypes';
import type {
  AdjustmentResult,
  ClusterApprovedMerge,
  Instrument,
  ObservationOverride,
} from '../types';
import type { RunSessionRequest } from './runSession';

import { buildSuspectImpactRows, collectSuspectImpactCandidates, rankedSuspects } from './suspectImpactShared';

export type DirectSolveCore = (
  _request: RunSessionRequest,
  _excludeSet: Set<number>,
  _parseOverride?: Partial<ParseSettings>,
  _overrideValues?: Record<number, ObservationOverride>,
  _approvedClusterMerges?: ClusterApprovedMerge[],
  _syntheticAdditionIds?: string[],
) => AdjustmentResult;

interface SolveWithImpactsArgs {
  request: RunSessionRequest;
  excludeSet: Set<number>;
  overrideValues?: Record<number, ObservationOverride>;
  approvedClusterMerges?: ClusterApprovedMerge[];
  solveCore: DirectSolveCore;
  defaultIndustryInstrumentCode: string;
  defaultIndustryInstrument: Instrument;
  normalizeSolveProfile: (_profile: SolveProfile) => SolveProfile;
}

const emptyRobustComparison = (): NonNullable<AdjustmentResult['robustComparison']> => ({
  enabled: false,
  classicalTop: [],
  robustTop: [],
  overlapCount: 0,
});

const buildSuspectImpactDiagnostics = ({
  request,
  base,
  baseExclusions,
  overrideValues,
  approvedClusterMerges,
  solveCore,
}: {
  request: RunSessionRequest;
  base: AdjustmentResult;
  baseExclusions: Set<number>;
  overrideValues: Record<number, ObservationOverride>;
  approvedClusterMerges: ClusterApprovedMerge[];
  solveCore: DirectSolveCore;
}): NonNullable<AdjustmentResult['suspectImpactDiagnostics']> =>
  // Direct path keeps its no-mode-gate behavior (always runs); only the
  // helper bodies are deduped into the shared builder (zero semantic change
  // to gating). Analysis mode is therefore always 'always' here.
  buildSuspectImpactRows({
    base,
    candidates: collectSuspectImpactCandidates(base),
    baseExclusions,
    analysisMode: 'always',
    robustReSolve:
      (request.parseSettings as ParseSettings | undefined)?.robustMode != null &&
      (request.parseSettings as ParseSettings).robustMode !== 'none',
    solveAlt: (nextExclusions) =>
      solveCore(request, nextExclusions, undefined, overrideValues, approvedClusterMerges),
  });

export const solveWithImpacts = ({
  request,
  excludeSet,
  overrideValues = request.overrides,
  approvedClusterMerges = request.approvedClusterMerges,
  solveCore,
  defaultIndustryInstrumentCode,
  defaultIndustryInstrument,
  normalizeSolveProfile,
}: SolveWithImpactsArgs): AdjustmentResult => {
  const solved = solveCore(request, excludeSet, undefined, overrideValues, approvedClusterMerges);
  const { resolveProfileContext } = createRunProfileBuilders({
    projectInstruments: request.projectInstruments,
    selectedInstrument: request.selectedInstrument,
    defaultIndustryInstrumentCode,
    defaultIndustryInstrument,
    normalizeSolveProfile,
  });
  const profileCtx = resolveProfileContext(request.parseSettings as ParseSettings);
  if (profileCtx.effectiveParse.runMode === 'preanalysis') {
    solved.suspectImpactDiagnostics = undefined;
    const normalizedActivePreanalysisIds =
      solved.preanalysisSyntheticAdditionIds ?? request.activePreanalysisAdditionIds;
    solved.preanalysisImpactDiagnostics = buildPreanalysisPlanningDiagnostics({
      base: solved,
      input: request.input,
      planningMap: request.planningMap,
      activeTemplateIds: normalizedActivePreanalysisIds,
      targetThresholdMeters: profileCtx.effectiveParse.preanalysisAccuracyThresholdMeters,
      maxAddedSets: profileCtx.effectiveParse.preanalysisMaxAddedSets ?? 5,
      solveScenario: (nextTemplateIds) =>
        solveCore(
          request,
          excludeSet,
          undefined,
          overrideValues,
          approvedClusterMerges,
          nextTemplateIds,
        ),
    });
    solved.preanalysisSyntheticAdditionIds = [...normalizedActivePreanalysisIds];
    solved.robustComparison = emptyRobustComparison();
    return solved;
  }
  if (profileCtx.effectiveParse.runMode !== 'adjustment') {
    solved.suspectImpactDiagnostics = undefined;
    solved.preanalysisImpactDiagnostics = undefined;
    solved.robustComparison = emptyRobustComparison();
    return solved;
  }
  solved.suspectImpactDiagnostics = buildSuspectImpactDiagnostics({
    request,
    base: solved,
    baseExclusions: excludeSet,
    overrideValues,
    approvedClusterMerges,
    solveCore,
  });
  solved.preanalysisImpactDiagnostics = undefined;
  if (profileCtx.effectiveParse.robustMode === 'none') {
    solved.robustComparison = emptyRobustComparison();
    return solved;
  }

  const classical = solveCore(
    request,
    excludeSet,
    { robustMode: 'none' },
    overrideValues,
    approvedClusterMerges,
  );
  const classicalTop = rankedSuspects(classical, 10);
  const robustTop = rankedSuspects(solved, 10);
  const robustIds = new Set(robustTop.map((row) => row.obsId));
  const overlapCount = classicalTop.reduce(
    (acc, row) => acc + (robustIds.has(row.obsId) ? 1 : 0),
    0,
  );
  solved.robustComparison = {
    enabled: true,
    classicalTop,
    robustTop,
    overlapCount,
  };
  return solved;
};
