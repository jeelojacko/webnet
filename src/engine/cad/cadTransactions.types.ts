import type { CadSelectionState } from './cadSelection';
import type { CadBatchCogoDraft } from './cadBatchCogo';
import type {
  CadEntityId,
  CadGripHandleKind,
  CadParcelLayoutSettings,
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
  | 'GRIP_EDIT';
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
        | { kind: 'polyline-vertex'; vertexIndex: number; x: number; y: number };
    }
  | {
      key: 'GRIP_EDIT';
      entityId: CadEntityId;
      gripKind: CadGripHandleKind;
      x: number;
      y: number;
      vertexIndex?: number;
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
