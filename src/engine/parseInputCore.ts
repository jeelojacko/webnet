import { SEC_TO_RAD } from './angles';
import { handleConventionalPrimitiveRecord } from './parseConventionalObservationRecords';
import { handleControlRecord } from './parseControlRecords';
import { handleDirectionSetRecord } from './parseDirectionSetRecords';
import { handleFieldObservationRecord } from './parseFieldObservationRecords';
import type { GpsCovarianceState } from './parseFieldObservationRecords';
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
import { expandInputWithIncludes, expandProjectRunFilesWithIncludes } from './parseIncludes';
import { finalizeParsePostProcessing } from './parsePostProcessing';
import {
  buildProjectFileResetState,
  defaultParseOptions,
  resetParseStateToProjectDefaults,
} from './parseDefaultOptions';
import { normalizeInlineDirective } from './parseInlineDirectives';
import {
  AMODE_AUTO_MAX_DIR_RAD,
  AMODE_AUTO_MARGIN_RAD,
  DESCRIPTION_RECORD_TYPES,
  FACE2_WEIGHT,
  FT_PER_M,
  activeCrsProjectionModel,
  applyFixities,
  applyPlanRotation,
  azimuthFromTo,
  clearStationConstraintComponent,
  extractHiHt,
  isNumericToken,
  parseAngleTokenRad,
  parseConstraintCorrToken,
  parseFixityTokens,
  parseFromTo,
  parseLinearMetersToken,
  parseSsStationTokens,
  resolveStationConstraintMode,
  setStationConstraintMode,
  splitCommaTokens,
  splitInlineCommentAndDescription,
  splitStationPairToken,
  splitWhitespaceTokens,
  toDegrees,
  wrapToPi,
  wrapTo2Pi,
} from './parseTokenHelpers';
export { normalizeInlineDirective } from './parseInlineDirectives';
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
  let currentSourceFile = state.sourceFile ?? '<input>';
  let displayLineCount = 0;
  const obsIdRef = { current: 0 };
  let lastGpsObservation: GpsObservation | undefined;
  const gpsCovarianceStateRef: GpsCovarianceState = {};
  const autoCreatedStations = new Set<StationId>();
  const rejectedAutoCreateTokens = new Set<string>();
  const preanalysisMode = state.preanalysisMode === true;
  const strictDirectivePolicy = compatibilityMode === 'strict';
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
    if (incomingClass === 'unknown') return;
    if (existingClass === 'unknown') {
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
    obsIdRef,
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
    if (entry.kind === 'project-file-enter') {
      if (traverseCtx.dirSetId) {
        flushDirectionSet('project file boundary');
      }
      resetParseStateToProjectDefaults(state, projectFileResetState);
      traverseCtx.occupy = undefined;
      traverseCtx.backsight = undefined;
      traverseCtx.backsightRefAngle = undefined;
      traverseCtx.dirSetId = undefined;
      traverseCtx.dirInstCode = undefined;
      traverseCtx.dirRawShots = undefined;
      faceMode = 'unknown';
      directionSetCount = 0;
      lastGpsObservation = undefined;
      lostStationIds = new Set<StationId>((state.lostStationIds ?? []).map((id) => `${id}`));
      logs.push(
        `Project file boundary: loaded ${entry.sourceFile} (${entry.projectFileIndex + 1}/${entry.projectFileCount}) with parser defaults reset to the project-level starting state.`,
      );
      continue;
    }
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
    displayLineCount += 1;
    if (currentSourceFile === (state.sourceFile ?? '<input>')) {
      const displayLineBySourceLine = state.displayLineBySourceLine ?? {};
      displayLineBySourceLine[lineNum] = displayLineCount;
      state.displayLineBySourceLine = displayLineBySourceLine;
    }
    const parsedInline =
      /^G0(?:\s|$)/i.test(trimmed) ? { line: trimmed } : splitInlineCommentAndDescription(trimmed);
    const line = parsedInline.line;
    if (!line || line.startsWith('#')) continue;

    // Inline options
    if (line.startsWith('.') || line.startsWith('/')) {
      const parts = splitWhitespaceTokens(line);
      const normalizedDirective = normalizeInlineDirective(parts[0] ?? '');
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
        const handledConventionalPrimitive = handleConventionalPrimitiveRecord({
          code,
          parts,
          lineNum,
          state,
          stations,
          instrumentLibrary,
          logs,
          obsIdRef,
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
        if (!handledConventionalPrimitive) {
          const faceModeRef = { current: faceMode };
          const handledTraverse = handleTraverseRecord({
            code,
            parts,
            lineNum,
            state,
            instrumentLibrary,
            logs,
            obsIdRef,
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
            faceMode = faceModeRef.current;
          } else {
            const directionSetCountRef = { current: directionSetCount };
            const handledDirectionSet = handleDirectionSetRecord({
              code,
              parts,
              lineNum,
              state,
              instrumentLibrary,
              logs,
              obsIdRef,
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
              extractHiHt,
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
              directionSetCount = directionSetCountRef.current;
              if (code === 'DB') faceMode = 'unknown';
            } else {
              const lastGpsObservationRef = { current: lastGpsObservation };
              const handledFieldObservation = handleFieldObservationRecord({
                code,
                parts,
                lineNum,
                state,
                stations,
                instrumentLibrary,
                logs,
                obsIdRef,
                compatibilityMode,
                lastGpsObservationRef,
                gpsCovarianceStateRef,
                addCompatibilityDiagnostic,
                rejectNumericStationTokens,
                parseSsStationTokens,
                parseAngleTokenRad,
                parseLinearMetersToken,
                parseObservedLinearToken,
                parseSigmaToken,
                extractSigmaTokens,
                extractHiHt,
                linearToMetersFactor,
                effectiveDistanceMode,
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
                defaultDirectionSigmaSec,
                defaultZenithSigmaSec,
                defaultElevDiffSigma,
                applyPlanRotation,
                wrapTo2Pi,
                pushObservation,
                ftPerM: FT_PER_M,
                traverseCtx,
              });
              if (handledFieldObservation) {
                lastGpsObservation = lastGpsObservationRef.current;
              } else {
                logs.push(`Unrecognized code "${code}" at line ${lineNum}, skipping`);
              }
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
