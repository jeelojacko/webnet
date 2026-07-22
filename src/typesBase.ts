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

export type PrecisionReportingMode = 'industry-standard' | 'posterior-scaled';

export interface ResultPrecisionModel {
  stationCovariances?: StationCovarianceBlock[];
  relativeCovariances?: RelativeCovarianceBlock[];
  relativePrecision?: {
    from: StationId;
    to: StationId;
    sigmaN: number;
    sigmaE: number;
    sigmaDist?: number;
    sigmaAz?: number;
    ellipse?: StationErrorEllipse;
  }[];
}

export interface RelativeCovarianceBlock {
  from: StationId;
  to: StationId;
  connected: boolean;
  connectionTypes: string[];
  selectedByRelativeDirective?: boolean;
  selectedByPositionalToleranceDirective?: boolean;
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
