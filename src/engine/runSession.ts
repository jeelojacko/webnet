import {
  extractAutoAdjustDirectiveFromInput,
  formatAutoAdjustLogLines,
  runAutoAdjustCycles,
  type AutoAdjustConfig,
} from './autoAdjust';
import {
  DEFAULT_QFIX_ANGULAR_SIGMA_SEC,
  DEFAULT_QFIX_LINEAR_SIGMA_M,
  DEFAULT_S9_INSTRUMENT_CENTERING_HORIZ_M,
} from './defaults';
import { isPreanalysisWhatIfCandidate } from './preanalysis';
import { normalizeClusterApprovedMerges, solveEngine } from './solveEngine';
import type { SolveProgressEvent } from './scenarioRunModels';
import type {
  AdjustmentResult,
  ClusterApprovedMerge,
  FaceNormalizationMode,
  GnssVectorFrame,
  GridDistanceInputMode,
  GridObservationMode,
  Instrument,
  InstrumentLibrary,
  LocalDatumScheme,
  Observation,
  ObservationOverride,
  ObservationModeSettings,
  ParseCompatibilityMode,
  ParseOptions,
  RobustMode,
  RunMode,
  SuspectImpactMode,
  TsCorrelationScope,
} from '../types';

type SolveProfile =
  | 'webnet'
  | 'industry-parity-current'
  | 'industry-parity-legacy'
  | 'legacy-compat'
  | 'industry-parity';

export interface RunSessionParseSettings {
  geometryDependentSigmaReference?: ParseOptions['geometryDependentSigmaReference'];
  solveProfile: SolveProfile;
  coordMode: '2D' | '3D';
  coordSystemMode: 'local' | 'grid';
  crsId: string;
  localDatumScheme: LocalDatumScheme;
  averageScaleFactor: number;
  commonElevation: number;
  averageGeoidHeight: number;
  gnssVectorFrameDefault: GnssVectorFrame;
  gnssFrameConfirmed: boolean;
  verticalDeflectionNorthSec: number;
  verticalDeflectionEastSec: number;
  observationMode?: ObservationModeSettings;
  gridBearingMode: GridObservationMode;
  gridDistanceMode: GridDistanceInputMode;
  gridAngleMode: GridObservationMode;
  gridDirectionMode: GridObservationMode;
  runMode: RunMode;
  preanalysisMode: boolean;
  clusterDetectionEnabled: boolean;
  autoSideshotEnabled: boolean;
  autoAdjustEnabled: boolean;
  autoAdjustMaxCycles: number;
  autoAdjustMaxRemovalsPerCycle: number;
  autoAdjustStdResThreshold: number;
  suspectImpactMode: SuspectImpactMode;
  order: ParseOptions['order'];
  angleUnits: 'dms' | 'dd';
  angleStationOrder: 'atfromto' | 'fromatto';
  angleMode: ParseOptions['angleMode'];
  deltaMode: ParseOptions['deltaMode'];
  mapMode: ParseOptions['mapMode'];
  mapScaleFactor?: number;
  normalize: boolean;
  faceNormalizationMode: FaceNormalizationMode;
  applyCurvatureRefraction: boolean;
  refractionCoefficient: number;
  verticalReduction: ParseOptions['verticalReduction'];
  levelWeight?: number;
  levelLoopToleranceBaseMm: number;
  levelLoopTolerancePerSqrtKmMm: number;
  crsTransformEnabled: boolean;
  crsProjectionModel: ParseOptions['crsProjectionModel'];
  crsLabel: string;
  crsGridScaleEnabled: boolean;
  crsGridScaleFactor: number;
  crsConvergenceEnabled: boolean;
  crsConvergenceAngleRad: number;
  geoidModelEnabled: boolean;
  geoidModelId: string;
  geoidSourceFormat: ParseOptions['geoidSourceFormat'];
  geoidSourcePath: string;
  geoidInterpolation: ParseOptions['geoidInterpolation'];
  geoidHeightConversionEnabled: boolean;
  geoidOutputHeightDatum: ParseOptions['geoidOutputHeightDatum'];
  gpsLoopCheckEnabled: boolean;
  gpsAddHiHtEnabled: boolean;
  gpsAddHiHtHiM: number;
  gpsAddHiHtHtM: number;
  qFixLinearSigmaM: number;
  qFixAngularSigmaSec: number;
  positionalToleranceEnabled?: boolean;
  positionalToleranceConstantMm?: number;
  positionalTolerancePpm?: number;
  positionalToleranceConfidencePercent?: number;
  prismEnabled: boolean;
  prismOffset: number;
  prismScope: 'global' | 'set';
  directionSetMode?: ParseOptions['directionSetMode'];
  descriptionReconcileMode: 'first' | 'append';
  descriptionAppendDelimiter: string;
  lonSign: 'west-positive' | 'west-negative';
  tsCorrelationEnabled: boolean;
  tsCorrelationRho: number;
  tsCorrelationScope: TsCorrelationScope;
  robustMode: RobustMode;
  robustK: number;
  parseCompatibilityMode: ParseCompatibilityMode;
  parseModeMigrated: boolean;
}

export interface RunSessionRequest {
  input: string;
  lastRunInput: string | null;
  maxIterations: number;
  convergenceLimit: number;
  units: 'm' | 'ft';
  parseSettings: RunSessionParseSettings;
  projectInstruments: InstrumentLibrary;
  selectedInstrument: string;
  projectIncludeFiles: Record<string, string>;
  geoidSourceData: Uint8Array | null;
  excludedIds: number[];
  overrides: Record<number, ObservationOverride>;
  approvedClusterMerges: ClusterApprovedMerge[];
}

