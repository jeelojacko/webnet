/**
 * Phase 8A.6 session policy evaluator (TEST/EVIDENCE ONLY).
 *
 * Pure admission policy for production-shaped whole-session candidacy:
 * static eligibility, unknown-count cap with exact 127/128/129 boundary
 * behavior, planning-system (solve) cap with exact 63/64/65 boundary
 * behavior, physical validity, and the C3 hybrid sentinel. The
 * whole-session candidate is atomic: every planning system must pass or
 * the session falls back to TypeScript with a clean restart. Nothing in
 * production imports this module; caps mirror the proposed (not enforced)
 * Phase 8A.5 values.
 */

/** Proposed unknown cap (evidence only, not enforced in production). */
export const PHASE8A6_UNKNOWN_CAP = 128;

/** Proposed per-session planning-system cap (evidence only, not enforced). */
export const PHASE8A6_PLANNING_SYSTEM_CAP = 64;

export interface Phase8a6SystemVerdict {
  index: number;
  staticAdmit: boolean;
  physicalValid: boolean;
  sentinelPass: boolean;
  correctionPass: boolean;
}

export interface Phase8a6SessionDecision {
  admit: boolean;
  fallbackToTypeScript: boolean;
  reasons: string[];
}

/**
 * Evaluates one planning system against the session policy. Reason order
 * is fixed (unknown cap, system cap, static, physical, correction,
 * sentinel) so repeated evaluations are byte-identical.
 */
export const evaluatePhase8a6SystemPolicy = (args: {
  unknownCount: number;
  planningSystemCount: number;
  verdict: Phase8a6SystemVerdict;
}): Phase8a6SessionDecision => {
  const reasons: string[] = [];
  if (!Number.isInteger(args.unknownCount) || args.unknownCount <= 0) {
    reasons.push('unknown count is not a positive integer (fail-closed)');
  } else if (args.unknownCount > PHASE8A6_UNKNOWN_CAP) {
    reasons.push(
      `unknownCount ${args.unknownCount} exceeds cap ${PHASE8A6_UNKNOWN_CAP} (fail-closed)`,
    );
  }
  if (!Number.isInteger(args.planningSystemCount) || args.planningSystemCount <= 0) {
    reasons.push('planning system count is not a positive integer (fail-closed)');
  } else if (args.planningSystemCount > PHASE8A6_PLANNING_SYSTEM_CAP) {
    reasons.push(
      `planning systems ${args.planningSystemCount} exceed cap ${PHASE8A6_PLANNING_SYSTEM_CAP} (fail-closed)`,
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
export const evaluatePhase8a6WholeSession = (args: {
  unknownCount: number;
  systems: Phase8a6SystemVerdict[];
}): Phase8a6SessionDecision => {
  const reasons: string[] = [];
  if (args.systems.length === 0) {
    return {
      admit: false,
      fallbackToTypeScript: true,
      reasons: ['no planning systems captured (fail-closed)'],
    };
  }
  if (args.unknownCount > PHASE8A6_UNKNOWN_CAP) {
    reasons.push(`unknownCount ${args.unknownCount} exceeds cap ${PHASE8A6_UNKNOWN_CAP} (fail-closed)`);
  }
  if (args.systems.length > PHASE8A6_PLANNING_SYSTEM_CAP) {
    reasons.push(
      `planning systems ${args.systems.length} exceed cap ${PHASE8A6_PLANNING_SYSTEM_CAP} (fail-closed)`,
    );
  }
  for (const verdict of args.systems) {
    const single = evaluatePhase8a6SystemPolicy({
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
