import type { PrecisionReportingMode, RelativeCovarianceBlock, ResultPrecisionModel, StationCovarianceBlock, StationErrorEllipse, StationId, WeakGeometryDiagnostics } from './typesBase';
import type { PreanalysisImpactDiagnostics } from './typesPlanning';
import type { Observation, StationMap, DirectionRejectDiagnostic } from './typesObservations';
import type { ParseOptions } from './typesParseOptions';
import type { ClusterApprovedMerge, ClusterMergeOutcome, ClusterRejectedProposal, AutoAdjustDiagnostics, AutoSideshotDiagnostics, LevelingLoopDiagnostics } from './typesDiagnostics';
import type { ClusterLinkageMode, RobustMode, TsCorrelationScope } from './typesParseSettings';

import type { AdjustmentSolveTimingProfile } from './typesSolveTiming';

export interface AdjustmentResult {
  success: boolean;
  converged: boolean;
  iterations: number;
  stations: StationMap;
  observations: Observation[];
  logs: string[];
  solveTimingProfile?: AdjustmentSolveTimingProfile;
  seuw: number;
  dof: number;
  preanalysisMode?: boolean;
  preanalysisSyntheticAdditionIds?: string[];
  parseState?: ParseOptions;
  condition?: { estimate: number; threshold: number; flagged: boolean };
  controlConstraints?: { count: number; x: number; y: number; h: number; xyCorrelated?: number };
  stationCovariances?: StationCovarianceBlock[];
  relativeCovariances?: RelativeCovarianceBlock[];
  precisionModels?: Record<PrecisionReportingMode, ResultPrecisionModel>;
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
    readingCount: number;
    targetCount: number;
    rawCount: number;
    reducedCount: number;
    face1Count: number;
    face2Count: number;
    pairedTargets: number;
    underconstrainedOrientation: boolean;
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
      maxWeightDelta?: number;
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
