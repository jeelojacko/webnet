import type { CadSelectionState } from './cadSelection';
import type { FieldToFinishCadPayload } from '../fieldToFinish/cadGeneration';
import type { CadBatchCogoDraft } from './cadBatchCogo';
import type {
  CadEntityAppearance,
  CadEntityId,
  CadLayerId,
  CadGripHandleKind,
  CadParcelLayoutSettings,
  CadPointGroup,
  CadPointGroupId,
  CadPointGroupQuery,
  CadPointLabelStyle,
  CadPointLabelStyleId,
  CadPointStyle,
  CadPointStyleId,
  CadProject,
} from './cadTypes';

export type CadCommandKey =
  | 'SELECT_ALL'
  | 'CLEAR_SELECTION'
  | 'ERASE'
  | 'POINT'
  | 'COGO_POINT'
  | 'LINE'
  | 'PLINE'
  | 'TRAVERSE'
  | 'BATCH_COGO'
  | 'ARC_3PT'
  | 'ARC_CREATE'
  | 'TANGENT_CURVE'
  | 'ALIGNMENT_CREATE'
  | 'ALIGNMENT_OFFSET_CREATE'
  | 'ALIGNMENT_STATION_REPORT'
  | 'ALIGNMENT_STATION_EQUATION'
  | 'ALIGNMENT_OFFSET_POINT'
  | 'ALIGNMENT_INTERVAL_POINTS'
  | 'PARCEL_CREATE'
  | 'PARCEL_SPLIT'
  | 'PARCEL_SPLIT_BEARING'
  | 'PARCEL_SPLIT_AREA'
  | 'PARCEL_SPLIT_SLIDE'
  | 'PARCEL_SPLIT_SWING'
  | 'PARCEL_LAYOUT_AUTO'
  | 'MOVE'
  | 'COPY'
  | 'EXTEND'
  | 'FILLET'
  | 'PASTE'
  | 'TRIM'
  | 'INTERSECT_POINT'
  | 'EDIT_ENTITY'
  | 'GRIP_EDIT'
  | 'SHEET_ADD'
  | 'SHEET_DELETE'
  | 'VIEWPORT_MOVE'
  | 'VIEWPORT_SCALE'
  | 'VIEWPORT_ROTATE'
  | 'TITLE_BLOCK_EDIT'
  | 'LAYER_CREATE'
  | 'LAYER_RENAME'
  | 'LAYER_VISIBILITY'
  | 'LAYER_LOCKED'
  | 'LAYER_PRINTABLE'
  | 'LAYER_COLOR'
  | 'LAYER_LINETYPE'
  | 'LAYER_LINEWEIGHT'
  | 'LAYER_TRANSPARENCY'
  | 'LAYER_FROZEN'
  | 'LAYER_DESCRIPTION'
  | 'LAYER_SET_CURRENT'
  | 'LAYER_MOVE_OBJECTS'
  | 'LAYER_DELETE'
  | 'F2F_GENERATE'
  | 'SURVEY_POINT_OVERRIDE'
  | 'SURVEY_STYLE_TABLE'
  | 'SURVEY_GROUP_TABLE';
export type CadCommandPhase = 'idle' | 'committed';

export interface CadCommandState {
  key: CadCommandKey | 'IDLE';
  phase: CadCommandPhase;
  prompt: string;
}

