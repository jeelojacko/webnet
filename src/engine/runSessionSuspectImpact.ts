import type {
  RunSessionParseSettings,
  SolveInvocationMeta,
} from './runSessionTypes';
import type {
  AdjustmentResult,
  ClusterApprovedMerge,
  Observation,
  ObservationOverride,
  SuspectImpactMode,
} from '../types';

const IMPACT_MAX_CANDIDATES = 3;
const SUSPECT_IMPACT_AUTO_SKIP_MAIN_SOLVE_MS = 5000;

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
  res.observations.reduce((maxValue, obs) => {
    if (!Number.isFinite(obs.stdRes)) return maxValue;
    return Math.max(maxValue, Math.abs(obs.stdRes ?? 0));
  }, 0);

export const rankedSuspects = (
  res: AdjustmentResult,
  limit = 10,
): NonNullable<AdjustmentResult['robustComparison']>['robustTop'] =>
  [...res.observations]
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
    })
    .slice(0, limit)
    .map((row, index) => ({ ...row, rank: index + 1 }));

export const collectSuspectImpactCandidates = (base: AdjustmentResult): Observation[] =>
  [...base.observations]
    .filter((obs) => Number.isFinite(obs.stdRes))
    .filter((obs) => hasLocalFailure(obs) || Math.abs(obs.stdRes ?? 0) >= 2)
    .sort((a, b) => {
      const aFail = hasLocalFailure(a) ? 1 : 0;
      const bFail = hasLocalFailure(b) ? 1 : 0;
      if (bFail !== aFail) return bFail - aFail;
      return Math.abs(b.stdRes ?? 0) - Math.abs(a.stdRes ?? 0);
    })
    .slice(0, IMPACT_MAX_CANDIDATES);

export const resolveSuspectImpactSkipReason = ({
  mode,
  mainSolveElapsedMs,
  candidateCount,
}: {
  mode: SuspectImpactMode;
  mainSolveElapsedMs: number;
  candidateCount: number;
}): string | null => {
  if (candidateCount <= 0) return null;
  if (mode === 'off') return 'disabled in Project Options.';
  if (mode !== 'auto') return null;
  if (mainSolveElapsedMs <= SUSPECT_IMPACT_AUTO_SKIP_MAIN_SOLVE_MS) return null;
  return `auto-skip triggered because the main solve took ${(mainSolveElapsedMs / 1000).toFixed(1)} s (threshold ${(SUSPECT_IMPACT_AUTO_SKIP_MAIN_SOLVE_MS / 1000).toFixed(1)} s).`;
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
): NonNullable<AdjustmentResult['suspectImpactDiagnostics']> =>
  candidates
    .map((obs, index, candidateRows) => {
      const baseChiPass = base.chiSquare?.pass95;
      const baseMaxStd = maxAbsStdRes(base);
      const row: NonNullable<AdjustmentResult['suspectImpactDiagnostics']>[number] = {
        obsId: obs.id,
        type: obs.type,
        stations: observationStationsLabel(obs),
        sourceLine: obs.sourceLine,
        baseStdRes: obs.stdRes != null ? Math.abs(obs.stdRes) : undefined,
        baseLocalFail: hasLocalFailure(obs),
        chiDelta: '-',
        status: 'failed',
      };
      try {
        const altExclusions = new Set(baseExclusions);
        altExclusions.add(obs.id);
        const alt = solveCore(altExclusions, undefined, overrideValues, approvedClusterMerges, {
          stageId: 'suspect-impact',
          stageLabel: `Impact ${index + 1}/${candidateRows.length}`,
          solveTotalHint: 1 + candidateRows.length,
        });
        const altMaxStd = maxAbsStdRes(alt);
        const altChiPass = alt.chiSquare?.pass95;
        let chiDelta: typeof row.chiDelta = '-';
        if (baseChiPass != null && altChiPass != null) {
          chiDelta =
            !baseChiPass && altChiPass
              ? 'improved'
              : baseChiPass && !altChiPass
                ? 'degraded'
                : 'unchanged';
        }
        const deltaSeuw = alt.seuw - base.seuw;
        const deltaMaxStdRes = altMaxStd - baseMaxStd;
        const maxCoordShift = maxUnknownCoordinateShift(base, alt);
        let score = -deltaSeuw * 40 - deltaMaxStdRes * 20 - maxCoordShift * 15;
        if (chiDelta === 'improved') score += 20;
        if (chiDelta === 'degraded') score -= 20;
        return {
          ...row,
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
        return row;
      }
    })
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === 'ok' ? -1 : 1;
      const bScore = b.score ?? Number.NEGATIVE_INFINITY;
      const aScore = a.score ?? Number.NEGATIVE_INFINITY;
      if (bScore !== aScore) return bScore - aScore;
      return (b.baseStdRes ?? 0) - (a.baseStdRes ?? 0);
    });