export interface RunSessionOutcome {
  result: AdjustmentResult;
  effectiveExcludedIds: number[];
  effectiveClusterApprovedMerges: ClusterApprovedMerge[];
  droppedExclusions: number;
  droppedOverrides: number;
  droppedClusterMerges: number;
  inputChangedSinceLastRun: boolean;
  elapsedMs: number;
  profile: RunSessionProfile;
}

type RunSessionStageId =
  | 'main-solve'
  | 'suspect-impact'
  | 'preanalysis-impact'
  | 'robust-compare'
  | 'auto-adjust';

export interface RunSessionStageProfile {
  id: RunSessionStageId;
  label: string;
  durationMs: number;
  solveCount: number;
}

export interface RunSessionProfile {
  totalElapsedMs: number;
  solveInvocationCount: number;
  stages: RunSessionStageProfile[];
}

export interface RunSessionProgressUpdate {
  phase: 'solving' | 'finalizing';
  elapsedMs: number;
  stageId: RunSessionStageId;
  stageLabel: string;
  solveIndex: number;
  solveTotalHint: number;
  iteration?: number;
  maxIterations?: number;
}

export type RunSessionProgressCallback = (_event: RunSessionProgressUpdate) => void;

const IMPACT_MAX_CANDIDATES = 8;
const PREANALYSIS_IMPACT_MAX_CANDIDATES = 24;
const AUTO_ADJUST_MIN_REDUNDANCY = 0.05;
const SUSPECT_IMPACT_AUTO_SKIP_MAIN_SOLVE_MS = 5000;
const INDUSTRY_DEFAULT_INSTRUMENT_CODE = 'S9';

const createInstrument = (code: string, desc = ''): Instrument => ({
  code,
  desc,
  edm_const: 0,
  edm_ppm: 0,
  hzPrecision_sec: 0,
  dirPrecision_sec: 0,
  azBearingPrecision_sec: 0,
  vaPrecision_sec: 0,
  instCentr_m: 0,
  tgtCentr_m: 0,
  vertCentr_m: 0,
  elevDiff_const_m: 0,
  elevDiff_ppm: 0,
  gpsStd_xy: 0,
  levStd_mmPerKm: 0,
});

const INDUSTRY_DEFAULT_INSTRUMENT: Instrument = {
  ...createInstrument('S9', 'industry standard S9 0.5"'),
  edm_const: 0.001,
  edm_ppm: 1,
  hzPrecision_sec: 0.5,
  dirPrecision_sec: 0.5,
  azBearingPrecision_sec: 0.5,
  vaPrecision_sec: 0.5,
  instCentr_m: DEFAULT_S9_INSTRUMENT_CENTERING_HORIZ_M,
  tgtCentr_m: 0,
};

const observationStationsLabel = (obs: Observation): string => {
  if ('at' in obs && 'from' in obs && 'to' in obs) return `${obs.at}-${obs.from}-${obs.to}`;
  if ('at' in obs && 'to' in obs) return `${obs.at}-${obs.to}`;
  if ('from' in obs && 'to' in obs) return `${obs.from}-${obs.to}`;
  return '-';
};

const hasLocalFailure = (obs: Observation): boolean => {
  if (obs.localTestComponents) return !obs.localTestComponents.passE || !obs.localTestComponents.passN;
  if (obs.localTest) return !obs.localTest.pass;
  return false;
};

const maxAbsStdRes = (res: AdjustmentResult): number =>
  res.observations.reduce((maxValue, obs) => {
    if (!Number.isFinite(obs.stdRes)) return maxValue;
    return Math.max(maxValue, Math.abs(obs.stdRes ?? 0));
  }, 0);

const rankedSuspects = (
  res: AdjustmentResult,
  limit = 10,
): NonNullable<AdjustmentResult['robustComparison']>['robustTop'] =>
  [...res.observations]
    .filter((obs) => Number.isFinite(obs.stdRes))
    .map((obs) => ({
      obsId: obs.id,
      type: obs.type,
      stations: observationStationsLabel(obs),
      sourceLine: obs.sourceLine,
      stdRes: obs.stdRes != null ? Math.abs(obs.stdRes) : undefined,
      localFail: hasLocalFailure(obs),
    }))
    .sort((a, b) => {
      const aFail = a.localFail ? 1 : 0;
      const bFail = b.localFail ? 1 : 0;
      if (bFail !== aFail) return bFail - aFail;
      return (b.stdRes ?? 0) - (a.stdRes ?? 0);
    })
    .slice(0, limit)
    .map((row, index) => ({ ...row, rank: index + 1 }));

export const collectSuspectImpactCandidates = (base: AdjustmentResult): Observation[] =>
  [...base.observations]
    .filter((obs) => Number.isFinite(obs.stdRes))
    .filter((obs) => hasLocalFailure(obs) || Math.abs(obs.stdRes ?? 0) >= 2)
    .sort((a, b) => {
      const aFail = hasLocalFailure(a) ? 1 : 0;
      const bFail = hasLocalFailure(b) ? 1 : 0;
      if (bFail !== aFail) return bFail - aFail;
      return Math.abs(b.stdRes ?? 0) - Math.abs(a.stdRes ?? 0);
    })
    .slice(0, IMPACT_MAX_CANDIDATES);

