export type StationId = string;

export interface Instrument {
  code: string;
  desc: string;
  edm_const: number;
  edm_ppm: number;
  hzPrecision_sec: number;
  dirPrecision_sec: number;
  azBearingPrecision_sec: number;
  vaPrecision_sec: number;
  instCentr_m: number;
  tgtCentr_m: number;
  vertCentr_m: number;
  elevDiff_const_m: number;
  elevDiff_ppm: number;
  gpsStd_xy: number;
  levStd_mmPerKm: number;
}

export type InstrumentLibrary = Record<string, Instrument>;

export interface StationErrorEllipse {
  semiMajor: number;
  semiMinor: number;
  theta: number; // degrees
}

export interface StationCovarianceBlock {
  stationId: StationId;
  cEE: number;
  cEN: number;
  cEH?: number;
  cNN: number;
  cNH?: number;
  cHH?: number;
  sigmaE: number;
  sigmaN: number;
  sigmaH?: number;
  ellipse?: StationErrorEllipse;
}

export interface RelativeCovarianceBlock {
  from: StationId;
  to: StationId;
  connected: boolean;
  connectionTypes: string[];
  cEE: number;
  cEN: number;
  cEH?: number;
  cNN: number;
  cNH?: number;
  cHH?: number;
  sigmaE: number;
  sigmaN: number;
  sigmaH?: number;
  sigmaDist?: number;
  sigmaAz?: number;
  ellipse?: StationErrorEllipse;
}

export type WeakGeometrySeverity = 'ok' | 'watch' | 'weak';

export interface WeakGeometryStationCue {
  stationId: StationId;
  severity: WeakGeometrySeverity;
  horizontalMetric: number;
  verticalMetric?: number;
  relativeToMedian?: number;
  ellipseRatio?: number;
  note: string;
}

export interface WeakGeometryRelativeCue {
  from: StationId;
  to: StationId;
  severity: WeakGeometrySeverity;
  distanceMetric?: number;
  relativeToMedian?: number;
  ellipseRatio?: number;
  note: string;
}

export interface WeakGeometryDiagnostics {
  enabled: boolean;
  stationMedianHorizontal: number;
  relativeMedianDistance?: number;
  stationCues: WeakGeometryStationCue[];
  relativeCues: WeakGeometryRelativeCue[];
}

export interface PreanalysisImpactDiagnosticRow {
  obsId: number;
  type: Observation['type'];
  stations: string;
  sourceLine?: number;
  plannedActive: boolean;
  action: 'add' | 'remove';
  deltaWorstStationMajor?: number;
  deltaMedianStationMajor?: number;
  deltaWorstPairSigmaDist?: number;
  deltaWeakStationCount?: number;
  deltaWeakPairCount?: number;
  score?: number;
  status: 'ok' | 'failed';
}

export interface PreanalysisImpactDiagnostics {
  enabled: boolean;
  activePlannedCount: number;
  excludedPlannedCount: number;
  baseWorstStationMajor?: number;
  baseMedianStationMajor?: number;
  baseWorstPairSigmaDist?: number;
  baseWeakStationCount: number;
  baseWeakPairCount: number;
  rows: PreanalysisImpactDiagnosticRow[];
}

export interface Station {
  x: number;
  y: number;
  h: number;
  lost?: boolean;
  sx?: number;
  sy?: number;
  sh?: number;
  constraintCorrXY?: number;
  constraintX?: number;
  constraintY?: number;
  constraintH?: number;
  fixed: boolean;
  fixedX?: boolean;
  fixedY?: boolean;
  fixedH?: boolean;
  coordInputClass?: CoordInputClass;
  heightType?: 'orthometric' | 'ellipsoid';
  latDeg?: number;
  lonDeg?: number;
  convergenceAngleRad?: number;
  gridScaleFactor?: number;
  elevationFactor?: number;
  combinedFactor?: number;
  factorComputationSource?: 'projection-formula' | 'numerical-fallback';
  factorComputationMethod?: FactorComputationMethod;
  ellipsoidHeightUsed?: number;
  ellipsoidHeightSource?: EllipsoidHeightSource;
  errorEllipse?: StationErrorEllipse;
  sN?: number;
  sE?: number;
  sH?: number;
}

export type StationMap = Record<StationId, Station>;

