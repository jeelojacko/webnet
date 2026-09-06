/**
 * Phase 8A.7 production-safe session policy evaluator.
 *
 * Pure admission policy for whole-session candidacy: static eligibility, unknown-count cap with exact 127/128/129 boundary behavior, planning-system (solve) cap with exact 63/64/65 boundary behavior, physical validity, and the C3 hybrid sentinel. The whole-session candidate is atomic: every planning system must pass or the session falls back to TypeScript with a clean restart. Production-safe: no test/script imports; caps are enforced by the production route.
 */

/** Enforced unknown cap for the production preanalysis sparse route. */
export const PREANALYSIS_SPARSE_UNKNOWN_CAP = 128;

/** Enforced per-session planning-system cap for the production preanalysis sparse route. */
export const PREANALYSIS_SPARSE_PLANNING_SYSTEM_CAP = 64;

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
}): PreanalysisSparseSessionDecision => {
  const reasons: string[] = [];
  if (!Number.isInteger(args.unknownCount) || args.unknownCount <= 0) {
    reasons.push('unknown count is not a positive integer (fail-closed)');
  } else if (args.unknownCount > PREANALYSIS_SPARSE_UNKNOWN_CAP) {
    reasons.push(
      `unknownCount ${args.unknownCount} exceeds cap ${PREANALYSIS_SPARSE_UNKNOWN_CAP} (fail-closed)`,
    );
  }
  if (!Number.isInteger(args.planningSystemCount) || args.planningSystemCount <= 0) {
    reasons.push('planning system count is not a positive integer (fail-closed)');
  } else if (args.planningSystemCount > PREANALYSIS_SPARSE_PLANNING_SYSTEM_CAP) {
    reasons.push(
      `planning systems ${args.planningSystemCount} exceed cap ${PREANALYSIS_SPARSE_PLANNING_SYSTEM_CAP} (fail-closed)`,
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
}): PreanalysisSparseSessionDecision => {
  const reasons: string[] = [];
  if (args.systems.length === 0) {
    return {
      admit: false,
      fallbackToTypeScript: true,
      reasons: ['no planning systems captured (fail-closed)'],
    };
  }
  if (args.unknownCount > PREANALYSIS_SPARSE_UNKNOWN_CAP) {
    reasons.push(`unknownCount ${args.unknownCount} exceeds cap ${PREANALYSIS_SPARSE_UNKNOWN_CAP} (fail-closed)`);
  }
  if (args.systems.length > PREANALYSIS_SPARSE_PLANNING_SYSTEM_CAP) {
    reasons.push(
      `planning systems ${args.systems.length} exceed cap ${PREANALYSIS_SPARSE_PLANNING_SYSTEM_CAP} (fail-closed)`,
    );
  }
  for (const verdict of args.systems) {
    const single = evaluatePreanalysisSparseSystemPolicy({
      unknownCount: args.unknownCount,
      planningSystemCount: args.systems.length,
      verdict,
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
