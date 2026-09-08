/**
 * Phase 8A.7 production-safe session policy evaluator.
 *
 * Pure admission policy for whole-session candidacy: static eligibility, unknown-count cap with exact 127/128/129 boundary behavior, planning-system (solve) cap with exact 63/64/65 boundary behavior, physical validity, and the C3 hybrid sentinel. The whole-session candidate is atomic: every planning system must pass or the session falls back to TypeScript with a clean restart. Production-safe: no test/script imports; caps are enforced by the production route.
 */

/** Enforced static station-unknown cap for the production sparse route. */
export const PREANALYSIS_SPARSE_STATION_UNKNOWN_CAP = 128;

/** Enforced runtime per-system parameter cap for the production sparse route. */
export const PREANALYSIS_SPARSE_PARAMETER_CAP = 256;

/** Enforced per-session planning-system cap for the production sparse route. */
export const PREANALYSIS_SPARSE_PLANNING_SYSTEM_CAP = 64;

/** @deprecated Station-unknown cap only; never use for runtime parameter gates. */
export const PREANALYSIS_SPARSE_UNKNOWN_CAP = PREANALYSIS_SPARSE_STATION_UNKNOWN_CAP;

/**
 * Test-only cap overrides (evidence runs only; production always omits this).
 *
 * `unknownCap` widens the static station-unknown gate and the whole-session
 * unknown check; `planningSystemCap` widens the whole-session system-count
 * check. Runtime per-system parameterCount caps travel separately through
 * `PreanalysisGateCaps.maxParameters` in the route. Omitted fields fall back
 * to the production constants above, so default behavior is byte-identical.
 */
export interface PreanalysisSparsePolicyCapOverrides {
  unknownCap?: number;
  planningSystemCap?: number;
}

export interface PreanalysisSparseSystemVerdict {
  index: number;
  staticAdmit: boolean;
  physicalValid: boolean;
  sentinelPass: boolean;
  correctionPass: boolean;
}

export interface PreanalysisSparseSessionDecision {
  admit: boolean;
  fallbackToTypeScript: boolean;
  reasons: string[];
}

/**
 * Evaluates one planning system against the session policy. Reason order
 * is fixed (unknown cap, system cap, static, physical, correction,
 * sentinel) so repeated evaluations are byte-identical.
 */
export const evaluatePreanalysisSparseSystemPolicy = (args: {
  unknownCount: number;
  planningSystemCount: number;
  verdict: PreanalysisSparseSystemVerdict;
  capOverrides?: PreanalysisSparsePolicyCapOverrides;
}): PreanalysisSparseSessionDecision => {
  const unknownCap = args.capOverrides?.unknownCap ?? PREANALYSIS_SPARSE_STATION_UNKNOWN_CAP;
  const planningSystemCap =
    args.capOverrides?.planningSystemCap ?? PREANALYSIS_SPARSE_PLANNING_SYSTEM_CAP;
  const reasons: string[] = [];
  if (!Number.isInteger(args.unknownCount) || args.unknownCount <= 0) {
    reasons.push('unknown count is not a positive integer (fail-closed)');
  } else if (args.unknownCount > unknownCap) {
    reasons.push(
      `unknownCount ${args.unknownCount} exceeds cap ${unknownCap} (fail-closed)`,
    );
  }
  if (!Number.isInteger(args.planningSystemCount) || args.planningSystemCount <= 0) {
    reasons.push('planning system count is not a positive integer (fail-closed)');
  } else if (args.planningSystemCount > planningSystemCap) {
    reasons.push(
      `planning systems ${args.planningSystemCount} exceed cap ${planningSystemCap} (fail-closed)`,
    );
  }
  if (!args.verdict.staticAdmit) reasons.push(`system ${args.verdict.index}: static gate rejects`);
  if (!args.verdict.physicalValid) reasons.push(`system ${args.verdict.index}: physical validity fails`);
  if (!args.verdict.correctionPass) reasons.push(`system ${args.verdict.index}: correction oracle fails`);
  if (!args.verdict.sentinelPass) reasons.push(`system ${args.verdict.index}: C3 sentinel fails`);
  const admit = reasons.length === 0;
  return { admit, fallbackToTypeScript: !admit, reasons };
};

/**
 * Atomic whole-session decision: the candidate session is admitted only
 * when every planning system is admitted. Any single failure falls back
 * to the TypeScript restart path (clean rerun, no partial sparse state).
 */
export const evaluatePreanalysisSparseWholeSession = (args: {
  unknownCount: number;
  systems: PreanalysisSparseSystemVerdict[];
  capOverrides?: PreanalysisSparsePolicyCapOverrides;
}): PreanalysisSparseSessionDecision => {
  const unknownCap = args.capOverrides?.unknownCap ?? PREANALYSIS_SPARSE_STATION_UNKNOWN_CAP;
  const planningSystemCap =
    args.capOverrides?.planningSystemCap ?? PREANALYSIS_SPARSE_PLANNING_SYSTEM_CAP;
  const reasons: string[] = [];
  if (args.systems.length === 0) {
    return {
      admit: false,
      fallbackToTypeScript: true,
      reasons: ['no planning systems captured (fail-closed)'],
    };
  }
  if (args.unknownCount > unknownCap) {
    reasons.push(`unknownCount ${args.unknownCount} exceeds cap ${unknownCap} (fail-closed)`);
  }
  if (args.systems.length > planningSystemCap) {
    reasons.push(
      `planning systems ${args.systems.length} exceed cap ${planningSystemCap} (fail-closed)`,
    );
  }
  for (const verdict of args.systems) {
    const single = evaluatePreanalysisSparseSystemPolicy({
      unknownCount: args.unknownCount,
      planningSystemCount: args.systems.length,
      verdict,
      capOverrides: args.capOverrides,
    });
    if (!single.admit) {
      reasons.push(...single.reasons);
    }
  }
  if (reasons.length > 0) {
    return {
      admit: false,
      fallbackToTypeScript: true,
      reasons: ['atomic session fallback: at least one system failed', ...reasons.slice(0, 7)],
    };
  }
  return { admit: true, fallbackToTypeScript: false, reasons: [] };
};