export const resolveSuspectImpactSkipReason = ({
  mode,
  mainSolveElapsedMs,
  candidateCount,
}: {
  mode: SuspectImpactMode;
  mainSolveElapsedMs: number;
  candidateCount: number;
}): string | null => {
  if (candidateCount <= 0) return null;
  if (mode === 'off') return 'disabled in Project Options.';
  if (mode !== 'auto') return null;
  if (mainSolveElapsedMs <= SUSPECT_IMPACT_AUTO_SKIP_MAIN_SOLVE_MS) return null;
  return `auto-skip triggered because the main solve took ${(mainSolveElapsedMs / 1000).toFixed(1)} s (threshold ${(SUSPECT_IMPACT_AUTO_SKIP_MAIN_SOLVE_MS / 1000).toFixed(1)} s).`;
};

const maxUnknownCoordinateShift = (base: AdjustmentResult, alt: AdjustmentResult): number => {
  let maxShift = 0;
  Object.entries(base.stations).forEach(([id, station]) => {
    if (station.fixed) return;
    const altStation = alt.stations[id];
    if (!altStation) return;
    const dx = altStation.x - station.x;
    const dy = altStation.y - station.y;
    const dh = altStation.h - station.h;
    maxShift = Math.max(maxShift, Math.sqrt(dx * dx + dy * dy + dh * dh));
  });
  return maxShift;
};

const medianOf = (values: number[]): number | undefined => {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (sorted.length === 0) return undefined;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : 0.5 * (sorted[mid - 1] + sorted[mid]);
};

const preanalysisStationMajors = (res: AdjustmentResult): number[] =>
  (res.stationCovariances ?? []).map(
    (row) => row.ellipse?.semiMajor ?? Math.max(row.sigmaE, row.sigmaN),
  );

const preanalysisRelativeMetrics = (res: AdjustmentResult): number[] =>
  (res.relativeCovariances ?? []).map(
    (row) => row.sigmaDist ?? row.ellipse?.semiMajor ?? Math.max(row.sigmaE, row.sigmaN),
  );

const preanalysisWeakStationCount = (res: AdjustmentResult): number =>
  (res.weakGeometryDiagnostics?.stationCues ?? []).filter((cue) => cue.severity !== 'ok').length;

const preanalysisWeakPairCount = (res: AdjustmentResult): number =>
  (res.weakGeometryDiagnostics?.relativeCues ?? []).filter((cue) => cue.severity !== 'ok').length;

const normalizeSolveProfile = (
  profile: SolveProfile,
): Exclude<SolveProfile, 'industry-parity'> =>
  profile === 'industry-parity' ? 'industry-parity-current' : profile;

const resolveProfileContext = (
  base: RunSessionParseSettings,
  projectInstruments: InstrumentLibrary,
  selectedInstrument: string,
) => {
  const solveProfile = normalizeSolveProfile(base.solveProfile);
  const parity = solveProfile !== 'webnet';
  const requestedRunMode: RunMode =
    base.runMode ?? (base.preanalysisMode ? 'preanalysis' : 'adjustment');
  const defaultParseCompatibilityMode: ParseCompatibilityMode =
    solveProfile === 'legacy-compat' ? 'legacy' : parity ? 'strict' : 'legacy';
  const defaultFaceNormalizationMode: FaceNormalizationMode =
    solveProfile === 'industry-parity-current'
      ? 'on'
      : solveProfile === 'industry-parity-legacy'
        ? 'off'
        : solveProfile === 'legacy-compat'
          ? 'auto'
          : (base.faceNormalizationMode ?? (base.normalize ? 'on' : 'off'));
  const normalizedBase: RunSessionParseSettings = {
    ...base,
    solveProfile,
    runMode: requestedRunMode,
    preanalysisMode: requestedRunMode === 'preanalysis',
    suspectImpactMode: base.suspectImpactMode ?? 'auto',
    parseCompatibilityMode: base.parseCompatibilityMode ?? defaultParseCompatibilityMode,
    faceNormalizationMode: base.faceNormalizationMode ?? defaultFaceNormalizationMode,
  };
  normalizedBase.normalize = normalizedBase.faceNormalizationMode !== 'off';
  const parityParse = parity
    ? {
        ...normalizedBase,
        geometryDependentSigmaReference: 'initial' as const,
        robustMode: 'none' as RobustMode,
        tsCorrelationEnabled: false,
        tsCorrelationRho: 0,
      }
    : {
        ...normalizedBase,
        geometryDependentSigmaReference: normalizedBase.geometryDependentSigmaReference ?? 'current',
      };
  const effectiveParse =
    requestedRunMode === 'preanalysis'
      ? {
          ...parityParse,
          robustMode: 'none' as RobustMode,
          autoAdjustEnabled: false,
          preanalysisMode: true,
        }
      : {
          ...parityParse,
          preanalysisMode: false,
        };
  const directionSetMode: ParseOptions['directionSetMode'] = parity ? 'raw' : 'reduced';
  const allowClusterFaceReliability = solveProfile === 'legacy-compat';
  const effectiveInstrumentLibrary = parity
    ? {
        ...projectInstruments,
        ...(projectInstruments[INDUSTRY_DEFAULT_INSTRUMENT_CODE]
          ? {}
          : { [INDUSTRY_DEFAULT_INSTRUMENT_CODE]: INDUSTRY_DEFAULT_INSTRUMENT }),
      }
    : projectInstruments;
  const currentInstrument = parity
    ? selectedInstrument && effectiveInstrumentLibrary[selectedInstrument]
      ? selectedInstrument
      : INDUSTRY_DEFAULT_INSTRUMENT_CODE
    : selectedInstrument || undefined;
  return {
    effectiveParse,
    directionSetMode,
    allowClusterFaceReliability,
    effectiveInstrumentLibrary,
    currentInstrument,
  };
};

