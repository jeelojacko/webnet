import type {
  AdjustedPointsColumnId,
  AdjustedPointsExportSettings,
  AngleMode,
  CoordMode,
  CoordSystemMode,
  CrsProjectionModel,
  DeltaMode,
  FaceNormalizationMode,
  GeoidHeightDatum,
  GeoidInterpolationMethod,
  GeoidSourceFormat,
  GnssVectorFrame,
  GridDistanceInputMode,
  GridObservationMode,
  LocalDatumScheme,
  MapMode,
  ObservationModeSettings,
  OrderMode,
  PlanningMapState,
  ParseCompatibilityMode,
  PrecisionReportingMode,
  ProjectExportFormat,
  RobustMode,
  RunMode,
  SuspectImpactMode,
  TsCorrelationScope,
  VerticalReductionMode,
  InstrumentLibrary,
  CustomLevelLoopTolerancePreset,
  Observation,
} from './types';
import type { ListingSortObservationsBy } from './listingSortObservations';
export type { ListingSortObservationsBy } from './listingSortObservations';
import type { CollapsibleDetailSectionId } from './components/report/reportSectionRegistry';
import type {
  ExternalImportAngleMode,
  ImportedDataset,
  ImportedInputNotice,
} from './engine/importers';
import type {
  ImportConflict,
  ImportResolution,
} from './engine/importConflictReview';
import type {
  ImportReviewComparisonMode,
  ImportReviewModel,
  ImportReviewOutputPreset,
  ImportReviewRowTypeOverride,
  ImportReviewWorkspaceSource,
} from './engine/importReview';
import type { PreparedAssociatedProjectSettingsImport } from './hooks/useProjectFileWorkflow';
import type { CadDrawingDocument } from './engine/cad/cadTypes';
import type { PersistedSavedRunSnapshot, SolveProfile, Units } from './appRunStateTypes';

export type {
  PersistedSavedRunSnapshot,
  RunDiagnostics,
  RunSettingsSnapshot,
  SolveProfile,
  Units,
} from './appRunStateTypes';

export type UiTheme =
  | 'gruvbox-dark'
  | 'gruvbox-light'
  | 'vscode-dark'
  | 'catppuccin-mocha'
  | 'catppuccin-latte';
export type ListingSortCoordinatesBy = 'input' | 'name';
export type ProjectOptionsTab =
  | 'project-files'
  | 'adjustment'
  | 'general'
  | 'instrument'
  | 'listing-file'
  | 'other-files'
  | 'special'
  | 'gps';
export type WorkspaceTabKey =
  | 'report'
  | 'processing-summary'
  | 'industry-output'
  | 'map'
  | 'survey-cad';
export type CrsCatalogGroupFilter =
  | 'all'
  | 'global'
  | 'canada-utm'
  | 'canada-mtm'
  | 'canada-provincial'
  | 'us-spcs';
export type ClusterReviewStatus = 'pending' | 'approve' | 'reject';
export type ClusterReviewDecision = {
  status: ClusterReviewStatus;
  canonicalId: string;
};
export type ReportEllipseMode = '1sigma' | '95';
export type ReportObservationTypeFilter = 'all' | Observation['type'];
export type ReportExclusionFilter = 'all' | 'included' | 'excluded';
export type WorkspacePinnedDetailSection = {
  id: CollapsibleDetailSectionId;
  label: string;
};
export type ReportViewStateSnapshot = {
  ellipseMode: ReportEllipseMode;
  reportFilterQuery: string;
  reportObservationTypeFilter: ReportObservationTypeFilter;
  reportExclusionFilter: ReportExclusionFilter;
  reviewConflictOnly: boolean;
  reviewAdjustedOnly: boolean;
  reviewImportedGroupFilter: string;
  tableRowLimits: Record<string, number>;
  pinnedDetailSections: WorkspacePinnedDetailSection[];
  collapsedDetailSections: Record<CollapsibleDetailSectionId, boolean>;
};
export type WorkspaceSelectionState = {
  stationId: string | null;
  observationId: number | null;
  sourceLine: number | null;
  origin: 'report' | 'map' | 'suspect' | 'compare' | 'queue' | null;
};
export type RunFreshness =
  | 'ready'
  | 'dirty-needs-rerun'
  | 'running'
  | 'result-stale'
  | 'reviewing';
