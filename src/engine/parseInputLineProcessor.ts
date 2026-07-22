import { dispatchParseDirective } from './parseDirectiveRegistry';
import { createDirectionSetWorkflow, type RawDirectionShot } from './parseDirectionSetWorkflow';
import { createIncludeScopeSnapshot, restoreIncludeScopeSnapshot, type IncludeScopeSnapshot } from './parseIncludeScope';
import { resetParseStateToProjectDefaults, defaultParseOptions } from './parseDefaultOptions';
import { normalizeInlineDirective } from './parseInlineDirectives';
import { handleParseDataRecord } from './parseInputDataRecord';
import { normalizeObservationModeState } from './parseDirectiveState';
import { cloneParseAliasRule, type ParseAliasRule, createParseAliasPipeline } from './parseAliasPipeline';
import { DESCRIPTION_RECORD_TYPES, parseAngleTokenRad, parseLinearMetersToken, splitInlineCommentAndDescription, splitWhitespaceTokens, splitCommaTokens, wrapTo2Pi } from './parseTokenHelpers';
import type { GpsCovarianceState } from './parseFieldObservationRecords';
import type { ParseObservationHelpers } from './parseInputObservationHelpers';
import type { DirectionRejectDiagnostic, GpsObservation, InstrumentLibrary, ParseCompatibilityDiagnosticCode, ParseCompatibilityMode, ParseOptions, StationId, StationMap } from '../types';

type ParsePosition = { lineNum: number; currentSourceFile: string; displayLineCount: number };
type TraverseContext = { occupy?: string; backsight?: string; backsightRefAngle?: number; dirSetId?: string; dirInstCode?: string; dirRawShots?: RawDirectionShot[] };
type ProcessParseInputLinesOptions = {
  addCompatibilityDiagnostic: (
    _code: ParseCompatibilityDiagnosticCode,
    _line: number,
    _recordType: string,
    _message: string,
    _rewriteSuggestion?: string,
    _fallbackApplied?: boolean,
    _severity?: 'warning' | 'error',
  ) => void;
  aliasPipeline: ReturnType<typeof createParseAliasPipeline>;
  compatibilityAcceptedNoOps: Set<string>;
  compatibilityMode: ParseCompatibilityMode;
  directionRejectDiagnostics: DirectionRejectDiagnostic[];
  directionSetCount: number;
  directionSetWorkflow: ReturnType<typeof createDirectionSetWorkflow>;
  existingInstruments: InstrumentLibrary;
  faceMode: 'unknown' | 'face1' | 'face2';
  gpsCovarianceStateRef: GpsCovarianceState;
  helpers: ParseObservationHelpers;
  instrumentLibrary: InstrumentLibrary;
  lastGpsObservation: GpsObservation | undefined;
  lines: Array<{ kind: string; raw?: string; sourceLine: number; sourceFile: string; includeSourceFile?: string; projectFileIndex?: number; projectFileCount?: number }>;
  logs: string[];
  lostStationIds: Set<StationId>;
  obsIdRef: { current: number };
  orderExplicit: boolean;
  parsePosition: ParsePosition;
  preanalysisMode: boolean;
  projectFileResetState: Partial<ParseOptions>;
  recordDirectiveTransition: (_directive: string) => void;
  descriptionTraceEntries: NonNullable<ParseOptions['descriptionTrace']>;
  resolveAngularSigma: unknown;
  resolveLevelingSigma: unknown;
  resolveLinearSigma: unknown;
  state: ParseOptions;
  stations: StationMap;
  strictDirectivePolicy: boolean;
  traverseCtx: TraverseContext;
};

