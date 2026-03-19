import { dmsToRad, RAD_TO_DEG, SEC_TO_RAD } from './angles';
import { DEFAULT_CANADA_CRS_ID } from './crsCatalog';
import { handleConventionalPrimitiveRecord } from './parseConventionalObservationRecords';
import { handleControlRecord } from './parseControlRecords';
import { handleDirectionSetRecord } from './parseDirectionSetRecords';
import { dispatchParseDirective } from './parseDirectiveRegistry';
import {
  createDirectionSetWorkflow,
  type RawDirectionShot,
} from './parseDirectionSetWorkflow';
import { handleTraverseRecord } from './parseTraverseRecords';
import {
  createIncludeScopeSnapshot,
  restoreIncludeScopeSnapshot,
  type IncludeScopeSnapshot,
} from './parseIncludeScope';
import {
  directiveTransitionStateFromParseState,
  gridDistanceModeToReductionDistanceKind,
  normalizeObservationModeState,
} from './parseDirectiveState';
import { expandInputWithIncludes } from './parseIncludes';
import { finalizeParsePostProcessing } from './parsePostProcessing';
import {
  createParseSigmaResolvers,
  defaultAzimuthSigmaSec,
  defaultDirectionSigmaSec,
  defaultDistanceSigma,
  defaultElevDiffSigma,
  defaultHorizontalAngleSigmaSec,
  defaultZenithSigmaSec,
  extractSigmaTokens,
  parseSigmaToken,
  type SigmaToken,
} from './parseSigmaResolution';
import {
  DEFAULT_QFIX_ANGULAR_SIGMA_SEC,
  DEFAULT_QFIX_LINEAR_SIGMA_M,
} from './defaults';
import {
  cloneParseAliasRule,
  createParseAliasPipeline,
  type ParseAliasRule,
} from './parseAliasPipeline';
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
  ParseCompatibilityDiagnostic,
  ParseCompatibilityDiagnosticCode,
  ParseCompatibilityMode,
  FaceNormalizationMode,
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
  const descriptionTraceEntries: NonNullable<ParseOptions['descriptionTrace']> = [];
  let lostStationIds = new Set<StationId>((state.lostStationIds ?? []).map((id) => `${id}`));
  const includeScopeStack: IncludeScopeSnapshot<
    GpsObservation,
    StationId,
    ParseAliasRule,
    RawDirectionShot
  >[] = [];
  const {
    resolveLinearSigma,
    resolveAngularSigma,
    resolveLevelingSigma,
  } = createParseSigmaResolvers(state, logs);
  let lineNum = 0;
  const aliasPipeline = createParseAliasPipeline({
    logs,
    getCurrentLine: () => lineNum,
    splitCommaTokens,
  });

  aliasPipeline.preloadClusterApprovedMerges(state.clusterApprovedMerges ?? []);

  const expanded = expandInputWithIncludes(input, opts, logs, {
    splitInlineCommentAndDescription,
    splitWhitespaceTokens,
    normalizeInlineDirective,
  });
  const lines = expanded.lines;
  state.includeTrace = expanded.includeTrace;
  state.includeErrors = expanded.includeErrors;
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
  const directionSetWorkflow = createDirectionSetWorkflow({
    state,
    logs,
    compatibilityMode,
    getCurrentLine: () => lineNum,
    getCurrentSourceFile: () => currentSourceFile,
    nextObservationId: () => obsId++,
    pushObservation,
    directionRejectDiagnostics,
    directionSetTreatmentDiagnostics,
  });
  const isReliableFaceSource = directionSetWorkflow.isReliableFaceSource;
  const parseDirectionFaceHintToken = directionSetWorkflow.parseDirectionFaceHintToken;
  const stripDirectionFaceHints = directionSetWorkflow.stripDirectionFaceHints;
  const inferFaceFromZenith = directionSetWorkflow.inferFaceFromZenith;
  const flushDirectionSet = (reason: string): void => {
    directionSetWorkflow.flushDirectionSet(traverseCtx, reason);
    faceMode = 'unknown';
  };

  for (const entry of lines) {
    lineNum = entry.sourceLine;
    currentSourceFile = entry.sourceFile;
    if (entry.kind === 'include-enter') {
      const aliasScopedState = aliasPipeline.getScopedState();
      includeScopeStack.push(
        createIncludeScopeSnapshot({
          state,
          traverseCtx,
          faceMode,
          directionSetCount,
          lastGpsObservation,
          explicitAliases: aliasScopedState.explicitAliases,
          explicitAliasLines: aliasScopedState.explicitAliasLines,
          aliasRules: aliasScopedState.aliasRules,
          lostStationIds,
          cloneAliasRule: cloneParseAliasRule,
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
        cloneAliasRule: cloneParseAliasRule,
        cloneRawDirectionShot: (shot) => ({ ...shot }),
      });
      faceMode = restoredScope.faceMode;
      directionSetCount = restoredScope.directionSetCount;
      lastGpsObservation = restoredScope.lastGpsObservation;
      aliasPipeline.restoreScopedState({
        explicitAliases: restoredScope.explicitAliases,
        explicitAliasLines: restoredScope.explicitAliasLines,
        aliasRules: restoredScope.aliasRules,
      });
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
      const directiveResult = dispatchParseDirective({
        op,
        parts,
        lineNum,
        state,
        logs,
        orderExplicit,
        recordDirectiveTransition,
        linearToMetersFactor,
        parseAngleTokenRad,
        parseLinearMetersToken,
        wrapTo2Pi,
        splitCommaTokens,
        aliasPipeline,
        compatibilityAcceptedNoOps,
        lostStationIds,
        stations,
        defaultDescriptionReconcileMode: defaultParseOptions.descriptionReconcileMode ?? 'first',
        defaultDescriptionAppendDelimiter:
          defaultParseOptions.descriptionAppendDelimiter ?? ' | ',
        flushDirectionSet: (reason) => {
          if (traverseCtx.dirSetId) flushDirectionSet(reason);
        },
      });
      orderExplicit = directiveResult.orderExplicit;
      if (directiveResult.stopParse) break;
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
            resolveLinearSigma(token, defaultSigma),
          resolveAngularSigma: (token, defaultSigma) =>
            resolveAngularSigma(token, defaultSigma),
          resolveLevelingSigma: (token, inst, spanMeters, contextCode, sourceLine) =>
            resolveLevelingSigma(
              token,
              inst,
              spanMeters,
              contextCode,
              sourceLine,
            ),
          defaultDistanceSigma,
          defaultHorizontalAngleSigmaSec,
          defaultAzimuthSigmaSec,
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
        } else {
          const traverseObsIdRef = { current: obsId };
          const faceModeRef = { current: faceMode };
          const handledTraverse = handleTraverseRecord({
            code,
            parts,
            lineNum,
            state,
            instrumentLibrary,
            logs,
            obsIdRef: traverseObsIdRef,
            traverseCtx,
            faceModeRef,
            parseAngleTokenRad,
            parseObservedLinearToken,
            parseObservedAngleToken,
            linearToMetersFactor,
            effectiveDistanceMode,
            extractSigmaTokens,
            resolveLinearSigma: (token, defaultSigma) =>
              resolveLinearSigma(token, defaultSigma),
            resolveAngularSigma: (token, defaultSigma) =>
              resolveAngularSigma(token, defaultSigma),
            resolveLevelingSigma: (token, inst, spanMeters, contextCode, sourceLine) =>
              resolveLevelingSigma(
                token,
                inst,
                spanMeters,
                contextCode,
                sourceLine,
              ),
            defaultDistanceSigma,
            defaultHorizontalAngleSigmaSec,
            defaultAzimuthSigmaSec,
            defaultZenithSigmaSec,
            applyPlanRotation,
            wrapTo2Pi,
            pushObservation,
            face2Weight: FACE2_WEIGHT,
          });
          if (handledTraverse) {
            obsId = traverseObsIdRef.current;
            faceMode = faceModeRef.current;
          } else {
            const directionObsIdRef = { current: obsId };
            const directionSetCountRef = { current: directionSetCount };
            const handledDirectionSet = handleDirectionSetRecord({
              code,
              parts,
              lineNum,
              state,
              instrumentLibrary,
              logs,
              obsIdRef: directionObsIdRef,
              currentSourceFile,
              traverseCtx,
              directionSetCountRef,
              directionRejectDiagnostics,
              parseObservedLinearToken,
              parseObservedAngleToken,
              parseDirectionFaceHintToken,
              stripDirectionFaceHints,
              inferFaceFromZenith,
              isReliableFaceSource,
              linearToMetersFactor,
              effectiveDistanceMode,
              extractSigmaTokens,
              resolveLinearSigma: (token, defaultSigma) =>
                resolveLinearSigma(token, defaultSigma),
              resolveAngularSigma: (token, defaultSigma) =>
                resolveAngularSigma(token, defaultSigma),
              resolveLevelingSigma: (token, inst, spanMeters, contextCode, sourceLine) =>
                resolveLevelingSigma(
                  token,
                  inst,
                  spanMeters,
                  contextCode,
                  sourceLine,
                ),
              defaultDistanceSigma,
              defaultDirectionSigmaSec,
              defaultZenithSigmaSec,
              pushObservation,
              flushDirectionSet,
            });
            if (handledDirectionSet) {
              obsId = directionObsIdRef.current;
              directionSetCount = directionSetCountRef.current;
              if (code === 'DB') faceMode = 'unknown';
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

  const aliasSummary = aliasPipeline.buildSummary();
  state.aliasExplicitCount = aliasSummary.explicitAliasCount;
  state.aliasRuleCount = aliasSummary.aliasRuleCount;
  state.aliasExplicitMappings = aliasSummary.aliasExplicitMappings;
  state.aliasRuleSummaries = aliasSummary.aliasRuleSummaries;
  const { unknowns } = finalizeParsePostProcessing({
    stations,
    observations,
    state,
    logs,
    resolveAlias: aliasPipeline.resolveAlias,
    addAliasTrace: aliasPipeline.addAliasTrace,
    applyFixities,
    lostStationIds,
    explicitAliasCount: aliasSummary.explicitAliasCount,
    aliasRuleCount: aliasSummary.aliasRuleCount,
    directionRejectDiagnostics,
    aliasTraceEntries: aliasPipeline.getAliasTraceEntries(),
    descriptionTraceEntries,
    orderExplicit,
    preanalysisMode,
    compatibilityMode,
    compatibilityAcceptedNoOps,
    compatibilityDiagnostics,
    ambiguousCount,
    legacyFallbackCount,
    strictRejectCount,
    rewriteSuggestionCount,
    directiveTransitions,
    directiveNoEffectWarnings,
    inputLines: lines,
    splitInlineCommentAndDescription,
    directionSetTreatmentDiagnostics,
    defaultDescriptionReconcileMode: defaultParseOptions.descriptionReconcileMode ?? 'first',
    defaultDescriptionAppendDelimiter: defaultParseOptions.descriptionAppendDelimiter ?? ' | ',
  });

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