interface ObservationBase {
  id: number;
  sourceLine?: number;
  sourceFile?: string;
  type: 'dist' | 'angle' | 'direction' | 'dir' | 'gps' | 'lev' | 'bearing' | 'zenith';
  instCode: string;
  setId?: string;
  stdDev: number;
  planned?: boolean;
  sigmaSource?: 'default' | 'explicit' | 'fixed' | 'float';
  prismCorrectionM?: number;
  prismScope?: 'global' | 'set';
  calc?: unknown;
  residual?: unknown;
  stdRes?: number;
  stdResComponents?: { tE: number; tN: number };
  effectiveDistance?: number;
  redundancy?: number | { rE: number; rN: number };
  localTest?: { critical: number; pass: boolean };
  localTestComponents?: { passE: boolean; passN: boolean };
  mdb?: number;
  mdbComponents?: { mE: number; mN: number };
  inputSpace?: ReductionInputSpace;
  distanceKind?: ReductionDistanceKind;
  gridObsMode?: GridObservationMode;
  gridDistanceMode?: GridDistanceInputMode;
}

export interface SideshotCalcMeta {
  sideshot: boolean;
  azimuthObs?: number;
  azimuthStdDev?: number;
  hzObs?: number;
  hzStdDev?: number;
  backsightId?: StationId;
  azimuthSource?: 'explicit' | 'setup' | 'target';
}

export interface DistanceObservation extends ObservationBase {
  type: 'dist';
  subtype: 'ts';
  setId?: string;
  from: StationId;
  to: StationId;
  obs: number;
  hi?: number;
  ht?: number;
  mode?: 'slope' | 'horiz';
  prismCorrectionM?: number;
  prismScope?: 'global' | 'set';
  calc?: number | SideshotCalcMeta;
  residual?: number;
  stdRes?: number;
}

export interface AngleObservation extends ObservationBase {
  type: 'angle';
  setId?: string;
  at: StationId;
  from: StationId;
  to: StationId;
  obs: number; // radians
  calc?: number | SideshotCalcMeta;
  residual?: number;
  stdRes?: number;
}

export interface DirectionObservation extends ObservationBase {
  type: 'direction';
  setId: string;
  at: StationId;
  to: StationId;
  obs: number; // radians
  rawCount?: number;
  rawFace1Count?: number;
  rawFace2Count?: number;
  rawSpread?: number; // radians, around reduced mean
  rawMaxResidual?: number; // radians, max |raw-reduced|
  facePairDelta?: number; // radians, |face1 mean - face2 mean| after normalization
  face1Spread?: number; // radians, spread within face 1
  face2Spread?: number; // radians, spread within face 2
  reducedSigma?: number; // radians
  calc?: number;
  residual?: number;
  stdRes?: number;
}

export interface DirObservation extends ObservationBase {
  type: 'dir';
  setId?: string;
  from: StationId;
  to: StationId;
  obs: number; // radians
  flip180?: boolean;
  calc?: number;
  residual?: number;
  stdRes?: number;
}

export interface GpsObservation extends ObservationBase {
  type: 'gps';
  gpsMode?: GpsVectorMode;
  gnssVectorFrame?: GnssVectorFrame;
  gnssFrameConfirmed?: boolean;
  gpsAntennaHiM?: number;
  gpsAntennaHtM?: number;
  gpsOffsetAzimuthRad?: number;
  gpsOffsetDistanceM?: number;
  gpsOffsetZenithRad?: number;
  gpsOffsetDeltaE?: number;
  gpsOffsetDeltaN?: number;
  gpsOffsetDeltaH?: number;
  gpsOffsetSourceLine?: number;
  from: StationId;
  to: StationId;
  obs: { dE: number; dN: number };
  stdDevE?: number;
  stdDevN?: number;
  corrEN?: number;
  calc?: { dE: number; dN: number };
  residual?: { vE: number; vN: number };
  stdRes?: number;
}

export interface LevelObservation extends ObservationBase {
  type: 'lev';
  setId?: string;
  from: StationId;
  to: StationId;
  obs: number;
  lenKm: number;
  calc?: number | { sideshot: boolean };
  residual?: number;
  stdRes?: number;
}

export type Observation =
  | DistanceObservation
  | AngleObservation
  | DirectionObservation
  | DirObservation
  | GpsObservation
  | LevelObservation
  | BearingObservation
  | ZenithObservation;

export interface BearingObservation extends ObservationBase {
  type: 'bearing';
  from: StationId;
  to: StationId;
  obs: number; // radians
  calc?: number | SideshotCalcMeta;
  residual?: number;
  stdRes?: number;
}