const buildParseOptions = (
  request: RunSessionRequest,
  effectiveParse: RunSessionParseSettings,
  directionSetMode: ParseOptions['directionSetMode'],
  allowClusterFaceReliability: boolean,
  approvedClusterMerges: ClusterApprovedMerge[],
  currentInstrument?: string,
): Partial<ParseOptions> => ({
  geometryDependentSigmaReference: effectiveParse.geometryDependentSigmaReference,
  runMode: effectiveParse.runMode,
  sourceFile: '<project-main>',
  includeFiles: request.projectIncludeFiles,
  units: request.units,
  coordMode: effectiveParse.coordMode,
  coordSystemMode: effectiveParse.coordSystemMode,
  crsId: effectiveParse.crsId,
  localDatumScheme: effectiveParse.localDatumScheme,
  averageScaleFactor: effectiveParse.averageScaleFactor,
  commonElevation: effectiveParse.commonElevation,
  averageGeoidHeight: effectiveParse.averageGeoidHeight,
  gnssVectorFrameDefault: effectiveParse.gnssVectorFrameDefault,
  gnssFrameConfirmed: effectiveParse.gnssFrameConfirmed,
  verticalDeflectionNorthSec: effectiveParse.verticalDeflectionNorthSec,
  verticalDeflectionEastSec: effectiveParse.verticalDeflectionEastSec,
  observationMode: {
    bearing: effectiveParse.gridBearingMode,
    distance: effectiveParse.gridDistanceMode,
    angle: effectiveParse.gridAngleMode,
    direction: effectiveParse.gridDirectionMode,
  },
  gridBearingMode: effectiveParse.gridBearingMode,
  gridDistanceMode: effectiveParse.gridDistanceMode,
  gridAngleMode: effectiveParse.gridAngleMode,
  gridDirectionMode: effectiveParse.gridDirectionMode,
  preanalysisMode: effectiveParse.runMode === 'preanalysis',
  order: effectiveParse.order,
  angleUnits: effectiveParse.angleUnits,
  angleStationOrder: effectiveParse.angleStationOrder,
  angleMode: effectiveParse.angleMode,
  deltaMode: effectiveParse.deltaMode,
  mapMode: effectiveParse.mapMode,
  mapScaleFactor: effectiveParse.mapScaleFactor,
  faceNormalizationMode: effectiveParse.faceNormalizationMode,
  normalize: effectiveParse.faceNormalizationMode !== 'off',
  directionFaceReliabilityFromCluster: allowClusterFaceReliability,
  applyCurvatureRefraction: effectiveParse.applyCurvatureRefraction,
  refractionCoefficient: effectiveParse.refractionCoefficient,
  verticalReduction: effectiveParse.verticalReduction,
  levelWeight: effectiveParse.levelWeight,
  levelLoopToleranceBaseMm: effectiveParse.levelLoopToleranceBaseMm,
  levelLoopTolerancePerSqrtKmMm: effectiveParse.levelLoopTolerancePerSqrtKmMm,
  crsTransformEnabled: effectiveParse.crsTransformEnabled,
  crsProjectionModel: effectiveParse.crsProjectionModel,
  crsLabel: effectiveParse.crsLabel,
  crsGridScaleEnabled: effectiveParse.crsGridScaleEnabled,
  crsGridScaleFactor: effectiveParse.crsGridScaleFactor,
  crsConvergenceEnabled: effectiveParse.crsConvergenceEnabled,
  crsConvergenceAngleRad: effectiveParse.crsConvergenceAngleRad,
  geoidModelEnabled: effectiveParse.geoidModelEnabled,
  geoidModelId: effectiveParse.geoidModelId,
  geoidSourceFormat: effectiveParse.geoidSourceFormat,
  geoidSourcePath: effectiveParse.geoidSourcePath,
  geoidInterpolation: effectiveParse.geoidInterpolation,
  geoidHeightConversionEnabled: effectiveParse.geoidHeightConversionEnabled,
  geoidOutputHeightDatum: effectiveParse.geoidOutputHeightDatum,
  gpsLoopCheckEnabled: effectiveParse.gpsLoopCheckEnabled,
  gpsAddHiHtEnabled: effectiveParse.gpsAddHiHtEnabled,
  gpsAddHiHtHiM: effectiveParse.gpsAddHiHtHiM,
  gpsAddHiHtHtM: effectiveParse.gpsAddHiHtHtM,
  qFixLinearSigmaM: effectiveParse.qFixLinearSigmaM ?? DEFAULT_QFIX_LINEAR_SIGMA_M,
  qFixAngularSigmaSec: effectiveParse.qFixAngularSigmaSec ?? DEFAULT_QFIX_ANGULAR_SIGMA_SEC,
  positionalToleranceEnabled: effectiveParse.positionalToleranceEnabled,
  positionalToleranceConstantMm: effectiveParse.positionalToleranceConstantMm,
  positionalTolerancePpm: effectiveParse.positionalTolerancePpm,
  positionalToleranceConfidencePercent: effectiveParse.positionalToleranceConfidencePercent,
  descriptionReconcileMode: effectiveParse.descriptionReconcileMode,
  descriptionAppendDelimiter: effectiveParse.descriptionAppendDelimiter,
  lonSign: effectiveParse.lonSign,
  tsCorrelationEnabled: effectiveParse.tsCorrelationEnabled,
  tsCorrelationRho: effectiveParse.tsCorrelationRho,
  tsCorrelationScope: effectiveParse.tsCorrelationScope,
  robustMode: effectiveParse.robustMode,
  robustK: effectiveParse.robustK,
  parseCompatibilityMode: effectiveParse.parseCompatibilityMode,
  parseModeMigrated: effectiveParse.parseModeMigrated,
  autoAdjustEnabled: effectiveParse.autoAdjustEnabled,
  autoAdjustMaxCycles: effectiveParse.autoAdjustMaxCycles,
  autoAdjustMaxRemovalsPerCycle: effectiveParse.autoAdjustMaxRemovalsPerCycle,
  autoAdjustStdResThreshold: effectiveParse.autoAdjustStdResThreshold,
  autoSideshotEnabled: effectiveParse.autoSideshotEnabled,
  directionSetMode,
  clusterDetectionEnabled: effectiveParse.clusterDetectionEnabled,
  clusterApprovedMerges: approvedClusterMerges,
  currentInstrument,
  preferExternalInstruments: true,
});

