/**
 * STRUCT-195.6 CAD grading command payload type leaf.
 *
 * Type-only module. It owns the six grading command payload variants
 * (GRADING_CREATE, GRADING_DELETE, GRADING_EDIT_CRITERIA,
 * GRADING_REASSIGN_TARGET, GRADINGEXTRACTDAYLIGHT, GRADINGBAKE) extracted
 * verbatim (key literals, field names, optionality, ordering, and comments
 * unchanged) from the `CadCommand` union in `cadTransactions.types.ts`. This
 * shrinks the hub without changing the command contract; these inline members
 * were not a separate dependency cycle, so no SCC reduction is claimed.
 *
 * Contract: type-only imports only. It imports the grading domain types from
 * `./grading/gradingTypes` and the primitive identity alias from the
 * zero-import core leaf; it must never import a value, a command definition, a
 * runtime service, `cadTransactions.ts`, `cadTransactions.types.ts`, or any
 * barrel that cycles back, and it declares no runtime exports.
 */

import type { CadLayerId } from './cadCorePrimitiveTypes';
import type { CadGradingResult, GradingCriterion, GradingSide } from './grading/gradingTypes';

export type CadGradingCommandPayload =
  | {
      key: 'GRADING_CREATE';
      name?: string;
      sourceFeatureLineId: string;
      vertexAId: string;
      vertexBId: string;
      /** Required for fixed/cut-fill; omitted for distance/elevation. */
      targetSurfaceId?: string;
      side: GradingSide | 'both';
      criterion: GradingCriterion;
      maxSearchDistance: number;
      curveChordTolerance: number;
      layerId?: CadLayerId;
    }
  | {
      key: 'GRADING_DELETE';
      gradingId: string;
    }
  | {
      key: 'GRADING_EDIT_CRITERIA';
      gradingId: string;
      criterion: GradingCriterion;
      /**
       * Phase 20F: kind-conditional target in the SAME undo entry. A non-empty
       * id adds/replaces the target for a surface criterion; null clears it.
       * Analytic criteria always clear the stored id.
       */
      targetSurfaceId?: string | null;
    }
  | {
      key: 'GRADING_REASSIGN_TARGET';
      gradingId: string;
      targetSurfaceId: string;
    }
  | {
      key: 'GRADINGEXTRACTDAYLIGHT';
      gradingId: string;
      /** Cached CURRENT result snapshot (never recomputed here). */
      result: CadGradingResult;
      expectedRevision: string;
      sessionCurrent?: boolean;
    }
  | {
      key: 'GRADINGBAKE';
      gradingId: string;
      /** Cached CURRENT result snapshot (never recomputed here). */
      result: CadGradingResult;
      expectedRevision: string;
      sessionCurrent?: boolean;
    };