export interface ZenithObservation extends ObservationBase {
  type: 'zenith';
  setId?: string;
  from: StationId;
  to: StationId;
  obs: number; // radians
  hi?: number;
  ht?: number;
  prismCorrectionM?: number;
  prismScope?: 'global' | 'set';
  calc?: number | SideshotCalcMeta;
  residual?: number;
  stdRes?: number;
}

export interface DirectionRejectDiagnostic {
  setId: string;
  occupy: StationId;
  target?: StationId;
  sourceLine?: number;
  sourceFile?: string;
  recordType?: 'DN' | 'DM' | 'DB' | 'DE' | 'UNKNOWN';
  reason: 'mixed-face' | 'no-shots' | 'missing-context';
  expectedFace?: 'face1' | 'face2';
  actualFace?: 'face1' | 'face2';
  detail: string;
}

export type ObservationOverride = {
  obs?: number | { dE: number; dN: number };
  stdDev?: number;
};

export interface ParseResult {
  stations: StationMap;
  observations: Observation[];
  instrumentLibrary: InstrumentLibrary;
  unknowns: StationId[];
  parseState: ParseOptions;
  logs: string[];
  directionRejectDiagnostics?: DirectionRejectDiagnostic[];
}

export type UnitsMode = 'm' | 'ft';
export type CoordMode = '2D' | '3D';
export type OrderMode = 'NE' | 'EN';
export type AngleUnitsMode = 'dms' | 'dd';
export type AngleStationOrder = 'atfromto' | 'fromatto';
export type DeltaMode = 'slope' | 'horiz'; // slope+zenith vs horiz+deltaH
export type MapMode = 'off' | 'on' | 'anglecalc';
export type LonSign = 'west-positive' | 'west-negative';
export type AngleMode = 'auto' | 'angle' | 'dir';
export type VerticalReductionMode = 'none' | 'curvref';
export type TsCorrelationScope = 'setup' | 'set';
export type RobustMode = 'none' | 'huber';
export type DirectionSetMode = 'reduced' | 'raw';
export type ClusterLinkageMode = 'single' | 'complete';
export type ClusterPassLabel = 'single' | 'pass1' | 'pass2';
export type DescriptionReconcileMode = 'first' | 'append';
export type ParseCompatibilityMode = 'legacy' | 'strict';
export type RunMode = 'adjustment' | 'preanalysis' | 'data-check' | 'blunder-detect';
export type CrsProjectionModel = 'legacy-equirectangular' | 'local-enu';
export type CoordSystemMode = 'local' | 'grid';
export type LocalDatumScheme = 'average-scale' | 'common-elevation';
export type GridObservationMode = 'measured' | 'grid';
export type GridDistanceInputMode = 'measured' | 'grid' | 'ellipsoidal';
export type CrsStatus = 'on' | 'off';
export type CrsOffReason =
  | 'noCRSSelected'
  | 'projDbMissing'
  | 'noInverseAvailable'
  | 'inverseFailed'
  | 'unsupportedCrsFamily'
  | 'disabledByProfile'
  | 'crsInitFailed'
  | 'missingGridFiles';
export type ReductionInputSpace = 'measured' | 'grid';
export type ReductionDistanceKind = 'ground' | 'grid' | 'ellipsoidal';
export type BearingKind = 'grid' | 'measured';
export type FactorComputationMethod = 'inverseToGeodetic' | 'directGrid' | 'fallback';
export type CoordInputClass = 'grid' | 'geodetic' | 'local' | 'unknown';
export type GnssVectorFrame = 'gridNEU' | 'enuLocal' | 'ecefDelta' | 'llhBaseline' | 'unknown';
export type EllipsoidHeightSource =
  | 'perStationGeoid+H'
  | 'avgGeoid+H'
  | 'providedEllipsoid'
  | 'assumed0';
export type CoordSystemDiagnosticCode =
  | 'CRS_OUT_OF_AREA'
  | 'CRS_DATUM_FALLBACK'
  | 'GEOID_FALLBACK'
  | 'FACTOR_APPROXIMATION_USED'
  | 'CRS_INPUT_MIX_BLOCKED'
  | 'GNSS_FRAME_UNCONFIRMED'
  | 'DATUM_HARD_FAIL'
  | 'DATUM_SOFT_WARN'
  | 'SCALE_OVERRIDE_USED'
  | 'FACTOR_FALLBACK_PROJ_USED';
