import type {
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
  InstrumentLibrary,
  LocalDatumScheme,
  MapMode,
  ObservationModeSettings,
  OrderMode,
  ParseCompatibilityDiagnostic,
  ParseCompatibilityMode,
  PrecisionReportingMode,
  ReductionUsageSummary,
  RobustMode,
  RunMode,
  SuspectImpactMode,
  TsCorrelationScope,
  VerticalReductionMode,
} from './types';
import type { SavedRunSnapshot } from './engine/qaWorkflow';

export type Units = 'm' | 'ft';
export type SolveProfile =
  | 'webnet'
  | 'industry-parity-current'
  | 'industry-parity-legacy'
  | 'legacy-compat'
  | 'industry-parity';

export type RunDiagnostics = {
  solveProfile: SolveProfile;
  parity: boolean;
  runMode: RunMode;
  preanalysisMode: boolean;
  preanalysisAccuracyThresholdMeters?: number;
  preanalysisMaxAddedSets?: number;
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
  projectName?: string;
  projectFolder?: string;
  projectSourceFiles?: string[];
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
  preanalysisAccuracyThresholdMeters?: number;
  preanalysisMaxAddedSets?: number;
  selectedInstrument: string;
};

export type PersistedSavedRunSnapshot = SavedRunSnapshot<RunSettingsSnapshot, RunDiagnostics>;
