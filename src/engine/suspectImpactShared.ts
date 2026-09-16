/**
 * Phase 14D: shared pure helpers for leave-one-out suspect-impact analysis.
 *
 * Single home for candidate collection/ranking, local-failure semantics,
 * chi-delta derivation, coordinate-shift detail, aborted-solve detection,
 * the transparent row-sort comparator, and the alternate-result cache-key
 * builder. The session path (`runSessionSuspectImpact`) builds rows through
 * `buildSuspectImpactRows` here; `autoAdjust` reuses the identical pure
 * scalar helpers only.
 *
 * Pure module: no solve invocations except through the caller-supplied
 * `solveAlt` callback. Units are meters/radians internally; station and
 * observation ids keep their existing types.
 */
import { isFreeNetworkDatum } from './adjustExternalReliability';
import type { AdjustmentResult } from '../typesAdjustmentResult';
import type { Observation, SuspectImpactMode } from '../types';
import type {
  SuspectImpactAnalysisMode,
  SuspectImpactChiSummary,
  SuspectImpactFailureReason,
  SuspectImpactRow,
  SuspectImpactStationShift,
} from '../typesAdjustmentResult';

export const SUSPECT_IMPACT_MAX_CANDIDATES = 3;
export const SUSPECT_IMPACT_AUTO_SKIP_MAIN_SOLVE_MS = 5000;
/**
 * Suspect gate: local-FAIL OR |StdRes| >= 2. The literal 2 mirrors the
 * review-queue suspect convention (|StdRes| >= 2 in qaWorkflowSnapshots).
 */
export const SUSPECT_IMPACT_STDRES_THRESHOLD = 2;

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

export interface RankedSuspect {
  rank: number;
  obsId: number;
  type: Observation['type'];
  stations: string;
  sourceLine?: number;
  stdRes?: number;
  localFail: boolean;
}

export const observationStationsLabel = (obs: Observation): string => {
  if ('at' in obs && 'from' in obs && 'to' in obs) return `${obs.at}-${obs.from}-${obs.to}`;
  if ('at' in obs && 'to' in obs) return `${obs.at}-${obs.to}`;
  if ('from' in obs && 'to' in obs) return `${obs.from}-${obs.to}`;
  return '-';
};

/** Phase 14A null semantics: only an explicit `pass === false` counts. */
export const hasLocalFailure = (obs: Observation): boolean => {
  if (obs.localTestComponents) {
    return obs.localTestComponents.passE === false || obs.localTestComponents.passN === false;
  }
  if (obs.localTest) return obs.localTest.pass === false;
  return false;
};

export const maxAbsStdRes = (res: AdjustmentResult): number =>
  res.observations.reduce((maxValue, obs) => {
    if (!Number.isFinite(obs.stdRes)) return maxValue;
    return Math.max(maxValue, Math.abs(obs.stdRes ?? 0));
  }, 0);

/** Zero/unavailable local tests are never counted (pass === false only). */
export const countLocalFailures = (res: AdjustmentResult): number =>
  res.observations.reduce((count, obs) => count + (hasLocalFailure(obs) ? 1 : 0), 0);

const compareCandidates = (a: Observation, b: Observation): number => {
  const failDiff = Number(hasLocalFailure(b)) - Number(hasLocalFailure(a));
  if (failDiff !== 0) return failDiff;
  const stdDiff = Math.abs(b.stdRes ?? 0) - Math.abs(a.stdRes ?? 0);
  if (stdDiff !== 0) return stdDiff;
  return a.id - b.id;
};

export const collectSuspectImpactCandidates = (
  base: AdjustmentResult,
  limit = SUSPECT_IMPACT_MAX_CANDIDATES,
): Observation[] =>
  [...base.observations]
    .filter((obs) => Number.isFinite(obs.stdRes))
    .filter((obs) => hasLocalFailure(obs) || Math.abs(obs.stdRes ?? 0) >= SUSPECT_IMPACT_STDRES_THRESHOLD)
    .sort(compareCandidates)
    .slice(0, limit);

export const rankedSuspects = (res: AdjustmentResult, limit = 10): RankedSuspect[] =>
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
      const failDiff = Number(b.localFail) - Number(a.localFail);
      if (failDiff !== 0) return failDiff;
      const stdDiff = (b.stdRes ?? 0) - (a.stdRes ?? 0);
      if (stdDiff !== 0) return stdDiff;
      return a.obsId - b.obsId;
    })
    .slice(0, limit)
    .map((row, index) => ({ ...row, rank: index + 1 }));

export type SuspectChiDelta = SuspectImpactRow['chiDelta'];

export const chiDeltaFromPass = (
  basePass: boolean | undefined,
  altPass: boolean | undefined,
): SuspectChiDelta => {
  if (basePass == null || altPass == null) return '-';
  if (!basePass && altPass) return 'improved';
  if (basePass && !altPass) return 'degraded';
  return 'unchanged';
};

