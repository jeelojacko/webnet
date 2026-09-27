/**
 * Phase 20C Wave-1B — pure grading-group status derivation.
 *
 * Same precedence as the frozen 20B status rule (first match wins):
 *   BROKEN_REFERENCE > BUILDING > UNBUILT > SOURCE_NOT_CURRENT >
 *   NEEDS_RECALC > CURRENT.
 * FAILED is never derived here — only the build path sets it on error.
 */
import type { GroupStatus } from './gradingGroupTypes';

export interface GroupStatusInput {
  /** Any member course failed to resolve / target or source is missing. */
  brokenRef: boolean;
  building: boolean;
  hasResult: boolean;
  /** Result was calculated against the current target source revision. */
  sourceCurrent: boolean;
  /** Content revision moved (source edit, target rebuild, definition edit). */
  needsRecalc: boolean;
}

export const deriveGroupStatus = (input: GroupStatusInput): GroupStatus => {
  if (input.brokenRef) return 'BROKEN_REFERENCE';
  if (input.building) return 'BUILDING';
  if (!input.hasResult) return 'UNBUILT';
  if (!input.sourceCurrent) return 'SOURCE_NOT_CURRENT';
  if (input.needsRecalc) return 'NEEDS_RECALC';
  return 'CURRENT';
};
