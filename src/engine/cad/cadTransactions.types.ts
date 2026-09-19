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
  CadSectionStyle,
  CadSurfaceBoundary,
  CadSurfaceDefinition,
  CadSurfaceStyle,
  CadProfileStyle,
  CadVolumeSurfaceStyle,
} from './cadTypes';
import type { CadVolumeSurfaceStylePatch } from './cadVolumeSurfaces';
import type { CadProfileStylePatch } from './cadProfileTypes';
import type {
  CadSampleLinePatch,
  CadSectionStylePatch,
  CadSectionViewPatch,
} from './cadSectionTypes';

/**
 * Phase 18J display-only view patch. Only presentation fields (scale,
 * datum, grid intervals, style, name) — never profileIds/alignment, so
 * applying it cannot alter any profile extraction revision.
 */
export interface CadProfileViewUpdatePatch {
  horizontalScale?: number;
  verticalExaggeration?: number;
  datumMode?: 'auto' | 'explicit';
  datumElevation?: number;
  datumStep?: number;
  majorStationInterval?: number;
  minorStationInterval?: number;
  elevationGridInterval?: number;
  styleId?: string | null;
  name?: string;
}

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
  | 'SURVEY_GROUP_TABLE'
  | 'SURFACE_CREATE'
  | 'SURFACE_DELETE'
  | 'SURFACE_RENAME'
  | 'SURFACE_SET_LAYER_STYLE'
  | 'SURFACE_ADD_POINT_GROUP'
  | 'SURFACE_REMOVE_POINT_GROUP'
  | 'SURFACE_ADD_POINTS'
  | 'SURFACE_REMOVE_SOURCE'
  | 'SURFACE_ADD_BREAKLINE'
  | 'SURFACE_REMOVE_BREAKLINE'
  | 'SURFACE_ADD_BOUNDARY'
  | 'SURFACE_REMOVE_BOUNDARY'
  | 'SURFACE_STYLE_CREATE'
  | 'SURFACE_STYLE_DUPLICATE'
  | 'SURFACE_STYLE_RENAME'
  | 'SURFACE_STYLE_UPDATE'
  | 'SURFACE_STYLE_DELETE'
  | 'VOLUME_SURFACE_CREATE'
  | 'VOLUME_SURFACE_DELETE'
  | 'VOLUME_SURFACE_UPDATE_SOURCES'
  | 'VOLUME_SURFACE_SET_LAYER_STYLE'
  | 'VOLUME_STYLE_CREATE'
  | 'VOLUME_STYLE_DUPLICATE'
  | 'VOLUME_STYLE_RENAME'
  | 'VOLUME_STYLE_UPDATE'
  | 'VOLUME_STYLE_DELETE'
  | 'PROFILE_CREATE'
  | 'PROFILE_REBUILD'
  | 'PROFILE_DELETE'
  | 'PROFILE_VIEW_CREATE'
  | 'PROFILE_VIEW_UPDATE'
  | 'PROFILE_VIEW_DELETE'
  | 'PROFILE_STYLE_CREATE'
  | 'PROFILE_STYLE_DUPLICATE'
  | 'PROFILE_STYLE_RENAME'
  | 'PROFILE_STYLE_UPDATE'
  | 'PROFILE_STYLE_DELETE'
  | 'SAMPLE_GROUP_CREATE'
  | 'SAMPLE_GROUP_RENAME'
  | 'SAMPLE_GROUP_DELETE'
  | 'SAMPLE_LINE_ADD'
  | 'SAMPLE_LINE_ADD_INTERVAL'
  | 'SAMPLE_LINE_UPDATE'
  | 'SAMPLE_LINE_DELETE'
  | 'SECTION_SOURCE_ADD'
  | 'SECTION_SOURCE_REMOVE'
  | 'SECTION_SOURCE_SET_STYLE'
  | 'SECTION_STYLE_CREATE'
  | 'SECTION_STYLE_RENAME'
  | 'SECTION_STYLE_UPDATE'
  | 'SECTION_STYLE_DELETE'
  | 'SECTION_VIEW_CREATE'
  | 'SECTION_VIEW_UPDATE'
  | 'SECTION_VIEW_DELETE';
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
        | 'surfaces'
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
    }
  | {
      key: 'SURFACE_CREATE';
      name?: string;
      layerId?: CadLayerId;
      styleId?: string;
      pointSource?: CadSurfaceDefinition['pointSource'];
      buildOptions?: CadSurfaceDefinition['buildOptions'];
    }
  | {
      key: 'SURFACE_DELETE';
      surfaceId: string;
    }
  | {
      key: 'SURFACE_RENAME';
      surfaceId: string;
      name: string;
    }
  | {
      key: 'SURFACE_SET_LAYER_STYLE';
      surfaceId: string;
      layerId?: CadLayerId;
      /** Undefined = leave, null = clear, id = set (must exist). */
      styleId?: string | null;
    }
  | {
      key: 'SURFACE_ADD_POINT_GROUP';
      surfaceId: string;
      pointGroupId: string;
    }
  | {
      key: 'SURFACE_REMOVE_POINT_GROUP';
      surfaceId: string;
      pointGroupId: string;
    }
  | {
      key: 'SURFACE_ADD_POINTS';
      surfaceId: string;
      pointIds: string[];
    }
  | {
      key: 'SURFACE_REMOVE_SOURCE';
      surfaceId: string;
    }
  | {
      key: 'SURFACE_ADD_BREAKLINE';
      surfaceId: string;
      pointIds: string[];
      name?: string;
    }
  | {
      key: 'SURFACE_REMOVE_BREAKLINE';
      surfaceId: string;
      breaklineId: string;
    }
  | {
      key: 'SURFACE_ADD_BOUNDARY';
      surfaceId: string;
      kind: CadSurfaceBoundary['type'];
      sourceEntityId: CadEntityId;
    }
  | {
      key: 'SURFACE_REMOVE_BOUNDARY';
      surfaceId: string;
      kind: CadSurfaceBoundary['type'];
      sourceEntityId?: CadEntityId;
    }
  | {
      key: 'SURFACE_STYLE_CREATE';
      style: CadSurfaceStyle;
    }
  | {
      key: 'SURFACE_STYLE_DUPLICATE';
      styleId: string;
      newId: string;
      name: string;
    }
  | {
      key: 'SURFACE_STYLE_RENAME';
      styleId: string;
      name: string;
    }
  | {
      key: 'SURFACE_STYLE_UPDATE';
      styleId: string;
      patch: Pick<
        CadSurfaceStyle,
        | 'color'
        | 'opacity'
        | 'showTriangles'
        | 'showContours'
        | 'showPoints'
        | 'showBoundary'
        | 'minorContourInterval'
        | 'majorContourEvery'
        | 'contourBaseElevation'
        | 'minorContour'
        | 'majorContour'
        | 'showContourLabels'
        | 'labelMajorOnly'
        | 'contourLabelSpacing'
        | 'contourLabelPrecision'
      > & { description?: string | null };
    }
  | {
      key: 'SURFACE_STYLE_DELETE';
      styleId: string;
      /** Required when surfaces reference the style; refs rewire to it. */
      replacementId?: string;
    }
  | {
      key: 'VOLUME_SURFACE_CREATE';
      name?: string;
      layerId?: CadLayerId;
      styleId?: string;
      baseSurfaceId: string;
      comparisonSurfaceId: string;
    }
  | {
      key: 'VOLUME_SURFACE_DELETE';
      volumeSurfaceId: string;
    }
  | {
      key: 'VOLUME_SURFACE_UPDATE_SOURCES';
      volumeSurfaceId: string;
      baseSurfaceId: string;
      comparisonSurfaceId: string;
    }
  | {
      key: 'VOLUME_SURFACE_SET_LAYER_STYLE';
      volumeSurfaceId: string;
      layerId?: CadLayerId;
      /** Undefined = leave, null = clear, id = set (must exist). */
      styleId?: string | null;
    }
  | {
      key: 'VOLUME_STYLE_CREATE';
      style: CadVolumeSurfaceStyle;
    }
  | {
      key: 'VOLUME_STYLE_DUPLICATE';
      styleId: string;
      newId: string;
      name: string;
    }
  | {
      key: 'VOLUME_STYLE_RENAME';
      styleId: string;
      name: string;
    }
  | {
      key: 'VOLUME_STYLE_UPDATE';
      styleId: string;
      patch: CadVolumeSurfaceStylePatch;
    }
  | {
      key: 'VOLUME_STYLE_DELETE';
      styleId: string;
      /** Required when volumes reference the style; refs rewire to it. */
      replacementId?: string;
    }
  | {
      key: 'PROFILE_CREATE';
      name?: string;
      /** Accepted for forward compatibility; profiles carry no layer binding (ignored). */
      layerId?: CadLayerId;
      styleId?: string;
      alignmentEntityId: string;
      surfaceId: string;
      description?: string;
    }
  | {
      key: 'PROFILE_REBUILD';
      profileId: string;
      name?: string;
      /** Undefined = leave, null = clear, id = set (must exist). */
      styleId?: string | null;
      alignmentEntityId?: string;
      surfaceId?: string;
      /** Undefined = leave, null = clear, text = set. */
      description?: string | null;
    }
  | {
      key: 'PROFILE_DELETE';
      profileId: string;
    }
  | {
      key: 'PROFILE_VIEW_CREATE';
      name?: string;
      alignmentEntityId: string;
      profileIds?: string[];
      insertionX?: number;
      insertionY?: number;
      width?: number;
      height?: number;
      horizontalScale?: number;
      verticalExaggeration?: number;
      datumElevation?: number;
      datumMode?: 'auto' | 'explicit';
      datumStep?: number;
      majorStationInterval?: number;
      minorStationInterval?: number;
      elevationGridInterval?: number;
      styleId?: string;
    }
  | {
      key: 'PROFILE_VIEW_UPDATE';
      viewId: string;
      patch: CadProfileViewUpdatePatch;
    }
  | {
      key: 'PROFILE_VIEW_DELETE';
      viewId: string;
    }
  | {
      key: 'PROFILE_STYLE_CREATE';
      style: CadProfileStyle;
    }
  | {
      key: 'PROFILE_STYLE_DUPLICATE';
      styleId: string;
      newId: string;
      name: string;
    }
  | {
      key: 'PROFILE_STYLE_RENAME';
      styleId: string;
      name: string;
    }
  | {
      key: 'PROFILE_STYLE_UPDATE';
      styleId: string;
      patch: CadProfileStylePatch;
    }
  | {
      key: 'PROFILE_STYLE_DELETE';
      styleId: string;
      /** Required when profiles or views reference the style; refs rewire to it. */
      replacementId?: string;
    }
  | {
      key: 'SAMPLE_GROUP_CREATE';
      name?: string;
      alignmentEntityId: string;
      layerId?: CadLayerId;
    }
  | {
      key: 'SAMPLE_GROUP_RENAME';
      groupId: string;
      name: string;
    }
  | {
      key: 'SAMPLE_GROUP_DELETE';
      groupId: string;
    }
  | {
      key: 'SAMPLE_LINE_ADD';
      groupId: string;
      /** Raw chainage; ignored when stationText is supplied. */
      rawStation?: number;
      /** Display station text (`1+234.500`) parsed then mapped to raw. */
      stationText?: string;
      leftWidth: number;
      rightWidth: number;
      skewDeg?: number;
      manualName?: string;
    }
  | {
      key: 'SAMPLE_LINE_ADD_INTERVAL';
      groupId: string;
      rawStart: number;
      rawEnd: number;
      interval: number;
      leftWidth: number;
      rightWidth: number;
      skewDeg?: number;
    }
  | {
      key: 'SAMPLE_LINE_UPDATE';
      groupId: string;
      lineId: string;
      patch: CadSampleLinePatch;
    }
  | {
      key: 'SAMPLE_LINE_DELETE';
      groupId: string;
      lineId: string;
    }
  | {
      key: 'SECTION_SOURCE_ADD';
      groupId: string;
      surfaceId: string;
      sectionStyleId?: string;
    }
  | {
      key: 'SECTION_SOURCE_REMOVE';
      groupId: string;
      surfaceId: string;
    }
  | {
      key: 'SECTION_SOURCE_SET_STYLE';
      groupId: string;
      surfaceId: string;
      /** Undefined is rejected; null clears. */
      sectionStyleId: string | null;
    }
  | {
      key: 'SECTION_STYLE_CREATE';
      style: CadSectionStyle;
    }
  | {
      key: 'SECTION_STYLE_RENAME';
      styleId: string;
      name: string;
    }
  | {
      key: 'SECTION_STYLE_UPDATE';
      styleId: string;
      patch: CadSectionStylePatch;
    }
  | {
      key: 'SECTION_STYLE_DELETE';
      styleId: string;
      /** Required when groups or views reference the style; refs rewire to it. */
      replacementId?: string;
    }
  | {
      key: 'SECTION_VIEW_CREATE';
      sampleLineGroupId: string;
      sampleLineId: string;
      name?: string;
      sourceSurfaceIds?: string[];
      insertionX?: number;
      insertionY?: number;
      horizontalScale?: number;
      verticalExaggeration?: number;
      datumMode?: 'auto' | 'explicit';
      datumElevation?: number;
      offsetGridInterval?: number;
      elevationGridInterval?: number;
      showCutFill?: boolean;
      styleId?: string;
      layerId?: CadLayerId;
    }
  | {
      key: 'SECTION_VIEW_UPDATE';
      viewId: string;
      patch: CadSectionViewPatch;
    }
  | {
      key: 'SECTION_VIEW_DELETE';
      viewId: string;
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
