import type { StationId } from './typesBase';
import type { Station } from './typesObservations';
import type { ParseIncludeError, ParseIncludeResolver, RunModeCompatibilityDiagnostic, ClusterApprovedMerge, AliasExplicitMapping, AliasRuleSummary, AliasTraceEntry, DescriptionTraceEntry, DescriptionScanSummary, GpsTopoCoordinateShot, InputStationSnapshot } from './typesDiagnostics';
import type { DirectionSetTreatmentDiagnostic } from './typesObservations';
import type {
  AngleMode,
  AngleStationOrder,
  AngleUnitsMode,
  ClusterLinkageMode,
  ClusterPassLabel,
  CoordMode,
  CoordSystemDiagnosticCode,
  CoordSystemMode,
  CrsOffReason,
  CrsProjectionModel,
  CrsStatus,
  DeltaMode,
  DescriptionReconcileMode,
  DirectiveNoEffectWarning,
  DirectiveTransition,
  DirectionSetMode,
  FaceNormalizationMode,
  GnssVectorFrame,
  GridDistanceInputMode,
  GridObservationMode,
  LocalDatumScheme,
  LonSign,
  MapMode,
  ObservationModeSettings,
  OrderMode,
  ParseCompatibilityDiagnostic,
  ParseCompatibilityMode,
  ReductionContext,
  ReductionUsageSummary,
  RobustMode,
  RunMode,
  SuspectImpactMode,
  TsCorrelationScope,
  UnitsMode,
  VerticalReductionMode,
  DatumSufficiencyReport,
} from './typesParseSettings';
import type {
  GeoidHeightDatum,
  GeoidInterpolationMethod,
  GeoidSourceFormat,
  GpsVectorMode,
  GpsWeightingMode,
} from './typesProject';

