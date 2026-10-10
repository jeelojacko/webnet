import type { CadSelectionState } from './cadSelectionTypes';
import type { DraftDocument } from './cadDraftTypes';
import type { CadTangentSource } from './cadGeometryCircleTangentSolvers';
import type { FieldToFinishCadPayload } from '../fieldToFinish/fieldToFinishGenerationTypes';
import type { CadBatchCogoDraft } from './cadBatchCogo';
import type {
  CadParcelTableCreatePayload,
  CadSurveyTableCreatePayload,
  CadSurveyTableEdit,
  CadSurveyTableStyleCommandPayload,
} from './cadSurveyTables';

import type { CadAnnotationAnchor } from './annotation/cadAnnotationAnchors';
import type { FeatureLineElevationMethod } from './cadFeatureLineCreate';
import type { CadGradingGroupResult } from './grading/gradingGroupTypes';
import type { HelmertControlPair, HelmertMode } from './cadHelmert2D';
import type { ProjectTransformRequest } from './cadProjectTransform';
import type {
  CadCurveBetweenLinesCommand,
  CadCurveFromEndCommand,
  CadCurveOnLinesCommand,
  CadCurveThroughPointCommand,
  CadMultipleCurvesCommand,
  CadReverseCompoundCurveCommand,
  CadSubdivideCurveCommand,
} from './cadTransactionsCurveF1Types';
// STRUCT-195.3: the surface/bake/compose and volume command payload slices are
// type-only leaves so the hub stays free of their command-family cycle.
import type { CadSurfaceCommandPayload } from './cadTransactionsSurfaceCommandTypes';
import type { CadVolumeCommandPayload } from './cadTransactionsVolumeCommandTypes';
// STRUCT-195.5: profile and sample-line/section payload slices are type-only
// leaves; LANDXML_IMPORT stays inline to preserve union order.
import type { CadProfileCommandPayload } from './cadTransactionsProfileCommandTypes';
import type {
  CadSectionCommandPayload,
  CadSectionViewDeleteCommand,
} from './cadTransactionsSectionCommandTypes';
// STRUCT-195.6: grading and grading-group command payload slices are type-only
// leaves; the hub splices both unions in the original position.
import type { CadGradingCommandPayload } from './cadTransactionsGradingCommandTypes';
import type { CadGradingGroupCommandPayload } from './cadTransactionsGradingGroupCommandTypes';
// STRUCT-241.1: layer and survey command payload slices are type-only
// leaves; the hub splices both unions in the original position.
import type { CadLayerCommandPayload } from './cadTransactionsLayerCommandTypes';
import type { CadSurveyCommandPayload } from './cadTransactionsSurveyCommandTypes';
// STRUCT-241.2: block prelude (2) + definition (7) payload slices are
// type-only leaves; the hub splices both unions at their disjoint positions.
import type {
  CadBlockDefinitionCommandPayload,
  CadBlockPreludeCommandPayload,
} from './cadTransactionsBlockCommandTypes';

export type GridGroundDirection = 'GRID_TO_GROUND' | 'GROUND_TO_GRID';
import type {
  CadAlignmentElement,
  CadDimensionKind,
  CadEntityAppearance,
  CadEntityId,
  CadLayerId,
  CadGripHandleKind,
  CadMTextAttachment,
  CadParcelLayoutSettings,
  CadPointGroup,
  CadPointGroupId,
  CadPointGroupQuery,
  CadPointLabelStyle,
  CadPointLabelStyleId,
  CadPointStyle,
  CadPointStyleId,
  CadPolylineSegmentGeometry,
  CadPolylineSegmentWidth,
  CadProject,
  CadStationEquation,
  CadSurfacePurpose,
  CadTextStyleId,
  ImportedTinPayload,
} from './cadTypes';
import type { CadAnalysisAppearancePatch } from './cadAnalysisMaps';
import type { CadAnalysisLegendPatch } from './cadAnalysisLegends';
import type { CadAnalysisBand, CadAnalysisLegend, CadAnalysisSource } from './cadAnalysisTypes';
import type {
  ParcelDesignateCommand,
  ParcelNumberCommand,
  ParcelLinkCommand,
  ParcelUnlinkCommand,
  ParcelSharedEditCommand,
  ParcelCheckCommand,
  ParcelScheduleCommand,
} from './cadTransactionsParcelCommandTypes';
export type { CadProfileViewUpdatePatch } from './cadTransactionsProfileCommandTypes';