export type WorkspaceReviewState = {
  reportView: ReportViewStateSnapshot;
  selection: WorkspaceSelectionState;
  pinnedObservationIds: number[];
  runFreshness: RunFreshness;
  blockingReasons: string[];
};
export type WorkspaceViewState = {
  activeTab: WorkspaceTabKey;
  splitPercent: number;
  isSidebarOpen: boolean;
  mapDeclutterPreset?: 'standard' | 'dense-review';
  planningMap?: PlanningMapState;
  review: WorkspaceReviewState;
  selection?: WorkspaceSelectionState;
  pinnedObservationIds?: number[];
};
export type WorkspaceComparisonViewState = {
  stationMovementThreshold: number;
  residualDeltaThreshold: number;
};
export type ImportReviewDraftSnapshot = {
  sourceName: string;
  notice: ImportedInputNotice;
  sources?: ImportReviewWorkspaceSource[];
  dataset: ImportedDataset;
  reviewModel: ImportReviewModel;
  comparisonSourceName?: string;
  comparisonNotice?: ImportedInputNotice;
  comparisonDataset?: ImportedDataset;
  comparisonMode: ImportReviewComparisonMode;
  excludedItemIds: string[];
  fixedItemIds: string[];
  groupLabels: Record<string, string>;
  groupComments: Record<string, string>;
  rowOverrides: Record<string, string>;
  rowTypeOverrides: Record<string, ImportReviewRowTypeOverride>;
  preset: ImportReviewOutputPreset;
  importFaceNormalizationMode: Extract<FaceNormalizationMode, 'on' | 'off'>;
  importAngleMode?: ExternalImportAngleMode;
  importStyle?: 'generic' | 'industry-style';
  stagedAssociatedSettings?: PreparedAssociatedProjectSettingsImport | null;
  force2DOutput: boolean;
  nextSyntheticId: number;
  nextSourceId?: number;
  conflicts: ImportConflict[];
  conflictResolutions: Record<string, ImportResolution>;
  conflictRenameValues: Record<string, string>;
};
export type WorkspaceDraftSnapshot = {
  listingSortModeVersion?: number;
  input: string;
  projectIncludeFiles: Record<string, string>;
  settings: SettingsState;
  parseSettings: ParseSettings;
  exportFormat: ProjectExportFormat;
  adjustedPointsExportSettings: AdjustedPointsExportSettings;
  projectInstruments: InstrumentLibrary;
  selectedInstrument: string;
  levelLoopCustomPresets: CustomLevelLoopTolerancePreset[];
  geoidSourceDataBase64: string | null;
  geoidSourceDataLabel: string;
  surveyCadState?: CadDrawingDocument;
  view: WorkspaceViewState;
  comparisonView: WorkspaceComparisonViewState;
  savedRunSnapshots: PersistedSavedRunSnapshot[];
  importReview?: ImportReviewDraftSnapshot | null;
};
export type WorkspaceRecoveryRecord = {
  version: 1;
  savedAt: string;
  snapshot: WorkspaceDraftSnapshot;
};

export type SettingsState = {
  maxIterations: number;
  convergenceLimit: number;
  precisionReportingMode?: PrecisionReportingMode;
  units: Units;
  uiTheme: UiTheme;
  mapShowLostStations: boolean;
  map3dEnabled: boolean;
  showRunComparisonPanel: boolean;
  showReviewQueuePanel: boolean;
  listingShowLostStations: boolean;
  listingShowCoordinates: boolean;
  listingShowObservationsResiduals: boolean;
  listingShowErrorPropagation: boolean;
  listingShowProcessingNotes: boolean;
  listingShowAzimuthsBearings: boolean;
  listingSortCoordinatesBy: ListingSortCoordinatesBy;
  listingSortObservationsBy: ListingSortObservationsBy;
  listingObservationLimit: number;
};