type SolveInvocationMeta = {
  stageId: RunSessionStageId;
  stageLabel: string;
  solveTotalHint: number;
};

const buildSuspectImpactDiagnostics = (
  base: AdjustmentResult,
  candidates: Observation[],
  baseExclusions: Set<number>,
  overrideValues: Record<number, ObservationOverride>,
  approvedClusterMerges: ClusterApprovedMerge[],
  solveCore: (
    _excludeSet: Set<number>,
    _parseOverride?: Partial<RunSessionParseSettings>,
    _overrideValues?: Record<number, ObservationOverride>,
    _approvedClusterMerges?: ClusterApprovedMerge[],
    _meta?: SolveInvocationMeta,
  ) => AdjustmentResult,
): NonNullable<AdjustmentResult['suspectImpactDiagnostics']> =>
  candidates
    .map((obs, index, candidateRows) => {
      const baseChiPass = base.chiSquare?.pass95;
      const baseMaxStd = maxAbsStdRes(base);
      const row: NonNullable<AdjustmentResult['suspectImpactDiagnostics']>[number] = {
        obsId: obs.id,
        type: obs.type,
        stations: observationStationsLabel(obs),
        sourceLine: obs.sourceLine,
        baseStdRes: obs.stdRes != null ? Math.abs(obs.stdRes) : undefined,
        baseLocalFail: hasLocalFailure(obs),
        chiDelta: '-',
        status: 'failed',
      };
      try {
        const altExclusions = new Set(baseExclusions);
        altExclusions.add(obs.id);
        const alt = solveCore(altExclusions, undefined, overrideValues, approvedClusterMerges, {
          stageId: 'suspect-impact',
          stageLabel: `Impact ${index + 1}/${candidateRows.length}`,
          solveTotalHint: 1 + candidateRows.length,
        });
        const altMaxStd = maxAbsStdRes(alt);
        const altChiPass = alt.chiSquare?.pass95;
        let chiDelta: typeof row.chiDelta = '-';
        if (baseChiPass != null && altChiPass != null) {
          chiDelta =
            !baseChiPass && altChiPass
              ? 'improved'
              : baseChiPass && !altChiPass
                ? 'degraded'
                : 'unchanged';
        }
        const deltaSeuw = alt.seuw - base.seuw;
        const deltaMaxStdRes = altMaxStd - baseMaxStd;
        const maxCoordShift = maxUnknownCoordinateShift(base, alt);
        let score = -deltaSeuw * 40 - deltaMaxStdRes * 20 - maxCoordShift * 15;
        if (chiDelta === 'improved') score += 20;
        if (chiDelta === 'degraded') score -= 20;
        return {
          ...row,
          deltaSeuw,
          deltaMaxStdRes,
          baseChiPass,
          altChiPass,
          chiDelta,
          maxCoordShift,
          score: Number.isFinite(score) ? score : undefined,
          status: 'ok' as const,
        };
      } catch {
        return row;
      }
    })
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === 'ok' ? -1 : 1;
      const bScore = b.score ?? Number.NEGATIVE_INFINITY;
      const aScore = a.score ?? Number.NEGATIVE_INFINITY;
      if (bScore !== aScore) return bScore - aScore;
      return (b.baseStdRes ?? 0) - (a.baseStdRes ?? 0);
    });

