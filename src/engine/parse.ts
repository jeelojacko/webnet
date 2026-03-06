import { dmsToRad, RAD_TO_DEG, SEC_TO_RAD } from './angles';
import { parseAutoAdjustDirectiveTokens } from './autoAdjust';
import { DEFAULT_CANADA_CRS_ID, normalizeCrsId } from './crsCatalog';
import { normalizeGeoidModelId, parseGeoidInterpolationToken } from './geoid';
import { parseCrsProjectionModelToken, projectGeodeticToEN } from './geodesy';
import type {
  AngleObservation,
  CoordSystemMode,
  CrsProjectionModel,
  DistanceObservation,
  DirectionRejectDiagnostic,
  DirObservation,
  GridDistanceInputMode,
  GridObservationMode,
  GpsObservation,
  Instrument,
  InstrumentLibrary,
  LevelObservation,
  Observation,
  ParseResult,
  StationMap,
  StationId,
  ParseOptions,
  GpsTopoCoordinateShot,
  MapMode,
  AngleMode,
  GeoidHeightDatum,
  GpsVectorMode,
} from '../types';

const defaultParseOptions: ParseOptions = {
  units: 'm',
  coordMode: '3D',
  coordSystemMode: 'local',
  crsId: DEFAULT_CANADA_CRS_ID,
  localDatumScheme: 'average-scale',
  averageScaleFactor: 1,
  commonElevation: 0,
  averageGeoidHeight: 0,
  gridBearingMode: 'grid',
  gridDistanceMode: 'measured',
  gridAngleMode: 'measured',
  gridDirectionMode: 'measured',
  preanalysisMode: false,
  order: 'EN',
  angleStationOrder: 'atfromto',
  deltaMode: 'slope',
  mapMode: 'off',
  normalize: true,
  mapScaleFactor: 1,
  applyCurvatureRefraction: false,
  refractionCoefficient: 0.13,
  verticalReduction: 'none',
  crsTransformEnabled: false,
  crsProjectionModel: 'legacy-equirectangular',
  crsLabel: '',
  crsGridScaleEnabled: false,
  crsGridScaleFactor: 1,
  crsConvergenceEnabled: false,
  crsConvergenceAngleRad: 0,
  geoidModelEnabled: false,
  geoidModelId: 'NGS-DEMO',
  geoidInterpolation: 'bilinear',
  geoidHeightConversionEnabled: false,
  geoidOutputHeightDatum: 'orthometric',
  geoidModelLoaded: false,
  geoidModelMetadata: '',
  geoidSampleUndulationM: undefined,
  geoidConvertedStationCount: 0,
  geoidSkippedStationCount: 0,
  gpsVectorMode: 'network',
  gpsTopoShots: [],
  gpsAddHiHtEnabled: false,
  gpsAddHiHtHiM: 0,
  gpsAddHiHtHtM: 0,
  gpsLoopCheckEnabled: false,
  levelLoopToleranceBaseMm: 0,
  levelLoopTolerancePerSqrtKmMm: 4,
  lonSign: 'west-negative',
  currentInstrument: undefined,
  edmMode: 'additive',
  applyCentering: true,
  addCenteringToExplicit: false,
  debug: false,
  angleMode: 'auto',
  tsCorrelationEnabled: false,
  tsCorrelationRho: 0.25,
  tsCorrelationScope: 'set',
  robustMode: 'none',
  robustK: 1.5,
  descriptionReconcileMode: 'first',
  descriptionAppendDelimiter: ' | ',
  qFixLinearSigmaM: 1e-9,
  qFixAngularSigmaSec: 1e-9,
  prismEnabled: false,
  prismOffset: 0,
  prismScope: 'global',
  rotationAngleRad: 0,
  lostStationIds: [],
  autoAdjustEnabled: false,
  autoAdjustMaxCycles: 3,
  autoAdjustMaxRemovalsPerCycle: 1,
  autoAdjustStdResThreshold: 4,
  autoSideshotEnabled: true,
  directionSetMode: 'reduced',
  clusterDetectionEnabled: true,
  clusterLinkageMode: 'single',
  clusterTolerance2D: 0.03,
  clusterTolerance3D: 0.05,
  clusterApprovedMerges: [],
  clusterPassLabel: 'single',
  clusterDualPassRan: false,
  clusterApprovedMergeCount: 0,
  preferExternalInstruments: false,
};

const FT_PER_M = 3.280839895;
const FACE2_WEIGHT = 0.707; // face-2 weighting factor per common spec
const DEG_TO_RAD = Math.PI / 180;
const AMODE_AUTO_MAX_DIR_RAD = 3 * DEG_TO_RAD;
const AMODE_AUTO_MARGIN_RAD = 0.5 * DEG_TO_RAD;
const DESCRIPTION_RECORD_TYPES = new Set(['C', 'P', 'PH', 'CH', 'EH', 'E']);
const normalizeDescriptionText = (value: string): string => value.replace(/\s+/g, ' ').trim();
const normalizeDescriptionKey = (value: string): string =>
  normalizeDescriptionText(value).toUpperCase();
const splitInlineCommentAndDescription = (line: string): { line: string; description?: string } => {
  const hash = line.indexOf('#');
  const quote = line.indexOf("'");
  let cut = -1;
  if (hash >= 0) cut = hash;
  if (quote >= 0) cut = cut >= 0 ? Math.min(cut, quote) : quote;
  const parsedLine = cut >= 0 ? line.slice(0, cut).trim() : line.trim();
  const description =
    quote >= 0 && (hash < 0 || quote < hash) ? normalizeDescriptionText(line.slice(quote + 1)) : '';
  return description ? { line: parsedLine, description } : { line: parsedLine };
};

const isWhitespaceCharCode = (code: number): boolean =>
  code === 32 || code === 9 || code === 10 || code === 11 || code === 12 || code === 13;

const splitWhitespaceTokens = (line: string): string[] => {
  const tokens: string[] = [];
  let start = -1;
  for (let i = 0; i < line.length; i += 1) {
    if (isWhitespaceCharCode(line.charCodeAt(i))) {
      if (start >= 0) {
        tokens.push(line.slice(start, i));
        start = -1;
      }
    } else if (start < 0) {
      start = i;
    }
  }
  if (start >= 0) tokens.push(line.slice(start));
  return tokens;
};

const splitCommaTokens = (tokens: string[], trimSegments: boolean): string[] => {
  const expanded: string[] = [];
  tokens.forEach((token) => {
    let start = 0;
    for (let i = 0; i <= token.length; i += 1) {
      if (i === token.length || token.charCodeAt(i) === 44) {
        const segment = token.slice(start, i);
        const normalized = trimSegments ? segment.trim() : segment;
        if (normalized.length > 0) expanded.push(normalized);
        start = i + 1;
      }
    }
  });
  return expanded;
};

const isNumericToken = (token: string): boolean => {
  if (!token) return false;
  if (token === '!' || token === '*') return false;
  return !Number.isNaN(Number(token));
};

const parseFixityTokens = (
  tokens: string[],
  componentCount: number,
): { fixities: boolean[]; hasTokens: boolean; legacyStarFixed: boolean } => {
  const raw = tokens.filter((t) => t === '!' || t === '*');
  if (!raw.length) {
    return {
      fixities: new Array(componentCount).fill(false),
      hasTokens: false,
      legacyStarFixed: false,
    };
  }
  if (raw.length === 1 && raw[0] === '!') {
    return {
      fixities: new Array(componentCount).fill(true),
      hasTokens: true,
      legacyStarFixed: false,
    };
  }
  if (raw.length === 1 && raw[0] === '*') {
    return {
      fixities: new Array(componentCount).fill(true),
      hasTokens: true,
      legacyStarFixed: true,
    };
  }
  const fixities = new Array(componentCount).fill(false);
  for (let i = 0; i < componentCount && i < raw.length; i += 1) {
    fixities[i] = raw[i] === '!';
  }
  return { fixities, hasTokens: true, legacyStarFixed: false };
};

const parseConstraintCorrToken = (value: number | undefined): number | undefined => {
  if (!Number.isFinite(value as number)) return undefined;
  return Math.max(-0.999, Math.min(0.999, value as number));
};

const applyFixities = (
  station: StationMap[string],
  fix: { x?: boolean; y?: boolean; h?: boolean },
  coordMode: ParseOptions['coordMode'],
): void => {
  if (fix.x != null) station.fixedX = fix.x;
  if (fix.y != null) station.fixedY = fix.y;
  if (fix.h != null) station.fixedH = fix.h;
  const fx = station.fixedX ?? false;
  const fy = station.fixedY ?? false;
  const fh = station.fixedH ?? false;
  station.fixed = coordMode === '2D' ? fx && fy : fx && fy && fh;
};

type SigmaToken =
  | { kind: 'default' }
  | { kind: 'numeric'; value: number }
  | { kind: 'fixed' }
  | { kind: 'float' };

type SigmaSource = 'default' | 'explicit' | 'fixed' | 'float';

const FIXED_SIGMA = 1e-9;
const FLOAT_SIGMA = 1e9;

const wrapToPi = (val: number): number => {
  let v = val;
  if (v > Math.PI) v -= 2 * Math.PI;
  if (v < -Math.PI) v += 2 * Math.PI;
  return v;
};

const wrapTo2Pi = (val: number): number => {
  let v = val % (2 * Math.PI);
  if (v < 0) v += 2 * Math.PI;
  return v;
};

const weightedCircularMean = (values: number[], weights?: number[]): number => {
  if (!values.length) return 0;
  let sumSin = 0;
  let sumCos = 0;
  for (let i = 0; i < values.length; i += 1) {
    const w = Math.max(weights?.[i] ?? 1, 0);
    sumSin += w * Math.sin(values[i]);
    sumCos += w * Math.cos(values[i]);
  }
  if (Math.abs(sumSin) < 1e-18 && Math.abs(sumCos) < 1e-18) {
    return wrapTo2Pi(values[0] ?? 0);
  }
  return wrapTo2Pi(Math.atan2(sumSin, sumCos));
};

const weightedCircularSpread = (values: number[], mean: number, weights?: number[]): number => {
  if (!values.length) return 0;
  let sumW = 0;
  let sumSq = 0;
  for (let i = 0; i < values.length; i += 1) {
    const w = Math.max(weights?.[i] ?? 1, 0);
    const r = wrapToPi(values[i] - mean);
    sumW += w;
    sumSq += w * r * r;
  }
  if (sumW <= 0) return 0;
  return Math.sqrt(sumSq / sumW);
};

const azimuthFromTo = (
  stations: StationMap,
  from: StationId,
  to: StationId,
): { az: number; dist: number } | null => {
  const s1 = stations[from];
  const s2 = stations[to];
  if (!s1 || !s2) return null;
  const dx = s2.x - s1.x;
  const dy = s2.y - s1.y;
  let az = Math.atan2(dx, dy);
  if (az < 0) az += 2 * Math.PI;
  return { az, dist: Math.sqrt(dx * dx + dy * dy) };
};

const parseSigmaToken = (token?: string): SigmaToken | null => {
  if (!token) return null;
  if (token === '&' || token === '?') return { kind: 'default' };
  if (token === '!') return { kind: 'fixed' };
  if (token === '*') return { kind: 'float' };
  const value = parseFloat(token);
  if (!Number.isNaN(value)) return { kind: 'numeric', value };
  return null;
};

const extractSigmaTokens = (
  tokens: string[],
  count: number,
): { sigmas: SigmaToken[]; rest: string[] } => {
  const sigmas: SigmaToken[] = [];
  let idx = 0;
  for (; idx < tokens.length && sigmas.length < count; idx += 1) {
    const token = tokens[idx];
    if (token.includes('/')) break;
    const parsed = parseSigmaToken(token);
    if (!parsed) break;
    sigmas.push(parsed);
  }
  return { sigmas, rest: tokens.slice(idx) };
};

const resolveSigma = (
  token: SigmaToken | undefined,
  defaultSigma: number,
  fixedSigma = FIXED_SIGMA,
  floatSigma = FLOAT_SIGMA,
): { sigma: number; source: SigmaSource } => {
  if (!token || token.kind === 'default') return { sigma: defaultSigma, source: 'default' };
  if (token.kind === 'numeric') return { sigma: token.value, source: 'explicit' };
  if (token.kind === 'fixed') return { sigma: fixedSigma, source: 'fixed' };
  return { sigma: floatSigma, source: 'float' };
};

const defaultDistanceSigma = (
  inst: Instrument | undefined,
  dist: number,
  edmMode: ParseOptions['edmMode'],
  fallback = 0,
): number => {
  if (!inst) return fallback;
  const ppmTerm = inst.edm_ppm * 1e-6 * dist;
  if (edmMode === 'propagated') {
    return Math.sqrt(inst.edm_const * inst.edm_const + ppmTerm * ppmTerm);
  }
  return Math.abs(inst.edm_const) + Math.abs(ppmTerm);
};

const defaultHorizontalAngleSigmaSec = (inst: Instrument | undefined): number =>
  inst?.hzPrecision_sec ?? 0;

const defaultDirectionSigmaSec = (inst: Instrument | undefined): number =>
  inst?.dirPrecision_sec ?? defaultHorizontalAngleSigmaSec(inst);

const defaultAzimuthSigmaSec = (inst: Instrument | undefined): number =>
  inst?.azBearingPrecision_sec ?? defaultDirectionSigmaSec(inst);

const defaultZenithSigmaSec = (inst: Instrument | undefined): number => inst?.vaPrecision_sec ?? 0;

const defaultElevDiffSigma = (inst: Instrument | undefined, spanMeters: number): number => {
  if (!inst) return 0;
  const ppmTerm = (inst.elevDiff_ppm ?? 0) * 1e-6 * Math.abs(spanMeters);
  return Math.sqrt((inst.elevDiff_const_m ?? 0) ** 2 + ppmTerm ** 2);
};

const parseFromTo = (
  parts: string[],
  startIndex: number,
): { from: string; to: string; nextIndex: number } => {
  const token = parts[startIndex];
  if (!token) return { from: '', to: '', nextIndex: startIndex + 1 };
  if (token.includes('-')) {
    const [from, to] = token.split('-');
    return { from, to, nextIndex: startIndex + 1 };
  }
  const from = token;
  const to = parts[startIndex + 1] ?? '';
  return { from, to, nextIndex: startIndex + 2 };
};

type SsStationTokens =
  | {
      mode: 'legacy';
      at: string;
      to: string;
      explicitBacksight?: undefined;
      angleTokenIndex: number;
    }
  | {
      mode: 'at-to';
      at: string;
      to: string;
      explicitBacksight?: undefined;
      angleTokenIndex: number;
    }
  | {
      mode: 'at-from-to';
      at: string;
      to: string;
      explicitBacksight: string;
      angleTokenIndex: number;
    };

const parseSsStationTokens = (parts: string[]): SsStationTokens | null => {
  const first = parts[1] ?? '';
  if (!first) return null;
  if (first.includes('-')) {
    const stations = first.split('-').map((token) => token.trim()).filter(Boolean);
    if (stations.length === 2) {
      return {
        mode: 'at-to',
        at: stations[0],
        to: stations[1],
        angleTokenIndex: 2,
      };
    }
    if (stations.length === 3) {
      return {
        mode: 'at-from-to',
        at: stations[0],
        explicitBacksight: stations[1],
        to: stations[2],
        angleTokenIndex: 2,
      };
    }
    return null;
  }
  return {
    mode: 'legacy',
    at: first,
    to: parts[2] ?? '',
    angleTokenIndex: 3,
  };
};

const extractHiHt = (tokens: string[]): { hi?: number; ht?: number; rest: string[] } => {
  const idx = tokens.findIndex((t) => t.includes('/'));
  if (idx < 0) return { rest: tokens };
  const token = tokens[idx];
  const [hiStr, htStr] = token.split('/');
  const hi = parseFloat(hiStr);
  const ht = parseFloat(htStr);
  const rest = tokens.filter((_, i) => i !== idx);
  return {
    hi: Number.isNaN(hi) ? undefined : hi,
    ht: Number.isNaN(ht) ? undefined : ht,
    rest,
  };
};

const toDegrees = (token: string): number => {
  if (!token) return Number.NaN;
  if (token.includes('-')) return dmsToRad(token) * RAD_TO_DEG;
  return parseFloat(token);
};

const parseAngleTokenRad = (
  token: string | undefined,
  state: ParseOptions,
  fallbackMode: 'dms' | 'dd' = 'dms',
): number => {
  if (!token) return Number.NaN;
  const trimmed = token.trim();
  if (!trimmed) return Number.NaN;
  if (trimmed.includes('-')) return dmsToRad(trimmed);
  const val = parseFloat(trimmed);
  if (Number.isNaN(val)) return Number.NaN;
  const mode = state.angleUnits ?? fallbackMode;
  if (mode === 'dd') return val * DEG_TO_RAD;
  return dmsToRad(trimmed);
};

const applyPlanRotation = (angleRad: number, state: ParseOptions): number => {
  if (!Number.isFinite(angleRad)) return angleRad;
  const rotation = state.rotationAngleRad ?? 0;
  if (!Number.isFinite(rotation) || Math.abs(rotation) <= 0) return wrapTo2Pi(angleRad);
  return wrapTo2Pi(angleRad + rotation);
};

const activeCrsProjectionModel = (state: ParseOptions): CrsProjectionModel =>
  state.crsTransformEnabled
    ? (state.crsProjectionModel ?? 'legacy-equirectangular')
    : 'legacy-equirectangular';

const applyGridObservationDirective = (
  state: ParseOptions,
  mode: 'grid' | 'measured',
  parts: string[],
): string => {
  const tokens = parts.slice(1).map((token) => token.toUpperCase());
  const applyAll = tokens.length === 0;

  const setBearing = () => {
    state.gridBearingMode = mode;
  };
  const setDistance = (distanceMode?: GridDistanceInputMode) => {
    state.gridDistanceMode = distanceMode ?? (mode === 'grid' ? 'grid' : 'measured');
  };
  const setAngle = () => {
    state.gridAngleMode = mode;
  };
  const setDirection = () => {
    state.gridDirectionMode = mode;
  };

  if (applyAll) {
    setBearing();
    setDistance();
    setAngle();
    setDirection();
    return `${mode.toUpperCase()} mode applied to bearings/distances/angles/directions`;
  }

  tokens.forEach((token) => {
    if (token.startsWith('BEA')) setBearing();
    else if (
      token === 'DIST=ELLIP' ||
      token === 'DIST=ELLIPSOIDAL' ||
      token === 'DIST=ELLIPSOID' ||
      token === 'DISTANCE=ELLIP' ||
      token === 'DISTANCE=ELLIPSOIDAL' ||
      token === 'DISTANCE=ELLIPSOID'
    ) {
      setDistance('ellipsoidal');
    } else if (token.startsWith('DIST')) {
      setDistance();
    } else if (token.startsWith('ANG')) {
      setAngle();
    } else if (token.startsWith('DIR')) {
      setDirection();
    }
  });

  return `${mode.toUpperCase()} mode updated: bearing=${state.gridBearingMode?.toUpperCase()}, distance=${(state.gridDistanceMode ?? 'measured').toUpperCase()}, angle=${state.gridAngleMode?.toUpperCase()}, direction=${state.gridDirectionMode?.toUpperCase()}`;
};

const parseGeoidHeightDatumToken = (token?: string): GeoidHeightDatum | null => {
  if (!token) return null;
  const upper = token.trim().toUpperCase();
  if (!upper) return null;
  if (upper === 'ORTHOMETRIC' || upper === 'ORTHO') return 'orthometric';
  if (upper === 'ELLIPSOID' || upper === 'ELLIPSOIDAL' || upper === 'ELLIP') return 'ellipsoid';
  return null;
};

const parseGpsVectorModeToken = (token?: string): GpsVectorMode | null => {
  if (!token) return null;
  const upper = token.trim().toUpperCase();
  if (!upper) return null;
  if (upper === 'NETWORK' || upper === 'NET') return 'network';
  if (upper === 'SIDESHOT' || upper === 'SS') return 'sideshot';
  return null;
};

const parseLinearMetersToken = (
  token: string | undefined,
  units: ParseOptions['units'],
): number | null => {
  if (!token) return null;
  const parsed = parseFloat(token);
  if (!Number.isFinite(parsed)) return null;
  return units === 'ft' ? parsed / FT_PER_M : parsed;
};