export type ParseSettings = {
  geometryDependentSigmaReference?: 'current' | 'initial';
  solveProfile: SolveProfile;
  coordMode: CoordMode;
  coordSystemMode: CoordSystemMode;
  crsId: string;
  localDatumScheme: LocalDatumScheme;
  averageScaleFactor: number;
  commonElevation: number;
  averageGeoidHeight: number;
  gnssVectorFrameDefault: GnssVectorFrame;
  gnssFrameConfirmed: boolean;
  verticalDeflectionNorthSec: number;
  verticalDeflectionEastSec: number;
  observationMode?: ObservationModeSettings;
  gridBearingMode: GridObservationMode;
  gridDistanceMode: GridDistanceInputMode;
  gridAngleMode: GridObservationMode;
  gridDirectionMode: GridObservationMode;
  runMode: RunMode;
  preanalysisMode: boolean;
  preanalysisAccuracyThresholdMeters?: number;
  preanalysisMaxAddedSets?: number;
  clusterDetectionEnabled: boolean;
  autoSideshotEnabled: boolean;
  autoAdjustEnabled: boolean;
  autoAdjustMaxCycles: number;
  autoAdjustMaxRemovalsPerCycle: number;
  autoAdjustStdResThreshold: number;
  suspectImpactMode: SuspectImpactMode;
  order: OrderMode;
  angleUnits: 'dms' | 'dd';
  angleStationOrder: 'atfromto' | 'fromatto';
  angleMode: AngleMode;
  deltaMode: DeltaMode;
  mapMode: MapMode;
  mapScaleFactor?: number;
  normalize: boolean;
  faceNormalizationMode: FaceNormalizationMode;
  applyCurvatureRefraction: boolean;
  refractionCoefficient: number;
  verticalReduction: VerticalReductionMode;
  levelWeight?: number;
  levelLoopToleranceBaseMm: number;
  levelLoopTolerancePerSqrtKmMm: number;
  crsTransformEnabled: boolean;
  crsProjectionModel: CrsProjectionModel;
  crsLabel: string;
  crsGridScaleEnabled: boolean;
  crsGridScaleFactor: number;
  crsConvergenceEnabled: boolean;
  crsConvergenceAngleRad: number;
  geoidModelEnabled: boolean;
  geoidModelId: string;
  geoidSourceFormat: GeoidSourceFormat;
  geoidSourcePath: string;
  geoidInterpolation: GeoidInterpolationMethod;
  geoidHeightConversionEnabled: boolean;
  geoidOutputHeightDatum: GeoidHeightDatum;
  gpsLoopCheckEnabled: boolean;
  gpsAddHiHtEnabled: boolean;
  gpsAddHiHtHiM: number;
  gpsAddHiHtHtM: number;
  qFixLinearSigmaM: number;
  qFixAngularSigmaSec: number;
  prismEnabled: boolean;
  prismOffset: number;
  prismScope: 'global' | 'set';
  positionalToleranceEnabled?: boolean;
  positionalToleranceConstantMm?: number;
  positionalTolerancePpm?: number;
  positionalToleranceConfidencePercent?: number;
  directionSetMode?: 'reduced' | 'raw';
  descriptionReconcileMode: 'first' | 'append';
  descriptionAppendDelimiter: string;
  lonSign: 'west-positive' | 'west-negative';
  tsCorrelationEnabled: boolean;
  tsCorrelationRho: number;
  tsCorrelationScope: TsCorrelationScope;
  robustMode: RobustMode;
  robustK: number;
  parseCompatibilityMode: ParseCompatibilityMode;
  parseModeMigrated: boolean;
};
