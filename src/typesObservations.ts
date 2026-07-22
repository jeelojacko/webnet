import type { StationErrorEllipse, StationId } from './typesBase';
import type {
  CoordInputClass,
  EllipsoidHeightSource,
  FactorComputationMethod,
  GridDistanceInputMode,
  GridObservationMode,
  GnssVectorFrame,
  ParseCompatibilityMode,
  ReductionDistanceKind,
  ReductionInputSpace,
  FaceNormalizationMode,
} from './typesParseSettings';
import type { GpsVectorMode, GpsWeightingMode } from './typesProject';

export interface Station {
  x: number;
  y: number;
  h: number;
  lost?: boolean;
  bootstrapApprox?: boolean;
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
  constraintModeX?: 'fixed' | 'weighted' | 'free' | 'approximate';
  constraintModeY?: 'fixed' | 'weighted' | 'free' | 'approximate';
  constraintModeH?: 'fixed' | 'weighted' | 'free' | 'approximate';
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

export type SigmaSource = 'default' | 'explicit' | 'fixed' | 'float';

interface ObservationBase {
  id: number;
  sourceLine?: number;
  sourceFile?: string;
  type: 'dist' | 'angle' | 'direction' | 'dir' | 'gps' | 'lev' | 'bearing' | 'zenith';
  instCode: string;
  setId?: string;
  stdDev: number;
  weightingStdDev?: number;
  weightingStdDevE?: number;
  weightingStdDevN?: number;
  planned?: boolean;
  sigmaSource?: SigmaSource;
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
  bootstrapZenithObs?: number;
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
  gpsWeightingMode?: GpsWeightingMode;
  gnssVectorFrame?: GnssVectorFrame;
  gnssFrameConfirmed?: boolean;
  gpsVectorLabel?: string;
  gpsVectorHorizontalFactor?: number;
  gpsVectorVerticalFactor?: number;
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
  obs: { dE: number; dN: number; dU?: number };
  stdDevE?: number;
  stdDevN?: number;
  stdDevU?: number;
  sigmaSourceE?: SigmaSource;
  sigmaSourceN?: SigmaSource;
  sigmaSourceU?: SigmaSource;
  corrEN?: number;
  corrEU?: number;
  corrNU?: number;
  gpsCovariance3d?: {
    cXX: number;
    cYY: number;
    cZZ: number;
    cXY: number;
    cXZ: number;
    cYZ: number;
  };
  calc?: { dE: number; dN: number; dU?: number };
  residual?: { vE: number; vN: number; vU?: number };
  componentStdRes?: { tE?: number; tN?: number; tU?: number };
  componentResidualStdErr?: { sE?: number; sN?: number; sU?: number };
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
  reason: 'mixed-face' | 'unresolved-mixed-face' | 'no-shots' | 'missing-context';
  expectedFace?: 'face1' | 'face2';
  actualFace?: 'face1' | 'face2';
  faceSource?: DirectionFaceSource;
  treatmentDecision?: DirectionSetTreatmentDecision;
  policyOutcome?: DirectionSetPolicyOutcome;
  detail: string;
}

export type DirectionFaceSource = 'metadata' | 'zenith' | 'cluster' | 'fallback' | 'unresolved';
export type DirectionSetTreatmentDecision = 'normalized' | 'split' | 'unresolved';
export type DirectionSetPolicyOutcome = 'strict-reject' | 'legacy-fallback' | 'accepted';

export interface DirectionSetTreatmentDiagnostic {
  setId: string;
  occupy: StationId;
  sourceLine?: number;
  sourceFile?: string;
  faceSource: DirectionFaceSource;
  treatmentDecision: DirectionSetTreatmentDecision;
  policyOutcome: DirectionSetPolicyOutcome;
  faceNormalizationMode: FaceNormalizationMode;
  parseCompatibilityMode: ParseCompatibilityMode;
  readingCount: number;
  targetCount: number;
  detail: string;
}

export type ObservationOverride = {
  obs?: number | { dE: number; dN: number };
  stdDev?: number;
};
