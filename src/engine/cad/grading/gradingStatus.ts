/**
 * Phase 20B — pure grading status derivation.
 *
 * Precedence (first match wins):
 *   BROKEN_REFERENCE > BUILDING > UNBUILT > SOURCE_NOT_CURRENT >
 *   NEEDS_RECALC > CURRENT.
 * FAILED is never derived here — only the build path sets it on error.
 */
import type { GradingStatus } from './gradingTypes';

export interface GradingStatusInput {
  courseResolved: boolean;
  targetCurrent: boolean;
  targetExists: boolean;
  sourceExists: boolean;
  hasResult: boolean;
  resultRevision: string | null;
  currentRevision: string;
  building: boolean;
}

export const deriveGradingStatus = (input: GradingStatusInput): GradingStatus => {
  if (!input.courseResolved || !input.targetExists || !input.sourceExists) {
    return 'BROKEN_REFERENCE';
  }
  if (input.building) return 'BUILDING';
  if (!input.hasResult) return 'UNBUILT';
  if (!input.targetCurrent) return 'SOURCE_NOT_CURRENT';
  if (input.resultRevision !== input.currentRevision) return 'NEEDS_RECALC';
  return 'CURRENT';
};

/** Session worker/agreement failure recorded by the build path. */
export interface GradingFailureDiagnostic {
  revision: string;
  error: string;
}

/**
 * Phase 20F.2 — shared session FAILED overlay for grading AND group rows.
 *
 * FAILED is never derived; it is a session overlay applied on top of the
 * frozen derivation. A worker/agreement diagnostic recorded for the CURRENT
 * revision replaces only UNBUILT / NEEDS_RECALC — so a retained result at an
 * older revision stays visible as stale evidence yet can no longer read
 * NEEDS_RECALC and hide the failure. Every other derived status keeps
 * precedence (BROKEN_REFERENCE / BUILDING / SOURCE_NOT_CURRENT / CURRENT), and
 * a diagnostic recorded for a different revision never poisons a new one.
 * Service and snapshot builders MUST route through this helper so they cannot
 * diverge.
 */
const FAILED_ELIGIBLE_STATUSES: ReadonlySet<string> = new Set(['UNBUILT', 'NEEDS_RECALC']);

export const deriveFailedEffectiveStatus = <T extends string>(
  derived: T,
  failure: GradingFailureDiagnostic | null | undefined,
  currentRevision: string,
): T => {
  if (!FAILED_ELIGIBLE_STATUSES.has(derived)) return derived;
  if (failure == null || failure.revision !== currentRevision) return derived;
  return 'FAILED' as T;
};
