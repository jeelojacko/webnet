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
  fixed: boolean;
  fixedX?: boolean;
  fixedY?: boolean;
  fixedH?: boolean;
  heightType?: 'orthometric' | 'ellipsoid';
  latDeg?: number;
  lonDeg?: number;
  errorEllipse?: StationErrorEllipse;
  sH?: number;
}

export type StationMap = Record<StationId, Station>;

interface ObservationBase {
  id: number;
  type: 'dist' | 'angle' | 'direction' | 'gps' | 'lev' | 'bearing' | 'zenith';
  instCode: string;
  stdDev: number;
  sigmaSource?: 'default' | 'explicit' | 'fixed' | 'float';
  calc?: unknown;
  residual?: unknown;
  stdRes?: number;
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
  calc?: number | { sideshot: boolean };
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
  calc?: number | { sideshot: boolean };
  residual?: number;
  stdRes?: number;
}

export interface DirectionObservation extends ObservationBase {
  type: 'direction';
  setId: string;
  at: StationId;
  to: StationId;
  obs: number; // radians
  calc?: number;
  residual?: number;
  stdRes?: number;
}

export interface GpsObservation extends ObservationBase {
  type: 'gps';
  from: StationId;
  to: StationId;
  obs: { dE: number; dN: number };
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
  | GpsObservation
  | LevelObservation
  | BearingObservation
  | ZenithObservation;

export interface BearingObservation extends ObservationBase {
  type: 'bearing';
  from: StationId;
  to: StationId;
  obs: number; // radians
  calc?: number | { sideshot: boolean };
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
  calc?: number | { sideshot: boolean };
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

export interface ParseOptions {
  units: UnitsMode;
  coordMode: CoordMode;
  order: OrderMode;
  deltaMode: DeltaMode;
  mapMode: MapMode;
  normalize: boolean;
  levelWeight?: number;
  originLatDeg?: number;
  originLonDeg?: number;
  lonSign?: LonSign;
  currentInstrument?: string;
  edmMode?: 'additive' | 'propagated';
  applyCentering?: boolean;
  addCenteringToExplicit?: boolean;
  debug?: boolean;
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
}
