import type {
  CoordSystemDiagnosticCode,
  CrsOffReason,
  CrsStatus,
  DatumSufficiencyReport,
  DirectiveNoEffectWarning,
  DirectiveTransition,
  GnssVectorFrame,
  InstrumentLibrary,
  PrecisionReportingMode,
  ReductionUsageSummary,
  RunMode,
} from '../types';

export type IndustryListingSortCoordinatesBy = 'input' | 'name';
export type IndustryListingSortObservationsBy =
  | 'input'
  | 'name'
  | 'residual'
  | 'stdError'
  | 'stdResidual';

export interface IndustryListingSettings {
  maxIterations: number;
  convergenceLimit?: number;
  precisionReportingMode?: PrecisionReportingMode;
  units: 'm' | 'ft';
  listingShowCoordinates: boolean;
  listingShowObservationsResiduals: boolean;
  listingShowErrorPropagation: boolean;
  listingShowProcessingNotes: boolean;
  listingShowAzimuthsBearings: boolean;
  listingShowLostStations?: boolean;
  listingSortCoordinatesBy: IndustryListingSortCoordinatesBy;
  listingSortObservationsBy: IndustryListingSortObservationsBy;
  listingObservationLimit: number;
}

export interface IndustryListingParseSettings {
  coordMode: '2D' | '3D';
  order: 'NE' | 'EN';
  angleUnits: 'dms' | 'dd';
  angleStationOrder: 'atfromto' | 'fromatto';
  deltaMode: 'slope' | 'horiz';
  refractionCoefficient: number;
  descriptionReconcileMode?: 'first' | 'append';
  descriptionAppendDelimiter?: string;
  positionalToleranceEnabled?: boolean;
  positionalToleranceConstantMm?: number;
  positionalTolerancePpm?: number;
  positionalToleranceConfidencePercent?: number;
}

export interface IndustryListingRunDiagnostics {
  solveProfile:
    | 'webnet'
    | 'industry-parity-current'
    | 'industry-parity-legacy'
    | 'legacy-compat'
    | 'industry-parity';
  runMode?: RunMode;
  angleCenteringModel: 'geometry-aware-correlated-rays';
  defaultSigmaCount: number;
  defaultSigmaByType: string;
  stochasticDefaultsSummary: string;
  rotationAngleRad: number;
  coordSystemMode?: 'local' | 'grid';
  crsId?: string;
  localDatumScheme?: 'average-scale' | 'common-elevation';
  averageScaleFactor?: number;
  scaleOverrideActive?: boolean;
  commonElevation?: number;
  averageGeoidHeight?: number;
  gnssVectorFrameDefault?: GnssVectorFrame;
  gnssFrameConfirmed?: boolean;
  verticalDeflectionNorthSec?: number;
  verticalDeflectionEastSec?: number;
  datumSufficiencyReport?: DatumSufficiencyReport;
  parsedUsageSummary?: ReductionUsageSummary;
  usedInSolveUsageSummary?: ReductionUsageSummary;
  directiveTransitions?: DirectiveTransition[];
  directiveNoEffectWarnings?: DirectiveNoEffectWarning[];
  gridBearingMode?: 'measured' | 'grid';
  gridDistanceMode?: 'measured' | 'grid' | 'ellipsoidal';
  gridAngleMode?: 'measured' | 'grid';
  gridDirectionMode?: 'measured' | 'grid';
  coordSystemDiagnostics?: CoordSystemDiagnosticCode[];
  coordSystemWarningMessages?: string[];
  crsStatus?: CrsStatus;
  crsOffReason?: CrsOffReason;
  crsDatumOpId?: string;
  crsDatumFallbackUsed?: boolean;
  crsAreaOfUseStatus?: 'inside' | 'outside' | 'unknown';
  crsOutOfAreaStationCount?: number;
  levelLoopToleranceBaseMm?: number;
  levelLoopTolerancePerSqrtKmMm?: number;
  qFixLinearSigmaM?: number;
  qFixAngularSigmaSec?: number;
  crsTransformEnabled?: boolean;
  crsProjectionModel?: 'legacy-equirectangular' | 'local-enu';
  crsLabel?: string;
  crsGridScaleEnabled?: boolean;
  crsGridScaleFactor?: number;
  crsConvergenceEnabled?: boolean;
  crsConvergenceAngleRad?: number;
  geoidModelEnabled?: boolean;
  geoidModelId?: string;
  geoidInterpolation?: 'bilinear' | 'nearest';
  geoidHeightConversionEnabled?: boolean;
  geoidOutputHeightDatum?: 'orthometric' | 'ellipsoid';
  geoidModelLoaded?: boolean;
  geoidModelMetadata?: string;
  geoidSampleUndulationM?: number;
  geoidConvertedStationCount?: number;
  geoidSkippedStationCount?: number;
  gpsAddHiHtEnabled?: boolean;
  gpsAddHiHtHiM?: number;
  gpsAddHiHtHtM?: number;
  gpsAddHiHtVectorCount?: number;
  gpsAddHiHtAppliedCount?: number;
  gpsAddHiHtPositiveCount?: number;
  gpsAddHiHtNegativeCount?: number;
  gpsAddHiHtNeutralCount?: number;
  gpsAddHiHtDefaultZeroCount?: number;
  gpsAddHiHtMissingHeightCount?: number;
  gpsAddHiHtScaleMin?: number;
  gpsAddHiHtScaleMax?: number;
  currentInstrumentCode?: string;
  currentInstrumentDesc?: string;
  currentInstrumentLevStdMmPerKm?: number;
  projectInstrumentLibrary?: InstrumentLibrary;
  projectName?: string;
  projectFolder?: string;
  projectSourceFiles?: string[];
}
