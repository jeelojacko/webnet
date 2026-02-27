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

export interface Station {
  x: number;
  y: number;
  h: number;
  lost?: boolean;
  sx?: number;
  sy?: number;
  sh?: number;
  constraintX?: number;
  constraintY?: number;
  constraintH?: number;
  fixed: boolean;
  fixedX?: boolean;
  fixedY?: boolean;
  fixedH?: boolean;
  heightType?: 'orthometric' | 'ellipsoid';
  latDeg?: number;
  lonDeg?: number;
  errorEllipse?: StationErrorEllipse;
  sN?: number;
  sE?: number;
  sH?: number;
}

export type StationMap = Record<StationId, Station>;

interface ObservationBase {
  id: number;
  sourceLine?: number;
  type: 'dist' | 'angle' | 'direction' | 'dir' | 'gps' | 'lev' | 'bearing' | 'zenith';
  instCode: string;
  stdDev: number;
  sigmaSource?: 'default' | 'explicit' | 'fixed' | 'float';
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
  recordType?: 'DN' | 'DM' | 'DB' | 'DE' | 'UNKNOWN';
  reason: 'mixed-face' | 'no-shots' | 'missing-context';
  expectedFace?: 'face1' | 'face2';
  actualFace?: 'face1' | 'face2';
  detail: string;
}

export type ObservationOverride =
  | { obs?: number; stdDev?: number }
  | { obs?: { dE: number; dN: number }; stdDev?: number };

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
export type CrsProjectionModel = 'legacy-equirectangular' | 'local-enu';
export type GeoidInterpolationMethod = 'bilinear' | 'nearest';
export type GeoidHeightDatum = 'orthometric' | 'ellipsoid';
export type GpsVectorMode = 'network' | 'sideshot';

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

export interface ParseOptions {
  units: UnitsMode;
  coordMode: CoordMode;
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
  geoidInterpolation?: GeoidInterpolationMethod;
  geoidHeightConversionEnabled?: boolean;
  geoidOutputHeightDatum?: GeoidHeightDatum;
  geoidModelLoaded?: boolean;
  geoidModelMetadata?: string;
  geoidSampleUndulationM?: number;
  geoidConvertedStationCount?: number;
  geoidSkippedStationCount?: number;
  gpsVectorMode?: GpsVectorMode;
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
  parseState?: ParseOptions;
  condition?: { estimate: number; threshold: number; flagged: boolean };
  controlConstraints?: { count: number; x: number; y: number; h: number };
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
    hasAzimuth: boolean;
    azimuth?: number;
    azimuthSource?: 'explicit' | 'setup' | 'target' | 'vector';
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
