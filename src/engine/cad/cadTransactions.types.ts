import type { CadSelectionState } from './cadSelectionTypes';
import type { DraftDocument } from './cadDraftTypes';
import type { FieldToFinishCadPayload } from '../fieldToFinish/fieldToFinishGenerationTypes';
import type { CadBatchCogoDraft } from './cadBatchCogo';
import type {
  CadParcelTableCreatePayload,
  CadSurveyTableCreatePayload,
  CadSurveyTableEdit,
  CadSurveyTableStyleCommandPayload,
} from './cadSurveyTables';

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
// STRUCT-241.11: annotation (11) + analysis (8) command payload slices are
// type-only leaves; the hub splices both unions in the original position.
import type { CadAnnotationCommandPayload } from './cadTransactionsAnnotationCommandTypes';
import type { CadAnalysisCommandPayload } from './cadTransactionsAnalysisCommandTypes';
// STRUCT-241.12: feature-line (11) + design-surface (5) command payload slices are
// type-only leaves; the hub splices both unions in the original position.
import type { CadFeatureLineCommandPayload } from './cadTransactionsFeatureLineCommandTypes';
import type { CadDesignSurfaceCommandPayload } from './cadTransactionsDesignSurfaceCommandTypes';
// STRUCT-241.13: alignment (6) + parcel-construction (9) command payload slices are
// type-only leaves; the hub splices both unions in the original position.
import type { CadAlignmentCommandPayload } from './cadTransactionsAlignmentCommandTypes';
import type { CadParcelConstructionCommandPayload } from './cadTransactionsParcelConstructionCommandTypes';
// STRUCT-241.14: primitive-draw (13) + basic-curve (6) command payload slices are
// type-only leaves; the hub splices both unions in the original position.
import type { CadPrimitiveDrawCommandPayload } from './cadTransactionsPrimitiveDrawCommandTypes';
import type { CadBasicCurveCommandPayload } from './cadTransactionsBasicCurveCommandTypes';
// STRUCT-241.15: planar-transform (6) + geometry-edit (7) command payload slices are
// type-only leaves; the hub splices both unions in the original position.
import type { CadPlanarTransformCommandPayload } from './cadTransactionsPlanarTransformCommandTypes';
import type { CadGeometryEditCommandPayload } from './cadTransactionsGeometryEditCommandTypes';
// STRUCT-241.16: sheet/viewport (6) + polyline-topology (2) command payload
// slices are type-only leaves; the hub splices both unions in the original
// position. The Phase C3 header moves with the polyline leaf; the CAD
// Curves F1 header stays in the hub.
import type { CadSheetViewportCommandPayload } from './cadTransactionsSheetViewportCommandTypes';
import type { CadPolylineTopologyCommandPayload } from './cadTransactionsPolylineTopologyCommandTypes';

export type GridGroundDirection = 'GRID_TO_GROUND' | 'GROUND_TO_GRID';
import type {
  CadAlignmentElement,
  CadEntityId,
  CadLayerId,
  CadPointGroup,
  CadPointGroupId,
  CadPointGroupQuery,
  CadPointLabelStyle,
  CadPointLabelStyleId,
  CadPointStyle,
  CadPointStyleId,
  CadProject,
  CadStationEquation,
  ImportedTinPayload,
} from './cadTypes';
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
  | CadPrimitiveDrawCommandPayload
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
  | CadBasicCurveCommandPayload
  | CadAlignmentCommandPayload
  | CadParcelConstructionCommandPayload
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
  | CadPlanarTransformCommandPayload
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
  | CadGeometryEditCommandPayload
  | CadSheetViewportCommandPayload
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
  | CadAnnotationCommandPayload
  | CadAnalysisCommandPayload
  | CadFeatureLineCommandPayload
  // Phase 20B — grade-to-surface definitions (results/meshes never in history).
  | CadGradingCommandPayload
  // Phase 20C — grading groups (single side only; definitions + snapshots).
  | CadGradingGroupCommandPayload
  | CadDesignSurfaceCommandPayload
  | CadPolylineTopologyCommandPayload
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
