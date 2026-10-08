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
import type { CadLineL1CommandKey } from './useSurveyCadLineL1Keys';
import type {
  GridGroundPanelState,
  HelmertPanelState,
} from './useSurveyCadTransformPanel';
import type { ProjectTransformPanelState } from './useSurveyCadProjectTransformPanel';
import type { FieldToFinishCadPayload } from '../../engine/fieldToFinish/cadGeneration';
import type { ActiveCommandKey } from './useSurveyCadCommandTypes';

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
  activeCommandKey: ActiveCommandKey | null;
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
  /** Raw pointer in drawing units (null when outside the viewport). Shell cursor readout. */
  pointerWorldPoint: { x: number; y: number } | null;
  /** Always-fresh pointer ref (PERF-183.1); avoids per-move root commits. */
  pointerWorldPointRef: { current: { x: number; y: number } | null };
  /** Imperative pointer channel for the shell cursor readout. */
  subscribePointerWorldPoint: (
    _listener: (_point: { x: number; y: number } | null) => void,
  ) => () => void;
  snapConstructionContext: CadSnapConstructionContext;
  snapPreferences: CadSnapPreferences;
  historyDepth: number;
  redoDepth: number;
  replaceCadProject: (_project: CadProject, _statusText?: string) => void;
  commitFieldToFinishPayload: (_payload: FieldToFinishCadPayload) => void;
  replaceFieldToFinishCatalog: (
    _catalog: import('../../engine/fieldToFinish/featureCatalog').FeatureCodeCatalog,
    _change: 'CATALOG_CHANGED' | 'FEATURE_METADATA_CHANGED' | null,
  ) => void;
  updateFieldToFinishSettings: (_settings: import('../../engine/fieldToFinish/catalogIo').FieldToFinishSettings) => void;
  startPointCommand: () => void;
  startCogoPointCommand: () => void;
  startLineCommand: () => void;
  startLineL1Command: (_key: CadLineL1CommandKey) => void;
  startRectangleCommand: () => void;
  startCircleCommand: () => void;
  startCircleDiameterCommand: () => void;
  startCircleTwoPointCommand: () => void;
  startCircleThreePointCommand: () => void;
  startCircleTangentTangentRadiusCommand: () => void;
  startCircleTangentTangentTangentCommand: () => void;
  startPolygonCommand: () => void;
  startLineTableCommand: () => void;
  startCurveTableCommand: () => void;
  startParcelTableCommand: () => void;
  startPointTableCommand: () => void;
  startParcelReportCommand: () => void;
  startParcelDescCommand: () => void;
  startPolylineCommand: () => void;
  startPlineInsertVertexCommand: () => void;
  startPlineDeleteVertexCommand: () => void;
  startTraverseCommand: () => void;
  startBatchCogoCommand: () => void;
  startMTextCommand: () => void;
  startLeaderCommand: () => void;
  startDimCommand: () => void;
  startDimLinearCommand: () => void;
  startDimAlignedCommand: () => void;
  startDimAngularCommand: () => void;
  startDimRadiusCommand: () => void;
  startDimDiameterCommand: () => void;
  startBearingLabelCommand: () => void;
  startCurveLabelCommand: () => void;
  /** Live annotation snapshot for the shell (styles + selected detail). */
  annotationSnapshot: import('../../cad-app/annotation/cadAnnotationUiTypes').CadAnnotationSnapshot;
  /** Commit one annotation UI op as an undoable history entry. */
  runAnnotationOp: (
    _op: import('../../cad-app/annotation/cadAnnotationUiTypes').CadAnnotationUiOp,
  ) => import('../../cad-app/annotation/cadAnnotationUiTypes').CadAnnotationOpResult;
  startParcelSplitBearingCommand: () => void;
  startParcelSplitAreaCommand: () => void;
  startParcelDesignateCommand: () => void;
  startParcelNumberCommand: () => void;
  startParcelLinkCommand: () => void;
  startParcelUnlinkCommand: () => void;
  startParcelCheckCommand: () => void;
  startParcelScheduleCommand: () => void;
  startParcelSharedEditCommand: (_linkId?: string) => void;
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
  startBestFitLineCommand: () => void;
  startBestFitArcCommand: () => void;
  startBestFitParabolaCommand: () => void;
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
  startCurveBetweenTwoLinesCommand: () => void;
  startCurveOnTwoLinesCommand: () => void;
  startCurveThroughPointCommand: () => void;
  startMultipleCurvesCommand: () => void;
  startCurveFromEndCommand: () => void;
  startReverseOrCompoundCommand: () => void;
  startBearingBearingIntersectionCommand: () => void;
  startBearingDistanceIntersectionCommand: () => void;
  startDistanceDistanceIntersectionCommand: () => void;
  startLineCircleIntersectionCommand: () => void;
  startPerpendicularIntersectionCommand: () => void;
  startOffsetIntersectionCommand: () => void;
  startSkewIntersectionCommand: () => void;
  startMoveCommand: () => void;
  startCopyCommand: () => void;
  startRotateCommand: () => void;
  startScaleCommand: () => void;
  startMirrorCommand: () => void;
  startAlign2DCommand: () => void;
  startHelmert2DCommand: () => void;
  startGridGroundCommand: () => void;
  startProjectTransformCommand: () => void;
  helmertPanelState: HelmertPanelState | null;
  gridGroundPanelState: GridGroundPanelState | null;
  projectTransformPanelState: ProjectTransformPanelState | null;
  submitTransformPanelText: (_text: string) => void;
  setGridGroundPanelOrigin: (_x: number, _y: number) => void;
  setProjectTransformOrigin: (_x: number, _y: number) => void;
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
  ) => import('./surveyCadPropertiesEdit').CadPropertiesEditOutcome;
  /** Dispatch one undoable command (LAYER_* family); false when rejected. */
  runLayerCommand: (_command: import('../../engine/cad/cadTransactions.types').CadCommand) => boolean;
  /**
   * Phase 19D — Properties Shared Boundary row action. Unlink dispatches
   * PARCELUNLINK; Edit Shared returns a documented "session required"
   * no-op until the interactive shared-edit session lands.
   */
  runParcelLinkAction: (
    _action: import('../../engine/cad/cadProperties').CadEntityPropertyRowAction,
  ) => { applied: boolean; reason?: string };
  /** Phase 18N — one block table/reference op (undoable); interim seam until BLOCK_* transactions land. */
  runBlockOp: (_op: import('../../cad-app/blocks/cadBlockUiCommands').CadBlockUiOp) => {
    applied: boolean;
    reason?: string;
  };
  /** Phase 18N — lazy-seed gate; returns definitions added. */
  ensureBlockSymbols: () => number;
  /**
   * Phase 18M — commit a staged LandXML preview through ONE deferred
   * LANDXML_IMPORT transaction (meshes scheduled asynchronously). Returns
   * null when the surface cache/history seam is unavailable.
   */
  runLandXmlImport: (
    _preview: import('../../engine/landxmlImport').LandXmlImportPreview,
    _fileName: string,
    _selection: import('../../engine/cad/cadLandxmlCommit').LandXmlCommitSelection,
  ) => import('../../engine/cad/cadLandxmlCommit').LandXmlCommitReport | null;
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
      pickToleranceWorld?: number;
      rawWorldPoint?: { x: number; y: number } | null;
      snapComputedScale?: number;
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
      /** PERF-183.1 — commit narrow pointer state for a live command preview. */
      reactivePreview?: boolean;
    },
  ) => void;
  /** Live viewport snap tolerance (updated on zoom/pan and pointer moves). */
  setLiveSnapTolerance: (_toleranceWorld: number) => void;
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
