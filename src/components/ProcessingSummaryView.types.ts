import type {
  AdjustmentResult,
  CoordSystemDiagnosticCode,
  CrsOffReason,
  CrsStatus,
  DatumSufficiencyReport,
  DirectiveNoEffectWarning,
  DirectiveTransition,
  GnssVectorFrame,
  ReductionUsageSummary,
  RunMode,
} from '../types';

export interface ProcessingSummaryViewProps {
  result: AdjustmentResult;
  units: 'm' | 'ft';
  runElapsedMs: number | null;
  runDiagnostics: {
    solveProfile:
      | 'webnet'
      | 'industry-parity-current'
      | 'industry-parity-legacy'
      | 'legacy-compat'
      | 'industry-parity';
    runMode?: RunMode;
    directionSetMode: 'reduced' | 'raw';
    profileDefaultInstrumentFallback: boolean;
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
    gridBearingMode?: 'measured' | 'grid';
    gridDistanceMode?: 'measured' | 'grid' | 'ellipsoidal';
    gridAngleMode?: 'measured' | 'grid';
    gridDirectionMode?: 'measured' | 'grid';
    datumSufficiencyReport?: DatumSufficiencyReport;
    parsedUsageSummary?: ReductionUsageSummary;
    usedInSolveUsageSummary?: ReductionUsageSummary;
    directiveTransitions?: DirectiveTransition[];
    directiveNoEffectWarnings?: DirectiveNoEffectWarning[];
    coordSystemDiagnostics?: CoordSystemDiagnosticCode[];
    coordSystemWarningMessages?: string[];
    crsStatus?: CrsStatus;
    crsOffReason?: CrsOffReason;
    crsDatumOpId?: string;
    crsDatumFallbackUsed?: boolean;
    crsAreaOfUseStatus?: 'inside' | 'outside' | 'unknown';
    crsOutOfAreaStationCount?: number;
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
  } | null;
}