export interface ObservationModeSettings {
  bearing: GridObservationMode;
  distance: GridDistanceInputMode;
  angle: GridObservationMode;
  direction: GridObservationMode;
}
export interface ReductionContext {
  inputSpaceDefault: ReductionInputSpace;
  distanceKind: ReductionDistanceKind;
  bearingKind: BearingKind;
  explicitOverrideActive: boolean;
}
export interface DatumSufficiencyReport {
  status: 'hard-fail' | 'soft-warn' | 'ok';
  reasons: string[];
  suggestions: string[];
}
export interface ReductionUsageSummary {
  bearing: { grid: number; measured: number };
  angle: { grid: number; measured: number };
  direction: { grid: number; measured: number };
  distance: { ground: number; grid: number; ellipsoidal: number };
  total: number;
}
export interface DirectiveTransitionState {
  gridBearingMode: GridObservationMode;
  gridDistanceMode: GridDistanceInputMode;
  gridAngleMode: GridObservationMode;
  gridDirectionMode: GridObservationMode;
  averageScaleFactor: number;
  scaleOverrideActive: boolean;
}
export interface DirectiveTransition {
  line: number;
  directive: string;
  stateAfter: DirectiveTransitionState;
  effectiveFromLine: number;
  effectiveToLine?: number;
  obsCountInRange: number;
}
export interface DirectiveNoEffectWarning {
  line: number;
  directive: string;
  reason: 'noSubsequentObservations' | 'noSubsequentObsRecords';
}
export type ParseCompatibilityDiagnosticCode =
  | 'ROLE_AMBIGUITY'
  | 'TOKEN_ROLE_COLLISION'
  | 'OVERLOADED_STATION_FORM'
  | 'SIGMA_POSITION_AMBIGUITY'
  | 'MIXED_LEGACY_SYNTAX'
  | 'STRICT_REJECTED'
  | 'NUMERIC_STATION_TOKEN_REJECTED';
export interface ParseCompatibilityDiagnostic {
  code: ParseCompatibilityDiagnosticCode;
  line: number;
  sourceFile?: string;
  recordType?: string;
  mode: ParseCompatibilityMode;
  severity: 'warning' | 'error';
  message: string;
  rewriteSuggestion?: string;
  fallbackApplied?: boolean;
}
export type GeoidInterpolationMethod = 'bilinear' | 'nearest';
export type GeoidHeightDatum = 'orthometric' | 'ellipsoid';
export type GeoidSourceFormat = 'builtin' | 'gtx' | 'byn';
export type GpsVectorMode = 'network' | 'sideshot';
export type ProjectExportFormat = 'webnet' | 'industry-style' | 'landxml';
export type AdjustedPointsColumnId = 'P' | 'N' | 'E' | 'Z' | 'D' | 'LAT' | 'LON' | 'EL';
export type AdjustedPointsDelimiter = 'comma' | 'space' | 'tab';
export type AdjustedPointsOutputFormat = 'csv' | 'text';
export type AdjustedPointsPresetId = 'PNEZD' | 'PENZD' | 'PNEZ' | 'PENZ' | 'NEZ' | 'PEN' | 'custom';

export interface AdjustedPointsExportSettings {
  format: AdjustedPointsOutputFormat;
  delimiter: AdjustedPointsDelimiter;
  columns: AdjustedPointsColumnId[];
  presetId: AdjustedPointsPresetId;
  includeLostStations: boolean;
}

export interface CustomLevelLoopTolerancePreset {
  id: string;
  name: string;
  baseMm: number;
  perSqrtKmMm: number;
}

export interface WebNetProjectFileV1 {
  kind: 'webnet-project';
  schemaVersion: 1;
  savedAt: string;
  input: string;
  ui: {
    settings: Record<string, unknown>;
    parseSettings: Record<string, unknown>;
    exportFormat: ProjectExportFormat;
    adjustedPointsExport: AdjustedPointsExportSettings;
  };
  project: {
    projectInstruments: InstrumentLibrary;
    selectedInstrument: string;
    levelLoopCustomPresets: CustomLevelLoopTolerancePreset[];
  };
}

export interface WebNetProjectFileV2 {
  kind: 'webnet-project';
  schemaVersion: 2;
  savedAt: string;
  input: string;
  ui: {
    settings: Record<string, unknown>;
    parseSettings: Record<string, unknown>;
    exportFormat: ProjectExportFormat;
    adjustedPointsExport: AdjustedPointsExportSettings;
    migration?: {
      parseModeMigrated?: boolean;
      migratedAt?: string;
    };
  };
  project: {
    projectInstruments: InstrumentLibrary;
    selectedInstrument: string;
    levelLoopCustomPresets: CustomLevelLoopTolerancePreset[];
  };
}

