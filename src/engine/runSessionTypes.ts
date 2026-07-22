import type { ProjectRunFile } from './projectWorkspace';
import type {
  AdjustmentResult,
  ClusterApprovedMerge,
  FaceNormalizationMode,
  GnssVectorFrame,
  GridDistanceInputMode,
  GridObservationMode,
  InstrumentLibrary,
  LocalDatumScheme,
  ObservationOverride,
  ObservationModeSettings,
  ParseCompatibilityMode,
  ParseOptions,
  PlanningMapState,
  RobustMode,
  RunMode,
  SuspectImpactMode,
  TsCorrelationScope,
} from '../types';

export type SolveProfile =
  | 'webnet'
  | 'industry-parity-current'
  | 'industry-parity-legacy'
  | 'legacy-compat'
  | 'industry-parity';

export interface RunSessionParseSettings {
  geometryDependentSigmaReference?: ParseOptions['geometryDependentSigmaReference'];
  solveProfile: SolveProfile;
  coordMode: '2D' | '3D';
  coordSystemMode: 'local' | 'grid';
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
  preanalysisMaxAddedSets: number;
  preanalysisSyntheticAdditionIds?: string[];
  clusterDetectionEnabled: boolean;
  autoSideshotEnabled: boolean;
  autoAdjustEnabled: boolean;
  autoAdjustMaxCycles: number;
  autoAdjustMaxRemovalsPerCycle: number;
  autoAdjustStdResThreshold: number;
  suspectImpactMode: SuspectImpactMode;
  order: ParseOptions['order'];
  angleUnits: 'dms' | 'dd';
  angleStationOrder: 'atfromto' | 'fromatto';
  angleMode: ParseOptions['angleMode'];
  deltaMode: ParseOptions['deltaMode'];
  mapMode: ParseOptions['mapMode'];
  mapScaleFactor?: number;
  normalize: boolean;
  faceNormalizationMode: FaceNormalizationMode;
  applyCurvatureRefraction: boolean;
  refractionCoefficient: number;
  verticalReduction: ParseOptions['verticalReduction'];
  levelWeight?: number;
  levelLoopToleranceBaseMm: number;
  levelLoopTolerancePerSqrtKmMm: number;
  crsTransformEnabled: boolean;
  crsProjectionModel: ParseOptions['crsProjectionModel'];
  crsLabel: string;
  crsGridScaleEnabled: boolean;
  crsGridScaleFactor: number;
  crsConvergenceEnabled: boolean;
  crsConvergenceAngleRad: number;
  geoidModelEnabled: boolean;
  geoidModelId: string;
  geoidSourceFormat: ParseOptions['geoidSourceFormat'];
  geoidSourcePath: string;
  geoidInterpolation: ParseOptions['geoidInterpolation'];
  geoidHeightConversionEnabled: boolean;
  geoidOutputHeightDatum: ParseOptions['geoidOutputHeightDatum'];
  gpsLoopCheckEnabled: boolean;
  gpsAddHiHtEnabled: boolean;
  gpsAddHiHtHiM: number;
  gpsAddHiHtHtM: number;
  qFixLinearSigmaM: number;
  qFixAngularSigmaSec: number;
  positionalToleranceEnabled?: boolean;
  positionalToleranceConstantMm?: number;
  positionalTolerancePpm?: number;
  positionalToleranceConfidencePercent?: number;
  prismEnabled: boolean;
  prismOffset: number;
  prismScope: 'global' | 'set';
  directionSetMode?: ParseOptions['directionSetMode'];
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
}

export interface RunSessionRequest {
  input: string;
  lastRunInput: string | null;
  maxIterations: number;
  convergenceLimit: number;
  units: 'm' | 'ft';
  parseSettings: RunSessionParseSettings;
  projectInstruments: InstrumentLibrary;
  selectedInstrument: string;
  projectIncludeFiles: Record<string, string>;
  projectRunFiles?: ProjectRunFile[];
  geoidSourceData: Uint8Array | null;
  planningMap: PlanningMapState;
  excludedIds: number[];
  activePreanalysisAdditionIds: string[];
  overrides: Record<number, ObservationOverride>;
  approvedClusterMerges: ClusterApprovedMerge[];
}

export interface RunSessionOutcome {
  result: AdjustmentResult;
  effectiveExcludedIds: number[];
  activePreanalysisAdditionIds: string[];
  effectiveClusterApprovedMerges: ClusterApprovedMerge[];
  droppedExclusions: number;
  droppedPreanalysisAdditions: number;
  droppedOverrides: number;
  droppedClusterMerges: number;
  inputChangedSinceLastRun: boolean;
  elapsedMs: number;
  profile: RunSessionProfile;
}

export type RunSessionStageId =
  | 'main-solve'
  | 'suspect-impact'
  | 'preanalysis-impact'
  | 'robust-compare'
  | 'auto-adjust';

export interface RunSessionStageProfile {
  id: RunSessionStageId;
  label: string;
  durationMs: number;
  solveCount: number;
}

export interface RunSessionProfile {
  totalElapsedMs: number;
  solveInvocationCount: number;
  stages: RunSessionStageProfile[];
}

export interface RunSessionProgressUpdate {
  phase: 'solving' | 'finalizing';
  elapsedMs: number;
  stageId: RunSessionStageId;
  stageLabel: string;
  solveIndex: number;
  solveTotalHint: number;
  iteration?: number;
  maxIterations?: number;
}

export type RunSessionProgressCallback = (_event: RunSessionProgressUpdate) => void;

export type SolveInvocationMeta = {
  stageId: RunSessionStageId;
  stageLabel: string;
  solveTotalHint: number;
};
