/**
 * STRUCT-241.15 CAD geometry-edit command payload type leaf.
 *
 * Type-only module. It owns the seven inline geometry-edit command payload
 * variants, kept as a single publicly named union that mirrors its contiguous
 * position in the `CadCommand` union of `cadTransactions.types.ts`:
 *
 * `CadGeometryEditCommandPayload` sits immediately after the
 * `({ key: 'PROJECTTRANSFORM' })` member and immediately before the
 * `({ key: 'SHEET_ADD' })` member, in this order: EXTEND (1), FILLET (2),
 * PASTE (3), TRIM (4), INTERSECT_POINT (5), EDIT_ENTITY (6), and GRIP_EDIT (7).
 *
 * The group is extracted verbatim (key literals, field names, optionality,
 * property order, inline anonymous object/array shapes, the ordered nested
 * `edit` discriminant union, and whitespace unchanged) from the `CadCommand`
 * union in `cadTransactions.types.ts`. This shrinks the hub without changing
 * the command contract; these inline members were not a separate dependency
 * cycle, so no SCC reduction is claimed.
 *
 * Contract: type-only imports only. It imports the shared CAD id aliases from
 * the core primitive type leaf, the appearance alias from the entity foundation
 * leaf, and the grip handle kind from the grip/snap leaf. It must never import
 * a value, `cadTransactions.ts`, `cadTransactions.types.ts`, the sibling
 * planar leaf, or any barrel that cycles back, and it declares no runtime
 * exports.
 */

import type { CadEntityId, CadLayerId } from './cadCorePrimitiveTypes';
import type { CadEntityAppearance } from './cadEntityFoundationTypes';
import type { CadGripHandleKind } from './cadGripSnapTypes';

export type CadGeometryEditCommandPayload =
  | {
      key: 'EXTEND';
      boundaryEntityIds: CadEntityId[];
      targetEntityId: CadEntityId;
      targetPickPoint: { x: number; y: number };
      targetSegmentId?: string;
    }
  | {
      key: 'FILLET';
      radius: number;
      firstEntityId: CadEntityId;
      firstPickPoint: { x: number; y: number };
      firstSegmentId?: string;
      secondEntityId: CadEntityId;
      secondPickPoint: { x: number; y: number };
      secondSegmentId?: string;
    }
  | {
      key: 'PASTE';
      deltaX: number;
      deltaY: number;
      entityIds: CadEntityId[];
    }
  | {
      key: 'TRIM';
      cuttingEntityIds: CadEntityId[];
      targetEntityId: CadEntityId;
      pickPoint: { x: number; y: number };
      targetSegmentId?: string;
    }
  | {
      key: 'INTERSECT_POINT';
      x: number;
      y: number;
      label?: string;
      firstLabel: string;
      secondLabel: string;
    }
  | {
      key: 'EDIT_ENTITY';
      entityId: CadEntityId;
      edit:
        | { kind: 'entity-name'; value: string }
        | { kind: 'point-x'; value: number }
        | { kind: 'point-y'; value: number }
        | { kind: 'point-z'; value: number | null }
        | { kind: 'line-end'; toX: number; toY: number }
        | { kind: 'arc-radius'; value: number }
        | { kind: 'polyline-vertex'; vertexIndex: number; x: number; y: number }
        | { kind: 'polyline-vertices'; vertices: Array<{ vertexIndex: number; x: number; y: number }> }
        | { kind: 'entity-layer'; layerId: CadLayerId }
        | { kind: 'entity-appearance'; patch: CadEntityAppearance };
    }
  | {
      key: 'GRIP_EDIT';
      entityId: CadEntityId;
      gripKind: CadGripHandleKind;
      x: number;
      y: number;
      vertexIndex?: number;
    };
