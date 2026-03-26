import type {
  AdjustmentResult,
  CoordSystemDiagnosticCode,
  CoordSystemMode,
  CrsOffReason,
  CrsStatus,
  DatumSufficiencyReport,
  ParseOptions,
  ReductionUsageSummary,
} from '../types';

export interface FinalizeResultParseStateInput {
  parseState?: ParseOptions;
  coordSystemMode?: CoordSystemMode;
  coordSystemDiagnostics: Iterable<CoordSystemDiagnosticCode>;
  coordSystemWarningMessages: string[];
  crsStatus?: CrsStatus;
  crsOffReason?: CrsOffReason;
  crsDatumOpId?: string;
  crsDatumFallbackUsed: boolean;
  crsAreaOfUseStatus?: 'inside' | 'outside' | 'unknown';
  crsOutOfAreaStationCount?: number;
  scaleOverrideActive: boolean;
  gnssFrameConfirmed?: boolean;
  datumSufficiencyReport?: DatumSufficiencyReport;
  parsedUsageSummary: ReductionUsageSummary;
  usedInSolveUsageSummary: ReductionUsageSummary;
}

export const finalizeResultParseState = ({
  parseState,
  coordSystemMode,
  coordSystemDiagnostics,
  coordSystemWarningMessages,
  crsStatus,
  crsOffReason,
  crsDatumOpId,
  crsDatumFallbackUsed,
  crsAreaOfUseStatus,
  crsOutOfAreaStationCount,
  scaleOverrideActive,
  gnssFrameConfirmed,
  datumSufficiencyReport,
  parsedUsageSummary,
  usedInSolveUsageSummary,
}: FinalizeResultParseStateInput): ParseOptions | undefined => {
  if (!parseState) return undefined;

  const diagnostics = Array.from(coordSystemDiagnostics).sort();
  parseState.coordSystemDiagnostics = diagnostics;
  parseState.coordSystemWarningMessages = [...coordSystemWarningMessages];
  if (coordSystemMode === 'grid') {
    parseState.crsStatus = crsStatus;
    parseState.crsOffReason = crsStatus === 'off' ? crsOffReason : undefined;
  } else {
    parseState.crsStatus = undefined;
    parseState.crsOffReason = undefined;
  }
  parseState.crsDatumOpId = crsDatumOpId || undefined;
  parseState.crsDatumFallbackUsed =
    crsDatumFallbackUsed || diagnostics.includes('CRS_DATUM_FALLBACK');
  parseState.crsAreaOfUseStatus = crsAreaOfUseStatus;
  parseState.crsOutOfAreaStationCount = crsOutOfAreaStationCount;
  parseState.observationMode = {
    bearing: parseState.gridBearingMode ?? 'grid',
    distance: parseState.gridDistanceMode ?? 'measured',
    angle: parseState.gridAngleMode ?? 'measured',
    direction: parseState.gridDirectionMode ?? 'measured',
  };
  parseState.reductionContext = {
    inputSpaceDefault:
      (parseState.gridDistanceMode ?? 'measured') === 'measured' ? 'measured' : 'grid',
    distanceKind:
      (parseState.gridDistanceMode ?? 'measured') === 'ellipsoidal'
        ? 'ellipsoidal'
        : (parseState.gridDistanceMode ?? 'measured') === 'grid'
          ? 'grid'
          : 'ground',
    bearingKind: parseState.gridBearingMode ?? 'grid',
    explicitOverrideActive: scaleOverrideActive,
  };
  parseState.scaleOverrideActive = scaleOverrideActive;
  parseState.gnssFrameConfirmed = gnssFrameConfirmed;
  parseState.datumSufficiencyReport = datumSufficiencyReport;
  parseState.parsedUsageSummary = parseState.parsedUsageSummary ?? parsedUsageSummary;
  parseState.usedInSolveUsageSummary = parseState.usedInSolveUsageSummary ?? usedInSolveUsageSummary;
  return parseState;
};