export const chiSummaryOf = (res: AdjustmentResult): SuspectImpactChiSummary | undefined =>
  res.chiSquare == null
    ? undefined
    : { T: res.chiSquare.T, dof: res.chiSquare.dof, p: res.chiSquare.p, pass: res.chiSquare.pass95 };

const altLogsMentionSingular = (alt: AdjustmentResult): boolean =>
  alt.logs.some((line) => /singular/i.test(line));

/**
 * Fail-closed classification of an alternate (exclusion) solve. An
 * aborted-but-returned solve (non-converged, non-positive DOF, zero SEUW
 * against a non-zero base, or missing chi-square where DOF > 0 expects
 * one) is never scored as an improvement.
 */
export const classifyAltSolve = (
  alt: AdjustmentResult,
  base: AdjustmentResult,
): SuspectImpactFailureReason => {
  if (!alt.success || !alt.converged) {
    if (altLogsMentionSingular(alt)) return 'singular';
    if (alt.dof <= 0) return 'insufficient-observations';
    return 'solver-failed';
  }
  if (alt.dof <= 0) return 'insufficient-observations';
  if (!alt.preanalysisMode) {
    if (alt.dof > 0 && alt.chiSquare == null) return 'solver-failed';
    // A zero SEUW against a non-zero base signals an aborted/stale solve
    // ONLY when it is internally inconsistent (non-zero residuals or
    // chi-square). A coherent perfect fit (all-zero residuals, T == 0) is
    // the ideal exclusion outcome, not an abort, and stays 'none'.
    if (alt.seuw === 0 && base.seuw > 0) {
      const perfectFit =
        maxAbsStdRes(alt) === 0 && (alt.chiSquare?.T ?? 0) === 0;
      if (!perfectFit) return 'solver-failed';
    }
  }
  return 'none';
};

export const classifyAltError = (error: unknown): SuspectImpactFailureReason => {
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (/singular/i.test(message)) return 'singular';
  return 'solver-failed';
};

const compareStationIds = (a: string, b: string): number => {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
};

/**
 * Per-station coordinate shifts (base vs alt). Fixed stations contribute
 * exactly 0 and are skipped (existing behavior); deterministic order by
 * mag3d desc then station id asc.
 */
export const computeShiftDetail = (
  base: AdjustmentResult,
  alt: AdjustmentResult,
  topN = 5,
): { most: SuspectImpactStationShift | null; top: SuspectImpactStationShift[] } => {
  const rows: SuspectImpactStationShift[] = [];
  Object.entries(base.stations).forEach(([id, station]) => {
    if (station.fixed) return;
    const altStation = alt.stations[id];
    if (!altStation) return;
    const dE = altStation.x - station.x;
    const dN = altStation.y - station.y;
    const dH = altStation.h - station.h;
    const horiz = Math.hypot(dE, dN);
    const vert = Math.abs(dH);
    rows.push({ id, dE, dN, dH, horiz, vert, mag3d: Math.hypot(horiz, dH) });
  });
  rows.sort((a, b) => b.mag3d - a.mag3d || compareStationIds(a.id, b.id));
  const top = rows.slice(0, topN);
  return { most: top[0] ?? null, top };
};

/** Option C fail-closed: free-network datum => shifts unavailable, stats kept. */
export const isFreeNetworkShiftUnavailable = (base: AdjustmentResult): boolean =>
  isFreeNetworkDatum({
    stations: base.stations,
    constraintCount: base.controlConstraints?.count ?? 0,
  });

const chiRank = (chiDelta: SuspectChiDelta): number =>
  chiDelta === 'improved' ? 0 : chiDelta === 'unchanged' ? 1 : chiDelta === '-' ? 2 : 3;

const rowShift = (row: SuspectImpactRow): number =>
  row.mostAffectedStation?.mag3d ?? row.maxCoordShift ?? 0;

/**
 * Transparent row ordering (no SEUW-delta ranking): status ok first,
 * base local-FAIL first, base |StdRes| desc, chi FAIL->PASS first,
 * local-fail reduction desc, max shift desc, obsId asc tie-break.
 */
export const compareSuspectImpactRows = (
  a: SuspectImpactRow,
  b: SuspectImpactRow,
): number => {
  if (a.status !== b.status) return a.status === 'ok' ? -1 : 1;
  const failDiff = Number(b.baseLocalFail) - Number(a.baseLocalFail);
  if (failDiff !== 0) return failDiff;
  const stdDiff = (b.baseStdRes ?? 0) - (a.baseStdRes ?? 0);
  if (stdDiff !== 0) return stdDiff;
  const chiDiff = chiRank(a.chiDelta) - chiRank(b.chiDelta);
  if (chiDiff !== 0) return chiDiff;
  const reductionDiff =
    (b.baseLocalFails ?? 0) - (b.altLocalFails ?? 0) - ((a.baseLocalFails ?? 0) - (a.altLocalFails ?? 0));
  if (reductionDiff !== 0) return reductionDiff;
  const shiftDiff = rowShift(b) - rowShift(a);
  if (shiftDiff !== 0) return shiftDiff;
  return a.obsId - b.obsId;
};

