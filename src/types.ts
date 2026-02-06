export type StationId = string;

export interface Instrument {
  code: string;
  desc: string;
  edm_const: number;
  edm_ppm: number;
  hzPrecision_sec: number;
  vaPrecision_sec: number;
  instCentr_m: number;
  tgtCentr_m: number;
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
  from: StationId;
  to: StationId;
  obs: number; // radians
  hi?: number;
  ht?: number;
  calc?: number | SideshotCalcMeta;
  residual?: number;
  stdRes?: number;
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
}

export type UnitsMode = 'm' | 'ft';
export type CoordMode = '2D' | '3D';
export type OrderMode = 'NE' | 'EN';
export type DeltaMode = 'slope' | 'horiz'; // slope+zenith vs horiz+deltaH
export type MapMode = 'off' | 'on' | 'anglecalc';
export type LonSign = 'west-positive' | 'west-negative';
export type AngleMode = 'auto' | 'angle' | 'dir';
export type VerticalReductionMode = 'none' | 'curvref';

export interface ParseOptions {
  units: UnitsMode;
  coordMode: CoordMode;
  order: OrderMode;
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
  lonSign?: LonSign;
  currentInstrument?: string;
  edmMode?: 'additive' | 'propagated';
  applyCentering?: boolean;
  addCenteringToExplicit?: boolean;
  debug?: boolean;
  angleMode?: AngleMode;
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
    reducedSigmaArcSec?: number;
    residualArcSec?: number;
    stdRes?: number;
    localPass?: boolean;
    mdbArcSec?: number;
    suspectScore: number;
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
  traverseDiagnostics?: {
    closureCount: number;
    misclosureE: number;
    misclosureN: number;
    misclosureMag: number;
    totalTraverseDistance: number;
    closureRatio?: number;
  };
  sideshots?: {
    id: string;
    sourceLine?: number;
    from: StationId;
    to: StationId;
    mode: 'slope' | 'horiz';
    hasAzimuth: boolean;
  azimuth?: number;
  azimuthSource?: 'explicit' | 'setup' | 'target';
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
}