export type CadCommandKey =
  | 'SELECT_ALL'
  | 'CLEAR_SELECTION'
  | 'ERASE'
  | 'POINT'
  | 'COGO_POINT'
  | 'LINE'
  | 'LINE_CREATE_BATCH'
  | 'RECTANGLE'
  | 'POLYGON'
  | 'CIRCLE'
  | 'CIRCLECD'
  | 'CIRCLE2P'
  | 'CIRCLE3P'
  | 'CIRCLETTR'
  | 'CIRCLETTT'
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
  | 'PARCELCOURSEARC'
  | 'PARCELCOURSELINE'
  | 'PARCEL_LAYOUT_AUTO'
  | 'LINETABLE'
  | 'CURVETABLE'
  | 'PARCELTABLE'
  | 'POINTTABLE'
  | 'PARCELREPORT'
  | 'PARCELDESC'
  | 'PARCELDESIGNATE'
  | 'PARCELNUMBER'
  | 'PARCELLINK'
  | 'PARCELUNLINK'
  | 'PARCELSHAREDEDIT'
  | 'PARCELCHECK'
  | 'PARCELSCHEDULE'
  | 'TABLESTYLE'
  | 'SURVEYTABLE_EDIT'
  | 'MOVE'
  | 'COPY'
  | 'ROTATE'
  | 'SCALE'
  | 'MIRROR'
  | 'ALIGN2D'
  | 'HELMERT2D'
  | 'GRIDGROUND'
  | 'PROJECTTRANSFORM'
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
  | 'BLOCK_SEED'
  | 'BLOCK_CREATE'
  | 'BLOCK_DUPLICATE'
  | 'BLOCK_RENAME'
  | 'BLOCK_REDEFINE'
  | 'BLOCK_DELETE'
  | 'BLOCK_INSERT'
  | 'BLOCK_EXPLODE'
  | 'BLOCK_EDIT'
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
  | 'SURFACE_RENAME_BREAKLINE'
  | 'SURFACE_BREAKLINE_INSERT_POINT'
  | 'SURFACE_BREAKLINE_REMOVE_POINT'
  | 'SURFACE_BREAKLINE_REVERSE'
  | 'SURFACE_BREAKLINE_REPLACE_CHAIN'
  | 'SURFACE_BREAKLINE_CONVERT_TO_POINT_CHAIN'
  | 'SURFACE_ADD_BOUNDARY'
  | 'SURFACE_REMOVE_BOUNDARY'
  | 'SURFACE_CREATE_BOUNDARY_SOURCE'
  | 'SURFACE_REPLACE_BOUNDARY_SOURCE'
  | 'SURFACE_MAKE_BOUNDARY_INDEPENDENT'
  | 'SURFACE_ADD_EDIT'
  | 'SURFACE_DELETE_EDIT'
  | 'SURFACE_MOVE_EDIT'
  | 'SURFACE_SET_EDIT_ENABLED'
  | 'SURFACE_STYLE_CREATE'
  | 'LANDXML_IMPORT'
  | 'SURFACE_STYLE_DUPLICATE'
  | 'SURFACE_STYLE_RENAME'
  | 'SURFACE_STYLE_UPDATE'
  | 'SURFACE_STYLE_DELETE'
  | 'SURFBAKE'
  | 'SURFBAKECOPY'
  | 'SURFCOMPOSE'
  | 'SURFCOMPOSEPASTE'
  | 'VOLUME_SURFACE_CREATE'
  | 'VOLUME_SURFACE_DELETE'
  | 'VOLUME_SURFACE_UPDATE_SOURCES'
  | 'VOLUME_SURFACE_SET_LAYER_STYLE'
  | 'VOLUME_STYLE_CREATE'
  | 'ANALYSIS_MAP_CREATE'
  | 'ANALYSIS_MAP_UPDATE_BANDS'
  | 'ANALYSIS_MAP_UPDATE_APPEARANCE'
  | 'ANALYSIS_MAP_DELETE'
  | 'ANALYSIS_LEGEND_CREATE'
  | 'ANALYSIS_LEGEND_UPDATE'
  | 'ANALYSIS_LEGEND_MOVE'
  | 'ANALYSIS_LEGEND_DELETE'
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
  | 'SECTION_AREA_COMPARISON'
  | 'SECTION_STYLE_CREATE'
  | 'SECTION_STYLE_RENAME'
  | 'SECTION_STYLE_UPDATE'
  | 'SECTION_STYLE_DELETE'
  | 'SECTION_VIEW_CREATE'
  | 'SECTION_VIEW_UPDATE'
  | 'SECTION_VIEW_DELETE'
  | 'BLOCK_CREATE'
  | 'BLOCK_INSERT'
  | 'BLOCK_EXPLODE'
  | 'BLOCK_REDEFINE'
  | 'BLOCK_RENAME'
  | 'BLOCK_DUPLICATE'
  | 'BLOCK_DELETE'
  | 'CREATE_MTEXT'
  | 'CREATE_LEADER'
  | 'CREATE_DIMENSION'
  | 'CREATE_BEARING_LABEL'
  | 'CREATE_CURVE_LABEL'
  | 'UPDATE_DIMENSION_PLACEMENT'
  | 'REATTACH_ANNOTATION'
  | 'SET_TEXT_OVERRIDE'
  | 'CLEAR_TEXT_OVERRIDE'
  | 'SET_ANNOTATION_SCALE'
  | 'ANNOTATION_COMMIT'
  // Phase 20A — 3D feature lines.
  | 'FEATURELINE'
  | 'FEATURELINECREATE'
  | 'FEATURELINEELEV'
  | 'FLSETZ'
  | 'FLRAISELOWER'
  | 'FLGRADE'
  | 'FLINTERPOLATE'
  | 'FLSURFACEELEV'
  | 'FLREVERSE'
  | 'FLINQUIRY'
  | 'FLINSERTVERTEX'
  | 'FLDELETEVERTEX'
  | 'SURFACE_ADD_FEATURE_LINE_BREAKLINE'
  | 'GRADING_CREATE'
  | 'GRADING_DELETE'
  | 'GRADING_EDIT_CRITERIA'
  | 'GRADING_REASSIGN_TARGET'
  | 'GRADINGEXTRACTDAYLIGHT'
  | 'GRADINGBAKE'
  | 'GROUP_CREATE'
  | 'GROUP_DELETE'
  | 'GROUP_EDIT_CRITERIA'
  | 'GROUP_REASSIGN_TARGET'
  | 'GROUP_EDIT_SPAN'
  | 'GROUP_ADD_COURSE'
  | 'GROUP_REMOVE_END_COURSE'
  | 'GROUP_SET_COURSE_CRITERIA'
  | 'GROUP_RESET_COURSE_CRITERIA'
  | 'GROUP_SET_TRANSITION'
  | 'GROUP_CLEAR_TRANSITION'
  | 'GROUPEXTRACTDAYLIGHT'
  | 'GROUPBAKE'
  // Phase 20D Wave-1A — design surface workflow (engine only).
  | 'SURFPURPOSE'
  | 'DESIGNSURFACE'
  | 'DESIGNAPPLY'
  | 'DESIGNVOLUME'
  | 'DESIGNPATCH'
  // Phase C3 — polyline vertex topology (insert/delete are count-changing).
  | 'POLYLINE_INSERT_VERTEX'
  | 'POLYLINE_DELETE_VERTEX'
  // CAD Best Fit E1 — least-squares geometry from stored sample snapshots.
  | 'BEST_FIT_LINE'
  | 'BEST_FIT_ARC'
  | 'BEST_FIT_PARABOLA'
  // CAD Curves F1 — six atomic curve commands + atomic subdivision.
  | 'CURVE_BETWEEN_TWO_LINES_CREATE'
  | 'CURVE_ON_TWO_LINES_CREATE'
  | 'CURVE_THROUGH_POINT_CREATE'
  | 'MULTIPLE_CURVES_CREATE'
  | 'CURVE_FROM_END_CREATE'
  | 'REVERSE_COMPOUND_CURVE_CREATE'
  | 'SUBDIVIDE_CURVE_CREATE';
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
      key: 'LINE_CREATE_BATCH';
      segments: Array<{
        start: { x: number; y: number; label: string };
        end: { x: number; y: number; label: string };
      }>;
      /** User-facing creation mode recorded as metadata.createdBy. */
      createdBy: string;
    }
  | {
      key: 'RECTANGLE';
      firstCorner: { x: number; y: number; label: string };
      oppositeCorner: { x: number; y: number; label: string };
    }
  | {
      key: 'POLYGON';
      center: { x: number; y: number; label: string };
      through: { x: number; y: number; label: string };
      sides: number;
      mode: 'inscribed' | 'circumscribed';
    }
  | {
      key: 'CIRCLE';
      center: { x: number; y: number; label: string };
      radius: number;
    }
  | {
      key: 'CIRCLECD';
      center: { x: number; y: number; label: string };
      diameter: number;
    }
  | {
      key: 'CIRCLE2P';
      first: { x: number; y: number; label: string };
      second: { x: number; y: number; label: string };
    }
  | {
      key: 'CIRCLE3P';
      first: { x: number; y: number; label: string };
      second: { x: number; y: number; label: string };
      third: { x: number; y: number; label: string };
    }
  | {
      key: 'CIRCLETTR';
      first: CadTangentSource;
      second: CadTangentSource;
      radius: number;
    }
  | {
      key: 'CIRCLETTT';
      first: CadTangentSource;
      second: CadTangentSource;
      third: CadTangentSource;
    }
  | {
      key: 'PLINE';
      vertices: { x: number; y: number; label: string }[];
      /** Absent/false = open polyline. True = closed ring stored without a
       *  duplicate closure vertex (the renderer/segment law wraps to first). */
      closed?: boolean;
      /** Phase C2 optional per-course bulge metadata; absent = all-line.
       *  Trailing optional (no version bump). */
      segmentGeometry?: CadPolylineSegmentGeometry[];
      /** Phase C2 optional per-course full centred band widths (metres);
       *  absent = zero-width. Trailing optional (no version bump). */
      segmentWidths?: CadPolylineSegmentWidth[];
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
      key: 'BEST_FIT_LINE';
      samples: { x: number; y: number; label: string; sourceEntityId?: string }[];
    }
  | {
      key: 'BEST_FIT_ARC';
      samples: { x: number; y: number; label: string; sourceEntityId?: string }[];
    }
  | {
      key: 'BEST_FIT_PARABOLA';
      samples: { x: number; y: number; label: string; sourceEntityId?: string }[];
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
      key: 'PARCELCOURSEARC';
      parcelEntityId: CadEntityId;
      courseId: string;
      arcEntityId: CadEntityId;
    }
  | {
      key: 'PARCELCOURSELINE';
      parcelEntityId: CadEntityId;
      courseId: string;
    }
  | {
      key: 'PARCEL_LAYOUT_AUTO';
      parcelEntityId: CadEntityId;
      frontageEntityId?: CadEntityId | null;
      frontageParcelSegmentIds?: string[] | null;
      tool: 'slide' | 'swing';
      settings: CadParcelLayoutSettings;
    }
  | ({ key: 'LINETABLE' } & CadSurveyTableCreatePayload)
  | ({ key: 'CURVETABLE' } & CadSurveyTableCreatePayload)
  | ({ key: 'PARCELTABLE' } & CadSurveyTableCreatePayload)
  | ({ key: 'POINTTABLE' } & CadSurveyTableCreatePayload)
  | ({ key: 'PARCELREPORT' } & CadParcelTableCreatePayload)
  | ({ key: 'PARCELDESC' } & CadParcelTableCreatePayload)
  | ParcelDesignateCommand
  | ParcelNumberCommand
  | ParcelLinkCommand
  | ParcelUnlinkCommand
  | ParcelSharedEditCommand
  | ParcelCheckCommand
  | ParcelScheduleCommand
  | ({ key: 'TABLESTYLE' } & CadSurveyTableStyleCommandPayload)
  | {
      key: 'SURVEYTABLE_EDIT';
      tableEntityId: CadEntityId;
      edit: CadSurveyTableEdit;
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
      key: 'ROTATE';
      baseX: number;
      baseY: number;
      angleDeg: number;
    }
  | {
      key: 'SCALE';
      baseX: number;
      baseY: number;
      factor: number;
    }
  | {
      key: 'MIRROR';
      p1: { x: number; y: number };
      p2: { x: number; y: number };
      eraseSource: boolean;
    }
  | {
      key: 'ALIGN2D';
      source1: { x: number; y: number };
      source2: { x: number; y: number };
      target1: { x: number; y: number };
      target2: { x: number; y: number };
      scaleToFit: boolean;
    }
  | {
      key: 'HELMERT2D';
      pairs: HelmertControlPair[];
      mode: HelmertMode;
    }
  | {
      key: 'GRIDGROUND';
      originE: number;
      originN: number;
      combinedScaleFactor: number;
      direction: GridGroundDirection;
    }
  | {
      key: 'PROJECTTRANSFORM';
      request: ProjectTransformRequest;
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
  | CadBlockPreludeCommandPayload
  | CadLayerCommandPayload
  | {
      key: 'F2F_GENERATE';
      payload: FieldToFinishCadPayload;
    }
  | CadSurveyCommandPayload
  | CadSurfaceCommandPayload
  | CadVolumeCommandPayload
  | CadProfileCommandPayload
  | CadSectionCommandPayload
  | {
      key: 'LANDXML_IMPORT';
      fileName: string;
      inputHash: string;
      points: Array<{
        stationId: string;
        x: number;
        y: number;
        z: number;
        description?: string;
        featureCode?: string;
      }>;
      alignments: Array<{
        name: string;
        elements: CadAlignmentElement[];
        startStation: number;
        stationEquations: CadStationEquation[];
      }>;
      surfaces: Array<{ name: string; payload: ImportedTinPayload }>;
    }
  | CadSectionViewDeleteCommand
  | CadBlockDefinitionCommandPayload
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
    }
  // Phase 18U — analysis maps + legends (definitions only; derived band
  // quantities are session-only and never dirty the drawing).
  | {
      key: 'ANALYSIS_MAP_CREATE';
      name?: string;
      source: CadAnalysisSource;
      bands: CadAnalysisBand[];
      layerId?: CadLayerId;
      opacity?: number;
      description?: string;
    }
  | {
      key: 'ANALYSIS_MAP_UPDATE_BANDS';
      analysisId: string;
      bands?: CadAnalysisBand[];
      source?: CadAnalysisSource;
    }
  | {
      key: 'ANALYSIS_MAP_UPDATE_APPEARANCE';
      analysisId: string;
      patch: CadAnalysisAppearancePatch;
    }
  | {
      key: 'ANALYSIS_MAP_DELETE';
      analysisId: string;
      /** True removes the map + every referencing legend atomically. */
      deleteLegendsToo?: boolean;
    }
  | {
      key: 'ANALYSIS_LEGEND_CREATE';
      legend: CadAnalysisLegend;
    }
  | {
      key: 'ANALYSIS_LEGEND_UPDATE';
      legendId: string;
      patch: CadAnalysisLegendPatch;
    }
  | {
      key: 'ANALYSIS_LEGEND_MOVE';
      legendId: string;
      x: number;
      y: number;
    }
  | {
      key: 'ANALYSIS_LEGEND_DELETE';
      legendId: string;
    }
  // Phase 20A — 3D feature lines (create + edit + report).
  | {
      key: 'FEATURELINE' | 'FEATURELINECREATE';
      sourceEntityIds: CadEntityId[];
      sourceKind: 'survey-points' | 'chain';
      elevation: FeatureLineElevationMethod;
      name?: string;
      description?: string;
      closed?: boolean;
    }
  | {
      key: 'FEATURELINEELEV' | 'FLSETZ';
      entityId: CadEntityId;
      z: number;
      vertexIds?: string[];
    }
  | {
      key: 'FLRAISELOWER';
      entityId: CadEntityId;
      deltaZ: number;
      vertexIds?: string[];
    }
  | {
      key: 'FLGRADE';
      entityId: CadEntityId;
      startVertexId?: string;
      endVertexId?: string;
      startStation?: number;
      endStation?: number;
      gradePercent: number;
      mode?: 'set-end-only' | 'grade-all-intermediates';
    }
  | {
      key: 'FLINTERPOLATE';
      entityId: CadEntityId;
      startVertexId?: string;
      endVertexId?: string;
      startStation?: number;
      endStation?: number;
    }
  | {
      key: 'FLSURFACEELEV';
      entityId: CadEntityId;
      surfaceId: string;
    }
  | {
      key: 'FLREVERSE';
      entityId: CadEntityId;
    }
  | {
      key: 'FLINQUIRY';
      entityId: CadEntityId;
      startStation?: number;
      endStation?: number;
    }
  | {
      key: 'FLINSERTVERTEX';
      entityId: CadEntityId;
      courseIndex: number;
      station: number;
    }
  | {
      key: 'FLDELETEVERTEX';
      entityId: CadEntityId;
      vertexIndex: number;
    }
  | {
      key: 'SURFACE_ADD_FEATURE_LINE_BREAKLINE';
      surfaceId: string;
      entityId: CadEntityId;
      name?: string;
    }
  // Phase 20B — grade-to-surface definitions (results/meshes never in history).
  | CadGradingCommandPayload
  // Phase 20C — grading groups (single side only; definitions + snapshots).
  | CadGradingGroupCommandPayload
  // Phase 20D Wave-1A — design surface workflow (engine only).
  | {
      key: 'SURFPURPOSE';
      surfaceId: string;
      /** Explicit role; null/undefined clears back to legacy neutral. */
      purpose?: CadSurfacePurpose | null;
    }
  | {
      key: 'DESIGNSURFACE';
      sourceSurfaceId: string;
      name: string;
      /** Current source revision; a stale value rejects the copy. */
      expectedRevision: string;
      /** Session-owned CURRENT assertion (see SURFBAKE). */
      sessionCurrent?: boolean;
      layerId?: CadLayerId;
      /** Undefined = keep the source style; null = clear. */
      styleId?: string | null;
    }
  | {
      key: 'DESIGNAPPLY';
      /** Design target (keeps id/name/layer/style/purpose; never existing-ground). */
      targetSurfaceId: string;
      /** Current target revision; a stale value rejects the apply. */
      targetExpectedRevision: string;
      /** Patch source (contributes topology only; byte-identical). */
      patchSurfaceId: string;
      /** Current patch revision; a stale value rejects the apply. */
      patchExpectedRevision: string;
      /** Session-owned CURRENT assertion (see SURFBAKE). */
      sessionCurrent?: boolean;
    }
  | {
      key: 'DESIGNVOLUME';
      baseSurfaceId: string;
      comparisonSurfaceId: string;
      name?: string;
      layerId?: CadLayerId;
      styleId?: string;
    }
  | {
      key: 'DESIGNPATCH';
      groupId: string;
      /** Cached CURRENT result snapshot (never recomputed here). */
      result: CadGradingGroupResult;
      expectedRevision: string;
      sessionCurrent?: boolean;
      name?: string;
      layerId?: CadLayerId;
      /** Undefined = keep the group style; null = clear. */
      styleId?: string | null;
    }
  // Phase C3 — polyline vertex topology (count-changing, one undo entry).
  | {
      key: 'POLYLINE_INSERT_VERTEX';
      entityId: CadEntityId;
      courseIndex: number;
      x: number;
      y: number;
    }
  | {
      key: 'POLYLINE_DELETE_VERTEX';
      entityId: CadEntityId;
      vertexIndex: number;
    }
  // CAD Curves F1 — six atomic curve commands + atomic subdivision.
  | CadCurveBetweenLinesCommand
  | CadCurveOnLinesCommand
  | CadCurveThroughPointCommand
  | CadMultipleCurvesCommand
  | CadCurveFromEndCommand
  | CadReverseCompoundCurveCommand
  | CadSubdivideCurveCommand;

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
  /**
   * Phase 18R.1: optional DraftDocument channel. Sticky across commands
   * (executeCadCommand carries it forward); PROJECTTRANSFORM is the only
   * command that rewrites it, atomically with the project in one undo entry.
   */
  draft?: DraftDocument;
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
