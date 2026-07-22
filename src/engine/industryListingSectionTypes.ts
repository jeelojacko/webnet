import type { centerIndustryLine } from './industryListingFormatters';
import type { IndustryListingParseSettings, IndustryListingRunDiagnostics, IndustryListingSettings } from './industryListingTypes';
import type { AdjustmentResult, Observation, ReductionUsageSummary, Station } from '../types';

export const ONE_DIMENSIONAL_CONFIDENCE_95_SCALE = 1.959963984540054;

export type TraceabilityModelLike = {
  descriptionConflictCount: number;
  descriptionRepeatedStationCount: number;
};

export type DatumSufficiencyLike = {
  status: string;
  reasons: string[];
  suggestions: string[];
};

export type RelationshipRow = {
  from: string;
  to: string;
  azimuth: string;
  distance: string;
  sigmaAz95: string;
  sigmaDist95: string;
  ppm95: string;
  sigmaDist?: number;
  sigmaH?: number;
  ellipse?: {
    semiMajor: number;
    semiMinor: number;
    theta: number;
  };
};

export type PositionalToleranceRow = {
  from: string;
  to: string;
  distanceMeters: number;
  toleranceMeters: number;
  checkMeters: number;
  passes: boolean;
};

export type DisplayFactors = {
  convergenceAngleRad: number;
};

export type ProjectInstrumentLike = {
  code: string;
};

export type RenderTextTable = (
  _headers: string[],
  _rows: string[][],
  _numericColumnIndexes?: number[],
) => void;

export type RenderAdjustedSection = (
  _title: string,
  _rows: string[][],
  _headers: string[],
  _numericColumnIndexes: number[],
  _preface?: string[],
) => void;

export type SettingRow = { label: string; value: string };


export interface AppendIndustryListingTopSectionsArgs {
  lines: string[];
  now: Date;
  runDiagnostics: IndustryListingRunDiagnostics;
  runDiag: IndustryListingRunDiagnostics;
  settings: IndustryListingSettings;
  parseSettings: IndustryListingParseSettings;
  parseState: AdjustmentResult['parseState'];
  projectName?: string;
  projectFolder?: string;
  projectSourceFiles: string[];
  linearUnit: string;
  unitScale: number;
  runMode: string;
  runPurpose: string;
  coordMode: string;
  crsId: string;
  crsLabel: string;
  averageGeoidHeight: number;
  gpsObservationRows: Observation[];
  gpsVectorFactorSummary: string;
  mapMode: string;
  mapScaleFactor: number;
  normalize: boolean;
  faceNormalizationMode: string;
  prismEnabled: boolean;
  prismOffset: number;
  prismScope: string;
  rotationAngleRad: number;
  coordSystemMode: string;
  localDatumScheme: string;
  averageScaleFactor: number;
  commonElevation: number;
  gridBearingMode: string;
  gridDistanceMode: string;
  gridAngleMode: string;
  gridDirectionMode: string;
  scaleOverrideActive: boolean;
  gnssVectorFrameDefault: string;
  gnssFrameConfirmed: boolean;
  parsedUsageSummary?: ReductionUsageSummary;
  usedInSolveUsageSummary?: ReductionUsageSummary;
  directiveTransitions: Array<{
    directive: string;
    effectiveFromLine: number;
    effectiveToLine?: number;
    obsCountInRange: number;
  }>;
  directiveNoEffectWarnings: Array<{
    directive: string;
    line: number;
    reason: string;
  }>;
  datumSufficiency?: DatumSufficiencyLike;
  crsStatus: string;
  crsOffReason?: string;
  crsProjectionModel: string;
  crsGridScaleEnabled: boolean;
  crsGridScaleFactor: number;
  crsConvergenceEnabled: boolean;
  crsConvergenceAngleRad: number;
  crsDatumOpId?: string;
  crsDatumFallbackUsed: boolean;
  crsAreaOfUseStatus: string;
  crsOutOfAreaStationCount: number;
  coordSystemDiagnostics: string[];
  coordSystemWarningMessages: string[];
  geoidModelEnabled: boolean;
  geoidModelId: string;
  geoidInterpolation: string;
  geoidModelLoaded: boolean;
  geoidModelMetadata?: string;
  geoidSampleUndulationM?: number | null;
  geoidHeightConversionEnabled: boolean;
  geoidOutputHeightDatum: string;
  geoidConvertedStationCount: number;
  geoidSkippedStationCount: number;
  gpsAddHiHtEnabled: boolean;
  gpsAddHiHtHiM: number;
  gpsAddHiHtHtM: number;
  gpsAddHiHtVectorCount: number;
  gpsAddHiHtAppliedCount: number;
  gpsAddHiHtPositiveCount: number;
  gpsAddHiHtNegativeCount: number;
  gpsAddHiHtNeutralCount: number;
  gpsAddHiHtDefaultZeroCount: number;
  gpsAddHiHtMissingHeightCount: number;
  gpsAddHiHtScaleMin: number;
  gpsAddHiHtScaleMax: number;
  gpsLoopCheckEnabled: boolean;
  gpsLoopDiagnostics?: {
    enabled: boolean;
    vectorCount: number;
    loopCount: number;
    passCount: number;
    warnCount: number;
  };
  levelLoopToleranceBaseMm: number;
  levelLoopTolerancePerSqrtKmMm: number;
  gpsOffsetObservations: Observation[];
  lostStationIds: string[];
  qFixLinearSigmaM: number;
  qFixAngularSigmaSec: number;
  descriptionReconcileMode: string;
  descriptionAppendDelimiter: string;
  descriptionScanSummary: unknown[];
  traceabilityModel: TraceabilityModelLike;
  showLostStations: boolean;
  autoSideshotEnabled: boolean;
  aliasTrace: Array<unknown>;
  clusterDiagnostics?: {
    enabled: boolean;
    passMode: string;
    linkageMode: string;
    dimension: string;
    tolerance: number;
    approvedMergeCount?: number;
    mergeOutcomes?: unknown[];
    rejectedProposals?: unknown[];
  };
  autoAdjustDiagnostics?: {
    enabled: boolean;
    threshold: number;
    maxCycles: number;
    maxRemovalsPerCycle: number;
    minRedundancy: number;
    stopReason: string;
    removed: unknown[];
  };
  autoSideshotDiagnostics?: {
    enabled: boolean;
    evaluatedCount: number;
    candidateCount: number;
    excludedControlCount: number;
    threshold: number;
  };
  projectInstrumentLibrary?: Record<string, ProjectInstrumentLike>;
  usedInstrumentCodes: Set<string>;
  hasInlineGpsFactorOverride: boolean;
  useClassicPreanalysisListing: boolean;
  usesClassicParityLayout: boolean;
  usesCompactGnssParityLayout: boolean;
  centerIndustryLine: typeof centerIndustryLine;
  pathTokenLeaf: (_pathToken: string) => string;
  pushSettingRow: (_label: string, _value: string) => void;
  parseStochasticDefaultsRows: (_summary: string) => SettingRow[];
  formatReductionUsage: (_summary?: ReductionUsageSummary) => string;
}