export interface SuspectImpactBuildOptions {
  base: AdjustmentResult;
  candidates: Observation[];
  baseExclusions: Set<number>;
  analysisMode: SuspectImpactAnalysisMode;
  robustReSolve: boolean;
  solveAlt: (
    _exclusions: Set<number>,
    _meta: { index: number; total: number },
  ) => AdjustmentResult;
}

/**
 * Shared leave-one-out row builder. Each candidate is re-solved with the
 * candidate excluded; aborted alternates are marked failed (never ranked
 * as improvements). Row order is the transparent `compareSuspectImpactRows`
 * hierarchy; there is no heuristic score.
 */
export const buildSuspectImpactRows = ({
  base,
  candidates,
  baseExclusions,
  analysisMode,
  robustReSolve,
  solveAlt,
}: SuspectImpactBuildOptions): SuspectImpactRow[] => {
  const baseChiPass = base.chiSquare?.pass95;
  const baseMaxStd = maxAbsStdRes(base);
  const baseLocalFails = countLocalFailures(base);
  const baseChi = chiSummaryOf(base);
  const shiftUnavailable = isFreeNetworkShiftUnavailable(base);
  const rows = candidates.map((obs, index): SuspectImpactRow => {
    const startedAt = Date.now();
    const row: SuspectImpactRow = {
      obsId: obs.id,
      type: obs.type,
      stations: observationStationsLabel(obs),
      sourceLine: obs.sourceLine,
      baseStdRes: obs.stdRes != null ? Math.abs(obs.stdRes) : undefined,
      baseLocalFail: hasLocalFailure(obs),
      baseSeuw: base.seuw,
      baseMaxStdRes: baseMaxStd,
      baseChi,
      baseLocalFails,
      baseDof: base.dof,
      baseObsCount: base.observations.length,
      baseChiPass,
      chiDelta: '-',
      status: 'failed',
      failureReason: 'unknown',
      analysisMode,
      robustReSolve,
      shiftStatus: shiftUnavailable ? 'free-network-unavailable' : 'available',
      mostAffectedStation: null,
      topAffectedStations: [],
    };
    try {
      const altExclusions = new Set(baseExclusions);
      altExclusions.add(obs.id);
      const alt = solveAlt(altExclusions, { index, total: candidates.length });
      const failureReason = classifyAltSolve(alt, base);
      const elapsedMs = Date.now() - startedAt;
      if (failureReason !== 'none') {
        return {
          ...row,
          failureReason,
          elapsedMs,
          altDof: alt.dof,
          altObsCount: alt.observations.length,
        };
      }
      const altMaxStd = maxAbsStdRes(alt);
      const altChiPass = alt.chiSquare?.pass95;
      const chiDelta = chiDeltaFromPass(baseChiPass, altChiPass);
      const deltaSeuw = alt.seuw - base.seuw;
      const deltaMaxStdRes = altMaxStd - baseMaxStd;
      const shift = shiftUnavailable ? { most: null, top: [] } : computeShiftDetail(base, alt);
      const maxCoordShift = shift.most?.mag3d ?? 0;
      return {
        ...row,
        deltaSeuw,
        altSeuw: alt.seuw,
        deltaMaxStdRes,
        altMaxStdRes: altMaxStd,
        baseChiPass,
        altChiPass,
        altChi: chiSummaryOf(alt),
        chiDelta,
        altLocalFails: countLocalFailures(alt),
        altDof: alt.dof,
        altObsCount: alt.observations.length,
        mostAffectedStation: shift.most,
        topAffectedStations: shift.top,
        maxCoordShift,
        status: 'ok',
        failureReason: 'none',
        elapsedMs,
      };
    } catch (error) {
      return { ...row, failureReason: classifyAltError(error), elapsedMs: Date.now() - startedAt };
    }
  });
  rows.sort(compareSuspectImpactRows);
  return rows;
};

const stableStringify = (value: unknown): string => {
  if (value instanceof Set) {
    return `set:[${[...value].map(stableStringify).sort().join(',')}]`;
  }
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
};

export interface SuspectImpactCacheKeyInput {
  baseFingerprint: string;
  obsId: number;
  exclusions: Set<number> | number[];
  overrides: unknown;
  solveSettings: unknown;
  clusterMerges: unknown;
}

/**
 * Minimal alternate-result cache key: base run fingerprint + obsId +
 * exclusions + overrides + solve settings + cluster merges. Any change to
 * exclusions or settings changes the key (tested); no stateful cache lives
 * here — callers own storage and invalidation against this key.
 */
export const buildSuspectImpactCacheKey = (input: SuspectImpactCacheKeyInput): string =>
  stableStringify({
    base: input.baseFingerprint,
    obs: input.obsId,
    excl: [...input.exclusions].map(Number).sort((a, b) => a - b),
    ovr: input.overrides,
    settings: input.solveSettings,
    merges: input.clusterMerges,
  });
