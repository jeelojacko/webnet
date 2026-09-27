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
