/**
 * STRUCT-241.11 CAD annotation command payload type leaf.
 *
 * Type-only module. It owns the eleven annotation command payload variants,
 * kept as a single publicly named union that mirrors its contiguous position
 * in the `CadCommand` union of `cadTransactions.types.ts`:
 *
 * `CadAnnotationCommandPayload` sits immediately after
 * `CadBlockDefinitionCommandPayload` and immediately before the `// Phase 18U`
 * analysis group, in this order: CREATE_MTEXT (1), CREATE_LEADER (2),
 * CREATE_DIMENSION (3), CREATE_BEARING_LABEL (4), CREATE_CURVE_LABEL (5),
 * UPDATE_DIMENSION_PLACEMENT (6), REATTACH_ANNOTATION (7), SET_TEXT_OVERRIDE
 * (8), CLEAR_TEXT_OVERRIDE (9), SET_ANNOTATION_SCALE (10), and
 * ANNOTATION_COMMIT (11).
 *
 * The group is extracted verbatim (key literals, field names, optionality,
 * property order, and comments, including the two member JSDoc notes
 * unchanged) from the `CadCommand` union in `cadTransactions.types.ts`. This
 * shrinks the hub without changing the command contract; these inline members
 * were not a separate dependency cycle, so no SCC reduction is claimed.
 *
 * Contract: type-only imports only. It imports primitive identity aliases from
 * the zero-import core leaf, annotation entity/style types from the annotation
 * entity/style leaf, the low-level annotation anchor type leaf, and the
 * project type from the hub. It must never import a value, a command
 * definition, a runtime service, `cadTransactions.ts`,
 * `cadTransactions.types.ts`, or any barrel that cycles back, and it declares
 * no runtime exports.
 */

import type { CadEntityId, CadTextStyleId } from './cadCorePrimitiveTypes';
import type { CadMTextAttachment, CadDimensionKind } from './cadAnnotationEntityStyleTypes';
import type { CadAnnotationAnchor } from './annotation/cadAnnotationAnchorTypes';
import type { CadProject } from './cadTypes';

export type CadAnnotationCommandPayload =
  | {
      key: 'CREATE_MTEXT';
      x: number;
      y: number;
      text: string;
      textStyleId?: CadTextStyleId;
      rotationDeg?: number;
      attachment?: CadMTextAttachment;
    }
  | {
      key: 'CREATE_LEADER';
      arrowAnchor: CadAnnotationAnchor;
      vertices: { x: number; y: number }[];
      text: string;
      leaderStyleId?: string;
      textStyleId?: CadTextStyleId;
      textAttachment?: CadMTextAttachment;
    }
  | {
      key: 'CREATE_DIMENSION';
      dimensionKind: CadDimensionKind;
      anchors: CadAnnotationAnchor[];
      orientation?: 'horizontal' | 'vertical' | 'aligned';
      dimLinePoint: { x: number; y: number };
      textPoint?: { x: number; y: number };
      dimensionStyleId?: string;
      textOverride?: string;
    }
  | {
      key: 'CREATE_BEARING_LABEL';
      sourceEntityId: CadEntityId;
      labelStyleId?: string;
      offset?: { x: number; y: number };
      side?: 'left' | 'right' | 'auto';
      manualTextOverride?: string;
    }
  | {
      key: 'CREATE_CURVE_LABEL';
      sourceEntityId: CadEntityId;
      labelStyleId?: string;
      offset?: { x: number; y: number };
      manualTextOverride?: string;
    }
  | {
      key: 'UPDATE_DIMENSION_PLACEMENT';
      entityId: CadEntityId;
      dimLinePoint?: { x: number; y: number };
      textPoint?: { x: number; y: number } | null;
    }
  | {
      key: 'REATTACH_ANNOTATION';
      entityId: CadEntityId;
      slot: 'leader-arrow' | 'dimension-anchor' | 'dimension-def-point-1' | 'dimension-def-point-2';
      index?: number;
      /** Omitted = convert the slot to a frozen point at its resolved position. */
      anchor?: CadAnnotationAnchor;
    }
  | {
      key: 'SET_TEXT_OVERRIDE';
      entityId: CadEntityId;
      text: string;
    }
  | {
      key: 'CLEAR_TEXT_OVERRIDE';
      entityId: CadEntityId;
    }
  | {
      key: 'SET_ANNOTATION_SCALE';
      scaleDenominator: number;
    }
  | {
      key: 'ANNOTATION_COMMIT';
      /** Validated project from the annotation UI op applier (hook-owned). */
      project: CadProject;
      label: string;
    };
