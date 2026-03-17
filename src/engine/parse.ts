import { dmsToRad, RAD_TO_DEG, SEC_TO_RAD } from './angles';
import { parseAutoAdjustDirectiveTokens } from './autoAdjust';
import { DEFAULT_CANADA_CRS_ID, normalizeCrsId } from './crsCatalog';
import { handleConventionalPrimitiveRecord } from './parseConventionalObservationRecords';
import { handleControlRecord } from './parseControlRecords';
import {
  createIncludeScopeSnapshot,
  restoreIncludeScopeSnapshot,
  type IncludeScopeSnapshot,
} from './parseIncludeScope';
import {
  applyCoreDirectiveState,
  directiveTransitionStateFromParseState,
  finalizeDirectiveTransitions,
  gridDistanceModeToReductionDistanceKind,
  normalizeObservationModeState,
} from './parseDirectiveState';
import { expandInputWithIncludes } from './parseIncludes';
import {
  DEFAULT_QFIX_ANGULAR_SIGMA_SEC,
  DEFAULT_QFIX_LINEAR_SIGMA_M,
} from './defaults';
import { normalizeGeoidModelId, parseGeoidInterpolationToken } from './geoid';
import { parseCrsProjectionModelToken } from './geodesy';
import type {
  AngleObservation,
  CoordInputClass,
  CoordSystemMode,
  CrsProjectionModel,
  DirectiveNoEffectWarning,
  DirectiveTransition,
  DistanceObservation,
  DirectionRejectDiagnostic,
  DirObservation,
  GnssVectorFrame,
  GridDistanceInputMode,
  GridObservationMode,
  ReductionDistanceKind,
  ReductionInputSpace,
  ReductionUsageSummary,
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
  AngleMode,
  GeoidHeightDatum,
  GpsVectorMode,
  ParseCompatibilityDiagnostic,
  ParseCompatibilityDiagnosticCode,
  ParseCompatibilityMode,
  FaceNormalizationMode,
  SigmaSource,
  DirectionFaceSource,
  DirectionSetTreatmentDecision,
  DirectionSetPolicyOutcome,
  DirectionSetTreatmentDiagnostic,
} from '../types';

