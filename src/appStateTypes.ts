import type {
  AdjustedPointsColumnId,
  AdjustedPointsExportSettings,
  AngleMode,
  CoordMode,
  CoordSystemDiagnosticCode,
  CoordSystemMode,
  CrsOffReason,
  CrsProjectionModel,
  CrsStatus,
  DatumSufficiencyReport,
  DeltaMode,
  DirectiveNoEffectWarning,
  DirectiveTransition,
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
  ParseCompatibilityDiagnostic,
  ParseCompatibilityMode,
  PrecisionReportingMode,
  ProjectExportFormat,
  ReductionUsageSummary,
  RobustMode,
  RunMode,
  SuspectImpactMode,
  TsCorrelationScope,
  VerticalReductionMode,
  InstrumentLibrary,
  CustomLevelLoopTolerancePreset,
  Observation,
} from './types';
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
import type { SavedRunSnapshot } from './engine/qaWorkflow';

export type Units = 'm' | 'ft';
export type UiTheme =
  | 'gruvbox-dark'
  | 'gruvbox-light'
  | 'catppuccin-mocha'
  | 'catppuccin-latte';
export type ListingSortCoordinatesBy = 'input' | 'name';
export type ListingSortObservationsBy = 'input' | 'name' | 'residual';
export type SolveProfile =
  | 'webnet'
  | 'industry-parity-current'
  | 'industry-parity-legacy'
  | 'legacy-compat'
  | 'industry-parity';
export type ProjectOptionsTab =
  | 'adjustment'
  | 'general'
  | 'instrument'
  | 'listing-file'
  | 'other-files'
  | 'special'
  | 'gps'
  | 'modeling';