const buildPreanalysisImpactDiagnostics = (
  base: AdjustmentResult,
  baseExclusions: Set<number>,
  overrideValues: Record<number, ObservationOverride>,
  approvedClusterMerges: ClusterApprovedMerge[],
  solveCore: (
    _excludeSet: Set<number>,
    _parseOverride?: Partial<RunSessionParseSettings>,
    _overrideValues?: Record<number, ObservationOverride>,
    _approvedClusterMerges?: ClusterApprovedMerge[],
    _meta?: SolveInvocationMeta,
  ) => AdjustmentResult,
): NonNullable<AdjustmentResult['preanalysisImpactDiagnostics']> => {
  const allPlannedRows = [...base.observations].filter(isPreanalysisWhatIfCandidate);
  const plannedRows = allPlannedRows
    .sort((a, b) => {
      const aActive = baseExclusions.has(a.id) ? 0 : 1;
      const bActive = baseExclusions.has(b.id) ? 0 : 1;
      if (bActive !== aActive) return bActive - aActive;
      return (a.sourceLine ?? Number.MAX_SAFE_INTEGER) - (b.sourceLine ?? Number.MAX_SAFE_INTEGER);
    })
    .slice(0, PREANALYSIS_IMPACT_MAX_CANDIDATES);
  const baseStationMajors = preanalysisStationMajors(base);
  const baseRelativeMetrics = preanalysisRelativeMetrics(base);
  const baseWorstStationMajor =
    baseStationMajors.length > 0 ? Math.max(...baseStationMajors) : undefined;
  const baseMedianStationMajor = medianOf(baseStationMajors);
  const baseWorstPairSigmaDist =
    baseRelativeMetrics.length > 0 ? Math.max(...baseRelativeMetrics) : undefined;
  const baseWeakStations = preanalysisWeakStationCount(base);
  const baseWeakPairs = preanalysisWeakPairCount(base);

  const rows = plannedRows
    .map((obs, index, plannedCandidates) => {
      const plannedActive = !baseExclusions.has(obs.id);
      const action: 'add' | 'remove' = plannedActive ? 'remove' : 'add';
      const row: NonNullable<AdjustmentResult['preanalysisImpactDiagnostics']>['rows'][number] = {
        obsId: obs.id,
        type: obs.type,
        stations: observationStationsLabel(obs),
        sourceLine: obs.sourceLine,
        plannedActive,
        action,
        status: 'failed',
      };
      try {
        const altExclusions = new Set(baseExclusions);
        if (plannedActive) altExclusions.add(obs.id);
        else altExclusions.delete(obs.id);
        const alt = solveCore(altExclusions, undefined, overrideValues, approvedClusterMerges, {
          stageId: 'preanalysis-impact',
          stageLabel: `Preanalysis impact ${index + 1}/${plannedCandidates.length}`,
          solveTotalHint: 1 + plannedCandidates.length,
        });
        const altStationMajors = preanalysisStationMajors(alt);
        const altRelativeMetrics = preanalysisRelativeMetrics(alt);
        const altWorstStationMajor =
          altStationMajors.length > 0 ? Math.max(...altStationMajors) : undefined;
        const altMedianStationMajor = medianOf(altStationMajors);
        const altWorstPairSigmaDist =
          altRelativeMetrics.length > 0 ? Math.max(...altRelativeMetrics) : undefined;
        const altWeakStations = preanalysisWeakStationCount(alt);
        const altWeakPairs = preanalysisWeakPairCount(alt);
        const direction = action === 'remove' ? 1 : -1;
        const deltaWorstStationMajor =
          altWorstStationMajor != null && baseWorstStationMajor != null
            ? altWorstStationMajor - baseWorstStationMajor
            : undefined;
        const deltaMedianStationMajor =
          altMedianStationMajor != null && baseMedianStationMajor != null
            ? altMedianStationMajor - baseMedianStationMajor
            : undefined;
        const deltaWorstPairSigmaDist =
          altWorstPairSigmaDist != null && baseWorstPairSigmaDist != null
            ? altWorstPairSigmaDist - baseWorstPairSigmaDist
            : undefined;
        const deltaWeakStationCount = altWeakStations - baseWeakStations;
        const deltaWeakPairCount = altWeakPairs - baseWeakPairs;
        const score =
          direction * (deltaWorstStationMajor ?? 0) * 40 +
          direction * (deltaMedianStationMajor ?? 0) * 20 +
          direction * (deltaWorstPairSigmaDist ?? 0) * 25 +
          direction * deltaWeakStationCount * 5 +
          direction * deltaWeakPairCount * 4;
        return {
          ...row,
          deltaWorstStationMajor,
          deltaMedianStationMajor,
          deltaWorstPairSigmaDist,
          deltaWeakStationCount,
          deltaWeakPairCount,
          score: Number.isFinite(score) ? score : undefined,
          status: 'ok' as const,
        };
      } catch {
        return row;
      }
    })
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === 'ok' ? -1 : 1;
      if (a.action !== b.action) return a.action === 'remove' ? -1 : 1;
      const bScore = b.score ?? Number.NEGATIVE_INFINITY;
      const aScore = a.score ?? Number.NEGATIVE_INFINITY;
      if (bScore !== aScore) return bScore - aScore;
      return (a.sourceLine ?? Number.MAX_SAFE_INTEGER) - (b.sourceLine ?? Number.MAX_SAFE_INTEGER);
    });

  return {
    enabled: true,
    activePlannedCount: allPlannedRows.filter((obs) => !baseExclusions.has(obs.id)).length,
    excludedPlannedCount: allPlannedRows.filter((obs) => baseExclusions.has(obs.id)).length,
    baseWorstStationMajor,
    baseMedianStationMajor,
    baseWorstPairSigmaDist,
    baseWeakStationCount: baseWeakStations,
    baseWeakPairCount: baseWeakPairs,
    rows,
  };
};