export type CadCommand =
  | {
      key: 'SELECT_ALL';
    }
  | {
      key: 'CLEAR_SELECTION';
    }
  | {
      key: 'ERASE';
    }
  | {
      key: 'POINT';
      x: number;
      y: number;
      label?: string;
    }
  | {
      key: 'COGO_POINT';
      x: number;
      y: number;
      label?: string;
      basisLabel: string;
      directionLabel: string;
    }
  | {
      key: 'LINE';
      start: { x: number; y: number; label: string };
      end: { x: number; y: number; label: string };
    }
  | {
      key: 'PLINE';
      vertices: { x: number; y: number; label: string }[];
    }
  | {
      key: 'TRAVERSE';
      vertices: { x: number; y: number; label: string }[];
      rawVertices?: { x: number; y: number; label: string }[];
      mode?: 'open' | 'closed' | 'point-to-point';
      closePoint?: { x: number; y: number; label: string };
      sideshots?: Array<{
        occupyLabel: string;
        backsightLabel: string;
        side: 'left' | 'right';
        angleDeg: number;
        distance: number;
        point: { label: string; x: number; y: number };
      }>;
      adjustment?: {
        method: 'angular' | 'bowditch' | 'transit';
        targetLabel: string;
        rawClosureDistance: number;
        adjustedClosureDistance: number;
        rawClosureBearing: string | null;
        adjustedClosureBearing: string | null;
        angularCorrectionPerLegSec: number | null;
      };
    }
  | {
      key: 'BATCH_COGO';
      draft: CadBatchCogoDraft;
    }
  | {
      key: 'ARC_3PT';
      start: { x: number; y: number; label: string };
      through: { x: number; y: number; label: string };
      end: { x: number; y: number; label: string };
    }
  | {
      key: 'ARC_CREATE';
      modeLabel: string;
      definition: {
        center: { x: number; y: number };
        radius: number;
        startAngleDeg: number;
        endAngleDeg: number;
      };
      metadata?: Record<string, unknown>;
    }
  | {
      key: 'TANGENT_CURVE';
      pi: { x: number; y: number; label: string };
      backTangentPoint: { x: number; y: number; label: string };
      aheadTangentPoint: { x: number; y: number; label: string };
      radius: number;
    }
  | {
      key: 'ALIGNMENT_CREATE';
      sourceEntityIds: CadEntityId[];
      name?: string;
      startStation?: number;
    }
  | {
      key: 'ALIGNMENT_OFFSET_CREATE';
      alignmentEntityId: CadEntityId;
      offset: number;
      name?: string;
    }
  | {
      key: 'ALIGNMENT_STATION_REPORT';
      alignmentEntityId: CadEntityId;
      pointEntityId: CadEntityId;
    }
  | {
      key: 'ALIGNMENT_STATION_EQUATION';
      alignmentEntityId: CadEntityId;
      backStation: number;
      aheadStation: number;
    }
  | {
      key: 'ALIGNMENT_OFFSET_POINT';
      alignmentEntityId: CadEntityId;
      station: number;
      offset: number;
      label?: string;
    }
  | {
      key: 'ALIGNMENT_INTERVAL_POINTS';
      alignmentEntityId: CadEntityId;
      interval: number;
      startStation?: number;
      endStation?: number;
      labelPrefix?: string;
    }
  | {
      key: 'PARCEL_CREATE';
      sourceEntityIds: CadEntityId[];
    }
  | {
      key: 'PARCEL_SPLIT';
      parcelEntityId: CadEntityId;
      splitLineEntityId: CadEntityId;
    }
  | {
      key: 'PARCEL_SPLIT_BEARING';
      parcelEntityId: CadEntityId;
      throughPointX: number;
      throughPointY: number;
      throughPointLabel?: string;
      bearing: string;
    }
  | {
      key: 'PARCEL_SPLIT_AREA';
      parcelEntityId: CadEntityId;
      throughPointX: number;
      throughPointY: number;
      throughPointLabel?: string;
      targetAreaSquareMeters: number;
    }
  | {
      key: 'PARCEL_SPLIT_SLIDE';
      parcelEntityId: CadEntityId;
      frontageEntityId?: CadEntityId | null;
      frontageParcelSegmentIds?: string[] | null;
      targetAreaSquareMeters: number;
      minFrontageMeters: number;
      alternative: 'start' | 'end';
      settings: CadParcelLayoutSettings;
    }
  | {
      key: 'PARCEL_SPLIT_SWING';
      parcelEntityId: CadEntityId;
      frontageEntityId?: CadEntityId | null;
      frontageParcelSegmentIds?: string[] | null;
      targetAreaSquareMeters: number;
      minFrontageMeters: number;
      alternative: 'start' | 'end';
      settings: CadParcelLayoutSettings;
    }
  | {
      key: 'PARCEL_LAYOUT_AUTO';
      parcelEntityId: CadEntityId;
      frontageEntityId?: CadEntityId | null;
      frontageParcelSegmentIds?: string[] | null;
      tool: 'slide' | 'swing';
      settings: CadParcelLayoutSettings;
    }
  | {
      key: 'MOVE';
      deltaX: number;
      deltaY: number;
    }
  | {
      key: 'COPY';
      deltaX: number;
      deltaY: number;
    }
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
        | { kind: 'polyline-vertex'; vertexIndex: number; x: number; y: number }
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
    }
  | {
      key: 'SHEET_ADD';
      sheetId: string;
      sheetName: string;
    }
  | {
      key: 'SHEET_DELETE';
      sheetId: string;
    }
  | {
      key: 'VIEWPORT_MOVE';
      sheetId: string;
      viewportId: string;
      x: number;
      y: number;
    }
  | {
      key: 'VIEWPORT_SCALE';
      sheetId: string;
      viewportId: string;
      scaleDenominator: number;
    }
  | {
      key: 'VIEWPORT_ROTATE';
      sheetId: string;
      viewportId: string;
      rotationDeg: number;
    }
  | {
      key: 'TITLE_BLOCK_EDIT';
      sheetId: string;
      definitionId: string;
      values: Record<string, string>;
    }
  | {
      key: 'LAYER_CREATE';
      name: string;
      color?: string;
      role?:
        | 'points'
        | 'control-points'
        | 'observation-lines'
        | 'error-ellipses'
        | 'labels'
        | 'parcels'
        | 'planning';
    }
  | {
      key: 'LAYER_RENAME';
      layerId: string;
      name: string;
    }
  | {
      key: 'LAYER_VISIBILITY';
      layerId: string;
      visible: boolean;
    }
  | {
      key: 'LAYER_LOCKED';
      layerId: string;
      locked: boolean;
    }
  | {
      key: 'LAYER_PRINTABLE';
      layerId: string;
      printable: boolean;
    }
  | {
      key: 'LAYER_COLOR';
      layerId: string;
      color: string;
    }
  | {
      key: 'LAYER_LINETYPE';
      layerId: string;
      lineTypeId: string;
    }
  | {
      key: 'LAYER_LINEWEIGHT';
      layerId: string;
      /** Undefined = Default. */
      lineweightMm?: number;
    }
  | {
      key: 'LAYER_TRANSPARENCY';
      layerId: string;
      transparency: number;
    }
  | {
      key: 'LAYER_FROZEN';
      layerId: string;
      frozen: boolean;
    }
  | {
      key: 'LAYER_DESCRIPTION';
      layerId: string;
      description: string;
    }
  | {
      key: 'LAYER_SET_CURRENT';
      layerId: string;
    }
  | {
      key: 'LAYER_MOVE_OBJECTS';
      fromLayerId: string;
      toLayerId: string;
    }
  | {
      key: 'LAYER_DELETE';
      layerId: string;
    }
  | {
      key: 'F2F_GENERATE';
      payload: FieldToFinishCadPayload;
    }
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

export interface CadTransaction {
  id: string;
  sequence: number;
  commandKey: CadCommandKey;
  label: string;
  beforeSelectionIds: CadEntityId[];
  afterSelectionIds: CadEntityId[];
  addedEntityIds: CadEntityId[];
  removedEntityIds: CadEntityId[];
}

export interface CadWorkspaceSnapshot {
  project: CadProject;
  selection: CadSelectionState;
}

export interface CadCommandExecutionResult {
  nextSnapshot: CadWorkspaceSnapshot;
  commandState: CadCommandState;
  transactionLabel: string;
  addedEntityIds: CadEntityId[];
  removedEntityIds: CadEntityId[];
}

export interface CadCommandDefinition<TCommand extends CadCommand> {
  key: TCommand['key'];
  execute: (_snapshot: CadWorkspaceSnapshot, _command: TCommand) => CadCommandExecutionResult | null;
}