export const parseInput = (
  input: string,
  existingInstruments: InstrumentLibrary = {},
  opts: Partial<ParseOptions> = {},
): ParseResult => {
  interface AliasRuleBase {
    sourceLine: number;
  }
  interface PrefixAliasRule extends AliasRuleBase {
    kind: 'prefix';
    from: string;
    to: string;
  }
  interface SuffixAliasRule extends AliasRuleBase {
    kind: 'suffix';
    from: string;
    to: string;
  }
  interface AdditiveAliasRule extends AliasRuleBase {
    kind: 'additive';
    offset: number;
  }
  type AliasRule = PrefixAliasRule | SuffixAliasRule | AdditiveAliasRule;
  interface AliasResolutionResult {
    canonicalId: StationId;
    reference: string;
  }
  type DirectionFace = 'face1' | 'face2';
  interface RawDirectionShot {
    to: StationId;
    obs: number;
    stdDev: number;
    sigmaSource: SigmaSource;
    sourceLine: number;
    face: DirectionFace;
  }

  const stations: StationMap = {};
  const observations: Observation[] = [];
  const instrumentLibrary: InstrumentLibrary = { ...existingInstruments };
  const logs: string[] = [];
  const directionRejectDiagnostics: DirectionRejectDiagnostic[] = [];
  const state: ParseOptions = { ...defaultParseOptions, ...opts };
  state.plannedObservationCount = 0;
  state.gpsTopoShots = [];
  const currentGridModeForType = (
    obsType: Observation['type'],
  ): { gridObsMode?: GridObservationMode; gridDistanceMode?: GridDistanceInputMode } => {
    if (obsType === 'dist') {
      const distanceMode = state.gridDistanceMode ?? 'measured';
      return {
        gridObsMode: distanceMode === 'measured' ? 'measured' : 'grid',
        gridDistanceMode: distanceMode,
      };
    }
    if (obsType === 'bearing' || obsType === 'dir') {
      return { gridObsMode: state.gridBearingMode ?? 'grid' };
    }
    if (obsType === 'angle') {
      return { gridObsMode: state.gridAngleMode ?? 'measured' };
    }
    if (obsType === 'direction') {
      return { gridObsMode: state.gridDirectionMode ?? 'measured' };
    }
    return {};
  };
  if (state.directionSetMode === 'raw') {
    logs.push('Direction set processing mode forced to raw (no target reduction).');
  }
  let orderExplicit = false;
  const traverseCtx: {
    occupy?: string;
    backsight?: string;
    backsightRefAngle?: number;
    dirSetId?: string;
    dirInstCode?: string;
    dirRawShots?: RawDirectionShot[];
  } = {};
  let faceMode: 'unknown' | 'face1' | 'face2' = 'unknown';
  let directionSetCount = 0;
  const explicitAliases = new Map<StationId, StationId>();
  const explicitAliasLines = new Map<StationId, number>();
  const aliasRules: AliasRule[] = [];
  const aliasCycleWarnings = new Set<string>();
  const aliasTraceEntries: NonNullable<ParseOptions['aliasTrace']> = [];
  const descriptionTraceEntries: NonNullable<ParseOptions['descriptionTrace']> = [];
  const aliasTraceSeen = new Set<string>();
  const lostStationIds = new Set<StationId>((state.lostStationIds ?? []).map((id) => `${id}`));
  const resolveLinearSigma = (
    token: SigmaToken | undefined,
    defaultSigma: number,
  ): { sigma: number; source: SigmaSource } => {
    const fixedM = Math.max(1e-12, state.qFixLinearSigmaM ?? FIXED_SIGMA);
    const fixedInputUnits = state.units === 'ft' ? fixedM * FT_PER_M : fixedM;
    return resolveSigma(token, defaultSigma, fixedInputUnits, FLOAT_SIGMA);
  };
  const resolveAngularSigma = (
    token: SigmaToken | undefined,
    defaultSigma: number,
  ): { sigma: number; source: SigmaSource } => {
    const fixedSec = Math.max(1e-12, state.qFixAngularSigmaSec ?? FIXED_SIGMA);
    return resolveSigma(token, defaultSigma, fixedSec, FLOAT_SIGMA);
  };

  const preloadedClusterMerges = (state.clusterApprovedMerges ?? [])
    .map((merge) => ({
      aliasId: String(merge.aliasId ?? '').trim(),
      canonicalId: String(merge.canonicalId ?? '').trim(),
    }))
    .filter(
      (merge) =>
        merge.aliasId.length > 0 &&
        merge.canonicalId.length > 0 &&
        merge.aliasId !== merge.canonicalId,
    );
  if (preloadedClusterMerges.length > 0) {
    preloadedClusterMerges.forEach((merge) => {
      explicitAliases.set(merge.aliasId, merge.canonicalId);
    });
    logs.push(`Cluster-approved alias merges preloaded: ${preloadedClusterMerges.length}`);
  }

  const lines = input.split('\n');
  let lineNum = 0;
  let obsId = 0;
  let lastGpsObservation: GpsObservation | undefined;
  const autoCreatedStations = new Set<StationId>();
  const rejectedAutoCreateTokens = new Set<string>();
  const preanalysisMode = state.preanalysisMode === true;
  const looksLikeNumericMeasurement = (token: string): boolean =>
    /^[+-]?\d+\.\d+(?:[eE][+-]?\d+)?$/.test(token);
  const isPlannedToken = (token?: string): boolean => preanalysisMode && token?.trim() === '?';
  const parseObservedLinearToken = (
    token: string | undefined,
    toMeters: number,
  ): { value: number; planned: boolean; valid: boolean } => {
    if (preanalysisMode && (token == null || token.trim() === '')) {
      return { value: 0, planned: true, valid: true };
    }
    if (isPlannedToken(token)) return { value: 0, planned: true, valid: true };
    const parsed = parseFloat(token ?? '');
    if (!Number.isFinite(parsed)) return { value: 0, planned: false, valid: false };
    return { value: parsed * toMeters, planned: false, valid: true };
  };
  const parseObservedAngleToken = (
    token: string | undefined,
    fallbackMode: 'dms' | 'dd',
  ): { value: number; planned: boolean; valid: boolean } => {
    if (preanalysisMode && (token == null || token.trim() === '')) {
      return { value: 0, planned: true, valid: true };
    }
    if (isPlannedToken(token)) return { value: 0, planned: true, valid: true };
    const parsed = parseAngleTokenRad(token, state, fallbackMode);
    if (!Number.isFinite(parsed)) return { value: 0, planned: false, valid: false };
    return { value: parsed, planned: false, valid: true };
  };
  const ensureStation = (id: StationId, context: string): void => {
    if (!id) return;
    if (stations[id]) return;
    if (looksLikeNumericMeasurement(id)) {
      if (!rejectedAutoCreateTokens.has(id)) {
        rejectedAutoCreateTokens.add(id);
        logs.push(
          `Warning: skipped auto-create for token "${id}" from ${context}; looks like a numeric value, not a station id.`,
        );
      }
      return;
    }
    stations[id] = {
      x: 0,
      y: 0,
      h: 0,
      lost: lostStationIds.has(id),
      fixed: false,
      fixedX: false,
      fixedY: false,
      fixedH: false,
    };
    if (!autoCreatedStations.has(id)) {
      autoCreatedStations.add(id);
      logs.push(
        `Auto-created station ${id} from ${context} with default approximate coordinates (0,0,0).`,
      );
    }
  };
  const ensureObservationStations = (obs: Observation): void => {
    const isSideshot =
      typeof obs.calc === 'object' &&
      obs.calc != null &&
      'sideshot' in obs.calc &&
      Boolean((obs.calc as { sideshot?: boolean }).sideshot);
    const isGpsSideshot = obs.type === 'gps' && obs.gpsMode === 'sideshot';
    if (isSideshot || isGpsSideshot) return;
    if (obs.type === 'angle') {
      ensureStation(obs.at, `${obs.type} observation`);
      ensureStation(obs.from, `${obs.type} observation`);
      ensureStation(obs.to, `${obs.type} observation`);
      return;
    }
    if (obs.type === 'direction') {
      ensureStation(obs.at, `${obs.type} observation`);
      ensureStation(obs.to, `${obs.type} observation`);
      return;
    }
    if (
      obs.type === 'dist' ||
      obs.type === 'bearing' ||
      obs.type === 'dir' ||
      obs.type === 'gps' ||
      obs.type === 'lev' ||
      obs.type === 'zenith'
    ) {
      ensureStation(obs.from, `${obs.type} observation`);
      ensureStation(obs.to, `${obs.type} observation`);
    }
  };
  const pushObservation = <T extends Observation>(obs: T): void => {
    ensureObservationStations(obs);
    if (obs.sourceLine == null) obs.sourceLine = lineNum;
    const gridMode = currentGridModeForType(obs.type);
    if (obs.gridObsMode == null && gridMode.gridObsMode != null) {
      obs.gridObsMode = gridMode.gridObsMode;
    }
    if (obs.type === 'dist' && obs.gridDistanceMode == null && gridMode.gridDistanceMode != null) {
      obs.gridDistanceMode = gridMode.gridDistanceMode;
    }
    if (obs.planned) {
      state.plannedObservationCount = (state.plannedObservationCount ?? 0) + 1;
    }
    if (obs.type === 'dist' || obs.type === 'zenith') {
      const prismEnabled = state.prismEnabled ?? false;
      const prismOffset = Number.isFinite(state.prismOffset ?? NaN) ? (state.prismOffset ?? 0) : 0;
      const prismScope: ParseOptions['prismScope'] = state.prismScope ?? 'global';
      const setScopedSetId = typeof obs.setId === 'string' ? obs.setId.trim() : '';
      const scopedBlocked = prismScope === 'set' && setScopedSetId.length === 0;
      if (prismEnabled && Math.abs(prismOffset) > 0 && !scopedBlocked) {
        obs.prismCorrectionM = prismOffset;
        obs.prismScope = prismScope;
      }
    }
    observations.push(obs);
  };
  const addExplicitAlias = (rawAlias: string, rawCanonical: string): boolean => {
    const alias = rawAlias.trim();
    const canonical = rawCanonical.trim();
    if (!alias || !canonical) return false;
    if (alias === canonical) {
      logs.push(
        `Warning: .ALIAS ${alias}=${canonical} ignored at line ${lineNum}; mapping is identity.`,
      );
      return false;
    }
    explicitAliases.set(alias, canonical);
    explicitAliasLines.set(alias, lineNum);
    return true;
  };
  const applyAliasRulesOnce = (id: StationId): { mappedId: StationId; steps: string[] } => {
    let mapped = id;
    const steps: string[] = [];
    for (const rule of aliasRules) {
      if (rule.kind === 'prefix') {
        if (rule.from && mapped.startsWith(rule.from)) {
          const prior = mapped;
          mapped = `${rule.to}${mapped.slice(rule.from.length)}`;
          steps.push(`PREFIX ${prior}->${mapped} (line ${rule.sourceLine})`);
        }
      } else if (rule.kind === 'suffix') {
        if (rule.from && mapped.endsWith(rule.from)) {
          const prior = mapped;
          mapped = `${mapped.slice(0, mapped.length - rule.from.length)}${rule.to}`;
          steps.push(`SUFFIX ${prior}->${mapped} (line ${rule.sourceLine})`);
        }
      } else if (/^[+-]?\d+$/.test(mapped)) {
        const prior = mapped;
        mapped = String(parseInt(mapped, 10) + rule.offset);
        steps.push(`ADD ${prior}->${mapped} (line ${rule.sourceLine})`);
      }
    }
    return { mappedId: mapped, steps };
  };
  const resolveAlias = (rawId: StationId): AliasResolutionResult => {
    const base = rawId?.trim() ?? '';
    if (!base) return { canonicalId: base, reference: 'direct' };
    const resolveExplicitChain = (start: StationId): { id: StationId; steps: string[] } => {
      let current = start;
      const seen = new Set<string>();
      const steps: string[] = [];
      while (true) {
        if (seen.has(current)) {
          const cycleKey = [...seen, current].join('->');
          if (!aliasCycleWarnings.has(cycleKey)) {
            aliasCycleWarnings.add(cycleKey);
            logs.push(
              `Warning: .ALIAS explicit cycle encountered for "${base}" at line ${lineNum}; last stable id "${current}" retained.`,
            );
          }
          return { id: current, steps };
        }
        seen.add(current);
        const next = explicitAliases.get(current);
        if (!next || next === current) return { id: current, steps };
        const explicitLine = explicitAliasLines.get(current);
        steps.push(
          `EXPLICIT ${current}->${next}${explicitLine != null ? ` (line ${explicitLine})` : ''}`,
        );
        current = next;
      }
    };
    const steps: string[] = [];
    const firstExplicit = resolveExplicitChain(base);
    steps.push(...firstExplicit.steps);
    const firstRules = applyAliasRulesOnce(firstExplicit.id);
    steps.push(...firstRules.steps);
    const secondExplicit = resolveExplicitChain(firstRules.mappedId);
    steps.push(...secondExplicit.steps);
    if (secondExplicit.id !== firstRules.mappedId) {
      const secondRules = applyAliasRulesOnce(secondExplicit.id);
      steps.push(...secondRules.steps);
      return {
        canonicalId: secondRules.mappedId,
        reference: steps.length ? steps.join(' | ') : 'direct',
      };
    }
    return {
      canonicalId: secondExplicit.id,
      reference: steps.length ? steps.join(' | ') : 'direct',
    };
  };
  const addAliasTrace = (
    sourceId: StationId,
    canonicalId: StationId,
    context: NonNullable<ParseOptions['aliasTrace']>[number]['context'],
    sourceLine?: number,
    detail?: string,
    reference?: string,
  ): void => {
    if (!sourceId || !canonicalId || sourceId === canonicalId) return;
    const key = `${context}|${detail ?? ''}|${sourceLine ?? -1}|${sourceId}|${canonicalId}`;
    if (aliasTraceSeen.has(key)) return;
    aliasTraceSeen.add(key);
    aliasTraceEntries.push({ sourceId, canonicalId, sourceLine, context, detail, reference });
  };
  const parseAliasPairs = (tokens: string[]): number => {
    const flattened = splitCommaTokens(tokens, false);
    let added = 0;
    for (let i = 0; i < flattened.length; ) {
      const token = flattened[i];
      if (!token) {
        i += 1;
        continue;
      }
      if (token.includes('=')) {
        const [lhs, rhs] = token.split('=');
        if (lhs && rhs && addExplicitAlias(lhs, rhs)) added += 1;
        i += 1;
        continue;
      }
      if (token.includes('->')) {
        const [lhs, rhs] = token.split('->');
        if (lhs && rhs && addExplicitAlias(lhs, rhs)) added += 1;
        i += 1;
        continue;
      }
      if (i + 1 >= flattened.length) {
        logs.push(
          `Warning: dangling .ALIAS token "${token}" at line ${lineNum}; expected alias pair.`,
        );
        break;
      }
      if (addExplicitAlias(token, flattened[i + 1])) added += 1;
      i += 2;
    }
    return added;
  };
  const combineSigmaSources = (shots: RawDirectionShot[]): SigmaSource => {
    if (!shots.length) return 'default';
    if (shots.some((s) => s.sigmaSource === 'fixed')) return 'fixed';
    if (shots.every((s) => s.sigmaSource === 'float')) return 'float';
    if (shots.every((s) => s.sigmaSource === 'default')) return 'default';
    return 'explicit';
  };
  const reduceDirectionShots = (
    setId: string,
    occupy: StationId,
    instCode: string,
    shots: RawDirectionShot[],
  ): void => {
    if (!shots.length) return;

    if (!state.normalize || state.directionSetMode === 'raw') {
      shots.forEach((shot) => {
        pushObservation({
          id: obsId++,
          type: 'direction',
          instCode,
          setId,
          at: occupy,
          to: shot.to,
          obs: shot.obs,
          stdDev: shot.stdDev,
          sigmaSource: shot.sigmaSource,
          sourceLine: shot.sourceLine,
          rawCount: 1,
          rawFace1Count: shot.face === 'face1' ? 1 : 0,
          rawFace2Count: shot.face === 'face2' ? 1 : 0,
          rawSpread: 0,
          rawMaxResidual: 0,
          reducedSigma: shot.stdDev,
        });
      });
      const reason = !state.normalize ? 'normalize OFF' : 'raw mode';
      logs.push(
        `Direction set ${setId} @ ${occupy}: kept ${shots.length} raw direction(s) (${reason})`,
      );
      return;
    }

    const byTarget = new Map<StationId, RawDirectionShot[]>();
    shots.forEach((shot) => {
      const list = byTarget.get(shot.to) ?? [];
      list.push(shot);
      byTarget.set(shot.to, list);
    });

    let reducedCount = 0;
    let pairedTargets = 0;
    let face1Total = 0;
    let face2Total = 0;

    const targets = [...byTarget.keys()].sort((a, b) => a.localeCompare(b));
    targets.forEach((to) => {
      const targetShots = byTarget.get(to) ?? [];
      if (!targetShots.length) return;
      const face1Count = targetShots.filter((s) => s.face === 'face1').length;
      const face2Count = targetShots.length - face1Count;
      face1Total += face1Count;
      face2Total += face2Count;
      if (face1Count > 0 && face2Count > 0) pairedTargets += 1;

      const normalized = targetShots.map((shot) => {
        const obs = shot.face === 'face2' ? wrapTo2Pi(shot.obs - Math.PI) : wrapTo2Pi(shot.obs);
        const weight = 1 / Math.max(shot.stdDev * shot.stdDev, 1e-24);
        return { ...shot, normalizedObs: obs, weight };
      });
      const obsValues = normalized.map((s) => s.normalizedObs);
      const obsWeights = normalized.map((s) => s.weight);
      const reducedObs = weightedCircularMean(obsValues, obsWeights);
      const sumW = obsWeights.reduce((acc, w) => acc + w, 0);
      const reducedSigma = sumW > 0 ? Math.sqrt(1 / sumW) : normalized[0].stdDev;
      const residuals = normalized.map((shot) => wrapToPi(shot.normalizedObs - reducedObs));
      const spread = weightedCircularSpread(obsValues, reducedObs, obsWeights);
      const rawMaxResidual = residuals.length ? Math.max(...residuals.map((r) => Math.abs(r))) : 0;

      const faceStats = (face: DirectionFace): { mean?: number; spread?: number } => {
        const faceShots = normalized.filter((s) => s.face === face);
        if (!faceShots.length) return {};
        const faceObs = faceShots.map((s) => s.normalizedObs);
        const faceWeights = faceShots.map((s) => s.weight);
        const mean = weightedCircularMean(faceObs, faceWeights);
        const faceSpread = weightedCircularSpread(faceObs, mean, faceWeights);
        return { mean, spread: faceSpread };
      };

      const face1Stats = faceStats('face1');
      const face2Stats = faceStats('face2');
      const facePairDelta =
        face1Stats.mean != null && face2Stats.mean != null
          ? Math.abs(wrapToPi(face1Stats.mean - face2Stats.mean))
          : undefined;

      pushObservation({
        id: obsId++,
        type: 'direction',
        instCode,
        setId,
        at: occupy,
        to,
        obs: reducedObs,
        stdDev: reducedSigma,
        sigmaSource: combineSigmaSources(targetShots),
        sourceLine: Math.min(...targetShots.map((s) => s.sourceLine)),
        rawCount: targetShots.length,
        rawFace1Count: face1Count,
        rawFace2Count: face2Count,
        rawSpread: spread,
        rawMaxResidual,
        facePairDelta,
        face1Spread: face1Stats.spread,
        face2Spread: face2Stats.spread,
        reducedSigma,
      });
      reducedCount += 1;
    });

    logs.push(
      `Direction set reduction ${setId} @ ${occupy}: raw ${shots.length} -> reduced ${reducedCount} (paired targets=${pairedTargets}, F1=${face1Total}, F2=${face2Total})`,
    );
  };
  const flushDirectionSet = (reason: string): void => {
    if (!traverseCtx.dirSetId || !traverseCtx.occupy) return;
    const shots = traverseCtx.dirRawShots ?? [];
    const instCode = traverseCtx.dirInstCode ?? '';
    if (!shots.length) {
      logs.push(
        `Direction set ${traverseCtx.dirSetId} @ ${traverseCtx.occupy}: no directions (${reason})`,
      );
      directionRejectDiagnostics.push({
        setId: traverseCtx.dirSetId,
        occupy: traverseCtx.occupy,
        sourceLine: lineNum,
        recordType: reason === 'DE' ? 'DE' : reason === 'new DB' ? 'DB' : 'UNKNOWN',
        reason: 'no-shots',
        detail: `No valid direction observations kept (${reason})`,
      });
    } else {
      reduceDirectionShots(traverseCtx.dirSetId, traverseCtx.occupy, instCode, shots);
    }
    traverseCtx.occupy = undefined;
    traverseCtx.backsight = undefined;
    traverseCtx.dirSetId = undefined;
    traverseCtx.dirInstCode = undefined;
    traverseCtx.dirRawShots = undefined;
    faceMode = 'unknown';
  };

  for (const raw of lines) {
    lineNum += 1;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const parsedInline = splitInlineCommentAndDescription(trimmed);
    const line = parsedInline.line;
    if (!line || line.startsWith('#')) continue;

    // Inline options
    if (line.startsWith('.') || line.startsWith('/')) {
      const parts = splitWhitespaceTokens(line);
      const rawOp = parts[0].toUpperCase();
      const op = rawOp.startsWith('/') ? `.${rawOp.slice(1)}` : rawOp;
      if (op === '.UNITS' && parts[1]) {
        let linearChanged = false;
        let angleChanged = false;
        parts.slice(1).forEach((rawToken) => {
          const token = rawToken.toUpperCase();
          if (
            token === 'US' ||
            token === 'FT' ||
            token === 'FEET' ||
            token === 'FOOT' ||
            token === 'FOOTS'
          ) {
            state.units = 'ft';
            linearChanged = true;
            return;
          }
          if (
            token === 'M' ||
            token === 'METER' ||
            token === 'METERS' ||
            token === 'METRE' ||
            token === 'METRES'
          ) {
            state.units = 'm';
            linearChanged = true;
            return;
          }
          if (token === 'DMS') {
            state.angleUnits = 'dms';
            angleChanged = true;
            return;
          }
          if (token === 'DD' || token === 'DEG' || token === 'DEGREES') {
            state.angleUnits = 'dd';
            angleChanged = true;
          }
        });
        if (linearChanged) logs.push(`Units set to ${state.units}`);
        if (angleChanged) logs.push(`Angle units set to ${state.angleUnits?.toUpperCase()}`);
      } else if (op === '.SCALE') {
        const factorToken = parts[1];
        if (!factorToken) {
          state.averageScaleFactor = defaultParseOptions.averageScaleFactor;
          logs.push(`Average scale factor reset to ${state.averageScaleFactor?.toFixed(8)}`);
        } else {
          const factor = Number.parseFloat(factorToken);
          if (Number.isFinite(factor) && factor > 0) {
            state.averageScaleFactor = factor;
            logs.push(`Average scale factor set to ${factor.toFixed(8)}`);
          } else {
            logs.push(
              `Warning: invalid .SCALE factor at line ${lineNum}; expected positive number.`,
            );
          }
        }
      } else if (op === '.MEASURED') {
        logs.push(applyGridObservationDirective(state, 'measured', parts));
      } else if (op === '.GRID') {
        logs.push(applyGridObservationDirective(state, 'grid', parts));
      } else if (op === '.COORD' && parts[1]) {
        state.coordMode = parts[1].toUpperCase() === '2D' ? '2D' : '3D';
        logs.push(`Coord mode set to ${state.coordMode}`);
      } else if (op === '.ORDER' && parts[1]) {
        let coordOrderSet = false;
        let stationOrderSet = false;
        parts.slice(1).forEach((rawToken) => {
          const token = rawToken.toUpperCase();
          if (token === 'NE' || token === 'EN') {
            state.order = token as 'NE' | 'EN';
            coordOrderSet = true;
            return;
          }
          if (token === 'ATFROMTO' || token === 'AT-FROM-TO') {
            state.angleStationOrder = 'atfromto';
            stationOrderSet = true;
            return;
          }
          if (token === 'FROMATTO' || token === 'FROM-AT-TO') {
            state.angleStationOrder = 'fromatto';
            stationOrderSet = true;
          }
        });
        if (coordOrderSet) orderExplicit = true;
        if (coordOrderSet || stationOrderSet) {
          logs.push(
            `Order set to ${state.order}; angle station order ${state.angleStationOrder?.toUpperCase()}`,
          );
        }
      } else if (op === '.2D') {
        state.coordMode = '2D';
        logs.push('Coord mode forced to 2D');
      } else if (op === '.3D') {
        state.coordMode = '3D';
        logs.push('Coord mode forced to 3D');
      } else if (op === '.DELTA' && parts[1]) {
        state.deltaMode = parts[1].toUpperCase() === 'ON' ? 'horiz' : 'slope';
        logs.push(`Delta mode set to ${state.deltaMode}`);
      } else if (op === '.MAPMODE') {
        const mode = (parts[1] || '').toUpperCase();
        const mapMode: MapMode =
          mode === 'ANGLECALC' ? 'anglecalc' : mode === 'ON' || mode === 'GRID' ? 'on' : 'off';
        state.mapMode = mapMode;
        logs.push(`Map mode set to ${mapMode}`);
      } else if (op === '.MAPSCALE' && parts[1]) {
        const factor = parseFloat(parts[1]);
        if (Number.isFinite(factor) && factor > 0) {
          state.mapScaleFactor = factor;
          logs.push(`Map scale factor set to ${factor}`);
        }
      } else if (op === '.CRS') {
        const modeToken = (parts[1] || '').toUpperCase();
        if (!modeToken) {
          logs.push(
            `Warning: .CRS missing mode at line ${lineNum}; expected OFF, ON [model], LOCAL/GRID, SCALE, CONVERGENCE, LABEL, ID, or model token.`,
          );
          continue;
        }

        if (modeToken === 'OFF' || modeToken === 'NONE') {
          state.crsTransformEnabled = false;
          logs.push('CRS transforms set to OFF (legacy projection behavior retained).');
          continue;
        }

        if (modeToken === 'LABEL') {
          const label = parts.slice(2).join(' ').trim();
          state.crsLabel = label;
          logs.push(`CRS label set to "${label || 'unnamed'}"`);
          continue;
        }

        if (modeToken === 'LOCAL') {
          state.coordSystemMode = 'local';
          logs.push('Coordinate system mode set to LOCAL');
          continue;
        }

        if (modeToken === 'GRID' && parts[2]) {
          const gridArg = parts[2].trim();
          const gridArgUpper = gridArg.toUpperCase();
          const maybeFactor = Number.parseFloat(gridArg);
          if (
            gridArgUpper !== 'ON' &&
            gridArgUpper !== 'OFF' &&
            gridArgUpper !== 'NONE' &&
            (!Number.isFinite(maybeFactor) || maybeFactor <= 0)
          ) {
            state.coordSystemMode = 'grid';
            state.crsId = normalizeCrsId(gridArg) ?? state.crsId;
            logs.push(`Coordinate system mode set to GRID (CRS=${state.crsId})`);
            continue;
          }
        }

        if (modeToken === 'MODE' && parts[2]) {
          const mode = parts[2].trim().toUpperCase();
          if (mode === 'LOCAL') {
            state.coordSystemMode = 'local';
            logs.push('Coordinate system mode set to LOCAL');
          } else if (mode === 'GRID') {
            state.coordSystemMode = 'grid';
            logs.push(`Coordinate system mode set to GRID (CRS=${state.crsId})`);
          } else {
            logs.push(
              `Warning: invalid .CRS MODE value at line ${lineNum}; expected LOCAL or GRID.`,
            );
          }
          continue;
        }

        if (modeToken === 'ID' || modeToken === 'SYSTEM') {
          if (!parts[2]) {
            logs.push(`Warning: .CRS ${modeToken} missing id at line ${lineNum}.`);
            continue;
          }
          state.crsId = normalizeCrsId(parts[2]) ?? state.crsId;
          state.coordSystemMode = 'grid';
          logs.push(`CRS id set to ${state.crsId} (coord system mode=GRID)`);
          continue;
        }

        if (
          modeToken === 'SCALE' ||
          modeToken === 'GSCALE' ||
          modeToken === 'GRID' ||
          modeToken === 'GRIDGROUND' ||
          modeToken === 'GRID-GROUND'
        ) {
          const arg = (parts[2] || '').trim();
          const argUpper = arg.toUpperCase();
          if (!arg || argUpper === 'ON') {
            state.crsGridScaleEnabled = true;
            const factorToken = parts[3];
            if (factorToken) {
              const factor = parseFloat(factorToken);
              if (Number.isFinite(factor) && factor > 0) {
                state.crsGridScaleFactor = factor;
              } else {
                logs.push(
                  `Warning: invalid .CRS SCALE factor at line ${lineNum}; expected positive number.`,
                );
              }
            }
            logs.push(
              `CRS grid-ground scale set to ON (factor=${(state.crsGridScaleFactor ?? 1).toFixed(
                8,
              )})`,
            );
            continue;
          }
          if (argUpper === 'OFF' || argUpper === 'NONE') {
            state.crsGridScaleEnabled = false;
            logs.push('CRS grid-ground scale set to OFF');
            continue;
          }
          const factor = parseFloat(arg);
          if (Number.isFinite(factor) && factor > 0) {
            state.crsGridScaleEnabled = true;
            state.crsGridScaleFactor = factor;
            logs.push(`CRS grid-ground scale set to ON (factor=${factor.toFixed(8)})`);
          } else {
            logs.push(
              `Warning: invalid .CRS SCALE option at line ${lineNum}; expected OFF, ON [factor], or positive factor.`,
            );
          }
          continue;
        }

        if (
          modeToken === 'CONVERGENCE' ||
          modeToken === 'CONV' ||
          modeToken === 'GAMMA' ||
          modeToken === 'MERIDIAN'
        ) {
          const arg = (parts[2] || '').trim();
          const argUpper = arg.toUpperCase();
          if (!arg || argUpper === 'ON') {
            state.crsConvergenceEnabled = true;
            const angleToken = parts[3];
            if (angleToken) {
              const parsedAngle = parseAngleTokenRad(angleToken, state, 'dd');
              if (Number.isFinite(parsedAngle)) {
                state.crsConvergenceAngleRad = parsedAngle;
              } else {
                logs.push(
                  `Warning: invalid .CRS CONVERGENCE angle at line ${lineNum}; expected DD or DMS token.`,
                );
              }
            }
            logs.push(
              `CRS convergence set to ON (angle=${((state.crsConvergenceAngleRad ?? 0) * RAD_TO_DEG).toFixed(6)} deg)`,
            );
            continue;
          }
          if (argUpper === 'OFF' || argUpper === 'NONE') {
            state.crsConvergenceEnabled = false;
            logs.push('CRS convergence set to OFF');
            continue;
          }
          const parsedAngle = parseAngleTokenRad(arg, state, 'dd');
          if (Number.isFinite(parsedAngle)) {
            state.crsConvergenceEnabled = true;
            state.crsConvergenceAngleRad = parsedAngle;
            logs.push(
              `CRS convergence set to ON (angle=${(parsedAngle * RAD_TO_DEG).toFixed(6)} deg)`,
            );
          } else {
            logs.push(
              `Warning: invalid .CRS CONVERGENCE option at line ${lineNum}; expected OFF, ON [angle], or DD/DMS angle token.`,
            );
          }
          continue;
        }

        if (modeToken === 'ON') {
          state.crsTransformEnabled = true;
          const model = parseCrsProjectionModelToken(parts[2]);
          if (model) {
            state.crsProjectionModel = model;
          }
          const labelStart = model ? 3 : 2;
          const label = parts.slice(labelStart).join(' ').trim();
          if (label) state.crsLabel = label;
          logs.push(
            `CRS transforms set to ON (model=${state.crsProjectionModel}, label="${state.crsLabel || 'unnamed'}")`,
          );
          continue;
        }

        const directModel = parseCrsProjectionModelToken(parts[1]);
        if (directModel) {
          state.crsTransformEnabled = true;
          state.crsProjectionModel = directModel;
          const label = parts.slice(2).join(' ').trim();
          if (label) state.crsLabel = label;
          logs.push(
            `CRS transforms set to ON (model=${state.crsProjectionModel}, label="${state.crsLabel || 'unnamed'}")`,
          );
          continue;
        }

        logs.push(
          `Warning: unrecognized .CRS option at line ${lineNum}; expected OFF, ON [LEGACY|ENU], LOCAL/GRID, SCALE, CONVERGENCE, LABEL, ID, or model token.`,
        );
      } else if (op === '.GEOID') {
        const modeToken = (parts[1] || '').toUpperCase();
        if (!modeToken) {
          logs.push(
            `Warning: .GEOID missing mode at line ${lineNum}; expected OFF, ON [model], MODEL, INTERP, or HEIGHT.`,
          );
          continue;
        }
        if (modeToken === 'OFF' || modeToken === 'NONE') {
          state.geoidModelEnabled = false;
          logs.push('Geoid/grid model set to OFF');
          continue;
        }
        if (modeToken === 'ON') {
          state.geoidModelEnabled = true;
          if (parts[2]) {
            state.geoidModelId = normalizeGeoidModelId(parts[2]);
          } else {
            state.geoidModelId = normalizeGeoidModelId(state.geoidModelId);
          }
          logs.push(`Geoid/grid model set to ON (model=${state.geoidModelId})`);
          continue;
        }
        if (modeToken === 'MODEL') {
          if (!parts[2]) {
            logs.push(
              `Warning: .GEOID MODEL missing id at line ${lineNum}; keeping current model.`,
            );
            continue;
          }
          state.geoidModelId = normalizeGeoidModelId(parts[2]);
          state.geoidModelEnabled = true;
          logs.push(`Geoid/grid model set to ON (model=${state.geoidModelId})`);
          continue;
        }
        if (modeToken === 'INTERP' || modeToken === 'INTERPOLATION' || modeToken === 'METHOD') {
          const method = parseGeoidInterpolationToken(parts[2]);
          if (!method) {
            logs.push(
              `Warning: invalid .GEOID INTERP option at line ${lineNum}; expected BILINEAR or NEAREST.`,
            );
            continue;
          }
          state.geoidInterpolation = method;
          logs.push(`Geoid interpolation set to ${method.toUpperCase()}`);
          continue;
        }
        if (modeToken === 'HEIGHT' || modeToken === 'DATUM') {
          const argToken = (parts[2] || '').toUpperCase();
          if (!argToken) {
            logs.push(
              `Warning: .GEOID HEIGHT missing option at line ${lineNum}; expected OFF, ON [ORTHOMETRIC|ELLIPSOID], or datum token.`,
            );
            continue;
          }
          if (argToken === 'OFF' || argToken === 'NONE') {
            state.geoidHeightConversionEnabled = false;
            logs.push('Geoid height conversion set to OFF');
            continue;
          }
          if (argToken === 'ON') {
            const datum = parseGeoidHeightDatumToken(parts[3]);
            if (parts[3] && !datum) {
              logs.push(
                `Warning: invalid .GEOID HEIGHT datum at line ${lineNum}; expected ORTHOMETRIC or ELLIPSOID.`,
              );
            }
            state.geoidHeightConversionEnabled = true;
            if (datum) state.geoidOutputHeightDatum = datum;
            logs.push(
              `Geoid height conversion set to ON (target=${(state.geoidOutputHeightDatum ?? 'orthometric').toUpperCase()})`,
            );
            continue;
          }
          const directDatum = parseGeoidHeightDatumToken(parts[2]);
          if (!directDatum) {
            logs.push(
              `Warning: invalid .GEOID HEIGHT option at line ${lineNum}; expected OFF, ON [ORTHOMETRIC|ELLIPSOID], or datum token.`,
            );
            continue;
          }
          state.geoidHeightConversionEnabled = true;
          state.geoidOutputHeightDatum = directDatum;
          logs.push(`Geoid height conversion set to ON (target=${directDatum.toUpperCase()})`);
          continue;
        }
        logs.push(
          `Warning: unrecognized .GEOID option at line ${lineNum}; expected OFF, ON [model], MODEL, INTERP, or HEIGHT.`,
        );
      } else if (op === '.GPS') {
        const modeToken = (parts[1] || '').toUpperCase();
        if (modeToken === 'CHECK' || modeToken === 'LOOPCHECK' || modeToken === 'LOOPS') {
          const arg1 = (parts[2] || '').trim().toUpperCase();
          if (!arg1 || arg1 === 'ON' || arg1 === 'TRUE') {
            state.gpsLoopCheckEnabled = true;
            logs.push('GPS loop check set to ON');
          } else if (arg1 === 'OFF' || arg1 === 'FALSE' || arg1 === 'NONE') {
            state.gpsLoopCheckEnabled = false;
            logs.push('GPS loop check set to OFF');
          } else {
            logs.push(`Warning: invalid .GPS CHECK option at line ${lineNum}; expected OFF or ON.`);
          }
          if (parts.length > 3) {
            logs.push(
              `Warning: extra .GPS CHECK tokens ignored at line ${lineNum}; expected OFF or ON only.`,
            );
          }
          continue;
        }
        if (modeToken === 'ADDHIHT' || modeToken === 'ADDHI' || modeToken === 'HIHT') {
          const arg1 = (parts[2] || '').trim();
          const arg1Upper = arg1.toUpperCase();
          const unitLabel = state.units === 'ft' ? 'ft' : 'm';
          const toDisplayUnits = (meters: number) =>
            state.units === 'ft' ? meters * FT_PER_M : meters;
          const formatLinear = (meters: number) =>
            `${toDisplayUnits(meters).toFixed(4)} ${unitLabel}`;

          if (!arg1 || arg1Upper === 'ON') {
            state.gpsAddHiHtEnabled = true;
            if (parts[3]) {
              const parsedHi = parseLinearMetersToken(parts[3], state.units);
              if (parsedHi == null) {
                logs.push(
                  `Warning: invalid .GPS AddHiHt HI value at line ${lineNum}; expected numeric value in current units.`,
                );
              } else {
                state.gpsAddHiHtHiM = parsedHi;
              }
            }
            if (parts[4]) {
              const parsedHt = parseLinearMetersToken(parts[4], state.units);
              if (parsedHt == null) {
                logs.push(
                  `Warning: invalid .GPS AddHiHt HT value at line ${lineNum}; expected numeric value in current units.`,
                );
              } else {
                state.gpsAddHiHtHtM = parsedHt;
              }
            }
            if (parts.length > 5) {
              logs.push(
                `Warning: extra .GPS AddHiHt tokens ignored at line ${lineNum}; expected at most HI and HT values.`,
              );
            }
            logs.push(
              `GPS AddHiHt set to ON (HI=${formatLinear(state.gpsAddHiHtHiM ?? 0)}, HT=${formatLinear(state.gpsAddHiHtHtM ?? 0)})`,
            );
            continue;
          }

          if (arg1Upper === 'OFF' || arg1Upper === 'NONE') {
            state.gpsAddHiHtEnabled = false;
            logs.push('GPS AddHiHt set to OFF');
            continue;
          }

          const parsedHi = parseLinearMetersToken(parts[2], state.units);
          if (parsedHi == null) {
            logs.push(
              `Warning: invalid .GPS AddHiHt option at line ${lineNum}; expected OFF, ON [HI] [HT], or numeric HI [HT].`,
            );
            continue;
          }
          let parsedHt = state.gpsAddHiHtHtM ?? 0;
          if (parts[3]) {
            const htToken = parseLinearMetersToken(parts[3], state.units);
            if (htToken == null) {
              logs.push(
                `Warning: invalid .GPS AddHiHt HT value at line ${lineNum}; expected numeric value in current units.`,
              );
              continue;
            }
            parsedHt = htToken;
          }
          if (parts.length > 4) {
            logs.push(
              `Warning: extra .GPS AddHiHt tokens ignored at line ${lineNum}; expected HI and optional HT only.`,
            );
          }
          state.gpsAddHiHtEnabled = true;
          state.gpsAddHiHtHiM = parsedHi;
          state.gpsAddHiHtHtM = parsedHt;
          logs.push(
            `GPS AddHiHt set to ON (HI=${formatLinear(parsedHi)}, HT=${formatLinear(parsedHt)})`,
          );
          continue;
        }

        const mode = parseGpsVectorModeToken(parts[1]);
        if (!mode) {
          logs.push(
            `Warning: unrecognized .GPS option at line ${lineNum}; expected NETWORK, SIDESHOT, AddHiHt, or CHECK.`,
          );
          continue;
        }
        state.gpsVectorMode = mode;
        logs.push(`GPS vector mode set to ${mode.toUpperCase()}`);
      } else if (op === '.LWEIGHT' && parts[1]) {
        const val = parseFloat(parts[1]);
        if (!Number.isNaN(val)) {
          state.levelWeight = val;
          logs.push(`Level weight set to ${val}`);
        }
      } else if (op === '.LEVELTOL') {
        const args = parts.slice(1);
        const parsePositive = (token?: string): number | undefined => {
          const parsed = parseFloat(token || '');
          if (!Number.isFinite(parsed) || parsed < 0) return undefined;
          return parsed;
        };
        if (args.length === 0) {
          logs.push(
            `Level-loop tolerance unchanged: base=${(state.levelLoopToleranceBaseMm ?? 0).toFixed(3)} mm, k=${(state.levelLoopTolerancePerSqrtKmMm ?? 4).toFixed(3)} mm/sqrt(km)`,
          );
          continue;
        }
        if (
          ['OFF', 'NONE', 'DEFAULT', 'RESET'].includes((args[0] || '').trim().toUpperCase())
        ) {
          state.levelLoopToleranceBaseMm = 0;
          state.levelLoopTolerancePerSqrtKmMm = 4;
          logs.push('Level-loop tolerance reset to default: base=0.000 mm, k=4.000 mm/sqrt(km)');
          continue;
        }

        let baseMm = state.levelLoopToleranceBaseMm ?? 0;
        let kMm = state.levelLoopTolerancePerSqrtKmMm ?? 4;
        let updated = false;

        if (args.length >= 2) {
          const first = parsePositive(args[0]);
          const second = parsePositive(args[1]);
          if (first != null && second != null) {
            baseMm = first;
            kMm = second;
            updated = true;
          }
        }
        for (let i = 0; i < args.length; i += 1) {
          const label = (args[i] || '').trim().toUpperCase();
          if (label === 'BASE' || label === 'B') {
            const val = parsePositive(args[i + 1]);
            if (val == null) {
              logs.push(
                `Warning: .LEVELTOL missing/invalid BASE value at line ${lineNum}; expected non-negative number in mm.`,
              );
              continue;
            }
            baseMm = val;
            updated = true;
            i += 1;
            continue;
          }
          if (label === 'K' || label === 'SQRTKM' || label === 'PERKM') {
            const val = parsePositive(args[i + 1]);
            if (val == null) {
              logs.push(
                `Warning: .LEVELTOL missing/invalid K value at line ${lineNum}; expected non-negative number in mm/sqrt(km).`,
              );
              continue;
            }
            kMm = val;
            updated = true;
            i += 1;
          }
        }
        if (!updated && args.length === 1) {
          const kOnly = parsePositive(args[0]);
          if (kOnly != null) {
            kMm = kOnly;
            updated = true;
          }
        }
        if (!updated) {
          logs.push(
            `Warning: unrecognized .LEVELTOL option at line ${lineNum}; expected ".LEVELTOL <base_mm> <k_mm_sqrt_km>" or labeled BASE/K tokens.`,
          );
          continue;
        }
        state.levelLoopToleranceBaseMm = baseMm;
        state.levelLoopTolerancePerSqrtKmMm = kMm;
        logs.push(
          `Level-loop tolerance set: base=${baseMm.toFixed(3)} mm, k=${kMm.toFixed(3)} mm/sqrt(km)`,
        );
      } else if (op === '.QFIX') {
        const args = parts.slice(1);
        const toMeters = state.units === 'ft' ? 1 / FT_PER_M : 1;
        const unitLabel = state.units === 'ft' ? 'ft' : 'm';
        const formatSigma = (value: number) => value.toExponential(6);
        if (args.length === 0) {
          const linear = state.qFixLinearSigmaM ?? FIXED_SIGMA;
          const angular = state.qFixAngularSigmaSec ?? FIXED_SIGMA;
          const linearDisplay = state.units === 'ft' ? linear * FT_PER_M : linear;
          logs.push(
            `QFIX unchanged: linear=${formatSigma(linearDisplay)} ${unitLabel}, angular=${formatSigma(angular)}"`,
          );
          continue;
        }
        const mode = args[0].toUpperCase();
        if (mode === 'OFF' || mode === 'NONE' || mode === 'DEFAULT' || mode === 'RESET') {
          state.qFixLinearSigmaM = FIXED_SIGMA;
          state.qFixAngularSigmaSec = FIXED_SIGMA;
          const linearDisplay = state.units === 'ft' ? FIXED_SIGMA * FT_PER_M : FIXED_SIGMA;
          logs.push(
            `QFIX reset to defaults: linear=${formatSigma(linearDisplay)} ${unitLabel}, angular=${formatSigma(FIXED_SIGMA)}"`,
          );
          continue;
        }
        const parsePositive = (token?: string): number | undefined => {
          const parsed = parseFloat(token || '');
          if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
          return parsed;
        };

        let linearM = state.qFixLinearSigmaM ?? FIXED_SIGMA;
        let angularSec = state.qFixAngularSigmaSec ?? FIXED_SIGMA;
        let updatedLinear = false;
        let updatedAngular = false;

        if (args.length >= 2) {
          const first = parsePositive(args[0]);
          const second = parsePositive(args[1]);
          if (first != null && second != null) {
            linearM = first * toMeters;
            angularSec = second;
            updatedLinear = true;
            updatedAngular = true;
          }
        }

        for (let i = 0; i < args.length; i += 1) {
          const label = args[i].toUpperCase();
          if (label === 'LINEAR' || label === 'LIN' || label === 'DIST' || label === 'L') {
            const val = parsePositive(args[i + 1]);
            if (val == null) {
              logs.push(
                `Warning: .QFIX missing/invalid linear value at line ${lineNum}; expected positive number.`,
              );
              continue;
            }
            linearM = val * toMeters;
            updatedLinear = true;
            i += 1;
            continue;
          }
          if (label === 'ANGULAR' || label === 'ANG' || label === 'ANGLE' || label === 'A') {
            const val = parsePositive(args[i + 1]);
            if (val == null) {
              logs.push(
                `Warning: .QFIX missing/invalid angular value at line ${lineNum}; expected positive number.`,
              );
              continue;
            }
            angularSec = val;
            updatedAngular = true;
            i += 1;
          }
        }

        if (!updatedLinear && !updatedAngular && args.length === 1) {
          const both = parsePositive(args[0]);
          if (both != null) {
            linearM = both * toMeters;
            angularSec = both;
            updatedLinear = true;
            updatedAngular = true;
          }
        }
        if (!updatedLinear && !updatedAngular) {
          logs.push(
            `Warning: unrecognized .QFIX option at line ${lineNum}; expected ".QFIX <linear> <angular>" or labeled LINEAR/ANGULAR tokens.`,
          );
          continue;
        }
        state.qFixLinearSigmaM = Math.max(1e-12, linearM);
        state.qFixAngularSigmaSec = Math.max(1e-12, angularSec);
        const linearDisplay =
          state.units === 'ft' ? state.qFixLinearSigmaM * FT_PER_M : state.qFixLinearSigmaM;
        logs.push(
          `QFIX set: linear=${formatSigma(linearDisplay)} ${unitLabel}, angular=${formatSigma(
            state.qFixAngularSigmaSec,
          )}"`,
        );
      } else if (op === '.NORMALIZE') {
        const mode = (parts[1] || '').toUpperCase();
        state.normalize = mode !== 'OFF';
        logs.push(`Normalize set to ${state.normalize}`);
      } else if (op === '.LONSIGN') {
        const mode = (parts[1] || '').toUpperCase();
        state.lonSign = mode === 'WESTPOS' || mode === 'POSW' ? 'west-positive' : 'west-negative';
        logs.push(`Longitude sign set to ${state.lonSign}`);
      } else if (op === '.EDM') {
        const mode = (parts[1] || '').toUpperCase();
        state.edmMode = mode === 'PROPAGATED' || mode === 'RSS' ? 'propagated' : 'additive';
        logs.push(`EDM mode set to ${state.edmMode}`);
      } else if (op === '.CENTERING') {
        const mode = (parts[1] || '').toUpperCase();
        state.applyCentering = mode !== 'OFF';
        logs.push(`Centering inflation set to ${state.applyCentering}`);
      } else if (op === '.ADDC') {
        const mode = (parts[1] || '').toUpperCase();
        state.addCenteringToExplicit = mode === 'ON';
        logs.push(`Add centering to explicit std dev set to ${state.addCenteringToExplicit}`);
      } else if (op === '.DEBUG') {
        const mode = (parts[1] || '').toUpperCase();
        state.debug = mode !== 'OFF';
        logs.push(`Debug logging set to ${state.debug}`);
      } else if (op === '.CURVREF') {
        const mode = (parts[1] || '').toUpperCase();
        if (mode === 'ON' || mode === 'OFF') {
          state.applyCurvatureRefraction = mode === 'ON';
          logs.push(`Curvature/refraction set to ${state.applyCurvatureRefraction}`);
        } else if (parts[1] && Number.isFinite(parseFloat(parts[1]))) {
          state.refractionCoefficient = parseFloat(parts[1]);
          state.applyCurvatureRefraction = true;
          logs.push(
            `Curvature/refraction enabled with k=${state.refractionCoefficient.toFixed(3)}`,
          );
        }
      } else if (op === '.REFRACTION' && parts[1]) {
        const k = parseFloat(parts[1]);
        if (Number.isFinite(k)) {
          state.refractionCoefficient = k;
          logs.push(`Refraction coefficient set to ${k}`);
        }
      } else if (op === '.VRED') {
        const mode = (parts[1] || '').toUpperCase();
        state.verticalReduction =
          mode === 'CR' || mode === 'CURVREF' || mode === 'CURVATURE' ? 'curvref' : 'none';
        logs.push(`Vertical reduction set to ${state.verticalReduction}`);
      } else if (op === '.AMODE') {
        const mode = (parts[1] || '').toUpperCase();
        let angleMode: AngleMode = 'auto';
        if (mode === 'ANGLE') angleMode = 'angle';
        if (mode === 'DIR' || mode === 'AZ' || mode === 'AZIMUTH') angleMode = 'dir';
        state.angleMode = angleMode;
        logs.push(`A-record mode set to ${angleMode}`);
      } else if (op === '.ROBUST') {
        const mode = (parts[1] || '').toUpperCase();
        const maybeK = parseFloat(parts[2] || parts[1] || '');
        if (!mode || mode === 'OFF' || mode === 'NONE' || mode === '0') {
          state.robustMode = 'none';
          logs.push('Robust mode set to none');
        } else {
          state.robustMode = 'huber';
          if (Number.isFinite(maybeK)) {
            state.robustK = Math.max(0.5, Math.min(10, maybeK));
          }
          logs.push(`Robust mode set to huber (k=${(state.robustK ?? 1.5).toFixed(2)})`);
        }
      } else if (op === '.AUTOADJUST') {
        const directive = parseAutoAdjustDirectiveTokens(parts);
        if (!directive) {
          logs.push(
            `Warning: unrecognized .AUTOADJUST option at line ${lineNum}; expected ON/OFF and optional threshold/cycles/removals`,
          );
        } else {
          if (directive.enabled != null) state.autoAdjustEnabled = directive.enabled;
          if (directive.stdResThreshold != null)
            state.autoAdjustStdResThreshold = directive.stdResThreshold;
          if (directive.maxCycles != null) state.autoAdjustMaxCycles = directive.maxCycles;
          if (directive.maxRemovalsPerCycle != null)
            state.autoAdjustMaxRemovalsPerCycle = directive.maxRemovalsPerCycle;
          logs.push(
            `Auto-adjust set to ${state.autoAdjustEnabled ? 'ON' : 'OFF'} (|t|>=${(
              state.autoAdjustStdResThreshold ?? 4
            ).toFixed(
              2,
            )}, cycles=${state.autoAdjustMaxCycles ?? 3}, maxRemovals=${state.autoAdjustMaxRemovalsPerCycle ?? 1})`,
          );
        }
      } else if (op === '.PRISM') {
        const a1 = (parts[1] || '').toUpperCase();
        const toMeters = state.units === 'ft' ? 1 / FT_PER_M : 1;
        let scope: ParseOptions['prismScope'] = state.prismScope ?? 'global';
        let valueToken = parts[1];

        if (a1 === 'GLOBAL') {
          scope = 'global';
          valueToken = parts[2];
        } else if (a1 === 'SET' || a1 === 'LOCAL') {
          scope = 'set';
          valueToken = parts[2];
        }

        if (a1 === 'OFF' || a1 === 'NONE' || a1 === '0') {
          state.prismEnabled = false;
          state.prismOffset = 0;
          state.prismScope = scope;
          logs.push(`Prism correction set to OFF (scope=${scope})`);
          continue;
        }

        if (a1 === 'ON') {
          valueToken = parts[2];
          if (!valueToken) {
            state.prismEnabled = true;
            state.prismScope = scope;
            logs.push(
              `Prism correction set to ON (offset=${(state.prismOffset ?? 0).toFixed(4)} m, scope=${scope})`,
            );
            continue;
          }
        }

        const rawOffset = parseFloat(valueToken || '');
        if (!Number.isFinite(rawOffset)) {
          logs.push(
            `Warning: unrecognized .PRISM option at line ${lineNum}; expected ON/OFF or numeric offset value.`,
          );
          continue;
        }

        const offsetM = rawOffset * toMeters;
        state.prismEnabled = true;
        state.prismOffset = offsetM;
        state.prismScope = scope;
        logs.push(`Prism correction set to ON (offset=${offsetM.toFixed(4)} m, scope=${scope})`);
        if (Math.abs(offsetM) > 2) {
          logs.push(`Warning: large prism offset at line ${lineNum} (${offsetM.toFixed(4)} m)`);
        }
      } else if (op === '.ROTATION') {
        const token = parts[1];
        if (!token) {
          logs.push(
            `Warning: .ROTATION missing angle at line ${lineNum}; expected .ROTATION <angle>.`,
          );
          continue;
        }
        const delta = parseAngleTokenRad(token, state, 'dd');
        if (!Number.isFinite(delta)) {
          logs.push(
            `Warning: invalid .ROTATION angle at line ${lineNum}; expected DD or DMS token.`,
          );
          continue;
        }
        const prior = state.rotationAngleRad ?? 0;
        const next = wrapTo2Pi(prior + delta);
        state.rotationAngleRad = next;
        logs.push(
          `Plan rotation updated at line ${lineNum}: +${(delta * RAD_TO_DEG).toFixed(6)}° => ${(next * RAD_TO_DEG).toFixed(6)}°`,
        );
      } else if (op === '.LOSTSTATIONS') {
        const tokens = splitCommaTokens(parts.slice(1), true);
        if (tokens.length === 0) {
          logs.push(
            `Warning: .LOSTSTATIONS missing station IDs at line ${lineNum}; expected .LOSTSTATIONS <id...> or .LOSTSTATIONS CLEAR.`,
          );
          continue;
        }
        const clearMode = ['OFF', 'NONE', 'CLEAR', 'RESET'].includes(tokens[0].toUpperCase());
        if (clearMode) {
          lostStationIds.clear();
          Object.values(stations).forEach((st) => {
            if (st.lost) delete st.lost;
          });
          logs.push(`Lost stations cleared at line ${lineNum}.`);
          continue;
        }
        let added = 0;
        let removed = 0;
        tokens.forEach((rawToken) => {
          const removing = rawToken.startsWith('-');
          const token = removing ? rawToken.slice(1).trim() : rawToken.replace(/^\+/, '').trim();
          if (!token) return;
          if (removing) {
            if (lostStationIds.delete(token)) removed += 1;
            const station = stations[token];
            if (station?.lost) delete station.lost;
            return;
          }
          if (!lostStationIds.has(token)) added += 1;
          lostStationIds.add(token);
          const station = stations[token];
          if (station) station.lost = true;
        });
        logs.push(
          `Lost stations updated at line ${lineNum}: total=${lostStationIds.size}, added=${added}, removed=${removed}.`,
        );
      } else if (op === '.AUTOSIDESHOT') {
        const mode = (parts[1] || '').toUpperCase();
        if (mode === 'ON' || mode === 'TRUE' || mode === '1') {
          state.autoSideshotEnabled = true;
          logs.push('Auto-sideshot detection set to ON');
        } else if (mode === 'OFF' || mode === 'FALSE' || mode === '0') {
          state.autoSideshotEnabled = false;
          logs.push('Auto-sideshot detection set to OFF');
        } else {
          logs.push(
            `Warning: unrecognized .AUTOSIDESHOT option at line ${lineNum}; expected ON/OFF`,
          );
        }
      } else if (op === '.DESC' || op === '.DESCRIPTION') {
        const mode = (parts[1] || '').toUpperCase();
        if (mode === 'FIRST' || mode === 'DEFAULT') {
          state.descriptionReconcileMode = 'first';
          state.descriptionAppendDelimiter = ' | ';
          logs.push('Description reconciliation set to FIRST');
        } else if (mode === 'APPEND' || mode === 'MERGE') {
          state.descriptionReconcileMode = 'append';
          const delimiter = parts.slice(2).join(' ').trim();
          if (delimiter) {
            state.descriptionAppendDelimiter = delimiter;
          }
          logs.push(
            `Description reconciliation set to APPEND (delimiter="${state.descriptionAppendDelimiter ?? ' | '}")`,
          );
        } else if (mode === 'RESET') {
          state.descriptionReconcileMode = defaultParseOptions.descriptionReconcileMode;
          state.descriptionAppendDelimiter = defaultParseOptions.descriptionAppendDelimiter;
          logs.push('Description reconciliation reset to defaults (FIRST)');
        } else {
          logs.push(
            `Warning: unrecognized .DESC option at line ${lineNum}; expected FIRST or APPEND [delimiter]`,
          );
        }
      } else if (op === '.TSCORR') {
        const parseScope = (token?: string): ParseOptions['tsCorrelationScope'] | undefined => {
          const mode = (token || '').toUpperCase();
          if (mode === 'SETUP') return 'setup';
          if (mode === 'SET') return 'set';
          return undefined;
        };
        const parseRho = (token?: string): number | undefined => {
          const val = parseFloat(token || '');
          if (!Number.isFinite(val)) return undefined;
          return Math.min(0.95, Math.max(0, val));
        };
        const t1 = (parts[1] || '').toUpperCase();
        const t2 = (parts[2] || '').toUpperCase();
        let enabled = state.tsCorrelationEnabled ?? false;
        let rho = state.tsCorrelationRho ?? 0.25;
        let scope: ParseOptions['tsCorrelationScope'] = state.tsCorrelationScope ?? 'set';

        if (!t1 || t1 === 'ON' || t1 === 'TRUE') {
          enabled = true;
          const maybeScope = parseScope(t2);
          const maybeRho = parseRho(parts[2]);
          if (maybeScope) scope = maybeScope;
          else if (maybeRho != null) rho = maybeRho;
        } else if (t1 === 'OFF' || t1 === 'FALSE' || t1 === '0') {
          enabled = false;
        } else {
          const scope1 = parseScope(t1);
          const rho1 = parseRho(parts[1]);
          if (scope1) {
            enabled = true;
            scope = scope1;
            const rho2 = parseRho(parts[2]);
            if (rho2 != null) rho = rho2;
          } else if (rho1 != null) {
            enabled = true;
            rho = rho1;
            const scope2 = parseScope(t2);
            if (scope2) scope = scope2;
          } else {
            logs.push(
              `Warning: unrecognized .TSCORR option at line ${lineNum}; expected ON/OFF/SET/SETUP/rho`,
            );
          }
        }

        state.tsCorrelationEnabled = enabled;
        state.tsCorrelationRho = rho;
        state.tsCorrelationScope = scope;
        logs.push(
          `TS correlation set to ${enabled ? 'ON' : 'OFF'} (scope=${scope}, rho=${rho.toFixed(3)})`,
        );
      } else if (op === '.ALIAS') {
        const aliasArgs = parts.slice(1);
        if (!aliasArgs.length) {
          logs.push(`Warning: .ALIAS missing arguments at line ${lineNum}`);
          continue;
        }
        const mode = aliasArgs[0].toUpperCase();
        if (mode === 'CLEAR' || mode === 'RESET' || mode === 'OFF') {
          explicitAliases.clear();
          aliasRules.length = 0;
          logs.push('.ALIAS map cleared');
        } else if (mode === 'PREFIX' || mode === 'PRE') {
          const from = aliasArgs[1] ?? '';
          const to = aliasArgs[2] ?? '';
          if (!from || !to) {
            logs.push(
              `Warning: invalid .ALIAS PREFIX at line ${lineNum}; expected ".ALIAS PREFIX from to"`,
            );
          } else {
            aliasRules.push({ kind: 'prefix', from, to, sourceLine: lineNum });
            logs.push(`Alias prefix rule added: ${from} -> ${to}`);
          }
        } else if (mode === 'SUFFIX' || mode === 'SUF') {
          const from = aliasArgs[1] ?? '';
          const to = aliasArgs[2] ?? '';
          if (!from || !to) {
            logs.push(
              `Warning: invalid .ALIAS SUFFIX at line ${lineNum}; expected ".ALIAS SUFFIX from to"`,
            );
          } else {
            aliasRules.push({ kind: 'suffix', from, to, sourceLine: lineNum });
            logs.push(`Alias suffix rule added: ${from} -> ${to}`);
          }
        } else if (mode === 'ADDITIVE' || mode === 'ADD') {
          const offset = parseInt(aliasArgs[1] ?? '', 10);
          if (!Number.isFinite(offset)) {
            logs.push(
              `Warning: invalid .ALIAS ADDITIVE at line ${lineNum}; expected integer offset value.`,
            );
          } else {
            aliasRules.push({ kind: 'additive', offset, sourceLine: lineNum });
            logs.push(`Alias additive rule added: +${offset}`);
          }
        } else {
          const added = parseAliasPairs(aliasArgs);
          if (added > 0) {
            logs.push(`Alias explicit mappings added: ${added}`);
          } else {
            logs.push(`Warning: unrecognized .ALIAS syntax at line ${lineNum}`);
          }
        }
      } else if (op === '.I' && parts[1]) {
        state.currentInstrument = parts[1];
        logs.push(`Current instrument set to ${state.currentInstrument}`);
      } else if (op === '.TS' && parts[1]) {
        state.currentInstrument = parts[1];
        logs.push(`Current instrument set to ${state.currentInstrument}`);
      } else if (op === '.END') {
        if (traverseCtx.dirSetId) flushDirectionSet('.END');
        logs.push('END encountered; stopping parse');
        break;
      }
      continue;
    }

    const parts = splitWhitespaceTokens(line);
    const code = parts[0]?.toUpperCase();
    if (code !== 'G' && code !== 'G4') {
      lastGpsObservation = undefined;
    }
    if (code && DESCRIPTION_RECORD_TYPES.has(code)) {
      const stationId = (parts[1] ?? '').trim();
      const description = parsedInline.description;
      if (stationId && description) {
        descriptionTraceEntries.push({
          stationId,
          sourceLine: lineNum,
          recordType: code as 'C' | 'P' | 'PH' | 'CH' | 'EH' | 'E',
          description,
        });
      }
    }

    try {
      if (code === 'I') {
        const instCode = parts[1];
        if (state.preferExternalInstruments && instCode && existingInstruments[instCode]) {
          continue;
        }
        const desc = parts[2]?.replace(/-/g, ' ') ?? '';
        const numeric = parts
          .slice(3)
          .map((p) => parseFloat(p))
          .filter((v) => !Number.isNaN(v));
        const legacy = numeric.length > 0 && numeric.length < 6;
        const edmConst = legacy ? (numeric[1] ?? 0) : (numeric[0] ?? 0);
        const edmPpm = legacy ? (numeric[0] ?? 0) : (numeric[1] ?? 0);
        const hzPrec = legacy ? (numeric[2] ?? 0) : (numeric[2] ?? 0);
        const vaPrec = legacy ? (numeric[2] ?? 0) : (numeric[3] ?? 0);
        const instCentr = legacy ? 0 : (numeric[4] ?? 0);
        const tgtCentr = legacy ? 0 : (numeric[5] ?? 0);
        const gpsStd = legacy ? (numeric[3] ?? 0) : (numeric[6] ?? 0);
        const levStd = legacy ? (numeric[4] ?? 0) : (numeric[7] ?? 0);
        const dirPrec = numeric[8] ?? hzPrec;
        const azPrec = numeric[9] ?? dirPrec;
        const vertCentr = numeric[10] ?? 0;
        const elevDiffConst = numeric[11] ?? 0;
        const elevDiffPpm = numeric[12] ?? 0;
        const inst: Instrument = {
          code: instCode,
          desc,
          edm_const: edmConst,
          edm_ppm: edmPpm,
          hzPrecision_sec: hzPrec,
          dirPrecision_sec: dirPrec,
          azBearingPrecision_sec: azPrec,
          vaPrecision_sec: vaPrec,
          instCentr_m: instCentr,
          tgtCentr_m: tgtCentr,
          vertCentr_m: vertCentr,
          elevDiff_const_m: elevDiffConst,
          elevDiff_ppm: elevDiffPpm,
          gpsStd_xy: gpsStd,
          levStd_mmPerKm: levStd,
        };
        instrumentLibrary[instCode] = inst;
      } else if (code === 'C') {
        const id = parts[1];
        const tokens = parts.slice(2);
        const numeric = tokens.filter(isNumericToken).map((p) => parseFloat(p));
        const is3D = state.coordMode === '3D';
        const coordCount = is3D ? 3 : 2;
        const coords = numeric.slice(0, coordCount);
        const stds = numeric.slice(coordCount);
        const north = state.order === 'NE' ? (coords[0] ?? 0) : (coords[1] ?? 0);
        const east = state.order === 'NE' ? (coords[1] ?? 0) : (coords[0] ?? 0);
        const h = is3D ? (coords[2] ?? 0) : 0;
        const { fixities, legacyStarFixed } = parseFixityTokens(tokens, coordCount);
        if (legacyStarFixed) {
          logs.push(
            `Warning: legacy lone "*" fixity at line ${lineNum} treated as fixed. Prefer "!" for fixed components.`,
          );
        }
        const fixN = state.order === 'NE' ? fixities[0] : fixities[1];
        const fixE = state.order === 'NE' ? fixities[1] : fixities[0];
        const fixH = is3D ? fixities[2] : false;
        const toMeters = state.units === 'ft' ? 1 / FT_PER_M : 1;
        const st =
          stations[id] ??
          ({ x: 0, y: 0, h: 0, fixed: false, fixedX: false, fixedY: false, fixedH: false } as any);
        st.x = east * toMeters;
        st.y = north * toMeters;
        if (is3D) st.h = h * toMeters;

        applyFixities(st, { x: fixE, y: fixN, h: is3D ? fixH : undefined }, state.coordMode);

        const seN = state.order === 'NE' ? stds[0] : stds[1];
        const seE = state.order === 'NE' ? stds[1] : stds[0];
        const seH = is3D ? stds[2] : undefined;
        const corrXY = parseConstraintCorrToken(stds[is3D ? 3 : 2]);
        if (!st.fixedX && seE) {
          st.sx = seE * toMeters;
          st.constraintX = st.x;
        }
        if (!st.fixedY && seN) {
          st.sy = seN * toMeters;
          st.constraintY = st.y;
        }
        if (!st.fixedX && !st.fixedY && st.sx != null && st.sy != null && corrXY != null) {
          st.constraintCorrXY = corrXY;
        }
        if (is3D && !st.fixedH && seH) {
          st.sh = seH * toMeters;
          st.constraintH = st.h;
        }

        stations[id] = st;
      } else if (code === 'P' || code === 'PH') {
        // Geodetic position (lat/long [+H]) projected to local EN using first P as origin (equirectangular)
        const id = parts[1];
        const latDeg = toDegrees(parts[2]);
        let lonDeg = toDegrees(parts[3]);
        if (state.lonSign === 'west-positive') {
          lonDeg = -lonDeg;
        }
        const tokens = parts.slice(2);
        const restNumeric = parts
          .slice(4)
          .filter(isNumericToken)
          .map((p) => parseFloat(p));
        const coordCount = state.coordMode === '3D' ? 3 : 2;
        const elev = state.coordMode === '3D' ? (restNumeric[0] ?? 0) : 0;
        const seN = state.coordMode === '3D' ? (restNumeric[1] ?? 0) : (restNumeric[0] ?? 0);
        const seE = state.coordMode === '3D' ? (restNumeric[2] ?? 0) : (restNumeric[1] ?? 0);
        const seH = state.coordMode === '3D' ? (restNumeric[3] ?? 0) : 0;
        const corrXY = parseConstraintCorrToken(restNumeric[state.coordMode === '3D' ? 4 : 2]);
        const { fixities, legacyStarFixed } = parseFixityTokens(tokens, coordCount);
        if (legacyStarFixed) {
          logs.push(
            `Warning: legacy lone "*" fixity at line ${lineNum} treated as fixed. Prefer "!" for fixed components.`,
          );
        }

        if (state.originLatDeg == null || state.originLonDeg == null) {
          state.originLatDeg = latDeg;
          state.originLonDeg = lonDeg;
          logs.push(`P origin set to ${latDeg.toFixed(6)}, ${lonDeg.toFixed(6)}`);
        }
        const projectionModel = activeCrsProjectionModel(state);
        const { east, north, model } = projectGeodeticToEN({
          latDeg,
          lonDeg,
          originLatDeg: state.originLatDeg ?? latDeg,
          originLonDeg: state.originLonDeg ?? lonDeg,
          model: projectionModel,
          coordSystemMode: state.coordSystemMode,
          crsId: state.crsId,
        });
        const toMeters = state.units === 'ft' ? 1 / FT_PER_M : 1;
        const st: any =
          stations[id] ??
          ({ x: 0, y: 0, h: 0, fixed: false, fixedX: false, fixedY: false, fixedH: false } as any);
        st.x = east;
        st.y = north;
        st.h = elev * toMeters;
        st.latDeg = latDeg;
        st.lonDeg = lonDeg;
        st.heightType = code === 'PH' ? 'ellipsoid' : 'orthometric';
        applyFixities(
          st,
          {
            x: fixities[1] ?? false,
            y: fixities[0] ?? false,
            h: coordCount === 3 ? fixities[2] : undefined,
          },
          state.coordMode,
        );
        if (!st.fixedY && seN) {
          st.sy = seN * toMeters;
          st.constraintY = st.y;
        }
        if (!st.fixedX && seE) {
          st.sx = seE * toMeters;
          st.constraintX = st.x;
        }
        if (!st.fixedX && !st.fixedY && st.sx != null && st.sy != null && corrXY != null) {
          st.constraintCorrXY = corrXY;
        }
        if (state.coordMode === '3D' && !st.fixedH && seH) {
          st.sh = seH * toMeters;
          st.constraintH = st.h;
        }
        stations[id] = st;
        if (state.coordSystemMode === 'grid') {
          logs.push(
            `P record projected to grid EN (meters) for ${id} using CRS=${state.crsId ?? 'unknown'} (model=${model})`,
          );
        } else if (state.crsTransformEnabled) {
          logs.push(
            `P record projected to local EN (meters) for ${id} using ${model} (CRS="${state.crsLabel || 'unnamed'}")`,
          );
        } else {
          logs.push(`P record projected to local EN (meters) for ${id}`);
        }
      } else if (code === 'CH' || code === 'EH') {
        // Coordinate or elevation with ellipsoid height
        const id = parts[1];
        const tokens = parts.slice(2);
        const numeric = tokens.filter(isNumericToken).map((p) => parseFloat(p));
        const is3D = state.coordMode === '3D';
        const coordCount = is3D ? 3 : 2;
        const coords = numeric.slice(0, coordCount);
        const stds = numeric.slice(coordCount);
        const north = state.order === 'NE' ? (coords[0] ?? 0) : (coords[1] ?? 0);
        const east = state.order === 'NE' ? (coords[1] ?? 0) : (coords[0] ?? 0);
        const h = is3D ? (coords[2] ?? 0) : (coords[0] ?? 0);
        const { fixities, legacyStarFixed } = parseFixityTokens(tokens, coordCount);
        if (legacyStarFixed) {
          logs.push(
            `Warning: legacy lone "*" fixity at line ${lineNum} treated as fixed. Prefer "!" for fixed components.`,
          );
        }
        const toMeters = state.units === 'ft' ? 1 / FT_PER_M : 1;
        const st: any =
          stations[id] ??
          ({ x: 0, y: 0, h: 0, fixed: false, fixedX: false, fixedY: false, fixedH: false } as any);
        st.x = east * toMeters;
        st.y = north * toMeters;
        st.h = h * toMeters;
        st.heightType = 'ellipsoid';

        const fixN = state.order === 'NE' ? fixities[0] : fixities[1];
        const fixE = state.order === 'NE' ? fixities[1] : fixities[0];
        const fixH = is3D ? fixities[2] : false;
        applyFixities(st, { x: fixE, y: fixN, h: is3D ? fixH : undefined }, state.coordMode);

        const seN = state.order === 'NE' ? stds[0] : stds[1];
        const seE = state.order === 'NE' ? stds[1] : stds[0];
        const seH = is3D ? stds[2] : undefined;
        const corrXY = parseConstraintCorrToken(stds[is3D ? 3 : 2]);
        if (!st.fixedX && seE) {
          st.sx = seE * toMeters;
          st.constraintX = st.x;
        }
        if (!st.fixedY && seN) {
          st.sy = seN * toMeters;
          st.constraintY = st.y;
        }
        if (!st.fixedX && !st.fixedY && st.sx != null && st.sy != null && corrXY != null) {
          st.constraintCorrXY = corrXY;
        }
        if (is3D && !st.fixedH && seH) {
          st.sh = seH * toMeters;
          st.constraintH = st.h;
        }

        stations[id] = st;
      } else if (code === 'E') {
        // Elevation only: E Station Elev [StdErr] [fixity]
        const id = parts[1];
        const tokens = parts.slice(2);
        const numeric = tokens.filter(isNumericToken).map((p) => parseFloat(p));
        const elev = numeric[0] ?? 0;
        const stdErr = numeric[1] ?? 0;
        const { fixities, legacyStarFixed } = parseFixityTokens(tokens, 1);
        if (legacyStarFixed) {
          logs.push(
            `Warning: legacy lone "*" fixity at line ${lineNum} treated as fixed. Prefer "!" for fixed components.`,
          );
        }
        const fixH = fixities[0] ?? false;
        const toMeters = state.units === 'ft' ? 1 / FT_PER_M : 1;
        const st: any =
          stations[id] ??
          ({ x: 0, y: 0, h: 0, fixed: false, fixedX: false, fixedY: false, fixedH: false } as any);
        st.h = elev * toMeters;
        applyFixities(st, { h: fixH }, state.coordMode);
        if (!st.fixedH && stdErr) {
          st.sh = stdErr * toMeters;
          st.constraintH = st.h;
        }
        stations[id] = st;
      } else if (code === 'D') {
        const hasInst =
          (!!parts[1] && !!instrumentLibrary[parts[1]]) ||
          (parts.length > 5 && /[A-Za-z]/.test(parts[1]) && /[A-Za-z]/.test(parts[2]));
        const explicitInst = hasInst ? parts[1] : '';
        const instCode = explicitInst || state.currentInstrument || '';
        const setId = hasInst ? parts[2] : '';
        const startIdx = hasInst ? 3 : 1;
        const { from, to, nextIndex } = parseFromTo(parts, startIdx);
        const distToken = parts[nextIndex];
        const restTokens = parts.slice(nextIndex + 1);
        const { sigmas, rest } = extractSigmaTokens(restTokens, 1);
        const { hi, ht } = extractHiHt(rest);
        const toMeters = state.units === 'ft' ? 1 / FT_PER_M : 1;
        const distParsed = parseObservedLinearToken(distToken, toMeters);
        if (!distParsed.valid) {
          logs.push(`Invalid distance at line ${lineNum}, skipping D record.`);
          continue;
        }

        const inst = instCode ? instrumentLibrary[instCode] : undefined;
        const defaultSigma = defaultDistanceSigma(
          inst,
          distParsed.planned ? 0 : parseFloat(distToken),
          state.edmMode,
          0,
        );
        const { sigma, source } = resolveLinearSigma(sigmas[0], defaultSigma);

        const obs: DistanceObservation = {
          id: obsId++,
          type: 'dist',
          subtype: 'ts',
          instCode,
          setId,
          from,
          to,
          obs: distParsed.value,
          planned: distParsed.planned,
          stdDev: sigma * toMeters,
          sigmaSource: source,
          hi: hi != null ? hi * toMeters : undefined,
          ht: ht != null ? ht * toMeters : undefined,
          mode: state.deltaMode,
        };
        pushObservation(obs);
      } else if (code === 'A') {
        const tokens = parts[1].includes('-') ? parts[1].split('-') : [];
        const hasInst = tokens.length === 0;
        const explicitInst = hasInst ? parts[1] : '';
        const instCode = explicitInst || state.currentInstrument || '';
        const setId = hasInst ? parts[2] : '';
        const s1 = hasInst ? parts[3] : tokens[0];
        const s2 = hasInst ? parts[4] : tokens[1];
        const s3 = hasInst ? parts[5] : tokens[2];
        const stationOrder = state.angleStationOrder ?? 'atfromto';
        const at = stationOrder === 'atfromto' ? s1 : s2;
        const from = stationOrder === 'atfromto' ? s2 : s1;
        const to = s3;
        const angToken = hasInst ? parts[6] : parts[2];
        const angleParsed = parseObservedAngleToken(angToken, 'dms');
        if (!angleParsed.valid) {
          logs.push(`Invalid angle at line ${lineNum}, skipping A record.`);
          continue;
        }
        const angleRad = angleParsed.value;
        const stdTokenIndex = hasInst ? 7 : 3;
        const { sigmas } = extractSigmaTokens(parts.slice(stdTokenIndex), 1);

        const inst = instCode ? instrumentLibrary[instCode] : undefined;
        const defaultSigma = defaultHorizontalAngleSigmaSec(inst);
        const resolved = resolveAngularSigma(sigmas[0], defaultSigma);
        let sigmaSec = resolved.sigma;
        if (angleRad >= Math.PI) sigmaSec *= FACE2_WEIGHT;

        let useDir = state.angleMode === 'dir';
        if (state.angleMode === 'auto' && !angleParsed.planned) {
          const azTo = azimuthFromTo(stations, at, to);
          const azFrom = azimuthFromTo(stations, at, from);
          if (azTo && azFrom) {
            let predAngle = azTo.az - azFrom.az;
            if (predAngle < 0) predAngle += 2 * Math.PI;
            const rAngle = Math.abs(wrapToPi(angleRad - predAngle));

            const predDir = azTo.az;
            const r0 = wrapToPi(angleRad - predDir);
            const r1 = wrapToPi(angleRad + Math.PI - predDir);
            const rDir = Math.abs(r0) <= Math.abs(r1) ? Math.abs(r0) : Math.abs(r1);

            const clearlyDir =
              rDir <= AMODE_AUTO_MAX_DIR_RAD && rAngle - rDir >= AMODE_AUTO_MARGIN_RAD;
            useDir = clearlyDir;
            if (!useDir && rDir < rAngle && rDir <= AMODE_AUTO_MAX_DIR_RAD) {
              logs.push(
                `A record ambiguous at line ${lineNum}; kept ANGLE (rDir=${(
                  rDir *
                  RAD_TO_DEG *
                  3600
                ).toFixed(1)}", rAng=${(rAngle * RAD_TO_DEG * 3600).toFixed(
                  1,
                )}"). Use ".AMODE DIR" for azimuth mode.`,
              );
            }
          }
        }

        if (useDir) {
          const rotatedDir = applyPlanRotation(angleRad, state);
          const obs: DirObservation = {
            id: obsId++,
            type: 'dir',
            instCode,
            setId,
            from: at,
            to,
            obs: rotatedDir,
            planned: angleParsed.planned,
            stdDev: sigmaSec * SEC_TO_RAD,
            sigmaSource: resolved.source,
            flip180: true,
          };
          pushObservation(obs);
          logs.push(`A record classified as DIR at line ${lineNum} (${at}-${to})`);
        } else {
          const obs: AngleObservation = {
            id: obsId++,
            type: 'angle',
            instCode,
            setId,
            at,
            from,
            to,
            obs: angleRad,
            planned: angleParsed.planned,
            stdDev: sigmaSec * SEC_TO_RAD,
            sigmaSource: resolved.source,
          };
          pushObservation(obs);
        }
      } else if (code === 'V') {
        // Vertical observation: zenith (slope mode) or deltaH (delta mode)
        const { from, to, nextIndex } = parseFromTo(parts, 1);
        const valToken = parts[nextIndex];
        const stdTokens = parts.slice(nextIndex + 1);
        const { sigmas } = extractSigmaTokens(stdTokens, 1);
        const toMeters = state.units === 'ft' ? 1 / FT_PER_M : 1;
        const inst = state.currentInstrument
          ? instrumentLibrary[state.currentInstrument]
          : undefined;
        if (state.deltaMode === 'horiz') {
          const dhParsed = parseObservedLinearToken(valToken, toMeters);
          if (!dhParsed.valid) {
            logs.push(`Invalid vertical difference at line ${lineNum}, skipping V record.`);
            continue;
          }
          const resolved = resolveLinearSigma(sigmas[0], defaultElevDiffSigma(inst, 0));
          const std = resolved.sigma * toMeters;
          const obs: LevelObservation = {
            id: obsId++,
            type: 'lev',
            instCode: state.currentInstrument ?? '',
            from,
            to,
            obs: dhParsed.value,
            planned: dhParsed.planned,
            lenKm: 0,
            stdDev: std,
            sigmaSource: resolved.source,
          };
          pushObservation(obs);
        } else {
          const zenParsed = parseObservedAngleToken(valToken, 'dd');
          if (!zenParsed.valid) {
            logs.push(`Invalid zenith at line ${lineNum}, skipping V record.`);
            continue;
          }
          const base = defaultZenithSigmaSec(inst);
          const resolved = resolveAngularSigma(sigmas[0], base);
          pushObservation({
            id: obsId++,
            type: 'zenith',
            instCode: state.currentInstrument ?? '',
            from,
            to,
            obs: zenParsed.value,
            planned: zenParsed.planned,
            stdDev: resolved.sigma * SEC_TO_RAD,
            sigmaSource: resolved.source,
          });
        }
      } else if (code === 'DV') {
        // Distance + vertical: in delta mode, HD + deltaH; in slope mode slope distance + zenith
        const { from, to, nextIndex } = parseFromTo(parts, 1);
        const toMeters = state.units === 'ft' ? 1 / FT_PER_M : 1;
        const instCode = state.currentInstrument ?? '';
        const inst = instCode ? instrumentLibrary[instCode] : undefined;
        if (state.deltaMode === 'horiz') {
          const distParsed = parseObservedLinearToken(parts[nextIndex], toMeters);
          const dhParsed = parseObservedLinearToken(parts[nextIndex + 1], toMeters);
          if (!distParsed.valid || !dhParsed.valid) {
            logs.push(`Invalid DV horizontal record at line ${lineNum}, skipping.`);
            continue;
          }
          const restTokens = parts.slice(nextIndex + 2);
          const { sigmas, rest } = extractSigmaTokens(restTokens, 2);
          const { hi, ht } = extractHiHt(rest);
          const defaultDist = defaultDistanceSigma(
            inst,
            distParsed.planned ? 0 : parseFloat(parts[nextIndex]),
            state.edmMode,
            0,
          );
          const distResolved = resolveLinearSigma(sigmas[0], defaultDist);
          const dhResolved = resolveLinearSigma(
            sigmas[1],
            defaultElevDiffSigma(inst, Math.abs(distParsed.value)),
          );
          pushObservation({
            id: obsId++,
            type: 'dist',
            subtype: 'ts',
            instCode,
            setId: '',
            from,
            to,
            obs: distParsed.value,
            planned: distParsed.planned,
            stdDev: distResolved.sigma * toMeters,
            sigmaSource: distResolved.source,
            hi: hi != null ? hi * toMeters : undefined,
            ht: ht != null ? ht * toMeters : undefined,
            mode: 'horiz',
          });
          pushObservation({
            id: obsId++,
            type: 'lev',
            instCode,
            from,
            to,
            obs: dhParsed.value,
            planned: dhParsed.planned,
            lenKm: 0,
            stdDev: dhResolved.sigma * toMeters,
            sigmaSource: dhResolved.source,
          });
        } else {
          const distParsed = parseObservedLinearToken(parts[nextIndex], toMeters);
          const zen = parts[nextIndex + 1];
          const zenParsed = parseObservedAngleToken(zen, 'dd');
          if (!distParsed.valid || !zenParsed.valid) {
            logs.push(`Invalid DV slope record at line ${lineNum}, skipping.`);
            continue;
          }
          const restTokens = parts.slice(nextIndex + 2);
          const { sigmas, rest } = extractSigmaTokens(restTokens, 2);
          const { hi, ht } = extractHiHt(rest);
          const defaultDist = defaultDistanceSigma(
            inst,
            distParsed.planned ? 0 : parseFloat(parts[nextIndex]),
            state.edmMode,
            0,
          );
          const distResolved = resolveLinearSigma(sigmas[0], defaultDist);
          const defaultZen = defaultZenithSigmaSec(inst);
          const zenResolved = resolveAngularSigma(sigmas[1], defaultZen);
          pushObservation({
            id: obsId++,
            type: 'dist',
            subtype: 'ts',
            instCode,
            setId: '',
            from,
            to,
            obs: distParsed.value,
            planned: distParsed.planned,
            stdDev: distResolved.sigma * toMeters,
            sigmaSource: distResolved.source,
            hi: hi != null ? hi * toMeters : undefined,
            ht: ht != null ? ht * toMeters : undefined,
            mode: 'slope',
          });
          pushObservation({
            id: obsId++,
            type: 'zenith',
            instCode,
            from,
            to,
            obs: zenParsed.value,
            planned: zenParsed.planned,
            stdDev: zenResolved.sigma * SEC_TO_RAD,
            sigmaSource: zenResolved.source,
            hi: hi != null ? hi * toMeters : undefined,
            ht: ht != null ? ht * toMeters : undefined,
          });
        }
      } else if (code === 'BM') {
        // Bearing + measurements. Bearing stored/logged; dist parsed; zenith or deltaH captured based on mode
        const from = parts[1];
        const to = parts[2];
        const bearing = parts[3];
        const toMeters = state.units === 'ft' ? 1 / FT_PER_M : 1;
        const distParsed = parseObservedLinearToken(parts[4], toMeters);
        const bearingParsed = parseObservedAngleToken(bearing, 'dd');
        const vert = parts[5];
        if (!distParsed.valid || !bearingParsed.valid) {
          logs.push(`Invalid BM record at line ${lineNum}, skipping.`);
          continue;
        }
        const instCode = state.currentInstrument ?? '';
        const inst = instCode ? instrumentLibrary[instCode] : undefined;
        const { sigmas } = extractSigmaTokens(parts.slice(6), 3);
        let sigBear: SigmaToken | undefined;
        let sigDist: SigmaToken | undefined;
        let sigVert: SigmaToken | undefined;
        if (sigmas.length === 1) {
          sigDist = sigmas[0];
        } else {
          sigBear = sigmas[0];
          sigDist = sigmas[1];
          sigVert = sigmas[2];
        }
        const distDefault = defaultDistanceSigma(
          inst,
          distParsed.planned ? 0 : parseFloat(parts[4]),
          state.edmMode,
          0,
        );
        const distResolved = resolveLinearSigma(sigDist, distDefault);
        pushObservation({
          id: obsId++,
          type: 'dist',
          subtype: 'ts',
          instCode,
          setId: '',
          from,
          to,
          obs: distParsed.value,
          planned: distParsed.planned,
          stdDev: distResolved.sigma * toMeters,
          sigmaSource: distResolved.source,
          mode: state.deltaMode,
        });
        if (state.deltaMode === 'horiz' && vert) {
          const dhParsed = parseObservedLinearToken(vert, toMeters);
          if (!dhParsed.valid) {
            logs.push(
              `Invalid BM vertical difference at line ${lineNum}, skipping vertical component.`,
            );
          } else {
            const dhResolved = resolveLinearSigma(
              sigVert,
              defaultElevDiffSigma(inst, Math.abs(distParsed.value)),
            );
            pushObservation({
              id: obsId++,
              type: 'lev',
              instCode,
              from,
              to,
              obs: dhParsed.value,
              planned: dhParsed.planned,
              lenKm: 0,
              stdDev: dhResolved.sigma * toMeters,
              sigmaSource: dhResolved.source,
            });
          }
        } else if (vert) {
          const zenParsed = parseObservedAngleToken(vert, 'dd');
          if (!zenParsed.valid) {
            logs.push(`Invalid BM zenith at line ${lineNum}, skipping vertical component.`);
          } else {
            const baseZen = defaultZenithSigmaSec(inst);
            const zenResolved = resolveAngularSigma(sigVert, baseZen);
            pushObservation({
              id: obsId++,
              type: 'zenith',
              instCode,
              from,
              to,
              obs: zenParsed.value,
              planned: zenParsed.planned,
              stdDev: zenResolved.sigma * SEC_TO_RAD,
              sigmaSource: zenResolved.source,
            });
          }
        }
        const bearingRad = applyPlanRotation(bearingParsed.value, state);
        const bearResolved = resolveAngularSigma(sigBear, defaultAzimuthSigmaSec(inst));
        pushObservation({
          id: obsId++,
          type: 'bearing',
          instCode,
          from,
          to,
          obs: bearingRad,
          planned: bearingParsed.planned,
          stdDev: bearResolved.sigma * SEC_TO_RAD,
          sigmaSource: bearResolved.source,
        });
      } else if (code === 'M') {
        // Measure: angle + dist + vertical
        const stations = parts[1].split('-');
        if (stations.length !== 3) {
          logs.push(`M record malformed at line ${lineNum}`);
        } else {
          const stationOrder = state.angleStationOrder ?? 'atfromto';
          const s1 = stations[0];
          const s2 = stations[1];
          const s3 = stations[2];
          const at = stationOrder === 'atfromto' ? s1 : s2;
          const from = stationOrder === 'atfromto' ? s2 : s1;
          const to = s3;
          const ang = parts[2];
          const toMeters = state.units === 'ft' ? 1 / FT_PER_M : 1;
          const angParsed = parseObservedAngleToken(ang, 'dms');
          const distParsed = parseObservedLinearToken(parts[3], toMeters);
          const vert = parts[4];
          const hasVerticalToken =
            state.coordMode !== '2D'
              ? Boolean(vert)
              : state.deltaMode === 'slope' &&
                Boolean(vert) &&
                (String(vert).includes('-') ||
                  Math.abs((parseObservedAngleToken(String(vert), 'dd').value * 180) / Math.PI) >
                    45);
          const vertParsed =
            hasVerticalToken && vert
              ? state.deltaMode === 'horiz'
                ? parseObservedLinearToken(vert, toMeters)
                : parseObservedAngleToken(vert, 'dd')
              : null;
          if (!angParsed.valid || !distParsed.valid || (vert && vertParsed && !vertParsed.valid)) {
            logs.push(`Invalid M record at line ${lineNum}, skipping.`);
            continue;
          }
          const sigmaStart = hasVerticalToken ? 5 : 4;
          const restTokens = parts.slice(sigmaStart);
          const { sigmas, rest } = extractSigmaTokens(restTokens, hasVerticalToken ? 3 : 2);
          const { hi, ht } = extractHiHt(rest);
          const instCode = state.currentInstrument ?? '';
          const inst = instCode ? instrumentLibrary[instCode] : undefined;
          const angResolved = resolveAngularSigma(sigmas[0], defaultHorizontalAngleSigmaSec(inst));
          const distResolved = resolveLinearSigma(
            sigmas[1],
            defaultDistanceSigma(
              inst,
              distParsed.planned ? 0 : parseFloat(parts[3]),
              state.edmMode,
              0,
            ),
          );
          const defaultVertSigma =
            state.deltaMode === 'horiz'
              ? defaultElevDiffSigma(inst, Math.abs(distParsed.value))
              : defaultZenithSigmaSec(inst);
          const vertResolved =
            state.deltaMode === 'horiz'
              ? resolveLinearSigma(sigmas[2], defaultVertSigma)
              : resolveAngularSigma(sigmas[2], defaultVertSigma);
          const angRad = angParsed.value;
          const faceWeight =
            angRad >= Math.PI ? angResolved.sigma * FACE2_WEIGHT : angResolved.sigma;
          let distObs = distParsed.value;
          let distStdDev = distResolved.sigma * toMeters;
          let distMode: 'slope' | 'horiz' = state.deltaMode;
          if (
            state.coordMode === '2D' &&
            state.deltaMode === 'slope' &&
            vert &&
            vertParsed &&
            vertParsed.valid
          ) {
            const zen = vertParsed.value;
            const sigmaZ = vertResolved.sigma * SEC_TO_RAD;
            distObs = distParsed.value * Math.sin(zen);
            distStdDev = Math.sqrt(
              (Math.sin(zen) * distResolved.sigma * toMeters) ** 2 +
                (distParsed.value * Math.cos(zen) * sigmaZ) ** 2,
            );
            distMode = 'horiz';
          }
          pushObservation({
            id: obsId++,
            type: 'angle',
            instCode,
            setId: '',
            at,
            from,
            to,
            obs: angRad,
            planned: angParsed.planned,
            stdDev: faceWeight * SEC_TO_RAD,
            sigmaSource: angResolved.source,
          });
          pushObservation({
            id: obsId++,
            type: 'dist',
            subtype: 'ts',
            instCode,
            setId: '',
            from: at,
            to,
            obs: distObs,
            planned: distParsed.planned,
            stdDev: distStdDev,
            sigmaSource: distResolved.source,
            hi: hi != null ? hi * toMeters : undefined,
            ht: ht != null ? ht * toMeters : undefined,
            mode: distMode,
          });
          if (state.coordMode === '2D') {
            // In 2D, consume the vertical token only to reduce slope distances to HD.
          } else if (state.deltaMode === 'horiz' && vert) {
            pushObservation({
              id: obsId++,
              type: 'lev',
              instCode,
              from: at,
              to,
              obs: (vertParsed as { value: number }).value,
              planned: Boolean(vertParsed?.planned),
              lenKm: 0,
              stdDev: vertResolved.sigma * toMeters,
              sigmaSource: vertResolved.source,
            });
          } else if (vert) {
            pushObservation({
              id: obsId++,
              type: 'zenith',
              instCode,
              from: at,
              to,
              obs: (vertParsed as { value: number }).value,
              planned: Boolean(vertParsed?.planned),
              stdDev: vertResolved.sigma * SEC_TO_RAD,
              sigmaSource: vertResolved.source,
              hi: hi != null ? hi * toMeters : undefined,
              ht: ht != null ? ht * toMeters : undefined,
            });
          }
        }
      } else if (code === 'B') {
        const { from, to, nextIndex } = parseFromTo(parts, 1);
        const bearingToken = parts[nextIndex];
        const instCode = state.currentInstrument ?? '';
        const inst = instCode ? instrumentLibrary[instCode] : undefined;
        const { sigmas } = extractSigmaTokens(parts.slice(nextIndex + 1), 1);
        const resolved = resolveAngularSigma(sigmas[0], defaultAzimuthSigmaSec(inst));
        const bearingParsed = parseObservedAngleToken(bearingToken, 'dd');
        if (!bearingParsed.valid) {
          logs.push(`Invalid bearing at line ${lineNum}, skipping B record.`);
          continue;
        }
        const bearingRad = applyPlanRotation(bearingParsed.value, state);
        pushObservation({
          id: obsId++,
          type: 'bearing',
          instCode,
          from,
          to,
          obs: bearingRad,
          planned: bearingParsed.planned,
          stdDev: resolved.sigma * SEC_TO_RAD,
          sigmaSource: resolved.source,
        });
      } else if (code === 'TB') {
        // Traverse begin: set occupy + backsight context
        traverseCtx.occupy = parts[1];
        traverseCtx.backsight = parts[2];
        faceMode = 'unknown';
        logs.push(`Traverse start at ${traverseCtx.occupy} backsight ${traverseCtx.backsight}`);
      } else if (code === 'T' || code === 'TE') {
        // Traverse legs: angle + dist + vertical relative to current occupy/backsight
        if (!traverseCtx.occupy || !traverseCtx.backsight) {
          logs.push(`Traverse context missing at line ${lineNum}, skipping ${code}`);
          continue;
        }
        if (
          code !== 'TE' &&
          (traverseCtx.occupy === parts[1] || traverseCtx.backsight === parts[1])
        ) {
          logs.push(`Traverse leg cannot occupy/backsight same as foresight at line ${lineNum}`);
          continue;
        }
        const to = parts[1];
        if (code === 'TE' && parts.length <= 2) {
          logs.push(`Traverse end to ${to}`);
          traverseCtx.occupy = undefined;
          traverseCtx.backsight = undefined;
          faceMode = 'unknown';
          continue;
        }
        const ang = parts[2];
        const toMeters = state.units === 'ft' ? 1 / FT_PER_M : 1;
        const angParsed = parseObservedAngleToken(ang, 'dms');
        const distParsed =
          parts[3] == null
            ? { value: 0, planned: false, valid: true }
            : parseObservedLinearToken(parts[3], toMeters);
        const vert = parts[4];
        const vertParsed =
          vert == null
            ? null
            : state.deltaMode === 'horiz'
              ? parseObservedLinearToken(vert, toMeters)
              : parseObservedAngleToken(vert, 'dd');
        if (!angParsed.valid || !distParsed.valid || (vert && vertParsed && !vertParsed.valid)) {
          logs.push(`Invalid traverse record at line ${lineNum}, skipping ${code}.`);
          continue;
        }
        const { sigmas } = extractSigmaTokens(parts.slice(5), 3);
        const instCode = state.currentInstrument ?? '';
        const inst = instCode ? instrumentLibrary[instCode] : undefined;
        const angResolved = resolveAngularSigma(sigmas[0], defaultHorizontalAngleSigmaSec(inst));
        const distResolved = resolveLinearSigma(
          sigmas[1],
          defaultDistanceSigma(
            inst,
            distParsed.planned ? 0 : parseFloat(parts[3] || '0'),
            state.edmMode,
            0,
          ),
        );
        const defaultVertSigma =
          state.deltaMode === 'horiz'
            ? defaultElevDiffSigma(inst, Math.abs(distParsed.value))
            : defaultZenithSigmaSec(inst);
        const vertResolved =
          state.deltaMode === 'horiz'
            ? resolveLinearSigma(sigmas[2], defaultVertSigma)
            : resolveAngularSigma(sigmas[2], defaultVertSigma);
        const angRad = angParsed.value;
        const isFace2 = angRad >= Math.PI;
        if (state.normalize === false) {
          const thisFace = isFace2 ? 'face2' : 'face1';
          if (faceMode === 'unknown') faceMode = thisFace;
          if (faceMode !== thisFace) {
            logs.push(`Mixed face traverse angle rejected at line ${lineNum}`);
          } else {
            pushObservation({
              id: obsId++,
              type: 'angle',
              instCode,
              setId: code,
              at: traverseCtx.occupy,
              from: traverseCtx.backsight,
              to,
              obs: angRad,
              planned: angParsed.planned,
              stdDev: angResolved.sigma * SEC_TO_RAD,
              sigmaSource: angResolved.source,
            });
          }
        } else {
          const angStd = angResolved.sigma * (isFace2 ? FACE2_WEIGHT : 1);
          pushObservation({
            id: obsId++,
            type: 'angle',
            instCode,
            setId: code,
            at: traverseCtx.occupy,
            from: traverseCtx.backsight,
            to,
            obs: angRad,
            planned: angParsed.planned,
            stdDev: angStd * SEC_TO_RAD,
            sigmaSource: angResolved.source,
          });
        }
        if (distParsed.planned || distParsed.value > 0) {
          pushObservation({
            id: obsId++,
            type: 'dist',
            subtype: 'ts',
            instCode,
            setId: code,
            from: traverseCtx.occupy,
            to,
            obs: distParsed.value,
            planned: distParsed.planned,
            stdDev: distResolved.sigma * toMeters,
            sigmaSource: distResolved.source,
            mode: state.deltaMode,
          });
        }
        if (vert) {
          if (state.deltaMode === 'horiz') {
            pushObservation({
              id: obsId++,
              type: 'lev',
              instCode,
              setId: code,
              from: traverseCtx.occupy,
              to,
              obs: (vertParsed as { value: number }).value,
              planned: Boolean(vertParsed?.planned),
              lenKm: 0,
              stdDev: vertResolved.sigma * toMeters,
              sigmaSource: vertResolved.source,
            });
          } else {
            pushObservation({
              id: obsId++,
              type: 'zenith',
              instCode,
              setId: code,
              from: traverseCtx.occupy,
              to,
              obs: (vertParsed as { value: number }).value,
              planned: Boolean(vertParsed?.planned),
              stdDev: vertResolved.sigma * SEC_TO_RAD,
              sigmaSource: vertResolved.source,
            });
          }
        }
        if (code === 'TE') {
          logs.push(`Traverse end to ${to}`);
          traverseCtx.occupy = undefined;
          traverseCtx.backsight = undefined;
          faceMode = 'unknown';
        } else {
          const prevOccupy = traverseCtx.occupy;
          traverseCtx.occupy = to;
          traverseCtx.backsight = prevOccupy;
        }
      } else if (code === 'DB') {
        if (traverseCtx.dirSetId) {
          flushDirectionSet('new DB');
        }
        const hasInst = parts[1] && instrumentLibrary[parts[1]];
        const instCode = hasInst ? parts[1] : (state.currentInstrument ?? '');
        const occupy = hasInst ? parts[2] : parts[1];
        const backsight = hasInst ? parts[3] : parts[2];

        traverseCtx.occupy = occupy;
        traverseCtx.backsight = backsight;
        traverseCtx.dirInstCode = instCode;
        traverseCtx.dirRawShots = [];
        directionSetCount += 1;
        traverseCtx.dirSetId = `${occupy || 'SET'}#${directionSetCount}`;
        faceMode = 'unknown';

        if (backsight) {
          logs.push(
            `Direction set start at ${traverseCtx.occupy} backsight ${backsight}${instCode ? ` (inst ${instCode})` : ''}`,
          );
        } else {
          logs.push(
            `Direction set start at ${traverseCtx.occupy}${instCode ? ` (inst ${instCode})` : ''}`,
          );
        }
      } else if (code === 'DN' || code === 'DM') {
        if (!traverseCtx.occupy || !traverseCtx.dirSetId) {
          logs.push(`Direction context missing at line ${lineNum}, skipping ${code}`);
          directionRejectDiagnostics.push({
            setId: 'UNKNOWN',
            occupy: 'UNKNOWN',
            sourceLine: lineNum,
            recordType: code,
            reason: 'missing-context',
            detail: `Direction context missing at line ${lineNum}`,
          });
          continue;
        }

        const to = parts[1];
        const ang = parts[2];
        const angParsed = parseObservedAngleToken(ang, 'dms');
        if (!angParsed.valid) {
          logs.push(`Invalid direction angle at line ${lineNum}, skipping ${code}.`);
          continue;
        }
        const angRad = angParsed.value;

        const toMeters = state.units === 'ft' ? 1 / FT_PER_M : 1;
        const distParsed = code === 'DM' ? parseObservedLinearToken(parts[3], toMeters) : null;
        const vert = code === 'DM' ? parts[4] : undefined;
        const vertParsed =
          code === 'DM' && vert
            ? state.deltaMode === 'horiz'
              ? parseObservedLinearToken(vert, toMeters)
              : parseObservedAngleToken(vert, 'dd')
            : null;
        if ((distParsed && !distParsed.valid) || (vert && vertParsed && !vertParsed.valid)) {
          logs.push(`Invalid direction-measure record at line ${lineNum}, skipping ${code}.`);
          continue;
        }
        const sigmaStart = code === 'DM' ? 5 : 3;
        const sigmaCount = code === 'DM' ? 3 : 1;
        const { sigmas } = extractSigmaTokens(parts.slice(sigmaStart), sigmaCount);

        const inst = traverseCtx.dirInstCode
          ? instrumentLibrary[traverseCtx.dirInstCode]
          : undefined;
        const dirResolved = resolveAngularSigma(sigmas[0], defaultDirectionSigmaSec(inst));
        const stdAng = dirResolved.sigma;

        if (state.normalize === false) {
          const thisFace = angRad >= Math.PI ? 'face2' : 'face1';
          if (faceMode === 'unknown') faceMode = thisFace;
          if (faceMode !== thisFace) {
            logs.push(`Mixed face direction rejected at line ${lineNum}`);
            directionRejectDiagnostics.push({
              setId: traverseCtx.dirSetId,
              occupy: traverseCtx.occupy,
              target: to,
              sourceLine: lineNum,
              recordType: code,
              reason: 'mixed-face',
              expectedFace: faceMode,
              actualFace: thisFace,
              detail: `Mixed face direction rejected at line ${lineNum}`,
            });
            continue;
          }
        }

        const thisFace: DirectionFace = angRad >= Math.PI ? 'face2' : 'face1';
        const raw: RawDirectionShot = {
          to,
          obs: angRad,
          stdDev: stdAng * SEC_TO_RAD,
          sigmaSource: dirResolved.source,
          sourceLine: lineNum,
          face: thisFace,
        };
        const existing = traverseCtx.dirRawShots ?? [];
        existing.push(raw);
        traverseCtx.dirRawShots = existing;

        if (code === 'DM' && distParsed && (distParsed.planned || distParsed.value > 0)) {
          const distResolved = resolveLinearSigma(
            sigmas[1],
            defaultDistanceSigma(
              inst,
              distParsed.planned ? 0 : parseFloat(parts[3] || '0'),
              state.edmMode,
              0,
            ),
          );
          pushObservation({
            id: obsId++,
            type: 'dist',
            subtype: 'ts',
            instCode: traverseCtx.dirInstCode ?? '',
            setId: code,
            from: traverseCtx.occupy,
            to,
            obs: distParsed.value,
            planned: distParsed.planned,
            stdDev: distResolved.sigma * toMeters,
            sigmaSource: distResolved.source,
            mode: state.deltaMode,
          });
          if (vert) {
            if (state.deltaMode === 'horiz') {
              const dhResolved = resolveLinearSigma(
                sigmas[2],
                defaultElevDiffSigma(inst, Math.abs(distParsed.value)),
              );
              pushObservation({
                id: obsId++,
                type: 'lev',
                instCode: traverseCtx.dirInstCode ?? '',
                setId: code,
                from: traverseCtx.occupy,
                to,
                obs: (vertParsed as { value: number }).value,
                planned: Boolean(vertParsed?.planned),
                lenKm: 0,
                stdDev: dhResolved.sigma * toMeters,
                sigmaSource: dhResolved.source,
              });
            } else {
              const zenResolved = resolveAngularSigma(sigmas[2], defaultZenithSigmaSec(inst));
              pushObservation({
                id: obsId++,
                type: 'zenith',
                instCode: traverseCtx.dirInstCode ?? '',
                setId: code,
                from: traverseCtx.occupy,
                to,
                obs: (vertParsed as { value: number }).value,
                planned: Boolean(vertParsed?.planned),
                stdDev: zenResolved.sigma * SEC_TO_RAD,
                sigmaSource: zenResolved.source,
              });
            }
          }
        }
      } else if (code === 'DE') {
        if (traverseCtx.dirSetId) flushDirectionSet('DE');
        logs.push('Direction set end');
      } else if (code === 'SS') {
        // Sideshot: dist + optional vertical
        const stationTokens = parseSsStationTokens(parts);
        if (!stationTokens) {
          logs.push(`Invalid sideshot station token at line ${lineNum}, skipping`);
          continue;
        }
        const from = stationTokens.at;
        const to = stationTokens.to;
        const explicitBacksight = stationTokens.mode === 'at-from-to' ? stationTokens.explicitBacksight : undefined;
        const angleTokenIndex = stationTokens.angleTokenIndex;
        if (from === to || from === traverseCtx.backsight || to === traverseCtx.occupy) {
          logs.push(`Invalid sideshot occupy/backsight at line ${lineNum}, skipping`);
          continue;
        }
        if (traverseCtx.occupy && from !== traverseCtx.occupy) {
          logs.push(
            `Sideshot must originate from current occupy (${traverseCtx.occupy}) at line ${lineNum}`,
          );
          continue;
        }
        if (stations[to]?.fixed) {
          logs.push(`Sideshot cannot target fixed/control station (${to}) at line ${lineNum}`);
          continue;
        }
        const instCode = state.currentInstrument ?? '';
        const inst = instCode ? instrumentLibrary[instCode] : undefined;
        const firstTokenRaw = parts[angleTokenIndex] || '';
        const isAzPrefix = /^AZ=/i.test(firstTokenRaw) || firstTokenRaw.startsWith('@');
        const isHzPrefix = /^(HZ|HA|ANG)=/i.test(firstTokenRaw);
        const unprefixedAngleRad = parseAngleTokenRad(firstTokenRaw, state, 'dd');
        const hasUnprefixedAngle = !isAzPrefix && !isHzPrefix && Number.isFinite(unprefixedAngleRad);
        const isDmsAngle = firstTokenRaw.includes('-');
        const isSetupAngleByPattern =
          stationTokens.mode === 'legacy' &&
          hasUnprefixedAngle &&
          isDmsAngle &&
          Number.isFinite(parseFloat(parts[angleTokenIndex + 1] || '')) &&
          (!!traverseCtx.backsight || !!explicitBacksight);
        const angleMode: 'none' | 'az' | 'hz' =
          isAzPrefix
            ? 'az'
            : isHzPrefix
              ? 'hz'
              : stationTokens.mode === 'at-from-to' && hasUnprefixedAngle
                ? 'hz'
                : stationTokens.mode === 'at-to' && hasUnprefixedAngle
                  ? 'az'
                  : isSetupAngleByPattern
                    ? 'hz'
                    : 'none';
        let azimuthObs: number | undefined;
        let azimuthStdDev: number | undefined;
        let hzObs: number | undefined;
        let hzStdDev: number | undefined;
        let distIndex = angleTokenIndex;
        let vertIndex = angleTokenIndex + 1;
        let sigmaIndex = angleTokenIndex + 2;
        const resolvedBacksight = explicitBacksight ?? traverseCtx.backsight;
        if (angleMode === 'hz' && !resolvedBacksight) {
          logs.push(`Sideshot setup-angle mode requires a backsight at line ${lineNum}, skipping`);
          continue;
        }
        if (
          explicitBacksight &&
          traverseCtx.backsight &&
          explicitBacksight !== traverseCtx.backsight
        ) {
          logs.push(
            `Sideshot at line ${lineNum}: explicit backsight ${explicitBacksight} differs from active backsight ${traverseCtx.backsight}; explicit backsight used.`,
          );
        }
        if (angleMode !== 'none') {
          const cleanAngle = firstTokenRaw.replace(/^(AZ|HZ|HA|ANG)=/i, '').replace(/^@/, '');
          const angleRad = parseAngleTokenRad(cleanAngle, state, 'dd');
          if (!Number.isFinite(angleRad)) {
            logs.push(`Invalid sideshot horizontal angle/azimuth at line ${lineNum}, skipping`);
            continue;
          }
          if (angleMode === 'az') {
            azimuthObs = applyPlanRotation(angleRad, state);
          } else {
            hzObs = angleRad;
          }
          distIndex = angleTokenIndex + 1;
          vertIndex = angleTokenIndex + 2;
          sigmaIndex = angleTokenIndex + 3;
        }
        const dist = parseFloat(parts[distIndex] || '0');
        const vert = parts[vertIndex];
        if (!Number.isFinite(dist) || dist <= 0) {
          logs.push(`Invalid sideshot distance at line ${lineNum}, skipping`);
          continue;
        }
        const { sigmas, rest } = extractSigmaTokens(parts.slice(sigmaIndex), 3);
        let sigmaAzToken: SigmaToken | undefined;
        let sigmaDistToken: SigmaToken | undefined;
        let sigmaVertToken: SigmaToken | undefined;
        if (angleMode !== 'none') {
          if (vert) {
            if (sigmas.length >= 3) {
              sigmaAzToken = sigmas[0];
              sigmaDistToken = sigmas[1];
              sigmaVertToken = sigmas[2];
            } else if (sigmas.length === 2) {
              sigmaDistToken = sigmas[0];
              sigmaVertToken = sigmas[1];
            } else if (sigmas.length === 1) {
              sigmaDistToken = sigmas[0];
            }
          } else if (sigmas.length >= 2) {
            sigmaAzToken = sigmas[0];
            sigmaDistToken = sigmas[1];
          } else if (sigmas.length === 1) {
            sigmaDistToken = sigmas[0];
          }
          const hzResolved = resolveAngularSigma(sigmaAzToken, defaultDirectionSigmaSec(inst));
          if (angleMode === 'az') {
            azimuthStdDev = hzResolved.sigma * SEC_TO_RAD;
          } else {
            hzStdDev = hzResolved.sigma * SEC_TO_RAD;
          }
        } else {
          sigmaDistToken = sigmas[0];
          sigmaVertToken = sigmas[1];
        }
        const distResolved = resolveLinearSigma(
          sigmaDistToken,
          defaultDistanceSigma(inst, dist, state.edmMode, 0),
        );
        const { hi, ht } = extractHiHt(rest);
        const toMeters = state.units === 'ft' ? 1 / FT_PER_M : 1;
        pushObservation({
          id: obsId++,
          type: 'dist',
          subtype: 'ts',
          instCode,
          setId: 'SS',
          from,
          to,
          obs: dist * toMeters,
          stdDev: distResolved.sigma * toMeters,
          sigmaSource: distResolved.source,
          mode: state.deltaMode,
          hi: hi != null ? hi * toMeters : undefined,
          ht: ht != null ? ht * toMeters : undefined,
          // mark sideshots to allow downstream exclusion if desired
          calc: {
            sideshot: true,
            azimuthObs,
            azimuthStdDev,
            hzObs,
            hzStdDev,
            backsightId: hzObs != null ? resolvedBacksight : undefined,
            azimuthSource: azimuthObs != null ? 'explicit' : hzObs != null ? 'setup' : 'target',
          },
        });
        if (vert) {
          if (state.deltaMode === 'horiz') {
            const dh = parseFloat(vert) * toMeters;
            const dhResolved = resolveLinearSigma(
              sigmaVertToken,
              defaultElevDiffSigma(inst, dist * toMeters),
            );
            pushObservation({
              id: obsId++,
              type: 'lev',
              instCode,
              from,
              to,
              obs: dh,
              lenKm: 0,
              stdDev: dhResolved.sigma * toMeters,
              sigmaSource: dhResolved.source,
              calc: { sideshot: true },
            });
          } else {
            const zenRad = parseAngleTokenRad(vert, state, 'dd');
            const zenResolved = resolveAngularSigma(sigmaVertToken, defaultZenithSigmaSec(inst));
            pushObservation({
              id: obsId++,
              type: 'zenith',
              instCode,
              from,
              to,
              obs: zenRad,
              stdDev: zenResolved.sigma * SEC_TO_RAD,
              sigmaSource: zenResolved.source,
              hi: hi != null ? hi * toMeters : undefined,
              ht: ht != null ? ht * toMeters : undefined,
              calc: { sideshot: true },
            });
          }
        }
      } else if (code === 'GS') {
        const pointId = parts[1];
        if (!pointId) {
          logs.push(`Invalid GS record at line ${lineNum}, missing point identifier.`);
          continue;
        }
        const payload = parts.slice(2);
        let fromId: string | undefined;
        const numericTokens: string[] = [];
        payload.forEach((token) => {
          if (/^FROM=/i.test(token)) {
            const candidate = token.split('=').slice(1).join('=').trim();
            if (candidate) fromId = candidate;
            return;
          }
          numericTokens.push(token);
        });
        if (numericTokens.length < 2) {
          logs.push(`Invalid GS record at line ${lineNum}, expected at least E/N coordinates.`);
          continue;
        }
        const c1 = parseFloat(numericTokens[0]);
        const c2 = parseFloat(numericTokens[1]);
        if (!Number.isFinite(c1) || !Number.isFinite(c2)) {
          logs.push(`Invalid GS coordinate token(s) at line ${lineNum}, skipping.`);
          continue;
        }
        const tail = numericTokens.slice(2).map((token) => parseFloat(token));
        if (tail.some((value) => !Number.isFinite(value))) {
          logs.push(`Invalid GS numeric payload at line ${lineNum}, skipping.`);
          continue;
        }
        const toMeters = state.units === 'ft' ? 1 / FT_PER_M : 1;
        const east = state.order === 'EN' ? c1 * toMeters : c2 * toMeters;
        const north = state.order === 'EN' ? c2 * toMeters : c1 * toMeters;
        let height: number | undefined;
        let sigma1: number | undefined;
        let sigma2: number | undefined;
        let sigmaH: number | undefined;
        if (tail.length === 1) {
          height = tail[0] * toMeters;
        } else if (tail.length === 2) {
          sigma1 = tail[0] * toMeters;
          sigma2 = tail[1] * toMeters;
        } else if (tail.length === 3) {
          height = tail[0] * toMeters;
          sigma1 = tail[1] * toMeters;
          sigma2 = tail[2] * toMeters;
        } else if (tail.length >= 4) {
          height = tail[0] * toMeters;
          sigma1 = tail[1] * toMeters;
          sigma2 = tail[2] * toMeters;
          sigmaH = tail[3] * toMeters;
          if (tail.length > 4) {
            logs.push(`Warning: extra GS tokens ignored at line ${lineNum} (expected up to sigmaH).`);
          }
        }
        const sigmaE = state.order === 'EN' ? sigma1 : sigma2;
        const sigmaN = state.order === 'EN' ? sigma2 : sigma1;
        const shot: GpsTopoCoordinateShot = {
          pointId,
          east,
          north,
          height,
          sigmaE,
          sigmaN,
          sigmaH,
          fromId,
          sourceLine: lineNum,
        };
        state.gpsTopoShots?.push(shot);
      } else if (code === 'G') {
        const instCode = parts[1];
        const from = parts[2];
        const to = parts[3];
        const toMeters = state.units === 'ft' ? 1 / FT_PER_M : 1;
        const dEParsed = parseObservedLinearToken(parts[4], toMeters);
        const dNParsed = parseObservedLinearToken(parts[5], toMeters);
        if (!dEParsed.valid || !dNParsed.valid) {
          logs.push(`Invalid GPS vector at line ${lineNum}, skipping.`);
          continue;
        }
        const { sigmas, rest } = extractSigmaTokens(parts.slice(6), 2);
        const corrRaw = parseFloat(rest[0] || '');

        const inst = instrumentLibrary[instCode];
        const defaultStd = inst?.gpsStd_xy ?? 0;
        const sigmaEResolved = resolveLinearSigma(sigmas[0], defaultStd);
        const sigmaNResolved = resolveLinearSigma(sigmas[1], sigmaEResolved.sigma);
        let sigmaE = sigmaEResolved.sigma;
        let sigmaN = sigmaNResolved.sigma;
        const corr = Number.isNaN(corrRaw) ? 0 : Math.max(-0.999, Math.min(0.999, corrRaw));

        if (inst && inst.gpsStd_xy > 0) {
          sigmaE = Math.sqrt(sigmaE * sigmaE + inst.gpsStd_xy * inst.gpsStd_xy);
          sigmaN = Math.sqrt(sigmaN * sigmaN + inst.gpsStd_xy * inst.gpsStd_xy);
        }
        const sigmaMean = Math.sqrt((sigmaE * sigmaE + sigmaN * sigmaN) / 2);

        const obs: GpsObservation = {
          id: obsId++,
          type: 'gps',
          gpsMode: state.gpsVectorMode ?? 'network',
          gpsAntennaHiM: state.gpsAddHiHtEnabled ? (state.gpsAddHiHtHiM ?? 0) : undefined,
          gpsAntennaHtM: state.gpsAddHiHtEnabled ? (state.gpsAddHiHtHtM ?? 0) : undefined,
          instCode,
          from,
          to,
          planned: dEParsed.planned || dNParsed.planned,
          obs: {
            dE: dEParsed.value,
            dN: dNParsed.value,
          },
          stdDev: state.units === 'ft' ? sigmaMean / FT_PER_M : sigmaMean,
          stdDevE: state.units === 'ft' ? sigmaE / FT_PER_M : sigmaE,
          stdDevN: state.units === 'ft' ? sigmaN / FT_PER_M : sigmaN,
          corrEN: corr,
          sigmaSource:
            sigmaEResolved.source === sigmaNResolved.source
              ? sigmaEResolved.source
              : sigmaEResolved.source === 'fixed' || sigmaNResolved.source === 'fixed'
                ? 'fixed'
                : sigmaEResolved.source === 'explicit' || sigmaNResolved.source === 'explicit'
                  ? 'explicit'
                  : sigmaEResolved.source === 'float' || sigmaNResolved.source === 'float'
                    ? 'float'
                    : 'default',
        };
        pushObservation(obs);
        lastGpsObservation = obs;
      } else if (code === 'G4') {
        if (!lastGpsObservation) {
          logs.push(
            `Warning: GPS rover offset (G4) at line ${lineNum} has no preceding G vector; ignored.`,
          );
          continue;
        }
        const azimuth = parseAngleTokenRad(parts[1], state, 'dms');
        const distanceM = parseLinearMetersToken(parts[2], state.units);
        const zenith = parseAngleTokenRad(parts[3], state, 'dms');
        if (
          !Number.isFinite(azimuth) ||
          !Number.isFinite(distanceM ?? Number.NaN) ||
          !Number.isFinite(zenith)
        ) {
          logs.push(
            `Warning: invalid GPS rover offset (G4) at line ${lineNum}; expected azimuth, distance, and zenith.`,
          );
          continue;
        }
        if (parts.length > 4) {
          logs.push(
            `Warning: extra GPS rover offset (G4) tokens ignored at line ${lineNum}; expected azimuth, distance, and zenith only.`,
          );
        }
        const horizDistance = (distanceM as number) * Math.sin(zenith);
        const deltaH = (distanceM as number) * Math.cos(zenith);
        const deltaE = horizDistance * Math.sin(azimuth);
        const deltaN = horizDistance * Math.cos(azimuth);
        if (lastGpsObservation.gpsOffsetDistanceM != null) {
          logs.push(
            `Warning: GPS rover offset (G4) at line ${lineNum} replaced an earlier offset on ${lastGpsObservation.from}-${lastGpsObservation.to}.`,
          );
        }
        lastGpsObservation.gpsOffsetAzimuthRad = wrapTo2Pi(azimuth);
        lastGpsObservation.gpsOffsetDistanceM = distanceM as number;
        lastGpsObservation.gpsOffsetZenithRad = zenith;
        lastGpsObservation.gpsOffsetDeltaE = deltaE;
        lastGpsObservation.gpsOffsetDeltaN = deltaN;
        lastGpsObservation.gpsOffsetDeltaH = deltaH;
        lastGpsObservation.gpsOffsetSourceLine = lineNum;
        logs.push(
          `GPS rover offset attached to ${lastGpsObservation.from}-${lastGpsObservation.to}: dE=${deltaE.toFixed(4)} m, dN=${deltaN.toFixed(4)} m, dH=${deltaH.toFixed(4)} m`,
        );
      } else if (code === 'L') {
        const instCode = parts[1];
        const from = parts[2];
        const to = parts[3];
        const toMeters = state.units === 'ft' ? 1 / FT_PER_M : 1;
        const dHParsed = parseObservedLinearToken(parts[4], toMeters);
        if (!dHParsed.valid) {
          logs.push(`Invalid leveling observation at line ${lineNum}, skipping.`);
          continue;
        }
        const lenRaw = parseFloat(parts[5] || '0');
        const lenKm =
          Number.isFinite(lenRaw) && lenRaw > 0
            ? state.units === 'ft'
              ? lenRaw / FT_PER_M / 1000
              : lenRaw
            : 0;
        const sigmaToken = parseSigmaToken(parts[6]) ?? undefined;
        const baseStd = state.levelWeight ?? 0;
        if (!sigmaToken && state.levelWeight != null) {
          logs.push(`.LWEIGHT applied for leveling at line ${lineNum}: ${state.levelWeight} mm/km`);
        }

        const inst = instrumentLibrary[instCode];
        const levelResolved = resolveLinearSigma(sigmaToken, (baseStd * lenKm) / 1000.0);
        let sigma = levelResolved.sigma;
        if (inst && inst.levStd_mmPerKm > 0) {
          const lib = (inst.levStd_mmPerKm * lenKm) / 1000.0;
          sigma = Math.sqrt(sigma * sigma + lib * lib);
        }
        if (inst) {
          const elevModel = defaultElevDiffSigma(inst, lenKm * 1000);
          sigma = Math.sqrt(sigma * sigma + elevModel * elevModel);
        }

        const obs: LevelObservation = {
          id: obsId++,
          type: 'lev',
          instCode,
          from,
          to,
          obs: dHParsed.value,
          planned: dHParsed.planned,
          lenKm,
          stdDev: sigma,
          sigmaSource: levelResolved.source,
        };
        pushObservation(obs);
      } else {
        logs.push(`Unrecognized code "${code}" at line ${lineNum}, skipping`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logs.push(`Error on line ${lineNum}: ${msg}`);
    }
  }

  if (traverseCtx.dirSetId) {
    flushDirectionSet('EOF');
  }

  state.aliasExplicitCount = explicitAliases.size;
  state.aliasRuleCount = aliasRules.length;
  state.aliasExplicitMappings = [...explicitAliases.entries()].map(([sourceId, canonicalId]) => ({
    sourceId,
    canonicalId,
    sourceLine: explicitAliasLines.get(sourceId),
  }));
  state.aliasRuleSummaries = aliasRules.map((rule) => {
    if (rule.kind === 'prefix') {
      return { rule: `PREFIX ${rule.from} ${rule.to}`, sourceLine: rule.sourceLine };
    }
    if (rule.kind === 'suffix') {
      return { rule: `SUFFIX ${rule.from} ${rule.to}`, sourceLine: rule.sourceLine };
    }
    return { rule: `ADDITIVE ${rule.offset}`, sourceLine: rule.sourceLine };
  });
  if (explicitAliases.size > 0 || aliasRules.length > 0) {
    const remapObservation = (obs: Observation): void => {
      if (obs.type === 'angle') {
        const at = resolveAlias(obs.at);
        addAliasTrace(
          obs.at,
          at.canonicalId,
          'observation',
          obs.sourceLine,
          `${obs.type}.at`,
          at.reference,
        );
        obs.at = at.canonicalId;
        const from = resolveAlias(obs.from);
        addAliasTrace(
          obs.from,
          from.canonicalId,
          'observation',
          obs.sourceLine,
          `${obs.type}.from`,
          from.reference,
        );
        obs.from = from.canonicalId;
        const to = resolveAlias(obs.to);
        addAliasTrace(
          obs.to,
          to.canonicalId,
          'observation',
          obs.sourceLine,
          `${obs.type}.to`,
          to.reference,
        );
        obs.to = to.canonicalId;
      } else if (obs.type === 'direction') {
        const at = resolveAlias(obs.at);
        addAliasTrace(
          obs.at,
          at.canonicalId,
          'observation',
          obs.sourceLine,
          `${obs.type}.at`,
          at.reference,
        );
        obs.at = at.canonicalId;
        const to = resolveAlias(obs.to);
        addAliasTrace(
          obs.to,
          to.canonicalId,
          'observation',
          obs.sourceLine,
          `${obs.type}.to`,
          to.reference,
        );
        obs.to = to.canonicalId;
      } else if (
        obs.type === 'dist' ||
        obs.type === 'bearing' ||
        obs.type === 'dir' ||
        obs.type === 'gps' ||
        obs.type === 'lev' ||
        obs.type === 'zenith'
      ) {
        const from = resolveAlias(obs.from);
        addAliasTrace(
          obs.from,
          from.canonicalId,
          'observation',
          obs.sourceLine,
          `${obs.type}.from`,
          from.reference,
        );
        obs.from = from.canonicalId;
        const to = resolveAlias(obs.to);
        addAliasTrace(
          obs.to,
          to.canonicalId,
          'observation',
          obs.sourceLine,
          `${obs.type}.to`,
          to.reference,
        );
        obs.to = to.canonicalId;
      }
      if (obs.calc != null && typeof obs.calc === 'object') {
        const calcMeta = obs.calc as { backsightId?: StationId };
        if (calcMeta.backsightId) {
          const bs = resolveAlias(calcMeta.backsightId);
          addAliasTrace(
            calcMeta.backsightId,
            bs.canonicalId,
            'sideshot-backsight',
            obs.sourceLine,
            `${obs.type}.backsight`,
            bs.reference,
          );
          calcMeta.backsightId = bs.canonicalId;
        }
      }
    };
    observations.forEach(remapObservation);
    state.gpsTopoShots?.forEach((shot) => {
      const target = resolveAlias(shot.pointId);
      addAliasTrace(
        shot.pointId,
        target.canonicalId,
        'observation',
        shot.sourceLine,
        'GS.point',
        target.reference,
      );
      shot.pointId = target.canonicalId;
      if (shot.fromId) {
        const from = resolveAlias(shot.fromId);
        addAliasTrace(
          shot.fromId,
          from.canonicalId,
          'observation',
          shot.sourceLine,
          'GS.from',
          from.reference,
        );
        shot.fromId = from.canonicalId;
      }
    });
    directionRejectDiagnostics.forEach((diag) => {
      const occupy = resolveAlias(diag.occupy);
      addAliasTrace(
        diag.occupy,
        occupy.canonicalId,
        'direction-reject',
        diag.sourceLine,
        `${diag.recordType ?? 'UNKNOWN'}.occupy`,
        occupy.reference,
      );
      diag.occupy = occupy.canonicalId;
      if (diag.target) {
        const target = resolveAlias(diag.target);
        addAliasTrace(
          diag.target,
          target.canonicalId,
          'direction-reject',
          diag.sourceLine,
          `${diag.recordType ?? 'UNKNOWN'}.target`,
          target.reference,
        );
        diag.target = target.canonicalId;
      }
    });

    const isPlaceholderStation = (st: StationMap[string]): boolean =>
      Math.abs(st.x) <= 1e-12 &&
      Math.abs(st.y) <= 1e-12 &&
      Math.abs(st.h) <= 1e-12 &&
      (st.sx == null || Math.abs(st.sx) <= 1e-12) &&
      (st.sy == null || Math.abs(st.sy) <= 1e-12) &&
      (st.sh == null || Math.abs(st.sh) <= 1e-12) &&
      st.constraintCorrXY == null &&
      st.constraintX == null &&
      st.constraintY == null &&
      st.constraintH == null &&
      !(st.fixedX ?? false) &&
      !(st.fixedY ?? false) &&
      !(st.fixedH ?? false);

    const mergeStation = (
      target: StationMap[string],
      incoming: StationMap[string],
      incomingId: StationId,
      canonicalId: StationId,
    ): void => {
      const targetPlaceholder = isPlaceholderStation(target);
      const incomingPlaceholder = isPlaceholderStation(incoming);
      if (targetPlaceholder && !incomingPlaceholder) {
        Object.assign(target, incoming);
      } else {
        const hasConflict =
          !incomingPlaceholder &&
          (Math.abs(target.x - incoming.x) > 1e-6 ||
            Math.abs(target.y - incoming.y) > 1e-6 ||
            (state.coordMode === '3D' && Math.abs(target.h - incoming.h) > 1e-6));
        if (hasConflict) {
          logs.push(
            `Warning: alias merge ${incomingId} -> ${canonicalId} has conflicting coordinates; keeping first station definition.`,
          );
        }
      }
      const fixedX = (target.fixedX ?? false) || (incoming.fixedX ?? false);
      const fixedY = (target.fixedY ?? false) || (incoming.fixedY ?? false);
      const fixedH = (target.fixedH ?? false) || (incoming.fixedH ?? false);
      applyFixities(target, { x: fixedX, y: fixedY, h: fixedH }, state.coordMode);
      if (target.sx == null && incoming.sx != null) target.sx = incoming.sx;
      else if (target.sx != null && incoming.sx != null)
        target.sx = Math.min(target.sx, incoming.sx);
      if (target.sy == null && incoming.sy != null) target.sy = incoming.sy;
      else if (target.sy != null && incoming.sy != null)
        target.sy = Math.min(target.sy, incoming.sy);
      if (target.sh == null && incoming.sh != null) target.sh = incoming.sh;
      else if (target.sh != null && incoming.sh != null)
        target.sh = Math.min(target.sh, incoming.sh);
      if (target.constraintX == null && incoming.constraintX != null)
        target.constraintX = incoming.constraintX;
      if (target.constraintY == null && incoming.constraintY != null)
        target.constraintY = incoming.constraintY;
      if (target.constraintH == null && incoming.constraintH != null)
        target.constraintH = incoming.constraintH;
      if (target.constraintCorrXY == null && incoming.constraintCorrXY != null) {
        target.constraintCorrXY = incoming.constraintCorrXY;
      }
      if (target.heightType == null && incoming.heightType != null)
        target.heightType = incoming.heightType;
      if (target.latDeg == null && incoming.latDeg != null) target.latDeg = incoming.latDeg;
      if (target.lonDeg == null && incoming.lonDeg != null) target.lonDeg = incoming.lonDeg;
    };

    const remappedStations: StationMap = {};
    let renamedStationCount = 0;
    Object.entries(stations).forEach(([id, station]) => {
      const stationAlias = resolveAlias(id);
      const canonicalId = stationAlias.canonicalId;
      if (canonicalId !== id) renamedStationCount += 1;
      addAliasTrace(id, canonicalId, 'station', undefined, 'station.id', stationAlias.reference);
      const existing = remappedStations[canonicalId];
      if (!existing) {
        remappedStations[canonicalId] = { ...station };
      } else {
        mergeStation(existing, station, id, canonicalId);
      }
    });
    Object.keys(stations).forEach((id) => delete stations[id]);
    Object.assign(stations, remappedStations);
    logs.push(
      `Alias canonicalization applied (explicit=${explicitAliases.size}, rules=${aliasRules.length}, station remaps=${renamedStationCount}).`,
    );
  }
  if (lostStationIds.size > 0) {
    const canonicalLost = new Set<StationId>();
    lostStationIds.forEach((id) => {
      const resolved = resolveAlias(id);
      if (resolved.canonicalId) canonicalLost.add(resolved.canonicalId);
    });
    lostStationIds.clear();
    canonicalLost.forEach((id) => lostStationIds.add(id));
  }
  Object.entries(stations).forEach(([id, station]) => {
    if (lostStationIds.has(id)) {
      station.lost = true;
    } else if (station.lost) {
      delete station.lost;
    }
  });
  state.lostStationIds = [...lostStationIds].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true }),
  );
  if (state.lostStationIds.length > 0) {
    logs.push(`Lost stations flagged: ${state.lostStationIds.join(', ')}`);
  }
  state.aliasTrace = aliasTraceEntries
    .slice()
    .sort(
      (a, b) =>
        (a.sourceLine ?? Number.MAX_SAFE_INTEGER) - (b.sourceLine ?? Number.MAX_SAFE_INTEGER) ||
        a.context.localeCompare(b.context) ||
        a.sourceId.localeCompare(b.sourceId),
    );
  state.descriptionTrace = descriptionTraceEntries
    .map((entry) => ({
      ...entry,
      stationId: resolveAlias(entry.stationId).canonicalId || entry.stationId,
    }))
    .sort((a, b) => a.sourceLine - b.sourceLine || a.stationId.localeCompare(b.stationId));

  const descriptionSummaryMap = new Map<
    StationId,
    {
      recordCount: number;
      sourceLines: number[];
      uniqueDescriptions: Map<string, string>;
    }
  >();
  state.descriptionTrace.forEach((entry) => {
    const row = descriptionSummaryMap.get(entry.stationId) ?? {
      recordCount: 0,
      sourceLines: [],
      uniqueDescriptions: new Map<string, string>(),
    };
    row.recordCount += 1;
    row.sourceLines.push(entry.sourceLine);
    const key = normalizeDescriptionKey(entry.description);
    if (key && !row.uniqueDescriptions.has(key)) {
      row.uniqueDescriptions.set(key, entry.description);
    }
    descriptionSummaryMap.set(entry.stationId, row);
  });
  state.descriptionScanSummary = [...descriptionSummaryMap.entries()]
    .map(([stationId, row]) => {
      const uniqueCount = row.uniqueDescriptions.size;
      return {
        stationId,
        recordCount: row.recordCount,
        uniqueCount,
        conflict: uniqueCount > 1,
        descriptions: [...row.uniqueDescriptions.values()],
        sourceLines: row.sourceLines.slice().sort((a, b) => a - b),
      };
    })
    .sort((a, b) => a.stationId.localeCompare(b.stationId, undefined, { numeric: true }));
  state.descriptionRepeatedStationCount = state.descriptionScanSummary.filter(
    (row) => row.recordCount > 1,
  ).length;
  state.descriptionConflictCount = state.descriptionScanSummary.filter(
    (row) => row.conflict,
  ).length;
  const descriptionReconcileMode =
    state.descriptionReconcileMode ?? defaultParseOptions.descriptionReconcileMode;
  const descriptionDelimiter =
    state.descriptionAppendDelimiter ?? defaultParseOptions.descriptionAppendDelimiter ?? ' | ';
  state.descriptionReconcileMode = descriptionReconcileMode;
  state.descriptionAppendDelimiter = descriptionDelimiter;
  const reconciledDescriptions: Record<StationId, string> = {};
  state.descriptionScanSummary.forEach((row) => {
    if (row.descriptions.length === 0) return;
    reconciledDescriptions[row.stationId] =
      descriptionReconcileMode === 'append'
        ? row.descriptions.join(descriptionDelimiter)
        : row.descriptions[0];
  });
  state.reconciledDescriptions = reconciledDescriptions;
  if (state.descriptionTrace.length > 0) {
    logs.push(
      `Description scan: records=${state.descriptionTrace.length}, stations=${state.descriptionScanSummary.length}, repeated=${state.descriptionRepeatedStationCount}, conflicts=${state.descriptionConflictCount}.`,
    );
    logs.push(
      `Description reconciliation: mode=${descriptionReconcileMode.toUpperCase()} delimiter="${descriptionDelimiter}"`,
    );
    state.descriptionScanSummary
      .filter((row) => row.conflict)
      .slice(0, 10)
      .forEach((row) => {
        logs.push(
          `Description conflict ${row.stationId} at lines ${row.sourceLines.join(', ')}: ${row.descriptions.join(' | ')}`,
        );
      });
    if ((state.descriptionConflictCount ?? 0) > 10) {
      logs.push(`Description conflicts not shown: ${(state.descriptionConflictCount ?? 0) - 10}`);
    }
  }

  const unknowns = Object.keys(stations).filter((id) => {
    const st = stations[id];
    if (!st) return false;
    const fx = st.fixedX ?? false;
    const fy = st.fixedY ?? false;
    const fh = st.fixedH ?? false;
    return state.coordMode === '2D' ? !(fx && fy) : !(fx && fy && fh);
  });
  const typeSummary = observations.reduce<Record<string, number>>((acc, o) => {
    acc[o.type] = (acc[o.type] ?? 0) + 1;
    return acc;
  }, {});
  if (!orderExplicit) {
    logs.push(
      `Warning: .ORDER not specified; using ${state.order}. If your coordinates are North East, add ".ORDER NE".`,
    );
  }
  if (directionRejectDiagnostics.length > 0) {
    logs.push(`Direction rejects: ${directionRejectDiagnostics.length}`);
  }
  if (preanalysisMode) {
    logs.push(
      `Preanalysis parsing: mode=ON, planned observations=${state.plannedObservationCount ?? 0}`,
    );
  }
  state.gpsOffsetObservationCount = observations.filter(
    (obs): obs is GpsObservation => obs.type === 'gps' && obs.gpsOffsetDistanceM != null,
  ).length;
  if ((state.gpsOffsetObservationCount ?? 0) > 0) {
    logs.push(`GPS rover offsets parsed: ${state.gpsOffsetObservationCount}`);
  }
  logs.push(
    `Counts: ${Object.entries(typeSummary)
      .map(([k, v]) => `${k}=${v}`)
      .join(', ')}`,
  );
  logs.push(
    `Stations: ${Object.keys(stations).length} (unknown: ${unknowns.length}). Obs: ${observations.length}`,
  );

  return {
    stations,
    observations,
    instrumentLibrary,
    unknowns,
    parseState: { ...state },
    logs,
    directionRejectDiagnostics,
  };
};
