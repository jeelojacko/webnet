import type { GpsCovarianceState } from './parseFieldObservationRecords';
import {
  createDirectionSetWorkflow,
  type RawDirectionShot,
} from './parseDirectionSetWorkflow';
import {
  directiveTransitionStateFromParseState,
  normalizeObservationModeState,
} from './parseDirectiveState';
import { expandInputWithIncludes, expandProjectRunFilesWithIncludes } from './parseIncludes';
import { finalizeParsePostProcessing } from './parsePostProcessing';
import {
  buildProjectFileResetState,
  defaultParseOptions,
} from './parseDefaultOptions';
import { processParseInputLines } from './parseInputLineProcessor';
import { createParseObservationHelpers } from './parseInputObservationHelpers';
import { normalizeInlineDirective } from './parseInlineDirectives';
import {
  AMODE_AUTO_MAX_DIR_RAD,
  AMODE_AUTO_MARGIN_RAD,
  DESCRIPTION_RECORD_TYPES,
  FACE2_WEIGHT,
  FT_PER_M,
  applyFixities,
  splitCommaTokens,
  splitInlineCommentAndDescription,
  splitWhitespaceTokens,
} from './parseTokenHelpers';
export { normalizeInlineDirective } from './parseInlineDirectives';
import {
  createParseSigmaResolvers,
} from './parseSigmaResolution';
import {
  createParseAliasPipeline,
} from './parseAliasPipeline';
import type {
  CoordInputClass,
  CoordSystemMode,
  CrsProjectionModel,
  DirectiveNoEffectWarning,
  DirectiveTransition,
  DirectionRejectDiagnostic,
  ReductionUsageSummary,
  GpsObservation,
  InstrumentLibrary,
  Observation,
  ParseResult,
  StationMap,
  StationId,
  ParseOptions,
  ParseCompatibilityDiagnostic,
  ParseCompatibilityDiagnosticCode,
  ParseCompatibilityMode,
  FaceNormalizationMode,
  DirectionSetTreatmentDiagnostic,
} from '../types';



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
  state.projectDefaultInstrument =
    opts.projectDefaultInstrument ?? opts.currentInstrument ?? state.projectDefaultInstrument;
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
  const projectFileResetState = buildProjectFileResetState(state);
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
      sourceFile: parsePosition.currentSourceFile,
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
      line: parsePosition.lineNum,
      directive,
      stateAfter: directiveTransitionStateFromParseState(state),
      effectiveFromLine: parsePosition.lineNum,
      obsCountInRange: 0,
    });
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
  const {
    resolveLinearSigma,
    resolveAngularSigma,
    resolveLevelingSigma,
  } = createParseSigmaResolvers(state, logs);
  const parsePosition = { lineNum: 0, currentSourceFile: state.sourceFile ?? '<input>', displayLineCount: 0 };
  const aliasPipeline = createParseAliasPipeline({
    logs,
    getCurrentLine: () => parsePosition.lineNum,
    splitCommaTokens,
  });

  aliasPipeline.preloadClusterApprovedMerges(state.clusterApprovedMerges ?? []);

  const expanded =
    opts.projectRunFiles && opts.projectRunFiles.length > 0
      ? expandProjectRunFilesWithIncludes(opts.projectRunFiles, opts, logs, {
          splitInlineCommentAndDescription,
          splitWhitespaceTokens,
          normalizeInlineDirective,
        })
      : expandInputWithIncludes(input, opts, logs, {
          splitInlineCommentAndDescription,
          splitWhitespaceTokens,
          normalizeInlineDirective,
        });
  const lines = expanded.lines;
  state.includeTrace = expanded.includeTrace;
  state.includeErrors = expanded.includeErrors;
  const obsIdRef = { current: 0 };
  let lastGpsObservation: GpsObservation | undefined;
  const gpsCovarianceStateRef: GpsCovarianceState = {};
  const preanalysisMode = state.preanalysisMode === true;
  const strictDirectivePolicy = compatibilityMode === 'strict';
  const compatibilityAcceptedNoOps = new Set<string>(
    state.compatibilityAcceptedNoOpDirectives ?? [],
  );
  const observationHelpers = createParseObservationHelpers({
    addCompatibilityDiagnostic,
    compatibilityMode,
    getLostStationIds: () => lostStationIds,
    logs,
    observations,
    parsePosition,
    preanalysisMode,
    state,
    stations,
  });
  const pushObservation = observationHelpers.pushObservation;
  const directionSetWorkflow = createDirectionSetWorkflow({
    state,
    logs,
    compatibilityMode,
    getCurrentLine: () => parsePosition.lineNum,
    getCurrentSourceFile: () => parsePosition.currentSourceFile,
    obsIdRef,
    pushObservation,
    directionRejectDiagnostics,
    directionSetTreatmentDiagnostics,
  });
  const lineProcessingResult = processParseInputLines({
    addCompatibilityDiagnostic,
    aliasPipeline,
    compatibilityAcceptedNoOps,
    compatibilityMode,
    directionRejectDiagnostics,
    directionSetCount,
    directionSetWorkflow,
    existingInstruments,
    faceMode,
    gpsCovarianceStateRef,
    helpers: observationHelpers,
    instrumentLibrary,
    lastGpsObservation,
    lines,
    logs,
    lostStationIds,
    obsIdRef,
    orderExplicit,
    parsePosition,
    preanalysisMode,
    projectFileResetState,
    recordDirectiveTransition,
    descriptionTraceEntries,
    resolveAngularSigma,
    resolveLevelingSigma,
    resolveLinearSigma,
    state,
    stations,
    strictDirectivePolicy,
    traverseCtx,
  });
  directionSetCount = lineProcessingResult.directionSetCount;
  faceMode = lineProcessingResult.faceMode;
  lastGpsObservation = lineProcessingResult.lastGpsObservation;
  lostStationIds = lineProcessingResult.lostStationIds;
  orderExplicit = lineProcessingResult.orderExplicit;
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
  state.inputStationSnapshots = Object.entries(stations)
    .filter(([, station]) => station.coordInputClass != null && station.coordInputClass !== 'unknown')
    .map(([stationId, station]) => ({
      stationId,
      x: station.x,
      y: station.y,
      h: station.h,
      coordInputClass: station.coordInputClass,
      constraintModeX: station.constraintModeX,
      constraintModeY: station.constraintModeY,
      constraintModeH: station.constraintModeH,
    }));

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