const defaultParseOptions: ParseOptions = {
  runMode: 'adjustment',
  directiveAbbreviationMode: 'unique-prefix',
  unknownDirectivePolicy: 'legacy-warn',
  units: 'm',
  coordMode: '3D',
  coordSystemMode: 'local',
  crsId: DEFAULT_CANADA_CRS_ID,
  localDatumScheme: 'average-scale',
  averageScaleFactor: 1,
  scaleOverrideActive: false,
  commonElevation: 0,
  averageGeoidHeight: 0,
  reductionContext: {
    inputSpaceDefault: 'measured',
    distanceKind: 'ground',
    bearingKind: 'grid',
    explicitOverrideActive: false,
  },
  observationMode: {
    bearing: 'grid',
    distance: 'measured',
    angle: 'measured',
    direction: 'measured',
  },
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
  faceNormalizationMode: 'on',
  directionFaceReliabilityFromCluster: false,
  directionFaceZenithWindowDeg: 45,
  directionFaceClusterSeparationDeg: 180,
  directionFaceClusterSeparationToleranceDeg: 20,
  directionFaceClusterConfidenceMin: 0.35,
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
  geoidSourceFormat: 'builtin',
  geoidSourcePath: '',
  geoidSourceResolvedFormat: 'builtin',
  geoidSourceFallbackUsed: false,
  geoidInterpolation: 'bilinear',
  geoidHeightConversionEnabled: false,
  geoidOutputHeightDatum: 'orthometric',
  geoidModelLoaded: false,
  geoidModelMetadata: '',
  geoidSampleUndulationM: undefined,
  geoidConvertedStationCount: 0,
  geoidSkippedStationCount: 0,
  gpsVectorMode: 'network',
  gnssVectorFrameDefault: 'gridNEU',
  gnssFrameConfirmed: false,
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
  qFixLinearSigmaM: DEFAULT_QFIX_LINEAR_SIGMA_M,
  qFixAngularSigmaSec: DEFAULT_QFIX_ANGULAR_SIGMA_SEC,
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
  parseCompatibilityMode: 'legacy',
  parseCompatibilityDiagnostics: [],
  ambiguousCount: 0,
  legacyFallbackCount: 0,
  strictRejectCount: 0,
  rewriteSuggestionCount: 0,
  parseModeMigrated: false,
  sourceFile: '<input>',
  includeFiles: {},
  includeMaxDepth: 16,
  includeStack: [],
  includeTrace: [],
  includeErrors: [],
  compatibilityAcceptedNoOpDirectives: [],
  stationSeparator: '-',
  dataInputEnabled: true,
  threeReduceMode: false,
  linearMultiplier: 1,
  elevationInputMode: 'orthometric',
  projectElevationMeters: 0,
  vLevelMode: 'off',
  vLevelNoneStdErrMeters: undefined,
  clusterDetectionEnabled: true,
  clusterLinkageMode: 'single',
  clusterTolerance2D: 0.03,
  clusterTolerance3D: 0.05,
  clusterApprovedMerges: [],
  clusterPassLabel: 'single',
  clusterDualPassRan: false,
  clusterApprovedMergeCount: 0,
  preferExternalInstruments: false,
  directiveTransitions: [],
  directiveNoEffectWarnings: [],
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

type ControlComponentMode = 'inherit' | 'fixed' | 'free';

const parseFixityTokens = (
  tokens: string[],
  componentCount: number,
): {
  componentModes: ControlComponentMode[];
  fixities: boolean[];
  hasTokens: boolean;
  hasFreeMarkers: boolean;
  legacyStarFixed: boolean;
} => {
  const raw = tokens.filter((t) => t === '!' || t === '*');
  if (!raw.length) {
    return {
      componentModes: new Array(componentCount).fill('inherit'),
      fixities: new Array(componentCount).fill(false),
      hasTokens: false,
      hasFreeMarkers: false,
      legacyStarFixed: false,
    };
  }
  if (raw.length === 1 && raw[0] === '!') {
    return {
      componentModes: new Array(componentCount).fill('fixed'),
      fixities: new Array(componentCount).fill(true),
      hasTokens: true,
      hasFreeMarkers: false,
      legacyStarFixed: false,
    };
  }
  if (raw.length === 1 && raw[0] === '*') {
    return {
      componentModes: new Array(componentCount).fill('fixed'),
      fixities: new Array(componentCount).fill(true),
      hasTokens: true,
      hasFreeMarkers: false,
      legacyStarFixed: true,
    };
  }
  const componentModes = new Array(componentCount).fill('inherit') as ControlComponentMode[];
  const fixities = new Array(componentCount).fill(false);
  for (let i = 0; i < componentCount && i < raw.length; i += 1) {
    const mode = raw[i] === '!' ? 'fixed' : 'free';
    componentModes[i] = mode;
    fixities[i] = mode === 'fixed';
  }
  return {
    componentModes,
    fixities,
    hasTokens: true,
    hasFreeMarkers: componentModes.includes('free'),
    legacyStarFixed: false,
  };
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

const clearStationConstraintComponent = (
  station: StationMap[string],
  component: 'x' | 'y' | 'h',
): void => {
  if (component === 'x') {
    delete station.sx;
    delete station.constraintX;
  } else if (component === 'y') {
    delete station.sy;
    delete station.constraintY;
  } else {
    delete station.sh;
    delete station.constraintH;
  }
  if (component === 'x' || component === 'y') {
    delete station.constraintCorrXY;
  }
};

const setStationConstraintMode = (
  station: StationMap[string],
  component: 'x' | 'y' | 'h',
  mode: StationMap[string]['constraintModeX'],
): void => {
  if (component === 'x') station.constraintModeX = mode;
  else if (component === 'y') station.constraintModeY = mode;
  else station.constraintModeH = mode;
};

const resolveStationConstraintMode = (
  explicitMode: ControlComponentMode,
  fixed: boolean,
  hasConstraint: boolean,
): StationMap[string]['constraintModeX'] => {
  if (explicitMode === 'free') return 'free';
  if (fixed) return 'fixed';
  if (hasConstraint) return 'weighted';
  return 'approximate';
};

type SigmaToken =
  | { kind: 'default' }
  | { kind: 'numeric'; value: number }
  | { kind: 'fixed' }
  | { kind: 'float' };

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

const splitStationPairToken = (token: string, separator = '-'): string[] => {
  if (!token) return [];
  if (separator === '-') return token.split('-');
  return token.split(separator);
};

const parseFromTo = (
  parts: string[],
  startIndex: number,
  separator = '-',
): { from: string; to: string; nextIndex: number } => {
  const token = parts[startIndex];
  if (!token) return { from: '', to: '', nextIndex: startIndex + 1 };
  if (token.includes(separator)) {
    const [from, to] = splitStationPairToken(token, separator);
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

const parseSsStationTokens = (parts: string[], separator = '-'): SsStationTokens | null => {
  const first = parts[1] ?? '';
  if (!first) return null;
  if (first.includes(separator)) {
    const stations = splitStationPairToken(first, separator)
      .map((token) => token.trim())
      .filter(Boolean);
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

const parseQuadrantBearingTokenToRad = (token: string): number | null => {
  const cleaned = token.trim().toUpperCase().replace(/\s+/g, '');
  const match = cleaned.match(/^([NS])(.+)([EW])$/);
  if (!match) return null;
  const ns = match[1];
  const body = match[2];
  const ew = match[3];
  const bodyDeg = body.includes('-') ? dmsToRad(body) * RAD_TO_DEG : Number.parseFloat(body);
  if (!Number.isFinite(bodyDeg)) return null;
  const clamped = Math.max(0, Math.min(90, bodyDeg));
  let azDeg = clamped;
  if (ns === 'N' && ew === 'E') azDeg = clamped;
  else if (ns === 'S' && ew === 'E') azDeg = 180 - clamped;
  else if (ns === 'S' && ew === 'W') azDeg = 180 + clamped;
  else if (ns === 'N' && ew === 'W') azDeg = 360 - clamped;
  return wrapTo2Pi(azDeg * DEG_TO_RAD);
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
  const quadrant = parseQuadrantBearingTokenToRad(token);
  if (quadrant != null) return quadrant * RAD_TO_DEG;
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
  const quadrant = parseQuadrantBearingTokenToRad(trimmed);
  if (quadrant != null) return quadrant;
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

const createReductionUsageSummary = (): ReductionUsageSummary => ({
  bearing: { grid: 0, measured: 0 },
  angle: { grid: 0, measured: 0 },
  direction: { grid: 0, measured: 0 },
  distance: { ground: 0, grid: 0, ellipsoidal: 0 },
  total: 0,
});

const summarizeReductionUsage = (observations: Observation[]): ReductionUsageSummary => {
  const summary = createReductionUsageSummary();
  observations.forEach((obs) => {
    if (obs.type === 'bearing') {
      const mode = obs.gridObsMode === 'measured' ? 'measured' : 'grid';
      summary.bearing[mode] += 1;
      summary.total += 1;
      return;
    }
    if (obs.type === 'angle') {
      const mode = obs.gridObsMode === 'grid' ? 'grid' : 'measured';
      summary.angle[mode] += 1;
      summary.total += 1;
      return;
    }
    if (obs.type === 'direction' || obs.type === 'dir') {
      const mode = obs.gridObsMode === 'grid' ? 'grid' : 'measured';
      summary.direction[mode] += 1;
      summary.total += 1;
      return;
    }
    if (obs.type === 'dist') {
      const kind: 'ground' | 'grid' | 'ellipsoidal' =
        obs.distanceKind ??
        (obs.gridDistanceMode === 'ellipsoidal'
          ? 'ellipsoidal'
          : obs.gridDistanceMode === 'grid'
            ? 'grid'
            : 'ground');
      summary.distance[kind] += 1;
      summary.total += 1;
    }
  });
  return summary;
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

const parseGnssVectorFrameToken = (token?: string): GnssVectorFrame | null => {
  if (!token) return null;
  const upper = token.trim().toUpperCase();
  if (!upper) return null;
  if (upper === 'GRIDNEU' || upper === 'GRID' || upper === 'NEU') return 'gridNEU';
  if (upper === 'ENULOCAL' || upper === 'ENU' || upper === 'LOCALENU') return 'enuLocal';
  if (upper === 'ECEFDELTA' || upper === 'ECEF' || upper === 'DXDYDZ') return 'ecefDelta';
  if (upper === 'LLHBASELINE' || upper === 'LLH' || upper === 'GEODETICBASELINE')
    return 'llhBaseline';
  if (upper === 'UNKNOWN' || upper === 'UNSPECIFIED') return 'unknown';
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

const INLINE_CANONICAL_OPS = [
  'UNITS',
  'SCALE',
  'MEASURED',
  'GRID',
  'COORD',
  'ORDER',
  '2D',
  '3D',
  '3REDUCE',
  'DELTA',
  'MAPMODE',
  'MAPSCALE',
  'CRS',
  'GEOID',
  'GPS',
  'LWEIGHT',
  'LEVELTOL',
  'QFIX',
  'NORMALIZE',
  'LONSIGN',
  'EDM',
  'CENTERING',
  'ADDC',
  'DEBUG',
  'CURVREF',
  'REFRACTION',
  'VRED',
  'AMODE',
  'ROBUST',
  'AUTOADJUST',
  'PRISM',
  'ROTATION',
  'LOSTSTATIONS',
  'AUTOSIDESHOT',
  'DESC',
  'TSCORR',
  'ALIAS',
  'I',
  'TS',
  'END',
  'DATA',
  'SEPARATOR',
  'INCLUDE',
  'MULTIPLIER',
  'ELEVATION',
  'PELEVATION',
  'VLEVEL',
  'COPYINPUT',
  'ELLIPSE',
  'RELATIVE',
  'PTOLERANCE',
] as const;

const INLINE_ALIAS_TO_CANONICAL: Record<string, string> = {
  DESCRIPTION: 'DESC',
  INSTRUMENT: 'I',
  INST: 'I',
  ADDCENTERING: 'ADDC',
  CURVE: 'CURVREF',
  LONGITUDE: 'LONSIGN',
  LONG: 'LONSIGN',
  MAP: 'MAPMODE',
  SEP: 'SEPARATOR',
  SEPERATOR: 'SEPARATOR',
  INCUDE: 'INCLUDE',
  MULT: 'MULTIPLIER',
  ELEV: 'ELEVATION',
  PELEV: 'PELEVATION',
  COPY: 'COPYINPUT',
  ELL: 'ELLIPSE',
  REL: 'RELATIVE',
  PTOL: 'PTOLERANCE',
  '3R': '3REDUCE',
};

type NormalizedInlineDirective = {
  op?: string;
  unknown?: boolean;
  ambiguous?: boolean;
  candidates?: string[];
};

export const normalizeInlineDirective = (
  rawDirectiveToken: string,
  abbreviationMode: ParseOptions['directiveAbbreviationMode'] = 'unique-prefix',
): NormalizedInlineDirective => {
  if (!rawDirectiveToken) return { unknown: true };
  const token = rawDirectiveToken
    .trim()
    .toUpperCase()
    .replace(/^[./]+/, '')
    .trim();
  if (!token) return { unknown: true };
  const aliasHit = INLINE_ALIAS_TO_CANONICAL[token];
  if (aliasHit) return { op: `.${aliasHit}` };
  if (INLINE_CANONICAL_OPS.includes(token as (typeof INLINE_CANONICAL_OPS)[number])) {
    return { op: `.${token}` };
  }
  if (abbreviationMode !== 'unique-prefix') return { unknown: true };
  const prefixed = INLINE_CANONICAL_OPS.filter((name) => name.startsWith(token));
  if (prefixed.length === 1) return { op: `.${prefixed[0]}` };
  if (prefixed.length > 1) {
    return {
      ambiguous: true,
      candidates: prefixed.map((name) => `.${name}`),
    };
  }
  return { unknown: true };
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
    faceSource: DirectionFaceSource;
    reliableFace: boolean;
  }

  const stations: StationMap = {};
  const observations: Observation[] = [];
  const instrumentLibrary: InstrumentLibrary = { ...existingInstruments };
  const logs: string[] = [];
  const directionRejectDiagnostics: DirectionRejectDiagnostic[] = [];
  const directionSetTreatmentDiagnostics: DirectionSetTreatmentDiagnostic[] = [];
  const state: ParseOptions = { ...defaultParseOptions, ...opts };
  const hasExplicitFaceNormalizationMode = Object.prototype.hasOwnProperty.call(
    opts,
    'faceNormalizationMode',
  );
  const resolvedFaceNormalizationMode: FaceNormalizationMode = hasExplicitFaceNormalizationMode
    ? (opts.faceNormalizationMode ?? 'on')
    : typeof opts.normalize === 'boolean'
      ? opts.normalize
        ? 'on'
        : 'off'
      : (state.faceNormalizationMode ??
        ((state.normalize ?? defaultParseOptions.normalize) === false ? 'off' : 'on'));
  state.faceNormalizationMode = resolvedFaceNormalizationMode;
  state.normalize = resolvedFaceNormalizationMode !== 'off';
  const compatibilityMode: ParseCompatibilityMode =
    opts.parseCompatibilityMode ?? state.parseCompatibilityMode ?? 'legacy';
  state.parseCompatibilityMode = compatibilityMode;
  const compatibilityDiagnostics: ParseCompatibilityDiagnostic[] = [];
  let ambiguousCount = 0;
  let legacyFallbackCount = 0;
  let strictRejectCount = 0;
  let rewriteSuggestionCount = 0;
  if (!opts.observationMode) {
    state.observationMode = undefined;
  }
  if (!opts.reductionContext) {
    state.reductionContext = undefined;
  }
  const resolvedRunMode =
    opts.runMode ??
    ((opts.preanalysisMode ?? state.preanalysisMode)
      ? 'preanalysis'
      : (state.runMode ?? 'adjustment'));
  state.runMode = resolvedRunMode;
  if (resolvedRunMode === 'preanalysis') {
    state.preanalysisMode = true;
  } else if (resolvedRunMode === 'data-check' || resolvedRunMode === 'blunder-detect') {
    state.preanalysisMode = false;
  }
  state.stationSeparator = state.stationSeparator || '-';
  state.dataInputEnabled = state.dataInputEnabled !== false;
  state.threeReduceMode = state.threeReduceMode === true;
  state.linearMultiplier = Number.isFinite(state.linearMultiplier as number)
    ? (state.linearMultiplier as number)
    : 1;
  normalizeObservationModeState(state);
  state.plannedObservationCount = 0;
  state.gpsTopoShots = [];
  const directiveTransitions: DirectiveTransition[] = [];
  const directiveNoEffectWarnings: DirectiveNoEffectWarning[] = [];
  const addCompatibilityDiagnostic = (
    code: ParseCompatibilityDiagnosticCode,
    line: number,
    recordType: string,
    message: string,
    rewriteSuggestion?: string,
    fallbackApplied = false,
    severity: 'warning' | 'error' = 'warning',
  ): void => {
    const normalizedSeverity = compatibilityMode === 'strict' ? 'error' : severity;
    compatibilityDiagnostics.push({
      code,
      line,
      sourceFile: currentSourceFile,
      recordType,
      mode: compatibilityMode,
      severity: normalizedSeverity,
      message,
      rewriteSuggestion,
      fallbackApplied,
    });
    if (rewriteSuggestion) rewriteSuggestionCount += 1;
    if (
      code === 'ROLE_AMBIGUITY' ||
      code === 'TOKEN_ROLE_COLLISION' ||
      code === 'OVERLOADED_STATION_FORM' ||
      code === 'SIGMA_POSITION_AMBIGUITY' ||
      code === 'MIXED_LEGACY_SYNTAX'
    ) {
      ambiguousCount += 1;
    }
    if (fallbackApplied) legacyFallbackCount += 1;
    if (normalizedSeverity === 'error') strictRejectCount += 1;
    const prefix = normalizedSeverity === 'error' ? 'Error' : 'Warning';
    const suggestionText = rewriteSuggestion ? ` Rewrite: ${rewriteSuggestion}` : '';
    logs.push(
      `${prefix}: [${code}] ${recordType} line ${line}: ${message}${suggestionText}`.trim(),
    );
  };
  const recordDirectiveTransition = (directive: string) => {
    directiveTransitions.push({
      line: lineNum,
      directive,
      stateAfter: directiveTransitionStateFromParseState(state),
      effectiveFromLine: lineNum,
      obsCountInRange: 0,
    });
  };
  const currentGridModeForType = (
    obsType: Observation['type'],
  ): {
    gridObsMode?: GridObservationMode;
    gridDistanceMode?: GridDistanceInputMode;
    inputSpace?: ReductionInputSpace;
    distanceKind?: ReductionDistanceKind;
  } => {
    if (obsType === 'dist') {
      const distanceMode = state.gridDistanceMode ?? 'measured';
      return {
        gridObsMode: distanceMode === 'measured' ? 'measured' : 'grid',
        gridDistanceMode: distanceMode,
        inputSpace: distanceMode === 'measured' ? 'measured' : 'grid',
        distanceKind: gridDistanceModeToReductionDistanceKind(distanceMode),
      };
    }
    if (obsType === 'bearing' || obsType === 'dir') {
      const gridObsMode = state.gridBearingMode ?? 'grid';
      return { gridObsMode, inputSpace: gridObsMode };
    }
    if (obsType === 'angle') {
      const gridObsMode = state.gridAngleMode ?? 'measured';
      return { gridObsMode, inputSpace: gridObsMode };
    }
    if (obsType === 'direction') {
      const gridObsMode = state.gridDirectionMode ?? 'measured';
      return { gridObsMode, inputSpace: gridObsMode };
    }
    return {};
  };
  if (state.directionSetMode === 'raw') {
    logs.push('Direction set processing mode forced to raw (no target reduction).');
  }
  logs.push(
    `Direction face treatment: mode=${(state.faceNormalizationMode ?? 'on').toUpperCase()} (clusterReliability=${state.directionFaceReliabilityFromCluster ? 'ON' : 'OFF'}, zenithWindow=${(state.directionFaceZenithWindowDeg ?? 45).toFixed(1)}deg, clusterSep=${(state.directionFaceClusterSeparationDeg ?? 180).toFixed(1)}±${(state.directionFaceClusterSeparationToleranceDeg ?? 20).toFixed(1)}deg, clusterConfMin=${(state.directionFaceClusterConfidenceMin ?? 0.35).toFixed(2)}).`,
  );
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
  let explicitAliases = new Map<StationId, StationId>();
  let explicitAliasLines = new Map<StationId, number>();
  let aliasRules: AliasRule[] = [];
  const aliasCycleWarnings = new Set<string>();
  const aliasTraceEntries: NonNullable<ParseOptions['aliasTrace']> = [];
  const descriptionTraceEntries: NonNullable<ParseOptions['descriptionTrace']> = [];
  const aliasTraceSeen = new Set<string>();
  let lostStationIds = new Set<StationId>((state.lostStationIds ?? []).map((id) => `${id}`));
  const includeScopeStack: IncludeScopeSnapshot<
    GpsObservation,
    StationId,
    AliasRule,
    RawDirectionShot
  >[] = [];
  const resolveLinearSigma = (
    token: SigmaToken | undefined,
    defaultSigma: number,
  ): { sigma: number; source: SigmaSource } => {
    const fixedM = Math.max(1e-12, state.qFixLinearSigmaM ?? DEFAULT_QFIX_LINEAR_SIGMA_M);
    const fixedInputUnits = state.units === 'ft' ? fixedM * FT_PER_M : fixedM;
    return resolveSigma(token, defaultSigma, fixedInputUnits, FLOAT_SIGMA);
  };
  const resolveAngularSigma = (
    token: SigmaToken | undefined,
    defaultSigma: number,
  ): { sigma: number; source: SigmaSource } => {
    const fixedSec = Math.max(1e-12, state.qFixAngularSigmaSec ?? DEFAULT_QFIX_ANGULAR_SIGMA_SEC);
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

  const expanded = expandInputWithIncludes(input, opts, logs, {
    splitInlineCommentAndDescription,
    splitWhitespaceTokens,
    normalizeInlineDirective,
  });
  const lines = expanded.lines;
  state.includeTrace = expanded.includeTrace;
  state.includeErrors = expanded.includeErrors;
  let lineNum = 0;
  let currentSourceFile = state.sourceFile ?? '<input>';
  let obsId = 0;
  let lastGpsObservation: GpsObservation | undefined;
  const autoCreatedStations = new Set<StationId>();
  const rejectedAutoCreateTokens = new Set<string>();
  const preanalysisMode = state.preanalysisMode === true;
  const strictDirectivePolicy =
    compatibilityMode === 'strict' || state.unknownDirectivePolicy === 'strict-error';
  const compatibilityAcceptedNoOps = new Set<string>(
    state.compatibilityAcceptedNoOpDirectives ?? [],
  );
  const looksLikeNumericMeasurement = (token: string): boolean =>
    /^[+-]?\d+\.\d+(?:[eE][+-]?\d+)?$/.test(token);
  const isPlannedToken = (token?: string): boolean => preanalysisMode && token?.trim() === '?';
  const linearToMetersFactor = (): number =>
    (state.units === 'ft' ? 1 / FT_PER_M : 1) * (state.linearMultiplier ?? 1);
  const effectiveDistanceMode = (): 'slope' | 'horiz' =>
    state.threeReduceMode && state.deltaMode === 'slope' ? 'horiz' : state.deltaMode;
  const levelWeightSigmaFromSpanMeters = (spanMeters: number): number => {
    const levelWeightMmPerKm = state.levelWeight;
    if (
      levelWeightMmPerKm == null ||
      !Number.isFinite(levelWeightMmPerKm) ||
      levelWeightMmPerKm <= 0
    ) {
      return 0;
    }
    const spanKm = Math.abs(spanMeters) / 1000;
    return (levelWeightMmPerKm * spanKm) / 1000;
  };
  const resolveLevelingSigma = (
    token: SigmaToken | undefined,
    inst: Instrument | undefined,
    spanMeters: number,
    contextCode: string,
    sourceLine: number,
  ): { sigma: number; source: SigmaSource } => {
    const absSpanMeters = Math.abs(spanMeters);
    const levelWeightSigma = levelWeightSigmaFromSpanMeters(absSpanMeters);
    if (!token && levelWeightSigma > 0) {
      logs.push(
        `.LWEIGHT fallback applied for ${contextCode} at line ${sourceLine}: ${state.levelWeight} mm/km over ${(absSpanMeters / 1000).toFixed(4)} km`,
      );
    }
    const instSigma = defaultElevDiffSigma(inst, absSpanMeters);
    const defaultSigma = Math.sqrt(levelWeightSigma * levelWeightSigma + instSigma * instSigma);
    return resolveLinearSigma(token, defaultSigma);
  };
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
  const isIntegerLikeToken = (token: string): boolean => /^[+-]?\d+$/.test(token.trim());
  const scoreDistanceCandidate = (candidate: {
    instCode: string;
    from: string;
    to: string;
    distToken: string;
    setId: string;
    explicitInst: boolean;
  }): number => {
    let score = 0;
    if (candidate.distToken.includes('.') || candidate.distToken.includes('?')) score += 2;
    if (candidate.setId) score += 1;
    if (isIntegerLikeToken(candidate.from)) score += 1;
    if (isIntegerLikeToken(candidate.to)) score += 1;
    if (candidate.setId && isIntegerLikeToken(candidate.from) && isIntegerLikeToken(candidate.to)) {
      score += 2;
    }
    if (stations[candidate.from]) score += 2;
    if (stations[candidate.to]) score += 2;
    if (candidate.explicitInst && candidate.instCode && !stations[candidate.instCode]) score += 1;
    if (
      candidate.explicitInst &&
      !candidate.setId &&
      /^[A-Za-z_]/.test(candidate.from) &&
      isIntegerLikeToken(candidate.to)
    ) {
      score -= 2;
    }
    if (looksLikeNumericMeasurement(candidate.from) || looksLikeNumericMeasurement(candidate.to)) {
      score -= 12;
    }
    return score;
  };
  const rejectNumericStationTokens = (
    recordType: string,
    sourceLine: number,
    stationTokens: Array<{ role: string; value: string }>,
  ): boolean => {
    const bad = stationTokens.find((row) => looksLikeNumericMeasurement(row.value));
    if (!bad) return false;
    addCompatibilityDiagnostic(
      'NUMERIC_STATION_TOKEN_REJECTED',
      sourceLine,
      recordType,
      `token "${bad.value}" for ${bad.role} looks like a measurement, not a station id`,
      `Rewrite ${recordType} with explicit station tokens and keep numeric values in observation fields only.`,
      false,
      compatibilityMode === 'strict' ? 'error' : 'warning',
    );
    return compatibilityMode === 'strict';
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
      coordInputClass: 'unknown',
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
  const assignStationCoordClass = (
    station: StationMap[string],
    stationId: StationId,
    incomingClass: CoordInputClass,
    context: string,
  ): void => {
    const existingClass = station.coordInputClass;
    if (!existingClass) {
      station.coordInputClass = incomingClass;
      return;
    }
    if (existingClass === incomingClass) return;
    station.coordInputClass = 'unknown';
    logs.push(
      `Warning: station ${stationId} has mixed coordinate classes (${existingClass} vs ${incomingClass}) from ${context}; marked as UNKNOWN class.`,
    );
  };
  const pushObservation = <T extends Observation>(obs: T): void => {
    ensureObservationStations(obs);
    if (obs.sourceLine == null) obs.sourceLine = lineNum;
    if (!obs.sourceFile) obs.sourceFile = currentSourceFile;
    const gridMode = currentGridModeForType(obs.type);
    if (obs.gridObsMode == null && gridMode.gridObsMode != null) {
      obs.gridObsMode = gridMode.gridObsMode;
    }
    if (obs.type === 'dist' && obs.gridDistanceMode == null && gridMode.gridDistanceMode != null) {
      obs.gridDistanceMode = gridMode.gridDistanceMode;
    }
    if (obs.inputSpace == null && gridMode.inputSpace != null) {
      obs.inputSpace = gridMode.inputSpace;
    }
    if (obs.type === 'dist' && obs.distanceKind == null && gridMode.distanceKind != null) {
      obs.distanceKind = gridMode.distanceKind;
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
  const isReliableFaceSource = (source: DirectionFaceSource): boolean =>
    source === 'metadata' ||
    source === 'zenith' ||
    (source === 'cluster' && (state.directionFaceReliabilityFromCluster ?? false));
  const parseDirectionFaceHintToken = (token: string | undefined): DirectionFace | null => {
    const raw = token?.trim();
    if (!raw) return null;
    let normalized = raw.toUpperCase().replace(/[^A-Z0-9=]/g, '');
    if (!normalized) return null;
    if (normalized.startsWith('FACE=')) normalized = normalized.slice(5);
    if (normalized.startsWith('FACE')) normalized = normalized.slice(4);
    if (normalized === 'F1') normalized = '1';
    if (normalized === 'F2') normalized = '2';
    if (normalized === '1') return 'face1';
    if (normalized === '2') return 'face2';
    return null;
  };
  const stripDirectionFaceHints = (
    tokens: string[],
  ): { face: DirectionFace | null; tokens: string[] } => {
    let face: DirectionFace | null = null;
    const remaining: string[] = [];
    tokens.forEach((token) => {
      const parsed = parseDirectionFaceHintToken(token);
      if (parsed != null && face == null) {
        face = parsed;
        return;
      }
      remaining.push(token);
    });
    return { face, tokens: remaining };
  };
  const inferFaceFromZenith = (
    zenithRad?: number,
  ): { face: DirectionFace; source: DirectionFaceSource } | null => {
    if (!Number.isFinite(zenithRad as number)) return null;
    const z = wrapTo2Pi(zenithRad as number) * RAD_TO_DEG;
    const windowDeg = Math.max(1, state.directionFaceZenithWindowDeg ?? 45);
    const distanceTo = (center: number): number => {
      let delta = Math.abs(z - center) % 360;
      if (delta > 180) delta = 360 - delta;
      return delta;
    };
    const dFace1 = distanceTo(90);
    const dFace2 = distanceTo(270);
    if (dFace1 <= windowDeg && dFace2 > windowDeg) return { face: 'face1', source: 'zenith' };
    if (dFace2 <= windowDeg && dFace1 > windowDeg) return { face: 'face2', source: 'zenith' };
    return null;
  };
  const splitFaceByCluster = (
    shots: RawDirectionShot[],
  ): { reliable: boolean; centerSeparationDeg?: number; confidence?: number } => {
    if (!(state.directionFaceReliabilityFromCluster ?? false)) return { reliable: false };
    if (shots.length < 4) return { reliable: false };
    const fallbackShots = shots.filter((shot) => shot.faceSource === 'fallback');
    if (fallbackShots.length < 4) return { reliable: false };
    const face1Shots = fallbackShots.filter((shot) => shot.face === 'face1');
    const face2Shots = fallbackShots.filter((shot) => shot.face === 'face2');
    if (!face1Shots.length || !face2Shots.length) return { reliable: false };
    const center1 = weightedCircularMean(face1Shots.map((shot) => shot.obs));
    const center2 = weightedCircularMean(face2Shots.map((shot) => shot.obs));
    const separation = Math.abs(wrapToPi(center1 - center2)) * RAD_TO_DEG;
    const expected = Math.max(1, state.directionFaceClusterSeparationDeg ?? 180);
    const tolerance = Math.max(0.1, state.directionFaceClusterSeparationToleranceDeg ?? 20);
    const confidence = Math.min(face1Shots.length, face2Shots.length) / shots.length;
    const confidenceMin = Math.min(1, Math.max(0, state.directionFaceClusterConfidenceMin ?? 0.35));
    return {
      reliable:
        Math.abs(separation - expected) <= tolerance &&
        confidence >= confidenceMin &&
        face1Shots.length >= 2 &&
        face2Shots.length >= 2,
      centerSeparationDeg: separation,
      confidence,
    };
  };
  const combineSigmaSources = (shots: RawDirectionShot[]): SigmaSource => {
    if (!shots.length) return 'default';
    if (shots.some((s) => s.sigmaSource === 'fixed')) return 'fixed';
    if (shots.every((s) => s.sigmaSource === 'float')) return 'float';
    if (shots.every((s) => s.sigmaSource === 'default')) return 'default';
    return 'explicit';
  };
  const directionFaceSourceRank: DirectionFaceSource[] = [
    'metadata',
    'zenith',
    'cluster',
    'fallback',
    'unresolved',
  ];
  const pickDirectionFaceSource = (shots: RawDirectionShot[]): DirectionFaceSource => {
    const available = new Set<DirectionFaceSource>(shots.map((shot) => shot.faceSource));
    for (const source of directionFaceSourceRank) {
      if (available.has(source)) return source;
    }
    return 'fallback';
  };
  const reduceDirectionBucket = (
    bucketSetId: string,
    occupy: StationId,
    instCode: string,
    shots: RawDirectionShot[],
    normalizeFace2: boolean,
  ): {
    reducedCount: number;
    pairedTargets: number;
    face1Total: number;
    face2Total: number;
  } => {
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
        const obs =
          normalizeFace2 && shot.face === 'face2'
            ? wrapTo2Pi(shot.obs - Math.PI)
            : wrapTo2Pi(shot.obs);
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
        setId: bucketSetId,
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
    return { reducedCount, pairedTargets, face1Total, face2Total };
  };
  const pushRawDirectionBucket = (
    bucketSetId: string,
    occupy: StationId,
    instCode: string,
    shots: RawDirectionShot[],
    normalizeFace2: boolean,
  ): {
    reducedCount: number;
    pairedTargets: number;
    face1Total: number;
    face2Total: number;
  } => {
    const byTargetFaceCounts = new Map<StationId, { face1: number; face2: number }>();
    let face1Total = 0;
    let face2Total = 0;
    shots.forEach((shot) => {
      const obs =
        normalizeFace2 && shot.face === 'face2' ? wrapTo2Pi(shot.obs - Math.PI) : wrapTo2Pi(shot.obs);
      pushObservation({
        id: obsId++,
        type: 'direction',
        instCode,
        setId: bucketSetId,
        at: occupy,
        to: shot.to,
        obs,
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
      const entry = byTargetFaceCounts.get(shot.to) ?? { face1: 0, face2: 0 };
      if (shot.face === 'face1') {
        entry.face1 += 1;
        face1Total += 1;
      } else {
        entry.face2 += 1;
        face2Total += 1;
      }
      byTargetFaceCounts.set(shot.to, entry);
    });
    const pairedTargets = [...byTargetFaceCounts.values()].filter(
      (entry) => entry.face1 > 0 && entry.face2 > 0,
    ).length;
    return {
      reducedCount: shots.length,
      pairedTargets,
      face1Total,
      face2Total,
    };
  };
  const reduceDirectionShots = (
    setId: string,
    occupy: StationId,
    instCode: string,
    shots: RawDirectionShot[],
  ): void => {
    if (!shots.length) return;
    let workingShots = shots.map((shot) => ({ ...shot }));
    const clusterSplit = splitFaceByCluster(workingShots);
    if (clusterSplit.reliable) {
      workingShots = workingShots.map((shot) =>
        shot.faceSource === 'fallback'
          ? { ...shot, faceSource: 'cluster' as DirectionFaceSource, reliableFace: true }
          : shot,
      );
    }
    const mixedFaces =
      new Set(workingShots.map((shot) => shot.face)).size > 1;
    const hasUnreliableFace = workingShots.some((shot) => !shot.reliableFace);
    const unresolvedMixed = mixedFaces && hasUnreliableFace;
    const mode: FaceNormalizationMode = state.faceNormalizationMode ?? 'on';
    const initialFaceSource: DirectionFaceSource = unresolvedMixed
      ? 'unresolved'
      : pickDirectionFaceSource(workingShots);
    let treatmentDecision: DirectionSetTreatmentDecision;
    if (mode === 'off') {
      treatmentDecision = 'split';
    } else if (unresolvedMixed) {
      treatmentDecision = 'unresolved';
    } else if (mode === 'auto') {
      treatmentDecision = mixedFaces ? 'normalized' : 'split';
    } else {
      treatmentDecision = 'normalized';
    }

    let policyOutcome: DirectionSetPolicyOutcome = 'accepted';
    if (treatmentDecision === 'unresolved') {
      policyOutcome = compatibilityMode === 'strict' ? 'strict-reject' : 'legacy-fallback';
      if (policyOutcome === 'strict-reject') {
        const detail = `Direction set ${setId} @ ${occupy}: unresolved mixed-face observations in strict mode (${mode.toUpperCase()})`;
        logs.push(`Error: ${detail}`);
        directionRejectDiagnostics.push({
          setId,
          occupy,
          sourceLine: Math.min(...workingShots.map((shot) => shot.sourceLine)),
          sourceFile: currentSourceFile,
          recordType: 'UNKNOWN',
          reason: 'unresolved-mixed-face',
          faceSource: initialFaceSource,
          treatmentDecision,
          policyOutcome,
          detail,
        });
        directionSetTreatmentDiagnostics.push({
          setId,
          occupy,
          sourceLine: Math.min(...workingShots.map((shot) => shot.sourceLine)),
          sourceFile: currentSourceFile,
          faceSource: initialFaceSource,
          treatmentDecision,
          policyOutcome,
          faceNormalizationMode: mode,
          parseCompatibilityMode: compatibilityMode,
          readingCount: workingShots.length,
          targetCount: new Set(workingShots.map((shot) => shot.to)).size,
          detail,
        });
        return;
      }
      logs.push(
        `Warning: direction set ${setId} @ ${occupy}: unresolved mixed-face observations; legacy fallback applied (split by face).`,
      );
      treatmentDecision = 'split';
    }

    const buckets: Array<{
      bucketSetId: string;
      normalizeFace2: boolean;
      shots: RawDirectionShot[];
    }> = [];
    if (treatmentDecision === 'normalized') {
      buckets.push({ bucketSetId: setId, normalizeFace2: true, shots: workingShots });
    } else {
      const face1Shots = workingShots.filter((shot) => shot.face === 'face1');
      const face2Shots = workingShots.filter((shot) => shot.face === 'face2');
      if (face1Shots.length > 0 && face2Shots.length > 0) {
        buckets.push({ bucketSetId: `${setId}:F1`, normalizeFace2: false, shots: face1Shots });
        buckets.push({ bucketSetId: `${setId}:F2`, normalizeFace2: false, shots: face2Shots });
      } else {
        buckets.push({
          bucketSetId: setId,
          normalizeFace2: false,
          shots: face1Shots.length > 0 ? face1Shots : face2Shots,
        });
      }
    }

    let reducedTotal = 0;
    let pairedTargets = 0;
    let face1Total = 0;
    let face2Total = 0;
    buckets.forEach((bucket) => {
      if (!bucket.shots.length) return;
      const emitted =
        state.directionSetMode === 'raw'
          ? pushRawDirectionBucket(
              bucket.bucketSetId,
              occupy,
              instCode,
              bucket.shots,
              bucket.normalizeFace2,
            )
          : reduceDirectionBucket(
              bucket.bucketSetId,
              occupy,
              instCode,
              bucket.shots,
              bucket.normalizeFace2,
            );
      reducedTotal += emitted.reducedCount;
      pairedTargets += emitted.pairedTargets;
      face1Total += emitted.face1Total;
      face2Total += emitted.face2Total;
    });

    const targetCount = new Set(workingShots.map((shot) => shot.to)).size;
    const finalFaceSource: DirectionFaceSource =
      initialFaceSource === 'unresolved' && policyOutcome === 'legacy-fallback'
        ? 'fallback'
        : initialFaceSource;
    const modeLabel = `mode=${mode.toUpperCase()} decision=${treatmentDecision.toUpperCase()} policy=${policyOutcome.toUpperCase()}`;
    const reductionMode =
      state.directionSetMode === 'raw' ? 'raw rows' : `reduced ${reducedTotal}`;
    logs.push(
      `Direction set ${setId} @ ${occupy}: ${reductionMode} from ${workingShots.length} shots (${modeLabel}, source=${finalFaceSource}, targets=${targetCount}, pairedTargets=${pairedTargets}, F1=${face1Total}, F2=${face2Total})`,
    );
    if (clusterSplit.centerSeparationDeg != null && clusterSplit.confidence != null) {
      logs.push(
        `Direction set ${setId} cluster check: separation=${clusterSplit.centerSeparationDeg.toFixed(2)}deg confidence=${clusterSplit.confidence.toFixed(3)} reliable=${clusterSplit.reliable ? 'YES' : 'NO'}`,
      );
    }
    directionSetTreatmentDiagnostics.push({
      setId,
      occupy,
      sourceLine: Math.min(...workingShots.map((shot) => shot.sourceLine)),
      sourceFile: currentSourceFile,
      faceSource: finalFaceSource,
      treatmentDecision,
      policyOutcome,
      faceNormalizationMode: mode,
      parseCompatibilityMode: compatibilityMode,
      readingCount: workingShots.length,
      targetCount,
      detail: `Direction set ${setId} ${treatmentDecision} (${policyOutcome})`,
    });
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
        sourceFile: currentSourceFile,
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

  for (const entry of lines) {
    lineNum = entry.sourceLine;
    currentSourceFile = entry.sourceFile;
    if (entry.kind === 'include-enter') {
      includeScopeStack.push(
        createIncludeScopeSnapshot({
          state,
          traverseCtx,
          faceMode,
          directionSetCount,
          lastGpsObservation,
          explicitAliases,
          explicitAliasLines,
          aliasRules,
          lostStationIds,
          cloneAliasRule: (rule) => ({ ...rule }),
          cloneRawDirectionShot: (shot) => ({ ...shot }),
        }),
      );
      logs.push(
        `Include scope enter: parent=${entry.sourceFile}:${entry.sourceLine} child=${entry.includeSourceFile}`,
      );
      continue;
    }
    if (entry.kind === 'include-exit') {
      const snapshot = includeScopeStack.pop();
      if (!snapshot) {
        logs.push(
          `Warning: include scope exit without matching enter at ${entry.sourceFile}:${entry.sourceLine}.`,
        );
        continue;
      }
      const restoredScope = restoreIncludeScopeSnapshot({
        stateTarget: state,
        traverseCtxTarget: traverseCtx,
        snapshot,
        normalizeObservationModeState,
        cloneAliasRule: (rule) => ({ ...rule }),
        cloneRawDirectionShot: (shot) => ({ ...shot }),
      });
      faceMode = restoredScope.faceMode;
      directionSetCount = restoredScope.directionSetCount;
      lastGpsObservation = restoredScope.lastGpsObservation;
      explicitAliases = restoredScope.explicitAliases;
      explicitAliasLines = restoredScope.explicitAliasLines;
      aliasRules = restoredScope.aliasRules;
      lostStationIds = restoredScope.lostStationIds;
      logs.push(
        `Include scope exit: restored parent state at ${entry.sourceFile}:${entry.sourceLine} after ${entry.includeSourceFile}`,
      );
      continue;
    }
    if (entry.kind !== 'line') continue;
    const trimmed = entry.raw.trim();
    if (!trimmed) continue;
    const parsedInline = splitInlineCommentAndDescription(trimmed);
    const line = parsedInline.line;
    if (!line || line.startsWith('#')) continue;

    // Inline options
    if (line.startsWith('.') || line.startsWith('/')) {
      const parts = splitWhitespaceTokens(line);
      const normalizedDirective = normalizeInlineDirective(
        parts[0] ?? '',
        state.directiveAbbreviationMode ?? 'unique-prefix',
      );
      if (normalizedDirective.ambiguous) {
        const candidates = normalizedDirective.candidates?.join(', ') ?? '';
        addCompatibilityDiagnostic(
          'STRICT_REJECTED',
          lineNum,
          'INLINE',
          `ambiguous inline option "${parts[0]}"`,
          candidates ? `Use one of: ${candidates}` : undefined,
          false,
          strictDirectivePolicy ? 'error' : 'warning',
        );
        if (!strictDirectivePolicy) {
          logs.push(
            `Warning: ambiguous inline option "${parts[0]}" at line ${lineNum}; candidates: ${candidates}.`,
          );
        }
        continue;
      }
      if (normalizedDirective.unknown || !normalizedDirective.op) {
        addCompatibilityDiagnostic(
          'STRICT_REJECTED',
          lineNum,
          'INLINE',
          `unknown inline option "${parts[0]}"`,
          'Use a full supported inline option name or a unique unambiguous prefix.',
          false,
          strictDirectivePolicy ? 'error' : 'warning',
        );
        if (!strictDirectivePolicy) {
          logs.push(`Warning: unknown inline option "${parts[0]}" at line ${lineNum}; ignored.`);
        }
        continue;
      }
      const op = normalizedDirective.op;
      const coreDirectiveResult = applyCoreDirectiveState({
        op,
        parts,
        lineNum,
        state,
        logs,
        orderExplicit,
        recordDirectiveTransition,
      });
      if (coreDirectiveResult.handled) {
        orderExplicit = coreDirectiveResult.orderExplicit;
        continue;
      }
      if (op === '.CRS') {
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
            `Warning: .GEOID missing mode at line ${lineNum}; expected OFF, ON [model], MODEL, SOURCE, FILE, INTERP, or HEIGHT.`,
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
        if (modeToken === 'SOURCE') {
          const formatToken = (parts[2] || '').toUpperCase();
          if (formatToken === 'BUILTIN' || formatToken === 'INTERNAL') {
            state.geoidSourceFormat = 'builtin';
            state.geoidSourcePath = '';
            logs.push('Geoid source set to BUILTIN');
            continue;
          }
          if (formatToken === 'GTX' || formatToken === 'BYN') {
            state.geoidSourceFormat = formatToken === 'GTX' ? 'gtx' : 'byn';
            const pathToken = parts.slice(3).join(' ').trim();
            state.geoidSourcePath = pathToken;
            logs.push(`Geoid source set to ${formatToken}${pathToken ? ` (${pathToken})` : ''}`);
            continue;
          }
          logs.push(
            `Warning: invalid .GEOID SOURCE option at line ${lineNum}; expected BUILTIN, GTX [path], or BYN [path].`,
          );
          continue;
        }
        if (modeToken === 'FILE' || modeToken === 'PATH') {
          const sourcePath = parts.slice(2).join(' ').trim();
          if (!sourcePath) {
            logs.push(
              `Warning: .GEOID ${modeToken} missing path at line ${lineNum}; expected a GTX/BYN file path.`,
            );
            continue;
          }
          const lowerPath = sourcePath.toLowerCase();
          if (lowerPath.endsWith('.gtx')) state.geoidSourceFormat = 'gtx';
          else if (lowerPath.endsWith('.byn')) state.geoidSourceFormat = 'byn';
          else {
            logs.push(
              `Warning: .GEOID ${modeToken} path at line ${lineNum} does not end with .gtx or .byn; keeping source format ${String(state.geoidSourceFormat ?? 'builtin').toUpperCase()}.`,
            );
          }
          state.geoidSourcePath = sourcePath;
          logs.push(
            `Geoid source path set to ${sourcePath} (format=${String(
              state.geoidSourceFormat ?? 'builtin',
            ).toUpperCase()})`,
          );
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
          `Warning: unrecognized .GEOID option at line ${lineNum}; expected OFF, ON [model], MODEL, SOURCE, FILE, INTERP, or HEIGHT.`,
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

        if (modeToken === 'FRAME' || modeToken === 'FRM') {
          const frame = parseGnssVectorFrameToken(parts[2]);
          if (!frame) {
            logs.push(
              `Warning: invalid .GPS FRAME option at line ${lineNum}; expected GRIDNEU, ENULOCAL, ECEFDELTA, LLHBASELINE, or UNKNOWN.`,
            );
            continue;
          }
          state.gnssVectorFrameDefault = frame;
          if (frame === 'unknown') {
            state.gnssFrameConfirmed = false;
          }
          const confirmToken = (parts[3] || '').trim().toUpperCase();
          if (confirmToken === 'CONFIRM' || confirmToken === 'ON' || confirmToken === 'TRUE') {
            state.gnssFrameConfirmed = true;
          } else if (
            confirmToken === 'OFF' ||
            confirmToken === 'FALSE' ||
            confirmToken === 'RESET'
          ) {
            state.gnssFrameConfirmed = false;
          }
          logs.push(
            `GPS vector frame default set to ${frame} (confirmed=${state.gnssFrameConfirmed ? 'YES' : 'NO'})`,
          );
          continue;
        }

        if (modeToken === 'CONFIRM') {
          const arg = (parts[2] || '').trim().toUpperCase();
          if (!arg || arg === 'ON' || arg === 'TRUE') {
            state.gnssFrameConfirmed = true;
            logs.push('GPS frame confirmation set to ON');
          } else if (arg === 'OFF' || arg === 'FALSE' || arg === 'RESET') {
            state.gnssFrameConfirmed = false;
            logs.push('GPS frame confirmation set to OFF');
          } else {
            logs.push(
              `Warning: invalid .GPS CONFIRM option at line ${lineNum}; expected ON or OFF.`,
            );
          }
          continue;
        }

        const mode = parseGpsVectorModeToken(parts[1]);
        if (!mode) {
          logs.push(
            `Warning: unrecognized .GPS option at line ${lineNum}; expected NETWORK, SIDESHOT, AddHiHt, CHECK, FRAME, or CONFIRM.`,
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
      } else if (op === '.DATA') {
        const mode = (parts[1] || '').toUpperCase();
        if (mode === 'OFF' || mode === '0' || mode === 'FALSE') {
          state.dataInputEnabled = false;
          logs.push('Data input block set to OFF');
        } else if (mode === 'ON' || mode === '1' || mode === 'TRUE') {
          state.dataInputEnabled = true;
          logs.push('Data input block set to ON');
        } else {
          logs.push(`Warning: invalid .DATA option at line ${lineNum}; expected ON or OFF.`);
        }
      } else if (op === '.SEPARATOR') {
        const sepToken = parts[1];
        if (!sepToken) {
          state.stationSeparator = '-';
          logs.push('Station separator reset to "-"');
        } else {
          const separator = sepToken[0];
          state.stationSeparator = separator;
          logs.push(`Station separator set to "${separator}"`);
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
        if (['OFF', 'NONE', 'DEFAULT', 'RESET'].includes((args[0] || '').trim().toUpperCase())) {
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
        const toMeters = linearToMetersFactor();
        const unitLabel = state.units === 'ft' ? 'ft' : 'm';
        const formatSigma = (value: number) => value.toExponential(6);
        if (args.length === 0) {
          const linear = state.qFixLinearSigmaM ?? DEFAULT_QFIX_LINEAR_SIGMA_M;
          const angular = state.qFixAngularSigmaSec ?? DEFAULT_QFIX_ANGULAR_SIGMA_SEC;
          const linearDisplay = state.units === 'ft' ? linear * FT_PER_M : linear;
          logs.push(
            `QFIX unchanged: linear=${formatSigma(linearDisplay)} ${unitLabel}, angular=${formatSigma(angular)}"`,
          );
          continue;
        }
        const mode = args[0].toUpperCase();
        if (mode === 'OFF' || mode === 'NONE' || mode === 'DEFAULT' || mode === 'RESET') {
          state.qFixLinearSigmaM = DEFAULT_QFIX_LINEAR_SIGMA_M;
          state.qFixAngularSigmaSec = DEFAULT_QFIX_ANGULAR_SIGMA_SEC;
          const linearDisplay =
            state.units === 'ft'
              ? DEFAULT_QFIX_LINEAR_SIGMA_M * FT_PER_M
              : DEFAULT_QFIX_LINEAR_SIGMA_M;
          logs.push(
            `QFIX reset to defaults: linear=${formatSigma(linearDisplay)} ${unitLabel}, angular=${formatSigma(DEFAULT_QFIX_ANGULAR_SIGMA_SEC)}"`,
          );
          continue;
        }
        const parsePositive = (token?: string): number | undefined => {
          const parsed = parseFloat(token || '');
          if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
          return parsed;
        };

        let linearM = state.qFixLinearSigmaM ?? DEFAULT_QFIX_LINEAR_SIGMA_M;
        let angularSec = state.qFixAngularSigmaSec ?? DEFAULT_QFIX_ANGULAR_SIGMA_SEC;
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
        if (mode === 'OFF') {
          state.faceNormalizationMode = 'off';
          state.normalize = false;
        } else if (mode === 'AUTO') {
          state.faceNormalizationMode = 'auto';
          state.normalize = true;
          logs.push(
            'Warning: .NORMALIZE AUTO is a WebNet compatibility extension; native parity directives are ON/OFF.',
          );
        } else {
          state.faceNormalizationMode = 'on';
          state.normalize = true;
        }
        logs.push(
          `Normalize set to ${state.normalize} (faceNormalizationMode=${state.faceNormalizationMode?.toUpperCase()})`,
        );
      } else if (op === '.LONSIGN') {
        const mode = (parts[1] || '').toUpperCase();
        state.lonSign = mode === 'WESTPOS' || mode === 'POSW' ? 'west-positive' : 'west-negative';
        logs.push(`Longitude sign set to ${state.lonSign}`);
      } else if (op === '.MULTIPLIER') {
        const rawValue = parts[1];
        if (!rawValue) {
          state.linearMultiplier = 1;
          logs.push('Linear multiplier reset to 1');
        } else {
          const parsed = parseFloat(rawValue);
          if (!Number.isFinite(parsed) || parsed <= 0) {
            logs.push(
              `Warning: invalid .MULTIPLIER value at line ${lineNum}; expected positive number.`,
            );
          } else {
            state.linearMultiplier = parsed;
            logs.push(`Linear multiplier set to ${parsed}`);
          }
        }
      } else if (op === '.ELEVATION') {
        const mode = (parts[1] || '').toUpperCase();
        if (!mode || mode === 'ORTHO' || mode === 'ORTHOMETRIC') {
          state.elevationInputMode = 'orthometric';
          logs.push('Elevation input mode set to ORTHOMETRIC');
        } else if (mode === 'ELLIP' || mode === 'ELLIPSOID' || mode === 'ELLIPSOIDAL') {
          state.elevationInputMode = 'ellipsoid';
          logs.push('Elevation input mode set to ELLIPSOIDAL');
        } else {
          logs.push(
            `Warning: invalid .ELEVATION mode at line ${lineNum}; expected ORTHOMETRIC or ELLIPSOIDAL.`,
          );
        }
      } else if (op === '.PELEVATION') {
        const token = parts[1];
        if (!token) {
          state.projectElevationMeters = defaultParseOptions.projectElevationMeters ?? 0;
          logs.push(
            `Project elevation reset to ${(state.projectElevationMeters ?? 0).toFixed(4)} m`,
          );
        } else {
          const parsed = parseLinearMetersToken(token, state.units);
          if (!Number.isFinite(parsed ?? Number.NaN)) {
            logs.push(
              `Warning: invalid .PELEVATION value at line ${lineNum}; expected numeric value.`,
            );
          } else {
            state.projectElevationMeters = parsed as number;
            logs.push(`Project elevation set to ${(parsed as number).toFixed(4)} m`);
          }
        }
      } else if (op === '.VLEVEL') {
        const token = (parts[1] || '').toUpperCase();
        if (!token || token === 'OFF') {
          state.vLevelMode = 'off';
          state.vLevelNoneStdErrMeters = undefined;
          logs.push('VLEVEL compatibility mode set to OFF');
        } else if (token.startsWith('NONE')) {
          state.vLevelMode = 'none';
          const eqIdx = token.indexOf('=');
          const noneValueToken = eqIdx >= 0 ? token.slice(eqIdx + 1) : (parts[2] ?? '');
          const parsed = parseLinearMetersToken(noneValueToken, state.units);
          state.vLevelNoneStdErrMeters =
            Number.isFinite(parsed ?? Number.NaN) && parsed != null ? parsed : undefined;
          logs.push(
            `VLEVEL compatibility mode set to NONE${state.vLevelNoneStdErrMeters != null ? ` (sigma=${state.vLevelNoneStdErrMeters.toFixed(6)} m)` : ''}`,
          );
        } else if (token === 'FEET' || token === 'FOOT' || token === 'FT') {
          state.vLevelMode = 'feet';
          logs.push('VLEVEL compatibility mode set to FEET');
        } else if (token === 'MILES' || token === 'MI') {
          state.vLevelMode = 'miles';
          logs.push('VLEVEL compatibility mode set to MILES');
        } else if (token === 'METERS' || token === 'METER' || token === 'M') {
          state.vLevelMode = 'meters';
          logs.push('VLEVEL compatibility mode set to METERS');
        } else if (token === 'KILOMETERS' || token === 'KILOMETER' || token === 'KM') {
          state.vLevelMode = 'kilometers';
          logs.push('VLEVEL compatibility mode set to KILOMETERS');
        } else if (token === 'TURNS' || token === 'TURN') {
          state.vLevelMode = 'turns';
          logs.push('VLEVEL compatibility mode set to TURNS');
        } else {
          logs.push(
            `Warning: invalid .VLEVEL option at line ${lineNum}; expected FEET/MILES/METERS/KILOMETERS/TURNS/NONE/OFF.`,
          );
        }
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
        const toMeters = linearToMetersFactor();
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
      } else if (
        op === '.COPYINPUT' ||
        op === '.ELLIPSE' ||
        op === '.RELATIVE' ||
        op === '.PTOLERANCE'
      ) {
        if (!compatibilityAcceptedNoOps.has(op)) {
          compatibilityAcceptedNoOps.add(op);
          logs.push(
            `Compatibility: ${op} accepted at line ${lineNum} but behavior is not yet applied in this version.`,
          );
        }
      } else if (op === '.INCLUDE') {
        // Includes are expanded in a pre-parse pass.
        logs.push(`Include directive already expanded at line ${lineNum}.`);
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
    if (state.dataInputEnabled === false) {
      continue;
    }

    try {
      if (code === 'I') {
        const instCode = parts[1];
        if (state.preferExternalInstruments && instCode && existingInstruments[instCode]) {
          continue;
        }
        const instrumentTokens = parts.slice(2);
        const numericStart = instrumentTokens.findIndex((token) => isNumericToken(token));
        const numericTokens =
          numericStart >= 0 ? instrumentTokens.slice(numericStart) : ([] as string[]);
        const descTokens =
          numericStart >= 0 ? instrumentTokens.slice(0, numericStart) : instrumentTokens;
        let desc = descTokens.join(' ').trim();
        if (
          (desc.startsWith('"') && desc.endsWith('"')) ||
          (desc.startsWith("'") && desc.endsWith("'"))
        ) {
          desc = desc.slice(1, -1);
        }
        desc = desc.replace(/-/g, ' ');
        const numeric = numericTokens
          .filter((token) => isNumericToken(token))
          .map((token) => parseFloat(token));
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
      } else if (
        handleControlRecord({
          code,
          parts,
          lineNum,
          state,
          stations,
          logs,
          isNumericToken,
          parseFixityTokens,
          parseConstraintCorrToken,
          applyFixities,
          clearStationConstraintComponent,
          setStationConstraintMode,
          resolveStationConstraintMode,
          assignStationCoordClass,
          linearToMetersFactor,
          toDegrees,
          activeCrsProjectionModel,
        })
      ) {
        // handled by parseControlRecords.ts
      } else {
        const conventionalObsIdRef = { current: obsId };
        const handledConventionalPrimitive = handleConventionalPrimitiveRecord({
          code,
          parts,
          lineNum,
          state,
          stations,
          instrumentLibrary,
          logs,
          obsIdRef: conventionalObsIdRef,
          compatibilityMode,
          preanalysisMode,
          addCompatibilityDiagnostic,
          rejectNumericStationTokens,
          parseFromTo,
          splitStationPairToken,
          extractSigmaTokens,
          extractHiHt,
          parseObservedLinearToken,
          parseObservedAngleToken,
          linearToMetersFactor,
          effectiveDistanceMode,
          scoreDistanceCandidate,
          looksLikeNumericMeasurement,
          resolveLinearSigma: (token, defaultSigma) =>
            resolveLinearSigma(token as SigmaToken | undefined, defaultSigma),
          resolveAngularSigma: (token, defaultSigma) =>
            resolveAngularSigma(token as SigmaToken | undefined, defaultSigma),
          resolveLevelingSigma: (token, inst, spanMeters, contextCode, sourceLine) =>
            resolveLevelingSigma(
              token as SigmaToken | undefined,
              inst,
              spanMeters,
              contextCode,
              sourceLine,
            ),
          defaultDistanceSigma,
          defaultHorizontalAngleSigmaSec,
          defaultZenithSigmaSec,
          azimuthFromTo,
          wrapToPi,
          applyPlanRotation,
          pushObservation,
          face2Weight: FACE2_WEIGHT,
          amodeAutoMaxDirRad: AMODE_AUTO_MAX_DIR_RAD,
          amodeAutoMarginRad: AMODE_AUTO_MARGIN_RAD,
        });
        if (handledConventionalPrimitive) {
          obsId = conventionalObsIdRef.current;
        } else if (code === 'BM') {
        // Bearing + measurements. Bearing stored/logged; dist parsed; zenith or deltaH captured based on mode
        const from = parts[1];
        const to = parts[2];
        const bearing = parts[3];
        const toMeters = linearToMetersFactor();
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
        const bmZenParsed =
          state.deltaMode === 'horiz' || !vert ? null : parseObservedAngleToken(vert, 'dd');
        let bmDistObs = distParsed.value;
        let bmDistStdDev = distResolved.sigma * toMeters;
        let bmDistMode: 'slope' | 'horiz' = effectiveDistanceMode();
        if (state.threeReduceMode && state.deltaMode === 'slope' && bmZenParsed?.valid) {
          const zenSigmaSec = resolveAngularSigma(sigVert, defaultZenithSigmaSec(inst)).sigma;
          const sigmaZ = zenSigmaSec * SEC_TO_RAD;
          bmDistObs = distParsed.value * Math.sin(bmZenParsed.value);
          bmDistStdDev = Math.sqrt(
            (Math.sin(bmZenParsed.value) * distResolved.sigma * toMeters) ** 2 +
              (distParsed.value * Math.cos(bmZenParsed.value) * sigmaZ) ** 2,
          );
          bmDistMode = 'horiz';
        }
        pushObservation({
          id: obsId++,
          type: 'dist',
          subtype: 'ts',
          instCode,
          setId: '',
          from,
          to,
          obs: bmDistObs,
          planned: distParsed.planned,
          stdDev: bmDistStdDev,
          sigmaSource: distResolved.source,
          mode: bmDistMode,
        });
        if (state.deltaMode === 'horiz' && vert) {
          const dhParsed = parseObservedLinearToken(vert, toMeters);
          if (!dhParsed.valid) {
            logs.push(
              `Invalid BM vertical difference at line ${lineNum}, skipping vertical component.`,
            );
          } else {
            const dhResolved = resolveLevelingSigma(
              sigVert,
              inst,
              Math.abs(distParsed.value),
              'BM',
              lineNum,
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
        } else if (vert && !state.threeReduceMode) {
          const zenParsed = bmZenParsed ?? parseObservedAngleToken(vert, 'dd');
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
        } else if (vert && state.threeReduceMode) {
          logs.push(
            `3REDUCE active at line ${lineNum}: BM zenith component excluded from equations.`,
          );
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
        const stations = splitStationPairToken(parts[1], state.stationSeparator ?? '-');
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
          const toMeters = linearToMetersFactor();
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
          const vertResolved =
            state.deltaMode === 'horiz'
              ? resolveLevelingSigma(sigmas[2], inst, Math.abs(distParsed.value), 'M', lineNum)
              : resolveAngularSigma(sigmas[2], defaultZenithSigmaSec(inst));
          const angRad = angParsed.value;
          const faceWeight =
            angRad >= Math.PI ? angResolved.sigma * FACE2_WEIGHT : angResolved.sigma;
          let distObs = distParsed.value;
          let distStdDev = distResolved.sigma * toMeters;
          let distMode: 'slope' | 'horiz' = effectiveDistanceMode();
          if (
            (state.coordMode === '2D' || state.threeReduceMode) &&
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
          } else if (vert && !state.threeReduceMode) {
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
          } else if (vert && state.threeReduceMode) {
            logs.push(
              `3REDUCE active at line ${lineNum}: M zenith component excluded from equations.`,
            );
          }
        }
      } else if (code === 'B') {
        const { from, to, nextIndex } = parseFromTo(parts, 1, state.stationSeparator ?? '-');
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
        if (state.mapMode !== 'off') {
          const token1 = parts[1];
          const token2 = parts[2];
          const token3 = parts[3];
          const maybeBackBearing = parseAngleTokenRad(token1, state, 'dd');
          if (state.mapMode === 'anglecalc' && Number.isFinite(maybeBackBearing) && token2) {
            traverseCtx.occupy = token3;
            traverseCtx.backsight = token2;
            traverseCtx.backsightRefAngle = wrapTo2Pi(maybeBackBearing);
            logs.push(
              `Map traverse start: occupy=${traverseCtx.occupy || '(pending)'} backsight=${traverseCtx.backsight} back-bearing=${(traverseCtx.backsightRefAngle * RAD_TO_DEG).toFixed(6)}deg`,
            );
          } else {
            traverseCtx.occupy = token1;
            traverseCtx.backsight = token2;
            traverseCtx.backsightRefAngle = Number.isFinite(parseAngleTokenRad(token3, state, 'dd'))
              ? wrapTo2Pi(parseAngleTokenRad(token3, state, 'dd'))
              : undefined;
            logs.push(
              `Map traverse start at ${traverseCtx.occupy || '(pending)'} backsight ${traverseCtx.backsight || '(none)'}`,
            );
          }
          faceMode = 'unknown';
          continue;
        }
        traverseCtx.occupy = parts[1];
        traverseCtx.backsight = parts[2];
        traverseCtx.backsightRefAngle = undefined;
        faceMode = 'unknown';
        logs.push(`Traverse start at ${traverseCtx.occupy} backsight ${traverseCtx.backsight}`);
      } else if (code === 'T' || code === 'TE') {
        // Traverse legs: angle + dist + vertical relative to current occupy/backsight
        const mapModeActive = state.mapMode !== 'off';
        if (
          (!mapModeActive && (!traverseCtx.occupy || !traverseCtx.backsight)) ||
          (!traverseCtx.occupy && mapModeActive)
        ) {
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
          traverseCtx.backsightRefAngle = undefined;
          faceMode = 'unknown';
          continue;
        }
        const toMeters = linearToMetersFactor();
        const instCode = state.currentInstrument ?? '';
        const inst = instCode ? instrumentLibrary[instCode] : undefined;
        if (mapModeActive) {
          const bearingToken = parts[2];
          const bearingParsed = parseObservedAngleToken(bearingToken, 'dd');
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
          if (
            !bearingParsed.valid ||
            !distParsed.valid ||
            (vert && vertParsed && !vertParsed.valid)
          ) {
            logs.push(`Invalid map traverse record at line ${lineNum}, skipping ${code}.`);
            continue;
          }
          const { sigmas } = extractSigmaTokens(parts.slice(5), 3);
          const bearingResolved = resolveAngularSigma(sigmas[0], defaultAzimuthSigmaSec(inst));
          const distResolved = resolveLinearSigma(
            sigmas[1],
            defaultDistanceSigma(
              inst,
              distParsed.planned ? 0 : parseFloat(parts[3] || '0'),
              state.edmMode,
              0,
            ),
          );
          const vertResolved =
            state.deltaMode === 'horiz'
              ? resolveLevelingSigma(sigmas[2], inst, Math.abs(distParsed.value), code, lineNum)
              : resolveAngularSigma(sigmas[2], defaultZenithSigmaSec(inst));
          const bearingRad = applyPlanRotation(bearingParsed.value, state);
          pushObservation({
            id: obsId++,
            type: 'bearing',
            instCode,
            from: traverseCtx.occupy as string,
            to,
            obs: bearingRad,
            planned: bearingParsed.planned,
            stdDev: bearingResolved.sigma * SEC_TO_RAD,
            sigmaSource: bearingResolved.source,
          });
          if (
            state.mapMode === 'anglecalc' &&
            traverseCtx.backsight &&
            Number.isFinite(traverseCtx.backsightRefAngle ?? Number.NaN)
          ) {
            const turned = wrapTo2Pi(bearingRad - (traverseCtx.backsightRefAngle as number));
            const angleResolved = resolveAngularSigma(
              sigmas[0],
              defaultHorizontalAngleSigmaSec(inst),
            );
            pushObservation({
              id: obsId++,
              type: 'angle',
              instCode,
              setId: code,
              at: traverseCtx.occupy as string,
              from: traverseCtx.backsight,
              to,
              obs: turned,
              planned: bearingParsed.planned,
              stdDev: angleResolved.sigma * SEC_TO_RAD,
              sigmaSource: angleResolved.source,
            });
          }
          if (distParsed.planned || distParsed.value > 0) {
            pushObservation({
              id: obsId++,
              type: 'dist',
              subtype: 'ts',
              instCode,
              setId: code,
              from: traverseCtx.occupy as string,
              to,
              obs: distParsed.value,
              planned: distParsed.planned,
              stdDev: distResolved.sigma * toMeters,
              sigmaSource: distResolved.source,
              mode: 'horiz',
            });
          }
          if (vert) {
            if (state.deltaMode === 'horiz') {
              pushObservation({
                id: obsId++,
                type: 'lev',
                instCode,
                setId: code,
                from: traverseCtx.occupy as string,
                to,
                obs: (vertParsed as { value: number }).value,
                planned: Boolean(vertParsed?.planned),
                lenKm: 0,
                stdDev: vertResolved.sigma * toMeters,
                sigmaSource: vertResolved.source,
              });
            } else {
              if (state.threeReduceMode !== true) {
                pushObservation({
                  id: obsId++,
                  type: 'zenith',
                  instCode,
                  setId: code,
                  from: traverseCtx.occupy as string,
                  to,
                  obs: (vertParsed as { value: number }).value,
                  planned: Boolean(vertParsed?.planned),
                  stdDev: vertResolved.sigma * SEC_TO_RAD,
                  sigmaSource: vertResolved.source,
                });
              }
            }
          }
          traverseCtx.backsight = traverseCtx.occupy;
          traverseCtx.occupy = to;
          traverseCtx.backsightRefAngle = wrapTo2Pi(bearingRad + Math.PI);
        } else {
          const ang = parts[2];
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
          const vertResolved =
            state.deltaMode === 'horiz'
              ? resolveLevelingSigma(sigmas[2], inst, Math.abs(distParsed.value), code, lineNum)
              : resolveAngularSigma(sigmas[2], defaultZenithSigmaSec(inst));
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
                at: traverseCtx.occupy as string,
                from: traverseCtx.backsight as string,
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
              at: traverseCtx.occupy as string,
              from: traverseCtx.backsight as string,
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
              from: traverseCtx.occupy as string,
              to,
              obs: distParsed.value,
              planned: distParsed.planned,
              stdDev: distResolved.sigma * toMeters,
              sigmaSource: distResolved.source,
              mode: effectiveDistanceMode(),
            });
          }
          if (vert) {
            if (state.deltaMode === 'horiz') {
              pushObservation({
                id: obsId++,
                type: 'lev',
                instCode,
                setId: code,
                from: traverseCtx.occupy as string,
                to,
                obs: (vertParsed as { value: number }).value,
                planned: Boolean(vertParsed?.planned),
                lenKm: 0,
                stdDev: vertResolved.sigma * toMeters,
                sigmaSource: vertResolved.source,
              });
            } else if (state.threeReduceMode !== true) {
              pushObservation({
                id: obsId++,
                type: 'zenith',
                instCode,
                setId: code,
                from: traverseCtx.occupy as string,
                to,
                obs: (vertParsed as { value: number }).value,
                planned: Boolean(vertParsed?.planned),
                stdDev: vertResolved.sigma * SEC_TO_RAD,
                sigmaSource: vertResolved.source,
              });
            }
          }
        }
        if (code === 'TE') {
          logs.push(`Traverse end to ${to}`);
          traverseCtx.occupy = undefined;
          traverseCtx.backsight = undefined;
          traverseCtx.backsightRefAngle = undefined;
          faceMode = 'unknown';
        } else {
          const prevOccupy = traverseCtx.occupy;
          traverseCtx.occupy = to;
          traverseCtx.backsight = prevOccupy;
          if (state.mapMode !== 'off' && traverseCtx.backsightRefAngle == null) {
            traverseCtx.backsightRefAngle = undefined;
          }
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
            sourceFile: currentSourceFile,
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

        const toMeters = linearToMetersFactor();
        const distParsed = code === 'DM' ? parseObservedLinearToken(parts[3], toMeters) : null;
        let vert: string | undefined;
        let tailTokens: string[] = [];
        if (code === 'DM') {
          const candidate = parts[4];
          const candidateIsFace = parseDirectionFaceHintToken(candidate) != null;
          vert = candidate && !candidateIsFace ? candidate : undefined;
          tailTokens = parts.slice(vert ? 5 : 4);
        } else {
          tailTokens = parts.slice(3);
        }
        const strippedFaceHints = stripDirectionFaceHints(tailTokens);
        tailTokens = strippedFaceHints.tokens;
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
        const sigmaCount = code === 'DM' ? 3 : 1;
        const { sigmas } = extractSigmaTokens(tailTokens, sigmaCount);

        const inst = traverseCtx.dirInstCode
          ? instrumentLibrary[traverseCtx.dirInstCode]
          : undefined;
        const dirResolved = resolveAngularSigma(sigmas[0], defaultDirectionSigmaSec(inst));
        const stdAng = dirResolved.sigma;

        const zenithCandidate =
          code === 'DM' &&
          state.deltaMode !== 'horiz' &&
          vertParsed != null &&
          !(vertParsed as { planned?: boolean }).planned
            ? (vertParsed as { value: number }).value
            : undefined;
        const inferredFace = inferFaceFromZenith(zenithCandidate);
        const fallbackFace: DirectionFace = angRad >= Math.PI ? 'face2' : 'face1';
        const explicitFace = strippedFaceHints.face;
        const thisFace: DirectionFace = explicitFace ?? inferredFace?.face ?? fallbackFace;
        const faceSource: DirectionFaceSource =
          explicitFace != null ? 'metadata' : inferredFace?.source ?? 'fallback';
        const raw: RawDirectionShot = {
          to,
          obs: angRad,
          stdDev: stdAng * SEC_TO_RAD,
          sigmaSource: dirResolved.source,
          sourceLine: lineNum,
          face: thisFace,
          faceSource,
          reliableFace: isReliableFaceSource(faceSource),
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
            mode: effectiveDistanceMode(),
          });
          if (vert) {
            if (state.deltaMode === 'horiz') {
              const dhResolved = resolveLevelingSigma(
                sigmas[2],
                inst,
                Math.abs(distParsed.value),
                'DM',
                lineNum,
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
            } else if (!state.threeReduceMode) {
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
            } else {
              logs.push(
                `3REDUCE active at line ${lineNum}: DM zenith component excluded from equations.`,
              );
            }
          }
        }
      } else if (code === 'DE') {
        if (traverseCtx.dirSetId) flushDirectionSet('DE');
        logs.push('Direction set end');
      } else if (code === 'SS') {
        // Sideshot: dist + optional vertical
        const stationTokens = parseSsStationTokens(parts, state.stationSeparator ?? '-');
        if (!stationTokens) {
          logs.push(`Invalid sideshot station token at line ${lineNum}, skipping`);
          continue;
        }
        const from = stationTokens.at;
        const to = stationTokens.to;
        const explicitBacksight =
          stationTokens.mode === 'at-from-to' ? stationTokens.explicitBacksight : undefined;
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
        const hasUnprefixedAngle =
          !isAzPrefix && !isHzPrefix && Number.isFinite(unprefixedAngleRad);
        const isDmsAngle = firstTokenRaw.includes('-');
        const isSetupAngleByPattern =
          stationTokens.mode === 'legacy' &&
          hasUnprefixedAngle &&
          isDmsAngle &&
          Number.isFinite(parseFloat(parts[angleTokenIndex + 1] || '')) &&
          (!!traverseCtx.backsight || !!explicitBacksight);
        const angleMode: 'none' | 'az' | 'hz' = isAzPrefix
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
        const toMeters = linearToMetersFactor();
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
          mode: effectiveDistanceMode(),
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
            const dhResolved = resolveLevelingSigma(
              sigmaVertToken,
              inst,
              dist * toMeters,
              'SS',
              lineNum,
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
        const toMeters = linearToMetersFactor();
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
            logs.push(
              `Warning: extra GS tokens ignored at line ${lineNum} (expected up to sigmaH).`,
            );
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
        const toMeters = linearToMetersFactor();
        const candidates: Array<{
          instCode: string;
          from: string;
          to: string;
          explicitForm: boolean;
          numericStart: number;
          dEParsed: { value: number; planned: boolean; valid: boolean };
          dNParsed: { value: number; planned: boolean; valid: boolean };
        }> = [];
        const pushGpsCandidate = (
          instCode: string,
          from: string,
          to: string,
          numericStart: number,
          explicitForm: boolean,
        ) => {
          if (!from || !to) return;
          const dEParsed = parseObservedLinearToken(parts[numericStart], toMeters);
          const dNParsed = parseObservedLinearToken(parts[numericStart + 1], toMeters);
          if (!dEParsed.valid || !dNParsed.valid) return;
          candidates.push({
            instCode,
            from,
            to,
            explicitForm,
            numericStart,
            dEParsed,
            dNParsed,
          });
        };
        pushGpsCandidate(parts[1] ?? '', parts[2] ?? '', parts[3] ?? '', 4, true);
        pushGpsCandidate('', parts[1] ?? '', parts[2] ?? '', 3, false);
        if (candidates.length === 0) {
          logs.push(`Invalid GPS vector at line ${lineNum}, skipping.`);
          continue;
        }
        const scored = candidates.map((candidate) => {
          let score = 0;
          if (stations[candidate.from]) score += 2;
          if (stations[candidate.to]) score += 2;
          if (candidate.explicitForm) score += 1;
          if (candidate.instCode && instrumentLibrary[candidate.instCode]) score += 2;
          if (candidate.explicitForm && candidate.instCode && !stations[candidate.instCode])
            score += 1;
          if (
            looksLikeNumericMeasurement(candidate.from) ||
            looksLikeNumericMeasurement(candidate.to)
          ) {
            score -= 12;
          }
          return { candidate, score };
        });
        scored.sort((a, b) => b.score - a.score);
        const best = scored[0];
        const tie = scored.length > 1 && scored[1].score === best.score;
        if (tie) {
          const rewrite =
            'Use explicit form: G <inst?> <from> <to> <dE> <dN> [sigmaE sigmaN [corr]].';
          if (compatibilityMode === 'strict') {
            addCompatibilityDiagnostic(
              'ROLE_AMBIGUITY',
              lineNum,
              'G',
              'multiple valid G-record interpretations were found.',
              rewrite,
              false,
              'error',
            );
            continue;
          }
          addCompatibilityDiagnostic(
            'ROLE_AMBIGUITY',
            lineNum,
            'G',
            'multiple valid G-record interpretations were found; applied legacy fallback.',
            rewrite,
            true,
          );
        }
        const chosen = best.candidate;
        const instCode = chosen.instCode;
        const from = chosen.from;
        const to = chosen.to;
        if (
          rejectNumericStationTokens('G', lineNum, [
            { role: 'FROM', value: from },
            { role: 'TO', value: to },
          ])
        ) {
          continue;
        }
        const { sigmas, rest } = extractSigmaTokens(parts.slice(chosen.numericStart + 2), 2);
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
          gnssVectorFrame: state.gnssVectorFrameDefault ?? 'gridNEU',
          gnssFrameConfirmed: state.gnssFrameConfirmed ?? false,
          gpsAntennaHiM: state.gpsAddHiHtEnabled ? (state.gpsAddHiHtHiM ?? 0) : undefined,
          gpsAntennaHtM: state.gpsAddHiHtEnabled ? (state.gpsAddHiHtHtM ?? 0) : undefined,
          instCode,
          from,
          to,
          planned: chosen.dEParsed.planned || chosen.dNParsed.planned,
          obs: {
            dE: chosen.dEParsed.value,
            dN: chosen.dNParsed.value,
          },
          stdDev: state.units === 'ft' ? sigmaMean / FT_PER_M : sigmaMean,
          stdDevE: state.units === 'ft' ? sigmaE / FT_PER_M : sigmaE,
          stdDevN: state.units === 'ft' ? sigmaN / FT_PER_M : sigmaN,
          sigmaSourceE: sigmaEResolved.source,
          sigmaSourceN: sigmaNResolved.source,
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
        const toMeters = linearToMetersFactor();
        const candidates: Array<{
          instCode: string;
          from: string;
          to: string;
          explicitForm: boolean;
          valueStart: number;
          dHParsed: { value: number; planned: boolean; valid: boolean };
        }> = [];
        const pushLevelCandidate = (
          instCode: string,
          from: string,
          to: string,
          valueStart: number,
          explicitForm: boolean,
        ) => {
          if (!from || !to) return;
          const dHParsed = parseObservedLinearToken(parts[valueStart], toMeters);
          if (!dHParsed.valid) return;
          candidates.push({ instCode, from, to, explicitForm, valueStart, dHParsed });
        };
        pushLevelCandidate(parts[1] ?? '', parts[2] ?? '', parts[3] ?? '', 4, true);
        pushLevelCandidate(state.currentInstrument ?? '', parts[1] ?? '', parts[2] ?? '', 3, false);
        if (candidates.length === 0) {
          logs.push(`Invalid leveling observation at line ${lineNum}, skipping.`);
          continue;
        }
        const scored = candidates.map((candidate) => {
          let score = 0;
          if (stations[candidate.from]) score += 2;
          if (stations[candidate.to]) score += 2;
          if (candidate.explicitForm) score += 1;
          if (candidate.instCode && instrumentLibrary[candidate.instCode]) score += 2;
          if (candidate.explicitForm && candidate.instCode && !stations[candidate.instCode])
            score += 1;
          if (
            looksLikeNumericMeasurement(candidate.from) ||
            looksLikeNumericMeasurement(candidate.to)
          ) {
            score -= 12;
          }
          return { candidate, score };
        });
        scored.sort((a, b) => b.score - a.score);
        const best = scored[0];
        const tie = scored.length > 1 && scored[1].score === best.score;
        if (tie) {
          const rewrite = 'Use explicit form: L <inst?> <from> <to> <dH> <lenKm> [sigma].';
          if (compatibilityMode === 'strict') {
            addCompatibilityDiagnostic(
              'ROLE_AMBIGUITY',
              lineNum,
              'L',
              'multiple valid L-record interpretations were found.',
              rewrite,
              false,
              'error',
            );
            continue;
          }
          addCompatibilityDiagnostic(
            'ROLE_AMBIGUITY',
            lineNum,
            'L',
            'multiple valid L-record interpretations were found; applied legacy fallback.',
            rewrite,
            true,
          );
        }
        const chosen = best.candidate;
        const instCode = chosen.instCode;
        const from = chosen.from;
        const to = chosen.to;
        if (
          rejectNumericStationTokens('L', lineNum, [
            { role: 'FROM', value: from },
            { role: 'TO', value: to },
          ])
        ) {
          continue;
        }
        const lenRaw = parseFloat(parts[chosen.valueStart + 1] || '0');
        const lenKm =
          Number.isFinite(lenRaw) && lenRaw > 0
            ? state.units === 'ft'
              ? lenRaw / FT_PER_M / 1000
              : lenRaw
            : 0;
        const sigmaToken = parseSigmaToken(parts[chosen.valueStart + 2]) ?? undefined;
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
          obs: chosen.dHParsed.value,
          planned: chosen.dHParsed.planned,
          lenKm,
          stdDev: sigma,
          sigmaSource: levelResolved.source,
        };
        pushObservation(obs);
      } else {
        logs.push(`Unrecognized code "${code}" at line ${lineNum}, skipping`);
      }
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
      if (target.constraintModeX == null && incoming.constraintModeX != null)
        target.constraintModeX = incoming.constraintModeX;
      if (target.constraintModeY == null && incoming.constraintModeY != null)
        target.constraintModeY = incoming.constraintModeY;
      if (target.constraintModeH == null && incoming.constraintModeH != null)
        target.constraintModeH = incoming.constraintModeH;
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
  const descriptionReconcileMode = (state.descriptionReconcileMode ??
    defaultParseOptions.descriptionReconcileMode ??
    'first') as 'first' | 'append';
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
  if (directionSetTreatmentDiagnostics.length > 0) {
    logs.push(`Direction set treatment diagnostics: ${directionSetTreatmentDiagnostics.length}`);
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
  normalizeObservationModeState(state);
  directiveNoEffectWarnings.push(
    ...finalizeDirectiveTransitions({
      directiveTransitions,
      observations,
      lines,
      splitInlineCommentAndDescription,
    }),
  );
  state.directiveTransitions = directiveTransitions;
  state.directiveNoEffectWarnings = directiveNoEffectWarnings;
  state.parsedUsageSummary = summarizeReductionUsage(observations);
  state.usedInSolveUsageSummary = undefined;
  state.compatibilityAcceptedNoOpDirectives = [...compatibilityAcceptedNoOps].sort();
  state.directionSetTreatmentDiagnostics = directionSetTreatmentDiagnostics
    .slice()
    .sort((a, b) => a.setId.localeCompare(b.setId) || a.occupy.localeCompare(b.occupy));
  state.parseCompatibilityDiagnostics = compatibilityDiagnostics;
  state.ambiguousCount = ambiguousCount;
  state.legacyFallbackCount = legacyFallbackCount;
  state.strictRejectCount = strictRejectCount;
  state.rewriteSuggestionCount = rewriteSuggestionCount;
  if ((state.includeErrors?.length ?? 0) > 0) {
    logs.push(
      `Include errors: ${state.includeErrors?.length} (missing/cycle/depth issues make this run invalid).`,
    );
  }
  directiveNoEffectWarnings.forEach((warning) => {
    logs.push(
      `Warning: ${warning.directive} at line ${warning.line} had no effect (${warning.reason}).`,
    );
  });
  logs.push(
    `Parse compatibility: mode=${compatibilityMode}, ambiguous=${ambiguousCount}, fallbacks=${legacyFallbackCount}, strictRejects=${strictRejectCount}, rewrites=${rewriteSuggestionCount}`,
  );
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