export interface WebNetProjectFileV3 {
  kind: 'webnet-project';
  schemaVersion: 3;
  savedAt: string;
  mainInput: string;
  includeFiles: Record<string, string>;
  ui: {
    settings: Record<string, unknown>;
    parseSettings: Record<string, unknown>;
    exportFormat: ProjectExportFormat;
    adjustedPointsExport: AdjustedPointsExportSettings;
    migration?: {
      parseModeMigrated?: boolean;
      migratedAt?: string;
    };
  };
  project: {
    projectInstruments: InstrumentLibrary;
    selectedInstrument: string;
    levelLoopCustomPresets: CustomLevelLoopTolerancePreset[];
  };
}

export interface ParseIncludeRequest {
  includePath: string;
  parentSourceFile?: string;
  line: number;
  stack: string[];
}

export interface ParseIncludeResponse {
  sourceFile: string;
  content: string;
}

export type ParseIncludeResolver = (_request: ParseIncludeRequest) => ParseIncludeResponse | null;

export interface ParseIncludeError {
  code: 'missing-include-path' | 'include-not-found' | 'include-cycle' | 'include-depth-exceeded';
  sourceFile: string;
  line: number;
  includePath?: string;
  message: string;
  stack?: string[];
}

export interface RunModeCompatibilityDiagnostic {
  code: string;
  severity: 'warning' | 'error';
  message: string;
  action?: string;
}

export interface ClusterApprovedMerge {
  aliasId: StationId;
  canonicalId: StationId;
}

export interface ClusterMergeOutcome {
  aliasId: StationId;
  canonicalId: StationId;
  aliasE?: number;
  aliasN?: number;
  aliasH?: number;
  canonicalE?: number;
  canonicalN?: number;
  canonicalH?: number;
  deltaE?: number;
  deltaN?: number;
  deltaH?: number;
  horizontalDelta?: number;
  spatialDelta?: number;
  missing?: boolean;
}

export interface ClusterRejectedProposal {
  key: string;
  representativeId: StationId;
  stationIds: StationId[];
  memberCount: number;
  retainedId?: StationId;
  reason: string;
}

export interface AutoAdjustRemoval {
  obsId: number;
  type: Observation['type'];
  stations: string;
  sourceLine?: number;
  stdRes: number;
  redundancy?: number;
  reason: 'local-test' | 'std-res';
}

export interface AutoAdjustCycleDiagnostics {
  cycle: number;
  seuw: number;
  maxAbsStdRes: number;
  removals: AutoAdjustRemoval[];
}

export interface AutoAdjustDiagnostics {
  enabled: boolean;
  threshold: number;
  maxCycles: number;
  maxRemovalsPerCycle: number;
  minRedundancy: number;
  stopReason: 'disabled' | 'no-candidates' | 'max-cycles';
  cycles: AutoAdjustCycleDiagnostics[];
  removed: AutoAdjustRemoval[];
}

export interface AutoSideshotCandidate {
  sourceLine?: number;
  occupy: StationId;
  backsight: StationId;
  target: StationId;
  angleObsId: number;
  distObsId: number;
  angleRedundancy: number;
  distRedundancy: number;
  minRedundancy: number;
  maxAbsStdRes: number;
}

export interface AutoSideshotDiagnostics {
  enabled: boolean;
  threshold: number;
  evaluatedCount: number;
  excludedControlCount: number;
  candidateCount: number;
  candidates: AutoSideshotCandidate[];
}

export interface LevelLoopSegment {
  from: StationId;
  to: StationId;
  observedDh: number;
  lengthKm: number;
  sourceLine?: number;
  closureLeg?: boolean;
}

export interface LevelingLoopSegmentSuspectRow {
  rank: number;
  key: string;
  from: StationId;
  to: StationId;
  sourceLine?: number;
  occurrenceCount: number;
  warnLoopCount: number;
  totalLengthKm: number;
  maxAbsDh: number;
  suspectScore: number;
  worstLoopKey?: string;
  worstLoopSeverity: number;
  closureLegCount: number;
}

export interface LevelingLoopDiagnosticRow {
  rank: number;
  key: string;
  stationPath: StationId[];
  edgeCount: number;
  sourceLines: number[];
  closure: number;
  absClosure: number;
  loopLengthKm: number;
  toleranceMm: number;
  toleranceM: number;
  closurePerSqrtKmMm: number;
  severity: number;
  pass: boolean;
  segments: LevelLoopSegment[];
}

