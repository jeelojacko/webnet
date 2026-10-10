/**
 * STRUCT-241.1 CAD survey command payload type leaf.
 *
 * Type-only module. It owns the sixteen survey command payload variants —
 * SURVEY_POINT_OVERRIDE (1), SURVEY_STYLE_TABLE for the point and label
 * tables (create/duplicate/rename/update/delete, 10 total), and
 * SURVEY_GROUP_TABLE (create/rename/update/move/delete, 5) — extracted
 * verbatim (key literals, table/op discriminants, field names, optionality,
 * property order, and comments unchanged) from the `CadCommand` union in
 * `cadTransactions.types.ts`. This shrinks the hub without changing the
 * command contract; these inline members were not a separate dependency
 * cycle, so no SCC reduction is claimed.
 *
 * Repeated-key design note: the ten SURVEY_STYLE_TABLE variants and the five
 * SURVEY_GROUP_TABLE variants intentionally reuse the same `key` literal; the
 * `table`/`op` discriminant pair (or `op` alone for group) disambiguates them.
 * They must never be collapsed into a single key-only shape — each keeps its
 * own required fields, nullable style ids, optional query/description, and
 * `Partial<>` patches.
 *
 * Contract: type-only imports only. It imports the survey domain types from
 * `./cadTypes` and the primitive identity alias from the zero-import core
 * leaf; it must never import a value, a command definition, a runtime
 * service, `cadTransactions.ts`, `cadTransactions.types.ts`, or any barrel
 * that cycles back, and it declares no runtime exports.
 */

import type { CadEntityId } from './cadCorePrimitiveTypes';
import type {
  CadPointGroup,
  CadPointGroupId,
  CadPointGroupQuery,
  CadPointLabelStyle,
  CadPointLabelStyleId,
  CadPointStyle,
  CadPointStyleId,
} from './cadTypes';

export type CadSurveyCommandPayload =
  | {
      key: 'SURVEY_POINT_OVERRIDE';
      entityIds: CadEntityId[];
      /** undefined = leave, null = clear, id = set (must exist in its table). */
      pointStyleOverrideId?: CadPointStyleId | null;
      /** undefined = leave, null = clear, id = set (must exist in its table). */
      pointLabelStyleOverrideId?: CadPointLabelStyleId | null;
    }
  | {
      key: 'SURVEY_STYLE_TABLE';
      table: 'point';
      op: 'create';
      style: CadPointStyle;
    }
  | {
      key: 'SURVEY_STYLE_TABLE';
      table: 'point';
      op: 'duplicate';
      styleId: CadPointStyleId;
      newId: CadPointStyleId;
      name: string;
    }
  | {
      key: 'SURVEY_STYLE_TABLE';
      table: 'point';
      op: 'rename';
      styleId: CadPointStyleId;
      name: string;
    }
  | {
      key: 'SURVEY_STYLE_TABLE';
      table: 'point';
      op: 'update';
      styleId: CadPointStyleId;
      patch: Partial<CadPointStyle>;
    }
  | {
      key: 'SURVEY_STYLE_TABLE';
      table: 'point';
      op: 'delete';
      styleId: CadPointStyleId;
      /** Required when points/groups reference the style; refs rewire to it. */
      replacementId?: CadPointStyleId;
    }
  | {
      key: 'SURVEY_STYLE_TABLE';
      table: 'label';
      op: 'create';
      style: CadPointLabelStyle;
    }
  | {
      key: 'SURVEY_STYLE_TABLE';
      table: 'label';
      op: 'duplicate';
      styleId: CadPointLabelStyleId;
      newId: CadPointLabelStyleId;
      name: string;
    }
  | {
      key: 'SURVEY_STYLE_TABLE';
      table: 'label';
      op: 'rename';
      styleId: CadPointLabelStyleId;
      name: string;
    }
  | {
      key: 'SURVEY_STYLE_TABLE';
      table: 'label';
      op: 'update';
      styleId: CadPointLabelStyleId;
      patch: Partial<CadPointLabelStyle>;
    }
  | {
      key: 'SURVEY_STYLE_TABLE';
      table: 'label';
      op: 'delete';
      styleId: CadPointLabelStyleId;
      /** Required when points/groups reference the style; refs rewire to it. */
      replacementId?: CadPointLabelStyleId;
    }
  | {
      key: 'SURVEY_GROUP_TABLE';
      op: 'create';
      group: CadPointGroup;
    }
  | {
      key: 'SURVEY_GROUP_TABLE';
      op: 'rename';
      groupId: CadPointGroupId;
      name: string;
    }
  | {
      key: 'SURVEY_GROUP_TABLE';
      op: 'update';
      groupId: CadPointGroupId;
      query?: Partial<CadPointGroupQuery>;
      description?: string | null;
      /** undefined = leave, null = clear, id = set (must exist in its table). */
      pointStyleOverrideId?: CadPointStyleId | null;
      /** undefined = leave, null = clear, id = set (must exist in its table). */
      pointLabelStyleOverrideId?: CadPointLabelStyleId | null;
    }
  | {
      key: 'SURVEY_GROUP_TABLE';
      op: 'move';
      groupId: CadPointGroupId;
      direction: 'up' | 'down';
    }
  | {
      key: 'SURVEY_GROUP_TABLE';
      op: 'delete';
      groupId: CadPointGroupId;
    };