export interface AdjustmentResultPayloadInput {
  success: boolean;
  converged: boolean;
  iterations: number;
  stations: AdjustmentResult['stations'];
  observations: AdjustmentResult['observations'];
  logs: AdjustmentResult['logs'];
  solveTimingProfile?: AdjustmentResult['solveTimingProfile'];
  seuw: number;
  dof: number;
  preanalysisMode?: boolean;
  parseState?: ParseOptions;
  condition?: AdjustmentResult['condition'];
  controlConstraints?: AdjustmentResult['controlConstraints'];
  stationCovariances?: AdjustmentResult['stationCovariances'];
  relativeCovariances?: AdjustmentResult['relativeCovariances'];
  precisionModels?: AdjustmentResult['precisionModels'];
  weakGeometryDiagnostics?: AdjustmentResult['weakGeometryDiagnostics'];
  chiSquare?: AdjustmentResult['chiSquare'];
  statisticalSummary?: AdjustmentResult['statisticalSummary'];
  typeSummary?: AdjustmentResult['typeSummary'];
  relativePrecision?: AdjustmentResult['relativePrecision'];
  directionSetDiagnostics?: AdjustmentResult['directionSetDiagnostics'];
  directionTargetDiagnostics?: AdjustmentResult['directionTargetDiagnostics'];
  directionRepeatabilityDiagnostics?: AdjustmentResult['directionRepeatabilityDiagnostics'];
  setupDiagnostics?: AdjustmentResult['setupDiagnostics'];
  tsCorrelationDiagnostics?: AdjustmentResult['tsCorrelationDiagnostics'];
  robustDiagnostics?: AdjustmentResult['robustDiagnostics'];
  residualDiagnostics?: AdjustmentResult['residualDiagnostics'];
  traverseDiagnostics?: AdjustmentResult['traverseDiagnostics'];
  sideshots?: AdjustmentResult['sideshots'];
  gpsLoopDiagnostics?: AdjustmentResult['gpsLoopDiagnostics'];
  levelingLoopDiagnostics?: AdjustmentResult['levelingLoopDiagnostics'];
  autoSideshotDiagnostics?: AdjustmentResult['autoSideshotDiagnostics'];
  clusterDiagnostics?: AdjustmentResult['clusterDiagnostics'];
  directionRejectDiagnostics?: AdjustmentResult['directionRejectDiagnostics'];
}

export const buildAdjustmentResultPayload = (
  input: AdjustmentResultPayloadInput,
): AdjustmentResult => ({
  success: input.success,
  converged: input.converged,
  iterations: input.iterations,
  stations: input.stations,
  observations: input.observations,
  logs: input.logs,
  solveTimingProfile: input.solveTimingProfile,
  seuw: input.seuw,
  dof: input.dof,
  preanalysisMode: input.preanalysisMode,
  parseState: input.parseState,
  condition: input.condition,
  controlConstraints: input.controlConstraints,
  stationCovariances: input.stationCovariances,
  relativeCovariances: input.relativeCovariances,
  precisionModels: input.precisionModels,
  weakGeometryDiagnostics: input.weakGeometryDiagnostics,
  chiSquare: input.chiSquare,
  statisticalSummary: input.statisticalSummary,
  typeSummary: input.typeSummary,
  relativePrecision: input.relativePrecision,
  directionSetDiagnostics: input.directionSetDiagnostics,
  directionTargetDiagnostics: input.directionTargetDiagnostics,
  directionRepeatabilityDiagnostics: input.directionRepeatabilityDiagnostics,
  setupDiagnostics: input.setupDiagnostics,
  tsCorrelationDiagnostics: input.tsCorrelationDiagnostics,
  robustDiagnostics: input.robustDiagnostics,
  residualDiagnostics: input.residualDiagnostics,
  traverseDiagnostics: input.traverseDiagnostics,
  sideshots: input.sideshots,
  gpsLoopDiagnostics: input.gpsLoopDiagnostics,
  levelingLoopDiagnostics: input.levelingLoopDiagnostics,
  autoSideshotDiagnostics: input.autoSideshotDiagnostics,
  clusterDiagnostics: input.clusterDiagnostics,
  directionRejectDiagnostics: input.directionRejectDiagnostics,
});