export const runAdjustmentSession = (
  request: RunSessionRequest,
  onProgress?: RunSessionProgressCallback,
): RunSessionOutcome => {
  const startedAt = Date.now();
  let effectiveExclusions = new Set(request.excludedIds);
  let effectiveOverrides = request.overrides;
  let effectiveClusterMerges = request.parseSettings.clusterDetectionEnabled
    ? normalizeClusterApprovedMerges(request.approvedClusterMerges)
    : [];
  const inputChangedSinceLastRun =
    request.lastRunInput != null && request.input !== request.lastRunInput;
  const droppedExclusions = inputChangedSinceLastRun ? effectiveExclusions.size : 0;
  const droppedOverrides = inputChangedSinceLastRun ? Object.keys(effectiveOverrides).length : 0;
  const droppedClusterMerges = inputChangedSinceLastRun ? effectiveClusterMerges.length : 0;

  if (
    inputChangedSinceLastRun &&
    (droppedExclusions > 0 || droppedOverrides > 0 || droppedClusterMerges > 0)
  ) {
    effectiveExclusions = new Set();
    effectiveOverrides = {};
    effectiveClusterMerges = [];
  }

  const stageLabelForProfile = (stageId: RunSessionStageId): string => {
    switch (stageId) {
      case 'main-solve':
        return 'Main solve';
      case 'suspect-impact':
        return 'Suspect impact analysis';
      case 'preanalysis-impact':
        return 'Preanalysis impact analysis';
      case 'robust-compare':
        return 'Robust comparison';
      case 'auto-adjust':
        return 'Auto-adjust';
      default:
        return stageId;
    }
  };

  const stageProfiles = new Map<RunSessionStageId, RunSessionStageProfile>();
  let solveInvocationCount = 0;

  const recordStageDuration = (stageId: RunSessionStageId, durationMs: number): void => {
    const existing = stageProfiles.get(stageId);
    if (existing) {
      existing.durationMs += durationMs;
      existing.solveCount += 1;
      return;
    }
    stageProfiles.set(stageId, {
      id: stageId,
      label: stageLabelForProfile(stageId),
      durationMs,
      solveCount: 1,
    });
  };

  const emitProgress = (
    meta: SolveInvocationMeta,
    solveIndex: number,
    iteration?: number,
    maxIterations?: number,
    phase: RunSessionProgressUpdate['phase'] = 'solving',
  ): void => {
    onProgress?.({
      phase,
      elapsedMs: Date.now() - startedAt,
      stageId: meta.stageId,
      stageLabel: meta.stageLabel,
      solveIndex,
      solveTotalHint: Math.max(meta.solveTotalHint, solveIndex),
      iteration,
      maxIterations,
    });
  };

  const solveCore = (
    excludeSet: Set<number>,
    parseOverride?: Partial<RunSessionParseSettings>,
    overrideValues: Record<number, ObservationOverride> = effectiveOverrides,
    approvedClusterMerges: ClusterApprovedMerge[] = effectiveClusterMerges,
    meta: SolveInvocationMeta = {
      stageId: 'main-solve',
      stageLabel: 'Main solve',
      solveTotalHint: 1,
    },
  ): AdjustmentResult => {
    const mergedParse = { ...request.parseSettings, ...parseOverride };
    const profileContext = resolveProfileContext(
      mergedParse,
      request.projectInstruments,
      request.selectedInstrument,
    );
    const normalizedMerges = profileContext.effectiveParse.clusterDetectionEnabled
      ? normalizeClusterApprovedMerges(approvedClusterMerges)
      : [];
    const solveIndex = solveInvocationCount + 1;
    const stageStartedAt = Date.now();
    emitProgress(meta, solveIndex, undefined, request.maxIterations);
    const result = solveEngine({
      input: request.input,
      maxIterations: request.maxIterations,
      convergenceThreshold: request.convergenceLimit,
      instrumentLibrary: profileContext.effectiveInstrumentLibrary,
      excludeIds: excludeSet,
      overrides: overrideValues,
      geoidSourceData:
        profileContext.effectiveParse.geoidSourceFormat !== 'builtin'
          ? (request.geoidSourceData ?? undefined)
          : undefined,
      parseOptions: buildParseOptions(
        request,
        profileContext.effectiveParse,
        profileContext.directionSetMode,
        profileContext.allowClusterFaceReliability,
        normalizedMerges,
        profileContext.currentInstrument,
      ),
      progressCallback: (event: SolveProgressEvent) => {
        if (event.phase === 'complete') return;
        emitProgress(
          meta,
          solveIndex,
          event.iteration > 0 ? event.iteration : undefined,
          event.maxIterations,
        );
      },
    });
    solveInvocationCount += 1;
    recordStageDuration(meta.stageId, Date.now() - stageStartedAt);
    return result;
  };

  const solveWithImpacts = (
    excludeSet: Set<number>,
    overrideValues: Record<number, ObservationOverride> = effectiveOverrides,
    approvedClusterMerges: ClusterApprovedMerge[] = effectiveClusterMerges,
  ): AdjustmentResult => {
    const mainSolveStartedAt = Date.now();
    const solved = solveCore(excludeSet, undefined, overrideValues, approvedClusterMerges, {
      stageId: 'main-solve',
      stageLabel: 'Main solve',
      solveTotalHint: 1,
    });
    const mainSolveElapsedMs = Date.now() - mainSolveStartedAt;
    const profileContext = resolveProfileContext(
      request.parseSettings,
      request.projectInstruments,
      request.selectedInstrument,
    );
    if (profileContext.effectiveParse.runMode === 'preanalysis') {
      solved.suspectImpactDiagnostics = undefined;
      solved.preanalysisImpactDiagnostics = buildPreanalysisImpactDiagnostics(
        solved,
        excludeSet,
        overrideValues,
        approvedClusterMerges,
        solveCore,
      );
      solved.robustComparison = { enabled: false, classicalTop: [], robustTop: [], overlapCount: 0 };
      return solved;
    }
    if (profileContext.effectiveParse.runMode !== 'adjustment') {
      solved.suspectImpactDiagnostics = undefined;
      solved.preanalysisImpactDiagnostics = undefined;
      solved.robustComparison = { enabled: false, classicalTop: [], robustTop: [], overlapCount: 0 };
      return solved;
    }
    const suspectImpactCandidates = collectSuspectImpactCandidates(solved);
    const suspectImpactSkipReason = resolveSuspectImpactSkipReason({
      mode: profileContext.effectiveParse.suspectImpactMode,
      mainSolveElapsedMs,
      candidateCount: suspectImpactCandidates.length,
    });
    if (suspectImpactSkipReason) {
      solved.suspectImpactDiagnostics = undefined;
      solved.logs.unshift(
        `Suspect impact analysis skipped: ${suspectImpactSkipReason} Candidates=${suspectImpactCandidates.length}.`,
      );
    } else {
      solved.suspectImpactDiagnostics = buildSuspectImpactDiagnostics(
        solved,
        suspectImpactCandidates,
        excludeSet,
        overrideValues,
        approvedClusterMerges,
        solveCore,
      );
    }
    solved.preanalysisImpactDiagnostics = undefined;
    const suspectImpactCount = solved.suspectImpactDiagnostics?.length ?? 0;
    if (profileContext.effectiveParse.robustMode !== 'none') {
      const classical = solveCore(
        excludeSet,
        { robustMode: 'none' },
        overrideValues,
        approvedClusterMerges,
        {
          stageId: 'robust-compare',
          stageLabel: 'Robust comparison',
          solveTotalHint: 1 + suspectImpactCount + 1,
        },
      );
      const classicalTop = rankedSuspects(classical, 10);
      const robustTop = rankedSuspects(solved, 10);
      const robustIds = new Set(robustTop.map((row) => row.obsId));
      solved.robustComparison = {
        enabled: true,
        classicalTop,
        robustTop,
        overlapCount: classicalTop.reduce(
          (count, row) => count + (robustIds.has(row.obsId) ? 1 : 0),
          0,
        ),
      };
    } else {
      solved.robustComparison = { enabled: false, classicalTop: [], robustTop: [], overlapCount: 0 };
    }
    return solved;
  };

  const uiRunMode: RunMode =
    request.parseSettings.runMode ??
    (request.parseSettings.preanalysisMode ? 'preanalysis' : 'adjustment');
  const inlineAutoAdjust = extractAutoAdjustDirectiveFromInput(request.input);
  const autoAdjustConfig: AutoAdjustConfig = {
    enabled:
      uiRunMode === 'adjustment'
        ? (inlineAutoAdjust?.enabled ?? request.parseSettings.autoAdjustEnabled)
        : false,
    maxCycles: inlineAutoAdjust?.maxCycles ?? request.parseSettings.autoAdjustMaxCycles,
    maxRemovalsPerCycle:
      inlineAutoAdjust?.maxRemovalsPerCycle ?? request.parseSettings.autoAdjustMaxRemovalsPerCycle,
    stdResThreshold:
      inlineAutoAdjust?.stdResThreshold ?? request.parseSettings.autoAdjustStdResThreshold,
    minRedundancy: AUTO_ADJUST_MIN_REDUNDANCY,
  };

  let autoAdjustSummary: ReturnType<typeof runAutoAdjustCycles> | null = null;
  if (autoAdjustConfig.enabled) {
    autoAdjustSummary = runAutoAdjustCycles(
      effectiveExclusions,
      autoAdjustConfig,
      (trialExclusions) =>
        solveCore(trialExclusions, undefined, effectiveOverrides, effectiveClusterMerges, {
          stageId: 'auto-adjust',
          stageLabel: 'Auto-adjust',
          solveTotalHint: solveInvocationCount + 1,
        }),
    );
    effectiveExclusions = autoAdjustSummary.finalExcludedIds;
  }

  const result = solveWithImpacts(effectiveExclusions, effectiveOverrides, effectiveClusterMerges);
  emitProgress(
    {
      stageId: 'main-solve',
      stageLabel: 'Finalizing result',
      solveTotalHint: solveInvocationCount,
    },
    solveInvocationCount,
    undefined,
    undefined,
    'finalizing',
  );
  if (autoAdjustSummary?.enabled) {
    result.autoAdjustDiagnostics = {
      enabled: true,
      threshold: autoAdjustSummary.config.stdResThreshold,
      maxCycles: autoAdjustSummary.config.maxCycles,
      maxRemovalsPerCycle: autoAdjustSummary.config.maxRemovalsPerCycle,
      minRedundancy: autoAdjustSummary.config.minRedundancy ?? AUTO_ADJUST_MIN_REDUNDANCY,
      stopReason: autoAdjustSummary.stopReason,
      cycles: autoAdjustSummary.cycles.map((cycle) => ({
        cycle: cycle.cycle,
        seuw: cycle.seuw,
        maxAbsStdRes: cycle.maxAbsStdRes,
        removals: [...cycle.removals],
      })),
      removed: autoAdjustSummary.cycles.flatMap((cycle) => cycle.removals),
    };
    const autoLines = formatAutoAdjustLogLines(autoAdjustSummary);
    for (let i = autoLines.length - 1; i >= 0; i -= 1) {
      result.logs.unshift(autoLines[i]);
    }
  }

  const elapsedMs = Date.now() - startedAt;
  const profile: RunSessionProfile = {
    totalElapsedMs: elapsedMs,
    solveInvocationCount,
    stages: [...stageProfiles.values()],
  };

  return {
    result,
    effectiveExcludedIds: [...effectiveExclusions],
    effectiveClusterApprovedMerges: effectiveClusterMerges,
    droppedExclusions,
    droppedOverrides,
    droppedClusterMerges,
    inputChangedSinceLastRun,
    elapsedMs,
    profile,
  };
};
