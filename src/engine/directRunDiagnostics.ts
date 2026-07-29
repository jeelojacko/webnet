import {
  buildPreanalysisPlanningDiagnostics,
} from './preanalysisPlanning';
import { createRunProfileBuilders } from './runProfileBuilders';
import type { ParseSettings, SolveProfile } from '../appStateTypes';
import type {
  AdjustmentResult,
  ClusterApprovedMerge,
  Instrument,
  Observation,
  ObservationOverride,
} from '../types';
import type { RunSessionRequest } from './runSession';

const IMPACT_MAX_CANDIDATES = 3;

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

const observationStationsLabel = (obs: Observation): string => {
  if ('at' in obs && 'from' in obs && 'to' in obs) return `${obs.at}-${obs.from}-${obs.to}`;
  if ('at' in obs && 'to' in obs) return `${obs.at}-${obs.to}`;
  if ('from' in obs && 'to' in obs) return `${obs.from}-${obs.to}`;
  return '-';
};

const hasLocalFailure = (obs: Observation): boolean => {
  if (obs.localTestComponents) return !obs.localTestComponents.passE || !obs.localTestComponents.passN;
  if (obs.localTest) return !obs.localTest.pass;
  return false;
};

const maxAbsStdRes = (res: AdjustmentResult): number =>
  res.observations.reduce((maxVal, obs) => {
    if (!Number.isFinite(obs.stdRes)) return maxVal;
    return Math.max(maxVal, Math.abs(obs.stdRes ?? 0));
  }, 0);

const rankedSuspects = (
  res: AdjustmentResult,
  limit = 10,
): NonNullable<AdjustmentResult['robustComparison']>['robustTop'] => {
  const rows = [...res.observations]
    .filter((obs) => Number.isFinite(obs.stdRes))
    .map((obs) => ({
      obsId: obs.id,
      type: obs.type,
      stations: observationStationsLabel(obs),
      sourceLine: obs.sourceLine,
      stdRes: obs.stdRes != null ? Math.abs(obs.stdRes) : undefined,
      localFail: hasLocalFailure(obs),
    }))
    .sort((a, b) => {
      const aFail = a.localFail ? 1 : 0;
      const bFail = b.localFail ? 1 : 0;
      if (bFail !== aFail) return bFail - aFail;
      return (b.stdRes ?? 0) - (a.stdRes ?? 0);
    });
  return rows.slice(0, limit).map((row, index) => ({ ...row, rank: index + 1 }));
};

const maxUnknownCoordinateShift = (base: AdjustmentResult, alt: AdjustmentResult): number => {
  let maxShift = 0;
  Object.entries(base.stations).forEach(([id, station]) => {
    if (station.fixed) return;
    const altStation = alt.stations[id];
    if (!altStation) return;
    const dx = altStation.x - station.x;
    const dy = altStation.y - station.y;
    const dh = altStation.h - station.h;
    maxShift = Math.max(maxShift, Math.sqrt(dx * dx + dy * dy + dh * dh));
  });
  return maxShift;
};

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
}): NonNullable<AdjustmentResult['suspectImpactDiagnostics']> => {
  const baseChiPass = base.chiSquare?.pass95;
  const baseMaxStd = maxAbsStdRes(base);
  const candidates = [...base.observations]
    .filter((obs) => Number.isFinite(obs.stdRes))
    .filter((obs) => hasLocalFailure(obs) || Math.abs(obs.stdRes ?? 0) >= 2)
    .sort((a, b) => {
      const aFail = hasLocalFailure(a) ? 1 : 0;
      const bFail = hasLocalFailure(b) ? 1 : 0;
      if (bFail !== aFail) return bFail - aFail;
      return Math.abs(b.stdRes ?? 0) - Math.abs(a.stdRes ?? 0);
    })
    .slice(0, IMPACT_MAX_CANDIDATES);

  const rows = candidates.map((obs) => {
    const baseLocalFail = hasLocalFailure(obs);
    const obsEntry: NonNullable<AdjustmentResult['suspectImpactDiagnostics']>[number] = {
      obsId: obs.id,
      type: obs.type,
      stations: observationStationsLabel(obs),
      sourceLine: obs.sourceLine,
      baseStdRes: obs.stdRes != null ? Math.abs(obs.stdRes) : undefined,
      baseLocalFail,
      chiDelta: '-',
      status: 'failed',
    };

    try {
      const nextExclusions = new Set(baseExclusions);
      nextExclusions.add(obs.id);
      const alt = solveCore(request, nextExclusions, undefined, overrideValues, approvedClusterMerges);
      const altMaxStd = maxAbsStdRes(alt);
      const altChiPass = alt.chiSquare?.pass95;
      let chiDelta: NonNullable<AdjustmentResult['suspectImpactDiagnostics']>[number]['chiDelta'] = '-';
      if (baseChiPass != null && altChiPass != null) {
        if (!baseChiPass && altChiPass) chiDelta = 'improved';
        else if (baseChiPass && !altChiPass) chiDelta = 'degraded';
        else chiDelta = 'unchanged';
      }

      const deltaSeuw = alt.seuw - base.seuw;
      const deltaMaxStdRes = altMaxStd - baseMaxStd;
      const maxCoordShift = maxUnknownCoordinateShift(base, alt);

      let score = 0;
      score += -deltaSeuw * 40;
      score += -deltaMaxStdRes * 20;
      if (chiDelta === 'improved') score += 20;
      if (chiDelta === 'degraded') score -= 20;
      score -= maxCoordShift * 15;

      return {
        ...obsEntry,
        deltaSeuw,
        deltaMaxStdRes,
        baseChiPass,
        altChiPass,
        chiDelta,
        maxCoordShift,
        score: Number.isFinite(score) ? score : undefined,
        status: 'ok' as const,
      };
    } catch {
      return obsEntry;
    }
  });
  rows.sort((a, b) => {
    if (a.status !== b.status) return a.status === 'ok' ? -1 : 1;
    const bScore = b.score ?? Number.NEGATIVE_INFINITY;
    const aScore = a.score ?? Number.NEGATIVE_INFINITY;
    if (bScore !== aScore) return bScore - aScore;
    return (b.baseStdRes ?? 0) - (a.baseStdRes ?? 0);
  });
  return rows;
};

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
