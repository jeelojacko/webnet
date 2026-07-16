import type { CadParcelReportSummary } from '../../engine/cad/cadCogo';
import type { CadPropertiesPanelState } from '../../engine/cad/cadProperties';
import type { CadCogoComputation } from '../../engine/cad/cadCogoTypes';
import type {
  CadBounds,
  CadDisplayPrimitive,
  CadDisplayScene,
  CadGripHandle,
  CadParcelLayoutSettings,
  CadSnapCandidate,
  CadSnapConstructionContext,
  CadSnapKind,
  CadEntityId,
  CadProject,
  MlightcadSpikeScene,
} from '../../engine/cad/cadTypes';
import type { CadSnapPreferences } from './useSurveyCadSnapping';

export interface CommandHoverTarget {
  entityId: string;
  segmentId?: string;
  point: { x: number; y: number };
  extendMode?: boolean;
}

export interface UseSurveyCadWorkspaceResult {
  cadProject: CadProject;
  displayScene: CadDisplayScene;
  mlightcadScene: MlightcadSpikeScene;
  gripHandles: CadGripHandle[];
  gripPreviewPrimitives: CadDisplayPrimitive[];
  activeGripHandleId: string | null;
  selectedEntityIds: string[];
  selectedEntities: import('../../engine/cad/cadTypes').CadEntity[];
  selectedParcelReport: CadParcelReportSummary | null;
  reportedComputation: CadCogoComputation | null;
  propertiesPanelState: CadPropertiesPanelState | null;
  activeBatchCogoDraft: {
    inputValue: string;
    startPoint: { label: string; x: number; y: number } | null;
    startPointSource: 'selected' | 'input' | null;
    endPoint: { label: string; x: number; y: number } | null;
    previewRows: Array<{
      lineNumber: number;
      input: string;
      kind: 'start' | 'line' | 'curve';
      status: 'ok' | 'warning' | 'error';
      summary: string;
    }>;
    warnings: Array<{
      code: string;
      message: string;
      severity: 'info' | 'warning' | 'error';
    }>;
    generatedPointCount: number;
    generatedLineCount: number;
    generatedArcCount: number;
    canCommit: boolean;
  } | null;
  activeTraverseDraft: {
    points: Array<{ label: string; x: number; y: number }>;
    mode: 'open' | 'closed' | 'point-to-point';
    closePoint: { label: string; x: number; y: number } | null;
    legs: Array<{
      fromLabel: string;
      toLabel: string;
      bearing: string;
      distance: number;
      inputValue: string;
    }>;
    sideshots: Array<{
      occupyLabel: string;
      backsightLabel: string;
      side: 'left' | 'right';
      angleDeg: number;
      distance: number;
      inputValue: string;
      point: {
        label: string;
        x: number;
        y: number;
      };
    }>;
    totalLength: number;
    closureTargetLabel: string | null;
    closureDeltaX: number | null;
    closureDeltaY: number | null;
    closureDistance: number | null;
    closureBearing: string | null;
    closureRatio: number | null;
    adjustment: {
      method: 'angular' | 'bowditch' | 'transit';
      targetLabel: string;
      rawClosureDistance: number;
      adjustedClosureDistance: number;
      rawClosureBearing: string | null;
      adjustedClosureBearing: string | null;
      angularCorrectionPerLegSec: number | null;
    } | null;
  } | null;
  selectionCount: number;
  canUndo: boolean;
  canRedo: boolean;
  canUseSelectedLineCoreCogo: boolean;
  canUseSelectedLinePairIntersection: boolean;
  canUseSelectedArcCurveCogo: boolean;
  activeCommandKey:
    | 'POINT'
    | 'COGO_POINT'
    | 'LINE'
    | 'PLINE'
    | 'TRAVERSE'
    | 'BATCH_COGO'
    | 'ARC_3PT'
    | 'ARC_SCE'
    | 'ARC_CSE'
    | 'ARC_SCA'
    | 'ARC_CSA'
    | 'ARC_SCL'
    | 'ARC_CSL'
    | 'ARC_SEA'
    | 'ARC_SED'
    | 'ARC_SER'
    | 'CONTINUE_CURVE'
    | 'TANGENT_CURVE'
    | 'INVERSE'
    | 'MULTI_INVERSE'
    | 'AREA'
    | 'BEARING_REPORT'
    | 'DISTANCE_REPORT'
    | 'TURNED_POINT'
    | 'DEFLECT_POINT'
    | 'POINT_ALONG_LINE'
    | 'EXTEND_LINE'
    | 'OFFSET_POINT'
    | 'ALIGNMENT_OFFSET_CREATE'
    | 'ALIGNMENT_STATION_EQUATION'
    | 'ALIGNMENT_OFFSET_POINT'
    | 'ALIGNMENT_INTERVAL_POINTS'
    | 'CURVE_SOLVER'
    | 'RADIAL_BEARING'
    | 'POINT_ON_CURVE'
    | 'SUBDIVIDE_CURVE'
    | 'OFFSET_CURVE'
    | 'PI_CURVE'
    | 'CHORD_BEARING_CURVE'
    | 'REVERSE_CURVE'
    | 'COMPOUND_CURVE'
    | 'BEARING_BEARING_INTX'
    | 'BEARING_DISTANCE_INTX'
    | 'DISTANCE_DISTANCE_INTX'
    | 'LINE_CIRCLE_INTX'
    | 'PERP_INTX'
    | 'OFFSET_INTX'
    | 'SKEW_INTX'
    | 'PARCEL_SPLIT_BEARING'
    | 'PARCEL_SPLIT_AREA'
    | 'MOVE'
    | 'COPY'
    | 'EXTEND'
    | 'TRIM'
    | 'FILLET'
    | 'PASTE'
    | null;
  commandInputValue: string;
  statusText: string;
  commandHelpText: string;
  commandPreviewPrimitives: CadDisplayPrimitive[];
  commandEntityOpacityOverrides: Record<string, number>;
  commandExpectsPointPick: boolean;
  canUseActiveSnap: boolean;
  canCycleActiveSnap: boolean;
  canFinishCommand: boolean;
  canCloseTraverseDraft: boolean;
  canCreateIntersectionPoint: boolean;
  canCreateAlignment: boolean;
  canReportAlignmentStation: boolean;
  canCreateAlignmentOffset: boolean;
  canCreateAlignmentStationEquation: boolean;
  canCreateAlignmentOffsetPoint: boolean;
  canCreateAlignmentIntervalPoints: boolean;
  canCreateParcel: boolean;
  canSplitParcelByBearing: boolean;
  canSplitParcelByArea: boolean;
  canReportParcelGap: boolean;
  canReportParcelDiagnostics: boolean;
  canReportParcelOverlap: boolean;
  canSplitParcelByLine: boolean;
  canContinueCurve: boolean;
  canTrimSelection: boolean;
  canExtendSelection: boolean;
  isGripEditing: boolean;
  activeSnap: CadSnapCandidate | null;
  nearbySnaps: readonly CadSnapCandidate[];
  snapConstructionContext: CadSnapConstructionContext;
  snapPreferences: CadSnapPreferences;
  historyDepth: number;
  redoDepth: number;
  startPointCommand: () => void;
  startCogoPointCommand: () => void;
  startLineCommand: () => void;
  startPolylineCommand: () => void;
  startTraverseCommand: () => void;
  startBatchCogoCommand: () => void;
  startParcelSplitBearingCommand: () => void;
  startParcelSplitAreaCommand: () => void;
  startArc3PointCommand: () => void;
  startArcStartCenterEndCommand: () => void;
  startArcCenterStartEndCommand: () => void;
  startArcStartCenterAngleCommand: () => void;
  startArcCenterStartAngleCommand: () => void;
  startArcStartCenterChordCommand: () => void;
  startArcCenterStartChordCommand: () => void;
  startArcStartEndAngleCommand: () => void;
  startArcStartEndDirectionCommand: () => void;
  startArcStartEndRadiusCommand: () => void;
  startContinueCurveCommand: () => void;
  startTangentCurveCommand: () => void;
  startInverseCommand: () => void;
  startMultiInverseCommand: () => void;
  startAreaCommand: () => void;
  startBearingReportCommand: () => void;
  startDistanceReportCommand: () => void;
  startTurnedPointCommand: () => void;
  startDeflectionPointCommand: () => void;
  startPointAlongLineCommand: () => void;
  startExtendLineCommand: () => void;
  startOffsetPointCommand: () => void;
  startAlignmentOffsetCreateCommand: () => void;
  startAlignmentStationEquationCommand: () => void;
  startAlignmentOffsetPointCommand: () => void;
  startAlignmentIntervalPointsCommand: () => void;
  startCurveSolverCommand: () => void;
  startRadialBearingCommand: () => void;
  startPointOnCurveCommand: () => void;
  startSubdivideCurveCommand: () => void;
  startOffsetCurveCommand: () => void;
  startPiCurveCommand: () => void;
  startChordBearingCurveCommand: () => void;
  startReverseCurveCommand: () => void;
  startCompoundCurveCommand: () => void;
  startBearingBearingIntersectionCommand: () => void;
  startBearingDistanceIntersectionCommand: () => void;
  startDistanceDistanceIntersectionCommand: () => void;
  startLineCircleIntersectionCommand: () => void;
  startPerpendicularIntersectionCommand: () => void;
  startOffsetIntersectionCommand: () => void;
  startSkewIntersectionCommand: () => void;
  startMoveCommand: () => void;
  startCopyCommand: () => void;
  startExtendCommand: () => void;
  startTrimCommand: () => void;
  startFilletCommand: () => void;
  createIntersectionPoint: () => void;
  createAlignmentFromSelection: () => void;
  reportAlignmentStationFromSelection: () => void;
  createParcelFromSelection: () => void;
  reportParcelGapFromSelection: () => void;
  reportParcelDiagnosticsFromSelection: () => void;
  reportParcelOverlapFromSelection: () => void;
  splitParcelBySelectedLine: () => void;
  commitParcelSlideLayout: (_options: {
    parcelEntityId: CadEntityId;
    frontageEntityId?: CadEntityId | null;
    frontageParcelSegmentIds?: string[] | null;
    targetAreaSquareMeters: number;
    minFrontageMeters: number;
    alternative: 'start' | 'end';
    settings: CadParcelLayoutSettings;
  }) => void;
  commitParcelSwingLayout: (_options: {
    parcelEntityId: CadEntityId;
    frontageEntityId?: CadEntityId | null;
    frontageParcelSegmentIds?: string[] | null;
    targetAreaSquareMeters: number;
    minFrontageMeters: number;
    alternative: 'start' | 'end';
    settings: CadParcelLayoutSettings;
  }) => void;
  commitParcelAutoLayout: (_options: {
    parcelEntityId: CadEntityId;
    frontageEntityId?: CadEntityId | null;
    frontageParcelSegmentIds?: string[] | null;
    tool: 'slide' | 'swing';
    settings: CadParcelLayoutSettings;
  }) => void;
  cancelActiveCommand: () => void;
  finishActiveCommand: () => void;
  setCommandInputValue: (_value: string) => void;
  appendCommandInputValue: (_value: string) => void;
  backspaceCommandInputValue: () => void;
  submitCommandInput: () => void;
  useActiveSnap: () => void;
  editTraverseDraftLeg: (_legIndex: number) => void;
  editPropertiesField: (
    _entityId: CadEntityId,
    _field: import('../../engine/cad/cadProperties').CadEntityPropertyEditField,
    _value: string,
  ) => boolean;
  replaceTraverseDraftLeg: (_legIndex: number, _inputValue: string) => boolean;
  appendTraverseDraftPoint: (_inputValue: string) => boolean;
  insertTraverseDraftLeg: (_legIndex: number, _inputValue: string) => boolean;
  moveTraverseDraftLeg: (_legIndex: number, _direction: -1 | 1) => boolean;
  applyTraverseDraftAdjustment: (_method: 'angular' | 'bowditch' | 'transit') => boolean;
  clearTraverseDraftAdjustment: () => void;
  setTraverseDraftMode: (_mode: 'open' | 'closed' | 'point-to-point') => void;
  setTraverseDraftClosePoint: (_point: {
    label: string;
    x: number;
    y: number;
  } | null) => void;
  addTraverseDraftSideshot: (_occupyPointIndex: number, _inputValue: string) => boolean;
  removeTraverseDraftSideshot: (_sideshotIndex: number) => void;
  rewindTraverseDraftToPointCount: (_pointCount: number) => void;
  closeTraverseDraftLoop: () => void;
  setBatchCogoInputValue: (_value: string) => void;
  commitBatchCogoDraft: () => void;
  consumeInteractionPoint: (
    _worldPoint: { x: number; y: number },
    _label?: string,
    _options?: {
      snapSourceSegmentId?: string;
      snapSourceEntityId?: string;
      snapKind?: CadSnapKind;
      extendMode?: boolean;
    },
  ) => void;
  handleEnterKey: () => void;
  handleEscapeKey: () => void;
  selectEntity: (_entityId: string, _appendToSelection?: boolean) => void;
  selectEntities: (_entityIds: string[], _appendToSelection?: boolean) => void;
  startGripEdit: (_handleId: string) => void;
  updateGripEdit: (_worldPoint: { x: number; y: number }) => void;
  finishGripEdit: (_worldPoint?: { x: number; y: number }) => void;
  cancelGripEdit: () => void;
  updatePointerWorldPoint: (
    _worldPoint: { x: number; y: number } | null,
    _toleranceWorld?: number,
    _options?: {
      visibleBounds?: CadBounds | null;
      lockConstruction?: boolean;
      restrictedGripHandles?: readonly CadGripHandle[];
    },
  ) => void;
  setCommandHoverTarget: (_hoverTarget: CommandHoverTarget | null) => void;
  setSnapPreference: (_kind: keyof CadSnapPreferences, _enabled: boolean) => void;
  cycleActiveSnap: () => void;
  selectAll: () => void;
  clearSelection: () => void;
  eraseSelection: () => void;
  startPasteFromClipboard: (_entityIds: string[]) => void;
  undo: () => void;
  redo: () => void;
}