export interface ParseOptions {
  geometryDependentSigmaReference?: 'current' | 'initial';
  runMode?: RunMode;
  runModeCompatibilityDiagnostics?: RunModeCompatibilityDiagnostic[];
  parseCompatibilityMode?: ParseCompatibilityMode;
  faceNormalizationMode?: FaceNormalizationMode;
  directionFaceReliabilityFromCluster?: boolean;
  directionFaceZenithWindowDeg?: number;
  directionFaceClusterSeparationDeg?: number;
  directionFaceClusterSeparationToleranceDeg?: number;
  directionFaceClusterConfidenceMin?: number;
  directionSetTreatmentDiagnostics?: DirectionSetTreatmentDiagnostic[];
  parseCompatibilityDiagnostics?: ParseCompatibilityDiagnostic[];
  ambiguousCount?: number;
  legacyFallbackCount?: number;
  strictRejectCount?: number;
  rewriteSuggestionCount?: number;
  parseModeMigrated?: boolean;
  sourceFile?: string;
  includeFiles?: Record<string, string>;
  projectRunFiles?: Array<{
    fileId: string;
    name: string;
    order: number;
    content: string;
  }>;
  includeResolver?: ParseIncludeResolver;
  includeMaxDepth?: number;
  includeStack?: string[];
  includeTrace?: {
    parentSourceFile?: string;
    sourceFile: string;
    line: number;
  }[];
  includeErrors?: ParseIncludeError[];
  compatibilityAcceptedNoOpDirectives?: string[];
  units: UnitsMode;
  coordMode: CoordMode;
  coordSystemMode?: CoordSystemMode;
  crsId?: string;
  localDatumScheme?: LocalDatumScheme;
  averageScaleFactor?: number;
  scaleOverrideActive?: boolean;
  commonElevation?: number;
  averageGeoidHeight?: number;
  reductionContext?: ReductionContext;
  observationMode?: ObservationModeSettings;
  gridBearingMode?: GridObservationMode;
  gridDistanceMode?: GridDistanceInputMode;
  gridAngleMode?: GridObservationMode;
  gridDirectionMode?: GridObservationMode;
  coordSystemDiagnostics?: CoordSystemDiagnosticCode[];
  coordSystemWarningMessages?: string[];
  crsDatumOpId?: string;
  crsDatumFallbackUsed?: boolean;
  crsAreaOfUseStatus?: 'inside' | 'outside' | 'unknown';
  crsOutOfAreaStationCount?: number;
  crsStatus?: CrsStatus;
  crsOffReason?: CrsOffReason;
  datumSufficiencyReport?: DatumSufficiencyReport;
  directiveTransitions?: DirectiveTransition[];
  directiveNoEffectWarnings?: DirectiveNoEffectWarning[];
  parsedUsageSummary?: ReductionUsageSummary;
  usedInSolveUsageSummary?: ReductionUsageSummary;
  preanalysisMode?: boolean;
  preanalysisAccuracyThresholdMeters?: number;
  preanalysisMaxAddedSets?: number;
  order: OrderMode;
  angleUnits?: AngleUnitsMode;
  angleStationOrder?: AngleStationOrder;
  deltaMode: DeltaMode;
  mapMode: MapMode;
  mapScaleFactor?: number;
  normalize: boolean;
  applyCurvatureRefraction?: boolean;
  refractionCoefficient?: number;
  verticalReduction?: VerticalReductionMode;
  levelWeight?: number;
  originLatDeg?: number;
  originLonDeg?: number;
  crsTransformEnabled?: boolean;
  crsProjectionModel?: CrsProjectionModel;
  crsLabel?: string;
  crsGridScaleEnabled?: boolean;
  crsGridScaleFactor?: number;
  crsConvergenceEnabled?: boolean;
  crsConvergenceAngleRad?: number;
  geoidModelEnabled?: boolean;
  geoidModelId?: string;
  geoidSourceFormat?: GeoidSourceFormat;
  geoidSourcePath?: string;
  geoidSourceResolvedFormat?: GeoidSourceFormat;
  geoidSourceFallbackUsed?: boolean;
  geoidInterpolation?: GeoidInterpolationMethod;
  geoidHeightConversionEnabled?: boolean;
  geoidOutputHeightDatum?: GeoidHeightDatum;
  geoidModelLoaded?: boolean;
  geoidModelMetadata?: string;
  geoidSampleUndulationM?: number;
  geoidConvertedStationCount?: number;
  geoidSkippedStationCount?: number;
  gpsVectorMode?: GpsVectorMode;
  gpsWeightingMode?: GpsWeightingMode;
  gpsVectorFactorHorizontal?: number;
  gpsVectorFactorVertical?: number;
  gnssVectorFrameDefault?: GnssVectorFrame;
  gnssFrameConfirmed?: boolean;
  verticalDeflectionNorthSec?: number;
  verticalDeflectionEastSec?: number;
  gpsAddHiHtEnabled?: boolean;
  gpsAddHiHtHiM?: number;
  gpsAddHiHtHtM?: number;
  gpsLoopCheckEnabled?: boolean;
  levelLoopToleranceBaseMm?: number;
  levelLoopTolerancePerSqrtKmMm?: number;
  gpsAddHiHtVectorCount?: number;
  gpsAddHiHtAppliedCount?: number;
  gpsAddHiHtPositiveCount?: number;
  gpsAddHiHtNegativeCount?: number;
  gpsAddHiHtNeutralCount?: number;
  gpsAddHiHtDefaultZeroCount?: number;
  gpsAddHiHtMissingHeightCount?: number;
  gpsAddHiHtScaleMin?: number;
  gpsAddHiHtScaleMax?: number;
  gpsOffsetObservationCount?: number;
  lonSign?: LonSign;
  currentInstrument?: string;
  projectDefaultInstrument?: string;
  edmMode?: 'additive' | 'propagated';
  applyCentering?: boolean;
  addCenteringToExplicit?: boolean;
  debug?: boolean;
  angleMode?: AngleMode;
  tsCorrelationEnabled?: boolean;
  tsCorrelationRho?: number;
  tsCorrelationScope?: TsCorrelationScope;
  robustMode?: RobustMode;
  robustK?: number;
  qFixLinearSigmaM?: number;
  qFixAngularSigmaSec?: number;
  prismEnabled?: boolean;
  prismOffset?: number;
  prismScope?: 'global' | 'set';
  positionalToleranceEnabled?: boolean;
  positionalToleranceConstantMm?: number;
  positionalTolerancePpm?: number;
  positionalToleranceConfidencePercent?: number;
  ellipseStationIds?: StationId[];
  relativeLinePairs?: Array<{ from: StationId; to: StationId }>;
  positionalTolerancePairs?: Array<{ from: StationId; to: StationId }>;
  rotationAngleRad?: number;
  lostStationIds?: StationId[];
  autoAdjustEnabled?: boolean;
  autoAdjustMaxCycles?: number;
  autoAdjustMaxRemovalsPerCycle?: number;
  autoAdjustStdResThreshold?: number;
  suspectImpactMode?: SuspectImpactMode;
  autoSideshotEnabled?: boolean;
  directionSetMode?: DirectionSetMode;
  clusterDetectionEnabled?: boolean;
  clusterLinkageMode?: ClusterLinkageMode;
  clusterTolerance2D?: number;
  clusterTolerance3D?: number;
  clusterApprovedMerges?: ClusterApprovedMerge[];
  clusterPassLabel?: ClusterPassLabel;
  clusterDualPassRan?: boolean;
  clusterApprovedMergeCount?: number;
  preferExternalInstruments?: boolean;
  aliasExplicitCount?: number;
  aliasRuleCount?: number;
  aliasExplicitMappings?: AliasExplicitMapping[];
  aliasRuleSummaries?: AliasRuleSummary[];
  aliasTrace?: AliasTraceEntry[];
  descriptionTrace?: DescriptionTraceEntry[];
  descriptionScanSummary?: DescriptionScanSummary[];
  descriptionRepeatedStationCount?: number;
  descriptionConflictCount?: number;
  descriptionReconcileMode?: DescriptionReconcileMode;
  descriptionAppendDelimiter?: string;
  reconciledDescriptions?: Record<StationId, string>;
  displayLineBySourceLine?: Record<number, number>;
  gpsTopoShots?: GpsTopoCoordinateShot[];
  inputStationSnapshots?: InputStationSnapshot[];
  rawDistanceCombinedFactorByObsId?: Record<number, number>;
  rawDirectionSetCorrectionByObsId?: Record<number, number>;
  plannedObservationCount?: number;
  preanalysisSyntheticAdditionIds?: string[];
  stationSeparator?: string;
  dataInputEnabled?: boolean;
  threeReduceMode?: boolean;
  linearMultiplier?: number;
  elevationInputMode?: 'orthometric' | 'ellipsoid';
  projectElevationMeters?: number;
}