export interface LevelingLoopDiagnostics {
  enabled: boolean;
  observationCount: number;
  loopCount: number;
  passCount: number;
  warnCount: number;
  totalLengthKm: number;
  warnTotalLengthKm: number;
  thresholds: {
    baseMm: number;
    perSqrtKmMm: number;
  };
  worstLoopKey?: string;
  worstClosure?: number;
  worstClosurePerSqrtKmMm?: number;
  loops: LevelingLoopDiagnosticRow[];
  suspectSegments: LevelingLoopSegmentSuspectRow[];
}

export interface AliasExplicitMapping {
  sourceId: StationId;
  canonicalId: StationId;
  sourceLine?: number;
}

export interface AliasRuleSummary {
  rule: string;
  sourceLine: number;
}

export interface AliasTraceEntry {
  sourceId: StationId;
  canonicalId: StationId;
  sourceLine?: number;
  context: 'station' | 'observation' | 'sideshot-backsight' | 'direction-reject';
  detail?: string;
  reference?: string;
}

export interface DescriptionTraceEntry {
  stationId: StationId;
  sourceLine: number;
  recordType: 'C' | 'P' | 'PH' | 'CH' | 'EH' | 'E';
  description: string;
}

export interface DescriptionScanSummary {
  stationId: StationId;
  recordCount: number;
  uniqueCount: number;
  conflict: boolean;
  descriptions: string[];
  sourceLines: number[];
}

export interface GpsTopoCoordinateShot {
  pointId: StationId;
  east: number;
  north: number;
  height?: number;
  sigmaE?: number;
  sigmaN?: number;
  sigmaH?: number;
  fromId?: StationId;
  sourceLine: number;
}

export interface ParseOptions {
  runMode?: RunMode;
  runModeCompatibilityDiagnostics?: RunModeCompatibilityDiagnostic[];
  parseCompatibilityMode?: ParseCompatibilityMode;
  directiveAbbreviationMode?: 'off' | 'unique-prefix';
  unknownDirectivePolicy?: 'legacy-warn' | 'strict-error';
  parseCompatibilityDiagnostics?: ParseCompatibilityDiagnostic[];
  ambiguousCount?: number;
  legacyFallbackCount?: number;
  strictRejectCount?: number;
  rewriteSuggestionCount?: number;
  parseModeMigrated?: boolean;
  sourceFile?: string;
  includeFiles?: Record<string, string>;
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
  gnssVectorFrameDefault?: GnssVectorFrame;
  gnssFrameConfirmed?: boolean;
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
  rotationAngleRad?: number;
  lostStationIds?: StationId[];
  autoAdjustEnabled?: boolean;
  autoAdjustMaxCycles?: number;
  autoAdjustMaxRemovalsPerCycle?: number;
  autoAdjustStdResThreshold?: number;
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
  gpsTopoShots?: GpsTopoCoordinateShot[];
  plannedObservationCount?: number;
  stationSeparator?: string;
  dataInputEnabled?: boolean;
  threeReduceMode?: boolean;
  linearMultiplier?: number;
  elevationInputMode?: 'orthometric' | 'ellipsoid';
  projectElevationMeters?: number;
  vLevelMode?: 'off' | 'feet' | 'miles' | 'meters' | 'kilometers' | 'turns' | 'none';
  vLevelNoneStdErrMeters?: number;
}