export type WorkspaceTabKey = 'report' | 'processing-summary' | 'industry-output' | 'map';
export type CrsCatalogGroupFilter = 'all' | 'global' | 'canada-utm' | 'canada-mtm' | 'canada-provincial';
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
  tableRowLimits: Record<string, number>;
  pinnedDetailSections: WorkspacePinnedDetailSection[];
  collapsedDetailSections: Record<CollapsibleDetailSectionId, boolean>;
};
export type WorkspaceSelectionState = {
  stationId: string | null;
  observationId: number | null;
  sourceLine: number | null;
  origin: 'report' | 'map' | 'suspect' | 'compare' | null;
};
export type WorkspaceReviewState = {
  reportView: ReportViewStateSnapshot;
  selection: WorkspaceSelectionState;
  pinnedObservationIds: number[];
};
export type WorkspaceViewState = {
  activeTab: WorkspaceTabKey;
  splitPercent: number;
  isSidebarOpen: boolean;
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
  force2DOutput: boolean;
  nextSyntheticId: number;
  nextSourceId?: number;
  conflicts: ImportConflict[];
  conflictResolutions: Record<string, ImportResolution>;
  conflictRenameValues: Record<string, string>;
};
export type WorkspaceDraftSnapshot = {
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

export type RunDiagnostics = {
  solveProfile: SolveProfile;
  parity: boolean;
  runMode: RunMode;
  preanalysisMode: boolean;
  plannedObservationCount: number;
  autoSideshotEnabled: boolean;
  autoAdjustEnabled: boolean;
  autoAdjustMaxCycles: number;
  autoAdjustMaxRemovalsPerCycle: number;
  autoAdjustStdResThreshold: number;
  suspectImpactMode: SuspectImpactMode;
  directionSetMode: 'reduced' | 'raw';
  mapMode: MapMode;
  mapScaleFactor: number;
  normalize: boolean;
  faceNormalizationMode: FaceNormalizationMode;
  angleMode: AngleMode;
  verticalReduction: VerticalReductionMode;
  applyCurvatureRefraction: boolean;
  refractionCoefficient: number;
  tsCorrelationEnabled: boolean;
  tsCorrelationScope: TsCorrelationScope;
  tsCorrelationRho: number;
  robustMode: RobustMode;
  robustK: number;
  parseCompatibilityMode: ParseCompatibilityMode;
  parseModeMigrated: boolean;
  parseCompatibilityDiagnostics: ParseCompatibilityDiagnostic[];
  ambiguousCount: number;
  legacyFallbackCount: number;
  strictRejectCount: number;
  rewriteSuggestionCount: number;
  qFixLinearSigmaM: number;
  qFixAngularSigmaSec: number;
  coordSystemMode: CoordSystemMode;
  crsId: string;
  localDatumScheme: LocalDatumScheme;
  averageScaleFactor: number;
  scaleOverrideActive: boolean;
  commonElevation: number;
  averageGeoidHeight: number;
  gnssVectorFrameDefault: GnssVectorFrame;
  gnssFrameConfirmed: boolean;
  verticalDeflectionNorthSec: number;
  verticalDeflectionEastSec: number;
  observationMode: ObservationModeSettings;
  gridBearingMode: GridObservationMode;
  gridDistanceMode: GridDistanceInputMode;
  gridAngleMode: GridObservationMode;
  gridDirectionMode: GridObservationMode;
  datumSufficiencyReport?: DatumSufficiencyReport;
  parsedUsageSummary?: ReductionUsageSummary;
  usedInSolveUsageSummary?: ReductionUsageSummary;
  directiveTransitions?: DirectiveTransition[];
  directiveNoEffectWarnings?: DirectiveNoEffectWarning[];
  coordSystemDiagnostics: CoordSystemDiagnosticCode[];
  coordSystemWarningMessages: string[];
  crsStatus?: CrsStatus;
  crsOffReason?: CrsOffReason;
  crsDatumOpId?: string;
  crsDatumFallbackUsed: boolean;
  crsAreaOfUseStatus: 'inside' | 'outside' | 'unknown';
  crsOutOfAreaStationCount: number;
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
  geoidSourceResolvedFormat: GeoidSourceFormat;
  geoidSourceFallbackUsed: boolean;
  geoidInterpolation: GeoidInterpolationMethod;
  geoidHeightConversionEnabled: boolean;
  geoidOutputHeightDatum: GeoidHeightDatum;
  gpsLoopCheckEnabled: boolean;
  levelLoopToleranceBaseMm: number;
  levelLoopTolerancePerSqrtKmMm: number;
  gpsAddHiHtEnabled: boolean;
  gpsAddHiHtHiM: number;
  gpsAddHiHtHtM: number;
  gpsAddHiHtVectorCount: number;
  gpsAddHiHtAppliedCount: number;
  gpsAddHiHtPositiveCount: number;
  gpsAddHiHtNegativeCount: number;
  gpsAddHiHtNeutralCount: number;
  gpsAddHiHtDefaultZeroCount: number;
  gpsAddHiHtMissingHeightCount: number;
  gpsAddHiHtScaleMin: number;
  gpsAddHiHtScaleMax: number;
  geoidModelLoaded: boolean;
  geoidModelMetadata: string;
  geoidSampleUndulationM?: number;
  geoidConvertedStationCount: number;
  geoidSkippedStationCount: number;
  prismEnabled: boolean;
  prismOffset: number;
  prismScope: 'global' | 'set';
  rotationAngleRad: number;
  profileDefaultInstrumentFallback: boolean;
  currentInstrumentCode: string;
  currentInstrumentDesc: string;
  currentInstrumentLevStdMmPerKm: number;
  projectInstrumentLibrary?: InstrumentLibrary;
  angleCenteringModel: 'geometry-aware-correlated-rays';
  defaultSigmaCount: number;
  defaultSigmaByType: string;
  stochasticDefaultsSummary: string;
};

export type RunSettingsSnapshot = {
  maxIterations: number;
  convergenceLimit: number;
  precisionReportingMode?: PrecisionReportingMode;
  units: Units;
  solveProfile: SolveProfile;
  runMode: RunMode;
  coordMode: CoordMode;
  coordSystemMode: CoordSystemMode;
  crsId: string;
  directionSetMode: 'reduced' | 'raw';
  mapMode: MapMode;
  mapScaleFactor: number;
  verticalReduction: VerticalReductionMode;
  applyCurvatureRefraction: boolean;
  tsCorrelationEnabled: boolean;
  tsCorrelationScope: TsCorrelationScope;
  tsCorrelationRho: number;
  robustMode: RobustMode;
  robustK: number;
  clusterDetectionEnabled: boolean;
  autoSideshotEnabled: boolean;
  autoAdjustEnabled: boolean;
  autoAdjustMaxCycles: number;
  autoAdjustMaxRemovalsPerCycle: number;
  autoAdjustStdResThreshold: number;
  suspectImpactMode: SuspectImpactMode;
  selectedInstrument: string;
};

export type PersistedSavedRunSnapshot = SavedRunSnapshot<RunSettingsSnapshot, RunDiagnostics>;
