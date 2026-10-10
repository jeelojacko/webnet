/**
 * STRUCT-195.6 CAD grading-group command payload type leaf.
 *
 * Type-only module. It owns the thirteen Phase 20C grading-group command
 * payload variants (GROUP_CREATE through GROUPBAKE) extracted verbatim (key
 * literals, field names, optionality, `| null` markers, `readonly` modifiers,
 * ordering, and comments unchanged) from the `CadCommand` union in
 * `cadTransactions.types.ts`. This shrinks the hub without changing the
 * command contract; these inline members were not a separate dependency
 * cycle, so no SCC reduction is claimed.
 *
 * Contract: type-only imports only. It imports the grading identity/value
 * types from the grading leaves and the layer identity alias from the
 * zero-import core primitive leaf; it must never import a value, a command
 * definition, a runtime service, `cadTransactions.ts`, `cadTransactions.types.ts`,
 * or any barrel that cycles back, and it declares no runtime exports.
 */

import type { CadLayerId } from './cadCorePrimitiveTypes';
import type { GradingCriterion, GradingSide } from './grading/gradingTypes';
import type {
  CadGradingGroupResult,
  GradingGroupCourse,
  GradingGroupCourseCriterionOverride,
} from './grading/gradingGroupTypes';

export type CadGradingGroupCommandPayload =
  // Phase 20C — grading groups (single side only; definitions + snapshots).
  | {
      key: 'GROUP_CREATE';
      name?: string;
      sourceFeatureLineId: string;
      sourceCourses: GradingGroupCourse[];
      /** Required for surface-family criteria; omitted for distance/elevation. */
      targetSurfaceId?: string;
      side: GradingSide;
      criterion: GradingCriterion;
      maxSearchDistance: number;
      curveChordTolerance: number;
      cornerMode?: 'miter';
      closed?: boolean;
      layerId?: CadLayerId;
      /** Phase 20E sparse per-course overrides (validated on create). */
      courseCriteria?: GradingGroupCourseCriterionOverride[];
    }
  | {
      key: 'GROUP_DELETE';
      groupId: string;
    }
  | {
      key: 'GROUP_EDIT_CRITERIA';
      groupId: string;
      criterion?: GradingCriterion;
      /** Phase 20F: kind-conditional target in the SAME undo entry (null clears). */
      targetSurfaceId?: string | null;
      maxSearchDistance?: number;
      curveChordTolerance?: number;
    }
  | {
      key: 'GROUP_REASSIGN_TARGET';
      groupId: string;
      targetSurfaceId: string;
    }
  | {
      key: 'GROUP_EDIT_SPAN';
      groupId: string;
      sourceCourses: GradingGroupCourse[];
      closed?: boolean;
    }
  | {
      key: 'GROUP_ADD_COURSE';
      groupId: string;
      course: GradingGroupCourse;
    }
  | {
      key: 'GROUP_REMOVE_END_COURSE';
      groupId: string;
      which: 'first' | 'last';
    }
  | {
      key: 'GROUP_SET_COURSE_CRITERIA';
      groupId: string;
      /** One undo step applies `criterion` to every named course. */
      courses: GradingGroupCourse[];
      criterion: GradingCriterion;
      /**
       * Phase 20J: criterion+target in the SAME undo entry. A non-empty id
       * assigns the live target (must exist); null clears (all-analytic
       * results only); omitted keeps the retained target. A
       * surface-effective result with no live target rejects (never a
       * silent first-surface pick). Rejected ops mutate nothing.
       */
      targetSurfaceId?: string | null;
    }
  | {
      key: 'GROUP_RESET_COURSE_CRITERIA';
      groupId: string;
      courses: GradingGroupCourse[];
      /** Phase 20J: same atomic target rule as GROUP_SET_COURSE_CRITERIA. */
      targetSurfaceId?: string | null;
    }
  | {
      key: 'GROUP_SET_TRANSITION';
      groupId: string;
      /** One explicit transition intent (width/law user-owned, refs stable). */
      intent: {
        policyVersion: string;
        jointId: string;
        memberIds: readonly string[];
        width: number;
        lawKind: string;
        lawVersion: string;
        criterionFamily: string;
        side: string;
      };
    }
  | {
      key: 'GROUP_CLEAR_TRANSITION';
      groupId: string;
      /** Named joint only; omitted clears every transition (legacy callers). */
      jointId?: string;
    }
  | {
      key: 'GROUPEXTRACTDAYLIGHT';
      groupId: string;
      /** Cached CURRENT result snapshot (never recomputed here). */
      result: CadGradingGroupResult;
      expectedRevision: string;
      sessionCurrent?: boolean;
    }
  | {
      key: 'GROUPBAKE';
      groupId: string;
      /** Cached CURRENT result snapshot (never recomputed here). */
      result: CadGradingGroupResult;
      expectedRevision: string;
      sessionCurrent?: boolean;
    };