export interface AdjustmentResult {
  success: boolean;
  converged: boolean;
  iterations: number;
  stations: StationMap;
  observations: Observation[];
  logs: string[];
  seuw: number;
  dof: number;
  preanalysisMode?: boolean;
  parseState?: ParseOptions;
  condition?: { estimate: number; threshold: number; flagged: boolean };
  controlConstraints?: { count: number; x: number; y: number; h: number; xyCorrelated?: number };
  stationCovariances?: StationCovarianceBlock[];
  relativeCovariances?: RelativeCovarianceBlock[];
  weakGeometryDiagnostics?: WeakGeometryDiagnostics;
  preanalysisImpactDiagnostics?: PreanalysisImpactDiagnostics;
  chiSquare?: {
    T: number;
    dof: number;
    p: number;
    pass95: boolean;
    alpha: number;
    lower: number;
    upper: number;
    varianceFactor: number;
    varianceFactorLower: number;
    varianceFactorUpper: number;
  };
  statisticalSummary?: {
    byGroup: {
      label: string;
      count: number;
      sumSquares: number;
      errorFactor: number;
    }[];
    totalCount: number;
    totalSumSquares: number;
    totalErrorFactorByCount: number;
    totalErrorFactorByDof: number;
  };
  typeSummary?: Record<
    string,
    {
      count: number;
      rms: number;
      maxAbs: number;
      maxStdRes: number;
      over3: number;
      over4: number;
      unit: string;
    }
  >;
  relativePrecision?: {
    from: StationId;
    to: StationId;
    sigmaN: number;
    sigmaE: number;
    sigmaDist?: number;
    sigmaAz?: number;
    ellipse?: StationErrorEllipse;
  }[];
  directionSetDiagnostics?: {
    setId: string;
    occupy: StationId;
    rawCount: number;
    reducedCount: number;
    face1Count: number;
    face2Count: number;
    pairedTargets: number;
    orientationDeg?: number;
    residualMeanArcSec?: number;
    residualRmsArcSec?: number;
    residualMaxArcSec?: number;
    orientationSeArcSec?: number;
    meanFacePairDeltaArcSec?: number;
    maxFacePairDeltaArcSec?: number;
    meanRawMaxResidualArcSec?: number;
    maxRawMaxResidualArcSec?: number;
  }[];
  directionTargetDiagnostics?: {
    setId: string;
    occupy: StationId;
    target: StationId;
    sourceLine?: number;
    rawCount: number;
    face1Count: number;
    face2Count: number;
    faceBalanced: boolean;
    rawSpreadArcSec?: number;
    rawMaxResidualArcSec?: number;
    facePairDeltaArcSec?: number;
    face1SpreadArcSec?: number;
    face2SpreadArcSec?: number;
    reducedSigmaArcSec?: number;
    residualArcSec?: number;
    stdRes?: number;
    localPass?: boolean;
    mdbArcSec?: number;
    suspectScore: number;
  }[];
  directionRepeatabilityDiagnostics?: {
    occupy: StationId;
    target: StationId;
    setCount: number;
    localFailCount: number;
    faceUnbalancedSets: number;
    residualMeanArcSec?: number;
    residualRmsArcSec?: number;
    residualRangeArcSec?: number;
    residualMaxArcSec?: number;
    stdResRms?: number;
    maxStdRes?: number;
    meanRawSpreadArcSec?: number;
    maxRawSpreadArcSec?: number;
    worstSetId?: string;
    worstLine?: number;
    suspectScore: number;
  }[];
  suspectImpactDiagnostics?: {
    obsId: number;
    type: string;
    stations: string;
    sourceLine?: number;
    baseStdRes?: number;
    baseLocalFail: boolean;
    deltaSeuw?: number;
    deltaMaxStdRes?: number;
    baseChiPass?: boolean;
    altChiPass?: boolean;
    chiDelta: 'improved' | 'degraded' | 'unchanged' | '-';
    maxCoordShift?: number;
    score?: number;
    status: 'ok' | 'failed';
  }[];
  setupDiagnostics?: {
    station: StationId;
    directionSetCount: number;
    directionObsCount: number;
    angleObsCount: number;
    distanceObsCount: number;
    bearingObsCount: number;
    zenithObsCount: number;
    levelingObsCount: number;
    gpsObsCount: number;
    traverseDistance: number;
    orientationRmsArcSec?: number;
    orientationSeArcSec?: number;
    stdResCount: number;
    rmsStdRes?: number;
    maxStdRes?: number;
    localFailCount: number;
    worstObsType?: string;
    worstObsStations?: string;
    worstObsLine?: number;
  }[];
  tsCorrelationDiagnostics?: {
    enabled: boolean;
    rho: number;
    scope: TsCorrelationScope;
    groupCount: number;
    equationCount: number;
    pairCount: number;
    maxGroupSize: number;
    meanAbsOffDiagWeight?: number;
    groups: {
      key: string;
      station: StationId;
      setId?: string;
      rows: number;
      pairCount: number;
      meanAbsOffDiagWeight?: number;
    }[];
  };
  robustDiagnostics?: {
    enabled: boolean;
    mode: RobustMode;
    k: number;
    iterations: {
      iteration: number;
      downweightedRows: number;
      meanWeight: number;
      minWeight: number;
      maxNorm: number;
    }[];
    topDownweightedRows: {
      obsId: number;
      type: Observation['type'];
      stations: string;
      sourceLine?: number;
      weight: number;
      norm: number;
    }[];
  };
  robustComparison?: {
    enabled: boolean;
    classicalTop: {
      rank: number;
      obsId: number;
      type: Observation['type'];
      stations: string;
      sourceLine?: number;
      stdRes?: number;
      localFail: boolean;
    }[];
    robustTop: {
      rank: number;
      obsId: number;
      type: Observation['type'];
      stations: string;
      sourceLine?: number;
      stdRes?: number;
      localFail: boolean;
    }[];
    overlapCount: number;
  };
  residualDiagnostics?: {
    criticalT: number;
    observationCount: number;
    withStdResCount: number;
    over2SigmaCount: number;
    over3SigmaCount: number;
    over4SigmaCount: number;
    localFailCount: number;
    lowRedundancyCount: number;
    veryLowRedundancyCount: number;
    meanRedundancy?: number;
    minRedundancy?: number;
    maxStdRes?: number;
    worst?: {
      obsId: number;
      type: Observation['type'];
      stations: string;
      sourceLine?: number;
      stdRes?: number;
      redundancy?: number;
      localPass?: boolean;
    };
    byType: {
      type: Observation['type'];
      count: number;
      withStdResCount: number;
      localFailCount: number;
      over3SigmaCount: number;
      maxStdRes?: number;
      meanRedundancy?: number;
      minRedundancy?: number;
    }[];
  };
  traverseDiagnostics?: {
    closureCount: number;
    misclosureE: number;
    misclosureN: number;
    misclosureMag: number;
    totalTraverseDistance: number;
    closureRatio?: number;
    linearPpm?: number;
    angularMisclosureArcSec?: number;
    verticalMisclosure?: number;
    thresholds?: {
      minClosureRatio: number;
      maxLinearPpm: number;
      maxAngularArcSec: number;
      maxVerticalMisclosure: number;
    };
    passes?: {
      ratio: boolean;
      linearPpm: boolean;
      angular: boolean;
      vertical: boolean;
      overall: boolean;
    };
    loops?: {
      key: string;
      from: StationId;
      to: StationId;
      misclosureE: number;
      misclosureN: number;
      misclosureMag: number;
      traverseDistance: number;
      closureRatio?: number;
      linearPpm?: number;
      angularMisclosureArcSec?: number;
      verticalMisclosure?: number;
      severity: number;
      pass: boolean;
    }[];
  };
  sideshots?: {
    id: string;
    sourceLine?: number;
    from: StationId;
    to: StationId;
    mode: 'slope' | 'horiz' | 'gps';
    sourceType?: 'SS' | 'G' | 'GS';
    relationFrom?: StationId;
    hasAzimuth: boolean;
    azimuth?: number;
    azimuthSource?: 'explicit' | 'setup' | 'target' | 'vector' | 'coordinate';
    sigmaAz?: number;
    distance: number;
    horizDistance: number;
    deltaH?: number;
    easting?: number;
    northing?: number;
    height?: number;
    sigmaE?: number;
    sigmaN?: number;
    sigmaH?: number;
    note?: string;
  }[];
  gpsLoopDiagnostics?: {
    enabled: boolean;
    vectorCount: number;
    loopCount: number;
    passCount: number;
    warnCount: number;
    thresholds: {
      baseToleranceM: number;
      ppmTolerance: number;
    };
    loops: {
      rank: number;
      key: string;
      stationPath: StationId[];
      edgeCount: number;
      sourceLines: number[];
      closureE: number;
      closureN: number;
      closureMag: number;
      loopDistance: number;
      closureRatio?: number;
      linearPpm?: number;
      toleranceM: number;
      severity: number;
      pass: boolean;
    }[];
  };
  levelingLoopDiagnostics?: LevelingLoopDiagnostics;
  clusterDiagnostics?: {
    enabled: boolean;
    passMode: 'single-pass' | 'dual-pass';
    linkageMode: ClusterLinkageMode;
    dimension: '2D' | '3D';
    tolerance: number;
    pairCount: number;
    candidateCount: number;
    pass1CandidateCount?: number;
    approvedMergeCount?: number;
    appliedMerges?: ClusterApprovedMerge[];
    mergeOutcomes?: ClusterMergeOutcome[];
    rejectedProposals?: ClusterRejectedProposal[];
    candidates: {
      key: string;
      representativeId: StationId;
      stationIds: StationId[];
      memberCount: number;
      hasFixed: boolean;
      hasUnknown: boolean;
      centroidE: number;
      centroidN: number;
      centroidH?: number;
      maxSeparation: number;
      meanSeparation: number;
      pairs: {
        from: StationId;
        to: StationId;
        separation: number;
      }[];
    }[];
  };
  autoAdjustDiagnostics?: AutoAdjustDiagnostics;
  autoSideshotDiagnostics?: AutoSideshotDiagnostics;
  directionRejectDiagnostics?: DirectionRejectDiagnostic[];
}
