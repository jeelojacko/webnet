import type { AdjustmentResult, StationId } from '../types';

export type SystematicStatus = 'descriptive' | 'insufficient-data' | 'unavailable';

export interface SystematicSetupFamily {
  station: StationId;
  /** Scalar setup families only; GNSS vectors are omitted here (see GNSS component means). */
  family: 'distance' | 'direction' | 'zenith' | 'leveling';
  count: number;
  /** Native units (rad for angles, m for lengths); convert at display boundaries. */
  meanResidual: number | null;
  rmsResidual: number | null;
  maxAbsResidual: number | null;
  /** Mean of |standardized residuals|; upstream stdRes is absolute, never signed. */
  meanAbsStdRes: number | null;
  stdResNote?: string;
  posCount: number;
  negCount: number;
  /** Genuine near-zero residuals only; missing residuals are counted separately. */
  zeroCount: number;
  /** Rows with no scalar residual; never counted or labeled as zero. */
  missingCount: number;
  longestSameSignRun?: number;
  localFailCount: number;
}

export interface SystematicDistanceTrend {
  count: number;
  minDist: number | null;
  maxDist: number | null;
  span: number | null;
  slopeMmPerKm: number | null;
  interceptMm: number | null;
  /** Deterministic design-collinearity proxy (regressor spread only), not a stochastic correlation. */
  designCollinearity: number | null;
  /** Heuristic practical separability of intercept vs slope descriptors; not statistical identifiability. */
  separable: boolean;
  status: SystematicStatus;
  reason?: string;
}

export interface SystematicFaceBalance {
  /** Direction set-target rows whose face counts balance (|F1-F2|<=1). */
  balancedTargets: number;
  /** Direction set-target rows whose face counts unbalance. */
  unbalancedTargets: number;
  /**
   * Singleton/unpaired set-target rows (either face count missing): face-count
   * balance not assessable, never counted as balanced or unbalanced.
   */
  unpairedTargets: number;
  /** Largest absolute raw face-pair metadata value only; not a test. */
  largestFacePairDeltaArcSec: number | null;
  largestFacePairSetId?: string;
  largestFacePairTarget?: StationId;
  status: SystematicStatus;
  reason?: string;
}

export interface SystematicRepeatSameSign {
  occupy: StationId;
  target: StationId;
  setCount: number;
  sameSignCount: number;
  dominantSign: 'pos' | 'neg' | 'mixed';
  status: SystematicStatus;
}

export interface SystematicZenithPatterns {
  count: number;
  slopeVsDistanceArcSecPerKm: number | null;
  posCount: number;
  negCount: number;
  status: SystematicStatus;
  reason?: string;
}

export interface SystematicLevelingPatterns {
  orderedBy: 'input-sequence';
  count: number;
  cumulativeKm: number | null;
  driftMmPerKm: number | null;
  posCount: number;
  negCount: number;
  longestPos: number;
  longestNeg: number;
  signChanges: number;
  status: SystematicStatus;
  reason?: string;
}

export interface SystematicGnssPatterns {
  count: number;
  meanEMm: number | null;
  meanNMm: number | null;
  meanUMm: number | null;
  rmsEMm: number | null;
  rmsNMm: number | null;
  rmsUMm: number | null;
  status: SystematicStatus;
  reason?: string;
}

export interface SystematicSignRun {
  key: string;
  count: number;
  pos: number;
  neg: number;
  longestPos: number;
  longestNeg: number;
  signChanges: number;
  status: SystematicStatus;
}

export interface SystematicDiagnostics {
  available: boolean;
  unavailableReason?: string;
  setupFamilies: SystematicSetupFamily[];
  distanceTrend: SystematicDistanceTrend;
  worstDirectionSet?: { setId: string; occupy: StationId; residualRmsArcSec?: number };
  worstDirectionRepeat?: { occupy: StationId; target: StationId; setCount: number };
  directionFaceBalance: SystematicFaceBalance;
  directionRepeatSameSign: SystematicRepeatSameSign[];
  zenithPatterns: SystematicZenithPatterns;
  levelingPatterns: SystematicLevelingPatterns;
  gnssPatterns: SystematicGnssPatterns;
  signRuns: SystematicSignRun[];
  warnings: string[];
  robustNote?: string;
  freeNetworkNote?: string;
}

export interface SystematicDiagnosticsInput {
  directionSetDiagnostics?: AdjustmentResult['directionSetDiagnostics'];
  directionTargetDiagnostics?: AdjustmentResult['directionTargetDiagnostics'];
  directionRepeatabilityDiagnostics?: AdjustmentResult['directionRepeatabilityDiagnostics'];
  isPreanalysis?: boolean;
  isDataCheck?: boolean;
  isRobust?: boolean;
  robustMode?: string;
  freeNetwork?: boolean;
  tsCorrelated?: boolean;
}