export const processParseInputLines = (options: ProcessParseInputLinesOptions) => {
  const {
    addCompatibilityDiagnostic,
    aliasPipeline,
    compatibilityAcceptedNoOps,
    compatibilityMode,
    directionRejectDiagnostics,
    directionSetWorkflow,
    existingInstruments,
    gpsCovarianceStateRef,
    helpers,
    instrumentLibrary,
    lines,
    logs,
    obsIdRef,
    parsePosition,
    preanalysisMode,
    projectFileResetState,
    recordDirectiveTransition,
    descriptionTraceEntries,
    state,
    stations,
    strictDirectivePolicy,
    traverseCtx,
  } = options;
  let directionSetCount = options.directionSetCount;
  let faceMode = options.faceMode;
  let lastGpsObservation = options.lastGpsObservation;
  let lostStationIds = options.lostStationIds;
  let orderExplicit = options.orderExplicit;
  const includeScopeStack: IncludeScopeSnapshot<
    GpsObservation,
    StationId,
    ParseAliasRule,
    RawDirectionShot
  >[] = [];
  const { linearToMetersFactor } = helpers;
  const resolveLinearSigma = options.resolveLinearSigma as Parameters<typeof handleParseDataRecord>[0]['resolveLinearSigma'];
  const resolveAngularSigma = options.resolveAngularSigma as Parameters<typeof handleParseDataRecord>[0]['resolveAngularSigma'];
  const resolveLevelingSigma = options.resolveLevelingSigma as Parameters<typeof handleParseDataRecord>[0]['resolveLevelingSigma'];
  const flushDirectionSet = (reason: string): void => {
    directionSetWorkflow.flushDirectionSet(traverseCtx, reason);
    faceMode = 'unknown';
  };
  for (const entry of lines) {
    parsePosition.lineNum = entry.sourceLine;
    parsePosition.currentSourceFile = entry.sourceFile;
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
        `Project file boundary: loaded ${entry.sourceFile} (${(entry.projectFileIndex ?? 0) + 1}/${entry.projectFileCount ?? 0}) with parser defaults reset to the project-level starting state.`,
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
    const trimmed = (entry.raw ?? '').trim();
    if (!trimmed) continue;
    parsePosition.displayLineCount += 1;
    if (parsePosition.currentSourceFile === (state.sourceFile ?? '<input>')) {
      const displayLineBySourceLine = state.displayLineBySourceLine ?? {};
      displayLineBySourceLine[parsePosition.lineNum] = parsePosition.displayLineCount;
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
          parsePosition.lineNum,
          'INLINE',
          `ambiguous inline option "${parts[0]}"`,
          candidates ? `Use one of: ${candidates}` : undefined,
          false,
          strictDirectivePolicy ? 'error' : 'warning',
        );
        if (!strictDirectivePolicy) {
          logs.push(
            `Warning: ambiguous inline option "${parts[0]}" at line ${parsePosition.lineNum}; candidates: ${candidates}.`,
          );
        }
        continue;
      }
      if (normalizedDirective.unknown || !normalizedDirective.op) {
        addCompatibilityDiagnostic(
          'STRICT_REJECTED',
          parsePosition.lineNum,
          'INLINE',
          `unknown inline option "${parts[0]}"`,
          'Use a full supported inline option name or a unique unambiguous prefix.',
          false,
          strictDirectivePolicy ? 'error' : 'warning',
        );
        if (!strictDirectivePolicy) {
          logs.push(`Warning: unknown inline option "${parts[0]}" at line ${parsePosition.lineNum}; ignored.`);
        }
        continue;
      }
      const op = normalizedDirective.op;
      const directiveResult = dispatchParseDirective({
        op,
        parts,
        lineNum: parsePosition.lineNum,
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
          sourceLine: parsePosition.lineNum,
          recordType: code as 'C' | 'P' | 'PH' | 'CH' | 'EH' | 'E',
          description,
        });
      }
    }
    if (state.dataInputEnabled === false) {
      continue;
    }

    const recordResult = handleParseDataRecord({
      addCompatibilityDiagnostic,
      code: code ?? '',
      compatibilityMode,
      directionRejectDiagnostics,
      directionSetCount,
      directionSetWorkflow,
      existingInstruments,
      faceMode,
      gpsCovarianceStateRef,
      helpers,
      instrumentLibrary,
      lastGpsObservation,
      logs,
      obsIdRef,
      parsePosition,
      parts,
      preanalysisMode,
      resolveAngularSigma,
      resolveLevelingSigma,
      resolveLinearSigma,
      state,
      stations,
      traverseCtx,
    });
    directionSetCount = recordResult.directionSetCount;
    faceMode = recordResult.faceMode;
    lastGpsObservation = recordResult.lastGpsObservation;
  }

  if (traverseCtx.dirSetId) {
    flushDirectionSet('EOF');
  }


  return { directionSetCount, faceMode, lastGpsObservation, lostStationIds, orderExplicit };
};
